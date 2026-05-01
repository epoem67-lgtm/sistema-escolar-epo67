/**
 * MERGE DUPLICATE TEACHERS — Fusiona docentes con dos fichas (uno por turno)
 * en un solo registro con turno='AMBOS', re-apuntando todas sus assignments,
 * assignmentsByGroup y referencias en groups.orientadorId al record canónico.
 *
 * Detecta duplicados por nombre normalizado.
 * Canónico = el record con MÁS assignments (si empate, el primero por id).
 *
 * Operaciones por par duplicado:
 *   1. Por cada `assignments/{dup_teacherId}_{groupId}_{subjectId}`:
 *      - Crear `assignments/{canonical_teacherId}_{groupId}_{subjectId}` con teacherId actualizado
 *      - Eliminar el doc viejo
 *      - Si el doc destino YA existe, omitir (canónico ya tenía esa clase)
 *   2. Por cada `assignmentsByGroup/{groupId}_{dup_teacherId}`:
 *      - Crear `assignmentsByGroup/{groupId}_{canonical_teacherId}`
 *      - Eliminar el doc viejo
 *   3. Por cada `groups` donde `orientadorId === dup_teacherId`:
 *      - Actualizar `orientadorId` al canonical
 *   4. Update canónico: turno='AMBOS'
 *   5. Delete record duplicado de teachers
 *
 * Idempotente: re-ejecutarlo no hace nada (no quedan duplicados).
 *
 * Por defecto corre en --dry-run. Para ejecutar real:
 *   node scripts/fixes/merge-duplicate-teachers.js --live
 *
 * Salida:
 *   - merge-duplicates-report.json con plan detallado de cada merge
 */

const https = require('https');
const fs = require('fs');

const PROJECT_ID = 'epo67-sistema';
const LIVE = process.argv.includes('--live');
const DRY_RUN = !LIVE;
const REPORT_FILE = 'merge-duplicates-report.json';

function getAccessToken() {
  try {
    const t = fs.readFileSync('/tmp/firebase-access-token.txt', 'utf8').trim();
    if (t) return t;
  } catch (e) {}
  console.error('Falta /tmp/firebase-access-token.txt — refrescar con `npx firebase-tools login:ci`');
  process.exit(1);
}
const token = getAccessToken();

