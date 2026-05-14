const TeachersModule = (() => {
  const db = firebase.firestore();

  const state = {
    teachers: [],
    groups: [],
    subjects: [],
    assignments: [],
    currentTab: 'asignaciones',
    searchQuery: '',
    selectedGroup: 'all',
    dataLoaded: false,
    // Docentes filters
    sortOrder: 'asc',
    filterTurno: 'all',
    // Materias filter
    materiasFilterTurno: 'all',
    // Asignaciones filters
    assignmentSearch: '',
    assignmentFilterTurno: 'all',
    assignmentFilterGrado: 'all'
  };

  // ── Data ──────────────────────────────────────────────────────

  const loadData = async () => {
    try {
      const [allTeachers, allGroups, allSubjects, allAssignments] = await Promise.all([
        Store.getTeachers(),
        Store.getGroups(),
        Store.getSubjects(),
        Store.getAssignments()
      ]);

      state.teachers = allTeachers.filter(t => t.status === 'active');
      state.groups = allGroups.filter(g => g.status === 'active');
      state.subjects = allSubjects.filter(s => s.status === 'active');
      state.assignments = allAssignments;
      state.dataLoaded = true;
    } catch (error) {
      console.error('Error loading data:', error);
      Toast.show('Error al cargar datos', 'error');
    }
  };

  // ── Helpers ───────────────────────────────────────────────────

  const S = (val) => Utils.sanitize(val || '');

  const turnoBadge = (turno) => {
    const t = (turno || '').toLowerCase();
    const cls = t === 'matutino' ? 'badge-matutino'
              : t === 'vespertino' ? 'badge-vespertino'
              : t === 'ambos' ? 'badge-ambos'
              : '';
    return `<span class="badge ${cls}">${S(turno) || 'N/A'}</span>`;
  };

  const invalidateAndReload = async (...keys) => {
    keys.forEach(k => Store.invalidate(k));
    state.dataLoaded = false;
    await render();
  };

  // ── CRUD: Teachers ────────────────────────────────────────────

  const openTeacherModal = (teacher = null) => {
    const isEdit = !!teacher;
    const title = isEdit ? 'Editar Docente' : 'Nuevo Docente';

    const body = `
      <form id="teacherForm">
        <div class="form-group">
          <label>Nombre *</label>
          <input type="text" id="tf_nombre" value="${isEdit ? S(teacher.nombre) : ''}" required>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="tf_email" value="${isEdit ? S(teacher.email) : ''}">
        </div>
        <div class="form-group">
          <label>Turno</label>
          <select id="tf_turno">
            <option value="MATUTINO" ${isEdit && teacher.turno === 'MATUTINO' ? 'selected' : ''}>MATUTINO</option>
            <option value="VESPERTINO" ${isEdit && teacher.turno === 'VESPERTINO' ? 'selected' : ''}>VESPERTINO</option>
            <option value="AMBOS" ${isEdit && teacher.turno === 'AMBOS' ? 'selected' : ''}>AMBOS</option>
          </select>
        </div>
        <div class="form-group">
          <label>Especialidad</label>
          <input type="text" id="tf_especialidad" value="${isEdit ? S(teacher.especialidad) : ''}">
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="save-teacher">Guardar</button>
    `;

    Modal.open(title, body, footer);

    const modalFooter = document.getElementById('modalFooter');
    const modalBody = document.getElementById('modalBody');

    modalFooter.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('[data-action="save-teacher"]')) {
        const nombre = document.getElementById('tf_nombre').value.trim();
        if (!nombre) {
          Toast.show('El nombre es obligatorio', 'error');
          return;
        }
        const data = {
          nombre,
          email: document.getElementById('tf_email').value.trim(),
          turno: document.getElementById('tf_turno').value,
          especialidad: document.getElementById('tf_especialidad').value.trim()
        };

        try {
          if (isEdit) {
            const before = { nombre: teacher.nombre, email: teacher.email, turno: teacher.turno, especialidad: teacher.especialidad };
            await db.collection('teachers').doc(teacher.id).update(data);
            DB.audit('editar', 'docente', teacher.id, {
              description: `Docente editado: ${data.nombre}`,
              before, after: data
            });
            Toast.show('Docente actualizado', 'success');
          } else {
            data.status = 'active';
            data.createdAt = new Date();
            const ref = await db.collection('teachers').add(data);
            DB.audit('crear', 'docente', ref.id, {
              description: `Docente creado: ${data.nombre}`,
              after: data
            });
            Toast.show('Docente creado', 'success');
          }
          Modal.close();
          await invalidateAndReload('teachers');
        } catch (err) {
          console.error('Error saving teacher:', err);
          Toast.show('Error al guardar docente', 'error');
        }
      }
    });
  };

  const deleteTeacher = (teacher) => {
    const teacherAssignments = state.assignments.filter(a => a.teacherId === teacher.id);
    let warningMsg = '';
    if (teacherAssignments.length > 0) {
      warningMsg = `<p style="color:var(--danger);font-weight:600;">Este docente tiene ${teacherAssignments.length} asignación(es). Se recomienda eliminarlas primero.</p>`;
    }

    const message = `
      <p>Está a punto de eliminar al docente:</p>
      <p><strong>${S(Utils.displayName(teacher.nombre))}</strong></p>
      ${warningMsg}
      <div class="alert alert-danger">Esta acción es irreversible.</div>`;

    Modal.confirmTyped('Eliminar Docente', message, 'ELIMINAR', async () => {
      try {
        await DB.audit('eliminar', 'docente', teacher.id, {
          description: `Docente eliminado: ${teacher.nombre}`,
          before: { nombre: teacher.nombre, email: teacher.email, turno: teacher.turno, especialidad: teacher.especialidad }
        });
        await db.collection('teachers').doc(teacher.id).delete();
        Toast.show('Docente eliminado', 'success');
        await invalidateAndReload('teachers');
      } catch (err) {
        console.error('Error deleting teacher:', err);
        Toast.show('Error al eliminar docente', 'error');
      }
    });
  };

  // ── CRUD: Orientador ──────────────────────────────────────────

  // Orientadores oficiales por nombre (del listado de subdirección)
  const ORIENTADOR_NAMES = [
    'CORREA SALGADO ANA ISABEL',
    'DIAZ CAMARENA SANDRA',
    'MORLAN ORTIZ NEFTALI MARGARITA',
    'RANGEL PALACIOS JUANA',
    'SALAZAR ZUNIGA JOSE EDGAR',
    'CEDILLO POLO IVONNE GABRIELA',
    'GARCIA GONZALEZ BEATRIZ ALEJANDRA',
    'MARTINEZ PEREZ LAURITA',
    'RODRIGUEZ VIVAS FERNANDA CITLALLI'
  ];

  function _normalize(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim(); }

  const openOrientadorModal = (group) => {
    // Filter to only official orientadores that match the turno
    const orientadorNamesNorm = ORIENTADOR_NAMES.map(n => _normalize(n));
    const matchingTeachers = state.teachers.filter(t => {
      const turnoMatch = t.turno === group.turno || t.turno === 'AMBOS';
      const isOrientador = orientadorNamesNorm.some(on => _normalize(t.nombre).includes(on) || on.includes(_normalize(t.nombre)));
      return turnoMatch && isOrientador;
    });

    const body = `
      <div class="form-group">
        <label>Grupo</label>
        <input type="text" value="${S(group.nombre)}" disabled>
      </div>
      <div class="form-group">
        <label>Orientador actual</label>
        <input type="text" value="${S(group.orientador) || 'Sin asignar'}" disabled>
      </div>
      <div class="form-group">
        <label>Seleccionar Orientador</label>
        <select id="of_teacher">
          <option value="">-- Sin asignar --</option>
          ${matchingTeachers.map(t => `
            <option value="${S(t.id)}" data-name="${S(t.nombre)}" ${group.orientadorId === t.id ? 'selected' : ''}>
              ${S(Utils.displayName(t.nombre))} (${S(t.turno)})
            </option>
          `).join('')}
        </select>
      </div>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="save-orientador">Guardar</button>
    `;

    Modal.open('Asignar Orientador', body, footer);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('[data-action="save-orientador"]')) {
        const sel = document.getElementById('of_teacher');
        const teacherId = sel.value;
        const teacherName = teacherId
          ? sel.options[sel.selectedIndex].getAttribute('data-name')
          : '';

        try {
          await db.collection('groups').doc(group.id).update({
            orientador: teacherName,
            orientadorId: teacherId
          });
          Toast.show('Orientador asignado', 'success');
          Modal.close();
          await invalidateAndReload('groups');
        } catch (err) {
          console.error('Error assigning orientador:', err);
          Toast.show('Error al asignar orientador', 'error');
        }
      }
    });
  };

  // ── CRUD: Assignments ─────────────────────────────────────────

  const openAssignmentModal = (assignment = null) => {
    const isEdit = !!assignment;
    const title = isEdit ? 'Editar Asignación' : 'Nueva Asignación';

    // Combobox buscable para el docente — el select nativo no permite buscar y
    // con 50+ maestros era impráctico. Texto visible + hidden con id + lista
    // filtrable.
    const initialTeacher = isEdit ? state.teachers.find(t => t.id === assignment.teacherId) : null;
    const initialDisplay = initialTeacher
      ? `${Utils.displayName(initialTeacher.nombre)} (${initialTeacher.turno})`
      : '';
    const normalize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const body = `
      <form id="assignmentForm">
        <div class="form-group">
          <label>Docente *</label>
          <div class="teacher-combo" style="position:relative;">
            <input type="text" id="af_teacher_search" autocomplete="off"
              placeholder="Escribe nombre, apellido o turno para buscar…"
              value="${S(initialDisplay)}"
              style="width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:6px;font-size:14px;">
            <input type="hidden" id="af_teacher" value="${S(initialTeacher ? initialTeacher.id : '')}" data-name="${S(initialTeacher ? initialTeacher.nombre : '')}">
            <div id="af_teacher_list" style="position:absolute;top:calc(100% + 2px);left:0;right:0;max-height:280px;overflow-y:auto;background:#fff;border:1px solid #cbd5e0;border-radius:6px;display:none;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.12);">
              ${state.teachers.map(t => {
                const display = Utils.displayName(t.nombre);
                const searchKey = normalize(t.nombre + ' ' + t.turno);
                return `<div class="combo-item" data-id="${S(t.id)}" data-name="${S(t.nombre)}" data-display="${S(display + ' (' + t.turno + ')')}" data-search="${S(searchKey)}" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;line-height:1.3;">
                  <strong>${S(display)}</strong> <span style="color:#94a3b8;font-size:11px;">(${S(t.turno)})</span>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Grado *</label>
          <select id="af_grado">
            <option value="">-- Seleccionar --</option>
            ${K.GRADOS.map(g => `
              <option value="${g}" ${isEdit && assignment.grado === g ? 'selected' : ''}>
                ${g} Grado
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Materia *</label>
          <select id="af_subject">
            <option value="">-- Seleccionar grado primero --</option>
          </select>
        </div>
        <div class="form-group">
          <label>Turno *</label>
          <select id="af_turno">
            <option value="">-- Seleccionar --</option>
            ${K.TURNOS.map(t => `
              <option value="${t}" ${isEdit && assignment.turno === t ? 'selected' : ''}>
                ${S(t)}
              </option>
            `).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Grupo *</label>
          <select id="af_group">
            <option value="">-- Seleccionar turno primero --</option>
          </select>
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="save-assignment">Guardar</button>
    `;

    Modal.open(title, body, footer);

    // ── Combobox del docente — wiring del filtrado en vivo ──
    const teacherSearch = document.getElementById('af_teacher_search');
    const teacherHidden = document.getElementById('af_teacher');
    const teacherList = document.getElementById('af_teacher_list');
    if (teacherSearch && teacherList) {
      const filterTeachers = () => {
        const q = normalize(teacherSearch.value).trim();
        let visible = 0;
        teacherList.querySelectorAll('.combo-item').forEach(item => {
          const match = !q || item.dataset.search.indexOf(q) !== -1;
          item.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        teacherList.style.display = visible > 0 ? 'block' : 'none';
      };
      teacherSearch.addEventListener('focus', () => { teacherList.style.display = 'block'; filterTeachers(); });
      teacherSearch.addEventListener('input', () => {
        // Si el usuario está editando el texto, se invalida la selección previa
        teacherHidden.value = '';
        teacherHidden.dataset.name = '';
        filterTeachers();
      });
      teacherSearch.addEventListener('blur', () => {
        // Delay para que el mousedown de un item se procese antes de ocultar
        setTimeout(() => { teacherList.style.display = 'none'; }, 180);
      });
      teacherList.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.combo-item');
        if (!item) return;
        teacherHidden.value = item.dataset.id;
        teacherHidden.dataset.name = item.dataset.name;
        teacherSearch.value = item.dataset.display;
        teacherList.style.display = 'none';
      });
      teacherList.addEventListener('mouseover', (e) => {
        const item = e.target.closest('.combo-item');
        if (item) item.style.background = '#eff6ff';
      });
      teacherList.addEventListener('mouseout', (e) => {
        const item = e.target.closest('.combo-item');
        if (item) item.style.background = '';
      });
    }

    const gradoSel = document.getElementById('af_grado');
    const subjectSel = document.getElementById('af_subject');
    const turnoSel = document.getElementById('af_turno');
    const groupSel = document.getElementById('af_group');

    const updateSubjects = () => {
      const grado = gradoSel.value;
      const filtered = grado
        ? state.subjects.filter(s => String(s.grado) === String(grado))
        : [];
      subjectSel.innerHTML = `
        <option value="">-- Seleccionar --</option>
        ${filtered.map(s => `
          <option value="${S(s.id)}" data-name="${S(s.nombre)}"
            ${isEdit && assignment && assignment.subjectId === s.id ? 'selected' : ''}>
            ${S(s.nombre)}
          </option>
        `).join('')}
      `;
    };

    const updateGroups = () => {
      const turno = turnoSel.value;
      const filtered = turno
        ? state.groups.filter(g => g.turno === turno)
        : [];
      groupSel.innerHTML = `
        <option value="">-- Seleccionar --</option>
        ${filtered.map(g => `
          <option value="${S(g.id)}" data-name="${S(g.nombre)}"
            ${isEdit && assignment && assignment.groupId === g.id ? 'selected' : ''}>
            ${S(g.nombre)}
          </option>
        `).join('')}
      `;
    };

    gradoSel.addEventListener('change', updateSubjects);
    turnoSel.addEventListener('change', updateGroups);

    // Pre-populate dropdowns if editing
    if (isEdit) {
      updateSubjects();
      updateGroups();
    }

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('[data-action="save-assignment"]')) {
        const teacherEl = document.getElementById('af_teacher');
        const subjectEl = document.getElementById('af_subject');
        const groupEl = document.getElementById('af_group');
        const gradoRaw = gradoSel.value;
        const turno = turnoSel.value;

        if (!teacherEl.value || !gradoRaw || !subjectEl.value || !turno || !groupEl.value) {
          Toast.show('Todos los campos son obligatorios', 'error');
          return;
        }
        // Coerce a Number siempre — el value del select viene como string.
        const gradoN = Number(gradoRaw);
        const grado = Number.isFinite(gradoN) && gradoN > 0 ? gradoN : gradoRaw;

        // teacherEl ya no es <select> sino <input hidden> con data-name — leer de ahí
        const data = {
          teacherId: teacherEl.value,
          teacherName: teacherEl.dataset.name || '',
          subjectId: subjectEl.value,
          subjectName: subjectEl.options[subjectEl.selectedIndex].getAttribute('data-name'),
          groupId: groupEl.value,
          groupName: groupEl.options[groupEl.selectedIndex].getAttribute('data-name'),
          grado,
          turno
        };

        try {
          // ID canonico que firestore.rules espera: <teacherId>_<groupId>_<subjectId>.
          // Si alguno de esos 3 cambio en una edicion, el docId VIEJO queda invalido
          // para la rule teacherHasAssignment() y el maestro no podra guardar grades.
          // Por eso recreamos el doc cuando el docId canonico cambia.
          const canonicalId = `${data.teacherId}_${data.groupId}_${data.subjectId}`;

          if (isEdit) {
            const oldId = assignment.id;
            const oldTeacherId = assignment.teacherId;
            if (oldId !== canonicalId) {
              // Edicion que cambia teacher, grupo o materia: borrar viejo y crear nuevo
              // (no se puede renombrar un doc Firestore; hay que delete + create)
              await db.collection('assignments').doc(canonicalId).set(data);
              await _syncAssignmentByGroup(canonicalId, data);
              try { await db.collection('assignments').doc(oldId).delete(); } catch(e){}
              // Si cambio el teacher, tambien limpiar el assignmentsByGroup del teacher anterior
              if (oldTeacherId && oldTeacherId !== data.teacherId && assignment.groupId) {
                await _deleteAssignmentByGroup({ groupId: assignment.groupId, teacherId: oldTeacherId });
              }
              DB.audit('editar', 'asignación', canonicalId, {
                description: `Asignación editada: ${data.teacherName} → ${data.subjectName} (${data.groupName})`,
                before: { docId: oldId },
                after: data
              });
            } else {
              // docId no cambia: simple update
              await db.collection('assignments').doc(canonicalId).update(data);
              await _syncAssignmentByGroup(canonicalId, data);
              DB.audit('editar', 'asignación', canonicalId, {
                description: `Asignación editada: ${data.teacherName} → ${data.subjectName} (${data.groupName})`,
                after: data
              });
            }
            Toast.show('Asignación actualizada', 'success');
          } else {
            // CREATE: docId deterministico para que las rules validen permisos de maestro
            await db.collection('assignments').doc(canonicalId).set(data);
            await _syncAssignmentByGroup(canonicalId, data);
            DB.audit('crear', 'asignación', canonicalId, {
              description: `Asignación creada: ${data.teacherName} → ${data.subjectName} (${data.groupName})`,
              after: data
            });
            Toast.show('Asignación creada', 'success');
          }
          Modal.close();
          await invalidateAndReload('assignments');
        } catch (err) {
          console.error('Error saving assignment:', err);
          Toast.show('Error al guardar asignación', 'error');
        }
      }
    });
  };

  // ─── HELPER: mantener assignmentsByGroup en sincronía con assignments ──
  // Las firestore.rules validan permisos de maestro vía teacherHasGroup() que
  // chequea la existencia de docs en assignmentsByGroup/{groupId}_{teacherId}.
  // Si una assignment no tiene su par aquí, las queries de students/grades
  // del maestro fallan con "Missing or insufficient permissions".
  const _syncAssignmentByGroup = async (assignmentId, data) => {
    if (!data.groupId || !data.teacherId) return;
    const abgId = `${data.groupId}_${data.teacherId}`;
    try {
      await db.collection('assignmentsByGroup').doc(abgId).set({
        teacherId: data.teacherId,
        teacherName: data.teacherName || '',
        groupId: data.groupId,
        groupName: data.groupName || '',
        subjectId: data.subjectId || '',
        subjectName: data.subjectName || '',
        turno: data.turno || '',
        grado: data.grado || '',
      }, { merge: true });
    } catch (e) {
      console.warn('No se pudo sincronizar assignmentsByGroup:', e.message);
    }
  };

  const _deleteAssignmentByGroup = async (data) => {
    if (!data.groupId || !data.teacherId) return;
    const abgId = `${data.groupId}_${data.teacherId}`;
    try {
      await db.collection('assignmentsByGroup').doc(abgId).delete();
    } catch (e) {
      console.warn('No se pudo borrar assignmentsByGroup:', e.message);
    }
  };

  const deleteAssignment = (assignment) => {
    const message = `
      <p>Está a punto de eliminar la asignación:</p>
      <p><strong>${S(Utils.displayName(assignment.teacherName))}</strong> &rarr; ${S(assignment.subjectName)} (${S(assignment.groupName)})</p>
      <div class="alert alert-danger">Esta acción es irreversible.</div>`;

    Modal.confirmTyped('Eliminar Asignación', message, 'ELIMINAR', async () => {
      try {
        await DB.audit('eliminar', 'asignación', assignment.id, {
          description: `Asignación eliminada: ${assignment.teacherName} → ${assignment.subjectName} (${assignment.groupName})`,
          before: { teacherName: assignment.teacherName, subjectName: assignment.subjectName, groupName: assignment.groupName }
        });
        await db.collection('assignments').doc(assignment.id).delete();
        // También eliminar el par en assignmentsByGroup
        await _deleteAssignmentByGroup(assignment);
        Toast.show('Asignación eliminada', 'success');
        await invalidateAndReload('assignments');
      } catch (err) {
        console.error('Error deleting assignment:', err);
        Toast.show('Error al eliminar asignación', 'error');
      }
    });
  };

  // ── Tab: Docentes ─────────────────────────────────────────────

  const renderTeachersTab = () => {
    const q = state.searchQuery.toLowerCase();
    let filtered = state.teachers.filter(t =>
      (t.nombre || '').toLowerCase().includes(q) ||
      (t.turno || '').toLowerCase().includes(q)
    );

    // Filter by turno
    if (state.filterTurno !== 'all') {
      filtered = filtered.filter(t => t.turno === state.filterTurno);
    }

    // Sort by nombre
    filtered.sort((a, b) => {
      const cmp = (a.nombre || '').localeCompare(b.nombre || '');
      return state.sortOrder === 'asc' ? cmp : -cmp;
    });

    const countByTurno = (turno) => state.teachers.filter(t => t.turno === turno).length;

    return `
      <div class="stats-grid">
        <div class="stat-card--compact">
          <div class="stat-number">${state.teachers.length}</div>
          <div class="stat-label">Total Docentes</div>
        </div>
        ${K.TURNOS.map(turno => `
          <div class="stat-card--compact">
            <div class="stat-number">${countByTurno(turno)}</div>
            <div class="stat-label">${S(turno)}</div>
          </div>
        `).join('')}
        <div class="stat-card--compact">
          <div class="stat-number">${state.teachers.filter(t => t.turno === 'AMBOS').length}</div>
          <div class="stat-label">Ambos Turnos</div>
        </div>
      </div>

      <div class="card">
        <div class="filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <input type="text" id="teacherSearch"
                     placeholder="Buscar docente por nombre o turno..."
                     value="${S(state.searchQuery)}">
            </div>
            <div class="form-group">
              <select id="teacherTurnoFilter">
                <option value="all" ${state.filterTurno === 'all' ? 'selected' : ''}>Todos los turnos</option>
                ${K.TURNOS.map(t => `
                  <option value="${t}" ${state.filterTurno === t ? 'selected' : ''}>${S(t)}</option>
                `).join('')}
                <option value="AMBOS" ${state.filterTurno === 'AMBOS' ? 'selected' : ''}>AMBOS</option>
              </select>
            </div>
            <div class="form-group">
              <button class="btn btn-outline btn-sm" data-action="toggle-sort">
                Orden: ${state.sortOrder === 'asc' ? 'A-Z' : 'Z-A'}
              </button>
            </div>
            <div class="form-group">
              <button class="btn btn-primary btn-sm" data-action="new-teacher">+ Nuevo Docente</button>
            </div>
          </div>
        </div>

        ${filtered.length > 0 ? `
          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Turno</th>
                  <th>Especialidad</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(t => `
                  <tr>
                    <td><strong>${S(Utils.displayName(t.nombre)) || 'N/A'}</strong></td>
                    <td>${turnoBadge(t.turno)}</td>
                    <td>${S(t.especialidad) || '-'}</td>
                    <td><span class="badge badge-success">${S(t.status) || 'N/A'}</span></td>
                    <td>
                      <button class="btn btn-sm btn-warning" data-action="edit-teacher" data-id="${S(t.id)}">Editar</button>
                      <button class="btn btn-sm btn-danger" data-action="delete-teacher" data-id="${S(t.id)}">Eliminar</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state">
            <div class="empty-state-icon">&#128270;</div>
            <div class="empty-state-text">No se encontraron docentes</div>
          </div>
        `}
      </div>
    `;
  };

  // ── Tab: Grupos ───────────────────────────────────────────────

  const renderGruposTab = () => {
    const groupsByTurno = {};
    K.TURNOS.forEach(turno => {
      groupsByTurno[turno] = state.groups
        .filter(g => g.turno === turno)
        .sort((a, b) => a.grado - b.grado || (a.nombre || '').localeCompare(b.nombre || ''));
    });

    return `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;gap:20px;align-items:center;">
          <span class="font-semibold" style="font-size:var(--font-size-lg);">${state.groups.length} grupos</span>
          ${K.GRADOS.map(g => `<span class="badge" style="font-size:13px;">${state.groups.filter(gr => gr.grado === g).length} de ${g}\u00ba</span>`).join('')}
        </div>
      </div>

      ${K.TURNOS.map(turno => {
        const grupos = groupsByTurno[turno];
        if (!grupos || grupos.length === 0) return '';
        return `
          <div class="card" style="margin-bottom:12px;">
            <h3 class="section-title">${S(turno)}</h3>
            <div class="table-container">
              <table class="table-light" style="font-size:13px;">
                <thead><tr>
                  <th style="width:70px;">Grupo</th>
                  <th style="width:60px;">Grado</th>
                  <th>Orientador(a)</th>
                  <th style="width:100px;text-align:center;">Acci\u00f3n</th>
                </tr></thead>
                <tbody>
                  ${grupos.map(g => {
                    const hasOrientador = g.orientador && g.orientador.trim();
                    return `<tr>
                      <td class="font-semibold">${S(g.nombre)}</td>
                      <td>${g.grado}\u00ba</td>
                      <td>${hasOrientador
                        ? `<span class="font-semibold" style="color:var(--color-primary);">${S(g.orientador)}</span>`
                        : '<span style="color:var(--color-danger);font-weight:600;">Sin asignar</span>'}</td>
                      <td style="text-align:center;">
                        <button class="btn btn-sm ${hasOrientador ? 'btn-outline' : 'btn-warning'}" data-action="assign-orientador" data-id="${S(g.id)}" style="font-size:11px;">
                          ${hasOrientador ? 'Cambiar' : 'Asignar'}
                        </button>
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('')}
    `;
  };

  // ── Tab: Materias ─────────────────────────────────────────────

  const renderMateriasTab = () => {
    const subjectsByGrado = {};
    K.GRADOS.forEach(g => {
      subjectsByGrado[g] = state.subjects
        .filter(s => s.grado === g)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    });

    // Build map: subjectId -> { turno -> [{teacherName, groupName, id, isDuplicate}] }
    // Detecta duplicados: dos o más asignaciones para el mismo (subject + group).
    // Eso ocurre cuando un script viejo creó un doc con id teacherX_group_subject
    // y luego se "editó" para cambiar el docente — el doc se queda en su id viejo
    // y un fix posterior crea un segundo doc con id teacherY_group_subject.
    const dupKey = a => `${a.subjectId}__${a.groupId}`;
    const dupCount = {};
    state.assignments.forEach(a => {
      const k = dupKey(a);
      dupCount[k] = (dupCount[k] || 0) + 1;
    });

    const teachersBySubject = {};
    state.assignments.forEach(a => {
      if (!teachersBySubject[a.subjectId]) teachersBySubject[a.subjectId] = {};
      const turno = a.turno || 'SIN TURNO';
      if (state.materiasFilterTurno !== 'all' && turno !== state.materiasFilterTurno) return;
      if (!teachersBySubject[a.subjectId][turno]) teachersBySubject[a.subjectId][turno] = [];
      const exists = teachersBySubject[a.subjectId][turno].some(x => x.teacherName === a.teacherName && x.groupName === a.groupName && x.id === a.id);
      if (!exists) {
        teachersBySubject[a.subjectId][turno].push({
          id: a.id,
          teacherName: a.teacherName || 'Sin asignar',
          groupName: a.groupName || a.groupId || '',
          isDuplicate: dupCount[dupKey(a)] > 1
        });
      }
    });

    const totalDuplicates = Object.values(dupCount).filter(n => n > 1).reduce((s, n) => s + n, 0);

    return `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;gap:20px;align-items:center;">
            <span class="font-semibold" style="font-size:var(--font-size-lg);">${state.subjects.length} materias</span>
            ${K.GRADOS.map(g => `<span class="badge" style="font-size:13px;">${subjectsByGrado[g].length} de ${g}&#176;</span>`).join('')}
          </div>
          <select id="materiasFilterTurno" style="min-width:160px;">
            <option value="all" ${state.materiasFilterTurno === 'all' ? 'selected' : ''}>Todos los turnos</option>
            ${K.TURNOS.map(t => `<option value="${t}" ${state.materiasFilterTurno === t ? 'selected' : ''}>${S(t)}</option>`).join('')}
          </select>
        </div>
        ${totalDuplicates > 0 ? `
          <div style="margin-top:12px;padding:10px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;font-size:13px;color:#991b1b;">
            <strong>⚠ ${totalDuplicates} asignaciones duplicadas detectadas.</strong>
            Una clase (misma materia + mismo grupo) está asignada a más de un docente. Revisa las filas marcadas
            <span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;font-size:9px;font-weight:700;">DUPLICADO</span>
            y elimina las que no correspondan con el ícono 🗑️.
          </div>
        ` : ''}
      </div>

      ${K.GRADOS.map(grado => {
        const subjects = subjectsByGrado[grado];
        if (subjects.length === 0) return '';

        const rows = subjects.map((s, i) => {
          const assigned = teachersBySubject[s.id] || {};
          const turnos = Object.keys(assigned).sort();
          const docentesHtml = turnos.length > 0
            ? turnos.map(t => {
                const teachers = assigned[t];
                return teachers.map(tc => {
                  const dupBadge = tc.isDuplicate
                    ? '<span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;font-size:9px;font-weight:700;letter-spacing:0.3px;">DUPLICADO</span>'
                    : '';
                  const rowBg = tc.isDuplicate ? 'background:rgba(254,226,226,0.4);border-radius:4px;padding:2px 6px;' : '';
                  return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;${rowBg}">
                    <span class="font-semibold" style="font-size:12px;">${S(Utils.displayName(tc.teacherName))}</span>
                    <span class="badge ${t === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino'}" style="font-size:10px;">${S(t).substring(0,3)}</span>
                    <span class="text-muted" style="font-size:11px;">${S(tc.groupName)}</span>
                    ${dupBadge}
                    <button class="btn btn-sm" data-action="edit-assignment" data-id="${S(tc.id)}" title="Editar esta asignación" style="padding:2px 6px;font-size:11px;background:transparent;color:#3182ce;border:none;cursor:pointer;">
                      <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit</span>
                    </button>
                    <button class="btn btn-sm" data-action="delete-assignment" data-id="${S(tc.id)}" title="Eliminar esta asignación" style="padding:2px 6px;font-size:11px;background:transparent;color:#dc2626;border:none;cursor:pointer;">
                      <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">delete</span>
                    </button>
                  </div>`;
                }).join('');
              }).join('')
            : '<span class="text-muted" style="font-size:12px;">Sin asignar</span>';

          return `<tr>
            <td style="text-align:center;color:var(--color-text-lighter);width:30px;">${i + 1}</td>
            <td class="font-semibold" style="font-size:13px;">${S(K.getUACNombre(s.nombre))}</td>
            <td>${docentesHtml}</td>
          </tr>`;
        }).join('');

        return `
          <div class="card" style="margin-bottom:12px;">
            <h3 class="section-title">${grado}&#176; Grado <span class="text-muted" style="font-weight:400;font-size:14px;">(${subjects.length} materias)</span></h3>
            <div class="table-container">
              <table class="table-light" style="font-size:13px;">
                <thead><tr>
                  <th style="width:30px;">#</th>
                  <th style="width:40%;">Materia</th>
                  <th>Docentes asignados</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>`;
      }).join('')}
    `;
  };

  // ─────────────────────────────────────────────────────────────────
  // ── Tab: Asignaciones (flujo guiado para subdirector) ──────────
  // ─────────────────────────────────────────────────────────────────
  // Pensado para que el subdirector, sin conocer el sistema, pueda hacer
  // las 3 operaciones más comunes con confianza:
  //   1. Cambiar el maestro de una clase
  //   2. Llenar una clase vacante
  //   3. Quitar una clase a un maestro
  // Cada acción abre un wizard de 2-3 pasos con confirmación final y opción
  // de deshacer en los 15s siguientes. Los duplicados y vacantes aparecen
  // como banner para que sean visibles sin que el usuario tenga que
  // buscar problemas.

  const _normalizeSearch = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const renderAsignacionesTab = () => {
    // Detección automática de problemas
    const dupKey = a => `${a.subjectId}__${a.groupId}`;
    const dupCount = {};
    state.assignments.forEach(a => { dupCount[dupKey(a)] = (dupCount[dupKey(a)] || 0) + 1; });
    const duplicateAssignments = state.assignments.filter(a => dupCount[dupKey(a)] > 1);

    // Vacantes: (subject, group) sin asignación
    const asignados = new Set(state.assignments.map(a => `${a.subjectId}__${a.groupId}`));
    const vacantes = [];
    state.groups.forEach(g => {
      const subjectsOfGrado = state.subjects.filter(s => String(s.grado) === String(g.grado));
      subjectsOfGrado.forEach(s => {
        const key = `${s.id}__${g.id}`;
        if (!asignados.has(key)) vacantes.push({ group: g, subject: s });
      });
    });

    return `
      <!-- Encabezado guiado: la pregunta directa -->
      <div class="card" style="margin-bottom:16px;padding:24px;background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);">
        <h2 style="margin:0 0 6px 0;font-size:20px;color:#1e3a8a;">¿Qué necesitas hacer?</h2>
        <p style="margin:0 0 18px 0;font-size:13px;color:#475569;">Elige una acción y te guío paso a paso. Antes de cualquier cambio se confirma; siempre se puede deshacer.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn btn-primary" data-action="wizard-cambiar" style="flex:1;min-width:220px;padding:18px;font-size:15px;text-align:left;display:flex;align-items:center;gap:12px;">
            <span class="material-icons-round" style="font-size:32px;">swap_horiz</span>
            <span style="display:flex;flex-direction:column;align-items:flex-start;">
              <strong>Cambiar maestro de una clase</strong>
              <span style="font-size:11px;font-weight:400;opacity:0.85;">El maestro de un grupo cambió</span>
            </span>
          </button>
          <button class="btn btn-success" data-action="wizard-llenar" style="flex:1;min-width:220px;padding:18px;font-size:15px;text-align:left;display:flex;align-items:center;gap:12px;background:#16a34a;">
            <span class="material-icons-round" style="font-size:32px;">add_circle</span>
            <span style="display:flex;flex-direction:column;align-items:flex-start;">
              <strong>Llenar una clase vacante</strong>
              <span style="font-size:11px;font-weight:400;opacity:0.85;">${vacantes.length} clases sin maestro</span>
            </span>
          </button>
          <button class="btn btn-warning" data-action="wizard-quitar" style="flex:1;min-width:220px;padding:18px;font-size:15px;text-align:left;display:flex;align-items:center;gap:12px;background:#dc2626;color:#fff;">
            <span class="material-icons-round" style="font-size:32px;">remove_circle</span>
            <span style="display:flex;flex-direction:column;align-items:flex-start;">
              <strong>Quitar una clase a un maestro</strong>
              <span style="font-size:11px;font-weight:400;opacity:0.85;">La clase queda vacante</span>
            </span>
          </button>
        </div>
      </div>

      <!-- Banner de problemas detectados -->
      ${(duplicateAssignments.length > 0 || vacantes.length > 0) ? `
        <div class="card" style="margin-bottom:16px;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;">
          <h3 style="margin:0 0 10px 0;font-size:15px;color:#991b1b;">⚠ Problemas detectados</h3>
          ${duplicateAssignments.length > 0 ? `
            <div style="margin-bottom:10px;font-size:13px;color:#7f1d1d;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
              <span><strong>${duplicateAssignments.length} clases tienen dos maestros asignados.</strong> Lo correcto es uno por clase.</span>
              <button class="btn btn-sm btn-danger" data-action="ver-duplicados" style="white-space:nowrap;">Revisar y limpiar</button>
            </div>
          ` : ''}
          ${vacantes.length > 0 ? `
            <div style="font-size:13px;color:#7f1d1d;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
              <span><strong>${vacantes.length} clases no tienen maestro asignado.</strong></span>
              <button class="btn btn-sm" data-action="wizard-llenar" style="background:#16a34a;color:#fff;white-space:nowrap;">Llenar vacantes</button>
            </div>
          ` : ''}
        </div>
      ` : `
        <div class="card" style="margin-bottom:16px;padding:14px;background:#dcfce7;border-left:4px solid #16a34a;font-size:13px;color:#14532d;">
          ✓ Todas las clases tienen un maestro y no hay duplicados. La carga académica está limpia.
        </div>
      `}

      <!-- Vista informativa por grupo / por maestro -->
      <div class="card">
        <h3 style="margin:0 0 12px 0;font-size:15px;color:#1e3a8a;">Vista general (sólo informativa)</h3>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap;">
          <label style="font-size:13px;color:#475569;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="radio" name="asg_view" value="grupo" ${(state.asgViewMode || 'grupo') === 'grupo' ? 'checked' : ''}> Ver por grupo
          </label>
          <label style="font-size:13px;color:#475569;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="radio" name="asg_view" value="maestro" ${state.asgViewMode === 'maestro' ? 'checked' : ''}> Ver por maestro
          </label>
        </div>
        <div id="asg_view_content"></div>
      </div>
    `;
  };

  // ─── Wizards ────────────────────────────────────────────────────

  // Estado de toast con deshacer
  let _undoTimer = null;
  const _showUndoToast = (msg, undoFn) => {
    const toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:14px 20px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.2);z-index:10000;display:flex;align-items:center;gap:14px;font-size:14px;max-width:600px;';
    toastEl.innerHTML = `<span>${S(msg)}</span><button id="undo-btn" style="background:#fff;color:#16a34a;border:none;padding:6px 14px;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">↶ Deshacer (15s)</button>`;
    document.body.appendChild(toastEl);

    let secondsLeft = 15;
    const btn = toastEl.querySelector('#undo-btn');
    const tick = setInterval(() => {
      secondsLeft--;
      if (btn) btn.textContent = `↶ Deshacer (${secondsLeft}s)`;
      if (secondsLeft <= 0) { clearInterval(tick); toastEl.remove(); }
    }, 1000);

    btn.addEventListener('click', async () => {
      clearInterval(tick);
      btn.disabled = true;
      btn.textContent = 'Deshaciendo…';
      try {
        await undoFn();
        toastEl.style.background = '#3182ce';
        toastEl.innerHTML = '<span>↶ Cambio deshecho</span>';
        setTimeout(() => toastEl.remove(), 2000);
        await invalidateAndReload('assignments');
      } catch (e) {
        toastEl.style.background = '#dc2626';
        toastEl.innerHTML = `<span>No se pudo deshacer: ${S(e.message)}</span>`;
        setTimeout(() => toastEl.remove(), 4000);
      }
    });
  };

  // Construye combobox buscable inline (devuelve HTML). Sirve para wizards.
  const _comboHtml = ({ id, placeholder, items, valueKey = 'id', labelKey = 'label', subKey = 'sub', searchKey = 'search' }) => {
    return `
      <div class="wiz-combo" style="position:relative;">
        <input type="text" id="${id}_search" autocomplete="off" placeholder="${S(placeholder)}"
          style="width:100%;padding:10px 12px;border:1px solid var(--color-border);border-radius:6px;font-size:14px;">
        <input type="hidden" id="${id}" value="">
        <div id="${id}_list" style="position:absolute;top:calc(100% + 2px);left:0;right:0;max-height:320px;overflow-y:auto;background:#fff;border:1px solid #cbd5e0;border-radius:6px;display:none;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.12);">
          ${items.map(it => `
            <div class="wiz-combo-item" data-value="${S(it[valueKey])}" data-label="${S(it[labelKey])}" data-search="${S(it[searchKey])}" style="padding:10px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;line-height:1.4;">
              <div style="font-weight:600;color:#1e293b;">${S(it[labelKey])}</div>
              ${it[subKey] ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${S(it[subKey])}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>`;
  };

  const _wireCombo = (id, onPick) => {
    const inp = document.getElementById(id + '_search');
    const hid = document.getElementById(id);
    const list = document.getElementById(id + '_list');
    if (!inp || !list) return;
    const filter = () => {
      const q = _normalizeSearch(inp.value).trim();
      let visible = 0;
      list.querySelectorAll('.wiz-combo-item').forEach(el => {
        const m = !q || el.dataset.search.indexOf(q) !== -1;
        el.style.display = m ? '' : 'none';
        if (m) visible++;
      });
      list.style.display = visible > 0 ? 'block' : 'none';
    };
    inp.addEventListener('focus', () => { list.style.display = 'block'; filter(); });
    inp.addEventListener('input', () => { hid.value = ''; if (onPick) onPick(null); filter(); });
    inp.addEventListener('blur', () => { setTimeout(() => { list.style.display = 'none'; }, 180); });
    list.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.wiz-combo-item');
      if (!el) return;
      hid.value = el.dataset.value;
      inp.value = el.dataset.label;
      list.style.display = 'none';
      if (onPick) onPick(el.dataset.value);
    });
    list.addEventListener('mouseover', (e) => { const el = e.target.closest('.wiz-combo-item'); if (el) el.style.background = '#eff6ff'; });
    list.addEventListener('mouseout', (e) => { const el = e.target.closest('.wiz-combo-item'); if (el) el.style.background = ''; });
  };

  // Items para combobox de "una clase" (asignación existente)
  const _classItems = () => {
    return state.assignments.map(a => ({
      id: a.id,
      label: `${K.getUACNombre(a.subjectName)} — ${a.groupName} ${a.turno || ''}`,
      sub: `Actualmente: ${Utils.displayName(a.teacherName)}`,
      search: _normalizeSearch(`${a.subjectName} ${a.groupName} ${a.turno} ${a.teacherName}`)
    }));
  };

  // Items para combobox de teachers
  const _teacherItems = () => {
    return state.teachers.map(t => ({
      id: t.id,
      label: Utils.displayName(t.nombre),
      sub: `Turno: ${t.turno}${t.especialidad ? ' · ' + t.especialidad : ''}`,
      search: _normalizeSearch(`${t.nombre} ${t.turno}`)
    }));
  };

  // Items para combobox de vacantes
  const _vacanteItems = () => {
    const asignados = new Set(state.assignments.map(a => `${a.subjectId}__${a.groupId}`));
    const out = [];
    state.groups.forEach(g => {
      const subjs = state.subjects.filter(s => String(s.grado) === String(g.grado));
      subjs.forEach(s => {
        if (!asignados.has(`${s.id}__${g.id}`)) {
          out.push({
            id: `${s.id}__${g.id}`,
            label: `${K.getUACNombre(s.nombre)} — ${g.nombre} ${g.turno}`,
            sub: `Sin maestro asignado`,
            search: _normalizeSearch(`${s.nombre} ${g.nombre} ${g.turno}`),
            _subject: s,
            _group: g
          });
        }
      });
    });
    return out;
  };

  // Wizard "Cambiar maestro de una clase"
  const _wizardCambiarMaestro = () => {
    const items = _classItems();
    if (items.length === 0) {
      Toast.show('No hay clases asignadas todavía. Usa "Llenar una vacante" primero.', 'warning');
      return;
    }
    const body = `
      <div style="margin-bottom:14px;font-size:13px;color:#475569;line-height:1.5;">
        <strong>Paso 1 de 2:</strong> Busca la clase cuyo maestro vas a cambiar.<br>
        <span style="color:#94a3b8;font-size:12px;">Tip: puedes buscar por materia, grupo, turno o el nombre del maestro actual.</span>
      </div>
      <div class="form-group">
        <label style="font-weight:600;">Clase a modificar</label>
        ${_comboHtml({ id: 'wz_class', placeholder: 'Ej: ingles 2-1 vespertino', items })}
      </div>
      <div id="wz_step2" style="display:none;margin-top:18px;padding-top:18px;border-top:1px solid #e2e8f0;">
        <div style="margin-bottom:14px;font-size:13px;color:#475569;">
          <strong>Paso 2 de 2:</strong> ¿Quién va a impartir esta clase ahora?
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Nuevo maestro</label>
          ${_comboHtml({ id: 'wz_teacher', placeholder: 'Escribe nombre o apellido del maestro…', items: _teacherItems() })}
        </div>
      </div>
      <div id="wz_summary" style="display:none;margin-top:18px;padding:14px;background:#fefce8;border-left:4px solid #ca8a04;border-radius:4px;font-size:14px;color:#713f12;"></div>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="wz-confirm" id="wz_confirmBtn" disabled>Confirmar cambio</button>
    `;
    Modal.open('Cambiar maestro de una clase', body, footer);

    let selectedAssignment = null;
    let selectedTeacher = null;

    _wireCombo('wz_class', (asgId) => {
      selectedAssignment = asgId ? state.assignments.find(a => a.id === asgId) : null;
      document.getElementById('wz_step2').style.display = selectedAssignment ? 'block' : 'none';
      _updateSummary();
    });
    _wireCombo('wz_teacher', (tId) => {
      selectedTeacher = tId ? state.teachers.find(t => t.id === tId) : null;
      _updateSummary();
    });

    function _updateSummary() {
      const sumEl = document.getElementById('wz_summary');
      const btn = document.getElementById('wz_confirmBtn');
      if (selectedAssignment && selectedTeacher) {
        // Validación: no puede asignarse al mismo
        if (selectedTeacher.id === selectedAssignment.teacherId) {
          sumEl.style.display = 'block';
          sumEl.style.background = '#fee2e2';
          sumEl.style.borderLeftColor = '#dc2626';
          sumEl.style.color = '#7f1d1d';
          sumEl.innerHTML = `⚠ <strong>${Utils.displayName(selectedTeacher.nombre)}</strong> ya es el maestro actual de esta clase. Elige a alguien diferente.`;
          btn.disabled = true;
          return;
        }
        // Aviso si turno no coincide
        const turnoWarn = (selectedTeacher.turno !== 'AMBOS' && selectedAssignment.turno && selectedTeacher.turno !== selectedAssignment.turno)
          ? `<div style="margin-top:8px;padding:8px;background:#fff;border:1px solid #f59e0b;border-radius:4px;font-size:12px;color:#92400e;">⚠ El maestro es del turno <strong>${selectedTeacher.turno}</strong> pero la clase es <strong>${selectedAssignment.turno}</strong>. Puedes continuar si es una cobertura intencional.</div>`
          : '';
        sumEl.style.display = 'block';
        sumEl.style.background = '#fefce8';
        sumEl.style.borderLeftColor = '#ca8a04';
        sumEl.style.color = '#713f12';
        sumEl.innerHTML = `
          Vas a cambiar:<br>
          <strong>${S(K.getUACNombre(selectedAssignment.subjectName))}</strong> en <strong>${S(selectedAssignment.groupName)} ${S(selectedAssignment.turno || '')}</strong><br>
          De: <strong>${S(Utils.displayName(selectedAssignment.teacherName))}</strong><br>
          A: <strong>${S(Utils.displayName(selectedTeacher.nombre))}</strong>
          ${turnoWarn}
        `;
        btn.disabled = false;
      } else {
        sumEl.style.display = 'none';
        btn.disabled = true;
      }
    }

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); return; }
      if (!e.target.closest('[data-action="wz-confirm"]')) return;
      if (!selectedAssignment || !selectedTeacher) return;

      const oldAsg = { ...selectedAssignment };
      const targetId = `${selectedTeacher.id}_${selectedAssignment.groupId}_${selectedAssignment.subjectId}`;
      const newData = {
        teacherId: selectedTeacher.id,
        teacherName: selectedTeacher.nombre,
        subjectId: selectedAssignment.subjectId,
        subjectName: selectedAssignment.subjectName,
        groupId: selectedAssignment.groupId,
        groupName: selectedAssignment.groupName,
        grado: selectedAssignment.grado,
        turno: selectedAssignment.turno
      };

      try {
        if (selectedAssignment.id === targetId) {
          await db.collection('assignments').doc(selectedAssignment.id).update(newData);
        } else {
          const batch = db.batch();
          batch.delete(db.collection('assignments').doc(selectedAssignment.id));
          batch.set(db.collection('assignments').doc(targetId), newData);
          await batch.commit();
        }
        DB.audit('editar', 'asignación', targetId, { description: `Cambio de docente: ${newData.subjectName} (${newData.groupName}) ${oldAsg.teacherName} → ${newData.teacherName}` });
        Modal.close();
        await invalidateAndReload('assignments');
        _showUndoToast(`✓ ${newData.teacherName} ahora imparte ${newData.subjectName} en ${newData.groupName}`, async () => {
          // Deshacer: borrar el nuevo, restaurar el viejo (con su id original)
          const batch = db.batch();
          batch.delete(db.collection('assignments').doc(targetId));
          batch.set(db.collection('assignments').doc(oldAsg.id), {
            teacherId: oldAsg.teacherId, teacherName: oldAsg.teacherName,
            subjectId: oldAsg.subjectId, subjectName: oldAsg.subjectName,
            groupId: oldAsg.groupId, groupName: oldAsg.groupName,
            grado: oldAsg.grado, turno: oldAsg.turno
          });
          await batch.commit();
          DB.audit('editar', 'asignación', oldAsg.id, { description: `Deshacer cambio: ${oldAsg.subjectName} (${oldAsg.groupName}) restaurado a ${oldAsg.teacherName}` });
        });
      } catch (err) {
        Toast.show('Error: ' + err.message, 'error');
      }
    });
  };

  // Wizard "Llenar una clase vacante"
  const _wizardLlenarVacante = () => {
    const items = _vacanteItems();
    if (items.length === 0) {
      Toast.show('¡Felicidades! No hay clases vacantes. Toda la carga está cubierta.', 'success');
      return;
    }
    const body = `
      <div style="margin-bottom:14px;font-size:13px;color:#475569;line-height:1.5;">
        <strong>Paso 1 de 2:</strong> Elige la clase vacante. Hay <strong>${items.length}</strong> sin maestro.
      </div>
      <div class="form-group">
        <label style="font-weight:600;">Clase vacante</label>
        ${_comboHtml({ id: 'wz_vac', placeholder: 'Busca por materia, grupo o turno…', items })}
      </div>
      <div id="wz_step2" style="display:none;margin-top:18px;padding-top:18px;border-top:1px solid #e2e8f0;">
        <div style="margin-bottom:14px;font-size:13px;color:#475569;">
          <strong>Paso 2 de 2:</strong> ¿Quién va a impartirla?
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Maestro</label>
          ${_comboHtml({ id: 'wz_teacher', placeholder: 'Escribe nombre o apellido…', items: _teacherItems() })}
        </div>
      </div>
      <div id="wz_summary" style="display:none;margin-top:18px;padding:14px;background:#dcfce7;border-left:4px solid #16a34a;border-radius:4px;font-size:14px;color:#14532d;"></div>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="wz-confirm" id="wz_confirmBtn" disabled>Asignar</button>
    `;
    Modal.open('Llenar una clase vacante', body, footer);

    let vacItem = null;
    let selectedTeacher = null;

    _wireCombo('wz_vac', (vId) => {
      vacItem = vId ? items.find(it => it.id === vId) : null;
      document.getElementById('wz_step2').style.display = vacItem ? 'block' : 'none';
      _updateSummary();
    });
    _wireCombo('wz_teacher', (tId) => {
      selectedTeacher = tId ? state.teachers.find(t => t.id === tId) : null;
      _updateSummary();
    });

    function _updateSummary() {
      const sumEl = document.getElementById('wz_summary');
      const btn = document.getElementById('wz_confirmBtn');
      if (vacItem && selectedTeacher) {
        const turnoWarn = (selectedTeacher.turno !== 'AMBOS' && vacItem._group.turno && selectedTeacher.turno !== vacItem._group.turno)
          ? `<div style="margin-top:8px;padding:8px;background:#fff;border:1px solid #f59e0b;border-radius:4px;font-size:12px;color:#92400e;">⚠ Maestro de turno <strong>${selectedTeacher.turno}</strong>, grupo de turno <strong>${vacItem._group.turno}</strong>. Puedes continuar si es intencional.</div>`
          : '';
        sumEl.style.display = 'block';
        sumEl.innerHTML = `
          Vas a asignar:<br>
          <strong>${S(Utils.displayName(selectedTeacher.nombre))}</strong><br>
          impartirá <strong>${S(K.getUACNombre(vacItem._subject.nombre))}</strong> en <strong>${S(vacItem._group.nombre)} ${S(vacItem._group.turno)}</strong>
          ${turnoWarn}
        `;
        btn.disabled = false;
      } else {
        sumEl.style.display = 'none';
        btn.disabled = true;
      }
    }

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); return; }
      if (!e.target.closest('[data-action="wz-confirm"]')) return;
      if (!vacItem || !selectedTeacher) return;

      const targetId = `${selectedTeacher.id}_${vacItem._group.id}_${vacItem._subject.id}`;
      const data = {
        teacherId: selectedTeacher.id,
        teacherName: selectedTeacher.nombre,
        subjectId: vacItem._subject.id,
        subjectName: vacItem._subject.nombre,
        groupId: vacItem._group.id,
        groupName: vacItem._group.nombre,
        grado: vacItem._group.grado,
        turno: vacItem._group.turno
      };

      try {
        await db.collection('assignments').doc(targetId).set(data);
        DB.audit('crear', 'asignación', targetId, { description: `Vacante llenada: ${data.teacherName} → ${data.subjectName} (${data.groupName})` });
        Modal.close();
        await invalidateAndReload('assignments');
        _showUndoToast(`✓ ${data.teacherName} asignado a ${data.subjectName} ${data.groupName}`, async () => {
          await db.collection('assignments').doc(targetId).delete();
          DB.audit('eliminar', 'asignación', targetId, { description: `Deshacer asignación: ${data.teacherName} ya no imparte ${data.subjectName} (${data.groupName})` });
        });
      } catch (err) {
        Toast.show('Error: ' + err.message, 'error');
      }
    });
  };

  // Wizard "Quitar una clase a un maestro"
  const _wizardQuitarClase = () => {
    const items = _classItems();
    if (items.length === 0) {
      Toast.show('No hay clases asignadas.', 'warning');
      return;
    }
    const body = `
      <div style="margin-bottom:14px;font-size:13px;color:#475569;line-height:1.5;">
        Elige la clase que vas a quitar. La clase queda vacante hasta que se asigne a otro maestro.
      </div>
      <div class="form-group">
        <label style="font-weight:600;">Clase</label>
        ${_comboHtml({ id: 'wz_class', placeholder: 'Busca por materia, grupo o maestro…', items })}
      </div>
      <div id="wz_summary" style="display:none;margin-top:18px;padding:14px;background:#fee2e2;border-left:4px solid #dc2626;border-radius:4px;font-size:14px;color:#7f1d1d;"></div>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-danger" data-action="wz-confirm" id="wz_confirmBtn" disabled>Quitar clase</button>
    `;
    Modal.open('Quitar una clase a un maestro', body, footer);

    let selectedAssignment = null;
    _wireCombo('wz_class', (asgId) => {
      selectedAssignment = asgId ? state.assignments.find(a => a.id === asgId) : null;
      const sumEl = document.getElementById('wz_summary');
      const btn = document.getElementById('wz_confirmBtn');
      if (selectedAssignment) {
        sumEl.style.display = 'block';
        sumEl.innerHTML = `
          Vas a quitar:<br>
          <strong>${S(Utils.displayName(selectedAssignment.teacherName))}</strong> dejará de impartir <strong>${S(K.getUACNombre(selectedAssignment.subjectName))}</strong> en <strong>${S(selectedAssignment.groupName)} ${S(selectedAssignment.turno || '')}</strong>.<br><br>
          La clase quedará vacante hasta que asignes a otro maestro.
        `;
        btn.disabled = false;
      } else {
        sumEl.style.display = 'none';
        btn.disabled = true;
      }
    });

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); return; }
      if (!e.target.closest('[data-action="wz-confirm"]')) return;
      if (!selectedAssignment) return;

      const oldAsg = { ...selectedAssignment };
      try {
        await db.collection('assignments').doc(selectedAssignment.id).delete();
        DB.audit('eliminar', 'asignación', selectedAssignment.id, { description: `Clase quitada: ${oldAsg.teacherName} ya no imparte ${oldAsg.subjectName} (${oldAsg.groupName})` });
        Modal.close();
        await invalidateAndReload('assignments');
        _showUndoToast(`✓ Quitada: ${oldAsg.teacherName} ya no imparte ${oldAsg.subjectName} ${oldAsg.groupName}`, async () => {
          await db.collection('assignments').doc(oldAsg.id).set({
            teacherId: oldAsg.teacherId, teacherName: oldAsg.teacherName,
            subjectId: oldAsg.subjectId, subjectName: oldAsg.subjectName,
            groupId: oldAsg.groupId, groupName: oldAsg.groupName,
            grado: oldAsg.grado, turno: oldAsg.turno
          });
          DB.audit('crear', 'asignación', oldAsg.id, { description: `Deshacer quitar: ${oldAsg.teacherName} vuelve a impartir ${oldAsg.subjectName} (${oldAsg.groupName})` });
        });
      } catch (err) {
        Toast.show('Error: ' + err.message, 'error');
      }
    });
  };

  // Renderer de la vista informativa "por grupo / por maestro"
  const _renderAsgInfoView = (mode) => {
    const container = document.getElementById('asg_view_content');
    if (!container) return;
    state.asgViewMode = mode;
    if (mode === 'maestro') {
      const options = state.teachers.map(t =>
        `<option value="${S(t.id)}">${S(Utils.displayName(t.nombre))} (${S(t.turno)})</option>`
      ).join('');
      container.innerHTML = `
        <select id="asg_view_teacher" style="width:100%;max-width:400px;padding:8px;border:1px solid var(--color-border);border-radius:6px;margin-bottom:12px;">
          <option value="">-- Elige un maestro --</option>
          ${options}
        </select>
        <div id="asg_view_result" style="font-size:13px;color:#475569;"></div>
      `;
      const sel = document.getElementById('asg_view_teacher');
      sel.addEventListener('change', () => {
        const tid = sel.value;
        if (!tid) { document.getElementById('asg_view_result').innerHTML = ''; return; }
        const asgs = state.assignments.filter(a => a.teacherId === tid);
        if (asgs.length === 0) {
          document.getElementById('asg_view_result').innerHTML = '<em>Este maestro no tiene clases asignadas.</em>';
          return;
        }
        document.getElementById('asg_view_result').innerHTML = `
          <strong>${asgs.length} clase(s):</strong>
          <ul style="margin:8px 0 0 18px;">
            ${asgs.map(a => `<li><strong>${S(K.getUACNombre(a.subjectName))}</strong> en ${S(a.groupName)} ${S(a.turno || '')}</li>`).join('')}
          </ul>
        `;
      });
    } else {
      // por grupo
      const options = state.groups
        .sort((a, b) => (a.turno || '').localeCompare(b.turno || '') || (a.nombre || '').localeCompare(b.nombre || ''))
        .map(g => `<option value="${S(g.id)}">${S(g.nombre)} (${S(g.turno)})</option>`).join('');
      container.innerHTML = `
        <select id="asg_view_group" style="width:100%;max-width:400px;padding:8px;border:1px solid var(--color-border);border-radius:6px;margin-bottom:12px;">
          <option value="">-- Elige un grupo --</option>
          ${options}
        </select>
        <div id="asg_view_result" style="font-size:13px;color:#475569;"></div>
      `;
      const sel = document.getElementById('asg_view_group');
      sel.addEventListener('change', () => {
        const gid = sel.value;
        if (!gid) { document.getElementById('asg_view_result').innerHTML = ''; return; }
        const group = state.groups.find(g => g.id === gid);
        if (!group) return;
        const subjs = state.subjects.filter(s => String(s.grado) === String(group.grado))
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        document.getElementById('asg_view_result').innerHTML = `
          <table class="table-light" style="width:100%;font-size:13px;">
            <thead><tr><th style="text-align:left;">Materia</th><th style="text-align:left;">Maestro</th></tr></thead>
            <tbody>
              ${subjs.map(s => {
                const a = state.assignments.find(x => x.subjectId === s.id && x.groupId === gid);
                return `<tr>
                  <td>${S(K.getUACNombre(s.nombre))}</td>
                  <td>${a ? `<strong>${S(Utils.displayName(a.teacherName))}</strong>` : '<em style="color:#dc2626;">SIN ASIGNAR</em>'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        `;
      });
    }
  };

  // ── Tab: Carga Académica (cuadrícula visual) ──────────────────

  const renderCargaTab = () => {
    const turno = state.assignmentFilterTurno === 'all' ? '' : state.assignmentFilterTurno;
    const grado = state.assignmentFilterGrado === 'all' ? '' : state.assignmentFilterGrado;

    // Filter controls
    let html = `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:space-between;">
          <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
            <div class="form-group" style="margin:0;">
              <label style="font-weight:600;">Turno</label>
              <select id="cargaTurno">
                <option value="">Selecciona turno</option>
                ${K.TURNOS.map(t => `<option value="${t}" ${turno === t ? 'selected' : ''}>${S(t)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label style="font-weight:600;">Grado</label>
              <select id="cargaGrado" ${!turno ? 'disabled' : ''}>
                <option value="">Selecciona grado</option>
                ${K.GRADOS.map(g => `<option value="${g}" ${String(grado) === String(g) ? 'selected' : ''}>${g}\u00ba</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" data-action="excel-carga-masiva" title="Descargar carga academica como Excel">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</span>
              Descargar Excel
            </button>
            <button class="btn btn-success" data-action="print-carga-masiva" title="Imprime la carga academica completa de ambos turnos">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>
              Imprimir
            </button>
          </div>
        </div>
      </div>`;

    if (!turno || !grado) {
      html += `<div class="empty-state"><span class="material-icons-round empty-state-icon">grid_on</span><p class="empty-state-text">Selecciona turno y grado para ver la cuadr\u00edcula de carga acad\u00e9mica</p></div>`;
      return html;
    }

    // Get groups and subjects for this turno+grado
    const groups = state.groups.filter(g => g.turno === turno && String(g.grado) === String(grado))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const subjects = state.subjects.filter(s => String(s.grado) === String(grado))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    if (groups.length === 0 || subjects.length === 0) {
      html += `<div class="empty-state"><span class="material-icons-round empty-state-icon">info</span><p class="empty-state-text">No hay grupos o materias para ${S(turno)} ${grado}\u00ba</p></div>`;
      return html;
    }

    // Build assignment lookup: subjectId_groupId -> assignment
    const asgMap = {};
    state.assignments.forEach(a => {
      const key = a.subjectId + '_' + a.groupId;
      asgMap[key] = a;
    });

    // Stats
    const totalCells = subjects.length * groups.length;
    const assigned = Object.keys(asgMap).filter(k => {
      const [sid, gid] = k.split('_');
      return subjects.some(s => s.id === sid) && groups.some(g => g.id === gid);
    }).length;
    const vacant = totalCells - assigned;

    // Teachers available for this turno
    const availableTeachers = state.teachers.filter(t => t.turno === turno || t.turno === 'AMBOS')
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    // Stats bar
    const pct = totalCells > 0 ? Math.round(assigned / totalCells * 100) : 0;
    html += `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span class="font-semibold">${assigned} de ${totalCells} asignaciones completas (${pct}%)</span>
          ${vacant > 0 ? `<span style="color:var(--color-danger);font-weight:600;">${vacant} vacantes</span>` : '<span style="color:var(--color-success);font-weight:600;">Carga completa</span>'}
        </div>
        <div class="progress-bar" style="height:10px;border-radius:5px;">
          <div class="progress-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--color-success)' : pct > 50 ? '#d69e2e' : 'var(--color-danger)'};border-radius:5px;"></div>
        </div>
      </div>`;

    // Grid table
    const headerCols = groups.map(g => `<th style="text-align:center;min-width:140px;font-size:13px;">${S(g.nombre)}</th>`).join('');

    const rows = subjects.map(sub => {
      const cells = groups.map(grp => {
        const key = sub.id + '_' + grp.id;
        const asg = asgMap[key];
        if (asg) {
          // Assigned — show teacher name, clickeable to change.
          // Display "Nombre Apellido1" (más reconocible que solo apellidos).
          const shortName = Utils.shortName(asg.teacherName || '');
          const fullDisplay = Utils.displayName(asg.teacherName || '');
          const isInterim = !!asg.interim;
          const cellBg = isInterim ? 'background:#fffbeb;' : '';
          const tagInterim = isInterim ? '<span title="Cobertura temporal" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d97706;margin-right:4px;vertical-align:middle;"></span>' : '';
          const titleText = isInterim ? `🟠 Cobertura: ${S(fullDisplay)} (clic para cambiar o reasignar)` : `Clic para cambiar: ${S(fullDisplay)}`;
          return `<td style="text-align:center;cursor:pointer;padding:6px 4px;${cellBg}" data-action="assign-cell" data-subject-id="${sub.id}" data-subject-name="${S(sub.nombre)}" data-group-id="${grp.id}" data-group-name="${S(grp.nombre)}" data-grado="${grado}" data-turno="${turno}" data-asg-id="${asg.id}" title="${titleText}">
            ${tagInterim}<span style="font-size:11px;font-weight:600;color:${isInterim ? '#92400e' : 'var(--color-primary)'};">${S(shortName)}</span>
          </td>`;
        } else {
          // Vacant — red + button
          return `<td style="text-align:center;cursor:pointer;background:rgba(229,62,62,0.06);padding:6px 4px;" data-action="assign-cell" data-subject-id="${sub.id}" data-subject-name="${S(sub.nombre)}" data-group-id="${grp.id}" data-group-name="${S(grp.nombre)}" data-grado="${grado}" data-turno="${turno}" data-asg-id="" title="Clic para asignar">
            <span style="font-size:18px;color:var(--color-danger);opacity:0.4;">+</span>
          </td>`;
        }
      }).join('');

      return `<tr>
        <td class="font-semibold" style="font-size:12px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;" title="${S(K.getUACNombre(sub.nombre))}">${S(K.getUACNombre(sub.nombre))}</td>
        ${cells}
      </tr>`;
    }).join('');

    html += `
      <div class="card">
        <div class="table-container" style="overflow-x:auto;">
          <table class="table-light" style="font-size:13px;">
            <thead><tr>
              <th style="min-width:200px;">Materia</th>
              ${headerCols}
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    // Hidden select template for inline assignment
    html += `
      <div id="carga-select-tpl" style="display:none;">
        <select id="carga-teacher-select" style="font-size:11px;width:130px;padding:2px;">
          <option value="">-- Elegir --</option>
          <option value="__remove__" style="color:var(--color-danger);">Quitar asignaci\u00f3n</option>
          ${availableTeachers.map(t => `<option value="${t.id}" data-name="${S(t.nombre)}">${S(Utils.displayName(t.nombre))}</option>`).join('')}
        </select>
      </div>`;

    return html;
  };

  // Handle inline assignment from grid cell click
  const _handleCellAssign = async (cell) => {
    const subjectId = cell.dataset.subjectId;
    const subjectName = cell.dataset.subjectName;
    const groupId = cell.dataset.groupId;
    const groupName = cell.dataset.groupName;
    // dataset siempre devuelve string — convertir grado a Number para que las
    // assignments siempre tengan el tipo correcto (evita el bug de "dos terceros"
    // en dropdowns que dedupean por valor).
    const gradoRaw = cell.dataset.grado;
    const gradoNum = Number(gradoRaw);
    const grado = Number.isFinite(gradoNum) && gradoNum > 0 ? gradoNum : gradoRaw;
    const turno = cell.dataset.turno;
    const existingAsgId = cell.dataset.asgId;

    // Clone select template into cell
    const tpl = document.getElementById('carga-select-tpl');
    if (!tpl) return;
    const select = tpl.querySelector('select').cloneNode(true);
    select.id = '';
    select.style.display = '';

    // Pre-select current teacher if exists
    if (existingAsgId) {
      const asg = state.assignments.find(a => a.id === existingAsgId);
      if (asg) {
        for (const opt of select.options) {
          if (opt.value === asg.teacherId) { opt.selected = true; break; }
        }
      }
    }

    cell.innerHTML = '';
    cell.appendChild(select);
    select.focus();

    const cleanup = async () => {
      select.removeEventListener('change', onChange);
      select.removeEventListener('blur', onBlur);
    };

    const onChange = async () => {
      const teacherId = select.value;
      await cleanup();

      if (!teacherId) { render(); return; }

      if (teacherId === '__remove__' && existingAsgId) {
        // Remove assignment
        try {
          await db.collection('assignments').doc(existingAsgId).delete();
          DB.audit('eliminar', 'asignación', existingAsgId, { description: `Asignaci\u00f3n eliminada: ${subjectName} (${groupName})` });
          Toast.show('Asignaci\u00f3n eliminada', 'info');
          await invalidateAndReload('assignments');
        } catch (e) { Toast.show('Error: ' + e.message, 'error'); render(); }
        return;
      }

      if (teacherId === '__remove__') { render(); return; }

      const teacherName = select.options[select.selectedIndex]?.getAttribute('data-name') || '';

      const data = { teacherId, teacherName, subjectId, subjectName, groupId, groupName, grado, turno };

      // ID deterministico — siempre teacherId_groupId_subjectId, lo requieren
      // las rules para validar permisos de maestro. Si cambia el docente, el
      // doc id cambia; hay que borrar el viejo + crear el nuevo (no solo
      // update) para no dejar un doc huerfano que aparezca como duplicado.
      const targetId = `${data.teacherId}_${data.groupId}_${data.subjectId}`;

      try {
        if (existingAsgId && existingAsgId === targetId) {
          await db.collection('assignments').doc(existingAsgId).update(data);
          DB.audit('editar', 'asignación', existingAsgId, { description: `Asignaci\u00f3n actualizada: ${teacherName} \u2192 ${subjectName} (${groupName})` });
          Toast.show('Asignaci\u00f3n actualizada', 'success');
        } else if (existingAsgId) {
          // Cambió el docente — borrar doc viejo + crear nuevo con id correcto
          const batch = db.batch();
          batch.delete(db.collection('assignments').doc(existingAsgId));
          batch.set(db.collection('assignments').doc(targetId), data);
          await batch.commit();
          DB.audit('editar', 'asignación', targetId, { description: `Cambio de docente: ${subjectName} (${groupName}) \u2192 ${teacherName}`, extra: { oldId: existingAsgId } });
          Toast.show('Docente cambiado', 'success');
        } else {
          await db.collection('assignments').doc(targetId).set(data);
          DB.audit('crear', 'asignación', targetId, { description: `Asignaci\u00f3n creada: ${teacherName} \u2192 ${subjectName} (${groupName})` });
          Toast.show('Asignaci\u00f3n creada', 'success');
        }
        await invalidateAndReload('assignments');
      } catch (e) {
        Toast.show('Error: ' + e.message, 'error');
        render();
      }
    };

    const onBlur = () => { setTimeout(() => { if (document.activeElement !== select) render(); }, 200); };

    select.addEventListener('change', onChange);
    select.addEventListener('blur', onBlur);
  };


  // ── Descarga Excel de Carga Academica (ambos turnos, por grado) ──
  // Genera un .xlsx real (no HTML→.xls) usando XlsxWorker. Estructura:
  // 8 hojas — 6 matrices (turno × grado) con materia en filas y grupos en
  // columnas, + 2 hojas consolidadas (una por turno) con todas las clases
  // listadas como filas.

  const downloadCargaExcel = async () => {
    if (!state.groups.length || !state.subjects.length) {
      Toast.show('Espera a que carguen los datos', 'warning');
      return;
    }
    Toast.show('Generando Excel…', 'info');

    const asgMap = {};
    state.assignments.forEach(a => { asgMap[a.subjectId + '_' + a.groupId] = a; });

    const today = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    const sheets = [];

    // 6 HOJAS POR (TURNO × GRADO) — matriz materia × grupos
    for (const turno of K.TURNOS) {
      for (const grado of K.GRADOS) {
        const gruposGrado = state.groups
          .filter(g => g.turno === turno && Number(g.grado) === Number(grado))
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        if (gruposGrado.length === 0) continue;

        const subjectsGrado = state.subjects.filter(s => Number(s.grado) === Number(grado));
        const subjectsOrdered = K.sortSubjectsByGrado(subjectsGrado, grado);
        if (subjectsOrdered.length === 0) continue;

        const aoa = [];
        // Fila título (mergeada)
        aoa.push([`EPO 67 — CARGA ACADÉMICA — TURNO ${turno} — ${grado}° GRADO`]);
        aoa.push([`Ciclo Escolar 2025-2026 · Generado el ${today}`]);
        aoa.push([]); // fila vacía
        // Header
        const headerRow = ['MATERIA', ...gruposGrado.map(g => `Grupo ${g.nombre}`)];
        aoa.push(headerRow);
        // Filas de datos
        for (const sub of subjectsOrdered) {
          const row = [K.getUACNombre(sub.nombre)];
          for (const grp of gruposGrado) {
            const asg = asgMap[sub.id + '_' + grp.id];
            row.push(asg ? Utils.displayName(asg.teacherName) : 'SIN ASIGNAR');
          }
          aoa.push(row);
        }
        // Resumen al final
        const totalCells = gruposGrado.length * subjectsOrdered.length;
        const asignadas = subjectsOrdered.reduce((acc, sub) =>
          acc + gruposGrado.filter(g => asgMap[sub.id + '_' + g.id]).length, 0);
        aoa.push([]);
        aoa.push([`Total: ${asignadas}/${totalCells} asignaciones (${Math.round(asignadas/totalCells*100)}%)`]);

        const ncols = headerRow.length;
        sheets.push({
          name: `${turno.slice(0,3)} ${grado}°`,  // ej. "MAT 1°", "VES 2°"
          aoa,
          cols: [{ wch: 38 }, ...gruposGrado.map(() => ({ wch: 28 }))],
          merges: [
            { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } }, // título
            { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } }, // subtítulo
          ],
          rows: [{ hpx: 28 }, { hpx: 18 }],
        });
      }
    }

    // 2 HOJAS CONSOLIDADAS — una por turno con todas las clases listadas
    for (const turno of K.TURNOS) {
      const gruposTurno = state.groups.filter(g => g.turno === turno);
      if (gruposTurno.length === 0) continue;

      const aoa = [];
      aoa.push([`EPO 67 — CARGA ACADÉMICA CONSOLIDADA — TURNO ${turno}`]);
      aoa.push([`Ciclo Escolar 2025-2026 · Generado el ${today}`]);
      aoa.push([]);
      aoa.push(['Grado', 'Grupo', 'Materia', 'Docente', 'Estatus']);

      // Ordenar: grado asc, grupo asc, materia
      const ordered = [...gruposTurno].sort((a, b) =>
        (Number(a.grado) - Number(b.grado)) || (a.nombre || '').localeCompare(b.nombre || ''));

      for (const grp of ordered) {
        const subjectsGrado = state.subjects.filter(s => Number(s.grado) === Number(grp.grado));
        const subjectsOrdered = K.sortSubjectsByGrado(subjectsGrado, grp.grado);
        for (const sub of subjectsOrdered) {
          const asg = asgMap[sub.id + '_' + grp.id];
          aoa.push([
            grp.grado + '°',
            grp.nombre || grp.id,
            K.getUACNombre(sub.nombre),
            asg ? Utils.displayName(asg.teacherName) : '',
            asg ? 'Asignada' : 'VACANTE',
          ]);
        }
      }

      sheets.push({
        name: `Consolidado ${turno.slice(0,3)}`,
        aoa,
        cols: [{ wch: 8 }, { wch: 10 }, { wch: 38 }, { wch: 36 }, { wch: 12 }],
        merges: [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        ],
      });
    }

    if (sheets.length === 0) {
      Toast.show('No hay datos para exportar', 'warning');
      return;
    }

    try {
      const buf = await XlsxWorker.serialize({ sheets });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const datestr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `carga-academica-EPO67-${datestr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      Toast.show(`Excel descargado (${sheets.length} hojas)`, 'success');
    } catch (e) {
      console.error('Error generando Excel:', e);
      Toast.show('Error al generar Excel: ' + e.message, 'error');
    }
  };

  // ── Impresion masiva de Carga Academica (ambos turnos) ────────

  const printCargaMasiva = () => {
    if (!state.groups.length || !state.subjects.length) {
      Toast.show('Espera a que carguen los datos', 'warning');
      return;
    }

    // Mapa subjectId_groupId -> assignment
    const asgMap = {};
    state.assignments.forEach(a => {
      asgMap[a.subjectId + '_' + a.groupId] = a;
    });

    const today = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

    let body = '';

    // Iterar por turno -> grado -> grupo -> materia (en orden oficial)
    for (const turno of K.TURNOS) {
      const gruposTurno = state.groups.filter(g => g.turno === turno);
      if (gruposTurno.length === 0) continue;

      body += `
        <section class="turno-page">
          <div class="turno-header">
            <h1>ESCUELA PREPARATORIA OFICIAL NUM. 67</h1>
            <h2>CARGA ACAD&Eacute;MICA &mdash; TURNO ${S(turno)}</h2>
            <div class="turno-meta">Ciclo Escolar 2025-2026 &mdash; Generado el ${today}</div>
          </div>
      `;

      for (const grado of K.GRADOS) {
        const gruposGrado = gruposTurno
          .filter(g => String(g.grado) === String(grado))
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
        if (gruposGrado.length === 0) continue;

        const subjectsGrado = state.subjects.filter(s => String(s.grado) === String(grado));
        const subjectsOrdered = K.sortSubjectsByGrado(subjectsGrado, grado);

        body += `<h3 class="grado-title">${grado}&ordm; GRADO</h3>`;

        for (const grp of gruposGrado) {
          const rows = subjectsOrdered.map(sub => {
            const asg = asgMap[sub.id + '_' + grp.id];
            // Mostrar nombre primero ("CLAUDIA TORRES MORENO") en lugar de "TORRES MORENO CLAUDIA"
            const maestro = asg ? Utils.displayName(asg.teacherName) : '';
            const rowClass = asg ? '' : ' class="vacante"';
            const maestroCell = asg ? S(maestro) : '<em>SIN ASIGNAR</em>';
            return `<tr${rowClass}>
              <td class="mat">${S(K.getUACNombre(sub.nombre))}</td>
              <td class="doc">${maestroCell}</td>
            </tr>`;
          }).join('');

          const totalMat = subjectsOrdered.length;
          const asignadas = subjectsOrdered.filter(s => asgMap[s.id + '_' + grp.id]).length;
          const vacantes = totalMat - asignadas;

          body += `
            <div class="grupo-card">
              <div class="grupo-head">
                <strong>GRUPO ${S(grp.nombre)}</strong>
                <span class="grupo-stats">${asignadas}/${totalMat} asignadas${vacantes > 0 ? ` &bull; ${vacantes} vacantes` : ''}</span>
              </div>
              <table>
                <thead><tr><th style="width:60%;">Materia</th><th>Docente asignado</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `;
        }
      }

      body += `</section>`;
    }

    const fullHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Carga Acad&eacute;mica - Ambos Turnos</title>
      <style>
        @page { size: letter portrait; margin: 14mm 16mm; }
        * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; }

        .turno-page { page-break-after: always; }
        .turno-page:last-child { page-break-after: auto; }

        .turno-header { text-align:center; margin-bottom:14px; padding-bottom:10px; border-bottom:2px solid #1b3a5c; }
        .turno-header h1 { font-size:14pt; font-weight:700; margin-bottom:4px; }
        .turno-header h2 { font-size:13pt; font-weight:700; color:#1b3a5c; margin-bottom:4px; letter-spacing:1px; }
        .turno-header .turno-meta { font-size:9.5pt; color:#666; }

        .grado-title { font-size:13pt; font-weight:700; color:#fff; background:#1b3a5c;
          padding:6px 12px; margin:14px 0 10px 0; border-radius:4px; letter-spacing:1px; }

        .grupo-card { border:1.5px solid #1b3a5c; border-radius:6px; margin-bottom:12px;
          page-break-inside: avoid; overflow:hidden; }
        .grupo-head { background:#e8ecf1; padding:6px 12px; display:flex;
          justify-content:space-between; align-items:center; font-size:11pt; border-bottom:1.5px solid #1b3a5c; }
        .grupo-stats { font-size:9.5pt; color:#555; font-weight:600; }

        table { width:100%; border-collapse:collapse; }
        th { background:#f7f9fb; padding:5px 10px; text-align:left; font-size:10pt;
          font-weight:700; color:#1b3a5c; border-bottom:1px solid #ccc; }
        td { padding:5px 10px; font-size:10pt; border-bottom:1px solid #eee; line-height:1.3; }
        tr:last-child td { border-bottom:none; }
        tr.vacante td.doc em { color:#c53030; font-style:italic; font-weight:600; }
        td.mat { font-weight:500; }
        td.doc { font-weight:600; color:#1b3a5c; }
      </style>
      </head><body>
        ${body}
        <script>
          document.title = 'Carga_Academica_Ambos_Turnos';
          setTimeout(() => window.print(), 500);
        <\/script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      Toast.show('El navegador bloque\u00f3 la ventana emergente. Permite pop-ups e intenta de nuevo.', 'error');
      return;
    }
    w.document.write(fullHtml);
    w.document.close();
    Toast.show('Documento generado. Gu\u00e1rdalo como PDF desde la ventana de impresi\u00f3n.', 'success');
  };

  // ── Render & Events ───────────────────────────────────────────

  const switchTab = (tabName) => {
    state.currentTab = tabName;
    state.searchQuery = '';
    state.selectedGroup = 'all';
    render();
  };

  // BUGFIX (v5.51): bindEvents se llamaba en cada render() y los listeners
  // se acumulaban sobre el mismo `container` persistente. Tras 15-20 cambios
  // de filtro la pestaña se trababa porque cada click disparaba 20 handlers en
  // paralelo. Ahora bindeamos UNA SOLA VEZ por instancia del módulo.
  let _eventsBound = false;
  const bindEvents = (container) => {
    if (_eventsBound) return;
    _eventsBound = true;
    container.addEventListener('click', async (e) => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        switchTab(tabBtn.dataset.tab);
        return;
      }

      const action = e.target.closest('[data-action]');
      if (!action) return;

      const actionName = action.dataset.action;
      const id = action.dataset.id;

      switch (actionName) {
        // Sort toggle
        case 'toggle-sort':
          state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
          render();
          break;

        // Teacher CRUD
        case 'new-teacher':
          openTeacherModal();
          break;
        case 'edit-teacher': {
          const teacher = state.teachers.find(t => t.id === id);
          if (teacher) openTeacherModal(teacher);
          break;
        }
        case 'delete-teacher': {
          const teacher = state.teachers.find(t => t.id === id);
          if (teacher) deleteTeacher(teacher);
          break;
        }

        // Orientador
        case 'assign-orientador': {
          const group = state.groups.find(g => g.id === id);
          if (group) openOrientadorModal(group);
          break;
        }

        // Assignment CRUD
        case 'new-assignment':
          openAssignmentModal();
          break;
        case 'edit-assignment': {
          const assignment = state.assignments.find(a => a.id === id);
          if (assignment) openAssignmentModal(assignment);
          break;
        }
        case 'delete-assignment': {
          const assignment = state.assignments.find(a => a.id === id);
          if (assignment) deleteAssignment(assignment);
          break;
        }
        case 'assign-cell': {
          _handleCellAssign(action);
          break;
        }
        case 'print-carga-masiva': {
          printCargaMasiva();
          break;
        }
        case 'excel-carga-masiva': {
          downloadCargaExcel();
          break;
        }
        case 'auto-detect-coberturas': {
          await _autoDetectAndMark();
          break;
        }
        case 'reassign-interim': {
          const asg = state.assignments.find(a => a.id === id);
          if (asg) _openReassignModal(asg);
          break;
        }
        case 'unmark-interim': {
          const asg = state.assignments.find(a => a.id === id);
          if (asg && confirm(`¿Quitar la marca de cobertura de "${asg.subjectName}" en ${asg.groupName}?\n\nLa asignación seguirá siendo de ${Utils.displayName(asg.teacherName || '')} pero ya no se considerará cobertura temporal.`)) {
            await _toggleInterim(asg, false);
          }
          break;
        }

        // Wizards del nuevo tab "Asignaciones"
        case 'wizard-cambiar':
          _wizardCambiarMaestro();
          break;
        case 'wizard-llenar':
          _wizardLlenarVacante();
          break;
        case 'wizard-quitar':
          _wizardQuitarClase();
          break;
        case 'ver-duplicados':
          // Llevar al tab Materias donde ya hay banner + botones de eliminar
          state.currentTab = 'materias';
          render();
          break;
      }
    });

    container.addEventListener('input', (e) => {
      if (e.target.id === 'teacherSearch') {
        state.searchQuery = e.target.value;
        render();
      }
      if (e.target.id === 'assignmentSearch') {
        state.assignmentSearch = e.target.value;
        render();
      }
    });

    container.addEventListener('change', (e) => {
      if (e.target.id === 'groupFilter') {
        state.selectedGroup = e.target.value;
        render();
      }
      if (e.target.id === 'teacherTurnoFilter') {
        state.filterTurno = e.target.value;
        render();
      }
      if (e.target.id === 'materiasFilterTurno') {
        state.materiasFilterTurno = e.target.value;
        render();
      }
      if (e.target.id === 'assignmentTurnoFilter') {
        state.assignmentFilterTurno = e.target.value;
        render();
      }
      if (e.target.id === 'assignmentGradoFilter') {
        state.assignmentFilterGrado = e.target.value;
        render();
      }
      if (e.target.id === 'cargaTurno') {
        state.assignmentFilterTurno = e.target.value;
        state.assignmentFilterGrado = 'all';
        render();
      }
      if (e.target.id === 'cargaGrado') {
        state.assignmentFilterGrado = e.target.value;
        render();
      }
      // Vista informativa del tab Asignaciones (grupo/maestro)
      if (e.target.name === 'asg_view') {
        _renderAsgInfoView(e.target.value);
      }
    });

    // Después de cada render, si estamos en el tab Asignaciones, renderizar
    // la vista informativa (grupo o maestro). Sin esto el contenedor queda
    // vacío al cargar.
    if (state.currentTab === 'asignaciones') {
      _renderAsgInfoView(state.asgViewMode || 'grupo');
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // COBERTURAS — gestión de asignaciones interim (orientador cubriendo vacante)
  // ═══════════════════════════════════════════════════════════════

  // Detecta candidatos a cobertura: assignments donde el teacher es orientador
  // de algún grupo en el MISMO turno que la asignación, y la asignación NO está
  // marcada como interim todavía.
  const _detectInterimCandidates = () => {
    const orientadorTurnos = new Map(); // teacherId -> Set(turnos donde orienta)
    state.groups.forEach(g => {
      let teacherId = g.orientadorId || '';
      if (!teacherId && g.orientador) {
        // Match por nombre con palabras significativas
        const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
        const stripT = s => norm(s).replace(/\bPROFRA?\.?|\bMTRA?\.?|\bDR[A]?\.?|\bLIC\.?|\bMA\.?/g, '').trim();
        const ws = stripT(g.orientador).split(/\s+/).filter(w => w.length > 2);
        if (ws.length >= 2) {
          let best = null, bestScore = 0;
          state.teachers.forEach(t => {
            const tw = stripT(t.nombre || '').split(/\s+/).filter(w => w.length > 2);
            const overlap = ws.filter(w => tw.includes(w)).length;
            if (overlap > bestScore) { bestScore = overlap; best = t; }
          });
          if (bestScore >= 2 && best) teacherId = best.id;
        }
      }
      if (!teacherId || !g.turno) return;
      if (!orientadorTurnos.has(teacherId)) orientadorTurnos.set(teacherId, new Set());
      orientadorTurnos.get(teacherId).add(g.turno);
    });

    return state.assignments.filter(a => {
      if (a.interim) return false;
      const turnos = orientadorTurnos.get(a.teacherId);
      return turnos && turnos.has(a.turno);
    });
  };

  const _autoDetectAndMark = async () => {
    const candidates = _detectInterimCandidates();
    if (candidates.length === 0) {
      Toast.show('No hay coberturas pendientes por detectar', 'info');
      return;
    }
    const list = candidates.map(a => `• ${Utils.displayName(a.teacherName || '')} → ${K.getUACNombre(a.subjectName || '')} en ${a.groupName} (${a.turno})`).join('\n');
    if (!confirm(`Se detectaron ${candidates.length} asignaciones que parecen cobertura temporal (orientador del mismo turno):\n\n${list}\n\n¿Marcar todas como cobertura ahora?`)) return;

    Toast.show('Marcando coberturas...', 'info');
    const now = new Date();
    let ok = 0, fail = 0;
    for (const a of candidates) {
      try {
        await db.collection('assignments').doc(a.id).update({
          interim: true,
          interimSince: now,
          interimNote: 'Cobertura detectada automáticamente: orientador del mismo turno'
        });
        DB.audit('marcar', 'cobertura', a.id, {
          description: `Cobertura automática: ${Utils.displayName(a.teacherName || '')} cubre ${a.subjectName} en ${a.groupName} (${a.turno})`,
          metadata: {
            assignmentId: a.id,
            teacherId: a.teacherId,
            teacherName: a.teacherName,
            groupId: a.groupId,
            groupName: a.groupName,
            subjectId: a.subjectId,
            subjectName: a.subjectName,
            turno: a.turno,
            source: 'auto-detect'
          }
        });
        ok++;
      } catch (e) {
        console.error('Error marcando cobertura', a.id, e);
        fail++;
      }
    }
    Toast.show(`Marcadas ${ok} cobertura(s)${fail > 0 ? ` · ${fail} con error` : ''}`, fail > 0 ? 'warning' : 'success');
    await invalidateAndReload('assignments');
  };

  const _toggleInterim = async (assignment, makeInterim, note = '') => {
    if (!assignment) return;
    try {
      if (makeInterim) {
        await db.collection('assignments').doc(assignment.id).update({
          interim: true,
          interimSince: new Date(),
          interimNote: note || 'Marcado manualmente como cobertura'
        });
        DB.audit('marcar', 'cobertura', assignment.id, {
          description: `Marcada como cobertura: ${Utils.displayName(assignment.teacherName || '')} cubre ${assignment.subjectName} en ${assignment.groupName}`,
          metadata: { assignmentId: assignment.id, action: 'mark', note }
        });
        Toast.show('Marcada como cobertura', 'success');
      } else {
        await db.collection('assignments').doc(assignment.id).update({
          interim: false,
          interimNote: ''
        });
        DB.audit('quitar', 'cobertura', assignment.id, {
          description: `Quitada marca de cobertura: ${Utils.displayName(assignment.teacherName || '')} → ${assignment.subjectName} (${assignment.groupName})`,
          metadata: { assignmentId: assignment.id, action: 'unmark' }
        });
        Toast.show('Marca de cobertura quitada', 'info');
      }
      await invalidateAndReload('assignments');
    } catch (e) {
      Toast.show('Error: ' + e.message, 'error');
    }
  };

  const _openReassignModal = (assignment) => {
    if (!assignment) return;
    // Lista de docentes del mismo turno que el grupo, excluyendo al actual
    const eligible = state.teachers
      .filter(t => t.id !== assignment.teacherId &&
                   (t.turno === assignment.turno || t.turno === 'AMBOS'))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    const since = assignment.interimSince
      ? (assignment.interimSince.toDate ? assignment.interimSince.toDate() : new Date(assignment.interimSince))
      : null;
    const sinceLabel = since ? since.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) : '(no registrada)';

    const body = `
      <div style="background:#fef3c7;border:1px solid #d97706;border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="font-weight:700;color:#78350f;margin-bottom:4px;">⚠ Reasignación de cobertura a docente oficial</div>
        <div style="font-size:13px;color:#78350f;line-height:1.4;">
          Esta asignación está marcada como cobertura temporal. Al reasignarla:
          <ul style="margin:6px 0 0 18px;padding:0;">
            <li>El docente actual <strong>perderá acceso</strong> a esta lista.</li>
            <li>El nuevo docente <strong>heredará todas</strong> las calificaciones, faltas y horas ya capturadas.</li>
            <li>Quedará registro auditable en bitácora con quién cubrió y por cuánto tiempo.</li>
          </ul>
        </div>
      </div>

      <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
        <div><strong>Materia:</strong> ${S(K.getUACNombre(assignment.subjectName || ''))}</div>
        <div><strong>Grupo:</strong> ${S(assignment.groupName || '')} (${S(assignment.turno || '')})</div>
        <div><strong>Cubría:</strong> ${S(Utils.displayName(assignment.teacherName || ''))}</div>
        <div><strong>Desde:</strong> ${S(sinceLabel)}</div>
      </div>

      <div class="form-group">
        <label for="reassign-teacher">Docente oficial *</label>
        <select id="reassign-teacher" required>
          <option value="">-- Seleccionar docente --</option>
          ${eligible.map(t => `<option value="${S(t.id)}" data-name="${S(t.nombre)}">${S(Utils.displayName(t.nombre))}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="reassign-note">Nota / motivo (opcional)</label>
        <input type="text" id="reassign-note" maxlength="200" placeholder="Ej: contratación oficial, regreso de licencia, etc." class="ge-input" style="width:100%;">
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="confirm-reassign">Aprobar reasignación</button>
    `;

    Modal.open(`Reasignar cobertura: ${K.getUACNombre(assignment.subjectName || '')}`, body, footer);

    document.querySelector('.modal').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
      else if (e.target.closest('[data-action="confirm-reassign"]')) {
        const sel = document.getElementById('reassign-teacher');
        const note = (document.getElementById('reassign-note')?.value || '').trim();
        const newTeacherId = sel?.value;
        if (!newTeacherId) { Toast.show('Selecciona un docente', 'warning'); return; }
        const opt = sel.options[sel.selectedIndex];
        const newTeacherName = opt.getAttribute('data-name') || '';
        await _confirmReassign(assignment, newTeacherId, newTeacherName, note);
        Modal.close();
      }
    });
  };

  const _confirmReassign = async (assignment, newTeacherId, newTeacherName, note) => {
    try {
      const now = new Date();
      const fromTeacherId = assignment.teacherId;
      const fromTeacherName = assignment.teacherName || '';

      // Build history entry
      const historyEntry = {
        teacherId: fromTeacherId,
        teacherName: fromTeacherName,
        from: assignment.interimSince || now,
        to: now,
        reassignedToTeacherId: newTeacherId,
        reassignedToTeacherName: newTeacherName,
        reassignedBy: App.currentUser?.uid || 'unknown',
        reassignedByName: App.currentUser?.displayName || App.currentUser?.email || 'Admin',
        note: note || ''
      };

      const existingHistory = Array.isArray(assignment.interimHistory) ? assignment.interimHistory : [];

      await db.collection('assignments').doc(assignment.id).update({
        teacherId: newTeacherId,
        teacherName: newTeacherName,
        interim: false,
        interimNote: '',
        interimHistory: [...existingHistory, historyEntry],
        lastReassignedAt: now
      });

      DB.audit('reasignar', 'cobertura', assignment.id, {
        description: `Cobertura reasignada: ${assignment.subjectName} en ${assignment.groupName} pasa de ${Utils.displayName(fromTeacherName)} a ${Utils.displayName(newTeacherName)}`,
        metadata: {
          assignmentId: assignment.id,
          fromTeacherId, fromTeacherName,
          toTeacherId: newTeacherId, toTeacherName: newTeacherName,
          groupId: assignment.groupId, groupName: assignment.groupName,
          subjectId: assignment.subjectId, subjectName: assignment.subjectName,
          turno: assignment.turno,
          interimSince: assignment.interimSince || null,
          reassignedAt: now,
          note
        }
      });

      Toast.show(`Reasignada a ${Utils.displayName(newTeacherName)}`, 'success');
      await invalidateAndReload('assignments');
    } catch (e) {
      console.error('Error reasignando cobertura', e);
      Toast.show('Error: ' + e.message, 'error');
    }
  };

  const renderCoberturasTab = () => {
    const interimAsg = state.assignments.filter(a => a.interim);
    const candidates = _detectInterimCandidates();

    let html = `
      <div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-left:6px solid #d97706;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
          <div style="min-width:0;">
            <h2 style="font-size:18px;color:#78350f;margin:0 0 4px;">🟠 Coberturas Temporales</h2>
            <p style="font-size:13px;color:#78350f;margin:0;line-height:1.4;">
              Asignaciones donde un orientador o docente cubre una vacante en el mismo turno.
              Cuando llegue el docente oficial, presiona <strong>"Reasignar a docente oficial"</strong>:
              las calificaciones, faltas y horas ya capturadas se transfieren automáticamente.
            </p>
          </div>
        </div>
      </div>`;

    // Auto-detect bar
    html += `
      <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-weight:600;font-size:14px;">Detección automática</div>
          <div style="font-size:12px;color:#666;margin-top:2px;">
            ${candidates.length === 0
              ? '✓ Sin coberturas pendientes por detectar (todas las marcadas o no aplican)'
              : `${candidates.length} asignación(es) sin marcar parecen ser cobertura (orientador del mismo turno).`}
          </div>
        </div>
        <button class="btn btn-warning" data-action="auto-detect-coberturas" ${candidates.length === 0 ? 'disabled' : ''}>
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">search</span>
          Auto-detectar y marcar (${candidates.length})
        </button>
      </div>`;

    if (interimAsg.length === 0) {
      html += `
        <div class="empty-state">
          <span class="material-icons-round empty-state-icon">check_circle</span>
          <p class="empty-state-text">No hay coberturas activas en el sistema.</p>
        </div>`;
      return html;
    }

    // Tabla de coberturas activas
    const sorted = [...interimAsg].sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') ||
      (a.groupName || '').localeCompare(b.groupName || '') ||
      (a.subjectName || '').localeCompare(b.subjectName || '')
    );

    html += `
      <div class="card">
        <div style="font-weight:600;margin-bottom:8px;">Coberturas activas (${interimAsg.length})</div>
        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th>Docente que cubre</th>
                <th>Materia</th>
                <th>Grupo</th>
                <th>Turno</th>
                <th>Desde</th>
                <th>Nota</th>
                <th style="width:280px;">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.map(a => {
                const since = a.interimSince
                  ? (a.interimSince.toDate ? a.interimSince.toDate() : new Date(a.interimSince))
                  : null;
                const sinceLabel = since ? since.toLocaleDateString('es-MX') : '-';
                return `
                  <tr style="background:#fffbeb;">
                    <td class="font-semibold">${S(Utils.displayName(a.teacherName || ''))}</td>
                    <td>${S(K.getUACNombre(a.subjectName || ''))}</td>
                    <td>${S(a.groupName || '')}</td>
                    <td>${S(a.turno || '')}</td>
                    <td>${sinceLabel}</td>
                    <td style="font-size:12px;color:#78350f;max-width:200px;">${S(a.interimNote || '')}</td>
                    <td>
                      <button class="btn btn-primary btn-sm" data-action="reassign-interim" data-id="${S(a.id)}" title="Aprobar transición a docente oficial">
                        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">swap_horiz</span>
                        Reasignar a oficial
                      </button>
                      <button class="btn btn-outline btn-sm" data-action="unmark-interim" data-id="${S(a.id)}" title="Quitar la marca de cobertura (sigue siendo del mismo docente)">
                        Quitar marca
                      </button>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    return html;
  };

  const render = async () => {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    if (!state.dataLoaded) {
      await loadData();
    }

    let tabContent = '';
    switch (state.currentTab) {
      case 'asignaciones': tabContent = renderAsignacionesTab(); break;
      case 'docentes':     tabContent = renderTeachersTab();     break;
      case 'grupos':       tabContent = renderGruposTab();       break;
      case 'materias':     tabContent = renderMateriasTab();     break;
      case 'carga':        tabContent = renderCargaTab();        break;
      case 'coberturas':   tabContent = renderCoberturasTab();   break;
    }

    const interimCount = state.assignments.filter(a => a.interim).length;
    const interimLabel = interimCount > 0 ? `Coberturas <span style="background:#d97706;color:#fff;border-radius:10px;padding:1px 8px;font-size:11px;margin-left:4px;">${interimCount}</span>` : 'Coberturas';

    // Pesta\u00f1as en orden de uso. La primera "Asignaciones" es el flujo guiado
    // pensado para el subdirector \u2014 botones grandes y wizards a prueba de
    // errores. Las dem\u00e1s son vistas avanzadas para admin.
    const tabs = [
      { id: 'asignaciones', label: 'Asignaciones' },
      { id: 'docentes',     label: 'Docentes' },
      { id: 'grupos',       label: 'Grupos y Orientadores' },
      { id: 'carga',        label: 'Vista matriz (avanzado)' },
      { id: 'coberturas',   label: interimLabel },
      { id: 'materias',     label: 'Por materia (avanzado)' }
    ];

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Gestion de Docentes y Materias</h1>
        <p class="module-subtitle">Administra docentes, grupos, materias y asignaciones</p>

        <div class="tabs">
          ${tabs.map(t => `
            <button class="tab-button ${state.currentTab === t.id ? 'active' : ''}" data-tab="${t.id}">
              ${t.label}
            </button>
          `).join('')}
        </div>

        <div class="tab-content active">
          ${tabContent}
        </div>
      </div>
    `;

    bindEvents(container);
  };

  return { render };
})();

// Self-register
Router.modules['teachers'] = () => TeachersModule.render();
