// Limpia las solicitudes de cambio de calificacion de PRUEBA hechas durante
// el desarrollo. Para cada solicitud:
//   - Si esta APLICADA: revierte la calificacion al valor anterior (previousCal)
//   - Marca la solicitud como 'cancelled' con motivo "Prueba de desarrollo"
//
// Uso:
//   cd sistema-escolar-firebase
//   node scripts/fixes/cleanup-test-corrections.js          # solo lista
//   node scripts/fixes/cleanup-test-corrections.js --apply  # ejecuta cambios

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const APPLY = process.argv.includes('--apply');

const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();

function _apiOnce(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents${path}`,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) {
            const err = new Error(`HTTP ${res.statusCode}: ${data}`);
            err.statusCode = res.statusCode;
            reject(err);
          } else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Retry exponencial para 503/UNAVAILABLE
async function api(method, path, body, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await _apiOnce(method, path, body);
    } catch (e) {
      const status = e.statusCode;
      const isRetryable = status === 503 || status === 429 || status === 500;
      if (isRetryable && i < retries - 1) {
        const wait = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s, 16s
        console.warn(`  ⚠ ${status} — reintentando en ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

const fv = (v) => {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  return v;
};

async function listAll(coll) {
  const out = [];
  let pageToken;
  do {
    const qs = `?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await api('GET', `/${coll}${qs}`);
    (res.documents || []).forEach(d => {
      const obj = { id: d.name.split('/').pop(), _path: d.name };
      for (const [k, v] of Object.entries(d.fields || {})) obj[k] = fv(v);
      out.push(obj);
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

let _allGrades = [];

async function main() {
  console.log(APPLY ? '═══ APLICANDO CAMBIOS ═══' : '═══ MODO DRY-RUN (solo listar) ═══');
  console.log('');

  // Pre-cargar TODOS los grades una sola vez (mas eficiente que runQuery por cada solicitud)
  console.log('Cargando grades en cache...');
  _allGrades = await listAll('grades');
  console.log(`  ${_allGrades.length} grades en cache.\n`);

  // 1) Listar solicitudes
  const corrections = await listAll('gradeCorrections');
  if (!corrections.length) {
    console.log('No hay solicitudes en gradeCorrections.');
    return;
  }

  // Agrupar por folio
  const byFolio = {};
  corrections.forEach(c => {
    if (!byFolio[c.folio]) byFolio[c.folio] = [];
    byFolio[c.folio].push(c);
  });

  console.log(`Total: ${corrections.length} docs, ${Object.keys(byFolio).length} folios distintos.\n`);

  let totalRevert = 0;
  let totalCancel = 0;
  let totalSkip = 0;

  for (const [folio, items] of Object.entries(byFolio)) {
    const first = items[0];
    console.log(`📋 ${folio} — ${first.requestedByName} — ${first.groupName}/${first.subjectName}/${first.partial}`);
    console.log(`   ${items.length} alumno(s) — estado(s): ${[...new Set(items.map(i => i.status))].join(', ')}`);

    for (const it of items) {
      const cancelled = it.status === 'cancelled';
      if (cancelled) {
        console.log(`     ⏭ ${it.studentName} — ya estaba cancelada`);
        totalSkip++;
        continue;
      }

      // Si fue aplicada, encontrar el grade real y revertir (en try/catch
      // separado para que un 503 NO bloquee la cancelacion de la solicitud).
      let revertedNote = '';
      if (it.status === 'applied') {
        const gradeDoc = _allGrades.find(g =>
          g.groupId === it.groupId &&
          g.subjectId === it.subjectId &&
          g.studentId === it.studentId &&
          g.partial === it.partial
        );
        if (gradeDoc) {
          if (gradeDoc.correctionFolio === folio) {
            const prev = gradeDoc.previousCal;
            if (prev !== undefined && prev !== null) {
              revertedNote = `cal ${gradeDoc.cal} -> ${prev} (revertir)`;
              if (APPLY) {
                try {
                  await api('PATCH',
                    `/grades/${gradeDoc.id}?updateMask.fieldPaths=cal&updateMask.fieldPaths=value&updateMask.fieldPaths=correctionFolio&updateMask.fieldPaths=previousCal`,
                    {
                      fields: {
                        cal: { integerValue: String(prev) },
                        value: { integerValue: String(prev) },
                        correctionFolio: { nullValue: null },
                        previousCal: { nullValue: null },
                      }
                    }
                  );
                  totalRevert++;
                } catch (e) {
                  console.warn(`     ⚠ NO se pudo revertir grade: ${e.message.slice(0, 100)}`);
                  revertedNote += ' [FALLO REVERT — necesitara revisarse manualmente]';
                }
              } else {
                totalRevert++;
              }
            } else {
              revertedNote = 'cal aplicada pero sin previousCal — NO se revierte';
            }
          } else {
            revertedNote = `grade no marca este folio (correctionFolio=${gradeDoc.correctionFolio || 'ninguno'}) — no toco`;
          }
        } else {
          revertedNote = 'no se encontro grade real';
        }
      }

      // Marcar como cancelled (en try/catch separado)
      const docId = it.id;
      console.log(`     • ${it.studentName} (${it.status}${revertedNote ? ' — ' + revertedNote : ''}) -> cancelled`);
      if (APPLY) {
        try {
          await api('PATCH',
            `/gradeCorrections/${docId}?updateMask.fieldPaths=status&updateMask.fieldPaths=cancelledAt&updateMask.fieldPaths=cancelledBy&updateMask.fieldPaths=cancelledReason`,
            {
              fields: {
                status: { stringValue: 'cancelled' },
                cancelledAt: { timestampValue: new Date().toISOString() },
                cancelledBy: { stringValue: 'cleanup-script' },
                cancelledReason: { stringValue: 'Solicitud de prueba — anulada por administrador durante el desarrollo' },
              }
            }
          );
          totalCancel++;
        } catch (e) {
          console.warn(`     ⚠ NO se pudo cancelar: ${e.message.slice(0, 100)}`);
        }
      } else {
        totalCancel++;
      }
    }
    console.log('');
  }

  console.log('───────────────────────────────────────');
  console.log(`Calificaciones revertidas: ${totalRevert}`);
  console.log(`Solicitudes a cancelar:    ${totalCancel}`);
  console.log(`Ya estaban canceladas:     ${totalSkip}`);
  if (!APPLY) {
    console.log('\n⚠ MODO DRY-RUN. Para EJECUTAR los cambios:');
    console.log('   node scripts/fixes/cleanup-test-corrections.js --apply');
  } else {
    console.log('\n✅ Cambios aplicados.');
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
