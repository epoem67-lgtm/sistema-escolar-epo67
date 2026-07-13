/**
 * IMPORT GRADES MODULE - Importacion de Calificaciones desde Excel
 * Sistema Escolar EPO 67
 *
 * Permite a administradores importar calificaciones desde archivos Excel.
 * Flujo: Configuracion -> Carga de archivo -> Mapeo de columnas ->
 *        Coincidencia de alumnos -> Importacion a Firestore
 */

const ImportGradesModule = (() => {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let allGroups = [];
  let allSubjects = [];
  let allStudents = [];

  let parsedRows = [];
  let columnHeaders = [];
  let nameColIndex = -1;
  let gradeColIndex = -1;
  let matchedRows = [];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function normalizeName(name) {
    return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function getContainer() {
    return document.getElementById('moduleContainer');
  }

  function resetState() {
    parsedRows = [];
    columnHeaders = [];
    nameColIndex = -1;
    gradeColIndex = -1;
    matchedRows = [];
  }

  function getFilterValues() {
    return {
      turno: document.getElementById('ig-turno')?.value || '',
      grado: document.getElementById('ig-grado')?.value || '',
      grupo: document.getElementById('ig-grupo')?.value || '',
      materia: document.getElementById('ig-materia')?.value || '',
      parcial: document.getElementById('ig-parcial')?.value || ''
    };
  }

  function filteredGroups(turno, grado) {
    return allGroups.filter(g => {
      if (turno && g.turno !== turno) return false;
      if (grado && String(g.grado) !== String(grado)) return false;
      return true;
    });
  }

  function filteredSubjects(grado) {
    if (!grado) return [];
    return allSubjects.filter(s => String(s.grado) === String(grado));
  }

  function studentsForGroup(groupId) {
    if (!groupId) return [];
    return allStudents.filter(s => s.groupId === groupId);
  }

  // ---------------------------------------------------------------------------
  // Auto-detect columns
  // ---------------------------------------------------------------------------

  function autoDetectColumns(headers) {
    const namePatterns = ['nombre', 'alumno', 'estudiante'];
    const gradePatterns = ['cal', 'nota', 'prom'];

    let detectedName = -1;
    let detectedGrade = -1;

    headers.forEach((h, i) => {
      const normalized = normalizeName(h);
      if (detectedName === -1 && namePatterns.some(p => normalized.includes(p))) {
        detectedName = i;
      }
      if (detectedGrade === -1 && gradePatterns.some(p => normalized.includes(p))) {
        detectedGrade = i;
      }
    });

    return { detectedName, detectedGrade };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  async function render() {
    const container = getContainer();
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Importar Calificaciones</h1>
            <p class="module-subtitle">Importa calificaciones desde un archivo Excel (.xlsx / .xls)</p>
          </div>
        </div>
        <div id="ig-step-config"></div>
        <div id="ig-step-upload" class="hidden"></div>
        <div id="ig-step-mapping" class="hidden"></div>
        <div id="ig-step-matching" class="hidden"></div>
        <div id="ig-result" class="hidden"></div>
      </div>
    `;

    try {
      const [groups, subjects, students] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        Store.getStudents()
      ]);

      allGroups = groups;
      allSubjects = subjects;
      allStudents = students;
    } catch (err) {
      container.innerHTML = `
        <div class="module-container">
          <div class="error-state">
            <span class="material-icons-round">error</span>
            <p>Error cargando datos: ${Utils.sanitize(err.message)}</p>
          </div>
        </div>`;
      return;
    }

    resetState();
    renderConfigStep();
    bindEvents(container);
  }

  // ---------------------------------------------------------------------------
  // Step 1: Configuration
  // ---------------------------------------------------------------------------

  function renderConfigStep() {
    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${Utils.sanitize(t)}</option>`).join('');
    const gradoOptions = K.GRADOS.map(g => `<option value="${g}">${g}&#186; Grado</option>`).join('');
    const parcialOptions = K.PARCIALES.map(p => `<option value="${p.id}">${Utils.sanitize(p.nombre)}</option>`).join('');

    const el = document.getElementById('ig-step-config');
    if (!el) return;

    el.innerHTML = `
      <div class="card filter-bar">
        <div class="filter-bar-grid">
          <div class="form-group">
            <label for="ig-turno">Turno</label>
            <select id="ig-turno">
              <option value="">-- Seleccionar --</option>
              ${turnoOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="ig-grado">Grado</label>
            <select id="ig-grado">
              <option value="">-- Seleccionar --</option>
              ${gradoOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="ig-grupo">Grupo</label>
            <select id="ig-grupo" disabled>
              <option value="">-- Selecciona turno y grado --</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ig-materia">Materia</label>
            <select id="ig-materia" disabled>
              <option value="">-- Selecciona grado --</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ig-parcial">Parcial</label>
            <select id="ig-parcial">${parcialOptions}</select>
          </div>
        </div>
        <div class="filter-bar-actions">
          <button class="btn btn-primary" data-action="show-upload">Continuar</button>
          <button class="btn btn-outline" data-action="reset-all">Limpiar</button>
        </div>
      </div>
    `;
    el.classList.remove('hidden');
  }

  function updateGroupOptions() {
    const { turno, grado } = getFilterValues();
    const grupoSelect = document.getElementById('ig-grupo');
    if (!grupoSelect) return;

    const groups = filteredGroups(turno, grado);

    if (turno && grado && groups.length > 0) {
      grupoSelect.disabled = false;
      grupoSelect.innerHTML = `
        <option value="">-- Seleccionar grupo --</option>
        ${groups.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.grupo || g.id)}</option>`).join('')}
      `;
    } else {
      grupoSelect.disabled = true;
      grupoSelect.innerHTML = '<option value="">-- Selecciona turno y grado --</option>';
    }
  }

  function updateSubjectOptions() {
    const { grado } = getFilterValues();
    const materiaSelect = document.getElementById('ig-materia');
    if (!materiaSelect) return;

    const subjects = filteredSubjects(grado);

    if (grado && subjects.length > 0) {
      materiaSelect.disabled = false;
      materiaSelect.innerHTML = `
        <option value="">-- Seleccionar materia --</option>
        ${subjects.map(s => `<option value="${s.id}">${Utils.sanitize(s.nombre || s.name || s.id)}</option>`).join('')}
      `;
    } else {
      materiaSelect.disabled = true;
      materiaSelect.innerHTML = '<option value="">-- Selecciona grado --</option>';
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: File Upload
  // ---------------------------------------------------------------------------

  function renderUploadStep() {
    const el = document.getElementById('ig-step-upload');
    if (!el) return;

    el.innerHTML = `
      <div class="card">
        <h2 class="module-subtitle">Paso 2: Seleccionar archivo Excel</h2>
        <div class="form-group">
          <label for="ig-file">Archivo (.xlsx / .xls)</label>
          <input type="file" id="ig-file" accept=".xlsx,.xls">
        </div>
        <div id="ig-file-status"></div>
      </div>
    `;
    el.classList.remove('hidden');
  }

  async function handleFileUpload(file) {
    if (!file) return;

    const statusEl = document.getElementById('ig-file-status');
    if (statusEl) {
      statusEl.innerHTML = '<div class="loading-state"><span class="material-icons-round spin">sync</span> Leyendo archivo...</div>';
    }

    try {
      const rows = await Utils.parseExcelFile(file);

      if (!rows || rows.length === 0) {
        if (statusEl) statusEl.innerHTML = '<div class="error-state"><p>El archivo no contiene datos.</p></div>';
        return;
      }

      columnHeaders = Object.keys(rows[0]);
      parsedRows = rows;

      if (statusEl) {
        statusEl.innerHTML = `
          <div class="badge badge-success">${parsedRows.length} filas leidas con ${columnHeaders.length} columnas</div>
        `;
      }

      renderMappingStep();
    } catch (err) {
      if (statusEl) {
        statusEl.innerHTML = `<div class="error-state"><p>Error leyendo archivo: ${Utils.sanitize(err.message)}</p></div>`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Column Mapping
  // ---------------------------------------------------------------------------

  function renderMappingStep() {
    const el = document.getElementById('ig-step-mapping');
    if (!el) return;

    const { detectedName, detectedGrade } = autoDetectColumns(columnHeaders);
    nameColIndex = detectedName;
    gradeColIndex = detectedGrade;

    const colOptions = columnHeaders.map((h, i) =>
      `<option value="${i}">${Utils.sanitize(h)}</option>`
    ).join('');

    // Preview first 5 rows
    const previewRows = parsedRows.slice(0, 5);
    const previewHeaders = columnHeaders.map(h => `<th>${Utils.sanitize(h)}</th>`).join('');
    const previewBody = previewRows.map(row => {
      const cells = columnHeaders.map(h => `<td>${Utils.sanitize(String(row[h] ?? ''))}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <h2 class="module-subtitle">Paso 3: Mapeo de columnas</h2>
        <div class="filter-bar-grid">
          <div class="form-group">
            <label for="ig-col-name">Columna de nombre del alumno</label>
            <select id="ig-col-name">
              <option value="-1">-- Seleccionar --</option>
              ${colOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="ig-col-grade">Columna de calificacion</label>
            <select id="ig-col-grade">
              <option value="-1">-- Seleccionar --</option>
              ${colOptions}
            </select>
          </div>
        </div>

        <h3 class="module-subtitle">Vista previa (primeras 5 filas)</h3>
        <div class="table-container">
          <table class="table-light">
            <thead><tr>${previewHeaders}</tr></thead>
            <tbody>${previewBody}</tbody>
          </table>
        </div>

        <div class="filter-bar-actions">
          <button class="btn btn-primary" data-action="process-matching">Procesar coincidencias</button>
        </div>
      </div>
    `;
    el.classList.remove('hidden');

    // Apply auto-detected values
    const nameSelect = document.getElementById('ig-col-name');
    const gradeSelect = document.getElementById('ig-col-grade');
    if (nameSelect && detectedName >= 0) nameSelect.value = String(detectedName);
    if (gradeSelect && detectedGrade >= 0) gradeSelect.value = String(detectedGrade);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Student Matching
  // ---------------------------------------------------------------------------

  function processMatching() {
    const nameIdx = parseInt(document.getElementById('ig-col-name')?.value ?? '-1', 10);
    const gradeIdx = parseInt(document.getElementById('ig-col-grade')?.value ?? '-1', 10);

    if (nameIdx < 0 || gradeIdx < 0) {
      Toast.show('Selecciona las columnas de nombre y calificacion', 'error');
      return;
    }

    nameColIndex = nameIdx;
    gradeColIndex = gradeIdx;

    const { grupo } = getFilterValues();
    const groupStudents = studentsForGroup(grupo);

    const nameHeader = columnHeaders[nameColIndex];
    const gradeHeader = columnHeaders[gradeColIndex];

    matchedRows = parsedRows.map(row => {
      const excelName = String(row[nameHeader] ?? '').trim();
      const gradeValue = row[gradeHeader];
      const normalizedExcel = normalizeName(excelName);

      let matchedStudent = null;
      if (normalizedExcel) {
        matchedStudent = groupStudents.find(s => {
          const normalizedStudent = normalizeName(s.nombreCompleto || '');
          return normalizedStudent.includes(normalizedExcel) || normalizedExcel.includes(normalizedStudent);
        });
      }

      return {
        excelName,
        gradeValue: gradeValue !== undefined && gradeValue !== null && gradeValue !== '' ? Number(gradeValue) : null,
        student: matchedStudent || null,
        matched: !!matchedStudent
      };
    });

    renderMatchingStep();
  }

  function renderMatchingStep() {
    const el = document.getElementById('ig-step-matching');
    if (!el) return;

    const totalRows = matchedRows.length;
    const matchedCount = matchedRows.filter(r => r.matched).length;
    const unmatchedCount = totalRows - matchedCount;

    const tableRows = matchedRows.map(r => {
      const studentName = r.student
        ? Utils.sanitize(r.student.nombreCompleto || r.student.id)
        : '<span class="text-danger">Sin coincidencia</span>';

      const statusBadge = r.matched
        ? '<span class="badge badge-success">Coincide</span>'
        : '<span class="badge badge-danger">Sin coincidencia</span>';

      const gradeDisplay = r.gradeValue !== null ? r.gradeValue : '-';

      return `
        <tr>
          <td>${Utils.sanitize(r.excelName)}</td>
          <td>${studentName}</td>
          <td>${Utils.sanitize(String(gradeDisplay))}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <div class="card">
        <h2 class="module-subtitle">Paso 4: Coincidencia de alumnos</h2>

        <div class="stats-grid">
          <div class="stat-card--compact">
            <div class="stat-label">Total filas</div>
            <div class="stat-number">${totalRows}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Coincidencias</div>
            <div class="stat-number">${matchedCount}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Sin coincidencia</div>
            <div class="stat-number">${unmatchedCount}</div>
          </div>
        </div>

        <div class="table-container">
          <table class="table-light">
            <thead>
              <tr>
                <th>Nombre en Excel</th>
                <th>Alumno encontrado</th>
                <th>Calificacion</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

        <div class="filter-bar-actions">
          <button class="btn btn-success" data-action="import-grades">Importar Calificaciones</button>
          <button class="btn btn-outline" data-action="reset-all">Limpiar</button>
        </div>
      </div>
    `;
    el.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------
  // Step 5: Import
  // ---------------------------------------------------------------------------

  async function importGrades() {
    const { grupo, materia, parcial } = getFilterValues();

    if (!grupo || !materia || !parcial) {
      Toast.show('Faltan datos de configuracion (grupo, materia o parcial)', 'error');
      return;
    }

    const rowsToImport = matchedRows.filter(r => r.matched && r.gradeValue !== null);

    if (rowsToImport.length === 0) {
      Toast.show('No hay filas validas para importar', 'error');
      return;
    }

    const confirmed = await new Promise(resolve => {
      Modal.open({
        title: 'Confirmar importacion',
        body: `<p>Se importaran <strong>${rowsToImport.length}</strong> calificaciones al parcial seleccionado.</p>
               <p>Esta accion sobrescribira calificaciones existentes para los alumnos coincidentes.</p>`,
        confirmText: 'Importar',
        confirmClass: 'btn-success',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
    });

    if (!confirmed) return;

    const importBtn = document.querySelector('[data-action="import-grades"]');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = 'Importando...';
    }

    try {
      const batch = db.batch();
      const now = new Date();
      const userId = auth.currentUser?.uid || 'unknown';

      rowsToImport.forEach(row => {
        const docId = `${row.student.id}_${materia}_${parcial}`;
        const ref = db.collection('grades').doc(docId);
        batch.set(ref, {
          studentId: row.student.id,
          subjectId: materia,
          groupId: grupo,
          partial: parcial,
          value: row.gradeValue,
          updatedAt: now,
          updatedBy: userId,
          importedFrom: 'excel'
        }, { merge: true });
      });

      await batch.commit();
      Store.invalidateGradesForGroup(grupo);

      DB.audit('importar', 'calificacion', '', {
        description: `Importación masiva: ${rowsToImport.length} calificaciones importadas desde Excel`,
        extra: { count: rowsToImport.length }
      });

      Toast.show(`${rowsToImport.length} calificaciones importadas correctamente`, 'success');
      renderResultSummary(rowsToImport.length);
    } catch (err) {
      Toast.show('Error al importar: ' + err.message, 'error');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = 'Importar Calificaciones';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Result summary
  // ---------------------------------------------------------------------------

  function renderResultSummary(count) {
    const el = document.getElementById('ig-result');
    if (!el) return;

    const { turno, grado, parcial } = getFilterValues();
    const grupoSelect = document.getElementById('ig-grupo');
    const materiaSelect = document.getElementById('ig-materia');
    const grupoName = grupoSelect?.selectedOptions?.[0]?.textContent || '';
    const materiaName = materiaSelect?.selectedOptions?.[0]?.textContent || '';
    const parcialObj = K.PARCIALES.find(p => p.id === parcial);
    const parcialName = parcialObj ? parcialObj.nombre : parcial;

    // Hide previous steps
    ['ig-step-upload', 'ig-step-mapping', 'ig-step-matching'].forEach(id => {
      const step = document.getElementById(id);
      if (step) step.classList.add('hidden');
    });

    el.innerHTML = `
      <div class="card">
        <h2 class="module-subtitle">Importacion completada</h2>

        <div class="stats-grid">
          <div class="stat-card--compact">
            <div class="stat-label">Calificaciones importadas</div>
            <div class="stat-number">${count}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Turno</div>
            <div class="stat-number">${Utils.sanitize(turno)}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Grupo</div>
            <div class="stat-number">${Utils.sanitize(grupoName)}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Materia</div>
            <div class="stat-number">${Utils.sanitize(materiaName)}</div>
          </div>
          <div class="stat-card--compact">
            <div class="stat-label">Parcial</div>
            <div class="stat-number">${Utils.sanitize(parcialName)}</div>
          </div>
        </div>

        <div class="filter-bar-actions">
          <button class="btn btn-primary" data-action="reset-all">Nueva importacion</button>
        </div>
      </div>
    `;
    el.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  function resetAll() {
    resetState();
    render();
  }

  // ---------------------------------------------------------------------------
  // Event delegation
  // ---------------------------------------------------------------------------

  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === 'show-upload') {
        const { turno, grado, grupo, materia, parcial } = getFilterValues();
        if (!turno || !grado || !grupo || !materia || !parcial) {
          Toast.show('Completa todos los filtros antes de continuar', 'error');
          return;
        }
        renderUploadStep();
      } else if (action === 'process-matching') {
        processMatching();
      } else if (action === 'import-grades') {
        importGrades();
      } else if (action === 'reset-all') {
        resetAll();
      }
    });

    container.addEventListener('change', (e) => {
      const target = e.target;

      if (target.id === 'ig-turno') {
        // Reset grado, grupo, materia
        const gradoSel = document.getElementById('ig-grado');
        if (gradoSel) gradoSel.value = '';
        updateGroupOptions();
        updateSubjectOptions();
        hideStepsFrom('upload');
      } else if (target.id === 'ig-grado') {
        // Reset grupo and materia, update both
        updateGroupOptions();
        updateSubjectOptions();
        hideStepsFrom('upload');
      } else if (target.id === 'ig-grupo' || target.id === 'ig-materia' || target.id === 'ig-parcial') {
        hideStepsFrom('upload');
      } else if (target.id === 'ig-file') {
        const file = target.files?.[0];
        if (file) handleFileUpload(file);
      }
    });
  }

  function hideStepsFrom(step) {
    const steps = ['upload', 'mapping', 'matching', 'result'];
    const startIdx = steps.indexOf(step);
    if (startIdx < 0) return;

    steps.slice(startIdx).forEach(s => {
      const el = document.getElementById('ig-step-' + s);
      if (el) {
        el.classList.add('hidden');
        el.innerHTML = '';
      }
    });

    // Also hide result
    const resultEl = document.getElementById('ig-result');
    if (resultEl && startIdx <= steps.indexOf('result')) {
      resultEl.classList.add('hidden');
      resultEl.innerHTML = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return { render };
})();

Router.modules['import-grades'] = () => ImportGradesModule.render();
