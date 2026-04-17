#!/usr/bin/env node
/**
 * fix-final-missing.js — Busca y sube TODAS las calificaciones faltantes
 * comparando Firestore contra los Excel de la carpeta Calificaciones.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const https = require('https');

function cellStr(ws, ref) { const c = ws[ref]; return c && c.v != null ? String(c.v).trim() : ''; }
function cellVal(ws, ref) { const c = ws[ref]; return c && c.v != null ? c.v : null; }
function colLetter(idx) { let s='',n=idx; while(n>=0){s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;} return s; }
function normalize(s) { return (s||'').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); }

const token = fs.readFileSync('/tmp/firebase-access-token.txt','utf8').trim();
const PROJECT_ID = 'epo67-sistema';
const DB = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fetchAll(col){return new Promise((res,rej)=>{const docs=[];function fp(pt){const q=`?pageSize=300${pt?'&pageToken='+pt:''}`;const r=https.request({hostname:'firestore.googleapis.com',path:`${DB}/${col}${q}`,headers:{'Authorization':'Bearer '+token}},rs=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{if(rs.statusCode!==200){rej(new Error('HTTP '+rs.statusCode));return;}const b=JSON.parse(d);if(b.documents)for(const doc of b.documents){const id=doc.name.split('/').pop();const f={};for(const[k,v]of Object.entries(doc.fields||{})){if(v.stringValue!==undefined)f[k]=v.stringValue;else if(v.integerValue!==undefined)f[k]=Number(v.integerValue);else if(v.doubleValue!==undefined)f[k]=Number(v.doubleValue);}docs.push({id,...f});}b.nextPageToken?fp(b.nextPageToken):res(docs);});});r.on('error',rej);r.end();}fp(null);});}

function firestorePatch(docId,data){return new Promise((res,rej)=>{const fields={};for(const[k,v]of Object.entries(data)){if(v===null)fields[k]={nullValue:null};else if(typeof v==='string')fields[k]={stringValue:v};else if(typeof v==='number'){if(Number.isInteger(v))fields[k]={integerValue:String(v)};else fields[k]={doubleValue:v};}}const body=JSON.stringify({fields});const r=https.request({hostname:'firestore.googleapis.com',path:`${DB}/grades/${encodeURIComponent(docId)}`,method:'PATCH',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},rs=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{if(rs.statusCode===200)res('OK');else rej(new Error('HTTP '+rs.statusCode));});});r.on('error',rej);r.write(body);r.end();});}

async function main() {
  console.log('Descargando Firestore...');
  const [students, assignments, grades] = await Promise.all([
    fetchAll('students'), fetchAll('assignments'), fetchAll('grades')
  ]);
  console.log(`Students: ${students.length}, Assignments: ${assignments.length}, Grades: ${grades.length}`);

  const studentMap = {}; students.forEach(s => { studentMap[s.id] = s; });
  const activeStudents = students.filter(s => s.estatus === 'ACTIVO');
  const gradeSet = new Set(); grades.forEach(g => gradeSet.add(`${g.studentId}_${g.subjectId}_P1`));

  // Assignment lookup
  const asgByGroup = {};
  assignments.forEach(a => { if (!asgByGroup[a.groupId]) asgByGroup[a.groupId] = []; asgByGroup[a.groupId].push(a); });

  // Scan ALL Excel files
  const BASE = path.resolve(__dirname, '..');
  const folders = [
    { turno: 'MATUTINO', folder: path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE MATUTINO') },
    { turno: 'VESPERTINO', folder: path.join(BASE, 'Calificaciones/LISTAS POR DOCENTE VESPERTINO') }
  ];

  const toWrite = [];

  for (const { turno, folder } of folders) {
    if (!fs.existsSync(folder)) continue;
    const dirs = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory());

    for (const dir of dirs) {
      const files = fs.readdirSync(path.join(folder, dir.name)).filter(f => f.endsWith('.xlsx') && !f.startsWith('~'));
      for (const file of files) {
        let wb;
        try { wb = XLSX.readFile(path.join(folder, dir.name, file), { cellFormula: false }); } catch { continue; }

        for (const sn of wb.SheetNames) {
          if (/^(hoja\s*\d+|sheet\s*\d+)$/i.test(sn.trim())) continue;
          const ws = wb.Sheets[sn];
          const subjectRaw = cellStr(ws, 'B14').toUpperCase();
          const grado = cellVal(ws, 'B15');
          let grupo = cellVal(ws, 'D15');
          if (grupo != null) grupo = parseInt(String(grupo), 10);
          const gradoNum = grado ? parseInt(String(grado).match(/(\d)/)?.[1] || '0') : 0;
          if (!gradoNum || !grupo) continue;

          const groupId = `${turno}_${gradoNum}-${grupo}`;
          const groupAsgs = asgByGroup[groupId] || [];
          const normSubject = normalize(subjectRaw);

          // Match subject
          let subjectId = null;
          for (const a of groupAsgs) { if (normalize(a.subjectName||'') === normSubject) { subjectId = a.subjectId; break; } }
          if (!subjectId) { for (const a of groupAsgs) { const n = normalize(a.subjectName||''); if (n.includes(normSubject)||normSubject.includes(n)) { subjectId = a.subjectId; break; } } }
          if (!subjectId) { const words = normSubject.split(' ').filter(w=>w.length>3); for (const a of groupAsgs) { const aw = normalize(a.subjectName||'').split(' ').filter(w=>w.length>3); if (words.filter(w=>aw.includes(w)).length>=2) { subjectId = a.subjectId; break; } } }
          if (!subjectId) continue;

          // Cal column
          let calCol = null;
          for (let cc = 0; cc < 20; cc++) { const h = cellStr(ws, colLetter(cc)+'16').toLowerCase(); if (h.includes('calificaci') && calCol === null) calCol = cc; }
          if (calCol === null) continue;

          let faltasCol = null;
          for (let cc = 0; cc < 20; cc++) { const h = cellStr(ws, colLetter(cc)+'16').toLowerCase(); if (h.includes('falta')) faltasCol = cc; }

          // Scale
          const rawCals = [];
          for (let r=17;r<=100;r++){const n=cellVal(ws,'A'+r);if(n==null||typeof n!=='number'||n!==(r-16))break;const cv=cellVal(ws,colLetter(calCol)+r);if(cv!=null&&typeof cv==='number'&&cv>0)rawCals.push(cv);}
          const is100Scale = rawCals.length > 0 && (rawCals.filter(v=>v>10).length / rawCals.length) > 0.5;

          for (let row = 17; row <= 200; row++) {
            const numVal = cellVal(ws, 'A'+row);
            if (numVal == null || typeof numVal !== 'number' || numVal !== (row-16)) break;

            const ap1 = cellStr(ws, 'B'+row).toUpperCase();
            const ap2 = cellStr(ws, 'C'+row).toUpperCase();
            const nom = cellStr(ws, 'D'+row).toUpperCase();
            if (cellStr(ws, 'E'+row).toUpperCase() === 'BAJA') continue;
            if (!ap1) continue;

            // Match student
            const candidates = activeStudents.filter(s => s.groupId === groupId);
            let sid = null;
            const nap1 = normalize(ap1), nap2 = normalize(ap2), nnom = normalize(nom);
            for (const s of candidates) { if (normalize(s.apellido1||'')===nap1 && normalize(s.apellido2||'')===nap2 && normalize(s.nombres||'')===nnom) { sid=s.id; break; } }
            if (!sid) { for (const s of candidates) { if (normalize(s.apellido1||'')===nap1 && normalize(s.apellido2||'')===nap2) { const sn2=normalize(s.nombres||''); if(nnom.includes(sn2)||sn2.includes(nnom)){sid=s.id;break;} } } }
            if (!sid) { for (const s of candidates) { if (normalize(s.apellido1||'')===nap1 && normalize(s.apellido2||'')===nap2) { sid=s.id; break; } } }
            if (!sid) continue;

            const gradeKey = `${sid}_${subjectId}_P1`;
            if (gradeSet.has(gradeKey)) continue; // Already exists

            let cal = cellVal(ws, colLetter(calCol)+row);
            if (cal != null && typeof cal === 'number') {
              if (is100Scale && cal > 10) cal = Math.round(cal/10);
              cal = Math.min(Math.max(Math.round(cal),0),10);
              if (cal === 0) cal = 5;
            } else {
              cal = 5;
            }
            let faltas = faltasCol !== null ? cellVal(ws, colLetter(faltasCol)+row) : 0;
            faltas = (faltas !== null && !isNaN(parseInt(faltas))) ? parseInt(faltas) : 0;

            toWrite.push({ docId: gradeKey, studentId: sid, subjectId, groupId, cal, faltas, name: studentMap[sid]?.nombreCompleto || ap1+' '+ap2+' '+nom, teacher: dir.name });
            gradeSet.add(gradeKey);
          }
        }
      }
    }
  }

  console.log(`\nCalificaciones faltantes encontradas en Excel: ${toWrite.length}\n`);

  // Write
  let written = 0, errors = 0;
  for (const g of toWrite) {
    const data = { studentId: g.studentId, subjectId: g.subjectId, groupId: g.groupId, partial: 'P1', cal: g.cal, value: g.cal, faltas: g.faltas, updatedBy: 'fix-final', source: 'excel_recovery' };
    try { await firestorePatch(g.docId, data); written++; } catch (e) { console.log(`ERR ${g.docId}: ${e.message}`); errors++; }
  }
  console.log(`Escritos: ${written} | Errores: ${errors}`);

  // Final coverage
  let exp=0, found=0;
  const stillMissing = [];
  for (const a of assignments) {
    const gs = activeStudents.filter(s => s.groupId === a.groupId);
    for (const s of gs) { exp++; if (gradeSet.has(`${s.id}_${a.subjectId}_P1`)) found++; else stillMissing.push({s:s.nombreCompleto,g:s.groupId,sub:a.subjectName||a.subjectId}); }
  }
  console.log(`\n=== COBERTURA FINAL ===`);
  console.log(`Esperadas: ${exp} | Encontradas: ${found} | Faltantes: ${exp-found} | ${(Math.round(found/exp*1000)/10)}%`);

  if (stillMissing.length > 0) {
    const byS = {};
    stillMissing.forEach(m=>{if(!byS[m.s])byS[m.s]={g:m.g,c:0};byS[m.s].c++;});
    console.log('\nAlumnos con faltantes:');
    Object.entries(byS).sort((a,b)=>b[1].c-a[1].c).forEach(([n,i])=>console.log(`  ${n} (${i.g}): ${i.c} materias`));
  }
}

main().catch(e => console.error('FATAL:', e.message));
