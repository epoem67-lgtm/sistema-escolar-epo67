// Quita el rol de docente a orientadoras específicas (Juanita y Ana Isabel).
// Las deja como rol 'orientador' puro — verán solo el tablero de Orientación,
// no el dashboard de captura de calificaciones de docentes.
//
// Cambio en Firestore:
//   users/{uid}.role: 'orientador_docente' → 'orientador'
//
// Sus asignaciones (clases que tenían) NO se borran — quedan disponibles
// por si algún día se les reactiva el rol híbrido. Solo el rol cambia.
//
// Idempotente: si ya tienen rol 'orientador', no toca nada.
//
// Uso:
//   cd sistema-escolar-firebase
//   node scripts/fixes/quitar-rol-docente-orientadoras.js          # dry-run (no escribe)
//   node scripts/fixes/quitar-rol-docente-orientadoras.js --apply  # aplica cambios

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';

// Orientadoras que deben perder el rol de docente (acceso a captura).
// Match parcial sobre displayName (case insensitive, normalizado sin acentos).
const TARGETS = [
  'RANGEL PALACIOS JUANA',
  'CORREA SALGADO ANA ISABEL',
];

const APPLY = process.argv.includes('--apply');

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
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
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

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

function nameMatchesTarget(name, target) {
  const wa = normalize(name).split(/\s+/).filter(w => w.length >= 4);
  const wb = normalize(target).split(/\s+/).filter(w => w.length >= 4);
  if (wa.length < 2 || wb.length < 2) return false;
  const setA = new Set(wa);
  return wb.every(w => setA.has(w));
}

async function fetchAllUsers() {
  let all = [];
  let pageToken = null;
  do {
    const q = pageToken ? `?pageSize=300&pageToken=${pageToken}` : '?pageSize=300';
    const res = await api('GET', `/users${q}`);
    all = all.concat(res.documents || []);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return all;
}

async function main() {
  console.log(`MODO: ${APPLY ? 'APLICAR CAMBIOS' : 'DRY-RUN (no escribe)'}\n`);
  const users = await fetchAllUsers();
  console.log(`Total usuarios en Firestore: ${users.length}\n`);

  let changed = 0, alreadyOk = 0, notFound = 0, errors = 0;

  for (const target of TARGETS) {
    console.log(`── ${target} ──`);
    const matches = users.filter((d) => {
      const name = fieldVal(d.fields?.displayName) || '';
      return nameMatchesTarget(name, target);
    });

    if (!matches.length) {
      console.log(`  ❌ No encontrado en users/\n`);
      notFound++;
      continue;
    }

    for (const doc of matches) {
      const uid = doc.name.split('/').pop();
      const name = fieldVal(doc.fields?.displayName);
      const email = fieldVal(doc.fields?.email);
      const role = fieldVal(doc.fields?.role);
      console.log(`  → uid=${uid.slice(0, 12)}…  ${name}  (${email})  rol actual: ${role}`);

      if (role === 'orientador') {
        console.log(`    ✓ Ya es 'orientador'. Sin cambio.\n`);
        alreadyOk++;
        continue;
      }

      if (role !== 'orientador_docente' && role !== 'maestro') {
        console.log(`    ⚠  Rol inesperado "${role}". Omitido por seguridad.\n`);
        continue;
      }

      if (!APPLY) {
        console.log(`    [DRY-RUN] cambiaría '${role}' → 'orientador'\n`);
        changed++;
        continue;
      }

      try {
        await api(
          'PATCH',
          `/users/${uid}?updateMask.fieldPaths=role`,
          { fields: { role: { stringValue: 'orientador' } } }
        );
        console.log(`    ✅ Rol actualizado: ${role} → 'orientador'\n`);
        changed++;
      } catch (e) {
        console.log(`    ❌ Error: ${e.message}\n`);
        errors++;
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`Resumen: ${changed} cambiadas, ${alreadyOk} ya OK, ${notFound} no encontradas, ${errors} errores`);
  if (!APPLY && changed > 0) {
    console.log('\n👉 Re-ejecuta con --apply para aplicar los cambios:');
    console.log('   node scripts/fixes/quitar-rol-docente-orientadoras.js --apply');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
