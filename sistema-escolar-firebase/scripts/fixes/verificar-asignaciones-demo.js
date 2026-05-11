/**
 * Verifica si las asignaciones de Cultura Digital II y Ciencias Sociales IV
 * que tiene el demo tienen también un docente REAL asignado a esos mismos
 * grupos y materia, para confirmar que las del demo son residuos seguros de
 * eliminar. NO BORRA NADA.
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

const COMBOS = [
  { groupId: 'MATUTINO_1-1', subjectId: 'G1_cultura_digital_ii' },
  { groupId: 'MATUTINO_1-2', subjectId: 'G1_cultura_digital_ii' },
  { groupId: 'MATUTINO_2-1', subjectId: 'G2_ciencias_sociales_iv' },
  { groupId: 'MATUTINO_2-2', subjectId: 'G2_ciencias_sociales_iv' },
];

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  ¿HAY MAESTRO REAL ASIGNADO A LOS GRUPOS DEL DEMO?`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  for (const combo of COMBOS) {
    console.log(`🔎 ${combo.groupId} · ${combo.subjectId}`);

    // Encontrar TODAS las asignaciones para este grupo
    const allForGroup = await queryByField('assignments', 'groupId', combo.groupId);
    const matchingSubject = allForGroup.filter(a => val(a.fields.subjectId) === combo.subjectId);

    console.log(`   Total asignaciones para este grupo+materia: ${matchingSubject.length}`);
    matchingSubject.forEach(a => {
      const isDemo = val(a.fields.teacherId).startsWith('demo-');
      const marker = isDemo ? '⚠ DEMO' : '✅ REAL';
      console.log(`     ${marker}  teacherId: ${val(a.fields.teacherId)} | teacherName: ${val(a.fields.teacherName)}`);
    });
    console.log();
  }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
