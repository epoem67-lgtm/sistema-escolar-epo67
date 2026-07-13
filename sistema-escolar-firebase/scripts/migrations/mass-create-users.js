/**
 * MASS CREATE USERS — EPO 67
 *
 * Crea cuentas Firebase Auth + user docs para TODOS los docentes faltantes.
 * Asigna email sintético a quien no tenga, asigna rol automático,
 * marca mustChangePassword=true para forzar primer ingreso.
 *
 * Reglas especiales:
 *   - Personal directivo (Karina, Octavio, Roberto): rol admin con email sintético
 *   - Olivia: actualizar email a oliepo67@gmail.com
 *   - Rosalva Valdés: rol consulta
 *   - Hibridos detectados: orientador_docente
 *   - Resto con assignments: maestro
 *   - Resto sin assignments: maestro (pero deshabilitado si status=baja)
 *   - 2 cuentas admin genéricas duplicadas → consolidar
 *
 * Output:
 *   - credenciales-iniciales-<fecha>.csv
 *   - migration-report.json
 *
 * Uso:
 *   node mass-create-users.js              -> DRY RUN
 *   node mass-create-users.js --apply      -> Ejecuta cambios
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
const TOKEN = config.tokens.access_token;

const APPLY = process.argv.includes('--apply');

// ═══ Configuración por nombre ═══
const STAFF_ADMIN = [
  { match: 'KARINA', emailLocal: 'karina.directora', displayOverride: 'KARINA ILUSION LAGUERENNE CHIQUETE' },
  { match: 'OCTAVIO', emailLocal: 'octavio.subdirector', displayOverride: 'OCTAVIO VAZQUEZ BARRETO' },
  { match: 'ROBERTO PALOMARES', emailLocal: 'roberto.secretario', displayOverride: 'ROBERTO PALOMARES MEJIA' },
  { match: 'OLIVIA', email: 'oliepo67@gmail.com', displayOverride: 'OLIVIA PEÑA RAMIREZ' }
];
const CONSULTA_USERS = [{ match: 'VALDES ESCALONA ROSALVA', emailLocal: 'rosalva.consulta' }];

// Caracteres seguros (sin O/0, l/1, I)
const PWD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function genPwd(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PWD_CHARS[bytes[i] % PWD_CHARS.length];
  return out;
}

// ═══ HTTP helpers ═══
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function fetchPage(coll, pt) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
  if (pt) url += '&pageToken=' + pt;
  return request('GET', url);
}
async function getAll(coll) { const a = []; let p = null; do { const r = await fetchPage(coll, p); if (r.documents) a.push(...r.documents); p = r.nextPageToken; } while (p); return a; }
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach(k => fields[k] = fsValue(v[k]));
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
async function patchDoc(coll, id, fields) {
  const mask = Object.keys(fields).map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}?${mask}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('PATCH', url, body);
}
async function setDoc(coll, id, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('PATCH', url, body);
}
async function deleteDoc(coll, id) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
  return request('DELETE', url);
}
async function postAuditLog(fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/activityLog`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return request('POST', url, body);
}

// Identity Toolkit (Auth) endpoints
async function authLookup(email) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`;
  const r = await request('POST', url, { email: [email] });
  return r.users?.[0] || null;
}
async function authCreate(email, password, displayName) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts`;
  const r = await request('POST', url, { email, password, displayName, emailVerified: false });
  return r.localId;
}
async function authUpdate(uid, fields) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`;
  return request('POST', url, { localId: uid, ...fields });
}
async function authDelete(uid) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`;
  return request('POST', url, { localId: uid });
}

// Helpers nombres
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
// Eliminar TÍTULOS y abreviaciones (MA. con punto = abreviación de MARIA).
// IMPORTANTE: \bMA\b solo sin punto sería ambiguo con palabras como MARTINEZ;
// solo eliminamos cuando va seguido de punto (ej "MA. GUADALUPE").
const stripT = s => norm(s).replace(/\bPROFRA?\.|\bMTRA?\.|\bDR[A]?\.|\bLIC\.|\bMA\./g, '').trim();
function localFromName(nombre) {
  const words = stripT(nombre).split(/\s+/).filter(w => w.length > 2);
  if (words.length < 2) return null;
  const apellido = words[0].toLowerCase();
  const nombre1 = words[words.length - 1].toLowerCase();
  return `${apellido}.${nombre1}`;
}

// ═══ Main ═══
(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  MASS CREATE USERS — EPO 67');
  console.log('  Modo:', APPLY ? '🔴 APPLY' : '🟢 DRY RUN');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📥 Cargando datos...');
  const [teachers, assignments, groups, users] = await Promise.all([
    getAll('teachers'), getAll('assignments'), getAll('groups'), getAll('users')
  ]);
  console.log(`   teachers: ${teachers.length}, assignments: ${assignments.length}, groups: ${groups.length}, users: ${users.length}\n`);

  const teacherIdsWithUser = new Set(users.map(u => u.fields?.teacherId?.stringValue).filter(Boolean));
  const teachersWithAsg = new Set(assignments.map(a => a.fields?.teacherId?.stringValue).filter(Boolean));
  const orientadoresIds = new Set();
  groups.forEach(g => { const oid = g.fields?.orientadorId?.stringValue; if (oid) orientadoresIds.add(oid); });

  // 0. CONSOLIDAR cuentas admin duplicadas
  console.log('═══ FASE 0: CONSOLIDAR CUENTAS ADMIN DUPLICADAS ═══');
  const adminDups = users.filter(u => (u.fields?.email?.stringValue || '').toLowerCase() === 'administrador@epo67sistema.com');
  if (adminDups.length > 1) {
    console.log(`  Duplicadas: ${adminDups.length}`);
    // Mantener la PRIMERA (la más antigua si tiene createdAt). Eliminar las otras.
    adminDups.sort((a, b) => {
      const aT = a.fields?.createdAt?.timestampValue || '';
      const bT = b.fields?.createdAt?.timestampValue || '';
      return aT.localeCompare(bT);
    });
    const keep = adminDups[0];
    const remove = adminDups.slice(1);
    console.log(`  Mantener: ${keep.name.split('/').pop()}`);
    remove.forEach(r => console.log(`  Eliminar: ${r.name.split('/').pop()}`));
    if (APPLY) {
      for (const r of remove) {
        const uid = r.name.split('/').pop();
        try {
          await authDelete(uid).catch(() => {});
          await deleteDoc('users', uid);
          console.log(`    ✔ Eliminado ${uid}`);
        } catch (e) { console.log(`    ✗ Error: ${e.message}`); }
      }
    }
  } else {
    console.log('  No hay duplicados.');
  }

  // ═══ FASE 1: ASIGNAR EMAILS SINTÉTICOS A TEACHERS SIN EMAIL ═══
  console.log('\n═══ FASE 1: ASIGNAR EMAILS SINTÉTICOS ═══');
  const tList = teachers.map(t => ({
    id: t.name.split('/').pop(),
    nombre: t.fields?.nombre?.stringValue || '',
    email: t.fields?.email?.stringValue || '',
    estatus: t.fields?.estatus?.stringValue || ''
  }));
  const sinEmail = tList.filter(t => !t.email && t.nombre);
  console.log(`  Docentes sin email: ${sinEmail.length}`);
  for (const t of sinEmail) {
    const local = localFromName(t.nombre);
    if (!local) { console.log(`  ⚠ ${t.nombre}: no se pudo derivar email`); continue; }
    let email = `${local}@epo67.local`;
    // Si choca con otro, agrega segundo apellido
    const conflict = tList.find(other => other.id !== t.id && other.email === email);
    if (conflict) {
      const words = stripT(t.nombre).split(/\s+/).filter(w => w.length > 2);
      if (words.length >= 3) email = `${words[0].toLowerCase()}.${words[1].toLowerCase()}.${words[words.length - 1].toLowerCase()}@epo67.local`;
    }
    console.log(`    ${t.nombre.padEnd(45)} → ${email}`);
    if (APPLY) {
      try {
        await patchDoc('teachers', t.id, { email });
        t.email = email;
      } catch (e) { console.log(`    ✗ Error: ${e.message}`); }
    } else {
      t.email = email; // simular
    }
  }

  // ═══ FASE 2: CREAR CUENTAS PARA TEACHERS FALTANTES ═══
  console.log('\n═══ FASE 2: CREAR CUENTAS PARA DOCENTES ═══');
  const credentials = []; // para CSV
  const skipped = [];

  for (const t of tList) {
    if (!t.email) { skipped.push({ ...t, reason: 'sin email' }); continue; }
    if (teacherIdsWithUser.has(t.id)) {
      // Ya tiene cuenta — verificamos si necesita ajustes especiales
      const existing = users.find(u => u.fields?.teacherId?.stringValue === t.id);
      const exMatch = STAFF_ADMIN.find(s => norm(t.nombre).includes(norm(s.match)));
      if (exMatch && exMatch.email && existing.fields?.email?.stringValue !== exMatch.email) {
        // Caso Olivia: actualizar email
        console.log(`  🔄 ${t.nombre}: cambiar email a ${exMatch.email}`);
        if (APPLY) {
          const uid = existing.name.split('/').pop();
          try {
            await authUpdate(uid, { email: exMatch.email });
            await patchDoc('users', uid, { email: exMatch.email });
          } catch (e) { console.log(`    ✗ ${e.message}`); }
        }
      }
      continue;
    }

    // Determinar rol
    let role = 'maestro';
    let emailToUse = t.email;
    let displayName = t.nombre;

    const adminMatch = STAFF_ADMIN.find(s => norm(t.nombre).includes(norm(s.match)));
    const consultaMatch = CONSULTA_USERS.find(s => norm(t.nombre).includes(norm(s.match)));

    if (adminMatch) {
      role = 'admin';
      if (adminMatch.email) emailToUse = adminMatch.email;
      else if (adminMatch.emailLocal) emailToUse = `${adminMatch.emailLocal}@epo67.local`;
      if (adminMatch.displayOverride) displayName = adminMatch.displayOverride;
    } else if (consultaMatch) {
      role = 'consulta';
      if (consultaMatch.emailLocal) emailToUse = `${consultaMatch.emailLocal}@epo67.local`;
    } else {
      const esOrient = orientadoresIds.has(t.id);
      const tieneAsg = teachersWithAsg.has(t.id);
      if (esOrient && tieneAsg) role = 'orientador_docente';
      else if (esOrient) role = 'orientador';
      else if (tieneAsg) role = 'maestro';
      else { skipped.push({ ...t, reason: 'sin asignaciones ni orientación' }); continue; }
    }

    const password = genPwd(12);
    console.log(`  + ${t.nombre.padEnd(45)} ${emailToUse.padEnd(45)} [${role}]`);

    if (APPLY) {
      try {
        const existingAuth = await authLookup(emailToUse).catch(() => null);
        let uid;
        if (existingAuth) {
          uid = existingAuth.localId;
          await authUpdate(uid, { password });
        } else {
          uid = await authCreate(emailToUse, password, displayName);
        }
        await setDoc('users', uid, {
          email: emailToUse,
          displayName,
          role,
          teacherId: t.id,
          status: 'active',
          mustChangePassword: true,
          createdAt: new Date(),
          autoCreated: true
        });
        await postAuditLog({
          type: 'user.created',
          description: `Cuenta creada: ${displayName} (${emailToUse}) rol ${role}`,
          metadata: { uid, teacherId: t.id, email: emailToUse, role, source: 'mass-create-users-script' },
          timestamp: new Date(),
          userId: 'system',
          userName: 'Sistema (mass-create)'
        });
        credentials.push({ uid, nombre: displayName, email: emailToUse, password, role, teacherId: t.id });
      } catch (e) {
        console.log(`    ✗ Error: ${e.message}`);
      }
    } else {
      credentials.push({ uid: '(dry-run)', nombre: displayName, email: emailToUse, password, role, teacherId: t.id });
    }
  }

  // ═══ FASE 2.5: CUENTAS DIRECTIVAS NO LIGADAS A TEACHERS ═══
  // Karina, Octavio, Roberto solo están en config/school.staff, no en teachers.
  // Les creamos cuentas admin directas (sin teacherId).
  console.log('\n═══ FASE 2.5: CUENTAS DIRECTIVAS (Karina, Octavio, Roberto) ═══');
  const directivos = [
    { name: 'KARINA ILUSION LAGUERENNE CHIQUETE', email: 'karina.directora@epo67.local', role: 'admin', cargo: 'Directora Escolar' },
    { name: 'OCTAVIO VAZQUEZ BARRETO', email: 'octavio.subdirector@epo67.local', role: 'admin', cargo: 'Subdirector' },
    { name: 'ROBERTO PALOMARES MEJIA', email: 'roberto.secretario@epo67.local', role: 'admin', cargo: 'Secretario Escolar' }
  ];
  for (const d of directivos) {
    // ¿Ya existe cuenta con ese email?
    const existing = users.find(u => (u.fields?.email?.stringValue || '').toLowerCase() === d.email.toLowerCase());
    if (existing) {
      console.log(`  ℹ ${d.name}: ya tiene cuenta`);
      continue;
    }
    const password = genPwd(12);
    console.log(`  + ${d.name.padEnd(45)} ${d.email.padEnd(40)} [${d.role}] (${d.cargo})`);
    if (APPLY) {
      try {
        const existingAuth = await authLookup(d.email).catch(() => null);
        let uid;
        if (existingAuth) {
          uid = existingAuth.localId;
          await authUpdate(uid, { password });
        } else {
          uid = await authCreate(d.email, password, d.name);
        }
        await setDoc('users', uid, {
          email: d.email,
          displayName: d.name,
          role: d.role,
          status: 'active',
          mustChangePassword: true,
          createdAt: new Date(),
          autoCreated: true,
          cargo: d.cargo
        });
        await postAuditLog({
          type: 'user.created',
          description: `Cuenta directiva creada: ${d.name} (${d.email}) ${d.cargo}`,
          metadata: { uid, email: d.email, role: d.role, cargo: d.cargo, source: 'mass-create-users-script' },
          timestamp: new Date(),
          userId: 'system',
          userName: 'Sistema (mass-create)'
        });
        credentials.push({ uid, nombre: d.name, email: d.email, password, role: d.role, teacherId: '' });
      } catch (e) { console.log(`    ✗ Error: ${e.message}`); }
    } else {
      credentials.push({ uid: '(dry-run)', nombre: d.name, email: d.email, password, role: d.role, teacherId: '' });
    }
  }

  // ═══ FASE 3: GUARDAR CSV ═══
  console.log(`\n═══ FASE 3: CREDENCIALES (${credentials.length}) ═══`);
  const stamp = new Date().toISOString().split('T')[0];
  const csvPath = path.join(__dirname, '..', '..', `credenciales-iniciales-${stamp}.csv`);
  const csvHeader = 'Nombre,Email,Password Temporal,Rol,TeacherId,UID\n';
  const csvLines = credentials.map(c =>
    `"${c.nombre}","${c.email}","${c.password}","${c.role}","${c.teacherId}","${c.uid}"`
  );
  const csv = csvHeader + csvLines.join('\n');
  if (APPLY || !APPLY) {
    fs.writeFileSync(csvPath, csv, 'utf8');
    console.log(`  💾 CSV guardado en: ${csvPath}`);
  }

  // Skipped
  if (skipped.length > 0) {
    console.log(`\n  Omitidos (${skipped.length}):`);
    skipped.forEach(s => console.log(`    • ${s.nombre} (${s.reason})`));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  ${APPLY ? '✅ APLICADO' : '🟢 DRY RUN'} · Cuentas procesadas: ${credentials.length}`);
  console.log(`  CSV: ${csvPath}`);
  if (!APPLY) console.log('  Para aplicar: --apply');
  console.log('═══════════════════════════════════════════════════════════');
})().catch(err => { console.error('FATAL:', err); process.exit(1); });
