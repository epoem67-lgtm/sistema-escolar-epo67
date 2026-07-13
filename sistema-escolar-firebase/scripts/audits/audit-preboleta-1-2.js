/**
 * Diagnostica por que 1-2 MAT no genera preboletas.
 * Replica el flow exacto del modulo:
 *   - Carga students del grupo
 *   - Carga assignments del grupo
 *   - Carga subjects
 *   - Verifica que cada subject tenga datos completos
 *   - Verifica que cada student tenga id, nombreCompleto, etc.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    }).on('error', rej);
  });
}

async function listAll(c) {
  const out = []; let pt = null;
  do {
    let u = `${BASE}/${c}?pageSize=300`;
    if (pt) u += `&pageToken=${pt}`;
    const r = await reqGet(u);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken || null;
  } while (pt);
  return out;
}

function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
    else if ('nullValue' in v) o[k] = null;
  }
  return o;
}

async function main() {
  const GROUP_ID = 'MATUTINO_1-2';

  const [studDocs, asgDocs, subjDocs] = await Promise.all([
    listAll('students'),
    listAll('assignments'),
    listAll('subjects'),
  ]);

  const all = studDocs.map(d => ({ docId: d.name.split('/').pop(), id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const assignments = asgDocs.map(d => ({ docId: d.name.split('/').pop(), id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const subjects = subjDocs.map(d => ({ docId: d.name.split('/').pop(), id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // FLOW del modulo boletas.js
  console.log(`\n═══ STUDENTS del grupo ${GROUP_ID} ═══`);
  const groupStudents = all.filter(s => s.groupId === GROUP_ID || s.grupo === GROUP_ID);
  console.log(`Total docs con groupId=${GROUP_ID}: ${groupStudents.length}`);

  const activeStudents = groupStudents.filter(s => {
    const e = (s.estatus || '').toString().toUpperCase().trim();
    return e === '' || e === 'ACTIVO';
  });
  console.log(`Activos: ${activeStudents.length}`);

  // Validar que cada alumno tenga id (CRITICO para nlByStudentId[s.id])
  const sinId = activeStudents.filter(s => !s.id);
  console.log(`Sin id (rompe nlByStudentId): ${sinId.length}`);

  // Validar nombreCompleto (rompe localeCompare)
  const sinNombre = activeStudents.filter(s => !s.nombreCompleto);
  if (sinNombre.length > 0) {
    console.log(`⚠️  ${sinNombre.length} alumnos sin nombreCompleto:`);
    sinNombre.forEach(s => console.log(`    docId=${s.docId} nombres="${s.nombres}" apellido1="${s.apellido1}"`));
  } else {
    console.log(`Todos tienen nombreCompleto: ✓`);
  }

  // Validar estatus
  const estatusValores = {};
  groupStudents.forEach(s => {
    const e = s.estatus || '(vacio)';
    estatusValores[e] = (estatusValores[e] || 0) + 1;
  });
  console.log('Distribución de estatus:', estatusValores);

  // ASSIGNMENTS del grupo
  console.log(`\n═══ ASSIGNMENTS del grupo ${GROUP_ID} ═══`);
  const groupAssignments = assignments.filter(a => a.groupId === GROUP_ID);
  console.log(`Total assignments: ${groupAssignments.length}`);

  // Materias unicas
  const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
  console.log(`Subjects unicas: ${subjectIds.length}`);
  console.log(`subjectIds:`, subjectIds);

  // Validar que cada subjectId exista en subjects
  console.log(`\n═══ VALIDACION subjects ═══`);
  const subjMap = {};
  subjects.forEach(s => { subjMap[s.id] = s; });

  const orphanSubjs = subjectIds.filter(sid => !subjMap[sid]);
  console.log(`SubjectIds huerfanos (no existen en subjects): ${orphanSubjs.length}`);
  orphanSubjs.forEach(sid => console.log(`  ⚠️  ${sid}`));

  // Subjects encontrados
  const groupSubjects = subjects.filter(s => subjectIds.includes(s.id));
  console.log(`\nSubjects validos para el grupo: ${groupSubjects.length}`);
  groupSubjects.forEach(s => {
    const flags = [];
    if (!s.nombre) flags.push('SIN_NOMBRE');
    if (!s.grado) flags.push('SIN_GRADO');
    console.log(`  - id=${s.id} nombre="${s.nombre || '(VACIO)'}" grado=${s.grado || '?'} ${flags.length ? '⚠️ ' + flags.join(', ') : ''}`);
  });

  // Verificar que K.sortSubjectsByGrado pueda procesar todas
  console.log(`\n═══ TEST sortSubjectsByGrado ═══`);
  const subsWithoutGrado = groupSubjects.filter(s => !s.grado);
  if (subsWithoutGrado.length > 0) {
    console.log(`⚠️  ${subsWithoutGrado.length} subjects SIN grado:`);
    subsWithoutGrado.forEach(s => console.log(`    ${s.id} → "${s.nombre}"`));
  } else {
    console.log('Todas las subjects tienen grado: ✓');
  }

  // Validar grado del grupo
  const groupDoc = (await listAll('groups')).find(d => d.name.endsWith('/' + GROUP_ID));
  const groupData = groupDoc ? parseFields(groupDoc.fields) : {};
  console.log(`\n═══ GRUPO ${GROUP_ID} ═══`);
  console.log('Data:', { grado: groupData.grado, turno: groupData.turno, nombre: groupData.nombre });

  // Test: replicar build del _buildBoleta para detectar campos nulos
  console.log(`\n═══ TEST nlByStudentId build ═══`);
  const sortedAlpha = [...activeStudents].sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
  const nlByStudentId = {};
  sortedAlpha.forEach((s, i) => {
    if (!s.id) {
      console.log(`⚠️  Alumno #${i+1} sin id: ${s.nombreCompleto}`);
      return;
    }
    nlByStudentId[s.id] = i + 1;
  });
  console.log(`nlByStudentId construido con ${Object.keys(nlByStudentId).length} entries`);

  // ENFOQUE EN POSIBLE BUG: detalle de cada alumno
  console.log(`\n═══ DETALLE ALFABETICO ${GROUP_ID} (54 esperados) ═══`);
  sortedAlpha.forEach((s, i) => {
    console.log(`#${(i+1).toString().padStart(2)} id=${(s.id || 'NULL').padEnd(22)} nombre="${s.nombreCompleto}" expediente="${s.expediente || ''}" estatus="${s.estatus || ''}"`);
  });
}

main().catch(e => { console.error('❌', e.message, e.stack); process.exit(1); });
