/**
 * AUDITORIA: Numero de lista incorrecto por grupo.
 *
 * Reporte: en 2-3 TM hay 47 alumnos pero el ultimo aparece como #49.
 *
 * Origen del bug: el "numero de lista" NO es un campo persistido. Se calcula
 * como `index + 1` despues de filtrar (estatus ACTIVO o vacio) y ordenar
 * por nombreCompleto. Si state.students.length > alumnos reales, hay
 * documentos extra que estan colandose en el filtro.
 *
 * Este script:
 *   1. Lee TODA la coleccion students
 *   2. Replica el filtro del frontend: estatus === '' || estatus === 'ACTIVO'
 *   3. Agrupa por groupId
 *   4. Para CADA grupo, lista alumnos con el mismo orden que ve el docente
 *   5. Detecta duplicados (mismo expediente, mismo nombreCompleto, mismo curp)
 *   6. Detecta inconsistencias estatus (campo vacio mientras tiene marca de baja en otro campo)
 *   7. Imprime grupos con discrepancia
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

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  console.log('🔎 Cargando datos de Firestore...');
  const [studDocs, groupDocs] = await Promise.all([
    listAll('students'),
    listAll('groups'),
  ]);

  // Mapa de grupos
  const groupsById = {};
  for (const g of groupDocs) {
    const id = g.name.split('/').pop();
    const data = parseFields(g.fields);
    groupsById[id] = { id, ...data };
  }

  // Parsear alumnos
  const all = studDocs.map(d => ({
    docId: d.name.split('/').pop(),
    ...parseFields(d.fields),
  }));

  console.log(`📊 Total docs en students: ${all.length}`);
  console.log(`📊 Total grupos en groups: ${groupDocs.length}`);
  console.log('');

  // Aplicar filtro del frontend: estatus === '' || estatus === 'ACTIVO'
  const visibles = all.filter(s => {
    const e = (s.estatus || '').toString().toUpperCase().trim();
    return e === '' || e === 'ACTIVO';
  });

  console.log(`✅ Alumnos visibles (estatus ACTIVO o vacio): ${visibles.length}`);
  console.log(`❌ Alumnos NO visibles (baja, otro estatus): ${all.length - visibles.length}`);
  console.log('');

  // Agrupar por groupId
  const byGroup = {};
  for (const s of visibles) {
    const gid = s.groupId || '_SIN_GRUPO_';
    if (!byGroup[gid]) byGroup[gid] = [];
    byGroup[gid].push(s);
  }

  // Ordenar y reportar
  const reportes = [];
  for (const [gid, alumnos] of Object.entries(byGroup)) {
    const group = groupsById[gid];
    const sorted = alumnos.slice().sort((a, b) =>
      (a.nombreCompleto || '').localeCompare(b.nombreCompleto || '')
    );

    // Detectar duplicados por expediente
    const byExp = {};
    for (const a of sorted) {
      const k = (a.expediente || '').trim();
      if (!k) continue;
      if (!byExp[k]) byExp[k] = [];
      byExp[k].push(a);
    }
    const dupsExpediente = Object.entries(byExp).filter(([k, v]) => v.length > 1);

    // Detectar duplicados por nombreCompleto normalizado
    const byName = {};
    for (const a of sorted) {
      const k = norm(a.nombreCompleto || '');
      if (!k) continue;
      if (!byName[k]) byName[k] = [];
      byName[k].push(a);
    }
    const dupsNombre = Object.entries(byName).filter(([k, v]) => v.length > 1);

    // Detectar duplicados por CURP
    const byCurp = {};
    for (const a of sorted) {
      const k = (a.curp || '').trim().toUpperCase();
      if (!k) continue;
      if (!byCurp[k]) byCurp[k] = [];
      byCurp[k].push(a);
    }
    const dupsCurp = Object.entries(byCurp).filter(([k, v]) => v.length > 1);

    reportes.push({
      gid,
      groupName: group?.nombre || gid,
      grado: group?.grado,
      turno: group?.turno,
      count: sorted.length,
      sorted,
      dupsExpediente,
      dupsNombre,
      dupsCurp,
    });
  }

  // Orden por turno → grado → grupo
  reportes.sort((a, b) =>
    (a.turno || '').localeCompare(b.turno || '') ||
    (Number(a.grado) || 0) - (Number(b.grado) || 0) ||
    (a.groupName || '').localeCompare(b.groupName || '')
  );

  // Imprimir reporte
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  REPORTE POR GRUPO');
  console.log('═══════════════════════════════════════════════════════════');
  let totalDups = 0;
  let problematicos = 0;
  for (const r of reportes) {
    const hasDup = r.dupsExpediente.length || r.dupsNombre.length || r.dupsCurp.length;
    const marca = hasDup ? '⚠️ ' : '   ';
    console.log(`${marca}${r.groupName.padEnd(8)} (${r.turno || '?'}) → ${r.count} alumnos visibles${hasDup ? ' [DUPLICADOS DETECTADOS]' : ''}`);
    if (hasDup) {
      problematicos++;
      if (r.dupsExpediente.length) {
        console.log(`     ↳ ${r.dupsExpediente.length} duplicado(s) por expediente:`);
        r.dupsExpediente.forEach(([exp, dups]) => {
          console.log(`        EXP "${exp}":`);
          dups.forEach(d => {
            console.log(`          - docId=${d.docId} nombre="${d.nombreCompleto}" estatus="${d.estatus || ''}" curp="${d.curp || ''}"`);
            totalDups++;
          });
        });
      }
      if (r.dupsNombre.length) {
        console.log(`     ↳ ${r.dupsNombre.length} duplicado(s) por nombre:`);
        r.dupsNombre.forEach(([nom, dups]) => {
          console.log(`        NOMBRE "${nom}":`);
          dups.forEach(d => {
            console.log(`          - docId=${d.docId} exp="${d.expediente || ''}" estatus="${d.estatus || ''}" curp="${d.curp || ''}"`);
          });
        });
      }
      if (r.dupsCurp.length) {
        console.log(`     ↳ ${r.dupsCurp.length} duplicado(s) por CURP:`);
        r.dupsCurp.forEach(([curp, dups]) => {
          console.log(`        CURP "${curp}":`);
          dups.forEach(d => {
            console.log(`          - docId=${d.docId} nombre="${d.nombreCompleto}" exp="${d.expediente || ''}" estatus="${d.estatus || ''}"`);
          });
        });
      }
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  RESUMEN GLOBAL');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Grupos analizados: ${reportes.length}`);
  console.log(`Grupos con duplicados: ${problematicos}`);
  console.log(`Docs duplicados (excedentes a borrar): ${totalDups}`);

  // ENFOQUE en 2-3 TM
  const target = reportes.find(r => r.groupName === '2-3' && (r.turno || '').toUpperCase().includes('MAT')) ||
                 reportes.find(r => r.groupName === '2-3');
  if (target) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  FOCO: ${target.groupName} (${target.turno})`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total visible: ${target.count}`);
    console.log('Lista en orden alfabetico (orden que ve el docente en my-lists.js):');
    target.sorted.forEach((s, i) => {
      console.log(`  ${(i + 1).toString().padStart(3)}. exp=${(s.expediente || '').padEnd(8)} estatus="${s.estatus || ''}" docId=${s.docId.padEnd(25)} ${s.nombreCompleto}`);
    });
  }

  // Validacion adicional: alumnos cuyo groupId no existe en groups
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VALIDACIONES ADICIONALES');
  console.log('═══════════════════════════════════════════════════════════');
  const orphans = visibles.filter(s => s.groupId && !groupsById[s.groupId]);
  console.log(`Alumnos con groupId que no existe en groups: ${orphans.length}`);
  if (orphans.length > 0) {
    orphans.slice(0, 10).forEach(s => {
      console.log(`  - docId=${s.docId} groupId="${s.groupId}" nombre="${s.nombreCompleto}"`);
    });
  }

  const sinGroup = visibles.filter(s => !s.groupId);
  console.log(`Alumnos visibles sin groupId: ${sinGroup.length}`);
  if (sinGroup.length > 0) {
    sinGroup.slice(0, 10).forEach(s => {
      console.log(`  - docId=${s.docId} nombre="${s.nombreCompleto}"`);
    });
  }
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
