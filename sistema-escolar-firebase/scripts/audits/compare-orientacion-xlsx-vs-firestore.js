/**
 * Comparación masiva: CUADRO OFICIAL DE ORIENTACIÓN (Excel) vs Firestore
 *
 * Lee el archivo "CALIFICACIONES PRIMERA_2O. SEM. (1).xlsx" que orientación
 * envió como source-of-truth de calificaciones P1 para los grupos 1°1 y 1°2
 * vespertino, y compara contra los grades actuales en Firestore.
 *
 * Reporta DISCREPANCIAS de calificación o faltas por alumno × materia.
 *
 * Output: CSV detallado para que Olivia revise.
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

const XLSX_PATH = '/Users/oliolix/Downloads/CALIFICACIONES PRIMERA_2O. SEM. (1).xlsx';
// Usamos hojas en SEP order (Hoja3 = 1-1 VESP, Hoja4 = 1-2 VESP)
const SHEETS_TO_USE = [
  { name: 'Hoja3', groupId: 'VESPERTINO_1-1' },
  { name: 'Hoja4', groupId: 'VESPERTINO_1-2' },
];

// Mapping del orden SEP usado en Hoja3 y Hoja4 a subjectIds Firestore.
// SEP order: L.YCOM, INGLES, P.MATE, CULT.DIG, C.NAT, P.FILOS, C.SOC, T.CIENC, ACT.FIS, EDUC.SAL, TSIDH
const SEP_SUBJECTS = [
  { abbr: 'L.YCOM',   subjectId: 'G1_lengua_y_comunicación_ii' },
  { abbr: 'INGLES',   subjectId: 'G1_inglés_ii' },
  { abbr: 'P.MATE',   subjectId: 'G1_pensamiento_matemático_ii' },
  { abbr: 'CULT.DIG', subjectId: 'G1_cultura_digital_ii' },
  { abbr: 'C.NAT',    subjectId: 'G1_ciencias_naturales_experimentales_y_tecn' },
  { abbr: 'P.FILOS',  subjectId: 'G1_pensamiento_filosófico_y_humanidades_ii' },
  { abbr: 'C.SOC',    subjectId: 'G1_ciencias_sociales_ii' },
  { abbr: 'T.CIENC',  subjectId: 'G1_taller_de_ciencias_i' },
  { abbr: 'ACT.FIS',  subjectId: 'G1_actividades_físicas_y_deportivas_ii' },
  { abbr: 'EDUC.SAL', subjectId: 'G1_educación_para_la_salud_ii' },
  { abbr: 'TSIDH',    subjectId: 'G1_temas_selectos_de_igualdad_y_derechos_hu' },
];

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
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

function readSheet(wb, sheetName, groupId) {
  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = [];
  // El header está en filas 4-5. Los datos empiezan en fila 6.
  for (let i = 6; i < data.length; i++) {
    const row = data[i];
    const num = row[0];
    if (typeof num !== 'number' || num < 1) continue;  // skip footer rows
    const apPat = String(row[4] || '').trim();
    const apMat = String(row[5] || '').trim();
    const nombres = String(row[6] || '').trim();
    if (!apPat) continue;
    const nombreCompleto = `${apPat} ${apMat} ${nombres}`.replace(/\s+/g, ' ').trim();

    // Las materias vienen como pares (F, C) empezando en col 7
    const subjects = {};
    SEP_SUBJECTS.forEach((s, idx) => {
      const fCol = 7 + idx * 2;
      const cCol = 8 + idx * 2;
      const f = row[fCol];
      const c = row[cCol];
      const faltas = (f === '' || f === null || f === undefined) ? null : Number(f);
      const cal = (c === '' || c === null || c === undefined) ? null : Number(c);
      subjects[s.subjectId] = { faltas, cal };
    });

    rows.push({
      num,
      groupId,
      nombreCompleto,
      apPat: normalize(apPat),
      apMat: normalize(apMat),
      nombres: normalize(nombres),
      subjects,
    });
  }
  return rows;
}

(async () => {
  console.log(`Leyendo Excel: ${XLSX_PATH}`);
  const wb = xlsx.readFile(XLSX_PATH);
  const cuadroRows = [];
  SHEETS_TO_USE.forEach(({ name, groupId }) => {
    const rows = readSheet(wb, name, groupId);
    console.log(`  ${name} (${groupId}): ${rows.length} alumnos`);
    cuadroRows.push(...rows);
  });
  console.log();

  console.log('Cargando datos de Firestore...');
  const [students, grades] = await Promise.all([
    listAll('students'),
    listAll('grades'),
  ]);

  const studentMap = students.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Filtrar por groupId de interés
  const groupIds = new Set(SHEETS_TO_USE.map(s => s.groupId));
  const groupStudents = studentMap.filter(s => groupIds.has(s.groupId || s.grupo));
  console.log(`Alumnos VESPERTINO_1-1 + VESPERTINO_1-2: ${groupStudents.length}\n`);

  // Indexar grades por studentId × subjectId × P1
  const gradeIdx = {};
  grades.forEach(d => {
    const g = parseFields(d.fields);
    if (g.partial !== 'P1') return;
    const k = `${g.studentId}|${g.subjectId}`;
    gradeIdx[k] = { id: d.name.split('/').pop(), ...g };
  });

  // ─── Comparación ─────────────────────────────────────────────────
  const discrepancies = [];
  const notFound = [];
  let totalCompared = 0, totalMatched = 0;

  for (const cuadro of cuadroRows) {
    // Match por nombre normalizado
    const nombreNorm = normalize(cuadro.nombreCompleto);
    let stu = groupStudents.find(s =>
      s.groupId === cuadro.groupId &&
      normalize(s.nombreCompleto) === nombreNorm
    );
    if (!stu) {
      // Partial match — primer apellido + primer nombre
      stu = groupStudents.find(s => {
        if (s.groupId !== cuadro.groupId) return false;
        const sn = normalize(s.nombreCompleto);
        return sn.includes(cuadro.apPat) && cuadro.nombres && sn.includes(cuadro.nombres.split(' ')[0]);
      });
    }
    if (!stu) {
      notFound.push({ cuadro: cuadro.nombreCompleto, groupId: cuadro.groupId, num: cuadro.num });
      continue;
    }

    // Comparar cada materia
    for (const subj of SEP_SUBJECTS) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      const cuadroFaltas = cuadro.subjects[subj.subjectId].faltas;
      // Skip si el cuadro está vacío
      if (cuadroCal === null && cuadroFaltas === null) continue;

      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];
      const fsCal = g ? (g.cal !== undefined ? g.cal : g.value) : null;
      const fsFaltas = g ? g.faltas : null;
      totalCompared++;

      const calMatch = Number(fsCal) === Number(cuadroCal);
      const faltasMatch = Number(fsFaltas || 0) === Number(cuadroFaltas || 0);

      if (calMatch && faltasMatch) {
        totalMatched++;
      } else {
        discrepancies.push({
          groupId: cuadro.groupId,
          num: cuadro.num,
          alumno: stu.nombreCompleto,
          studentId: stu.id,
          materia: subj.abbr,
          subjectId: subj.subjectId,
          cuadroCal, cuadroFaltas,
          fsCal, fsFaltas,
          tipo: !calMatch && !faltasMatch ? 'CAL_Y_FALTAS' : (!calMatch ? 'SOLO_CAL' : 'SOLO_FALTAS'),
          docId: g ? g.id : null,
          existeEnFirestore: !!g,
          gFull: g,
        });
      }
    }
  }

  // ─── REPORTE ───────────────────────────────────────────────────
  console.log(`📊 Total comparaciones: ${totalCompared}`);
  console.log(`✓ Coinciden: ${totalMatched}`);
  console.log(`❌ Discrepancias: ${discrepancies.length}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  // Agrupar discrepancias por tipo
  const byTipo = { CAL_Y_FALTAS: [], SOLO_CAL: [], SOLO_FALTAS: [] };
  discrepancies.forEach(d => byTipo[d.tipo].push(d));

  console.log(`Por tipo:`);
  console.log(`  📐 CAL distinta:        ${byTipo.SOLO_CAL.length + byTipo.CAL_Y_FALTAS.length}`);
  console.log(`  📅 Solo FALTAS distinta: ${byTipo.SOLO_FALTAS.length}\n`);

  // Mostrar TOP 30 discrepancias de CAL
  const calDiscreps = discrepancies.filter(d => d.tipo !== 'SOLO_FALTAS');
  console.log(`=== TOP 40 DISCREPANCIAS DE CALIFICACIÓN ===`);
  calDiscreps.slice(0, 40).forEach((d, i) => {
    const turno = d.groupId.startsWith('MAT') ? 'M' : 'V';
    const grupo = d.groupId.replace(/^(MATUTINO_|VESPERTINO_)/, '');
    console.log(`${i+1}. ${turno}-${grupo} #${d.num} ${d.alumno.substring(0,30).padEnd(30)} ${d.materia.padEnd(10)} | Cuadro=${d.cuadroCal} faltas=${d.cuadroFaltas || 0} | Firestore=${d.fsCal} faltas=${d.fsFaltas || 0}`);
  });
  console.log();

  if (notFound.length > 0) {
    console.log(`=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.forEach(n => console.log(`  ${n.groupId} #${n.num}: ${n.cuadro}`));
    console.log();
  }

  // CSV completo
  const csvFile = path.join(__dirname, 'discrepancies-orientacion-1-1-1-2-vesp.csv');
  const csvLines = ['groupId,num,alumno,studentId,materia,subjectId,cuadroCal,cuadroFaltas,fsCal,fsFaltas,tipo,docId,existeEnFirestore'];
  discrepancies.forEach(d => {
    csvLines.push([
      d.groupId, d.num, `"${d.alumno.replace(/"/g, '""')}"`, d.studentId,
      d.materia, d.subjectId,
      d.cuadroCal ?? '', d.cuadroFaltas ?? '',
      d.fsCal ?? '', d.fsFaltas ?? '',
      d.tipo, d.docId || '', d.existeEnFirestore ? 'sí' : 'no',
    ].join(','));
  });
  fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');
  console.log(`CSV: ${csvFile}`);

  // JSON con discrepancias para fix script (sin gFull para no bloatear)
  const jsonFile = path.join(__dirname, 'discrepancies-orientacion-1-1-1-2-vesp.json');
  const lean = discrepancies.map(d => ({ ...d, gFull: undefined }));
  fs.writeFileSync(jsonFile, JSON.stringify(lean, null, 2), 'utf8');
  console.log(`JSON: ${jsonFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
