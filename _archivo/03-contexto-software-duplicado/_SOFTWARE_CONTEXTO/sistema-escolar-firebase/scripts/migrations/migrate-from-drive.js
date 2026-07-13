/**
 * MIGRATE GRADES FROM GOOGLE DRIVE XLSX FILES TO FIRESTORE
 *
 * Reads /tmp/epo67-grades/all_grades.json (parsed from XLSX files)
 * and writes/updates grades in Firestore.
 *
 * Prerequisites:
 * 1. Run parse_grades.py to generate all_grades.json
 * 2. Get fresh Firebase access token:
 *    npx firebase-tools login:ci  (or use stored refresh token)
 *
 * Usage:
 *   node migrate-from-drive.js --dry-run   (preview only)
 *   node migrate-from-drive.js             (live write)
 */

const https = require('https');
const fs = require('fs');

// ─── CONFIG ───
const PROJECT_ID = 'epo67-sistema';
const BATCH_COMMIT_SIZE = 400; // Max 500 per Firestore batchWrite, use 400 for safety
const DRY_RUN = process.argv.includes('--dry-run');
const GRADES_FILE = '/tmp/epo67-grades/all_grades.json';
const DELAY_BETWEEN_BATCHES_MS = 2000; // 2s between batch commits

// ─── GET ACCESS TOKEN ───
function getAccessToken() {
  try {
    const token = fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
    if (token) return token;
  } catch (e) {}

  try {
    const config = JSON.parse(fs.readFileSync(
      require('os').homedir() + '/.config/configstore/firebase-tools.json', 'utf8'
    ));
    const refreshToken = config.tokens.refresh_token;
    // SECURITY: OAuth credentials must come from environment variables, never hardcoded.
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
      console.error('See .env.example for reference.');
      process.exit(1);
    }
    console.log('No access token found. Run this to refresh:');
    console.log(`curl -s -X POST "https://oauth2.googleapis.com/token" \\`);
    console.log(`  -d "grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${clientId}&client_secret=${clientSecret}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" > /tmp/firebase-access-token.txt`);
    process.exit(1);
  } catch (e) {
    console.error('Cannot find Firebase credentials');
    process.exit(1);
  }
}

const token = getAccessToken();

