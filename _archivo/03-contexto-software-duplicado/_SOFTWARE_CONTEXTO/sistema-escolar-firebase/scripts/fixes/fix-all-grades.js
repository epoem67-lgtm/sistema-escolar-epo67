#!/usr/bin/env node
/**
 * fix-all-grades.js — Corrección masiva de calificaciones P1
 *
 * 1. GRANADOS: Lee cal definitiva (col J) de su Excel, borra rubros, escribe solo cal
 * 2. TANIA: Lee cal definitiva (col K) de su Excel, borra rubros, escribe solo cal
 * 3. XIMENA: Migra 11 grades desde Excel 1-1 MATUTINO
 * 4. SEBASTIAN: Migra 11 grades desde Excel 1-1 VESPERTINO
 * 5. CLAUDIA 3-3 MAT: Migra grades de Actividades Artísticas III
 * 6. DANIA 2-3 VESP: Migra grades de Ciencias Sociales III
 *
 * Uso:
 *   node fix-all-grades.js --dry-run   (ver cambios sin escribir)
 *   node fix-all-grades.js             (escribir a Firestore)
 */

const XLSX = require('xlsx');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'epo67-sistema';
const DRY_RUN = process.argv.includes('--dry-run');
const BASE = path.resolve(__dirname, '..');

