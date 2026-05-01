/**
 * MY LISTS MODULE
 * Teacher's view of student lists by assigned groups
 */

const MyListsModule = (() => {
  let currentGroupId = null;
  let studentData = [];

  async function render() {
    const container = document.getElementById('moduleContainer');
    container.innerHTML = `<div class="module-container"><div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Cargando grupos...</p></div></div>`;

    try {
      const teacherDocId = await Store.getTeacherDocId();

      if (!teacherDocId) {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">person_off</span><p>No se pudo identificar al docente. Contacta al administrador.</p></div></div>`;
        return;
      }

      // getMyAssignments usa where('teacherId','==', myId): respeta firestore.rules
      const groups = await Store.getMyAssignments();

      if (groups.length === 0) {
        container.innerHTML = `<div class="module-container"><div class="empty-state"><span class="material-icons-round empty-state-icon">folder_open</span><p class="empty-state-text">No hay grupos asignados.</p></div></div>`;
        return;
      }

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Mis Grupos</h1>
              <p class="module-subtitle">Selecciona un grupo para ver la lista de estudiantes</p>
            </div>
          </div>
          <div id="groupsContainer" class="stats-grid"></div>
          <div id="studentListContainer"></div>
        </div>
      `;

      const groupsContainer = document.getElementById('groupsContainer');
      groupsContainer.innerHTML = groups.map(group => `
        <div class="assignment-card" data-action="load-students" data-group-id="${group.groupId}" data-group-name="${Utils.sanitize(group.groupName)}">
          <div class="assignment-card-title">${Utils.sanitize(group.groupName)}</div>
          <div class="assignment-card-subtitle">${Utils.sanitize(group.subjectName)}</div>
          <div class="assignment-card-tags">
            <span class="badge badge-${(group.turno || '').toLowerCase() === 'matutino' ? 'matutino' : 'vespertino'}">Turno: ${Utils.sanitize(group.turno)}</span>
            <span class="badge badge-inactive">Grado: ${Utils.sanitize(String(group.grado))}</span>
          </div>
        </div>
      `).join('');

      bindEvents();
    } catch (error) {
      console.error('Error loading groups:', error);
      container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(error.message)}</p></div></div>`;
    }
  }

  async function loadStudents(groupId, groupName) {
    currentGroupId = groupId;
    const listContainer = document.getElementById('studentListContainer');
    listContainer.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Cargando estudiantes...</p></div>`;

    try {
      // Para maestros usa query filtrada por grupo (getStudentsByGroup), respeta firestore.rules
      const allStudents = await Store.getStudentsByGroup(groupId);
      studentData = allStudents
        .filter(s => s.groupId === groupId)
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      const rows = studentData.map((student, index) => {
        const isActive = student.estatus === 'ACTIVO';
        return `
          <tr>
            <td class="text-muted">${index + 1}</td>
            <td class="font-semibold">${Utils.sanitize(student.nombreCompleto)}</td>
            <td class="text-muted">${Utils.sanitize(student.expediente || '-')}</td>
            <td class="text-muted">${Utils.sanitize(student.folio || '-')}</td>
            <td class="text-muted">${Utils.sanitize(student.sexo || '-')}</td>
            <td>${isActive ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
          </tr>
        `;
      }).join('');

      listContainer.innerHTML = `
        <div class="mt-lg">
          <div class="module-header">
            <div class="module-header-text">
              <h2 class="module-title">Estudiantes: ${Utils.sanitize(groupName)}</h2>
              <p class="module-subtitle">${studentData.length} estudiantes</p>
            </div>
            <div class="module-actions">
              <button class="btn btn-primary" data-action="print-list">Imprimir</button>
              <button class="btn btn-success" data-action="export-list">Exportar</button>
            </div>
          </div>
          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nombre</th>
                  <th>Expediente</th>
                  <th>Folio</th>
                  <th>Sexo</th>
                  <th>Estatus</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error loading students:', error);
      listContainer.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(error.message)}</p></div>`;
    }
  }

  function exportStudents() {
    if (!studentData || studentData.length === 0) {
      Toast.show('No hay estudiantes para exportar', 'warning');
      return;
    }

    const exportData = studentData.map((s, i) => ({
      '#': i + 1,
      'Nombre Completo': s.nombreCompleto,
      'Expediente': s.expediente || '',
      'Folio': s.folio || '',
      'Sexo': s.sexo || '',
      'Estatus': s.estatus === 'ACTIVO' ? 'Activo' : 'Inactivo'
    }));

    Utils.exportToExcel(exportData, `estudiantes-${currentGroupId}.xlsx`);
  }

  function printList() {
    if (!studentData || studentData.length === 0) {
      Toast.show('No hay estudiantes para imprimir', 'warning');
      return;
    }

    const rows = studentData.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${Utils.sanitize(s.nombreCompleto)}</td>
        <td>${Utils.sanitize(s.expediente || '')}</td>
        <td>${Utils.sanitize(s.folio || '')}</td>
        <td>${Utils.sanitize(s.sexo || '')}</td>
        <td>${s.estatus === 'ACTIVO' ? 'Activo' : 'Inactivo'}</td>
      </tr>
    `).join('');

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Lista de Estudiantes</title>
      <style>body{font-family:Arial,sans-serif;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:10px;text-align:left}th{background:var(--color-primary,#3182ce);color:white}tr:nth-child(even){background:#f9fafb}</style>
      </head><body><h2>Lista de Estudiantes</h2>
      <table><thead><tr><th>#</th><th>Nombre</th><th>Expediente</th><th>Folio</th><th>Sexo</th><th>Estatus</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    printWindow.document.close();
    printWindow.print();
  }

  function bindEvents() {
    document.getElementById('moduleContainer')?.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;

      const action = target.dataset.action;
      if (action === 'load-students') {
        loadStudents(target.dataset.groupId, target.dataset.groupName);
      } else if (action === 'print-list') {
        printList();
      } else if (action === 'export-list') {
        exportStudents();
      }
    });
  }

  return { render };
})();

Router.modules['my-lists'] = () => MyListsModule.render();
