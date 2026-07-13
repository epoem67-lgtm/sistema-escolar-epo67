/**
 * VERIFICADOR CONTINUO contra los snapshots certificados.
 *
 * Lee TODOS los certifiedSnapshots de Firestore y compara cada grade
 * registrado contra el estado actual del Firestore. Reporta INSTANTÁNEAMENTE
 * cualquier divergencia: campos cambiados, grades eliminados, etc.
 *
 * Úsalo:
 *   - Antes de imprimir boletas: confirma que todo coincide con la versión
 *     certificada el día de entrega.
 *   - Periódicamente (cron diario): alerta si alguien modificó grades certificados.
 *
 * USO:  node scripts/snapshots/verify-against-snapshots.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      r.setEncoding('utf8');  // FIX UTF-8 multibyte
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
    else if (v.booleanValue !== undefined) o[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) o[k] = v.timestampValue;
    else if (v.nullValue !== undefined) o[k] = null;
    else if (v.mapValue !== undefined) o[k] = parseFields(v.mapValue.fields);
    else if (v.arrayValue !== undefined) o[k] = (v.arrayValue.values || []).map(x => parseFields({ x }).x);
  }
  return o;
}

(async () => {
  console.log('🔍 Verificando integridad contra certifiedSnapshots...\n');

  const [snapshots, grades] = await Promise.all([
    listAll('certifiedSnapshots'),
    listAll('grades'),
  ]);
  console.log(`Snapshots certificados: ${snapshots.length}`);
  console.log(`Grades actuales en Firestore: ${grades.length}\n`);

  // Indexar grades actuales por docId
  const currentByDocId = {};
  grades.forEach(d => {
    const id = d.name.split('/').pop();
    currentByDocId[id] = parseFields(d.fields);
  });

  let totalDivergences = 0;
  let totalChecked = 0;
  const allReports = [];

  for (const snapDoc of snapshots) {
    const snap = parseFields(snapDoc.fields);
    const snapId = snapDoc.name.split('/').pop();
    const items = snap.items || [];
    console.log(`📸 ${snapId} (${items.length} grades, certificado ${snap.certifiedAt})`);

    const divergences = [];
    for (const item of items) {
      totalChecked++;
      const current = currentByDocId[item.docId];
      if (!current) {
        divergences.push({ docId: item.docId, type: 'BORRADO', original: item, current: null });
        continue;
      }
      // Comparar campos críticos
      const fields = ['ec', 'tr', 'pe', 'ex', 'suma', 'cal', 'value', 'faltas'];
      const changes = {};
      for (const f of fields) {
        const orig = item[f];
        const now = current[f];
        if (orig != now && !(orig == null && now == null)) {
          changes[f] = { antes: orig, ahora: now };
        }
      }
      if (Object.keys(changes).length > 0) {
        divergences.push({
          docId: item.docId,
          alumno: item.studentName,
          materia: item.subjectName,
          type: 'MODIFICADO',
          changes,
        });
      }
    }

    if (divergences.length === 0) {
      console.log(`  ✓ Integridad OK — ${items.length}/${items.length} coinciden`);
    } else {
      console.log(`  ⚠️  ${divergences.length} DIVERGENCIAS detectadas`);
      divergences.forEach(d => {
        if (d.type === 'BORRADO') {
          console.log(`     ❌ BORRADO: ${d.original.studentName} - ${d.original.subjectName}`);
        } else {
          const changesStr = Object.entries(d.changes).map(([k,v]) => `${k}: ${v.antes} → ${v.ahora}`).join(', ');
          console.log(`     ⚠️  ${d.alumno} - ${d.materia}: ${changesStr}`);
        }
      });
      totalDivergences += divergences.length;
      allReports.push({ snapshotId: snapId, divergences });
    }
    console.log();
  }

  console.log('━'.repeat(70));
  console.log(`📊 RESULTADO FINAL`);
  console.log(`   Total grades verificados: ${totalChecked}`);
  console.log(`   Divergencias encontradas: ${totalDivergences}`);
  if (totalDivergences === 0) {
    console.log(`   ✅ INTEGRIDAD TOTAL — todo lo certificado sigue intacto`);
  } else {
    console.log(`   ⚠️  ATENCIÓN: ${totalDivergences} cambio(s) detectado(s) tras la certificación.`);
    console.log(`   Revisa el detalle arriba y verifica si los cambios son legítimos (correcciones formales con folio).`);
    const outFile = path.join(__dirname, `divergences-${new Date().toISOString().slice(0,10)}.json`);
    fs.writeFileSync(outFile, JSON.stringify(allReports, null, 2), 'utf8');
    console.log(`   Reporte: ${outFile}`);
  }
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
