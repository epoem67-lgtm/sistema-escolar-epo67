/**
 * PRE-FLIGHT DRY-RUN para la migración de calificaciones del agente externo.
 *
 * Lee extracted-grades.json y verifica match contra Firestore SIN escribir.
 * Reporta:
 *   - Matches exitosos (exact / fuzzy alto)
 *   - Matches fuzzy bajos (warn)
 *   - Matches fallidos (error)
 *
 * Uso:
 *   node scripts/migrations/preflight-grades-migration.js
 *
 * Salidas:
 *   /tmp/preflight-grades-report.json   — resumen
 *   /tmp/preflight-grades-failures.json — items que NO se pudieron matchear
 *   /tmp/preflight-grades-fuzzy.json    — items con similitud <0.95 (revisar)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const GRADES_PATH = '/Users/oliolix/Documents/PROYECTOS CLAUDE/Agente de limpieza de datos calificación/output/extracted-grades.json';

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function req(urlPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'firestore.googleapis.com', path: urlPath, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d ? JSON.parse(d) : {});
        else reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
      });
    }).on('error', reject);
  });
}

async function listAll(coll) {
  const out = []; let pt = null;
  do {
    let url = `${BASE}/${coll}?pageSize=300`;
    if (pt) url += `&pageToken=${pt}`;
    const res = await req(url);
    if (res.documents) out.push(...res.documents);
    pt = res.nextPageToken || null;
  } while (pt);
  return out;
}

function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = v.doubleValue;
    else if ('booleanValue' in v) o[k] = v.booleanValue;
  }
  return o;
}

// ─── Normalización ───
function norm(s) {
  if (!s) return '';
  return String(s).toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Jaccard sobre tokens
function similarity(a, b) {
  const ta = new Set(norm(a).split(' ').filter(t => t.length > 1));
  const tb = new Set(norm(b).split(' ').filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter(x => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

function findStudent(target, students) {
  const tn = norm(target);
  // Exact
  for (const s of students) {
    const candidates = [
      s.nombreCompleto,
      s.apellido1 ? `${s.apellido1} ${s.apellido2 || ''} ${s.nombres || ''}`.trim() : null
    ].filter(Boolean);
    if (candidates.some(c => norm(c) === tn)) {
      return { match: s, score: 1.0, mode: 'exact' };
    }
  }
  // Fuzzy
  let best = { score: 0 }, bestS = null;
  for (const s of students) {
    const candidate = s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
    const sc = similarity(target, candidate);
    if (sc > best.score) { best = { score: sc }; bestS = s; }
  }
  return bestS && best.score >= 0.7 ? { match: bestS, score: best.score, mode: 'fuzzy' } : null;
}

function findSubject(targetName, grado, subjects) {
  const tn = norm(targetName);
  // Exact en mismo grado
  for (const s of subjects.filter(x => String(x.grado) === String(grado))) {
    if (norm(s.nombre) === tn) return { match: s, score: 1.0, mode: 'exact' };
  }
  // Fuzzy en mismo grado
  let best = { score: 0 }, bestS = null;
  for (const s of subjects.filter(x => String(x.grado) === String(grado))) {
    const sc = similarity(targetName, s.nombre);
    if (sc > best.score) { best = { score: sc }; bestS = s; }
  }
  return bestS && best.score >= 0.5 ? { match: bestS, score: best.score, mode: 'fuzzy' } : null;
}

function findGroup(turno, groupKey, groups) {
  // groupKey ej: "1-1"
  const norm1 = (s) => String(s || '').replace(/\s/g, '').toUpperCase();
  for (const g of groups) {
    if (g.turno === turno && norm1(g.nombre) === norm1(groupKey)) {
      return g;
    }
  }
  return null;
}

async function main() {
  console.log('🔍 PRE-FLIGHT — Migración de Calificaciones\n');

  // Cargar payload
  const data = JSON.parse(fs.readFileSync(GRADES_PATH, 'utf8'));
  const grades = data.grades;
  console.log(`📦 Calificaciones a migrar: ${grades.length}`);

  // Cargar entidades del sistema
  console.log('📋 Cargando entidades del sistema...');
  const [stuRaw, subRaw, grpRaw] = await Promise.all([
    listAll('students'), listAll('subjects'), listAll('groups')
  ]);
  const students = stuRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(s => s.estatus !== 'BAJA');
  const subjects = subRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const groups   = grpRaw.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  console.log(`   ${students.length} alumnos activos, ${subjects.length} materias, ${groups.length} grupos\n`);

  const stats = {
    total: grades.length, matched: 0, unmatched: 0,
    studentExact: 0, studentFuzzy: 0, studentFail: 0,
    subjectExact: 0, subjectFuzzy: 0, subjectFail: 0,
    groupFail: 0
  };
  const failures = [];
  const fuzzy = [];
  const subjectMatches = {};   // contar variantes
  const studentMatches = {};

  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    const grp = findGroup(g.turno, g.groupKey, groups);
    if (!grp) {
      stats.groupFail++;
      failures.push({ idx: i, reason: 'group_not_found', turno: g.turno, groupKey: g.groupKey, student: g.studentFullName, subject: g.subjectName });
      continue;
    }

    // Filtrar alumnos por grupo (más rápido y preciso)
    const grpStudents = students.filter(s => s.groupId === grp.id);
    const stuRes = findStudent(g.studentFullName, grpStudents);
    if (!stuRes) {
      stats.studentFail++;
      failures.push({ idx: i, reason: 'student_not_found', turno: g.turno, group: g.groupKey, student: g.studentFullName });
      continue;
    }
    if (stuRes.mode === 'exact') stats.studentExact++; else stats.studentFuzzy++;
    studentMatches[g.studentFullName] = (studentMatches[g.studentFullName] || 0) + 1;

    const subRes = findSubject(g.subjectName, g.grado, subjects);
    if (!subRes) {
      stats.subjectFail++;
      failures.push({ idx: i, reason: 'subject_not_found', subject: g.subjectName, grado: g.grado, student: g.studentFullName });
      continue;
    }
    if (subRes.mode === 'exact') stats.subjectExact++; else stats.subjectFuzzy++;
    subjectMatches[`${g.subjectName} (G${g.grado})`] = subjectMatches[`${g.subjectName} (G${g.grado})`] || { matched: subRes.match.nombre, score: subRes.score, count: 0 };
    subjectMatches[`${g.subjectName} (G${g.grado})`].count++;

    // Reportar fuzzy débil (<0.95)
    if (stuRes.score < 0.95 || subRes.score < 0.95) {
      fuzzy.push({
        idx: i,
        student: g.studentFullName, studentMatched: stuRes.match.nombreCompleto || `${stuRes.match.apellido1} ${stuRes.match.apellido2} ${stuRes.match.nombres}`, studentScore: +stuRes.score.toFixed(2),
        subject: g.subjectName, subjectMatched: subRes.match.nombre, subjectScore: +subRes.score.toFixed(2),
        partial: g.partial, cal: g.cal
      });
    }

    stats.matched++;
  }
  stats.unmatched = stats.total - stats.matched;

  // Reportes
  fs.writeFileSync('/tmp/preflight-grades-report.json', JSON.stringify({ stats, subjectMatches }, null, 2));
  fs.writeFileSync('/tmp/preflight-grades-failures.json', JSON.stringify(failures, null, 2));
  fs.writeFileSync('/tmp/preflight-grades-fuzzy.json', JSON.stringify(fuzzy.slice(0, 200), null, 2));

  console.log('═══════════════════════════════════════');
  console.log(`✅ Matched:   ${stats.matched} / ${stats.total} (${(stats.matched/stats.total*100).toFixed(1)}%)`);
  console.log(`❌ Unmatched: ${stats.unmatched}`);
  console.log('');
  console.log('Detalle:');
  console.log(`  Alumnos:  exact=${stats.studentExact}  fuzzy=${stats.studentFuzzy}  fail=${stats.studentFail}`);
  console.log(`  Materias: exact=${stats.subjectExact}  fuzzy=${stats.subjectFuzzy}  fail=${stats.subjectFail}`);
  console.log(`  Grupos:   fail=${stats.groupFail}`);
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('📄 Reportes:');
  console.log('   /tmp/preflight-grades-report.json   (resumen)');
  console.log('   /tmp/preflight-grades-failures.json (los que NO matchearon)');
  console.log('   /tmp/preflight-grades-fuzzy.json    (top 200 fuzzy <0.95)');

  // Top variantes de materias con fuzzy
  console.log('');
  console.log('🔤 Variantes de materia con fuzzy (revisar):');
  Object.entries(subjectMatches)
    .filter(([_, v]) => v.score < 0.95)
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 15)
    .forEach(([k, v]) => console.log(`   ${k} → ${v.matched} [${v.score.toFixed(2)}] (${v.count}x)`));
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
