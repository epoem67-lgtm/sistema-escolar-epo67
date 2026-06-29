// ═══════════════════════════════════════════════════════════════
// DATA STORE — Sistema Escolar EPO 67
// Cache en memoria para datos de Firestore. Evita queries
// redundantes cuando multiples modulos necesitan los mismos datos.
// ═══════════════════════════════════════════════════════════════

const Store = (() => {
  const _cache = {};
  const _timestamps = {};
  const _promises = {};

  // TTLs aumentados para reducir reads de Firestore.
  // Datos estables (groups, teachers, subjects) cambian solo cuando el admin
  // los edita — vale la pena cachear más tiempo. Si el admin cambia algo,
  // ya se llama a Store.invalidate() explícitamente.
  const _ttl = {
    students: 20 * 60 * 1000,    // 20 min — solo cambia al inscribir/dar de baja
    teachers: 30 * 60 * 1000,    // 30 min — casi nunca cambia en producción
    groups: 30 * 60 * 1000,      // 30 min — fijos durante el ciclo
    subjects: 60 * 60 * 1000,    // 60 min — fijos durante el ciclo escolar
    assignments: 20 * 60 * 1000, // 20 min — cambian al reasignar maestros
    users: 15 * 60 * 1000,
    partials: 10 * 60 * 1000,    // 10 min — cambian al cerrar parcial
    atRisk: 5 * 60 * 1000,
    grades_group_: 5 * 60 * 1000, // 5 min — cambian con captura
    allGrades: 10 * 60 * 1000,
    teacherDocId: 60 * 60 * 1000, // 60 min — nunca cambia para un mismo user
    orientadorGroups: 20 * 60 * 1000
  };

  function getTTL(key) {
    if (_ttl[key]) return _ttl[key];
    if (key.startsWith('grades_group_')) return _ttl['grades_group_'];
    if (key.startsWith('students_ori_')) return _ttl['students'];
    return 10 * 60 * 1000; // default 10 min
  }

  function isExpired(key) {
    if (!_timestamps[key]) return true;
    return (Date.now() - _timestamps[key]) > getTTL(key);
  }

  // ═══════════════════════════════════════════════════════════════
  // CAPA DE PERSISTENCIA EN sessionStorage
  // El cache en memoria se pierde al navegar entre páginas o refrescar.
  // sessionStorage persiste durante toda la sesión del navegador y
  // sigue siendo private/por-tab → ideal para reducir reads de Firestore
  // sin riesgo de leak entre sesiones de distintos usuarios.
  // ═══════════════════════════════════════════════════════════════
  const SS_PREFIX = 'epo67_store_';
  // Datos a persistir en sessionStorage. Datos muy dinámicos (grades)
  // mantenemos solo en memoria — la lista de keys que persistimos es
  // explícita para evitar saturar sessionStorage (5MB max).
  const PERSISTED_KEYS = new Set([
    'students', 'teachers', 'groups', 'subjects', 'assignments',
    'partials', 'orientadorGroups', 'teacherDocId',
  ]);
  // Versión del esquema de cache. Bumpear si cambia la forma de los datos.
  const SS_VERSION = 2;
  function _ssKey(key) { return SS_PREFIX + key; }
  function _ssLoad(key) {
    try {
      const raw = sessionStorage.getItem(_ssKey(key));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj.v !== SS_VERSION) return null;
      if ((Date.now() - obj.t) > getTTL(key)) return null;
      return { data: obj.d, ts: obj.t };
    } catch (_) { return null; }
  }
  function _ssSave(key, data) {
    if (!PERSISTED_KEYS.has(key) && !key.startsWith('students_ori_')) return;
    try {
      const payload = JSON.stringify({ v: SS_VERSION, t: Date.now(), d: data });
      // Saltear si el payload es muy grande (>2MB) para no saturar
      if (payload.length > 2 * 1024 * 1024) return;
      sessionStorage.setItem(_ssKey(key), payload);
    } catch (_) {
      // quota exceeded — limpiar cosas viejas
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
        }
      } catch (_) {}
    }
  }
  function _ssRemove(key) {
    try { sessionStorage.removeItem(_ssKey(key)); } catch (_) {}
  }
  // Restaurar cache desde sessionStorage al inicializar
  (function _initFromSession() {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k || !k.startsWith(SS_PREFIX)) continue;
        const dataKey = k.slice(SS_PREFIX.length);
        const loaded = _ssLoad(dataKey);
        if (loaded) {
          _cache[dataKey] = loaded.data;
          _timestamps[dataKey] = loaded.ts;
        } else {
          // Vencido o inválido — borrar
          sessionStorage.removeItem(k);
        }
      }
    } catch (_) {}
  })();

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
      _ssSave(key, data); // persistir entre navegaciones/recargas
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
     * Lee grades DIRECTO del servidor (bypass cache de Firestore offline +
     * cache de memoria). Útil para los casos en que el cache local quedó
     * corrupto o muestra datos vacíos pero el servidor sí tiene la info.
     * @param {string} groupId
     * @returns {Promise<Array>}
     */
    async getGradesByGroupFromServer(groupId) {
      const key = 'grades_group_' + groupId;
      // Limpiar caches en memoria + ssStorage para este grupo
      delete _cache[key];
      delete _timestamps[key];
      delete _promises[key];
      _ssRemove(key);
      // Limpiar variantes por parcial también
      Object.keys(_cache).forEach(k => {
        if (k.startsWith(key + '_')) {
          delete _cache[k];
          delete _timestamps[k];
          delete _promises[k];
          _ssRemove(k);
        }
      });
      // Fetch FORZADO desde servidor (no de IndexedDB local de Firestore)
      try {
        const snap = await db.collection('grades').where('groupId', '==', groupId).get({ source: 'server' });
        const data = snapshotToArray(snap);
        _cache[key] = data;
        _timestamps[key] = Date.now();
        return data;
      } catch (e) {
        // Si el server no responde, caer al cache normal
        console.warn('getGradesByGroupFromServer falló, usando cache:', e);
        return this.getGradesByGroup(groupId, true);
      }
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

    /**
     * Lee teacherHours de varios grupos en UNA sola query (batched).
     * Reemplaza N×3 reads individuales (uno por assignment×parcial).
     * Cache 5 min — cambian solo cuando un docente captura horas.
     * @param {string[]} groupIds
     * @param {boolean} [force=false]
     * @returns {Promise<Map>} Map keyed by docId → {groupId, subjectId, partial, ...mesData, total}
     */
    async getTeacherHoursForGroups(groupIds, force) {
      if (!groupIds || groupIds.length === 0) return new Map();
      const sorted = [...new Set(groupIds)].sort();
      const cacheKey = 'teacherHours_g_' + sorted.join('|');
      return get(cacheKey, async () => {
        // Firestore where('in') admite hasta 30 valores; chunking si hace falta
        const chunks = [];
        for (let i = 0; i < sorted.length; i += 30) chunks.push(sorted.slice(i, i + 30));
        const all = [];
        await Promise.all(chunks.map(async chunk => {
          const snap = await db.collection('teacherHours').where('groupId', 'in', chunk).get();
          snap.docs.forEach(d => all.push({ id: d.id, ...d.data() }));
        }));
        const map = new Map();
        all.forEach(doc => {
          const total = ['febrero','marzo','abril','mayo','junio','julio']
            .reduce((s, m) => s + (parseInt(doc[m]) || 0), 0);
          map.set(doc.id, { ...doc, total });
        });
        return map;
      }, force);
    },

    invalidateTeacherHours() {
      Object.keys(_cache).forEach(k => {
        if (k.startsWith('teacherHours_g_')) {
          delete _cache[k];
          delete _timestamps[k];
        }
      });
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
      // FIX impersonacion: cuando admin usa "Ver como", App.currentUser.teacherId
      // tiene el teacherId del usuario impersonado. Usar ESE en lugar del propio.
      // Sin esto, todos los maestros impersonados mostraban las asignaciones del
      // admin (porque auth.currentUser.uid sigue siendo el del admin).
      const impersonating = App?.currentUser?._impersonating === true;
      if (impersonating) {
        const impTid = App?.currentUser?.teacherId;
        return Promise.resolve(impTid || null);
      }

      return get('teacherDocId', async () => {
        const userId = auth.currentUser?.uid;
        if (!userId) return null;

        // 1. Buscar en users el campo del enlace al docente.
        // El sistema usa indistintamente `teacherDocId` (nombre histórico) o
        // `teacherId` (nombre nuevo desde create-teacher-users.js). Probar ambos.
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          if (data.teacherDocId) return data.teacherDocId;
          if (data.teacherId)    return data.teacherId;
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

    /**
     * Devuelve alumnos según el rol del usuario actual:
     *  - admin / orientador / directivo / consulta → TODOS los alumnos (getStudents)
     *  - maestro / orientador_docente             → solo alumnos de los grupos
     *    donde tiene assignment (vía getMyAssignments → unique groupIds)
     *
     * Esta es la API correcta para que CUALQUIER módulo lea alumnos sin chocar
     * con firestore.rules. Reemplazo seguro de Store.getStudents() en módulos
     * que usen tanto admin como maestro.
     * @returns {Promise<Array>}
     */
    async getStudentsForUser(force) {
      const role = App.currentUser?.role;
      // Roles con visibilidad global: admin, subdirector, orientador, directivo, consulta.
      // Auditor (flag aditivo App.canActAs('auditor')) también ve todo en lectura.
      if (role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo' || role === 'consulta' || App.canActAs('auditor')) {
        return this.getStudents(force);
      }
      // maestro / orientador_docente: solo alumnos de sus grupos
      const myAsg = await this.getMyAssignments(force);
      const groupIds = [...new Set(myAsg.map(a => a.groupId).filter(Boolean))];
      if (groupIds.length === 0) return [];
      return this.getStudentsByGroups(groupIds, force);
    },

    /**
     * Obtiene alumnos de UN solo grupo via where('groupId','==', X).
     * Respeta firestore.rules para maestros (que solo pueden leer alumnos
     * de sus propios grupos). Cache por grupo.
     * @param {string} groupId
     * @returns {Promise<Array>}
     */
    getStudentsByGroup(groupId, force) {
      const key = 'students_group_' + groupId;
      return get(key, async () => {
        const snap = await db.collection('students')
          .where('groupId', '==', groupId)
          .get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * Obtiene alumnos de varios grupos en paralelo (cache por grupo).
     * Para maestros: pasar solo los groupIds donde tiene asignación.
     * @param {string[]} groupIds
     * @returns {Promise<Array>}
     */
    async getStudentsByGroups(groupIds, force) {
      if (!groupIds || groupIds.length === 0) return [];
      const promises = groupIds.map(gid => this.getStudentsByGroup(gid, force));
      const results = await Promise.all(promises);
      return results.flat();
    },

    /**
     * Obtiene SOLO las asignaciones del maestro/orientador_docente actual.
     * Usa una query con `where('teacherId','==', myId)` que respeta las reglas
     * de Firestore (un maestro no puede leer assignments ajenas).
     * Para admin/orientador/directivo se delega a getAssignments() (sin filtro).
     * @returns {Promise<Array>}
     */
    async getMyAssignments(force) {
      const role = App.currentUser?.role;
      // Roles que ven TODAS las asignaciones (admin, subdirector, orientador, directivo, auditor)
      if (role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo' || App.canActAs('auditor')) {
        return this.getAssignments(force);
      }
      const teacherDocId = await this.getTeacherDocId();
      if (!teacherDocId) return [];
      const cacheKey = 'assignments_my_' + teacherDocId;
      return get(cacheKey, async () => {
        const snap = await db.collection('assignments')
          .where('teacherId', '==', teacherDocId)
          .get();
        return snapshotToArray(snap);
      }, force);
    },

    /**
     * v8.09: getOwnAssignments() — STRICT.
     * Devuelve SIEMPRE solo las asignaciones donde teacherId == este usuario,
     * sin importar auditorScope, presidente_academia, ni ningún otro rol.
     * Para módulos de ESCRITURA (captura de calificaciones, extraordinarios,
     * solicitudes de corrección). Usa esta versión, NO getMyAssignments(),
     * para evitar que auditores con scope global vean (y editen) listas que
     * no les corresponden.
     *
     * Admin/subdirector vacío array si no son docentes (no tienen teacherId).
     * Si necesitas edición global usa Store.getAssignments() y filtra a mano.
     */
    async getOwnAssignments(force) {
      const teacherDocId = await this.getTeacherDocId();
      if (!teacherDocId) return [];
      const cacheKey = 'assignments_own_' + teacherDocId;
      return get(cacheKey, async () => {
        const snap = await db.collection('assignments')
          .where('teacherId', '==', teacherDocId)
          .get();
        return snapshotToArray(snap);
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
      // admin + subdirector + directivo + auditor ven TODOS los grupos (sin filtro).
      // directivo (Lupita Secretaria Administrativa) tiene "lectura completa" por
      // política institucional (CLAUDE.md: Personal directivo). Auditor (Jessica
      // con auditorScope=true) tiene visibilidad global EN LECTURA.
      // El módulo que use esto interpreta `null` como "no filtres, muestra todo".
      if (role === 'admin' || role === 'subdirector' || role === 'directivo' || App.canActAs('auditor')) return null;

      if (!App.canActAs('orientador')) return []; // other roles get empty

      return get('orientadorGroups', async () => {
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) return [];

        const allGroups = await Store.getGroups();
        // Match preferente por orientadorId; fallback por nombre (datos legacy
        // donde solo guardaron g.orientador como string).
        const directMatches = allGroups
          .filter(g => g.orientadorId === teacherDocId)
          .map(g => g.id);
        if (directMatches.length > 0) return directMatches;

        // Fallback: comparar nombres con el teacher actual
        const teachers = await Store.getTeachers();
        const me = teachers.find(t => t.id === teacherDocId);
        if (!me || !me.nombre) return [];
        const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
        const stripT = s => norm(s).replace(/\bPROFRA?\.?|\bMTRA?\.?|\bDR[A]?\.?|\bLIC\.?|\bMA\.?/g, '').trim();
        const myWords = stripT(me.nombre).split(/\s+/).filter(w => w.length > 2);
        if (myWords.length < 2) return [];

        return allGroups.filter(g => {
          const ori = g.orientador || g.orientadorNombre || '';
          if (!ori) return false;
          const oriWords = stripT(ori).split(/\s+/).filter(w => w.length > 2);
          const overlap = oriWords.filter(w => myWords.includes(w)).length;
          return overlap >= 2;
        }).map(g => g.id);
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
      // admin + subdirector + auditor ven TODOS los alumnos.
      if (role === 'admin' || role === 'subdirector' || App.canActAs('auditor')) return this.getStudents(force);
      if (!App.canActAs('orientador')) return [];

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
      _ssRemove(key);

      // Si se invalida 'grades', limpiar TODOS los caches por grupo
      if (key === 'grades') {
        Object.keys(_cache).forEach(k => {
          if (k.startsWith('grades_group_')) {
            delete _cache[k];
            delete _timestamps[k];
            delete _promises[k];
            _ssRemove(k);
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
            _ssRemove(k);
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
      Object.keys(_cache).forEach(k => {
        if (k === baseKey || k.startsWith(baseKey + '_')) {
          delete _cache[k];
          delete _timestamps[k];
          delete _promises[k];
          _ssRemove(k);
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
      // Limpiar sessionStorage también
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(SS_PREFIX)) sessionStorage.removeItem(k);
        }
      } catch (_) {}
    },

    /**
     * Verifica si una clave esta en cache (util para debugging).
     * @param {string} key
     * @returns {boolean}
     */
    isCached(key) {
      return _cache[key] !== undefined && !isExpired(key);
    },

    // ═════════════════════════════════════════════════════════════════
    // SNAPSHOTS CERTIFICADOS (v8.26)
    // Blinda calificaciones contra bugs y ediciones posteriores.
    // Se crea snapshot AUTOMÁTICO al imprimir lista oficial.
    // Boletas/concentrados leen del snapshot más reciente, NO de grades.
    // Así garantizamos: papel firmado = lo que muestra el sistema.
    // ═════════════════════════════════════════════════════════════════

    /**
     * Genera un hash corto (8 chars) determinístico de un objeto.
     * Usado como código de versión visible en PDFs impresos.
     */
    async _hashItems(items) {
      try {
        const str = JSON.stringify(items.map(function(i){
          return { s: i.studentId, e: i.ec, t: i.tr, p: i.pe, x: i.ex, c: i.cal, f: i.faltas };
        }));
        const buf = new TextEncoder().encode(str);
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const arr = Array.from(new Uint8Array(hashBuf));
        return arr.slice(0, 4).map(function(b){return b.toString(16).padStart(2,'0');}).join('').toUpperCase();
      } catch (e) {
        return 'NOHASH00';
      }
    },

    /**
     * Crea snapshot certificado para (groupId, subjectId, partial).
     * Llamar automáticamente al imprimir lista oficial.
     *
     * @param {Object} params
     * @param {string} params.groupId
     * @param {string} params.subjectId
     * @param {string} params.partial
     * @param {Array} params.items - array de {studentId, ec, tr, pe, ex, suma, cal, faltas, studentName}
     * @param {string} params.teacherId
     * @param {string} params.teacherName
     * @returns {Promise<{snapshotId, hash}>}
     */
    async createSnapshot(params) {
      const groupId = params.groupId;
      const subjectId = params.subjectId;
      const partial = params.partial;
      const items = (params.items || []).filter(function(i){return i && i.studentId;});

      if (!groupId || !subjectId || !partial) {
        throw new Error('createSnapshot: faltan groupId/subjectId/partial');
      }

      const hash = await this._hashItems(items);
      const now = new Date();
      const dateStr = now.toISOString().slice(0,10).replace(/-/g, '');
      const timeStr = now.toISOString().slice(11,19).replace(/:/g, '');
      // DocId con timestamp para mantener TODOS los snapshots (no sobreescribir)
      const snapshotId = groupId + '_' + subjectId + '_' + partial + '_' + dateStr + 'T' + timeStr + '_' + hash;

      const currentUser = (typeof App !== 'undefined' && App.currentUser) || {};
      const data = {
        groupId: groupId,
        subjectId: subjectId,
        partial: partial,
        items: items,
        itemCount: items.length,
        hash: hash,
        certifiedAt: firebase.firestore.FieldValue.serverTimestamp(),
        certifiedAtIso: now.toISOString(),
        certifiedByUid: (typeof auth !== 'undefined' && auth.currentUser) ? auth.currentUser.uid : 'unknown',
        certifiedByName: currentUser.displayName || currentUser.email || 'unknown',
        certifiedByRole: currentUser.role || '',
        teacherId: params.teacherId || '',
        teacherName: params.teacherName || '',
        source: 'auto-print',  // generado automaticamente al imprimir
        note: 'Snapshot automatico generado al imprimir lista oficial',
        // v8.85 BLINDAJE: marca de sello COMPLETO (faltas + cal + rubros por alumno).
        // Solo los sellos con complete===true (o sealVersion>=2) mandan en los
        // reportes. Los sellos viejos (certificación manual sin faltas) se ignoran
        // para no descuadrar nada. Cada impresión crea un sello nuevo (docId con
        // timestamp) e INMUTABLE (firestore.rules: update/delete = false).
        complete: true,
        sealVersion: 2
      };

      await db.collection('certifiedSnapshots').doc(snapshotId).set(data);
      console.log('[snapshot] CREADO:', snapshotId, 'hash=' + hash + ' items=' + items.length);

      // Invalidar cache de snapshots para que la próxima lectura traiga este nuevo
      const cacheKey = 'snapshot_' + groupId + '_' + subjectId + '_' + partial;
      delete _cache[cacheKey];
      delete _timestamps[cacheKey];

      return { snapshotId: snapshotId, hash: hash, certifiedAtIso: now.toISOString() };
    },

    /**
     * Obtiene el snapshot MÁS RECIENTE para (groupId, subjectId, partial).
     * Cache de 5 minutos (igual que grades).
     *
     * @returns {Promise<Object|null>} {hash, certifiedAtIso, items, ...} o null si no hay snapshot
     */
    async getLatestSnapshot(groupId, subjectId, partial, opts) {
      const force = opts && opts.force;
      const cacheKey = 'snapshot_' + groupId + '_' + subjectId + '_' + partial;
      if (!force && _cache[cacheKey] !== undefined && !isExpired(cacheKey)) {
        return _cache[cacheKey];
      }

      try {
        // Query por groupId+subjectId+partial, ordenado por certifiedAt DESC, limit 1
        const snap = await db.collection('certifiedSnapshots')
          .where('groupId', '==', groupId)
          .where('subjectId', '==', subjectId)
          .where('partial', '==', partial)
          .orderBy('certifiedAt', 'desc')
          .limit(1)
          .get();
        const result = snap.empty ? null : snap.docs[0].data();
        _cache[cacheKey] = result;
        _timestamps[cacheKey] = Date.now();
        return result;
      } catch (e) {
        // Fallback sin orderBy si Firestore necesita índice compuesto
        console.warn('[snapshot] getLatestSnapshot con orderBy falló:', e.message, '— intentando fallback');
        try {
          const snap = await db.collection('certifiedSnapshots')
            .where('groupId', '==', groupId)
            .where('subjectId', '==', subjectId)
            .where('partial', '==', partial)
            .get();
          if (snap.empty) {
            _cache[cacheKey] = null;
            _timestamps[cacheKey] = Date.now();
            return null;
          }
          // Ordenar en cliente por certifiedAtIso DESC
          const docs = snap.docs.map(function(d){return d.data();}).sort(function(a,b){
            return (b.certifiedAtIso || '').localeCompare(a.certifiedAtIso || '');
          });
          const result = docs[0];
          _cache[cacheKey] = result;
          _timestamps[cacheKey] = Date.now();
          return result;
        } catch (e2) {
          console.error('[snapshot] getLatestSnapshot fallback también falló:', e2);
          return null;
        }
      }
    },

    /**
     * Obtiene snapshots de TODAS las materias de un grupo+parcial.
     * Usado en concentrados/boletas que leen todas las materias.
     * @returns {Promise<Array>} array de snapshots, uno por subjectId (el más reciente)
     */
    async getLatestSnapshotsByGroup(groupId, partial) {
      try {
        const snap = await db.collection('certifiedSnapshots')
          .where('groupId', '==', groupId)
          .where('partial', '==', partial)
          .get();
        if (snap.empty) return [];
        // Agrupar por subjectId y quedarse con el más reciente
        const bySubject = {};
        snap.docs.forEach(function(doc){
          const data = doc.data();
          const prev = bySubject[data.subjectId];
          if (!prev || (data.certifiedAtIso || '') > (prev.certifiedAtIso || '')) {
            bySubject[data.subjectId] = data;
          }
        });
        return Object.values(bySubject);
      } catch (e) {
        console.warn('[snapshot] getLatestSnapshotsByGroup falló:', e.message);
        return [];
      }
    },

    /**
     * "Aplana" un snapshot para que se vea igual que un array de docs de grades.
     * Permite reusar el código existente que espera grades-like docs.
     */
    snapshotToGrades(snapshot) {
      if (!snapshot || !snapshot.items) return [];
      return snapshot.items.map(function(item){
        return {
          studentId: item.studentId,
          subjectId: snapshot.subjectId,
          groupId: snapshot.groupId,
          partial: snapshot.partial,
          ec: item.ec,
          tr: item.tr,
          pe: item.pe,
          ex: item.ex,
          suma: item.suma,
          cal: item.cal,
          value: item.value !== undefined ? item.value : item.cal,
          faltas: item.faltas,
          // Marca para debugging — si aparece en UI, sabemos que vino del snapshot
          __fromSnapshot: true,
          __snapshotHash: snapshot.hash,
          __snapshotDate: snapshot.certifiedAtIso
        };
      });
    },

    /**
     * Versión "sellada" de getGradesByGroup que prefiere snapshots si existen.
     * Para cada (subjectId, partial) del grupo, devuelve el snapshot más reciente
     * si existe; si no, los grades actuales.
     *
     * Esto blinda boletas/concentrados contra bugs de edición posterior.
     */
    async getSealedGradesByGroup(groupId, opts) {
      const force = opts && opts.force;
      // Cargar grades actuales y snapshots en paralelo
      const [rawGrades, allSnaps] = await Promise.all([
        this.getGradesByGroup(groupId, force),
        this._getAllSnapshotsByGroup(groupId, force)
      ]);
      // v8.85 BLINDAJE: SOLO mandan los sellos COMPLETOS (v2, generados al
      // imprimir, con faltas+cal+rubros). Los sellos viejos (certificación manual
      // sin faltas) se IGNORAN — leer de ellos descuadraba los reportes. Si no hay
      // sello v2 para el grupo, se lee lo VIVO (failsafe: nunca peor que hoy).
      const snapshots = (allSnaps || []).filter(function(s){
        return s && (s.complete === true || Number(s.sealVersion) >= 2);
      });
      if (snapshots.length === 0) return rawGrades || [];

      // Indexar snapshots por subjectId+partial → snapshot más reciente
      const snapMap = {};
      snapshots.forEach(function(s){
        const k = s.subjectId + '_' + s.partial;
        const prev = snapMap[k];
        if (!prev || (s.certifiedAtIso || '') > (prev.certifiedAtIso || '')) {
          snapMap[k] = s;
        }
      });

      // Para cada grade raw: si hay snapshot que lo cubre, USAR el del snapshot
      const replaced = new Set();
      const result = [];
      (rawGrades || []).forEach(function(g){
        const k = g.subjectId + '_' + g.partial;
        if (snapMap[k]) {
          // Buscar el item del snapshot para este alumno
          const item = (snapMap[k].items || []).find(function(it){return it.studentId === g.studentId;});
          if (item) {
            result.push({
              studentId: item.studentId,
              subjectId: snapMap[k].subjectId,
              groupId: snapMap[k].groupId,
              partial: snapMap[k].partial,
              ec: item.ec, tr: item.tr, pe: item.pe, ex: item.ex,
              suma: item.suma, cal: item.cal,
              value: item.value !== undefined ? item.value : item.cal,
              faltas: item.faltas,
              __fromSnapshot: true,
              __snapshotHash: snapMap[k].hash
            });
            replaced.add(g.studentId + '_' + g.subjectId + '_' + g.partial);
            return;
          }
        }
        // No hay snapshot que cubra este grade — usar raw
        result.push(g);
      });

      // Agregar items del snapshot que no estaban en grades (caso raro)
      Object.values(snapMap).forEach(function(s){
        (s.items || []).forEach(function(item){
          const k = item.studentId + '_' + s.subjectId + '_' + s.partial;
          if (!replaced.has(k)) {
            // Verificar que tampoco esté en rawGrades
            const exists = (rawGrades || []).some(function(g){
              return g.studentId === item.studentId && g.subjectId === s.subjectId && g.partial === s.partial;
            });
            if (!exists) {
              result.push({
                studentId: item.studentId,
                subjectId: s.subjectId, groupId: s.groupId, partial: s.partial,
                ec: item.ec, tr: item.tr, pe: item.pe, ex: item.ex,
                suma: item.suma, cal: item.cal,
                value: item.value !== undefined ? item.value : item.cal,
                faltas: item.faltas,
                __fromSnapshot: true, __snapshotHash: s.hash
              });
            }
          }
        });
      });

      return result;
    },

    /**
     * Helper interno: TODOS los snapshots del grupo (sin filtrar por parcial).
     * Cache de 5 min.
     */
    async _getAllSnapshotsByGroup(groupId, force) {
      const cacheKey = 'all_snapshots_group_' + groupId;
      if (!force && _cache[cacheKey] !== undefined && !isExpired(cacheKey)) {
        return _cache[cacheKey];
      }
      try {
        const snap = await db.collection('certifiedSnapshots')
          .where('groupId', '==', groupId)
          .get();
        const result = snap.empty ? [] : snap.docs.map(function(d){return d.data();});
        _cache[cacheKey] = result;
        _timestamps[cacheKey] = Date.now();
        return result;
      } catch (e) {
        console.warn('[snapshot] _getAllSnapshotsByGroup falló:', e.message);
        return [];
      }
    }
  };
})();
