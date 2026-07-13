/**
 * FIX: Comunidades Virtuales MATUTINO 2-3 — Ana Isabel → Juana (cobertura)
 *
 * Problema:
 *   - Ana Isabel Correa Salgado tenía la asignación de MAT 2-3
 *   - Juana Rangel Palacios también tiene la asignación (es la correcta)
 *   - Ambas asignaciones causan duplicación al desplegar para captura
 *
 * Solución:
 *   1. Verificar si Ana Isabel tiene calificaciones en MAT 2-3 Comunidades
 *      - Si tiene: transferir a Juana (cambiar assignmentId en cada grade)
 *      - Si no tiene: borrar directo
 *   2. Eliminar la asignación de Ana Isabel
 *   3. Marcar la asignación de Juana con cobertura=true
 *
 * Uso:
 *   node scripts/fixes/fix-comunidades-2-3.js          # DRY RUN
 *   node scripts/fixes/fix-comunidades-2-3.js --apply  # APLICA
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const PROJECT = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const CFG_PATH = path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json');

const APPLY = process.argv.includes('--apply');

const ASG_ANA = '99rMqpbfFKrHMkfE2Jqb_MATUTINO_2-3_G2_comunidades_virtuales';
const ASG_JUANA = 'GwXEGuy4aqGChlCZPOqa_MATUTINO_2-3_G2_comunidades_virtuales';
const TEACHER_ANA = '99rMqpbfFKrHMkfE2Jqb';
const TEACHER_JUANA = 'GwXEGuy4aqGChlCZPOqa';

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
      res.on('end', () => { try { const j = data ? JSON.parse(data) : {}; if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`)); else resolve(j); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function val(f) { if (!f) return ''; return f.stringValue || f.booleanValue || f.integerValue || ''; }

async function queryGrades(assignmentId) {
  // Firestore structured query
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'grades' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'assignmentId' },
          op: 'EQUAL',
          value: { stringValue: assignmentId }
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
    assignmentId: val(d.document.fields?.assignmentId),
    studentId: val(d.document.fields?.studentId),
    parcial: val(d.document.fields?.parcial),
    cal: val(d.document.fields?.cal),
  }));
}

(async () => {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  FIX Comunidades Virtuales MAT 2-3 — Modo: ${APPLY ? '🔴 APPLY' : '🟢 DRY RUN'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Verificar grades de Ana Isabel
  console.log('🔍 Verificando si Ana Isabel tiene calificaciones capturadas...');
  const gradesAna = await queryGrades(ASG_ANA);
  console.log(`   → ${gradesAna.length} grades encontradas para asignación de Ana Isabel\n`);

  if (gradesAna.length > 0) {
    console.log('   Grades de Ana Isabel (primeras 5):');
    gradesAna.slice(0, 5).forEach(g => console.log(`      - parcial=${g.parcial} | cal=${g.cal} | studentId=${g.studentId.slice(0, 12)}`));
    if (gradesAna.length > 5) console.log(`      ... y ${gradesAna.length - 5} más`);
  }

  // 2. Verificar grades de Juana (para no sobreescribir)
  console.log('\n🔍 Verificando si Juana ya tiene calificaciones capturadas...');
  const gradesJuana = await queryGrades(ASG_JUANA);
  console.log(`   → ${gradesJuana.length} grades encontradas para asignación de Juana\n`);

  // 3. Plan de acción
  console.log('📋 Plan de acción:');
  console.log(`   1. Eliminar asignación de Ana Isabel (id=${ASG_ANA})`);
  if (gradesAna.length > 0) {
    if (gradesJuana.length > 0) {
      console.log(`   ⚠ ATENCIÓN: Ana tiene ${gradesAna.length} grades Y Juana también tiene ${gradesJuana.length}`);
      console.log(`     Esto requiere revisión manual — no voy a tocar las grades automáticamente.`);
      console.log(`     Las grades de Ana se ELIMINARÁN al borrar su asignación.`);
    } else {
      console.log(`   2. Transferir las ${gradesAna.length} grades de Ana → Juana (cambiar assignmentId)`);
    }
  } else {
    console.log(`   2. (No hay grades que transferir)`);
  }
  console.log(`   3. Marcar asignación de Juana con cobertura=true`);

  if (!APPLY) {
    console.log('\n💡 DRY RUN. Para aplicar: agrega --apply\n');
    return;
  }

  // 4. APLICAR
  console.log('\n🔴 APLICANDO CAMBIOS...\n');

  // Si Ana tiene grades y Juana no, transferimos
  if (gradesAna.length > 0 && gradesJuana.length === 0) {
    console.log(`📦 Transfiriendo ${gradesAna.length} grades de Ana → Juana...`);
    let tOk = 0, tFail = 0;
    for (const g of gradesAna) {
      try {
        const urlPath = `/v1/projects/${PROJECT}/databases/(default)/documents/grades/${g.id}?updateMask.fieldPaths=assignmentId&updateMask.fieldPaths=teacherId`;
        await api('PATCH', 'firestore.googleapis.com', urlPath, {
          fields: {
            assignmentId: { stringValue: ASG_JUANA },
            teacherId: { stringValue: TEACHER_JUANA }
          }
        });
        tOk++;
      } catch (e) {
        tFail++;
        console.log(`   ❌ Falló transferencia de grade ${g.id}: ${e.message.slice(0, 60)}`);
      }
    }
    console.log(`   ✓ ${tOk} grades transferidas | ${tFail} fallaron\n`);
  } else if (gradesAna.length > 0 && gradesJuana.length > 0) {
    console.log('⚠ Conflicto: ambos tienen grades. NO transfiero — las de Ana se borrarán al borrar su asignación.');
    console.log('   Revisa antes manualmente si necesitas conservar las grades de Ana.\n');
    // Opción de salida segura — NO borrar nada todavía
    console.log('🛑 PARANDO. Si quieres continuar de todos modos, edita el script y forza la eliminación.\n');
    return;
  }

  // 5. Eliminar asignación de Ana
  console.log('🗑  Eliminando asignación de Ana Isabel...');
  try {
    await api('DELETE', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents/assignments/${ASG_ANA}`
    );
    console.log('   ✓ Asignación de Ana Isabel eliminada\n');
  } catch (e) {
    console.log(`   ❌ Falló eliminación: ${e.message}\n`);
  }

  // 5.b También eliminar grades huérfanas de Ana si quedaron (no deberían si transferimos)
  if (gradesAna.length > 0 && gradesJuana.length > 0) {
    console.log('   (No tocamos grades, ya estaban con conflicto)');
  }

  // 6. Marcar Juana con cobertura=true
  console.log('✏  Actualizando asignación de Juana: cobertura=true...');
  try {
    await api('PATCH', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents/assignments/${ASG_JUANA}?updateMask.fieldPaths=cobertura`,
      { fields: { cobertura: { booleanValue: true } } }
    );
    console.log('   ✓ Juana marcada como cobertura=true\n');
  } catch (e) {
    console.log(`   ❌ Falló: ${e.message}\n`);
  }

  // 7. Audit log
  try {
    await api('POST', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents/activityLog`,
      {
        fields: {
          action: { stringValue: 'corregir_asignacion' },
          entityType: { stringValue: 'asignacion' },
          entityId: { stringValue: ASG_JUANA },
          description: { stringValue: 'Corregido: Ana Isabel Correa → Juana Rangel (cobertura) en Comunidades Virtuales MAT 2-3' },
          timestamp: { timestampValue: new Date().toISOString() },
        }
      }
    );
  } catch (_) { /* no crítico */ }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ✅ TERMINADO');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Para verificar:');
  console.log('  node scripts/audits/diag-comunidades-2-3.js');
  console.log('  Y refresca el sistema (Cmd+Shift+R) para ver el cambio.\n');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
