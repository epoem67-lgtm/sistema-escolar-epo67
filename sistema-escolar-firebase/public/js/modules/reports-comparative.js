/**
 * COMPARATIVE REPORTS MODULE
 * Compare groups, subjects, shifts, and parcials with visual charts
 */

const ReportsComparativeModule = (() => {

  async function render() {
    const container = document.getElementById('moduleContainer');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Reportes Comparativos</h1>
            <p class="module-subtitle">Compara rendimiento entre grupos, materias, turnos y parciales</p>
          </div>
        </div>

        <div class="tabs" id="report-tabs">
          <button class="tab-button active" data-tab="groups">Por Grupo</button>
          <button class="tab-button" data-tab="subjects">Por Materia</button>
          <button class="tab-button" data-tab="shifts">Por Turno</button>
          <button class="tab-button" data-tab="parcials">Por Parcial</button>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label>Turno</label>
              <select id="rc-turno">
                <option value="">Todos</option>
                ${K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Grado</label>
              <select id="rc-grado">
                <option value="">Todos</option>
                ${K.GRADOS.map(g => `<option value="${g}">${g}\u00ba</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Parcial</label>
              <select id="rc-parcial">
                <option value="">Todos</option>
                ${K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="generate-report">Generar</button>
            <button class="btn btn-outline" data-action="export-report">Exportar Excel</button>
          </div>
        </div>

        <div id="rc-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">assessment</span>
            <p class="empty-state-text">Selecciona filtros y haz clic en Generar</p>
          </div>
        </div>
      </div>
    `;

    bindEvents(container);
  }

  let currentTab = 'groups';
  let lastData = null;

  async function generateReport() {
    const turno = document.getElementById('rc-turno')?.value;
    const grado = document.getElementById('rc-grado')?.value;
    const parcial = document.getElementById('rc-parcial')?.value;
    const results = document.getElementById('rc-results');

    results.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Calculando...</p></div>`;

    try {
      const [allStudents, allGrades, allGroups, allSubjects] = await Promise.all([
        Store.getStudents(),
        Store.getGrades(),
        Store.getGroups(),
        Store.getSubjects()
      ]);

      // Apply filters
      let students = allStudents.filter(s => s.estatus === 'ACTIVO');
      if (turno) students = students.filter(s => s.turno === turno);
      if (grado) students = students.filter(s => s.grado === parseInt(grado));

      let grades = allGrades;
      if (parcial) grades = grades.filter(g => g.partial === parcial);

      const studentIds = new Set(students.map(s => s.id));
      grades = grades.filter(g => studentIds.has(g.studentId));

      lastData = { students, grades, allGroups, allSubjects, turno, grado, parcial };

      switch (currentTab) {
        case 'groups': renderGroupComparison(results); break;
        case 'subjects': renderSubjectComparison(results); break;
        case 'shifts': renderShiftComparison(results); break;
        case 'parcials': renderParcialComparison(results); break;
      }
    } catch (error) {
      console.error('Error generating report:', error);
      results.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>Error al generar reporte</p></div>`;
    }
  }

  function renderGroupComparison(container) {
    const { students, grades, allGroups } = lastData;
    const byGroup = {};

    students.forEach(s => {
      if (!byGroup[s.groupId]) {
        const g = allGroups.find(gr => gr.id === s.groupId);
        byGroup[s.groupId] = { nombre: g?.nombre || s.grupo, turno: s.turno, students: [], grades: [] };
      }
      byGroup[s.groupId].students.push(s.id);
    });

    grades.forEach(g => {
      if (byGroup[g.groupId]) byGroup[g.groupId].grades.push(g.value);
    });

    const rows = Object.values(byGroup)
      .map(g => {
        const avg = g.grades.length > 0 ? g.grades.reduce((a, b) => a + b, 0) / g.grades.length : 0;
        const passed = g.grades.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
        const failed = g.grades.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
        const repPct = g.grades.length > 0 ? Math.round((failed / g.grades.length) * 100) : 0;
        return { ...g, avg, passed, failed, repPct };
      })
      .sort((a, b) => b.avg - a.avg);

    const maxAvg = Math.max(...rows.map(r => r.avg), 1);

    container.innerHTML = `
      <h3 class="section-title">Comparaci\u00f3n por Grupo</h3>
      ${renderBarChart(rows, 'nombre', 'avg', maxAvg, 10)}
      ${renderComparisonTable(rows, [
        { key: 'nombre', label: 'Grupo' },
        { key: 'turno', label: 'Turno' },
        { key: 'avg', label: 'Promedio', format: v => v.toFixed(2) },
        { key: 'passed', label: 'Aprobados' },
        { key: 'failed', label: 'Reprobados' },
        { key: 'repPct', label: '% Reprob.', format: v => v + '%' }
      ])}
    `;
  }

  function renderSubjectComparison(container) {
    const { grades, allSubjects } = lastData;
    const bySubject = {};

    grades.forEach(g => {
      if (!bySubject[g.subjectId]) {
        const s = allSubjects.find(sub => sub.id === g.subjectId);
        bySubject[g.subjectId] = { nombre: s?.nombre || g.subjectName || g.subjectId, grades: [] };
      }
      bySubject[g.subjectId].grades.push(g.value);
    });

    const rows = Object.values(bySubject)
      .map(s => {
        const avg = s.grades.length > 0 ? s.grades.reduce((a, b) => a + b, 0) / s.grades.length : 0;
        const failed = s.grades.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
        const repPct = s.grades.length > 0 ? Math.round((failed / s.grades.length) * 100) : 0;
        return { ...s, avg, total: s.grades.length, failed, repPct };
      })
      .sort((a, b) => b.avg - a.avg);

    const maxAvg = Math.max(...rows.map(r => r.avg), 1);

    container.innerHTML = `
      <h3 class="section-title">Comparaci\u00f3n por Materia</h3>
      ${renderBarChart(rows, 'nombre', 'avg', maxAvg, 10)}
      ${renderComparisonTable(rows, [
        { key: 'nombre', label: 'Materia' },
        { key: 'avg', label: 'Promedio', format: v => v.toFixed(2) },
        { key: 'total', label: 'Calificaciones' },
        { key: 'failed', label: 'Reprobados' },
        { key: 'repPct', label: '% Reprob.', format: v => v + '%' }
      ])}
    `;
  }

  function renderShiftComparison(container) {
    const { students, grades } = lastData;
    const byShift = {};

    K.TURNOS.forEach(t => {
      const shiftStudents = students.filter(s => s.turno === t);
      const shiftStudentIds = new Set(shiftStudents.map(s => s.id));
      const shiftGrades = grades.filter(g => shiftStudentIds.has(g.studentId));

      const avg = shiftGrades.length > 0 ? shiftGrades.reduce((a, g) => a + g.value, 0) / shiftGrades.length : 0;
      const failed = shiftGrades.filter(g => g.value < K.THRESHOLDS.PASS_GRADE).length;
      const repPct = shiftGrades.length > 0 ? Math.round((failed / shiftGrades.length) * 100) : 0;

      byShift[t] = { nombre: t, alumnos: shiftStudents.length, calificaciones: shiftGrades.length, avg, failed, repPct };
    });

    const rows = Object.values(byShift);

    container.innerHTML = `
      <h3 class="section-title">Comparaci\u00f3n por Turno</h3>
      <div class="stats-grid">
        ${rows.map(r => `
          <div class="card">
            <h3 class="section-title">${Utils.sanitize(r.nombre)}</h3>
            <div class="stats-grid">
              <div class="stat-card--compact"><div class="stat-number">${r.alumnos}</div><div class="stat-label">Alumnos</div></div>
              <div class="stat-card--compact"><div class="stat-number">${r.avg.toFixed(2)}</div><div class="stat-label">Promedio</div></div>
              <div class="stat-card--compact"><div class="stat-number text-danger">${r.repPct}%</div><div class="stat-label">Reprob.</div></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderParcialComparison(container) {
    const { students } = lastData;

    // Need all grades (not filtered by parcial)
    Store.getGrades().then(allGrades => {
      const studentIds = new Set(students.map(s => s.id));
      const filteredGrades = allGrades.filter(g => studentIds.has(g.studentId));

      const byParcial = {};
      K.PARCIALES.forEach(p => {
        const pGrades = filteredGrades.filter(g => g.partial === p.id);
        const avg = pGrades.length > 0 ? pGrades.reduce((a, g) => a + g.value, 0) / pGrades.length : 0;
        const failed = pGrades.filter(g => g.value < K.THRESHOLDS.PASS_GRADE).length;
        const repPct = pGrades.length > 0 ? Math.round((failed / pGrades.length) * 100) : 0;
        byParcial[p.id] = { nombre: p.nombre, calificaciones: pGrades.length, avg, failed, repPct };
      });

      const rows = Object.values(byParcial);

      container.innerHTML = `
        <h3 class="section-title">Tendencia por Parcial</h3>
        ${renderComparisonTable(rows, [
          { key: 'nombre', label: 'Parcial' },
          { key: 'calificaciones', label: 'Calificaciones' },
          { key: 'avg', label: 'Promedio', format: v => v.toFixed(2) },
          { key: 'failed', label: 'Reprobados' },
          { key: 'repPct', label: '% Reprob.', format: v => v + '%' }
        ])}
        <div class="card mt-lg">
          <h4 class="section-title">Tendencia de Promedio</h4>
          ${rows.map(r => `
            <div class="mb-md">
              <div class="flex justify-between mb-sm">
                <span class="font-semibold">${Utils.sanitize(r.nombre)}</span>
                <span class="font-semibold">${r.avg.toFixed(2)}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${r.avg >= 8 ? '' : r.avg >= 6 ? 'warning' : 'critical'}" style="width:${(r.avg / 10) * 100}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    });
  }

  // ─── HELPERS ───
  function renderBarChart(rows, labelKey, valueKey, maxValue, scale) {
    if (rows.length === 0) return '<p class="text-muted text-center">Sin datos</p>';

    return `
      <div class="card mb-lg">
        ${rows.map(r => {
          const pct = maxValue > 0 ? (r[valueKey] / scale) * 100 : 0;
          const fillClass = r[valueKey] >= 8 ? '' : r[valueKey] >= 6 ? 'warning' : 'critical';
          return `
            <div class="mb-md">
              <div class="flex justify-between mb-sm">
                <span class="font-semibold">${Utils.sanitize(String(r[labelKey]))}</span>
                <span class="font-semibold">${r[valueKey].toFixed(2)}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${fillClass}" style="width:${Math.min(pct, 100)}%"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderComparisonTable(rows, columns) {
    if (rows.length === 0) return '<p class="text-muted text-center">Sin datos</p>';

    return `
      <div class="table-container">
        <table class="table-light">
          <thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>${columns.map(c => {
                const val = r[c.key];
                const display = c.format ? c.format(val) : Utils.sanitize(String(val ?? ''));
                return `<td>${display}</td>`;
              }).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function exportReport() {
    if (!lastData) {
      Toast.show('Genera un reporte primero', 'warning');
      return;
    }
    // Flatten data for export based on current tab
    Toast.show('Exportaci\u00f3n a\u00fan en desarrollo', 'info');
  }

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        currentTab = tab.dataset.tab;
        container.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        // If we have data, re-render with new tab
        if (lastData) {
          const results = document.getElementById('rc-results');
          switch (currentTab) {
            case 'groups': renderGroupComparison(results); break;
            case 'subjects': renderSubjectComparison(results); break;
            case 'shifts': renderShiftComparison(results); break;
            case 'parcials': renderParcialComparison(results); break;
          }
        }
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'generate-report') generateReport();
      else if (btn.dataset.action === 'export-report') exportReport();
    });
  }

  return { render };
})();

Router.modules['reports-comparative'] = () => ReportsComparativeModule.render();
