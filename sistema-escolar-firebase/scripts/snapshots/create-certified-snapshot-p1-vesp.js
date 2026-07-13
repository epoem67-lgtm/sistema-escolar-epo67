/**
 * SNAPSHOT CERTIFICADO — P1 VESPERTINO (8 grupos verificados contra orientación)
 *
 * Crea documentos inmutables en Firestore con:
 *   - Estado exacto de cada grade al momento de la verificación
 *   - Timestamp UTC + autor (Olivia)
 *   - Hash SHA256 de los valores para detectar manipulación
 *   - Fuente de verificación (Excel orientación, fecha del archivo)
 *   - SUMA + CAL + FALTAS + rubros (ec, tr, pe, ex) de cada alumno × materia
 *
 * Estos snapshots viven en la colección `certifiedSnapshots/` y son
 * SOLO-LECTURA (firestore.rules bloquea cualquier update/delete).
 *
 * Si después alguien modifica un grade, el script `verify-against-snapshot.js`
 * detecta la divergencia instantáneamente y reporta qué cambió.
 *
 * USO:
 *   node scripts/snapshots/create-certified-snapshot-p1-vesp.js           # dry-run
 *   node scripts/snapshots/create-certified-snapshot-p1-vesp.js --apply   # crea snapshots
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

// Grupos verificados al 100% contra Excel orientación (P1)
const VERIFIED_GROUPS = [
  { groupId: 'VESPERTINO_1-1', verifiedBy: 'orientación', verifiedFromFile: 'CALIFICACIONES PRIMERA_2O. SEM. (1).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_1-2', verifiedBy: 'orientación', verifiedFromFile: 'CALIFICACIONES PRIMERA_2O. SEM. (1).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_1-3', verifiedBy: 'orientación', verifiedFromFile: '1er eval_2do sem_25-26 (2).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_2-1', verifiedBy: 'orientación', verifiedFromFile: 'CALIF. 1ER PARCIAL MAR 2026 (3).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_2-2', verifiedBy: 'orientación', verifiedFromFile: 'concentrado primer parcial (3).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_2-3', verifiedBy: 'orientación', verifiedFromFile: 'concentrado primer parcial (3).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_3-1', verifiedBy: 'orientación', verifiedFromFile: '1er eval_2do sem_25-26 (2).xlsx', verifiedDate: '2026-06-02' },
  { groupId: 'VESPERTINO_3-2', verifiedBy: 'orientación', verifiedFromFile: 'CALIF. 1ER PARCIAL MAR 2026 (3).xlsx', verifiedDate: '2026-06-02' },
  // VESPERTINO_3-3: NO se incluye porque tiene 8 pendientes (Franco)
];

const PARTIAL = 'P1';

function reqGet(p) {
  return new Promise((res, rej) => {
    https.get({ hostname: 'firestore.googleapis.com', path: p,
      headers: { 'Authorization': 'Bearer ' + token } }, (r) => {
      r.setEncoding('utf8');  // FIX: sin esto los chunks UTF-8 multibyte se rompen
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
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej);
    req.write(data); req.end();
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
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (Array.isArray(v)) {
      out[k] = { arrayValue: { values: v.map(x => toFirestoreFields({ x }).x).filter(Boolean) } };
    } else if (typeof v === 'object') {
      out[k] = { mapValue: { fields: toFirestoreFields(v) } };
    }
  }
  return out;
}

(async () => {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}\n`);
  console.log(`Generando snapshots para ${VERIFIED_GROUPS.length} grupos verificados (P1)\n`);

  const [students, grades] = await Promise.all([
    listAll('students'),
    listAll('grades'),
  ]);
  const studentMap = {};
  students.forEach(d => {
    const id = d.name.split('/').pop();
    studentMap[id] = parseFields(d.fields);
  });

  let totalGradesSnapshot = 0;
  const snapshotDocs = [];

  for (const groupCfg of VERIFIED_GROUPS) {
    const { groupId, verifiedBy, verifiedFromFile, verifiedDate } = groupCfg;
    const gids = [groupId];
    const studentsInGroup = Object.entries(studentMap)
      .filter(([_, s]) => gids.includes(s.groupId || s.grupo))
      .filter(([_, s]) => {
        const e = (s.estatus || '').toString().toUpperCase().trim();
        return e === '' || e === 'ACTIVO';
      });
    const stuIds = new Set(studentsInGroup.map(([id]) => id));

    const groupGrades = grades
      .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
      .filter(g => g.partial === PARTIAL && stuIds.has(g.studentId));

    // Estructura del snapshot: array de objetos { docId, studentId, subjectId, ec, tr, pe, ex, suma, cal, value, faltas }
    const items = groupGrades.map(g => ({
      docId: g.id,
      studentId: g.studentId,
      studentName: studentMap[g.studentId]?.nombreCompleto || '',
      subjectId: g.subjectId,
      subjectName: g.subjectName || '',
      teacherId: g.teacherId || '',
      teacherName: g.teacherName || '',
      ec: g.ec ?? null,
      tr: g.tr ?? null,
      pe: g.pe ?? null,
      ex: g.ex ?? null,
      suma: g.suma ?? null,
      cal: g.cal ?? null,
      value: g.value ?? null,
      faltas: g.faltas ?? null,
    })).sort((a, b) => (a.studentId + a.subjectId).localeCompare(b.studentId + b.subjectId));

    // Hash SHA256 del JSON canónico de los items
    const canonical = JSON.stringify(items);
    const hash = crypto.createHash('sha256').update(canonical).digest('hex');

    const snapshot = {
      groupId,
      partial: PARTIAL,
      verifiedBy,
      verifiedFromFile,
      verifiedDate,
      certifiedAt: new Date().toISOString(),
      certifiedByUid: 'oliepo67-script',
      certifiedByName: 'Olivia Peña (script de auditoría)',
      itemCount: items.length,
      hash,
      items, // todos los grades como evidencia
    };

    const docId = `${groupId}_${PARTIAL}_${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
    snapshotDocs.push({ docId, snapshot });
    totalGradesSnapshot += items.length;

    console.log(`📸 ${groupId} P1 — ${items.length} grades · hash: ${hash.slice(0, 16)}...`);
  }

  console.log(`\nTotal grades en snapshots: ${totalGradesSnapshot}`);
  console.log(`Total snapshots a crear: ${snapshotDocs.length}\n`);

  if (DRY_RUN) {
    console.log('(dry-run completo — sin crear documentos. Corre con --apply.)');
    // Save a local backup of the snapshots for evidence
    const outFile = path.join(__dirname, 'preview-snapshot-p1-vesp.json');
    fs.writeFileSync(outFile, JSON.stringify(snapshotDocs, null, 2), 'utf8');
    console.log(`Preview guardado en: ${outFile}`);
    return;
  }

  // Apply: crear los documentos en certifiedSnapshots/{docId}
  let ok = 0, errors = 0;
  for (const { docId, snapshot } of snapshotDocs) {
    try {
      const url = `${BASE}/certifiedSnapshots/${encodeURIComponent(docId)}`;
      await reqPatch(url, { fields: toFirestoreFields(snapshot) });
      console.log(`✓ certifiedSnapshots/${docId}`);
      ok++;
    } catch (e) {
      console.log(`✗ ERROR ${docId}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`✓ Snapshots creados: ${ok}/${snapshotDocs.length}`);
  console.log(`✗ Errores: ${errors}`);

  // También guardar copia local
  const outFile = path.join(__dirname, `snapshot-p1-vesp-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshotDocs, null, 2), 'utf8');
  console.log(`Copia local: ${outFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
