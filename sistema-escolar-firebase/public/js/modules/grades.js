/**
 * MÓDULO DE CALIFICACIONES — Sistema Escolar EPO 67
 *
 * Vista maestro: cards de asignaciones → editor con rubros (Evaluación Continua,
 *   Transversal, Examen Parcial -solo vesp-, Punto Extra)
 *   auto-cálculo de SUMA y CAL, campo de FALTAS
 *   Solo editable cuando el parcial está abierto (o con override)
 *
 * Vista admin/orientador: filtros cascada Turno→Grado→Grupo→Parcial→Materia→Docente
 *   tabla con rubros completos, solo lectura (orientador), edición (admin)
 *
 * Rubros por turno:
 *   MATUTINO:   Evaluación Continua (máx 8) + Transversal (máx 2) + Punto Extra = SUMA → CAL
 *   VESPERTINO: Evaluación Continua (máx 5) + Examen Parcial (máx 3) + Transversal (máx 2) + Punto Extra = SUMA → CAL
 *
 * Regla redondeo: ≥6 normal, <6 truncar (5.9→5). Mín 5, Máx 10.
 */

const GradesModule = (function () {
  const CONTAINER = '#moduleContainer';

  // ─── Teacher view state ───
  let selectedGroup = null;
  let selectedSubject = null;
  let currentPartial = 'P1';
  // v8.10: grado del grupo actual (1, 2 ó 3) — usado por el banner de fechas
  // críticas para resolver byGrade del config/captureWindow.
  let _moduleCurrentGrado = null;
  // Status de extraordinario/riesgo de cada alumno EN LA MATERIA actualmente
  // seleccionada. Calculado al cargar el editor (loadGrades) y consumido por
  // el banner de alertas en _renderGradeEditor.
  let _statusByStudent = {};

  /**
   * Calcula el estatus (APROBADO / EN_RIESGO_* / EXTRA_*) de cada alumno en
   * la materia actualmente seleccionada del editor. Carga las horas impartidas
   * de los 3 parciales (teacherHours) para evaluar la regla de >20% faltas.
   * Se llama en background — el render lee el resultado cuando esté listo.
   * Si el cálculo falla, _statusByStudent queda vacío y simplemente no se
   * muestra el banner (no rompe la captura).
   */
  // Estado adicional para el banner: qué parciales tienen horas capturadas
  // y cuáles están cerrados. _statusByStudent se declaró arriba (línea ~29).
  let _horasCapturadas = { P1: false, P2: false, P3: false };
  let _parcialesCerrados = { P1: false, P2: false, P3: false };

  async function _computeStatusForCurrentEditor(groupId, subjectId) {
    _statusByStudent = {};
    _horasCapturadas = { P1: false, P2: false, P3: false };
    if (!groupId || !subjectId || !students.length) return;

    // Cargar horas semestrales. Por compatibilidad puede existir el doc viejo
    // por parcial (P1/P2/P3) o el nuevo doc canónico SEMESTRE. Para cálculo de
    // riesgo se usa la mejor captura disponible en los tres parciales, porque
    // las horas NO son tres capturas distintas.
    const hoursByPart = {};
    try {
      if (window.db) {
        const hourKeys = ['SEMESTRE', 'P3', 'P2', 'P1'];
        const docs = await Promise.all(hourKeys.map(p => {
          const docId = `${groupId}_${subjectId}_${p}`;
          return window.db.collection('teacherHours').doc(docId).get()
            .then(d => d.exists ? d.data() : null)
            .catch(() => null);
        }));
        const MESES = ['febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio'];
        const sumHoras = (data) => data ? MESES.reduce((s, m) => s + Number(data[m] || 0), 0) : 0;
        let bestHours = null;
        let bestTotal = 0;
        docs.forEach(data => {
          const total = sumHoras(data);
          if (total > bestTotal) {
            bestHours = data;
            bestTotal = total;
          }
        });
        ['P1', 'P2', 'P3'].forEach((p) => {
          hoursByPart[p] = bestHours;
          _horasCapturadas[p] = bestTotal > 0;
        });
      }
      // Cargar también qué parciales están cerrados
      const partials = await Store.getPartials(false);
      ['P1', 'P2', 'P3'].forEach(pid => {
        const pdoc = (partials || []).find(p => p.id === pid);
        _parcialesCerrados[pid] = !!(pdoc && pdoc.locked);
      });
    } catch (_) {}

    // Calcular estatus por alumno (con nombre para el banner)
    const studByDocId = {};
    students.forEach(s => { studByDocId[s.docId] = s; });
    for (const stu of students) {
      const sid = stu.docId;
      const grades3 = [
        grades[`${sid}_${subjectId}_P1`] || null,
        grades[`${sid}_${subjectId}_P2`] || null,
        grades[`${sid}_${subjectId}_P3`] || null,
      ];
      const st = App.calcStatusExtraordinario({ grades3, hoursByPart });
      _statusByStudent[sid] = { ...st, studentName: stu.nombreCompleto || '' };
    }
    // Re-render el editor para mostrar el banner (la primera vez puede que
    // ya esté renderizado sin los datos de status).
    try {
      const container = _container && _container();
      if (container && container.querySelector('table')) {
        const oldBanner = document.getElementById('ge-status-banner');
        const newHtml = _renderStatusBanner();
        if (oldBanner) oldBanner.outerHTML = newHtml;
      }
    } catch (_) {}
  }

  // REGLA EPO 67 (v8.01, revisada):
  // Las horas impartidas son SEMESTRALES (febrero–julio) — no cambian entre
  // parciales. Históricamente los maestros capturan TODOS los meses del
  // semestre en UN SOLO doc (la auditoría mostró 213/214 docs solo en P2).
  // El cálculo del % de inasistencias funciona perfecto con el total
  // semestral, así que basta con que UN parcial tenga horas para considerar
  // que el semestre está cubierto.
  //
  // ANTES: requería P1 && P2 && P3 (forzaba ENCADENAR), pero el sistema
  // marcaba "falta capturar" aunque el maestro YA había capturado en P2.
  // AHORA: si hay horas en CUALQUIER parcial, se considera capturado.
  function _horasCompletasParaExtra() {
    return _horasCapturadas.P1 || _horasCapturadas.P2 || _horasCapturadas.P3;
  }

  function _renderStatusBanner() {
    const vals = Object.values(_statusByStudent);
    if (vals.length === 0) return '<div id="ge-status-banner"></div>';

    // Clasificación
    const extraCalList    = vals.filter(s => s.estatus === 'EXTRA_CAL');
    const extraFaltasList = vals.filter(s => s.estatus === 'EXTRA_FALTAS');
    const extraAmbasList  = vals.filter(s => s.estatus === 'EXTRA_AMBAS');
    const riesgoCalList    = vals.filter(s => s.estatus === 'EN_RIESGO_CAL');
    const riesgoFaltasList = vals.filter(s => s.estatus === 'EN_RIESGO_FALTAS');
    const riesgoAmbasList  = vals.filter(s => s.estatus === 'EN_RIESGO_AMBAS');

    const horasOk = _horasCompletasParaExtra();
    // Las horas son SEMESTRALES — basta con que UN parcial las tenga. El chip
    // de alerta solo aparece cuando NINGÚN parcial tiene horas capturadas.
    const parcialesSinHoras = horasOk ? [] : ['P1', 'P2', 'P3'].filter(pid => !_horasCapturadas[pid]);
    const showFaltas = horasOk;

    // Conteos para el chip principal
    const totExtra = extraCalList.length + extraAmbasList.length + (showFaltas ? extraFaltasList.length : 0);
    const totRiesgo = riesgoCalList.length + riesgoAmbasList.length + (showFaltas ? riesgoFaltasList.length : 0);

    // Sin alertas y horas OK → chip verde compacto
    if (totExtra === 0 && totRiesgo === 0 && horasOk) {
      return `<div id="ge-status-banner" style="background:#dcfce7;border-left:3px solid #16a34a;padding:6px 12px;margin-bottom:10px;border-radius:5px;font-size:12px;color:#166534;">
        ✓ Sin alertas — todos los alumnos cumplen la regla.
      </div>`;
    }

    // Helpers para la sección expandible
    const fmtName = (n) => Utils.displayName ? Utils.displayName(n) : (n || '');
    const renderList = (list, color) => list.length === 0 ? '' :
      `<ul style="margin:2px 0 6px 18px;padding:0;font-size:11.5px;color:${color};line-height:1.45;">
        ${list.map(s => `<li><strong>${Utils.sanitize(fmtName(s.studentName))}</strong> <span style="color:#64748b;">— ${Utils.sanitize(s.causa || '')}</span></li>`).join('')}
      </ul>`;

    // Construir secciones (solo las que tienen contenido)
    const secciones = [];
    if (extraCalList.length)    secciones.push({ titulo: 'Extraordinario por calificación', list: extraCalList, color: '#991b1b' });
    if (showFaltas && extraFaltasList.length) secciones.push({ titulo: 'Extraordinario por faltas', list: extraFaltasList, color: '#991b1b' });
    if (showFaltas && extraAmbasList.length)  secciones.push({ titulo: 'Extraordinario por calificación y faltas', list: extraAmbasList, color: '#991b1b' });
    if (!showFaltas && extraAmbasList.length) secciones.push({ titulo: 'Extraordinario por calificación', subtitulo: '(faltas no evaluadas)', list: extraAmbasList, color: '#991b1b' });
    if (riesgoCalList.length)    secciones.push({ titulo: 'Riesgo de extraordinario por calificación', list: riesgoCalList, color: '#b45309' });
    if (showFaltas && riesgoFaltasList.length) secciones.push({ titulo: 'Riesgo de extraordinario por faltas', list: riesgoFaltasList, color: '#b45309' });
    if (showFaltas && riesgoAmbasList.length)  secciones.push({ titulo: 'Riesgo por calificación y faltas', list: riesgoAmbasList, color: '#b45309' });
    if (!showFaltas && riesgoAmbasList.length) secciones.push({ titulo: 'Riesgo de extraordinario por calificación', subtitulo: '(faltas no evaluadas)', list: riesgoAmbasList, color: '#b45309' });

    const detallesHtml = secciones.map(s => `
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;">
        <div style="font-size:12px;font-weight:700;color:${s.color};margin-bottom:2px;">
          ${s.titulo} <span style="font-weight:400;color:#64748b;">(${s.list.length})</span>
          ${s.subtitulo ? `<span style="font-weight:400;color:#94a3b8;font-size:11px;"> ${s.subtitulo}</span>` : ''}
        </div>
        ${renderList(s.list, s.color)}
      </div>
    `).join('');

    // Chips de conteo (1 línea)
    const chips = [];
    if (totExtra > 0) chips.push(`<span style="background:#fee2e2;color:#991b1b;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;">🚨 ${totExtra} EXTRA</span>`);
    if (totRiesgo > 0) chips.push(`<span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;">⚠️ ${totRiesgo} RIESGO</span>`);
    if (!horasOk) chips.push(`<span style="background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;">📅 falta capturar horas impartidas</span>`);

    // Banner ULTRA COMPACTO: una sola línea, expandible
    return `<div id="ge-status-banner" style="background:#fffbeb;border-left:3px solid #d97706;border-radius:5px;margin-bottom:10px;font-size:12px;">
      <details>
        <summary style="cursor:pointer;padding:6px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;list-style:none;">
          <span style="font-weight:700;color:#78350f;">Alertas en esta materia:</span>
          ${chips.join('')}
          <span style="margin-left:auto;color:#78350f;font-size:11px;text-decoration:underline;">ver detalles ▾</span>
        </summary>
        <div style="padding:0 12px 8px;">
          ${!horasOk ? `<div style="font-size:11px;color:#78350f;padding:4px 0 2px;line-height:1.45;">
            <strong>Cómo desbloquear avisos por inasistencias:</strong> baja al panel naranja <strong>"Horas impartidas"</strong> al final de la lista y captura las horas del semestre (basta con un parcial — las horas son semestrales).
          </div>` : ''}
          ${detallesHtml}
        </div>
      </details>
    </div>`;
  }

  let students = [];
  let assignments = [];
  let grades = {};
  let currentTurno = 'MATUTINO';
  let _listCleared = false;

  // ─── Admin view state ───
  let _admin = {
    allStudents: [], allGrades: [], allAssignments: [],
    allTeachers: [], allSubjects: [], allGroups: [], allPartials: [],
    turno: '', grado: '', grupo: '', parcial: '', materia: '', docente: ''
  };

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  function _el(id) { return document.getElementById(id); }
  function _container() { return document.querySelector(CONTAINER); }

  // BUGFIX v5.96 — el listener se acumulaba en cada render porque
  // _delegateClick se llamaba desde 3 lugares (renderTeacher, openGradeEditor,
  // renderAdmin). Cada addEventListener apilaba un handler nuevo. Resultado:
  // cada clic en Imprimir abría N pestañas (donde N = número de renders).
  // El flag previene duplicados. El listener es delegado en moduleContainer
  // (que persiste entre renders), así que un solo bind cubre todo.
  let _delegateBound = false;
  function _delegateClick(container) {
    if (_delegateBound) return;
    _delegateBound = true;
    container.addEventListener('click', async function (e) {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const a = t.dataset.action;
      if (a === 'open-editor') api.openGradeEditor(t.dataset.assignmentId, t.dataset.groupId, t.dataset.subjectId);
      else if (a === 'switch-assignment') {
        // Cambio de pestaña / botón Anterior-Siguiente
        const newAsgId = t.dataset.assignmentId;
        if (!newAsgId) return;
        if (!_canLeaveEditor('switch')) return;

        // BLOQUEO: si hay reprobados sin incidencia registrada, forzar captura
        const ok = await _enforceIncidentsBeforeLeave('cambiar de lista');
        if (!ok) return;

        // FIX (v7.83): antes de cambiar de lista, FLUSH del save pendiente.
        // Asi no se pierde el cambio recien tecleado si el maestro pulso Enter
        // y de inmediato cambio de materia/grupo (debounce de 3s no disparo).
        if (_isDirty) {
          await _flushAutoSaveAndWait();
          if (_isDirty) {
            // Si tras el flush sigue dirty (save fallo), preguntar
            if (!confirm('Hubo un problema guardando. ¿Cambiar de lista sin guardar?')) return;
          }
        }
        api.openGradeEditor(newAsgId, t.dataset.groupId, t.dataset.subjectId);
      }
      else if (a === 'switch-partial') {
        // FIX (v7.83): flush antes de cambiar de parcial — mismo motivo.
        if (_isDirty) {
          await _flushAutoSaveAndWait();
        }
        api.switchPartial(t.dataset.partial);
      }
      else if (a === 'save-grades') api.saveGrades();
      else if (a === 'recover-local-draft') _manualRecoverLocalDraft();
      else if (a === 'refresh-from-server') api.refreshFromServer();
      else if (a === 'clear-grades-list') _confirmClearCurrentList();
      else if (a === 'back-to-list') {
        if (!_canLeaveEditor('back')) return;

        // BLOQUEO: si hay reprobados sin incidencia, forzar captura
        const ok = await _enforceIncidentsBeforeLeave('volver a la lista de grupos');
        if (!ok) return;

        // FIX (v7.83): flush antes de salir — protege el cambio recien tecleado.
        if (_isDirty) {
          await _flushAutoSaveAndWait();
          if (_isDirty) {
            if (!confirm('Hubo un problema guardando. ¿Deseas salir sin guardar?')) return;
          }
        }
        _clearEditorState();
        api.renderTeacher();
      }
      else if (a === 'export-grades') api.exportGrades();
      else if (a === 'print-grades') api.printGrades();
      else if (a === 'print-selected-assignments') _printSelectedAssignments(false);
      else if (a === 'print-all-assignments') _printSelectedAssignments(true);
      else if (a === 'print-all-my-lists') _printAllMyListsFromEditor();
      else if (a === 'show-other-partials') _showOtherPartialsModal();
      else if (a === 'select-lists-to-print') _showSelectListsModal();
      else if (a === 'open-failure-incidents-modal') _openFailureIncidentsFromBanner();
      else if (a === 'toggle-paste-help') {
        const body = document.getElementById('paste-help-body');
        const chevron = document.getElementById('paste-help-chevron');
        if (body) {
          const isOpen = body.style.display !== 'none';
          body.style.display = isOpen ? 'none' : 'block';
          if (chevron) chevron.textContent = isOpen ? 'expand_more' : 'expand_less';
          try { localStorage.setItem('epo67_paste_help_collapsed', isOpen ? '1' : '0'); } catch (_) {}
        }
      }
      else if (a === 'print-admin-grades') api.printAdminGrades();
      else if (a === 'report-incident') _showIncidentModal(t.dataset.studentId, t.dataset.studentName);
    });
  }

  // Resuelve el parcial ACTIVO (primero NO bloqueado). Si todos bloqueados,
  // retorna el último. Esto es independiente del parcial que el maestro
  // esté VIENDO en el editor — evita errores como "imprimí P1 sin querer".
  async function _resolveActivePartial() {
    try {
      const partials = await Store.getPartials();
      const ordered = K.PARCIALES.map(kp => ({
        id: kp.id,
        nombre: kp.nombre,
        locked: partials.find(p => p.id === kp.id)?.locked === true,
      }));
      const open = ordered.find(p => !p.locked);
      return open || ordered[ordered.length - 1] || { id: 'P1', nombre: 'Primer Parcial', locked: false };
    } catch (e) {
      return { id: 'P1', nombre: 'Primer Parcial', locked: false };
    }
  }

  // Print TODAS las listas del maestro en UN solo PDF.
  // SIEMPRE usa el parcial ACTIVO (el actual/abierto), NO el que está viendo
  // en el editor — para evitar accidentes como el del maestro que imprimió P1
  // estando en captura de P2.
  async function _printAllMyListsFromEditor() {
    if (!_capAssignments || _capAssignments.length === 0) {
      Toast.show('No hay listas para imprimir', 'warning');
      return;
    }
    // BLOQUEO 1: si la lista actual tiene reprobados sin motivo, forzar captura
    // antes de imprimir. La lista impresa debe llevar TODOS los motivos.
    const ok = await _enforceIncidentsBeforeLeave('imprimir tus listas');
    if (!ok) return;
    const activePartial = await _resolveActivePartial();
    const btn = document.querySelector('[data-action="print-all-my-lists"]');
    const label = document.getElementById('print-all-label');
    const origText = label?.textContent || '';
    try {
      if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
      if (label) label.textContent = 'Generando PDF, espera…';
      const ids = _capAssignments.map(a => a.id);
      await printMultipleAssignments(ids, activePartial.id);
    } catch (e) {
      console.error('Error al generar PDF de todas las listas:', e);
      Toast.show('No se pudo generar el PDF: ' + (e.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
      if (label) label.textContent = origText;
    }
  }

  // Actualiza la zona de impresión al final del editor con:
  // (1) Nombre del parcial ACTIVO en el botón primario.
  // (2) Avance "X de Y listas completas" según assignmentStatusCache.
  // Se ejecuta async tras el render — no bloquea la pintura inicial.
  async function _updatePrintZoneAfterRender() {
    try {
      const labelEl = document.getElementById('print-all-label');
      const detailEl = document.getElementById('print-progress-detail');
      const warnEl = document.getElementById('print-progress-warning');
      const total = (_capAssignments || []).length;
      if (!labelEl && !detailEl) return;

      const activeP = await _resolveActivePartial();
      const parcialUpper = (activeP.nombre || 'PARCIAL ACTUAL').toUpperCase();
      if (labelEl) {
        const word = total === 1 ? 'LISTA' : 'LISTAS';
        // Texto compacto para la tarjeta (la palabra "RECOMENDADO" ya está visible arriba)
        labelEl.textContent = `TODAS MIS ${total || ''} ${word} DEL ${parcialUpper}`;
      }

      // Avance — solo si tenemos asignaciones
      if (!detailEl || total === 0) return;
      let cache;
      try {
        cache = await _loadAssignmentStatuses(activeP.id);
      } catch (e) {
        // Si falla (p.ej. reglas), mostrar mensaje genérico
        detailEl.textContent = `Vas a imprimir ${total} lista(s) del ${activeP.nombre}.`;
        return;
      }

      let complete = 0, partial = 0, empty = 0;
      for (const a of _capAssignments) {
        const st = cache[a.id]?.status;
        if (st === 'complete') complete++;
        else if (st === 'partial') partial++;
        else empty++;
      }
      const allDone = complete === total && total > 0;
      const pending = total - complete;
      if (allDone) {
        detailEl.innerHTML = `✅ ${complete} de ${total} listas completas. Ya puedes imprimir.`;
        detailEl.style.background = 'rgba(16,185,129,0.45)';
        if (warnEl) warnEl.style.borderColor = 'rgba(255,255,255,0.7)';
      } else {
        const parts = [];
        parts.push(`📊 ${complete} de ${total} completas`);
        if (partial > 0) parts.push(`⚠ ${partial} a medias`);
        if (empty > 0) parts.push(`⬜ ${empty} sin empezar`);
        detailEl.innerHTML = parts.join(' · ') + ` &nbsp;·&nbsp; te faltan <u>${pending}</u> antes de imprimir`;
        detailEl.style.background = 'rgba(0,0,0,0.25)';
      }
    } catch (e) {
      console.warn('No se pudo actualizar la zona de impresión:', e);
    }
  }

  // Modal: el maestro escoge MANUALMENTE cuáles de sus asignaciones incluir en
  // el PDF. Útil cuando solo quiere algunas (no todas). Pre-marca la lista que
  // está abierta en este momento.
  async function _showSelectListsModal() {
    if (!_capAssignments || _capAssignments.length === 0) {
      Toast.show('No hay listas para seleccionar.', 'warning');
      return;
    }
    const activeP = await _resolveActivePartial();
    const currentAsgId = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject)?.id;
    const total = _capAssignments.length;

    // Tarjetas con checkbox por cada asignación. La actual viene pre-marcada.
    const cards = _capAssignments.map(a => {
      const isCurrent = a.id === currentAsgId;
      const subjectName = K.getUACNombre(a.subjectName || a.subjectId);
      const groupName = a.groupName || a.groupId;
      const status = _assignmentStatusCache[a.id];
      let statusBadge = '';
      if (status) {
        if (status.status === 'complete') statusBadge = `<span style="background:#dcfce7;color:#14532d;font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;">✓ ${status.filled}/${status.total}</span>`;
        else if (status.status === 'partial') statusBadge = `<span style="background:#fef3c7;color:#78350f;font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;">⚠ ${status.filled}/${status.total}</span>`;
        else statusBadge = `<span style="background:#fee2e2;color:#7f1d1d;font-size:11px;padding:1px 6px;border-radius:4px;font-weight:700;">⬜ ${status.filled}/${status.total}</span>`;
      }
      const currentBadge = isCurrent ? '<span style="background:#3182ce;color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:4px;">ACTUAL</span>' : '';
      return `
        <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;background:#fff;border:2px solid ${isCurrent ? '#3182ce' : '#e5e7eb'};border-radius:8px;cursor:pointer;transition:border-color 0.15s;">
          <input type="checkbox" class="select-list-cb" value="${Utils.sanitize(a.id)}" ${isCurrent ? 'checked' : ''} style="margin-top:3px;transform:scale(1.2);flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:14px;color:#1e293b;line-height:1.25;">
              ${Utils.sanitize(groupName)}${currentBadge}
            </div>
            <div style="font-size:12.5px;color:#475569;margin-top:2px;">${Utils.sanitize(subjectName)}</div>
            <div style="margin-top:4px;">${statusBadge}</div>
          </div>
        </label>
      `;
    }).join('');

    const body = `
      <div style="font-size:13px;color:#374151;margin-bottom:12px;line-height:1.5;">
        Marca las listas que quieres incluir en el PDF del <strong>${Utils.sanitize(activeP.nombre)}</strong>.
        Solo se revisarán las listas marcadas; si necesitas una sola hoja, deja marcada únicamente esa.
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
        <div style="font-size:12px;color:#64748b;">
          Total disponibles: <strong>${total}</strong> · Seleccionadas:
          <strong id="sel-count">1</strong>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-outline btn-sm" id="sel-mark-all" type="button" style="font-size:12px;">
            Marcar todas
          </button>
          <button class="btn btn-outline btn-sm" id="sel-unmark-all" type="button" style="font-size:12px;">
            Desmarcar
          </button>
        </div>
      </div>
      <div style="max-height:55vh;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:8px;padding:2px;">
        ${cards}
      </div>
    `;

    const footer = `
      <button class="btn btn-outline" id="sel-cancel" type="button">Cancelar</button>
      <button class="btn btn-primary" id="sel-print" type="button" style="background:#16a34a;border-color:#15803d;">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">picture_as_pdf</span>
        Imprimir seleccionadas (<span id="sel-print-count">1</span>)
      </button>
    `;

    Modal.open(`Escoger listas para el ${activeP.nombre}`, body, footer);

    setTimeout(() => {
      const updateCount = () => {
        const n = document.querySelectorAll('.select-list-cb:checked').length;
        const elA = document.getElementById('sel-count');
        const elB = document.getElementById('sel-print-count');
        if (elA) elA.textContent = n;
        if (elB) elB.textContent = n;
        const btn = document.getElementById('sel-print');
        if (btn) btn.disabled = (n === 0);
        // resaltar tarjeta seleccionada
        document.querySelectorAll('.select-list-cb').forEach(cb => {
          const card = cb.closest('label');
          if (!card) return;
          if (cb.checked) {
            card.style.background = '#eff6ff';
            card.style.borderColor = '#3182ce';
          } else {
            card.style.background = '#fff';
            card.style.borderColor = '#e5e7eb';
          }
        });
      };
      document.querySelectorAll('.select-list-cb').forEach(cb => cb.addEventListener('change', updateCount));
      document.getElementById('sel-mark-all')?.addEventListener('click', () => {
        document.querySelectorAll('.select-list-cb').forEach(cb => cb.checked = true);
        updateCount();
      });
      document.getElementById('sel-unmark-all')?.addEventListener('click', () => {
        document.querySelectorAll('.select-list-cb').forEach(cb => cb.checked = false);
        updateCount();
      });
      document.getElementById('sel-cancel')?.addEventListener('click', () => Modal.close());
      document.getElementById('sel-print')?.addEventListener('click', async () => {
        const ids = [...document.querySelectorAll('.select-list-cb:checked')].map(cb => cb.value);
        if (ids.length === 0) return;
        Modal.close();
        try {
          await printMultipleAssignments(ids, activeP.id);
        } catch (e) {
          Toast.show('Error generando PDF: ' + (e.message || ''), 'error');
        }
      });
      updateCount();
    }, 60);
  }

  // Permite al maestro elegir explícitamente un parcial CERRADO para imprimir
  // todas sus listas. Se abre como modal con opciones (P1, P3, etc.).
  async function _showOtherPartialsModal() {
    const partials = await Store.getPartials();
    const activeP = await _resolveActivePartial();
    const others = K.PARCIALES.filter(p => p.id !== activeP.id);
    const opts = others.map(p => {
      const doc = partials.find(pp => pp.id === p.id);
      const locked = doc?.locked === true;
      const status = locked ? '🔒 Cerrado' : '🟢 Abierto';
      return `<button class="btn btn-outline" style="display:block;width:100%;margin-bottom:8px;padding:14px;text-align:left;" data-other-partial="${p.id}">
        <strong>${Utils.sanitize(p.nombre)}</strong> · ${status}
      </button>`;
    }).join('');
    const body = `
      <p style="font-size:14px;color:#374151;margin-bottom:12px;">
        El parcial actual ya está disponible arriba. Elige otro parcial para imprimir
        todas tus listas de ese periodo:
      </p>
      ${opts}
    `;
    Modal.open('Imprimir otro parcial', body, '<button class="btn btn-outline" id="other-p-cancel">Cancelar</button>');
    setTimeout(() => {
      document.querySelectorAll('[data-other-partial]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.otherPartial;
          Modal.close();
          if (!_capAssignments || _capAssignments.length === 0) return;
          try {
            Toast.show('Generando PDF…', 'info');
            await printMultipleAssignments(_capAssignments.map(a => a.id), pid);
          } catch (e) {
            Toast.show('Error: ' + (e.message || ''), 'error');
          }
        });
      });
      document.getElementById('other-p-cancel')?.addEventListener('click', () => Modal.close());
    }, 50);
  }

  // Verifica si hay alumnos reprobados sin incidencia y FUERZA al maestro a
  // capturarla antes de cambiar de lista. Si captura, persiste y permite seguir.
  // Si cancela, NO permite el cambio.
  async function _enforceIncidentsBeforeLeave(actionLabel) {
    // v8.33: NO bloqueamos nada por motivos de reprobación faltantes.
    // Olivia: el sistema tenía bloqueos demasiado intrusivos que impedían
    // a los maestros moverse entre listas o imprimir aunque la captura
    // estuviera bien. Ahora esto es solo un retorno true (sin bloqueo).
    // Si se necesita pedir motivos de reprobación, hay que hacerlo en un
    // flujo dedicado, no como gate de cada acción.
    return true;
    // —— código viejo deshabilitado ——
    if (!_isTeacherCaptureRole() || _listCleared) return true;
    if (!selectedSubject || !selectedGroup) return true;
    try {
      const rubros = K.getRubros(currentTurno);
      const failingStudents = _getFailingStudentsForIncident(rubros);
      if (failingStudents.length === 0) return true;
      const missing = await _getMissingFailureIncidents(failingStudents);
      if (missing.length === 0) return true;

      // Forzar captura. _collectFailureIncidentReasons retorna null si cancelan.
      const reports = await _collectFailureIncidentReasons(missing);
      if (reports === null) {
        Toast.show(`No puedes ${actionLabel} sin registrar el motivo de los alumnos reprobados.`, 'warning');
        return false;
      }
      if (!Array.isArray(reports) || reports.length === 0) return true;

      // Persistir incidencias en Firestore
      const currentList = _getCurrentListLabel();
      const batch = db.batch();
      reports.forEach(r => {
        const ref = db.collection('incidents').doc(_failureIncidentDocId(r.studentId));
        batch.set(ref, {
          studentId: r.studentId,
          groupId: selectedGroup,
          turno: currentTurno,
          type: 'academica',
          incidentKind: 'reprobación',
          requiredBy: 'switch-assignment',
          title: `Reprobación en ${currentList.subjectName}`,
          description: r.reason,
          subjectId: selectedSubject,
          subjectName: currentList.subjectName,
          partial: currentPartial,
          partialName: currentList.partialName,
          grade: r.cal,
          suma: r.suma,
          date: new Date(),
          status: 'activa',
          createdAt: new Date(),
          createdBy: auth.currentUser.uid,
        }, { merge: true });
      });
      await batch.commit();
      Toast.show(`Incidencias registradas (${reports.length}). Esto ayuda a Orientación cuando vienen los papás.`, 'success');
      return true;
    } catch (e) {
      console.error('Error verificando incidencias antes de cambiar de lista:', e);
      Toast.show('No se pudieron verificar las incidencias. Intenta de nuevo.', 'error');
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TEACHER VIEW — cards de asignaciones
  // ═══════════════════════════════════════════════════════════════

  // ─── Cascade filter state for teacher/admin assignment selection ───
  let _capAssignments = [];

  // ─── Assignment status cache (para las pestañas del editor) ───
  // { assignmentId: { filled: N, total: N, percent: 0..100, status: 'complete'|'partial'|'empty' } }
  let _assignmentStatusCache = {};
  let _assignmentStatusForPartial = null;  // 'P1' | 'P2' | 'P3'

  /** Carga grades de todos los grupos del maestro y pre-calcula el estado de cada
   *  asignación para el parcial dado. Invalida cache si cambia parcial. */
  async function _loadAssignmentStatuses(partial) {
    if (_assignmentStatusForPartial === partial && Object.keys(_assignmentStatusCache).length > 0) {
      return _assignmentStatusCache;
    }
    const groupIds = [...new Set(_capAssignments.map(a => a.groupId).filter(Boolean))];
    if (groupIds.length === 0) return {};

    try {
      // Para maestros, getStudents() es rechazado por las reglas. Usar query
      // filtrada por groupIds (los grupos del maestro) que sí está permitida.
      const role = App.currentUser?.role;
      // Roles con visibilidad global usan getStudents() (más eficiente).
      // Subdirector cuenta como global (autoridad académica equivalente a admin).
      const fetchStudents = (role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo')
        ? Store.getStudents()
        : Store.getStudentsByGroups(groupIds);

      const [allStudents, allGrades] = await Promise.all([
        fetchStudents,
        Store.getGradesByGroupsAndPartial(groupIds, partial),
      ]);

      // Indexar alumnos por grupo
      const studentsByGroup = {};
      for (const s of allStudents) {
        if (!s.groupId) continue;
        if (!studentsByGroup[s.groupId]) studentsByGroup[s.groupId] = [];
        studentsByGroup[s.groupId].push(s);
      }

      // Indexar grades por (subjectId + groupId) → set de studentIds con al menos un rubro
      const filledByAssignment = {};
      for (const g of allGrades) {
        const key = `${g.subjectId}_${g.groupId}`;
        if (!filledByAssignment[key]) filledByAssignment[key] = new Set();
        // Considera "lleno" si tiene al menos un rubro o cal/value
        const hasValue = ['ec', 'tr', 'ex', 'pe', 'cal', 'value'].some(k =>
          g[k] !== undefined && g[k] !== null && g[k] !== ''
        );
        if (hasValue) filledByAssignment[key].add(g.studentId);
      }

      const cache = {};
      for (const a of _capAssignments) {
        const total = (studentsByGroup[a.groupId] || []).length;
        const filled = (filledByAssignment[`${a.subjectId}_${a.groupId}`] || new Set()).size;
        const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
        let status = 'empty';
        if (filled === total && total > 0) status = 'complete';
        else if (filled > 0) status = 'partial';
        cache[a.id] = { filled, total, percent, status };
      }
      _assignmentStatusCache = cache;
      _assignmentStatusForPartial = partial;
      return cache;
    } catch (e) {
      console.warn('Error cargando estado de asignaciones:', e);
      return {};
    }
  }

  /** Invalida el cache de estado para una asignación específica
   *  (después de guardar). El siguiente render lo recalcula. */
  function _invalidateAssignmentStatus(assignmentId) {
    if (assignmentId) delete _assignmentStatusCache[assignmentId];
  }

  // ─── v8.32: VALIDACIÓN DE IMPRESIÓN ──────────────────────────────
  // La impresión solo se bloquea si faltan alumnos por calificar. Las horas
  // impartidas son semestrales y sirven para reportes/riesgo por faltas, pero
  // NO deben impedir guardar ni imprimir una lista capturada.

  /**
   * Verifica si las asignaciones dadas están listas para imprimir.
   * @param {Array<{id,groupId,subjectId,subjectName,groupName}>} asgs - asignaciones a validar
   * @param {string} partialId - 'P1' | 'P2' | 'P3'
   * @returns {Promise<{ok:boolean, issues:Array<{label,missingHours:Array<string>,missingStudents:number,total:number}>}>}
   */
  function _getCurrentEditorCompletionStat() {
    const rows = [...document.querySelectorAll('tbody tr[data-student-id]')]
      .filter(row => row.dataset.traslado !== '1');
    if (rows.length === 0) return null;
    const rubros = K.getRubros(currentTurno);
    let filled = 0;

    rows.forEach(row => {
      const studentId = row.dataset.studentId;
      const key = `${studentId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};
      const hasValue = rubros.some(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        const raw = input ? input.value.trim() : '';
        return raw !== '' || (stored[r.key] !== undefined && stored[r.key] !== null && stored[r.key] !== '');
      });
      if (hasValue || stored.cal !== undefined || stored.value !== undefined) filled++;
    });

    if (_listCleared) {
      return { filled: rows.length, total: rows.length, status: 'complete', blankList: true };
    }

    return {
      filled,
      total: rows.length,
      status: filled === rows.length && rows.length > 0 ? 'complete' : (filled > 0 ? 'partial' : 'empty'),
      fromEditor: true
    };
  }

  async function _validatePrintReadiness(asgs, partialId) {
    if (!asgs || asgs.length === 0) return { ok: true, issues: [] };

    // 1. Garantizar status cache fresco si las asignaciones a validar coinciden
    // con _capAssignments (caso típico del editor maestro). Si vienen de fuera
    // (admin, contexto cascada) el cache puede no contenerlas — abajo hay fallback.
    const allInCap = asgs.every(a => _capAssignments.some(c => c.id === a.id));
    if (allInCap && _assignmentStatusForPartial !== partialId) {
      await _loadAssignmentStatuses(partialId);
    }

    // 2. Para cada asignación, leer teacherHours y validar calificaciones.
    // Cuando no hay entry en _assignmentStatusCache, consultamos Firestore
    // directamente (alumnos del grupo + grades del grupo+materia+parcial).
    const checks = await Promise.all(asgs.map(async (a) => {
      // Las horas ya no son bloqueo de impresión. Se dejan como arreglo vacío
      // para conservar la estructura de retorno usada por el modal.
      let missingHours = [];

      // 2b. Alumnos calificados vs total
      const isCurrentEditorList = partialId === currentPartial
        && a.groupId === selectedGroup
        && a.subjectId === selectedSubject;
      let stat = isCurrentEditorList ? _getCurrentEditorCompletionStat() : null;
      if (stat && stat.blankList) missingHours = [];
      if (!stat) stat = _assignmentStatusCache[a.id];
      if (!stat) {
        // Fallback: query directo. Cuenta alumnos activos del grupo y grades
        // con al menos un rubro o cal/value para esta materia y parcial.
        try {
          const [allStudents, allGrades] = await Promise.all([
            Store.getStudentsByGroup ? Store.getStudentsByGroup(a.groupId) : Store.getStudentsByGroups([a.groupId]),
            Store.getGradesByGroupAndPartial(a.groupId, partialId).catch(() => []),
          ]);
          const total = (allStudents || []).filter(s => !s.bajaPendiente).length;
          const filled = new Set();
          for (const g of (allGrades || [])) {
            if (g.subjectId !== a.subjectId) continue;
            const has = ['ec','tr','ex','pe','cal','value'].some(k =>
              g[k] !== undefined && g[k] !== null && g[k] !== ''
            );
            if (has) filled.add(g.studentId);
          }
          stat = { filled: filled.size, total };
        } catch (_) {
          stat = { filled: 0, total: 0 };
        }
      }

      return { asg: a, missingHours, stat };
    }));

    // v8.33: bloqueo de impresión SOLO por HORAS faltantes.
    // Olivia: "no me pongas bloqueos por alumnos sin captura, eso ya queda a
    // responsabilidad del maestro." El único bloqueo real es por horas porque
    // SIN horas, el cálculo de % faltas (y por tanto reprobados por inasistencias)
    // queda mal y eso sí compromete la integridad de la lista oficial.
    const issues = [];
    for (const { asg, missingHours, stat } of checks) {
      const hasIssues = missingHours.length > 0;
      if (hasIssues) {
        const subjectName = K.getUACNombre(asg.subjectName || asg.subjectId);
        const label = `${asg.groupName || asg.groupId} · ${subjectName}`;
        const missingStudents = Math.max(0, (stat.total || 0) - (stat.filled || 0));
        issues.push({ assignmentId: asg.id, label, missingHours, missingStudents, total: stat.total || 0 });
      }
    }

    return { ok: issues.length === 0, issues };
  }

  /**
   * Muestra modal explicando por qué no se puede imprimir y bloquea.
   * Si el usuario es admin/subdirector, ofrece botón "Imprimir de todas formas".
   * Devuelve true si el flujo de impresión debe continuar, false si se cancela.
   */
  async function _enforcePrintReadiness(asgs, partialId, actionLabel, options = {}) {
    const res = await _validatePrintReadiness(asgs, partialId);
    if (res.ok) return true;
    try { _saveDraft(); } catch (_) { /* no bloquear el modal por el respaldo local */ }

    const isAdmin = _hasAdminPower();
    const issueIds = new Set(res.issues.map(it => it.assignmentId));
    const readyOnlyIds = (asgs || []).filter(a => !issueIds.has(a.id)).map(a => a.id);

    // v8.33: el bloqueo es SOLO por horas — el mensaje refleja eso.
    const listasConHorasFaltantes = res.issues.length;

    const puntos = [];
    if (listasConHorasFaltantes > 0) {
      const txt = listasConHorasFaltantes === 1
        ? `Te faltan capturar las <strong>horas del semestre</strong> en esta materia`
        : `Te faltan capturar las <strong>horas del semestre</strong> en <strong>${listasConHorasFaltantes}</strong> listas`;
      puntos.push(`<li style="margin-bottom:8px;">⏱ ${txt}.</li>`);
    }
    const detalles = res.issues.slice(0, 6).map(it => {
      return `<li>${Utils.sanitize(it.label)}</li>`;
    }).join('');
    const extra = res.issues.length > 6
      ? `<li>Y ${res.issues.length - 6} lista(s) más.</li>`
      : '';

    const adminBtn = isAdmin
      ? `<button class="btn" id="print-force-btn" style="background:#d97706;color:#fff;border:none;font-weight:700;">Imprimir de todas formas</button>`
      : '';
    const readyOnlyBtn = options.allowReadyOnly && readyOnlyIds.length > 0
      ? `<button class="btn btn-primary" id="print-ready-only-btn" style="background:#16a34a;border-color:#15803d;">Imprimir solo completas (${readyOnlyIds.length})</button>`
      : '';

    const body = `
      <div style="font-size:15px;line-height:1.6;color:#1e293b;">
        <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:14px;border-radius:6px;margin-bottom:14px;">
          <strong style="color:#991b1b;font-size:15px;">No puedes imprimir todavía.</strong>
        </div>
        <ul style="margin:0 0 0 22px;padding:0;">
          ${puntos.join('')}
        </ul>
        <details style="margin-top:12px;font-size:12.5px;color:#475569;">
          <summary style="cursor:pointer;font-weight:700;">Ver listas pendientes</summary>
          <ul style="margin:8px 0 0 18px;padding:0;">
            ${detalles}${extra}
          </ul>
        </details>
        <p style="margin-top:14px;font-size:12.5px;color:#64748b;">
          No se borra ninguna captura. Puedes cerrar este aviso, corregir lo pendiente o imprimir solo una hoja que sí esté completa.
        </p>
      </div>`;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cerrar</button>
      ${readyOnlyBtn}
      ${adminBtn}`;

    return new Promise((resolve) => {
      Modal.open('⚠ Faltan datos para imprimir', body, footer);
      const mf = document.getElementById('modalFooter');
      if (!mf) { resolve(false); return; }
      mf.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); resolve(false); return; }
        if (e.target.closest('#print-ready-only-btn')) {
          Modal.close();
          resolve({ readyOnlyIds });
          return;
        }
        if (e.target.closest('#print-force-btn')) {
          Modal.close();
          Toast.show('Imprimiendo con override administrativo — lista incompleta', 'warning');
          resolve(true);
        }
      });
    });
  }

  /** Lista ordenada de asignaciones del maestro: turno → grado → grupo → orden SEP de materias. */
  function _orderedAssignments() {
    const turnoOrd = { 'MATUTINO': 1, 'VESPERTINO': 2, 'AMBOS': 3 };
    const _norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const _sepIndex = (subjectName, grado) => {
      const order = K.SUBJECT_ORDER[Number(grado)] || [];
      if (order.length === 0) return 999;
      const n = _norm(subjectName);
      const idx = order.findIndex(o => _norm(o) === n || n.includes(_norm(o)) || _norm(o).includes(n));
      return idx === -1 ? 999 : idx;
    };
    return [..._capAssignments].sort((a, b) => {
      const ta = turnoOrd[(a.turno || '').toUpperCase()] || 9;
      const tb = turnoOrd[(b.turno || '').toUpperCase()] || 9;
      if (ta !== tb) return ta - tb;
      const ga = Number(a.grado) || 9;
      const gb = Number(b.grado) || 9;
      if (ga !== gb) return ga - gb;
      const gna = (a.groupName || '').localeCompare(b.groupName || '');
      if (gna !== 0) return gna;
      // Mismo grupo: ordenar materias por SEP del grado en lugar de alfabético.
      const ia = _sepIndex(a.subjectName, a.grado);
      const ib = _sepIndex(b.subjectName, b.grado);
      if (ia !== ib) return ia - ib;
      return (a.subjectName || '').localeCompare(b.subjectName || '');
    });
  }

  /** HTML de las pestañas de asignaciones del maestro con su estado. */
  function _renderAssignmentTabs(currentAssignmentId) {
    const ordered = _orderedAssignments();
    if (ordered.length <= 1) return '';  // 1 sola asignación: no muestra navegador

    const options = ordered.map(a => {
      const st = _assignmentStatusCache[a.id] || { filled: 0, total: 0, percent: 0, status: 'empty' };
      const isActive = a.id === currentAssignmentId;
      const statusLabel = st.status === 'complete' ? 'Completa'
        : st.status === 'partial' ? 'En captura'
        : 'Sin captura';
      const label = `${a.turno || ''} ${a.groupName || ''} - ${K.getUACNombre(a.subjectName || a.subjectId || '')} (${statusLabel}: ${st.filled}/${st.total})`;
      return `<option value="${Utils.sanitize(a.id)}" ${isActive ? 'selected' : ''}>${Utils.sanitize(label)}</option>`;
    }).join('');

    // Botones grandes Anterior / Siguiente — ahora muestran nombre de lista destino
    const idx = ordered.findIndex(a => a.id === currentAssignmentId);
    const prev = idx > 0 ? ordered[idx - 1] : null;
    const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
    const currentLabel = idx >= 0
      ? `${ordered[idx].turno || ''} ${ordered[idx].groupName || ''} — ${K.getUACNombre(ordered[idx].subjectName || '')}`
      : '';
    const prevLabel = prev ? `${prev.groupName || ''} ${K.getUACNombre(prev.subjectName || '').slice(0, 28)}` : 'Sin anterior';
    const nextLabel = next ? `${next.groupName || ''} ${K.getUACNombre(next.subjectName || '').slice(0, 28)}` : 'Última lista';

    // Navegación COMPACTA: una sola fila con ◀ [posición + dropdown] ▶
    const nav = `
      <div style="display:flex;align-items:center;gap:8px;background:#f1f5f9;padding:8px 10px;border-radius:8px;margin-bottom:10px;flex-wrap:wrap;">
        <button class="btn btn-sm btn-primary" ${!prev ? 'disabled' : ''}
          data-action="switch-assignment"
          data-assignment-id="${prev?.id || ''}"
          data-group-id="${prev?.groupId || ''}"
          data-subject-id="${prev?.subjectId || ''}"
          title="${prev ? 'Anterior: ' + Utils.sanitize(prevLabel) : 'Primera lista'}"
          style="padding:6px 10px;font-size:13px;font-weight:700;">◀ Anterior</button>

        <span style="background:#3182ce;color:#fff;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;white-space:nowrap;">${idx + 1}/${ordered.length}</span>

        <select id="assignment-jump" aria-label="Cambiar de lista" style="flex:1;min-width:180px;font-size:13px;padding:6px 8px;">${options}</select>

        <button class="btn btn-sm btn-primary" ${!next ? 'disabled' : ''}
          data-action="switch-assignment"
          data-assignment-id="${next?.id || ''}"
          data-group-id="${next?.groupId || ''}"
          data-subject-id="${next?.subjectId || ''}"
          title="${next ? 'Siguiente: ' + Utils.sanitize(nextLabel) : 'Última lista'}"
          style="padding:6px 10px;font-size:13px;font-weight:700;">Siguiente ▶</button>

        <details style="font-size:11px;color:#475569;">
          <summary style="cursor:pointer;">⓵ Leyenda</summary>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            <span class="ge-status-pill ge-status-complete">Completa</span>
            <span class="ge-status-pill ge-status-partial">En captura</span>
            <span class="ge-status-pill ge-status-empty">Sin captura</span>
          </div>
        </details>
      </div>`;

    return `
      <div class="ge-tabs-container ge-assignment-nav">
        ${nav}
      </div>`;
  }

  function _renderBulkPrintPanel() {
    const ordered = _orderedAssignments();
    if (ordered.length === 0) return '';

    const partialOptions = K.PARCIALES.map(p =>
      `<option value="${p.id}" ${p.id === currentPartial ? 'selected' : ''}>${Utils.sanitize(p.nombre)}</option>`
    ).join('');

    const rows = ordered.map(a => {
      const st = _assignmentStatusCache[a.id] || { filled: 0, total: 0, percent: 0, status: 'empty' };
      const statusLabel = st.status === 'complete' ? 'Lista completa'
        : st.status === 'partial' ? 'Lista en captura'
        : 'Sin captura';
      return `
        <label class="bulk-print-item">
          <input type="checkbox" class="bulk-print-check" value="${Utils.sanitize(a.id)}">
          <span class="bulk-print-main">
            <strong>${Utils.sanitize(a.groupName || a.groupId || '')}</strong>
            <span>${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId || ''))}</span>
          </span>
          <span class="bulk-print-status bulk-print-status--${st.status}">
            ${statusLabel} · ${st.filled}/${st.total}
          </span>
        </label>`;
    }).join('');

    return `
      <div class="card bulk-print-panel" style="border:2px solid #f59e0b;background:linear-gradient(135deg,#fef3c7 0%,#fffbeb 100%);">
        <div class="bulk-print-header">
          <div>
            <h3 style="display:flex;align-items:center;gap:8px;color:#78350f;">
              <span class="material-icons-round" style="font-size:24px;color:#b45309;">picture_as_pdf</span>
              Obtener PDF o Imprimir varias listas
            </h3>
            <p style="color:#92400e;">
              Elige el parcial, marca las listas y obtén un documento con todas juntas (puedes
              guardarlo como PDF o enviarlo a la impresora).
            </p>
          </div>
          <div class="bulk-print-actions">
            <select id="bulk-print-partial" aria-label="Parcial para imprimir">${partialOptions}</select>
            <button class="btn btn-outline" data-action="print-selected-assignments">
              <span class="material-icons-round">download</span> Solo marcadas (puede ser 1)
            </button>
            <button class="btn btn-warning" data-action="print-all-assignments" style="background:#d97706;color:#fff;border:none;">
              <span class="material-icons-round">picture_as_pdf</span> Obtener TODAS en un PDF
            </button>
          </div>
        </div>
        <div class="bulk-print-list">${rows}</div>
      </div>`;
  }

  async function renderTeacher() {
    const container = _container();
    // Cleanup from previous editor session
    if (container._undoHandler) {
      document.removeEventListener('keydown', container._undoHandler);
      container._undoHandler = null;
    }
    window.removeEventListener('beforeunload', _beforeUnloadGuard);
    if (_draftTimer) { clearInterval(_draftTimer); _draftTimer = null; }
    if (_partialPollTimer) { clearInterval(_partialPollTimer); _partialPollTimer = null; }
    _partialClosedAlertShown = false;
    _undoStack.length = 0;
    _isDirty = false;
    _isSaving = false;

    container.innerHTML = UI.moduleContainer(UI.loadingState('Cargando asignaciones...'));
    const role = App.currentUser?.role;
    // Subdirector tiene autoridad académica igual que admin (puede capturar para cualquiera).
    const isAdmin = role === 'admin' || role === 'subdirector';

    try {
      // v8.09: para captura usamos getOwnAssignments() STRICT — devuelve SOLO
      // las assignments donde teacherId==este user, ignorando auditorScope y
      // presidente_academia. Solo admin/subdirector ven el universo completo.
      _capAssignments = isAdmin
        ? await Store.getAssignments()
        : await Store.getOwnAssignments();
      if (!isAdmin && _capAssignments.length === 0) {
        // Verificar si el problema es falta de vínculo o que no tiene asignaciones
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) {
          container.innerHTML = UI.moduleContainer(UI.emptyState('person_off', 'Tu cuenta no está vinculada a un registro de docente. Contacta al administrador.'));
          return;
        }
      }

      // Deep-link desde dashboard O restauración tras refresh: el editor
      // guarda su estado en localStorage. Si hay un target válido (asignación
      // del maestro), reabrimos el editor directamente.
      const pendingOrSaved = _pendingOpen || _readEditorState();
      if (!isAdmin && pendingOrSaved) {
        const target = _capAssignments.find(a =>
          a.id === pendingOrSaved.assignmentId ||
          (a.groupId === pendingOrSaved.groupId && a.subjectId === pendingOrSaved.subjectId)
        );
        _pendingOpen = null;
        if (target) {
          // v8.24 FIX: solo respetar el partial guardado si SIGUE ABIERTO para
          // el grado del maestro. Si está cerrado (caso típico: capturó P1 hace
          // semanas, ahora P1 está cerrado y P2 está abierto), descartar el
          // partial guardado y dejar que openGradeEditor auto-detecte el primer
          // abierto. Antes: el maestro siempre caía en P1 cerrado porque era
          // lo último guardado, aunque P2 estuviera abierto.
          let shouldPreserve = false;
          if (pendingOrSaved.partial) {
            try {
              const partials = await Store.getPartials(true);
              const myGrado = K.gradeFromGroupId(target.groupId);
              const pdoc = (partials || []).find(p => p.id === pendingOrSaved.partial);
              const lockedForMe = K.isPartialLockedForGrade(pdoc, myGrado);
              if (!lockedForMe) {
                currentPartial = pendingOrSaved.partial;
                shouldPreserve = true;
              } else {
                // Limpiar el partial obsoleto del estado guardado
                currentPartial = '';
              }
            } catch (_) {
              // Si la validación falla por cualquier motivo, respetar lo guardado
              currentPartial = pendingOrSaved.partial;
              shouldPreserve = true;
            }
          }
          assignments = _capAssignments;
          // preservePartial=true SOLO si el parcial guardado sigue abierto.
          // Cuando es false, openGradeEditor hace el auto-detect (v8.13) que
          // busca el primer parcial NO bloqueado para el grado del maestro.
          api.openGradeEditor(target.id, target.groupId, target.subjectId, { preservePartial: shouldPreserve });
          return;
        }
        // Estado obsoleto (cambió la asignación, fue revocada, etc.): limpiar.
        _clearEditorState();
      }

      // If teacher has only 1 assignment, open editor directly
      if (!isAdmin && _capAssignments.length === 1) {
        const a = _capAssignments[0];
        assignments = _capAssignments;
        api.openGradeEditor(a.id, a.groupId, a.subjectId);
        return;
      }

      if (_capAssignments.length === 0) {
        container.innerHTML = UI.moduleContainer(UI.emptyState('assignment', 'No hay asignaciones disponibles'));
        return;
      }

      if (!isAdmin) await _loadAssignmentStatuses(currentPartial);

      const title = isAdmin ? 'Captura de Calificaciones' : 'Mis Asignaciones';
      const subtitle = 'Selecciona turno, grado, grupo y materia para abrir el editor';

      // Extract turno options from available assignments
      const turnos = [...new Set(_capAssignments.map(a => a.turno).filter(Boolean))].sort();
      const turnoOptions = turnos.map(t => `<option value="${t}">${t}</option>`).join('');

      container.innerHTML = UI.moduleContainer(`
        ${UI.pageHeader(title, subtitle)}
        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="cap-turno">Turno</label>
              <select id="cap-turno">
                <option value="">Selecciona turno</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="cap-grado">Grado</label>
              <select id="cap-grado" disabled>
                <option value="">Selecciona grado</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cap-grupo">Grupo</label>
              <select id="cap-grupo" disabled>
                <option value="">Selecciona grupo</option>
              </select>
            </div>
            <div class="form-group">
              <label for="cap-materia">Materia</label>
              <select id="cap-materia" disabled>
                <option value="">Selecciona materia</option>
              </select>
            </div>
          </div>
        </div>
        <div id="cap-preview"></div>
        ${!isAdmin ? _renderBulkPrintPanel() : ''}
      `);

      assignments = _capAssignments;
      _delegateClick(container);
      _bindCascadeFilters();

      // Auto-select turno if only one
      if (turnos.length === 1) {
        document.getElementById('cap-turno').value = turnos[0];
        document.getElementById('cap-turno').dispatchEvent(new Event('change'));
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
      Toast.show('Error al cargar asignaciones', 'error');
    }
  }

  function _bindCascadeFilters() {
    const turnoEl = document.getElementById('cap-turno');
    const gradoEl = document.getElementById('cap-grado');
    const grupoEl = document.getElementById('cap-grupo');
    const materiaEl = document.getElementById('cap-materia');

    turnoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      // Reset downstream
      grupoEl.innerHTML = '<option value="">Selecciona grupo</option>';
      grupoEl.disabled = true;
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
      materiaEl.disabled = true;
      _updateCapPreview(null);

      if (!turno) {
        gradoEl.innerHTML = '<option value="">Selecciona grado</option>';
        gradoEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.turno === turno);
      // Coerce a Number antes de Set para que un dato sucio mixto (string "3" + integer 3)
      // no produzca dos opciones "3" en el dropdown.
      const grados = [...new Set(filtered.map(a => Number(a.grado)).filter(g => Number.isFinite(g) && g > 0))].sort((a, b) => a - b);
      gradoEl.innerHTML = '<option value="">Selecciona grado</option>' +
        grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');
      gradoEl.disabled = false;
      // Auto-select if only one
      if (grados.length === 1) { gradoEl.value = grados[0]; gradoEl.dispatchEvent(new Event('change')); }
    });

    gradoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      const grado = gradoEl.value;
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
      materiaEl.disabled = true;
      _updateCapPreview(null);

      if (!grado) {
        grupoEl.innerHTML = '<option value="">Selecciona grupo</option>';
        grupoEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.turno === turno && String(a.grado) === String(grado));
      const grupos = [...new Map(filtered.map(a => [a.groupId, a.groupName || a.groupId])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]));
      grupoEl.innerHTML = '<option value="">Selecciona grupo</option>' +
        grupos.map(([id, name]) => `<option value="${id}">${Utils.sanitize(name)}</option>`).join('');
      grupoEl.disabled = false;
      if (grupos.length === 1) { grupoEl.value = grupos[0][0]; grupoEl.dispatchEvent(new Event('change')); }
    });

    grupoEl.addEventListener('change', () => {
      const turno = turnoEl.value;
      const grado = gradoEl.value;
      const groupId = grupoEl.value;
      _updateCapPreview(null);

      if (!groupId) {
        materiaEl.innerHTML = '<option value="">Selecciona materia</option>';
        materiaEl.disabled = true;
        return;
      }
      const filtered = _capAssignments.filter(a => a.groupId === groupId);
      // Orden oficial SEP del grado en lugar de alfabético.
      // Cada asignación expone subjectName; envolvemos en {nombre} para que el
      // helper de constants.js pueda compararlo correctamente.
      const _gradeNum = Number(grado);
      const sortedAsgs = K.sortSubjectsByGrado(
        filtered.map(a => ({ ...a, nombre: a.subjectName || a.subjectId })),
        _gradeNum
      );
      materiaEl.innerHTML = '<option value="">Selecciona materia</option>' +
        sortedAsgs.map(a => `<option value="${a.subjectId}">${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId))}</option>`).join('');
      materiaEl.disabled = false;
      if (sortedAsgs.length === 1) { materiaEl.value = sortedAsgs[0].subjectId; materiaEl.dispatchEvent(new Event('change')); }
    });

    materiaEl.addEventListener('change', () => {
      const groupId = grupoEl.value;
      const subjectId = materiaEl.value;
      if (!subjectId) { _updateCapPreview(null); return; }
      const asg = _capAssignments.find(a => a.groupId === groupId && a.subjectId === subjectId);
      _updateCapPreview(asg);
    });
  }

  function _updateCapPreview(asg) {
    const preview = document.getElementById('cap-preview');
    if (!preview) return;

    if (!asg) {
      preview.innerHTML = `
        <div class="empty-state" style="margin-top:24px;">
          <span class="material-icons-round empty-state-icon">edit_note</span>
          <p class="empty-state-text">Selecciona turno, grado, grupo y materia para abrir el editor de calificaciones</p>
        </div>`;
      return;
    }

    const turnoClass = (asg.turno || '').toUpperCase() === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';
    preview.innerHTML = `
      <div class="card" style="margin-top:16px;border-left:4px solid var(--color-primary);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <div class="font-semibold" style="font-size:var(--font-size-lg);">${Utils.sanitize(K.getUACNombre(asg.subjectName || asg.subjectId))}</div>
            <div class="text-muted" style="margin-top:4px;">
              <span class="badge ${turnoClass}" style="margin-right:4px;">${Utils.sanitize(asg.turno || '')}</span>
              <span class="badge">Grupo ${Utils.sanitize(asg.groupName || asg.groupId)}</span>
              <span class="badge" style="background:rgba(0,0,0,0.06);margin-left:4px;">${Utils.sanitize(Utils.displayName(asg.teacherName || ''))}</span>
            </div>
          </div>
          <button class="btn btn-primary" data-action="open-editor" data-assignment-id="${asg.id}" data-group-id="${asg.groupId}" data-subject-id="${asg.subjectId}">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">edit</span>
            Abrir editor
          </button>
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // TEACHER — GRADE EDITOR con rubros
  // ═══════════════════════════════════════════════════════════════

  // v8.19: localStorage para que el editor exacto sobreviva al CIERRE de
  // navegador y al refresh duro Cmd+Shift+R — antes era sessionStorage.
  // Se limpia solo cuando el usuario explícitamente sale con "Volver".
  const _EDITOR_STATE_KEY = 'epo67_editorState';
  function _saveEditorState(assignmentId, groupId, subjectId) {
    const payload = JSON.stringify({
      assignmentId, groupId, subjectId, partial: currentPartial
    });
    try { localStorage.setItem(_EDITOR_STATE_KEY, payload); } catch (_) {}
    // Backup en sessionStorage para compat con código viejo.
    try { sessionStorage.setItem(_EDITOR_STATE_KEY, payload); } catch (_) {}
  }
  function _readEditorState() {
    try {
      const raw = localStorage.getItem(_EDITOR_STATE_KEY)
        || sessionStorage.getItem(_EDITOR_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function _clearEditorState() {
    try { localStorage.removeItem(_EDITOR_STATE_KEY); } catch (_) {}
    try { sessionStorage.removeItem(_EDITOR_STATE_KEY); } catch (_) {}
  }

  // ¿El usuario tiene poder de admin REAL? Considera el caso de impersonación:
  // si admin está usando "Ver como" otro usuario, su rol REAL sigue siendo admin
  // y debe poder escribir sin restricciones aunque la UI muestre rol falso.
  // El SUBDIRECTOR también tiene "admin power" (autoridad académica equivalente,
  // puede capturar/corregir sin restricción igual que admin — petición directa
  // de Olivia: el profe Octavio no tiene ninguna limitación).
  function _hasAdminPower() {
    const u = App.currentUser;
    if (!u) return false;
    if (u.role === 'admin' || u.role === 'subdirector') return true;
    if (u._impersonating === true && (u._realRole === 'admin' || u._realRole === 'subdirector')) return true;
    return false;
  }

  // Lee partialOverrides/{partial}_{teacherId} y retorna true si existe y
  // está vigente (sin expiresAt o expiresAt > ahora). Admin siempre retorna
  // true (acceso administrativo de emergencia, sin necesidad de override).
  async function _checkActiveOverride(partialId) {
    try {
      if (_hasAdminPower()) return true;
      if (!_isTeacherCaptureRole()) return false;
      const teacherDocId = await Store.getTeacherDocId();
      if (!teacherDocId) return false;
      const doc = await db.collection('partialOverrides').doc(`${partialId}_${teacherDocId}`).get();
      if (!doc.exists) return false;
      const data = doc.data() || {};
      if (!data.expiresAt) return true;
      const exp = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
      return exp > new Date();
    } catch (e) {
      console.warn('No se pudo verificar override:', e);
      return false;
    }
  }

  async function openGradeEditor(assignmentId, groupId, subjectId, opts) {
    const preservePartial = !!(opts && opts.preservePartial);
    selectedGroup = groupId;
    selectedSubject = subjectId;
    // Si el caller no pasó assignmentId (ej. switchPartial), resolverlo
    // desde la lista actual para que sessionStorage guarde el id real.
    const resolvedAsgId = assignmentId
      || (assignments.find(a => a.groupId === groupId && a.subjectId === subjectId)?.id);
    _saveEditorState(resolvedAsgId || null, groupId, subjectId);

    try {
      // Para maestros, getStudents() global es rechazado por reglas. Usar query
      // filtrada por groupId (que sí está permitida porque el maestro tiene
      // assignment de ese grupo). Para admin/subdirector/orientador/directivo,
      // usar global (visibilidad total).
      const role = App.currentUser?.role;
      const fetchStudents = (role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo')
        ? Store.getStudents()
        : Store.getStudentsByGroup(groupId);

      // FORCE=true en getPartials: el estado de cierre del parcial es CRÍTICO
      // para decidir si el editor es solo-lectura o editable. Si el admin acaba
      // de cerrar el parcial, los maestros NO deben poder seguir editando — y
      // sin force, el caché de 5min los deja editar localmente aunque las rules
      // del servidor rechacen sus guardadas (data loss silenciosa).
      const [allStudents, partials, allGroups, groupGrades] = await Promise.all([
        fetchStudents,
        Store.getPartials(true),
        Store.getGroups(),
        Store.getGradesByGroup(groupId, true)
      ]);

      students = allStudents
        .filter(s => s.groupId === groupId)
        .map(s => ({ docId: s.id, ...s }))
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      // Detect turno from group
      const groupDoc = allGroups.find(g => g.id === groupId);
      if (groupDoc) {
        currentTurno = groupDoc.turno || 'MATUTINO';
      } else if (students.length > 0) {
        currentTurno = students[0].turno || 'MATUTINO';
      }

      // Set initial partial to first open one — SOLO al abrir asignación nueva
      // (assignmentId presente y NO viene con preservePartial). Casos:
      //   - switchPartial(P1): assignmentId=null → preserva el partial elegido
      //   - clic en asignación desde menú: assignmentId='xxx', preservePartial=false → resetea al primer abierto
      //   - restauración tras refresh: assignmentId='xxx', preservePartial=true → preserva el partial guardado
      //   - currentPartial vacío (primera carga): siempre resetea
      const shouldResetPartial = !preservePartial && (assignmentId || !currentPartial);
      if (shouldResetPartial) {
        // v8.13: usar isPartialLockedForGrade — la apertura/cierre puede ser
        // PARCIAL POR GRADO (admin abrió P2 solo para 3°). El maestro de 3°
        // debe entrar a P2 (abierto para él), no a P1 (cerrado globalmente).
        // Antes solo miraba doc.locked plano, ignorando lockedByGrade.
        const myGrado = K.gradeFromGroupId(groupId);
        const sorted = K.PARCIALES.map(kp => {
          const doc = partials.find(p => p.id === kp.id);
          return { id: kp.id, locked: K.isPartialLockedForGrade(doc, myGrado) };
        });
        const open = sorted.find(p => !p.locked);
        // Si hay parcial abierto PARA MI GRADO, usar ese (en captura activa).
        // Si todos están cerrados, usar el último capturado (App.getDefaultPartial),
        // así el maestro entra directo al parcial donde más recientemente trabajó.
        currentPartial = open ? open.id : (App.getDefaultPartial() || 'P1');
      }

      // Filter grades to this subject only (already cached per-group)
      grades = {};
      groupGrades.filter(g => g.subjectId === subjectId).forEach(g => {
        const key = `${g.studentId}_${g.subjectId}_${g.partial}`;
        grades[key] = g;
      });

      // Calcular estatus de extra/riesgo de cada alumno EN ESTA materia
      // para mostrar alertas al maestro en el editor.
      // AWAITED para que cuando _renderGradeEditor corra, ya sepamos el
      // estatus de riesgo/extraordinario por horas e inasistencias.
      try { await _computeStatusForCurrentEditor(groupId, subjectId); } catch (_) {}

      // Pre-cargar estado de TODAS las asignaciones del maestro para las pestañas
      // (no bloquea — usa cache si ya está cargado para este parcial).
      _loadAssignmentStatuses(currentPartial).catch(() => {});

      // Resolver si el maestro tiene OVERRIDE activo para este parcial cerrado.
      // Si lo tiene, el editor NO se mostrará en modo solo-lectura y el auto-save
      // SÍ permitirá escrituras (las firestore.rules también respetan el override).
      _editorOverrideActive = await _checkActiveOverride(currentPartial);

      _renderGradeEditor(partials);
    } catch (error) {
      console.error('Error opening grade editor:', error);
      Toast.show('Error al abrir editor de calificaciones', 'error');
    }
  }

  // ─── INPUT MODE STATE ───
  let _inputMode = 'manual'; // 'manual' or 'paste'
  let _pasteTargetField = null;

  // Para deep-link desde el dashboard del maestro: la tarjeta deja aquí
  // qué asignación abrir, y renderTeacher lo lee y abre el editor directo.
  let _pendingOpen = null;
  function setPendingOpen(payload) { _pendingOpen = payload || null; }

  // ─── DIRTY STATE (unsaved changes tracking) ───
  let _isDirty = false;
  // Override activo del admin para el (parcial, maestro) actual. Se resuelve
  // una vez por openGradeEditor y se consulta en los chequeos cliente
  // (_renderGradeEditor para deshabilitar/no inputs, _autoSaveGrades para
  // permitir/bloquear escritura). Se invalida al cambiar de parcial.
  let _editorOverrideActive = false;
  let _isSaving = false;
  let _draftKey = ''; // localStorage key for auto-recovery

  function _markDirty() {
    // Programar auto-save SIEMPRE que se marque dirty (incluso si ya estaba dirty,
    // así extendemos la debounce con cada nuevo cambio del maestro).
    _scheduleAutoSave();

    if (_isDirty) return;
    _isDirty = true;
    const indicator = document.getElementById('unsaved-indicator');
    if (indicator) {
      indicator.style.display = '';
      indicator.innerHTML = '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit_note</span> Sin guardar';
      indicator.className = 'unsaved-badge';
    }
    const saveBtn = document.querySelector('[data-action="save-grades"]');
    if (saveBtn) saveBtn.classList.add('btn-pulse');
  }

  function _markClean() {
    _isDirty = false;
    const indicator = document.getElementById('unsaved-indicator');
    if (indicator) indicator.style.display = 'none';
    const saveBtn = document.querySelector('[data-action="save-grades"]');
    if (saveBtn) saveBtn.classList.remove('btn-pulse');
    // Clear draft from localStorage
    if (_draftKey) { try { localStorage.removeItem(_draftKey); } catch(e){} }
  }

  // ─── AUTO-SAVE con debounce (anti-pérdida de datos) ───
  // Si el maestro está tecleando, programamos un guardado en 3 segundos.
  // Cada tecla nueva reinicia el contador (típico debounce). Cuando termina
  // de escribir y pasan 3s sin cambios, guardamos en silencio.
  let _autoSaveTimer = null;
  const AUTO_SAVE_DELAY_MS = 3000;

  function _scheduleAutoSave() {
    // Si el usuario es admin/orientador en vista de admin del módulo (no editor de maestro),
    // no programamos auto-save (no aplica).
    if (!_draftKey) return;
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(() => {
      _autoSaveTimer = null;
      if (_isDirty && !_isSaving) {
        _autoSaveGrades().catch(err => {
          console.warn('Auto-save falló:', err);
          _showSaveStatus('error', err?.message || 'Error al guardar — reintentaremos automaticamente');
          // FIX (v7.83): reintentos con backoff exponencial (5s, 15s, 60s)
          // en lugar de UN solo reintento que pierde el dato si vuelve a fallar.
          _scheduleRetryWithBackoff(0);
        });
      }
    }, AUTO_SAVE_DELAY_MS);

    _showSaveStatus('pending', 'Se guardará en unos segundos…');
  }

  // FIX (v7.83): FLUSH inmediato del auto-save pendiente.
  // Se llama desde:
  //   1) focusout de input (cuando el maestro cambia de celda)
  //   2) pagehide / visibilitychange=hidden (cierra pestaña, cambia app)
  //   3) Antes de navegar dentro del SPA (cambio de materia/grupo/modulo)
  // Cancela el debounce y guarda YA. Si _isSaving, no interrumpe.
  function _flushAutoSave() {
    if (!_draftKey) return;
    if (!_isDirty || _isSaving) return;
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
    _autoSaveGrades().catch(err => {
      console.warn('Flush auto-save falló:', err);
      _showSaveStatus('error', err?.message || 'Error al guardar — reintentando');
      _scheduleRetryWithBackoff(0);
    });
  }

  // FIX (v7.83): version AWAITABLE de _flushAutoSave para usar antes de
  // navegar dentro del SPA. Espera a que el commit termine (o falle) antes
  // de continuar, asi el cambio recien tecleado no se pierde al cambiar de
  // materia/grupo/parcial.
  async function _flushAutoSaveAndWait() {
    if (!_draftKey || !_isDirty) return;
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }
    if (_isSaving) {
      // Esperar a que termine el save en curso (max 10s)
      const start = Date.now();
      while (_isSaving && (Date.now() - start) < 10000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!_isDirty) return; // ya quedó limpio
    }
    try {
      await _autoSaveGrades();
    } catch (e) {
      console.warn('Flush sync falló:', e);
    }
  }

  // FIX (v7.83): instalar UNA SOLA VEZ los listeners de pagehide/visibilitychange.
  // Si el maestro reabre el editor varias veces, no acumulamos N handlers (memory leak).
  // Los handlers son inocuos cuando _isDirty=false (no hacen nada).
  let _unloadHandlersInstalled = false;
  function _onVisibilityHidden() {
    if (document.visibilityState === 'hidden') _flushAutoSave();
  }
  function _installUnloadHandlers() {
    if (_unloadHandlersInstalled) return;
    _unloadHandlersInstalled = true;
    window.addEventListener('pagehide', _flushAutoSave);
    document.addEventListener('visibilitychange', _onVisibilityHidden);
  }

  // FIX (v7.83): reintentos exponenciales tras un fallo de auto-save.
  // Intentos: t+5s, t+15s, t+60s. Después de 3 fallos, mostrar TOAST
  // de error prominente (no silencioso) y pedir al maestro recargar.
  const _RETRY_DELAYS = [5000, 15000, 60000];
  let _retryAttempt = 0;
  let _retryTimer = null;
  function _scheduleRetryWithBackoff(attemptIdx) {
    if (_retryTimer) clearTimeout(_retryTimer);
    if (attemptIdx >= _RETRY_DELAYS.length) {
      _showSaveStatus('error', '⚠️ No se pudo guardar tras 3 intentos. NO cierres ni recargues; usa Guardar o Recuperar borrador.');
      if (typeof Toast !== 'undefined') {
        Toast.show('⚠️ Falló el guardado automatico. NO cierres la pagina: tus datos quedan en el editor y en borrador local.', 'error', 30000);
      }
      _retryAttempt = 0;
      return;
    }
    _retryTimer = setTimeout(() => {
      _retryTimer = null;
      _retryAttempt = attemptIdx + 1;
      if (!_isDirty || _isSaving) { _retryAttempt = 0; return; }
      _autoSaveGrades()
        .then(() => { _retryAttempt = 0; })
        .catch(() => _scheduleRetryWithBackoff(attemptIdx + 1));
    }, _RETRY_DELAYS[attemptIdx]);
  }

  /** Muestra el estado del auto-save al lado del título del editor. */
  function _showSaveStatus(state, msg) {
    const el = document.getElementById('autosave-status');
    if (!el) return;
    el.style.display = '';
    if (state === 'pending') {
      el.innerHTML = '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:#d69e2e;">schedule</span> ' + msg;
      el.style.color = '#92400e';
      el.style.background = '#fef3c7';
      el.style.border = '1px solid #fbbf24';
    } else if (state === 'saving') {
      el.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:14px;vertical-align:middle;color:#2b6cb0;">autorenew</span> ' + msg;
      el.style.color = '#1e3a8a';
      el.style.background = '#dbeafe';
      el.style.border = '1px solid #93c5fd';
    } else if (state === 'saved') {
      el.innerHTML = '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:#15803d;">check_circle</span> ' + msg;
      el.style.color = '#14532d';
      el.style.background = '#dcfce7';
      el.style.border = '1px solid #86efac';
      // Auto-ocultar tras 4 segundos si está en estado "saved"
      setTimeout(() => { if (el && el.dataset.state === 'saved' && !_isDirty) el.style.display = 'none'; }, 4000);
    } else if (state === 'error') {
      el.innerHTML = '<span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:#b91c1c;">error</span> ' + msg;
      el.style.color = '#7f1d1d';
      el.style.background = '#fee2e2';
      el.style.border = '1px solid #fca5a5';
    }
    el.dataset.state = state;
  }

  /** Versión SILENT de saveGrades: sin modales, sin toasts ruidosos. */
  async function _autoSaveGrades() {
    if (_isSaving) return;
    if (!_isDirty) return;
    // Si parcial está cerrado: no auto-save. FORCE=true para que detectemos
    // CIERRES recientes — si el maestro está editando y el admin cierra el
    // parcial al mismo tiempo, la próxima autosave debe detectarlo y avisarle
    // que sus cambios no se guardarán.
    try {
      const cachedPartials = await Store.getPartials(true);
      const pDoc = cachedPartials.find(p => p.id === currentPartial);
      // v8.34 BUG FIX: usar isPartialLockedForGrade con el grado del maestro,
      // NO el flag global pDoc.locked. Antes: P3 con locked=true global pero
      // lockedByGrade[3]=false impedía guardar a maestros de 3° aunque para
      // ellos estuviera abierto.
      const grado = K.gradeFromGroupId(selectedGroup);
      if (pDoc && K.isPartialLockedForGrade(pDoc, grado) && !_hasAdminPower() && !_editorOverrideActive) {
        _showSaveStatus('error', '🔒 Parcial cerrado — tus cambios NO se están guardando. Recarga la página.');
        return;
      }
    } catch(e) { /* continuar */ }

    _showSaveStatus('saving', 'Guardando…');
    try {
      await saveGrades({ silent: true });
      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      _showSaveStatus('saved', 'Guardado a las ' + hh + ':' + mm);
    } catch(e) {
      _showSaveStatus('error', e.message || 'No se pudo guardar — reintenta');
      throw e;
    }
  }

  // ─── AUTO-RECOVERY DRAFT (save to localStorage periodically) ───
  let _draftTimer = null;
  // Timer que cada 30s revisa si el parcial actual sigue abierto.
  // Si lo cerraron mientras el maestro estaba editando, le avisamos y bloqueamos.
  let _partialPollTimer = null;

  // Revisa el estado actual del parcial directo en Firestore (sin caché).
  // Si lo encuentra cerrado Y el maestro NO tiene admin power ni override,
  // muestra un aviso bloqueante y desactiva los inputs.
  async function _pollPartialState() {
    if (_hasAdminPower() || _editorOverrideActive) return; // no afecta a admin/override
    if (!currentPartial) return;
    try {
      const doc = await db.collection('partials').doc(currentPartial).get();
      if (!doc.exists) return;
      const data = doc.data() || {};
      // v8.34 BUG FIX: antes verificaba `data.locked === true` GLOBAL, lo que
      // disparaba el modal "Parcial cerrado" a TODOS los maestros incluso
      // cuando el parcial estaba abierto para SU grado (ej. P3 cerrado para
      // 1°/2° pero abierto para 3°). Resultado: maestros de 3° capturaban y
      // se desactivaban sus inputs cada 30s. Ahora usa isPartialLockedForGrade.
      const grado = K.gradeFromGroupId(selectedGroup);
      if (K.isPartialLockedForGrade(data, grado)) {
        _onPartialClosedMidEdit();
      }
    } catch (e) { /* network blip, ignorar — el próximo ciclo lo intenta */ }
  }

  // Llamada cuando detectamos que el parcial se cerró mientras el maestro
  // estaba editando. Detiene timers, muestra modal bloqueante y desactiva
  // inputs para que NO siga capturando cosas que no se guardarán.
  let _partialClosedAlertShown = false;
  function _onPartialClosedMidEdit() {
    if (_partialClosedAlertShown) return; // ya está mostrado
    _partialClosedAlertShown = true;

    // Detener timers
    if (_partialPollTimer) { clearInterval(_partialPollTimer); _partialPollTimer = null; }
    if (_autoSaveTimer) { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; }

    // Desactivar TODOS los inputs de la tabla y horas inmediatamente
    document.querySelectorAll('.grade-editor-table input.ge-input, .horas-input').forEach(inp => {
      inp.disabled = true;
    });

    // Modal bloqueante con instrucción clara
    const partialName = K.PARCIALES.find(p => p.id === currentPartial)?.nombre || currentPartial;
    const body = `
      <div style="text-align:center;padding:10px 0;">
        <span class="material-icons-round" style="font-size:64px;color:#dc2626;display:block;margin-bottom:10px;">lock</span>
        <h2 style="color:#991b1b;font-size:20px;font-weight:900;margin:0 0 10px;">El parcial fue cerrado</h2>
        <p style="color:#374151;font-size:14px;line-height:1.5;margin:0 0 14px;">
          <strong>${Utils.sanitize(partialName)}</strong> acaba de cerrarse mientras estabas capturando.
          Los cambios que hagas a partir de ahora <strong>NO se guardarán</strong>.
        </p>
        <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:10px 14px;border-radius:6px;text-align:left;font-size:13px;color:#7f1d1d;line-height:1.5;">
          Si necesitas modificar una calificación de este parcial, debes hacer una
          <strong>solicitud formal de cambio</strong> en el módulo "Cambios de Calificación".
        </div>
      </div>
    `;
    const footer = `
      <button class="btn btn-outline" onclick="Modal.close(); Router.navigate('my-grades');">Volver a mis listas</button>
      <button class="btn btn-primary" onclick="Modal.close(); Router.navigate('correction-request');" style="background:#dc2626;border-color:#b91c1c;">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">rate_review</span>
        Ir a Cambios de Calificación
      </button>
    `;
    Modal.open('Parcial cerrado', body, footer);
  }

  // v8.36: respaldo a la NUBE además de localStorage.
  // Razón: si el navegador del maestro se pierde, los datos no se rescatan.
  // Ahora cada draft también se escribe a Firestore (colección gradeDrafts)
  // con docId determinístico {teacherId}_{groupId}_{subjectId}_{partial}.
  // El admin puede leer estos drafts en caso de pérdida.
  let _cloudDraftTimer = null;
  function _saveDraft() {
    if (!_isDirty || !_draftKey) return;
    let snapshot;
    try {
      snapshot = _captureSnapshot('draft');
      localStorage.setItem(_draftKey, JSON.stringify({
        time: Date.now(),
        groupId: selectedGroup,
        subjectId: selectedSubject,
        partial: currentPartial,
        values: snapshot.values
      }));
    } catch(e) { /* localStorage may be full or disabled */ }

    // Respaldo a Firestore con debounce de 5s (para no saturar la red).
    // Se hace mejor-esfuerzo; si falla, no afecta el flujo del maestro.
    if (!snapshot) return;
    if (_cloudDraftTimer) clearTimeout(_cloudDraftTimer);
    _cloudDraftTimer = setTimeout(async () => {
      try {
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) return;
        const docId = `${teacherDocId}_${selectedGroup}_${selectedSubject}_${currentPartial}`;
        await db.collection('gradeDrafts').doc(docId).set({
          teacherId: teacherDocId,
          groupId: selectedGroup,
          subjectId: selectedSubject,
          partial: currentPartial,
          values: snapshot.values,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.currentUser?.uid || null,
          userAgent: navigator.userAgent.slice(0, 200),
        }, { merge: true });
      } catch (e) {
        console.warn('[cloudDraft] falló respaldo a nube:', e?.message || e);
      }
    }, 5000);
  }

  function _draftValueCount(values, rows) {
    let count = 0;
    rows.forEach(row => {
      const vals = values?.[row.dataset.studentId];
      if (!vals) return;
      Object.keys(vals).forEach(k => {
        if (vals[k] !== undefined && vals[k] !== null && String(vals[k]).trim() !== '') count++;
      });
    });
    return count;
  }

  function _findLocalDraftCandidates() {
    const rows = [...document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]')];
    const candidates = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('grade_draft_')) continue;
        let draft;
        try { draft = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { continue; }
        if (!draft || !draft.values) continue;

        const count = _draftValueCount(draft.values, rows);
        if (count === 0) continue;

        const keyLower = key.toLowerCase();
        const exact = key === _draftKey;
        const groupMatch = selectedGroup && key.includes(selectedGroup);
        const subjectMatch = selectedSubject && keyLower.includes(String(selectedSubject).toLowerCase());
        const partialMatch = currentPartial && key.endsWith(`_${currentPartial}`);
        const score = (exact ? 100 : 0) + (groupMatch ? 20 : 0) + (subjectMatch ? 20 : 0) + (partialMatch ? 10 : 0) + Math.min(count, 50);
        candidates.push({ key, draft, count, score, exact, groupMatch, subjectMatch, partialMatch });
      }
    } catch (_) { /* localStorage bloqueado */ }
    return candidates.sort((a, b) => b.score - a.score || (b.draft.time || 0) - (a.draft.time || 0));
  }

  function _applyDraftValues(draft, sourceLabel) {
    const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
    _pushUndo('Antes de recuperar borrador');
    rows.forEach(row => {
      const sid = row.dataset.studentId;
      const vals = draft.values?.[sid];
      if (!vals) return;
      row.querySelectorAll('.ge-input').forEach(input => {
        const field = input.dataset.field;
        if (vals[field] !== undefined) input.value = vals[field];
      });
      const firstRubro = row.querySelector('.grade-rubro');
      if (firstRubro) _recalcRow(firstRubro);
    });
    _updateStats();
    _markDirty();
    try { _saveDraft(); } catch (_) {}
    Toast.show(`Borrador recuperado${sourceLabel ? ': ' + sourceLabel : ''}. Revisa y guarda.`, 'success', 9000);
  }

  function _manualRecoverLocalDraft() {
    const candidates = _findLocalDraftCandidates();
    if (candidates.length === 0) {
      Toast.show('No se encontró un borrador local para esta hoja en este navegador.', 'warning', 9000);
      return;
    }

    if (candidates.length === 1 && candidates[0].exact) {
      _applyDraftValues(candidates[0].draft, 'esta misma hoja');
      return;
    }

    const rowsHtml = candidates.slice(0, 8).map((c, idx) => {
      const when = c.draft.time ? new Date(c.draft.time).toLocaleString('es-MX') : 'sin fecha';
      const badges = [
        c.exact ? 'misma hoja' : '',
        c.groupMatch ? 'grupo' : '',
        c.subjectMatch ? 'materia' : '',
        c.partialMatch ? 'parcial' : ''
      ].filter(Boolean).join(' · ');
      return `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;cursor:pointer;background:${idx === 0 ? '#eff6ff' : '#fff'};">
          <input type="radio" name="draft-recovery-choice" value="${idx}" ${idx === 0 ? 'checked' : ''} style="margin-top:3px;">
          <span style="flex:1;">
            <strong>${Utils.sanitize(c.key.replace('grade_draft_', ''))}</strong>
            <span style="display:block;color:#475569;font-size:12px;margin-top:2px;">${Utils.sanitize(when)} · ${c.count} dato(s) recuperables${badges ? ' · ' + Utils.sanitize(badges) : ''}</span>
          </span>
        </label>`;
    }).join('');

    const body = `
      <div style="font-size:14px;color:#1e293b;line-height:1.5;">
        <p style="margin:0 0 10px;">Encontré borradores locales en este navegador. Elige uno para colocarlo en la hoja actual.</p>
        <div style="background:#fff7ed;border-left:4px solid #d97706;border-radius:6px;padding:8px 10px;margin-bottom:12px;color:#78350f;font-size:12.5px;">
          Esto no borra nada de Firestore. Solo rellena el editor; después debes revisar y presionar Guardar.
        </div>
        ${rowsHtml}
      </div>`;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" id="apply-local-draft-btn">Recuperar seleccionado</button>`;

    Modal.open('Recuperar borrador local', body, footer);
    setTimeout(() => {
      document.getElementById('modalFooter')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); return; }
        if (e.target.closest('#apply-local-draft-btn')) {
          const selected = document.querySelector('input[name="draft-recovery-choice"]:checked');
          const idx = Number(selected?.value || 0);
          const chosen = candidates[idx];
          if (chosen) {
            Modal.close();
            _applyDraftValues(chosen.draft, chosen.exact ? 'esta misma hoja' : chosen.key.replace('grade_draft_', ''));
          }
        }
      }, { once: false });
    }, 30);
  }

  function _checkDraftRecovery() {
    if (!_draftKey) return;
    try {
      const raw = localStorage.getItem(_draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      // Check if draft has any values different from current
      let hasDiffs = false;
      let diffCount = 0;
      const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
      rows.forEach(row => {
        const sid = row.dataset.studentId;
        const vals = draft.values[sid];
        if (!vals) return;
        let rowHasDiff = false;
        row.querySelectorAll('.ge-input').forEach(input => {
          const field = input.dataset.field;
          if (vals[field] !== undefined && vals[field] !== '' && vals[field] !== input.value) {
            hasDiffs = true;
            rowHasDiff = true;
          }
        });
        if (rowHasDiff) diffCount++;
      });
      if (!hasDiffs) {
        // v8.35: NO borrar el draft automáticamente — conservar 30 días por
        // si el sistema cargó datos vacíos pero el draft tiene info válida.
        return;
      }

      // v8.35: banner MUY prominente — antes era discreto y los maestros lo
      // ignoraban. Ahora es modal-banner rojo grande con texto urgente.
      const fechaDraft = draft.time ? new Date(draft.time).toLocaleString('es-MX', {
        day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit'
      }) : 'sesión anterior';

      const banner = document.createElement('div');
      banner.className = 'draft-recovery-banner';
      banner.style.cssText = `
        background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);
        border:3px solid #d97706;
        border-radius:12px;
        padding:18px 22px;
        margin:14px 0;
        box-shadow:0 8px 20px rgba(217,119,6,0.25);
        position:relative;
      `;
      banner.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <span class="material-icons-round" style="font-size:36px;color:#b45309;flex-shrink:0;">restore</span>
          <div style="flex:1;">
            <h3 style="margin:0 0 6px;color:#78350f;font-size:17px;font-weight:900;">
              🟡 Tienes calificaciones sin guardar en este navegador
            </h3>
            <p style="margin:0 0 10px;color:#92400e;font-size:14px;line-height:1.5;">
              Detecté <strong>${diffCount}</strong> ${diffCount === 1 ? 'alumno' : 'alumnos'} con valores capturados
              que NO están en el servidor. Es probable que un bloqueo silencioso impidió que se guardaran.
              <strong>Recupera para no perder tu trabajo.</strong>
            </p>
            <p style="margin:0 0 12px;color:#78350f;font-size:12px;font-style:italic;">
              Capturados el ${Utils.sanitize(fechaDraft)}.
            </p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn" id="recover-draft-btn" style="background:#16a34a;color:#fff;border:none;padding:10px 22px;font-weight:800;font-size:14px;border-radius:8px;cursor:pointer;">
                ✅ RECUPERAR mis calificaciones
              </button>
              <button class="btn btn-outline" id="discard-draft-btn" style="padding:10px 18px;font-size:13px;">
                Descartar (perder)
              </button>
            </div>
          </div>
        </div>
      `;
      // Insertar arriba del editor para que sea lo primero que vean
      const editor = document.querySelector('.grade-editor-table');
      const targetParent = editor ? editor.closest('.module-container, .card')?.parentNode || editor.parentNode : null;
      if (targetParent && editor) {
        targetParent.insertBefore(banner, editor.closest('.card') || editor);
        // Scroll suave al banner
        setTimeout(() => banner.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }

      document.getElementById('recover-draft-btn')?.addEventListener('click', () => {
        _applyDraftValues(draft, 'sesión anterior');
        banner.remove();
        // Auto-guardar inmediatamente después de recuperar
        Toast.show('✓ Calificaciones recuperadas. Guardando…', 'success');
        setTimeout(() => {
          if (typeof saveGrades === 'function') {
            saveGrades({ silent: false }).catch(e => {
              console.error('Error al guardar después de recuperar:', e);
            });
          }
        }, 500);
      });

      document.getElementById('discard-draft-btn')?.addEventListener('click', () => {
        if (confirm('¿Seguro que quieres DESCARTAR las calificaciones sin guardar? Esta acción NO se puede deshacer.')) {
          localStorage.removeItem(_draftKey);
          banner.remove();
        }
      });
    } catch(e) { console.warn('Error en draft recovery:', e); }
  }

  // ─── BEFOREUNLOAD GUARD ───
  function _beforeUnloadGuard(e) {
    if (_isDirty) {
      e.preventDefault();
      e.returnValue = 'Tienes cambios sin guardar. ¿Deseas salir?';
      return e.returnValue;
    }
  }

  // ─── UNDO SYSTEM ───
  const _undoStack = [];
  const UNDO_MAX = 30;

  /** Capture a snapshot of all current input values */
  function _captureSnapshot(label) {
    const snapshot = { label, time: Date.now(), values: {} };
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const sid = row.dataset.studentId;
      snapshot.values[sid] = {};
      row.querySelectorAll('.ge-input').forEach(input => {
        snapshot.values[sid][input.dataset.field] = input.value;
      });
    });
    return snapshot;
  }

  /** Push current state to undo stack (call BEFORE making changes) */
  function _pushUndo(label) {
    _undoStack.push(_captureSnapshot(label));
    if (_undoStack.length > UNDO_MAX) _undoStack.shift();
    _updateUndoBtn();
  }

  /** Restore last snapshot */
  function _popUndo() {
    if (_undoStack.length === 0) return;
    const snapshot = _undoStack.pop();
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const sid = row.dataset.studentId;
      const vals = snapshot.values[sid];
      if (!vals) return;
      row.querySelectorAll('.ge-input').forEach(input => {
        const field = input.dataset.field;
        if (vals[field] !== undefined) input.value = vals[field];
      });
      // Recalc row
      const firstRubro = row.querySelector('.grade-rubro');
      if (firstRubro) _recalcRow(firstRubro);
    });
    if (snapshot.label === 'Antes de dejar lista en blanco') {
      _listCleared = false;
      _hideClearPendingNotice();
    }
    _updateStats();
    _updateUndoBtn();
    Toast.show(`Deshecho: ${snapshot.label}`, 'info');
  }

  function _getCurrentListLabel() {
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    const partial = K.PARCIALES.find(p => p.id === currentPartial);
    return {
      subjectName: asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject,
      groupName: asg ? (asg.groupName || asg.groupId) : selectedGroup,
      partialName: partial ? partial.nombre : currentPartial
    };
  }

  function _confirmClearCurrentList() {
    const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
    if (rows.length === 0) return;

    const list = _getCurrentListLabel();
    const message = `
      <div class="clear-list-confirm">
        <p>Esta accion prepara la lista para guardarse en blanco.</p>
        <dl>
          <div><dt>Grupo</dt><dd>${Utils.sanitize(list.groupName)}</dd></div>
          <div><dt>Materia</dt><dd>${Utils.sanitize(list.subjectName)}</dd></div>
          <div><dt>Parcial</dt><dd>${Utils.sanitize(list.partialName)}</dd></div>
        </dl>
        <ul>
          <li>Quita calificaciones, suma, calificación final y faltas de esta lista.</li>
          <li>No borra alumnos ni horas impartidas.</li>
          <li>No necesitas capturar horas impartidas para guardar una lista en blanco.</li>
          <li>Después de confirmar todavia debes presionar Guardar Calificaciones.</li>
        </ul>
      </div>`;

    Modal.confirmTyped('Dejar lista en blanco', message, 'BLANCO', _clearCurrentList);
  }

  function _showClearPendingNotice() {
    if (document.getElementById('clear-list-pending-notice')) return;
    const table = document.querySelector('.table-container');
    if (!table) return;
    const notice = document.createElement('div');
    notice.id = 'clear-list-pending-notice';
    notice.className = 'clear-list-pending-notice';
    notice.innerHTML = `
      <span class="material-icons-round">warning</span>
      <div>
        <strong>Lista preparada en blanco.</strong>
        <p>Revisa la tabla y presiona Guardar Calificaciones para aplicar el cambio.</p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="save-grades">
        <span class="material-icons-round">save</span>
        Guardar ahora
      </button>`;
    table.parentNode.insertBefore(notice, table);
  }

  function _hideClearPendingNotice() {
    document.getElementById('clear-list-pending-notice')?.remove();
  }

  function _clearCurrentList() {
    const rows = document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]');
    if (rows.length === 0) return;

    _pushUndo('Antes de dejar lista en blanco');
    rows.forEach(row => {
      row.querySelectorAll('.grade-rubro, .grade-faltas').forEach(input => {
        input.value = '';
        input.classList.remove('ge-input-invalid', 'paste-applied', 'paste-invalid');
      });
      const sumaCell = row.querySelector('.col-suma');
      const calCell = row.querySelector('.col-cal');
      if (sumaCell) sumaCell.textContent = '';
      if (calCell) {
        calCell.textContent = '';
        calCell.className = 'cell-cal col-cal';
      }
      row.classList.remove('row-reprobado');
    });

    _listCleared = true;
    _markDirty();
    _updateStats();
    _showClearPendingNotice();
    Toast.show('Lista preparada en blanco. Guarda para aplicar el cambio.', 'warning', 6000);
  }


  function _updateUndoBtn() {
    const btn = document.getElementById('undo-btn');
    if (!btn) return;
    btn.disabled = _undoStack.length === 0;
    const last = _undoStack[_undoStack.length - 1];
    btn.title = last ? `Deshacer: ${last.label}` : 'Nada que deshacer';
    const countEl = document.getElementById('undo-count');
    if (countEl) countEl.textContent = _undoStack.length > 0 ? _undoStack.length : '';
  }

  function _renderGradeEditor(partials) {
    const container = _container();
    const rubros = K.getRubros(currentTurno);

    // \u2550\u2550\u2550 DETECTAR MODO SOLO LECTURA \u2550\u2550\u2550
    // Regla EPO 67: parcial cerrado \u2192 maestro NO puede editar. Solo puede
    // SOLICITAR cambio formal via "Cambios de Calificaci\u00F3n".
    // Admin S\u00CD puede editar (acceso administrativo de emergencia).
    const _currentPartialDoc = partials.find(p => p.id === currentPartial);
    // v8.07: el cierre puede ser por grado individual (lockedByGrade) o global.
    // Inferimos el grado desde selectedGroup (formato MATUTINO_2-3 → 2).
    const _currentGrado = K.gradeFromGroupId(selectedGroup);
    // v8.10: exponer al scope del módulo para que el banner de fechas
    // críticas lo use al resolver byGrade del config/captureWindow.
    _moduleCurrentGrado = _currentGrado;
    const isLocked = K.isPartialLockedForGrade(_currentPartialDoc, _currentGrado);
    const userRole = App.currentUser?.role;
    const isAdminUser = userRole === 'admin' || _hasAdminPower();
    // Si el maestro tiene override activo del admin (acceso de emergencia),
    // NO se considera solo-lectura aunque el parcial esté cerrado.
    // _hasAdminPower() también cubre el caso de admin impersonando.
    const isReadOnlyForUser = isLocked && !isAdminUser && !_editorOverrideActive;

    // v8.25: YA NO bloqueamos la captura de P3 por falta de horas semestrales.
    // El bloqueo original (v7.95) era demasiado estricto y generaba frustración:
    // si el maestro quería capturar primero calificaciones y luego horas, no
    // podía. Ahora dejamos que capture libremente — el bloqueo se aplica al
    // INTENTAR IMPRIMIR (v8.20: _enforcePrintReadiness exige horas + alumnos
    // completos antes de imprimir). Esto preserva la integridad de la lista
    // oficial sin estorbar el flujo de captura.
    const _p3CapturaLocked = false;
    const _p3SinHoras = ['P1', 'P2', 'P3'].filter(pid => !_horasCapturadas[pid]);
    // Cal/rubros/faltas: bloqueado SOLO por parcial cerrado (regla por grado)
    const lockedDisabled = isReadOnlyForUser ? ' disabled' : '';
    // Inputs de HORAS impartidas: solo bloqueados por parcial cerrado, NUNCA
    // por el bloqueo P3-sin-horas (justamente queremos que las capture).
    const horasInputDisabled = isReadOnlyForUser ? ' disabled' : '';

    // Partial buttons — v8.13: el candado refleja el estado PARA EL GRADO
    // del maestro, no el global. Antes mostraba candado de P2 (cerrado global)
    // aunque para 3° estuviera abierto.
    const partialsHtml = K.PARCIALES.map(kp => {
      const doc = partials.find(p => p.id === kp.id);
      const locked = K.isPartialLockedForGrade(doc, _currentGrado);
      const cls = currentPartial === kp.id ? 'btn-primary' : 'btn-outline';
      return `<button class="btn btn-sm ${cls}" data-action="switch-partial" data-partial="${kp.id}">${kp.nombre}${locked ? ' \uD83D\uDD12' : ''}</button>`;
    }).join(' ');

    // Gender count
    const hCount = students.filter(s => s.sexo === 'H').length;
    const mCount = students.filter(s => s.sexo === 'M').length;

    // Header columns for rubros
    const headerCols = rubros.map(r =>
      `<th class="col-rubro" data-field="${r.key}">${r.abbr}<br><span style="font-weight:400;font-size:9px;opacity:0.8;">m\u00e1x ${r.max}</span></th>`
    ).join('');

    // Build rows
    let rowsHtml = '';
    students.forEach((s, i) => {
      const key = `${s.docId}_${selectedSubject}_${currentPartial}`;
      const gradeData = grades[key] || {};
      const isTraslado = !!s.bajaPendiente;

      // Contexto para la regla socioemocional: si la materia es del bloque,
      // el PE NO aplica en NINGÚN parcial (P1, P2, P3) — input gris + badge.
      const _peCtx = { subjectId: selectedSubject, partial: currentPartial };
      const peBlockedSocio = !K.subjectAllowsPE(selectedSubject);

      // v8.18: RESPETAR LO GUARDADO EN FIRESTORE — protección de históricos.
      // La regla "PE no rescata reprobados" (calcSuma) se introdujo el 13 mayo 2026.
      // Calificaciones capturadas ANTES de esa fecha tienen suma+cal guardados
      // que pueden NO coincidir con el recálculo actual. Al renderizar usamos
      // el dato guardado tal cual; el recálculo solo dispara al EDITAR un rubro.
      const storedSuma = gradeData.suma;
      const storedCal = gradeData.cal !== undefined ? gradeData.cal : (gradeData.value !== undefined ? gradeData.value : null);
      const hasStoredCalc = storedCal !== null && storedCal !== undefined && storedSuma !== undefined && storedSuma !== null;

      // Solo computamos "PE ignorado" para el badge si NO hay datos guardados
      // (captura nueva) o si el guardado coincide con el recálculo. Para datos
      // históricos donde la suma guardada incluye el PE, NO mostramos el badge
      // porque crea la falsa impresión de que la cal cambió.
      const rubrosDataMap = rubros.reduce((acc, r) => {
        if (gradeData[r.key] !== undefined) acc[r.key] = gradeData[r.key];
        return acc;
      }, {});
      const recalcSuma = K.calcSuma(rubrosDataMap, _peCtx);
      // Si el doc guardado ya tiene suma+cal Y difieren del recálculo actual,
      // significa que se capturó bajo una regla anterior — respetar lo guardado
      // y NO marcar PE como ignorado en la UI.
      const historicValueDiffers = hasStoredCalc && Math.abs(Number(storedSuma) - recalcSuma) > 0.01;
      const peIgnoredInitial = !isTraslado && !historicValueDiffers &&
        K.isPEIgnored(rubrosDataMap, _peCtx);

      const inputCells = rubros.map(r => {
        const val = isTraslado ? '' : (gradeData[r.key] !== undefined ? gradeData[r.key] : '');
        const peClass = (r.key === 'pe' && peIgnoredInitial) ? ' pe-input-ignored' : '';
        // Deshabilitar el input PE si la materia tiene PE bloqueado (socioemocional)
        const isPEBlocked = r.key === 'pe' && peBlockedSocio;
        const cellDisabled = (isTraslado || isReadOnlyForUser || isPEBlocked) ? ' disabled' : '';
        const blockedTitle = isPEBlocked ? ' title="No aplica Punto Extra — Componente Socioemocional (Gaceta EPO 67)"' : '';
        const blockedStyle = isPEBlocked ? ' style="background:#f3f4f6;color:#9ca3af;cursor:not-allowed;"' : '';
        return `<td class="cell-rubro" data-field="${r.key}">
          <input type="number" min="0" max="${r.max}" step="${r.step}" value="${val}" placeholder="${isTraslado ? '' : (isPEBlocked ? '—' : '-')}"
            class="ge-input grade-rubro${peClass}" data-student-id="${s.docId}" data-field="${r.key}"${cellDisabled}${blockedTitle}${blockedStyle}>
        </td>`;
      }).join('');

      // v8.18: usar SIEMPRE el valor guardado en Firestore si existe.
      // Si no existe (captura nueva), recalcular con regla actual.
      const suma = hasStoredCalc ? Number(storedSuma) : recalcSuma;
      const hasStoredData = hasStoredCalc || rubros.some(r => gradeData[r.key] !== undefined);
      // Badge informativo cuando el PE no aplica — pero NUNCA en valores históricos
      // (peIgnoredInitial ya considera historicValueDiffers).
      let peIgnoredBadge = '';
      if (peIgnoredInitial) {
        const motivo = peBlockedSocio
          ? 'Esta materia (componente socioemocional) NO acepta Punto Extra en ningún parcial — Gaceta oficial EPO 67.'
          : 'Regla EPO67: el Punto Extra no se aplica porque la suma base (sin PE) es menor a 6. Ingresa rubros suficientes para aprobar y el PE comenzara a sumar.';
        const labelBadge = peBlockedSocio ? 'PE no aplica (Socioemocional)' : 'PE no aplica';
        peIgnoredBadge = ` <span class="pe-ignored-badge" title="${motivo}">${labelBadge}</span>`;
      }
      const sumaDisplay = isTraslado ? '' : (hasStoredData ? suma.toFixed(1) + peIgnoredBadge : '');
      // CAL: si hay valor guardado en Firestore, usarlo TAL CUAL. Solo si no
      // existe, calcularlo desde la suma actual (captura nueva).
      const cal = isTraslado ? '' : (hasStoredCalc ? Number(storedCal) : (hasStoredData ? K.calcCal(suma) : ''));
      const calClass = cal !== '' && cal < 6 ? 'cal-fail' : (cal !== '' ? 'cal-pass' : '');
      // Estatus del alumno en ESTA materia (calculado por _computeStatusForCurrentEditor)
      // Pinta la fila para que el maestro vea de un vistazo quién ya está en extra
      // y quién está en riesgo, aun cuando la cal actual del parcial no lo refleje.
      const _stStu = _statusByStudent[s.docId];
      let _statusRowClass = '';
      let _statusBadge = '';
      let _statusTooltip = '';
      if (_stStu) {
        if (_stStu.isExtra) {
          _statusRowClass = ' row-extra-confirmed';
          const lbl = _stStu.estatus === 'EXTRA_AMBAS' ? 'EXTRA · cal+faltas'
                   : _stStu.estatus === 'EXTRA_CAL' ? 'EXTRA · calif'
                   : 'EXTRA · faltas';
          _statusBadge = ` <span class="badge-extra-row" title="${Utils.sanitize(_stStu.causa)}" style="background:#dc2626;color:#fff;font-size:0.6rem;padding:2px 7px;border-radius:8px;margin-left:6px;vertical-align:middle;font-weight:700;letter-spacing:.3px;">${lbl}</span>`;
          _statusTooltip = ` — ${_stStu.causa}`;
        } else if (_stStu.isRiesgo) {
          _statusRowClass = ' row-riesgo';
          const lbl = _stStu.estatus === 'EN_RIESGO_AMBAS' ? 'RIESGO · ambas'
                   : _stStu.estatus === 'EN_RIESGO_CAL' ? 'RIESGO · calif'
                   : 'RIESGO · faltas';
          _statusBadge = ` <span class="badge-riesgo-row" title="${Utils.sanitize(_stStu.causa)}" style="background:#d97706;color:#fff;font-size:0.6rem;padding:2px 7px;border-radius:8px;margin-left:6px;vertical-align:middle;font-weight:700;letter-spacing:.3px;">${lbl}</span>`;
          _statusTooltip = ` — ${_stStu.causa}`;
        }
      }
      const rowClass = (cal !== '' && Number(cal) < 6 ? ' row-reprobado' : '') + (isTraslado ? ' row-traslado' : '') + _statusRowClass;
      const faltas = isTraslado ? '' : (gradeData.faltas !== undefined ? gradeData.faltas : '');
      // Color de fondo según estatus (gana sobre traslado pendiente)
      let _rowStyle = '';
      if (isTraslado) {
        _rowStyle = ' style="background:#fff7ed;opacity:0.75;"';
      } else if (_stStu?.isExtra) {
        _rowStyle = ' style="background:#fef2f2;border-left:4px solid #dc2626;"';
      } else if (_stStu?.isRiesgo) {
        _rowStyle = ' style="background:#fffbeb;border-left:4px solid #d97706;"';
      }
      const trasladoBadge = isTraslado ? ' <span class="badge" style="background:#f97316;color:#fff;font-size:0.65rem;padding:1px 6px;margin-left:6px;vertical-align:middle;">TRASLADO PENDIENTE</span>' : '';

      rowsHtml += `<tr data-student-id="${s.docId}" data-traslado="${isTraslado ? '1' : '0'}" class="${rowClass}"${_rowStyle}>
        <td class="cell-num">${i + 1}</td>
        <td class="cell-name" title="${Utils.sanitize(s.nombreCompleto || '')}${isTraslado ? ' — Traslado pendiente: no se captura' : ''}${_statusTooltip}">${Utils.sanitize(s.nombreCompleto || '')}${_statusBadge}${trasladoBadge}</td>
        ${inputCells}
        <td class="cell-suma col-suma">${sumaDisplay}</td>
        <td class="cell-cal ${calClass} col-cal">${cal}</td>
        <td class="cell-faltas">
          <input type="number" min="0" max="99" step="1" value="${faltas}" placeholder="${isTraslado ? '' : '-'}"
            class="ge-input input-faltas grade-faltas" data-student-id="${s.docId}" data-field="faltas"${(isTraslado || isReadOnlyForUser) ? ' disabled' : ''}>
        </td>
        <td style="text-align:center;padding:2px;">
          ${isTraslado ? '' : `<button class="btn-icon" data-action="report-incident" data-student-id="${s.docId}" data-student-name="${Utils.sanitize(s.nombreCompleto || '')}" title="Reportar incidencia" style="color:var(--warning);background:none;border:none;cursor:pointer;padding:2px;">
            <span class="material-icons-round" style="font-size:18px;">flag</span>
          </button>`}
        </td>
      </tr>`;
    });

    // Find subject name
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    const subjectName = asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject;
    const groupName = asg ? (asg.groupName || asg.groupId) : selectedGroup;

    // Build paste field options
    const pasteFieldOptions = rubros.map(r => `<option value="${r.key}">${r.label} (${r.abbr})</option>`).join('') +
      `<option value="faltas">FALTAS</option>`;

    // lockWarning aparece SOLO para admin cuando el parcial está cerrado
    // (el maestro ya ve el hero morado grande con CTA a "Cambios de Calificación")
    const lockWarning = (isLocked && isAdminUser) ? `
      <div class="partial-lock-banner">
        <span class="material-icons-round" style="font-size:20px;">lock</span>
        <span>Este parcial está <b>cerrado</b>. Acceso administrativo activo — puedes editar con responsabilidad.</span>
      </div>` : '';

    // Pesta\u00f1as de asignaciones (solo si tiene >1 asignaci\u00f3n)
    const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
    const tabsHtml = currentAsg ? _renderAssignmentTabs(currentAsg.id) : '';

    // Banner de cobertura temporal (compacto, colapsable)
    const interimBanner = currentAsg && currentAsg.interim ? `
      <details style="background:#fffbeb;border-left:4px solid #d97706;border-radius:6px;padding:6px 12px;margin-bottom:8px;font-size:12px;color:#78350f;">
        <summary style="cursor:pointer;font-weight:700;display:flex;align-items:center;gap:6px;">
          \ud83d\udfe0 Cobertura temporal <span style="opacity:0.75;font-weight:400;font-size:11px;">\u00b7 clic para detalles</span>
        </summary>
        <div style="margin-top:6px;line-height:1.5;">
          Est\u00e1s cubriendo esta materia. Lo que captures se transferir\u00e1 al docente definitivo cuando administraci\u00f3n apruebe la transici\u00f3n.
          ${currentAsg.interimNote ? `<br><em style="opacity:0.85;">Nota: ${Utils.sanitize(currentAsg.interimNote)}</em>` : ''}
        </div>
      </details>` : '';

    const teacherNameForHeader = currentAsg && currentAsg.teacherName
      ? (Utils.displayName ? Utils.displayName(currentAsg.teacherName) : currentAsg.teacherName)
      : '';
    container.innerHTML = `
      <div class="module-container">
        <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div style="flex:1;min-width:280px;">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
              <h2 class="module-title" style="margin:0;">${Utils.sanitize(subjectName)}</h2>
              <span style="background:#3182ce;color:#fff;padding:4px 14px;border-radius:8px;font-size:15px;font-weight:800;letter-spacing:0.5px;white-space:nowrap;">${Utils.sanitize(groupName)}</span>
              <!-- v8.10: badge MUY visible del parcial activo para que el maestro NO se confunda -->
              <span style="display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#d97706 0%,#b45309 100%);color:#fff;padding:5px 14px;border-radius:8px;font-size:14px;font-weight:800;letter-spacing:0.5px;white-space:nowrap;box-shadow:0 2px 6px rgba(180,83,9,0.35);">
                <span class="material-icons-round" style="font-size:16px;">assignment</span>
                ${Utils.sanitize(_currentPartialDoc?.nombre || ('Parcial ' + (currentPartial || '').replace('P','')))}
              </span>
              ${isReadOnlyForUser ? `
                <span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;border:1px solid #c4b5fd;">
                  <span class="material-icons-round" style="font-size:14px;">lock</span>
                  Solo lectura
                </span>
              ` : `
                <span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#166534;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;">
                  <span class="material-icons-round" style="font-size:14px;">bolt</span>
                  Autoguardado activo
                </span>
                <span id="autosave-hero-state" style="background:#dbeafe;color:#1e3a8a;padding:4px 12px;border-radius:12px;font-weight:600;display:none;font-size:11px;"></span>
              `}
            </div>
            <p class="module-subtitle" style="margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              ${teacherNameForHeader ? `<span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:#1e293b;">
                <span class="material-icons-round" style="font-size:16px;color:#3182ce;">person</span>
                ${Utils.sanitize(teacherNameForHeader)}
              </span>` : ''}
              <span style="color:#64748b;">${Utils.sanitize(currentTurno)} \u00b7 ${hCount}H / ${mCount}M = ${students.length} alumnos</span>
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            ${isReadOnlyForUser ? '' : `
              <span id="autosave-status" style="display:none;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;"></span>
              <span id="unsaved-indicator" class="unsaved-badge" style="display:none;">
                <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit_note</span> Sin guardar
              </span>
              <button class="btn btn-outline btn-sm" data-action="recover-local-draft" title="Busca datos capturados en este navegador que no llegaron a guardarse. No borra nada." style="padding:6px 10px;font-size:12px;">
                <span class="material-icons-round" style="font-size:15px;">restore</span>
                Recuperar borrador
              </button>
            `}
            <button class="btn btn-outline" data-action="back-to-list">\u2190 Volver</button>
          </div>
        </div>

        ${isReadOnlyForUser ? `
        <!-- \u2550\u2550\u2550 MODO SOLO LECTURA: parcial cerrado para maestros \u2550\u2550\u2550 -->
        <div style="background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 50%,#4c1d95 100%);border-radius:14px;padding:20px 24px;margin-bottom:14px;color:#fff;box-shadow:0 8px 24px rgba(91,33,182,0.35);">
          <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
            <span class="material-icons-round" style="font-size:54px;flex-shrink:0;background:rgba(255,255,255,0.2);border-radius:50%;padding:10px;">lock</span>
            <div style="flex:1;min-width:240px;">
              <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;opacity:0.85;text-transform:uppercase;margin-bottom:3px;">
                Parcial ${Utils.sanitize(_currentPartialDoc?.nombre || currentPartial)}
              </div>
              <div style="font-size:22px;font-weight:900;line-height:1.15;margin-bottom:6px;">
                Este parcial est\u00e1 CERRADO
              </div>
              <div style="font-size:13.5px;opacity:0.95;line-height:1.5;">
                <strong>No puedes editar calificaciones aqu\u00ed.</strong> Esta vista es solo de consulta para ver lo que qued\u00f3 capturado al cierre del parcial.
              </div>
            </div>
            <button onclick="Router.navigate('correction-request')" style="background:#fff;color:#5b21b6;border:none;border-radius:10px;padding:14px 20px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;box-shadow:0 3px 8px rgba(0,0,0,0.2);display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span class="material-icons-round" style="font-size:20px;">edit_note</span>
              Solicitar cambio formal
            </button>
          </div>
          <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:10px 14px;margin-top:14px;font-size:12.5px;line-height:1.5;">
            <strong>\u00bfEncontraste un error?</strong> Para modificar una calificaci\u00f3n de un parcial cerrado debes
            <strong>solicitar un cambio formal</strong> en el m\u00f3dulo "Cambios de Calificaci\u00f3n". La solicitud
            se imprime, la firma la directora, y Subdirecci\u00f3n la aplica. Es la \u00fanica v\u00eda permitida una vez
            cerrada la ventana de edici\u00f3n.
          </div>
        </div>
        ` : ''}

        ${tabsHtml}

        ${interimBanner}

        ${lockWarning}

        <div id="capture-deadline-banner"></div>

        ${isReadOnlyForUser ? '' : `
        <!-- v8.14: Banner recordatorio SIEMPRE expandido — antes era <details> colapsable
             pero los maestros lo ignoraban; ahora la info crítica queda visible directo. -->
        <div style="background:linear-gradient(90deg,#eff6ff 0%,#ecfeff 100%);border-left:4px solid #3182ce;border-radius:6px;padding:10px 14px;margin-bottom:10px;font-size:12.5px;color:#1e3a8a;">
          <div style="display:flex;align-items:center;gap:8px;font-weight:800;line-height:1.4;color:#1e3a8a;">
            <span class="material-icons-round" style="font-size:18px;color:#3182ce;">tips_and_updates</span>
            Recordatorios para captura
          </div>
          <ul style="margin:8px 0 0 24px;padding:0;line-height:1.65;color:#1e293b;">
            <li><strong>Guardado automático.</strong> No te preocupes por guardar — entra y sale las veces que quieras, lo capturado queda guardado.</li>
            <li><strong>Corrige libremente mientras esté abierta la ventana de captura</strong> — no necesitas solicitud formal.</li>
            <li><strong>Antes de imprimir:</strong> verifica con tus alumnos que las calificaciones sean las correctas. Imprime una sola vez.</li>
            <li><strong>La impresión de la lista es tu responsabilidad.</strong> Dirección recibe <u>UNA sola lista con TODAS las firmas</u>. Si corriges algo después de firmar, debes <u>volver a recolectar todas las firmas</u> y entregar la versión más actualizada.</li>
            <li>Si ya cerró la ventana de captura y necesitas un cambio, espera a la <strong>ventana de correcciones</strong> y haz la solicitud formal desde el módulo "Solicitar Corrección".</li>
            <li><strong>Respeta los tiempos</strong> de captura y correcciones — los atrasos afectan todas las líneas administrativas (boletas, certificados, entrega de documentos a alumnos).</li>
          </ul>
        </div>
        `}

        <div id="risk-banner-faltas"></div>

        <!-- Banner persistente: alumnos reprobados con motivo PENDIENTE de reportar -->
        <div id="failure-incident-reminder"></div>

        <div class="card">
          <div class="form-group"><label>Parcial:</label><div class="btn-group">${partialsHtml}</div></div>
        </div>

        ${isReadOnlyForUser ? '' : `
        <!-- BARRA COMPACTA: solo botones de acción (sin tip redundante) -->
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;margin:6px 0;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" id="undo-btn" disabled title="Deshacer último cambio (Ctrl+Z)" style="position:relative;padding:4px 10px;font-size:12px;">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">undo</span>
            Deshacer
            <span id="undo-count" style="position:absolute;top:-6px;right:-6px;background:#e53e3e;color:#fff;font-size:10px;font-weight:700;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;"></span>
          </button>
          <button class="btn btn-outline btn-sm btn-danger-soft" data-action="clear-grades-list" title="Deja en blanco calificaciones y faltas de esta lista. No borra alumnos ni horas." style="padding:4px 10px;font-size:12px;">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">backspace</span>
            Limpiar lista
          </button>
        </div>
        `}

        ${isReadOnlyForUser ? '' : `
        <!-- CARD discreta: ayuda para pegar desde Excel (colapsada por default) -->
        <div id="paste-help-card" style="background:#fff;border:1px solid #fed7aa;border-radius:8px;margin:6px 0 10px;overflow:hidden;">
          <button data-action="toggle-paste-help" style="width:100%;background:#fff7ed;border:none;color:#9a3412;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;font-family:inherit;text-align:left;font-size:12px;">
            <span style="display:flex;align-items:center;gap:6px;">
              <span class="material-icons-round" style="font-size:16px;color:#ea580c;">content_paste</span>
              <span style="font-weight:600;">Ayuda para pegar desde Excel</span>
              <span style="font-weight:400;color:#9a3412;opacity:0.75;">— ${Utils.sanitize(currentTurno)}</span>
            </span>
            <span class="material-icons-round" id="paste-help-chevron" style="font-size:18px;transition:transform 0.2s;color:#9a3412;">expand_more</span>
          </button>

          <!-- COLAPSADO por defecto (display:none). El maestro lo abre cuando lo necesita. -->
          <div id="paste-help-body" style="padding:14px 16px;background:#fff;display:none;border-top:1px solid #fed7aa;">

            <!-- NUEVO: aviso de pegado inteligente -->
            <div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:2px solid #f59e0b;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
              <div style="font-size:14px;font-weight:800;color:#78350f;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                <span style="font-size:18px;">✨</span> Nuevo: Pegado inteligente
              </div>
              <div style="font-size:12.5px;color:#78350f;line-height:1.5;">
                Si pegas con problemas comunes (<strong>escala /100</strong>, <strong>columnas en otro orden</strong>, encabezado con SUMA/CAL, filas vacías), el sistema te <strong>avisa antes de aplicar</strong> y te ofrece arreglarlo automáticamente con una vista previa. Siempre puedes pegar tal cual o deshacer con <kbd style="padding:2px 6px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-family:monospace;font-size:11px;font-weight:700;">Ctrl + Z</kbd>.
              </div>
            </div>

            <!-- TABLA DE ESCALAS (rubros según el turno actual) — siempre visible primero -->
            <div style="background:#fff7ed;border-radius:8px;padding:12px 14px;margin-bottom:14px;border:2px solid #fb923c;">
              <div style="font-size:14px;font-weight:800;color:#9a3412;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                <span style="font-size:18px;">📏</span> Máximos permitidos por columna
              </div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                  <thead>
                    <tr style="background:#fed7aa;">
                      <th style="text-align:left;padding:8px 10px;font-weight:800;color:#7c2d12;">Columna</th>
                      <th style="text-align:center;padding:8px 10px;font-weight:800;color:#7c2d12;width:80px;">Mínimo</th>
                      <th style="text-align:center;padding:8px 10px;font-weight:800;color:#7c2d12;width:80px;">Máximo</th>
                      <th style="text-align:center;padding:8px 10px;font-weight:800;color:#7c2d12;width:110px;">Decimales</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rubros.map((r, i) => `<tr style="background:${i % 2 ? '#fff' : '#fffbf5'};">
                      <td style="padding:8px 10px;font-weight:700;color:#0f172a;border-bottom:1px solid #fed7aa;">${Utils.sanitize(r.label)} <span style="color:#9a3412;font-weight:600;">(${Utils.sanitize(r.key.toUpperCase())})</span></td>
                      <td style="text-align:center;padding:8px 10px;color:#475569;border-bottom:1px solid #fed7aa;">0</td>
                      <td style="text-align:center;padding:8px 10px;color:#c2410c;font-weight:900;font-size:15px;border-bottom:1px solid #fed7aa;">${r.max}</td>
                      <td style="text-align:center;padding:8px 10px;color:#475569;border-bottom:1px solid #fed7aa;">${r.step === 1 ? 'No (entero)' : 'Sí (0.1)'}</td>
                    </tr>`).join('')}
                    <tr style="background:${rubros.length % 2 ? '#fff' : '#fffbf5'};">
                      <td style="padding:8px 10px;font-weight:700;color:#0f172a;">FALTAS</td>
                      <td style="text-align:center;padding:8px 10px;color:#475569;">0</td>
                      <td style="text-align:center;padding:8px 10px;color:#c2410c;font-weight:900;font-size:15px;">99</td>
                      <td style="text-align:center;padding:8px 10px;color:#475569;">No (entero)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style="font-size:12px;color:#7c2d12;margin-top:10px;line-height:1.45;background:rgba(255,255,255,0.7);border-radius:6px;padding:8px 10px;">
                <strong>⛔ NO pegues las columnas SUMA ni CAL</strong> — el sistema las calcula sola. Si tu Excel las trae, simplemente las ignora.
                ${currentTurno === 'VESPERTINO' ? '<br><strong>📝 Vespertino:</strong> EXAMEN PARCIAL (EX) sólo aplica para tu turno.' : '<br><strong>📝 Matutino:</strong> NO hay columna EXAMEN PARCIAL (esa solo aplica en vespertino).'}
              </div>
            </div>

            <!-- PASOS PARA PEGAR -->
            <div style="background:#ecfdf5;border-radius:8px;padding:12px 14px;margin-bottom:12px;border-left:4px solid #10b981;">
              <div style="font-size:14px;font-weight:800;color:#065f46;margin-bottom:8px;">✅ Cómo pegar paso a paso</div>
              <ol style="font-size:13px;color:#064e3b;line-height:1.65;margin:0;padding-left:22px;">
                <li>En Excel, <strong>selecciona y copia (Ctrl+C)</strong> la columna o el bloque que quieres pegar — solo valores numéricos, sin SUMA ni CAL.</li>
                <li>En esta tabla, <strong>haz clic en la celda</strong> del primer alumno donde quieres que empiece el pegado (ej. fila del alumno #1, columna EC).</li>
                <li>Presiona <kbd style="padding:2px 6px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-family:monospace;font-size:11px;font-weight:700;">Ctrl + V</kbd> (Windows) o <kbd style="padding:2px 6px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-family:monospace;font-size:11px;font-weight:700;">⌘ + V</kbd> (Mac).</li>
                <li>El sistema rellena hacia abajo desde esa celda y te muestra cuántas filas aplicó y cuántas quedaron en rojo (fuera de rango).</li>
              </ol>
            </div>

            <!-- POR QUÉ FALLA -->
            <div style="background:#fef3c7;border-radius:8px;padding:12px 14px;margin-bottom:12px;border-left:4px solid #f59e0b;">
              <div style="font-size:14px;font-weight:800;color:#78350f;margin-bottom:8px;">⚠ Si no se pega, casi siempre es esto:</div>
              <ul style="font-size:13px;color:#78350f;line-height:1.65;margin:0;padding-left:22px;">
                <li><strong>Olvidaste hacer clic en una celda primero.</strong> El cursor debe estar adentro de un input de la tabla. Si está en cualquier otro lado el navegador no pega.</li>
                <li><strong>Valor fuera de rango.</strong> Si pegas un 9 en EC del matutino (máx 8), queda en rojo y NO se aplica. Corrige el dato en Excel y vuelve a pegar, o escríbelo a mano.</li>
                <li><strong>Texto en vez de número.</strong> Celdas con texto como "NP", "FALTA" o comentarios se ignoran. Usa solo dígitos (coma o punto como decimal: <code>8.5</code> o <code>8,5</code>).</li>
                <li><strong>Encabezado.</strong> Si el primer renglón del clipboard es texto ("EC", "Calificación"...), el sistema lo detecta y lo brinca — no consume el lugar del primer alumno.</li>
                <li><strong>Celdas vacías.</strong> NO sobrescriben lo que ya está. Si quieres borrar un valor, hazlo a mano celda por celda.</li>
              </ul>
            </div>

            <!-- TIPS ADICIONALES -->
            <div style="background:#eff6ff;border-radius:8px;padding:12px 14px;border-left:4px solid #3182ce;">
              <div style="font-size:14px;font-weight:800;color:#1e40af;margin-bottom:8px;">💡 Tips útiles</div>
              <ul style="font-size:13px;color:#1e3a8a;line-height:1.65;margin:0;padding-left:22px;">
                <li>Puedes pegar <strong>una sola columna</strong> (ej. solo EC) o un <strong>bloque de columnas contiguas</strong> — el sistema respeta el orden de las columnas de tu Excel.</li>
                <li>Si pegas un bloque que NO incluye todas las columnas (ej. solo EC y TR), solo se llenan esas — el resto queda intacto.</li>
                <li>Si te equivocaste, dale <strong>Deshacer</strong> (botón arriba o <kbd style="padding:2px 6px;background:#fff;border:1px solid #cbd5e0;border-radius:4px;font-family:monospace;font-size:11px;font-weight:700;">Ctrl + Z</kbd>) y el sistema regresa al estado anterior.</li>
                <li>Los alumnos con badge "TRASLADO PENDIENTE" naranja NO reciben pegado — se brincan automáticamente.</li>
                <li>Para borrar todo de golpe, usa <strong>"Dejar lista en blanco"</strong> (no borra alumnos ni horas).</li>
              </ul>
            </div>
          </div>
        </div>
        `}


        ${_p3CapturaLocked ? `
          <!-- v8.22: mensaje simplificado — las horas son SEMESTRALES (una sola
               vez para todo el semestre). Antes decía "captúralas en P1, P2, P3"
               que confundía porque parecía que había horas distintas por parcial. -->
          <div style="background:linear-gradient(135deg,#7c2d12 0%,#b91c1c 100%);color:#fff;border-radius:12px;padding:14px 20px;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;gap:14px;">
              <span class="material-icons-round" style="font-size:32px;flex-shrink:0;background:rgba(255,255,255,0.18);border-radius:50%;padding:8px;">lock</span>
              <div style="flex:1;">
                <div style="font-size:16px;font-weight:800;margin-bottom:4px;">Primero captura las horas del semestre</div>
                <div style="font-size:13px;line-height:1.55;opacity:0.95;">
                  Baja al panel naranja <strong>"Horas impartidas del semestre"</strong> al final de la lista y captura los meses de Febrero a Julio. Aplican a los 3 parciales automáticamente.
                </div>
              </div>
            </div>
          </div>
        ` : ''}
        ${_renderStatusBanner()}

        <div class="table-container" style="overflow-x:auto;max-height:65vh;">
          <table class="grade-editor-table" style="min-width:750px;">
            <thead>
              <tr>
                <th class="col-num">#</th>
                <th class="col-name" style="text-align:left;padding-left:12px;">Estudiante</th>
                ${headerCols}
                <th class="col-suma" style="width:60px;">SUMA${typeof HelpTip !== 'undefined' ? HelpTip.html('Suma de Evaluación Continua + Transversal + (Examen Parcial solo vespertino) + Punto Extra. El sistema la calcula automáticamente. Si excede 10, se queda en 10.', { size: 13 }) : ''}</th>
                <th class="col-cal" style="width:55px;">CAL.${typeof HelpTip !== 'undefined' ? HelpTip.html('Calificación final. Si SUMA es ≥6, redondea normal (máx 10). Si SUMA es <6, automáticamente queda en 5. Tú NUNCA escribes esta columna.', { size: 13 }) : ''}</th>
                <th class="col-faltas" style="width:58px;">FALTAS${typeof HelpTip !== 'undefined' ? HelpTip.html('Total de faltas del alumno en el parcial. Si supera el 20% de las horas impartidas, el alumno pierde derecho a calificación ordinaria (extraordinario).', { size: 13 }) : ''}</th>
                <th style="width:32px;background:#4a5568;" title="Reportar incidencia"></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="stats-grid" style="margin-top:16px;">
          <div class="stat-card--compact"><div class="stat-label">Promedio</div><div class="stat-number" id="stat-promedio">-</div></div>
          <div class="stat-card--compact stat-card--success"><div class="stat-label">Aprobados (\u2265${K.THRESHOLDS.PASS_GRADE})</div><div class="stat-number" id="stat-aprobados">-</div></div>
          <div class="stat-card--compact stat-card--danger"><div class="stat-label">Reprobados (&lt;${K.THRESHOLDS.PASS_GRADE})</div><div class="stat-number" id="stat-reprobados">-</div></div>
          <div class="stat-card--compact"><div class="stat-label">Sin calificaci\u00f3n</div><div class="stat-number" id="stat-sin-calif">-</div></div>
        </div>

        <div class="card horas-card">
          <div class="horas-card-header">
            <h3>Horas impartidas del semestre <span style="font-size:11px;font-weight:600;color:#3182ce;background:#dbeafe;padding:2px 8px;border-radius:8px;margin-left:6px;vertical-align:middle;">Febrero a Julio</span></h3>
            <span>Obligatorio antes de guardar</span>
          </div>
          <!-- v8.15: aclaración para los maestros — las horas son SEMESTRALES,
               se capturan una sola vez y aplican a los 3 parciales. Antes había
               confusión porque el doc se guardaba por parcial. -->
          <div style="font-size:12px;color:#475569;background:#f1f5f9;border-left:3px solid #3182ce;padding:6px 10px;border-radius:4px;margin-bottom:10px;line-height:1.45;">
            <strong>Captúralas una sola vez.</strong> El semestre completo abarca de febrero a julio.
            Las horas que pongas aquí se aplicarán automáticamente a los <strong>tres parciales</strong>
            — no tienes que volver a capturarlas en P2 ni P3.
          </div>
          <div class="horas-grid">
            ${['Febrero','Marzo','Abril','Mayo','Junio','Julio'].map(m =>
              `<div class="horas-month">
                <label>${m}</label>
                <input type="number" min="0" max="99" step="1" id="horas-${m.toLowerCase()}"
                  class="ge-input horas-input" data-month="${m.toLowerCase()}"${horasInputDisabled}>
              </div>`
            ).join('')}
            <div class="horas-total-box">
              <label>Total</label>
              <div id="horas-total">0</div>
            </div>
          </div>
        </div>

        <!-- ZONA DE FIN DE CAPTURA: lo PRIMERO que ve el maestro al terminar la tabla -->
        <div style="background:linear-gradient(135deg,#1e3a8a 0%,#312e81 50%,#4338ca 100%);border-radius:14px;padding:24px;margin-top:32px;color:#fff;box-shadow:0 8px 24px rgba(49,46,129,0.35);">
          <div style="text-align:center;margin-bottom:14px;">
            <div style="font-size:14px;font-weight:600;opacity:0.9;margin-bottom:4px;">¿Ya terminaste de capturar TODAS tus listas?</div>
            <div style="font-size:22px;font-weight:800;line-height:1.2;">
              📄 Descarga tu PDF del parcial actual
            </div>
            <div style="font-size:13px;opacity:0.95;margin-top:6px;line-height:1.45;">
              Tus cambios ya se guardaron solos.
              <strong>Imprime, recolecta firmas y entrega a Dirección.</strong>
            </div>
          </div>

          <!-- AVISO CRÍTICO: imprime SOLO al terminar todas las listas -->
          <div id="print-progress-warning" style="background:rgba(255,255,255,0.16);border:2px solid rgba(255,255,255,0.55);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:flex-start;gap:10px;line-height:1.45;">
            <span class="material-icons-round" style="font-size:22px;flex-shrink:0;margin-top:1px;">priority_high</span>
            <div style="flex:1;font-size:13px;">
              <div style="font-weight:800;font-size:14px;margin-bottom:3px;">Imprime UNA sola vez, al final</div>
              <div style="opacity:0.95;">
                Dirección recibe <strong>una sola lista por grupo y materia</strong>, con TODAS
                las firmas. <strong>No</strong> se acepta entregar una lista con errores y
                luego otra "con correcciones" firmada solo por algunos alumnos. Si imprimes
                a medias o con errores, tendrás que reimprimir la lista completa y
                <strong>volver a recoger todas las firmas</strong>.
              </div>
              <div id="print-progress-detail" style="margin-top:8px;font-size:13px;font-weight:700;background:rgba(0,0,0,0.18);border-radius:6px;padding:6px 10px;display:inline-block;">
                Calculando avance…
              </div>
            </div>
          </div>

          <!-- Subtítulo de las 3 opciones -->
          <div style="text-align:center;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;opacity:0.85;margin-bottom:10px;">
            Elige cómo imprimir
          </div>

          <!-- 3 OPCIONES PROMINENTES: TODAS · ESCOGER · SÓLO ESTA -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:12px;">

            <!-- 1. TODAS (recomendada — fondo blanco sólido) -->
            <button class="btn" data-action="print-all-my-lists"
              style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
                     background:#fff;color:#312e81;border:3px solid #fff;border-radius:12px;
                     padding:18px 14px;cursor:pointer;font-family:inherit;text-align:center;
                     box-shadow:0 6px 16px rgba(0,0,0,0.25);position:relative;">
              <span style="position:absolute;top:-10px;right:10px;background:#16a34a;color:#fff;font-size:10px;font-weight:800;padding:3px 8px;border-radius:10px;letter-spacing:0.5px;">RECOMENDADO</span>
              <span class="material-icons-round" style="font-size:38px;color:#4338ca;">picture_as_pdf</span>
              <div style="font-size:14px;font-weight:900;line-height:1.2;">
                <span id="print-all-label">TODAS MIS ${_capAssignments?.length || ''} LISTAS DEL PARCIAL ACTUAL</span>
              </div>
              <div style="font-size:11px;color:#6b21a8;line-height:1.35;font-weight:500;">
                Un solo PDF con todas tus listas. Lo más rápido cuando ya terminaste todo.
              </div>
            </button>

            <!-- 2. ESCOGER ALGUNAS -->
            <button class="btn" data-action="select-lists-to-print"
              style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
                     background:rgba(255,255,255,0.12);color:#fff;border:2px dashed rgba(255,255,255,0.7);border-radius:12px;
                     padding:18px 14px;cursor:pointer;font-family:inherit;text-align:center;">
              <span class="material-icons-round" style="font-size:38px;opacity:0.95;">checklist</span>
              <div style="font-size:14px;font-weight:900;line-height:1.2;">
                ESCOGER ALGUNAS LISTAS
              </div>
              <div style="font-size:11px;opacity:0.9;line-height:1.35;font-weight:500;">
                Te abre una lista con casillas para marcar exactamente cuáles entrarán al PDF.
              </div>
            </button>

            <!-- 3. SÓLO ESTA LISTA -->
            <button class="btn" data-action="print-grades"
              style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
                     background:rgba(255,255,255,0.12);color:#fff;border:2px dashed rgba(255,255,255,0.7);border-radius:12px;
                     padding:18px 14px;cursor:pointer;font-family:inherit;text-align:center;">
              <span class="material-icons-round" style="font-size:38px;opacity:0.95;">description</span>
              <div style="font-size:14px;font-weight:900;line-height:1.2;">
                SÓLO ESTA LISTA
              </div>
              <div style="font-size:11px;opacity:0.9;line-height:1.35;font-weight:500;">
                Sólo la lista que tienes abierta ahora — la del grupo y materia visible arriba.
              </div>
            </button>

          </div>

          <div style="text-align:center;margin-top:14px;font-size:11px;opacity:0.85;line-height:1.4;">
            Para guardarlo como archivo elige <strong>"Guardar como PDF"</strong> en lugar de impresora.
          </div>

          <!-- Opción secundaria menor: otro parcial -->
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.25);text-align:center;">
            <button class="btn-link" data-action="show-other-partials"
              style="background:none;border:none;color:#fff;cursor:pointer;font-size:12.5px;padding:6px 12px;text-decoration:underline;opacity:0.8;font-family:inherit;">
              <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">history</span>
              ¿Necesitas imprimir otro parcial (anterior o posterior)?
            </button>
          </div>
        </div>

        <!-- Acciones secundarias en línea pequeña -->
        <div style="display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;font-size:12px;color:#64748b;">
          <button class="btn-link" data-action="back-to-list" style="background:none;border:none;color:#3182ce;cursor:pointer;font-size:13px;padding:4px 8px;text-decoration:underline;">
            ← Volver a mis listas
          </button>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn-link" data-action="refresh-from-server" style="background:none;border:1px solid #cbd5e1;color:#0891b2;cursor:pointer;font-size:12px;padding:6px 12px;border-radius:6px;" title="Si las celdas se ven vacías pero ya las llenaste antes, esto fuerza una recarga desde el servidor (limpia el cache local).">
              🔄 Refrescar datos del servidor
            </button>
            ${isReadOnlyForUser ? '' : `
            <button class="btn-link" data-action="save-grades" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:12px;padding:4px 8px;" title="Tus cambios ya se guardan solos cada 3 segundos. Este botón fuerza un guardado ahora mismo.">
              💾 Forzar guardado (opcional)
            </button>
            `}
          </div>
        </div>
      </div>`;

    _delegateClick(container);

    // ═══ INITIALIZE EDITOR STATE ═══
    _undoStack.length = 0;
    _isDirty = false;
    _isSaving = false;
    _listCleared = false;
    _draftKey = `grade_draft_${selectedGroup}_${selectedSubject}_${currentPartial}`;

    // ═══ INPUT CLAMPING + UNDO + DIRTY TRACKING (event delegation) ═══
    // Antes: 5 listeners por input × ~300 inputs = ~1500 listeners DOM, lag al teclear.
    // Ahora: 4 listeners en container, independiente del tamano de la tabla.
    let _snapshotPending = false;

    const _isGradeInput = (el) => !!(el && el.classList &&
      (el.classList.contains('grade-rubro') || el.classList.contains('grade-faltas')));

    // focus/blur no burbujean, usamos focusin/focusout
    container.addEventListener('focusin', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      input.select();
      if (!_snapshotPending) {
        _snapshotPending = true;
        input._prevVal = input.value;
      }
    });

    container.addEventListener('focusout', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      if (input.value.trim() === '') { _snapshotPending = false; return; }
      const maxVal = parseFloat(input.max) || 10;
      const isInteger = input.classList.contains('grade-faltas');
      let v = parseFloat(input.value.replace(',', '.'));
      if (isNaN(v)) { input.value = ''; input.classList.remove('ge-input-invalid'); _snapshotPending = false; return; }
      v = Math.max(0, Math.min(v, maxVal));
      v = isInteger ? Math.round(v) : Math.round(v * 10) / 10;
      input.value = v;
      input.classList.remove('ge-input-invalid');
      if (input.classList.contains('grade-rubro')) _recalcRow(input);
      _snapshotPending = false;
      // Al terminar de teclear una calificación, refrescamos el banner de
      // incidencias pendientes (debounced 400ms). Si el alumno quedó reprobado
      // y sin motivo capturado, el maestro lo verá enseguida.
      _scheduleFailureBannerUpdate();
      // FIX (v7.83): save INMEDIATO al perder foco si hay cambios pendientes.
      // Antes solo se confiaba en el debounce de 3s del auto-save. Si el maestro
      // editaba y cerraba la pestaña (o cambiaba de vista) en menos de 3s,
      // el cambio se perdía. Ahora cada Tab/Enter/click-fuera fuerza commit.
      _flushAutoSave();
    });

    container.addEventListener('input', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;
      if (_snapshotPending && input.value !== input._prevVal) {
        _pushUndo('Edición manual');
        _snapshotPending = false;
      }
      _markDirty();

      const maxVal = parseFloat(input.max) || 10;
      const raw = input.value.trim();
      if (raw === '') {
        input.classList.remove('ge-input-invalid');
      } else {
        const v = parseFloat(raw.replace(',', '.'));
        if (isNaN(v) || v < 0 || v > maxVal) input.classList.add('ge-input-invalid');
        else input.classList.remove('ge-input-invalid');
      }

      if (input.classList.contains('grade-rubro')) _recalcRow(input);
    });

    container.addEventListener('keydown', (e) => {
      const input = e.target;
      if (!_isGradeInput(input)) return;

      // NOTA: ya NO bloqueamos caracteres con preventDefault. Antes hacíamos
      // un filtro estricto (solo dígitos/nav/Ctrl+combos) y eso causaba un bug
      // raro: después de imprimir o cambiar de tab, algunos teclados/navegadores
      // empezaban a reportar e.key con valores distintos (dead-keys, layouts
      // hispanos, numpad sin numlock) y el filtro empezaba a rechazar dígitos
      // legítimos. Resultado: el maestro no podía teclear, solo usar la rueda
      // del mouse en el spinner del input number.
      // Solución: confiar en type="number" del navegador + clamping al hacer
      // blur (focusout handler arriba). Si el maestro escribe texto inválido,
      // el blur lo limpia automáticamente. Cero bloqueo de teclas.

      // Smart navigation: Enter va a siguiente fila misma columna; al final pasa a primera fila siguiente columna
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = input.closest('tr');
        const field = input.dataset.field;
        const nextRow = row && row.nextElementSibling;
        if (nextRow) {
          const nextInput = nextRow.querySelector(`input[data-field="${field}"]`);
          if (nextInput) { nextInput.focus(); return; }
        }
        const firstRow = input.closest('tbody') && input.closest('tbody').querySelector('tr');
        if (firstRow && row) {
          const allFields = [...row.querySelectorAll('.ge-input')].map(i => i.dataset.field);
          const currentIdx = allFields.indexOf(field);
          if (currentIdx >= 0 && currentIdx < allFields.length - 1) {
            const nextField = allFields[currentIdx + 1];
            const target = firstRow.querySelector(`input[data-field="${nextField}"]`);
            if (target) target.focus();
          }
        }
        return;
      }

      // 3) Arrow up/down: navegacion entre filas misma columna
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const row = input.closest('tr');
        const field = input.dataset.field;
        const targetRow = e.key === 'ArrowUp'
          ? (row && row.previousElementSibling)
          : (row && row.nextElementSibling);
        if (targetRow && targetRow.dataset.studentId) {
          e.preventDefault();
          const targetInput = targetRow.querySelector(`input[data-field="${field}"]`);
          if (targetInput) targetInput.focus();
        }
      }
    });

    // ═══ UNDO ═══
    document.getElementById('undo-btn')?.addEventListener('click', _popUndo);
    document.getElementById('assignment-jump')?.addEventListener('change', (e) => {
      const targetAsg = _orderedAssignments().find(a => a.id === e.target.value);
      if (!targetAsg) return;
      if (!_canLeaveEditor()) {
        const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
        e.target.value = currentAsg?.id || '';
        return;
      }
      if (_isDirty && !confirm('Tienes cambios sin guardar en esta lista. ¿Cambiar de lista sin guardar?')) {
        const currentAsg = assignments.find(a => a.groupId === selectedGroup && a.subjectId === selectedSubject);
        e.target.value = currentAsg?.id || '';
        return;
      }
      api.openGradeEditor(targetAsg.id, targetAsg.groupId, targetAsg.subjectId);
    });
    container._undoHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (_undoStack.length > 0) { e.preventDefault(); _popUndo(); }
      }
    };
    document.addEventListener('keydown', container._undoHandler);

    // ═══ BEFOREUNLOAD GUARD ═══
    window.addEventListener('beforeunload', _beforeUnloadGuard);

    // FIX (v7.83): FLUSH al cerrar/cambiar pestaña.
    // Listeners idempotentes (solo se registran 1 vez globalmente).
    // - pagehide: cierra/recarga/navega — mas confiable que beforeunload en moviles
    // - visibilitychange=hidden: cambio de pestaña/app, bloqueo de pantalla
    //   (el caso típico "edito → cambio a WhatsApp → vuelvo 10 min → debounce nunca disparo")
    _installUnloadHandlers();

    // ═══ AUTO-SAVE DRAFT every 30 seconds ═══
    if (_draftTimer) clearInterval(_draftTimer);
    _draftTimer = setInterval(_saveDraft, 30000);

    // ═══ POLLING DE ESTADO DEL PARCIAL (cada 30s) ═══
    // Si el admin cierra el parcial mientras un maestro está editando, el
    // editor debe detectarlo y entrar en modo solo-lectura ANTES de que el
    // maestro siga capturando datos que no se van a guardar. Sin esto, el
    // maestro teclea por minutos creyendo que se guarda y pierde todo.
    if (_partialPollTimer) clearInterval(_partialPollTimer);
    if (!_hasAdminPower()) {  // Admin nunca se bloquea, ahorrar la query
      _partialPollTimer = setInterval(_pollPartialState, 30000);
    }

    // ═══ HORAS IMPARTIDAS ═══
    container.querySelectorAll('.horas-input').forEach(input => {
      input.addEventListener('input', () => {
        // Si vino de fallback y ahora el usuario lo está modificando, ya no es
        // prestado — quitar la marca para que sí se persista al guardar.
        delete input.dataset.fromFallback;
        _updateHorasTotal();
        _markDirty();
        _scheduleRiskBannerUpdate();
        // v8.22: si el maestro empieza a teclear horas, asumimos que va a
        // capturar — desbloqueamos el banner rojo de P3 inmediatamente.
        // El autoguardado persistirá los valores en los 3 parciales en breve.
        const horasData = _getHorasData();
        if (Object.keys(horasData).length > 0) {
          _horasCapturadas = { P1: true, P2: true, P3: true };
        }
      });
    });
    _loadHoras().then(() => _updateRiskBanner());
    _updateCaptureDeadlineBanner();

    // ═══ FALTAS → actualizar banner de riesgo ═══
    container.querySelectorAll('input.grade-faltas').forEach(input => {
      input.addEventListener('input', _scheduleRiskBannerUpdate);
    });

    _updateStats();
    _updateUndoBtn();
    _bindInputModes(container);

    // Actualiza la zona de impresión (botón con nombre del parcial activo +
    // contador de avance) asíncronamente para no bloquear el render inicial.
    _updatePrintZoneAfterRender();

    // Actualiza el banner de incidencias pendientes al cargar el editor.
    // Si la lista trae reprobados previos sin motivo, el maestro lo ve enseguida.
    _scheduleFailureBannerUpdate();

    // Respetar el estado guardado de la tarjeta "reglas para pegar".
    // Por defecto está COLAPSADA (cargaba mucho la pantalla). Solo se abre si
    // el maestro explícitamente la dejó abierta antes.
    try {
      if (localStorage.getItem('epo67_paste_help_collapsed') === '0') {
        const body = document.getElementById('paste-help-body');
        const chevron = document.getElementById('paste-help-chevron');
        if (body) body.style.display = 'block';
        if (chevron) chevron.textContent = 'expand_less';
      }
    } catch (_) {}

    // ═══ HIGHLIGHT EMPTY CELLS (when coming from monitor) ═══
    if (sessionStorage.getItem('epo67_highlightEmpty') === '1') {
      sessionStorage.removeItem('epo67_highlightEmpty');
      _highlightEmptyCells();
    }

    // ═══ CHECK FOR DRAFT RECOVERY ═══
    setTimeout(_checkDraftRecovery, 500);
  }

  // ─── HIGHLIGHT EMPTY ROWS/CELLS ───
  function _highlightEmptyCells() {
    document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]').forEach(row => {
      const calCell = row.querySelector('.col-cal');
      const hasCal = calCell && calCell.textContent.trim() !== '';
      if (hasCal) return; // Row already has a grade, skip

      // Mark entire row with a distinct background
      row.style.background = 'rgba(128,90,213,0.08)';
      row.style.borderLeft = '3px solid #805ad5';

      row.querySelectorAll('.ge-input.grade-rubro').forEach(input => {
        if (input.value.trim() === '') {
          input.style.background = 'rgba(128,90,213,0.15)';
          input.style.borderColor = '#805ad5';
        }
      });

      // Watch all rubros in this row — when ALL have values, clear row highlight
      const checkRowComplete = () => {
        const allFilled = [...row.querySelectorAll('.ge-input.grade-rubro')].every(inp => inp.value.trim() !== '');
        if (allFilled) {
          row.style.background = '';
          row.style.borderLeft = '';
          row.querySelectorAll('.ge-input.grade-rubro').forEach(inp => {
            inp.style.background = '';
            inp.style.borderColor = '';
            inp.removeEventListener('input', checkRowComplete);
          });
        }
      };
      row.querySelectorAll('.ge-input.grade-rubro').forEach(input => {
        input.addEventListener('input', checkRowComplete);
      });
    });
  }

  // ─── PASTE NATIVO TIPO EXCEL — INSPECCIÓN INTELIGENTE ───
  // Flujo:
  //  1. Parsear clipboard.
  //  2. _inspectPaste detecta problemas comunes (header desordenado, escala /100,
  //     filas vacías intermedias, columnas calculadas como SUMA/CAL).
  //  3. Si hay issues, abrir modal bloqueante con checkboxes + preview.
  //  4. Aplicar con o sin transformaciones según elección del maestro.
  //  5. Snapshot de undo SIEMPRE → Ctrl+Z deshace todo.
  function _bindInputModes(container) {
    const tableContainer = container.querySelector('.grade-editor-table');
    if (!tableContainer) return;

    tableContainer.addEventListener('paste', _handleTablePaste);
  }

  // ─── DICCIONARIO DE ALIAS PARA HEADERS DE EXCEL ───
  // Cada field interno mapea a sus posibles nombres en el Excel del maestro.
  // Normalizado: sin acentos, mayúsculas, sin paréntesis, sin puntuación.
  const _PASTE_FIELD_ALIASES = {
    ec: ['EC', 'EVALUACION', 'EVALUACION CONTINUA', 'EVAL CONTINUA', 'EV CONT', 'CONTINUA', 'EVAL'],
    tr: ['TR', 'TRANSVERSAL', 'TRANSV', 'TRANS'],
    pe: ['PE', 'PUNTO EXTRA', 'P EXTRA', 'PUNTOS EXTRA', 'EXTRA'],
    ex: ['EX', 'EXAMEN', 'EXAMEN PARCIAL', 'EX PARCIAL', 'EXAMEN PARC'],
    faltas: ['FALTAS', 'INASISTENCIAS', 'INASIST', 'FALTA'],
  };

  // Columnas que el maestro a veces deja en su Excel pero que el sistema CALCULA solo.
  // Las brincamos al pegar.
  const _PASTE_IGNORED_HEADERS = [
    'SUMA', 'CAL', 'CALIFICACION', 'CALIF', 'TOTAL', 'PROMEDIO', 'PROM',
    'NUM', 'NUMERO', 'N', 'NO', '#', 'NOMBRE', 'ALUMNO', 'ESTUDIANTE',
  ];

  function _normalizePasteHeader(s) {
    return (s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quitar marcas diacríticas
      .replace(/\([^)]*\)/g, '')                          // quitar (max 8), (8 pts)
      .replace(/[^A-Z0-9 ]/gi, ' ')                       // quitar puntuación
      .replace(/\s+/g, ' ')
      .toUpperCase().trim();
  }

  // Devuelve el field interno (ec, tr, pe, ex, faltas) si reconoce el header,
  // o 'IGNORE' si es columna calculada (SUMA, CAL, etc), o null si no reconoce.
  function _matchPasteHeader(cell) {
    const norm = _normalizePasteHeader(cell);
    if (!norm) return null;
    for (const [field, aliases] of Object.entries(_PASTE_FIELD_ALIASES)) {
      if (aliases.includes(norm)) return field;
    }
    if (_PASTE_IGNORED_HEADERS.includes(norm)) return 'IGNORE';
    return null;
  }

  // Inspecciona el contenido del clipboard y devuelve un reporte con los
  // problemas detectados y las transformaciones propuestas. NO modifica DOM.
  function _inspectPaste(rows, startFieldIdx, fieldOrder) {
    const report = {
      headerSkipped: false,           // ¿la primera fila es header?
      headerCells: null,              // celdas del header parseado
      columnMap: null,                // { clipboardColIdx: targetField | 'IGNORE' | null }
      canRemap: false,                // ¿hay reorden de columnas?
      remapDescriptors: [],           // descripción legible del mapeo
      scaleHints: {},                 // { targetField: { factor, examples, converted } }
      canScale: false,
      emptyMidRows: 0,                // filas completamente vacías intermedias
      hasEmptyMid: false,
      issues: [],                     // claves activas: 'remap', 'scale', 'empty'
    };

    if (!rows || rows.length === 0) return report;

    // ─── 1) DETECTAR HEADER ───
    const headerCells = (rows[0] || '').split('\t').map(c => c.trim());
    // Es header si ALGUNA celda mapea a un field reconocido o IGNORE,
    // O si la primera celda es texto no-numérico (heurística antigua).
    const anyKnown = headerCells.some(c => _matchPasteHeader(c) !== null);
    const firstNumeric = !isNaN(parseFloat((headerCells[0] || '').replace(',', '.').replace(/[^0-9.\-]/g, '')));
    const isHeader = anyKnown || (headerCells[0] !== '' && !firstNumeric);
    const dataStart = isHeader ? 1 : 0;
    report.headerSkipped = isHeader;
    if (isHeader) report.headerCells = headerCells;

    // ─── 2) CONSTRUIR COLUMN MAP SI HAY HEADER ───
    if (isHeader) {
      const map = {};
      let recognized = 0;
      let ignored = 0;
      for (let j = 0; j < headerCells.length; j++) {
        const matched = _matchPasteHeader(headerCells[j]);
        if (matched === 'IGNORE') {
          map[j] = 'IGNORE';
          ignored++;
        } else if (matched && fieldOrder.includes(matched)) {
          map[j] = matched;
          recognized++;
        } else {
          map[j] = null;  // desconocida — caemos a posicional para esta columna
        }
      }
      // Construir descriptor legible
      report.remapDescriptors = headerCells.map((c, j) => ({
        original: c,
        target: map[j],
      }));
      // Proponemos remap si reconocimos ≥1 columna Y el orden difiere de lo
      // que daría una asignación posicional desde startFieldIdx (esto cubre
      // también el caso de "pegué EC en la columna equivocada").
      if (recognized >= 1) {
        report.columnMap = map;
        // Comparar contra orden posicional
        const positional = [];
        for (let j = 0; j < headerCells.length; j++) {
          const fi = startFieldIdx + j;
          positional.push(fi < fieldOrder.length ? fieldOrder[fi] : null);
        }
        const isDifferent = headerCells.some((_, j) => {
          const mapped = map[j];
          if (mapped === 'IGNORE' || mapped === null) return false;
          return mapped !== positional[j];
        });
        if (isDifferent || ignored > 0) {
          report.canRemap = true;
          report.issues.push('remap');
        }
      }
    }

    // ─── 3) RESOLVER FIELD PARA CADA COLUMNA (con o sin remap) ───
    const resolveField = (j) => {
      if (report.columnMap) {
        const m = report.columnMap[j];
        if (m === 'IGNORE') return null;
        if (m) return m;
      }
      const fi = startFieldIdx + j;
      return fi < fieldOrder.length ? fieldOrder[fi] : null;
    };

    // ─── 4) RECOLECTAR VALORES + FILAS VACÍAS INTERMEDIAS ───
    const valuesByField = {};
    let emptyMidCount = 0;
    for (let i = dataStart; i < rows.length; i++) {
      const cells = rows[i].split('\t');
      let rowHasNumeric = false;
      for (let j = 0; j < cells.length; j++) {
        const field = resolveField(j);
        if (!field) continue;
        const cleaned = (cells[j] || '').trim().replace(',', '.').replace(/[^0-9.\-]/g, '');
        if (cleaned === '') continue;
        const num = parseFloat(cleaned);
        if (!isNaN(num)) {
          if (!valuesByField[field]) valuesByField[field] = [];
          valuesByField[field].push(num);
          rowHasNumeric = true;
        }
      }
      // Fila completamente vacía en medio (no la última)
      if (!rowHasNumeric && i < rows.length - 1) emptyMidCount++;
    }
    report.emptyMidRows = emptyMidCount;
    if (emptyMidCount > 0) {
      report.hasEmptyMid = true;
      report.issues.push('empty');
    }

    // ─── 5) DETECTAR ESCALA /100 POR COLUMNA DESTINO ───
    // Sólo para campos con max ≤10 (no faltas), y solo si >70% de valores exceden
    // Y al dividir entre 10 todos caben dentro del rango.
    const rubros = K.getRubros(currentTurno);
    for (const [field, vals] of Object.entries(valuesByField)) {
      if (vals.length === 0) continue;
      if (field === 'faltas') continue;
      const rubro = rubros.find(r => r.key === field);
      const max = rubro ? rubro.max : 10;
      if (max > 10) continue;
      const overMax = vals.filter(v => v > max).length;
      const ratio = overMax / vals.length;
      const divFitsAll = vals.every(v => (v / 10) >= 0 && (v / 10) <= max);
      if (ratio >= 0.7 && divFitsAll) {
        report.scaleHints[field] = {
          factor: 0.1,
          examples: vals.slice(0, 4),
          converted: vals.slice(0, 4).map(v => Math.round(v) / 10),
          max,
        };
      }
    }
    if (Object.keys(report.scaleHints).length > 0) {
      report.canScale = true;
      report.issues.push('scale');
    }

    return report;
  }

  // Modal bloqueante. Devuelve Promise<{ accept, fixes }>
  // accept=false → cancelar todo el paste.
  // accept=true, fixes={} → pegar tal cual (sin transformaciones).
  // accept=true, fixes={remap, scale, empty, emptyMode} → aplicar arreglos.
  function _showPasteInspectionModal(report) {
    return new Promise((resolve) => {
      const blocks = [];

      // BLOQUE: REORDEN DE COLUMNAS
      if (report.canRemap) {
        const rows = report.remapDescriptors.map(d => {
          let badge = '';
          if (d.target === 'IGNORE') {
            badge = '<span style="background:#fef3c7;color:#78350f;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;">se ignora (columna calculada)</span>';
          } else if (d.target) {
            badge = `<span style="background:#dcfce7;color:#14532d;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;">→ ${d.target.toUpperCase()}</span>`;
          } else {
            badge = '<span style="background:#fef3c7;color:#78350f;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;">no reconocida — cae por posición</span>';
          }
          return `<tr>
            <td style="padding:5px 8px;color:#1e293b;font-weight:600;">${Utils.sanitize(d.original)}</td>
            <td style="padding:5px 8px;">${badge}</td>
          </tr>`;
        }).join('');
        blocks.push(`
          <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;">
            <label style="display:flex;gap:10px;cursor:pointer;align-items:flex-start;">
              <input type="checkbox" data-issue-key="remap" checked style="margin-top:3px;transform:scale(1.2);flex-shrink:0;">
              <div style="flex:1;">
                <div style="font-weight:800;color:#1e40af;font-size:14.5px;display:flex;align-items:center;gap:6px;">
                  🔀 Reordenar columnas según el encabezado de tu Excel
                </div>
                <div style="font-size:12.5px;color:#4b5563;margin-top:4px;margin-bottom:8px;">
                  Detecté el encabezado y voy a meter cada columna en su lugar correcto sin importar el orden en que vino.
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;">
                  <thead><tr style="background:#f1f5f9;"><th style="text-align:left;padding:5px 8px;color:#475569;font-weight:700;">Tu Excel</th><th style="text-align:left;padding:5px 8px;color:#475569;font-weight:700;">Se pegará en</th></tr></thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </label>
          </div>`);
      }

      // BLOQUE: ESCALA /100
      if (report.canScale) {
        const fieldList = Object.entries(report.scaleHints).map(([f, h]) => {
          const before = h.examples.slice(0, 3).join(', ');
          const after = h.converted.slice(0, 3).join(', ');
          return `<li style="margin-bottom:3px;"><strong>${f.toUpperCase()}</strong> (máx ${h.max}): <code style="background:#fee2e2;padding:1px 5px;border-radius:3px;color:#991b1b;">${before}…</code> → <code style="background:#dcfce7;padding:1px 5px;border-radius:3px;color:#14532d;">${after}…</code></li>`;
        }).join('');
        blocks.push(`
          <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;">
            <label style="display:flex;gap:10px;cursor:pointer;align-items:flex-start;">
              <input type="checkbox" data-issue-key="scale" checked style="margin-top:3px;transform:scale(1.2);flex-shrink:0;">
              <div style="flex:1;">
                <div style="font-weight:800;color:#9a3412;font-size:14.5px;">
                  📐 Tus valores parecen estar en escala /100
                </div>
                <div style="font-size:12.5px;color:#4b5563;margin-top:4px;margin-bottom:6px;">
                  Detecté que la mayoría de valores son muy altos para la escala del sistema (/10). Te propongo dividir entre 10:
                </div>
                <ul style="font-size:13px;color:#374151;line-height:1.5;margin:0;padding-left:22px;">${fieldList}</ul>
              </div>
            </label>
          </div>`);
      }

      // BLOQUE: FILAS VACÍAS INTERMEDIAS
      if (report.hasEmptyMid) {
        blocks.push(`
          <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;">
            <label style="display:flex;gap:10px;cursor:pointer;align-items:flex-start;">
              <input type="checkbox" data-issue-key="empty" checked style="margin-top:3px;transform:scale(1.2);flex-shrink:0;">
              <div style="flex:1;">
                <div style="font-weight:800;color:#92400e;font-size:14.5px;">
                  ➖ ${report.emptyMidRows} fila(s) vacía(s) en medio de tus datos
                </div>
                <div style="font-size:12.5px;color:#4b5563;margin-top:4px;margin-bottom:8px;">
                  ¿Qué hago con esas líneas en blanco?
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#374151;">
                  <label style="display:flex;gap:6px;align-items:center;cursor:pointer;background:#fff;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;">
                    <input type="radio" name="empty-mode" value="skip" checked>
                    <span><strong>Brincar</strong> las filas vacías (no consumen alumnos) <em style="color:#6b7280;">— recomendado si era separación visual</em></span>
                  </label>
                  <label style="display:flex;gap:6px;align-items:center;cursor:pointer;background:#fff;padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;">
                    <input type="radio" name="empty-mode" value="keep">
                    <span><strong>Mantener</strong> (avanza alumno sin escribir) <em style="color:#6b7280;">— si querías saltarte alumnos puntuales</em></span>
                  </label>
                </div>
              </div>
            </label>
          </div>`);
      }

      const body = `
        <div style="background:#eff6ff;border-left:4px solid #3182ce;padding:10px 12px;border-radius:6px;font-size:13px;color:#1e40af;margin-bottom:14px;">
          <strong>Detecté ${report.issues.length} detalle${report.issues.length === 1 ? '' : 's'} en tu pegado.</strong>
          Te propongo arreglarlos antes de aplicar. Marca los que quieras aplicar:
        </div>
        ${blocks.join('')}
        <div style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:12px;color:#475569;line-height:1.45;margin-top:8px;">
          <strong>🛟 Red de seguridad:</strong> sea cual sea tu elección, puedes deshacerlo con
          <kbd style="padding:1px 5px;background:#fff;border:1px solid #cbd5e0;border-radius:3px;font-family:monospace;font-size:11px;font-weight:700;">Ctrl + Z</kbd>
          inmediatamente.
        </div>
      `;

      const footer = `
        <button class="btn btn-outline" id="paste-cancel" style="margin-right:auto;">Cancelar</button>
        <button class="btn" id="paste-raw" style="background:#94a3b8;color:#fff;">Pegar tal cual</button>
        <button class="btn btn-primary" id="paste-apply">Aplicar arreglos</button>
      `;

      Modal.open('Pegado inteligente — revisa antes de aplicar', body, footer);

      setTimeout(() => {
        const wrap = document.getElementById('paste-cancel')?.closest('.modal, [role="dialog"], #genericModal') || document;
        document.getElementById('paste-cancel')?.addEventListener('click', () => {
          Modal.close();
          resolve({ accept: false });
        });
        document.getElementById('paste-raw')?.addEventListener('click', () => {
          Modal.close();
          resolve({ accept: true, fixes: {} });
        });
        document.getElementById('paste-apply')?.addEventListener('click', () => {
          const fixes = {};
          document.querySelectorAll('[data-issue-key]').forEach(cb => {
            if (cb.checked) fixes[cb.dataset.issueKey] = true;
          });
          if (fixes.empty) {
            const mode = document.querySelector('input[name="empty-mode"]:checked')?.value || 'skip';
            fixes.emptyMode = mode;
          }
          Modal.close();
          resolve({ accept: true, fixes });
        });
      }, 60);
    });
  }

  async function _handleTablePaste(e) {
    const targetInput = e.target.closest('input.ge-input');
    if (!targetInput) return;

    const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!clipboardText) return;

    // Parsear: filas separadas por \n, columnas por \t
    let rows = clipboardText.split(/\r?\n/);
    // Solo quitar vacías trailing (suelen venir del clipboard como newline final).
    while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop();
    if (rows.length === 0) return;

    // Si es UN solo valor sin tabs, dejar el paste nativo del input
    if (rows.length === 1 && !rows[0].includes('\t')) return;

    // Multi-valor: tomamos control del paste y distribuimos
    e.preventDefault();

    // Localizar fila/columna inicial
    const startRow = targetInput.closest('tr[data-student-id]');
    if (!startRow) return;
    const allRows = [...document.querySelectorAll('.grade-editor-table tbody tr[data-student-id]')];
    const startRowIdx = allRows.indexOf(startRow);
    if (startRowIdx === -1) return;

    // Orden de columnas editables (campos): rubros + faltas, en orden visual
    const fieldOrder = [...startRow.querySelectorAll('input.ge-input')].map(i => i.dataset.field);
    const startFieldIdx = fieldOrder.indexOf(targetInput.dataset.field);
    if (startFieldIdx === -1) return;

    // ═══ INSPECCIÓN: detectar problemas comunes ═══
    const report = _inspectPaste(rows, startFieldIdx, fieldOrder);

    // Si hay issues, mostrar modal bloqueante con preview
    let choice = { accept: true, fixes: {} };
    if (report.issues.length > 0) {
      choice = await _showPasteInspectionModal(report);
      if (!choice.accept) return;  // canceló
    }

    const fixes = choice.fixes || {};
    const dataStart = report.headerSkipped ? 1 : 0;
    const useRemap = !!fixes.remap && !!report.columnMap;
    const useScale = !!fixes.scale && !!report.scaleHints;
    const skipEmptyRows = fixes.empty && fixes.emptyMode === 'skip';

    // ═══ SNAPSHOT UNDO ═══
    const dataRowCount = rows.length - dataStart;
    _pushUndo('Pegar (' + dataRowCount + ' fila' + (dataRowCount === 1 ? '' : 's') + ')');

    // Función para resolver el field destino de cada columna del clipboard.
    // Con remap activo: 'IGNORE' = brincar; field reconocido = directo; null = fallback posicional.
    const resolveField = (j) => {
      if (useRemap) {
        const m = report.columnMap[j];
        if (m === 'IGNORE') return null;       // SUMA, CAL, NOMBRE → brincar
        if (m) return m;                        // header reconocido → field correcto
        // m === null → header no reconocido → no perder el dato, usar posición
      }
      const fi = startFieldIdx + j;
      return fi < fieldOrder.length ? fieldOrder[fi] : null;
    };

    let appliedCount = 0;
    let invalidCount = 0;
    let emptyCount = 0;
    let skippedEmptyRowsCount = 0;
    let scaledCount = 0;
    const changedInputs = [];
    const invalidInputs = [];

    let writtenIdx = 0;  // posición en la tabla destino (avanza solo cuando escribimos fila)

    for (let i = dataStart; i < rows.length; i++) {
      const cells = rows[i].split('\t');

      // Detectar fila completamente vacía
      const rowAllEmpty = cells.every(c => (c || '').trim() === '');
      if (rowAllEmpty) {
        if (skipEmptyRows) {
          skippedEmptyRowsCount++;
          continue;  // NO consumir alumno
        }
        // Modo default: avanzar alumno sin escribir
        writtenIdx++;
        continue;
      }

      const targetRowIdx = startRowIdx + writtenIdx;
      writtenIdx++;
      if (targetRowIdx >= allRows.length) break;
      const targetRow = allRows[targetRowIdx];
      if (targetRow.dataset.traslado === '1') { emptyCount++; continue; }

      for (let j = 0; j < cells.length; j++) {
        const targetField = resolveField(j);
        if (!targetField) continue;
        const cellInput = targetRow.querySelector(`input.ge-input[data-field="${targetField}"]`);
        if (!cellInput) continue;

        const cellRaw = (cells[j] || '').trim();

        // CELDA VACÍA: preservar valor existente del alumno (NO sobrescribir)
        if (cellRaw === '') { emptyCount++; continue; }

        // Limpiar y parsear (acepta coma decimal)
        const cleaned = cellRaw.replace(',', '.').replace(/[^0-9.\-]/g, '');
        const isInt = cellInput.classList.contains('grade-faltas');
        let num = isInt ? parseInt(cleaned, 10) : parseFloat(cleaned);
        const max = Number(cellInput.max) || (isInt ? 99 : 10);

        // Aplicar escala /100 si el maestro la confirmó para este field
        if (useScale && report.scaleHints[targetField] && !isNaN(num)) {
          num = num * report.scaleHints[targetField].factor;
          scaledCount++;
        }

        // Inválido: marcar rojo, NO aplicar
        if (isNaN(num) || num < 0 || num > max) {
          cellInput.classList.add('paste-invalid');
          invalidInputs.push(cellInput);
          invalidCount++;
          continue;
        }

        // Aplicar: redondear a 1 decimal (rubros) o entero (faltas)
        const finalVal = isInt ? Math.round(num) : Math.round(num * 10) / 10;
        cellInput.value = finalVal;
        cellInput.classList.add('paste-applied');
        changedInputs.push(cellInput);
        if (cellInput.classList.contains('grade-rubro')) _recalcRow(cellInput);
        appliedCount++;
      }
    }

    _markDirty();
    _updateStats();

    // Quitar highlight tras 5 segundos
    setTimeout(() => {
      changedInputs.forEach(i => i.classList.remove('paste-applied'));
      invalidInputs.forEach(i => i.classList.remove('paste-invalid'));
    }, 5000);

    // Toast informativo
    const parts = [];
    parts.push(`✅ ${appliedCount} valor${appliedCount === 1 ? '' : 'es'} aplicado${appliedCount === 1 ? '' : 's'}`);
    if (report.headerSkipped) parts.push('1 encabezado omitido');
    if (useRemap) parts.push('columnas reordenadas');
    if (useScale) parts.push('escala /100 convertida');
    if (skippedEmptyRowsCount > 0) parts.push(`${skippedEmptyRowsCount} fila(s) vacía(s) brincadas`);
    if (emptyCount > 0) parts.push(`${emptyCount} sin cambio`);
    if (invalidCount > 0) parts.push(`${invalidCount} en rojo (fuera de rango)`);
    Toast.show(parts.join(' · '), invalidCount > 0 ? 'warning' : 'success');
  }


  // ─── HORAS IMPARTIDAS ───
  // Carga las horas del parcial actual. Si el doc de este parcial no existe o
  // está vacío, hace FALLBACK a las horas del parcial más recientemente capturado
  // del mismo grupo+materia. Las horas impartidas son básicamente las mismas
  // para todo el semestre, así que mostrar las de otro parcial da contexto al
  // maestro/admin para que vean lo que ya capturaron.
  async function _loadHoras() {
    const months = ['febrero','marzo','abril','mayo','junio','julio'];
    const hasAnyHoras = (data) => months.some(m => data && data[m] !== undefined && data[m] !== null && data[m] !== '');

    let source = null;  // 'current' | partialId del que vino el fallback | null
    let data = null;

    try {
      // 1) Intentar el doc canónico semestral
      let docId = `${selectedGroup}_${selectedSubject}_SEMESTRE`;
      let doc = await db.collection('teacherHours').doc(docId).get();
      if (doc.exists && hasAnyHoras(doc.data())) {
        data = doc.data();
        source = 'current';
      }

      // 2) Fallback: intentar el parcial actual
      if (!data) {
        docId = `${selectedGroup}_${selectedSubject}_${currentPartial}`;
        doc = await db.collection('teacherHours').doc(docId).get();
        if (doc.exists && hasAnyHoras(doc.data())) {
          data = doc.data();
          source = 'current';
        }
      }

      // 3) Fallback: buscar en los OTROS parciales del mismo grupo+materia
      if (!data) {
        const otherPartials = K.PARCIALES
          .map(p => p.id)
          .filter(p => p !== currentPartial);
        // Probar en orden: primero P2 (suele ser el más actualizado), luego los demás
        const priorityOrder = ['P2', 'P3', 'P1'].filter(p => otherPartials.includes(p));
        for (const p of priorityOrder) {
          const fallbackId = `${selectedGroup}_${selectedSubject}_${p}`;
          try {
            const fbDoc = await db.collection('teacherHours').doc(fallbackId).get();
            if (fbDoc.exists && hasAnyHoras(fbDoc.data())) {
              data = fbDoc.data();
              source = p;
              break;
            }
          } catch (e) { /* continuar */ }
        }
      }

      // 4) Aplicar los datos a los inputs (si encontramos algo).
      //    Si vinieron de fallback, marcar el input para que NO se guarden
      //    automáticamente en el parcial actual al guardar grades (el admin
      //    podría sobrescribir P1 con horas de P2 sin querer).
      if (data) {
        months.forEach(m => {
          const el = document.getElementById('horas-' + m);
          if (el && data[m] !== undefined) {
            el.value = data[m];
            if (source && source !== 'current') {
              el.dataset.fromFallback = source;
            } else {
              delete el.dataset.fromFallback;
            }
          }
        });
        _updateHorasTotal();
      }

      // 5) Si vino de otro parcial, mostrar nota informativa
      _showHorasSourceNote(source);
    } catch (e) { console.warn('Error loading horas:', e); }
  }

  // v8.15: ya NO mostramos "estas horas se tomaron del Segundo Parcial..."
  // porque las horas son SEMESTRALES — se capturan una sola vez y aplican a
  // los 3 parciales. El banner causaba confusión: parecía un error cuando en
  // realidad era el flujo correcto. La función queda como no-op para no
  // romper a los callers; cualquier nota previa se borra al pasar por aquí.
  function _showHorasSourceNote(source) {
    const existing = document.getElementById('horas-source-note');
    if (existing) existing.remove();
    // No-op intencional: las horas semestrales se reflejan en los 3 parciales
    // automáticamente, no hay nada que aclarar.
  }

  function _updateHorasTotal() {
    let total = 0;
    document.querySelectorAll('.horas-input').forEach(input => {
      const v = parseInt(input.value);
      if (!isNaN(v)) total += v;
      input.classList.toggle('has-value', input.value.trim() !== '');
    });
    const el = document.getElementById('horas-total');
    if (el) el.textContent = total;
  }

  async function _saveHorasData(horasData) {
    if (!horasData || Object.keys(horasData).length === 0) return false;
    // v8.32: las horas son una sola captura del SEMESTRE. Guardamos un doc
    // canónico y reflejos por parcial para compatibilidad con reportes viejos.
    // Se hacen escrituras independientes para que una regla/corte de red en un
    // reflejo no ponga en riesgo las calificaciones ya guardadas.
    const base = {
      ...horasData,
      groupId: selectedGroup,
      subjectId: selectedSubject,
      updatedBy: auth.currentUser.uid,
      updatedAt: new Date()
    };
    const targets = ['SEMESTRE', 'P1', 'P2', 'P3'];
    const writes = targets.map(partial => {
      const docId = `${selectedGroup}_${selectedSubject}_${partial}`;
      return db.collection('teacherHours').doc(docId).set({
        ...base,
        partial,
        semesterHours: true
      }, { merge: true });
    });
    const results = await Promise.allSettled(writes);
    const ok = results.some(r => r.status === 'fulfilled');
    if (!ok) {
      const reason = results.find(r => r.status === 'rejected')?.reason;
      throw reason || new Error('No se pudieron guardar horas');
    }
    _horasCapturadas = { P1: true, P2: true, P3: true };
    return true;
  }

  function _failureIncidentDocId(studentId) {
    return `${studentId}_${selectedSubject}_${currentPartial}_reprobación`;
  }

  function _getFailingStudentsForIncident(rubros) {
    if (_listCleared) return [];
    const failing = [];

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      if (row.dataset.traslado === '1') return;
      const studentId = row.dataset.studentId;
      const key = `${studentId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};
      const sumaData = {};
      let hasData = false;

      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        const raw = input ? input.value.trim() : '';
        const value = raw === '' ? 0 : Math.max(0, Math.min(parseFloat(raw) || 0, r.max));
        sumaData[r.key] = value;
        if (raw !== '' || stored[r.key] !== undefined) hasData = true;
      });

      if (!hasData) return;
      // Contexto PE socioemocional: ignora PE en todos los parciales (Gaceta EPO 67)
      const suma = K.calcSuma(sumaData, { subjectId: selectedSubject, partial: currentPartial });
      const cal = K.calcCal(suma);
      if (cal !== '' && Number(cal) < K.THRESHOLDS.PASS_GRADE) {
        failing.push({
          studentId,
          studentName: row.querySelector('.cell-name')?.textContent.trim() || studentId,
          suma,
          cal
        });
      }
    });

    return failing;
  }

  async function _getMissingFailureIncidents(failingStudents) {
    if (failingStudents.length === 0) return [];
    const refs = failingStudents.map(s => db.collection('incidents').doc(_failureIncidentDocId(s.studentId)));
    const snaps = await Promise.all(refs.map(ref => ref.get()));
    return failingStudents.filter((student, index) => !snaps[index].exists);
  }

  // Banner persistente que recuerda al maestro las incidencias pendientes.
  // Se llama cada vez que termina de teclear (focusout) y tras autosave.
  // Si hay alumnos reprobados sin incidencia → banner naranja con botón para reportar.
  let _failureBannerTimer = null;
  function _scheduleFailureBannerUpdate() {
    if (_failureBannerTimer) clearTimeout(_failureBannerTimer);
    _failureBannerTimer = setTimeout(_updateFailureIncidentBanner, 400);
  }
  async function _updateFailureIncidentBanner() {
    const container = document.getElementById('failure-incident-reminder');
    if (!container) return;
    if (!_isTeacherCaptureRole() || _listCleared) {
      container.innerHTML = '';
      return;
    }
    try {
      const rubros = K.getRubros(currentTurno);
      const failing = _getFailingStudentsForIncident(rubros);
      if (failing.length === 0) {
        container.innerHTML = '';
        return;
      }
      const missing = await _getMissingFailureIncidents(failing);
      if (missing.length === 0) {
        // Todos los reprobados con motivo reportado → chip discreto
        container.innerHTML = `
          <div style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;border:1px solid #10b981;border-radius:12px;padding:3px 10px;margin-bottom:8px;font-size:11px;color:#065f46;">
            <span class="material-icons-round" style="font-size:14px;color:#059669;">check_circle</span>
            <span><strong>${failing.length}</strong> reprobado(s) · todos con motivo ✓</span>
          </div>
        `;
        return;
      }
      // Hay missing → banner compacto en una fila con CTA prominente
      container.innerHTML = `
        <div style="background:#fff7ed;border:1px solid #f59e0b;border-left:4px solid #b45309;border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;font-size:12.5px;color:#78350f;flex-wrap:wrap;">
          <span class="material-icons-round" style="font-size:18px;color:#b45309;flex-shrink:0;">priority_high</span>
          <div style="flex:1;min-width:200px;line-height:1.35;">
            <strong>${missing.length} reprobado(s) sin motivo reportado</strong> · obligatorio antes de imprimir.
          </div>
          <button data-action="open-failure-incidents-modal" style="background:#b45309;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:4px;flex-shrink:0;">
            <span class="material-icons-round" style="font-size:14px;">flag</span>
            Reportar (${missing.length})
          </button>
        </div>
      `;
    } catch (e) {
      console.warn('Error actualizando banner de incidencias:', e);
    }
  }

  // Abre el modal de captura de motivos de reprobación.
  // Llamado desde el botón "Reportar ahora" del banner persistente.
  async function _openFailureIncidentsFromBanner() {
    try {
      const rubros = K.getRubros(currentTurno);
      const failing = _getFailingStudentsForIncident(rubros);
      const missing = await _getMissingFailureIncidents(failing);
      if (missing.length === 0) {
        Toast.show('Ya están reportados todos los motivos.', 'success');
        await _updateFailureIncidentBanner();
        return;
      }
      const reports = await _collectFailureIncidentReasons(missing);
      if (!Array.isArray(reports) || reports.length === 0) return;

      // Persistir las incidencias capturadas
      const currentList = _getCurrentListLabel();
      const batch = db.batch();
      reports.forEach(r => {
        const ref = db.collection('incidents').doc(_failureIncidentDocId(r.studentId));
        batch.set(ref, {
          studentId: r.studentId,
          groupId: selectedGroup,
          turno: currentTurno,
          type: 'academica',
          incidentKind: 'reprobación',
          requiredBy: 'banner-cta',
          title: `Reprobación en ${currentList.subjectName}`,
          description: r.reason,
          subjectId: selectedSubject,
          subjectName: currentList.subjectName,
          partial: currentPartial,
          partialName: currentList.partialName,
          grade: r.cal,
          suma: r.suma,
          date: new Date(),
          status: 'activa',
          reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
          reportedByUid: auth.currentUser.uid,
          updatedAt: new Date(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      Toast.show(`${reports.length} incidencia(s) registrada(s). Gracias.`, 'success');
      await _updateFailureIncidentBanner();
    } catch (e) {
      console.error('Error capturando incidencias:', e);
      Toast.show('No se pudieron guardar las incidencias. Intenta de nuevo.', 'error');
    }
  }

  function _buildFailureDescription(reason, detail) {
    const cleanReason = (reason || '').trim();
    const cleanDetail = (detail || '').trim();
    return cleanDetail ? `${cleanReason}. ${cleanDetail}` : cleanReason;
  }

  function _collectFailureIncidentReasons(missingStudents) {
    if (missingStudents.length === 0) return Promise.resolve([]);

    return new Promise(resolve => {
      const rowsHtml = missingStudents.map((s, index) => `
        <div class="failure-reason-row" data-index="${index}">
          <div class="failure-reason-student">
            <strong>${Utils.sanitize(s.studentName)}</strong>
            <span>Calificación: ${Utils.sanitize(String(s.cal))}</span>
          </div>
          <select class="failure-reason-select" data-index="${index}">
            <option value="">Selecciona motivo</option>
            <option value="No entrego evidencias suficientes">No entrego evidencias suficientes</option>
            <option value="Evaluación parcial insuficiente">Evaluación parcial insuficiente</option>
            <option value="Trabajos incompletos">Trabajos incompletos</option>
            <option value="Inasistencias afectaron su desempeno">Inasistencias afectaron su desempeno</option>
            <option value="No acredito los aprendizajes esperados">No acredito los aprendizajes esperados</option>
            <option value="Otro">Otro</option>
          </select>
          <textarea class="failure-reason-detail" data-index="${index}" rows="2"
            placeholder="Detalle breve opcional. Si eliges Otro, escribe el motivo."></textarea>
        </div>`).join('');

      const body = `
        <div class="failure-reason-modal">
          <p>Antes de guardar, registra el motivo de reprobación de cada alumno.</p>
          <div class="failure-reason-tools">
            <select id="failure-reason-bulk">
              <option value="">Motivo rapido para todos</option>
              <option value="No entrego evidencias suficientes">No entrego evidencias suficientes</option>
              <option value="Evaluación parcial insuficiente">Evaluación parcial insuficiente</option>
              <option value="Trabajos incompletos">Trabajos incompletos</option>
              <option value="Inasistencias afectaron su desempeno">Inasistencias afectaron su desempeno</option>
              <option value="No acredito los aprendizajes esperados">No acredito los aprendizajes esperados</option>
            </select>
            <button class="btn btn-outline btn-sm" id="failure-reason-apply">Aplicar</button>
          </div>
          <div class="failure-reason-list">${rowsHtml}</div>
        </div>`;

      const footer = `
        <button class="btn btn-outline" id="failure-reason-cancel">Cancelar</button>
        <button class="btn btn-primary" id="failure-reason-save">
          <span class="material-icons-round">save</span>
          Registrar motivos y guardar
        </button>`;

      Modal.open('Motivo de reprobación obligatorio', body, footer);

      setTimeout(() => {
        const cancelBtn = document.getElementById('failure-reason-cancel');
        const saveBtn = document.getElementById('failure-reason-save');
        const applyBtn = document.getElementById('failure-reason-apply');
        const bulkSelect = document.getElementById('failure-reason-bulk');

        cancelBtn?.addEventListener('click', () => {
          Modal.close();
          resolve(null);
        });

        applyBtn?.addEventListener('click', () => {
          const value = bulkSelect?.value || '';
          if (!value) {
            Toast.show('Selecciona un motivo rapido primero', 'warning');
            return;
          }
          document.querySelectorAll('.failure-reason-select').forEach(select => { select.value = value; });
        });

        saveBtn?.addEventListener('click', () => {
          const reports = [];
          let missing = 0;

          missingStudents.forEach((student, index) => {
            const select = document.querySelector(`.failure-reason-select[data-index="${index}"]`);
            const detail = document.querySelector(`.failure-reason-detail[data-index="${index}"]`);
            const reason = select?.value || '';
            const detailText = detail?.value.trim() || '';
            const requiresDetail = reason === 'Otro';
            const invalid = !reason || (requiresDetail && detailText.length < 5);

            select?.classList.toggle('ge-input-invalid', !reason);
            detail?.classList.toggle('ge-input-invalid', requiresDetail && detailText.length < 5);

            if (invalid) {
              missing++;
              return;
            }

            reports.push({
              ...student,
              reason: _buildFailureDescription(reason, detailText)
            });
          });

          if (missing > 0) {
            Toast.show('Completa el motivo de todos los alumnos reprobados', 'warning');
            return;
          }

          Modal.close();
          resolve(reports);
        });
      }, 100);
    });
  }

  async function _collectRequiredFailureIncidents(rubros) {
    if (!_isTeacherCaptureRole() || _listCleared) return [];
    const failingStudents = _getFailingStudentsForIncident(rubros);
    const missingStudents = await _getMissingFailureIncidents(failingStudents);
    return _collectFailureIncidentReasons(missingStudents);
  }

  // ─── INCIDENT REPORTING FROM GRADE EDITOR ───
  function _showIncidentModal(studentId, studentName) {
    const body = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div style="font-weight:600; color:var(--text);">Alumno: ${Utils.sanitize(studentName)}</div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Tipo de incidencia</label>
        <select id="inc-type" style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px;">
          <option value="conducta">Conducta</option>
          <option value="academica">Académica</option>
          <option value="asistencia">Asistencia</option>
          <option value="otra">Otra</option>
        </select>
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Título</label>
        <input id="inc-title" placeholder="Breve descripción" style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px;">
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Descripción</label>
        <textarea id="inc-desc" rows="3" placeholder="Detalle de la incidencia..."
                  style="width:100%; padding:8px; margin-top:4px; border:1px solid var(--border); border-radius:6px; resize:vertical;"></textarea>
      </div>
    </div>`;

    const footer = `
      <button class="btn" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-primary" id="inc-save-btn">Reportar</button>
    `;

    Modal.open('Reportar Incidencia', body, footer);

    setTimeout(() => {
      const saveBtn = document.getElementById('inc-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const title = document.getElementById('inc-title').value.trim();
          if (!title) { Toast.show('Escribe un título', 'warning'); return; }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Guardando...';

          try {
            await db.collection('incidents').add({
              studentId: studentId,
              groupId: selectedGroup,
              turno: currentTurno,
              type: document.getElementById('inc-type').value,
              title: title,
              description: document.getElementById('inc-desc').value.trim(),
              date: new Date(),
              reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
              reportedByUid: auth.currentUser.uid,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            Modal.close();
            Toast.show('Incidencia reportada', 'success');
          } catch (err) {
            console.error('Error saving incident:', err);
            Toast.show('Error al reportar: ' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Reportar';
          }
        });
      }
    }, 100);
  }

  function _getHorasData() {
    const data = {};
    ['febrero','marzo','abril','mayo','junio','julio'].forEach(m => {
      const el = document.getElementById('horas-' + m);
      if (!el) return; // input no existe (caso raro)
      // FIX bug-horas-feb-mar (Mayo 2026): antes "saltabamos" los meses con
      // input vacio (return early), lo que con merge:true dejaba esos campos
      // INEXISTENTES en Firestore. Resultado: maestros que capturaban abril
      // primero quedaban con feb/mar ausentes para siempre, y aunque luego
      // los completaran, el bug recurria si volvian a guardar.
      // Ahora persistimos los 6 meses SIEMPRE: vacio se guarda como 0.
      const raw = el.value.trim();
      const num = raw === '' ? 0 : parseInt(raw, 10);
      data[m] = isNaN(num) ? 0 : num;
    });
    return data;
  }

  function _isTeacherCaptureRole() {
    return App.currentUser?.role === 'maestro' || App.currentUser?.role === 'orientador_docente';
  }

  function _hasRequiredHoras() {
    const horasInputs = document.querySelectorAll('.horas-input');
    return [...horasInputs].some(input => {
      const v = parseInt(input.value, 10);
      return !isNaN(v) && v > 0;
    });
  }

  function _showHorasRequiredReminder() {
    const horasSection = document.querySelector('#horas-total')?.closest('.card');
    if (horasSection) {
      horasSection.classList.add('horas-required');
      // Mantener resaltado MÁS tiempo para que el maestro lo vea bien
      setTimeout(() => horasSection.classList.remove('horas-required'), 30000);
    }

    // Mensaje súper claro con instrucciones paso a paso
    const bodyHtml = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#fee2e2;border-left:5px solid #dc2626;padding:14px 18px;border-radius:8px;">
          <h3 style="margin:0 0 8px;color:#991b1b;font-size:17px;">⚠ Tus calificaciones NO se guardaron todavía</h3>
          <p style="margin:0;color:#991b1b;font-size:14px;">
            El sistema necesita que <strong>primero captures las HORAS IMPARTIDAS</strong> de este parcial antes de guardar las calificaciones. Es obligatorio para calcular el % de faltas (regla del 20%).
          </p>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;border-radius:6px;font-size:14px;">
          <strong style="color:#78350f;">📋 Qué hacer (toma 30 segundos):</strong>
          <ol style="margin:8px 0 0 20px;color:#78350f;line-height:1.7;">
            <li>Cierra este mensaje (botón <strong>"Entendido"</strong> abajo).</li>
            <li>Vas a ver una sección <strong style="background:#fff;padding:1px 6px;border-radius:3px;color:#d97706;">📅 HORAS IMPARTIDAS</strong> debajo de la tabla de alumnos (resaltada en naranja).</li>
            <li>Escribe cuántas clases diste en <strong>P${(typeof currentPartial === 'string' ? currentPartial.replace('P','') : '?')}</strong>. Por ejemplo: <code style="background:#fff;padding:1px 6px;border-radius:3px;">24</code></li>
            <li><strong>Vuelve a presionar el botón "Guardar"</strong> arriba.</li>
            <li>Ahora SÍ se van a guardar tus calificaciones + las horas en bloque.</li>
          </ol>
        </div>

        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;font-size:13px;color:#166534;">
          💡 <strong>Tus calificaciones NO se perdieron.</strong> Siguen escritas en la pantalla.
          Solo necesitas registrar las horas y volver a guardar — todas se guardan al mismo tiempo.
        </div>
      </div>`;
    const footerHtml = `<button class="btn btn-primary" id="horas-reminder-ok" style="background:#dc2626;border-color:#dc2626;font-weight:700;padding:10px 22px;">Entendido, voy a capturar las horas</button>`;

    if (typeof Modal !== 'undefined' && Modal.open) {
      Modal.open('⚠ NO se guardaron — falta capturar las horas', bodyHtml, footerHtml);
      document.getElementById('horas-reminder-ok')?.addEventListener('click', () => {
        Modal.close();
        // Después de cerrar, hacer scroll a la sección de horas con un delay
        setTimeout(() => {
          if (horasSection) {
            horasSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Foco al primer input de horas
            const firstHorasInput = horasSection.querySelector('.horas-input');
            if (firstHorasInput) firstHorasInput.focus();
          }
        }, 200);
      });
    } else {
      Toast.show('NO se guardó. Captura las horas impartidas primero.', 'error');
    }
  }

  function _canLeaveEditor() {
    // v8.26: ya no impedimos salir del editor por falta de horas.
    // El maestro puede moverse libremente entre listas; las horas pendientes
    // se recuerdan en el banner de alertas (chip amarillo) y bloquean solo
    // la impresión oficial vía _enforcePrintReadiness (v8.20).
    return true;
  }

  /** Auto-recalculate SUMA and CAL for a row when any rubro changes */
  function _recalcRow(input) {
    const row = input.closest('tr');
    const sid = row.dataset.studentId;
    const rubros = K.getRubros(currentTurno);
    const data = {};

    rubros.forEach(r => {
      const el = row.querySelector(`input[data-field="${r.key}"]`);
      const raw = el ? el.value.trim() : '';
      data[r.key] = raw === '' ? 0 : (parseFloat(raw) || 0);
    });

    // Always show suma/cal — vacío = 0, si todo es 0 la cal es 5
    // Contexto socioemocional: materias del bloque no permiten PE en ningún parcial (Gaceta EPO 67)
    const _peCtx = { subjectId: selectedSubject, partial: currentPartial };
    const suma = K.calcSuma(data, _peCtx);
    const cal = K.calcCal(suma);
    const peIgnored = K.isPEIgnored(data, _peCtx); // Regla EPO67: el PE no rescata reprobados / bloqueado en materias socioemocionales

    const sumaCell = row.querySelector('.col-suma');
    const calCell = row.querySelector('.col-cal');
    if (sumaCell) {
      // Limpia y vuelve a poner el numero + (si aplica) el badge "PE no aplica"
      const badge = peIgnored
        ? ' <span class="pe-ignored-badge" title="Regla EPO67: el Punto Extra no se aplica porque la suma base (sin PE) es menor a 6. Ingresa rubros suficientes para aprobar y el PE comenzara a sumar.">PE no aplica</span>'
        : '';
      sumaCell.innerHTML = suma.toFixed(1) + badge;
    }
    if (calCell) {
      calCell.textContent = cal;
      calCell.className = 'cell-cal ' + (cal !== '' && cal < 6 ? 'cal-fail' : (cal !== '' ? 'cal-pass' : '')) + ' col-cal';
    }

    // Resalta visualmente el input PE cuando esta siendo ignorado
    const peInput = row.querySelector('input[data-field="pe"]');
    if (peInput) peInput.classList.toggle('pe-input-ignored', peIgnored);

    row.classList.toggle('row-reprobado', cal !== '' && cal < 6);

    _updateStats();
  }

  function _calcRowSuma(gradeData, rubros) {
    const data = {};
    rubros.forEach(r => { data[r.key] = gradeData[r.key]; });
    // Pasa contexto para que K.calcSuma aplique la regla socioemocional
    // (ignora PE si la materia está en SUBJECTS_SIN_PE — en todos los parciales).
    return K.calcSuma(data, { subjectId: selectedSubject, partial: currentPartial });
  }

  // Banner con fechas críticas leídas de config/captureWindow (admin las programa).
  // v8.10: usa K.captureWindowForGrade() con _currentGrado del editor para que
  // cada maestro vea las fechas de SU grado (3° puede entregar antes que 1°/2°).
  let _captureWindowCache = null;
  async function _updateCaptureDeadlineBanner() {
    const root = document.getElementById('capture-deadline-banner');
    if (!root) return;
    try {
      if (!_captureWindowCache) {
        const doc = await db.collection('config').doc('captureWindow').get();
        _captureWindowCache = doc.exists ? doc.data() : {};
      }
      const cfgRaw = _captureWindowCache;
      // Resolver al grado actual del editor (fallback al global si no hay override).
      // _moduleCurrentGrado se setea en _renderGradeEditor al cargar el grupo.
      // Si entró por la cabecera (sin grupo aún), grado=null → fallback global.
      const cfg = K.captureWindowForGrade(cfgRaw, _moduleCurrentGrado);
      // Detectar si las fechas vienen del override por grado para mostrar el
      // chip "Fechas para tu grado (N°)" — confianza extra para el docente.
      const g = String(_moduleCurrentGrado || '').trim();
      const hasGradeOverride = !!(cfgRaw && cfgRaw.byGrade && g && cfgRaw.byGrade[g] && Object.keys(cfgRaw.byGrade[g]).length > 0);

      const fmtDate = (ts) => {
        if (!ts) return null;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      };
      const fmtJustDate = (ts) => {
        if (!ts) return null;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      };
      const opensStr = fmtDate(cfg.opensAt);
      const closesStr = fmtDate(cfg.closesAt);
      const deliveryStr = fmtJustDate(cfg.deliveryDate);
      const corrStartStr = fmtJustDate(cfg.correctionsStart);
      const corrEndStr = fmtJustDate(cfg.correctionsEnd);

      // Si no hay nada configurado, NO mostrar nada
      if (!closesStr && !deliveryStr && !opensStr) {
        root.innerHTML = '';
        return;
      }

      // v8.14: banner SIEMPRE expandido — todas las fechas en UN solo renglón.
      // Cada chip es atómico (icono + label + fecha) y se separa con un divisor
      // sutil. Si la pantalla es muy angosta, hace wrap suave (gap+flex-wrap).
      const chips = [];
      if (opensStr) chips.push(`<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><span style="font-size:13px;">🟢</span><strong>Apertura:</strong> ${opensStr}</span>`);
      if (closesStr) chips.push(`<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><span style="font-size:13px;">📅</span><strong>Cierre:</strong> ${closesStr}</span>`);
      if (deliveryStr) chips.push(`<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><span style="font-size:13px;">📋</span><strong>Entrega listas firmadas:</strong> ${deliveryStr}</span>`);
      if (corrStartStr && corrEndStr) {
        chips.push(`<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;"><span style="font-size:13px;">✏️</span><strong>Correcciones:</strong> ${corrStartStr} → ${corrEndStr}</span>`);
      }

      const gradeChip = hasGradeOverride && _moduleCurrentGrado
        ? `<span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:8px;font-size:10px;font-weight:800;white-space:nowrap;">Fechas para ${_moduleCurrentGrado}° grado</span>`
        : '';

      root.innerHTML = `
        <div style="background:#fff7ed;border-left:4px solid #d97706;border-radius:6px;padding:8px 14px;margin-bottom:8px;font-size:12.5px;color:#78350f;display:flex;align-items:center;gap:14px;flex-wrap:wrap;line-height:1.4;">
          <span style="display:inline-flex;align-items:center;gap:5px;font-weight:800;white-space:nowrap;">
            <span class="material-icons-round" style="font-size:18px;color:#d97706;">event</span>
            Fechas:
          </span>
          ${chips.join('<span style="color:#d97706;opacity:0.5;">·</span>')}
          ${gradeChip}
        </div>`;
    } catch (e) {
      console.warn('captureWindow banner:', e.message);
    }
  }

  // Banner de alumnos en riesgo por faltas (solo pantalla, no imprime)
  function _updateRiskBanner() {
    const container = document.getElementById('risk-banner-faltas');
    if (!container) return;

    const totalEl = document.getElementById('horas-total');
    const totalHoras = totalEl ? (parseInt(totalEl.textContent) || 0) : 0;

    if (totalHoras === 0) {
      // Mensaje muy discreto cuando aún no hay horas (no satura)
      container.innerHTML = `<div style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;border:1px solid #93c5fd;border-radius:12px;padding:3px 10px;margin-bottom:8px;font-size:11px;color:#1e40af;">
        <span class="material-icons-round" style="font-size:14px;color:#3b82f6;">info</span>
        Captura horas impartidas (abajo) para detectar riesgo de faltas
      </div>`;
      return;
    }

    const RIESGO = 20, ALERTA = 15;
    const danger = [], warning = [];
    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (!faltasInput) return;
      const faltas = parseInt(faltasInput.value);
      if (isNaN(faltas) || faltas <= 0) return;
      const pct = (faltas * 100) / totalHoras;
      if (pct < ALERTA) return;
      const nombre = row.querySelector('.cell-name')?.textContent.trim() || '';
      const item = { nombre, faltas, pct };
      if (pct > RIESGO) danger.push(item);
      else warning.push(item);
    });

    if (danger.length === 0 && warning.length === 0) {
      container.innerHTML = '';
      return;
    }

    const chip = (s, lvl) => `<span class="risk-chip risk-chip-${lvl}">
      <strong>${Utils.sanitize(s.nombre)}</strong>
      <em>${s.faltas} faltas · ${s.pct.toFixed(1)}%</em>
    </span>`;

    const dangerSection = danger.length > 0 ? `
      <div class="risk-section">
        <div class="risk-section-title">
          <span class="material-icons-round" style="color:#b91c1c;font-size:18px;vertical-align:middle;">block</span>
          <strong>${danger.length} en riesgo de EXTRAORDINARIO</strong>
          (más del 20% de faltas — pierden derecho a calificación ordinaria)
        </div>
        <div class="risk-chips">${danger.map(s => chip(s, 'danger')).join('')}</div>
      </div>` : '';

    const warningSection = warning.length > 0 ? `
      <div class="risk-section">
        <div class="risk-section-title">
          <span class="material-icons-round" style="color:#b45309;font-size:18px;vertical-align:middle;">warning</span>
          <strong>${warning.length} en alerta</strong>
          (entre 15% y 20% de faltas — atención cercana)
        </div>
        <div class="risk-chips">${warning.map(s => chip(s, 'warning')).join('')}</div>
      </div>` : '';

    const headerLevel = danger.length > 0 ? 'danger' : 'warning';
    container.innerHTML = `<div class="risk-banner risk-${headerLevel}">
      <span class="material-icons-round risk-banner-icon">priority_high</span>
      <div class="risk-banner-body">
        <div class="risk-banner-title">⚠ Atención: alumnos en riesgo por faltas</div>
        <div class="risk-banner-msg">Profesor(a), revise estos alumnos. Con más del 20% de faltas pierden derecho a calificación ordinaria según reglamento.</div>
        ${dangerSection}
        ${warningSection}
      </div>
    </div>`;
  }

  // Debounced wrapper para no recalcular en cada tecla
  let _riskBannerTimer = null;
  function _scheduleRiskBannerUpdate() {
    if (_riskBannerTimer) clearTimeout(_riskBannerTimer);
    _riskBannerTimer = setTimeout(_updateRiskBanner, 250);
  }

  function _updateStats() {
    const rows = document.querySelectorAll('tbody tr[data-student-id]');
    const cals = [];
    rows.forEach(row => {
      const calCell = row.querySelector('.col-cal');
      if (calCell && calCell.textContent.trim() !== '') {
        cals.push(parseFloat(calCell.textContent));
      }
    });

    const avg = cals.length > 0 ? (cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : '-';
    const aprobados = cals.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
    const reprobados = cals.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    const sinCalif = rows.length - cals.length;

    const e = id => document.getElementById(id);
    if (e('stat-promedio')) e('stat-promedio').textContent = avg;
    if (e('stat-aprobados')) e('stat-aprobados').textContent = aprobados;
    if (e('stat-reprobados')) e('stat-reprobados').textContent = reprobados;
    if (e('stat-sin-calif')) e('stat-sin-calif').textContent = sinCalif;
  }

  function switchPartial(partialId) {
    if (!_canLeaveEditor()) return;
    if (_isDirty) {
      if (!confirm('Tienes cambios sin guardar en este parcial. ¿Deseas cambiar sin guardar?')) return;
    }
    _markClean();
    currentPartial = partialId;
    openGradeEditor(null, selectedGroup, selectedSubject);
  }

  // SAFETY: si _isSaving lleva más de 60s en true, asume cuelgue y resetea.
  // Esto evita que el botón se quede en "Guardando..." para siempre si una
  // excepción no controlada deja el flag pegado.
  let _saveStartedAt = 0;

  // ═══ ANTI-BURST GUARD (v8.04) ═══
  // El 7 mayo 2026 02:29 AM hubo 53 saves consecutivos en 4 segundos a la
  // misma lista (Ciencias Sociales 1-2 P1). Eso sobrescribió valores del
  // cuadro firmado por la maestra. Causa probable: bucle de script o
  // paste-bulk descontrolado. Este guard previene que vuelva a pasar:
  // si la MISMA lista se intenta guardar >3 veces en <10s, BLOQUEA.
  //
  // El historial se guarda por entityId (`${turno}_${grupo}_${subj}_${parcial}`),
  // solo en memoria del navegador. NO bloquea cambios espaciados (típico
  // del autosave debounce 3s que dispara como máximo 1 save / 3s).
  const _saveHistory = new Map();  // entityId → [timestamps]
  const BURST_WINDOW_MS = 10000;   // 10 segundos
  const BURST_MAX_SAVES = 3;       // máximo 3 saves en esa ventana

  function _bumpSaveHistory(entityId) {
    const now = Date.now();
    let arr = _saveHistory.get(entityId) || [];
    // Limpiar timestamps fuera de la ventana
    arr = arr.filter(t => now - t < BURST_WINDOW_MS);
    arr.push(now);
    _saveHistory.set(entityId, arr);
    return arr.length;
  }

  function _isBurstViolation(entityId) {
    const now = Date.now();
    const arr = (_saveHistory.get(entityId) || []).filter(t => now - t < BURST_WINDOW_MS);
    return arr.length >= BURST_MAX_SAVES;
  }

  function _currentEntityId() {
    const turno = (currentTurno || '').toUpperCase();
    const grupo = (selectedGroup || '').replace(/^MATUTINO_|^VESPERTINO_/, '');
    return `${turno}_${grupo}_${selectedSubject || ''}_${currentPartial || ''}`;
  }

  async function saveGrades(opts) {
    const silent = !!(opts && opts.silent);

    // ═══ ANTI-BURST GUARD ═══
    // Detecta saves repetidos al mismo doc en ventana de 10s. Si supera el
    // umbral, BLOQUEA con error visible (silent o no, registra en consola).
    const entityId = _currentEntityId();
    if (entityId && _isBurstViolation(entityId)) {
      console.error('[saveGrades] ANTI-BURST: bloqueado save #' + ((_saveHistory.get(entityId) || []).length + 1) +
        ' a ' + entityId + ' en <10s. Intento sospechoso (¿script en bucle?).');
      if (!silent) {
        Toast.show('🛡️ Bloqueado: demasiados guardados a la misma lista en poco tiempo. Espera 10 segundos.', 'error', 6000);
      }
      throw new Error('ANTI-BURST: máximo ' + BURST_MAX_SAVES + ' saves cada ' + (BURST_WINDOW_MS/1000) + 's a la misma lista.');
    }

    // ═══ PREVENT DOUBLE-CLICK + AUTO-RESCUE DE GUARDADO ATASCADO ═══
    if (_isSaving) {
      const stuckSeconds = (Date.now() - _saveStartedAt) / 1000;
      if (stuckSeconds < 60) {
        console.warn('[saveGrades] ya hay un guardado en curso desde hace', stuckSeconds.toFixed(1), 's');
        return;
      }
      // Lleva más de 60s. Asumimos cuelgue y reseteamos.
      console.warn('[saveGrades] auto-rescue: _isSaving llevaba', stuckSeconds.toFixed(0), 's atascado. Reseteando.');
      _isSaving = false;
      const stuckBtn = document.querySelector('[data-action="save-grades"]');
      if (stuckBtn) {
        stuckBtn.disabled = false;
        stuckBtn.innerHTML = '<span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">save</span>Guardar';
      }
      if (!silent) Toast.show('El guardado anterior se quedó atorado. Reseteado. Intenta otra vez.', 'warning');
      return;
    }

    // Registrar el intento de save (solo cuando llegamos aquí, no en pruebas burst)
    if (entityId) _bumpSaveHistory(entityId);

    const saveBtn = document.querySelector('[data-action="save-grades"]');

    // ═══ CHECK NETWORK CONNECTIVITY ═══
    if (!navigator.onLine) {
      if (!silent) Toast.show('Sin conexión a internet. Verifica tu red e intenta de nuevo.', 'error');
      throw new Error('Sin conexión a internet');
    }

    // v8.26: YA NO bloqueamos el guardado por falta de horas. Antes el guardado
    // MANUAL (no silent) abortaba con un modal "NO se guardaron" si los inputs
    // de horas estaban vacíos. Esto frustraba al maestro que quería capturar
    // calificaciones primero. Ahora el guardado SIEMPRE procede; las horas se
    // recuerdan con un toast suave porque son semestrales y no bloquean.
    if (!silent && _isTeacherCaptureRole() && !_listCleared && !_hasRequiredHoras()) {
      Toast.show('⏱ Recuerda capturar las horas del semestre antes de imprimir', 'warning');
    }

    // ═══ CHECK PARTIAL LOCK + OVERRIDE (force fresh read) ═══
    // FORCE=true: el caché de 5 min puede dejar pasar guardadas a parciales que
    // se acaban de cerrar. Mejor pagar la lectura extra y rechazar limpio
    // antes de ir a Firestore (que igual lo rechazaría con error críptico).
    try {
      const cachedPartials = await Store.getPartials(true);
      const partialDoc = cachedPartials.find(p => p.id === currentPartial);
      // v8.07: usar isPartialLockedForGrade — el cierre puede ser por grado
      const _saveGrado = K.gradeFromGroupId(selectedGroup);
      if (partialDoc && K.isPartialLockedForGrade(partialDoc, _saveGrado)) {
        // 1) Admin (incluido cuando impersona) siempre puede.
        // 2) Si no, ya pre-resolvimos el override en openGradeEditor (_editorOverrideActive).
        // 3) Fallback final: consultar Firestore por si el override se acaba de otorgar
        //    sin re-abrir el editor.
        let hasOverride = _hasAdminPower() || _editorOverrideActive;
        if (!hasOverride) {
          const teacherDocId = await Store.getTeacherDocId();
          if (teacherDocId) {
            try {
              const doc = await db.collection('partialOverrides').doc(`${currentPartial}_${teacherDocId}`).get();
              if (doc.exists) {
                const ov = doc.data();
                if (!ov.expiresAt) hasOverride = true;
                else {
                  const exp = ov.expiresAt.toDate ? ov.expiresAt.toDate() : new Date(ov.expiresAt);
                  hasOverride = exp > new Date();
                }
              }
            } catch (_) { /* sigue al fallback de query por field por compatibilidad */ }
            // Fallback query por field (overrides viejos sin migrar)
            if (!hasOverride) {
              const snap = await db.collection('partialOverrides')
                .where('partialId', '==', currentPartial)
                .where('teacherId', '==', teacherDocId).limit(1).get();
              if (!snap.empty) {
                const ov = snap.docs[0].data();
                if (!ov.expiresAt) hasOverride = true;
                else {
                  const exp = ov.expiresAt.toDate ? ov.expiresAt.toDate() : new Date(ov.expiresAt);
                  hasOverride = exp > new Date();
                }
              }
            }
          }
        }
        if (!hasOverride) {
          if (!silent) Toast.show('Parcial cerrado. No se pueden modificar calificaciones.', 'warning');
          throw new Error('Parcial cerrado');
        }
        if (!silent) Toast.show('Guardando con acceso especial (parcial cerrado)', 'info');
      }
    } catch (e) {
      // Re-lanzar errores propios; ignorar errores de lectura
      if (e?.message?.includes('Parcial cerrado')) throw e;
      console.warn('Error verificando parcial:', e);
    }

    // v8.27: Las horas ya no bloquean el guardado de P3.
    // Se mantienen como requisito de impresion/reportes, pero la captura debe guardarse.
    if (currentPartial === 'P3' && !silent && !_hasAdminPower() && !_editorOverrideActive
        && !_horasCompletasParaExtra()) {
      const faltan = ['P1', 'P2', 'P3'].filter(pid => !_horasCapturadas[pid]);
      if (faltan.length) {
        Toast.show('P3 se puede guardar. Recuerda capturar horas para poder imprimir. Faltan: ' + faltan.join(', '), 'warning', 8000);
      }
    }

    // ═══ VALIDATE ALL INPUTS BEFORE SAVE ═══
    const rubros = K.getRubros(currentTurno);
    let validationErrors = 0;

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      if (row.dataset.traslado === '1') return;
      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        if (input && input.value.trim() !== '') {
          let v = parseFloat(input.value.replace(',', '.'));
          if (isNaN(v) || v < 0 || v > r.max) {
            validationErrors++;
            input.classList.add('ge-input-invalid');
          } else {
            // Auto-fix: clamp and round before save
            v = Math.max(0, Math.min(v, r.max));
            v = Math.round(v * 10) / 10;
            input.value = v;
            input.classList.remove('ge-input-invalid');
          }
        }
      });
      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (faltasInput && faltasInput.value.trim() !== '') {
        let v = parseInt(faltasInput.value);
        if (isNaN(v) || v < 0) { validationErrors++; faltasInput.classList.add('ge-input-invalid'); }
        else { faltasInput.value = Math.max(0, Math.min(v, 99)); faltasInput.classList.remove('ge-input-invalid'); }
      }
    });

    if (validationErrors > 0) {
      if (!silent) Toast.show(`Hay ${validationErrors} valor(es) fuera de rango. Se corrigieron automáticamente. Revisa y guarda de nuevo.`, 'warning');
      // En silent: continúa con los valores ya auto-corregidos (los inválidos quedan en rojo, no se guardan)
      if (!silent) return;
    }

    let failureIncidentReports = [];
    try {
      // Auto-save NO bloquea por incidencias obligatorias (el maestro las llena cuando guarda manual)
      if (!silent) {
        failureIncidentReports = await _collectRequiredFailureIncidents(rubros);
        if (failureIncidentReports === null) return;
      } else {
        failureIncidentReports = [];
      }
    } catch (error) {
      console.error('Error verificando incidencias de reprobación:', error);
      if (!silent) {
        Toast.show('No se pudieron revisar las incidencias obligatorias. Intenta de nuevo.', 'error');
        return;
      }
    }

    // ═══ LOCK UI DURING SAVE ═══
    _isSaving = true;
    _saveStartedAt = Date.now();
    const origBtnText = saveBtn?.innerHTML || '';
    // En auto-save (silent) NO cambiamos el botón — el indicador de auto-save flotante
    // ya muestra "Guardando…" / "Guardado HH:MM" sin distraer al maestro.
    if (saveBtn && !silent) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:18px;vertical-align:middle;margin-right:4px;">autorenew</span>Guardando...';
    }

    // SAFETY: si después de 45 segundos seguimos atorados, forzar reset.
    // Evita el caso "se queda eterno" reportado en producción.
    const safetyTimer = setTimeout(() => {
      if (_isSaving) {
        console.error('[saveGrades] SAFETY TIMEOUT: 45s sin terminar. Forzando reset.');
        _isSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
        Toast.show('El guardado se tardó demasiado. Se canceló. Verifica tu internet y vuelve a intentar.', 'error');
      }
    }, 45000);

    // ENVOLVER TODO EL SAVE EN TRY/FINALLY GLOBAL
    // Garantiza que _isSaving y el botón SIEMPRE se liberen, sin importar
    // qué excepción se lance dentro.
    try {
    // ═══ BUILD BATCH (only changed rows) ═══
    const batch = db.batch();
    let count = 0;
    let incidentCount = 0;

    document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
      // Alumnos con traslado pendiente: no se captura nada, se ignoran en save.
      if (row.dataset.traslado === '1') return;

      const studentId = row.dataset.studentId;
      const key = `${studentId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};

      if (_listCleared) {
        const hasStoredGrade = rubros.some(r => stored[r.key] !== undefined)
          || stored.faltas !== undefined
          || stored.suma !== undefined
          || stored.cal !== undefined
          || stored.value !== undefined;
        if (hasStoredGrade) {
          const clearedData = {
            studentId,
            subjectId: selectedSubject,
            groupId: selectedGroup,
            partial: currentPartial,
            updatedAt: new Date(),
            updatedBy: auth.currentUser.uid,
            suma: firebase.firestore.FieldValue.delete(),
            cal: firebase.firestore.FieldValue.delete(),
            value: firebase.firestore.FieldValue.delete(),
            faltas: firebase.firestore.FieldValue.delete()
          };
          rubros.forEach(r => { clearedData[r.key] = firebase.firestore.FieldValue.delete(); });
          batch.set(db.collection('grades').doc(key), clearedData, { merge: true });
          count++;
        }
        return;
      }

      let hasData = false;
      let hasChanges = false;
      let rubroChanged = false; // ← v8.42: distinguir si los rubros (no faltas) cambiaron

      const data = {
        studentId,
        subjectId: selectedSubject,
        groupId: selectedGroup,
        partial: currentPartial,
        updatedAt: new Date(),
        updatedBy: auth.currentUser.uid
      };

      rubros.forEach(r => {
        const input = row.querySelector(`input[data-field="${r.key}"]`);
        if (input) {
          // Vacío = 0 (no capturado cuenta como cero)
          const raw = input.value.trim();
          const v = raw === '' ? 0 : Math.max(0, Math.min(parseFloat(raw) || 0, r.max));
          data[r.key] = v;
          // Mark as having data if the user typed anything (including 0)
          if (raw !== '' || stored[r.key] !== undefined) hasData = true;
          if (stored[r.key] === undefined || Math.abs((stored[r.key] || 0) - v) > 0.001) {
            hasChanges = true;
            rubroChanged = true; // ← v8.42: marca solo si rubros cambiaron, no faltas
          }
        }
      });

      const faltasInput = row.querySelector('input[data-field="faltas"]');
      if (faltasInput && faltasInput.value.trim() !== '') {
        const f = parseInt(faltasInput.value);
        data.faltas = f;
        // FIX bug recuperación 3-3 P3: cuando stored.faltas era undefined y maestro
        // escribe 0, antes (undefined || 0) !== 0 → false → no se guardaba.
        // Ahora detectamos cambio cuando no había valor previo o difiere del nuevo.
        if (stored.faltas === undefined || Number(stored.faltas) !== f) hasChanges = true;
        // hasData se marca también: el maestro tecleó algo (incluido 0)
        hasData = true;
      }

      if (hasData && hasChanges) {
        // v8.42 FIX BLINDAJE: solo recalcular suma/cal si los rubros cambiaron.
        // Si solo cambió `faltas`, NO sobrescribir cal/suma — evita el caso donde
        // los inputs de ec/tr/ex/pe estaban vacíos al guardar (race/render parcial)
        // y la suma quedaba en 0 → cal=5 → SOBRESCRIBÍA la cal correcta.
        if (rubroChanged) {
          const sumaData = {};
          rubros.forEach(r => { sumaData[r.key] = data[r.key]; });
          // Contexto PE socioemocional: bloquea PE en materias específicas en TODOS los parciales (Gaceta EPO 67)
          data.suma = K.calcSuma(sumaData, { subjectId: selectedSubject, partial: currentPartial });
          data.cal = K.calcCal(data.suma);
          data.value = data.cal;
        } else {
          // Solo cambió faltas: limpiar campos de rubros del payload para que el merge
          // NO sobrescriba lo que ya está bien en Firestore.
          rubros.forEach(r => { delete data[r.key]; });
        }

        const ref = db.collection('grades').doc(key);
        batch.set(ref, data, { merge: true });
        count++;
      }
    });

    const currentList = _getCurrentListLabel();
    failureIncidentReports.forEach(report => {
      const ref = db.collection('incidents').doc(_failureIncidentDocId(report.studentId));
      batch.set(ref, {
        studentId: report.studentId,
        groupId: selectedGroup,
        turno: currentTurno,
        type: 'academica',
        incidentKind: 'reprobación',
        requiredBy: 'grade-save',
        title: `Reprobación en ${currentList.subjectName}`,
        description: report.reason,
        subjectId: selectedSubject,
        subjectName: currentList.subjectName,
        partial: currentPartial,
        partialName: currentList.partialName,
        grade: report.cal,
        suma: report.suma,
        date: new Date(),
        status: 'activa',
        reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
        reportedByUid: auth.currentUser.uid,
        updatedAt: new Date(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      incidentCount++;
    });

    const horasData = _getHorasData();

    // Nothing to save?
    if (count === 0 && incidentCount === 0) {
      try {
        const horasSaved = await _saveHorasData(horasData);
        _listCleared = false;
        _hideClearPendingNotice();
        _markClean();
        if (!silent) Toast.show(horasSaved ? 'Horas impartidas guardadas' : 'No hay cambios que guardar', horasSaved ? 'success' : 'info');
      } catch (error) {
        console.warn('Error saving horas:', error);
        if (!silent) Toast.show('Error al guardar horas impartidas. Intenta de nuevo.', 'error');
        if (silent) throw error;
      } finally {
        _isSaving = false;
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
      }
      return;
    }

    // ═══ COMMIT WITH RETRY ═══
    const maxRetries = 2;
    let attempt = 0;
    let success = false;

    while (attempt <= maxRetries && !success) {
      try {
        // TIMEOUT 20 segundos — si el commit tarda más, lanzamos error y entramos al retry
        const commitWithTimeout = Promise.race([
          batch.commit(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: el guardado tardó más de 20 segundos. Verifica tu internet.')), 20000))
        ]);
        await commitWithTimeout;
        success = true;
        // Update local grades cache so next save detects changes correctly
        document.querySelectorAll('tbody tr[data-student-id]').forEach(row => {
          const sid = row.dataset.studentId;
          const k = `${sid}_${selectedSubject}_${currentPartial}`;
          if (!grades[k]) grades[k] = {};
          if (_listCleared) {
            rubros.forEach(r => { delete grades[k][r.key]; });
            delete grades[k].faltas;
            delete grades[k].suma;
            delete grades[k].cal;
            delete grades[k].value;
            return;
          }
          rubros.forEach(r => {
            const input = row.querySelector(`input[data-field="${r.key}"]`);
            if (input && input.value.trim() !== '') grades[k][r.key] = parseFloat(input.value);
          });
          const fi = row.querySelector('input[data-field="faltas"]');
          if (fi && fi.value.trim() !== '') grades[k].faltas = parseInt(fi.value);
        });
      } catch (error) {
        attempt++;
        console.error(`Error saving grades (attempt ${attempt}):`, error);
        if (attempt <= maxRetries) {
          Toast.show(`Reintentando guardar... (${attempt}/${maxRetries})`, 'warning');
          await new Promise(r => setTimeout(r, 1500 * attempt));
        } else {
          // Mensaje especifico segun el codigo de error de Firebase, asi el
          // maestro y el admin saben EXACTAMENTE que pasa.
          let msg;
          const code = error && error.code;
          if (code === 'permission-denied' || (error && (error.message||'').toLowerCase().includes('insufficient permissions'))) {
            msg = '⛔ No tienes permiso para guardar en este grupo/materia/parcial. ' +
                  'Causas posibles: (1) el parcial fue cerrado, (2) tu asignación a este grupo/materia no esta registrada. ' +
                  'Avisa al admin con este mensaje y un screenshot para que lo revise.';
          } else if (code === 'unauthenticated' || (error && (error.message||'').toLowerCase().includes('unauthenticated'))) {
            msg = '🔒 Tu sesión expiró. Cierra sesión, vuelve a entrar e intenta de nuevo.';
          } else if (code === 'failed-precondition') {
            msg = '⚠️ El guardado fue rechazado por una condición del sistema, no por falta de internet. ' +
                  'Tus datos siguen en el editor. Actualiza la página e intenta de nuevo; si vuelve a pasar, pide al admin revisar que P3 esté abierto para 3er grado y que tu asignación esté activa.';
          } else if (code === 'unavailable' || (error && (error.message||'').toLowerCase().includes('unavailable'))) {
            msg = '📡 Servicio no disponible momentaneamente. Espera 1 minuto e intenta de nuevo.';
          } else if (error && (error.message||'').toLowerCase().includes('timeout')) {
            msg = '⏱ El guardado tardó demasiado. Verifica tu conexión a internet e intenta de nuevo.';
          } else {
            msg = 'Error al guardar calificaciones. Tus datos están seguros en el editor. Verifica tu conexión e intenta de nuevo. (Detalle: ' + (code || (error && error.message) || 'error desconocido') + ')';
          }
          Toast.show(msg, 'error');
          _isSaving = false;
          if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }
          // Save draft so data isn't lost
          _saveDraft();
          return;
        }
      }
    }

    // ═══ SUCCESS — unlock UI immediately, audit in background ═══
    const wasListCleared = _listCleared;
    let horasSaved = false;
    let horasSaveFailed = false;
    if (Object.keys(horasData).length > 0) {
      try {
        horasSaved = await _saveHorasData(horasData);
      } catch (horasError) {
        horasSaveFailed = true;
        console.warn('Calificaciones guardadas; horas no guardadas:', horasError);
      }
    }
    Store.invalidateGradesForGroup(selectedGroup);
    Store.invalidate('allGrades');
    if (typeof Store.invalidateTeacherHours === 'function') Store.invalidateTeacherHours();
    _assignmentStatusCache = {};
    _assignmentStatusForPartial = null;
    _listCleared = false;
    _hideClearPendingNotice();
    _markClean();
    _isSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = origBtnText; }

    if (saveBtn) {
      saveBtn.classList.add('btn-save-success');
      setTimeout(() => saveBtn.classList.remove('btn-save-success'), 2000);
    }

    const successParts = [];
    if (wasListCleared) successParts.push(`${count} registros dejados en blanco`);
    else if (count > 0) successParts.push(`${count} calificaciones guardadas`);
    if (incidentCount > 0) successParts.push(`${incidentCount} incidencias registradas`);
    if (horasSaved) successParts.push('horas guardadas');
    if (!silent) {
      Toast.show(successParts.length ? successParts.join(' y ') : 'Cambios guardados', 'success');
      if (horasSaveFailed) Toast.show('Las calificaciones sí se guardaron. Las horas no se pudieron guardar; intenta guardar horas de nuevo después.', 'warning', 9000);
    }

    // Audit in background (don't block UI)
    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);
    DB.audit('editar', 'calificación', `${selectedGroup}_${selectedSubject}_${currentPartial}`, {
      description: `${count} calificaciones guardadas: ${asg?.subjectName || selectedSubject} · ${asg?.groupName || selectedGroup} · ${currentPartial}`,
      extra: { groupId: selectedGroup, subjectId: selectedSubject, partial: currentPartial, count, incidentCount }
    });
    } catch (fatalError) {
      // CATCH GLOBAL — captura cualquier excepción no manejada
      console.error('[saveGrades] FATAL ERROR no manejado:', fatalError);
      Toast.show('Error inesperado: ' + (fatalError?.message || 'desconocido') + '. Tus datos siguen en pantalla, intenta otra vez.', 'error');
      try { _saveDraft(); } catch (_) {}
    } finally {
      // FINALLY GLOBAL — SIEMPRE libera el lock y restaura el botón
      clearTimeout(safetyTimer);
      _isSaving = false;
      _saveStartedAt = 0;
      if (saveBtn) {
        saveBtn.disabled = false;
        // Solo restaurar texto si seguimos en "Guardando..." (no pisar otro estado)
        if (saveBtn.innerHTML.includes('Guardando')) {
          saveBtn.innerHTML = origBtnText || '<span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">save</span>Guardar';
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRINT — Formato Oficial v13 (Control Parcial)
  // ═══════════════════════════════════════════════════════════════

  // Script de impresión: shrink-to-fit en celdas de nombre + window.print().
  //
  // NOTA HISTÓRICA: en v6.02 había un auto-fit con `zoom` para forzar 1 hoja.
  // El `zoom` NO propaga al output de impresión de Chrome, así que recortaba
  // alumnos (reportado por maestros 2026-05-10). NUNCA volver a usar zoom.
  //
  // BAJO NINGUNA CIRCUNSTANCIA se permite cortar el nombre de un alumno
  // (reportado 2026-05-11). Por eso este script, antes de imprimir, mide
  // cada celda `.nm` (apellidos, nombre) y, si el texto natural excede el
  // ancho de la celda, REDUCE EL FONT-SIZE de esa celda específica en pasos
  // de 0.3px hasta que quepa. Solo afecta la celda en cuestión, las demás
  // (rubros, suma, calificación) mantienen su font. Si aún al mínimo legible
  // el texto sobresale, se permite overflow visible (preferimos overlap a
  // truncar). Funciona para grades.js y my-f1.js — ambos usan clase `.nm`.
  const _PRINT_TRIGGER_SCRIPT = '<script>(function(){function shrinkNameCells(){document.querySelectorAll(".MT td.nm").forEach(function(td){if(td.scrollWidth<=td.clientWidth+1)return;var cur=parseFloat(getComputedStyle(td).fontSize);var min=5;var step=0.3;var guard=80;while(td.scrollWidth>td.clientWidth+1&&cur>min&&guard-->0){cur-=step;td.style.fontSize=cur+"px";}if(td.scrollWidth>td.clientWidth+1)td.style.overflow="visible";});}window.addEventListener("load",function(){setTimeout(function(){shrinkNameCells();window.print();},300);});})();<\/script>';

  function _buildOfficialPrintHTML(studentsList, gradeData, meta) {
    const { teacherName, subjectName, groupName, groupNum, grado, turno, parcialNum, parcialText, semText, orientador, horas } = meta;
    const horasData = horas || {};
    const n = studentsList.length;

    // El turno MATUTINO no contempla Examen Parcial como rubro — solo se usa
    // Evaluación Continua + Transversal + Punto Extra. Por eso ocultamos esa
    // columna en la impresión del control para no mostrar campos vacíos que
    // confundirían al docente al firmar. En VESPERTINO sí va incluida.
    const isMatutino = String(turno || '').toUpperCase() === 'MATUTINO';

    // Dynamic font sizing — más generoso porque el layout rediseñado libera
    // ~15mm de altura útil para la tabla (bloque inferior compacto, márgenes
    // ajustados, header denso). Disponible para filas: ~225mm.
    //
    // PRIORIDAD ABSOLUTA (recordatorio): ningún alumno se pierde NUNCA. Si por
    // número extremo de alumnos no entra al font mínimo, se permite 2da hoja
    // con thead repetido. JAMÁS overflow:hidden ni zoom (recortaban alumnos).
    let fs, headerFs;
    if (n <= 25)      { fs = '11pt';   headerFs = '9pt';   }
    else if (n <= 32) { fs = '10.5pt'; headerFs = '9pt';   }
    else if (n <= 40) { fs = '10pt';   headerFs = '8.5pt'; }
    else if (n <= 48) { fs = '9pt';    headerFs = '8pt';   }
    else if (n <= 55) { fs = '8.5pt';  headerFs = '7.5pt'; }
    else if (n <= 62) { fs = '8pt';    headerFs = '7pt';   }
    else if (n <= 70) { fs = '7.5pt';  headerFs = '6.8pt'; }
    else if (n <= 80) { fs = '7pt';    headerFs = '6.5pt'; }
    else              { fs = '6.5pt';  headerFs = '6.2pt'; }

    let rows = '';
    let aprobados = 0, reprobados = 0, totalCalif = 0, gradedCount = 0;

    studentsList.forEach((s, idx) => {
      const g = gradeData[s.docId || s.id] || {};
      const isTraslado = !!s.bajaPendiente;
      const ec = isTraslado ? '' : (g.ec !== undefined && g.ec !== null ? g.ec : 0);
      const tr = isTraslado ? '' : (g.tr !== undefined && g.tr !== null ? g.tr : 0);
      const ep = isTraslado ? '' : (g.ex !== undefined && g.ex !== null ? g.ex : 0);
      const pe = isTraslado ? '' : (g.pe !== undefined && g.pe !== null ? g.pe : 0);
      const sm = isTraslado ? '' : (g.suma !== undefined && g.suma !== null ? g.suma : 0);
      const fa = isTraslado ? '' : (g.faltas !== undefined && g.faltas !== null ? Math.round(g.faltas) : 0);
      const cd = isTraslado ? '' : (g.cal !== undefined && g.cal !== null ? g.cal : (g.value !== undefined && g.value !== null ? Math.min(Number(g.value), 10) : ''));

      if (cd !== '') {
        const nv = parseFloat(cd);
        if (!isNaN(nv)) { gradedCount++; totalCalif += nv; if (nv >= 6) aprobados++; else reprobados++; }
      }

      const isReprobado = cd !== '' && parseFloat(cd) < 6;
      const isOdd = idx % 2 === 1;
      let rowBg = '';
      if (isReprobado) { rowBg = ' background:#bbb;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }
      else if (isOdd) { rowBg = ' background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;'; }

      const ap1 = s.apellido1 || '';
      const ap2 = s.apellido2 || '';
      const nom = s.nombres || '';

      rows += '<tr style="' + rowBg + '">' +
        '<td class="c">' + (idx + 1) + '</td>' +
        '<td class="nm">' + Utils.sanitize(ap1) + '</td>' +
        '<td class="nm">' + Utils.sanitize(ap2) + '</td>' +
        '<td class="nm">' + Utils.sanitize(nom) + '</td>' +
        '<td class="c">' + ec + '</td>' +
        '<td class="c">' + tr + '</td>' +
        (isMatutino ? '' : '<td class="c">' + ep + '</td>') +
        '<td class="c">' + pe + '</td>' +
        '<td class="c">' + sm + '</td>' +
        '<td class="c">' + fa + '</td>' +
        '<td class="c" style="font-weight:bold;">' + (cd === '' ? (isTraslado ? '' : 0) : cd) + '</td>' +
        '<td></td>' +
        '</tr>';
    });

    const existencia = studentsList.length;
    const inscritos = existencia;
    const promedio = gradedCount > 0 ? (totalCalif / gradedCount).toFixed(2) : 0;
    const pctAprob = gradedCount > 0 ? ((aprobados / gradedCount) * 100).toFixed(1) + '%' : '0%';

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    return `
<style>
/* Márgenes mínimos para máxima altura útil: 4mm top, 3mm bottom, 5mm laterales.
   Sigue siendo cómodo para impresoras estándar y maximiza espacio para alumnos. */
@page { size: letter portrait; margin: 4mm 5mm 3mm 5mm; }
html, body { margin:0; padding:0; }
* { box-sizing:border-box; margin:0; padding:0; }

/* ═══ PAGE LAYOUT ═══
   PRIORIDAD ABSOLUTA: ver a TODOS los alumnos. NUNCA overflow:hidden ni
   altura fija (v6.02 lo tuvo y recortaba). El font sizing dinámico (arriba)
   busca caber en 1 hoja, pero si físicamente no cabe va a 2da hoja con
   thead repetido — jamás perder un alumno. */
.PG {
    width:100%;
    font-family:Arial,Helvetica,sans-serif; color:#000; line-height:1.05;
    font-size:${fs};
}
.PG table { border-collapse:collapse; }

@media screen {
    body { background: #e2e8f0; padding: 16px 0; }
    .PG { background: #fff; max-width: 215mm; min-height: 270mm; margin: 0 auto; padding: 4mm 5mm; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
}

@media print {
    .MT { page-break-inside: auto; }
    .MT tr { page-break-inside: avoid; page-break-after: auto; }
    .MT thead { display: table-header-group; }
    .PG-bot, .PG-ftr { page-break-inside: avoid; }
}

/* Header: dirección general (derecha) + logo (izquierda). Mínimo. */
.hdr-t { width:100%; margin-bottom:0; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:5.5mm; width:auto; }
.hdr-r { text-align:right; font-size:6pt; line-height:1.15; color:#333; }

/* Título de la escuela y del control. Mínimo. */
.ttl-esc { text-align:center; font-weight:bold; font-size:9.5pt; line-height:1.05; }
.ttl-ctrl { text-align:center; font-weight:bold; font-size:8.5pt; line-height:1; margin:0;
    border-bottom:0.5pt solid #000; padding-bottom:0.2mm; }

/* Info docente: padding ultra reducido. */
.nfo { width:100%; font-size:7.5pt; line-height:1.1; margin-top:0.2mm; }
.nfo td { border:0.5pt solid #000; padding:0.2mm 0.8mm; vertical-align:middle; }
.nfo .lb { font-size:6.5pt; color:#444; }
.nfo .vl { font-weight:bold; font-size:7.5pt; }
.nfo .sm { text-align:center; font-weight:bold; font-size:8pt; line-height:1.1; }

/* Tabla principal de alumnos. Line-height más ajustado y padding mínimo
   para empacar más filas sin tocar el font (legibilidad intacta). */
.MT { width:100%; table-layout:fixed; font-size:${fs}; line-height:1.0; margin-top:0.3mm; }
.MT th { border:0.5pt solid #000; padding:0.3mm 0.3mm; text-align:center; font-weight:bold; font-size:${headerFs};
    background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
    line-height:1.05; vertical-align:middle; }
.MT td { border:0.4pt solid #000; font-size:${fs}; line-height:1.0;
    padding:0.15mm 0.3mm; overflow:hidden; white-space:nowrap; vertical-align:middle; }
.MT .c { text-align:center; padding:0.15mm 0; }
/* La celda del nombre/apellidos NUNCA corta el texto. El script de print
   reduce el font solo de esta celda hasta que el texto completo quepa. */
.MT .nm { overflow:hidden; white-space:nowrap; padding-left:1mm; }

/* Stats inferiores en horizontal — compacto al máximo. */
.ST-row { width:100%; border-collapse:collapse; margin-top:0.3mm; }
.ST-row td { border:0.4pt solid #000; padding:0.2mm 1mm; text-align:center; vertical-align:middle; }
.ST-row .lb { font-size:5.8pt; color:#555; font-weight:600; text-transform:uppercase; line-height:1.05; }
.ST-row .vl { font-size:8.5pt; font-weight:bold; line-height:1; }

/* Horas impartidas. */
.HT { width:100%; border-collapse:collapse; margin-top:0.3mm; }
.HT td { border:0.4pt solid #000; padding:0.2mm 0.4mm; text-align:center; line-height:1.0; }
.HT .hl { font-weight:bold; font-size:5.8pt; color:#444; }
.HT .hv { font-weight:bold; font-size:7pt; }
.HT .ht { font-weight:bold; font-size:5.8pt; line-height:1.05; }

/* Firmas: ya no tienen margin top exagerado — pegadas al bloque de horas. */
.SG-tbl { width:100%; border-collapse:collapse; margin-top:0.5mm; }
.SG-tbl td { width:25%; text-align:center; padding:0 1.5mm; vertical-align:bottom; }
.SG-tbl .sg-line-row td { border-bottom:0.5pt solid #000; height:4mm; }
.SG-tbl .sg-text-row td { vertical-align:top; padding-top:0.2mm; }
.SG-tt { font-weight:bold; font-size:6.5pt; line-height:1.05; }
.SG-nm { font-size:5.8pt; line-height:1.1; }

/* Footer: logo de la cinta del Estado más bajo. */
.ftr img { width:100%; max-height:2mm; display:block; }
.ftr-t { text-align:center; font-size:5pt; color:#333; line-height:1; margin-top:0; }
</style>

<div class="PG">

<!-- ═══ HEADER (fijo) ═══ -->
<div class="PG-hdr">
<table class="hdr-t"><tr>
    <td style="width:50%">${logoHeader ? '<img src="' + logoHeader + '">' : ''}</td>
    <td class="hdr-r">
        DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR<br>
        DIRECCIÓN DE BACHILLERATO GENERAL<br>
        ZONA ESCOLAR NÚM. 63 BC<br>
        ESCUELA PREPARATORIA OFICIAL NÚM. 67<br>
        <b>C.C.T. 15EBH0134D · 15EBH0168U</b>
    </td>
</tr></table>
</div>

<!-- ═══ TÍTULOS (fijo) ═══ -->
<div class="PG-ttl">
<div class="ttl-esc">ESCUELA PREPARATORIA OFICIAL NÚM. 67</div>
<div class="ttl-ctrl">CONTROL ${parcialText} PARCIAL</div>
</div>

<!-- ═══ INFO DOCENTE/MATERIA (fijo) ═══ -->
<div class="PG-nfo">
<table class="nfo">
    <tr>
        <td style="width:10%"><span class="lb">Profesor(a):</span></td>
        <td style="width:35%" class="vl">${Utils.sanitize(Utils.displayName(teacherName))}</td>
        <td style="width:10%"><span class="lb">Grado:</span> <span class="vl">${grado}°</span></td>
        <td style="width:10%"><span class="lb">Grupo:</span> <span class="vl">${groupNum}</span></td>
        <td style="width:20%" class="sm" rowspan="2">${semText}<br><span style="font-size:5.5pt;color:#333;">${Utils.sanitize(turno)}</span></td>
    </tr>
    <tr>
        <td><span class="lb">UAC:</span></td>
        <td colspan="3" class="vl">${Utils.sanitize(subjectName)}</td>
    </tr>
</table>
</div>

<!-- ═══ TABLA DE ALUMNOS (CRECE — flex:1) ═══ -->
<div class="PG-data">
<table class="MT">
    <colgroup>
        ${isMatutino
          ? '<col style="width:3%"><col style="width:11%"><col style="width:11%"><col style="width:15%">' +
            '<col style="width:8%"><col style="width:7%"><col style="width:7%">' +
            '<col style="width:7%"><col style="width:6%"><col style="width:8%"><col style="width:7%">'
          : '<col style="width:3%"><col style="width:10%"><col style="width:10%"><col style="width:13%">' +
            '<col style="width:6%"><col style="width:5.5%"><col style="width:5.5%"><col style="width:4.5%">' +
            '<col style="width:5%"><col style="width:4.5%"><col style="width:6%"><col style="width:7%">'
        }
    </colgroup>
    <thead><tr>
        <th>No.</th>
        <th>Apellido Paterno</th>
        <th>Apellido Materno</th>
        <th>Nombre(s)</th>
        <th>Evaluación<br>Continua</th>
        <th>Transversal</th>
        ${isMatutino ? '' : '<th>Examen<br>Parcial</th>'}
        <th>Punto<br>Extra</th>
        <th>Suma</th>
        <th>Faltas</th>
        <th>Cal.<br>Definitiva</th>
        <th>Firma</th>
    </tr></thead>
    <tbody>${rows}</tbody>
</table>
</div>

<!-- ═══ ESTADÍSTICAS + FIRMAS (compacto en horizontal) ═══ -->
<div class="PG-bot">

<!-- 7 stats en 1 sola fila horizontal: ocupa ~5mm en lugar de ~14mm verticales -->
<table class="ST-row">
    <tr>
        <td><div class="lb">Inscritos</div><div class="vl">${inscritos}</div></td>
        <td><div class="lb">Bajas</div><div class="vl">0</div></td>
        <td><div class="lb">Existencia</div><div class="vl">${existencia}</div></td>
        <td><div class="lb">Aprobados</div><div class="vl">${aprobados}</div></td>
        <td><div class="lb">Reprobados</div><div class="vl">${reprobados}</div></td>
        <td><div class="lb">% Aprobados</div><div class="vl">${pctAprob || '—'}</div></td>
        <td><div class="lb">Promedio</div><div class="vl">${promedio || '—'}</div></td>
    </tr>
</table>

<!-- Horas impartidas (1 línea, sin label "Horas Impartidas" que ahorra espacio) -->
<table class="HT">
    <tr>
        <td class="ht" rowspan="2" style="width:18mm;">HORAS<br>IMPARTIDAS</td>
        <td class="hl">Febrero</td><td class="hl">Marzo</td><td class="hl">Abril</td>
        <td class="hl">Mayo</td><td class="hl">Junio</td><td class="hl">Julio</td>
        <td class="hl" style="font-weight:bold">Total</td>
    </tr>
    <tr>
        <td class="hv">${horasData.febrero || ''}</td><td class="hv">${horasData.marzo || ''}</td><td class="hv">${horasData.abril || ''}</td>
        <td class="hv">${horasData.mayo || ''}</td><td class="hv">${horasData.junio || ''}</td><td class="hv">${horasData.julio || ''}</td>
        <td class="hv" style="font-weight:bold">${[horasData.febrero,horasData.marzo,horasData.abril,horasData.mayo,horasData.junio,horasData.julio].reduce((s,v) => s + (parseInt(v) || 0), 0) || ''}</td>
    </tr>
</table>

<!-- Firmas (4 columnas, líneas y nombres) -->
<table class="SG-tbl">
    <tr class="sg-line-row">
        <td></td><td></td><td></td><td></td>
    </tr>
    <tr class="sg-text-row">
        <td>
            <div class="SG-tt">FIRMA DEL PROFESOR</div>
            <div class="SG-nm">${Utils.sanitize(Utils.displayName(teacherName))}</div>
        </td>
        <td>
            <div class="SG-tt">FIRMA DEL ORIENTADOR</div>
            <div class="SG-nm">${Utils.sanitize(orientador)}</div>
        </td>
        <td>
            <div class="SG-tt">VO. BO. SUBDIRECCIÓN ESCOLAR</div>
            <div class="SG-nm">${Utils.sanitize(App.staffName('subdirector'))}</div>
        </td>
        <td>
            <div class="SG-tt">DIRECCIÓN ESCOLAR</div>
            <div class="SG-nm">${Utils.sanitize(App.staffName('director'))}</div>
        </td>
    </tr>
</table>

</div>

<!-- ═══ FOOTER (fijo) ═══ -->
<div class="PG-ftr">
<div class="ftr">
    ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
    <div class="ftr-t">Av. de los Astros 7, Cuautitlán Izcalli, Estado de México, México C.P. 54770 · Tel. 55 5877 0221 · epo67@edu.gem.gob.mx</div>
</div>
</div>

</div>`;
  }

  async function printGrades() {
    if (!students || students.length === 0) {
      Toast.show('No hay datos para imprimir', 'warning');
      return;
    }
    // BLOQUEO 1: si hay reprobados sin motivo en esta lista, forzar captura
    // antes de imprimir. La lista impresa no debe salir sin todos los motivos.
    const ok = await _enforceIncidentsBeforeLeave('imprimir esta lista');
    if (!ok) return;

    const asg = assignments.find(a => a.subjectId === selectedSubject && a.groupId === selectedGroup);

    // v8.20 BLOQUEO 2: horas semestrales completas + todos los alumnos calificados.
    // Solo aplica para maestros — admin/subdirector pueden imprimir con override.
    if (asg) {
      const ready = await _enforcePrintReadiness([asg], currentPartial, 'imprimir esta lista');
      if (!ready) return;
    }
    const subjectName = asg ? K.getUACNombre(asg.subjectName || asg.subjectId) : selectedSubject;
    const groupName = asg ? (asg.groupName || asg.groupId) : selectedGroup;
    const teacherName = (asg?.teacherName || '').toUpperCase();
    const grado = asg?.grado || 1;
    const groupNum = (groupName.split('-')[1] || groupName).trim();

    const parcialObj = K.PARCIALES.find(p => p.id === currentPartial);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };
    const semText = semMap[grado] || '';
    const orientador = K.getOrientador(currentTurno, groupName) || '';

    // Build grade data map from DOM (current editor state)
    const gradeDataMap = {};
    const rubros = K.getRubros(currentTurno);
    students.forEach(s => {
      const key = `${s.docId}_${selectedSubject}_${currentPartial}`;
      const stored = grades[key] || {};
      const row = document.querySelector(`tr[data-student-id="${s.docId}"]`);
      const g = {};

      if (row) {
        rubros.forEach(r => {
          const input = row.querySelector(`input[data-field="${r.key}"]`);
          g[r.key] = input && input.value.trim() !== '' ? parseFloat(input.value) : (stored[r.key] !== undefined ? stored[r.key] : null);
        });
        const sumaCell = row.querySelector('.col-suma');
        const calCell = row.querySelector('.col-cal');
        const faltasInput = row.querySelector('input[data-field="faltas"]');
        g.suma = sumaCell && sumaCell.textContent.trim() !== '' ? parseFloat(sumaCell.textContent) : null;
        g.cal = calCell && calCell.textContent.trim() !== '' ? parseFloat(calCell.textContent) : null;
        g.faltas = faltasInput && faltasInput.value.trim() !== '' ? parseInt(faltasInput.value) : null;
      } else {
        rubros.forEach(r => { g[r.key] = stored[r.key] !== undefined ? stored[r.key] : null; });
        g.suma = stored.suma !== undefined ? stored.suma : null;
        g.cal = stored.cal !== undefined ? stored.cal : (stored.value !== undefined ? Math.min(Number(stored.value), 10) : null);
        g.faltas = stored.faltas !== undefined ? stored.faltas : null;
      }
      gradeDataMap[s.docId] = g;
    });

    const html = _buildOfficialPrintHTML(students, gradeDataMap, {
      teacherName, subjectName, groupName, groupNum, grado, turno: currentTurno,
      parcialNum, parcialText, semText, orientador, horas: _getHorasData()
    });

    const printWindow = window.open('', '_blank');
    // v8.10: el título de la pestaña incluye PARCIAL N para evitar que el
    // docente imprima la lista del parcial equivocado al tener varias pestañas
    // abiertas. El nombre del job en la cola de impresión también lo lleva.
    printWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>PARCIAL ' +
      parcialNum + ' · ' + Utils.sanitize(groupName) + ' · ' + Utils.sanitize(subjectName) + '</title></head><body>' +
      html + _PRINT_TRIGGER_SCRIPT + '</body></html>');
    printWindow.document.close();
  }

  async function _printSelectedAssignments(printAll) {
    const partialId = document.getElementById('bulk-print-partial')?.value || currentPartial;
    let assignmentIds = [];

    if (printAll) {
      assignmentIds = _orderedAssignments().map(a => a.id);
    } else {
      assignmentIds = [...document.querySelectorAll('.bulk-print-check:checked')]
        .map(input => input.value)
        .filter(Boolean);
    }

    await printMultipleAssignments(assignmentIds, partialId);
  }

  // ─── BULK PRINT — varias asignaciones a la vez ───
  /**
   * Imprime múltiples listas en un solo documento (con page-break entre cada una).
   * @param {string[]} assignmentIds - IDs de assignments a incluir
   * @param {string} partialId - ej. 'P1', 'P2', 'P3'
   */
  async function printMultipleAssignments(assignmentIds, partialId) {
    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) {
      Toast.show('No hay listas seleccionadas para imprimir', 'warning');
      return;
    }

    // Filtrar las assignments solicitadas
    // v8.09: usar getOwnAssignments() para que auditor/presidente_academia
    // solo puedan imprimir SUS propias listas (no las de toda la escuela).
    // v8.23 FIX: era `Auth.userDoc?.role` (no existe esa property) — lo correcto
    // es `App.currentUser?.role`. El bug causaba que isAdminLike siempre fuera
    // false, así que admin/subdirector terminaban llamando getOwnAssignments.
    const role = App.currentUser?.role;
    const isAdminLike = (role === 'admin' || role === 'subdirector');
    const myAsg = isAdminLike
      ? await Store.getAssignments()
      : await Store.getOwnAssignments();
    let targetAsgs = assignmentIds.map(id => myAsg.find(a => a.id === id)).filter(Boolean);
    if (targetAsgs.length === 0) {
      Toast.show('No se encontraron las asignaciones solicitadas', 'error');
      return;
    }

    // v8.20: BLOQUEO — horas semestrales completas + todos los alumnos calificados.
    // El validador necesita acceso a _assignmentStatusCache; si esta función se
    // llama desde fuera del editor (p.ej. desde imprimir múltiples desde la
    // cascada), el cache puede estar vacío para esta lista → recargar primero.
    if (!isAdminLike || _capAssignments.length > 0) {
      const readyOk = await _enforcePrintReadiness(targetAsgs, partialId, 'imprimir esta(s) lista(s)', {
        allowReadyOnly: targetAsgs.length > 1
      });
      if (!readyOk) return;
      if (readyOk.readyOnlyIds) {
        const allowed = new Set(readyOk.readyOnlyIds);
        targetAsgs = targetAsgs.filter(a => allowed.has(a.id));
        if (targetAsgs.length === 0) {
          Toast.show('No hay listas completas para imprimir.', 'warning');
          return;
        }
      }
    }

    Toast.show(`Generando ${targetAsgs.length} lista(s)…`, 'info');

    const parcialObj = K.PARCIALES.find(p => p.id === partialId);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };

    // Pre-cargar grupos y students para cada uno
    const groupIds = [...new Set(targetAsgs.map(a => a.groupId))];
    const [allGroups, allStudents] = await Promise.all([
      Store.getGroups(),
      Store.getStudentsByGroups(groupIds),
    ]);
    const studentsByGroup = {};
    for (const s of allStudents) {
      if (!studentsByGroup[s.groupId]) studentsByGroup[s.groupId] = [];
      studentsByGroup[s.groupId].push(s);
    }

    // Generar HTML por cada asignación, separados con page-break
    const allHtml = [];
    for (let i = 0; i < targetAsgs.length; i++) {
      const asg = targetAsgs[i];
      const grupo = allGroups.find(g => g.id === asg.groupId);
      const turno = grupo?.turno || asg.turno || 'MATUTINO';
      const grado = Number(grupo?.grado || asg.grado || 1);
      const groupName = grupo?.nombre || asg.groupName || asg.groupId;
      const groupNum = (groupName.split('-')[1] || groupName).trim();
      const subjectName = K.getUACNombre(asg.subjectName || asg.subjectId);
      const teacherName = (asg.teacherName || '').toUpperCase();
      const orientador = K.getOrientador(turno, groupName) || '';
      const semText = semMap[grado] || '';

      // Alumnos del grupo, ordenados
      const grpStudents = (studentsByGroup[asg.groupId] || [])
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      // Grades del grupo+materia+parcial
      let groupGrades = [];
      try {
        const all = await Store.getGradesByGroupAndPartial(asg.groupId, partialId);
        groupGrades = all.filter(g => g.subjectId === asg.subjectId);
      } catch (e) {
        console.warn('No se pudieron cargar grades para', asg.groupId, e);
      }
      const gradeDataMap = {};
      groupGrades.forEach(g => {
        gradeDataMap[g.studentId] = g;
      });
      // Para cada alumno asegurar entrada
      grpStudents.forEach(s => {
        if (!gradeDataMap[s.id]) gradeDataMap[s.id] = {};
        // Adaptar al formato esperado por _buildOfficialPrintHTML (docId)
        gradeDataMap[s.id || s.docId] = gradeDataMap[s.id] || {};
      });

      // Horas del docente para este grupo+materia+parcial
      let horas = {};
      try {
        const docId = `${asg.groupId}_${asg.subjectId}_${partialId}`;
        const horasDoc = await db.collection('teacherHours').doc(docId).get();
        if (horasDoc.exists) horas = horasDoc.data() || {};
      } catch (e) { /* ignorar */ }

      // Adaptar students al formato (con docId) que espera _buildOfficialPrintHTML
      const studentsForPrint = grpStudents.map(s => ({ docId: s.id, ...s }));
      // Adaptar gradeDataMap a usar docId como key (id === docId aquí)
      const gradeDataByDocId = {};
      grpStudents.forEach(s => { gradeDataByDocId[s.id] = gradeDataMap[s.id] || {}; });

      const meta = {
        teacherName, subjectName, groupName, groupNum, grado, turno,
        parcialNum, parcialText, semText, orientador, horas
      };
      const html = _buildOfficialPrintHTML(studentsForPrint, gradeDataByDocId, meta);

      // Page break después de cada lista (excepto la última)
      const pageBreak = i < targetAsgs.length - 1
        ? '<div style="page-break-after:always;"></div>'
        : '';
      allHtml.push(html + pageBreak);
    }

    // Abrir ventana de impresión con todas las listas concatenadas
    const printWindow = window.open('', '_blank');
    printWindow.document.write(
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<title>PARCIAL ' + parcialNum + ' · ' + targetAsgs.length + ' listas</title>' +
      '</head><body>' + allHtml.join('') +
      _PRINT_TRIGGER_SCRIPT +
      '</body></html>'
    );
    printWindow.document.close();
    Toast.show(`${targetAsgs.length} lista(s) generadas`, 'success');
  }

  function printAdminGrades() {
    if (!_admin.grupo || !_admin.parcial) {
      Toast.show('Selecciona un grupo y parcial para imprimir', 'warning');
      return;
    }
    if (!_admin.materia) {
      Toast.show('Selecciona una materia para imprimir en formato oficial', 'warning');
      return;
    }

    const studentMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    const subjectMap = {};
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    const groupMap = {};
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    const grupo = groupMap[_admin.grupo];
    const groupName = grupo?.nombre || _admin.grupo;
    const groupNum = (groupName.split('-')[1] || groupName).trim();
    const grado = grupo?.grado || parseInt(_admin.grado) || 1;
    const turno = _admin.turno;

    const subject = subjectMap[_admin.materia];
    const subjectName = K.getUACNombre(subject?.nombre || _admin.materia);

    // Find teacher for this group+subject
    const asg = _admin.allAssignments.find(a => a.groupId === _admin.grupo && a.subjectId === _admin.materia);
    const teacherName = (asg?.teacherName || '').toUpperCase();

    const parcialObj = K.PARCIALES.find(p => p.id === _admin.parcial);
    const parcialNum = parcialObj?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcialText = parcMap[parcialNum] || 'PRIMER';
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };
    const semText = semMap[grado] || '';
    const orientador = K.getOrientador(turno, groupName) || '';

    // Filter students for this group and sort by apellido
    const groupStudents = _admin.allStudents
      .filter(s => s.groupId === _admin.grupo)
      .sort((a, b) => {
        const c = (a.apellido1 || '').localeCompare(b.apellido1 || '');
        if (c) return c;
        const c2 = (a.apellido2 || '').localeCompare(b.apellido2 || '');
        if (c2) return c2;
        return (a.nombres || '').localeCompare(b.nombres || '');
      });

    // Build grade data map from allGrades
    const gradeDataMap = {};
    const filtered = _admin.allGrades.filter(g => g.subjectId === _admin.materia && g.partial === _admin.parcial);
    filtered.forEach(g => {
      gradeDataMap[g.studentId] = g;
    });

    const html = _buildOfficialPrintHTML(groupStudents, gradeDataMap, {
      teacherName, subjectName, groupName, groupNum, grado, turno,
      parcialNum, parcialText, semText, orientador
    });

    const printWindow = window.open('', '_blank');
    // v8.10: el título de la pestaña incluye PARCIAL N para evitar que el
    // docente imprima la lista del parcial equivocado al tener varias pestañas
    // abiertas. El nombre del job en la cola de impresión también lo lleva.
    printWindow.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>PARCIAL ' +
      parcialNum + ' · ' + Utils.sanitize(groupName) + ' · ' + Utils.sanitize(subjectName) + '</title></head><body>' +
      html + _PRINT_TRIGGER_SCRIPT + '</body></html>');
    printWindow.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // ADMIN / ORIENTADOR VIEW — Filtros cascada estilo v13
  // ═══════════════════════════════════════════════════════════════

  async function renderAdmin() {
    const role = App.currentUser?.role;
    // Subdirector tiene autoridad académica equivalente a admin (entra como admin).
    if (role !== 'admin' && role !== 'subdirector' && !App.canActAs('orientador') && !App.canActAs('maestro')) {
      _container().innerHTML = UI.moduleContainer(UI.emptyState('block', 'Acceso denegado'));
      return;
    }

    const container = _container();
    container.innerHTML = UI.moduleContainer(UI.loadingState('Cargando datos...'));

    try {
      const [s, a, t, sub, grp, p] = await Promise.all([
        Store.getStudents(), Store.getAssignments(),
        Store.getTeachers(), Store.getSubjects(), Store.getGroups(), Store.getPartials()
      ]);

      _admin.allStudents = s.filter(st => st.estatus === 'ACTIVO');
      _admin.allGrades = []; // Se cargan bajo demanda al seleccionar grupo
      _admin.allAssignments = a;
      _admin.allTeachers = t;
      _admin.allSubjects = sub;
      _admin.allGroups = grp;
      _admin.allPartials = p;
      _admin.turno = ''; _admin.grado = ''; _admin.grupo = '';
      _admin.parcial = ''; _admin.materia = ''; _admin.docente = '';

      // For maestros (incluyendo orientador_docente): auto-filter a sus grupos/materias
      if (App.canActAs('maestro')) {
        _admin._teacherDocId = await Store.getTeacherDocId();
        if (_admin._teacherDocId) {
          _admin._teacherAssignments = a.filter(asg => asg.teacherId === _admin._teacherDocId);
        } else {
          _admin._teacherAssignments = [];
        }
      } else {
        _admin._teacherDocId = null;
        _admin._teacherAssignments = null;
      }

      _renderAdminUI();
    } catch (error) {
      console.error('Error loading admin grades:', error);
      container.innerHTML = UI.moduleContainer(UI.errorState('Error al cargar calificaciones'));
    }
  }

  function _renderAdminUI() {
    const container = _container();
    const role = App.currentUser?.role;
    // Subdirector cuenta como admin (vista global sin filtrar a sus grupos).
    const isMaestro = App.canActAs('maestro') && role !== 'admin' && role !== 'subdirector';
    const subtitle = isMaestro
      ? 'Consulta de calificaciones de tus grupos y materias asignadas'
      : 'Consulta de calificaciones por grupo (solo lectura)';

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Consulta de Calificaciones', subtitle)}

        <div class="card">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
            <div class="form-group"><label>Turno</label>
              <select id="gf-turno"><option value="">Seleccionar...</option>${K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Grado</label>
              <select id="gf-grado"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Grupo</label>
              <select id="gf-grupo"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Parcial</label>
              <select id="gf-parcial"><option value="">Seleccionar...</option></select>
            </div>
            <div class="form-group"><label>Materia</label>
              <select id="gf-materia"><option value="">Todas</option></select>
            </div>
            <div class="form-group"><label>Docente</label>
              <select id="gf-docente"><option value="">Todos</option></select>
            </div>
          </div>
          <div class="filter-bar-actions" style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" data-action="export-grades">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">download</span>Exportar Excel
            </button>
            <button class="btn btn-outline btn-sm" data-action="print-admin-grades">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir
            </button>
          </div>
        </div>

        <div id="gf-stats"></div>
        <div id="gf-table"></div>
      </div>`;

    _delegateClick(container);
    _bindAdminFilters();
  }

  function _bindAdminFilters() {
    _el('gf-turno').addEventListener('change', function() { _admin.turno = this.value; _cascadeFrom('turno'); });
    _el('gf-grado').addEventListener('change', function() { _admin.grado = this.value; _cascadeFrom('grado'); });
    _el('gf-grupo').addEventListener('change', function() { _admin.grupo = this.value; _cascadeFrom('grupo'); });
    _el('gf-parcial').addEventListener('change', function() { _admin.parcial = this.value; _cascadeFrom('parcial'); });
    _el('gf-materia').addEventListener('change', function() { _admin.materia = this.value; _cascadeFrom('materia'); });
    _el('gf-docente').addEventListener('change', function() { _admin.docente = this.value; _cascadeFrom('docente'); });
  }

  function _cascadeFrom(field) {
    const fields = ['turno', 'grado', 'grupo', 'parcial', 'materia', 'docente'];
    const idx = fields.indexOf(field);
    if (idx <= 0) { _admin.grado = ''; _updateGradoOptions(); }
    if (idx <= 1) { _admin.grupo = ''; _updateGrupoOptions(); }
    if (idx <= 2) { _admin.parcial = ''; _updateParcialOptions(); }
    if (idx <= 3) { _admin.materia = ''; _updateMateriaOptions(); }
    if (idx <= 4) { _admin.docente = ''; _updateDocenteOptions(); }
    _updateTable();
  }

  function _updateGradoOptions() {
    const el = _el('gf-grado');
    // Dedup robusto: coerce a Number primero para no producir "dos terceros"
    // si hay datos mixtos (string "3" + integer 3) en la base.
    let grados = _admin.turno
      ? [...new Set(_admin.allStudents.filter(s => s.turno === _admin.turno).map(s => Number(s.grado)))].filter(g => Number.isFinite(g) && g > 0).sort((a,b) => a-b)
      : [...K.GRADOS];
    // For maestros: only show grados where they have assignments
    if (_admin._teacherAssignments) {
      const teacherGroupIds = new Set(_admin._teacherAssignments.map(a => a.groupId));
      const teacherGrados = new Set(_admin.allGroups.filter(g => teacherGroupIds.has(g.id)).map(g => Number(g.grado)));
      grados = grados.filter(g => teacherGrados.has(Number(g)));
    }
    el.innerHTML = '<option value="">Seleccionar...</option>' + grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');
  }

  function _updateGrupoOptions() {
    const el = _el('gf-grupo');
    let filtered = _admin.allGroups;
    if (_admin.turno) filtered = filtered.filter(g => g.turno === _admin.turno);
    if (_admin.grado) filtered = filtered.filter(g => String(g.grado) === String(_admin.grado));
    // For maestros: only show groups they are assigned to
    if (_admin._teacherAssignments) {
      const teacherGroupIds = new Set(_admin._teacherAssignments.map(a => a.groupId));
      filtered = filtered.filter(g => teacherGroupIds.has(g.id));
    }
    filtered.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    el.innerHTML = '<option value="">Seleccionar...</option>' + filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
  }

  function _updateParcialOptions() {
    const el = _el('gf-parcial');
    el.innerHTML = '<option value="">Seleccionar...</option>' + K.PARCIALES.map(p => {
      const partial = _admin.allPartials.find(pp => pp.id === p.id);
      const locked = partial?.locked ? ' 🔒' : '';
      return `<option value="${p.id}">${p.nombre}${locked}</option>`;
    }).join('');
  }

  function _updateMateriaOptions() {
    const el = _el('gf-materia');
    let subs = [];
    // Determine which assignments to use (maestros only see their own)
    const relevantAssignments = _admin._teacherAssignments || _admin.allAssignments;
    if (_admin.grupo) {
      const ids = [...new Set(relevantAssignments.filter(a => a.groupId === _admin.grupo).map(a => a.subjectId))];
      subs = _admin.allSubjects.filter(s => ids.includes(s.id));
    } else if (_admin.grado) {
      const gGroups = _admin.allGroups.filter(g => String(g.grado) === String(_admin.grado) && (!_admin.turno || g.turno === _admin.turno));
      const gIds = gGroups.map(g => g.id);
      const ids = [...new Set(relevantAssignments.filter(a => gIds.includes(a.groupId)).map(a => a.subjectId))];
      subs = _admin.allSubjects.filter(s => ids.includes(s.id));
    } else {
      if (_admin._teacherAssignments) {
        const ids = [...new Set(_admin._teacherAssignments.map(a => a.subjectId))];
        subs = _admin.allSubjects.filter(s => ids.includes(s.id));
      } else {
        subs = [..._admin.allSubjects];
      }
    }
    // Orden oficial SEP del grado seleccionado (en lugar de alfabético).
    // Si hay grado filtrado en _admin.grado, usar ese; si no, agrupar por grado.
    if (_admin.grado) {
      subs = K.sortSubjectsByGrado(subs, Number(_admin.grado));
    } else {
      // Sin grado: ordenar por grado primero, luego SEP dentro del grado.
      subs.sort((a, b) => {
        const ga = Number(a.grado) || 9; const gb = Number(b.grado) || 9;
        if (ga !== gb) return ga - gb;
        return 0; // dentro del grado se mantiene el orden (K.sort no aplica para mixto)
      });
      subs = subs.flatMap((_, i, arr) => {
        if (i > 0 && arr[i].grado === arr[i - 1].grado) return [];
        const grupoDeGrado = arr.filter(s => s.grado === arr[i].grado);
        return K.sortSubjectsByGrado(grupoDeGrado, Number(arr[i].grado));
      });
    }
    el.innerHTML = '<option value="">Todas las materias</option>' + subs.map(s => `<option value="${s.id}">${Utils.sanitize(K.getUACNombre(s.nombre || s.id))}</option>`).join('');
  }

  function _updateDocenteOptions() {
    const el = _el('gf-docente');
    // For maestros: hide docente filter (they only see their own data)
    if (_admin._teacherAssignments) {
      el.closest('.form-group').style.display = 'none';
      return;
    }
    el.closest('.form-group').style.display = '';
    let filtered = _admin.allAssignments;
    if (_admin.grupo) filtered = filtered.filter(a => a.groupId === _admin.grupo);
    if (_admin.materia) filtered = filtered.filter(a => a.subjectId === _admin.materia);
    const tIds = [...new Set(filtered.map(a => a.teacherId))];
    const teachers = _admin.allTeachers.filter(t => tIds.includes(t.id));
    teachers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    el.innerHTML = '<option value="">Todos los docentes</option>' + teachers.map(t => `<option value="${t.id}">${Utils.sanitize(Utils.displayName(t.nombre || t.id))}</option>`).join('');
  }

  async function _updateTable() {
    const tableContainer = _el('gf-table');
    const statsContainer = _el('gf-stats');
    if (!tableContainer) return;

    if (!_admin.turno) {
      tableContainer.innerHTML = UI.emptyState('filter_list', 'Selecciona un turno para comenzar');
      statsContainer.innerHTML = '';
      return;
    }

    if (!_admin.grupo) {
      tableContainer.innerHTML = UI.emptyState('filter_list', 'Selecciona un grupo para ver calificaciones');
      statsContainer.innerHTML = '';
      return;
    }

    // Show loading while fetching grades for this group
    tableContainer.innerHTML = UI.loadingState('Cargando calificaciones del grupo...');
    statsContainer.innerHTML = '';

    // Load grades for selected group(s) on demand
    try {
      _admin.allGrades = await Store.getGradesByGroup(_admin.grupo, true);
    } catch (err) {
      console.error('Error loading grades:', err);
      tableContainer.innerHTML = UI.emptyState('error', 'Error al cargar calificaciones');
      return;
    }

    // Filter grades (already filtered by groupId from Firestore query)
    let filtered = [..._admin.allGrades];

    // For maestros: restrict to their assigned subjects for this group
    if (_admin._teacherAssignments) {
      const teacherCombos = new Set(_admin._teacherAssignments.map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => teacherCombos.has(`${g.groupId}_${g.subjectId}`));
    }

    if (_admin.parcial) filtered = filtered.filter(g => g.partial === _admin.parcial);
    if (_admin.materia) filtered = filtered.filter(g => g.subjectId === _admin.materia);
    if (_admin.docente) {
      const combos = new Set(_admin.allAssignments.filter(a => a.teacherId === _admin.docente).map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => combos.has(`${g.groupId}_${g.subjectId}`));
    }

    // Build maps
    const studentMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    const subjectMap = {};
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    const groupMap = {};
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    // Stats using cal (or value for legacy data)
    const values = filtered.map(g => {
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : null);
      return cal;
    }).filter(v => v !== null && v !== '' && !isNaN(v));

    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const aprobados = values.filter(v => v >= K.THRESHOLDS.PASS_GRADE).length;
    const reprobados = values.filter(v => v < K.THRESHOLDS.PASS_GRADE).length;
    const pctReprob = values.length > 0 ? Math.round((reprobados / values.length) * 100) : 0;

    const avgClass = avg >= 8.3 ? 'stat-card--success' : avg >= 7 ? 'stat-card--warning' : 'stat-card--danger';
    const repClass = pctReprob <= 14 ? 'stat-card--success' : pctReprob <= 20 ? 'stat-card--warning' : 'stat-card--danger';

    statsContainer.innerHTML = `
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card--compact ${avgClass}"><div class="stat-number">${avg.toFixed(2)}</div><div class="stat-label">Promedio</div></div>
        <div class="stat-card--compact stat-card--primary"><div class="stat-number">${filtered.length}</div><div class="stat-label">Calificaciones</div></div>
        <div class="stat-card--compact stat-card--success"><div class="stat-number">${aprobados}</div><div class="stat-label">Aprobados</div></div>
        <div class="stat-card--compact ${repClass}"><div class="stat-number">${reprobados} (${pctReprob}%)</div><div class="stat-label">Reprobados</div></div>
      </div>`;

    if (filtered.length === 0) {
      tableContainer.innerHTML = UI.emptyState('grading', 'No hay calificaciones para los filtros seleccionados');
      return;
    }

    // Determine rubros for display
    const turnoRubros = K.getRubros(_admin.turno);

    // Sort by student name
    filtered.sort((a, b) => {
      const sa = studentMap[a.studentId];
      const sb = studentMap[b.studentId];
      return (sa?.nombreCompleto || '').localeCompare(sb?.nombreCompleto || '');
    });

    const display = filtered.slice(0, 500);
    const truncated = filtered.length > 500;

    // Header for rubros columns
    const rubroHeaders = turnoRubros.map(r => `<th style="width:55px;text-align:center;font-size:11px;">${r.abbr}</th>`).join('');

    let rows = '';
    display.forEach((g, i) => {
      const student = studentMap[g.studentId];
      const subject = subjectMap[g.subjectId];
      const group = groupMap[g.groupId];
      const cal = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : '-');
      const suma = g.suma !== undefined ? Number(g.suma).toFixed(1) : '-';
      const calColor = cal !== '-' && cal < 6 ? 'color:var(--color-danger);font-weight:700;' : 'font-weight:600;';

      // Rubros cells
      const rubroCells = turnoRubros.map(r => {
        const v = g[r.key];
        return `<td style="text-align:center;font-size:12px;">${v !== undefined ? v : '-'}</td>`;
      }).join('');

      rows += `<tr>
        <td class="text-muted">${i + 1}</td>
        <td class="font-semibold" style="font-size:12px;">${Utils.sanitize(student?.nombreCompleto || 'N/A')}</td>
        <td style="font-size:12px;">${Utils.sanitize(group?.nombre || g.groupId)}</td>
        <td style="font-size:12px;">${Utils.sanitize(K.getUACNombre(subject?.nombre || g.subjectName || g.subjectId))}</td>
        <td style="text-align:center;">${g.partial || ''}</td>
        ${rubroCells}
        <td style="text-align:center;background:rgba(49,130,206,0.04);">${suma}</td>
        <td style="text-align:center;${calColor}">${cal}</td>
        <td style="text-align:center;">${(g.faltas !== undefined && g.faltas !== null) ? g.faltas : (cal !== '' && cal !== '-' && cal !== undefined ? 0 : '-')}</td>
      </tr>`;
    });

    tableContainer.innerHTML = `
      ${truncated ? `<div class="alert alert-warning" style="margin-bottom:12px;">Mostrando las primeras 500 de ${filtered.length} calificaciones.</div>` : ''}
      <div class="table-container" style="overflow-x:auto;">
        <table class="table-light" style="min-width:900px;">
          <thead><tr>
            <th style="width:40px">#</th>
            <th>Alumno</th>
            <th>Grupo</th>
            <th>Materia</th>
            <th style="width:60px;text-align:center;">Parcial</th>
            ${rubroHeaders}
            <th style="width:55px;text-align:center;">SUMA</th>
            <th style="width:50px;text-align:center;">CAL.</th>
            <th style="width:55px;text-align:center;">FALTAS</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function exportGrades() {
    if (!_admin.grupo) {
      Toast.show('Selecciona un grupo para exportar', 'warning');
      return;
    }
    // Use already-loaded grades for this group
    let filtered = [..._admin.allGrades];
    const studentMap = {}, subjectMap = {}, groupMap = {};
    _admin.allStudents.forEach(s => { studentMap[s.id] = s; });
    _admin.allSubjects.forEach(s => { subjectMap[s.id] = s; });
    _admin.allGroups.forEach(g => { groupMap[g.id] = g; });

    // For maestros: restrict export to their assigned subjects
    if (_admin._teacherAssignments) {
      const teacherCombos = new Set(_admin._teacherAssignments.map(a => `${a.groupId}_${a.subjectId}`));
      filtered = filtered.filter(g => teacherCombos.has(`${g.groupId}_${g.subjectId}`));
    }
    if (_admin.parcial) filtered = filtered.filter(g => g.partial === _admin.parcial);
    if (_admin.materia) filtered = filtered.filter(g => g.subjectId === _admin.materia);

    const rubros = K.getRubros(_admin.turno);
    const data = filtered.map(g => {
      const s = studentMap[g.studentId];
      const sub = subjectMap[g.subjectId];
      const grp = groupMap[g.groupId];
      const row = {
        'Alumno': s?.nombreCompleto || '',
        'Grupo': grp?.nombre || g.groupId,
        'Turno': s?.turno || '',
        'Materia': K.getUACNombre(sub?.nombre || g.subjectName || ''),
        'Parcial': g.partial || ''
      };
      rubros.forEach(r => { row[r.abbr] = g[r.key] !== undefined ? g[r.key] : ''; });
      row['SUMA'] = g.suma !== undefined ? g.suma : '';
      row['CAL.'] = g.cal !== undefined ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : '');
      row['FALTAS'] = g.faltas !== undefined ? g.faltas : '';
      return row;
    });

    Utils.exportToExcel(data, `Calificaciones_${_admin.turno}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  // ─── REFRESCAR DESDE SERVIDOR ─────────────────────────────
  // Cuando el cache local de Firestore (IndexedDB) tiene datos viejos/vacíos
  // pero el servidor sí tiene la información, esta función limpia todos los
  // caches y vuelve a cargar el editor con datos frescos del servidor.
  // Caso típico: maestro abre en su celular, ve celdas vacías, pero en la
  // PC del admin sí se ve la info. → Aquí su cache local quedó stale.
  async function refreshFromServer() {
    if (!selectedGroup || !selectedSubject) {
      Toast.show('Abre primero una asignación', 'warning');
      return;
    }
    if (_isDirty) {
      if (!confirm('Tienes cambios sin guardar. ¿Refrescar los datos del servidor de todas formas? (perderás los cambios sin guardar)')) return;
    }
    const btn = document.querySelector('[data-action="refresh-from-server"]');
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Recargando…'; }
    try {
      // Limpiar cache de Store
      Store.invalidateGradesForGroup(selectedGroup);
      // Fetch DIRECTO del servidor (bypass de IndexedDB Firestore)
      const freshGrades = await Store.getGradesByGroupFromServer(selectedGroup);
      // Reconstruir el mapa local de grades para la materia/parcial activos
      grades = {};
      freshGrades.filter(g => g.subjectId === selectedSubject).forEach(g => {
        const key = `${g.studentId}_${g.subjectId}_${g.partial}`;
        grades[key] = g;
      });
      // Recargar el editor (re-render con los datos nuevos)
      const partials = await Store.getPartials(true);
      _renderGradeEditor(partials);
      Toast.show('✓ Datos refrescados desde el servidor', 'success');
    } catch (e) {
      console.error('refreshFromServer:', e);
      Toast.show('Error al refrescar: ' + (e.message || ''), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  }

  const api = {
    renderTeacher, renderAdmin, openGradeEditor,
    switchPartial, saveGrades, exportGrades,
    printGrades, printAdminGrades, setPendingOpen,
    refreshFromServer,
    // Expuesta para que el dashboard del maestro pueda imprimir TODAS sus listas
    // sin pasar por la vista de Capturar Calificaciones.
    printMultipleAssignments,
  };
  return api;
})();

// Self-register routes
Router.modules['my-grades'] = () => GradesModule.renderTeacher();
Router.modules['grades-admin'] = () => GradesModule.renderAdmin();
