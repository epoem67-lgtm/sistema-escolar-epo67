/**
 * MÓDULO DE CALIFICACIONES — Sistema Escolar EPO 67
 *
 * Vista maestro: cards de asignaciones → editor con rubros (Evaluación Continua,
 *   Transversal, Examen Parcial -solo vesp-, Punto Extra)
 *   auto-cálculo de SUMA y CAL, campo de FALTAS
 *   Solo editable cuando el parcial está abierto (o con override)
 *
 * Vista admin/orientador: filtros cascada Turno→Grado→Grupo→Parcial→Materia→Docente
 *   tabla con rubros completos, solo lectura (orientador), edición (admin)
 *
 * Rubros por turno:
 *   MATUTINO:   Evaluación Continua (máx 8) + Transversal (máx 2) + Punto Extra = SUMA → CAL
 *   VESPERTINO: Evaluación Continua (máx 5) + Examen Parcial (máx 3) + Transversal (máx 2) + Punto Extra = SUMA → CAL
 *
 * Regla redondeo: ≥6 normal, <6 truncar (5.9→5). Mín 5, Máx 10.
 */

const GradesModule = (function () {
  const CONTAINER = '#moduleContainer';

  // ─── Teacher view state ───
  let selectedGroup = null;
  let selectedSubject = null;
  let currentPartial = 'P1';
  let students = [];
  let assignments = [];
  let grades = {};
  let currentTurno = 'MATUTINO';
  let _listCleared = false;

  // ─── Admin view state ───
  let _admin = {
    allStudents: [], allGrades: [], allAssignments: [],
    allTeachers: [], allSubjects: [], allGroups: [], allPartials: [],
    turno: '', grado: '', grupo: '', parcial: '', materia: '', docente: ''
  };

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  function _el(id) { return document.getElementById(id); }
  function _container() { return document.querySelector(CONTAINER); }

  // BUGFIX v5.96 — el listener se acumulaba en cada render porque
  // _delegateClick se llamaba desde 3 lugares (renderTeacher, openGradeEditor,
  // renderAdmin). Cada addEventListener apilaba un handler nuevo. Resultado:
  // cada clic en Imprimir abría N pestañas (donde N = número de renders).
  // El flag previene duplicados. El listener es delegado en moduleContainer
  // (que persiste entre renders), así que un solo bind cubre todo.
  let _delegateBound = false;
  function _delegateClick(container) {
    if (_delegateBound) return;
    _delegateBound = true;
    container.addEventListener('click', async function (e) {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a = t.dataset.action;
      if (a === 'open-editor') api.openGradeEditor(t.dataset.assignmentId, t.dataset.groupId, t.dataset.subjectId);
      else if (a === 'switch-assignment') {
        // Cambio de pestaña / botón Anterior-Siguiente
        const newAsgId = t.dataset.assignmentId;
        if (!newAsgId) return;
        if (!_canLeaveEditor('switch')) return;

        // BLOQUEO: si hay reprobados sin incidencia registrada, forzar captura
        const ok = await _enforceIncidentsBeforeLeave('cambiar de lista');
        if (!ok) return;

        if (_isDirty) {
          if (!confirm('Tienes cambios sin guardar en esta lista. ¿Cambiar de lista sin guardar?')) return;
        }
        api.openGradeEditor(newAsgId, t.dataset.groupId, t.dataset.subjectId);
      }
      else if (a === 'switch-partial') api.switchPartial(t.dataset.partial);
      else if (a === 'save-grades') api.saveGrades();
      else if (a === 'clear-grades-list') _confirmClearCurrentList();
      else if (a === 'back-to-list') {
        if (!_canLeaveEditor('back')) return;

        // BLOQUEO: si hay reprobados sin incidencia, forzar captura
        const ok = await _enforceIncidentsBeforeLeave('volver a la lista de grupos');
        if (!ok) return;

        if (_isDirty) {
          if (!confirm('Tienes cambios sin guardar. ¿Deseas salir sin guardar?')) return;
        }
        api.renderTeacher();
      }
      else if (a === 'export-grades') api.exportGrades();
      else if (a === 'print-grades') api.printGrades();
      else if (a === 'print-selected-assignments') _printSelectedAssignments(false);
      else if (a === 'print-all-assignments') _printSelectedAssignments(true);
      else if (a === 'print-admin-grades') api.printAdminGrades();
      else if (a === 'report-incident') _showIncidentModal(t.dataset.studentId, t.dataset.studentName);
    });
  }

  // Verifica si hay alumnos reprobados sin incidencia y FUERZA al maestro a
  // capturarla antes de cambiar de lista. Si captura, persiste y permite seguir.
  // Si cancela, NO permite el cambio.
  async function _enforceIncidentsBeforeLeave(actionLabel) {
    if (!_isTeacherCaptureRole() || _listCleared) return true;
    if (!selectedSubject || !selectedGroup) return true;
    try {
      const rubros = K.getRubros(currentTurno);
      const failingStudents = _getFailingStudentsForIncident(rubros);
      if (failingStudents.length === 0) return true;
      const missing = await _getMissingFailureIncidents(failingStudents);
      if (missing.length === 0) return true;

      // Forzar captura. _collectFailureIncidentReasons retorna null si cancelan.
      const reports = await _collectFailureIncidentReasons(missing);
      if (reports === null) {
        Toast.show(`No puedes ${actionLabel} sin registrar el motivo de los alumnos reprobados.`, 'warning');
        return false;
      }
      if (!Array.isArray(reports) || reports.length === 0) return true;

      // Persistir incidencias en Firestore
      const currentList = _getCurrentListLabel();
      const batch = db.batch();
      reports.forEach(r => {
        const ref = db.collection('incidents').doc(_failureIncidentDocId(r.studentId));
        batch.set(ref, {
          studentId: r.studentId,
          groupId: selectedGroup,
          turno: currentTurno,
          type: 'academica',
          incidentKind: 'reprobación',
          requiredBy: 'switch-assignment',
          title: `Reprobación en ${currentList.subjectName}`,
          description: r.reason,
          subjectId: selectedSubject,
          subjectName: currentList.subjectName,
          partial: currentPartial,
          partialName: currentList.partialName,
          grade: r.cal,
          suma: r.suma,
          date: new Date(),
          status: 'activa',
          createdAt: new Date(),
          createdBy: auth.currentUser.uid,
        }, { merge: true });
      });
      await batch.commit();
      Toast.show(`Incidencias registradas (${reports.length}). Esto ayuda a Orientación cuando vienen los papás.`, 'success');
      return true;
    } catch (e) {
      console.error('Error verificando incidencias antes de cambiar de lista:', e);
      Toast.show('No se pudieron verificar las incidencias. Intenta de nuevo.', 'error');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEACHER VIEW — cards de asignaciones
  // ═══════════════════════════════════════════════════════════════

  // ─── Cascade filter state for teacher/admin assignment selection ───
  let _capAssignments = [];

  // ─── Assignment status cache (para las pestañas del editor) ───
  // { assignmentId: { filled: N, total: N, percent: 0..100, status: 'complete'|'partial'|'empty' } }
  let _assignmentStatusCache = {};
  let _assignmentStatusForPartial = null;  // 'P1' | 'P2' | 'P3'

  /** Carga grades de todos los grupos del maestro y pre-calcula el estado de cada
   *  asignación para el parcial dado. Invalida cache si cambia parcial. */
  async function _loadAssignmentStatuses(partial) {
    if (_assignmentStatusForPartial === partial && Object.keys(_assignmentStatusCache).length > 0) {
      return _assignmentStatusCache;
    }
    const groupIds = [...new Set(_capAssignments.map(a => a.groupId).filter(Boolean))];
    if (groupIds.length === 0) return {};

    try {
      // Para maestros, getStudents() es rechazado por las reglas. Usar query
      // filtrada por groupIds (los grupos del maestro) que sí está permitida.
      const role = App.currentUser?.role;
      const fetchStudents = (role === 'admin' || role === 'orientador' || role === 'directivo')
        ? Store.getStudents()
        : Store.getStudentsByGroups(groupIds);

      const [allStudents, allGrades] = await Promise.all([
        fetchStudents,
        Store.getGradesByGroupsAndPartial(groupIds, partial),
      ]);

      // Indexar alumnos por grupo
      const studentsByGroup = {};
      for (const s of allStudents) {
        if (!s.groupId) continue;
        if (!studentsByGroup[s.groupId]) studentsByGroup[s.groupId] = [];
        studentsByGroup[s.groupId].push(s);
      }

      // Indexar grades por (subjectId + groupId) → set de studentIds con al menos un rubro
      const filledByAssignment = {};
      for (const g of allGrades) {
        const key = `${g.subjectId}_${g.groupId}`;
        if (!filledByAssignment[key]) filledByAssignment[key] = new Set();
        // Considera "lleno" si tiene al menos un rubro o cal/value
        const hasValue = ['ec', 'tr', 'ex', 'pe', 'cal', 'value'].some(k =>
          g[k] !== undefined && g[k] !== null && g[k] !== ''
        );
        if (hasValue) filledByAssignment[key].add(g.studentId);
      }

      const cache = {};
      for (const a of _capAssignments) {
        const total = (studentsByGroup[a.groupId] || []).length;
        const filled = (filledByAssignment[`${a.subjectId}_${a.groupId}`] || new Set()).size;
        const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
        let status = 'empty';
        if (filled === total && total > 0) status = 'complete';
        else if (filled > 0) status = 'partial';
        cache[a.id] = { filled, total, percent, status };
      }
      _assignmentStatusCache = cache;
      _assignmentStatusForPartial = partial;
      return cache;
    } catch (e) {
      console.warn('Error cargando estado de asignaciones:', e);
      return {};
    }
  }

  /** Invalida el cache de estado para una asignación específica
   *  (después de guardar). El siguiente render lo recalcula. */
  function _invalidateAssignmentStatus(assignmentId) {
    if (assignmentId) delete _assignmentStatusCache[assignmentId];
  }

  /** Lista ordenada de asignaciones del maestro (matutino primero, luego por grado, grupo, materia). */
  function _orderedAssignments() {
    const turnoOrd = { 'MATUTINO': 1, 'VESPERTINO': 2, 'AMBOS': 3 };
    return [..._capAssignments].sort((a, b) => {
      const ta = turnoOrd[(a.turno || '').toUpperCase()] || 9;
      const tb = turnoOrd[(b.turno || '').toUpperCase()] || 9;
      if (ta !== tb) return ta - tb;
      const ga = Number(a.grado) || 9;
      const gb = Number(b.grado) || 9;
      if (ga !== gb) return ga - gb;
      const gna = (a.groupName || '').localeCompare(b.groupName || '');
      if (gna !== 0) return gna;
      return (a.subjectName || '').localeCompare(b.subjectName || '');
    });
  }

  /** HTML de las pestañas de asignaciones del maestro con su estado. */
  function _renderAssignmentTabs(currentAssignmentId) {
    const ordered = _orderedAssignments();
    if (ordered.length <= 1) return '';  // 1 sola asignación: no muestra navegador

    const options = ordered.map(a => {
      const st = _assignmentStatusCache[a.id] || { filled: 0, total: 0, percent: 0, status: 'empty' };
      const isActive = a.id === currentAssignmentId;
      const statusLabel = st.status === 'complete' ? 'Completa'
        : st.status === 'partial' ? 'En captura'
        : 'Sin captura';
      const label = `${a.turno || ''} ${a.groupName || ''} - ${K.getUACNombre(a.subjectName || a.subjectId || '')} (${statusLabel}: ${st.filled}/${st.total})`;
      return `<option value="${Utils.sanitize(a.id)}" ${isActive ? 'selected' : ''}>${Utils.sanitize(label)}</option>`;
    }).join('');

    // Botones grandes Anterior / Siguiente — ahora muestran nombre de lista destino
    const idx = ordered.findIndex(a => a.id === currentAssignmentId);
    const prev = idx > 0 ? ordered[idx - 1] : null;
    const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
    const currentLabel = idx >= 0
      ? `${ordered[idx].turno || ''} ${ordered[idx].groupName || ''} — ${K.getUACNombre(ordered[idx].subjectName || '')}`
      : '';
    const prevLabel = prev ? `${prev.groupName || ''} ${K.getUACNombre(prev.subjectName || '').slice(0, 28)}` : 'Sin anterior';
    const nextLabel = next ? `${next.groupName || ''} ${K.getUACNombre(next.subjectName || '').slice(0, 28)}` : 'Última lista';
    const nav = `
      <div class="ge-nav" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#f8fafc;padding:12px;border-radius:8px;margin-top:8px;">
        <button class="btn btn-outline ge-nav-prev" ${!prev ? 'disabled' : ''}
          data-action="switch-assignment"
          data-assignment-id="${prev?.id || ''}"
          data-group-id="${prev?.groupId || ''}"
          data-subject-id="${prev?.subjectId || ''}"
          style="display:flex;align-items:center;gap:6px;padding:10px 14px;text-align:left;flex:1;min-width:200px;max-width:300px;">
          <span style="font-size:18px;line-height:1;">◀</span>
          <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.2;">
            <span style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Anterior</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;">${Utils.sanitize(prevLabel)}</span>
          </span>
        </button>

        <div style="flex:0 0 auto;text-align:center;padding:8px 12px;background:#3182ce;color:#fff;border-radius:6px;font-weight:700;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.85;">Lista actual</div>
          <div style="font-size:14px;margin-top:2px;">${idx + 1} de ${ordered.length}</div>
          <div style="font-size:11px;opacity:0.92;margin-top:2px;">${Utils.sanitize(currentLabel)}</div>
        </div>

        <button class="btn btn-primary ge-nav-next" ${!next ? 'disabled' : ''}
          data-action="switch-assignment"
          data-assignment-id="${next?.id || ''}"
          data-group-id="${next?.groupId || ''}"
          data-subject-id="${next?.subjectId || ''}"
          style="display:flex;align-items:center;gap:6px;padding:10px 14px;text-align:right;flex:1;min-width:200px;max-width:300px;justify-content:flex-end;">
          <span style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.2;">
            <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;opacity:0.85;">Siguiente</span>
            <span style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;">${Utils.sanitize(nextLabel)}</span>
          </span>
          <span style="font-size:18px;line-height:1;">▶</span>
        </button>
      </div>`;

    return `
      <div class="ge-tabs-container ge-assignment-nav">
        <div class="ge-assignment-nav-header">
          <div>
            <h3>Cambiar de lista</h3>
            <p>El avance indica cuántos alumnos ya tienen captura en este parcial.</p>
          </div>
          <select id="assignment-jump" aria-label="Cambiar de lista">${options}</select>
        </div>
        <div class="ge-status-legend">
          <span class="ge-status-pill ge-status-complete">Completa: todos los alumnos tienen captura</span>
          <span class="ge-status-pill ge-status-partial">En captura: faltan alumnos por capturar</span>
          <span class="ge-status-pill ge-status-empty">Sin captura: todavía no hay registros</span>
        </div>
        ${nav}
      </div>`;
  }

  function _renderBulkPrintPanel() {
    const ordered = _orderedAssignments();
    if (ordered.length === 0) return '';

    const partialOptions = K.PARCIALES.map(p =>
      `<option value="${p.id}" ${p.id === currentPartial ? 'selected' : ''}>${Utils.sanitize(p.nombre)}</option>`
    ).join('');

    const rows = ordered.map(a => {
      const st = _assignmentStatusCache[a.id] || { filled: 0, total: 0, percent: 0, status: 'empty' };
      const statusLabel = st.status === 'complete' ? 'Lista completa'
        : st.status === 'partial' ? 'Lista en captura'
        : 'Sin captura';
      return `
        <label class="bulk-print-item">
          <input type="checkbox" class="bulk-print-check" value="${Utils.sanitize(a.id)}">
          <span class="bulk-print-main">
            <strong>${Utils.sanitize(a.groupName || a.groupId || '')}</strong>
            <span>${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId || ''))}</span>
          </span>
          <span class="bulk-print-status bulk-print-status--${st.status}">
            ${statusLabel} · ${st.filled}/${st.total}
          </span>
        </label>`;
    }).join('');

    return `
      <div class="card bulk-print-panel">
        <div class="bulk-print-header">
          <div>
            <h3>Imprimir listas</h3>
            <p>Elige el parcial y marca las listas que quieres imprimir en un solo documento.</p>
          </div>
          <div class="bulk-print-actions">
            <select id="bulk-print-partial" aria-label="Parcial para imprimir">${partialOptions}</select>
            <button class="btn btn-outline" data-action="print-selected-assignments">
              <span class="material-icons-round">print</span> Seleccionadas
            </button>
            <button class="btn btn-primary" data-action="print-all-assignments">
              <span class="material-icons-round">print</span> Todas
            </button>
          </div>
        </div>
        <div class="bulk-print-list">${rows}</div>
      </div>`;
  }

  async function renderTeacher() {
    const container = _container();
    // Cleanup from previous editor session
    if (container._undoHandler) {
      document.removeEventListener('keydown', container._undoHandler);
      container._undoHandler = null;
    }
    window.removeEventListener('beforeunload', _beforeUnloadGuard);
    if (_draftTimer) { clearInterval(_draftTimer); _draftTimer = null; }
    _undoStack.length = 0;
    _isDirty = false;
    _isSaving = false;

    container.innerHTML = UI.moduleContainer(UI.loadingState('Cargando asignaciones...'));
    const role = App.currentUser?.role;
    const isAdmin = role === 'admin';

    try {
      // Para maestros, getMyAssignments hace una query con where('teacherId','==', myId)
      // que respeta las firestore.rules. Para admin, retorna todas.
      _capAssignments = await Store.getMyAssignments();
      if (!isAdmin && _capAssignments.length === 0) {
        // Verificar si el problema es falta de vínculo o que no tiene asignaciones
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) {
          container.innerHTML = UI.moduleContainer(UI.emptyState('person_off', 'Tu cuenta no está vinculada a un registro de docente. Contacta al administrador.'));
          return;
        }
      }

      // If teacher has only 1 assignment, open editor directly
      if (!isAdmin && _capAssignments.length === 1) {
        const a = _capAssignments[0];
        assignments = _capAssignments;
        api.openGradeEditor(a.id, a.groupId, a.subjectId);
        return;
      }

      if (_capAssignments.length === 0) {
        container.innerHTML = UI.moduleContainer(UI.emptyState('assignment', 'No hay asignaciones disponibles'));
        return;
      }

      if (!isAdmin) await _loadAssignmentStatuses(currentPartial);

      const title = isAdmin ? 'Captura de Calificaciones' : 'Mis Asignaciones';
      const subtitle = 'Selecciona turno, grado, grupo y materia para abrir el editor';

      // Extract turno options from available assignments
      const turnos = [...new Set(_capAssignments.map(a => a.turno).filter(Boolean))].sort();
      const turnoOptions = turnos.map(t => `<option value="${t}">${t}</option>`).join('');

      container.innerHTML = UI.moduleContainer(`
        ${UI.pageHeader(title, subtitle)}
        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="cap-turno">Turno</label>
              <select id="cap-turno">
                <option value="">Selecciona turno</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="cap-grado">Grado</label>
              <select id="cap-grado" disabled>
                <option value="">Selecciona grado</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cap-grupo">Grupo</label>
              <select id="cap-grupo" disabled>
                <option value="">Selecciona grupo</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cap-materia">Materia</label>
              <select id="cap-materia" disabled>
                <option value="">Selecciona materia</option>
              </select>
            </div>
          </div>
        </div>
        <div id="cap-preview"></div>
        ${!isAdmin ? _renderBulkPrintPanel() : ''}
      `);

      assignments = _capAssignments;
      _delegateClick(container);
      _bindCascadeFilters();

      // Auto-select turno if only one
      if (turnos.length === 1) {
        document.getElementById('cap-turno').value = turnos[0];
        document.getElementById('cap-turno').dispatchEvent(new Event('change'));
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
      Toast.show('Error al cargar asignaciones', 'error');
    }
  }

  function _bindCascadeFilters() {
    const turnoEl = document.getElementById('cap-turno');
    const gradoEl = document.getElementById('cap-grado');
    const grupoEl = document.getElementById('cap-grupo');
    const materiaEl = document.getElementById('cap-materia');

    turnoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      // Reset downstream
      grupoEl.innerHTML = '<option value="">Selecciona grupo</option>';
      grupoEl.disabled = true;
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
      materiaEl.disabled = true;
      _updateCapPreview(null);

      if (!turno) {
        gradoEl.innerHTML = '<option value="">Selecciona grado</option>';
        gradoEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.turno === turno);
      // Coerce a Number antes de Set para que un dato sucio mixto (string "3" + integer 3)
      // no produzca dos opciones "3" en el dropdown.
      const grados = [...new Set(filtered.map(a => Number(a.grado)).filter(g => Number.isFinite(g) && g > 0))].sort((a, b) => a - b);
      gradoEl.innerHTML = '<option value="">Selecciona grado</option>' +
        grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');
      gradoEl.disabled = false;
      // Auto-select if only one
      if (grados.length === 1) { gradoEl.value = grados[0]; gradoEl.dispatchEvent(new Event('change')); }
    });

    gradoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      const grado = gradoEl.value;
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
      materiaEl.disabled = true;
      _updateCapPreview(null);

      if (!grado) {
        grupoEl.innerHTML = '<option value="">Selecciona grupo</option>';
        grupoEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.turno === turno && String(a.grado) === String(grado));
      const grupos = [...new Map(filtered.map(a => [a.groupId, a.groupName || a.groupId])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]));
      grupoEl.innerHTML = '<option value="">Selecciona grupo</option>' +
        grupos.map(([id, name]) => `<option value="${id}">${Utils.sanitize(name)}</option>`).join('');
      grupoEl.disabled = false;
      if (grupos.length === 1) { grupoEl.value = grupos[0][0]; grupoEl.dispatchEvent(new Event('change')); }
    });

    grupoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      const grado = gradoEl.value;
      const groupId = grupoEl.value;
      _updateCapPreview(null);

      if (!groupId) {
        materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
        materiaEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.groupId === groupId);
      filtered.sort((a, b) => (a.subjectName || '').localeCompare(b.subjectName || ''));
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>' +
        filtered.map(a => `<option value="${a.subjectId}">${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId))}</option>`).join('');
      materiaEl.disabled = false;
      if (filtered.length === 1) { materiaEl.value = filtered[0].subjectId; materiaEl.dispatchEvent(new Event('change')); }
    });

    materiaEl.addEventListener('change', () => {
      const groupId = grupoEl.value;
      const subjectId = materiaEl.value;
      if (!subjectId) { _updateCapPreview(null); return; }
      const asg = _capAssignments.find(a => a.groupId === groupId && a.subjectId === subjectId);
      _updateCapPreview(asg);
    });
  }

  function _updateCapPreview(asg) {
    const preview = document.getElementById('cap-preview');
    if (!preview) return;

    if (!asg) {
      preview.innerHTML = `
        <div class="empty-state" style="margin-top:24px;">
          <span class="material-icons-round empty-state-icon">edit_note</span>
          <p class="empty-state-text">Selecciona turno, grado, grupo y materia para abrir el editor de calificaciones</p>
        </div>`;
      return;
    }

    const turnoClass = (asg.turno || '').toUpperCase() === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';
    preview.innerHTML = `
      <div class="card" style="margin-top:16px;border-left:4px solid var(--color-primary);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="font-semibold" style="font-size:var(--font-size-lg);">${Utils.sanitize(K.getUACNombre(asg.subjectName || asg.subjectId))}</div>
            <div class="text-muted" style="margin-top:4px;">
              <span class="badge ${turnoClass}" style="margin-right:4px;">${Utils.sanitize(asg.turno || '')}</span>
              <span class="badge">Grupo ${Utils.sanitize(asg.groupName || asg.groupId)}</span>
              <span class="badge" style="background:rgba(0,0,0,0.06);margin-left:4px;">${Utils.sanitize(Utils.displayName(asg.teacherName || ''))}</span>
            </div>
          </div>
          <button class="btn btn-primary" data-action="open-editor" data-assignment-id="${asg.id}" data-group-id="${asg.groupId}" data-subject-id="${asg.subjectId}">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">edit</span>
            Abrir editor
          </button>
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // TEACHER — GRADE EDITOR con rubros
  // ═══════════════════════════════════════════════════════════════

  async function openGradeEditor(assignmentId, groupId, subjectId) {
    selectedGroup = groupId;
    selectedSubject = subjectId;

    try {
      // Para maestros, getStudents() global es rechazado por reglas. Usar query
      // filtrada por groupId (que sí está permitida porque el maestro tiene
      // assignment de ese grupo). Para admin/orientador/directivo, usar global.
      const role = App.currentUser?.role;
      const fetchStudents = (role === 'admin' || role === 'orientador' || role === 'directivo')
        ? Store.getStudents()
        : Store.getStudentsByGroup(groupId);

      const [allStudents, partials, allGroups, groupGrades] = await Promise.all([
        fetchStudents,
        Store.getPartials(),
        Store.getGroups(),
        Store.getGradesByGroup(groupId, true)
      ]);

      students = allStudents
        .filter(s => s.groupId === groupId)
        .map(s => ({ docId: s.id, ...s }))
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      // Detect turno from group
      const groupDoc = allGroups.find(g => g.id === groupId);
      if (groupDoc) {
        currentTurno = groupDoc.turno || 'MATUTINO';
      } else if (students.length > 0) {
        currentTurno = students[0].turno || 'MATUTINO';
      }

      // Set initial partial to first open one
      const sorted = K.PARCIALES.map(kp => {
        const doc = partials.find(p => p.id === kp.id);
        return { id: kp.id, locked: doc ? (doc.locked || false) : false };
      });
      const open = sorted.find(p => !p.locked);
      currentPartial = open ? open.id : 'P1';

      // Filter grades to this subject only (already cached per-group)
      grades = {};
      groupGrades.filter(g => g.subjectId === subjectId).forEach(g => {
        const key = `${g.studentId}_${g.subjectId}_${g.partial}`;
        grades[key] = g;
      });

      // Pre-cargar estado de TODAS las asignaciones del maestro para las pestañas
      // (no bloquea — usa cache si ya está cargado para este parcial).
      _loadAssignmentStatuses(currentPartial).catch(() => {});

      _renderGradeEditor(partials);
    } catch (error) {
      console.error('Error opening grade editor:', error);
      Toast.show('Error al abrir editor de calificaciones', 'error');
    }
  }

  // ─── INPUT MODE STATE ───
  let _inputMode = 'manual'; // 'manual' or 'paste'
  let _pasteTargetField = null;

  // ─── DIRTY STATE (unsaved changes tracking) ───
  let _isDirty = false;
  let _isSaving = false;
  let _draftKey = ''; // localStorage key for auto-recovery

  function _markDirty() {
    if (_isDirty) return;
    _isDirty = true;
    const indicator = document.getElementById('unsaved-indicator');
    if (indicator) indicator.style.display = '';
    const saveBtn = document.querySelector('[data-action="save-grades"]');
    if (saveBtn) saveBtn.classList.add('btn-pulse');
  }

  function _markClean() {
    _isDirty = false;
    const indicator = document.getElementById('unsaved-indicator');
    if (indicator) indicator.style.display = 'none';
    const saveBtn = document.querySelector('[data-action="save-grades"]');
    if (saveBtn) saveBtn.classList.remove('btn-pulse');
    // Clear draft from localStorage
    if (_draftKey) { try { localStorage.removeItem(_draftKey); } catch(e){} }
  }

  // ─── AUTO-RECOVERY DRAFT (save to localStorage periodically) ───
  let _draftTimer = null;

  function _saveDraft() {
    if (!_isDirty || !_draftKey) return;
    try {
      const snapshot = _captureSnapshot('draft');
      localStorage.setItem(_draftKey, JSON.stringify({ time: Date.now(), values: snapshot.values }));
    } catch(e) { /* localStorage may be full or disabled */ }
  }

  function _checkDraftRecovery() {
    if (!_draftKey) return;
    try {
      const raw = localStorage.getItem(_draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Only offer recovery if draft is less than 24h old
      if (Date.now() - draft.time > 86400000) {
        localStorage.removeItem(_draftKey);
        return;
      }
      // Check if draft has any values different from current
      let hasDiffs = false;
      const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
      rows.forEach(row => {
        const sid = row.dataset.studentId;
        const vals = draft.values[sid];
        if (!vals) return;
        row.querySelectorAll('.ge-input').forEach(input => {
          const field = input.dataset.field;
          if (vals[field] !== undefined && vals[field] !== input.value) hasDiffs = true;
        });
      });
      if (!hasDiffs) { localStorage.removeItem(_draftKey); return; }

      // Show recovery banner
      const banner = document.createElement('div');
      banner.className = 'draft-recovery-banner';
      banner.innerHTML = `
        <span class="material-icons-round" style="font-size:20px;color:#d69e2e;">warning</span>
        <span>Se encontraron datos sin guardar de una sesión anterior.</span>
        <button class="btn btn-sm btn-primary" id="recover-draft-btn">Recuperar</button>
        <button class="btn btn-sm btn-outline" id="discard-draft-btn">Descartar</button>`;
      const editor = document.querySelector('.grade-editor-table');
      if (editor) editor.parentNode.insertBefore(banner, editor);

      document.getElementById('recover-draft-btn')?.addEventListener('click', () => {
        _pushUndo('Antes de recuperar borrador');
        rows.forEach(row => {
          const sid = row.dataset.studentId;
          const vals = draft.values[sid];
          if (!vals) return;
          row.querySelectorAll('.ge-input').forEach(input => {
            const field = input.dataset.field;
            if (vals[field] !== undefined) input.value = vals[field];
          });
          const firstRubro = row.querySelector('.grade-rubro');
          if (firstRubro) _recalcRow(firstRubro);
        });
        _updateStats();
        _markDirty();
        banner.remove();
        Toast.show('Datos recuperados. Recuerda guardar.', 'success');
      });

      document.getElementById('discard-draft-btn')?.addEventListener('click', () => {
        localStorage.removeItem(_draftKey);
        banner.remove();
      });
    } catch(e) { /* ignore parse errors */ }
  }

  // ─── BEFOREUNLOAD GUARD ───
  function _beforeUnloadGuard(e) {
    if (_isDirty) {
      e.preventDefault();
      e.returnValue = 'Tienes cambios sin guardar. ¿Deseas salir?';
      return e.returnValue;
    }
  }

  // ─── UNDO SYSTEM ───
  const _undoStack = [];
  const UNDO_MAX = 30;

  /** Capture a snapshot of all current input values */
  function _captureSnapshot(label) {
    const snapshot = { label, time: Date.now(), values: {} };
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const sid = row.dataset.studentId;
      snapshot.values[sid] = {};
      row.querySelectorAll('.ge-input').forEach(input => {
        snapshot.values[sid][input.dataset.field] = input.value;
      });
    });
    return snapshot;
  }

  /** Push current state to undo stack (call BEFORE making changes) */
  function _pushUndo(label) {
    _undoStack.push(_captureSnapshot(label));
    if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    _updateUndoBtn();
  }

  /** Restore last snapshot */
  function _popUndo() {
    if (_undoStack.length === 0) return;
    const snapshot = _undoStack.pop();
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const sid = row.dataset.studentId;
      const vals = snapshot.values[sid];
      if (!vals) return;
      row.querySelectorAll('.ge-input').forEach(input => {
        const field = input.dataset.field;
        if (vals[field] !== undefined) input.value = vals[field];
      });
      // Recalc row
      const firstRubro = row.querySelector('.grade-rubro');
      if (firstRubro) _recalcRow(firstRubro);
    });
    if (snapshot.label === 'Antes de dejar lista en blanco') {
      _listCleared = false;
      _hideClearPendingNotice();
    }
    _updateStats();
    _updateUndoBtn();
    Toast.show(`Deshecho: ${snapshot.label}`, 'info');
  }

  function _getCurrentListLabel() {
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    const partial = K.PARCIALES.find(p => p.id === currentPartial);
    return {
      subjectName: asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject,
      groupName: asg ? (asg.groupName || asg.groupId) : selectedGroup,
      partialName: partial ? partial.nombre : currentPartial
    };
  }

  function _confirmClearCurrentList() {
    const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
    if (rows.length === 0) return;

    const list = _getCurrentListLabel();
    const message = `
      <div class="clear-list-confirm">
        <p>Esta accion prepara la lista para guardarse en blanco.</p>
        <dl>
          <div><dt>Grupo</dt><dd>${Utils.sanitize(list.groupName)}</dd></div>
          <div><dt>Materia</dt><dd>${Utils.sanitize(list.subjectName)}</dd></div>
          <div><dt>Parcial</dt><dd>${Utils.sanitize(list.partialName)}</dd></div>
        </dl>
        <ul>
          <li>Quita calificaciones, suma, calificación final y faltas de esta lista.</li>
          <li>No borra alumnos ni horas impartidas.</li>
          <li>No necesitas capturar horas impartidas para guardar una lista en blanco.</li>
          <li>Después de confirmar todavia debes presionar Guardar Calificaciones.</li>
        </ul>
      </div>`;

    Modal.confirmTyped('Dejar lista en blanco', message, 'BLANCO', _clearCurrentList);
  }

  function _showClearPendingNotice() {
    if (document.getElementById('clear-list-pending-notice')) return;
    const table = document.querySelector('.table-container');
    if (!table) return;
    const notice = document.createElement('div');
    notice.id = 'clear-list-pending-notice';
    notice.className = 'clear-list-pending-notice';
    notice.innerHTML = `
      <span class="material-icons-round">warning</span>
      <div>
        <strong>Lista preparada en blanco.</strong>
        <p>Revisa la tabla y presiona Guardar Calificaciones para aplicar el cambio.</p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="save-grades">
        <span class="material-icons-round">save</span>
        Guardar ahora
      </button>`;
    table.parentNode.insertBefore(notice, table);
  }

  function _hideClearPendingNotice() {
    document.getElementById('clear-list-pending-notice')?.remove();
  }

  function _clearCurrentList() {
    const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
    if (rows.length === 0) return;

    _pushUndo('Antes de dejar lista en blanco');
    rows.forEach(row => {
      row.querySelectorAll('.grade-rubro, .grade-faltas').forEach(input => {
        input.value = '';
        input.classList.remove('ge-input-invalid', 'paste-applied', 'paste-invalid');
      });
      const sumaCell = row.querySelector('.col-suma');
      const calCell = row.querySelector('.col-cal');
      if (sumaCell) sumaCell.textContent = '';
      if (calCell) {
        calCell.textContent = '';
        calCell.className = 'cell-cal col-cal';
      }
      row.classList.remove('row-reprobado');
    });

    _listCleared = true;
    _markDirty();
    _updateStats();
    _showClearPendingNotice();
    Toast.show('Lista preparada en blanco. Guarda para aplicar el cambio.', 'warning', 6000);
  }

  function _updateUndoBtn() {
    const btn = document.getElementById('undo-btn');
    if (!btn) return;
    btn.disabled = _undoStack.length === 0;
    const last = _undoStack[_undoStack.length - 1];
    btn.title = last ? `Deshacer: ${last.label}` : 'Nada que deshacer';
    const countEl = document.getElementById('undo-count');
    if (countEl) countEl.textContent = _undoStack.length > 0 ? _undoStack.length : '';
  }

  function _renderGradeEditor(partials) {
    const container = _container();
    const rubros = K.getRubros(currentTurno);

    // Partial buttons
    const partialsHtml = K.PARCIALES.map(kp => {
      const doc = partials.find(p => p.id === kp.id);
      const locked = doc ? (doc.locked || false) : false;
      const cls = currentPartial === kp.id ? 'btn-primary' : 'btn-outline';
      return `<button class="btn btn-sm ${cls}" data-action="switch-partial" data-partial="${kp.id}">${kp.nombre}${locked ? ' \uD83D\uDD12' : ''}</button>`;
    }).join(' ');

    // Gender count
    const hCount = students.filter(s => s.sexo === 'H').length;
    const mCount = students.filter(s => s.sexo === 'M').length;

    // Header columns for rubros
    const headerCols = rubros.map(r =>
      `<th class="col-rubro" data-field="${r.key}">${r.abbr}<br><span style="font-weight:400;font-size:9px;opacity:0.8;">m\u00e1x ${r.max}</span></th>`
    ).join('');

    // Build rows
    let rowsHtml = '';
    students.forEach((s, i) => {
      const key = `${s.docId}_${selectedSubject}_${currentPartial}`;
      const gradeData = grades[key] || {};

      const inputCells = rubros.map(r => {
        const val = gradeData[r.key] !== undefined ? gradeData[r.key] : '';
        return `<td class="cell-rubro" data-field="${r.key}">
          <input type="number" min="0" max="${r.max}" step="${r.step}" value="${val}" placeholder="-"
            class="ge-input grade-rubro" data-student-id="${s.docId}" data-field="${r.key}">
        </td>`;
      }).join('');

      const suma = _calcRowSuma(gradeData, rubros);
      const storedCal = gradeData.cal !== undefined ? gradeData.cal : (gradeData.value !== undefined ? gradeData.value : null);
      // Has saved data? (any rubro, cal, or value exists in Firestore)
      const hasStoredData = storedCal !== null || rubros.some(r => gradeData[r.key] !== undefined);
      const sumaDisplay = hasStoredData ? suma.toFixed(1) : '';
      const cal = hasStoredData ? (K.calcCal(suma) || storedCal || 5) : '';
      const calClass = cal !== '' && cal < 6 ? 'cal-fail' : (cal !== '' ? 'cal-pass' : '');
      const rowClass = cal !== '' && Number(cal) < 6 ? ' row-reprobado' : '';
      const faltas = gradeData.faltas !== undefined ? gradeData.faltas : '';

      rowsHtml += `<tr data-student-id="${s.docId}" class="${rowClass}">
        <td class="cell-num">${i + 1}</td>
        <td class="cell-name" title="${Utils.sanitize(s.nombreCompleto || '')}">${Utils.sanitize(s.nombreCompleto || '')}</td>
        ${inputCells}
        <td class="cell-suma col-suma">${sumaDisplay}</td>
        <td class="cell-cal ${calClass} col-cal">${cal}</td>
        <td class="cell-faltas">
          <input type="number" min="0" max="99" step="1" value="${faltas}" placeholder="-"
            class="ge-input input-faltas grade-faltas" data-student-id="${s.docId}" data-field="faltas">
        </td>
        <td style="text-align:center;padding:2px;">
          <button class="btn-icon" data-action="report-incident" data-student-id="${s.docId}" data-student-name="${Utils.sanitize(s.nombreCompleto || '')}" title="Reportar incidencia" style="color:var(--warning);background:none;border:none;cursor:pointer;padding:2px;">
            <span class="material-icons-round" style="font-size:18px;">flag</span>
          </button>
        </td>
      </tr>`;
    });

    // Find subject name
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    const subjectName = asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject;
    const groupName = asg ? (asg.groupName || asg.groupId) : selectedGroup;

    // Build paste field options
    const pasteFieldOptions = rubros.map(r => `<option value="${r.key}">${r.label} (${r.abbr})</option>`).join('') +
      `<option value="faltas">FALTAS</option>`;

    // Check if current partial is locked (for warning banner)
    const currentPartialDoc = partials.find(p => p.id === currentPartial);
    const isLocked = currentPartialDoc ? (currentPartialDoc.locked || false) : false;
    const lockWarning = isLocked ? `
      <div class="partial-lock-banner">
        <span class="material-icons-round" style="font-size:20px;">lock</span>
        <span>Este parcial está <b>cerrado</b>. No se pueden guardar cambios a menos que tengas acceso especial.</span>
      </div>` : '';

    // Pesta\u00f1as de asignaciones (solo si tiene >1 asignaci\u00f3n)
    const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
    const tabsHtml = currentAsg ? _renderAssignmentTabs(currentAsg.id) : '';

    // Banner de cobertura temporal
    const interimBanner = currentAsg && currentAsg.interim ? `
      <div class="card" style="background:#fffbeb;border-left:6px solid #d97706;padding:14px 18px;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;color:#78350f;margin-bottom:4px;">
          \ud83d\udfe0 Esta lista es una cobertura temporal
        </div>
        <div style="font-size:13px;color:#78350f;line-height:1.4;">
          Est\u00e1s cubriendo esta materia mientras se asigna al docente oficial.
          Todo lo que captures (calificaciones, faltas, horas) <strong>se transferir\u00e1 autom\u00e1ticamente</strong>
          cuando administraci\u00f3n apruebe la transici\u00f3n al docente definitivo.
          ${currentAsg.interimNote ? `<br><em style="opacity:0.85;">Nota: ${Utils.sanitize(currentAsg.interimNote)}</em>` : ''}
        </div>
      </div>` : '';

    container.innerHTML = `
      <div class="module-container">
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 class="module-title">${Utils.sanitize(subjectName)}</h2>
            <p class="module-subtitle">${Utils.sanitize(groupName)} \u00b7 ${Utils.sanitize(currentTurno)} \u00b7 ${hCount}H / ${mCount}M = ${students.length} alumnos</p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="unsaved-indicator" class="unsaved-badge" style="display:none;">
              <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit_note</span> Sin guardar
            </span>
            <button class="btn btn-outline" data-action="back-to-list">\u2190 Volver</button>
          </div>
        </div>

        ${tabsHtml}

        ${interimBanner}

        ${lockWarning}

        <div id="capture-deadline-banner"></div>

        <div id="risk-banner-faltas"></div>

        <div class="card">
          <div class="form-group"><label>Parcial:</label><div class="btn-group">${partialsHtml}</div></div>
        </div>

        <!-- ═══ TIP + UNDO BAR (sin modos, sin paneles confusos) ═══ -->
        <div class="input-mode-bar" style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;flex-wrap:wrap;">
          <span style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#2b6cb0;font-weight:500;">
            <span class="material-icons-round" style="font-size:20px;color:#3182ce;">lightbulb</span>
            <span><strong>Tip:</strong> escribe directo en cada celda, o pega con <kbd style="padding:2px 6px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-family:monospace;font-size:11px;font-weight:700;">Ctrl + V</kbd> desde tu Excel — los valores llenan hacia abajo desde donde haces clic</span>
          </span>
          <div style="margin-left:auto;">
            <button class="btn btn-outline btn-sm" id="undo-btn" disabled title="Nada que deshacer" style="position:relative;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">undo</span>
              Deshacer
              <span id="undo-count" style="position:absolute;top:-6px;right:-6px;background:#e53e3e;color:#fff;font-size:10px;font-weight:700;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;"></span>
            </button>
            <button class="btn btn-outline btn-sm btn-danger-soft" data-action="clear-grades-list" title="Deja en blanco calificaciones y faltas de esta lista. No borra alumnos ni horas.">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">backspace</span>
              Dejar lista en blanco
            </button>
          </div>
        </div>


        <div class="table-container" style="overflow-x:auto;max-height:65vh;">
          <table class="grade-editor-table" style="min-width:750px;">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-name" style="text-align:left;padding-left:12px;">Estudiante</th>
                ${headerCols}
                <th class="col-suma" style="width:60px;">SUMA${typeof HelpTip !== 'undefined' ? HelpTip.html('Suma de Evaluación Continua + Transversal + (Examen Parcial solo vespertino) + Punto Extra. El sistema la calcula automáticamente. Si excede 10, se queda en 10.', { size: 13 }) : ''}</th>
                <th class="col-cal" style="width:55px;">CAL.${typeof HelpTip !== 'undefined' ? HelpTip.html('Calificación final. Si SUMA es ≥6, redondea normal (máx 10). Si SUMA es <6, automáticamente queda en 5. Tú NUNCA escribes esta columna.', { size: 13 }) : ''}</th>
                <th class="col-faltas" style="width:58px;">FALTAS${typeof HelpTip !== 'undefined' ? HelpTip.html('Total de faltas del alumno en el parcial. Si supera el 20% de las horas impartidas, el alumno pierde derecho a calificación ordinaria (extraordinario).', { size: 13 }) : ''}</th>
                <th style="width:32px;background:#4a5568;" title="Reportar incidencia"></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="stats-grid" style="margin-top:16px;">
          <div class="stat-card--compact"><div class="stat-label">Promedio</div><div class="stat-number" id="stat-promedio">-</div></div>
          <div class="stat-card--compact stat-card--success"><div class="stat-label">Aprobados (\u2265${K.THRESHOLDS.PASS_GRADE})</div><div class="stat-number" id="stat-aprobados">-</div></div>
          <div class="stat-card--compact stat-card--danger"><div class="stat-label">Reprobados (&lt;${K.THRESHOLDS.PASS_GRADE})</div><div class="stat-number" id="stat-reprobados">-</div></div>
          <div class="stat-card--compact"><div class="stat-label">Sin calificaci\u00f3n</div><div class="stat-number" id="stat-sin-calif">-</div></div>
        </div>

        <div class="card horas-card">
          <div class="horas-card-header">
            <h3>Horas impartidas</h3>
            <span>Obligatorio antes de guardar</span>
          </div>
          <div class="horas-grid">
            ${['Febrero','Marzo','Abril','Mayo','Junio','Julio'].map(m =>
              `<div class="horas-month">
                <label>${m}</label>
                <input type="number" min="0" max="99" step="1" id="horas-${m.toLowerCase()}"
                  class="ge-input horas-input" data-month="${m.toLowerCase()}">
              </div>`
            ).join('')}
            <div class="horas-total-box">
              <label>Total</label>
              <div id="horas-total">0</div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap;">
          <button class="btn btn-primary" data-action="save-grades" style="font-size:15px;padding:10px 28px;">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">save</span>Guardar Calificaciones
          </button>
          <button class="btn btn-outline" data-action="print-grades">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir
          </button>
          <button class="btn btn-outline" data-action="back-to-list">Cancelar</button>
        </div>
      </div>`;

    _delegateClick(container);

    // ═══ INITIALIZE EDITOR STATE ═══
    _undoStack.length = 0;
    _isDirty = false;
    _isSaving = false;
    _listCleared = false;
    _draftKey = `grade_draft_${selectedGroup}_${selectedSubject}_${currentPartial}`;

    // ═══ INPUT CLAMPING + UNDO + DIRTY TRACKING (event delegation) ═══
    // Antes: 5 listeners por input × ~300 inputs = ~1500 listeners DOM, lag al teclear.
    // Ahora: 4 listeners en container, independiente del tamano de la tabla.
    let _snapshotPending = false;

    const _isGradeInput = (el) => !!(el && el.classList &&
      (el.classList.contains('grade-rubro') || el.classList.contains('grade-faltas')));

    // focus/blur no burbujean, usamos focusin/focusout
    container.addEventListener('focusin', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      input.select();
      if (!_snapshotPending) {
        _snapshotPending = true;
        input._prevVal = input.value;
      }
    });

    container.addEventListener('focusout', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      if (input.value.trim() === '') { _snapshotPending = false; return; }
      const maxVal = parseFloat(input.max) || 10;
      const isInteger = input.classList.contains('grade-faltas');
      let v = parseFloat(input.value.replace(',', '.'));
      if (isNaN(v)) { input.value = ''; input.classList.remove('ge-input-invalid'); _snapshotPending = false; return; }
      v = Math.max(0, Math.min(v, maxVal));
      v = isInteger ? Math.round(v) : Math.round(v * 10) / 10;
      input.value = v;
      input.classList.remove('ge-input-invalid');
      if (input.classList.contains('grade-rubro')) _recalcRow(input);
      _snapshotPending = false;
    });

    container.addEventListener('input', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      if (_snapshotPending && input.value !== input._prevVal) {
        _pushUndo('Edición manual');
        _snapshotPending = false;
      }
      _markDirty();

      const maxVal = parseFloat(input.max) || 10;
      const raw = input.value.trim();
      if (raw === '') {
        input.classList.remove('ge-input-invalid');
      } else {
        const v = parseFloat(raw.replace(',', '.'));
        if (isNaN(v) || v < 0 || v > maxVal) input.classList.add('ge-input-invalid');
        else input.classList.remove('ge-input-invalid');
      }

      if (input.classList.contains('grade-rubro')) _recalcRow(input);
    });

    container.addEventListener('keydown', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      const isInteger = input.classList.contains('grade-faltas');

      // 1) Bloquear caracteres invalidos
      const navKeys = [8, 46, 9, 27, 13, 37, 38, 39, 40, 35, 36];
      const ctrlComboKeys = [65, 67, 86, 88, 90]; // Ctrl+A/C/V/X/Z
      const isNav = navKeys.includes(e.keyCode);
      const isCtrlCombo = (e.ctrlKey || e.metaKey) && ctrlComboKeys.includes(e.keyCode);
      const isDecimal = !isInteger && (e.key === '.' || e.key === ',');
      const isDigit = e.key >= '0' && e.key <= '9';
      if (!isNav && !isCtrlCombo && !isDecimal && !isDigit) {
        e.preventDefault();
        return;
      }

      // 2) Smart navigation: Enter va a siguiente fila misma columna; al final pasa a primera fila siguiente columna
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = input.closest('tr');
        const field = input.dataset.field;
        const nextRow = row && row.nextElementSibling;
        if (nextRow) {
          const nextInput = nextRow.querySelector(`input[data-field="${field}"]`);
          if (nextInput) { nextInput.focus(); return; }
        }
        const firstRow = input.closest('tbody') && input.closest('tbody').querySelector('tr');
        if (firstRow && row) {
          const allFields = [...row.querySelectorAll('.ge-input')].map(i => i.dataset.field);
          const currentIdx = allFields.indexOf(field);
          if (currentIdx >= 0 && currentIdx < allFields.length - 1) {
            const nextField = allFields[currentIdx + 1];
            const target = firstRow.querySelector(`input[data-field="${nextField}"]`);
            if (target) target.focus();
          }
        }
        return;
      }

      // 3) Arrow up/down: navegacion entre filas misma columna
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const row = input.closest('tr');
        const field = input.dataset.field;
        const targetRow = e.key === 'ArrowUp'
          ? (row && row.previousElementSibling)
          : (row && row.nextElementSibling);
        if (targetRow && targetRow.dataset.studentId) {
          e.preventDefault();
          const targetInput = targetRow.querySelector(`input[data-field="${field}"]`);
          if (targetInput) targetInput.focus();
        }
      }
    });

    // ═══ UNDO ═══
    document.getElementById('undo-btn')?.addEventListener('click', _popUndo);
    document.getElementById('assignment-jump')?.addEventListener('change', (e) => {
      const targetAsg = _orderedAssignments().find(a => a.id === e.target.value);
      if (!targetAsg) return;
      if (!_canLeaveEditor()) {
        const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
        e.target.value = currentAsg?.id || '';
        return;
      }
      if (_isDirty && !confirm('Tienes cambios sin guardar en esta lista. ¿Cambiar de lista sin guardar?')) {
        const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
        e.target.value = currentAsg?.id || '';
        return;
      }
      api.openGradeEditor(targetAsg.id, targetAsg.groupId, targetAsg.subjectId);
    });
    container._undoHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (_undoStack.length > 0) { e.preventDefault(); _popUndo(); }
      }
    };
    document.addEventListener('keydown', container._undoHandler);

    // ═══ BEFOREUNLOAD GUARD ═══
    window.addEventListener('beforeunload', _beforeUnloadGuard);

    // ═══ AUTO-SAVE DRAFT every 30 seconds ═══
    if (_draftTimer) clearInterval(_draftTimer);
    _draftTimer = setInterval(_saveDraft, 30000);

    // ═══ HORAS IMPARTIDAS ═══
    container.querySelectorAll('.horas-input').forEach(input => {
      input.addEventListener('input', () => { _updateHorasTotal(); _markDirty(); _scheduleRiskBannerUpdate(); });
    });
    _loadHoras().then(() => _updateRiskBanner());
    _updateCaptureDeadlineBanner();

    // ═══ FALTAS → actualizar banner de riesgo ═══
    container.querySelectorAll('input.grade-faltas').forEach(input => {
      input.addEventListener('input', _scheduleRiskBannerUpdate);
    });

    _updateStats();
    _updateUndoBtn();
    _bindInputModes(container);

    // ═══ HIGHLIGHT EMPTY CELLS (when coming from monitor) ═══
    if (sessionStorage.getItem('epo67_highlightEmpty') === '1') {
      sessionStorage.removeItem('epo67_highlightEmpty');
      _highlightEmptyCells();
    }

    // ═══ CHECK FOR DRAFT RECOVERY ═══
    setTimeout(_checkDraftRecovery, 500);
  }

  // ─── HIGHLIGHT EMPTY ROWS/CELLS ───
  function _highlightEmptyCells() {
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const calCell = row.querySelector('.col-cal');
      const hasCal = calCell && calCell.textContent.trim() !== '';
      if (hasCal) return; // Row already has a grade, skip

      // Mark entire row with a distinct background
      row.style.background = 'rgba(128,90,213,0.08)';
      row.style.borderLeft = '3px solid #805ad5';

      row.querySelectorAll('.ge-input.grade-rubro').forEach(input => {
        if (input.value.trim() === '') {
          input.style.background = 'rgba(128,90,213,0.15)';
          input.style.borderColor = '#805ad5';
        }
      });

      // Watch all rubros in this row — when ALL have values, clear row highlight
      const checkRowComplete = () => {
        const allFilled = [...row.querySelectorAll('.ge-input.grade-rubro')].every(inp => inp.value.trim() !== '');
        if (allFilled) {
          row.style.background = '';
          row.style.borderLeft = '';
          row.querySelectorAll('.ge-input.grade-rubro').forEach(inp => {
            inp.style.background = '';
            inp.style.borderColor = '';
            inp.removeEventListener('input', checkRowComplete);
          });
        }
      };
      row.querySelectorAll('.ge-input.grade-rubro').forEach(input => {
        input.addEventListener('input', checkRowComplete);
      });
    });
  }

  // ─── PASTE NATIVO TIPO EXCEL ───
  // El maestro hace clic en cualquier celda de la tabla y Ctrl+V.
  // Si pegó una columna: llena hacia abajo desde esa celda.
  // Si pegó un bloque (varias columnas): llena el bloque a partir de la celda.
  // Celdas vacías en el clipboard NO sobrescriben los valores existentes.
  // Valores fuera de rango se marcan en rojo y NO se aplican.
  function _bindInputModes(container) {
    const tableContainer = container.querySelector('.grade-editor-table');
    if (!tableContainer) return;

    tableContainer.addEventListener('paste', _handleTablePaste);
  }

  function _handleTablePaste(e) {
    const targetInput = e.target.closest('input.ge-input');
    if (!targetInput) return;

    const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!clipboardText) return;

    // Parsear: filas separadas por \n, columnas por \t
    let rows = clipboardText.split(/\r?\n/);
    // Quitar filas vacías SOLO al inicio y al final (preservar vacías en medio)
    while (rows.length > 0 && rows[0].trim() === '') rows.shift();
    while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop();
    if (rows.length === 0) return;

    // Si es UN solo valor sin tabs, dejar el paste nativo del input
    if (rows.length === 1 && !rows[0].includes('\t')) return;

    // Multi-valor: tomamos control del paste y distribuimos
    e.preventDefault();

    // Localizar fila/columna inicial
    const startRow = targetInput.closest('tr[data-student-id]');
    if (!startRow) return;
    const allRows = [...document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]')];
    const startRowIdx = allRows.indexOf(startRow);
    if (startRowIdx === -1) return;

    // Orden de columnas editables (campos): rubros + faltas, en orden visual
    const fieldOrder = [...startRow.querySelectorAll('input.ge-input')].map(i => i.dataset.field);
    const startFieldIdx = fieldOrder.indexOf(targetInput.dataset.field);
    if (startFieldIdx === -1) return;

    // Snapshot para Deshacer
    _pushUndo('Pegar (' + rows.length + ' fila' + (rows.length === 1 ? '' : 's') + ')');

    let appliedCount = 0;
    let invalidCount = 0;
    let emptyCount = 0;
    const changedInputs = [];
    const invalidInputs = [];

    for (let i = 0; i < rows.length; i++) {
      const targetRowIdx = startRowIdx + i;
      if (targetRowIdx >= allRows.length) break;
      const targetRow = allRows[targetRowIdx];

      // Una fila del clipboard puede tener múltiples columnas separadas por \t
      const cells = rows[i].split('\t');

      for (let j = 0; j < cells.length; j++) {
        const targetFieldIdx = startFieldIdx + j;
        if (targetFieldIdx >= fieldOrder.length) break;
        const targetField = fieldOrder[targetFieldIdx];
        const cellInput = targetRow.querySelector(`input.ge-input[data-field="${targetField}"]`);
        if (!cellInput) continue;

        const cellRaw = cells[j].trim();

        // CELDA VACÍA: preservar valor existente del alumno (NO sobrescribir)
        if (cellRaw === '') { emptyCount++; continue; }

        // Limpiar y parsear (acepta coma decimal)
        const cleaned = cellRaw.replace(',', '.').replace(/[^0-9.\-]/g, '');
        const isInt = cellInput.classList.contains('grade-faltas');
        const num = isInt ? parseInt(cleaned, 10) : parseFloat(cleaned);
        const max = Number(cellInput.max) || (isInt ? 99 : 10);

        // Inválido: marcar rojo, NO aplicar
        if (isNaN(num) || num < 0 || num > max) {
          cellInput.classList.add('paste-invalid');
          invalidInputs.push(cellInput);
          invalidCount++;
          continue;
        }

        // Aplicar: redondear a 1 decimal (rubros) o entero (faltas)
        const finalVal = isInt ? Math.round(num) : Math.round(num * 10) / 10;
        cellInput.value = finalVal;
        cellInput.classList.add('paste-applied');
        changedInputs.push(cellInput);
        if (cellInput.classList.contains('grade-rubro')) _recalcRow(cellInput);
        appliedCount++;
      }
    }

    _markDirty();
    _updateStats();

    // Quitar highlight tras 5 segundos
    setTimeout(() => {
      changedInputs.forEach(i => i.classList.remove('paste-applied'));
      invalidInputs.forEach(i => i.classList.remove('paste-invalid'));
    }, 5000);

    // Toast informativo
    let msg = `✅ ${appliedCount} valor${appliedCount === 1 ? '' : 'es'} aplicado${appliedCount === 1 ? '' : 's'}`;
    if (emptyCount > 0) msg += ` · ${emptyCount} sin cambio`;
    if (invalidCount > 0) msg += ` · ${invalidCount} en rojo (fuera de rango)`;
    Toast.show(msg, invalidCount > 0 ? 'warning' : 'success');
  }


  // ─── HORAS IMPARTIDAS ───
  async function _loadHoras() {
    try {
      const docId = `${selectedGroup}_${selectedSubject}_${currentPartial}`;
      const doc = await db.collection('teacherHours').doc(docId).get();
      if (doc.exists) {
        const data = doc.data();
        ['febrero','marzo','abril','mayo','junio','julio'].forEach(m => {
          const el = document.getElementById('horas-' + m);
          if (el && data[m] !== undefined) el.value = data[m];
        });
        _updateHorasTotal();
      }
    } catch (e) { console.warn('Error loading horas:', e); }
  }

  function _updateHorasTotal() {
    let total = 0;
    document.querySelectorAll('.horas-input').forEach(input => {
      const v = parseInt(input.value);
      if (!isNaN(v)) total += v;
      input.classList.toggle('has-value', input.value.trim() !== '');
    });
    const el = document.getElementById('horas-total');
    if (el) el.textContent = total;
  }

  async function _saveHorasData(horasData) {
    if (!horasData || Object.keys(horasData).length === 0) return false;
    const horasDocId = `${selectedGroup}_${selectedSubject}_${currentPartial}`;
    await db.collection('teacherHours').doc(horasDocId).set({
      ...horasData,
      groupId: selectedGroup,
      subjectId: selectedSubject,
      partial: currentPartial,
      updatedBy: auth.currentUser.uid,
      updatedAt: new Date()
    }, { merge: true });
    return true;
  }

  function _failureIncidentDocId(studentId) {
    return `${studentId}_${selectedSubject}_${currentPartial}_reprobación`;
  }

  function _getFailingStudentsForIncident(rubros) {
    if (_listCleared) return [];
    const failing = [];

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      const studentId = row.dataset.studentId;
      const key = `${studentId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};
      const sumaData = {};
      let hasData = false;

      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        const raw = input ? input.value.trim() : '';
        const value = raw === '' ? 0 : Math.max(0, Math.min(parseFloat(raw) || 0, r.max));
        sumaData[r.key] = value;
        if (raw !== '' || stored[r.key] !== undefined) hasData = true;
      });

      if (!hasData) return;
      const suma = K.calcSuma(sumaData);
      const cal = K.calcCal(suma);
      if (cal !== '' && Number(cal) < K.THRESHOLDS.PASS_GRADE) {
        failing.push({
          studentId,
          studentName: row.querySelector('.cell-name')?.textContent.trim() || studentId,
          suma,
          cal
        });
      }
    });

    return failing;
  }

  async function _getMissingFailureIncidents(failingStudents) {
    if (failingStudents.length === 0) return [];
    const refs = failingStudents.map(s => db.collection('incidents').doc(_failureIncidentDocId(s.studentId)));
    const snaps = await Promise.all(refs.map(ref => ref.get()));
    return failingStudents.filter((student, index) => !snaps[index].exists);
  }

  function _buildFailureDescription(reason, detail) {
    const cleanReason = (reason || '').trim();
    const cleanDetail = (detail || '').trim();
    return cleanDetail ? `${cleanReason}. ${cleanDetail}` : cleanReason;
  }

  function _collectFailureIncidentReasons(missingStudents) {
    if (missingStudents.length === 0) return Promise.resolve([]);

    return new Promise(resolve => {
      const rowsHtml = missingStudents.map((s, index) => `
        <div class="failure-reason-row" data-index="${index}">
          <div class="failure-reason-student">
            <strong>${Utils.sanitize(s.studentName)}</strong>
            <span>Calificación: ${Utils.sanitize(String(s.cal))}</span>
          </div>
          <select class="failure-reason-select" data-index="${index}">
            <option value="">Selecciona motivo</option>
            <option value="No entrego evidencias suficientes">No entrego evidencias suficientes</option>
            <option value="Evaluación parcial insuficiente">Evaluación parcial insuficiente</option>
            <option value="Trabajos incompletos">Trabajos incompletos</option>
            <option value="Inasistencias afectaron su desempeno">Inasistencias afectaron su desempeno</option>
            <option value="No acredito los aprendizajes esperados">No acredito los aprendizajes esperados</option>
            <option value="Otro">Otro</option>
          </select>
          <textarea class="failure-reason-detail" data-index="${index}" rows="2"
            placeholder="Detalle breve opcional. Si eliges Otro, escribe el motivo."></textarea>
        </div>`).join('');

      const body = `
        <div class="failure-reason-modal">
          <p>Antes de guardar, registra el motivo de reprobación de cada alumno.</p>
          <div class="failure-reason-tools">
            <select id="failure-reason-bulk">
              <option value="">Motivo rapido para todos</option>
              <option value="No entrego evidencias suficientes">No entrego evidencias suficientes</option>
              <option value="Evaluación parcial insuficiente">Evaluación parcial insuficiente</option>
              <option value="Trabajos incompletos">Trabajos incompletos</option>
              <option value="Inasistencias afectaron su desempeno">Inasistencias afectaron su desempeno</option>
              <option value="No acredito los aprendizajes esperados">No acredito los aprendizajes esperados</option>
            </select>
            <button class="btn btn-outline btn-sm" id="failure-reason-apply">Aplicar</button>
          </div>
          <div class="failure-reason-list">${rowsHtml}</div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" id="failure-reason-cancel">Cancelar</button>
        <button class="btn btn-primary" id="failure-reason-save">
          <span class="material-icons-round">save</span>
          Registrar motivos y guardar
        </button>`;

      Modal.open('Motivo de reprobación obligatorio', body, footer);

      setTimeout(() => {
        const cancelBtn = document.getElementById('failure-reason-cancel');
        const saveBtn = document.getElementById('failure-reason-save');
        const applyBtn = document.getElementById('failure-reason-apply');
        const bulkSelect = document.getElementById('failure-reason-bulk');

        cancelBtn?.addEventListener('click', () => {
          Modal.close();
          resolve(null);
        });

        applyBtn?.addEventListener('click', () => {
          const value = bulkSelect?.value || '';
          if (!value) {
            Toast.show('Selecciona un motivo rapido primero', 'warning');
            return;
          }
          document.querySelectorAll('.failure-reason-select').forEach(select => { select.value = value; });
        });

        saveBtn?.addEventListener('click', () => {
          const reports = [];
          let missing = 0;

          missingStudents.forEach((student, index) => {
            const select = document.querySelector(`.failure-reason-select[data-index="${index}"]`);
            const detail = document.querySelector(`.failure-reason-detail[data-index="${index}"]`);
            const reason = select?.value || '';
            const detailText = detail?.value.trim() || '';
            const requiresDetail = reason === 'Otro';
            const invalid = !reason || (requiresDetail && detailText.length < 5);

            select?.classList.toggle('ge-input-invalid', !reason);
            detail?.classList.toggle('ge-input-invalid', requiresDetail && detailText.length < 5);

            if (invalid) {
              missing++;
              return;
            }

            reports.push({
              ...student,
              reason: _buildFailureDescription(reason, detailText)
            });
          });

          if (missing > 0) {
            Toast.show('Completa el motivo de todos los alumnos reprobados', 'warning');
            return;
          }

          Modal.close();
          resolve(reports);
        });
      }, 100);
    });
  }

  async function _collectRequiredFailureIncidents(rubros) {
    if (!_isTeacherCaptureRole() || _listCleared) return [];
    const failingStudents = _getFailingStudentsForIncident(rubros);
    const missingStudents = await _getMissingFailureIncidents(failingStudents);
    return _collectFailureIncidentReasons(missingStudents);
  }

  // ─── INCIDENT REPORTING FROM GRADE EDITOR ───
  function _showIncidentModal(studentId, studentName) {
    const body = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:600; color:var(--text);">Alumno: ${Utils.sanitize(studentName)}</div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Tipo de incidencia</label>
        <select id="inc-type" style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px;">
          <option value="conducta">Conducta</option>
          <option value="academica">Académica</option>
          <option value="asistencia">Asistencia</option>
          <option value="otra">Otra</option>
        </select>
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Título</label>
        <input id="inc-title" placeholder="Breve descripción" style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Descripción</label>
        <textarea id="inc-desc" rows="3" placeholder="Detalle de la incidencia..."
                  style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px; resize:vertical;"></textarea>
      </div>
    </div>`;

    const footer = `
      <button class="btn" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-primary" id="inc-save-btn">Reportar</button>
    `;

    Modal.open('Reportar Incidencia', body, footer);

    setTimeout(() => {
      const saveBtn = document.getElementById('inc-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const title = document.getElementById('inc-title').value.trim();
          if (!title) { Toast.show('Escribe un título', 'warning'); return; }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Guardando...';

          try {
            await db.collection('incidents').add({
              studentId: studentId,
              groupId: selectedGroup,
              turno: currentTurno,
              type: document.getElementById('inc-type').value,
              title: title,
              description: document.getElementById('inc-desc').value.trim(),
              date: new Date(),
              reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
              reportedByUid: auth.currentUser.uid,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            Modal.close();
            Toast.show('Incidencia reportada', 'success');
          } catch (err) {
            console.error('Error saving incident:', err);
            Toast.show('Error al reportar: ' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Reportar';
          }
        });
      }
    }, 100);
  }

  function _getHorasData() {
    const data = {};
    ['febrero','marzo','abril','mayo','junio','julio'].forEach(m => {
      const el = document.getElementById('horas-' + m);
      if (el && el.value.trim() !== '') data[m] = parseInt(el.value);
    });
    return data;
  }

  function _isTeacherCaptureRole() {
    return App.currentUser?.role === 'maestro' || App.currentUser?.role === 'orientador_docente';
  }

  function _hasRequiredHoras() {
    const horasInputs = document.querySelectorAll('.horas-input');
    return [...horasInputs].some(input => {
      const v = parseInt(input.value, 10);
      return !isNaN(v) && v > 0;
    });
  }

  function _showHorasRequiredReminder() {
    const horasSection = document.querySelector('#horas-total')?.closest('.card');
    if (horasSection) {
      horasSection.classList.add('horas-required');
      // Mantener resaltado MÁS tiempo para que el maestro lo vea bien
      setTimeout(() => horasSection.classList.remove('horas-required'), 30000);
    }

    // Mensaje súper claro con instrucciones paso a paso
    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#fee2e2;border-left:5px solid #dc2626;padding:14px 18px;border-radius:8px;">
          <h3 style="margin:0 0 8px;color:#991b1b;font-size:17px;">⚠ Tus calificaciones NO se guardaron todavía</h3>
          <p style="margin:0;color:#991b1b;font-size:14px;">
            El sistema necesita que <strong>primero captures las HORAS IMPARTIDAS</strong> de este parcial antes de guardar las calificaciones. Es obligatorio para calcular el % de faltas (regla del 20%).
          </p>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;border-radius:6px;font-size:14px;">
          <strong style="color:#78350f;">📋 Qué hacer (toma 30 segundos):</strong>
          <ol style="margin:8px 0 0 20px;color:#78350f;line-height:1.7;">
            <li>Cierra este mensaje (botón <strong>"Entendido"</strong> abajo).</li>
            <li>Vas a ver una sección <strong style="background:#fff;padding:1px 6px;border-radius:3px;color:#d97706;">📅 HORAS IMPARTIDAS</strong> debajo de la tabla de alumnos (resaltada en naranja).</li>
            <li>Escribe cuántas clases diste en <strong>P${(typeof currentPartial === 'string' ? currentPartial.replace('P','') : '?')}</strong>. Por ejemplo: <code style="background:#fff;padding:1px 6px;border-radius:3px;">24</code></li>
            <li><strong>Vuelve a presionar el botón "Guardar"</strong> arriba.</li>
            <li>Ahora SÍ se van a guardar tus calificaciones + las horas en bloque.</li>
          </ol>
        </div>

        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;font-size:13px;color:#166534;">
          💡 <strong>Tus calificaciones NO se perdieron.</strong> Siguen escritas en la pantalla.
          Solo necesitas registrar las horas y volver a guardar — todas se guardan al mismo tiempo.
        </div>
      </div>`;
    const footerHtml = `<button class="btn btn-primary" id="horas-reminder-ok" style="background:#dc2626;border-color:#dc2626;font-weight:700;padding:10px 22px;">Entendido, voy a capturar las horas</button>`;

    if (typeof Modal !== 'undefined' && Modal.open) {
      Modal.open('⚠ NO se guardaron — falta capturar las horas', bodyHtml, footerHtml);
      document.getElementById('horas-reminder-ok')?.addEventListener('click', () => {
        Modal.close();
        // Después de cerrar, hacer scroll a la sección de horas con un delay
        setTimeout(() => {
          if (horasSection) {
            horasSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Foco al primer input de horas
            const firstHorasInput = horasSection.querySelector('.horas-input');
            if (firstHorasInput) firstHorasInput.focus();
          }
        }, 200);
      });
    } else {
      Toast.show('NO se guardó. Captura las horas impartidas primero.', 'error');
    }
  }

  function _canLeaveEditor() {
    if (!_isTeacherCaptureRole()) return true;
    if (!_isDirty) return true;
    if (_listCleared) return true;
    if (_hasRequiredHoras()) return true;
    _showHorasRequiredReminder();
    return false;
  }

  /** Auto-recalculate SUMA and CAL for a row when any rubro changes */
  function _recalcRow(input) {
    const row = input.closest('tr');
    const sid = row.dataset.studentId;
    const rubros = K.getRubros(currentTurno);
    const data = {};

    rubros.forEach(r => {
      const el = row.querySelector(`input[data-field="${r.key}"]`);
      const raw = el ? el.value.trim() : '';
      data[r.key] = raw === '' ? 0 : (parseFloat(raw) || 0);
    });

    // Always show suma/cal — vacío = 0, si todo es 0 la cal es 5
    const suma = K.calcSuma(data);
    const cal = K.calcCal(suma);

    const sumaCell = row.querySelector('.col-suma');
    const calCell = row.querySelector('.col-cal');
    if (sumaCell) sumaCell.textContent = suma.toFixed(1);
    if (calCell) {
      calCell.textContent = cal;
      calCell.className = 'cell-cal ' + (cal !== '' && cal < 6 ? 'cal-fail' : (cal !== '' ? 'cal-pass' : '')) + ' col-cal';
    }

    row.classList.toggle('row-reprobado', cal !== '' && cal < 6);

    _updateStats();
  }

  function _calcRowSuma(gradeData, rubros) {
    const data = {};
    rubros.forEach(r => { data[r.key] = gradeData[r.key]; });
    return K.calcSuma(data);
  }

  // Banner con fechas críticas leídas de config/captureWindow (admin las programa)
  let _captureWindowCache = null;
  async function _updateCaptureDeadlineBanner() {
    const root = document.getElementById('capture-deadline-banner');
    if (!root) return;
    try {
      if (!_captureWindowCache) {
        const doc = await db.collection('config').doc('captureWindow').get();
        _captureWindowCache = doc.exists ? doc.data() : {};
      }
      const cfg = _captureWindowCache;
      const fmtDate = (ts) => {
        if (!ts) return null;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      };
      const fmtJustDate = (ts) => {
        if (!ts) return null;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      };
      const closesStr = fmtDate(cfg.closesAt);
      const deliveryStr = fmtJustDate(cfg.deliveryDate);
      const corrStartStr = fmtJustDate(cfg.correctionsStart);
      const corrEndStr = fmtJustDate(cfg.correctionsEnd);

      // Si no hay nada configurado, mostrar banner genérico de recordatorio
      if (!closesStr && !deliveryStr) {
        root.innerHTML = `
          <div class="card" style="background:#eff6ff;border-left:5px solid #3182ce;margin-bottom:12px;">
            <div style="display:flex;gap:12px;align-items:flex-start;">
              <span class="material-icons-round" style="color:#3182ce;font-size:28px;">info</span>
              <div style="flex:1;">
                <strong style="font-size:14px;color:#1e40af;">Recordatorio importante</strong>
                <ul style="margin:6px 0 0 18px;padding:0;font-size:13px;color:#1e293b;">
                  <li><strong>Imprime tus listas</strong> al terminar la captura para recolectar las firmas de los alumnos y entregarlas en Dirección antes de la fecha límite.</li>
                  <li>Los <strong>cambios de calificación</strong> solo pueden solicitarse durante los <strong>2 días hábiles</strong> posteriores al cierre de captura.</li>
                </ul>
              </div>
            </div>
          </div>`;
        return;
      }

      const items = [];
      if (closesStr) items.push(`<li>📅 <strong>Cierre de captura:</strong> ${closesStr}</li>`);
      if (deliveryStr) items.push(`<li>📋 <strong>Entrega de listas firmadas en Dirección:</strong> ${deliveryStr}</li>`);
      if (corrStartStr && corrEndStr) {
        items.push(`<li>✏️ <strong>Ventana de cambios de calificación:</strong> del ${corrStartStr} al ${corrEndStr} (días hábiles posteriores al cierre)</li>`);
      }

      root.innerHTML = `
        <div class="card" style="background:#fff7ed;border-left:5px solid #d97706;margin-bottom:12px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <span class="material-icons-round" style="color:#d97706;font-size:28px;">event</span>
            <div style="flex:1;">
              <strong style="font-size:14px;color:#92400e;">Fechas importantes — Recuerda:</strong>
              <ul style="margin:6px 0 0 18px;padding:0;font-size:13px;color:#1e293b;">
                ${items.join('')}
              </ul>
              <div style="margin-top:8px;font-size:12px;color:#78350f;font-style:italic;">
                Imprime tus listas para recolectar las firmas de los alumnos y entrégalas en Dirección antes de la fecha límite.
              </div>
            </div>
          </div>
        </div>`;
    } catch (e) {
      console.warn('captureWindow banner:', e.message);
    }
  }

  // Banner de alumnos en riesgo por faltas (solo pantalla, no imprime)
  function _updateRiskBanner() {
    const container = document.getElementById('risk-banner-faltas');
    if (!container) return;

    const totalEl = document.getElementById('horas-total');
    const totalHoras = totalEl ? (parseInt(totalEl.textContent) || 0) : 0;

    if (totalHoras === 0) {
      container.innerHTML = `<div class="risk-banner risk-info">
        <span class="material-icons-round">info</span>
        <div>
          <strong>Captura primero las horas impartidas</strong> de este parcial para que el sistema te avise de alumnos en riesgo de extraordinario por faltas.
        </div>
      </div>`;
      return;
    }

    const RIESGO = 20, ALERTA = 15;
    const danger = [], warning = [];
    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (!faltasInput) return;
      const faltas = parseInt(faltasInput.value);
      if (isNaN(faltas) || faltas <= 0) return;
      const pct = (faltas * 100) / totalHoras;
      if (pct < ALERTA) return;
      const nombre = row.querySelector('.cell-name')?.textContent.trim() || '';
      const item = { nombre, faltas, pct };
      if (pct > RIESGO) danger.push(item);
      else warning.push(item);
    });

    if (danger.length === 0 && warning.length === 0) {
      container.innerHTML = '';
      return;
    }

    const chip = (s, lvl) => `<span class="risk-chip risk-chip-${lvl}">
      <strong>${Utils.sanitize(s.nombre)}</strong>
      <em>${s.faltas} faltas · ${s.pct.toFixed(1)}%</em>
    </span>`;

    const dangerSection = danger.length > 0 ? `
      <div class="risk-section">
        <div class="risk-section-title">
          <span class="material-icons-round" style="color:#b91c1c;font-size:18px;vertical-align:middle;">block</span>
          <strong>${danger.length} en riesgo de EXTRAORDINARIO</strong>
          (más del 20% de faltas — pierden derecho a calificación ordinaria)
        </div>
        <div class="risk-chips">${danger.map(s => chip(s, 'danger')).join('')}</div>
      </div>` : '';

    const warningSection = warning.length > 0 ? `
      <div class="risk-section">
        <div class="risk-section-title">
          <span class="material-icons-round" style="color:#b45309;font-size:18px;vertical-align:middle;">warning</span>
          <strong>${warning.length} en alerta</strong>
          (entre 15% y 20% de faltas — atención cercana)
        </div>
        <div class="risk-chips">${warning.map(s => chip(s, 'warning')).join('')}</div>
      </div>` : '';

    const headerLevel = danger.length > 0 ? 'danger' : 'warning';
    container.innerHTML = `<div class="risk-banner risk-${headerLevel}">
      <span class="material-icons-round risk-banner-icon">priority_high</span>
      <div class="risk-banner-body">
        <div class="risk-banner-title">⚠ Atención: alumnos en riesgo por faltas</div>
        <div class="risk-banner-msg">Profesor(a), revise estos alumnos. Con más del 20% de faltas pierden derecho a calificación ordinaria según reglamento.</div>
        ${dangerSection}
        ${warningSection}
      </div>
    </div>`;
  }

  // Debounced wrapper para no recalcular en cada tecla
  let _riskBannerTimer = null;
  function _scheduleRiskBannerUpdate() {
    if (_riskBannerTimer) clearTimeout(_riskBannerTimer);
    _riskBannerTimer = setTimeout(_updateRiskBanner, 250);
  }

  function _updateStats() {
    const rows = document.querySelectorAll('tbody tr[data-student-id]');
    const cals = [];
    rows.forEach(row => {
      const calCell = row.querySelector('.col-cal');
      if (calCell && calCell.textContent.trim() !== '') {
        cals.push(parseFloat(calCell.textContent));
      }
    });

    const avg = cals.length > 0 ? (cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : '-';
    const aprobados = cals.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
    const reprobados = cals.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    const sinCalif = rows.length - cals.length;

    const e = id => document.getElementById(id);
    if (e('stat-promedio')) e('stat-promedio').textContent = avg;
    if (e('stat-aprobados')) e('stat-aprobados').textContent = aprobados;
    if (e('stat-reprobados')) e('stat-reprobados').textContent = reprobados;
    if (e('stat-sin-calif')) e('stat-sin-calif').textContent = sinCalif;
  }

  function switchPartial(partialId) {
    if (!_canLeaveEditor()) return;
    if (_isDirty) {
      if (!confirm('Tienes cambios sin guardar en este parcial. ¿Deseas cambiar sin guardar?')) return;
    }
    _markClean();
    currentPartial = partialId;
    openGradeEditor(null, selectedGroup, selectedSubject);
  }

  // SAFETY: si _isSaving lleva más de 60s en true, asume cuelgue y resetea.
  // Esto evita que el botón se quede en "Guardando..." para siempre si una
  // excepción no controlada deja el flag pegado.
  let _saveStartedAt = 0;

  async function saveGrades() {
    // ═══ PREVENT DOUBLE-CLICK + AUTO-RESCUE DE GUARDADO ATASCADO ═══
    if (_isSaving) {
      const stuckSeconds = (Date.now() - _saveStartedAt) / 1000;
      if (stuckSeconds < 60) {
        console.warn('[saveGrades] ya hay un guardado en curso desde hace', stuckSeconds.toFixed(1), 's');
        return;
      }
      // Lleva más de 60s. Asumimos cuelgue y reseteamos.
      console.warn('[saveGrades] auto-rescue: _isSaving llevaba', stuckSeconds.toFixed(0), 's atascado. Reseteando.');
      _isSaving = false;
      const stuckBtn = document.querySelector('[data-action="save-grades"]');
      if (stuckBtn) {
        stuckBtn.disabled = false;
        stuckBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">save</span>Guardar';
      }
      Toast.show('El guardado anterior se quedó atorado. Reseteado. Intenta otra vez.', 'warning');
      return;
    }

    const saveBtn = document.querySelector('[data-action="save-grades"]');

    // ═══ CHECK NETWORK CONNECTIVITY ═══
    if (!navigator.onLine) {
      Toast.show('Sin conexión a internet. Verifica tu red e intenta de nuevo.', 'error');
      return;
    }

    // ═══ VALIDAR HORAS IMPARTIDAS (obligatorio salvo cuando la lista se guarda en blanco) ═══
    if (_isTeacherCaptureRole() && !_listCleared && !_hasRequiredHoras()) {
      _showHorasRequiredReminder();
      return;
    }

    // ═══ CHECK PARTIAL LOCK + OVERRIDE (use cached partials) ═══
    try {
      const cachedPartials = await Store.getPartials();
      const partialDoc = cachedPartials.find(p => p.id === currentPartial);
      if (partialDoc && partialDoc.locked) {
        let hasOverride = App.currentUser?.role === 'admin';
        if (!hasOverride) {
          const teacherDocId = await Store.getTeacherDocId();
          if (teacherDocId) {
            const snap = await db.collection('partialOverrides')
              .where('partialId', '==', currentPartial)
              .where('teacherId', '==', teacherDocId).limit(1).get();
            if (!snap.empty) {
              const ov = snap.docs[0].data();
              if (!ov.expiresAt) hasOverride = true;
              else {
                const exp = ov.expiresAt.toDate ? ov.expiresAt.toDate() : new Date(ov.expiresAt);
                hasOverride = exp > new Date();
              }
            }
          }
        }
        if (!hasOverride) {
          Toast.show('Parcial cerrado. No se pueden modificar calificaciones.', 'warning');
          return;
        }
        Toast.show('Guardando con acceso especial (parcial cerrado)', 'info');
      }
    } catch (e) {
      console.warn('Error verificando parcial:', e);
    }

    // ═══ VALIDATE ALL INPUTS BEFORE SAVE ═══
    const rubros = K.getRubros(currentTurno);
    let validationErrors = 0;

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        if (input && input.value.trim() !== '') {
          let v = parseFloat(input.value.replace(',', '.'));
          if (isNaN(v) || v < 0 || v > r.max) {
            validationErrors++;
            input.classList.add('ge-input-invalid');
          } else {
            // Auto-fix: clamp and round before save
            v = Math.max(0, Math.min(v, r.max));
            v = Math.round(v * 10) / 10;
            input.value = v;
            input.classList.remove('ge-input-invalid');
          }
        }
      });
      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (faltasInput && faltasInput.value.trim() !== '') {
        let v = parseInt(faltasInput.value);
        if (isNaN(v) || v < 0) { validationErrors++; faltasInput.classList.add('ge-input-invalid'); }
        else { faltasInput.value = Math.max(0, Math.min(v, 99)); faltasInput.classList.remove('ge-input-invalid'); }
      }
    });

    if (validationErrors > 0) {
      Toast.show(`Hay ${validationErrors} valor(es) fuera de rango. Se corrigieron automáticamente. Revisa y guarda de nuevo.`, 'warning');
      return;
    }

    let failureIncidentReports = [];
    try {
      failureIncidentReports = await _collectRequiredFailureIncidents(rubros);
      if (failureIncidentReports === null) return;
    } catch (error) {
      console.error('Error verificando incidencias de reprobación:', error);
      Toast.show('No se pudieron revisar las incidencias obligatorias. Intenta de nuevo.', 'error');
      return;
    }

    // ═══ LOCK UI DURING SAVE ═══
    _isSaving = true;
    _saveStartedAt = Date.now();
    const origBtnText = saveBtn?.innerHTML || '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:18px;vertical-align:middle;margin-right:4px;">autorenew</span>Guardando...';
    }

    // SAFETY: si después de 45 segundos seguimos atorados, forzar reset.
    // Evita el caso "se queda eterno" reportado en producción.
    const safetyTimer = setTimeout(() => {
      if (_isSaving) {
        console.error('[saveGrades] SAFETY TIMEOUT: 45s sin terminar. Forzando reset.');
        _isSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
        Toast.show('El guardado se tardó demasiado. Se canceló. Verifica tu internet y vuelve a intentar.', 'error');
      }
    }, 45000);

    // ENVOLVER TODO EL SAVE EN TRY/FINALLY GLOBAL
    // Garantiza que _isSaving y el botón SIEMPRE se liberen, sin importar
    // qué excepción se lance dentro.
    try {
    // ═══ BUILD BATCH (only changed rows) ═══
    const batch = db.batch();
    let count = 0;
    let incidentCount = 0;

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      const studentId = row.dataset.studentId;
      const key = `${studentId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};

      if (_listCleared) {
        const hasStoredGrade = rubros.some(r => stored[r.key] !== undefined)
          || stored.faltas !== undefined
          || stored.suma !== undefined
          || stored.cal !== undefined
          || stored.value !== undefined;
        if (hasStoredGrade) {
          const clearedData = {
            studentId,
            subjectId: selectedSubject,
            groupId: selectedGroup,
            partial: currentPartial,
            updatedAt: new Date(),
            updatedBy: auth.currentUser.uid,
            suma: firebase.firestore.FieldValue.delete(),
            cal: firebase.firestore.FieldValue.delete(),
            value: firebase.firestore.FieldValue.delete(),
            faltas: firebase.firestore.FieldValue.delete()
          };
          rubros.forEach(r => { clearedData[r.key] = firebase.firestore.FieldValue.delete(); });
          batch.set(db.collection('grades').doc(key), clearedData, { merge: true });
          count++;
        }
        return;
      }

      let hasData = false;
      let hasChanges = false;

      const data = {
        studentId,
        subjectId: selectedSubject,
        groupId: selectedGroup,
        partial: currentPartial,
        updatedAt: new Date(),
        updatedBy: auth.currentUser.uid
      };

      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        if (input) {
          // Vacío = 0 (no capturado cuenta como cero)
          const raw = input.value.trim();
          const v = raw === '' ? 0 : Math.max(0, Math.min(parseFloat(raw) || 0, r.max));
          data[r.key] = v;
          // Mark as having data if the user typed anything (including 0)
          if (raw !== '' || stored[r.key] !== undefined) hasData = true;
          if (stored[r.key] === undefined || Math.abs((stored[r.key] || 0) - v) > 0.001) hasChanges = true;
        }
      });

      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (faltasInput && faltasInput.value.trim() !== '') {
        const f = parseInt(faltasInput.value);
        data.faltas = f;
        if ((stored.faltas || 0) !== f) hasChanges = true;
      }

      if (hasData && hasChanges) {
        const sumaData = {};
        rubros.forEach(r => { sumaData[r.key] = data[r.key]; });
        data.suma = K.calcSuma(sumaData);
        data.cal = K.calcCal(data.suma);
        data.value = data.cal;

        const ref = db.collection('grades').doc(key);
        batch.set(ref, data, { merge: true });
        count++;
      }
    });

    const currentList = _getCurrentListLabel();
    failureIncidentReports.forEach(report => {
      const ref = db.collection('incidents').doc(_failureIncidentDocId(report.studentId));
      batch.set(ref, {
        studentId: report.studentId,
        groupId: selectedGroup,
        turno: currentTurno,
        type: 'academica',
        incidentKind: 'reprobación',
        requiredBy: 'grade-save',
        title: `Reprobación en ${currentList.subjectName}`,
        description: report.reason,
        subjectId: selectedSubject,
        subjectName: currentList.subjectName,
        partial: currentPartial,
        partialName: currentList.partialName,
        grade: report.cal,
        suma: report.suma,
        date: new Date(),
        status: 'activa',
        reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
        reportedByUid: auth.currentUser.uid,
        updatedAt: new Date(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      incidentCount++;
    });

    const horasData = _getHorasData();
    if (Object.keys(horasData).length > 0) {
      const horasDocId = `${selectedGroup}_${selectedSubject}_${currentPartial}`;
      batch.set(db.collection('teacherHours').doc(horasDocId), {
        ...horasData,
        groupId: selectedGroup,
        subjectId: selectedSubject,
        partial: currentPartial,
        updatedBy: auth.currentUser.uid,
        updatedAt: new Date()
      }, { merge: true });
    }

    // Nothing to save?
    if (count === 0 && incidentCount === 0) {
      try {
        const horasSaved = await _saveHorasData(horasData);
        _listCleared = false;
        _hideClearPendingNotice();
        _markClean();
        Toast.show(horasSaved ? 'Horas impartidas guardadas' : 'No hay cambios que guardar', horasSaved ? 'success' : 'info');
      } catch (error) {
        console.warn('Error saving horas:', error);
        Toast.show('Error al guardar horas impartidas. Intenta de nuevo.', 'error');
      } finally {
        _isSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
      }
      return;
    }

    // ═══ COMMIT WITH RETRY ═══
    const maxRetries = 2;
    let attempt = 0;
    let success = false;

    while (attempt <= maxRetries && !success) {
      try {
        // TIMEOUT 20 segundos — si el commit tarda más, lanzamos error y entramos al retry
        const commitWithTimeout = Promise.race([
          batch.commit(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: el guardado tardó más de 20 segundos. Verifica tu internet.')), 20000))
        ]);
        await commitWithTimeout;
        success = true;
        // Update local grades cache so next save detects changes correctly
        document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
          const sid = row.dataset.studentId;
          const k = `${sid}_${selectedSubject}_${currentPartial}`;
          if (!grades[k]) grades[k] = {};
          if (_listCleared) {
            rubros.forEach(r => { delete grades[k][r.key]; });
            delete grades[k].faltas;
            delete grades[k].suma;
            delete grades[k].cal;
            delete grades[k].value;
            return;
          }
          rubros.forEach(r => {
            const input = row.querySelector(`input[data-field="${r.key}"]`);
            if (input && input.value.trim() !== '') grades[k][r.key] = parseFloat(input.value);
          });
          const fi = row.querySelector('input[data-field="faltas"]');
          if (fi && fi.value.trim() !== '') grades[k].faltas = parseInt(fi.value);
        });
      } catch (error) {
        attempt++;
        console.error(`Error saving grades (attempt ${attempt}):`, error);
        if (attempt <= maxRetries) {
          Toast.show(`Reintentando guardar... (${attempt}/${maxRetries})`, 'warning');
          await new Promise(r => setTimeout(r, 1500 * attempt));
        } else {
          Toast.show('Error al guardar calificaciones. Tus datos están seguros en el editor. Verifica tu conexión e intenta de nuevo.', 'error');
          _isSaving = false;
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
          // Save draft so data isn't lost
          _saveDraft();
          return;
        }
      }
    }

    // ═══ SUCCESS — unlock UI immediately, audit in background ═══
    const wasListCleared = _listCleared;
    Store.invalidateGradesForGroup(selectedGroup);
    Store.invalidate('allGrades');
    if (typeof Store.invalidateTeacherHours === 'function') Store.invalidateTeacherHours();
    _assignmentStatusCache = {};
    _assignmentStatusForPartial = null;
    _listCleared = false;
    _hideClearPendingNotice();
    _markClean();
    _isSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }

    if (saveBtn) {
      saveBtn.classList.add('btn-save-success');
      setTimeout(() => saveBtn.classList.remove('btn-save-success'), 2000);
    }

    const successParts = [];
    if (wasListCleared) successParts.push(`${count} registros dejados en blanco`);
    else if (count > 0) successParts.push(`${count} calificaciones guardadas`);
    if (incidentCount > 0) successParts.push(`${incidentCount} incidencias registradas`);
    Toast.show(successParts.length ? successParts.join(' y ') : 'Cambios guardados', 'success');

    // Audit in background (don't block UI)
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    DB.audit('editar', 'calificación', `${selectedGroup}_${selectedSubject}_${currentPartial}`, {
      description: `${count} calificaciones guardadas: ${asg?.subjectName || selectedSubject} · ${asg?.groupName || selectedGroup} · ${currentPartial}`,
      extra: { groupId: selectedGroup, subjectId: selectedSubject, partial: currentPartial, count, incidentCount }
    });
    } catch (fatalError) {
      // CATCH GLOBAL — captura cualquier excepción no manejada
      console.error('[saveGrades] FATAL ERROR no manejado:', fatalError);
      Toast.show('Error inesperado: ' + (fatalError?.message || 'desconocido') + '. Tus datos siguen en pantalla, intenta otra vez.', 'error');
      try { _saveDraft(); } catch (_) {}
    } finally {
      // FINALLY GLOBAL — SIEMPRE libera el lock y restaura el botón
      clearTimeout(safetyTimer);
      _isSaving = false;
      _saveStartedAt = 0;
      if (saveBtn) {
        saveBtn.disabled = false;
        // Solo restaurar texto si seguimos en "Guardando..." (no pisar otro estado)
        if (saveBtn.innerHTML.includes('Guardando')) {
          saveBtn.innerHTML = origBtnText || '<span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">save</span>Guardar';
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRINT — Formato Oficial v13 (Control Parcial)
  // ═══════════════════════════════════════════════════════════════

  // Script de impresión: shrink-to-fit en celdas de nombre + window.print().
  //
  // NOTA HISTÓRICA: en v6.02 había un auto-fit con `zoom` para forzar 1 hoja.
  // El `zoom` NO propaga al output de impresión de Chrome, así que recortaba
  // alumnos (reportado por maestros 2026-05-10). NUNCA volver a usar zoom.
  //
  // BAJO NINGUNA CIRCUNSTANCIA se permite cortar el nombre de un alumno
  // (reportado 2026-05-11). Por eso este script, antes de imprimir, mide
  // cada celda `.nm` (apellidos, nombre) y, si el texto natural excede el
  // ancho de la celda, REDUCE EL FONT-SIZE de esa celda específica en pasos
  // de 0.3px hasta que quepa. Solo afecta la celda en cuestión, las demás
  // (rubros, suma, calificación) mantienen su font. Si aún al mínimo legible
  // el texto sobresale, se permite overflow visible (preferimos overlap a
  // truncar). Funciona para grades.js y my-f1.js — ambos usan clase `.nm`.
  const _PRINT_TRIGGER_SCRIPT = '<script>(function(){function shrinkNameCells(){document.querySelectorAll(".MT td.nm").forEach(function(td){if(td.scrollWidth<=td.clientWidth+1)return;var cur=parseFloat(getComputedStyle(td).fontSize);var min=5;var step=0.3;var guard=80;while(td.scrollWidth>td.clientWidth+1&&cur>min&&guard-->0){cur-=step;td.style.fontSize=cur+"px";}if(td.scrollWidth>td.clientWidth+1)td.style.overflow="visible";});}window.addEventListener("load",function(){setTimeout(function(){shrinkNameCells();window.print();},300);});})();<\/script>';

  function _buildOfficialPrintHTML(studentsList, gradeData, meta) {
    const { teacherName, subjectName, groupName, groupNum, grado, turno, parcialNum, parcialText, semText, orientador, horas } = meta;
    const horasData = horas || {};
    const n = studentsList.length;

    // El turno MATUTINO no contempla Examen Parcial como rubro — solo se usa
    // Evaluación Continua + Transversal + Punto Extra. Por eso ocultamos esa
    // columna en la impresión del control para no mostrar campos vacíos que
    // confundirían al docente al firmar. En VESPERTINO sí va incluida.
    const isMatutino = String(turno || '').toUpperCase() === 'MATUTINO';

    // Dynamic font sizing — más generoso porque el layout rediseñado libera
    // ~15mm de altura útil para la tabla (bloque inferior compacto, márgenes
    // ajustados, header denso). Disponible para filas: ~225mm.
    //
    // PRIORIDAD ABSOLUTA (recordatorio): ningún alumno se pierde NUNCA. Si por
    // número extremo de alumnos no entra al font mínimo, se permite 2da hoja
    // con thead repetido. JAMÁS overflow:hidden ni zoom (recortaban alumnos).
    let fs, headerFs;
    if (n <= 25)      { fs = '11pt';   headerFs = '9pt';   }
    else if (n <= 32) { fs = '10.5pt'; headerFs = '9pt';   }
    else if (n <= 40) { fs = '10pt';   headerFs = '8.5pt'; }
    else if (n <= 48) { fs = '9pt';    headerFs = '8pt';   }
    else if (n <= 55) { fs = '8.5pt';  headerFs = '7.5pt'; }
    else if (n <= 62) { fs = '8pt';    headerFs = '7pt';   }
    else if (n <= 70) { fs = '7.5pt';  headerFs = '6.8pt'; }
    else if (n <= 80) { fs = '7pt';    headerFs = '6.5pt'; }
    else              { fs = '6.5pt';  headerFs = '6.2pt'; }

    let rows = '';
    let aprobados = 0, reprobados = 0, totalCalif = 0, gradedCount = 0;

    studentsList.forEach((s, idx) => {
      const g = gradeData[s.docId || s.id] || {};
      const ec = g.ec !== undefined && g.ec !== null ? g.ec : '';
      const tr = g.tr !== undefined && g.tr !== null ? g.tr : '';
      const ep = g.ex !== undefined && g.ex !== null ? g.ex : '';
      const pe = g.pe !== undefined && g.pe !== null ? g.pe : '';
      const sm = g.suma !== undefined && g.suma !== null ? g.suma : '';
      const fa = g.faltas !== undefined && g.faltas !== null ? Math.round(g.faltas) : '';
      const cd = g.cal !== undefined && g.cal !== null ? g.cal : (g.value !== undefined && g.value !== null ? Math.min(Number(g.value), 10) : '');

      if (cd !== '') {
        const nv = parseFloat(cd);
        if (!isNaN(nv)) { gradedCount++; totalCalif += nv; if (nv >= 6) aprobados++; else reprobados++; }
      }

      const isReprobado = cd !== '' && parseFloat(cd) < 6;
      const isOdd = idx % 2 === 1;
      let rowBg = '';
      if (isReprobado) { rowBg = ' background:#bbb;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }
      else if (isOdd) { rowBg = ' background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }

      const ap1 = s.apellido1 || '';
      const ap2 = s.apellido2 || '';
      const nom = s.nombres || '';

      rows += '<tr style="' + rowBg + '">' +
        '<td class="c">' + (idx + 1) + '</td>' +
        '<td class="nm">' + Utils.sanitize(ap1) + '</td>' +
        '<td class="nm">' + Utils.sanitize(ap2) + '</td>' +
        '<td class="nm">' + Utils.sanitize(nom) + '</td>' +
        '<td class="c">' + ec + '</td>' +
        '<td class="c">' + tr + '</td>' +
        (isMatutino ? '' : '<td class="c">' + ep + '</td>') +
        '<td class="c">' + pe + '</td>' +
        '<td class="c">' + sm + '</td>' +
        '<td class="c">' + fa + '</td>' +
        '<td class="c" style="font-weight:bold;">' + cd + '</td>' +
        '<td></td>' +
        '</tr>';
    });

    const existencia = studentsList.length;
    const inscritos = existencia;
    const promedio = gradedCount > 0 ? (totalCalif / gradedCount).toFixed(2) : '';
    const pctAprob = gradedCount > 0 ? ((aprobados / gradedCount) * 100).toFixed(1) + '%' : '';

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    return `
<style>
/* Márgenes mínimos para máxima altura útil: 4mm top, 3mm bottom, 5mm laterales.
   Sigue siendo cómodo para impresoras estándar y maximiza espacio para alumnos. */
@page { size: letter portrait; margin: 4mm 5mm 3mm 5mm; }
html, body { margin:0; padding:0; }
* { box-sizing:border-box; margin:0; padding:0; }

/* ═══ PAGE LAYOUT ═══
   PRIORIDAD ABSOLUTA: ver a TODOS los alumnos. NUNCA overflow:hidden ni
   altura fija (v6.02 lo tuvo y recortaba). El font sizing dinámico (arriba)
   busca caber en 1 hoja, pero si físicamente no cabe va a 2da hoja con
   thead repetido — jamás perder un alumno. */
.PG {
    width:100%;
    font-family:Arial,Helvetica,sans-serif; color:#000; line-height:1.05;
    font-size:${fs};
}
.PG table { border-collapse:collapse; }

@media screen {
    body { background: #e2e8f0; padding: 16px 0; }
    .PG { background: #fff; max-width: 215mm; min-height: 270mm; margin: 0 auto; padding: 4mm 5mm; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
}

@media print {
    .MT { page-break-inside: auto; }
    .MT tr { page-break-inside: avoid; page-break-after: auto; }
    .MT thead { display: table-header-group; }
    .PG-bot, .PG-ftr { page-break-inside: avoid; }
}

/* Header: dirección general (derecha) + logo (izquierda). Mínimo. */
.hdr-t { width:100%; margin-bottom:0; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:5.5mm; width:auto; }
.hdr-r { text-align:right; font-size:6pt; line-height:1.15; color:#333; }

/* Título de la escuela y del control. Mínimo. */
.ttl-esc { text-align:center; font-weight:bold; font-size:9.5pt; line-height:1.05; }
.ttl-ctrl { text-align:center; font-weight:bold; font-size:8.5pt; line-height:1; margin:0;
    border-bottom:0.5pt solid #000; padding-bottom:0.2mm; }

/* Info docente: padding ultra reducido. */
.nfo { width:100%; font-size:7.5pt; line-height:1.1; margin-top:0.2mm; }
.nfo td { border:0.5pt solid #000; padding:0.2mm 0.8mm; vertical-align:middle; }
.nfo .lb { font-size:6.5pt; color:#444; }
.nfo .vl { font-weight:bold; font-size:7.5pt; }
.nfo .sm { text-align:center; font-weight:bold; font-size:8pt; line-height:1.1; }

/* Tabla principal de alumnos. Line-height más ajustado y padding mínimo
   para empacar más filas sin tocar el font (legibilidad intacta). */
.MT { width:100%; table-layout:fixed; font-size:${fs}; line-height:1.0; margin-top:0.3mm; }
.MT th { border:0.5pt solid #000; padding:0.3mm 0.3mm; text-align:center; font-weight:bold; font-size:${headerFs};
    background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
    line-height:1.05; vertical-align:middle; }
.MT td { border:0.4pt solid #000; font-size:${fs}; line-height:1.0;
    padding:0.15mm 0.3mm; overflow:hidden; white-space:nowrap; vertical-align:middle; }
.MT .c { text-align:center; padding:0.15mm 0; }
/* La celda del nombre/apellidos NUNCA corta el texto. El script de print
   reduce el font solo de esta celda hasta que el texto completo quepa. */
.MT .nm { overflow:hidden; white-space:nowrap; padding-left:1mm; }

/* Stats inferiores en horizontal — compacto al máximo. */
.ST-row { width:100%; border-collapse:collapse; margin-top:0.3mm; }
.ST-row td { border:0.4pt solid #000; padding:0.2mm 1mm; text-align:center; vertical-align:middle; }
.ST-row .lb { font-size:5.8pt; color:#555; font-weight:600; text-transform:uppercase; line-height:1.05; }
.ST-row .vl { font-size:8.5pt; font-weight:bold; line-height:1; }

/* Horas impartidas. */
.HT { width:100%; border-collapse:collapse; margin-top:0.3mm; }
.HT td { border:0.4pt solid #000; padding:0.2mm 0.4mm; text-align:center; line-height:1.0; }
.HT .hl { font-weight:bold; font-size:5.8pt; color:#444; }
.HT .hv { font-weight:bold; font-size:7pt; }
.HT .ht { font-weight:bold; font-size:5.8pt; line-height:1.05; }

/* Firmas: ya no tienen margin top exagerado — pegadas al bloque de horas. */
.SG-tbl { width:100%; border-collapse:collapse; margin-top:0.5mm; }
.SG-tbl td { width:25%; text-align:center; padding:0 1.5mm; vertical-align:bottom; }
.SG-tbl .sg-line-row td { border-bottom:0.5pt solid #000; height:4mm; }
.SG-tbl .sg-text-row td { vertical-align:top; padding-top:0.2mm; }
.SG-tt { font-weight:bold; font-size:6.5pt; line-height:1.05; }
.SG-nm { font-size:5.8pt; line-height:1.1; }

/* Footer: logo de la cinta del Estado más bajo. */
.ftr img { width:100%; max-height:2mm; display:block; }
.ftr-t { text-align:center; font-size:5pt; color:#333; line-height:1; margin-top:0; }
</style>

<div class="PG">

<!-- ═══ HEADER (fijo) ═══ -->
<div class="PG-hdr">
<table class="hdr-t"><tr>
    <td style="width:50%">${logoHeader ? '<img src="' + logoHeader + '">' : ''}</td>
    <td class="hdr-r">
        DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR<br>
        DIRECCIÓN DE BACHILLERATO GENERAL<br>
        ZONA ESCOLAR NÚM. 63 BC<br>
        ESCUELA PREPARATORIA OFICIAL NÚM. 67<br>
        <b>C.C.T. 15EBH0134D · 15EBH0168U</b>
    </td>
</tr></table>
</div>

<!-- ═══ TÍTULOS (fijo) ═══ -->
<div class="PG-ttl">
<div class="ttl-esc">ESCUELA PREPARATORIA OFICIAL NÚM. 67</div>
<div class="ttl-ctrl">CONTROL ${parcialText} PARCIAL</div>
</div>

<!-- ═══ INFO DOCENTE/MATERIA (fijo) ═══ -->
<div class="PG-nfo">
<table class="nfo">
    <tr>
        <td style="width:10%"><span class="lb">Profesor(a):</span></td>
        <td style="width:35%" class="vl">${Utils.sanitize(Utils.displayName(teacherName))}</td>
        <td style="width:10%"><span class="lb">Grado:</span> <span class="vl">${grado}°</span></td>
        <td style="width:10%"><span class="lb">Grupo:</span> <span class="vl">${groupNum}</span></td>
        <td style="width:20%" class="sm" rowspan="2">${semText}<br><span style="font-size:5.5pt;color:#333;">${Utils.sanitize(turno)}</span></td>
    </tr>
    <tr>
        <td><span class="lb">UAC:</span></td>
        <td colspan="3" class="vl">${Utils.sanitize(subjectName)}</td>
    </tr>
</table>
</div>

<!-- ═══ TABLA DE ALUMNOS (CRECE — flex:1) ═══ -->
<div class="PG-data">
<table class="MT">
    <colgroup>
        ${isMatutino
          ? '<col style="width:3%"><col style="width:11%"><col style="width:11%"><col style="width:15%">' +
            '<col style="width:8%"><col style="width:7%"><col style="width:7%">' +
            '<col style="width:7%"><col style="width:6%"><col style="width:8%"><col style="width:7%">'
          : '<col style="width:3%"><col style="width:10%"><col style="width:10%"><col style="width:13%">' +
            '<col style="width:6%"><col style="width:5.5%"><col style="width:5.5%"><col style="width:4.5%">' +
            '<col style="width:5%"><col style="width:4.5%"><col style="width:6%"><col style="width:7%">'
        }
    </colgroup>
    <thead><tr>
        <th>No.</th>
        <th>Apellido Paterno</th>
        <th>Apellido Materno</th>
        <th>Nombre(s)</th>
        <th>Evaluación<br>Continua</th>
        <th>Transversal</th>
        ${isMatutino ? '' : '<th>Examen<br>Parcial</th>'}
        <th>Punto<br>Extra</th>
        <th>Suma</th>
        <th>Faltas</th>
        <th>Cal.<br>Definitiva</th>
        <th>Firma</th>
    </tr></thead>
    <tbody>${rows}</tbody>
</table>
</div>

<!-- ═══ ESTADÍSTICAS + FIRMAS (compacto en horizontal) ═══ -->
<div class="PG-bot">

<!-- 7 stats en 1 sola fila horizontal: ocupa ~5mm en lugar de ~14mm verticales -->
<table class="ST-row">
    <tr>
        <td><div class="lb">Inscritos</div><div class="vl">${inscritos}</div></td>
        <td><div class="lb">Bajas</div><div class="vl">0</div></td>
        <td><div class="lb">Existencia</div><div class="vl">${existencia}</div></td>
        <td><div class="lb">Aprobados</div><div class="vl">${aprobados}</div></td>
        <td><div class="lb">Reprobados</div><div class="vl">${reprobados}</div></td>
        <td><div class="lb">% Aprobados</div><div class="vl">${pctAprob || '—'}</div></td>
        <td><div class="lb">Promedio</div><div class="vl">${promedio || '—'}</div></td>
    </tr>
</table>

<!-- Horas impartidas (1 línea, sin label "Horas Impartidas" que ahorra espacio) -->
<table class="HT">
    <tr>
        <td class="ht" rowspan="2" style="width:18mm;">HORAS<br>IMPARTIDAS</td>
        <td class="hl">Febrero</td><td class="hl">Marzo</td><td class="hl">Abril</td>
        <td class="hl">Mayo</td><td class="hl">Junio</td><td class="hl">Julio</td>
        <td class="hl" style="font-weight:bold">Total</td>
    </tr>
    <tr>
        <td class="hv">${horasData.febrero || ''}</td><td class="hv">${horasData.marzo || ''}</td><td class="hv">${horasData.abril || ''}</td>
        <td class="hv">${horasData.mayo || ''}</td><td class="hv">${horasData.junio || ''}</td><td class="hv">${horasData.julio || ''}</td>
        <td class="hv" style="font-weight:bold">${[horasData.febrero,horasData.marzo,horasData.abril,horasData.mayo,horasData.junio,horasData.julio].reduce((s,v) => s + (parseInt(v) || 0), 0) || ''}</td>
    </tr>
</table>

<!-- Firmas (4 columnas, líneas y nombres) -->
<table class="SG-tbl">
    <tr class="sg-line-row">
        <td></td><td></td><td></td><td></td>
    </tr>
    <tr class="sg-text-row">
        <td>
            <div class="SG-tt">FIRMA DEL PROFESOR</div>
            <div class="SG-nm">${Utils.sanitize(Utils.displayName(teacherName))}</div>
        </td>
        <td>
            <div class="SG-tt">FIRMA DEL ORIENTADOR</div>
            <div class="SG-nm">${Utils.sanitize(orientador)}</div>
        </td>
        <td>
            <div class="SG-tt">VO. BO. SUBDIRECCIÓN ESCOLAR</div>
            <div class="SG-nm">${Utils.sanitize(App.staffName('subdirector'))}</div>
        </td>
        <td>
            <div class="SG-tt">DIRECCIÓN ESCOLAR</div>
            <div class="SG-nm">${Utils.sanitize(App.staffName('director'))}</div>
        </td>
    </tr>
</table>

</div>

<!-- ═══ FOOTER (fijo) ═══ -->
<div class="PG-ftr">
<div class="ftr">
    ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
    <div class="ftr-t">Av. de los Astros 7, Cuautitlán Izcalli, Estado de México, México C.P. 54770 · Tel. 55 5877 0221 · epo67@edu.gem.gob.mx</div>
</div>
</div>

</div>`;
  }

  async function printGrades() {
    if (!students || students.length === 0) {
      Toast.show('No hay datos para imprimir', 'warning');
      return;
    }

    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    const subjectName = asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject;
    const groupName = asg ? (asg.groupName || asg.groupId) : selectedGroup;
    const teacherName = (asg?.teacherName || '').toUpperCase();
    const grado = asg?.grado || 1;
    const groupNum = (groupName.split('-')[1] || groupName).trim();

    const parcialObj = K.PARCIALES.find(p => p.id === currentPartial);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };
    const semText = semMap[grado] || '';
    const orientador = K.getOrientador(currentTurno, groupName) || '';

    // Build grade data map from DOM (current editor state)
    const gradeDataMap = {};
    const rubros = K.getRubros(currentTurno);
    students.forEach(s => {
      const key = `${s.docId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};
      const row = document.querySelector(`tr[data-student-id="${s.docId}"]`);
      const g = {};

      if (row) {
        rubros.forEach(r => {
          const input = row.querySelector(`input[data-field="${r.key}"]`);
          g[r.key] = input && input.value.trim() !== '' ? parseFloat(input.value) : (stored[r.key] !== undefined ? stored[r.key] : null);
        });
        const sumaCell = row.querySelector('.col-suma');
        const calCell = row.querySelector('.col-cal');
        const faltasInput = row.querySelector('input[data-field="faltas"]');
        g.suma = sumaCell && sumaCell.textContent.trim() !== '' ? parseFloat(sumaCell.textContent) : null;
        g.cal = calCell && calCell.textContent.trim() !== '' ? parseFloat(calCell.textContent) : null;
        g.faltas = faltasInput && faltasInput.value.trim() !== '' ? parseInt(faltasInput.value) : null;
      } else {
        rubros.forEach(r => { g[r.key] = stored[r.key] !== undefined ? stored[r.key] : null; });
        g.suma = stored.suma !== undefined ? stored.suma : null;
        g.cal = stored.cal !== undefined ? stored.cal : (stored.value !== undefined ? Math.min(Number(stored.value), 10) : null);
        g.faltas = stored.faltas !== undefined ? stored.faltas : null;
      }
      gradeDataMap[s.docId] = g;
    });

    const html = _buildOfficialPrintHTML(students, gradeDataMap, {
      teacherName, subjectName, groupName, groupNum, grado, turno: currentTurno,
      parcialNum, parcialText, semText, orientador, horas: _getHorasData()
    });

    const printWindow = window.open('', '_blank');
    printWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Control Parcial - ' +
      Utils.sanitize(groupName) + ' - ' + Utils.sanitize(subjectName) + '</title></head><body>' +
      html + _PRINT_TRIGGER_SCRIPT + '</body></html>');
    printWindow.document.close();
  }

  async function _printSelectedAssignments(printAll) {
    const partialId = document.getElementById('bulk-print-partial')?.value || currentPartial;
    let assignmentIds = [];

    if (printAll) {
      assignmentIds = _orderedAssignments().map(a => a.id);
    } else {
      assignmentIds = [...document.querySelectorAll('.bulk-print-check:checked')]
        .map(input => input.value)
        .filter(Boolean);
    }

    await printMultipleAssignments(assignmentIds, partialId);
  }

  // ─── BULK PRINT — varias asignaciones a la vez ───
  /**
   * Imprime múltiples listas en un solo documento (con page-break entre cada una).
   * @param {string[]} assignmentIds - IDs de assignments a incluir
   * @param {string} partialId - ej. 'P1', 'P2', 'P3'
   */
  async function printMultipleAssignments(assignmentIds, partialId) {
    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      Toast.show('No hay listas seleccionadas para imprimir', 'warning');
      return;
    }

    Toast.show(`Generando ${assignmentIds.length} lista(s)…`, 'info');

    // Filtrar las assignments solicitadas
    const myAsg = await Store.getMyAssignments();
    const targetAsgs = assignmentIds.map(id => myAsg.find(a => a.id === id)).filter(Boolean);
    if (targetAsgs.length === 0) {
      Toast.show('No se encontraron las asignaciones solicitadas', 'error');
      return;
    }

    const parcialObj = K.PARCIALES.find(p => p.id === partialId);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };

    // Pre-cargar grupos y students para cada uno
    const groupIds = [...new Set(targetAsgs.map(a => a.groupId))];
    const [allGroups, allStudents] = await Promise.all([
      Store.getGroups(),
      Store.getStudentsByGroups(groupIds),
    ]);
    const studentsByGroup = {};
    for (const s of allStudents) {
      if (!studentsByGroup[s.groupId]) studentsByGroup[s.groupId] = [];
      studentsByGroup[s.groupId].push(s);
    }

    // Generar HTML por cada asignación, separados con page-break
    const allHtml = [];
    for (let i = 0; i < targetAsgs.length; i++) {
      const asg = targetAsgs[i];
      const grupo = allGroups.find(g => g.id === asg.groupId);
      const turno = grupo?.turno || asg.turno || 'MATUTINO';
      const grado = Number(grupo?.grado || asg.grado || 1);
      const groupName = grupo?.nombre || asg.groupName || asg.groupId;
      const groupNum = (groupName.split('-')[1] || groupName).trim();
      const subjectName = K.getUACNombre(asg.subjectName || asg.subjectId);
      const teacherName = (asg.teacherName || '').toUpperCase();
      const orientador = K.getOrientador(turno, groupName) || '';
      const semText = semMap[grado] || '';

      // Alumnos del grupo, ordenados
      const grpStudents = (studentsByGroup[asg.groupId] || [])
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      // Grades del grupo+materia+parcial
      let groupGrades = [];
      try {
        const all = await Store.getGradesByGroupAndPartial(asg.groupId, partialId);
        groupGrades = all.filter(g => g.subjectId === asg.subjectId);
      } catch (e) {
        console.warn('No se pudieron cargar grades para', asg.groupId, e);
      }
      const gradeDataMap = {};
      groupGrades.forEach(g => {
        gradeDataMap[g.studentId] = g;
      });
      // Para cada alumno asegurar entrada
      grpStudents.forEach(s => {
        if (!gradeDataMap[s.id]) gradeDataMap[s.id] = {};
        // Adaptar al formato esperado por _buildOfficialPrintHTML (docId)
        gradeDataMap[s.id || s.docId] = gradeDataMap[s.id] || {};
      });

      // Horas del docente para este grupo+materia+parcial
      let horas = {};
      try {
        const docId = `${asg.groupId}_${asg.subjectId}_${partialId}`;
        const horasDoc = await db.collection('teacherHours').doc(docId).get();
        if (horasDoc.exists) horas = horasDoc.data() || {};
      } catch (e) { /* ignorar */ }

      // Adaptar students al formato (con docId) que espera _buildOfficialPrintHTML
      const studentsForPrint = grpStudents.map(s => ({ docId: s.id, ...s }));
      // Adaptar gradeDataMap a usar docId como key (id === docId aquí)
      const gradeDataByDocId = {};
      grpStudents.forEach(s => { gradeDataByDocId[s.id] = gradeDataMap[s.id] || {}; });

      const meta = {
        teacherName, subjectName, groupName, groupNum, grado, turno,
        parcialNum, parcialText, semText, orientador, horas
      };
      const html = _buildOfficialPrintHTML(studentsForPrint, gradeDataByDocId, meta);

      // Page break después de cada lista (excepto la última)
      const pageBreak = i < targetAsgs.length - 1
        ? '<div style="page-break-after:always;"></div>'
        : '';
      allHtml.push(html + pageBreak);
    }

    // Abrir ventana de impresión con todas las listas concatenadas
    const printWindow = window.open('', '_blank');
    printWindow.document.write(
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>Listas de calificaciones — ' + targetAsgs.length + ' grupos</title>' +
      '</head><body>' + allHtml.join('') +
      _PRINT_TRIGGER_SCRIPT +
      '</body></html>'
    );
    printWindow.document.close();
    Toast.show(`${targetAsgs.length} lista(s) generadas`, 'success');
  }

  function printAdminGrades() {
    if (!_admin.grupo || !_admin.parcial) {
      Toast.show('Selecciona un grupo y parcial para imprimir', 'warning');
      return;
    }
    if (!_admin.materia) {
      Toast.show('Selecciona una materia para imprimir en formato oficial', 'warning');
      return;
    }

    const studentMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    const subjectMap = {};
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    const groupMap = {};
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    const grupo = groupMap[_admin.grupo];
    const groupName = grupo?.nombre || _admin.grupo;
    const groupNum = (groupName.split('-')[1] || groupName).trim();
    const grado = grupo?.grado || parseInt(_admin.grado) || 1;
    const turno = _admin.turno;

    const subject = subjectMap[_admin.materia];
    const subjectName = K.getUACNombre(subject?.nombre || _admin.materia);

    // Find teacher for this group+subject
    const asg = _admin.allAssignments.find(a => a.groupId === _admin.grupo && a.subjectId === _admin.materia);
    const teacherName = (asg?.teacherName || '').toUpperCase();

    const parcialObj = K.PARCIALES.find(p => p.id === _admin.parcial);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };
    const semText = semMap[grado] || '';
    const orientador = K.getOrientador(turno, groupName) || '';

    // Filter students for this group and sort by apellido
    const groupStudents = _admin.allStudents
      .filter(s => s.groupId === _admin.grupo)
      .sort((a, b) => {
        const c = (a.apellido1 || '').localeCompare(b.apellido1 || '');
        if (c) return c;
        const c2 = (a.apellido2 || '').localeCompare(b.apellido2 || '');
        if (c2) return c2;
        return (a.nombres || '').localeCompare(b.nombres || '');
      });

    // Build grade data map from allGrades
    const gradeDataMap = {};
    const filtered = _admin.allGrades.filter(g => g.subjectId === _admin.materia && g.partial === _admin.parcial);
    filtered.forEach(g => {
      gradeDataMap[g.studentId] = g;
    });

    const html = _buildOfficialPrintHTML(groupStudents, gradeDataMap, {
      teacherName, subjectName, groupName, groupNum, grado, turno,
      parcialNum, parcialText, semText, orientador
    });

    const printWindow = window.open('', '_blank');
    printWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Control Parcial - ' +
      Utils.sanitize(groupName) + ' - ' + Utils.sanitize(subjectName) + '</title></head><body>' +
      html + _PRINT_TRIGGER_SCRIPT + '</body></html>');
    printWindow.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN / ORIENTADOR VIEW — Filtros cascada estilo v13
  // ═══════════════════════════════════════════════════════════════

  async function renderAdmin() {
    const role = App.currentUser?.role;
    if (role !== 'admin' && !App.canActAs('orientador') && !App.canActAs('maestro')) {
      _container().innerHTML = UI.moduleContainer(UI.emptyState('block', 'Acceso denegado'));
      return;
    }

    const container = _container();
    container.innerHTML = UI.moduleContainer(UI.loadingState('Cargando datos...'));

    try {
      const [s, a, t, sub, grp, p] = await Promise.all([
        Store.getStudents(), Store.getAssignments(),
        Store.getTeachers(), Store.getSubjects(), Store.getGroups(), Store.getPartials()
      ]);

      _admin.allStudents = s.filter(st => st.estatus === 'ACTIVO');
      _admin.allGrades = []; // Se cargan bajo demanda al seleccionar grupo
      _admin.allAssignments = a;
      _admin.allTeachers = t;
      _admin.allSubjects = sub;
      _admin.allGroups = grp;
      _admin.allPartials = p;
      _admin.turno = ''; _admin.grado = ''; _admin.grupo = '';
      _admin.parcial = ''; _admin.materia = ''; _admin.docente = '';

      // For maestros (incluyendo orientador_docente): auto-filter a sus grupos/materias
      if (App.canActAs('maestro')) {
        _admin._teacherDocId = await Store.getTeacherDocId();
        if (_admin._teacherDocId) {
          _admin._teacherAssignments = a.filter(asg => asg.teacherId === _admin._teacherDocId);
        } else {
          _admin._teacherAssignments = [];
        }
      } else {
        _admin._teacherDocId = null;
        _admin._teacherAssignments = null;
      }

      _renderAdminUI();
    } catch (error) {
      console.error('Error loading admin grades:', error);
      container.innerHTML = UI.moduleContainer(UI.errorState('Error al cargar calificaciones'));
    }
  }

  function _renderAdminUI() {
    const container = _container();
    const role = App.currentUser?.role;
    const isMaestro = App.canActAs('maestro') && role !== 'admin';
    const subtitle = isMaestro
      ? 'Consulta de calificaciones de tus grupos y materias asignadas'
      : 'Consulta de calificaciones por grupo (solo lectura)';

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Consulta de Calificaciones', subtitle)}

        <div class="card">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
            <div class="form-group"><label>Turno</label>
              <select id="gf-turno"><option value="">Seleccionar...</option>${K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Grado</label>
              <select id="gf-grado"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Grupo</label>
              <select id="gf-grupo"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Parcial</label>
              <select id="gf-parcial"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Materia</label>
              <select id="gf-materia"><option value="">Todas</option></select>
            </div>
            <div class="form-group"><label>Docente</label>
              <select id="gf-docente"><option value="">Todos</option></select>
            </div>
          </div>
          <div class="filter-bar-actions" style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" data-action="export-grades">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</span>Exportar Excel
            </button>
            <button class="btn btn-outline btn-sm" data-action="print-admin-grades">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir
            </button>
          </div>
        </div>

        <div id="gf-stats"></div>
        <div id="gf-table"></div>
      </div>`;

    _delegateClick(container);
    _bindAdminFilters();
  }

  function _bindAdminFilters() {
    _el('gf-turno').addEventListener('change', function() { _admin.turno = this.value; _cascadeFrom('turno'); });
    _el('gf-grado').addEventListener('change', function() { _admin.grado = this.value; _cascadeFrom('grado'); });
    _el('gf-grupo').addEventListener('change', function() { _admin.grupo = this.value; _cascadeFrom('grupo'); });
    _el('gf-parcial').addEventListener('change', function() { _admin.parcial = this.value; _cascadeFrom('parcial'); });
    _el('gf-materia').addEventListener('change', function() { _admin.materia = this.value; _cascadeFrom('materia'); });
    _el('gf-docente').addEventListener('change', function() { _admin.docente = this.value; _cascadeFrom('docente'); });
  }

  function _cascadeFrom(field) {
    const fields = ['turno', 'grado', 'grupo', 'parcial', 'materia', 'docente'];
    const idx = fields.indexOf(field);
    if (idx <= 0) { _admin.grado = ''; _updateGradoOptions(); }
    if (idx <= 1) { _admin.grupo = ''; _updateGrupoOptions(); }
    if (idx <= 2) { _admin.parcial = ''; _updateParcialOptions(); }
    if (idx <= 3) { _admin.materia = ''; _updateMateriaOptions(); }
    if (idx <= 4) { _admin.docente = ''; _updateDocenteOptions(); }
    _updateTable();
  }

  function _updateGradoOptions() {
    const el = _el('gf-grado');
    // Dedup robusto: coerce a Number primero para no producir "dos terceros"
    // si hay datos mixtos (string "3" + integer 3) en la base.
    let grados = _admin.turno
      ? [...new Set(_admin.allStudents.filter(s => s.turno === _admin.turno).map(s => Number(s.grado)))].filter(g => Number.isFinite(g) && g > 0).sort((a,b) => a-b)
      : [...K.GRADOS];
    // For maestros: only show grados where they have assignments
    if (_admin._teacherAssignments) {
      const teacherGroupIds = new Set(_admin._teacherAssignments.map(a => a.groupId));
      const teacherGrados = new Set(_admin.allGroups.filter(g => teacherGroupIds.has(g.id)).map(g => Number(g.grado)));
      grados = grados.filter(g => teacherGrados.has(Number(g)));
    }
    el.innerHTML = '<option value="">Seleccionar...</option>' + grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');
  }

  function _updateGrupoOptions() {
    const el = _el('gf-grupo');
    let filtered = _admin.allGroups;
    if (_admin.turno) filtered = filtered.filter(g => g.turno === _admin.turno);
    if (_admin.grado) filtered = filtered.filter(g => String(g.grado) === String(_admin.grado));
    // For maestros: only show groups they are assigned to
    if (_admin._teacherAssignments) {
      const teacherGroupIds = new Set(_admin._teacherAssignments.map(a => a.groupId));
      filtered = filtered.filter(g => teacherGroupIds.has(g.id));
    }
    filtered.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    el.innerHTML = '<option value="">Seleccionar...</option>' + filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
  }

  function _updateParcialOptions() {
    const el = _el('gf-parcial');
    el.innerHTML = '<option value="">Seleccionar...</option>' + K.PARCIALES.map(p => {
      const partial = _admin.allPartials.find(pp => pp.id === p.id);
      const locked = partial?.locked ? ' 🔒' : '';
      return `<option value="${p.id}">${p.nombre}${locked}</option>`;
    }).join('');
  }

  function _updateMateriaOptions() {
    const el = _el('gf-materia');
    let subs = [];
    // Determine which assignments to use (maestros only see their own)
    const relevantAssignments = _admin._teacherAssignments || _admin.allAssignments;
    if (_admin.grupo) {
      const ids = [...new Set(relevantAssignments.filter(a => a.groupId === _admin.grupo).map(a => a.subjectId))];
      subs = _admin.allSubjects.filter(s => ids.includes(s.id));
    } else if (_admin.grado) {
      const gGroups = _admin.allGroups.filter(g => String(g.grado) === String(_admin.grado) && (!_admin.turno || g.turno === _admin.turno));
      const gIds = gGroups.map(g => g.id);
      const ids = [...new Set(relevantAssignments.filter(a => gIds.includes(a.groupId)).map(a => a.subjectId))];
      subs = _admin.allSubjects.filter(s => ids.includes(s.id));
    } else {
      if (_admin._teacherAssignments) {
        const ids = [...new Set(_admin._teacherAssignments.map(a => a.subjectId))];
        subs = _admin.allSubjects.filter(s => ids.includes(s.id));
      } else {
        subs = [..._admin.allSubjects];
      }
    }
    subs.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    el.innerHTML = '<option value="">Todas las materias</option>' + subs.map(s => `<option value="${s.id}">${Utils.sanitize(K.getUACNombre(s.nombre || s.id))}</option>`).join('');
  }

  function _updateDocenteOptions() {
    const el = _el('gf-docente');
    // For maestros: hide docente filter (they only see their own data)
    if (_admin._teacherAssignments) {
      el.closest('.form-group').style.display = 'none';
      return;
    }
    el.closest('.form-group').style.display = '';
    let filtered = _admin.allAssignments;
    if (_admin.grupo) filtered = filtered.filter(a => a.groupId === _admin.grupo);
    if (_admin.materia) filtered = filtered.filter(a => a.subjectId === _admin.materia);
    const tIds = [...new Set(filtered.map(a => a.teacherId))];
    const teachers = _admin.allTeachers.filter(t => tIds.includes(t.id));
    teachers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    el.innerHTML = '<option value="">Todos los docentes</option>' + teachers.map(t => `<option value="${t.id}">${Utils.sanitize(Utils.displayName(t.nombre || t.id))}</option>`).join('');
  }

  async function _updateTable() {
    const tableContainer = _el('gf-table');
    const statsContainer = _el('gf-stats');
    if (!tableContainer) return;

    if (!_admin.turno) {
      tableContainer.innerHTML = UI.emptyState('filter_list', 'Selecciona un turno para comenzar');
      statsContainer.innerHTML = '';
      return;
    }

    if (!_admin.grupo) {
      tableContainer.innerHTML = UI.emptyState('filter_list', 'Selecciona un grupo para ver calificaciones');
      statsContainer.innerHTML = '';
      return;
    }

    // Show loading while fetching grades for this group
    tableContainer.innerHTML = UI.loadingState('Cargando calificaciones del grupo...');
    statsContainer.innerHTML = '';

    // Load grades for selected group(s) on demand
    try {
      _admin.allGrades = await Store.getGradesByGroup(_admin.grupo, true);
    } catch (err) {
      console.error('Error loading grades:', err);
      tableContainer.innerHTML = UI.emptyState('error', 'Error al cargar calificaciones');
      return;
    }

    // Filter grades (already filtered by groupId from Firestore query)
    let filtered = [..._admin.allGrades];

    // For maestros: restrict to their assigned subjects for this group
    if (_admin._teacherAssignments) {
      const teacherCombos = new Set(_admin._teacherAssignments.map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => teacherCombos.has(`${g.groupId}_${g.subjectId}`));
    }

    if (_admin.parcial) filtered = filtered.filter(g => g.partial === _admin.parcial);
    if (_admin.materia) filtered = filtered.filter(g => g.subjectId === _admin.materia);
    if (_admin.docente) {
      const combos = new Set(_admin.allAssignments.filter(a => a.teacherId === _admin.docente).map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => combos.has(`${g.groupId}_${g.subjectId}`));
    }

    // Build maps
    const studentMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    const subjectMap = {};
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    const groupMap = {};
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    // Stats using cal (or value for legacy data)
    const values = filtered.map(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : null);
      return cal;
    }).filter(v => v !== null && v !== '' && !isNaN(v));

    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const aprobados = values.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
    const reprobados = values.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    const pctReprob = values.length > 0 ? Math.round((reprobados / values.length) * 100) : 0;

    const avgClass = avg >= 8.3 ? 'stat-card--success' : avg >= 7 ? 'stat-card--warning' : 'stat-card--danger';
    const repClass = pctReprob <= 14 ? 'stat-card--success' : pctReprob <= 20 ? 'stat-card--warning' : 'stat-card--danger';

    statsContainer.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card--compact ${avgClass}"><div class="stat-number">${avg.toFixed(2)}</div><div class="stat-label">Promedio</div></div>
        <div class="stat-card--compact stat-card--primary"><div class="stat-number">${filtered.length}</div><div class="stat-label">Calificaciones</div></div>
        <div class="stat-card--compact stat-card--success"><div class="stat-number">${aprobados}</div><div class="stat-label">Aprobados</div></div>
        <div class="stat-card--compact ${repClass}"><div class="stat-number">${reprobados} (${pctReprob}%)</div><div class="stat-label">Reprobados</div></div>
      </div>`;

    if (filtered.length === 0) {
      tableContainer.innerHTML = UI.emptyState('grading', 'No hay calificaciones para los filtros seleccionados');
      return;
    }

    // Determine rubros for display
    const turnoRubros = K.getRubros(_admin.turno);

    // Sort by student name
    filtered.sort((a, b) => {
      const sa = studentMap[a.studentId];
      const sb = studentMap[b.studentId];
      return (sa?.nombreCompleto || '').localeCompare(sb?.nombreCompleto || '');
    });

    const display = filtered.slice(0, 500);
    const truncated = filtered.length > 500;

    // Header for rubros columns
    const rubroHeaders = turnoRubros.map(r => `<th style="width:55px;text-align:center;font-size:11px;">${r.abbr}</th>`).join('');

    let rows = '';
    display.forEach((g, i) => {
      const student = studentMap[g.studentId];
      const subject = subjectMap[g.subjectId];
      const group = groupMap[g.groupId];
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : '-');
      const suma = g.suma !== undefined ? Number(g.suma).toFixed(1) : '-';
      const calColor = cal !== '-' && cal < 6 ? 'color:var(--color-danger);font-weight:700;' : 'font-weight:600;';

      // Rubros cells
      const rubroCells = turnoRubros.map(r => {
        const v = g[r.key];
        return `<td style="text-align:center;font-size:12px;">${v !== undefined ? v : '-'}</td>`;
      }).join('');

      rows += `<tr>
        <td class="text-muted">${i + 1}</td>
        <td class="font-semibold" style="font-size:12px;">${Utils.sanitize(student?.nombreCompleto || 'N/A')}</td>
        <td style="font-size:12px;">${Utils.sanitize(group?.nombre || g.groupId)}</td>
        <td style="font-size:12px;">${Utils.sanitize(K.getUACNombre(subject?.nombre || g.subjectName || g.subjectId))}</td>
        <td style="text-align:center;">${g.partial || ''}</td>
        ${rubroCells}
        <td style="text-align:center;background:rgba(49,130,206,0.04);">${suma}</td>
        <td style="text-align:center;${calColor}">${cal}</td>
        <td style="text-align:center;">${g.faltas !== undefined ? g.faltas : '-'}</td>
      </tr>`;
    });

    tableContainer.innerHTML = `
      ${truncated ? `<div class="alert alert-warning" style="margin-bottom:12px;">Mostrando las primeras 500 de ${filtered.length} calificaciones.</div>` : ''}
      <div class="table-container" style="overflow-x:auto;">
        <table class="table-light" style="min-width:900px;">
          <thead><tr>
            <th style="width:40px">#</th>
            <th>Alumno</th>
            <th>Grupo</th>
            <th>Materia</th>
            <th style="width:60px;text-align:center;">Parcial</th>
            ${rubroHeaders}
            <th style="width:55px;text-align:center;">SUMA</th>
            <th style="width:50px;text-align:center;">CAL.</th>
            <th style="width:55px;text-align:center;">FALTAS</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function exportGrades() {
    if (!_admin.grupo) {
      Toast.show('Selecciona un grupo para exportar', 'warning');
      return;
    }
    // Use already-loaded grades for this group
    let filtered = [..._admin.allGrades];
    const studentMap = {}, subjectMap = {}, groupMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    // For maestros: restrict export to their assigned subjects
    if (_admin._teacherAssignments) {
      const teacherCombos = new Set(_admin._teacherAssignments.map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => teacherCombos.has(`${g.groupId}_${g.subjectId}`));
    }
    if (_admin.parcial) filtered = filtered.filter(g => g.partial === _admin.parcial);
    if (_admin.materia) filtered = filtered.filter(g => g.subjectId === _admin.materia);

    const rubros = K.getRubros(_admin.turno);
    const data = filtered.map(g => {
      const s = studentMap[g.studentId];
      const sub = subjectMap[g.subjectId];
      const grp = groupMap[g.groupId];
      const row = {
        'Alumno': s?.nombreCompleto || '',
        'Grupo': grp?.nombre || g.groupId,
        'Turno': s?.turno || '',
        'Materia': K.getUACNombre(sub?.nombre || g.subjectName || ''),
        'Parcial': g.partial || ''
      };
      rubros.forEach(r => { row[r.abbr] = g[r.key] !== undefined ? g[r.key] : ''; });
      row['SUMA'] = g.suma !== undefined ? g.suma : '';
      row['CAL.'] = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : '');
      row['FALTAS'] = g.faltas !== undefined ? g.faltas : '';
      return row;
    });

    Utils.exportToExcel(data, `Calificaciones_${_admin.turno}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  const api = {
    renderTeacher, renderAdmin, openGradeEditor,
    switchPartial, saveGrades, exportGrades,
    printGrades, printAdminGrades
  };
  return api;
})();

// Self-register routes
Router.modules['my-grades'] = () => GradesModule.renderTeacher();
Router.modules['grades-admin'] = () => GradesModule.renderAdmin();
