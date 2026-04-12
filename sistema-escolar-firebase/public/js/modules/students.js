/**
 * Students Module - Firebase School Management System
 * Manages student records with filtering, pagination, and export functionality
 */

const StudentsModule = (() => {
  let allStudents = [];
  let filteredStudents = [];
  let currentPage = 1;

  // State management
  const state = {
    filters: {
      turno: 'TODOS',
      grado: 'TODOS',
      grupo: 'TODOS',
      searchText: ''
    }
  };

  /**
   * Fetch all students from Store cache
   */
  async function loadStudents() {
    try {
      allStudents = await Store.getStudents();
      // Sort by nombre completo
      allStudents.sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      return true;
    } catch (error) {
      console.error('Error loading students:', error);
      Toast.show('Error cargando estudiantes: ' + error.message, 'error');
      return false;
    }
  }

  /**
   * Apply all active filters to students
   */
  function applyFilters() {
    filteredStudents = allStudents.filter(student => {
      if (state.filters.turno !== 'TODOS' && student.turno !== state.filters.turno) {
        return false;
      }
      if (state.filters.grado !== 'TODOS' && student.grado !== parseInt(state.filters.grado)) {
        return false;
      }
      if (state.filters.grupo !== 'TODOS' && student.grupo !== state.filters.grupo) {
        return false;
      }
      if (state.filters.searchText) {
        const search = state.filters.searchText.toLowerCase();
        const fullName = (student.nombreCompleto || '').toLowerCase();
        const firstName = (student.nombres || '').toLowerCase();
        const lastName = ((student.apellido1 || '') + ' ' + (student.apellido2 || '')).toLowerCase();
        if (!fullName.includes(search) && !firstName.includes(search) && !lastName.includes(search)) {
          return false;
        }
      }
      return true;
    });
    currentPage = 1;
  }

  /**
   * Get pagination slice
   */
  function getPaginatedStudents() {
    const start = (currentPage - 1) * K.ITEMS_PER_PAGE;
    const end = start + K.ITEMS_PER_PAGE;
    return filteredStudents.slice(start, end);
  }

  /**
   * Get unique values for filters
   */
  function getFilterOptions() {
    const turnos = [...new Set(allStudents.map(s => s.turno))].filter(Boolean).sort();

    // Grados filtrados por turno seleccionado
    let gradoBase = allStudents;
    if (state.filters.turno !== 'TODOS') {
      gradoBase = gradoBase.filter(s => s.turno === state.filters.turno);
    }
    const grados = [...new Set(gradoBase.map(s => s.grado))].filter(Boolean).sort((a, b) => a - b);

    // Grupos filtrados por turno Y grado seleccionados
    let grupoBase = gradoBase;
    if (state.filters.grado !== 'TODOS') {
      grupoBase = grupoBase.filter(s => s.grado === parseInt(state.filters.grado));
    }
    const grupos = [...new Set(grupoBase.map(s => s.grupo))].filter(Boolean).sort();

    return { turnos, grados, grupos };
  }

  /**
   * Calculate statistics
   */
  function getStatistics() {
    const total = allStudents.length;
    const byTurno = {};
    const byGrado = {};
    let active = 0;
    let inactive = 0;

    allStudents.forEach(student => {
      if (student.turno) {
        byTurno[student.turno] = (byTurno[student.turno] || 0) + 1;
      }
      if (student.grado) {
        const grade = student.grado + '\u00b0';
        byGrado[grade] = (byGrado[grade] || 0) + 1;
      }
      if (student.estatus === 'ACTIVO') {
        active++;
      } else {
        inactive++;
      }
    });

    return { total, byTurno, byGrado, active, inactive };
  }

  /**
   * Render statistics bar
   */
  function renderStatsBar() {
    const stats = getStatistics();
    const matutino = stats.byTurno['MATUTINO'] || 0;
    const vespertino = stats.byTurno['VESPERTINO'] || 0;

    return `
      <div class="stats-grid">
        <div class="stat-card--compact stat-card--primary">
          <div class="stat-label">Total Estudiantes</div>
          <div class="stat-number">${stats.total}</div>
        </div>
        <div class="stat-card--compact stat-card--success">
          <div class="stat-label">Matutino</div>
          <div class="stat-number">${matutino}</div>
        </div>
        <div class="stat-card--compact stat-card--warning">
          <div class="stat-label">Vespertino</div>
          <div class="stat-number">${vespertino}</div>
        </div>
        <div class="stat-card--compact stat-card--success">
          <div class="stat-label">Activos</div>
          <div class="stat-number">${stats.active}</div>
        </div>
        <div class="stat-card--compact stat-card--danger">
          <div class="stat-label">Inactivos</div>
          <div class="stat-number">${stats.inactive}</div>
        </div>
      </div>
    `;
  }

  /**
   * Render filter bar
   */
  function renderFilterBar() {
    const options = getFilterOptions();
    const { turnos, grados, grupos } = options;

    let turnoOptions = '<option value="TODOS">Todos</option>';
    turnos.forEach(t => {
      turnoOptions += `<option value="${t}" ${state.filters.turno === t ? 'selected' : ''}>${t}</option>`;
    });

    let gradoOptions = '<option value="TODOS">Todos</option>';
    grados.forEach(g => {
      gradoOptions += `<option value="${g}" ${state.filters.grado === g ? 'selected' : ''}>${g}\u00b0</option>`;
    });

    let grupoOptions = '<option value="TODOS">Todos</option>';
    grupos.forEach(g => {
      grupoOptions += `<option value="${g}" ${state.filters.grupo === g ? 'selected' : ''}>${g}</option>`;
    });

    return `
      <div class="card filter-bar">
        <div class="filter-bar-grid">
          <div class="form-group">
            <label>Turno</label>
            <select id="filterTurno">
              ${turnoOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Grado</label>
            <select id="filterGrado">
              ${gradoOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Grupo</label>
            <select id="filterGrupo">
              ${grupoOptions}
            </select>
          </div>
        </div>
        <div class="filter-bar-grid filter-bar-grid--search">
          <div class="form-group">
            <label>Buscar por nombre</label>
            <input type="text" id="searchInput" placeholder="Ingrese nombre, apellido...">
          </div>
          <div class="filter-bar-actions">
            <button id="clearFiltersBtn" class="btn btn-outline btn-sm">
              Limpiar
            </button>
            <button id="exportBtn" class="btn btn-success btn-sm">
              Exportar Excel
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render students table
   */
  function renderStudentsTable() {
    const paginatedStudents = getPaginatedStudents();
    const totalPages = Math.ceil(filteredStudents.length / K.ITEMS_PER_PAGE);

    let rows = '';
    paginatedStudents.forEach((student, index) => {
      const rowNum = (currentPage - 1) * K.ITEMS_PER_PAGE + index + 1;
      const sexoDisplay = K.getSexLabel(student.sexo);
      const badgeClass = student.estatus === 'ACTIVO' ? 'badge-success' : 'badge-danger';

      rows += `
        <tr class="student-row" data-student-id="${student.id}">
          <td>${rowNum}</td>
          <td class="td-name">${Utils.sanitize(student.nombreCompleto || '')}</td>
          <td>${Utils.sanitize(student.grupo || '')}</td>
          <td>${student.grado || ''}\u00b0</td>
          <td>${Utils.sanitize(student.turno || '')}</td>
          <td>${sexoDisplay}</td>
          <td>
            <span class="badge ${badgeClass}">
              ${Utils.sanitize(student.estatus || '')}
            </span>
          </td>
          <td>${Utils.sanitize(student.expediente || '')}</td>
        </tr>
      `;
    });

    let paginationHtml = '';
    if (totalPages > 1) {
      let pageButtons = '';
      const maxButtons = 7;
      let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage + 1 < maxButtons) {
        startPage = Math.max(1, endPage - maxButtons + 1);
      }

      if (startPage > 1) {
        pageButtons += `<button class="btn btn-sm btn-outline page-btn" data-page="1">1</button>`;
        if (startPage > 2) {
          pageButtons += `<span class="pagination-ellipsis">...</span>`;
        }
      }

      for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        pageButtons += `
          <button class="btn btn-sm page-btn ${isActive ? 'btn-primary' : 'btn-outline'}" data-page="${i}">
            ${i}
          </button>
        `;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
          pageButtons += `<span class="pagination-ellipsis">...</span>`;
        }
        pageButtons += `<button class="btn btn-sm btn-outline page-btn" data-page="${totalPages}">${totalPages}</button>`;
      }

      paginationHtml = `
        <div class="pagination">
          <div class="pagination-info">
            Mostrando ${(currentPage - 1) * K.ITEMS_PER_PAGE + 1} a ${Math.min(currentPage * K.ITEMS_PER_PAGE, filteredStudents.length)} de ${filteredStudents.length} estudiantes
          </div>
          <div class="pagination-buttons">
            <button id="prevPage" class="btn btn-sm btn-outline" ${currentPage === 1 ? 'disabled' : ''}>\u2190 Anterior</button>
            ${pageButtons}
            <button id="nextPage" class="btn btn-sm btn-outline" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente \u2192</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="card">
        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th>#</th>
                <th>Nombre Completo</th>
                <th>Grupo</th>
                <th>Grado</th>
                <th>Turno</th>
                <th>Sexo</th>
                <th>Estatus</th>
                <th>Expediente</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
        ${paginationHtml}
      </div>
    `;
  }

  /**
   * Show student details modal
   */
  function showStudentDetails(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const sexoDisplay = K.getSexLabel(student.sexo);
    const badgeClass = student.estatus === 'ACTIVO' ? 'badge-success' : 'badge-danger';

    const bodyHtml = `
      <div class="modal-form-grid">
        <div>
          <div class="form-group">
            <label>N\u00famero de Estudiante</label>
            <div class="detail-value detail-value--lg">${student.np || '-'}</div>
          </div>
          <div class="form-group">
            <label>Nombre Completo</label>
            <div class="detail-value detail-value--lg">${Utils.sanitize(student.nombreCompleto || '-')}</div>
          </div>
          <div class="form-group">
            <label>Primer Apellido</label>
            <div class="detail-value">${Utils.sanitize(student.apellido1 || '-')}</div>
          </div>
          <div class="form-group">
            <label>Segundo Apellido</label>
            <div class="detail-value">${Utils.sanitize(student.apellido2 || '-')}</div>
          </div>
          <div class="form-group">
            <label>Nombres</label>
            <div class="detail-value">${Utils.sanitize(student.nombres || '-')}</div>
          </div>
          <div class="form-group">
            <label>CURP</label>
            <div class="detail-value detail-value--mono">${Utils.sanitize(student.curp || '-')}</div>
          </div>
        </div>
        <div>
          <div class="form-group">
            <label>Grupo</label>
            <div class="detail-value detail-value--lg">${Utils.sanitize(student.grupo || '-')}</div>
          </div>
          <div class="form-group">
            <label>Grado</label>
            <div class="detail-value detail-value--lg">${student.grado || '-'}\u00b0</div>
          </div>
          <div class="form-group">
            <label>Turno</label>
            <div class="detail-value detail-value--lg">${Utils.sanitize(student.turno || '-')}</div>
          </div>
          <div class="form-group">
            <label>Sexo</label>
            <div class="detail-value detail-value--lg">${sexoDisplay}</div>
          </div>
          <div class="form-group">
            <label>Estatus</label>
            <div><span class="badge ${badgeClass}">${Utils.sanitize(student.estatus || '-')}</span></div>
          </div>
          <div class="form-group">
            <label>Expediente</label>
            <div class="detail-value detail-value--mono">${Utils.sanitize(student.expediente || '-')}</div>
          </div>
          <div class="form-group">
            <label>Folio</label>
            <div class="detail-value detail-value--mono">${Utils.sanitize(student.folio || '-')}</div>
          </div>
        </div>
      </div>
    `;

    const isAdmin = App.currentUser?.role === 'admin';
    const isActive = student.estatus === 'ACTIVO';

    const footerHtml = `
      <div class="btn-group">
        <button class="btn btn-primary" data-action="edit-student" data-student-id="${student.id}">Editar</button>
        ${isActive ? `<button class="btn btn-warning" data-action="baja-student" data-student-id="${student.id}">Dar de Baja</button>` : ''}
        ${isAdmin ? `<button class="btn btn-danger" data-action="delete-student" data-student-id="${student.id}">Eliminar</button>` : ''}
        <button class="btn btn-outline" data-action="close-modal">Cerrar</button>
      </div>
    `;

    Modal.open(`Detalles de ${Utils.sanitize(student.nombreCompleto || 'Estudiante')}`, bodyHtml, footerHtml);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const sid = btn.dataset.studentId;

      if (action === 'close-modal') Modal.close();
      else if (action === 'edit-student') { Modal.close(); showEditStudentModal(sid); }
      else if (action === 'baja-student') { Modal.close(); showBajaModal(sid); }
      else if (action === 'delete-student') { Modal.close(); confirmDeleteStudent(sid); }
    });
  }

  /**
   * Show edit student modal
   */
  async function showEditStudentModal(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const groups = await Store.getGroups();
    let grupoOptions = '';
    groups.forEach(g => {
      const selected = g.id === student.groupId ? 'selected' : '';
      grupoOptions += `<option value="${g.id}" ${selected}>${Utils.sanitize(g.nombre || g.id)}</option>`;
    });

    const bodyHtml = `
      <div class="modal-form-grid">
        <div>
          <div class="form-group">
            <label>Nombres</label>
            <input type="text" id="editNombres" value="${Utils.sanitize(student.nombres || '')}" />
          </div>
          <div class="form-group">
            <label>Primer Apellido</label>
            <input type="text" id="editApellido1" value="${Utils.sanitize(student.apellido1 || '')}" />
          </div>
          <div class="form-group">
            <label>Segundo Apellido</label>
            <input type="text" id="editApellido2" value="${Utils.sanitize(student.apellido2 || '')}" />
          </div>
          <div class="form-group">
            <label>Sexo</label>
            <select id="editSexo">
              <option value="M" ${student.sexo === 'M' ? 'selected' : ''}>Mujer</option>
              <option value="H" ${student.sexo === 'H' ? 'selected' : ''}>Hombre</option>
            </select>
          </div>
        </div>
        <div>
          <div class="form-group">
            <label>Grupo</label>
            <select id="editGrupo">
              ${grupoOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Expediente</label>
            <input type="text" id="editExpediente" value="${Utils.sanitize(student.expediente || '')}" />
          </div>
          <div class="form-group">
            <label>Folio</label>
            <input type="text" id="editFolio" value="${Utils.sanitize(student.folio || '')}" />
          </div>
          <div class="form-group">
            <label>CURP</label>
            <input type="text" id="editCurp" value="${Utils.sanitize(student.curp || '')}" />
          </div>
        </div>
      </div>
    `;

    const footerHtml = `
      <div class="btn-group">
        <button class="btn btn-outline" data-action="close-modal">Cancelar</button>
        <button class="btn btn-primary" data-action="save-edit" data-student-id="${student.id}">Guardar Cambios</button>
      </div>
    `;

    Modal.open(`Editar: ${Utils.sanitize(student.nombreCompleto || 'Estudiante')}`, bodyHtml, footerHtml);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const sid = btn.dataset.studentId;

      if (action === 'close-modal') {
        Modal.close();
      } else if (action === 'save-edit') {
        try {
          const nombres = document.getElementById('editNombres').value.trim();
          const apellido1 = document.getElementById('editApellido1').value.trim();
          const apellido2 = document.getElementById('editApellido2').value.trim();
          const sexo = document.getElementById('editSexo').value;
          const grupoId = document.getElementById('editGrupo').value;
          const expediente = document.getElementById('editExpediente').value.trim();
          const folio = document.getElementById('editFolio').value.trim();
          const curp = document.getElementById('editCurp').value.trim();

          const nombreCompleto = `${apellido1} ${apellido2} ${nombres}`.trim();

          const updateData = {
            nombres,
            apellido1,
            apellido2,
            sexo,
            expediente,
            folio,
            curp,
            nombreCompleto
          };

          // If grupo changed, fetch group doc to get turno and grado
          if (grupoId !== student.groupId) {
            const groupDoc = await db.collection('groups').doc(grupoId).get();
            if (groupDoc.exists) {
              const groupData = groupDoc.data();
              updateData.groupId = grupoId;
              updateData.grupo = groupData.nombre || grupoId;
              updateData.turno = groupData.turno || student.turno;
              updateData.grado = groupData.grado || student.grado;
            }
          }

          await db.collection('students').doc(sid).update(updateData);
          Store.invalidate('students');
          Modal.close();
          Toast.show('Alumno actualizado', 'success');

          allStudents = await Store.getStudents(true);
          allStudents.sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
          applyFilters();
          render();
        } catch (error) {
          console.error('Error updating student:', error);
          Toast.show('Error al actualizar: ' + error.message, 'error');
        }
      }
    });
  }

  /**
   * Show baja (withdrawal) modal
   */
  function showBajaModal(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const bodyHtml = `
      <div class="modal-form-grid modal-form-grid--single">
        <div class="form-group">
          <label>Alumno</label>
          <div class="detail-value detail-value--lg">${Utils.sanitize(student.nombreCompleto || '-')}</div>
        </div>
        <div class="form-group">
          <label>Estatus Actual</label>
          <div class="detail-value">${Utils.sanitize(student.estatus || '-')}</div>
        </div>
        <div class="form-group">
          <label>Motivo de Baja</label>
          <select id="bajaReason">
            <option value="">-- Seleccione motivo --</option>
            <option value="Voluntaria">Voluntaria</option>
            <option value="Disciplinaria">Disciplinaria</option>
            <option value="Traslado">Traslado</option>
            <option value="Enfermedad">Enfermedad</option>
            <option value="Otra">Otra</option>
          </select>
        </div>
        <div class="form-group">
          <label>Detalle</label>
          <textarea id="bajaDetail" rows="3" placeholder="Detalle adicional sobre la baja..."></textarea>
        </div>
        <div class="alert alert-danger">
          Esta accion cambiara el estatus del alumno a BAJA
        </div>
      </div>
    `;

    const footerHtml = `
      <div class="btn-group">
        <button class="btn btn-outline" data-action="close-modal">Cancelar</button>
        <button class="btn btn-warning" data-action="confirm-baja" data-student-id="${student.id}">Confirmar Baja</button>
      </div>
    `;

    Modal.open(`Dar de Baja: ${Utils.sanitize(student.nombreCompleto || 'Estudiante')}`, bodyHtml, footerHtml);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const sid = btn.dataset.studentId;

      if (action === 'close-modal') {
        Modal.close();
      } else if (action === 'confirm-baja') {
        try {
          const reason = document.getElementById('bajaReason').value;
          const detail = document.getElementById('bajaDetail').value.trim();

          if (!reason) {
            Toast.show('Seleccione un motivo de baja', 'warning');
            return;
          }

          await db.collection('students').doc(sid).update({
            estatus: 'BAJA',
            bajaReason: reason,
            bajaDetails: detail,
            bajaDate: new Date(),
            bajaBy: auth.currentUser.uid
          });

          await DB.log('student_baja', {
            studentId: sid,
            studentName: student.nombreCompleto,
            reason,
            detail
          });

          Store.invalidate('students');
          Modal.close();
          Toast.show('Alumno dado de baja exitosamente', 'success');

          allStudents = await Store.getStudents(true);
          allStudents.sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
          applyFilters();
          render();
        } catch (error) {
          console.error('Error processing baja:', error);
          Toast.show('Error al procesar la baja: ' + error.message, 'error');
        }
      }
    });
  }

  /**
   * Confirm and delete student permanently
   */
  function confirmDeleteStudent(studentId) {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;

    const bodyHtml = `
      <div class="modal-form-grid modal-form-grid--single">
        <div class="alert alert-danger">
          ELIMINAR ALUMNO PERMANENTEMENTE
        </div>
        <div class="form-group">
          <label>Alumno</label>
          <div class="detail-value detail-value--lg">${Utils.sanitize(student.nombreCompleto || '-')}</div>
        </div>
        <div class="form-group">
          <label>Motivo de la eliminacion *</label>
          <textarea id="deleteReason" rows="3" placeholder="Escriba el motivo de la eliminacion..." required></textarea>
        </div>
        <div class="alert alert-danger">
          Esta accion es irreversible. El registro sera eliminado permanentemente.
        </div>
      </div>
    `;

    const footerHtml = `
      <div class="btn-group">
        <button class="btn btn-outline" data-action="close-modal">Cancelar</button>
        <button class="btn btn-danger" data-action="confirm-delete" data-student-id="${student.id}">Eliminar Permanentemente</button>
      </div>
    `;

    Modal.open(`Eliminar: ${Utils.sanitize(student.nombreCompleto || 'Estudiante')}`, bodyHtml, footerHtml);

    document.getElementById('modalFooter').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const sid = btn.dataset.studentId;

      if (action === 'close-modal') {
        Modal.close();
      } else if (action === 'confirm-delete') {
        try {
          const reason = document.getElementById('deleteReason').value.trim();

          if (!reason) {
            Toast.show('Debe ingresar un motivo para la eliminacion', 'warning');
            return;
          }

          await DB.log('delete_student', {
            studentId: sid,
            studentName: student.nombreCompleto,
            reason,
            deletedBy: auth.currentUser.email
          });

          await db.collection('students').doc(sid).delete();
          Store.invalidate('students');
          Modal.close();
          Toast.show('Alumno eliminado permanentemente', 'success');

          allStudents = await Store.getStudents(true);
          allStudents.sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
          applyFilters();
          render();
        } catch (error) {
          console.error('Error deleting student:', error);
          Toast.show('Error al eliminar: ' + error.message, 'error');
        }
      }
    });
  }

  /**
   * Export filtered students to Excel
   */
  function exportToExcel() {
    if (filteredStudents.length === 0) {
      Toast.show('No hay estudiantes para exportar', 'warning');
      return;
    }

    const exportData = filteredStudents.map((student, idx) => ({
      '#': idx + 1,
      'N\u00famero': student.np || '',
      'Nombre Completo': student.nombreCompleto || '',
      'Primer Apellido': student.apellido1 || '',
      'Segundo Apellido': student.apellido2 || '',
      'Nombres': student.nombres || '',
      'Grupo': student.grupo || '',
      'Grado': student.grado || '',
      'Turno': student.turno || '',
      'Sexo': K.getSexLabel(student.sexo),
      'Estatus': student.estatus || '',
      'CURP': student.curp || '',
      'Expediente': student.expediente || '',
      'Folio': student.folio || ''
    }));

    const filename = `Estudiantes_${new Date().toISOString().split('T')[0]}.xlsx`;
    Utils.exportToExcel(exportData, filename);
    Toast.show('Archivo exportado exitosamente', 'success');
  }

  /**
   * Attach event listeners
   */
  function attachEventListeners() {
    // Filter changes
    document.getElementById('filterTurno')?.addEventListener('change', (e) => {
      state.filters.turno = e.target.value;
      // Cascade reset: al cambiar turno, resetear grado y grupo
      state.filters.grado = 'TODOS';
      state.filters.grupo = 'TODOS';
      applyFilters();
      render();
    });

    document.getElementById('filterGrado')?.addEventListener('change', (e) => {
      state.filters.grado = e.target.value;
      // Cascade reset: al cambiar grado, resetear grupo
      state.filters.grupo = 'TODOS';
      applyFilters();
      render();
    });

    document.getElementById('filterGrupo')?.addEventListener('change', (e) => {
      state.filters.grupo = e.target.value;
      applyFilters();
      render();
    });

    document.getElementById('searchInput')?.addEventListener('input', (e) => {
      state.filters.searchText = e.target.value.trim();
      applyFilters();
      render();
    });

    // Clear filters
    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
      state.filters = {
        turno: 'TODOS',
        grado: 'TODOS',
        grupo: 'TODOS',
        searchText: ''
      };
      applyFilters();
      render();
    });

    // Export
    document.getElementById('exportBtn')?.addEventListener('click', exportToExcel);

    // Pagination
    document.getElementById('prevPage')?.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    document.getElementById('nextPage')?.addEventListener('click', () => {
      const totalPages = Math.ceil(filteredStudents.length / K.ITEMS_PER_PAGE);
      if (currentPage < totalPages) {
        currentPage++;
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    document.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        currentPage = parseInt(e.target.dataset.page);
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Student row clicks
    document.querySelectorAll('.student-row').forEach(row => {
      row.addEventListener('click', (e) => {
        const studentId = e.currentTarget.dataset.studentId;
        showStudentDetails(studentId);
      });
    });
  }

  /**
   * Render entire module
   */
  function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Gesti\u00f3n de Estudiantes</h1>
        ${renderStatsBar()}
        ${renderFilterBar()}
        ${renderStudentsTable()}
      </div>
    `;

    attachEventListeners();
  }

  /**
   * Initialize module
   */
  async function init() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container module-container--loading">
        <div class="loading-message">Cargando estudiantes...</div>
        <div class="spinner"></div>
      </div>
    `;

    const success = await loadStudents();
    if (success) {
      applyFilters();
      render();
    }
  }

  return {
    init,
    render
  };
})();

// Register module
Router.modules['students'] = () => StudentsModule.init();
