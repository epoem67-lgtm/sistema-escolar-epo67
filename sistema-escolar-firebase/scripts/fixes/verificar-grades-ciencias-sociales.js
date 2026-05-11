/**
 * ¿Hay grades capturadas en MATUTINO_2-1/2-2 para G2_ciencias_sociales_iv?
 * Si las hay, ¿quién las capturó (updatedBy)? Si es alguien real (no el demo),
 * la asignación del demo está siendo usada como real y debemos reasignar antes
 * de borrar.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
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

async function queryGrades(groupId, subjectId) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'grades' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: groupId } } },
            { fieldFilter: { field: { fieldPath: 'subjectId' }, op: 'EQUAL', value: { stringValue: subjectId } } }
          ]
        }
      },
      limit: 500
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
  console.log(`  GRADES en grupos donde el demo-orientador tiene asignaciones`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  const combos = [
    { groupId: 'MATUTINO_2-1', subjectId: 'G2_ciencias_sociales_iv' },
    { groupId: 'MATUTINO_2-2', subjectId: 'G2_ciencias_sociales_iv' },
  ];

  for (const c of combos) {
    console.log(`🔎 ${c.groupId} · ${c.subjectId}`);
    const grades = await queryGrades(c.groupId, c.subjectId);
    console.log(`   Total grades capturadas: ${grades.length}`);

    if (grades.length === 0) {
      console.log(`   ✅ NADIE capturó nada — asignación es solo residuo, borrar es seguro\n`);
      continue;
    }

    const byUpdater = {};
    grades.forEach(g => {
      const u = val(g.fields.updatedBy) || '(sin updatedBy)';
      byUpdater[u] = (byUpdater[u] || 0) + 1;
    });
    console.log(`   Capturadas por:`);
    Object.entries(byUpdater).forEach(([u, count]) => {
      console.log(`     - ${u}: ${count} grades`);
    });
    console.log();
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
