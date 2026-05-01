/**
 * ENROLLMENT MODULE
 * Student enrollment management with filtering, status tracking, and group changes
 */

const EnrollmentModule = (() => {
  let allStudents = [];
  let filteredStudents = [];
  let allGroups = [];
  let filters = { turno: '', grado: '', grupo: '' };

  async function loadStudents() {
    try {
      allStudents = await Store.getStudents();
      applyFilters();
    } catch (error) {
      Toast.show('Error al cargar estudiantes', 'error');
      console.error(error);
    }
  }

  async function loadGroups() {
    try {
      allGroups = await Store.getGroups();
      return allGroups;
    } catch (error) {
      console.error('Error loading groups:', error);
      return [];
    }
  }

  function applyFilters() {
    filteredStudents = allStudents.filter(s => {
      if (filters.turno && s.turno !== filters.turno) return false;
      if (filters.grado && s.grado !== parseInt(filters.grado)) return false;
      if (filters.grupo && s.grupo !== filters.grupo) return false;
      return true;
    });

    const tableContainer = document.getElementById('enrollmentTableContainer');
    if (tableContainer) tableContainer.innerHTML = renderTable();

    const statsContainer = document.getElementById('enrollmentStatsContainer');
    if (statsContainer) statsContainer.innerHTML = renderStats();
  }

  function getStats() {
    return {
      total: filteredStudents.length,
      activos: filteredStudents.filter(s => s.estatus === 'ACTIVO').length,
      bajas: filteredStudents.filter(s => s.estatus === 'BAJA').length
    };
  }

  function renderStats() {
    const stats = getStats();
    return `
      <div class="stats-grid">
        <div class="stat-card--bordered">
          <div class="stat-label">Total</div>
          <div class="stat-number">${stats.total}</div>
        </div>
        <div class="stat-card--bordered success">
          <div class="stat-label">Activos</div>
          <div class="stat-number text-success">${stats.activos}</div>
        </div>
        <div class="stat-card--bordered danger">
          <div class="stat-label">Bajas</div>
          <div class="stat-number text-danger">${stats.bajas}</div>
        </div>
      </div>
    `;
  }

  function renderFilters() {
    const turnos = [...new Set(allStudents.map(s => s.turno).filter(Boolean))].sort();
    const grados = [...new Set(allStudents.map(s => s.grado).filter(Boolean))].sort((a, b) => a - b);
    const grupos = [...new Set(allStudents.map(s => s.grupo).filter(Boolean))].sort();

    return `
      <div class="card filter-bar">
        <div class="filter-bar-grid">
          <div class="form-group">
            <label for="filterTurno">Turno</label>
            <select id="filterTurno">
              <option value="">Todos los turnos</option>
              ${turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="filterGrado">Grado</label>
            <select id="filterGrado">
              <option value="">Todos los grados</option>
              ${grados.map(g => `<option value="${g}">${g}\u00ba grado</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="filterGrupo">Grupo</label>
            <select id="filterGrupo">
              <option value="">Todos los grupos</option>
              ${grupos.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  function renderTable() {
    if (filteredStudents.length === 0) {
      return `<div class="empty-state"><span class="material-icons-round empty-state-icon">people</span><p class="empty-state-text">No hay estudiantes con los filtros seleccionados</p></div>`;
    }

    const rows = filteredStudents.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="font-semibold">${Utils.sanitize(s.nombreCompleto || '')}</td>
        <td>${Utils.sanitize(s.turno || '-')}</td>
        <td>${s.grado || '-'}\u00ba - ${Utils.sanitize(s.grupo || '-')}</td>
        <td>${s.estatus === 'ACTIVO' ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Baja</span>'}</td>
        <td>
          <div class="btn-group">
            <button class="btn-action" data-action="edit-group" data-student-id="${s.id}">Grupo</button>
            <button class="btn-action" data-action="toggle-status" data-student-id="${s.id}">Status</button>
          </div>
        </td>
      </tr>
    `).join('');

    return `
      <div class="table-container">
        <table class="table-light">
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre Completo</th>
              <th>Turno</th>
              <th>Grado - Grupo</th>
              <th>Estatus</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async function openNewEnrollmentModal() {
    const groups = await loadGroups();
    const groupOptions = groups.map(g => `<option value="${g.id}">${Utils.sanitize(g.turno || '')} - ${g.grado || ''}\u00ba ${Utils.sanitize(g.nombre || g.grupo)}</option>`).join('');

    const bodyHTML = `
      <div class="modal-form-grid">
        <div class="form-group">
          <label>Nombres *</label>
          <input type="text" id="enrollNombres" placeholder="Ej: Juan Carlos">
        </div>
        <div class="form-group">
          <label>Apellido Paterno *</label>
          <input type="text" id="enrollApellido1" placeholder="Ej: Garc\u00eda">
        </div>
        <div class="form-group">
          <label>Apellido Materno</label>
          <input type="text" id="enrollApellido2" placeholder="Ej: L\u00f3pez">
        </div>
        <div class="form-group">
          <label>Sexo</label>
          <select id="enrollSexo">
            <option value="">Seleccionar</option>
            <option value="M">Masculino</option>
            <option value="F">Femenino</option>
          </select>
        </div>
        <div class="form-group">
          <label>Grupo *</label>
          <select id="enrollGrupo">
            <option value="">Seleccionar grupo</option>
            ${groupOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Expediente</label>
          <input type="text" id="enrollExpediente" placeholder="N\u00famero">
        </div>
        <div class="form-group">
          <label>Folio</label>
          <input type="text" id="enrollFolio" placeholder="N\u00famero">
        </div>
        <div class="form-group">
          <label>CURP</label>
          <input type="text" id="enrollCurp" placeholder="CURP">
        </div>
        <div class="form-group">
          <label>Nombre del Tutor</label>
          <input type="text" id="enrollTutor" placeholder="Nombre completo del tutor">
        </div>
        <div class="form-group">
          <label>Domicilio de Contacto</label>
          <input type="text" id="enrollDireccion" placeholder="Calle, n\u00famero, colonia, municipio">
        </div>
        <div class="form-group">
          <label>Tel\u00e9fono de Contacto</label>
          <input type="tel" id="enrollTelefono" placeholder="Ej: 55 1234 5678">
        </div>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelEnrollment">Cancelar</button>
      <button class="btn btn-primary" id="confirmEnrollment">Guardar Inscripci\u00f3n</button>
    `;

    Modal.open('Nueva Inscripci\u00f3n', bodyHTML, footerHTML);
    document.getElementById('cancelEnrollment').addEventListener('click', () => Modal.close());
    document.getElementById('confirmEnrollment').addEventListener('click', saveEnrollment);
  }

  async function saveEnrollment() {
    const nombres = document.getElementById('enrollNombres').value.trim();
    const apellido1 = document.getElementById('enrollApellido1').value.trim();
    const apellido2 = document.getElementById('enrollApellido2').value.trim();
    const sexo = document.getElementById('enrollSexo').value;
    const groupId = document.getElementById('enrollGrupo').value;
    const expediente = document.getElementById('enrollExpediente').value.trim();
    const folio = document.getElementById('enrollFolio').value.trim();
    const curp = document.getElementById('enrollCurp').value.trim();
    const tutorNombre = document.getElementById('enrollTutor').value.trim();
    const direccionContacto = document.getElementById('enrollDireccion').value.trim();
    const telefonoContacto = document.getElementById('enrollTelefono').value.trim();

    if (!nombres || !apellido1 || !groupId) {
      Toast.show('Completa los campos obligatorios (*)', 'warning');
      return;
    }

    try {
      const groupDoc = await db.collection('groups').doc(groupId).get();
      const groupData = groupDoc.data();

      // Coerce grado a Number siempre — evita el bug de "dos terceros" en dropdowns
      // cuando un grupo trae el campo como string.
      const gradoNum = Number(groupData.grado);
      const studentData = {
        nombres, apellido1, apellido2,
        nombreCompleto: `${apellido1} ${apellido2} ${nombres}`.trim(),
        sexo,
        grupo: groupData.nombre,
        groupId,
        grado: Number.isFinite(gradoNum) ? gradoNum : groupData.grado,
        turno: groupData.turno,
        expediente, folio, curp,
        tutorNombre, direccionContacto, telefonoContacto,
        estatus: 'ACTIVO',
        createdAt: new Date()
      };
      const ref = await db.collection('students').add(studentData);

      DB.audit('crear', 'alumno', ref.id, {
        description: `Alumno inscrito: ${studentData.nombreCompleto} en ${groupData.nombre}`,
        after: { nombre: studentData.nombreCompleto, grupo: groupData.nombre, turno: groupData.turno, grado: groupData.grado }
      });

      Modal.close();
      Toast.show('Estudiante inscrito exitosamente', 'success');
      Store.invalidate('students');
      allStudents = await Store.getStudents(true);
      applyFilters();
    } catch (error) {
      Toast.show('Error al guardar inscripci\u00f3n', 'error');
      console.error(error);
    }
  }

  async function editGroup(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const groups = await loadGroups();
    const groupOptions = groups.map(g => `<option value="${g.id}" ${g.id === student.groupId ? 'selected' : ''}>${Utils.sanitize(g.turno)} - ${g.grado}\u00ba ${Utils.sanitize(g.nombre)}</option>`).join('');

    const bodyHTML = `
      <div class="form-group">
        <label>Alumno</label>
        <input type="text" value="${Utils.sanitize(student.nombreCompleto)}" disabled>
      </div>
      <div class="form-group">
        <label>Nuevo Grupo *</label>
        <select id="newGroupId">${groupOptions}</select>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelEditGroup">Cancelar</button>
      <button class="btn btn-primary" id="confirmEditGroup">Cambiar Grupo</button>
    `;

    Modal.open('Cambiar Grupo de Alumno', bodyHTML, footerHTML);
    document.getElementById('cancelEditGroup').addEventListener('click', () => Modal.close());
    document.getElementById('confirmEditGroup').addEventListener('click', async () => {
      const newGroupId = document.getElementById('newGroupId').value;
      if (!newGroupId) { Toast.show('Selecciona un grupo', 'warning'); return; }
      try {
        const groupDoc = await db.collection('groups').doc(newGroupId).get();
        const groupData = groupDoc.data();
        const gradoNum = Number(groupData.grado);
        await db.collection('students').doc(studentId).update({
          grupo: groupData.nombre, groupId: newGroupId,
          grado: Number.isFinite(gradoNum) ? gradoNum : groupData.grado,
          turno: groupData.turno
        });
        Modal.close();
        Toast.show('Grupo actualizado correctamente', 'success');
        Store.invalidate('students');
        allStudents = await Store.getStudents(true);
        applyFilters();
      } catch (error) {
        Toast.show('Error al cambiar grupo', 'error');
        console.error(error);
      }
    });
  }

  async function toggleStatus(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const newStatus = student.estatus === 'ACTIVO' ? 'BAJA' : 'ACTIVO';

    if (newStatus === 'BAJA') {
      // Dar de baja: confirmacion tipada + motivo
      const message = `
        <div style="margin-bottom:12px;">
          Alumno: <strong>${Utils.sanitize(student.nombreCompleto)}</strong>
        </div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Motivo de Baja</label>
          <select id="enrBajaReason">
            <option value="">-- Seleccione motivo --</option>
            <option value="Voluntaria">Voluntaria</option>
            <option value="Disciplinaria">Disciplinaria</option>
            <option value="Traslado">Traslado</option>
            <option value="Enfermedad">Enfermedad</option>
            <option value="Otra">Otra</option>
          </select>
        </div>
        <div class="alert alert-danger" style="margin-top:8px;">
          <strong>PRECAUCIÓN</strong> — Escriba <strong>BAJA</strong> para confirmar.
        </div>
      `;

      Modal.confirmTyped('Dar de Baja', message, 'BAJA', async () => {
        try {
          const reason = document.getElementById('enrBajaReason')?.value || '';
          if (!reason) {
            Toast.show('Seleccione un motivo de baja', 'warning');
            return;
          }

          await db.collection('students').doc(studentId).update({
            estatus: 'BAJA',
            bajaReason: reason,
            bajaDate: new Date(),
            bajaBy: auth.currentUser.uid
          });

          DB.audit('editar', 'alumno', studentId, {
            description: `Baja desde inscripciones: ${student.nombreCompleto}`,
            before: { estatus: 'ACTIVO' },
            after: { estatus: 'BAJA', bajaReason: reason }
          });

          Toast.show('Alumno dado de baja', 'success');
          Modal.close();
          Store.invalidate('students');
          allStudents = await Store.getStudents(true);
          applyFilters();
        } catch (error) {
          Toast.show('Error al cambiar estatus', 'error');
          console.error(error);
        }
      });
    } else {
      // Reactivar: confirmacion simple
      Modal.confirm(
        'Reactivar Alumno',
        `¿Reactivar a <strong>${Utils.sanitize(student.nombreCompleto)}</strong>?<br>Su estatus cambiará de <span class="badge badge-danger">BAJA</span> a <span class="badge badge-success">ACTIVO</span>.`,
        async () => {
          try {
            await db.collection('students').doc(studentId).update({
              estatus: 'ACTIVO',
              reactivadoPor: auth.currentUser.uid,
              reactivadoFecha: new Date()
            });

            DB.audit('editar', 'alumno', studentId, {
              description: `Alumno reactivado desde inscripciones: ${student.nombreCompleto}`,
              before: { estatus: 'BAJA' },
              after: { estatus: 'ACTIVO' }
            });

            Toast.show('Alumno reactivado exitosamente', 'success');
            Modal.close();
            Store.invalidate('students');
            allStudents = await Store.getStudents(true);
            applyFilters();
          } catch (error) {
            Toast.show('Error al reactivar', 'error');
            console.error(error);
          }
        }
      );
    }
  }

  function bindEvents() {
    document.getElementById('filterTurno')?.addEventListener('change', (e) => {
      filters.turno = e.target.value;
      applyFilters();
    });
    document.getElementById('filterGrado')?.addEventListener('change', (e) => {
      filters.grado = e.target.value;
      applyFilters();
    });
    document.getElementById('filterGrupo')?.addEventListener('change', (e) => {
      filters.grupo = e.target.value;
      applyFilters();
    });

    // Event delegation for table actions and header button
    document.getElementById('moduleContainer')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, studentId } = btn.dataset;
      if (action === 'new-enrollment') openNewEnrollmentModal();
      else if (action === 'edit-group') editGroup(studentId);
      else if (action === 'toggle-status') toggleStatus(studentId);
    });
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Inscripciones</h1>
            <p class="module-subtitle">Gestiona inscripciones, cambios de grupo y estatus</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-primary" data-action="new-enrollment">+ Nueva Inscripci\u00f3n</button>
          </div>
        </div>
        <div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Cargando...</p></div>
      </div>
    `;

    await loadStudents();

    const enrollmentContainer = container.querySelector('.module-container');
    if (enrollmentContainer) {
      // Re-render with data (keep the header)
      enrollmentContainer.innerHTML = `
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Inscripciones</h1>
            <p class="module-subtitle">Gestiona inscripciones, cambios de grupo y estatus</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-primary" data-action="new-enrollment">+ Nueva Inscripci\u00f3n</button>
          </div>
        </div>
        <div id="enrollmentStatsContainer">${renderStats()}</div>
        ${renderFilters()}
        <div id="enrollmentTableContainer">${renderTable()}</div>
      `;
    }

    bindEvents();
  }

  return { render };
})();

Router.modules['enrollment'] = () => EnrollmentModule.render();
