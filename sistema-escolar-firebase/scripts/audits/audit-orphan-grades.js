/**
 * Detecta grades huérfanos / mal-migrados:
 *   - subjectId prefix (G1_/G2_/G3_) NO concuerda con grade.grado
 *   - grade.groupId apunta a un grupo de OTRO grado distinto al subjectId
 *
 * Ejemplo real: Erik (3°) tiene grade con subjectId=G2_temas_selectos_*
 * pero groupId=VESPERTINO_3-3 grado=3. Es un dato corrupto que aparece
 * duplicado en tiras/preboletas porque el subjectId trae nombre IV pero
 * pertenece a otro semestre.
 *
 * Output: CSV con todos los huérfanos para que Olivia decida limpiar.
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
      r.setEncoding('utf8');
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
  }
  return o;
}

function gradeFromSubjectId(sid) {
  const m = String(sid || '').match(/^G(\d)_/);
  return m ? Number(m[1]) : null;
}

function gradeFromGroupId(gid) {
  // formato: TURNO_GRADO-GRUPO  ej. VESPERTINO_3-3 → 3
  const m = String(gid || '').match(/_(\d)-/);
  return m ? Number(m[1]) : null;
}

(async () => {
  console.log('Cargando grades y students...');
  const [grades, students, groups, subjects] = await Promise.all([
    listAll('grades'),
    listAll('students'),
    listAll('groups'),
    listAll('subjects'),
  ]);

  const studentMap = {};
  students.forEach(d => {
    const id = d.name.split('/').pop();
    studentMap[id] = parseFields(d.fields);
  });
  const groupMap = {};
  groups.forEach(d => {
    const id = d.name.split('/').pop();
    groupMap[id] = parseFields(d.fields);
  });
  const subjectMap = {};
  subjects.forEach(d => {
    const id = d.name.split('/').pop();
    subjectMap[id] = parseFields(d.fields);
  });

  console.log(`Total grades: ${grades.length}\n`);

  const orphans = [];
  const orphanTypes = {
    'subjectId_vs_grade_grado': 0,    // subjectId G2 pero grade.grado=3
    'subjectId_vs_groupId': 0,         // subjectId G2 pero groupId=VESP_3-X
    'subjectId_unknown': 0,            // subjectId no existe en subjects
    'student_grupo_mismatch': 0,       // grade.groupId ≠ student.groupId actual
  };

  for (const d of grades) {
    const g = parseFields(d.fields);
    const docId = d.name.split('/').pop();
    const gradeFromSubj = gradeFromSubjectId(g.subjectId);
    const gradeFromGroup = gradeFromGroupId(g.groupId);
    const stu = studentMap[g.studentId];
    const stuActualGroupId = stu ? (stu.groupId || stu.grupo) : null;
    const stuActualGrade = stuActualGroupId ? gradeFromGroupId(stuActualGroupId) : null;

    const issues = [];

    // 1. subjectId.grado ≠ grade.grado
    if (gradeFromSubj && g.grado && gradeFromSubj !== Number(g.grado)) {
      issues.push(`subjectId(${gradeFromSubj}) ≠ grade.grado(${g.grado})`);
      orphanTypes.subjectId_vs_grade_grado++;
    }

    // 2. subjectId.grado ≠ groupId.grado
    if (gradeFromSubj && gradeFromGroup && gradeFromSubj !== gradeFromGroup) {
      issues.push(`subjectId(${gradeFromSubj}) ≠ groupId(${gradeFromGroup})`);
      orphanTypes.subjectId_vs_groupId++;
    }

    // 3. subjectId no existe en subjects
    if (g.subjectId && !subjectMap[g.subjectId]) {
      issues.push(`subjectId no existe en subjects`);
      orphanTypes.subjectId_unknown++;
    }

    // 4. grade.groupId ≠ student.groupId actual (cambió de grupo)
    if (stuActualGroupId && g.groupId && g.groupId !== stuActualGroupId) {
      // Solo reportar si es de grado distinto (cambio de año)
      if (stuActualGrade && gradeFromGroup && stuActualGrade !== gradeFromGroup) {
        issues.push(`alumno ahora en ${stuActualGroupId}, grade tiene groupId=${g.groupId}`);
        orphanTypes.student_grupo_mismatch++;
      }
    }

    if (issues.length > 0) {
      orphans.push({
        docId,
        studentId: g.studentId,
        alumno: stu?.nombreCompleto || '',
        subjectId: g.subjectId,
        subjectName: g.subjectName || subjectMap[g.subjectId]?.nombre || '',
        partial: g.partial,
        groupId: g.groupId,
        grado: g.grado,
        cal: g.cal,
        suma: g.suma,
        ec: g.ec, tr: g.tr, pe: g.pe,
        issues,
      });
    }
  }

  console.log(`📊 Total grades huérfanos detectados: ${orphans.length}\n`);
  console.log(`Por tipo:`);
  Object.entries(orphanTypes).forEach(([t, n]) => console.log(`   ${t}: ${n}`));
  console.log();

  // Agrupar por tipo de huérfano
  const sample = orphans.slice(0, 30);
  console.log(`Primeros ${sample.length} casos:\n`);
  sample.forEach((o, i) => {
    console.log(`${i+1}. ${o.alumno} (${o.studentId.slice(0,8)})`);
    console.log(`   docId: ${o.docId}`);
    console.log(`   subjectId: ${o.subjectId} (${o.subjectName})`);
    console.log(`   groupId: ${o.groupId} · grade.grado: ${o.grado} · partial: ${o.partial}`);
    console.log(`   cal: ${o.cal}, suma: ${o.suma}`);
    console.log(`   issues: ${o.issues.join(' | ')}`);
    console.log();
  });

  // Stats por alumno
  const byStudent = {};
  orphans.forEach(o => {
    if (!byStudent[o.studentId]) byStudent[o.studentId] = { alumno: o.alumno, count: 0 };
    byStudent[o.studentId].count++;
  });
  const topStudents = Object.entries(byStudent)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15);
  console.log(`Top 15 alumnos con más huérfanos:`);
  topStudents.forEach(([sid, info]) => {
    console.log(`   ${info.alumno || sid}: ${info.count}`);
  });

  // CSV completo
  const csvFile = path.join(__dirname, 'orphan-grades.csv');
  const lines = ['docId,studentId,alumno,subjectId,subjectName,partial,groupId,grado,cal,suma,ec,tr,pe,issues'];
  orphans.forEach(o => {
    lines.push([
      o.docId, o.studentId,
      `"${(o.alumno || '').replace(/"/g, '""')}"`,
      o.subjectId,
      `"${(o.subjectName || '').replace(/"/g, '""')}"`,
      o.partial || '', o.groupId || '', o.grado || '',
      o.cal ?? '', o.suma ?? '',
      o.ec ?? '', o.tr ?? '', o.pe ?? '',
      `"${o.issues.join(' | ').replace(/"/g, '""')}"`,
    ].join(','));
  });
  fs.writeFileSync(csvFile, lines.join('\n'), 'utf8');
  console.log(`\nCSV: ${csvFile}`);

  // JSON para uso del fix
  fs.writeFileSync(path.join(__dirname, 'orphan-grades.json'), JSON.stringify(orphans, null, 2), 'utf8');
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
