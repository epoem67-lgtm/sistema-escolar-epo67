/**
 * POPULATE orientadorId ON GROUPS
 *
 * Los grupos legacy guardan solo `groups.orientador` como string. Esto rompe
 * el filtro `getOrientadorGroups()` para los orientadores nuevos que no son
 * admin. Este script enlaza el teacherId correcto via match por nombre.
 *
 * Idempotente: si ya tiene orientadorId, no toca.
 *
 * Uso:
 *   node populate-orientador-id.js              -> DRY RUN
 *   node populate-orientador-id.js --apply      -> Aplica cambios
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
const TOKEN = config.tokens.access_token;

const APPLY = process.argv.includes('--apply');

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
    const req = https.request(u, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  return { stringValue: String(v) };
}

async function patchDoc(coll, id, fields) {
  const mask = Object.keys(fields).map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}?${mask}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('PATCH', url, body);
}

async function fetchPage(coll, pt) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
  if (pt) url += '&pageToken=' + pt;
  return request('GET', url);
}

async function getAll(coll) {
  const all = [];
  let pt = null;
  do {
    const r = await fetchPage(coll, pt);
    if (r.documents) all.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return all;
}

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const stripT = s => norm(s).replace(/\bPROFRA?\.?|\bMTRA?\.?|\bDR[A]?\.?|\bLIC\.?|\bMA\.?/g, '').trim();

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  POPULATE orientadorId ON GROUPS');
  console.log('  Modo:', APPLY ? '🔴 APPLY' : '🟢 DRY RUN');
  console.log('═══════════════════════════════════════════════════════════');

  const [groups, teachers] = await Promise.all([getAll('groups'), getAll('teachers')]);
  const tList = teachers.map(t => ({
    id: t.name.split('/').pop(),
    nombre: t.fields?.nombre?.stringValue || ''
  }));

  function matchTeacher(orientadorName) {
    const ws = stripT(orientadorName).split(/\s+/).filter(w => w.length > 2);
    if (ws.length < 2) return null;
    let best = null, bestScore = 0;
    tList.forEach(t => {
      const tw = stripT(t.nombre || '').split(/\s+/).filter(w => w.length > 2);
      const overlap = ws.filter(w => tw.includes(w)).length;
      if (overlap > bestScore) { bestScore = overlap; best = t; }
    });
    return bestScore >= 2 ? best : null;
  }

  const updates = [];
  const noMatch = [];
  const alreadyOk = [];

  groups.forEach(g => {
    const id = g.name.split('/').pop();
    const nombre = g.fields?.nombre?.stringValue || g.fields?.grupo?.stringValue || id;
    const turno = g.fields?.turno?.stringValue || '';
    const currentId = g.fields?.orientadorId?.stringValue || '';
    const orientadorName = g.fields?.orientador?.stringValue || g.fields?.orientadorNombre?.stringValue || '';

    if (currentId) { alreadyOk.push({ id, nombre, turno, currentId }); return; }
    if (!orientadorName) { noMatch.push({ id, nombre, turno, reason: 'sin orientador name' }); return; }

    const teacher = matchTeacher(orientadorName);
    if (!teacher) {
      noMatch.push({ id, nombre, turno, orientadorName, reason: 'sin match en teachers' });
      return;
    }

    updates.push({ id, nombre, turno, orientadorName, teacherId: teacher.id, teacherNombre: teacher.nombre });
  });

  console.log(`\n✅ Ya tenían orientadorId: ${alreadyOk.length}`);
  console.log(`🟢 Para enlazar: ${updates.length}`);
  console.log(`⚠ Sin match: ${noMatch.length}`);

  if (updates.length > 0) {
    console.log('\nGrupos a actualizar:');
    updates.forEach((u, i) => {
      console.log(`  ${i + 1}. ${u.nombre} (${u.turno}) "${u.orientadorName}" → ${u.teacherNombre} [${u.teacherId}]`);
    });
  }
  if (noMatch.length > 0) {
    console.log('\nSin match:');
    noMatch.forEach(n => console.log(`  - ${n.nombre} (${n.turno}): ${n.reason}${n.orientadorName ? ` ("${n.orientadorName}")` : ''}`));
  }

  if (!APPLY) {
    console.log('\n🟢 DRY RUN — sin cambios. Para aplicar: --apply');
    return;
  }

  console.log('\n🔴 APPLY — actualizando...');
  let ok = 0, fail = 0;
  for (const u of updates) {
    try {
      await patchDoc('groups', u.id, { orientadorId: u.teacherId });
      console.log(`✔ ${u.nombre} → ${u.teacherNombre}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${u.id}:`, e.message);
      fail++;
    }
  }
  console.log(`\nActualizados: ${ok} · Errores: ${fail}`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
