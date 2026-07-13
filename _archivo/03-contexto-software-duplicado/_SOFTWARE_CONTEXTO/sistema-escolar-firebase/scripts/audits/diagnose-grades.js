#!/usr/bin/env node
/**
 * diagnose-grades.js — Diagnóstico de calificaciones con rubros fuera de escala
 * y alumnos eliminados que necesitan restauración.
 *
 * Uso:
 *   node diagnose-grades.js
 *
 * Prerequisito:
 *   Token en /tmp/firebase-access-token.txt
 *   (firebase login:ci → copiar token al archivo)
 */

const https = require('https');
const fs = require('fs');

const PROJECT_ID = 'epo67-sistema';
const BASE = `firestore.googleapis.com`;
const DB_PATH = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ═══════════════════════════════════════════════════════════
// REGLAS DE RUBROS POR TURNO (de constants.js)
// ═══════════════════════════════════════════════════════════

const RUBROS_MATUTINO = { ec: 8, tr: 2, pe: 10 };
const RUBROS_VESPERTINO = { ec: 5, ex: 3, tr: 2, pe: 10 };

function getToken() {
  try {
    return fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
  } catch {
    console.error('ERROR: No se encontró /tmp/firebase-access-token.txt');
    console.error('Ejecuta: cd sistema-escolar-firebase && npx firebase login:ci');
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════
// FIRESTORE REST HELPERS
// ═══════════════════════════════════════════════════════════

function firestoreGet(token, collectionPath, pageToken) {
  return new Promise((resolve, reject) => {
    let url = `${DB_PATH}/${collectionPath}?pageSize=300`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const req = https.request({
      hostname: BASE,
      path: url,
      headers: { 'Authorization': 'Bearer ' + token }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${d.substring(0, 200)}`));
          return;
        }
        resolve(JSON.parse(d));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAllDocs(token, collection) {
  const docs = [];
  let pageToken = null;
  do {
    const result = await firestoreGet(token, collection, pageToken);
    if (result.documents) {
      docs.push(...result.documents);
    }
    pageToken = result.nextPageToken || null;
  } while (pageToken);
  return docs;
}

function parseDoc(doc) {
  const id = doc.name.split('/').pop();
  const fields = doc.fields || {};
  const parsed = { id };
  for (const [key, val] of Object.entries(fields)) {
    if (val.stringValue !== undefined) parsed[key] = val.stringValue;
    else if (val.integerValue !== undefined) parsed[key] = Number(val.integerValue);
    else if (val.doubleValue !== undefined) parsed[key] = Number(val.doubleValue);
    else if (val.booleanValue !== undefined) parsed[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) parsed[key] = val.timestampValue;
    else if (val.nullValue !== undefined) parsed[key] = null;
    else if (val.mapValue) {
      const map = {};
      if (val.mapValue.fields) {
        for (const [mk, mv] of Object.entries(val.mapValue.fields)) {
          if (mv.stringValue !== undefined) map[mk] = mv.stringValue;
          else if (mv.integerValue !== undefined) map[mk] = Number(mv.integerValue);
          else if (mv.doubleValue !== undefined) map[mk] = Number(mv.doubleValue);
          else map[mk] = JSON.stringify(mv);
        }
      }
      parsed[key] = map;
    }
  }
  return parsed;
}

// ═══════════════════════════════════════════════════════════
// DIAGNÓSTICO PRINCIPAL
// ═══════════════════════════════════════════════════════════

async function main() {
  const token = getToken();

  console.log('═══════════════════════════════════════════════════');
  console.log(' DIAGNÓSTICO DE CALIFICACIONES — EPO 67');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Fetch all data
  console.log('Descargando datos de Firestore...');
  const [gradeDocs, studentDocs, groupDocs, logDocs] = await Promise.all([
    fetchAllDocs(token, 'grades'),
    fetchAllDocs(token, 'students'),
    fetchAllDocs(token, 'groups'),
    fetchAllDocs(token, 'activityLog')
  ]);

  const grades = gradeDocs.map(parseDoc);
  const students = studentDocs.map(parseDoc);
  const groups = groupDocs.map(parseDoc);
  const logs = logDocs.map(parseDoc);

  console.log(`  Calificaciones: ${grades.length}`);
  console.log(`  Alumnos: ${students.length}`);
  console.log(`  Grupos: ${groups.length}`);
  console.log(`  Logs: ${logs.length}\n`);

  // Build lookups
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });
  const groupMap = {};
  groups.forEach(g => { groupMap[g.id] = g; });

  // ═══════════════════════════════════════════════════════════
  // PARTE 1: Calificaciones con rubros fuera de escala
  // ═══════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════');
  console.log(' PARTE 1: RUBROS FUERA DE ESCALA');
  console.log('═══════════════════════════════════════════════════\n');

  const badGrades = [];
  const rubroKeys = ['ec', 'ex', 'tr', 'pe'];

  for (const grade of grades) {
    const group = groupMap[grade.groupId];
    const turno = group?.turno || group?.turn || '';
    const isVespertino = turno.toUpperCase().includes('VESPERT');
    const maximos = isVespertino ? RUBROS_VESPERTINO : RUBROS_MATUTINO;

    let hasError = false;
    const errors = [];

    for (const key of rubroKeys) {
      const val = grade[key];
      if (val === undefined || val === null || val === '') continue;
      const numVal = Number(val);
      const max = maximos[key];

      if (max === undefined) {
        // rubro que no aplica a este turno (ej: ex para matutino)
        if (key === 'ex' && !isVespertino) continue;
        continue;
      }

      if (numVal > max) {
        hasError = true;
        errors.push({ key, value: numVal, max, turno: isVespertino ? 'VESPERTINO' : 'MATUTINO' });
      }
    }

    // Also check suma > 10
    if (grade.suma !== undefined && Number(grade.suma) > 10) {
      hasError = true;
      errors.push({ key: 'suma', value: Number(grade.suma), max: 10 });
    }

    if (hasError) {
      const student = studentMap[grade.studentId];
      badGrades.push({
        gradeId: grade.id,
        studentId: grade.studentId,
        studentName: student?.nombreCompleto || student?.nombre || 'ALUMNO ELIMINADO',
        groupId: grade.groupId,
        groupName: group?.nombre || group?.grupo || grade.groupId,
        turno: isVespertino ? 'VESPERTINO' : 'MATUTINO',
        subjectId: grade.subjectId,
        partial: grade.partial,
        currentRubros: {
          ec: grade.ec, ex: grade.ex, tr: grade.tr, pe: grade.pe,
          suma: grade.suma, cal: grade.cal, value: grade.value
        },
        errors,
        calDefinitiva: grade.cal || grade.value
      });
    }
  }

  console.log(`Calificaciones con rubros fuera de escala: ${badGrades.length}\n`);

  if (badGrades.length > 0) {
    // Group by type of error
    const scaleOver100 = badGrades.filter(g => g.errors.some(e => e.value > 10 && e.key !== 'suma'));
    const sumaOver10 = badGrades.filter(g => g.errors.some(e => e.key === 'suma'));
    const rubroOverMax = badGrades.filter(g => g.errors.some(e => e.value <= 10 && e.value > e.max && e.key !== 'suma'));

    console.log(`  → Rubros con escala sobre 10 (posible escala 0-100): ${scaleOver100.length}`);
    console.log(`  → Suma mayor a 10: ${sumaOver10.length}`);
    console.log(`  → Rubros que exceden su máximo por turno (pero ≤10): ${rubroOverMax.length}\n`);

    // Show first 20 examples
    console.log('--- DETALLE (primeros 30 registros) ---\n');
    badGrades.slice(0, 30).forEach((g, i) => {
      console.log(`[${i + 1}] ${g.studentName} | ${g.groupName} (${g.turno}) | ${g.subjectId} | ${g.partial}`);
      console.log(`    Rubros actuales: ec=${g.currentRubros.ec ?? '-'} ex=${g.currentRubros.ex ?? '-'} tr=${g.currentRubros.tr ?? '-'} pe=${g.currentRubros.pe ?? '-'}`);
      console.log(`    Suma=${g.currentRubros.suma ?? '-'} Cal=${g.currentRubros.cal ?? '-'} Value=${g.currentRubros.value ?? '-'}`);
      g.errors.forEach(e => {
        console.log(`    ⚠️  ${e.key}=${e.value} excede máximo=${e.max}`);
      });
      console.log('');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PARTE 2: Alumnos eliminados con calificaciones huérfanas
  // ═══════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════');
  console.log(' PARTE 2: ALUMNOS ELIMINADOS');
  console.log('═══════════════════════════════════════════════════\n');

  // Find orphan grades (studentId not in students collection)
  const orphanStudentIds = new Set();
  for (const grade of grades) {
    if (!studentMap[grade.studentId]) {
      orphanStudentIds.add(grade.studentId);
    }
  }

  console.log(`Alumnos eliminados con calificaciones huérfanas: ${orphanStudentIds.size}\n`);

  // Find in audit log
  const deletionLogs = logs.filter(l =>
    l.action === 'eliminar' && l.entity === 'alumno'
  );

  console.log(`Registros de eliminación en bitácora: ${deletionLogs.length}\n`);

  // Match orphans with audit log
  const restorable = [];
  for (const studentId of orphanStudentIds) {
    const auditEntry = deletionLogs.find(l => l.entityId === studentId);
    const orphanGrades = grades.filter(g => g.studentId === studentId);

    const info = {
      studentId,
      gradesCount: orphanGrades.length,
      partials: [...new Set(orphanGrades.map(g => g.partial))],
      groups: [...new Set(orphanGrades.map(g => g.groupId))],
    };

    if (auditEntry?.before) {
      info.fromAudit = true;
      info.nombre = auditEntry.before.nombre || auditEntry.before;
      info.grupo = auditEntry.before.grupo;
      info.np = auditEntry.before.np;
      info.curp = auditEntry.before.curp;
      info.turno = auditEntry.before.turno;
      info.deletedBy = auditEntry.userEmail;
      info.deletedAt = auditEntry.date || auditEntry.timestamp;
    } else {
      info.fromAudit = false;
      // Try to get group name from grades
      const firstGrade = orphanGrades[0];
      const group = groupMap[firstGrade?.groupId];
      info.groupName = group?.nombre || group?.grupo || 'DESCONOCIDO';
    }

    restorable.push(info);
  }

  if (restorable.length > 0) {
    console.log('--- DETALLE DE ALUMNOS ELIMINADOS ---\n');
    restorable.forEach((r, i) => {
      console.log(`[${i + 1}] ID: ${r.studentId}`);
      if (r.fromAudit) {
        console.log(`    Nombre: ${typeof r.nombre === 'object' ? JSON.stringify(r.nombre) : r.nombre}`);
        console.log(`    Grupo: ${r.grupo} | NP: ${r.np || 'N/A'} | CURP: ${r.curp || 'N/A'}`);
        console.log(`    Eliminado por: ${r.deletedBy} el ${r.deletedAt}`);
      } else {
        console.log(`    (Sin datos en bitácora — datos parciales de calificaciones)`);
        console.log(`    Grupo(s): ${r.groups.join(', ')}`);
      }
      console.log(`    Calificaciones huérfanas: ${r.gradesCount} (parciales: ${r.partials.join(', ')})`);
      console.log('');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // RESUMEN
  // ═══════════════════════════════════════════════════════════

  console.log('═══════════════════════════════════════════════════');
  console.log(' RESUMEN');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total calificaciones analizadas: ${grades.length}`);
  console.log(`  Calificaciones con errores de escala: ${badGrades.length}`);
  console.log(`  Alumnos eliminados con calificaciones: ${orphanStudentIds.size}`);
  console.log(`  Recuperables desde bitácora: ${restorable.filter(r => r.fromAudit).length}`);
  console.log(`  Sin datos en bitácora: ${restorable.filter(r => !r.fromAudit).length}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Save full report as JSON
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalGrades: grades.length,
      badGrades: badGrades.length,
      orphanStudents: orphanStudentIds.size,
      restorableFromAudit: restorable.filter(r => r.fromAudit).length
    },
    badGrades,
    deletedStudents: restorable
  };

  fs.writeFileSync('./diagnose-report.json', JSON.stringify(report, null, 2));
  console.log('Reporte completo guardado en: diagnose-report.json');
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
