/**
 * UNDO del fix-wendy-practica-colaboracion.js
 *
 * Contexto: yo (Claude) creé incorrectamente un gradeCorrection con folio
 * admin formal para "trazabilidad" del cambio de cal de Wendy en P&CC II
 * (de 8 → 10). Esto fue un error de juicio: la cal correcta era 10 (Marco
 * la había puesto), el problema técnico era que la edición no se había
 * guardado en su momento. NO era una corrección administrativa formal de
 * Olivia. Crear el folio puso a Olivia en posición de "estar cambiando
 * calificaciones" cuando ella no tiene esa atribución.
 *
 * Este script revierte:
 *   1. BORRA el doc /gradeCorrections/kJDIfeCsA7Spa1S94SNj (folio
 *      ADM-20260601-091008-1sW2) — no debe existir.
 *   2. LIMPIA los campos correctionFolio, correctedFromCal, correctedAt
 *      del grade — para que no quede rastro del folio inventado.
 *
 * El grade SE QUEDA en cal=10 (que es la cal correcta que Marco capturó).
 * Solo se elimina la marca de "corrección formal admin" que yo agregué.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;
const BASE = `/v1/projects/epo67-sistema/databases/(default)/documents`;

const CORR_DOC_ID = 'kJDIfeCsA7Spa1S94SNj';
const GRADE_DOC_ID = 'wTuMAwDdLzzsFAy7BV9k_G3_práctica_y_colaboración_ciudadana_ii_P2';

function req(method, urlPath, body) {
  return new Promise((res, rej) => {
    const opts = {
      hostname: 'firestore.googleapis.com', path: urlPath, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    const r = https.request(opts, (resp) => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => resp.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${resp.statusCode}: ${d}`)));
    });
    r.on('error', rej);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  // 1. BORRAR el gradeCorrection (el folio formal que NO debe existir)
  console.log('1) Borrando gradeCorrection ' + CORR_DOC_ID + '...');
  try {
    await req('DELETE', `${BASE}/gradeCorrections/${CORR_DOC_ID}`);
    console.log('   ✓ Borrado.');
  } catch (e) {
    console.log('   ⚠️  ' + e.message + ' (¿ya estaba borrado?)');
  }

  // 2. LIMPIAR del grade los campos del folio inventado.
  //    Truco REST: updateMask con un campo + body fields SIN ese campo = lo elimina.
  console.log('2) Quitando correctionFolio/correctedFromCal/correctedAt del grade...');
  const enc = encodeURIComponent(GRADE_DOC_ID);
  const mask = ['correctionFolio', 'correctedFromCal', 'correctedAt']
    .map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  await req('PATCH', `${BASE}/grades/${enc}?${mask}`, { fields: {} });
  console.log('   ✓ Campos eliminados del grade.');

  // 3. Verificar
  console.log('\n3) Estado final del grade:');
  const g = await req('GET', `${BASE}/grades/${enc}`);
  const f = g.fields || {};
  console.log(`   cal=${f.cal?.integerValue || f.cal?.doubleValue}`);
  console.log(`   suma=${f.suma?.integerValue || f.suma?.doubleValue}`);
  console.log(`   ec=${f.ec?.integerValue || f.ec?.doubleValue}  tr=${f.tr?.integerValue || f.tr?.doubleValue}  pe=${f.pe?.integerValue || f.pe?.doubleValue}`);
  console.log(`   correctionFolio=${f.correctionFolio ? '"' + f.correctionFolio.stringValue + '" ⚠️ NO BORRADO' : '(ausente ✓)'}`);
  console.log(`   correctedFromCal=${f.correctedFromCal ? f.correctedFromCal.integerValue + ' ⚠️ NO BORRADO' : '(ausente ✓)'}`);
  console.log(`   correctedAt=${f.correctedAt ? f.correctedAt.timestampValue + ' ⚠️ NO BORRADO' : '(ausente ✓)'}`);

  // Verificar que el gradeCorrection ya no existe
  console.log('\n4) Verificando que el gradeCorrection NO existe:');
  try {
    await req('GET', `${BASE}/gradeCorrections/${CORR_DOC_ID}`);
    console.log(`   ⚠️  Todavía existe`);
  } catch (e) {
    if (String(e.message).includes('404')) console.log('   ✓ No existe (404)');
    else console.log('   error: ' + e.message);
  }

  console.log('\n✅ Reversión completa. La cal de Wendy queda en 10 sin folio formal.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
