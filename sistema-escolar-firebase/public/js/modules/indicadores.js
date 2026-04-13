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
          <div class="module-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" data-action="presentation">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">slideshow</span>Generar Presentaci&oacute;n
            </button>
            <button class="btn btn-success" data-action="export">Exportar Excel</button>
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
      const [students, subjects, groups] = await Promise.all([
        Store.getStudents(),
        Store.getSubjects(),
        Store.getGroups()
      ]);
      allStudents = students.filter(s => s.estatus === 'ACTIVO');
      // Load grades per-group instead of entire collection
      const groupIds = groups.map(g => g.id);
      allGrades = await Store.getGradesByGroups(groupIds);
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
      else if (btn.dataset.action === 'presentation') generatePresentation();
    });

    // Cascading filter: turno/grado change updates grupo options
    const turnoEl = document.getElementById('ind-turno');
    const gradoEl = document.getElementById('ind-grado');
    if (turnoEl) turnoEl.addEventListener('change', updateGroupOptions);
    if (gradoEl) gradoEl.addEventListener('change', updateGroupOptions);
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERADOR DE PRESENTACIÓN PDF
  // Réplica exacta del formato EPO 67 con datos dinámicos
  // ═══════════════════════════════════════════════════════════════

  async function generatePresentation() {
    const turno = document.getElementById('ind-turno')?.value;
    const parcial = document.getElementById('ind-parcial')?.value;

    if (!turno) { Toast.show('Selecciona un turno', 'warning'); return; }
    if (!parcial) { Toast.show('Selecciona un parcial', 'warning'); return; }

    Toast.show('Generando presentación...', 'info');

    try {
      const [students, subjects, groups, assignments] = await Promise.all([
        Store.getStudents(), Store.getSubjects(), Store.getGroups(), Store.getAssignments()
      ]);

      const activeStudents = students.filter(s => s.estatus === 'ACTIVO' && s.turno === turno);
      const turnoGroups = groups.filter(g => g.turno === turno);
      const groupIds = turnoGroups.map(g => g.id);
      const grades = (await Store.getGradesByGroups(groupIds)).filter(g => g.partial === parcial);

      const subjectMap = {}; subjects.forEach(s => { subjectMap[s.id] = s; });
      const groupMap = {}; turnoGroups.forEach(g => { groupMap[g.id] = g; });

      const passGrade = K.THRESHOLDS.PASS_GRADE;
      const metas = App.schoolConfig?.metas || {};
      const metaP = metas.promedio_minimo || metas.promedio || 8.3;
      const metaR = metas.reprobacion_maxima || metas.reprobacion || 14;
      const metaA = metas.asistencia_minima || metas.asistencia || 80;
      const parcialObj = K.PARCIALES.find(p => p.id === parcial);
      const parcialName = parcialObj?.nombre || parcial;
      const parcNum = parcialObj?.numero || 1;
      const S = Utils.sanitize;

      // ═══ COMPUTE ═══
      const gsm = {}; // group-subject metrics
      grades.forEach(g => {
        const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : null);
        if (cal === null || cal === '' || isNaN(cal)) return;
        const key = `${g.groupId}_${g.subjectId}`;
        if (!gsm[key]) gsm[key] = {
          groupId: g.groupId, subjectId: g.subjectId,
          groupName: groupMap[g.groupId]?.nombre || g.groupId,
          subjectName: K.getUACNombre(g.subjectName || subjectMap[g.subjectId]?.nombre || g.subjectId),
          grado: groupMap[g.groupId]?.grado || 0,
          vals: [], passed: 0, failed: 0, faltas: 0, fc: 0
        };
        const m = gsm[key]; m.vals.push(cal);
        if (cal >= passGrade) m.passed++; else m.failed++;
        if (g.faltas != null) { m.faltas += Number(g.faltas); m.fc++; }
      });
      Object.values(gsm).forEach(m => {
        m.avg = m.vals.length ? +(m.vals.reduce((a,b)=>a+b,0)/m.vals.length).toFixed(2) : 0;
        m.repPct = m.vals.length ? Math.round(m.failed/m.vals.length*100) : 0;
        m.avgF = m.fc ? +(m.faltas/m.fc).toFixed(1) : 0;
      });

      const gm = {}; // group metrics
      Object.values(gsm).forEach(m => {
        if (!gm[m.groupId]) gm[m.groupId] = { id: m.groupId, name: m.groupName, grado: m.grado, vals: [], p: 0, f: 0, subs: [], tF: 0, fc: 0 };
        const g = gm[m.groupId]; g.vals.push(...m.vals); g.p += m.passed; g.f += m.failed; g.subs.push(m); g.tF += m.faltas; g.fc += m.fc;
      });
      Object.values(gm).forEach(g => {
        g.avg = g.vals.length ? +(g.vals.reduce((a,b)=>a+b,0)/g.vals.length).toFixed(2) : 0;
        g.repPct = g.vals.length ? Math.round(g.f/g.vals.length*100) : 0;
        g.avgF = g.fc ? +(g.tF/g.fc).toFixed(1) : 0;
        g.subs.sort((a,b) => a.avg - b.avg);
      });

      const grm = {}; // grade metrics
      Object.values(gm).forEach(g => {
        if (!grm[g.grado]) grm[g.grado] = { grado: g.grado, groups: [], vals: [], p: 0, f: 0 };
        grm[g.grado].groups.push(g); grm[g.grado].vals.push(...g.vals); grm[g.grado].p += g.p; grm[g.grado].f += g.f;
      });
      Object.values(grm).forEach(gr => {
        gr.avg = gr.vals.length ? +(gr.vals.reduce((a,b)=>a+b,0)/gr.vals.length).toFixed(2) : 0;
        gr.repPct = gr.vals.length ? Math.round(gr.f/gr.vals.length*100) : 0;
        gr.groups.sort((a,b) => b.avg - a.avg);
      });

      const allGS = Object.values(gsm);
      const rkAvg = [...allGS].sort((a,b)=>a.avg-b.avg).slice(0,5);
      const rkRep = [...allGS].sort((a,b)=>b.failed-a.failed).slice(0,5);
      const rkFal = [...allGS].filter(m=>m.avgF>0).sort((a,b)=>b.avgF-a.avgF).slice(0,5);

      const allVals = Object.values(gm).flatMap(g => g.vals);
      const tAvg = allVals.length ? +(allVals.reduce((a,b)=>a+b,0)/allVals.length).toFixed(2) : 0;
      const tFail = allVals.filter(v=>v<passGrade).length;
      const tRepPct = allVals.length ? Math.round(tFail/allVals.length*100) : 0;

      const sorted = Object.values(gm).sort((a,b)=>b.avg-a.avg);
      const best = sorted[0]; const worst = sorted[sorted.length-1];

      // Detect crisis group (most appearances in top 5 reprob)
      const crisisCount = {};
      rkRep.forEach(m => { crisisCount[m.groupName] = (crisisCount[m.groupName]||0)+1; });
      const crisisGroup = Object.entries(crisisCount).sort((a,b)=>b[1]-a[1])[0];
      const crisisGM = crisisGroup ? Object.values(gm).find(g => g.name === crisisGroup[0]) : worst;

      // ═══ SLIDE CSS ═══
      const css = `
@page{size:900px 506px;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.S{width:900px;height:506px;position:relative;overflow:hidden;page-break-after:always;display:flex;flex-direction:column}
.S:last-child{page-break-after:auto}

/* COVER */
.S--cover{background:linear-gradient(135deg,#0f1b2d 0%,#1a365d 40%,#2b6cb0 100%);color:#fff;justify-content:center;align-items:center;text-align:center}
.S--cover .wm{color:rgba(255,255,255,0.04)}
.cv-pre{font-size:11pt;text-transform:uppercase;letter-spacing:4px;opacity:.55;font-weight:500}
.cv-title{font-size:34pt;font-weight:800;margin:8px 0 6px;line-height:1.05}
.cv-info{font-size:11pt;opacity:.7;letter-spacing:1px}
.cv-sub{font-size:9pt;opacity:.4;margin-top:6px}
.cv-date{font-size:8.5pt;opacity:.35;margin-top:16px}
.cv-mets{display:flex;gap:24px;justify-content:center;margin-top:28px}
.cv-m{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:14px 22px;min-width:130px}
.cv-ml{font-size:7.5pt;text-transform:uppercase;letter-spacing:1.5px;opacity:.55;margin-bottom:3px}
.cv-mv{font-size:24pt;font-weight:800}
.cv-ms{font-size:8pt;opacity:.45;margin-top:2px}

/* CONTENT SLIDE */
.S--content{padding:32px 44px 24px}
.sh{font-size:8pt;text-transform:uppercase;letter-spacing:3px;color:#3182ce;font-weight:700;margin-bottom:2px}
.st{font-size:18pt;font-weight:800;color:#1a202c;margin-bottom:3px;line-height:1.15}
.ss{font-size:9.5pt;color:#718096;margin-bottom:18px;line-height:1.3}
.wm{position:absolute;bottom:10px;right:30px;font-size:72pt;font-weight:900;color:rgba(0,0,0,.018);letter-spacing:6px;pointer-events:none}

/* 3-CARD ROW (Radiografía) */
.tri{display:flex;gap:16px;margin-bottom:16px;flex:1}
.tri-c{flex:1;border-radius:10px;padding:18px 14px;text-align:center;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center}
.tri-c--green{background:#f0fff4;border:2px solid #38a169}
.tri-c--yellow{background:#fffff0;border:2px solid #d69e2e}
.tri-c--red{background:#fff5f5;border:2px solid #e53e3e}
.tri-tag{font-size:7pt;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:4px}
.tri-c--green .tri-tag{color:#276749} .tri-c--yellow .tri-tag{color:#975a16} .tri-c--red .tri-tag{color:#9b2c2c}
.tri-icon{font-size:18pt;margin-bottom:2px}
.tri-c--green .tri-icon{color:#38a169} .tri-c--yellow .tri-icon{color:#d69e2e} .tri-c--red .tri-icon{color:#e53e3e}
.tri-name{font-size:12pt;font-weight:700;color:#2d3748;margin-bottom:2px}
.tri-val{font-size:28pt;font-weight:800;line-height:1}
.tri-c--green .tri-val{color:#276749} .tri-c--yellow .tri-val{color:#975a16} .tri-c--red .tri-val{color:#c53030}
.tri-desc{font-size:8pt;color:#718096;margin-top:6px;line-height:1.3}

/* EXEC CARDS */
.ex-row{display:flex;gap:14px;margin-bottom:14px}
.ex-c{flex:1;border-radius:10px;padding:16px;text-align:center;border:2px solid #e2e8f0;background:#f7fafc}
.ex-c--ok{border-color:#38a169;background:#f0fff4}
.ex-c--bad{border-color:#e53e3e;background:#fff5f5}
.ex-v{font-size:28pt;font-weight:800;color:#1a365d;line-height:1}
.ex-c--ok .ex-v{color:#276749} .ex-c--bad .ex-v{color:#c53030}
.ex-l{font-size:9pt;font-weight:600;color:#4a5568;margin-top:4px}
.ex-m{font-size:8pt;color:#a0aec0;margin-top:1px}

/* HIGHLIGHT BAR */
.hl-row{display:flex;gap:14px}
.hl{flex:1;padding:10px 16px;border-radius:8px;font-size:10pt;display:flex;align-items:center;gap:8px}
.hl--g{background:#f0fff4;color:#276749;border-left:4px solid #38a169}
.hl--r{background:#fff5f5;color:#9b2c2c;border-left:4px solid #e53e3e}

/* TABLE */
.tb{width:100%;border-collapse:collapse;margin-top:6px}
.tb th{background:#1a202c;color:#fff;padding:7px 10px;font-size:8pt;text-align:left;text-transform:uppercase;letter-spacing:.5px}
.tb td{padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:9.5pt}
.tb tr:nth-child(even){background:#f7fafc}
.tb--lg td{padding:9px 12px;font-size:10.5pt}
.tb--lg th{padding:9px 12px;font-size:9pt}
.rn{font-weight:800;color:#3182ce;font-size:13pt}
.rv{font-weight:800;font-size:12pt}
.vd{color:#c53030;font-weight:700} .vw{color:#d69e2e;font-weight:700} .vo{color:#276749;font-weight:700}

/* NOTE */
.nt{font-size:8.5pt;color:#4a5568;margin-top:12px;padding:8px 12px;background:#f7fafc;border-left:3px solid #3182ce;border-radius:3px;line-height:1.35}

/* CRISIS */
.cr-cards{display:flex;gap:12px;margin-top:14px;flex-wrap:wrap}
.cr-c{flex:1;min-width:140px;background:#fff5f5;border:2px solid #feb2b2;border-radius:10px;padding:14px;text-align:center}
.cr-sn{font-size:9pt;font-weight:700;color:#4a5568;margin-bottom:4px}
.cr-av{font-size:10pt;color:#c53030;font-weight:700}
.cr-rp{font-size:9pt;color:#9b2c2c;margin-top:2px}

/* PLAN */
.pl-items{display:flex;flex-direction:column;gap:12px;margin-top:8px;flex:1}
.pl-i{display:flex;gap:14px;align-items:flex-start;padding:12px 16px;background:#f7fafc;border-radius:8px;border-left:4px solid #3182ce}
.pl-n{font-size:20pt;font-weight:800;color:#3182ce;line-height:1;min-width:30px}
.pl-t{font-size:10.5pt;font-weight:700;color:#1a202c;margin-bottom:2px}
.pl-d{font-size:9pt;color:#718096;line-height:1.3}

/* CLOSE METRICS */
.cl-row{display:flex;gap:16px;margin-bottom:20px}
.cl-c{flex:1;text-align:center}
.cl-v{font-size:22pt;font-weight:800;color:#fff;line-height:1}
.cl-l{font-size:8pt;text-transform:uppercase;letter-spacing:1px;opacity:.55;margin-top:6px}
.cl-s{font-size:8pt;opacity:.4;margin-top:2px}

/* PRIORITY ROW */
.pr-row{display:flex;gap:16px;margin-top:16px}
.pr-c{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:14px;text-align:center}
.pr-tag{font-size:7pt;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:6px}
.pr-c--urg .pr-tag{color:#fc8181} .pr-c--imp .pr-tag{color:#fbd38d} .pr-c--mej .pr-tag{color:#9ae6b4}
.pr-icon{font-size:16pt;margin-bottom:4px}
.pr-txt{font-size:8.5pt;opacity:.8;line-height:1.3}

@media screen{.S{border:1px solid #e2e8f0;margin:10px auto;box-shadow:0 4px 20px rgba(0,0,0,.08)}}
@media print{.S{margin:0}body{background:#fff}}`;

      // ═══ BUILD SLIDES ═══
      const sl = [];

      // ── 1. PORTADA ──
      sl.push(`<div class="S S--cover"><div class="wm">EPO 67</div>
        <div style="max-width:80%">
          <div class="cv-pre">Tabla de Control y Metas Institucionales</div>
          <div class="cv-title">Indicadores Acad&eacute;micos</div>
          <div class="cv-info">EPO 67 &middot; TURNO ${turno.toUpperCase()} &middot; CIERRE DE EVALUACI&Oacute;N ${new Date().getFullYear()}</div>
          <div class="cv-sub">Diagn&oacute;stico Estad&iacute;stico Institucional &bull; Radiograf&iacute;a acad&eacute;mica del turno</div>
          <div class="cv-mets">
            <div class="cv-m"><div class="cv-ml">Aprovechamiento</div><div class="cv-mv">${metaP}</div><div class="cv-ms">Promedio m&iacute;nimo meta</div></div>
            <div class="cv-m"><div class="cv-ml">Reprobaci&oacute;n</div><div class="cv-mv">${metaR}%</div><div class="cv-ms">Tolerancia m&aacute;xima</div></div>
            <div class="cv-m"><div class="cv-ml">Asistencia</div><div class="cv-mv">${metaA}%</div><div class="cv-ms">Permanencia requerida</div></div>
          </div>
        </div></div>`);

      // ── 2. RESUMEN EJECUTIVO ──
      sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
        <div class="sh">RESUMEN EJECUTIVO</div>
        <div class="st">Panorama General del Turno ${turno}</div>
        <div class="ss">${parcialName} &middot; ${activeStudents.length} alumnos activos &middot; ${Object.keys(gm).length} grupos &middot; ${allGS.length} asignaturas evaluadas</div>
        <div class="ex-row">
          <div class="ex-c ${tAvg>=metaP?'ex-c--ok':'ex-c--bad'}"><div class="ex-v">${tAvg.toFixed(2)}</div><div class="ex-l">Promedio General</div><div class="ex-m">Meta: ${metaP}</div></div>
          <div class="ex-c ${tRepPct<=metaR?'ex-c--ok':'ex-c--bad'}"><div class="ex-v">${tRepPct}%</div><div class="ex-l">Reprobaci&oacute;n</div><div class="ex-m">Meta: &le;${metaR}%</div></div>
          <div class="ex-c"><div class="ex-v">${allVals.length}</div><div class="ex-l">Calificaciones</div><div class="ex-m">${Object.keys(gm).length} grupos</div></div>
          <div class="ex-c"><div class="ex-v">${activeStudents.length}</div><div class="ex-l">Alumnos Activos</div><div class="ex-m">${allGS.length} materias</div></div>
        </div>
        <div class="hl-row">
          <div class="hl hl--g"><strong>&#9650;</strong> Mejor grupo: <strong>${S(best?.name||'-')}</strong> &mdash; ${best?.avg?.toFixed(2)||'-'}</div>
          <div class="hl hl--r"><strong>&#9660;</strong> Grupo cr&iacute;tico: <strong>${S(worst?.name||'-')}</strong> &mdash; ${worst?.avg?.toFixed(2)||'-'}</div>
        </div></div>`);

      // ── 3-5. RADIOGRAFÍA POR GRADO ──
      [1,2,3].forEach(grado => {
        const gr = grm[grado];
        if (!gr || gr.groups.length === 0) return;
        const cap = {1:'PRIMER',2:'SEGUNDO',3:'TERCER'}[grado];
        const ldr = gr.groups[0]; // best
        const mid = gr.groups.length > 2 ? gr.groups[Math.floor(gr.groups.length/2)] : null;
        const weak = gr.groups[gr.groups.length-1]; // worst

        // Determine cards
        let cards = '';
        if (gr.groups.length >= 3) {
          // Leader / Vulnerability / Red Flag
          const tagFor = g => g.avg >= metaP ? 'green' : g.avg >= 7 ? 'yellow' : 'red';
          const labFor = g => g.avg >= metaP ? 'L&Iacute;DER DEL GRADO' : g.avg >= 7 ? 'VULNERABILIDAD' : 'FOCO ROJO';
          const icoFor = g => g.avg >= metaP ? '&#9650;' : g.avg >= 7 ? '&#9888;' : '&#9660;';
          const descFor = g => g.avg >= metaP ? 'Mejor desempe&ntilde;o del grado' : g.avg >= 7 ? `${g.repPct}% reprobaci&oacute;n` : 'Requiere intervenci&oacute;n inmediata';
          cards = gr.groups.map(g => `<div class="tri-c tri-c--${tagFor(g)}">
            <div class="tri-tag">${labFor(g)}</div><div class="tri-icon">${icoFor(g)}</div>
            <div class="tri-name">${S(g.name)}</div><div class="tri-val">${g.avg.toFixed(2)}</div>
            <div class="tri-desc">${descFor(g)}</div></div>`).join('');
        } else {
          cards = gr.groups.map(g => {
            const t = g.avg >= metaP ? 'green' : g.avg >= 7 ? 'yellow' : 'red';
            return `<div class="tri-c tri-c--${t}"><div class="tri-tag">${g.avg>=metaP?'SOBRESALIENTE':'ATENCI&Oacute;N'}</div>
              <div class="tri-name">${S(g.name)}</div><div class="tri-val">${g.avg.toFixed(2)}</div>
              <div class="tri-desc">${g.repPct}% reprob. &middot; ${g.f} alumnos</div></div>`;
          }).join('');
        }

        // Critical subjects
        const crit = allGS.filter(m=>m.grado===grado).sort((a,b)=>a.avg-b.avg).slice(0,3);
        const critRows = crit.map(m=>`<tr><td>${S(m.groupName)}</td><td>${S(m.subjectName)}</td><td class="${m.avg<7?'vd':'vw'}">${m.avg.toFixed(2)}</td><td class="${m.failed>10?'vd':''}">${m.failed}</td><td>${m.avgF}</td></tr>`).join('');

        sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
          <div class="sh">CAP&Iacute;TULO ${grado}</div>
          <div class="st">Radiograf&iacute;a Cl&iacute;nica &bull; ${cap} Grado</div>
          <div class="ss">Promedio del grado: <strong>${gr.avg.toFixed(2)}</strong> &middot; Reprobaci&oacute;n: <strong>${gr.repPct}%</strong></div>
          <div class="tri">${cards}</div>
          <div><div style="font-size:8pt;text-transform:uppercase;letter-spacing:2px;color:#718096;font-weight:700;margin-bottom:4px">Materias cr&iacute;ticas del grado</div>
          <table class="tb"><tr><th>Grupo</th><th>Materia</th><th>Prom.</th><th>Reprob.</th><th>Faltas</th></tr>${critRows}</table></div>
        </div>`);
      });

      // ── 6. RANKING PROMEDIOS BAJOS ──
      const rkAvgRows = rkAvg.map((m,i)=>`<tr><td class="rn">${i+1}</td><td>${S(m.groupName)}</td><td>${S(m.subjectName)}</td><td class="vd rv">${m.avg.toFixed(2)}</td><td>${m.failed}</td><td>${m.repPct}%</td></tr>`).join('');
      sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
        <div class="sh">RANKING &middot; PROMEDIOS BAJOS</div>
        <div class="st">Top 5 de Vulnerabilidad &bull; Promedios</div>
        <div class="ss">Materias con los promedios m&aacute;s bajos del turno ${turno}</div>
        <table class="tb tb--lg"><tr><th>#</th><th>Grupo</th><th>Materia</th><th>Promedio</th><th>Reprob.</th><th>% Reprob.</th></tr>${rkAvgRows}</table>
      </div>`);

      // ── 7. RANKING REPROBACIÓN ──
      const rkRepRows = rkRep.map((m,i)=>`<tr><td class="rn">${i+1}</td><td>${S(m.groupName)}</td><td>${S(m.subjectName)}</td><td class="vd rv">${m.failed}</td><td>${m.avg.toFixed(2)}</td><td>${m.repPct}%</td></tr>`).join('');
      const repNote = crisisGroup && crisisGroup[1] >= 3
        ? `<div class="nt">El grupo <strong>${S(crisisGroup[0])}</strong> concentra ${crisisGroup[1]} de las 5 materias con mayor reprobaci&oacute;n. Requiere intervenci&oacute;n prioritaria.</div>` : '';
      sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
        <div class="sh">RANKING &middot; REPROBACI&Oacute;N</div>
        <div class="st">Top 5 de Vulnerabilidad &bull; Reprobados</div>
        <div class="ss">Materias con mayor cantidad de alumnos no acreditados</div>
        <table class="tb tb--lg"><tr><th>#</th><th>Grupo</th><th>Materia</th><th>Reprob.</th><th>Prom.</th><th>% Reprob.</th></tr>${rkRepRows}</table>
        ${repNote}
      </div>`);

      // ── 8. GRUPO EN CRISIS ──
      if (crisisGM) {
        const top4 = crisisGM.subs.slice(0, 4);
        const crCards = top4.map(m => `<div class="cr-c"><div class="cr-sn">${S(m.subjectName)}</div><div class="cr-av">Promedio ${m.avg.toFixed(2)}</div><div class="cr-rp">${m.failed} reprobados</div></div>`).join('');
        sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
          <div class="sh">GRUPO EN CRISIS</div>
          <div class="st">Foco Rojo: ${S(crisisGM.name)}</div>
          <div class="ss">El epicentro del riesgo acad&eacute;mico &middot; Promedio ${crisisGM.avg.toFixed(2)} &middot; ${crisisGM.repPct}% reprobaci&oacute;n</div>
          <div class="cr-cards">${crCards}</div>
          <div class="nt">Este grupo requiere un plan de intervenci&oacute;n acad&eacute;mica inmediata con tutor&iacute;as, seguimiento semanal y comunicaci&oacute;n con tutores.</div>
        </div>`);
      }

      // ── 9. RANKING FALTAS ──
      if (rkFal.length > 0) {
        const rkFalRows = rkFal.map((m,i)=>`<tr><td class="rn">${i+1}</td><td>${S(m.groupName)}</td><td>${S(m.subjectName)}</td><td class="vd rv">${m.avgF}</td><td>${m.avg.toFixed(2)}</td><td>${m.failed}</td></tr>`).join('');
        sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
          <div class="sh">RANKING &middot; INASISTENCIA</div>
          <div class="st">Top 5 &bull; Mayor Ausentismo</div>
          <div class="ss">Materias con m&aacute;s faltas promedio por alumno</div>
          <table class="tb tb--lg"><tr><th>#</th><th>Grupo</th><th>Materia</th><th>Faltas Prom.</th><th>Prom. Calif.</th><th>Reprob.</th></tr>${rkFalRows}</table>
        </div>`);
      }

      // ── 10. COMPARATIVO POR GRUPO ──
      const compRows = sorted.map(g => {
        const ac = g.avg>=metaP?'vo':g.avg>=7?'vw':'vd';
        const rc = g.repPct<=metaR?'vo':'vd';
        return `<tr><td style="font-weight:700">${S(g.name)}</td><td>${g.grado}&ordm;</td><td class="${ac}" style="font-weight:700">${g.avg.toFixed(2)}</td><td>${g.p}</td><td>${g.f}</td><td class="${rc}" style="font-weight:700">${g.repPct}%</td><td>${g.avgF}</td></tr>`;
      }).join('');
      sl.push(`<div class="S S--content"><div class="wm">EPO 67</div>
        <div class="sh">COMPARATIVO POR GRUPO</div>
        <div class="st">Todos los Grupos del Turno</div>
        <div class="ss">${turno} &middot; ${parcialName} &middot; ${sorted.length} grupos</div>
        <table class="tb tb--lg"><tr><th>Grupo</th><th>Grado</th><th>Prom.</th><th>Aprob.</th><th>Reprob.</th><th>% Reprob.</th><th>Faltas</th></tr>${compRows}</table>
      </div>`);

      // ── 11. CIERRE ──
      sl.push(`<div class="S S--cover"><div class="wm">EPO 67</div>
        <div style="max-width:85%;text-align:center">
          <div class="cv-pre">CIERRE &middot; EPO 67 ${turno.toUpperCase()}</div>
          <div class="cv-title" style="font-size:26pt;margin:8px 0 18px">Resumen Ejecutivo del Turno</div>
          <div class="cl-row">
            <div class="cl-c"><div class="cl-v">${best?.avg?.toFixed(2)||'-'}</div><div class="cl-l">Mejor Grupo</div><div class="cl-s">${S(best?.name||'')}</div></div>
            <div class="cl-c"><div class="cl-v">${tAvg.toFixed(2)}</div><div class="cl-l">Promedio Turno</div><div class="cl-s">${sorted.length} grupos</div></div>
            <div class="cl-c"><div class="cl-v">${rkRep[0]?.failed||0}</div><div class="cl-l">Reprob. M&aacute;x.</div><div class="cl-s">${S(rkRep[0]?.subjectName||'')}</div></div>
            <div class="cl-c"><div class="cl-v">${tRepPct}%</div><div class="cl-l">Reprobaci&oacute;n</div><div class="cl-s">Meta: ${metaR}%</div></div>
          </div>
          <div class="pr-row">
            <div class="pr-c pr-c--urg"><div class="pr-tag">Urgente</div><div class="pr-icon">&#9888;</div><div class="pr-txt">${crisisGM?'Atenci&oacute;n al '+S(crisisGM.name):'Revisar grupos cr&iacute;ticos'}</div></div>
            <div class="pr-c pr-c--imp"><div class="pr-tag">Importante</div><div class="pr-icon">&#9733;</div><div class="pr-txt">Seguimiento de asistencia y tutor&iacute;as</div></div>
            <div class="pr-c pr-c--mej"><div class="pr-tag">Mejora Continua</div><div class="pr-icon">&#10003;</div><div class="pr-txt">Optimizaci&oacute;n de captura y an&aacute;lisis</div></div>
          </div>
          <div class="cv-date" style="margin-top:20px">Generado por Sistema Escolar EPO 67 &middot; ${new Date().toLocaleDateString('es-MX',{year:'numeric',month:'long',day:'numeric'})}</div>
        </div></div>`);

      // ── 12. GRACIAS ──
      sl.push(`<div class="S S--cover"><div class="wm">EPO 67</div>
        <div style="text-align:center">
          <div class="cv-title" style="font-size:36pt;margin-bottom:12px">&iexcl;Gracias!</div>
          <div class="cv-info" style="font-size:12pt;opacity:.75">Juntos construimos el futuro de nuestros alumnos.</div>
          <div class="cv-mets" style="margin-top:32px">
            <div class="cv-m"><div class="cv-ml">EPO 67</div><div class="cv-mv" style="font-size:14pt">${new Date().getFullYear()}</div></div>
            <div class="cv-m"><div class="cv-ml">Turno</div><div class="cv-mv" style="font-size:14pt">${turno}</div></div>
            <div class="cv-m"><div class="cv-ml">Evaluaci&oacute;n</div><div class="cv-mv" style="font-size:14pt">${parcialName}</div></div>
            <div class="cv-m"><div class="cv-ml">Compromiso</div><div class="cv-mv" style="font-size:14pt">Institucional</div></div>
          </div>
        </div></div>`);

      // ═══ ASSEMBLE ═══
      const doc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Indicadores ${turno} - ${parcialName} - EPO 67</title>
<style>${css}</style></head><body>
${sl.join('\n')}
<script>setTimeout(()=>window.print(),600)<\/script>
</body></html>`;

      const w = window.open('', '_blank');
      w.document.write(doc);
      w.document.close();
      Toast.show('Presentaci\u00f3n generada', 'success');
    } catch (e) {
      console.error('Error generando presentaci\u00f3n:', e);
      Toast.show('Error: ' + e.message, 'error');
    }
  }

  return { render };
})();

Router.modules['indicadores'] = () => IndicadoresModule.render();
