/**
 * AUDITORIA: verifica cuantos grupos tienen `np` con saltos
 * (es decir, np maximo != cantidad de alumnos) — esto es lo que causa
 * que la N.L. salga mal en las boletas.
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
  }
  return o;
}

async function main() {
  const [studDocs, groupDocs] = await Promise.all([listAll('students'), listAll('groups')]);
  const groupsById = {};
  for (const g of groupDocs) {
    const id = g.name.split('/').pop();
    groupsById[id] = { id, ...parseFields(g.fields) };
  }

  const all = studDocs.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));
  // Solo ACTIVOS
  const visibles = all.filter(s => {
    const e = (s.estatus || '').toString().toUpperCase().trim();
    return e === '' || e === 'ACTIVO';
  });

  // Agrupar
  const byGroup = {};
  for (const s of visibles) {
    const gid = s.groupId || '_SIN_GRUPO_';
    if (!byGroup[gid]) byGroup[gid] = [];
    byGroup[gid].push(s);
  }

  const reports = [];
  for (const [gid, alumnos] of Object.entries(byGroup)) {
    const g = groupsById[gid];
    const sorted = alumnos.slice().sort((a, b) =>
      (a.nombreCompleto || '').localeCompare(b.nombreCompleto || '')
    );
    const count = sorted.length;
    const nps = sorted.map(s => Number(s.np)).filter(n => Number.isFinite(n) && n > 0);
    const maxNp = nps.length ? Math.max(...nps) : 0;
    const minNp = nps.length ? Math.min(...nps) : 0;
    const huecos = maxNp - count;

    // Detectar mismatch: posicion alfabetica vs np
    let positionMismatch = 0;
    sorted.forEach((s, i) => {
      const np = Number(s.np);
      if (Number.isFinite(np) && np !== (i + 1)) positionMismatch++;
    });

    reports.push({
      groupName: g?.nombre || gid,
      turno: g?.turno || '?',
      grado: g?.grado || 0,
      count,
      minNp,
      maxNp,
      huecos, // diferencia entre el np mas alto y el conteo real
      positionMismatch,
    });
  }

  reports.sort((a, b) =>
    (a.turno || '').localeCompare(b.turno || '') ||
    (Number(a.grado) || 0) - (Number(b.grado) || 0) ||
    (a.groupName || '').localeCompare(b.groupName || '')
  );

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(' GRUPO  TURNO       ALUMNOS  np_MIN  np_MAX  HUECOS  POSICION_DESALINEADA');
  console.log('═══════════════════════════════════════════════════════════════════════');
  for (const r of reports) {
    const marca = r.huecos > 0 || r.positionMismatch > 0 ? '⚠️' : ' ';
    console.log(`${marca}  ${r.groupName.padEnd(4)}  ${r.turno.padEnd(10)}  ${String(r.count).padStart(6)}  ${String(r.minNp).padStart(6)}  ${String(r.maxNp).padStart(6)}  ${String(r.huecos).padStart(6)}  ${String(r.positionMismatch).padStart(20)}`);
  }
  console.log('');
  console.log('LEYENDA:');
  console.log('  HUECOS              = (np_MAX - alumnos_visibles). >0 indica bajas que dejaron np huerfano.');
  console.log('  POSICION_DESALINEADA = #alumnos cuyo np actual no coincide con su posicion alfabetica.');
  console.log('');
  console.log('CONCLUSION:');
  console.log('  El campo np esta PERSISTIDO y NO se recalcula cuando hay bajas.');
  console.log('  boletas.js usa student.np para mostrar "N.L." en la pre-boleta.');
  console.log('  El resto del sistema (my-lists, my-f1, concentrado, attendance, paginacion alumnos)');
  console.log('  usa index+1 dinamico → muestran 1..47 correctamente.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
