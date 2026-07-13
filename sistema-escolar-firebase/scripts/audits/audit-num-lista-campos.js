/**
 * AUDITORIA EXTENDIDA: que campos contiene el student doc?
 *
 * Hipotesis: el usuario ve "49" en algun lugar. Como el array de 2-3 TM
 * solo tiene 47, el 49 podria venir de:
 *   - campo "expediente" (matricula)
 *   - campo "np" o "numLista" o "lista" en el doc
 *   - campo "folio"
 *   - algun reporte que use enrollments en vez de students
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
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) o[k] = v.booleanValue;
    else if ('timestampValue' in v) o[k] = v.timestampValue;
    else if ('nullValue' in v) o[k] = null;
  }
  return o;
}

async function main() {
  console.log('🔎 Cargando students...');
  const studDocs = await listAll('students');

  // Conjunto de campos presentes
  const allFields = new Set();
  for (const d of studDocs) {
    for (const k of Object.keys(d.fields || {})) {
      allFields.add(k);
    }
  }
  console.log('Campos en docs student:', Array.from(allFields).sort());
  console.log('');

  // Buscar alumnos del grupo 2-3 TM
  console.log('🔎 Buscando grupo 2-3 MATUTINO...');
  const groupDocs = await listAll('groups');
  const g23m = groupDocs
    .map(g => ({ id: g.name.split('/').pop(), ...parseFields(g.fields) }))
    .find(g => g.nombre === '2-3' && (g.turno || '').toUpperCase().includes('MAT'));
  console.log('Grupo 2-3 TM:', g23m);
  console.log('');

  // Listar TODOS los alumnos del 2-3 TM con sus campos completos
  const alumnos23m = studDocs
    .map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(s => s.groupId === g23m.id);
  console.log(`Alumnos con groupId=${g23m.id}: ${alumnos23m.length}`);
  console.log('');

  // Imprimir TODOS los alumnos con sus campos
  alumnos23m
    .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''))
    .forEach((s, i) => {
      console.log(`#${(i + 1).toString().padStart(2)} | nombre="${s.nombreCompleto}"`);
      console.log(`     expediente="${s.expediente || ''}" folio="${s.folio || ''}" np="${s.np || ''}" numLista="${s.numLista || ''}" estatus="${s.estatus || ''}" curp="${s.curp || ''}"`);
    });

  // Verificar enrollments collection
  console.log('');
  console.log('🔎 Verificando coleccion enrollments...');
  try {
    const enrollments = await listAll('enrollments');
    console.log(`Total enrollments: ${enrollments.length}`);
    const enrl23m = enrollments
      .map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }))
      .filter(e => e.groupId === g23m.id);
    console.log(`Enrollments del 2-3 TM: ${enrl23m.length}`);
    if (enrl23m.length > 0) {
      console.log('Campos de enrollment 0:', Object.keys(enrl23m[0]));
      console.log('Muestra:', enrl23m[0]);
    }
  } catch (e) {
    console.log('No hay coleccion enrollments o error:', e.message);
  }

  // Verificar si hay students con groupId NULL o vacio que tengan asignacion al 2-3
  console.log('');
  console.log('🔎 Buscando docs adicionales del 2-3 TM en otras formas...');
  const allParsed = studDocs.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Por grupo nombre
  const byGroupName = allParsed.filter(s =>
    (s.grupo === '2-3' || s.grupoNombre === '2-3') &&
    (s.turno || '').toUpperCase().includes('MAT')
  );
  console.log(`Por campo "grupo" o "grupoNombre" === '2-3' + matutino: ${byGroupName.length}`);
  if (byGroupName.length !== alumnos23m.length) {
    console.log('⚠️  Discrepancia! Hay alumnos asignados al 2-3 por nombre pero no por groupId.');
    byGroupName.forEach(s => {
      if (!alumnos23m.find(a => a.docId === s.docId)) {
        console.log(`  + EXTRA: ${s.docId} groupId="${s.groupId}" nombre="${s.nombreCompleto}"`);
      }
    });
  }
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
