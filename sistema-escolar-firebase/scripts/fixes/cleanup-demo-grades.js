/**
 * CLEANUP DEMO GRADES — EPO 67
 *
 * Olivia hizo pruebas de captura desde el demo maestro y quiere limpiar
 * las grades para que no afecten los datos reales de la escuela.
 *
 * Estrategia: encuentra grades donde:
 *   - subjectId = G1_cultura_digital_ii (la materia que tiene el demo)
 *   - groupId = MATUTINO_1-1 o MATUTINO_1-2 (los grupos del demo)
 *   - updatedBy = uid del demo maestro (xrrHDQdDNYVam2nB6UgD1kiQcJz1)
 *
 * Si una grade fue capturada por OTRO maestro (no demo), NO se toca.
 *
 * Uso:
 *   node scripts/fixes/cleanup-demo-grades.js          # DRY RUN
 *   node scripts/fixes/cleanup-demo-grades.js --apply  # Aplica
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');
const APPLY = process.argv.includes('--apply');

// El uid del demo maestro (de cuando lo creamos)
const DEMO_MAESTRO_UID = 'xrrHDQdDNYVam2nB6UgD1kiQcJz1';
const TARGET_GROUPS = ['MATUTINO_1-1', 'MATUTINO_1-2'];
const TARGET_SUBJECT = 'G1_cultura_digital_ii';

let token;
try {
  if (fs.existsSync(CFG_PATH)) {
    const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    if (cfg.tokens?.access_token) { token = cfg.tokens.access_token; fs.writeFileSync(TOKEN_PATH, token); }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) { console.error('No se pudo leer token'); process.exit(1); }

function api(method, hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { method, hostname, path: urlPath, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
    const req = https.request(opts, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try { const j = data ? JSON.parse(data) : {}; if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`)); else resolve(j); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function val(f) { if (!f) return ''; return f.stringValue || f.booleanValue || f.integerValue || f.doubleValue || ''; }

async function queryGrades() {
  // Query: grades donde subjectId == TARGET_SUBJECT
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'grades' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'subjectId' },
          op: 'EQUAL',
          value: { stringValue: TARGET_SUBJECT },
        }
      },
      limit: 1000
    }
  };
  const r = await api('POST', 'firestore.googleapis.com',
    `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
    body
  );
  return (r || []).filter(d => d.document).map(d => ({
    id: d.document.name.split('/').pop(),
    fields: d.document.fields || {},
  }));
}

(async () => {
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  CLEANUP DEMO GRADES — Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  console.log(`🔎 Buscando grades en ${TARGET_SUBJECT}...`);
  const allGrades = await queryGrades();
  console.log(`   ${allGrades.length} grades encontradas en esta materia.\n`);

  // Filtrar solo grades del demo maestro Y de los 2 grupos demo
  const toDelete = allGrades.filter(g => {
    const groupId = val(g.fields.groupId);
    const updatedBy = val(g.fields.updatedBy);
    return TARGET_GROUPS.includes(groupId) && updatedBy === DEMO_MAESTRO_UID;
  });

  // También chequear si hay grades del demo en OTROS grupos/materias por error
  const otherDemoGrades = allGrades.filter(g => {
    const updatedBy = val(g.fields.updatedBy);
    const groupId = val(g.fields.groupId);
    return updatedBy === DEMO_MAESTRO_UID && !TARGET_GROUPS.includes(groupId);
  });

  // Y grades en los grupos target hechas por OTROS maestros (que NO se deben tocar)
  const protected_ = allGrades.filter(g => {
    const groupId = val(g.fields.groupId);
    const updatedBy = val(g.fields.updatedBy);
    return TARGET_GROUPS.includes(groupId) && updatedBy !== DEMO_MAESTRO_UID && updatedBy;
  });

  console.log(`📊 Análisis:`);
  console.log(`   • Grades del demo maestro en 1-1 / 1-2 MAT (a borrar): ${toDelete.length}`);
  console.log(`   • Grades del demo maestro en otros grupos/materias:    ${otherDemoGrades.length}`);
  console.log(`   • Grades de OTROS maestros en 1-1/1-2 (NO se tocan):  ${protected_.length}`);

  if (toDelete.length === 0) {
    console.log(`\n✅ No hay grades del demo que limpiar. Todo bien.\n`);
    return;
  }

  console.log(`\n🗑  Grades que se eliminarán (primeras 10):`);
  toDelete.slice(0, 10).forEach(g => {
    const f = g.fields;
    console.log(`   - ${g.id} | ${val(f.groupId)} | parcial=${val(f.partial)} | studentId=${val(f.studentId).slice(0, 12)} | cal=${val(f.cal) || val(f.value)}`);
  });
  if (toDelete.length > 10) console.log(`   ... y ${toDelete.length - 10} más`);

  if (!APPLY) {
    console.log(`\n💡 DRY RUN. Para aplicar: --apply\n`);
    return;
  }

  console.log(`\n🔴 ELIMINANDO ${toDelete.length} grades del demo...\n`);
  let ok = 0, fail = 0;
  for (let i = 0; i < toDelete.length; i++) {
    const g = toDelete[i];
    try {
      await api('DELETE', 'firestore.googleapis.com',
        `/v1/projects/${PROJECT}/databases/(default)/documents/grades/${g.id}`
      );
      ok++;
      if ((i + 1) % 10 === 0) console.log(`  ✓ ${i + 1}/${toDelete.length} eliminadas`);
    } catch (e) {
      console.log(`  ❌ ${g.id} — ${e.message.slice(0, 80)}`);
      fail++;
    }
  }

  // También revisar y eliminar incidents creados por el demo maestro
  console.log(`\n🔎 Buscando incidents del demo maestro...`);
  try {
    const r = await api('POST', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
      {
        structuredQuery: {
          from: [{ collectionId: 'incidents' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'reportedByUid' },
              op: 'EQUAL',
              value: { stringValue: DEMO_MAESTRO_UID },
            }
          },
          limit: 100
        }
      }
    );
    const incidents = (r || []).filter(d => d.document).map(d => d.document.name.split('/').pop());
    console.log(`   ${incidents.length} incidents del demo encontradas.`);
    let incOk = 0;
    for (const id of incidents) {
      try {
        await api('DELETE', 'firestore.googleapis.com',
          `/v1/projects/${PROJECT}/databases/(default)/documents/incidents/${id}`
        );
        incOk++;
      } catch (e) { /* ignorar */ }
    }
    if (incOk > 0) console.log(`   ✅ ${incOk} incidents del demo eliminadas\n`);
  } catch (e) {
    console.log(`   ⚠ ${e.message}\n`);
  }

  // Y teacherHours del demo
  try {
    const r = await api('POST', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`,
      {
        structuredQuery: {
          from: [{ collectionId: 'teacherHours' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'updatedBy' },
              op: 'EQUAL',
              value: { stringValue: DEMO_MAESTRO_UID },
            }
          },
          limit: 100
        }
      }
    );
    const hours = (r || []).filter(d => d.document).map(d => d.document.name.split('/').pop());
    if (hours.length > 0) {
      console.log(`🔎 ${hours.length} teacherHours del demo encontradas.`);
      let hOk = 0;
      for (const id of hours) {
        try {
          await api('DELETE', 'firestore.googleapis.com',
            `/v1/projects/${PROJECT}/databases/(default)/documents/teacherHours/${id}`
          );
          hOk++;
        } catch (e) { /* ignorar */ }
      }
      console.log(`   ✅ ${hOk} teacherHours del demo eliminadas\n`);
    }
  } catch (e) { /* ignorar */ }

  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  RESUMEN`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Grades eliminadas: ${ok}`);
  console.log(`  ❌ Fallaron:          ${fail}`);
  console.log(`  🛡  Grades de otros maestros (intactas): ${protected_.length}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
