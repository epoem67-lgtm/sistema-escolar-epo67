/**
 * MIGRACIÓN FINAL DE CALIFICACIONES — Cotejo del agente externo
 *
 * Política confirmada por el usuario (2026-04-27):
 *   - SOBREESCRIBIR siempre (los datos del cotejo son la verdad).
 *   - SALTAR los 3 alumnos BAJA (4 grades en total).
 *   - MAPEAR manualmente:
 *       MAT 3-2 "MORALES GONZALEZ RODRIGUEZ" → MORALES GONZALEZ BRYAN ALEXANDER
 *   - Fuzzy match para nombres (>=0.7) y materias (>=0.5).
 *
 * Backup previo: grades-backup-2026-04-27T15-21-07.json (9,935 docs).
 *
 * Uso:
 *   DRY_RUN=1 node scripts/migrations/migrate-grades-final.js   # simula, no escribe
 *   node scripts/migrations/migrate-grades-final.js             # producción real
 *
 * Doc ID: {studentId}_{subjectId}_{partial}
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const GRADES_PATH = '/Users/oliolix/Documents/PROYECTOS CLAUDE/Agente de limpieza de datos calificación/output/extracted-grades.json';
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH_SIZE = 30;
const BATCH_PAUSE_MS = 1000;

// Lista de saltos manuales (alumnos BAJA en el sistema, payload los menciona pero no se migran)
const SKIP_NAMES = new Set([
  'AGUIRRE DELFIN YAHIR',           // MAT 1-2 BAJA
  'MORENO GARCIA DIEGO SANTIAGO',   // MAT 2-1 BAJA
  'ANGELES GARCIA RODRIGO HABBIBE', // MAT 2-3 BAJA
]);

// Override manual: payload name → studentId destino conocido
const MANUAL_STUDENT_MAP = {
  'MORALES GONZALEZ RODRIGUEZ': 'ygoBx5mjftzh1gmI6cMa', // → BRYAN ALEXANDER
};

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

// ─── HTTP helpers ───
function reqFull(method, urlPath, body) {
  return new Promise((res, rej) => {
    const opts = {
      hostname: 'firestore.googleapis.com', path: urlPath, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(opts, (resp) => {
      let d = '';
      resp.on('data', (c) => (d += c));
      resp.on('end', () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) res(d ? JSON.parse(d) : {});
        else rej(new Error(`HTTP ${resp.statusCode}: ${d.slice(0, 300)}`));
      });
    });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}
const reqGet = (p) => reqFull('GET', p);
async function listAll(coll) {
  const out = []; let pt = null;
  do { let url = `${BASE}/${coll}?pageSize=300`;
    if (pt) url += `&pageToken=${pt}`;
    const res = await reqGet(url);
    if (res.documents) out.push(...res.documents);
    pt = res.nextPageToken || null;
  } while (pt); return out;
}

function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = v.doubleValue;
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
  }
  return o;
}

function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (v instanceof Date) out[k] = { timestampValue: v.toISOString() };
  }
  return out;
}

// ─── Matching ───
const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const overlap = (a, b) => {
  const ta = new Set(norm(a).split(' ').filter(t => t.length > 1));
  const tb = new Set(norm(b).split(' ').filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(x => tb.has(x)).length;
  return inter / new Set([...ta, ...tb]).size;
};

function findStudent(name, groupStudents) {
  // Exact
  for (const s of groupStudents) {
    const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
    if (norm(full) === norm(name)) return { match: s, score: 1, mode: 'exact' };
  }
  // Fuzzy
  let best = null, bestScore = 0;
  for (const s of groupStudents) {
    const full = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
    const sc = overlap(name, full);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return best && bestScore >= 0.7 ? { match: best, score: bestScore, mode: 'fuzzy' } : null;
}

function findSubject(name, grado, subjects) {
  const candidates = subjects.filter(s => String(s.grado) === String(grado));
  for (const s of candidates) if (norm(s.nombre) === norm(name)) return { match: s, score: 1, mode: 'exact' };
  let best = null, bestScore = 0;
  for (const s of candidates) {
    const sc = overlap(name, s.nombre);
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  return best && bestScore >= 0.5 ? { match: best, score: bestScore, mode: 'fuzzy' } : null;
}

// ─── Main ───
async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no se escribirán cambios\n' : '🚀 MIGRACIÓN REAL\n');

  // Cargar payload
  const payload = JSON.parse(fs.readFileSync(GRADES_PATH, 'utf8'));
  const grades = payload.grades;
  console.log(`📦 Calificaciones a procesar: ${grades.length}`);

  // Cargar entidades
  console.log('📋 Cargando entidades del sistema...');
  const [stuRaw, subRaw, grpRaw, asgRaw] = await Promise.all([
    listAll('students'), listAll('subjects'), listAll('groups'), listAll('assignments')
  ]);
  const students = stuRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const subjects = subRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const groups   = grpRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const asgs     = asgRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Index assignments por groupId+subjectId para encontrar teacherId rápido
  const asgIndex = {};
  for (const a of asgs) asgIndex[`${a.groupId}_${a.subjectId}`] = a;

  console.log(`   ${students.length} alumnos, ${subjects.length} materias, ${groups.length} grupos, ${asgs.length} asignaciones\n`);

  const stats = {
    total: grades.length, ok: 0, skipped: 0, failed: 0, byManual: 0, byFuzzy: 0
  };
  const failures = [];
  const docsToWrite = [];

  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];

    // Skip BAJA
    if (SKIP_NAMES.has(g.studentFullName)) {
      stats.skipped++;
      continue;
    }

    // Grupo
    const grp = groups.find(x => x.turno === g.turno && (x.nombre || '').replace(/\s/g,'') === g.groupKey);
    if (!grp) { stats.failed++; failures.push({ idx: i, reason: 'group', g }); continue; }

    // Alumno (con override manual)
    let stu = null;
    if (MANUAL_STUDENT_MAP[g.studentFullName]) {
      stu = students.find(x => x.id === MANUAL_STUDENT_MAP[g.studentFullName]);
      if (stu) stats.byManual++;
    }
    if (!stu) {
      const grpStu = students.filter(x => x.groupId === grp.id);
      const res = findStudent(g.studentFullName, grpStu);
      if (!res) { stats.failed++; failures.push({ idx: i, reason: 'student', g }); continue; }
      stu = res.match;
      if (res.mode === 'fuzzy') stats.byFuzzy++;
    }

    // Materia
    const subRes = findSubject(g.subjectName, g.grado, subjects);
    if (!subRes) { stats.failed++; failures.push({ idx: i, reason: 'subject', g }); continue; }
    const subj = subRes.match;

    // Teacher (desde assignments)
    const asg = asgIndex[`${grp.id}_${subj.id}`];
    const teacherId = asg ? asg.teacherId : null;
    const teacherName = asg ? asg.teacherName : (g.teacherName || '');

    // Construir doc grade
    const docId = `${stu.id}_${subj.id}_${g.partial}`;
    const data = {
      studentId: stu.id,
      subjectId: subj.id,
      subjectName: subj.nombre,
      groupId: grp.id,
      turno: g.turno,
      grado: Number(g.grado),
      partial: g.partial,
      ec: g.ec != null ? Number(g.ec) : 0,
      tr: g.tr != null ? Number(g.tr) : 0,
      pe: g.pe != null ? Number(g.pe) : 0,
      suma: g.suma != null ? Number(g.suma) : 0,
      value: Number(g.value),
      cal: Number(g.cal),
      faltas: g.faltas != null ? Number(g.faltas) : 0,
      teacherId: teacherId || '',
      teacherName: teacherName || '',
      source: 'migration-cotejo-2026-04-27',
      updatedBy: 'migrate-grades-final.js',
      importedAt: new Date()
    };

    docsToWrite.push({ docId, data });
    stats.ok++;
  }

  console.log('═══════════════════ PRE-FLIGHT ═══════════════════');
  console.log(`Total payload:                ${stats.total}`);
  console.log(`✅ Listos para escribir:      ${stats.ok}`);
  console.log(`⏭  Saltados (BAJA):          ${stats.skipped}`);
  console.log(`❌ Fallaron match:            ${stats.failed}`);
  console.log(`   ↳ por mapeo manual:        ${stats.byManual}`);
  console.log(`   ↳ por fuzzy:               ${stats.byFuzzy}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (failures.length > 0) {
    fs.writeFileSync('/tmp/migration-failures.json', JSON.stringify(failures, null, 2));
    console.log(`⚠️  ${failures.length} fallos guardados en /tmp/migration-failures.json`);
  }

  if (DRY_RUN) {
    console.log('🔍 DRY RUN — no se escribió nada. Revisa stats y corre sin DRY_RUN para aplicar.');
    return;
  }

  // ─── ESCRITURA REAL ───
  console.log(`\n📤 Escribiendo ${docsToWrite.length} documentos en batches de ${BATCH_SIZE}...\n`);

  let written = 0, errors = 0;
  for (let i = 0; i < docsToWrite.length; i += BATCH_SIZE) {
    const batch = docsToWrite.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ docId, data }) => {
      try {
        await reqFull('PATCH', `${BASE}/grades/${encodeURIComponent(docId)}`,
          JSON.stringify({ fields: toFields(data) }));
        written++;
      } catch (e) {
        errors++;
        console.error(`  ❌ ${docId}: ${e.message}`);
      }
    }));
    if (written % 300 < BATCH_SIZE) console.log(`   ...${written}/${docsToWrite.length} escritos`);
    await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
  }

  console.log('\n═══════════════════ MIGRACIÓN ═══════════════════');
  console.log(`✅ Escritos: ${written}`);
  console.log(`❌ Errores:  ${errors}`);
  console.log('═══════════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('FATAL:', e.message); process.exit(1);
});
