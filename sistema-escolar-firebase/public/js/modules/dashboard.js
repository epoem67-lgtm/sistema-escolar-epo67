/**
 * DASHBOARD MODULE — Sistema Escolar EPO 67
 *
 * REDISEÑO v7.64 (mayo 2026):
 *   Vista admin/orientador/auditor renovada — enfocada en lo CRÍTICO:
 *     1. KPIs ejecutivos (4): Total · Promedio · % Aprobación · Docentes
 *     2. FOCO CRÍTICO (3 cards grandes clickeables):
 *          🚨 EN EXTRAORDINARIO · ⚠️ EN RIESGO · 📉 IRREGULARES
 *     3. Radiografía 3×2: grado × turno
 *     4. Top 5 grupos y materias con más problemas
 *     5. Accesos directos a módulos
 *
 *   Usa `App.calcStatusExtraordinario` (app.js) — fuente única de verdad para
 *   distinguir EN_EXTRA / EN_RIESGO / IRREGULAR / APROBADO. Antes el dashboard
 *   tenía métricas inconsistentes (alumno-céntricas vs cal-céntricas).
 *
 *   Cada KPI tiene tooltip explicando su fórmula y es clickeable: abre un modal
 *   con la lista de alumnos específicos detrás del número.
 *
 *   Vista MAESTRO/ORIENTADOR_DOCENTE (renderTeacherDashboard) se conserva
 *   intacta de la versión anterior — es su pantalla personal.
 *
 *   Vista PRESIDENTE_ACADEMIA delegada a PresidenteAcademiaModule.
 */

