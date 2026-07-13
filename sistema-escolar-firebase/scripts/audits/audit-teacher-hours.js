/**
 * Auditoria de HORAS IMPARTIDAS del semestre (coleccion teacherHours).
 * Detecta valores raros por docente / materia / grupo.
 *
 * Reglas de "raro":
 *   - total semestral > 180  (matematicas ~90-100 normal, ninguna materia real >180)
 *   - total semestral == 0 y hay grades capturadas
 *   - algun mes con valor > 40 (max sensato ~30h/mes)
 *   - total < 20 en materias con calificaciones capturadas
 *
 * Uso:
 *   node scripts/audits/audit-teacher-hours.js
 *   node scripts/audits/audit-teacher-hours.js --teacher=daniela
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
const TOKEN = cfg.tokens.access_token;
const PROJECT = 'epo67-sistema';

const filter = (process.argv.find(a => a.startsWith('--teacher=')) || '').split('=')[1] || '';
const filterNrm = norm(filter);

function norm(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { Authorization: 'Bearer ' + TOKEN } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0,200))); }
      });
    }).on('error', rej);
  });
}

async function getAll(coll) {
  const out = []; let pt = null;
  do {
    let url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
    if (pt) url += '&pageToken=' + pt;
    const j = await get(url);
    if (j.documents) out.push(...j.documents);
    pt = j.nextPageToken;
  } while (pt);
  return out;
}

function val(doc, field) {
  const v = doc.fields?.[field];
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  return null;
}

(async () => {
  console.log('Leyendo teacherHours, teachers, subjects, groups, grades ...');
  const [hours, teachers, subjects, groups, grades] = await Promise.all([
    getAll('teacherHours'),
    getAll('teachers'),
    getAll('subjects'),
    getAll('groups'),
    getAll('grades'),
  ]);
  console.log(`  teacherHours: ${hours.length}`);
  console.log(`  teachers: ${teachers.length}`);
  console.log(`  subjects: ${subjects.length}`);
  console.log(`  groups: ${groups.length}`);
  console.log(`  grades: ${grades.length}`);

  const tById = {};
  teachers.forEach(t => {
    const id = t.name.split('/').pop();
    tById[id] = { id, nombre: val(t, 'nombre') || '', turno: val(t, 'turno') || '' };
  });
  const sById = {};
  subjects.forEach(s => {
    const id = s.name.split('/').pop();
    sById[id] = { id, nombre: val(s, 'nombre') || val(s, 'name') || id };
  });
  const gById = {};
  groups.forEach(g => {
    const id = g.name.split('/').pop();
    gById[id] = { id, nombre: val(g, 'nombre') || id, turno: val(g, 'turno') || '' };
  });

  // Grades presence: (groupId, subjectId) -> count
  const gradesKey = new Set();
  grades.forEach(g => {
    const gid = val(g, 'groupId'); const sid = val(g, 'subjectId');
    if (gid && sid) gradesKey.add(gid + '||' + sid);
  });

  const MESES = ['febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio'];

  const rows = [];
  hours.forEach(doc => {
    const docId = doc.name.split('/').pop();
    const teacherId = val(doc, 'teacherId');
    const groupId = val(doc, 'groupId');
    const subjectId = val(doc, 'subjectId');
    const partial = val(doc, 'partial') || val(doc, 'parcial') || '';

    const meses = {};
    let total = 0;
    MESES.forEach(m => {
      const v = doc.fields?.[m];
      const n = v ? (parseInt(v.integerValue) || parseFloat(v.doubleValue) || 0) : 0;
      meses[m] = n; total += n;
    });
    // Fallback: some docs store total directly
    const totalCampo = val(doc, 'total') || val(doc, 'horasTotal');
    if (total === 0 && totalCampo) total = totalCampo;

    const t = tById[teacherId] || { nombre: '(desconocido)', turno: '' };
    const s = sById[subjectId] || { nombre: subjectId || '(sin materia)' };
    const g = gById[groupId] || { nombre: groupId || '(sin grupo)', turno: '' };

    // filter
    if (filterNrm && !norm(t.nombre).includes(filterNrm)) return;

    const tieneGrades = gradesKey.has(groupId + '||' + subjectId);
    const mesMax = Math.max(...MESES.map(m => meses[m]));
    const flags = [];
    if (total > 180) flags.push('TOTAL>180');
    if (total === 0 && tieneGrades) flags.push('CERO_CON_GRADES');
    if (total > 0 && total < 20 && tieneGrades) flags.push('MUY_BAJO');
    if (mesMax > 40) flags.push('MES>40');

    rows.push({
      docId, teacherId, teacher: t.nombre, turno: t.turno || g.turno,
      groupId, group: g.nombre, subjectId, subject: s.nombre,
      partial, ...meses, total, flags: flags.join('|'), tieneGrades,
    });
  });

  // Sort: worst first
  rows.sort((a, b) => (b.flags ? 1 : 0) - (a.flags ? 1 : 0) || b.total - a.total);

  // Top 20 totales globales (para ver los mas altos aunque no crucen umbral)
  const topTot = [...rows].sort((a,b) => b.total - a.total).slice(0, 20);
  console.log('\n=== TOP 20 TOTALES MAS ALTOS (todos los docs) ===');
  topTot.forEach(r => {
    console.log(`  total=${r.total.toString().padStart(4)} · ${r.turno.padEnd(10)} · ${r.teacher.padEnd(50)} · ${r.group} · ${r.subject} · ${r.partial}`);
  });

  const raros = rows.filter(r => r.flags);
  console.log(`\n=== HORAS RARAS: ${raros.length} de ${rows.length} docs ===\n`);

  const groupByTurno = { MATUTINO: [], VESPERTINO: [], OTRO: [] };
  raros.forEach(r => {
    const t = (r.turno || '').toUpperCase();
    if (t.includes('MAT')) groupByTurno.MATUTINO.push(r);
    else if (t.includes('VESP')) groupByTurno.VESPERTINO.push(r);
    else groupByTurno.OTRO.push(r);
  });

  ['VESPERTINO', 'MATUTINO', 'OTRO'].forEach(turno => {
    const list = groupByTurno[turno];
    if (!list.length) return;
    console.log(`\n--- ${turno} (${list.length}) ---`);
    list.forEach(r => {
      console.log(`  [${r.flags}] ${r.teacher} · ${r.group} · ${r.subject}`);
      console.log(`      total=${r.total}  feb=${r.febrero} mar=${r.marzo} abr=${r.abril} may=${r.mayo} jun=${r.junio} jul=${r.julio}  parcial=${r.partial}  doc=${r.docId}`);
    });
  });

  // CSV
  const csvPath = path.join(__dirname, 'audit-teacher-hours.csv');
  const header = 'flags,turno,teacher,group,subject,total,febrero,marzo,abril,mayo,junio,julio,partial,tieneGrades,docId,teacherId,groupId,subjectId';
  const lines = [header, ...rows.map(r => [
    r.flags, r.turno, r.teacher, r.group, r.subject, r.total,
    r.febrero, r.marzo, r.abril, r.mayo, r.junio, r.julio,
    r.partial, r.tieneGrades, r.docId, r.teacherId, r.groupId, r.subjectId,
  ].map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))];
  fs.writeFileSync(csvPath, lines.join('\n'));
  console.log(`\nCSV completo: ${csvPath}`);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
