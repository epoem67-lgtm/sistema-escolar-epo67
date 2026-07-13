/**
 * Compara "cuadros OLI (2).xlsx" contra Firestore para
 * MATUTINO_2-3 (G2, 13 materias) y MATUTINO_3-3 (G3, 12 materias).
 *
 * El Excel es transcripción de los PDFs oficiales (cuadros firmados de
 * los maestros). Si hay discrepancia, se le verifica contra el PDF antes
 * de aplicar.
 *
 * GUARDA: rechaza match si grade.turno !== MATUTINO.
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

const XLSX_PATH = '/Users/oliolix/Downloads/cuadros OLI (2).xlsx';
const EXPECTED_TURNO = 'MATUTINO';

// Mapping por hoja
const SHEET_CONFIG = {
  '3-3': {
    groupId: 'MATUTINO_3-3',
    headerRow: 4,     // headers están en fila 4
    dataStartRow: 5,  // datos desde fila 5
    nameCols: { pat: 0, mat: 1, nom: 2 },
    // Cols 3 en adelante (D..O) → 12 materias en este orden
    subjects: [
      { col: 3,  abbr: 'C.COM',     subjectId: 'G3_ciencias_de_la_comunicación_i' },
      { col: 4,  abbr: 'T.S.ING',   subjectId: 'G3_temas_selectos_de_inglés_ii' },
      { col: 5,  abbr: 'T.S.MAT',   subjectId: 'G3_temas_selectos_de_matemáticas_ii' },
      { col: 6,  abbr: 'CON.HIS',   subjectId: 'G3_conciencia_histórica_iii' },
      { col: 7,  abbr: 'ORG',       subjectId: 'G3_organismos' },
      { col: 8,  abbr: 'T.S.FILO',  subjectId: 'G3_temas_selectos_de_filosofía' },
      { col: 9,  abbr: 'ECON',      subjectId: 'G3_economía_i' },
      { col: 10, abbr: 'PAG.WEB',   subjectId: 'G3_páginas_web' },
      { col: 11, abbr: 'D.DIG',     subjectId: 'G3_diseño_digital' },
      { col: 12, abbr: 'AC.ART',    subjectId: 'G3_actividades_artísticas_y_culturales_iii' },
      { col: 13, abbr: 'PRAC',      subjectId: 'G3_práctica_y_colaboración_ciudadana_ii' },
      { col: 14, abbr: 'T.S.IGUAL', subjectId: 'G3_temas_selectos_de_igualdad_y_derechos_hu' },
    ],
  },
  '2-3 (2)': {
    groupId: 'MATUTINO_2-3',
    headerRow: 0,
    dataStartRow: 1,
    nameCols: { pat: 0, mat: 1, nom: 2 },
    // Cols 3 en adelante. La col 13 (N) está vacía (placeholder).
    // 13 materias reales + 1 col vacía a saltar
    subjects: [
      { col: 3,  abbr: 'PEN.LIT',   subjectId: 'G2_pensamiento_literario' },
      { col: 4,  abbr: 'ING',       subjectId: 'G2_inglés_iv' },
      { col: 5,  abbr: 'T.S.MAT',   subjectId: 'G2_temas_selectos_de_matemáticas_i' },
      { col: 6,  abbr: 'C.HIS',     subjectId: 'G2_conciencia_histórica_i' },
      { col: 7,  abbr: 'TAL.CUL',   subjectId: 'G2_taller_de_cultura_digital' },
      { col: 8,  abbr: 'REA.QUIM',  subjectId: 'G2_reacciones_químicas_y_conservación_de_la' },
      { col: 9,  abbr: 'ESP.SOC',   subjectId: 'G2_espacio_y_sociedad' },
      { col: 10, abbr: 'C.SOC',     subjectId: 'G2_ciencias_sociales_iii' },
      { col: 11, abbr: 'COM.VIRT',  subjectId: 'G2_comunidades_virtuales' },
      { col: 12, abbr: 'MTO.RED',   subjectId: 'G2_mantenimiento_de_redes_de_cómputo' },
      // col 13 vacía (skip)
      { col: 14, abbr: 'AC.ART',    subjectId: 'G2_actividades_artísticas_y_culturales_i' },
      { col: 15, abbr: 'EIS.G',     subjectId: 'G2_educación_integral_en_sexualidad_y_géner' },
      { col: 16, abbr: 'T.S.IGUAL', subjectId: 'G2_temas_selectos_de_igualdad_y_derechos_hu' },
    ],
  },
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
    cfg.subjects.forEach(s => {
      const v = row[s.col];
      const cal = (v === '' || v === null || v === undefined) ? null : Number(v);
      subjects[s.subjectId] = { cal: isNaN(cal) ? null : cal };
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
    console.log(`  ${name} (${cfg.groupId}): ${rows.length} alumnos · ${cfg.subjects.length} materias`);
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

    const cfg = SHEET_CONFIG[Object.keys(SHEET_CONFIG).find(k => SHEET_CONFIG[k].groupId === cuadro.groupId)];
    for (const subj of cfg.subjects) {
      const cuadroCal = cuadro.subjects[subj.subjectId].cal;
      if (cuadroCal === null) continue;
      const g = gradeIdx[`${stu.id}|${subj.subjectId}`];

      if (g && g.turno && g.turno !== EXPECTED_TURNO) {
        console.warn(`⚠️  GUARDA: ${stu.nombreCompleto} - ${subj.abbr} turno=${g.turno}. SKIP.`);
        totalTurnoSkipped++; continue;
      }

      const fsCal = g ? (g.cal !== undefined ? g.cal : g.value) : null;
      totalCompared++;

      const calMatch = Number(fsCal) === Number(cuadroCal);
      if (calMatch) {
        totalMatched++;
      } else {
        discrepancies.push({
          groupId: cuadro.groupId, alumno: stu.nombreCompleto, studentId: stu.id,
          materia: subj.abbr, subjectId: subj.subjectId,
          cuadroCal, fsCal, docId: g ? g.id : null,
          existeEnFirestore: !!g, teacherName: g ? g.teacherName : null,
        });
      }
    }
  }

  console.log(`📊 Total comparaciones: ${totalCompared}`);
  console.log(`✓ Coinciden: ${totalMatched}`);
  console.log(`❌ Discrepancias: ${discrepancies.length}`);
  console.log(`⚠️  Skipped guarda turno: ${totalTurnoSkipped}`);
  console.log(`❓ Alumnos no encontrados: ${notFound.length}\n`);

  console.log('=== DISCREPANCIAS ===');
  discrepancies.forEach((d, i) => {
    const grupo = d.groupId.replace('MATUTINO_', '');
    console.log(`${(i+1).toString().padStart(3)}. M-${grupo} ${d.alumno.substring(0,32).padEnd(32)} ${d.materia.padEnd(10)} | Cuadro=${d.cuadroCal} | Firestore=${d.fsCal}${d.teacherName ? ' (' + d.teacherName.substring(0,25) + ')' : ''}`);
  });

  if (notFound.length > 0) {
    console.log(`\n=== ${notFound.length} ALUMNOS NO ENCONTRADOS ===`);
    notFound.slice(0, 20).forEach(n => console.log(`  ${n.groupId}: ${n.cuadro}`));
  }

  const csvFile = path.join(__dirname, 'discrepancies-cuadros-oli-2-3-3-3-mat.csv');
  const csvLines = ['groupId,alumno,studentId,materia,subjectId,cuadroCal,fsCal,docId,maestro'];
  discrepancies.forEach(d => {
    csvLines.push([
      d.groupId, `"${d.alumno.replace(/"/g, '""')}"`, d.studentId,
      d.materia, d.subjectId, d.cuadroCal, d.fsCal ?? '',
      d.docId || '', `"${(d.teacherName || '').replace(/"/g, '""')}"`,
    ].join(','));
  });
  fs.writeFileSync(csvFile, csvLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'discrepancies-cuadros-oli-2-3-3-3-mat.json'), JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`\nCSV: ${csvFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
