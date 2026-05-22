/**
 * DASHBOARD MODULE — Sistema Escolar EPO 67
 * Pantalla principal con estadisticas institucionales, metas,
 * estado de grupos y graficas CSS.
 * Usa Store.*, K.*, Utils.*, UI.* del sistema modular.
 */

const DashboardModule = (() => {
  // Estado: parcial seleccionado (default = el primero abierto, o 'all' = acumulado)
  let _selectedPartial = null;
  let _cachedData = null; // {students, teachers, groups, partials, allGrades, assignments}

  // ─── RENDER PRINCIPAL ───────────────────────────────────────
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = UI.loadingState('Cargando dashboard...');

    const role = App.currentUser?.role;
    if (role === 'maestro' || role === 'orientador_docente') {
      return renderTeacherDashboard(container);
    }

    // Presidente de academia: dashboard filtrado a las materias de su academia
    if (role === 'presidente_academia') {
      const mod = (typeof PresidenteAcademiaModule !== 'undefined') ? PresidenteAcademiaModule : null;
      if (mod && mod.renderDashboard) return mod.renderDashboard(container);
      // fallback si no carga el módulo
    }

    try {
      // ═══ FASE 1: Datos LIVIANOS en paralelo ═══
      // teachers, groups, partials, assignments son colecciones pequeñas y
      // estables. orientadorGroups solo aplica si el usuario es orientador.
      // students lo dejamos para la fase 2 — para orientadores se carga solo
      // los de sus grupos (mucho más eficiente que pedir los 800 alumnos).
      const isOrientadorRole = role === 'orientador';
      const lightPromises = [
        Store.getTeachers(),
        Store.getGroups(),
        Store.getPartials(),
        Store.getAssignments(),
      ];
      if (isOrientadorRole) lightPromises.push(Store.getOrientadorGroups());
      const lightResults = await Promise.all(lightPromises);
      const [teachers, groupsAll, partials, assignments] = lightResults;
      const oriGroupIds = isOrientadorRole ? (lightResults[4] || []) : null;

      // ═══ SCOPE por rol ═══
      // Orientador puro: ve TODOS los grupos del TURNO donde es orientador
      // (no solo los grupos específicos asignados). Esto permite que un
      // orientador del matutino vea estadísticas de los 9 grupos del matutino,
      // no solo los 3 que tiene asignados directamente.
      let scopedGroups = groupsAll;
      let isOrientadorScope = false;
      let scopedTurnos = [];
      if (isOrientadorRole) {
        const oriSet = new Set(oriGroupIds || []);
        // Detectar el/los turno(s) donde es orientador
        const turnosSet = new Set(
          groupsAll
            .filter(g => oriSet.has(g.id))
            .map(g => g.turno)
            .filter(Boolean)
        );
        scopedTurnos = [...turnosSet];
        if (scopedTurnos.length > 0) {
          scopedGroups = groupsAll.filter(g => turnosSet.has(g.turno));
        } else {
          scopedGroups = [];
        }
        isOrientadorScope = true;
      }

      // ═══ FASE 2: Students con query scoped ═══
      // Orientador: alumnos de los grupos del/los turno(s) donde es orientador.
      // Admin/directivo/etc: TODOS los alumnos.
      let students;
      if (isOrientadorScope) {
        const gIds = scopedGroups.map(g => g.id);
        students = gIds.length > 0 ? await Store.getStudentsByGroups(gIds) : [];
      } else {
        students = await Store.getStudents();
      }

      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      // ═══ FASE 3: Grades del parcial seleccionado ═══
      // Cargar SOLO el parcial activo en el primer render (no los 3 parciales
      // a la vez). El trend chart re-carga el resto en background después.
      if (!_selectedPartial) _selectedPartial = getCurrentPartial(partials);
      const gIds = scopedGroups.map(g => g.id);
      let partialGrades = [];
      try {
        if (gIds.length > 0) {
          if (_selectedPartial === 'all') {
            // Vista acumulada: necesitamos los 3 parciales. Hacerlo en paralelo.
            partialGrades = await Store.getGradesByGroups(gIds);
          } else {
            partialGrades = await Store.getGradesByGroupsAndPartial(gIds, _selectedPartial);
          }
        }
      } catch (e) {
        console.warn('Dashboard: grades loading deferred', e);
      }

      // El "trend chart" necesita los 3 parciales para comparar. Cargarlos
      // de forma diferida — si están en cache son instantáneos; si no,
      // se cargan en background sin bloquear el primer render.
      _cachedData = {
        students, teachers, groups: scopedGroups, partials,
        // allGrades = lo cargado por el parcial seleccionado. El trend
        // chart usa una propiedad separada que se llena lazy.
        allGrades: partialGrades,
        trendGrades: null, // se llena async después del primer render
        activeStudents, assignments,
        isOrientadorScope,
        scopeLabel: isOrientadorScope
          ? (scopedTurnos.length > 0
              ? `Vista de orientación · Estadísticas de los ${scopedGroups.length} grupos del turno ${scopedTurnos.join(' y ')}.`
              : 'Aún no tienes grupos asignados como orientador.')
          : null,
      };

      _renderFull();

      // Cargar grades de los demás parciales en background (para el trend
      // chart). No bloquea el primer render — el chart se renderiza con
      // los datos que haya y se actualiza cuando llegan los otros parciales.
      _loadTrendDataInBackground(gIds).catch(e => console.warn('trend deferred', e));
    } catch (error) {
      console.error('Error renderizando dashboard:', error);
      container.innerHTML = UI.errorState('Error al cargar el dashboard');
      Toast.show('Error al cargar el dashboard', 'error');
    }
  }

  // Carga los grades de los OTROS parciales (los no-seleccionados) para que
  // el trend chart muestre la comparativa completa. Se ejecuta en background
  // sin bloquear el render inicial.
  async function _loadTrendDataInBackground(groupIds) {
    if (!groupIds || groupIds.length === 0) return;
    if (!_cachedData) return;
    try {
      // Si el selected era 'all', ya cargamos todo. No re-cargar.
      if (_selectedPartial === 'all') {
        _cachedData.trendGrades = _cachedData.allGrades;
        return;
      }
      // Cargar los parciales que NO son el seleccionado
      const otrosParciales = K.PARCIALES.map(p => p.id).filter(pid => pid !== _selectedPartial);
      const proms = otrosParciales.map(pid => Store.getGradesByGroupsAndPartial(groupIds, pid));
      const results = await Promise.all(proms);
      const otherGrades = results.flat();
      // Combinar con los del parcial activo
      _cachedData.trendGrades = [...(_cachedData.allGrades || []), ...otherGrades];
      // Re-render solo si el chart sigue visible (no cambió de página)
      const stillOnDashboard = document.getElementById('moduleContainer')?.querySelector('[data-trend-chart]');
      if (stillOnDashboard) _renderFull();
    } catch (e) {
      console.warn('Trend background load failed:', e);
    }
  }

  function _renderFull() {
    const container = document.getElementById('moduleContainer');
    if (!container || !_cachedData) return;

    const { students, teachers, groups, partials, allGrades, activeStudents, assignments, isOrientadorScope, scopeLabel } = _cachedData;

    // Filtrar grades según el parcial seleccionado (o acumulado)
    const partialGrades = _selectedPartial === 'all'
      ? allGrades
      : allGrades.filter(g => g.partial === _selectedPartial);
    const activeIds = new Set(activeStudents.map(s => s.id));
    const relevantGrades = partialGrades.filter(g => activeIds.has(g.studentId));

    // Banner de scope: solo cuando el dashboard está acotado a los grupos del orientador
    const scopeBanner = scopeLabel
      ? `<div class="alert alert-info" style="margin-bottom:14px;border-left:4px solid #0891b2;background:#ecfeff;color:#155e75;">
           <strong>📊 Vista de orientación:</strong> ${Utils.sanitize(scopeLabel)}
         </div>`
      : '';

    // Si el orientador no tiene grupos asignados, mostrar mensaje y salir
    if (isOrientadorScope && groups.length === 0) {
      container.innerHTML = UI.moduleContainer([
        renderHeader(),
        scopeBanner,
        UI.emptyState('group_off', 'No tienes grupos asignados como orientador. Avisa al admin para que te asigne.'),
      ].join(''));
      return;
    }

    // Para el trend chart usar trendGrades si ya está cargado (los 3 parciales),
    // si no, usar allGrades (parcial actual) — mostrará comparativa parcial.
    const trendData = _cachedData.trendGrades || allGrades;

    container.innerHTML = UI.moduleContainer([
      renderHeader(),
      scopeBanner,
      '<div id="dash-corrections-banner"></div>',
      renderPartialSelector(partials),
      renderKPICards(activeStudents, teachers, relevantGrades, assignments),
      renderTurnoComparison(activeStudents, relevantGrades, groups),
      `<div data-trend-chart>${renderTrendChart(activeStudents, trendData)}</div>`,
      renderTopBottomGroups(activeStudents, relevantGrades, groups),
      renderGroupTable(activeStudents, relevantGrades, groups),
    ].join(''));

    _bindPartialSelector();
    _renderCorrectionsBanner();
  }

  // Banner correcciones — NO bloquea el dashboard. Carga async despues del render.
  // Cache en memoria para no re-consultar al navegar varias veces.
  let _correctionsBannerCache = { data: null, timestamp: 0 };
  const BANNER_CACHE_MS = 60 * 1000; // 1 min

  async function _renderCorrectionsBanner() {
    const root = document.getElementById('dash-corrections-banner');
    if (!root) return;
    const role = App.currentUser?.role;
    if (!['admin', 'subdirector', 'directivo'].includes(role)) return;

    // Pintar primero el cache si tenemos algo (evita pantalla en blanco al navegar)
    const cacheAge = Date.now() - _correctionsBannerCache.timestamp;
    if (_correctionsBannerCache.data && cacheAge < BANNER_CACHE_MS) {
      _paintCorrectionsBanner(root, _correctionsBannerCache.data);
      return;
    }

    // Diferir la query para que no bloquee el render principal
    // (setTimeout 0 = ejecuta despues de que el browser pinte el dashboard)
    setTimeout(async () => {
      try {
        // Solo traer pending/authorized/applied — los viejos rejected/cancelled no nos importan aqui.
        // Aun mejor: 2 queries paralelas chicas en lugar de una grande de 500.
        const fs = firebase.firestore();
        const today = new Date(); today.setHours(0,0,0,0);

        const [snapPending, snapApplied] = await Promise.all([
          fs.collection('gradeCorrections').where('status','==','pending').limit(60).get(),
          fs.collection('gradeCorrections')
            .where('status','==','applied')
            .where('appliedAt','>=', firebase.firestore.Timestamp.fromDate(today))
            .limit(60).get()
            .catch(() => ({ docs: [] }))
        ]);

        const pendingFolios = new Set();
        snapPending.docs.forEach(d => pendingFolios.add(d.data().folio));
        const appliedToday = new Set();
        snapApplied.docs.forEach(d => appliedToday.add(d.data().folio));

        const data = {
          pending: pendingFolios.size,
          appliedToday: appliedToday.size,
        };
        _correctionsBannerCache = { data, timestamp: Date.now() };
        _paintCorrectionsBanner(root, data);
      } catch (e) {
        console.warn('Banner correcciones (no critico):', e.message);
        // Fallar silencioso — no es esencial para el dashboard
      }
    }, 0);
  }

  function _paintCorrectionsBanner(root, data) {
    if (!root) return;
    if (!data || (data.pending === 0 && data.appliedToday === 0)) {
      root.innerHTML = '';
      return;
    }

    const items = [];
    if (data.appliedToday > 0) {
      items.push(`<div style="display:flex;gap:8px;align-items:center;">
        <span class="material-icons-round" style="color:#6366f1;">check_circle</span>
        <span><strong>${data.appliedToday}</strong> cambio(s) aplicado(s) hoy</span>
      </div>`);
    }
    if (data.pending > 0) {
      items.push(`<div style="display:flex;gap:8px;align-items:center;">
        <span class="material-icons-round" style="color:#d97706;">schedule</span>
        <span><strong>${data.pending}</strong> solicitud(es) pendiente(s)</span>
      </div>`);
    }

    root.innerHTML = `
      <div class="card" style="background:linear-gradient(90deg,#f0f9ff 0%,#fafaff 100%);border-left:4px solid #6366f1;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <strong style="font-size:14px;color:#3730a3;">📋 Correcciones de Calificación</strong>
            <div style="display:flex;gap:24px;flex-wrap:wrap;margin-top:6px;font-size:13px;color:#1e293b;">
              ${items.join('')}
            </div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="Router.navigate('grade-corrections')">
            Ver detalle →
          </button>
        </div>
      </div>`;
  }

  function _bindPartialSelector() {
    document.querySelectorAll('.dash-partial-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        _selectedPartial = btn.dataset.partial;
        // Si ya tenemos los datos del trend (los 3 parciales), no hace falta
        // re-fetchear — _renderFull filtra por _selectedPartial sobre la fuente
        // completa.
        if (!_cachedData) return;
        if (_cachedData.trendGrades) {
          // Tenemos todos los parciales en cache — solo re-render
          _cachedData.allGrades = _cachedData.trendGrades;
          _renderFull();
          return;
        }
        // No tenemos todo — necesitamos cargar el parcial nuevo si no
        // está en allGrades (que solo trae el parcial inicial)
        const groupIds = (_cachedData.groups || []).map(g => g.id);
        try {
          let nuevosGrades;
          if (_selectedPartial === 'all') {
            nuevosGrades = await Store.getGradesByGroups(groupIds);
          } else {
            nuevosGrades = await Store.getGradesByGroupsAndPartial(groupIds, _selectedPartial);
          }
          _cachedData.allGrades = nuevosGrades;
          _renderFull();
        } catch (e) {
          console.warn('Cambio de parcial falló:', e);
          _renderFull(); // mostrar con lo que tengamos
        }
      });
    });
  }

  // ─── SELECTOR DE PARCIAL ────────────────────────────────────
  function renderPartialSelector(partials) {
    const opts = [...K.PARCIALES.map(p => ({ id: p.id, label: p.nombre })), { id: 'all', label: 'Acumulado (todos)' }];
    return `
      <div class="card" style="margin-bottom:16px;padding:14px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-weight:600;color:#1a202c;">Vista del parcial:</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${opts.map(o => {
            const active = _selectedPartial === o.id;
            const bg = active ? '#3182ce' : '#fff';
            const color = active ? '#fff' : '#3182ce';
            const border = active ? '#3182ce' : '#cbd5e0';
            return `<button class="dash-partial-btn" data-partial="${o.id}" style="padding:8px 14px;border:1px solid ${border};border-radius:6px;background:${bg};color:${color};font-weight:600;font-size:13px;cursor:pointer;">${o.label}</button>`;
          }).join('')}
        </div>
        <span style="margin-left:auto;font-size:12px;color:#666;">
          ${_selectedPartial === 'all' ? 'Mostrando promedios de los 3 parciales acumulados' : `Mostrando datos de ${K.PARCIALES.find(p => p.id === _selectedPartial)?.nombre || _selectedPartial}`}
        </span>
      </div>
    `;
  }

  // ─── KPIs PRINCIPALES ───────────────────────────────────────
  function renderKPICards(activeStudents, teachers, grades, assignments) {
    const avg = computeAverage(grades);
    const interimAsg = (assignments || []).filter(a => a.interim).length;

    // ═══ MÉTRICAS ALUMNO-CÉNTRICAS (correcto) ═══
    // El ALUMNO es la unidad — no la calificación.
    // Aprobado = alumno SIN ninguna materia reprobada
    // Irregular = alumno con AL MENOS 1 materia reprobada
    // Aprobados + Irregulares = Total (siempre cuadra contra los alumnos del salón)
    //
    // Solo contamos alumnos QUE TIENEN AL MENOS UNA CALIFICACIÓN CAPTURADA.
    // Si no se les ha capturado nada, no podemos clasificarlos todavía.
    const failsByStudent = {};
    const studentsWithGrades = new Set();
    let totalIncidencias = 0; // sumatoria de calificaciones < 6 (magnitud del problema)
    grades.forEach(g => {
      const cal = getGradeCal(g);
      if (cal !== null && cal !== undefined && !isNaN(cal)) {
        studentsWithGrades.add(g.studentId);
        if (cal < K.THRESHOLDS.PASS_GRADE) {
          failsByStudent[g.studentId] = (failsByStudent[g.studentId] || 0) + 1;
          totalIncidencias++;
        }
      }
    });

    // Solo consideramos activos con al menos una cal capturada
    const activeIds = new Set(activeStudents.map(s => s.id));
    const evaluatedIds = [...studentsWithGrades].filter(id => activeIds.has(id));
    const totalEval = evaluatedIds.length;
    const studentsIrregulares = evaluatedIds.filter(id => (failsByStudent[id] || 0) > 0).length;
    const studentsAprobados = totalEval - studentsIrregulares;
    const aprobPctStudents = totalEval > 0 ? (studentsAprobados * 100 / totalEval) : 0;

    // Niveles de riesgo (clasificación oficial EPO 67):
    //   ALTO  ≥ 5 materias reprobadas
    //   MEDIO 3-4 materias reprobadas
    //   BAJO  1-2 materias reprobadas
    let alto = 0, medio = 0, bajo = 0;
    Object.values(failsByStudent).forEach(n => {
      if (n >= 5) alto++;
      else if (n >= 3) medio++;
      else if (n >= 1) bajo++;
    });
    const enRiesgoAtencion = alto + medio;

    const kpis = [
      { label: 'Promedio General', value: grades.length > 0 ? avg.toFixed(2) : '—', icon: 'analytics', color: avg >= 8.3 ? '#16a34a' : avg >= 7 ? '#d97706' : '#dc2626', bg: avg >= 8.3 ? '#f0fdf4' : avg >= 7 ? '#fffbeb' : '#fef2f2' },
      {
        label: '% Alumnos Aprobados',
        value: totalEval > 0 ? aprobPctStudents.toFixed(1) + '%' : '—',
        icon: 'check_circle',
        color: aprobPctStudents >= 86 ? '#16a34a' : aprobPctStudents >= 75 ? '#d97706' : '#dc2626',
        bg: aprobPctStudents >= 86 ? '#f0fdf4' : aprobPctStudents >= 75 ? '#fffbeb' : '#fef2f2',
        sub: `${studentsAprobados} de ${totalEval} sin reprobadas`
      },
      {
        label: 'Alumnos Irregulares',
        value: studentsIrregulares,
        icon: 'priority_high',
        color: '#d97706',
        bg: '#fffbeb',
        sub: `${totalIncidencias} incidencia${totalIncidencias === 1 ? '' : 's'} de reprobación`
      },
      {
        label: 'Alumnos en Riesgo (≥3 mat.)',
        value: enRiesgoAtencion,
        icon: 'warning',
        color: '#dc2626',
        bg: '#fef2f2',
        sub: `🔴 ${alto} alto · 🟡 ${medio} medio · 🟢 ${bajo} bajo`
      },
      { label: 'Coberturas Activas', value: interimAsg, icon: 'swap_horiz', color: '#d97706', bg: '#fffbeb' },
      { label: 'Total Alumnos', value: activeStudents.length, icon: 'people', color: '#3182ce', bg: '#eff6ff' },
      { label: 'Docentes', value: teachers.length, icon: 'school', color: '#3182ce', bg: '#eff6ff' }
    ];

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
        ${kpis.map(k => `
          <div class="card" style="padding:14px 16px;background:${k.bg};border-left:4px solid ${k.color};">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
              <span class="material-icons-round" style="font-size:22px;color:${k.color};">${k.icon}</span>
              <span style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${k.label}</span>
            </div>
            <div style="font-size:28px;font-weight:700;color:${k.color};">${k.value}</div>
            ${k.sub ? `<div style="font-size:11px;color:#555;margin-top:4px;">${k.sub}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // ─── COMPARATIVA POR TURNO ──────────────────────────────────
  function renderTurnoComparison(activeStudents, grades, groups) {
    const studentMap = {}; activeStudents.forEach(s => { studentMap[s.id] = s; });
    const groupMap = {}; groups.forEach(g => { groupMap[g.id] = g; });

    // Normaliza turno desde groupId del estudiante o desde groups
    const getTurno = (s) => {
      const g = groupMap[s.groupId];
      const t = (g?.turno || s.turno || '').toUpperCase().trim();
      return t.startsWith('MAT') ? 'MATUTINO' : t.startsWith('VES') ? 'VESPERTINO' : 'OTRO';
    };

    const turnoData = { MATUTINO: { students: [], grades: [] }, VESPERTINO: { students: [], grades: [] } };
    activeStudents.forEach(s => {
      const t = getTurno(s);
      if (turnoData[t]) turnoData[t].students.push(s);
    });
    grades.forEach(g => {
      const s = studentMap[g.studentId];
      if (!s) return;
      const t = getTurno(s);
      if (turnoData[t]) turnoData[t].grades.push(g);
    });

    const card = (turnoName, data) => {
      const avg = computeAverage(data.grades);
      const fail = computeFailRate(data.grades);
      const apr = data.grades.length > 0 ? 100 - fail : 0;
      const hCount = data.students.filter(s => s.sexo === 'H').length;
      const mCount = data.students.filter(s => s.sexo === 'M').length;
      const color = turnoName === 'MATUTINO' ? '#3182ce' : '#d97706';
      const bgColor = turnoName === 'MATUTINO' ? '#eff6ff' : '#fffbeb';
      return `
        <div class="card" style="background:${bgColor};border-top:4px solid ${color};padding:16px 18px;">
          <h3 style="margin:0 0 10px;font-size:14px;color:${color};font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">
            <span class="material-icons-round" style="vertical-align:middle;font-size:20px;margin-right:6px;">${turnoName === 'MATUTINO' ? 'wb_sunny' : 'nights_stay'}</span>
            ${turnoName}
          </h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
            <div><strong>Alumnos:</strong> ${data.students.length}</div>
            <div><strong>H/M:</strong> ${hCount} / ${mCount}</div>
            <div><strong>Promedio:</strong> <span style="color:${avg >= 8.3 ? '#16a34a' : avg >= 7 ? '#d97706' : '#dc2626'};font-weight:700;">${data.grades.length > 0 ? avg.toFixed(2) : '—'}</span></div>
            <div><strong>% Aprob:</strong> <span style="color:${apr >= 86 ? '#16a34a' : apr >= 75 ? '#d97706' : '#dc2626'};font-weight:700;">${data.grades.length > 0 ? apr.toFixed(1) + '%' : '—'}</span></div>
            <div><strong>% Reprob:</strong> <span style="color:${fail <= 14 ? '#16a34a' : fail <= 20 ? '#d97706' : '#dc2626'};font-weight:700;">${data.grades.length > 0 ? fail.toFixed(1) + '%' : '—'}</span></div>
            <div><strong>Calif. cap.:</strong> ${data.grades.length}</div>
          </div>
        </div>`;
    };

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
        ${card('MATUTINO', turnoData.MATUTINO)}
        ${card('VESPERTINO', turnoData.VESPERTINO)}
      </div>`;
  }

  // ─── TENDENCIA ENTRE PARCIALES ──────────────────────────────
  function renderTrendChart(activeStudents, allGrades) {
    const activeIds = new Set(activeStudents.map(s => s.id));
    const trends = K.PARCIALES.map(p => {
      const pGrades = allGrades.filter(g => g.partial === p.id && activeIds.has(g.studentId));
      const avg = computeAverage(pGrades);
      const fail = computeFailRate(pGrades);
      return { id: p.id, label: p.nombre, avg, fail, count: pGrades.length };
    });

    const maxAvg = 10;
    const points = trends.map((t, i) => {
      if (t.count === 0) return null;
      const x = 50 + i * 200;
      const y = 180 - (t.avg / maxAvg) * 140;
      return { ...t, x, y };
    }).filter(Boolean);

    const path = points.length > 1
      ? 'M ' + points.map(p => `${p.x} ${p.y}`).join(' L ')
      : '';

    return `
      <div class="card" style="margin-bottom:16px;padding:16px 18px;">
        <h3 style="margin:0 0 12px;font-size:15px;font-weight:700;color:#1a202c;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:20px;margin-right:6px;">trending_up</span>
          Tendencia de promedio entre parciales
        </h3>
        <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;">
          <svg width="500" height="200" style="background:#f8fafc;border-radius:6px;flex-shrink:0;">
            <line x1="40" y1="40" x2="450" y2="40" stroke="#e5e7eb" stroke-dasharray="4"/>
            <line x1="40" y1="180" x2="450" y2="180" stroke="#94a3b8"/>
            <text x="36" y="44" text-anchor="end" font-size="10" fill="#666">10</text>
            <text x="36" y="184" text-anchor="end" font-size="10" fill="#666">0</text>
            ${path ? `<path d="${path}" stroke="#3182ce" stroke-width="3" fill="none"/>` : ''}
            ${points.map(p => `
              <circle cx="${p.x}" cy="${p.y}" r="6" fill="#3182ce" stroke="#fff" stroke-width="2"/>
              <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" font-size="13" font-weight="700" fill="#1a202c">${p.avg.toFixed(2)}</text>
              <text x="${p.x}" y="195" text-anchor="middle" font-size="11" fill="#666">${p.label}</text>
            `).join('')}
          </svg>
          <div style="flex:1;min-width:200px;">
            <table style="width:100%;font-size:13px;">
              <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Parcial</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Promedio</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #e5e7eb;">% Reprob</th><th style="text-align:right;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Cal.</th></tr></thead>
              <tbody>
                ${trends.map(t => `<tr>
                  <td style="padding:4px 8px;">${t.label}</td>
                  <td style="text-align:right;padding:4px 8px;font-weight:600;color:${t.avg >= 8.3 ? '#16a34a' : t.avg >= 7 ? '#d97706' : '#dc2626'};">${t.count > 0 ? t.avg.toFixed(2) : '—'}</td>
                  <td style="text-align:right;padding:4px 8px;font-weight:600;color:${t.fail <= 14 ? '#16a34a' : '#dc2626'};">${t.count > 0 ? t.fail.toFixed(1) + '%' : '—'}</td>
                  <td style="text-align:right;padding:4px 8px;color:#666;">${t.count}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  // ─── TOP / BOTTOM GRUPOS ────────────────────────────────────
  function renderTopBottomGroups(activeStudents, grades, groups) {
    const studentMap = {}; activeStudents.forEach(s => { studentMap[s.id] = s; });
    const groupAvgs = groups.map(g => {
      const groupGrades = grades.filter(gd => {
        const s = studentMap[gd.studentId];
        return s && s.groupId === g.id;
      });
      return { ...g, avg: computeAverage(groupGrades), count: groupGrades.length };
    }).filter(g => g.count > 0).sort((a, b) => b.avg - a.avg);

    if (groupAvgs.length === 0) {
      return `<div class="card" style="margin-bottom:16px;padding:16px;"><p style="color:#666;text-align:center;">No hay calificaciones capturadas en este parcial todavía.</p></div>`;
    }

    const top5 = groupAvgs.slice(0, 5);
    const bottom5 = groupAvgs.slice(-5).reverse();

    const renderList = (list, label, color, icon) => `
      <div class="card" style="padding:14px 16px;">
        <h3 style="margin:0 0 10px;font-size:14px;color:${color};font-weight:700;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">${icon}</span>
          ${label}
        </h3>
        <ol style="margin:0;padding-left:18px;font-size:13px;">
          ${list.map(g => `<li style="margin-bottom:4px;"><strong>${Utils.sanitize(g.nombre)}</strong> <span style="color:#666;font-size:12px;">(${g.turno || ''})</span> — <span style="color:${g.avg >= 8.3 ? '#16a34a' : g.avg >= 7 ? '#d97706' : '#dc2626'};font-weight:600;">${g.avg.toFixed(2)}</span></li>`).join('')}
        </ol>
      </div>`;

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;">
        ${renderList(top5, 'Top 5 grupos (mejor promedio)', '#16a34a', 'emoji_events')}
        ${renderList(bottom5, 'Atención: 5 grupos con menor promedio', '#dc2626', 'priority_high')}
      </div>`;
  }

  // ─── DASHBOARD SIMPLIFICADO PARA MAESTROS ─────────────────
  async function renderTeacherDashboard(container) {
    try {
      const userName = Utils.displayName(App.currentUser?.displayName || App.currentUser?.email || '');

      let assignments = [];
      try { assignments = await Store.getMyAssignments(); } catch (e) {
        console.warn('No se pudieron cargar asignaciones:', e);
      }

      if (!assignments.length) {
        container.innerHTML = UI.moduleContainer(`
          <div class="card" style="text-align:center;padding:40px;">
            <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Bienvenido(a), ${Utils.sanitize(userName)}</h1>
            <p style="color:#4a5568;">Aún no tienes asignaciones registradas. Contacta a la administración si crees que es un error.</p>
            <p style="color:#4a5568;font-size:13px;margin-top:8px;">Soporte: WhatsApp 55 1078 2357</p>
          </div>`);
        return;
      }

      // ─── Cargar datos por cada asignacion ───
      const turnoOrd = { 'MATUTINO': 1, 'VESPERTINO': 2, 'AMBOS': 3 };
      assignments.sort((a, b) =>
        (turnoOrd[(a.turno || '').toUpperCase()] || 9) - (turnoOrd[(b.turno || '').toUpperCase()] || 9)
        || (Number(a.grado) || 9) - (Number(b.grado) || 9)
        || (a.groupName || '').localeCompare(b.groupName || '')
      );

      const groupIds = [...new Set(assignments.map(a => a.groupId))];
      const [studentsAll, gradesAll, partials] = await Promise.all([
        Store.getStudentsByGroups(groupIds),
        Store.getGradesByGroups(groupIds),
        Store.getPartials(),
      ]);
      const activeStudents = studentsAll.filter(s => {
        const e = (s.estatus || '').toString().toUpperCase().trim();
        return e === '' || e === 'ACTIVO';
      });

      // ─── Estadísticas por asignación ───
      const asgStats = assignments.map(a => {
        const groupStu = activeStudents.filter(s => s.groupId === a.groupId);
        const myGrades = gradesAll.filter(g => g.groupId === a.groupId && g.subjectId === a.subjectId);
        const byPartial = { P1: [], P2: [], P3: [] };
        myGrades.forEach(g => { if (byPartial[g.partial]) byPartial[g.partial].push(g); });

        const calc = (arr) => {
          const valid = arr.map(g => Number(g.cal)).filter(n => !isNaN(n));
          if (!valid.length) return { count: 0, avg: 0, aprob: 0, reprob: 0 };
          const sum = valid.reduce((s, x) => s + x, 0);
          const avg = sum / valid.length;
          const aprob = valid.filter(n => n >= K.THRESHOLDS.PASS_GRADE).length;
          const reprob = valid.length - aprob;
          return { count: valid.length, avg, aprob, reprob };
        };

        const stats = {
          P1: calc(byPartial.P1),
          P2: calc(byPartial.P2),
          P3: calc(byPartial.P3),
        };
        const total = groupStu.length;
        const totalCaptured = Math.max(stats.P1.count, stats.P2.count, stats.P3.count);
        // Usar el parcial mas reciente con captura para el "promedio actual"
        const latest = stats.P3.count > 0 ? stats.P3 : (stats.P2.count > 0 ? stats.P2 : stats.P1);
        return { asg: a, total, totalCaptured, stats, latest };
      });

      // KPIs globales del maestro
      const totalAlumnos = asgStats.reduce((s, x) => s + x.total, 0);
      const totalAsignaciones = assignments.length;
      const totalGrupos = groupIds.length;
      const allValidLast = asgStats.flatMap(x => {
        if (x.latest.count === 0) return [];
        return Array(x.latest.count).fill(x.latest.avg);
      });
      const promedioGlobal = allValidLast.length > 0
        ? (allValidLast.reduce((s, x) => s + x, 0) / allValidLast.length).toFixed(2)
        : '—';
      const totalAprob = asgStats.reduce((s, x) => s + x.latest.aprob, 0);
      const totalReprob = asgStats.reduce((s, x) => s + x.latest.reprob, 0);
      const totalCaptured = totalAprob + totalReprob;
      const aprobPct = totalCaptured > 0 ? ((totalAprob / totalCaptured) * 100).toFixed(1) : '—';

      const interimCount = assignments.filter(a => a.interim).length;
      const interimBanner = interimCount > 0
        ? `<div style="background:#fffbeb;border-left:4px solid #d97706;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#78350f;border-radius:6px;">
             <strong>🟠 ${interimCount} cobertura${interimCount > 1 ? 's' : ''} temporal${interimCount > 1 ? 'es' : ''}</strong> entre tus asignaciones.
             Las marcadas en naranja son listas que cubres mientras se asigna al docente oficial.
           </div>`
        : '';

      const fmt = (n) => n === 0 || n ? n.toFixed(2) : '—';
      const pct = (a, b) => b > 0 ? ((a / b) * 100).toFixed(0) + '%' : '—';

      // ─── Cards de stats por asignación ───
      const asgCardsHtml = asgStats.map(x => {
        const a = x.asg;
        const turnoClass = (a.turno || '').toUpperCase() === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';
        const isInterim = !!a.interim;
        const borderColor = isInterim ? '#d97706' : '#3182ce';
        const cardBg = isInterim ? 'background:#fffbeb;' : '';
        const lastAvg = x.latest.count > 0 ? x.latest.avg : null;
        const avgColor = lastAvg === null ? '#888' : (lastAvg >= 8 ? '#16a34a' : lastAvg >= 7 ? '#d97706' : '#dc2626');
        const capturePct = x.total > 0 ? Math.round((x.latest.count / x.total) * 100) : 0;

        const asgIdAttr = Utils.sanitize(a.id || '');
        const groupIdAttr = Utils.sanitize(a.groupId || '');
        const subjectIdAttr = Utils.sanitize(a.subjectId || '');
        return `
          <div class="card" style="padding:14px;border-left:4px solid ${borderColor};${cardBg}cursor:pointer;transition:all 0.15s;"
               onclick="GradesModule.setPendingOpen({assignmentId:'${asgIdAttr}',groupId:'${groupIdAttr}',subjectId:'${subjectIdAttr}'});Router.navigate('my-grades')"
               onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';"
               onmouseout="this.style.boxShadow='none';">
            <div style="font-weight:700;font-size:14px;color:#1a202c;margin-bottom:4px;">
              ${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId))}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">
              <span class="badge ${turnoClass}" style="font-size:10px;">${Utils.sanitize(a.turno || '')}</span>
              <span class="badge" style="font-size:10px;background:#edf2f7;color:#2d3748;">Grupo ${Utils.sanitize(a.groupName || '')}</span>
              ${isInterim ? '<span class="badge" style="font-size:10px;background:#d97706;color:#fff;">🟠 Cobertura</span>' : ''}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px;">
              <div>
                <div style="color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Alumnos</div>
                <div style="font-size:18px;font-weight:700;color:#1a202c;">${x.total}</div>
              </div>
              <div>
                <div style="color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Promedio</div>
                <div style="font-size:18px;font-weight:700;color:${avgColor};">${fmt(lastAvg)}</div>
              </div>
              <div>
                <div style="color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Captura</div>
                <div style="font-size:18px;font-weight:700;color:${capturePct === 100 ? '#16a34a' : capturePct > 0 ? '#d97706' : '#dc2626'};">${capturePct}%</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;font-size:11px;">
              <div style="text-align:center;background:#dcfce7;padding:4px;border-radius:4px;">
                <strong style="color:#166534;">${x.latest.aprob}</strong>
                <span style="color:#15803d;font-size:10px;"> aprob.</span>
              </div>
              <div style="text-align:center;background:#fee2e2;padding:4px;border-radius:4px;">
                <strong style="color:#991b1b;">${x.latest.reprob}</strong>
                <span style="color:#b91c1c;font-size:10px;"> reprob.</span>
              </div>
            </div>
          </div>`;
      }).join('');

      container.innerHTML = UI.moduleContainer(`
        <!-- HEADER personal del maestro -->
        <div class="card" style="background:linear-gradient(135deg,#3182ce 0%,#2b6cb0 100%);color:#fff;padding:24px;margin-bottom:16px;">
          <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;color:#fff;">
            Bienvenido(a), ${Utils.sanitize(userName)}
          </h1>
          <p style="margin:0;font-size:13px;opacity:0.92;">
            ${totalAsignaciones} materia(s) en ${totalGrupos} grupo(s) · ${totalAlumnos} alumnos en total
          </p>
        </div>

        <!-- AVISO IMPORTANTE — ventana de edición y responsabilidad de impresión -->
        <div style="background:linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%);border:2px solid #d97706;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;gap:16px;align-items:flex-start;">
          <span class="material-icons-round" style="font-size:36px;color:#b45309;flex-shrink:0;">campaign</span>
          <div style="flex:1;">
            <h3 style="font-size:16px;font-weight:800;color:#78350f;margin:0 0 10px;line-height:1.3;">
              📌 Reglas clave de captura y entrega — léelas
            </h3>
            <ol style="font-size:13px;color:#7c2d12;line-height:1.6;margin:0 0 10px;padding-left:22px;">
              <li style="margin-bottom:8px;">
                <strong>Mientras el parcial esté abierto, edita libremente.</strong>
                Cambia calificaciones, faltas, puntos extra u horas impartidas las veces que
                necesites. Cada cambio se guarda <strong>solo</strong> en 3 segundos — no hay botón
                "Guardar" y no pides permiso para corregir.
              </li>
              <li style="margin-bottom:8px;">
                <strong>NO uses "Cambios de Calificación" mientras el parcial esté abierto.</strong>
                Las solicitudes formales están bloqueadas hasta que el parcial cierre porque
                tú mismo puedes corregir en tu lista. Si entras a ese módulo verás un aviso de
                bloqueo, no es un error.
              </li>
              <li style="margin-bottom:8px;">
                <strong>Dirección recibe UNA sola lista por grupo y materia</strong> — la última
                versión, con TODAS las firmas. Imprime <em>solo cuando ya hayas capturado y
                revisado todas tus listas</em>.
              </li>
              <li style="margin-bottom:0;">
                <strong>⛔ No se acepta entregar dos hojas.</strong> No puedes dar a Dirección una
                lista con errores y luego otra "con las correcciones" firmada solo por los
                alumnos corregidos. Si imprimes y luego cambias algo, tienes que
                <strong>reimprimir la lista completa y volver a recoger TODAS las firmas</strong>
                antes de entregar.
              </li>
            </ol>
            <p style="font-size:12px;color:#92400e;margin:0;font-style:italic;">
              Las correcciones formales (con folio y firma del Subdirector) solo se piden
              <strong>después</strong> de que el parcial cierre. Mientras esté abierto, todo es
              en directo desde tu lista.
            </p>
          </div>
        </div>

        ${interimBanner}

        <!-- KPIs globales -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
          <div class="card" style="padding:14px 16px;background:#eff6ff;border-left:4px solid #3182ce;">
            <div style="font-size:11px;color:#1e40af;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Tu promedio</div>
            <div style="font-size:28px;font-weight:800;color:#1e40af;line-height:1.1;margin-top:4px;">${promedioGlobal}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;">Parcial más reciente con captura</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#f0fdf4;border-left:4px solid #16a34a;">
            <div style="font-size:11px;color:#166534;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Aprobación</div>
            <div style="font-size:28px;font-weight:800;color:#166534;line-height:1.1;margin-top:4px;">${aprobPct}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;">${totalAprob} aprobados de ${totalCaptured} con cal.</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#fef2f2;border-left:4px solid #dc2626;">
            <div style="font-size:11px;color:#991b1b;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Reprobados</div>
            <div style="font-size:28px;font-weight:800;color:#991b1b;line-height:1.1;margin-top:4px;">${totalReprob}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;">Suma de tus listas</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#fffbeb;border-left:4px solid #d97706;">
            <div style="font-size:11px;color:#78350f;text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">Pendientes</div>
            <div style="font-size:28px;font-weight:800;color:#78350f;line-height:1.1;margin-top:4px;">${totalAlumnos - totalCaptured}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;">Alumnos sin captura aún</div>
          </div>
        </div>

        <!-- Accesos rápidos -->
        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="Router.navigate('my-grades')" style="padding:10px 16px;font-weight:600;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">edit_note</span>
              Capturar Calificaciones
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('my-lists')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">list_alt</span>
              Mis Listas
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('my-f1')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">grid_on</span>
              Concentrado F1
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('correction-request')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">rate_review</span>
              Cambios de Calificación
            </button>
          </div>
        </div>

        <!-- Tarjetas estadísticas por asignación -->
        <div class="card">
          <h2 style="font-size:16px;font-weight:700;margin:0 0 12px;color:#1a202c;">
            <span class="material-icons-round" style="vertical-align:middle;font-size:20px;color:#3182ce;">analytics</span>
            Tus grupos y materias
          </h2>
          <p style="font-size:12px;color:#64748b;margin:0 0 12px;">Toca una tarjeta para ir a capturar calificaciones de ese grupo.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
            ${asgCardsHtml}
          </div>
        </div>
      `);

      // Nota: el mega card del dashboard se removió. La impresión vive donde
      // sucede naturalmente: dentro del editor (al terminar de capturar).
    } catch (error) {
      console.error('Error en dashboard de maestro:', error);
      container.innerHTML = UI.moduleContainer(`
        <div class="card">
          <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Bienvenido(a)</h1>
          <p style="color:#4a5568;">Hubo un error cargando tus estadísticas. Usa el menú lateral para navegar.</p>
          <p style="font-size:11px;color:#888;margin-top:8px;">Detalle técnico: ${Utils.sanitize(error.message || '')}</p>
        </div>
      `);
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

          <!-- Reprobación -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;">Reprobación</span>
              <span>
                <strong>${failRate.toFixed(1)}%</strong>
                <span style="color:var(--color-text-light);font-size:12px;"> / meta max ${metaReprob}%</span>
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${reprobClass}" style="width:${reprobPct.toFixed(1)}%"></div>
            </div>
          </div>

          <!-- Aprobación -->
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-weight:600;font-size:14px;">Aprobación</span>
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
    // Build group name lookup: groupId -> nombre
    const groupNameById = {};
    const groupInfoById = {};
    groups.forEach(g => {
      groupNameById[g.id] = g.nombre || g.grupo || g.id;
      groupInfoById[g.id] = { turno: g.turno || '', grado: g.grado || '', nombre: g.nombre || g.grupo || g.id };
    });

    // Build student-to-grupo map using groupId → nombre (not student.grupo which can be stale)
    const studentsByGrupo = {};
    activeStudents.forEach(s => {
      const key = groupNameById[s.groupId] || s.grupo || 'Sin grupo';
      if (!studentsByGrupo[key]) studentsByGrupo[key] = [];
      studentsByGrupo[key].push(s);
    });

    // Build grades-by-grupo using student groupId field
    const gradesByGrupo = {};
    const studentMap = {};
    activeStudents.forEach(s => { studentMap[s.id] = s; });

    grades.forEach(g => {
      const student = studentMap[g.studentId];
      if (!student) return;
      const key = groupNameById[student.groupId] || student.grupo || 'Sin grupo';
      if (!gradesByGrupo[key]) gradesByGrupo[key] = [];
      gradesByGrupo[key].push(g);
    });

    // Build group info from groups collection
    const groupInfoMap = {};
    groups.forEach(g => {
      const name = g.nombre || g.grupo;
      if (name) {
        groupInfoMap[name] = { turno: g.turno || '', grado: g.grado || '' };
      }
    });

    // Collect all unique group names (from groups collection, canonical)
    const allGrupos = [...new Set(
      groups.map(g => g.nombre || g.grupo).filter(Boolean)
    )].sort((a, b) => {
      const infoA = groupInfoMap[a] || {};
      const infoB = groupInfoMap[b] || {};
      const turnoComp = (infoA.turno || '').localeCompare(infoB.turno || '');
      if (turnoComp !== 0) return turnoComp;
      return a.localeCompare(b);
    });

    const rows = allGrupos.map(grupoName => {
      const info = groupInfoMap[grupoName] || {};
      const studentList = studentsByGrupo[grupoName] || [];
      const gradeList = gradesByGrupo[grupoName] || [];
      const avg = computeAverage(gradeList);

      // ═══ Métrica ALUMNO-céntrica de irregularidad ═══
      // Contamos alumnos del grupo, no calificaciones.
      // Irregular = alumno con AL MENOS una calificación < 6.
      // Solo consideramos alumnos CON al menos una cal capturada.
      const failsByStudent = {};
      const evaluatedStudents = new Set();
      let totalIncidencias = 0;
      gradeList.forEach(g => {
        const cal = getGradeCal(g);
        if (cal !== null && cal !== undefined && !isNaN(cal)) {
          evaluatedStudents.add(g.studentId);
          if (cal < K.THRESHOLDS.PASS_GRADE) {
            failsByStudent[g.studentId] = (failsByStudent[g.studentId] || 0) + 1;
            totalIncidencias++;
          }
        }
      });
      const totalEval = evaluatedStudents.size;
      const irregulares = Object.keys(failsByStudent).length;
      const aprobados = totalEval - irregulares;
      const pctIrregulares = totalEval > 0 ? (irregulares * 100 / totalEval) : 0;

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

      let turno = info.turno || '';
      if (!turno && studentList.length > 0) {
        turno = studentList[0].turno || '';
      }

      const irrColor = pctIrregulares <= 14 ? 'var(--color-success)' : pctIrregulares <= 30 ? '#c05621' : 'var(--color-danger)';

      return `
        <tr>
          <td>${Utils.sanitize(turno)}</td>
          <td><strong>${Utils.sanitize(grupoName)}</strong></td>
          <td style="text-align:center;">${studentList.length}</td>
          <td style="text-align:center;font-weight:600;color:${gradeList.length > 0 ? (avg >= 8 ? 'var(--color-success)' : avg >= 7 ? '#c05621' : 'var(--color-danger)') : 'inherit'};">${gradeList.length > 0 ? avg.toFixed(2) : '-'}</td>
          <td style="text-align:center;font-weight:600;color:${gradeList.length > 0 ? 'var(--color-success)' : 'inherit'};">${totalEval > 0 ? aprobados : '-'}</td>
          <td style="text-align:center;font-weight:600;color:${gradeList.length > 0 ? irrColor : 'inherit'};">${totalEval > 0 ? `${irregulares} (${pctIrregulares.toFixed(0)}%)` : '-'}</td>
          <td style="text-align:center;color:#6b7280;font-size:12px;">${totalIncidencias > 0 ? totalIncidencias : '-'}</td>
          <td style="text-align:center;">${statusHtml}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="card" style="margin-top:24px;">
        <h2 class="section-title" style="margin-bottom:6px;">
          <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;font-size:22px;">table_chart</span>
          Estado de Grupos
        </h2>
        <p style="margin:0 0 16px;font-size:12px;color:#6b7280;">
          <strong>Aprobados / Irregulares:</strong> alumnos sin / con al menos una materia reprobada.
          <strong>Incidencias:</strong> total de calificaciones &lt; 6 (un alumno puede tener varias).
        </p>
        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Grupo</th>
                <th style="text-align:center;">Alumnos</th>
                <th style="text-align:center;">Promedio</th>
                <th style="text-align:center;">Aprobados</th>
                <th style="text-align:center;">Irregulares</th>
                <th style="text-align:center;">Incidencias</th>
                <th style="text-align:center;">Estado</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="8" style="text-align:center;">Sin datos de grupos</td></tr>'}
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

  // ─── MEGA CARD: IMPRIMIR TODAS LAS LISTAS EN 1 CLIC (dashboard del maestro) ───
  // Esta función auxiliar genera el HTML del card. El binding de los clics se hace
  // dentro de renderTeacherDashboard via document.querySelector después del innerHTML.
  function _renderBulkPrintMegaCard(assignments, partials) {
    if (!assignments || assignments.length === 0) return '';
    const total = assignments.length;

    // Determinar parcial activo: primero busca uno NO bloqueado.
    // Si todos están bloqueados, toma el último (cronológicamente más reciente).
    const partialState = (K.PARCIALES || []).map(kp => {
      const doc = (partials || []).find(p => p.id === kp.id);
      return { id: kp.id, label: kp.nombre, locked: doc?.locked === true };
    });
    const activePartial = partialState.find(p => !p.locked) || partialState[partialState.length - 1];
    const defaultId = activePartial?.id || 'P1';

    // 3 pastillas de parcial
    const pills = partialState.map(p => {
      const isActive = p.id === defaultId;
      const lockedIcon = p.locked ? '🔒' : '🟢';
      const statusLabel = p.locked
        ? '<span style="font-size:11px;color:#475569;">Cerrado · imprimible</span>'
        : '<span style="font-size:11px;color:#16a34a;font-weight:600;">En curso ✓</span>';
      return `
        <button data-bulk-partial="${p.id}"
          class="bulk-pill${isActive ? ' active' : ''}"
          style="${isActive ? 'background:#fde68a;border:3px solid #d97706;' : 'background:#fff;border:2px solid #d1d5db;'}
                 border-radius:10px;padding:14px 18px;cursor:pointer;text-align:center;
                 flex:1;min-width:140px;transition:all 0.15s;font-family:inherit;">
          <div style="font-size:13px;font-weight:700;color:#78350f;margin-bottom:4px;">${Utils.sanitize(p.label)}</div>
          <div style="font-size:18px;line-height:1;">${lockedIcon}</div>
          <div style="margin-top:6px;">${statusLabel}</div>
        </button>`;
    }).join('');

    const activeLabel = activePartial?.label || 'Parcial';

    return `
      <div id="bulk-print-mega-card" style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:3px solid #d97706;border-radius:14px;padding:22px 24px;margin-bottom:16px;box-shadow:0 4px 12px rgba(217,119,6,0.15);">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
          <span class="material-icons-round" style="font-size:44px;color:#b45309;">picture_as_pdf</span>
          <div style="flex:1;">
            <h3 style="font-size:18px;font-weight:800;margin:0 0 4px;color:#7c2d12;">
              📄 Imprimir todas mis listas en 1 clic
            </h3>
            <p style="font-size:13px;color:#92400e;margin:0;line-height:1.45;">
              Genera <strong>un solo PDF</strong> con tus <strong>${total} listas</strong> del parcial que elijas.
              Lo puedes guardar como archivo o mandar directo a la impresora.
            </p>
          </div>
        </div>

        <div style="margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#7c2d12;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">
            Elige parcial:
          </div>
          <div id="bulk-pills" style="display:flex;gap:10px;flex-wrap:wrap;">
            ${pills}
          </div>
        </div>

        <button id="bulk-print-mega-action"
          data-partial-id="${defaultId}"
          style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;
                 background:linear-gradient(135deg,#d97706 0%,#b45309 100%);color:#fff;
                 border:none;border-radius:10px;padding:18px 24px;font-size:16px;font-weight:800;
                 cursor:pointer;box-shadow:0 4px 8px rgba(180,83,9,0.3);transition:transform 0.1s;
                 font-family:inherit;">
          <span class="material-icons-round" style="font-size:28px;">download</span>
          <span id="bulk-action-label">OBTENER PDF — ${total} listas del ${Utils.sanitize(activeLabel)}</span>
        </button>

        <div style="text-align:center;margin-top:12px;">
          <a href="#" id="bulk-go-granular" style="font-size:13px;color:#92400e;text-decoration:underline;">
            ¿Solo necesitas algunas? Elegir manualmente las listas →
          </a>
        </div>
      </div>`;
  }

  /** Vincula los clics del mega card (debe llamarse DESPUÉS de innerHTML). */
  function _bindBulkPrintMegaCard(assignments, partials) {
    const card = document.getElementById('bulk-print-mega-card');
    if (!card) return;

    const actionBtn = document.getElementById('bulk-print-mega-action');
    const actionLabel = document.getElementById('bulk-action-label');

    // Click en pastilla → cambiar parcial activo
    card.querySelectorAll('[data-bulk-partial]').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const pid = pill.dataset.bulkPartial;
        // Actualizar estilos: quitar active de todas, ponerla en la clicada
        card.querySelectorAll('[data-bulk-partial]').forEach(p => {
          p.style.background = '#fff';
          p.style.border = '2px solid #d1d5db';
          p.classList.remove('active');
        });
        pill.style.background = '#fde68a';
        pill.style.border = '3px solid #d97706';
        pill.classList.add('active');

        // Actualizar el botón de acción
        const partial = (K.PARCIALES || []).find(p => p.id === pid);
        if (actionBtn) actionBtn.dataset.partialId = pid;
        if (actionLabel) actionLabel.textContent = `OBTENER PDF — ${assignments.length} listas del ${partial?.nombre || pid}`;
      });
    });

    // Click en botón principal → llamar a GradesModule.printMultipleAssignments
    if (actionBtn) {
      actionBtn.addEventListener('click', async () => {
        const partialId = actionBtn.dataset.partialId || 'P1';
        const ids = assignments.map(a => a.id);
        try {
          actionBtn.disabled = true;
          actionBtn.style.opacity = '0.7';
          if (actionLabel) actionLabel.textContent = 'Generando PDF, espera…';
          await GradesModule.printMultipleAssignments(ids, partialId);
        } catch (e) {
          console.error('Error al generar PDF:', e);
          if (typeof Toast !== 'undefined') Toast.show('No se pudo generar el PDF: ' + (e.message || ''), 'error');
        } finally {
          actionBtn.disabled = false;
          actionBtn.style.opacity = '1';
          const partial = (K.PARCIALES || []).find(p => p.id === partialId);
          if (actionLabel) actionLabel.textContent = `OBTENER PDF — ${assignments.length} listas del ${partial?.nombre || partialId}`;
        }
      });
    }

    // Click en link "elegir manualmente" → ir a my-grades donde está el panel granular
    const granular = document.getElementById('bulk-go-granular');
    if (granular) {
      granular.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof Router !== 'undefined') Router.navigate('my-grades');
      });
    }
  }

  // ─── PUBLIC API ─────────────────────────────────────────────
  return { render };
})();

// Self-register in Router
Router.modules['dashboard'] = () => DashboardModule.render();
