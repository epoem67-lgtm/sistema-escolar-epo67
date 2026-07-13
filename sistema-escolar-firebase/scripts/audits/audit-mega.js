/**
 * MEGA AUDITORÍA — EPO 67
 *
 * Audita el sistema completo:
 *   1. Censo de cuentas existentes por rol
 *   2. Identifica usuarios faltantes
 *   3. Verifica integridad de datos (orientadorId, teacherId, etc)
 *   4. Reporta cobertura
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
const TOKEN = config.tokens.access_token;

function request(method, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    };
    const req = https.request(u, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(data); }
        } else reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchPage(coll, pt) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
  if (pt) url += '&pageToken=' + pt;
  return request('GET', url);
}
async function getAll(coll) {
  const all = []; let pt = null;
  do { const r = await fetchPage(coll, pt); if (r.documents) all.push(...r.documents); pt = r.nextPageToken; } while (pt);
  return all;
}

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  MEGA AUDITORÍA — Sistema EPO 67');
  console.log('  Fecha:', new Date().toLocaleString('es-MX'));
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📥 Cargando datos...');
  const [users, teachers, groups, assignments, schoolStaff] = await Promise.all([
    getAll('users'),
    getAll('teachers'),
    getAll('groups'),
    getAll('assignments'),
    request('GET', `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/config/school`).catch(() => ({}))
  ]);

  console.log(`   users: ${users.length}, teachers: ${teachers.length}, groups: ${groups.length}, assignments: ${assignments.length}\n`);

  // ─── FASE 1: CENSO DE USUARIOS POR ROL ───
  console.log('═══ FASE 1: CENSO DE USUARIOS POR ROL ═══');
  const byRole = {};
  users.forEach(u => {
    const r = u.fields?.role?.stringValue || '(sin rol)';
    byRole[r] = (byRole[r] || []);
    byRole[r].push({
      id: u.name.split('/').pop(),
      email: u.fields?.email?.stringValue || '',
      displayName: u.fields?.displayName?.stringValue || '',
      teacherId: u.fields?.teacherId?.stringValue || '',
      recoveryEmail: u.fields?.recoveryEmail?.stringValue || '',
      mustChangePassword: u.fields?.mustChangePassword?.booleanValue || false
    });
  });

  Object.keys(byRole).sort().forEach(r => {
    console.log(`\n  Rol "${r}" (${byRole[r].length}):`);
    byRole[r].forEach(u => {
      const flags = [];
      if (!u.recoveryEmail) flags.push('sin correo recup');
      if (u.mustChangePassword) flags.push('debe cambiar pwd');
      if (!u.teacherId && r !== 'admin' && r !== 'directivo' && r !== 'consulta') flags.push('sin teacherId');
      const flagStr = flags.length > 0 ? ` ⚠ ${flags.join(', ')}` : '';
      console.log(`    • ${u.displayName.padEnd(40)} ${u.email}${flagStr}`);
    });
  });

  // ─── FASE 2: CUENTAS FALTANTES ───
  console.log('\n\n═══ FASE 2: COBERTURA DE ACCESO ═══');
  const tList = teachers.map(t => ({
    id: t.name.split('/').pop(),
    nombre: t.fields?.nombre?.stringValue || '',
    email: t.fields?.email?.stringValue || ''
  }));

  const teachersWithUser = new Set(users.map(u => u.fields?.teacherId?.stringValue).filter(Boolean));
  const teachersWithoutUser = tList.filter(t => !teachersWithUser.has(t.id));

  console.log(`\n  Docentes en colección: ${tList.length}`);
  console.log(`  Docentes con cuenta de usuario: ${teachersWithUser.size}`);
  console.log(`  Docentes SIN cuenta de usuario: ${teachersWithoutUser.length} ⚠`);

  // Identificar orientadores sin cuenta
  const orientadoresIds = new Set();
  groups.forEach(g => {
    const oid = g.fields?.orientadorId?.stringValue;
    if (oid) orientadoresIds.add(oid);
  });
  const orientadoresWithoutUser = [...orientadoresIds].filter(id => !teachersWithUser.has(id));

  console.log(`\n  Orientadores activos: ${orientadoresIds.size}`);
  console.log(`  Orientadores SIN cuenta de usuario: ${orientadoresWithoutUser.length} ⚠`);
  if (orientadoresWithoutUser.length > 0) {
    orientadoresWithoutUser.forEach(id => {
      const t = tList.find(x => x.id === id);
      console.log(`    • ${t?.nombre || id}`);
    });
  }

  // Identificar maestros (con assignments) sin cuenta
  const teachersWithAsg = new Set(assignments.map(a => a.fields?.teacherId?.stringValue).filter(Boolean));
  const maestrosWithoutUser = [...teachersWithAsg].filter(id => !teachersWithUser.has(id));
  console.log(`\n  Docentes con asignaciones: ${teachersWithAsg.size}`);
  console.log(`  Docentes con asignaciones SIN cuenta: ${maestrosWithoutUser.length} ⚠`);

  // Personal directivo (config/school.staff)
  console.log('\n  Personal directivo (config/school):');
  const staff = schoolStaff.fields?.staff?.mapValue?.fields || {};
  ['director', 'subdirector', 'secretario'].forEach(role => {
    const persona = staff[role]?.mapValue?.fields;
    const nombre = persona?.nombre?.stringValue || '(no definido)';
    const cargo = persona?.cargo?.stringValue || '';
    const tieneUser = users.some(u => norm(u.fields?.displayName?.stringValue || '') === norm(nombre));
    console.log(`    ${role.padEnd(15)}: ${nombre.padEnd(45)} ${cargo.padEnd(30)} ${tieneUser ? '✅ con cuenta' : '⚠ sin cuenta'}`);
  });

  // ─── FASE 3: INTEGRIDAD DE DATOS ───
  console.log('\n\n═══ FASE 3: INTEGRIDAD DE DATOS ═══');

  // Grupos sin orientador
  const groupsNoOrient = groups.filter(g => !g.fields?.orientadorId?.stringValue);
  console.log(`\n  Grupos sin orientadorId: ${groupsNoOrient.length} ${groupsNoOrient.length > 0 ? '⚠' : '✅'}`);
  groupsNoOrient.forEach(g => {
    const id = g.name.split('/').pop();
    const nombre = g.fields?.nombre?.stringValue || id;
    const turno = g.fields?.turno?.stringValue || '';
    console.log(`    • ${nombre} (${turno})`);
  });

  // Assignments sin teacherId válido
  const teacherIds = new Set(tList.map(t => t.id));
  const orphanAsg = assignments.filter(a => {
    const tid = a.fields?.teacherId?.stringValue;
    return tid && !teacherIds.has(tid);
  });
  console.log(`\n  Asignaciones con teacherId huérfano: ${orphanAsg.length} ${orphanAsg.length > 0 ? '⚠' : '✅'}`);

  // Asignaciones marcadas como cobertura
  const interimAsg = assignments.filter(a => a.fields?.interim?.booleanValue);
  console.log(`\n  Asignaciones de cobertura activas: ${interimAsg.length}`);
  if (interimAsg.length > 0) {
    interimAsg.forEach(a => {
      const f = a.fields;
      console.log(`    🟠 ${f?.subjectName?.stringValue} → ${f?.groupName?.stringValue} (${f?.turno?.stringValue})`);
    });
  }

  // Teachers con email vs sin
  const teachersConEmail = tList.filter(t => t.email);
  console.log(`\n  Docentes con email registrado: ${teachersConEmail.length}/${tList.length}`);
  console.log(`  Docentes SIN email: ${tList.length - teachersConEmail.length} ⚠ (no podrán recuperar contraseña vía Firebase)`);

  // ─── FASE 4: COBERTURA POR ROL ESPERADO ───
  console.log('\n\n═══ FASE 4: ROLES ESPERADOS VS REALES ═══');

  // Para cada teacher, calcular qué rol DEBERÍA tener
  const expectedRoles = tList.map(t => {
    const esOrientador = orientadoresIds.has(t.id);
    const tieneAsignaciones = teachersWithAsg.has(t.id);
    let expected;
    if (esOrientador && tieneAsignaciones) expected = 'orientador_docente';
    else if (esOrientador) expected = 'orientador';
    else if (tieneAsignaciones) expected = 'maestro';
    else expected = 'sin asignación';
    return { ...t, expected };
  });

  const counts = { admin: 0, orientador: 0, orientador_docente: 0, maestro: 0, 'sin asignación': 0 };
  expectedRoles.forEach(t => counts[t.expected] = (counts[t.expected] || 0) + 1);
  console.log('\n  Por rol esperado:');
  Object.entries(counts).forEach(([r, c]) => console.log(`    ${r.padEnd(25)}: ${c}`));

  // ─── FASE 5: RESUMEN ───
  console.log('\n\n═══ FASE 5: RESUMEN EJECUTIVO ═══\n');
  const totalEsperadas = orientadoresIds.size + teachersWithAsg.size; // overlap se cuenta una vez en el set
  const totalReales = users.length;
  const coverage = totalReales / Math.max(orientadoresIds.size, teachersWithAsg.size, 1);

  console.log(`  Cuentas de usuario: ${totalReales}`);
  console.log(`  Docentes que necesitan cuenta: ${tList.length}`);
  console.log(`  Cobertura actual: ${(totalReales * 100 / tList.length).toFixed(1)}%`);
  console.log(`  Pendientes de crear cuenta: ${tList.length - teachersWithUser.size}\n`);

  console.log('  PRIORIDADES:');
  if (orientadoresWithoutUser.length > 0) console.log(`  1. Crear cuentas para ${orientadoresWithoutUser.length} orientadores faltantes`);
  if (groupsNoOrient.length > 0) console.log(`  2. Asignar orientadorId a ${groupsNoOrient.length} grupos`);
  if (tList.length - teachersConEmail.length > 0) console.log(`  3. Asignar email sintético a ${tList.length - teachersConEmail.length} docentes sin email`);
  console.log(`  4. Implementar pantalla "primer ingreso" + correo recuperación obligatorio`);
  console.log(`  5. Generar cuentas masivas con CSV de credenciales`);

  console.log('\n═══════════════════════════════════════════════════════════');
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
