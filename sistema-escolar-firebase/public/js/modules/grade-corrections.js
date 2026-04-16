/**
 * MODULO: CORRECCIONES DE CALIFICACIONES v2
 * EPO 67 — Sistema Escolar
 *
 * Solo directivos y admin. Filtros cascada hasta alumno.
 * Correcciones resaltadas en ambar. Deshacer disponible.
 * Concentrado imprimible auto-generado. Bitacora + email a directivos.
 */

const GradeCorrectionsModule = (function () {
  const CONTAINER = '#moduleContainer';
  const AMBER = '#b7791f';
  const AMBER_BG = 'rgba(183,121,31,0.12)';

  let _students = [], _groups = [], _subjects = [], _assignments = [], _partials = [];
  let _grades = [], _corrections = [], _correctionWindow = null;

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;
    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando...')}</div>`;

    try {
      const [students, groups, subjects, assignments, partials] = await Promise.all([
        Store.getStudents(), Store.getGroups(), Store.getSubjects(),
        Store.getAssignments(), Store.getPartials()
      ]);
      _students = students.filter(s => s.estatus === 'ACTIVO');
      _groups = groups; _subjects = subjects; _assignments = assignments; _partials = partials;

      const turnoOpts = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
      const gradoOpts = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba</option>`).join('');
      const parcialOpts = K.PARCIALES.map(p => {
        const doc = partials.find(pp => pp.id === p.id);
        const tag = doc?.locked ? ' (Cerrado)' : ' (Abierto)';
        return `<option value="${p.id}">${p.nombre}${tag}</option>`;
      }).join('');

      container.innerHTML = `
        <div class="module-container">
          ${UI.pageHeader('Correcciones de Calificaciones', 'Registro oficial de modificaciones — Solo direccion')}
          <div class="card filter-bar">
            <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));">
              <div class="form-group"><label>Turno</label>
                <select id="gc-turno"><option value="">Turno</option>${turnoOpts}</select></div>
              <div class="form-group"><label>Grado</label>
                <select id="gc-grado" disabled><option value="">Grado</option>${gradoOpts}</select></div>
              <div class="form-group"><label>Grupo</label>
                <select id="gc-grupo" disabled><option value="">Grupo</option></select></div>
              <div class="form-group"><label>Parcial</label>
                <select id="gc-parcial" disabled><option value="">Parcial</option>${parcialOpts}</select></div>
              <div class="form-group"><label>Materia</label>
                <select id="gc-materia" disabled><option value="">Materia</option></select></div>
              <div class="form-group"><label>Alumno</label>
                <select id="gc-alumno" disabled><option value="">Alumno</option></select></div>
            </div>
          </div>
          <div id="gc-window-status"></div>
          <div id="gc-content"></div>
          <div id="gc-history"></div>

          <!-- ═══ REPORTE CONCENTRADO POR TURNO ═══ -->
          <div class="card" style="margin-top:24px;border-top:3px solid ${AMBER};">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h3 class="section-title" style="margin:0;">
                <span class="material-icons-round" style="vertical-align:middle;font-size:20px;color:${AMBER};">summarize</span>
                Reporte Concentrado de Correcciones por Turno
              </h3>
            </div>
            <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:12px;">
              <div class="form-group"><label>Turno</label>
                <select id="gc-rpt-turno"><option value="">Selecciona turno</option>${turnoOpts}</select></div>
              <div class="form-group"><label>Parcial</label>
                <select id="gc-rpt-parcial"><option value="">Selecciona parcial</option>${parcialOpts}</select></div>
              <div class="form-group" style="display:flex;align-items:flex-end;">
                <button class="btn btn-sm" style="background:${AMBER};color:#fff;" id="gc-rpt-generate">
                  <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">search</span> Consultar
                </button>
              </div>
            </div>
            <div id="gc-rpt-content"></div>
          </div>
        </div>`;
      _bindFilters();
      _bindReportFilters();
    } catch (e) {
      console.error('Error:', e);
      container.innerHTML = `<div class="module-container">${UI.emptyState('error', e.message)}</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CASCADE FILTERS
  // ═══════════════════════════════════════════════════════════════
  function _bindFilters() {
    const els = { turno: _el('gc-turno'), grado: _el('gc-grado'), grupo: _el('gc-grupo'),
                  parcial: _el('gc-parcial'), materia: _el('gc-materia'), alumno: _el('gc-alumno') };

    els.turno.addEventListener('change', () => {
      _resetFrom('grado'); if (!els.turno.value) return;
      els.grado.disabled = false;
    });
    els.grado.addEventListener('change', () => {
      _resetFrom('grupo'); if (!els.grado.value) return;
      const filtered = _groups.filter(g => g.turno === els.turno.value && String(g.grado) === String(els.grado.value))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      els.grupo.innerHTML = '<option value="">Grupo</option>' +
        filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
      els.grupo.disabled = false;
    });
    els.grupo.addEventListener('change', () => {
      _resetFrom('parcial'); if (!els.grupo.value) return;
      els.parcial.disabled = false;
    });
    els.parcial.addEventListener('change', () => {
      _resetFrom('materia'); if (!els.parcial.value) return;
      // Check window
      const partialDoc = _partials.find(p => p.id === els.parcial.value);
      _correctionWindow = K.getCorrectionWindow(partialDoc);
      _showWindowStatus(partialDoc);
      // Populate materias for this group
      const groupAsgs = _assignments.filter(a => a.groupId === els.grupo.value);
      const subIds = [...new Set(groupAsgs.map(a => a.subjectId))];
      const subs = _subjects.filter(s => subIds.includes(s.id)).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      els.materia.innerHTML = '<option value="">Materia</option>' +
        subs.map(s => `<option value="${s.id}">${Utils.sanitize(K.getUACNombre(s.nombre))}</option>`).join('');
      els.materia.disabled = false;
    });
    els.materia.addEventListener('change', () => {
      _resetFrom('alumno'); if (!els.materia.value) return;
      // Populate alumnos
      const groupStudents = _students.filter(s => s.groupId === els.grupo.value)
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      els.alumno.innerHTML = '<option value="">Selecciona alumno</option><option value="__todos__">--- Lista completa ---</option>' +
        groupStudents.map(s => `<option value="${s.id}">${Utils.sanitize(s.nombreCompleto)}</option>`).join('');
      els.alumno.disabled = false;
    });
    els.alumno.addEventListener('change', () => {
      _clearEl('gc-content'); if (!els.alumno.value) return;
      _loadView();
    });
  }

  function _el(id) { return document.getElementById(id); }
  function _clearEl(id) { const e = _el(id); if (e) e.innerHTML = ''; }
  function _resetFrom(level) {
    const order = ['grado', 'grupo', 'parcial', 'materia', 'alumno'];
    const idx = order.indexOf(level);
    for (let i = idx; i < order.length; i++) {
      const el = _el('gc-' + order[i]);
      if (!el) continue;
      if (order[i] !== 'grado' && order[i] !== 'parcial') el.innerHTML = `<option value="">${el.querySelector('option')?.textContent || ''}</option>`;
      el.disabled = true;
    }
    _clearEl('gc-content'); _clearEl('gc-history'); _clearEl('gc-window-status');
  }

  function _showWindowStatus(partialDoc) {
    const ws = _el('gc-window-status');
    if (!ws) return;
    if (!partialDoc || !partialDoc.locked) {
      ws.innerHTML = `<div class="card" style="border-left:4px solid var(--color-warning);margin-bottom:16px;">
        <span class="material-icons-round" style="color:var(--color-warning);vertical-align:middle;">info</span>
        Este parcial aun esta abierto. Las correcciones solo se pueden hacer despues de cerrar el parcial.</div>`;
      return;
    }
    if (_correctionWindow.open) {
      ws.innerHTML = `<div class="card" style="border-left:4px solid var(--color-success);margin-bottom:16px;">
        <span class="material-icons-round" style="color:var(--color-success);vertical-align:middle;">check_circle</span>
        <strong>Periodo de correccion abierto.</strong> Quedan ${_correctionWindow.daysLeft} dia(s).
        Fecha limite: ${_correctionWindow.deadline.toLocaleDateString('es-MX')}</div>`;
    } else {
      ws.innerHTML = `<div class="card" style="border-left:4px solid var(--color-danger);margin-bottom:16px;">
        <span class="material-icons-round" style="color:var(--color-danger);vertical-align:middle;">block</span>
        <strong>Periodo de correccion cerrado.</strong> Ya pasaron los 3 dias habiles.</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // LOAD VIEW — single student or full list
  // ═══════════════════════════════════════════════════════════════
  async function _loadView() {
    const content = _el('gc-content');
    const historyDiv = _el('gc-history');
    if (!content) return;
    content.innerHTML = UI.loadingState('Cargando...');
    if (historyDiv) historyDiv.innerHTML = '';

    const groupId = _el('gc-grupo').value;
    const partial = _el('gc-parcial').value;
    const subjectId = _el('gc-materia').value;
    const alumnoVal = _el('gc-alumno').value;

    try {
      const [gradesList, corrSnap] = await Promise.all([
        Store.getGradesByGroup(groupId),
        db.collection('gradeCorrections').where('groupId', '==', groupId).where('partial', '==', partial).get()
      ]);

      _grades = gradesList.filter(g => g.partial === partial && g.subjectId === subjectId);
      _corrections = [];
      corrSnap.forEach(d => _corrections.push({ id: d.id, ...d.data() }));

      // Grade map: studentId -> cal
      const gradeMap = {};
      _grades.forEach(g => {
        const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? g.value : null);
        gradeMap[g.studentId] = cal;
      });

      // Correction set for this subject
      const corrForSubject = _corrections.filter(c => c.subjectId === subjectId);
      const correctedStudentIds = new Set(corrForSubject.map(c => c.studentId));

      // Students to show
      let studentList;
      if (alumnoVal === '__todos__') {
        studentList = _students.filter(s => s.groupId === groupId)
          .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      } else {
        studentList = _students.filter(s => s.id === alumnoVal);
      }

      const subject = _subjects.find(s => s.id === subjectId);
      const subjectName = K.getUACNombre(subject?.nombre || subjectId);
      const partialDoc = _partials.find(p => p.id === partial);
      const canCorrect = _correctionWindow?.open && partialDoc?.locked;

      // Build table
      const rows = studentList.map((st, idx) => {
        const cal = gradeMap[st.id];
        const wasCorrected = correctedStudentIds.has(st.id);
        const corr = corrForSubject.find(c => c.studentId === st.id);
        const rowStyle = wasCorrected ? `background:${AMBER_BG};border-left:3px solid ${AMBER};` : '';
        const calDisplay = cal !== null && cal !== undefined ? cal : '-';
        const calStyle = cal !== null && cal < 6 ? 'color:var(--color-danger);font-weight:700;' : 'font-weight:600;';

        let actionCell = '';
        if (wasCorrected && corr) {
          actionCell = `
            <td style="text-align:center;">
              <span style="color:${AMBER};font-weight:700;font-size:11px;">Corregida: ${corr.oldCal} → ${corr.newCal}</span><br>
              <span class="text-muted" style="font-size:10px;">${Utils.sanitize(corr.motivo || '')}</span>
            </td>
            <td style="text-align:center;">
              ${canCorrect ? `<button class="btn btn-outline btn-sm" style="color:var(--color-danger);border-color:var(--color-danger);font-size:11px;" data-action="undo" data-correction-id="${corr.id}" data-student-id="${st.id}" data-old-cal="${corr.oldCal}" data-student-name="${Utils.sanitize(st.nombreCompleto)}">
                <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">undo</span> Deshacer
              </button>` : ''}
            </td>`;
        } else if (cal !== null && cal !== undefined && canCorrect && cal < 10) {
          actionCell = `
            <td colspan="2" style="text-align:center;">
              <button class="btn btn-sm" style="background:${AMBER};color:#fff;font-size:11px;" data-action="correct"
                data-student-id="${st.id}" data-student-name="${Utils.sanitize(st.nombreCompleto)}"
                data-subject-id="${subjectId}" data-subject-name="${Utils.sanitize(subjectName)}"
                data-current-cal="${cal}">
                <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit</span> Corregir
              </button>
            </td>`;
        } else {
          actionCell = '<td colspan="2"></td>';
        }

        return `<tr style="${rowStyle}">
          <td style="text-align:center;" class="text-muted">${idx + 1}</td>
          <td class="font-semibold" style="font-size:13px;">${Utils.sanitize(st.nombreCompleto)}</td>
          <td style="text-align:center;font-size:16px;${calStyle}">${calDisplay}</td>
          ${actionCell}
        </tr>`;
      }).join('');

      content.innerHTML = `
        <div class="card" style="margin-top:16px;">
          <h3 class="section-title">${Utils.sanitize(subjectName)}${alumnoVal !== '__todos__' ? '' : ' — Lista completa'}</h3>
          <div class="table-container" style="overflow-x:auto;">
            <table class="table-light" style="font-size:13px;">
              <thead><tr>
                <th style="width:35px;text-align:center;">#</th>
                <th>Alumno</th>
                <th style="width:70px;text-align:center;">Cal. Actual</th>
                <th style="text-align:center;">Estado / Correccion</th>
                <th style="width:100px;text-align:center;">Accion</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;

      // History for this group+partial (all subjects)
      _renderHistory(historyDiv);

      // Bind actions
      content.addEventListener('click', (e) => {
        const correctBtn = e.target.closest('[data-action="correct"]');
        if (correctBtn) {
          _openCorrectionModal(correctBtn.dataset.studentId, correctBtn.dataset.studentName,
            correctBtn.dataset.subjectId, correctBtn.dataset.subjectName, parseInt(correctBtn.dataset.currentCal));
          return;
        }
        const undoBtn = e.target.closest('[data-action="undo"]');
        if (undoBtn) {
          _undoCorrection(undoBtn.dataset.correctionId, undoBtn.dataset.studentId,
            undoBtn.dataset.studentName, parseInt(undoBtn.dataset.oldCal));
        }
      });
    } catch (e) {
      console.error('Error:', e);
      content.innerHTML = UI.emptyState('error', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HISTORY + PRINT
  // ═══════════════════════════════════════════════════════════════
  function _renderHistory(div) {
    if (!div) return;
    const allCorr = _corrections.sort((a, b) => {
      const da = a.correctedAt?.toDate ? a.correctedAt.toDate() : new Date(0);
      const db2 = b.correctedAt?.toDate ? b.correctedAt.toDate() : new Date(0);
      return db2 - da;
    });
    if (allCorr.length === 0) { div.innerHTML = ''; return; }

    const rows = allCorr.map((c, i) => {
      const date = c.correctedAt?.toDate ? c.correctedAt.toDate() : new Date(0);
      return `<tr style="background:${AMBER_BG};">
        <td>${i + 1}</td>
        <td class="font-semibold">${Utils.sanitize(c.studentName || '')}</td>
        <td style="font-size:12px;">${Utils.sanitize(c.subjectName || '')}</td>
        <td style="text-align:center;text-decoration:line-through;color:var(--color-danger);">${c.oldCal}</td>
        <td style="text-align:center;font-weight:700;color:${AMBER};">${c.newCal}</td>
        <td style="font-size:12px;">${Utils.sanitize(c.motivo || '')}</td>
        <td style="font-size:12px;">${date.toLocaleDateString('es-MX')}</td>
        <td style="font-size:12px;">${Utils.sanitize(c.correctedByName || '')}</td>
      </tr>`;
    }).join('');

    div.innerHTML = `
      <div class="card" style="margin-top:16px;border:2px solid ${AMBER};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 class="section-title" style="margin:0;color:${AMBER};">
            <span class="material-icons-round" style="vertical-align:middle;font-size:20px;">rate_review</span>
            Concentrado de Correcciones (${allCorr.length})
          </h3>
          <button class="btn btn-sm" style="background:${AMBER};color:#fff;" data-action="print-concentrado">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">print</span> Imprimir
          </button>
        </div>
        <div class="table-container" style="overflow-x:auto;">
          <table class="table-light" style="font-size:13px;">
            <thead><tr>
              <th style="width:30px;">#</th><th>Alumno</th><th>Materia</th>
              <th style="text-align:center;width:55px;">Dice</th>
              <th style="text-align:center;width:70px;">Debe decir</th>
              <th>Motivo</th><th style="width:85px;">Fecha</th><th>Autorizo</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    div.querySelector('[data-action="print-concentrado"]')?.addEventListener('click', _printConcentrado);
  }

  // ═══════════════════════════════════════════════════════════════
  // CORRECTION MODAL
  // ═══════════════════════════════════════════════════════════════
  function _openCorrectionModal(studentId, studentName, subjectId, subjectName, currentCal) {
    const motivoOptions = [
      'Error de captura del docente',
      'Entrega extemporanea autorizada',
      'Evaluacion complementaria aplicada',
      'Trabajo extra autorizado por orientacion',
      'Revision de examen procedente',
      'Justificacion de inasistencias presentada',
      'Error en calculo de rubros'
    ].map(m => `<option value="${m}">${m}</option>`).join('');

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;gap:24px;">
          <div><label class="text-muted" style="font-size:11px;">Alumno</label><div class="font-semibold">${Utils.sanitize(studentName)}</div></div>
          <div><label class="text-muted" style="font-size:11px;">Materia</label><div class="font-semibold">${Utils.sanitize(subjectName)}</div></div>
          <div><label class="text-muted" style="font-size:11px;">Cal. actual</label><div style="font-size:22px;font-weight:700;color:var(--color-danger);">${currentCal}</div></div>
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Nueva calificacion *</label>
          <input type="number" id="gc-new-cal" min="${currentCal + 1}" max="10" step="1" placeholder="Mayor a ${currentCal}" style="font-size:18px;font-weight:700;text-align:center;">
          <small class="text-muted">Min ${currentCal + 1}, max 10</small>
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Motivo *</label>
          <select id="gc-motivo-select" style="width:100%;">
            <option value="">Selecciona el motivo...</option>
            ${motivoOptions}
            <option value="__otro__">Otro (especificar)</option>
          </select>
        </div>
        <div class="form-group" id="gc-motivo-otro-wrap" style="display:none;">
          <label style="font-weight:600;">Especifique el motivo *</label>
          <textarea id="gc-motivo-otro" rows="2" placeholder="Describa con claridad..." style="width:100%;"></textarea>
        </div>
      </div>`;

    Modal.open('Correccion de Calificacion', bodyHtml,
      `<button class="btn btn-outline" data-action="close-modal">Cancelar</button>
       <button class="btn" id="gc-save-btn" style="background:${AMBER};color:#fff;">
         <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">check</span> Autorizar
       </button>`);

    _el('gc-new-cal')?.focus();
    _el('gc-motivo-select')?.addEventListener('change', function () {
      const w = _el('gc-motivo-otro-wrap');
      if (w) w.style.display = this.value === '__otro__' ? '' : 'none';
    });

    let _saving = false;
    _el('modalFooter').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="close-modal"]')) { Modal.close(); return; }
      if (!e.target.closest('#gc-save-btn')) return;
      if (_saving) return; // Prevent double-click

      const newCal = parseInt(_el('gc-new-cal').value);
      const motivoSel = _el('gc-motivo-select').value;
      const motivoOtro = (_el('gc-motivo-otro')?.value || '').trim();
      const motivo = motivoSel === '__otro__' ? motivoOtro : motivoSel;

      if (!newCal || isNaN(newCal)) { Toast.show('Ingresa la nueva calificacion', 'warning'); return; }
      if (newCal <= currentCal) { Toast.show('Debe ser mayor a ' + currentCal, 'error'); return; }
      if (newCal > 10) { Toast.show('Maximo 10', 'error'); return; }
      if (!motivoSel) { Toast.show('Selecciona un motivo', 'warning'); return; }
      if (motivoSel === '__otro__' && !motivoOtro) { Toast.show('Especifica el motivo', 'warning'); return; }

      _saving = true;
      const saveBtn = _el('gc-save-btn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:16px;">autorenew</span>';

      try {
        const groupId = _el('gc-grupo').value;
        const partial = _el('gc-parcial').value;
        const grupo = _groups.find(g => g.id === groupId);

        await db.collection('gradeCorrections').add({
          studentId, studentName, subjectId, subjectName,
          groupId, groupName: grupo?.nombre || groupId, turno: grupo?.turno || '',
          partial, oldCal: currentCal, newCal, motivo,
          correctedBy: auth.currentUser.uid,
          correctedByName: App.currentUser?.displayName || App.currentUser?.email || '',
          correctedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const gradeDocId = `${studentId}_${subjectId}_${partial}`;
        await db.collection('grades').doc(gradeDocId).set({
          cal: newCal, value: newCal, updatedAt: new Date(), updatedBy: auth.currentUser.uid
        }, { merge: true });

        Store.invalidateGradesForGroup(groupId);

        DB.audit('correccion', 'calificacion', gradeDocId, {
          description: `Correccion: ${studentName} - ${subjectName} - ${partial}: ${currentCal} -> ${newCal}`,
          extra: { oldCal: currentCal, newCal, motivo }
        });

        // Email notification to directivos (fire-and-forget)
        _notifyDirectivos(studentName, subjectName, grupo?.nombre || groupId, partial, currentCal, newCal, motivo);

        Modal.close();
        Toast.show(`Correccion aplicada: ${currentCal} → ${newCal}`, 'success');
        _loadView();
      } catch (err) {
        console.error('Error:', err);
        Toast.show('Error: ' + err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px;vertical-align:middle;">check</span> Autorizar';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // UNDO CORRECTION
  // ═══════════════════════════════════════════════════════════════
  async function _undoCorrection(correctionId, studentId, studentName, oldCal) {
    if (!confirm(`¿Deshacer la correccion de ${studentName}?\nSe restaurara la calificacion anterior: ${oldCal}`)) return;

    try {
      const subjectId = _el('gc-materia').value;
      const partial = _el('gc-parcial').value;
      const groupId = _el('gc-grupo').value;

      // Restore original grade
      const gradeDocId = `${studentId}_${subjectId}_${partial}`;
      await db.collection('grades').doc(gradeDocId).set({
        cal: oldCal, value: oldCal, updatedAt: new Date(), updatedBy: auth.currentUser.uid
      }, { merge: true });

      // Delete correction record
      await db.collection('gradeCorrections').doc(correctionId).delete();

      Store.invalidateGradesForGroup(groupId);

      DB.audit('deshacer_correccion', 'calificacion', gradeDocId, {
        description: `Correccion deshecha: ${studentName} - ${partial}: restaurada a ${oldCal}`,
        extra: { restoredCal: oldCal }
      });

      Toast.show(`Correccion deshecha. Calificacion restaurada a ${oldCal}`, 'info');
      _loadView();
    } catch (err) {
      console.error('Error undoing:', err);
      Toast.show('Error al deshacer: ' + err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EMAIL NOTIFICATION TO DIRECTIVOS
  // ═══════════════════════════════════════════════════════════════
  async function _notifyDirectivos(studentName, subjectName, groupName, partial, oldCal, newCal, motivo) {
    try {
      const usersSnap = await db.collection('users').where('role', '==', 'directivo').get();
      const emails = [];
      usersSnap.forEach(d => { if (d.data().email) emails.push(d.data().email); });
      if (emails.length === 0) return;

      // Store notification for future email integration
      await db.collection('notifications').add({
        type: 'grade_correction',
        recipients: emails,
        subject: `Correccion de calificacion — ${studentName}`,
        body: `Se realizo una correccion de calificacion:\n\nAlumno: ${studentName}\nMateria: ${subjectName}\nGrupo: ${groupName}\nParcial: ${partial}\nCalificacion anterior: ${oldCal}\nCalificacion nueva: ${newCal}\nMotivo: ${motivo}\n\nAutorizado por: ${App.currentUser?.displayName || App.currentUser?.email || ''}`,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sent: false
      });
    } catch (e) {
      console.warn('Error creating notification:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRINT CONCENTRADO
  // ═══════════════════════════════════════════════════════════════
  function _printConcentrado() {
    if (_corrections.length === 0) { Toast.show('No hay correcciones', 'warning'); return; }

    const groupId = _el('gc-grupo').value;
    const partial = _el('gc-parcial').value;
    const turno = _el('gc-turno').value;
    const grado = _el('gc-grado').value;
    const grupo = _groups.find(g => g.id === groupId);
    const groupName = grupo?.nombre || groupId;
    const parcMap = { P1: 'PRIMER', P2: 'SEGUNDO', P3: 'TERCER' };
    const parcialText = parcMap[partial] || 'PRIMER';
    const semMap = { '1': 'SEGUNDO SEMESTRE', '2': 'CUARTO SEMESTRE', '3': 'SEXTO SEMESTRE' };
    const semText = semMap[String(grado)] || '';
    const orientador = K.getOrientador(turno, groupName) || '';

    const sorted = [..._corrections].sort((a, b) => (a.studentName || '').localeCompare(b.studentName || ''));
    const rows = sorted.map((c, i) => {
      const date = c.correctedAt?.toDate ? c.correctedAt.toDate() : new Date(0);
      const bg = i % 2 === 1 ? ' style="background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"' : '';
      return `<tr${bg}>
        <td class="c">${i + 1}</td>
        <td class="b">${Utils.sanitize(c.studentName)}</td>
        <td>${Utils.sanitize(c.subjectName)}</td>
        <td class="c b">${c.oldCal}</td>
        <td class="c b">${c.newCal}</td>
        <td>${Utils.sanitize(c.motivo)}</td>
        <td class="c">${date.toLocaleDateString('es-MX')}</td>
        <td>${Utils.sanitize(c.correctedByName)}</td>
        <td></td>
      </tr>`;
    }).join('');

    let blankRows = '';
    for (let i = sorted.length; i < sorted.length + 5; i++) {
      const bg = i % 2 === 1 ? ' style="background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"' : '';
      blankRows += `<tr${bg}><td class="c">${i + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
    }

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    const html = `
<style>
@page { size: letter landscape; margin: 12mm 10mm 10mm 10mm; }
html, body { margin:0; padding:0; font-family:Arial,Helvetica,sans-serif; color:#000; }
.hdr-t { width:100%; margin-bottom:3mm; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:8mm; width:auto; }
.hdr-r { text-align:right; font-size:8pt; line-height:1.3; color:#333; }
h1 { font-size:14pt; text-align:center; margin:4px 0 2px 0; }
h2 { font-size:11pt; text-align:center; margin:0 0 8px 0; font-weight:400; color:#444; }
.nfo { width:100%; font-size:10pt; border:1pt solid #000; border-collapse:collapse; margin-bottom:10px; }
.nfo td { border:1pt solid #000; padding:5px 8px; line-height:1.3; }
.nfo .lb { color:#555; font-size:9pt; }
.nfo .vl { font-weight:700; }
table.main { width:100%; border-collapse:collapse; font-size:10pt; }
table.main th { background:#1a202c; color:#fff; padding:7px 8px; font-size:9pt; text-align:left;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
table.main td { padding:6px 8px; border:0.5pt solid #888; line-height:1.35; }
table.main tr { min-height:30px; }
.c { text-align:center; }
.b { font-weight:700; }
.sigs { margin-top:18mm; }
.sigs table { width:100%; }
.sigs td { width:50%; text-align:center; padding:0 12px; vertical-align:bottom; }
.sigs .line { border-top:1pt solid #000; margin-top:18mm; padding-top:4px; font-weight:700; font-size:10pt; }
.sigs .nm { font-size:9pt; color:#333; }
.ftr { margin-top:6mm; }
.ftr img { width:100%; max-height:4mm; display:block; }
.ftr-t { text-align:center; font-size:7pt; color:#555; margin-top:2px; }
</style>

<table class="hdr-t"><tr>
  <td style="width:50%">${logoHeader ? '<img src="' + logoHeader + '">' : ''}</td>
  <td class="hdr-r">DIRECCION GENERAL DE EDUCACION MEDIA SUPERIOR<br>DIRECCION DE BACHILLERATO GENERAL<br>ZONA ESCOLAR NUM. 63 BC<br>ESCUELA PREPARATORIA OFICIAL NUM. 67<br><b>C.C.T. 15EBH0134D &middot; 15EBH0168U</b></td>
</tr></table>

<h1>CUADRO DE CORRECCIONES DE CALIFICACIONES</h1>
<h2>${parcialText} PARCIAL &mdash; ${semText}</h2>

<table class="nfo">
  <tr>
    <td style="width:50%;"><span class="lb">Grupo:</span> <span class="vl">${Utils.sanitize(groupName)}</span>
      &nbsp;&nbsp;&nbsp; <span class="lb">Grado:</span> <span class="vl">${grado}&deg;</span>
      &nbsp;&nbsp;&nbsp; <span class="lb">Turno:</span> <span class="vl">${Utils.sanitize(turno)}</span></td>
    <td><span class="lb">Orientador(a):</span> <span class="vl">${Utils.sanitize(orientador)}</span></td>
  </tr>
  <tr>
    <td><span class="lb">Total de correcciones:</span> <span class="vl">${sorted.length}</span></td>
    <td><span class="lb">Fecha de impresion:</span> <span class="vl">${new Date().toLocaleDateString('es-MX')}</span></td>
  </tr>
</table>

<table class="main">
  <thead><tr>
    <th style="width:20px;">#</th>
    <th style="width:18%;">Nombre del Alumno</th>
    <th style="width:13%;">Materia</th>
    <th style="width:35px;text-align:center;">Dice</th>
    <th style="width:45px;text-align:center;">Debe Decir</th>
    <th style="width:16%;">Motivo</th>
    <th style="width:50px;text-align:center;">Fecha</th>
    <th style="width:10%;">Autorizo</th>
    <th style="width:18%;text-align:center;">Firma del Alumno</th>
  </tr></thead>
  <tbody>${rows}${blankRows}</tbody>
</table>

<div class="sigs"><table>
  <tr>
    <td><div class="line">ORIENTADOR(A)</div><div class="nm">${Utils.sanitize(orientador)}</div></td>
    <td><div class="line">VO. BO. SUBDIRECCION ESCOLAR</div><div class="nm">PROFR. OCTAVIO VAZQUEZ BARRETO</div></td>
  </tr>
  <tr>
    <td><div class="line">SECRETARIA ESCOLAR</div><div class="nm">PROFR. ROBERTO PALOMARES MEJIA</div></td>
    <td><div class="line">DIRECCION ESCOLAR</div><div class="nm"></div></td>
  </tr>
</table></div>

<div class="ftr">
  ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
  <div class="ftr-t">Av. de los Astros 7, Cuautitlan Izcalli, Estado de Mexico C.P. 54770 &middot; Tel. 55 5877 0221 &middot; epo67@edu.gem.gob.mx</div>
</div>`;

    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Correcciones - ' +
      Utils.sanitize(groupName) + '</title></head><body>' + html +
      '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // REPORTE CONCENTRADO POR TURNO
  // ═══════════════════════════════════════════════════════════════
  function _bindReportFilters() {
    _el('gc-rpt-generate')?.addEventListener('click', _loadReport);
  }

  async function _loadReport() {
    const turno = _el('gc-rpt-turno')?.value;
    const partial = _el('gc-rpt-parcial')?.value;
    const content = _el('gc-rpt-content');
    if (!content) return;

    if (!turno || !partial) {
      Toast.show('Selecciona turno y parcial', 'warning');
      return;
    }

    content.innerHTML = UI.loadingState('Consultando correcciones...');

    try {
      const snap = await db.collection('gradeCorrections')
        .where('turno', '==', turno)
        .where('partial', '==', partial)
        .get();

      const corrections = [];
      snap.forEach(d => corrections.push({ id: d.id, ...d.data() }));

      if (corrections.length === 0) {
        content.innerHTML = UI.emptyState('check_circle', 'No hay correcciones registradas para este turno y parcial.');
        return;
      }

      // Sort by group, then student name
      corrections.sort((a, b) =>
        (a.groupName || '').localeCompare(b.groupName || '') ||
        (a.studentName || '').localeCompare(b.studentName || '')
      );

      const parcialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;

      const rows = corrections.map((c, i) => {
        const date = c.correctedAt?.toDate ? c.correctedAt.toDate() : new Date(0);
        return `<tr style="${i % 2 === 1 ? 'background:rgba(183,121,31,0.06);' : ''}">
          <td style="text-align:center;" class="text-muted">${i + 1}</td>
          <td class="font-semibold">${Utils.sanitize(c.groupName || '')}</td>
          <td class="font-semibold">${Utils.sanitize(c.studentName || '')}</td>
          <td style="font-size:12px;">${Utils.sanitize(c.subjectName || '')}</td>
          <td style="text-align:center;text-decoration:line-through;color:var(--color-danger);font-weight:600;">${c.oldCal}</td>
          <td style="text-align:center;color:${AMBER};font-weight:700;font-size:15px;">${c.newCal}</td>
          <td style="font-size:12px;">${Utils.sanitize(c.motivo || '')}</td>
          <td style="font-size:12px;">${date.toLocaleDateString('es-MX')}</td>
          <td style="font-size:12px;">${Utils.sanitize(c.correctedByName || '')}</td>
        </tr>`;
      }).join('');

      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span class="font-semibold">${Utils.sanitize(turno)} — ${Utils.sanitize(parcialLabel)} — ${corrections.length} correcciones</span>
          <button class="btn btn-sm" style="background:${AMBER};color:#fff;" id="gc-rpt-print">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">print</span> Imprimir reporte
          </button>
        </div>
        <div class="table-container" style="overflow-x:auto;">
          <table class="table-light" style="font-size:13px;">
            <thead><tr>
              <th style="width:30px;">#</th>
              <th>Grupo</th>
              <th>Alumno</th>
              <th>Materia</th>
              <th style="text-align:center;width:55px;">Antes</th>
              <th style="text-align:center;width:65px;">Ahora</th>
              <th>Motivo</th>
              <th style="width:80px;">Fecha</th>
              <th>Autorizo</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;

      _el('gc-rpt-print')?.addEventListener('click', () => _printReport(corrections, turno, partial));
    } catch (e) {
      console.error('Error loading report:', e);
      content.innerHTML = UI.emptyState('error', 'Error: ' + e.message);
    }
  }

  function _printReport(corrections, turno, partial) {
    const parcMap = { P1: 'PRIMER', P2: 'SEGUNDO', P3: 'TERCER' };
    const parcialText = parcMap[partial] || 'PRIMER';
    const parcialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;
    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    const rows = corrections.map((c, i) => {
      const date = c.correctedAt?.toDate ? c.correctedAt.toDate() : new Date(0);
      const bg = i % 2 === 1 ? ' style="background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"' : '';
      return `<tr${bg}>
        <td class="c">${i + 1}</td>
        <td class="b">${Utils.sanitize(c.groupName)}</td>
        <td class="b">${Utils.sanitize(c.studentName)}</td>
        <td>${Utils.sanitize(c.subjectName)}</td>
        <td class="c b">${c.oldCal}</td>
        <td class="c b">${c.newCal}</td>
        <td>${Utils.sanitize(c.motivo)}</td>
        <td class="c">${date.toLocaleDateString('es-MX')}</td>
        <td>${Utils.sanitize(c.correctedByName)}</td>
      </tr>`;
    }).join('');

    const html = `
<style>
@page { size: letter landscape; margin: 12mm 10mm 10mm 10mm; }
html, body { margin:0; padding:0; font-family:Arial,Helvetica,sans-serif; color:#000; }
.hdr-t { width:100%; margin-bottom:3mm; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:8mm; width:auto; }
.hdr-r { text-align:right; font-size:8pt; line-height:1.3; color:#333; }
h1 { font-size:13pt; text-align:center; margin:3px 0 1px 0; }
h2 { font-size:10pt; text-align:center; margin:0 0 6px 0; font-weight:400; color:#444; }
.nfo { width:100%; font-size:10pt; border:1pt solid #000; border-collapse:collapse; margin-bottom:8px; }
.nfo td { border:1pt solid #000; padding:4px 8px; }
.nfo .lb { color:#555; font-size:9pt; }
.nfo .vl { font-weight:700; }
table.main { width:100%; border-collapse:collapse; font-size:9.5pt; }
table.main th { background:#1a202c; color:#fff; padding:5px 6px; font-size:9pt; text-align:left;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
table.main td { padding:4px 6px; border:0.5pt solid #888; line-height:1.3; }
.c { text-align:center; }
.b { font-weight:700; }
.sigs { margin-top:14mm; }
.sigs table { width:100%; }
.sigs td { width:33%; text-align:center; padding:0 10px; vertical-align:bottom; }
.sigs .line { border-top:1pt solid #000; margin-top:16mm; padding-top:3px; font-weight:700; font-size:9pt; }
.sigs .nm { font-size:9pt; color:#333; }
.ftr { margin-top:4mm; }
.ftr img { width:100%; max-height:3mm; display:block; }
.ftr-t { text-align:center; font-size:7pt; color:#555; margin-top:1px; }
</style>

<table class="hdr-t"><tr>
  <td style="width:50%">${logoHeader ? '<img src="' + logoHeader + '">' : ''}</td>
  <td class="hdr-r">DIRECCION GENERAL DE EDUCACION MEDIA SUPERIOR<br>DIRECCION DE BACHILLERATO GENERAL<br>ZONA ESCOLAR NUM. 63 BC<br>ESCUELA PREPARATORIA OFICIAL NUM. 67<br><b>C.C.T. 15EBH0134D &middot; 15EBH0168U</b></td>
</tr></table>

<h1>REPORTE CONCENTRADO DE CORRECCIONES DE CALIFICACIONES</h1>
<h2>${parcialText} PARCIAL &mdash; TURNO ${Utils.sanitize(turno)}</h2>

<table class="nfo">
  <tr>
    <td style="width:50%;"><span class="lb">Turno:</span> <span class="vl">${Utils.sanitize(turno)}</span>
      &nbsp;&nbsp;&nbsp; <span class="lb">Parcial:</span> <span class="vl">${Utils.sanitize(parcialLabel)}</span></td>
    <td><span class="lb">Total de correcciones:</span> <span class="vl">${corrections.length}</span>
      &nbsp;&nbsp;&nbsp; <span class="lb">Fecha:</span> <span class="vl">${new Date().toLocaleDateString('es-MX')}</span></td>
  </tr>
</table>

<table class="main">
  <thead><tr>
    <th style="width:20px;">#</th>
    <th style="width:8%;">Grupo</th>
    <th style="width:18%;">Alumno</th>
    <th style="width:14%;">Materia</th>
    <th style="width:40px;text-align:center;">Antes</th>
    <th style="width:45px;text-align:center;">Ahora</th>
    <th style="width:20%;">Motivo</th>
    <th style="width:60px;text-align:center;">Fecha</th>
    <th>Autorizado por</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="sigs"><table><tr>
  <td><div class="line">VO. BO. SUBDIRECCION ESCOLAR</div><div class="nm">PROFR. OCTAVIO VAZQUEZ BARRETO</div></td>
  <td><div class="line">SECRETARIA ESCOLAR</div><div class="nm">PROFR. ROBERTO PALOMARES MEJIA</div></td>
  <td><div class="line">DIRECCION ESCOLAR</div><div class="nm"></div></td>
</tr></table></div>

<div class="ftr">
  ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
  <div class="ftr-t">Av. de los Astros 7, Cuautitlan Izcalli, Estado de Mexico C.P. 54770 &middot; Tel. 55 5877 0221 &middot; epo67@edu.gem.gob.mx</div>
</div>`;

    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Correcciones - ' +
      Utils.sanitize(turno) + '</title></head><body>' + html +
      '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    w.document.close();
  }

  return { render };
})();

Router.modules['grade-corrections'] = () => GradeCorrectionsModule.render();
