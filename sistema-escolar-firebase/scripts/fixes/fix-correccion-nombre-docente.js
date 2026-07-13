/**
 * FIX puntual: corrige el nombre del docente en las 2 solicitudes de
 * corrección que quedaron con "ALARCON VARGAS MARIO ALBERTO" cuando en
 * realidad son de "LINARES FLORES ARACELI".
 *
 * Causa: bug en correction-request.js (usaba state.assignments[0].teacherName
 * en lugar de la asignación seleccionada). Corregido en v7.80.
 *
 * Docs afectados (status=pending, requestedBy=uid de Octavio):
 *   - RoO7xhKsM6x6qJvf7UTs (SC-2026-PRTJG8, organismos 3-1)
 *   - h8YBU80l0LzMgSfaUtvN (SC-2026-PRZ35Y, ciencias naturales 1-3)
 *
 * Ambas materias pertenecen a LINARES FLORES ARACELI (teacherId jBYLBeFQoSICB55Va7pF).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;

const CORRECT_NAME = 'LINARES FLORES ARACELI';
const CORRECT_TEACHER_ID = 'jBYLBeFQoSICB55Va7pF';
const DOCS = ['RoO7xhKsM6x6qJvf7UTs', 'h8YBU80l0LzMgSfaUtvN'];

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    }).on('error', rej);
  });
}

function patchDoc(docId, fields, maskPaths) {
  return new Promise((res, rej) => {
    const maskQs = maskPaths.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const p = `${BASE}/gradeCorrections/${docId}?${maskQs}`;
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'firestore.googleapis.com', path: p, method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(JSON.parse(d)) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej);
    req.write(body); req.end();
  });
}

async function main() {
  for (const docId of DOCS) {
    // Leer estado actual
    const before = await reqGet(`${BASE}/gradeCorrections/${docId}`);
    const bName = before.fields?.requestedByName?.stringValue || '';
    const bTid = before.fields?.teacherId?.stringValue || '';
    const folio = before.fields?.folio?.stringValue || '';
    console.log(`\n── ${docId} (folio ${folio})`);
    console.log(`   ANTES: requestedByName="${bName}" teacherId="${bTid}"`);

    // Aplicar PATCH
    await patchDoc(docId, {
      requestedByName: { stringValue: CORRECT_NAME },
      teacherId: { stringValue: CORRECT_TEACHER_ID },
    }, ['requestedByName', 'teacherId']);

    // Verificar
    const after = await reqGet(`${BASE}/gradeCorrections/${docId}`);
    const aName = after.fields?.requestedByName?.stringValue || '';
    const aTid = after.fields?.teacherId?.stringValue || '';
    console.log(`   DESPUÉS: requestedByName="${aName}" teacherId="${aTid}"`);
    console.log(aName === CORRECT_NAME && aTid === CORRECT_TEACHER_ID ? '   ✓ Corregido' : '   ⚠️ Revisar');
  }
  console.log('\n✅ Listo. Las 2 solicitudes ahora muestran a LINARES FLORES ARACELI.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
