/**
 * AT-RISK STUDENTS MODULE
 * Admin view: all at-risk students with filtering, detection, status tracking
 * Teacher view: students from assigned groups
 * Reports view: summary stats and CSS bar charts
 */

const AtRiskModule = (() => {
  let allAtRiskStudents = [];

  // ─── ADMIN VIEW ───
  async function renderAdmin(container) {
    try {
      if (!App.currentUser || !['admin', 'orientador'].includes(App.currentUser.role)) {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
        return;
      }

      const snap = await db.collection('atRisk').get();
      allAtRiskStudents = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const turnos = [...new Set(allAtRiskStudents.map(s => s.turno))].sort();
      const grados = [...new Set(allAtRiskStudents.map(s => s.grado))].sort((a, b) => a - b);

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Alumnos con ${K.THRESHOLDS.AT_RISK_SUBJECTS}+ materias reprobadas</p>
            </div>
            <div class="module-actions">
              <button class="btn btn-primary" data-action="update-detection">Actualizar detecci\u00f3n</button>
            </div>
          </div>

          <div class="card filter-bar">
            <div class="filter-bar-grid">
              <div class="form-group">
                <label for="filter-turno">Turno</label>
                <select id="filter-turno">
                  <option value="">Todos</option>
                  ${turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="filter-grado">Grado</label>
                <select id="filter-grado">
                  <option value="">Todos</option>
                  ${grados.map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="filter-partial">Parcial</label>
                <select id="filter-partial">
                  <option value="">Todos</option>
                  ${K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Grupo</th>
                  <th>Turno</th>
                  <th>Reprobadas</th>
                  <th>Promedio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody id="admin-table-body"></tbody>
            </table>
          </div>
        </div>
      `;

      renderAdminTable(allAtRiskStudents);
      bindAdminEvents(container);
    } catch (error) {
      console.error('Error in renderAdmin:', error);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  function renderAdminTable(students) {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted p-lg">No hay estudiantes en riesgo con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => `
      <tr>
        <td class="font-semibold">${Utils.sanitize(s.studentName || '')}</td>
        <td class="text-muted">${Utils.sanitize(s.groupId || '')}</td>
        <td class="text-muted">${Utils.sanitize(s.turno || '')}</td>
        <td>${s.subjects?.length || 0}</td>
        <td><span class="grade-badge grade-badge--fail">${s.average?.toFixed(2) || 'N/A'}</span></td>
        <td>${s.status === 'active' ? '<span class="badge badge-danger">Activo</span>' : '<span class="badge badge-success">Resuelto</span>'}</td>
      </tr>
    `).join('');
  }

  function applyAdminFilters() {
    const turno = document.getElementById('filter-turno')?.value;
    const grado = document.getElementById('filter-grado')?.value;
    const partial = document.getElementById('filter-partial')?.value;

    let filtered = [...allAtRiskStudents];
    if (turno) filtered = filtered.filter(s => s.turno === turno);
    if (grado) filtered = filtered.filter(s => s.grado === parseInt(grado));
    if (partial) filtered = filtered.filter(s => s.partial === partial);

    renderAdminTable(filtered);
  }

  function bindAdminEvents(container) {
    // Filter changes
    ['filter-turno', 'filter-grado', 'filter-partial'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyAdminFilters);
    });

    // Event delegation
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'update-detection') {
        btn.disabled = true;
        btn.textContent = 'Actualizando...';
        try {
          await detectAndFlagAtRisk();
          Toast.show('Detecci\u00f3n completada', 'success');
          // Reload
          const snap = await db.collection('atRisk').get();
          allAtRiskStudents = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          renderAdminTable(allAtRiskStudents);
        } catch (error) {
          console.error('Error in manual detection:', error);
          Toast.show('Error al actualizar detecci\u00f3n', 'error');
        }
        btn.textContent = 'Actualizar detecci\u00f3n';
        btn.disabled = false;
      }
    });
  }

  // ─── AUTO-DETECTION ───
  async function detectAndFlagAtRisk() {
    const gradesSnap = await db.collection('grades').get();
    const studentFailures = {};

    for (const gradeDoc of gradesSnap.docs) {
      const grade = gradeDoc.data();
      if (grade.value < K.THRESHOLDS.PASS_GRADE) {
        const key = grade.studentId;
        if (!studentFailures[key]) {
          studentFailures[key] = {
            studentId: grade.studentId,
            studentName: grade.studentName,
            groupId: grade.groupId,
            subjects: []
          };
        }
        studentFailures[key].subjects.push({
          subjectName: grade.subjectName,
          grade: grade.value
        });
      }
    }

    for (const [key, data] of Object.entries(studentFailures)) {
      if (data.subjects.length >= K.THRESHOLDS.AT_RISK_SUBJECTS) {
        const existingSnap = await db.collection('atRisk')
          .where('studentId', '==', data.studentId)
          .limit(1).get();

        if (existingSnap.empty) {
          const avg = data.subjects.reduce((s, x) => s + x.grade, 0) / data.subjects.length;
          await db.collection('atRisk').add({
            studentId: data.studentId,
            studentName: data.studentName,
            groupId: data.groupId,
            subjects: data.subjects,
            average: parseFloat(avg.toFixed(2)),
            status: 'active',
            flaggedBy: App.currentUser.uid,
            flaggedAt: new Date()
          });
        }
      }
    }
  }

  // ─── TEACHER VIEW ───
  async function renderTeacher(container) {
    try {
      if (!App.currentUser || App.currentUser.role !== 'maestro') {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
        return;
      }

      const snap = await db.collection('atRisk').get();
      const teacherStudents = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Mis Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Alumnos de tus grupos con ${K.THRESHOLDS.AT_RISK_SUBJECTS}+ materias reprobadas</p>
            </div>
          </div>
          <div id="teacher-list"></div>
        </div>
      `;

      const listContainer = document.getElementById('teacher-list');

      if (teacherStudents.length === 0) {
        listContainer.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">check_circle</span><p class="empty-state-text">No hay estudiantes en riesgo en tus grupos.</p></div>`;
        return;
      }

      listContainer.innerHTML = teacherStudents.map(s => `
        <div class="risk-item ${s.status === 'active' ? 'warning' : ''}">
          <div class="risk-header">
            <span class="risk-title">${Utils.sanitize(s.studentName)}</span>
            <span class="risk-badge ${s.status === 'active' ? 'warning' : ''}">${Utils.sanitize(s.status)}</span>
          </div>
          <div class="risk-description">Promedio: ${s.average?.toFixed(2) || 'N/A'}</div>
          ${s.subjects?.length ? `<div class="text-muted" style="font-size:var(--font-size-sm)">Materias: ${s.subjects.map(x => `${Utils.sanitize(x.subjectName)} (${x.grade})`).join(', ')}</div>` : ''}
        </div>
      `).join('');
    } catch (error) {
      console.error('Error in renderTeacher:', error);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─── REPORTS VIEW ───
  async function renderReports(container) {
    try {
      const snap = await db.collection('atRisk').get();
      const students = snap.docs.map(doc => doc.data());

      const byTurno = {}, byGrado = {}, byPartial = {};
      students.forEach(s => {
        byTurno[s.turno] = (byTurno[s.turno] || 0) + 1;
        byGrado[s.grado] = (byGrado[s.grado] || 0) + 1;
        byPartial[s.partial] = (byPartial[s.partial] || 0) + 1;
      });

      function buildBarChart(title, data) {
        const max = Math.max(...Object.values(data), 1);
        const bars = Object.entries(data).map(([label, count]) => `
          <div class="mb-md">
            <div class="flex justify-between mb-sm">
              <span class="font-semibold">${Utils.sanitize(String(label))}</span>
              <span class="font-semibold text-muted">${count}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${(count / max * 100)}%"></div>
            </div>
          </div>
        `).join('');

        return `
          <div class="card">
            <h3 class="section-title">${title}</h3>
            ${bars || '<p class="text-muted">Sin datos</p>'}
          </div>
        `;
      }

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Reportes de Estudiantes en Riesgo</h1>
              <p class="module-subtitle">${students.length} estudiantes identificados</p>
            </div>
          </div>
          <div class="stats-grid">
            ${buildBarChart('Por Turno', byTurno)}
            ${buildBarChart('Por Grado', byGrado)}
            ${buildBarChart('Por Parcial', byPartial)}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error in renderReports:', error);
      Toast.show('Error al cargar reportes', 'error');
    }
  }

  // ─── MODULE INIT ───
  function init() {
    Router.modules['at-risk'] = () => renderAdmin(document.getElementById('moduleContainer'));
    Router.modules['my-at-risk'] = () => renderTeacher(document.getElementById('moduleContainer'));
    Router.modules['reports'] = () => renderReports(document.getElementById('moduleContainer'));
  }

  return { init, renderAdmin, renderTeacher, renderReports };
})();

if (window.Router) {
  AtRiskModule.init();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    if (window.Router) AtRiskModule.init();
  });
}
