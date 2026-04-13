/**
 * DASHBOARD MODULE — Sistema Escolar EPO 67
 * Pantalla principal con estadisticas institucionales, metas,
 * estado de grupos y graficas CSS.
 * Usa Store.*, K.*, Utils.*, UI.* del sistema modular.
 */

const DashboardModule = (() => {

  // ─── RENDER PRINCIPAL ───────────────────────────────────────
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = UI.loadingState('Cargando dashboard...');

    try {
      // Load lightweight data first (no grades - those are 8000+ docs)
      const [students, teachers, groups, partials] = await Promise.all([
        Store.getStudents(),
        Store.getTeachers(),
        Store.getGroups(),
        Store.getPartials()
      ]);

      const activeStudents = students.filter(s => s.estatus === 'ACTIVO');

      // Render dashboard immediately without grades
      container.innerHTML = UI.moduleContainer([
        renderHeader(),
        renderStatCards(activeStudents, teachers),
        '<div id="dash-metas" class="card"><p class="text-muted" style="text-align:center;padding:20px;">Cargando estadísticas de calificaciones...</p></div>',
        '<div id="dash-groups"></div>',
        renderCharts(activeStudents)
      ].join(''));

      // Then load grades in background for metas and group table
      try {
        const groupIds = groups.map(g => g.id);
        const grades = await Store.getGradesByGroups(groupIds);
        const currentPartialId = getCurrentPartial(partials);
        const currentGrades = currentPartialId
          ? grades.filter(g => g.partial === currentPartialId)
          : grades;
        const activeIds = new Set(activeStudents.map(s => s.id));
        const relevantGrades = currentGrades.filter(g => activeIds.has(g.studentId));

        const metasEl = document.getElementById('dash-metas');
        if (metasEl) metasEl.outerHTML = renderMetasCard(relevantGrades, currentPartialId);
        const groupsEl = document.getElementById('dash-groups');
        if (groupsEl) groupsEl.outerHTML = renderGroupTable(activeStudents, relevantGrades, groups);
      } catch (gradeErr) {
        console.warn('Dashboard: grades loading deferred', gradeErr);
        const metasEl = document.getElementById('dash-metas');
        if (metasEl) metasEl.innerHTML = '<p class="text-muted" style="text-align:center;padding:12px;">Calificaciones no disponibles por el momento</p>';
      }

    } catch (error) {
      console.error('Error renderizando dashboard:', error);
      container.innerHTML = UI.errorState('Error al cargar el dashboard');
      Toast.show('Error al cargar el dashboard', 'error');
    }
  }

  // ─── HELPERS ────────────────────────────────────────────────

  /**
   * Determina el parcial activo (no bloqueado). Si todos estan
   * bloqueados, usa el ultimo. Si ninguno tiene doc en Firestore,
   * usa P1 como fallback.
   */
  function getCurrentPartial(partials) {
    if (!partials || partials.length === 0) return 'P1';

    // Ordenar por numero ascendente
    const sorted = K.PARCIALES.map(kp => {
      const doc = partials.find(p => p.id === kp.id);
      return { id: kp.id, numero: kp.numero, locked: doc ? (doc.locked || false) : false };
    });

    // Primer parcial no bloqueado
    const open = sorted.find(p => !p.locked);
    if (open) return open.id;

    // Todos bloqueados: ultimo parcial
    return sorted[sorted.length - 1].id;
  }

  /** Cap grade value at 10 */
  function capGrade(value) {
    if (value === undefined || value === null) return null;
    return Math.min(Number(value), 10);
  }

  /** Get grade CAL value (new format: g.cal, legacy: g.value) */
  function getGradeCal(g) {
    if (g.cal !== undefined && g.cal !== null && g.cal !== '') return capGrade(g.cal);
    return capGrade(g.value);
  }

  /** Compute average from array of grade objects */
  function computeAverage(gradeObjs) {
    const valid = gradeObjs.map(g => getGradeCal(g)).filter(v => v !== null);
    if (valid.length === 0) return 0;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
  }

  /** Compute fail rate from array of grade objects */
  function computeFailRate(gradeObjs) {
    const valid = gradeObjs.map(g => getGradeCal(g)).filter(v => v !== null);
    if (valid.length === 0) return 0;
    const failed = valid.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    return (failed / valid.length) * 100;
  }

  // ─── SECTION 1: STAT CARDS ─────────────────────────────────

  function renderHeader() {
    return UI.pageHeader(
      'Dashboard Institucional',
      'EPO 67 -- Resumen general del plantel'
    );
  }

  function renderStatCards(activeStudents, teachers) {
    const hombres = activeStudents.filter(s => s.sexo === 'H').length;
    const mujeres = activeStudents.filter(s => s.sexo === 'M').length;

    const cards = [
      { label: 'Total Alumnos', value: activeStudents.length, icon: 'people', colorClass: 'success' },
      { label: 'Hombres', value: hombres, icon: 'male', colorClass: 'primary' },
      { label: 'Mujeres', value: mujeres, icon: 'female', colorClass: 'danger' },
      { label: 'Docentes', value: teachers.length, icon: 'school', colorClass: 'warning' },
      { label: 'Grupos', value: 18, icon: 'groups', colorClass: 'primary' },
      { label: 'Parciales', value: 3, icon: 'assignment', colorClass: 'success' },
      { label: 'Turnos', value: 2, icon: 'schedule', colorClass: 'warning' },
      { label: 'Grados', value: 3, icon: 'stairs', colorClass: 'primary' }
    ];

    return UI.statsGrid(cards);
  }

  // ─── SECTION 2: METAS INSTITUCIONALES ──────────────────────

  function renderMetasCard(grades, currentPartialId) {
    const metaPromedio = 8.3;
    const metaReprob = 14;

    const avg = computeAverage(grades);
    const failRate = computeFailRate(grades);
    const passRate = 100 - failRate;

    const parcialLabel = K.PARCIALES.find(p => p.id === currentPartialId)?.nombre || currentPartialId;

    // Progress bar color logic (CSS classes: default=green, .warning=yellow, .critical=red)
    const avgClass = avg >= metaPromedio ? '' : avg >= 7 ? 'warning' : 'critical';
    const reprobClass = failRate <= metaReprob ? '' : failRate <= 20 ? 'warning' : 'critical';
    const aprobClass = passRate >= 86 ? '' : passRate >= 80 ? 'warning' : 'critical';

    // Cap progress widths for visual display
    const avgPct = Math.min((avg / 10) * 100, 100);
    const reprobPct = Math.min(failRate, 100);
    const aprobPct = Math.min(passRate, 100);

    return `
      <div class="card" style="margin-top:24px;">
        <h2 class="section-title" style="margin-bottom:4px;">
          <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;font-size:22px;">flag</span>
          Metas Institucionales
        </h2>
        <p style="color:var(--color-text-light);font-size:13px;margin-bottom:20px;">${Utils.sanitize(parcialLabel)} -- Parcial activo</p>

        <div style="display:grid;gap:20px;">
          <!-- Promedio General -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;">Promedio General</span>
              <span>
                <strong>${avg.toFixed(2)}</strong>
                <span style="color:var(--color-text-light);font-size:12px;"> / meta ${metaPromedio}</span>
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${avgClass}" style="width:${avgPct.toFixed(1)}%"></div>
            </div>
          </div>

          <!-- Reprobacion -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;">Reprobacion</span>
              <span>
                <strong>${failRate.toFixed(1)}%</strong>
                <span style="color:var(--color-text-light);font-size:12px;"> / meta max ${metaReprob}%</span>
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${reprobClass}" style="width:${reprobPct.toFixed(1)}%"></div>
            </div>
          </div>

          <!-- Aprobacion -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;">Aprobacion</span>
              <span>
                <strong>${passRate.toFixed(1)}%</strong>
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${aprobClass}" style="width:${aprobPct.toFixed(1)}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─── SECTION 3: ESTADO DE GRUPOS ──────────────────────────

  function renderGroupTable(activeStudents, grades, groups) {
    // Build student-to-grupo map
    const studentsByGrupo = {};
    activeStudents.forEach(s => {
      const key = s.grupo || 'Sin grupo';
      if (!studentsByGrupo[key]) studentsByGrupo[key] = [];
      studentsByGrupo[key].push(s);
    });

    // Build grades-by-grupo using student grupo field
    const gradesByGrupo = {};
    const studentMap = {};
    activeStudents.forEach(s => { studentMap[s.id] = s; });

    grades.forEach(g => {
      const student = studentMap[g.studentId];
      if (!student) return;
      const key = student.grupo || 'Sin grupo';
      if (!gradesByGrupo[key]) gradesByGrupo[key] = [];
      gradesByGrupo[key].push(g);
    });

    // Build group info from groups collection, fallback to student data
    const groupInfoMap = {};
    groups.forEach(g => {
      const name = g.nombre || g.grupo;
      if (name) {
        groupInfoMap[name] = { turno: g.turno || '', grado: g.grado || '' };
      }
    });

    // Collect all unique group names
    const allGrupos = [...new Set([
      ...Object.keys(studentsByGrupo),
      ...groups.map(g => g.nombre || g.grupo).filter(Boolean)
    ])].filter(g => g !== 'Sin grupo').sort((a, b) => {
      const infoA = groupInfoMap[a] || {};
      const infoB = groupInfoMap[b] || {};
      // Sort by turno first, then by name
      const turnoComp = (infoA.turno || '').localeCompare(infoB.turno || '');
      if (turnoComp !== 0) return turnoComp;
      return a.localeCompare(b);
    });

    const rows = allGrupos.map(grupoName => {
      const info = groupInfoMap[grupoName] || {};
      const studentList = studentsByGrupo[grupoName] || [];
      const gradeList = gradesByGrupo[grupoName] || [];
      const avg = computeAverage(gradeList);
      const reprob = computeFailRate(gradeList);

      // Status indicator — elegant dot + text, no badge pills
      let statusHtml;
      if (gradeList.length === 0) {
        statusHtml = '<span style="color:var(--color-text-light);font-size:13px;">— Sin datos</span>';
      } else if (avg >= 8) {
        statusHtml = '<span style="color:var(--color-success);font-weight:600;font-size:13px;">● Bueno</span>';
      } else if (avg >= 7) {
        statusHtml = '<span style="color:#c05621;font-weight:600;font-size:13px;">● Regular</span>';
      } else {
        statusHtml = '<span style="color:var(--color-danger);font-weight:600;font-size:13px;">● Crítico</span>';
      }

      // Turno fallback: infer from students if not in groups collection
      let turno = info.turno || '';
      if (!turno && studentList.length > 0) {
        turno = studentList[0].turno || '';
      }

      return `
        <tr>
          <td>${Utils.sanitize(turno)}</td>
          <td><strong>${Utils.sanitize(grupoName)}</strong></td>
          <td style="text-align:center;">${studentList.length}</td>
          <td style="text-align:center;font-weight:600;color:${gradeList.length > 0 ? (avg >= 8 ? 'var(--color-success)' : avg >= 7 ? '#c05621' : 'var(--color-danger)') : 'inherit'};">${gradeList.length > 0 ? avg.toFixed(2) : '-'}</td>
          <td style="text-align:center;font-weight:600;color:${gradeList.length > 0 ? (reprob <= 14 ? 'var(--color-success)' : reprob <= 20 ? '#c05621' : 'var(--color-danger)') : 'inherit'};">${gradeList.length > 0 ? reprob.toFixed(1) + '%' : '-'}</td>
          <td style="text-align:center;">${statusHtml}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="card" style="margin-top:24px;">
        <h2 class="section-title" style="margin-bottom:16px;">
          <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;font-size:22px;">table_chart</span>
          Estado de Grupos
        </h2>
        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Grupo</th>
                <th style="text-align:center;">Alumnos</th>
                <th style="text-align:center;">Promedio</th>
                <th style="text-align:center;">% Reprob</th>
                <th style="text-align:center;">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="6" style="text-align:center;">Sin datos de grupos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ─── SECTION 4: CHARTS (CSS-BASED) ────────────────────────

  function renderCharts(activeStudents) {
    const total = activeStudents.length || 1;

    // Alumnos por turno
    const turnoCount = {};
    K.TURNOS.forEach(t => { turnoCount[t] = 0; });
    activeStudents.forEach(s => {
      const t = s.turno || 'OTRO';
      turnoCount[t] = (turnoCount[t] || 0) + 1;
    });

    const turnoColors = { MATUTINO: 'var(--color-primary)', VESPERTINO: 'var(--color-warning)' };
    const turnoBars = Object.entries(turnoCount)
      .filter(([, count]) => count > 0)
      .map(([turno, count]) => {
        const pct = (count / total) * 100;
        const color = turnoColors[turno] || 'var(--color-text-light)';
        return `
          <div style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:13px;font-weight:500;">${Utils.sanitize(turno)}</span>
              <span style="font-size:13px;color:var(--color-text-light);">${count} (${pct.toFixed(0)}%)</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div>
            </div>
          </div>
        `;
      }).join('');

    // Distribucion por genero
    const hombres = activeStudents.filter(s => s.sexo === 'H').length;
    const mujeres = activeStudents.filter(s => s.sexo === 'M').length;
    const hPct = (hombres / total) * 100;
    const mPct = (mujeres / total) * 100;

    const generoBars = `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:500;">Hombres</span>
          <span style="font-size:13px;color:var(--color-text-light);">${hombres} (${hPct.toFixed(0)}%)</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${hPct.toFixed(1)}%;background:var(--color-primary);"></div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:500;">Mujeres</span>
          <span style="font-size:13px;color:var(--color-text-light);">${mujeres} (${mPct.toFixed(0)}%)</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${mPct.toFixed(1)}%;background:#ec4899;"></div>
        </div>
      </div>
    `;

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px;">
        <div class="card">
          <h2 class="section-title" style="margin-bottom:16px;">
            <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;font-size:22px;">bar_chart</span>
            Alumnos por Turno
          </h2>
          ${turnoBars || '<p style="color:var(--color-text-light);">Sin datos</p>'}
        </div>
        <div class="card">
          <h2 class="section-title" style="margin-bottom:16px;">
            <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;font-size:22px;">wc</span>
            Distribucion por Genero
          </h2>
          ${generoBars}
        </div>
      </div>
    `;
  }

  // ─── PUBLIC API ─────────────────────────────────────────────
  return { render };
})();

// Self-register in Router
Router.modules['dashboard'] = () => DashboardModule.render();
