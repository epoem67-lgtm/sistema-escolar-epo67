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

  // ─── Roles del sistema ─────────────────────────────────────
  ROLES: Object.freeze([
    { id: 'admin',              label: 'Administrador',          color: '#9333ea' },
    { id: 'subdirector',        label: 'Subdirector',            color: '#dc2626' },
    { id: 'secretario_admin',   label: 'Secretaria Administrativa', color: '#7c3aed' },
    { id: 'directivo',          label: 'Directivo',              color: '#f59e0b' },
    { id: 'secretario_escolar', label: 'Secretario Escolar',     color: '#ea580c' },
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

  RUBROS_VESPERTINO: Object.freeze([
    { key: 'ec',  label: 'EVALUACIÓN CONTINUA',  abbr: 'EVALUACIÓN<br>CONTINUA',  max: 5,  step: 0.1 },
    { key: 'ex',  label: 'EXAMEN PARCIAL',       abbr: 'EXAMEN<br>PARCIAL',       max: 3,  step: 0.1 },
    { key: 'tr',  label: 'TRANSVERSAL',          abbr: 'TRANSVERSAL',             max: 2,  step: 0.1 },
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
    1: [
      'LENGUA Y COMUNICACION II',
      'INGLES II',
      'PENSAMIENTO MATEMATICO II',
      'CULTURA DIGITAL II',
      'CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGIA II',
      'PENSAMIENTO FILOSOFICO Y HUMANIDADES II',
      'CIENCIAS SOCIALES II',
      'TALLER DE CIENCIAS I',
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

  /** Calcula SUMA: sum de rubros, cap a 10 */
  calcSuma(rubros) {
    const vals = Object.values(rubros).filter(v => v !== null && v !== undefined && v !== '');
    const suma = vals.reduce((a, b) => a + Number(b), 0);
    return Math.min(Math.round(suma * 10) / 10, 10); // 1 decimal, cap 10
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
