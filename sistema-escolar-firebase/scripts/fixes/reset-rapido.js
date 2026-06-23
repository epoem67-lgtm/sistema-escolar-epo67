// Reset rapido para Olivia: busca docente por nombre/correo, resetea password
// a algo aleatorio simple, y copia al portapapeles el mensaje listo para
// WhatsApp. Pensado para uso desde un archivo .command (doble clic) sin
// abrir terminal.
//
// Uso: node scripts/fixes/reset-rapido.js [busqueda]
//   busqueda: cualquier parte del nombre o correo (case-insensitive).
//   Si no se da, pregunta interactivamente.

const fs = require('fs');
const https = require('https');
const readline = require('readline');
const { execSync } = require('child_process');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';

// ─── Token Firebase ─────────────────────────────────────────────
let token;
try {
  const cfgPath = require('os').homedir() + '/.config/configstore/firebase-tools.json';
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.tokens && cfg.tokens.access_token) {
      token = cfg.tokens.access_token;
      fs.writeFileSync(TOKEN_PATH, token);
    }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('\n❌ ERROR: no hay token de Firebase.');
  console.error('   Refresca con:  npx firebase-tools projects:list');
  process.exit(1);
}

// ─── Helpers REST ───────────────────────────────────────────────
function api(method, host, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname: host, path,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
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

function parseDoc(doc) {
  const out = { _name: doc.name };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
  }
  return out;
}

async function listUsers() {
  const docs = [];
  let pageToken = null;
  do {
    const qs = pageToken ? `?pageToken=${pageToken}` : '';
    const res = await api('GET', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users${qs}`);
    if (res.documents) docs.push(...res.documents.map(parseDoc));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return docs;
}

// ─── Generar password simple memorizable ───────────────────────
function generatePassword() {
  // 6 digitos aleatorios — facil de dictar por WhatsApp o telefono.
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── Input interactivo ─────────────────────────────────────────
function ask(question) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); res(a.trim()); });
  });
}

// ─── Copy to clipboard (macOS) ─────────────────────────────────
function copyToClipboard(text) {
  try {
    execSync('pbcopy', { input: text });
    return true;
  } catch (e) {
    return false;
  }
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  🔑  RESET RAPIDO DE CONTRASEÑA — EPO 67           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  let busqueda = process.argv[2];
  if (!busqueda) {
    busqueda = await ask('Escribe parte del nombre o correo del docente: ');
  }
  if (!busqueda) {
    console.error('\n❌ Cancelado.');
    process.exit(1);
  }

  // Cargar usuarios y buscar
  console.log('\n🔍 Buscando "' + busqueda + '"...');
  const users = await listUsers();
  const q = busqueda.toLowerCase();
  const matches = users.filter(u => {
    const name = (u.displayName || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(q) || email.includes(q);
  });

  if (matches.length === 0) {
    console.error('\n❌ Sin resultados para "' + busqueda + '".');
    console.error('   Prueba con apellido o correo completo.\n');
    process.exit(1);
  }

  let selected;
  if (matches.length === 1) {
    selected = matches[0];
  } else {
    console.log('\n📋 Encontrados ' + matches.length + ' usuarios:\n');
    matches.forEach((u, i) => {
      console.log(`   ${i+1}. ${u.displayName || u.email}  (${u.email})`);
    });
    const idx = await ask('\nElige el numero (1-' + matches.length + '): ');
    const n = parseInt(idx, 10);
    if (!n || n < 1 || n > matches.length) {
      console.error('\n❌ Numero invalido.\n');
      process.exit(1);
    }
    selected = matches[n - 1];
  }

  const uid = selected._name.split('/').pop();
  const email = selected.email || '';
  const displayName = selected.displayName || email;

  if (!email || email.endsWith('@epo67.local')) {
    console.warn('\n⚠️  Este usuario tiene correo interno (@epo67.local).');
    console.warn('   No podra recibir correos de recuperacion despues.');
    console.warn('   Reseteamos contrasena igual.\n');
  }

  console.log(`\n✓ Seleccionado: ${displayName}`);
  console.log(`  Correo: ${email}`);
  console.log(`  UID:    ${uid}`);

  const confirmar = await ask('\n¿Resetear contrasena? (s/n): ');
  if (confirmar.toLowerCase() !== 's') {
    console.log('\n❌ Cancelado.\n');
    process.exit(0);
  }

  // Generar y aplicar password
  const newPwd = generatePassword();
  console.log('\n🔧 Aplicando contrasena nueva: ' + newPwd);

  try {
    await api('POST', 'identitytoolkit.googleapis.com',
      `/v1/projects/${PROJECT_ID}/accounts:update`,
      { localId: uid, password: newPwd });
    console.log('✓ Firebase Auth actualizado.');
  } catch (e) {
    console.error('\n❌ Error al aplicar password en Auth:', e.message);
    process.exit(1);
  }

  // Marcar mustChangePassword en Firestore
  try {
    await api('PATCH', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=mustChangePassword`,
      { fields: { mustChangePassword: { booleanValue: true } } });
    console.log('✓ Marcado mustChangePassword=true.');
  } catch (e) {
    console.warn('⚠ No se pudo marcar mustChangePassword:', e.message);
  }

  // Generar mensaje WhatsApp
  const primerNombre = displayName.split(' ').pop() || ''; // generalmente el ultimo "apellido nombres"
  const msg =
`Hola profe, le reseteamos su contrasena del sistema escolar:

Pagina: https://epo67-sistema.web.app/entrar.html

Correo: ${email}
Contrasena temporal: ${newPwd}

IMPORTANTE:
- Escribala TAL CUAL (6 numeros, sin espacios).
- Cuando entre, el sistema le pedira cambiar la contrasena por una propia.
- Si tiene problemas use la pagina alterna: epo67-sistema.web.app/entrar.html

Saludos.`;

  // Copiar al portapapeles
  const copied = copyToClipboard(msg);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✅  LISTO                                          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log('Datos del reset:');
  console.log('  Usuario:    ' + displayName);
  console.log('  Correo:     ' + email);
  console.log('  Contrasena: ' + newPwd);
  console.log('');
  if (copied) {
    console.log('📋 El mensaje LISTO PARA WHATSAPP ya esta en tu portapapeles.');
    console.log('   Abre WhatsApp, pega (Cmd+V) y manda.');
  } else {
    console.log('Mensaje para WhatsApp:');
    console.log('---');
    console.log(msg);
    console.log('---');
  }
  console.log('');

  // Esperar antes de cerrar para que se vea el resultado
  await ask('Presiona ENTER para cerrar esta ventana...');
}

main().catch(e => {
  console.error('\n❌ FALLO:', e.message, '\n');
  ask('Presiona ENTER para cerrar...').then(() => process.exit(1));
});
