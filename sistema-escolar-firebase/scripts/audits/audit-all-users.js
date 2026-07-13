/**
 * AUDIT TODOS los usuarios — desglose por rol
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
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, hostname, urlPath) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => { try { const j = data ? JSON.parse(data) : {}; resolve(j); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

async function getAll(coll) {
  const out = []; let pt = null;
  do {
    let p = `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
    if (pt) p += '&pageToken=' + pt;
    const r = await api('GET', 'firestore.googleapis.com', p);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return out;
}

function val(f) { if (!f) return ''; return f.stringValue || f.booleanValue || ''; }

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DESGLOSE COMPLETO DE CUENTAS — Sistema Escolar EPO 67');
  console.log('═══════════════════════════════════════════════════════════\n');

  const users = await getAll('users');
  const list = users.map(u => ({
    uid: u.name.split('/').pop(),
    email: val(u.fields?.email),
    name: val(u.fields?.displayName),
    role: val(u.fields?.role) || '(sin rol)',
    status: val(u.fields?.status) || 'active',
    mustChange: u.fields?.mustChangePassword?.booleanValue || false,
  }));

  // Agrupar por rol
  const byRole = {};
  list.forEach(u => {
    if (!byRole[u.role]) byRole[u.role] = [];
    byRole[u.role].push(u);
  });

  const total = list.length;
  const active = list.filter(u => u.status === 'active').length;
  const pending = list.filter(u => u.status === 'active' && u.mustChange).length;
  const configured = list.filter(u => u.status === 'active' && !u.mustChange).length;

  console.log(`📊 TOTAL en Firestore: ${total} cuentas`);
  console.log(`   • Activas:                  ${active}`);
  console.log(`   • Inactivas:                ${total - active}`);
  console.log(`   • Pendientes 1er ingreso:   ${pending}`);
  console.log(`   • Ya configuradas:          ${configured}`);

  console.log('\n┌──────────────────────────────────────────────────┐');
  console.log('│  DESGLOSE POR ROL                                  │');
  console.log('├──────────────────────────────────────────────────┤');
  Object.keys(byRole).sort().forEach(role => {
    const us = byRole[role];
    const a = us.filter(u => u.status === 'active').length;
    const p = us.filter(u => u.status === 'active' && u.mustChange).length;
    const c = us.filter(u => u.status === 'active' && !u.mustChange).length;
    console.log(`│  ${role.padEnd(25)} ${String(us.length).padStart(2)} (activos: ${a}, pendientes: ${p}, listos: ${c})`);
  });
  console.log('└──────────────────────────────────────────────────┘\n');

  console.log('LISTADO COMPLETO POR ROL:\n');
  Object.keys(byRole).sort().forEach(role => {
    console.log(`\n=== ${role.toUpperCase()} (${byRole[role].length}) ===`);
    byRole[role]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .forEach(u => {
        const flags = [];
        if (u.status !== 'active') flags.push('INACTIVO');
        if (u.mustChange) flags.push('PENDIENTE 1er ingreso');
        else flags.push('configurada');
        console.log(`  • ${(u.name || '(sin nombre)').padEnd(45).slice(0, 45)} | ${(u.email || '').padEnd(40).slice(0, 40)} | ${flags.join(', ')}`);
      });
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  EXPLICACIÓN: ¿por qué generamos solo 56 cartas?');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Las 56 cartas SOLO incluyen maestros + orientadores + orientador_docente');
  console.log('  con mustChangePassword=true (pendientes de primer ingreso).');
  console.log('  ');
  console.log('  NO se generaron cartas para:');
  console.log('  • admins (Olivia, Karina, Octavio, Roberto) — ya tienen su contraseña');
  console.log('  • directivos (Lupita) — ya tiene contraseña');
  console.log('  • consulta (Rosalva) — ya tiene contraseña');
  console.log('  • cuentas que ya cambiaron su contraseña personal');
  console.log('═══════════════════════════════════════════════════════════\n');
})();
