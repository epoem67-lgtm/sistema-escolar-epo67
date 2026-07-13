#!/usr/bin/env node
/**
 * migrate-p1.js — Migración Robusta de Calificaciones P1
 *
 * Pipeline de 4 etapas:
 *   1. Extracción directa de XLSX (solo P1)
 *   2. Validación contra reglas EPO67 (rubros, suma, cal)
 *   3. Matching multi-estrategia de alumnos con Firestore
 *   4. Escritura a Firestore con dry-run y reporte detallado
 *
 * Uso:
 *   node migrate-p1.js --dry-run     (simular, genera reporte sin escribir)
 *   node migrate-p1.js               (escritura real a Firestore)
 *
 * Prerequisitos:
 *   1. Token de acceso: firebase login:ci → guardar en /tmp/firebase-access-token.txt
 *   2. Datos de Firestore exportados:
 *      node -e "... fetch students, groups, subjects, assignments ..." > /tmp/firestore-*.json
 *      O usar las funciones fetchAllDocs incluidas aquí.
 *
 * Mejoras vs scripts anteriores:
 *   - NO descarta cal==0 (alumnos sin calificación se preservan)
 *   - Valida cada rubro contra su máximo permitido (clamp + reporte)
 *   - Recalcula suma y cal en vez de confiar en el Excel
 *   - Threshold de matching bajado a 0.60
 *   - Levenshtein distance como fallback
 *   - Reporte detallado de todo lo que no se pudo resolver
 */

const XLSX = require('xlsx');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════

const PROJECT_ID = 'epo67-sistema';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 20;
const DELAY_MS = 3000;
const STUDENT_MATCH_THRESHOLD = 0.60; // Bajado de 0.70
const BASE = path.resolve(__dirname, '..');

// Carpeta "Calificaciones" con los XLSX oficiales finales
const CAL_BASE = path.join(BASE, 'Calificaciones');
const SOURCES = [
  { turno: 'MATUTINO',    folder: path.join(CAL_BASE, 'LISTAS POR DOCENTE MATUTINO') },
  { turno: 'VESPERTINO',  folder: path.join(CAL_BASE, 'LISTAS POR DOCENTE VESPERTINO') },
];

// ═══════════════════════════════════════════════════════════
// REGLAS DE NEGOCIO EPO67 (de constants.js)
// ═══════════════════════════════════════════════════════════

const RUBROS = {
  MATUTINO:    [{ key: 'ec', max: 8 }, { key: 'tr', max: 2 }, { key: 'pe', max: 10 }],
  VESPERTINO:  [{ key: 'ec', max: 5 }, { key: 'ex', max: 3 }, { key: 'tr', max: 2 }, { key: 'pe', max: 10 }],
};

function calcSuma(rubros) {
  const vals = Object.values(rubros).filter(v => v !== null && v !== undefined && v !== '');
  const suma = vals.reduce((a, b) => a + Number(b), 0);
  return Math.min(Math.round(suma * 10) / 10, 10);
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return null;
  if (suma === 0) return 5; // Mínimo EPO67 = 5, nunca 0
  const s = Math.min(suma, 10);
  if (s >= 6) return Math.min(Math.round(s), 10);
  return Math.max(5, Math.floor(s));
}

// ═══════════════════════════════════════════════════════════
// HELPERS DE EXTRACCIÓN (de extract-grades.js)
// ═══════════════════════════════════════════════════════════

const SKIP_SHEETS = /^(hoja\s*\d+|sheet\s*\d+)$/i;

const SUBJECT_TYPO_MAP = {
  'DEERECHIS': 'DERECHOS', 'QUIMICAS': 'QUÍMICAS', 'FILOSOFICO': 'FILOSÓFICO',
};

const SUBJECT_REPLACEMENTS = [
  [/INGLES\s+2\b/i, 'INGLÉS II'], [/INGLES\s+1\b/i, 'INGLÉS I'],
  [/INGLES\s+3\b/i, 'INGLÉS III'], [/INGLES\s+4\b/i, 'INGLÉS IV'],
  [/INGLES\s+5\b/i, 'INGLÉS V'],  [/INGLES\s+6\b/i, 'INGLÉS VI'],
];