// ─── NORMALIZE HELPERS ───
function normalize(str) {
  if (!str) return '';
  return str.toString().toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function similarity(a, b) {
  a = normalize(a); b = normalize(b);
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wa = a.split(' ').filter(Boolean);
  const wb = b.split(' ').filter(Boolean);
  let m = 0;
  for (const w of wa) {
    if (wb.some(x => x === w || (w.length > 3 && x.startsWith(w.substring(0, 3))))) m++;
  }
  return m / Math.max(wa.length, wb.length);
}

// ─── FIRESTORE REST HELPERS ───
function firestoreRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Firestore batchWrite — up to 500 writes in a single HTTP request
function batchWrite(writes) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ writes });
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchAllDocs(collection) {
  const docs = [];
  let pageToken = '';
  do {
    const path = `${collection}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
    const result = await firestoreRequest('GET', path);
    if (result.documents) {
      for (const doc of result.documents) {
        const id = doc.name.split('/').pop();
        const fields = {};
        for (const [key, val] of Object.entries(doc.fields || {})) {
          if (val.stringValue !== undefined) fields[key] = val.stringValue;
          else if (val.integerValue !== undefined) fields[key] = parseInt(val.integerValue);
          else if (val.doubleValue !== undefined) fields[key] = val.doubleValue;
          else if (val.booleanValue !== undefined) fields[key] = val.booleanValue;
          else fields[key] = null;
        }
        docs.push({ id, ...fields });
      }
    }
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return docs;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  return { stringValue: String(val) };
}

// ─── MAIN ───
async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  MIGRACIÓN DE CALIFICACIONES (Google Drive → Firestore)');
  console.log(`  Modo: ${DRY_RUN ? '🧪 DRY RUN' : '🔥 LIVE WRITE'}`);
  console.log('═══════════════════════════════════════════════\n');

  // Load parsed grades
  const allGrades = JSON.parse(fs.readFileSync(GRADES_FILE, 'utf8'));
  console.log(`📄 Calificaciones parseadas: ${allGrades.length}`);

  // Fix grupo formatting (remove .0)
  allGrades.forEach(g => {
    if (g.grupo) g.grupo = String(g.grupo).replace('.0', '');
  });

  // Fetch Firestore data
  console.log('\n📥 Descargando datos de Firestore...');
  const [students, groups, subjects, assignments] = await Promise.all([
    fetchAllDocs('students'),
    fetchAllDocs('groups'),
    fetchAllDocs('subjects'),
    fetchAllDocs('assignments'),
  ]);
  console.log(`   Students: ${students.length}`);
  console.log(`   Groups: ${groups.length}`);
  console.log(`   Subjects: ${subjects.length}`);
  console.log(`   Assignments: ${assignments.length}`);

  // Build lookup maps
  const groupMap = {};
  groups.forEach(g => {
    const key = (g.turno || '') + '_' + (g.grado || '') + '-' + (g.nombre || g.id);
    groupMap[key] = g.id;
    // Also try with just nombre
    const key2 = (g.turno || '') + '_' + (g.nombre || g.id);
    groupMap[key2] = g.id;
  });

  const studentsByGroup = {};
  students.forEach(s => {
    const key = (s.turno || '') + '_' + (s.grado || '') + '-' + (s.grupo || '');
    if (!studentsByGroup[key]) studentsByGroup[key] = [];
    studentsByGroup[key].push(s);
  });

  const subjectMap = {};
  subjects.forEach(s => {
    subjectMap[normalize(s.nombre)] = s;
  });

  // ─── MATCHING AND WRITING ───
  let matched = 0, unmatched = 0, written = 0, errors = 0, skipped = 0;
  const unmatchedStudents = [];
  const unmatchedSubjects = new Set();
  const batch = [];

  for (let i = 0; i < allGrades.length; i++) {
    const grade = allGrades[i];
    const groupName = `${grade.grado}-${grade.grupo}`;

    // Find groupId
    const groupKey1 = `${grade.turno}_${grade.grado}-${groupName}`;
    const groupKey2 = `${grade.turno}_${groupName}`;
    const groupId = groupMap[groupKey1] || groupMap[groupKey2];

    if (!groupId) {
      unmatched++;
      continue;
    }

    // Find student
    const studentKey = `${grade.turno}_${grade.grado}-${grade.grupo}`;
    const candidates = studentsByGroup[studentKey] || [];
    let studentDoc = null;
    let bestScore = 0;

    for (const s of candidates) {
      const score = similarity(
        `${grade.apellido1} ${grade.apellido2} ${grade.nombres}`,
        `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`
      );
      if (score > bestScore) { bestScore = score; studentDoc = s; }
    }

    if (!studentDoc || bestScore < 0.7) {
      unmatched++;
      if (unmatchedStudents.length < 50) {
        unmatchedStudents.push(`${grade.turno} ${groupName}: ${grade.apellido1} ${grade.apellido2} ${grade.nombres} (best: ${bestScore.toFixed(2)})`);
      }
      continue;
    }

    // Find subject
    const normSubject = normalize(grade.subject);
    let subjectDoc = subjectMap[normSubject];
    if (!subjectDoc) {
      // Fuzzy match
      let bestSubScore = 0;
      for (const [key, sub] of Object.entries(subjectMap)) {
        const sc = similarity(normSubject, key);
        if (sc > bestSubScore) { bestSubScore = sc; subjectDoc = sub; }
      }
      if (bestSubScore < 0.7) {
        unmatchedSubjects.add(grade.subject);
        unmatched++;
        continue;
      }
    }

    matched++;

    // Build grade document
    const docId = `${studentDoc.id}_${subjectDoc.id}_${grade.partial}`;
    const fields = {
      studentId: toFirestoreValue(studentDoc.id),
      groupId: toFirestoreValue(groupId),
      subjectId: toFirestoreValue(subjectDoc.id),
      partial: toFirestoreValue(grade.partial),
      ec: toFirestoreValue(grade.ec),
      tr: toFirestoreValue(grade.tr),
      pe: toFirestoreValue(grade.pe !== undefined ? grade.pe : null),
      suma: toFirestoreValue(grade.suma),
      faltas: toFirestoreValue(grade.faltas),
      cal: toFirestoreValue(grade.cal),
      value: toFirestoreValue(grade.cal),
      updatedAt: { stringValue: new Date().toISOString() },
      source: { stringValue: 'google-drive-migration' },
    };

    // Add ex for vespertino
    if (grade.ex !== undefined) {
      fields.ex = toFirestoreValue(grade.ex);
    }

    if (!DRY_RUN) {
      batch.push({ docId, fields });
    }
  }

  // Write all matched grades using Firestore batchWrite (up to 400 per request)
  if (!DRY_RUN && batch.length > 0) {
    console.log(`\n📝 Escribiendo ${batch.length} calificaciones en lotes de ${BATCH_COMMIT_SIZE}...`);

    for (let start = 0; start < batch.length; start += BATCH_COMMIT_SIZE) {
      const chunk = batch.slice(start, start + BATCH_COMMIT_SIZE);
      const writes = chunk.map(item => ({
        update: {
          name: `projects/${PROJECT_ID}/databases/(default)/documents/grades/${item.docId}`,
          fields: item.fields,
        },
      }));

      const batchNum = Math.floor(start / BATCH_COMMIT_SIZE) + 1;
      const totalBatches = Math.ceil(batch.length / BATCH_COMMIT_SIZE);

      try {
        const result = await batchWrite(writes);
        // Count successes and failures from response
        const statuses = result.status || [];
        let batchOk = 0, batchErr = 0;
        for (const s of statuses) {
          if (!s.code || s.code === 0) batchOk++;
          else batchErr++;
        }
        // If no status array, assume all succeeded (batchWrite returns empty status for success)
        if (statuses.length === 0) batchOk = chunk.length;
        written += batchOk;
        errors += batchErr;
        console.log(`   Lote ${batchNum}/${totalBatches}: ${batchOk} ok, ${batchErr} errores`);
      } catch (err) {
        console.error(`   ❌ Lote ${batchNum} falló: ${err.message}`);
        errors += chunk.length;
        if (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED')) {
          console.log('   ⏳ Quota hit, esperando 120s antes de reintentar...');
          await new Promise(r => setTimeout(r, 120000));
          try {
            const result = await batchWrite(writes);
            const statuses = result.status || [];
            let ok = statuses.length === 0 ? chunk.length : statuses.filter(s => !s.code || s.code === 0).length;
            written += ok;
            errors -= ok;
            console.log(`   ✅ Reintento lote ${batchNum}: ${ok} ok`);
          } catch (e2) {
            console.error(`   ❌ Reintento falló: ${e2.message}`);
          }
        }
      }

      // Delay between batches to avoid rate limiting
      if (start + BATCH_COMMIT_SIZE < batch.length) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
      }
    }
  }

  // ─── REPORT ───
  console.log('\n\n═══════════════════════════════════════════════');
  console.log('  RESULTADO DE MIGRACIÓN');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total registros parseados: ${allGrades.length}`);
  console.log(`  ✅ Matched: ${matched}`);
  console.log(`  ❌ Unmatched: ${unmatched}`);
  if (!DRY_RUN) {
    console.log(`  📝 Written: ${written}`);
    console.log(`  ⚠️  Errors: ${errors}`);
  }

  if (unmatchedSubjects.size > 0) {
    console.log('\n  Materias sin match:');
    unmatchedSubjects.forEach(s => console.log(`    - ${s}`));
  }

  if (unmatchedStudents.length > 0) {
    console.log(`\n  Alumnos sin match (primeros ${Math.min(unmatchedStudents.length, 20)}):`);
    unmatchedStudents.slice(0, 20).forEach(s => console.log(`    - ${s}`));
  }
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
