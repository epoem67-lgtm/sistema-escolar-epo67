/**
 * Compara Excel de orientación "concentrado primer parcial (3).xlsx"
 * contra Firestore para VESPERTINO_2-2 y VESPERTINO_2-3.
 *
 * El Excel tiene 13 materias en orden: PENS.LIT, ING, T.S.MAT, CON.HIS,
 * T.CUL.DIG, REA.QUIM, ESP.SOC, CIEN.SOC, COM.VIRT, MTO.RED, ACT.ART,
 * EDUC.SEX.GEN, IGU.DER.
 *
 * GUARDA DE SEGURIDAD: rechaza match si grade.turno no es VESPERTINO.
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

const XLSX_PATH = '/Users/oliolix/Downloads/concentrado primer parcial (3).xlsx';
const EXPECTED_TURNO = 'VESPERTINO';
const SHEETS_TO_USE = [
  { name: '2°2', groupId: 'VESPERTINO_2-2' },
  { name: '2°3', groupId: 'VESPERTINO_2-3' },
];

// Mapping orden Excel (col 4 en adelante) → subjectId G2 vespertino
const EXCEL_SUBJECTS = [
  { abbr: 'PENS.LIT',    subjectId: 'G2_pensamiento_literario' },
  { abbr: 'ING',         subjectId: 'G2_inglés_iv' },
  { abbr: 'T.S.MAT',     subjectId: 'G2_temas_selectos_de_matemáticas_i' },
  { abbr: 'CON.HIS',     subjectId: 'G2_conciencia_histórica_i' },
  { abbr: 'T.CUL.DIG',   subjectId: 'G2_taller_de_cultura_digital' },
  { abbr: 'REA.QUIM',    subjectId: 'G2_reacciones_químicas_y_conservación_de_la' },
  { abbr: 'ESP.SOC',     subjectId: 'G2_espacio_y_sociedad' },
  { abbr: 'CIEN.SOC',    subjectId: 'G2_ciencias_sociales_iii' },
  { abbr: 'COM.VIRT',    subjectId: 'G2_comunidades_virtuales' },
  { abbr: 'MTO.RED',     subjectId: 'G2_mantenimiento_de_redes_de_cómputo' },
  { abbr: 'ACT.ART',     subjectId: 'G2_actividades_artísticas_y_culturales_i' },
  { abbr: 'EDUC.SEX',    subjectId: 'G2_educación_integral_en_sexualidad_y_géner' },
  { abbr: 'IGU.DER',     subjectId: 'G2_temas_selectos_de_igualdad_y_derechos_hu' },
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
  // Datos empiezan en fila 6 (después de headers en 0-5)
  for (let i = 6; i < data.length; i++) {
    const row = data[i];
    const num = row[0];
    if (typeof num !== 'number' || num < 1) continue;
    const apPat = String(row[1] || '').trim();
    const apMat = String(row[2] || '').trim();
    const nombres = String(row[3] || '').trim();
    if (!apPat) continue;
    const nombreCompleto = `${apPat} ${apMat} ${nombres}`.replace(/\s+/g, ' ').trim();

    // Pares (F, C) empezando en col 4 — 13 materias
    const subjects = {};
    EXCEL_SUBJECTS.forEach((s, idx) => {
      const fCol = 4 + idx * 2;
      const cCol = 5 + idx * 2;
      const f = row[fCol];
      const c = row[cCol];
      const faltas = (f === '' || f === null || f === undefined) ? null : Number(f);
      const cal = (c === '' || c === null || c === undefined) ? null : Number(c);
      subjects[s.subjectId] = { faltas, cal };
    });

    rows.push({ num, groupId, nombreCompleto, apPat: normalize(apPat), nombres: normalize(nombres), subjects });
  }
  return rows;
}

(async () => {
  console.log(`Leyendo Excel: ${XLSX_PATH}`);
  console.log(`Turno esperado: ${EXPECTED_TURNO} (guarda contra mezcla matutino/vespertino)\n`);

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

  const allStudents = students.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const groupIds = new Set(SHEETS_TO_USE.map(s => s.groupId));
  const groupStudents = allStudents.filter(s => groupIds.has(s.groupId || s.grupo));
  console.log(`Alumnos en ${[...groupIds].join(', ')}: ${groupStudents.length}\n`);

  // Indexar grades por studentId × subjectId × P1
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
    if (!stu) {
      notFound.push({ cuadro: cuadro.nombreCompleto, groupId: cuadro.groupId, num: cuadro.num });
      continue;
    }

    for (const subj of EXCEL_SUBJECTS) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      const cuadroFaltas = cuadro.subjects[subj.subjectId].faltas;
      if (cuadroCal === null && cuadroFaltas === null) continue;

      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];

      // GUARDA: si el grade existe pero turno NO es VESPERTINO, SKIP y avisar
      if (g && g.turno && g.turno !== EXPECTED_TURNO) {
        console.warn(`⚠️  GUARDA: ${stu.nombreCompleto} - ${subj.abbr} tiene turno=${g.turno} (esperado ${EXPECTED_TURNO}). SKIP.`);
        totalTurnoSkipped++;
        continue;
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
          groupId: cuadro.groupId, num: cuadro.num,
          alumno: stu.nombreCompleto, studentId: stu.id,
          materia: subj.abbr, subjectId: subj.subjectId,
          cuadroCal, cuadroFaltas, fsCal, fsFaltas,
          tipo: !calMatch && !faltasMatch ? 'CAL_Y_FALTAS' : (!calMatch ? 'SOLO_CAL' : 'SOLO_FALTAS'),
          docId: g ? g.id : null,
          existeEnFirestore: !!g,
          teacherName: g ? g.teacherName : null,
        });
      }
    }
  }

  console.log(`📊 Total comparaciones: ${totalCompared}`);
  console.log(`✓ Coinciden: ${totalMatched}`);
  console.log(`❌ Discrepancias: ${discrepancies.length}`);
  console.log(`⚠️  Skipped por guarda de turno: ${totalTurnoSkipped}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  const calDiscreps = discrepancies.filter(d => d.tipo !== 'SOLO_FALTAS');
  console.log(`Discrepancias de calificación: ${calDiscreps.length}\n`);

  console.log('=== TOP 50 DISCREPANCIAS CAL ===');
  calDiscreps.slice(0, 50).forEach((d, i) => {
    const grupo = d.groupId.replace('VESPERTINO_', '');
    console.log(`${(i+1).toString().padStart(2)}. V-${grupo} #${d.num} ${d.alumno.substring(0,32).padEnd(32)} ${d.materia.padEnd(10)} | Cuadro=${d.cuadroCal} | Firestore=${d.fsCal}${d.teacherName ? ' (' + d.teacherName.substring(0,25) + ')' : ''}`);
  });

  if (notFound.length > 0) {
    console.log(`\n=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.forEach(n => console.log(`  ${n.groupId} #${n.num}: ${n.cuadro}`));
  }

  // CSV
  const csvFile = path.join(__dirname, 'discrepancies-orientacion-2-2-2-3-vesp.csv');
  const csvLines = ['groupId,num,alumno,studentId,materia,subjectId,cuadroCal,cuadroFaltas,fsCal,fsFaltas,tipo,docId,maestro'];
  discrepancies.forEach(d => {
    csvLines.push([
      d.groupId, d.num, `"${d.alumno.replace(/"/g, '""')}"`, d.studentId,
      d.materia, d.subjectId, d.cuadroCal ?? '', d.cuadroFaltas ?? '',
      d.fsCal ?? '', d.fsFaltas ?? '', d.tipo, d.docId || '',
      `"${(d.teacherName || '').replace(/"/g, '""')}"`,
    ].join(','));
  });
  fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');

  const jsonFile = path.join(__dirname, 'discrepancies-orientacion-2-2-2-3-vesp.json');
  fs.writeFileSync(jsonFile, JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);
  console.log(`JSON: ${jsonFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
