/**
 * Diagnostica los 5 alumnos que fallaron en el pre-flight de migracion.
 * Busca con varias estrategias en TODA la coleccion students (incl. BAJA).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
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
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('booleanValue' in v) o[k] = v.booleanValue;
  }
  return o;
}

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = s => norm(s).split(' ').filter(t => t.length > 1);
const overlap = (a, b) => {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  const inter = [...ta].filter(x => tb.has(x)).length;
  return { inter, score: inter / Math.max(ta.size, tb.size, 1) };
};

const MISSING = [
  { turno: 'MATUTINO', group: '1-2', name: 'AGUIRRE DELFIN YAHIR' },
  { turno: 'MATUTINO', group: '2-1', name: 'MORENO GARCIA DIEGO SANTIAGO' },
  { turno: 'MATUTINO', group: '2-3', name: 'ANGELES GARCIA RODRIGO HABBIBE' },
  { turno: 'MATUTINO', group: '3-2', name: 'MORALES GONZALEZ RODRIGUEZ' },
];

(async () => {
  console.log('🔍 Buscando alumnos faltantes en TODA la colección students...\n');
  const all = await listAll('students');
  const students = all.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  console.log(`📚 Total alumnos en sistema: ${students.length}`);
  console.log(`   ACTIVO: ${students.filter(s => s.estatus === 'ACTIVO').length}`);
  console.log(`   BAJA:   ${students.filter(s => s.estatus === 'BAJA').length}`);
  console.log(`   Otro:   ${students.filter(s => s.estatus !== 'ACTIVO' && s.estatus !== 'BAJA').length}`);
  console.log('');

  const groups = (await listAll('groups')).map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  for (const m of MISSING) {
    console.log('═══════════════════════════════════════════════');
    console.log(`🔎 BUSCANDO: ${m.name} (${m.turno} ${m.group})`);
    console.log('───────────────────────────────────────────────');

    const grp = groups.find(g => g.turno === m.turno && g.nombre.replace(/\s/g, '') === m.group.replace(/\s/g, ''));
    const grpId = grp ? grp.id : null;
    console.log(`Grupo destino: ${grp ? grp.id : 'NO ENCONTRADO'}`);

    // Top 5 candidatos por similitud de tokens en TODOS los alumnos
    const ranked = students.map(s => {
      const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
      const sim = overlap(m.name, full);
      return { ...s, full, sim };
    }).filter(c => c.sim.inter >= 1)
      .sort((a, b) => b.sim.score - a.sim.score)
      .slice(0, 5);

    if (ranked.length === 0) {
      console.log(`  ❌ Ningún candidato con tokens en común. Probablemente NUNCA se creó.`);
      continue;
    }

    console.log('  Top candidatos:');
    for (const c of ranked) {
      const matchGrupo = c.groupId === grpId ? ' ✓ MISMO GRUPO' : '';
      console.log(`    [${c.sim.score.toFixed(2)}] ${c.full}`);
      console.log(`         estatus=${c.estatus || '?'}  grupo=${c.grupo || '?'}/${c.turno || '?'}  id=${c.id}${matchGrupo}`);
      if (c.motivoBaja) console.log(`         motivoBaja: ${c.motivoBaja}`);
    }
    console.log('');
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
