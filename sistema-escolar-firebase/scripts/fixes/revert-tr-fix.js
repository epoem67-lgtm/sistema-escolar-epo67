// REVERTIR un caso específico de la corrección masiva TR (v8.25).
// Restaura tr=0, recalcula suma+cal con tr=0, y marca el audit como revertido.
//
// Uso:
//   node scripts/fixes/revert-tr-fix.js <studentId> <subjectId> <partial>
// O bien para revertir TODOS los casos de un grupo+materia+parcial:
//   node scripts/fixes/revert-tr-fix.js --group <groupId> --subject <subjectId> --partial <P1|P2|P3>
// O revertir TODO el fix masivo:
//   node scripts/fixes/revert-tr-fix.js --all-fix-v8.25

const fs = require('fs');
const https = require('https');
const PID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';

let token;
try {
  const cfgPath = require('os').homedir() + '/.config/configstore/firebase-tools.json';
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.tokens && cfg.tokens.access_token) {
      token = cfg.tokens.access_token;
      fs.writeFileSync(TOKEN_PATH, token);
    }
  }
  if (!token) token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
} catch (e) {
  console.error('Token no disponible. Ejecuta: npx firebase-tools projects:list');
  process.exit(1);
}

function api(method, host, path, body) {
  return new Promise(function(res, rej) {
    const req = https.request({method, hostname: host, path,
      headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }
    }, function(r) {
      let d = '';
      r.on('data', function(c) { d += c; });
      r.on('end', function() {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 400) rej(new Error('HTTP '+r.statusCode+': '+d.slice(0,200)));
          else res(j);
        } catch (e) { rej(e); }
      });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function val(f, k) {
  if (!f || !f[k]) return null;
  const v = f[k];
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  return null;
}

async function listColl(coll) {
  const out = [];
  let nextToken = null;
  do {
    const qs = nextToken ? '?pageToken=' + nextToken + '&pageSize=300' : '?pageSize=300';
    const r = await api('GET', 'firestore.googleapis.com', '/v1/projects/'+PID+'/databases/(default)/documents/'+coll+qs);
    if (r.documents) out.push.apply(out, r.documents);
    nextToken = r.nextPageToken;
  } while (nextToken);
  return out;
}

function calcSuma(rubros) {
  const ec = Number(rubros.ec) || 0;
  const tr = Number(rubros.tr) || 0;
  const ex = Number(rubros.ex) || 0;
  let pe = Number(rubros.pe) || 0;
  const sumaBase = ec + tr + ex;
  if (sumaBase < 6) pe = 0;
  return Math.min(10, sumaBase + pe);
}
function calcCal(suma) {
  if (suma >= 6) return Math.min(10, Math.round(suma));
  return Math.floor(suma);
}
function numField(n) {
  if (Number.isInteger(n)) return { integerValue: String(n) };
  return { doubleValue: n };
}

async function revertOne(docId) {
  const docPath = '/v1/projects/'+PID+'/databases/(default)/documents/grades/' + encodeURIComponent(docId);
  const r = await api('GET', 'firestore.googleapis.com', docPath);
  if (!r.fields) {
    console.log('  ❌ Doc no existe:', docId);
    return false;
  }
  const ec = val(r.fields, 'ec') || 0;
  const pe = val(r.fields, 'pe') || 0;
  const newSuma = calcSuma({ ec, tr: 0, pe });
  const newCal = calcCal(newSuma);

  await api('PATCH', 'firestore.googleapis.com',
    docPath + '?updateMask.fieldPaths=tr&updateMask.fieldPaths=suma&updateMask.fieldPaths=cal&updateMask.fieldPaths=value&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=lastBugFix',
    { fields: {
        tr: { integerValue: '0' },
        suma: numField(newSuma),
        cal: numField(newCal),
        value: numField(newCal),
        updatedAt: { timestampValue: new Date().toISOString() },
        lastBugFix: { stringValue: 'REVERTED-from-v8.25' }
      }});
  console.log('  ✓ Revertido:', docId, '→ tr=0, cal=' + newCal);
  return true;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--all-fix-v8.25') {
    console.log('⚠ Vas a REVERTIR los 372 cambios. ¿Estás seguro? Re-ejecuta con --confirm para aplicar.');
    if (args[1] !== '--confirm') return;
    const corrs = await listColl('gradeCorrections');
    const todays = corrs.filter(function(d){ return val(d.fields, 'type') === 'auto_tr_zero_fix'; });
    console.log('Revirtiendo', todays.length, 'cambios...');
    let ok = 0;
    for (const c of todays) {
      const docId = val(c.fields, 'docId');
      try { await revertOne(docId); ok++; }
      catch (e) { console.log('  ✗', docId, ':', e.message); }
    }
    console.log('Revertidos:', ok, '/', todays.length);
    return;
  }

  if (args[0] === '--group') {
    const groupId = args[1], subjectId = args[3], partial = args[5];
    if (!groupId || !subjectId || !partial) {
      console.error('Uso: --group <gid> --subject <sid> --partial <P1|P2|P3>');
      process.exit(1);
    }
    const corrs = await listColl('gradeCorrections');
    const matches = corrs.filter(function(d){
      const f = d.fields;
      return val(f, 'type') === 'auto_tr_zero_fix'
        && val(f, 'groupId') === groupId
        && val(f, 'subjectId') === subjectId
        && val(f, 'partial') === partial;
    });
    console.log('Encontradas', matches.length, 'correcciones a revertir.');
    for (const c of matches) {
      await revertOne(val(c.fields, 'docId'));
    }
    return;
  }

  // Caso simple: revertir UN alumno
  const [studentId, subjectId, partial] = args;
  if (!studentId || !subjectId || !partial) {
    console.log('Usos:');
    console.log('  node revert-tr-fix.js <studentId> <subjectId> <partial>');
    console.log('  node revert-tr-fix.js --group <groupId> --subject <subjectId> --partial <P1|P2|P3>');
    console.log('  node revert-tr-fix.js --all-fix-v8.25 --confirm');
    process.exit(1);
  }
  const docId = studentId + '_' + subjectId + '_' + partial;
  await revertOne(docId);
}

main().catch(function(e){console.error('ERROR:',e.message);process.exit(1);});
