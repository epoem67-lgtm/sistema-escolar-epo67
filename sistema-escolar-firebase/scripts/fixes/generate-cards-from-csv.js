/**
 * GENERATE CARDS FROM CSV — EPO 67
 *
 * Lee el CSV generado por bulk-reset-passwords.js y genera un HTML con
 * UNA HOJA por maestro lista para imprimir/PDF/subir a Drive.
 *
 * Uso:
 *   node scripts/fixes/generate-cards-from-csv.js credenciales-bulk-2026-05-06.csv
 *
 * Output:
 *   cartas-maestros-{fecha}.html — abrelo en Chrome y haz Cmd+P → Guardar como PDF.
 *   El PDF resultante tiene 1 hoja por maestro, listo para subir a Drive.
 */

const fs = require('fs');
const path = require('path');

const csvFile = process.argv[2];
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Uso: node generate-cards-from-csv.js <ruta-al-csv>');
  console.error('Ejemplo: node scripts/fixes/generate-cards-from-csv.js credenciales-bulk-2026-05-06.csv');
  process.exit(1);
}

// Leer CSV
const raw = fs.readFileSync(csvFile, 'utf-8').replace(/^﻿/, ''); // quitar BOM
const lines = raw.split('\n').filter(l => l.trim());
const header = lines.shift().split(',');

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const rows = lines.map(l => parseCSVLine(l)).filter(r => r[4] === 'OK');
console.log(`📄 ${rows.length} maestros con reset OK encontrados en ${csvFile}`);

