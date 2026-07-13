/**
 * TRANSFER COMUNIDADES VIRTUALES (2-1 + 2-3 MATUTINO) → ANDREA AZPEITIA
 *
 * Olivia avisó que estos 2 grupos ya no son de cobertura — ahora son de
 * planta de Andrea (Azpeitia Correa Rosalva Andrea).
 *
 * Estado actual:
 *   - 2-1 MAT Comunidades Virtuales → Ana Isabel Correa (interim=true)
 *   - 2-3 MAT Comunidades Virtuales → Juana Rangel Palacios (cobertura=true)
 *
 * Estado deseado:
 *   - 2-1 MAT Comunidades Virtuales → Andrea Azpeitia (planta, sin cobertura)
 *   - 2-3 MAT Comunidades Virtuales → Andrea Azpeitia (planta, sin cobertura)
 *
 * Acciones:
 *   1. Crear 2 nuevas asignaciones para Andrea
 *   2. Crear sus 2 assignmentsByGroup
 *   3. Borrar las 2 asignaciones viejas (Ana Isabel + Juana)
 *   4. Borrar los 2 assignmentsByGroup viejos
 *
 * Las grades existentes (47+47=94) NO se tocan — están identificadas por
 * studentId+subjectId+partial, NO por teacherId. Andrea las verá cuando
 * abra su nueva asignación.
 *
 * Uso: node scripts/fixes/transfer-comvir-to-andrea.js --apply
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const APPLY = process.argv.includes('--apply');

// Datos hardcoded del fix
const ANDREA = {
  teacherId: 'nuThuBDgenuoPa3dN5qo',
  teacherName: 'AZPEITIA CORREA ROSALVA ANDREA',
};
const SUBJECT = {
  subjectId: 'G2_comunidades_virtuales',
  subjectName: 'comunidades virtuales',
};
const TARGETS = [
  { groupId: 'MATUTINO_2-1', groupName: '2-1', oldAsgId: '99rMqpbfFKrHMkfE2Jqb_MATUTINO_2-1_G2_comunidades_virtuales', oldTeacherId: '99rMqpbfFKrHMkfE2Jqb', oldTeacher: 'Ana Isabel Correa' },
  { groupId: 'MATUTINO_2-3', groupName: '2-3', oldAsgId: 'GwXEGuy4aqGChlCZPOqa_MATUTINO_2-3_G2_comunidades_virtuales', oldTeacherId: 'GwXEGuy4aqGChlCZPOqa', oldTeacher: 'Juana Rangel' },
];

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
  return { stringValue: String(v) };
}

async function setDoc(coll, id, fields) {
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = fsValue(fields[f]));
  return api('PATCH', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${encodeURIComponent(id)}`,
    body
  );
}

async function deleteDoc(coll, id) {
  return api('DELETE', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}/${encodeURIComponent(id)}`
  );
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  TRANSFER COMUNIDADES VIRTUALES → Andrea Azpeitia`);
  console.log(`  Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  for (const t of TARGETS) {
    console.log(`📋 Grupo ${t.groupName} MATUTINO`);
    console.log(`   Antes: ${t.oldTeacher} (${t.oldTeacherId.slice(0, 16)})`);
    console.log(`   Ahora: ${ANDREA.teacherName} (${ANDREA.teacherId.slice(0, 16)})`);
    console.log('');

    if (!APPLY) continue;

    const newAsgId = `${ANDREA.teacherId}_${t.groupId}_${SUBJECT.subjectId}`;
    const newAbgId = `${t.groupId}_${ANDREA.teacherId}`;
    const oldAbgId = `${t.groupId}_${t.oldTeacherId}`;

    // 1. Crear nueva asignación para Andrea (sin cobertura, sin interim)
    try {
      await setDoc('assignments', newAsgId, {
        teacherId: ANDREA.teacherId,
        teacherName: ANDREA.teacherName,
        groupId: t.groupId,
        groupName: t.groupName,
        subjectId: SUBJECT.subjectId,
        subjectName: SUBJECT.subjectName,
        grado: 2,
        turno: 'MATUTINO',
        cobertura: false,
      });
      console.log(`   ✅ Creada nueva assignment: ${newAsgId.slice(0, 60)}...`);
    } catch (e) {
      console.log(`   ❌ Error creando assignment: ${e.message.slice(0, 80)}`);
      continue;
    }

    // 2. Crear assignmentsByGroup para Andrea
    try {
      await setDoc('assignmentsByGroup', newAbgId, {
        teacherId: ANDREA.teacherId,
        teacherName: ANDREA.teacherName,
        groupId: t.groupId,
        groupName: t.groupName,
        subjectId: SUBJECT.subjectId,
        subjectName: SUBJECT.subjectName,
        turno: 'MATUTINO',
        grado: 2,
      });
      console.log(`   ✅ Creado assignmentsByGroup: ${newAbgId}`);
    } catch (e) {
      console.log(`   ❌ Error creando abg: ${e.message.slice(0, 80)}`);
    }

    // 3. Borrar la asignación vieja
    try {
      await deleteDoc('assignments', t.oldAsgId);
      console.log(`   🗑  Eliminada asignación vieja de ${t.oldTeacher}`);
    } catch (e) {
      if (!e.message.includes('404')) console.log(`   ⚠ ${e.message.slice(0, 80)}`);
    }

    // 4. Borrar el assignmentsByGroup viejo
    try {
      await deleteDoc('assignmentsByGroup', oldAbgId);
      console.log(`   🗑  Eliminado abg viejo: ${oldAbgId}`);
    } catch (e) {
      if (!e.message.includes('404')) console.log(`   ⚠ abg: ${e.message.slice(0, 80)}`);
    }

    // 5. Audit log
    try {
      await api('POST', 'firestore.googleapis.com',
        `/v1/projects/${PROJECT}/databases/(default)/documents/activityLog`,
        {
          fields: {
            action: { stringValue: 'transferir_asignacion' },
            entityType: { stringValue: 'asignacion' },
            entityId: { stringValue: newAsgId },
            description: { stringValue: `Asignación ${t.groupName} MAT Comunidades Virtuales transferida de ${t.oldTeacher} a ${ANDREA.teacherName} (ya no es cobertura)` },
            timestamp: { timestampValue: new Date().toISOString() },
          }
        }
      );
    } catch (_) { /* no crítico */ }

    console.log('');
  }

  if (!APPLY) {
    console.log(`💡 DRY RUN. Para aplicar: --apply\n`);
    return;
  }

  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ TRANSFERENCIA COMPLETA`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  Las 47+47=94 grades existentes siguen intactas.`);
  console.log(`  Cuando Andrea abra esos grupos en su pantalla, verá las`);
  console.log(`  calificaciones que ya capturaron las maestras anteriores.`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
