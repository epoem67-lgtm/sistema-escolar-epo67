/**
 * CREATE TEST ORIENTADORA — crea cuenta Auth + user doc para una orientadora.
 * Uso interno para que admin pueda probar el rol de orientador_docente.
 *
 * Hace:
 *   1. Lee teacher por nombre, le pone email sintético si no tiene
 *   2. Crea Firebase Auth user con password fijo
 *   3. Crea/actualiza users/{uid} con role 'orientador_docente' y teacherId
 *   4. Loggea todo en activityLog
 *
 * Uso:
 *   node create-test-orientadora.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const TARGET_NAME_INCLUDES = ['CORREA', 'ISABEL'];
const SYNTH_EMAIL = 'correa.salgado.ana.isabel@epo67.local';
const TEMP_PASSWORD = 'EPO67orient2026';
const TARGET_ROLE = 'orientador_docente';

const TOKEN_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
const TOKEN = config.tokens.access_token;

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(u, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
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
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach(k => fields[k] = fsValue(v[k]));
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function patchDoc(coll, id, fields) {
  const mask = Object.keys(fields).map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}?${mask}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('PATCH', url, body);
}

async function setDoc(coll, id, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('PATCH', url, body);
}

async function createAuditDoc(fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/activityLog`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('POST', url, body);
}

async function fetchPage(coll, pt) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
  if (pt) url += '&pageToken=' + pt;
  return request('GET', url);
}

async function getAll(coll) {
  const all = [];
  let pt = null;
  do {
    const r = await fetchPage(coll, pt);
    if (r.documents) all.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return all;
}

// Identity Toolkit (Firebase Auth) endpoints
async function authLookup(email) {
  const url = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:lookup';
  const r = await request('POST', url, { email: [email] });
  return r.users?.[0] || null;
}

async function authCreate(email, password, displayName) {
  const url = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts';
  const r = await request('POST', url, { email, password, displayName, emailVerified: false });
  return r.localId;
}

async function authSetPassword(uid, password) {
  const url = 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:update';
  return request('POST', url, { localId: uid, password });
}

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CREATE TEST ORIENTADORA');
  console.log('═══════════════════════════════════════════════════════════');

  const teachers = await getAll('teachers');
  const matches = teachers.filter(t => {
    const n = (t.fields?.nombre?.stringValue || '').toUpperCase();
    return TARGET_NAME_INCLUDES.every(w => n.includes(w));
  });

  if (matches.length === 0) {
    console.error('No se encontró teacher con: ' + TARGET_NAME_INCLUDES.join(' + '));
    return;
  }
  if (matches.length > 1) {
    console.error('Múltiples matches; ambiguo:');
    matches.forEach(t => console.error('  -', t.fields?.nombre?.stringValue));
    return;
  }

  const teacher = matches[0];
  const teacherId = teacher.name.split('/').pop();
  const nombre = teacher.fields?.nombre?.stringValue || '';
  let email = teacher.fields?.email?.stringValue || '';
  console.log(`✔ Encontrada: ${nombre} (id=${teacherId})`);

  // 1. Asignar email si no tiene
  if (!email) {
    email = SYNTH_EMAIL;
    await patchDoc('teachers', teacherId, { email });
    console.log(`✔ Email asignado al teacher: ${email}`);
  } else {
    console.log(`ℹ Teacher ya tenía email: ${email}`);
  }

  // 2. Crear/asegurar Firebase Auth user
  let uid;
  const existing = await authLookup(email);
  if (existing) {
    uid = existing.localId;
    console.log(`ℹ Auth user ya existía: uid=${uid}`);
    // Actualizar password al fijo para que el admin lo conozca
    await authSetPassword(uid, TEMP_PASSWORD);
    console.log(`✔ Password reseteado a: ${TEMP_PASSWORD}`);
  } else {
    uid = await authCreate(email, TEMP_PASSWORD, nombre);
    console.log(`✔ Auth user creado: uid=${uid}, password=${TEMP_PASSWORD}`);
  }

  // 3. Crear/actualizar users/{uid}
  const userDoc = {
    email,
    displayName: nombre,
    role: TARGET_ROLE,
    teacherId,
    status: 'active',
    createdAt: new Date(),
    autoCreado: true
  };
  await setDoc('users', uid, userDoc);
  console.log(`✔ User doc users/${uid} creado/actualizado`);

  // 4. Audit log
  await createAuditDoc({
    type: 'user.created',
    description: `Cuenta creada para orientadora: ${nombre} (${email}) con rol ${TARGET_ROLE}`,
    metadata: {
      userId: uid,
      teacherId,
      email,
      displayName: nombre,
      role: TARGET_ROLE,
      source: 'create-test-orientadora-script',
      tempPassword: '(redactado)'
    },
    timestamp: new Date(),
    userId: 'system',
    userName: 'Sistema (script)'
  });
  console.log('✔ Audit log registrado');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ CUENTA LISTA PARA ENTRAR');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Email:     ${email}`);
  console.log(`  Password:  ${TEMP_PASSWORD}`);
  console.log(`  Nombre:    ${nombre}`);
  console.log(`  Rol:       ${TARGET_ROLE}`);
  console.log(`  TeacherId: ${teacherId}`);
  console.log('═══════════════════════════════════════════════════════════');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
