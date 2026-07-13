/**
 * Cuenta TODOS los grades del 1-2 TM (sin limit) y los analiza.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

const BASE = `/v1/projects/epo67-sistema/databases/(default)/documents`;

function listAll(c) {
  return new Promise(async (resolve, reject) => {
    const out = []; let pt = null;
    try {
      do {
        let u = `${BASE}/${c}?pageSize=300`;
        if (pt) u += `&pageToken=${pt}`;
        const r = await new Promise((rs, rj) => {
          https.get({ hostname: 'firestore.googleapis.com', path: u,
            headers: { 'Authorization': 'Bearer ' + token } }, (resp) => {
            let d = ''; resp.on('data', c => d += c);
            resp.on('end', () => resp.statusCode < 300 ? rs(d ? JSON.parse(d) : {}) : rj(new Error(`HTTP ${resp.statusCode}`)));
          }).on('error', rj);
        });
        if (r.documents) out.push(...r.documents);
        pt = r.nextPageToken || null;
      } while (pt);
      resolve(out);
    } catch (e) { reject(e); }
  });
}

function parseFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f || {})) {
    if ('stringValue' in v) o[k] = v.stringValue;
    else if ('integerValue' in v) o[k] = Number(v.integerValue);
    else if ('doubleValue' in v) o[k] = Number(v.doubleValue);
  }
  return o;
}

async function main() {
  const TARGET = 'MATUTINO_1-2';
  const gradeDocs = await listAll('grades');
  const all = gradeDocs.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));

  const grades12 = all.filter(g => g.groupId === TARGET);
  console.log(`Grades del ${TARGET}: ${grades12.length}`);

  // Distribucion por subjectId
  const bySubject = {};
  for (const g of grades12) {
    const sid = g.subjectId || '_NULL_';
    bySubject[sid] = (bySubject[sid] || 0) + 1;
  }
  console.log('\nSubjectIds usados en grades del 1-2 TM:');
  Object.entries(bySubject).sort().forEach(([sid, count]) => {
    const hasWeirdChar = /[^\x00-\x7F]/.test(sid);
    const marker = hasWeirdChar ? '⚠️ ' : '   ';
    console.log(`${marker} ${count.toString().padStart(4)}x ${sid}`);
  });

  // Distribucion por partial
  const byPartial = {};
  for (const g of grades12) {
    byPartial[g.partial || '_NULL_'] = (byPartial[g.partial || '_NULL_'] || 0) + 1;
  }
  console.log('\nPartials:', byPartial);

  // Buscar duplicados (mismo studentId + subjectId + partial)
  const groups = {};
  for (const g of grades12) {
    const key = `${g.studentId}|${g.subjectId}|${g.partial}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(g);
  }
  const dups = Object.entries(groups).filter(([k, v]) => v.length > 1);
  console.log(`\nDuplicados (mismo studentId+subjectId+partial): ${dups.length}`);
  if (dups.length > 0) {
    dups.slice(0, 10).forEach(([k, v]) => {
      console.log(`  ${k}:`);
      v.forEach(g => console.log(`    docId=${g.docId} cal=${g.cal} suma=${g.suma}`));
    });
  }

  // Buscar campos extranos en docs
  console.log('\n═══ Campos no estandar en docs ═══');
  const STANDARD = new Set(['groupId', 'studentId', 'subjectId', 'partial', 'cal', 'value', 'suma',
                            'ec', 'tr', 'pe', 'ex', 'faltas', 'updatedAt', 'updatedBy',
                            'correctionFolio', 'previousCal', 'migratedFrom', 'turno']);
  const camposExtras = new Set();
  for (const g of grades12) {
    for (const k of Object.keys(g)) {
      if (!STANDARD.has(k) && k !== 'docId') camposExtras.add(k);
    }
  }
  console.log('Campos extra encontrados:', [...camposExtras]);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
