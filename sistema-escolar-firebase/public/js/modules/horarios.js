/**
 * HORARIOS — Sistema Escolar EPO 67
 *
 * Arma el horario semanal SIN contraposiciones. Flujo centrado en el MAESTRO,
 * como llegan las propuestas oficiales ("PROPUESTA HORARIO PERSONAL"):
 *
 *   1) Cada maestro reporta su DISPONIBILIDAD por celda (día × módulo):
 *      Disponible / Talleres / No disponible. Se captura en la pestaña
 *      "Disponibilidad".
 *   2) En "Asignar por maestro" eliges un maestro y UNA de sus clases
 *      (grupo + materia); el sistema ILUMINA EN VERDE las celdas donde SÍ
 *      puede ir esa clase = el maestro está disponible + el maestro está libre
 *      + el grupo está libre. Haces clic y queda colocada.
 *   3) La rejilla por grupo permite ver/editar el horario grupo por grupo.
 *
 * DETECCIÓN DE CHOQUES:
 *   - Un MAESTRO no puede estar en dos grupos a la misma hora (choque duro).
 *   - Un GRUPO no puede tener dos clases en el mismo módulo (celda única).
 *   - Se avisa cuando la hora está marcada como No disponible / Talleres.
 *
 * MODELO DE DATOS (colecciones nuevas):
 *   config/scheduleGrid                 — jornada (días + módulos por turno)
 *   scheduleEntries/{groupId__DIA__Mn}  — una celda ocupada del horario
 *   teacherScheduleRequests/{teacherId} — disponibilidad + datos del maestro
 *
 * Permisos (firestore.rules): escribe admin/subdirector; directivo solo lectura.
 */

