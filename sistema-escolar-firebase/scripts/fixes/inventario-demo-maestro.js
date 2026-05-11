/**
 * INVENTARIO DEMO MAESTRO — EPO 67
 *
 * NO BORRA NADA. Solo busca y reporta TODO lo que existe en Firestore
 * vinculado al demo maestro (uid xrrHDQdDNYVam2nB6UgD1kiQcJz1):
 *   - users/{uid}
 *   - teachers donde uid == DEMO_UID o nombre contiene "DEMO" o "PRUEBA"
 *   - assignments donde teacherId == teacherDocId del demo
 *   - grades donde updatedBy == DEMO_UID
 *   - incidents donde reportedByUid == DEMO_UID
 *   - teacherHours donde updatedBy == DEMO_UID
 *   - drafts donde updatedBy == DEMO_UID
 *   - correctionRequests donde solicitanteUid == DEMO_UID
 *
 * Uso: node scripts/fixes/inventario-demo-maestro.js
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const DEMO_UID = 'xrrHDQdDNYVam2nB6UgD1kiQcJz1';
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

function val(f) { if (!f) return ''; return f.stringValue ?? f.booleanValue ?? f.integerValue ?? f.doubleValue ?? ''; }

async function getDoc(collection, id) {
  try {
    const r = await api('GET', `/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`);
    return r;
  } catch (e) {
    if (e.message.includes('404')) return null;
    throw e;
  }
}

async function queryByField(collection, field, value) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
      limit: 1000
    }
  };
  const r = await api('POST', `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, body);
  return (r || []).filter(d => d.document).map(d => ({
    id: d.document.name.split('/').pop(),
    fields: d.document.fields || {},
  }));
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  INVENTARIO DEMO MAESTRO  (NO BORRA NADA)`);
  console.log(`  uid: ${DEMO_UID}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // 1) users/{uid}
  console.log(`🔎 users/${DEMO_UID}...`);
  const userDoc = await getDoc('users', DEMO_UID);
  if (userDoc) {
    console.log(`   ✅ EXISTE:`);
    console.log(`      displayName: ${val(userDoc.fields?.displayName)}`);
    console.log(`      email:       ${val(userDoc.fields?.email)}`);
    console.log(`      role:        ${val(userDoc.fields?.role)}`);
    console.log(`      isDemo:      ${val(userDoc.fields?.isDemo)}`);
  } else {
    console.log(`   ❌ no existe`);
  }
  console.log();

  // 2) teachers — buscar por uid
  console.log(`🔎 teachers donde uid == ${DEMO_UID}...`);
  const teachersByUid = await queryByField('teachers', 'uid', DEMO_UID);
  if (teachersByUid.length > 0) {
    teachersByUid.forEach(t => {
      console.log(`   ✅ ${t.id}`);
      console.log(`      nombre: ${val(t.fields.nombre)}`);
    });
  } else {
    console.log(`   ❌ nada por uid`);
  }

  // teachers — también buscar por nombre que contenga DEMO/PRUEBA (fallback)
  console.log(`🔎 teachers con nombre tipo "DEMO" o "PRUEBA"...`);
  // No hay regex en Firestore, así que traemos todos y filtramos
  // (es <100 docentes, no es caro)
  try {
    const allT = await api('POST', `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`, {
      structuredQuery: { from: [{ collectionId: 'teachers' }], limit: 200 }
    });
    const list = (allT || []).filter(d => d.document).map(d => ({
      id: d.document.name.split('/').pop(),
      fields: d.document.fields || {},
    }));
    const sospechosos = list.filter(t => {
      const n = (val(t.fields.nombre) || '').toUpperCase();
      return n.includes('DEMO') || n.includes('PRUEBA') || n.includes('TEST');
    });
    if (sospechosos.length > 0) {
      console.log(`   ⚠ ${sospechosos.length} teachers con nombre sospechoso:`);
      sospechosos.forEach(t => {
        console.log(`     - ${t.id} → nombre: "${val(t.fields.nombre)}" uid: ${val(t.fields.uid) || '(sin uid)'}`);
      });
    } else {
      console.log(`   ✅ ninguno`);
    }
  } catch (e) { console.log(`   ⚠ ${e.message}`); }
  console.log();

  // teacherDocId del demo (lo usamos para los siguientes queries)
  const demoTeacherDocId = teachersByUid[0]?.id;
  if (!demoTeacherDocId) {
    console.log(`⚠ No encontramos teacherDocId del demo. Continuamos con uid solo.\n`);
  } else {
    console.log(`📌 teacherDocId del demo: ${demoTeacherDocId}\n`);
  }

  // 3) assignments
  if (demoTeacherDocId) {
    console.log(`🔎 assignments donde teacherId == ${demoTeacherDocId}...`);
    const asgns = await queryByField('assignments', 'teacherId', demoTeacherDocId);
    console.log(`   ${asgns.length} asignaciones del demo:`);
    asgns.forEach(a => {
      console.log(`     - ${a.id} | ${val(a.fields.turno)} ${val(a.fields.groupName) || val(a.fields.groupId)} · ${val(a.fields.subjectName) || val(a.fields.subjectId)}`);
    });
    console.log();
  }

  // 4) grades por updatedBy
  console.log(`🔎 grades donde updatedBy == ${DEMO_UID}...`);
  const grades = await queryByField('grades', 'updatedBy', DEMO_UID);
  console.log(`   ${grades.length} grades capturadas por el demo`);
  if (grades.length > 0 && grades.length <= 20) {
    grades.forEach(g => {
      console.log(`     - ${g.id} | ${val(g.fields.groupId)} · ${val(g.fields.subjectId)} · P${val(g.fields.partial)}`);
    });
  } else if (grades.length > 20) {
    console.log(`   (mostrando primeras 5 de ${grades.length}):`);
    grades.slice(0, 5).forEach(g => {
      console.log(`     - ${g.id} | ${val(g.fields.groupId)} · ${val(g.fields.subjectId)} · P${val(g.fields.partial)}`);
    });
  }
  console.log();

  // 5) incidents
  console.log(`🔎 incidents reportadas por el demo...`);
  const incidents = await queryByField('incidents', 'reportedByUid', DEMO_UID);
  console.log(`   ${incidents.length} incidents\n`);

  // 6) teacherHours
  console.log(`🔎 teacherHours capturadas por el demo...`);
  const hours = await queryByField('teacherHours', 'updatedBy', DEMO_UID);
  console.log(`   ${hours.length} teacherHours\n`);

  // 7) drafts (si existe la colección)
  console.log(`🔎 drafts del demo...`);
  try {
    const drafts = await queryByField('drafts', 'updatedBy', DEMO_UID);
    console.log(`   ${drafts.length} drafts\n`);
  } catch (e) {
    console.log(`   (colección no existe o no accesible)\n`);
  }

  // 8) correctionRequests
  console.log(`🔎 correctionRequests del demo...`);
  try {
    const corrs = await queryByField('correctionRequests', 'solicitanteUid', DEMO_UID);
    console.log(`   ${corrs.length} correctionRequests\n`);
  } catch (e) {
    console.log(`   (colección no existe o no accesible)\n`);
  }

  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  RESUMEN — qué quedaría por limpiar si confirmas:`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  user doc:           ${userDoc ? '1' : '0'}`);
  console.log(`  teacher docs:       ${teachersByUid.length}`);
  console.log(`  assignments:        ${demoTeacherDocId ? '(ver arriba)' : 'n/a'}`);
  console.log(`  grades:             ${grades.length}`);
  console.log(`  incidents:          ${incidents.length}`);
  console.log(`  teacherHours:       ${hours.length}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
