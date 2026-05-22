/**
 * CREATE TEACHER USERS — Genera cuentas Firebase Auth + docs `users/{uid}` para
 * todos los docentes activos.
 *
 * Para cada teacher con status='active' (o sin status) y email no vacío:
 *   1. Lookup en Firebase Auth por email — si ya existe, reutiliza el uid.
 *   2. Si no existe, crea cuenta con password temporal aleatorio (16 chars).
 *   3. Verifica/crea/actualiza users/{uid} con role='maestro' y teacherId.
 *
 * Idempotente: re-ejecutarlo no duplica ni sobre-escribe docentes ya enlazados.
 * No baja el rol de admins/orientadores/directivos existentes; los reporta y omite.
 *
 * Salida (siempre en sistema-escolar-firebase/):
 *   - migration-report-teacher-users.json    — resumen estructurado
 *   - credenciales-docentes-YYYY-MM-DD.csv   — solo en modo live, solo cuentas nuevas
 *
 * Prerequisitos:
 *   1. Token OAuth válido de firebase-tools en /tmp/firebase-access-token.txt.
 *      Si no existe, refrescar con:
 *        npx firebase-tools login:ci      (en máquina interactiva)
 *      o seguir el flujo de refresh_token explicado en migrate-from-drive.js.
 *
 * Uso:
 *   node scripts/migrations/create-teacher-users.js --dry-run
 *   node scripts/migrations/create-teacher-users.js
 *   node scripts/migrations/create-teacher-users.js --only=<teacherId>
 */

const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

// ─── CONFIG ───
const PROJECT_ID = 'epo67-sistema';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_FILTER = (() => {
  const arg = process.argv.find(a => a.startsWith('--only='));
  return arg ? arg.split('=')[1] : null;
})();
const REPORT_FILE = 'migration-report-teacher-users.json';
const CSV_FILE = `credenciales-docentes-${new Date().toISOString().slice(0, 10)}.csv`;
const PASSWORD_LENGTH = 16;
const DELAY_BETWEEN_OPS_MS = 250;

// Lista oficial de orientadores (espejo de teachers.js:185-194 — actualizar ambos juntos).
// En EPO 67, varias orientadoras también dan clase, así que reciben el rol
// híbrido 'orientador_docente' (puede capturar calificaciones Y gestionar orientación).
const ORIENTADOR_NAMES = [
  'DIAZ CAMARENA SANDRA',
  'MORLAN ORTIZ NEFTALI MARGARITA',
  'SALAZAR ZUNIGA JOSE EDGAR',
  'CEDILLO POLO IVONNE GABRIELA',
  'GARCIA GONZALEZ BEATRIZ ALEJANDRA',
  'MARTINEZ PEREZ LAURITA',
  'RODRIGUEZ VIVAS FERNANDA CITLALLI',
];

// Lista de orientadoras PURAS — aunque tengan asignaciones de clase, NO se les
// da el rol híbrido 'orientador_docente'. Reciben SOLO 'orientador'. Decisión
// administrativa: estas docentes ya no capturan calificaciones, sólo gestionan
// orientación (no ven el tablero ni los menús de captura de calificaciones).
const ORIENTADOR_PURO_NAMES = [
  'RANGEL PALACIOS JUANA',
  'CORREA SALGADO ANA ISABEL',
];

// Lista de personal con acceso de solo lectura (rol 'consulta' en Firestore).
// Aparecen en la colección teachers para fines de carga masiva, pero su rol final
// no es de docente.
const CONSULTA_NAMES = [
  'VALDES ESCALONA ROSALVA',
];

