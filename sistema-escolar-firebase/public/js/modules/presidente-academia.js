/**
 * PRESIDENTE DE ACADEMIA — Sistema Escolar EPO 67
 *
 * Rol nuevo: 'presidente_academia'. Un docente que coordina una academia
 * (área académica: Matemáticas, Comunicación, Ciencias Sociales, etc.).
 * Su responsabilidad: monitorear los indicadores de SUS materias en SUS
 * grados (no de toda la escuela).
 *
 * Asignación de la academia:
 *   El admin asigna a este usuario los IDs de materias y grados que coordina
 *   editando su documento en `users/{uid}`:
 *     {
 *       academiaNombre: 'Academia de Matemáticas',
 *       academiaSubjects: ['math1', 'math2', 'math3'],  // subject IDs
 *       academiaGrados:   [1, 2, 3]                      // 1°, 2°, 3°
 *     }
 *
 * Vista:
 *   - Dashboard: KPIs por materia bajo su academia (alumnos atendidos,
 *     promedio, % reprobación, top profes)
 *   - Botón para descargar Excel comparativo de su academia
 *   - Filtros: parcial / turno / grado
 */

const PresidenteAcademiaModule = (() => {
  let _data = null;
  let _filters = { parcial: 'P2', turno: '', grado: '' };

  // ─── Helpers ─────────────────────────────────────────────────
  function _getMyConfig() {
    const u = App.currentUser || {};
    const subjects = Array.isArray(u.academiaSubjects) ? u.academiaSubjects : [];
    const grados = Array.isArray(u.academiaGrados) ? u.academiaGrados.map(Number) : [];
    const nombre = u.academiaNombre || 'Mi Academia';
    return { subjects, grados, nombre };
  }

  // ─── Render: Dashboard de presidente de academia ────────────
  async function renderDashboard(container) {
    const cfg = _getMyConfig();
    container.innerHTML = UI.loadingState('Cargando datos de tu academia…');

    if (cfg.subjects.length === 0) {
      container.innerHTML = UI.moduleContainer([
        UI.pageHeader(cfg.nombre, 'Indicadores académicos de tus materias'),
        `<div class="alert alert-warning" style="margin:14px 0;">
          <strong>⚠ No tienes materias asignadas a tu academia todavía.</strong><br>
          Pide al administrador que configure tu academia editando tu cuenta de usuario
          (campos <code>academiaSubjects</code> y <code>academiaGrados</code>).
        </div>`
      ].join(''));
      return;
    }

    try {
      const [groupsAll, subjectsAll, partials, assignments] = await Promise.all([
        Store.getGroups(), Store.getSubjects(), Store.getPartials(), Store.getAssignments(),
      ]);

      const subjectSet = new Set(cfg.subjects);
      const gradoSet = cfg.grados.length > 0 ? new Set(cfg.grados) : null;

      // Grupos en scope (todos los grupos de los grados que cubro)
      const scopedGroups = gradoSet
        ? groupsAll.filter(g => gradoSet.has(Number(g.grado)))
        : groupsAll;

      // Subjects de mi academia (resueltos a objetos)
      const subjectsMine = subjectsAll.filter(s => subjectSet.has(s.id));

      // Assignments donde la materia pertenece a mi academia
      const myAssignments = assignments.filter(a =>
        subjectSet.has(a.subjectId) &&
        scopedGroups.some(g => g.id === a.groupId)
      );

      // Alumnos de los grupos en scope
      const groupIds = scopedGroups.map(g => g.id);
      const students = groupIds.length > 0
        ? await Store.getStudentsByGroups(groupIds)
        : [];
      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      // Grades de los grupos en scope (filtramos por subject después)
      let allGrades = [];
      try {
        allGrades = groupIds.length > 0 ? await Store.getGradesByGroups(groupIds) : [];
      } catch (e) { console.warn('grades load deferred', e); }

      _data = {
        cfg, groupsAll, scopedGroups, subjectsMine, students, activeStudents, allGrades,
        partials, myAssignments,
      };

      _renderFull();
    } catch (e) {
      console.error('Error renderizando academia:', e);
      container.innerHTML = UI.errorState('Error al cargar tu academia: ' + (e.message || ''));
    }
  }

  function _renderFull() {
    const container = document.getElementById('moduleContainer');
    if (!container || !_data) return;

    const { cfg, scopedGroups, subjectsMine, activeStudents, allGrades, partials, myAssignments } = _data;

    // Filtros del parcial / turno / grado
    let grades = allGrades.filter(g => cfg.subjects.includes(g.subjectId));
    if (_filters.parcial && _filters.parcial !== 'all') {
      grades = grades.filter(g => g.partial === _filters.parcial);
    }

    let filteredGroups = [...scopedGroups];
    if (_filters.turno) filteredGroups = filteredGroups.filter(g => g.turno === _filters.turno);
    if (_filters.grado) filteredGroups = filteredGroups.filter(g => Number(g.grado) === Number(_filters.grado));
    const filteredGroupIds = new Set(filteredGroups.map(g => g.id));

    const studentsFiltered = activeStudents.filter(s => filteredGroupIds.has(s.groupId));
    const studentIds = new Set(studentsFiltered.map(s => s.id));
    grades = grades.filter(g => studentIds.has(g.studentId) && filteredGroupIds.has(g.groupId));

    // ═══ MÉTRICAS ═══
    // - PROMEDIO: promedio de TODAS las calificaciones capturadas (valor numérico)
    // - ALUMNOS APROBADOS = alumnos SIN materias reprobadas en mi academia
    // - ALUMNOS IRREGULARES = alumnos CON ≥1 materia reprobada en mi academia
    // - INCIDENCIAS = total de calificaciones < 6 (sumatoria, magnitud)
    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const cals = grades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
    const promedio = cals.length ? (cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : '—';
    const incidencias = cals.filter(c => c < passGrade).length;

    // Métricas alumno-céntricas
    const failsByStudent = {};
    const evaluatedSet = new Set();
    grades.forEach(g => {
      const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
      if (isNaN(c)) return;
      evaluatedSet.add(g.studentId);
      if (c < passGrade) failsByStudent[g.studentId] = (failsByStudent[g.studentId] || 0) + 1;
    });
    const totalEval = evaluatedSet.size;
    const irregulares = Object.keys(failsByStudent).length;
    const aprobados = totalEval - irregulares;
    const pctIrreg = totalEval > 0 ? ((irregulares * 100) / totalEval).toFixed(1) : '—';
    const pctAprob = totalEval > 0 ? ((aprobados * 100) / totalEval).toFixed(1) : '—';

    const numAlumnos = studentsFiltered.length;
    const numGrupos = filteredGroups.length;
    const numMaterias = subjectsMine.length;

    const META_PROM = 8.3, META_IRREG = 14;
    const promCumple = promedio !== '—' && parseFloat(promedio) >= META_PROM;
    const irregCumple = pctIrreg !== '—' && parseFloat(pctIrreg) <= META_IRREG;

    // ─── Tabla por materia ───
    // En cada materia, contamos ALUMNOS aprobados/irregulares (no calificaciones).
    // Aprobado = alumno que NO reprobó esa materia · Irregular = la reprobó.
    const matRows = subjectsMine.map(subj => {
      const subjGrades = grades.filter(g => g.subjectId === subj.id);
      const subjCals = subjGrades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
      const subjProm = subjCals.length ? (subjCals.reduce((a, b) => a + b, 0) / subjCals.length).toFixed(2) : '—';
      const subjEvalStudents = new Set();
      let subjReprobStudents = 0;
      subjGrades.forEach(g => {
        const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
        if (isNaN(c)) return;
        subjEvalStudents.add(g.studentId);
        if (c < passGrade) subjReprobStudents++;
      });
      const subjTotalEval = subjEvalStudents.size;
      const subjAprob = subjTotalEval - subjReprobStudents;
      const subjPctIrr = subjTotalEval > 0 ? ((subjReprobStudents * 100) / subjTotalEval).toFixed(1) : '—';
      const promBg = subjProm !== '—' && parseFloat(subjProm) < META_PROM ? 'background:#fee2e2;' : '';
      const irrBg = subjPctIrr !== '—' && parseFloat(subjPctIrr) > META_IRREG ? 'background:#fee2e2;' : '';
      return `<tr>
        <td>${Utils.sanitize(subj.nombre || subj.id)}</td>
        <td style="text-align:center;">${subjTotalEval}</td>
        <td style="text-align:center;font-weight:700;${promBg}">${subjProm}</td>
        <td style="text-align:center;color:#16a34a;font-weight:600;">${subjTotalEval > 0 ? subjAprob : '—'}</td>
        <td style="text-align:center;font-weight:700;${irrBg}">${subjTotalEval > 0 ? `${subjReprobStudents} (${subjPctIrr}%)` : '—'}</td>
      </tr>`;
    }).join('');

    // ─── Tabla por grupo ───
    // Mismo principio: alumnos aprobados / irregulares en mi academia dentro del grupo.
    const grpRows = filteredGroups.map(grp => {
      const grpStudents = studentsFiltered.filter(s => s.groupId === grp.id);
      const grpGrades = grades.filter(g => g.groupId === grp.id);
      const grpCals = grpGrades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
      const grpProm = grpCals.length ? (grpCals.reduce((a, b) => a + b, 0) / grpCals.length).toFixed(2) : '—';
      const grpFails = {};
      const grpEvalSet = new Set();
      grpGrades.forEach(g => {
        const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
        if (isNaN(c)) return;
        grpEvalSet.add(g.studentId);
        if (c < passGrade) grpFails[g.studentId] = (grpFails[g.studentId] || 0) + 1;
      });
      const grpTotalEval = grpEvalSet.size;
      const grpIrreg = Object.keys(grpFails).length;
      const grpAprob = grpTotalEval - grpIrreg;
      const grpPctIrr = grpTotalEval > 0 ? ((grpIrreg * 100) / grpTotalEval).toFixed(1) : '—';
      const promBg = grpProm !== '—' && parseFloat(grpProm) < META_PROM ? 'background:#fee2e2;' : '';
      const irrBg = grpPctIrr !== '—' && parseFloat(grpPctIrr) > META_IRREG ? 'background:#fee2e2;' : '';
      return `<tr>
        <td><strong>${Utils.sanitize(grp.nombre)}</strong></td>
        <td style="text-align:center;">${grp.turno}</td>
        <td style="text-align:center;">${grpStudents.length}</td>
        <td style="text-align:center;font-weight:700;${promBg}">${grpProm}</td>
        <td style="text-align:center;color:#16a34a;font-weight:600;">${grpTotalEval > 0 ? grpAprob : '—'}</td>
        <td style="text-align:center;font-weight:700;${irrBg}">${grpTotalEval > 0 ? `${grpIrreg} (${grpPctIrr}%)` : '—'}</td>
      </tr>`;
    }).join('');

    container.innerHTML = UI.moduleContainer([
      UI.pageHeader(
        cfg.nombre,
        `Indicadores académicos de tus ${numMaterias} materia${numMaterias === 1 ? '' : 's'}, en ${numGrupos} grupos`
      ),
      _renderFilters(),
      _renderKPIs({ numAlumnos, numGrupos, numMaterias, promedio, totalEval, aprobados, irregulares, pctAprob, pctIrreg, incidencias, promCumple, irregCumple }),
      _renderDownloads(),
      `<div class="card" style="margin-top:18px;">
        <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;">📚 Por Materia</h3>
          <span style="font-size:12px;color:#6b7280;">${subjectsMine.length} materias</span>
        </div>
        <p style="margin:0;padding:0 18px 6px;font-size:11px;color:#6b7280;">
          <strong>Aprobados / Irregulares:</strong> alumnos sin / con reprobada en esa materia. NO son sumatorias — un mismo alumno aparece UNA vez.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead style="background:#f9fafb;"><tr>
              <th style="text-align:left;padding:10px 14px;">Materia</th>
              <th style="text-align:center;padding:10px 14px;">Alumnos eval.</th>
              <th style="text-align:center;padding:10px 14px;">Promedio</th>
              <th style="text-align:center;padding:10px 14px;">Aprobados</th>
              <th style="text-align:center;padding:10px 14px;">Irregulares</th>
            </tr></thead>
            <tbody>${matRows || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#9ca3af;">Sin datos en este parcial.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`,
      `<div class="card" style="margin-top:14px;">
        <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;">👥 Por Grupo</h3>
          <span style="font-size:12px;color:#6b7280;">${filteredGroups.length} grupos</span>
        </div>
        <p style="margin:0;padding:0 18px 6px;font-size:11px;color:#6b7280;">
          <strong>Irregulares:</strong> alumnos del grupo con ≥1 reprobada en CUALQUIER materia de mi academia.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead style="background:#f9fafb;"><tr>
              <th style="text-align:left;padding:10px 14px;">Grupo</th>
              <th style="text-align:center;padding:10px 14px;">Turno</th>
              <th style="text-align:center;padding:10px 14px;">Alumnos</th>
              <th style="text-align:center;padding:10px 14px;">Promedio</th>
              <th style="text-align:center;padding:10px 14px;">Aprobados</th>
              <th style="text-align:center;padding:10px 14px;">Irregulares</th>
            </tr></thead>
            <tbody>${grpRows || '<tr><td colspan="6" style="padding:18px;text-align:center;color:#9ca3af;">No hay grupos en este filtro.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`,
    ].join(''));

    _bindEvents();
  }

  function _renderFilters() {
    const cfg = _data?.cfg || { grados: [] };
    return `<div class="chip-filter-bar" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap;">
      <div class="chip-filter-row" style="margin:0;display:flex;align-items:center;gap:8px;">
        <span class="chip-filter-label" style="font-weight:600;">Parcial:</span>
        <div class="chip-group">
          ${K.PARCIALES.map(p => `<button class="chip${p.id === _filters.parcial ? ' active' : ''}" data-filter="parcial" data-value="${p.id}">${p.nombre}</button>`).join('')}
          <button class="chip${_filters.parcial === 'ACUM' ? ' active' : ''}" data-filter="parcial" data-value="ACUM">📊 Acumulado</button>
        </div>
      </div>
      <div class="chip-filter-row" style="margin:0;display:flex;align-items:center;gap:8px;">
        <span class="chip-filter-label" style="font-weight:600;">Turno:</span>
        <div class="chip-group">
          <button class="chip${!_filters.turno ? ' active' : ''}" data-filter="turno" data-value="">Todos</button>
          <button class="chip${_filters.turno === 'MATUTINO' ? ' active' : ''}" data-filter="turno" data-value="MATUTINO">Matutino</button>
          <button class="chip${_filters.turno === 'VESPERTINO' ? ' active' : ''}" data-filter="turno" data-value="VESPERTINO">Vespertino</button>
        </div>
      </div>
      ${cfg.grados.length > 1 ? `
      <div class="chip-filter-row" style="margin:0;display:flex;align-items:center;gap:8px;">
        <span class="chip-filter-label" style="font-weight:600;">Grado:</span>
        <div class="chip-group">
          <button class="chip${!_filters.grado ? ' active' : ''}" data-filter="grado" data-value="">Todos</button>
          ${cfg.grados.map(g => `<button class="chip${Number(_filters.grado) === g ? ' active' : ''}" data-filter="grado" data-value="${g}">${g}°</button>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  }

  function _renderKPIs(k) {
    const card = (icon, label, value, sub, ok) => {
      const color = ok === true ? '#16a34a' : ok === false ? '#dc2626' : '#0891b2';
      return `<div class="card" style="padding:18px 20px;border-left:5px solid ${color};">
        <div style="font-size:28px;">${icon}</div>
        <div style="font-size:32px;font-weight:900;color:${color};">${value}</div>
        <div style="font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;">${label}</div>
        ${sub ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${sub}</div>` : ''}
      </div>`;
    };
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:18px;">
      ${card('👥', 'Alumnos', k.numAlumnos, `en ${k.numGrupos} grupos`)}
      ${card('📚', 'Materias', k.numMaterias, 'de tu academia')}
      ${card('📈', 'Promedio', k.promedio, 'meta ≥ 8.3', k.promCumple)}
      ${card('✅', 'Alumnos Aprobados', k.totalEval > 0 ? `${k.aprobados}` : '—', k.totalEval > 0 ? `de ${k.totalEval} (${k.pctAprob}%) sin reprobadas` : 'sin datos')}
      ${card('🚨', 'Alumnos Irregulares', k.totalEval > 0 ? `${k.irregulares}` : '—', k.totalEval > 0 ? `${k.pctIrreg}% · meta ≤ 14%` : 'sin datos', k.irregCumple)}
      ${card('📊', 'Incidencias', k.incidencias, 'total de calif. < 6 (sumatoria)')}
    </div>`;
  }

  function _renderDownloads() {
    return `<div class="card" style="padding:14px 18px;margin-bottom:14px;background:linear-gradient(135deg,#ecfeff 0%,#cffafe 100%);border-left:5px solid #0891b2;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <strong style="color:#155e75;font-size:15px;">📥 Descargar estadísticas de tu academia</strong>
          <div style="font-size:13px;color:#0e7490;margin-top:2px;">Genera un Excel con el detalle de tus materias y grupos.</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" data-action="download-excel" style="background:#0891b2;border-color:#0891b2;">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:6px;">grid_on</span>Excel de mi academia
          </button>
        </div>
      </div>
    </div>`;
  }

  function _bindEvents() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    // Chips de filtro
    container.querySelectorAll('.chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        const f = chip.dataset.filter;
        const v = chip.dataset.value;
        _filters[f] = v;
        _renderFull();
      });
    });

    // Botón de Excel
    const downloadBtn = container.querySelector('[data-action="download-excel"]');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => _downloadExcel());
    }
  }

  // ─── Excel download ──────────────────────────────────────────
  async function _downloadExcel() {
    if (!_data) return;
    Toast.show('Generando Excel…', 'info');
    try {
      await Lib.exceljs();
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      const { cfg, scopedGroups, subjectsMine, activeStudents, allGrades } = _data;

      // Hoja 1: Resumen general
      const ws1 = wb.addWorksheet('Resumen');
      ws1.columns = [
        { header: 'Concepto', key: 'k', width: 30 },
        { header: 'Valor', key: 'v', width: 30 },
      ];
      ws1.addRow({ k: 'Academia', v: cfg.nombre });
      ws1.addRow({ k: 'Materias', v: subjectsMine.map(s => s.nombre || s.id).join(' · ') });
      ws1.addRow({ k: 'Grados', v: cfg.grados.join('°, ') + '°' });
      ws1.addRow({ k: 'Grupos en scope', v: scopedGroups.length });
      ws1.addRow({ k: 'Alumnos activos', v: activeStudents.length });
      ws1.addRow({ k: 'Filtro parcial', v: _filters.parcial });
      ws1.addRow({ k: 'Filtro turno', v: _filters.turno || 'Todos' });
      ws1.addRow({ k: 'Generado', v: new Date().toLocaleString('es-MX') });
      ws1.getRow(1).font = { bold: true };

      // Hoja 2: Por Materia × Grupo
      const ws2 = wb.addWorksheet('Materia × Grupo');
      ws2.columns = [
        { header: 'Materia', key: 'mat', width: 32 },
        { header: 'Grupo', key: 'grp', width: 14 },
        { header: 'Turno', key: 'turno', width: 12 },
        { header: 'Alumnos', key: 'n', width: 10 },
        { header: 'Calificaciones', key: 'cnt', width: 14 },
        { header: 'Promedio', key: 'prom', width: 12 },
        { header: 'Reprobados', key: 'rep', width: 12 },
        { header: '% Reprob.', key: 'pctRep', width: 12 },
      ];
      const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
      const parcialFiltro = _filters.parcial;

      for (const subj of subjectsMine) {
        for (const grp of scopedGroups) {
          let gs = allGrades.filter(g => g.subjectId === subj.id && g.groupId === grp.id);
          if (parcialFiltro && parcialFiltro !== 'ACUM') {
            gs = gs.filter(g => g.partial === parcialFiltro);
          }
          if (gs.length === 0) continue;
          const grpStuds = activeStudents.filter(s => s.groupId === grp.id);
          const cals = gs.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
          const prom = cals.length ? cals.reduce((a, b) => a + b, 0) / cals.length : null;
          const rep = cals.filter(c => c < passGrade).length;
          const pctRep = cals.length ? (rep * 100) / cals.length : 0;
          ws2.addRow({
            mat: subj.nombre || subj.id,
            grp: grp.nombre,
            turno: grp.turno,
            n: grpStuds.length,
            cnt: cals.length,
            prom: prom != null ? +prom.toFixed(2) : '',
            rep,
            pctRep: +pctRep.toFixed(1),
          });
        }
      }
      ws2.getRow(1).font = { bold: true };

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Academia_${cfg.nombre.replace(/\s+/g, '_')}_${_filters.parcial}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      Toast.show('✓ Excel descargado', 'success');
    } catch (e) {
      console.error('Excel error:', e);
      Toast.show('Error generando Excel: ' + (e.message || ''), 'error');
    }
  }

  // ─── Punto de entrada vía Router ─────────────────────────────
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (container) return renderDashboard(container);
  }

  return { render, renderDashboard };
})();

Router.modules['mi-academia'] = () => PresidenteAcademiaModule.render();
