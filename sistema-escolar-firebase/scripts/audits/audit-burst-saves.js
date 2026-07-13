/**
 * AUDIT: detecta "burst saves" — múltiples saves al mismo entityId en
 * <10 segundos, hechas por la misma cuenta. Este patrón NO es captura
 * humana normal y sugiere un bucle/script/migración anómala.
 *
 * Output: tabla con entityId, # saves, usuario, ventana de tiempo.
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
  const log = await listAll('activityLog');
  const entries = log
    .map(d => ({ id: d.name.split('/').pop(), ...parseFields(d.fields) }))
    .filter(e => (e.entity || '').toLowerCase().startsWith('calificaci') && e.timestamp);

  console.log(`Total activityLog entries de calificación: ${entries.length}\n`);

  // Agrupar por entityId
  const byEntity = {};
  for (const e of entries) {
    if (!byEntity[e.entityId]) byEntity[e.entityId] = [];
    byEntity[e.entityId].push(e);
  }

  // Para cada entityId, ordenar y detectar bursts (≥5 saves en ≤10 segundos)
  const bursts = [];
  for (const [eid, evs] of Object.entries(byEntity)) {
    evs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    // Sliding window
    for (let i = 0; i < evs.length; i++) {
      let j = i;
      while (j < evs.length - 1 &&
             (new Date(evs[j + 1].timestamp) - new Date(evs[i].timestamp)) <= 10000) {
        j++;
      }
      if (j - i + 1 >= 5) {
        // Burst de >=5 saves
        bursts.push({
          entityId: eid,
          count: j - i + 1,
          firstAt: evs[i].timestamp,
          lastAt: evs[j].timestamp,
          windowSec: ((new Date(evs[j].timestamp) - new Date(evs[i].timestamp)) / 1000).toFixed(2),
          user: evs[i].userName || evs[i].userEmail,
          userRole: evs[i].userRole,
        });
        i = j; // skip past this burst
      }
    }
  }

  bursts.sort((a, b) => b.count - a.count);
  console.log(`Bursts detectados (≥5 saves en ≤10s): ${bursts.length}\n`);

  // Group bursts by date for context
  const byDate = {};
  bursts.forEach(b => {
    const d = b.firstAt.split('T')[0];
    byDate[d] = (byDate[d] || 0) + 1;
  });
  console.log('Distribución por fecha:');
  Object.entries(byDate).sort().forEach(([d, n]) => console.log(`  ${d}: ${n} bursts`));
  console.log();

  // Print top 30
  console.log('TOP 30 bursts más grandes:\n');
  bursts.slice(0, 30).forEach((b, i) => {
    console.log(`${i + 1}. ${b.entityId}`);
    console.log(`   ${b.count} saves en ${b.windowSec}s · ${b.user} (${b.userRole})`);
    console.log(`   ${b.firstAt} → ${b.lastAt}`);
    console.log();
  });

  // CSV
  const csvFile = path.join(__dirname, 'audit-burst-saves.csv');
  const headers = ['entityId', 'count', 'firstAt', 'lastAt', 'windowSec', 'user', 'userRole'];
  const rows = [headers.join(',')];
  for (const b of bursts) {
    rows.push([
      b.entityId,
      b.count,
      b.firstAt,
      b.lastAt,
      b.windowSec,
      `"${(b.user || '').replace(/"/g, '""')}"`,
      b.userRole || '',
    ].join(','));
  }
  fs.writeFileSync(csvFile, rows.join('\n'), 'utf8');
  console.log(`CSV: ${csvFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