// Lista de docentes que SÍ están en la colección `teachers` pero deben tener
// rol 'admin' (acceso total al sistema). PRECEDENCIA MÁXIMA: si un nombre
// coincide con esta lista, se asigna 'admin' aunque también esté en ORIENTADOR_NAMES
// o tenga clases asignadas. teacherId se enlaza para que la UI le muestre sus
// clases ("admin + funciones de maestra").
//
// El personal directivo puro (directora, subdirector, secretario, secretaria
// administrativa) NO va aquí — vive en config/school.staff y el script lo
// procesa por separado.
const ADMIN_NAMES = [
  'PEÑA RAMIREZ OLIVIA',                  // Admin principal del sistema (también docente)
];

function normalizeName(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

const ORIENTADOR_NAMES_NORM = ORIENTADOR_NAMES.map(normalizeName);
const ORIENTADOR_PURO_NAMES_NORM = ORIENTADOR_PURO_NAMES.map(normalizeName);
const CONSULTA_NAMES_NORM = CONSULTA_NAMES.map(normalizeName);
const ADMIN_NAMES_NORM = ADMIN_NAMES.map(normalizeName);

// Match orden-independiente entre dos nombres: TRUE si las palabras significativas
// (>=4 chars) del más corto están todas en el más largo. Soporta "PROFRA. LAURITA
// MARTINEZ" vs "MARTINEZ PEREZ LAURITA" (palabras compartidas: LAURITA, MARTINEZ).
function _namesMatch(a, b) {
  const wa = normalizeName(a).split(/\s+/).filter(w => w.length >= 4);
  const wb = normalizeName(b).split(/\s+/).filter(w => w.length >= 4);
  if (wa.length < 2 || wb.length < 2) return false;
  const setA = new Set(wa), setB = new Set(wb);
  return wa.every(w => setB.has(w)) || wb.every(w => setA.has(w));
}

/**
 * Determina el rol del sistema en base al nombre + datos cruzados:
 *  - 'admin'              — está en ADMIN_NAMES (precedencia máxima)
 *  - 'consulta'           — está en CONSULTA_NAMES (personal administrativo solo lectura)
 *  - 'orientador'         — está en ORIENTADOR_PURO_NAMES (aunque tenga clases)
 *  - 'orientador_docente' — es orientador (lista o groups) Y tiene clases asignadas
 *  - 'orientador'         — orientador pero SIN clases
 *  - 'maestro'            — todos los demás
 */
function roleForTeacher(teacher, hasAssignments, isOrientadorInGroups) {
  const n = normalizeName(teacher.nombre);
  if (!n) return 'maestro';
  if (ADMIN_NAMES_NORM.some(an => n.includes(an) || an.includes(n))) return 'admin';
  if (CONSULTA_NAMES_NORM.some(on => n.includes(on) || on.includes(n))) return 'consulta';
  // PRECEDE a la lista normal: orientadora pura (no recibe el rol híbrido aunque
  // tenga asignaciones — decisión administrativa).
  if (ORIENTADOR_PURO_NAMES_NORM.some(on => n.includes(on) || on.includes(n))) return 'orientador';
  const enListaOrient = ORIENTADOR_NAMES_NORM.some(on => n.includes(on) || on.includes(n));
  const esOrientador = enListaOrient || isOrientadorInGroups;
  if (esOrientador && hasAssignments) return 'orientador_docente';
  if (esOrientador) return 'orientador';
  return 'maestro';
}

// ─── ACCESS TOKEN ───
function getAccessToken() {
  try {
    const t = fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
    if (t) return t;
  } catch (e) { /* no token file */ }
  console.error('No hay token OAuth en /tmp/firebase-access-token.txt');
  console.error('Refrescar con uno de:');
  console.error('  1) npx firebase-tools login:ci    (login interactivo)');
  console.error('  2) Flujo refresh_token (ver migrate-from-drive.js)');
  process.exit(1);
}
const token = getAccessToken();

// ─── HTTP HELPER ───
function httpRequest(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (parsed.error) {
            const err = new Error(`${parsed.error.code || res.statusCode}: ${parsed.error.message}`);
            err.status = parsed.error.status;
            return reject(err);
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── FIRESTORE REST ───
function firestoreReq(method, path, body) {
  return httpRequest(
    method,
    'firestore.googleapis.com',
    `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    body
  );
}

async function fetchAllDocs(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const path = `${collection}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const result = await firestoreReq('GET', path);
    if (result.documents) {
      for (const doc of result.documents) {
        const id = doc.name.split('/').pop();
        const fields = parseFirestoreFields(doc.fields || {});
        docs.push({ id, ...fields });
      }
    }
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function parseFirestoreFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) out[key] = val.stringValue;
    else if (val.integerValue !== undefined) out[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) out[key] = val.doubleValue;
    else if (val.booleanValue !== undefined) out[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) out[key] = val.timestampValue;
    else if (val.nullValue !== undefined) out[key] = null;
    else out[key] = null;
  }
  return out;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

// ─── IDENTITY TOOLKIT (Firebase Auth admin) ───
async function authLookupByEmail(email) {
  const result = await httpRequest(
    'POST',
    'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT_ID}/accounts:lookup`,
    { email: [email] }
  );
  const users = result.users || [];
  return users[0] || null;
}

async function authCreateUser(email, password, displayName) {
  const result = await httpRequest(
    'POST',
    'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT_ID}/accounts`,
    { email, password, displayName, emailVerified: false }
  );
  if (!result.localId) throw new Error('signUp no devolvió localId');
  return result.localId;
}

// ─── HELPERS ───
function generatePassword(len = PASSWORD_LENGTH) {
  // Sin caracteres ambiguos (0, O, 1, l, I) ni símbolos que rompan CSV.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let pwd = '';
  for (let i = 0; i < len; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function looksLikeFirebaseUid(id) {
  // UIDs de Firebase Auth: ~28 chars alfanuméricos. Email-based IDs son más cortos
  // y suelen ser solo letras minúsculas + dígitos.
  return /^[A-Za-z0-9]{20,40}$/.test(id);
}

function csvEscape(s) {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── MAIN ───
async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  CREAR USUARIOS PARA DOCENTES (Auth + Firestore)');
  console.log(`  Modo: ${DRY_RUN ? '🧪 DRY RUN (no se escribe nada)' : '🔥 LIVE WRITE'}`);
  if (ONLY_FILTER) console.log(`  Filtro: solo teacherId=${ONLY_FILTER}`);
  console.log('═══════════════════════════════════════════════\n');

  console.log('📥 Descargando datos de Firestore...');
  const [allTeachers, allUsers, allAssignments, allGroups, schoolConfig] = await Promise.all([
    fetchAllDocs('teachers'),
    fetchAllDocs('users'),
    fetchAllDocs('assignments'),
    fetchAllDocs('groups'),
    firestoreReq('GET', 'config/school').catch(() => null),
  ]);
  console.log(`   teachers:    ${allTeachers.length}`);
  console.log(`   users:       ${allUsers.length}`);
  console.log(`   assignments: ${allAssignments.length}`);
  console.log(`   groups:      ${allGroups.length}`);

  // Personal directivo cargado en config/school.staff. Cada uno se procesa
  // como si fuera un "docente" sintético con teacherId=null. El rol del sistema
  // se determina por el campo `role` del staff entry; default 'admin'.
  // Convención:
  //   - 'admin'     → director, subdirector, secretario escolar (acceso total,
  //                    pueden capturar y corregir calificaciones)
  //   - 'directivo' → secretaria administrativa (lectura completa + reportes;
  //                    NO puede capturar ni cambiar calificaciones)
  //   - 'consulta'  → solo lectura general
  // SOLO estos 6 roles existen en firestore.rules. CUALQUIER otro valor causa
  // que isAdmin()/isDirectivo() devuelvan false y bloqueen todas las operaciones.
  const VALID_ROLES = new Set(['admin', 'maestro', 'orientador', 'orientador_docente', 'directivo', 'consulta']);

  const staffEntries = [];
  const staffMap = schoolConfig?.fields?.staff?.mapValue?.fields || {};
  for (const [roleKey, mapVal] of Object.entries(staffMap)) {
    const f = mapVal?.mapValue?.fields || {};
    const titulo = f.titulo?.stringValue || '';
    const nombre = f.nombre?.stringValue || '';
    const cargo  = f.cargo?.stringValue  || '';
    const email  = f.email?.stringValue  || '';
    let role     = f.role?.stringValue   || 'admin';
    // BLINDAJE: si el role del config no es uno de los 6 válidos, normalizar.
    // Caso histórico: roleKey 'subdirector'/'secretario_escolar'/'secretario_admin'
    // se usaron como `role` por error y bloquean las firestore.rules.
    if (!VALID_ROLES.has(role)) {
      console.warn(`⚠️  rol inválido "${role}" para staff ${roleKey} → forzando 'admin' (excepto secretaria_admin → 'directivo')`);
      role = (roleKey === 'secretaria_admin' || roleKey === 'secretario_admin') ? 'directivo' : 'admin';
    }
    if (!nombre) continue;
    staffEntries.push({
      id: `staff-${roleKey}`,
      _staffRole: roleKey,
      _desiredRole: role,
      nombre: titulo ? `${titulo} ${nombre}` : nombre,
      _nombreSinTitulo: nombre,
      especialidad: cargo,
      email,
      status: 'active',
      _isStaff: true,
    });
  }
  if (staffEntries.length > 0) {
    console.log(`   staff (config): ${staffEntries.length}`);
  }

  // Cruces para detectar híbridos:
  //  - hasAssignmentsByTeacherId: ¿el docente tiene clases asignadas?
  //  - isOrientadorInGroupsByTeacher: ¿algún grupo lo nombra como orientador?
  const hasAssignmentsByTeacherId = new Set();
  for (const a of allAssignments) if (a.teacherId) hasAssignmentsByTeacherId.add(a.teacherId);

  const orientadoresEnGroups = []; // [nombre limpio del grupo.orientador]
  for (const g of allGroups) {
    if (!g.orientador) continue;
    orientadoresEnGroups.push(g.orientador.replace(/^PROFR[A]?\.\s+/i, '').trim());
  }
  const isOrientadorInGroups = (teacher) =>
    orientadoresEnGroups.some(name => _namesMatch(teacher.nombre, name));

  let teachers = allTeachers.filter(t => !t.status || t.status === 'active');
  // Concatenar staff (directivos): se procesan con la misma lógica que los
  // docentes pero sin teacherId y con rol forzado a 'admin'.
  teachers = teachers.concat(staffEntries);
  if (ONLY_FILTER) teachers = teachers.filter(t => t.id === ONLY_FILTER);
  console.log(`\n🎯 Personas en alcance: ${teachers.length} (incluye staff directivo)\n`);

  if (teachers.length === 0) {
    console.log('No hay personas que procesar. Salida.');
    return;
  }

  // Indexar users existentes
  const usersByTeacherId = {};
  const usersByUid = {};
  const orphanEmailDocs = [];
  for (const u of allUsers) {
    usersByUid[u.id] = u;
    if (u.teacherId) usersByTeacherId[u.teacherId] = u;
    if (!looksLikeFirebaseUid(u.id)) {
      orphanEmailDocs.push({ docId: u.id, email: u.email || null, role: u.role || null });
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    only_filter: ONLY_FILTER,
    totals: {
      teachers_total: allTeachers.length,
      teachers_in_scope: teachers.length,
      created: 0,
      updated: 0,
      skipped_no_email: 0,
      skipped_already_ok: 0,
      skipped_other_role: 0,
      errors: 0,
    },
    skipped_no_email: [],
    skipped_already_ok: [],
    skipped_other_role: [],
    created: [],
    updated: [],
    errors: [],
    orphan_email_docs: orphanEmailDocs,
  };
  const credentials = [];

  for (const t of teachers) {
    const label = `${t.id} ${t.nombre || '(sin nombre)'}`;

    // 1) Email obligatorio
    if (!isValidEmail(t.email)) {
      report.totals.skipped_no_email++;
      report.skipped_no_email.push({
        teacherId: t.id, nombre: t.nombre || null, email: t.email || null,
      });
      console.log(`⏭️  ${label} — sin email`);
      continue;
    }
    const email = t.email.trim().toLowerCase();

    // Staff directivo (config/school.staff) → usa el rol declarado en el staff
    // entry (default 'admin'; Lupita la secretaria administrativa será 'directivo').
    // Docente con nombre en ADMIN_NAMES → 'admin' (caso Olivia Peña).
    // Resto → lógica habitual (orientador_docente / orientador / consulta / maestro).
    const desiredRole = t._isStaff
      ? (t._desiredRole || 'admin')
      : roleForTeacher(t, hasAssignmentsByTeacherId.has(t.id), isOrientadorInGroups(t));

    // 2) ¿Ya hay un user con teacherId == este docente?
    const linked = usersByTeacherId[t.id];
    if (linked) {
      if (linked.role === desiredRole) {
        report.totals.skipped_already_ok++;
        report.skipped_already_ok.push({
          teacherId: t.id, nombre: t.nombre || null, uid: linked.id, role: linked.role,
        });
        console.log(`✅ ${label} — ya enlazado (${linked.role}, uid=${linked.id})`);
        continue;
      }
      // Rol distinto al deseado: admin/directivo/orientador puro NO se modifican
      // (fueron asignados manualmente por algún criterio). Solo se actualiza si
      // está en 'consulta' (bootstrap) o en uno de los roles que esta script gestiona.
      if (linked.role === 'admin' || linked.role === 'directivo' || linked.role === 'orientador') {
        report.totals.skipped_other_role++;
        report.skipped_other_role.push({
          teacherId: t.id, nombre: t.nombre || null, uid: linked.id,
          role: linked.role || null,
          note: 'usuario tiene rol de gestión; no se modifica',
        });
        console.log(`⚠️  ${label} — user existente con rol '${linked.role}' (no se modifica)`);
        continue;
      }
      // Actualizar rol existente al correcto (maestro<->orientador, o desde consulta)
      if (DRY_RUN) {
        report.totals.updated++;
        report.updated.push({
          teacherId: t.id, nombre: t.nombre || null, uid: linked.id,
          action: 'WOULD_UPDATE_ROLE', from: linked.role, to: desiredRole,
        });
        console.log(`♻️  ${label} — DRY: cambiaría rol ${linked.role} → ${desiredRole}`);
        continue;
      }
      const patchFields = { role: toFsValue(desiredRole) };
      const patchPath = `users/${linked.id}?updateMask.fieldPaths=role`;
      try {
        await firestoreReq('PATCH', patchPath, { fields: patchFields });
        report.totals.updated++;
        report.updated.push({
          teacherId: t.id, nombre: t.nombre || null, uid: linked.id,
          from: linked.role, to: desiredRole,
        });
        console.log(`♻️  ${label} — rol ${linked.role} → ${desiredRole}`);
      } catch (err) {
        report.totals.errors++;
        report.errors.push({ teacherId: t.id, nombre: t.nombre || null, error: err.message });
        console.error(`❌ ${label} — ${err.message}`);
      }
      await sleep(DELAY_BETWEEN_OPS_MS);
      continue;
    }

    try {
      // 3) Lookup en Firebase Auth
      let authUser = await authLookupByEmail(email);
      let uid = authUser?.localId || null;
      let isNewAuth = false;
      let tempPassword = null;

      if (!uid) {
        // 4) Crear cuenta nueva en Auth
        if (DRY_RUN) {
          report.totals.created++;
          report.created.push({
            teacherId: t.id, nombre: t.nombre || null, email,
            action: 'WOULD_CREATE_AUTH_AND_USERS_DOC', role: desiredRole,
          });
          console.log(`✨ ${label} — DRY: crearía Auth + users doc (${desiredRole})`);
          await sleep(DELAY_BETWEEN_OPS_MS);
          continue;
        }
        tempPassword = generatePassword();
        uid = await authCreateUser(email, tempPassword, t.nombre || email);
        isNewAuth = true;
      }

      // 5) Verificar/crear/actualizar users/{uid}
      const existingUserDoc = usersByUid[uid];
      if (existingUserDoc) {
        const role = existingUserDoc.role;
        // No bajamos roles de gestión (admin/directivo/orientador) — pero SÍ
        // agregamos teacherId si la persona es docente y le falta el vínculo.
        // Esto cubre el caso de Olivia Peña: ya tiene admin desde bootstrap,
        // pero la UI necesita teacherId para mostrarle SUS clases.
        if (role === 'admin' || role === 'directivo' || role === 'orientador') {
          const necesitaTeacherIdLink = !t._isStaff && !existingUserDoc.teacherId;
          if (necesitaTeacherIdLink) {
            if (DRY_RUN) {
              report.totals.updated++;
              report.updated.push({
                teacherId: t.id, nombre: t.nombre || null, uid,
                action: 'WOULD_LINK_TEACHERID', role,
              });
              console.log(`🔗 ${label} — DRY: enlazaría teacherId al user '${role}' existente`);
              await sleep(DELAY_BETWEEN_OPS_MS);
              continue;
            }
            try {
              await firestoreReq('PATCH',
                `users/${uid}?updateMask.fieldPaths=teacherId`,
                { fields: { teacherId: toFsValue(t.id) } }
              );
              report.totals.updated++;
              report.updated.push({
                teacherId: t.id, nombre: t.nombre || null, uid, role,
                note: 'teacherId enlazado a user con rol de gestión existente',
              });
              console.log(`🔗 ${label} — teacherId enlazado al user '${role}'`);
            } catch (err) {
              report.totals.errors++;
              report.errors.push({ teacherId: t.id, nombre: t.nombre || null, error: err.message });
              console.error(`❌ ${label} — ${err.message}`);
            }
            await sleep(DELAY_BETWEEN_OPS_MS);
            continue;
          }
          report.totals.skipped_other_role++;
          report.skipped_other_role.push({
            teacherId: t.id, nombre: t.nombre || null, uid,
            role, note: 'users/{uid} tiene rol de gestión; ya enlazado o staff puro',
          });
          if (isNewAuth) {
            report.errors.push({
              teacherId: t.id, nombre: t.nombre || null, email,
              error: 'Auth recién creado pero users/{uid} ya existe con rol de gestión — no se enlazó',
            });
          }
          console.log(`⚠️  ${label} — users/{uid} con rol '${role}' (sin cambios)`);
          await sleep(DELAY_BETWEEN_OPS_MS);
          continue;
        }
        // Existe (consulta, maestro/orientador sin teacherId, o sin rol): actualizar campos clave
        if (DRY_RUN) {
          report.totals.updated++;
          report.updated.push({
            teacherId: t.id, nombre: t.nombre || null, uid,
            action: 'WOULD_UPDATE_USERS_DOC', role: desiredRole,
          });
          console.log(`♻️  ${label} — DRY: actualizaría users/${uid} (${desiredRole})`);
          await sleep(DELAY_BETWEEN_OPS_MS);
          continue;
        }
        // Para staff directivo (no docente real) NO seteamos teacherId — sus
        // funciones admin no requieren vínculo a una ficha de docente.
        const patchFields = {
          role: toFsValue(desiredRole),
          status: toFsValue('active'),
          displayName: toFsValue(t.nombre || existingUserDoc.displayName || email),
        };
        if (!t._isStaff) patchFields.teacherId = toFsValue(t.id);
        const patchPath = `users/${uid}?` +
          Object.keys(patchFields).map(k => `updateMask.fieldPaths=${k}`).join('&');
        await firestoreReq('PATCH', patchPath, { fields: patchFields });
        report.totals.updated++;
        report.updated.push({ teacherId: t.id, nombre: t.nombre || null, uid, role: desiredRole });
        console.log(`♻️  ${label} — users/${uid} actualizado (${desiredRole})`);
      } else {
        // No existe doc: crear
        if (DRY_RUN) {
          report.totals.created++;
          report.created.push({
            teacherId: t.id, nombre: t.nombre || null, email,
            action: 'WOULD_CREATE_USERS_DOC', auth_existed: !isNewAuth, role: desiredRole,
          });
          console.log(`✨ ${label} — DRY: crearía users doc (${desiredRole})${!isNewAuth ? ', Auth ya existía' : ''}`);
          await sleep(DELAY_BETWEEN_OPS_MS);
          continue;
        }
        // Para staff directivo (no docente real) NO seteamos teacherId.
        const fields = {
          email: toFsValue(email),
          displayName: toFsValue(t.nombre || email),
          role: toFsValue(desiredRole),
          status: toFsValue('active'),
          autoCreated: toFsValue(true),
          createdAt: { timestampValue: new Date().toISOString() },
        };
        if (!t._isStaff) fields.teacherId = toFsValue(t.id);
        await firestoreReq('PATCH', `users/${uid}`, { fields });
        report.totals.created++;
        report.created.push({ teacherId: t.id, nombre: t.nombre || null, email, uid, role: desiredRole });
        console.log(`✨ ${label} — creado ${desiredRole} (uid=${uid}${isNewAuth ? ', Auth nuevo' : ', Auth existente'})`);
      }

      // 6) Si creamos cuenta Auth en este run, guardar credencial para CSV
      if (isNewAuth && tempPassword) {
        credentials.push({
          teacherId: t.id,
          nombre: t.nombre || '',
          email,
          password: tempPassword,
        });
      }
    } catch (err) {
      report.totals.errors++;
      report.errors.push({
        teacherId: t.id, nombre: t.nombre || null, email,
        error: err.message,
      });
      console.error(`❌ ${label} — ${err.message}`);
    }

    await sleep(DELAY_BETWEEN_OPS_MS);
  }

  // ─── ESCRIBIR REPORTES ───
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n📄 Reporte: ${REPORT_FILE}`);

  if (!DRY_RUN && credentials.length > 0) {
    const lines = ['teacherId,nombre,email,password_temporal'];
    for (const c of credentials) {
      lines.push([csvEscape(c.teacherId), csvEscape(c.nombre), csvEscape(c.email), csvEscape(c.password)].join(','));
    }
    fs.writeFileSync(CSV_FILE, lines.join('\n') + '\n');
    try { fs.chmodSync(CSV_FILE, 0o600); } catch (e) { /* Windows o FS sin chmod */ }
    console.log(`🔐 Credenciales: ${CSV_FILE} (${credentials.length} cuentas nuevas, chmod 600)`);
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Docentes en alcance:        ${report.totals.teachers_in_scope}`);
  console.log(`  ✨ Creadas:                 ${report.totals.created}`);
  console.log(`  ♻️  Actualizadas:           ${report.totals.updated}`);
  console.log(`  ⏭️  Omitidas (sin email):    ${report.totals.skipped_no_email}`);
  console.log(`  ✅ Omitidas (ya OK):        ${report.totals.skipped_already_ok}`);
  console.log(`  ⚠️  Omitidas (otro rol):    ${report.totals.skipped_other_role}`);
  console.log(`  ❌ Errores:                 ${report.totals.errors}`);
  if (orphanEmailDocs.length > 0) {
    console.log(`\n  ℹ️  Docs huérfanos en users (id no parece UID): ${orphanEmailDocs.length}`);
    console.log('     (probable resultado del bug en users-mgmt.js — ver reporte)');
  }
}

main().catch(err => {
  console.error('\n💥 Fatal:', err.message);
  process.exit(1);
});
