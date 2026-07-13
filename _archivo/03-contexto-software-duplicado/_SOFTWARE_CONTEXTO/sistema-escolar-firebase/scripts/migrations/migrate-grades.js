/**
 * MIGRATE GRADES TO FIRESTORE (v2)
 * Reads extracted-grades.json and writes to Firestore grades collection
 * Uses REST API with Firebase CLI access token
 *
 * v2 changes:
 * - Writes ALL rubros (ec, tr, ex, pe, suma, cal, faltas)
 * - Improved subject name matching with SUBJECT_ALIASES
 * - Better student matching (higher threshold, NP match, fuzzy logging)
 * - Detailed statistics at the end
 */

const https = require('https');
const fs = require('fs');

// ─── CONFIG ───
const PROJECT_ID = 'epo67-sistema';
const BATCH_SIZE = 20; // Small batches to avoid quota limits
const RESUME_FILE = '/tmp/migration-progress.json'; // Track progress for resume
const DRY_RUN = process.argv.includes('--dry-run');
const STUDENT_MATCH_THRESHOLD = 0.7;

// ─── LOAD DATA ───
const token = fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
const extractedData = require('./extracted-grades.json');
const firestoreStudents = JSON.parse(fs.readFileSync('/tmp/firestore-students-all.json', 'utf8'));
const firestoreGroups = JSON.parse(fs.readFileSync('/tmp/firestore-groups.json', 'utf8'));
const firestoreSubjects = JSON.parse(fs.readFileSync('/tmp/firestore-subjects.json', 'utf8'));

console.log(`\n📊 MIGRACION DE CALIFICACIONES A FIRESTORE (v2)`);
console.log(`   Grades to import: ${extractedData.totalGrades}`);
console.log(`   Students in Firestore: ${firestoreStudents.length}`);
console.log(`   Groups in Firestore: ${firestoreGroups.length}`);
console.log(`   Subjects in Firestore: ${firestoreSubjects.length}`);
console.log(`   Mode: ${DRY_RUN ? '🧪 DRY RUN' : '🔥 LIVE WRITE'}\n`);

// ─── SUBJECT ALIASES ───
// Maps known typos/variations in Excel to their canonical Firestore subject names (normalized, no accents, uppercase)
const SUBJECT_ALIASES = {
  'DEERECHIS': 'DERECHOS',
  'QUIMICAS': 'QUIMICAS',
  'FILOSOFICO': 'FILOSOFICO',
  'INGLES 2': 'INGLES II',
  'INGLES 1': 'INGLES I',
  'INGLES 3': 'INGLES III',
  'INGLES 4': 'INGLES IV',
  'INGLES 5': 'INGLES V',
  'INGLES 6': 'INGLES VI',
};

// Partial subject name mappings: if Excel name CONTAINS the key, try matching against value in Firestore
const SUBJECT_PARTIAL_ALIASES = {
  'MANTENIMIENTO DE REDES': 'MANTENIMIENTO DE REDES DE COMPUTO',
  'ACTIVIDADES ARTISTICAS Y CULTURALES': 'ACTIVIDADES ARTISTICAS Y CULTURALES',
  'EDUCACION PARA LA SALUD': 'EDUCACION PARA LA SALUD',
};

// ─── NORMALIZE HELPERS ───
function normalize(str) {
  if (!str) return '';
  return str.toString().toUpperCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ');
}

function similarity(a, b) {
  a = normalize(a);
  b = normalize(b);
  if (a === b) return 1;
  if (!a || !b) return 0;

  // Check if one contains the other
  if (a.includes(b) || b.includes(a)) return 0.85;

  // Word-based matching
  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = b.split(' ').filter(Boolean);
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.some(wb => wb === w || (w.length > 3 && wb.startsWith(w.substring(0, 3))))) {
      matches++;
    }
  }
  return matches / Math.max(wordsA.length, wordsB.length);
}

// ─── BUILD LOOKUP MAPS ───

// Group map: TURNO_grupo-key → groupId
const groupMap = {};
firestoreGroups.forEach(g => {
  const key = (g.turno || '') + '_' + (g.nombre || g.id);
  groupMap[key] = g.id;
});

// Student map: by turno+grupo+name
const studentsByGroup = {};
firestoreStudents.forEach(s => {
  const key = (s.turno || '') + '_' + (s.grupo || '');
  if (!studentsByGroup[key]) studentsByGroup[key] = [];
  studentsByGroup[key].push(s);
});