function normalizeSubjectName(raw) {
  let name = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  for (const [typo, fix] of Object.entries(SUBJECT_TYPO_MAP)) {
    name = name.replace(new RegExp('\\b' + typo + '\\b', 'gi'), fix);
  }
  for (const [pattern, replacement] of SUBJECT_REPLACEMENTS) {
    name = name.replace(pattern, replacement);
  }
  return name
    .replace(/\bFILOSOFICO\b/g, 'FILOSÓFICO').replace(/\bQUIMICAS\b/g, 'QUÍMICAS')
    .replace(/\bQUIMICA\b/g, 'QUÍMICA').replace(/\bBIOLOGIA\b/g, 'BIOLOGÍA')
    .replace(/\bMATEMATICAS\b/g, 'MATEMÁTICAS').replace(/\bINGLES\b/g, 'INGLÉS')
    .replace(/\bFISICA\b/g, 'FÍSICA').replace(/\bETICA\b/g, 'ÉTICA')
    .replace(/\bINFORMATICA\b/g, 'INFORMÁTICA').replace(/\bADMINISTRACION\b/g, 'ADMINISTRACIÓN')
    .replace(/\bECONOMIA\b/g, 'ECONOMÍA').replace(/\bSOCIOLOGIA\b/g, 'SOCIOLOGÍA')
    .replace(/\bPSICOLOGIA\b/g, 'PSICOLOGÍA').replace(/\bGEOGRAFIA\b/g, 'GEOGRAFÍA')
    .replace(/\bFILOSOFIA\b/g, 'FILOSOFÍA').replace(/\bECOLOGIA\b/g, 'ECOLOGÍA');
}

function parsePartial(val) {
  if (!val || typeof val !== 'string') return null;
  const u = val.toUpperCase();
  if (u.includes('PRIMER') || u.includes('1ER') || u.includes('1°')) return 'P1';
  if (u.includes('SEGUNDO') || u.includes('2DO') || u.includes('2°')) return 'P2';
  if (u.includes('TERCER') || u.includes('3ER') || u.includes('3°')) return 'P3';
  return null;
}

