/**
 * Backup completo de la coleccion `grades` a un archivo JSON local.
 * Crear ANTES de cualquier migracion masiva.
 *
 * Uso:
 *   cd sistema-escolar-firebase
 *   node scripts/migrations/backup-grades.js
 *
 * Salida: ./grades-backup-<timestamp>.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function req(urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'firestore.googleapis.com', path: urlPath, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d ? JSON.parse(d) : {});
        else reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
      });
    }).on('error', reject);
  });
}

async function listAll(coll) {
  const out = [];
  let pageToken = null;
  let pages = 0;
  do {
    let url = `${BASE}/${coll}?pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await req(url);
    if (res.documents) out.push(...res.documents);
    pageToken = res.nextPageToken || null;
    pages++;
    if (pages % 5 === 0) console.log(`  ...${out.length} docs descargados`);
  } while (pageToken);
  return out;
}

async function main() {
  console.log('📦 Backup de la colección `grades`...');
  const docs = await listAll('grades');
  console.log(`✅ ${docs.length} documentos descargados`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = `grades-backup-${ts}.json`;
  fs.writeFileSync(file, JSON.stringify({ count: docs.length, exportedAt: ts, documents: docs }, null, 2));
  console.log(`💾 Guardado en: ${file}`);
  console.log(`📊 Tamaño: ${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
