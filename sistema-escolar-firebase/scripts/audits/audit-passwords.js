/**
 * AUDIT — Estado de cuentas de maestros
 *
 * Te dice EXACTAMENTE en qué estado está cada cuenta.
 * Solo lectura, no modifica nada. Seguro de correr cuando quieras.
 *
 * Uso: node scripts/audits/audit-passwords.js
 *
 * Reporta:
 *   - Total de maestros activos
 *   - Cuántos tienen cuenta Auth creada
 *   - Cuántos están PENDIENTES de primer ingreso (mustChangePassword=true)
 *   - Cuántos YA cambiaron contraseña (lista limpia)
 *   - Cuántos tienen recoveryEmail registrado
 *   - Cuántos tienen teléfono registrado
 *   - Lista detallada por maestro
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
    if (cfg.tokens && cfg.tokens.access_token) {
      token = cfg.tokens.access_token;
      fs.writeFileSync(TOKEN_PATH, token);
    }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('No se pudo leer el token. Refrescar con: npx firebase-tools projects:list');
  process.exit(1);
}

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
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

async function fetchPage(coll, pt) {
  let p = `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
  if (pt) p += '&pageToken=' + pt;
  return api('GET', 'firestore.googleapis.com', p);
}

async function getAll(coll) {
  const out = [];
  let pt = null;
  do {
    const r = await fetchPage(coll, pt);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return out;
}

function val(field) {
  if (!field) return '';
  return field.stringValue || field.booleanValue || field.integerValue || field.timestampValue || '';
}

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  AUDIT: Estado de cuentas de maestros — EPO 67');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📥 Cargando datos...');
  const [teachers, users] = await Promise.all([
    getAll('teachers'),
    getAll('users')
  ]);

  const teacherList = teachers
    .map(t => ({
      id: t.name.split('/').pop(),
      nombre: val(t.fields?.nombre),
      email: val(t.fields?.email),
      estatus: val(t.fields?.estatus) || 'active',
    }))
    .filter(t => t.estatus !== 'baja' && t.estatus !== 'BAJA');

  const userList = users.map(u => ({
    uid: u.name.split('/').pop(),
    email: val(u.fields?.email),
    displayName: val(u.fields?.displayName),
    role: val(u.fields?.role),
    status: val(u.fields?.status) || 'active',
    teacherId: val(u.fields?.teacherId),
    mustChangePassword: u.fields?.mustChangePassword?.booleanValue || false,
    recoveryEmail: val(u.fields?.recoveryEmail),
    phone: val(u.fields?.phone),
    passwordChangedAt: val(u.fields?.passwordChangedAt),
  }));

  // Filtrar usuarios que son maestros / orientador_docente / orientador
  const docenteUsers = userList.filter(u =>
    u.status === 'active' &&
    ['maestro', 'orientador_docente', 'orientador'].includes(u.role)
  );

  // Stats
  const total = docenteUsers.length;
  const pending = docenteUsers.filter(u => u.mustChangePassword).length;
  const configured = docenteUsers.filter(u => !u.mustChangePassword).length;
  const withRecovery = docenteUsers.filter(u => u.recoveryEmail && !u.recoveryEmail.endsWith('@epo67.local')).length;
  const withPhone = docenteUsers.filter(u => u.phone && u.phone.length === 10).length;

  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│  ESTADO ACTUAL DE CUENTAS                    │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Total docentes activos:      ${String(total).padStart(4)}          │`);
  console.log(`│  ✅ Con contraseña configurada: ${String(configured).padStart(4)}        │`);
  console.log(`│  ⏳ PENDIENTES primer ingreso:  ${String(pending).padStart(4)}        │`);
  console.log(`│  📧 Con correo recuperación:    ${String(withRecovery).padStart(4)}        │`);
  console.log(`│  📱 Con teléfono registrado:    ${String(withPhone).padStart(4)}        │`);
  console.log('└─────────────────────────────────────────────┘\n');

  // Maestros sin cuenta de usuario (en teachers pero no en users)
  const teacherIdsWithUser = new Set(userList.map(u => u.teacherId).filter(Boolean));
  const teachersSinCuenta = teacherList.filter(t => !teacherIdsWithUser.has(t.id));
  console.log(`⚠ Docentes en "teachers" SIN cuenta en "users": ${teachersSinCuenta.length}`);
  if (teachersSinCuenta.length > 0 && teachersSinCuenta.length <= 5) {
    teachersSinCuenta.forEach(t => console.log(`   - ${t.nombre} (${t.email || '(sin email)'})`));
  }

  // Lista detallada
  console.log('\n┌──────────────────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  PENDIENTES DE PRIMER INGRESO (necesitan contraseña inicial)                              │');
  console.log('├──────────────────────────────────────────────────────────────────────────────────────────┤');

  const pendingList = docenteUsers
    .filter(u => u.mustChangePassword)
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  pendingList.slice(0, 30).forEach(u => {
    const tel = u.phone ? '📱' : '  ';
    const rec = u.recoveryEmail && !u.recoveryEmail.endsWith('@epo67.local') ? '📧' : '  ';
    const role = u.role.padEnd(18);
    const name = (u.displayName || '').padEnd(40).slice(0, 40);
    console.log(`│ ${tel} ${rec} ${role} ${name} ${u.email}`);
  });
  if (pendingList.length > 30) console.log(`│   ... y ${pendingList.length - 30} más`);
  console.log('└──────────────────────────────────────────────────────────────────────────────────────────┘\n');

  // Recomendaciones
  console.log('💡 RECOMENDACIÓN:\n');
  if (pending > 0) {
    console.log(`  Hay ${pending} maestro(s) pendiente(s) de primer ingreso.`);
    console.log('  Para resetear sus contraseñas y entregar credenciales:');
    console.log('  1. Entra al sistema como admin');
    console.log('  2. Gestión de Usuarios → "Cartas personales (PDF)"');
    console.log('  3. Marca "Generar contraseñas NUEVAS para TODOS"');
    console.log('  4. Te aparecerán los comandos para correr en Terminal');
    console.log('  5. Subes el PDF a Drive y compartes el link.\n');
  } else {
    console.log('  ✅ Todos los maestros ya configuraron su contraseña.');
    console.log('  Si quieres resetear todo de cero igualmente, usa el flujo de "Cartas personales".\n');
  }

  if (withRecovery < total * 0.8) {
    console.log(`  ⚠ Solo ${withRecovery} de ${total} maestros tienen correo de recuperación.`);
    console.log('  Si pierden contraseña, NO podrán recuperarla solos — tendrán que esperar a Olivia.');
    console.log('  El sistema ahora obliga a registrar correo en primer ingreso, así que esto se arregla solo.\n');
  }

  if (withPhone < total * 0.5) {
    console.log(`  📱 Solo ${withPhone} de ${total} maestros tienen teléfono registrado.`);
    console.log('  El sistema ahora pide teléfono obligatorio en primer ingreso (v5.93).\n');
  }

  console.log('═══════════════════════════════════════════════════════════\n');
})().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
