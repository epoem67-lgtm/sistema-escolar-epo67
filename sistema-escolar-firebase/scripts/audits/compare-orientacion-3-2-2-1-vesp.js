/**
 * Compara Excel "CALIF. 1ER PARCIAL MAR 2026 (3).xlsx" contra Firestore.
 * VESPERTINO 3-2 (sexto sem, 12 materias) y VESPERTINO 2-1 (cuarto sem, 13 materias).
 *
 * Estructura diferente al Excel anterior: NOMBRE DEL ALUMNO en una sola celda
 * (col 1), no en 3 columnas. Detección por nombre completo.
 *
 * GUARDA: rechaza match si grade.turno !== VESPERTINO.
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

const XLSX_PATH = '/Users/oliolix/Downloads/CALIF. 1ER PARCIAL MAR 2026 (3).xlsx';
const EXPECTED_TURNO = 'VESPERTINO';

// Mapping de materias por hoja
const SHEET_CONFIG = {
  '3°2': {
    groupId: 'VESPERTINO_3-2',
    subjects: [
      { abbr: 'C.COM',    subjectId: 'G3_ciencias_de_la_comunicación_i' },
      { abbr: 'INGLES',   subjectId: 'G3_temas_selectos_de_inglés_ii' },
      { abbr: 'MATE',     subjectId: 'G3_temas_selectos_de_matemáticas_ii' },
      { abbr: 'CONS.HIS', subjectId: 'G3_conciencia_histórica_iii' },
      { abbr: 'ORG',      subjectId: 'G3_organismos' },
      { abbr: 'FILO',     subjectId: 'G3_temas_selectos_de_filosofía' },
      { abbr: 'ECON',     subjectId: 'G3_economía_i' },
      { abbr: 'PAG.WEB',  subjectId: 'G3_páginas_web' },
      { abbr: 'D.DIG',    subjectId: 'G3_diseño_digital' },
      { abbr: 'ACT.ART',  subjectId: 'G3_actividades_artísticas_y_culturales_iii' },
      { abbr: 'PRAC',     subjectId: 'G3_práctica_y_colaboración_ciudadana_ii' },
      { abbr: 'IGUL',     subjectId: 'G3_temas_selectos_de_igualdad_y_derechos_hu' },
    ],
  },
  '2°1': {
    groupId: 'VESPERTINO_2-1',
    subjects: [
      { abbr: 'PENS.LIT',  subjectId: 'G2_pensamiento_literario' },
      { abbr: 'INGLES',    subjectId: 'G2_inglés_iv' },
      { abbr: 'MATE',      subjectId: 'G2_temas_selectos_de_matemáticas_i' },
      { abbr: 'CONS.HIS',  subjectId: 'G2_conciencia_histórica_i' },
      { abbr: 'T.CUL.DIG', subjectId: 'G2_taller_de_cultura_digital' },
      { abbr: 'REA.QUIM',  subjectId: 'G2_reacciones_químicas_y_conservación_de_la' },
      { abbr: 'ESPA.SOC',  subjectId: 'G2_espacio_y_sociedad' },
      { abbr: 'C.SOC',     subjectId: 'G2_ciencias_sociales_iii' },
      { abbr: 'COM.VIR',   subjectId: 'G2_comunidades_virtuales' },
      { abbr: 'MANT.RED',  subjectId: 'G2_mantenimiento_de_redes_de_cómputo' },
      { abbr: 'ACT.ART',   subjectId: 'G2_actividades_artísticas_y_culturales_i' },
      { abbr: 'SEX.GEN',   subjectId: 'G2_educación_integral_en_sexualidad_y_géner' },
      { abbr: 'IGUAL',     subjectId: 'G2_temas_selectos_de_igualdad_y_derechos_hu' },
    ],
  },
};

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

function readSheet(wb, sheetName, cfg) {
  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const rows = [];
  // Headers en filas 0-3, datos desde fila 4
  for (let i = 4; i < data.length; i++) {
    const row = data[i];
    const num = row[0];
    if (typeof num !== 'number' || num < 1) continue;
    const nombre = String(row[1] || '').trim();
    if (!nombre) continue;
    // Pares (F, C) empezando en col 2
    const subjects = {};
    cfg.subjects.forEach((s, idx) => {
      const fCol = 2 + idx * 2;
      const cCol = 3 + idx * 2;
      const f = row[fCol], c = row[cCol];
      const faltas = (f === '' || f === null || f === undefined) ? null : Number(f);
      const cal = (c === '' || c === null || c === undefined) ? null : Number(c);
      subjects[s.subjectId] = { faltas, cal };
    });
    rows.push({ num, groupId: cfg.groupId, nombreCompleto: nombre, subjects });
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
    console.log(`  ${name} (${cfg.groupId}): ${rows.length} alumnos · ${cfg.subjects.length} materias`);
    cuadroRows.push(...rows);
  });
  console.log();

  console.log('Cargando datos de Firestore...');
  const [students, grades] = await Promise.all([
    listAll('students'),
    listAll('grades'),
  ]);

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
    let stu = groupStudents.find(s =>
      s.groupId === cuadro.groupId && normalize(s.nombreCompleto) === nombreNorm
    );
    if (!stu) {
      const parts = nombreNorm.split(' ');
      stu = groupStudents.find(s => {
        if (s.groupId !== cuadro.groupId) return false;
        const sn = normalize(s.nombreCompleto);
        return parts.length >= 2 && sn.includes(parts[0]) && sn.includes(parts[parts.length - 1]);
      });
    }
    if (!stu) {
      notFound.push({ cuadro: cuadro.nombreCompleto, groupId: cuadro.groupId, num: cuadro.num });
      continue;
    }

    const subjects = SHEET_CONFIG[Object.keys(SHEET_CONFIG).find(k => SHEET_CONFIG[k].groupId === cuadro.groupId)].subjects;
    for (const subj of subjects) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      const cuadroFaltas = cuadro.subjects[subj.subjectId].faltas;
      if (cuadroCal === null && cuadroFaltas === null) continue;

      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];

      // GUARDA: rechaza si turno NO VESPERTINO
      if (g && g.turno && g.turno !== EXPECTED_TURNO) {
        console.warn(`⚠️  GUARDA: ${stu.nombreCompleto} - ${subj.abbr} turno=${g.turno}, esperado ${EXPECTED_TURNO}. SKIP.`);
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
  console.log(`⚠️  Skipped guarda turno: ${totalTurnoSkipped}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  const calDiscreps = discrepancies.filter(d => d.tipo !== 'SOLO_FALTAS');
  console.log(`Discrepancias de calificación: ${calDiscreps.length}\n`);

  console.log('=== DISCREPANCIAS DE CAL ===');
  calDiscreps.forEach((d, i) => {
    const grupo = d.groupId.replace('VESPERTINO_', '');
    console.log(`${(i+1).toString().padStart(2)}. V-${grupo} #${d.num} ${d.alumno.substring(0,30).padEnd(30)} ${d.materia.padEnd(10)} | Cuadro=${d.cuadroCal} | Firestore=${d.fsCal}${d.teacherName ? ' (' + d.teacherName.substring(0,25) + ')' : ''}`);
  });

  if (notFound.length > 0) {
    console.log(`\n=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.forEach(n => console.log(`  ${n.groupId} #${n.num}: ${n.cuadro}`));
  }

  const csvFile = path.join(__dirname, 'discrepancies-orientacion-3-2-2-1-vesp.csv');
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

  const jsonFile = path.join(__dirname, 'discrepancies-orientacion-3-2-2-1-vesp.json');
  fs.writeFileSync(jsonFile, JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);
  console.log(`JSON: ${jsonFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