const HorariosModule = (() => {
  'use strict';

  // ─── Estado privado ────────────────────────────────────────
  let _state = {
    tab: 'maestro',       // 'maestro' | 'grupo' | 'disponibilidad' | 'jornada'
    turno: 'MATUTINO',
    groupId: null,
    teacherId: null,
    placingKey: null,     // `${groupId}||${subjectId}` de la clase que se está colocando
  };
  let _grid = null;
  let _groups = [];
  let _subjects = [];
  let _teachers = [];
  let _assignments = [];
  let _entries = [];
  let _requests = [];
  // Índices derivados
  let _byGroupSlot = new Map();     // `${groupId}|${dia}|${n}` -> entry
  let _byTeacherSlot = new Map();   // `${teacherId}|${dia}|${n}` -> [entries]
  let _reqByTeacher = new Map();    // teacherId -> request
  let _availByTeacher = new Map();  // teacherId -> Map(`${turno}|${dia}|${n}` -> 'disp'|'taller')

  const _canEdit = () => App.canActAs('admin') || App.canActAs('subdirector');

  // ─── Helpers de jornada ────────────────────────────────────
  function _dias() { return (_grid && _grid.dias) || K.HORARIOS.DIAS; }
  function _modulos(turno) {
    if (_grid && _grid.turnos && Array.isArray(_grid.turnos[turno])) return _grid.turnos[turno];
    return K.HORARIOS.DEFAULT_MODULOS[turno] || K.HORARIOS.DEFAULT_MODULOS.MATUTINO;
  }
  function _teachingModulos(turno) { return _modulos(turno).filter(m => !m.receso); }
  function _entryDocId(groupId, dia, n) { return `${groupId}__${dia}__M${n}`; }
  function _diaLabel(id) { const d = _dias().find(x => x.id === id); return d ? d.label : id; }

  // ─── Carga de datos ────────────────────────────────────────
  async function _loadData(force) {
    const [groups, subjects, teachers, assignments, entries, requests, gridSnap] = await Promise.all([
      Store.getGroups(force),
      Store.getSubjects(force),
      Store.getTeachers(force),
      Store.getAssignments(force),
      Store.getScheduleEntries(force),
      Store.getTeacherRequests(force),
      DB.doc('config', 'scheduleGrid').get(),
    ]);

    _groups = (groups || []).filter(g => (g.status || 'active') === 'active');
    _subjects = subjects || [];
    _teachers = (teachers || []).filter(t => (t.status || 'active') === 'active');
    _assignments = assignments || [];
    _entries = entries || [];
    _requests = requests || [];

    const defGrid = () => ({
      dias: K.HORARIOS.DIAS.map(d => ({ ...d })),
      turnos: {
        MATUTINO: K.HORARIOS.DEFAULT_MODULOS.MATUTINO.map(m => ({ ...m })),
        VESPERTINO: K.HORARIOS.DEFAULT_MODULOS.VESPERTINO.map(m => ({ ...m })),
      },
    });
    if (gridSnap && gridSnap.exists) {
      const g = gridSnap.data();
      const d = defGrid();
      _grid = {
        dias: (Array.isArray(g.dias) && g.dias.length) ? g.dias : d.dias,
        turnos: {
          MATUTINO: (g.turnos && Array.isArray(g.turnos.MATUTINO) && g.turnos.MATUTINO.length) ? g.turnos.MATUTINO : d.turnos.MATUTINO,
          VESPERTINO: (g.turnos && Array.isArray(g.turnos.VESPERTINO) && g.turnos.VESPERTINO.length) ? g.turnos.VESPERTINO : d.turnos.VESPERTINO,
        },
      };
    } else {
      _grid = defGrid();
    }
    _rebuildIndices();
  }

  function _rebuildIndices() {
    _byGroupSlot = new Map();
    _byTeacherSlot = new Map();
    _reqByTeacher = new Map();
    _availByTeacher = new Map();
    for (const e of _entries) {
      _byGroupSlot.set(`${e.groupId}|${e.dia}|${e.modulo}`, e);
      const tk = `${e.teacherId}|${e.dia}|${e.modulo}`;
      if (!_byTeacherSlot.has(tk)) _byTeacherSlot.set(tk, []);
      _byTeacherSlot.get(tk).push(e);
    }
    for (const r of _requests) {
      const tid = r.teacherId || r.id;
      _reqByTeacher.set(tid, r);
      if (Array.isArray(r.disponibilidad)) {
        const m = new Map();
        for (const s of r.disponibilidad) m.set(`${s.turno}|${s.dia}|${Number(s.modulo)}`, s.estado || 'disp');
        _availByTeacher.set(tid, m);
      }
    }
  }

  // ─── Choques y disponibilidad ──────────────────────────────
  function _teacherConflict(teacherId, dia, n, exceptGroupId) {
    const arr = _byTeacherSlot.get(`${teacherId}|${dia}|${n}`) || [];
    return arr.find(e => e.groupId !== exceptGroupId) || null;
  }
  // Estado de disponibilidad reportado: 'disp' | 'taller' | 'no' | 'unknown'.
  function _teacherAvail(teacherId, turno, dia, n) {
    const m = _availByTeacher.get(teacherId);
    if (!m) return 'unknown';           // el maestro no ha reportado nada
    return m.get(`${turno}|${dia}|${n}`) || 'no'; // reportó, pero esta celda no está marcada = no disponible
  }
  function _countTeacherConflicts() {
    let n = 0;
    for (const arr of _byTeacherSlot.values()) {
      const groups = new Set(arr.map(e => e.groupId));
      if (groups.size > 1) n += (groups.size - 1);
    }
    return n;
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER raíz
  // ═══════════════════════════════════════════════════════════
  function _renderShell(container) {
    const conflicts = _countTeacherConflicts();
    const tabs = [
      { id: 'maestro', icon: 'person_pin', label: 'Asignar por maestro' },
      { id: 'grupo', icon: 'grid_on', label: 'Horario por grupo' },
      { id: 'disponibilidad', icon: 'event_available', label: 'Disponibilidad' },
      { id: 'jornada', icon: 'schedule', label: 'Configurar jornada' },
    ];
    const tabsHTML = tabs.map(t => `
      <button class="sch-tab ${_state.tab === t.id ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        <span class="material-icons-round">${t.icon}</span>${t.label}
      </button>`).join('');

    const header = UI.pageHeader(
      'Horarios',
      'Captura la disponibilidad de cada maestro y coloca sus clases: el sistema te muestra en verde las horas donde SÍ puede ir, sin chocar con otros grupos.',
      conflicts > 0 ? `<span class="badge badge-danger" title="Maestros en dos lugares a la vez">${conflicts} choque(s)</span>` : `<span class="badge badge-success">Sin choques</span>`
    );

    let body = '';
    if (_state.tab === 'maestro') body = _renderTeacherEditor();
    else if (_state.tab === 'grupo') body = _renderGroupTab();
    else if (_state.tab === 'disponibilidad') body = _renderDispTab();
    else if (_state.tab === 'jornada') body = _renderJornadaTab();

    container.innerHTML = UI.moduleContainer(`
      ${header}
      <div class="sch-tabs">${tabsHTML}</div>
      <div id="sch-body">${body}</div>
    `);
  }

  function _renderBody() {
    const container = document.getElementById('moduleContainer');
    if (container) _renderShell(container);
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 1 — ASIGNAR POR MAESTRO (editor con sugerencias)
  // ═══════════════════════════════════════════════════════════
  function _renderTeacherEditor() {
    const teachers = _teachers.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    if (!teachers.length) return UI.emptyState('person_off', 'No hay maestros activos.');
    if (!_state.teacherId || !teachers.some(t => t.id === _state.teacherId)) {
      _state.teacherId = teachers[0].id; _state.placingKey = null;
    }
    const teacher = teachers.find(t => t.id === _state.teacherId);
    const opts = teachers.map(t => `<option value="${t.id}" ${t.id === _state.teacherId ? 'selected' : ''}>${Utils.sanitize(Utils.displayName(t.nombre))}</option>`).join('');

    const myAsg = _assignments.filter(a => a.teacherId === _state.teacherId);
    const mine = _entries.filter(e => e.teacherId === _state.teacherId);
    const req = _reqByTeacher.get(_state.teacherId);
    const hasAvail = _availByTeacher.has(_state.teacherId);
    const turnos = _teacherTurnos(_state.teacherId, teacher);

    // Selector de clase a colocar (chips con conteo de horas colocadas).
    let clasesHTML;
    if (!myAsg.length) {
      clasesHTML = `<div class="sch-hint">Este maestro no tiene materias asignadas. Cárgalas en <strong>Docentes y Asignaciones</strong>.</div>`;
    } else {
      const chips = myAsg.map(a => {
        const key = `${a.groupId}||${a.subjectId}`;
        const puestas = mine.filter(e => e.groupId === a.groupId && e.subjectId === a.subjectId).length;
        const active = _state.placingKey === key ? 'active' : '';
        return `<button class="sch-class-chip ${active}" data-action="pick-class" data-key="${key}">
          <span class="sch-class-name">${Utils.sanitize(a.subjectName || a.subjectId)}</span>
          <span class="sch-class-group">${Utils.sanitize(a.groupName || a.groupId)}</span>
          <span class="sch-class-count">${puestas} h</span>
        </button>`;
      }).join('');
      clasesHTML = `
        <div class="sch-class-picker">
          <div class="sch-class-picker-label">${_canEdit() ? 'Elige una clase y haz clic en una celda verde para colocarla:' : 'Clases del maestro:'}</div>
          <div class="sch-class-chips">${chips}</div>
        </div>`;
    }

    const availWarn = !hasAvail
      ? `<div class="sch-warn-soft">Este maestro aún no tiene <strong>disponibilidad</strong> capturada. Puedes colocar en cualquier celda, pero captúrala en la pestaña <strong>Disponibilidad</strong> para que el sistema filtre las opciones.</div>`
      : '';

    const stats = UI.statsGrid([
      { label: 'Horas colocadas', value: mine.length, icon: 'event', colorClass: 'primary' },
      { label: 'Horas declaradas', value: _declaredHours(req, turnos), icon: 'schedule', colorClass: 'success' },
      { label: 'Grupos', value: new Set(mine.map(e => e.groupId)).size, icon: 'groups', colorClass: 'warning' },
      { label: 'Disponibilidad', value: hasAvail ? 'Capturada' : 'Falta', icon: hasAvail ? 'check_circle' : 'error', colorClass: hasAvail ? 'success' : 'danger' },
    ]);

    const grids = turnos.map(tr => _renderTeacherGrid(_state.teacherId, tr, teacher)).join('');

    return `
      <div class="sch-toolbar">
        <div class="form-group sch-select sch-select-wide">
          <label for="sch-teacher">Maestro</label>
          <select id="sch-teacher" data-action="pick-teacher">${opts}</select>
        </div>
        ${_canEdit() ? '' : '<span class="badge badge-inactive">Solo lectura</span>'}
      </div>
      ${stats}
      ${clasesHTML}
      ${availWarn}
      ${_renderLegend(true)}
      ${grids}
    `;
  }

  function _teacherTurnos(teacherId, teacher) {
    const set = new Set([
      ..._assignments.filter(a => a.teacherId === teacherId).map(a => a.turno),
      ..._entries.filter(e => e.teacherId === teacherId).map(e => e.turno),
    ].filter(Boolean));
    if (!set.size) {
      if (teacher && teacher.turno === 'AMBOS') return ['MATUTINO', 'VESPERTINO'];
      if (teacher && teacher.turno) return [teacher.turno];
      return ['MATUTINO'];
    }
    return K.TURNOS.filter(t => set.has(t));
  }

  function _declaredHours(req, turnos) {
    if (!req || !req.horasTurno) return '—';
    let sum = 0, any = false;
    for (const t of turnos) { if (req.horasTurno[t] != null) { sum += Number(req.horasTurno[t]) || 0; any = true; } }
    return any ? sum : '—';
  }

  function _renderTeacherGrid(teacherId, turno, teacher) {
    const dias = _dias();
    const mods = _modulos(turno);
    const placing = _placingInfo();
    const placingHere = placing && placing.turno === turno;

    const head = `<tr><th class="sch-modcol">Módulo</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;
    const rows = mods.map(m => {
      if (m.receso) {
        return `<tr class="sch-receso-row"><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th><td class="sch-receso" colspan="${dias.length}">RECESO</td></tr>`;
      }
      const cells = dias.map(d => _teacherCell(teacherId, turno, d.id, m.n, placingHere ? placing : null)).join('');
      return `<tr><th class="sch-modcol"><div class="sch-mod-n">Módulo ${m.n}</div><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>${cells}</tr>`;
    }).join('');

    const title = _teacherTurnos(teacherId, teacher).length > 1 ? `<h4 class="sch-turno-title">${turno}</h4>` : '';
    return `${title}<div class="sch-grid-wrap"><table class="sch-grid sch-grid-${turno.toLowerCase()}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  // Devuelve la clase que se está colocando + su turno (o null).
  function _placingInfo() {
    if (!_state.placingKey) return null;
    const [groupId, subjectId] = _state.placingKey.split('||');
    const a = _assignments.find(x => x.teacherId === _state.teacherId && x.groupId === groupId && x.subjectId === subjectId);
    if (!a) return null;
    const g = _groups.find(x => x.id === groupId);
    return { asg: a, groupId, subjectId, turno: (g && g.turno) || a.turno };
  }

  function _teacherCell(teacherId, turno, dia, n, placing) {
    const avail = _teacherAvail(teacherId, turno, dia, n);
    const mineHere = (_byTeacherSlot.get(`${teacherId}|${dia}|${n}`) || []).filter(e => e.turno === turno);
    const availCls = `avail-${avail}`;

    // ¿El maestro ya tiene algo aquí?
    if (mineHere.length) {
      const conflict = mineHere.length > 1;
      const isThisClass = placing && mineHere.some(e => e.groupId === placing.groupId && e.subjectId === placing.subjectId);
      const inner = mineHere.map(e => `<div class="sch-cell-subject">${Utils.sanitize(e.subjectName || e.subjectId)}</div><div class="sch-cell-teacher">${Utils.sanitize(e.groupName || e.groupId)}</div>`).join('<hr class="sch-cell-sep">');
      let cls = 'sch-cell filled';
      if (conflict) cls += ' conflict';
      if (isThisClass) cls += ' is-placing';
      const clickable = _canEdit() && isThisClass ? `data-action="tcell-remove" data-dia="${dia}" data-n="${n}" data-turno="${turno}"` : '';
      const rm = (isThisClass && _canEdit()) ? '<span class="sch-cell-rm" title="Quitar">✕</span>' : '';
      return `<td class="${cls}" ${clickable}>${inner}${conflict ? '<span class="sch-cell-warn">⚠ choque</span>' : ''}${rm}</td>`;
    }

    // Celda libre para el maestro.
    if (placing && _canEdit()) {
      // ¿Se puede colocar la clase seleccionada aquí?
      const groupBusy = _byGroupSlot.get(`${placing.groupId}|${dia}|${n}`);
      const reasons = [];
      if (avail === 'no') reasons.push('no disponible');
      if (avail === 'taller') reasons.push('talleres');
      if (groupBusy) reasons.push(`${placing.groupName || placing.groupId} ocupado`);
      if (!reasons.length) {
        return `<td class="sch-cell empty placeable ${availCls}" data-action="tcell-place" data-dia="${dia}" data-n="${n}" title="Colocar ${Utils.sanitize(placing.asg.subjectName || '')} aquí"><span class="sch-cell-place">colocar</span></td>`;
      }
      return `<td class="sch-cell empty blocked-opt ${availCls}" title="${Utils.sanitize(reasons.join(' · '))}"><span class="sch-cell-x">✕</span></td>`;
    }

    // Sin clase seleccionada: solo tinte por disponibilidad.
    const label = avail === 'taller' ? '<span class="sch-cell-tag">taller</span>' : (avail === 'disp' ? '' : '');
    return `<td class="sch-cell empty ${availCls}">${label}</td>`;
  }

  async function _placeTeacherClass(dia, n) {
    const placing = _placingInfo();
    if (!placing || !_canEdit()) return;
    const g = _groups.find(x => x.id === placing.groupId);
    if (!g) return;
    await _writeEntry(g, dia, n, placing.asg, `Asignación por maestro`);
  }

  async function _removeTeacherClass(groupId, dia, n) {
    if (!_canEdit()) return;
    await _deleteEntry(groupId, dia, n);
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 2 — HORARIO POR GRUPO (rejilla editable)
  // ═══════════════════════════════════════════════════════════
  function _renderGroupTab() {
    const groups = _groups.filter(g => g.turno === _state.turno).sort((a, b) => (a.nombre || a.id).localeCompare(b.nombre || b.id));
    if (!_state.groupId || !groups.some(g => g.id === _state.groupId)) _state.groupId = groups.length ? groups[0].id : null;

    const turnoBtns = K.TURNOS.map(t => `<button class="chip ${_state.turno === t ? 'active' : ''}" data-action="turno" data-turno="${t}">${t}</button>`).join('');
    if (!groups.length) return `<div class="sch-toolbar"><div class="sch-chips">${turnoBtns}</div></div>${UI.emptyState('grid_off', 'No hay grupos en este turno.')}`;
    const groupOpts = groups.map(g => `<option value="${g.id}" ${g.id === _state.groupId ? 'selected' : ''}>${Utils.sanitize(g.nombre || g.id)}</option>`).join('');

    return `
      <div class="sch-toolbar">
        <div class="sch-chips">${turnoBtns}</div>
        <div class="form-group sch-select"><label for="sch-group">Grupo</label><select id="sch-group" data-action="pick-group">${groupOpts}</select></div>
        ${_canEdit() ? '' : '<span class="badge badge-inactive">Solo lectura</span>'}
      </div>
      ${_renderLegend(false)}
      ${_renderGroupGrid(_state.groupId)}
      ${_renderGroupSummary(_state.groupId)}
    `;
  }

  function _renderGroupGrid(groupId) {
    const group = _groups.find(g => g.id === groupId);
    if (!group) return UI.emptyState('grid_off', 'Grupo no encontrado.');
    const dias = _dias();
    const mods = _modulos(group.turno);
    const head = `<tr><th class="sch-modcol">Módulo</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;
    const rows = mods.map(m => {
      if (m.receso) return `<tr class="sch-receso-row"><th class="sch-modcol"><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th><td class="sch-receso" colspan="${dias.length}">RECESO</td></tr>`;
      const cells = dias.map(d => {
        const e = _byGroupSlot.get(`${groupId}|${d.id}|${m.n}`);
        if (e) {
          const conflict = _teacherConflict(e.teacherId, d.id, m.n, groupId);
          const cls = conflict ? 'sch-cell filled conflict' : 'sch-cell filled';
          const warn = conflict ? `<span class="sch-cell-warn" title="El maestro también está en ${Utils.sanitize(conflict.groupName || conflict.groupId)}">⚠ choque</span>` : '';
          return `<td class="${cls}" ${_canEdit() ? 'data-action="cell"' : ''} data-dia="${d.id}" data-n="${m.n}">
            <div class="sch-cell-subject">${Utils.sanitize(e.subjectName || e.subjectId)}</div>
            <div class="sch-cell-teacher">${Utils.sanitize(Utils.shortName(e.teacherName))}</div>${warn}</td>`;
        }
        return `<td class="sch-cell empty" ${_canEdit() ? 'data-action="cell"' : ''} data-dia="${d.id}" data-n="${m.n}">${_canEdit() ? '<span class="sch-cell-add">+</span>' : ''}</td>`;
      }).join('');
      return `<tr><th class="sch-modcol"><div class="sch-mod-n">Módulo ${m.n}</div><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>${cells}</tr>`;
    }).join('');
    return `<div class="sch-grid-wrap"><table class="sch-grid sch-grid-${group.turno.toLowerCase()}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  function _renderGroupSummary(groupId) {
    const rows = _entries.filter(e => e.groupId === groupId);
    if (!rows.length) return '';
    const byAsg = new Map();
    for (const e of rows) {
      const k = `${e.subjectId}|${e.teacherId}`;
      if (!byAsg.has(k)) byAsg.set(k, { subjectName: e.subjectName, teacherName: e.teacherName, horas: 0 });
      byAsg.get(k).horas++;
    }
    const items = [...byAsg.values()].sort((a, b) => b.horas - a.horas).map(x => `<tr>
      <td>${Utils.sanitize(x.subjectName || '')}</td><td>${Utils.sanitize(Utils.displayName(x.teacherName))}</td><td class="sch-num">${x.horas}</td></tr>`).join('');
    return `<div class="card sch-summary"><div class="card-header"><h3 class="card-title">Horas colocadas en este grupo — total ${rows.length}</h3></div>
      <table class="data-table"><thead><tr><th>Materia</th><th>Maestro</th><th>Horas/semana</th></tr></thead><tbody>${items}</tbody></table></div>`;
  }

  // ─── Modal: asignar / vaciar una celda (vista por grupo) ───
  function _openCellModal(groupId, dia, n) {
    if (!_canEdit()) return;
    const group = _groups.find(g => g.id === groupId);
    if (!group) return;
    const current = _byGroupSlot.get(`${groupId}|${dia}|${n}`);
    const asgs = _assignments.filter(a => a.groupId === groupId).sort((a, b) => (a.subjectName || '').localeCompare(b.subjectName || ''));
    if (!asgs.length) {
      Modal.open('Sin asignaciones', `<p>El grupo <strong>${Utils.sanitize(group.nombre || groupId)}</strong> no tiene materias asignadas. Cárgalas en <strong>Docentes y Asignaciones</strong>.</p>`, `<button class="btn btn-primary" id="sch-modal-close">Entendido</button>`);
      document.getElementById('sch-modal-close')?.addEventListener('click', () => Modal.close());
      return;
    }
    const opts = asgs.map(a => {
      const conflict = _teacherConflict(a.teacherId, dia, n, groupId);
      const avail = _teacherAvail(a.teacherId, group.turno, dia, n);
      let flag = '';
      if (conflict) flag = ` — ⚠ CHOQUE: ya está en ${conflict.groupName || conflict.groupId}`;
      else if (avail === 'no') flag = ' — ✋ marcó NO disponible';
      else if (avail === 'taller') flag = ' — 🛠 talleres';
      const sel = current && current.subjectId === a.subjectId && current.teacherId === a.teacherId ? 'selected' : '';
      return `<option value="${a.teacherId}||${a.subjectId}" ${sel}>${Utils.sanitize((a.subjectName || a.subjectId) + ' · ' + (a.teacherName || ''))}${Utils.sanitize(flag)}</option>`;
    }).join('');
    const mod = _teachingModulos(group.turno).find(m => m.n === Number(n));
    const timeLbl = mod ? `${mod.inicio}–${mod.fin}` : '';
    const body = `<div class="sch-modal">
      <p class="sch-modal-slot"><strong>${Utils.sanitize(group.nombre || groupId)}</strong> · ${Utils.sanitize(_diaLabel(dia))} · Módulo ${n} <span class="sch-mod-time">${timeLbl}</span></p>
      <div class="form-group"><label for="sch-asg">Materia — Maestro</label><select id="sch-asg">${opts}</select></div>
      <div id="sch-asg-warn" class="sch-modal-warn"></div></div>`;
    const footer = `${current ? '<button class="btn btn-danger" id="sch-clear">Vaciar celda</button>' : ''}
      <button class="btn btn-secondary" id="sch-cancel">Cancelar</button><button class="btn btn-primary" id="sch-save">Guardar</button>`;
    Modal.open('Asignar clase', body, footer);

    const sel = document.getElementById('sch-asg');
    const warnBox = document.getElementById('sch-asg-warn');
    const refresh = () => {
      const [teacherId] = (sel.value || '').split('||');
      const conflict = _teacherConflict(teacherId, dia, n, groupId);
      const avail = _teacherAvail(teacherId, group.turno, dia, n);
      let html = '';
      if (conflict) html += `<div class="sch-warn-hard">⚠ Este maestro ya está en <strong>${Utils.sanitize(conflict.groupName || conflict.groupId)}</strong> a esta hora. Guardar deja un CHOQUE.</div>`;
      if (avail === 'no') html += `<div class="sch-warn-soft">✋ El maestro marcó NO disponible en esta hora.</div>`;
      if (avail === 'taller') html += `<div class="sch-warn-soft">🛠 El maestro tiene TALLERES en esta hora.</div>`;
      if (current) html += `<div class="sch-warn-soft">Esta celda ya tiene <strong>${Utils.sanitize(current.subjectName || '')}</strong>. Guardar la reemplaza.</div>`;
      warnBox.innerHTML = html;
    };
    sel.addEventListener('change', refresh); refresh();
    document.getElementById('sch-cancel')?.addEventListener('click', () => Modal.close());
    document.getElementById('sch-clear')?.addEventListener('click', () => { Modal.close(); _deleteEntry(groupId, dia, n); });
    document.getElementById('sch-save')?.addEventListener('click', () => {
      const [teacherId, subjectId] = (sel.value || '').split('||');
      const a = asgs.find(x => x.teacherId === teacherId && x.subjectId === subjectId);
      if (a) { Modal.close(); _writeEntry(group, dia, n, a, 'Asignación por grupo'); }
    });
  }

  // ─── Escritura/borrado de celdas (compartido) ──────────────
  async function _writeEntry(group, dia, n, asg, motivo) {
    const docId = _entryDocId(group.id, dia, n);
    try {
      await DB.doc('scheduleEntries', docId).set({
        turno: group.turno, groupId: group.id, groupName: group.nombre || group.id, grado: Number(group.grado) || null,
        dia, modulo: Number(n), teacherId: asg.teacherId, teacherName: asg.teacherName || '',
        subjectId: asg.subjectId, subjectName: asg.subjectName || '', updatedAt: DB.timestamp(), updatedBy: auth.currentUser.uid,
      });
      DB.audit('editar', 'horario', docId, { description: `${motivo}: ${group.nombre || group.id} · ${_diaLabel(dia)} M${n}: ${asg.subjectName || asg.subjectId} — ${asg.teacherName || ''}` });
      _upsertLocalEntry({ turno: group.turno, groupId: group.id, groupName: group.nombre || group.id, grado: Number(group.grado) || null, dia, modulo: Number(n), teacherId: asg.teacherId, teacherName: asg.teacherName || '', subjectId: asg.subjectId, subjectName: asg.subjectName || '' });
      Store.invalidateSchedule();
      Toast.show('✓ Clase colocada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] escribir celda:', e);
      Toast.show('Error al guardar: ' + (e.message || e), 'error');
    }
  }

  async function _deleteEntry(groupId, dia, n) {
    const docId = _entryDocId(groupId, dia, n);
    try {
      await DB.doc('scheduleEntries', docId).delete();
      DB.audit('eliminar', 'horario', docId, { description: `Vaciar horario ${groupId} · ${_diaLabel(dia)} M${n}` });
      _entries = _entries.filter(e => !(e.groupId === groupId && e.dia === dia && Number(e.modulo) === Number(n)));
      _rebuildIndices();
      Store.invalidateSchedule();
      Toast.show('Celda vaciada', 'info');
      _renderBody();
    } catch (e) {
      console.error('[horarios] vaciar celda:', e);
      Toast.show('Error al vaciar: ' + (e.message || e), 'error');
    }
  }

  function _upsertLocalEntry(entry) {
    const id = _entryDocId(entry.groupId, entry.dia, entry.modulo);
    _entries = _entries.filter(e => _entryDocId(e.groupId, e.dia, e.modulo) !== id);
    _entries.push({ id, ...entry });
    _rebuildIndices();
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 3 — DISPONIBILIDAD (captura la propuesta del maestro)
  // ═══════════════════════════════════════════════════════════
  function _renderDispTab() {
    const teachers = _teachers.slice().sort((a, b) => {
      const wa = _priorityWeight(_reqByTeacher.get(a.id)), wb = _priorityWeight(_reqByTeacher.get(b.id));
      if (wa !== wb) return wb - wa;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });
    if (!teachers.length) return UI.emptyState('person_off', 'No hay maestros activos.');
    const rows = teachers.map(t => {
      const r = _reqByTeacher.get(t.id);
      const hasAvail = _availByTeacher.has(t.id);
      const dispCount = hasAvail ? [...(_availByTeacher.get(t.id).values())].filter(v => v === 'disp').length : 0;
      return `<tr>
        <td>${Utils.sanitize(Utils.displayName(t.nombre))}</td>
        <td>${Utils.sanitize(t.turno || '')}</td>
        <td>${hasAvail ? `<span class="badge badge-success">${dispCount} h disp.</span>` : '<span class="badge badge-inactive">sin capturar</span>'}</td>
        <td>${r ? _prioridadBadge(r.prioridad) : '<span class="sch-muted">—</span>'}</td>
        <td>${r && r.dosPlanteles ? `<span class="badge badge-warning">Sí</span> <span class="sch-muted">${Utils.sanitize(r.otroPlantel || '')}</span>` : '<span class="sch-muted">—</span>'}</td>
        <td class="sch-necesidades">${Utils.sanitize((r && r.necesidades) ? ((r.necesidades.length > 50 ? r.necesidades.slice(0, 50) + '…' : r.necesidades)) : '')}</td>
        <td>${_canEdit() ? `<button class="btn btn-sm btn-primary" data-action="edit-disp" data-teacher="${t.id}">${hasAvail ? 'Editar' : 'Capturar'}</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `
      <div class="sch-hint">Captura la <strong>disponibilidad</strong> tal como llega en la propuesta de cada maestro (Disponible / Talleres / No disponible), más las horas, dos planteles y prioridad. Los de dos planteles / prioridad alta aparecen arriba.</div>
      <div class="sch-grid-wrap"><table class="data-table sch-req-table">
        <thead><tr><th>Maestro</th><th>Turno</th><th>Disponibilidad</th><th>Prioridad</th><th>Dos planteles</th><th>Necesidades</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }

  function _priorityWeight(r) {
    if (!r) return 0;
    let w = 0;
    if (r.dosPlanteles) w += 10;
    if (r.prioridad === 'alta') w += 3; else if (r.prioridad === 'media') w += 1;
    return w;
  }

  function _openDispModal(teacherId) {
    if (!_canEdit()) return;
    const teacher = _teachers.find(t => t.id === teacherId);
    if (!teacher) return;
    const r = _reqByTeacher.get(teacherId) || {};
    const availMap = _availByTeacher.get(teacherId) || new Map();
    const turnos = _teacherTurnos(teacherId, teacher);
    const prioOpts = K.HORARIOS.PRIORIDADES.map(p => `<option value="${p.id}" ${r.prioridad === p.id ? 'selected' : ''}>${p.label}</option>`).join('');
    const horas = r.horasTurno || {};

    // Rejilla de disponibilidad: cada celda es un botón que cicla disp→taller→no.
    const grids = turnos.map(turno => {
      const dias = _dias();
      const mods = _teachingModulos(turno);
      const head = `<tr><th></th>${dias.map(d => `<th>${d.id}</th>`).join('')}</tr>`;
      const body = mods.map(m => `<tr><th class="sch-req-modh">M${m.n}<br><span class="sch-mod-time">${m.inicio}</span></th>${dias.map(d => {
        const est = availMap.get(`${turno}|${d.id}|${m.n}`) || 'no';
        return `<td><button type="button" class="sch-disp-cell avail-${est}" data-turno="${turno}" data-dia="${d.id}" data-n="${m.n}" data-est="${est}">${_dispCellLabel(est)}</button></td>`;
      }).join('')}</tr>`).join('');
      return `<div class="sch-req-blockwrap">
        <div class="sch-disp-head"><h5>${turno}</h5>
          <div class="form-group sch-hrs"><label>No. de Hrs</label><input type="number" min="0" max="40" class="sch-hrs-input" data-turno="${turno}" value="${horas[turno] != null ? horas[turno] : ''}"></div>
        </div>
        <table class="sch-req-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    }).join('');

    const body = `<div class="sch-modal sch-req-modal">
      <p class="sch-modal-slot"><strong>${Utils.sanitize(Utils.displayName(teacher.nombre))}</strong> · ${Utils.sanitize(teacher.turno || '')}</p>
      <p class="sch-disp-hint">Haz clic en cada celda para cambiar: <span class="sch-dot avail-disp"></span> Disponible → <span class="sch-dot avail-taller"></span> Talleres → <span class="sch-dot avail-no"></span> No disponible</p>
      ${grids}
      <div class="sch-req-row">
        <div class="form-group"><label for="sch-prio">Prioridad</label><select id="sch-prio">${prioOpts}</select></div>
        <div class="form-group sch-check-inline"><label class="sch-check"><input type="checkbox" id="sch-dos" ${r.dosPlanteles ? 'checked' : ''}> Trabaja en dos planteles</label></div>
      </div>
      <div class="form-group" id="sch-otro-wrap" style="${r.dosPlanteles ? '' : 'display:none;'}"><label for="sch-otro">Otro plantel</label><input type="text" id="sch-otro" value="${Utils.sanitize(r.otroPlantel || '')}" placeholder="Ej. EPO 45 — matutino"></div>
      <div class="form-group"><label for="sch-nec">Necesidades / observaciones</label><textarea id="sch-nec" rows="2">${Utils.sanitize(r.necesidades || '')}</textarea></div>
    </div>`;
    const footer = `<button class="btn btn-secondary" id="sch-req-cancel">Cancelar</button><button class="btn btn-primary" id="sch-req-save">Guardar disponibilidad</button>`;
    Modal.open('Disponibilidad del maestro', body, footer);

    // Ciclado de celdas disp→taller→no.
    document.querySelectorAll('.sch-disp-cell').forEach(btn => {
      btn.addEventListener('click', () => {
        const order = ['disp', 'taller', 'no'];
        const cur = btn.dataset.est || 'no';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        btn.dataset.est = next;
        btn.className = `sch-disp-cell avail-${next}`;
        btn.textContent = _dispCellLabel(next);
      });
    });
    document.getElementById('sch-dos')?.addEventListener('change', (e) => { const w = document.getElementById('sch-otro-wrap'); if (w) w.style.display = e.target.checked ? '' : 'none'; });
    document.getElementById('sch-req-cancel')?.addEventListener('click', () => Modal.close());
    document.getElementById('sch-req-save')?.addEventListener('click', () => _saveDisp(teacher));
  }

  function _dispCellLabel(est) { return est === 'disp' ? '✓' : (est === 'taller' ? '🛠' : '·'); }

  async function _saveDisp(teacher) {
    // Disponibilidad: solo guardamos celdas 'disp' y 'taller' (ausencia = no).
    const disponibilidad = [...document.querySelectorAll('.sch-disp-cell')]
      .filter(c => c.dataset.est !== 'no')
      .map(c => ({ turno: c.dataset.turno, dia: c.dataset.dia, modulo: Number(c.dataset.n), estado: c.dataset.est }));
    const horasTurno = {};
    document.querySelectorAll('.sch-hrs-input').forEach(inp => { if (inp.value !== '') horasTurno[inp.dataset.turno] = Number(inp.value) || 0; });
    const dosPlanteles = !!document.getElementById('sch-dos')?.checked;
    const payload = {
      teacherId: teacher.id, teacherName: teacher.nombre || '',
      disponibilidad, horasTurno,
      prioridad: document.getElementById('sch-prio')?.value || 'media',
      dosPlanteles, otroPlantel: dosPlanteles ? (document.getElementById('sch-otro')?.value || '').trim() : '',
      necesidades: (document.getElementById('sch-nec')?.value || '').trim(),
      updatedAt: DB.timestamp(), updatedBy: auth.currentUser.uid, updatedByName: App.currentUser?.displayName || App.currentUser?.email || '',
    };
    const btn = document.getElementById('sch-req-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      await DB.doc('teacherScheduleRequests', teacher.id).set(payload, { merge: true });
      DB.audit('editar', 'configuración', 'teacherScheduleRequests/' + teacher.id, { description: `Disponibilidad de ${teacher.nombre}: ${disponibilidad.filter(d => d.estado === 'disp').length} h disponibles` });
      _requests = _requests.filter(x => (x.teacherId || x.id) !== teacher.id);
      _requests.push({ id: teacher.id, ...payload });
      _rebuildIndices();
      Store.invalidate('teacherRequests');
      Modal.close();
      Toast.show('✓ Disponibilidad guardada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] guardar disponibilidad:', e);
      Toast.show('Error al guardar: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar disponibilidad'; }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 4 — CONFIGURAR JORNADA
  // ═══════════════════════════════════════════════════════════
  function _renderJornadaTab() {
    if (!_canEdit()) return UI.emptyState('lock', 'Solo Dirección (admin/subdirección) puede editar la jornada.');
    const turnoBlocks = K.TURNOS.map(turno => {
      const mods = _modulos(turno);
      const rows = mods.map((m, i) => `<tr data-turno="${turno}" data-idx="${i}">
        <td class="sch-num">${m.receso ? '<span class="badge badge-inactive">receso</span>' : 'M' + m.n}</td>
        <td><input type="time" class="sch-j-inicio" value="${m.inicio}"></td>
        <td><input type="time" class="sch-j-fin" value="${m.fin}"></td>
        <td><input type="checkbox" class="sch-j-receso" ${m.receso ? 'checked' : ''} title="Receso"></td>
        <td><button class="btn btn-sm btn-danger" data-action="jornada-del" data-turno="${turno}" data-idx="${i}" title="Quitar">✕</button></td>
      </tr>`).join('');
      return `<div class="card sch-jornada-card" data-turno="${turno}"><div class="card-header"><h3 class="card-title">${turno}</h3></div>
        <table class="data-table sch-jornada-table"><thead><tr><th>Módulo</th><th>Inicio</th><th>Fin</th><th>Receso</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="sch-jornada-actions"><button class="btn btn-sm btn-outline" data-action="jornada-add" data-turno="${turno}">+ Agregar fila</button></div></div>`;
    }).join('');
    return `<div class="sch-hint">Define los módulos de cada turno (Lun–Vie). Marca "Receso" en las filas de descanso. Los cambios afectan la rejilla de todos los grupos y maestros.</div>
      <div class="sch-jornada-grid">${turnoBlocks}</div>
      <div class="sch-jornada-save"><button class="btn btn-success" data-action="jornada-save"><span class="material-icons-round">save</span> Guardar jornada</button></div>`;
  }

  function _readJornadaFromDOM() {
    const out = { MATUTINO: [], VESPERTINO: [] };
    K.TURNOS.forEach(turno => {
      const card = document.querySelector(`.sch-jornada-card[data-turno="${turno}"]`);
      if (!card) { out[turno] = _modulos(turno).map(m => ({ ...m })); return; }
      let nCount = 0;
      out[turno] = [...card.querySelectorAll('tbody tr')].map(tr => {
        const receso = !!tr.querySelector('.sch-j-receso')?.checked;
        const base = { inicio: tr.querySelector('.sch-j-inicio')?.value || '00:00', fin: tr.querySelector('.sch-j-fin')?.value || '00:00' };
        return receso ? { ...base, receso: true } : { ...base, n: ++nCount };
      });
    });
    return out;
  }

  async function _saveJornada() {
    const turnos = _readJornadaFromDOM();
    if (!turnos.MATUTINO.length && !turnos.VESPERTINO.length) { Toast.show('Debe haber al menos un módulo', 'warning'); return; }
    const dias = _dias().map(d => ({ id: d.id, label: d.label }));
    try {
      await DB.doc('config', 'scheduleGrid').set({ dias, turnos, updatedAt: DB.timestamp(), updatedBy: auth.currentUser.uid }, { merge: true });
      DB.audit('editar', 'configuración', 'scheduleGrid', { description: `Jornada actualizada: ${turnos.MATUTINO.filter(m => !m.receso).length} módulos matutino, ${turnos.VESPERTINO.filter(m => !m.receso).length} vespertino` });
      _grid = { dias, turnos };
      Toast.show('✓ Jornada guardada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] guardar jornada:', e);
      Toast.show('Error al guardar jornada: ' + (e.message || e), 'error');
    }
  }

  function _jornadaAdd(turno) {
    const dom = _readJornadaFromDOM();
    const last = dom[turno][dom[turno].length - 1];
    dom[turno].push({ inicio: last ? last.fin : '07:00', fin: last ? last.fin : '07:50', n: dom[turno].filter(m => !m.receso).length + 1 });
    _grid.turnos.MATUTINO = dom.MATUTINO; _grid.turnos.VESPERTINO = dom.VESPERTINO;
    _renderBody();
  }
  function _jornadaDel(turno, idx) {
    const dom = _readJornadaFromDOM();
    dom[turno].splice(Number(idx), 1);
    _grid.turnos.MATUTINO = dom.MATUTINO; _grid.turnos.VESPERTINO = dom.VESPERTINO;
    _renderBody();
  }

  // ─── UI helpers ────────────────────────────────────────────
  function _renderLegend(withAvail) {
    const avail = withAvail ? `
      <span class="sch-leg"><i class="sch-sw sw-disp"></i> Disponible</span>
      <span class="sch-leg"><i class="sch-sw sw-taller"></i> Talleres</span>
      <span class="sch-leg"><i class="sch-sw sw-no"></i> No disponible</span>
      <span class="sch-leg"><i class="sch-sw sw-place"></i> Se puede colocar aquí</span>` : `
      <span class="sch-leg"><i class="sch-sw sw-filled"></i> Asignado</span>
      <span class="sch-leg"><i class="sch-sw sw-empty"></i> Libre</span>`;
    return `<div class="sch-legend">${avail}<span class="sch-leg"><i class="sch-sw sw-conflict"></i> Choque de maestro</span></div>`;
  }
  function _prioridadBadge(prio) {
    const p = K.HORARIOS.PRIORIDADES.find(x => x.id === prio);
    if (!p) return '<span class="badge badge-inactive">media</span>';
    const type = prio === 'alta' ? 'danger' : (prio === 'media' ? 'warning' : 'inactive');
    return `<span class="badge badge-${type}">${p.label}</span>`;
  }

  // ─── Eventos (delegación, una sola vez) ────────────────────
  let _bound = false;
  function _bindEvents() {
    if (_bound) return;
    _bound = true;
    const root = document.getElementById('moduleContainer');
    if (!root) return;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'tab') { _state.tab = el.dataset.tab; _renderBody(); }
      else if (a === 'turno') { _state.turno = el.dataset.turno; _state.groupId = null; _renderBody(); }
      else if (a === 'cell') { _openCellModal(_state.groupId, el.dataset.dia, Number(el.dataset.n)); }
      else if (a === 'pick-class') { _state.placingKey = (_state.placingKey === el.dataset.key) ? null : el.dataset.key; _renderBody(); }
      else if (a === 'tcell-place') { _placeTeacherClass(el.dataset.dia, Number(el.dataset.n)); }
      else if (a === 'tcell-remove') { _removeTeacherClass(_placingInfo()?.groupId, el.dataset.dia, Number(el.dataset.n)); }
      else if (a === 'edit-disp') { _openDispModal(el.dataset.teacher); }
      else if (a === 'jornada-save') { _saveJornada(); }
      else if (a === 'jornada-add') { _jornadaAdd(el.dataset.turno); }
      else if (a === 'jornada-del') { _jornadaDel(el.dataset.turno, el.dataset.idx); }
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'sch-group') { _state.groupId = e.target.value; _renderBody(); }
      else if (e.target.id === 'sch-teacher') { _state.teacherId = e.target.value; _state.placingKey = null; _renderBody(); }
    });
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando horarios…');
    try {
      await _loadData(false);
      _bindEvents();
      _renderShell(container);
    } catch (e) {
      console.error('[horarios] render:', e);
      container.innerHTML = UI.errorState('No se pudo cargar el módulo de horarios: ' + (e.message || e));
    }
  }

  return { render };
})();

Router.modules['horarios'] = () => HorariosModule.render();
