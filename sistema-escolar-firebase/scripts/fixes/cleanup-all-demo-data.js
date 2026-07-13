/**
 * CLEANUP ALL DEMO DATA — EPO 67
 *
 * Limpia TODOS los datos generados desde las 3 cuentas demo:
 *   - DEMO MAESTRO PRUEBA (uid: xrrHDQdDNYVam2nB6UgD1kiQcJz1)
 *   - DEMO ORIENTADOR PRUEBA (uid: npRDVGh2NjdbGp8gUoj89lrJ1kq2)
 *   - DEMO ADMINISTRADOR PRUEBA (uid: m1epQtnBdeVjeAtDGkhSr73t7vc2)
 *
 * Limpia las siguientes colecciones cuando el documento tiene
 * updatedBy/reportedByUid/userId === alguno de los 3 uids demo:
 *   - grades
 *   - incidents
 *   - teacherHours
 *   - attendance
 *   - atRisk
 *   - gradeCorrections
 *
 * NUNCA toca grades/datos de maestros reales (filtro por uid).
 *
 * Uso:
 *   node scripts/fixes/cleanup-all-demo-data.js --apply
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const APPLY = process.argv.includes('--apply');

const DEMO_UIDS = [
  'xrrHDQdDNYVam2nB6UgD1kiQcJz1',  // DEMO MAESTRO
  'npRDVGh2NjdbGp8gUoj89lrJ1kq2',  // DEMO ORIENTADOR
  'm1epQtnBdeVjeAtDGkhSr73t7vc2',  // DEMO ADMINISTRADOR
];

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

async function queryByField(collection, field, value) {
  const r = await api('POST', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value },
          }
        },
        limit: 1000
      }
    }
  );
  return (r || []).filter(d => d.document).map(d => d.document.name.split('/').pop());
}

async function deleteDoc(collection, id, attempt = 1) {
  try {
    // URL-encode el id porque puede contener caracteres especiales (ej: "reprobación")
    const encId = encodeURIComponent(id);
    return await api('DELETE', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encId}`
    );
  } catch (e) {
    // 503 Policy checks unavailable — retry con backoff exponencial
    if (e.message.includes('503') && attempt < 5) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      return deleteDoc(collection, id, attempt + 1);
    }
    throw e;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  CLEANUP ALL DEMO DATA — Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // Definimos qué colecciones y por qué campo filtrar
  const targets = [
    { collection: 'grades', field: 'updatedBy' },
    { collection: 'incidents', field: 'reportedByUid' },
    { collection: 'teacherHours', field: 'updatedBy' },
    { collection: 'attendance', field: 'updatedBy' },
    { collection: 'atRisk', field: 'reportedByUid' },
    { collection: 'gradeCorrections', field: 'requestedByUid' },
  ];

  const allToDelete = {};
  let totalFound = 0;

  console.log(`🔎 Buscando datos generados por las 3 cuentas demo...\n`);
  for (const target of targets) {
    allToDelete[target.collection] = [];
    for (const uid of DEMO_UIDS) {
      try {
        const ids = await queryByField(target.collection, target.field, uid);
        if (ids.length > 0) {
          allToDelete[target.collection].push(...ids);
          const role = uid === DEMO_UIDS[0] ? 'maestro' : uid === DEMO_UIDS[1] ? 'orientador' : 'admin';
          console.log(`  ${target.collection.padEnd(20)} | demo ${role.padEnd(11)} | ${ids.length} docs`);
          totalFound += ids.length;
        }
      } catch (e) {
        console.log(`  ⚠ ${target.collection} (${target.field}): ${e.message.slice(0, 60)}`);
      }
    }
  }

  console.log(`\n📊 Total a eliminar: ${totalFound} documento(s) en ${targets.length} colecciones`);

  if (totalFound === 0) {
    console.log(`\n✅ No hay datos del demo. Todo limpio.\n`);
    return;
  }

  if (!APPLY) {
    console.log(`\n💡 DRY RUN. Para aplicar: --apply\n`);
    return;
  }

  console.log(`\n🔴 ELIMINANDO...\n`);
  let totalOk = 0, totalFail = 0;
  for (const [collection, ids] of Object.entries(allToDelete)) {
    if (ids.length === 0) continue;
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        await deleteDoc(collection, ids[i]);
        ok++;
      } catch (e) {
        fail++;
      }
      if ((i + 1) % 20 === 0) await sleep(200);
    }
    console.log(`  ${collection.padEnd(20)} | ✅ ${ok} eliminados | ❌ ${fail} fallaron`);
    totalOk += ok;
    totalFail += fail;
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  RESUMEN FINAL`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Total eliminados: ${totalOk}`);
  console.log(`  ❌ Total fallaron:   ${totalFail}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
  console.log(`🛡 Datos de maestros reales NO fueron tocados (filtro por uid).\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
