/**
 * SNAPSHOT CERTIFICADO — P1 MATUTINO 1-1, 1-2, 1-3
 *
 * Auditados contra "EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1...xlsx"
 * Resultado: 1,786/1,793 coinciden. 7 discrepancias de CAL + 1 de FALTAS
 * son las CORRECCIONES PREVIAS aplicadas con base en cuadros firmados:
 *   - F1 firmada de mamá Estivaliz para Sara D. Romero (Pens.Mat → 10)
 *   - Cuadro firmado de Granados de Loera para MAT 1-2 C. Sociales (7 alumnos)
 *
 * Decisión Olivia (3 jun 2026): conservar las correcciones. El Excel de
 * Salazar Zúñiga es anterior a las correcciones; los valores oficiales son
 * los que están en Firestore (basados en los cuadros firmados originales).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const DRY_RUN = !process.argv.includes('--apply');
const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

const VERIFIED_GROUPS = [
  {
    groupId: 'MATUTINO_1-1',
    verifiedBy: 'orientación + cuadro F1 firmado',
    verifiedFromFile: 'EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1-20260511 (1).xlsx',
    verifiedDate: '2026-06-03',
    note: 'Excel coincide 100% excepto Pens.Mat de Sara Romero (cal=10 oficial según F1 firmada, no 9 del Excel). Corrección conservada.',
  },
  {
    groupId: 'MATUTINO_1-2',
    verifiedBy: 'orientación + cuadro firmado de Granados',
    verifiedFromFile: 'EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1-20260511 (1).xlsx',
    verifiedDate: '2026-06-03',
    note: 'Excel coincide 100% excepto 7 alumnas en C.Sociales (Ambrosio, Becerra, Covarrubias, Gonzalez, Legorreta, Lopez, Marentes, Martinez) y 1 caso de faltas (Gonzalez Paulina). Valores oficiales según cuadro firmado de Maestra Granados de Loera — restauraciones conservadas.',
  },
  {
    groupId: 'MATUTINO_1-3',
    verifiedBy: 'orientación',
    verifiedFromFile: 'EPO67-CONCENTRADO-MAT-1GRADO-SALAZAR_ZUNIGA-P1-20260511 (1).xlsx',
    verifiedDate: '2026-06-03',
    note: '100% match. 0 discrepancias.',
  },
];

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      r.setEncoding('utf8');
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    }).on('error', rej);
  });
}
function reqPatch(p, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'firestore.googleapis.com', path: p, method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data) },
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej); req.write(data); req.end();
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
  }
  return o;
}
function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') {
      if (Number.isInteger(v)) out[k] = { integerValue: String(v) };
      else out[k] = { doubleValue: v };
    } else if (typeof v === 'string') out[k] = { stringValue: v };
    else if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map(x => toFirestoreFields({ x }).x).filter(Boolean) } };
    else if (typeof v === 'object') out[k] = { mapValue: { fields: toFirestoreFields(v) } };
  }
  return out;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  const [students, grades] = await Promise.all([listAll('students'), listAll('grades')]);
  const studentMap = {};
  students.forEach(d => { studentMap[d.name.split('/').pop()] = parseFields(d.fields); });

  const snapshotDocs = [];
  let totalGrades = 0;
  for (const cfg of VERIFIED_GROUPS) {
    const stuIds = new Set(
      Object.entries(studentMap)
        .filter(([_, s]) => (s.groupId || s.grupo) === cfg.groupId)
        .filter(([_, s]) => { const e = (s.estatus || '').toString().toUpperCase().trim(); return e === '' || e === 'ACTIVO'; })
        .map(([id]) => id)
    );
    const groupGrades = grades
      .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
      .filter(g => g.partial === 'P1' && stuIds.has(g.studentId));

    const items = groupGrades.map(g => ({
      docId: g.id, studentId: g.studentId,
      studentName: studentMap[g.studentId]?.nombreCompleto || '',
      subjectId: g.subjectId, subjectName: g.subjectName || '',
      teacherId: g.teacherId || '', teacherName: g.teacherName || '',
      ec: g.ec ?? null, tr: g.tr ?? null, pe: g.pe ?? null, ex: g.ex ?? null,
      suma: g.suma ?? null, cal: g.cal ?? null, value: g.value ?? null, faltas: g.faltas ?? null,
    })).sort((a, b) => (a.studentId + a.subjectId).localeCompare(b.studentId + b.subjectId));

    const hash = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
    const snapshot = {
      groupId: cfg.groupId, partial: 'P1',
      verifiedBy: cfg.verifiedBy, verifiedFromFile: cfg.verifiedFromFile, verifiedDate: cfg.verifiedDate,
      certifiedAt: new Date().toISOString(),
      certifiedByUid: 'oliepo67-script',
      certifiedByName: 'Olivia Peña (cotejo + correcciones formales conservadas)',
      note: cfg.note, itemCount: items.length, hash, items,
    };
    const docId = `${cfg.groupId}_P1_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    snapshotDocs.push({ docId, snapshot });
    totalGrades += items.length;
    console.log(`📸 ${cfg.groupId} P1 — ${items.length} grades · hash: ${hash.slice(0, 16)}...`);
  }

  console.log(`\nTotal grades: ${totalGrades}\n`);
  if (DRY_RUN) { console.log('(dry-run)'); return; }

  let ok = 0, errors = 0;
  for (const { docId, snapshot } of snapshotDocs) {
    try {
      const url = `${BASE}/certifiedSnapshots/${encodeURIComponent(docId)}`;
      await reqPatch(url, { fields: toFirestoreFields(snapshot) });
      console.log(`✓ certifiedSnapshots/${docId}`);
      ok++;
    } catch (e) { console.log(`✗ ${docId}: ${e.message}`); errors++; }
  }
  console.log(`\n✓ ${ok}/${snapshotDocs.length} snapshots creados.`);
  const outFile = path.join(__dirname, `snapshot-p1-mat-1grado-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshotDocs, null, 2), 'utf8');
  console.log(`Copia local: ${outFile}`);
})().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
