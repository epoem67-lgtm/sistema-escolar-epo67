const XLSX = require('xlsx');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'epo67-sistema';
const DRY_RUN = process.argv.includes('--dry-run');

function cellVal(ws, ref) { const c = ws[ref]; return c && c.v != null ? c.v : null; }
function cellStr(ws, ref) { const v = cellVal(ws, ref); return v != null ? String(v).trim() : ''; }
function normalize(s) { return (s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); }
function getToken() { return fs.readFileSync('/tmp/firebase-access-token.txt','utf8').trim(); }

function firestoreGet(token, col) {
  return new Promise((res, rej) => {
    const docs=[]; function fp(pt) {
      const q='?pageSize=300'+(pt?'&pageToken='+pt:'');
      const r=https.request({hostname:'firestore.googleapis.com',path:`/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}${q}`,headers:{'Authorization':'Bearer '+token}},rs=>{
        let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{
          if(rs.statusCode!==200){rej(new Error('HTTP '+rs.statusCode));return;}
          const b=JSON.parse(d);if(b.documents)for(const doc of b.documents){const id=doc.name.split('/').pop();const f={};for(const[k,v]of Object.entries(doc.fields||{})){if(v.stringValue!==undefined)f[k]=v.stringValue;else if(v.integerValue!==undefined)f[k]=Number(v.integerValue);else if(v.doubleValue!==undefined)f[k]=Number(v.doubleValue);}docs.push({id,...f});}
          b.nextPageToken?fp(b.nextPageToken):res(docs);
        });
      });r.on('error',rej);r.end();
    } fp(null);
  });
}

function firestorePatch(token, docId, data) {
  return new Promise((res, rej) => {
    const fields = {};
    for (const [k,v] of Object.entries(data)) {
      if (v===null) fields[k]={nullValue:null};
      else if (typeof v==='string') fields[k]={stringValue:v};
      else if (typeof v==='number') { if(Number.isInteger(v)) fields[k]={integerValue:String(v)}; else fields[k]={doubleValue:v}; }
    }
    const body = JSON.stringify({fields});
    const r = https.request({hostname:'firestore.googleapis.com',path:`/v1/projects/${PROJECT_ID}/databases/(default)/documents/grades/${encodeURIComponent(docId)}`,method:'PATCH',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },rs=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{if(rs.statusCode===200)res('OK');else rej(new Error('HTTP '+rs.statusCode+': '+d.substring(0,100)));});});
    r.on('error',rej);r.write(body);r.end();
  });
}

function findStudent(students, ap1, ap2, nom, groupId) {
  const candidates = students.filter(s => s.groupId === groupId && s.estatus === 'ACTIVO');
  const n1 = normalize(ap1), n2 = normalize(ap2), nn = normalize(nom);
  for (const s of candidates) {
    if (normalize(s.apellido1||'')===n1 && normalize(s.apellido2||'')===n2 && normalize(s.nombres||'')===nn) return s;
  }
  for (const s of candidates) {
    if (normalize(s.apellido1||'')===n1 && normalize(s.apellido2||'')===n2) {
      const sn = normalize(s.nombres||'');
      if (nn.includes(sn) || sn.includes(nn)) return s;
    }
  }
  for (const s of candidates) {
    if (normalize(s.apellido1||'')===n1 && normalize(s.apellido2||'')===n2) return s;
  }
  return null;
}

// Map Excel sheet grado+grupo+subjectName -> assignment's subjectId
function findSubjectId(assignments, groupId, excelSubject) {
  // Direct: find assignment for this group
  const groupAsgs = assignments.filter(a => a.groupId === groupId);
  const normExcel = normalize(excelSubject);
  
  // Try exact match on subjectName
  for (const a of groupAsgs) {
    if (normalize(a.subjectName || '') === normExcel) return a.subjectId;
  }
  // Try partial match
  for (const a of groupAsgs) {
    const normAsg = normalize(a.subjectName || '');
    if (normAsg.includes(normExcel) || normExcel.includes(normAsg)) return a.subjectId;
  }
  // Try matching first significant words
  const excelWords = normExcel.split(' ').filter(w => w.length > 3);
  for (const a of groupAsgs) {
    const asgWords = normalize(a.subjectName || '').split(' ').filter(w => w.length > 3);
    const overlap = excelWords.filter(w => asgWords.includes(w));
    if (overlap.length >= 2) return a.subjectId;
  }
  return null;
}

