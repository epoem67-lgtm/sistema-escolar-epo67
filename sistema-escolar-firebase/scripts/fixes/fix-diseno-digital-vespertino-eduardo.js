/**
 * Devuelve Diseno Digital VESPERTINO 3-1, 3-2, 3-3 a SANCHEZ OSORIO EDUARDO
 * (se habia puesto a Paco por error; en vespertino debe quedar Eduardo)
 */
const fs = require('fs'), path = require('path'), https = require('https');
const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function req(method, url, body) {
  return new Promise((res, rej) => {
    const o = { hostname: 'firestore.googleapis.com', path: url, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    if (body) o.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(o, (resp) => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => resp.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${resp.statusCode}: ${d.slice(0,200)}`)));
    });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}
async function listAll(c) { const o = []; let pt = null;
  do { let u = `${BASE}/${c}?pageSize=300`; if (pt) u += `&pageToken=${pt}`;
    const r = await req('GET', u); if (r.documents) o.push(...r.documents); pt = r.nextPageToken || null;
  } while (pt); return o; }
function parse(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) {
  if ('stringValue' in v) o[k] = v.stringValue; else if ('integerValue' in v) o[k] = Number(v.integerValue);
} return o; }
function toFields(o) { const out = {}; for (const [k, v] of Object.entries(o)) {
  if (v == null) continue;
  if (typeof v === 'string') out[k] = { stringValue: v };
  else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
  else out[k] = { stringValue: String(v) };
} return out; }

(async () => {
  const [teachers, subjects, groups] = await Promise.all(['teachers','subjects','groups'].map(listAll));
  const eduardoT = teachers.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .find(t => /SANCHEZ/i.test(t.nombre) && /OSORIO/i.test(t.nombre) && /EDUARDO/i.test(t.nombre));
  const pacoT = teachers.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .find(t => /CRUZ GARCIA FRANCISCO/i.test(t.nombre));
  const diseno = subjects.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .find(s => String(s.grado) === '3' && /diseño digital/i.test(s.nombre));
  const grupos = groups.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .filter(g => g.turno === 'VESPERTINO' && String(g.grado) === '3')
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  if (!eduardoT) { console.error('❌ No encontré a Eduardo'); process.exit(1); }
  console.log(`Eduardo: ${eduardoT.id} ${eduardoT.nombre}`);
  console.log(`Paco (ID a borrar): ${pacoT.id}`);
  console.log(`Materia: ${diseno.id}`);
  console.log(`Grupos vespertino 3°: ${grupos.map(g => g.nombre).join(', ')}\n`);

  for (const grp of grupos) {
    // 1. Borrar la asignación actual (Paco)
    const oldId = `${pacoT.id}_${grp.id}_${diseno.id}`;
    try {
      await req('DELETE', `${BASE}/assignments/${encodeURIComponent(oldId)}`);
      console.log(`  🗑  Borrado ${oldId}`);
    } catch (e) { console.log(`  (no existía ${oldId})`); }

    // 2. Crear con Eduardo
    const newId = `${eduardoT.id}_${grp.id}_${diseno.id}`;
    const data = {
      teacherId: eduardoT.id, teacherName: eduardoT.nombre,
      subjectId: diseno.id, subjectName: diseno.nombre,
      groupId: grp.id, groupName: grp.nombre,
      grado: 3, turno: 'VESPERTINO'
    };
    await req('PATCH', `${BASE}/assignments/${encodeURIComponent(newId)}`,
      JSON.stringify({ fields: toFields(data) }));
    console.log(`  ✓ ${grp.nombre} → ${eduardoT.nombre}`);
  }
  console.log('\n✅ Listo');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
