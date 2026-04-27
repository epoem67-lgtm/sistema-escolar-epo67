/**
 * Compara rosters de 1-3 MATUTINO y 1-3 VESPERTINO entre Firestore y el payload.
 * Muestra: alumnos en sistema que NO están en payload (no se les capturará nada)
 *          alumnos en payload que NO están en sistema (faltan registros)
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

(async () => {
  const data = JSON.parse(fs.readFileSync(GRADES_PATH, 'utf8')).grades;
  const stuRaw = await listAll('students');
  const grpRaw = await listAll('groups');
  const students = stuRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));
  const groups = grpRaw.map(d => ({ id: d.name.split('/').pop(), ...parse(d.fields) }));

  const TARGETS = [];
  for (const t of ['MATUTINO', 'VESPERTINO'])
    for (const g of ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3'])
      TARGETS.push({ turno: t, groupKey: g });

  for (const t of TARGETS) {
    const grp = groups.find(g => g.turno === t.turno && (g.nombre || '').replace(/\s/g,'') === t.groupKey);
    if (!grp) { console.log(`Grupo ${t.turno} ${t.groupKey} no existe`); continue; }
    const grpStudents = students.filter(s => s.groupId === grp.id);
    const payloadNames = [...new Set(data.filter(g => g.turno === t.turno && g.groupKey === t.groupKey).map(g => g.studentFullName))];

    console.log('═══════════════════════════════════════════');
    console.log(`📋 ${t.turno} ${t.groupKey}`);
    console.log(`   Sistema: ${grpStudents.length} alumnos`);
    console.log(`   Payload: ${payloadNames.length} alumnos únicos`);
    console.log('───────────────────────────────────────────');

    // En sistema pero NO en payload (no recibirán calificaciones)
    const inSystemNotInPayload = [];
    for (const s of grpStudents) {
      const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
      const found = payloadNames.find(p => norm(p) === norm(full) || overlap(full, p) >= 0.85);
      if (!found) inSystemNotInPayload.push({ ...s, full });
    }
    console.log(`\n  ⚠️  EN SISTEMA pero NO en payload (${inSystemNotInPayload.length}):`);
    inSystemNotInPayload.forEach(s => console.log(`     - ${s.full}  [estatus=${s.estatus}]`));

    // En payload pero NO en sistema
    const inPayloadNotInSystem = [];
    for (const p of payloadNames) {
      const found = grpStudents.find(s => {
        const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
        return norm(p) === norm(full) || overlap(p, full) >= 0.85;
      });
      if (!found) inPayloadNotInSystem.push(p);
    }
    console.log(`\n  ❌ EN PAYLOAD pero NO en sistema (${inPayloadNotInSystem.length}):`);
    inPayloadNotInSystem.forEach(p => console.log(`     - ${p}`));
    console.log('');
  }
})();
