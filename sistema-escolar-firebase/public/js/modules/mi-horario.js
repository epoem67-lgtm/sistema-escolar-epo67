/**
 * MI HORARIO — panel del DOCENTE (Sistema Escolar EPO 67)
 *
 * Autoservicio: cada maestro marca su propia DISPONIBILIDAD en una rejilla
 * igual a la "PROPUESTA HORARIO PERSONAL" oficial (Disponible / Talleres /
 * No disponible), viendo las asignaciones que tendrá el semestre. Con eso,
 * Dirección ubica los horarios en el módulo "Horarios".
 *
 * Escribe SU PROPIO doc teacherScheduleRequests/{teacherId} (firestore.rules
 * permite al maestro escribir el suyo). Usa merge:true para no borrar la
 * prioridad que ponga Dirección. También muestra su horario ya asignado
 * (scheduleEntries) en solo lectura.
 */

const MiHorarioModule = (() => {
  'use strict';

  let _teacherId = null;
  let _teacher = null;
  let _asg = [];
  let _req = null;
  let _grid = null;
  let _myEntries = [];
  let _avail = new Map();     // `${turno}|${dia}|${n}` -> 'disp'|'taller'
  let _bound = false;

  // ─── Helpers de jornada ────────────────────────────────────
  function _dias() { return (_grid && _grid.dias) || K.HORARIOS.DIAS; }
  function _modulos(turno) {
    if (_grid && _grid.turnos && Array.isArray(_grid.turnos[turno])) return _grid.turnos[turno];
    return K.HORARIOS.DEFAULT_MODULOS[turno] || K.HORARIOS.DEFAULT_MODULOS.MATUTINO;
  }
  function _teachingModulos(turno) { return _modulos(turno).filter(m => !m.receso); }

  function _turnos() {
    const set = new Set();
    (_asg || []).forEach(a => { if (a.turno) set.add(a.turno); });
    _myEntries.forEach(e => { if (e.turno) set.add(e.turno); });
    if (_teacher && _teacher.turno === 'AMBOS') { set.add('MATUTINO'); set.add('VESPERTINO'); }
    else if (_teacher && _teacher.turno) set.add(_teacher.turno);
    if (!set.size) set.add('MATUTINO');
    return K.TURNOS.filter(t => set.has(t));
  }

  // ─── Carga ─────────────────────────────────────────────────
  async function _load() {
    _teacherId = await Store.getTeacherDocId();
    if (!_teacherId) return false;
    const [asg, teacherSnap, reqSnap, gridSnap, entriesSnap] = await Promise.all([
      Store.getOwnAssignments(),
      DB.doc('teachers', _teacherId).get(),
      DB.doc('teacherScheduleRequests', _teacherId).get(),
      DB.doc('config', 'scheduleGrid').get(),
      db.collection('scheduleEntries').where('teacherId', '==', _teacherId).get(),
    ]);
    _asg = asg || [];
    _teacher = teacherSnap.exists ? teacherSnap.data() : { nombre: App.currentUser?.displayName || '', turno: '' };
    _req = reqSnap.exists ? reqSnap.data() : null;
    _myEntries = entriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const defGrid = () => ({
      dias: K.HORARIOS.DIAS.map(d => ({ ...d })),
      turnos: { MATUTINO: K.HORARIOS.DEFAULT_MODULOS.MATUTINO.map(m => ({ ...m })), VESPERTINO: K.HORARIOS.DEFAULT_MODULOS.VESPERTINO.map(m => ({ ...m })) },
    });
    if (gridSnap.exists) {
      const g = gridSnap.data(); const d = defGrid();
      _grid = {
        dias: (Array.isArray(g.dias) && g.dias.length) ? g.dias : d.dias,
        turnos: {
          MATUTINO: (g.turnos && Array.isArray(g.turnos.MATUTINO) && g.turnos.MATUTINO.length) ? g.turnos.MATUTINO : d.turnos.MATUTINO,
          VESPERTINO: (g.turnos && Array.isArray(g.turnos.VESPERTINO) && g.turnos.VESPERTINO.length) ? g.turnos.VESPERTINO : d.turnos.VESPERTINO,
        },
      };
    } else _grid = defGrid();

    _avail = new Map();
    if (_req && Array.isArray(_req.disponibilidad)) {
      for (const s of _req.disponibilidad) _avail.set(`${s.turno}|${s.dia}|${Number(s.modulo)}`, s.estado || 'disp');
    }
    return true;
  }

  // ─── Render ────────────────────────────────────────────────
  function _render(container) {
    if (!_teacherId) {
      container.innerHTML = UI.moduleContainer(UI.emptyState('badge', 'Este panel es para docentes. Tu cuenta no está enlazada a un registro de maestro; si eres docente, avisa a Dirección para vincular tu cuenta.'));
      return;
    }
    const turnos = _turnos();
    const nombre = Utils.displayName(_teacher.nombre || App.currentUser?.displayName || '');
    const horas = (_req && _req.horasTurno) || {};

    // Encabezado tipo documento oficial.
    const docHeader = `
      <div class="mh-doc-header">
        <div class="mh-doc-title">PROPUESTA DE HORARIO PERSONAL</div>
        <div class="mh-doc-sub">Ciclo escolar 2026–2027 · Primer semestre · EPO 67</div>
        <div class="mh-doc-name"><span>Docente:</span> <strong>${Utils.sanitize(nombre)}</strong></div>
      </div>`;

    // Asignaciones del semestre.
    const asgList = _asg.length
      ? `<ul class="mh-asg-list">${_asg.slice().sort((a, b) => (a.groupName || '').localeCompare(b.groupName || '')).map(a =>
          `<li><span class="mh-asg-grp">${Utils.sanitize(a.groupName || a.groupId)}</span> ${Utils.sanitize(a.subjectName || a.subjectId)} <span class="mh-asg-turno">${Utils.sanitize(a.turno || '')}</span></li>`).join('')}</ul>`
      : `<p class="sch-muted">Aún no tienes materias asignadas para este semestre. Puedes marcar tu disponibilidad de todas formas.</p>`;

    // Rejilla(s) de disponibilidad editables.
    const grids = turnos.map(turno => _renderDispGrid(turno, horas[turno])).join('');

    // Horario ya asignado (solo lectura).
    const assigned = _myEntries.length ? turnos.map(t => _renderAssignedGrid(t)).join('') : `<p class="sch-muted">Dirección aún no ha ubicado tu horario. Cuando lo haga, aparecerá aquí.</p>`;

    container.innerHTML = UI.moduleContainer(`
      ${UI.pageHeader('Mi Horario', 'Marca tu disponibilidad para el próximo semestre. Dirección la usará para ubicar tus clases sin empalmes.')}
      ${docHeader}

      <div class="card mh-card">
        <div class="card-header"><h3 class="card-title">Mis asignaciones del semestre (${_asg.length})</h3></div>
        <div class="mh-card-body">${asgList}</div>
      </div>

      <div class="card mh-card">
        <div class="card-header"><h3 class="card-title">Mi disponibilidad</h3></div>
        <div class="mh-card-body">
          <p class="sch-disp-hint">Haz clic en cada casilla para cambiar:
            <span class="sch-dot avail-disp"></span> Disponible →
            <span class="sch-dot avail-taller"></span> Talleres →
            <span class="sch-dot avail-no"></span> No disponible</p>
          ${grids}
          <div class="mh-fields">
            <label class="sch-check"><input type="checkbox" id="mh-dos" ${_req && _req.dosPlanteles ? 'checked' : ''}> Trabajo en dos planteles</label>
            <div class="form-group" id="mh-otro-wrap" style="${_req && _req.dosPlanteles ? '' : 'display:none;'}">
              <label for="mh-otro">Otro plantel (nombre y días/horario allá)</label>
              <input type="text" id="mh-otro" value="${Utils.sanitize((_req && _req.otroPlantel) || '')}" placeholder="Ej. EPO 45 — matutino lunes y miércoles">
            </div>
            <div class="form-group">
              <label for="mh-nec">Observaciones / necesidades específicas</label>
              <textarea id="mh-nec" rows="2" placeholder="Ej. entro 2ª hora los martes por traslado">${Utils.sanitize((_req && _req.necesidades) || '')}</textarea>
            </div>
          </div>
          <div class="mh-save"><button class="btn btn-success" data-action="mh-save"><span class="material-icons-round">save</span> Guardar mi disponibilidad</button>
            ${_req && _req.updatedAt ? '<span class="sch-muted mh-saved">Ya tienes disponibilidad guardada. Puedes actualizarla.</span>' : ''}</div>
        </div>
      </div>

      <div class="card mh-card">
        <div class="card-header"><h3 class="card-title">Mi horario asignado</h3></div>
        <div class="mh-card-body">${assigned}</div>
      </div>
    `);
  }

  function _renderDispGrid(turno, horasVal) {
    const dias = _dias();
    const mods = _modulos(turno);
    const head = `<tr><th class="sch-modcol">Horario</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;
    const rows = mods.map(m => {
      if (m.receso) return `<tr class="sch-receso-row"><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th><td class="sch-receso" colspan="${dias.length}">RECESO</td></tr>`;
      const cells = dias.map(d => {
        const est = _avail.get(`${turno}|${d.id}|${m.n}`) || 'no';
        return `<td class="mh-cell"><button type="button" class="sch-disp-cell avail-${est}" data-turno="${turno}" data-dia="${d.id}" data-n="${m.n}" data-est="${est}">${_dispLabel(est)}</button></td>`;
      }).join('');
      return `<tr><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>${cells}</tr>`;
    }).join('');
    return `<div class="mh-turno-block">
      <div class="mh-turno-head"><h4 class="sch-turno-title">${turno}</h4>
        <div class="form-group sch-hrs"><label>No. de Hrs</label><input type="number" min="0" max="40" class="sch-hrs-input" data-turno="${turno}" value="${horasVal != null ? horasVal : ''}"></div>
      </div>
      <div class="sch-grid-wrap"><table class="sch-grid sch-grid-${turno.toLowerCase()}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }

  function _renderAssignedGrid(turno) {
    const byslot = new Map();
    _myEntries.filter(e => e.turno === turno).forEach(e => byslot.set(`${e.dia}|${e.modulo}`, e));
    if (![..._myEntries].some(e => e.turno === turno)) return '';
    const dias = _dias();
    const mods = _modulos(turno);
    const head = `<tr><th class="sch-modcol">Horario</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;
    const rows = mods.map(m => {
      if (m.receso) return `<tr class="sch-receso-row"><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th><td class="sch-receso" colspan="${dias.length}">RECESO</td></tr>`;
      const cells = dias.map(d => {
        const e = byslot.get(`${d.id}|${m.n}`);
        if (e) return `<td class="sch-cell filled"><div class="sch-cell-subject">${Utils.sanitize(e.subjectName || e.subjectId)}</div><div class="sch-cell-teacher">${Utils.sanitize(e.groupName || e.groupId)}</div></td>`;
        return `<td class="sch-cell empty"></td>`;
      }).join('');
      return `<tr><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>${cells}</tr>`;
    }).join('');
    return `<h4 class="sch-turno-title">${turno}</h4><div class="sch-grid-wrap"><table class="sch-grid sch-grid-${turno.toLowerCase()}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  function _dispLabel(est) { return est === 'disp' ? '✓' : (est === 'taller' ? '🛠' : '·'); }

  // ─── Guardar ───────────────────────────────────────────────
  async function _save() {
    const disponibilidad = [...document.querySelectorAll('#moduleContainer .sch-disp-cell')]
      .filter(c => c.dataset.est !== 'no')
      .map(c => ({ turno: c.dataset.turno, dia: c.dataset.dia, modulo: Number(c.dataset.n), estado: c.dataset.est }));
    const horasTurno = {};
    document.querySelectorAll('#moduleContainer .sch-hrs-input').forEach(inp => { if (inp.value !== '') horasTurno[inp.dataset.turno] = Number(inp.value) || 0; });
    const dosPlanteles = !!document.getElementById('mh-dos')?.checked;
    const payload = {
      teacherId: _teacherId,
      teacherName: _teacher.nombre || App.currentUser?.displayName || '',
      disponibilidad, horasTurno,
      dosPlanteles,
      otroPlantel: dosPlanteles ? (document.getElementById('mh-otro')?.value || '').trim() : '',
      necesidades: (document.getElementById('mh-nec')?.value || '').trim(),
      updatedAt: DB.timestamp(),
      updatedBy: auth.currentUser.uid,
      updatedByName: App.currentUser?.displayName || App.currentUser?.email || '',
      reportedBySelf: true,
    };
    const btn = document.querySelector('[data-action="mh-save"]');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Guardando…'; }
    try {
      // merge:true → no pisa la prioridad que ponga Dirección.
      await DB.doc('teacherScheduleRequests', _teacherId).set(payload, { merge: true });
      DB.audit('editar', 'configuración', 'teacherScheduleRequests/' + _teacherId, { description: `Docente reportó su disponibilidad: ${disponibilidad.filter(d => d.estado === 'disp').length} h disponibles` });
      _req = Object.assign({}, _req, payload);
      _avail = new Map();
      disponibilidad.forEach(s => _avail.set(`${s.turno}|${s.dia}|${s.modulo}`, s.estado));
      Store.invalidate('teacherRequests');
      Toast.show('✓ Tu disponibilidad se guardó. ¡Gracias!', 'success');
    } catch (e) {
      console.error('[mi-horario] guardar:', e);
      Toast.show('No se pudo guardar: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-round">save</span> Guardar mi disponibilidad'; }
    }
  }

  // ─── Eventos ───────────────────────────────────────────────
  function _bindEvents() {
    if (_bound) return;
    _bound = true;
    const root = document.getElementById('moduleContainer');
    if (!root) return;
    root.addEventListener('click', (e) => {
      const cell = e.target.closest('.sch-disp-cell');
      if (cell) {
        const order = ['disp', 'taller', 'no'];
        const next = order[(order.indexOf(cell.dataset.est || 'no') + 1) % order.length];
        cell.dataset.est = next;
        cell.className = `sch-disp-cell avail-${next}`;
        cell.textContent = _dispLabel(next);
        return;
      }
      const el = e.target.closest('[data-action]');
      if (el && el.dataset.action === 'mh-save') _save();
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'mh-dos') { const w = document.getElementById('mh-otro-wrap'); if (w) w.style.display = e.target.checked ? '' : 'none'; }
    });
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando tu horario…');
    try {
      await _load();
      _bindEvents();
      _render(container);
    } catch (e) {
      console.error('[mi-horario] render:', e);
      container.innerHTML = UI.errorState('No se pudo cargar tu horario: ' + (e.message || e));
    }
  }

  return { render };
})();

Router.modules['mi-horario'] = () => MiHorarioModule.render();
