/**
 * Compara Excel "1er eval_2do sem_25-26 (2).xlsx" contra Firestore.
 * VESPERTINO 1-3 (1° sem 2°, 11 materias), 3-1 (5° sem, 12 materias),
 * 3-3 (5° sem, 12 materias).
 *
 * Cada hoja tiene config diferente:
 *  - 1-3: cols 0-1 H/M, 2-4 nombre, 5+ pares F/CF (11 mats)
 *  - 3-1: cols 0-1 H/M, 2-4 nombre, 5+ pares F/CF (12 mats)
 *  - 3-3: cols 0-1 H/M, 2 matrícula, 3 EXP, 4-6 nombre, 7+ pares F/CF (12 mats)
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

const XLSX_PATH = '/Users/oliolix/Downloads/1er eval_2do sem_25-26 (2).xlsx';
const EXPECTED_TURNO = 'VESPERTINO';

const SHEET_CONFIG = {
  '1-3 T.V': {
    groupId: 'VESPERTINO_1-3',
    dataStartRow: 10,
    nameCols: { pat: 2, mat: 3, nom: 4 },
    firstFCol: 5,
    subjects: [
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
    ],
  },
  '3-1 T.V': {
    groupId: 'VESPERTINO_3-1',
    dataStartRow: 10,
    nameCols: { pat: 2, mat: 3, nom: 4 },
    firstFCol: 5,
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
  '3-3 T.V': {
    groupId: 'VESPERTINO_3-3',
    dataStartRow: 10,
    nameCols: { pat: 4, mat: 5, nom: 6 },  // tiene matrícula y EXP antes
    firstFCol: 7,
    subjects: [  // mismo orden que 3-1, aunque Excel diga "pensamiento matemático" es realmente t.s. matemáticas
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
  for (let i = cfg.dataStartRow; i < data.length; i++) {
    const row = data[i];
    // El N (col 0) o P (col 1) tiene el número de lista
    const hasNum = (typeof row[0] === 'number' && row[0] > 0) || (typeof row[1] === 'number' && row[1] > 0);
    if (!hasNum) continue;
    const num = (typeof row[0] === 'number' && row[0] > 0) ? row[0] : row[1];
    const apPat = String(row[cfg.nameCols.pat] || '').trim();
    const apMat = String(row[cfg.nameCols.mat] || '').trim();
    const nombres = String(row[cfg.nameCols.nom] || '').trim();
    if (!apPat) continue;
    const nombreCompleto = `${apPat} ${apMat} ${nombres}`.replace(/\s+/g, ' ').trim();

    const subjects = {};
    cfg.subjects.forEach((s, idx) => {
      const fCol = cfg.firstFCol + idx * 2;
      const cCol = cfg.firstFCol + 1 + idx * 2;
      const f = row[fCol], c = row[cCol];
      const faltas = (f === '' || f === null || f === undefined) ? null : Number(f);
      const cal = (c === '' || c === null || c === undefined) ? null : Number(c);
      subjects[s.subjectId] = { faltas, cal };
    });
    rows.push({ num, groupId: cfg.groupId, nombreCompleto, apPat: normalize(apPat), nombres: normalize(nombres), subjects });
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
        return parts.length >= 2 && sn.includes(parts[0]) && (parts[1] && sn.includes(parts[1]));
      });
    }
    if (!stu) {
      notFound.push({ cuadro: cuadro.nombreCompleto, groupId: cuadro.groupId, num: cuadro.num });
      continue;
    }

    const cfg = SHEET_CONFIG[Object.keys(SHEET_CONFIG).find(k => SHEET_CONFIG[k].groupId === cuadro.groupId)];
    for (const subj of cfg.subjects) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      const cuadroFaltas = cuadro.subjects[subj.subjectId].faltas;
      if (cuadroCal === null && cuadroFaltas === null) continue;

      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];

      // GUARDA: rechaza si turno NO vespertino
      if (g && g.turno && g.turno !== EXPECTED_TURNO) {
        console.warn(`⚠️  GUARDA: ${stu.nombreCompleto} - ${subj.abbr} turno=${g.turno}. SKIP.`);
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

  const csvFile = path.join(__dirname, 'discrepancies-orientacion-1-3-3-1-3-3-vesp.csv');
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

  const jsonFile = path.join(__dirname, 'discrepancies-orientacion-1-3-3-1-3-3-vesp.json');
  fs.writeFileSync(jsonFile, JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);
  console.log(`JSON: ${jsonFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