// Student map: by NP (numero de lista / student number) per group
const studentsByGroupNP = {};
firestoreStudents.forEach(s => {
  const groupKey = (s.turno || '') + '_' + (s.grupo || '');
  if (!studentsByGroupNP[groupKey]) studentsByGroupNP[groupKey] = {};
  if (s.np != null) {
    studentsByGroupNP[groupKey][String(s.np)] = s;
  }
});

// Subject map: normalized name → subject doc
const subjectMap = {};
firestoreSubjects.forEach(s => {
  subjectMap[normalize(s.nombre)] = s;
});

// ─── MATCH FUNCTIONS ───

function findStudent(grade) {
  const groupKey = grade.turno + '_' + grade.groupKey;
  const candidates = studentsByGroup[groupKey] || [];

  if (candidates.length === 0) return { student: null, score: 0, method: 'no_candidates' };

  const excelName = normalize(grade.studentFullName);

  // 1. Try exact match on full name
  for (const s of candidates) {
    const fsName = normalize(s.nombreCompleto || '');
    if (fsName === excelName) return { student: s, score: 1.0, method: 'exact_fullname' };
  }

  // 2. Try exact match on apellido1 + apellido2 + nombres components
  const normA1 = normalize(grade.apellido1);
  const normA2 = normalize(grade.apellido2);
  const normN = normalize(grade.nombres);
  for (const s of candidates) {
    const sA1 = normalize(s.apellido1 || '');
    const sA2 = normalize(s.apellido2 || '');
    const sN = normalize(s.nombres || '');
    if (sA1 === normA1 && sA2 === normA2 && sN === normN) {
      return { student: s, score: 1.0, method: 'exact_components' };
    }
  }

  // 3. Try matching by NP (student number) if available
  if (grade.studentNum != null) {
    const npMap = studentsByGroupNP[groupKey] || {};
    const byNP = npMap[String(grade.studentNum)];
    if (byNP) {
      // Verify the name is at least somewhat similar to avoid wrong NP matches
      const npNameScore = similarity(
        `${grade.apellido1} ${grade.apellido2} ${grade.nombres}`,
        `${byNP.apellido1 || ''} ${byNP.apellido2 || ''} ${byNP.nombres || ''}`
      );
      if (npNameScore >= 0.7) {
        return { student: byNP, score: npNameScore, method: 'np_match' };
      }
    }
  }

  // 4. Fuzzy match
  let best = null;
  let bestScore = 0;

  for (const s of candidates) {
    const scoreByName = similarity(
      `${grade.apellido1} ${grade.apellido2} ${grade.nombres}`,
      `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`
    );

    const scoreByFull = similarity(excelName, normalize(s.nombreCompleto || ''));
    const score = Math.max(scoreByName, scoreByFull);

    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }

  if (bestScore >= STUDENT_MATCH_THRESHOLD) {
    return { student: best, score: bestScore, method: 'fuzzy' };
  }

  return { student: null, score: bestScore, method: 'below_threshold' };
}

function applySubjectAliases(normalizedName) {
  // Check direct word replacements
  let result = normalizedName;
  for (const [typo, fix] of Object.entries(SUBJECT_ALIASES)) {
    if (result.includes(typo)) {
      result = result.replace(typo, fix);
    }
  }
  return result;
}

function findSubject(subjectName) {
  const norm = normalize(subjectName);

  // 1. Direct match
  if (subjectMap[norm]) return subjectMap[norm];

  // 2. Apply aliases and try again
  const aliased = applySubjectAliases(norm);
  if (aliased !== norm && subjectMap[aliased]) return subjectMap[aliased];

  // 3. Try partial alias mappings
  for (const [partial, target] of Object.entries(SUBJECT_PARTIAL_ALIASES)) {
    if (norm.includes(partial) || aliased.includes(partial)) {
      // Find the Firestore subject that contains the target
      for (const [key, subj] of Object.entries(subjectMap)) {
        if (key.includes(target)) return subj;
      }
    }
  }

  // 4. Fuzzy match with aliases applied
  let best = null;
  let bestScore = 0;

  for (const [key, subj] of Object.entries(subjectMap)) {
    const score1 = similarity(norm, key);
    const score2 = similarity(aliased, key);
    const score = Math.max(score1, score2);
    if (score > bestScore) {
      bestScore = score;
      best = subj;
    }
  }

  if (bestScore >= 0.65) return best;
  return null;
}

