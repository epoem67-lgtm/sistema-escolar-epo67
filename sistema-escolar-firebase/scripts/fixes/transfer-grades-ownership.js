// Transfiere la propiedad (teacherId) de las grades de un grupo+materia
// al nuevo maestro asignado. Útil cuando una materia se reasigna y las
// grades viejas quedaron con el teacherId del docente anterior.
//
// Caso específico: Mantenimiento de Redes 2-1 VESPERTINO. Pasó de Fernanda
// Rodriguez (luypWC78ZvdH61DltAsm) a Francisco Cruz (GXu4PhDrWi7b5CK2izD3).
// Las grades del P1 quedaron con el teacherId viejo.
//
// Uso:
//   node scripts/fixes/transfer-grades-ownership.js              # dry-run
//   node scripts/fixes/transfer-grades-ownership.js --apply      # aplica
//
// Para otros casos, editar los parámetros TRANSFERS abajo.

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const APPLY = process.argv.includes('--apply');

// Transferencias a realizar
const TRANSFERS = [
  {
    groupId: 'VESPERTINO_2-1',
    subjectId: 'G2_mantenimiento_de_redes_de_cómputo',
    newTeacherId: 'GXu4PhDrWi7b5CK2izD3', // Francisco Cruz Garcia
    newTeacherName: 'CRUZ GARCIA FRANCISCO JESUS',
    note: 'Reasignación de Fernanda Rodriguez → Francisco Cruz',
  },
];

const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();

function apiRequest(method, path, body) {
  return new Promise((res, rej) => {
    const opts = {
      method, hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const parsed = d ? JSON.parse(d) : {};
          if (r.statusCode >= 400) rej(new Error(`HTTP ${r.statusCode}: ${d.slice(0, 200)}`));
          else res(parsed);
        } catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function runQuery(structuredQuery) {
  return new Promise((res, rej) => {
    const req = https.request({
      method: 'POST',
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res(JSON.parse(d).filter(x => x.document)); }
        catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.write(JSON.stringify({ structuredQuery }));
    req.end();
  });
}

const fv = (v) => v?.stringValue ?? v?.integerValue ?? v?.doubleValue ?? null;

async function main() {
  console.log(`MODO: ${APPLY ? 'APLICAR CAMBIOS' : 'DRY-RUN (no escribe)'}\n`);

  let totalUpdated = 0, totalSkipped = 0, totalErrors = 0;

  for (const t of TRANSFERS) {
    console.log(`── ${t.groupId} · ${t.subjectId} ──`);
    console.log(`   Nuevo teacherId: ${t.newTeacherId} (${t.newTeacherName})`);
    console.log(`   ${t.note}\n`);

    // Query: todas las grades de ese grupo+materia
    const grades = await runQuery({
      from: [{ collectionId: 'grades' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'groupId' }, op: 'EQUAL', value: { stringValue: t.groupId } } },
        { fieldFilter: { field: { fieldPath: 'subjectId' }, op: 'EQUAL', value: { stringValue: t.subjectId } } }
      ]}},
      limit: 500
    });

    console.log(`   Encontradas: ${grades.length} grades\n`);

    for (const g of grades) {
      const docPath = g.document.name;
      const docId = docPath.split('/').pop();
      const currentTeacherId = fv(g.document.fields?.teacherId);
      const currentTeacherName = fv(g.document.fields?.teacherName);
      const partial = fv(g.document.fields?.partial);
      const studentId = fv(g.document.fields?.studentId);

      if (currentTeacherId === t.newTeacherId) {
        totalSkipped++;
        continue;
      }

      console.log(`   • ${docId.slice(0, 50)}...`);
      console.log(`     partial=${partial} studentId=${studentId?.slice(0,10)} teacher viejo=${currentTeacherId?.slice(0,10) || 'null'} (${currentTeacherName || 'sin nombre'})`);

      if (!APPLY) {
        console.log(`     [DRY-RUN] cambiaría teacherId a ${t.newTeacherId.slice(0,10)}\n`);
        totalUpdated++;
        continue;
      }

      try {
        // PATCH solo los campos teacherId y teacherName (preservar el resto)
        await apiRequest(
          'PATCH',
          `/grades/${encodeURIComponent(docId)}?updateMask.fieldPaths=teacherId&updateMask.fieldPaths=teacherName`,
          {
            fields: {
              teacherId: { stringValue: t.newTeacherId },
              teacherName: { stringValue: t.newTeacherName },
            },
          }
        );
        console.log(`     ✅ Actualizado\n`);
        totalUpdated++;
      } catch (e) {
        console.log(`     ❌ Error: ${e.message}\n`);
        totalErrors++;
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`Resumen: ${totalUpdated} actualizadas, ${totalSkipped} ya OK, ${totalErrors} errores`);
  if (!APPLY && totalUpdated > 0) {
    console.log(`\n👉 Re-ejecuta con --apply:`);
    console.log(`   node scripts/fixes/transfer-grades-ownership.js --apply`);
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
