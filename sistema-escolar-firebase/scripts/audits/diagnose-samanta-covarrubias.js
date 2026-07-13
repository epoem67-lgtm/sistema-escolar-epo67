/**
 * Diagnóstico: COVARRUBIAS ACOSTA SAMANTHA ANGELINE, 1-2 matutino.
 * Olivia reporta que CIENCIAS SOCIALES II le pasó de 10 (P1, F1 firmada) a 8 (dept-boleta).
 * Investigar TODAS sus 11 materias en P1 y P2 para ver discrepancias.
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
  }
  return o;
}

function calcCal(suma) {
  if (suma === null || suma === undefined) return null;
  const s = Math.min(Number(suma), 10);
  if (isNaN(s)) return null;
  if (s >= 6) return Math.min(Math.round(s), 10);
  return 5;
}

(async () => {
  const students = await listAll('students');
  const target = students
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .find(s => /COVARRUBIAS\s+ACOSTA\s+SAMANTHA/i.test(s.nombreCompleto || ''));

  if (!target) {
    console.error('No encontrada');
    return;
  }
  console.log(`Alumna: ${target.nombreCompleto}`);
  console.log(`  docId: ${target.id}`);
  console.log(`  grupo: ${target.groupId || target.grupo}`);
  console.log();

  const subjects = await listAll('subjects');
  const subjectMap = {};
  subjects.forEach(d => {
    const id = d.name.split('/').pop();
    subjectMap[id] = parseFields(d.fields);
  });

  const grades = await listAll('grades');
  const myGrades = grades
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(g => g.studentId === target.id);

  console.log(`Total grades de la alumna: ${myGrades.length}\n`);

  // Agrupar por materia
  const bySubject = {};
  myGrades.forEach(g => {
    if (!bySubject[g.subjectId]) bySubject[g.subjectId] = {};
    bySubject[g.subjectId][g.partial] = g;
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('MATERIA                          P1 (suma|cal|faltas)  P2 (suma|cal|faltas)  P3');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  Object.keys(bySubject).sort().forEach(sid => {
    const subj = subjectMap[sid] || {};
    const subjName = (subj.nombre || sid).substring(0, 32).padEnd(32);
    const partials = bySubject[sid];
    const fmt = (g) => {
      if (!g) return '   -          ';
      const expectedCal = calcCal(g.suma);
      const mismatch = g.cal !== expectedCal ? '⚠️' : '  ';
      return `${String(g.suma ?? '-').padStart(4)}|${String(g.cal ?? '-').padStart(3)}|${String(g.faltas ?? '-').padStart(2)} ${mismatch}`;
    };
    console.log(`${subjName} ${fmt(partials.P1)}  ${fmt(partials.P2)}  ${fmt(partials.P3)}`);
  });

  // CIENCIAS SOCIALES P1 detalle
  console.log('\n=== DETALLE: CIENCIAS SOCIALES II P1 ===');
  const cs = myGrades.find(g => /sociales/i.test(g.subjectId) && g.partial === 'P1');
  if (cs) {
    console.log(JSON.stringify(cs, null, 2));
  } else {
    console.log('No encontrado grade Ciencias Sociales P1');
  }

  // TALLER P1 detalle
  console.log('\n=== DETALLE: TALLER DE CIENCIAS I P1 ===');
  const ta = myGrades.find(g => /taller/i.test(g.subjectId) && g.partial === 'P1');
  if (ta) {
    console.log(JSON.stringify(ta, null, 2));
  } else {
    console.log('No encontrado grade Taller de Ciencias P1');
  }

  // gradeCorrections para esta alumna
  console.log('\n=== gradeCorrections de esta alumna ===');
  const corrections = await listAll('gradeCorrections');
  const mine = corrections
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(c => c.studentId === target.id);
  if (mine.length === 0) {
    console.log('Ninguna corrección formal.');
  } else {
    mine.forEach(c => {
      console.log(JSON.stringify(c, null, 2));
      console.log('---');
    });
  }
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
