// Resetea la contraseña en Firebase Auth de un usuario.
// Uso: node scripts/fixes/reset-user-password.js <uid> <nueva_password>
//
// Requiere /tmp/firebase-access-token.txt vigente.

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';

const [, , uid, newPwd] = process.argv;
if (!uid || !newPwd) {
  console.error('Uso: node reset-user-password.js <uid> <nueva_password>');
  process.exit(1);
}
if (newPwd.length < 6) {
  console.error('La contraseña debe tener al menos 6 caracteres.');
  process.exit(1);
}

let token;
try {
  // Refrescar token desde firebase-tools si está disponible
  const cfgPath = require('os').homedir() + '/.config/configstore/firebase-tools.json';
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.tokens && cfg.tokens.access_token) {
      token = cfg.tokens.access_token;
      // Sincronizar a /tmp
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

function api(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, hostname, path,
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

async function main() {
  console.log(`\n🔑 Reseteando contraseña para uid=${uid}...`);

  // Identity Toolkit Admin REST API: setAccountInfo
  // https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/update
  try {
    const result = await api(
      'POST',
      'identitytoolkit.googleapis.com',
      `/v1/projects/${PROJECT_ID}/accounts:update`,
      { localId: uid, password: newPwd }
    );
    console.log('✅ Contraseña actualizada correctamente.');
    console.log(`   Email: ${result.email || '(sin email)'}`);
    console.log(`   Nueva contraseña: ${newPwd}`);
    console.log('\nEl usuario tendrá que cambiarla al entrar (mustChangePassword=true).');
  } catch (e) {
    console.error('❌ Error al actualizar contraseña:', e.message);
    process.exit(1);
  }
}

main();
