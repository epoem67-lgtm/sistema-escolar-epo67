/**
 * GENERATE INDIVIDUAL CARDS — EPO 67
 *
 * Lee el CSV de bulk-reset-passwords.js y genera UN archivo HTML por maestro
 * en una carpeta `cartas-individuales-{fecha}/`. Cada archivo está nombrado
 * por apellido del maestro para fácil búsqueda en Drive.
 *
 * Uso:
 *   node scripts/fixes/generate-individual-cards.js credenciales-bulk-2026-05-06.csv
 *
 * Output:
 *   cartas-individuales-2026-05-06/
 *     ├── 00_LEEME.txt                       (índice de archivos para Olivia)
 *     ├── ALARCON_VARGAS_MARIO_ALBERTO.html
 *     ├── ALCANTARA_COLIN_JESSICA_NOHEMI.html
 *     ├── ALVARADO_MARTINEZ_ATZIRE_THALIA.html
 *     └── ... 56 archivos más
 *
 * Próximos pasos (Olivia):
 *   1. Abre la carpeta en Finder.
 *   2. Selecciona TODOS los archivos HTML (Cmd+A).
 *   3. Arrástrales a una carpeta nueva en Google Drive.
 *   4. Botón derecho en la carpeta → Compartir → "Cualquier persona con el link" → ver.
 *   5. Copia el link y mándalo al grupo de WA de la escuela.
 *   6. Cada maestro busca SU archivo por su apellido.
 */

const fs = require('fs');
const path = require('path');

const csvFile = process.argv[2];
if (!csvFile || !fs.existsSync(csvFile)) {
  console.error('Uso: node generate-individual-cards.js <ruta-al-csv>');
  console.error('Ejemplo: node scripts/fixes/generate-individual-cards.js credenciales-bulk-2026-05-06.csv');
  process.exit(1);
}

// Leer CSV
const raw = fs.readFileSync(csvFile, 'utf-8').replace(/^﻿/, '');
const lines = raw.split('\n').filter(l => l.trim());
lines.shift(); // header

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

const rows = lines.map(l => parseCSVLine(l)).filter(r => r[4] === 'OK');
console.log(`📄 ${rows.length} maestros con reset OK encontrados.`);

// Crear carpeta destino
const fecha = new Date().toISOString().slice(0, 10);
const dirName = `cartas-individuales-${fecha}`;
if (!fs.existsSync(dirName)) fs.mkdirSync(dirName);

