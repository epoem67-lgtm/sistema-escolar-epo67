/**
 * AUDIT LOGIN STATUS — EPO 67
 *
 * Reporta qué maestros ya hicieron su primer ingreso al sistema y cuáles
 * siguen pendientes. Útil del 7 al 11 de mayo para monitorear que todos
 * entren ANTES de la captura.
 *
 * Indicadores:
 *   ✅ YA ENTRÓ — mustChangePassword=false, configuró su cuenta personal
 *   ⏳ PENDIENTE — mustChangePassword=true, aún no entra
 *   📧 Tiene correo de recuperación registrado
 *   📱 Tiene teléfono registrado
 *
 * Uso: node scripts/audits/audit-login-status.js
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
  return new Promise((resolve) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}` } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => resolve(data ? JSON.parse(data) : {}));
    });
    req.on('error', () => resolve({}));
    req.end();
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
function fmtDate(ts) {
  if (!ts?.timestampValue) return '—';
  const d = new Date(ts.timestampValue);
  return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ESTADO DE INGRESOS — Sistema Escolar EPO 67');
  console.log('  ' + new Date().toLocaleString('es-MX'));
  console.log('═══════════════════════════════════════════════════════════\n');

  const users = await getAll('users');
  const docentes = users
    .map(u => ({
      uid: u.name.split('/').pop(),
      name: val(u.fields?.displayName),
      email: val(u.fields?.email),
      role: val(u.fields?.role),
      status: val(u.fields?.status) || 'active',
      mustChange: u.fields?.mustChangePassword?.booleanValue !== false,  // default true
      recoveryEmail: val(u.fields?.recoveryEmail),
      phone: val(u.fields?.phone),
      passwordChangedAt: u.fields?.passwordChangedAt,
      isDemo: u.fields?.isDemo?.booleanValue || false,
    }))
    .filter(u => u.status === 'active' && !u.isDemo)
    .filter(u => ['maestro', 'orientador_docente', 'orientador', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'].includes(u.role));

  const yaEntraron = docentes.filter(u => !u.mustChange);
  const pendientes = docentes.filter(u => u.mustChange);
  const conRecovery = yaEntraron.filter(u => u.recoveryEmail && !u.recoveryEmail.endsWith('@epo67.local')).length;
  const conPhone = yaEntraron.filter(u => u.phone?.length === 10).length;

  // RESUMEN VISUAL
  const total = docentes.length;
  const pctEntraron = Math.round((yaEntraron.length / total) * 100);
  const pctPendientes = 100 - pctEntraron;

  console.log(`📊 RESUMEN GENERAL`);
  console.log(`   Total docentes:        ${total}`);
  console.log(`   ✅ Ya entraron:         ${yaEntraron.length.toString().padStart(3)} (${pctEntraron}%)`);
  console.log(`   ⏳ Pendientes:           ${pendientes.length.toString().padStart(3)} (${pctPendientes}%)`);
  console.log(`   📧 Con correo respaldo:  ${conRecovery.toString().padStart(3)} de ${yaEntraron.length}`);
  console.log(`   📱 Con teléfono:         ${conPhone.toString().padStart(3)} de ${yaEntraron.length}`);

  // BARRA VISUAL
  const blocks = 40;
  const filled = Math.round((yaEntraron.length / total) * blocks);
  const bar = '█'.repeat(filled) + '░'.repeat(blocks - filled);
  console.log(`\n   ${bar}  ${pctEntraron}%`);

  // LISTA DE QUE YA ENTRARON
  console.log(`\n\n✅ YA ENTRARON (${yaEntraron.length}) — ordenados por más recientes`);
  console.log('───────────────────────────────────────────────────────────');
  const sortedByDate = [...yaEntraron].sort((a, b) => {
    const ta = a.passwordChangedAt?.timestampValue || '';
    const tb = b.passwordChangedAt?.timestampValue || '';
    return tb.localeCompare(ta);
  });
  sortedByDate.forEach(u => {
    const flags = [];
    flags.push(u.recoveryEmail && !u.recoveryEmail.endsWith('@epo67.local') ? '📧' : '  ');
    flags.push(u.phone?.length === 10 ? '📱' : '  ');
    const fecha = fmtDate(u.passwordChangedAt);
    const role = (u.role || '').padEnd(20).slice(0, 20);
    console.log(`  ${flags.join(' ')}  ${(u.name || '').padEnd(45).slice(0, 45)}  ${role}  ${fecha}`);
  });

  // LISTA DE PENDIENTES
  console.log(`\n\n⏳ PENDIENTES DE PRIMER INGRESO (${pendientes.length})`);
  console.log('───────────────────────────────────────────────────────────');
  const sortedPend = [...pendientes].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sortedPend.forEach(u => {
    const role = (u.role || '').padEnd(20).slice(0, 20);
    console.log(`     ${(u.name || '').padEnd(45).slice(0, 45)}  ${role}  ${u.email}`);
  });

  // GUARDAR REPORTE A CSV
  const csvLines = [
    'Nombre,Email,Rol,Estado,Cambio de contraseña,Correo respaldo,Teléfono',
    ...docentes.map(u => [
      `"${(u.name || '').replace(/"/g, '""')}"`,
      `"${u.email}"`,
      `"${u.role}"`,
      `"${u.mustChange ? 'PENDIENTE' : 'YA ENTRÓ'}"`,
      `"${fmtDate(u.passwordChangedAt)}"`,
      `"${u.recoveryEmail || ''}"`,
      `"${u.phone || ''}"`,
    ].join(','))
  ];
  const fecha = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const outFile = `estado-ingresos-${fecha}.csv`;
  fs.writeFileSync(outFile, '﻿' + csvLines.join('\n'), 'utf-8');
  console.log(`\n\n📄 Reporte completo guardado en: ${outFile}\n`);
})();
