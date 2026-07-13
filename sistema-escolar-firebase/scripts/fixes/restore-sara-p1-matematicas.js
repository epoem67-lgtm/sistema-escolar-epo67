/**
 * Restauración silenciosa: SARA DANIELA ROMERO DOMINGEZ, 1-1 matutino.
 * PENSAMIENTO MATEMÁTICO II — Primer Parcial.
 *
 * MOTIVO: Olivia confirma que la alumna RECIBIÓ cal=10 en P1 (F1 ya firmada
 * por mamá Estivaliz F. Domínguez D.). Alguien editó EC de 6.5 a 6.4 después
 * del cierre, lo que bajó la suma a 9.4 → cal=9. Esto rompe la consistencia
 * con la boleta firmada que está en manos de los padres.
 *
 * Política Olivia: como admin no puede crear folio formal de corrección
 * ("yo no puedo cambiar calificaciones así"). Por eso este script ejecuta
 * la restauración como FIX SILENCIOSO (sin gradeCorrection).
 *
 * VALORES A RESTAURAR:
 *   ec=6.5, tr=2, pe=1, suma=9.5, cal=10, value=10, faltas=0
 *
 * USO:
 *   node scripts/fixes/restore-sara-p1-matematicas.js --apply
 *   (sin --apply solo hace dry-run)
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

const STUDENT_ID = 'PMB5xZHV1W0Lv2skQAXl';
const SUBJECT_ID = 'G1_pensamiento_matemático_ii';
const PARTIAL = 'P1';
const DOC_ID = `${STUDENT_ID}_${SUBJECT_ID}_${PARTIAL}`;
const DOC_ID_URL = encodeURIComponent(DOC_ID);

const NEW_VALUES = {
  ec: 6.5,
  tr: 2,
  pe: 1,
  suma: 9.5,
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
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sin escribir)' : 'APPLY (escribiendo)'}\n`);

  console.log('Leyendo estado actual...');
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
    console.log('\n(dry-run — NO se escribió nada. Corre con --apply para aplicar)');
    return;
  }

  console.log('\nAplicando cambio...');
  // PATCH con updateMask para tocar SOLO los campos relevantes
  const fieldsToUpdate = Object.keys(NEW_VALUES);
  const mask = fieldsToUpdate.map(f => `updateMask.fieldPaths=${f}`).join('&');
  const url = `${BASE}/grades/${DOC_ID_URL}?${mask}`;
  await reqPatch(url, { fields: toFirestoreFields(NEW_VALUES) });
  console.log('✓ Restauración aplicada.');

  // Verificar
  console.log('\nVerificando estado tras escritura...');
  const after = await reqGet(`${BASE}/grades/${DOC_ID_URL}`);
  const afterData = parseFields(after.fields);
  console.log('DESPUÉS:');
  console.log(`  ec=${afterData.ec} tr=${afterData.tr} pe=${afterData.pe}`);
  console.log(`  suma=${afterData.suma} cal=${afterData.cal} faltas=${afterData.faltas}`);
  console.log('\nFin.');
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
