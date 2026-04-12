/**
 * INDICADORES INSTITUCIONALES MODULE
 * Dashboard comparando metricas reales vs metas institucionales.
 * Promedios por grupo/materia, reprobacion, graficas CSS y tabla comparativa.
 */

const IndicadoresModule = (() => {

  // ─── STATE ───
  let allStudents = [];
  let allGrades = [];
  let allSubjects = [];
  let allGroups = [];

  // ─── RENDER ───
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
    const gradoOptions = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba Grado</option>`).join('');
    const parcialOptions = K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Indicadores Institucionales</h1>
            <p class="module-subtitle">Comparativo de metricas reales vs metas establecidas</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-success" data-action="export">Exportar Indicadores</button>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="ind-turno">Turno</label>
              <select id="ind-turno">
                <option value="">Todos los turnos</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="ind-grado">Grado</label>
              <select id="ind-grado">
                <option value="">Todos los grados</option>
                ${gradoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="ind-grupo">Grupo</label>
              <select id="ind-grupo">
                <option value="">Todos los grupos</option>
              </select>
            </div>
            <div class="form-group">
              <label for="ind-parcial">Parcial</label>
              <select id="ind-parcial">
                <option value="">Todos</option>
                ${parcialOptions}
              </select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="calculate">Calcular</button>
          </div>
        </div>

        <div id="ind-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">analytics</span>
            <p class="empty-state-text">Selecciona los filtros y haz clic en Calcular</p>
          </div>
        </div>
      </div>
    `;

    await loadData();
    bindEvents(container);
  }

  // ─── DATA LOADING ───
  async function loadData() {
    try {
      const [students, grades, subjects, groups] = await Promise.all([
        Store.getStudents(),
        Store.getGrades(),
        Store.getSubjects(),
        Store.getGroups()
      ]);
      allStudents = students.filter(s => s.estatus === 'ACTIVO');
      allGrades = grades;
      allSubjects = subjects;
      allGroups = groups;
      updateGroupOptions();
    } catch (e) {
      console.error('Error cargando datos de indicadores:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─── CASCADING FILTERS ───
  function updateGroupOptions() {
    const turno = document.getElementById('ind-turno')?.value;
    const grado = document.getElementById('ind-grado')?.value;
    const grupoSelect = document.getElementById('ind-grupo');
    if (!grupoSelect) return;

    let filtered = [...allGroups];
    if (turno) filtered = filtered.filter(g => g.turno === turno);
    if (grado) filtered = filtered.filter(g => String(g.grado) === String(grado));

    const nombres = [...new Set(filtered.map(g => g.nombre || g.grupo))].filter(Boolean).sort();
    grupoSelect.innerHTML = `<option value="">Todos los grupos</option>` +
      nombres.map(n => `<option value="${n}">${n}</option>`).join('');
  }

  // ─── CALCULATE ───
  function calculate() {
    const resultsDiv = document.getElementById('ind-results');
    if (!resultsDiv) return;

    resultsDiv.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Calculando indicadores...</p></div>`;

    try {
      const turno = document.getElementById('ind-turno')?.value;
      const grado = document.getElementById('ind-grado')?.value;
      const grupo = document.getElementById('ind-grupo')?.value;
      const parcial = document.getElementById('ind-parcial')?.value;

      // Filter students
      let filteredStudents = [...allStudents];
      if (turno) filteredStudents = filteredStudents.filter(s => s.turno === turno);
      if (grado) filteredStudents = filteredStudents.filter(s => String(s.grado) === String(grado));
      if (grupo) filteredStudents = filteredStudents.filter(s => s.grupo === grupo);

      const studentIds = new Set(filteredStudents.map(s => s.id));

      // Filter grades
      let filteredGrades = allGrades.filter(g => studentIds.has(g.studentId));
      if (parcial) filteredGrades = filteredGrades.filter(g => g.partial === parcial);

      if (filteredStudents.length === 0 || filteredGrades.length === 0) {
        resultsDiv.innerHTML = `
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">search_off</span>
            <p class="empty-state-text">No hay datos para los filtros seleccionados.</p>
          </div>`;
        return;
      }

      // Build student map for quick lookup
      const studentMap = {};
      filteredStudents.forEach(s => { studentMap[s.id] = s; });

      // Compute per-student averages
      const gradesByStudent = {};
      filteredGrades.forEach(g => {
        if (g.value === undefined || g.value === null) return;
        if (!gradesByStudent[g.studentId]) gradesByStudent[g.studentId] = [];
        gradesByStudent[g.studentId].push(g);
      });

      const studentAverages = [];
      for (const [sid, grds] of Object.entries(gradesByStudent)) {
        const student = studentMap[sid];
        if (!student) continue;
        const avg = grds.reduce((sum, g) => sum + g.value, 0) / grds.length;
        studentAverages.push({
          studentId: sid,
          student: student,
          average: Math.round(avg * 100) / 100,
          grades: grds
        });
      }

      // Collect unique subjects used
      const subjectNames = {};
      filteredGrades.forEach(g => {
        if (g.subjectId) subjectNames[g.subjectId] = g.subjectName || g.subjectId;
      });

      // Global metrics
      const passGrade = K.THRESHOLDS.PASS_GRADE;
      const totalEvaluated = studentAverages.length;
      const generalAvg = totalEvaluated > 0
        ? Math.round((studentAverages.reduce((s, sa) => s + sa.average, 0) / totalEvaluated) * 100) / 100
        : 0;
      const failedCount = studentAverages.filter(sa => sa.average < passGrade).length;
      const reprobPct = totalEvaluated > 0 ? Math.round((failedCount / totalEvaluated) * 10000) / 100 : 0;

      // Goals from schoolConfig
      const metas = App.schoolConfig?.metas || {};
      const metaPromedio = metas.promedio || 8.3;
      const metaReprob = metas.reprobacion || 14;

      // ─── SUMMARY CARDS ───
      const avgColor = generalAvg >= metaPromedio ? 'success' : 'danger';
      const reprobColor = reprobPct <= metaReprob ? 'success' : 'danger';

      let html = `
        <div class="stats-grid">
          <div class="stat-card stat-card--bordered">
            <div class="stat-content">
              <div class="stat-label">Promedio General</div>
              <div class="stat-number" style="color: var(--color-${avgColor})">${generalAvg.toFixed(2)}</div>
              <div class="stat-label">Meta: ${metaPromedio}</div>
            </div>
          </div>
          <div class="stat-card stat-card--bordered">
            <div class="stat-content">
              <div class="stat-label">Reprobacion</div>
              <div class="stat-number" style="color: var(--color-${reprobColor})">${reprobPct}%</div>
              <div class="stat-label">Meta: ${metaReprob}%</div>
            </div>
          </div>
          <div class="stat-card stat-card--bordered">
            <div class="stat-content">
              <div class="stat-label">Alumnos Evaluados</div>
              <div class="stat-number">${totalEvaluated}</div>
            </div>
          </div>
          <div class="stat-card stat-card--bordered">
            <div class="stat-content">
              <div class="stat-label">Total Materias</div>
              <div class="stat-number">${Object.keys(subjectNames).length}</div>
            </div>
          </div>
        </div>
      `;

      // ─── AGGREGATE BY GROUP ───
      const byGroup = {};
      studentAverages.forEach(sa => {
        const grp = sa.student.grupo || 'Sin grupo';
        if (!byGroup[grp]) byGroup[grp] = { students: [], totalAvg: 0, passed: 0, failed: 0 };
        byGroup[grp].students.push(sa);
        if (sa.average >= passGrade) byGroup[grp].passed++;
        else byGroup[grp].failed++;
      });
      for (const key of Object.keys(byGroup)) {
        const g = byGroup[key];
        g.totalAvg = g.students.length > 0
          ? Math.round((g.students.reduce((s, sa) => s + sa.average, 0) / g.students.length) * 100) / 100
          : 0;
        g.reprobPct = g.students.length > 0
          ? Math.round((g.failed / g.students.length) * 10000) / 100
          : 0;
      }

      // ─── AGGREGATE BY SUBJECT ───
      const bySubject = {};
      filteredGrades.forEach(g => {
        if (g.value === undefined || g.value === null) return;
        const subId = g.subjectId || 'unknown';
        const subName = g.subjectName || subId;
        if (!bySubject[subId]) bySubject[subId] = { name: subName, values: [], passed: 0, failed: 0 };
        bySubject[subId].values.push(g.value);
        if (g.value >= passGrade) bySubject[subId].passed++;
        else bySubject[subId].failed++;
      });
      for (const key of Object.keys(bySubject)) {
        const sub = bySubject[key];
        sub.avg = sub.values.length > 0
          ? Math.round((sub.values.reduce((s, v) => s + v, 0) / sub.values.length) * 100) / 100
          : 0;
        sub.reprobPct = sub.values.length > 0
          ? Math.round((sub.failed / sub.values.length) * 10000) / 100
          : 0;
      }

      // ─── CHART: PROMEDIOS POR GRUPO ───
      const groupEntries = Object.entries(byGroup).sort((a, b) => a[0].localeCompare(b[0]));
      html += `<div class="card"><h3 class="section-title">Promedios por Grupo</h3>`;
      if (groupEntries.length > 0) {
        html += groupEntries.map(([name, data]) => {
          const pct = Math.min((data.totalAvg / 10) * 100, 100);
          const color = data.totalAvg >= 8 ? 'var(--color-success)' : data.totalAvg >= 6 ? 'var(--color-warning)' : 'var(--color-danger)';
          return `
            <div class="mb-md">
              <div class="flex justify-between mb-sm">
                <span class="font-semibold">${Utils.sanitize(name)}</span>
                <span class="font-semibold">${data.totalAvg.toFixed(2)}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
              </div>
            </div>`;
        }).join('');
      } else {
        html += '<p class="text-muted">Sin datos</p>';
      }
      html += '</div>';

      // ─── CHART: PROMEDIOS POR MATERIA ───
      const subjectEntries = Object.entries(bySubject)
        .sort((a, b) => b[1].avg - a[1].avg);
      html += `<div class="card"><h3 class="section-title">Promedios por Materia</h3>`;
      if (subjectEntries.length > 0) {
        html += subjectEntries.map(([, data]) => {
          const pct = Math.min((data.avg / 10) * 100, 100);
          const color = data.avg >= 8 ? 'var(--color-success)' : data.avg >= 6 ? 'var(--color-warning)' : 'var(--color-danger)';
          return `
            <div class="mb-md">
              <div class="flex justify-between mb-sm">
                <span class="font-semibold">${Utils.sanitize(data.name)}</span>
                <span class="font-semibold">${data.avg.toFixed(2)}</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
              </div>
            </div>`;
        }).join('');
      } else {
        html += '<p class="text-muted">Sin datos</p>';
      }
      html += '</div>';

      // ─── CHART: REPROBACION POR GRUPO ───
      html += `<div class="card"><h3 class="section-title">Reprobacion por Grupo</h3>`;
      if (groupEntries.length > 0) {
        const maxReprob = Math.max(...groupEntries.map(([, d]) => d.reprobPct), 1);
        html += groupEntries.map(([name, data]) => {
          const pct = maxReprob > 0 ? (data.reprobPct / maxReprob) * 100 : 0;
          const color = data.reprobPct <= metaReprob ? 'var(--color-success)' : 'var(--color-danger)';
          return `
            <div class="mb-md">
              <div class="flex justify-between mb-sm">
                <span class="font-semibold">${Utils.sanitize(name)}</span>
                <span class="font-semibold">${data.reprobPct}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${pct}%; background: ${color}"></div>
              </div>
            </div>`;
        }).join('');
      } else {
        html += '<p class="text-muted">Sin datos</p>';
      }
      html += '</div>';

      // ─── COMPARISON TABLE: BY GROUP ───
      html += `
        <div class="card">
          <h3 class="section-title">Comparativo por Grupo</h3>
          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th class="text-center">Promedio</th>
                  <th class="text-center">Aprobados</th>
                  <th class="text-center">Reprobados</th>
                  <th class="text-center">% Reprobacion</th>
                </tr>
              </thead>
              <tbody>`;
      groupEntries.forEach(([name, data]) => {
        const avgClass = data.totalAvg >= metaPromedio ? 'grade-badge--good' : 'grade-badge--fail';
        const repClass = data.reprobPct <= metaReprob ? 'grade-badge--good' : 'grade-badge--fail';
        html += `
          <tr>
            <td class="font-semibold">${Utils.sanitize(name)}</td>
            <td class="text-center"><span class="grade-badge ${avgClass}">${data.totalAvg.toFixed(2)}</span></td>
            <td class="text-center">${data.passed}</td>
            <td class="text-center">${data.failed}</td>
            <td class="text-center"><span class="grade-badge ${repClass}">${data.reprobPct}%</span></td>
          </tr>`;
      });
      html += `</tbody></table></div></div>`;

      // ─── COMPARISON TABLE: BY SUBJECT ───
      html += `
        <div class="card">
          <h3 class="section-title">Comparativo por Materia</h3>
          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Materia</th>
                  <th class="text-center">Promedio</th>
                  <th class="text-center">Aprobados</th>
                  <th class="text-center">Reprobados</th>
                  <th class="text-center">% Reprobacion</th>
                </tr>
              </thead>
              <tbody>`;
      subjectEntries.forEach(([, data]) => {
        const total = data.passed + data.failed;
        const avgClass = data.avg >= metaPromedio ? 'grade-badge--good' : 'grade-badge--fail';
        const repClass = data.reprobPct <= metaReprob ? 'grade-badge--good' : 'grade-badge--fail';
        html += `
          <tr>
            <td class="font-semibold">${Utils.sanitize(data.name)}</td>
            <td class="text-center"><span class="grade-badge ${avgClass}">${data.avg.toFixed(2)}</span></td>
            <td class="text-center">${data.passed}</td>
            <td class="text-center">${data.failed}</td>
            <td class="text-center"><span class="grade-badge ${repClass}">${data.reprobPct}%</span></td>
          </tr>`;
      });
      html += `</tbody></table></div></div>`;

      resultsDiv.innerHTML = html;
    } catch (e) {
      console.error('Error calculando indicadores:', e);
      resultsDiv.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(e.message)}</p></div>`;
      Toast.show('Error al calcular indicadores', 'error');
    }
  }

  // ─── EXPORT ───
  function exportIndicadores() {
    const resultsDiv = document.getElementById('ind-results');
    if (!resultsDiv || resultsDiv.querySelector('.empty-state')) {
      Toast.show('Calcula primero los indicadores', 'warning');
      return;
    }

    try {
      const turno = document.getElementById('ind-turno')?.value;
      const grado = document.getElementById('ind-grado')?.value;
      const grupo = document.getElementById('ind-grupo')?.value;
      const parcial = document.getElementById('ind-parcial')?.value;
      const passGrade = K.THRESHOLDS.PASS_GRADE;

      // Filter students
      let filteredStudents = [...allStudents];
      if (turno) filteredStudents = filteredStudents.filter(s => s.turno === turno);
      if (grado) filteredStudents = filteredStudents.filter(s => String(s.grado) === String(grado));
      if (grupo) filteredStudents = filteredStudents.filter(s => s.grupo === grupo);

      const studentIds = new Set(filteredStudents.map(s => s.id));
      let filteredGrades = allGrades.filter(g => studentIds.has(g.studentId));
      if (parcial) filteredGrades = filteredGrades.filter(g => g.partial === parcial);

      const studentMap = {};
      filteredStudents.forEach(s => { studentMap[s.id] = s; });

      // Per-student averages
      const gradesByStudent = {};
      filteredGrades.forEach(g => {
        if (g.value === undefined || g.value === null) return;
        if (!gradesByStudent[g.studentId]) gradesByStudent[g.studentId] = [];
        gradesByStudent[g.studentId].push(g.value);
      });

      const exportData = [];
      for (const [sid, vals] of Object.entries(gradesByStudent)) {
        const student = studentMap[sid];
        if (!student) continue;
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
        exportData.push({
          'Alumno': student.nombreCompleto || '',
          'Grupo': student.grupo || '',
          'Turno': student.turno || '',
          'Grado': student.grado || '',
          'Materias Evaluadas': vals.length,
          'Promedio': Math.round(avg * 100) / 100,
          'Estatus': avg >= passGrade ? 'Aprobado' : 'Reprobado'
        });
      }

      exportData.sort((a, b) => (a['Grupo'] || '').localeCompare(b['Grupo'] || '') || (a['Alumno'] || '').localeCompare(b['Alumno'] || ''));

      const filename = `Indicadores_${new Date().toISOString().split('T')[0]}.xlsx`;
      Utils.exportToExcel(exportData, filename);
    } catch (e) {
      console.error('Error exportando indicadores:', e);
      Toast.show('Error al exportar indicadores', 'error');
    }
  }

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'calculate') calculate();
      else if (btn.dataset.action === 'export') exportIndicadores();
    });

    // Cascading filter: turno/grado change updates grupo options
    const turnoEl = document.getElementById('ind-turno');
    const gradoEl = document.getElementById('ind-grado');
    if (turnoEl) turnoEl.addEventListener('change', updateGroupOptions);
    if (gradoEl) gradoEl.addEventListener('change', updateGroupOptions);
  }

  return { render };
})();

Router.modules['indicadores'] = () => IndicadoresModule.render();