async function processFile(token, students, assignments, filePath, turno, calCol) {
  const wb = XLSX.readFile(filePath, { cellFormula: false });
  let written = 0, errors = 0, skipped = 0;
  
  for (const sn of wb.SheetNames) {
    if (/^(hoja\s*\d+|sheet\s*\d+)$/i.test(sn.trim())) continue;
    const ws = wb.Sheets[sn];
    const subject = cellStr(ws, 'B14').toUpperCase();
    const grado = cellVal(ws, 'B15');
    let grupo = cellVal(ws, 'D15');
    if (grupo != null) grupo = parseInt(String(grupo), 10);
    const gradoNum = grado ? parseInt(String(grado).match(/(\d)/)?.[1] || '0') : 0;
    if (!gradoNum || !grupo) continue;

    const groupId = `${turno}_${gradoNum}-${grupo}`;
    const subjectId = findSubjectId(assignments, groupId, subject);
    
    if (!subjectId) {
      console.log(`  WARN: No subjectId for "${subject}" in ${groupId}`);
      continue;
    }
    
    console.log(`  ${sn} → ${groupId} | ${subjectId}`);
    let sheetWritten = 0;

    for (let row = 17; row <= 200; row++) {
      const numVal = cellVal(ws, 'A' + row);
      if (numVal == null || typeof numVal !== 'number' || numVal !== (row - 16)) break;

      const ap1 = cellStr(ws, 'B' + row).toUpperCase();
      const ap2 = cellStr(ws, 'C' + row).toUpperCase();
      const nom = cellStr(ws, 'D' + row).toUpperCase();
      if (cellStr(ws, 'E' + row).toUpperCase() === 'BAJA') continue;
      if (!ap1) continue;

      const student = findStudent(students, ap1, ap2, nom, groupId);
      if (!student) {
        console.log(`    SKIP: ${ap1} ${ap2} ${nom} (sin match)`);
        skipped++;
        continue;
      }

      let cal = cellVal(ws, calCol + row);
      if (cal != null && typeof cal === 'number') {
        if (cal > 10) cal = Math.round(cal / 10);
        cal = Math.min(Math.max(Math.round(cal), 0), 10);
        if (cal === 0) cal = 5;
      } else {
        cal = 5;
      }

      const faltasCol = calCol === 'J' ? 'I' : 'J';
      let faltas = cellVal(ws, faltasCol + row);
      faltas = (faltas !== null && !isNaN(parseInt(faltas))) ? parseInt(faltas) : 0;

      const docId = `${student.id}_${subjectId}_P1`;
      const data = {
        studentId: student.id, subjectId, groupId, partial: 'P1',
        cal, value: cal, faltas,
        updatedBy: 'fix-claudia-dania.js', source: 'fix_missing'
      };

      if (DRY_RUN) {
        sheetWritten++;
      } else {
        try { await firestorePatch(token, docId, data); written++; sheetWritten++; }
        catch (e) { console.log(`    ERR ${docId}: ${e.message}`); errors++; }
      }
    }
    console.log(`    → ${sheetWritten} alumnos`);
  }
  if (DRY_RUN) console.log(`  (dry run — no se escribió)`);
  return { written, errors, skipped };
}

async function main() {
  const token = getToken();
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN' : 'ESCRITURA REAL'}\n`);
  
  const [students, assignments] = await Promise.all([
    firestoreGet(token, 'students'),
    firestoreGet(token, 'assignments')
  ]);
  console.log(`Students: ${students.length}, Assignments: ${assignments.length}\n`);

  const BASE = path.resolve(__dirname, '..');

  console.log('=== CLAUDIA (MATUTINO) ===');
  const r1 = await processFile(token, students, assignments,
    path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE MATUTINO/CLAUDIA/CLAUDIA TM.xlsx'),
    'MATUTINO', 'J');
  console.log(`  Total: ${r1.written} escritos, ${r1.errors} errores, ${r1.skipped} saltados\n`);

  console.log('=== DANIA (VESPERTINO) ===');
  const r2 = await processFile(token, students, assignments,
    path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE VESPERTINO/DANIA/DANIA TV.xlsx'),
    'VESPERTINO', 'K');
  console.log(`  Total: ${r2.written} escritos, ${r2.errors} errores, ${r2.skipped} saltados\n`);

  console.log(`TOTAL: ${r1.written + r2.written} escritos, ${r1.errors + r2.errors} errores`);
}

main().catch(e => console.error('FATAL:', e.message));
