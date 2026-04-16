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

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'generate') generate();
      else if (btn.dataset.action === 'export') exportConcentrado();
      else if (btn.dataset.action === 'print') printConcentrado();
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
