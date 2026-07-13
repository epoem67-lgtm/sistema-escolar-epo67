/**
 * Migración: assignments con IDs aleatorios → IDs determinísticos
 * Nuevo formato: {teacherId}_{groupId}_{subjectId}
 *
 * Necesario para que firestore.rules pueda validar permisos de maestro
 * sin hacer queries (solo exists() en path predecible).
 *
 * - Respalda cada documento en `_backup_assignments_<timestamp>/`
 * - Lee todos los assignments actuales
 * - Para cada uno: si el ID ya es determinístico → skip, si no → crea
 *   doc con ID nuevo y borra el viejo
 * - Idempotente: re-ejecutable sin dañar datos
 *
 * Uso:
 *   cd sistema-escolar-firebase
 *   node scripts/migrations/migrate-assignment-ids.js
 *
 * Para DRY RUN (no escribe, solo reporta):
 *   DRY_RUN=1 node scripts/migrations/migrate-assignment-ids.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN = process.env.DRY_RUN === '1';
const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;

const config = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
));
const token = config.tokens.access_token;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(d ? JSON.parse(d) : {});
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function listAll(collection) {
  const out = [];
  let pageToken = null;
  do {
    let url = `${BASE}/${collection}?pageSize=300`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const res = await req('GET', url);
    if (res.documents) out.push(...res.documents);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Convierte Firestore REST doc fields → objeto plano (solo strings para nuestro caso)
function parseFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
  }
  return out;
}

// Serializa objeto plano → Firestore REST fields
function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}

function deterministicId(data) {
  const t = data.teacherId, g = data.groupId, s = data.subjectId;
  if (!t || !g || !s) return null;
  return `${t}_${g}_${s}`;
}

async function createDoc(collection, docId, data) {
  const url = `${BASE}/${collection}?documentId=${encodeURIComponent(docId)}`;
  const body = JSON.stringify({ fields: toFields(data) });
  return req('POST', url, body);
}

async function deleteDoc(collection, docId) {
  const url = `${BASE}/${collection}/${encodeURIComponent(docId)}`;
  return req('DELETE', url);
}

async function docExists(collection, docId) {
  try {
    await req('GET', `${BASE}/${collection}/${encodeURIComponent(docId)}`);
    return true;
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return false;
    throw e;
  }
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no se escribirán cambios\n' : '🚀 Migrando assignments a IDs determinísticos\n');

  const docs = await listAll('assignments');
  console.log(`📦 Total assignments: ${docs.length}`);

  const timestamp = Date.now();
  const backupCol = `_backup_assignments_${timestamp}`;

  let skipped = 0, migrated = 0, errors = 0, noIds = 0, dupes = 0;

  for (const doc of docs) {
    const fullName = doc.name; // projects/.../documents/assignments/<id>
    const oldId = fullName.split('/').pop();
    const data = parseFields(doc.fields);
    const newId = deterministicId(data);

    if (!newId) {
      console.warn(`⚠️  ${oldId} sin teacherId/groupId/subjectId — skip`);
      noIds++;
      continue;
    }

    if (oldId === newId) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [DRY] ${oldId.slice(0, 10)}... → ${newId.slice(0, 40)}...`);
      migrated++;
      continue;
    }

    try {
      // Backup con _originalId
      await createDoc(backupCol, oldId, { ...data, _originalId: oldId });

      // Crear con nuevo ID si no existe ya
      const exists = await docExists('assignments', newId);
      if (exists) {
        console.warn(`⚠️  Destino ${newId} ya existe — borrando solo el viejo ${oldId}`);
        dupes++;
      } else {
        await createDoc('assignments', newId, data);
      }

      await deleteDoc('assignments', oldId);
      migrated++;
      if (migrated % 25 === 0) console.log(`   ✓ ${migrated} procesados...`);
    } catch (e) {
      console.error(`❌ Error ${oldId}: ${e.message}`);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`Skipped (ya determinístico): ${skipped}`);
  console.log(`Procesados:                  ${migrated}`);
  console.log(`Duplicados detectados:       ${dupes}`);
  console.log(`Sin ids:                     ${noIds}`);
  console.log(`Errores:                     ${errors}`);
  if (!DRY_RUN && migrated > 0) {
    console.log(`\n🛟 Backup: colección "${backupCol}"`);
  }
  console.log('═══════════════════════════════════════');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
