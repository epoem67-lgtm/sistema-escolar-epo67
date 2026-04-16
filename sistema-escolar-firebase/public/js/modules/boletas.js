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
        ${UI.pageHeader('Pre Boletas de Calificaciones', 'Genera pre boletas individuales o por grupo con formato oficial')}

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
              <label for="bol-estatus">Filtrar por</label>
              <select id="bol-estatus">
                <option value="todos">Todos los alumnos</option>
                <option value="reprobados">Solo Reprobados</option>
                <option value="aprobados">Solo Aprobados</option>
              </select>
            </div>
            <div class="form-group">
              <label for="bol-alumno">Alumno</label>
              <select id="bol-alumno" disabled><option value="">-- Selecciona --</option></select>
            </div>
          </div>
          <div class="filter-bar-actions" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <button class="btn btn-primary" data-action="generate">Generar Boleta</button>
            <button class="btn btn-danger" data-action="gen-reprobados" style="font-weight:600;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">warning</span>Reprobados
            </button>
            <button class="btn btn-success" data-action="gen-aprobados">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">check_circle</span>Aprobados
            </button>
            <span style="border-left:1px solid #ddd;height:24px;margin:0 4px;"></span>
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
      .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

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
          .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
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

      // Filtro por estatus academico (reprobados/aprobados)
      const estatusFiltro = document.getElementById('bol-estatus')?.value || 'todos';
      const totalBeforeFilter = targetStudents.length;

      if (estatusFiltro !== 'todos') {
        const passGrade = K.THRESHOLDS?.PASS_GRADE || 6;
        targetStudents = targetStudents.filter(student => {
          const sg = gradesMap[student.id] || {};
          let hasReprobada = false;

          for (const subId of subjectIds) {
            if (parcialMode === 'todos') {
              // Check all partials
              for (const p of K.PARCIALES) {
                const gd = sg[subId]?.[p.id];
                const cal = gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
                if (cal !== null && cal < passGrade) { hasReprobada = true; break; }
              }
            } else {
              // Check specific partial
              const gd = sg[subId]?.[parcialMode];
              const cal = gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
              if (cal !== null && cal < passGrade) { hasReprobada = true; break; }
            }
            if (hasReprobada) break;
          }

          return estatusFiltro === 'reprobados' ? hasReprobada : !hasReprobada;
        });
      }

      if (targetStudents.length === 0) {
        const label = estatusFiltro === 'reprobados' ? 'reprobados' : 'aprobados';
        resultsDiv.innerHTML = UI.emptyState('check_circle', `No hay alumnos ${label} en este grupo para el parcial seleccionado.`);
        return;
      }

      // Render
      const filterLabel = estatusFiltro === 'todos' ? '' :
        estatusFiltro === 'reprobados' ? ' (Solo Reprobados)' : ' (Solo Aprobados)';
      let html = `<div class="alert alert-info no-print" style="margin-bottom:12px;">Mostrando <strong>${targetStudents.length}</strong> de ${totalBeforeFilter} alumnos${filterLabel}</div>`;

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
    const parcialMode = meta.parcialMode;
    const isTodos = parcialMode === 'todos';
    const rubros = K.getRubros(meta.turno);
    const gradoNombre = K.GRADO_NOMBRE[meta.grado] || meta.grado;
    const semestre = { 1: 'PRIMERO', 2: 'TERCERO', 3: 'QUINTO' }[meta.grado] || '';
    const headerLines = K.BOLETA_HEADER.map(line =>
      `<div style="font-size:10px;font-weight:600;letter-spacing:0.3px;line-height:1.3;">${Utils.sanitize(line)}</div>`
    ).join('');
    const parcialLabel = isTodos ? 'TODOS LOS PARCIALES' :
      (K.PARCIALES.find(p => p.id === parcialMode)?.nombre || parcialMode).toUpperCase();

    // ─── Decide format: new (all parcials with faltas+cal+obs) or legacy (single parcial rubros) ───
    let tableHeader, tableRows, promedioRow;
    let grandTotal = 0, grandCount = 0;
    let parcialReprobadas = 0, parcialFaltasTotal = 0;
    let promedio = '-';
    let nivelRiesgo = { text: 'SIN RIESGO', color: '#2e7d32', bg: '#e8f5e9', border: '#2e7d32' };

    if (isTodos) {
      // ═══ NEW FORMAT: Faltas 1a,2a,3a | Cal 1a,2a,3a | Observaciones ═══
      tableHeader = `
        <tr>
          <th rowspan="2" style="width:35%;text-align:left;">COMPONENTE B\u00c1SICO</th>
          <th colspan="3" style="text-align:center;">Faltas</th>
          <th colspan="3" style="text-align:center;">Calificaci\u00f3n</th>
          <th rowspan="2" style="text-align:center;">Observaciones</th>
        </tr>
        <tr>
          <th style="text-align:center;width:30px;">1\u00aa.</th>
          <th style="text-align:center;width:30px;">2\u00aa.</th>
          <th style="text-align:center;width:30px;">3\u00aa.</th>
          <th style="text-align:center;width:35px;">1\u00aa.</th>
          <th style="text-align:center;width:35px;">2\u00aa.</th>
          <th style="text-align:center;width:35px;">3\u00aa.</th>
        </tr>`;

      const promedios = { P1: { sum: 0, cnt: 0 }, P2: { sum: 0, cnt: 0 }, P3: { sum: 0, cnt: 0 } };

      tableRows = subjectsList.map((subj, idx) => {
        const sg = studentGrades[subj.id] || {};
        const faltasCells = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          const f = gd && gd.faltas !== undefined ? gd.faltas : '';
          return `<td style="text-align:center;font-size:9px;">${f}</td>`;
        }).join('');
        const calCells = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          const cal = gd ? (gd.cal !== undefined ? gd.cal : gd.value) : null;
          let style = 'text-align:center;font-size:10px;';
          if (cal !== null && cal !== undefined && cal !== '') {
            promedios[p.id].sum += Number(cal);
            promedios[p.id].cnt++;
            if (Number(cal) < K.THRESHOLDS.PASS_GRADE) style += 'font-weight:700;';
            return `<td style="${style}">${cal}</td>`;
          }
          return `<td style="${style}"></td>`;
        }).join('');
        const calValues = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          return gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
        });
        const failCount = calValues.filter(v => v !== null && v < K.THRESHOLDS.PASS_GRADE).length;
        let observation = '';
        if (failCount >= 2) observation = 'Extraordinario por calificaci\u00f3n';
        else if (failCount === 1) observation = 'Riesgo de extraordinario';
        const hasFail = calValues.some(v => v !== null && v < K.THRESHOLDS.PASS_GRADE);
        const bg = hasFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f9f9f9;' : '');
        return `<tr style="${bg}">
          <td style="font-size:9px;padding:2px 4px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${faltasCells}${calCells}
          <td style="font-size:9px;color:#555;padding:2px 4px;">${observation}</td>
        </tr>`;
      }).join('');

      const promedioCells = K.PARCIALES.map(p => {
        const s = promedios[p.id];
        const avg = s.cnt > 0 ? (s.sum / s.cnt).toFixed(1) : '';
        return `<td style="text-align:center;font-weight:700;">${avg}</td>`;
      }).join('');
      promedioRow = `<tr style="border-top:2px solid #333;background:#eee;">
        <td colspan="4" style="text-align:right;font-weight:700;padding:4px 8px;">PROMEDIO</td>
        ${promedioCells}<td></td>
      </tr>`;

    } else {
      // ═══ LEGACY FORMAT: Single parcial with rubros ═══
      const rubroHeaders = rubros.map(r =>
        `<th style="text-align:center;width:45px;font-size:9px;">${r.abbr}</th>`
      ).join('');
      tableHeader = `<tr>
          <th style="width:30px;text-align:center;">N\u00b0</th>
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
        if (cal !== '-' && cal !== '' && cal !== null) { grandTotal += Number(cal); grandCount++; }
        const isFail = cal !== '-' && Number(cal) < K.THRESHOLDS.PASS_GRADE;
        const bg = isFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f5f5f5;' : '');
        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${rubroCells}
          <td style="text-align:center;">${suma}</td>
          <td style="text-align:center;">${faltas}</td>
          <td style="text-align:center;font-weight:700;${isFail ? 'background:#ddd;' : ''}">${cal}</td>
        </tr>`;
      }).join('');
      promedio = grandCount > 0 ? (grandTotal / grandCount).toFixed(2) : '-';
      const promedioFail = promedio !== '-' && parseFloat(promedio) < K.THRESHOLDS.PASS_GRADE;
      const colSpan = rubros.length + 4;
      promedioRow = `<tr style="border-top:2px solid #333;">
        <td colspan="${colSpan - 1}" style="text-align:right;font-weight:700;font-size:11px;padding:6px 8px;">PROMEDIO GENERAL:</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${promedioFail ? 'background:#ddd;' : ''}">${promedio}</td>
      </tr>`;

      // Calcular resumen para parcial individual
      let parcialReprobadas = 0;
      let parcialFaltasTotal = 0;
      subjectsList.forEach(subj => {
        const sg = studentGrades[subj.id] || {};
        const gd = sg[parcialMode] || {};
        const cal = gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null);
        if (cal !== null && cal < K.THRESHOLDS.PASS_GRADE) parcialReprobadas++;
        if (gd.faltas !== undefined && !isNaN(gd.faltas)) parcialFaltasTotal += Number(gd.faltas);
      });

      const nivelRiesgo = parcialReprobadas >= 3 ? { text: 'ALTO RIESGO', color: '#c62828', bg: '#ffebee', border: '#c62828' }
        : parcialReprobadas >= 1 ? { text: 'EN RIESGO', color: '#e65100', bg: '#fff3e0', border: '#e65100' }
        : { text: 'SIN RIESGO', color: '#2e7d32', bg: '#e8f5e9', border: '#2e7d32' };
    }

    // ─── Observaciones META ───
    const metaText = isTodos ? `
      <table style="width:100%;border:1px solid #333;border-collapse:collapse;margin-top:8px;font-size:9px;">
        <tr><td style="background:#e0e0e0;font-weight:700;padding:3px 6px;font-size:9px;border:1px solid #333;">OBSERVACIONES Y SUGERENCIAS POR PARTE DEL DEPARTAMENTO DE ORIENTACI\u00d3N</td></tr>
        <tr><td style="padding:4px 6px;line-height:1.4;border:1px solid #333;">
          Lineamientos para la aplicaci\u00f3n del META del Bachillerato General (Gaceta del Gobierno del Estado de M\u00e9xico)<br>
          Calificaci\u00f3n aprobatoria: acumule de 18 a 30 puntos en la evaluaci\u00f3n final. Cubra el m\u00ednimo del 80% de asistencia y obtenga dos de las tres evaluaciones parciales acreditadas.<br>
          Calificaci\u00f3n NO aprobatoria: cuando el promedio de las tres evaluaciones sea menor a 6 puntos, exceda del 20% de inasistencias y tenga dos de las tres evaluaciones parciales NO acreditadas<br>
          Procedimiento para la Regularizaci\u00f3n de las UAC/ materias<br>
          1er oportunidad: asesor\u00eda complementaria con duraci\u00f3n de 25 horas, con la entrega obligatoria de un producto final que evidencia el logro de las competencias.<br>
          2da oportunidad. Examen de contenidos, habilidades y actitudes.<br>
          3er oportunidad: evaluaci\u00f3n de competencias desarrolladas en escenarios reales o simulados
        </td></tr>
      </table>` : '';

    // ─── Pie de boleta ───
    const firmasPadres = isTodos ? `
      <div style="margin-top:10px;font-size:10px;line-height:1.8;">
        <div style="font-size:9px;font-style:italic;margin-bottom:4px;">Documento NO OFICIAL para uso del Departamento de Orientaci\u00f3n Educativa</div>
        <div>En calidad de padre/madre de familia o tutor del (la)alumno (a) ___________________________________________</div>
        <div>Del grupo <strong>${Utils.sanitize(meta.grado)}\u00b0${Utils.sanitize(meta.groupName)}</strong></div>
        <div style="margin-top:2px;">Estoy en conocimiento y de acuerdo con las calificaciones asentadas en la pre- boleta.</div>
        <div style="margin-top:8px;">NOMBRE DE LA MADRE, PADRE DE FAMILIA: ___________________________________________________________</div>
        <div style="margin-top:6px;">FIRMA: _________________________________ NUMERO DE CONTACTO: ___________________________________</div>
        <div style="margin-top:8px;text-align:right;font-size:9px;">Cuautitl\u00e1n Izcalli, M\u00e9x. A _________ de ___________________________ de  2025.</div>
      </div>` : `
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
        ${meta.orientador ? `<tr><td style="text-align:center;font-size:9px;color:#555;">${Utils.sanitize(meta.orientador)}</td><td></td><td></td><td></td><td></td></tr>` : ''}
      </table>`;

    const pageBreak = isLast ? '' : ' style="page-break-after:always;"';

    return `
      <div class="boleta-card"${pageBreak}>
        <!-- Header oficial -->
        <div style="text-align:center;margin-bottom:4px;">
          <img src="/img/header-gobierno-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
        </div>
        <div style="text-align:center;margin-bottom:${isTodos ? '6' : '12'}px;">
          ${headerLines}
          ${isTodos ? `<div style="font-size:9px;font-weight:600;margin-top:4px;">DEPARTAMENTO DE ORIENTACI\u00d3N EDUCATIVA &mdash; TURNO ${Utils.sanitize(meta.turno)}</div>` : ''}
          <div style="font-size:11px;font-weight:700;margin-top:4px;letter-spacing:1px;">PRE BOLETA DE CALIFICACIONES</div>
          ${!isTodos ? `<div style="font-size:9px;margin-top:2px;">CICLO ESCOLAR ${Utils.sanitize(meta.cicloEscolar)} &mdash; ${parcialLabel}</div>` : ''}
        </div>

        <table style="width:100%;font-size:${isTodos ? '9.5' : '10'}px;margin-bottom:${isTodos ? '6' : '10'}px;border-collapse:collapse;">
          ${isTodos ? `
          <tr>
            <td><strong>GRADO:</strong> ${gradoNombre}</td>
            <td><strong>GRUPO:</strong> ${Utils.sanitize(meta.groupName)}</td>
            <td><strong>SEMESTRE:</strong> ${semestre}</td>
            <td><strong>CICLO ESCOLAR:</strong> ${Utils.sanitize(meta.cicloEscolar)}</td>
          </tr>
          <tr>
            <td colspan="3"><strong>NOMBRE DEL ALUMNO(A):</strong> &nbsp; ${Utils.sanitize(student.nombreCompleto || '')}</td>
            <td><strong>N.L.</strong> ${Utils.sanitize(String(student.np || ''))}</td>
          </tr>` : `
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
          </tr>`}
        </table>

        ${!isTodos ? `
        <div style="display:flex;justify-content:center;gap:16px;margin:10px 0;font-family:Arial,sans-serif;">
          <div style="text-align:center;padding:8px 18px;border:2px solid #333;border-radius:8px;">
            <div style="font-size:22px;font-weight:800;color:#333;">${promedio}</div>
            <div style="font-size:9px;color:#666;">Promedio</div>
          </div>
          <div style="text-align:center;padding:8px 18px;border:2px solid ${parcialReprobadas > 0 ? '#c62828' : '#333'};border-radius:8px;">
            <div style="font-size:22px;font-weight:800;color:${parcialReprobadas > 0 ? '#c62828' : '#2e7d32'};">${parcialReprobadas}</div>
            <div style="font-size:9px;color:#666;">Reprobadas</div>
          </div>
          <div style="text-align:center;padding:8px 18px;border:2px solid #333;border-radius:8px;">
            <div style="font-size:22px;font-weight:800;color:#333;">${parcialFaltasTotal}</div>
            <div style="font-size:9px;color:#666;">Faltas Total</div>
          </div>
          <div style="text-align:center;padding:8px 18px;border:2px solid ${nivelRiesgo.border};border-radius:8px;background:${nivelRiesgo.bg};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
            <div style="font-size:16px;font-weight:800;color:${nivelRiesgo.color};">${nivelRiesgo.text}</div>
            <div style="font-size:9px;color:#666;">Nivel de Riesgo</div>
          </div>
        </div>
        ` : ''}

        <table class="boleta-grades" style="width:100%;border-collapse:collapse;border:1px solid #333;font-size:${isTodos ? '9' : '10'}px;">
          <thead style="background:#e0e0e0;">
            ${tableHeader}
          </thead>
          <tbody>
            ${tableRows}
            ${promedioRow}
          </tbody>
        </table>

        ${metaText}
        ${firmasPadres}

        <!-- Bandin -->
        <div style="text-align:center;margin-top:10px;">
          <img src="/img/bandin-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
        </div>
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
    tr[style*="D9D9D9"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td[style*="D9D9D9"] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @media print {
      .boleta-card[style*="page-break-after"] { page-break-after: always; }
    }
  </style>
</head>
<body>
  ${[...results.children].filter(el => !el.classList.contains('no-print')).map(el => el.outerHTML).join('')}
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
      targetStudents = students.filter(s => s.groupId === groupId || s.grupo === groupId).sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
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
      else if (action === 'gen-reprobados') {
        const sel = document.getElementById('bol-estatus');
        if (sel) sel.value = 'reprobados';
        generate();
      }
      else if (action === 'gen-aprobados') {
        const sel = document.getElementById('bol-estatus');
        if (sel) sel.value = 'aprobados';
        generate();
      }
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
