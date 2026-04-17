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
      warningMsg = `<p style="color:var(--danger);font-weight:600;">Este docente tiene ${teacherAssignments.length} asignacion(es). Se recomienda eliminarlas primero.</p>`;
    }

    const message = `
      <p>Está a punto de eliminar al docente:</p>
      <p><strong>${S(teacher.nombre)}</strong></p>
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
    'VALDES ESCALONA ROSALVA',
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
            DB.audit('editar', 'asignacion', assignment.id, {
              description: `Asignación editada: ${data.teacherName} → ${data.subjectName} (${data.groupName})`,
              after: data
            });
            Toast.show('Asignacion actualizada', 'success');
          } else {
            // ID deterministico para que las rules puedan validar permisos de maestro
            const assignmentId = `${data.teacherId}_${data.groupId}_${data.subjectId}`;
            await db.collection('assignments').doc(assignmentId).set(data);
            DB.audit('crear', 'asignacion', assignmentId, {
              description: `Asignación creada: ${data.teacherName} → ${data.subjectName} (${data.groupName})`,
              after: data
            });
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
    const message = `
      <p>Está a punto de eliminar la asignación:</p>
      <p><strong>${S(assignment.teacherName)}</strong> &rarr; ${S(assignment.subjectName)} (${S(assignment.groupName)})</p>
      <div class="alert alert-danger">Esta acción es irreversible.</div>`;

    Modal.confirmTyped('Eliminar Asignación', message, 'ELIMINAR', async () => {
      try {
        await DB.audit('eliminar', 'asignacion', assignment.id, {
          description: `Asignación eliminada: ${assignment.teacherName} → ${assignment.subjectName} (${assignment.groupName})`,
          before: { teacherName: assignment.teacherName, subjectName: assignment.subjectName, groupName: assignment.groupName }
        });
        await db.collection('assignments').doc(assignment.id).delete();
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
                    <td><strong>${S(t.nombre) || 'N/A'}</strong></td>
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

    // Build map: subjectId -> { turno -> [{teacherName, groupName}] }
    const teachersBySubject = {};
    state.assignments.forEach(a => {
      if (!teachersBySubject[a.subjectId]) teachersBySubject[a.subjectId] = {};
      const turno = a.turno || 'SIN TURNO';
      if (state.materiasFilterTurno !== 'all' && turno !== state.materiasFilterTurno) return;
      if (!teachersBySubject[a.subjectId][turno]) teachersBySubject[a.subjectId][turno] = [];
      const exists = teachersBySubject[a.subjectId][turno].some(x => x.teacherName === a.teacherName && x.groupName === a.groupName);
      if (!exists) {
        teachersBySubject[a.subjectId][turno].push({
          teacherName: a.teacherName || 'Sin asignar',
          groupName: a.groupName || a.groupId || ''
        });
      }
    });

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
                return teachers.map(tc =>
                  `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                    <span class="font-semibold" style="font-size:12px;">${S(tc.teacherName)}</span>
                    <span class="badge ${t === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino'}" style="font-size:10px;">${S(t).substring(0,3)}</span>
                    <span class="text-muted" style="font-size:11px;">${S(tc.groupName)}</span>
                  </div>`
                ).join('');
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

  // ── Tab: Carga Académica (cuadrícula visual) ──────────────────

  const renderCargaTab = () => {
    const turno = state.assignmentFilterTurno === 'all' ? '' : state.assignmentFilterTurno;
    const grado = state.assignmentFilterGrado === 'all' ? '' : state.assignmentFilterGrado;

    // Filter controls
    let html = `
      <div class="card" style="margin-bottom:16px;">
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
          // Assigned — show teacher name, clickeable to change
          const shortName = (asg.teacherName || '').split(' ').slice(0, 2).join(' ');
          return `<td style="text-align:center;cursor:pointer;padding:6px 4px;" data-action="assign-cell" data-subject-id="${sub.id}" data-subject-name="${S(sub.nombre)}" data-group-id="${grp.id}" data-group-name="${S(grp.nombre)}" data-grado="${grado}" data-turno="${turno}" data-asg-id="${asg.id}" title="Clic para cambiar: ${S(asg.teacherName)}">
            <span style="font-size:11px;font-weight:600;color:var(--color-primary);">${S(shortName)}</span>
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
          ${availableTeachers.map(t => `<option value="${t.id}" data-name="${S(t.nombre)}">${S(t.nombre)}</option>`).join('')}
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
    const grado = cell.dataset.grado;
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
          DB.audit('eliminar', 'asignacion', existingAsgId, { description: `Asignaci\u00f3n eliminada: ${subjectName} (${groupName})` });
          Toast.show('Asignaci\u00f3n eliminada', 'info');
          await invalidateAndReload('assignments');
        } catch (e) { Toast.show('Error: ' + e.message, 'error'); render(); }
        return;
      }

      if (teacherId === '__remove__') { render(); return; }

      const teacherName = select.options[select.selectedIndex]?.getAttribute('data-name') || '';

      const data = { teacherId, teacherName, subjectId, subjectName, groupId, groupName, grado, turno };

      try {
        if (existingAsgId) {
          await db.collection('assignments').doc(existingAsgId).update(data);
          DB.audit('editar', 'asignacion', existingAsgId, { description: `Asignaci\u00f3n actualizada: ${teacherName} \u2192 ${subjectName} (${groupName})` });
          Toast.show('Asignaci\u00f3n actualizada', 'success');
        } else {
          // ID deterministico para que las rules puedan validar permisos de maestro
          const assignmentId = `${data.teacherId}_${data.groupId}_${data.subjectId}`;
          await db.collection('assignments').doc(assignmentId).set(data);
          DB.audit('crear', 'asignacion', assignmentId, { description: `Asignaci\u00f3n creada: ${teacherName} \u2192 ${subjectName} (${groupName})` });
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
        case 'assign-cell': {
          _handleCellAssign(action);
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
      if (e.target.id === 'cargaTurno') {
        state.assignmentFilterTurno = e.target.value;
        state.assignmentFilterGrado = 'all';
        render();
      }
      if (e.target.id === 'cargaGrado') {
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
      case 'carga':        tabContent = renderCargaTab();        break;
    }

    const tabs = [
      { id: 'docentes',     label: 'Docentes' },
      { id: 'grupos',       label: 'Grupos y Orientadores' },
      { id: 'carga',        label: 'Carga Acad\u00e9mica' },
      { id: 'materias',     label: 'Materias' }
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
