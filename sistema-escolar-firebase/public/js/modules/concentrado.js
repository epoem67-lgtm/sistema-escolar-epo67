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

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Concentrado de Calificaciones</h1>
            <p class="module-subtitle">Vista matricial de alumnos por materias</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-success" data-action="export">Exportar a Excel</button>
            <button class="btn btn-primary" data-action="print">Imprimir</button>
            <button class="btn btn-warning" data-action="orientacion-xlsx" title="Genera xlsx con formato oficial para cotejo de Orientacion (concentrado + seguimiento + mejores promedios)">Concentrado Orientaci&oacute;n (.xlsx)</button>
            <button class="btn btn-warning" data-action="orientacion-masivo" title="Genera 1 xlsx por orientador del turno seleccionado (todos sus grupos)">Masivo por Orientador (.xlsx)</button>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="conc-turno">Turno</label>
              <select id="conc-turno">
                <option value="">Selecciona turno</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="conc-grado">Grado</label>
              <select id="conc-grado">
                <option value="">Selecciona grado</option>
                ${gradoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="conc-grupo">Grupo</label>
              <select id="conc-grupo">
                <option value="">Selecciona grupo</option>
              </select>
            </div>
            <div class="form-group">
              <label for="conc-parcial">Parcial</label>
              <select id="conc-parcial">${parcialOptions}</select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="generate">Generar</button>
          </div>
        </div>

        <div id="conc-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">table_chart</span>
            <p class="empty-state-text">Selecciona turno, grado, grupo y parcial, luego haz clic en Generar</p>
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
      const [students, groups, subjects, assignments, oriGroups] = await Promise.all([
        Store.getStudents(),
        Store.getGroups(),
        Store.getSubjects(),
        Store.getAssignments(),
        Store.getOrientadorGroups()
      ]);
      orientadorGroupIds = oriGroups; // null for admin, array for orientador
      allStudents = students.filter(s => s.estatus === 'ACTIVO');
      allGroups = oriGroups ? groups.filter(g => oriGroups.includes(g.id)) : groups;
      allSubjects = subjects;
      allAssignments = assignments;
      // Load grades per-group (much more efficient than loading ALL grades)
      // Respeta cache (TTL 3 min). Las mutaciones llaman a Store.invalidateGradesForGroup(),
      // asi que tras una captura el cache esta limpio y se re-fetchea solo lo necesario.
      const groupIds = allGroups.map(g => g.id);
      allGrades = await Store.getGradesByGroups(groupIds);
    } catch (e) {
      console.error('Error cargando datos de concentrado:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─── CASCADING FILTERS ───
  function updateGroupOptions() {
    const turno = document.getElementById('conc-turno')?.value;
    const grado = document.getElementById('conc-grado')?.value;
    const grupoSelect = document.getElementById('conc-grupo');
    if (!grupoSelect) return;

    let filtered = [...allGroups];
    if (turno) filtered = filtered.filter(g => g.turno === turno);
    if (grado) filtered = filtered.filter(g => String(g.grado) === String(grado));

    const nombres = [...new Set(filtered.map(g => g.nombre || g.grupo))].filter(Boolean).sort();
    grupoSelect.innerHTML = `<option value="">Selecciona grupo</option>` +
      nombres.map(n => `<option value="${n}">${n}</option>`).join('');
  }

  // ─── GENERATE MATRIX ───
  function generate() {
    const resultsDiv = document.getElementById('conc-results');
    if (!resultsDiv) return;

    const turno = document.getElementById('conc-turno')?.value;
    const grado = document.getElementById('conc-grado')?.value;
    const grupo = document.getElementById('conc-grupo')?.value;
    const parcial = document.getElementById('conc-parcial')?.value || 'P1';

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

      // Averages row
      html += `<tr style="background:#f0f2f5;font-weight:700;border-top:2px solid var(--color-border);">`;
      html += `<td></td><td>PROMEDIO</td>`;
      colAverages.forEach(avg => {
        if (avg > 0) {
          html += `<td style="text-align:center;${gradeStyle(avg)}">${avg.toFixed(1)}</td>`;
        } else {
          html += `<td style="text-align:center;">-</td>`;
        }
      });
      html += `<td style="text-align:center;${gradeStyle(overallAvg)}">${overallAvg.toFixed(1)}</td>`;
      html += '</tr></tbody></table></div></div>';

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

    // Dynamic font based on students AND subjects count
    let fs;
    if (n <= 35 && nSubs <= 10) { fs = '7.5pt'; }
    else if (n <= 42) { fs = '7pt'; }
    else if (n <= 48) { fs = '6.5pt'; }
    else { fs = '6pt'; }

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
@page { size: letter landscape; margin: 4mm 5mm 3mm 5mm; }
html, body { margin:0; padding:0; height:100%; }
* { box-sizing:border-box; margin:0; padding:0; }

.PG {
    width:100%; height:100vh;
    font-family:Arial,Helvetica,sans-serif; color:#000; line-height:1.1;
    font-size:7pt;
    display:flex; flex-direction:column;
    overflow:hidden;
}
.PG table { border-collapse:collapse; }
.PG-hdr, .PG-ttl, .PG-nfo, .PG-bot, .PG-ftr { flex-shrink:0; flex-grow:0; }
.PG-data { flex:1; overflow:hidden; display:flex; flex-direction:column; }

.hdr-t { width:100%; margin-bottom:0.3mm; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:6.5mm; width:auto; }
.hdr-r { text-align:right; font-size:6pt; line-height:1.25; color:#333; }

.ttl-esc { text-align:center; font-weight:bold; font-size:9pt; line-height:1.1; }
.ttl-ctrl { text-align:center; font-weight:bold; font-size:8pt; line-height:1; margin:0.3mm 0;
    border-bottom:0.5pt solid #000; padding-bottom:0.3mm; }

.nfo { width:100%; font-size:7pt; line-height:1.15; }
.nfo td { border:0.4pt solid #000; padding:0.4mm 0.8mm; height:3.5mm; vertical-align:middle; }
.nfo .lb { font-size:6.5pt; color:#333; }
.nfo .vl { font-weight:bold; font-size:7pt; }
.nfo .sm { text-align:center; font-weight:bold; font-size:7.5pt; line-height:1.15; }

.MT { width:100%; height:100%; table-layout:fixed; font-size:${fs}; line-height:1; }
.MT th { border:0.5pt solid #000; padding:0.2mm; text-align:center; font-weight:bold; font-size:${nSubs > 10 ? '5pt' : '5.5pt'};
    background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
    line-height:1.1; vertical-align:middle; height:5mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.MT td { border:0.4pt solid #000; font-size:${fs}; line-height:1;
    padding:0 0.3mm; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; vertical-align:middle; }
.MT .c { text-align:center; padding:0; }
.MT .nm { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }

.ST td { border:0.4pt solid #000; padding:0.25mm 0.6mm; font-size:7pt; line-height:1.1; height:2.6mm; }
.ST .sl { font-weight:bold; }
.ST .sv { text-align:center; font-weight:bold; font-size:7.5pt; width:10mm; }

.SG-tbl { width:100%; border-collapse:collapse; }
.SG-tbl td { width:25%; text-align:center; padding:0 1.5mm; }
.SG-tbl .sg-line-row td { vertical-align:bottom; border-bottom:0.5pt solid #000; height:1mm; }
.SG-tbl .sg-text-row td { vertical-align:top; padding-top:0.3mm; }
.SG-tt { font-weight:bold; font-size:7pt; line-height:1.15; }
.SG-nm { font-size:6.5pt; line-height:1.15; }

.ftr img { width:100%; max-height:3mm; display:block; }
.ftr-t { text-align:center; font-size:5.5pt; color:#333; line-height:1; margin-top:0.1mm; }
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
                <tr class="sg-line-row"><td></td><td></td><td></td><td></td></tr>
                <tr class="sg-text-row">
                    <td>
                        <div class="SG-tt">ORIENTADOR(A)</div>
                        <div class="SG-nm">${Utils.sanitize(orientador)}</div>
                    </td>
                    <td>
                        <div class="SG-tt">VO. BO. SUBDIRECCIÓN ESCOLAR</div>
                        <div class="SG-nm">PROFR. OCTAVIO VÁZQUEZ BARRETO</div>
                    </td>
                    <td>
                        <div class="SG-tt">SECRETARÍA ESCOLAR</div>
                        <div class="SG-nm">PROFR. ROBERTO PALOMARES MEJÍA</div>
                    </td>
                    <td>
                        <div class="SG-tt">DIRECCIÓN ESCOLAR</div>
                        <div class="SG-nm"></div>
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

      // Filas de alumnos (7+)
      stus.forEach((stu, idx) => {
        const row = [idx + 1, stu.apellido1 || '', stu.apellido2 || '', stu.nombres || '', ''];
        let sumCal = 0, cntCal = 0;
        for (const s of subs) {
          const gd = (gMap[stu.id] && gMap[stu.id][s.id]) || null;
          const f = gd && gd.faltas != null ? Number(gd.faltas) : '';
          const c = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : '')) : '';
          row.push(f === '' ? '' : f, c === '' ? '' : c);
          if (c !== '' && !isNaN(c)) { sumCal += Number(c); cntCal++; }
        }
        const prom = cntCal > 0 ? +(sumCal / cntCal).toFixed(2) : '';
        row.push(prom);
        aoa1.push(row);
        // Para mejores promedios
        if (cntCal > 0) {
          const fullName = `${stu.apellido1 || ''} ${stu.apellido2 || ''} ${stu.nombres || ''}`.trim();
          allBest.push({ grupo: grp.nombre, alumno: fullName, promedio: prom });
        }
      });

      const sheet1Merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 + subs.length * 2 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 + subs.length * 2 } },
        { s: { r: 2, c: 1 }, e: { r: 2, c: 4 + subs.length * 2 } },
      ];
      const sheet1Cols = [{ wch: 4 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 2 }]
        .concat(subs.map(_ => ({ wch: 5 })).flatMap(c => [{ wch: 4 }, { wch: 5 }]))
        .concat([{ wch: 9 }]);

      const sheetName1 = String(grp.grado) + '\u00b0' + (grp.nombre.split('-')[1] || grp.nombre);
      sheets.push({ name: sheetName1, aoa: aoa1, merges: sheet1Merges, cols: sheet1Cols });

      // ─── HOJA 2: SEGUIMIENTO (solo reprobados) ───
      const aoa2 = [];
      aoa2.push([`ESCUELA PREPARATORIA OFICIAL N\u00ba 67`]);
      aoa2.push([`SEGUIMIENTO ${partialLabel}   CICLO ESCOLAR ${cicloEscolar}`]);
      aoa2.push([`GRADO: ${grp.grado}\u00ba   GRUPO: ${grp.nombre.split('-')[1] || grp.nombre}    TURNO: ${turno}`]);
      aoa2.push([]);
      const seguHdr = ['N.L', 'AP. PATERNO', 'AP. MATERNO', 'NOMBRE'];
      for (const s of subs) seguHdr.push(subjectAbbr(s.nombre));
      seguHdr.push('M.R');
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
          aoa2.push([segIdx++, stu.apellido1 || '', stu.apellido2 || '', stu.nombres || '', ...cells, mr]);
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
        aoa2.push(totalsRow);
      } else {
        aoa2.push(['', '', '', 'Sin alumnos reprobados en este parcial']);
      }

      const sheet2Cols = [{ wch: 4 }, { wch: 16 }, { wch: 16 }, { wch: 18 }]
        .concat(subs.map(() => ({ wch: 8 })))
        .concat([{ wch: 5 }]);
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
  async function exportOrientacion() {
    const turno = document.getElementById('conc-turno')?.value;
    const grado = document.getElementById('conc-grado')?.value;
    const grupoSel = document.getElementById('conc-grupo')?.value;
    const partial = document.getElementById('conc-parcial')?.value || 'P1';
    if (!turno) { Toast.show('Selecciona turno', 'warning'); return; }
    if (!grado) { Toast.show('Selecciona grado', 'warning'); return; }

    const partialLabel = (K.PARCIALES.find(p => p.id === partial)?.nombre || partial).toUpperCase();
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

    let targetGroups = allGroups.filter(g => g.turno === turno && String(g.grado) === String(grado));
    if (grupoSel) targetGroups = targetGroups.filter(g => g.id === grupoSel);
    targetGroups.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    if (targetGroups.length === 0) { Toast.show('No hay grupos para esa selecci\u00f3n', 'warning'); return; }

    Toast.show(`Generando ${targetGroups.length} grupo(s)...`, 'info');
    const spec = buildOrientacionWorkbookSpec(targetGroups, partial, partialLabel, cicloEscolar, turno);
    const groupTag = grupoSel ? targetGroups[0].nombre : `${grado}\u00ba`;
    const fname = `Concentrado_Orientacion_${turno}_${groupTag}_${partial}.xlsx`;
    try {
      const buf = await XlsxWorker.serialize(spec);
      downloadXlsxBuffer(buf, fname);
      Toast.show(`Generado: ${fname}`, 'success');
    } catch (err) {
      console.error(err);
      Toast.show('Error generando XLSX: ' + err.message, 'error');
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

      stus.forEach((stu, idx) => {
        let sumCal = 0, cntCal = 0, mr = 0;
        const cells = subs.map((s, i) => {
          const gd = (gMap[stu.id] && gMap[stu.id][s.id]) || null;
          const f = gd && gd.faltas != null ? Number(gd.faltas) : '';
          const c = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : '')) : '';
          if (c !== '' && !isNaN(c)) {
            sumCal += Number(c); cntCal++;
            if (Number(c) < passGrade) mr++;
          }
          const fail = c !== '' && Number(c) < passGrade;
          const cBg = fail ? 'background:#ffd3df;color:#a00;font-weight:700;' : '';
          return `<td class="num">${f === '' ? '' : f}</td><td class="num" style="${cBg}">${c === '' ? '' : c}</td>`;
        }).join('');
        const prom = cntCal > 0 ? (sumCal / cntCal).toFixed(2) : '';
        const promFail = prom && Number(prom) < passGrade;
        body += `<tr>
          <td class="num">${idx + 1}</td>
          <td class="ap">${Utils.sanitize(stu.apellido1 || '')}</td>
          <td class="ap">${Utils.sanitize(stu.apellido2 || '')}</td>
          <td class="nm">${Utils.sanitize(stu.nombres || '')}</td>
          ${cells}
          <td class="num mr ${mr > 0 ? 'mr-warn' : ''}">${mr || ''}</td>
          <td class="num bold" style="${promFail ? 'background:#ffd3df;color:#a00;' : prom && Number(prom) >= 9 ? 'background:#d4edda;color:#155724;' : ''}">${prom}</td>
        </tr>`;
        if (cntCal > 0) {
          allBest.push({
            grupo: grp.nombre, grado: grp.grado,
            apellido1: stu.apellido1 || '', apellido2: stu.apellido2 || '',
            nombres: stu.nombres || '', promedio: Number(prom)
          });
        }
      });
      body += `</tbody></table></section>`;

      // ─── HOJA: SEGUIMIENTO POR GRUPO ─────────────────────────────
      const segHeaderCols = subs.map((s, i) =>
        `<th class="mat-h" style="background:${headerColors[i]};font-size:7pt;padding:4px 2px;">${Utils.sanitize(subjectAbbr(s.nombre))}</th>`
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
          </tr>`);
        }
      });
      const totalsRow = `<tr style="font-weight:700;background:#f0f0f0;">
        <td colspan="4" class="ap" style="text-align:right;">TOTAL</td>
        ${totalsBySubject.map(t => `<td class="num">${t || ''}</td>`).join('')}
        <td class="num">${totalsBySubject.reduce((a, b) => a + b, 0)}</td>
      </tr>`;

      body += `<section class="grp-page">
        <div class="hdr">
          <h1>ESCUELA PREPARATORIA OFICIAL N&deg; 67</h1>
          <h2>SEGUIMIENTO &mdash; ${Utils.sanitize(partialLabel)}</h2>
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
            </tr>
          </thead>
          <tbody>${segRows.length ? segRows.join('') : `<tr><td colspan="${4 + subs.length + 1}" style="text-align:center;padding:14px;color:#666;font-style:italic;">Sin alumnos reprobados en este parcial</td></tr>`}
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

    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Concentrado ${Utils.sanitize(orientador)} ${partial}</title>
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
      const turno = document.getElementById('conc-turno')?.value;
      const partial = document.getElementById('conc-parcial')?.value || 'P1';
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
      console.error('Error en exportOrientacionMasivo:', e);
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

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'generate') generate();
      else if (btn.dataset.action === 'export') exportConcentrado();
      else if (btn.dataset.action === 'print') printConcentrado();
      else if (btn.dataset.action === 'orientacion-xlsx') exportOrientacion();
      else if (btn.dataset.action === 'orientacion-masivo') exportOrientacionMasivo();
      else if (btn.dataset.action === 'mass-download-zip') _massDownloadZip();
      else if (btn.dataset.action === 'mass-clear') _massClearCache();
      else if (btn.dataset.action === 'mass-copy-name') _massCopyName(Number(btn.dataset.idx));
      else if (btn.dataset.action === 'mass-preview') _massPreview(Number(btn.dataset.idx));
    });

    // Cascading filters
    const turnoEl = document.getElementById('conc-turno');
    const gradoEl = document.getElementById('conc-grado');
    if (turnoEl) turnoEl.addEventListener('change', updateGroupOptions);
    if (gradoEl) gradoEl.addEventListener('change', updateGroupOptions);
  }

  return { render };
})();

Router.modules['concentrado'] = () => ConcentradoModule.render();
