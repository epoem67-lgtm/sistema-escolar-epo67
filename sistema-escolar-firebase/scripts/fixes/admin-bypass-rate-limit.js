/**
 * BYPASS DE RATE-LIMIT: cambia temporalmente el correo de Auth de Olivia
 * a uno fresco (sin historial de intentos fallidos) y le pone contraseña
 * conocida. Tras entrar, ella misma puede regresar a su gmail original
 * desde su perfil — o ejecutamos este script con --restore.
 *
 * Uso:
 *   node scripts/fixes/admin-bypass-rate-limit.js          # cambia a temp
 *   node scripts/fixes/admin-bypass-rate-limit.js --restore # regresa a oliepo67@gmail.com
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const ORIGINAL_EMAIL = 'oliepo67@gmail.com';
const TEMP_EMAIL = `oliepo67-temp-${Math.floor(10000 + Math.random() * 90000)}@gmail.com`;
const NEW_PWD = 'epo67-admin-' + Math.floor(1000 + Math.random() * 9000);

const RESTORE = process.argv.includes('--restore');

const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
let token;
try {
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  token = cfg.tokens && cfg.tokens.access_token;
  if (!token) throw new Error('Sin token');
} catch (e) {
  console.error('❌ Token no disponible:', e.message);
  process.exit(1);
}

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname,
      path: urlPath,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    }, (res) => {
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

// UID de Olivia — fijo, lo conocemos por previa consulta
const OLIVIA_UID = 'X2jjeI8nkqVQ8tMYfI2AzyX51sW2';

(async () => {
  // Localizar por uid (estable, no depende del email actual)
  const lookup = await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:lookup`,
    { localId: [OLIVIA_UID] }
  );
  if (!lookup.users || lookup.users.length === 0) {
    console.error(`❌ No encontré la cuenta uid=${OLIVIA_UID}`);
    process.exit(1);
  }
  const u = lookup.users[0];
  console.log(`Encontrada: uid=${u.localId} email=${u.email}`);

  if (RESTORE) {
    // Sólo cambia el email — NO toca la contraseña (eso invalida tokens y
    // saca al usuario cada vez que se hace el restore, generando un ciclo
    // de rate-limit). La contraseña que el usuario haya definido se conserva.
    console.log(`\n→ Restaurando email a ${ORIGINAL_EMAIL} (sin tocar contraseña)…`);
    await api('POST', 'identitytoolkit.googleapis.com',
      `/v1/projects/${PROJECT}/accounts:update`,
      { localId: u.localId, email: ORIGINAL_EMAIL }
    );
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`  RESTAURADO — el email es ahora ${ORIGINAL_EMAIL}`);
    console.log(`  La contraseña sigue siendo la que estabas usando.`);
    console.log('═══════════════════════════════════════════════════════════\n');
    return;
  }

  console.log(`\n→ Cambiando email a temp: ${TEMP_EMAIL}…`);
  await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    { localId: u.localId, email: TEMP_EMAIL }
  );
  console.log(`→ Reseteando contraseña…`);
  await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    { localId: u.localId, password: NEW_PWD }
  );
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  BYPASS LISTO — entra con esto:`);
  console.log(`  Correo:      ${TEMP_EMAIL}`);
  console.log(`  Contraseña:  ${NEW_PWD}`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n  Cuando estés adentro, corre:`);
  console.log(`  node scripts/fixes/admin-bypass-rate-limit.js --restore`);
  console.log(`  para regresar el correo a ${ORIGINAL_EMAIL}.\n`);
})().catch(e => { console.error('\n❌ Falló:', e.message); process.exit(1); });