// Generar HTML con 1 hoja por maestro
const pages = rows.map(r => {
  const [nombre, email, pwd, rol] = r;
  const firstName = (nombre || '').split(' ').slice(-1)[0];
  const fname = firstName ? firstName.charAt(0) + firstName.slice(1).toLowerCase() : 'docente';
  return `<section class="letter-page">
    <header class="lh">
      <div class="lh-school">
        <strong>ESCUELA PREPARATORIA OFICIAL No. 67</strong><br>
        <span style="font-size:9pt;color:#64748b;">Sistema Escolar — Acceso para personal docente</span>
      </div>
      <div class="lh-school" style="text-align:right;">
        <span style="font-size:8pt;color:#64748b;">Ciclo escolar 2025-2026<br>Mayo 2026</span>
      </div>
    </header>
    <h1 class="hello">Hola, ${esc(fname)}</h1>
    <p class="intro">Soy Olivia. Tu cuenta personal del Sistema Escolar EPO 67 ya está activa. Aquí están tus datos para entrar y todo lo que necesitas saber para capturar tus calificaciones del 11 al 14 de mayo.</p>
    <div class="creds">
      <h2>🔐 Tus datos de acceso</h2>
      <table>
        <tr><td><strong>Sistema:</strong></td><td><code>https://epo67-sistema.web.app</code></td></tr>
        <tr><td><strong>Tu correo:</strong></td><td><code>${esc(email)}</code></td></tr>
        <tr><td><strong>Contraseña inicial:</strong></td><td><code class="big-pwd">${esc(pwd)}</code></td></tr>
        <tr><td><strong>Tu nombre:</strong></td><td>${esc(nombre)}</td></tr>
        <tr><td><strong>Tu rol:</strong></td><td>${esc(rol)}</td></tr>
      </table>
    </div>
    <div class="grid2">
      <div class="card-info">
        <h2>📅 Calendario crítico mayo 2026</h2>
        <ul>
          <li><strong>11-14 mayo:</strong> Captura abierta</li>
          <li><strong>14 mayo:</strong> Entrega listas firmadas</li>
          <li><strong>17-18 mayo:</strong> Correcciones (con solicitud)</li>
          <li><strong>19+ mayo:</strong> NADA se cambia</li>
        </ul>
      </div>
      <div class="card-info warn">
        <h2>⚠ Reglas importantes EPO 67</h2>
        <ul>
          <li>Si SUMA &lt; 6 → calificación = <strong>5</strong></li>
          <li>Si faltas &gt; 20% → <strong>EXTRAORDINARIO</strong></li>
          <li>Si reprueba (5) → registrar motivo OBLIGATORIO</li>
          <li>Captura: rubros + faltas + horas impartidas</li>
        </ul>
      </div>
    </div>
    <div class="card-info success">
      <h2>📱 Tu primer ingreso (5 minutos)</h2>
      <ol>
        <li>Entra a <strong>epo67-sistema.web.app</strong> en compu o celular.</li>
        <li>Pega tu correo y contraseña inicial (los de arriba).</li>
        <li>El sistema te pide cambiar la contraseña, registrar correo de respaldo y tu teléfono.</li>
        <li>Te lleva al <strong>Centro de Ayuda</strong> con manual completo, video, tutorial y FAQ.</li>
        <li>Imprime tus listas, captura un alumno de prueba.</li>
      </ol>
    </div>
    <footer class="lf">
      <div class="lf-help">
        <strong>🆘 Si te atoras</strong><br>
        Botón verde de WhatsApp en el sistema → Olivia<br>
        O directo: <strong>55 1078 2357</strong><br>
        ⌘K / Ctrl+K → buscador de preguntas frecuentes
      </div>
      <div class="lf-warn">
        <strong>⚠ Tu contraseña es PERSONAL</strong><br>
        No la compartas. La cambias al entrar.<br>
        Si la pierdes, el sistema te ayuda a recuperarla.
      </div>
    </footer>
  </section>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Cartas personales — EPO 67</title>
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; line-height:1.4; font-size:10pt; }
  .letter-page { width: 8.5in; height: 11in; padding: 0.5in; page-break-after: always; display: flex; flex-direction: column; gap: 12px; }
  .lh { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #3182ce; padding-bottom: 8px; }
  .lh-school strong { color:#1e40af; font-size:13pt; }
  h1.hello { font-size: 28pt; margin: 16px 0 8px; color: #1e40af; }
  p.intro { font-size: 11pt; color:#475569; margin: 0 0 12px; }
  .creds { background: #eff6ff; border-left: 5px solid #3182ce; padding: 14px 18px; border-radius: 6px; }
  .creds h2 { margin: 0 0 8px; font-size: 12pt; color:#1e40af; }
  .creds table { width: 100%; }
  .creds td { padding: 3px 0; font-size: 11pt; vertical-align: top; }
  .creds td:first-child { width: 130px; color:#475569; }
  .creds code { background: #fff; padding: 3px 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 11pt; font-weight: 600; color: #1e293b; }
  .creds code.big-pwd { font-size: 14pt; background: #fef3c7; border-color: #d97706; color: #78350f; padding: 5px 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .card-info { background: #f8fafc; border-left: 4px solid #64748b; padding: 10px 14px; border-radius: 6px; }
  .card-info.warn { background: #fef3c7; border-left-color: #d97706; }
  .card-info.success { background: #f0fdf4; border-left-color: #16a34a; }
  .card-info h2 { margin: 0 0 6px; font-size: 11pt; }
  .card-info ul, .card-info ol { margin: 0; padding-left: 16px; font-size: 9.5pt; line-height: 1.5; }
  .card-info li { margin: 1px 0; }
  .lf { margin-top: auto; display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; border-top: 2px dashed #cbd5e0; padding-top: 10px; }
  .lf-help, .lf-warn { font-size: 9pt; line-height: 1.5; padding: 8px 10px; border-radius: 6px; }
  .lf-help { background: #dcfce7; color: #166534; }
  .lf-warn { background: #fee2e2; color: #991b1b; }
</style></head><body>${pages}</body></html>`;

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const fecha = new Date().toISOString().slice(0, 10);
const out = `cartas-maestros-${fecha}.html`;
fs.writeFileSync(out, html, 'utf-8');

console.log(`\n✅ Archivo HTML generado: ${out}`);
console.log(`📄 Contiene ${rows.length} hojas (1 por maestro).\n`);
console.log(`📌 Próximos pasos:`);
console.log(`  1. Abre el archivo en Chrome:  open ${out}`);
console.log(`  2. Cmd+P → "Guardar como PDF" → guardalo como cartas-maestros.pdf`);
console.log(`  3. Sube ese PDF a Google Drive`);
console.log(`  4. Comparte el folder con permiso "ver" para tu personal`);
console.log(`  5. Cada maestro busca SU hoja por nombre y entra al sistema\n`);
