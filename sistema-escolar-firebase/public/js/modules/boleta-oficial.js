/**
 * BOLETA OFICIAL DE CALIFICACIONES — EPO 67
 * Formato oficial de fin de semestre.
 * Calificacion = promedio de los 3 parciales por materia.
 * Replica exacta del formato institucional.
 */

const BoletaOficialModule = (function () {
  const CONTAINER = '#moduleContainer';

  // v9.33: formato de nombre del archivo pedido por Dirección:
  //   {TM|TV}_{grupo}_BOLETA_OFICIAL[_{PARCIAL}]
  // Ejemplo: TM_1-1_BOLETA_OFICIAL_ACUM, TV_3-2_BOLETA_OFICIAL_P3
  function _buildFileName(turno, grupo, parcialMode) {
    const t = (turno || '').toUpperCase().startsWith('VES') ? 'TV' : 'TM';
    const g = String(grupo || '').replace(/[^0-9A-Za-z-]/g, '');
    const p = (parcialMode || 'ACUM').toUpperCase();
    return `${t}_${g}_BOLETA_OFICIAL_${p}`;
  }

  let _students = [], _groups = [], _subjects = [], _assignments = [];

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;
    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando...')}</div>`;

    try {
      const [students, groups, subjects, assignments, oriGroups] = await Promise.all([
        Store.getStudents(), Store.getGroups(), Store.getSubjects(), Store.getAssignments(),
        Store.getOrientadorGroups()
      ]);
      // Filtrado para orientadores: solo sus grupos asignados
      const filteredGroups = oriGroups ? groups.filter(g => oriGroups.includes(g.id)) : groups;
      const allowedGroupIds = new Set(filteredGroups.map(g => g.id));
      _students = students.filter(s => s.estatus === 'ACTIVO' && (oriGroups === null || allowedGroupIds.has(s.groupId)));
      _groups = filteredGroups;
      _subjects = subjects;
      _assignments = assignments;

      const turnoOpts = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
      const gradoOpts = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba</option>`).join('');

      container.innerHTML = `
        <div class="module-container">
          ${UI.pageHeader('Boleta Oficial de Calificaciones', 'Formato oficial de fin de semestre — Promedio de los 3 parciales')}
          <div class="card filter-bar">
            <div class="filter-bar-grid">
              <div class="form-group"><label>Turno</label>
                <select id="bo-turno"><option value="">Turno</option>${turnoOpts}</select></div>
              <div class="form-group"><label>Grado</label>
                <select id="bo-grado" disabled><option value="">Grado</option>${gradoOpts}</select></div>
              <div class="form-group"><label>Grupo</label>
                <select id="bo-grupo" disabled><option value="">Grupo</option></select></div>
              <div class="form-group"><label>Parcial</label>
                <select id="bo-parcial">
                  <option value="ACUM">Acumulado del semestre</option>
                  <option value="P1">Primer Parcial</option>
                  <option value="P2">Segundo Parcial</option>
                  <option value="P3">Tercer Parcial</option>
                </select></div>
              <div class="form-group"><label>Alumno</label>
                <select id="bo-alumno" disabled><option value="">Alumno</option></select></div>
              <div class="form-group"><label>Fecha de boleta</label>
                <input type="date" id="bo-fecha" value="${new Date().toISOString().split('T')[0]}"></div>
            </div>
            <div class="filter-bar-actions">
              <button class="btn btn-primary" data-action="generate">Generar</button>
              <button class="btn btn-outline" data-action="print">Imprimir</button>
              <button class="btn btn-success" data-action="generate-all-turno"
                title="Genera las boletas de TODOS los grupos del turno seleccionado y prepara un PDF etiquetado por cada grupo. Requiere solo elegir 'Turno' + 'Parcial'.">
                Boletas TODO el turno
              </button>
            </div>
          </div>
          <div id="bo-results">
            <div class="empty-state">
              <span class="material-icons-round empty-state-icon">description</span>
              <p class="empty-state-text">Selecciona turno, grado, grupo y alumno, luego haz clic en Generar</p>
            </div>
          </div>
        </div>`;

      _bindFilters();
      _bindActions(container);
      Utils.restrictTurnoGradoOptions(_groups, 'bo-turno', 'bo-grado');
    } catch (e) {
      console.error('Error:', e);
      container.innerHTML = `<div class="module-container">${UI.emptyState('error', e.message)}</div>`;
    }
  }

  function _bindFilters() {
    const turnoEl = document.getElementById('bo-turno');
    const gradoEl = document.getElementById('bo-grado');
    const grupoEl = document.getElementById('bo-grupo');
    const alumnoEl = document.getElementById('bo-alumno');

    turnoEl.addEventListener('change', () => {
      grupoEl.innerHTML = '<option value="">Grupo</option>'; grupoEl.disabled = true;
      alumnoEl.innerHTML = '<option value="">Alumno</option>'; alumnoEl.disabled = true;
      if (!turnoEl.value) { gradoEl.disabled = true; return; }
      gradoEl.disabled = false;
    });
    gradoEl.addEventListener('change', () => {
      alumnoEl.innerHTML = '<option value="">Alumno</option>'; alumnoEl.disabled = true;
      if (!gradoEl.value) { grupoEl.innerHTML = '<option value="">Grupo</option>'; grupoEl.disabled = true; return; }
      const filtered = _groups.filter(g => g.turno === turnoEl.value && String(g.grado) === String(gradoEl.value))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      grupoEl.innerHTML = '<option value="">Grupo</option>' +
        filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
      grupoEl.disabled = false;
    });
    grupoEl.addEventListener('change', () => {
      if (!grupoEl.value) { alumnoEl.innerHTML = '<option value="">Alumno</option>'; alumnoEl.disabled = true; return; }
      const sts = _students.filter(s => s.groupId === grupoEl.value)
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      alumnoEl.innerHTML = '<option value="">Selecciona alumno</option><option value="__todos__">--- Todo el grupo ---</option>' +
        sts.map(s => `<option value="${s.id}">${Utils.sanitize(s.nombreCompleto)}</option>`).join('');
      alumnoEl.disabled = false;
    });
  }

  function _bindActions(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'generate') _generate();
      else if (btn.dataset.action === 'print') _print();
      else if (btn.dataset.action === 'generate-all-turno') _generateAllTurno();
      else if (btn.dataset.action === 'download-group') _downloadGroupBoleta(Number(btn.dataset.idx));
    });
  }

  async function _generate(override) {
    // v9.31: acepta override opcional { groupId, alumnoVal, turno, grado, parcialMode }
    // para que _generateAllTurno pueda inyectar cada grupo directamente sin
    // depender del DOM (los <select> hijos se rellenan asincrónicamente al
    // hacer .change y no siempre están listos cuando iteramos).
    const groupId = override?.groupId ?? document.getElementById('bo-grupo').value;
    const alumnoVal = override?.alumnoVal ?? document.getElementById('bo-alumno').value;
    const turno = override?.turno ?? document.getElementById('bo-turno').value;
    const grado = override?.grado ?? document.getElementById('bo-grado').value;
    // v8.20: selector de parcial (ACUM | P1 | P2 | P3). ACUM aplica reglas SEP.
    const parcialMode = override?.parcialMode ?? (document.getElementById('bo-parcial')?.value || 'ACUM');
    const results = document.getElementById('bo-results');

    if (!groupId || !alumnoVal) {
      Toast.show('Selecciona grupo y alumno', 'warning'); return;
    }

    const fechaInput = document.getElementById('bo-fecha').value;
    const fechaObj = fechaInput ? new Date(fechaInput + 'T12:00:00') : new Date();
    const dia = fechaObj.getDate();
    const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const mes = meses[fechaObj.getMonth()];
    const anio = fechaObj.getFullYear();
    const fechaTexto = `CUAUTITL\u00c1N IZCALLI M\u00c9X., A LOS ${dia} D\u00cdAS DEL MES DE ${mes} DEL ${anio}.`;

    results.innerHTML = UI.loadingState('Calculando promedios...');

    try {
      // v8.26: grades SELLADAS — prefiere snapshot certificado al imprimir lista oficial
      const allGrades = await Store.getSealedGradesByGroup(groupId, { force: true });
      const grupo = _groups.find(g => g.id === groupId);
      const groupName = grupo?.nombre || groupId;

      // Get subjects for this group
      const groupAsgs = _assignments.filter(a => a.groupId === groupId);
      const subjectIds = [...new Set(groupAsgs.map(a => a.subjectId))];
      const groupSubjects = K.sortSubjectsByGrado(_subjects.filter(s => subjectIds.includes(s.id)), grado);

      // Students
      let studentList;
      if (alumnoVal === '__todos__') {
        studentList = _students.filter(s => s.groupId === groupId)
          .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      } else {
        studentList = _students.filter(s => s.id === alumnoVal);
      }

      // Compute per student: average of P1+P2+P3 per subject
      // Semestre corriente según la fecha actual (App.getCurrentSemester
      // detecta automáticamente si estamos en 1er o 2do semestre del ciclo).
      const semestre = App.getCurrentSemester(grado).texto;
      const ciclo = '2025-2026';
      const numToText = { 1:'UNA', 2:'DOS', 3:'TRES', 4:'CUATRO', 5:'CINCO', 6:'SEIS', 7:'SIETE', 8:'OCHO', 9:'NUEVE', 10:'DIEZ', 11:'ONCE', 12:'DOCE', 13:'TRECE' };

      let html = '';

      // v8.60 REGLAS SEP: cargar horas por materia para aplicar la regla del 20%
      // de faltas. Sin esto la cal final no es 100% reglada.
      let hoursIdx = {};
      try {
        const hMap = await Store.getTeacherHoursForGroups([groupId]);
        for (const h of hMap.values()) {
          const subj = h.subjectId;
          const part = h.partial || 'SEMESTRE';
          if (!hoursIdx[subj]) hoursIdx[subj] = {};
          hoursIdx[subj][part] = h;
        }
      } catch (e) { console.warn('[boleta-oficial] no se pudieron cargar horas:', e.message); }

      studentList.forEach((student, idx) => {
        const isTraslado = !!student.bajaPendiente;
        const blankFill = '';
        const studentGrades = isTraslado ? [] : allGrades.filter(g => g.studentId === student.id);

        const subjectRows = [];
        let totalCal = 0, countCal = 0;

        groupSubjects.forEach(sub => {
          const subGrades = studentGrades.filter(g => g.subjectId === sub.id);

          let finalCal = blankFill;
          let obs = isTraslado ? '' : 'NO ACREDITADA';
          let reprobadoPorRegla = false;
          let motivoSEP = '';

          if (parcialMode === 'ACUM') {
            // ── ACUMULADO con reglas SEP ──
            // Construir grades3 ordenado (P1, P2, P3) para reglas SEP
            const grades3 = ['P1', 'P2', 'P3'].map(p => subGrades.find(g => g.partial === p) || null);
            const tieneAlguna = grades3.some(g => g != null);
            if (tieneAlguna) {
              const result = App.calcCalFinalSEP({
                grades3,
                hoursByPart: hoursIdx[sub.id] || {}
              });
              if (result.calFinal != null) {
                finalCal = result.calFinal;
                reprobadoPorRegla = result.reprobadoPorRegla;
                motivoSEP = result.motivo;
                obs = finalCal >= 6 ? 'ACREDITADA' : 'NO ACREDITADA';
                totalCal += finalCal;
                countCal++;
              }
            }
          } else {
            // ── PARCIAL ESPECIFICO (P1, P2 o P3) ──
            // Solo la cal de ese parcial, sin aplicar reglas SEP (que requieren los 3).
            const gd = subGrades.find(g => g.partial === parcialMode);
            const cal = gd ? (gd.cal != null ? Number(gd.cal) : (gd.value != null ? Number(gd.value) : null)) : null;
            if (cal != null && !isNaN(cal)) {
              finalCal = cal;
              obs = cal >= 6 ? 'ACREDITADA' : 'NO ACREDITADA';
              totalCal += cal;
              countCal++;
            }
          }

          subjectRows.push({
            name: K.getUACNombre(sub.nombre),
            ciclo,
            cal: finalCal,
            obs,
            reprobadoPorRegla,
            motivoSEP
          });
        });

        const promedio = countCal > 0 ? (totalCal / countCal).toFixed(1) : blankFill;
        const numAsig = groupSubjects.length;
        const numAsigText = numToText[numAsig] || numAsig;

        const isLast = idx === studentList.length - 1;
        const pageBreak = !isLast ? ' style="page-break-after:always;"' : '';

        const tableRows = subjectRows.map(r => `
          <tr>
            <td style="padding:4px 8px;border:1px solid #bfbfbf;font-size:11px;">${Utils.sanitize(r.name)}</td>
            <td style="padding:4px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;">${r.ciclo}</td>
            <td style="padding:4px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;font-weight:700;">${r.cal}</td>
            <td style="padding:4px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;">${r.obs}</td>
          </tr>`).join('');

        // Nombre separado — con tildes restituidas para impresión oficial
        // (los datos históricos vienen sin tildes: MARTINEZ, MARIA → MARTÍNEZ, MARÍA)
        const ap1 = Utils.reacentuar(student.apellido1 || '');
        const ap2 = Utils.reacentuar(student.apellido2 || '');
        const nombres = Utils.reacentuar(student.nombres || '');
        const nombreDisplay = `${ap1} ${ap2} ${nombres}`.trim() || Utils.reacentuar(student.nombreCompleto || '');

        // CCT correcto según turno del grupo (no del alumno impresor)
        const cctTurno = String(turno).toUpperCase() === 'VESPERTINO' ? '15EBH0168U' : '15EBH0134D';

        html += `
          <div class="boleta-oficial"${pageBreak}>
            <!-- Banner oficial de Gobierno del Edomex (mismo que preboletas) -->
            <div style="text-align:center;margin-bottom:6px;">
              <img src="/img/header-gobierno-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
            </div>
            <!-- Frase institucional del año oficial 2026 (Estado de México).
                 Sin font-family propia → hereda Arial del body de la boleta. -->
            <div style="text-align:center;margin:6px 0 8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <div style="font-size:11px;color:#000;">
                <span style="color:#9b2c2c;font-weight:600;">&ldquo;2026.</span> A&ntilde;o del Humanismo Mexicano en el Estado de M&eacute;xico&rdquo;.
              </div>
            </div>
            <div style="text-align:center;margin-bottom:16px;">
              <div style="font-size:13px;font-weight:700;">ESCUELA PREPARATORIA OFICIAL N&Uacute;M. 67</div>
              <div style="margin-top:10px;display:flex;justify-content:space-between;font-size:11px;">
                <span>C.C.T. <strong>${cctTurno}</strong></span>
                <span><strong>TURNO: ${Utils.sanitize(turno)}</strong></span>
              </div>
              <div style="font-size:13px;font-weight:700;margin-top:14px;">BOLETA DE CALIFICACIONES${
                parcialMode === 'ACUM' ? '' :
                parcialMode === 'P1' ? ' &mdash; PRIMER PARCIAL' :
                parcialMode === 'P2' ? ' &mdash; SEGUNDO PARCIAL' :
                parcialMode === 'P3' ? ' &mdash; TERCER PARCIAL' : ''
              }</div>
            </div>

            <div style="font-size:11px;margin-bottom:6px;">
              NOMBRE DEL ALUMNO (A): <strong>${Utils.sanitize(nombreDisplay)}</strong>
            </div>

            <div style="font-size:10px;margin-bottom:14px;">
              SEMESTRE CURSADO: <strong>${semestre}</strong> DEL BACHILLERATO GENERAL CON FORMACI&Oacute;N ELEMENTAL PARA EL TRABAJO EN TECNOLOG&Iacute;AS DE LA INFORMACI&Oacute;N Y COMUNICACI&Oacute;N.
              &nbsp;&nbsp;&nbsp;GRUPO: <strong>${Utils.sanitize(groupName)}</strong>
            </div>

            <table style="width:100%;border-collapse:collapse;border:1px solid #bfbfbf;">
              <thead>
                <tr style="background:#f0f0f0;">
                  <th style="padding:5px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;width:45%;">ASIGNATURAS</th>
                  <th style="padding:5px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;width:14%;">CICLO</th>
                  <th style="padding:5px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;width:16%;">CALIFICACI&Oacute;N</th>
                  <th style="padding:5px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;width:20%;">OBSERVACIONES</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
                <tr>
                  <td style="padding:5px 8px;border:1px solid #bfbfbf;"></td>
                  <td style="padding:5px 8px;border:1px solid #bfbfbf;font-size:11px;text-align:center;font-weight:700;">PROMEDIO:</td>
                  <td style="padding:5px 8px;border:1px solid #bfbfbf;font-size:12px;text-align:center;font-weight:700;">${promedio}</td>
                  <td style="padding:5px 8px;border:1px solid #bfbfbf;"></td>
                </tr>
              </tbody>
            </table>

            <div style="margin-top:14px;font-size:9px;">
              <div><strong>ASIGNATURAS CURSADAS ${numAsig}(${numAsigText})</strong></div>
              <div><strong>LA CALIFICACI&Oacute;N M&Iacute;NIMA APROBATORIA ES DE 6 (SEIS) PUNTOS</strong></div>
              <div>ESTA BOLETA NO ES V&Aacute;LIDA SI PRESENTA BORRADURAS O ALTERACIONES</div>
            </div>

            <div style="text-align:right;margin-top:14px;font-size:10px;">
              ${fechaTexto}
            </div>

            <div style="text-align:center;margin-top:28px;">
              <div style="font-size:11px;font-weight:700;">ATENTAMENTE</div>
              <div style="margin-top:30px;font-size:11px;font-weight:700;">${Utils.sanitize(App.staffName('director'))}</div>
              <div style="font-size:9px;margin-top:2px;font-weight:600;">${Utils.sanitize(App.staffCargo('director'))}</div>
              <div style="font-size:8px;margin-top:2px;">
                ESCUELA PREPARATORIA OFICIAL N&Uacute;M. 67, con CCT ${cctTurno},<br>
                del municipio de Cuautitl&aacute;n Izcalli, Estado de M&eacute;xico.
              </div>
            </div>

            <!-- Bandín oficial de Gobierno del Edomex (mismo que preboletas) -->
            <div style="text-align:center;margin-top:14px;">
              <img src="/img/bandin-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
            </div>
          </div>`;
      });

      results.innerHTML = html || UI.emptyState('search_off', 'No hay datos para generar boletas');
    } catch (e) {
      console.error('Error:', e);
      results.innerHTML = UI.emptyState('error', e.message);
    }
  }

  function _print() {
    const results = document.getElementById('bo-results');
    if (!results || results.querySelector('.empty-state')) {
      Toast.show('Genera primero las boletas', 'warning'); return;
    }

    const content = [...results.children].map(el => el.outerHTML).join('');

    // Resolver metadatos para nombre del archivo (formato Dirección v9.33):
    //   TM_1-1_BOLETA_OFICIAL_ACUM  o  TV_3-2_BOLETA_OFICIAL_P3
    const _gid = document.getElementById('bo-grupo')?.value;
    const _parcialMode = document.getElementById('bo-parcial')?.value || 'ACUM';
    const _g = _groups.find(x => x.id === _gid);
    const _docTitle = _buildFileName(_g?.turno, _g?.nombre, _parcialMode);
    // v9.32: NO cambiar document.title antes de print — Chrome usa el <title>
    // como nombre del archivo al elegir "Guardar como PDF". Dejar filename real.
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>${Utils.sanitize(_docTitle)}</title>
      <style>
        @page { size: letter portrait; margin: 18mm 20mm; margin-top: 12mm; margin-bottom: 12mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Arial, sans-serif; color: #000; }
        @media print {
          @page { margin-top: 12mm; margin-bottom: 12mm; }
        }
        .boleta-oficial { padding: 0; }
        table { border-collapse: collapse; }
        @media print {
          .boleta-oficial[style*="page-break-after"] { page-break-after: always; }
        }
      </style>
    </head><body>${content}
    <script>
      setTimeout(()=>window.print(),400);
    <\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // GENERACIÓN MASIVA POR TURNO — un PDF etiquetado por cada grupo
  // ═══════════════════════════════════════════════════════════════

  // Almacén temporal (en memoria) de las boletas generadas por grupo.
  // Cada entrada = { groupId, groupName, turno, grado, filename, html, count }
  let _preparedBoletas = [];

  async function _generateAllTurno() {
    const turno = document.getElementById('bo-turno').value;
    if (!turno) { Toast.show('Selecciona un turno primero', 'warning'); return; }

    // Grado es opcional; si viene, filtra por ese grado
    const grado = document.getElementById('bo-grado').value;

    // Grupos del turno (y grado si aplica), ordenados por grado y nombre
    let grupos = _groups.filter(g => g.turno === turno);
    if (grado) grupos = grupos.filter(g => String(g.grado) === String(grado));
    grupos.sort((a, b) => (Number(a.grado) || 0) - (Number(b.grado) || 0) || (a.nombre || '').localeCompare(b.nombre || ''));

    if (!grupos.length) { Toast.show('No hay grupos en el turno seleccionado', 'warning'); return; }

    const parcialSel = document.getElementById('bo-parcial');
    const parcialLabel = parcialSel?.options[parcialSel.selectedIndex]?.text || 'Acumulado';

    if (!confirm(`Se prepararán las boletas oficiales de ${grupos.length} grupos del turno ${turno} (${parcialLabel}).\n\nAl terminar verás un botón por cada grupo para descargar/imprimir su PDF etiquetado.\n\n¿Continuar?`)) return;

    const btn = document.querySelector('[data-action="generate-all-turno"]');
    const origText = btn.textContent;
    btn.disabled = true;

    _preparedBoletas = [];
    const results = document.getElementById('bo-results');
    const parcialMode = parcialSel?.value || 'ACUM';

    let totalStudents = 0;
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[i];
      btn.textContent = `Procesando ${g.nombre}… (${i + 1}/${grupos.length})`;

      // v9.31: llamar a _generate() con parámetros DIRECTOS (sin mutar el DOM).
      // Antes se seteaba filterGrupo.value = g.id, pero los <option> del select
      // se rellenan sólo con el evento change() del grado, así que .value = X
      // dejaba el select en blanco y _generate leía "" → "No se encontraron datos".
      await _generate({
        groupId: g.id,
        alumnoVal: '__todos__',
        turno: g.turno,
        grado: g.grado,
        parcialMode
      });

      // Capturar solo las tarjetas de boleta (excluye empty-state / loading-state / error)
      const cards = [...results.querySelectorAll('.boleta-oficial')];
      if (!cards.length) continue;

      const html = cards.map(el => el.outerHTML).join('');
      const filename = _buildFileName(g.turno, g.nombre, parcialMode);

      _preparedBoletas.push({
        groupId: g.id,
        groupName: g.nombre,
        turno: g.turno,
        grado: g.grado,
        filename,
        html,
        count: cards.length
      });
      totalStudents += cards.length;
    }

    btn.textContent = origText;
    btn.disabled = false;

    _renderPreparedPanel(turno, parcialLabel, totalStudents);
  }

  function _renderPreparedPanel(turno, parcialLabel, totalStudents) {
    const results = document.getElementById('bo-results');
    if (!_preparedBoletas.length) {
      results.innerHTML = UI.emptyState('search_off', 'No se encontraron datos para generar boletas en este turno');
      return;
    }

    const groupsList = _preparedBoletas.map((b, idx) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:600;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:20px;color:#3182ce;">group</span>
          &nbsp;Grupo <strong>${Utils.sanitize(b.groupName)}</strong>
          <span style="color:#64748b;font-weight:normal;font-size:13px;">&nbsp;— ${b.count} alumno${b.count === 1 ? '' : 's'}</span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:12px;color:#475569;">
          ${Utils.sanitize(b.filename)}.pdf
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:right;">
          <button class="btn btn-primary btn-sm" data-action="download-group" data-idx="${idx}">
            <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">picture_as_pdf</span>
            Descargar / Imprimir
          </button>
        </td>
      </tr>
    `).join('');

    results.innerHTML = `
      <div class="card">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#f0fdf4;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
              <h3 style="margin:0;font-size:16px;color:#166534;">
                <span class="material-icons-round" style="vertical-align:middle;color:#22c55e;">check_circle</span>
                Boletas preparadas — TURNO ${Utils.sanitize(turno)}
              </h3>
              <p style="margin:4px 0 0;color:#166534;font-size:13px;">
                ${_preparedBoletas.length} grupos · ${totalStudents} alumnos · ${Utils.sanitize(parcialLabel)}
              </p>
            </div>
            <div style="font-size:12px;color:#64748b;max-width:420px;">
              Click en cada botón abre una vista de impresión con el PDF de ese grupo, etiquetado con su nombre. En el diálogo de impresión elige <strong>"Guardar como PDF"</strong>.
            </div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:10px 14px;text-align:left;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">GRUPO</th>
              <th style="padding:10px 14px;text-align:left;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">ARCHIVO ETIQUETADO</th>
              <th style="padding:10px 14px;text-align:right;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0;">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>${groupsList}</tbody>
        </table>
      </div>
    `;
  }

  function _downloadGroupBoleta(idx) {
    const b = _preparedBoletas[idx];
    if (!b) { Toast.show('No hay datos para ese grupo', 'error'); return; }

    // Reusa exactamente el mismo CSS de impresión de _print() para
    // garantizar que la boleta descargada masivamente sea IDÉNTICA a
    // la boleta descargada individual. Cualquier cambio en _print debe
    // mantenerse sincronizado con este bloque (o refactorizarlo).
    // v9.32: NO cambiar document.title antes de print — Chrome usa el <title>
    // como sugerencia del nombre del archivo al elegir "Guardar como PDF".
    // Si lo pongo en ' ' (para ocultar encabezado del navegador), sugiere
    // "download.pdf". Ahora dejamos el title = filename real y el encabezado
    // del navegador queda oculto por @page + margin-top del CSS de impresión.
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>${Utils.sanitize(b.filename)}</title>
      <style>
        @page { size: letter portrait; margin: 18mm 20mm; margin-top: 12mm; margin-bottom: 12mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Arial, sans-serif; color: #000; }
        @media print {
          @page { margin-top: 12mm; margin-bottom: 12mm; }
        }
        .boleta-oficial { padding: 0; }
        table { border-collapse: collapse; }
        @media print {
          .boleta-oficial[style*="page-break-after"] { page-break-after: always; }
        }
      </style>
    </head><body>${b.html}
    <script>
      setTimeout(()=>window.print(),400);
    <\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      Toast.show('El navegador bloqueó la ventana emergente. Habilita pop-ups para este sitio.', 'error');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  return { render };
})();

Router.modules['boleta-oficial'] = () => BoletaOficialModule.render();
