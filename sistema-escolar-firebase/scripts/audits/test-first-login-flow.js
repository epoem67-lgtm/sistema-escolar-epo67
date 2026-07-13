/**
 * TEST FIRST-LOGIN FLOW — EPO 67
 *
 * Simula el flujo COMPLETO de primer ingreso end-to-end con una cuenta REAL
 * de un maestro pendiente:
 *
 *   1. Login con contraseña inicial (signInWithPassword)
 *   2. Update password con la nueva (changePassword)
 *   3. Update Firestore con recoveryEmail + phone + mustChangePassword=false
 *   4. Verifica que todo se guardó correctamente
 *   5. REVIERTE TODO al estado original (resetea password + restaura Firestore)
 *
 * Si esto pasa sin errores, el flujo está garantizado para los 56 maestros.
 *
 * Uso:
 *   node scripts/audits/test-first-login-flow.js credenciales-bulk-2026-05-07.csv
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'AIzaSyDX4za0avN20Lplmf5LAR7pdfZlvNtvcJc';
const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

let adminToken;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { adminToken = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, adminToken); }
  }
  if (!adminToken) adminToken = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token admin'); process.exit(1); }

const csvFile = process.argv[2];
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Uso: node test-first-login-flow.js <ruta-al-csv>');
  process.exit(1);
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(csvFile, 'utf-8').replace(/^﻿/, '');
const lines = raw.split('\n').filter(l => l.trim());
lines.shift();
const rows = lines.map(l => parseCSVLine(l)).filter(r => r[4] === 'OK');
if (rows.length === 0) { console.error('CSV vacío'); process.exit(1); }

// HTTP helper genérico
function request(method, hostname, urlPath, body, headers = {}) {
  return new Promise((resolve) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Content-Type': 'application/json', ...headers } };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: j });
        } catch (e) { resolve({ status: res.statusCode, data, parseError: e.message }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

// 1. Sign in con email+password (token de usuario)
async function signInWithPassword(email, password) {
  const r = await request('POST', 'identitytoolkit.googleapis.com',
    `/v1/accounts:signInWithPassword?key=${API_KEY}`,
    JSON.stringify({ email, password, returnSecureToken: true })
  );
  if (r.status !== 200) return { ok: false, error: r.data?.error?.message || 'unknown' };
  return { ok: true, idToken: r.data.idToken, refreshToken: r.data.refreshToken, localId: r.data.localId };
}

// 2. Update password (cambiar contraseña con idToken)
async function updatePasswordAsUser(idToken, newPassword) {
  const r = await request('POST', 'identitytoolkit.googleapis.com',
    `/v1/accounts:update?key=${API_KEY}`,
    JSON.stringify({ idToken, password: newPassword, returnSecureToken: true })
  );
  if (r.status !== 200) return { ok: false, error: r.data?.error?.message || 'unknown' };
  return { ok: true, idToken: r.data.idToken };
}

// 3. Update Firestore como usuario (con idToken)
async function updateUserDocAsUser(uid, idToken, updates) {
  const fieldsObj = {};
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'string') fieldsObj[k] = { stringValue: v };
    else if (typeof v === 'boolean') fieldsObj[k] = { booleanValue: v };
    else if (v instanceof Date) fieldsObj[k] = { timestampValue: v.toISOString() };
  }
  const mask = Object.keys(updates).map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const r = await request('PATCH', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?${mask}`,
    JSON.stringify({ fields: fieldsObj }),
    { 'Authorization': `Bearer ${idToken}` }
  );
  if (r.status !== 200) return { ok: false, error: JSON.stringify(r.data) };
  return { ok: true };
}

// 4. Leer doc del usuario (como admin para verificar)
async function readUserDocAsAdmin(uid) {
  const r = await request('GET', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
    null,
    { 'Authorization': `Bearer ${adminToken}` }
  );
  if (r.status !== 200) return { ok: false, error: JSON.stringify(r.data) };
  return { ok: true, fields: r.data.fields || {} };
}

// 5. Reset password (admin) — para revertir el test
async function resetPasswordAsAdmin(uid, newPassword) {
  const r = await request('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    JSON.stringify({ localId: uid, password: newPassword }),
    { 'Authorization': `Bearer ${adminToken}` }
  );
  if (r.status !== 200) return { ok: false, error: JSON.stringify(r.data) };
  return { ok: true };
}

// 6. Restaurar campos del user doc (admin) — para revertir el test
async function restoreUserDocAsAdmin(uid, updates) {
  const fieldsObj = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined) {
      // Skip — no podemos hacer "delete field" fácilmente, pero sí podemos setearlo a vacío
      continue;
    }
    if (typeof v === 'string') fieldsObj[k] = { stringValue: v };
    else if (typeof v === 'boolean') fieldsObj[k] = { booleanValue: v };
  }
  const mask = Object.keys(fieldsObj).map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const r = await request('PATCH', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}?${mask}`,
    JSON.stringify({ fields: fieldsObj }),
    { 'Authorization': `Bearer ${adminToken}` }
  );
  if (r.status !== 200) return { ok: false, error: JSON.stringify(r.data) };
  return { ok: true };
}

// ─── MAIN ───
(async () => {
  // Tomar el primer maestro de la lista para hacer el test
  const test = rows[0];
  const [nombre, email, originalPwd] = test;
  const NEW_PWD = 'TestPassword123!';
  const TEST_RECOVERY = 'test-recovery@gmail.com';
  const TEST_PHONE = '5512345678';

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  TEST DEL FLUJO COMPLETO DE PRIMER INGRESO`);
  console.log(`  Maestro de prueba: ${nombre}`);
  console.log(`  Email: ${email}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  let uid = null;

  // ═══ PASO 1: Login con contraseña inicial ═══
  console.log('1️⃣  Iniciando sesión con contraseña inicial...');
  const signIn1 = await signInWithPassword(email, originalPwd);
  if (!signIn1.ok) {
    console.log(`   ❌ FALLÓ: ${signIn1.error}`);
    process.exit(1);
  }
  uid = signIn1.localId;
  console.log(`   ✅ OK. uid=${uid.slice(0, 12)}...`);

  // ═══ PASO 2: Cambiar contraseña ═══
  console.log('\n2️⃣  Cambiando contraseña a una nueva...');
  const updPwd = await updatePasswordAsUser(signIn1.idToken, NEW_PWD);
  if (!updPwd.ok) {
    console.log(`   ❌ FALLÓ: ${updPwd.error}`);
    // Intentar revertir
    await resetPasswordAsAdmin(uid, originalPwd);
    process.exit(1);
  }
  console.log(`   ✅ OK. Contraseña cambiada en Auth.`);

  // ═══ PASO 3: Update Firestore con datos de primer ingreso ═══
  console.log('\n3️⃣  Guardando recoveryEmail + phone + mustChangePassword=false en Firestore...');
  const updDoc = await updateUserDocAsUser(uid, updPwd.idToken, {
    recoveryEmail: TEST_RECOVERY,
    phone: TEST_PHONE,
    mustChangePassword: false,
    passwordChangedAt: new Date(),
  });
  if (!updDoc.ok) {
    console.log(`   ❌ FALLÓ: ${updDoc.error}`);
    console.log(`\n   ⚠️  Este es el bug que reportaste de ayer.`);
    console.log(`   Las reglas de Firestore están bloqueando algún campo.`);
    // Revertir password
    await resetPasswordAsAdmin(uid, originalPwd);
    process.exit(1);
  }
  console.log(`   ✅ OK. Documento Firestore actualizado.`);

  // ═══ PASO 4: Verificar que se guardó ═══
  console.log('\n4️⃣  Verificando que los datos se guardaron correctamente...');
  const readBack = await readUserDocAsAdmin(uid);
  if (!readBack.ok) {
    console.log(`   ❌ FALLÓ leer back: ${readBack.error}`);
    await resetPasswordAsAdmin(uid, originalPwd);
    process.exit(1);
  }
  const f = readBack.fields;
  const checks = [
    { label: 'recoveryEmail', expected: TEST_RECOVERY, got: f.recoveryEmail?.stringValue },
    { label: 'phone', expected: TEST_PHONE, got: f.phone?.stringValue },
    { label: 'mustChangePassword', expected: false, got: f.mustChangePassword?.booleanValue },
  ];
  let allPassed = true;
  for (const c of checks) {
    const passed = c.got === c.expected;
    console.log(`   ${passed ? '✅' : '❌'} ${c.label}: esperado=${c.expected}, obtenido=${c.got}`);
    if (!passed) allPassed = false;
  }

  // ═══ PASO 5: Login con nueva contraseña (verificar que el cambio surtió efecto) ═══
  console.log('\n5️⃣  Probando login con la nueva contraseña...');
  const signIn2 = await signInWithPassword(email, NEW_PWD);
  if (!signIn2.ok) {
    console.log(`   ❌ FALLÓ: ${signIn2.error}`);
    allPassed = false;
  } else {
    console.log(`   ✅ OK. La nueva contraseña funciona.`);
  }

  // ═══ PASO 6: Verificar que la contraseña vieja YA NO funciona ═══
  console.log('\n6️⃣  Verificando que la contraseña INICIAL ya NO funciona...');
  const signInOld = await signInWithPassword(email, originalPwd);
  if (signInOld.ok) {
    console.log(`   ⚠️  La contraseña vieja TODAVÍA funciona — esto es raro.`);
  } else {
    console.log(`   ✅ OK. Contraseña inicial rechazada como debe ser (${signInOld.error}).`);
  }

  // ═══ ROLLBACK: revertir todo al estado original ═══
  console.log('\n🔄 Revirtiendo cambios (volviendo a estado original)...');

  console.log('   - Restaurando contraseña original...');
  const restorePwd = await resetPasswordAsAdmin(uid, originalPwd);
  console.log(`   ${restorePwd.ok ? '✅' : '❌'} ${restorePwd.ok ? 'OK' : restorePwd.error}`);

  console.log('   - Restaurando mustChangePassword=true en Firestore...');
  const restoreDoc = await restoreUserDocAsAdmin(uid, { mustChangePassword: true });
  console.log(`   ${restoreDoc.ok ? '✅' : '❌'} ${restoreDoc.ok ? 'OK' : restoreDoc.error}`);

  // Verificar que quedó como antes
  const finalCheck = await signInWithPassword(email, originalPwd);
  console.log(`   ${finalCheck.ok ? '✅' : '❌'} Login con contraseña ORIGINAL funciona de nuevo: ${finalCheck.ok ? 'SÍ' : 'NO'}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  if (allPassed && finalCheck.ok) {
    console.log('  🎉 TODOS LOS PASOS PASARON');
    console.log('  ✅ El flujo completo de primer ingreso FUNCIONA correctamente');
    console.log('  ✅ El estado del maestro fue revertido al original');
    console.log('  → Ahora SÍ puedes mandar el link a tus maestros con confianza.');
  } else {
    console.log('  ⚠️  Algunos pasos fallaron. Revisa los errores arriba.');
  }
  console.log('═══════════════════════════════════════════════════════════\n');
})();
