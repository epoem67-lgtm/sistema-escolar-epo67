/**
 * Audita grades del 1-2 TM para encontrar docs corruptos.
 * Causas posibles: cal con string raro, partial NULL, subjectId huerfano,
 * studentId que no existe en students, etc.
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
    else if ('arrayValue' in v) o[k] = '(array)';
    else if ('mapValue' in v) o[k] = '(map)';
  }
  return o;
}

async function listGrades(groupId) {
  const out = []; let pt = null;
  do {
    let u = `${BASE}:runQuery`;
    const body = JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'grades' }],
        where: { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: groupId } } },
        limit: 1000,
      }
    });
    const res = await new Promise((res, rej) => {
      const req = https.request({
        hostname: 'firestore.googleapis.com',
        path: u,
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      }, (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : []) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
      });
      req.on('error', rej);
      req.write(body); req.end();
    });
    for (const item of (res || [])) {
      if (item.document) out.push(item.document);
    }
    break;
  } while (pt);
  return out;
}

async function main() {
  const GROUP_ID = 'MATUTINO_1-2';
  console.log(`Cargando grades del ${GROUP_ID}...`);
  const gradeDocs = await listGrades(GROUP_ID);
  console.log(`Total grades: ${gradeDocs.length}`);

  const grades = gradeDocs.map(d => ({ docId: d.name.split('/').pop(), id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Detectar campos anomalos
  const issues = {
    sinStudentId: [],
    sinSubjectId: [],
    sinPartial: [],
    calNoNumerico: [],
    partialDesconocido: [],
    studentIdsHuerfanos: new Set(),
    subjectIdsHuerfanos: new Set(),
  };

  const VALID_PARTIALS = new Set(['P1', 'P2', 'P3']);

  // Cargar students y subjects para validar
  const [studDocs, subjDocs] = await Promise.all([listAll('students'), listAll('subjects')]);
  const studIds = new Set(studDocs.map(d => d.name.split('/').pop()));
  const subjIds = new Set(subjDocs.map(d => d.name.split('/').pop()));

  for (const g of grades) {
    if (!g.studentId) issues.sinStudentId.push(g);
    else if (!studIds.has(g.studentId)) issues.studentIdsHuerfanos.add(g.studentId);

    if (!g.subjectId) issues.sinSubjectId.push(g);
    else if (!subjIds.has(g.subjectId)) issues.subjectIdsHuerfanos.add(g.subjectId);

    if (!g.partial) issues.sinPartial.push(g);
    else if (!VALID_PARTIALS.has(g.partial)) issues.partialDesconocido.push(g);

    // Validar cal
    const cal = g.cal;
    if (cal !== undefined && cal !== null && cal !== '') {
      const n = Number(cal);
      if (!Number.isFinite(n)) issues.calNoNumerico.push({ ...g, calRaw: cal });
    }
  }

  console.log('\n═══ ISSUES ═══');
  console.log(`Sin studentId: ${issues.sinStudentId.length}`);
  console.log(`Sin subjectId: ${issues.sinSubjectId.length}`);
  console.log(`Sin partial: ${issues.sinPartial.length}`);
  console.log(`Cal no numerica: ${issues.calNoNumerico.length}`);
  console.log(`Partial desconocido: ${issues.partialDesconocido.length}`);
  console.log(`StudentIds huerfanos (grade apunta a alumno inexistente): ${issues.studentIdsHuerfanos.size}`);
  console.log(`SubjectIds huerfanos: ${issues.subjectIdsHuerfanos.size}`);

  if (issues.studentIdsHuerfanos.size > 0) {
    console.log('\n⚠️  studentIds huerfanos:');
    [...issues.studentIdsHuerfanos].forEach(sid => console.log(`  - ${sid}`));
  }
  if (issues.subjectIdsHuerfanos.size > 0) {
    console.log('\n⚠️  subjectIds huerfanos:');
    [...issues.subjectIdsHuerfanos].forEach(sid => console.log(`  - ${sid}`));
  }
  if (issues.calNoNumerico.length > 0) {
    console.log('\n⚠️  Cal no numerica:');
    issues.calNoNumerico.slice(0, 20).forEach(g => console.log(`  - ${g.docId} student=${g.studentId} subj=${g.subjectId} cal=${JSON.stringify(g.calRaw)}`));
  }
  if (issues.partialDesconocido.length > 0) {
    console.log('\n⚠️  Partial desconocido:');
    issues.partialDesconocido.slice(0, 20).forEach(g => console.log(`  - ${g.docId} partial=${JSON.stringify(g.partial)}`));
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
