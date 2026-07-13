/**
 * Borra los grades huérfanos detectados por analyze-orphans-vs-twins.js
 * Solo borra los que tienen "gemelo correcto" con cal válida en el grado
 * actual del alumno. Los huérfanos son basura de la migración inicial donde
 * un alumno en 3° tenía un grade con subjectId G2_* (del año pasado).
 *
 * Causaba aparición duplicada de la misma materia (ej. Temas Selectos IV + VI)
 * en tiras, boletas, pre-boletas. Después de este borrado, NO PUEDE haber
 * duplicados porque el filtro por prefijo + la limpieza de basura aseguran
 * solo el grade correcto.
 *
 * USO:
 *   node scripts/fixes/delete-orphan-grades.js           # dry-run
 *   node scripts/fixes/delete-orphan-grades.js --apply   # ejecuta
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY_RUN = !process.argv.includes('--apply');

const PROJECT = 'epo67-sistema';
const BASE = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;

function reqDelete(p) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com', path: p, method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token },
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => r.statusCode < 300 ? res(d) : rej(new Error(`HTTP ${r.statusCode}: ${d}`)));
    });
    req.on('error', rej);
    req.end();
  });
}

(async () => {
  const jsonFile = path.join(__dirname, '..', 'audits', 'orphans-safe-to-delete.json');
  if (!fs.existsSync(jsonFile)) {
    console.error('Falta orphans-safe-to-delete.json. Corre primero analyze-orphans-vs-twins.js');
    process.exit(1);
  }
  const orphans = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (sin borrar)' : 'APPLY (borrando)'}`);
  console.log(`Total huérfanos a borrar: ${orphans.length}\n`);

  // Resumen por materia
  const bySubject = {};
  orphans.forEach(o => {
    const k = o.subjectName || o.subjectId;
    bySubject[k] = (bySubject[k] || 0) + 1;
  });
  console.log(`Por materia huérfana:`);
  Object.entries(bySubject).sort((a,b) => b[1] - a[1]).forEach(([s, n]) => {
    console.log(`   ${n.toString().padStart(3)} · ${s}`);
  });
  console.log();

  if (DRY_RUN) {
    console.log('(dry-run completo. Corre con --apply para aplicar.)');
    return;
  }

  let ok = 0, errors = 0;
  for (const o of orphans) {
    try {
      const url = `${BASE}/grades/${encodeURIComponent(o.docId)}`;
      await reqDelete(url);
      ok++;
      if (ok % 25 === 0) console.log(`  Progreso: ${ok}/${orphans.length}...`);
    } catch (e) {
      console.log(`  ✗ ${o.docId}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== RESULTADO ===`);
  console.log(`✓ Borrados: ${ok}/${orphans.length}`);
  console.log(`✗ Errores: ${errors}`);

  // Backup local con docIds + valores por si necesita recuperación
  const backupFile = path.join(__dirname, '..', 'audits', `orphans-deleted-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(orphans, null, 2), 'utf8');
  console.log(`\nBackup local (con valores antes de borrar): ${backupFile}`);
})().catch(e => {
  console.error('ERROR:', e.message || e);
  process.exit(1);
});
