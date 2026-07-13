/**
 * extract-grades.js
 * Reads all Excel grade files from TURNO MATUTINO and TURNO VESPERTINO folder trees,
 * extracts student grades including rubros (ec, ex, tr, pe), suma, faltas, and cal,
 * and outputs a consolidated JSON file.
 *
 * Column detection logic:
 *   - Scan row 16 for "suma" to find the Suma column
 *   - Rubros = columns E..(sumaCol-1)
 *   - MATUTINO (3 rubros): ec, tr, pe
 *   - VESPERTINO (4 rubros): ec, ex, tr, pe
 *   - Faltas = sumaCol+1 or column containing "falta" in row 16
 *   - Cal Definitiva = last (rightmost) column containing "calificaci" in row 16
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');

const SOURCES = [
  {
    turno: 'MATUTINO',
    folder: path.join(BASE, 'TURNO MATUTINO', 'LISTAS POR DOCENTE MATUTINO'),
  },
  {
    turno: 'VESPERTINO',
    folder: path.join(BASE, 'TURNO VESPERTINO', 'LISTAS POR DOCENTE TV'),
  },
];

const SKIP_SHEETS = /^(hoja\s*\d+|sheet\s*\d+)$/i;

// ---------- Subject name normalization ----------

const SUBJECT_TYPO_MAP = {
  'DEERECHIS': 'DERECHOS',
  'QUIMICAS': 'QUÍMICAS',
  'FILOSOFICO': 'FILOSÓFICO',
};

const SUBJECT_REPLACEMENTS = [
  [/INGLES\s+2\b/i, 'INGLÉS II'],
  [/INGLES\s+1\b/i, 'INGLÉS I'],
  [/INGLES\s+3\b/i, 'INGLÉS III'],
  [/INGLES\s+4\b/i, 'INGLÉS IV'],
  [/INGLES\s+5\b/i, 'INGLÉS V'],
  [/INGLES\s+6\b/i, 'INGLÉS VI'],
];

function normalizeSubjectName(raw) {
  let name = raw.toUpperCase().replace(/\s+/g, ' ').trim();

  // Apply typo corrections word by word
  for (const [typo, fix] of Object.entries(SUBJECT_TYPO_MAP)) {
    const re = new RegExp('\\b' + typo + '\\b', 'gi');
    name = name.replace(re, fix);
  }

  // Apply regex replacements
  for (const [pattern, replacement] of SUBJECT_REPLACEMENTS) {
    name = name.replace(pattern, replacement);
  }

  // Normalize accents for common words that should have them
  name = name
    .replace(/\bFILOSOFICO\b/g, 'FILOSÓFICO')
    .replace(/\bQUIMICAS\b/g, 'QUÍMICAS')
    .replace(/\bQUIMICA\b/g, 'QUÍMICA')
    .replace(/\bBIOLOGIA\b/g, 'BIOLOGÍA')
    .replace(/\bMATEMATICAS\b/g, 'MATEMÁTICAS')
    .replace(/\bINGLES\b/g, 'INGLÉS')
    .replace(/\bFISICA\b/g, 'FÍSICA')
    .replace(/\bETICA\b/g, 'ÉTICA')
    .replace(/\bINFORMATICA\b/g, 'INFORMÁTICA')
    .replace(/\bADMINISTRACION\b/g, 'ADMINISTRACIÓN')
    .replace(/\bECONOMIA\b/g, 'ECONOMÍA')
    .replace(/\bSOCIOLOGIA\b/g, 'SOCIOLOGÍA')
    .replace(/\bPSICOLOGIA\b/g, 'PSICOLOGÍA')
    .replace(/\bGEOGRAFIA\b/g, 'GEOGRAFÍA')
    .replace(/\bFILOSOFIA\b/g, 'FILOSOFÍA')
    .replace(/\bLITERATURA\b/g, 'LITERATURA')
    .replace(/\bECOLOGIA\b/g, 'ECOLOGÍA');

  return name;
}

// ---------- Utility helpers ----------

function parsePartial(val) {
  if (!val || typeof val !== 'string') return null;
  const upper = val.toUpperCase();
  if (upper.includes('PRIMER') || upper.includes('1ER') || upper.includes('1°')) return 'P1';
  if (upper.includes('SEGUNDO') || upper.includes('2DO') || upper.includes('2°')) return 'P2';
  if (upper.includes('TERCER') || upper.includes('3ER') || upper.includes('3°')) return 'P3';
  if (upper.includes('PARCIAL')) return 'P1'; // fallback
  return null;
}

function parseGrado(val) {
  if (val == null) return null;
  const s = String(val).trim();
  const m = s.match(/(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function cellVal(ws, ref) {
  const cell = ws[ref];
  if (!cell) return null;
  return cell.v != null ? cell.v : null;
}

function cellStr(ws, ref) {
  const v = cellVal(ws, ref);
  if (v == null) return '';
  return String(v).trim();
}

/** Convert 0-based column index to Excel column letter(s) */
function colLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Convert Excel column letter(s) to 0-based index */
function colIndex(letter) {
  let idx = 0;
  for (let i = 0; i < letter.length; i++) {
    idx = idx * 26 + (letter.charCodeAt(i) - 64);
  }
  return idx - 1; // 0-based
}

