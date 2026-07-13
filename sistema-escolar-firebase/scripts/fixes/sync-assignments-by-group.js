/**
 * SYNC assignmentsByGroup — EPO 67
 *
 * Las firestore.rules usan teacherHasGroup(groupId) que valida la existencia
 * de docs en `assignmentsByGroup/{groupId}_{teacherId}`. Si una asignación
 * en `assignments` no tiene su par en `assignmentsByGroup`, las queries de
 * students/grades fallan con "Missing or insufficient permissions".
 *
 * Este script crea los docs faltantes en `assignmentsByGroup` para cada
 * asignación que no los tenga, manteniendo todo en sincronía.
 *
 * Uso:
 *   node scripts/fixes/sync-assignments-by-group.js          # DRY RUN
 *   node scripts/fixes/sync-assignments-by-group.js --apply  # Aplica
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const APPLY = process.argv.includes('--apply');

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : {}; if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`)); else resolve(j); } catch (e) { reject(e); }
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
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  return { stringValue: String(v) };
}

async function getAll(coll) {
  const out = []; let pt = null;
  do {
    let p = `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
    if (pt) p += '&pageToken=' + pt;
    const r = await api('GET', 'firestore.googleapis.com', p);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return out;
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  SYNC assignmentsByGroup — Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  const [assignments, asgByGroup] = await Promise.all([
    getAll('assignments'),
    getAll('assignmentsByGroup'),
  ]);
  console.log(`📊 ${assignments.length} assignments | ${asgByGroup.length} assignmentsByGroup`);

  const abgIds = new Set(asgByGroup.map(d => d.name.split('/').pop()));
  const missing = [];

  for (const a of assignments) {
    const f = a.fields || {};
    const teacherId = f.teacherId?.stringValue;
    const groupId = f.groupId?.stringValue;
    if (!teacherId || !groupId) continue;
    const abgId = `${groupId}_${teacherId}`;
    if (!abgIds.has(abgId)) {
      missing.push({
        abgId,
        asgId: a.name.split('/').pop(),
        teacherId,
        groupId,
        groupName: f.groupName?.stringValue,
        teacherName: f.teacherName?.stringValue,
        subjectId: f.subjectId?.stringValue,
        subjectName: f.subjectName?.stringValue,
        turno: f.turno?.stringValue,
        grado: f.grado?.integerValue || f.grado?.stringValue,
      });
    }
  }

  console.log(`\n⚠ Faltan ${missing.length} doc(s) en assignmentsByGroup:`);
  missing.forEach(m => {
    console.log(`  - ${m.abgId}  (${m.teacherName || m.teacherId} → ${m.groupName} ${m.subjectName})`);
  });

  if (missing.length === 0) {
    console.log('\n✅ Todo en sincronía. Nada que hacer.\n');
    return;
  }

  if (!APPLY) {
    console.log(`\n💡 DRY RUN. Para aplicar: --apply\n`);
    return;
  }

  console.log(`\n🔴 Creando ${missing.length} docs faltantes...\n`);
  let ok = 0, fail = 0;
  for (const m of missing) {
    const body = { fields: {} };
    const fields = {
      teacherId: m.teacherId,
      groupId: m.groupId,
      subjectId: m.subjectId,
    };
    if (m.teacherName) fields.teacherName = m.teacherName;
    if (m.groupName) fields.groupName = m.groupName;
    if (m.subjectName) fields.subjectName = m.subjectName;
    if (m.turno) fields.turno = m.turno;
    if (m.grado) fields.grado = parseInt(m.grado);
    Object.keys(fields).forEach(k => body.fields[k] = fsValue(fields[k]));

    try {
      await api('PATCH', 'firestore.googleapis.com',
        `/v1/projects/${PROJECT}/databases/(default)/documents/assignmentsByGroup/${m.abgId}`,
        body
      );
      console.log(`  ✅ ${m.abgId}`);
      ok++;
    } catch (e) {
      console.log(`  ❌ ${m.abgId} — ${e.message.slice(0, 80)}`);
      fail++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Creados: ${ok}  |  ❌ Fallaron: ${fail}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