function httpRequest(method, hostname, path, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } };
    const req = https.request(opts, res => { let d=''; res.on('data', c => d += c);
      res.on('end', () => { try { const p = d ? JSON.parse(d) : {}; if (p.error) reject(new Error((p.error.code||res.statusCode)+': '+p.error.message)); else resolve(p); } catch(e) { reject(new Error('HTTP '+res.statusCode+': '+d.slice(0,200))); } });
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
function fsReq(method, path, body) {
  return httpRequest(method, 'firestore.googleapis.com', `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`, body);
}
function batchWrite(writes) {
  return httpRequest('POST', 'firestore.googleapis.com', `/v1/projects/${PROJECT_ID}/databases/(default)/documents:batchWrite`, { writes });
}

async function fetchAllDocs(coll) {
  const docs = []; let pt = '';
  do {
    const path = `${coll}?pageSize=300${pt?'&pageToken='+encodeURIComponent(pt):''}`;
    const r = await fsReq('GET', path);
    if (r.documents) for (const d of r.documents) {
      const id = d.name.split('/').pop();
      const f = parseFields(d.fields || {});
      docs.push({ id, ...f, _rawFields: d.fields || {} });
    }
    pt = r.nextPageToken || '';
  } while (pt);
  return docs;
}
function parseFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue, 10);
    else if (v.doubleValue !== undefined) out[k] = v.doubleValue;
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
    else out[k] = null;
  }
  return out;
}
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function normalize(s) {
  return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim();
}

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  MERGE DE DOCENTES DUPLICADOS');
  console.log(`  Modo: ${DRY_RUN ? '🧪 DRY RUN (no escribe)' : '🔥 LIVE WRITE'}`);
  console.log('═══════════════════════════════════════════════\n');

  console.log('📥 Cargando datos…');
  const [teachers, assignments, agByGroup, groups] = await Promise.all([
    fetchAllDocs('teachers'), fetchAllDocs('assignments'),
    fetchAllDocs('assignmentsByGroup'), fetchAllDocs('groups'),
  ]);
  console.log(`   teachers: ${teachers.length}, assignments: ${assignments.length}, assignmentsByGroup: ${agByGroup.length}, groups: ${groups.length}\n`);

  // Indexar por nombre normalizado
  const byName = {};
  for (const t of teachers) {
    const n = normalize(t.nombre);
    if (!n) continue;
    if (!byName[n]) byName[n] = [];
    byName[n].push(t);
  }
  // Solo grupos con 2+
  const dupGroups = Object.entries(byName).filter(([_, recs]) => recs.length > 1);
  if (dupGroups.length === 0) { console.log('No hay duplicados. Salida limpia.'); return; }

  // Pre-indexar assignments y assignmentsByGroup por teacherId
  const aByTid = {};
  for (const a of assignments) { if(!aByTid[a.teacherId]) aByTid[a.teacherId] = []; aByTid[a.teacherId].push(a); }
  const agByTid = {};
  for (const a of agByGroup) { if(!agByTid[a.teacherId]) agByTid[a.teacherId] = []; agByTid[a.teacherId].push(a); }
  // Index existing assignment docIds for collision check
  const existingAssignIds = new Set(assignments.map(a => a.id));
  const existingAgByGroupIds = new Set(agByGroup.map(a => a.id));

  const report = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    duplicates_found: dupGroups.length,
    merges: [],
  };

  let totalWrites = 0;
  const allWrites = []; // operaciones acumuladas para batchWrite

  for (const [name, recs] of dupGroups) {
    // Calcular conteos
    const counts = recs.map(r => ({ ...r, _aCount: (aByTid[r.id]||[]).length, _agCount: (agByTid[r.id]||[]).length }));
    counts.sort((a, b) => (b._aCount - a._aCount) || a.id.localeCompare(b.id));
    const canonical = counts[0];
    const dupes = counts.slice(1);

    const merge = {
      nombre: name,
      canonical: { id: canonical.id, turno: canonical.turno, assignments: canonical._aCount },
      duplicados: dupes.map(d => ({ id: d.id, turno: d.turno, assignments: d._aCount, agByGroup: d._agCount })),
      ops: { reassign_assignments: 0, skip_collisions: 0, reassign_agByGroup: 0, update_groups_orientador: 0, update_canonical: 1, delete_duplicates: dupes.length },
    };

    for (const dup of dupes) {
      // 1. Reasignar assignments
      const dupAssignments = aByTid[dup.id] || [];
      for (const a of dupAssignments) {
        const newId = `${canonical.id}_${a.groupId}_${a.subjectId}`;
        // Si ya existe en el canónico, omitir (solo borrar el viejo)
        if (existingAssignIds.has(newId)) {
          merge.ops.skip_collisions++;
          allWrites.push({ delete: `projects/${PROJECT_ID}/databases/(default)/documents/assignments/${a.id}` });
          continue;
        }
        // Crear nuevo con teacherId actualizado
        const newFields = { ...a._rawFields, teacherId: { stringValue: canonical.id } };
        // Limpiar campos internos que no van a Firestore
        delete newFields._rawFields;
        allWrites.push({ update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/assignments/${newId}`, fields: newFields } });
        allWrites.push({ delete: `projects/${PROJECT_ID}/databases/(default)/documents/assignments/${a.id}` });
        existingAssignIds.add(newId);
        merge.ops.reassign_assignments++;
      }

      // 2. Reasignar assignmentsByGroup
      const dupAg = agByTid[dup.id] || [];
      for (const a of dupAg) {
        const newId = `${a.groupId}_${canonical.id}`;
        if (existingAgByGroupIds.has(newId)) {
          allWrites.push({ delete: `projects/${PROJECT_ID}/databases/(default)/documents/assignmentsByGroup/${a.id}` });
          continue;
        }
        const newFields = { ...a._rawFields, teacherId: { stringValue: canonical.id } };
        delete newFields._rawFields;
        allWrites.push({ update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/assignmentsByGroup/${newId}`, fields: newFields } });
        allWrites.push({ delete: `projects/${PROJECT_ID}/databases/(default)/documents/assignmentsByGroup/${a.id}` });
        existingAgByGroupIds.add(newId);
        merge.ops.reassign_agByGroup++;
      }

      // 3. Grupos con orientadorId === dup.id
      const grpsRefDup = groups.filter(g => g.orientadorId === dup.id);
      for (const g of grpsRefDup) {
        const newFields = { ...g._rawFields, orientadorId: { stringValue: canonical.id } };
        delete newFields._rawFields;
        allWrites.push({ update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/groups/${g.id}`, fields: newFields },
                         updateMask: { fieldPaths: ['orientadorId'] } });
        merge.ops.update_groups_orientador++;
      }

      // 5. Eliminar el record duplicado de teachers
      allWrites.push({ delete: `projects/${PROJECT_ID}/databases/(default)/documents/teachers/${dup.id}` });
    }

    // 4. Update canónico → turno='AMBOS'
    allWrites.push({
      update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/teachers/${canonical.id}`,
                fields: { turno: { stringValue: 'AMBOS' } } },
      updateMask: { fieldPaths: ['turno'] }
    });

    report.merges.push(merge);
    console.log(`  📋 ${name}`);
    console.log(`     canónico: ${canonical.id} (${canonical.turno}, ${canonical._aCount} clases) → cambia a AMBOS`);
    for (const d of dupes) console.log(`     duplicado: ${d.id} (${d.turno}, ${d._aCount} clases) → ELIMINAR`);
    console.log(`     ops: ${JSON.stringify(merge.ops)}`);
  }

  totalWrites = allWrites.length;
  console.log(`\n📊 TOTAL DE OPERACIONES: ${totalWrites}`);

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`📄 Plan completo en: ${REPORT_FILE}`);

  if (DRY_RUN) {
    console.log('\n🧪 DRY RUN — no se escribió nada. Para ejecutar:');
    console.log('   node scripts/fixes/merge-duplicate-teachers.js --live');
    return;
  }

  // ─── EJECUTAR EN BATCHES ───
  const BATCH_SIZE = 400;
  console.log(`\n🔥 Ejecutando ${totalWrites} writes en lotes de ${BATCH_SIZE}…`);
  let written = 0, errors = 0;
  for (let i = 0; i < allWrites.length; i += BATCH_SIZE) {
    const chunk = allWrites.slice(i, i + BATCH_SIZE);
    try {
      const r = await batchWrite(chunk);
      const statuses = r.status || [];
      const ok = statuses.length === 0 ? chunk.length : statuses.filter(s => !s.code || s.code === 0).length;
      const err = chunk.length - ok;
      written += ok; errors += err;
      console.log(`   Lote ${Math.floor(i/BATCH_SIZE)+1}: ${ok} ok, ${err} err`);
    } catch (e) {
      errors += chunk.length;
      console.error(`   ❌ Lote ${Math.floor(i/BATCH_SIZE)+1} falló: ${e.message}`);
    }
    if (i + BATCH_SIZE < allWrites.length) await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`\n✅ ${written} writes ok, ❌ ${errors} errores`);
}

main().catch(e => { console.error('💥 Fatal:', e.message); process.exit(1); });
