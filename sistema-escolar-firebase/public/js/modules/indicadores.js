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

    // Detección de Presidente/Secretario de Academia (acceso filtrado a grado+turno)
    const _user = App.currentUser || {};
    const _acaGrado = Number(_user.academiaGrado) || null;
    const _acaTurno = _user.academiaTurno || null;
    const _acaRol = _user.academiaRol || null;
    const _isAcademia = !!(_acaGrado && _acaTurno);
    const _acaTitulo = _isAcademia
      ? 'Indicadores · ' + _acaGrado + '° ' + _acaTurno
      : 'Indicadores Institucionales';
    const _acaSubtitulo = _isAcademia
      ? 'Vista de la Academia de ' + _acaGrado + '° grado del turno ' + _acaTurno.toLowerCase() + '.' + (_acaRol ? ' Eres ' + _acaRol + '.' : '')
      : 'Elige el turno y la acción que necesitas. Eso es todo.';

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">${_acaTitulo}</h1>
            <p class="module-subtitle">${_acaSubtitulo}</p>
          </div>
        </div>
        ${_isAcademia ? `
        <div class="alert alert-info" style="margin-bottom:14px;border-left:4px solid #0891b2;background:#ecfeff;color:#155e75;padding:12px 16px;">
          <strong>🎓 Vista de Academia:</strong> Estás viendo los indicadores SOLO de los grupos de ${_acaGrado}° grado del turno ${_acaTurno.toLowerCase()}.
        </div>` : ''}

        <!-- SELECTOR DE PARCIAL (chico, default P2) -->
        <div class="chip-filter-bar" id="ind-chip-filters" style="padding:12px 16px;margin-bottom:18px;">
          <div class="chip-filter-row" style="margin-bottom:0;">
            <span class="chip-filter-label">¿Qué parcial?</span>
            <div class="chip-group">
              ${K.PARCIALES.map(p => `<button class="chip chip-parcial ${p.id === 'P2' ? 'active' : ''}" data-filter="parcial" data-value="${p.id}">${p.nombre}</button>`).join('')}
              <button class="chip chip-parcial" data-filter="parcial" data-value="ACUM" title="Promedio acumulado de los 3 parciales">📊 Acumulado</button>
            </div>
          </div>
          <!-- Filtros ocultos para compatibilidad con código viejo -->
          <span style="display:none;">
            <button class="chip active" data-filter="turno" data-value=""></button>
            <button class="chip active" data-filter="grado" data-value=""></button>
            <button class="chip active" data-filter="grupo" data-value=""></button>
          </span>
        </div>

        <!-- 2 TARJETAS POR TURNO con 2 acciones ÚTILES cada una -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:18px;margin-bottom:18px;">

          <!-- TARJETA MATUTINO (oculta si presidente_academia de otro turno) -->
          <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);border-radius:16px;padding:22px;color:#fff;box-shadow:0 8px 20px rgba(220,38,38,0.25);${_isAcademia && _acaTurno !== 'MATUTINO' ? 'display:none;' : ''}">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
              <span style="font-size:42px;">☀</span>
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.85;">TURNO</div>
                <div style="font-size:26px;font-weight:900;line-height:1;">MATUTINO</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn-turno-action" data-action="download-excel" data-turno="MATUTINO" style="background:#fff;color:#b91c1c;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">grid_on</span>
                <div style="flex:1;">
                  <div>Excel de indicadores</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">5 hojas: PRIMERO, SEGUNDO, TERCERO, GENERAL, CASOS ESPECIALES</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="MATUTINO" data-formato="pdf" style="background:#fff;color:#b91c1c;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">picture_as_pdf</span>
                <div style="flex:1;">
                  <div>📄 Análisis en PDF</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Para imprimir o leer. Abre listo para Cmd+P / Ctrl+P → Guardar como PDF</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="MATUTINO" data-formato="present" style="background:#fff;color:#b91c1c;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">slideshow</span>
                <div style="flex:1;">
                  <div>🎬 Presentación interactiva</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Slideshow listo para proyectar. Navega con ← → o espacio.</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="MATUTINO" data-formato="json" style="background:#fff;color:#b91c1c;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">smart_toy</span>
                <div style="flex:1;">
                  <div>🤖 Análisis en JSON (para IA)</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Pégalo en ChatGPT/Claude/Gemini para generar tu presentación profesional</div>
                </div>
              </button>
            </div>
          </div>

          <!-- TARJETA VESPERTINO (oculta si presidente_academia de otro turno) -->
          <div style="background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);border-radius:16px;padding:22px;color:#fff;box-shadow:0 8px 20px rgba(124,58,237,0.25);${_isAcademia && _acaTurno !== 'VESPERTINO' ? 'display:none;' : ''}">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
              <span style="font-size:42px;">🌙</span>
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.85;">TURNO</div>
                <div style="font-size:26px;font-weight:900;line-height:1;">VESPERTINO</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <button class="btn-turno-action" data-action="download-excel" data-turno="VESPERTINO" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">grid_on</span>
                <div style="flex:1;">
                  <div>Excel de indicadores</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">5 hojas: PRIMERO, SEGUNDO, TERCERO, GENERAL, CASOS ESPECIALES</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="VESPERTINO" data-formato="pdf" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">picture_as_pdf</span>
                <div style="flex:1;">
                  <div>📄 Análisis en PDF</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Para imprimir o leer. Abre listo para Cmd+P / Ctrl+P → Guardar como PDF</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="VESPERTINO" data-formato="present" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">slideshow</span>
                <div style="flex:1;">
                  <div>🎬 Presentación interactiva</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Slideshow listo para proyectar. Navega con ← → o espacio.</div>
                </div>
              </button>
              <button class="btn-turno-action" data-action="download-analisis" data-turno="VESPERTINO" data-formato="json" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
                <span class="material-icons-round" style="font-size:24px;">smart_toy</span>
                <div style="flex:1;">
                  <div>🤖 Análisis en JSON (para IA)</div>
                  <div style="font-size:11px;font-weight:500;opacity:0.7;">Pégalo en ChatGPT/Claude/Gemini para generar tu presentación profesional</div>
                </div>
              </button>
            </div>
          </div>

        </div>

        <!-- BANNER EXPLICATIVO -->
        <div style="background:#eff6ff;border:2px solid #3182ce;border-radius:12px;padding:16px 20px;font-size:14px;color:#1e40af;line-height:1.6;">
          <div style="font-size:16px;font-weight:800;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
            <span class="material-icons-round" style="font-size:22px;">tips_and_updates</span>
            ¿Para qué sirve cada cosa?
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
            <div style="background:#fff;border-radius:8px;padding:10px 12px;border-left:4px solid #16a34a;">
              <strong style="color:#15803d;">📊 Excel de indicadores</strong><br>
              <span style="font-size:12px;color:#374151;">Las 5 hojas reglamentarias (PRIMERO, SEGUNDO, TERCERO, GENERAL, CASOS ESPECIALES).</span>
            </div>
            <div style="background:#fff;border-radius:8px;padding:10px 12px;border-left:4px solid #2563eb;">
              <strong style="color:#1d4ed8;">📄 Análisis en PDF</strong><br>
              <span style="font-size:12px;color:#374151;">Reporte formateado para imprimir o leer. Cmd+P / Ctrl+P para guardar.</span>
            </div>
            <div style="background:#fff;border-radius:8px;padding:10px 12px;border-left:4px solid #b91c1c;">
              <strong style="color:#991b1b;">🎬 Presentación interactiva</strong><br>
              <span style="font-size:12px;color:#374151;">Slideshow listo para junta o consejo técnico. Navega con flechas ← →. <strong>Generada por el sistema, no necesitas IA.</strong></span>
            </div>
            <div style="background:#fff;border-radius:8px;padding:10px 12px;border-left:4px solid #d97706;">
              <strong style="color:#b45309;">🤖 Análisis en JSON (para IA)</strong><br>
              <span style="font-size:12px;color:#374151;">Pégalo en <strong>ChatGPT/Claude/Gemini</strong>. Trae el prompt incluido — la IA genera su propia presentación. ⚡</span>
            </div>
          </div>
        </div>

        <!-- TABS de visualización (se muestran solo cuando hay datos calculados) -->
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

        <div id="ind-results"></div>
      </div>`;

    // Bind events ANTES de cargar datos — los botones son clickeables inmediatamente.
    // La carga de datos corre en paralelo; los handlers esperan si todavía no terminó.
    bindEvents(container);
    loadData(); // sin await — corre en background
  }

  // ─── HELPERS DE CHIP FILTERS ───
  // Lee el filtro activo de un grupo de chips. Si nada está activo, retorna ''.
  function _chipValue(filter) {
    const bar = document.getElementById('ind-chip-filters');
    if (!bar) return '';
    const active = bar.querySelector(`.chip[data-filter="${filter}"].active`);
    return active ? (active.dataset.value || '') : '';
  }
  // Cambia el chip activo en un grupo (toggle de la opción seleccionada)
  function _setActiveChip(filter, value) {
    const bar = document.getElementById('ind-chip-filters');
    if (!bar) return;
    bar.querySelectorAll(`.chip[data-filter="${filter}"]`).forEach(c => {
      c.classList.toggle('active', (c.dataset.value || '') === (value || ''));
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA
  // ═══════════════════════════════════════════════════════════════
  // Solo carga datos LIVIANOS al abrir Indicadores. Los grades se cargan
  // SOLO cuando el usuario presiona "Generar Excel" o "Análisis".
  async function loadData() {
    try {
      const [studentsBase, subjects, groups, oriGroups] = await Promise.all([
        Store.getStudents(),
        Store.getSubjects(),
        Store.getGroups(),
        Store.getOrientadorGroups()
      ]);

      // ═══ FILTRADO POR ROL ═══
      // Admin / Subdirector / Directivo: ven TODO (oriGroups === null)
      // Orientador / Orientador-docente: ven TODO el TURNO donde son orientadores
      // Presidente de Academia (campos academiaGrado/Turno seteados): ven
      //   SOLO los grupos de su grado + turno (filtro más estricto que orientador)
      let filteredGroups;
      const user = App.currentUser || {};
      const acaGrado = Number(user.academiaGrado) || null;
      const acaTurno = user.academiaTurno || null;
      const isAcademia = !!(acaGrado && acaTurno);

      if (oriGroups === null) {
        filteredGroups = groups; // admin
      } else if (oriGroups.length === 0 && !isAcademia) {
        filteredGroups = []; // ni orientadora ni presidenta de academia
      } else {
        // Determinar turnos visibles (de su rol de orientadora si aplica + de academia si aplica)
        const turnosVisibles = new Set();
        if (oriGroups.length > 0) {
          const oriGroupSet = new Set(oriGroups);
          groups.filter(g => oriGroupSet.has(g.id))
            .forEach(g => g.turno && turnosVisibles.add(g.turno));
        }
        if (isAcademia) turnosVisibles.add(acaTurno);
        // Filtrar grupos de esos turnos
        filteredGroups = groups.filter(g => turnosVisibles.has(g.turno));
      }

      // Filtro ADICIONAL para presidente de academia: limitar al grado específico
      if (isAcademia) {
        filteredGroups = filteredGroups.filter(g =>
          Number(g.grado) === acaGrado && g.turno === acaTurno
        );
      }

      const allowedIds = new Set(filteredGroups.map(g => g.id));
      allStudents = studentsBase.filter(s =>
        s.estatus === 'ACTIVO' && (oriGroups === null || allowedIds.has(s.groupId))
      );
      allGrades = [];
      allSubjects = subjects;
      allGroups = filteredGroups;
      updateGroupOptions();
    } catch (e) {
      console.error('Error:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // Carga las grades SOLO cuando se necesitan (lazy). Cachea localmente
  // dentro del módulo para que múltiples generaciones consecutivas no
  // re-pidan. El cache del Store ya deduplicaba pero esto evita re-loops.
  let _gradesLoaded = false;
  async function _ensureGradesLoaded() {
    if (_gradesLoaded && allGrades.length > 0) return;
    if (allGroups.length === 0) return;
    Toast.show('Cargando calificaciones…', 'info', 1500);
    const groupIds = allGroups.map(g => g.id);
    allGrades = await Store.getGradesByGroups(groupIds);
    _gradesLoaded = true;
  }

  function updateGroupOptions() {
    const chips = document.getElementById('ind-grupo-chips');
    if (!chips) return;
    const turno = _chipValue('turno');
    const grado = _chipValue('grado');
    let filtered = [...allGroups];
    if (turno) filtered = filtered.filter(g => g.turno === turno);
    if (grado) filtered = filtered.filter(g => String(g.grado) === String(grado));
    const nombres = [...new Set(filtered.map(g => g.nombre || g.grupo))].filter(Boolean).sort();
    const currentSelected = _chipValue('grupo');
    // Si el grupo seleccionado ya no está en la lista filtrada, volver a "Todos"
    const stillAvailable = nombres.includes(currentSelected);
    chips.innerHTML = `
      <button class="chip ${!currentSelected || !stillAvailable ? 'active' : ''}" data-filter="grupo" data-value="">Todos</button>
      ${nombres.map(n => `<button class="chip ${currentSelected === n && stillAvailable ? 'active' : ''}" data-filter="grupo" data-value="${n}">${n}</button>`).join('')}
    `;
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
    // ALUMNO IRREGULAR = tiene ≥1 calificación < 6 (criterio estricto por reglamento académico).
    // NO basta con que su promedio sea bajo — debe tener al menos una materia reprobada.
    // Esta es la métrica institucional correcta.
    let totalIrregulares = 0, totalAprobados = 0, totalIncidencias = 0;
    studentAvgs.forEach(sa => {
      const reprobs = (sa.grades || []).filter(g => g.cal < pass).length;
      if (reprobs > 0) { totalIrregulares++; totalIncidencias += reprobs; }
      else totalAprobados++;
    });
    const repPct = totalEval ? Math.round(totalIrregulares / totalEval * 100) : 0;
    const aprobPct = totalEval ? Math.round(totalAprobados / totalEval * 100) : 0;

    return {
      students, grades, studentAvgs, byGroup, bySubject, byGS, dist, genAvg,
      repPct, aprobPct, totalEval, totalAprobados, totalIrregulares, totalIncidencias,
      metaP, metaR, pass, studentMap, groupNameMap
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CALCULATE + TAB SYSTEM
  // ═══════════════════════════════════════════════════════════════
  let _currentData = null;
  let _currentTab = 'panorama';

  async function calculate() {
    _destroyCharts();
    await _ensureGradesLoaded(); // lazy load de calificaciones
    const turno = _chipValue("turno");
    const grado = _chipValue("grado");
    const grupo = _chipValue("grupo");
    const parcial = _chipValue("parcial");

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
          <div class="stat-label">Alumnos Aprobados</div>
          <div class="stat-number" style="color:var(--color-success)">${d.totalAprobados}</div>
          <div class="stat-label">${d.aprobPct}% del total</div>
        </div></div>
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Alumnos Irregulares</div>
          <div class="stat-number" style="color:var(--color-${repColor})">${d.totalIrregulares}</div>
          <div class="stat-label">${d.repPct}% &middot; meta ≤${d.metaR}%</div>
        </div></div>
        <div class="stat-card stat-card--bordered"><div class="stat-content">
          <div class="stat-label">Incidencias</div>
          <div class="stat-number" style="color:#d97706">${d.totalIncidencias}</div>
          <div class="stat-label">total calif. &lt; 6</div>
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
        <div class="card"><h3 class="section-title">Promedio vs Reprobación</h3>
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
            { label: '% Reprobación', data: groups.map(g => g.repPct), backgroundColor: '#e53e3e', yAxisID: 'y1' }
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
          labels: ['Promedio (x10)', '% Aprobación', 'Cobertura', 'Asistencia'],
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
        <div class="card"><h3 class="section-title">Reprobación por Materia</h3>
          <canvas id="chart-mat-reprob" height="300"></canvas>
        </div>
        <div class="card"><h3 class="section-title">Faltas vs Calificación</h3>
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
          datasets: [{ label: '% Reprobación', data: sorted.map(s => s.repPct), backgroundColor: sorted.map(s => s.repPct > d.metaR ? '#e53e3e' : '#38a169') }]
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
    const turno = _chipValue("turno");
    const grado = _chipValue("grado");
    const grupo = _chipValue("grupo");

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
      Utils.exportToExcel(exportData, Utils.fileName({
        tipo: 'INDICADORES',
        turno: _chipValue("turno"),
        grado: _chipValue("grado"),
        parcial: _chipValue("parcial"),
        ext: 'xlsx'
      }));
    } catch (e) {
      Toast.show('Error al exportar: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // REPORTE INDICADORES POR TURNO (formato INDICADORES 2 BIM.xlsx)
  // 5 hojas: PRIMERO, SEGUNDO, TERCERO, CONCENTRADO GENERAL, CASOS ESPECIALES
  // ═══════════════════════════════════════════════════════════════
  async function generateIndicadoresByTurnoExcel(turno, btn) {
    const partial = _chipValue("parcial") || 'P2';
    const partialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;

    if (!confirm(
      `¿Generar Indicadores del turno ${turno}?\n\n` +
      `Parcial: ${partialLabel}\n\n` +
      `Se descargará UN Excel con 5 hojas:\n` +
      `  • PRIMERO — Indicadores de los 3 grupos de 1° grado\n` +
      `  • SEGUNDO — Indicadores de los 3 grupos de 2° grado\n` +
      `  • TERCERO — Indicadores de los 3 grupos de 3° grado\n` +
      `  • CONCENTRADO GENERAL — Resumen por grado y total del turno\n` +
      `  • CASOS ESPECIALES — Alumnos reprobados por grupo con columnas vacías (P.CONDUC, PSICOLOGICO, ECONOMICO, SALUD) para anotaciones a mano`
    )) return;

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:16px;vertical-align:middle;margin-right:4px;">autorenew</span>Generando…';
    try {
      if (typeof ConcentradoModule === 'undefined' || !ConcentradoModule.generateIndicadoresReportByTurno) {
        Toast.show('Módulo Concentrado no disponible. Recarga la página (Ctrl+Shift+R).', 'error');
        return;
      }
      await ConcentradoModule.generateIndicadoresReportByTurno(turno, partial);
    } catch (e) {
      console.error('Error generando indicadores:', e);
      Toast.show('Error: ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ANÁLISIS DETALLADO DESCARGABLE (PDF y JSON)
  // ═══════════════════════════════════════════════════════════════

  // ─── Calcula el análisis y retorna un objeto estructurado ───
  // Esta es la fuente única de la verdad. Las funciones de export (PDF/JSON)
  // toman este objeto y solo lo formatean.
  function _computeAnalisis(turno, partial) {
    // Soporte 'ACUM' (acumulado: todos los parciales)
    const isAcum = partial === 'ACUM';
    const partialLabel = isAcum
      ? 'Acumulado · Todos los parciales'
      : (K.PARCIALES.find(p => p.id === partial)?.nombre || partial);
    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const META_PROM = 8.3, META_REPROB_MAX = 14;
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

    const turnoGroups = allGroups.filter(g => g.turno === turno).sort((a, b) =>
      (Number(a.grado) || 0) - (Number(b.grado) || 0) || (a.nombre || '').localeCompare(b.nombre || '')
    );
    if (turnoGroups.length === 0) return null;

    const groupIds = new Set(turnoGroups.map(g => g.id));
    const turnoStudents = allStudents.filter(s => groupIds.has(s.groupId));
    // En modo ACUM, incluir grades de TODOS los parciales (agregado)
    const turnoGrades = isAcum
      ? allGrades.filter(g => groupIds.has(g.groupId))
      : allGrades.filter(g => g.partial === partial && groupIds.has(g.groupId));

    const subjectById = new Map();
    allSubjects.forEach(s => subjectById.set(s.id, s));

    // Por alumno
    const studentMetrics = turnoStudents.map(stu => {
      const gs = turnoGrades.filter(g => g.studentId === stu.id);
      const cals = gs.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
      const faltas = gs.reduce((acc, g) => acc + (Number(g.faltas) || 0), 0);
      const prom = cals.length > 0 ? cals.reduce((a, b) => a + b, 0) / cals.length : null;
      const reprob = cals.filter(c => c < passGrade).length;
      return { stu, prom, reprob, totalMaterias: cals.length, faltas };
    }).filter(m => m.totalMaterias > 0);

    // Por grupo
    const groupMetrics = turnoGroups.map(grp => {
      const members = studentMetrics.filter(m => m.stu.groupId === grp.id);
      const proms = members.map(m => m.prom).filter(p => p != null);
      const prom = proms.length > 0 ? proms.reduce((a, b) => a + b, 0) / proms.length : null;
      const aprob = members.filter(m => m.reprob === 0 && m.totalMaterias > 0).length;
      const reprob = members.filter(m => m.reprob > 0).length;
      const total = aprob + reprob;
      const totalIncidencias = members.reduce((a, m) => a + m.reprob, 0);
      const avgFaltas = members.length > 0 ? members.reduce((a, m) => a + m.faltas, 0) / members.length : 0;
      return {
        grupo: grp.nombre, grupoId: grp.id, grado: Number(grp.grado),
        promedio: prom != null ? +prom.toFixed(2) : null,
        aprobados: aprob, reprobados: reprob, totalAlumnos: total,
        incidenciasReprobacion: totalIncidencias,
        promedioFaltas: +avgFaltas.toFixed(2),
        pctAprobacion: total > 0 ? +(aprob * 100 / total).toFixed(1) : 0,
        pctReprobacion: total > 0 ? +(reprob * 100 / total).toFixed(1) : 0,
      };
    });

    // Por materia×grupo
    const materiaGrupoStats = [];
    for (const grp of turnoGroups) {
      const subjGrades = {};
      const gradesForGroup = turnoGrades.filter(g => g.groupId === grp.id);
      for (const g of gradesForGroup) {
        if (!subjGrades[g.subjectId]) subjGrades[g.subjectId] = [];
        const cal = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
        if (!isNaN(cal)) subjGrades[g.subjectId].push(cal);
      }
      for (const [subjectId, cals] of Object.entries(subjGrades)) {
        const subj = subjectById.get(subjectId);
        if (!subj) continue;
        const aprob = cals.filter(c => c >= passGrade).length;
        const reprob = cals.length - aprob;
        const prom = cals.length > 0 ? cals.reduce((a, b) => a + b, 0) / cals.length : null;
        materiaGrupoStats.push({
          grupo: grp.nombre, grado: Number(grp.grado),
          materia: K.getUACNombre ? K.getUACNombre(subj.nombre || subj.id) : (subj.nombre || subj.id),
          promedio: prom != null ? +prom.toFixed(2) : null,
          aprobados: aprob, reprobados: reprob, totalAlumnos: cals.length,
          pctAprobacion: cals.length > 0 ? +(aprob * 100 / cals.length).toFixed(1) : 0,
          pctReprobacion: cals.length > 0 ? +(reprob * 100 / cals.length).toFixed(1) : 0,
        });
      }
    }

    // Globales
    const totalAlumnos = studentMetrics.length;
    const promGlobal = totalAlumnos > 0 ? studentMetrics.reduce((a, m) => a + (m.prom || 0), 0) / totalAlumnos : 0;
    const totalAprobGlobal = studentMetrics.filter(m => m.reprob === 0).length;
    const totalReprobGlobal = studentMetrics.filter(m => m.reprob > 0).length;
    const pctAprobGlobal = totalAlumnos > 0 ? (totalAprobGlobal * 100 / totalAlumnos) : 0;
    const pctReprobGlobal = totalAlumnos > 0 ? (totalReprobGlobal * 100 / totalAlumnos) : 0;
    const totalIncidenciasGlobal = studentMetrics.reduce((a, m) => a + m.reprob, 0);
    const promFaltasGlobal = totalAlumnos > 0 ? studentMetrics.reduce((a, m) => a + m.faltas, 0) / totalAlumnos : 0;

    // Pearson
    function pearson(arr) {
      const n = arr.length;
      if (n < 3) return null;
      const mX = arr.reduce((a, b) => a + b[0], 0) / n;
      const mY = arr.reduce((a, b) => a + b[1], 0) / n;
      let num = 0, dX2 = 0, dY2 = 0;
      for (const [x, y] of arr) {
        num += (x - mX) * (y - mY);
        dX2 += (x - mX) ** 2;
        dY2 += (y - mY) ** 2;
      }
      const den = Math.sqrt(dX2 * dY2);
      return den === 0 ? null : +(num / den).toFixed(3);
    }
    const corrFaltasProm = pearson(studentMetrics.filter(m => m.prom != null).map(m => [m.faltas, m.prom]));
    const corrFaltasAprob = pearson(groupMetrics.map(gm => [gm.promedioFaltas, gm.pctAprobacion]));

    // Por grado
    const porGrado = [1, 2, 3].map(grado => {
      const gms = groupMetrics.filter(gm => gm.grado === grado);
      const proms = gms.filter(g => g.promedio != null).map(g => g.promedio);
      const promGrado = proms.length > 0 ? +(proms.reduce((a, b) => a + b, 0) / proms.length).toFixed(2) : null;
      const incidencias = gms.reduce((a, g) => a + g.incidenciasReprobacion, 0);
      // Top 5 materias del grado
      const mgs = materiaGrupoStats.filter(m => m.grado === grado && m.totalAlumnos > 0);
      const byMateria = {};
      for (const m of mgs) {
        if (!byMateria[m.materia]) byMateria[m.materia] = { reprob: 0, total: 0, sumProm: 0, cnt: 0 };
        byMateria[m.materia].reprob += m.reprobados;
        byMateria[m.materia].total += m.totalAlumnos;
        if (m.promedio != null) { byMateria[m.materia].sumProm += m.promedio; byMateria[m.materia].cnt++; }
      }
      const top5 = Object.entries(byMateria)
        .map(([mat, s]) => ({
          materia: mat,
          reprobados: s.reprob,
          totalAlumnos: s.total,
          promedio: s.cnt > 0 ? +(s.sumProm / s.cnt).toFixed(2) : null,
          pctReprobacion: s.total > 0 ? +(s.reprob * 100 / s.total).toFixed(1) : 0,
        }))
        .sort((a, b) => b.reprobados - a.reprobados).slice(0, 5);
      return { grado, promedio: promGrado, incidencias, grupos: gms, top5Vulnerables: top5 };
    }).filter(g => g.grupos.length > 0);

    // Alumnos en riesgo
    const enRiesgoAlto = studentMetrics.filter(m => m.reprob >= 4)
      .sort((a, b) => b.reprob - a.reprob)
      .map(m => ({
        nombre: `${m.stu.apellido1 || ''} ${m.stu.apellido2 || ''} ${m.stu.nombres || ''}`.trim(),
        grupo: turnoGroups.find(g => g.id === m.stu.groupId)?.nombre || '?',
        materiasReprobadas: m.reprob,
        promedio: m.prom != null ? +m.prom.toFixed(2) : null,
        faltas: m.faltas,
      }));
    const enRiesgoMedio = studentMetrics.filter(m => m.reprob >= 1 && m.reprob <= 3).length;

    // Top 10 peores materia×grupo
    const peorMatGrupo = materiaGrupoStats
      .filter(m => m.totalAlumnos >= 5 && m.promedio != null)
      .sort((a, b) => a.promedio - b.promedio).slice(0, 10);

    // Hallazgos clave
    const proms = groupMetrics.filter(g => g.promedio != null);
    const mejorGrupo = proms.length > 0 ? [...proms].sort((a, b) => b.promedio - a.promedio)[0] : null;
    const peorGrupo = proms.length > 0 ? [...proms].sort((a, b) => a.promedio - b.promedio)[0] : null;
    const brecha = (mejorGrupo && peorGrupo) ? +(mejorGrupo.promedio - peorGrupo.promedio).toFixed(2) : null;

    // Materias persistentes (en top 5 de >= 2 grados)
    const materiasContador = {};
    for (const g of porGrado) {
      g.top5Vulnerables.forEach(t => {
        materiasContador[t.materia] = (materiasContador[t.materia] || 0) + 1;
      });
    }
    const materiasPersistentes = Object.entries(materiasContador)
      .filter(([_, n]) => n >= 2)
      .map(([m, n]) => ({ materia: m, presenteEnGrados: n }));

    // Recomendaciones (auto-generadas)
    const recomendaciones = [];
    if (pctReprobGlobal > META_REPROB_MAX) {
      recomendaciones.push({ prioridad: 'CRÍTICA', accion: `Convocatoria urgente al consejo técnico para diseñar plan de remediación: la reprobación (${pctReprobGlobal.toFixed(1)}%) excede la meta institucional del ${META_REPROB_MAX}%.` });
    }
    if (promGlobal < META_PROM) {
      recomendaciones.push({ prioridad: 'ALTA', accion: `Revisar prácticas evaluativas y considerar talleres de estrategias de aprendizaje: el promedio (${promGlobal.toFixed(2)}) está por debajo de la meta (${META_PROM}).` });
    }
    if (peorGrupo && peorGrupo.pctReprobacion > 25) {
      recomendaciones.push({ prioridad: 'ALTA', accion: `Intervención focalizada en grupo ${peorGrupo.grupo} (${peorGrupo.pctReprobacion.toFixed(1)}% reprobación): asignar tutor académico, monitoreo semanal, contacto con padres.` });
    }
    if (peorMatGrupo[0] && peorMatGrupo[0].pctReprobacion > 30) {
      const p = peorMatGrupo[0];
      recomendaciones.push({ prioridad: 'ALTA', accion: `Refuerzo académico en ${p.materia} para ${p.grupo}: sesiones extra-clase, asesorías entre pares, materiales adicionales.` });
    }
    if (enRiesgoAlto.length > 0) {
      recomendaciones.push({ prioridad: 'ALTA', accion: `Reunión con padres de los ${enRiesgoAlto.length} alumnos en riesgo alto (≥4 materias reprobadas) antes del cierre del siguiente parcial.` });
    }
    if (corrFaltasProm != null && corrFaltasProm < -0.4) {
      recomendaciones.push({ prioridad: 'MEDIA', accion: `Programa de asistencia activa: la correlación r=${corrFaltasProm} entre faltas y promedio confirma que mejorar asistencia mejora calificaciones. Implementar incentivos y seguimiento de inasistencias > 15%.` });
    }
    if (materiasPersistentes.length > 0) {
      recomendaciones.push({ prioridad: 'INSTITUCIONAL', accion: `Análisis institucional de materias persistentemente vulnerables: ${materiasPersistentes.map(m => m.materia).slice(0, 3).join(', ')}. Revisar evaluación, metodología o adecuación curricular.` });
    }

    return {
      escuela: 'EPO 67 — Escuela Preparatoria Oficial Número 67',
      turno,
      parcial: partial,
      parcialLabel: partialLabel,
      cicloEscolar,
      fechaGeneracion: new Date().toISOString(),
      metas: {
        promedioMin: META_PROM,
        reprobacionMaxPct: META_REPROB_MAX,
        asistenciaMinPct: 80,
      },
      resumenEjecutivo: {
        totalAlumnos,
        totalGrupos: turnoGroups.length,
        gruposNombres: turnoGroups.map(g => g.nombre),
        promedioGlobal: +promGlobal.toFixed(2),
        aprobados: totalAprobGlobal,
        reprobados: totalReprobGlobal,
        pctAprobacion: +pctAprobGlobal.toFixed(1),
        pctReprobacion: +pctReprobGlobal.toFixed(1),
        totalIncidenciasReprobacion: totalIncidenciasGlobal,
        promedioFaltasPorAlumno: +promFaltasGlobal.toFixed(2),
      },
      cumplimientoMetas: {
        promedio: { meta: META_PROM, valor: +promGlobal.toFixed(2), cumple: promGlobal >= META_PROM },
        reprobacion: { meta: META_REPROB_MAX, valor: +pctReprobGlobal.toFixed(1), cumple: pctReprobGlobal <= META_REPROB_MAX },
      },
      porGrado,
      peoresMateriaGrupo: peorMatGrupo,
      correlaciones: {
        faltasVsPromedioIndividual: {
          r: corrFaltasProm,
          interpretacion: _interpretCorr(corrFaltasProm, 'faltas individuales del alumno', 'su promedio'),
        },
        faltasGrupalesVsAprobacionGrupal: {
          r: corrFaltasAprob,
          interpretacion: _interpretCorr(corrFaltasAprob, 'promedio de faltas del grupo', 'tasa de aprobación del grupo'),
        },
      },
      alumnosEnRiesgo: {
        alto: enRiesgoAlto,
        cantidadMedio: enRiesgoMedio,
      },
      hallazgosClave: {
        mejorGrupo: mejorGrupo ? { grupo: mejorGrupo.grupo, promedio: mejorGrupo.promedio } : null,
        peorGrupo: peorGrupo ? { grupo: peorGrupo.grupo, promedio: peorGrupo.promedio } : null,
        brechaPromedioEntreGrupos: brecha,
        materiasPersistentes,
      },
      recomendaciones,
    };
  }

  function _interpretCorr(r, varX, varY) {
    if (r == null) return 'sin datos suficientes para calcular correlación';
    const abs = Math.abs(r);
    const fuerza = abs >= 0.7 ? 'FUERTE' : abs >= 0.4 ? 'MODERADA' : abs >= 0.2 ? 'DÉBIL' : 'INEXISTENTE';
    const signo = r < 0 ? 'NEGATIVA' : 'POSITIVA';
    let insight = '';
    if (abs >= 0.4 && r < 0) insight = ` A mayor ${varX}, menor ${varY}.`;
    else if (abs >= 0.4 && r > 0) insight = ` A mayor ${varX}, mayor ${varY}.`;
    return `r = ${r} (${fuerza} ${signo}).${insight}`;
  }

  // ─── PDF / HTML imprimible ───
  function _analisisToHTML(a) {
    const css = `
      <style>
        @page { size: A4; margin: 18mm 14mm; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2937; line-height: 1.45; font-size: 11.5px; }
        h1 { font-size: 24px; color: #1e3a8a; margin: 0 0 6px; font-weight: 900; }
        h2 { font-size: 16px; color: #1e3a8a; margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #1e3a8a; font-weight: 800; }
        h3 { font-size: 13px; color: #1f2937; margin: 14px 0 6px; font-weight: 700; }
        .meta { color: #6b7280; font-size: 11px; margin-bottom: 18px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin: 8px 0; }
        .kpi { background: #f8fafc; border-left: 4px solid #1e3a8a; padding: 8px 12px; border-radius: 6px; }
        .kpi .label { font-size: 9px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: 0.5px; }
        .kpi .value { font-size: 22px; font-weight: 900; color: #1f2937; line-height: 1.1; }
        .kpi .sub { font-size: 10px; color: #6b7280; }
        .ok { color: #15803d; font-weight: 700; }
        .bad { color: #b91c1c; font-weight: 700; }
        .warn { color: #b45309; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0; }
        th { background: #1e3a8a; color: #fff; padding: 6px 8px; text-align: left; font-weight: 700; }
        td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) td { background: #f9fafb; }
        .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
        .pill-ok { background: #dcfce7; color: #15803d; }
        .pill-warn { background: #fef3c7; color: #b45309; }
        .pill-bad { background: #fee2e2; color: #b91c1c; }
        .reco { background: #fffbeb; border-left: 4px solid #d97706; padding: 8px 12px; margin: 6px 0; border-radius: 4px; font-size: 11px; }
        .reco strong { color: #b45309; }
        .hero { background: linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%); color: #fff; padding: 18px 22px; border-radius: 10px; margin-bottom: 18px; }
        .hero h1 { color: #fff; }
        .hero .sub { color: rgba(255,255,255,0.85); font-size: 13px; }
      </style>
    `;
    const meta = a.cumplimientoMetas;
    const re = a.resumenEjecutivo;
    const html = [];
    html.push(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Análisis EPO 67 ${a.turno} ${a.parcial}</title>${css}</head><body>`);
    html.push(`<div class="hero">
      <h1>📊 Análisis Detallado — Turno ${a.turno}</h1>
      <div class="sub">${a.parcialLabel} · Ciclo ${a.cicloEscolar} · ${a.escuela}</div>
    </div>`);

    // RESUMEN
    html.push(`<h2>1. Resumen ejecutivo</h2>`);
    html.push(`<div class="grid">
      <div class="kpi"><div class="label">Alumnos</div><div class="value">${re.totalAlumnos}</div><div class="sub">${re.totalGrupos} grupos: ${re.gruposNombres.join(', ')}</div></div>
      <div class="kpi"><div class="label">Promedio global</div><div class="value ${meta.promedio.cumple ? 'ok' : 'bad'}">${re.promedioGlobal}</div><div class="sub">Meta: ≥${meta.promedio.meta} ${meta.promedio.cumple ? '✅ CUMPLE' : '❌ NO CUMPLE'}</div></div>
      <div class="kpi"><div class="label">% Aprobación</div><div class="value">${re.pctAprobacion}%</div><div class="sub">${re.aprobados} alumnos sin materias reprobadas</div></div>
      <div class="kpi"><div class="label">% Reprobación</div><div class="value ${meta.reprobacion.cumple ? 'ok' : 'bad'}">${re.pctReprobacion}%</div><div class="sub">Meta: ≤${meta.reprobacion.meta}% ${meta.reprobacion.cumple ? '✅' : '❌'} · ${re.totalIncidenciasReprobacion} incidencias totales</div></div>
    </div>`);

    // METAS
    html.push(`<h2>2. Cumplimiento de metas institucionales</h2>`);
    html.push(`<table><thead><tr><th>Indicador</th><th>Meta</th><th>Resultado</th><th>Estatus</th></tr></thead><tbody>
      <tr><td>Promedio mínimo</td><td>≥ ${meta.promedio.meta}</td><td><strong>${meta.promedio.valor}</strong></td><td><span class="pill ${meta.promedio.cumple ? 'pill-ok' : 'pill-bad'}">${meta.promedio.cumple ? 'CUMPLE' : 'NO CUMPLE'}</span></td></tr>
      <tr><td>Reprobación máxima</td><td>≤ ${meta.reprobacion.meta}%</td><td><strong>${meta.reprobacion.valor}%</strong></td><td><span class="pill ${meta.reprobacion.cumple ? 'pill-ok' : 'pill-bad'}">${meta.reprobacion.cumple ? 'CUMPLE' : 'EXCEDE'}</span></td></tr>
      <tr><td>Faltas promedio/alumno</td><td>—</td><td><strong>${re.promedioFaltasPorAlumno}</strong></td><td><span class="pill pill-warn">referencia</span></td></tr>
    </tbody></table>`);

    // POR GRADO
    html.push(`<h2>3. Radiografía por grado</h2>`);
    for (const g of a.porGrado) {
      html.push(`<h3>${g.grado}° Grado — Promedio: ${g.promedio || '—'} · ${g.incidencias} incidencias</h3>`);
      html.push(`<table><thead><tr><th>Grupo</th><th>Prom</th><th>Aprob</th><th>Reprob</th><th>% Reprob</th><th>Faltas avg</th><th>Estatus</th></tr></thead><tbody>`);
      for (const gm of g.grupos) {
        const tag = gm.promedio == null ? '—' :
          gm.promedio >= 9 ? '<span class="pill pill-ok">🏆 Excelente</span>' :
          gm.promedio >= 8.3 ? '<span class="pill pill-ok">✅ Supera meta</span>' :
          gm.promedio >= 7 ? '<span class="pill pill-warn">⚠ Bajo meta</span>' :
          '<span class="pill pill-bad">🚨 Foco rojo</span>';
        html.push(`<tr><td><strong>${gm.grupo}</strong></td><td>${gm.promedio || '—'}</td><td>${gm.aprobados}/${gm.totalAlumnos}</td><td>${gm.reprobados}</td><td>${gm.pctReprobacion}%</td><td>${gm.promedioFaltas}</td><td>${tag}</td></tr>`);
      }
      html.push(`</tbody></table>`);
    }

    // TOP 5 POR GRADO
    html.push(`<h2>4. Top 5 materias más vulnerables por grado</h2>`);
    for (const g of a.porGrado) {
      html.push(`<h3>${g.grado}° Grado</h3>`);
      if (g.top5Vulnerables.length === 0) {
        html.push(`<p>Sin datos suficientes.</p>`);
        continue;
      }
      html.push(`<table><thead><tr><th>#</th><th>Materia</th><th>Reprobados</th><th>% Reprob</th><th>Prom</th><th>Nivel</th></tr></thead><tbody>`);
      g.top5Vulnerables.forEach((t, i) => {
        const lvl = t.pctReprobacion > 30 ? '<span class="pill pill-bad">🚨 MÁXIMA</span>' : t.pctReprobacion > 15 ? '<span class="pill pill-warn">⚠ Alerta</span>' : '<span class="pill pill-warn">🟡 Atención</span>';
        html.push(`<tr><td>${i + 1}</td><td>${t.materia}</td><td>${t.reprobados}/${t.totalAlumnos}</td><td>${t.pctReprobacion}%</td><td>${t.promedio || '—'}</td><td>${lvl}</td></tr>`);
      });
      html.push(`</tbody></table>`);
    }

    // TOP 10 PEORES
    html.push(`<h2>5. Top 10 materia×grupo más críticas del turno</h2>`);
    if (a.peoresMateriaGrupo.length > 0) {
      html.push(`<table><thead><tr><th>#</th><th>Grupo</th><th>Materia</th><th>Promedio</th><th>Reprob</th><th>% Reprob</th></tr></thead><tbody>`);
      a.peoresMateriaGrupo.forEach((p, i) => {
        html.push(`<tr><td>${i + 1}</td><td><strong>${p.grupo}</strong></td><td>${p.materia}</td><td>${p.promedio || '—'}</td><td>${p.reprobados}/${p.totalAlumnos}</td><td>${p.pctReprobacion}%</td></tr>`);
      });
      html.push(`</tbody></table>`);
    }

    // CORRELACIONES
    html.push(`<h2>6. Correlaciones (ciencia de datos)</h2>`);
    const c = a.correlaciones;
    html.push(`<div class="grid">
      <div class="kpi"><div class="label">Faltas vs Promedio (alumno)</div><div class="value">${c.faltasVsPromedioIndividual.r ?? '—'}</div><div class="sub">${c.faltasVsPromedioIndividual.interpretacion}</div></div>
      <div class="kpi"><div class="label">Faltas vs Aprobación (grupo)</div><div class="value">${c.faltasGrupalesVsAprobacionGrupal.r ?? '—'}</div><div class="sub">${c.faltasGrupalesVsAprobacionGrupal.interpretacion}</div></div>
    </div>`);

    // ALUMNOS RIESGO
    html.push(`<h2>7. Alumnos en riesgo</h2>`);
    html.push(`<p><strong>Riesgo ALTO</strong> (≥4 materias reprobadas — posible extraordinario múltiple): <strong>${a.alumnosEnRiesgo.alto.length} alumnos</strong></p>`);
    if (a.alumnosEnRiesgo.alto.length > 0) {
      html.push(`<table><thead><tr><th>#</th><th>Grupo</th><th>Alumno</th><th>Mat. Reprob.</th><th>Prom</th><th>Faltas</th></tr></thead><tbody>`);
      a.alumnosEnRiesgo.alto.slice(0, 15).forEach((al, i) => {
        html.push(`<tr><td>${i + 1}</td><td>${al.grupo}</td><td>${al.nombre}</td><td><strong>${al.materiasReprobadas}</strong></td><td>${al.promedio || '—'}</td><td>${al.faltas}</td></tr>`);
      });
      if (a.alumnosEnRiesgo.alto.length > 15) html.push(`<tr><td colspan="6"><em>… y ${a.alumnosEnRiesgo.alto.length - 15} más</em></td></tr>`);
      html.push(`</tbody></table>`);
    }
    html.push(`<p><strong>Riesgo MEDIO</strong> (1-3 materias reprobadas): <strong>${a.alumnosEnRiesgo.cantidadMedio} alumnos</strong></p>`);

    // HALLAZGOS
    html.push(`<h2>8. Hallazgos clave</h2>`);
    const h = a.hallazgosClave;
    if (h.mejorGrupo && h.peorGrupo) {
      html.push(`<div class="reco"><strong>📊 Brecha entre grupos:</strong> Mejor (${h.mejorGrupo.grupo}: ${h.mejorGrupo.promedio}) vs Peor (${h.peorGrupo.grupo}: ${h.peorGrupo.promedio}) = ${h.brechaPromedioEntreGrupos} pts. ${h.brechaPromedioEntreGrupos >= 2 ? '<strong class="bad">POLARIZACIÓN ALTA</strong> — requiere intervención focalizada.' : h.brechaPromedioEntreGrupos >= 1 ? '<strong class="warn">Brecha moderada.</strong>' : 'Homogeneidad razonable.'}</div>`);
    }
    if (a.peoresMateriaGrupo[0]) {
      const p = a.peoresMateriaGrupo[0];
      html.push(`<div class="reco"><strong>🎯 Materia más crítica del turno:</strong> ${p.grupo} · ${p.materia} (prom ${p.promedio}). Considerar refuerzo focalizado.</div>`);
    }
    if (h.materiasPersistentes.length > 0) {
      html.push(`<div class="reco"><strong>🏫 Materias persistentemente vulnerables</strong> (en TOP 5 de ≥2 grados): ${h.materiasPersistentes.map(m => `${m.materia} (${m.presenteEnGrados} grados)`).join(', ')}. Señal de desalineación pedagógica institucional.</div>`);
    }

    // RECOMENDACIONES
    html.push(`<h2>9. Recomendaciones basadas en datos</h2>`);
    if (a.recomendaciones.length === 0) {
      html.push(`<p>No hay recomendaciones críticas — el turno cumple las metas institucionales.</p>`);
    } else {
      a.recomendaciones.forEach(r => {
        const pillClass = r.prioridad === 'CRÍTICA' ? 'pill-bad' : r.prioridad === 'ALTA' ? 'pill-warn' : 'pill-ok';
        html.push(`<div class="reco"><span class="pill ${pillClass}">${r.prioridad}</span> ${r.accion}</div>`);
      });
    }

    html.push(`<div style="margin-top:30px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;">EPO 67 · Sistema Escolar · Generado: ${new Date(a.fechaGeneracion).toLocaleString('es-MX')}</div>`);

    // Auto-print
    html.push(`<script>setTimeout(() => window.print(), 400);</script>`);
    html.push(`</body></html>`);
    return html.join('\n');
  }

  // ─── JSON estructurado + prompt para IA ───
  function _analisisToJSON(a) {
    const promptIA = `Eres un diseñador de presentaciones institucionales. Toma este análisis estadístico (campo "datos" más abajo) de la Escuela Preparatoria Oficial Número 67 (EPO 67), turno ${a.turno}, ${a.parcialLabel}, y genera una presentación de 10-12 slides, profesional, con:

- Carátula con metas institucionales (Promedio ≥${a.metas.promedioMin} / Reprobación ≤${a.metas.reprobacionMaxPct}% / Asistencia ≥${a.metas.asistenciaMinPct}%)
- Slide de resumen ejecutivo (los KPIs principales con colores: verde si cumple meta, rojo si no)
- Radiografía por grado (1°, 2°, 3°): promedios por grupo, focos rojos, observaciones cualitativas
- Top 5 materias más vulnerables por grado
- Top 10 combinaciones materia×grupo críticas (incluye datos para gráfica de barras)
- Análisis de correlaciones de "ciencia de datos" (faltas vs promedio, etc.) con interpretación
- Alumnos en riesgo (cuántos y por qué)
- Hallazgos clave (brechas, polarización, materias persistentes)
- Recomendaciones priorizadas (CRÍTICA/ALTA/MEDIA/INSTITUCIONAL)
- Slide final con call-to-action / próximos pasos

Usa íconos coherentes (🚨 alerta, ✅ logro, 📈 dato, 🎯 acción), colores temáticos (verde aciertos, rojo alertas, naranja atención), tono institucional pero claro, letras grandes legibles, y al menos 2-3 gráficas (barras para grupos, dona para aprobación/reprobación, líneas si aplica). La escuela es la EPO 67.

Cuando esté lista, dame la presentación en el formato que pueda descargar directamente (PPTX preferentemente).`;

    return JSON.stringify({
      meta: {
        version: '1.0',
        formato: 'EPO67 Análisis de Indicadores',
        generadoPor: 'Sistema Escolar EPO 67',
        generadoEn: a.fechaGeneracion,
        comoUsar: 'Copia el campo "promptParaIA" + el campo "datos" y pégalo en ChatGPT, Claude o Gemini. La IA generará tu presentación.',
      },
      promptParaIA: promptIA,
      datos: a,
    }, null, 2);
  }

  // ─── PRESENTACIÓN — slideshow profesional con auto-scale 1920×1080 ───
  // Diseño optimizado para proyector débil + audiencia a 5 metros.
  // Cada slide vive en un canvas de 1920×1080 y se escala automáticamente al viewport
  // → las fuentes nunca cambian de tamaño relativo, todo es legible siempre.
  function _analisisToPresentation(a) {
    const meta = a.cumplimientoMetas;
    const re = a.resumenEjecutivo;
    const h = a.hallazgosClave;
    const c = a.correlaciones;

    const dot = (level) => {
      const map = { 'crit': '#e63946', 'med': '#f59e3a', 'bajo': '#f5c842', 'ok': '#4eb869' };
      return `<span class="dot" style="background:${map[level] || '#94a3b8'};"></span>`;
    };
    const ord = (n) => ({ 1: '1er', 2: '2do', 3: '3er' }[n] || `${n}°`);

    const slides = [];

    // ═══ SLIDE 1: Portada (single column profesional, sin decoraciones IA) ═══
    slides.push(`<section class="slide cover-clean">
      <div class="cover-header">
        <div class="cover-brand">EPO 67 · ESCUELA PREPARATORIA OFICIAL Nº 67</div>
        <span class="pill">TURNO ${a.turno} · ${a.parcialLabel}</span>
      </div>
      <h1 class="title-big">Tablero de Control<br>y <span class="accent">Metas Institucionales</span></h1>
      <p class="lead">Diagnóstico estadístico del turno ${a.turno.toLowerCase()}: del comportamiento individual por grupo hacia la radiografía institucional completa. Ciclo escolar ${a.cicloEscolar}.</p>
      <div class="kpi-row">
        <div class="kpi-pill ${meta.promedio.cumple ? 'ok' : 'bad'}">
          <div class="kpi-label">APROVECHAMIENTO</div>
          <div class="kpi-val">${meta.promedio.valor}</div>
          <div class="kpi-foot">Promedio · meta ≥ ${meta.promedio.meta}</div>
        </div>
        <div class="kpi-pill ${meta.reprobacion.cumple ? 'ok' : 'bad'}">
          <div class="kpi-label">EFICIENCIA TERMINAL</div>
          <div class="kpi-val">${meta.reprobacion.valor}%</div>
          <div class="kpi-foot">Reprobación · meta ≤ ${meta.reprobacion.meta}%</div>
        </div>
        <div class="kpi-pill neutral">
          <div class="kpi-label">PERMANENCIA</div>
          <div class="kpi-val">80%</div>
          <div class="kpi-foot">Asistencia mínima requerida</div>
        </div>
      </div>
    </section>`);

    // ═══ SLIDE 2: Resumen ejecutivo ═══
    slides.push(`<section class="slide">
      <span class="pill">RESUMEN EJECUTIVO</span>
      <h1 class="title-big">Panorama del Turno <span class="accent">${a.turno}</span></h1>
      <p class="lead">Visión consolidada del rendimiento académico: <strong>${re.totalAlumnos} alumnos</strong> evaluados en <strong>${re.totalGrupos} grupos</strong> del turno ${a.turno.toLowerCase()}.</p>
      <div class="stat-grid-6">
        <div class="stat-card"><div class="stat-num">${re.totalAlumnos}</div><div class="stat-label">Alumnos evaluados</div></div>
        <div class="stat-card"><div class="stat-num">${re.totalGrupos}</div><div class="stat-label">Grupos del turno</div></div>
        <div class="stat-card ok"><div class="stat-num">${re.aprobados}</div><div class="stat-label">Aprobados · ${re.pctAprobacion}%</div></div>
        <div class="stat-card bad"><div class="stat-num">${re.reprobados}</div><div class="stat-label">Reprobados · ${re.pctReprobacion}%</div></div>
        <div class="stat-card warn"><div class="stat-num">${re.totalIncidenciasReprobacion}</div><div class="stat-label">Incidencias totales</div></div>
        <div class="stat-card ${meta.promedio.cumple ? 'ok' : 'bad'}"><div class="stat-num">${re.promedioGlobal}</div><div class="stat-label">Promedio global</div></div>
      </div>
    </section>`);

    // ═══ SLIDES: Radiografía por grado ═══
    for (const g of a.porGrado) {
      const grupos = [...g.grupos].sort((x, y) => (y.promedio ?? 0) - (x.promedio ?? 0));
      const cards = grupos.map(gm => {
        const emoji = gm.promedio == null ? '🔘'
          : gm.promedio >= 9 ? '🏆'
          : gm.promedio >= 8.3 ? '✅'
          : gm.promedio >= 7 ? '⚠️'
          : '🚨';
        let nota = '';
        if (gm.promedio == null) nota = 'Sin datos suficientes para evaluar este grupo.';
        else if (gm.promedio >= 9) nota = `Mejor grupo del ${ord(g.grado).toLowerCase()} grado. Roza el ${gm.pctAprobacion}% de aprobación.`;
        else if (gm.promedio >= 8.3) nota = `Supera la meta institucional. Reprobación de ${gm.pctReprobacion}% y buena asistencia.`;
        else if (gm.promedio >= 7) nota = `Roza el límite del aprovechamiento. ${gm.reprobados} alumnos con materias reprobadas.`;
        else nota = `<strong>FOCO ROJO:</strong> no cumple metas. ${gm.incidenciasReprobacion} incidencias de reprobación.`;
        return `<div class="grupo-card${gm.promedio != null && gm.promedio < 7 ? ' bad' : ''}">
          <div class="grupo-head">${emoji} <strong>Grupo ${gm.grupo}</strong></div>
          <div class="grupo-prom">Promedio: <strong>${gm.promedio ?? '—'}</strong></div>
          <div class="grupo-body">${nota}</div>
        </div>`;
      }).join('');
      const lead = g.grado === 1 ? 'Heterogeneidad propia del ingreso: conviven grupos de excelencia y de adaptación.'
                : g.grado === 2 ? 'Año bisagra del bachillerato — donde se concentran los principales retos académicos.'
                : 'Consolidación académica: madurez evidente de los grupos próximos a egresar.';
      const cols = Math.min(Math.max(grupos.length, 2), 4);
      slides.push(`<section class="slide">
        <span class="pill">${ord(g.grado).toUpperCase()} GRADO</span>
        <h1 class="title-big">Radiografía Clínica: <span class="accent">${ord(g.grado)} Grado</span></h1>
        <p class="lead">${lead}</p>
        <div class="grupo-grid cols-${cols}">${cards}</div>
      </section>`);
    }

    // ═══ SLIDES: Top 5 vulnerables por grado ═══
    for (const g of a.porGrado) {
      if (g.top5Vulnerables.length === 0) continue;
      const cards = g.top5Vulnerables.map(t => {
        const sev = t.pctReprobacion >= 30 ? 'crit' : t.pctReprobacion >= 15 ? 'med' : 'bajo';
        const promTxt = t.promedio == null ? '—' : Number(t.promedio).toFixed(2);
        const alerta = t.pctReprobacion >= 30 ? '<div class="mini-tag bad">MÁXIMA ALERTA</div>' : '';
        return `<div class="mat-card">
          <div class="mat-head">${dot(sev)}<strong>${t.materia}</strong></div>
          <div class="mat-body"><strong>${t.reprobados} reprobados</strong></div>
          <div class="mat-body small">Prom: ${promTxt} · ${t.pctReprobacion}% reprobación</div>
          ${alerta}
        </div>`;
      }).join('');
      slides.push(`<section class="slide">
        <span class="pill">${ord(g.grado).toUpperCase()} GRADO · FOCOS ROJOS</span>
        <h1 class="title-big">Top 5 Materias Vulnerables — <span class="accent">${ord(g.grado)} Grado</span></h1>
        <p class="lead">Materias con la mayor cantidad de alumnos reprobados en ${ord(g.grado).toLowerCase()} grado.</p>
        <div class="mat-grid">${cards}</div>
      </section>`);
    }

    // ═══ SLIDE: Evolución por grado ═══
    if (a.porGrado.length > 0) {
      const incidencias = a.porGrado.map(g => g.incidencias);
      const maxInc = Math.max(...incidencias, 1);
      const headers = a.porGrado.map(g => `<div class="evo-step">
        <div class="evo-num">${ord(g.grado)} Grado</div>
        <div class="evo-text"><strong>${g.grado === 1 ? 'Polarización' : g.grado === 2 ? 'Filtro Académico' : 'Consolidación'}</strong> — ${g.incidencias} incidencias totales</div>
      </div>`).join('');
      const colors = ['#7a1d12', '#c83a17', '#f47235'];
      const bars = a.porGrado.map((g, i) => {
        const pct = (g.incidencias / maxInc) * 100;
        return `<div class="bar-col">
          <div class="bar-rect" style="height:${pct}%;background:${colors[g.grado - 1] || colors[i]};">
            <div class="bar-val">${g.incidencias}</div>
          </div>
          <div class="bar-label">${ord(g.grado)} Grado</div>
        </div>`;
      }).join('');
      slides.push(`<section class="slide">
        <span class="pill">ANÁLISIS COMPARATIVO</span>
        <h1 class="title-big">Evolución por <span class="accent">Grado Académico</span></h1>
        <p class="lead">Comparativa de incidencias de reprobación entre grados — patrón típico de tres etapas.</p>
        <div class="evo-steps">${headers}</div>
        <div class="bar-chart">
          <div class="bar-y-axis">
            <div>${maxInc}</div>
            <div>${Math.round(maxInc * 0.75)}</div>
            <div>${Math.round(maxInc * 0.5)}</div>
            <div>${Math.round(maxInc * 0.25)}</div>
            <div>0</div>
          </div>
          <div class="bar-area">${bars}</div>
          <div class="bar-title">Incidencias de Reprobación</div>
        </div>
      </section>`);
    }

    // ═══ SLIDE: Top general por promedios más bajos ═══
    if (a.peoresMateriaGrupo.length > 0) {
      const top5 = a.peoresMateriaGrupo.slice(0, 5);
      const cards = top5.map(p => {
        const sev = p.promedio < 6 ? 'crit' : p.promedio < 7 ? 'med' : 'bajo';
        const nota = p.promedio < 6 ? 'La calificación más baja del turno.' : p.promedio < 7 ? 'Refuerzo académico urgente.' : 'Atención focalizada recomendada.';
        return `<div class="mat-card">
          <div class="mat-head">${dot(sev)}<strong>Grupo ${p.grupo}</strong></div>
          <div class="mat-sub">${p.materia}</div>
          <div class="mat-body"><strong>Promedio: ${p.promedio}</strong></div>
          <div class="mat-body small">${nota}</div>
        </div>`;
      }).join('');
      slides.push(`<section class="slide">
        <span class="pill">ANÁLISIS GENERAL</span>
        <h1 class="title-big">Top 5 General de Vulnerabilidad por <span class="accent">Promedios más Bajos</span></h1>
        <p class="lead">Materias donde el rendimiento académico es más crítico en términos de calificación promedio en todo el turno.</p>
        <div class="mat-grid">${cards}</div>
      </section>`);
    }

    // ═══ SLIDE: Top general por reprobados ═══
    if (a.peoresMateriaGrupo.length > 0) {
      const topRep = [...a.peoresMateriaGrupo].sort((x, y) => y.reprobados - x.reprobados).slice(0, 5);
      const cards = topRep.map(p => {
        const sev = p.pctReprobacion >= 30 ? 'crit' : p.pctReprobacion >= 15 ? 'med' : 'bajo';
        const pctAprob = (100 - p.pctReprobacion).toFixed(1);
        const alerta = p.pctReprobacion >= 50 ? '<div class="mini-tag bad">MÁXIMA ALERTA</div>' : '';
        return `<div class="mat-card">
          <div class="mat-head">${dot(sev)}<strong>Grupo ${p.grupo}</strong></div>
          <div class="mat-sub">${p.materia}</div>
          <div class="mat-body"><strong>${p.reprobados} reprobados</strong></div>
          <div class="mat-body small">Solo ${pctAprob}% aprobó</div>
          ${alerta}
        </div>`;
      }).join('');
      slides.push(`<section class="slide">
        <span class="pill">ANÁLISIS GENERAL</span>
        <h1 class="title-big">Top 5 General por <span class="accent">Alumnos Reprobados</span></h1>
        <p class="lead">Materias con la mayor cantidad de incidencias negativas (alumnos que no acreditaron) en todo el turno ${a.turno.toLowerCase()}.</p>
        <div class="mat-grid">${cards}</div>
      </section>`);
    }

    // ═══ SLIDE: Patrones persistentes (split) ═══
    const observations = [];
    if (h.materiasPersistentes.length > 0) {
      observations.push({
        icon: '🚦',
        title: 'El Cuello de Botella: ' + h.materiasPersistentes[0].materia,
        text: `Castiga promedios en múltiples semestres. Aparece en TOP 5 de <strong>${h.materiasPersistentes[0].presenteEnGrados} grados</strong>.`,
      });
    }
    if (h.materiasPersistentes.length > 1) {
      observations.push({
        icon: '📣',
        title: `La Constante: ${h.materiasPersistentes[1].materia}`,
        text: `Aparece en TOP 5 de <strong>${h.materiasPersistentes[1].presenteEnGrados} grados</strong>. Señal de desalineación pedagógica institucional.`,
      });
    }
    if (c.faltasVsPromedioIndividual.r != null) {
      observations.push({
        icon: '📉',
        title: 'Correlación Asistencia ↔ Aprobación',
        text: c.faltasVsPromedioIndividual.interpretacion + (Math.abs(c.faltasVsPromedioIndividual.r) >= 0.4 ? ' <strong>Si no asiste, reprobar está estadísticamente cantado.</strong>' : ''),
      });
    }
    if (h.mejorGrupo && h.peorGrupo) {
      observations.push({
        icon: '⚖️',
        title: 'Brecha entre grupos',
        text: `Mejor: <strong>${h.mejorGrupo.grupo}</strong> (${h.mejorGrupo.promedio}) · Peor: <strong>${h.peorGrupo.grupo}</strong> (${h.peorGrupo.promedio}) = <strong>${h.brechaPromedioEntreGrupos} pts</strong>.${h.brechaPromedioEntreGrupos >= 2 ? ' Polarización alta.' : ''}`,
      });
    }

    if (observations.length > 0) {
      slides.push(`<section class="slide">
        <span class="pill">CIENCIA DE DATOS</span>
        <h1 class="title-big">Patrones Persistentes del Turno <span class="accent">${a.turno}</span></h1>
        <p class="lead">Hallazgos estadísticos relevantes detectados al cruzar los datos del parcial.</p>
        <div class="observ-grid">
          ${observations.slice(0, 4).map(o => `<div class="observ">
            <div class="observ-title">${o.icon} <strong>${o.title}</strong></div>
            <div class="observ-text">${o.text}</div>
          </div>`).join('')}
        </div>
      </section>`);
    }

    // ═══ SLIDES: Alumnos en riesgo (DIVIDIDA EN 2 — números + tabla) ═══
    if (a.alumnosEnRiesgo.alto.length > 0 || a.alumnosEnRiesgo.cantidadMedio > 0) {
      // Slide A: panorama numérico
      slides.push(`<section class="slide">
        <span class="pill">PRIORIDAD URGENTE</span>
        <h1 class="title-big">Alumnos en <span class="accent">Riesgo Académico</span></h1>
        <p class="lead">Casos que requieren intervención inmediata previo al cierre del siguiente parcial. Dos niveles de severidad detectados.</p>
        <div class="risk-row">
          <div class="risk-block bad">
            <div class="risk-num">${a.alumnosEnRiesgo.alto.length}</div>
            <div class="risk-label">RIESGO ALTO</div>
            <div class="risk-sub">≥ 4 materias reprobadas · extraordinario múltiple probable</div>
          </div>
          <div class="risk-block warn">
            <div class="risk-num">${a.alumnosEnRiesgo.cantidadMedio}</div>
            <div class="risk-label">RIESGO MEDIO</div>
            <div class="risk-sub">1 a 3 materias reprobadas · intervención preventiva</div>
          </div>
        </div>
      </section>`);

      // Slide B: tabla de casos prioritarios (separada para que no se corte)
      const top = a.alumnosEnRiesgo.alto.slice(0, 8);
      if (top.length > 0) {
        slides.push(`<section class="slide">
          <span class="pill">CASOS PRIORITARIOS · RIESGO ALTO</span>
          <h1 class="title-big">Top ${top.length} <span class="accent">Casos Críticos</span></h1>
          <p class="lead">Alumnos con mayor número de materias reprobadas. Citar a padres antes del cierre.</p>
          <div class="risk-table-wrap">
            <table class="risk-table">
              <thead><tr><th>Grupo</th><th>Alumno</th><th>Reprob.</th><th>Prom.</th></tr></thead>
              <tbody>${top.map(al => `<tr>
                <td><strong>${al.grupo}</strong></td>
                <td>${al.nombre}</td>
                <td class="cell-bad"><strong>${al.materiasReprobadas}</strong></td>
                <td>${al.promedio ?? '—'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </section>`);
      }
    }

    // ═══ SLIDE: Conclusiones y líneas de acción ═══
    if (a.recomendaciones.length > 0) {
      const recoCards = a.recomendaciones.slice(0, 4).map(r => {
        const titulo = r.prioridad === 'CRÍTICA' ? 'Intervención Inmediata'
                     : r.prioridad === 'ALTA' ? 'Acción Prioritaria'
                     : r.prioridad === 'MEDIA' ? 'Seguimiento Activo'
                     : 'Revisión Institucional';
        return `<div class="action-card ${r.prioridad === 'CRÍTICA' ? 'crit' : r.prioridad === 'ALTA' ? 'alta' : ''}">
          <div class="action-title">${titulo}</div>
          <div class="action-text">${r.accion}</div>
        </div>`;
      }).join('');
      slides.push(`<section class="slide">
        <span class="pill">PLAN INSTITUCIONAL</span>
        <h1 class="title-big">Conclusiones y <span class="accent">Líneas de Acción</span></h1>
        <p class="lead">Plan de trabajo basado en evidencia para el siguiente parcial.</p>
        <div class="actions-grid">${recoCards}</div>
      </section>`);
    }

    // ═══════════════════════════════════════════
    // CSS — Sistema 1920×1080 con auto-scale al viewport.
    // Fuentes en píxeles absolutos del slide → SIEMPRE proporcionales.
    // ═══════════════════════════════════════════
    const css = `
      @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap');
      *,*::before,*::after{box-sizing:border-box;
        /* FORZAR colores y fondos en impresión (Chrome por defecto los omite) */
        -webkit-print-color-adjust:exact !important;
        print-color-adjust:exact !important;
        color-adjust:exact !important;
      }
      html,body{margin:0;padding:0;height:100%;background:#2d2624;font-family:'Outfit',-apple-system,sans-serif;color:#2d2624;overflow:hidden;}

      .deck{position:relative;width:100vw;height:100vh;overflow:hidden;}
      .slide{
        position:absolute;top:50%;left:50%;
        width:1920px;height:1080px;
        /* --scale = ajuste al viewport · --fit = ajuste por overflow */
        transform:translate(-50%,-50%) scale(calc(var(--scale,1) * var(--fit,1)));
        transform-origin:center center;
        display:none;flex-direction:column;justify-content:center;
        background:#fefbf7;padding:70px 110px;overflow:hidden;
        animation:fadeIn .55s cubic-bezier(.2,.7,.3,1);
      }
      .slide.active{display:flex;}
      .slide.measuring{display:flex !important;visibility:hidden !important;}
      @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}

      /* PILLS / ETIQUETAS — visibles desde lejos */
      .pill{display:inline-block;background:#fde2cf;color:#a14a2c;padding:18px 38px;border-radius:14px;font-size:32px;font-weight:800;letter-spacing:2.2px;margin-bottom:28px;align-self:flex-start;}
      .pill-sub{display:inline-block;background:#f5e3d3;color:#7a5b48;padding:16px 32px;border-radius:14px;font-size:30px;font-weight:700;letter-spacing:1.4px;margin-top:14px;margin-bottom:30px;align-self:flex-start;}

      /* TÍTULOS — proporcionados a 1920×1080 */
      .title-big{font-weight:900;font-size:88px;line-height:1.05;color:#2d2624;margin:0 0 22px;letter-spacing:-2px;}
      .title-med{font-weight:800;font-size:72px;line-height:1.1;color:#2d2624;margin:0 0 22px;letter-spacing:-1.5px;}
      .accent{color:#e8825b;font-weight:900;}

      /* TEXTO EXPLICATIVO — grande para leer desde 5m en proyector débil */
      .lead{font-size:52px;line-height:1.32;color:#5a4d46;max-width:1620px;margin:0 0 40px;font-weight:500;}

      /* DOT INDICADORES */
      .dot{display:inline-block;width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:14px;flex-shrink:0;}

      /* PORTADA — single column profesional, sin gráficos IA */
      .cover-clean{padding:70px 110px;justify-content:center;}
      .cover-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;flex-wrap:wrap;gap:16px;}
      .cover-brand{font-size:26px;font-weight:700;letter-spacing:2px;color:#7a5b48;text-transform:uppercase;}
      .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:36px;}
      .kpi-pill{background:#fff;border:2px solid #f3ddc7;border-left:10px solid #f0976a;padding:30px 34px;border-radius:16px;box-shadow:0 6px 18px rgba(214,135,90,0.1);display:flex;flex-direction:column;gap:8px;}
      .kpi-pill.ok{border-left-color:#4eb869;}
      .kpi-pill.bad{border-left-color:#e63946;}
      .kpi-pill.neutral{border-left-color:#f59e3a;}
      .kpi-label{font-size:26px;font-weight:800;letter-spacing:1.5px;color:#a14a2c;}
      .kpi-val{font-size:84px;font-weight:900;line-height:1;color:#2d2624;margin:6px 0;}
      .kpi-foot{font-size:26px;color:#7a5b48;font-weight:600;line-height:1.25;}

      /* 6 STAT KPIs — apretado para que quepa el grid 3×2 */
      .stat-grid-6{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
      .stat-card{background:#fff;border:2px solid #f3ddc7;border-left:8px solid #f0976a;padding:28px 32px;border-radius:16px;box-shadow:0 4px 14px rgba(214,135,90,0.1);}
      .stat-card.ok{border-left-color:#4eb869;}
      .stat-card.bad{border-left-color:#e63946;}
      .stat-card.warn{border-left-color:#f59e3a;}
      .stat-num{font-size:92px;font-weight:900;line-height:1;color:#2d2624;}
      .stat-label{font-size:28px;color:#7a5b48;margin-top:12px;font-weight:600;line-height:1.25;}

      /* GRUPO CARDS */
      .grupo-grid{display:grid;gap:24px;}
      .grupo-grid.cols-2{grid-template-columns:1fr 1fr;}
      .grupo-grid.cols-3{grid-template-columns:repeat(3,1fr);}
      .grupo-grid.cols-4{grid-template-columns:repeat(4,1fr);}
      .grupo-card{background:#fde2cf;padding:32px 38px;border-radius:18px;border-left:10px solid #f0976a;display:flex;flex-direction:column;gap:14px;}
      .grupo-card.bad{border-left-color:#e63946;background:#fbd6d0;}
      .grupo-head{font-size:48px;font-weight:800;color:#2d2624;}
      .grupo-prom{font-size:36px;color:#2d2624;font-weight:600;}
      .grupo-body{font-size:32px;color:#5a4d46;line-height:1.35;font-weight:500;}

      /* MATERIA CARDS — 5 cols con texto bien legible */
      .mat-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:18px;}
      .mat-card{background:#fff;border:2px solid #f3ddc7;border-left:8px solid #f0976a;padding:26px 28px;border-radius:16px;display:flex;flex-direction:column;gap:10px;}
      .mat-head{font-size:32px;font-weight:800;color:#2d2624;line-height:1.2;display:flex;align-items:flex-start;}
      .mat-sub{font-size:27px;color:#5a4d46;font-weight:600;line-height:1.3;}
      .mat-body{font-size:30px;color:#2d2624;line-height:1.3;font-weight:500;}
      .mat-body.small{font-size:26px;color:#7a5b48;}
      .mini-tag{display:inline-block;padding:10px 18px;border-radius:10px;font-size:20px;font-weight:800;letter-spacing:1.5px;margin-top:8px;align-self:flex-start;}
      .mini-tag.bad{background:#fac9bd;color:#a02510;}
      .mini-tag.inline{margin-top:0;display:inline;margin-left:10px;}

      /* EVOLUCIÓN */
      .evo-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 28px;}
      .evo-step{background:#fde2cf;padding:24px 38px 24px 42px;clip-path:polygon(0 0, calc(100% - 30px) 0, 100% 50%, calc(100% - 30px) 100%, 0 100%, 20px 50%);}
      .evo-step:first-child{clip-path:polygon(0 0, calc(100% - 30px) 0, 100% 50%, calc(100% - 30px) 100%, 0 100%);}
      .evo-num{font-size:36px;font-weight:800;color:#2d2624;}
      .evo-text{font-size:26px;color:#5a4d46;margin-top:8px;line-height:1.35;font-weight:500;}
      .bar-chart{position:relative;background:#fff;border:3px dashed #e2c3a8;border-radius:18px;padding:48px 48px 96px 144px;height:500px;}
      .bar-title{position:absolute;top:24px;right:36px;font-size:28px;color:#7a5b48;font-weight:700;}
      .bar-y-axis{position:absolute;left:36px;top:50px;bottom:114px;display:flex;flex-direction:column;justify-content:space-between;font-size:30px;color:#9c8478;font-weight:700;}
      .bar-area{display:flex;align-items:flex-end;justify-content:space-around;height:100%;gap:30px;padding-bottom:42px;}
      .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;position:relative;}
      .bar-rect{width:78%;max-width:280px;border-radius:18px 18px 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:16px;min-height:60px;border:2px solid rgba(0,0,0,0.06);box-shadow:0 -4px 12px rgba(0,0,0,0.08);}
      /* Sin animaciones — las barras se renderizan al 100% siempre.
         Esto garantiza que se vean tanto en pantalla como en el PDF. */
      .bar-val{color:#fff;font-weight:800;font-size:40px;background:rgba(45,38,36,0.45);padding:12px 24px;border-radius:14px;text-shadow:0 1px 3px rgba(0,0,0,0.4);}
      .bar-label{position:absolute;bottom:-52px;font-size:32px;color:#5a4d46;font-weight:700;}

      /* OBSERVACIONES (Patrones persistentes) — grid 2×2 con texto grande */
      .observ-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-top:10px;}
      .observ{background:#fff;border:2px solid #f3ddc7;border-left:10px solid #f0976a;padding:32px 38px;border-radius:16px;box-shadow:0 4px 10px rgba(214,135,90,0.08);}
      .observ-title{font-size:38px;color:#2d2624;margin-bottom:14px;font-weight:800;line-height:1.2;}
      .observ-text{font-size:32px;color:#5a4d46;line-height:1.4;font-weight:500;}

      /* ACCIONES (Conclusiones) — grid 2×2 con texto grande */
      .actions-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-top:10px;}
      .action-card{background:#fde2cf;border:2px solid #f5cfb0;border-left:10px solid #f0976a;padding:32px 38px;border-radius:16px;}
      .action-card.crit{border-left-color:#e63946;background:#fbd6d0;border-color:#f6c0b9;}
      .action-card.alta{border-left-color:#f59e3a;background:#fde5cd;border-color:#f5d2a8;}
      .action-title{font-size:38px;font-weight:800;color:#2d2624;margin-bottom:12px;line-height:1.2;}
      .action-text{font-size:32px;color:#5a4d46;line-height:1.4;font-weight:500;}

      /* ALUMNOS RIESGO — slide A (números grandes, solo 2 bloques) */
      .risk-row{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:0;}
      .risk-block{background:#fff;border:2px solid #f3ddc7;border-left:12px solid #e63946;padding:60px 64px;border-radius:22px;}
      .risk-block.warn{border-left-color:#f59e3a;}
      .risk-num{font-size:180px;font-weight:900;line-height:1;color:#2d2624;}
      .risk-label{font-size:40px;font-weight:800;letter-spacing:1.8px;color:#a14a2c;margin:20px 0 14px;}
      .risk-sub{font-size:28px;color:#7a5b48;font-weight:500;line-height:1.4;}
      /* ALUMNOS RIESGO — slide B (tabla con texto grande) */
      .risk-table-wrap{background:#fff;border:2px solid #f3ddc7;border-radius:18px;padding:20px 40px;}
      .risk-table{width:100%;border-collapse:collapse;font-size:34px;}
      .risk-table th{text-align:left;padding:24px 26px;color:#7a5b48;font-weight:800;font-size:26px;letter-spacing:1.4px;text-transform:uppercase;border-bottom:3px solid #f3ddc7;}
      .risk-table td{padding:22px 26px;border-bottom:2px solid #faecdf;color:#5a4d46;font-weight:500;}
      .risk-table tr:last-child td{border-bottom:none;}
      .cell-bad{color:#e63946;font-weight:800;}

      /* NAVEGACIÓN (fija en viewport, NO escalada) */
      .nav-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;background:rgba(45,38,36,0.92);padding:14px 26px;border-radius:42px;backdrop-filter:blur(8px);z-index:50;box-shadow:0 10px 26px rgba(45,38,36,0.22);}
      .nav-btn{background:transparent;border:none;color:#fff;padding:12px 22px;cursor:pointer;font-weight:700;font-size:22px;border-radius:28px;transition:background .2s;font-family:'Outfit',sans-serif;}
      .nav-btn:hover{background:rgba(255,255,255,0.15);}
      .nav-counter{color:#fde2cf;font-size:20px;font-weight:700;padding:0 12px;}
      .progress{position:fixed;top:0;left:0;right:0;height:6px;background:rgba(232,130,91,0.1);z-index:50;}
      .progress-fill{height:100%;background:linear-gradient(90deg,#f0976a,#e8825b);transition:width .4s ease;}
      .hint{position:fixed;top:18px;right:24px;font-size:14px;color:#fde2cf;letter-spacing:1px;z-index:40;font-weight:700;background:rgba(45,38,36,0.6);padding:8px 16px;border-radius:8px;font-family:'Outfit',sans-serif;}

      /* BOTÓN GIGANTE DESCARGAR PDF — visible siempre */
      .pdf-btn{position:fixed;top:20px;left:20px;display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#e8825b 0%,#d4724b 100%);color:#fff;border:none;padding:18px 30px;border-radius:50px;font-size:20px;font-weight:800;cursor:pointer;box-shadow:0 8px 22px rgba(232,130,91,0.45);font-family:'Outfit',sans-serif;z-index:60;letter-spacing:0.5px;transition:transform .2s,box-shadow .2s;}
      .pdf-btn:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(232,130,91,0.55);}
      .pdf-btn .pdf-icon{font-size:28px;}
      .pdf-btn .pdf-sub{font-size:13px;font-weight:600;opacity:0.92;display:block;letter-spacing:0.8px;}
      @media print{.pdf-btn{display:none !important;}}

      @media print{
        /* Cada slide imprime como 1 página de 1920×1080 (16:9 nativo) */
        @page{size:1920px 1080px;margin:0;}
        html,body{overflow:visible;background:#fff;width:1920px;height:auto;margin:0;padding:0;}
        .deck{position:static !important;width:1920px !important;height:auto !important;}
        .slide{
          display:flex !important;
          position:relative !important;
          top:auto !important;left:auto !important;
          /* En print: NO translate (no centering en viewport), pero SÍ --fit
             para que si el contenido excede, se reduce automáticamente */
          transform:scale(var(--fit,1)) !important;
          transform-origin:top left !important;
          width:1920px !important;height:1080px !important;
          page-break-after:always !important;
          page-break-inside:avoid !important;
          animation:none !important;
          overflow:hidden !important;
        }
        .nav-bar,.progress,.hint{display:none !important;}
      }
    `;

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Presentación EPO 67 · ${a.turno} · ${a.parcialLabel}</title><style>${css}</style></head>
<body>
  <div class="progress"><div class="progress-fill" id="progFill" style="width:${(100 / slides.length).toFixed(2)}%;"></div></div>
  <div class="hint">← →  ESPACIO  PARA NAVEGAR</div>
  <button class="pdf-btn" id="pdfBtn" title="Descargar como PDF (no necesita impresora)">
    <span class="pdf-icon">📥</span>
    <span><strong>Descargar PDF</strong><span class="pdf-sub">No necesitas imprimir</span></span>
  </button>
  <div class="deck" id="deck">${slides.map((s, i) => s.replace('<section class="slide', `<section class="slide${i === 0 ? ' active' : ''}" data-i="${i}"`)).join('')}</div>
  <div class="nav-bar">
    <button class="nav-btn" id="prev">←</button>
    <span class="nav-counter"><span id="curr">1</span> / ${slides.length}</span>
    <button class="nav-btn" id="next">→</button>
  </div>
  <script>
    (function(){
      const slides=document.querySelectorAll('.slide');
      let i=0;const total=slides.length;
      const fill=document.getElementById('progFill');
      const curr=document.getElementById('curr');

      // ─── REGLA 1: Auto-scale al viewport (responsive a tamaño de pantalla) ───
      function updateScale(){
        const sx=window.innerWidth/1920;
        const sy=window.innerHeight/1080;
        const s=Math.min(sx,sy);
        document.documentElement.style.setProperty('--scale',s);
      }
      window.addEventListener('resize',updateScale);
      updateScale();

      // ─── REGLA 2: Auto-fit por overflow ───
      // Medir el contenido REAL del slide sumando alturas de hijos directos
      // (más confiable que scrollHeight cuando hay justify-content:center + overflow:hidden).
      function measureSlideContentHeight(slide){
        const cs=getComputedStyle(slide);
        let h=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
        Array.from(slide.children).forEach(c=>{
          if(c.offsetHeight===undefined)return;
          const ccs=getComputedStyle(c);
          if(ccs.display==='none')return;
          h+=c.offsetHeight+parseFloat(ccs.marginTop||0)+parseFloat(ccs.marginBottom||0);
        });
        return h;
      }
      function fitSlide(slide){
        slide.style.removeProperty('--fit');
        slide.classList.add('measuring');
        void slide.offsetHeight; // forzar layout
        const ch=measureSlideContentHeight(slide);
        const sh=1080;
        // Margen de seguridad: 96% del slide debe contener el contenido
        if(ch>sh*0.96){
          const ratio=(sh*0.96)/ch;
          slide.style.setProperty('--fit',ratio.toFixed(3));
        }
        slide.classList.remove('measuring');
      }
      function fitAllSlides(){slides.forEach(fitSlide);}
      // Ejecuta después de cargar fuentes web
      if(document.fonts&&document.fonts.ready){
        document.fonts.ready.then(()=>{setTimeout(fitAllSlides,80);setTimeout(fitAllSlides,400);});
      }else{
        setTimeout(fitAllSlides,300);
        setTimeout(fitAllSlides,800);
      }
      window.addEventListener('resize',fitAllSlides);
      window.addEventListener('beforeprint',fitAllSlides);

      function show(n){
        i=Math.max(0,Math.min(total-1,n));
        slides.forEach((s,idx)=>s.classList.toggle('active',idx===i));
        fill.style.width=((i+1)/total*100)+'%';
        curr.textContent=(i+1);
      }
      document.getElementById('prev').addEventListener('click',()=>show(i-1));
      document.getElementById('next').addEventListener('click',()=>show(i+1));
      document.getElementById('pdfBtn').addEventListener('click',()=>{
        // Forzar re-fit antes de imprimir para asegurar que todo cabe
        fitAllSlides();
        setTimeout(()=>window.print(),120);
      });
      document.addEventListener('keydown',(e)=>{
        if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){e.preventDefault();show(i+1);}
        else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();show(i-1);}
        else if(e.key==='Home')show(0);
        else if(e.key==='End')show(total-1);
      });
    })();
  </script>
</body></html>`;
  }

  async function generateAnalisisDetalladoByTurno(turno, btn, formato) {
    formato = formato || 'pdf';  // 'pdf' | 'json' | 'present' | 'md'
    const partial = _chipValue('parcial') || 'P2';

    // IMPORTANTE: abrir la ventana AQUÍ, SÍNCRONO, durante el gesto del click.
    // Si se abre después de un await, Chrome bloquea la ventana emergente.
    let popupWin = null;
    if (formato === 'pdf' || formato === 'present') {
      popupWin = window.open('', '_blank');
      if (!popupWin) {
        Toast.show('Permite ventanas emergentes en tu navegador para ver el análisis.', 'warning', 6000);
        return;
      }
      // Mostrar loader en la ventana mientras se computa
      popupWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Generando…</title>
        <style>
          body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#fefbf7;font-family:-apple-system,sans-serif;color:#2d2624;}
          .loader{text-align:center;}
          .spin{width:48px;height:48px;border:4px solid #fde2cf;border-top-color:#e8825b;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 18px;}
          @keyframes s{to{transform:rotate(360deg);}}
          h1{font-size:22px;margin:0 0 8px;font-weight:700;}
          p{font-size:14px;color:#7a5b48;margin:0;}
        </style></head><body><div class="loader"><div class="spin"></div><h1>Generando análisis…</h1><p>Turno ${turno} · ${partial}</p></div></body></html>`);
      popupWin.document.close();
    }

    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:24px;">autorenew</span><div style="flex:1;"><div>Generando análisis…</div></div>';

    try {
      if (!allGroups.length) await loadData();
      await _ensureGradesLoaded(); // lazy: solo cargamos grades al generar análisis
      const analysis = _computeAnalisis(turno, partial);
      if (!analysis) {
        Toast.show(`No hay grupos en turno ${turno}`, 'warning');
        if (popupWin) popupWin.close();
        return;
      }

      const dateTag = new Date().toISOString().slice(0, 10);
      if (formato === 'pdf') {
        const html = _analisisToHTML(analysis);
        popupWin.document.open();
        popupWin.document.write(html);
        popupWin.document.close();
        Toast.show(`✓ PDF abierto. Usa Cmd+P / Ctrl+P para guardar como PDF.`, 'success', 6000);
      } else if (formato === 'present') {
        const html = _analisisToPresentation(analysis);
        popupWin.document.open();
        popupWin.document.write(html);
        popupWin.document.close();
        Toast.show(`✓ Presentación abierta. Usa las flechas ← → para navegar.`, 'success', 6000);
      } else if (formato === 'json') {
        const json = _analisisToJSON(analysis);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Analisis_EPO67_${turno}_${partial}_${dateTag}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
        Toast.show(`✓ JSON descargado. Pégalo en ChatGPT/Claude para generar tu presentación.`, 'success', 8000);
      } else {
        const md = `# Análisis EPO 67 ${turno}\n\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\``;
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Analisis_EPO67_${turno}_${partial}_${dateTag}.md`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      }
    } catch (e) {
      console.error('Error generando análisis:', e);
      Toast.show('Error: ' + (e.message || ''), 'error');
      if (popupWin) popupWin.close();
    } finally {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.innerHTML = orig;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      // ─── NUEVAS ACCIONES POR TURNO ───
      if (action === 'download-excel' || action === 'download-analisis') {
        const turno = btn.dataset.turno;
        _setActiveChip('turno', turno);
        _setActiveChip('grado', '');
        _setActiveChip('grupo', '');
        if (action === 'download-excel') generateIndicadoresByTurnoExcel(turno, btn);
        else if (action === 'download-analisis') {
          const formato = btn.dataset.formato || 'pdf';
          generateAnalisisDetalladoByTurno(turno, btn, formato);
        }
        return;
      }
      // Acciones viejas (compatibilidad)
      if (action === 'calculate') calculate();
      else if (action === 'export') exportIndicadores();
      else if (action === 'indicadores-mat') generateIndicadoresByTurnoExcel('MATUTINO', btn);
      else if (action === 'indicadores-vesp') generateIndicadoresByTurnoExcel('VESPERTINO', btn);
    });

    // Tab switching
    container.addEventListener('click', (e) => {
      const tab = e.target.closest('.ind-tab');
      if (!tab || !_currentData) return;
      _activateTab(tab.dataset.tab);
      _renderTab();
    });

    // CHIP FILTERS: clic en cualquier chip → marcar como activo y re-render grupos si aplica
    const chipBar = document.getElementById('ind-chip-filters');
    if (chipBar) {
      chipBar.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const filter = chip.dataset.filter;
        const value = chip.dataset.value || '';
        _setActiveChip(filter, value);
        // Si cambió turno o grado, re-generar chips de grupo (filtrado dinámico)
        if (filter === 'turno' || filter === 'grado') updateGroupOptions();
      });
    }
  }


  return { render };
})();

Router.modules['indicadores'] = () => IndicadoresModule.render();
