/**
 * BUSCADOR GLOBAL — accesible desde cualquier pantalla con Cmd+K / Ctrl+K
 * Busca: alumnos, maestros, grupos, materias y módulos.
 * Respeta el rol del usuario (no muestra alumnos a quien no debe verlos).
 */

(function () {
  let _items = [];
  let _loaded = false;
  let _loading = null;

  function _norm(s) {
    return (s || '').toString().toUpperCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ─── BASE DE CONOCIMIENTO (FAQ) — preguntas frecuentes sobre el sistema ───
  // Cuando el maestro escribe algo como "como capturo" o "que pasa si reprueba"
  // el buscador devuelve una respuesta detallada como si fuera Google. NO sale
  // del sistema — todo se muestra dentro del modal del buscador.
  //
  // Cada FAQ tiene:
  //   - q: pregunta principal
  //   - keywords: palabras clave que disparan el match (UPPERCASE, sin acentos)
  //   - a: respuesta en HTML (puede tener listas, negritas, etc.)
  //   - actionModule (opcional): si el maestro hace clic, lo lleva ahí
  //   - actionLabel (opcional): texto del botón de acción
  const FAQS = [
    {
      q: '¿Cómo capturo calificaciones?',
      keywords: ['CAPTURAR', 'CAPTURO', 'CAPTURA', 'CALIFICACION', 'CALIFICACIONES', 'COMO CAPTURO', 'NOTAS', 'EVALUAR', 'ESCRIBIR CALIFICACION', 'COPIAR PEGAR', 'EXCEL'],
      a: `<ol style="margin:0;padding-left:18px;">
        <li>Entra a <strong>Capturar Calificaciones</strong> en el menú izquierdo (o ⌘K → "capturar").</li>
        <li>Selecciona la pestaña de la asignación (grupo + materia) que vas a capturar.</li>
        <li>Selecciona el parcial: <strong>P1</strong>, <strong>P2</strong> o <strong>P3</strong>.</li>
        <li>Para cada alumno escribe los <strong>RUBROS</strong> (no la calificación final):
          <ul style="margin:4px 0;padding-left:18px;">
            <li><strong>Evaluación Continua</strong> — Evaluación continua (máx 8 matutino / 5 vespertino)</li>
            <li><strong>Transversal</strong> — Transversal (máx 2)</li>
            <li><strong>Examen Parcial</strong> — Examen parcial (máx 3, solo vespertino)</li>
            <li><strong>Punto Extra</strong> — Puntos extra (opcional)</li>
            <li><strong>FALTAS</strong> — total de inasistencias (OBLIGATORIO)</li>
          </ul>
        </li>
        <li>El sistema calcula <strong>SUMA</strong> y <strong>CALIFICACIÓN</strong> automáticamente.</li>
        <li>Pulsa <strong>Guardar</strong>.</li>
      </ol>
      <p style="background:#dcfce7;padding:6px 10px;border-radius:4px;margin-top:8px;font-size:12px;">
        💡 <strong>Tip ahorra-tiempo:</strong> Si tus calificaciones están en Excel, copia UNA columna entera, vuelve al sistema y pega (Cmd+V) en la primera celda del rubro. Se llena toda la columna de un jalón.
      </p>`,
      actionModule: 'my-grades',
      actionLabel: 'Ir a Capturar',
    },
    {
      q: '¿Qué significa cada rubro? Evaluación Continua, Transversal, Examen Parcial, Punto Extra',
      keywords: ['RUBRO', 'RUBROS', 'EC', 'TR', 'EP', 'PE', 'EVALUACION CONTINUA', 'TRANSVERSAL', 'EXAMEN PARCIAL', 'PUNTOS EXTRA', 'SIGNIFICADO', 'QUE ES'],
      a: `<table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="background:#eff6ff;"><th style="padding:4px 6px;border:1px solid #cbd5e0;text-align:left;">Rubro</th><th style="padding:4px 6px;border:1px solid #cbd5e0;text-align:left;">Significado</th><th style="padding:4px 6px;border:1px solid #cbd5e0;text-align:left;">Tope MAT</th><th style="padding:4px 6px;border:1px solid #cbd5e0;text-align:left;">Tope VESP</th></tr>
        <tr><td style="padding:4px 6px;border:1px solid #cbd5e0;"><strong>Evaluación Continua</strong></td><td style="padding:4px 6px;border:1px solid #cbd5e0;">Evaluación Continua: tareas, participación, ejercicios, trabajo en clase</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">8</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">5</td></tr>
        <tr><td style="padding:4px 6px;border:1px solid #cbd5e0;"><strong>Transversal</strong></td><td style="padding:4px 6px;border:1px solid #cbd5e0;">Transversal: proyectos integradores, valores, lecturas, competencias</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">2</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">2</td></tr>
        <tr><td style="padding:4px 6px;border:1px solid #cbd5e0;"><strong>Examen Parcial</strong></td><td style="padding:4px 6px;border:1px solid #cbd5e0;">Examen Parcial: evaluación escrita formal (solo vespertino)</td><td style="padding:4px 6px;border:1px solid #cbd5e0;color:#94a3b8;">N/A</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">3</td></tr>
        <tr><td style="padding:4px 6px;border:1px solid #cbd5e0;"><strong>Punto Extra</strong></td><td style="padding:4px 6px;border:1px solid #cbd5e0;">Puntos Extra: opcional, por trabajos extraordinarios</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">opcional</td><td style="padding:4px 6px;border:1px solid #cbd5e0;">opcional</td></tr>
      </table>
      <p style="margin-top:8px;"><strong>SUMA = Evaluación Continua + Transversal + (Examen Parcial solo vesp) + Punto Extra</strong></p>`,
    },
    {
      q: '¿Cómo imprimo la lista para que firmen los alumnos?',
      keywords: ['LISTA FIRMA', 'LISTA FIRMADA', 'IMPRIMIR FIRMA', 'FIRMA ALUMNOS', 'LISTA OFICIAL', 'PARA FIRMAR'],
      a: `<p>La lista oficial que firman los alumnos se imprime <strong>desde Capturar Calificaciones</strong> (NO desde Mis Listas):</p>
        <ol style="margin:0;padding-left:18px;">
          <li>Captura todas las calificaciones del grupo+materia+parcial.</li>
          <li>Guarda.</li>
          <li>Arriba pulsa el botón <strong>"Imprimir lista para firma"</strong>.</li>
          <li>Sale un PDF con calificaciones FINALES + espacio de firma por alumno.</li>
          <li>Imprime, llévala al salón, los alumnos firman, entregas a Subdirección.</li>
        </ol>
        <p style="background:#fef3c7;padding:6px 10px;border-radius:4px;margin-top:8px;font-size:12px;">
          ⚠ Esta es DIFERENTE a "Mis Listas" — esa es solo para tu seguimiento personal en el aula, no se entrega.
        </p>`,
      actionModule: 'my-grades',
      actionLabel: 'Ir a Capturar',
    },
    {
      q: '¿Qué tengo que capturar OBLIGATORIAMENTE?',
      keywords: ['OBLIGATORIO', 'OBLIGATORIAMENTE', 'QUE CAPTURO', 'TODO LO QUE', 'FALTAS HORAS INCIDENCIAS'],
      a: `<p>Por cada uno de tus grupos+materias, son <strong>5 cosas obligatorias</strong>:</p>
        <ol style="margin:0;padding-left:18px;">
          <li><strong>Calificaciones (rubros)</strong> de los 3 parciales que falten.</li>
          <li><strong>FALTAS</strong> de cada alumno por parcial.</li>
          <li><strong>HORAS IMPARTIDAS</strong> que diste durante el ciclo (sin esto no se calcula % faltas).</li>
          <li><strong>INCIDENCIAS</strong> para cada alumno reprobado (sistema te obliga).</li>
          <li><strong>Imprimir lista oficial</strong> desde Capturar y entregarla firmada a Subdirección.</li>
        </ol>`,
    },
    {
      q: '¿Dónde capturo las HORAS IMPARTIDAS?',
      keywords: ['HORAS IMPARTIDAS', 'HORAS', 'DAR HORAS', 'CAPTURAR HORAS', 'PORCENTAJE FALTAS'],
      a: `<p>Las horas que diste durante el ciclo se capturan en tu asignación. El sistema las usa para calcular:</p>
        <p style="background:#f8fafc;padding:6px 10px;border-radius:4px;font-family:monospace;text-align:center;border:1px solid #cbd5e0;">
          % faltas = (faltas alumno / horas que diste) × 100
        </p>
        <ol style="margin:0;padding-left:18px;">
          <li>En Capturar Calificaciones, sobre la asignación abre "Editar horas" o entra a Mis Asignaciones.</li>
          <li>Captura horas P1, P2, P3.</li>
          <li>Guarda.</li>
        </ol>
        <p>Sin esto, la regla del 20% de faltas NO se aplica y los extraordinarios no se detectan.</p>`,
    },
    {
      q: '¿Cómo cambio entre mis grupos / asignaciones?',
      keywords: ['CAMBIAR GRUPO', 'NAVEGAR GRUPOS', 'PESTANIAS', 'PESTANAS', 'SIGUIENTE GRUPO', 'OTRO GRUPO', 'NAVEGAR ASIGNACIONES'],
      a: `<p>3 formas:</p>
        <ol style="margin:0;padding-left:18px;">
          <li><strong>Pestañas arriba</strong> en Capturar — clic directo.</li>
          <li><strong>Botones ← Anterior / Siguiente →</strong> — muestra el nombre del destino.</li>
          <li>Desde <strong>Inicio (Dashboard)</strong> — clic en la tarjeta de la asignación.</li>
        </ol>
        <p style="background:#fee2e2;padding:6px 10px;border-radius:4px;margin-top:8px;font-size:12px;color:#991b1b;">
          ⚠ Antes de cambiar, GUARDA. Si tienes alumnos con 5 sin incidencia, el sistema NO te deja salir.
        </p>`,
    },
    {
      q: '¿Por qué la calificación se vuelve 5 si la suma es 5.5?',
      keywords: ['REGLA', 'REGLA DEL 5', 'CINCO', 'REPROBADO', 'CALIFICACION 5', 'PORQUE 5', 'REDONDEO', 'TRUNCAR', 'POR QUE 5'],
      a: `<p>Es <strong>regla oficial EPO 67</strong>:</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Si la <strong>SUMA &lt; 6</strong>, la calificación es siempre <strong>5</strong> (no 5.9, no 5.5 — directo 5).</li>
          <li>Si la <strong>SUMA ≥ 6</strong>, se redondea normal (ej: 6.4 → 6, 6.5 → 7).</li>
          <li>Si la <strong>SUMA &gt; 10</strong>, se queda en <strong>10</strong>.</li>
        </ul>
        <p>El sistema lo aplica solo. No tienes que calcular nada.</p>`,
    },
    {
      q: '¿Qué hago si un alumno reprueba (sale 5)?',
      keywords: ['REPROBADO', 'REPROBO', 'REPRUEBA', 'INCIDENCIA', 'ALUMNO REPROBADO', 'CINCO', 'JUSTIFICAR', 'MOTIVO REPROBACION'],
      a: `<p>Cuando un alumno tiene calificación <strong>5</strong>, el sistema te va a pedir <strong>OBLIGATORIAMENTE</strong> que registres el motivo antes de cambiar de pestaña o salir.</p>
        <p>Esto NO es por molestar — es para protegerte:</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Cuando un papá llegue a Orientación a reclamar, ya está la justificación firmada.</li>
          <li>Queda registrado en el sistema con fecha y autor.</li>
          <li>Si Subdirección audita, sabe exactamente quién, cuándo y por qué reprobó.</li>
        </ul>
        <p>Solo escribe brevemente: "no entregó tareas", "faltas excesivas", "no presentó examen", etc.</p>`,
    },
    {
      q: '¿Cómo imprimo las listas para el salón?',
      keywords: ['IMPRIMIR', 'IMPRIMIR LISTAS', 'LISTA', 'LISTAS', 'LISTAS DEL SALON', 'PASAR LISTA', 'IMPRESION', 'PDF', 'EXCEL'],
      a: `<ol style="margin:0;padding-left:18px;">
        <li>Entra a <strong>Mis Listas</strong> en el menú.</li>
        <li>Elige el grupo del dropdown.</li>
        <li>Tienes 4 opciones de impresión:
          <ul style="margin:4px 0;padding-left:18px;">
            <li><strong>PDF anotaciones</strong> — 15 columnas en blanco para pasar lista o lo que quieras</li>
            <li><strong>Excel anotaciones</strong> — la versión editable</li>
            <li><strong>PDF rubros</strong> — columnas Evaluación Continua/Transversal/Examen Parcial/Punto Extra/FALTAS para llevar control en papel antes de capturar</li>
            <li><strong>Excel rubros</strong> — la versión editable</li>
          </ul>
        </li>
      </ol>
      <p>Todos los PDFs se ajustan a una sola hoja tamaño carta automáticamente.</p>`,
      actionModule: 'my-lists',
      actionLabel: 'Ir a Mis Listas',
    },
    {
      q: '¿Qué pasa si un alumno tiene muchas faltas?',
      keywords: ['FALTAS', 'INASISTENCIA', '20%', 'EXTRAORDINARIO', 'PIERDE DERECHO', 'ASISTENCIA', 'PORCENTAJE FALTAS'],
      a: `<p>Si un alumno acumula <strong>más del 20% de faltas</strong> sobre las horas que TÚ impartiste, pierde derecho a calificación ordinaria y se va a <strong>EXTRAORDINARIO</strong>.</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>El sistema te avisa con un <strong>banner rojo</strong> en la pantalla de captura.</li>
          <li>Las horas impartidas las registras en el módulo de tu materia (cuántas clases diste).</li>
          <li>El cálculo se hace automático: <em>faltas / horas impartidas × 100</em>.</li>
        </ul>`,
    },
    {
      q: '¿Cómo cambio una calificación que ya guardé?',
      keywords: ['CORREGIR', 'CORRECCION', 'CAMBIAR CALIFICACION', 'EQUIVOCAR', 'ERROR', 'ME EQUIVOQUE', 'MODIFICAR CALIFICACION', 'ACTUALIZAR NOTA', 'EDITAR CALIFICACION'],
      a: `<p>Mientras la captura esté <strong>abierta</strong> (del 11 al 14 de mayo): puedes cambiar la calificación directo en <strong>Capturar Calificaciones</strong>, simplemente edita los rubros y guarda.</p>
        <p>Si ya cerró la captura: tienes que crear una <strong>solicitud formal</strong> en <strong>Cambios de Calificación</strong>:</p>
        <ol style="margin:6px 0;padding-left:18px;">
          <li>Eliges asignación → parcial → alumno.</li>
          <li>Escribes la calificación nueva (NUNCA puede ser menor a la actual).</li>
          <li>Escribes el motivo del cambio.</li>
          <li>El sistema genera un PDF con folio.</li>
          <li>Imprimes el PDF y lo llevas a Dirección para firma de la directora.</li>
          <li>Octavio aplica el cambio en el sistema entre <strong>17 y 18 de mayo</strong>.</li>
        </ol>`,
      actionModule: 'correction-request',
      actionLabel: 'Crear solicitud',
    },
    {
      q: '¿Qué hago si olvidé mi contraseña?',
      keywords: ['CONTRASEÑA', 'PASSWORD', 'OLVIDE', 'RECUPERAR CONTRASEÑA', 'RESETEAR', 'NO PUEDO ENTRAR', 'NO ENTRO', 'LOGIN PROBLEMA', 'PERDI CONTRASEÑA'],
      a: `<p>Tienes 3 opciones (de la más rápida a la más lenta):</p>
        <ol style="margin:6px 0;padding-left:18px;">
          <li><strong>Botón verde de WhatsApp</strong> (esquina inferior derecha): mándale mensaje a Olivia y te resetea la contraseña en minutos.</li>
          <li><strong>"¿Olvidaste tu contraseña?"</strong> en la pantalla de login: te llega un correo a tu email de recuperación (gmail/hotmail).</li>
          <li>Llama directamente a Olivia: 55-1078-2357.</li>
        </ol>
        <p style="background:#fef3c7;padding:6px 8px;border-radius:4px;margin-top:8px;font-size:12px;">
          💡 <strong>Tip:</strong> Cuando ingreses por primera vez, registra un correo de recuperación REAL (gmail/hotmail). Es la forma más rápida de recuperar tu contraseña sin esperar.
        </p>`,
    },
    {
      q: '¿Cuándo cierra la captura de calificaciones?',
      keywords: ['CIERRE', 'CIERRE CAPTURA', 'FECHA LIMITE', 'CUANDO CIERRA', 'HASTA CUANDO', 'PLAZO', '14 MAYO', 'MAYO', 'FECHAS', 'CALENDARIO'],
      a: `<p><strong>Calendario de mayo 2026:</strong></p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li><strong>Captura:</strong> del 11 al 14 de mayo (4 días)</li>
          <li><strong>Entrega de listas firmadas:</strong> 14 de mayo en Subdirección</li>
          <li><strong>Ventana de correcciones:</strong> solo 17 y 18 de mayo (con solicitud formal aprobada)</li>
        </ul>
        <p style="background:#fee2e2;padding:6px 8px;border-radius:4px;color:#991b1b;font-size:12px;">
          ⚠ <strong>NO esperes al último día.</strong> Si dejas todo para el 14 va a fallar el internet o se va a saturar el sistema. Captura desde el lunes 11.
        </p>`,
    },
    {
      q: '¿Cuándo veo el Concentrado F1?',
      keywords: ['F1', 'CONCENTRADO', 'CONCENTRADO F1', 'ACUMULADO', 'TRES PARCIALES', 'FINAL DEL CICLO'],
      a: `<p><strong>Concentrado F1</strong> es el documento oficial que entregas a Subdirección al FINAL del ciclo, con los 3 parciales acumulados.</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li><strong>NO lo imprimas</strong> antes de tener los 3 parciales completos — no es válido si falta uno.</li>
          <li>Se ve por asignación: P1 / P2 / P3 / Acumulado / Final.</li>
          <li>Trae KPIs: alumnos, promedio, atención, % faltas, alumnos con 2 parciales reprobados.</li>
          <li>Se exporta a Excel y a impresión.</li>
        </ul>`,
      actionModule: 'my-f1',
      actionLabel: 'Ir a Concentrado F1',
    },
    {
      q: '¿Cómo veo mi tutorial de bienvenida otra vez?',
      keywords: ['TUTORIAL', 'BIENVENIDA', 'GUIA', 'AYUDA', 'COMO USAR', 'EMPEZAR', 'COMENZAR'],
      a: `<p>El tutorial inicial sale automáticamente la primera vez que entras. Si ya lo cerraste y quieres verlo de nuevo:</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Hay un botón verde <strong>"Ver tutorial otra vez"</strong> abajo en el menú lateral.</li>
          <li>O en la consola del navegador (F12): <code>OnboardingTour.start()</code></li>
        </ul>`,
    },
    {
      q: '¿Cómo busco un alumno?',
      keywords: ['BUSCAR ALUMNO', 'ENCONTRAR ALUMNO', 'COMO BUSCO', 'BUSCADOR', 'ALUMNO ESPECIFICO', 'POR FOLIO', 'POR NOMBRE'],
      a: `<p>Tres formas:</p>
        <ol style="margin:6px 0;padding-left:18px;">
          <li><strong>Aquí mismo</strong>: escribe el nombre o el folio (ej: "MARIA LOPEZ" o "6077").</li>
          <li><strong>Consulta por Alumno</strong> en el menú: te da el perfil completo (calificaciones de los 3 parciales, faltas, asistencia).</li>
          <li><strong>Mis Listas</strong>: ves a TODOS tus alumnos por grupo.</li>
        </ol>
        <p style="font-size:12px;color:#64748b;">El buscador respeta tu rol: como maestro solo ves a tus alumnos, no a los de la escuela.</p>`,
    },
    {
      q: '¿Las calificaciones en papel son válidas?',
      keywords: ['PAPEL', 'OFICIAL', 'OFICIALES', 'VALIDAS', 'VALIDA', 'CUENTA', 'NO CUENTA', 'PAPELES'],
      a: `<p style="background:#fee2e2;padding:8px 12px;border-radius:6px;color:#991b1b;font-weight:600;">
        ⚠ <strong>NO.</strong> Las calificaciones son OFICIALES sí y solo sí están <strong>guardadas en el sistema</strong>.
      </p>
      <p>Si lo escribiste solo en papel y no capturaste:</p>
      <ul style="margin:6px 0;padding-left:18px;">
        <li>NO cuenta para boleta oficial.</li>
        <li>NO se acumula en F1.</li>
        <li>NO te lo van a aceptar en Subdirección.</li>
      </ul>
      <p>Las listas de papel que imprime <strong>Mis Listas</strong> (con o sin rubros) son SOLO un apoyo para el aula. Captura siempre en el sistema antes del cierre.</p>`,
    },
    {
      q: '¿Qué hago si no me sale algo / hay un error?',
      keywords: ['ERROR', 'NO ME SALE', 'NO FUNCIONA', 'AYUDA', 'PROBLEMA', 'BUG', 'NO ME DEJA', 'ATORADO', 'TRABADO'],
      a: `<p>Botón verde de WhatsApp en la esquina inferior derecha → manda mensaje a Olivia. Va directo, te contesta rápido (especialmente del 11 al 14 de mayo).</p>
        <p>Cuando le escribas, ayuda mucho si dices:</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Qué estabas haciendo (ej: "estaba capturando 1°1 matutino, parcial 2")</li>
          <li>Qué esperabas que pasara</li>
          <li>Qué pasó realmente (ej: "el botón no responde", "salió un error rojo")</li>
          <li>Si puedes mandar foto/captura del error, mejor.</li>
        </ul>`,
    },
    {
      q: '¿Cómo veo a los alumnos en riesgo?',
      keywords: ['RIESGO', 'ALUMNOS EN RIESGO', 'BAJO RENDIMIENTO', 'REPROBADOS', 'EN RIESGO'],
      a: `<p>En el menú: <strong>Alumnos en Riesgo</strong>. Verás:</p>
        <ul style="margin:6px 0;padding-left:18px;">
          <li>Alumnos con 1, 2 o 3+ materias reprobadas.</li>
          <li>Alumnos con + 20% de faltas.</li>
          <li>Alumnos con incidencias.</li>
        </ul>
        <p>Como maestro ves a los alumnos de tus grupos. Como orientador ves los de tu turno completo.</p>`,
      actionModule: 'my-at-risk',
      actionLabel: 'Ver Riesgo',
    },
  ];

  function _faqMatches(query) {
    const q = _norm(query);
    if (!q || q.length < 2) return [];
    const words = q.split(/\s+/).filter(w => w.length >= 2);
    const matches = [];
    FAQS.forEach(f => {
      let score = 0;
      const allText = _norm(f.q + ' ' + (f.keywords || []).join(' '));
      // Match completo de palabras clave (alta confianza)
      f.keywords.forEach(kw => {
        if (q.includes(_norm(kw))) score += 50;
      });
      // Match palabra por palabra (mediana confianza)
      words.forEach(w => {
        if (allText.includes(w)) score += 8;
      });
      // Match parcial (substring)
      if (allText.includes(q)) score += 30;
      if (score > 0) matches.push({ ...f, score });
    });
    return matches.sort((a, b) => b.score - a.score).slice(0, 4);
  }

  // Lista de módulos accesibles según ACCESS de Router
  function _moduleItems() {
    const role = App.currentUser?.role;
    const fullMods = [
      { name: 'Inicio', module: 'dashboard', icon: 'dashboard' },
      { name: 'Capturar Calificaciones', module: 'my-grades', icon: 'edit_note' },
      { name: 'Mis Listas', module: 'my-lists', icon: 'list_alt' },
      { name: 'Consultar Calificaciones', module: 'grades-query', icon: 'visibility' },
      { name: 'Cambios de Calificación', module: 'correction-request', icon: 'rate_review' },
      { name: 'Concentrado F1', module: 'my-f1', icon: 'grid_on' },
      { name: 'Alumnos en Riesgo', module: 'my-at-risk', icon: 'report_problem' },
      { name: 'Consulta por Alumno', module: 'student-profile', icon: 'person_search' },
      { name: 'Inscripciones', module: 'enrollment', icon: 'how_to_reg' },
      { name: 'Listas de Alumnos', module: 'students', icon: 'groups' },
      { name: 'Datos de la Escuela', module: 'school-config', icon: 'settings' },
      { name: 'Docentes y Asignaciones', module: 'teachers', icon: 'people' },
      { name: 'Cierre de Parciales', module: 'partial-close', icon: 'lock' },
      { name: 'Monitor de Captura', module: 'captura-progress', icon: 'fact_check' },
      { name: 'Usuarios', module: 'users-mgmt', icon: 'admin_panel_settings' },
      { name: 'Bitácora de Cambios', module: 'bitacora', icon: 'history' },
      { name: 'Correcciones de Calificaciones', module: 'grade-corrections', icon: 'rate_review' },
      { name: 'Preboletas', module: 'boletas', icon: 'description' },
      { name: 'Boleta Oficial', module: 'boleta-oficial', icon: 'verified' },
      { name: 'Concentrado', module: 'concentrado', icon: 'grid_on' },
      { name: 'Alumnos en Riesgo (Orientación)', module: 'at-risk', icon: 'warning' },
      { name: 'Indicadores', module: 'indicadores', icon: 'insights' },
      { name: 'Reportes Comparativos', module: 'reports-comparative', icon: 'compare_arrows' },
      { name: 'Cuadros de Honor', module: 'honor-roll', icon: 'emoji_events' },
    ];
    // Filtrar por permisos
    return fullMods.filter(m => {
      const allowed = Router?.ACCESS?.[m.module];
      if (!allowed) return true; // sin restricción explicita = mostrar
      return allowed.some(r => App.canActAs && App.canActAs(r));
    }).map(m => ({ ...m, type: 'module' }));
  }

  async function _load() {
    if (_loaded) return _items;
    if (_loading) return _loading;

    _loading = (async () => {
      const items = [];
      // 1) Modulos
      _moduleItems().forEach(m => items.push(m));

      // 2) Datos según rol
      const role = App.currentUser?.role;
      const isAdminLike = ['admin', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'].includes(role);

      try {
        if (isAdminLike) {
          // Admin/etc: cargar todo
          const [students, teachers, groups, subjects] = await Promise.all([
            Store.getStudents().catch(() => []),
            Store.getTeachers().catch(() => []),
            Store.getGroups().catch(() => []),
            Store.getSubjects().catch(() => []),
          ]);
          students.forEach(s => {
            if (s.estatus !== 'BAJA') {
              items.push({
                type: 'student',
                name: s.nombreCompleto || s.nombre || '',
                detail: `${s.grupo || ''} · Folio ${s.folio || s.expediente || ''}`,
                icon: 'person',
                module: 'student-profile',
                payload: { studentId: s.docId || s.id }
              });
            }
          });
          teachers.forEach(t => {
            if (t.status === 'active') {
              items.push({
                type: 'teacher',
                name: t.nombre || '',
                detail: `Docente · ${t.turno || ''}`,
                icon: 'school',
                module: 'teachers',
              });
            }
          });
          groups.forEach(g => {
            items.push({
              type: 'group',
              name: `Grupo ${g.nombre || ''}`,
              detail: `Grado ${g.grado || ''}° · ${g.turno || ''}`,
              icon: 'groups',
              module: 'students',
            });
          });
          subjects.forEach(s => {
            items.push({
              type: 'subject',
              name: K?.getUACNombre?.(s.nombre) || s.nombre,
              detail: `Materia · Grado ${s.grado || ''}°`,
              icon: 'menu_book',
              module: 'teachers',
            });
          });
        } else {
          // Maestro/Orientador: cargar solo los datos a los que tiene acceso.
          // v8.09: STRICT — usar getOwnAssignments() para que un maestro con
          // role aditivo (Jessica) NO pueda buscar alumnos de otros grupos.
          const myAsg = await Store.getOwnAssignments().catch(() => []);
          const myGroupIds = [...new Set(myAsg.map(a => a.groupId))];
          const [students, groups] = await Promise.all([
            myGroupIds.length ? Store.getStudentsByGroups(myGroupIds).catch(() => []) : Promise.resolve([]),
            Store.getGroups().catch(() => []),
          ]);
          students.forEach(s => {
            if (s.estatus !== 'BAJA') {
              items.push({
                type: 'student',
                name: s.nombreCompleto || s.nombre || '',
                detail: `${s.grupo || ''} · Folio ${s.folio || s.expediente || ''}`,
                icon: 'person',
                module: 'student-profile',
                payload: { studentId: s.docId || s.id }
              });
            }
          });
          // Asignaciones (combinación grupo+materia)
          myAsg.forEach(a => {
            items.push({
              type: 'assignment',
              name: `${a.groupName} · ${K?.getUACNombre?.(a.subjectName) || a.subjectName}`,
              detail: `Mi asignación · ${a.turno || ''}`,
              icon: 'assignment',
              module: 'my-grades',
            });
          });
        }
      } catch (e) {
        console.warn('Buscador global: error cargando datos', e);
      }

      _items = items;
      _loaded = true;
      _loading = null;
      return items;
    })();
    return _loading;
  }

  function _searchScore(item, query) {
    const q = _norm(query);
    if (!q) return 0;
    const name = _norm(item.name);
    const detail = _norm(item.detail || '');
    if (name.startsWith(q)) return 100;
    if (name.includes(q)) return 50;
    if (detail.includes(q)) return 20;
    // Por palabras
    const words = q.split(/\s+/).filter(Boolean);
    let score = 0;
    words.forEach(w => {
      if (name.includes(w)) score += 10;
      if (detail.includes(w)) score += 3;
    });
    return score;
  }

  function _renderResults(query) {
    const root = document.getElementById('gsResults');
    if (!root) return;
    if (!query || query.length < 1) {
      // Estado inicial: sugerencias de qué buscar y cómo
      const role = App.currentUser?.role || '';
      const isMaestro = role === 'maestro' || role === 'orientador_docente';
      const isOrient = role === 'orientador' || role === 'orientador_docente';

      const suggestions = [];
      if (isMaestro) {
        suggestions.push(
          { icon: 'edit_note', text: 'Capturar Calificaciones', label: 'Tu tarea principal — escribir rubros', module: 'my-grades' },
          { icon: 'list_alt', text: 'Mis Listas', label: 'Imprimir listas para el salón', module: 'my-lists' },
          { icon: 'rate_review', text: 'Cambios de Calificación', label: 'Solicitar correcciones formales', module: 'correction-request' },
          { icon: 'grid_on', text: 'Concentrado F1', label: 'Acumulado al final de los 3 parciales', module: 'my-f1' },
        );
      } else if (isOrient) {
        suggestions.push(
          { icon: 'warning', text: 'Alumnos en Riesgo', label: 'Lista de alumnos que necesitan atención', module: 'at-risk' },
          { icon: 'description', text: 'Preboletas', label: 'Boletas de tus grupos antes de cierre oficial', module: 'boletas' },
          { icon: 'insights', text: 'Indicadores', label: 'Estadísticas de tu turno completo', module: 'indicadores' },
          { icon: 'person_search', text: 'Consulta por Alumno', label: 'Ver perfil completo de cualquier alumno', module: 'student-profile' },
        );
      } else {
        // Admin / directivo / etc
        suggestions.push(
          { icon: 'analytics', text: 'Inicio (Dashboard)', label: 'Vista general del plantel', module: 'dashboard' },
          { icon: 'people', text: 'Docentes y Asignaciones', label: 'Gestionar docentes', module: 'teachers' },
          { icon: 'admin_panel_settings', text: 'Usuarios', label: 'Cuentas, contraseñas, roles', module: 'users-mgmt' },
          { icon: 'rate_review', text: 'Correcciones de Cal.', label: 'Aprobar/rechazar solicitudes', module: 'grade-corrections' },
        );
      }

      const tips = isMaestro
        ? [
            { icon: 'help_outline', t: 'Hazme una PREGUNTA del sistema', e: 'Ej: "como capturo", "que pasa si reprueba", "olvide contraseña"' },
            { icon: 'person', t: 'Escribe el nombre del alumno', e: 'Ej: "MARIA LOPEZ"' },
            { icon: 'tag', t: 'Busca por folio o expediente', e: 'Ej: "6077" o "252063108"' },
            { icon: 'category', t: 'Busca un módulo del sistema', e: 'Ej: "Capturar" o "Listas"' },
          ]
        : [
            { icon: 'help_outline', t: 'Pregunta sobre el sistema', e: 'Ej: "como capturo", "fechas", "correcciones"' },
            { icon: 'person', t: 'Busca un alumno por nombre o folio', e: 'Ej: "DAYANNA" o "6077"' },
            { icon: 'school', t: 'Busca un docente', e: 'Ej: "PROFR. MICHAEL"' },
            { icon: 'groups', t: 'Busca un grupo', e: 'Ej: "1-1" o "2-3"' },
          ];

      const accessosRapidos = suggestions.map((s, i) => `
        <div class="gs-suggest" data-module="${Utils.sanitize(s.module)}"
             style="padding:10px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;gap:12px;align-items:center;transition:background 0.1s;"
             onmouseover="this.style.background='#f8fafc';" onmouseout="this.style.background='transparent';">
          <span class="material-icons-round" style="color:#3182ce;font-size:22px;flex-shrink:0;">${s.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#1e293b;font-size:14px;">${Utils.sanitize(s.text)}</div>
            <div style="font-size:11px;color:#64748b;margin-top:1px;">${Utils.sanitize(s.label)}</div>
          </div>
          <span class="material-icons-round" style="color:#cbd5e1;font-size:18px;">arrow_forward</span>
        </div>`).join('');

      const tipsHtml = tips.map(t => `
        <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;">
          <span class="material-icons-round" style="color:#94a3b8;font-size:18px;flex-shrink:0;margin-top:1px;">${t.icon}</span>
          <div style="flex:1;font-size:12px;color:#475569;">
            <strong style="color:#1e293b;">${Utils.sanitize(t.t)}</strong>
            <div style="color:#94a3b8;font-size:11px;margin-top:1px;">${Utils.sanitize(t.e)}</div>
          </div>
        </div>`).join('');

      root.innerHTML = `
        <div>
          <div style="padding:10px 16px 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Accesos rápidos</div>
          ${accessosRapidos}
          <div style="padding:14px 16px;background:#f8fafc;">
            <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">¿Qué puedes buscar?</div>
            ${tipsHtml}
          </div>
        </div>`;

      // Bind clicks de sugerencias
      root.querySelectorAll('.gs-suggest').forEach(el => {
        el.addEventListener('click', () => {
          const mod = el.dataset.module;
          if (mod) { close(); Router.navigate(mod); }
        });
      });
      return;
    }

    const scored = _items
      .map(it => ({ ...it, score: _searchScore(it, query) }))
      .filter(it => it.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    // FAQs (preguntas frecuentes con respuestas inline)
    const faqs = _faqMatches(query);

    if (scored.length === 0 && faqs.length === 0) {
      root.innerHTML = `
        <div style="padding:40px 20px;text-align:center;color:#94a3b8;">
          <span class="material-icons-round" style="font-size:36px;">search_off</span>
          <div style="margin-top:8px;font-size:13px;">No encontré nada con "${Utils.sanitize(query)}"</div>
          <div style="margin-top:14px;padding:10px 14px;background:#f0f9ff;border-left:3px solid #3182ce;border-radius:6px;text-align:left;font-size:12px;color:#1e40af;display:inline-block;">
            💡 <strong>Tip:</strong> intenta con preguntas como<br>
            <em>"como capturo"</em>, <em>"que pasa si reprueba"</em>, <em>"olvide contraseña"</em>
          </div>
        </div>`;
      return;
    }

    const typeLabels = {
      module: 'Módulo',
      student: 'Alumno',
      teacher: 'Docente',
      group: 'Grupo',
      subject: 'Materia',
      assignment: 'Mi asignación',
    };
    const typeColors = {
      module: '#3182ce', student: '#16a34a', teacher: '#9333ea',
      group: '#0891b2', subject: '#d97706', assignment: '#dc2626',
    };

    // ─── Render FAQs (sección "Respuestas") ───
    let faqHtml = '';
    if (faqs.length > 0) {
      faqHtml = `
        <div style="padding:8px 16px 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;background:#fefce8;">
          <span class="material-icons-round" style="font-size:13px;vertical-align:middle;color:#ca8a04;">tips_and_updates</span>
          Respuestas — preguntas frecuentes
        </div>` +
        faqs.map((f, i) => `
          <details class="gs-faq" data-idx="${i}" style="border-bottom:1px solid #fde68a;background:#fefce8;">
            <summary style="padding:12px 16px;cursor:pointer;display:flex;gap:12px;align-items:center;font-weight:600;color:#854d0e;font-size:14px;list-style:none;">
              <span class="material-icons-round" style="color:#ca8a04;font-size:22px;flex-shrink:0;">help_outline</span>
              <span style="flex:1;">${Utils.sanitize(f.q)}</span>
              <span class="material-icons-round" style="color:#ca8a04;font-size:18px;">expand_more</span>
            </summary>
            <div style="padding:0 16px 14px 50px;font-size:13px;color:#451a03;line-height:1.55;">
              ${f.a}
              ${f.actionModule ? `
                <button data-faq-action="${Utils.sanitize(f.actionModule)}" class="btn btn-primary btn-sm" style="margin-top:10px;font-size:12px;padding:6px 12px;">
                  <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">arrow_forward</span>
                  ${Utils.sanitize(f.actionLabel || 'Ir al módulo')}
                </button>` : ''}
            </div>
          </details>`).join('');
    }

    // ─── Render resultados normales (módulos, alumnos, etc) ───
    let resultsHtml = '';
    if (scored.length > 0) {
      const headerLabel = faqs.length > 0
        ? `<div style="padding:10px 16px 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Resultados</div>`
        : '';
      resultsHtml = headerLabel + scored.map((it, idx) => `
        <div class="gs-result" data-idx="${idx}" data-module="${Utils.sanitize(it.module || '')}"
             style="padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;gap:12px;align-items:center;transition:background 0.1s;"
             onmouseover="this.style.background='#f8fafc';"
             onmouseout="this.style.background='transparent';">
          <span class="material-icons-round" style="color:${typeColors[it.type] || '#64748b'};font-size:22px;flex-shrink:0;">${it.icon || 'search'}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#1e293b;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${Utils.sanitize(it.name)}
            </div>
            <div style="font-size:11px;color:#64748b;margin-top:1px;">
              <span style="background:${typeColors[it.type] || '#64748b'}22;color:${typeColors[it.type] || '#64748b'};padding:1px 6px;border-radius:3px;font-weight:600;">${typeLabels[it.type] || it.type}</span>
              ${it.detail ? ' · ' + Utils.sanitize(it.detail) : ''}
            </div>
          </div>
        </div>`).join('');
    }

    root.innerHTML = faqHtml + resultsHtml;

    // Bind clicks de resultados normales
    root.querySelectorAll('.gs-result').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        const item = scored[idx];
        if (!item) return;
        close();
        if (item.module && Router && Router.modules[item.module]) {
          Router.navigate(item.module);
        }
      });
    });

    // Bind clicks de los botones de acción dentro de FAQs
    root.querySelectorAll('[data-faq-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const mod = btn.dataset.faqAction;
        if (mod && Router && Router.modules[mod]) {
          close();
          Router.navigate(mod);
        }
      });
    });
  }

  async function open() {
    const overlay = document.getElementById('globalSearch');
    if (!overlay) return;
    overlay.style.display = 'flex';
    const input = document.getElementById('gsInput');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
    _renderResults('');
    // Cargar datos en background si aún no
    if (!_loaded) {
      try { await _load(); } catch (_) {}
    }
  }

  function close() {
    const overlay = document.getElementById('globalSearch');
    if (overlay) overlay.style.display = 'none';
  }

  function _bindEvents() {
    // Atajo Cmd+K / Ctrl+K
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Solo abrir si está logueado (la app es visible)
        const app = document.getElementById('app');
        if (app && app.style.display !== 'none') open();
      }
      if (e.key === 'Escape') close();
    });

    // Click fuera del modal cierra
    document.addEventListener('click', (e) => {
      const overlay = document.getElementById('globalSearch');
      if (!overlay || overlay.style.display === 'none') return;
      if (e.target === overlay) close();
    });

    // Input de búsqueda
    document.addEventListener('input', (e) => {
      if (e.target.id === 'gsInput') _renderResults(e.target.value);
    });
  }

  // Mostrar/ocultar el FAB y registrar eventos cuando la app esté lista
  function _toggleFab() {
    const fab = document.getElementById('sosFab');
    const app = document.getElementById('app');
    if (!fab || !app) return;
    fab.style.display = (app.style.display !== 'none' && app.style.display) ? 'flex' : 'none';
  }

  // Inicializar al cargar
  document.addEventListener('DOMContentLoaded', () => {
    _bindEvents();
    // Observar cambios en display del #app para mostrar/ocultar el FAB
    const observer = new MutationObserver(_toggleFab);
    const app = document.getElementById('app');
    if (app) observer.observe(app, { attributes: true, attributeFilter: ['style'] });
    _toggleFab();
  });

  // Recargar cache cuando cambie de usuario
  window.GlobalSearch = {
    open, close,
    invalidate: () => { _loaded = false; _items = []; _loading = null; },
  };
})();