const DashboardModule = (() => {
  // Estado: parcial seleccionado y cache de datos del último render.
  let _selectedPartial = null;
  let _cachedData = null;
  let _eventsBound = false;

  // ═══════════════════════════════════════════════════════════════
  // BANNER RECORDATORIO: imprimir Concentrado F1 al cerrar P3
  // Se muestra a todos los roles en su dashboard. Click → Mi F1 (maestros)
  // o sección concentrado (admin). Es el aviso principal del cierre del
  // ciclo escolar: sin el F1 firmado entregado en Dirección, no se cierra
  // formalmente el semestre.
  // ═══════════════════════════════════════════════════════════════
  function _renderF1Banner(role) {
    const isMaestro = role === 'maestro' || role === 'orientador_docente';
    const targetModule = isMaestro ? 'my-f1' : 'concentrado';
    const targetLabel = isMaestro ? 'Ver mi Formato F1' : 'Ir a Concentrados';
    // Vista del maestro usa onclick inline (no event delegation). Vista
    // institucional usa data-action='goto-f1' que captura _bindEvents().
    const handler = isMaestro
      ? `onclick="Router.navigate('${targetModule}')"`
      : `data-action="goto-f1" data-target="${targetModule}"`;
    return `
      <div class="card" ${handler}
           style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;padding:22px 26px;margin-bottom:16px;border:none;cursor:pointer;box-shadow:0 8px 18px rgba(220,38,38,0.35);position:relative;overflow:hidden;">
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
          <div style="background:rgba(255,255,255,0.18);border-radius:50%;width:64px;height:64px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span class="material-icons-round" style="font-size:38px;color:#fff;">print</span>
          </div>
          <div style="flex:1;min-width:240px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#fee2e2;text-transform:uppercase;margin-bottom:4px;">⚠ RECORDATORIO IMPORTANTE</div>
            <h2 style="font-size:22px;font-weight:900;margin:0 0 6px;color:#fff;line-height:1.2;">
              Imprime tu CONCENTRADO F1 al terminar de capturar el TERCER parcial
            </h2>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#fee2e2;">
              El F1 firmado y entregado en Dirección es <strong style="color:#fff;">obligatorio</strong> para el cierre oficial del ciclo escolar 2025-2026. No olvides revisar promedios, faltas y firmas antes de imprimir.
            </p>
          </div>
          <div style="flex-shrink:0;">
            <button class="btn" ${handler}
                    style="background:#fff;color:#b91c1c;border:none;padding:12px 22px;font-weight:800;font-size:14px;border-radius:8px;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.2);white-space:nowrap;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">arrow_forward</span>
              ${targetLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════
  // ENTRY POINT
  // ═══════════════════════════════════════════════════════════════

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando dashboard...');

    const role = App.currentUser?.role;

    // Vista maestro: su panel personal con sus asignaciones (sin cambios)
    if ((role === 'maestro' || role === 'orientador_docente') && !App.canActAs('auditor')) {
      return renderTeacherDashboard(container);
    }

    // Vista presidente de academia
    if (role === 'presidente_academia' && !App.canActAs('auditor')) {
      const mod = (typeof PresidenteAcademiaModule !== 'undefined') ? PresidenteAcademiaModule : null;
      if (mod && mod.renderDashboard) return mod.renderDashboard(container);
    }

    // Vista admin/orientador/directivo/subdirector/auditor/secretario_*/consulta
    return renderInstitucionalDashboard(container, role);
  }

  // ═══════════════════════════════════════════════════════════════
  // VISTA INSTITUCIONAL (admin/subdirector/directivo/orientador/auditor)
  // ═══════════════════════════════════════════════════════════════

  async function renderInstitucionalDashboard(container, role) {
    try {
      const isOrientadorRole = role === 'orientador';
      const isAuditor = App.canActAs('auditor');
      // Auditor ve todo (no se restringe a turnos)
      const useOrientadorScope = isOrientadorRole && !isAuditor;

      // ═══ FASE 1: Datos livianos en paralelo ═══
      const lightPromises = [
        Store.getTeachers(),
        Store.getGroups(),
        Store.getPartials(),
        Store.getAssignments(),
        Store.getSubjects(),
      ];
      if (useOrientadorScope) lightPromises.push(Store.getOrientadorGroups());
      const lightResults = await Promise.all(lightPromises);
      const [teachers, groupsAll, partials, assignments, subjects] = lightResults;
      const oriGroupIds = useOrientadorScope ? (lightResults[5] || []) : null;

      // ═══ SCOPE ═══
      let scopedGroups = groupsAll;
      let scopeLabel = null;
      if (useOrientadorScope) {
        const oriSet = new Set(oriGroupIds || []);
        const turnosSet = new Set(
          groupsAll.filter(g => oriSet.has(g.id)).map(g => g.turno).filter(Boolean)
        );
        if (turnosSet.size > 0) {
          scopedGroups = groupsAll.filter(g => turnosSet.has(g.turno));
          scopeLabel = `Vista de orientación · ${scopedGroups.length} grupos del turno ${[...turnosSet].join(' y ')}.`;
        } else {
          scopedGroups = [];
          scopeLabel = 'Aún no tienes grupos asignados como orientador.';
        }
      }

      // ═══ FASE 2: Students ═══
      const gIds = scopedGroups.map(g => g.id);
      let students = [];
      if (useOrientadorScope) {
        students = gIds.length > 0 ? await Store.getStudentsByGroups(gIds) : [];
      } else {
        students = await Store.getStudents();
      }
      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      // ═══ FASE 3: Parcial seleccionado + grades ═══
      // El dashboard refleja EXACTAMENTE las métricas del módulo Indicadores
      // (las orientadoras comparan). Indicadores filtra por parcial; el
      // dashboard también lo hace.
      //   - 'P1' / 'P2' / 'P3': solo ese parcial → métricas alumno-céntricas
      //     de ese momento puntual (alumnos con cal <6 en ese parcial).
      //   - 'ACUM': los 3 parciales → habilita Extra/Riesgo (regla Gaceta EPO 67
      //     requiere ver los 3 parciales para decidir si el extra es definitivo).
      if (!_selectedPartial) _selectedPartial = App.getDefaultPartial ? App.getDefaultPartial() : 'P2';
      const isAcumulado = _selectedPartial === 'ACUM';

      // Cargamos siempre TODOS los grades porque:
      //   - Si parcial específico: filtramos client-side para evitar otro fetch.
      //   - Si ACUM: necesitamos los 3 para calcStatusExtraordinario.
      const allGrades = gIds.length > 0
        ? await Store.getGradesByGroups(gIds)
        : [];
      // grades = los que aplican según selector
      const grades = isAcumulado ? allGrades : allGrades.filter(g => g.partial === _selectedPartial);

      // ═══ FASE 4: Cálculo de métricas ═══
      // Dos índices:
      //   gradeIdxAll = TODOS los parciales (para Extra/Riesgo con Gaceta)
      //   gradeIdxSel = solo el parcial seleccionado (para Irregulares/Promedio
      //                 que coinciden con Indicadores; en modo ACUM = todos).
      const gradeIdxAll = {};
      for (const g of allGrades) {
        const sid = g.studentId, suj = g.subjectId, p = g.partial;
        if (!sid || !suj || !p) continue;
        if (!gradeIdxAll[sid]) gradeIdxAll[sid] = {};
        if (!gradeIdxAll[sid][suj]) gradeIdxAll[sid][suj] = {};
        gradeIdxAll[sid][suj][p] = g;
      }

      // Construir set de (studentId, subjectId) que aplican según assignments
      // del scope. Asignaciones globales (admin) o solo del scope (orientador).
      const scopeGroupIds = new Set(gIds);
      const scopeAsg = assignments.filter(a => scopeGroupIds.has(a.groupId));
      const studentsByGroup = new Map();
      for (const s of activeStudents) {
        if (!studentsByGroup.has(s.groupId)) studentsByGroup.set(s.groupId, []);
        studentsByGroup.get(s.groupId).push(s);
      }

      // Para cada (alumno, materia), calcular estatus de extraordinario
      // y acumular estadísticas. También recogemos las listas de alumnos
      // por categoría para el drill-down modal.
      const alumnosEnExtra = new Set();
      const alumnosEnRiesgo = new Set();
      const alumnosIrregulares = new Set();
      const reprobadasPorAlumno = new Map();
      const extraPorGrupo = new Map();
      const extraPorMateria = new Map();
      const reprobPorMateria = new Map();
      const promPorAlumno = new Map(); // para promedio general
      const subjMap = new Map();
      for (const s of subjects) subjMap.set(s.id, s);

      // Para mostrar listas en el modal, guardar detalles
      const detalleEnExtra = [];
      const detalleEnRiesgo = [];
      const detalleIrregulares = [];

      for (const a of scopeAsg) {
        const studsOfGroup = studentsByGroup.get(a.groupId) || [];
        for (const stu of studsOfGroup) {
          const sGrades = gradeIdxAll[stu.id]?.[a.subjectId] || {};
          const grades3 = [sGrades.P1 || null, sGrades.P2 || null, sGrades.P3 || null];
          // Extra/Riesgo SIEMPRE usan los 3 parciales (regla Gaceta EPO 67)
          const status = App.calcStatusExtraordinario({ grades3 });

          // Conteo de reprobadas:
          //   - modo ACUM: cuenta cals <6 de los 3 parciales (igual que indicadores acumulado)
          //   - modo P1/P2/P3: solo cuenta cals <6 del parcial seleccionado
          //     → coincide EXACTAMENTE con la métrica "Irregular" de Indicadores
          //     cuando este filtra por ese parcial.
          const gradesToCheck = isAcumulado ? grades3.filter(Boolean) : (sGrades[_selectedPartial] ? [sGrades[_selectedPartial]] : []);
          for (const g of gradesToCheck) {
            const cal = g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null);
            if (cal != null && !isNaN(cal) && cal < 6) {
              reprobadasPorAlumno.set(stu.id, (reprobadasPorAlumno.get(stu.id) || 0) + 1);
              reprobPorMateria.set(a.subjectId, (reprobPorMateria.get(a.subjectId) || 0) + 1);
            }
          }

          if (status.isExtra) {
            if (!alumnosEnExtra.has(stu.id)) {
              detalleEnExtra.push({
                studentId: stu.id,
                studentName: _fmtStudentName(stu),
                groupName: scopedGroups.find(g => g.id === a.groupId)?.nombre || a.groupId,
                turno: a.turno || scopedGroups.find(g => g.id === a.groupId)?.turno || '',
                grado: scopedGroups.find(g => g.id === a.groupId)?.grado || '',
                materias: [],
              });
            }
            alumnosEnExtra.add(stu.id);
            const ref = detalleEnExtra.find(d => d.studentId === stu.id);
            if (ref) ref.materias.push(K.getUACNombre(subjMap.get(a.subjectId)?.nombre || a.subjectName || a.subjectId));
            extraPorGrupo.set(a.groupId, (extraPorGrupo.get(a.groupId) || new Set()).add(stu.id));
            extraPorMateria.set(a.subjectId, (extraPorMateria.get(a.subjectId) || 0) + 1);
          } else if (status.isRiesgo) {
            if (!alumnosEnRiesgo.has(stu.id) && !alumnosEnExtra.has(stu.id)) {
              detalleEnRiesgo.push({
                studentId: stu.id,
                studentName: _fmtStudentName(stu),
                groupName: scopedGroups.find(g => g.id === a.groupId)?.nombre || a.groupId,
                turno: a.turno || scopedGroups.find(g => g.id === a.groupId)?.turno || '',
                grado: scopedGroups.find(g => g.id === a.groupId)?.grado || '',
                materias: [],
              });
            }
            if (!alumnosEnExtra.has(stu.id)) alumnosEnRiesgo.add(stu.id);
            const ref = detalleEnRiesgo.find(d => d.studentId === stu.id);
            if (ref) ref.materias.push(K.getUACNombre(subjMap.get(a.subjectId)?.nombre || a.subjectName || a.subjectId));
          }

          // Promedio del alumno
          // - modo ACUM: promedia las 3 cals (igual que indicadores acumulado)
          // - modo P1/P2/P3: solo la cal de ese parcial (alineado con indicadores)
          const gradesForAvg = isAcumulado ? grades3.filter(Boolean) : (sGrades[_selectedPartial] ? [sGrades[_selectedPartial]] : []);
          const calsAlumno = gradesForAvg
            .map(g => g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null))
            .filter(c => c != null && !isNaN(c));
          if (calsAlumno.length > 0) {
            if (!promPorAlumno.has(stu.id)) promPorAlumno.set(stu.id, { sum: 0, cnt: 0 });
            const p = promPorAlumno.get(stu.id);
            // Cap a 10 (regla EPO 67: cal max). Indicadores no lo hace pero
            // técnicamente debería; si en datos hay cal >10 es error de captura.
            calsAlumno.forEach(c => { p.sum += Math.min(c, 10); p.cnt++; });
          }
        }
      }

      // Irregulares = TIENE ≥1 REPROBADA (incluye los de extra y riesgo)
      for (const sid of reprobadasPorAlumno.keys()) {
        alumnosIrregulares.add(sid);
        if (!alumnosEnExtra.has(sid) && !alumnosEnRiesgo.has(sid)) {
          const stu = activeStudents.find(s => s.id === sid);
          if (stu) {
            detalleIrregulares.push({
              studentId: sid,
              studentName: _fmtStudentName(stu),
              groupName: scopedGroups.find(g => g.id === stu.groupId)?.nombre || stu.groupId || '',
              turno: scopedGroups.find(g => g.id === stu.groupId)?.turno || '',
              grado: scopedGroups.find(g => g.id === stu.groupId)?.grado || '',
              reprobadas: reprobadasPorAlumno.get(sid) || 0,
            });
          }
        }
      }
      // También sumar los de extra/riesgo al detalle de irregulares (pero menos visibles ahí)
      for (const d of detalleEnExtra) detalleIrregulares.push({ ...d, reprobadas: reprobadasPorAlumno.get(d.studentId) || 0, _esExtra: true });
      for (const d of detalleEnRiesgo) detalleIrregulares.push({ ...d, reprobadas: reprobadasPorAlumno.get(d.studentId) || 0, _esRiesgo: true });

      // Promedio general — 2 decimales para coincidir con Indicadores
      let sumPromedios = 0, cntPromedios = 0;
      for (const p of promPorAlumno.values()) {
        if (p.cnt > 0) { sumPromedios += p.sum / p.cnt; cntPromedios++; }
      }
      const promGeneral = cntPromedios > 0 ? (sumPromedios / cntPromedios).toFixed(2) : '—';

      // % aprobación = alumnos SIN reprobadas / alumnos con al menos 1 cal
      const totalConCal = promPorAlumno.size;
      const aprobados = totalConCal - alumnosIrregulares.size;
      const pctAprobacion = totalConCal > 0 ? Math.round((aprobados / totalConCal) * 100) : 0;

      // Radiografía por grado × turno.
      // CATEGORÍAS (corregido v7.71):
      //   - Regular = SIN ninguna reprobada (regulares + irregulares = total)
      //   - Irregular = CON ≥1 reprobada
      //   - Riesgo y Extra son SUB-CATEGORÍAS de Irregular (no excluyentes).
      //     Un alumno en Extra también cuenta como Irregular. Un alumno en Riesgo
      //     también cuenta como Irregular. Eso es lo que las orientadoras esperan
      //     ver — el número grande de "irregulares" debe incluir a todos los que
      //     tienen al menos una reprobada.
      const radiografia = {};
      for (const grado of [1, 2, 3]) {
        radiografia[grado] = { MATUTINO: _emptyRadioCell(), VESPERTINO: _emptyRadioCell() };
      }
      for (const stu of activeStudents) {
        const grp = scopedGroups.find(g => g.id === stu.groupId);
        if (!grp) continue;
        const g = Number(grp.grado);
        const t = grp.turno;
        if (!radiografia[g] || !radiografia[g][t]) continue;
        const cell = radiografia[g][t];
        cell.total++;
        // Regular vs Irregular (mutuamente excluyentes; suman al total)
        if (alumnosIrregulares.has(stu.id)) cell.irreg++;
        else cell.regulares++;
        // Sub-categorías: solo en modo ACUM (Gaceta requiere los 3 parciales)
        if (isAcumulado) {
          if (alumnosEnExtra.has(stu.id)) cell.extra++;
          else if (alumnosEnRiesgo.has(stu.id)) cell.riesgo++;
        }
        const p = promPorAlumno.get(stu.id);
        if (p && p.cnt > 0) { cell.promSum += p.sum / p.cnt; cell.promCnt++; }
      }

      // Top 5 grupos con más alumnos en extra
      const topGruposExtra = [...extraPorGrupo.entries()]
        .map(([gid, set]) => {
          const g = scopedGroups.find(g => g.id === gid);
          return { groupId: gid, groupName: g?.nombre || gid, turno: g?.turno || '', count: set.size };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Top 5 materias con más reprobados
      const topMateriasReprob = [...reprobPorMateria.entries()]
        .map(([sid, count]) => ({
          subjectId: sid,
          subjectName: K.getUACNombre(subjMap.get(sid)?.nombre || sid),
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      _cachedData = {
        teachers, groupsAll, partials, assignments, subjects,
        scopedGroups, activeStudents, scopeLabel, role,
        alumnosEnExtra, alumnosEnRiesgo, alumnosIrregulares,
        detalleEnExtra, detalleEnRiesgo, detalleIrregulares,
        promGeneral, pctAprobacion, totalConCal,
        radiografia, topGruposExtra, topMateriasReprob,
        isAcumulado, selectedPartial: _selectedPartial,
      };

      _renderUI(container);
    } catch (err) {
      console.error('Error en dashboard:', err);
      container.innerHTML = UI.errorState('Error al cargar dashboard: ' + (err.message || ''));
    }
  }

  function _emptyRadioCell() {
    return { total: 0, regulares: 0, irreg: 0, riesgo: 0, extra: 0, promSum: 0, promCnt: 0 };
  }

  function _fmtStudentName(stu) {
    return ((stu.apellido1 || '') + ' ' + (stu.apellido2 || '') + ' ' + (stu.nombres || '')).trim().toUpperCase();
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER UI
  // ═══════════════════════════════════════════════════════════════

  function _renderUI(container) {
    if (!_cachedData) return;
    const d = _cachedData;

    const scopeBannerHtml = d.scopeLabel
      ? `<div style="background:#eff6ff;border-left:4px solid #1e40af;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#1e3a8a;border-radius:6px;">
          <strong>🎯 Tu alcance:</strong> ${Utils.sanitize(d.scopeLabel)}
        </div>`
      : '';

    // Banner de correcciones (admin/subdirector/directivo)
    const correctionsBannerHtml = ['admin', 'subdirector', 'directivo'].includes(d.role)
      ? `<div id="dash-corrections-banner" style="margin-bottom:14px;"></div>`
      : '';

    // Selector de parcial (afecta TODAS las métricas para coincidir con Indicadores)
    const partialOptions = [
      ...K.PARCIALES.map(p => ({ id: p.id, nombre: p.nombre })),
      { id: 'ACUM', nombre: '📊 Acumulado (3 parciales)' },
    ];
    const partialChipsHtml = partialOptions.map(p => {
      const active = _selectedPartial === p.id;
      return `<button data-action="set-partial" data-partial="${p.id}"
        style="${active ? 'background:#1e40af;color:#fff;border:1px solid #1e40af;' : 'background:#fff;color:#475569;border:1px solid #cbd5e0;'}padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:inherit;">
        ${p.nombre}
      </button>`;
    }).join('');
    const partialSelectorHtml = `<div class="card" style="padding:12px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:12px;color:#64748b;font-weight:600;">¿Qué parcial?</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${partialChipsHtml}</div>
        <div style="margin-left:auto;font-size:11px;color:#94a3b8;font-style:italic;">
          Los números coinciden con el módulo <strong>Indicadores</strong> para el mismo parcial.
        </div>
      </div>
    </div>`;

    container.innerHTML = UI.moduleContainer([
      // Header
      `<div class="card" style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);color:#fff;padding:22px 26px;margin-bottom:16px;">
        <h1 style="font-size:22px;font-weight:700;margin:0 0 2px;color:#fff;">Dashboard Institucional</h1>
        <p style="margin:0;font-size:13px;opacity:0.92;">EPO 67 · Vista en tiempo real basada en las calificaciones capturadas</p>
      </div>`,

      // Recordatorio gigante para imprimir Concentrado F1 al cerrar P3
      _renderF1Banner(App.currentUser?.role),

      scopeBannerHtml,
      correctionsBannerHtml,

      // Selector de parcial — afecta TODAS las métricas
      partialSelectorHtml,

      // 4 KPIs ejecutivos (cambian según parcial)
      _renderKPIsEjecutivos(d),

      // 🎯 FOCO CRÍTICO — solo en modo ACUM (Extra/Riesgo requiere ver los 3 parciales)
      _renderFocoCritico(d),

      // 🗺️ Radiografía por grado × turno
      _renderRadiografia(d),

      // Top 5 grupos + Top 5 materias problemáticas
      _renderTopProblemas(d),

      // Accesos directos
      _renderAccesosDirectos(),
    ].join(''));

    _bindEvents();
    _loadCorrectionsBanner();
  }

  // ═══════════════════════════════════════════════════════════════
  // KPIs EJECUTIVOS
  // ═══════════════════════════════════════════════════════════════

  function _renderKPIsEjecutivos(d) {
    const partialLabel = d.isAcumulado
      ? 'Acumulado (3 parciales)'
      : (K.PARCIALES.find(p => p.id === d.selectedPartial)?.nombre || d.selectedPartial);
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
        <div class="card" style="padding:16px;border-left:5px solid #1e40af;">
          <div style="font-size:10px;font-weight:700;color:#1e3a8a;letter-spacing:1.5px;">TOTAL ALUMNOS</div>
          <div style="font-size:36px;font-weight:900;color:#1e40af;line-height:1;margin-top:4px;">${d.activeStudents.length}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">activos en sistema</div>
        </div>
        <div class="card" style="padding:16px;border-left:5px solid #0891b2;" title="Promedio de promedios individuales (cada alumno cuenta una vez). ${d.isAcumulado ? 'Usa los 3 parciales.' : 'Solo cuenta cals de ' + partialLabel + '.'}">
          <div style="font-size:10px;font-weight:700;color:#155e75;letter-spacing:1.5px;">PROMEDIO · ${Utils.sanitize(partialLabel).toUpperCase()}</div>
          <div style="font-size:36px;font-weight:900;color:#0891b2;line-height:1;margin-top:4px;">${d.promGeneral}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">de ${d.totalConCal} alumnos con cal</div>
        </div>
        <div class="card" style="padding:16px;border-left:5px solid #10b981;" title="Alumnos sin NINGUNA cal <6 en ${partialLabel}. Definición idéntica a Indicadores.">
          <div style="font-size:10px;font-weight:700;color:#065f46;letter-spacing:1.5px;">% APROBACIÓN</div>
          <div style="font-size:36px;font-weight:900;color:#10b981;line-height:1;margin-top:4px;">${d.pctAprobacion}%</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">${d.totalConCal - d.alumnosIrregulares.size} de ${d.totalConCal} regulares</div>
        </div>
        <div class="card" style="padding:16px;border-left:5px solid #6366f1;">
          <div style="font-size:10px;font-weight:700;color:#3730a3;letter-spacing:1.5px;">DOCENTES</div>
          <div style="font-size:36px;font-weight:900;color:#6366f1;line-height:1;margin-top:4px;">${d.teachers.length}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">en plantilla</div>
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🎯 FOCO CRÍTICO — 3 cards grandes (clickeables)
  // ═══════════════════════════════════════════════════════════════

  function _renderFocoCritico(d) {
    const partialLabel = d.isAcumulado
      ? 'Acumulado'
      : (K.PARCIALES.find(p => p.id === d.selectedPartial)?.nombre || d.selectedPartial);
    const tooltipExtra = 'Alumnos que YA NO PUEDEN aprobar en parciales regulares: ≥2 parciales reprobados, o 3 cals con prom <6, o >20% inasistencia. Reglas Gaceta EPO 67. Requiere los 3 parciales.';
    const tooltipRiesgo = 'Alumnos RECUPERABLES: 1 parcial reprobado pero pueden salvarse capturando el siguiente parcial. Si no aprueban, irán a extra.';
    const tooltipIrreg = `Alumnos con AL MENOS 1 cal <6 en ${partialLabel}. Misma definición que Indicadores para el mismo parcial.`;

    // Card "Irregulares" SIEMPRE visible (coincide con Indicadores por parcial)
    const irregularCard = `<button data-action="show-list" data-tipo="irregulares" title="${Utils.sanitize(tooltipIrreg)}"
      style="text-align:left;background:linear-gradient(135deg,#a855f7 0%,#7e22ce 100%);color:#fff;border:none;border-radius:12px;padding:18px 22px;cursor:pointer;box-shadow:0 4px 12px rgba(168,85,247,0.25);transition:transform .15s;font-family:inherit;"
      onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
      <div style="font-size:36px;line-height:1;">📉</div>
      <div style="font-size:48px;font-weight:900;line-height:1;margin:8px 0 4px;">${d.alumnosIrregulares.size}</div>
      <div style="font-size:14px;font-weight:700;letter-spacing:.3px;">ALUMNOS IRREGULARES</div>
      <div style="font-size:11px;opacity:.9;margin-top:4px;">Con ≥1 reprobada en ${Utils.sanitize(partialLabel)}</div>
    </button>`;

    // Cards Extra y Riesgo SOLO en modo ACUM (requieren los 3 parciales)
    const extraYRiesgoCards = d.isAcumulado ? `
      <button data-action="show-list" data-tipo="extra" title="${Utils.sanitize(tooltipExtra)}"
        style="text-align:left;background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);color:#fff;border:none;border-radius:12px;padding:18px 22px;cursor:pointer;box-shadow:0 4px 12px rgba(220,38,38,0.25);transition:transform .15s;font-family:inherit;"
        onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
        <div style="font-size:36px;line-height:1;">🚨</div>
        <div style="font-size:48px;font-weight:900;line-height:1;margin:8px 0 4px;">${d.alumnosEnExtra.size}</div>
        <div style="font-size:14px;font-weight:700;letter-spacing:.3px;">ALUMNOS EN EXTRAORDINARIO</div>
        <div style="font-size:11px;opacity:.9;margin-top:4px;">Confirmado — irán a examen extraordinario</div>
      </button>
      <button data-action="show-list" data-tipo="riesgo" title="${Utils.sanitize(tooltipRiesgo)}"
        style="text-align:left;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#fff;border:none;border-radius:12px;padding:18px 22px;cursor:pointer;box-shadow:0 4px 12px rgba(245,158,11,0.25);transition:transform .15s;font-family:inherit;"
        onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
        <div style="font-size:36px;line-height:1;">⚠️</div>
        <div style="font-size:48px;font-weight:900;line-height:1;margin:8px 0 4px;">${d.alumnosEnRiesgo.size}</div>
        <div style="font-size:14px;font-weight:700;letter-spacing:.3px;">EN RIESGO DE EXTRA</div>
        <div style="font-size:11px;opacity:.9;margin-top:4px;">Recuperables — pueden salvarse aún</div>
      </button>` : '';

    // Si NO es ACUM, mostrar nota explicativa que Extra/Riesgo solo aplican acumulado
    const notaParcial = !d.isAcumulado ? `
      <div style="background:#eff6ff;border-left:3px solid #1e40af;padding:8px 12px;margin-top:12px;border-radius:6px;font-size:11px;color:#1e3a8a;">
        💡 <strong>Para ver alumnos en Extraordinario / Riesgo:</strong> cambia el selector arriba a "📊 Acumulado". La regla de extraordinario (Gaceta EPO 67) requiere ver los 3 parciales completos.
      </div>` : '';

    return `
      <div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-radius:14px;padding:18px 22px;margin-bottom:16px;border:2px solid #d97706;">
        <h2 style="font-size:16px;font-weight:800;color:#78350f;margin:0 0 4px;letter-spacing:.3px;">
          🎯 FOCO CRÍTICO ${d.isAcumulado ? '· Vista acumulada' : '· ' + Utils.sanitize(partialLabel)}
        </h2>
        <p style="font-size:11px;color:#92400e;margin:0 0 14px;">Click en cualquier tarjeta para ver la lista de alumnos específicos.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;">
          ${extraYRiesgoCards}
          ${irregularCard}
        </div>
        ${notaParcial}
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🗺️ RADIOGRAFÍA POR GRADO × TURNO
  // ═══════════════════════════════════════════════════════════════

  function _renderRadiografia(d) {
    // Diseño nuevo: 6 cards grandes (3 grados × 2 turnos) en grid responsive.
    // Tipografía grande, números prominentes, barra de progreso visible.
    const radioCard = (grado, turno) => {
      const c = d.radiografia[grado]?.[turno] || _emptyRadioCell();
      const isMatutino = turno === 'MATUTINO';
      const turnoIcon = isMatutino ? '☀️' : '🌙';
      const turnoBg = isMatutino
        ? 'linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)'
        : 'linear-gradient(135deg,#ede9fe 0%,#ddd6fe 100%)';
      const turnoAccent = isMatutino ? '#d97706' : '#7c3aed';

      if (c.total === 0) {
        return `<div style="background:#f9fafb;border:2px dashed #e5e7eb;border-radius:14px;padding:24px;text-align:center;color:#9ca3af;display:flex;flex-direction:column;justify-content:center;min-height:200px;">
          <div style="font-size:28px;line-height:1;">${turnoIcon}</div>
          <div style="font-size:13px;font-weight:700;margin-top:6px;color:#64748b;">${grado}° ${isMatutino ? 'Matutino' : 'Vespertino'}</div>
          <div style="font-size:11px;margin-top:6px;">sin datos</div>
        </div>`;
      }

      const prom = c.promCnt > 0 ? (c.promSum / c.promCnt).toFixed(2) : '—';
      const promNum = c.promCnt > 0 ? c.promSum / c.promCnt : null;
      const promColor = promNum === null ? '#475569'
        : promNum < 7 ? '#dc2626'
        : promNum >= 8.3 ? '#10b981'
        : '#0891b2';
      const pctIrreg = c.total > 0 ? Math.round((c.irreg + c.riesgo + c.extra) / c.total * 100) : 0;
      const pctReg = 100 - pctIrreg;
      const regColor = pctReg >= 80 ? '#10b981' : pctReg >= 60 ? '#f59e0b' : '#dc2626';

      return `<div style="background:${turnoBg};border-left:6px solid ${turnoAccent};border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
        <!-- Header: grado + turno -->
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:30px;font-weight:900;color:#1e293b;line-height:1;">${grado}°</span>
            <div style="display:flex;flex-direction:column;line-height:1.1;">
              <span style="font-size:11px;color:${turnoAccent};font-weight:700;letter-spacing:.5px;">${turnoIcon} ${isMatutino ? 'MATUTINO' : 'VESPERTINO'}</span>
              <span style="font-size:10px;color:#6b7280;">${grado === 1 ? '2°' : grado === 2 ? '4°' : '6°'} semestre</span>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:32px;font-weight:900;color:#1e293b;line-height:1;">${c.total}</div>
            <div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">alumnos</div>
          </div>
        </div>

        <!-- Barra de regularidad -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
            <span style="font-size:11px;color:#475569;font-weight:600;">Regularidad</span>
            <span style="font-size:18px;font-weight:800;color:${regColor};">${pctReg}%</span>
          </div>
          <div style="background:rgba(255,255,255,0.7);height:8px;border-radius:4px;overflow:hidden;">
            <div style="background:${regColor};height:100%;width:${pctReg}%;transition:width .3s;"></div>
          </div>
        </div>

        <!-- Stats:
             Reg/Irreg suman al total (mutuamente excluyentes).
             Riesgo y Extra son SUBCONJUNTOS de Irreg, separados visualmente con borde dashed. -->
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;background:rgba(255,255,255,0.7);border-radius:8px;padding:10px;">
          <div style="text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#10b981;line-height:1;">${c.regulares}</div>
            <div style="font-size:10px;color:#065f46;font-weight:700;text-transform:uppercase;margin-top:3px;">Regulares</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#a855f7;line-height:1;">${c.irreg}</div>
            <div style="font-size:10px;color:#6b21a8;font-weight:700;text-transform:uppercase;margin-top:3px;">Irregulares</div>
          </div>
        </div>
        ${d.isAcumulado ? `
        <div style="background:rgba(255,255,255,0.55);border-radius:8px;padding:8px 10px;border:1px dashed ${turnoAccent};">
          <div style="font-size:9px;color:#475569;font-weight:700;text-transform:uppercase;margin-bottom:6px;letter-spacing:.4px;">de los irregulares:</div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
            <div style="text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#f59e0b;line-height:1;">${c.riesgo}</div>
              <div style="font-size:9px;color:#92400e;font-weight:700;text-transform:uppercase;margin-top:2px;">⚠️ Riesgo</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:22px;font-weight:800;color:#dc2626;line-height:1;">${c.extra}</div>
              <div style="font-size:9px;color:#991b1b;font-weight:700;text-transform:uppercase;margin-top:2px;">🚨 Extra</div>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Promedio del grupo -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid rgba(0,0,0,0.08);">
          <span style="font-size:11px;color:#475569;font-weight:600;">📊 Promedio del grado</span>
          <span style="font-size:24px;font-weight:900;color:${promColor};line-height:1;">${prom}</span>
        </div>
      </div>`;
    };

    const partialLabel = d.isAcumulado
      ? 'Acumulado (3 parciales)'
      : (K.PARCIALES.find(p => p.id === d.selectedPartial)?.nombre || d.selectedPartial);
    const leyenda = d.isAcumulado
      ? `<strong style="color:#10b981;">Regulares</strong> sin reprobadas · <strong style="color:#a855f7;">Irregulares</strong> con ≥1 reprobada (incluye los de Riesgo y Extra) · <strong style="color:#f59e0b;">Riesgo</strong> y <strong style="color:#dc2626;">Extra</strong> son sub-categorías de los irregulares según regla Gaceta EPO 67.`
      : `<strong style="color:#10b981;">Regulares</strong> sin reprobadas en ${Utils.sanitize(partialLabel)} · <strong style="color:#a855f7;">Irregulares</strong> con ≥1 reprobada · <em>los números coinciden con Indicadores para el mismo parcial</em>`;

    return `
      <div class="card" style="padding:18px 22px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;flex-wrap:wrap;gap:6px;">
          <h2 style="font-size:18px;font-weight:800;color:#1e293b;margin:0;">
            🗺️ Radiografía por Grado y Turno · ${Utils.sanitize(partialLabel)}
          </h2>
          <span style="font-size:11px;color:#64748b;font-style:italic;">Mirada general a la situación académica de cada grado</span>
        </div>
        <p style="font-size:12px;color:#64748b;margin:0 0 16px;line-height:1.5;">${leyenda}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">
          ${radioCard(1, 'MATUTINO')}
          ${radioCard(1, 'VESPERTINO')}
          ${radioCard(2, 'MATUTINO')}
          ${radioCard(2, 'VESPERTINO')}
          ${radioCard(3, 'MATUTINO')}
          ${radioCard(3, 'VESPERTINO')}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // TOP 5 GRUPOS Y MATERIAS PROBLEMÁTICAS
  // ═══════════════════════════════════════════════════════════════

  function _renderTopProblemas(d) {
    const gruposHtml = d.topGruposExtra.length === 0
      ? `<div style="font-size:11px;color:#9ca3af;padding:14px;text-align:center;">Sin alumnos en extra</div>`
      : d.topGruposExtra.map((g, i) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;">
            <div>
              <span style="color:#94a3b8;font-size:11px;font-weight:600;margin-right:6px;">${i + 1}.</span>
              <strong style="font-size:13px;">${Utils.sanitize(g.groupName)}</strong>
              <span style="font-size:10px;color:#64748b;margin-left:4px;">${Utils.sanitize(g.turno)}</span>
            </div>
            <span style="background:#dc2626;color:#fff;padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;">${g.count}</span>
          </div>
        `).join('');

    const materiasHtml = d.topMateriasReprob.length === 0
      ? `<div style="font-size:11px;color:#9ca3af;padding:14px;text-align:center;">Sin reprobados</div>`
      : d.topMateriasReprob.map((m, i) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;">
            <div style="flex:1;min-width:0;">
              <span style="color:#94a3b8;font-size:11px;font-weight:600;margin-right:6px;">${i + 1}.</span>
              <strong style="font-size:13px;">${Utils.sanitize(m.subjectName)}</strong>
            </div>
            <span style="background:#dc2626;color:#fff;padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;">${m.count}</span>
          </div>
        `).join('');

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:16px;">
        <div class="card" style="padding:0;overflow:hidden;">
          <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
            <h3 style="font-size:13px;font-weight:800;color:#1e293b;margin:0;">🏫 Top 5 grupos con más alumnos en EXTRA</h3>
          </div>
          ${gruposHtml}
        </div>
        <div class="card" style="padding:0;overflow:hidden;">
          <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
            <h3 style="font-size:13px;font-weight:800;color:#1e293b;margin:0;">📚 Top 5 materias con más reprobadas</h3>
          </div>
          ${materiasHtml}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCESOS DIRECTOS
  // ═══════════════════════════════════════════════════════════════

  function _renderAccesosDirectos() {
    const accesos = [
      { mod: 'extraordinarios', icon: 'gavel', label: 'Extraordinarios', color: '#dc2626' },
      { mod: 'at-risk', icon: 'warning', label: 'Alumnos en Riesgo', color: '#f59e0b' },
      { mod: 'indicadores', icon: 'insights', label: 'Indicadores', color: '#6366f1' },
      { mod: 'concentrado', icon: 'grid_on', label: 'Concentrado', color: '#0891b2' },
      { mod: 'boletas', icon: 'description', label: 'Preboletas', color: '#16a34a' },
      { mod: 'honor-roll', icon: 'emoji_events', label: 'Cuadros de Honor', color: '#a855f7' },
    ];
    const btnsHtml = accesos.map(a => `
      <button data-action="nav" data-module="${a.mod}"
        style="background:#fff;border:2px solid #e5e7eb;border-radius:10px;padding:14px 12px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;transition:all .15s;font-family:inherit;"
        onmouseover="this.style.borderColor='${a.color}';this.style.transform='translateY(-1px)';"
        onmouseout="this.style.borderColor='#e5e7eb';this.style.transform='translateY(0)';">
        <span class="material-icons-round" style="font-size:28px;color:${a.color};">${a.icon}</span>
        <span style="font-size:11px;font-weight:600;color:#475569;text-align:center;">${a.label}</span>
      </button>
    `).join('');

    return `
      <div class="card" style="padding:18px 22px;">
        <h2 style="font-size:14px;font-weight:800;color:#1e293b;margin:0 0 12px;">🔗 Accesos directos</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;">
          ${btnsHtml}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // MODAL DRILL-DOWN — lista de alumnos por categoría
  // ═══════════════════════════════════════════════════════════════

  // Estado de filtros del modal de drill-down
  let _modalFilters = { tipo: '', turno: '', grado: '', grupo: '', materia: '', search: '' };

  function _showAlumnosModal(tipo) {
    if (!_cachedData) return;
    let lista, titulo, descripcion, color;
    if (tipo === 'extra') {
      lista = _cachedData.detalleEnExtra;
      titulo = `🚨 Alumnos en Extraordinario (${lista.length})`;
      descripcion = 'Confirmados — irán a examen extraordinario porque tienen ≥2 parciales reprobados, o prom <6 con los 3 parciales capturados.';
      color = '#dc2626';
    } else if (tipo === 'riesgo') {
      lista = _cachedData.detalleEnRiesgo;
      titulo = `⚠️ Alumnos en Riesgo (${lista.length})`;
      descripcion = 'Recuperables — tienen 1 parcial reprobado pero todavía pueden salvarse capturando el siguiente parcial.';
      color = '#f59e0b';
    } else if (tipo === 'irregulares') {
      lista = _cachedData.detalleIrregulares;
      titulo = `📉 Alumnos Irregulares (${lista.length})`;
      descripcion = 'Con AL MENOS 1 materia reprobada. Incluye los de Extra (rojo), Riesgo (naranja) y otros con solo una baja.';
      color = '#a855f7';
    } else { return; }

    // Reset filtros del modal al tipo actual
    _modalFilters = { tipo, turno: '', grado: '', grupo: '', materia: '', search: '' };

    // Extraer valores únicos para los selectores
    const turnos = [...new Set(lista.map(a => a.turno).filter(Boolean))].sort();
    const grados = [...new Set(lista.map(a => String(a.grado || '')).filter(Boolean))].sort();
    const grupos = [...new Set(lista.map(a => a.groupName).filter(Boolean))].sort();
    const materiasSet = new Set();
    for (const a of lista) {
      (a.materias || []).forEach(m => materiasSet.add(m));
    }
    const materias = [...materiasSet].sort();

    const turnoOpts = turnos.map(t => `<option value="${Utils.sanitize(t)}">${Utils.sanitize(t)}</option>`).join('');
    const gradoOpts = grados.map(g => `<option value="${Utils.sanitize(g)}">${Utils.sanitize(g)}°</option>`).join('');
    const grupoOpts = grupos.map(g => `<option value="${Utils.sanitize(g)}">${Utils.sanitize(g)}</option>`).join('');
    const materiaOpts = materias.map(m => `<option value="${Utils.sanitize(m)}">${Utils.sanitize(m)}</option>`).join('');

    const filtrosHtml = `
      <div id="modal-filters" style="background:#f8fafc;padding:10px 12px;border-radius:6px;margin-bottom:10px;border:1px solid #e2e8f0;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;align-items:end;">
          <div>
            <label style="display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">🔍 Buscar</label>
            <input id="modal-search" type="text" placeholder="Nombre del alumno…"
              style="width:100%;padding:6px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;outline:none;">
          </div>
          <div>
            <label style="display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Turno</label>
            <select id="modal-turno" style="width:100%;padding:6px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;background:#fff;">
              <option value="">Todos</option>${turnoOpts}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Grado</label>
            <select id="modal-grado" style="width:100%;padding:6px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;background:#fff;">
              <option value="">Todos</option>${gradoOpts}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Grupo</label>
            <select id="modal-grupo" style="width:100%;padding:6px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;background:#fff;">
              <option value="">Todos</option>${grupoOpts}
            </select>
          </div>
          ${materias.length > 0 ? `
          <div>
            <label style="display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:3px;">Materia</label>
            <select id="modal-materia" style="width:100%;padding:6px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;background:#fff;">
              <option value="">Todas</option>${materiaOpts}
            </select>
          </div>` : ''}
          <div>
            <button id="modal-clear-filters" style="padding:6px 10px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-size:11px;color:#475569;cursor:pointer;font-weight:600;">✕ Limpiar</button>
          </div>
        </div>
      </div>
    `;

    const exportBtn = `<button data-action="export-list-csv" data-tipo="${tipo}"
      style="padding:6px 12px;background:#0891b2;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">
      📥 Exportar CSV
    </button>`;

    Modal.open(titulo, `
      <div style="font-size:12px;color:#64748b;background:#f8fafc;padding:8px 12px;border-radius:6px;border-left:3px solid ${color};margin-bottom:10px;">
        ${descripcion}
      </div>
      ${filtrosHtml}
      <div id="modal-stats" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div id="modal-count" style="font-size:13px;color:#64748b;">Mostrando ${lista.length} alumno${lista.length === 1 ? '' : 's'}</div>
        ${exportBtn}
      </div>
      <div style="max-height:55vh;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead style="background:#1e40af;color:#fff;position:sticky;top:0;z-index:1;">
            <tr>
              <th style="padding:9px 6px;font-size:10px;width:30px;">#</th>
              <th style="padding:9px 12px;text-align:left;font-size:10px;">ALUMNO</th>
              <th style="padding:9px 6px;font-size:10px;">GRUPO</th>
              <th style="padding:9px 6px;font-size:10px;">TURNO</th>
              <th style="padding:9px 10px;text-align:left;font-size:10px;">${tipo === 'irregulares' ? 'DETALLE' : 'MATERIAS'}</th>
            </tr>
          </thead>
          <tbody id="modal-tbody">${_renderModalRows(lista, tipo)}</tbody>
        </table>
      </div>
    `, `<button class="btn btn-outline" data-action="close-modal">Cerrar</button>`);

    // Bind filtros del modal
    _bindModalFilters(tipo, lista);
  }

  function _renderModalRows(lista, tipo) {
    // Filtrar según _modalFilters
    let filtered = lista.slice();
    if (_modalFilters.turno) filtered = filtered.filter(a => a.turno === _modalFilters.turno);
    if (_modalFilters.grado) filtered = filtered.filter(a => String(a.grado || '') === _modalFilters.grado);
    if (_modalFilters.grupo) filtered = filtered.filter(a => a.groupName === _modalFilters.grupo);
    if (_modalFilters.materia) filtered = filtered.filter(a => (a.materias || []).includes(_modalFilters.materia));
    if (_modalFilters.search) {
      const q = _modalFilters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      filtered = filtered.filter(a => {
        const n = (a.studentName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return n.includes(q);
      });
    }

    // Ordenar por #materias/reprobadas desc, luego nombre
    filtered.sort((a, b) => {
      const ka = (a.materias?.length || a.reprobadas || 0);
      const kb = (b.materias?.length || b.reprobadas || 0);
      if (ka !== kb) return kb - ka;
      return (a.studentName || '').localeCompare(b.studentName || '');
    });

    if (filtered.length === 0) {
      return `<tr><td colspan="5" style="padding:24px;text-align:center;color:#9ca3af;">Sin alumnos con estos filtros 🔍</td></tr>`;
    }

    return filtered.map((a, i) => {
      const materiasDisplay = a.materias && a.materias.length > 0
        ? a.materias.map(m => `<span style="background:#fef2f2;color:#991b1b;padding:1px 6px;border-radius:4px;font-size:10px;margin-right:2px;display:inline-block;margin-bottom:2px;">${Utils.sanitize(m)}</span>`).join('')
        : (a.reprobadas ? `<span style="font-size:11px;color:#64748b;">${a.reprobadas} reprobada${a.reprobadas === 1 ? '' : 's'}</span>` : '—');
      const tag = a._esExtra
        ? '<span style="background:#dc2626;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;margin-left:4px;">EXTRA</span>'
        : a._esRiesgo
          ? '<span style="background:#f59e0b;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;margin-left:4px;">RIESGO</span>'
          : '';
      return `<tr>
        <td style="padding:8px 6px;text-align:center;color:#9ca3af;font-size:11px;">${i + 1}</td>
        <td style="padding:8px 12px;font-weight:600;font-size:13px;">${Utils.sanitize(a.studentName)}${tag}</td>
        <td style="padding:8px 6px;text-align:center;font-size:12px;">${Utils.sanitize(a.groupName)}</td>
        <td style="padding:8px 6px;text-align:center;font-size:11px;color:#64748b;">${Utils.sanitize(a.turno)}</td>
        <td style="padding:8px 10px;">${materiasDisplay}</td>
      </tr>`;
    }).join('');
  }

  function _bindModalFilters(tipo, lista) {
    // Recalcula las opciones del selector de Materia según los OTROS filtros.
    // REGLA: muestra TODAS las materias OFICIALES del semestre del grado/grupo
    // seleccionado, incluso si tienen 0 alumnos en riesgo/extra. Las que sí
    // tienen alumnos muestran el conteo "(N alumnos)". Las que no, "(0)".
    // Así las orientadoras ven la lista completa del semestre sin sorprenderse
    // porque una materia falte.
    const refreshMateriaOptions = () => {
      const sel = document.getElementById('modal-materia');
      if (!sel) return;
      // Filtrar la lista por todo MENOS materia
      let subset = lista.slice();
      if (_modalFilters.turno) subset = subset.filter(a => a.turno === _modalFilters.turno);
      if (_modalFilters.grado) subset = subset.filter(a => String(a.grado || '') === _modalFilters.grado);
      if (_modalFilters.grupo) subset = subset.filter(a => a.groupName === _modalFilters.grupo);
      if (_modalFilters.search) {
        const q = _modalFilters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        subset = subset.filter(a => (a.studentName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
      }
      // Conteo por materia en el subset filtrado
      const counts = {};
      for (const a of subset) (a.materias || []).forEach(m => { counts[m] = (counts[m] || 0) + 1; });

      // Determinar el grado implícito (filtro grado explícito o grupo seleccionado)
      let gradoImplicito = _modalFilters.grado;
      if (!gradoImplicito && _modalFilters.grupo) {
        const match = _modalFilters.grupo.match(/^(\d)/);
        if (match) gradoImplicito = match[1];
      }

      // Materias OFICIALES del grado (catálogo SEP / K.SUBJECT_ORDER)
      // Si no hay grado implícito, usar TODAS las materias de los 3 grados.
      const materiasOficiales = new Set();
      const gradosACubrir = gradoImplicito
        ? [Number(gradoImplicito)]
        : [1, 2, 3];
      for (const g of gradosACubrir) {
        const lista = (K.SUBJECT_ORDER || {})[g] || [];
        for (const nom of lista) {
          // Convertir al formato display (K.getUACNombre normaliza con acentos)
          materiasOficiales.add(K.getUACNombre(nom));
        }
      }
      // Agregar también las que aparecen en el subset pero no están en el catálogo
      // (caso edge: materia legacy o nombre con variación).
      Object.keys(counts).forEach(m => materiasOficiales.add(m));

      // Ordenar: oficial primero (siguiendo orden SEP del grado), luego extras
      let opts = [...materiasOficiales];
      if (gradosACubrir.length === 1) {
        const sepOrder = ((K.SUBJECT_ORDER || {})[gradosACubrir[0]] || []).map(n => K.getUACNombre(n));
        opts.sort((a, b) => {
          const ia = sepOrder.indexOf(a);
          const ib = sepOrder.indexOf(b);
          if (ia === -1 && ib === -1) return a.localeCompare(b);
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
      } else {
        opts.sort();
      }

      // Si la materia previamente seleccionada ya no está, reset
      if (_modalFilters.materia && !opts.includes(_modalFilters.materia)) {
        _modalFilters.materia = '';
      }
      const current = _modalFilters.materia;
      // Cada opción muestra conteo: con 0 cuando no aparece en subset
      sel.innerHTML = `<option value="">Todas (${Object.values(counts).reduce((a, b) => a + b, 0)})</option>` +
        opts.map(m => {
          const n = counts[m] || 0;
          const label = n > 0 ? `${m} (${n})` : `${m} (0)`;
          return `<option value="${Utils.sanitize(m)}"${m === current ? ' selected' : ''}${n === 0 ? ' style="color:#94a3b8;"' : ''}>${Utils.sanitize(label)}</option>`;
        }).join('');
    };

    // Recalcula opciones del selector de Grupo según turno/grado seleccionados.
    const refreshGrupoOptions = () => {
      const sel = document.getElementById('modal-grupo');
      if (!sel) return;
      let subset = lista.slice();
      if (_modalFilters.turno) subset = subset.filter(a => a.turno === _modalFilters.turno);
      if (_modalFilters.grado) subset = subset.filter(a => String(a.grado || '') === _modalFilters.grado);
      const gs = new Set();
      for (const a of subset) if (a.groupName) gs.add(a.groupName);
      const opts = [...gs].sort();
      if (_modalFilters.grupo && !opts.includes(_modalFilters.grupo)) {
        _modalFilters.grupo = '';
      }
      const current = _modalFilters.grupo;
      sel.innerHTML = `<option value="">Todos</option>` +
        opts.map(g => `<option value="${Utils.sanitize(g)}"${g === current ? ' selected' : ''}>${Utils.sanitize(g)}</option>`).join('');
    };

    const reRender = () => {
      // Primero recalcular opciones dependientes (grupo → materia)
      refreshGrupoOptions();
      refreshMateriaOptions();
      const tbody = document.getElementById('modal-tbody');
      const count = document.getElementById('modal-count');
      if (!tbody) return;
      tbody.innerHTML = _renderModalRows(lista, tipo);
      const visible = (tbody.querySelectorAll('tr').length || 0);
      const hasResults = !tbody.innerHTML.includes('Sin alumnos con estos filtros');
      if (count) {
        const total = lista.length;
        const filtered = hasResults ? visible : 0;
        const hasFilters = !!(_modalFilters.turno || _modalFilters.grado || _modalFilters.grupo || _modalFilters.materia || _modalFilters.search);
        count.innerHTML = hasFilters
          ? `<strong>${filtered}</strong> de ${total} alumno${total === 1 ? '' : 's'} (con filtros)`
          : `Mostrando ${total} alumno${total === 1 ? '' : 's'}`;
      }
    };

    let searchTimer = null;
    document.getElementById('modal-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const v = e.target.value;
      searchTimer = setTimeout(() => { _modalFilters.search = v; reRender(); }, 200);
    });
    document.getElementById('modal-turno')?.addEventListener('change', (e) => { _modalFilters.turno = e.target.value; reRender(); });
    document.getElementById('modal-grado')?.addEventListener('change', (e) => { _modalFilters.grado = e.target.value; reRender(); });
    document.getElementById('modal-grupo')?.addEventListener('change', (e) => { _modalFilters.grupo = e.target.value; reRender(); });
    document.getElementById('modal-materia')?.addEventListener('change', (e) => { _modalFilters.materia = e.target.value; reRender(); });
    document.getElementById('modal-clear-filters')?.addEventListener('click', () => {
      _modalFilters = { tipo, turno: '', grado: '', grupo: '', materia: '', search: '' };
      ['modal-search', 'modal-turno', 'modal-grado', 'modal-grupo', 'modal-materia'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      reRender();
    });

    // BUGFIX (v7.68): el botón "Exportar CSV" vive DENTRO del modal, que se
    // renderiza fuera de moduleContainer. El listener delegado en _bindEvents
    // NO lo captura. Solución: bindeo directo aquí, después de abrir el modal.
    const exportBtn = document.querySelector('[data-action="export-list-csv"][data-tipo="' + tipo + '"]');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => _exportListaCsv(tipo));
    }
  }

  function _exportListaCsv(tipo) {
    if (!_cachedData) return;
    const fullList = tipo === 'extra' ? _cachedData.detalleEnExtra
      : tipo === 'riesgo' ? _cachedData.detalleEnRiesgo
      : _cachedData.detalleIrregulares;
    if (!fullList || fullList.length === 0) { Toast.show('Lista vacía', 'info'); return; }

    // Aplicar mismos filtros que la tabla visible
    let lista = fullList.slice();
    if (_modalFilters.tipo === tipo) {
      if (_modalFilters.turno) lista = lista.filter(a => a.turno === _modalFilters.turno);
      if (_modalFilters.grado) lista = lista.filter(a => String(a.grado || '') === _modalFilters.grado);
      if (_modalFilters.grupo) lista = lista.filter(a => a.groupName === _modalFilters.grupo);
      if (_modalFilters.materia) lista = lista.filter(a => (a.materias || []).includes(_modalFilters.materia));
      if (_modalFilters.search) {
        const q = _modalFilters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        lista = lista.filter(a => {
          const n = (a.studentName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return n.includes(q);
        });
      }
    }
    if (lista.length === 0) { Toast.show('Sin alumnos con los filtros aplicados', 'info'); return; }

    const esc = s => {
      const str = String(s == null ? '' : s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    };
    const lines = ['#,ALUMNO,GRUPO,TURNO,GRADO,MATERIAS_REPROBADAS,#REPROBADAS,CATEGORIA'];
    lista.forEach((a, i) => {
      const materias = (a.materias || []).join('; ');
      const cat = a._esExtra ? 'EXTRA' : a._esRiesgo ? 'RIESGO' : tipo.toUpperCase();
      lines.push([
        i + 1, esc(a.studentName), esc(a.groupName), esc(a.turno),
        esc(a.grado), esc(materias), a.reprobadas || (a.materias?.length || 0), esc(cat),
      ].join(','));
    });
    const csv = '﻿' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `dashboard-${tipo}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    Toast.show(`✓ CSV descargado: ${lista.length} alumnos`, 'success');
  }

  // ═══════════════════════════════════════════════════════════════
  // BANNER DE CORRECCIONES (admin/subdirector/directivo)
  // ═══════════════════════════════════════════════════════════════

  async function _loadCorrectionsBanner() {
    const root = document.getElementById('dash-corrections-banner');
    if (!root || !window.db) return;
    try {
      const snap = await window.db.collection('gradeCorrections').where('status', '==', 'pending').limit(50).get();
      const folios = new Set();
      snap.forEach(d => folios.add(d.data().folio));
      if (folios.size === 0) { root.innerHTML = ''; return; }
      root.innerHTML = `<div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px 14px;font-size:13px;color:#78350f;border-radius:6px;cursor:pointer;" data-action="nav" data-module="grade-corrections">
        <strong>📋 ${folios.size} folio${folios.size === 1 ? '' : 's'} de corrección pendiente${folios.size === 1 ? '' : 's'}</strong> · click para revisar.
      </div>`;
    } catch (_) { /* silencioso */ }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════

  function _bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'show-list') {
        _showAlumnosModal(btn.dataset.tipo);
      } else if (action === 'set-partial') {
        _selectedPartial = btn.dataset.partial;
        render();
      } else if (action === 'nav') {
        const mod = btn.dataset.module;
        if (mod && typeof Router !== 'undefined') Router.navigate(mod);
      } else if (action === 'goto-f1') {
        const target = btn.dataset.target || 'my-f1';
        if (typeof Router !== 'undefined') Router.navigate(target);
      } else if (action === 'export-list-csv') {
        _exportListaCsv(btn.dataset.tipo);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // VISTA MAESTRO (sin cambios respecto al original)
  // ═══════════════════════════════════════════════════════════════

  async function renderTeacherDashboard(container) {
    try {
      const userName = Utils.displayName(App.currentUser?.displayName || App.currentUser?.email || '');

      let assignments = [];
      // v8.09: STRICT — el dashboard del maestro debe mostrar SOLO sus
      // asignaciones, sin importar roles aditivos (auditor/presidente_academia).
      try { assignments = await Store.getOwnAssignments(); } catch (e) {
        console.warn('No se pudieron cargar asignaciones:', e);
      }

      if (!assignments.length) {
        container.innerHTML = UI.moduleContainer(`
          <div class="card" style="text-align:center;padding:40px;">
            <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Bienvenido(a), ${Utils.sanitize(userName)}</h1>
            <p style="color:#4a5568;">Aún no tienes asignaciones registradas. Contacta a la administración si crees que es un error.</p>
          </div>`);
        return;
      }

      const turnoOrd = { 'MATUTINO': 1, 'VESPERTINO': 2, 'AMBOS': 3 };
      assignments.sort((a, b) =>
        (turnoOrd[(a.turno || '').toUpperCase()] || 9) - (turnoOrd[(b.turno || '').toUpperCase()] || 9)
        || (Number(a.grado) || 9) - (Number(b.grado) || 9)
        || (a.groupName || '').localeCompare(b.groupName || '')
      );

      const groupIds = [...new Set(assignments.map(a => a.groupId))];
      // v8.27: cargar también teacherHours por cada asignación para mostrar
      // panel "Lo que te falta" + chip en cada tarjeta. Las horas se guardan
      // replicadas en P1/P2/P3 (v8.15), así que basta leer una.
      const MESES_SEM = ['febrero','marzo','abril','mayo','junio','julio'];
      const [studentsAll, gradesAll, horasChecks] = await Promise.all([
        Store.getStudentsByGroups(groupIds),
        Store.getGradesByGroups(groupIds),
        Promise.all(assignments.map(async (a) => {
          const docId = `${a.groupId}_${a.subjectId}_P1`;
          try {
            const doc = await db.collection('teacherHours').doc(docId).get();
            const data = doc.exists ? doc.data() : {};
            const missing = MESES_SEM.filter(m =>
              data[m] === undefined || data[m] === null || data[m] === '' || isNaN(Number(data[m]))
            );
            return { asgId: a.id, missing };
          } catch (_) {
            return { asgId: a.id, missing: MESES_SEM.slice() };
          }
        })),
      ]);
      const horasByAsg = new Map(horasChecks.map(h => [h.asgId, h.missing]));
      const activeStudents = studentsAll.filter(s => {
        const e = (s.estatus || '').toString().toUpperCase().trim();
        return e === '' || e === 'ACTIVO';
      });

      const studentsByGroup = new Map();
      for (const s of activeStudents) {
        if (!studentsByGroup.has(s.groupId)) studentsByGroup.set(s.groupId, []);
        studentsByGroup.get(s.groupId).push(s);
      }
      const gradesByGroupSubj = new Map();
      for (const g of gradesAll) {
        const k = g.groupId + '|' + g.subjectId;
        if (!gradesByGroupSubj.has(k)) gradesByGroupSubj.set(k, []);
        gradesByGroupSubj.get(k).push(g);
      }

      const asgStats = assignments.map(a => {
        const groupStu = studentsByGroup.get(a.groupId) || [];
        const myGrades = gradesByGroupSubj.get(a.groupId + '|' + a.subjectId) || [];
        const byPartial = { P1: [], P2: [], P3: [] };
        myGrades.forEach(g => { if (byPartial[g.partial]) byPartial[g.partial].push(g); });
        const calc = (arr) => {
          const valid = arr.map(g => Number(g.cal)).filter(n => !isNaN(n));
          if (!valid.length) return { count: 0, avg: 0, aprob: 0, reprob: 0 };
          const sum = valid.reduce((s, x) => s + x, 0);
          const avg = sum / valid.length;
          const aprob = valid.filter(n => n >= K.THRESHOLDS.PASS_GRADE).length;
          return { count: valid.length, avg, aprob, reprob: valid.length - aprob };
        };
        const stats = { P1: calc(byPartial.P1), P2: calc(byPartial.P2), P3: calc(byPartial.P3) };
        const total = groupStu.length;
        const latest = stats.P3.count > 0 ? stats.P3 : (stats.P2.count > 0 ? stats.P2 : stats.P1);
        return { asg: a, total, stats, latest };
      });

      const totalAlumnos = asgStats.reduce((s, x) => s + x.total, 0);
      const totalAprob = asgStats.reduce((s, x) => s + x.latest.aprob, 0);
      const totalReprob = asgStats.reduce((s, x) => s + x.latest.reprob, 0);
      const totalCaptured = totalAprob + totalReprob;
      const aprobPct = totalCaptured > 0 ? ((totalAprob / totalCaptured) * 100).toFixed(1) + '%' : '—';
      const allLastAvgs = asgStats.flatMap(x => x.latest.count > 0 ? [x.latest.avg] : []);
      const promedioGlobal = allLastAvgs.length > 0
        ? (allLastAvgs.reduce((s, x) => s + x, 0) / allLastAvgs.length).toFixed(2)
        : '—';

      const fmt = (n) => n === 0 || n ? n.toFixed(2) : '—';

      const asgCardsHtml = asgStats.map(x => {
        const a = x.asg;
        const turnoClass = (a.turno || '').toUpperCase() === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';
        const lastAvg = x.latest.count > 0 ? x.latest.avg : null;
        const avgColor = lastAvg === null ? '#888' : (lastAvg >= 8 ? '#16a34a' : lastAvg >= 7 ? '#d97706' : '#dc2626');
        const capturePct = x.total > 0 ? Math.round((x.latest.count / x.total) * 100) : 0;
        const asgIdAttr = Utils.sanitize(a.id || '');
        const groupIdAttr = Utils.sanitize(a.groupId || '');
        const subjectIdAttr = Utils.sanitize(a.subjectId || '');
        // v8.27: chip rojo si faltan horas semestrales en esta materia.
        // Tarjetas con horas faltantes resaltan con borde rojo para ojo rápido.
        const horasFaltan = (horasByAsg.get(a.id) || []).length > 0;
        const alumnosFaltan = Math.max(0, x.total - x.latest.count);
        const borderColor = (horasFaltan || alumnosFaltan > 0) ? '#dc2626' : '#3182ce';
        const horasChip = horasFaltan
          ? `<span style="background:#fecaca;color:#991b1b;font-size:10px;font-weight:800;padding:2px 7px;border-radius:8px;white-space:nowrap;">⏱ Faltan horas</span>`
          : '';
        const alumnosChip = alumnosFaltan > 0
          ? `<span style="background:#fef3c7;color:#78350f;font-size:10px;font-weight:800;padding:2px 7px;border-radius:8px;white-space:nowrap;">📝 ${alumnosFaltan} sin calificar</span>`
          : '';
        return `
          <div class="card" style="padding:14px;border-left:4px solid ${borderColor};cursor:pointer;transition:all 0.15s;"
               onclick="GradesModule.setPendingOpen({assignmentId:'${asgIdAttr}',groupId:'${groupIdAttr}',subjectId:'${subjectIdAttr}'});Router.navigate('my-grades')">
            <div style="font-weight:700;font-size:14px;color:#1a202c;margin-bottom:4px;">
              ${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId))}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">
              <span class="badge ${turnoClass}" style="font-size:10px;">${Utils.sanitize(a.turno || '')}</span>
              <span class="badge" style="font-size:10px;background:#edf2f7;color:#2d3748;">Grupo ${Utils.sanitize(a.groupName || '')}</span>
              ${horasChip}
              ${alumnosChip}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px;">
              <div><div style="color:#666;font-weight:600;">Alumnos</div><div style="font-size:18px;font-weight:700;">${x.total}</div></div>
              <div><div style="color:#666;font-weight:600;">Promedio</div><div style="font-size:18px;font-weight:700;color:${avgColor};">${fmt(lastAvg)}</div></div>
              <div><div style="color:#666;font-weight:600;">Captura</div><div style="font-size:18px;font-weight:700;color:${capturePct === 100 ? '#16a34a' : '#d97706'};">${capturePct}%</div></div>
            </div>
          </div>`;
      }).join('');

      // v8.27: panel "Lo que te falta" — arriba del todo cuando hay pendientes.
      // Resumen ejecutivo de horas + alumnos faltantes para entrega oficial.
      const asgsConHorasFaltantes = horasChecks.filter(h => h.missing.length > 0).length;
      const asgsConAlumnosPendientes = asgStats.filter(x => x.latest.count < x.total && x.total > 0).length;
      const totalAlumnosPendientes = asgStats.reduce((s, x) => s + Math.max(0, x.total - x.latest.count), 0);
      const tieneAlgoPendiente = asgsConHorasFaltantes > 0 || asgsConAlumnosPendientes > 0;
      const panelLoQueFalta = tieneAlgoPendiente ? `
        <div class="card" style="background:linear-gradient(135deg,#fee2e2 0%,#fef2f2 100%);border-left:5px solid #dc2626;margin-bottom:16px;padding:18px 22px;box-shadow:0 4px 12px rgba(220,38,38,0.15);">
          <div style="display:flex;align-items:center;gap:8px;font-weight:800;color:#991b1b;font-size:16px;margin-bottom:10px;">
            <span class="material-icons-round" style="font-size:24px;">priority_high</span>
            Para entregar tus listas a Dirección te falta:
          </div>
          <ul style="margin:0 0 12px 26px;padding:0;color:#7f1d1d;font-size:13.5px;line-height:1.75;">
            ${asgsConHorasFaltantes > 0 ? `<li>⏱ Horas del semestre en <strong>${asgsConHorasFaltantes}</strong> ${asgsConHorasFaltantes === 1 ? 'materia' : 'materias'}.</li>` : ''}
            ${asgsConAlumnosPendientes > 0 ? `<li>📝 Calificaciones de <strong>${totalAlumnosPendientes}</strong> ${totalAlumnosPendientes === 1 ? 'alumno' : 'alumnos'} en <strong>${asgsConAlumnosPendientes}</strong> ${asgsConAlumnosPendientes === 1 ? 'lista' : 'listas'}.</li>` : ''}
          </ul>
          <p style="margin:0;font-size:12.5px;color:#991b1b;line-height:1.5;">
            Las tarjetas con borde <span style="color:#dc2626;font-weight:800;">rojo</span> abajo te marcan lo pendiente.
            <strong>Sin esto no podrás imprimir la lista oficial para entregar firmada en Dirección.</strong>
          </p>
        </div>
      ` : '';

      // v8.38: modal automático bloqueante si tienen horas pendientes.
      // Sale una vez por sesión por maestro (no acosa cada refresh).
      // Si capturan, el modal ya no vuelve a salir ese día.
      const showMandatoryHoursAlert = asgsConHorasFaltantes > 0;
      const HOURS_ALERT_KEY = 'epo67_horas_alert_shown_' + (App.currentUser?.uid || 'anon');
      const lastShownDay = (() => {
        try { return localStorage.getItem(HOURS_ALERT_KEY) || ''; } catch (_) { return ''; }
      })();
      const todayDay = new Date().toISOString().slice(0,10);
      const yaSeMostroHoy = lastShownDay === todayDay;

      container.innerHTML = UI.moduleContainer(`
        <div class="card" style="background:linear-gradient(135deg,#3182ce 0%,#2b6cb0 100%);color:#fff;padding:24px;margin-bottom:16px;">
          <h1 style="font-size:22px;font-weight:700;margin:0 0 4px;color:#fff;">Bienvenido(a), ${Utils.sanitize(userName)}</h1>
          <p style="margin:0;font-size:13px;opacity:0.92;">${assignments.length} materia(s) · ${groupIds.length} grupo(s) · ${totalAlumnos} alumnos</p>
        </div>

        ${_renderF1Banner(App.currentUser?.role)}

        ${panelLoQueFalta}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px;">
          <div class="card" style="padding:14px 16px;background:#eff6ff;border-left:4px solid #3182ce;">
            <div style="font-size:11px;color:#1e40af;font-weight:700;">Tu promedio</div>
            <div style="font-size:28px;font-weight:800;color:#1e40af;">${promedioGlobal}</div>
            <div style="font-size:11px;color:#475569;">Parcial más reciente</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#f0fdf4;border-left:4px solid #16a34a;">
            <div style="font-size:11px;color:#166534;font-weight:700;">Aprobación</div>
            <div style="font-size:28px;font-weight:800;color:#166534;">${aprobPct}</div>
            <div style="font-size:11px;color:#475569;">${totalAprob} de ${totalCaptured}</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#fef2f2;border-left:4px solid #dc2626;">
            <div style="font-size:11px;color:#991b1b;font-weight:700;">Reprobados</div>
            <div style="font-size:28px;font-weight:800;color:#991b1b;">${totalReprob}</div>
            <div style="font-size:11px;color:#475569;">Suma de tus listas</div>
          </div>
          <div class="card" style="padding:14px 16px;background:#fffbeb;border-left:4px solid #d97706;">
            <div style="font-size:11px;color:#78350f;font-weight:700;">Pendientes</div>
            <div style="font-size:28px;font-weight:800;color:#78350f;">${totalAlumnos - totalCaptured}</div>
            <div style="font-size:11px;color:#475569;">Sin captura aún</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="Router.navigate('my-grades')" style="padding:10px 16px;font-weight:600;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">edit_note</span> Capturar Calificaciones
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('my-lists')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">list_alt</span> Mis Listas
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('my-f1')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">grid_on</span> Concentrado F1
            </button>
            <button class="btn btn-outline" onclick="Router.navigate('extraordinarios')" style="padding:10px 16px;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">gavel</span> Extraordinarios
            </button>
          </div>
        </div>

        <div class="card">
          <h2 style="font-size:16px;font-weight:700;margin:0 0 12px;color:#1a202c;">
            <span class="material-icons-round" style="vertical-align:middle;font-size:20px;color:#3182ce;">analytics</span>
            Tus grupos y materias
          </h2>
          <p style="font-size:12px;color:#64748b;margin:0 0 12px;">Toca una tarjeta para capturar calificaciones de ese grupo.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
            ${asgCardsHtml}
          </div>
        </div>
      `);

      // v8.38: modal automático bloqueante para maestros con horas pendientes.
      // Aparece UNA vez al día por maestro (no acosa). Lista cada materia con
      // botón clickeable que lleva directo al editor para capturar.
      // Forma más eficiente de avisar sin que admin envíe WhatsApps uno a uno.
      if (showMandatoryHoursAlert && !yaSeMostroHoy && typeof Modal !== 'undefined' && Modal.open) {
        const asgsConHoras = asgStats.filter(x => (horasByAsg.get(x.asg.id) || []).length > 0);
        const listaMatItems = asgsConHoras.map(x => `
          <li style="margin:8px 0;line-height:1.5;">
            <button data-asg-pick="${Utils.sanitize(x.asg.id)}"
                    data-group-pick="${Utils.sanitize(x.asg.groupId)}"
                    data-subject-pick="${Utils.sanitize(x.asg.subjectId)}"
                    style="background:#fff;border:2px solid #dc2626;color:#991b1b;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <span>${Utils.sanitize(x.asg.groupName)} · ${Utils.sanitize(K.getUACNombre(x.asg.subjectName || x.asg.subjectId))}</span>
              <span style="font-size:11px;background:#fef3c7;color:#78350f;padding:2px 6px;border-radius:4px;font-weight:600;">⏱ Capturar →</span>
            </button>
          </li>
        `).join('');

        const body = `
          <div style="font-size:14px;color:#1e293b;line-height:1.6;">
            <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:14px 18px;border-radius:6px;margin-bottom:14px;">
              <strong style="color:#991b1b;font-size:15px;">Te faltan capturar las HORAS DEL SEMESTRE</strong> en <strong>${asgsConHorasFaltantes}</strong> de tus materias.
              <br><br>
              <strong>Sin estas horas NO podrás imprimir tu lista oficial</strong> para entregar firmada en Dirección, y el sistema no podrá calcular bien quién está en riesgo por inasistencias.
            </div>

            <h3 style="font-size:14px;font-weight:700;margin:14px 0 6px;color:#1e293b;">
              Toca cada materia para ir directo al editor:
            </h3>
            <ul style="list-style:none;margin:0;padding:0;">
              ${listaMatItems}
            </ul>

            <div style="background:#eff6ff;border-left:3px solid #3182ce;padding:10px 14px;margin-top:14px;font-size:12.5px;color:#1e3a8a;border-radius:4px;">
              💡 <strong>Sólo capturas las horas UNA VEZ por materia</strong> (Feb a Jul) y aplican a los 3 parciales automáticamente. Es muy rápido.
            </div>
          </div>`;

        const footer = `
          <button class="btn btn-outline" id="hours-alert-later" data-action="modal-cancel">Capturar después</button>
          <button class="btn" id="hours-alert-go" style="background:#dc2626;color:#fff;border:none;font-weight:700;">
            Voy a capturar ahora
          </button>`;

        Modal.open('⏱ Tienes horas pendientes', body, footer);

        // Marcar como mostrado hoy para no acosar
        try { localStorage.setItem(HOURS_ALERT_KEY, todayDay); } catch (_) {}

        const mb = document.getElementById('modalBody');
        if (mb) {
          // Click en cualquier tarjeta de materia → abrir editor en esa materia
          mb.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-asg-pick]');
            if (!btn) return;
            const asgId = btn.dataset.asgPick;
            const groupId = btn.dataset.groupPick;
            const subjectId = btn.dataset.subjectPick;
            if (typeof GradesModule !== 'undefined' && GradesModule.setPendingOpen) {
              GradesModule.setPendingOpen({ assignmentId: asgId, groupId, subjectId });
            }
            Modal.close();
            Router.navigate('my-grades');
          });
        }
        const mf = document.getElementById('modalFooter');
        if (mf) {
          mf.addEventListener('click', (e) => {
            if (e.target.closest('#hours-alert-later') || e.target.closest('[data-action="modal-cancel"]')) {
              Modal.close();
              return;
            }
            if (e.target.closest('#hours-alert-go')) {
              // Abrir directamente la primera materia con horas pendientes
              const first = asgsConHoras[0];
              if (first && typeof GradesModule !== 'undefined' && GradesModule.setPendingOpen) {
                GradesModule.setPendingOpen({
                  assignmentId: first.asg.id,
                  groupId: first.asg.groupId,
                  subjectId: first.asg.subjectId,
                });
              }
              Modal.close();
              Router.navigate('my-grades');
            }
          });
        }
      }
    } catch (error) {
      console.error('Error en dashboard de maestro:', error);
      container.innerHTML = UI.moduleContainer(`
        <div class="card">
          <h1 style="font-size:20px;font-weight:700;">Bienvenido(a)</h1>
          <p style="color:#4a5568;">Hubo un error cargando tus estadísticas.</p>
        </div>`);
    }
  }

  return { render };
})();

if (typeof Router !== 'undefined' && Router.modules) {
  Router.modules['dashboard'] = () => DashboardModule.render();
}
