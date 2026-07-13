/**
 * Restauración silenciosa: COVARRUBIAS ACOSTA SAMANTHA ANGELINE, 1-2 matutino.
 * CIENCIAS SOCIALES II — Primer Parcial.
 *
 * MOTIVO: La F1 firmada por la familia mostraba cal=10. El 7 mayo 02:29 AM
 * un burst anómalo de 53 saves en 4s sobrescribió con cal=8. Esto rompe la
 * consistencia con la boleta entregada. Olivia autoriza la restauración.
 *
 * VALORES A RESTAURAR:
 *   ec=8, tr=2, pe=0, suma=10, cal=10, value=10, faltas=0
 *
 * USO:
 *   node scripts/fixes/restore-samanta-p1-cs.js           (dry-run)
 *   node scripts/fixes/restore-samanta-p1-cs.js --apply   (aplica)
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

const STUDENT_ID = 'qnrwfTe1exU5nlR9Igpr';
const SUBJECT_ID = 'G1_ciencias_sociales_ii';
const PARTIAL = 'P1';
const DOC_ID = `${STUDENT_ID}_${SUBJECT_ID}_${PARTIAL}`;
const DOC_ID_URL = encodeURIComponent(DOC_ID);

const NEW_VALUES = {
  ec: 8,
  tr: 2,
  pe: 0,
  suma: 10,
  cal: 10,
  value: 10,
  faltas: 0,
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
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (v === null) out[k] = { nullValue: null };
  }
  return out;
}

function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if (v.stringValue !== undefined) o[k] = v.stringValue;
    else if (v.integerValue !== undefined) o[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) o[k] = Number(v.doubleValue);
    else if (v.booleanValue !== undefined) o[k] = v.booleanValue;
  }
  return o;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);

  const before = await reqGet(`${BASE}/grades/${DOC_ID_URL}`);
  const beforeData = parseFields(before.fields);
  console.log('ANTES:');
  console.log(`  ec=${beforeData.ec} tr=${beforeData.tr} pe=${beforeData.pe}`);
  console.log(`  suma=${beforeData.suma} cal=${beforeData.cal} faltas=${beforeData.faltas}`);
  console.log();
  console.log('NUEVOS VALORES:');
  console.log(`  ec=${NEW_VALUES.ec} tr=${NEW_VALUES.tr} pe=${NEW_VALUES.pe}`);
  console.log(`  suma=${NEW_VALUES.suma} cal=${NEW_VALUES.cal} faltas=${NEW_VALUES.faltas}`);

  if (DRY_RUN) {
    console.log('\n(dry-run — NO se escribió. Corre con --apply)');
    return;
  }

  const fieldsToUpdate = Object.keys(NEW_VALUES);
  const mask = fieldsToUpdate.map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${BASE}/grades/${DOC_ID_URL}?${mask}`;
  await reqPatch(url, { fields: toFirestoreFields(NEW_VALUES) });
  console.log('\n✓ Restauración aplicada.');

  const after = await reqGet(`${BASE}/grades/${DOC_ID_URL}`);
  const afterData = parseFields(after.fields);
  console.log('\nDESPUÉS:');
  console.log(`  ec=${afterData.ec} tr=${afterData.tr} pe=${afterData.pe}`);
  console.log(`  suma=${afterData.suma} cal=${afterData.cal} faltas=${afterData.faltas}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
