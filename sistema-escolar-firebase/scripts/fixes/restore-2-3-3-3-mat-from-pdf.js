/**
 * Aplica las 2 correcciones confirmadas por Olivia contra los PDFs oficiales:
 *   - ALEMAN GONZALEZ JAIME (MAT 2-3): T.S. Igualdad IV → cal=10
 *   - GONZALEZ RAMOS ANGEL DAVID (MAT 3-3): T.S. Filosofía → cal=5
 *
 * Las otras 3 discrepancias (BLANCAS REYES, CRUZ VELAZQUEZ, ZUÑIGA SOLORZANO)
 * eran errores de transcripción del Excel; Firestore ya tenía el valor correcto.
 *
 * USO:
 *   node scripts/fixes/restore-2-3-3-3-mat-from-pdf.js           # dry-run
 *   node scripts/fixes/restore-2-3-3-3-mat-from-pdf.js --apply
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN = !process.argv.includes('--apply');
const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

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

function reqPatch(p, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'firestore.googleapis.com', path: p, method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej);
    req.write(data); req.end();
  });
}

function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') {
      if (Number.isInteger(v)) out[k] = { integerValue: String(v) };
      else out[k] = { doubleValue: v };
    } else if (typeof v === 'string') out[k] = { stringValue: v };
  }
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

// IMPORTANTE: solo se tocan cal, rubros y suma. Las faltas NO se modifican
// porque Olivia solo confirmó las calificaciones contra el PDF. Cualquier
// cambio en faltas requiere autorización separada.
const FIXES = [
  {
    studentName: 'ALEMAN GONZALEZ JAIME',
    docIdHint: '_G2_temas_selectos_de_igualdad_y_derechos_hu_P1',
    groupId: 'MATUTINO_2-3',
    // cal=10 → ec=8, tr=2, pe=0 → suma=10
    newValues: { ec: 8, tr: 2, pe: 0, suma: 10, cal: 10, value: 10 },
  },
  {
    studentName: 'GONZALEZ RAMOS ANGEL DAVID',
    docIdHint: '_G3_temas_selectos_de_filosofía_P1',
    groupId: 'MATUTINO_3-3',
    // cal=5 → ec=3, tr=2, pe=0 → suma=5, calcCal(5)=5 (porque <6 → 5)
    newValues: { ec: 3, tr: 2, pe: 0, suma: 5, cal: 5, value: 5 },
  },
];

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

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  // Buscar studentIds
  const students = await listAll('students');
  const studentMap = students.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));

  for (const fix of FIXES) {
    const stu = studentMap.find(s =>
      (s.groupId || s.grupo) === fix.groupId &&
      (s.nombreCompleto || '').toUpperCase() === fix.studentName
    );
    if (!stu) {
      console.log(`⚠️  No encontrado: ${fix.studentName} (${fix.groupId})`);
      continue;
    }
    const docId = `${stu.docId}${fix.docIdHint}`;
    const docUrl = encodeURIComponent(docId);

    // Leer estado actual
    let beforeData = {};
    try {
      const before = await reqGet(`${BASE}/grades/${docUrl}`);
      beforeData = parseFields(before.fields);
    } catch (e) {
      console.log(`⚠️  Doc no existe: grades/${docId}`);
    }

    console.log(`📌 ${fix.studentName} (${fix.groupId})`);
    console.log(`   docId: ${docId}`);
    console.log(`   ANTES:  ec=${beforeData.ec} tr=${beforeData.tr} pe=${beforeData.pe} → suma=${beforeData.suma} cal=${beforeData.cal} faltas=${beforeData.faltas}`);
    console.log(`   NUEVO:  ec=${fix.newValues.ec} tr=${fix.newValues.tr} pe=${fix.newValues.pe} → suma=${fix.newValues.suma} cal=${fix.newValues.cal} faltas=${fix.newValues.faltas}`);

    if (DRY_RUN) {
      console.log(`   (dry-run)\n`);
      continue;
    }
    try {
      const fields = Object.keys(fix.newValues);
      const mask = fields.map(f => `updateMask.fieldPaths=${f}`).join('&');
      const url = `${BASE}/grades/${docUrl}?${mask}`;
      await reqPatch(url, { fields: toFirestoreFields(fix.newValues) });
      console.log(`   ✓ APLICADO\n`);
    } catch (e) {
      console.log(`   ✗ ERROR: ${e.message}\n`);
    }
  }
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