function findGroupId(turno, groupKey) {
  const key = turno + '_' + groupKey;
  return groupMap[key] || null;
}

// ─── FIRESTORE VALUE HELPERS ───

/**
 * Build a Firestore field value for a number, skipping null/undefined.
 * Returns null if the value should be omitted.
 */
function doubleField(val) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return null;
  const num = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(num)) return null;
  return { doubleValue: num };
}

function intField(val) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return null;
  const num = typeof val === 'number' ? Math.round(val) : parseInt(val, 10);
  if (isNaN(num)) return null;
  return { integerValue: String(num) };
}

// ─── FIRESTORE REST BATCH WRITE ───

function batchWrite(writes) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ writes });
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── MAIN MIGRATION ───

async function migrate() {
  const stats = {
    matched: 0,
    unmatched: 0,
    noStudent: 0,
    noSubject: 0,
    noGroup: 0,
    written: 0,
    errors: 0,
    skipped: 0,
    // Rubro stats
    rubros: { ec: 0, tr: 0, ex: 0, pe: 0, suma: 0, cal: 0, faltas: 0 },
    faltasGtZero: 0,
    calValues: [],
    calDistribution: { 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 },
  };

  const unmatchedStudents = [];
  const unmatchedSubjects = new Set();
  const fuzzyMatches = []; // Log fuzzy matches for review
  const writes = [];
  const gradeDocIds = new Set(); // Prevent duplicates

  console.log('🔍 Matching grades to Firestore records...\n');

  for (const grade of extractedData.grades) {
    // Find group
    const groupId = findGroupId(grade.turno, grade.groupKey);
    if (!groupId) {
      stats.noGroup++;
      stats.unmatched++;
      continue;
    }

    // Find subject
    const subject = findSubject(grade.subjectName);
    if (!subject) {
      stats.noSubject++;
      stats.unmatched++;
      unmatchedSubjects.add(grade.subjectName);
      continue;
    }

    // Find student
    const { student, score, method } = findStudent(grade);
    if (!student) {
      stats.noStudent++;
      stats.unmatched++;
      unmatchedStudents.push({
        name: grade.studentFullName,
        turno: grade.turno,
        group: grade.groupKey,
        subject: grade.subjectName,
        bestScore: score,
        method,
      });
      continue;
    }

    // Log fuzzy matches (score < 0.95) for review
    if (score < 0.95) {
      fuzzyMatches.push({
        excelName: grade.studentFullName,
        firestoreName: student.nombreCompleto || `${student.apellido1} ${student.apellido2} ${student.nombres}`,
        score: score.toFixed(3),
        method,
        turno: grade.turno,
        group: grade.groupKey,
      });
    }

    // Build grade document
    const gradeDocId = `${student.id}_${subject.id}_${grade.partial}`;

    // Skip duplicates (same student+subject+partial)
    if (gradeDocIds.has(gradeDocId)) {
      stats.skipped++;
      continue;
    }
    gradeDocIds.add(gradeDocId);

    const docPath = `projects/${PROJECT_ID}/databases/(default)/documents/grades/${gradeDocId}`;

    // Build fields - only include non-null rubro values (skip nulls for cleaner docs)
    const fields = {
      studentId: { stringValue: student.id },
      subjectId: { stringValue: subject.id },
      subjectName: { stringValue: subject.nombre || grade.subjectName },
      groupId: { stringValue: groupId },
      partial: { stringValue: grade.partial },
      turno: { stringValue: grade.turno },
      grado: { integerValue: String(grade.grado) },
      teacherName: { stringValue: grade.teacherName || '' },
      importedFrom: { stringValue: 'excel_migration_v2' },
      importedAt: { timestampValue: new Date().toISOString() },
      updatedBy: { stringValue: 'migration_script_v2' },
    };

    // ─── Rubros ───
    // ec (Evaluacion Continua) - doubleValue or skip
    const ecVal = doubleField(grade.ec);
    if (ecVal) { fields.ec = ecVal; stats.rubros.ec++; }

    // tr (Transversal) - doubleValue or skip
    const trVal = doubleField(grade.tr);
    if (trVal) { fields.tr = trVal; stats.rubros.tr++; }

    // ex (Examen) - doubleValue or skip
    const exVal = doubleField(grade.ex);
    if (exVal) { fields.ex = exVal; stats.rubros.ex++; }

    // pe (Puntaje Extra) - doubleValue or skip
    const peVal = doubleField(grade.pe);
    if (peVal) { fields.pe = peVal; stats.rubros.pe++; }

    // suma - doubleValue (from grade.suma or fall back to grade.value)
    const sumaRaw = grade.suma != null ? grade.suma : grade.value;
    const sumaVal = doubleField(sumaRaw);
    if (sumaVal) { fields.suma = sumaVal; stats.rubros.suma++; }

    // cal - integerValue (rounded final grade, from grade.cal or Math.round(grade.value))
    const calRaw = grade.cal != null ? grade.cal : Math.round(grade.value);
    const calVal = intField(calRaw);
    if (calVal) {
      fields.cal = calVal;
      stats.rubros.cal++;
      const calNum = parseInt(calVal.integerValue, 10);
      stats.calValues.push(calNum);
      if (calNum >= 5 && calNum <= 10) {
        stats.calDistribution[calNum]++;
      }
    }

    // faltas - integerValue
    const faltasRaw = grade.faltas != null ? grade.faltas : 0;
    const faltasVal = intField(faltasRaw);
    if (faltasVal) {
      fields.faltas = faltasVal;
      stats.rubros.faltas++;
      if (parseInt(faltasVal.integerValue, 10) > 0) {
        stats.faltasGtZero++;
      }
    }

    // value - doubleValue (same as cal, for backward compat)
    const valueForCompat = calRaw != null ? calRaw : grade.value;
    const valueVal = doubleField(valueForCompat);
    if (valueVal) { fields.value = valueVal; }

    writes.push({
      update: {
        name: docPath,
        fields,
      }
    });

    stats.matched++;
  }

  console.log('📊 MATCHING RESULTS:');
  console.log(`   ✅ Matched: ${stats.matched}`);
  console.log(`   ❌ Unmatched: ${stats.unmatched}`);
  console.log(`      - No student found: ${stats.noStudent}`);
  console.log(`      - No subject found: ${stats.noSubject}`);
  console.log(`      - No group found: ${stats.noGroup}`);
  console.log(`   ⏩ Skipped duplicates: ${stats.skipped}`);
  console.log(`   📝 Writes to perform: ${writes.length}\n`);

  if (unmatchedSubjects.size > 0) {
    console.log('⚠️  Unmatched subjects:');
    unmatchedSubjects.forEach(s => console.log(`   - ${s}`));
    console.log('');
  }

  if (unmatchedStudents.length > 0) {
    const sample = unmatchedStudents.slice(0, 20);
    console.log(`⚠️  Sample unmatched students (${unmatchedStudents.length} total):`);
    sample.forEach(s => console.log(`   - ${s.name} (${s.turno} ${s.group}) [best=${s.bestScore.toFixed(2)}, method=${s.method}]`));
    if (unmatchedStudents.length > 20) console.log(`   ... and ${unmatchedStudents.length - 20} more`);
    console.log('');
  }

  if (fuzzyMatches.length > 0) {
    console.log(`🔎 Fuzzy matches for review (score < 0.95): ${fuzzyMatches.length} total`);
    const sample = fuzzyMatches.slice(0, 30);
    sample.forEach(m => console.log(`   "${m.excelName}" → "${m.firestoreName}" (score=${m.score}, ${m.method})`));
    if (fuzzyMatches.length > 30) console.log(`   ... and ${fuzzyMatches.length - 30} more`);
    console.log('');
  }

  // Save debug files
  fs.writeFileSync('/tmp/unmatched-students.json', JSON.stringify(unmatchedStudents, null, 2));
  fs.writeFileSync('/tmp/fuzzy-matches.json', JSON.stringify(fuzzyMatches, null, 2));

  // ─── DETAILED STATISTICS ───
  console.log('═══════════════════════════════════════');
  console.log('📈 DETAILED STATISTICS');
  console.log('═══════════════════════════════════════');
  console.log('');
  console.log('Rubros filled (out of ' + stats.matched + ' matched grades):');
  console.log(`   ec (Evaluacion Continua): ${stats.rubros.ec} (${(stats.rubros.ec / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   tr (Transversal):         ${stats.rubros.tr} (${(stats.rubros.tr / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   ex (Examen):              ${stats.rubros.ex} (${(stats.rubros.ex / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   pe (Puntaje Extra):       ${stats.rubros.pe} (${(stats.rubros.pe / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   suma:                     ${stats.rubros.suma} (${(stats.rubros.suma / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   cal:                      ${stats.rubros.cal} (${(stats.rubros.cal / stats.matched * 100).toFixed(1)}%)`);
  console.log(`   faltas:                   ${stats.rubros.faltas} (${(stats.rubros.faltas / stats.matched * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`Faltas > 0: ${stats.faltasGtZero} students`);

  if (stats.calValues.length > 0) {
    const avg = stats.calValues.reduce((a, b) => a + b, 0) / stats.calValues.length;
    console.log(`Average cal: ${avg.toFixed(2)}`);
    console.log('');
    console.log('Cal distribution:');
    for (let v = 5; v <= 10; v++) {
      const count = stats.calDistribution[v] || 0;
      const pct = (count / stats.calValues.length * 100).toFixed(1);
      const bar = '█'.repeat(Math.round(count / stats.calValues.length * 40));
      console.log(`   ${v === 5 ? ' 5' : v}: ${String(count).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }
    // Count values outside 5-10 range
    const outsideRange = stats.calValues.filter(v => v < 5 || v > 10).length;
    if (outsideRange > 0) {
      console.log(`   Other: ${outsideRange}`);
    }
  }
  console.log('═══════════════════════════════════════\n');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN — no writes performed. Run without --dry-run to execute.\n');
    // Save sample writes
    fs.writeFileSync('/tmp/sample-writes.json', JSON.stringify(writes.slice(0, 5), null, 2));
    return;
  }

  // Execute batch writes with rate limiting and retries
  console.log(`🔥 Writing ${writes.length} grades to Firestore in batches of ${BATCH_SIZE}...\n`);

  const DELAY_MS = 3000; // 3s delay between batches to avoid quota
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 30000; // 30 seconds on 429 error

  // Resume support: skip already written batches
  let startFrom = 0;
  try {
    const progress = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    startFrom = progress.lastWrittenIndex || 0;
    if (startFrom > 0) {
      console.log(`\n   📋 Resuming from batch index ${startFrom} (${startFrom} docs already written)`);
      stats.written = startFrom;
    }
  } catch(e) { /* no progress file, start fresh */ }

  for (let i = startFrom; i < writes.length; i += BATCH_SIZE) {
    const batch = writes.slice(i, i + BATCH_SIZE);
    let retries = 0;
    let success = false;

    while (!success && retries <= MAX_RETRIES) {
      try {
        await batchWrite(batch);
        stats.written += batch.length;
        const pct = Math.round((i + batch.length) / writes.length * 100);
        process.stdout.write(`\r   Progress: ${stats.written}/${writes.length} (${pct}%)`);
        success = true;

        // Save progress for resume
        fs.writeFileSync(RESUME_FILE, JSON.stringify({ lastWrittenIndex: i + batch.length }));

        // Rate limiting delay between batches
        await new Promise(r => setTimeout(r, DELAY_MS));
      } catch (error) {
        if (error.message.includes('429') && retries < MAX_RETRIES) {
          retries++;
          const waitSec = RETRY_DELAY * retries / 1000;
          process.stdout.write(`\n   ⏳ Rate limited, waiting ${waitSec}s (retry ${retries}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY * retries));
        } else if (error.message.includes('401') || error.message.includes('403')) {
          console.error('\n   🔑 Token expired. Re-run the token refresh command.');
          i = writes.length; // exit outer loop
          break;
        } else {
          console.error(`\n   ❌ Error in batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
          stats.errors += batch.length;
          success = true; // move on
        }
      }
    }

    if (!success) {
      console.error(`\n   ❌ Batch ${Math.floor(i / BATCH_SIZE)} failed after ${MAX_RETRIES} retries`);
      stats.errors += batch.length;
    }
  }

  console.log(`\n\n✅ MIGRATION COMPLETE:`);
  console.log(`   Written: ${stats.written}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`   Total in Firestore: ${stats.written} grade documents\n`);
}

migrate().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
