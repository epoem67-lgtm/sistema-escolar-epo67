/**
 * Compara "EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1-20260511 (1).xlsx"
 * contra Firestore para MATUTINO_1-1, 1-2, 1-3 (G1, 11 materias).
 *
 * IMPORTANTE: Olivia pidió verificar que las correcciones previas se
 * mantengan. Lista de correcciones aplicadas en sesiones previas:
 *   - Sara Daniela Romero (MAT 1-1, Pens. Mat.): cal=10
 *   - Samanta Covarrubias (MAT 1-2, C. Sociales): cal=10
 *   - 7 alumnas más en MAT 1-2 C. Sociales (Ambrosio, Becerra, Gonzalez,
 *     Legorreta, Lopez, Marentes, Martinez): cal según cuadro Granados.
 *
 * Si el Excel reporta un valor distinto a la corrección aplicada, lo marco
 * con [⚠️ AFECTA CORRECCIÓN].
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

const XLSX_PATH = '/Users/oliolix/Downloads/EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1-20260511 (1).xlsx';
const EXPECTED_TURNO = 'MATUTINO';

const SUBJECTS_G1 = [
  { abbr: 'LEN.COM',   subjectId: 'G1_lengua_y_comunicación_ii' },
  { abbr: 'ING',       subjectId: 'G1_inglés_ii' },
  { abbr: 'PEN.MAT',   subjectId: 'G1_pensamiento_matemático_ii' },
  { abbr: 'CUL.DIG',   subjectId: 'G1_cultura_digital_ii' },
  { abbr: 'CIE.NAT',   subjectId: 'G1_ciencias_naturales_experimentales_y_tecn' },
  { abbr: 'PEN.FIL',   subjectId: 'G1_pensamiento_filosófico_y_humanidades_ii' },
  { abbr: 'CIE.SOC',   subjectId: 'G1_ciencias_sociales_ii' },
  { abbr: 'TAL.CIE',   subjectId: 'G1_taller_de_ciencias_i' },
  { abbr: 'ACT.FIS',   subjectId: 'G1_actividades_físicas_y_deportivas_ii' },
  { abbr: 'EDU.SAL',   subjectId: 'G1_educación_para_la_salud_ii' },
  { abbr: 'IGU.DER',   subjectId: 'G1_temas_selectos_de_igualdad_y_derechos_hu' },
];

const SHEET_CONFIG = {
  '1°1': { groupId: 'MATUTINO_1-1', dataStartRow: 7, nameCols: { pat: 1, mat: 2, nom: 3 }, firstFCol: 4 },
  '1°2': { groupId: 'MATUTINO_1-2', dataStartRow: 7, nameCols: { pat: 1, mat: 2, nom: 3 }, firstFCol: 4 },
  '1°3': { groupId: 'MATUTINO_1-3', dataStartRow: 7, nameCols: { pat: 1, mat: 2, nom: 3 }, firstFCol: 4 },
};

// CORRECCIONES APLICADAS PREVIAMENTE — para alertar si Excel difiere
const PREV_CORRECTIONS = [
  { alumno: 'ROMERO DOMINGEZ SARA DANIELA', groupId: 'MATUTINO_1-1', subjectId: 'G1_pensamiento_matemático_ii', appliedCal: 10, note: 'Restauración Pens.Mat (9 → 10)' },
  { alumno: 'COVARRUBIAS ACOSTA SAMANTHA ANGELINE', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (8 → 10)' },
  { alumno: 'AMBROSIO RAMIREZ ALEXANDRA', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (9 → 10)' },
  { alumno: 'BECERRA FLORES HADE JETZABEL', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (pe corrigido)' },
  { alumno: 'GONZALEZ GONZALEZ ANGELA PAULINA', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (pe corrigido)' },
  { alumno: 'LEGORRETA HERNANDEZ LILIANA', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 9, note: 'Restauración C.Sociales (10 → 9)' },
  { alumno: 'LOPEZ HERNANDEZ KARINA', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 9, note: 'Restauración C.Sociales (8 → 9)' },
  { alumno: 'MARENTES ROBLES LUZ NATALIA', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (8 → 10)' },
  { alumno: 'MARTINEZ IBARRA JOHAN ISAI', groupId: 'MATUTINO_1-2', subjectId: 'G1_ciencias_sociales_ii', appliedCal: 10, note: 'Restauración C.Sociales (9 → 10)' },
];

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
    SUBJECTS_G1.forEach((s, idx) => {
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
    console.log(`  ${name} (${cfg.groupId}): ${rows.length} alumnos · 11 materias`);
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

    for (const subj of SUBJECTS_G1) {
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
        // Detectar si esta discrepancia afecta una corrección previa
        const stuNameNorm = normalize(stu.nombreCompleto);
        const prevCorr = PREV_CORRECTIONS.find(p =>
          p.groupId === cuadro.groupId &&
          p.subjectId === subj.subjectId &&
          normalize(p.alumno) === stuNameNorm
        );
        discrepancies.push({
          groupId: cuadro.groupId, alumno: stu.nombreCompleto, studentId: stu.id,
          materia: subj.abbr, subjectId: subj.subjectId,
          cuadroCal, cuadroFaltas, fsCal, fsFaltas,
          tipo: !calMatch && !faltasMatch ? 'CAL_Y_FALTAS' : (!calMatch ? 'SOLO_CAL' : 'SOLO_FALTAS'),
          docId: g ? g.id : null,
          teacherName: g ? g.teacherName : null,
          afectaCorreccion: !!prevCorr,
          correccionNota: prevCorr ? prevCorr.note : null,
        });
      }
    }
  }

  console.log(`📊 Total comparaciones: ${totalCompared}`);
  console.log(`✓ Coinciden: ${totalMatched}`);
  console.log(`❌ Discrepancias: ${discrepancies.length}`);
  console.log(`⚠️  Skipped guarda turno: ${totalTurnoSkipped}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  // Separar discrepancias que afectan correcciones vs. el resto
  const calDiscreps = discrepancies.filter(d => d.tipo !== 'SOLO_FALTAS');
  const afectanCorrecciones = calDiscreps.filter(d => d.afectaCorreccion);
  const otrasCalDiscreps = calDiscreps.filter(d => !d.afectaCorreccion);
  const onlyFaltasDiscreps = discrepancies.filter(d => d.tipo === 'SOLO_FALTAS');

  console.log(`Por tipo:`);
  console.log(`   Discrepancias CAL que AFECTAN correcciones previas: ${afectanCorrecciones.length}`);
  console.log(`   Otras discrepancias de CAL:                          ${otrasCalDiscreps.length}`);
  console.log(`   Discrepancias solo de FALTAS:                        ${onlyFaltasDiscreps.length}\n`);

  if (afectanCorrecciones.length > 0) {
    console.log('🚨 AFECTAN CORRECCIONES PREVIAS:');
    afectanCorrecciones.forEach((d, i) => {
      const grupo = d.groupId.replace('MATUTINO_', '');
      console.log(`${(i+1).toString().padStart(2)}. M-${grupo} ${d.alumno.substring(0,32).padEnd(32)} ${d.materia.padEnd(8)} | Excel=${d.cuadroCal} ↔ Firestore=${d.fsCal} ── ${d.correccionNota}`);
    });
    console.log();
  }

  if (otrasCalDiscreps.length > 0) {
    console.log('=== OTRAS DISCREPANCIAS DE CAL (verificar contra PDF antes de aplicar) ===');
    otrasCalDiscreps.slice(0, 60).forEach((d, i) => {
      const grupo = d.groupId.replace('MATUTINO_', '');
      const diff = Number(d.cuadroCal) - Number(d.fsCal);
      const arrow = diff > 0 ? '↑' : '↓';
      console.log(`${(i+1).toString().padStart(3)}. M-${grupo} ${d.alumno.substring(0,32).padEnd(32)} ${d.materia.padEnd(8)} | Excel=${d.cuadroCal} ${arrow}${Math.abs(diff)} Firestore=${d.fsCal}${d.teacherName ? ' (' + d.teacherName.substring(0,22) + ')' : ''}`);
    });
    if (otrasCalDiscreps.length > 60) console.log(`  ...y ${otrasCalDiscreps.length - 60} más en CSV`);
  }

  if (notFound.length > 0) {
    console.log(`\n=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.slice(0, 20).forEach(n => console.log(`  ${n.groupId}: ${n.cuadro}`));
  }

  const csvFile = path.join(__dirname, 'discrepancies-salazar-1grado-mat.csv');
  const csvLines = ['groupId,alumno,studentId,materia,subjectId,excelCal,excelFaltas,fsCal,fsFaltas,tipo,afectaCorreccion,correccionNota,docId,maestro'];
  discrepancies.forEach(d => {
    csvLines.push([
      d.groupId, `"${d.alumno.replace(/"/g, '""')}"`, d.studentId,
      d.materia, d.subjectId, d.cuadroCal ?? '', d.cuadroFaltas ?? '',
      d.fsCal ?? '', d.fsFaltas ?? '', d.tipo,
      d.afectaCorreccion ? 'SÍ' : '',
      `"${(d.correccionNota || '').replace(/"/g, '""')}"`,
      d.docId || '', `"${(d.teacherName || '').replace(/"/g, '""')}"`,
    ].join(','));
  });
  fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'discrepancies-salazar-1grado-mat.json'), JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
