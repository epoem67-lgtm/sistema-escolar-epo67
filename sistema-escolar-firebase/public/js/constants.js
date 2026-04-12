// ═══════════════════════════════════════════════════════════════
// CONSTANTES GLOBALES — Sistema Escolar EPO 67
// Centraliza valores que estaban hardcodeados en multiples modulos.
// Cualquier modulo puede acceder a K.PARCIALES, K.TURNOS, etc.
// ═══════════════════════════════════════════════════════════════

const K = Object.freeze({

  // Parciales academicos
  // Fuente original: partial-close.js, at-risk.js, honor-roll.js
  PARCIALES: Object.freeze([
    { id: 'P1', nombre: 'Primer Parcial', numero: 1 },
    { id: 'P2', nombre: 'Segundo Parcial', numero: 2 },
    { id: 'P3', nombre: 'Tercer Parcial', numero: 3 }
  ]),

  // Turnos disponibles
  // Fuente original: honor-roll.js, school-config.js
  TURNOS: Object.freeze(['MATUTINO', 'VESPERTINO']),

  // Grados escolares
  // Fuente original: honor-roll.js, teachers.js
  GRADOS: Object.freeze([1, 2, 3]),

  // Roles del sistema con etiquetas y colores para badges
  // Fuente original: app.js Auth.getRoleLabel, users-mgmt.js roleColors
  ROLES: Object.freeze([
    { id: 'admin',      label: 'Administrador', color: '#9333ea' },
    { id: 'maestro',    label: 'Docente',       color: '#3b82f6' },
    { id: 'orientador', label: 'Orientador',    color: '#10b981' },
    { id: 'directivo',  label: 'Directivo',     color: '#f59e0b' },
    { id: 'consulta',   label: 'Consulta',      color: '#6b7280' }
  ]),

  // Mapeo de sexo
  // Fuente original: students.js (lineas 234, 336, 427)
  SEX_MAP: Object.freeze({ M: 'Mujer', H: 'Hombre' }),

  // Umbrales academicos
  // Fuente original: grades.js:278, at-risk.js:126,143
  THRESHOLDS: Object.freeze({
    PASS_GRADE: 6,
    AT_RISK_SUBJECTS: 3
  }),

  // Paginacion
  // Fuente original: students.js:10
  ITEMS_PER_PAGE: 50,

  // Helper: obtener label de un rol
  getRoleLabel(roleId) {
    const role = this.ROLES.find(r => r.id === roleId);
    return role ? role.label : roleId;
  },

  // Helper: obtener color de un rol
  getRoleColor(roleId) {
    const role = this.ROLES.find(r => r.id === roleId);
    return role ? role.color : '#6b7280';
  },

  // Helper: obtener display de sexo
  getSexLabel(code) {
    return this.SEX_MAP[code] || code || '-';
  }
});
