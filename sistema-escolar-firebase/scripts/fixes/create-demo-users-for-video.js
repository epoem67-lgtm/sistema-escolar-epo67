/**
 * CREATE DEMO USERS FOR VIDEO RECORDING — EPO 67
 *
 * Crea 3 usuarios de prueba para que Olivia pueda grabar 3 videos en Loom:
 *   1. DEMO MAESTRO PRUEBA — rol maestro + 2 asignaciones de prueba
 *   2. DEMO ORIENTADOR PRUEBA — rol orientador_docente + 2 asignaciones
 *   3. DEMO ADMINISTRADOR PRUEBA — rol admin (acceso total)
 *
 * Las asignaciones DEMO usan teacherIds nuevos (no chocan con maestros reales).
 * Si Olivia presiona "Guardar" en captura, se guardan en grades pero con un
 * studentId/teacherId/etc. de prueba. SE PUEDEN BORRAR FÁCILMENTE después
 * con un script de limpieza.
 *
 * Uso: node scripts/fixes/create-demo-users-for-video.js --apply
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const APPLY = process.argv.includes('--apply');

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : {}; if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`)); else resolve(j); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach(k => fields[k] = fsValue(v[k]));
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function setDoc(coll, id, fields) {
  const url = `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${id}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return api('PATCH', 'firestore.googleapis.com', url, body);
}

async function authLookup(email) {
  const r = await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:lookup`,
    { email: [email] }).catch(() => ({ users: [] }));
  return r.users?.[0] || null;
}

async function authCreate(email, password, displayName) {
  const r = await api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts`,
    { email, password, displayName, emailVerified: false }
  );
  return r.localId;
}

async function authUpdate(uid, password) {
  return api('POST', 'identitytoolkit.googleapis.com',
    `/v1/projects/${PROJECT}/accounts:update`,
    { localId: uid, password }
  );
}

// ─── DEFINICIÓN DE LOS 3 USUARIOS DEMO ───
const DEMO_USERS = [
  {
    label: 'MAESTRO',
    email: 'demo.maestro@epo67.local',
    displayName: 'DEMO MAESTRO PRUEBA',
    role: 'maestro',
    password: 'epo67-demoMAE',
    teacherId: 'demo-maestro-001',
    teacherData: {
      nombre: 'DEMO MAESTRO PRUEBA',
      email: 'demo.maestro@epo67.local',
      turno: 'MATUTINO',
      estatus: 'active',
    },
    assignments: [
      {
        id: 'demo-maestro-001_MATUTINO_1-1_G1_cultura_digital_ii',
        groupId: 'MATUTINO_1-1', groupName: '1-1',
        subjectId: 'G1_cultura_digital_ii', subjectName: 'cultura digital ii',
        grado: 1, turno: 'MATUTINO',
      },
      {
        id: 'demo-maestro-001_MATUTINO_1-2_G1_cultura_digital_ii',
        groupId: 'MATUTINO_1-2', groupName: '1-2',
        subjectId: 'G1_cultura_digital_ii', subjectName: 'cultura digital ii',
        grado: 1, turno: 'MATUTINO',
      },
    ],
  },
  {
    label: 'ORIENTADOR',
    email: 'demo.orientador@epo67.local',
    displayName: 'DEMO ORIENTADOR PRUEBA',
    role: 'orientador_docente',  // Híbrido: ve sección orientación + captura sus asignaciones
    password: 'epo67-demoORI',
    teacherId: 'demo-orientador-001',
    teacherData: {
      nombre: 'DEMO ORIENTADOR PRUEBA',
      email: 'demo.orientador@epo67.local',
      turno: 'MATUTINO',
      estatus: 'active',
    },
    assignments: [
      {
        id: 'demo-orientador-001_MATUTINO_2-1_G2_ciencias_sociales_iv',
        groupId: 'MATUTINO_2-1', groupName: '2-1',
        subjectId: 'G2_ciencias_sociales_iv', subjectName: 'ciencias sociales iv',
        grado: 2, turno: 'MATUTINO',
      },
      {
        id: 'demo-orientador-001_MATUTINO_2-2_G2_ciencias_sociales_iv',
        groupId: 'MATUTINO_2-2', groupName: '2-2',
        subjectId: 'G2_ciencias_sociales_iv', subjectName: 'ciencias sociales iv',
        grado: 2, turno: 'MATUTINO',
      },
    ],
  },
  {
    label: 'ADMINISTRADOR',
    email: 'demo.admin@epo67.local',
    displayName: 'DEMO ADMINISTRADOR PRUEBA',
    role: 'admin',
    password: 'epo67-demoADM',
    teacherId: null,  // admin no necesita teacher record
    teacherData: null,
    assignments: [],
  },
];

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  CREAR USUARIOS DEMO PARA VIDEOS — Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  for (const demo of DEMO_USERS) {
    console.log(`👤 ${demo.label}: ${demo.displayName}`);
    console.log(`   Email:    ${demo.email}`);
    console.log(`   Password: ${demo.password}`);
    console.log(`   Rol:      ${demo.role}`);
    if (demo.assignments.length > 0) {
      console.log(`   Asignaciones (${demo.assignments.length}):`);
      demo.assignments.forEach(a => console.log(`      - ${a.groupName} ${a.turno} | ${a.subjectName}`));
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('\n💡 DRY RUN. Para aplicar: agrega --apply\n');
    return;
  }

  console.log('🔴 APLICANDO CAMBIOS...\n');

  for (const demo of DEMO_USERS) {
    console.log(`\n─── ${demo.label} ───`);

    // 1. Crear teacher record si aplica
    if (demo.teacherId && demo.teacherData) {
      try {
        await setDoc('teachers', demo.teacherId, demo.teacherData);
        console.log(`  ✓ teacher creado: ${demo.teacherId}`);
      } catch (e) {
        console.log(`  ⚠ teacher: ${e.message.slice(0, 80)}`);
      }
    }

    // 2. Crear assignments + assignmentsByGroup (CRÍTICO para firestore.rules)
    // El bug v5.94: si creamos solo `assignments` sin `assignmentsByGroup`,
    // las firestore.rules rechazan queries de students/grades porque
    // `teacherHasGroup()` valida la existencia del par en assignmentsByGroup.
    for (const a of demo.assignments) {
      try {
        await setDoc('assignments', a.id, {
          teacherId: demo.teacherId,
          teacherName: demo.displayName,
          groupId: a.groupId,
          groupName: a.groupName,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          grado: a.grado,
          turno: a.turno,
          cobertura: false,
          isDemo: true,  // Marca para limpiar después
        });
        // Crear también el par en assignmentsByGroup
        const abgId = `${a.groupId}_${demo.teacherId}`;
        await setDoc('assignmentsByGroup', abgId, {
          teacherId: demo.teacherId,
          teacherName: demo.displayName,
          groupId: a.groupId,
          groupName: a.groupName,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          turno: a.turno,
          grado: a.grado,
          isDemo: true,
        });
        console.log(`  ✓ assignment + abg: ${a.groupName} - ${a.subjectName}`);
      } catch (e) {
        console.log(`  ⚠ assignment: ${e.message.slice(0, 80)}`);
      }
    }

    // 3. Crear cuenta Auth
    let uid;
    const existing = await authLookup(demo.email);
    if (existing) {
      uid = existing.localId;
      console.log(`  ⚠ Auth ya existe (uid=${uid.slice(0, 12)}). Reseteando contraseña...`);
      await authUpdate(uid, demo.password);
    } else {
      uid = await authCreate(demo.email, demo.password, demo.displayName);
      console.log(`  ✓ Auth creado: uid=${uid.slice(0, 12)}`);
    }

    // 4. Crear/actualizar user doc
    const userFields = {
      email: demo.email,
      displayName: demo.displayName,
      role: demo.role,
      status: 'active',
      mustChangePassword: true,  // Para que pueda mostrar el flujo de primer ingreso
      createdAt: new Date(),
      isDemo: true,
    };
    if (demo.teacherId) userFields.teacherId = demo.teacherId;

    try {
      await setDoc('users', uid, userFields);
      console.log(`  ✓ user doc creado/actualizado: ${uid}`);
    } catch (e) {
      console.log(`  ⚠ user doc: ${e.message.slice(0, 80)}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ USUARIOS DEMO LISTOS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('CREDENCIALES PARA GRABACIÓN:');
  console.log('───────────────────────────────────────────────────────────');
  for (const demo of DEMO_USERS) {
    console.log(`\n  ${demo.label}`);
    console.log(`  ────────────────`);
    console.log(`  🔗 https://epo67-sistema.web.app`);
    console.log(`  📧 ${demo.email}`);
    console.log(`  🔑 ${demo.password}`);
  }
  console.log('\n───────────────────────────────────────────────────────────');
  console.log('TIP: Cada cuenta tiene mustChangePassword=true, así que al');
  console.log('     entrar verás el flujo COMPLETO de primer ingreso (ideal');
  console.log('     para grabar). Después de configurarlas, puedes resetear');
  console.log('     con este script otra vez para volver al estado inicial.');
  console.log('───────────────────────────────────────────────────────────\n');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
