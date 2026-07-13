/**
 * Compara los valores del CUADRO OFICIAL FIRMADO de la maestra
 * MA. GUADALUPE GRANADOS DE LOERA (1-2 matutino · Ciencias Sociales II · P1)
 * contra los valores actuales en Firestore.
 *
 * El cuadro oficial es la "fuente de verdad" — fue capturado por la maestra,
 * firmado por los alumnos y entregado a Dirección antes del cierre.
 *
 * Output: tabla con discrepancias detalladas + sugerencia de restauración.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

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

function calcSuma(ec, tr, pe) {
  const total = (Number(ec) || 0) + (Number(tr) || 0) + (Number(pe) || 0);
  return Math.min(total, 10);
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return null;
  const s = Math.min(Number(suma), 10);
  if (isNaN(s)) return null;
  if (s >= 6) return Math.min(Math.round(s), 10);
  return 5;
}

// ─── CUADRO OFICIAL DE LA MAESTRA — transcripción manual de la foto ───
// Fuente: WhatsApp Image 2026-06-02 at 10.12.07 AM.jpeg (cuadro impreso)
// Profesora: MA. GUADALUPE GRANADOS DE LOERA
// Ciencias Sociales II · 1°-2 Matutino · PRIMER PARCIAL
// Horas impartidas: febrero=6, marzo=10, total=16
const CUADRO = [
  // [num, "APELLIDO1 APELLIDO2 NOMBRES", ec, tr, pe, suma_esperada, cal_esperada, faltas]
  [1,  'AGUIRRE DELFIN YAHIR',                7.0, 2.0, 0, 9.0,  9, 0],
  [2,  'AMBROSIO RAMIREZ ALEXANDRA',          8.0, 2.0, 0, 10.0, 10, 0],
  [3,  'AVILA MORALES EDWIN ADAHIR',          8.0, 2.0, 0, 10.0, 10, 0],
  [4,  'AVILA RAMIREZ SANTIAGO',              8.0, 2.0, 0, 10.0, 10, 0],
  [5,  'BARRAZA MONTELONGO STEFANY YANELI',   8.0, 2.0, 0, 10.0, 10, 0],
  [6,  'BECERRA FLORES HADE JETZABEL',        8.0, 2.0, 1, 11.0, 10, 0],
  [7,  'BELLO CHAVEZ EMILIO SEBASTIAN',       6.0, 2.0, 0, 8.0,  8, 0],
  [8,  'CASAS GARCIA ZEUS ANTHUAN',           6.0, 2.0, 0, 8.0,  8, 0],
  [9,  'CHICO ORTIZ ALAN',                    6.0, 2.0, 0, 8.0,  8, 2],
  [10, 'COLIN GARCIA DONOBAN RODRIGO',        4.0, 2.0, 1, 7.0,  7, 0],
  [11, 'CONTRERAS QUIJADA LEONARDO',          6.0, 2.0, 0, 8.0,  8, 2],
  [12, 'COVARRUBIAS ACOSTA SAMANTHA ANGELINE',8.0, 2.0, 0, 10.0, 10, 0],
  [13, 'CRUZ GALVEZ PARIS EMILIANO',          7.0, 2.0, 0, 9.0,  9, 2],
  [14, 'CRUZ OROPEZA REBECA JANELLE',         8.0, 2.0, 0, 10.0, 10, 2],
  [15, 'ELIZALDE MOLINA BARBARA SOFIA',       8.0, 2.0, 0, 10.0, 10, 0],
  [16, 'ENCINIAS RODRIGUEZ CESAR ROBERTO',    8.0, 2.0, 0, 10.0, 10, 0],
  [17, 'ESTRADA VARGAS JESUS SANTIAGO',       4.0, 2.0, 0, 6.0,  6, 0],
  [18, 'FINKENTHAL RAMIREZ ALENKA',           7.0, 2.0, 1, 10.0, 10, 0],
  [19, 'FLORES PEREZ ROBERTO',                7.0, 2.0, 0, 9.0,  9, 0],
  [20, 'FLORES RODRIGUEZ FRANCISCO ISAAC',    7.0, 2.0, 1, 10.0, 10, 0],
  [21, 'GONZALEZ GONZALEZ ANGELA PAULINA',    8.0, 2.0, 1, 11.0, 10, 2],
  [22, 'GONZALEZ TREJO LESLIE XIMENA',        8.0, 2.0, 0, 10.0, 10, 0],
  [23, 'HERNANDEZ GARCIA EMILY',              8.0, 2.0, 0, 10.0, 10, 0],
  [24, 'HERNANDEZ GARCIA SAMANTA',            4.0, 2.0, 0, 6.0,  6, 4],
  [25, 'HERRERA JIMENEZ JOSUE ABISAI',        4.0, 2.0, 0, 6.0,  6, 2],
  [26, 'JIMENEZ PACHUCA LUIS ANTONIO',        8.0, 2.0, 0, 10.0, 10, 0],
  [27, 'LEGORRETA HERNANDEZ LILIANA',         7.0, 2.0, 0, 9.0,  9, 0],
  [28, 'LOPEZ HERNANDEZ KARINA',              7.0, 2.0, 0, 9.0,  9, 0],
  [29, 'LUGO SOLARES YAIR EMILIANO',          4.0, 2.0, 0, 6.0,  6, 0],
  // alumno #30 - LUNA FRANCISCO SAMANTHA ITZEL: aparece sin captura / posible BAJA
  // [30, 'LUNA FRANCISCO SAMANTHA ITZEL',       null, null, null, null, null, null],
  [31, 'MARENTES ROBLES LUZ NATALIA',         8.0, 2.0, 0, 10.0, 10, 0],
  [32, 'MARTINEZ HERNANDEZ JOHAN ISAI',       7.0, 2.0, 0, 9.0,  9, 2],
  [33, 'MARTINEZ IBARRA JOHAN',               8.0, 2.0, 0, 10.0, 10, 0],
  // [34, 'MANCILLA ZIT ZUREL',                  4.0, 2.0, 0, 6.0,  6, 0],
];

const SUBJECT_ID = 'G1_ciencias_sociales_ii';
const PARTIAL = 'P1';
const GROUP_ID = 'MATUTINO_1-2';

function normalize(s) {
  return (s || '').toUpperCase()
    .replace(/[À-ÿ]/g, c => ({'Á':'A','É':'E','Í':'I','Ó':'O','Ú':'U','Ñ':'N','á':'A','é':'E','í':'I','ó':'O','ú':'U','ñ':'N'}[c] || c))
    .replace(/\s+/g, ' ').trim();
}

(async () => {
  console.log('Cargando datos...');
  const [students, grades] = await Promise.all([
    listAll('students'),
    listAll('grades'),
  ]);

  // Filtrar alumnos del 1-2 matutino
  const groupStudents = students
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(s => (s.groupId === GROUP_ID || s.grupo === GROUP_ID));

  console.log(`Total alumnos en ${GROUP_ID}: ${groupStudents.length}`);

  // Grades de P1 Ciencias Sociales de este grupo
  const stuIds = new Set(groupStudents.map(s => s.id));
  const csGrades = grades
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(g => g.subjectId === SUBJECT_ID && g.partial === PARTIAL && stuIds.has(g.studentId));

  console.log(`Grades P1 Ciencias Sociales de ${GROUP_ID}: ${csGrades.length}\n`);

  // Indexar grades por studentId
  const gradeByStu = {};
  csGrades.forEach(g => { gradeByStu[g.studentId] = g; });

  // ─── COMPARACIÓN ─────────────────────────────────────────────────
  console.log('━'.repeat(120));
  console.log('Nº  ALUMNO                                | CUADRO (ec,tr,pe,cal) | FIRESTORE (ec,tr,pe,cal) | ESTADO');
  console.log('━'.repeat(120));

  const discrepancies = [];
  const okItems = [];

  for (const row of CUADRO) {
    const [num, nombreCuadro, ec_o, tr_o, pe_o, suma_o, cal_o, faltas_o] = row;
    const nombreNorm = normalize(nombreCuadro);
    let stu = groupStudents.find(s => normalize(s.nombreCompleto) === nombreNorm);
    if (!stu) {
      // Try partial match: primer apellido + primer nombre
      const parts = nombreNorm.split(' ');
      stu = groupStudents.find(s => {
        const sn = normalize(s.nombreCompleto);
        return parts[0] && parts[2] && sn.includes(parts[0]) && sn.includes(parts[2]);
      });
    }
    if (!stu) {
      console.log(`${String(num).padStart(2)}. ❓ ${nombreCuadro.padEnd(40)} | NO ENCONTRADO en students`);
      continue;
    }
    const g = gradeByStu[stu.id];
    if (!g) {
      console.log(`${String(num).padStart(2)}. ⚠️  ${nombreCuadro.padEnd(40)} | SIN GRADE en Firestore`);
      continue;
    }
    const ec_f = g.ec ?? 0, tr_f = g.tr ?? 0, pe_f = g.pe ?? 0, cal_f = g.cal ?? '?';
    const ec_match = Number(ec_f) === Number(ec_o);
    const tr_match = Number(tr_f) === Number(tr_o);
    const pe_match = Number(pe_f) === Number(pe_o);
    const cal_match = Number(cal_f) === Number(cal_o);
    const allMatch = ec_match && tr_match && pe_match && cal_match;
    const estado = allMatch ? '✓ OK' : '❌ DISCREPANCIA';
    console.log(`${String(num).padStart(2)}. ${stu.nombreCompleto.substring(0,40).padEnd(40)} | (${ec_o},${tr_o},${pe_o},${cal_o}) → (${ec_f},${tr_f},${pe_f},${cal_f}) ${estado}`);
    if (!allMatch) {
      discrepancies.push({
        num, alumno: stu.nombreCompleto, studentId: stu.id,
        cuadro: { ec: ec_o, tr: tr_o, pe: pe_o, suma: suma_o, cal: cal_o, faltas: faltas_o },
        firestore: { ec: ec_f, tr: tr_f, pe: pe_f, suma: g.suma, cal: cal_f, faltas: g.faltas },
        docId: g.id,
      });
    } else {
      okItems.push(num);
    }
  }

  console.log('━'.repeat(120));
  console.log(`\n📊 RESUMEN:`);
  console.log(`   ✓ Coinciden: ${okItems.length}/${CUADRO.length}`);
  console.log(`   ❌ Discrepancias: ${discrepancies.length}/${CUADRO.length}\n`);

  if (discrepancies.length > 0) {
    console.log('=== ALUMNOS A RESTAURAR (Cuadro firmado dice diferente que Firestore) ===\n');
    discrepancies.forEach(d => {
      console.log(`📌 #${d.num} ${d.alumno}`);
      console.log(`   CUADRO:     ec=${d.cuadro.ec} tr=${d.cuadro.tr} pe=${d.cuadro.pe} → suma=${d.cuadro.suma} cal=${d.cuadro.cal} faltas=${d.cuadro.faltas}`);
      console.log(`   FIRESTORE:  ec=${d.firestore.ec} tr=${d.firestore.tr} pe=${d.firestore.pe} → suma=${d.firestore.suma} cal=${d.firestore.cal} faltas=${d.firestore.faltas}`);
      console.log(`   docId:      ${d.docId}`);
      console.log();
    });
  }

  // Guardar JSON con discrepancias para que el script de fix las use
  const outFile = path.join(__dirname, 'discrepancies-1-2-cs-p1.json');
  fs.writeFileSync(outFile, JSON.stringify(discrepancies, null, 2), 'utf8');
  console.log(`JSON guardado: ${outFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
