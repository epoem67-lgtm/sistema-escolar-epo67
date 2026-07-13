const fs=require('fs'),path=require('path'),https=require('https');
const config=JSON.parse(fs.readFileSync(path.join(require('os').homedir(),'.config','configstore','firebase-tools.json'),'utf8'));
const token=config.tokens.access_token;
function fetchAll(c,pt){let url='https://firestore.googleapis.com/v1/projects/epo67-sistema/databases/(default)/documents/'+c+'?pageSize=300';if(pt)url+='&pageToken='+pt;return new Promise((r,j)=>{https.get(url,{headers:{'Authorization':'Bearer '+token}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>r(JSON.parse(d)));}).on('error',j);});}
async function getAll(c){const a=[];let p=null;do{const j=await fetchAll(c,p);if(j.documents)a.push(...j.documents);p=j.nextPageToken;}while(p);return a;}
function patchDoc(coll, docId, fields) {
  const f = {};
  for (const [k, v] of Object.entries(fields)) f[k] = { stringValue: v };
  const body = JSON.stringify({ fields: f });
  const keys = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + k).join('&');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: '/v1/projects/epo67-sistema/databases/(default)/documents/' + coll + '/' + encodeURIComponent(docId) + '?' + keys,
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
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

(async()=>{
  const [teachers, assignments] = await Promise.all([getAll('teachers'), getAll('assignments')]);

  // Build teacher map by id
  const teacherMap = {};
  teachers.forEach(d => {
    teacherMap[d.name.split('/').pop()] = d.fields?.nombre?.stringValue || '';
  });

  // Special case: ADRIANA is now CHAVEZ SOTO LIZETH — the ID "C0jDD0yZfwAcVp5YG5Rv" was Adriana
  // Need to check what's going on — these assignments say teacherName="ADRIANA" but the teacher at that ID is CHAVEZ SOTO LIZETH
  // This means the teacher was RENAMED (likely in earlier migration Adriana->Lizeth) but assignments retained old name
  // So we just need to sync all assignment teacherNames to match current teacher name

  let updated = 0, errors = 0, ambiguous = [];
  console.log('=== SINCRONIZANDO NOMBRES DE ASSIGNMENTS CON TEACHERS ===\n');

  for (const asg of assignments) {
    const id = asg.name.split('/').pop();
    const tid = asg.fields?.teacherId?.stringValue || '';
    const oldName = asg.fields?.teacherName?.stringValue || '';
    const currentName = teacherMap[tid];

    if (!currentName) {
      console.log('HUERFANO:', id, '| teacherId:', tid, 'no existe');
      errors++;
      continue;
    }

    if (oldName === currentName) continue; // Already correct

    try {
      await patchDoc('assignments', id, { teacherName: currentName });
      updated++;
      if (updated <= 20 || updated % 10 === 0) {
        console.log(`  [${updated}] ${oldName} -> ${currentName}`);
      }
    } catch (e) {
      console.log(`  ERR ${id}: ${e.message}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 25));
  }

  console.log('\n=== RESULTADO ===');
  console.log('Actualizadas:', updated);
  console.log('Errores:', errors);

  // Verify
  console.log('\n=== VERIFICACION ===');
  const finalAsgs = await getAll('assignments');
  let mismatches = 0;
  finalAsgs.forEach(a => {
    const tid = a.fields?.teacherId?.stringValue || '';
    const tn = a.fields?.teacherName?.stringValue || '';
    const current = teacherMap[tid];
    if (current && tn !== current) mismatches++;
  });
  console.log('Mismatches restantes:', mismatches);
})().catch(e=>console.error('Fatal:',e));
