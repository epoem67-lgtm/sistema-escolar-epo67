const TeachersModule = (() => {
  const db = firebase.firestore();

  const state = {
    teachers: [],
    groups: [],
    subjects: [],
    assignments: [],
    currentTab: 'docentes',
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
        <div class="form-group">
          <label>Spreadsheet URL</label>
          <input type="text" id="tf_spreadsheet" value="${isEdit ? S(teacher.spreadsheetUrl) : ''}">
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
          especialidad: document.getElementById('tf_especialidad').value.trim(),
          spreadsheetUrl: document.getElementById('tf_spreadsheet').value.trim()
        };

        try {
          if (isEdit) {
            await db.collection('teachers').doc(teacher.id).update(data);
            Toast.show('Docente actualizado', 'success');
          } else {
            data.status = 'active';
            data.createdAt = new Date();
            await db.collection('teachers').add(data);
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
      warningMsg = `<p style="color:var(--danger);font-weight:600;">Este docente tiene ${teacherAssignments.length} asignacion(es). Se recomienda eliminarlas primero.</p>`;
    }

    const body = `
      <p>Esta a punto de eliminar al docente:</p>
      <p><strong>${S(teacher.nombre)}</strong></p>
      ${warningMsg}
      <p>Esta accion no se puede deshacer.</p>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-danger" data-action="confirm-delete-teacher">Eliminar</button>
    `;

    Modal.open('Eliminar Docente', body, footer);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('[data-action="confirm-delete-teacher"]')) {
        try {
          await db.collection('teachers').doc(teacher.id).delete();
          Toast.show('Docente eliminado', 'success');
          Modal.close();
          await invalidateAndReload('teachers');
        } catch (err) {
          console.error('Error deleting teacher:', err);
          Toast.show('Error al eliminar docente', 'error');
        }
      }
    });
  };

  // ── CRUD: Orientador ──────────────────────────────────────────

  const openOrientadorModal = (group) => {
    const matchingTeachers = state.teachers.filter(t =>
      t.turno === group.turno || t.turno === 'AMBOS'
    );

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
              ${S(t.nombre)} (${S(t.turno)})
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
    const title = isEdit ? 'Editar Asignacion' : 'Nueva Asignacion';

    const body = `
      <form id="assignmentForm">
        <div class="form-group">
          <label>Docente *</label>
          <select id="af_teacher">
            <option value="">-- Seleccionar --</option>
            ${state.teachers.map(t => `
              <option value="${S(t.id)}" data-name="${S(t.nombre)}"
                ${isEdit && assignment.teacherId === t.id ? 'selected' : ''}>
                ${S(t.nombre)} (${S(t.turno)})
              </option>
            `).join('')}
          </select>
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
        const grado = gradoSel.value;
        const turno = turnoSel.value;

        if (!teacherEl.value || !grado || !subjectEl.value || !turno || !groupEl.value) {
          Toast.show('Todos los campos son obligatorios', 'error');
          return;
        }

        const data = {
          teacherId: teacherEl.value,
          teacherName: teacherEl.options[teacherEl.selectedIndex].getAttribute('data-name'),
          subjectId: subjectEl.value,
          subjectName: subjectEl.options[subjectEl.selectedIndex].getAttribute('data-name'),
          groupId: groupEl.value,
          groupName: groupEl.options[groupEl.selectedIndex].getAttribute('data-name'),
          grado,
          turno
        };

        try {
          if (isEdit) {
            await db.collection('assignments').doc(assignment.id).update(data);
            Toast.show('Asignacion actualizada', 'success');
          } else {
            await db.collection('assignments').add(data);
            Toast.show('Asignacion creada', 'success');
          }
          Modal.close();
          await invalidateAndReload('assignments');
        } catch (err) {
          console.error('Error saving assignment:', err);
          Toast.show('Error al guardar asignacion', 'error');
        }
      }
    });
  };

  const deleteAssignment = (assignment) => {
    const body = `
      <p>Esta a punto de eliminar la asignacion:</p>
      <p><strong>${S(assignment.teacherName)}</strong> &rarr; ${S(assignment.subjectName)} (${S(assignment.groupName)})</p>
      <p>Esta accion no se puede deshacer.</p>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-danger" data-action="confirm-delete-assignment">Eliminar</button>
    `;

    Modal.open('Eliminar Asignacion', body, footer);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('[data-action="confirm-delete-assignment"]')) {
        try {
          await db.collection('assignments').doc(assignment.id).delete();
          Toast.show('Asignacion eliminada', 'success');
          Modal.close();
          await invalidateAndReload('assignments');
        } catch (err) {
          console.error('Error deleting assignment:', err);
          Toast.show('Error al eliminar asignacion', 'error');
        }
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
                  <th>Spreadsheet</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(t => `
                  <tr>
                    <td><strong>${S(t.nombre) || 'N/A'}</strong></td>
                    <td>${turnoBadge(t.turno)}</td>
                    <td>${S(t.especialidad) || '-'}</td>
                    <td>
                      ${t.spreadsheetUrl
                        ? `<a href="${S(t.spreadsheetUrl)}" target="_blank" class="btn btn-sm btn-outline">Ver</a>`
                        : 'Sin asignar'}
                    </td>
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
        .sort((a, b) => a.grado - b.grado || (a.letra || '').localeCompare(b.letra || ''));
    });

    return `
      <div class="stats-grid">
        <div class="stat-card--compact">
          <div class="stat-number">${state.groups.length}</div>
          <div class="stat-label">Total Grupos</div>
        </div>
        ${K.GRADOS.map(g => `
          <div class="stat-card--compact">
            <div class="stat-number">${state.groups.filter(gr => gr.grado === g).length}</div>
            <div class="stat-label">${g}&#176; Grado</div>
          </div>
        `).join('')}
      </div>

      ${K.TURNOS.map(turno => {
        const grupos = groupsByTurno[turno];
        if (!grupos || grupos.length === 0) return '';
        return `
          <div class="card">
            <h3 class="section-title">
              ${turnoBadge(turno)}
            </h3>
            <div class="table-container">
              <table class="table-light">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Grado</th>
                    <th>Letra</th>
                    <th>Orientador</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${grupos.map(g => `
                    <tr>
                      <td><strong>${S(g.nombre) || 'N/A'}</strong></td>
                      <td>${g.grado || 'N/A'}&#176;</td>
                      <td>${S(g.letra) || 'N/A'}</td>
                      <td>${S(g.orientador) || 'Sin asignar'}</td>
                      <td><span class="badge badge-success">${S(g.status) || 'N/A'}</span></td>
                      <td>
                        <button class="btn btn-sm btn-primary" data-action="assign-orientador" data-id="${S(g.id)}">Asignar Orientador</button>
                      </td>
                    </tr>
                  `).join('')}
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

    // Build a map: subjectId -> array of teacher info from assignments
    const teachersBySubject = {};
    state.assignments.forEach(a => {
      if (!teachersBySubject[a.subjectId]) {
        teachersBySubject[a.subjectId] = [];
      }
      // Filter by turno if active
      if (state.materiasFilterTurno === 'all' || a.turno === state.materiasFilterTurno) {
        const exists = teachersBySubject[a.subjectId].some(
          x => x.teacherId === a.teacherId && x.turno === a.turno
        );
        if (!exists) {
          teachersBySubject[a.subjectId].push({
            teacherId: a.teacherId,
            teacherName: a.teacherName,
            turno: a.turno
          });
        }
      }
    });

    return `
      <div class="stats-grid">
        <div class="stat-card--compact">
          <div class="stat-number">${state.subjects.length}</div>
          <div class="stat-label">Total Materias</div>
        </div>
        ${K.GRADOS.map(g => `
          <div class="stat-card--compact">
            <div class="stat-number">${subjectsByGrado[g].length}</div>
            <div class="stat-label">${g}&#176; Grado</div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="filter-bar">
          <div class="form-group">
            <label>Filtrar docentes por turno:</label>
            <select id="materiasFilterTurno">
              <option value="all" ${state.materiasFilterTurno === 'all' ? 'selected' : ''}>Todos los turnos</option>
              ${K.TURNOS.map(t => `
                <option value="${t}" ${state.materiasFilterTurno === t ? 'selected' : ''}>${S(t)}</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      ${K.GRADOS.map(grado => {
        const subjects = subjectsByGrado[grado];
        return `
          <div class="card">
            <h3 class="section-title">${grado}&#176; Grado</h3>
            ${subjects.length > 0 ? `
              <div class="subject-grid">
                ${subjects.map(s => {
                  const assigned = teachersBySubject[s.id] || [];
                  return `
                    <div class="subject-card">
                      <div class="subject-card-name">${S(s.nombre) || 'N/A'}</div>
                      <div class="subject-card-meta">
                        <span>${s.grado}&#176; Grado</span>
                        <span class="badge badge-success">Activa</span>
                      </div>
                      ${assigned.length > 0 ? `
                        <div class="subject-card-teachers" style="margin-top:6px;font-size:0.85em;color:var(--text-secondary);">
                          ${assigned.map(a => `
                            <div>${S(a.teacherName)} ${turnoBadge(a.turno)}</div>
                          `).join('')}
                        </div>
                      ` : `
                        <div style="margin-top:6px;font-size:0.85em;color:var(--text-secondary);">Sin docentes asignados</div>
                      `}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="empty-state">
                <div class="empty-state-text">No hay materias para este grado</div>
              </div>
            `}
          </div>
        `;
      }).join('')}
    `;
  };

  // ── Tab: Asignaciones ─────────────────────────────────────────

  const renderAsignacionesTab = () => {
    let filtered = state.selectedGroup === 'all'
      ? [...state.assignments]
      : state.assignments.filter(a => a.groupId === state.selectedGroup);

    // Search filter
    const sq = state.assignmentSearch.toLowerCase();
    if (sq) {
      filtered = filtered.filter(a =>
        (a.teacherName || '').toLowerCase().includes(sq) ||
        (a.subjectName || '').toLowerCase().includes(sq)
      );
    }

    // Turno filter
    if (state.assignmentFilterTurno !== 'all') {
      filtered = filtered.filter(a => a.turno === state.assignmentFilterTurno);
    }

    // Grado filter
    if (state.assignmentFilterGrado !== 'all') {
      filtered = filtered.filter(a => String(a.grado) === String(state.assignmentFilterGrado));
    }

    const byTeacher = {};
    filtered.forEach(a => {
      if (!byTeacher[a.teacherId]) {
        byTeacher[a.teacherId] = {
          teacherName: a.teacherName,
          turno: a.turno,
          assignments: []
        };
      }
      byTeacher[a.teacherId].assignments.push(a);
    });

    const teacherCount = Object.keys(byTeacher).length;
    const groupCount = new Set(filtered.map(a => a.groupId)).size;
    const subjectCount = new Set(filtered.map(a => a.subjectId)).size;

    return `
      <div class="stats-grid">
        <div class="stat-card--compact">
          <div class="stat-number">${filtered.length}</div>
          <div class="stat-label">Total Asignaciones</div>
        </div>
        <div class="stat-card--compact">
          <div class="stat-number">${teacherCount}</div>
          <div class="stat-label">Docentes</div>
        </div>
        <div class="stat-card--compact">
          <div class="stat-number">${groupCount}</div>
          <div class="stat-label">Grupos</div>
        </div>
        <div class="stat-card--compact">
          <div class="stat-number">${subjectCount}</div>
          <div class="stat-label">Materias</div>
        </div>
      </div>

      <div class="card">
        <div class="filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <input type="text" id="assignmentSearch"
                     placeholder="Buscar por docente o materia..."
                     value="${S(state.assignmentSearch)}">
            </div>
            <div class="form-group">
              <select id="assignmentTurnoFilter">
                <option value="all" ${state.assignmentFilterTurno === 'all' ? 'selected' : ''}>Todos los turnos</option>
                ${K.TURNOS.map(t => `
                  <option value="${t}" ${state.assignmentFilterTurno === t ? 'selected' : ''}>${S(t)}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <select id="assignmentGradoFilter">
                <option value="all" ${state.assignmentFilterGrado === 'all' ? 'selected' : ''}>Todos los grados</option>
                ${K.GRADOS.map(g => `
                  <option value="${g}" ${state.assignmentFilterGrado === String(g) ? 'selected' : ''}>${g} Grado</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <select id="groupFilter">
                <option value="all" ${state.selectedGroup === 'all' ? 'selected' : ''}>Todos los grupos</option>
                ${state.groups.map(g => `
                  <option value="${S(g.id)}" ${g.id === state.selectedGroup ? 'selected' : ''}>
                    ${S(g.nombre)}
                  </option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <button class="btn btn-primary btn-sm" data-action="new-assignment">+ Nueva Asignacion</button>
            </div>
          </div>
        </div>
      </div>

      ${teacherCount > 0 ? Object.entries(byTeacher).map(([, data]) => `
        <div class="card">
          <h3 class="section-title">
            ${S(data.teacherName)}
            ${turnoBadge(data.turno)}
          </h3>
          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Grado</th>
                  <th>Materia</th>
                  <th>Turno</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${data.assignments.map(a => `
                  <tr>
                    <td><strong>${S(a.groupName) || 'N/A'}</strong></td>
                    <td>${a.grado || 'N/A'}&#176;</td>
                    <td>${S(a.subjectName) || 'N/A'}</td>
                    <td>${turnoBadge(a.turno)}</td>
                    <td>
                      <button class="btn btn-sm btn-warning" data-action="edit-assignment" data-id="${S(a.id)}">Editar</button>
                      <button class="btn btn-sm btn-danger" data-action="delete-assignment" data-id="${S(a.id)}">Eliminar</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `).join('') : `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">&#128203;</div>
            <div class="empty-state-text">No hay asignaciones para mostrar</div>
          </div>
        </div>
      `}
    `;
  };

  // ── Render & Events ───────────────────────────────────────────

  const switchTab = (tabName) => {
    state.currentTab = tabName;
    state.searchQuery = '';
    state.selectedGroup = 'all';
    render();
  };

  const bindEvents = (container) => {
    container.addEventListener('click', (e) => {
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
    });
  };

  const render = async () => {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    if (!state.dataLoaded) {
      await loadData();
    }

    let tabContent = '';
    switch (state.currentTab) {
      case 'docentes':     tabContent = renderTeachersTab();     break;
      case 'grupos':       tabContent = renderGruposTab();       break;
      case 'materias':     tabContent = renderMateriasTab();     break;
      case 'asignaciones': tabContent = renderAsignacionesTab(); break;
    }

    const tabs = [
      { id: 'docentes',     label: 'Docentes' },
      { id: 'grupos',       label: 'Grupos' },
      { id: 'materias',     label: 'Materias' },
      { id: 'asignaciones', label: 'Asignaciones' }
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
