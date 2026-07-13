/**
 * Fix missing grades for Muñoz Magaña Ximena (1-1 Matutino)
 * Reads from Excel files and writes to Firestore via REST API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const PROJECT_ID = 'epo67-sistema';
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Get access token from Firebase CLI stored token ───
function getAccessToken() {
  const configPath = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.tokens && config.tokens.access_token && Date.now() < config.tokens.expires_at) {
    return config.tokens.access_token;
  }
  throw new Error('Firebase access token expired. Run: npx firebase-tools login:reauth');
}

// ─── Firestore REST helpers ───
function firestoreGet(token, collectionPath) {
  return new Promise((resolve, reject) => {
    const allDocs = [];
    function fetchPage(pageToken) {
      let url = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionPath}?pageSize=300`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const req = https.request({
        hostname: 'firestore.googleapis.com', path: url, method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message));
          if (j.documents) {
            j.documents.forEach(doc => {
              const id = doc.name.split('/').pop();
              const fields = {};
              for (const [k, v] of Object.entries(doc.fields || {})) {
                if (v.stringValue !== undefined) fields[k] = v.stringValue;
                else if (v.integerValue !== undefined) fields[k] = parseInt(v.integerValue);
                else if (v.doubleValue !== undefined) fields[k] = v.doubleValue;
                else if (v.booleanValue !== undefined) fields[k] = v.booleanValue;
              }
              allDocs.push({ id, ...fields });
            });
          }
          if (j.nextPageToken) fetchPage(j.nextPageToken);
          else resolve(allDocs);
        });
      });
      req.on('error', reject);
      req.end();
    }
    fetchPage(null);
  });
}

function firestoreSet(token, docPath, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') {
      if (Number.isInteger(v)) fields[k] = { integerValue: String(v) };
      else fields[k] = { doubleValue: v };
    } else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  fields.updatedAt = { timestampValue: new Date().toISOString() };
  fields.updatedBy = { stringValue: 'migration-script' };

  const body = JSON.stringify({ fields });
  const allFields = Object.keys(data).concat(['updatedAt', 'updatedBy']);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?${allFields.map(f => 'updateMask.fieldPaths=' + f).join('&')}`,
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const j = JSON.parse(d);
        if (j.error) reject(new Error(j.error.message));
        else resolve(j);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Normalize for matching ───
function normalize(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

// ─── Rounding rules (matutino) ───
function calcCal(suma) {
  if (suma == null || isNaN(suma)) return 0;
  let s = Math.min(suma, 10);
  if (s >= 6) return Math.round(s);
  return Math.floor(s);
}

// ─── Extract Ximena's grades from Excel files ───
function extractXimenaGrades() {
  const baseDir = path.resolve(__dirname, '..', 'Calificaciones', 'LISTAS POR DOCENTE MATUTINO');
  const results = [];

  const teachers = fs.readdirSync(baseDir);
  for (const teacher of teachers) {
    const teacherDir = path.join(baseDir, teacher);
    if (!fs.statSync(teacherDir).isDirectory()) continue;

    const files = fs.readdirSync(teacherDir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
    for (const file of files) {
      try {
        const wb = XLSX.readFile(path.join(teacherDir, file));
        for (const sheetName of wb.SheetNames) {
          // Only look at sheets that contain "1-1" or "1 1" for group 1-1
          const normSheet = normalize(sheetName);
          if (!normSheet.includes('1-1') && !normSheet.includes('1 1')) continue;

          const sheet = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

          // Find subject name from header area (UAC row)
          let subjectName = '';
          for (let j = 0; j < Math.min(data.length, 20); j++) {
            const row = data[j] || [];
            for (let c = 0; c < row.length; c++) {
              const cellNorm = normalize(String(row[c]));
              if (cellNorm === 'UAC' && c + 1 < row.length && String(row[c + 1]).trim()) {
                subjectName = String(row[c + 1]).trim();
              }
            }
          }
          // Fallback: extract from sheet name (e.g. "1-1 pensamiento matematico ii")
          if (!subjectName) {
            subjectName = sheetName.replace(/1-1\s*/i, '').trim();
          }

          // Search all rows for XIMENA MUÑOZ MAGAÑA
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length < 4) continue;
            const rowStr = normalize(row.map(c => String(c)).join(' '));
            if (!rowStr.includes('XIMENA') || !rowStr.includes('MUNOZ') || !rowStr.includes('MAGANA')) continue;
            if (rowStr.includes('SANTIAGO')) continue;

            // Found Ximena - extract numeric values from the row
            // Typical structure: NP | Apellido1 | Apellido2 | Nombre | EC | TR | PE? | SUMA | Faltas? | CAL
            const nums = [];
            for (let c = 0; c < row.length; c++) {
              const v = parseFloat(row[c]);
              if (!isNaN(v)) nums.push({ col: c, val: v });
            }

            // First number is NP (list number), skip it
            // For matutino: EC, TR, [PE], SUMA, [Faltas], CAL
            let ec = null, tr = null, pe = null, suma = null, cal = null, faltas = null;

            if (nums.length >= 5) {
              // nums[0] = NP, nums[1] = EC, nums[2] = TR, ...
              ec = nums[1].val;
              tr = nums[2].val;

              // Check if PE exists (non-empty column between TR and SUMA)
              if (nums.length >= 6) {
                // Could be: EC, TR, PE, SUMA, Faltas, CAL or EC, TR, PE, SUMA, CAL
                pe = nums[3].val;
                suma = nums[4].val;
                if (nums.length >= 7) {
                  faltas = nums[5].val;
                  cal = nums[6].val;
                } else {
                  cal = nums[5] ? nums[5].val : null;
                }
              } else {
                // EC, TR, SUMA, CAL (no PE)
                suma = nums[3].val;
                cal = nums[4] ? nums[4].val : null;
              }

              // Normalize scales (some teachers use 80/20/100)
              if (ec > 10) ec = ec / 10;
              if (tr > 5) tr = tr / 10;
              if (suma !== null && suma > 12) suma = suma / 10;
              if (pe !== null && pe > 10) pe = pe / 10;

              // Sanity checks
              if (ec > 8 && tr <= 2 && suma && suma > ec) {
                // EC looks like SUMA, shift right
              }

              // If PE looks like SUMA (i.e., PE = EC + TR roughly), it's actually SUMA
              if (pe !== null && Math.abs(pe - (ec + tr)) < 0.5 && suma !== null && suma <= 10) {
                // pe is actually suma, suma is actually faltas/cal
                const actualSuma = pe;
                const actualCal = suma;
                pe = 0;
                suma = actualSuma;
                cal = actualCal;
                if (nums.length >= 6) faltas = nums[5] ? nums[5].val : 0;
              }
            }

            results.push({
              teacher, file, sheet: sheetName,
              subjectName: subjectName || sheetName,
              ec, tr, pe: pe || 0, suma, cal, faltas: faltas ? Math.round(faltas) : 0
            });
            break;
          }
        }
      } catch (e) {
        console.error(`   Error reading ${teacher}/${file}: ${e.message}`);
      }
    }
  }
  return results;
}

