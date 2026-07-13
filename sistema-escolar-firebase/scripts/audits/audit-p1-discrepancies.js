/**
 * AUDITORÍA INTEGRAL DEL PRIMER PARCIAL
 *
 * Objetivo: detectar grades de P1 que pudieron haberse modificado DESPUÉS
 * de la entrega de la F1 a los padres, lo que generaría discrepancia entre
 * la boleta firmada (en mano del padre) y la pre-boleta actual.
 *
 * Para CADA grade de P1 verificamos:
 *   1) Consistencia interna: cal stored == calcCal(suma)
 *   2) Boundary cases: suma cerca del límite de redondeo (X.4 vs X.5)
 *      donde un cambio de 0.1 en EC bajaría la cal final 1 punto
 *   3) ¿Existe gradeCorrection para este alumno+materia+P1?
 *      (si hay corrección formal, el cambio está justificado)
 *   4) ¿El parcial está cerrado? Si sí, cualquier edición sin correction
 *      es sospechosa.
 *
 * Output: CSV con los grades sospechosos para que Olivia los revise.
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
  const [grades, students, subjects, corrections, partialsDocs] = await Promise.all([
    listAll('grades'),
    listAll('students'),
    listAll('subjects'),
    listAll('gradeCorrections'),
    listAll('partials'),
  ]);

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

  // Construir set de correcciones aplicadas (studentId|subjectId|partial)
  const correctionSet = new Set();
  corrections.forEach(d => {
    const c = parseFields(d.fields);
    if (c.status === 'applied' || c.status === 'aplicada') {
      correctionSet.add(`${c.studentId}|${c.subjectId}|${c.partial}`);
    }
  });

  // ¿Está P1 cerrado?
  const p1Doc = partialsDocs
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .find(p => p.id === 'P1');
  const p1IsLocked = !!(p1Doc && p1Doc.locked);
  console.log(`Partial P1 locked: ${p1IsLocked}\n`);

  // Filtrar grades de P1
  const p1Grades = grades
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(g => g.partial === 'P1');

  console.log(`Total grades en P1: ${p1Grades.length}\n`);

  const issues = [];

  for (const g of p1Grades) {
    const stu = studentMap[g.studentId] || {};
    const subj = subjectMap[g.subjectId] || {};
    const calExpected = calcCal(g.suma);
    const calStored = g.cal !== undefined ? g.cal : (g.value !== undefined ? g.value : null);
    const hasCorrection = correctionSet.has(`${g.studentId}|${g.subjectId}|P1`);

    const sumaNum = Number(g.suma);
    const isBoundary = !isNaN(sumaNum) && (sumaNum % 1 !== 0); // suma no es entero

    // CASO 1: Inconsistencia matemática (suma → cal no calcula)
    if (calStored !== null && calExpected !== null && Number(calStored) !== calExpected) {
      issues.push({
        tipo: 'CAL_INCONSISTENTE',
        alumno: stu.nombreCompleto || g.studentId,
        grupo: stu.groupId || stu.grupo || '',
        materia: subj.nombre || g.subjectId,
        ec: g.ec, tr: g.tr, pe: g.pe, ex: g.ex,
        suma: g.suma,
        calStored, calExpected,
        tieneCorrection: hasCorrection,
        docId: g.id,
      });
      continue;
    }

    // CASO 2: Suma "sospechosa" en boundary X.4 (donde un cambio de 0.1
    // en EC pudo haber bajado el round). Solo cuando NO hay correction.
    if (isBoundary && !hasCorrection) {
      const decimal = Math.round((sumaNum - Math.floor(sumaNum)) * 10) / 10;
      // Boundaries riesgosos: .4 (debería ser .5) | .9 (debería ser .0)
      // Es decir, suma actual está 0.1 por debajo del round-up.
      if (decimal === 0.4 || decimal === 0.9) {
        // Verificar: si EC+0.1 daría una cal mayor
        const hypotheticalSuma = sumaNum + 0.1;
        const hypotheticalCal = calcCal(hypotheticalSuma);
        if (hypotheticalCal !== calExpected) {
          issues.push({
            tipo: 'POSIBLE_EDICION_BAJA',
            alumno: stu.nombreCompleto || g.studentId,
            grupo: stu.groupId || stu.grupo || '',
            materia: subj.nombre || g.subjectId,
            ec: g.ec, tr: g.tr, pe: g.pe, ex: g.ex,
            suma: g.suma,
            calStored, calExpected,
            tieneCorrection: hasCorrection,
            nota: `Si EC fuera +0.1 (=${(g.ec || 0) + 0.1}), suma=${hypotheticalSuma.toFixed(1)} y cal=${hypotheticalCal}`,
            docId: g.id,
          });
        }
      }
    }
  }

  console.log(`\n========== RESULTADO ==========`);
  console.log(`Total grades P1 revisados: ${p1Grades.length}`);
  console.log(`Inconsistencias matemáticas (cal != calcCal(suma)): ${issues.filter(i => i.tipo === 'CAL_INCONSISTENTE').length}`);
  console.log(`Posibles ediciones a la baja (.4 boundary): ${issues.filter(i => i.tipo === 'POSIBLE_EDICION_BAJA').length}`);
  console.log();

  // Output CSV
  const csvFile = path.join(__dirname, 'audit-p1-discrepancies.csv');
  const headers = ['tipo','alumno','grupo','materia','ec','tr','pe','ex','suma','cal_stored','cal_esperado','tiene_correction','docId','nota'];
  const rows = [headers.join(',')];
  for (const i of issues) {
    rows.push([
      i.tipo,
      `"${(i.alumno || '').replace(/"/g, '""')}"`,
      `"${(i.grupo || '').replace(/"/g, '""')}"`,
      `"${(i.materia || '').replace(/"/g, '""')}"`,
      i.ec ?? '', i.tr ?? '', i.pe ?? '', i.ex ?? '',
      i.suma ?? '',
      i.calStored ?? '',
      i.calExpected ?? '',
      i.tieneCorrection ? 'sí' : 'no',
      i.docId,
      `"${(i.nota || '').replace(/"/g, '""')}"`,
    ].join(','));
  }
  fs.writeFileSync(csvFile, rows.join('\n'), 'utf8');
  console.log(`CSV generado: ${csvFile}`);

  // Top 30 en consola
  console.log('\nTOP 30 sospechosos:');
  issues.slice(0, 30).forEach((i, idx) => {
    console.log(`${idx + 1}. [${i.tipo}] ${i.alumno} — ${i.materia}`);
    console.log(`   ec=${i.ec} tr=${i.tr} pe=${i.pe} ex=${i.ex} → suma=${i.suma} cal=${i.calStored} (esperado=${i.calExpected})`);
    if (i.nota) console.log(`   ${i.nota}`);
    console.log();
  });
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
