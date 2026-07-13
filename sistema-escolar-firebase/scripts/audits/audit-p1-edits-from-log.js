/**
 * AUDITORÍA P1 vía activityLog — detectar SAVES POST-CIERRE
 *
 * Recorre activityLog filtrando entries de 'calificacion' P1 con timestamp
 * POSTERIOR a la fecha de cierre del Parcial 1 (P1 lockedAt/closedAt).
 *
 * Cada entry representa un guardado completo de UNA lista (grupo+materia).
 * Reportamos qué listas se modificaron tras el cierre y por quién — esos
 * son los posibles puntos de discrepancia con las F1 ya entregadas.
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
    if (v.stringValue !== undefined) o[k] = v.stringValue;
    else if (v.integerValue !== undefined) o[k] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) o[k] = Number(v.doubleValue);
    else if (v.booleanValue !== undefined) o[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) o[k] = v.timestampValue;
  }
  return o;
}

(async () => {
  console.log('Cargando partials...');
  const partialsDocs = await listAll('partials');
  const p1Doc = partialsDocs.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) })).find(p => p.id === 'P1');
  const p1ClosedAt = p1Doc ? (p1Doc.closedAt || p1Doc.lockedAt) : null;
  const closedMs = p1ClosedAt ? new Date(p1ClosedAt).getTime() : null;
  console.log(`P1 cerrado: ${p1ClosedAt}\n`);

  console.log('Cargando activityLog (puede tardar)...');
  const log = await listAll('activityLog');
  console.log(`Total entries activityLog: ${log.length}\n`);

  const entries = log.map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }));

  // Filtrar: entity='calificacion' o 'calificación', entityId contiene _P1, timestamp > closedMs
  const postCierre = entries.filter(e => {
    const isCal = (e.entity || '').toLowerCase().startsWith('calificaci');
    if (!isCal) return false;
    if (!e.entityId || !e.entityId.endsWith('_P1')) return false;
    if (!e.timestamp) return false;
    const ts = new Date(e.timestamp).getTime();
    return ts > closedMs;
  });

  console.log(`Saves a listas de P1 DESPUÉS del cierre: ${postCierre.length}\n`);

  // Agrupar por entityId (lista)
  const byList = {};
  for (const e of postCierre) {
    const key = e.entityId;
    if (!byList[key]) byList[key] = [];
    byList[key].push(e);
  }

  console.log(`Listas P1 únicas modificadas post-cierre: ${Object.keys(byList).length}\n`);

  // CSV
  const csvFile = path.join(__dirname, 'audit-p1-edits-from-log.csv');
  const headers = ['entityId', 'lista_descripcion', 'fecha_cambio', 'usuario', 'rol', 'descripcion_save'];
  const rows = [headers.join(',')];

  // Listas ordenadas por # de saves
  const sorted = Object.entries(byList).sort((a, b) => b[1].length - a[1].length);

  console.log('LISTAS P1 MODIFICADAS POST-CIERRE:\n');
  sorted.forEach(([entityId, ev]) => {
    // Parse entityId: TURNO_GRUPO_subjectId_P1
    const m = entityId.match(/^([^_]+)_([^_]+)_(.+)_P1$/);
    const desc = m ? `${m[1]} ${m[2]} ${m[3]}` : entityId;
    console.log(`📋 ${desc}`);
    console.log(`   (${ev.length} guardado(s) post-cierre)`);
    ev.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(e => {
      const fecha = new Date(e.timestamp).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      console.log(`   - ${fecha} · ${e.userName || e.userEmail} (${e.userRole})`);
      console.log(`     ${e.description || ''}`);
      rows.push([
        entityId,
        `"${desc.replace(/"/g, '""')}"`,
        e.timestamp,
        `"${(e.userName || e.userEmail || '').replace(/"/g, '""')}"`,
        e.userRole || '',
        `"${(e.description || '').replace(/"/g, '""')}"`,
      ].join(','));
    });
    console.log();
  });

  fs.writeFileSync(csvFile, rows.join('\n'), 'utf8');
  console.log(`CSV: ${csvFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
