const fs=require('fs'),path=require('path'),https=require('https');
const config=JSON.parse(fs.readFileSync(path.join(require('os').homedir(),'.config','configstore','firebase-tools.json'),'utf8'));
const token=config.tokens.access_token;
function norm(s){return(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();}
function fetchAll(c,pt){let url='https://firestore.googleapis.com/v1/projects/epo67-sistema/databases/(default)/documents/'+c+'?pageSize=300';if(pt)url+='&pageToken='+pt;return new Promise((r,j)=>{https.get(url,{headers:{'Authorization':'Bearer '+token}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)));}).on('error',j);});}
async function getAll(c){const a=[];let p=null;do{const j=await fetchAll(c,p);if(j.documents)a.push(...j.documents);p=j.nextPageToken;}while(p);return a;}

(async()=>{
  const [teachers, assignments, groups] = await Promise.all([getAll('teachers'), getAll('assignments'), getAll('groups')]);

  console.log('=== AUDITORIA DE DOCENTES ===');
  console.log('Total teachers:', teachers.length);

  // Identify duplicates — group by first word of normalized name
  const byKey = {};
  teachers.forEach(d=>{
    const id=d.name.split('/').pop();
    const nombre=d.fields?.nombre?.stringValue||'';
    const turno=d.fields?.turno?.stringValue||'';
    const nrm=norm(nombre);
    // Count assignments for this teacher
    const asgCount = assignments.filter(a=>a.fields?.teacherId?.stringValue===id).length;
    // Check if name has apellidos (contains 3+ words typically)
    const words = nrm.split(/\s+/).filter(w=>w.length>1);
    const hasApellidos = words.length >= 3;
    byKey[id] = {id, nombre, turno, nrm, words, hasApellidos, asgCount};
  });

  // Find duplicates: teachers where normalized name of short is contained in long or they share "root" words
  const teacherList = Object.values(byKey);
  const shortNamed = teacherList.filter(t => !t.hasApellidos);
  const fullNamed = teacherList.filter(t => t.hasApellidos);

  console.log('\nCon nombre completo (3+ palabras):', fullNamed.length);
  console.log('Con nombre corto (<3 palabras):', shortNamed.length);

  console.log('\n=== NOMBRES CORTOS (posibles duplicados) ===');
  shortNamed.forEach(t => {
    // Search in fullNamed for matching root words
    const matches = fullNamed.filter(f => {
      const fwords = f.nrm.split(/\s+/);
      return t.words.every(w => fwords.includes(w) || fwords.some(fw=>fw.includes(w)));
    });
    console.log(`\n[${t.id.substring(0,10)}...] ${t.nombre} (${t.turno}) - ${t.asgCount} asignaciones`);
    if (matches.length > 0) {
      matches.forEach(m => {
        console.log(`  candidato fusion: ${m.nombre} (${m.turno}) - ${m.asgCount} asignaciones - id:${m.id.substring(0,10)}...`);
      });
    } else {
      console.log('  SIN CANDIDATO DE FUSION');
    }
  });

  // Also find assignments with teacher names that DONT match any teacher
  console.log('\n=== ASSIGNMENTS CON TEACHERNAME HUERFANO ===');
  const teacherNames = new Set(teachers.map(t => t.fields?.nombre?.stringValue));
  const teacherIds = new Set(teachers.map(t => t.name.split('/').pop()));
  const orphanAsgs = assignments.filter(a => {
    const tn = a.fields?.teacherName?.stringValue || '';
    const tid = a.fields?.teacherId?.stringValue || '';
    return !teacherIds.has(tid);
  });
  console.log('Assignments sin teacher valido:', orphanAsgs.length);

  // Check assignments with different teacherName than the teacher's current name
  console.log('\n=== ASSIGNMENTS CON NOMBRE DESACTUALIZADO ===');
  let mismatchCount = 0;
  assignments.forEach(a => {
    const tn = a.fields?.teacherName?.stringValue || '';
    const tid = a.fields?.teacherId?.stringValue || '';
    const teacher = teachers.find(t => t.name.split('/').pop() === tid);
    if (teacher) {
      const currentName = teacher.fields?.nombre?.stringValue || '';
      if (tn !== currentName) {
        mismatchCount++;
        if (mismatchCount <= 10) {
          const gid = a.fields?.groupId?.stringValue || '';
          console.log(`  ${gid} | asgName: "${tn}" | currentName: "${currentName}"`);
        }
      }
    }
  });
  console.log('Total mismatches:', mismatchCount);
})();