// ---------- Column detection ----------

/**
 * Scan row 16 and return an object with detected column positions.
 */
function detectColumns(ws) {
  const result = {
    sumaCol: null,       // 0-based index of Suma column
    faltasCol: null,     // 0-based index of Faltas column
    calCol: null,        // 0-based index of (last) Calificación Definitiva column
    rubroStartCol: 4,    // E = index 4 (columns A-D are student info)
    rubroEndCol: null,   // exclusive end (= sumaCol)
    rubroCount: 0,
  };

  // Scan columns A through Z (0..25) on row 16
  const maxCol = 26;
  let lastCalCol = null;

  for (let c = 0; c < maxCol; c++) {
    const ref = colLetter(c) + '16';
    const v = cellStr(ws, ref).toLowerCase();
    if (!v) continue;

    if (v.includes('suma') && result.sumaCol === null) {
      result.sumaCol = c;
    }
    if (v.includes('falta')) {
      result.faltasCol = c;
    }
    if (v.includes('calificaci')) {
      lastCalCol = c; // keep updating to get the rightmost one
    }
  }

  result.calCol = lastCalCol;

  if (result.sumaCol !== null) {
    result.rubroEndCol = result.sumaCol;
    result.rubroCount = result.rubroEndCol - result.rubroStartCol;
  }

  // If faltas not found by text, assume sumaCol + 1
  if (result.faltasCol === null && result.sumaCol !== null) {
    result.faltasCol = result.sumaCol + 1;
  }

  return result;
}

/**
 * Map rubro columns to named keys based on turno and count.
 * MATUTINO (3 rubros): ec, tr, pe
 * VESPERTINO (4 rubros): ec, ex, tr, pe
 * Returns array of { key, colIdx } or null if unrecognized count.
 */
function mapRubros(turno, rubroStartCol, rubroCount) {
  if (turno === 'MATUTINO' && rubroCount === 3) {
    return [
      { key: 'ec', colIdx: rubroStartCol },
      { key: 'tr', colIdx: rubroStartCol + 1 },
      { key: 'pe', colIdx: rubroStartCol + 2 },
    ];
  }
  if (turno === 'VESPERTINO' && rubroCount === 4) {
    return [
      { key: 'ec', colIdx: rubroStartCol },
      { key: 'ex', colIdx: rubroStartCol + 1 },
      { key: 'tr', colIdx: rubroStartCol + 2 },
      { key: 'pe', colIdx: rubroStartCol + 3 },
    ];
  }
  // Fallback: try to handle unexpected counts
  if (rubroCount === 3) {
    return [
      { key: 'ec', colIdx: rubroStartCol },
      { key: 'tr', colIdx: rubroStartCol + 1 },
      { key: 'pe', colIdx: rubroStartCol + 2 },
    ];
  }
  if (rubroCount === 4) {
    return [
      { key: 'ec', colIdx: rubroStartCol },
      { key: 'ex', colIdx: rubroStartCol + 1 },
      { key: 'tr', colIdx: rubroStartCol + 2 },
      { key: 'pe', colIdx: rubroStartCol + 3 },
    ];
  }
  return null; // unrecognized
}

// ---------- Grade normalization ----------

/**
 * Determine if a sheet uses 0-100 scale by checking if most cal values are > 10.
 * Returns true if it's a 0-100 scale sheet.
 */
function detectScale(rawCalValues) {
  if (rawCalValues.length === 0) return false;
  const over10 = rawCalValues.filter(v => v > 10).length;
  const ratio = over10 / rawCalValues.length;
  return ratio > 0.5; // if more than half are > 10, it's 0-100 scale
}

