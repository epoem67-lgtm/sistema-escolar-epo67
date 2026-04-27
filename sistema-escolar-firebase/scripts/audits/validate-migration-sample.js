/**
 * Validacion post-migracion: 10 muestras aleatorias del payload contra Firestore.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const GRADES_PATH = '/Users/oliolix/Documents/PROYECTOS CLAUDE/Agente de limpieza de datos calificación/output/extracted-grades.json';
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d.slice(0,200)}`)));
    }).on('error', rej);
  });
}
function parse(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) {
  if ('stringValue' in v) o[k] = v.stringValue; else if ('integerValue' in v) o[k] = Number(v.integerValue);
  else if ('doubleValue' in v) o[k] = v.doubleValue;
} return o; }
async function listAll(c) { const out = []; let pt = null;
  do { let u = `${BASE}/${c}?pageSize=300`; if (pt) u += `&pageToken=${pt}`;
    const r = await reqGet(u); if (r.documents) out.push(...r.documents); pt = r.nextPageToken || null;
  } while (pt); return out; }

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => {
  const ta = new Set(norm(a).split(' ').filter(t => t.length > 1));
  const tb = new Set(norm(b).split(' ').filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(x => tb.has(x)).length;
  return inter / new Set([...ta, ...tb]).size;
};

(async () => {
  const payload = JSON.parse(fs.readFileSync(GRADES_PATH, 'utf8')).grades;
  const stuRaw = await listAll('students');
  const subRaw = await listAll('subjects');
  const grpRaw = await listAll('groups');
  const students = stuRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));
  const subjects = subRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));
  const groups   = grpRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));

  // Tomar 10 muestras aleatorias (que no sean BAJA)
  const SKIP = new Set(['AGUIRRE DELFIN YAHIR','MORENO GARCIA DIEGO SANTIAGO','ANGELES GARCIA RODRIGO HABBIBE']);
  const candidates = payload.filter(g => !SKIP.has(g.studentFullName));
  const samples = [];
  while (samples.length < 10) samples.push(candidates[Math.floor(Math.random() * candidates.length)]);

  let ok = 0, mismatch = 0, missing = 0;
  for (const s of samples) {
    const grp = groups.find(x => x.turno === s.turno && (x.nombre || '').replace(/\s/g,'') === s.groupKey);
    const grpStu = students.filter(x => x.groupId === grp.id);
    const stu = grpStu.find(x => norm(x.nombreCompleto) === norm(s.studentFullName)) ||
                grpStu.map(x => ({ x, sc: overlap(s.studentFullName, x.nombreCompleto) }))
                      .sort((a,b)=>b.sc-a.sc).filter(c=>c.sc>=0.7)[0]?.x;
    if (!stu) { console.log(`❌ no se encontró alumno: ${s.studentFullName}`); missing++; continue; }
    const subjCandidates = subjects.filter(x => String(x.grado) === String(s.grado));
    const subj = subjCandidates.find(x => norm(x.nombre) === norm(s.subjectName)) ||
                 subjCandidates.map(x => ({ x, sc: overlap(s.subjectName, x.nombre) }))
                               .sort((a,b)=>b.sc-a.sc).filter(c=>c.sc>=0.5)[0]?.x;
    if (!subj) { console.log(`❌ no se encontró materia`); missing++; continue; }

    const docId = `${stu.id}_${subj.id}_${s.partial}`;
    try {
      const doc = await reqGet(`${BASE}/grades/${encodeURIComponent(docId)}`);
      const data = parse(doc.fields);
      const calMatch = Number(data.cal) === Number(s.cal);
      const valMatch = Number(data.value) === Number(s.value);
      if (calMatch && valMatch) {
        console.log(`✅ ${s.studentFullName} / ${s.subjectName.slice(0,30)} → cal=${data.cal} value=${data.value}`);
        ok++;
      } else {
        console.log(`⚠️  MISMATCH ${docId}`);
        console.log(`     payload: cal=${s.cal} value=${s.value}`);
        console.log(`     firestore: cal=${data.cal} value=${data.value}`);
        mismatch++;
      }
    } catch (e) {
      console.log(`❌ ${docId}: ${e.message}`);
      missing++;
    }
  }
  console.log(`\n═══ Validación: ${ok}/10 OK, ${mismatch} mismatches, ${missing} no encontrados ═══`);
})();