// New student IDs created earlier today
const NEW_STUDENTS = {
  'MUÑOZ MAGAÑA XIMENA': 'ogz7tnicaTZ4pURNOqAC',
  'PEÑA GONZALEZ SEBASTIAN': 'sbSirp3153ReLJLDtyIF',
};

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function cellVal(ws, ref) { const c = ws[ref]; return c && c.v != null ? c.v : null; }
function cellStr(ws, ref) { const v = cellVal(ws, ref); return v != null ? String(v).trim() : ''; }
function colLetter(idx) {
  let s = '', n = idx;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

function normalize(s) {
  return (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return null;
  if (suma === 0) return 5;
  const s = Math.min(suma, 10);
  if (s >= 6) return Math.min(Math.round(s), 10);
  return Math.max(5, Math.floor(s));
}

function getToken() {
  try { return fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim(); }
  catch { console.error('ERROR: Token no encontrado'); process.exit(1); }
}

// ═══════════════════════════════════════════════════════════
// FIRESTORE REST
// ═══════════════════════════════════════════════════════════

function firestoreGet(token, collection) {
  return new Promise((resolve, reject) => {
    const docs = [];
    function fetchPage(pageToken) {
      const qp = `?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
      const req = https.request({
        hostname: 'firestore.googleapis.com',
        path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}${qp}`,
        headers: { 'Authorization': 'Bearer ' + token }
      }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => {
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}: ${d.substring(0,200)}`)); return; }
          const body = JSON.parse(d);
          if (body.documents) {
            for (const doc of body.documents) {
              const id = doc.name.split('/').pop();
              const f = {};
              for (const [k, v] of Object.entries(doc.fields || {})) {
                if (v.stringValue !== undefined) f[k] = v.stringValue;
                else if (v.integerValue !== undefined) f[k] = Number(v.integerValue);
                else if (v.doubleValue !== undefined) f[k] = Number(v.doubleValue);
              }
              docs.push({ id, ...f });
            }
          }
          if (body.nextPageToken) fetchPage(body.nextPageToken);
          else resolve(docs);
        });
      });
      req.on('error', reject); req.end();
    }
    fetchPage(null);
  });
}

function firestorePatch(token, docPath, data) {
  return new Promise((resolve, reject) => {
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === null) fields[k] = { nullValue: null };
      else if (typeof v === 'string') fields[k] = { stringValue: v };
      else if (typeof v === 'number') {
        if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
        else fields[k] = { doubleValue: v };
      }
    }
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/grades/${encodeURIComponent(docPath)}`,
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        if (res.statusCode === 200) resolve('OK');
        else reject(new Error(`HTTP ${res.statusCode}: ${d.substring(0,200)}`));
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// EXTRACT CAL DEFINITIVA FROM EXCEL
// ═══════════════════════════════════════════════════════════

function extractCalDefinitiva(xlsxPath, calColLetter) {
  const wb = XLSX.readFile(xlsxPath, { cellFormula: false });
  const results = [];

  for (const sheetName of wb.SheetNames) {
    if (/^(hoja\s*\d+|sheet\s*\d+)$/i.test(sheetName.trim())) continue;
    const ws = wb.Sheets[sheetName];

    const subject = cellStr(ws, 'B14').toUpperCase();
    const grado = cellVal(ws, 'B15');
    let grupo = cellVal(ws, 'D15');
    if (grupo != null) grupo = parseInt(String(grupo), 10);
    const gradoNum = grado ? parseInt(String(grado).match(/(\d)/)?.[1] || '0') : 0;

    if (!gradoNum || !grupo) continue;

    const turnoFromSubject = sheetName;

    for (let row = 17; row <= 200; row++) {
      const numVal = cellVal(ws, 'A' + row);
      if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;

      const apellido1 = cellStr(ws, 'B' + row).toUpperCase();
      const apellido2 = cellStr(ws, 'C' + row).toUpperCase();
      const nombres = cellStr(ws, 'D' + row).toUpperCase();
      const fullName = [apellido1, apellido2, nombres].filter(Boolean).join(' ');

      // Check if BAJA
      const eCol = cellStr(ws, 'E' + row).toUpperCase();
      if (eCol === 'BAJA') continue;

      let cal = cellVal(ws, calColLetter + row);
      if (cal !== null && typeof cal === 'number') {
        // Normalize if over 10 (100 scale)
        if (cal > 10) cal = Math.round(cal / 10);
        cal = Math.min(Math.max(Math.round(cal), 0), 10);
        // Apply EPO67 rule: min 5 if has any data
        if (cal === 0) cal = 5;
      } else {
        cal = 5; // Sin calificación = reprobado = 5
      }

      const faltas = cellVal(ws, calColLetter === 'J' ? 'I' + row : 'J' + row);

      results.push({
        subject, grado: gradoNum, grupo, sheetName,
        fullName, apellido1, apellido2, nombres,
        cal,
        faltas: faltas !== null && !isNaN(parseInt(faltas)) ? parseInt(faltas) : 0
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// EXTRACT FULL GRADES FROM F1 EXCEL (for missing students)
// ═══════════════════════════════════════════════════════════

function extractF1Grades(xlsxPath, turno) {
  const wb = XLSX.readFile(xlsxPath, { cellFormula: false });
  const results = [];
  const RUBROS_MAT = [{ key: 'ec', max: 8 }, { key: 'tr', max: 2 }, { key: 'pe', max: 10 }];
  const RUBROS_VESP = [{ key: 'ec', max: 5 }, { key: 'ex', max: 3 }, { key: 'tr', max: 2 }, { key: 'pe', max: 10 }];
  const rubros = turno === 'MATUTINO' ? RUBROS_MAT : RUBROS_VESP;

  for (const sheetName of wb.SheetNames) {
    if (/^(hoja\s*\d+|sheet\s*\d+)$/i.test(sheetName.trim())) continue;
    const ws = wb.Sheets[sheetName];

    const subject = cellStr(ws, 'B14').toUpperCase();
    const grado = cellVal(ws, 'B15');
    let grupo = cellVal(ws, 'D15');
    if (grupo != null) grupo = parseInt(String(grupo), 10);
    const gradoNum = grado ? parseInt(String(grado).match(/(\d)/)?.[1] || '0') : 0;

    // Detect columns
    let sumaCol = null, faltasCol = null, calCol = null;
    for (let c = 0; c < 20; c++) {
      const h = cellStr(ws, colLetter(c) + '16').toLowerCase();
      if (h.includes('suma') && sumaCol === null) sumaCol = c;
      if (h.includes('falta')) faltasCol = c;
      if (h.includes('calificaci') && calCol === null) calCol = c;
    }
    if (faltasCol === null && sumaCol !== null) faltasCol = sumaCol + 1;

    const rubroStartCol = 4; // Column E
    const rubroCount = sumaCol !== null ? sumaCol - rubroStartCol : 0;

    // Detect scale
    const rawCals = [];
    for (let r = 17; r <= 100; r++) {
      const n = cellVal(ws, 'A' + r);
      if (n == null || typeof n !== 'number' || n !== (r - 16)) break;
      const c = calCol !== null ? cellVal(ws, colLetter(calCol) + r) : null;
      if (c != null && typeof c === 'number' && c > 0) rawCals.push(c);
    }
    const over10 = rawCals.filter(v => v > 10).length;
    const is100Scale = rawCals.length > 0 && (over10 / rawCals.length) > 0.5;

    for (let row = 17; row <= 200; row++) {
      const numVal = cellVal(ws, 'A' + row);
      if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;

      const apellido1 = cellStr(ws, 'B' + row).toUpperCase();
      const apellido2 = cellStr(ws, 'C' + row).toUpperCase();
      const nombres = cellStr(ws, 'D' + row).toUpperCase();
      const fullName = [apellido1, apellido2, nombres].filter(Boolean).join(' ');
      if (cellStr(ws, 'E' + row).toUpperCase() === 'BAJA') continue;

      const gradeData = { ec: null, ex: null, tr: null, pe: null };
      if (rubroCount > 0) {
        const mapping = rubroCount === 3 ?
          [{ key: 'ec', col: rubroStartCol }, { key: 'tr', col: rubroStartCol + 1 }, { key: 'pe', col: rubroStartCol + 2 }] :
          [{ key: 'ec', col: rubroStartCol }, { key: 'ex', col: rubroStartCol + 1 }, { key: 'tr', col: rubroStartCol + 2 }, { key: 'pe', col: rubroStartCol + 3 }];
        for (const { key, col } of mapping) {
          const raw = cellVal(ws, colLetter(col) + row);
          let val = (raw != null && !isNaN(parseFloat(raw))) ? parseFloat(raw) : null;
          if (val !== null) {
            const maxVal = rubros.find(r => r.key === key)?.max || 10;
            val = Math.min(Math.max(0, val), maxVal);
            val = Math.round(val * 10) / 10;
          }
          gradeData[key] = val;
        }
      }

      // Suma: recalculate
      const rubroVals = Object.values(gradeData).filter(v => v !== null);
      const suma = rubroVals.length > 0 ? Math.min(Math.round(rubroVals.reduce((a, b) => a + b, 0) * 10) / 10, 10) : 0;

      // Cal: use Excel value if available, else calculate
      let calRaw = calCol !== null ? cellVal(ws, colLetter(calCol) + row) : null;
      if (calRaw != null && typeof calRaw === 'number') {
        if (is100Scale && calRaw > 10) calRaw = Math.round(calRaw / 10);
        calRaw = Math.min(Math.max(Math.round(calRaw), 0), 10);
      } else {
        calRaw = calcCal(suma);
      }
      if (calRaw === 0 || calRaw === null) calRaw = 5;

      let faltas = faltasCol !== null ? cellVal(ws, colLetter(faltasCol) + row) : null;
      faltas = (faltas !== null && !isNaN(parseInt(faltas))) ? parseInt(faltas) : 0;

      results.push({
        subject, grado: gradoNum, grupo, sheetName, turno,
        fullName, apellido1, apellido2, nombres,
        ...gradeData, suma, cal: calRaw, faltas
      });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════
// NORMALIZE SUBJECT NAME (from migrate-p1.js)
// ═══════════════════════════════════════════════════════════

function normalizeSubject(raw) {
  return raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function makeSubjectId(grado, subjectName) {
  return 'G' + grado + '_' + normalizeSubject(subjectName);
}

// ═══════════════════════════════════════════════════════════
// MATCH STUDENT
// ═══════════════════════════════════════════════════════════

function findStudent(students, fullName, apellido1, apellido2, nombres, groupId) {
  const candidates = students.filter(s => s.groupId === groupId && s.estatus === 'ACTIVO');
  const norm = normalize(fullName);

  // Exact full name
  for (const s of candidates) {
    if (normalize(s.nombreCompleto) === norm) return s;
  }

  // Apellidos + partial name
  const normA1 = normalize(apellido1);
  const normA2 = normalize(apellido2);
  for (const s of candidates) {
    if (normalize(s.apellido1 || '') === normA1 && normalize(s.apellido2 || '') === normA2) {
      // Check if nombres overlap at all
      const normN = normalize(nombres);
      const studentN = normalize(s.nombres || '');
      if (normN === studentN || normN.includes(studentN) || studentN.includes(normN)) return s;
    }
  }

  // Apellidos only (last resort)
  for (const s of candidates) {
    if (normalize(s.apellido1 || '') === normA1 && normalize(s.apellido2 || '') === normA2) return s;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  const token = getToken();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(` CORRECCIÓN MASIVA P1 — ${DRY_RUN ? 'DRY RUN' : 'ESCRITURA REAL'}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Fetch Firestore data
  console.log('Descargando Firestore...');
  const [students, subjects, grades] = await Promise.all([
    firestoreGet(token, 'students'),
    firestoreGet(token, 'subjects'),
    firestoreGet(token, 'grades')
  ]);
  console.log(`  Students: ${students.length}, Subjects: ${subjects.length}, Grades: ${grades.length}`);

  // Build subject ID lookup
  const subjectIdMap = {};
  subjects.forEach(s => { subjectIdMap[normalize(s.nombre || s.name || s.id)] = s.id; });

  // Build grade existence lookup
  const existingGrades = new Set();
  grades.forEach(g => existingGrades.add(g.id));

  let written = 0, errors = 0, skipped = 0;

  // ═══════════════════════════════════════════════════════════
  // TASK 1: GRANADOS — solo cal definitiva, borrar rubros
  // ═══════════════════════════════════════════════════════════

  console.log('\n═══ TASK 1: GUADALUPE GRANADOS ═══\n');
  const granadosPath = path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE MATUTINO/GUADALUPE GRANADOS/GUADALUPE GRANADOS TM.xlsx');
  const granadosData = extractCalDefinitiva(granadosPath, 'J');
  console.log(`  Extraídas: ${granadosData.length} calificaciones\n`);

  for (const row of granadosData) {
    const groupId = `MATUTINO_${row.grado}-${row.grupo}`;
    const student = findStudent(students, row.fullName, row.apellido1, row.apellido2, row.nombres, groupId);
    if (!student) {
      console.log(`  SKIP sin match: ${row.fullName} (${groupId})`);
      skipped++;
      continue;
    }

    const subjectId = makeSubjectId(row.grado, row.subject);
    const docId = `${student.id}_${subjectId}_P1`;

    const data = {
      studentId: student.id,
      subjectId,
      groupId,
      partial: 'P1',
      cal: row.cal,
      value: row.cal,
      faltas: row.faltas,
      updatedBy: 'fix-all-grades.js',
      source: 'fix_granados_cal_only'
    };

    if (DRY_RUN) {
      console.log(`  [DRY] ${student.nombreCompleto} | ${row.subject.substring(0,30)} | cal=${row.cal}`);
    } else {
      try {
        await firestorePatch(token, docId, data);
        written++;
      } catch (e) {
        console.log(`  ERR ${docId}: ${e.message}`);
        errors++;
      }
    }
  }
  console.log(`  GRANADOS: ${DRY_RUN ? granadosData.length + ' registros' : written + ' escritos'}`);

  // ═══════════════════════════════════════════════════════════
  // TASK 2: TANIA — solo cal definitiva, borrar rubros
  // ═══════════════════════════════════════════════════════════

  console.log('\n═══ TASK 2: TANIA ═══\n');
  const taniaPath = path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE VESPERTINO/TANIA/TANIA TV.xlsx');
  const taniaData = extractCalDefinitiva(taniaPath, 'K');
  console.log(`  Extraídas: ${taniaData.length} calificaciones\n`);

  const taniaWritten = written;
  for (const row of taniaData) {
    const groupId = `VESPERTINO_${row.grado}-${row.grupo}`;
    const student = findStudent(students, row.fullName, row.apellido1, row.apellido2, row.nombres, groupId);
    if (!student) {
      console.log(`  SKIP sin match: ${row.fullName} (${groupId})`);
      skipped++;
      continue;
    }

    const subjectId = makeSubjectId(row.grado, row.subject);
    const docId = `${student.id}_${subjectId}_P1`;

    const data = {
      studentId: student.id,
      subjectId,
      groupId,
      partial: 'P1',
      cal: row.cal,
      value: row.cal,
      faltas: row.faltas,
      updatedBy: 'fix-all-grades.js',
      source: 'fix_tania_cal_only'
    };

    if (DRY_RUN) {
      console.log(`  [DRY] ${student.nombreCompleto} | ${row.subject.substring(0,30)} | cal=${row.cal}`);
    } else {
      try {
        await firestorePatch(token, docId, data);
        written++;
      } catch (e) {
        console.log(`  ERR ${docId}: ${e.message}`);
        errors++;
      }
    }
  }
  console.log(`  TANIA: ${DRY_RUN ? taniaData.length + ' registros' : (written - taniaWritten) + ' escritos'}`);

  // ═══════════════════════════════════════════════════════════
  // TASK 3 & 4: XIMENA y SEBASTIAN — buscar en archivos por docente
  // ═══════════════════════════════════════════════════════════

  const missingStudents = [
    { name: 'MUÑOZ MAGAÑA XIMENA', id: NEW_STUDENTS['MUÑOZ MAGAÑA XIMENA'], turno: 'MATUTINO', ap1: 'MUÑOZ', ap2: 'MAGAÑA', nom: 'XIMENA' },
    { name: 'PEÑA GONZALEZ SEBASTIAN', id: NEW_STUDENTS['PEÑA GONZALEZ SEBASTIAN'], turno: 'VESPERTINO', ap1: 'PEÑA', ap2: 'GONZALEZ', nom: 'SEBASTIAN' },
  ];

  const docenteFolders = [
    { turno: 'MATUTINO', folder: path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE MATUTINO') },
    { turno: 'VESPERTINO', folder: path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE VESPERTINO') },
  ];

  for (const ms of missingStudents) {
    console.log(`\n═══ TASK: ${ms.name} ═══\n`);
    const msWritten = written;
    const targetFolder = docenteFolders.find(f => f.turno === ms.turno);
    if (!targetFolder || !fs.existsSync(targetFolder.folder)) {
      console.log(`  ERROR: Carpeta no encontrada para ${ms.turno}`);
      continue;
    }

    const teacherDirs = fs.readdirSync(targetFolder.folder, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const tDir of teacherDirs) {
      const tPath = path.join(targetFolder.folder, tDir.name);
      const xlsxFiles = fs.readdirSync(tPath).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));

      for (const xlsxFile of xlsxFiles) {
        let wb;
        try { wb = XLSX.readFile(path.join(tPath, xlsxFile), { cellFormula: false }); } catch { continue; }

        for (const sheetName of wb.SheetNames) {
          if (/^(hoja\s*\d+|sheet\s*\d+)$/i.test(sheetName.trim())) continue;
          const ws = wb.Sheets[sheetName];

          const subjectRaw = cellStr(ws, 'B14').toUpperCase();
          const grado = cellVal(ws, 'B15');
          let grupo = cellVal(ws, 'D15');
          if (grupo != null) grupo = parseInt(String(grupo), 10);
          const gradoNum = grado ? parseInt(String(grado).match(/(\d)/)?.[1] || '0') : 0;
          if (!gradoNum || !grupo) continue;

          // Detect partial
          let partial = null;
          for (const c of 'ABCDEFGH'.split('')) {
            const v = cellStr(ws, c + '11').toUpperCase();
            if (v.includes('PRIMER') || v.includes('1ER') || v.includes('1°')) { partial = 'P1'; break; }
          }
          if (!partial) {
            for (const c of 'ABCDEFGH'.split('')) {
              const v = cellStr(ws, c + '10').toUpperCase();
              if (v.includes('PRIMER') || v.includes('1ER') || v.includes('1°')) { partial = 'P1'; break; }
            }
          }
          if (partial && partial !== 'P1') continue;
          if (!partial) partial = 'P1';

          // Detect columns
          let sumaCol = null, faltasCol = null, calCol = null;
          for (let c = 0; c < 20; c++) {
            const h = cellStr(ws, colLetter(c) + '16').toLowerCase();
            if (h.includes('suma') && sumaCol === null) sumaCol = c;
            if (h.includes('falta')) faltasCol = c;
            if (h.includes('calificaci') && calCol === null) calCol = c;
          }
          if (faltasCol === null && sumaCol !== null) faltasCol = sumaCol + 1;

          const rubroStartCol = 4;
          const rubroCount = sumaCol !== null ? sumaCol - rubroStartCol : 0;
          const isVesp = ms.turno === 'VESPERTINO';

          // Scale detection
          const rawCals = [];
          for (let r = 17; r <= 100; r++) {
            const n = cellVal(ws, 'A' + r);
            if (n == null || typeof n !== 'number' || n !== (r - 16)) break;
            const cv = calCol !== null ? cellVal(ws, colLetter(calCol) + r) : null;
            if (cv != null && typeof cv === 'number' && cv > 0) rawCals.push(cv);
          }
          const over10 = rawCals.filter(v => v > 10).length;
          const is100Scale = rawCals.length > 0 && (over10 / rawCals.length) > 0.5;

          // Search for this student
          for (let row = 17; row <= 200; row++) {
            const numVal = cellVal(ws, 'A' + row);
            if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;

            const a1 = cellStr(ws, 'B' + row).toUpperCase();
            const a2 = cellStr(ws, 'C' + row).toUpperCase();
            const nom = cellStr(ws, 'D' + row).toUpperCase();
            if (a1 !== ms.ap1 || a2 !== ms.ap2 || !nom.includes(ms.nom)) continue;

            // Found! Extract grades
            const groupId = `${ms.turno}_${gradoNum}-${grupo}`;
            const subjectId = makeSubjectId(gradoNum, subjectRaw);
            const docId = `${ms.id}_${subjectId}_P1`;

            // Rubros
            const gradeData = {};
            if (rubroCount > 0) {
              const rubrosMap = rubroCount === 3 ?
                [{ key: 'ec', col: rubroStartCol, max: 8 }, { key: 'tr', col: rubroStartCol + 1, max: 2 }, { key: 'pe', col: rubroStartCol + 2, max: 10 }] :
                [{ key: 'ec', col: rubroStartCol, max: isVesp ? 5 : 8 }, { key: 'ex', col: rubroStartCol + 1, max: 3 }, { key: 'tr', col: rubroStartCol + 2, max: 2 }, { key: 'pe', col: rubroStartCol + 3, max: 10 }];
              for (const { key, col, max } of rubrosMap) {
                const raw = cellVal(ws, colLetter(col) + row);
                if (raw != null && !isNaN(parseFloat(raw))) {
                  gradeData[key] = Math.min(Math.max(0, parseFloat(raw)), max);
                  gradeData[key] = Math.round(gradeData[key] * 10) / 10;
                }
              }
            }

            // Suma
            const rubroVals = Object.values(gradeData).filter(v => typeof v === 'number');
            const suma = rubroVals.length > 0 ? Math.min(Math.round(rubroVals.reduce((a, b) => a + b, 0) * 10) / 10, 10) : 0;

            // Cal
            let cal = calCol !== null ? cellVal(ws, colLetter(calCol) + row) : null;
            if (cal != null && typeof cal === 'number') {
              if (is100Scale && cal > 10) cal = Math.round(cal / 10);
              cal = Math.min(Math.max(Math.round(cal), 0), 10);
            } else {
              cal = calcCal(suma);
            }
            if (cal === 0 || cal === null) cal = 5;

            let faltas = faltasCol !== null ? cellVal(ws, colLetter(faltasCol) + row) : null;
            faltas = (faltas !== null && !isNaN(parseInt(faltas))) ? parseInt(faltas) : 0;

            const data = {
              studentId: ms.id,
              subjectId, groupId,
              partial: 'P1',
              ...gradeData,
              suma, cal, value: cal, faltas,
              updatedBy: 'fix-all-grades.js',
              source: `migration_${ms.nom.toLowerCase()}`
            };

            if (DRY_RUN) {
              console.log(`  [DRY] ${subjectRaw.substring(0,40)} | cal=${cal} | suma=${suma}`);
            } else {
              try {
                await firestorePatch(token, docId, data);
                written++;
              } catch (e) {
                console.log(`  ERR ${docId}: ${e.message}`);
                errors++;
              }
            }
          }
        }
      }
    }
    console.log(`  ${ms.name}: ${DRY_RUN ? '(dry run)' : (written - msWritten) + ' escritos'}`);
  }

  // ═══════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(60)}`);
  console.log(` RESUMEN`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Modo: ${DRY_RUN ? 'DRY RUN (sin escribir)' : 'ESCRITURA REAL'}`);
  console.log(`  Escritos: ${written}`);
  console.log(`  Errores: ${errors}`);
  console.log(`  Saltados (sin match): ${skipped}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