// Función para nombrar archivo (apellido_nombre)
function fileNameFor(displayName) {
  return (displayName || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/gi, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '_');
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Generar HTML completo para UN maestro — versión EXTENSA con tono cálido
function htmlFor(nombre, email, pwd, rol) {
  const firstName = (nombre || '').split(' ').slice(-1)[0];
  const fname = firstName ? firstName.charAt(0) + firstName.slice(1).toLowerCase() : 'docente';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>EPO 67 — Acceso para ${esc(fname)}</title>
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; padding:0; line-height:1.55; font-size:14px; background:#f1f5f9; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 36px; background:#fff; min-height:100vh; box-shadow:0 0 30px rgba(0,0,0,0.06); }
  @media print { body { background:#fff; font-size:11pt; } .wrap { padding: 0.4in; max-width:none; box-shadow:none; } .no-print { display:none !important; } .creds { page-break-inside: avoid; } h2.section-h { page-break-after: avoid; } }

  /* HEADER */
  .lh { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #3182ce; padding-bottom: 14px; margin-bottom: 22px; }
  .lh-school strong { color:#1e40af; font-size:17px; }
  .lh-school span { color:#64748b; }

  /* SALUDO */
  h1.hello { font-size: 34px; margin: 14px 0 6px; color: #1e40af; }
  p.intro { font-size: 16px; color:#334155; margin: 0 0 22px; line-height: 1.6; }
  p.intro-sub { font-size: 14px; color:#475569; background:#fef9c3; padding:12px 16px; border-radius:8px; border-left: 4px solid #ca8a04; margin: 0 0 22px; }

  /* CREDENCIALES */
  .creds { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #3182ce; padding: 22px 26px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 12px rgba(49,130,206,0.1); }
  .creds h2 { margin: 0 0 14px; font-size: 19px; color:#1e40af; }
  .creds table { width: 100%; }
  .creds td { padding: 7px 0; font-size: 15px; vertical-align: top; }
  .creds td:first-child { width: 175px; color:#475569; font-weight:600; }
  .creds code { background: #fff; padding: 5px 12px; border: 1px solid #cbd5e0; border-radius: 5px; font-size: 14px; font-weight: 600; color: #1e293b; user-select: all; }
  .creds code.big-pwd { font-size: 22px; background: #fef3c7; border-color: #d97706; border-width: 2px; color: #78350f; padding: 8px 18px; letter-spacing: 1px; }

  /* SECCIONES */
  h2.section-h { font-size: 21px; color:#1e40af; margin: 28px 0 12px; padding-bottom:6px; border-bottom: 2px solid #cbd5e1; }
  h2.section-h .num { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; background:#3182ce; color:#fff; border-radius:50%; font-size:15px; margin-right:10px; vertical-align:middle; }

  /* CARDS */
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card-info { background: #f8fafc; border-left: 5px solid #64748b; padding: 16px 20px; border-radius: 8px; }
  .card-info.warn { background: #fef3c7; border-left-color: #d97706; }
  .card-info.success { background: #f0fdf4; border-left-color: #16a34a; }
  .card-info.danger { background: #fee2e2; border-left-color: #dc2626; }
  .card-info.info { background: #eff6ff; border-left-color: #3182ce; }
  .card-info.purple { background: #faf5ff; border-left-color: #9333ea; }
  .card-info h3 { margin: 0 0 8px; font-size: 16px; }
  .card-info ul, .card-info ol { margin: 0; padding-left: 22px; font-size: 14px; line-height: 1.7; }
  .card-info li { margin: 3px 0; }
  .card-info p { font-size: 14px; line-height: 1.6; margin: 4px 0; }

  /* PASOS */
  ol.big-steps { padding-left:0; list-style:none; counter-reset: step; }
  ol.big-steps li { counter-increment: step; position: relative; padding: 12px 14px 12px 56px; margin-bottom: 8px; background:#f8fafc; border-radius:8px; border-left: 4px solid #3182ce; line-height: 1.6; }
  ol.big-steps li::before { content: counter(step); position:absolute; left:14px; top:14px; width:30px; height:30px; background:#3182ce; color:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; }

  /* TABLA RUBROS */
  table.rubros { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  table.rubros th { background: #eff6ff; text-align: left; padding: 8px 10px; border: 1px solid #cbd5e0; color: #1e40af; }
  table.rubros td { padding: 8px 10px; border: 1px solid #cbd5e0; vertical-align: top; }

  /* CALENDARIO */
  .cal-row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #cbd5e1; align-items: baseline; }
  .cal-row:last-child { border-bottom: none; }
  .cal-row .date { font-weight: 700; color: #1e40af; }

  /* FAQ */
  details.faq { margin: 6px 0; padding: 12px 16px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; cursor:pointer; }
  details.faq summary { font-weight: 600; color: #1e293b; list-style: none; outline:none; }
  details.faq summary::-webkit-details-marker { display: none; }
  details.faq summary::before { content: "❓ "; }
  details.faq[open] summary::before { content: "💬 "; }
  details.faq p { margin: 8px 0 0; font-size: 13.5px; line-height: 1.6; color: #334155; }

  /* CIERRE */
  .closing { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color:#fff; padding: 24px 28px; border-radius: 12px; margin: 24px 0; }
  .closing h3 { margin: 0 0 8px; font-size: 19px; }
  .closing p { margin: 0; font-size: 14px; line-height: 1.6; }

  /* PIE DE PÁGINA */
  .lf { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; border-top: 2px dashed #cbd5e0; padding-top: 18px; margin-top: 22px; }
  .lf-help, .lf-warn { font-size: 13px; line-height: 1.6; padding: 14px 16px; border-radius: 8px; }
  .lf-help { background: #dcfce7; color: #166534; }
  .lf-warn { background: #fee2e2; color: #991b1b; }

  /* BOTONES */
  .print-btn { position:fixed; top:16px; right:16px; background:#3182ce; color:#fff; border:none; padding:12px 22px; border-radius:8px; cursor:pointer; font-weight:600; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,0.15); z-index:100; }
  .print-btn:hover { background:#2563eb; }

  .system-link { display:inline-block; background:#1e40af; color:#fff; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:16px; margin: 8px 0; box-shadow:0 4px 12px rgba(30,64,175,0.3); }
  .system-link:hover { background:#1e3a8a; }
  .wa-link { display:inline-block; background:#25d366; color:#fff; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px; }
  .wa-link:hover { background:#1da851; }

  strong { color: #0f172a; }
  .text-success { color:#16a34a; font-weight:700; }
  .text-warn { color:#d97706; font-weight:700; }
  .text-danger { color:#dc2626; font-weight:700; }
</style></head><body>

<button class="print-btn no-print" onclick="window.print()">🖨️ Imprimir esta página</button>

<div class="wrap">

  <!-- ───────── HEADER ───────── -->
  <div class="lh">
    <div class="lh-school">
      <strong>ESCUELA PREPARATORIA OFICIAL No. 67</strong><br>
      <span style="font-size:12px;">Sistema Escolar — Acceso personal docente · Ciclo 2025-2026</span>
    </div>
    <div class="lh-school" style="text-align:right;">
      <span style="font-size:11px;">Mayo 2026</span>
    </div>
  </div>

  <!-- ───────── SALUDO ───────── -->
  <h1 class="hello">¡Hola, ${esc(fname)}! 👋</h1>
  <p class="intro">
    Soy <strong>Olivia Peña</strong>. Te escribo personalmente porque quiero que tengas TODO lo que necesitas
    para capturar tus calificaciones de mayo sin estrés. Esta hoja la hice solo para ti — guárdala porque tiene
    tus datos personales y todas las explicaciones que vas a necesitar.
  </p>
  <p class="intro-sub">
    💡 <strong>Antes que nada — relájate.</strong> Sé que un sistema nuevo siempre da nervios, pero te juro que
    en 5 minutos vas a saber usarlo. Si te atoras en CUALQUIER cosa, me avisas por WhatsApp y te ayudo personalmente.
    No estás sola/o.
  </p>

  <!-- ───────── CREDENCIALES ───────── -->
  <div class="creds">
    <h2>🔐 Tus datos de acceso (guarda bien esta página)</h2>
    <table>
      <tr><td>Sistema:</td><td><a href="https://epo67-sistema.web.app" target="_blank"><code>https://epo67-sistema.web.app</code></a></td></tr>
      <tr><td>Tu correo:</td><td><code>${esc(email)}</code></td></tr>
      <tr><td>Contraseña inicial:</td><td><code class="big-pwd">${esc(pwd)}</code></td></tr>
      <tr><td>Tu nombre completo:</td><td>${esc(nombre)}</td></tr>
      <tr><td>Tu rol en el sistema:</td><td>${esc(rol)}</td></tr>
    </table>
    <p style="margin: 14px 0 0; font-size: 13px; color: #475569; line-height:1.6;">
      📝 <strong>Importante:</strong> esta contraseña <strong>SOLO te sirve la PRIMERA vez</strong>. Apenas entres,
      el sistema te va a obligar a cambiarla por una propia que tú elijas (que puedas recordar). Esto es bueno —
      una vez que la cambies, NADIE más la conoce, ni siquiera yo. Es 100% tuya.
    </p>
    <div style="margin-top:14px;">
      <a href="https://epo67-sistema.web.app" target="_blank" class="system-link">🔗 Entrar al Sistema Escolar</a>
    </div>
  </div>

  <!-- ───────── PASO 1: PRIMER INGRESO ───────── -->
  <h2 class="section-h"><span class="num">1</span> Tu primer ingreso (toma 5 minutos, te lo prometo)</h2>
  <p style="margin:0 0 12px;">Lo que va a pasar cuando entres por primera vez:</p>
  <ol class="big-steps">
    <li>
      Abres <strong>epo67-sistema.web.app</strong> en tu computadora o celular (cualquiera funciona, todo se ve igual).
    </li>
    <li>
      En la pantalla de login, escribes tu <strong>correo</strong> y tu <strong>contraseña inicial</strong> (los de arriba).
      Si la contraseña no funciona a la primera, copia y pega la del recuadro amarillo arriba — sin espacios extra.
      Pulsa <strong>"Iniciar Sesión"</strong>.
    </li>
    <li>
      El sistema detecta que es tu primera vez y te lleva a una pantalla de <strong>"Configuración inicial"</strong>.
      <span class="text-success">Esto es normal y solo pasa UNA vez.</span> Te pide 4 cosas:
      <ul style="margin: 6px 0; padding-left: 18px;">
        <li><strong>Tu contraseña temporal:</strong> escribe la misma que ya pusiste arriba.</li>
        <li><strong>Nueva contraseña:</strong> elige una que <em>tú</em> recuerdes (mínimo 8 caracteres). Puede ser
          una palabra+número que uses en otros lados, o algo nuevo. Es tuya.</li>
        <li><strong>Correo de recuperación:</strong> tu correo personal real (gmail, hotmail, outlook). Si algún día
          olvidas tu contraseña, te llega un correo ahí para reiniciarla. <strong class="text-danger">No uses tu correo
          @epo67.local</strong> para esto, NO sirve.</li>
        <li><strong>Tu teléfono WhatsApp:</strong> 10 dígitos sin lada (ejemplo: 5512345678). Lo necesito para mandarte
          avisos importantes y atender dudas rápido.</li>
      </ul>
    </li>
    <li>
      Pulsas <strong>"Guardar y entrar"</strong>. ¡Listo! Ya estás dentro.
    </li>
    <li>
      El sistema automáticamente te abre el <strong>Centro de Ayuda</strong> (botón verde en el menú izquierdo)
      donde tienes el manual completo, las preguntas frecuentes y todo lo que vas a necesitar.
    </li>
  </ol>

  <!-- ───────── PASO 2: TU TAREA ───────── -->
  <h2 class="section-h"><span class="num">2</span> Lo más importante: tu tarea del 11 al 14 de mayo</h2>
  <div class="card-info danger">
    <h3>⭐ Tu única tarea son estas 5 cosas — por cada uno de tus grupos</h3>
    <ol>
      <li><strong>Capturar calificaciones (rubros)</strong> de los 3 parciales que falten.</li>
      <li><strong>Capturar las FALTAS</strong> de cada alumno (obligatorio).</li>
      <li><strong>Capturar las HORAS IMPARTIDAS</strong> que diste durante el ciclo (obligatorio para calcular el % de faltas).</li>
      <li><strong>Registrar INCIDENCIAS</strong> de los alumnos reprobados (motivo del 5).</li>
      <li><strong>Imprimir la lista oficial</strong> desde Capturar Calificaciones, llevarla a firmar a tus alumnos
        y entregarla a Subdirección.</li>
    </ol>
    <p>Si terminaste estos 5 pasos para todos tus grupos, terminaste el ciclo. ✅</p>
  </div>

  <!-- ───────── PASO 3: COMO CAPTURAR ───────── -->
  <h2 class="section-h"><span class="num">3</span> Cómo capturar calificaciones (paso a paso)</h2>
  <ol class="big-steps">
    <li>En el menú izquierdo, clic en <strong>"Capturar Calificaciones"</strong>.</li>
    <li>Arriba aparecen <strong>pestañas</strong> con tus asignaciones (cada pestaña es un grupo+materia que tú das).
      Selecciona la que vas a capturar.</li>
    <li>Selecciona el parcial: <strong>P1</strong>, <strong>P2</strong> o <strong>P3</strong>.</li>
    <li>Para cada alumno escribes los <strong>rubros</strong> en las columnas grises (ver tabla abajo). El sistema
      calcula la SUMA y la CALIFICACIÓN automáticamente — <strong>tú nunca escribes la calificación final.</strong></li>
    <li>Pulsa <strong>"Guardar"</strong> arriba a la derecha. Si hay alumnos reprobados (5), el sistema te va a pedir
      el motivo antes de dejarte salir. Es OBLIGATORIO — no es por molestar, es para protegerte.</li>
    <li>Cambias a la siguiente pestaña con clic directo o con los botones <strong>← Anterior / Siguiente →</strong>.</li>
  </ol>
  <div class="card-info success" style="margin-top:14px;">
    <h3>💡 Tip ahorra-tiempo (esto te va a encantar)</h3>
    <p>
      Si tienes tus calificaciones en <strong>Excel</strong>, puedes copiar UNA columna entera (ej: la columna de E.C.),
      vuelves al sistema, haces clic en la primera celda de E.C. y pegas con <strong>Cmd+V</strong> (Mac) o
      <strong>Ctrl+V</strong> (Windows). <strong>Se llena toda la columna de un jalón.</strong>
      Lo mismo funciona con T.R., E.P., P.E. y FALTAS. Te puede ahorrar 30 minutos por grupo.
    </p>
  </div>

  <!-- ───────── PASO 4: RUBROS ───────── -->
  <h2 class="section-h"><span class="num">4</span> ¿Qué significa cada rubro?</h2>
  <p style="margin:0 0 10px;">Los rubros son las columnas grises en Capturar. Estos son los topes oficiales EPO 67
    que el sistema respeta automáticamente:</p>
  <table class="rubros">
    <thead>
      <tr><th>Rubro</th><th>Significado</th><th>Tope MAT</th><th>Tope VESP</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>E.C.</strong></td>
        <td><strong>Evaluación Continua</strong> — tareas, participación, ejercicios diarios, trabajo en clase</td>
        <td>máx <strong>8</strong></td>
        <td>máx <strong>5</strong></td>
      </tr>
      <tr>
        <td><strong>T.R.</strong></td>
        <td><strong>Transversal</strong> — proyectos integradores, valores, lecturas, competencias transversales</td>
        <td>máx <strong>2</strong></td>
        <td>máx <strong>2</strong></td>
      </tr>
      <tr>
        <td><strong>E.P.</strong></td>
        <td><strong>Examen Parcial</strong> — evaluación escrita formal del parcial. <em>Solo turno vespertino</em></td>
        <td style="color:#94a3b8;">no aplica</td>
        <td>máx <strong>3</strong></td>
      </tr>
      <tr>
        <td><strong>P.E.</strong></td>
        <td><strong>Puntos Extra</strong> — opcional. Bonificación por trabajos extraordinarios o concursos</td>
        <td>opcional</td>
        <td>opcional</td>
      </tr>
      <tr>
        <td><strong>FALTAS</strong></td>
        <td><strong>Inasistencias</strong> — clases que NO asistió en este parcial. <span class="text-danger">OBLIGATORIO</span></td>
        <td>entero</td>
        <td>entero</td>
      </tr>
    </tbody>
  </table>
  <div class="card-info warn" style="margin-top:12px;">
    <h3>📐 Reglas que aplica el sistema solo (no las tienes que calcular tú)</h3>
    <ul>
      <li><strong>SUMA</strong> = E.C. + T.R. + (E.P. solo vesp) + P.E.</li>
      <li>Si <strong>SUMA &gt; 10</strong> → se queda en <strong>10</strong>.</li>
      <li>Si <strong>SUMA &lt; 6</strong> → calificación = <strong>5</strong> (no 5.5, no 5.9, directo 5).</li>
      <li>Si <strong>SUMA ≥ 6</strong> → se redondea normal (6.4 → 6, 6.5 → 7).</li>
      <li>Si <strong>faltas &gt; 20%</strong> de tus horas → alumno pasa a <strong>EXTRAORDINARIO</strong>.</li>
    </ul>
  </div>

  <!-- ───────── PASO 5: LAS DOS LISTAS ───────── -->
  <h2 class="section-h"><span class="num">5</span> Las DOS listas que vas a usar (NO te confundas)</h2>
  <p style="margin:0 0 12px;">Hay dos tipos de listas y cada una sirve para algo distinto:</p>
  <div class="grid2">
    <div class="card-info info">
      <h3>📋 "Mis Listas" (en el menú)</h3>
      <p><strong>Para qué:</strong> tu cuaderno personal en el aula.</p>
      <p><strong>Cuándo:</strong> ANTES de capturar (apoyo).</p>
      <p><strong>Formato:</strong> 15 cols en blanco o con E.C./T.R./E.P./P.E./FALTAS.</p>
      <p><strong>¿Se entrega?</strong> NO. Es solo para ti.</p>
      <p><strong>Cómo:</strong> Mis Listas → grupo → 4 botones (PDF/Excel × anotaciones/rubros).</p>
    </div>
    <div class="card-info warn">
      <h3>📜 Lista oficial firmada (desde Capturar)</h3>
      <p><strong>Para qué:</strong> que tus alumnos firmen sus calificaciones.</p>
      <p><strong>Cuándo:</strong> DESPUÉS de capturar todo el grupo+parcial.</p>
      <p><strong>Formato:</strong> calificaciones FINALES + espacio de firma por alumno.</p>
      <p><strong>¿Se entrega?</strong> SÍ, a Subdirección, ya firmada.</p>
      <p><strong>Cómo:</strong> Capturar Calificaciones → botón <strong>"Imprimir lista para firma"</strong>.</p>
    </div>
  </div>

  <!-- ───────── PASO 6: CALENDARIO ───────── -->
  <h2 class="section-h"><span class="num">6</span> Calendario crítico de mayo 2026</h2>
  <div class="card-info info">
    <div class="cal-row"><div class="date">11-14 mayo</div><div><strong>Captura abierta (4 días).</strong> Trabaja TODOS los días, no dejes para el último.</div></div>
    <div class="cal-row"><div class="date">14 mayo</div><div><strong>Entrega de listas firmadas</strong> a Subdirección.</div></div>
    <div class="cal-row"><div class="date">17-18 mayo</div><div><strong>Ventana de correcciones</strong> (solo con solicitud formal aprobada).</div></div>
    <div class="cal-row"><div class="date">19 mayo+</div><div><span class="text-danger">NADA se cambia.</span> Calificaciones definitivas.</div></div>
  </div>
  <div class="card-info danger" style="margin-top:12px;">
    <p><strong>⚠ NO esperes al último día.</strong> El internet siempre falla en el último momento. Si capturas
      desde el lunes 11, terminas tranquila/o el miércoles. <strong>Mejor pecar de adelantada/o que de atrasada/o.</strong></p>
  </div>

  <!-- ───────── PASO 7: SI TE EQUIVOCAS ───────── -->
  <h2 class="section-h"><span class="num">7</span> ¿Y si me equivoco? — No te preocupes</h2>
  <div class="card-info info">
    <h3>🔄 Antes del 14 de mayo</h3>
    <p>Edita directo en Capturar y guarda. Tantas veces como quieras. <strong>No pasa nada.</strong></p>
  </div>
  <div class="card-info warn" style="margin-top:10px;">
    <h3>📋 Después del 14 de mayo</h3>
    <p>Tienes que hacer una <strong>solicitud formal</strong> en el menú "Cambios de Calificación":</p>
    <ol>
      <li>Eliges asignación → parcial → alumno → calificación nueva (NO menor a la actual) + motivo.</li>
      <li>El sistema genera un PDF con folio (ej: SC-2026-001234).</li>
      <li>Imprimes el PDF y lo llevas a Dirección para firma de la directora Karina.</li>
      <li>Octavio aplica el cambio el 17 o 18 de mayo.</li>
      <li>Recibes notificación cuando se aplique.</li>
    </ol>
  </div>

  <!-- ───────── FAQ ───────── -->
  <h2 class="section-h"><span class="num">8</span> Preguntas frecuentes (las dudas más comunes)</h2>

  <details class="faq">
    <summary>¿Qué pasa si la contraseña inicial no me funciona?</summary>
    <p>Lo más común: estás copiando un espacio de más al final. Borra el campo de contraseña y vuelve a escribirla
      manualmente: <code>${esc(pwd)}</code>. Si sigue sin funcionar, mándame WhatsApp inmediatamente (botón verde
      en el sistema o al 55 1078 2357). Te la reseteo en 30 segundos.</p>
  </details>

  <details class="faq">
    <summary>¿Y si olvido mi nueva contraseña?</summary>
    <p>Tres formas: (1) Botón <strong>"¿Olvidaste tu contraseña?"</strong> en el login → te llega correo a tu
      correo de respaldo. (2) Botón verde de WhatsApp en el sistema → me escribes y te reseteo. (3) Llamada al
      55 1078 2357. Lo importante es que registres bien tu correo de respaldo (gmail/hotmail) la PRIMERA vez —
      eso te ahorra tiempo después.</p>
  </details>

  <details class="faq">
    <summary>¿Qué hago si un alumno reprueba (sale 5)?</summary>
    <p>El sistema te va a OBLIGAR a registrar el motivo antes de salir. Esto NO es por molestar — te protege.
      Cuando un papá reclama en Orientación, ya está la justificación firmada por ti. Solo escribes brevemente:
      "no entregó tareas", "faltas excesivas", "no presentó examen", "bajo rendimiento general". Algo conciso.</p>
  </details>

  <details class="faq">
    <summary>¿Dónde capturo las HORAS IMPARTIDAS?</summary>
    <p>En la pestaña de tu asignación, dentro de Capturar Calificaciones. Hay un campo para horas P1, P2, P3.
      <strong>Es obligatorio</strong> — sin esto, el sistema no puede calcular el % de faltas (regla del 20%).
      Si tienes duda de cuántas horas diste, revisa tu cuaderno o tu agenda escolar.</p>
  </details>

  <details class="faq">
    <summary>¿Puedo capturar desde mi celular?</summary>
    <p>Sí, funciona en celular. Pero te recomiendo computadora (laptop/desktop) porque la tabla de captura es
      más fácil de manejar con teclado y mouse. Para revisiones rápidas o consultas, el celular es perfecto.</p>
  </details>

  <details class="faq">
    <summary>¿Qué pasa si se va el internet a mitad de captura?</summary>
    <p>El sistema guarda un borrador local automáticamente cada poco tiempo. Cuando vuelva el internet, presiona
      "Guardar" y se sube todo. Si tu computadora se apaga, al volver a entrar verás un aviso de "borrador
      pendiente" y puedes recuperar lo que escribiste. <strong>Pero por seguridad: guarda con frecuencia</strong>
      (presiona Guardar después de cada 5-10 alumnos).</p>
  </details>

  <details class="faq">
    <summary>¿Las calificaciones en papel cuentan?</summary>
    <p><strong>NO.</strong> Las calificaciones son OFICIALES sí y solo sí están guardadas en el sistema.
      Si solo lo escribiste en papel y no capturaste, NO cuenta para boleta. El papel es solo tu apoyo personal.
      <span class="text-danger">Captura SIEMPRE en el sistema antes del cierre.</span></p>
  </details>

  <details class="faq">
    <summary>¿Y si no me sale algo o algo se rompe?</summary>
    <p><strong>RESPIRA. No es tu culpa.</strong> Mándame WhatsApp con: (1) qué estabas haciendo, (2) qué esperabas
      que pasara, (3) qué pasó realmente. Si puedes mandar foto de la pantalla, mejor. Te respondo rápido,
      especialmente del 11 al 14 de mayo. <strong>Estoy aquí para ayudarte, no para juzgarte.</strong></p>
  </details>

  <!-- ───────── CIERRE ───────── -->
  <div class="closing">
    <h3>✅ ¡Estás listo/a!</h3>
    <p>
      Esto es todo lo que necesitas saber. <strong>Si lees esta hoja completa y entras al sistema, ya sabes
      el 95% de lo que hay que hacer.</strong> El otro 5% sale solo cuando empieces a usarlo. Y si te atoras,
      yo estoy del otro lado del WhatsApp. Cuenta conmigo.
    </p>
  </div>

  <!-- ───────── PIE DE PÁGINA ───────── -->
  <div class="lf">
    <div class="lf-help">
      <strong>🆘 Si te atoras en cualquier momento</strong><br>
      📱 Botón verde de WhatsApp en el sistema → me llega directo<br>
      📞 O directo: <strong>55 1078 2357</strong><br>
      💻 ⌘K (Mac) / Ctrl+K (Windows) → buscador de preguntas frecuentes dentro del sistema<br>
      📚 Centro de Ayuda en el menú → manual completo
    </div>
    <div class="lf-warn">
      <strong>⚠ Tu contraseña es PERSONAL</strong><br>
      No la compartas con nadie.<br>
      La cambias al entrar.<br>
      Si la pierdes, no entres en pánico — te ayudo a recuperarla.
    </div>
  </div>

  <p style="text-align:center;margin-top:24px;font-size:12px;color:#94a3b8;">
    Sistema Escolar EPO 67 · Ciclo 2025-2026 · Documento personalizado para ${esc(nombre)}<br>
    Generado el ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
  </p>

</div>

</body></html>`;
}

// Generar archivos
let count = 0;
const indexLines = [`ÍNDICE DE CARTAS PERSONALES — ${fecha}\n`,
  `Total maestros: ${rows.length}\n`,
  `Carpeta: ${dirName}/\n`,
  `\n${'─'.repeat(80)}\nLISTA DE ARCHIVOS\n${'─'.repeat(80)}\n`];

rows.sort((a, b) => (a[0] || '').localeCompare(b[0] || ''));

for (const r of rows) {
  const [nombre, email, pwd, rol] = r;
  const safeName = fileNameFor(nombre);
  const filename = `${safeName}.html`;
  const fullPath = path.join(dirName, filename);
  fs.writeFileSync(fullPath, htmlFor(nombre, email, pwd, rol), 'utf-8');
  indexLines.push(`${(count + 1).toString().padStart(3)}. ${filename.padEnd(50)} → ${nombre}`);
  count++;
}

// Crear archivo índice
indexLines.push(`\n${'─'.repeat(80)}\nQUÉ HACER CON ESTOS ARCHIVOS\n${'─'.repeat(80)}\n`);
indexLines.push(`
1. Abre Google Drive en tu navegador (drive.google.com).
2. Crea una carpeta nueva, llamala "EPO 67 - Credenciales 2026" o similar.
3. Arrastra TODOS los archivos .html de esta carpeta (excepto este 00_LEEME.txt).
4. Cuando estén subidos, click derecho en la CARPETA → Compartir.
5. Cambia el acceso a "Cualquier persona con el link" → "Lector".
6. Copia el link de la carpeta.
7. Pégalo en el grupo de WhatsApp del personal con un mensaje como:

   "Compañeros, su acceso al Sistema Escolar EPO 67 está listo.
    En este Drive encuentran su carta personal con sus datos:
    [LINK DRIVE]
    Cada uno busca SU nombre, abre su archivo y entra al sistema.
    Si tienen dudas, hay un botón verde de WhatsApp en el sistema.
    Por favor entren mañana a más tardar para verificar que todo funciona ANTES del 11 de mayo."

8. Cada maestro abre el link, busca su apellido en la lista (Drive permite Ctrl+F),
   abre su archivo .html en el navegador, y ve sus datos personales.
   El archivo es interactivo: puede dar clic en el sistema, copiar la contraseña
   con un clic, e imprimir si quiere.

¡Listo! No necesitas mandar 60 mensajes individuales. Un solo link sirve para todos.

⚠ NOTA DE SEGURIDAD:
   Cualquier persona con el link puede ver TODOS los archivos.
   Como las contraseñas son TEMPORALES (se cambian al primer ingreso),
   el riesgo es bajo. Pero si quieres más seguridad, puedes cambiar el
   permiso de la carpeta a "Restringido" y compartir cada archivo con el
   correo personal del maestro (más trabajo pero más seguro).
`);

fs.writeFileSync(path.join(dirName, '00_LEEME.txt'), indexLines.join('\n'), 'utf-8');

console.log(`\n✅ ${count} archivos HTML generados en: ${dirName}/`);
console.log(`📄 Índice creado en: ${dirName}/00_LEEME.txt\n`);
console.log(`📌 PRÓXIMOS PASOS:`);
console.log(`  1. Abre la carpeta en Finder:  open ${dirName}`);
console.log(`  2. Sube los archivos .html a un folder de Google Drive`);
console.log(`  3. Comparte el folder con permiso "ver" para tu personal`);
console.log(`  4. Manda el link al grupo de WhatsApp de la escuela`);
console.log(`\n  Lee el archivo 00_LEEME.txt para instrucciones detalladas.\n`);
