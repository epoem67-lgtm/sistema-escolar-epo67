/**
 * Aplica los valores OFICIALES confirmados por Olivia el 3 jun 2026 contra
 * el concentrado "EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1...xlsx".
 *
 * 5 cambios en MAT 1-2 Ciencias Sociales II P1. Revierten/ajustan
 * correcciones previas que se habían basado en el cuadro físico de
 * Granados, pero Olivia confirmó que los valores oficiales son los del
 * concentrado de Salazar:
 *
 *   - AMBROSIO RAMIREZ ALEXANDRA:        10 → 9
 *   - LEGORRETA HERNANDEZ LILIANA:       9 → 10
 *   - LOPEZ HERNANDEZ KARINA:            9 → 8
 *   - MARENTES ROBLES LUZ NATALIA:       10 → 8
 *   - MARTINEZ IBARRA JOHAN ISAI:        10 → 9
 *
 * NO se modifican faltas (Olivia solo confirmó calificación).
 *
 * USO:
 *   node scripts/fixes/revert-1-2-cs-p1-to-salazar-oficial.js           # dry-run
 *   node scripts/fixes/revert-1-2-cs-p1-to-salazar-oficial.js --apply   # aplica
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

const SUBJECT_ID = 'G1_ciencias_sociales_ii';
const PARTIAL_SUFFIX = '_P1';
const GROUP_ID = 'MATUTINO_1-2';

// cal X (con X>=6) → ec=X-2, tr=2, suma=X, cal=X
function rubrosForCal(targetCal) {
  const tr = 2;
  if (targetCal >= 6) {
    const ec = targetCal - tr;
    return { ec, tr, pe: 0, suma: ec + tr, cal: targetCal, value: targetCal };
  }
  // <6 → fija a 5 con suma<6
  return { ec: Math.max(0, targetCal - tr), tr, pe: 0, suma: Math.min(targetCal, 5), cal: 5, value: 5 };
}

// Confirmaciones de Olivia
const FIXES = [
  { studentName: 'AMBROSIO RAMIREZ ALEXANDRA',        targetCal: 9  },
  { studentName: 'LEGORRETA HERNANDEZ LILIANA',       targetCal: 10 },
  { studentName: 'LOPEZ HERNANDEZ KARINA',            targetCal: 8  },
  { studentName: 'MARENTES ROBLES LUZ NATALIA',       targetCal: 8  },
  { studentName: 'MARTINEZ IBARRA JOHAN ISAI',        targetCal: 9  },
].map(f => ({ ...f, newValues: rubrosForCal(f.targetCal) }));

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
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej); req.write(data); req.end();
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
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Total cambios a aplicar: ${FIXES.length}\n`);

  const students = await listAll('students');
  const sMap = students.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));

  for (const fix of FIXES) {
    const stu = sMap.find(s =>
      (s.groupId || s.grupo) === GROUP_ID &&
      (s.nombreCompleto || '').toUpperCase() === fix.studentName
    );
    if (!stu) { console.log(`⚠️  No encontrado: ${fix.studentName}`); continue; }

    const docId = `${stu.docId}_${SUBJECT_ID}${PARTIAL_SUFFIX}`;
    const docUrl = encodeURIComponent(docId);

    let before = {};
    try {
      const r = await reqGet(`${BASE}/grades/${docUrl}`);
      before = parseFields(r.fields);
    } catch (e) { console.log(`⚠️  No existe doc: ${docId}`); }

    console.log(`📌 ${fix.studentName}`);
    console.log(`   ANTES:  ec=${before.ec} tr=${before.tr} pe=${before.pe} → suma=${before.suma} cal=${before.cal} faltas=${before.faltas}`);
    console.log(`   NUEVO:  ec=${fix.newValues.ec} tr=${fix.newValues.tr} pe=${fix.newValues.pe} → suma=${fix.newValues.suma} cal=${fix.newValues.cal} (faltas no se toca)`);

    if (DRY_RUN) { console.log(`   (dry-run)\n`); continue; }

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
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
