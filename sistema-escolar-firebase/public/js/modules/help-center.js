/**
 * CENTRO DE AYUDA — capacitación a distancia para los maestros
 *
 * Pensado como REEMPLAZO de una sesión presencial. Incluye:
 *   - Video embebido (Olivia lo graba en su iPhone y mete la URL)
 *   - Tutorial interactivo (lanza OnboardingTour)
 *   - Manual imprimible de 1 hoja (versión rápida) y manual completo (PDF detallado)
 *   - FAQs expandibles
 *   - Checklist de "Primer día"
 *   - Botón directo a WhatsApp con Olivia
 *
 * Acceso: visible en sidebar para TODOS los roles. También se abre
 * automáticamente la primera vez que entra un maestro.
 */

const HelpCenterModule = (() => {

  // URL del video tutorial grabado por Olivia (Loom)
  // Para reemplazar: cambia el ID después de /embed/ por el de tu nuevo video
  const VIDEO_URL = 'https://www.loom.com/embed/acd506e329e34c10962ac776c271d224';

  const FAQS_HELP = [
    {
      q: '⭐ Lo más importante: ¿qué tengo que hacer en estas 4 fechas (11-14 mayo)?',
      icon: 'priority_high',
      a: `<p style="background:#fef3c7;padding:8px 12px;border-radius:6px;border-left:4px solid #d97706;font-weight:600;">
        Tu única tarea CRÍTICA es: <strong>capturar TODAS las calificaciones de TODOS tus grupos</strong>.
      </p>
      <p>Eso significa, por cada grupo+materia que das:</p>
      <ol>
        <li>Capturar las <strong>calificaciones (rubros)</strong> de los 3 parciales — si te falta alguno.</li>
        <li>Capturar las <strong>FALTAS</strong> de cada alumno (obligatorio).</li>
        <li>Capturar las <strong>HORAS IMPARTIDAS</strong> en el ciclo (para calcular el % de faltas).</li>
        <li>Registrar <strong>INCIDENCIAS</strong> de los alumnos reprobados (motivo).</li>
        <li><strong>Imprimir la lista oficial de calificaciones desde Capturar Calificaciones</strong> y llevarla a firmar a tus alumnos. Esa lista firmada se entrega a Subdirección.</li>
      </ol>
      <p>Si terminaste estos 5 pasos para todos tus grupos, terminaste el ciclo. ✅</p>`,
    },
    {
      q: '✏️ ¿Cómo capturo calificaciones? Paso a paso completo',
      icon: 'edit_note',
      a: `<ol>
        <li>Menú izquierdo → <strong>Capturar Calificaciones</strong>.</li>
        <li>Arriba verás <strong>pestañas</strong> con tus asignaciones (grupo + materia). Selecciona la que vas a capturar.</li>
        <li>Selecciona el <strong>parcial</strong>: P1, P2 o P3.</li>
        <li>En la tabla, por cada alumno escribes los <strong>rubros</strong> (las columnas grises a la izquierda).</li>
        <li>El sistema calcula automáticamente <strong>SUMA</strong> y <strong>CALIFICACIÓN</strong>. Tú nunca escribes la calificación final.</li>
        <li>Pulsa <strong>Guardar</strong> arriba a la derecha.</li>
        <li>Cambia a la siguiente pestaña (otro grupo) — usa los botones <strong>← Anterior / Siguiente →</strong> o haz clic en la pestaña directamente.</li>
      </ol>
      <p style="background:#dcfce7;padding:8px 12px;border-radius:6px;border-left:4px solid #16a34a;">
        💡 <strong>Tip rápido:</strong> Si tienes las calificaciones en Excel, puedes <strong>copiar UNA columna entera</strong> (ej: la columna de Evaluación Continua), volver al sistema, hacer clic en la primera celda de Evaluación Continua y pegar (Ctrl+V / Cmd+V). Se llena toda la columna de un jalón. Lo mismo con Transversal, Examen Parcial, Punto Extra y Faltas.
      </p>`,
    },
    {
      q: '📚 ¿Qué significa cada rubro? (Evaluación Continua, Transversal, Examen Parcial, Punto Extra, Faltas)',
      icon: 'menu_book',
      a: `<p>Cada columna gris en captura es un <strong>rubro</strong> de evaluación. Los topes son <strong>oficiales EPO 67</strong> y el sistema los respeta:</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0;">
        <thead style="background:#eff6ff;">
          <tr>
            <th style="padding:6px 8px;text-align:left;border:1px solid #cbd5e0;">Rubro</th>
            <th style="padding:6px 8px;text-align:left;border:1px solid #cbd5e0;">Significado</th>
            <th style="padding:6px 8px;text-align:left;border:1px solid #cbd5e0;">Tope MAT</th>
            <th style="padding:6px 8px;text-align:left;border:1px solid #cbd5e0;">Tope VESP</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>Evaluación Continua</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">Tareas, participación, ejercicios diarios, trabajo en clase</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">máx <strong>8</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">máx <strong>5</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>Transversal</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">Proyectos integradores, valores, lecturas, actividades de competencias transversales</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">máx <strong>2</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">máx <strong>2</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>Examen Parcial</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">Evaluación escrita formal del parcial. <em>SOLO en turno vespertino</em></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;color:#94a3b8;">no aplica</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">máx <strong>3</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>Punto Extra</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">Opcional. Bonificación por trabajos extraordinarios, concursos, etc.</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">opcional</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">opcional</td>
          </tr>
          <tr>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>FALTAS</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;"><strong>Inasistencias</strong> — número de clases que el alumno NO asistió en este parcial. <strong>OBLIGATORIO</strong></td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">entero</td>
            <td style="padding:6px 8px;border:1px solid #cbd5e0;">entero</td>
          </tr>
        </tbody>
      </table>
      <p style="background:#fef3c7;padding:8px 12px;border-radius:6px;border-left:4px solid #d97706;">
        <strong>Reglas que aplica el sistema solo:</strong><br>
        • <strong>SUMA</strong> = Evaluación Continua + Transversal + (Examen Parcial solo vespertino) + Punto Extra<br>
        • Si <strong>SUMA &gt; 10</strong>, se queda en <strong>10</strong>.<br>
        • Si <strong>SUMA &lt; 6</strong>, la calificación = <strong>5</strong> (no 5.5, no 5.9 — directo 5).<br>
        • Si <strong>SUMA ≥ 6</strong>, se redondea normal (ej: 6.4 → 6, 6.5 → 7).
      </p>`,
    },
    {
      q: '📋 ¿Cuál es la diferencia entre "Mis Listas" y la lista que imprimo en Capturar?',
      icon: 'compare_arrows',
      a: `<p>Son DOS cosas distintas y AMBAS las vas a usar:</p>
      <div style="background:#eff6ff;padding:10px 14px;border-radius:6px;border-left:4px solid #3182ce;margin:8px 0;">
        <strong>1. "Mis Listas" (menú izquierdo)</strong><br>
        Para tu <strong>seguimiento diario en el aula</strong>. Imprime listas con:
        <ul>
          <li><strong>15 columnas en blanco</strong> — para pasar lista, anotar tareas, lo que quieras</li>
          <li><strong>Columnas Evaluación Continua, Transversal, Examen Parcial, Punto Extra y Faltas</strong> — para llevar control en papel ANTES de capturar</li>
        </ul>
        Estas listas son tu <strong>cuaderno</strong>. Las usas tú, no se entregan a nadie.
      </div>
      <div style="background:#fef3c7;padding:10px 14px;border-radius:6px;border-left:4px solid #d97706;margin:8px 0;">
        <strong>2. Lista oficial firmada (desde "Capturar Calificaciones")</strong><br>
        Es la <strong>lista que firman los alumnos</strong> y entregas a Subdirección como prueba de que recibieron sus calificaciones. La generas DENTRO del módulo de Capturar:
        <ul>
          <li>Capturas todas las calificaciones del grupo+materia+parcial.</li>
          <li>Pulsas el botón <strong>"Imprimir lista para firma"</strong> arriba.</li>
          <li>Sale un PDF con las calificaciones FINALES (las que calculó el sistema) y un espacio de firma por alumno.</li>
          <li>Imprimes, llevas al salón, los alumnos firman, entregas a Subdirección.</li>
        </ul>
      </div>`,
    },
    {
      q: '⏰ ¿Por qué tengo que capturar las HORAS IMPARTIDAS?',
      icon: 'schedule',
      a: `<p>Las <strong>horas impartidas</strong> son el total de horas-clase que TÚ diste durante el ciclo (o el parcial). El sistema las usa para calcular el <strong>% de faltas</strong>:</p>
      <div style="background:#f8fafc;padding:10px 14px;border-radius:6px;font-family:monospace;text-align:center;margin:8px 0;border:1px solid #cbd5e0;">
        % faltas = (faltas del alumno / horas que diste) × 100
      </div>
      <p>Si NO capturas tus horas, el sistema NO puede saber si el alumno pasó o no del 20% de faltas, y la regla de extraordinario no se aplica.</p>
      <p><strong>Dónde se capturan:</strong></p>
      <ol>
        <li>Menú → <strong>Mis Asignaciones</strong> (o desde Capturar Calificaciones).</li>
        <li>Por cada asignación, abres "Editar".</li>
        <li>Capturas <strong>Horas P1, P2, P3</strong> — cuántas horas-clase diste en cada parcial.</li>
        <li>Guardas.</li>
      </ol>`,
    },
    {
      q: '⚠️ ¿Qué hago si un alumno reprueba (sale 5)? — INCIDENCIA',
      icon: 'warning',
      a: `<p>Cuando un alumno tiene calificación <strong>5</strong>, el sistema te <strong>OBLIGA</strong> a registrar el motivo (incidencia) antes de cambiarte de pestaña, navegar a otro grupo o salir.</p>
      <p>NO es por molestar — es para protegerte:</p>
      <ul>
        <li>Cuando un papá reclama en Orientación, ya está la justificación firmada por ti.</li>
        <li>Queda registrado con fecha y autor automáticamente.</li>
        <li>Si Subdirección audita, sabe quién, cuándo y por qué reprobó.</li>
      </ul>
      <p><strong>Qué escribir en la incidencia:</strong> sé conciso. Ejemplos:</p>
      <ul>
        <li>"No entregó tareas durante el parcial"</li>
        <li>"Faltas excesivas (más del 20%)"</li>
        <li>"No presentó el examen parcial"</li>
        <li>"Bajo rendimiento general — calificaciones inferiores a 6 en todas las evaluaciones"</li>
        <li>"Conducta disruptiva, reportada en bitácora del salón"</li>
      </ul>`,
    },
    {
      q: '📅 ¿Cómo cambio entre mis grupos / asignaciones?',
      icon: 'tab',
      a: `<p>Tienes 3 formas de navegar entre tus grupos:</p>
      <ol>
        <li><strong>Pestañas arriba</strong> en Capturar Calificaciones — cada pestaña es una asignación tuya. Clic para saltar.</li>
        <li><strong>Botones ← Anterior / Siguiente →</strong> — te mueve a la asignación anterior o siguiente. Muestra el nombre del destino antes de cambiar.</li>
        <li>Desde <strong>Inicio (Dashboard)</strong> — verás una tarjeta por cada asignación. Clic en la tarjeta te lleva directo a esa asignación en Capturar.</li>
      </ol>
      <p style="background:#fee2e2;padding:8px 12px;border-radius:6px;border-left:4px solid #dc2626;">
        ⚠ <strong>Antes de cambiar de pestaña</strong>, asegúrate de haber <strong>guardado</strong>. Si tienes alumnos reprobados (cal=5) sin incidencia, el sistema NO te deja cambiar — te obliga a justificar primero.
      </p>`,
    },
    {
      q: '📋 ¿Qué hago en "Mis Listas" exactamente?',
      icon: 'list_alt',
      a: `<p>"Mis Listas" sirve para <strong>imprimir tu cuaderno de seguimiento</strong>. Lo usas en el aula, NO se entrega a nadie.</p>
      <ol>
        <li>Menú → <strong>Mis Listas</strong>.</li>
        <li>Elige el grupo del dropdown.</li>
        <li>4 botones de impresión:
          <ul>
            <li><strong>PDF anotaciones</strong> — 15 columnas en blanco. Para pasar lista, asistencia, lo que quieras.</li>
            <li><strong>Excel anotaciones</strong> — versión editable.</li>
            <li><strong>PDF rubros</strong> — columnas Evaluación Continua, Transversal, Examen Parcial, Punto Extra y Faltas para llevar control en papel ANTES de capturar.</li>
            <li><strong>Excel rubros</strong> — versión editable.</li>
          </ul>
        </li>
      </ol>
      <p>Las listas traen los apellidos y nombres de los alumnos ya impresos. Se ajustan a UNA hoja tamaño carta automáticamente.</p>`,
    },
    {
      q: '✏️ ¿Cómo cambio una calificación que YA guardé?',
      icon: 'rate_review',
      a: `<p style="background:#fef3c7;padding:8px 12px;border-radius:6px;border-left:4px solid #d97706;">
        <strong>Antes del cierre (11-14 mayo):</strong> edita directo en Capturar y guarda. Sin papeleo.
      </p>
      <p style="background:#fee2e2;padding:8px 12px;border-radius:6px;border-left:4px solid #dc2626;">
        <strong>Después del cierre (a partir del 15 de mayo):</strong> ya no puedes editar directo. <strong>OBLIGATORIO crear una solicitud formal</strong>:
      </p>
      <ol>
        <li>Menú → <strong>Cambios de Calificación</strong>.</li>
        <li>Wizard de 4 pasos: eliges asignación → parcial → alumno → escribes calificación nueva (NO puede ser menor a la actual) + motivo.</li>
        <li>El sistema genera un PDF con folio (ej: SC-2026-001234).</li>
        <li>Imprimes el PDF y lo llevas a Dirección para firma de la directora Karina.</li>
        <li><strong>Solo el 17 y 18 de mayo</strong>, Octavio (subdirector) aplica los cambios aprobados en el sistema.</li>
        <li>Recibes notificación cuando se aplique.</li>
      </ol>
      <p>Puedes ver el estado de tus solicitudes en <strong>"Cambios de Calificación"</strong> → "Mis solicitudes recientes". Si fue rechazada, te explica por qué.</p>`,
    },
    {
      q: '📅 ¿Qué pasa si tiene muchas faltas (regla del 20%)?',
      icon: 'event_busy',
      a: `<p>Si un alumno acumula <strong>más del 20%</strong> de faltas sobre las horas que TÚ impartiste, pierde derecho a calificación ordinaria → <strong>EXTRAORDINARIO</strong>.</p>
      <ul>
        <li>El sistema te avisa con un <strong>banner rojo</strong> en la pantalla de captura.</li>
        <li>El estado del alumno cambia a "EXTRA" automáticamente.</li>
        <li>Tú igual capturas sus rubros y faltas — el sistema lo gestiona.</li>
      </ul>
      <p>Ejemplo: si diste 60 horas en el ciclo, el límite del 20% son 12 faltas. Al alumno con 13+ faltas, el sistema lo manda a extraordinario aunque sus calificaciones sean buenas.</p>`,
    },
    {
      q: '🔒 ¿Olvidé mi contraseña, qué hago?',
      icon: 'lock_open',
      a: `<p>3 opciones (de la más rápida a la más lenta):</p>
      <ol>
        <li><strong>Botón verde de WhatsApp</strong> en la esquina inferior → Olivia te resetea en minutos.</li>
        <li><strong>"¿Olvidaste tu contraseña?"</strong> en el login → te llega correo a tu email de respaldo.</li>
        <li>Llamar a Olivia: 55-1078-2357.</li>
      </ol>
      <p style="background:#fef3c7;padding:8px;border-radius:4px;">
        💡 <strong>Tip:</strong> registra un correo personal de respaldo (gmail/hotmail) la primera vez que entres. Es la forma MÁS rápida de recuperar.
      </p>`,
    },
    {
      q: '📅 ¿Cuándo cierra la captura?',
      icon: 'event',
      a: `<p><strong>Calendario mayo 2026:</strong></p>
      <ul>
        <li><strong>11 al 14 de mayo:</strong> Captura abierta (4 días)</li>
        <li><strong>14 de mayo:</strong> Entrega de listas firmadas a Subdirección</li>
        <li><strong>17 y 18 de mayo:</strong> Ventana de correcciones (con solicitud formal aprobada)</li>
        <li><strong>A partir del 19 de mayo:</strong> NADA se puede cambiar. Las calificaciones son definitivas.</li>
      </ul>
      <p style="background:#fee2e2;padding:8px;border-radius:6px;color:#991b1b;">
        ⚠ <strong>NO esperes al último día.</strong> Captura desde el lunes 11. Si dejas todo para el 14 puede fallar el internet o saturarse el sistema.
      </p>`,
    },
    {
      q: '🚫 ¿Las calificaciones en papel son válidas?',
      icon: 'block',
      a: `<p style="background:#fee2e2;padding:10px 14px;border-radius:6px;color:#991b1b;font-weight:600;">
        ⚠ <strong>NO.</strong> Son OFICIALES sí y solo sí están guardadas en el sistema.
      </p>
      <p>Las listas de "Mis Listas" en papel son SOLO apoyo para el aula. Captura SIEMPRE en el sistema.</p>
      <p>La <strong>lista firmada</strong> que entregas a Subdirección se imprime DESDE el sistema (en Capturar Calificaciones), después de capturar todo. Esa lista refleja lo que el sistema tiene guardado.</p>`,
    },
  ];

  function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const role = App?.currentUser?.role || '';
    const isMaestro = ['maestro', 'orientador_docente'].includes(role);
    const firstName = (App?.currentUser?.displayName || 'docente').split(' ').slice(-1)[0];

    container.innerHTML = `
      <div class="module-container" style="max-width:1100px;">
        <!-- HEADER de bienvenida -->
        <div style="background:linear-gradient(135deg,#3182ce 0%,#1e40af 100%);
                    color:#fff;border-radius:14px;padding:28px 32px;margin-bottom:20px;
                    box-shadow:0 8px 24px rgba(49,130,206,0.25);">
          <h1 style="margin:0 0 6px;font-size:26px;">¡Hola, ${Utils.sanitize(firstName)}! 👋</h1>
          <p style="margin:0;font-size:15px;opacity:0.95;">
            Esto es tu Centro de Ayuda. Todo lo que necesitas para usar el sistema sin frustrarte.
            <strong>Lee esta página una vez (5 min) y vas a saber todo.</strong>
          </p>
        </div>

        <!-- LO MÁS IMPORTANTE - destacado en rojo -->
        <div class="card" style="background:#fff7ed;border:2px solid #d97706;margin-bottom:20px;">
          <h2 style="margin:0 0 12px;font-size:20px;color:#92400e;">
            <span class="material-icons-round" style="vertical-align:middle;color:#d97706;">priority_high</span>
            LO MÁS IMPORTANTE: tu única tarea es CAPTURAR CALIFICACIONES
          </h2>
          <p style="margin:0 0 10px;color:#1e293b;font-size:14px;">
            Del <strong>11 al 14 de mayo</strong>, por cada uno de tus grupos+materias debes:
          </p>
          <ol style="margin:0;padding-left:24px;font-size:14px;line-height:1.9;color:#1e293b;">
            <li><strong>Capturar las calificaciones (rubros)</strong> de los 3 parciales que falten.</li>
            <li><strong>Capturar las FALTAS</strong> de cada alumno (obligatorio).</li>
            <li><strong>Capturar las HORAS IMPARTIDAS</strong> que diste durante el ciclo (obligatorio para calcular % faltas).</li>
            <li><strong>Registrar INCIDENCIAS</strong> de los alumnos reprobados (motivo del 5).</li>
            <li><strong>Imprimir la lista oficial</strong> desde Capturar Calificaciones, llevarla a firmar a tus alumnos y entregarla a Subdirección.</li>
          </ol>
          <p style="margin:12px 0 0;background:#fef3c7;padding:10px 14px;border-radius:6px;color:#78350f;font-size:13px;">
            💡 <strong>Tip ahorra-tiempo:</strong> Si tienes calificaciones en Excel, copia UNA columna entera (ej: Evaluación Continua), vuelve al sistema, clic en la primera celda y pega (Cmd+V / Ctrl+V). Se llena toda la columna de un jalón.
          </p>
        </div>

        <!-- ACCESO RÁPIDO: 4 botones gigantes -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
          <button class="hc-action" data-action="start-tour" style="
            display:flex;flex-direction:column;align-items:center;gap:8px;
            background:#fff;border:2px solid #3182ce;border-radius:12px;
            padding:20px;cursor:pointer;transition:all 0.15s;color:#1e40af;font-weight:700;">
            <span class="material-icons-round" style="font-size:36px;color:#3182ce;">tour</span>
            <div>Tutorial guiado</div>
            <small style="font-size:11px;color:#64748b;font-weight:400;">Recorrido por las pantallas (2 min)</small>
          </button>

          <button class="hc-action" data-action="print-manual" style="
            display:flex;flex-direction:column;align-items:center;gap:8px;
            background:#fff;border:2px solid #d97706;border-radius:12px;
            padding:20px;cursor:pointer;transition:all 0.15s;color:#92400e;font-weight:700;">
            <span class="material-icons-round" style="font-size:36px;color:#d97706;">picture_as_pdf</span>
            <div>Manual PDF completo</div>
            <small style="font-size:11px;color:#64748b;font-weight:400;">Detallado, para imprimir</small>
          </button>

          <a href="https://wa.me/525510782357?text=${encodeURIComponent('Hola Olivia, soy ' + (App?.currentUser?.displayName || '') + '. Necesito ayuda con el Sistema Escolar EPO 67.')}"
             target="_blank" rel="noopener" class="hc-action" style="
            display:flex;flex-direction:column;align-items:center;gap:8px;
            background:#fff;border:2px solid #25d366;border-radius:12px;
            padding:20px;cursor:pointer;transition:all 0.15s;color:#166534;font-weight:700;
            text-decoration:none;">
            <span class="material-icons-round" style="font-size:36px;color:#25d366;">support_agent</span>
            <div>WhatsApp con Olivia</div>
            <small style="font-size:11px;color:#64748b;font-weight:400;">Soporte 1:1</small>
          </a>

          <button class="hc-action" data-action="open-search" style="
            display:flex;flex-direction:column;align-items:center;gap:8px;
            background:#fff;border:2px solid #9333ea;border-radius:12px;
            padding:20px;cursor:pointer;transition:all 0.15s;color:#6b21a8;font-weight:700;">
            <span class="material-icons-round" style="font-size:36px;color:#9333ea;">search</span>
            <div>Buscador de dudas</div>
            <small style="font-size:11px;color:#64748b;font-weight:400;">Pregunta como en Google</small>
          </button>
        </div>

        ${isMaestro ? `
        <!-- CHECKLIST PRIMER DÍA -->
        <div class="card" style="background:#f0fdf4;border-left:5px solid #16a34a;margin-bottom:20px;">
          <h2 style="margin:0 0 12px;font-size:18px;color:#166534;">
            <span class="material-icons-round" style="vertical-align:middle;color:#16a34a;">checklist</span>
            Tu primer día — checklist en orden
          </h2>
          <ol style="margin:0;padding-left:24px;font-size:14px;line-height:2;color:#1e293b;">
            <li><strong>Cambia tu contraseña</strong> al entrar (te lo pide el sistema).</li>
            <li><strong>Registra un correo personal de respaldo</strong> (gmail/hotmail). Si la olvidas, te llega ahí.</li>
            <li><strong>Registra tu teléfono WhatsApp</strong> (10 dígitos sin lada).</li>
            <li><strong>Haz el tutorial guiado</strong> (botón azul arriba). Son 2 minutos.</li>
            <li><strong>Imprime el manual PDF</strong> (botón naranja). Detallado para consulta.</li>
            <li>Lee la sección <strong>"Lo más importante"</strong> de arriba.</li>
            <li><strong>Captura un alumno de prueba</strong> en Capturar Calificaciones para verificar que entiendes los rubros.</li>
            <li><strong>Imprime tus listas</strong> en Mis Listas y revísalas.</li>
            <li><strong>Captura tus horas impartidas</strong> (obligatorio para % faltas).</li>
            <li><strong>Guarda este link</strong>: <code style="background:#fff;padding:2px 6px;border-radius:3px;">epo67-sistema.web.app</code></li>
          </ol>
        </div>` : ''}

        <!-- VIDEO TUTORIAL -->
        <div class="card" style="margin-bottom:20px;">
          <h2 style="margin:0 0 12px;font-size:18px;">
            <span class="material-icons-round" style="vertical-align:middle;color:#dc2626;">play_circle</span>
            Video tutorial (5 minutos)
          </h2>
          ${VIDEO_URL ? `
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;">
              <iframe src="${VIDEO_URL}" allowfullscreen
                style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"></iframe>
            </div>
          ` : `
            <div style="background:#f8fafc;border:2px dashed #cbd5e0;border-radius:8px;padding:40px 20px;text-align:center;">
              <span class="material-icons-round" style="font-size:48px;color:#94a3b8;">video_library</span>
              <p style="margin:10px 0 0;color:#475569;font-size:14px;">
                <strong>El video se subirá próximamente.</strong>
              </p>
              <p style="margin:6px 0 0;color:#64748b;font-size:12px;">
                Mientras tanto, usa el <strong>tutorial guiado</strong> arriba o <strong>WhatsApp con Olivia</strong>.
              </p>
            </div>
          `}
        </div>

        <!-- FAQs -->
        <div class="card" style="margin-bottom:20px;">
          <h2 style="margin:0 0 12px;font-size:18px;">
            <span class="material-icons-round" style="vertical-align:middle;color:#3182ce;">quiz</span>
            Preguntas frecuentes (clic para expandir)
          </h2>
          <p style="margin:0 0 14px;color:#64748b;font-size:13px;">
            Estas son las dudas más comunes. ${isMaestro ? 'Si tu pregunta no está aquí, usa el buscador (⌘K) o el WhatsApp con Olivia.' : ''}
          </p>
          <div class="hc-faqs">
            ${FAQS_HELP.map((f, i) => `
              <details ${i === 0 ? 'open' : ''} style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff;">
                <summary style="padding:12px 16px;cursor:pointer;display:flex;gap:10px;align-items:center;font-weight:600;color:#1e293b;font-size:14px;list-style:none;">
                  <span class="material-icons-round" style="color:#3182ce;font-size:22px;flex-shrink:0;">${f.icon}</span>
                  <span style="flex:1;">${Utils.sanitize(f.q)}</span>
                  <span class="material-icons-round" style="color:#94a3b8;font-size:18px;">expand_more</span>
                </summary>
                <div style="padding:0 16px 14px 48px;font-size:13px;color:#334155;line-height:1.6;">
                  ${f.a}
                </div>
              </details>
            `).join('')}
          </div>
        </div>

        <!-- CONTACTO DE EMERGENCIA -->
        <div class="card" style="background:#fff7ed;border-left:5px solid #d97706;">
          <h2 style="margin:0 0 8px;font-size:18px;color:#92400e;">
            <span class="material-icons-round" style="vertical-align:middle;color:#d97706;">emergency</span>
            ¿No encuentras la respuesta?
          </h2>
          <p style="margin:0 0 12px;color:#78350f;font-size:14px;">
            Hay 3 formas de pedir ayuda, en orden de rapidez:
          </p>
          <ol style="margin:0 0 12px;padding-left:24px;color:#1e293b;font-size:14px;line-height:1.8;">
            <li><strong>Buscador (⌘K / Ctrl+K)</strong> — escribe tu duda como en Google. Te explica al instante.</li>
            <li><strong>Botón verde de WhatsApp</strong> en la esquina inferior derecha → mensaje a Olivia.</li>
            <li><strong>Llamada directa:</strong> Olivia · 55 1078 2357 (solo si urge mucho).</li>
          </ol>
        </div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const container = document.getElementById('moduleContainer');
    container.querySelectorAll('.hc-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset?.action;
        if (action === 'start-tour') {
          if (window.OnboardingTour?.start) {
            window.OnboardingTour.start();
          } else {
            Toast.show('Tutorial no disponible. Refresca la página.', 'warning');
          }
        } else if (action === 'print-manual') {
          printManual();
        } else if (action === 'open-search') {
          window.GlobalSearch?.open();
        }
      });
      btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)'; });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = ''; });
    });
  }

  // ─── MANUAL PDF DETALLADO (multi-página) ──────────────────────
  function printManual() {
    const w = window.open('', '_blank');
    if (!w) {
      Toast.show('Activa los pop-ups para imprimir el manual', 'warning');
      return;
    }
    w.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Manual EPO 67 - Sistema Escolar</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; line-height:1.45; font-size:10pt; }
  h1 { font-size:18pt; margin:0 0 4px; color:#1e40af; }
  h2 { font-size:13pt; margin:14px 0 6px; color:#1e40af; border-bottom:2px solid #3182ce; padding-bottom:3px; page-break-after:avoid; }
  h3 { font-size:11pt; margin:10px 0 4px; color:#1e293b; page-break-after:avoid; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; border-bottom:3px solid #3182ce; margin-bottom:14px; }
  .header strong { color:#1e40af; }
  .section { background:#f8fafc; border-left:4px solid #3182ce; padding:8px 14px; border-radius:4px; margin:6px 0; }
  .section.warn { border-left-color:#d97706; background:#fef3c7; }
  .section.danger { border-left-color:#dc2626; background:#fee2e2; }
  .section.success { border-left-color:#16a34a; background:#f0fdf4; }
  .section.info { border-left-color:#3182ce; background:#eff6ff; }
  ol, ul { margin:4px 0; padding-left:20px; }
  li { margin:2px 0; font-size:9.5pt; }
  strong { color:#0f172a; }
  code { background:#fff; padding:1px 5px; border:1px solid #cbd5e0; border-radius:3px; font-size:9pt; font-weight:600; }
  table { width:100%; border-collapse:collapse; margin:6px 0; font-size:9pt; }
  th { background:#eff6ff; text-align:left; padding:5px 8px; border:1px solid #cbd5e0; color:#1e40af; }
  td { padding:5px 8px; border:1px solid #cbd5e0; vertical-align:top; }
  .calendario td { padding:4px 8px; }
  .footer { margin-top:14px; padding-top:8px; border-top:1px dashed #cbd5e0; font-size:8.5pt; color:#64748b; text-align:center; }
  .page-break { page-break-before:always; }
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .center-big { text-align:center; padding:8px; }
  .center-big strong { font-size:13pt; color:#1e40af; }
</style></head><body>

<!-- ENCABEZADO -->
<div class="header">
  <div>
    <h1>SISTEMA ESCOLAR EPO 67</h1>
    <div style="font-size:11pt;color:#475569;font-weight:600;">Manual del Docente — Captura de calificaciones</div>
    <div style="font-size:9pt;color:#64748b;margin-top:2px;">
      Ciclo 2025-2026 · Acceso: <strong>epo67-sistema.web.app</strong>
    </div>
  </div>
  <div style="text-align:right;font-size:9pt;color:#64748b;">
    <strong>Soporte:</strong><br>
    Olivia Peña · 55 1078 2357<br>
    Botón verde WhatsApp en sistema
  </div>
</div>

<!-- TU TAREA EN 5 PASOS -->
<div class="section warn">
  <h2 style="margin-top:0;border:none;color:#92400e;">⭐ Tu tarea del 11 al 14 de mayo — solo 5 pasos</h2>
  <p style="margin:0 0 4px;font-size:9.5pt;">Por cada uno de tus grupos+materias debes hacer estos 5 pasos:</p>
  <ol>
    <li><strong>Capturar las calificaciones</strong> (rubros) de los 3 parciales que falten.</li>
    <li><strong>Capturar las FALTAS</strong> de cada alumno (obligatorio).</li>
    <li><strong>Capturar las HORAS IMPARTIDAS</strong> que diste durante el ciclo (obligatorio).</li>
    <li><strong>Registrar INCIDENCIAS</strong> de alumnos reprobados (motivo del 5).</li>
    <li><strong>Imprimir la lista oficial</strong> desde Capturar, llevarla a firmar a tus alumnos y entregarla a Subdirección.</li>
  </ol>
</div>

<!-- 1. CAPTURAR CALIFICACIONES -->
<h2>1. Cómo capturar calificaciones (paso a paso)</h2>
<ol>
  <li>Menú izquierdo → <strong>Capturar Calificaciones</strong>.</li>
  <li>Arriba aparecen <strong>pestañas</strong>, una por cada asignación tuya (grupo + materia). Selecciona la que vas a capturar.</li>
  <li>Selecciona el <strong>parcial</strong>: P1, P2 o P3.</li>
  <li>En la tabla, por cada alumno escribes los <strong>rubros</strong> (columnas grises a la izquierda). Ver tabla en sección 2.</li>
  <li>El sistema calcula <strong>SUMA</strong> y <strong>CALIFICACIÓN</strong> automáticamente. Tú nunca escribes la calificación final.</li>
  <li>Pulsa <strong>Guardar</strong> arriba a la derecha.</li>
  <li>Cambia a la siguiente pestaña con clic directo o con los botones <strong>← Anterior / Siguiente →</strong>.</li>
</ol>

<div class="section success">
  <strong>💡 Tip ahorra-tiempo:</strong> Si tus calificaciones están en Excel, puedes <strong>copiar UNA columna entera</strong> de Excel, hacer clic en la primera celda del rubro correspondiente en el sistema y pegar (Cmd+V / Ctrl+V). Se llena toda la columna de un jalón. Funciona con Evaluación Continua, Transversal, Examen Parcial, Punto Extra y Faltas.
</div>

<!-- 2. RUBROS -->
<h2>2. ¿Qué significa cada rubro?</h2>
<table>
  <thead>
    <tr><th>Rubro</th><th>Significado</th><th>Tope MAT</th><th>Tope VESP</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>Evaluación Continua</strong></td><td>Tareas, participación, ejercicios diarios, trabajo en clase.</td><td>máx <strong>8</strong></td><td>máx <strong>5</strong></td></tr>
    <tr><td><strong>Transversal</strong></td><td>Proyectos integradores, valores, lecturas, competencias transversales.</td><td>máx <strong>2</strong></td><td>máx <strong>2</strong></td></tr>
    <tr><td><strong>Examen Parcial</strong></td><td>Evaluación escrita formal del parcial. <em>Solo turno vespertino.</em></td><td style="color:#94a3b8;">no aplica</td><td>máx <strong>3</strong></td></tr>
    <tr><td><strong>Punto Extra</strong></td><td>Opcional. Bonificación por trabajos extraordinarios o concursos.</td><td>opcional</td><td>opcional</td></tr>
    <tr><td><strong>FALTAS</strong></td><td><strong>Inasistencias</strong> — número de clases que el alumno NO asistió en el parcial. <strong>OBLIGATORIO.</strong></td><td>entero</td><td>entero</td></tr>
  </tbody>
</table>

<h3>Reglas oficiales que aplica el sistema</h3>
<div class="section warn">
  <ul style="margin:0;">
    <li><strong>SUMA</strong> = Evaluación Continua + Transversal + (Examen Parcial solo vespertino) + Punto Extra</li>
    <li>Si <strong>SUMA &gt; 10</strong>, se queda en <strong>10</strong>.</li>
    <li>Si <strong>SUMA &lt; 6</strong>, calificación = <strong>5</strong> (no 5.5, no 5.9 — directo 5).</li>
    <li>Si <strong>SUMA ≥ 6</strong>, se redondea normal (ej: 6.4→6, 6.5→7).</li>
    <li>Si faltas &gt; 20% de tus horas → alumno pasa a <strong>EXTRAORDINARIO</strong>.</li>
  </ul>
</div>

<!-- 3. FALTAS, INCIDENCIAS, HORAS -->
<h2>3. Lo que ES OBLIGATORIO capturar</h2>
<div class="grid-2">
  <div class="section danger">
    <strong>📅 FALTAS</strong>
    <p style="margin:4px 0 0;font-size:9pt;">Por cada alumno y cada parcial, escribe el número de inasistencias. Es la columna FALTAS en captura. Si dejas vacío, queda en 0 — pero eso puede ser falso.</p>
  </div>
  <div class="section danger">
    <strong>⏰ HORAS IMPARTIDAS</strong>
    <p style="margin:4px 0 0;font-size:9pt;">Cuántas horas-clase diste en cada parcial. Se captura en tu asignación (Mis Asignaciones o desde Capturar). Sin esto, el % de faltas no se puede calcular.</p>
  </div>
  <div class="section danger">
    <strong>⚠️ INCIDENCIAS (motivo del 5)</strong>
    <p style="margin:4px 0 0;font-size:9pt;">Cuando un alumno tiene 5, el sistema te OBLIGA a escribir el motivo antes de cambiar de pestaña. Ejemplos: "no entregó tareas", "faltas excesivas", "no presentó examen".</p>
  </div>
  <div class="section info">
    <strong>📝 Por qué OBLIGATORIO</strong>
    <p style="margin:4px 0 0;font-size:9pt;">Te protege ante reclamos de papás. Si Subdirección audita, queda registrado quién, cuándo y por qué se reprobó.</p>
  </div>
</div>

<!-- PAGE BREAK -->
<div class="page-break"></div>

<!-- 4. NAVEGAR ENTRE LISTAS -->
<h2>4. Navegar entre tus grupos / asignaciones</h2>
<ol>
  <li><strong>Pestañas arriba</strong> en Capturar — clic directo en la pestaña que quieras.</li>
  <li><strong>Botones ← Anterior / Siguiente →</strong> — te muestran el nombre del destino antes de cambiar.</li>
  <li>Desde <strong>Inicio (Dashboard)</strong> — ves una tarjeta por asignación. Clic te lleva directo.</li>
</ol>
<div class="section danger">
  ⚠ Antes de cambiar de pestaña, <strong>guarda tus cambios</strong>. Si tienes alumnos con 5 sin incidencia, el sistema NO te deja salir.
</div>

<!-- 5. LAS DOS LISTAS -->
<h2>5. Las DOS listas que vas a usar</h2>
<table>
  <thead>
    <tr>
      <th style="width:50%;">"Mis Listas" (menú)</th>
      <th style="width:50%;">Lista oficial (desde Capturar)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>
        <strong>Para qué:</strong> tu cuaderno de seguimiento en el aula.<br>
        <strong>Cuándo:</strong> ANTES de capturar (apoyo).<br>
        <strong>Formato:</strong> 15 cols en blanco o cols Evaluación Continua, Transversal, Examen Parcial, Punto Extra y Faltas.<br>
        <strong>Se entrega:</strong> NO. Es tuyo.<br>
        <strong>Cómo imprimir:</strong> Mis Listas → elegir grupo → 4 botones (PDF/Excel × anotaciones/rubros).
      </td>
      <td>
        <strong>Para qué:</strong> que tus alumnos firmen sus calificaciones.<br>
        <strong>Cuándo:</strong> DESPUÉS de capturar todo el grupo+parcial.<br>
        <strong>Formato:</strong> calificaciones FINALES + espacio de firma por alumno.<br>
        <strong>Se entrega:</strong> SÍ, a Subdirección, ya firmada.<br>
        <strong>Cómo imprimir:</strong> Capturar Calificaciones → botón <strong>"Imprimir lista para firma"</strong> arriba.
      </td>
    </tr>
  </tbody>
</table>

<!-- 6. CAMBIOS POSTERIORES -->
<h2>6. ¿Y si me equivoqué? — Cambios después del cierre</h2>
<div class="section info">
  <strong>Antes del cierre (11-14 mayo):</strong> edita directo en Capturar y guarda. Sin papeleo.
</div>
<div class="section danger">
  <strong>A partir del 15 de mayo:</strong> NO puedes editar directo. <strong>OBLIGATORIO crear solicitud formal:</strong>
</div>
<ol>
  <li>Menú → <strong>Cambios de Calificación</strong>.</li>
  <li>Wizard de 4 pasos: asignación → parcial → alumno → nueva calificación (NO menor a la actual) + motivo.</li>
  <li>Sistema genera PDF con folio (ej: SC-2026-001234).</li>
  <li>Imprimes el PDF, lo llevas a Dirección a firma de la directora.</li>
  <li><strong>Solo el 17 y 18 de mayo</strong>, Octavio aplica los cambios aprobados en el sistema.</li>
  <li>Recibes notificación cuando se aplique.</li>
</ol>
<p style="font-size:9pt;color:#475569;">Estado de tus solicitudes: visible en "Cambios de Calificación" → "Mis solicitudes recientes".</p>

<!-- 7. CALENDARIO -->
<h2>7. Calendario crítico de mayo 2026</h2>
<table class="calendario">
  <tr><td><strong>11-14 mayo</strong></td><td>Captura abierta (4 días). Trabaja todos los días.</td></tr>
  <tr><td><strong>14 mayo</strong></td><td>Entrega listas firmadas a Subdirección.</td></tr>
  <tr><td><strong>17-18 mayo</strong></td><td>Ventana de correcciones (con solicitud formal aprobada).</td></tr>
  <tr><td><strong>19 mayo en adelante</strong></td><td>NADA se puede cambiar. Calificaciones definitivas.</td></tr>
</table>
<div class="section danger">
  ⚠ <strong>NO esperes al último día.</strong> El internet falla. Captura desde el 11.
</div>

<!-- 8. AYUDA -->
<h2>8. Si te atoras / olvidas tu contraseña</h2>
<ol>
  <li><strong>⌘K / Ctrl+K</strong> → buscador estilo Google del sistema. Escribe tu duda y te explica.</li>
  <li><strong>Botón verde de WhatsApp</strong> abajo a la derecha → mensaje a Olivia.</li>
  <li><strong>Centro de Ayuda</strong> en el menú → manual + tutorial + FAQ.</li>
  <li><strong>Llamada directa:</strong> 55 1078 2357.</li>
</ol>
<div class="section success">
  <strong>Tip:</strong> registra correo personal de respaldo (gmail/hotmail) la primera vez que entres. Recuperar contraseña te toma 30 segundos.
</div>

<!-- ADVERTENCIA FINAL -->
<div class="section danger" style="margin-top:14px;">
  <h3 style="margin-top:0;color:#991b1b;">⚠ Recuerda siempre</h3>
  <ul>
    <li>Las calificaciones son OFICIALES sí y solo sí están <strong>guardadas en el sistema</strong>.</li>
    <li>Si solo lo escribiste en papel, NO cuenta.</li>
    <li>Tu contraseña es PERSONAL, no la compartas.</li>
    <li>Después del 18 de mayo nadie puede cambiar nada — es definitivo.</li>
  </ul>
</div>

<div class="footer">
  Manual del docente · Sistema Escolar EPO 67 · Ciclo 2025-2026 · Mayo 2026<br>
  Soporte: Olivia Peña — 55 1078 2357 — botón verde de WhatsApp en el sistema
</div>

<script>setTimeout(function(){ window.print(); }, 500);</script>
</body></html>`);
    w.document.close();
  }

  return { render, printManual };
})();

Router.modules['help-center'] = () => HelpCenterModule.render();
