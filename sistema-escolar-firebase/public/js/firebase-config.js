// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN FIREBASE
// Cambia estos valores por los de tu proyecto Firebase
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDX4za0avN20Lplmf5LAR7pdfZlvNtvcJc",
  authDomain: "epo67-sistema.firebaseapp.com",
  projectId: "epo67-sistema",
  storageBucket: "epo67-sistema.firebasestorage.app",
  messagingSenderId: "425082037377",
  appId: "1:425082037377:web:4bd72a502c874acfa25980"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Referencias globales
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// ═══════════════════════════════════════════════════════════════
// PERSISTENCIA OFFLINE
// Cachea documentos en IndexedDB para reducir reads al servidor.
// Reads repetidos se resuelven localmente (~70-80% menos consumo).
// ═══════════════════════════════════════════════════════════════

// Cache version — incrementar para forzar limpieza en todos los navegadores.
// 2026-05-22: bumpeado a 3 para purgar caches viejos donde Francisco/admin
// veían vacías las calificaciones de Mantenimiento de Redes 2-1 VESP.
const FIRESTORE_CACHE_VERSION = 3;
const _cacheKey = 'epo67_cache_v';
const _storedVersion = localStorage.getItem(_cacheKey);
if (_storedVersion !== String(FIRESTORE_CACHE_VERSION)) {
  // Limpiar IndexedDB de Firestore para forzar datos frescos
  if (indexedDB && indexedDB.databases) {
    indexedDB.databases().then(dbs => {
      dbs.filter(d => d.name && d.name.includes('firestore')).forEach(d => {
        indexedDB.deleteDatabase(d.name);
        console.log('Cache Firestore limpiado:', d.name);
      });
    }).catch(() => {});
  }
  // Limpiar también el cache de sessionStorage del Store
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('epo67_store_')) sessionStorage.removeItem(k);
    }
  } catch (_) {}
  localStorage.setItem(_cacheKey, String(FIRESTORE_CACHE_VERSION));
}

db.enablePersistence({ synchronizeTabs: true })
  .catch(err => {
    if (err.code === 'failed-precondition') {
      console.warn('Persistencia offline: múltiples tabs abiertas, solo una puede habilitar persistencia');
    } else if (err.code === 'unimplemented') {
      console.warn('Persistencia offline no soportada en este navegador');
    }
  });

// Nota: Se eliminó el proveedor de Google.
// Ahora se usa autenticación por email/password.

// ═══════════════════════════════════════════════════════════════
// HELPERS DE FIRESTORE
// ═══════════════════════════════════════════════════════════════

const DB = {
  // Colecciones principales
  config: () => db.collection('config'),
  users: () => db.collection('users'),
  teachers: () => db.collection('teachers'),
  groups: () => db.collection('groups'),
  subjects: () => db.collection('subjects'),
  assignments: () => db.collection('assignments'),
  assignmentsByGroup: () => db.collection('assignmentsByGroup'),
  students: () => db.collection('students'),
  grades: () => db.collection('grades'),
  partials: () => db.collection('partials'),
  atRisk: () => db.collection('atRisk'),
  activityLog: () => db.collection('activityLog'),
  enrollments: () => db.collection('enrollments'),
  emailAliases: () => db.collection('email_aliases'),

  // Helpers
  doc: (collection, id) => db.collection(collection).doc(id),
  timestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
  increment: (n) => firebase.firestore.FieldValue.increment(n),
  arrayUnion: (...items) => firebase.firestore.FieldValue.arrayUnion(...items),
  arrayRemove: (...items) => firebase.firestore.FieldValue.arrayRemove(...items),
  batch: () => db.batch(),

  // Log de actividad (legacy — usa DB.audit() para bitácora completa)
  async log(action, details = {}) {
    try {
      await db.collection('activityLog').add({
        action,
        details,
        userId: auth.currentUser?.uid || 'system',
        userEmail: auth.currentUser?.email || 'system',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Error logging activity:', e);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // BITÁCORA DE AUDITORÍA COMPLETA
  // ═══════════════════════════════════════════════════════════════

  /**
   * Registra una acción en la bitácora de auditoría.
   * @param {string} action   - Tipo: 'crear', 'editar', 'eliminar', 'login', 'logout', 'importar', etc.
   * @param {string} entity   - Entidad: 'alumno', 'docente', 'calificación', 'asignación', 'usuario', 'incidencia', 'parcial', 'configuración', 'asistencia'
   * @param {string} entityId - ID del documento afectado
   * @param {object} opts     - { description, before, after, extra }
   */
  async audit(action, entity, entityId, opts = {}) {
    try {
      const user = auth.currentUser;
      const entry = {
        action,
        entity,
        entityId: entityId || '',
        description: opts.description || '',
        before: opts.before || null,
        after: opts.after || null,
        extra: opts.extra || null,
        userId: user?.uid || 'system',
        userEmail: user?.email || 'system',
        userName: user?.displayName || App?.currentUser?.displayName || '',
        userRole: App?.currentUser?.role || '',
        ip: '', // No disponible client-side sin servicio externo
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        date: new Date().toISOString()
      };

      await db.collection('activityLog').add(entry);

      // ═══ ALERTA POR CORREO para acciones críticas ═══
      const critical = ['eliminar', 'login', 'crear_usuario', 'editar_usuario', 'importar', 'cerrar_parcial', 'abrir_parcial'];
      if (critical.includes(action)) {
        DB._queueEmailAlert(entry);
      }
    } catch (e) {
      console.warn('Error en bitácora:', e);
    }
  },

  /**
   * Encola una alerta de correo en la colección emailAlerts.
   * Un Cloud Function o servicio externo (EmailJS, webhook) la procesa.
   */
  async _queueEmailAlert(auditEntry) {
    try {
      await db.collection('emailAlerts').add({
        type: 'audit_alert',
        subject: `[EPO 67] Alerta: ${auditEntry.action} en ${auditEntry.entity}`,
        body: `Acción: ${auditEntry.action.toUpperCase()}\n` +
              `Entidad: ${auditEntry.entity}\n` +
              `Descripción: ${auditEntry.description}\n` +
              `Usuario: ${auditEntry.userEmail} (${auditEntry.userName || 'N/A'})\n` +
              `Rol: ${auditEntry.userRole}\n` +
              `Fecha: ${auditEntry.date}\n` +
              (auditEntry.entityId ? `ID: ${auditEntry.entityId}\n` : ''),
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        auditAction: auditEntry.action,
        auditEntity: auditEntry.entity
      });
    } catch (e) {
      console.warn('Error encolando alerta de email:', e);
    }
  }
};

// Nota: No usamos ES6 exports porque los scripts se cargan globalmente
// Los objetos db, auth, storage, googleProvider, y DB están disponibles
// como variables globales para app.js
