/**
 * Restaura los grades de 1-2 Ciencias Sociales II P1 desde el CUADRO OFICIAL
 * de la profesora MA. GUADALUPE GRANADOS DE LOERA.
 *
 * Lee scripts/audits/discrepancies-1-2-cs-p1.json (generado por
 * compare-cuadro-vs-firestore-1-2-cs-p1.js) y aplica los valores del cuadro
 * a cada grade con discrepancia.
 *
 * USO:
 *   node scripts/fixes/restore-1-2-cs-p1-from-cuadro.js           (dry-run)
 *   node scripts/fixes/restore-1-2-cs-p1-from-cuadro.js --apply   (aplica)
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

const DISCREP_FILE = path.join(__dirname, '..', 'audits', 'discrepancies-1-2-cs-p1.json');

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
  }
  return out;
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return null;
  const s = Math.min(Number(suma), 10);
  if (isNaN(s)) return null;
  if (s >= 6) return Math.min(Math.round(s), 10);
  return 5;
}

(async () => {
  if (!fs.existsSync(DISCREP_FILE)) {
    console.error(`No existe ${DISCREP_FILE}. Corre primero el script de comparación.`);
    process.exit(1);
  }
  const discreps = JSON.parse(fs.readFileSync(DISCREP_FILE, 'utf8'));
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Discrepancias a restaurar: ${discreps.length}\n`);

  let okCount = 0, errCount = 0;
  for (const d of discreps) {
    // Calcular suma + cal desde rubros (con regla EPO 67)
    const ec = Number(d.cuadro.ec) || 0;
    const tr = Number(d.cuadro.tr) || 0;
    let pe = Number(d.cuadro.pe) || 0;
    const sumaBase = ec + tr;
    // Regla EPO 67: si sumaBase < 6, PE no aplica
    if (sumaBase < 6) pe = 0;
    const suma = Math.min(sumaBase + pe, 10);
    const cal = calcCal(suma);
    const faltas = Number(d.cuadro.faltas) || 0;

    const newValues = { ec, tr, pe, suma, cal, value: cal, faltas };

    console.log(`📌 ${d.alumno} (#${d.num})`);
    console.log(`   ANTES:    ec=${d.firestore.ec} tr=${d.firestore.tr} pe=${d.firestore.pe} → cal=${d.firestore.cal}`);
    console.log(`   CUADRO:   ec=${ec} tr=${tr} pe=${pe} → suma=${suma} cal=${cal} faltas=${faltas}`);

    if (DRY_RUN) {
      console.log(`   (dry-run)\n`);
      continue;
    }

    try {
      const fields = Object.keys(newValues);
      const mask = fields.map(f => `updateMask.fieldPaths=${f}`).join('&');
      const docUrl = encodeURIComponent(d.docId);
      const url = `${BASE}/grades/${docUrl}?${mask}`;
      await reqPatch(url, { fields: toFirestoreFields(newValues) });
      console.log(`   ✓ Restaurado\n`);
      okCount++;
    } catch (e) {
      console.log(`   ✗ ERROR: ${e.message}\n`);
      errCount++;
    }
  }

  if (DRY_RUN) {
    console.log(`(dry-run completo — sin cambios. Corre con --apply para aplicar.)`);
  } else {
    console.log(`\n=== RESULTADO ===`);
    console.log(`✓ Restaurados: ${okCount}`);
    console.log(`✗ Errores: ${errCount}`);
  }
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
