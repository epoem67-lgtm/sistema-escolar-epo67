/**
 * Asignar Actividades Artisticas y Culturales I (2do grado) a
 * TORRES MORENO CLAUDIA IVONE en los 6 grupos de 2do (MAT y VESP).
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
  const [teachers, subjects, groups, assignments] = await Promise.all(
    ['teachers','subjects','groups','assignments'].map(listAll));

  const claudia = teachers.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .find(t => /TORRES/i.test(t.nombre) && /CLAUDIA/i.test(t.nombre));
  const artisticas = subjects.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .find(s => String(s.grado) === '2' && /ACTIVIDADES ARTISTICAS/i.test(
      (s.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    ));
  const grupos = groups.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }))
    .filter(g => String(g.grado) === '2' && (g.turno === 'MATUTINO' || g.turno === 'VESPERTINO'))
    .sort((a,b) => (a.turno||'').localeCompare(b.turno||'') || (a.nombre||'').localeCompare(b.nombre||''));
  const asgs = assignments.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));

  if (!claudia) { console.error('❌ No encontré a Claudia'); process.exit(1); }
  if (!artisticas) { console.error('❌ No encontré Actividades Artísticas 2°'); process.exit(1); }
  console.log(`Claudia: ${claudia.id} ${claudia.nombre}`);
  console.log(`Materia: ${artisticas.id} — ${artisticas.nombre}`);
  console.log(`Grupos 2°: ${grupos.map(g => g.turno + ' ' + g.nombre).join(', ')}\n`);

  for (const grp of grupos) {
    // Borrar previas de distinto maestro para este (materia, grupo)
    const prev = asgs.filter(a =>
      a.subjectId === artisticas.id && a.groupId === grp.id && a.teacherId !== claudia.id
    );
    for (const p of prev) {
      await req('DELETE', `${BASE}/assignments/${encodeURIComponent(p.id)}`);
      console.log(`  🗑  ${grp.turno} ${grp.nombre}: borrada previa (${p.teacherName})`);
    }

    const asgId = `${claudia.id}_${grp.id}_${artisticas.id}`;
    const data = {
      teacherId: claudia.id, teacherName: claudia.nombre,
      subjectId: artisticas.id, subjectName: artisticas.nombre,
      groupId: grp.id, groupName: grp.nombre,
      grado: 2, turno: grp.turno
    };
    await req('PATCH', `${BASE}/assignments/${encodeURIComponent(asgId)}`,
      JSON.stringify({ fields: toFields(data) }));
    console.log(`  ✓ ${grp.turno} ${grp.nombre} → ${claudia.nombre}`);
  }
  console.log('\n✅ Listo');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
