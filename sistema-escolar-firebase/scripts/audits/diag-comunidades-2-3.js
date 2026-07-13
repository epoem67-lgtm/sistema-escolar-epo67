/**
 * DIAGNÓSTICO: Comunidades Virtuales 2-3
 *
 * Buscar:
 *   - Asignaciones con materia "Comunidades Virtuales" en grupos 2-3 (mat o vesp)
 *   - Si hay duplicadas
 *   - Quién es el teacher actual y si es Ana Isabel Correa o Juana Rangel
 *   - Si tiene marcado "cobertura" o no
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => { try { const j = data ? JSON.parse(data) : {}; if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`)); else resolve(j); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getAll(coll) {
  const out = []; let pt = null;
  do {
    let p = `/v1/projects/${PROJECT}/databases/(default)/documents/${coll}?pageSize=300`;
    if (pt) p += '&pageToken=' + pt;
    const r = await api('GET', 'firestore.googleapis.com', p);
    if (r.documents) out.push(...r.documents);
    pt = r.nextPageToken;
  } while (pt);
  return out;
}

function val(f) { if (!f) return ''; return f.stringValue || f.booleanValue || f.integerValue || ''; }
function bool(f) { return f?.booleanValue || false; }

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DIAGNOSTICO: Comunidades Virtuales 2-3');
  console.log('═══════════════════════════════════════════════════════════\n');

  const [assignments, teachers, groups, subjects] = await Promise.all([
    getAll('assignments'),
    getAll('teachers'),
    getAll('groups'),
    getAll('subjects'),
  ]);

  // Encontrar a Ana Isabel y Juana
  const tList = teachers.map(t => ({
    id: t.name.split('/').pop(),
    nombre: val(t.fields?.nombre),
    email: val(t.fields?.email),
    turno: val(t.fields?.turno),
  }));

  const anaIsabel = tList.find(t => /CORREA.*ANA|ANA.*ISABEL.*CORREA/i.test(t.nombre || ''));
  const juana = tList.find(t => /RANGEL.*JUANA|JUANA.*RANGEL/i.test(t.nombre || ''));

  console.log('👥 Docentes encontrados:');
  console.log(`   Ana Isabel Correa:  ${anaIsabel ? `✓ id=${anaIsabel.id} | ${anaIsabel.nombre} | turno=${anaIsabel.turno}` : '❌ NO ENCONTRADA'}`);
  console.log(`   Juana Rangel:       ${juana ? `✓ id=${juana.id} | ${juana.nombre} | turno=${juana.turno}` : '❌ NO ENCONTRADA'}`);

  // Buscar grupos 2-3
  const grupos23 = groups.filter(g => {
    const nombre = val(g.fields?.nombre);
    return /^2.?3$/.test(nombre.replace(/\s/g, '')) || nombre === '2-3';
  }).map(g => ({
    id: g.name.split('/').pop(),
    nombre: val(g.fields?.nombre),
    grado: val(g.fields?.grado),
    turno: val(g.fields?.turno),
  }));
  console.log(`\n📚 Grupos 2-3 encontrados:`);
  grupos23.forEach(g => console.log(`   id=${g.id} | ${g.nombre} | grado=${g.grado} | turno=${g.turno}`));

  // Buscar asignaciones de Comunidades Virtuales en 2-3
  const asgList = assignments.map(a => ({
    id: a.name.split('/').pop(),
    teacherId: val(a.fields?.teacherId),
    teacherName: val(a.fields?.teacherName),
    groupId: val(a.fields?.groupId),
    groupName: val(a.fields?.groupName),
    subjectId: val(a.fields?.subjectId),
    subjectName: val(a.fields?.subjectName),
    grado: val(a.fields?.grado),
    turno: val(a.fields?.turno),
    cobertura: bool(a.fields?.cobertura),
    interim: bool(a.fields?.interim),
    isInterim: bool(a.fields?.isInterim),
    interinato: bool(a.fields?.interinato),
  }));

  const asgComunidades23 = asgList.filter(a => {
    const sub = (a.subjectName || '').toUpperCase();
    const grp = (a.groupName || '').replace(/\s/g, '');
    return sub.includes('COMUNIDAD') && (grp === '2-3' || /^2.?3$/.test(grp));
  });

  console.log(`\n🎯 Asignaciones de "Comunidades Virtuales" en 2-3 (${asgComunidades23.length} encontradas):`);
  asgComunidades23.forEach(a => {
    console.log(`\n   📝 Asignación id=${a.id}`);
    console.log(`      teacherId:    ${a.teacherId}`);
    console.log(`      teacherName:  ${a.teacherName}`);
    console.log(`      groupName:    ${a.groupName}  (grado=${a.grado}, turno=${a.turno})`);
    console.log(`      subjectName:  ${a.subjectName}  (subjectId=${a.subjectId})`);
    console.log(`      cobertura:    ${a.cobertura}`);
    console.log(`      interim/isInterim/interinato: ${a.interim}/${a.isInterim}/${a.interinato}`);
  });

  if (asgComunidades23.length > 1) {
    console.log(`\n⚠ DUPLICADAS: hay ${asgComunidades23.length} asignaciones para la misma materia+grupo.`);
    console.log('   Esto causa que aparezca duplicada al desplegar para captura.');
  }

  // Lista TODAS las asignaciones de Ana Isabel y Juana (para referencia)
  if (anaIsabel) {
    const asgAna = asgList.filter(a => a.teacherId === anaIsabel.id);
    console.log(`\n📋 Todas las asignaciones de ANA ISABEL CORREA (${asgAna.length}):`);
    asgAna.forEach(a => console.log(`   - ${a.groupName.padEnd(8)} | ${a.subjectName.padEnd(35).slice(0, 35)} | turno=${a.turno} | cobertura=${a.cobertura}`));
  }

  if (juana) {
    const asgJuana = asgList.filter(a => a.teacherId === juana.id);
    console.log(`\n📋 Todas las asignaciones de JUANA RANGEL (${asgJuana.length}):`);
    asgJuana.forEach(a => console.log(`   - ${a.groupName.padEnd(8)} | ${a.subjectName.padEnd(35).slice(0, 35)} | turno=${a.turno} | cobertura=${a.cobertura}`));
  }

  // assignmentsByGroup (la otra colección)
  console.log('\n🔍 Verificando colección assignmentsByGroup...');
  try {
    const abg = await getAll('assignmentsByGroup');
    const matches = abg.filter(d => {
      const fields = d.fields || {};
      const sub = (val(fields.subjectName) || '').toUpperCase();
      const grp = (val(fields.groupName) || '').replace(/\s/g, '');
      return sub.includes('COMUNIDAD') && (grp === '2-3' || /^2.?3$/.test(grp));
    });
    console.log(`   ${matches.length} entradas con "Comunidades" en grupo 2-3`);
    matches.forEach(d => {
      const f = d.fields || {};
      console.log(`   📌 docId=${d.name.split('/').pop()}`);
      console.log(`      teacherId=${val(f.teacherId)} | teacherName=${val(f.teacherName)} | turno=${val(f.turno)}`);
    });
  } catch (e) {
    console.log('   (assignmentsByGroup error:', e.message, ')');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