// ─── MAIN ───
async function main() {
  console.log('\n=== CAPTURA DE CALIFICACIONES — Muñoz Magaña Ximena (1-1 Matutino) ===');
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'LIVE WRITE'}\n`);

  // Step 1: Extract from Excel
  console.log('1. Extrayendo calificaciones de archivos Excel...');
  const excelGrades = extractXimenaGrades();
  console.log(`   Encontradas ${excelGrades.length} materias\n`);

  for (const g of excelGrades) {
    console.log(`   ${g.teacher} -> ${g.subjectName}`);
    console.log(`      EC=${g.ec} TR=${g.tr} PE=${g.pe} SUMA=${g.suma} CAL=${g.cal} Faltas=${g.faltas}`);
  }

  if (excelGrades.length === 0) {
    console.error('No se encontraron calificaciones en los archivos Excel.');
    process.exit(1);
  }

  // Step 2: Get Firestore data
  console.log('\n2. Obteniendo datos de Firestore...');
  const token = getAccessToken();
  console.log('   Token OK');

  const [students, subjects, groups] = await Promise.all([
    firestoreGet(token, 'students'),
    firestoreGet(token, 'subjects'),
    firestoreGet(token, 'groups')
  ]);
  console.log(`   Students: ${students.length}, Subjects: ${subjects.length}, Groups: ${groups.length}`);

  // Find Ximena
  const ximena = students.find(s =>
    normalize(s.nombreCompleto || '').includes('MUNOZ') &&
    normalize(s.nombreCompleto || '').includes('MAGANA') &&
    normalize(s.nombreCompleto || '').includes('XIMENA')
  );

  if (!ximena) {
    console.error('No se encontro a Ximena Muñoz Magaña en Firestore');
    process.exit(1);
  }
  console.log(`   Ximena: ID=${ximena.id}, Grupo=${ximena.grupo}, GroupId=${ximena.groupId}`);

  const groupId = ximena.groupId;

  // Check existing grades
  const existingGrades = await firestoreGet(token, 'grades');
  const ximenaGrades = existingGrades.filter(g => g.studentId === ximena.id);
  console.log(`   Calificaciones existentes: ${ximenaGrades.length}`);

  // Step 3: Match and write
  console.log('\n3. Emparejando materias y escribiendo...\n');

  let written = 0, skipped = 0, errors = 0;

  for (const grade of excelGrades) {
    const ns = normalize(grade.subjectName);

    // Match subject
    let subject = subjects.find(s => normalize(s.nombre || '') === ns);
    if (!subject) {
      subject = subjects.find(s => {
        const n = normalize(s.nombre || '');
        return n.includes(ns) || ns.includes(n);
      });
    }
    if (!subject) {
      const words = ns.split(/\s+/).filter(w => w.length > 2);
      subject = subjects.find(s => {
        const n = normalize(s.nombre || '');
        const matched = words.filter(w => n.includes(w)).length;
        return matched >= Math.ceil(words.length * 0.5);
      });
    }

    if (!subject) {
      console.log(`   ?? No match: "${grade.subjectName}" (${grade.teacher})`);
      skipped++;
      continue;
    }

    // Check existing
    const docId = `${ximena.id}_${subject.id}_P1`;
    const existing = ximenaGrades.find(g => g.id === docId);
    if (existing && (existing.cal > 0 || existing.value > 0)) {
      console.log(`   -- Ya existe: ${subject.nombre} P1 = ${existing.cal || existing.value}`);
      skipped++;
      continue;
    }

    const ec = grade.ec !== null ? Math.min(Math.max(grade.ec, 0), 8) : 0;
    const tr = grade.tr !== null ? Math.min(Math.max(grade.tr, 0), 2) : 0;
    const pe = grade.pe || 0;
    const suma = parseFloat(Math.min(ec + tr + pe, 10).toFixed(1));
    const cal = grade.cal || calcCal(suma);

    const gradeData = {
      studentId: ximena.id,
      subjectId: subject.id,
      groupId: groupId,
      partial: 'P1',
      ec, tr, pe, suma, cal,
      value: cal,
      faltas: grade.faltas || 0
    };

    console.log(`   -> ${subject.nombre}: EC=${ec} TR=${tr} SUMA=${suma} CAL=${cal}`);

    if (!DRY_RUN) {
      try {
        await firestoreSet(token, `grades/${docId}`, gradeData);
        console.log(`      OK`);
        written++;
        // Small delay to avoid quota
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.log(`      ERROR: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`      [DRY RUN] grades/${docId}`);
      written++;
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`Escritas: ${written}, Omitidas: ${skipped}, Errores: ${errors}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
