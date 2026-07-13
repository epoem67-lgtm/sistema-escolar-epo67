/**
 * Para cada grade huérfano, busca si existe el "gemelo correcto":
 *   mismo studentId + partial + subject equivalente del grado actual.
 *
 * "Equivalente" se determina por el NOMBRE BASE de la materia
 * (ej. "actividades artísticas y culturales i" en G2 ≈ "actividades
 *  artísticas y culturales iii" en G3).
 *
 * Output:
 *   - safe-to-delete.json: huérfanos con gemelo correcto (seguro borrar)
 *   - need-decision.json: huérfanos SIN gemelo (Olivia decide)
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

// Normaliza nombre de materia removiendo el nivel romano final
function normalizeBaseName(nombre) {
  if (!nombre) return '';
  return String(nombre).toLowerCase()
    .replace(/\s+(i|ii|iii|iv|v|vi)$/i, '')
    .replace(/[áàäâ]/gi, 'a').replace(/[éèëê]/gi, 'e')
    .replace(/[íìïî]/gi, 'i').replace(/[óòöô]/gi, 'o')
    .replace(/[úùüû]/gi, 'u').replace(/[ñ]/gi, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  console.log('Cargando datos...');
  const orphansFile = path.join(__dirname, 'orphan-grades.json');
  if (!fs.existsSync(orphansFile)) {
    console.error('Falta orphan-grades.json. Corre primero audit-orphan-grades.js');
    process.exit(1);
  }
  const orphans = JSON.parse(fs.readFileSync(orphansFile, 'utf8'));
  const [grades, subjects] = await Promise.all([listAll('grades'), listAll('subjects')]);

  const subjectsById = {};
  subjects.forEach(d => {
    const id = d.name.split('/').pop();
    subjectsById[id] = parseFields(d.fields);
  });

  // Index grades por studentId + partial + subjectId
  const gradesByKey = {};
  grades.forEach(d => {
    const g = parseFields(d.fields);
    const key = `${g.studentId}|${g.partial}|${g.subjectId}`;
    gradesByKey[key] = { docId: d.name.split('/').pop(), ...g };
  });

  // Para cada huérfano: ¿hay un grade del MISMO student+partial con subjectId
  // del grado actual (groupId) y nombre base equivalente?
  const safeToDelete = [];
  const needDecision = [];

  for (const o of orphans) {
    const orphanSubj = subjectsById[o.subjectId];
    const orphanBaseName = normalizeBaseName(orphanSubj?.nombre || o.subjectName);
    // Buscar subject del grado correcto con el mismo nombre base
    const grupoGrado = String(o.groupId || '').match(/_(\d)-/)?.[1];
    const targetPrefix = grupoGrado ? `G${grupoGrado}_` : null;
    let twinSubjectId = null;
    let twinBaseName = null;
    if (targetPrefix) {
      for (const [sid, sdata] of Object.entries(subjectsById)) {
        if (!sid.startsWith(targetPrefix)) continue;
        if (normalizeBaseName(sdata.nombre) === orphanBaseName) {
          twinSubjectId = sid;
          twinBaseName = sdata.nombre;
          break;
        }
      }
    }
    if (!twinSubjectId) {
      needDecision.push({ ...o, reason: 'no_equivalent_subject_in_current_grado' });
      continue;
    }
    // ¿Existe grade del student en ese twin subjectId + partial?
    const twinKey = `${o.studentId}|${o.partial}|${twinSubjectId}`;
    const twin = gradesByKey[twinKey];
    if (twin && (twin.cal !== undefined && twin.cal !== null)) {
      safeToDelete.push({
        ...o,
        twinDocId: twin.docId,
        twinSubjectId,
        twinSubjectName: twinBaseName,
        twinCal: twin.cal,
        twinSuma: twin.suma,
        twinFaltas: twin.faltas,
      });
    } else {
      needDecision.push({
        ...o,
        twinSubjectId,
        twinSubjectName: twinBaseName,
        reason: 'twin_subject_exists_but_no_grade',
      });
    }
  }

  console.log(`\n📊 RESUMEN`);
  console.log(`Total huérfanos: ${orphans.length}`);
  console.log(`✅ Seguros de borrar (tienen gemelo correcto con cal): ${safeToDelete.length}`);
  console.log(`⚠️  Necesitan decisión (sin gemelo o sin cal): ${needDecision.length}\n`);

  // Show counts by partial
  const safeByPartial = {};
  safeToDelete.forEach(o => { safeByPartial[o.partial] = (safeByPartial[o.partial] || 0) + 1; });
  const decByPartial = {};
  needDecision.forEach(o => { decByPartial[o.partial] = (decByPartial[o.partial] || 0) + 1; });

  console.log(`Por parcial — seguros de borrar:`);
  Object.entries(safeByPartial).forEach(([p, n]) => console.log(`   ${p}: ${n}`));
  console.log(`\nPor parcial — necesitan decisión:`);
  Object.entries(decByPartial).forEach(([p, n]) => console.log(`   ${p}: ${n}`));

  // Sample
  if (safeToDelete.length > 0) {
    console.log(`\n=== Primeros 5 SEGUROS de borrar ===`);
    safeToDelete.slice(0, 5).forEach(o => {
      console.log(`${o.alumno} - ${o.subjectName} (huérfano cal=${o.cal})`);
      console.log(`   gemelo correcto: ${o.twinSubjectName} cal=${o.twinCal}`);
    });
  }
  if (needDecision.length > 0) {
    console.log(`\n=== Primeros 5 NECESITAN DECISIÓN ===`);
    needDecision.slice(0, 5).forEach(o => {
      console.log(`${o.alumno} - ${o.subjectName} (cal=${o.cal})`);
      console.log(`   ${o.reason}${o.twinSubjectName ? ' — twin candidato: ' + o.twinSubjectName : ''}`);
    });
  }

  fs.writeFileSync(path.join(__dirname, 'orphans-safe-to-delete.json'), JSON.stringify(safeToDelete, null, 2));
  fs.writeFileSync(path.join(__dirname, 'orphans-need-decision.json'), JSON.stringify(needDecision, null, 2));
  console.log(`\nArchivos:\n  orphans-safe-to-delete.json (${safeToDelete.length})\n  orphans-need-decision.json (${needDecision.length})`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
