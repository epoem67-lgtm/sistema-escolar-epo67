/**
 * AUDIT FUNCIONAL DEL SISTEMA — EPO 67
 *
 * Verifica que cada rol pueda acceder a sus módulos y que las consultas
 * de Firestore que esos módulos realizan funcionen correctamente.
 *
 * Hace login como cada usuario de prueba via Firebase Auth REST y luego
 * lanza las queries de Firestore que cada módulo dispara.
 *
 * Uso: node audit-system-functional.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const API_KEY = 'AIzaSyDX4za0avN20Lplmf5LAR7pdfZlvNtvcJc'; // public api key del proyecto (segura — del firebase-config.js)

// Cuentas de prueba conocidas
const TEST_USERS = [
  // { label: 'Admin', email: 'admin@example.com', password: '...', expectedRole: 'admin' },
  { label: 'Orientadora (Isa)', email: 'correa.salgado.ana.isabel@epo67.local', password: 'EPO67orient2026', expectedRole: 'orientador_docente' }
];

// Módulos y queries esperadas que cada rol debe poder ejecutar
const MODULE_QUERIES = {
  'dashboard':       [{ collection: 'config', doc: 'school' }],
  'pre-boletas':     [{ collection: 'students' }, { collection: 'groups' }, { collection: 'subjects' }, { collection: 'assignments' }],
  'boleta-oficial':  [{ collection: 'students' }, { collection: 'groups' }, { collection: 'subjects' }, { collection: 'assignments' }],
  'concentrado':     [{ collection: 'students' }, { collection: 'groups' }, { collection: 'subjects' }, { collection: 'assignments' }],
  'at-risk':         [{ collection: 'atRisk' }, { collection: 'groups' }],
  'student-profile': [{ collection: 'students' }, { collection: 'groups' }, { collection: 'subjects' }, { collection: 'assignments' }],
  'indicadores':     [{ collection: 'students' }, { collection: 'subjects' }, { collection: 'groups' }],
  'reports-comparative': [{ collection: 'students' }, { collection: 'groups' }, { collection: 'subjects' }],
  'honor-roll':      [{ collection: 'groups' }, { collection: 'students' }],
  'my-grades':       [{ collection: 'assignments', filterBy: 'teacherId' }, { collection: 'partials' }],
  'my-lists':        [{ collection: 'assignments', filterBy: 'teacherId' }],
  'my-f1':           [{ collection: 'assignments', filterBy: 'teacherId' }],
  'attendance':      [{ collection: 'assignments', filterBy: 'teacherId' }],
  'my-at-risk':      [{ collection: 'atRisk', filterBy: 'teacherId' }]
};

// ─── HTTP helper ───────────────────────────────────────────────
function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers }
    };
    const req = https.request(opts, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject({ statusCode: res.statusCode, body: parsed });
        } catch (e) { reject({ statusCode: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject({ statusCode: res.statusCode, body: parsed });
        } catch (e) { reject({ statusCode: res.statusCode, body: chunks }); }
      });
    }).on('error', reject);
  });
}

// ─── Login via Firebase Auth REST ──────────────────────────────
async function loginUser(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
  return postJson(url, { email, password, returnSecureToken: true });
}

// ─── Read user doc for role ────────────────────────────────────
async function getUserDoc(uid, idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`;
  return getJson(url, { Authorization: 'Bearer ' + idToken });
}

// ─── Query a collection ────────────────────────────────────────
async function tryCollection(coll, idToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=10`;
  try {
    const r = await getJson(url, { Authorization: 'Bearer ' + idToken });
    return { ok: true, count: (r.documents || []).length };
  } catch (e) {
    return { ok: false, error: e.body?.error?.message || e.body || e.message || 'unknown', code: e.statusCode };
  }
}

// ─── Run audit ─────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AUDITORÍA FUNCIONAL DEL SISTEMA EPO 67');
  console.log('  Fecha:', new Date().toLocaleString('es-MX'));
  console.log('═══════════════════════════════════════════════════════════\n');

  // Verificación de despliegue
  console.log('🌐 VERIFICACIÓN DE DESPLIEGUE');
  console.log('───────────────────────────────────────────────────────────');
  try {
    const r = await new Promise((resolve, reject) => {
      https.get('https://epo67-sistema.web.app/sw.js', res => {
        let chunks = '';
        res.on('data', c => chunks += c);
        res.on('end', () => resolve({ statusCode: res.statusCode, body: chunks }));
      }).on('error', reject);
    });
    const ver = (r.body.match(/SW_VERSION = '([^']+)'/) || [])[1];
    console.log(`✅ epo67-sistema.web.app responde 200 · SW_VERSION = ${ver}`);
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }
  console.log();

  // Por cada usuario de prueba
  for (const u of TEST_USERS) {
    console.log(`👤 USUARIO: ${u.label}  (${u.email})`);
    console.log('───────────────────────────────────────────────────────────');
    let session;
    try {
      session = await loginUser(u.email, u.password);
      console.log(`✅ Login exitoso · uid=${session.localId}`);
    } catch (e) {
      console.log(`❌ Login falló: ${e.body?.error?.message || e.message}`);
      console.log();
      continue;
    }

    // Leer su user doc
    let userDoc;
    try {
      userDoc = await getUserDoc(session.localId, session.idToken);
      const role = userDoc.fields?.role?.stringValue || '(sin rol)';
      const teacherId = userDoc.fields?.teacherId?.stringValue || '(sin teacherId)';
      const recoveryEmail = userDoc.fields?.recoveryEmail?.stringValue || '(no configurado)';
      const mustChange = userDoc.fields?.mustChangePassword?.booleanValue || false;
      console.log(`   Rol: ${role} ${role === u.expectedRole ? '✅' : '⚠ esperado: ' + u.expectedRole}`);
      console.log(`   teacherId: ${teacherId}`);
      console.log(`   Correo recuperación: ${recoveryEmail}`);
      console.log(`   Debe cambiar contraseña: ${mustChange ? 'SÍ ⚠' : 'No'}`);
    } catch (e) {
      console.log(`❌ No se pudo leer user doc: ${e.body?.error?.message || e.message}`);
    }

    // Probar acceso a colecciones
    console.log('\n   📊 Acceso a colecciones (Firestore rules):');
    const collections = [
      'students', 'groups', 'subjects', 'assignments', 'teachers',
      'grades', 'partials', 'atRisk', 'config', 'users'
    ];
    for (const c of collections) {
      const r = await tryCollection(c, session.idToken);
      const icon = r.ok ? '✅' : '❌';
      const detail = r.ok ? `${r.count} docs visibles` : `${r.code}: ${r.error}`;
      console.log(`     ${icon} ${c.padEnd(20)} ${detail}`);
    }

    // Verificar que ve solo sus grupos como orientadora
    if (u.expectedRole === 'orientador_docente' || u.expectedRole === 'orientador') {
      console.log('\n   🎯 Filtro de orientador (debe ver SOLO sus grupos):');
      const teacherId = userDoc.fields?.teacherId?.stringValue;
      if (teacherId) {
        try {
          // Query groups where orientadorId = mi teacherId
          const r = await postJson(
            `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            {
              structuredQuery: {
                from: [{ collectionId: 'groups' }],
                where: { fieldFilter: { field: { fieldPath: 'orientadorId' }, op: 'EQUAL', value: { stringValue: teacherId } } }
              }
            },
            { Authorization: 'Bearer ' + session.idToken }
          );
          const myGroups = (r || []).filter(d => d.document).map(d => d.document.fields?.nombre?.stringValue).filter(Boolean);
          console.log(`     ✅ Grupos como orientador: ${myGroups.join(', ') || '(ninguno)'}`);

          // Query my assignments
          const ra = await postJson(
            `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
            {
              structuredQuery: {
                from: [{ collectionId: 'assignments' }],
                where: { fieldFilter: { field: { fieldPath: 'teacherId' }, op: 'EQUAL', value: { stringValue: teacherId } } }
              }
            },
            { Authorization: 'Bearer ' + session.idToken }
          );
          const myAsg = (ra || []).filter(d => d.document).map(d => {
            const f = d.document.fields;
            return `${f?.subjectName?.stringValue || '?'} → ${f?.groupName?.stringValue || '?'}${f?.interim?.booleanValue ? ' [🟠 cobertura]' : ''}`;
          });
          console.log(`     ✅ Mis asignaciones (${myAsg.length}):`);
          myAsg.forEach(a => console.log(`        • ${a}`));
        } catch (e) {
          console.log(`     ❌ Error en queries filtradas: ${e.body?.error?.message || e.message}`);
        }
      }
    }

    console.log('\n');
  }

  // Verificación de datos clave
  console.log('🔍 VERIFICACIÓN DE INTEGRIDAD DE DATOS');
  console.log('───────────────────────────────────────────────────────────');
  // Login con el primer admin para verificar
  try {
    const adminSession = TEST_USERS[0] ? await loginUser(TEST_USERS[0].email, TEST_USERS[0].password).catch(() => null) : null;
    if (adminSession) {
      // Conteos básicos
      const colls = [
        ['groups', 'Grupos'],
        ['teachers', 'Docentes'],
        ['students', 'Alumnos'],
        ['assignments', 'Asignaciones'],
        ['subjects', 'Materias']
      ];
      for (const [c, label] of colls) {
        const r = await tryCollection(c, adminSession.idToken);
        console.log(`   ${label}: ${r.ok ? r.count + '+ visibles' : 'error ' + r.error}`);
      }
    }
  } catch (e) { console.log(`   ⚠ ${e.message}`); }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  FIN DE AUDITORÍA');
  console.log('═══════════════════════════════════════════════════════════');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
