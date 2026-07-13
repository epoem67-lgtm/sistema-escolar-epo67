/**
 * CREATE SINGLE USER — EPO 67
 *
 * Crea UN usuario en Firebase Auth + Firestore en una sola operación.
 * Pensado para usarse desde el panel de admin: la UI genera la contraseña,
 * el admin pega el comando aquí y este script aplica los cambios reales.
 *
 * Uso:
 *   node scripts/fixes/create-single-user.js \
 *     --email user@example.com \
 *     --name "APELLIDO1 APELLIDO2 NOMBRE" \
 *     --role maestro \
 *     --password "epo67-XXXX" \
 *     [--phone 5215512345678] \
 *     [--recovery alt@gmail.com] \
 *     [--teacherId abc123]
 *
 * Comportamiento:
 *   - Crea cuenta en Firebase Auth con la contraseña dada
 *   - Crea documento users/{uid} con todos los campos + mustChangePassword=true
 *   - NO almacena la contraseña en cleartext en Firestore (solo en Auth)
 *   - Marca audit log con la accion
 *   - Si el email ya existe en Auth, falla con mensaje claro
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

// ─── Args parsing ───
function getArg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

const email = getArg('email');
const displayName = getArg('name');
const role = getArg('role');
const password = getArg('password');
const phone = getArg('phone') || '';
const recoveryEmail = getArg('recovery') || '';
const teacherId = getArg('teacherId') || '';

if (!email || !displayName || !role || !password) {
  console.error('Faltan argumentos.');
  console.error('Uso: node create-single-user.js --email <email> --name "<nombre>" --role <rol> --password <pwd> [--phone <tel>] [--recovery <email>] [--teacherId <id>]');
  process.exit(1);
}
if (password.length < 6) {
  console.error('La contraseña debe tener al menos 6 caracteres.');
  process.exit(1);
}

const VALID_ROLES = ['admin', 'subdirector', 'secretario_admin', 'secretario_escolar', 'directivo', 'orientador', 'orientador_docente', 'maestro', 'consulta'];
if (!VALID_ROLES.includes(role)) {
  console.error(`Rol invalido: ${role}. Validos: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

// ─── Token ───
let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens && cfg.tokens.access_token) {
      token = cfg.tokens.access_token;
      fs.writeFileSync(TOKEN_PATH, token);
    }
  }
  if (!token) {
    token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
  }
} catch (e) {
  console.error('No se pudo leer el token:', e.message);
  console.error('Refresca con:  npx firebase-tools projects:list');
  process.exit(1);
}

// ─── HTTP helper ───
function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, hostname, path: urlPath,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
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

// ─── Firestore value formatting ───
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

// ─── Auth + Firestore operations ───
async function authLookup(email) {
  const r = await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:lookup`,
    { email: [email] }
  ).catch(() => ({ users: [] }));
  return r.users?.[0] || null;
}

async function authCreate(email, password, displayName) {
  const r = await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts`,
    { email, password, displayName, emailVerified: false }
  );
  return r.localId;
}

async function setUserDoc(uid, fields) {
  const urlPath = `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return api('PATCH', 'firestore.googleapis.com', urlPath, body);
}

async function postAuditLog(fields) {
  const urlPath = `/v1/projects/${PROJECT}/databases/(default)/documents/activityLog`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return api('POST', 'firestore.googleapis.com', urlPath, body);
}

// ─── Main ───
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  CREATE SINGLE USER — EPO 67');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Email:    ${email}`);
  console.log(`  Nombre:   ${displayName}`);
  console.log(`  Rol:      ${role}`);
  console.log(`  Phone:    ${phone || '(sin teléfono)'}`);
  console.log(`  Recovery: ${recoveryEmail || '(sin correo recuperación)'}`);
  console.log(`  Teacher:  ${teacherId || '(sin teacherId)'}`);
  console.log('───────────────────────────────────────────────────────────\n');

  // 1) Verificar que el email no exista en Auth
  console.log('🔎 Verificando email en Auth...');
  const existing = await authLookup(email);
  if (existing) {
    console.error(`❌ El email ${email} ya tiene cuenta en Auth (uid=${existing.localId}).`);
    console.error('   Usa el botón "Reset + WA" desde el panel para cambiar contraseña, no recrearlo.');
    process.exit(1);
  }
  console.log('   ✓ Email disponible.\n');

  // 2) Crear cuenta en Auth
  console.log('🔐 Creando cuenta en Firebase Auth...');
  let uid;
  try {
    uid = await authCreate(email, password, displayName);
    console.log(`   ✓ Cuenta creada. uid=${uid}\n`);
  } catch (e) {
    console.error('❌ Error al crear cuenta en Auth:', e.message);
    process.exit(1);
  }

  // 3) Crear doc users/{uid} en Firestore
  console.log('📄 Creando documento Firestore users/' + uid + '...');
  const userFields = {
    email,
    displayName,
    role,
    status: 'active',
    mustChangePassword: true,
    autoCreado: false,
    createdAt: new Date(),
  };
  if (phone) userFields.phone = phone;
  if (recoveryEmail) userFields.recoveryEmail = recoveryEmail;
  if (teacherId) userFields.teacherId = teacherId;

  try {
    await setUserDoc(uid, userFields);
    console.log('   ✓ Documento Firestore creado.\n');
  } catch (e) {
    console.error('⚠ Doc Firestore falló (Auth ya creado):', e.message);
    console.error('   Tendrás que crear el doc users/' + uid + ' manualmente.');
    process.exit(1);
  }

  // 4) Audit log
  console.log('📝 Registrando audit log...');
  try {
    await postAuditLog({
      action: 'crear_usuario_terminal',
      entityType: 'usuario',
      entityId: uid,
      description: `Usuario creado vía script: ${displayName} (${email}) con rol ${role}. Contraseña inicial generada por admin.`,
      timestamp: new Date(),
      after: { email, displayName, role, mustChangePassword: true, hasPhone: !!phone, hasRecovery: !!recoveryEmail }
    });
    console.log('   ✓ Audit log creado.\n');
  } catch (e) {
    console.warn('   ⚠ No se pudo crear audit log:', e.message);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ USUARIO CREADO EXITOSAMENTE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  uid:      ${uid}`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}  ← compártela por WhatsApp`);
  console.log(`  rol:      ${role}`);
  console.log('');
  console.log('📌 Próximos pasos:');
  console.log('  1. Manda el WhatsApp al usuario con email + contraseña');
  console.log('  2. Cuando entre, el sistema le pedirá cambiar la contraseña');
  console.log('  3. La contraseña actual SOLO la tienes tú aquí — anótala o mándala ya');
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n❌ Error fatal:', e.message);
  process.exit(1);
});
