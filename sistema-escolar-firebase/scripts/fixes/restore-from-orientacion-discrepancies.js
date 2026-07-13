/**
 * Restauración masiva desde JSON de discrepancias contra cuadros de orientación.
 * Lee scripts/audits/discrepancies-orientacion-*.json y aplica los valores
 * del cuadro a cada grade con discrepancia.
 *
 * Para discrepancias de CAL: ajusta rubros para que la suma+round = cal cuadro.
 * Estrategia conservadora: usa cuadroCal directamente, con rubros mínimos
 * que sumen a cal (ec proporcional, tr fija, sin pe/ex).
 *
 * USO:
 *   node restore-from-orientacion-discrepancies.js <json>           # dry-run
 *   node restore-from-orientacion-discrepancies.js <json> --apply   # aplica
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const jsonFile = args.find(a => a.endsWith('.json'));
if (!jsonFile) {
  console.error('Uso: node restore-from-orientacion-discrepancies.js <json> [--apply]');
  process.exit(1);
}

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

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

// Decide rubros que produzcan la cal deseada.
// Vespertino: EC max 5 + TR max 2 + EX max 3 + PE max 1 = 11
// Matutino:   EC max 8 + TR max 2 + PE max 1 = 11
// Estrategia conservadora: usar EC variable + TR=2 (sin EX ni PE) y calcular
// el EC necesario para que sumaSimple == cal cuadro.
function deriveRubros(turno, targetCal) {
  const tr = 2;
  if (targetCal >= 6) {
    const ec = Math.max(0, targetCal - tr);
    return { ec, tr, pe: 0, suma: ec + tr, cal: calcCal(ec + tr) };
  }
  // Para targetCal < 6, queremos suma exacta < 6 que rondee a la cal target
  // Si cal=5, mantenemos suma=5 (o menos)
  const suma = Math.min(targetCal, 5);
  return { ec: Math.max(0, suma - tr), tr, pe: 0, suma, cal: 5 };
}

(async () => {
  const discreps = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Discrepancias a restaurar: ${discreps.length}\n`);

  // Solo procesamos discrepancias de CAL (con o sin faltas)
  const calDiscreps = discreps.filter(d => d.tipo !== 'SOLO_FALTAS');
  console.log(`Filtradas (CAL distinta): ${calDiscreps.length}\n`);

  let okCount = 0, errCount = 0, skipCount = 0;
  for (const d of calDiscreps) {
    if (!d.docId) {
      console.log(`⚠️  ${d.alumno} - ${d.materia}: no existe grade en Firestore, skip`);
      skipCount++;
      continue;
    }
    if (d.cuadroCal === null || d.cuadroCal === undefined) {
      console.log(`⚠️  ${d.alumno} - ${d.materia}: cuadroCal vacío, skip`);
      skipCount++;
      continue;
    }
    // Asumimos turno desde groupId
    const turno = d.groupId.startsWith('VESPERTINO') ? 'V' : 'M';
    const rubros = deriveRubros(turno, Number(d.cuadroCal));
    const faltas = Number(d.cuadroFaltas) || 0;
    const newValues = {
      ec: rubros.ec, tr: rubros.tr, pe: rubros.pe,
      suma: rubros.suma, cal: rubros.cal, value: rubros.cal,
      faltas,
    };

    console.log(`📌 [${d.groupId}] ${d.alumno} - ${d.materia}`);
    console.log(`   ANTES:   ec=${d.fsCal !== null ? '?' : ''} suma=? cal=${d.fsCal} faltas=${d.fsFaltas || 0}`);
    console.log(`   CUADRO:  cal=${d.cuadroCal} faltas=${faltas}`);
    console.log(`   APLICAR: ec=${newValues.ec} tr=${newValues.tr} pe=${newValues.pe} → suma=${newValues.suma} cal=${newValues.cal}`);

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
      console.log(`   ✓ OK\n`);
      okCount++;
    } catch (e) {
      console.log(`   ✗ ERROR: ${e.message}\n`);
      errCount++;
    }
  }

  if (DRY_RUN) {
    console.log(`(dry-run completo. Corre con --apply para aplicar.)`);
  } else {
    console.log(`\n=== RESULTADO ===`);
    console.log(`✓ Restaurados: ${okCount}`);
    console.log(`⚠ Skipped:     ${skipCount}`);
    console.log(`✗ Errores:     ${errCount}`);
  }
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
