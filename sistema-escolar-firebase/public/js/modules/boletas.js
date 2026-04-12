/**
 * BOLETAS MODULE
 * Generates student report cards (boletas) with grades across
 * all subjects and parcials. Supports individual and group views,
 * print-ready output, and Excel export.
 */

const BoletasModule = (() => {
  let groups = [];
  let students = [];
  let subjects = [];
  let assignments = [];

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Boletas de Calificaciones</h1>
            <p class="module-subtitle">Genera boletas individuales o por grupo con promedios por parcial</p>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="bol-turno">Turno</label>
              <select id="bol-turno">
                <option value="">-- Selecciona turno --</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="bol-grado">Grado</label>
              <select id="bol-grado" disabled>
                <option value="">-- Selecciona grado --</option>
              </select>
            </div>
            <div class="form-group">
              <label for="bol-grupo">Grupo</label>
              <select id="bol-grupo" disabled>
                <option value="">-- Selecciona grupo --</option>
              </select>
            </div>
            <div class="form-group">
              <label for="bol-alumno">Alumno</label>
              <select id="bol-alumno" disabled>
                <option value="">-- Selecciona alumno --</option>
              </select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="generate">Generar Boleta</button>
            <button class="btn btn-success" data-action="print">Imprimir</button>
            <button class="btn btn-outline" data-action="export-excel">Exportar Excel</button>
          </div>
        </div>

        <div id="bol-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">description</span>
            <p class="empty-state-text">Selecciona turno, grado, grupo y alumno, luego haz clic en Generar Boleta</p>
          </div>
        </div>
      </div>
    `;

    await loadData();
    bindEvents(container);
  }

  // ─────────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────────

  async function loadData() {
    try {
      const [g, s, sub, asgn] = await Promise.all([
        Store.getGroups(),
        Store.getStudents(),
        Store.getSubjects(),
        Store.getAssignments()
      ]);
      groups = g;
      students = s.filter(st => st.estatus === 'ACTIVO');
      subjects = sub;
      assignments = asgn;
    } catch (e) {
      console.error('Error cargando datos para boletas:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cascading filter logic
  // ─────────────────────────────────────────────────────────────

  function onTurnoChange() {
    const turno = document.getElementById('bol-turno').value;
    const gradoSelect = document.getElementById('bol-grado');
    const grupoSelect = document.getElementById('bol-grupo');
    const alumnoSelect = document.getElementById('bol-alumno');

    // Reset downstream
    grupoSelect.innerHTML = '<option value="">-- Selecciona grupo --</option>';
    grupoSelect.disabled = true;
    alumnoSelect.innerHTML = '<option value="">-- Selecciona alumno --</option>';
    alumnoSelect.disabled = true;

    if (!turno) {
      gradoSelect.innerHTML = '<option value="">-- Selecciona grado --</option>';
      gradoSelect.disabled = true;
      return;
    }

    // Determine which grados exist for this turno
    const turnoGroups = groups.filter(g => g.turno === turno);
    const availableGrados = [...new Set(turnoGroups.map(g => g.grado))].sort((a, b) => a - b);

    gradoSelect.innerHTML = '<option value="">-- Selecciona grado --</option>' +
      availableGrados.map(g => `<option value="${g}">${g}\u00ba Grado</option>`).join('');
    gradoSelect.disabled = false;
  }

  function onGradoChange() {
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;
    const grupoSelect = document.getElementById('bol-grupo');
    const alumnoSelect = document.getElementById('bol-alumno');

    alumnoSelect.innerHTML = '<option value="">-- Selecciona alumno --</option>';
    alumnoSelect.disabled = true;

    if (!grado) {
      grupoSelect.innerHTML = '<option value="">-- Selecciona grupo --</option>';
      grupoSelect.disabled = true;
      return;
    }

    const filtered = groups.filter(g => g.turno === turno && g.grado === parseInt(grado));
    grupoSelect.innerHTML = '<option value="">-- Selecciona grupo --</option>' +
      filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
    grupoSelect.disabled = false;
  }

  function onGrupoChange() {
    const groupId = document.getElementById('bol-grupo').value;
    const alumnoSelect = document.getElementById('bol-alumno');

    if (!groupId) {
      alumnoSelect.innerHTML = '<option value="">-- Selecciona alumno --</option>';
      alumnoSelect.disabled = true;
      return;
    }

    const filtered = students
      .filter(s => s.groupId === groupId || s.grupo === groupId)
      .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

    alumnoSelect.innerHTML = '<option value="todos">Todos los alumnos</option>' +
      filtered.map(s => `<option value="${s.id}">${Utils.sanitize(s.nombreCompleto)}</option>`).join('');
    alumnoSelect.disabled = false;
  }

  // ─────────────────────────────────────────────────────────────
  // Generate boletas
  // ─────────────────────────────────────────────────────────────

  async function generate() {
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;
    const groupId = document.getElementById('bol-grupo').value;
    const alumnoId = document.getElementById('bol-alumno').value;
    const resultsDiv = document.getElementById('bol-results');

    if (!turno || !grado || !groupId) {
      Toast.show('Selecciona turno, grado y grupo', 'warning');
      return;
    }

    if (!alumnoId) {
      Toast.show('Selecciona un alumno o "Todos"', 'warning');
      return;
    }

    resultsDiv.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Generando boletas...</p></div>`;

    try {
      // 1. Get subjects for this grado via assignments
      const groupAssignments = assignments.filter(a => a.groupId === groupId);
      const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
      const groupSubjects = subjects
        .filter(s => subjectIds.includes(s.id) || (s.grado === parseInt(grado)))
        .filter(s => subjectIds.length > 0 ? subjectIds.includes(s.id) : true);

      // Deduplicate by id
      const subjectMap = {};
      groupSubjects.forEach(s => { subjectMap[s.id] = s; });
      const finalSubjects = Object.values(subjectMap).sort((a, b) =>
        (a.nombre || '').localeCompare(b.nombre || '')
      );

      if (finalSubjects.length === 0) {
        resultsDiv.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">menu_book</span><p class="empty-state-text">No se encontraron materias asignadas para este grupo.</p></div>`;
        return;
      }

      // 2. Get students
      let targetStudents;
      if (alumnoId === 'todos') {
        targetStudents = students
          .filter(s => s.groupId === groupId || s.grupo === groupId)
          .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      } else {
        const found = students.find(s => s.id === alumnoId);
        targetStudents = found ? [found] : [];
      }

      if (targetStudents.length === 0) {
        resultsDiv.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">person_off</span><p class="empty-state-text">No se encontraron alumnos para este grupo.</p></div>`;
        return;
      }

      // 3. Fetch all grades for this group
      const gradesSnap = await db.collection('grades')
        .where('groupId', '==', groupId)
        .get();

      // Build map: grades[studentId][subjectId][partial] = value
      const gradesMap = {};
      gradesSnap.forEach(doc => {
        const g = doc.data();
        if (!gradesMap[g.studentId]) gradesMap[g.studentId] = {};
        if (!gradesMap[g.studentId][g.subjectId]) gradesMap[g.studentId][g.subjectId] = {};
        gradesMap[g.studentId][g.subjectId][g.partial] = g.value || 0;
      });

      // 4. Get group info
      const groupInfo = groups.find(g => g.id === groupId);
      const groupName = groupInfo ? (groupInfo.nombre || groupId) : groupId;
      const schoolConfig = App.schoolConfig || {};
      const schoolName = schoolConfig.nombre || 'ESCUELA PREPARATORIA OFICIAL NUM. 67';
      const cicloEscolar = schoolConfig.cicloEscolar || '2025-2026';

      // 5. Render boletas
      let html = '';
      targetStudents.forEach((student, idx) => {
        html += buildBoletaCard(student, finalSubjects, gradesMap[student.id] || {}, {
          schoolName,
          cicloEscolar,
          groupName,
          turno,
          grado,
          isLast: idx === targetStudents.length - 1
        });
      });

      resultsDiv.innerHTML = html;

    } catch (e) {
      console.error('Error generando boletas:', e);
      resultsDiv.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(e.message)}</p></div>`;
      Toast.show('Error al generar boletas', 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Build a single boleta card
  // ─────────────────────────────────────────────────────────────

  function buildBoletaCard(student, subjectsList, studentGrades, meta) {
    const parciales = K.PARCIALES;
    let totalsByPartial = {};
    let countByPartial = {};
    parciales.forEach(p => { totalsByPartial[p.id] = 0; countByPartial[p.id] = 0; });
    let grandTotal = 0;
    let grandCount = 0;

    const rows = subjectsList.map(subj => {
      const subjectGrades = studentGrades[subj.id] || {};
      let subjectSum = 0;
      let subjectCount = 0;

      const cells = parciales.map(p => {
        const val = subjectGrades[p.id];
        if (val !== undefined && val !== null) {
          totalsByPartial[p.id] += val;
          countByPartial[p.id]++;
          subjectSum += val;
          subjectCount++;
          return { value: val, display: Number(val).toFixed(1) };
        }
        return { value: null, display: '-' };
      });

      const final = subjectCount > 0 ? subjectSum / subjectCount : null;
      if (final !== null) {
        grandTotal += final;
        grandCount++;
      }

      const finalDisplay = final !== null ? final.toFixed(2) : '-';
      const finalClass = final !== null ? getGradeClass(final) : '';

      return `
        <tr>
          <td class="font-semibold">${Utils.sanitize(subj.nombre || subj.id)}</td>
          ${cells.map(c => `<td class="text-center"><span class="${c.value !== null ? 'grade-badge ' + getGradeClass(c.value) : ''}">${c.display}</span></td>`).join('')}
          <td class="text-center"><span class="${final !== null ? 'grade-badge ' + finalClass : ''} font-bold">${finalDisplay}</span></td>
        </tr>
      `;
    }).join('');

    // Promedio row
    const promedioRow = parciales.map(p => {
      const avg = countByPartial[p.id] > 0 ? totalsByPartial[p.id] / countByPartial[p.id] : null;
      if (avg !== null) {
        return `<td class="text-center font-bold"><span class="grade-badge ${getGradeClass(avg)}">${avg.toFixed(2)}</span></td>`;
      }
      return '<td class="text-center font-bold">-</td>';
    }).join('');

    const promedioFinal = grandCount > 0 ? grandTotal / grandCount : null;
    const promedioFinalDisplay = promedioFinal !== null ? promedioFinal.toFixed(2) : '-';
    const promedioFinalClass = promedioFinal !== null ? getGradeClass(promedioFinal) : '';

    const pageBreak = meta.isLast ? '' : ' boleta-page-break';

    return `
      <div class="card boleta-card${pageBreak}">
        <div class="boleta-header">
          <h2 class="boleta-school-name">${Utils.sanitize(meta.schoolName)}</h2>
          <p class="text-muted">Ciclo Escolar: ${Utils.sanitize(meta.cicloEscolar)}</p>
          <div class="boleta-student-info">
            <span class="font-semibold">Alumno: ${Utils.sanitize(student.nombreCompleto)}</span>
            <span class="text-muted">Grupo: ${Utils.sanitize(meta.groupName)}</span>
            <span class="text-muted">Turno: ${Utils.sanitize(meta.turno)}</span>
            <span class="text-muted">Grado: ${meta.grado}</span>
          </div>
        </div>
        <div class="table-container">
          <table class="table-light w-full">
            <thead>
              <tr>
                <th>Materia</th>
                ${parciales.map(p => `<th class="text-center">${p.id}</th>`).join('')}
                <th class="text-center">Final</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
              <tr class="boleta-promedio-row">
                <td class="font-bold">PROMEDIO GENERAL</td>
                ${promedioRow}
                <td class="text-center font-bold"><span class="grade-badge ${promedioFinalClass}">${promedioFinalDisplay}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        ${promedioFinal !== null ? buildStatusBadge(promedioFinal) : ''}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  function getGradeClass(value) {
    if (value >= 9) return 'grade-badge--excellent';
    if (value >= 8) return 'grade-badge--good';
    if (value >= (K.THRESHOLDS.PASS_GRADE || 6)) return 'grade-badge--fair';
    return 'grade-badge--fail';
  }

  function buildStatusBadge(promedio) {
    const pass = K.THRESHOLDS.PASS_GRADE || 6;
    if (promedio >= pass) {
      return `<div class="boleta-status"><span class="badge badge-success">Aprobado - Promedio: ${promedio.toFixed(2)}</span></div>`;
    }
    return `<div class="boleta-status"><span class="badge badge-danger">Reprobado - Promedio: ${promedio.toFixed(2)}</span></div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // Print
  // ─────────────────────────────────────────────────────────────

  function printBoletas() {
    const results = document.getElementById('bol-results');
    if (!results || results.querySelector('.empty-state') || results.querySelector('.loading-state')) {
      Toast.show('Genera primero las boletas', 'warning');
      return;
    }

    const schoolConfig = App.schoolConfig || {};
    const schoolName = schoolConfig.nombre || 'ESCUELA PREPARATORIA OFICIAL NUM. 67';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Boletas - ${Utils.sanitize(schoolName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; padding: 20px; color: #1f2937; font-size: 13px; }
    .boleta-card { page-break-inside: avoid; margin-bottom: 24px; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; }
    .boleta-page-break { page-break-after: always; }
    .boleta-header { text-align: center; margin-bottom: 16px; }
    .boleta-school-name { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .boleta-student-info { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .text-muted { color: #6b7280; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #f3f4f6; padding: 8px; text-align: left; font-weight: 600; font-size: 12px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
    .text-center { text-align: center; }
    .boleta-promedio-row { background: #f9fafb; border-top: 2px solid #e5e7eb; }
    .boleta-status { text-align: center; margin-top: 12px; }
    .badge-success { background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 12px; }
    .badge-danger { background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 12px; font-weight: 600; font-size: 12px; }
    .grade-badge { padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 12px; }
    .grade-badge--excellent { background: #d1fae5; color: #065f46; }
    .grade-badge--good { background: #dbeafe; color: #1e40af; }
    .grade-badge--fair { background: #fef3c7; color: #92400e; }
    .grade-badge--fail { background: #fee2e2; color: #991b1b; }
    .school-footer { margin-top: 30px; text-align: center; font-size: 11px; color: #9ca3af; }
    @media print {
      body { padding: 0; }
      .boleta-card { border: 1px solid #d1d5db; }
      .boleta-page-break { page-break-after: always; }
    }
  </style>
</head>
<body>
  ${results.innerHTML}
  <div class="school-footer"><p>Generado por el Sistema Escolar EPO 67</p></div>
  <script>setTimeout(() => window.print(), 500)<\/script>
</body>
</html>`);
    printWindow.document.close();
  }

  // ─────────────────────────────────────────────────────────────
  // Export to Excel
  // ─────────────────────────────────────────────────────────────

  function exportExcel() {
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;
    const groupId = document.getElementById('bol-grupo').value;
    const alumnoId = document.getElementById('bol-alumno').value;
    const resultsDiv = document.getElementById('bol-results');

    if (!resultsDiv || resultsDiv.querySelector('.empty-state') || resultsDiv.querySelector('.loading-state')) {
      Toast.show('Genera primero las boletas', 'warning');
      return;
    }

    // Rebuild the data for export
    const groupAssignments = assignments.filter(a => a.groupId === groupId);
    const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
    const groupSubjects = subjects
      .filter(s => subjectIds.includes(s.id) || (s.grado === parseInt(grado)))
      .filter(s => subjectIds.length > 0 ? subjectIds.includes(s.id) : true);

    const subjectMap = {};
    groupSubjects.forEach(s => { subjectMap[s.id] = s; });
    const finalSubjects = Object.values(subjectMap).sort((a, b) =>
      (a.nombre || '').localeCompare(b.nombre || '')
    );

    let targetStudents;
    if (alumnoId === 'todos') {
      targetStudents = students
        .filter(s => s.groupId === groupId || s.grupo === groupId)
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
    } else {
      const found = students.find(s => s.id === alumnoId);
      targetStudents = found ? [found] : [];
    }

    // We need grades again; extract from the DOM is fragile, so re-query
    // Since we already have them in memory from generate(), rebuild from Firestore cache
    db.collection('grades')
      .where('groupId', '==', groupId)
      .get()
      .then(gradesSnap => {
        const gradesMap = {};
        gradesSnap.forEach(doc => {
          const g = doc.data();
          if (!gradesMap[g.studentId]) gradesMap[g.studentId] = {};
          if (!gradesMap[g.studentId][g.subjectId]) gradesMap[g.studentId][g.subjectId] = {};
          gradesMap[g.studentId][g.subjectId][g.partial] = g.value || 0;
        });

        const parciales = K.PARCIALES;
        const exportData = [];

        targetStudents.forEach(student => {
          const sg = gradesMap[student.id] || {};
          finalSubjects.forEach(subj => {
            const subjectGrades = sg[subj.id] || {};
            const row = {
              'Alumno': student.nombreCompleto || '',
              'Materia': subj.nombre || subj.id
            };

            let sum = 0;
            let count = 0;
            parciales.forEach(p => {
              const val = subjectGrades[p.id];
              if (val !== undefined && val !== null) {
                row[p.id] = Number(val);
                sum += val;
                count++;
              } else {
                row[p.id] = '';
              }
            });

            row['Final'] = count > 0 ? Math.round((sum / count) * 100) / 100 : '';
            exportData.push(row);
          });
        });

        const groupInfo = groups.find(g => g.id === groupId);
        const groupName = groupInfo ? (groupInfo.nombre || groupId) : groupId;
        Utils.exportToExcel(exportData, `boletas-${groupName}.xlsx`);
      })
      .catch(err => {
        console.error('Error exportando boletas:', err);
        Toast.show('Error al exportar boletas', 'error');
      });
  }

  // ─────────────────────────────────────────────────────────────
  // Event binding
  // ─────────────────────────────────────────────────────────────

  function bindEvents(container) {
    // Delegated click actions
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'generate') generate();
      else if (action === 'print') printBoletas();
      else if (action === 'export-excel') exportExcel();
    });

    // Cascading filter changes
    const turnoSelect = document.getElementById('bol-turno');
    const gradoSelect = document.getElementById('bol-grado');
    const grupoSelect = document.getElementById('bol-grupo');

    if (turnoSelect) turnoSelect.addEventListener('change', onTurnoChange);
    if (gradoSelect) gradoSelect.addEventListener('change', onGradoChange);
    if (grupoSelect) grupoSelect.addEventListener('change', onGrupoChange);
  }

  return { render };
})();

Router.modules['boletas'] = () => BoletasModule.render();