function parseGrado(val) {
  if (val == null) return null;
  const m = String(val).trim().match(/(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function cellVal(ws, ref) { const c = ws[ref]; return c && c.v != null ? c.v : null; }
function cellStr(ws, ref) { const v = cellVal(ws, ref); return v != null ? String(v).trim() : ''; }
function colLetter(idx) {
  let s = '', n = idx;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

function detectColumns(ws) {
  const result = { sumaCol: null, faltasCol: null, calCol: null, rubroStartCol: 4, rubroEndCol: null, rubroCount: 0 };
  // FIX: Take FIRST "Calificación Definitiva" column, not the last.
  // Some teachers (Guadalupe, Tania) have TWO columns with that name — the first has the real data.
  let firstCalCol = null;
  for (let c = 0; c < 26; c++) {
    const v = cellStr(ws, colLetter(c) + '16').toLowerCase();
    if (!v) continue;
    if (v.includes('suma') && result.sumaCol === null) result.sumaCol = c;
    if (v.includes('falta')) result.faltasCol = c;
    if (v.includes('calificaci') && firstCalCol === null) firstCalCol = c;
  }
  result.calCol = firstCalCol;
  if (result.sumaCol !== null) { result.rubroEndCol = result.sumaCol; result.rubroCount = result.rubroEndCol - result.rubroStartCol; }
  if (result.faltasCol === null && result.sumaCol !== null) result.faltasCol = result.sumaCol + 1;
  return result;
}

function mapRubros(turno, startCol, count) {
  if (count === 3) return [{ key: 'ec', col: startCol }, { key: 'tr', col: startCol + 1 }, { key: 'pe', col: startCol + 2 }];
  if (count === 4) return [{ key: 'ec', col: startCol }, { key: 'ex', col: startCol + 1 }, { key: 'tr', col: startCol + 2 }, { key: 'pe', col: startCol + 3 }];
  return null;
}

// ═══════════════════════════════════════════════════════════
// ETAPA 1: EXTRACCIÓN DE XLSX (solo P1)
// ═══════════════════════════════════════════════════════════

function extractFromXLSX() {
  const allGrades = [];
  const warnings = [];
  let filesProcessed = 0, sheetsProcessed = 0;

  for (const { turno, folder } of SOURCES) {
    console.log(`\n  Procesando ${turno}: ${folder}`);
    if (!fs.existsSync(folder)) { console.log(`    [ERROR] Carpeta no existe`); continue; }

    const teacherDirs = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
    console.log(`    ${teacherDirs.length} carpetas de docentes`);

    for (const teacherFolder of teacherDirs) {
      const teacherPath = path.join(folder, teacherFolder);
      const xlsxFiles = fs.readdirSync(teacherPath).filter(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.startsWith('~$'));
      if (xlsxFiles.length === 0) continue;

      for (const xlsxFile of xlsxFiles) {
        const filePath = path.join(teacherPath, xlsxFile);
        filesProcessed++;

        let wb;
        try { wb = XLSX.readFile(filePath, { cellFormula: false }); }
        catch (err) { warnings.push(`Error leyendo ${teacherFolder}/${xlsxFile}: ${err.message}`); continue; }

        for (const sheetName of wb.SheetNames) {
          if (SKIP_SHEETS.test(sheetName.trim())) continue;
          const ws = wb.Sheets[sheetName];
          sheetsProcessed++;

          // Detectar parcial — SOLO procesar P1
          let partial = null;
          for (const c of 'ABCDEFGH'.split('')) {
            partial = parsePartial(cellStr(ws, c + '11'));
            if (partial) break;
          }
          if (!partial) {
            for (const c of 'ABCDEFGH'.split('')) {
              partial = parsePartial(cellStr(ws, c + '10'));
              if (partial) break;
            }
          }

          // Filtrar: solo P1, o asumir P1 si no se detecta parcial
          if (partial && partial !== 'P1') continue;
          if (!partial) partial = 'P1';

          const teacherName = cellStr(ws, 'C13') || teacherFolder;
          const subjectName = normalizeSubjectName(cellStr(ws, 'B14') || sheetName.toUpperCase());
          const grado = parseGrado(cellStr(ws, 'B15'));
          let grupo = cellVal(ws, 'D15');
          if (grupo != null) grupo = parseInt(String(grupo), 10);

          if (!grado || !grupo) {
            warnings.push(`${teacherFolder}/${xlsxFile} > ${sheetName}: sin grado/grupo`);
            continue;
          }

          const cols = detectColumns(ws);
          if (cols.calCol === null) {
            warnings.push(`${teacherFolder}/${xlsxFile} > ${sheetName}: sin columna Calificación`);
            continue;
          }

          const rubroMapping = (cols.sumaCol !== null && cols.rubroCount > 0) ? mapRubros(turno, cols.rubroStartCol, cols.rubroCount) : null;

          // Detectar escala: contar cuántos cal > 10
          const rawCals = [];
          for (let row = 17; row <= 200; row++) {
            const numVal = cellVal(ws, 'A' + row);
            if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;
            const calRaw = cellVal(ws, colLetter(cols.calCol) + row);
            if (calRaw != null && typeof calRaw === 'number' && calRaw > 0) rawCals.push(calRaw);
          }
          const countOver10 = rawCals.filter(v => v > 10).length;
          const is100Scale = rawCals.length > 0 && (countOver10 / rawCals.length) > 0.5;
          if (is100Scale) warnings.push(`${teacherFolder}/${xlsxFile} > ${sheetName}: escala 0-100 detectada (${countOver10}/${rawCals.length} > 10)`);

          // Extraer calificaciones
          for (let row = 17; row <= 200; row++) {
            const numVal = cellVal(ws, 'A' + row);
            if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;

            const apellido1 = cellStr(ws, 'B' + row).toUpperCase();
            const apellido2 = cellStr(ws, 'C' + row).toUpperCase();
            const nombres   = cellStr(ws, 'D' + row).toUpperCase();

            let ec = null, ex = null, tr = null, pe = null;
            if (rubroMapping) {
              for (const { key, col } of rubroMapping) {
                const raw = cellVal(ws, colLetter(col) + row);
                const val = (raw != null && !isNaN(parseFloat(raw))) ? parseFloat(raw) : null;
                if (key === 'ec') ec = val;
                else if (key === 'ex') ex = val;
                else if (key === 'tr') tr = val;
                else if (key === 'pe') pe = val;
              }
            }

            let suma = null;
            if (cols.sumaCol !== null) {
              const raw = cellVal(ws, colLetter(cols.sumaCol) + row);
              suma = (raw != null && !isNaN(parseFloat(raw))) ? parseFloat(raw) : null;
            }

            let faltas = null;
            if (cols.faltasCol !== null) {
              const raw = cellVal(ws, colLetter(cols.faltasCol) + row);
              faltas = (raw != null && !isNaN(parseInt(raw))) ? parseInt(raw) : null;
            }

            let calRaw = cellVal(ws, colLetter(cols.calCol) + row);
            if (calRaw != null && typeof calRaw === 'number') {
              // Normalizar escala 100 → 10
              if (is100Scale && calRaw > 10) calRaw = Math.round((calRaw / 10) * 10) / 10;
            } else {
              calRaw = null;
            }

            // NO descartamos cal==0 ni cal==null — se preservan para reporte
            const studentFullName = [apellido1, apellido2, nombres].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

            allGrades.push({
              teacherFolder, teacherName: teacherName.toUpperCase(), turno, subjectName,
              grado, grupo, groupKey: grado + '-' + grupo, partial,
              studentNum: numVal, apellido1, apellido2, nombres, studentFullName,
              ec, ex, tr, pe, sumaExcel: suma, faltasExcel: faltas,
              calExcel: calRaw, is100Scale,
            });
          }
        }
      }
    }
  }

  console.log(`\n  Archivos: ${filesProcessed}, Hojas procesadas: ${sheetsProcessed}`);
  console.log(`  Calificaciones extraídas: ${allGrades.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  return { allGrades, warnings };
}

// ═══════════════════════════════════════════════════════════
// ETAPA 2: VALIDACIÓN
// ═══════════════════════════════════════════════════════════

function validateGrades(allGrades) {
  const fixes = [];

  for (const g of allGrades) {
    const turnoRubros = RUBROS[g.turno] || RUBROS.MATUTINO;
    const maxMap = {};
    for (const r of turnoRubros) maxMap[r.key] = r.max;

    // Validar cada rubro contra su máximo
    for (const key of ['ec', 'ex', 'tr', 'pe']) {
      if (g[key] != null && maxMap[key] != null) {
        if (g[key] > maxMap[key]) {
          fixes.push({ student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName, field: key, original: g[key], fixed: maxMap[key], reason: `${key} excede máximo ${maxMap[key]}` });
          g[key] = maxMap[key];
        }
        if (g[key] < 0) {
          fixes.push({ student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName, field: key, original: g[key], fixed: 0, reason: `${key} negativo` });
          g[key] = 0;
        }
        // Redondear a 1 decimal
        g[key] = Math.round(g[key] * 10) / 10;
      }
    }

    // Recalcular suma desde rubros validados (NO confiar en Excel)
    const rubroValues = {};
    for (const r of turnoRubros) {
      if (g[r.key] != null) rubroValues[r.key] = g[r.key];
    }
    const hasAnyRubro = Object.keys(rubroValues).length > 0;
    const recalcSuma = hasAnyRubro ? calcSuma(rubroValues) : null;

    // Comparar con suma del Excel
    if (g.sumaExcel != null && recalcSuma != null && Math.abs(g.sumaExcel - recalcSuma) > 0.15) {
      fixes.push({
        student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName,
        field: 'suma', original: g.sumaExcel, fixed: recalcSuma,
        reason: `Suma Excel (${g.sumaExcel}) difiere de recalculada (${recalcSuma})`
      });
    }
    g.suma = recalcSuma != null ? recalcSuma : (g.sumaExcel != null ? Math.min(g.sumaExcel, 10) : null);

    // Recalcular cal desde suma validada
    const recalcCal = g.suma != null ? calcCal(g.suma) : null;
    if (g.calExcel != null && recalcCal != null && g.calExcel !== recalcCal) {
      fixes.push({
        student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName,
        field: 'cal', original: g.calExcel, fixed: recalcCal,
        reason: `Cal Excel (${g.calExcel}) difiere de recalculada (${recalcCal}) desde suma=${g.suma}`
      });
    }
    g.cal = recalcCal != null ? recalcCal : g.calExcel;

    // Validación final de cal — NINGUNA calificación puede ser 0, mínimo es 5
    if (g.cal != null) {
      if (g.cal > 10) {
        fixes.push({ student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName, field: 'cal', original: g.cal, fixed: 10, reason: 'Cal > 10, capped' });
        g.cal = 10;
      }
      if (g.cal < 5) {
        fixes.push({ student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName, field: 'cal', original: g.cal, fixed: 5, reason: 'Cal < 5, mínimo EPO67 = 5 (incluye ceros)' });
        g.cal = 5;
      }
    }
    // Si calExcel era 0 pero cal quedó null (calcCal devuelve null para suma=0), forzar a 5
    if (g.cal == null && g.calExcel != null && g.calExcel === 0) {
      fixes.push({ student: g.studentFullName, grupo: g.groupKey, turno: g.turno, subject: g.subjectName, field: 'cal', original: 0, fixed: 5, reason: 'Cal era 0, mínimo EPO67 = 5' });
      g.cal = 5;
      if (g.suma == null) g.suma = 0;
    }

    // Faltas: entero, 0..99
    if (g.faltasExcel != null) {
      g.faltas = Math.max(0, Math.min(Math.round(g.faltasExcel), 99));
    } else {
      g.faltas = null;
    }
  }

  return fixes;
}

// ═══════════════════════════════════════════════════════════
// ETAPA 3: MATCHING DE ALUMNOS
// ═══════════════════════════════════════════════════════════

function normalize(str) {
  if (!str) return '';
  return str.toString().toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Levenshtein distance para errores tipográficos
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.85;

  // Ignorar preposiciones comunes
  const STOP = new Set(['DE', 'LA', 'LOS', 'DEL', 'LAS', 'EL']);
  const wordsA = a.split(' ').filter(w => w && !STOP.has(w));
  const wordsB = b.split(' ').filter(w => w && !STOP.has(w));

  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.some(wb => wb === w || (w.length > 3 && wb.startsWith(w.substring(0, 3))))) {
      matches++;
    }
  }
  const wordScore = matches / Math.max(wordsA.length, wordsB.length);

  // Levenshtein como complemento
  const maxLen = Math.max(a.length, b.length);
  const levScore = maxLen > 0 ? 1 - (levenshtein(a, b) / maxLen) : 0;

  return Math.max(wordScore, levScore);
}

// Subject matching (de migrate-grades.js con aliases)
const SUBJECT_ALIASES = {
  'DEERECHIS': 'DERECHOS', 'QUIMICAS': 'QUIMICAS', 'FILOSOFICO': 'FILOSOFICO',
  'INGLES 2': 'INGLES II', 'INGLES 1': 'INGLES I', 'INGLES 3': 'INGLES III',
  'INGLES 4': 'INGLES IV', 'INGLES 5': 'INGLES V', 'INGLES 6': 'INGLES VI',
};

const SUBJECT_PARTIAL_ALIASES = {
  'MANTENIMIENTO DE REDES': 'MANTENIMIENTO DE REDES DE COMPUTO',
  'ACTIVIDADES ARTISTICAS Y CULTURALES': 'ACTIVIDADES ARTISTICAS Y CULTURALES',
  'EDUCACION PARA LA SALUD': 'EDUCACION PARA LA SALUD',
};

function findSubject(subjectName, subjectMap) {
  const norm = normalize(subjectName);

  // Direct match
  if (subjectMap[norm]) return subjectMap[norm];

  // Apply aliases
  let aliased = norm;
  for (const [typo, fix] of Object.entries(SUBJECT_ALIASES)) {
    if (aliased.includes(typo)) aliased = aliased.replace(typo, fix);
  }
  if (aliased !== norm && subjectMap[aliased]) return subjectMap[aliased];

  // Partial alias
  for (const [partial, target] of Object.entries(SUBJECT_PARTIAL_ALIASES)) {
    if (norm.includes(partial) || aliased.includes(partial)) {
      for (const [key, subj] of Object.entries(subjectMap)) {
        if (key.includes(target)) return subj;
      }
    }
  }

  // Fuzzy
  let best = null, bestScore = 0;
  for (const [key, subj] of Object.entries(subjectMap)) {
    const s = Math.max(similarity(norm, key), similarity(aliased, key));
    if (s > bestScore) { bestScore = s; best = subj; }
  }
  return bestScore >= 0.65 ? best : null;
}

function findStudent(grade, studentsByGroup, studentsByGroupNP) {
  const groupKey = grade.turno + '_' + grade.groupKey;
  const candidates = studentsByGroup[groupKey] || [];
  if (candidates.length === 0) return { student: null, score: 0, method: 'no_candidates' };

  const excelName = normalize(grade.studentFullName);
  const normA1 = normalize(grade.apellido1);
  const normA2 = normalize(grade.apellido2);
  const normN  = normalize(grade.nombres);

  // 1. Exact match on full name
  for (const s of candidates) {
    if (normalize(s.nombreCompleto || '') === excelName) return { student: s, score: 1.0, method: 'exact_fullname' };
  }

  // 2. Exact match on components
  for (const s of candidates) {
    if (normalize(s.apellido1 || '') === normA1 && normalize(s.apellido2 || '') === normA2 && normalize(s.nombres || '') === normN) {
      return { student: s, score: 1.0, method: 'exact_components' };
    }
  }

  // 3. NP match (student number) with STRICT name verification
  //    Requires: apellido1 must match AND primer nombre must match or be substring
  if (grade.studentNum != null) {
    const npMap = studentsByGroupNP[groupKey] || {};
    const byNP = npMap[String(grade.studentNum)];
    if (byNP) {
      const npA1 = normalize(byNP.apellido1 || '');
      const npFirstName = normalize(byNP.nombres || '').split(' ')[0];
      const excelFirstName = normN.split(' ')[0];
      const a1Match = npA1 === normA1;
      const nameMatch = npFirstName && excelFirstName && (
        npFirstName === excelFirstName ||
        npFirstName.startsWith(excelFirstName) ||
        excelFirstName.startsWith(npFirstName)
      );
      if (a1Match && nameMatch) {
        const npScore = similarity(
          `${grade.apellido1} ${grade.apellido2} ${grade.nombres}`,
          `${byNP.apellido1 || ''} ${byNP.apellido2 || ''} ${byNP.nombres || ''}`
        );
        return { student: byNP, score: Math.max(npScore, 0.85), method: 'np_match' };
      }
    }
  }

  // 4. Match por apellidos exactos — acepta aunque el nombre difiera
  for (const s of candidates) {
    if (normA1 && normalize(s.apellido1 || '') === normA1 && normA2 && normalize(s.apellido2 || '') === normA2) {
      return { student: s, score: 0.85, method: 'apellidos_exact' };
    }
  }

  // 5. Fuzzy match
  let best = null, bestScore = 0;
  for (const s of candidates) {
    const s1 = similarity(`${grade.apellido1} ${grade.apellido2} ${grade.nombres}`, `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`);
    const s2 = similarity(excelName, normalize(s.nombreCompleto || ''));
    const score = Math.max(s1, s2);
    if (score > bestScore) { bestScore = score; best = s; }
  }

  if (bestScore >= STUDENT_MATCH_THRESHOLD) return { student: best, score: bestScore, method: 'fuzzy' };
  return { student: best, score: bestScore, method: 'below_threshold' };
}

// ═══════════════════════════════════════════════════════════
// FIRESTORE REST API
// ═══════════════════════════════════════════════════════════

function getToken() {
  try {
    return fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
  } catch (e) {
    console.error('ERROR: No se encontró /tmp/firebase-access-token.txt');
    console.error('Ejecuta: firebase login:ci y guarda el token en ese archivo');
    process.exit(1);
  }
}

function firestoreGet(token, collectionPath) {
  return new Promise((resolve, reject) => {
    const docs = [];
    function fetchPage(pageToken) {
      const qp = `?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
      const options = {
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}${qp}`,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token },
      };
      const req = https.request(options, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            if (parsed.documents) {
              for (const doc of parsed.documents) {
                const id = doc.name.split('/').pop();
                const fields = {};
                for (const [key, val] of Object.entries(doc.fields || {})) {
                  if (val.stringValue !== undefined) fields[key] = val.stringValue;
                  else if (val.integerValue !== undefined) fields[key] = parseInt(val.integerValue);
                  else if (val.doubleValue !== undefined) fields[key] = val.doubleValue;
                  else if (val.booleanValue !== undefined) fields[key] = val.booleanValue;
                  else fields[key] = null;
                }
                docs.push({ id, ...fields });
              }
            }
            if (parsed.nextPageToken) fetchPage(parsed.nextPageToken);
            else resolve(docs);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.end();
    }
    fetchPage('');
  });
}

function batchWrite(token, writes) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ writes });
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`,
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// ETAPA 4: MAIN — ORQUESTACIÓN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  MIGRACIÓN ROBUSTA DE CALIFICACIONES P1');
  console.log(`  Modo: ${DRY_RUN ? '🧪 DRY RUN (no escribe)' : '🔥 ESCRITURA REAL'}`);
  console.log('═══════════════════════════════════════════════════');

  // ─── ETAPA 1: Extracción ───
  console.log('\n📋 ETAPA 1: Extracción de XLSX...');
  const { allGrades, warnings: extractWarnings } = extractFromXLSX();

  // ─── ETAPA 2: Validación ───
  console.log('\n✅ ETAPA 2: Validación contra reglas EPO67...');
  const validationFixes = validateGrades(allGrades);
  console.log(`  Correcciones aplicadas: ${validationFixes.length}`);

  // Filtrar: solo calificaciones con datos útiles
  const gradesWithData = allGrades.filter(g => g.cal != null || g.suma != null);
  const gradesWithoutCal = allGrades.filter(g => g.cal == null && g.suma == null);
  console.log(`  Con calificación: ${gradesWithData.length}`);
  console.log(`  Sin calificación (filas vacías): ${gradesWithoutCal.length}`);

  // ─── ETAPA 3: Matching ───
  console.log('\n🔗 ETAPA 3: Matching con Firestore...');
  const token = getToken();

  console.log('  Descargando datos de Firestore...');
  const [students, groups, subjects, assignments] = await Promise.all([
    firestoreGet(token, 'students'),
    firestoreGet(token, 'groups'),
    firestoreGet(token, 'subjects'),
    firestoreGet(token, 'assignments'),
  ]);
  console.log(`  Students: ${students.length}, Groups: ${groups.length}, Subjects: ${subjects.length}, Assignments: ${assignments.length}`);

  // Build lookup maps
  const groupMap = {};
  groups.forEach(g => { groupMap[(g.turno || '') + '_' + (g.nombre || g.id)] = g.id; });

  const studentsByGroup = {};
  students.forEach(s => {
    const key = (s.turno || '') + '_' + (s.grupo || '');
    if (!studentsByGroup[key]) studentsByGroup[key] = [];
    studentsByGroup[key].push(s);
  });

  const studentsByGroupNP = {};
  students.forEach(s => {
    const key = (s.turno || '') + '_' + (s.grupo || '');
    if (!studentsByGroupNP[key]) studentsByGroupNP[key] = {};
    if (s.np != null) studentsByGroupNP[key][String(s.np)] = s;
  });

  const subjectMap = {};
  subjects.forEach(s => { subjectMap[normalize(s.nombre)] = s; });

  // Match cada calificación
  const matched = [];
  const unmatchedStudents = [];
  const unmatchedSubjects = new Set();
  const fuzzyMatches = [];
  let noGroup = 0, noSubject = 0, noStudent = 0;

  for (const g of gradesWithData) {
    // Find group
    const groupId = groupMap[g.turno + '_' + g.groupKey];
    if (!groupId) { noGroup++; continue; }

    // Find subject
    const subject = findSubject(g.subjectName, subjectMap);
    if (!subject) { noSubject++; unmatchedSubjects.add(g.subjectName); continue; }

    // Find student
    const result = findStudent(g, studentsByGroup, studentsByGroupNP);
    if (!result.student) {
      noStudent++;
      unmatchedStudents.push({
        name: g.studentFullName, turno: g.turno, group: g.groupKey,
        subject: g.subjectName, bestScore: result.score, method: result.method,
        bestMatch: result.student ? (result.student.nombreCompleto || '') : '',
      });
      continue;
    }

    if (result.score < 0.95) {
      fuzzyMatches.push({
        excelName: g.studentFullName,
        firestoreName: result.student.nombreCompleto || `${result.student.apellido1} ${result.student.apellido2} ${result.student.nombres}`,
        score: result.score.toFixed(3), method: result.method,
        turno: g.turno, group: g.groupKey,
      });
    }

    matched.push({ ...g, studentId: result.student.id, subjectId: subject.id, groupId, subjectNameFS: subject.nombre });
  }

  console.log(`\n  ✅ Matched: ${matched.length}`);
  console.log(`  ❌ Sin grupo: ${noGroup}`);
  console.log(`  ❌ Sin materia: ${noSubject}`);
  console.log(`  ❌ Sin alumno: ${noStudent}`);
  console.log(`  🔎 Fuzzy matches (revisar): ${fuzzyMatches.length}`);

  if (unmatchedSubjects.size > 0) {
    console.log('\n  Materias sin match:');
    unmatchedSubjects.forEach(s => console.log(`    - ${s}`));
  }

  if (unmatchedStudents.length > 0) {
    console.log(`\n  Alumnos sin match (muestra de ${Math.min(unmatchedStudents.length, 15)}):`);
    unmatchedStudents.slice(0, 15).forEach(s => console.log(`    - ${s.name} (${s.turno} ${s.group}) [score=${s.bestScore.toFixed(2)}, ${s.method}]`));
  }

  // Deduplicar (mismo alumno+materia+parcial)
  const seen = new Set();
  const deduped = [];
  for (const g of matched) {
    const key = `${g.studentId}_${g.subjectId}_P1`;
    if (!seen.has(key)) { seen.add(key); deduped.push(g); }
  }
  console.log(`\n  Documentos únicos a escribir: ${deduped.length} (${matched.length - deduped.length} duplicados removidos)`);

  // Estadísticas de cal
  const calValues = deduped.map(g => g.cal).filter(v => v != null);
  if (calValues.length > 0) {
    const avg = calValues.reduce((a, b) => a + b, 0) / calValues.length;
    const dist = { 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
    calValues.forEach(v => { if (dist[v] !== undefined) dist[v]++; });
    const outsideRange = calValues.filter(v => v < 5 || v > 10).length;

    console.log(`\n  Promedio cal: ${avg.toFixed(2)}`);
    console.log('  Distribución:');
    for (let v = 5; v <= 10; v++) {
      const pct = (dist[v] / calValues.length * 100).toFixed(1);
      console.log(`    ${v}: ${String(dist[v]).padStart(5)} (${pct.padStart(5)}%)`);
    }
    if (outsideRange > 0) console.log(`    FUERA DE RANGO (< 5 o > 10): ${outsideRange} ⚠️`);
  }

  // Muestra de 5 calificaciones para verificación visual
  console.log('\n  📝 Muestra de calificaciones (primeras 5):');
  deduped.slice(0, 5).forEach((g, i) => {
    console.log(`    ${i + 1}. ${g.studentFullName} | ${g.turno} ${g.groupKey} | ${g.subjectNameFS}`);
    console.log(`       ec=${g.ec} tr=${g.tr} ex=${g.ex} pe=${g.pe} → suma=${g.suma} → cal=${g.cal} | faltas=${g.faltas}`);
  });

  // ─── GENERAR REPORTE ───
  const report = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    stats: {
      totalExtracted: allGrades.length,
      withData: gradesWithData.length,
      matched: matched.length,
      deduped: deduped.length,
      noGroup, noSubject, noStudent,
      validationFixes: validationFixes.length,
    },
    validationFixes: validationFixes.slice(0, 200),
    unmatchedStudents,
    unmatchedSubjects: [...unmatchedSubjects],
    fuzzyMatches,
    extractWarnings,
    calDistribution: calValues.length > 0 ? (() => {
      const d = { 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, other: 0 };
      calValues.forEach(v => { if (d[v] !== undefined) d[v]++; else d.other++; });
      return d;
    })() : {},
  };

  const reportPath = path.join(__dirname, 'migration-report-P1.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  📄 Reporte guardado: ${reportPath}`);

  // ─── ETAPA 4: Escritura ───
  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN completado. No se escribió nada a Firestore.');
    console.log('   Revisa migration-report-P1.json y ejecuta sin --dry-run cuando estés listo.');
    return;
  }

  console.log(`\n🔥 ETAPA 4: Escribiendo ${deduped.length} calificaciones a Firestore...`);

  const writes = deduped.map(g => {
    const docId = `${g.studentId}_${g.subjectId}_P1`;
    const fields = {
      studentId: { stringValue: g.studentId },
      subjectId: { stringValue: g.subjectId },
      subjectName: { stringValue: g.subjectNameFS || g.subjectName },
      groupId: { stringValue: g.groupId },
      partial: { stringValue: 'P1' },
      turno: { stringValue: g.turno },
      grado: { integerValue: String(g.grado) },
      teacherName: { stringValue: g.teacherName || '' },
      source: { stringValue: 'migration_p1_v3' },
      importedAt: { timestampValue: new Date().toISOString() },
      updatedBy: { stringValue: 'migrate-p1.js' },
    };

    if (g.ec != null) fields.ec = { doubleValue: g.ec };
    if (g.tr != null) fields.tr = { doubleValue: g.tr };
    if (g.ex != null) fields.ex = { doubleValue: g.ex };
    if (g.pe != null) fields.pe = { doubleValue: g.pe };
    if (g.suma != null) fields.suma = { doubleValue: g.suma };
    if (g.cal != null) { fields.cal = { integerValue: String(g.cal) }; fields.value = { doubleValue: g.cal }; }
    if (g.faltas != null) fields.faltas = { integerValue: String(g.faltas) };

    return { update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/grades/${docId}`, fields } };
  });

  let written = 0, errors = 0;
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE);
    try {
      await batchWrite(token, batch);
      written += batch.length;
      process.stdout.write(`\r  Progreso: ${written}/${writes.length} (${Math.round(written / writes.length * 100)}%)`);
      if (i + BATCH_SIZE < writes.length) await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      if (err.message.includes('429')) {
        console.log('\n  ⏳ Rate limit, esperando 30s...');
        await new Promise(r => setTimeout(r, 30000));
        try { await batchWrite(token, batch); written += batch.length; } catch (e2) { errors += batch.length; }
      } else {
        console.error(`\n  ❌ Error en batch: ${err.message}`);
        errors += batch.length;
      }
    }
  }

  console.log(`\n\n  ✅ MIGRACIÓN COMPLETADA: ${written} escritos, ${errors} errores`);
}

main().catch(e => { console.error('\nError fatal:', e); process.exit(1); });
