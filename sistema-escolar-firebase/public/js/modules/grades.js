/**
 * MODULO DE CALIFICACIONES - Entrada de Calificaciones para Docentes y Administradores
 * Sistema Escolar EPO 67
 *
 * Proporciona:
 * - Vista de maestros: calificaciones solo de sus grupos asignados
 * - Vista de admin: calificaciones de todos los grupos con filtros avanzados
 * - Edicion inline con validaciones
 * - Pegar columna de calificaciones desde Excel
 * - Exportacion a Excel (admin)
 */

const GradesModule = (function() {
  const CONTAINER = '#moduleContainer';

  let selectedGroup = null;
  let selectedSubject = null;
  let currentPartial = 'P1';
  let students = [];
  let assignments = [];
  let grades = {};
  let _adminData = { grades: [], studentMap: {} };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function _getContainer() {
    return document.querySelector(CONTAINER);
  }

  function _delegateClick(container) {
    container.addEventListener('click', function(e) {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;

      if (action === 'open-editor') {
        api.openGradeEditor(
          target.dataset.assignmentId,
          target.dataset.groupId,
          target.dataset.subjectId
        );
      } else if (action === 'switch-partial') {
        api.switchPartial(target.dataset.partial);
      } else if (action === 'save-grades') {
        api.saveGrades();
      } else if (action === 'back-to-list') {
        api.renderTeacher();
      } else if (action === 'apply-admin-filters') {
        api.applyAdminFilters();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Teacher view
  // ---------------------------------------------------------------------------

  async function renderTeacher() {
    const container = _getContainer();
    container.innerHTML = '<div class="module-container" style="text-align:center;">Cargando asignaciones...</div>';

    try {
      const teacherDocId = await Store.getTeacherDocId();
      if (!teacherDocId) {
        container.innerHTML = `
          <div class="module-container">
            <div class="card" style="max-width:600px; margin:40px auto; text-align:center;">
              <div class="module-title">No se pudo identificar al docente</div>
              <p class="module-subtitle">Tu cuenta de usuario no esta vinculada a un registro de docente. Contacta al administrador.</p>
            </div>
          </div>`;
        return;
      }

      const snapshot = await db.collection('assignments')
        .where('teacherId', '==', teacherDocId)
        .get();

      assignments = [];
      snapshot.forEach(doc => {
        assignments.push({ id: doc.id, ...doc.data() });
      });

      let cardsHtml = '';

      if (assignments.length === 0) {
        cardsHtml = '<div class="card module-subtitle" style="grid-column:1/-1; text-align:center;">No hay asignaciones disponibles</div>';
      } else {
        assignments.forEach(asg => {
          const turnoClass = asg.turno && asg.turno.toLowerCase() === 'matutino'
            ? 'badge-matutino'
            : 'badge-vespertino';

          cardsHtml += `
            <div class="assignment-card"
                 data-action="open-editor"
                 data-assignment-id="${asg.id}"
                 data-group-id="${asg.groupId}"
                 data-subject-id="${asg.subjectId}">
              <div class="assignment-card-title">${asg.groupName}</div>
              <div class="assignment-card-subtitle">${asg.subjectName}</div>
              <div class="assignment-card-tags">
                <span class="badge ${turnoClass}">Turno: ${asg.turno}</span>
                <span class="badge">Grado: ${asg.grado}</span>
              </div>
            </div>
          `;
        });
      }

      const html = `
        <div class="module-container">
          <div>
            <h1 class="module-title">Mis Asignaciones</h1>
            <p class="module-subtitle">Selecciona una asignacion para ingresar calificaciones</p>
          </div>
          <div class="assignment-grid">
            ${cardsHtml}
          </div>
        </div>
      `;

      container.innerHTML = html;
      _delegateClick(container);
    } catch (error) {
      console.error('Error loading assignments:', error);
      Toast.show('Error al cargar asignaciones', 'error');
      container.innerHTML = '<div class="module-container module-subtitle">Error al cargar asignaciones</div>';
    }
  }

  // ---------------------------------------------------------------------------
  // Grade editor (teacher)
  // ---------------------------------------------------------------------------

  async function openGradeEditor(assignmentId, groupId, subjectId) {
    selectedGroup = groupId;
    selectedSubject = subjectId;
    currentPartial = 'P1';

    try {
      const [studentSnap, partialSnap, gradeSnap] = await Promise.all([
        db.collection('students').where('groupId', '==', groupId).get(),
        db.collection('partials').get(),
        db.collection('grades').where('groupId', '==', groupId).where('subjectId', '==', subjectId).get()
      ]);

      students = [];
      studentSnap.forEach(doc => {
        students.push({ docId: doc.id, ...doc.data() });
      });

      const partials = [];
      partialSnap.forEach(doc => {
        partials.push({ id: doc.id, ...doc.data() });
      });

      grades = {};
      gradeSnap.forEach(doc => {
        grades[doc.id] = doc.data();
      });

      _renderGradeEditor(partials);
    } catch (error) {
      console.error('Error opening grade editor:', error);
      Toast.show('Error al abrir editor de calificaciones', 'error');
    }
  }

  function _renderGradeEditor(partials) {
    const subjectId = selectedSubject;
    const container = _getContainer();

    const partialsHtml = partials.map(p => {
      const activeClass = currentPartial === p.id ? 'btn-primary' : 'btn-outline';
      return `<button class="btn ${activeClass}"
                      data-action="switch-partial"
                      data-partial="${p.id}">${p.nombre}${p.locked ? ' 🔒' : ''}</button>`;
    }).join('');

    let rowsHtml = '';
    students.forEach(student => {
      const gradeKey = `${student.docId}_${subjectId}_${currentPartial}`;
      const gradeValue = grades[gradeKey]?.value || '';
      rowsHtml += `
        <tr>
          <td>${student.nombreCompleto}</td>
          <td style="text-align:center;">
            <input type="number" min="0" max="10" value="${gradeValue}"
                   class="grade-input"
                   data-student-id="${student.docId}">
          </td>
        </tr>
      `;
    });

    const html = `
      <div class="module-container">
        <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 class="module-title">Ingreso de Calificaciones</h2>
            <p class="module-subtitle">${students.length} estudiantes</p>
          </div>
          <button class="btn btn-outline" data-action="back-to-list">Volver</button>
        </div>

        <div class="card">
          <div class="form-group">
            <label>Parcial:</label>
            <div>${partialsHtml}</div>
          </div>
        </div>

        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th style="text-align:left;">Estudiante</th>
                <th style="text-align:center;">Calificacion</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>

        <div class="stats-grid">
          <div class="stat-card--compact">
            <div class="module-subtitle">Promedio</div>
            <div class="module-title" id="stat-promedio">-</div>
          </div>
          <div class="stat-card--compact">
            <div class="module-subtitle">Aprobados (>=${K.THRESHOLDS.PASS_GRADE})</div>
            <div class="module-title" id="stat-aprobados" style="color:var(--success-color,#16a34a);">-</div>
          </div>
          <div class="stat-card--compact">
            <div class="module-subtitle">Reprobados (<${K.THRESHOLDS.PASS_GRADE})</div>
            <div class="module-title" id="stat-reprobados" style="color:var(--danger-color,#dc2626);">-</div>
          </div>
          <div class="stat-card--compact">
            <div class="module-subtitle">Sin calificacion</div>
            <div class="module-title" id="stat-sin-calif">-</div>
          </div>
        </div>

        <div style="display:flex; gap:12px; justify-content:center; margin-top:24px;">
          <button class="btn btn-primary" data-action="save-grades">Guardar Calificaciones</button>
          <button class="btn btn-outline" data-action="back-to-list">Cancelar</button>
        </div>
      </div>
    `;

    container.innerHTML = html;
    _delegateClick(container);
    _attachEditorListeners();
  }

  function _attachEditorListeners() {
    document.querySelectorAll('.grade-input').forEach(input => {
      input.addEventListener('input', () => updateStats());
    });
    updateStats();
  }

  // ---------------------------------------------------------------------------
  // Partials / stats / save
  // ---------------------------------------------------------------------------

  function switchPartial(partialId) {
    currentPartial = partialId;
    openGradeEditor(null, selectedGroup, selectedSubject);
  }

  function updateStats() {
    const inputs = document.querySelectorAll('.grade-input');
    const values = [];
    inputs.forEach(input => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) values.push(val);
    });

    const aprobados = values.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
    const reprobados = values.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    const promedio = values.length > 0
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
      : '-';

    const elPromedio = document.getElementById('stat-promedio');
    const elAprobados = document.getElementById('stat-aprobados');
    const elReprobados = document.getElementById('stat-reprobados');
    const elSinCalif = document.getElementById('stat-sin-calif');

    if (elPromedio) elPromedio.textContent = promedio;
    if (elAprobados) elAprobados.textContent = aprobados;
    if (elReprobados) elReprobados.textContent = reprobados;
    if (elSinCalif) elSinCalif.textContent = inputs.length - values.length;
  }

  async function saveGrades() {
    // Verificar que el parcial no este cerrado (con soporte para override por docente)
    try {
      const partialDoc = await db.collection('partials').doc(currentPartial).get();
      if (partialDoc.exists && partialDoc.data().locked) {
        // Verificar si el docente tiene un override activo
        const teacherDocId = await Store.getTeacherDocId();
        let hasOverride = false;
        if (teacherDocId) {
          const overrideSnap = await db.collection('partialOverrides')
            .where('partialId', '==', currentPartial)
            .where('teacherId', '==', teacherDocId)
            .limit(1)
            .get();
          if (!overrideSnap.empty) {
            const override = overrideSnap.docs[0].data();
            // Verificar si no ha expirado
            if (!override.expiresAt) {
              hasOverride = true;
            } else {
              const exp = override.expiresAt.toDate ? override.expiresAt.toDate() : new Date(override.expiresAt);
              hasOverride = exp > new Date();
            }
          }
        }
        // Admin siempre puede guardar
        if (App.currentUser?.role === 'admin') hasOverride = true;

        if (!hasOverride) {
          Toast.show('Este parcial esta cerrado. No se pueden modificar calificaciones.', 'warning');
          return;
        }
        Toast.show('Guardando con acceso especial (parcial cerrado)', 'info');
      }
    } catch (e) {
      console.warn('No se pudo verificar estado del parcial:', e);
    }

    const groupId = selectedGroup;
    const subjectId = selectedSubject;
    const userId = auth.currentUser.uid;
    const timestamp = new Date();

    const inputs = document.querySelectorAll('.grade-input');
    const batch = db.batch();
    let count = 0;

    inputs.forEach(input => {
      const value = input.value.trim();
      if (value) {
        const studentId = input.getAttribute('data-student-id');
        const gradeId = `${studentId}_${subjectId}_${currentPartial}`;
        const gradeRef = db.collection('grades').doc(gradeId);

        batch.set(gradeRef, {
          studentId,
          subjectId,
          groupId,
          partial: currentPartial,
          value: parseFloat(value),
          updatedAt: timestamp,
          updatedBy: userId
        }, { merge: true });

        count++;
      }
    });

    try {
      await batch.commit();
      Toast.show(`${count} calificaciones guardadas exitosamente`, 'success');
      renderTeacher();
    } catch (error) {
      console.error('Error saving grades:', error);
      Toast.show('Error al guardar calificaciones', 'error');
    }
  }

  // ---------------------------------------------------------------------------
  // Admin view
  // ---------------------------------------------------------------------------

  async function renderAdmin() {
    if (App.currentUser.role !== 'admin') {
      _getContainer().innerHTML =
        '<div class="module-container module-subtitle">Acceso denegado. Solo administradores.</div>';
      return;
    }

    const container = _getContainer();
    container.innerHTML = '<div class="module-container" style="text-align:center;">Cargando calificaciones...</div>';

    try {
      const [studentsSnap, assignmentsSnap, gradesSnap, partialsSnap] = await Promise.all([
        db.collection('students').get(),
        db.collection('assignments').get(),
        db.collection('grades').get(),
        db.collection('partials').get()
      ]);

      const studentMap = {};
      const assignmentMap = {};
      const gradesData = [];
      const partialsMap = {};

      studentsSnap.forEach(doc => {
        studentMap[doc.id] = { docId: doc.id, ...doc.data() };
      });
      assignmentsSnap.forEach(doc => {
        assignmentMap[doc.id] = doc.data();
      });
      gradesSnap.forEach(doc => {
        gradesData.push({ id: doc.id, ...doc.data() });
      });
      partialsSnap.forEach(doc => {
        partialsMap[doc.id] = doc.data();
      });

      _adminData = { grades: gradesData, studentMap };

      const filtersHtml = _buildFilterUI(studentMap);
      const tableHtml = _buildGradesTable(gradesData, studentMap);

      container.innerHTML = `
        <div class="module-container">
          <h1 class="module-title">Calificaciones (Admin)</h1>
          ${filtersHtml}
          <div id="admin-grades-table">${tableHtml}</div>
        </div>
      `;

      _delegateClick(container);
    } catch (error) {
      console.error('Error loading admin grades:', error);
      container.innerHTML = '<div class="module-container module-subtitle">Error al cargar calificaciones</div>';
    }
  }

  function _buildFilterUI(studentMap) {
    const turnos = [...new Set(Object.values(studentMap).map(s => s.turno))].filter(Boolean);
    const grados = [...new Set(Object.values(studentMap).map(s => s.grado))].filter(Boolean);

    return `
      <div class="filter-bar">
        <div class="filter-bar-grid">
          <div class="form-group">
            <select id="filterTurno">
              <option value="">Todos los turnos</option>
              ${turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <select id="filterGrado">
              <option value="">Todos los grados</option>
              ${grados.map(g => `<option value="${g}">Grado ${g}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" data-action="apply-admin-filters">Filtrar</button>
        </div>
      </div>
    `;
  }

  function _buildGradesTable(gradesArr, studentMap) {
    if (gradesArr.length === 0) {
      return '<div class="card module-subtitle" style="text-align:center;">No hay calificaciones registradas</div>';
    }

    let rowsHtml = '';
    gradesArr.forEach(grade => {
      const student = studentMap[grade.studentId];
      if (student) {
        const badgeClass = grade.value >= K.THRESHOLDS.PASS_GRADE
          ? 'grade-badge--pass'
          : 'grade-badge--fail';

        rowsHtml += `
          <tr>
            <td>${student.nombreCompleto || 'N/A'}</td>
            <td>${grade.groupId}</td>
            <td>${grade.subjectName || 'N/A'}</td>
            <td style="text-align:center;">${grade.partial}</td>
            <td style="text-align:center;">
              <span class="${badgeClass}">${grade.value}</span>
            </td>
          </tr>
        `;
      }
    });

    return `
      <div class="table-container">
        <table class="table-light">
          <thead>
            <tr>
              <th style="text-align:left;">Estudiante</th>
              <th style="text-align:left;">Grupo</th>
              <th style="text-align:left;">Materia</th>
              <th style="text-align:center;">Parcial</th>
              <th style="text-align:center;">Calificacion</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  function applyAdminFilters() {
    const turno = document.getElementById('filterTurno')?.value;
    const grado = document.getElementById('filterGrado')?.value;

    let filteredGrades = [..._adminData.grades];

    if (turno) {
      filteredGrades = filteredGrades.filter(g => {
        const student = _adminData.studentMap[g.studentId];
        return student && student.turno === turno;
      });
    }
    if (grado) {
      filteredGrades = filteredGrades.filter(g => {
        const student = _adminData.studentMap[g.studentId];
        return student && student.grado === parseInt(grado);
      });
    }

    const tableContainer = document.getElementById('admin-grades-table');
    if (tableContainer) {
      tableContainer.innerHTML = _buildGradesTable(filteredGrades, _adminData.studentMap);
    }
    Toast.show(`${filteredGrades.length} calificaciones mostradas`, 'info');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const api = {
    renderTeacher,
    renderAdmin,
    openGradeEditor,
    switchPartial,
    saveGrades,
    applyAdminFilters,
    updateStats
  };

  return api;
})();

// Self-register routes
Router.modules['my-grades'] = () => GradesModule.renderTeacher();
Router.modules['grades-admin'] = () => GradesModule.renderAdmin();
