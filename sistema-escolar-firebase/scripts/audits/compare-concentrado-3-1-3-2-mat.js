/**
 * Compara "3°1_3°2 CONCENTRADO CALIF. (1).xls" contra Firestore.
 * MATUTINO_3-1 y MATUTINO_3-2 (G3, 12 materias cada uno).
 *
 * Estructura del Excel:
 *   - Headers en fila 8 (materias)
 *   - Datos desde fila 11
 *   - Cols 0-1: H/M (número de lista)
 *   - Col 2: matrícula
 *   - Cols 3-5: apPat, apMat, nombres
 *   - Cols 6-29: 12 pares (F, C) en orden:
 *       C.Com, T.S.Inglés, T.S.Mat, Con.His, Org, T.S.Filos, Econ,
 *       Pag.Web, D.Dig, Act.Art, Prac, T.S.Igualdad
 *
 * REGLA: solo reportar discrepancias, NO aplicar cambios.
 * Olivia confirma alumno por alumno contra el PDF original antes de aplicar.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const xlsx = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'));

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

const XLSX_PATH = '/Users/oliolix/Downloads/3°1_3°2 CONCENTRADO CALIF. (1).xls';
const EXPECTED_TURNO = 'MATUTINO';

// Mismo orden de columnas para 3°1 y 3°2 (igual a 3°3)
const SUBJECTS_G3 = [
  { abbr: 'C.COM',     subjectId: 'G3_ciencias_de_la_comunicación_i' },
  { abbr: 'T.S.ING',   subjectId: 'G3_temas_selectos_de_inglés_ii' },
  { abbr: 'T.S.MAT',   subjectId: 'G3_temas_selectos_de_matemáticas_ii' },
  { abbr: 'CON.HIS',   subjectId: 'G3_conciencia_histórica_iii' },
  { abbr: 'ORG',       subjectId: 'G3_organismos' },
  { abbr: 'T.S.FILO',  subjectId: 'G3_temas_selectos_de_filosofía' },
  { abbr: 'ECON',      subjectId: 'G3_economía_i' },
  { abbr: 'PAG.WEB',   subjectId: 'G3_páginas_web' },
  { abbr: 'D.DIG',     subjectId: 'G3_diseño_digital' },
  { abbr: 'AC.ART',    subjectId: 'G3_actividades_artísticas_y_culturales_iii' },
  { abbr: 'PRAC',      subjectId: 'G3_práctica_y_colaboración_ciudadana_ii' },
  { abbr: 'T.S.IGUAL', subjectId: 'G3_temas_selectos_de_igualdad_y_derechos_hu' },
];

const SHEET_CONFIG = {
  '3°1': { groupId: 'MATUTINO_3-1', dataStartRow: 11, nameCols: { pat: 3, mat: 4, nom: 5 }, firstFCol: 6 },
  '3°2': { groupId: 'MATUTINO_3-2', dataStartRow: 11, nameCols: { pat: 3, mat: 4, nom: 5 }, firstFCol: 6 },
};

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      r.setEncoding('utf8');
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    }).on('error', rej);
  });
}
async function listAll(c) {
  const out = []; let pt = null;
  do {
    let u = `${BASE}/${c}?pageSize=300`;
    if (pt) u += `&pageToken=${pt}`;
    const r = await reqGet(u);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken || null;
  } while (pt);
  return out;
}
function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if (v.stringValue !== undefined) o[k] = v.stringValue;
    else if (v.integerValue !== undefined) o[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) o[k] = Number(v.doubleValue);
  }
  return o;
}
function normalize(s) {
  return (s || '').toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E')
    .replace(/[ÍÌÏÎ]/g, 'I').replace(/[ÓÒÖÔ]/g, 'O')
    .replace(/[ÚÙÜÛ]/g, 'U').replace(/[Ñ]/g, 'N')
    .replace(/\s+/g, ' ').trim();
}
function readSheet(wb, sheetName, cfg) {
  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = [];
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    const row = data[i];
    const apPat = String(row[cfg.nameCols.pat] || '').trim();
    const apMat = String(row[cfg.nameCols.mat] || '').trim();
    const nombres = String(row[cfg.nameCols.nom] || '').trim();
    if (!apPat || !nombres) continue;
    const nombreCompleto = `${apPat} ${apMat} ${nombres}`.replace(/\s+/g, ' ').trim();
    const subjects = {};
    SUBJECTS_G3.forEach((s, idx) => {
      const fCol = cfg.firstFCol + idx * 2;
      const cCol = cfg.firstFCol + 1 + idx * 2;
      const f = row[fCol], c = row[cCol];
      const faltas = (f === '' || f === null || f === undefined) ? null : Number(f);
      const cal = (c === '' || c === null || c === undefined) ? null : Number(c);
      subjects[s.subjectId] = { faltas, cal };
    });
    rows.push({ groupId: cfg.groupId, nombreCompleto, apPat: normalize(apPat), nombres: normalize(nombres), subjects });
  }
  return rows;
}

(async () => {
  console.log(`Leyendo Excel: ${XLSX_PATH}`);
  console.log(`Turno esperado: ${EXPECTED_TURNO}\n`);

  const wb = xlsx.readFile(XLSX_PATH);
  const cuadroRows = [];
  Object.entries(SHEET_CONFIG).forEach(([name, cfg]) => {
    const rows = readSheet(wb, name, cfg);
    console.log(`  ${name} (${cfg.groupId}): ${rows.length} alumnos · 12 materias`);
    cuadroRows.push(...rows);
  });
  console.log();

  console.log('Cargando datos de Firestore...');
  const [students, grades] = await Promise.all([listAll('students'), listAll('grades')]);
  const allStudents = students.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const groupIds = new Set(Object.values(SHEET_CONFIG).map(c => c.groupId));
  const groupStudents = allStudents.filter(s => groupIds.has(s.groupId || s.grupo));
  console.log(`Alumnos en ${[...groupIds].join(', ')}: ${groupStudents.length}\n`);

  const gradeIdx = {};
  grades.forEach(d => {
    const g = parseFields(d.fields);
    if (g.partial !== 'P1') return;
    gradeIdx[`${g.studentId}|${g.subjectId}`] = { id: d.name.split('/').pop(), ...g };
  });

  const discrepancies = [];
  const notFound = [];
  let totalCompared = 0, totalMatched = 0, totalTurnoSkipped = 0;

  for (const cuadro of cuadroRows) {
    const nombreNorm = normalize(cuadro.nombreCompleto);
    let stu = groupStudents.find(s => s.groupId === cuadro.groupId && normalize(s.nombreCompleto) === nombreNorm);
    if (!stu) {
      stu = groupStudents.find(s => {
        if (s.groupId !== cuadro.groupId) return false;
        const sn = normalize(s.nombreCompleto);
        return sn.includes(cuadro.apPat) && cuadro.nombres && sn.includes(cuadro.nombres.split(' ')[0]);
      });
    }
    if (!stu) { notFound.push({ cuadro: cuadro.nombreCompleto, groupId: cuadro.groupId }); continue; }

    for (const subj of SUBJECTS_G3) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      const cuadroFaltas = cuadro.subjects[subj.subjectId].faltas;
      if (cuadroCal === null && cuadroFaltas === null) continue;

      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];
      if (g && g.turno && g.turno !== EXPECTED_TURNO) {
        console.warn(`⚠️  GUARDA: ${stu.nombreCompleto} - ${subj.abbr} turno=${g.turno}. SKIP.`);
        totalTurnoSkipped++; continue;
      }

      const fsCal = g ? (g.cal !== undefined ? g.cal : g.value) : null;
      const fsFaltas = g ? g.faltas : null;
      totalCompared++;

      const calMatch = Number(fsCal) === Number(cuadroCal);
      const faltasMatch = Number(fsFaltas || 0) === Number(cuadroFaltas || 0);

      if (calMatch && faltasMatch) {
        totalMatched++;
      } else {
        discrepancies.push({
          groupId: cuadro.groupId, alumno: stu.nombreCompleto, studentId: stu.id,
          materia: subj.abbr, subjectId: subj.subjectId,
          cuadroCal, cuadroFaltas, fsCal, fsFaltas,
          tipo: !calMatch && !faltasMatch ? 'CAL_Y_FALTAS' : (!calMatch ? 'SOLO_CAL' : 'SOLO_FALTAS'),
          docId: g ? g.id : null,
          teacherName: g ? g.teacherName : null,
        });
      }
    }
  }

  console.log(`📊 Total comparaciones: ${totalCompared}`);
  console.log(`✓ Coinciden: ${totalMatched}`);
  console.log(`❌ Discrepancias: ${discrepancies.length}`);
  console.log(`⚠️  Skipped guarda turno: ${totalTurnoSkipped}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  const calDiscreps = discrepancies.filter(d => d.tipo !== 'SOLO_FALTAS');
  console.log(`Discrepancias de calificación: ${calDiscreps.length}\n`);

  console.log('=== DISCREPANCIAS DE CAL (verificar contra PDF antes de aplicar) ===');
  calDiscreps.forEach((d, i) => {
    const grupo = d.groupId.replace('MATUTINO_', '');
    const diff = Number(d.cuadroCal) - Number(d.fsCal);
    const arrow = diff > 0 ? '↑' : '↓';
    console.log(`${(i+1).toString().padStart(2)}. M-${grupo} ${d.alumno.substring(0,32).padEnd(32)} ${d.materia.padEnd(10)} | Excel=${d.cuadroCal} ${arrow}${Math.abs(diff)} Firestore=${d.fsCal}${d.teacherName ? ' (' + d.teacherName.substring(0,22) + ')' : ''}`);
  });

  if (notFound.length > 0) {
    console.log(`\n=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.slice(0, 20).forEach(n => console.log(`  ${n.groupId}: ${n.cuadro}`));
  }

  const csvFile = path.join(__dirname, 'discrepancies-concentrado-3-1-3-2-mat.csv');
  const csvLines = ['groupId,alumno,studentId,materia,subjectId,excelCal,excelFaltas,fsCal,fsFaltas,tipo,docId,maestro'];
  discrepancies.forEach(d => {
    csvLines.push([
      d.groupId, `"${d.alumno.replace(/"/g, '""')}"`, d.studentId,
      d.materia, d.subjectId, d.cuadroCal ?? '', d.cuadroFaltas ?? '',
      d.fsCal ?? '', d.fsFaltas ?? '', d.tipo, d.docId || '',
      `"${(d.teacherName || '').replace(/"/g, '""')}"`,
    ].join(','));
  });
  fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'discrepancies-concentrado-3-1-3-2-mat.json'), JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);

  console.log(`\n⚠️  Estas son DIFERENCIAS DETECTADAS, no acciones aplicadas.`);
  console.log(`    Antes de cualquier cambio, Olivia debe verificar contra el PDF original.`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
