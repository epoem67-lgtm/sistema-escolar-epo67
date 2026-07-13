/**
 * INDICADORES INSTITUCIONALES v2 — Sistema Escolar EPO 67
 *
 * Panel analitico con 4 tabs:
 *   1. Panorama General — KPIs, dona de distribucion, barras por grupo
 *   2. Comparativa entre Grupos — barras agrupadas, radar, ranking
 *   3. Materias con Retos — heatmap, top criticas, correlacion faltas
 *   4. Tendencias por Parcial — lineas de evolucion
 *
 * Usa Chart.js para graficos interactivos.
 * Preserva generatePresentation() para PDF.
 */

const IndicadoresModule = (() => {

  const CONTAINER = '#moduleContainer';
  const COLORS = ['#3182ce','#e53e3e','#38a169','#d69e2e','#805ad5','#dd6b20','#319795','#d53f8c','#718096'];

  let allStudents = [], allGrades = [], allSubjects = [], allGroups = [];
  let _charts = []; // Track chart instances for cleanup

  function _destroyCharts() { _charts.forEach(c => c.destroy()); _charts.length = 0; }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    _destroyCharts();

    const turnoOpts = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
    const gradoOpts = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba</option>`).join('');
    const parcialOpts = K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Indicadores Institucionales</h1>
            <p class="module-subtitle">Analisis de datos academicos</p>
          </div>
          <div class="module-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" data-action="presentation"><span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">slideshow</span>Presentacion PDF</button>
            <button class="btn btn-success" data-action="export">Exportar Excel</button>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));">
            <div class="form-group"><label>Turno</label><select id="ind-turno"><option value="">Todos</option>${turnoOpts}</select></div>
            <div class="form-group"><label>Grado</label><select id="ind-grado"><option value="">Todos</option>${gradoOpts}</select></div>
            <div class="form-group"><label>Grupo</label><select id="ind-grupo"><option value="">Todos</option></select></div>
            <div class="form-group"><label>Parcial</label><select id="ind-parcial"><option value="">Todos</option>${parcialOpts}</select></div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="calculate">Calcular</button>
          </div>
        </div>

        <!-- TABS -->
        <div id="ind-tabs" style="display:none;">
          <div class="card" style="padding:0;margin-bottom:0;">
            <div style="display:flex;border-bottom:2px solid #e2e8f0;overflow-x:auto;">
              <button class="ind-tab active" data-tab="panorama" style="flex:1;padding:12px 16px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid #3182ce;color:#3182ce;white-space:nowrap;">Panorama General</button>
              <button class="ind-tab" data-tab="comparativa" style="flex:1;padding:12px 16px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#718096;white-space:nowrap;">Comparativa Grupos</button>
              <button class="ind-tab" data-tab="materias" style="flex:1;padding:12px 16px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#718096;white-space:nowrap;">Materias con Retos</button>
              <button class="ind-tab" data-tab="tendencias" style="flex:1;padding:12px 16px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#718096;white-space:nowrap;">Tendencias</button>
            </div>
          </div>
          <div id="ind-tab-content" style="margin-top:16px;"></div>
        </div>

        <div id="ind-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">analytics</span>
            <p class="empty-state-text">Selecciona los filtros y haz clic en Calcular</p>
          </div>
        </div>
      </div>`;

    await loadData();
    bindEvents(container);
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA
  // ═══════════════════════════════════════════════════════════════
  async function loadData() {
    try {
      const [students, subjects, groups] = await Promise.all([
        Store.getStudents(), Store.getSubjects(), Store.getGroups()
      ]);
      allStudents = students.filter(s => s.estatus === 'ACTIVO');
      const groupIds = groups.map(g => g.id);
      allGrades = await Store.getGradesByGroups(groupIds, true);
      allSubjects = subjects;
      allGroups = groups;
      updateGroupOptions();
    } catch (e) {
      console.error('Error:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  function updateGroupOptions() {
    const turno = document.getElementById('ind-turno')?.value;
    const grado = document.getElementById('ind-grado')?.value;
    const sel = document.getElementById('ind-grupo');
    if (!sel) return;
    let filtered = [...allGroups];
    if (turno) filtered = filtered.filter(g => g.turno === turno);
    if (grado) filtered = filtered.filter(g => String(g.grado) === String(grado));
    const nombres = [...new Set(filtered.map(g => g.nombre || g.grupo))].filter(Boolean).sort();
    sel.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${n}">${n}</option>`).join('');
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE COMPUTE
  // ═══════════════════════════════════════════════════════════════
  function _compute(turno, grado, grupo, parcial) {
    let students = [...allStudents];
    if (turno) students = students.filter(s => s.turno === turno);
    if (grado) students = students.filter(s => String(s.grado) === String(grado));
    if (grupo) students = students.filter(s => s.grupo === grupo);

    const studentIds = new Set(students.map(s => s.id));
    const studentMap = {}; students.forEach(s => { studentMap[s.id] = s; });
    const groupNameMap = {}; allGroups.forEach(g => { groupNameMap[g.id] = g.nombre || g.id; });

    let grades = allGrades.filter(g => studentIds.has(g.studentId));
    if (parcial) grades = grades.filter(g => g.partial === parcial);

    const pass = K.THRESHOLDS.PASS_GRADE;
    const metas = App.schoolConfig?.metas || {};
    const metaP = metas.promedio_minimo || metas.promedio || 8.3;
    const metaR = metas.reprobacion_maxima || metas.reprobacion || 14;

    // Per-student averages
    const byStudent = {};
    grades.forEach(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Number(g.value) : null);
      if (cal === null || isNaN(cal)) return;
      if (!byStudent[g.studentId]) byStudent[g.studentId] = [];
      byStudent[g.studentId].push({ ...g, cal });
    });

    const studentAvgs = [];
    for (const [sid, grds] of Object.entries(byStudent)) {
      const st = studentMap[sid]; if (!st) continue;
      const avg = grds.reduce((s, g) => s + g.cal, 0) / grds.length;
      studentAvgs.push({ sid, student: st, avg: Math.round(avg * 100) / 100, grades: grds });
    }

    // By group
    const byGroup = {};
    studentAvgs.forEach(sa => {
      const gid = sa.student.groupId || 'x';
      const name = groupNameMap[gid] || sa.student.grupo || gid;
      const key = (sa.student.turno || '') + '_' + name;
      if (!byGroup[key]) byGroup[key] = { name, turno: sa.student.turno || '', grado: sa.student.grado, students: [], vals: [], p: 0, f: 0, faltas: 0, fc: 0 };
      const bg = byGroup[key]; bg.students.push(sa); bg.vals.push(sa.avg);
      if (sa.avg >= pass) bg.p++; else bg.f++;
    });
    Object.values(byGroup).forEach(bg => {
      bg.avg = bg.vals.length ? +(bg.vals.reduce((a, b) => a + b, 0) / bg.vals.length).toFixed(2) : 0;
      bg.repPct = bg.vals.length ? Math.round(bg.f / bg.vals.length * 100) : 0;
    });

    // By subject
    const bySubject = {};
    grades.forEach(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Number(g.value) : null);
      if (cal === null || isNaN(cal)) return;
      const sid = g.subjectId || 'x';
      if (!bySubject[sid]) bySubject[sid] = { name: K.getUACNombre(g.subjectName || sid), vals: [], p: 0, f: 0, faltas: 0, fc: 0 };
      const bs = bySubject[sid]; bs.vals.push(cal);
      if (cal >= pass) bs.p++; else bs.f++;
      if (g.faltas != null) { bs.faltas += Number(g.faltas); bs.fc++; }
    });
    Object.values(bySubject).forEach(bs => {
      bs.avg = bs.vals.length ? +(bs.vals.reduce((a, b) => a + b, 0) / bs.vals.length).toFixed(2) : 0;
      bs.repPct = bs.vals.length ? Math.round(bs.f / bs.vals.length * 100) : 0;
      bs.avgF = bs.fc ? +(bs.faltas / bs.fc).toFixed(1) : 0;
    });

    // By group+subject (for heatmap)
    const byGS = {};
    grades.forEach(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Number(g.value) : null);
      if (cal === null || isNaN(cal)) return;
      const gName = groupNameMap[g.groupId] || g.groupId;
      const sName = K.getUACNombre(g.subjectName || g.subjectId);
      const key = gName + '|' + g.subjectId;
      if (!byGS[key]) byGS[key] = { group: gName, subject: sName, subjectId: g.subjectId, vals: [], faltas: 0, fc: 0 };
      byGS[key].vals.push(cal);
      if (g.faltas != null) { byGS[key].faltas += Number(g.faltas); byGS[key].fc++; }
    });
    Object.values(byGS).forEach(gs => {
      gs.avg = gs.vals.length ? +(gs.vals.reduce((a, b) => a + b, 0) / gs.vals.length).toFixed(2) : 0;
      gs.avgF = gs.fc ? +(gs.faltas / gs.fc).toFixed(1) : 0;
    });

    // Distribution of grades
    const dist = { 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
    grades.forEach(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Number(g.value) : null);
      if (cal === null || isNaN(cal)) return;
      const bin = Math.min(Math.max(Math.round(cal), 5), 10);
      dist[bin] = (dist[bin] || 0) + 1;
    });

    const totalEval = studentAvgs.length;
    const genAvg = totalEval ? +(studentAvgs.reduce((s, sa) => s + sa.avg, 0) / totalEval).toFixed(2) : 0;
    const failCount = studentAvgs.filter(sa => sa.avg < pass).length;
    const repPct = totalEval ? Math.round(failCount / totalEval * 100) : 0;

    return { students, grades, studentAvgs, byGroup, bySubject, byGS, dist, genAvg, repPct, totalEval, metaP, metaR, pass, studentMap, groupNameMap };
  }

  // ═══════════════════════════════════════════════════════════════
  // CALCULATE + TAB SYSTEM
  // ═══════════════════════════════════════════════════════════════
  let _currentData = null;
  let _currentTab = 'panorama';

  function calculate() {
    _destroyCharts();
    const turno = document.getElementById('ind-turno')?.value;
    const grado = document.getElementById('ind-grado')?.value;
    const grupo = document.getElementById('ind-grupo')?.value;
    const parcial = document.getElementById('ind-parcial')?.value;

    const data = _compute(turno, grado, grupo, parcial);
    if (data.totalEval === 0) {
      document.getElementById('ind-tabs').style.display = 'none';
      document.getElementById('ind-results').innerHTML = UI.emptyState('search_off', 'No hay datos para los filtros seleccionados.');
      return;
    }

    _currentData = data;
    document.getElementById('ind-results').innerHTML = '';
    document.getElementById('ind-tabs').style.display = '';
    _currentTab = 'panorama';
    _activateTab('panorama');
    _renderTab();
  }

  function _activateTab(tab) {
    document.querySelectorAll('.ind-tab').forEach(t => {
      const isActive = t.dataset.tab === tab;
      t.style.borderBottomColor = isActive ? '#3182ce' : 'transparent';
      t.style.color = isActive ? '#3182ce' : '#718096';
      if (isActive) t.classList.add('active'); else t.classList.remove('active');
    });
    _currentTab = tab;
  }

  function _renderTab() {
    _destroyCharts();
    const el = document.getElementById('ind-tab-content');
    if (!el || !_currentData) return;

    switch (_currentTab) {
      case 'panorama': _renderPanorama(el); break;
      case 'comparativa': _renderComparativa(el); break;
      case 'materias': _renderMaterias(el); break;
      case 'tendencias': _renderTendencias(el); break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB 1: PANORAMA GENERAL
  // ═══════════════════════════════════════════════════════════════
  function _renderPanorama(el) {
    const d = _currentData;
    const avgColor = d.genAvg >= d.metaP ? 'success' : 'danger';
    const repColor = d.repPct <= d.metaR ? 'success' : 'danger';

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Promedio General</div>
          <div class="stat-number" style="color:var(--color-${avgColor})">${d.genAvg.toFixed(2)}</div>
          <div class="stat-label">Meta: ${d.metaP}</div>
        </div></div>
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Reprobacion</div>
          <div class="stat-number" style="color:var(--color-${repColor})">${d.repPct}%</div>
          <div class="stat-label">Meta: &le;${d.metaR}%</div>
        </div></div>
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Alumnos Evaluados</div>
          <div class="stat-number">${d.totalEval}</div>
        </div></div>
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Total Materias</div>
          <div class="stat-number">${Object.keys(d.bySubject).length}</div>
        </div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-top:16px;">
        <div class="card"><h3 class="section-title">Distribucion de Calificaciones</h3>
          <canvas id="chart-dist" height="250"></canvas>
        </div>
        <div class="card"><h3 class="section-title">Promedio por Grupo</h3>
          <canvas id="chart-groups" height="250"></canvas>
        </div>
      </div>`;

    // Dona chart
    const distCtx = document.getElementById('chart-dist');
    if (distCtx) {
      _charts.push(new Chart(distCtx, {
        type: 'doughnut',
        data: {
          labels: ['Cal. 5','Cal. 6','Cal. 7','Cal. 8','Cal. 9','Cal. 10'],
          datasets: [{ data: [d.dist[5],d.dist[6],d.dist[7],d.dist[8],d.dist[9],d.dist[10]],
            backgroundColor: ['#e53e3e','#ed8936','#ecc94b','#48bb78','#38a169','#276749'] }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
      }));
    }

    // Bar chart - groups
    const groups = Object.values(d.byGroup).sort((a, b) => b.avg - a.avg);
    const groupsCtx = document.getElementById('chart-groups');
    if (groupsCtx && groups.length > 0) {
      _charts.push(new Chart(groupsCtx, {
        type: 'bar',
        data: {
          labels: groups.map(g => g.name),
          datasets: [{
            label: 'Promedio', data: groups.map(g => g.avg),
            backgroundColor: groups.map(g => g.avg >= d.metaP ? '#38a169' : g.avg >= 7 ? '#ecc94b' : '#e53e3e')
          }]
        },
        options: {
          indexAxis: 'y', responsive: true,
          plugins: {
            legend: { display: false },
            annotation: { annotations: { metaLine: { type: 'line', xMin: d.metaP, xMax: d.metaP, borderColor: '#3182ce', borderWidth: 2, borderDash: [6, 3], label: { content: 'Meta ' + d.metaP, enabled: true } } } }
          },
          scales: { x: { min: 0, max: 10 } }
        }
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB 2: COMPARATIVA ENTRE GRUPOS
  // ═══════════════════════════════════════════════════════════════
  function _renderComparativa(el) {
    const d = _currentData;
    const groups = Object.values(d.byGroup).sort((a, b) => b.avg - a.avg);

    if (groups.length < 2) {
      el.innerHTML = '<div class="card">' + UI.emptyState('groups', 'Se necesitan al menos 2 grupos para comparar. Ajusta los filtros.') + '</div>';
      return;
    }

    // Detect outliers
    const mean = groups.reduce((s, g) => s + g.avg, 0) / groups.length;
    const stddev = Math.sqrt(groups.reduce((s, g) => s + Math.pow(g.avg - mean, 2), 0) / groups.length);
    const outliers = groups.filter(g => g.avg < mean - stddev);
    const alertHtml = outliers.length > 0
      ? `<div class="card" style="border-left:4px solid var(--color-danger);margin-bottom:16px;"><span class="material-icons-round" style="color:var(--color-danger);vertical-align:middle;">warning</span> <strong>${outliers.map(o => o.name).join(', ')}</strong> tiene(n) un promedio significativamente menor que los demas del mismo nivel (${mean.toFixed(2)} ± ${stddev.toFixed(2)}).</div>`
      : '';

    el.innerHTML = `
      ${alertHtml}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card"><h3 class="section-title">Promedio vs Reprobacion</h3>
          <canvas id="chart-comp-bars" height="280"></canvas>
        </div>
        <div class="card"><h3 class="section-title">Perfil Comparativo (Radar)</h3>
          <canvas id="chart-comp-radar" height="280"></canvas>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 class="section-title">Ranking de Grupos</h3>
        <div class="table-container"><table class="table-light">
          <thead><tr><th>#</th><th>Grupo</th><th style="text-align:center;">Promedio</th><th style="text-align:center;">vs Meta</th><th style="text-align:center;">Aprobados</th><th style="text-align:center;">Reprobados</th><th style="text-align:center;">% Reprob.</th></tr></thead>
          <tbody>${groups.map((g, i) => {
            const diff = g.avg - d.metaP;
            const arrow = diff >= 0 ? '<span style="color:var(--color-success);">&#9650; +' + diff.toFixed(2) + '</span>' : '<span style="color:var(--color-danger);">&#9660; ' + diff.toFixed(2) + '</span>';
            return `<tr><td class="font-semibold">${i + 1}</td><td class="font-semibold">${Utils.sanitize(g.name)}</td><td style="text-align:center;font-weight:700;color:${g.avg >= d.metaP ? 'var(--color-success)' : 'var(--color-danger)'};">${g.avg.toFixed(2)}</td><td style="text-align:center;">${arrow}</td><td style="text-align:center;">${g.p}</td><td style="text-align:center;">${g.f}</td><td style="text-align:center;font-weight:600;color:${g.repPct <= d.metaR ? 'var(--color-success)' : 'var(--color-danger)'};">${g.repPct}%</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;

    // Grouped bars
    const barsCtx = document.getElementById('chart-comp-bars');
    if (barsCtx) {
      _charts.push(new Chart(barsCtx, {
        type: 'bar',
        data: {
          labels: groups.map(g => g.name),
          datasets: [
            { label: 'Promedio', data: groups.map(g => g.avg), backgroundColor: '#3182ce' },
            { label: '% Reprobacion', data: groups.map(g => g.repPct), backgroundColor: '#e53e3e', yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { y: { beginAtZero: true, max: 10, title: { display: true, text: 'Promedio' } }, y1: { beginAtZero: true, position: 'right', title: { display: true, text: '% Reprob.' }, grid: { drawOnChartArea: false } } }
        }
      }));
    }

    // Radar
    const radarCtx = document.getElementById('chart-comp-radar');
    if (radarCtx) {
      const maxFaltas = Math.max(...groups.map(g => {
        const studentGrades = g.students.flatMap(sa => sa.grades);
        return studentGrades.length ? studentGrades.reduce((s, gr) => s + (gr.faltas || 0), 0) / studentGrades.length : 0;
      }), 1);

      _charts.push(new Chart(radarCtx, {
        type: 'radar',
        data: {
          labels: ['Promedio (x10)', '% Aprobacion', 'Cobertura', 'Asistencia'],
          datasets: groups.slice(0, 6).map((g, i) => {
            const pctAprob = g.vals.length ? Math.round(g.p / g.vals.length * 100) : 0;
            const avgFaltas = g.students.flatMap(sa => sa.grades).reduce((s, gr) => s + (gr.faltas || 0), 0) / Math.max(g.students.flatMap(sa => sa.grades).length, 1);
            const asistencia = maxFaltas > 0 ? Math.round((1 - avgFaltas / maxFaltas) * 100) : 100;
            return {
              label: g.name,
              data: [g.avg * 10, pctAprob, Math.min(g.vals.length / Math.max(...groups.map(gg => gg.vals.length)) * 100, 100), asistencia],
              borderColor: COLORS[i % COLORS.length],
              backgroundColor: COLORS[i % COLORS.length] + '20',
              pointRadius: 3
            };
          })
        },
        options: { responsive: true, scales: { r: { beginAtZero: true, max: 100 } }, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB 3: MATERIAS CON RETOS
  // ═══════════════════════════════════════════════════════════════
  function _renderMaterias(el) {
    const d = _currentData;
    const subjects = Object.values(d.bySubject).sort((a, b) => a.avg - b.avg);
    const gsEntries = Object.values(d.byGS);

    // Heatmap data
    const groupNames = [...new Set(gsEntries.map(gs => gs.group))].sort();
    const subjectNames = [...new Set(gsEntries.map(gs => gs.subject))].sort();

    const heatmapRows = subjectNames.map(sub => {
      const cells = groupNames.map(grp => {
        const gs = gsEntries.find(e => e.group === grp && e.subject === sub);
        if (!gs) return '<td style="text-align:center;color:#ccc;">-</td>';
        const bg = gs.avg < 6 ? 'background:rgba(229,62,62,0.2);color:#c53030;font-weight:700;' :
                   gs.avg < 7 ? 'background:rgba(237,137,54,0.15);color:#c05621;' :
                   gs.avg < 8 ? 'background:rgba(236,201,75,0.15);color:#975a16;' :
                   'background:rgba(72,187,120,0.15);color:#276749;font-weight:600;';
        return `<td style="text-align:center;${bg}">${gs.avg.toFixed(1)}</td>`;
      }).join('');
      return `<tr><td style="font-size:11px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;" title="${Utils.sanitize(sub)}">${Utils.sanitize(sub)}</td>${cells}</tr>`;
    }).join('');

    // Top 5 criticas
    const top5 = subjects.slice(0, 5);

    // Correlation: faltas vs cal (per student)
    const corrData = d.studentAvgs.map(sa => {
      const totalFaltas = sa.grades.reduce((s, g) => s + (g.faltas || 0), 0);
      const avgFaltas = sa.grades.length ? totalFaltas / sa.grades.length : 0;
      return { x: avgFaltas, y: sa.avg };
    }).filter(p => p.x > 0);

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card"><h3 class="section-title">Reprobacion por Materia</h3>
          <canvas id="chart-mat-reprob" height="300"></canvas>
        </div>
        <div class="card"><h3 class="section-title">Faltas vs Calificacion</h3>
          ${corrData.length > 5 ? '<canvas id="chart-corr" height="300"></canvas>' : '<div class="empty-state" style="padding:40px;"><span class="material-icons-round empty-state-icon">scatter_plot</span><p class="empty-state-text">Se necesitan datos de faltas para este analisis</p></div>'}
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3 class="section-title">Top 5 Materias Criticas</h3>
        <div class="table-container"><table class="table-light">
          <thead><tr><th>#</th><th>Materia</th><th style="text-align:center;">Promedio</th><th style="text-align:center;">Reprobados</th><th style="text-align:center;">% Reprob.</th><th style="text-align:center;">Faltas Prom.</th></tr></thead>
          <tbody>${top5.map((s, i) => `<tr><td class="font-semibold" style="color:var(--color-danger);">${i + 1}</td><td class="font-semibold">${Utils.sanitize(s.name)}</td><td style="text-align:center;font-weight:700;color:${s.avg < 7 ? 'var(--color-danger)' : 'inherit'};">${s.avg.toFixed(2)}</td><td style="text-align:center;">${s.f}</td><td style="text-align:center;font-weight:600;">${s.repPct}%</td><td style="text-align:center;">${s.avgF}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      ${groupNames.length > 0 && subjectNames.length > 0 ? `
      <div class="card" style="margin-top:16px;">
        <h3 class="section-title">Mapa de Calor: Grupos x Materias</h3>
        <div class="table-container" style="overflow-x:auto;">
          <table class="table-light" style="font-size:12px;">
            <thead><tr><th>Materia</th>${groupNames.map(g => `<th style="text-align:center;">${Utils.sanitize(g)}</th>`).join('')}</tr></thead>
            <tbody>${heatmapRows}</tbody>
          </table>
        </div>
        <div style="margin-top:8px;display:flex;gap:12px;font-size:11px;">
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(229,62,62,0.2);border:1px solid #c53030;border-radius:2px;vertical-align:middle;"></span> &lt;6 Critico</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(237,137,54,0.15);border:1px solid #c05621;border-radius:2px;vertical-align:middle;"></span> 6-7 Riesgo</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(236,201,75,0.15);border:1px solid #975a16;border-radius:2px;vertical-align:middle;"></span> 7-8 Aceptable</span>
          <span><span style="display:inline-block;width:12px;height:12px;background:rgba(72,187,120,0.15);border:1px solid #276749;border-radius:2px;vertical-align:middle;"></span> &ge;8 Bueno</span>
        </div>
      </div>` : ''}`;

    // Bar chart - reprob by subject
    const matCtx = document.getElementById('chart-mat-reprob');
    if (matCtx) {
      const sorted = [...subjects].sort((a, b) => b.repPct - a.repPct).slice(0, 12);
      _charts.push(new Chart(matCtx, {
        type: 'bar',
        data: {
          labels: sorted.map(s => s.name.length > 20 ? s.name.substring(0, 18) + '...' : s.name),
          datasets: [{ label: '% Reprobacion', data: sorted.map(s => s.repPct), backgroundColor: sorted.map(s => s.repPct > d.metaR ? '#e53e3e' : '#38a169') }]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
      }));
    }

    // Scatter chart - correlation
    const corrCtx = document.getElementById('chart-corr');
    if (corrCtx && corrData.length > 5) {
      _charts.push(new Chart(corrCtx, {
        type: 'scatter',
        data: { datasets: [{ label: 'Alumno', data: corrData, backgroundColor: '#3182ce80', pointRadius: 4 }] },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { title: { display: true, text: 'Faltas promedio por materia' }, beginAtZero: true },
            y: { title: { display: true, text: 'Promedio del alumno' }, min: 4, max: 10 }
          }
        }
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TAB 4: TENDENCIAS POR PARCIAL
  // ═══════════════════════════════════════════════════════════════
  function _renderTendencias(el) {
    const turno = document.getElementById('ind-turno')?.value;
    const grado = document.getElementById('ind-grado')?.value;
    const grupo = document.getElementById('ind-grupo')?.value;

    // Compute per partial
    const partials = K.PARCIALES.map(p => p.id);
    const dataByPartial = {};
    partials.forEach(pid => {
      dataByPartial[pid] = _compute(turno, grado, grupo, pid);
    });

    // Check if we have data for at least 2 parcials
    const partialsWithData = partials.filter(pid => dataByPartial[pid].totalEval > 0);
    if (partialsWithData.length < 2) {
      el.innerHTML = '<div class="card">' + UI.emptyState('timeline', 'Se necesitan datos de al menos 2 parciales para ver tendencias. Actualmente solo hay datos del ' + (partialsWithData[0] || 'ninguno') + '.') + '</div>';
      return;
    }

    // Group names across all parcials
    const allGroupNames = new Set();
    partialsWithData.forEach(pid => {
      Object.values(dataByPartial[pid].byGroup).forEach(g => allGroupNames.add(g.name));
    });
    const groupList = [...allGroupNames].sort();

    // Build table rows
    const tableRows = groupList.map(gName => {
      const cells = partialsWithData.map(pid => {
        const bg = dataByPartial[pid].byGroup;
        const entry = Object.values(bg).find(g => g.name === gName);
        return entry ? entry.avg.toFixed(2) : '-';
      });
      // Trend
      const vals = cells.map(c => c === '-' ? null : parseFloat(c)).filter(v => v !== null);
      let trend = '';
      if (vals.length >= 2) {
        const diff = vals[vals.length - 1] - vals[0];
        trend = diff > 0.2 ? '<span style="color:var(--color-success);font-weight:700;">&#9650; Mejora</span>' :
                diff < -0.2 ? '<span style="color:var(--color-danger);font-weight:700;">&#9660; Baja</span>' :
                '<span style="color:#718096;">&#9644; Estable</span>';
      }
      return `<tr><td class="font-semibold">${Utils.sanitize(gName)}</td>${cells.map(c => `<td style="text-align:center;font-weight:600;">${c}</td>`).join('')}<td style="text-align:center;">${trend}</td></tr>`;
    }).join('');

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card"><h3 class="section-title">Evolucion del Promedio General</h3>
          <canvas id="chart-trend-gen" height="280"></canvas>
        </div>
        <div class="card"><h3 class="section-title">Tendencia por Grupo</h3>
          <canvas id="chart-trend-groups" height="280"></canvas>
        </div>
      </div>
      <div class="card" style="margin-top:16px;">
        <h3 class="section-title">Tabla de Variacion por Grupo</h3>
        <div class="table-container"><table class="table-light">
          <thead><tr><th>Grupo</th>${partialsWithData.map(pid => `<th style="text-align:center;">${K.PARCIALES.find(p => p.id === pid)?.nombre || pid}</th>`).join('')}<th style="text-align:center;">Tendencia</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>
      </div>`;

    // Line chart - general trend
    const genCtx = document.getElementById('chart-trend-gen');
    if (genCtx) {
      _charts.push(new Chart(genCtx, {
        type: 'line',
        data: {
          labels: partialsWithData.map(pid => K.PARCIALES.find(p => p.id === pid)?.nombre || pid),
          datasets: [{
            label: 'Promedio General', data: partialsWithData.map(pid => dataByPartial[pid].genAvg),
            borderColor: '#3182ce', backgroundColor: '#3182ce20', fill: true, tension: 0.3, pointRadius: 6, pointHoverRadius: 8
          }, {
            label: 'Meta', data: partialsWithData.map(() => _currentData.metaP),
            borderColor: '#e53e3e', borderDash: [8, 4], pointRadius: 0, fill: false
          }]
        },
        options: { responsive: true, scales: { y: { min: 5, max: 10 } }, plugins: { legend: { position: 'bottom' } } }
      }));
    }

    // Line chart - per group
    const grpCtx = document.getElementById('chart-trend-groups');
    if (grpCtx) {
      _charts.push(new Chart(grpCtx, {
        type: 'line',
        data: {
          labels: partialsWithData.map(pid => K.PARCIALES.find(p => p.id === pid)?.nombre || pid),
          datasets: groupList.slice(0, 9).map((gName, i) => ({
            label: gName,
            data: partialsWithData.map(pid => {
              const bg = dataByPartial[pid].byGroup;
              const entry = Object.values(bg).find(g => g.name === gName);
              return entry ? entry.avg : null;
            }),
            borderColor: COLORS[i % COLORS.length],
            tension: 0.3, pointRadius: 5, fill: false
          }))
        },
        options: { responsive: true, scales: { y: { min: 5, max: 10 } }, plugins: { legend: { position: 'bottom', labels: { font: { size: 10 } } } } }
      }));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════
  function exportIndicadores() {
    if (!_currentData) { Toast.show('Calcula primero los indicadores', 'warning'); return; }
    try {
      const d = _currentData;
      const exportData = d.studentAvgs.map(sa => ({
        'Alumno': sa.student.nombreCompleto || '',
        'Grupo': sa.student.grupo || '',
        'Turno': sa.student.turno || '',
        'Grado': sa.student.grado || '',
        'Materias': sa.grades.length,
        'Promedio': sa.avg,
        'Estatus': sa.avg >= d.pass ? 'Aprobado' : 'Reprobado'
      })).sort((a, b) => (a.Grupo || '').localeCompare(b.Grupo || '') || (a.Alumno || '').localeCompare(b.Alumno || ''));
      Utils.exportToExcel(exportData, `Indicadores_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      Toast.show('Error al exportar: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'calculate') calculate();
      else if (btn.dataset.action === 'export') exportIndicadores();
      else if (btn.dataset.action === 'presentation') generatePresentation();
    });

    // Tab switching
    container.addEventListener('click', (e) => {
      const tab = e.target.closest('.ind-tab');
      if (!tab || !_currentData) return;
      _activateTab(tab.dataset.tab);
      _renderTab();
    });

    const turnoEl = document.getElementById('ind-turno');
    const gradoEl = document.getElementById('ind-grado');
    if (turnoEl) turnoEl.addEventListener('change', updateGroupOptions);
    if (gradoEl) gradoEl.addEventListener('change', updateGroupOptions);
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERADOR DE PRESENTACIÓN PDF
  // (Preservado de v1 — no modificar)
  // ═══════════════════════════════════════════════════════════════

  async function generatePresentation() {
    const turno = document.getElementById('ind-turno')?.value;
    const parcial = document.getElementById('ind-parcial')?.value;

    if (!turno) { Toast.show('Selecciona un turno', 'warning'); return; }
    if (!parcial) { Toast.show('Selecciona un parcial', 'warning'); return; }

    Toast.show('Generando presentacion...', 'info');

    try {
      const [students, subjects, groups, assignments] = await Promise.all([
        Store.getStudents(), Store.getSubjects(), Store.getGroups(), Store.getAssignments()
      ]);

      const activeStudents = students.filter(s => s.estatus === 'ACTIVO' && s.turno === turno);
      const turnoGroups = groups.filter(g => g.turno === turno);
      const groupIds = turnoGroups.map(g => g.id);
      const grades = (await Store.getGradesByGroups(groupIds, true)).filter(g => g.partial === parcial);

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

      const gsm = {};
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

      const gm = {};
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

      const grm = {};
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

      const crisisCount = {};
      rkRep.forEach(m => { crisisCount[m.groupName] = (crisisCount[m.groupName]||0)+1; });
      const crisisGroup = Object.entries(crisisCount).sort((a,b)=>b[1]-a[1])[0];
      const crisisGM = crisisGroup ? Object.values(gm).find(g => g.name === crisisGroup[0]) : worst;

      const css = `
@page{size:1280px 720px;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Segoe UI',system-ui,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.S{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always;display:flex;flex-direction:column}
.S:last-child{page-break-after:auto}

/* ── FRANJA NARANJA SUTIL ── */
.S::before{content:'';position:absolute;top:0;left:0;width:100%;height:5px;background:#d4782a;z-index:10}

/* ── DARK SLIDE (portada, cierre) ── */
.S--dark{background:#0f2744;color:#fff;justify-content:center;align-items:center;text-align:center}

/* ── WHITE SLIDE (contenido) ── */
.S--white{background:#fff;color:#1a202c;padding:60px 70px 40px}

/* ── HEADER BAR (slides blancos) ── */
.hbar{background:#1b3a5c;color:#fff;padding:18px 70px;position:absolute;top:5px;left:0;width:100%;display:flex;align-items:center;justify-content:space-between}
.hbar-title{font-size:24pt;font-weight:700;letter-spacing:0.5px}
.hbar-sub{font-size:18pt;opacity:.6;font-weight:300}
.S--white .content{margin-top:60px;width:100%;flex:1;display:flex;flex-direction:column;justify-content:center}

/* ── FOOTER ── */
.fbar{position:absolute;bottom:0;left:0;width:100%;padding:10px 70px;display:flex;justify-content:space-between;font-size:14pt;opacity:.3}
.S--dark .fbar{color:#fff} .S--white .fbar{color:#1a202c}

/* ── PORTADA ── */
.cv-pre{font-size:20pt;text-transform:uppercase;letter-spacing:8px;opacity:.4;font-weight:300}
.cv-title{font-size:54pt;font-weight:700;margin:20px 0 16px;line-height:1.1}
.cv-info{font-size:22pt;opacity:.6;font-weight:300}
.cv-mets{display:flex;gap:30px;justify-content:center;margin-top:50px}
.cv-m{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:24px 36px;min-width:180px;text-align:center}
.cv-ml{font-size:18pt;opacity:.4;margin-bottom:6px;font-weight:300;text-transform:uppercase;letter-spacing:2px}
.cv-mv{font-size:42pt;font-weight:700;color:#d4782a}

/* ── INNER CONTAINER ── */
.inner{width:100%;max-width:1100px;margin:0 auto;text-align:center}

/* ── KPI CARDS (infografia) ── */
.kpi-row{display:flex;gap:28px;justify-content:center;margin:24px 0}
.kpi-card{background:#f7f9fb;border:2px solid #e8ecf1;border-radius:16px;padding:32px 40px;min-width:240px;text-align:center;flex:1;max-width:350px}
.kpi-card--ok{border-color:#d4782a;border-left:6px solid #d4782a}
.kpi-card--bad{border-color:#c0392b;border-left:6px solid #c0392b}
.kpi-v{font-size:52pt;font-weight:800;line-height:1;color:#1a202c}
.kpi-card--ok .kpi-v{color:#d4782a} .kpi-card--bad .kpi-v{color:#c0392b}
.kpi-l{font-size:20pt;margin-top:8px;color:#64748b;font-weight:400}
.kpi-meta{font-size:18pt;color:#94a3b8;margin-top:4px}

/* ── GROUP CARDS (infografia) ── */
.grp-row{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
.grp-card{border-radius:16px;padding:28px 20px;min-width:200px;flex:1;max-width:320px;text-align:center;border:2px solid #e8ecf1;background:#f7f9fb}
.grp-card--ok{border-color:#d4782a;background:#fdf6ef}
.grp-card--warn{border-color:#e8c547;background:#fefdf0}
.grp-card--bad{border-color:#c0392b;background:#fdf0ef}
.grp-tag{font-size:18pt;text-transform:uppercase;letter-spacing:3px;font-weight:700;margin-bottom:6px}
.grp-card--ok .grp-tag{color:#d4782a} .grp-card--warn .grp-tag{color:#b7950b} .grp-card--bad .grp-tag{color:#c0392b}
.grp-name{font-size:24pt;font-weight:700;color:#1a202c;margin-bottom:4px}
.grp-val{font-size:44pt;font-weight:800;line-height:1}
.grp-card--ok .grp-val{color:#d4782a} .grp-card--warn .grp-val{color:#b7950b} .grp-card--bad .grp-val{color:#c0392b}
.grp-desc{font-size:18pt;color:#64748b;margin-top:6px}

/* ── HIGHLIGHT BAR ── */
.hl-row{display:flex;gap:20px;justify-content:center;margin-top:20px}
.hl-card{padding:18px 28px;border-radius:12px;font-size:20pt;font-weight:500;flex:1;max-width:500px;text-align:center}
.hl-card--ok{background:#fdf6ef;border:2px solid #d4782a;color:#b5651d}
.hl-card--bad{background:#fdf0ef;border:2px solid #c0392b;color:#922b21}

/* ── PROGRESS BARS (infografia) ── */
.prog-list{width:100%;max-width:900px;margin:0 auto}
.prog-item{display:flex;align-items:center;margin-bottom:14px;gap:16px}
.prog-rank{font-size:22pt;font-weight:800;color:#d4782a;min-width:36px;text-align:center}
.prog-info{flex:1}
.prog-name{font-size:20pt;font-weight:600;color:#1a202c;margin-bottom:4px}
.prog-sub{font-size:18pt;color:#64748b}
.prog-bar{width:200px;height:18px;background:#e8ecf1;border-radius:9px;overflow:hidden}
.prog-fill{height:100%;border-radius:9px}
.prog-fill--bad{background:linear-gradient(90deg,#c0392b,#e74c3c)} .prog-fill--ok{background:linear-gradient(90deg,#d4782a,#e8a87c)}
.prog-val{font-size:22pt;font-weight:700;min-width:80px;text-align:right}
.prog-val--bad{color:#c0392b} .prog-val--ok{color:#d4782a}

/* ── TABLE (comparativo) ── */
.tb{width:100%;max-width:1000px;margin:0 auto;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;border:1px solid #e8ecf1}
.tb th{padding:14px 20px;font-size:18pt;text-align:left;font-weight:700;background:#1b3a5c;color:#fff}
.tb td{padding:14px 20px;font-size:20pt;border-top:1px solid #e8ecf1}
.tb tr:nth-child(even){background:#f7f9fb}
.rv{font-weight:700;font-size:22pt}
.vd{color:#c0392b;font-weight:700} .vw{color:#d4782a;font-weight:700} .vo{color:#27763a;font-weight:700}

/* ── CLOSE METRICS ── */
.cl-row{display:flex;gap:30px;justify-content:center;margin:30px 0}
.cl-card{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:32px 28px;min-width:200px;text-align:center;flex:1;max-width:300px}
.cl-v{font-size:44pt;font-weight:700;color:#d4782a;line-height:1}
.cl-l{font-size:18pt;opacity:.5;margin-top:8px;font-weight:300;text-transform:uppercase;letter-spacing:2px}
@media screen{
  body{background:#1e293b;display:flex;flex-direction:column;align-items:center;min-height:100vh}
  .S{margin:0;transform-origin:top center;box-shadow:0 8px 40px rgba(0,0,0,.3)}
}
@media print{.S{margin:0}body{background:#fff}}`;

      // Scale slides to fill viewport
      const scaleScript = `
<script>
function scaleSlides(){
  var slides=document.querySelectorAll('.S');
  var vw=window.innerWidth,vh=window.innerHeight;
  var sw=1280,sh=720;
  var scale=Math.min(vw/sw,vh/sh);
  slides.forEach(function(s){
    s.style.transform='scale('+scale+')';
    s.style.transformOrigin='top center';
    s.style.marginBottom=((sh*scale)-sh)+'px';
  });
}
window.addEventListener('resize',scaleSlides);
scaleSlides();
<\/script>`;

      const sl = [];
      const foot = `<div class="fbar"><span>EPO 67</span><span>${turno} &middot; ${parcialName}</span></div>`;

      // ── 1. PORTADA (oscura) ──
      sl.push(`<div class="S S--dark">
        <div class="inner">
          <div class="cv-pre">EPO 67 &middot; ${turno.toUpperCase()}</div>
          <div class="cv-title">Indicadores Acad&eacute;micos</div>
          <div class="cv-info">${parcialName} &middot; ${new Date().getFullYear()}</div>
          <div class="cv-mets">
            <div class="cv-m"><div class="cv-ml">Meta</div><div class="cv-mv">${metaP}</div></div>
            <div class="cv-m"><div class="cv-ml">Reprob.</div><div class="cv-mv">&le;${metaR}%</div></div>
            <div class="cv-m"><div class="cv-ml">Alumnos</div><div class="cv-mv">${activeStudents.length}</div></div>
          </div>
        </div>${foot}</div>`);

      // ── 2. RESUMEN (blanco) ──
      sl.push(`<div class="S S--white">
        <div class="hbar"><span class="hbar-title">Resumen del Turno ${turno}</span><span class="hbar-sub">${parcialName}</span></div>
        <div class="content"><div class="inner">
          <div class="kpi-row">
            <div class="kpi-card ${tAvg>=metaP?'kpi-card--ok':'kpi-card--bad'}"><div class="kpi-v">${tAvg.toFixed(2)}</div><div class="kpi-l">Promedio General</div><div class="kpi-meta">Meta: ${metaP}</div></div>
            <div class="kpi-card ${tRepPct<=metaR?'kpi-card--ok':'kpi-card--bad'}"><div class="kpi-v">${tRepPct}%</div><div class="kpi-l">Reprobaci&oacute;n</div><div class="kpi-meta">Meta: &le;${metaR}%</div></div>
          </div>
          <div class="hl-row">
            <div class="hl-card hl-card--ok">&#9650; Mejor: <strong>${S(best?.name||'-')}</strong> &mdash; ${best?.avg?.toFixed(2)||'-'}</div>
            <div class="hl-card hl-card--bad">&#9660; Cr&iacute;tico: <strong>${S(worst?.name||'-')}</strong> &mdash; ${worst?.avg?.toFixed(2)||'-'}</div>
          </div>
        </div></div>${foot}</div>`);

      // ── 3-5. GRADOS (blancos) ──
      [1,2,3].forEach(grado => {
        const gr = grm[grado]; if (!gr || gr.groups.length === 0) return;
        const cap = {1:'Primer',2:'Segundo',3:'Tercer'}[grado];
        const tagFor = g => g.avg >= metaP ? 'ok' : g.avg >= 7 ? 'warn' : 'bad';
        const labFor = g => g.avg >= metaP ? 'L&Iacute;DER' : g.avg >= 7 ? 'ATENCI&Oacute;N' : 'CR&Iacute;TICO';
        const cards = gr.groups.map(g => `<div class="grp-card grp-card--${tagFor(g)}">
          <div class="grp-tag">${labFor(g)}</div>
          <div class="grp-name">${S(g.name)}</div>
          <div class="grp-val">${g.avg.toFixed(2)}</div>
          <div class="grp-desc">${g.repPct}% reprob.</div>
        </div>`).join('');
        sl.push(`<div class="S S--white">
          <div class="hbar"><span class="hbar-title">${cap} Grado</span><span class="hbar-sub">Prom: ${gr.avg.toFixed(2)} &middot; Reprob: ${gr.repPct}%</span></div>
          <div class="content"><div class="inner"><div class="grp-row">${cards}</div></div></div>
        ${foot}</div>`);
      });

      // ── 6. TOP 5 PROMEDIOS BAJOS (barras infografia) ──
      const progAvg = rkAvg.map((m,i) => {
        const pct = Math.min((m.avg / 10) * 100, 100);
        return `<div class="prog-item">
          <div class="prog-rank">${i+1}</div>
          <div class="prog-info"><div class="prog-name">${S(m.groupName)}</div><div class="prog-sub">${S(m.subjectName)}</div></div>
          <div class="prog-bar"><div class="prog-fill prog-fill--bad" style="width:${pct}%"></div></div>
          <div class="prog-val prog-val--bad">${m.avg.toFixed(1)}</div>
        </div>`;
      }).join('');
      sl.push(`<div class="S S--white">
        <div class="hbar"><span class="hbar-title">Top 5 &mdash; Promedios Bajos</span><span class="hbar-sub">Menor rendimiento</span></div>
        <div class="content"><div class="inner"><div class="prog-list">${progAvg}</div></div></div>
      ${foot}</div>`);

      // ── 7. TOP 5 REPROBACIÓN (barras infografia) ──
      const maxRep = Math.max(...rkRep.map(m => m.failed), 1);
      const progRep = rkRep.map((m,i) => {
        const pct = Math.min((m.failed / maxRep) * 100, 100);
        return `<div class="prog-item">
          <div class="prog-rank">${i+1}</div>
          <div class="prog-info"><div class="prog-name">${S(m.groupName)}</div><div class="prog-sub">${S(m.subjectName)}</div></div>
          <div class="prog-bar"><div class="prog-fill prog-fill--bad" style="width:${pct}%"></div></div>
          <div class="prog-val prog-val--bad">${m.failed} alum.</div>
        </div>`;
      }).join('');
      sl.push(`<div class="S S--white">
        <div class="hbar"><span class="hbar-title">Top 5 &mdash; Mayor Reprobaci&oacute;n</span><span class="hbar-sub">M&aacute;s alumnos reprobados</span></div>
        <div class="content"><div class="inner"><div class="prog-list">${progRep}</div></div></div>
      ${foot}</div>`);

      // ── 8. COMPARATIVO (tabla) ──
      const compRows = sorted.map(g => {
        const ac = g.avg>=metaP?'vo':g.avg>=7?'vw':'vd';
        const rc = g.repPct<=metaR?'vo':'vd';
        return `<tr><td style="font-weight:700">${S(g.name)}</td><td class="${ac} rv">${g.avg.toFixed(2)}</td><td>${g.p}</td><td>${g.f}</td><td class="${rc} rv">${g.repPct}%</td></tr>`;
      }).join('');
      sl.push(`<div class="S S--white">
        <div class="hbar"><span class="hbar-title">Comparativo por Grupo</span><span class="hbar-sub">${sorted.length} grupos</span></div>
        <div class="content"><div class="inner">
          <table class="tb"><thead><tr><th>Grupo</th><th>Promedio</th><th>Aprob.</th><th>Reprob.</th><th>% Reprob.</th></tr></thead><tbody>${compRows}</tbody></table>
        </div></div>
      ${foot}</div>`);

      // ── 9. CIERRE (oscuro) ──
      sl.push(`<div class="S S--dark">
        <div class="inner">
          <div class="cv-pre">RESUMEN EJECUTIVO</div>
          <div class="cv-title" style="font-size:40pt">Cierre del Turno ${turno}</div>
          <div class="cl-row">
            <div class="cl-card"><div class="cl-v">${tAvg.toFixed(2)}</div><div class="cl-l">Promedio</div></div>
            <div class="cl-card"><div class="cl-v">${tRepPct}%</div><div class="cl-l">Reprobaci&oacute;n</div></div>
            <div class="cl-card"><div class="cl-v">${S(best?.name||'-')}</div><div class="cl-l">Mejor Grupo</div></div>
          </div>
        </div>${foot}</div>`);

      // ── 10. GRACIAS (oscuro) ──
      sl.push(`<div class="S S--dark">
        <div class="inner">
          <div class="cv-title">&iexcl;Gracias!</div>
          <div class="cv-info" style="margin-top:24px">EPO 67 &middot; ${turno} &middot; ${parcialName} &middot; ${new Date().getFullYear()}</div>
        </div>${foot}</div>`);

      const doc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=1280"><title>Indicadores ${turno} - ${parcialName} - EPO 67</title><style>${css}</style></head><body>${sl.join('\n')}${scaleScript}</body></html>`;

      const w = window.open('', '_blank');
      w.document.write(doc);
      w.document.close();
      Toast.show('Presentacion generada', 'success');
    } catch (e) {
      console.error('Error generando presentacion:', e);
      Toast.show('Error: ' + e.message, 'error');
    }
  }

  return { render };
})();

Router.modules['indicadores'] = () => IndicadoresModule.render();
