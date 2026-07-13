/**
 * MARK INTERIM ASSIGNMENTS
 *
 * Detecta y marca asignaciones que son COBERTURA TEMPORAL de un orientador
 * cubriendo una vacante en su mismo turno.
 *
 * Regla del usuario: "Las orientadoras NUNCA son maestras del mismo turno;
 * están cubriendo una vacante."
 *
 * Algoritmo:
 *   Para cada teacher que sea orientador (figura como orientador en algún grupo):
 *     - Identifica el TURNO en el que orienta (turnos de los grupos que orienta)
 *     - Recorre sus assignments de docencia
 *     - Si la assignment es en EL MISMO TURNO en que orienta -> es COBERTURA
 *
 * Modos:
 *   node mark-interim-assignments.js              -> DRY RUN (no escribe nada)
 *   node mark-interim-assignments.js --apply      -> Aplica cambios + audit log
 *   node mark-interim-assignments.js --backup     -> Solo guarda backup local
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
const TOKEN = config.tokens.access_token;

const APPLY = process.argv.includes('--apply');
const BACKUP_ONLY = process.argv.includes('--backup');

// ─── HTTP helpers ───────────────────────────────────────────────
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(u, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fetchPage(collection, pageToken) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?pageSize=300`;
  if (pageToken) url += '&pageToken=' + pageToken;
  return request('GET', url);
}

async function getAll(collection) {
  const all = [];
  let token = null;
  do {
    const r = await fetchPage(collection, token);
    if (r.documents) all.push(...r.documents);
    token = r.nextPageToken;
  } while (token);
  return all;
}

// Convierte un valor JS a Firestore Value
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    Object.keys(v).forEach(k => fields[k] = toFsValue(v[k]));
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function patchDoc(collection, docId, fieldsToUpdate) {
  const fieldPaths = Object.keys(fieldsToUpdate);
  const updateMask = fieldPaths.map(f => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${docId}?${updateMask}`;
  const body = { fields: {} };
  fieldPaths.forEach(f => body.fields[f] = toFsValue(fieldsToUpdate[f]));
  return request('PATCH', url, body);
}

async function createDoc(collection, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${collection}`;
  const body = { fields: {} };
  Object.keys(fields).forEach(f => body.fields[f] = toFsValue(fields[f]));
  return request('POST', url, body);
}

// ─── Helpers de normalización ───────────────────────────────────
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const stripTitles = s => norm(s).replace(/\bPROFRA?\.?|\bMTRA?\.?|\bDR[A]?\.?|\bLIC\.?|\bMA\.?/g, '').trim();

function matchTeacherByName(name, teachers) {
  const ws = stripTitles(name).split(/\s+/).filter(w => w.length > 2);
  if (ws.length < 2) return null;
  let best = null, bestScore = 0;
  teachers.forEach(t => {
    const tw = stripTitles(t.nombre || '').split(/\s+/).filter(w => w.length > 2);
    const overlap = ws.filter(w => tw.includes(w)).length;
    if (overlap > bestScore) { bestScore = overlap; best = t; }
  });
  return bestScore >= 2 ? best : null;
}

// ─── Main ───────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  MARK INTERIM ASSIGNMENTS');
  console.log('  Modo:', APPLY ? '🔴 APPLY (escribirá cambios)' : (BACKUP_ONLY ? '💾 BACKUP ONLY' : '🟢 DRY RUN (sin cambios)'));
  console.log('═══════════════════════════════════════════════════════════');

  console.log('\n📥 Cargando colecciones de Firestore...');
  const [teachers, assignments, groups, subjects] = await Promise.all([
    getAll('teachers'),
    getAll('assignments'),
    getAll('groups'),
    getAll('subjects')
  ]);
  console.log(`   teachers: ${teachers.length}, assignments: ${assignments.length}, groups: ${groups.length}, subjects: ${subjects.length}`);

  // Normalizar a estructuras simples
  const tList = teachers.map(t => ({ id: t.name.split('/').pop(), nombre: t.fields?.nombre?.stringValue || '' }));
  const sById = {}; subjects.forEach(s => sById[s.name.split('/').pop()] = s.fields?.nombre?.stringValue || '');
  const gList = groups.map(g => ({
    id: g.name.split('/').pop(),
    nombre: g.fields?.nombre?.stringValue || g.fields?.grupo?.stringValue || '',
    turno: g.fields?.turno?.stringValue || '',
    grado: g.fields?.grado?.integerValue || g.fields?.grado?.stringValue || '',
    orientadorId: g.fields?.orientadorId?.stringValue || '',
    orientadorNombre: g.fields?.orientador?.stringValue || ''
  }));
  const aList = assignments.map(a => ({
    id: a.name.split('/').pop(),
    teacherId: a.fields?.teacherId?.stringValue || '',
    groupId: a.fields?.groupId?.stringValue || '',
    subjectId: a.fields?.subjectId?.stringValue || '',
    groupName: a.fields?.groupName?.stringValue || '',
    subjectName: a.fields?.subjectName?.stringValue || '',
    turno: a.fields?.turno?.stringValue || '',
    grado: a.fields?.grado?.integerValue || a.fields?.grado?.stringValue || '',
    interim: a.fields?.interim?.booleanValue || false
  }));

  // ─── Backup local ────────────────────────────────────────
  if (APPLY || BACKUP_ONLY) {
    const backupDir = path.join(__dirname, '..', '..', '_RESPALDOS');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(backupDir, `assignments-pre-interim-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(assignments, null, 2));
    console.log(`💾 Backup guardado: ${backupFile}`);
    if (BACKUP_ONLY) { console.log('Solo backup. Saliendo.'); return; }
  }

  // ─── Detección de cobertura ──────────────────────────────
  // Resolver orientador por grupo: si tiene orientadorId, usarlo; si no, match por nombre.
  const orientadorTurnos = new Map(); // teacherId -> Set(turnos donde orienta)
  gList.forEach(g => {
    let teacher = null;
    if (g.orientadorId) teacher = tList.find(t => t.id === g.orientadorId);
    if (!teacher && g.orientadorNombre) teacher = matchTeacherByName(g.orientadorNombre, tList);
    if (!teacher) return;
    if (!orientadorTurnos.has(teacher.id)) orientadorTurnos.set(teacher.id, new Set());
    if (g.turno) orientadorTurnos.get(teacher.id).add(g.turno);
  });

  console.log(`\n🎯 Orientadores identificados: ${orientadorTurnos.size}`);

  // Una assignment es interim si: el teacher es orientador en el mismo turno
  const interimDetected = [];
  aList.forEach(a => {
    if (a.interim) return; // ya está marcada
    const turnosOrienta = orientadorTurnos.get(a.teacherId);
    if (!turnosOrienta) return;
    if (turnosOrienta.has(a.turno)) {
      const teacher = tList.find(t => t.id === a.teacherId);
      const subjectName = a.subjectName || sById[a.subjectId] || a.subjectId;
      interimDetected.push({
        assignmentId: a.id,
        teacherId: a.teacherId,
        teacherName: teacher?.nombre || '?',
        groupId: a.groupId,
        groupName: a.groupName,
        subjectId: a.subjectId,
        subjectName,
        turno: a.turno,
        grado: a.grado
      });
    }
  });

  console.log(`\n🟠 Asignaciones detectadas como COBERTURA TEMPORAL: ${interimDetected.length}`);
  console.log('───────────────────────────────────────────────────────────');
  interimDetected.forEach((a, i) => {
    console.log(`${i + 1}. ${a.teacherName}`);
    console.log(`   Materia: ${a.subjectName}`);
    console.log(`   Grupo:   ${a.groupName} (${a.turno}, ${a.grado}°)`);
    console.log(`   AssignId: ${a.assignmentId}`);
    console.log('');
  });

  if (!APPLY) {
    console.log('🟢 DRY RUN — no se escribió nada.');
    console.log('   Para aplicar: node mark-interim-assignments.js --apply');
    return;
  }

  // ─── APPLY ────────────────────────────────────────────────
  console.log('🔴 APPLY mode — actualizando documentos...');
  const interimSince = new Date();
  let updated = 0;
  let errors = 0;

  for (const a of interimDetected) {
    try {
      await patchDoc('assignments', a.assignmentId, {
        interim: true,
        interimSince,
        interimNote: 'Cobertura inicial detectada automáticamente: orientador del mismo turno'
      });
      // Audit log
      await createDoc('activityLog', {
        type: 'assignment.interim.created',
        description: `Marcada como cobertura temporal: ${a.teacherName} cubre ${a.subjectName} en ${a.groupName} (${a.turno})`,
        metadata: {
          assignmentId: a.assignmentId,
          teacherId: a.teacherId,
          teacherName: a.teacherName,
          groupId: a.groupId,
          groupName: a.groupName,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          turno: a.turno,
          source: 'auto-detection-script',
          reason: 'orientador-mismo-turno'
        },
        timestamp: interimSince,
        userId: 'system',
        userName: 'Sistema (auto-detección)'
      });
      console.log(`✔ ${a.teacherName} → ${a.subjectName} en ${a.groupName}`);
      updated++;
    } catch (err) {
      console.error(`✗ Error en ${a.assignmentId}:`, err.message);
      errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Actualizadas: ${updated}`);
  console.log(`  Errores:      ${errors}`);
  console.log('═══════════════════════════════════════════════════════════');
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