/**
 * Normalize a single grade value given the detected scale.
 * Returns { value, warning } where warning is a string or null.
 */
function normalizeGrade(val, is100Scale) {
  if (val == null || val === '' || typeof val === 'string') return { value: null, warning: null };
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num)) return { value: null, warning: null };

  if (num < 0) {
    return { value: null, warning: `Negative value: ${num}` };
  }
  if (num > 100) {
    return { value: null, warning: `Value > 100: ${num}, likely error` };
  }

  if (is100Scale) {
    // All values on this sheet are 0-100 scale, divide by 10
    if (num > 10) {
      const normalized = Math.round((num / 10) * 10) / 10;
      return { value: Math.min(normalized, 10), warning: null };
    }
    // Values <= 10 on a 100-scale sheet: keep as-is (could be already normalized or low score)
    return { value: num, warning: null };
  }

  // 0-10 scale sheet
  if (num > 10) {
    return { value: null, warning: `Value ${num} > 10 on a 0-10 scale sheet, flagged as error` };
  }
  return { value: num, warning: null };
}

/**
 * Normalize a rubro value (these are sub-scores, not on 0-10 necessarily).
 * We keep them as-is since they have varying max values (2, 3, 5, 8, etc.).
 */
function normalizeRubroValue(val) {
  if (val == null || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return null;
  return num;
}

// ---------- Sheet processing ----------

function processSheet(ws, sheetName, teacherFolder, turno) {
  const grades = [];
  const warnings = [];

  // Detect partial from row 11
  let partial = null;
  for (const c of 'ABCDEFGH'.split('')) {
    partial = parsePartial(cellStr(ws, c + '11'));
    if (partial) break;
  }
  // Fallback: try row 10
  if (!partial) {
    for (const c of 'ABCDEFGH'.split('')) {
      partial = parsePartial(cellStr(ws, c + '10'));
      if (partial) break;
    }
  }
  if (!partial) {
    partial = 'P1'; // last resort default
  }

  // Teacher name from C13
  let teacherName = cellStr(ws, 'C13');
  if (!teacherName) {
    teacherName = teacherFolder;
  }

  // Subject from B14
  const rawSubject = cellStr(ws, 'B14') || sheetName.toUpperCase();
  const subjectName = normalizeSubjectName(rawSubject);

  // Grado from B15
  const grado = parseGrado(cellStr(ws, 'B15'));

  // Grupo from D15
  let grupo = cellVal(ws, 'D15');
  if (grupo != null) grupo = parseInt(String(grupo), 10);

  if (!grado || !grupo) {
    return { grades, warnings: [`Skipped sheet "${sheetName}": no grado/grupo detected`] };
  }

  const groupKey = grado + '-' + grupo;

  // Detect column layout
  const cols = detectColumns(ws);

  if (cols.calCol === null) {
    warnings.push(`No "Calificación Definitiva" column found in sheet "${sheetName}"`);
    return { grades, warnings };
  }

  // Map rubros
  let rubroMapping = null;
  let rubroDetected = false;
  if (cols.sumaCol !== null && cols.rubroCount > 0) {
    rubroMapping = mapRubros(turno, cols.rubroStartCol, cols.rubroCount);
    if (rubroMapping) {
      rubroDetected = true;
    } else {
      warnings.push(`Unexpected rubro count ${cols.rubroCount} for ${turno} in sheet "${sheetName}"`);
    }
  }

  // First pass: collect raw cal values to detect scale
  const rawCalValues = [];
  for (let row = 17; row <= 200; row++) {
    const numVal = cellVal(ws, 'A' + row);
    if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) {
      break;
    }
    const calRaw = cellVal(ws, colLetter(cols.calCol) + row);
    if (calRaw != null && typeof calRaw === 'number' && calRaw > 0) {
      rawCalValues.push(calRaw);
    }
  }

  const is100Scale = detectScale(rawCalValues);
  if (is100Scale) {
    warnings.push(`Sheet "${sheetName}" detected as 0-100 scale, normalizing to 0-10`);
  }

  // Second pass: extract all data
  for (let row = 17; row <= 200; row++) {
    const numVal = cellVal(ws, 'A' + row);
    if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) {
      break;
    }

    const apellido1 = cellStr(ws, 'B' + row).toUpperCase();
    const apellido2 = cellStr(ws, 'C' + row).toUpperCase();
    const nombres = cellStr(ws, 'D' + row).toUpperCase();

    // Rubros
    let ec = null, ex = null, tr = null, pe = null;
    if (rubroMapping) {
      for (const { key, colIdx } of rubroMapping) {
        const raw = cellVal(ws, colLetter(colIdx) + row);
        const val = normalizeRubroValue(raw);
        if (key === 'ec') ec = val;
        else if (key === 'ex') ex = val;
        else if (key === 'tr') tr = val;
        else if (key === 'pe') pe = val;
      }
    }

    // Suma
    let suma = null;
    if (cols.sumaCol !== null) {
      suma = normalizeRubroValue(cellVal(ws, colLetter(cols.sumaCol) + row));
    }

    // Faltas
    let faltas = null;
    if (cols.faltasCol !== null) {
      const faltasRaw = cellVal(ws, colLetter(cols.faltasCol) + row);
      faltas = normalizeRubroValue(faltasRaw);
    }

    // Calificación Definitiva
    const calRaw = cellVal(ws, colLetter(cols.calCol) + row);
    const { value: cal, warning: calWarning } = normalizeGrade(calRaw, is100Scale);

    if (calWarning) {
      warnings.push(`Row ${row} (${apellido1} ${apellido2} ${nombres}): ${calWarning}`);
    }

    // Skip if cal is empty/null/0
    if (cal == null || cal === 0) {
      continue;
    }

    const nameParts = [apellido1, apellido2, nombres].filter(Boolean);
    const studentFullName = nameParts.join(' ').replace(/\s+/g, ' ').trim();

    grades.push({
      teacherFolder,
      teacherName: teacherName.toUpperCase(),
      turno,
      subjectName,
      grado,
      grupo,
      groupKey,
      partial,
      studentNum: numVal,
      apellido1,
      apellido2,
      nombres,
      studentFullName,
      ec,
      tr,
      pe,
      ex,
      suma,
      faltas,
      cal,
      value: cal, // backward compatibility
    });
  }

  return { grades, warnings };
}

