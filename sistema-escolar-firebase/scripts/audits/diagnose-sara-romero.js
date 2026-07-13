/**
 * Diagnostico exclusivo: ROMERO DOMINGUEZ SARA DANIELA, 1-1 matutino.
 *
 * Olivia reporta que la pre-boleta dept-orientacion muestra cal=9 en
 * PENSAMIENTO MATEMATICO II P1, pero la boleta F1 anterior mostraba 10.
 * Necesitamos saber:
 *   - Qué hay en grades/{studentId}_{subjectId}_P1
 *   - Suma, cal, rubros, faltas
 *   - Si hay gradeCorrections o histórico
 *   - Si calcCal(suma) coincide con cal stored
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
    if (v.stringValue !== undefined) o[k] = v.stringValue;
    else if (v.integerValue !== undefined) o[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) o[k] = Number(v.doubleValue);
    else if (v.booleanValue !== undefined) o[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) o[k] = v.timestampValue;
    else if (v.nullValue !== undefined) o[k] = null;
    else if (v.mapValue !== undefined) o[k] = parseFields(v.mapValue.fields);
    else if (v.arrayValue !== undefined) o[k] = (v.arrayValue.values || []).map(x => parseFields({ x }).x);
  }
  return o;
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return '';
  const s = Math.min(Number(suma), 10);
  if (isNaN(s)) return '';
  if (s >= 6) return Math.min(Math.round(s), 10);
  return 5;
}

(async () => {
  console.log('Buscando alumna ROMERO DOMINGUEZ SARA DANIELA...\n');

  // 1) Buscar alumna
  const students = await listAll('students');
  const allParsed = students.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const matches = allParsed.filter(s => /ROMERO/i.test(s.nombreCompleto || ''));
  console.log(`Total alumnos: ${allParsed.length}`);
  console.log(`Coincidencias 'ROMERO': ${matches.length}`);
  matches.forEach(m => console.log(`  - ${m.nombreCompleto} (grupo: ${m.groupId || m.grupo})`));
  console.log();
  const target = allParsed.find(s => /ROMERO/i.test(s.nombreCompleto || '') && /SARA/i.test(s.nombreCompleto || ''));

  if (!target) {
    // Intentar por expediente 6120
    const byExp = allParsed.find(s => String(s.expediente || '').trim() === '6120');
    if (byExp) {
      console.log(`Encontrada por expediente 6120: ${byExp.nombreCompleto}`);
      Object.assign(target = {}, byExp);
    } else {
      console.error('No se encontro la alumna');
      return;
    }
  }
  console.log(`Alumna: ${target.nombreCompleto}`);
  console.log(`  docId: ${target.id}`);
  console.log(`  grupo: ${target.groupId || target.grupo}`);
  console.log(`  turno: ${target.turno}\n`);

  // 2) Buscar la materia PENSAMIENTO MATEMATICO II
  const subjects = await listAll('subjects');
  const matSubj = subjects
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .find(s => /PENSAMIENTO\s+MATEM/i.test(s.nombre || ''));

  if (!matSubj) {
    console.error('No se encontro materia PENSAMIENTO MATEMATICO');
    return;
  }
  console.log(`Materia: ${matSubj.nombre}`);
  console.log(`  docId: ${matSubj.id}\n`);

  // 3) Listar TODOS los grades de esta alumna (sin importar materia)
  console.log('=== Todos los grades de esta alumna ===');
  const grades = await listAll('grades');
  const myGrades = grades
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(g => g.studentId === target.id);
  console.log(`Total grades de la alumna: ${myGrades.length}\n`);

  // Filtrar los de pensamiento matemático
  const matGrades = myGrades.filter(g => /matem/i.test(g.subjectId || '') || /matem/i.test(g.subjectName || ''));
  console.log(`Grades de Pensamiento Matemático: ${matGrades.length}`);
  matGrades.forEach(g => {
    console.log(`\n--- grades/${g.id} ---`);
    console.log(`  subjectId:  ${g.subjectId}`);
    console.log(`  partial:    ${g.partial}`);
    console.log(`  rubros:     ec=${g.ec} tr=${g.tr} pe=${g.pe} ex=${g.ex}`);
    console.log(`  suma:       ${g.suma}`);
    console.log(`  cal stored: ${g.cal}`);
    console.log(`  value:      ${g.value}`);
    console.log(`  faltas:     ${g.faltas}`);
    if (g.suma !== undefined) {
      const expectedCal = calcCal(g.suma);
      const match = g.cal === expectedCal;
      console.log(`  calcCal(${g.suma}) = ${expectedCal} → ${match ? 'OK ✓' : 'MISMATCH ⚠️'}`);
    }
  });
  console.log();

  // 4) Buscar correcciones para esa cell
  console.log('=== Buscando gradeCorrections ===');
  const corrections = await listAll('gradeCorrections');
  const myCorrections = corrections
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(c => c.studentId === target.id && c.subjectId === matSubj.id);
  if (myCorrections.length === 0) {
    console.log('Ninguna correccion para esa alumna+materia.\n');
  } else {
    myCorrections.forEach(c => {
      console.log(JSON.stringify(c, null, 2));
      console.log('---');
    });
  }
})().catch(e => {
  console.error('ERROR:', e);
  process.exit(1);
});
