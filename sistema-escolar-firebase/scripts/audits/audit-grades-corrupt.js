/**
 * Cuenta grades con subjectIds corruptos (encoding) en todos los grupos.
 * Encontramos `G1_pensamiento_filos��fico_y_humanidades_ii` en 1-2 TM.
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
  console.log('Cargando grades + subjects...');
  const [gradeDocs, subjDocs] = await Promise.all([listAll('grades'), listAll('subjects')]);

  const subjIds = new Set(subjDocs.map(d => d.name.split('/').pop()));
  console.log(`Subjects validos: ${subjIds.size}`);
  console.log(`Total grades: ${gradeDocs.length}`);

  // Detectar todos los subjectIds en grades
  const subjectIdsEnGrades = {};
  const grades = gradeDocs.map(d => ({ docId: d.name.split('/').pop(), ...parseFields(d.fields) }));

  for (const g of grades) {
    const sid = g.subjectId || '_NULL_';
    if (!subjectIdsEnGrades[sid]) subjectIdsEnGrades[sid] = { count: 0, groups: new Set() };
    subjectIdsEnGrades[sid].count++;
    if (g.groupId) subjectIdsEnGrades[sid].groups.add(g.groupId);
  }

  // Identificar huerfanos (subjectId que no existe en subjects)
  console.log('\n═══ SUBJECT IDs HUERFANOS en grades ═══');
  const huerfanos = Object.entries(subjectIdsEnGrades).filter(([sid, _]) => !subjIds.has(sid));
  let totalGradesHuerfanos = 0;
  huerfanos.forEach(([sid, info]) => {
    console.log(`\n⚠️  ${JSON.stringify(sid)}`);
    console.log(`   Grades afectados: ${info.count}`);
    console.log(`   Grupos: ${[...info.groups].join(', ')}`);
    totalGradesHuerfanos += info.count;
  });
  console.log(`\nTOTAL grades con subjectId huerfano: ${totalGradesHuerfanos}`);

  // Detectar el subjectId valido equivalente para cada huerfano
  console.log('\n═══ MATCHING a subjectId valido ═══');
  function normalize(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  }
  const validSubjMap = {};
  for (const sid of subjIds) {
    validSubjMap[normalize(sid)] = sid;
  }
  huerfanos.forEach(([sid, info]) => {
    const norm = normalize(sid);
    const valid = validSubjMap[norm];
    if (valid) {
      console.log(`\n✓ "${sid}" → mapea a "${valid}"`);
      console.log(`  Migracion sugerida: actualizar ${info.count} grades de "${sid}" → "${valid}"`);
    } else {
      console.log(`\n✗ "${sid}" → NO se pudo mapear a ningun subjectId valido`);
    }
  });
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
