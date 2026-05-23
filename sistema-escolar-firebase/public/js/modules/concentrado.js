/**
 * CONCENTRADO DE CALIFICACIONES MODULE
 * Vista matricial: alumnos x materias para un grupo y parcial.
 * Tabla dinamica con columnas segun las materias asignadas.
 */

const ConcentradoModule = (() => {

  // ─── STATE ───
  let allStudents = [];
  let allGroups = [];
  let allSubjects = [];
  let allAssignments = [];
  let allGrades = [];
  let lastMatrix = null;
  let orientadorGroupIds = null; // null = no filter (admin), array = orientador filter

  // ─── RENDER ───
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
    const gradoOptions = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba Grado</option>`).join('');
    const parcialOptions = K.PARCIALES.map(p =>
      `<option value="${p.id}" ${p.id === 'P1' ? 'selected' : ''}>${p.nombre}</option>`
    ).join('');

    const role = App.currentUser?.role;
    const isAdmin = role === 'admin' || role === 'subdirector' || role === 'directivo';
    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Concentrado de Calificaciones</h1>
            <p class="module-subtitle">${isAdmin
              ? 'Elige el turno y descarga el concentrado oficial.'
              : 'Descarga el concentrado de tus grupos.'}</p>
          </div>
        </div>

        <!-- SELECTOR DE PARCIAL (lo único que pregunta) -->
        <div class="chip-filter-bar" id="conc-chip-filters" style="padding:12px 16px;margin-bottom:18px;">
          <div class="chip-filter-row" style="margin-bottom:0;">
            <span class="chip-filter-label">¿Qué parcial?</span>
            <div class="chip-group">
              ${K.PARCIALES.map(p => `<button class="chip chip-parcial ${p.id === 'P2' ? 'active' : ''}" data-filter="parcial" data-value="${p.id}">${p.nombre}</button>`).join('')}
            </div>
          </div>
          <!-- Filtros ocultos para compatibilidad con código viejo -->
          <span style="display:none;">
            <button class="chip" data-filter="turno" data-value=""></button>
            <button class="chip" data-filter="grado" data-value=""></button>
            <button class="chip" data-filter="grupo" data-value=""></button>
            <button class="chip" data-filter="modo" data-value="todos"></button>
          </span>
        </div>

        ${isAdmin ? `
        <!-- ADMIN: 2 TARJETAS POR TURNO -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:18px;">
          <div style="background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);border-radius:16px;padding:22px;color:#fff;box-shadow:0 8px 20px rgba(220,38,38,0.25);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
              <span style="font-size:42px;">☀</span>
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.85;">TURNO</div>
                <div style="font-size:26px;font-weight:900;line-height:1;">MATUTINO</div>
              </div>
            </div>
            <button class="btn-conc-action" data-action="conc-zip-orientadores" data-turno="MATUTINO" style="background:#fff;color:#b91c1c;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);width:100%;">
              <span class="material-icons-round" style="font-size:24px;">folder_zip</span>
              <div style="flex:1;">
                <div>Descargar ZIP por orientador</div>
                <div style="font-size:11px;font-weight:500;opacity:0.7;">1 Excel por cada orientador del turno</div>
              </div>
            </button>
          </div>
          <div style="background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);border-radius:16px;padding:22px;color:#fff;box-shadow:0 8px 20px rgba(124,58,237,0.25);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
              <span style="font-size:42px;">🌙</span>
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.85;">TURNO</div>
                <div style="font-size:26px;font-weight:900;line-height:1;">VESPERTINO</div>
              </div>
            </div>
            <button class="btn-conc-action" data-action="conc-zip-orientadores" data-turno="VESPERTINO" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);width:100%;">
              <span class="material-icons-round" style="font-size:24px;">folder_zip</span>
              <div style="flex:1;">
                <div>Descargar ZIP por orientador</div>
                <div style="font-size:11px;font-weight:500;opacity:0.7;">1 Excel por cada orientador del turno</div>
              </div>
            </button>
          </div>
        </div>
        ` : `
        <!-- ORIENTADOR: 1 TARJETA con sus grupos -->
        <div style="background:linear-gradient(135deg,#059669 0%,#047857 100%);border-radius:16px;padding:24px;color:#fff;box-shadow:0 8px 20px rgba(5,150,105,0.25);">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
            <span style="font-size:42px;">📋</span>
            <div>
              <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.85;">CONCENTRADO</div>
              <div style="font-size:24px;font-weight:900;line-height:1.1;" id="conc-mi-resumen">Mis grupos asignados</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn-conc-action" data-action="conc-mio-excel" style="background:#fff;color:#047857;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
              <span class="material-icons-round" style="font-size:24px;">grid_on</span>
              <div style="flex:1;">
                <div>Descargar Excel oficial</div>
                <div style="font-size:11px;font-weight:500;opacity:0.7;">Concentrado + Seguimiento + Casos Especiales + Cuadro de Honor</div>
              </div>
            </button>
            <button class="btn-conc-action" data-action="conc-mio-pdf" style="background:#fff;color:#047857;border:none;border-radius:10px;padding:14px 16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;font-family:inherit;text-align:left;box-shadow:0 3px 6px rgba(0,0,0,0.15);">
              <span class="material-icons-round" style="font-size:24px;">print</span>
              <div style="flex:1;">
                <div>Ver PDF para imprimir</div>
                <div style="font-size:11px;font-weight:500;opacity:0.7;">Versión imprimible (Cmd+P para guardar PDF)</div>
              </div>
            </button>
          </div>
        </div>
        `}

        <div id="conc-results" style="margin-top:18px;"></div>
      </div>
    `;

    await loadData();
    bindEvents(container);
    // Actualizar resumen de "Mis grupos" para orientador
    if (!isAdmin) {
      const resumen = document.getElementById('conc-mi-resumen');
      if (resumen && allGroups.length > 0) {
        const nombres = allGroups.map(g => g.nombre).join(', ');
        resumen.textContent = `Mis grupos: ${nombres}`;
      }
    }
  }

  // ─── HELPERS DE CHIP FILTERS ───
  function _chipValue(filter) {
    const bar = document.getElementById('conc-chip-filters');
    if (!bar) return '';
    const active = bar.querySelector(`.chip[data-filter="${filter}"].active`);
    return active ? (active.dataset.value || '') : '';
  }
  function _setActiveChip(filter, value) {
    const bar = document.getElementById('conc-chip-filters');
    if (!bar) return;
    bar.querySelectorAll(`.chip[data-filter="${filter}"]`).forEach(c => {
      c.classList.toggle('active', (c.dataset.value || '') === (value || ''));
    });
  }

  // ─── DATA LOADING ───
  async function loadData() {
    try {
      const [students, groups, subjects, assignments, oriGroups] = await Promise.all([
        Store.getStudents(),
        Store.getGroups(),
        Store.getSubjects(),
        Store.getAssignments(),
        Store.getOrientadorGroups()
      ]);
      orientadorGroupIds = oriGroups; // null for admin, array for orientador

      // ═══════════════════════════════════════════════════════════
      // FILTRADO POR ROL (mismo criterio que indicadores.js):
      // - Admin / Subdirector / Directivo: ven TODO (oriGroups === null)
      // - Orientador / Orientador-docente: ven TODO el TURNO donde son
      //   orientadores. No solo los grupos específicos asignados —
      //   tienen que coordinar el turno completo (boletas, concentrado,
      //   indicadores, etc.).
      // ═══════════════════════════════════════════════════════════
      let filteredGroups;
      if (oriGroups === null) {
        filteredGroups = groups; // admin: sin filtro
      } else if (oriGroups.length === 0) {
        filteredGroups = []; // orientador sin grupos asignados
      } else {
        // Detectar el/los turno(s) donde la persona es orientador
        const oriGroupSet = new Set(oriGroups);
        const turnosDelOrientador = new Set(
          groups.filter(g => oriGroupSet.has(g.id)).map(g => g.turno).filter(Boolean)
        );
        // Mostrar TODOS los grupos de esos turnos
        filteredGroups = groups.filter(g => turnosDelOrientador.has(g.turno));
      }

      const allowedIds = new Set(filteredGroups.map(g => g.id));
      allStudents = students.filter(s =>
        s.estatus === 'ACTIVO' && (oriGroups === null || allowedIds.has(s.groupId))
      );
      allGroups = filteredGroups;
      allSubjects = subjects;
      allAssignments = assignments;
      // Load grades per-group (much more efficient than loading ALL grades)
      const groupIds = allGroups.map(g => g.id);
      allGrades = await Store.getGradesByGroups(groupIds);
    } catch (e) {
      console.error('Error cargando datos de concentrado:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─── CHIP DE GRUPO (filtrado por turno+grado) ───
  function updateGroupOptions() {
    const chips = document.getElementById('conc-grupo-chips');
    if (!chips) return;
    const turno = _chipValue('turno');
    const grado = _chipValue('grado');
    let filtered = [...allGroups];
    if (turno) filtered = filtered.filter(g => g.turno === turno);
    if (grado) filtered = filtered.filter(g => String(g.grado) === String(grado));
    const nombres = [...new Set(filtered.map(g => g.nombre || g.grupo))].filter(Boolean).sort();
    const current = _chipValue('grupo');
    chips.innerHTML = nombres.map(n =>
      `<button class="chip ${current === n ? 'active' : ''}" data-filter="grupo" data-value="${n}">${n}</button>`
    ).join('');
    // Si modo es 'uno' y solo hay 1 grupo en el filtro, pre-seleccionarlo
    if (_chipValue('modo') === 'uno' && nombres.length === 1 && !current) {
      _setActiveChip('grupo', nombres[0]);
    }
  }

  // ─── GENERATE MATRIX ───
  function generate() {
    const resultsDiv = document.getElementById('conc-results');
    if (!resultsDiv) return;

    const turno = _chipValue("turno");
    const grado = _chipValue("grado");
    const grupo = _chipValue("grupo");
    const parcial = _chipValue("parcial") || 'P1';

    if (!grupo) {
      Toast.show('Selecciona un grupo para generar el concentrado', 'warning');
      return;
    }

    resultsDiv.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Generando concentrado...</p></div>`;

    try {
      // Find matching group(s) by name, optionally filtered by turno/grado
      let matchingGroups = allGroups.filter(g => (g.nombre || g.grupo) === grupo);
      if (turno) matchingGroups = matchingGroups.filter(g => g.turno === turno);
      if (grado) matchingGroups = matchingGroups.filter(g => String(g.grado) === String(grado));

      const groupIds = new Set(matchingGroups.map(g => g.id));

      // Students in the group
      let groupStudents = allStudents.filter(s => s.grupo === grupo);
      if (turno) groupStudents = groupStudents.filter(s => s.turno === turno);
      if (grado) groupStudents = groupStudents.filter(s => String(s.grado) === String(grado));
      groupStudents.sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      if (groupStudents.length === 0) {
        resultsDiv.innerHTML = `
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">search_off</span>
            <p class="empty-state-text">No hay alumnos en el grupo seleccionado.</p>
          </div>`;
        lastMatrix = null;
        return;
      }

      // Determine subjects for this group
      // Try assignments first, fallback to subjects by grado
      const groupAssignments = allAssignments.filter(a =>
        groupIds.has(a.groupId) || a.groupName === grupo
      );

      let subjectList = [];
      if (groupAssignments.length > 0) {
        const subjectMap = {};
        groupAssignments.forEach(a => {
          if (a.subjectId && !subjectMap[a.subjectId]) {
            subjectMap[a.subjectId] = { id: a.subjectId, nombre: a.subjectName || a.subjectId };
          }
        });
        subjectList = Object.values(subjectMap);
      } else {
        // Fallback: all subjects for the grado
        const targetGrado = grado || (groupStudents[0]?.grado ? String(groupStudents[0].grado) : null);
        if (targetGrado) {
          subjectList = allSubjects.filter(s => String(s.grado) === String(targetGrado));
        } else {
          subjectList = [...allSubjects];
        }
      }

      subjectList.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      if (subjectList.length === 0) {
        resultsDiv.innerHTML = `
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">menu_book</span>
            <p class="empty-state-text">No se encontraron materias para este grupo.</p>
          </div>`;
        lastMatrix = null;
        return;
      }

      // Build grade lookup: studentId -> subjectId -> value
      const studentIds = new Set(groupStudents.map(s => s.id));
      const gradesForGroup = allGrades.filter(g =>
        studentIds.has(g.studentId) && g.partial === parcial
      );

      const gradeMap = {};
      gradesForGroup.forEach(g => {
        // Use cal (new format) or value (legacy)
        const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : null);
        if (cal === null || cal === undefined) return;
        if (!gradeMap[g.studentId]) gradeMap[g.studentId] = {};
        gradeMap[g.studentId][g.subjectId] = cal;
      });

      // Build matrix data
      const passGrade = K.THRESHOLDS.PASS_GRADE;
      const matrix = [];
      const colSums = new Array(subjectList.length).fill(0);
      const colCounts = new Array(subjectList.length).fill(0);
      // Por materia: aprobados (cal >= passGrade) y reprobados (cal < passGrade).
      // Usado para mostrar PROMEDIO / ALUMNOS APROBADOS / % APROB / ALUMNOS REPROB / % REPROB
      // al pie de cada columna.
      const colAprob = new Array(subjectList.length).fill(0);
      const colReprob = new Array(subjectList.length).fill(0);

      groupStudents.forEach((student, idx) => {
        const row = {
          num: idx + 1,
          name: student.nombreCompleto || '',
          grades: [],
          average: 0
        };

        let total = 0;
        let count = 0;

        subjectList.forEach((sub, si) => {
          const val = gradeMap[student.id]?.[sub.id];
          row.grades.push(val !== undefined ? val : null);
          if (val !== undefined && val !== null) {
            total += val;
            count++;
            colSums[si] += val;
            colCounts[si]++;
            if (Number(val) >= passGrade) colAprob[si]++;
            else colReprob[si]++;
          }
        });

        row.average = count > 0 ? Math.round((total / count) * 100) / 100 : 0;
        row.gradeCount = count;
        matrix.push(row);
      });

      // Column averages
      const colAverages = subjectList.map((_, si) =>
        colCounts[si] > 0 ? Math.round((colSums[si] / colCounts[si]) * 100) / 100 : 0
      );
      const colPctAprob = subjectList.map((_, si) =>
        colCounts[si] > 0 ? Math.round((colAprob[si] * 1000 / colCounts[si])) / 10 : 0
      );
      const colPctReprob = subjectList.map((_, si) =>
        colCounts[si] > 0 ? Math.round((colReprob[si] * 1000 / colCounts[si])) / 10 : 0
      );
      const overallAvg = matrix.length > 0
        ? Math.round((matrix.filter(r => r.gradeCount > 0).reduce((s, r) => s + r.average, 0) / Math.max(matrix.filter(r => r.gradeCount > 0).length, 1)) * 100) / 100
        : 0;

      // Save for export/print
      lastMatrix = { grupo, parcial, turno, grado, subjectList, matrix, colAverages, overallAvg };

      // Stats
      const evaluated = matrix.filter(r => r.gradeCount > 0);
      const approved = evaluated.filter(r => r.average >= passGrade).length;
      const failed = evaluated.filter(r => r.average < passGrade).length;
      const best = evaluated.length > 0
        ? evaluated.reduce((a, b) => a.average >= b.average ? a : b)
        : null;
      const worst = evaluated.length > 0
        ? evaluated.reduce((a, b) => a.average <= b.average ? a : b)
        : null;

      // ─── RENDER TABLE ───
      const parcialLabel = K.PARCIALES.find(p => p.id === parcial)?.nombre || parcial;

      let html = `<h2 class="section-title">Concentrado - ${Utils.sanitize(grupo)} - ${Utils.sanitize(parcialLabel)}</h2>`;

      // Matrix table
      html += `<div class="card"><div class="table-container" style="overflow-x:auto;">`;
      html += `<table class="table-light">`;

      // Header
      html += `<thead><tr><th style="text-align:center;width:35px;">#</th><th>Nombre del Alumno</th>`;
      subjectList.forEach(sub => {
        html += `<th style="text-align:center;font-size:10px;" title="${Utils.sanitize(K.getUACNombre(sub.nombre))}">${Utils.sanitize(abbreviate(sub.nombre))}</th>`;
      });
      html += `<th style="text-align:center;font-weight:700;">PROM.</th></tr></thead>`;

      // Body — clean colored text, no badges
      html += '<tbody>';
      matrix.forEach(row => {
        html += `<tr><td style="text-align:center;" class="text-muted">${row.num}</td>`;
        html += `<td class="font-semibold" style="font-size:12px;white-space:nowrap;">${Utils.sanitize(row.name)}</td>`;
        row.grades.forEach(val => {
          if (val !== null) {
            html += `<td style="text-align:center;${gradeStyle(val)}">${val}</td>`;
          } else {
            html += `<td style="text-align:center;color:var(--color-text-lighter);">-</td>`;
          }
        });
        if (row.gradeCount > 0) {
          html += `<td style="text-align:center;font-weight:700;${gradeStyle(row.average)}">${row.average.toFixed(1)}</td>`;
        } else {
          html += `<td style="text-align:center;">-</td>`;
        }
        html += '</tr>';
      });

      // ─── 5 FILAS DE ESTADÍSTICAS AL PIE (una por materia) ───
      const totalAprob = colAprob.reduce((a,b) => a+b, 0);
      const totalReprob = colReprob.reduce((a,b) => a+b, 0);
      const totalGrades = totalAprob + totalReprob;
      const overallPctAprob = totalGrades > 0 ? Math.round(totalAprob * 1000 / totalGrades) / 10 : 0;
      const overallPctReprob = totalGrades > 0 ? Math.round(totalReprob * 1000 / totalGrades) / 10 : 0;

      // PROMEDIO
      html += `<tr style="background:#f0f2f5;font-weight:700;border-top:2px solid var(--color-border);">`;
      html += `<td></td><td>PROMEDIO</td>`;
      colAverages.forEach(avg => {
        if (avg > 0) html += `<td style="text-align:center;${gradeStyle(avg)}">${avg.toFixed(1)}</td>`;
        else html += `<td style="text-align:center;">-</td>`;
      });
      html += `<td style="text-align:center;${gradeStyle(overallAvg)}">${overallAvg.toFixed(1)}</td></tr>`;

      // ALUMNOS APROBADOS
      html += `<tr style="background:#d4edda;font-weight:700;color:#155724;">`;
      html += `<td></td><td>ALUMNOS APROBADOS</td>`;
      colAprob.forEach((n, si) => {
        html += `<td style="text-align:center;">${colCounts[si] > 0 ? n : '-'}</td>`;
      });
      html += `<td style="text-align:center;">${totalAprob}</td></tr>`;

      // % APROBACION
      html += `<tr style="background:#e8f5e9;font-weight:700;color:#155724;">`;
      html += `<td></td><td>% APROBACIÓN</td>`;
      colPctAprob.forEach((p, si) => {
        html += `<td style="text-align:center;">${colCounts[si] > 0 ? p.toFixed(1) + '%' : '-'}</td>`;
      });
      html += `<td style="text-align:center;">${overallPctAprob.toFixed(1)}%</td></tr>`;

      // ALUMNOS REPROBADOS
      html += `<tr style="background:#ffd3df;font-weight:700;color:#a00;">`;
      html += `<td></td><td>ALUMNOS REPROBADOS</td>`;
      colReprob.forEach((n, si) => {
        html += `<td style="text-align:center;">${colCounts[si] > 0 ? n : '-'}</td>`;
      });
      html += `<td style="text-align:center;">${totalReprob}</td></tr>`;

      // % REPROBACION
      html += `<tr style="background:#fee2e2;font-weight:700;color:#a00;">`;
      html += `<td></td><td>% REPROBACIÓN</td>`;
      colPctReprob.forEach((p, si) => {
        html += `<td style="text-align:center;">${colCounts[si] > 0 ? p.toFixed(1) + '%' : '-'}</td>`;
      });
      html += `<td style="text-align:center;">${overallPctReprob.toFixed(1)}%</td></tr>`;

      html += '</tbody></table></div></div>';

      // ─── STATS PANEL ───
      html += `
        <div class="card">
          <h3 class="section-title">Estadisticas del Grupo</h3>
          <div class="stats-grid">
            <div class="stat-card stat-card--compact">
              <div class="stat-content">
                <div class="stat-label">Promedio del Grupo</div>
                <div class="stat-number">${overallAvg.toFixed(2)}</div>
              </div>
            </div>
            <div class="stat-card stat-card--compact">
              <div class="stat-content">
                <div class="stat-label">Mejor Promedio</div>
                <div class="stat-number">${best ? best.average.toFixed(2) : '-'}</div>
                ${best ? `<div class="stat-label">${Utils.sanitize(best.name)}</div>` : ''}
              </div>
            </div>
            <div class="stat-card stat-card--compact">
              <div class="stat-content">
                <div class="stat-label">Peor Promedio</div>
                <div class="stat-number">${worst ? worst.average.toFixed(2) : '-'}</div>
                ${worst ? `<div class="stat-label">${Utils.sanitize(worst.name)}</div>` : ''}
              </div>
            </div>
            <div class="stat-card stat-card--compact">
              <div class="stat-content">
                <div class="stat-label">Aprobados / Reprobados</div>
                <div class="stat-number">${approved} / ${failed}</div>
              </div>
            </div>
          </div>
        </div>
      `;

      resultsDiv.innerHTML = html;
    } catch (e) {
      console.error('Error generando concentrado:', e);
      resultsDiv.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(e.message)}</p></div>`;
      Toast.show('Error al generar concentrado', 'error');
    }
  }

  // ─── HELPERS ───
  /** Returns inline style for grade value (v13-style color coding, no badges) */
  function gradeStyle(val) {
    if (val < 6) return 'color:var(--color-danger);font-weight:700;background:rgba(229,62,62,0.06);';
    if (val < 7) return 'color:#c05621;font-weight:600;';
    if (val < 8) return 'color:#92400e;';
    return 'color:var(--color-success);font-weight:600;';
  }

  // Legacy function kept for compatibility
  function gradeBadgeClass(val) {
    if (val >= 8) return 'grade-badge--excellent';
    if (val >= 6) return 'grade-badge--good';
    return 'grade-badge--fail';
  }

  function abbreviate(name) {
    if (!name) return '';
    if (name.length <= 12) return name;
    // Split words and take initials for long names, keeping first word
    const words = name.split(/\s+/);
    if (words.length <= 1) return name.substring(0, 12);
    return words[0] + ' ' + words.slice(1).map(w => w.charAt(0) + '.').join('');
  }

  // ─── EXPORT ───
  function exportConcentrado() {
    if (!lastMatrix) {
      Toast.show('Genera primero el concentrado', 'warning');
      return;
    }

    try {
      const { subjectList, matrix, parcial, grupo } = lastMatrix;
      const exportData = matrix.map(row => {
        const obj = {
          '#': row.num,
          'Alumno': row.name
        };
        subjectList.forEach((sub, si) => {
          obj[sub.nombre || sub.id] = row.grades[si] !== null ? row.grades[si] : '';
        });
        obj['PROMEDIO'] = row.gradeCount > 0 ? row.average : '';
        return obj;
      });

      const parcialLabel = K.PARCIALES.find(p => p.id === parcial)?.nombre || parcial;
      const filename = `Concentrado_${grupo}_${parcialLabel}_${new Date().toISOString().split('T')[0]}.xlsx`;
      Utils.exportToExcel(exportData, filename);
    } catch (e) {
      console.error('Error exportando concentrado:', e);
      Toast.show('Error al exportar concentrado', 'error');
    }
  }

  // ─── PRINT — Formato oficial que llena la hoja completa ───
  function printConcentrado() {
    if (!lastMatrix) {
      Toast.show('Genera primero el concentrado', 'warning');
      return;
    }

    const { subjectList, matrix, colAverages, overallAvg, grupo, parcial, turno, grado } = lastMatrix;
    const parcialLabel = K.PARCIALES.find(p => p.id === parcial)?.nombre || parcial;
    const parcMap = { P1: 'PRIMER', P2: 'SEGUNDO', P3: 'TERCER' };
    const parcialText = parcMap[parcial] || 'PRIMER';
    const semMap = { '1': 'SEGUNDO SEMESTRE', '2': 'CUARTO SEMESTRE', '3': 'SEXTO SEMESTRE' };
    const semText = semMap[String(grado)] || '';
    const orientador = K.getOrientador(turno, grupo) || '';
    const n = matrix.length;
    const nSubs = subjectList.length;

    // Dynamic font based on students AND subjects count (legibilidad + 1 hoja carta)
    let fs;
    if (n <= 25 && nSubs <= 11) { fs = '9pt'; }
    else if (n <= 32 && nSubs <= 11) { fs = '8.5pt'; }
    else if (n <= 38) { fs = '8pt'; }
    else if (n <= 45) { fs = '7.5pt'; }
    else if (n <= 52) { fs = '7pt'; }
    else { fs = '6.5pt'; }

    // Subject column width
    const nameColW = 18; // % for name
    const numColW = 3;   // % for #
    const promColW = 5;  // % for promedio
    const subColW = Math.max(3, (100 - nameColW - numColW - promColW) / nSubs);

    // Stats
    const evaluated = matrix.filter(r => r.gradeCount > 0);
    const approved = evaluated.filter(r => r.average >= 6).length;
    const failed = evaluated.filter(r => r.average < 6).length;
    const pctAprob = evaluated.length > 0 ? ((approved / evaluated.length) * 100).toFixed(1) + '%' : '';

    // Build rows
    let rows = '';
    matrix.forEach((row, idx) => {
      const isOdd = idx % 2 === 1;
      const isFail = row.gradeCount > 0 && row.average < 6;
      let rowBg = '';
      if (isFail) { rowBg = ' background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }
      else if (isOdd) { rowBg = ' background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }

      rows += '<tr style="' + rowBg + '">';
      rows += '<td class="c">' + row.num + '</td>';
      rows += '<td class="nm">' + Utils.sanitize(row.name) + '</td>';
      row.grades.forEach(val => {
        if (val !== null) {
          const style = val < 6 ? 'font-weight:bold;' : '';
          rows += '<td class="c" style="' + style + '">' + val + '</td>';
        } else {
          rows += '<td class="c">-</td>';
        }
      });
      const avgStr = row.gradeCount > 0 ? row.average.toFixed(1) : '-';
      const avgStyle = row.gradeCount > 0 && row.average < 6 ? 'font-weight:bold;' : 'font-weight:bold;';
      rows += '<td class="c" style="' + avgStyle + '">' + avgStr + '</td>';
      rows += '</tr>';
    });

    // Averages row
    rows += '<tr style="background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-weight:bold;">';
    rows += '<td class="c"></td><td class="nm" style="font-weight:bold;">PROMEDIO</td>';
    colAverages.forEach(avg => {
      rows += '<td class="c">' + (avg > 0 ? avg.toFixed(1) : '-') + '</td>';
    });
    rows += '<td class="c">' + overallAvg.toFixed(1) + '</td></tr>';

    // Subject headers (abbreviated + rotated for many subjects)
    let subHeaders = '';
    subjectList.forEach(sub => {
      const name = K.getUACNombre(sub.nombre || sub.id);
      const abbr = abbreviate(name);
      subHeaders += '<th title="' + Utils.sanitize(name) + '">' + Utils.sanitize(abbr) + '</th>';
    });

    // Colgroup
    let cols = `<col style="width:${numColW}%"><col style="width:${nameColW}%">`;
    subjectList.forEach(() => { cols += `<col style="width:${subColW}%">`; });
    cols += `<col style="width:${promColW}%">`;

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    const html = `
<style>
@page { size: letter landscape; margin: 5mm 6mm 4mm 6mm; }
html, body { margin:0; padding:0; height:100%; }
* { box-sizing:border-box; margin:0; padding:0; }

.PG {
    width:100%; height:100vh;
    font-family:Arial,Helvetica,sans-serif; color:#000; line-height:1.15;
    font-size:${fs};
    display:flex; flex-direction:column;
    overflow:hidden;
}
.PG table { border-collapse:collapse; }
.PG-hdr, .PG-ttl, .PG-nfo, .PG-bot, .PG-ftr { flex-shrink:0; flex-grow:0; }
.PG-data { flex:1; overflow:hidden; display:flex; flex-direction:column; }

.hdr-t { width:100%; margin-bottom:0.5mm; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:8mm; width:auto; }
.hdr-r { text-align:right; font-size:7pt; line-height:1.3; color:#333; }

.ttl-esc { text-align:center; font-weight:bold; font-size:11pt; line-height:1.15; }
.ttl-ctrl { text-align:center; font-weight:bold; font-size:9.5pt; line-height:1.1; margin:0.5mm 0;
    border-bottom:0.5pt solid #000; padding-bottom:0.5mm; }

.nfo { width:100%; font-size:8pt; line-height:1.2; }
.nfo td { border:0.5pt solid #000; padding:0.6mm 1mm; vertical-align:middle; }
.nfo .lb { font-size:7.5pt; color:#444; }
.nfo .vl { font-weight:bold; font-size:8pt; }
.nfo .sm { text-align:center; font-weight:bold; font-size:8.5pt; line-height:1.2; }

.MT { width:100%; height:100%; table-layout:fixed; font-size:${fs}; line-height:1.1; }
.MT th { border:0.5pt solid #000; padding:0.4mm 0.2mm; text-align:center; font-weight:bold; font-size:${nSubs > 10 ? '6pt' : '7pt'};
    background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
    line-height:1.15; vertical-align:middle; overflow:hidden; }
.MT td { border:0.4pt solid #000; font-size:${fs}; line-height:1.1;
    padding:0.3mm 0.4mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; vertical-align:middle; }
.MT .c { text-align:center; padding:0.3mm 0; }
.MT .nm { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; padding-left:1mm; }
.MT tr { page-break-inside: avoid; }
.MT thead { display: table-header-group; }

.ST td { border:0.4pt solid #000; padding:0.4mm 0.8mm; font-size:8pt; line-height:1.2; }
.ST .sl { font-weight:bold; }
.ST .sv { text-align:center; font-weight:bold; font-size:8.5pt; width:11mm; }

.SG-tbl { width:100%; border-collapse:collapse; }
.SG-tbl td { width:33.33%; text-align:center; padding:0 2mm; }
.SG-tbl .sg-line-row td { vertical-align:bottom; border-bottom:0.5pt solid #000; height:6mm; }
.SG-tbl .sg-text-row td { vertical-align:top; padding-top:0.5mm; }
.SG-tt { font-weight:bold; font-size:8pt; line-height:1.2; }
.SG-nm { font-size:7.5pt; line-height:1.2; margin-top:0.3mm; }

.ftr { margin-top:0.5mm; }
.ftr img { width:100%; max-height:3.5mm; display:block; }
.ftr-t { text-align:center; font-size:6.5pt; color:#333; line-height:1.1; margin-top:0.3mm; }
</style>

<div class="PG">

<div class="PG-hdr">
<table class="hdr-t"><tr>
    <td style="width:50%">${logoHeader ? '<img src="' + logoHeader + '">' : ''}</td>
    <td class="hdr-r">
        DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR<br>
        DIRECCIÓN DE BACHILLERATO GENERAL<br>
        ZONA ESCOLAR NÚM. 63 BC<br>
        ESCUELA PREPARATORIA OFICIAL NÚM. 67<br>
        <b>C.C.T. 15EBH0134D · 15EBH0168U</b>
    </td>
</tr></table>
</div>

<div class="PG-ttl">
<div class="ttl-esc">ESCUELA PREPARATORIA OFICIAL NÚM. 67</div>
<div class="ttl-ctrl">CONCENTRADO DE CALIFICACIONES — ${parcialText} PARCIAL</div>
</div>

<div class="PG-nfo">
<table class="nfo">
    <tr>
        <td style="width:10%"><span class="lb">Orientador(a):</span></td>
        <td style="width:35%" class="vl">${Utils.sanitize(orientador)}</td>
        <td style="width:10%"><span class="lb">Grado:</span> <span class="vl">${grado}°</span></td>
        <td style="width:10%"><span class="lb">Grupo:</span> <span class="vl">${grupo}</span></td>
        <td style="width:20%" class="sm" rowspan="2">${semText}<br><span style="font-size:5.5pt;color:#333;">${Utils.sanitize(turno || '')}</span></td>
    </tr>
    <tr>
        <td colspan="4"><span class="lb">Alumnos:</span> <span class="vl">${n}</span>
        &nbsp;&nbsp;<span class="lb">Aprobados:</span> <span class="vl">${approved}</span>
        &nbsp;&nbsp;<span class="lb">Reprobados:</span> <span class="vl">${failed}</span>
        &nbsp;&nbsp;<span class="lb">% Aprobación:</span> <span class="vl">${pctAprob}</span>
        &nbsp;&nbsp;<span class="lb">Promedio:</span> <span class="vl">${overallAvg.toFixed(2)}</span></td>
    </tr>
</table>
</div>

<div class="PG-data">
<table class="MT">
    <colgroup>${cols}</colgroup>
    <thead><tr>
        <th>No.</th>
        <th>Nombre del Alumno</th>
        ${subHeaders}
        <th>PROM.</th>
    </tr></thead>
    <tbody>${rows}</tbody>
</table>
</div>

<div class="PG-bot">
<table style="width:100%; border-collapse:collapse; margin-top:0.3mm;">
    <tr>
        <td style="width:100%; vertical-align:bottom; padding:0;">
            <table class="SG-tbl">
                <tr class="sg-line-row"><td></td><td></td><td></td></tr>
                <tr class="sg-text-row">
                    <td>
                        <div class="SG-tt">ORIENTADOR(A)</div>
                        <div class="SG-nm">${Utils.sanitize(orientador)}</div>
                    </td>
                    <td>
                        <div class="SG-tt">VO. BO. SUBDIRECCIÓN ESCOLAR</div>
                        <div class="SG-nm">${Utils.sanitize(App.staffName('subdirector'))}</div>
                    </td>
                    <td>
                        <div class="SG-tt">DIRECCIÓN ESCOLAR</div>
                        <div class="SG-nm">${Utils.sanitize(App.staffName('director'))}</div>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</div>

<div class="PG-ftr">
<div class="ftr">
    ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
    <div class="ftr-t">Av. de los Astros 7, Cuautitlán Izcalli, Estado de México, México C.P. 54770 · Tel. 55 5877 0221 · epo67@edu.gem.gob.mx</div>
</div>
</div>

</div>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Concentrado - ' +
      Utils.sanitize(grupo) + '</title></head><body>' + html +
      '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    printWindow.document.close();
  }

  // ─── EXPORTACION FORMATO ORIENTACION ────────────────────────────
  // Genera un xlsx con: 1 hoja por grupo (Concentrado), 1 hoja por grupo (Seguimiento)
  // y una hoja final "mejores promedios". Replica el formato oficial usado por Orientacion.

  // Mapeo de nombres oficiales -> abreviacion para el header del xlsx
  const SUBJECT_ABBR = {
    'LENGUA Y COMUNICACION II': 'LEN. COM.', 'INGLES II': 'ING.',
    'PENSAMIENTO MATEMATICO II': 'PENS. MAT.', 'CULTURA DIGITAL II': 'CULT. DIG.',
    'CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGIA II': 'CIEN. NAT.',
    'PENSAMIENTO FILOSOFICO Y HUMANIDADES II': 'PENS. FIL.',
    'CIENCIAS SOCIALES II': 'CIEN. SOC.', 'TALLER DE CIENCIAS I': 'TLLR. CIEN.',
    'ACTIVIDADES FISICAS Y DEPORTIVAS II': 'ACT. FIS.',
    'EDUCACION PARA LA SALUD II': 'EDU. SAL.',
    'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS II': 'IGU. DER.',
    'PENSAMIENTO LITERARIO': 'PENS.LIT.', 'INGLES IV': 'ING.',
    'TEMAS SELECTOS DE MATEMATICAS I': 'T. S. MAT.',
    'CONCIENCIA HISTORICA I': 'CON. HIS.', 'TALLER DE CULTURA DIGITAL': 'T. CUL. DIG',
    'REACCIONES QUIMICAS Y CONSERVACION DE LA MATERIA': 'REA. QUIM.',
    'ESPACIO Y SOCIEDAD': 'ESP. SOC.', 'CIENCIAS SOCIALES III': 'CIEN. SOC.',
    'COMUNIDADES VIRTUALES': 'COM. VIRT.',
    'MANTENIMIENTO DE REDES DE COMPUTO': 'MTO. RED.',
    'ACTIVIDADES ARTISTICAS Y CULTURALES I': 'ACT. ART.',
    'EDUCACION INTEGRAL EN SEXUALIDAD Y GENERO II': 'EDUC.SEX.GEN',
    'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS IV': 'IGU.DER.',
    'CIENCIAS DE LA COMUNICACION I': 'CIEN. COM.',
    'TEMAS SELECTOS DE INGLES II': 'T. S. ING.',
    'TEMAS SELECTOS DE MATEMATICAS II': 'T. S. MAT.',
    'CONCIENCIA HISTORICA III': 'CON. HIS.',
    'ORGANISMOS': 'ORG.', 'TEMAS SELECTOS DE FILOSOFIA': 'T. S. FIL.',
    'ECONOMIA I': 'ECO.', 'PAGINAS WEB': 'PAG. WEB',
    'DISENO DIGITAL': 'DIS. DIG.',
    'ACTIVIDADES ARTISTICAS Y CULTURALES III': 'ACT. ART.',
    'PRACTICA Y COLABORACION CIUDADANA II': 'PRAC. COL.',
    'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS VI': 'IGU. DER.'
  };
  const normSubj = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const subjectAbbr = name => SUBJECT_ABBR[normSubj(name)] || normSubj(name).slice(0, 11);

  // Construye un SPEC (datos planos, sin XLSX) para un set de grupos.
  // Devuelve { sheets: [{name, aoa, merges, cols}] } que se serializa en un Web Worker
  // (XlsxWorker.serialize) o en main thread como fallback. Antes usaba XLSX directamente
  // en el main thread bloqueando la UI durante exports masivos.
  function buildOrientacionWorkbookSpec(targetGroups, partial, partialLabel, cicloEscolar, turno) {
    if (!turno && targetGroups.length > 0) turno = targetGroups[0].turno;
    const sheets = [];
    const allBest = []; // para hoja "mejores promedios"
    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const semestreByGrado = { 1: '2\u00ba', 2: '4\u00ba', 3: '6\u00ba' };

    for (const grp of targetGroups) {
      // Materias del grado, ordenadas oficialmente
      const subsRaw = allSubjects.filter(s => String(s.grado) === String(grp.grado));
      const subs = (typeof K.sortSubjectsByGrado === 'function')
        ? K.sortSubjectsByGrado(subsRaw, grp.grado)
        : subsRaw.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      // Alumnos del grupo, ordenados por apellido
      const stus = allStudents.filter(s => s.groupId === grp.id)
        .sort((a, b) => (a.apellido1 || '').localeCompare(b.apellido1 || '') ||
                        (a.apellido2 || '').localeCompare(b.apellido2 || '') ||
                        (a.nombres || '').localeCompare(b.nombres || ''));

      // Mapa grades por alumno+materia para este parcial
      const gMap = {};
      for (const g of allGrades) {
        if (g.partial !== partial || g.groupId !== grp.id) continue;
        gMap[g.studentId] = gMap[g.studentId] || {};
        gMap[g.studentId][g.subjectId] = g;
      }

      // ─── HOJA 1: CONCENTRADO ───
      const aoa1 = [];
      // Encabezado institucional
      aoa1.push([`ESCUELA PREPARATORIA OFICIAL N\u00ba 67`]);
      aoa1.push([`CONCENTRADO DE CALIFICACIONES   ${partialLabel}   CICLO ESCOLAR ${cicloEscolar}`]);
      aoa1.push(['', `GRADO: ${grp.grado}\u00ba   GRUPO: ${grp.nombre.split('-')[1] || grp.nombre}    SEMESTRE: ${semestreByGrado[grp.grado] || ''}    TURNO: ${turno}`]);
      aoa1.push([]); // 4
      // Header materias (fila 5: nombres, fila 6: F C)
      const matRow = ['N.L', 'NOMBRE DEL ALUMNO', '', '', ''];
      const fcRow  = ['', '', '', '', ''];
      for (const s of subs) {
        matRow.push(subjectAbbr(s.nombre), '');
        fcRow.push('F', 'C');
      }
      matRow.push('PROMEDIO');
      fcRow.push('');
      aoa1.push(matRow); // 5
      aoa1.push(fcRow);  // 6

      // Acumuladores por materia para las 5 filas estadísticas del footer
      const subStats = subs.map(() => ({ sum: 0, cnt: 0, aprob: 0, reprob: 0 }));
      let groupSumProm = 0, groupCntProm = 0;

      // ═══ Métricas ALUMNO-céntricas para los totales del grupo ═══
      // Un alumno se cuenta UNA sola vez aunque tenga varias reprobadas/aprobadas.
      // Aprobado = 0 materias reprobadas. Irregular = ≥1 materia reprobada.
      // Esto evita que sumar aprob de todas las materias dé 250 en un grupo de 30.
      let totalAlumnosAprob = 0;     // alumnos con 0 reprobadas
      let totalAlumnosIrregulares = 0; // alumnos con ≥1 reprobada
      let totalAlumnosEvaluados = 0;   // alumnos con AL MENOS una cal capturada
      let totalIncidencias = 0;        // suma de cals < 6 (magnitud)

      // Filas de alumnos (7+)
      stus.forEach((stu, idx) => {
        const row = [idx + 1, stu.apellido1 || '', stu.apellido2 || '', stu.nombres || '', ''];
        let sumCal = 0, cntCal = 0;
        let stuReprobs = 0; // reprobadas DEL ALUMNO en este parcial
        subs.forEach((s, si) => {
          const gd = (gMap[stu.id] && gMap[stu.id][s.id]) || null;
          const f = gd ? (gd.faltas != null ? Number(gd.faltas) : 0) : '';
          const c = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : '')) : '';
          row.push(f === '' ? '' : f, c === '' ? '' : c);
          if (c !== '' && !isNaN(c)) {
            sumCal += Number(c); cntCal++;
            subStats[si].sum += Number(c);
            subStats[si].cnt++;
            if (Number(c) >= passGrade) subStats[si].aprob++;
            else { subStats[si].reprob++; stuReprobs++; }
          }
        });
        const prom = cntCal > 0 ? +(sumCal / cntCal).toFixed(2) : '';
        row.push(prom);
        aoa1.push(row);

        // Contar alumno como evaluado si tiene al menos una cal
        if (cntCal > 0) {
          totalAlumnosEvaluados++;
          if (stuReprobs === 0) totalAlumnosAprob++;
          else totalAlumnosIrregulares++;
          totalIncidencias += stuReprobs;
          const fullName = `${stu.apellido1 || ''} ${stu.apellido2 || ''} ${stu.nombres || ''}`.trim();
          allBest.push({ grupo: grp.nombre, alumno: fullName, promedio: prom });
          groupSumProm += Number(prom);
          groupCntProm++;
        }
      });

      // ─── 5 FILAS ESTADÍSTICAS AL PIE (una por materia) ───
      // Estructura: [LABEL, vacío, vacío, vacío, vacío, F=vacío, C=valor, ..., TOTAL]
      // El LABEL va en col 0 porque Excel usa el contenido del top-left cell del merge.
      // Las cols 0..4 se mergean para que el rótulo abarque toda la zona de "info alumno".
      const buildStatRow = (label, valuesPerSub, totalValue) => {
        const row = [label, '', '', '', ''];
        valuesPerSub.forEach(v => row.push('', v));
        row.push(totalValue);
        return row;
      };

      const promPerSub = subStats.map(s => s.cnt > 0 ? +(s.sum / s.cnt).toFixed(2) : '');
      const aprobPerSub = subStats.map(s => s.cnt > 0 ? s.aprob : '');
      const reprobPerSub = subStats.map(s => s.cnt > 0 ? s.reprob : '');
      const pctAprobPerSub = subStats.map(s => s.cnt > 0 ? +(s.aprob * 100 / s.cnt).toFixed(1) : '');
      const pctReprobPerSub = subStats.map(s => s.cnt > 0 ? +(s.reprob * 100 / s.cnt).toFixed(1) : '');

      // TOTAL alumno-céntrico:
      //   - ALUMNOS APROBADOS (total) = alumnos del grupo con 0 reprobadas
      //   - ALUMNOS REPROBADOS (total) = alumnos del grupo con ≥1 reprobada
      //   - El total cuadra contra los alumnos evaluados del grupo (NO la
      //     sumatoria de aprobaciones a través de materias).
      // El conteo POR MATERIA (aprobPerSub/reprobPerSub) sigue siendo correcto
      // porque cada alumno aporta exactamente 1 cal por materia.
      const groupProm = groupCntProm > 0 ? +(groupSumProm / groupCntProm).toFixed(2) : '';
      const groupPctAprob = totalAlumnosEvaluados > 0 ? +(totalAlumnosAprob * 100 / totalAlumnosEvaluados).toFixed(1) : '';
      const groupPctReprob = totalAlumnosEvaluados > 0 ? +(totalAlumnosIrregulares * 100 / totalAlumnosEvaluados).toFixed(1) : '';

      // Fila índice donde empiezan las 5 stats (después de header + student rows)
      const firstStatRow = aoa1.length;
      aoa1.push(buildStatRow('PROMEDIO', promPerSub, groupProm));
      aoa1.push(buildStatRow('ALUMNOS APROBADOS', aprobPerSub, totalAlumnosAprob));
      aoa1.push(buildStatRow('% APROBACIÓN', pctAprobPerSub, groupPctAprob));
      aoa1.push(buildStatRow('ALUMNOS REPROBADOS', reprobPerSub, totalAlumnosIrregulares));
      aoa1.push(buildStatRow('% REPROBACIÓN', pctReprobPerSub, groupPctReprob));

      const sheet1Merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 + subs.length * 2 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 + subs.length * 2 } },
        { s: { r: 2, c: 1 }, e: { r: 2, c: 4 + subs.length * 2 } },
        // Cada una de las 5 filas de stats: mergear cols 0..4 (info del alumno)
        // para que el label se lea limpio (no solo en col 1).
        { s: { r: firstStatRow,     c: 0 }, e: { r: firstStatRow,     c: 4 } },
        { s: { r: firstStatRow + 1, c: 0 }, e: { r: firstStatRow + 1, c: 4 } },
        { s: { r: firstStatRow + 2, c: 0 }, e: { r: firstStatRow + 2, c: 4 } },
        { s: { r: firstStatRow + 3, c: 0 }, e: { r: firstStatRow + 3, c: 4 } },
        { s: { r: firstStatRow + 4, c: 0 }, e: { r: firstStatRow + 4, c: 4 } },
      ];
      const sheet1Cols = [{ wch: 4 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 2 }]
        .concat(subs.map(_ => ({ wch: 5 })).flatMap(c => [{ wch: 4 }, { wch: 5 }]))
        .concat([{ wch: 9 }]);

      const sheetName1 = String(grp.grado) + '\u00b0' + (grp.nombre.split('-')[1] || grp.nombre);
      sheets.push({ name: sheetName1, aoa: aoa1, merges: sheet1Merges, cols: sheet1Cols });

      // ─── HOJA 2: SEGUIMIENTO (solo reprobados) ───
      const aoa2 = [];
      aoa2.push([`ESCUELA PREPARATORIA OFICIAL N\u00ba 67`]);
      aoa2.push([`SEGUIMIENTO / CASOS ESPECIALES ${partialLabel}   CICLO ESCOLAR ${cicloEscolar}`]);
      aoa2.push([`GRADO: ${grp.grado}\u00ba   GRUPO: ${grp.nombre.split('-')[1] || grp.nombre}    TURNO: ${turno}`]);
      aoa2.push([]);
      // 4 cols extras vac\u00edas al final para anotaciones a mano del orientador
      const EXTRA_COLS_SPEC = ['Problemas conductuales', 'Problemas econ\u00f3micos', 'Problemas familiares', 'Salud / Comentarios'];
      const seguHdr = ['N.L', 'AP. PATERNO', 'AP. MATERNO', 'NOMBRE'];
      for (const s of subs) seguHdr.push(subjectAbbr(s.nombre));
      seguHdr.push('M.R');
      EXTRA_COLS_SPEC.forEach(label => seguHdr.push(label));
      aoa2.push(seguHdr);

      let segIdx = 1;
      stus.forEach(stu => {
        const sg = gMap[stu.id] || {};
        const cells = subs.map(s => {
          const gd = sg[s.id];
          const cal = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : null)) : null;
          return (cal != null && !isNaN(cal) && cal < passGrade) ? cal : '';
        });
        const mr = cells.filter(c => c !== '').length;
        if (mr > 0) {
          aoa2.push([segIdx++, stu.apellido1 || '', stu.apellido2 || '', stu.nombres || '', ...cells, mr, '', '', '', '']);
        }
      });
      // Totales por materia
      if (aoa2.length > 5) {
        const totalsRow = ['', '', '', 'TOTAL'];
        for (let ci = 0; ci < subs.length; ci++) {
          let total = 0;
          for (let ri = 5; ri < aoa2.length; ri++) {
            if (aoa2[ri][4 + ci] !== '' && aoa2[ri][4 + ci] != null) total++;
          }
          totalsRow.push(total || '');
        }
        // Suma total de M.R
        let mrTotal = 0;
        for (let ri = 5; ri < aoa2.length; ri++) mrTotal += Number(aoa2[ri][4 + subs.length]) || 0;
        totalsRow.push(mrTotal);
        // Las 4 cols extras del TOTAL quedan vac\u00edas
        EXTRA_COLS_SPEC.forEach(() => totalsRow.push(''));
        aoa2.push(totalsRow);
      } else {
        aoa2.push(['', '', '', 'Sin alumnos reprobados en este parcial']);
      }

      const sheet2Cols = [{ wch: 4 }, { wch: 16 }, { wch: 16 }, { wch: 18 }]
        .concat(subs.map(() => ({ wch: 8 })))
        .concat([{ wch: 5 }])
        .concat(EXTRA_COLS_SPEC.map(() => ({ wch: 22 })));
      sheets.push({ name: 'seg ' + sheetName1, aoa: aoa2, cols: sheet2Cols });
    }

    // ─── HOJA FINAL: MEJORES PROMEDIOS ───
    if (allBest.length > 0) {
      const ranked = allBest.sort((a, b) => b.promedio - a.promedio);
      const aoaBP = [
        [`ESCUELA PREPARATORIA OFICIAL N\u00ba 67`],
        [`MEJORES PROMEDIOS  ${partialLabel}  CICLO ${cicloEscolar}`],
        [],
        ['#', 'GRUPO', 'ALUMNO', 'PROMEDIO']
      ];
      ranked.slice(0, 30).forEach((r, i) => aoaBP.push([i + 1, r.grupo, r.alumno, r.promedio]));
      sheets.push({
        name: 'mejores promedios',
        aoa: aoaBP,
        cols: [{ wch: 4 }, { wch: 8 }, { wch: 40 }, { wch: 9 }]
      });
    }
    return { sheets };
  }

  // Helper: descarga un ArrayBuffer .xlsx con un nombre dado.
  function downloadXlsxBuffer(buf, fname) {
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Sanitiza un nombre para que sirva de filename
  function safeFilename(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 60);
  }

  // Wrapper publico: genera 1 xlsx para la seleccion actual del usuario.
  // Usa Web Worker para no bloquear el main thread durante la serializacion XLSX.
  // Resuelve el conjunto de grupos a procesar según los filtros + modo.
  async function _resolveTargetGroupsAndMeta() {
    const turno = _chipValue("turno");
    const grado = _chipValue("grado");
    const modo = _chipValue("modo") || 'todos';
    const grupoSel = _chipValue("grupo");
    const partial = _chipValue("parcial") || 'P1';

    if (!turno) { Toast.show('Selecciona turno', 'warning'); return null; }
    if (!grado) { Toast.show('Selecciona grado', 'warning'); return null; }
    if (modo === 'uno' && !grupoSel) { Toast.show('Selecciona el grupo específico', 'warning'); return null; }

    if (!Array.isArray(allGroups) || allGroups.length === 0) {
      Toast.show('Cargando datos...', 'info');
      await loadData();
    }

    let targetGroups = allGroups.filter(g => g.turno === turno && String(g.grado) === String(grado));
    if (modo === 'uno' && grupoSel) targetGroups = targetGroups.filter(g => g.id === grupoSel);
    targetGroups.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    if (targetGroups.length === 0) { Toast.show('No hay grupos para esa selección', 'warning'); return null; }

    // Validar materias
    const subsForGrado = allSubjects.filter(s => String(s.grado) === String(grado));
    if (subsForGrado.length === 0) {
      Toast.show(`No hay materias registradas para ${grado}° grado`, 'warning');
      return null;
    }

    // Resolver orientador
    const teachers = await Store.getTeachers().catch(() => []);
    const teacherById = new Map(teachers.map(t => [t.id, t.nombre]));
    const firstGrp = targetGroups[0];
    let orientador = '';
    if (firstGrp.orientadorId && teacherById.has(firstGrp.orientadorId)) {
      orientador = teacherById.get(firstGrp.orientadorId);
    } else if (typeof K.getOrientador === 'function') {
      orientador = K.getOrientador(turno, firstGrp.nombre) || firstGrp.orientador || '';
    } else {
      orientador = firstGrp.orientador || '';
    }
    orientador = (orientador || '').toUpperCase();

    const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

    return { targetGroups, partial, partialLabel, cicloEscolar, turno, grado, orientador, modo };
  }

  // Excel con estilos (mismo formato visual que el PDF: colores por bloque de materia, bordes, etc)
  async function exportOrientacionStyledExcel() {
    try {
      const ctx = await _resolveTargetGroupsAndMeta();
      if (!ctx) return;

      Toast.show('Cargando librería de Excel...', 'info');
      await Lib.exceljs();
      if (typeof window.ExcelJS === 'undefined') {
        Toast.show('No se pudo cargar la librería de Excel', 'error');
        return;
      }

      Toast.show(`Generando Excel para ${ctx.targetGroups.length} grupo(s)...`, 'info');

      const wb = new ExcelJS.Workbook();
      wb.creator = 'EPO 67 Sistema Escolar';
      wb.created = new Date();

      const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
      const semestreByGrado = { 1: '2°', 2: '4°', 3: '6°' };
      const allBest = [];

      for (const grp of ctx.targetGroups) {
        const subsRaw = allSubjects.filter(s => String(s.grado) === String(grp.grado));
        const subs = (typeof K.sortSubjectsByGrado === 'function')
          ? K.sortSubjectsByGrado(subsRaw, grp.grado) : subsRaw;
        const stus = allStudents.filter(s => s.groupId === grp.id)
          .sort((a, b) => (a.apellido1 || '').localeCompare(b.apellido1 || '') ||
                          (a.apellido2 || '').localeCompare(b.apellido2 || '') ||
                          (a.nombres || '').localeCompare(b.nombres || ''));
        const gMap = {};
        for (const g of allGrades) {
          if (g.partial !== ctx.partial || g.groupId !== grp.id) continue;
          gMap[g.studentId] = gMap[g.studentId] || {};
          gMap[g.studentId][g.subjectId] = g;
        }

        // ─── HOJA: CONCENTRADO (matriz F+C por materia) ───
        const sheetName = `${grp.grado}°${grp.nombre.split('-')[1] || grp.nombre}`;
        const ws = wb.addWorksheet(sheetName, {
          pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3 } }
        });

        // Encabezado institucional
        const totalCols = 4 + subs.length * 2 + 1; // NL + 3 cols nombre + (F,C)*subs + Promedio
        ws.mergeCells(1, 1, 1, totalCols);
        ws.getCell(1, 1).value = 'ESCUELA PREPARATORIA OFICIAL N° 67';
        ws.getCell(1, 1).font = { bold: true, size: 14 };
        ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };

        ws.mergeCells(2, 1, 2, totalCols);
        ws.getCell(2, 1).value = `CONCENTRADO DE CALIFICACIONES — ${ctx.partialLabel}`;
        ws.getCell(2, 1).font = { bold: true, size: 12 };
        ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };

        ws.mergeCells(3, 1, 3, totalCols);
        ws.getCell(3, 1).value = `CICLO ${ctx.cicloEscolar} · TURNO ${ctx.turno} · ${grp.grado}° GRADO · GRUPO ${grp.nombre} · SEMESTRE ${semestreByGrado[grp.grado] || ''}`;
        ws.getCell(3, 1).font = { italic: true, size: 10 };
        ws.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' };

        ws.mergeCells(4, 1, 4, totalCols);
        ws.getCell(4, 1).value = `Orientador(a): ${ctx.orientador}`;
        ws.getCell(4, 1).font = { size: 9, color: { argb: 'FF555555' } };
        ws.getCell(4, 1).alignment = { horizontal: 'center', vertical: 'middle' };

        // Header materias (fila 6 = nombres con merge, fila 7 = F C)
        ws.getCell(6, 1).value = 'NL';
        ws.mergeCells(6, 1, 7, 1);
        ws.getCell(6, 2).value = 'AP. PATERNO';
        ws.mergeCells(6, 2, 7, 2);
        ws.getCell(6, 3).value = 'AP. MATERNO';
        ws.mergeCells(6, 3, 7, 3);
        ws.getCell(6, 4).value = 'NOMBRE';
        ws.mergeCells(6, 4, 7, 4);

        // Map color → ARGB para ExcelJS
        const colorToArgb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();

        subs.forEach((s, i) => {
          const colF = 5 + i * 2;
          const colC = 6 + i * 2;
          const bgColor = colorToArgb(subjectBlockColor(s.nombre));
          ws.mergeCells(6, colF, 6, colC);
          const matCell = ws.getCell(6, colF);
          matCell.value = subjectAbbr(s.nombre);
          matCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
          matCell.font = { bold: true, size: 9 };
          matCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

          ['F', 'C'].forEach((label, off) => {
            const cell = ws.getCell(7, colF + off);
            cell.value = label;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
            cell.font = { bold: true, size: 9 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          });
        });

        const promCol = 5 + subs.length * 2;
        ws.getCell(6, promCol).value = 'PROM';
        ws.mergeCells(6, promCol, 7, promCol);
        ws.getCell(6, promCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        ws.getCell(6, promCol).font = { bold: true, size: 9 };
        ws.getCell(6, promCol).alignment = { horizontal: 'center', vertical: 'middle' };

        // Acumuladores por materia + totales alumno-céntricos del grupo
        const subStats = subs.map(() => ({ sum: 0, cnt: 0, aprob: 0, reprob: 0 }));
        let groupSumProm = 0, groupCntProm = 0;
        // Métricas alumno-céntricas:
        //   ALUMNOS APROBADOS (total) = alumnos con 0 reprobadas
        //   ALUMNOS REPROBADOS (total) = alumnos con ≥1 reprobada
        //   Aprobados + Reprobados = alumnos evaluados del grupo (NO suma de
        //   aprobaciones a través de materias, que daría números inflados).
        let totalAlumnosAprob = 0;
        let totalAlumnosIrregulares = 0;
        let totalAlumnosEvaluados = 0;

        // Filas de alumnos
        let rowIdx = 8;
        stus.forEach((stu, idx) => {
          ws.getCell(rowIdx, 1).value = idx + 1;
          ws.getCell(rowIdx, 2).value = stu.apellido1 || '';
          ws.getCell(rowIdx, 3).value = stu.apellido2 || '';
          ws.getCell(rowIdx, 4).value = stu.nombres || '';
          ws.getCell(rowIdx, 1).alignment = { horizontal: 'center' };
          let sumCal = 0, cntCal = 0;
          let stuReprobs = 0; // reprobadas DEL ALUMNO (para clasificación alumno-céntrica)
          subs.forEach((s, i) => {
            const gd = (gMap[stu.id] && gMap[stu.id][s.id]) || null;
            const f = gd ? (gd.faltas != null ? Number(gd.faltas) : 0) : null;
            const c = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : null)) : null;
            const colF = 5 + i * 2;
            const colC = 6 + i * 2;
            ws.getCell(rowIdx, colF).value = f;
            ws.getCell(rowIdx, colC).value = c;
            ws.getCell(rowIdx, colF).alignment = { horizontal: 'center' };
            ws.getCell(rowIdx, colC).alignment = { horizontal: 'center' };
            if (c != null && c < passGrade) {
              ws.getCell(rowIdx, colC).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' } };
              ws.getCell(rowIdx, colC).font = { bold: true, color: { argb: 'FFB91C1C' } };
            }
            if (c != null && !isNaN(c)) {
              sumCal += c; cntCal++;
              subStats[i].sum += c;
              subStats[i].cnt++;
              if (c >= passGrade) subStats[i].aprob++;
              else { subStats[i].reprob++; stuReprobs++; }
            }
          });
          const prom = cntCal > 0 ? +(sumCal / cntCal).toFixed(2) : '';
          ws.getCell(rowIdx, promCol).value = prom;
          ws.getCell(rowIdx, promCol).alignment = { horizontal: 'center' };
          ws.getCell(rowIdx, promCol).font = { bold: true };
          ws.getCell(rowIdx, promCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

          // Contar alumno como evaluado (con al menos 1 cal) y clasificar
          if (cntCal > 0) {
            totalAlumnosEvaluados++;
            if (stuReprobs === 0) totalAlumnosAprob++;
            else totalAlumnosIrregulares++;
          }

          if (cntCal > 0 && prom !== '') {
            allBest.push({
              grupo: grp.nombre,
              grado: grp.grado,
              apellido1: stu.apellido1 || '',
              apellido2: stu.apellido2 || '',
              nombres: stu.nombres || '',
              promedio: prom
            });
            groupSumProm += Number(prom);
            groupCntProm++;
          }

          rowIdx++;
        });

        // ─── 5 FILAS ESTADÍSTICAS AL PIE ───
        // Por materia (columnas): conteo correcto (1 cal por alumno por materia).
        // TOTAL (última columna): alumno-céntrico — el grupo cuadra contra
        // sus alumnos reales evaluados.
        const groupPctAprob = totalAlumnosEvaluados > 0 ? +(totalAlumnosAprob * 100 / totalAlumnosEvaluados).toFixed(1) : '';
        const groupPctReprob = totalAlumnosEvaluados > 0 ? +(totalAlumnosIrregulares * 100 / totalAlumnosEvaluados).toFixed(1) : '';
        const statRows = [
          { label: 'PROMEDIO', valFn: s => s.cnt > 0 ? +(s.sum / s.cnt).toFixed(2) : '', total: groupCntProm > 0 ? +(groupSumProm / groupCntProm).toFixed(2) : '', bg: 'FFF1F5F9', fg: 'FF1F2937' },
          { label: 'ALUMNOS APROBADOS', valFn: s => s.cnt > 0 ? s.aprob : '', total: totalAlumnosAprob, bg: 'FFD4EDDA', fg: 'FF155724' },
          { label: '% APROBACIÓN', valFn: s => s.cnt > 0 ? +(s.aprob * 100 / s.cnt).toFixed(1) : '', total: groupPctAprob, bg: 'FFE8F5E9', fg: 'FF155724', isPct: true },
          { label: 'ALUMNOS REPROBADOS', valFn: s => s.cnt > 0 ? s.reprob : '', total: totalAlumnosIrregulares, bg: 'FFFFD3DF', fg: 'FFAA0000' },
          { label: '% REPROBACIÓN', valFn: s => s.cnt > 0 ? +(s.reprob * 100 / s.cnt).toFixed(1) : '', total: groupPctReprob, bg: 'FFFEE2E2', fg: 'FFAA0000', isPct: true },
        ];

        statRows.forEach(stat => {
          // Label mergeado en cols 1..4
          ws.mergeCells(rowIdx, 1, rowIdx, 4);
          const labelCell = ws.getCell(rowIdx, 1);
          labelCell.value = stat.label;
          labelCell.font = { bold: true, color: { argb: stat.fg }, size: 10 };
          labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stat.bg } };
          labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
          // Valor por materia (en col C, F queda vacía)
          subs.forEach((_, i) => {
            const colF = 5 + i * 2;
            const colC = 6 + i * 2;
            const v = stat.valFn(subStats[i]);
            ws.getCell(rowIdx, colF).value = null;
            const cellC = ws.getCell(rowIdx, colC);
            cellC.value = v === '' ? null : v;
            if (stat.isPct && v !== '') cellC.numFmt = '0.0"%"';
            cellC.font = { bold: true, color: { argb: stat.fg }, size: 10 };
            cellC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stat.bg } };
            cellC.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.getCell(rowIdx, colF).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stat.bg } };
          });
          // Total/global en promCol
          const totalCell = ws.getCell(rowIdx, promCol);
          totalCell.value = stat.total === '' ? null : stat.total;
          if (stat.isPct && stat.total !== '') totalCell.numFmt = '0.0"%"';
          totalCell.font = { bold: true, color: { argb: stat.fg }, size: 10 };
          totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stat.bg } };
          totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
          rowIdx++;
        });

        // Aplicar bordes a TODAS las celdas con datos (filas 1..rowIdx-1, cols 1..promCol)
        const lastRow = rowIdx - 1;
        for (let r = 1; r <= lastRow; r++) {
          for (let c = 1; c <= promCol; c++) {
            ws.getCell(r, c).border = {
              top: { style: 'thin', color: { argb: 'FF000000' } },
              left: { style: 'thin', color: { argb: 'FF000000' } },
              bottom: { style: 'thin', color: { argb: 'FF000000' } },
              right: { style: 'thin', color: { argb: 'FF000000' } }
            };
          }
        }

        // Anchos de columna
        ws.getColumn(1).width = 4;
        ws.getColumn(2).width = 16;
        ws.getColumn(3).width = 16;
        ws.getColumn(4).width = 18;
        for (let i = 0; i < subs.length; i++) {
          ws.getColumn(5 + i * 2).width = 4;
          ws.getColumn(6 + i * 2).width = 5;
        }
        ws.getColumn(promCol).width = 7;

        // ─── HOJA: SEGUIMIENTO / CASOS ESPECIALES (solo reprobados) ───
        // 4 columnas extras VACÍAS al final para que el orientador anote a mano:
        // Conductuales | Económicos | Familiares | Salud / Comentarios
        const EXTRA_COLS = ['Problemas conductuales', 'Problemas económicos', 'Problemas familiares', 'Salud / Comentarios'];
        const ws2 = wb.addWorksheet(`seg ${sheetName}`, {
          pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        const totalCols2 = 4 + subs.length + 1 + EXTRA_COLS.length;  // +4 extra cols
        const mrCol = 4 + subs.length + 1;                            // M.R. ahora va en col fija
        ws2.mergeCells(1, 1, 1, totalCols2);
        ws2.getCell(1, 1).value = 'ESCUELA PREPARATORIA OFICIAL N° 67';
        ws2.getCell(1, 1).font = { bold: true, size: 14 };
        ws2.getCell(1, 1).alignment = { horizontal: 'center' };
        ws2.mergeCells(2, 1, 2, totalCols2);
        ws2.getCell(2, 1).value = `SEGUIMIENTO / CASOS ESPECIALES ${ctx.partialLabel} · CICLO ${ctx.cicloEscolar} · ${grp.grado}° GRADO · GRUPO ${grp.nombre} · TURNO ${ctx.turno}`;
        ws2.getCell(2, 1).font = { bold: true, size: 11 };
        ws2.getCell(2, 1).alignment = { horizontal: 'center' };

        // Headers
        ws2.getCell(4, 1).value = 'NL';
        ws2.getCell(4, 2).value = 'AP. PATERNO';
        ws2.getCell(4, 3).value = 'AP. MATERNO';
        ws2.getCell(4, 4).value = 'NOMBRE';
        subs.forEach((s, i) => {
          const cell = ws2.getCell(4, 5 + i);
          cell.value = subjectAbbr(s.nombre);
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorToArgb(subjectBlockColor(s.nombre)) } };
          cell.font = { bold: true, size: 9 };
          cell.alignment = { horizontal: 'center', wrapText: true };
        });
        ws2.getCell(4, mrCol).value = 'M.R.';
        // Headers de las 4 columnas vacías (con fondo distinto para que destaquen)
        EXTRA_COLS.forEach((label, i) => {
          const cell = ws2.getCell(4, mrCol + 1 + i);
          cell.value = label;
          cell.font = { bold: true, size: 9, color: { argb: 'FF1E3A8A' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        });
        for (let c = 1; c <= 4; c++) {
          ws2.getCell(4, c).font = { bold: true };
          ws2.getCell(4, c).alignment = { horizontal: 'center' };
        }
        ws2.getCell(4, mrCol).font = { bold: true };
        ws2.getCell(4, mrCol).alignment = { horizontal: 'center' };

        let segRow = 5;
        let segIdx = 1;
        stus.forEach(stu => {
          const sg = gMap[stu.id] || {};
          const reprobadas = subs.map(s => {
            const gd = sg[s.id];
            const cal = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : null)) : null;
            return (cal != null && !isNaN(cal) && cal < passGrade) ? cal : null;
          });
          const mr = reprobadas.filter(c => c !== null).length;
          if (mr > 0) {
            ws2.getCell(segRow, 1).value = segIdx++;
            ws2.getCell(segRow, 2).value = stu.apellido1 || '';
            ws2.getCell(segRow, 3).value = stu.apellido2 || '';
            ws2.getCell(segRow, 4).value = stu.nombres || '';
            reprobadas.forEach((cal, i) => {
              const cell = ws2.getCell(segRow, 5 + i);
              if (cal !== null) {
                cell.value = cal;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0E0' } };
                cell.font = { bold: true, color: { argb: 'FFB91C1C' } };
              }
              cell.alignment = { horizontal: 'center' };
            });
            ws2.getCell(segRow, mrCol).value = mr;
            ws2.getCell(segRow, mrCol).font = { bold: true };
            ws2.getCell(segRow, mrCol).alignment = { horizontal: 'center' };
            // Las 4 columnas extras se dejan VACÍAS pero con borde y alineación
            // para que el orientador escriba a mano.
            for (let i = 0; i < EXTRA_COLS.length; i++) {
              const cell = ws2.getCell(segRow, mrCol + 1 + i);
              cell.value = null;
              cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
            }
            segRow++;
          }
        });

        if (segRow === 5) {
          ws2.mergeCells(5, 1, 5, totalCols2);
          ws2.getCell(5, 1).value = 'Sin alumnos reprobados en este parcial';
          ws2.getCell(5, 1).font = { italic: true };
          ws2.getCell(5, 1).alignment = { horizontal: 'center' };
          segRow = 6;
        } else {
          // Totales por columna (solo materias + M.R., las extras quedan vacías)
          ws2.getCell(segRow, 4).value = 'TOTAL';
          ws2.getCell(segRow, 4).font = { bold: true };
          ws2.getCell(segRow, 4).alignment = { horizontal: 'right' };
          subs.forEach((_, i) => {
            let total = 0;
            for (let r = 5; r < segRow; r++) {
              if (ws2.getCell(r, 5 + i).value != null) total++;
            }
            ws2.getCell(segRow, 5 + i).value = total || '';
            ws2.getCell(segRow, 5 + i).font = { bold: true };
            ws2.getCell(segRow, 5 + i).alignment = { horizontal: 'center' };
            ws2.getCell(segRow, 5 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          });
          let mrTotal = 0;
          for (let r = 5; r < segRow; r++) mrTotal += Number(ws2.getCell(r, mrCol).value) || 0;
          ws2.getCell(segRow, mrCol).value = mrTotal;
          ws2.getCell(segRow, mrCol).font = { bold: true };
          ws2.getCell(segRow, mrCol).alignment = { horizontal: 'center' };
          ws2.getCell(segRow, mrCol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          segRow++;
        }

        // Bordes en hoja seguimiento (incluyendo las 4 cols extras)
        for (let r = 1; r < segRow; r++) {
          for (let c = 1; c <= totalCols2; c++) {
            ws2.getCell(r, c).border = {
              top: { style: 'thin', color: { argb: 'FF000000' } },
              left: { style: 'thin', color: { argb: 'FF000000' } },
              bottom: { style: 'thin', color: { argb: 'FF000000' } },
              right: { style: 'thin', color: { argb: 'FF000000' } }
            };
          }
        }

        ws2.getColumn(1).width = 4;
        ws2.getColumn(2).width = 16;
        ws2.getColumn(3).width = 16;
        // Anchos para las 4 cols extras (espacio cómodo para anotaciones a mano)
        for (let i = 0; i < EXTRA_COLS.length; i++) {
          ws2.getColumn(mrCol + 1 + i).width = 22;
        }
        ws2.getColumn(4).width = 18;
        for (let i = 0; i < subs.length; i++) ws2.getColumn(5 + i).width = 8;
        ws2.getColumn(totalCols2).width = 6;
      }

      // ─── HOJA: CUADRO DE HONOR ───
      if (allBest.length > 0) {
        const ranked = allBest.sort((a, b) => b.promedio - a.promedio);
        const wsH = wb.addWorksheet('cuadro de honor', {
          pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });
        wsH.mergeCells(1, 1, 1, 6);
        wsH.getCell(1, 1).value = 'ESCUELA PREPARATORIA OFICIAL N° 67';
        wsH.getCell(1, 1).font = { bold: true, size: 14 };
        wsH.getCell(1, 1).alignment = { horizontal: 'center' };
        wsH.mergeCells(2, 1, 2, 6);
        wsH.getCell(2, 1).value = `CUADRO DE HONOR — ${ctx.partialLabel} · CICLO ${ctx.cicloEscolar}`;
        wsH.getCell(2, 1).font = { bold: true, size: 12 };
        wsH.getCell(2, 1).alignment = { horizontal: 'center' };

        ['#', 'GRUPO', 'AP. PATERNO', 'AP. MATERNO', 'NOMBRE', 'PROMEDIO'].forEach((h, i) => {
          const cell = wsH.getCell(4, i + 1);
          cell.value = h;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.alignment = { horizontal: 'center' };
        });

        ranked.forEach((r, i) => {
          const row = 5 + i;
          wsH.getCell(row, 1).value = i + 1;
          wsH.getCell(row, 2).value = r.grupo;
          wsH.getCell(row, 3).value = r.apellido1;
          wsH.getCell(row, 4).value = r.apellido2;
          wsH.getCell(row, 5).value = r.nombres;
          wsH.getCell(row, 6).value = r.promedio;
          [1, 2, 6].forEach(c => wsH.getCell(row, c).alignment = { horizontal: 'center' });
          wsH.getCell(row, 6).font = { bold: true };
          // Top 3 destacados
          if (i === 0) wsH.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD700' } };
          else if (i === 1) wsH.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0C0C0' } };
          else if (i === 2) wsH.getCell(row, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCD7F32' } };
        });

        const lastRowH = 4 + ranked.length;
        for (let r = 4; r <= lastRowH; r++) {
          for (let c = 1; c <= 6; c++) {
            wsH.getCell(r, c).border = {
              top: { style: 'thin', color: { argb: 'FF000000' } },
              left: { style: 'thin', color: { argb: 'FF000000' } },
              bottom: { style: 'thin', color: { argb: 'FF000000' } },
              right: { style: 'thin', color: { argb: 'FF000000' } }
            };
          }
        }
        wsH.getColumn(1).width = 5;
        wsH.getColumn(2).width = 8;
        wsH.getColumn(3).width = 18;
        wsH.getColumn(4).width = 18;
        wsH.getColumn(5).width = 22;
        wsH.getColumn(6).width = 10;
      }

      // Descargar
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = Utils.fileName({
        tipo: 'CONCENTRADO',
        turno: ctx.turno,
        grupo: ctx.modo === 'uno' ? ctx.targetGroups[0].nombre : null,
        grado: ctx.modo === 'uno' ? null : ctx.grado,
        maestro: ctx.orientador,
        parcial: ctx.partial,
        ext: 'xlsx'
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      Toast.show('Excel descargado', 'success');
    } catch (err) {
      console.error('[exportOrientaciónStyledExcel] Error:', err);
      Toast.show('Error generando Excel: ' + (err.message || 'desconocido'), 'error');
    }
  }

  // PDF / Imprimir: abre nueva ventana con el HTML imprimible (concentrado + seguimiento + cuadro de honor)
  async function printOrientacion() {
    try {
      const ctx = await _resolveTargetGroupsAndMeta();
      if (!ctx) return;
      Toast.show(`Generando impresión de ${ctx.targetGroups.length} grupo(s)...`, 'info');
      const html = buildOrientacionPrintHTML(ctx.orientador, ctx.targetGroups, ctx.partial, ctx.partialLabel, ctx.cicloEscolar, ctx.turno);
      const w = window.open('', '_blank');
      if (!w) { Toast.show('Permite ventanas emergentes para abrir la vista de impresión', 'warning'); return; }
      w.document.write(html);
      w.document.close();
      Toast.show('Vista de impresión abierta. Usa Ctrl/Cmd+P o el botón "Imprimir" en la barra superior para guardar como PDF', 'success');
    } catch (err) {
      console.error('[printOrientación] Error:', err);
      Toast.show('Error: ' + (err.message || 'desconocido'), 'error');
    }
  }

  async function exportOrientacion() {
    try {
      const turno = _chipValue("turno");
      const grado = _chipValue("grado");
      const grupoSel = _chipValue("grupo");
      const partial = _chipValue("parcial") || 'P1';
      if (!turno) { Toast.show('Selecciona turno', 'warning'); return; }
      if (!grado) { Toast.show('Selecciona grado', 'warning'); return; }

      // Si el usuario a\u00fan no ha cargado datos (raro) \u2192 forzar recarga
      if (!Array.isArray(allGroups) || allGroups.length === 0) {
        Toast.show('Cargando datos...', 'info');
        await loadData();
      }

      const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
      const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

      let targetGroups = allGroups.filter(g => g.turno === turno && String(g.grado) === String(grado));
      if (grupoSel) targetGroups = targetGroups.filter(g => g.id === grupoSel);
      targetGroups.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      if (targetGroups.length === 0) { Toast.show('No hay grupos para esa selecci\u00f3n', 'warning'); return; }

      // Validar que haya subjects para ese grado
      const subsForGrado = allSubjects.filter(s => String(s.grado) === String(grado));
      if (subsForGrado.length === 0) {
        Toast.show(`No hay materias registradas para ${grado}\u00b0 grado`, 'warning');
        return;
      }

      Toast.show(`Generando concentrado para ${targetGroups.length} grupo(s)...`, 'info');
      console.log('[exportOrientación]', { turno, grado, grupoSel, partial, targetGroups: targetGroups.length, subsForGrado: subsForGrado.length, students: allStudents.length, grades: allGrades.length });

      const spec = buildOrientacionWorkbookSpec(targetGroups, partial, partialLabel, cicloEscolar, turno);
      const groupTag = grupoSel ? targetGroups[0].nombre : `${grado}\u00ba`;
      const fname = `Concentrado_Orientación_${turno}_${groupTag}_${partial}.xlsx`;
      const buf = await XlsxWorker.serialize(spec);
      downloadXlsxBuffer(buf, fname);
      Toast.show(`Generado: ${fname}`, 'success');
    } catch (err) {
      console.error('[exportOrientación] Error:', err);
      Toast.show('Error generando XLSX: ' + (err.message || 'desconocido'), 'error');
    }
  }

  // Cache de blobs generados para descarga/compartir individual
  let _massCache = []; // [{ orientador, filename, blob, url, groups, groupObjs, partial, partialLabel, turno, cicloEscolar }]

  // Color de bloque para cada materia (azul=tronco comun, verde=tecnologica, amarillo=formativa, rojo=ingles)
  function subjectBlockColor(name) {
    const n = (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (/INGL[EÉ]S/.test(n)) return '#fde0d8'; // rojo claro
    if (/ARTISTIC|FISICAS|DEPORTIV|SALUD|IGUALDAD|DERECHOS|SEXUALIDAD|GENERO|FILOSOF|HUMANIDAD|PRACTICA Y COLABORAC/.test(n)) return '#fff7c2'; // amarillo
    if (/COMUNIDADES|MANTENIMIENTO|CULTURA DIGITAL|TALLER DE CULTURA|PAGINAS WEB|DISENO DIGITAL|TALLER DE CIENCIAS/.test(n)) return '#d8f0d3'; // verde
    return '#dbe9f7'; // azul (tronco comun: lengua, matematicas, ciencias, sociales, historia)
  }

  // HTML imprimible para un orientador: concentrados + seguimientos + cuadro de honor
  function buildOrientacionPrintHTML(orientador, groupsOri, partial, partialLabel, cicloEscolar, turno) {
    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const semestreByGrado = { 1: '2\u00ba', 2: '4\u00ba', 3: '6\u00ba' };
    let body = '';
    const allBest = []; // para cuadro de honor

    for (const grp of groupsOri) {
      const subsRaw = allSubjects.filter(s => String(s.grado) === String(grp.grado));
      const subs = (typeof K.sortSubjectsByGrado === 'function')
        ? K.sortSubjectsByGrado(subsRaw, grp.grado) : subsRaw;
      const stus = allStudents.filter(s => s.groupId === grp.id)
        .sort((a, b) => (a.apellido1 || '').localeCompare(b.apellido1 || '') ||
                        (a.apellido2 || '').localeCompare(b.apellido2 || '') ||
                        (a.nombres || '').localeCompare(b.nombres || ''));
      const gMap = {};
      for (const g of allGrades) {
        if (g.partial !== partial || g.groupId !== grp.id) continue;
        gMap[g.studentId] = gMap[g.studentId] || {};
        gMap[g.studentId][g.subjectId] = g;
      }

      // ─── HOJA: CONCENTRADO POR GRUPO ─────────────────────────────
      const headerColors = subs.map(s => subjectBlockColor(s.nombre));
      const headerCols = subs.map((s, i) =>
        `<th colspan="2" class="mat-h" style="background:${headerColors[i]};">${Utils.sanitize(subjectAbbr(s.nombre))}</th>`
      ).join('');
      const fcRow = subs.map((_, i) =>
        `<th class="fc" style="background:${headerColors[i]};">F</th><th class="fc" style="background:${headerColors[i]};">C</th>`
      ).join('');

      body += `<section class="grp-page">
        <div class="hdr">
          <h1>ESCUELA PREPARATORIA OFICIAL N&deg; 67</h1>
          <h2>CONCENTRADO DE CALIFICACIONES &mdash; ${Utils.sanitize(partialLabel)}</h2>
          <div class="info">CICLO ${Utils.sanitize(cicloEscolar)} &middot; TURNO ${Utils.sanitize(turno)} &middot; ${grp.grado}&ordm; GRADO &middot; GRUPO ${Utils.sanitize(grp.nombre)} &middot; SEMESTRE ${semestreByGrado[grp.grado] || ''}</div>
          <div class="info subtle">Orientador(a): <b>${Utils.sanitize(orientador)}</b></div>
        </div>
        <table class="conc">
          <thead>
            <tr>
              <th rowspan="2" class="nl">N.L</th>
              <th rowspan="2" class="ap">AP. PATERNO</th>
              <th rowspan="2" class="ap">AP. MATERNO</th>
              <th rowspan="2" class="nm">NOMBRE</th>
              ${headerCols}
              <th rowspan="2" class="mr-h">M.R</th>
              <th rowspan="2" class="prom-h">PROM</th>
            </tr>
            <tr>${fcRow}</tr>
          </thead>
          <tbody>`;

      // Acumuladores por materia para el footer estadístico del grupo
      const subStats = subs.map(() => ({ sum: 0, cnt: 0, aprob: 0, reprob: 0 }));
      let groupSumProm = 0, groupCntProm = 0, groupSumMR = 0;
      // Métricas ALUMNO-céntricas (no sumar a través de materias):
      //   ALUMNOS APROBADOS = alumnos con 0 reprobadas (todas sus cals ≥ 6)
      //   ALUMNOS IRREGULARES = alumnos con ≥1 reprobada
      let totalAlumnosAprob = 0;
      let totalAlumnosIrregulares = 0;
      let totalAlumnosEvaluados = 0;

      stus.forEach((stu, idx) => {
        const isTraslado = !!stu.bajaPendiente;
        const blankFill = isTraslado ? '' : 0;
        let sumCal = 0, cntCal = 0, mr = 0;
        const cells = subs.map((s, i) => {
          const gd = isTraslado ? null : ((gMap[stu.id] && gMap[stu.id][s.id]) || null);
          const f = gd ? (gd.faltas != null ? Number(gd.faltas) : 0) : '';
          const c = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : '')) : '';
          if (c !== '' && !isNaN(c)) {
            sumCal += Number(c); cntCal++;
            if (Number(c) < passGrade) mr++;
            subStats[i].sum += Number(c);
            subStats[i].cnt++;
            if (Number(c) >= passGrade) subStats[i].aprob++;
            else subStats[i].reprob++;
          }
          const fail = c !== '' && Number(c) < passGrade;
          const cBg = fail ? 'background:#ffd3df;color:#a00;font-weight:700;' : '';
          return `<td class="num">${f === '' ? blankFill : f}</td><td class="num" style="${cBg}">${c === '' ? blankFill : c}</td>`;
        }).join('');
        const prom = cntCal > 0 ? (sumCal / cntCal).toFixed(2) : blankFill;
        const promFail = prom && Number(prom) < passGrade;
        const rowStyle = isTraslado ? ' style="background:#fff7ed;"' : '';
        const nameSuffix = isTraslado ? ' <span style="color:#f97316;font-size:0.7em;font-weight:600;">[TRASLADO]</span>' : '';
        body += `<tr${rowStyle}>
          <td class="num">${idx + 1}</td>
          <td class="ap">${Utils.sanitize(stu.apellido1 || '')}</td>
          <td class="ap">${Utils.sanitize(stu.apellido2 || '')}</td>
          <td class="nm">${Utils.sanitize(stu.nombres || '')}${nameSuffix}</td>
          ${cells}
          <td class="num mr ${mr > 0 ? 'mr-warn' : ''}">${isTraslado ? '' : mr}</td>
          <td class="num bold" style="${promFail ? 'background:#ffd3df;color:#a00;' : prom && Number(prom) >= 9 ? 'background:#d4edda;color:#155724;' : ''}">${prom}</td>
        </tr>`;
        if (cntCal > 0) {
          totalAlumnosEvaluados++;
          if (mr === 0) totalAlumnosAprob++;
          else totalAlumnosIrregulares++;
          allBest.push({
            grupo: grp.nombre, grado: grp.grado,
            apellido1: stu.apellido1 || '', apellido2: stu.apellido2 || '',
            nombres: stu.nombres || '', promedio: Number(prom)
          });
          groupSumProm += Number(prom);
          groupCntProm++;
          groupSumMR += mr;
        }
      });
      body += `</tbody>`;

      // ─── TFOOT: estadísticas por materia (PROMEDIO / APROB / %APROB / REPROB / %REPROB) ───
      // Cada fila tiene su rótulo a la izquierda (colspan=4 = nl + ap1 + ap2 + nombre)
      // y un valor por materia (colspan=2 = F + C). Las dos columnas finales (M.R y PROM)
      // muestran el dato global del grupo donde aplica.
      const stRow = (label, valuesPerSub, lastTwo, bg, color) => {
        const cells = valuesPerSub.map((v, i) =>
          `<td colspan="2" class="num bold" style="background:${headerColors[i]};text-align:center;">${v}</td>`
        ).join('');
        return `<tr style="background:${bg};color:${color};font-weight:700;font-size:7.5pt;">
          <td colspan="4" class="ap" style="text-align:right;padding-right:6px;background:${bg};color:${color};">${label}</td>
          ${cells}
          <td class="num">${lastTwo[0]}</td>
          <td class="num">${lastTwo[1]}</td>
        </tr>`;
      };

      const promPerSub = subStats.map(s => s.cnt > 0 ? (s.sum / s.cnt).toFixed(2) : '—');
      const aprobPerSub = subStats.map(s => s.aprob);
      const reprobPerSub = subStats.map(s => s.reprob);
      const pctAprobPerSub = subStats.map(s => s.cnt > 0 ? ((s.aprob * 100 / s.cnt).toFixed(1) + '%') : '—');
      const pctReprobPerSub = subStats.map(s => s.cnt > 0 ? ((s.reprob * 100 / s.cnt).toFixed(1) + '%') : '—');

      const groupProm = groupCntProm > 0 ? (groupSumProm / groupCntProm).toFixed(2) : '—';
      // TOTAL alumno-céntrico (cuadra contra los alumnos reales evaluados del grupo)
      const groupPctAprob = totalAlumnosEvaluados > 0 ? ((totalAlumnosAprob * 100 / totalAlumnosEvaluados).toFixed(1) + '%') : '—';
      const groupPctReprob = totalAlumnosEvaluados > 0 ? ((totalAlumnosIrregulares * 100 / totalAlumnosEvaluados).toFixed(1) + '%') : '—';

      body += `<tfoot>
        ${stRow('PROMEDIO', promPerSub, [groupSumMR, groupProm], '#f3f4f6', '#1f2937')}
        ${stRow('ALUMNOS APROBADOS', aprobPerSub, ['', totalAlumnosAprob], '#d4edda', '#155724')}
        ${stRow('% APROBACION', pctAprobPerSub, ['', groupPctAprob], '#d4edda', '#155724')}
        ${stRow('ALUMNOS REPROBADOS', reprobPerSub, ['', totalAlumnosIrregulares], '#ffd3df', '#a00')}
        ${stRow('% REPROBACION', pctReprobPerSub, ['', groupPctReprob], '#ffd3df', '#a00')}
      </tfoot></table></section>`;

      // ─── HOJA: SEGUIMIENTO / CASOS ESPECIALES POR GRUPO ──────────
      // Incluye 4 columnas vacías al final para anotaciones a mano del orientador
      const EXTRA_COLS_HTML = ['Problemas conductuales', 'Problemas económicos', 'Problemas familiares', 'Salud / Comentarios'];
      const segHeaderCols = subs.map((s, i) =>
        `<th class="mat-h" style="background:${headerColors[i]};font-size:7pt;padding:4px 2px;">${Utils.sanitize(subjectAbbr(s.nombre))}</th>`
      ).join('');
      const extraHeaderCols = EXTRA_COLS_HTML.map(label =>
        `<th style="background:#e0e7ff;color:#1e3a8a;font-size:6.5pt;padding:4px 3px;font-weight:700;min-width:90px;">${Utils.sanitize(label)}</th>`
      ).join('');
      const emptyExtraCells = EXTRA_COLS_HTML.map(() =>
        `<td style="background:#fafbff;height:36px;border:1px dashed #cbd5e1;"></td>`
      ).join('');

      const segRows = [];
      let segIdx = 1;
      const totalsBySubject = subs.map(() => 0);
      stus.forEach(stu => {
        const sg = gMap[stu.id] || {};
        const cellsArr = subs.map(s => {
          const gd = sg[s.id];
          const cal = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : null)) : null;
          return (cal != null && !isNaN(cal) && cal < passGrade) ? cal : '';
        });
        const mr = cellsArr.filter(c => c !== '').length;
        if (mr > 0) {
          cellsArr.forEach((v, i) => { if (v !== '') totalsBySubject[i]++; });
          segRows.push(`<tr>
            <td class="num">${segIdx++}</td>
            <td class="ap">${Utils.sanitize(stu.apellido1 || '')}</td>
            <td class="ap">${Utils.sanitize(stu.apellido2 || '')}</td>
            <td class="nm">${Utils.sanitize(stu.nombres || '')}</td>
            ${cellsArr.map(v => `<td class="num" style="${v !== '' ? 'background:#ffd3df;color:#a00;font-weight:700;' : ''}">${v}</td>`).join('')}
            <td class="num mr-warn">${mr}</td>
            ${emptyExtraCells}
          </tr>`);
        }
      });
      const totalsRow = `<tr style="font-weight:700;background:#f0f0f0;">
        <td colspan="4" class="ap" style="text-align:right;">TOTAL</td>
        ${totalsBySubject.map(t => `<td class="num">${t || ''}</td>`).join('')}
        <td class="num">${totalsBySubject.reduce((a, b) => a + b, 0)}</td>
        ${EXTRA_COLS_HTML.map(() => '<td></td>').join('')}
      </tr>`;

      const totalSegCols = 4 + subs.length + 1 + EXTRA_COLS_HTML.length;
      body += `<section class="grp-page">
        <div class="hdr">
          <h1>ESCUELA PREPARATORIA OFICIAL N&deg; 67</h1>
          <h2>SEGUIMIENTO / CASOS ESPECIALES &mdash; ${Utils.sanitize(partialLabel)}</h2>
          <div class="info">CICLO ${Utils.sanitize(cicloEscolar)} &middot; TURNO ${Utils.sanitize(turno)} &middot; ${grp.grado}&ordm; GRADO &middot; GRUPO ${Utils.sanitize(grp.nombre)}</div>
          <div class="info subtle">Orientador(a): <b>${Utils.sanitize(orientador)}</b></div>
        </div>
        <table class="seg">
          <thead>
            <tr>
              <th class="nl">#</th>
              <th class="ap">AP. PATERNO</th>
              <th class="ap">AP. MATERNO</th>
              <th class="nm">NOMBRE</th>
              ${segHeaderCols}
              <th class="mr-h">M.R</th>
              ${extraHeaderCols}
            </tr>
          </thead>
          <tbody>${segRows.length ? segRows.join('') : `<tr><td colspan="${totalSegCols}" style="text-align:center;padding:14px;color:#666;font-style:italic;">Sin alumnos reprobados en este parcial</td></tr>`}
          ${segRows.length ? totalsRow : ''}
          </tbody>
        </table>
      </section>`;
    }

    // ─── HOJA FINAL: CUADRO DE HONOR / MEJORES PROMEDIOS ──────────
    // Top 3 ranking denso por grupo
    const groupNames = [...new Set(groupsOri.map(g => g.nombre))];
    const honorByGroup = {};
    for (const grpName of groupNames) {
      const list = allBest.filter(s => s.grupo === grpName).sort((a, b) => b.promedio - a.promedio);
      // Ranking denso
      let rank = 0, lastP = null;
      const ranked = list.map(s => {
        if (s.promedio !== lastP) { rank++; lastP = s.promedio; }
        return { ...s, rank };
      });
      honorByGroup[grpName] = ranked;
    }

    let honorBody = `<section class="grp-page">
      <div class="hdr">
        <h1>ESCUELA PREPARATORIA OFICIAL N&deg; 67</h1>
        <h2>MEJORES PROMEDIOS &mdash; ${Utils.sanitize(partialLabel)}</h2>
        <div class="info">CICLO ${Utils.sanitize(cicloEscolar)} &middot; TURNO ${Utils.sanitize(turno)}</div>
        <div class="info subtle">Orientador(a): <b>${Utils.sanitize(orientador)}</b></div>
      </div>`;

    for (const grpName of groupNames) {
      const ranked = honorByGroup[grpName];
      const grado = (groupsOri.find(g => g.nombre === grpName) || {}).grado || '';
      const gradoTxt = { 1: 'PRIMERO', 2: 'SEGUNDO', 3: 'TERCERO' }[grado] || `${grado}\u00b0`;
      const grpNum = grpName.split('-')[1] || grpName;
      const grpTxt = { '1': 'UNO', '2': 'DOS', '3': 'TRES' }[grpNum] || grpNum;

      honorBody += `<table class="honor">
        <thead>
          <tr><th colspan="5" class="honor-title">${gradoTxt} ${grpTxt}</th></tr>
          <tr><th class="nl">#</th><th class="ap">AP. PATERNO</th><th class="ap">AP. MATERNO</th><th class="nm">NOMBRE</th><th class="prom-h">PROM</th></tr>
        </thead>
        <tbody>`;
      ranked.forEach((s, idx) => {
        const lugar = s.rank === 1 ? '1\u00ba' : s.rank === 2 ? '2\u00ba' : s.rank === 3 ? '3\u00ba' : '';
        const lugarBg = s.rank === 1 ? 'background:#ffd9d9;' : s.rank === 2 ? 'background:#d4e7ff;' : s.rank === 3 ? 'background:#d4f0d4;' : '';
        honorBody += `<tr>
          <td class="num">${idx + 1}</td>
          <td class="ap">${Utils.sanitize(s.apellido1)}</td>
          <td class="ap">${Utils.sanitize(s.apellido2)}</td>
          <td class="nm">${Utils.sanitize(s.nombres)}</td>
          <td class="num"><span style="font-weight:700;">${s.promedio.toFixed(1)}</span> ${lugar ? `<span style="display:inline-block;padding:1px 8px;border-radius:4px;font-weight:700;${lugarBg}">${lugar}</span>` : ''}</td>
        </tr>`;
      });
      honorBody += `</tbody></table>`;
    }
    honorBody += `</section>`;
    body += honorBody;

    const _firstGroup = (groupsOri && groupsOri[0]) || {};
    const _docTitle = Utils.fileName({
      tipo: 'CONCENTRADO',
      turno: turno,
      grupo: groupsOri && groupsOri.length === 1 ? _firstGroup.nombre : null,
      grado: groupsOri && groupsOri.length > 1 ? _firstGroup.grado : null,
      maestro: orientador,
      parcial: partial
    });
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>${Utils.sanitize(_docTitle)}</title>
      <style>
        @page { size: letter landscape; margin: 8mm 6mm; }
        * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; padding: 4mm; }
        .toolbar { position: sticky; top:0; background:#1b3a5c; color:#fff; padding:8px 14px; margin:-4mm -4mm 8mm -4mm; display:flex; gap:10px; align-items:center; justify-content:space-between; z-index:100; }
        .toolbar h3 { margin:0; font-size:13pt; font-weight:700; }
        .toolbar .meta { font-size:9pt; opacity:0.85; }
        .toolbar button { background:#fff; color:#1b3a5c; border:0; padding:6px 14px; border-radius:4px; font-weight:700; cursor:pointer; font-size:11pt; }
        @media print { .toolbar { display:none; } body { padding:0; } }

        .grp-page { page-break-after: always; }
        .grp-page:last-child { page-break-after: auto; }

        .hdr { text-align:center; margin-bottom:6px; }
        .hdr h1 { font-size:11pt; font-weight:700; }
        .hdr h2 { font-size:10pt; font-weight:700; color:#1b3a5c; }
        .hdr .info { font-size:9pt; color:#333; margin-top:1px; }
        .hdr .subtle { font-size:8.5pt; color:#666; }

        table.conc, table.seg, table.honor { width:100%; border-collapse:collapse; font-size:8pt; margin-top:4px; }
        table.conc th, table.conc td, table.seg th, table.seg td, table.honor th, table.honor td {
          border:0.6px solid #555; padding:1.5px 3px;
        }
        table.conc thead th, table.seg thead th, table.honor thead th {
          background:#e8ecf1; font-weight:700; text-align:center; font-size:7.5pt;
        }
        table.conc th.fc, table.seg th.fc { width:18px; font-size:7pt; }
        table.conc th.mat-h, table.seg th.mat-h { font-size:7pt; padding:3px 1px; }
        table.conc th.nl, table.seg th.nl, table.honor th.nl { width:22px; }
        table.conc th.ap, table.seg th.ap, table.honor th.ap { width:80px; }
        table.conc th.nm, table.seg th.nm, table.honor th.nm { width:100px; }
        table.conc th.mr-h, table.seg th.mr-h { width:24px; }
        table.conc th.prom-h, table.honor th.prom-h { width:55px; }
        table.conc td.num, table.seg td.num, table.honor td.num { text-align:center; font-variant-numeric:tabular-nums; }
        table.conc td.bold { font-weight:700; }
        table.conc td.ap, table.conc td.nm, table.seg td.ap, table.seg td.nm, table.honor td.ap, table.honor td.nm {
          font-size:8pt; text-transform:uppercase;
        }
        table.conc td.mr-warn, table.seg .mr-warn { background:#ffd3df; color:#a00; font-weight:700; }
        table.honor th.honor-title {
          background:#1b3a5c !important; color:#fff !important; font-size:11pt;
          padding:6px; letter-spacing:1px;
        }
        table.honor { margin-bottom:8px; }
      </style>
      </head><body>
        <div class="toolbar">
          <div>
            <h3>${Utils.sanitize(orientador)}</h3>
            <div class="meta">${groupsOri.length} grupo(s): ${groupsOri.map(g => g.nombre).join(' &middot; ')}</div>
          </div>
          <button onclick="window.print()">&#128424; Imprimir / Guardar PDF</button>
        </div>
        ${body}
      </body></html>`;
  }

  // Genera xlsx por orientador del turno y muestra UI con botones individuales.
  // Usa Web Worker (XlsxWorker) para que la serializacion XLSX no bloquee el main thread.
  async function exportOrientacionMasivo() {
    try {
      const turno = _chipValue("turno");
      const partial = _chipValue("parcial") || 'P1';
      if (!turno) { Toast.show('Selecciona el turno', 'warning'); return; }

      const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
      const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

      // Agrupar grupos del turno por orientador
      const turnoGroups = allGroups.filter(g => g.turno === turno).sort((a, b) =>
        (a.grado || 0) - (b.grado || 0) || (a.nombre || '').localeCompare(b.nombre || '')
      );
      if (turnoGroups.length === 0) { Toast.show('No hay grupos en este turno', 'warning'); return; }

      // Agrupar por orientador con clave NORMALIZADA (quita tildes, mayusculas, espacios extra)
      // para que diferencias ortograficas (ORTIZ vs ORTÍZ) no creen 2 archivos del mismo orientador.
      const byOrientadorKey = {};
      for (const g of turnoGroups) {
        const ori = (typeof K.getOrientador === 'function' ? K.getOrientador(g.turno, g.nombre) : null) ||
                    g.orientador || 'SIN ORIENTADOR';
        const key = ori.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
        if (!byOrientadorKey[key]) byOrientadorKey[key] = { display: ori, groups: [] };
        byOrientadorKey[key].groups.push(g);
      }
      const byOrientador = {};
      for (const k of Object.keys(byOrientadorKey)) {
        byOrientador[byOrientadorKey[k].display] = byOrientadorKey[k].groups;
      }

      const orientadores = Object.keys(byOrientador).sort();
      Toast.show(`Generando ${orientadores.length} archivo(s)...`, 'info');

      // Limpiar cache previa
      _massCache.forEach(it => { try { URL.revokeObjectURL(it.url); } catch (e) {} });
      _massCache = [];

      for (let oi = 0; oi < orientadores.length; oi++) {
        const ori = orientadores[oi];
        const groupsOri = byOrientador[ori];

        // Construir spec con portada al inicio
        const spec = buildOrientacionWorkbookSpec(groupsOri, partial, partialLabel, cicloEscolar, turno);
        const portada = {
          name: 'Portada',
          aoa: [
            [`ESCUELA PREPARATORIA OFICIAL N\u00ba 67`],
            [`CONCENTRADO POR ORIENTADOR`],
            [`${partialLabel}   CICLO ${cicloEscolar}   TURNO ${turno}`],
            [],
            [`Orientador(a):`, ori],
            [`Grupos asignados:`, groupsOri.map(g => g.nombre).join(', ')],
            [`Total grupos:`, groupsOri.length],
          ],
          cols: [{ wch: 22 }, { wch: 60 }]
        };
        spec.sheets = [portada].concat(spec.sheets);

        // Serializar en Web Worker (no bloquea main thread)
        const buf = await XlsxWorker.serialize(spec);
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const filename = `Concentrado_${turno}_${safeFilename(ori)}_${partial}.xlsx`;
        _massCache.push({
          orientador: ori, groups: groupsOri.map(g => g.nombre), groupObjs: groupsOri,
          filename, blob, url,
          partial, partialLabel, turno, cicloEscolar
        });

        // Progreso visible y yield al main thread entre orientadores
        Toast.show(`Generando ${oi + 1}/${orientadores.length}...`, 'info');
        await new Promise(r => setTimeout(r, 0));
      }

      _renderMassCacheUI(turno, partial);
      Toast.show(`${orientadores.length} archivo(s) listos. Descarga desde la lista.`, 'success');
    } catch (e) {
      console.error('Error en exportOrientaciónMasivo:', e);
      Toast.show('Error: ' + e.message, 'error');
    }
  }

  function _renderMassCacheUI(turno, partial) {
    const div = document.getElementById('conc-results');
    if (!div) return;
    const items = _massCache.map((it, i) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;color:#1b3a5c;font-size:14px;">${Utils.sanitize(it.orientador)}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">
            <span style="display:inline-block;padding:2px 8px;background:#e8ecf1;border-radius:4px;margin-right:6px;">${it.groups.length} grupo(s)</span>
            ${it.groups.map(g => `<span style="margin-right:6px;">${Utils.sanitize(g)}</span>`).join('')}
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-family:monospace;">${Utils.sanitize(it.filename)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
          <button class="btn btn-warning btn-sm" data-action="mass-preview" data-idx="${i}" title="Ver en pantalla y guardar como PDF" style="white-space:nowrap;">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">visibility</span> Ver / PDF
          </button>
          <a href="${it.url}" download="${Utils.sanitize(it.filename)}" class="btn btn-primary btn-sm" style="white-space:nowrap;">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">file_download</span> Excel
          </a>
          <button class="btn btn-outline btn-sm" data-action="mass-copy-name" data-idx="${i}" title="Copiar nombre del archivo">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">content_copy</span>
          </button>
        </div>
      </div>
    `).join('');

    div.innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <h2 class="section-title" style="margin:0;">Archivos generados (${_massCache.length})</h2>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-success" data-action="mass-download-zip">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">archive</span>
              Descargar todo (.zip)
            </button>
            <button class="btn btn-outline" data-action="mass-clear">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">close</span>
              Limpiar
            </button>
          </div>
        </div>
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;">
          Turno: <strong>${Utils.sanitize(turno)}</strong> &middot; Parcial: <strong>${Utils.sanitize(partial)}</strong>
          &middot; Haz clic en <strong>Descargar</strong> al lado del orientador que necesites.
        </div>
        ${items}
      </div>`;
  }

  async function _massDownloadZip() {
    if (!_massCache.length) { Toast.show('No hay archivos en cache', 'warning'); return; }
    await Lib.jszip();
    Toast.show('Empaquetando...', 'info');
    const zip = new JSZip();
    for (const it of _massCache) {
      const buf = await it.blob.arrayBuffer();
      zip.file(it.filename, buf);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Concentrados_${_massCache.length}_orientadores.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    Toast.show('ZIP descargado', 'success');
  }

  function _massClearCache() {
    _massCache.forEach(it => { try { URL.revokeObjectURL(it.url); } catch (e) {} });
    _massCache = [];
    const div = document.getElementById('conc-results');
    if (div) div.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">table_chart</span><p class="empty-state-text">Selecciona turno, grado, grupo y parcial, luego haz clic en Generar</p></div>`;
  }

  function _massCopyName(idx) {
    const it = _massCache[idx];
    if (!it) return;
    navigator.clipboard.writeText(it.filename).then(() => Toast.show(`Copiado: ${it.filename}`, 'success'))
      .catch(() => Toast.show('No se pudo copiar', 'error'));
  }

  function _massPreview(idx) {
    const it = _massCache[idx];
    if (!it) return;
    const html = buildOrientacionPrintHTML(it.orientador, it.groupObjs, it.partial, it.partialLabel, it.cicloEscolar, it.turno);
    const w = window.open('', '_blank');
    if (!w) { Toast.show('Permite ventanas emergentes para ver el PDF', 'warning'); return; }
    w.document.write(html);
    w.document.close();
  }

  // Helper: ejecuta una acción del Concentrado mostrando spinner y manejo de errores.
  async function _runConcAction(btn, fn) {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    try {
      await fn();
    } catch (e) {
      console.error('Error en acción Concentrado:', e);
      Toast.show('Error: ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }

  // ─── NUEVO: REPORTE DE "MIS GRUPOS" (orientador) ───
  // Genera 1 archivo combinado con SUS grupos específicos (no todo el turno).
  // El concentrado de orientación es para los grupos que la orientadora atiende
  // directamente — no todo el turno.
  async function _generateMyOrientadorReport(format, partial) {
    if (!allGroups.length) await loadData();
    if (!allGroups.length) {
      Toast.show('No tienes grupos asignados como orientador', 'warning');
      return;
    }
    // Filtrar a SOLO los grupos donde la persona es orientador (no todo el turno)
    const oriIds = new Set(orientadorGroupIds || []);
    const myGroups = oriIds.size > 0
      ? allGroups.filter(g => oriIds.has(g.id))
      : allGroups;
    if (myGroups.length === 0) {
      Toast.show('No tienes grupos asignados como orientador directo', 'warning');
      return;
    }
    const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
    const orientador = (App.currentUser?.displayName || App.currentUser?.email || 'ORIENTADOR').toUpperCase();
    const turno = myGroups[0]?.turno || 'MATUTINO';

    if (format === 'pdf') {
      const html = buildOrientacionPrintHTML(orientador, myGroups, partial, partialLabel, cicloEscolar, turno);
      const w = window.open('', '_blank');
      if (!w) { Toast.show('Permite ventanas emergentes para ver el PDF', 'warning'); return; }
      w.document.write(html);
      w.document.close();
      return;
    }

    Toast.show('Generando Excel…', 'info', 4000);
    const spec = buildOrientacionWorkbookSpec(myGroups, partial, partialLabel, cicloEscolar, turno);
    const portada = {
      name: 'Portada',
      aoa: [
        [`ESCUELA PREPARATORIA OFICIAL Nº 67`],
        [`CONCENTRADO DE ORIENTACIÓN`],
        [`${partialLabel}   CICLO ${cicloEscolar}   TURNO ${turno}`],
        [],
        [`Orientador(a):`, orientador],
        [`Grupos asignados:`, myGroups.map(g => g.nombre).join(', ')],
        [`Total grupos:`, myGroups.length],
      ],
      cols: [{ wch: 22 }, { wch: 60 }]
    };
    spec.sheets = [portada].concat(spec.sheets);
    const buf = await XlsxWorker.serialize(spec);
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Concentrado_${turno}_${safeFilename(orientador)}_${partial}_${dateTag}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    Toast.show('✓ Excel descargado', 'success');
  }

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      // ─── NUEVAS ACCIONES SIMPLIFICADAS ───
      if (action === 'conc-zip-orientadores') {
        // Admin: ZIP por orientador del turno (función ya existente)
        const turno = btn.dataset.turno;
        const partial = _chipValue('parcial') || 'P2';
        _runConcAction(btn, async () => {
          await generateZipOrientadoresByTurno(turno, partial);
        });
        return;
      }
      if (action === 'conc-mio-excel' || action === 'conc-mio-pdf') {
        // Orientador: descarga directa de sus grupos (1 archivo combinado por grado)
        const partial = _chipValue('parcial') || 'P2';
        _runConcAction(btn, async () => {
          await _generateMyOrientadorReport(action === 'conc-mio-pdf' ? 'pdf' : 'excel', partial);
        });
        return;
      }
      // Acciones viejas (compatibilidad si algún botón aún las llama)
      if (action === 'orientación-print') printOrientacion();
      else if (action === 'orientación-excel') exportOrientacionStyledExcel();
      else if (action === 'orientación-masivo') {
        if (App.currentUser?.role !== 'admin') {
          Toast.show('Solo administración puede generar el masivo por orientador', 'warning');
          return;
        }
        exportOrientacionMasivo();
      }
      else if (action === 'mass-download-zip') _massDownloadZip();
      else if (action === 'mass-clear') _massClearCache();
      else if (action === 'mass-copy-name') _massCopyName(Number(btn.dataset.idx));
      else if (action === 'mass-preview') _massPreview(Number(btn.dataset.idx));
    });

    // CHIP FILTERS: clic en cualquier chip → marcar activo y reaccionar
    const chipBar = document.getElementById('conc-chip-filters');
    const grupoRow = document.getElementById('conc-grupo-row');
    if (chipBar) {
      chipBar.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const filter = chip.dataset.filter;
        const value = chip.dataset.value || '';
        _setActiveChip(filter, value);
        // Si cambió turno o grado, re-generar chips de grupo
        if (filter === 'turno' || filter === 'grado') updateGroupOptions();
        // Si cambió modo, mostrar/ocultar fila de grupo
        if (filter === 'modo' && grupoRow) {
          grupoRow.style.display = value === 'uno' ? '' : 'none';
        }
      });
    }
  }

  // ─── API PÚBLICA: GENERAR ZIP POR TURNO (llamable desde Indicadores) ───
  // Carga datos si hace falta, agrupa por orientador, genera 1 xlsx por orientador
  // (con la portada + hojas 1°X + seg 1°X "casos especiales" + cuadro de honor)
  // y descarga TODO directo como un .zip sin necesidad de la UI de Concentrado.
  async function generateZipOrientadoresByTurno(turno, partial) {
    if (!turno || !['MATUTINO', 'VESPERTINO'].includes(turno)) {
      Toast.show('Turno inválido', 'error');
      return false;
    }
    partial = partial || 'P2';
    const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

    // Cargar datos si todavía no se cargaron (Indicadores no llama loadData)
    if (!allGroups.length) await loadData();
    if (!allGroups.length) {
      Toast.show('No se pudieron cargar los grupos', 'error');
      return false;
    }

    // Filtrar grupos del turno
    const turnoGroups = allGroups.filter(g => g.turno === turno).sort((a, b) =>
      (a.grado || 0) - (b.grado || 0) || (a.nombre || '').localeCompare(b.nombre || '')
    );
    if (turnoGroups.length === 0) {
      Toast.show(`No hay grupos en turno ${turno}`, 'warning');
      return false;
    }

    // Agrupar por orientador (clave normalizada: sin tildes, mayúsculas)
    const byOrientadorKey = {};
    for (const g of turnoGroups) {
      const ori = (typeof K.getOrientador === 'function' ? K.getOrientador(g.turno, g.nombre) : null) ||
                  g.orientador || 'SIN ORIENTADOR';
      const key = ori.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
      if (!byOrientadorKey[key]) byOrientadorKey[key] = { display: ori, groups: [] };
      byOrientadorKey[key].groups.push(g);
    }
    const orientadores = Object.values(byOrientadorKey).sort((a, b) => a.display.localeCompare(b.display));

    Toast.show(`Generando ${orientadores.length} reporte(s) del turno ${turno}…`, 'info', 8000);

    // Cargar JSZip
    await Lib.jszip();
    const zip = new JSZip();

    // Generar 1 xlsx por orientador
    for (let oi = 0; oi < orientadores.length; oi++) {
      const { display: ori, groups: groupsOri } = orientadores[oi];

      const spec = buildOrientacionWorkbookSpec(groupsOri, partial, partialLabel, cicloEscolar, turno);
      // Portada al inicio
      const portada = {
        name: 'Portada',
        aoa: [
          [`ESCUELA PREPARATORIA OFICIAL Nº 67`],
          [`CONCENTRADO POR ORIENTADOR`],
          [`${partialLabel}   CICLO ${cicloEscolar}   TURNO ${turno}`],
          [],
          [`Orientador(a):`, ori],
          [`Grupos asignados:`, groupsOri.map(g => g.nombre).join(', ')],
          [`Total grupos:`, groupsOri.length],
        ],
        cols: [{ wch: 22 }, { wch: 60 }]
      };
      spec.sheets = [portada].concat(spec.sheets);

      // Serializar a buffer xlsx (web worker para no bloquear UI)
      const buf = await XlsxWorker.serialize(spec);
      const filename = `Concentrado_${turno}_${safeFilename(ori)}_${partial}.xlsx`;
      zip.file(filename, buf);

      // Yield al main thread cada cierto número para no congelar la UI
      if ((oi + 1) % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    // Comprimir y descargar
    Toast.show('Comprimiendo .zip…', 'info');
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Reportes_Orientadores_${turno}_${partial}_${dateTag}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    Toast.show(`✓ ZIP descargado: ${orientadores.length} orientador(es)`, 'success', 6000);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // REPORTE INDICADORES POR TURNO (formato INDICADORES 2 BIM.xlsx)
  // ═══════════════════════════════════════════════════════════════
  // 5 hojas: PRIMERO, SEGUNDO, TERCERO, CONCENTRADO GENERAL, CASOS ESPECIALES.
  // NO es por orientador — es un único Excel por turno con datos agrupados por grado.

  // Mapeo: nombre OFICIAL de materia → abreviación EXACTA del modelo del usuario.
  // Orden de aparición = orden en este array.
  const INDICADORES_SUBJECTS = {
    1: [
      ['LENGUA Y COMUNICACION II', 'LEN.Y COM II'],
      ['INGLES II', 'INGLÉS II'],
      ['PENSAMIENTO MATEMATICO II', 'PEN. MAT II'],
      ['CULTURA DIGITAL II', 'CULT. DIG II'],
      ['CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGIA II', 'C.NATURALES'],
      ['TALLER DE CIENCIAS I', 'T. CIENCIAS'],
      ['PENSAMIENTO FILOSOFICO Y HUMANIDADES II', 'FILOSOFÍA'],
      ['CIENCIAS SOCIALES II', 'C.SOC. II'],
      ['ACTIVIDADES FISICAS Y DEPORTIVAS II', 'ACTIV. FISICAS II'],
      ['EDUCACION PARA LA SALUD II', 'ED. SALUD II'],
      ['TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS II', 'T.S.I.D.H II'],
    ],
    2: [
      ['PENSAMIENTO LITERARIO', 'P. LITERARIO'],
      ['INGLES IV', 'INGLÉS IV'],
      ['TEMAS SELECTOS DE MATEMATICAS I', 'T.S MAT I'],
      ['CONCIENCIA HISTORICA I', 'C. HISTÓRICA I'],
      ['TALLER DE CULTURA DIGITAL', 'T. CUL. DIG'],
      ['REACCIONES QUIMICAS Y CONSERVACION DE LA MATERIA', 'R. QUIMICAS'],
      ['ESPACIO Y SOCIEDAD', 'ESPACIO Y SOC.'],
      ['CIENCIAS SOCIALES III', 'C.SOC. III'],
      ['COMUNIDADES VIRTUALES', 'C. VIRTUALES.'],
      ['MANTENIMIENTO DE REDES DE COMPUTO', 'M. REDES'],
      ['ACTIVIDADES ARTISTICAS Y CULTURALES I', 'ACT. ART'],
      ['EDUCACION INTEGRAL EN SEXUALIDAD Y GENERO II', 'E.I.S Y G'],
      ['TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS IV', 'T.S.I.D.H IV'],
    ],
    3: [
      ['CIENCIAS DE LA COMUNICACION I', 'C. COMUM'],
      ['TEMAS SELECTOS DE INGLES II', 'T.S.INGLÉS II'],
      ['TEMAS SELECTOS DE MATEMATICAS II', 'T.S MAT II'],
      ['CONCIENCIA HISTORICA III', 'C. HISTÓRICA III'],
      ['ORGANISMOS', 'ORGANISMOS'],
      ['TEMAS SELECTOS DE FILOSOFIA', 'T.S. FILOSOFÍA I'],
      ['ECONOMIA I', 'ECONOMÍA I'],
      ['PAGINAS WEB', 'P. WEB'],
      ['DISENO DIGITAL', 'D. DIG'],
      ['ACTIVIDADES ARTISTICAS Y CULTURALES III', 'ACT. ART III'],
      ['PRACTICA Y COLABORACION CIUDADANA II', 'P. C. CIUD'],
      ['TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS VI', 'T.S.I.D.H  VI'],
    ],
  };

  // Genera el reporte completo y descarga el xlsx
  async function generateIndicadoresReportByTurno(turno, partial) {
    if (!turno || !['MATUTINO', 'VESPERTINO'].includes(turno)) {
      Toast.show('Turno inválido', 'error');
      return false;
    }
    partial = partial || 'P2';
    const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
    const partialNumWord = ({ P1: 'PRIMER', P2: 'SEGUNDO', P3: 'TERCER' })[partial] || partial;
    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

    // Cargar datos si todavía no se cargaron
    if (!allGroups.length) await loadData();
    if (!allGroups.length) { Toast.show('No hay datos disponibles', 'error'); return false; }

    Toast.show(`Generando indicadores del turno ${turno}…`, 'info', 5000);

    // Filtrar grupos del turno, ordenados por grado+nombre
    const turnoGroups = allGroups.filter(g => g.turno === turno).sort((a, b) =>
      (Number(a.grado) || 0) - (Number(b.grado) || 0) || (a.nombre || '').localeCompare(b.nombre || '')
    );
    if (turnoGroups.length === 0) {
      Toast.show(`No hay grupos en turno ${turno}`, 'warning');
      return false;
    }

    await Lib.exceljs();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EPO 67';
    wb.created = new Date();

    // Normalizar nombres para matchear materias del sistema
    const normSubj = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

    // Helper: encuentra el subject object del sistema dado un nombre oficial
    function findSubject(officialName, grado) {
      const target = normSubj(officialName);
      return allSubjects.find(s =>
        String(s.grado) === String(grado) &&
        (normSubj(s.nombre || s.id) === target || normSubj(s.nombre || s.id).includes(target) || target.includes(normSubj(s.nombre || s.id)))
      );
    }

    // Helper: stats POR MATERIA dentro de un grupo.
    // - aprob: alumnos que aprobaron ESA materia (cal >= 6)
    // - reprob: alumnos que reprobaron ESA materia (cal < 6)
    // - incidencias: igual que reprob (porque 1 alumno tiene 1 cal por materia)
    // - total: alumnos con calificación capturada en esa materia
    function statsForSubjectInGroup(subjectId, groupId) {
      const grades = allGrades.filter(g =>
        g.partial === partial && g.groupId === groupId && g.subjectId === subjectId
      );
      let sum = 0, cnt = 0, aprob = 0, reprob = 0;
      for (const g of grades) {
        const cal = g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null);
        if (cal == null || isNaN(cal)) continue;
        sum += cal; cnt++;
        if (cal >= passGrade) aprob++;
        else reprob++;
      }
      return {
        prom: cnt > 0 ? +(sum / cnt).toFixed(2) : null,
        aprob, reprob, total: cnt,
        incidencias: reprob,  // por materia: mismo número que reprob
      };
    }

    // Helper: stats GENERAL del grupo — métricas ALUMNO-céntricas.
    // Un alumno se cuenta UNA SOLA VEZ aunque tenga varias reprobadas.
    //   - aprob   = alumnos del grupo SIN ninguna reprobada en las
    //               materias del grado (todas sus cals >= 6)
    //   - reprob  = alumnos del grupo CON >=1 reprobada
    //   - total   = aprob + reprob (cuadra contra los alumnos evaluados)
    //   - incidencias = sumatoria total de cals < 6 (magnitud del problema)
    //   - prom    = promedio de promedios individuales de los alumnos
    function statsGeneralForGroup(groupId, grado) {
      const subjectsForGrado = INDICADORES_SUBJECTS[grado] || [];
      const subjectIds = subjectsForGrado.map(([oficial]) => {
        const subj = findSubject(oficial, grado);
        return subj ? subj.id : null;
      }).filter(Boolean);
      const students = allStudents.filter(s => s.groupId === groupId && !s.bajaPendiente);
      let promSum = 0, promCnt = 0;
      let aprobAlumnos = 0, reprobAlumnos = 0;
      let totalIncidencias = 0;
      for (const stu of students) {
        const studentGrades = allGrades.filter(g =>
          g.partial === partial && g.studentId === stu.id && subjectIds.includes(g.subjectId)
        );
        let sum = 0, cnt = 0, reprobsDelAlumno = 0;
        for (const g of studentGrades) {
          const cal = g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null);
          if (cal == null || isNaN(cal)) continue;
          sum += cal; cnt++;
          if (cal < passGrade) {
            reprobsDelAlumno++;
            totalIncidencias++;
          }
        }
        if (cnt > 0) {
          promSum += sum / cnt;
          promCnt++;
          if (reprobsDelAlumno === 0) aprobAlumnos++;
          else reprobAlumnos++;
        }
      }
      return {
        prom: promCnt > 0 ? +(promSum / promCnt).toFixed(2) : null,
        aprob: aprobAlumnos,     // alumnos sin reprobadas
        reprob: reprobAlumnos,   // alumnos irregulares
        total: aprobAlumnos + reprobAlumnos,  // alumnos evaluados del grupo
        incidencias: totalIncidencias,  // sumatoria de cals < 6
      };
    }

    // Helper para aplicar bordes
    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    // ─── Crear hoja por grado (PRIMERO, SEGUNDO, TERCERO) ───
    const gradoSheetNames = { 1: 'PRIMERO', 2: 'SEGUNDO ', 3: 'TERCERO ' };
    for (const grado of [1, 2, 3]) {
      const groupsOfGrado = turnoGroups.filter(g => Number(g.grado) === grado);
      const subjectsForGrado = INDICADORES_SUBJECTS[grado];
      const ws = wb.addWorksheet(gradoSheetNames[grado], {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      const totalCols = 2 + subjectsForGrado.length + 1;  // A,B (label) + materias + GENERAL

      // Fila 1: título grande
      ws.mergeCells(1, 3, 1, 2 + subjectsForGrado.length);
      ws.getCell(1, 3).value = `INDICADORES ${partialNumWord} BIMESTRE — TURNO ${turno}`;
      ws.getCell(1, 3).font = { bold: true, size: 14, color: { argb: 'FF1F2937' } };
      ws.getCell(1, 3).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(1, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };

      // Anchos de columna
      ws.getColumn(1).width = 13;
      ws.getColumn(2).width = 22;
      for (let c = 3; c <= totalCols; c++) ws.getColumn(c).width = 13;

      // Por cada grupo del grado: 1 bloque de 6 filas (header + 5 stats), separado por fila vacía
      let blockStartRow = 2;
      for (const grp of groupsOfGrado) {
        // R0 (header bloque): 'INDICADORES X°Y' en A:B mergeado + abreviaciones de materias + GENERAL
        ws.mergeCells(blockStartRow, 1, blockStartRow, 2);
        const blockHdr = ws.getCell(blockStartRow, 1);
        blockHdr.value = `INDICADORES  ${grp.nombre}`;
        blockHdr.font = { bold: true, size: 11 };
        blockHdr.alignment = { horizontal: 'center', vertical: 'middle' };
        blockHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        blockHdr.border = thinBorder;
        for (let i = 0; i < subjectsForGrado.length; i++) {
          const cell = ws.getCell(blockStartRow, 3 + i);
          cell.value = subjectsForGrado[i][1];
          cell.font = { bold: true, size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
          cell.border = thinBorder;
        }
        const genCell = ws.getCell(blockStartRow, 3 + subjectsForGrado.length);
        genCell.value = 'GENERAL';
        genCell.font = { bold: true, size: 10 };
        genCell.alignment = { horizontal: 'center', vertical: 'middle' };
        genCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD34D' } };
        genCell.border = thinBorder;

        // Filas del bloque (6 filas):
        //   PROMEDIO        — promedio numérico
        //   ALUMNOS APROBADOS — alumnos sin reprobadas (general) / cal >= 6 (materia)
        //   % APROBACION    — porcentaje sobre alumnos evaluados
        //   ALUMNOS REPROBADOS — alumnos con >=1 reprobada (general) / cal < 6 (materia)
        //   % REPROBACION   — porcentaje sobre alumnos evaluados
        //   INCIDENCIAS     — total de cals < 6 (SUMATORIA, muestra magnitud)
        //     · Por materia: = ALUMNOS REPROBADOS (1 cal por alumno)
        //     · General: suma de todas las reprobadas (un alumno cuenta
        //       tantas veces como materias reprobadas tenga)
        const statRows = [
          { label: 'PROMEDIO',                   fn: s => s.prom != null ? s.prom : '',                       fmt: null },
          { label: 'ALUMNOS APROBADOS',          fn: s => s.total > 0 ? s.aprob : '',                          fmt: null },
          { label: '% APROBACION',               fn: s => s.total > 0 ? +(s.aprob * 100 / s.total).toFixed(1) : '', fmt: '0.0"%"' },
          { label: 'ALUMNOS REPROBADOS',         fn: s => s.total > 0 ? s.reprob : '',                         fmt: null },
          { label: '% REPROBACION',              fn: s => s.total > 0 ? +(s.reprob * 100 / s.total).toFixed(1) : '', fmt: '0.0"%"' },
          { label: 'INCIDENCIAS DE REPROB.',     fn: s => s.total > 0 ? (s.incidencias != null ? s.incidencias : s.reprob) : '', fmt: null },
        ];

        // Pre-calcular stats por materia + general
        const subjStats = subjectsForGrado.map(([oficial]) => {
          const subj = findSubject(oficial, grado);
          if (!subj) return { prom: null, aprob: 0, reprob: 0, total: 0 };
          return statsForSubjectInGroup(subj.id, grp.id);
        });
        const generalStats = statsGeneralForGroup(grp.id, grado);

        statRows.forEach((sr, idx) => {
          const row = blockStartRow + 1 + idx;
          ws.mergeCells(row, 1, row, 2);
          const labelCell = ws.getCell(row, 1);
          labelCell.value = sr.label;
          labelCell.font = { bold: true, size: 10, color: { argb: 'FF1E40AF' } };
          labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
          labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
          labelCell.border = thinBorder;
          // Por materia
          subjStats.forEach((st, i) => {
            const c = ws.getCell(row, 3 + i);
            c.value = sr.fn(st);
            if (sr.fmt) c.numFmt = sr.fmt;
            c.alignment = { horizontal: 'center', vertical: 'middle' };
            c.border = thinBorder;
            // Color rojo si % reprobación > 14% (meta)
            if (sr.label === '% REPROBACION' && typeof c.value === 'number' && c.value > 14) {
              c.font = { bold: true, color: { argb: 'FFB91C1C' } };
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            }
            if (sr.label === 'PROMEDIO' && typeof c.value === 'number' && c.value < passGrade) {
              c.font = { bold: true, color: { argb: 'FFB91C1C' } };
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            }
          });
          // GENERAL
          const gc = ws.getCell(row, 3 + subjectsForGrado.length);
          gc.value = sr.fn(generalStats);
          if (sr.fmt) gc.numFmt = sr.fmt;
          gc.font = { bold: true };
          gc.alignment = { horizontal: 'center', vertical: 'middle' };
          gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
          gc.border = thinBorder;
        });

        blockStartRow += 8;  // 7 filas (header + 6 stats) + 1 vacía de separación
      }
    }

    // ─── Hoja CONCENTRADO GENERAL ───
    {
      const ws = wb.addWorksheet('CONCENTRADO GENERAL ', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      ws.getColumn(1).width = 13;
      ws.getColumn(2).width = 22;
      for (let c = 3; c <= 6; c++) ws.getColumn(c).width = 14;

      ws.mergeCells(2, 1, 2, 6);
      ws.getCell(2, 1).value = `${partialNumWord} BIMESTRE`;
      ws.getCell(2, 1).font = { bold: true, size: 14 };
      ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD34D' } };

      // Header
      ws.mergeCells(3, 1, 3, 2);
      ws.getCell(3, 1).value = 'INDICADORES';
      ['1°', '2°', '3°', 'GENERAL '].forEach((label, i) => {
        const c = ws.getCell(3, 3 + i);
        c.value = label;
        c.font = { bold: true, size: 11 };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
        c.border = thinBorder;
      });
      ws.getCell(3, 1).font = { bold: true, size: 11 };
      ws.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(3, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      ws.getCell(3, 1).border = thinBorder;

      // Stats por grado (alumno-céntricas — un alumno cuenta UNA vez)
      const statsByGrado = {};
      for (const grado of [1, 2, 3]) {
        const groupsOfGrado = turnoGroups.filter(g => Number(g.grado) === grado);
        let promSum = 0, promCnt = 0, totalAprob = 0, totalReprob = 0, totalIncidencias = 0;
        for (const grp of groupsOfGrado) {
          const s = statsGeneralForGroup(grp.id, grado);
          if (s.prom != null) { promSum += s.prom; promCnt++; }
          totalAprob += s.aprob;
          totalReprob += s.reprob;
          totalIncidencias += (s.incidencias || 0);
        }
        statsByGrado[grado] = {
          prom: promCnt > 0 ? +(promSum / promCnt).toFixed(2) : null,
          aprob: totalAprob,
          reprob: totalReprob,
          total: totalAprob + totalReprob,
          incidencias: totalIncidencias,
        };
      }
      // Stats GENERAL (todo el turno)
      const generalAll = {
        prom: null,
        aprob: statsByGrado[1].aprob + statsByGrado[2].aprob + statsByGrado[3].aprob,
        reprob: statsByGrado[1].reprob + statsByGrado[2].reprob + statsByGrado[3].reprob,
        incidencias: statsByGrado[1].incidencias + statsByGrado[2].incidencias + statsByGrado[3].incidencias,
        total: 0,
      };
      generalAll.total = generalAll.aprob + generalAll.reprob;
      const promValues = [1, 2, 3].map(g => statsByGrado[g].prom).filter(p => p != null);
      generalAll.prom = promValues.length > 0 ? +(promValues.reduce((a, b) => a + b, 0) / promValues.length).toFixed(2) : null;

      const statRows = [
        { label: 'PROMEDIO',                fn: s => s.prom != null ? s.prom : '',                              fmt: null },
        { label: 'ALUMNOS APROBADOS',       fn: s => s.total > 0 ? s.aprob : '',                                fmt: null },
        { label: '% APROBACION',            fn: s => s.total > 0 ? +(s.aprob * 100 / s.total).toFixed(1) : '',  fmt: '0.0"%"' },
        { label: 'ALUMNOS REPROBADOS',      fn: s => s.total > 0 ? s.reprob : '',                               fmt: null },
        { label: '% REPROBACION',           fn: s => s.total > 0 ? +(s.reprob * 100 / s.total).toFixed(1) : '', fmt: '0.0"%"' },
        { label: 'INCIDENCIAS DE REPROB.',  fn: s => s.total > 0 ? (s.incidencias || 0) : '',                   fmt: null },
      ];
      statRows.forEach((sr, idx) => {
        const r = 4 + idx;
        ws.mergeCells(r, 1, r, 2);
        const lc = ws.getCell(r, 1);
        lc.value = sr.label;
        lc.font = { bold: true, color: { argb: 'FF1E40AF' } };
        lc.alignment = { horizontal: 'center', vertical: 'middle' };
        lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
        lc.border = thinBorder;
        [1, 2, 3].forEach((g, i) => {
          const c = ws.getCell(r, 3 + i);
          c.value = sr.fn(statsByGrado[g]);
          if (sr.fmt) c.numFmt = sr.fmt;
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = thinBorder;
          if (sr.label === '% REPROBACION' && typeof c.value === 'number' && c.value > 14) {
            c.font = { bold: true, color: { argb: 'FFB91C1C' } };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          }
        });
        const gc = ws.getCell(r, 6);
        gc.value = sr.fn(generalAll);
        if (sr.fmt) gc.numFmt = sr.fmt;
        gc.font = { bold: true };
        gc.alignment = { horizontal: 'center', vertical: 'middle' };
        gc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
        gc.border = thinBorder;
      });
    }

    // ─── Hoja CASOS ESPECIALES (grid 3x3) ───
    {
      const ws = wb.addWorksheet('CASOS ESPECIALES', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      // Anchos
      [4.7, 13, 13, 13, 13, 13.5, 14.3, 14.4, 13, 13, 13].forEach((w, i) => ws.getColumn(i + 1).width = w);
      ws.getColumn(12).width = 6.3;
      [13, 13, 13, 13, 14, 15.3, 13.7, 13, 13, 13].forEach((w, i) => ws.getColumn(13 + i).width = w);
      ws.getColumn(23).width = 6.3;
      [13, 13, 13, 13, 14, 15.3, 13.7, 13, 13, 13].forEach((w, i) => ws.getColumn(24 + i).width = w);

      // Helper para construir 1 bloque de grupo
      function buildCasosBlock(ws, startRow, startCol, grpNombre, students) {
        // R0: cabecera de grupo (e.g. "1°1") mergeada cols 1..9
        ws.mergeCells(startRow, startCol, startRow, startCol + 8);
        const hdr = ws.getCell(startRow, startCol);
        hdr.value = grpNombre;
        hdr.font = { bold: true, size: 13, color: { argb: 'FF1F2937' } };
        hdr.alignment = { horizontal: 'center', vertical: 'middle' };
        hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCD34D' } };
        hdr.border = thinBorder;

        // R1: encabezados de columnas — N.P | NOMBRE (3 cols mergeadas) | NUM.MAT | P.CONDUC | PSICOLOGICO | ECONOMICO | SALUD
        ws.getCell(startRow + 1, startCol).value = 'N.P';
        ws.mergeCells(startRow + 1, startCol + 1, startRow + 1, startCol + 3);
        ws.getCell(startRow + 1, startCol + 1).value = 'NOMBRE';
        ws.getCell(startRow + 1, startCol + 4).value = 'NUM. MAT';
        ws.getCell(startRow + 1, startCol + 5).value = 'P. CONDUC';
        ws.getCell(startRow + 1, startCol + 6).value = 'PSICOLOGICO';
        ws.getCell(startRow + 1, startCol + 7).value = 'ECONOMICO';
        ws.getCell(startRow + 1, startCol + 8).value = 'SALUD';
        for (let c = 0; c < 9; c++) {
          const cell = ws.getCell(startRow + 1, startCol + c);
          cell.font = { bold: true, size: 10 };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
          cell.border = thinBorder;
        }

        // Filas de alumnos reprobados
        let rowIdx = startRow + 2;
        let idx = 1;
        for (const stu of students) {
          if (stu.numReprobadas <= 0) continue;
          ws.getCell(rowIdx, startCol).value = idx++;
          ws.mergeCells(rowIdx, startCol + 1, rowIdx, startCol + 3);
          ws.getCell(rowIdx, startCol + 1).value = (stu.apellido1 + ' ' + (stu.apellido2 || '') + ' ' + (stu.nombres || '')).trim();
          ws.getCell(rowIdx, startCol + 4).value = stu.numReprobadas;
          // Cols vacías: P.CONDUC, PSICOLOGICO, ECONOMICO, SALUD
          for (let c = 0; c < 9; c++) {
            const cell = ws.getCell(rowIdx, startCol + c);
            cell.alignment = { horizontal: c === 0 || c === 4 ? 'center' : 'left', vertical: 'top', wrapText: true };
            cell.border = thinBorder;
          }
          rowIdx++;
        }
        // Si no hubo alumnos, agregar fila informativa
        if (idx === 1) {
          ws.mergeCells(rowIdx, startCol, rowIdx, startCol + 8);
          const cell = ws.getCell(rowIdx, startCol);
          cell.value = 'Sin casos en este parcial';
          cell.font = { italic: true, color: { argb: 'FF9CA3AF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = thinBorder;
        }
      }

      // Calcular alumnos reprobados por grupo
      function studentsWithFailures(grpId, grado) {
        const subjectsForGrado = INDICADORES_SUBJECTS[grado] || [];
        const subjectIds = subjectsForGrado.map(([oficial]) => {
          const subj = findSubject(oficial, grado);
          return subj ? subj.id : null;
        }).filter(Boolean);
        const groupStudents = allStudents
          .filter(s => s.groupId === grpId && !s.bajaPendiente)
          .sort((a, b) => (a.apellido1 || '').localeCompare(b.apellido1 || ''));
        return groupStudents.map(stu => {
          const grades = allGrades.filter(g =>
            g.partial === partial && g.studentId === stu.id && subjectIds.includes(g.subjectId)
          );
          let reprobadas = 0;
          for (const g of grades) {
            const cal = g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null);
            if (cal != null && !isNaN(cal) && cal < passGrade) reprobadas++;
          }
          return { ...stu, numReprobadas: reprobadas };
        });
      }

      // Grid 3x3: filas (grupo 1, grupo 2, grupo 3) x cols (1°, 2°, 3°)
      // Cada bloque ocupa ~21 filas y 11 cols (incluyendo separación)
      const colOffsets = { 1: 1, 2: 12, 3: 23 };
      const rowOffsets = { 1: 1, 2: 23, 3: 45 };
      for (const grupoNum of [1, 2, 3]) {  // grupo 1, 2, 3
        for (const grado of [1, 2, 3]) {
          const targetName = `${grado}-${grupoNum}`;
          const grp = turnoGroups.find(g => g.nombre === targetName || g.nombre === `${grado}°${grupoNum}` || g.nombre.endsWith(`-${grupoNum}`) && Number(g.grado) === grado);
          if (!grp) continue;
          const studs = studentsWithFailures(grp.id, grado);
          // Mostrar como "1°1" en el encabezado
          buildCasosBlock(ws, rowOffsets[grupoNum], colOffsets[grado], `${grado}°${grupoNum}`, studs);
        }
      }
    }

    // ─── DESCARGAR ───
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateTag = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `INDICADORES_${partialNumWord}_BIMESTRE_${turno}_${dateTag}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    Toast.show(`✓ Indicadores ${turno} descargados`, 'success', 5000);
    return true;
  }

  return { render, generateZipOrientadoresByTurno, generateIndicadoresReportByTurno };
})();

Router.modules['concentrado'] = () => ConcentradoModule.render();
