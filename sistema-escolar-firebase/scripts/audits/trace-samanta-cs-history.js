/**
 * Rastrea TODA la historia de cambios en Ciencias Sociales II P1
 * para grupo 1-2 matutino (donde está Samanta). Busca en activityLog
 * cada save que tocó esa lista.
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
  }
  return o;
}

const SAMANTA_ID = 'qnrwfTe1exU5nlR9Igpr';
const ENTITY_CS_P1 = 'MATUTINO_1-2_G1_ciencias_sociales_ii_P1';

(async () => {
  // 1) Resolver usuario X2jjeI8nkqVQ8tMYfI2AzyX51sW2
  console.log('Resolviendo usuario que hizo updates...');
  const users = await listAll('users');
  const userMap = {};
  users.forEach(d => {
    const data = parseFields(d.fields);
    // Use the uid as the key (could be in 'uid', or could be docId itself)
    const docId = d.name.split('/').pop();
    if (data.uid) userMap[data.uid] = data;
    userMap[docId] = data;
  });

  const target = 'X2jjeI8nkqVQ8tMYfI2AzyX51sW2';
  console.log(`\n=== Usuario ${target} ===`);
  console.log(JSON.stringify(userMap[target] || 'NO ENCONTRADO', null, 2));

  // 2) Buscar TODOS los activityLog para entityId de C.SOCIALES 1-2 P1
  console.log(`\n=== activityLog para ${ENTITY_CS_P1} ===`);
  const log = await listAll('activityLog');
  const matching = log
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(e => e.entityId === ENTITY_CS_P1)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  console.log(`Total saves a esta lista: ${matching.length}\n`);
  matching.forEach(e => {
    console.log(`📌 ${e.timestamp}`);
    console.log(`   Usuario: ${e.userName || e.userEmail} (rol: ${e.userRole})`);
    console.log(`   Descripción: ${e.description}`);
    console.log(`   Action: ${e.action}`);
    console.log();
  });

  // 3) Otras ediciones de Samanta — qué materias se editaron y cuándo
  console.log(`=== Otras ediciones para grupo 1-2 P1 ===`);
  const allP1_1_2 = log
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(e => e.entityId && e.entityId.startsWith('MATUTINO_1-2_') && e.entityId.endsWith('_P1'))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Agrupar por entityId
  const byEntity = {};
  allP1_1_2.forEach(e => {
    if (!byEntity[e.entityId]) byEntity[e.entityId] = [];
    byEntity[e.entityId].push(e);
  });
  Object.entries(byEntity).forEach(([eid, evs]) => {
    console.log(`\n${eid} (${evs.length} saves):`);
    evs.forEach(e => {
      console.log(`  ${e.timestamp} · ${e.userName || e.userEmail} (${e.userRole})`);
    });
  });
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
