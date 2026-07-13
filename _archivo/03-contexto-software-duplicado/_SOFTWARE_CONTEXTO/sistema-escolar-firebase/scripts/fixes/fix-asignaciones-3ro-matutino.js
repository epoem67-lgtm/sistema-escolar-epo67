/**
 * Corrige asignaciones de 3° MATUTINO:
 *   - DISENO DIGITAL: Paco (Francisco) en los 3 grupos (3-1, 3-2, 3-3)
 *   - ACTIVIDADES ARTISTICAS Y CULTURALES III: Claudia en los 2 grupos que la tengan
 *
 * Uso:
 *   cd sistema-escolar-firebase
 *   DRY_RUN=1 node scripts/fixes/fix-asignaciones-3ro-matutino.js   # solo reporta
 *   node scripts/fixes/fix-asignaciones-3ro-matutino.js             # aplica cambios
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN = process.env.DRY_RUN === '1';
const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;

const config = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
));
const token = config.tokens.access_token;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'firestore.googleapis.com', path: urlPath, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const r = https.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d ? JSON.parse(d) : {});
        else reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 300)}`));
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function listAll(coll) {
  const out = []; let pt = null;
  do {
    let url = `${BASE}/${coll}?pageSize=300`;
    if (pt) url += `&pageToken=${pt}`;
    const res = await req('GET', url);
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

function toFields(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: v } : { doubleValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN\n' : '🚀 Aplicando cambios\n');

  const [teachersDocs, subjectsDocs, groupsDocs, assignmentsDocs] =
    await Promise.all(['teachers', 'subjects', 'groups', 'assignments'].map(listAll));

  const teachers = teachersDocs.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const subjects = subjectsDocs.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const groups   = groupsDocs.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));
  const assignments = assignmentsDocs.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Paco = CRUZ GARCIA FRANCISCO JESUS (turno AMBOS)
  const pacoT = teachers.find(t => /\bFRANCISCO\b/.test(norm(t.nombre)) && /\bCRUZ\b/.test(norm(t.nombre)));
  // Claudia = TORRES MORENO CLAUDIA IVONE (turno AMBOS, la que puede impartir en los dos turnos)
  const claudiaT = teachers.find(t => /\bTORRES\b/.test(norm(t.nombre)) && /\bCLAUDIA\b/.test(norm(t.nombre)));

  console.log('Paco:', pacoT ? `${pacoT.id} ${pacoT.nombre} (${pacoT.turno})` : 'NO ENCONTRADO');
  console.log('Claudia:', claudiaT ? `${claudiaT.id} ${claudiaT.nombre} (${claudiaT.turno})` : 'NO ENCONTRADA');

  if (!pacoT || !claudiaT) { console.error('❌ Falta maestro'); return; }

  // Buscar materias 3er grado
  const disenoDigital = subjects.find(s => String(s.grado) === '3' && /DISENO DIGITAL/.test(norm(s.nombre)));
  const artisticas = subjects.find(s => String(s.grado) === '3' &&
    /ACTIVIDADES ARTISTICAS/.test(norm(s.nombre)));

  console.log(`\nDiseño Digital: ${disenoDigital ? disenoDigital.id + ' — ' + disenoDigital.nombre : 'NO ENCONTRADA'}`);
  console.log(`Actividades Artísticas: ${artisticas ? artisticas.id + ' — ' + artisticas.nombre : 'NO ENCONTRADA'}`);

  if (!disenoDigital || !artisticas) { console.error('\n❌ Falta alguna materia'); return; }

  // Grupos 3° AMBOS TURNOS
  const grupos3 = groups
    .filter(g => String(g.grado) === '3' && (g.turno === 'MATUTINO' || g.turno === 'VESPERTINO'))
    .sort((a, b) => (a.turno || '').localeCompare(b.turno || '') || (a.nombre || '').localeCompare(b.nombre || ''));

  console.log(`\nGrupos 3°:`);
  grupos3.forEach(g => console.log(`  - ${g.id} ${g.nombre} (${g.turno})`));

  if (grupos3.length === 0) { console.error('\n❌ No hay grupos de 3°'); return; }

  // Plan de cambios
  const plan = [];

  for (const grp of grupos3) {
    // Diseño Digital → Paco
    plan.push({
      teacher: pacoT, subject: disenoDigital, group: grp,
      desc: `Diseño Digital en ${grp.turno} ${grp.nombre} → ${pacoT.nombre}`
    });
    // Actividades Artísticas → Claudia
    plan.push({
      teacher: claudiaT, subject: artisticas, group: grp,
      desc: `Actividades Artísticas III en ${grp.turno} ${grp.nombre} → ${claudiaT.nombre}`
    });
  }

  console.log('\n══════════════ PLAN ══════════════');
  plan.forEach((p, i) => console.log(`${i + 1}. ${p.desc}`));
  console.log('══════════════════════════════════\n');

  if (DRY_RUN) { console.log('(DRY RUN — no se aplicaron cambios)'); return; }

  let ok = 0, err = 0;
  for (const p of plan) {
    const asgId = `${p.teacher.id}_${p.group.id}_${p.subject.id}`;
    const data = {
      teacherId: p.teacher.id,
      teacherName: p.teacher.nombre,
      subjectId: p.subject.id,
      subjectName: p.subject.nombre,
      groupId: p.group.id,
      groupName: p.group.nombre,
      grado: 3,
      turno: p.group.turno
    };
    try {
      // Borrar cualquier asignación previa para ese (subject, group) con DISTINTO teacher
      const prev = assignments.filter(a =>
        a.subjectId === p.subject.id && a.groupId === p.group.id && a.teacherId !== p.teacher.id
      );
      for (const old of prev) {
        await req('DELETE', `${BASE}/assignments/${encodeURIComponent(old.id)}`);
        console.log(`  🗑  Borrada previa: ${old.id} (${old.teacherName})`);
      }

      // Crear/actualizar con ID determinístico (PATCH = crea si no existe, sobrescribe si sí)
      await req('PATCH', `${BASE}/assignments/${encodeURIComponent(asgId)}`,
        JSON.stringify({ fields: toFields(data) }));
      console.log(`  ✓ ${p.desc}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ Error en ${p.desc}: ${e.message}`);
      err++;
    }
  }

  console.log(`\n✅ ${ok} aplicadas, ${err} errores`);
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
