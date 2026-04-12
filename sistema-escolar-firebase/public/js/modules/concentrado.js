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
      const [students, groups, subjects, assignments, grades] = await Promise.all([
        Store.getStudents(),
        Store.getGroups(),
        Store.getSubjects(),
        Store.getAssignments(),
        Store.getGrades()
      ]);
      allStudents = students.filter(s => s.estatus === 'ACTIVO');
      allGroups = groups;
      allSubjects = subjects;
      allAssignments = assignments;
      allGrades = grades;
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
        if (g.value === undefined || g.value === null) return;
        if (!gradeMap[g.studentId]) gradeMap[g.studentId] = {};
        gradeMap[g.studentId][g.subjectId] = g.value;
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
      html += `<thead><tr><th class="text-center">#</th><th>Nombre del Alumno</th>`;
      subjectList.forEach(sub => {
        html += `<th class="text-center" title="${Utils.sanitize(sub.nombre)}">${Utils.sanitize(abbreviate(sub.nombre))}</th>`;
      });
      html += `<th class="text-center font-semibold">PROMEDIO</th></tr></thead>`;

      // Body
      html += '<tbody>';
      matrix.forEach(row => {
        html += `<tr><td class="text-center text-muted">${row.num}</td>`;
        html += `<td class="font-semibold">${Utils.sanitize(row.name)}</td>`;
        row.grades.forEach(val => {
          if (val !== null) {
            html += `<td class="text-center"><span class="grade-badge ${gradeBadgeClass(val)}">${val}</span></td>`;
          } else {
            html += `<td class="text-center text-muted">-</td>`;
          }
        });
        const avgClass = row.gradeCount > 0 ? gradeBadgeClass(row.average) : '';
        html += `<td class="text-center font-semibold">${row.gradeCount > 0 ? `<span class="grade-badge ${avgClass}">${row.average.toFixed(1)}</span>` : '-'}</td>`;
        html += '</tr>';
      });

      // Averages row
      html += `<tr class="font-semibold" style="background: var(--color-gray-100);">`;
      html += `<td></td><td>PROMEDIO</td>`;
      colAverages.forEach(avg => {
        if (avg > 0) {
          html += `<td class="text-center"><span class="grade-badge ${gradeBadgeClass(avg)}">${avg.toFixed(1)}</span></td>`;
        } else {
          html += `<td class="text-center text-muted">-</td>`;
        }
      });
      html += `<td class="text-center"><span class="grade-badge ${gradeBadgeClass(overallAvg)}">${overallAvg.toFixed(1)}</span></td>`;
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

  // ─── PRINT ───
  function printConcentrado() {
    if (!lastMatrix) {
      Toast.show('Genera primero el concentrado', 'warning');
      return;
    }

    const { subjectList, matrix, colAverages, overallAvg, grupo, parcial, turno, grado } = lastMatrix;
    const parcialLabel = K.PARCIALES.find(p => p.id === parcial)?.nombre || parcial;
    const filterDesc = `${turno || ''} ${grado ? grado + '\u00ba' : ''} ${grupo} - ${parcialLabel}`;

    // Build print-friendly table
    let tableHTML = '<table><thead><tr><th>#</th><th>Alumno</th>';
    subjectList.forEach(sub => {
      tableHTML += `<th>${sub.nombre || ''}</th>`;
    });
    tableHTML += '<th>PROM.</th></tr></thead><tbody>';

    matrix.forEach(row => {
      tableHTML += `<tr><td>${row.num}</td><td>${row.name}</td>`;
      row.grades.forEach(val => {
        const cls = val !== null ? (val < 6 ? ' class="fail"' : '') : '';
        tableHTML += `<td${cls}>${val !== null ? val : '-'}</td>`;
      });
      const avgCls = row.gradeCount > 0 && row.average < 6 ? ' class="fail"' : '';
      tableHTML += `<td${avgCls}>${row.gradeCount > 0 ? row.average.toFixed(1) : '-'}</td></tr>`;
    });

    tableHTML += '<tr class="avg-row"><td></td><td>PROMEDIO</td>';
    colAverages.forEach(avg => {
      tableHTML += `<td>${avg > 0 ? avg.toFixed(1) : '-'}</td>`;
    });
    tableHTML += `<td>${overallAvg.toFixed(1)}</td></tr></tbody></table>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Concentrado - ${grupo}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:15px;color:#1f2937;font-size:11px}
        h1{text-align:center;font-size:18px;margin-bottom:4px}
        .info{text-align:center;font-size:12px;color:#6b7280;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th{background:#f3f4f6;padding:4px 6px;text-align:center;font-weight:600;border:1px solid #d1d5db;white-space:nowrap}
        td{padding:4px 6px;border:1px solid #e5e7eb;text-align:center}
        td:nth-child(2){text-align:left;white-space:nowrap}
        .fail{color:#dc2626;font-weight:600}
        .avg-row{background:#f3f4f6;font-weight:700}
        .footer{margin-top:20px;text-align:center;font-size:10px;color:#9ca3af}
        @media print{body{padding:5px}table{page-break-inside:auto}tr{page-break-inside:avoid}}
      </style>
    </head><body>
      <h1>ESCUELA PREPARATORIA OFICIAL NUM. 67</h1>
      <p class="info">Concentrado de Calificaciones - ${filterDesc}</p>
      ${tableHTML}
      <div class="footer"><p>Generado por el Sistema Escolar EPO 67</p></div>
      <script>setTimeout(()=>window.print(),500)<\/script>
    </body></html>`);
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
