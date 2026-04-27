// ═══════════════════════════════════════════════════════════════
// DATA STORE — Sistema Escolar EPO 67
// Cache en memoria para datos de Firestore. Evita queries
// redundantes cuando multiples modulos necesitan los mismos datos.
// ═══════════════════════════════════════════════════════════════

const Store = (() => {
  const _cache = {};
  const _timestamps = {};
  const _promises = {};

  // TTL en milisegundos por tipo de dato
  const _ttl = {
    students: 10 * 60 * 1000,    // 10 min — datos relativamente estáticos
    teachers: 10 * 60 * 1000,
    groups: 10 * 60 * 1000,
    subjects: 10 * 60 * 1000,
    assignments: 10 * 60 * 1000,
    users: 10 * 60 * 1000,
    partials: 5 * 60 * 1000,     // 5 min — cambian al cerrar parcial
    atRisk: 5 * 60 * 1000,
    grades_group_: 3 * 60 * 1000, // 3 min — cambian con captura de notas
    allGrades: 5 * 60 * 1000,     // 5 min — para monitor de captura
    teacherDocId: 30 * 60 * 1000, // 30 min — casi nunca cambia
    orientadorGroups: 10 * 60 * 1000
  };

  function getTTL(key) {
    if (_ttl[key]) return _ttl[key];
    if (key.startsWith('grades_group_')) return _ttl['grades_group_'];
    if (key.startsWith('students_ori_')) return _ttl['students']; // mismo TTL que students
    return 5 * 60 * 1000; // default 5 min
  }

  function isExpired(key) {
    if (!_timestamps[key]) return true;
    return (Date.now() - _timestamps[key]) > getTTL(key);
  }

  /**
   * Obtiene datos de cache o los fetchea si no existen.
   * Deduplica requests en vuelo (si dos modulos piden students
   * al mismo tiempo, solo se hace un query).
   * Respeta TTL: datos vencidos se re-fetchean automaticamente.
   * @param {string} key - Clave de cache
   * @param {Function} fetchFn - Funcion async que retorna los datos
   * @param {boolean} [force=false] - Forzar re-fetch ignorando cache
   * @returns {Promise<any>}
   */
  async function get(key, fetchFn, force = false) {
    if (!force && _cache[key] !== undefined && !isExpired(key)) {
      return _cache[key];
    }

    // Deduplicar requests en vuelo
    if (_promises[key]) {
      return _promises[key];
    }

    _promises[key] = fetchFn().then(data => {
      _cache[key] = data;
      _timestamps[key] = Date.now();
      delete _promises[key];
      return data;
    }).catch(err => {
      delete _promises[key];
      throw err;
    });

    return _promises[key];
  }

  /**
   * Helpers para colecciones comunes.
   * Cada uno retorna un array de {id, ...data}.
   */

  function snapshotToArray(snapshot) {
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  return {
    // — Colecciones principales —

    getStudents(force) {
      return get('students', async () => {
        const snap = await db.collection('students').get();
        return snapshotToArray(snap);
      }, force);
    },

    getTeachers(force) {
      return get('teachers', async () => {
        const snap = await db.collection('teachers').get();
        return snapshotToArray(snap);
      }, force);
    },

    getGroups(force) {
      return get('groups', async () => {
        const snap = await db.collection('groups').get();
        return snapshotToArray(snap);
      }, force);
    },

    getSubjects(force) {
      return get('subjects', async () => {
        const snap = await db.collection('subjects').get();
        return snapshotToArray(snap);
      }, force);
    },

    getAssignments(force) {
      return get('assignments', async () => {
        const snap = await db.collection('assignments').get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * @deprecated Use getGradesByGroup(groupId) or getGradesByGroups(groupIds) instead for editing.
     * For the capture monitor, use getAllGrades() which reads all grades with a longer cache.
     */
    getGrades(force) {
      console.warn('⚠️ Store.getGrades() is deprecated — use Store.getGradesByGroup(groupId) instead.');
      return this.getAllGrades(force);
    },

    /**
     * Obtiene TODAS las calificaciones en una sola query.
     * Solo para vistas de solo-lectura como el monitor de captura.
     * Cache de 5 min para evitar exceso de reads.
     */
    getAllGrades(force) {
      return get('allGrades', async () => {
        const snap = await db.collection('grades').get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * Obtiene calificaciones filtradas por groupId.
     * Mucho más rápido que getGrades() ya que solo carga un grupo.
     * Usa cache por grupo para evitar re-fetches.
     * @param {string} groupId
     * @param {boolean} [force=false]
     * @returns {Promise<Array>}
     */
    getGradesByGroup(groupId, force) {
      const key = 'grades_group_' + groupId;
      return get(key, async () => {
        const snap = await db.collection('grades').where('groupId', '==', groupId).get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * Obtiene calificaciones filtradas por múltiples groupIds.
     * Para consultas de admin/orientador que abarcan varios grupos.
     * @param {string[]} groupIds
     * @param {boolean} [force=false]
     * @returns {Promise<Array>}
     */
    async getGradesByGroups(groupIds, force) {
      if (!groupIds || groupIds.length === 0) return [];
      // Load each group in parallel, using per-group cache
      const promises = groupIds.map(gid => this.getGradesByGroup(gid, force));
      const results = await Promise.all(promises);
      return results.flat();
    },

    /**
     * Obtiene calificaciones filtradas por groupId Y parcial en el servidor.
     * Reduce ~3x el numero de docs leidos cuando solo se necesita un parcial
     * (vs getGradesByGroup que trae los 3 parciales y filtra en cliente).
     * Cache propio por (group,partial) usando misma TTL que grades_group_.
     * @param {string} groupId
     * @param {string} partial - p.ej. "P1", "P2", "P3"
     * @param {boolean} [force=false]
     * @returns {Promise<Array>}
     */
    getGradesByGroupAndPartial(groupId, partial, force) {
      const key = 'grades_group_' + groupId + '_' + partial;
      return get(key, async () => {
        const snap = await db.collection('grades')
          .where('groupId', '==', groupId)
          .where('partial', '==', partial)
          .get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * Obtiene calificaciones de varios grupos para un parcial especifico.
     * Equivalente a getGradesByGroups pero con filtro de parcial en servidor.
     * @param {string[]} groupIds
     * @param {string} partial
     * @param {boolean} [force=false]
     * @returns {Promise<Array>}
     */
    async getGradesByGroupsAndPartial(groupIds, partial, force) {
      if (!groupIds || groupIds.length === 0) return [];
      const promises = groupIds.map(gid => this.getGradesByGroupAndPartial(gid, partial, force));
      const results = await Promise.all(promises);
      return results.flat();
    },

    getAtRisk(force) {
      return get('atRisk', async () => {
        const snap = await db.collection('atRisk').get();
        return snapshotToArray(snap);
      }, force);
    },

    getPartials(force) {
      return get('partials', async () => {
        const snap = await db.collection('partials').get();
        return snapshotToArray(snap);
      }, force);
    },

    getUsers(force) {
      return get('users', async () => {
        const snap = await db.collection('users').get();
        return snapshotToArray(snap);
      }, force);
    },

    // — Teacher doc ID (duplicado en 3 modulos, ahora centralizado) —

    /**
     * Obtiene el teacherDocId vinculado al usuario actual.
     * Busca primero en el doc de users (campo teacherDocId),
     * luego fallback por email en la coleccion teachers.
     * @returns {Promise<string|null>}
     */
    getTeacherDocId(force) {
      return get('teacherDocId', async () => {
        const userId = auth.currentUser?.uid;
        if (!userId) return null;

        // 1. Buscar en users si tiene teacherDocId vinculado
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists && userDoc.data().teacherDocId) {
          return userDoc.data().teacherDocId;
        }

        // 2. Fallback: buscar en teachers por email
        const userEmail = auth.currentUser?.email;
        if (userEmail) {
          const teachersByEmail = await db.collection('teachers')
            .where('email', '==', userEmail)
            .limit(1)
            .get();
          if (!teachersByEmail.empty) {
            return teachersByEmail.docs[0].id;
          }
        }

        return null;
      }, force);
    },

    // — Orientador group filtering —

    /**
     * Obtiene los IDs de grupos asignados al orientador actual.
     * Si el usuario es admin, retorna null (sin filtro, ve todo).
     * Si es orientador, retorna solo los grupos donde orientadorId === teacherDocId.
     * @returns {Promise<string[]|null>} Array de group IDs o null si es admin
     */
    async getOrientadorGroups() {
      const role = App.currentUser?.role;
      if (role === 'admin') return null; // admin sees everything

      if (role !== 'orientador') return []; // other roles get empty (no access)

      return get('orientadorGroups', async () => {
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) return [];

        const allGroups = await Store.getGroups();
        return allGroups
          .filter(g => g.orientadorId === teacherDocId)
          .map(g => g.id);
      });
    },

    /**
     * Obtiene los alumnos visibles segun el rol del usuario.
     * - Admin: retorna todos los alumnos (delegado a getStudents).
     * - Orientador: query Firestore con where('grupo','in', [nombres]) -
     *   solo trae los alumnos de SUS grupos (~50-150 vs 811 totales).
     * - Otros roles: alumnos vacio.
     *
     * Cache propio por (rol+orientador), invalidado cuando se invalida
     * 'students' o cambia la asignacion de grupos.
     *
     * @param {boolean} [force=false]
     * @returns {Promise<Array>}
     */
    async getStudentsForOrientador(force) {
      const role = App.currentUser?.role;
      if (role === 'admin') return this.getStudents(force);
      if (role !== 'orientador') return [];

      const teacherDocId = await Store.getTeacherDocId();
      const cacheKey = 'students_ori_' + (teacherDocId || 'none');

      return get(cacheKey, async () => {
        const oriGroupIds = await Store.getOrientadorGroups();
        if (!oriGroupIds || oriGroupIds.length === 0) return [];

        const allGroups = await Store.getGroups();
        const oriGroupNames = allGroups
          .filter(g => oriGroupIds.includes(g.id))
          .map(g => g.nombre);

        if (oriGroupNames.length === 0) return [];

        // Firestore where('in') admite hasta 30 valores; un orientador
        // tiene a lo sumo ~9 grupos. Si en el futuro fuera mayor, partir en chunks.
        const snap = await db.collection('students')
          .where('grupo', 'in', oriGroupNames)
          .get();
        return snapshotToArray(snap);
      }, force);
    },

    // — Gestion de cache —

    /**
     * Invalida el cache de una coleccion especifica.
     * Si key es 'grades', tambien limpia todos los caches per-grupo.
     * Llamar despues de cualquier mutacion (create/update/delete).
     * @param {string} key - Nombre de la coleccion (ej: 'students', 'grades')
     */
    invalidate(key) {
      delete _cache[key];
      delete _timestamps[key];
      delete _promises[key];

      // Si se invalida 'grades', limpiar TODOS los caches por grupo
      if (key === 'grades') {
        Object.keys(_cache).forEach(k => {
          if (k.startsWith('grades_group_')) {
            delete _cache[k];
            delete _timestamps[k];
            delete _promises[k];
          }
        });
      }

      // Si se invalida 'students', limpiar tambien los caches por orientador
      if (key === 'students') {
        Object.keys(_cache).forEach(k => {
          if (k.startsWith('students_ori_')) {
            delete _cache[k];
            delete _timestamps[k];
            delete _promises[k];
          }
        });
      }
    },

    /**
     * Invalida el cache de calificaciones solo para un grupo especifico.
     * Mas eficiente que invalidate('grades') cuando solo cambio un grupo.
     * Tambien limpia las variantes por parcial (grades_group_<id>_<partial>).
     * @param {string} groupId
     */
    invalidateGradesForGroup(groupId) {
      const baseKey = 'grades_group_' + groupId;
      // Limpiar la entrada base y todas las variantes por parcial
      Object.keys(_cache).forEach(k => {
        if (k === baseKey || k.startsWith(baseKey + '_')) {
          delete _cache[k];
          delete _timestamps[k];
          delete _promises[k];
        }
      });
    },

    /**
     * Invalida todo el cache. Llamar en logout.
     */
    invalidateAll() {
      Object.keys(_cache).forEach(key => delete _cache[key]);
      Object.keys(_timestamps).forEach(key => delete _timestamps[key]);
      Object.keys(_promises).forEach(key => delete _promises[key]);
    },

    /**
     * Verifica si una clave esta en cache (util para debugging).
     * @param {string} key
     * @returns {boolean}
     */
    isCached(key) {
      return _cache[key] !== undefined && !isExpired(key);
    }
  };
})();
