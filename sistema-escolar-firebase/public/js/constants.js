// ═══════════════════════════════════════════════════════════════
// CONSTANTES GLOBALES — Sistema Escolar EPO 67
// Centraliza valores, rubros de evaluación, mapeos y fórmulas.
// Cualquier módulo accede a K.PARCIALES, K.RUBROS, K.ORIENTADORES, etc.
// ═══════════════════════════════════════════════════════════════

const K = Object.freeze({

  // ─── Parciales académicos ──────────────────────────────────
  PARCIALES: Object.freeze([
    { id: 'P1', nombre: 'Primer Parcial', numero: 1 },
    { id: 'P2', nombre: 'Segundo Parcial', numero: 2 },
    { id: 'P3', nombre: 'Tercer Parcial', numero: 3 }
  ]),

  // ─── Turnos y grados ──────────────────────────────────────
  TURNOS: Object.freeze(['MATUTINO', 'VESPERTINO']),
  GRADOS: Object.freeze([1, 2, 3]),

  // ─── HORARIOS / JORNADA ESCOLAR ────────────────────────────
  // El sistema no tenía ninguna noción de tiempo. El módulo de horarios
  // introduce la "jornada": días laborables + módulos (bloques) por turno.
  // La definición REAL vive en Firestore (config/scheduleGrid) y es editable
  // desde el módulo. Estos son solo los valores por defecto (semilla) que se
  // usan cuando ese doc aún no existe. Horas 50 min, editables por Dirección.
  HORARIOS: Object.freeze({
    DIAS: Object.freeze([
      { id: 'LUN', label: 'Lunes' },
      { id: 'MAR', label: 'Martes' },
      { id: 'MIE', label: 'Miércoles' },
      { id: 'JUE', label: 'Jueves' },
      { id: 'VIE', label: 'Viernes' },
    ]),
    PRIORIDADES: Object.freeze([
      { id: 'alta',  label: 'Alta',  color: '#dc2626' },
      { id: 'media', label: 'Media', color: '#d97706' },
      { id: 'baja',  label: 'Baja',  color: '#6b7280' },
    ]),
    // Estados que un maestro reporta por celda en su propuesta de horario
    // (documento oficial "PROPUESTA HORARIO PERSONAL"):
    //   disp   = Disponibilidad (puede dar clase)
    //   taller = TALLERES (bloque fijo, NO se le puede poner clase normal)
    //   no     = celda vacía en la propuesta (no disponible)
    ESTADOS_DISP: Object.freeze([
      { id: 'disp',   label: 'Disponible',    color: '#16a34a' },
      { id: 'taller', label: 'Talleres',      color: '#d97706' },
      { id: 'no',     label: 'No disponible', color: '#9ca3af' },
    ]),
    // Jornada REAL EPO 67 (propuestas 2026-2027): 8 módulos de 50 min + receso.
    // Matutino 07:00–14:00, Vespertino 13:10–20:10 (se traslapan 13:10–14:00).
    // Los módulos con `receso:true` son filas no asignables (descanso).
    DEFAULT_MODULOS: Object.freeze({
      MATUTINO: Object.freeze([
        { n: 1, inicio: '07:00', fin: '07:50' },
        { n: 2, inicio: '07:50', fin: '08:40' },
        { n: 3, inicio: '08:40', fin: '09:30' },
        { n: 4, inicio: '09:30', fin: '10:20' },
        { receso: true, inicio: '10:20', fin: '10:40' },
        { n: 5, inicio: '10:40', fin: '11:30' },
        { n: 6, inicio: '11:30', fin: '12:20' },
        { n: 7, inicio: '12:20', fin: '13:10' },
        { n: 8, inicio: '13:10', fin: '14:00' },
      ]),
      VESPERTINO: Object.freeze([
        { n: 1, inicio: '13:10', fin: '14:00' },
        { n: 2, inicio: '14:00', fin: '14:50' },
        { n: 3, inicio: '14:50', fin: '15:40' },
        { n: 4, inicio: '15:40', fin: '16:30' },
        { n: 5, inicio: '16:30', fin: '17:20' },
        { receso: true, inicio: '17:20', fin: '17:40' },
        { n: 6, inicio: '17:40', fin: '18:30' },
        { n: 7, inicio: '18:30', fin: '19:20' },
        { n: 8, inicio: '19:20', fin: '20:10' },
      ]),
    }),
  }),

  // ─── Roles del sistema ─────────────────────────────────────
  ROLES: Object.freeze([
    { id: 'admin',              label: 'Administrador',          color: '#9333ea' },
    { id: 'subdirector',        label: 'Subdirector',            color: '#dc2626' },
    { id: 'secretario_admin',   label: 'Secretaria Administrativa', color: '#7c3aed' },
    { id: 'directivo',          label: 'Directivo',              color: '#f59e0b' },
    { id: 'secretario_escolar', label: 'Secretario Escolar',     color: '#ea580c' },
    { id: 'presidente_academia',label: 'Presidente de Academia', color: '#0891b2' },
    { id: 'orientador',         label: 'Orientador',             color: '#10b981' },
    { id: 'orientador_docente', label: 'Orientador-Docente',     color: '#0ea5e9' },
    { id: 'maestro',            label: 'Docente',                color: '#3b82f6' },
    { id: 'consulta',           label: 'Consulta',               color: '#6b7280' }
  ]),

  // Mapa de herencia de permisos. Si role === 'orientador_docente', se trata
  // efectivamente como si tuviera 3 roles para fines de visibilidad de UI.
  // Las reglas de Firestore replican esta semántica.
  ROLE_INHERITS: Object.freeze({
    orientador_docente: ['orientador', 'maestro'],
    // Presidente de Academia TAMBIÉN es maestro: imparte clases Y coordina
    // su academia. Ve la sección "Mi Academia" (estadísticas de sus materias)
    // Y los menús de docente (capturar sus calificaciones, etc.)
    presidente_academia: ['maestro'],
    // Secretario Escolar (Roberto): mismo nivel de VISTA que directivo
    // (ve todo silenciosamente, sin banner) + escritura extra en students/enrollments.
    secretario_escolar: ['directivo'],
    // Secretaria Administrativa (Lupita): mismo nivel de VISTA que directivo
    // + escritura en school-config (datos de la escuela).
    secretario_admin: ['directivo'],
  }),

  // ─── Mapeo de sexo ─────────────────────────────────────────
  SEX_MAP: Object.freeze({ M: 'Mujer', H: 'Hombre' }),

  // ─── Umbrales académicos ───────────────────────────────────
  THRESHOLDS: Object.freeze({
    PASS_GRADE: 6,
    AT_RISK_SUBJECTS: 3
  }),

  // ─── Paginación ────────────────────────────────────────────
  ITEMS_PER_PAGE: 50,

  // ═══════════════════════════════════════════════════════════
  // RUBROS DE EVALUACIÓN POR TURNO
  // ═══════════════════════════════════════════════════════════
  //
  // MATUTINO:   Evaluación Continua (máx 8) + Transversal (máx 2) + Punto Extra → Suma → Calif
  // VESPERTINO: Evaluación Continua (máx 5) + Examen Parcial (máx 3) + Transversal (máx 2) + Punto Extra → Suma → Calif
  //
  // `key` es el campo interno en Firestore (NO TOCAR — rompería los datos).
  // `label` es el nombre completo en una línea (uso normal en UI).
  // `abbr` es el nombre completo con <br> para encabezados de tabla estrechos.
  // El usuario pidió explícitamente que NO se usen abreviaturas en la UI
  // (2026-05-09): nada de EC, TR, PE, EP, ni E.C./T.R./P.E./E.P.
  //
  // Regla de redondeo: ≥6 redondeo normal, <6 se trunca (5.9→5)
  // Máximo siempre: 10

  RUBROS_MATUTINO: Object.freeze([
    { key: 'ec',  label: 'EVALUACIÓN CONTINUA',  abbr: 'EVALUACIÓN<br>CONTINUA',  max: 8,  step: 0.1 },
    { key: 'tr',  label: 'TRANSVERSAL',          abbr: 'TRANSVERSAL',             max: 2,  step: 0.1 },
    { key: 'pe',  label: 'PUNTO EXTRA',          abbr: 'PUNTO<br>EXTRA',          max: 10, step: 0.1 }
  ]),

  // Orden OFICIAL SEP en el PDF de Control Parcial: EC, TRANSVERSAL, EXAMEN, PE.
  // Los maestros imprimen ese PDF y al comparar con el sistema notaban las
  // columnas invertidas (parecía que los datos del examen estaban "cambiados").
  // Las KEYS (ec/ex/tr/pe) NO cambian — los datos en Firestore se preservan.
  RUBROS_VESPERTINO: Object.freeze([
    { key: 'ec',  label: 'EVALUACIÓN CONTINUA',  abbr: 'EVALUACIÓN<br>CONTINUA',  max: 5,  step: 0.1 },
    { key: 'tr',  label: 'TRANSVERSAL',          abbr: 'TRANSVERSAL',             max: 2,  step: 0.1 },
    { key: 'ex',  label: 'EXAMEN PARCIAL',       abbr: 'EXAMEN<br>PARCIAL',       max: 3,  step: 0.1 },
    { key: 'pe',  label: 'PUNTO EXTRA',          abbr: 'PUNTO<br>EXTRA',          max: 10, step: 0.1 }
  ]),

  // ═══════════════════════════════════════════════════════════
  // ORIENTADORES POR TURNO Y GRUPO
  // ═══════════════════════════════════════════════════════════

  ORIENTADORES: Object.freeze({
    'MATUTINO': Object.freeze({
      '1-1': 'PROFR. JOSÉ EDGAR SALAZAR',
      '1-2': 'PROFR. JOSÉ EDGAR SALAZAR',
      '1-3': 'PROFRA. DIAZ CAMARENA SANDRA',
      '2-1': 'PROFRA. ANA ISABEL CORREA SALGADO',
      '2-2': 'PROFRA. ANA ISABEL CORREA SALGADO',
      '2-3': 'PROFRA. JUANA RANGEL PALACIOS',
      '3-1': 'PROFRA. NEFTALI MARGARITA MORLAN ORTIZ',
      '3-2': 'PROFRA. NEFTALI MARGARITA MORLAN ORTIZ',
      '3-3': 'PROFRA. JUANA RANGEL PALACIOS',
    }),
    'VESPERTINO': Object.freeze({
      '1-1': 'PROFRA. LAURITA MARTÍNEZ',
      '1-2': 'PROFRA. LAURITA MARTÍNEZ',
      '1-3': 'PROFRA. IVONNE GABRIELA CEDILLO POLO',
      '2-1': 'PROFRA. FERNANDA CITLALLI RODRÍGUEZ VIVAS',
      '2-2': 'PROFRA. BEATRIZ ALEJANDRA GARCÍA GONZÁLEZ',
      '2-3': 'PROFRA. BEATRIZ ALEJANDRA GARCÍA GONZÁLEZ',
      '3-1': 'PROFRA. IVONNE GABRIELA CEDILLO POLO',
      '3-2': 'PROFRA. FERNANDA CITLALLI RODRÍGUEZ VIVAS',
      '3-3': 'PROFRA. IVONNE GABRIELA CEDILLO POLO',
    })
  }),

  // ═══════════════════════════════════════════════════════════
  // UAC_NOMBRES — Nombres oficiales de materias con acentos
  // ═══════════════════════════════════════════════════════════

  UAC_NOMBRES: Object.freeze({
    // Grado 1
    'actividades físicas y deportivas ii': 'ACTIVIDADES FÍSICAS Y DEPORTIVAS II',
    'ciencias naturales experimentales y tecnología ii': 'CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGÍA II',
    'ciencias sociales ii': 'CIENCIAS SOCIALES II',
    'cultura digital ii': 'CULTURA DIGITAL II',
    'educación para la salud ii': 'EDUCACIÓN PARA LA SALUD II',
    'inglés ii': 'INGLÉS II',
    'lengua y comunicación ii': 'LENGUA Y COMUNICACIÓN II',
    'pensamiento filosófico y humanidades ii': 'PENSAMIENTO FILOSÓFICO Y HUMANIDADES II',
    'pensamiento matemático ii': 'PENSAMIENTO MATEMÁTICO II',
    'taller de ciencias i': 'TALLER DE CIENCIAS I',
    'temas selectos de igualdad y derechos humanos ii': 'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS II',
    // Grado 2
    'actividades artísticas y culturales i': 'ACTIVIDADES ARTÍSTICAS Y CULTURALES I',
    'ciencias sociales iii': 'CIENCIAS SOCIALES III',
    'comunidades virtuales': 'COMUNIDADES VIRTUALES',
    'conciencia histórica i': 'CONCIENCIA HISTÓRICA I',
    'educación integral en sexualidad y género ii': 'EDUCACIÓN INTEGRAL EN SEXUALIDAD Y GÉNERO II',
    'espacio y sociedad': 'ESPACIO Y SOCIEDAD',
    'inglés iv': 'INGLÉS IV',
    'mantenimiento de redes de cómputo': 'MANTENIMIENTO DE REDES DE CÓMPUTO',
    'pensamiento literario': 'PENSAMIENTO LITERARIO',
    'reacciones químicas y conservación de la materia': 'REACCIONES QUÍMICAS Y CONSERVACIÓN DE LA MATERIA',
    'taller de cultura digital': 'TALLER DE CULTURA DIGITAL',
    'temas selectos de igualdad y derechos humanos iv': 'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS IV',
    'temas selectos de matemáticas i': 'TEMAS SELECTOS DE MATEMÁTICAS I',
    // Grado 3
    'actividades artísticas y culturales iii': 'ACTIVIDADES ARTÍSTICAS Y CULTURALES III',
    'ciencias de la comunicación i': 'CIENCIAS DE LA COMUNICACIÓN I',
    'conciencia histórica iii': 'CONCIENCIA HISTÓRICA III',
    'diseño digital': 'DISEÑO DIGITAL',
    'economía i': 'ECONOMÍA I',
    'organismos': 'ORGANISMOS',
    'práctica y colaboración ciudadana ii': 'PRÁCTICA Y COLABORACIÓN CIUDADANA II',
    'páginas web': 'PÁGINAS WEB',
    'temas selectos de filosofía': 'TEMAS SELECTOS DE FILOSOFÍA',
    'temas selectos de igualdad y derechos humanos vi': 'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS VI',
    'temas selectos de inglés ii': 'TEMAS SELECTOS DE INGLÉS II',
    'temas selectos de matemáticas ii': 'TEMAS SELECTOS DE MATEMÁTICAS II',
  }),

  // ═══════════════════════════════════════════════════════════
  // ENCABEZADO OFICIAL DE BOLETA
  // ═══════════════════════════════════════════════════════════

  BOLETA_HEADER: Object.freeze([
    'GOBIERNO DEL ESTADO DE MÉXICO',
    'SECRETARÍA DE EDUCACIÓN',
    'SUBSECRETARÍA DE EDUCACIÓN MEDIA SUPERIOR Y SUPERIOR',
    'DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR',
    'ESCUELA PREPARATORIA OFICIAL NÚM. 67'
  ]),

  GRADO_NOMBRE: Object.freeze({ 1: 'PRIMERO', 2: 'SEGUNDO', 3: 'TERCERO' }),

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  // ORDEN OFICIAL DE MATERIAS POR GRADO (para boletas)
  // ═══════════════════════════════════════════════════════════

  SUBJECT_ORDER: Object.freeze({
    // Orden oficial SEP/EPO 67 — Semestre 2 (1er grado)
    // Ratificado por Olivia (mayo 2026): Taller de Ciencias I va INMEDIATAMENTE
    // después de Ciencias Naturales (componente científico), antes de los
    // componentes humanístico y socioemocional.
    1: [
      'LENGUA Y COMUNICACION II',
      'INGLES II',
      'PENSAMIENTO MATEMATICO II',
      'CULTURA DIGITAL II',
      'CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGIA II',
      'TALLER DE CIENCIAS I',
      'PENSAMIENTO FILOSOFICO Y HUMANIDADES II',
      'CIENCIAS SOCIALES II',
      'ACTIVIDADES FISICAS Y DEPORTIVAS II',
      'EDUCACION PARA LA SALUD II',
      'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS II'
    ],
    2: [
      'PENSAMIENTO LITERARIO',
      'INGLES IV',
      'TEMAS SELECTOS DE MATEMATICAS I',
      'CONCIENCIA HISTORICA I',
      'TALLER DE CULTURA DIGITAL',
      'REACCIONES QUIMICAS Y CONSERVACION DE LA MATERIA',
      'ESPACIO Y SOCIEDAD',
      'CIENCIAS SOCIALES III',
      'COMUNIDADES VIRTUALES',
      'MANTENIMIENTO DE REDES DE COMPUTO',
      'ACTIVIDADES ARTISTICAS Y CULTURALES I',
      'EDUCACION INTEGRAL EN SEXUALIDAD Y GENERO II',
      'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS IV'
    ],
    3: [
      'CIENCIAS DE LA COMUNICACION I',
      'TEMAS SELECTOS DE INGLES II',
      'TEMAS SELECTOS DE MATEMATICAS II',
      'CONCIENCIA HISTORICA III',
      'ORGANISMOS',
      'TEMAS SELECTOS DE FILOSOFIA',
      'ECONOMIA I',
      'PAGINAS WEB',
      'DISENO DIGITAL',
      'ACTIVIDADES ARTISTICAS Y CULTURALES III',
      'PRACTICA Y COLABORACION CIUDADANA II',
      'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS VI'
    ]
  }),

  /** Ordena lista de materias segun el orden oficial del grado */
  sortSubjectsByGrado(subjectsList, grado) {
    const order = this.SUBJECT_ORDER[grado];
    if (!order) return subjectsList;
    const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    return [...subjectsList].sort((a, b) => {
      const na = norm(a.nombre || a.id);
      const nb = norm(b.nombre || b.id);
      let ia = order.findIndex(o => norm(o) === na || na.includes(norm(o)) || norm(o).includes(na));
      let ib = order.findIndex(o => norm(o) === nb || nb.includes(norm(o)) || norm(o).includes(nb));
      if (ia === -1) ia = 999;
      if (ib === -1) ib = 999;
      return ia - ib;
    });
  },

  /** Retorna rubros según el turno */
  getRubros(turno) {
    return turno === 'VESPERTINO' ? this.RUBROS_VESPERTINO : this.RUBROS_MATUTINO;
  },

  /** Calcula SUMA con regla EPO67 del Punto Extra:
   *  - Matutino:   sumaBase = EC + TR
   *  - Vespertino: sumaBase = EC + EX + TR
   *  - Si sumaBase < 6 (alumno reprobado en rubros principales) el PUNTO EXTRA
   *    NO se suma. El PE es premio para alumnos aprobados, no rescate.
   *  - Si sumaBase >= 6, suma final = sumaBase + PE (cap 10, 1 decimal).
   *
   *  El campo PE se identifica por la clave 'pe' del objeto rubros
   *  (definida en RUBROS_MATUTINO / RUBROS_VESPERTINO). Cualquier otra
   *  clave se considera parte de la sumaBase.
   */
  // ─── COMPONENTE SOCIOEMOCIONAL: bloqueo TOTAL de PE ──────────────────
  // Gaceta oficial EPO 67: las materias del componente socioemocional NO
  // aceptan punto extra de talleres en NINGÚN parcial (P1, P2 y P3).
  // Lista de IDs verificada directo en la colección /subjects de Firestore
  // (Mayo 2026) — son las 9 materias socioemocionales del semestre actual:
  //   actividades físicas y deportivas, actividades artísticas y culturales,
  //   educación para la salud, educación integral en sexualidad y género,
  //   temas selectos de igualdad y derechos humanos,
  //   práctica y colaboración ciudadana.
  SUBJECTS_SIN_PE: Object.freeze([
    'G1_actividades_físicas_y_deportivas_ii',
    'G1_educación_para_la_salud_ii',
    'G1_temas_selectos_de_igualdad_y_derechos_hu',
    'G2_actividades_artísticas_y_culturales_i',
    'G2_educación_integral_en_sexualidad_y_géner',
    'G2_temas_selectos_de_igualdad_y_derechos_hu',
    'G3_actividades_artísticas_y_culturales_iii',
    'G3_práctica_y_colaboración_ciudadana_ii',
    'G3_temas_selectos_de_igualdad_y_derechos_hu',
  ]),
  // Alias retrocompatible — código viejo puede seguir leyendo SUBJECTS_SIN_PE_P3.
  get SUBJECTS_SIN_PE_P3() { return this.SUBJECTS_SIN_PE; },

  /** ¿La materia acepta PE? Retorna false cuando es materia del componente
   *  socioemocional (regla aplica en TODOS los parciales). El parámetro
   *  `partial` se mantiene por compatibilidad pero ya no afecta la decisión. */
  subjectAllowsPE(subjectId, _partial) {
    if (!subjectId) return true;
    return !this.SUBJECTS_SIN_PE.includes(subjectId);
  },

  calcSuma(rubros, opts) {
    const PASS = 6;
    let sumaBase = 0;
    let pe = 0;
    for (const [key, val] of Object.entries(rubros || {})) {
      if (val === null || val === undefined || val === '') continue;
      const n = Number(val);
      if (isNaN(n)) continue;
      if (key === 'pe') pe = n;
      else sumaBase += n;
    }
    // Regla socioemocional: si la materia no permite PE, lo ignora en todo parcial.
    if (opts && opts.subjectId && !this.subjectAllowsPE(opts.subjectId)) {
      pe = 0;
    }
    // Regla EPO67: PE solo cuenta si la base ya es aprobatoria.
    const total = sumaBase < PASS ? sumaBase : sumaBase + pe;
    return Math.min(Math.round(total * 10) / 10, 10); // 1 decimal, cap 10
  },

  /** Indica si el PUNTO EXTRA esta siendo IGNORADO. Razones posibles:
   *   1. La materia es socioemocional (NUNCA acepta PE — todos los parciales)
   *   2. La sumaBase < 6 (regla EPO67 clásica del PE)
   *  Si pasas opts={subjectId}, considera ambas reglas. */
  isPEIgnored(rubros, opts) {
    let sumaBase = 0;
    let pe = 0;
    for (const [key, val] of Object.entries(rubros || {})) {
      if (val === null || val === undefined || val === '') continue;
      const n = Number(val);
      if (isNaN(n)) continue;
      if (key === 'pe') pe = n;
      else sumaBase += n;
    }
    // Razón 1: PE bloqueado por regla socioemocional (todos los parciales)
    if (opts && opts.subjectId && !this.subjectAllowsPE(opts.subjectId)) {
      return pe > 0; // tenía PE escrito pero no aplica
    }
    // Razón 2: PE bloqueado por sumaBase < 6
    return pe > 0 && sumaBase < 6;
  },

  /** Calcula CAL (calificación final): redondeo especial EPO67
   *  ≥6: redondeo normal. <6: truncar a 5 (calificación mínima). Max 10. */
  calcCal(suma) {
    if (suma === null || suma === undefined) return '';
    const s = Math.min(Number(suma), 10);
    if (isNaN(s)) return '';
    if (s >= 6) return Math.min(Math.round(s), 10);
    return 5; // Menor a 6 siempre es 5
  },

  /** v8.07: ¿Está el parcial CERRADO para un grado específico?
   *
   * Modelo de datos en partials/{P1|P2|P3}:
   *   { locked: bool, lockedByGrade: { '1': bool, '2': bool, '3': bool } }
   *
   * Si `lockedByGrade` existe y tiene la clave del grado, manda.
   * Si no, fallback al campo `locked` global (retrocompatible).
   *
   * @param {Object} partialDoc - doc de Firestore de partials/{P1|P2|P3}
   * @param {number|string} grado - grado del alumno (1, 2 o 3)
   * @returns {boolean} true si está cerrado para ese grado
   */
  isPartialLockedForGrade(partialDoc, grado) {
    if (!partialDoc) return false;
    const g = String(grado || '').trim();
    if (partialDoc.lockedByGrade && typeof partialDoc.lockedByGrade === 'object') {
      if (g && g in partialDoc.lockedByGrade) {
        return partialDoc.lockedByGrade[g] === true;
      }
    }
    return partialDoc.locked === true;
  },

  /** v8.07: ¿Se puede editar el parcial directamente para un grado?
   *  (opuesto a isPartialLockedForGrade) */
  isPartialOpenForGrade(partialDoc, grado) {
    return !this.isPartialLockedForGrade(partialDoc, grado);
  },

  /** v8.07: Extrae el grado (1, 2, 3) desde un groupId tipo MATUTINO_2-3.
   *  Devuelve number o null si no se puede inferir. */
  gradeFromGroupId(groupId) {
    if (!groupId) return null;
    const m = String(groupId).match(/_(\d)-/);
    return m ? Number(m[1]) : null;
  },

  /** v8.07: ¿La ventana de correcciones está abierta AHORA?
   *  (lee el doc config/correctionsWindow ya cargado)
   *
   *  @param {Object} windowDoc - { open: bool, closesAt: Timestamp }
   *  @returns {boolean} */
  isCorrectionsWindowOpen(windowDoc) {
    if (!windowDoc) return false;
    if (windowDoc.open !== true) return false;
    if (!windowDoc.closesAt) return true; // sin fecha de cierre, está abierta indefinida
    const closes = windowDoc.closesAt.toDate
      ? windowDoc.closesAt.toDate()
      : new Date(windowDoc.closesAt);
    return closes.getTime() > Date.now();
  },

  /** v8.10: Resuelve las 4 fechas críticas del ciclo PARA UN GRADO.
   *  Si captureWindowDoc.byGrade[grado][campo] existe, manda; si no, fallback
   *  al campo del nivel raíz (global). Permite "Tercer grado entrega antes
   *  que primero y segundo" sin romper compatibilidad — los grados sin
   *  override conservan las fechas globales.
   *
   *  @param {Object} cfg - documento config/captureWindow
   *  @param {number|string} grado - 1, 2 o 3
   *  @returns {{closesAt, deliveryDate, correctionsStart, correctionsEnd}}
   */
  captureWindowForGrade(cfg, grado) {
    if (!cfg) return { opensAt: null, closesAt: null, deliveryDate: null, correctionsStart: null, correctionsEnd: null };
    const g = String(grado || '').trim();
    const byG = (cfg.byGrade && typeof cfg.byGrade === 'object' && g) ? (cfg.byGrade[g] || {}) : {};
    return {
      opensAt:         byG.opensAt         || cfg.opensAt         || null,
      closesAt:        byG.closesAt        || cfg.closesAt        || null,
      deliveryDate:    byG.deliveryDate    || cfg.deliveryDate    || null,
      correctionsStart: byG.correctionsStart || cfg.correctionsStart || null,
      correctionsEnd:  byG.correctionsEnd  || cfg.correctionsEnd  || null,
    };
  },

  /** Nombre oficial de UAC */
  getUACNombre(subjectName) {
    if (!subjectName) return '';
    const key = subjectName.toLowerCase().trim();
    return this.UAC_NOMBRES[key] || subjectName.toUpperCase();
  },

  /** Nombre del orientador para un grupo */
  getOrientador(turno, grupoNombre) {
    const t = this.ORIENTADORES[turno];
    return t ? (t[grupoNombre] || '') : '';
  },

  getRoleLabel(roleId) {
    const role = this.ROLES.find(r => r.id === roleId);
    return role ? role.label : roleId;
  },

  getRoleColor(roleId) {
    const role = this.ROLES.find(r => r.id === roleId);
    return role ? role.color : '#6b7280';
  },

  getSexLabel(code) {
    return this.SEX_MAP[code] || code || '-';
  },

  /**
   * Verifica si estamos dentro de la ventana de corrección (3 días hábiles post-cierre).
   * @param {Object} partialDoc — doc del parcial con { locked, closedAt }
   * @returns {{ open: boolean, daysLeft: number, deadline: Date|null }}
   */
  getCorrectionWindow(partialDoc) {
    if (!partialDoc || !partialDoc.locked || !partialDoc.closedAt) {
      return { open: false, daysLeft: 0, deadline: null };
    }
    const closedDate = partialDoc.closedAt.toDate
      ? partialDoc.closedAt.toDate()
      : new Date(partialDoc.closedAt);
    // Count 3 business days (Mon-Fri) from closedDate
    let count = 0;
    const d = new Date(closedDate);
    while (count < 3) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
    }
    d.setHours(23, 59, 59, 999); // End of 3rd business day
    const now = new Date();
    const open = now <= d;
    const diffMs = d - now;
    const daysLeft = open ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
    return { open, daysLeft, deadline: d };
  }
});
