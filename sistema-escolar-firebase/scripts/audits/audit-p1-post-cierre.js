/**
 * AUDITORÍA P1 — DETECTAR EDICIONES POST-CIERRE
 *
 * Cruza grades de P1 con activityLog para encontrar ediciones REALES
 * realizadas DESPUÉS del cierre del parcial 1 (P1 lockedAt).
 *
 * Estas son las verdaderas discrepancias: grades modificados tras la
 * impresión de la F1 firmada por padres, posiblemente sin folio formal
 * de corrección. Es lo que Olivia quiere detectar.
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
  console.log('Cargando datos...');
  const [grades, students, subjects, partialsDocs, corrections] = await Promise.all([
    listAll('grades'),
    listAll('students'),
    listAll('subjects'),
    listAll('partials'),
    listAll('gradeCorrections'),
  ]);

  // P1 closure date
  const p1Doc = partialsDocs
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .find(p => p.id === 'P1');
  const p1ClosedAt = p1Doc ? (p1Doc.closedAt || p1Doc.lockedAt) : null;
  const p1Closed = p1Doc?.locked === true;
  console.log(`P1 locked: ${p1Closed}, closedAt: ${p1ClosedAt}\n`);

  const studentMap = {};
  students.forEach(d => {
    const id = d.name.split('/').pop();
    studentMap[id] = parseFields(d.fields);
  });
  const subjectMap = {};
  subjects.forEach(d => {
    const id = d.name.split('/').pop();
    subjectMap[id] = parseFields(d.fields);
  });

  // Aplicar correcciones formales: para CADA, marcar como justificado
  const formalCorrections = {};
  corrections.forEach(d => {
    const c = parseFields(d.fields);
    if (c.partial !== 'P1') return;
    const k = `${c.studentId}|${c.subjectId}`;
    if (!formalCorrections[k]) formalCorrections[k] = [];
    formalCorrections[k].push({
      newCal: c.newCal,
      previousCal: c.previousCal,
      status: c.status,
      reason: c.reason,
      requestedAt: c.requestedAt,
      appliedAt: c.appliedAt,
      source: c.source,
    });
  });

  // Filter P1 grades
  const p1Grades = grades
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(g => g.partial === 'P1');

  console.log(`Total grades P1: ${p1Grades.length}`);

  // Detectar ediciones post-cierre vía updatedAt
  const issues = [];
  const closedAtMs = p1ClosedAt ? new Date(p1ClosedAt).getTime() : null;

  for (const g of p1Grades) {
    const stu = studentMap[g.studentId] || {};
    const subj = subjectMap[g.subjectId] || {};
    const updatedAt = g.updatedAt || g.lastModifiedAt;
    const updatedMs = updatedAt ? new Date(updatedAt).getTime() : null;
    const k = `${g.studentId}|${g.subjectId}`;
    const formalCorrs = formalCorrections[k] || [];
    const hasFormalCorrection = formalCorrs.length > 0;

    // EDICIÓN POST-CIERRE sin corrección formal
    if (p1Closed && closedAtMs && updatedMs && updatedMs > closedAtMs && !hasFormalCorrection) {
      const minutesAfter = Math.round((updatedMs - closedAtMs) / 60000);
      issues.push({
        tipo: 'EDIT_POST_CIERRE_SIN_FOLIO',
        alumno: stu.nombreCompleto || g.studentId,
        grupo: stu.groupId || stu.grupo || '',
        materia: subj.nombre || g.subjectId,
        cal: g.cal,
        suma: g.suma,
        updatedAt: updatedAt,
        minutosTrasCierre: minutesAfter,
        docId: g.id,
      });
    }
  }

  // ORDENAR por minutos tras cierre (más reciente arriba)
  issues.sort((a, b) => (b.minutosTrasCierre || 0) - (a.minutosTrasCierre || 0));

  console.log(`\n========== RESULTADO ==========`);
  console.log(`Ediciones P1 POST-CIERRE sin folio formal: ${issues.length}`);
  console.log();

  // CSV
  const csvFile = path.join(__dirname, 'audit-p1-post-cierre.csv');
  const headers = ['tipo', 'alumno', 'grupo', 'materia', 'cal', 'suma', 'updatedAt', 'minutosTrasCierre', 'docId'];
  const rows = [headers.join(',')];
  for (const i of issues) {
    rows.push([
      i.tipo,
      `"${(i.alumno || '').replace(/"/g, '""')}"`,
      `"${(i.grupo || '').replace(/"/g, '""')}"`,
      `"${(i.materia || '').replace(/"/g, '""')}"`,
      i.cal ?? '',
      i.suma ?? '',
      `"${i.updatedAt || ''}"`,
      i.minutosTrasCierre || '',
      i.docId,
    ].join(','));
  }
  fs.writeFileSync(csvFile, rows.join('\n'), 'utf8');
  console.log(`CSV: ${csvFile}\n`);

  console.log('TOP 40:');
  issues.slice(0, 40).forEach((i, idx) => {
    console.log(`${idx + 1}. ${i.alumno} — ${i.materia}`);
    console.log(`   cal=${i.cal} suma=${i.suma}, editado ${i.minutosTrasCierre} min después del cierre (${i.updatedAt})`);
  });
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
