// Asigna roles del personal directivo:
//   - Octavio Vazquez Barreto -> 'subdirector' (jefe academico)
//   - Roberto Palomares Mejia -> 'secretario_escolar' (jefe de inscripciones)
//
// Idempotente: si ya tienen el rol correcto, no hace nada.
//
// Uso:
//   cd sistema-escolar-firebase
//   node scripts/fixes/assign-staff-roles.js

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';

const TARGETS = [
  { match: 'OCTAVIO',  role: 'subdirector' },
  { match: 'ROBERTO',  role: 'secretario_escolar' },
];

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

const fieldVal = (v) => v?.stringValue ?? null;

async function main() {
  const res = await api('GET', '/users?pageSize=300');
  const docs = res.documents || [];
  console.log(`Total users en Firestore: ${docs.length}\n`);

  for (const target of TARGETS) {
    console.log(`── Buscando "${target.match}" ──`);
    const matches = docs.filter((d) => {
      const name = (fieldVal(d.fields?.displayName) || '').toUpperCase();
      return name.includes(target.match);
    });

    if (!matches.length) {
      console.log(`  (no encontrado)\n`);
      continue;
    }

    for (const doc of matches) {
      const docId = doc.name.split('/').pop();
      const name = fieldVal(doc.fields?.displayName);
      const email = fieldVal(doc.fields?.email);
      const role = fieldVal(doc.fields?.role);
      console.log(`  ${docId}  ${name}  rol actual: ${role}`);

      if (role === target.role) {
        console.log(`    -> ya es ${target.role}, sin cambio.\n`);
        continue;
      }

      await api(
        'PATCH',
        `/users/${docId}?updateMask.fieldPaths=role`,
        { fields: { role: { stringValue: target.role } } }
      );
      console.log(`    -> ${role} -> ${target.role}\n`);
    }
  }

  console.log('Listo.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
