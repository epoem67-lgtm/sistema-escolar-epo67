/**
 * Investiga grupos MAT 3-2 (LOZANO sospechoso) y VESP 3-3 (4 nombres extras).
 * Lista lado a lado: payload vs sistema y muestra fuzzy matches.
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
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}`)));
    }).on('error', rej);
  });
}
async function listAll(c) {
  const out = []; let pt = null;
  do { let u = `${BASE}/${c}?pageSize=300`; if (pt) u += `&pageToken=${pt}`;
    const r = await reqGet(u); if (r.documents) out.push(...r.documents); pt = r.nextPageToken || null;
  } while (pt); return out;
}
function parse(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) {
  if ('stringValue' in v) o[k] = v.stringValue; else if ('integerValue' in v) o[k] = Number(v.integerValue);
} return o; }

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => {
  const ta = new Set(norm(a).split(' ').filter(t => t.length > 1));
  const tb = new Set(norm(b).split(' ').filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(x => tb.has(x)).length;
  return inter / new Set([...ta, ...tb]).size;
};

const TARGETS = [
  { turno: 'MATUTINO',   groupKey: '3-2' },
  { turno: 'VESPERTINO', groupKey: '3-3' },
];

(async () => {
  const data = JSON.parse(fs.readFileSync(GRADES_PATH, 'utf8')).grades;
  const stuRaw = await listAll('students');
  const grpRaw = await listAll('groups');
  const students = stuRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));
  const groups = grpRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));

  for (const t of TARGETS) {
    const grp = groups.find(g => g.turno === t.turno && (g.nombre || '').replace(/\s/g,'') === t.groupKey);
    const grpStudents = students.filter(s => s.groupId === grp.id);
    const payloadNames = [...new Set(data.filter(g => g.turno === t.turno && g.groupKey === t.groupKey).map(g => g.studentFullName))];

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`📋 ${t.turno} ${t.groupKey}  —  Sistema: ${grpStudents.length}  Payload: ${payloadNames.length}`);
    console.log('═══════════════════════════════════════════════════════════');

    // Para cada nombre del payload, mostrar a quién matchea exact/fuzzy
    console.log('\n📤 PAYLOAD → match contra sistema:\n');
    for (const p of payloadNames) {
      // exact match
      const exact = grpStudents.find(s => {
        const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
        return norm(full) === norm(p);
      });
      if (exact) continue; // skip exactos para ver solo dudosos

      // fuzzy candidatos
      const ranked = grpStudents.map(s => {
        const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
        return { full, score: overlap(p, full), id: s.id };
      }).sort((a, b) => b.score - a.score).slice(0, 3);

      const best = ranked[0];
      const flag = !best || best.score < 0.7 ? '❌' : best.score < 0.85 ? '⚠️ ' : '~ ';
      console.log(`  ${flag} "${p}"`);
      ranked.forEach(r => {
        console.log(`        ${r.score >= 0.7 ? '✓' : '✗'} [${r.score.toFixed(2)}] ${r.full}`);
      });
    }

    // Mostrar también: alumnos del sistema cuyo "match payload" usado por preflight es DUDOSO
    console.log('\n📥 ALUMNOS DEL SISTEMA — quién los reclama del payload:\n');
    for (const s of grpStudents) {
      const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
      const ranked = payloadNames.map(p => ({ p, score: overlap(p, full) }))
        .sort((a, b) => b.score - a.score).slice(0, 3);
      const best = ranked[0];
      // Mostrar SOLO si el mejor match no es perfecto (revela dobles o ambigüedades)
      if (best && best.score < 1) {
        console.log(`  ⚠️  Sistema: "${full}"`);
        ranked.forEach(r => console.log(`        [${r.score.toFixed(2)}] payload: "${r.p}"`));
      }
    }
    console.log('');
  }
})();
