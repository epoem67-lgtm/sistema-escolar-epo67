// Asigna los 12 presidentes/secretarios de academia (6 MAT + 6 VESP).
//
// MODELO de DATOS:
//   - users/{uid}.academiaGrado: number (1, 2 o 3)
//   - users/{uid}.academiaTurno: string ('MATUTINO' o 'VESPERTINO')
//   - users/{uid}.academiaRol:   string ('presidente' o 'secretario')
//
// El rol BASE del usuario (maestro, orientador_docente, etc.) se PRESERVA.
// Esto permite que sigan haciendo su trabajo normal + ganen acceso a
// Indicadores filtrado a su grado+turno.
//
// Uso:
//   node scripts/fixes/asignar-presidentes-academia.js          # dry-run
//   node scripts/fixes/asignar-presidentes-academia.js --apply  # aplica

const fs = require('fs');
const https = require('https');

const PROJECT_ID = 'epo67-sistema';
const TOKEN_PATH = '/tmp/firebase-access-token.txt';
const APPLY = process.argv.includes('--apply');

// Asignación oficial (definida por Lupita, 22/may/2026)
// Para cada persona buscamos por match parcial de su nombre.
const TARGETS = [
  // ── MATUTINO ──
  { match: 'MARTINEZ PEREZ LAURITA',         grado: 1, turno: 'MATUTINO',   rol: 'presidente' },
  { match: 'MEDRANO VALDEZ CHRISTIAN',       grado: 1, turno: 'MATUTINO',   rol: 'secretario' },
  { match: 'SALAS CASAS BENJAMIN BALDOMERO', grado: 2, turno: 'MATUTINO',   rol: 'presidente' },
  { match: 'SERRANO ESTRADA MIGUEL ANGEL',   grado: 2, turno: 'MATUTINO',   rol: 'secretario' },
  { match: 'BRENA COLIN ERNESTO',            grado: 3, turno: 'MATUTINO',   rol: 'presidente' },
  { match: 'LINARES FLORES ARACELI',         grado: 3, turno: 'MATUTINO',   rol: 'secretario' },
  // ── VESPERTINO ──
  { match: 'MORALES CONTRERAS SARA VANESSA', grado: 1, turno: 'VESPERTINO', rol: 'presidente' },
  { match: 'VIDAL HERNANDEZ SANDRA',         grado: 1, turno: 'VESPERTINO', rol: 'secretario' },
  { match: 'ROMERO BASTIDA MAYDELIN',        grado: 2, turno: 'VESPERTINO', rol: 'presidente' },
  { match: 'ALCANTARA COLIN JESSICA NOHEMI', grado: 2, turno: 'VESPERTINO', rol: 'secretario' },
  { match: 'MORA MARTINEZ TANIA BETHSABE',   grado: 3, turno: 'VESPERTINO', rol: 'presidente' },
  { match: 'ASTORGA GONZALEZ YAQUELIN',      grado: 3, turno: 'VESPERTINO', rol: 'secretario' },
];

const token = fs.readFileSync(TOKEN_PATH, 'utf8').trim();

function api(method, path, body) {
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
          if (r.statusCode >= 400) rej(new Error(`HTTP ${r.statusCode}: ${d.slice(0, 300)}`));
          else res(parsed);
        } catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const fv = (v) => v?.stringValue ?? v?.integerValue ?? null;

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

async function fetchAllUsers() {
  let all = [], pt = null;
  do {
    const r = await api('GET', `/users?pageSize=300${pt ? '&pageToken=' + pt : ''}`);
    all = all.concat(r.documents || []);
    pt = r.nextPageToken;
  } while (pt);
  return all;
}

async function main() {
  console.log(`MODO: ${APPLY ? 'APLICAR CAMBIOS' : 'DRY-RUN (no escribe)'}\n`);
  const users = await fetchAllUsers();
  console.log(`Total usuarios: ${users.length}\n`);

  let totalAsigned = 0, totalOk = 0, totalNotFound = 0, totalErrors = 0;

  for (const t of TARGETS) {
    const targetNorm = normalize(t.match);
    // Solo considerar users con displayName no-vacío. El match es por
    // substring en ambos sentidos pero requiere al menos 4 chars para evitar
    // falsos positivos.
    const matches = users.filter(u => {
      const n = normalize(fv(u.fields?.displayName));
      if (!n || n.length < 4) return false;
      return n === targetNorm || n.includes(targetNorm) || targetNorm.includes(n);
    });

    const label = `${t.grado}° ${t.turno} ${t.rol}`;
    console.log(`── ${t.match.padEnd(40)} → ${label} ──`);

    if (matches.length === 0) {
      console.log(`   ❌ NO ENCONTRADO\n`);
      totalNotFound++;
      continue;
    }
    if (matches.length > 1) {
      console.log(`   ⚠  Múltiples coincidencias: ${matches.map(m => fv(m.fields?.displayName)).join(' | ')}`);
      console.log(`   Usando la primera: ${fv(matches[0].fields?.displayName)}\n`);
    }

    const u = matches[0];
    const uid = u.name.split('/').pop();
    const name = fv(u.fields?.displayName);
    const currentRole = fv(u.fields?.role);
    const curGrado = fv(u.fields?.academiaGrado);
    const curTurno = fv(u.fields?.academiaTurno);
    const curRol = fv(u.fields?.academiaRol);

    if (String(curGrado) === String(t.grado) && curTurno === t.turno && curRol === t.rol) {
      console.log(`   ✓ Ya configurado correctamente (rol base: ${currentRole}). Sin cambio.\n`);
      totalOk++;
      continue;
    }

    console.log(`   uid=${uid.slice(0, 12)}…  rol_base=${currentRole}`);
    console.log(`   academiaGrado: ${curGrado || 'null'} → ${t.grado}`);
    console.log(`   academiaTurno: ${curTurno || 'null'} → ${t.turno}`);
    console.log(`   academiaRol:   ${curRol || 'null'} → ${t.rol}`);

    if (!APPLY) {
      console.log(`   [DRY-RUN] aplicaría los cambios\n`);
      totalAsigned++;
      continue;
    }

    try {
      // PATCH con updateMask para PRESERVAR todos los otros campos
      await api(
        'PATCH',
        `/users/${uid}?updateMask.fieldPaths=academiaGrado&updateMask.fieldPaths=academiaTurno&updateMask.fieldPaths=academiaRol`,
        {
          fields: {
            academiaGrado: { integerValue: String(t.grado) },
            academiaTurno: { stringValue: t.turno },
            academiaRol:   { stringValue: t.rol },
          }
        }
      );
      console.log(`   ✅ Aplicado\n`);
      totalAsigned++;
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}\n`);
      totalErrors++;
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`Resumen: ${totalAsigned} asignados/cambiados, ${totalOk} ya OK, ${totalNotFound} no encontrados, ${totalErrors} errores`);
  if (!APPLY && totalAsigned > 0) {
    console.log('\n👉 Re-ejecuta con --apply para aplicar:');
    console.log('   node scripts/fixes/asignar-presidentes-academia.js --apply');
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
