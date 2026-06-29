/**
 * BOLETAS MODULE — Sistema Escolar EPO 67
 *
 * Genera boletas de calificaciones con formato oficial:
 * - Encabezado del Estado de México
 * - 2 modos: Parcial individual (Evaluación Continua, Transversal, Examen Parcial,
 *            Suma, Faltas, Calificación) o Todos los parciales (P1, P2, P3, FINAL)
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
        ${UI.pageHeader('Preboletas de Calificaciones', 'Genera preboletas individuales o por grupo con formato oficial (no oficiales hasta cierre)')}

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
                <option value="todos">Acumulado</option>
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
            <div class="form-group">
              <label for="bol-fecha">Fecha de boleta</label>
              <input type="date" id="bol-fecha" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div class="form-group" style="display:flex;align-items:flex-end;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;margin-bottom:8px;" title="Oculta las columnas de Evaluación Continua, Transversal, Examen Parcial y Punto Extra. Solo muestra materia, faltas y calificación final.">
                <input type="checkbox" id="bol-sin-desglose" style="width:16px;height:16px;">
                Sin desglose (solo calificaci&oacute;n y faltas)
              </label>
            </div>
          </div>
          <div class="filter-bar-actions" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <button class="btn btn-primary" data-action="generate">Generar Boleta</button>
            <span style="border-left:1px solid #ddd;height:24px;margin:0 4px;"></span>
            <button class="btn btn-outline" data-action="print">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir
            </button>
            <button class="btn btn-outline" data-action="export-excel">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</span>Excel
            </button>
            <span style="border-left:1px solid #ddd;height:24px;margin:0 4px;"></span>
            <button class="btn btn-success" data-action="mass-download" style="font-weight:600;">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">file_download</span>Descarga Masiva PDF
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
    Utils.restrictTurnoGradoOptions(groups, 'bol-turno', 'bol-grado');
  }

  async function loadData() {
    try {
      // FORCE refresh: garantiza datos frescos del servidor (no cache local).
      // Previene bugs de "no se puede generar" causados por cache corrupto
      // que tiene un alumno o assignment desactualizado para algun grupo.
      const [g, s, sub, asgn, oriGroups] = await Promise.all([
        Store.getGroups(true), Store.getStudents(true), Store.getSubjects(true), Store.getAssignments(true),
        Store.getOrientadorGroups()
      ]);
      orientadorGroupIds = oriGroups; // null for admin, array for orientador
      groups = oriGroups ? g.filter(gr => oriGroups.includes(gr.id)) : g;
      // Activos = estatus 'ACTIVO' OR vacio (legacy). Antes solo === 'ACTIVO'
      // excluia alumnos cuyo doc tenia estatus vacio (en bajas pendientes/migracion).
      students = s.filter(st => {
        const e = (st.estatus || '').toString().toUpperCase().trim();
        return e === '' || e === 'ACTIVO';
      });
      subjects = sub;
      assignments = asgn;
      console.log('[BOLETAS] loadData OK: students=' + students.length + ' groups=' + groups.length + ' subjects=' + subjects.length + ' assignments=' + assignments.length);
    } catch (e) {
      console.error('Error cargando datos para boletas:', e);
      Toast.show('Error al cargar datos: ' + e.message, 'error');
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

    // ── DIAG TEMPORAL (v7.75) ──
    console.log('[BOLETAS] onGrupoChange groupId=' + groupId + ' filtered=' + filtered.length);
    const badStudents = filtered.filter(s => !s.id || !s.nombreCompleto);
    if (badStudents.length > 0) console.warn('[BOLETAS] Alumnos sin id/nombre:', badStudents);

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

    // ── DIAG TEMPORAL (v7.75) — quitar despues de encontrar el bug 1-2 TM ──
    console.log('[BOLETAS] generate() turno=' + turno + ' grado=' + grado + ' groupId=' + groupId + ' parcial=' + parcialMode + ' alumno=' + alumnoId);
    console.log('[BOLETAS] students cargados=' + students.length + ' groups=' + groups.length + ' subjects=' + subjects.length + ' assignments=' + assignments.length);

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
      const groupSubjects = K.sortSubjectsByGrado(subjects.filter(s => subjectIds.includes(s.id)), grado);

      if (groupSubjects.length === 0) {
        resultsDiv.innerHTML = UI.emptyState('menu_book', 'No se encontraron materias asignadas para este grupo.');
        return;
      }

      // Get students del grupo completo (activos), siempre ordenado alfabético.
      // Este orden es la fuente de verdad para el "Numero de Lista" (NL) dinamico.
      const fullGroupActive = students
        .filter(s => (s.groupId === groupId || s.grupo === groupId))
        .filter(s => {
          const e = (s.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      const nlByStudentId = {};
      fullGroupActive.forEach((s, i) => {
        if (s && s.id) nlByStudentId[s.id] = i + 1;
      });
      console.log('[BOLETAS] fullGroupActive=' + fullGroupActive.length + ' para groupId=' + groupId);

      if (fullGroupActive.length === 0) {
        resultsDiv.innerHTML = UI.emptyState('person_off',
          'No se encontraron alumnos activos para el grupo ' + groupId + '. ' +
          'Posibles causas: cache desactualizado o todos los alumnos fueron dados de baja. ' +
          'Intenta refrescar la página con Cmd+Shift+R.');
        return;
      }

      let targetStudents;
      if (alumnoId === 'todos') {
        targetStudents = fullGroupActive;
      } else {
        const found = students.find(s => s.id === alumnoId);
        targetStudents = found ? [found] : [];
      }

      if (targetStudents.length === 0) {
        resultsDiv.innerHTML = UI.emptyState('person_off', 'No se encontraron alumnos.');
        return;
      }

      // Fetch grades for this group — usa SEALED si hay snapshots oficiales (v8.26).
      // Esto garantiza que la boleta refleja la lista impresa firmada por el maestro,
      // no la edición posterior (bug TR=0, etc.).
      console.log('[BOLETAS] Cargando grades SELLADAS para groupId=' + groupId);
      const groupGrades = await Store.getSealedGradesByGroup(groupId, { force: true });
      const fromSnap = (groupGrades || []).filter(function(g){return g.__fromSnapshot;}).length;
      console.log('[BOLETAS] grades cargados: ' + (groupGrades?.length || 0) + ' (' + fromSnap + ' del snapshot)');
      const gradesMap = {};
      for (const g of (groupGrades || [])) {
        if (!g || !g.studentId || !g.subjectId || !g.partial) continue; // defensivo
        if (!gradesMap[g.studentId]) gradesMap[g.studentId] = {};
        if (!gradesMap[g.studentId][g.subjectId]) gradesMap[g.studentId][g.subjectId] = {};
        if (!gradesMap[g.studentId][g.subjectId][g.partial]) gradesMap[g.studentId][g.subjectId][g.partial] = g;
      }

      // Cargar teacherHours del grupo (para calcular % faltas > 20% = EXTRA_FALTAS)
      // Cada subject tiene 3 docs: {groupId}_{subjectId}_{P1|P2|P3}.
      // Una sola query por groupId trae todo lo del grupo (~33 docs para 11 materias).
      const hoursMap = await _loadHoursMap(groupId);

      // Group info
      const groupInfo = groups.find(g => g.id === groupId);
      const groupName = groupInfo ? (groupInfo.nombre || groupId) : groupId;
      const schoolConfig = App.schoolConfig || {};
      const cicloEscolar = schoolConfig.cicloEscolar || '2025-2026';
      const orientador = K.getOrientador(turno, groupName);


      // Fecha seleccionada
      const fechaInput = document.getElementById('bol-fecha')?.value;
      const fechaObj = fechaInput ? new Date(fechaInput + 'T12:00:00') : new Date();
      const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
      const fechaTexto = `Cuautitl\u00e1n Izcalli, M\u00e9x. A ${fechaObj.getDate()} de ${meses[fechaObj.getMonth()]} de ${fechaObj.getFullYear()}.`;

      const sinDesglose = document.getElementById('bol-sin-desglose')?.checked || false;
      const meta = {
        cicloEscolar, groupName, turno, grado, parcialMode, orientador, fechaTexto, sinDesglose,
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
        const nlNumero = nlByStudentId[student.id] || (idx + 1);
        html += _buildBoleta(student, groupSubjects, gradesMap[student.id] || {}, meta, idx === targetStudents.length - 1, nlNumero, hoursMap);
      });

      resultsDiv.innerHTML = html;
      console.log('[BOLETAS] OK render completado. Targets=' + targetStudents.length + ' subjects=' + groupSubjects.length);
    } catch (e) {
      console.error('[BOLETAS] Error generando boletas:', e);
      console.error('[BOLETAS] Stack:', e.stack);
      Toast.show('Error: ' + (e.message || e), 'error');
      resultsDiv.innerHTML = UI.errorState('Error al generar boletas: ' + (e.message || String(e)) + '<br><br><pre style="text-align:left;font-size:11px;background:#f5f5f5;padding:8px;overflow:auto;">' + (e.stack || '').replace(/</g, '&lt;') + '</pre>');
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cargar teacherHours del grupo en un mapa { subjectId: { P1, P2, P3 } }
  // Una query única `where('groupId','==',groupId)` trae todo. Si falla,
  // retorna {} y el cálculo de %faltas seguirá funcionando (solo no marcará
  // EXTRA_FALTAS porque horasTotal=0 → pctInasistencia=0).
  // ─────────────────────────────────────────────────────────────
  async function _loadHoursMap(groupId) {
    try {
      const snap = await firebase.firestore()
        .collection('teacherHours')
        .where('groupId', '==', groupId)
        .get();
      const map = {};
      snap.forEach(doc => {
        const data = doc.data() || {};
        const sid = data.subjectId;
        const pid = data.partial;
        if (!sid || !pid) return;
        if (!map[sid]) map[sid] = {};
        map[sid][pid] = data;
      });
      console.log('[BOLETAS] teacherHours cargados: ' + snap.size + ' docs (' + Object.keys(map).length + ' materias)');
      return map;
    } catch (e) {
      console.warn('[BOLETAS] No se pudo cargar teacherHours:', e.message);
      return {};
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Build single boleta — formato oficial
  // ─────────────────────────────────────────────────────────────

  function _buildBoleta(student, subjectsList, studentGrades, meta, isLast, nlNumero, hoursMap) {
    hoursMap = hoursMap || {};
    // ─── PRE-CÁLCULO: estatus de extraordinario por materia ───
    // Usa App.calcStatusExtraordinario (regla EPO 67: >20% faltas o reprobado).
    // El estatus por materia se inyecta en la columna "Observaciones" del formato
    // Acumulado para que cada materia muestre formalmente "Extraordinario por
    // faltas / por calificación / por ambas" cuando aplique.
    const _isTraslado = !!student.bajaPendiente;
    const subjectStatusMap = {};
    if (!_isTraslado && typeof App?.calcStatusExtraordinario === 'function') {
      subjectsList.forEach(subj => {
        const sg = studentGrades[subj.id] || {};
        const grades3 = [sg.P1 || null, sg.P2 || null, sg.P3 || null];
        const hoursByPart = (hoursMap && hoursMap[subj.id]) || {};
        try {
          subjectStatusMap[subj.id] = App.calcStatusExtraordinario({ grades3, hoursByPart });
        } catch (e) { /* ignorar errores de cálculo individual */ }
      });
    }
    return _buildBoletaInner(student, subjectsList, studentGrades, meta, isLast, nlNumero, { subjectStatusMap });
  }

  // Renderizador real — recibe el subjectStatusMap pre-computado arriba.
  function _buildBoletaInner(student, subjectsList, studentGrades, meta, isLast, nlNumero, statusInfo) {
    const parcialMode = meta.parcialMode;
    const isTodos = parcialMode === 'todos';
    const rubros = K.getRubros(meta.turno);
    const isTraslado = !!student.bajaPendiente;
    // Celdas sin datos = VACÍAS (no "0"). El "0" daba la impresión de que el
    // alumno tenía cero faltas o cero calificación cuando en realidad ese
    // parcial aún no se había capturado. Modo "todos los parciales" suele
    // mostrar P3 vacío mientras P3 todavía no se completa — debe verse así,
    // no como un cero engañoso.
    const blankFill = '';
    const gradoNombre = K.GRADO_NOMBRE[meta.grado] || meta.grado;
    // Semestre corriente según la fecha actual. Helper en App.getCurrentSemester
    // detecta si estamos en 1er o 2do semestre del ciclo (ago-ene vs feb-jul)
    // y devuelve el correcto. Antes estaba hardcoded a los IMPARES (PRIMERO/
    // TERCERO/QUINTO) lo cual estaba mal para impresiones de feb-jul.
    const semestre = App.getCurrentSemester(meta.grado).texto;
    const headerLines = K.BOLETA_HEADER.map(line =>
      `<div style="font-size:10px;font-weight:600;letter-spacing:0.3px;line-height:1.3;">${Utils.sanitize(line)}</div>`
    ).join('');
    const parcialLabel = isTodos ? 'ACUMULADO' :
      (K.PARCIALES.find(p => p.id === parcialMode)?.nombre || parcialMode).toUpperCase();

    // ─── Decide format: new (all parcials with faltas+cal+obs) or legacy (single parcial rubros) ───
    let tableHeader, tableRows, promedioRow;
    let grandTotal = 0, grandCount = 0;
    let parcialReprobadas = 0, parcialFaltasTotal = 0;
    let promedio = '-';
    let nivelRiesgo = { text: 'SIN RIESGO', color: '#555', bg: '#f0f0f0', border: '#666' };

    if (isTodos && meta.sinDesglose) {
      // ═══ TODOS + SIN DESGLOSE: solo 3 calificaciones + faltas total + promedio ═══
      tableHeader = `<tr>
          <th style="width:30px;text-align:center;">N\u00b0</th>
          <th>UNIDAD DE APRENDIZAJE CURRICULAR</th>
          <th style="text-align:center;width:55px;">CAL. 1\u00aa</th>
          <th style="text-align:center;width:55px;">CAL. 2\u00aa</th>
          <th style="text-align:center;width:55px;">CAL. 3\u00aa</th>
          <th style="text-align:center;width:70px;">FALTAS TOT.</th>
          <th style="text-align:center;width:60px;">PROMEDIO</th>
        </tr>`;
      const promediosCol = { sum: 0, cnt: 0 };
      tableRows = subjectsList.map((subj, idx) => {
        const sg = isTraslado ? {} : (studentGrades[subj.id] || {});
        let faltasTotal = 0, promSum = 0, promCnt = 0, hasFail = false;
        const calCells = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          const cal = gd ? (gd.cal !== undefined ? gd.cal : (gd.value !== undefined ? gd.value : null)) : null;
          if (gd && gd.faltas !== undefined && !isNaN(gd.faltas)) faltasTotal += Number(gd.faltas);
          if (cal !== null && cal !== '' && cal !== undefined) {
            promSum += Number(cal); promCnt++;
            const isFail = Number(cal) < K.THRESHOLDS.PASS_GRADE;
            if (isFail) hasFail = true;
            return `<td style="text-align:center;font-weight:700;font-size:11px;${isFail ? 'background:#ddd;' : ''}">${cal}</td>`;
          }
          return `<td style="text-align:center;font-size:11px;">${blankFill}</td>`;
        }).join('');
        const promMat = promCnt > 0 ? (promSum / promCnt).toFixed(1) : blankFill;
        if (promCnt > 0) { promediosCol.sum += Number(promMat); promediosCol.cnt++; }
        const promFail = promCnt > 0 && parseFloat(promMat) < K.THRESHOLDS.PASS_GRADE;
        const bg = hasFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f5f5f5;' : '');
        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${calCells}
          <td style="text-align:center;font-size:10px;">${faltasTotal || blankFill}</td>
          <td style="text-align:center;font-weight:700;font-size:11px;${promFail ? 'background:#ddd;' : ''}">${promMat}</td>
        </tr>`;
      }).join('');
      // Sin fila resumen de promedio general: cada materia ya muestra su
      // promedio individual en la columna "PROMEDIO" del renglón. Decisión
      // Olivia (mayo 2026): no mostrar promedio acumulado para evitar
      // confusión con el del concentrado.
      promedioRow = '';
      // Resumen de riesgo
      subjectsList.forEach(subj => {
        const sg = studentGrades[subj.id] || {};
        let mateReprobada = false;
        for (const p of K.PARCIALES) {
          const gd = sg[p.id] || {};
          const cal = gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null);
          if (cal !== null && cal < K.THRESHOLDS.PASS_GRADE) { mateReprobada = true; }
          if (gd.faltas !== undefined && !isNaN(gd.faltas)) parcialFaltasTotal += Number(gd.faltas);
        }
        if (mateReprobada) parcialReprobadas++;
      });
      nivelRiesgo = parcialReprobadas >= 3 ? { text: 'ALTO RIESGO', color: '#000', bg: '#d6d6d6', border: '#000' }
        : parcialReprobadas >= 1 ? { text: 'EN RIESGO', color: '#222', bg: '#e8e8e8', border: '#333' }
        : { text: 'SIN RIESGO', color: '#555', bg: '#f0f0f0', border: '#666' };

    } else if (isTodos) {
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
        const sg = isTraslado ? {} : (studentGrades[subj.id] || {});
        const faltasCells = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          // Regla SEP: si NO hay calificación capturada para el parcial, la celda
          // queda vacía (el parcial todavía no existe). Si SÍ hay calificación
          // pero el maestro no llenó faltas, se interpreta como 0 faltas
          // (porque el parcial está cerrado y el dato faltante = ausencia capturada).
          const tieneCal = gd && (gd.cal !== undefined || gd.value !== undefined);
          let f;
          if (!tieneCal) {
            f = '';  // parcial no capturado → vacío
          } else if (gd.faltas !== undefined && gd.faltas !== null) {
            f = gd.faltas;  // faltas registradas
          } else {
            f = 0;  // parcial capturado sin faltas explícitas → 0
          }
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
          return `<td style="${style}">${blankFill}</td>`;
        }).join('');
        const calValues = K.PARCIALES.map(p => {
          const gd = sg[p.id];
          return gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
        });
        // \u2500\u2500\u2500 OBSERVACI\u00d3N OFICIAL POR MATERIA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        // Regla EPO 67 (Gaceta SEP): >20% de inasistencias del total de horas
        // impartidas \u2192 pierde derecho a calificaci\u00f3n ordinaria. Para la pre-boleta
        // marcamos EXTRA POR FALTAS apenas se cruza el 20%, AUN si falta P3 por
        // capturar \u2014 porque con P1+P2 ya superando 20%, pr\u00e1cticamente no hay
        // vuelta atr\u00e1s. (calcStatusExtraordinario espera los 3 parciales para
        // marcar definitivo; eso aplica a indicadores globales, no a la
        // preboleta que se entrega al padre durante el ciclo.)
        const _st = (statusInfo && statusInfo.subjectStatusMap) ? statusInfo.subjectStatusMap[subj.id] : null;
        const pct = _st && typeof _st.pctInasistencia === 'number' ? _st.pctInasistencia : 0;
        const faltasTot = _st && typeof _st.faltasTotal === 'number' ? _st.faltasTotal : 0;
        const horasTot  = _st && typeof _st.horasTotal === 'number' ? _st.horasTotal : 0;
        const failCount = calValues.filter(v => v !== null && v < K.THRESHOLDS.PASS_GRADE).length;
        const validCals = calValues.filter(v => v !== null);
        const promedioRow = validCals.length ? (validCals.reduce((s,c)=>s+c,0) / validCals.length) : null;
        const tiene3 = validCals.length === 3;
        const PASS = K.THRESHOLDS.PASS_GRADE;

        // v8.58: 3 REGLAS SEP INDEPENDIENTES (Gaceta EPO 67).
        // Las 3 se eval\u00faan por separado. UNA sola que se cumpla manda a extraordinario.
        // No se redondean cals < 6 (5.99 sigue siendo reprobatorio).
        const reglaPromBajo = (tiene3 && promedioRow !== null && promedioRow < PASS);
        const reglaDosReprob = (failCount >= 2);
        const reglaInasist = (horasTot > 0 && pct > 20);
        const extraPorCal = reglaPromBajo || reglaDosReprob;
        const extraPorFaltas = reglaInasist;

        let observation = '';
        const obsColor = '#333';
        const obsWeight = 'normal';
        const pctStr = pct.toFixed(1) + '%';

        // Lista TODAS las reglas que se activaron (puede ser una, dos o las tres)
        if (extraPorCal || extraPorFaltas) {
          const reglas = [];
          if (reglaPromBajo) {
            const promTrunc = Math.floor(promedioRow * 100) / 100;
            reglas.push(`promedio ${promTrunc.toFixed(2)}<${PASS}`);
          }
          if (reglaDosReprob) reglas.push(`${failCount} parciales reprob.`);
          if (reglaInasist) reglas.push(`${pctStr} inasist.`);
          observation = 'Extraordinario: ' + reglas.join(' + ');
        } else if (failCount === 1) {
          observation = 'Riesgo de extraordinario';
        } else if (horasTot > 0 && pct > 15) {
          observation = `Atenci\u00f3n: inasistencias en el l\u00edmite (${pctStr})`;
        }
        const hasFail = calValues.some(v => v !== null && v < K.THRESHOLDS.PASS_GRADE);
        const bg = hasFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f9f9f9;' : '');
        return `<tr style="${bg}">
          <td style="font-size:9px;padding:2px 4px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${faltasCells}${calCells}
          <td style="font-size:9px;color:${obsColor};font-weight:${obsWeight};padding:2px 4px;">${observation}</td>
        </tr>`;
      }).join('');

      const promedioCells = K.PARCIALES.map(p => {
        const s = promedios[p.id];
        const avg = s.cnt > 0 ? (s.sum / s.cnt).toFixed(1) : blankFill;
        return `<td style="text-align:center;font-weight:700;">${avg}</td>`;
      }).join('');
      // ─── PROMEDIO POR PARCIAL (única fila resumen) ───
      // Antes había un "PROMEDIO ACUMULADO" o "PROMEDIO (P2) AL FECHA" debajo,
      // pero generaba confusión con el concentrado del parcial. Decisión Olivia
      // (mayo 2026): mostrar SOLO la fila por parcial. El que necesite el
      // promedio del último parcial lo lee directamente de la columna correspondiente.
      promedioRow = `<tr style="border-top:1px solid #999;background:#f5f5f5;">
        <td colspan="4" style="text-align:right;font-weight:700;padding:4px 8px;">PROMEDIO</td>
        ${promedioCells}<td></td>
      </tr>`;

    } else if (meta.sinDesglose) {
      // ═══ SIMPLIFIED FORMAT: parcial individual sin rubros (solo faltas + cal) ═══
      tableHeader = `<tr>
          <th style="width:30px;text-align:center;">N\u00b0</th>
          <th>UNIDAD DE APRENDIZAJE CURRICULAR</th>
          <th style="text-align:center;width:70px;">FALTAS</th>
          <th style="text-align:center;width:70px;">CALIFICACI\u00d3N</th>
        </tr>`;
      tableRows = subjectsList.map((subj, idx) => {
        const sg = isTraslado ? {} : (studentGrades[subj.id] || {});
        const gradeDoc = sg[parcialMode] || {};
        // Mismo criterio: si hay calificación capturada y no hay faltas, asumir 0
        // (parcial capturado pero sin faltas registradas = 0 faltas). Si NO hay
        // calificación, dejar vacío (parcial sin capturar).
        const tieneCal = gradeDoc.cal !== undefined || gradeDoc.value !== undefined;
        const faltas = !tieneCal ? blankFill : (gradeDoc.faltas !== undefined && gradeDoc.faltas !== null ? gradeDoc.faltas : 0);
        const cal = gradeDoc.cal !== undefined ? gradeDoc.cal : (gradeDoc.value !== undefined ? gradeDoc.value : '');
        if (cal !== '' && cal !== null) { grandTotal += Number(cal); grandCount++; }
        const isFail = cal !== '' && cal !== null && Number(cal) < K.THRESHOLDS.PASS_GRADE;
        const bg = isFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f5f5f5;' : '');
        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          <td style="text-align:center;font-size:11px;">${faltas}</td>
          <td style="text-align:center;font-weight:700;font-size:12px;${isFail ? 'background:#ddd;' : ''}">${cal === '' ? blankFill : cal}</td>
        </tr>`;
      }).join('');
      promedio = grandCount > 0 ? (grandTotal / grandCount).toFixed(1) : blankFill;
      const promedioFail = promedio !== '-' && parseFloat(promedio) < K.THRESHOLDS.PASS_GRADE;
      promedioRow = `<tr style="border-top:2px solid #333;">
        <td colspan="3" style="text-align:right;font-weight:700;font-size:11px;padding:6px 8px;">PROMEDIO GENERAL:</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${promedioFail ? 'background:#ddd;' : ''}">${promedio}</td>
      </tr>`;

      // Resumen de riesgo (mismo calculo que formato con rubros)
      subjectsList.forEach(subj => {
        const sg = studentGrades[subj.id] || {};
        const gd = sg[parcialMode] || {};
        const cal = gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null);
        if (cal !== null && cal < K.THRESHOLDS.PASS_GRADE) parcialReprobadas++;
        if (gd.faltas !== undefined && !isNaN(gd.faltas)) parcialFaltasTotal += Number(gd.faltas);
      });
      nivelRiesgo = parcialReprobadas >= 3 ? { text: 'ALTO RIESGO', color: '#000', bg: '#d6d6d6', border: '#000' }
        : parcialReprobadas >= 1 ? { text: 'EN RIESGO', color: '#222', bg: '#e8e8e8', border: '#333' }
        : { text: 'SIN RIESGO', color: '#555', bg: '#f0f0f0', border: '#666' };

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
        const sg = isTraslado ? {} : (studentGrades[subj.id] || {});
        const gradeDoc = sg[parcialMode] || {};
        const rubroCells = rubros.map(r => {
          const v = gradeDoc[r.key];
          return `<td style="text-align:center;font-size:10px;">${v !== undefined && v !== null && v !== '' ? v : blankFill}</td>`;
        }).join('');
        const suma = gradeDoc.suma !== undefined ? Number(gradeDoc.suma).toFixed(1) : blankFill;
        const faltas = gradeDoc.faltas !== undefined ? gradeDoc.faltas : blankFill;
        const cal = gradeDoc.cal !== undefined ? gradeDoc.cal : (gradeDoc.value !== undefined ? gradeDoc.value : '');
        if (cal !== '' && cal !== null) { grandTotal += Number(cal); grandCount++; }
        const isFail = cal !== '' && Number(cal) < K.THRESHOLDS.PASS_GRADE;
        const bg = isFail ? 'background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : (idx % 2 === 1 ? 'background:#f5f5f5;' : '');
        return `<tr style="${bg}">
          <td style="text-align:center;font-size:10px;">${idx + 1}</td>
          <td style="font-size:10px;">${Utils.sanitize(K.getUACNombre(subj.nombre || subj.id))}</td>
          ${rubroCells}
          <td style="text-align:center;">${suma}</td>
          <td style="text-align:center;">${faltas}</td>
          <td style="text-align:center;font-weight:700;${isFail ? 'background:#ddd;' : ''}">${cal === '' ? blankFill : cal}</td>
        </tr>`;
      }).join('');
      promedio = grandCount > 0 ? (grandTotal / grandCount).toFixed(1) : blankFill;
      const promedioFail = promedio !== '-' && parseFloat(promedio) < K.THRESHOLDS.PASS_GRADE;
      const colSpan = rubros.length + 4;
      promedioRow = `<tr style="border-top:2px solid #333;">
        <td colspan="${colSpan - 1}" style="text-align:right;font-weight:700;font-size:11px;padding:6px 8px;">PROMEDIO GENERAL:</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${promedioFail ? 'background:#ddd;' : ''}">${promedio}</td>
      </tr>`;

      // Calcular resumen para parcial individual — overwrite outer variables
      subjectsList.forEach(subj => {
        const sg = studentGrades[subj.id] || {};
        const gd = sg[parcialMode] || {};
        const cal = gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null);
        if (cal !== null && cal < K.THRESHOLDS.PASS_GRADE) parcialReprobadas++;
        if (gd.faltas !== undefined && !isNaN(gd.faltas)) parcialFaltasTotal += Number(gd.faltas);
      });

      nivelRiesgo = parcialReprobadas >= 3 ? { text: 'ALTO RIESGO', color: '#000', bg: '#d6d6d6', border: '#000' }
        : parcialReprobadas >= 1 ? { text: 'EN RIESGO', color: '#222', bg: '#e8e8e8', border: '#333' }
        : { text: 'SIN RIESGO', color: '#555', bg: '#f0f0f0', border: '#666' };
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
        <div>Del grupo <strong>${Utils.sanitize(meta.groupName)}</strong></div>
        <div style="margin-top:2px;">Estoy en conocimiento y de acuerdo con las calificaciones asentadas en la pre- boleta.</div>
        <div style="margin-top:8px;">NOMBRE DE LA MADRE, PADRE DE FAMILIA: ___________________________________________________________</div>
        <div style="margin-top:6px;">FIRMA: _________________________________ NUMERO DE CONTACTO: ___________________________________</div>
        <div style="margin-top:8px;text-align:right;font-size:9px;">${meta.fechaTexto || 'Cuautitl\u00e1n Izcalli, M\u00e9x.'}</div>
      </div>` : `
      <table style="width:100%;margin-top:30px;border-collapse:collapse;">
        <tr>
          <td style="width:23%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
          <td style="width:3%;">&nbsp;</td>
          <td style="width:23%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
          <td style="width:3%;">&nbsp;</td>
          <td style="width:23%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
          <td style="width:3%;">&nbsp;</td>
          <td style="width:22%;text-align:center;padding-top:30px;border-bottom:1px solid #333;">&nbsp;</td>
        </tr>
        <tr>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">ORIENTADOR(A)</td>
          <td>&nbsp;</td>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">VO. BO. SUBDIRECCIÓN</td>
          <td>&nbsp;</td>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">DIRECCIÓN ESCOLAR</td>
          <td>&nbsp;</td>
          <td style="text-align:center;font-size:9px;padding-top:4px;font-weight:600;">FIRMA DE ENTERADO</td>
        </tr>
        <tr>
          <td style="text-align:center;font-size:9px;color:#555;">${Utils.sanitize(meta.orientador || '')}</td>
          <td></td>
          <td style="text-align:center;font-size:9px;color:#555;">${Utils.sanitize(App.staffName('subdirector'))}</td>
          <td></td>
          <td style="text-align:center;font-size:9px;color:#555;">${Utils.sanitize(App.staffName('director'))}</td>
          <td></td>
          <td></td>
        </tr>
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
            <td><strong>N.L.</strong> ${Utils.sanitize(String(nlNumero || ''))}</td>
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
          <div style="text-align:center;padding:8px 18px;border:2px solid #333;border-radius:8px;">
            <div style="font-size:22px;font-weight:800;color:#000;">${parcialReprobadas}</div>
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
    if (!printWindow) {
      Toast.show('El navegador BLOQUEÓ la ventana de impresión. Haz clic en el ícono de "pop-up bloqueado" en la barra de direcciones y permite pop-ups para este sitio, luego intenta de nuevo.', 'error');
      return;
    }
    const _printGroupInfo = groups.find(g => g.id === document.getElementById('bol-grupo')?.value);
    const _printOrient = _printGroupInfo ? K.getOrientador(_printGroupInfo.turno, _printGroupInfo.nombre) : '';
    const _printTitle = Utils.fileName({
      tipo: 'BOLETAS',
      turno: _printGroupInfo?.turno,
      grupo: _printGroupInfo?.nombre,
      maestro: _printOrient,
      parcial: document.getElementById('bol-parcial')?.value || 'TODOS'
    });
    printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${Utils.sanitize(_printTitle)}</title>
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
    const groupSubjects = K.sortSubjectsByGrado(subjects.filter(s => subjectIds.includes(s.id)), grado);

    let targetStudents;
    if (alumnoId === 'todos') {
      targetStudents = students.filter(s => s.groupId === groupId || s.grupo === groupId).sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
    } else {
      const found = students.find(s => s.id === alumnoId);
      targetStudents = found ? [found] : [];
    }

    // v8.26: usa snapshot certificado si existe (sellado al imprimir lista oficial)
    Store.getSealedGradesByGroup(groupId, { force: true }).then(groupGrades => {
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
      const orient = groupInfo ? K.getOrientador(groupInfo.turno, groupInfo.nombre) : '';
      const filename = Utils.fileName({
        tipo: 'BOLETAS',
        turno: groupInfo?.turno,
        grupo: groupInfo?.nombre || groupId,
        maestro: orient,
        parcial: parcialMode === 'todos' ? 'TODOS' : parcialMode,
        ext: 'xlsx'
      });
      Utils.exportToExcel(data, filename);
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
      else if (action === 'mass-download') massDownloadPDF();
    });

    document.getElementById('bol-turno')?.addEventListener('change', onTurnoChange);
    document.getElementById('bol-grado')?.addEventListener('change', onGradoChange);
    document.getElementById('bol-grupo')?.addEventListener('change', onGrupoChange);
  }

  // ─────────────────────────────────────────────────────────────
  // Mass Download PDF — one PDF per group
  // ─────────────────────────────────────────────────────────────

  let _massDownloading = false;
  async function massDownloadPDF() {
    if (_massDownloading) return;
    _massDownloading = true;
    const turno = document.getElementById('bol-turno')?.value;
    const grado = document.getElementById('bol-grado')?.value;
    const parcialMode = document.getElementById('bol-parcial')?.value || 'todos';
    const estatusFiltro = document.getElementById('bol-estatus')?.value || 'todos';

    if (!turno) { Toast.show('Selecciona un turno', 'warning'); _massDownloading = false; return; }

    const fechaInput = document.getElementById('bol-fecha')?.value;
    const fechaObj = fechaInput ? new Date(fechaInput + 'T12:00:00') : new Date();
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const fechaTexto = `Cuautitl\u00e1n Izcalli, M\u00e9x. A ${fechaObj.getDate()} de ${meses[fechaObj.getMonth()]} de ${fechaObj.getFullYear()}.`;

    // Get groups \u2014 la Descarga Masiva genera TODOS los grupos a cargo del usuario:
    //   - Orientador: `groups` YA viene filtrado a SUS grupos (loadData l\u00ednea 115),
    //     as\u00ed que genera todos sus grupos del turno (NO filtra por grado/grupo,
    //     para incluir todos los grupos a su cargo).
    //   - Admin: genera todos los grupos del turno + grado seleccionado.
    const esOrientador = Array.isArray(orientadorGroupIds);
    let turnoGroups = groups.filter(g => g.turno === turno);
    if (!esOrientador && grado) {
      turnoGroups = turnoGroups.filter(g => String(g.grado) === String(grado));
    }
    turnoGroups.sort((a, b) => (a.grado || 0) - (b.grado || 0) || (a.nombre || '').localeCompare(b.nombre || ''));
    console.log('[BOLETAS] massDownload: esOrientador=' + esOrientador + ' \u2192 generar\u00e1 ' + turnoGroups.length + ' grupo(s): ' + turnoGroups.map(g => g.nombre).join(', '));

    if (turnoGroups.length === 0) {
      Toast.show('No hay grupos para este turno', 'warning');
      _massDownloading = false;
      return;
    }

    // Build filename tag from filters
    const isReprob = estatusFiltro === 'reprobados';
    const isAprob = estatusFiltro === 'aprobados';
    const parcialMap = { P1: '1erParcial', P2: '2doParcial', P3: '3erParcial', todos: 'TodosParciales' };
    const parcialTag = parcialMap[parcialMode] || parcialMode;
    const estatusTag = isReprob ? '_REPROBADOS' : isAprob ? '_APROBADOS' : '';
    // Si es un solo grupo, el tag lleva el nombre del grupo (ej "_1-2"); si son
    // varios, lleva el grado (ej "_1Grado"). Asi el PDF se identifica claro.
    const gradoTag = turnoGroups.length === 1
      ? `_${turnoGroups[0].nombre}`
      : (grado ? `_${grado}Grado` : '');

    // ── FIX (v7.77): abrir UNA SOLA ventana con TODOS los grupos ──
    // Antes se abria window.open() por cada grupo dentro del loop. Los
    // navegadores BLOQUEAN pop-ups despues del primero, asi que solo se
    // generaba el PRIMER grupo (1-1) y los demas (1-2, 1-3) eran bloqueados
    // silenciosamente — de ahi el reporte "me genera siempre las de 1-1".
    // Ahora acumulamos el HTML de todos los grupos (cada grupo arranca en
    // pagina nueva) y abrimos UNA ventana. El usuario guarda 1 PDF con todo
    // o imprime el rango de paginas que necesite.
    //
    // CLAVE: abrir la ventana ANTES del await (mientras el gesto de click del
    // usuario sigue "vivo") para que el navegador no la trate como pop-up.
    Toast.show(`Generando preboletas de ${turnoGroups.length} grupo(s): ${turno}${gradoTag} ${parcialTag}${estatusTag}...`, 'info');

    const massWindow = window.open('', '_blank');
    if (!massWindow) {
      Toast.show('El navegador BLOQUEÓ la ventana. Haz clic en el ícono de "pop-up bloqueado" en la barra de direcciones, permite pop-ups para este sitio e intenta de nuevo.', 'error');
      _massDownloading = false;
      return;
    }
    massWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Generando preboletas…</title></head><body style="font-family:Arial,sans-serif;padding:40px;text-align:center;color:#333;"><h2>Generando preboletas…</h2><p>Por favor espera, no cierres esta ventana.</p></body></html>');

    let allBoletasHtml = '';
    let gruposGenerados = 0;
    const resumenGrupos = []; // { nombre, count } para la portada/índice

    try {
      for (const groupInfo of turnoGroups) {
        const groupId = groupInfo.id;
        const groupName = groupInfo.nombre || groupId;

        try {
          // Students del grupo (activos)
          const groupStudents = students.filter(s => {
            const e = (s.estatus || '').toString().toUpperCase().trim();
            return (s.groupId === groupId || s.grupo === groupId) && (e === '' || e === 'ACTIVO');
          }).sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

          if (groupStudents.length === 0) continue;

          // Subjects del grupo
          const groupAssignments = assignments.filter(a => a.groupId === groupId);
          const subjectIds = [...new Set(groupAssignments.map(a => a.subjectId))];
          const groupSubjects = K.sortSubjectsByGrado(subjects.filter(s => subjectIds.includes(s.id)), groupInfo.grado || grado);

          // v8.26: grades SELLADAS (prefiere snapshot certificado vs grades vivos)
          const groupGrades = await Store.getSealedGradesByGroup(groupId, { force: true });
          const gradesMap = {};
          for (const g of (groupGrades || [])) {
            if (!g || !g.studentId || !g.subjectId || !g.partial) continue;
            if (!gradesMap[g.studentId]) gradesMap[g.studentId] = {};
            if (!gradesMap[g.studentId][g.subjectId]) gradesMap[g.studentId][g.subjectId] = {};
            if (!gradesMap[g.studentId][g.subjectId][g.partial]) gradesMap[g.studentId][g.subjectId][g.partial] = g;
          }

          // teacherHours del grupo para el banner de EXTRA por faltas (>20% inasistencia)
          const hoursMap = await _loadHoursMap(groupId);

          const schoolConfig = App.schoolConfig || {};
          const cicloEscolar = schoolConfig.cicloEscolar || '2025-2026';
          const orientador = K.getOrientador(turno, groupName);
          const groupGrado = groupInfo.grado || grado;
          const meta = { cicloEscolar, groupName, turno, grado: groupGrado, parcialMode, orientador, fechaTexto };

          // Filtro por estatus academico
          let targetStudents = [...groupStudents];
          if (estatusFiltro !== 'todos') {
            const passGrade = K.THRESHOLDS?.PASS_GRADE || 6;
            targetStudents = targetStudents.filter(student => {
              const sg = gradesMap[student.id] || {};
              let hasReprobada = false;
              for (const subId of subjectIds) {
                if (parcialMode === 'todos') {
                  for (const p of K.PARCIALES) {
                    const gd = sg[subId]?.[p.id];
                    const cal = gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
                    if (cal !== null && cal < passGrade) { hasReprobada = true; break; }
                  }
                } else {
                  const gd = sg[subId]?.[parcialMode];
                  const cal = gd ? (gd.cal !== undefined ? Number(gd.cal) : (gd.value !== undefined ? Number(gd.value) : null)) : null;
                  if (cal !== null && cal < passGrade) { hasReprobada = true; break; }
                }
                if (hasReprobada) break;
              }
              return estatusFiltro === 'reprobados' ? hasReprobada : !hasReprobada;
            });
          }

          if (targetStudents.length === 0) continue;

          // NL: posicion alfabetica en el grupo completo de activos
          const nlByStudentId = {};
          groupStudents.forEach((s, i) => { if (s && s.id) nlByStudentId[s.id] = i + 1; });

          // Acumular boletas de este grupo (todas con salto de pagina entre ellas;
          // la ultima del grupo TAMBIEN con salto para separar del siguiente grupo)
          targetStudents.forEach((student, idx) => {
            const nlNumero = nlByStudentId[student.id] || (idx + 1);
            const esUltimaDelTurno = false; // siempre salto: cada boleta en su pagina
            allBoletasHtml += _buildBoleta(student, groupSubjects, gradesMap[student.id] || {}, meta, esUltimaDelTurno, nlNumero, hoursMap);
          });
          gruposGenerados++;
          resumenGrupos.push({ nombre: groupName, count: targetStudents.length });
          console.log('[BOLETAS] massDownload grupo ' + groupName + ': ' + targetStudents.length + ' boletas');

        } catch (e) {
          console.error('[BOLETAS] Error en grupo ' + groupName + ':', e);
        }
      }

      if (gruposGenerados === 0 || !allBoletasHtml) {
        massWindow.document.body.innerHTML = '<div style="font-family:Arial;padding:40px;text-align:center;"><h2>Sin datos</h2><p>No se encontraron alumnos para los filtros seleccionados.</p></div>';
        Toast.show('No se generaron preboletas (sin alumnos para esos filtros)', 'warning');
        _massDownloading = false;
        return;
      }

      const fullTitle = `PreBoletas_${turno}${gradoTag}_${parcialTag}${estatusTag}`;

      // Portada/índice (solo si hay >1 grupo) — para que el usuario confirme
      // de un vistazo que el documento contiene TODOS sus grupos.
      const totalBoletas = resumenGrupos.reduce((sum, r) => sum + r.count, 0);
      const portadaHtml = resumenGrupos.length > 1 ? `
        <div class="boleta-card" style="page-break-after:always;padding:40px 20px;">
          <div style="text-align:center;border:2px solid #333;border-radius:10px;padding:30px;">
            <h1 style="font-size:18px;margin-bottom:6px;">PRE BOLETAS — TURNO ${Utils.sanitize(turno)}</h1>
            <div style="font-size:11px;color:#555;margin-bottom:20px;">${parcialTag.replace(/([A-Z])/g, ' $1').trim()}${estatusTag ? ' · ' + estatusTag.replace('_', '') : ''} · ${Utils.sanitize(fechaTexto)}</div>
            <div style="font-size:13px;font-weight:700;margin-bottom:10px;">Este documento contiene ${resumenGrupos.length} grupos (${totalBoletas} preboletas):</div>
            <table style="margin:0 auto;border-collapse:collapse;font-size:13px;">
              <thead><tr style="background:#e0e0e0;"><th style="border:1px solid #333;padding:6px 16px;">GRUPO</th><th style="border:1px solid #333;padding:6px 16px;">ALUMNOS</th></tr></thead>
              <tbody>
                ${resumenGrupos.map(r => `<tr><td style="border:1px solid #333;padding:5px 16px;font-weight:600;">${Utils.sanitize(r.nombre)}</td><td style="border:1px solid #333;padding:5px 16px;text-align:center;">${r.count}</td></tr>`).join('')}
              </tbody>
            </table>
            <div style="font-size:10px;color:#888;margin-top:18px;">Cada grupo inicia en página nueva. Usa el rango de páginas del diálogo de impresión si solo necesitas uno.</div>
          </div>
        </div>` : '';

      const finalHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <title>${fullTitle}</title>
        <style>
          @page { size: letter portrait; margin: 10mm 12mm 8mm 12mm; }
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: Arial, sans-serif; color: #000; font-size: 10px; }
          .boleta-card { padding: 10px 0; }
          table { border-collapse: collapse; }
          th, td { padding: 3px 5px; border: 1px solid #333; }
          thead { background: #e0e0e0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          @media print { .boleta-card[style*="page-break-after"] { page-break-after: always; } }
        </style>
      </head><body>
        ${portadaHtml}
        ${allBoletasHtml}
        <script>
          document.title = '${fullTitle}';
          setTimeout(() => window.print(), 600);
        <\/script>
      </body></html>`;

      massWindow.document.open();
      massWindow.document.write(finalHtml);
      massWindow.document.close();

      Toast.show(`${gruposGenerados} grupo(s) generados en una sola ventana. Guarda como PDF o imprime el rango de páginas que necesites.`, 'success');
    } catch (e) {
      console.error('[BOLETAS] massDownloadPDF error global:', e);
      Toast.show('Error generando preboletas: ' + (e.message || e), 'error');
      try { massWindow.close(); } catch (_) {}
    } finally {
      _massDownloading = false;
    }
  }

  return { render };
})();

Router.modules['boletas'] = () => BoletasModule.render();
