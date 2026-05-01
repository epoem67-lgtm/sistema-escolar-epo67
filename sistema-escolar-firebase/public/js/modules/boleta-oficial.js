/**
 * BOLETA OFICIAL DE CALIFICACIONES — EPO 67
 * Formato oficial de fin de semestre.
 * Calificacion = promedio de los 3 parciales por materia.
 * Replica exacta del formato institucional.
 */

const BoletaOficialModule = (function () {
  const CONTAINER = '#moduleContainer';

  let _students = [], _groups = [], _subjects = [], _assignments = [];

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;
    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando...')}</div>`;

    try {
      const [students, groups, subjects, assignments] = await Promise.all([
        Store.getStudents(), Store.getGroups(), Store.getSubjects(), Store.getAssignments()
      ]);
      _students = students.filter(s => s.estatus === 'ACTIVO');
      _groups = groups;
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
              <div class="form-group"><label>Alumno</label>
                <select id="bo-alumno" disabled><option value="">Alumno</option></select></div>
              <div class="form-group"><label>Fecha de boleta</label>
                <input type="date" id="bo-fecha" value="${new Date().toISOString().split('T')[0]}"></div>
            </div>
            <div class="filter-bar-actions">
              <button class="btn btn-primary" data-action="generate">Generar</button>
              <button class="btn btn-outline" data-action="print">Imprimir</button>
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
    });
  }

  async function _generate() {
    const groupId = document.getElementById('bo-grupo').value;
    const alumnoVal = document.getElementById('bo-alumno').value;
    const turno = document.getElementById('bo-turno').value;
    const grado = document.getElementById('bo-grado').value;
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
      const allGrades = await Store.getGradesByGroup(groupId, true);
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
      const semMap = { '1': 'PRIMER', '2': 'TERCERO', '3': 'QUINTO' };
      const semestre = semMap[String(grado)] || 'PRIMER';
      const ciclo = '2025-2026';
      const numToText = { 1:'UNA', 2:'DOS', 3:'TRES', 4:'CUATRO', 5:'CINCO', 6:'SEIS', 7:'SIETE', 8:'OCHO', 9:'NUEVE', 10:'DIEZ', 11:'ONCE', 12:'DOCE', 13:'TRECE' };

      let html = '';

      studentList.forEach((student, idx) => {
        const studentGrades = allGrades.filter(g => g.studentId === student.id);

        // Per subject: average of available parcials
        const subjectRows = [];
        let totalCal = 0, countCal = 0;

        groupSubjects.forEach(sub => {
          const subGrades = studentGrades.filter(g => g.subjectId === sub.id);
          const cals = subGrades.map(g => g.cal !== undefined ? g.cal : (g.value !== undefined ? Number(g.value) : null))
            .filter(v => v !== null && !isNaN(v));

          let finalCal = '';
          let obs = '';
          if (cals.length > 0) {
            const avg = cals.reduce((a, b) => a + b, 0) / cals.length;
            finalCal = Math.round(avg);
            if (finalCal < 6) finalCal = 5;
            if (finalCal > 10) finalCal = 10;
            obs = finalCal >= 6 ? 'ACREDITADA' : 'NO ACREDITADA';
            totalCal += finalCal;
            countCal++;
          }

          subjectRows.push({
            name: K.getUACNombre(sub.nombre),
            ciclo,
            cal: finalCal,
            obs
          });
        });

        const promedio = countCal > 0 ? (totalCal / countCal).toFixed(1) : '';
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

        // Nombre separado
        const ap1 = student.apellido1 || '';
        const ap2 = student.apellido2 || '';
        const nombres = student.nombres || '';
        const nombreDisplay = `${ap1} ${ap2} ${nombres}`.trim() || student.nombreCompleto || '';

        html += `
          <div class="boleta-oficial"${pageBreak}>
            <div style="text-align:center;margin-bottom:16px;">
              <div style="font-size:13px;font-weight:700;font-family:Times,serif;">ESCUELA PREPARATORIA OFICIAL N&Uacute;M.67</div>
              <div style="margin-top:10px;display:flex;justify-content:space-between;font-size:11px;font-family:Times,serif;">
                <span>C.C.T <strong>15EBH0134D</strong></span>
                <span><strong>TURNO: ${Utils.sanitize(turno)}</strong></span>
              </div>
              <div style="font-size:13px;font-weight:700;margin-top:14px;font-family:Times,serif;">BOLETA DE CALIFICACIONES</div>
            </div>

            <div style="font-size:11px;font-family:Times,serif;margin-bottom:6px;">
              NOMBRE DEL ALUMNO (A): <strong>${Utils.sanitize(nombreDisplay)}</strong>
            </div>

            <div style="font-size:10px;font-family:Times,serif;margin-bottom:14px;">
              SEMESTRE CURSADO: <strong>${semestre}</strong> DEL BACHILLERATO GENERAL CON FORMACI&Oacute;N ELEMENTAL PARA EL TRABAJO EN TECNOLOG&Iacute;AS DE LA INFORMACI&Oacute;N Y COMUNICACI&Oacute;N.
              &nbsp;&nbsp;&nbsp;GRUPO: <strong>${Utils.sanitize(groupName)}</strong>
            </div>

            <table style="width:100%;border-collapse:collapse;border:1px solid #bfbfbf;font-family:Times,serif;">
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

            <div style="margin-top:14px;font-family:Times,serif;font-size:9px;">
              <div><strong>ASIGNATURAS CURSADAS ${numAsig}(${numAsigText})</strong></div>
              <div><strong>LA CALIFICACION MINIMA APROBATORIA ES DE 6 (SEIS) PUNTOS</strong></div>
              <div>ESTA BOLETA NO ES VALIDA SI PRESENTA BORRADURAS O ALTERACIONES</div>
            </div>

            <div style="text-align:right;margin-top:14px;font-family:Times,serif;font-size:10px;">
              ${fechaTexto}
            </div>

            <div style="text-align:center;margin-top:28px;font-family:Times,serif;">
              <div style="font-size:11px;font-weight:700;">ATENTAMENTE</div>
              <div style="margin-top:30px;font-size:11px;font-weight:700;">${Utils.sanitize(App.staffName('director'))}</div>
              <div style="font-size:9px;margin-top:2px;font-weight:600;">${Utils.sanitize(App.staffCargo('director'))}</div>
              <div style="font-size:8px;margin-top:2px;">
                ESCUELA PREPARATORIA OFICIAL N&Uacute;M. 67, con CCT 15EBH0134D,<br>
                del municipio de Cuautitl&aacute;n Izcalli, Estado de M&eacute;xico.
              </div>
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

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Boleta Oficial EPO 67</title>
      <style>
        @page { size: letter portrait; margin: 18mm 20mm; margin-top: 12mm; margin-bottom: 12mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Times, 'Times New Roman', serif; color: #000; }
        /* Ocultar encabezado y pie de pagina del navegador */
        @media print {
          @page { margin-top: 12mm; margin-bottom: 12mm; }
          title { display: none; }
        }
        .boleta-oficial { padding: 0; }
        table { border-collapse: collapse; }
        @media print {
          .boleta-oficial[style*="page-break-after"] { page-break-after: always; }
        }
      </style>
    </head><body>${content}
    <script>
      // Set document title to space to avoid "about:blank" in header
      document.title = ' ';
      setTimeout(()=>window.print(),400);
    <\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  return { render };
})();

Router.modules['boleta-oficial'] = () => BoletaOficialModule.render();
