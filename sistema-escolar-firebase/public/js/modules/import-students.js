/**
 * IMPORT STUDENTS MODULE
 * Import/update student data from official Excel lists
 * Matches by CURP (exact), then expediente, then name (fuzzy)
 */

const ImportStudentsModule = (() => {
  let parsedRows = [];
  let matchResults = [];
  let existingStudents = [];

  function normalizeName(name) {
    return (name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    existingStudents = await Store.getStudents();

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Importar Datos de Listas Oficiales</h1>
            <p class="module-subtitle">Actualiza expedientes, folios, CURP y datos faltantes desde archivos Excel oficiales</p>
          </div>
        </div>

        <div class="card">
          <div class="form-group">
            <label>Archivo Excel de lista oficial (.xlsx)</label>
            <input type="file" id="importFile" accept=".xlsx,.xls">
          </div>
          <p class="text-muted" style="font-size:var(--font-size-xs)">El sistema buscar\u00e1 coincidencias por CURP, expediente o nombre y actualizar\u00e1 los campos faltantes.</p>
        </div>

        <div id="importPreview"></div>
        <div id="importActions"></div>
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    document.getElementById('moduleContainer').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'execute-import') {
        await executeImport();
      } else if (btn.dataset.action === 'reset-import') {
        parsedRows = [];
        matchResults = [];
        render();
      }
    });

    document.getElementById('importFile')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const data = await Utils.parseExcelFile(file);
        parsedRows = data;
        processAndMatch();
      } catch (error) {
        Toast.show('Error leyendo archivo: ' + error.message, 'error');
      }
    });
  }

  function processAndMatch() {
    if (parsedRows.length === 0) return;

    // Detect columns
    const firstRow = parsedRows[0];
    const keys = Object.keys(firstRow);

    const nameCol = keys.find(k => /nombre|alumno|estudiante/i.test(k)) || keys[0];
    const curpCol = keys.find(k => /curp/i.test(k));
    const expCol = keys.find(k => /expediente|exp/i.test(k));
    const folioCol = keys.find(k => /folio/i.test(k));
    const apellido1Col = keys.find(k => /apellido.*paterno|primer.*apellido|ap.*pat/i.test(k));
    const apellido2Col = keys.find(k => /apellido.*materno|segundo.*apellido|ap.*mat/i.test(k));
    const nombresCol = keys.find(k => /^nombres?$/i.test(k));

    matchResults = parsedRows.map(row => {
      const excelName = String(row[nameCol] || '').trim();
      const excelCurp = curpCol ? String(row[curpCol] || '').trim() : '';
      const excelExp = expCol ? String(row[expCol] || '').trim() : '';
      const excelFolio = folioCol ? String(row[folioCol] || '').trim() : '';
      const excelAp1 = apellido1Col ? String(row[apellido1Col] || '').trim() : '';
      const excelAp2 = apellido2Col ? String(row[apellido2Col] || '').trim() : '';
      const excelNombres = nombresCol ? String(row[nombresCol] || '').trim() : '';

      let matched = null;
      let matchType = 'none';

      // Match by CURP (exact)
      if (excelCurp) {
        matched = existingStudents.find(s => (s.curp || '').toUpperCase() === excelCurp.toUpperCase());
        if (matched) matchType = 'curp';
      }

      // Match by expediente
      if (!matched && excelExp) {
        matched = existingStudents.find(s => (s.expediente || '') === excelExp);
        if (matched) matchType = 'expediente';
      }

      // Match by name (fuzzy)
      if (!matched && excelName) {
        const normalizedExcel = normalizeName(excelName);
        matched = existingStudents.find(s => {
          const normalizedStudent = normalizeName(s.nombreCompleto);
          return normalizedStudent === normalizedExcel || normalizedStudent.includes(normalizedExcel) || normalizedExcel.includes(normalizedStudent);
        });
        if (matched) matchType = 'nombre';
      }

      return {
        excelName, excelCurp, excelExp, excelFolio, excelAp1, excelAp2, excelNombres,
        matched, matchType,
        fieldsToUpdate: matched ? getFieldsToUpdate(matched, { curp: excelCurp, expediente: excelExp, folio: excelFolio, apellido1: excelAp1, apellido2: excelAp2, nombres: excelNombres }) : {}
      };
    });

    renderPreview();
  }

  function getFieldsToUpdate(student, excelData) {
    const updates = {};
    if (excelData.curp && !student.curp) updates.curp = excelData.curp;
    if (excelData.expediente && !student.expediente) updates.expediente = excelData.expediente;
    if (excelData.folio && !student.folio) updates.folio = excelData.folio;
    if (excelData.apellido1 && !student.apellido1) updates.apellido1 = excelData.apellido1;
    if (excelData.apellido2 && !student.apellido2) updates.apellido2 = excelData.apellido2;
    if (excelData.nombres && !student.nombres) updates.nombres = excelData.nombres;
    return updates;
  }

  function renderPreview() {
    const preview = document.getElementById('importPreview');
    const actions = document.getElementById('importActions');

    const matchedCount = matchResults.filter(r => r.matched).length;
    const unmatchedCount = matchResults.filter(r => !r.matched).length;
    const updatableCount = matchResults.filter(r => r.matched && Object.keys(r.fieldsToUpdate).length > 0).length;

    const rows = matchResults.map((r, i) => {
      const statusBadge = r.matched
        ? `<span class="badge badge-success">${r.matchType.toUpperCase()}</span>`
        : '<span class="badge badge-danger">Sin coincidencia</span>';
      const updateFields = r.matched ? Object.keys(r.fieldsToUpdate).join(', ') || 'Sin campos nuevos' : '-';

      return `
        <tr>
          <td>${i + 1}</td>
          <td class="font-semibold">${Utils.sanitize(r.excelName)}</td>
          <td>${r.matched ? Utils.sanitize(r.matched.nombreCompleto) : '<span class="text-danger">-</span>'}</td>
          <td>${statusBadge}</td>
          <td class="text-muted">${Utils.sanitize(updateFields)}</td>
        </tr>
      `;
    }).join('');

    preview.innerHTML = `
      <div class="stats-grid mt-lg">
        <div class="stat-card--bordered success">
          <div class="stat-label">Coincidencias</div>
          <div class="stat-number text-success">${matchedCount}</div>
        </div>
        <div class="stat-card--bordered danger">
          <div class="stat-label">Sin coincidencia</div>
          <div class="stat-number text-danger">${unmatchedCount}</div>
        </div>
        <div class="stat-card--bordered">
          <div class="stat-label">Con campos a actualizar</div>
          <div class="stat-number">${updatableCount}</div>
        </div>
      </div>

      <div class="table-container mt-lg">
        <table class="table-light">
          <thead>
            <tr>
              <th>#</th>
              <th>Nombre en Excel</th>
              <th>Alumno en Sistema</th>
              <th>Coincidencia</th>
              <th>Campos a Actualizar</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    actions.innerHTML = updatableCount > 0 ? `
      <div class="flex gap-md mt-lg justify-center">
        <button class="btn btn-success" data-action="execute-import">Importar ${updatableCount} Actualizaciones</button>
        <button class="btn btn-outline" data-action="reset-import">Limpiar</button>
      </div>
    ` : `
      <div class="flex gap-md mt-lg justify-center">
        <p class="text-muted">No hay campos nuevos para actualizar.</p>
        <button class="btn btn-outline" data-action="reset-import">Limpiar</button>
      </div>
    `;
  }

  async function executeImport() {
    const toUpdate = matchResults.filter(r => r.matched && Object.keys(r.fieldsToUpdate).length > 0);
    if (toUpdate.length === 0) {
      Toast.show('No hay datos para importar', 'warning');
      return;
    }

    try {
      // Firestore limita batch a 500 ops. Chunk de 400 (margen seguro).
      const CHUNK = 400;
      let count = 0;
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const chunk = toUpdate.slice(i, i + CHUNK);
        const batch = db.batch();
        chunk.forEach(r => {
          const ref = db.collection('students').doc(r.matched.id);
          batch.update(ref, r.fieldsToUpdate);
          count++;
        });
        await batch.commit();
      }

      DB.audit('importar', 'alumno', '', {
        description: `Importación masiva: ${count} alumnos actualizados desde Excel`,
        extra: { count, source: 'excel_lista_oficial' }
      });
      Store.invalidate('students');
      Toast.show(`${count} alumnos actualizados exitosamente`, 'success');

      // Reset
      parsedRows = [];
      matchResults = [];
      existingStudents = await Store.getStudents(true);
      render();
    } catch (error) {
      console.error('Error importing:', error);
      Toast.show('Error al importar: ' + error.message, 'error');
    }
  }

  return { render };
})();

Router.modules['import-students'] = () => ImportStudentsModule.render();
