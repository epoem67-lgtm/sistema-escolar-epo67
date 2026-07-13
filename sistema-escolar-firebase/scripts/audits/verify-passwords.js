/**
 * VERIFY PASSWORDS — EPO 67
 *
 * Lee el CSV de credenciales y prueba CADA contraseña haciendo login real
 * contra Firebase Auth. Reporta cuáles funcionan y cuáles fallan.
 *
 * IMPORTANTE: hace login REAL pero NO toca Firestore — solo verifica el
 * endpoint de Auth. No interfiere con la pantalla de "primer ingreso" de
 * la app web (eso solo se dispara cuando entras desde el navegador).
 *
 * Uso:
 *   node scripts/audits/verify-passwords.js credenciales-bulk-2026-05-07.csv
 *
 * Output:
 *   - Reporte en consola: cuántos OK, cuántos fallan, lista de fallidos
 *   - Archivo verify-results-{fecha}.csv con resultado por maestro
 *
 * Si TODAS pasan: tranqui, manda el link al grupo de WhatsApp con confianza.
 * Si alguna falla: el script identifica cuál y puedes resetearla individualmente.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const API_KEY = 'AIzaSyDX4za0avN20Lplmf5LAR7pdfZlvNtvcJc';

const csvFile = process.argv[2];
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Uso: node scripts/audits/verify-passwords.js <ruta-al-csv>');
  console.error('Ejemplo: node scripts/audits/verify-passwords.js credenciales-bulk-2026-05-07.csv');
  process.exit(1);
}

// Parsear CSV
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(csvFile, 'utf-8').replace(/^﻿/, '');
const lines = raw.split('\n').filter(l => l.trim());
lines.shift(); // header
const rows = lines.map(l => parseCSVLine(l)).filter(r => r[4] === 'OK');

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  VERIFICAR CONTRASEÑAS — Sistema Escolar EPO 67`);
console.log(`  Voy a probar ${rows.length} contraseñas haciendo login REAL contra Auth.`);
console.log(`  Esto NO modifica nada — solo verifica que las contraseñas sirvan.`);
console.log(`═══════════════════════════════════════════════════════════\n`);

// Verifica una contraseña intentando signIn
function trySignIn(email, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ email, password, returnSecureToken: true });
    const opts = {
      method: 'POST',
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:signInWithPassword?key=${API_KEY}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else {
          let errMsg = 'desconocido';
          try {
            const j = JSON.parse(data);
            errMsg = j.error?.message || data.slice(0, 100);
          } catch (_) { errMsg = data.slice(0, 100); }
          resolve({ ok: false, error: errMsg });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const results = [];
  let ok = 0, fail = 0;

  for (let i = 0; i < rows.length; i++) {
    const [nombre, email, pwd] = rows[i];
    const progress = `[${i + 1}/${rows.length}]`;
    const result = await trySignIn(email, pwd);
    if (result.ok) {
      console.log(`  ✅ ${progress} ${nombre.padEnd(45).slice(0, 45)} → OK`);
      ok++;
      results.push({ nombre, email, status: 'OK' });
    } else {
      console.log(`  ❌ ${progress} ${nombre.padEnd(45).slice(0, 45)} → ${result.error}`);
      fail++;
      results.push({ nombre, email, status: 'FAIL', error: result.error });
    }
    // Pausa entre requests para no saturar
    if ((i + 1) % 10 === 0 && i < rows.length - 1) {
      await sleep(500);
    } else {
      await sleep(150);
    }
  }

  // Generar CSV de resultados
  const fecha = new Date().toISOString().slice(0, 10);
  const outFile = path.join(process.cwd(), `verify-results-${fecha}.csv`);
  const csvOut = [
    'Nombre,Email,Status,Error',
    ...results.map(r => `"${r.nombre.replace(/"/g, '""')}","${r.email}","${r.status}","${(r.error || '').replace(/"/g, '""')}"`)
  ].join('\n');
  fs.writeFileSync(outFile, '﻿' + csvOut, 'utf-8');

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  RESUMEN`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  ✅ Funcionan correctamente:  ${ok} de ${rows.length}`);
  console.log(`  ❌ Fallaron:                  ${fail}`);
  console.log(`  📄 Reporte completo:          ${outFile}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  if (fail === 0) {
    console.log(`✅ ¡TODAS las contraseñas funcionan! Puedes mandar el link al grupo de WhatsApp con tranquilidad.\n`);
  } else {
    console.log(`⚠ Hay ${fail} contraseña(s) que NO funcionan. Lista de fallidas:\n`);
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   - ${r.nombre} (${r.email}) → ${r.error}`);
    });
    console.log(`\nPara arreglarlas, vuelve a correr el reset:`);
    console.log(`   node scripts/fixes/bulk-reset-passwords.js --apply`);
    console.log(`(El script es idempotente — solo afecta a las que estén pendientes.)\n`);
  }
})();
