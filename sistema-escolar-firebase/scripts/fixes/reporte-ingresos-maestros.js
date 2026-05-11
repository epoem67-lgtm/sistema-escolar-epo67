/**
 * REPORTE — Quién ya entró al sistema y quién no.
 *
 * Lee todos los users que son personal escolar (docente, orientador,
 * subdirector, secretario, directivo, consulta — excluye admin y demo),
 * y los clasifica en dos grupos según `mustChangePassword`:
 *   - YA ENTRÓ  (mustChangePassword === false): completó su primer ingreso
 *   - PENDIENTE (mustChangePassword !== false): nunca ha entrado o no ha
 *     completado configuración inicial
 *
 * Solo lectura — no modifica nada.
 *
 * Uso: node scripts/fixes/reporte-ingresos-maestros.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

const DOCENTE_ROLES = [
  'maestro', 'orientador_docente', 'orientador',
  'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'
];

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname: 'firestore.googleapis.com', path: urlPath,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          else resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function val(f) {
  if (!f) return '';
  if (f.timestampValue) return f.timestampValue;
  return f.stringValue ?? f.booleanValue ?? f.integerValue ?? f.doubleValue ?? '';
}

function fmtFecha(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const ahora = new Date();
  const diffMin = Math.floor((ahora - d) / 60000);
  if (diffMin < 1) return 'hace segundos';
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ayer';
  if (diffD < 7) return `hace ${diffD} días`;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  REPORTE DE INGRESOS — EPO 67  (${new Date().toLocaleDateString('es-MX')})`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Lista todos los users (paginados si fuese necesario)
  const r = await api('POST', `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, {
    structuredQuery: { from: [{ collectionId: 'users' }], limit: 500 }
  });
  const users = (r || []).filter(d => d.document).map(d => ({
    id: d.document.name.split('/').pop(),
    fields: d.document.fields || {},
  }));

  // Filtrar solo personal escolar activo, sin demos
  const personal = users
    .filter(u => {
      const role = val(u.fields.role);
      const status = val(u.fields.status);
      const isDemo = val(u.fields.isDemo);
      return DOCENTE_ROLES.includes(role) && status === 'active' && !isDemo;
    })
    .map(u => ({
      uid: u.id,
      displayName: val(u.fields.displayName) || '(sin nombre)',
      email: val(u.fields.email),
      role: val(u.fields.role),
      mustChangePassword: val(u.fields.mustChangePassword),
      passwordChangedAt: val(u.fields.passwordChangedAt),
    }));

  const yaEntraron = personal.filter(u => u.mustChangePassword === false);
  const pendientes = personal.filter(u => u.mustChangePassword !== false);

  // Ordenar
  yaEntraron.sort((a, b) => {
    // Más recientes primero
    return (b.passwordChangedAt || '').localeCompare(a.passwordChangedAt || '');
  });
  pendientes.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const total = personal.length;
  const pctEntraron = total > 0 ? Math.round((yaEntraron.length / total) * 100) : 0;

  console.log(`📊 RESUMEN`);
  console.log(`   Total personal activo: ${total}`);
  console.log(`   ✅ Ya entraron:        ${yaEntraron.length}  (${pctEntraron}%)`);
  console.log(`   ⏳ Pendientes:         ${pendientes.length}  (${100 - pctEntraron}%)`);
  console.log();

  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  ✅ YA ENTRARON  (${yaEntraron.length})`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  yaEntraron.forEach((u, i) => {
    const fecha = u.passwordChangedAt ? fmtFecha(u.passwordChangedAt) : 's/fecha';
    const num = String(i + 1).padStart(2, '0');
    console.log(`  ${num}.  ${u.displayName.padEnd(45)}  ${fecha.padEnd(18)}  ${u.email}`);
  });

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  ⏳ NO HAN ENTRADO  (${pendientes.length})`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  pendientes.forEach((u, i) => {
    const num = String(i + 1).padStart(2, '0');
    console.log(`  ${num}.  ${u.displayName.padEnd(45)}  ${u.role.padEnd(20)}  ${u.email}`);
  });

  console.log();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
