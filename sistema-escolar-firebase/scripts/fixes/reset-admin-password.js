/**
 * Reset directo de la contraseña del admin Olivia (oliepo67@gmail.com).
 * One-shot — usa el token de firebase-tools, no depende del correo de reset.
 *
 * Uso: node scripts/fixes/reset-admin-password.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const EMAIL = 'oliepo67@gmail.com';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

// Contraseña temporal estable — Olivia la cambia desde su perfil al entrar.
const NEW_PWD = 'epo67-admin-' + Math.floor(1000 + Math.random() * 9000);

let token;
try {
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  token = cfg.tokens && cfg.tokens.access_token;
  if (!token) throw new Error('Sin access_token');
} catch (e) {
  console.error('❌ No se pudo leer token de firebase-tools:', e.message);
  console.error('   Corre `npx firebase-tools projects:list` para refrescar el login.');
  process.exit(1);
}

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname,
      path: urlPath,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
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

(async () => {
  console.log(`\nBuscando usuario ${EMAIL}…`);
  const lookup = await api(
    'POST',
    'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:lookup`,
    { email: [EMAIL] }
  );
  if (!lookup.users || lookup.users.length === 0) {
    console.error(`❌ No existe ninguna cuenta con email ${EMAIL} en Firebase Auth de ${PROJECT}.`);
    process.exit(1);
  }
  const u = lookup.users[0];
  console.log(`   ✓ Cuenta encontrada — uid: ${u.localId}, email: ${u.email}, disabled: ${u.disabled || false}`);

  if (u.disabled) {
    console.log(`\n⚠️  La cuenta está DISABLED en Firebase Auth. Reactivándola…`);
    await api(
      'POST',
      'identitytoolkit.googleapis.com',
      `/v1/projects/${PROJECT}/accounts:update`,
      { localId: u.localId, disableUser: false }
    );
    console.log(`   ✓ Reactivada`);
  }

  console.log(`\nReseteando contraseña…`);
  await api(
    'POST',
    'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    { localId: u.localId, password: NEW_PWD }
  );
  console.log(`   ✓ Contraseña actualizada\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  NUEVAS CREDENCIALES — guardar y entrar');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Correo:      ${EMAIL}`);
  console.log(`  Contraseña:  ${NEW_PWD}`);
  console.log('═══════════════════════════════════════════════════════════\n');
})().catch(e => {
  console.error('\n❌ Falló:', e.message);
  process.exit(1);
});
