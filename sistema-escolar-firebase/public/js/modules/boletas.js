/**
 * BOLETAS MODULE — Sistema Escolar EPO 67
 *
 * Genera boletas de calificaciones con formato oficial:
 * - Encabezado del Estado de México
 * - 2 modos: Parcial individual (EC, TR, EP, SUMA, FALTAS, CAL) o
 *            Todos los parciales (P1, P2, P3, FINAL)
 * - Líneas de firma: Orientador, Director, Firma de Enterado
 * - Formato carta (letter) optimizado para impresión
 */

const BoletasModule = (() => {
  let groups = [];
  let students = [];
  let subjects = [];
  let assignments = [];
  let orientadorGroupIds = null; // null = no filter (admin), array = orientador filter

  // ─────────────────────────────────────────────────────────────
  // Render principal
  // ─────────────────────────────────────────────────────────────

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
    const parcialOptions = K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Boletas de Calificaciones', 'Genera boletas individuales o por grupo con formato oficial')}

        <div class="card filter-bar">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
            <div class="form-group">
              <label for="bol-turno">Turno</label>
              <select id="bol-turno"><option value="">-- Selecciona --</option>${turnoOptions}</select>
            </div>
            <div class="form-group">
              <label for="bol-grado">Grado</label>
              <select id="bol-grado" disabled><option value="">-- Selecciona --</option></select>
            </div>
            <div class="form-group">
              <label for="bol-grupo">Grupo</label>
              <select id="bol-grupo" disabled><option value="">-- Selecciona --</option></select>
            </div>
            <div class="form-group">
              <label for="bol-parcial">Parcial</label>
              <select id="bol-parcial">
                <option value="todos">Todos los parciales</option>
                ${parcialOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="bol-alumno">Alumno</label>
              <select id="bol-alumno" disabled><option value="">-- Selecciona --</option></select>
            </div>
          </div>
          <div class="filter-bar-actions" style="margin-top:12px;">
            <button class="btn btn-primary" data-action="generate">Generar Boleta</button>
            <button class="btn btn-outline" data-action="print">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir
            </button>
            <button class="btn btn-outline" data-action="export-excel">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</span>Excel
            </button>
          </div>
        </div>

        <div id="bol-results">
          ${UI.emptyState('description', 'Selecciona turno, grado, grupo y parcial, luego haz clic en Generar Boleta')}
        </div>
      </div>
    `;

    await loadData();
    bindEvents(container);
  }

  async function loadData() {
    try {
      const [g, s, sub, asgn, oriGroups] = await Promise.all([
        Store.getGroups(), Store.getStudents(), Store.getSubjects(), Store.getAssignments(),
        Store.getOrientadorGroups()
      ]);
      orientadorGroupIds = oriGroups; // null for admin, array for orientador
      groups = oriGroups ? g.filter(gr => oriGroups.includes(gr.id)) : g;
      students = s.filter(st => st.estatus === 'ACTIVO');
      subjects = sub;
      assignments = asgn;
    } catch (e) {
      console.error('Error cargando datos para boletas:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cascading filters
  // ─────────────────────────────────────────────────────────────

  function onTurnoChange() {
    const turno = document.getElementById('bol-turno').value;
    const gradoSel = document.getElementById('bol-grado');
    const grupoSel = document.getElementById('bol-grupo');
    const alumnoSel = document.getElementById('bol-alumno');

    grupoSel.innerHTML = '<option value="">-- Selecciona --</option>';
    grupoSel.disabled = true;
    alumnoSel.innerHTML = '<option value="">-- Selecciona --</option>';
    alumnoSel.disabled = true;

    if (!turno) {
      gradoSel.innerHTML = '<option value="">-- Selecciona --</option>';
      gradoSel.disabled = true;
      return;
    }

    const grados = [...new Set(groups.filter(g => g.turno === turno).map(g => g.grado))].sort((a, b) => a - b);
    gradoSel.innerHTML = '<option value="">-- Selecciona --</option>' + grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');
    gradoSel.disabled = false;
  }

  function onGradoChange() {
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;
    const grupoSel = document.getElementById('bol-grupo');
    const alumnoSel = document.getElementById('bol-alumno');

    alumnoSel.innerHTML = '<option value="">-- Selecciona --</option>';
    alumnoSel.disabled = true;

    if (!grado) {
      grupoSel.innerHTML = '<option value="">-- Selecciona --</option>';
      grupoSel.disabled = true;
      return;
    }

    const filtered = groups.filter(g => g.turno === turno && g.grado === parseInt(grado));
    grupoSel.innerHTML = '<option value="">-- Selecciona --</option>' + filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
    grupoSel.disabled = false;
  }

  function onGrupoChange() {
    const groupId = document.getElementById('bol-grupo').value;
    const alumnoSel = document.getElementById('bol-alumno');

    if (!groupId) {
      alumnoSel.innerHTML = '<option value="">-- Selecciona --</option>';
      alumnoSel.disabled = true;
      return;
    }

    const filtered = students
      .filter(s => s.groupId === groupId || s.grupo === groupId)
      .sort((a, b) => (a.np || 0) - (b.np || 0));

    alumnoSel.innerHTML = '<option value="todos">Todo el grupo</option>' + filtered.map(s => `<option value="${s.id}">${Utils.sanitize(s.nombreCompleto)}</option>`).join('');
    alumnoSel.disabled = false;
  }

  // ─────────────────────────────────────────────────────────────
  // Generate boletas
  // ─────────────────────────────────────────────────────────────

  async function generate() {
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;
    const groupId = document.getElementById('bol-grupo').value;
    const parcialMode = document.getElementById('bol-parcial').value;
    const alumnoId = document.getElementById('bol-alumno').value;
    const resultsDiv = document.getElementById('bol-results');

    if (!turno || !grado || !groupId) {
      Toast.show('Selecciona turno, grado y grupo', 'warning');
      return;
    }
    if (!alumnoId) {
      Toast.show('Selecciona un alumno o "Todo el grupo"', 'warning');
      return;
    }

    resultsDiv.innerHTML = UI.loadingState('Generando boletas...');

    try {
      // Get subjects for this group
      const groupAssignments = assignments.filter(a => a.groupId === groupId);
      const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
      const groupSubjects = subjects.filter(s => subjectIds.includes(s.id));
      groupSubjects.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      if (groupSubjects.length === 0) {
        resultsDiv.innerHTML = UI.emptyState('menu_book', 'No se encontraron materias asignadas para este grupo.');
        return;
      }

      // Get students
      let targetStudents;
      if (alumnoId === 'todos') {
        targetStudents = students
          .filter(s => s.groupId === groupId || s.grupo === groupId)
          .sort((a, b) => (a.np || 0) - (b.np || 0));
      } else {
        const found = students.find(s => s.id === alumnoId);
        targetStudents = found ? [found] : [];
      }

      if (targetStudents.length === 0) {
        resultsDiv.innerHTML = UI.emptyState('person_off', 'No se encontraron alumnos.');
        return;
      }

      // Fetch grades for this group via Store cache
      const groupGrades = await Store.getGradesByGroup(groupId);
      const gradesMap = {};
      for (const g of groupGrades) {
        if (!gradesMap[g.studentId]) gradesMap[g.studentId] = {};
        if (!gradesMap[g.studentId][g.subjectId]) gradesMap[g.studentId][g.subjectId] = {};
        gradesMap[g.studentId][g.subjectId][g.partial] = g;
      }

      // Group info
      const groupInfo = groups.find(g => g.id === groupId);
      const groupName = groupInfo ? (groupInfo.nombre || groupId) : groupId;
      const schoolConfig = App.schoolConfig || {};
      const cicloEscolar = schoolConfig.cicloEscolar || '2025-2026';
      const orientador = K.getOrientador(turno, groupName);

      const meta = {
        cicloEscolar, groupName, turno, grado, parcialMode, orientador
      };

      // Render
      let html = '';
      targetStudents.forEach((student, idx) => {
        html += _buildBoleta(student, groupSubjects, gradesMap[student.id] || {}, meta, idx === targetStudents.length - 1);
      });

      resultsDiv.innerHTML = html;
    } catch (e) {
      console.error('Error generando boletas:', e);
      resultsDiv.innerHTML = UI.errorState('Error al generar boletas: ' + e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Build single boleta — formato oficial
  // ─────────────────────────────────────────────────────────────

  function _buildBoleta(student, subjectsList, studentGrades, meta, isLast) {
    const parcialMode = meta.parcialMode; // 'todos' or 'P1', 'P2', 'P3'
    const isTodos = parcialMode === 'todos';
    const rubros = K.getRubros(meta.turno);

    // ─── Encabezado oficial ───
    const headerLines = K.BOLETA_HEADER.map(line =>
      `<div style="font-size:9px;font-weight:600;letter-spacing:0.3px;line-height:1.3;">${Utils.sanitize(line)}</div>`
    ).join('');

    const parcialLabel = isTodos ? 'TODOS LOS PARCIALES' :
      (K.PARCIALES.find(p => p.id === parcialMode)?.nombre || parcialMode).toUpperCase();

    // ─── Info del alumno ───
    const gradoNombre = K.GRADO_NOMBRE[meta.grado] || meta.grado;

    // ─── Build grade table ───
    let tableHeader, tableRows;
    let grandTotal = 0, grandCount = 0;

    if (isTodos) {
      // Mode: All parcials → P1, P2, P3, FINAL
      tableHeader = `
        <tr>
          <th style="width:30px;text-align:center;">N°</th>
          <th>UNIDAD DE APRENDIZAJE CURRICULAR</th>
          ${K.PARCIALES.map(p => `<th style="text-align:center;width:50px;">${p.id}</th>`).join('')}
          <th style="text-align:center;width:55px;">FINAL</th>
        </tr>`;

      tableRows = subjectsList.map((subj, idx) => {
        const sg = studentGrades[subj.id] || {};
        let sum = 0, cnt = 0;
        const cells = K.PARCIALES.map(p => {
          const gradeDoc = sg[p.id];
          const cal = gradeDoc ? (gradeDoc.cal !== undefined ? gradeDoc.cal : gradeDoc.value) : null;
          if (cal !== null && cal !== undefined && cal !== '') {
            sum += Number(cal); cnt++;
            const isFail = Number(cal) < K.THRESHOLDS.PASS_GRADE;
            return `<td style="text-align:center;${isFail ? 'background:#ddd;font-weight:700;' : ''}">${cal}</td>`;
          }
          return '<td style="text-align:center;">-</td>';
        }).join('');

        const final = cnt > 0 ? Math.round((sum / cnt) * 100) / 100 : null;
        if (final !== null) { grandTotal += final; grandCount++; }
        const finalDisplay = final !== null ? final.toFixed(1) : '-';
        const finalFail = final !== null && final < K.THRESHOLDS.PASS_GRADE;

        const bg = idx % 2 === 1 ? 'background:#f5f5f5;' : '';

        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${cells}
          <td style="text-align:center;font-weight:700;${finalFail ? 'background:#ddd;' : ''}">${finalDisplay}</td>
        </tr>`;
      }).join('');

    } else {
      // Mode: Single parcial → EC, TR, (EX), PE, SUMA, FALTAS, CAL
      const rubroHeaders = rubros.map(r =>
        `<th style="text-align:center;width:45px;font-size:9px;">${r.abbr}</th>`
      ).join('');

      tableHeader = `
        <tr>
          <th style="width:30px;text-align:center;">N°</th>
          <th>UNIDAD DE APRENDIZAJE CURRICULAR</th>
          ${rubroHeaders}
          <th style="text-align:center;width:45px;">SUMA</th>
          <th style="text-align:center;width:50px;">FALTAS</th>
          <th style="text-align:center;width:40px;">CAL.</th>
        </tr>`;

      tableRows = subjectsList.map((subj, idx) => {
        const sg = studentGrades[subj.id] || {};
        const gradeDoc = sg[parcialMode] || {};

        const rubroCells = rubros.map(r => {
          const v = gradeDoc[r.key];
          return `<td style="text-align:center;font-size:10px;">${v !== undefined ? v : '-'}</td>`;
        }).join('');

        const suma = gradeDoc.suma !== undefined ? Number(gradeDoc.suma).toFixed(1) : '-';
        const faltas = gradeDoc.faltas !== undefined ? gradeDoc.faltas : '-';
        const cal = gradeDoc.cal !== undefined ? gradeDoc.cal : (gradeDoc.value !== undefined ? gradeDoc.value : '-');

        if (cal !== '-' && cal !== '' && cal !== null) {
          grandTotal += Number(cal); grandCount++;
        }

        const isFail = cal !== '-' && Number(cal) < K.THRESHOLDS.PASS_GRADE;
        const bg = idx % 2 === 1 ? 'background:#f5f5f5;' : '';

        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${rubroCells}
          <td style="text-align:center;">${suma}</td>
          <td style="text-align:center;">${faltas}</td>
          <td style="text-align:center;font-weight:700;${isFail ? 'background:#ddd;' : ''}">${cal}</td>
        </tr>`;
      }).join('');
    }

    // Promedio general
    const promedio = grandCount > 0 ? (grandTotal / grandCount).toFixed(2) : '-';
    const promedioFail = promedio !== '-' && parseFloat(promedio) < K.THRESHOLDS.PASS_GRADE;
    const colSpan = isTodos ? K.PARCIALES.length + 2 : rubros.length + 4;

    // Promedio row
    const promedioRow = `
      <tr style="border-top:2px solid #333;">
        <td colspan="${colSpan - 1}" style="text-align:right;font-weight:700;font-size:11px;padding:6px 8px;">PROMEDIO GENERAL:</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${promedioFail ? 'background:#ddd;' : ''}">${promedio}</td>
      </tr>`;

    // Firmas
    const firmasHtml = `
      <table style="width:100%;margin-top:30px;border-collapse:collapse;">
        <tr>
          <td style="width:33%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
          <td style="width:5%;">&nbsp;</td>
          <td style="width:28%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
          <td style="width:5%;">&nbsp;</td>
          <td style="width:29%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
        </tr>
        <tr>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">ORIENTADOR(A)</td>
          <td>&nbsp;</td>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">DIRECTOR</td>
          <td>&nbsp;</td>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">FIRMA DE ENTERADO</td>
        </tr>
        ${meta.orientador ? `<tr><td style="text-align:center;font-size:8px;color:#555;">${Utils.sanitize(meta.orientador)}</td><td></td><td></td><td></td><td></td></tr>` : ''}
      </table>`;

    const pageBreak = isLast ? '' : ' style="page-break-after:always;"';

    return `
      <div class="boleta-card"${pageBreak}>
        <div style="text-align:center;margin-bottom:12px;">
          ${headerLines}
          <div style="font-size:11px;font-weight:700;margin-top:6px;letter-spacing:1px;">BOLETA DE CALIFICACIONES</div>
          <div style="font-size:9px;margin-top:2px;">CICLO ESCOLAR ${Utils.sanitize(meta.cicloEscolar)} — ${parcialLabel}</div>
        </div>

        <table style="width:100%;font-size:10px;margin-bottom:10px;border-collapse:collapse;">
          <tr>
            <td style="width:60%;"><strong>ALUMNO(A):</strong> ${Utils.sanitize(student.nombreCompleto || '')}</td>
            <td><strong>EXP:</strong> ${Utils.sanitize(student.expediente || '')}</td>
          </tr>
          <tr>
            <td><strong>GRADO:</strong> ${gradoNombre} &nbsp;&nbsp; <strong>GRUPO:</strong> ${Utils.sanitize(meta.groupName)}</td>
            <td><strong>TURNO:</strong> ${Utils.sanitize(meta.turno)}</td>
          </tr>
          <tr>
            <td><strong>FOLIO:</strong> ${Utils.sanitize(student.folio || '')}</td>
            <td><strong>ORIENTADOR(A):</strong> ${Utils.sanitize(meta.orientador || '')}</td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;border:1px solid #333;font-size:10px;">
          <thead style="background:#e0e0e0;">
            ${tableHeader}
          </thead>
          <tbody>
            ${tableRows}
            ${promedioRow}
          </tbody>
        </table>

        ${firmasHtml}
      </div>
    `;
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

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Boletas EPO 67</title>
  <style>
    @page { size: letter portrait; margin: 10mm 12mm 8mm 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #000; font-size: 10px; }
    .boleta-card { padding: 10px 0; }
    table { border-collapse: collapse; }
    th, td { padding: 3px 5px; border: 1px solid #333; }
    thead { background: #e0e0e0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @media print {
      .boleta-card[style*="page-break-after"] { page-break-after: always; }
    }
  </style>
</head>
<body>
  ${results.innerHTML}
  <script>setTimeout(() => window.print(), 400)<\/script>
</body>
</html>`);
    printWindow.document.close();
  }

  // ─────────────────────────────────────────────────────────────
  // Export to Excel
  // ─────────────────────────────────────────────────────────────

  function exportExcel() {
    const groupId = document.getElementById('bol-grupo').value;
    const parcialMode = document.getElementById('bol-parcial').value;
    const alumnoId = document.getElementById('bol-alumno').value;
    const turno = document.getElementById('bol-turno').value;
    const grado = document.getElementById('bol-grado').value;

    if (!groupId) { Toast.show('Genera primero las boletas', 'warning'); return; }

    const groupAssignments = assignments.filter(a => a.groupId === groupId);
    const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
    const groupSubjects = subjects.filter(s => subjectIds.includes(s.id));
    groupSubjects.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    let targetStudents;
    if (alumnoId === 'todos') {
      targetStudents = students.filter(s => s.groupId === groupId || s.grupo === groupId).sort((a, b) => (a.np || 0) - (b.np || 0));
    } else {
      const found = students.find(s => s.id === alumnoId);
      targetStudents = found ? [found] : [];
    }

    Store.getGradesByGroup(groupId).then(groupGrades => {
      const gMap = {};
      for (const g of groupGrades) {
        if (!gMap[g.studentId]) gMap[g.studentId] = {};
        if (!gMap[g.studentId][g.subjectId]) gMap[g.studentId][g.subjectId] = {};
        gMap[g.studentId][g.subjectId][g.partial] = g;
      }

      const data = [];
      const rubros = K.getRubros(turno);
      const isTodos = parcialMode === 'todos';

      targetStudents.forEach(st => {
        const sg = gMap[st.id] || {};
        groupSubjects.forEach(subj => {
          const subjGrades = sg[subj.id] || {};

          if (isTodos) {
            const row = { 'Alumno': st.nombreCompleto, 'Materia': K.getUACNombre(subj.nombre) };
            let sum = 0, cnt = 0;
            K.PARCIALES.forEach(p => {
              const gd = subjGrades[p.id];
              const cal = gd ? (gd.cal !== undefined ? gd.cal : gd.value) : '';
              row[p.id] = cal !== '' && cal !== undefined ? Number(cal) : '';
              if (cal !== '' && cal !== undefined) { sum += Number(cal); cnt++; }
            });
            row['FINAL'] = cnt > 0 ? Math.round((sum / cnt) * 100) / 100 : '';
            data.push(row);
          } else {
            const gd = subjGrades[parcialMode] || {};
            const row = { 'Alumno': st.nombreCompleto, 'Materia': K.getUACNombre(subj.nombre) };
            rubros.forEach(r => { row[r.abbr] = gd[r.key] !== undefined ? gd[r.key] : ''; });
            row['SUMA'] = gd.suma !== undefined ? gd.suma : '';
            row['CAL.'] = gd.cal !== undefined ? gd.cal : (gd.value !== undefined ? gd.value : '');
            row['FALTAS'] = gd.faltas !== undefined ? gd.faltas : '';
            data.push(row);
          }
        });
      });

      const groupInfo = groups.find(g => g.id === groupId);
      Utils.exportToExcel(data, `Boletas_${groupInfo?.nombre || groupId}_${parcialMode}.xlsx`);
    }).catch(err => {
      console.error('Error exportando:', err);
      Toast.show('Error al exportar', 'error');
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Event binding
  // ─────────────────────────────────────────────────────────────

  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'generate') generate();
      else if (action === 'print') printBoletas();
      else if (action === 'export-excel') exportExcel();
    });

    document.getElementById('bol-turno')?.addEventListener('change', onTurnoChange);
    document.getElementById('bol-grado')?.addEventListener('change', onGradoChange);
    document.getElementById('bol-grupo')?.addEventListener('change', onGrupoChange);
  }

  return { render };
})();

Router.modules['boletas'] = () => BoletasModule.render();
