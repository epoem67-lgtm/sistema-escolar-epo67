// ════════════════════════════════════════════════════════════════════════
// Cambia el rol de Octavio Vazquez de 'directivo' a 'subdirector'
//
// Uso:
//   cd sistema-escolar-firebase
//   node scripts/fixes/promote-octavio-subdirector.js
//
// Token (refresh si esta expirado):
//   npx firebase-tools projects:list  # genera /tmp/firebase-access-token.txt
// ════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const TARGET_NAME = 'OCTAVIO';
const NEW_ROLE = 'subdirector';

const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fieldVal(v) {
  if (v && v.stringValue !== undefined) return v.stringValue;
  if (v && v.integerValue !== undefined) return Number(v.integerValue);
  if (v && v.booleanValue !== undefined) return v.booleanValue;
  return null;
}

async function main() {
  console.log('Buscando usuarios con nombre que contenga "OCTAVIO"...\n');

  // List all users
  const res = await api('GET', '/users?pageSize=300');
  const docs = res.documents || [];
  console.log(`Total users: ${docs.length}`);

  const matches = docs.filter((d) => {
    const name = (fieldVal(d.fields?.displayName) || '').toUpperCase();
    return name.includes(TARGET_NAME);
  });

  if (!matches.length) {
    console.log('No se encontraron usuarios con OCTAVIO en displayName.');
    return;
  }

  console.log(`Coincidencias: ${matches.length}\n`);
  for (const doc of matches) {
    const docId = doc.name.split('/').pop();
    const name = fieldVal(doc.fields?.displayName);
    const email = fieldVal(doc.fields?.email);
    const role = fieldVal(doc.fields?.role);
    console.log(`  ${docId}`);
    console.log(`    name : ${name}`);
    console.log(`    email: ${email}`);
    console.log(`    role : ${role}`);

    if (role === NEW_ROLE) {
      console.log(`    -> ya es ${NEW_ROLE}, sin cambio.\n`);
      continue;
    }

    // Update via PATCH with updateMask=role
    await api(
      'PATCH',
      `/users/${docId}?updateMask.fieldPaths=role`,
      { fields: { role: { stringValue: NEW_ROLE } } }
    );
    console.log(`    -> rol actualizado: ${role} -> ${NEW_ROLE}\n`);
  }

  console.log('Listo.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
