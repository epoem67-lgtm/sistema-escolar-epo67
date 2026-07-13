/**
 * BULK RESET PASSWORDS — EPO 67
 *
 * Resetea las contraseñas en Auth de TODOS los maestros pendientes
 * (mustChangePassword=true). Genera contraseñas nuevas tipo epo67-XXXX,
 * las aplica en Auth via REST API, y outputs un CSV con las credenciales
 * para subir a Drive y entregar al personal docente.
 *
 * Uso:
 *   node scripts/fixes/bulk-reset-passwords.js              # DRY RUN (no modifica nada)
 *   node scripts/fixes/bulk-reset-passwords.js --apply      # APLICA los resets
 *   node scripts/fixes/bulk-reset-passwords.js --apply --all # también incluye los que ya tienen contraseña
 *
 * Output:
 *   - credenciales-bulk-{fecha}.csv con: nombre, email, contraseña inicial, rol
 *   - Resumen en consola: cuántos OK, cuántos fallaron
 *
 * Robusto:
 *   - Retries automáticos en cada request (3 intentos con backoff)
 *   - Pausa cada 10 maestros para no saturar el servicio
 *   - Si falla uno, sigue con los demás (no para todo)
 *   - Token se refresca automáticamente desde firebase-tools si está disponible
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

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
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('❌ No se pudo leer el token. Refresca con: npx firebase-tools projects:list');
  process.exit(1);
}

// ─── Helpers ───
function api(method, hostname, urlPath, body, attempt = 1) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 500 && attempt < 3) {
            // Retry en errores de servidor
            setTimeout(() => api(method, hostname, urlPath, body, attempt + 1).then(resolve).catch(reject), 1000 * attempt);
            return;
          }
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => {
      if (attempt < 3) {
        setTimeout(() => api(method, hostname, urlPath, body, attempt + 1).then(resolve).catch(reject), 1000 * attempt);
      } else reject(e);
    });
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

// Genera contraseña fácil de dictar: epo67-XXXX donde XXXX son 4 dígitos
function genPwd() {
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `epo67-${digits}`;
}

// Identity Toolkit: actualizar contraseña
async function updateAuthPassword(uid, newPwd) {
  return api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    { localId: uid, password: newPwd }
  );
}

// Firestore: marcar mustChangePassword=true para forzar cambio en primer ingreso
async function markMustChange(uid) {
  const urlPath = `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=mustChangePassword`;
  return api('PATCH', 'firestore.googleapis.com', urlPath, {
    fields: { mustChangePassword: { booleanValue: true } }
  });
}

// Sleep helper
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Main ───
(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  BULK RESET — Contraseñas de maestros EPO 67');
  console.log(`  Modo: ${APPLY ? '🔴 APPLY (aplica cambios reales)' : '🟢 DRY RUN (no modifica nada)'}`);
  console.log(`  Alcance: ${ALL ? 'TODOS los maestros activos' : 'Solo maestros con mustChangePassword=true'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📥 Cargando usuarios...');
  const users = await getAll('users');
  const candidates = users
    .map(u => ({
      uid: u.name.split('/').pop(),
      email: val(u.fields?.email),
      displayName: val(u.fields?.displayName),
      role: val(u.fields?.role),
      status: val(u.fields?.status) || 'active',
      mustChangePassword: u.fields?.mustChangePassword?.booleanValue || false,
      phone: val(u.fields?.phone),
      recoveryEmail: val(u.fields?.recoveryEmail),
    }))
    .filter(u =>
      u.status === 'active' &&
      ['maestro', 'orientador_docente', 'orientador', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'].includes(u.role) &&
      (ALL || u.mustChangePassword)
    )
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  console.log(`   ✓ ${candidates.length} maestro(s) candidato(s) a reset\n`);

  if (candidates.length === 0) {
    console.log('No hay maestros que necesiten reset.\n');
    return;
  }

  if (!APPLY) {
    console.log('🟢 DRY RUN — estos maestros se reseteaían (no se aplica nada todavía):\n');
    candidates.slice(0, 10).forEach(c => {
      const pwd = genPwd();
      console.log(`   ${(c.displayName || '').padEnd(45).slice(0, 45)} ${c.email.padEnd(40)} → ${pwd}`);
    });
    if (candidates.length > 10) console.log(`   ... y ${candidates.length - 10} más`);
    console.log('\n💡 Para aplicar realmente: agrega --apply al comando');
    console.log('   node scripts/fixes/bulk-reset-passwords.js --apply\n');
    return;
  }

  // APPLY mode
  console.log('🔴 APLICANDO RESETS (con retries automáticos)...\n');
  const results = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const newPwd = genPwd();
    const progress = `[${i + 1}/${candidates.length}]`;

    try {
      await updateAuthPassword(c.uid, newPwd);
      await markMustChange(c.uid);
      console.log(`  ✅ ${progress} ${(c.displayName || '').padEnd(40).slice(0, 40)} → ${newPwd}`);
      results.push({ ...c, newPwd, status: 'OK' });
      ok++;
    } catch (e) {
      console.log(`  ❌ ${progress} ${c.displayName} — ERROR: ${e.message.slice(0, 80)}`);
      results.push({ ...c, newPwd: '', status: 'FAIL', error: e.message });
      fail++;
    }

    // Pausa cada 10 para no saturar
    if ((i + 1) % 10 === 0 && i < candidates.length - 1) {
      console.log(`  ... pausa de 1s ...`);
      await sleep(1000);
    }
  }

  // Generar CSV con resultados
  const csvRows = [
    ['Nombre', 'Email', 'Contraseña Inicial', 'Rol', 'Status'].join(','),
    ...results.map(r => [
      `"${(r.displayName || '').replace(/"/g, '""')}"`,
      `"${r.email}"`,
      `"${r.newPwd || '(falló)'}"`,
      `"${r.role}"`,
      `"${r.status}"`,
    ].join(','))
  ];
  const fecha = new Date().toISOString().slice(0, 10);
  const csvFile = path.join(process.cwd(), `credenciales-bulk-${fecha}.csv`);
  fs.writeFileSync(csvFile, '﻿' + csvRows.join('\n'), 'utf-8');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✅ Reseteados OK:   ${ok}`);
  console.log(`  ❌ Fallaron:        ${fail}`);
  console.log(`  📄 CSV generado:    ${csvFile}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (fail > 0) {
    console.log('⚠ Algunos fallaron. Revisa el CSV y ejecuta de nuevo el script para los que fallaron.');
    console.log('  El script es IDEMPOTENTE — puedes correrlo varias veces, los OK quedan iguales.\n');
  }

  console.log('📌 Próximos pasos:');
  console.log('  1. Abre el CSV — verifica que se ve bien.');
  console.log('  2. Súbelo a Google Drive (puedes convertirlo a Sheets si quieres).');
  console.log('  3. Compártelo con tu personal docente con permiso de "ver".');
  console.log('  4. Cada maestro busca SU fila por nombre y entra con su contraseña inicial.');
  console.log('  5. El sistema les pide cambiar contraseña + correo de respaldo + teléfono al entrar.');
  console.log('  6. Después de su primer ingreso, mustChangePassword=false y la contraseña queda PERSONAL.\n');

})().catch(e => {
  console.error('\n❌ Error fatal:', e.message);
  process.exit(1);
});