// ---------- Main ----------

function main() {
  const allGrades = [];
  const allWarnings = [];
  let filesProcessed = 0;
  let sheetsProcessed = 0;
  let sheetsSkipped = 0;

  // Rubro detection stats
  let sheetsWithRubros = 0;
  let sheetsWithoutRubros = 0;
  const rubroCountMap = {}; // count of sheets by rubro count
  let sheets100Scale = 0;

  for (const { turno, folder } of SOURCES) {
    console.log(`\n=== Processing ${turno} ===`);
    console.log(`  Folder: ${folder}`);

    if (!fs.existsSync(folder)) {
      console.log(`  [ERROR] Folder does not exist!`);
      continue;
    }

    const teacherDirs = fs.readdirSync(folder, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();

    console.log(`  Found ${teacherDirs.length} teacher folders`);

    for (const teacherFolder of teacherDirs) {
      const teacherPath = path.join(folder, teacherFolder);
      const xlsxFiles = fs.readdirSync(teacherPath)
        .filter(f => (f.endsWith('.xlsx') || f.endsWith('.xls')) && !f.startsWith('~$'));

      if (xlsxFiles.length === 0) {
        console.log(`  [WARN] No .xlsx/.xls file in "${teacherFolder}"`);
        continue;
      }

      for (const xlsxFile of xlsxFiles) {
        const filePath = path.join(teacherPath, xlsxFile);
        filesProcessed++;

        let wb;
        try {
          wb = XLSX.readFile(filePath, { cellFormula: false });
        } catch (err) {
          console.log(`  [ERROR] Failed to read "${filePath}": ${err.message}`);
          continue;
        }

        let fileGrades = 0;

        for (const sheetName of wb.SheetNames) {
          const trimmedName = sheetName.trim();
          if (SKIP_SHEETS.test(trimmedName)) {
            sheetsSkipped++;
            continue;
          }

          const ws = wb.Sheets[sheetName];
          sheetsProcessed++;

          const { grades, warnings } = processSheet(ws, sheetName, teacherFolder, turno);
          fileGrades += grades.length;
          allGrades.push(...grades);

          // Track rubro stats
          const cols = detectColumns(ws);
          if (cols.sumaCol !== null && cols.rubroCount > 0) {
            const mapping = mapRubros(turno, cols.rubroStartCol, cols.rubroCount);
            if (mapping) {
              sheetsWithRubros++;
            } else {
              sheetsWithoutRubros++;
            }
            rubroCountMap[cols.rubroCount] = (rubroCountMap[cols.rubroCount] || 0) + 1;
          } else {
            sheetsWithoutRubros++;
          }

          // Track scale detection
          if (warnings.some(w => w.includes('0-100 scale'))) {
            sheets100Scale++;
          }

          // Log warnings
          for (const w of warnings) {
            console.log(`    [WARN] ${teacherFolder}/${xlsxFile} > ${sheetName}: ${w}`);
            allWarnings.push(`${teacherFolder}/${xlsxFile} > ${sheetName}: ${w}`);
          }
        }

        console.log(`  ${teacherFolder}/${xlsxFile}: ${fileGrades} grades from ${wb.SheetNames.length} sheets`);
      }
    }
  }

  // Build summary
  const byTurno = {};
  const byPartial = {};
  const byGrado = {};
  const teacherSet = new Set();
  const subjectSet = new Set();
  const groupSet = new Set();

  // Rubro fill stats
  let withEc = 0, withEx = 0, withTr = 0, withPe = 0, withSuma = 0, withFaltas = 0;

  for (const g of allGrades) {
    byTurno[g.turno] = (byTurno[g.turno] || 0) + 1;
    byPartial[g.partial] = (byPartial[g.partial] || 0) + 1;
    byGrado[g.grado] = (byGrado[g.grado] || 0) + 1;
    teacherSet.add(g.teacherName);
    subjectSet.add(g.subjectName);
    groupSet.add(g.groupKey);

    if (g.ec != null) withEc++;
    if (g.ex != null) withEx++;
    if (g.tr != null) withTr++;
    if (g.pe != null) withPe++;
    if (g.suma != null) withSuma++;
    if (g.faltas != null) withFaltas++;
  }

  const output = {
    extractedAt: new Date().toISOString(),
    totalGrades: allGrades.length,
    grades: allGrades,
    summary: {
      byTurno,
      byPartial,
      byGrado,
      teachers: teacherSet.size,
      subjects: [...subjectSet].sort(),
      groups: [...groupSet].sort(),
      rubros: {
        sheetsWithRubros,
        sheetsWithoutRubros,
        rubroCountDistribution: rubroCountMap,
        sheets100Scale,
        fieldFillRates: {
          ec: withEc,
          ex: withEx,
          tr: withTr,
          pe: withPe,
          suma: withSuma,
          faltas: withFaltas,
          total: allGrades.length,
        },
      },
      warnings: allWarnings,
    },
  };

  const outPath = path.join(__dirname, 'extracted-grades.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log('\n========== SUMMARY ==========');
  console.log(`Files processed:       ${filesProcessed}`);
  console.log(`Sheets processed:      ${sheetsProcessed}`);
  console.log(`Sheets skipped:        ${sheetsSkipped}`);
  console.log(`Total grades:          ${allGrades.length}`);
  console.log(`By turno:              ${JSON.stringify(byTurno)}`);
  console.log(`By partial:            ${JSON.stringify(byPartial)}`);
  console.log(`By grado:              ${JSON.stringify(byGrado)}`);
  console.log(`Teachers:              ${teacherSet.size}`);
  console.log(`Subjects:              ${subjectSet.size}`);
  console.log(`Groups:                ${groupSet.size}`);
  console.log('');
  console.log('--- Rubro Extraction Stats ---');
  console.log(`Sheets with rubros:    ${sheetsWithRubros}`);
  console.log(`Sheets without rubros: ${sheetsWithoutRubros}`);
  console.log(`Rubro count distrib:   ${JSON.stringify(rubroCountMap)}`);
  console.log(`Sheets 0-100 scale:    ${sheets100Scale}`);
  console.log(`EC filled:             ${withEc}/${allGrades.length}`);
  console.log(`EX filled:             ${withEx}/${allGrades.length}`);
  console.log(`TR filled:             ${withTr}/${allGrades.length}`);
  console.log(`PE filled:             ${withPe}/${allGrades.length}`);
  console.log(`Suma filled:           ${withSuma}/${allGrades.length}`);
  console.log(`Faltas filled:         ${withFaltas}/${allGrades.length}`);
  console.log(`Warnings:              ${allWarnings.length}`);
  console.log('');
  console.log(`Output:                ${outPath}`);
}

main();
