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

  // v8.37: filtro activo por maestro en el panel de solicitudes (state local)
  let _filterByTeacher = '';

  // v8.37: helpers para mostrar/guardar nombres en formato correcto.
  // Antes: requestedByName guardaba "APELLIDO1 APELLIDO2 NOMBRE" (formato de
  // teachers.nombre) y al mostrarse salía "RAMIREZ OLIVIA PEÑA" (mal orden).
  // Ahora: aplicamos Utils.displayName() al guardar y al mostrar como red de
  // seguridad para datos legacy mal formateados.
  function _fmtName(name) {
    if (!name) return '';
    return (Utils.displayName ? Utils.displayName(name) : name) || '';
  }
  function _currentUserName() {
    // BUG FIX (jun 2026): antes hacía `const raw = _currentUserName()` → se
    // llamaba a sí misma → "Maximum call stack exceeded". Eso reventaba el
    // paso 2 de aplicar correcciones (appliedByName) y abrir/cerrar la ventana,
    // dejando la calificación cambiada pero la solicitud en "pendiente".
    //
    // BLINDAJE: este nombre es COSMÉTICO (solo para mostrar quién aplicó). NUNCA
    // debe poder tronar y bloquear una operación crítica (aplicar corrección,
    // abrir/cerrar ventana). Por eso va envuelto en try/catch con fallback.
    try {
      const u = App.currentUser || {};
      const raw = u.displayName || u.email || '';
      return _fmtName(raw);
    } catch (_) {
      const u = App.currentUser || {};
      return u.displayName || u.email || '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;
    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando...')}</div>`;

    try {
      // FORCE=true en getPartials para que el módulo refleje INMEDIATAMENTE
      // el cierre/apertura del parcial que el admin acaba de hacer. Sin esto,
      // el caché de 5 min hace que el admin cierre P2 y aún vea "ningún parcial
      // cerrado" al entrar a Cambios de Calificación.
      const [students, groups, subjects, assignments, partials] = await Promise.all([
        Store.getStudents(), Store.getGroups(), Store.getSubjects(),
        Store.getAssignments(), Store.getPartials(true)
      ]);
      _students = students.filter(s => s.estatus === 'ACTIVO');
      _groups = groups; _subjects = subjects; _assignments = assignments; _partials = partials;

      // \u2550\u2550\u2550 Regla de negocio: correcciones SOLO aplican para parciales ya cerrados \u2550\u2550\u2550
      // Mientras la ventana de captura est\u00e1 abierta, los maestros editan directamente
      // en su lista \u2014 no hay correcciones formales.
      // EXCEPCI\u00d3N: admin/subdirector/directivo pueden aplicar correcciones SIEMPRE
      // (necesitan acceso a solicitudes pendientes de parciales viejos, fixes urgentes,
      // y operaciones administrativas). El bloqueo solo aplica a quienes NO pueden gestionar.
      const role = App.currentUser?.role;
      const canManageAlways = (role === 'admin' || role === 'subdirector' || role === 'directivo' || role === 'secretario_escolar');

      const closedPartials = K.PARCIALES.filter(p => {
        const doc = partials.find(pp => pp.id === p.id);
        return doc?.locked === true;
      });
      const openPartials = K.PARCIALES.filter(p => {
        const doc = partials.find(pp => pp.id === p.id);
        return !doc || !doc.locked;
      });

      // CASO 1: NING\u00daN parcial cerrado Y el usuario NO es admin/direcci\u00f3n \u2192 bloquear
      if (closedPartials.length === 0 && !canManageAlways) {
        container.innerHTML = `
          <div class="module-container">
            ${UI.pageHeader('Correcciones de Calificaciones', 'Solo se activan despu\u00e9s de cerrar un parcial')}
            <div style="background:linear-gradient(135deg,#e0e7ff 0%,#c7d2fe 100%);border:2px solid #6366f1;border-radius:14px;padding:32px;margin-top:16px;text-align:center;">
              <span class="material-icons-round" style="font-size:64px;color:#4338ca;display:block;margin-bottom:12px;">lock_clock</span>
              <h2 style="font-size:20px;font-weight:800;color:#312e81;margin:0 0 12px;">
                La ventana de edici\u00f3n est\u00e1 abierta
              </h2>
              <p style="font-size:14px;color:#3730a3;line-height:1.6;max-width:580px;margin:0 auto 16px;">
                Las correcciones formales s\u00f3lo se activan cuando un parcial ya est\u00e1 cerrado.
                Mientras la ventana siga abierta, los maestros pueden editar sus calificaciones
                directamente en <strong>"Capturar Calificaciones"</strong> sin necesidad de hacer un
                tr\u00e1mite de correcci\u00f3n.
              </p>
              <div style="background:#fff;border-radius:8px;padding:14px 18px;display:inline-block;text-align:left;font-size:13px;color:#374151;border:1px solid #c7d2fe;">
                <strong style="color:#4338ca;">Estado actual:</strong>
                <div style="margin-top:6px;">
                  ${openPartials.map(p => `<div>\ud83d\udfe2 ${p.nombre}: <strong>abierto</strong> \u2014 los maestros editan directamente</div>`).join('')}
                </div>
              </div>
            </div>
          </div>`;
        return;
      }

      // CASO 2: hay parciales cerrados (o admin/direcci\u00f3n)
      const turnoOpts = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
      const gradoOpts = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba</option>`).join('');
      // Para admin/direcci\u00f3n: TODOS los parciales son seleccionables (siempre tienen acceso).
      // Para otros roles: solo los CERRADOS son seleccionables; los abiertos van deshabilitados.
      const parcialOpts = K.PARCIALES.map(p => {
        const doc = partials.find(pp => pp.id === p.id);
        const isLocked = doc?.locked === true;
        if (isLocked) {
          return `<option value="${p.id}">${p.nombre} (Cerrado \u2014 correcciones disponibles)</option>`;
        }
        if (canManageAlways) {
          return `<option value="${p.id}">${p.nombre} (Abierto \u2014 acceso administrativo)</option>`;
        }
        return `<option value="${p.id}" disabled style="color:#94a3b8;">${p.nombre} (Abierto \u2014 editar directamente)</option>`;
      }).join('');

      container.innerHTML = `
        <div class="module-container">
          ${UI.pageHeader('Correcciones de Calificaciones', 'Registro oficial de modificaciones — Solo dirección')}

          <!-- PANEL VENTANA MANUAL (solo admin abre, todos ven estado) -->
          <div id="gc-manual-window" style="margin-bottom:16px;"></div>

          <!-- SOLICITUDES PENDIENTES DE MAESTROS -->
          <div id="gc-pending-requests" style="margin-bottom:16px;"></div>

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
      // Populate materias for this group — ordenado por orden oficial SEP del grado.
      const groupAsgs = _assignments.filter(a => a.groupId === els.grupo.value);
      const subIds = [...new Set(groupAsgs.map(a => a.subjectId))];
      const _grado = els.grado.value;
      const subs = K.sortSubjectsByGrado(
        _subjects.filter(s => subIds.includes(s.id)),
        Number(_grado)
      );
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
        Este parcial aun esta abierto. Las correcciones solo se pueden hacer después de cerrar el parcial.</div>`;
      return;
    }
    if (_correctionWindow.open) {
      ws.innerHTML = `<div class="card" style="border-left:4px solid var(--color-success);margin-bottom:16px;">
        <span class="material-icons-round" style="color:var(--color-success);vertical-align:middle;">check_circle</span>
        <strong>Período de corrección abierto.</strong> Quedan ${_correctionWindow.daysLeft} dia(s).
        Fecha limite: ${_correctionWindow.deadline.toLocaleDateString('es-MX')}</div>`;
    } else {
      ws.innerHTML = `<div class="card" style="border-left:4px solid var(--color-danger);margin-bottom:16px;">
        <span class="material-icons-round" style="color:var(--color-danger);vertical-align:middle;">block</span>
        <strong>Período de corrección cerrado.</strong> Ya pasaron los 3 dias habiles.</div>`;
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
      // Admin/dirección puede corregir SIEMPRE (acceso administrativo).
      // Otros roles: solo cuando ventana abierta Y parcial cerrado.
      const userRole = App.currentUser?.role;
      const isAdminOrDirective = (userRole === 'admin' || userRole === 'subdirector' || userRole === 'directivo' || userRole === 'secretario_escolar');
      const canCorrect = isAdminOrDirective || (_correctionWindow?.open && partialDoc?.locked);

      // Build table
      const rows = studentList.map((st, idx) => {
        const cal = gradeMap[st.id];
        const wasCorrected = correctedStudentIds.has(st.id);
        const corr = corrForSubject.find(c => c.studentId === st.id);
        const rowStyle = wasCorrected ? `background:${AMBER_BG};border-left:3px solid ${AMBER};` : '';
        const hasCal = cal !== null && cal !== undefined;
        const calDisplay = hasCal ? cal : '<span style="color:#9ca3af;font-style:italic;font-size:11px;">sin captura</span>';
        const calStyle = hasCal && cal < 6 ? 'color:var(--color-danger);font-weight:700;' : 'font-weight:600;';

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
        } else if (canCorrect) {
          // Admin/dirección puede solicitar corrección SIEMPRE:
          //   - Si hay cal y es < 10: subir (caso normal)
          //   - Si hay cal y es 10: poder bajarla (error de captura)
          //   - Si NO hay cal capturada: registrar la primera (alumno sin captura)
          // Para no-admin (canCorrect via ventana), se mantiene la lógica original:
          //   solo se ofrece si hay cal < 10.
          const showBtn = isAdminOrDirective || (hasCal && cal < 10);
          if (showBtn) {
            const btnLabel = hasCal ? 'Solicitar corrección' : 'Capturar corrección';
            const currentCalAttr = hasCal ? cal : '';
            actionCell = `
              <td colspan="2" style="text-align:center;">
                <button class="btn btn-sm" style="background:${AMBER};color:#fff;font-size:11px;" data-action="correct"
                  data-student-id="${st.id}" data-student-name="${Utils.sanitize(st.nombreCompleto)}"
                  data-subject-id="${subjectId}" data-subject-name="${Utils.sanitize(subjectName)}"
                  data-current-cal="${currentCalAttr}">
                  <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit</span> ${btnLabel}
                </button>
              </td>`;
          } else {
            actionCell = '<td colspan="2"></td>';
          }
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
                <th style="text-align:center;">Estado / Corrección</th>
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
          // currentCal puede venir vacío cuando el alumno no tiene captura previa.
          // Pasamos null en ese caso para que el modal sepa que es "primera captura".
          const raw = correctBtn.dataset.currentCal;
          const curCal = raw === '' || raw === undefined ? null : parseInt(raw);
          _openCorrectionModal(correctBtn.dataset.studentId, correctBtn.dataset.studentName,
            correctBtn.dataset.subjectId, correctBtn.dataset.subjectName, curCal);
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
        <td style="font-size:12px;">${Utils.sanitize(_fmtName(c.correctedByName))}</td>
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
      'Evaluación complementaria aplicada',
      'Trabajo extra autorizado por orientación',
      'Revision de examen procedente',
      'Justificacion de inasistencias presentada',
      'Error en calculo de rubros',
      'Captura faltante del docente'
    ].map(m => `<option value="${m}">${m}</option>`).join('');

    // Admin/subdirector/dirección pueden corregir en CUALQUIER dirección
    // (subir, bajar, capturar primera vez). Otros roles solo pueden subir.
    const _r = App.currentUser?.role;
    const isAdminPower = (_r === 'admin' || _r === 'subdirector' || _r === 'directivo' || _r === 'secretario_escolar');
    const hasCurrentCal = currentCal !== null && currentCal !== undefined && !isNaN(currentCal);

    // Determinar min/max según rol y estado:
    //   - Admin con cal capturada: min=5, max=10 (puede subir o bajar)
    //   - Admin sin captura: min=5, max=10 (primera captura)
    //   - No-admin con cal: min=currentCal+1, max=10 (solo subir)
    let minVal, maxVal, hint;
    if (isAdminPower) {
      minVal = 5; maxVal = 10;
      hint = hasCurrentCal
        ? `Rango permitido: 5 a 10. Puedes subir o bajar la calificación.`
        : `Rango permitido: 5 a 10. Primera captura (no existía calificación previa).`;
    } else {
      minVal = (hasCurrentCal ? currentCal + 1 : 5);
      maxVal = 10;
      hint = `Min ${minVal}, max ${maxVal}`;
    }

    const calActualHtml = hasCurrentCal
      ? `<div style="font-size:22px;font-weight:700;color:${currentCal < 6 ? 'var(--color-danger)' : 'var(--color-success)'};">${currentCal}</div>`
      : `<div style="font-size:14px;font-style:italic;color:#9ca3af;padding-top:4px;">Sin captura previa</div>`;

    const placeholder = hasCurrentCal
      ? (isAdminPower ? `Nueva calificación (${minVal}-${maxVal})` : `Mayor a ${currentCal}`)
      : `Primera captura (${minVal}-${maxVal})`;

    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:flex;gap:24px;flex-wrap:wrap;">
          <div><label class="text-muted" style="font-size:11px;">Alumno</label><div class="font-semibold">${Utils.sanitize(studentName)}</div></div>
          <div><label class="text-muted" style="font-size:11px;">Materia</label><div class="font-semibold">${Utils.sanitize(subjectName)}</div></div>
          <div><label class="text-muted" style="font-size:11px;">Cal. actual</label>${calActualHtml}</div>
        </div>
        <div class="form-group">
          <label style="font-weight:600;">Nueva calificación *</label>
          <input type="number" id="gc-new-cal" min="${minVal}" max="${maxVal}" step="1" placeholder="${placeholder}" style="font-size:18px;font-weight:700;text-align:center;">
          <small class="text-muted">${hint}</small>
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

    const modalTitle = hasCurrentCal ? 'Corrección de Calificación' : 'Captura de Calificación Faltante';
    Modal.open(modalTitle, bodyHtml,
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

      if (!newCal || isNaN(newCal)) { Toast.show('Ingresa la nueva calificación', 'warning'); return; }
      // Admin/dirección puede ir en cualquier dirección (subir, bajar, primera captura).
      // No-admin sólo puede subir respecto a la calificación previa.
      if (!isAdminPower && hasCurrentCal && newCal <= currentCal) {
        Toast.show('Debe ser mayor a ' + currentCal, 'error'); return;
      }
      if (newCal < 5) { Toast.show('Mínimo 5 (regla EPO 67)', 'error'); return; }
      if (newCal > 10) { Toast.show('Máximo 10', 'error'); return; }
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

        // Folio determinístico para correcciones administrativas directas:
        //   ADM-{yyyymmdd}-{hhmmss}-{ultimos 4 del uid}
        // Distintivo de los folios de solicitudes de maestros (que usan
        // numeración secuencial). Permite identificar en el panel admin
        // que fue una corrección ejecutada directamente por dirección.
        const _now = new Date();
        const _pad = (n) => String(n).padStart(2, '0');
        const _adminFolio = `ADM-${_now.getFullYear()}${_pad(_now.getMonth()+1)}${_pad(_now.getDate())}-${_pad(_now.getHours())}${_pad(_now.getMinutes())}${_pad(_now.getSeconds())}-${(auth.currentUser.uid || 'xxxx').slice(-4)}`;

        // Doc en formato compatible con firestore.rules (FLUJO v5.59+):
        //   - Campos requeridos: studentId, subjectId, partial, newGrade, reason, folio, status
        //   - newGrade / reason: nombres "oficiales" del esquema actual
        //   - newCal / motivo: mantenidos por compatibilidad con UI existente
        //   - status='applied' marca que admin/subdirector ya la aplicó directo (no es solicitud pendiente)
        //   - currentGrade=null cuando no hay captura previa (admin captura por primera vez)
        await db.collection('gradeCorrections').add({
          // Campos requeridos por la regla
          studentId,
          subjectId,
          partial,
          newGrade: newCal,
          reason: motivo,
          folio: _adminFolio,
          status: 'applied',
          // Campos opcionales pero útiles
          currentGrade: hasCurrentCal ? currentCal : null,
          studentName, subjectName,
          groupId, groupName: grupo?.nombre || groupId, turno: grupo?.turno || '',
          // Aliases legacy (UI los consume)
          oldCal: hasCurrentCal ? currentCal : null,
          newCal,
          motivo,
          // Auditoría
          appliedBy: auth.currentUser.uid,
          appliedByName: _currentUserName(),
          appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
          correctedBy: auth.currentUser.uid,
          correctedByName: _currentUserName(),
          correctedAt: firebase.firestore.FieldValue.serverTimestamp(),
          // requestedBy: indica quién originó (admin = mismo uid que applied)
          requestedBy: auth.currentUser.uid,
          requestedByName: _currentUserName(),
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
          // Tipo de origen (para auditoría y reportes)
          source: 'admin_direct'
        });

        // Doc principal de grades: la corrección REEMPLAZA la calificación anterior.
        // Se actualiza cal/value/suma al nuevo valor — la anterior NO queda en este
        // doc. Quien quiera el historial lo busca en /gradeCorrections (mismo folio).
        // BORRAMOS explícitamente `previousCal` si existía de versiones antiguas.
        const gradeDocId = `${studentId}_${subjectId}_${partial}`;
        await db.collection('grades').doc(gradeDocId).set({
          cal: newCal,
          value: newCal,
          suma: newCal,
          updatedAt: new Date(),
          updatedBy: auth.currentUser.uid,
          correctionFolio: _adminFolio,
          correctedAt: firebase.firestore.FieldValue.serverTimestamp(),
          correctedFromCal: hasCurrentCal ? currentCal : null,
          // FieldValue.delete() limpia el campo si existía
          previousCal: firebase.firestore.FieldValue.delete(),
        }, { merge: true });

        Store.invalidateGradesForGroup(groupId);

        // Para auditoría: usar "(sin captura)" cuando no había cal previa.
        const oldCalForAudit = hasCurrentCal ? currentCal : '(sin captura)';
        DB.audit('corrección', 'calificación', gradeDocId, {
          description: `Corrección: ${studentName} - ${subjectName} - ${partial}: ${oldCalForAudit} -> ${newCal}`,
          extra: { oldCal: hasCurrentCal ? currentCal : null, newCal, motivo }
        });

        // Email notification to directivos (fire-and-forget)
        _notifyDirectivos(studentName, subjectName, grupo?.nombre || groupId, partial, oldCalForAudit, newCal, motivo);

        Modal.close();
        Toast.show(hasCurrentCal
          ? `Corrección aplicada: ${currentCal} → ${newCal}`
          : `Calificación capturada: ${newCal}`, 'success');
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
    if (!confirm(`¿Deshacer la corrección de ${studentName}?\nSe restaurara la calificación anterior: ${oldCal}`)) return;

    try {
      const subjectId = _el('gc-materia').value;
      const partial = _el('gc-parcial').value;
      const groupId = _el('gc-grupo').value;

      // Restore original grade. BLINDAJE: reponemos también `suma` para que el
      // doc quede consistente (cal = calcCal(suma)) y no dispare el auditor.
      const gradeDocId = `${studentId}_${subjectId}_${partial}`;
      await db.collection('grades').doc(gradeDocId).set({
        cal: oldCal, value: oldCal, suma: oldCal, updatedAt: new Date(), updatedBy: auth.currentUser.uid
      }, { merge: true });

      // Delete correction record
      await db.collection('gradeCorrections').doc(correctionId).delete();

      Store.invalidateGradesForGroup(groupId);

      DB.audit('deshacer_corrección', 'calificación', gradeDocId, {
        description: `Corrección deshecha: ${studentName} - ${partial}: restaurada a ${oldCal}`,
        extra: { restoredCal: oldCal }
      });

      Toast.show(`Corrección deshecha. Calificación restaurada a ${oldCal}`, 'info');
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
        subject: `Corrección de calificación — ${studentName}`,
        body: `Se realizo una corrección de calificación:\n\nAlumno: ${studentName}\nMateria: ${subjectName}\nGrupo: ${groupName}\nParcial: ${partial}\nCalificación anterior: ${oldCal}\nCalificación nueva: ${newCal}\nMotivo: ${motivo}\n\nAutorizado por: ${_currentUserName()}`,
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
        <td>${Utils.sanitize(_fmtName(c.correctedByName))}</td>
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
  <td class="hdr-r">DIRECCIÓN GENERAL DE EDUCACION MEDIA SUPERIOR<br>DIRECCIÓN DE BACHILLERATO GENERAL<br>ZONA ESCOLAR NUM. 63 BC<br>ESCUELA PREPARATORIA OFICIAL NUM. 67<br><b>C.C.T. 15EBH0134D &middot; 15EBH0168U</b></td>
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
    <td><div class="line">VO. BO. SUBDIRECCIÓN ESCOLAR</div><div class="nm">${Utils.sanitize(App.staffName('subdirector'))}</div></td>
    <td><div class="line">DIRECCIÓN ESCOLAR</div><div class="nm">${Utils.sanitize(App.staffName('director'))}</div></td>
  </tr>
</table></div>

<div class="ftr">
  ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
  <div class="ftr-t">Av. de los Astros 7, Cuautitlan Izcalli, Estado de México C.P. 54770 &middot; Tel. 55 5877 0221 &middot; epo67@edu.gem.gob.mx</div>
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
          <td style="font-size:12px;">${Utils.sanitize(_fmtName(c.correctedByName))}</td>
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
        <td>${Utils.sanitize(_fmtName(c.correctedByName))}</td>
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
  <td class="hdr-r">DIRECCIÓN GENERAL DE EDUCACION MEDIA SUPERIOR<br>DIRECCIÓN DE BACHILLERATO GENERAL<br>ZONA ESCOLAR NUM. 63 BC<br>ESCUELA PREPARATORIA OFICIAL NUM. 67<br><b>C.C.T. 15EBH0134D &middot; 15EBH0168U</b></td>
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
  <td><div class="line">VO. BO. SUBDIRECCIÓN ESCOLAR</div><div class="nm">${Utils.sanitize(App.staffName('subdirector'))}</div></td>
  <td><div class="line">DIRECCIÓN ESCOLAR</div><div class="nm">${Utils.sanitize(App.staffName('director'))}</div></td>
</tr></table></div>

<div class="ftr">
  ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
  <div class="ftr-t">Av. de los Astros 7, Cuautitlan Izcalli, Estado de México C.P. 54770 &middot; Tel. 55 5877 0221 &middot; epo67@edu.gem.gob.mx</div>
</div>`;

    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Reporte Correcciones - ' +
      Utils.sanitize(turno) + '</title></head><body>' + html +
      '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // VENTANA MANUAL DE CORRECCIONES (admin la abre/cierra; todos ven estado)
  // ═══════════════════════════════════════════════════════════════
  let _manualWindow = null; // {open, openedAt, closesAt, openedBy, openedByName}

  async function _loadManualWindow() {
    try {
      const doc = await firebase.firestore().collection('config').doc('correctionsWindow').get();
      _manualWindow = doc.exists ? doc.data() : { open: false };
    } catch (e) {
      console.warn('No se pudo leer correctionsWindow:', e.message);
      _manualWindow = { open: false };
    }
  }

  function _isWindowCurrentlyOpen() {
    if (!_manualWindow || !_manualWindow.open) return false;
    if (_manualWindow.closesAt) {
      const closes = _manualWindow.closesAt.toDate ? _manualWindow.closesAt.toDate() : new Date(_manualWindow.closesAt);
      if (new Date() > closes) return false;
    }
    return true;
  }

  async function _renderManualWindowPanel() {
    const root = document.getElementById('gc-manual-window');
    if (!root) return;

    await _loadManualWindow();
    // Admin O subdirector pueden abrir/cerrar ventana (autoridad académica equivalente).
    const _r = App.currentUser?.role;
    const isAdmin = _r === 'admin' || _r === 'subdirector';
    const isOpen = _isWindowCurrentlyOpen();
    const closesStr = _manualWindow?.closesAt
      ? (_manualWindow.closesAt.toDate ? _manualWindow.closesAt.toDate() : new Date(_manualWindow.closesAt))
        .toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';

    const statusBg = isOpen ? '#d1fae5' : '#fee2e2';
    const statusBorder = isOpen ? '#16a34a' : '#dc2626';
    const statusIcon = isOpen ? 'lock_open' : 'lock';
    const statusText = isOpen ? 'VENTANA ABIERTA' : 'VENTANA CERRADA';
    const statusColor = isOpen ? '#065f46' : '#991b1b';

    const adminControls = isAdmin ? `
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        ${isOpen
          ? `<button class="btn btn-sm btn-danger" id="gc-mw-close">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">lock</span>
              Cerrar ventana ahora
            </button>`
          : `<button class="btn btn-sm" style="background:#16a34a;color:#fff;" id="gc-mw-open">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">lock_open</span>
              Abrir ventana de correcciones
            </button>`
        }
      </div>` : '';

    root.innerHTML = `
      <div class="card" style="background:${statusBg};border-left:5px solid ${statusBorder};">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;gap:12px;align-items:center;">
            <span class="material-icons-round" style="font-size:32px;color:${statusColor};">${statusIcon}</span>
            <div>
              <div style="font-size:13px;color:#555;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">
                Ventana oficial de aplicación
              </div>
              <div style="font-size:18px;font-weight:700;color:${statusColor};">${statusText}</div>
              ${isOpen ? `<div style="font-size:12px;color:#444;margin-top:2px;">Cierra: ${S(closesStr)}</div>` : ''}
            </div>
          </div>
          <div style="font-size:12px;color:#444;max-width:380px;text-align:right;">
            ${isOpen
              ? 'Las solicitudes pendientes pueden ser aplicadas durante esta ventana.'
              : 'Las solicitudes se acumulan pero no pueden aplicarse fuera de ventana.'
            }
            ${!isAdmin ? '<br><em>Solo la dirección o subdirección pueden abrir/cerrar la ventana.</em>' : ''}
          </div>
        </div>
        ${adminControls}
      </div>`;

    if (isAdmin) {
      const btnOpen = document.getElementById('gc-mw-open');
      const btnClose = document.getElementById('gc-mw-close');
      if (btnOpen) btnOpen.addEventListener('click', _openWindow);
      if (btnClose) btnClose.addEventListener('click', _closeWindow);
    }
  }

  async function _openWindow() {
    // Solo admin y subdirector pueden abrir la ventana. Antes había un PIN
    // hardcoded que confundía y bloqueaba a los autorizados. La validación
    // de rol ya está en firestore.rules; aquí solo confirmamos la acción.
    const role = App.currentUser?.role;
    if (!['admin', 'subdirector'].includes(role)) {
      Toast.show('Solo admin o subdirección pueden abrir esta ventana.', 'error');
      return;
    }
    if (!confirm('¿Confirmas ABRIR la ventana de correcciones de calificaciones?\n\nLos maestros podrán solicitar cambios autorizados hasta la fecha de cierre que definas.')) return;

    // Default: hoy + 7 días
    const defaultClose = new Date();
    defaultClose.setDate(defaultClose.getDate() + 7);
    const defaultStr = `${defaultClose.getFullYear()}-${String(defaultClose.getMonth() + 1).padStart(2, '0')}-${String(defaultClose.getDate()).padStart(2, '0')} 23:59`;
    const dateStr = prompt(`¿Hasta qué fecha y hora cierra la ventana?\nFormato: YYYY-MM-DD HH:MM\n\nEjemplo: ${defaultStr}`, defaultStr);
    if (!dateStr) return;
    let closesAt;
    try {
      const [d, t] = dateStr.trim().split(/\s+/);
      const [y, mo, da] = d.split('-').map(Number);
      const [h, mi] = (t || '23:59').split(':').map(Number);
      closesAt = new Date(y, mo - 1, da, h || 23, mi || 59, 59);
      if (isNaN(closesAt.getTime())) throw new Error('fecha invalida');
    } catch (e) {
      Toast.show('Formato de fecha invalido. Usa YYYY-MM-DD HH:MM', 'error');
      return;
    }

    try {
      await firebase.firestore().collection('config').doc('correctionsWindow').set({
        open: true,
        openedAt: firebase.firestore.FieldValue.serverTimestamp(),
        openedBy: firebase.auth().currentUser.uid,
        openedByName: _currentUserName(),
        closesAt: firebase.firestore.Timestamp.fromDate(closesAt),
      });
      Toast.show(`Ventana abierta hasta ${closesAt.toLocaleString('es-MX')}`, 'success');
      await _renderManualWindowPanel();
      await _renderPendingRequests();
    } catch (e) {
      Toast.show('Error al abrir ventana: ' + e.message, 'error');
    }
  }

  async function _closeWindow() {
    const role = App.currentUser?.role;
    if (!['admin', 'subdirector'].includes(role)) {
      Toast.show('Solo admin o subdirección pueden cerrar esta ventana.', 'error');
      return;
    }
    if (!confirm('¿Cerrar la ventana de correcciones inmediatamente?\n\nLos maestros ya no podrán solicitar cambios hasta que se vuelva a abrir.')) return;

    try {
      await firebase.firestore().collection('config').doc('correctionsWindow').set({
        open: false,
        closedAt: firebase.firestore.FieldValue.serverTimestamp(),
        closedBy: firebase.auth().currentUser.uid,
        closedByName: _currentUserName(),
      }, { merge: true });
      Toast.show('Ventana cerrada.', 'success');
      await _renderManualWindowPanel();
      await _renderPendingRequests();
    } catch (e) {
      Toast.show('Error al cerrar ventana: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SOLICITUDES DE MAESTROS — flujo de 4 estados con tabs
  //   pending → received → authorized → applied
  //   (en cualquier punto: rejected o cancelled)
  // ═══════════════════════════════════════════════════════════════
  let _allRequests = []; // todas las solicitudes activas (no aplicadas/rechazadas/canceladas viejas)
  let _activeTab = 'pending'; // 'pending' | 'applied' | 'rejected' | 'cancelled'
  let _loadedTabs = new Set(); // qué tabs ya consultamos a Firestore (lazy load)

  async function _renderPendingRequests(forceReload = false) {
    const root = document.getElementById('gc-pending-requests');
    if (!root) return;
    const role = App.currentUser?.role;
    const canSee = role === 'admin' || role === 'subdirector' || role === 'directivo' || role === 'secretario_escolar';
    const canManage = role === 'subdirector' || role === 'admin';
    if (!canSee) { root.innerHTML = ''; return; }

    // FIX (v7.82): tras aplicar/rechazar/autorizar una solicitud, el doc cambia
    // de status en Firestore PERO el cache local (_loadedTabs/_allRequests) tenía
    // la versión vieja, así que la solicitud seguía apareciendo como "pendiente"
    // aunque ya estaba aplicada. forceReload limpia el cache para releer del servidor.
    if (forceReload) {
      _loadedTabs = new Set();
      _allRequests = [];
    }

    try {
      // PERFORMANCE: antes cargábamos los 4 tabs al inicio (~1900 docs en una
      // sola apertura). Ahora cargamos PENDING siempre + el tab activo si es
      // otro. Los demás se cargan al click. Los conteos de tabs no cargados se
      // muestran como '?' para evitar mentir, y al hacer click sí se traen.
      const fs = firebase.firestore();

      // PRIVACIDAD ESTRICTA (junio 2026): el maestro NO debe ver solicitudes
      // de otros docentes — solo las que el pidio (requestedBy = su uid) o
      // las que admin pidio a su nombre (teacherId = su teacherDocId).
      // Antes hacíamos UN solo .where('status','==',status) global y delegamos
      // el filtrado a Firestore rules. Eso es PELIGROSO: si las rules tienen
      // un flag aditivo que les da lectura amplia (presidente_academia,
      // auditorScope, etc.), el maestro puede ver solicitudes ajenas. Ahora
      // hacemos 2 queries SIEMPRE acotadas al usuario actual y unimos los
      // resultados sin duplicados.
      const role = App.currentUser?.role;
      const isAdminLike = role === 'admin' || role === 'subdirector' ||
                          role === 'directivo' || role === 'secretario_escolar' ||
                          role === 'secretario_admin' || App.canActAs('auditor');
      const myUid = auth.currentUser?.uid;
      const myTeacherDocId = await Store.getTeacherDocId().catch(() => null);

      const loadStatus = async (status, limit) => {
        const tryGet = async (q, opts) => {
          try {
            const snap = await q.get(opts);
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          } catch (_) { return null; }
        };

        if (isAdminLike) {
          // Vista global de gestion — admin/subdirector/directivo/auditor.
          const q = fs.collection('gradeCorrections').where('status','==',status).limit(limit);
          let docs = await tryGet(q, { source: 'server' });
          if (docs == null) docs = await tryGet(q) || [];
          return docs;
        }

        // Maestro / orientador_docente: 2 queries acotadas + merge sin dups.
        if (!myUid && !myTeacherDocId) return [];
        const queries = [];
        if (myUid) {
          queries.push(
            fs.collection('gradeCorrections')
              .where('status','==',status)
              .where('requestedBy','==',myUid)
              .limit(limit)
          );
        }
        if (myTeacherDocId) {
          queries.push(
            fs.collection('gradeCorrections')
              .where('status','==',status)
              .where('teacherId','==',myTeacherDocId)
              .limit(limit)
          );
        }
        const results = await Promise.all(
          queries.map(async q => (await tryGet(q, { source: 'server' })) || (await tryGet(q)) || [])
        );
        // Merge sin duplicados por docId
        const seen = new Set();
        const merged = [];
        for (const arr of results) {
          for (const d of arr) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            merged.push(d);
          }
        }
        return merged;
      };

      // Track de qué tabs ya cargamos para no re-pegarle a Firestore al cambiar de tab
      _loadedTabs = _loadedTabs || new Set();
      const promises = [];
      const tabsToLoad = ['pending'];
      if (_activeTab !== 'pending') tabsToLoad.push(_activeTab);

      for (const t of tabsToLoad) {
        if (_loadedTabs.has(t)) continue;
        const limit = t === 'applied' ? 1000 : (t === 'pending' ? 500 : 200);
        promises.push(loadStatus(t, limit).then(docs => ({ t, docs })));
      }
      const results = await Promise.all(promises);
      // Merge con lo que ya tenemos
      const newAll = (_allRequests || []).slice();
      for (const { t, docs } of results) {
        _loadedTabs.add(t);
        // Quita docs previos de este status (por si re-cargamos)
        for (let i = newAll.length - 1; i >= 0; i--) {
          if (newAll[i].status === t) newAll.splice(i, 1);
        }
        newAll.push(...docs);
      }
      _allRequests = newAll;
      // Helper para ms desde Timestamp/Date/ISO
      const _toMs = (v) => {
        if (!v) return 0;
        if (v.toMillis) return v.toMillis();
        if (v.toDate) return v.toDate().getTime();
        const n = new Date(v).getTime();
        return isNaN(n) ? 0 : n;
      };
      _allRequests.sort((a, b) => {
        // Ordenar por la fecha más reciente disponible (applied/rejected/cancelled/requested)
        const ta = _toMs(a.appliedAt) || _toMs(a.rejectedAt) || _toMs(a.cancelledAt) || _toMs(a.requestedAt) || _toMs(a.correctedAt);
        const tb = _toMs(b.appliedAt) || _toMs(b.rejectedAt) || _toMs(b.cancelledAt) || _toMs(b.requestedAt) || _toMs(b.correctedAt);
        return tb - ta;
      });
    } catch (e) {
      console.warn('No se pudieron cargar solicitudes:', e.message);
      _allRequests = [];
    }

    // Conteos por folio (agrupados)
    const folioCnt = { pending: new Set(), applied: new Set(), rejected: new Set(), cancelled: new Set() };
    _allRequests.forEach(r => { folioCnt[r.status]?.add(r.folio); });

    const isWindowOpen = _isWindowCurrentlyOpen();
    const cnt = (status) => _loadedTabs.has(status) ? folioCnt[status].size : '?';
    const tabs = [
      { id: 'pending',    label: 'Pendientes',    count: cnt('pending'),   color: '#d97706', desc: 'Solicitudes sin aplicar. ¿Tienes el papel firmado por la directora? Aplícalas durante la ventana.' },
      { id: 'applied',    label: 'Aplicadas',     count: cnt('applied'),   color: '#6366f1', desc: 'Historial completo de cambios ya efectuados en el ciclo escolar.' },
      { id: 'rejected',   label: 'Rechazadas',    count: cnt('rejected'),  color: '#dc2626', desc: 'Historial completo de solicitudes rechazadas en el ciclo.' },
      { id: 'cancelled',  label: 'Canceladas',    count: cnt('cancelled'), color: '#64748b', desc: 'Solicitudes canceladas por el propio maestro antes de aplicarse.' },
    ];

    const tabsHtml = tabs.map(t => {
      const active = _activeTab === t.id;
      return `<button data-action="gc-tab" data-tab="${t.id}"
        style="padding:10px 14px;border:none;background:${active ? t.color : '#f1f5f9'};color:${active ? '#fff' : '#475569'};border-radius:6px;cursor:pointer;font-weight:${active ? '700' : '500'};font-size:13px;display:flex;align-items:center;gap:8px;">
        ${S(t.label)}
        <span style="background:${active ? 'rgba(255,255,255,0.3)' : '#cbd5e1'};color:${active ? '#fff' : '#1e293b'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${t.count}</span>
      </button>`;
    }).join('');

    // Filtrar según tab + maestro seleccionado (v8.37)
    let filtered = _allRequests.filter(r => r.status === _activeTab);
    if (_filterByTeacher) {
      filtered = filtered.filter(r =>
        (r.teacherId === _filterByTeacher) ||
        (_fmtName(r.requestedByName) === _filterByTeacher)
      );
    }

    // Construir lista única de maestros con solicitudes en ESTE tab (para el dropdown)
    const teachersInTab = new Set();
    _allRequests
      .filter(r => r.status === _activeTab)
      .forEach(r => {
        if (r.teacherId) teachersInTab.add(JSON.stringify({ id: r.teacherId, name: _fmtName(r.requestedByName) }));
      });
    const teacherOpts = [...teachersInTab]
      .map(s => JSON.parse(s))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(t => `<option value="${S(t.id)}" ${_filterByTeacher === t.id ? 'selected' : ''}>${S(t.name)}</option>`)
      .join('');

    // Agrupar por folio
    const byFolio = {};
    filtered.forEach(d => {
      if (!byFolio[d.folio]) byFolio[d.folio] = [];
      byFolio[d.folio].push(d);
    });

    const folios = Object.entries(byFolio);

    const cards = folios.length === 0 ? `
      <div class="card" style="text-align:center;padding:24px;color:#888;">
        <span class="material-icons-round" style="font-size:48px;color:#cbd5e1;">inbox</span>
        <div style="margin-top:8px;font-size:14px;">No hay solicitudes en este estado.</div>
      </div>
    ` : folios.map(([folio, items]) => _renderFolioCard(folio, items, canManage, isWindowOpen)).join('');

    const tabDesc = tabs.find(t => t.id === _activeTab)?.desc || '';

    // Botón "Aplicar TODAS las pendientes" (solo admin/subdirector, solo en tab pending con folios)
    const pendingFolioCount = folioCnt.pending.size;
    const showBulkApply = canManage && _activeTab === 'pending' && pendingFolioCount > 0;
    const bulkApplyBtn = showBulkApply ? `
      <button id="gc-apply-all-pending" class="btn btn-sm" style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:#fff;border:none;font-weight:800;padding:10px 16px;box-shadow:0 2px 6px rgba(22,163,74,0.25);">
        <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">verified_user</span>
        Autorizar y aplicar TODAS (${pendingFolioCount} folio${pendingFolioCount === 1 ? '' : 's'})
      </button>
    ` : '';

    // Botón exportar CSV del histórico — para que orientación/dirección
    // descarguen la lista completa de correcciones del ciclo escolar.
    const totalInTab = filtered.length;
    const exportBtn = totalInTab > 0 ? `
      <button id="gc-export-csv" class="btn btn-sm btn-outline" style="font-size:12px;" title="Descargar histórico de este tab como CSV">
        <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">download</span>
        Exportar ${totalInTab} a CSV
      </button>
    ` : '';

    // Resumen de totales sobre TODO el ciclo (visible siempre, no solo tab).
    // Para tabs aún NO cargados (lazy), mostrar '?' en vez de mentir con 0.
    const fmt = (status) => _loadedTabs.has(status) ? folioCnt[status].size : '?';
    const totalCorrAplicadas = fmt('applied');
    const totalCorrPendientes = fmt('pending');
    const totalCorrRechazadas = fmt('rejected');
    const totalCorrCanceladas = fmt('cancelled');

    root.innerHTML = `
      <div class="card" style="background:#fafbff;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:10px;">
          <h3 class="section-title" style="margin:0;">
            <span class="material-icons-round" style="vertical-align:middle;">assignment</span>
            Solicitudes y correcciones del ciclo escolar
          </h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            ${exportBtn}
            ${bulkApplyBtn}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${tabsHtml}</div>
        <!-- v8.37: filtro por maestro — útil para encontrar las solicitudes de un docente específico cuando hay muchas -->
        ${teacherOpts ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <label style="font-size:12px;color:#475569;font-weight:600;">Filtrar por maestro:</label>
          <select id="gc-filter-teacher" style="padding:4px 8px;font-size:12px;border:1px solid #cbd5e0;border-radius:4px;min-width:180px;">
            <option value="">— Todos los maestros —</option>
            ${teacherOpts}
          </select>
          ${_filterByTeacher ? `<span style="font-size:11px;color:#64748b;font-style:italic;">Filtrado activo · ${filtered.length} de ${_allRequests.filter(r => r.status === _activeTab).length} folios</span>` : ''}
        </div>
        ` : ''}
        <div style="font-size:12px;color:#64748b;font-style:italic;margin-bottom:6px;">${S(tabDesc)}</div>
        <div style="font-size:11px;color:#475569;background:#f1f5f9;padding:6px 10px;border-radius:4px;">
          <strong>Total del ciclo:</strong>
          <span style="color:#d97706;">${totalCorrPendientes} pendientes</span> ·
          <span style="color:#6366f1;">${totalCorrAplicadas} aplicadas</span> ·
          <span style="color:#dc2626;">${totalCorrRechazadas} rechazadas</span> ·
          <span style="color:#64748b;">${totalCorrCanceladas} canceladas</span>
        </div>
      </div>
      <div>${cards}</div>
    `;

    // Eventos
    root.querySelectorAll('[data-action="gc-tab"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        _renderPendingRequests();
      });
    });
    root.querySelectorAll('[data-action="gc-mark-received"]').forEach(btn => {
      btn.addEventListener('click', () => _markReceived(btn.dataset.folio));
    });
    root.querySelectorAll('[data-action="gc-mark-authorized"]').forEach(btn => {
      btn.addEventListener('click', () => _markAuthorized(btn.dataset.folio));
    });
    root.querySelectorAll('[data-action="gc-apply-folio"]').forEach(btn => {
      btn.addEventListener('click', () => _applyFolio(btn.dataset.folio));
    });
    root.querySelectorAll('[data-action="gc-reject-folio"]').forEach(btn => {
      btn.addEventListener('click', () => _rejectFolio(btn.dataset.folio));
    });
    // v8.37: archivar/borrar folio (admin/subdirector)
    root.querySelectorAll('[data-action="gc-archive-folio"]').forEach(btn => {
      btn.addEventListener('click', () => _archiveFolio(btn.dataset.folio));
    });
    // v8.37: filtro por maestro
    const teacherFilterEl = document.getElementById('gc-filter-teacher');
    if (teacherFilterEl) {
      teacherFilterEl.addEventListener('change', () => {
        _filterByTeacher = teacherFilterEl.value || '';
        _renderPendingRequests();
      });
    }
    document.getElementById('gc-apply-all-pending')?.addEventListener('click', _applyAllPendingFolios);
    document.getElementById('gc-export-csv')?.addEventListener('click', () => _exportCorrectionsCsv(filtered));
  }

  // v8.37: borrar permanentemente todas las filas de un folio.
  // Confirma con el usuario antes de borrar — la acción es irreversible.
  // Útil para limpiar duplicados, capturas erróneas, pruebas de testeo.
  async function _archiveFolio(folio) {
    if (!folio) return;
    const items = _allRequests.filter(r => r.folio === folio);
    if (items.length === 0) { Toast.show('Folio no encontrado', 'warning'); return; }
    const first = items[0];
    const ok = confirm(
      `¿Borrar permanentemente el folio ${folio}?\n\n` +
      `Maestro: ${_fmtName(first.requestedByName)}\n` +
      `Materia: ${first.subjectName || ''}\n` +
      `Grupo: ${first.groupName || ''}\n` +
      `Filas (alumnos): ${items.length}\n\n` +
      `Esta acción NO se puede deshacer. Las calificaciones ya aplicadas en /grades NO se tocan, ` +
      `solo se borra el registro de la solicitud.`
    );
    if (!ok) return;
    try {
      const batch = db.batch();
      for (const it of items) {
        batch.delete(db.collection('gradeCorrections').doc(it.id));
      }
      await batch.commit();
      Toast.show(`Folio ${folio} borrado (${items.length} ${items.length === 1 ? 'fila' : 'filas'})`, 'success');
      await _renderPendingRequests(true);
    } catch (e) {
      console.error('Error al borrar folio:', e);
      Toast.show('No se pudo borrar: ' + (e.message || 'error'), 'error');
    }
  }

  // Exporta las correcciones del tab activo como CSV descargable.
  // Útil para auditoría: orientación/dirección puede revisar el ciclo completo
  // en Excel con filtros, orden por fecha, búsqueda por alumno, etc.
  function _exportCorrectionsCsv(items) {
    if (!items || items.length === 0) {
      Toast.show('No hay registros para exportar', 'info');
      return;
    }
    const esc = s => {
      const str = String(s == null ? '' : s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const fmtDate = (v) => {
      if (!v) return '';
      const d = v.toDate ? v.toDate() : new Date(v);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const lines = [];
    lines.push([
      'FOLIO', 'ESTADO', 'TURNO', 'GRUPO', 'ALUMNO', 'MATERIA', 'PARCIAL',
      'CAL ANTERIOR', 'CAL NUEVA', 'MOTIVO',
      'SOLICITANTE', 'FECHA SOLICITUD',
      'APLICADO POR', 'FECHA APLICACIÓN', 'OFICIO',
      'RECHAZADO POR', 'MOTIVO RECHAZO'
    ].map(esc).join(','));

    for (const c of items) {
      lines.push([
        c.folio || '',
        c.status || '',
        c.turno || '',
        c.groupName || c.groupId || '',
        c.studentName || '',
        K.getUACNombre(c.subjectName || c.subjectId || ''),
        c.partial || '',
        c.currentGrade != null ? c.currentGrade : (c.oldCal != null ? c.oldCal : '(sin captura)'),
        c.newGrade != null ? c.newGrade : (c.newCal != null ? c.newCal : ''),
        c.reason || c.motivo || '',
        c.requestedByName || '',
        fmtDate(c.requestedAt) || fmtDate(c.correctedAt),
        c.appliedByName || c.correctedByName || '',
        fmtDate(c.appliedAt) || fmtDate(c.correctedAt),
        c.authOficio || '',
        c.rejectedByName || '',
        c.rejectedReason || ''
      ].map(esc).join(','));
    }

    const csv = '﻿' + lines.join('\n'); // BOM para que Excel detecte UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `correcciones-${_activeTab}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    Toast.show(`CSV descargado: ${items.length} registros`, 'success');
  }

  function _renderFolioCard(folio, items, canManage, isWindowOpen) {
    const first = items[0];
    const status = first.status;

    const stateMeta = {
      pending:    { label: 'PENDIENTE',  color: '#d97706', bg: '#fef3c7', icon: 'schedule' },
      received:   { label: 'RECIBIDA',   color: '#0891b2', bg: '#cffafe', icon: 'inbox' },
      authorized: { label: 'AUTORIZADA', color: '#16a34a', bg: '#d1fae5', icon: 'verified' },
      applied:    { label: 'APLICADA',   color: '#6366f1', bg: '#e0e7ff', icon: 'check_circle' },
      rejected:   { label: 'RECHAZADA',  color: '#dc2626', bg: '#fee2e2', icon: 'cancel' },
      cancelled:  { label: 'ANULADA',    color: '#64748b', bg: '#f1f5f9', icon: 'block' },
    }[status] || { label: status, color: '#64748b', bg: '#f1f5f9', icon: 'help' };

    const fmt = (ts) => ts?.toDate
      ? ts.toDate().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';

    const itemRows = items.map(it => {
      const cur = it.currentGrade !== undefined && it.currentGrade !== null ? it.currentGrade : 'S/C';
      return `<tr>
        <td>${S(Utils.displayName ? Utils.displayName(it.studentName) : it.studentName)}</td>
        <td style="text-align:center;color:${Number(cur) < 6 ? '#dc2626' : '#16a34a'};font-weight:700;">${S(cur)}</td>
        <td style="text-align:center;color:#0369a1;font-weight:700;">${it.newGrade}</td>
        <td style="font-size:12px;">${S(it.reason)}</td>
      </tr>`;
    }).join('');

    // Timeline simplificado: solo Creada → Aplicada
    const timelineSteps = [
      { key: 'created',    label: 'Solicitud creada por el maestro', done: true,                  ts: first.requestedAt,  who: first.requestedByName },
      { key: 'applied',    label: 'Autorizada y aplicada en sistema', done: status === 'applied', ts: first.appliedAt, who: first.appliedByName, oficio: first.authOficio },
    ];

    const timelineHtml = timelineSteps.map(s => {
      const icon = s.done ? 'check_circle' : 'radio_button_unchecked';
      const color = s.done ? '#16a34a' : '#cbd5e1';
      const tsStr = s.done && s.ts ? fmt(s.ts) : '';
      // v8.37: formatear nombre del que hizo la acción (antes salía "RAMIREZ OLIVIA PEÑA")
      const whoStr = s.done && s.who ? ` por ${S(_fmtName(s.who))}` : '';
      const oficio = s.oficio ? ` <span style="background:#fef3c7;padding:1px 6px;border-radius:4px;font-size:10px;">Oficio: ${S(s.oficio)}</span>` : '';
      return `<div style="display:flex;gap:8px;align-items:center;font-size:11px;color:${s.done ? '#1e293b' : '#94a3b8'};">
        <span class="material-icons-round" style="color:${color};font-size:14px;">${icon}</span>
        <span style="flex:1;"><strong>${S(s.label)}</strong>${tsStr ? ' · ' + S(tsStr) + whoStr + oficio : '<span style="color:#94a3b8;font-style:italic;"> — pendiente</span>'}</span>
      </div>`;
    }).join('');

    // Acciones simplificadas: UN solo boton "Autorizar y aplicar" o Rechazar.
    // canManage = admin/subdirector. Esos roles tienen acceso administrativo
    // y pueden aplicar SIEMPRE (no dependen de la ventana 17-18 de mayo).
    // v8.37: ADMIN/SUBDIRECTOR pueden ARCHIVAR (borrar) cualquier corrección
    // sin importar status (limpieza de duplicados, capturas erróneas, etc.).
    let actions = '';
    if (canManage && status === 'pending') {
      actions = `
        <button class="btn btn-sm" style="background:#16a34a;color:#fff;font-weight:700;" data-action="gc-apply-folio" data-folio="${S(folio)}" title="${isWindowOpen ? 'Ventana abierta' : 'Acceso administrativo — sin restricción de ventana'}">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">verified</span>
          Autorizar y aplicar
        </button>
        <button class="btn btn-sm btn-outline" data-action="gc-reject-folio" data-folio="${S(folio)}">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">close</span>
          Rechazar
        </button>`;
    }
    // Botón Archivar/Borrar disponible para admin en cualquier status
    if (canManage) {
      actions += `
        <button class="btn btn-sm btn-outline" data-action="gc-archive-folio" data-folio="${S(folio)}"
          style="color:#991b1b;border-color:#fca5a5;" title="Eliminar permanentemente este folio (todas sus filas). Úsalo solo para duplicados o errores.">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">delete_outline</span>
          Borrar
        </button>`;
    }

    // Si rechazada, mostrar motivo
    const rejInfo = status === 'rejected' && first.rejectedReason ? `
      <div style="background:#fee2e2;border-left:3px solid #dc2626;padding:8px 12px;margin-top:8px;font-size:12px;color:#991b1b;">
        <strong>Motivo de rechazo:</strong> ${S(first.rejectedReason)}
      </div>` : '';

    return `
      <div class="card" style="margin-bottom:10px;border-left:4px solid ${stateMeta.color};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
          <div style="flex:1;min-width:240px;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <strong style="font-size:14px;color:${stateMeta.color};">${S(folio)}</strong>
              <span style="background:${stateMeta.bg};color:${stateMeta.color};padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:0.5px;">
                <span class="material-icons-round" style="font-size:12px;vertical-align:middle;">${stateMeta.icon}</span>
                ${S(stateMeta.label)}
              </span>
            </div>
            <div style="font-size:12px;color:#475569;margin-top:4px;">
              ${S(_fmtName(first.requestedByName))} · ${S(first.groupName)} · ${S(K.getUACNombre(first.subjectName))} · ${S(K.PARCIALES.find(p => p.id === first.partial)?.nombre || first.partial)}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions}</div>
        </div>

        <div style="background:#f8fafc;border-radius:6px;padding:8px 12px;margin-bottom:8px;">
          ${timelineHtml}
        </div>

        <table class="table-light" style="font-size:12px;width:100%;">
          <thead><tr>
            <th>Alumno</th>
            <th style="text-align:center;width:80px;">Cal. actual</th>
            <th style="text-align:center;width:80px;">Cal. solicitada</th>
            <th>Motivo</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        ${rejInfo}
      </div>`;
  }

  // ─── Marcar como Recibida (papel llego a Direccion) ───
  async function _markReceived(folio) {
    const items = _allRequests.filter(r => r.folio === folio && r.status === 'pending');
    if (!items.length) return;

    if (!confirm(`Marcar el folio ${folio} como RECIBIDA?\n\nEsto significa que el papel firmado por el maestro llego fisicamente a Dirección.`)) return;

    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    let count = 0;

    for (const it of items) {
      try {
        await db.collection('gradeCorrections').doc(it.id).update({
          status: 'received',
          receivedAt: now,
          receivedBy: uid,
          receivedByName: _currentUserName(),
        });
        count++;
      } catch (e) {
        console.error(e);
      }
    }

    Toast.show(`Folio ${folio} marcado como recibida (${count}).`, 'success');
    await _renderPendingRequests(true);
  }

  // ─── Marcar como Autorizada (Karina firmo el papel) ───
  async function _markAuthorized(folio) {
    const items = _allRequests.filter(r => r.folio === folio && r.status === 'received');
    if (!items.length) return;

    const oficio = prompt('Número de oficio o nota de Dirección (opcional):');
    if (oficio === null) return;

    if (!confirm(`Marcar el folio ${folio} como AUTORIZADA?\n\nEsto significa que la directora ya firmo el formato fisico autorizando el cambio.`)) return;

    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    let count = 0;

    for (const it of items) {
      try {
        const updates = {
          status: 'authorized',
          authorizedAt: now,
          authorizedBy: uid,
          authorizedByName: _currentUserName(),
        };
        if (oficio.trim()) updates.authOficio = oficio.trim();
        await db.collection('gradeCorrections').doc(it.id).update(updates);
        count++;
      } catch (e) {
        console.error(e);
      }
    }

    Toast.show(`Folio ${folio} autorizado (${count}). Listo para aplicar el 17-18 de mayo.`, 'success');
    await _renderPendingRequests(true);
  }

  async function _applyFolio(folio) {
    // Admin/subdirector/directivo pueden aplicar SIEMPRE (acceso administrativo
    // de emergencia). Para otros roles la ventana 17-18 mayo sigue siendo el corte.
    const role = App.currentUser?.role;
    const canBypassWindow = (role === 'admin' || role === 'subdirector' || role === 'directivo' || role === 'secretario_escolar');
    if (!canBypassWindow && !_isWindowCurrentlyOpen()) {
      Toast.show('Ventana cerrada — solo se puede aplicar durante el 17-18 de mayo.', 'error');
      return;
    }
    const items = _allRequests.filter(p => p.folio === folio && p.status === 'pending');
    if (!items.length) {
      Toast.show('Esta solicitud no esta pendiente.', 'warning');
      return;
    }

    // Capturar oficio (opcional) — vincula papel fisico de Karina con el cambio digital
    const oficio = prompt(
      `Folio ${folio} — ${items.length} alumno(s)\n\n` +
      `Antes de aplicar verifica que tienes el formato fisico FIRMADO por la directora.\n\n` +
      `Número de oficio o nota de Dirección (opcional, pero recomendado):`
    );
    if (oficio === null) return; // cancelo

    if (!confirm(
      `¿AUTORIZAR Y APLICAR los cambios del folio ${folio}?\n\n` +
      `${items.length} alumno(s) serán modificados inmediatamente.\n\n` +
      `Esta accion queda registrada con tu nombre, fecha y hora. ` +
      `Solo procede si tienes el formato fisico firmado por la directora en mano.`
    )) return;

    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    let applied = 0, errors = 0;
    // BLINDAJE: _currentUserName() ya va envuelto en try/catch (nunca truena).
    const errorMsgs = [];   // razones REALES de error (para no mostrar "error" a secas)
    let allowLower = null;  // decisión única: ¿aplicar también los cambios que BAJAN la cal?

    const blocked = [];
    for (const it of items) {
      try {
        // 1) Actualizar grade real — usar ID DETERMINÍSTICO para evitar duplicados.
        //    BUG HISTÓRICO (corregido 2026-05-26):
        //    Antes se buscaba el doc por where(groupId,subjectId,studentId,partial).
        //    Si el alumno cambiaba de grupo entre la captura y la aplicación
        //    (o si la solicitud tenía un groupId distinto al doc real), la query
        //    devolvía empty y se creaba un doc nuevo con ID random. Resultado:
        //    dos docs para mismo (student,subject,partial), promedios inconsistentes
        //    entre boleta y concentrado. Casos detectados: ABRIL OLVERA y DEREK PORTILLO
        //    (folio SC-2026-3KW7ER, mayo 2026).
        //
        //    Fix: el ID determinístico ${studentId}_${subjectId}_${partial} es la
        //    fuente única de verdad. Si existe lo actualizamos; si no, lo creamos
        //    con ese mismo ID. Nunca creamos docs random.
        const gradeDocId = `${it.studentId}_${it.subjectId}_${it.partial}`;
        const gradeRef = db.collection('grades').doc(gradeDocId);
        const gradeSnap = await gradeRef.get();

        // ─── REPLICACIÓN AUTORIZADA por Dirección ─────────────────
        // Si la solicitud viene del módulo de replicación (source='replication_request'),
        // se copian además los rubros (EC/TR/PE/EX), las faltas y la suma del parcial
        // origen — no solo la cal. Y NO aplica el bloqueo "no bajar cal" porque hay
        // oficio autorizado por Dirección que respalda el cambio.
        const isReplication = it.source === 'replication_request';
        const repRubros = isReplication ? (it.replicationRubros || {}) : null;

        // ATÓMICO: la cal se ESCRIBE junto con el marcado "aplicada" en un solo
        // batch (ambos o ninguno). Aquí solo PREPARAMOS la escritura de la cal.
        let gradeWrite;
        if (!gradeSnap.exists) {
          // Crear con ID determinístico (no .add() que genera random).
          const payload = {
            groupId: it.groupId,
            subjectId: it.subjectId,
            studentId: it.studentId,
            partial: it.partial,
            cal: it.newGrade,
            value: it.newGrade,
            suma: isReplication && it.replicationSuma != null ? it.replicationSuma : it.newGrade,
            updatedAt: now,
            updatedBy: uid,
            correctionFolio: folio,
            correctedAt: now,
            correctedFromCal: null,
          };
          if (isReplication) {
            if (repRubros.ec != null) payload.ec = repRubros.ec;
            if (repRubros.tr != null) payload.tr = repRubros.tr;
            if (repRubros.pe != null) payload.pe = repRubros.pe;
            if (repRubros.ex != null) payload.ex = repRubros.ex;
            if (it.replicationFaltas != null) payload.faltas = it.replicationFaltas;
          }
          gradeWrite = (b) => b.set(gradeRef, payload);
        } else {
          const existing = gradeSnap.data() || {};
          const currentReal = Number(existing.cal);
          // REGLA EPO 67: nunca bajar la calificacion via SOLICITUD DE MAESTRO.
          // PERO la replicación autorizada por Dirección puede SUBIR o BAJAR
          // (depende del caso autorizado). Skip el chequeo si es replicación.
          if (!isReplication && !isNaN(currentReal) && Number(it.newGrade) < currentReal) {
            // La cal solicitada es MENOR que la actual (suele ser una solicitud
            // vieja: el maestro ya re-capturó más alto). Antes esto BLOQUEABA y
            // dejaba la solicitud atorada para siempre. Ahora Dirección decide:
            // tiene autoridad para aplicarla con el oficio firmado. Se pregunta
            // UNA vez por folio y se respeta la decisión.
            if (allowLower === null) {
              allowLower = confirm(
                `Aviso: hay cambios que BAJAN la calificación.\n\n` +
                `Ej.: ${it.studentName} tiene ${currentReal} en el sistema y se solicitó ${it.newGrade}.\n\n` +
                `¿Aplicarlos de todos modos? Solo si Dirección lo autoriza con el oficio firmado.\n\n` +
                `Aceptar = aplicar también los que bajan.\n` +
                `Cancelar = omitir SOLO esos (los demás sí se aplican).`
              );
            }
            if (!allowLower) {
              blocked.push(`${it.studentName} (actual ${currentReal}, solicitada ${it.newGrade}) — omitido por ti`);
              continue; // omitido por TU decisión, NO cuenta como error
            }
            // Autorizado por Dirección → continúa y aplica el cambio normalmente.
          }
          const updates = {
            cal: it.newGrade,
            value: it.newGrade,
            suma: isReplication && it.replicationSuma != null ? it.replicationSuma : it.newGrade,
            updatedAt: now,
            updatedBy: uid,
            correctionFolio: folio,
            correctedAt: now,
            correctedFromCal: existing.cal,
            previousCal: firebase.firestore.FieldValue.delete(),
          };
          if (isReplication) {
            if (repRubros.ec != null) updates.ec = repRubros.ec;
            if (repRubros.tr != null) updates.tr = repRubros.tr;
            if (repRubros.pe != null) updates.pe = repRubros.pe;
            if (repRubros.ex != null) updates.ex = repRubros.ex;
            if (it.replicationFaltas != null) updates.faltas = it.replicationFaltas;
          }
          gradeWrite = (b) => b.update(gradeRef, updates);
        }

        // 2) ATÓMICO: la cal (paso 1) y el marcado "aplicada" (paso 2) se
        //    guardan JUNTOS en un solo batch. Si algo falla, NO se escribe nada
        //    (estado limpio, reintentable) — nunca queda "cal cambiada pero
        //    solicitud pendiente".
        const corrUpdates = {
          status: 'applied',
          appliedAt: now,
          appliedBy: uid,
          appliedByName: _currentUserName(), // blindado (try/catch, no truena)
        };
        if (typeof oficio === 'string' && oficio.trim()) {
          corrUpdates.authOficio = oficio.trim();
        }
        const batch = db.batch();
        gradeWrite(batch);
        batch.update(db.collection('gradeCorrections').doc(it.id), corrUpdates);
        await batch.commit();

        // 3) Bitacora
        if (typeof DB !== 'undefined' && DB.audit) {
          DB.audit('corrección', 'calificación', it.id, {
            description: `Cal. corregida por folio ${folio}: ${it.studentName} ${it.subjectName} (${it.currentGrade}→${it.newGrade})`,
            after: { folio, studentId: it.studentId, newGrade: it.newGrade }
          });
        }

        applied++;
      } catch (e) {
        console.error('Error aplicando ' + it.id + ':', e);
        // BLINDAJE: guardar la RAZÓN real para mostrarla (no un "error" a secas).
        errorMsgs.push(`${it.studentName || it.studentId}: ${(e && e.message) || e}`);
        errors++;
      }
    }

    if (errors === 0) {
      Toast.show(`Folio ${folio}: ${applied} cambio(s) aplicado(s).`, 'success');
    } else {
      Toast.show(`Folio ${folio}: ${applied} aplicado(s), ${errors} con error.`, 'warning');
    }
    if (errorMsgs.length) {
      // Mostrar el motivo técnico real para que Dirección sepa qué pasó y no
      // se quede con un "error" sin explicación.
      alert(
        'Algunas no se aplicaron por un error técnico:\n\n' + errorMsgs.join('\n') +
        '\n\nRefresca la página e intenta de nuevo. Si persiste, reporta a Soporte (WhatsApp 55 1078 2357).'
      );
    }
    if (blocked.length) {
      // Solicitudes que BAJAN la cal y que TÚ decidiste omitir (siguen pendientes).
      alert(
        'Estas solicitudes BAJAN la calificación y las OMITISTE (siguen pendientes):\n\n' + blocked.join('\n') +
        '\n\nSi Dirección autoriza bajarlas, vuelve a darle "Autorizar y aplicar" y elige "Aceptar" en el aviso.'
      );
    }

    Store.invalidate('grades');
    await _renderPendingRequests(true);
  }

  // ─── APLICAR TODAS LAS SOLICITUDES PENDIENTES DE UN GOLPE ───
  // Solo admin/subdirector. Una sola confirmación, un oficio (opcional)
  // para todos los folios, y reporte agregado al final.
  async function _applyAllPendingFolios() {
    const role = App.currentUser?.role;
    const canBypassWindow = (role === 'admin' || role === 'subdirector' || role === 'directivo' || role === 'secretario_escolar');
    if (!canBypassWindow && !_isWindowCurrentlyOpen()) {
      Toast.show('Ventana cerrada — solo se puede aplicar durante el 17-18 de mayo.', 'error');
      return;
    }

    const allPending = _allRequests.filter(p => p.status === 'pending');
    if (allPending.length === 0) {
      Toast.show('No hay solicitudes pendientes.', 'info');
      return;
    }

    // Agrupar por folio para conteos
    const folioGroups = {};
    allPending.forEach(it => {
      if (!folioGroups[it.folio]) folioGroups[it.folio] = [];
      folioGroups[it.folio].push(it);
    });
    const folioCount = Object.keys(folioGroups).length;
    const itemCount = allPending.length;

    // Resumen para mostrar en confirmación
    const summary = Object.entries(folioGroups).map(([folio, items]) => {
      const teacher = items[0].requestedByName || '?';
      const subject = K.getUACNombre(items[0].subjectName || items[0].subjectId);
      return `• ${folio} — ${teacher} — ${subject} (${items.length} alumno${items.length === 1 ? '' : 's'})`;
    }).join('\n');

    const oficio = prompt(
      `APLICAR TODAS LAS SOLICITUDES PENDIENTES\n\n` +
      `${folioCount} folio${folioCount === 1 ? '' : 's'} · ${itemCount} cambio${itemCount === 1 ? '' : 's'} de calificación en total:\n\n` +
      `${summary}\n\n` +
      `Antes de continuar verifica que tienes el formato físico FIRMADO por la directora para CADA folio.\n\n` +
      `Número de oficio o nota de Dirección (opcional — se asigna a TODOS los folios). Deja vacío y dale OK para continuar sin oficio:`
    );
    if (oficio === null) return; // canceló

    if (!confirm(
      `¿AUTORIZAR Y APLICAR los ${itemCount} cambio${itemCount === 1 ? '' : 's'} de ${folioCount} folio${folioCount === 1 ? '' : 's'}?\n\n` +
      `Esta acción es masiva y NO se puede deshacer fácilmente. ` +
      `Quedará registrada con tu nombre, fecha y hora para cada cambio.\n\n` +
      `Solo procede si tienes TODOS los formatos físicos firmados por la directora en mano.`
    )) return;

    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = firebase.firestore.FieldValue.serverTimestamp();

    let applied = 0, errors = 0;
    const blocked = [];   // bloqueados por la regla "no bajar cal"
    const errorList = []; // otros errores
    const appliedFolios = new Set();

    // Mostrar toast de progreso
    Toast.show(`Aplicando ${itemCount} cambio(s)... espera, no cierres la pestaña.`, 'info', 30000);

    // Procesar todos los items en serie (más predecible que paralelo y respeta orden)
    for (const it of allPending) {
      try {
        // ID determinístico — única fuente de verdad. Ver comentario en _applyFolio
        // sobre el bug histórico de docs duplicados (folio SC-2026-3KW7ER mayo 2026).
        const gradeDocId = `${it.studentId}_${it.subjectId}_${it.partial}`;
        const gradeRef = db.collection('grades').doc(gradeDocId);
        const gradeSnap = await gradeRef.get();

        if (!gradeSnap.exists) {
          await gradeRef.set({
            groupId: it.groupId,
            subjectId: it.subjectId,
            studentId: it.studentId,
            partial: it.partial,
            cal: it.newGrade,
            value: it.newGrade,
            suma: it.newGrade,
            updatedAt: now,
            updatedBy: uid,
            correctionFolio: it.folio,
            correctedAt: now,
            correctedFromCal: null,
          });
        } else {
          const existing = gradeSnap.data() || {};
          const currentReal = Number(existing.cal);
          if (!isNaN(currentReal) && Number(it.newGrade) < currentReal) {
            blocked.push(`${it.folio} · ${it.studentName} (actual ${currentReal}, solicitada ${it.newGrade})`);
            errors++;
            continue;
          }
          // Reemplazo: cal/value/suma quedan en el nuevo valor.
          // Historial vivo en /gradeCorrections. previousCal limpiado.
          await gradeRef.update({
            cal: it.newGrade,
            value: it.newGrade,
            suma: it.newGrade,
            updatedAt: now,
            updatedBy: uid,
            correctionFolio: it.folio,
            correctedAt: now,
            correctedFromCal: existing.cal,
            previousCal: firebase.firestore.FieldValue.delete(),
          });
        }

        // Marcar solicitud como aplicada
        const updates = {
          status: 'applied',
          appliedAt: now,
          appliedBy: uid,
          appliedByName: _currentUserName(),
        };
        if (typeof oficio === 'string' && oficio.trim()) {
          updates.authOficio = oficio.trim();
        }
        await db.collection('gradeCorrections').doc(it.id).update(updates);

        // Bitácora
        if (typeof DB !== 'undefined' && DB.audit) {
          DB.audit('corrección masiva', 'calificación', it.id, {
            description: `Cal. corregida (lote) por folio ${it.folio}: ${it.studentName} ${it.subjectName} (${it.currentGrade}→${it.newGrade})`,
            after: { folio: it.folio, studentId: it.studentId, newGrade: it.newGrade }
          });
        }

        applied++;
        appliedFolios.add(it.folio);
      } catch (e) {
        console.error('Error aplicando item ' + it.id + ' del folio ' + it.folio + ':', e);
        errorList.push(`${it.folio} · ${it.studentName || it.studentId}: ${e.message || 'error'}`);
        errors++;
      }
    }

    // Resultado final
    if (errors === 0) {
      Toast.show(`✅ ${applied} cambio(s) aplicado(s) en ${appliedFolios.size} folio(s). ¡Listo!`, 'success', 8000);
    } else if (applied === 0) {
      Toast.show(`❌ Ninguno aplicado · ${errors} con error.`, 'error', 8000);
    } else {
      Toast.show(`⚠ ${applied} aplicado(s) · ${errors} con error · revisa el detalle.`, 'warning', 8000);
    }

    if (blocked.length || errorList.length) {
      const parts = [];
      if (blocked.length) {
        parts.push(
          'BLOQUEADOS (regla EPO 67: no bajar calificaciones):\n' +
          blocked.join('\n')
        );
      }
      if (errorList.length) {
        parts.push(
          'ERRORES TÉCNICOS:\n' +
          errorList.join('\n')
        );
      }
      alert(parts.join('\n\n') + '\n\nEstos siguen pendientes hasta resolverlos manualmente.');
    }

    Store.invalidate('grades');
    await _renderPendingRequests(true);
  }

  async function _rejectFolio(folio) {
    const motivo = prompt('Motivo de rechazo (obligatorio):');
    if (!motivo || !motivo.trim()) {
      Toast.show('Operación cancelada.', 'info');
      return;
    }

    const items = _allRequests.filter(p => p.folio === folio && !['applied','rejected','cancelled'].includes(p.status));
    if (!items.length) return;

    if (!confirm(`¿Rechazar el folio ${folio} (${items.length} alumno(s))?\n\nMotivo: ${motivo}`)) return;

    const db = firebase.firestore();
    const uid = firebase.auth().currentUser.uid;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    let count = 0;

    for (const it of items) {
      try {
        await db.collection('gradeCorrections').doc(it.id).update({
          status: 'rejected',
          rejectedAt: now,
          rejectedBy: uid,
          rejectedByName: _currentUserName(),
          rejectedReason: motivo.trim(),
        });
        count++;
      } catch (e) {
        console.error('Error rechazando ' + it.id, e);
      }
    }

    Toast.show(`Folio ${folio}: ${count} solicitud(es) rechazada(s).`, 'info');
    await _renderPendingRequests(true);
  }

  const S = (v) => Utils.sanitize(String(v ?? ''));

  // Hook al render inicial: cuando termine la pantalla principal, cargar el panel manual y los pendientes.
  // Se hace via parche al objeto retornado.
  const _origRender = render;
  async function renderWithExtras() {
    await _origRender();
    await _renderManualWindowPanel();
    await _renderPendingRequests();
  }

  return { render: renderWithExtras };
})();

Router.modules['grade-corrections'] = () => GradeCorrectionsModule.render();
