/**
 * Busca assignments del demo maestro / demo orientador usando sus teacherDocId
 * directos (demo-maestro-001 y demo-orientador-001). NO BORRA NADA.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const DEMO_TEACHER_IDS = ['demo-maestro-001', 'demo-orientador-001'];
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname: 'firestore.googleapis.com', path: urlPath,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          else resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function val(f) { if (!f) return ''; return f.stringValue ?? f.booleanValue ?? f.integerValue ?? f.doubleValue ?? ''; }

async function queryByField(collection, field, value) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      limit: 1000
    }
  };
  const r = await api('POST', `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, body);
  return (r || []).filter(d => d.document).map(d => ({
    id: d.document.name.split('/').pop(),
    fields: d.document.fields || {},
  }));
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ASIGNACIONES DEL DEMO (búsqueda por teacherDocId)`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  for (const tid of DEMO_TEACHER_IDS) {
    console.log(`🔎 assignments donde teacherId == ${tid}...`);
    const asgns = await queryByField('assignments', 'teacherId', tid);
    console.log(`   ${asgns.length} asignaciones:`);
    asgns.forEach(a => {
      console.log(`     - ${a.id}`);
      console.log(`       turno:    ${val(a.fields.turno)}`);
      console.log(`       grupo:    ${val(a.fields.groupName) || val(a.fields.groupId)}`);
      console.log(`       materia:  ${val(a.fields.subjectName) || val(a.fields.subjectId)}`);
      console.log(`       teacherName: ${val(a.fields.teacherName) || '(sin nombre)'}`);
    });
    console.log();
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
