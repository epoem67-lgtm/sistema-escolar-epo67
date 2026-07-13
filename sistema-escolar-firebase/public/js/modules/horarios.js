/**
 * HORARIOS — Sistema Escolar EPO 67
 *
 * Arma el horario semanal de cada grupo colocando bloques
 * (maestro + materia) en una rejilla de días × módulos, con DETECCIÓN DE
 * CHOQUES EN VIVO:
 *   - Un MAESTRO no puede estar en dos grupos a la misma hora (choque duro).
 *   - Un GRUPO no puede tener dos materias en el mismo módulo (la celda es
 *     única por diseño: colocar reemplaza, con aviso previo).
 *   - Si el maestro pidió NO tener clase en esa hora (bloqueo), aviso suave.
 *
 * Además captura la SOLICITUD DE HORARIOS de cada maestro (horas que no
 * quiere, si trabaja en dos planteles, prioridad y necesidades) para que
 * Dirección arme respetando esas restricciones.
 *
 * MODELO DE DATOS (colecciones nuevas):
 *   config/scheduleGrid               — la jornada (días + módulos por turno)
 *   scheduleEntries/{groupId__DIA__Mn}— una celda ocupada del horario
 *   teacherScheduleRequests/{teacherId}— solicitud/preferencias del maestro
 *
 * Reutiliza `assignments` (teacher+group+subject) como catálogo de lo que
 * se puede colocar en cada grupo. No inventa asignaciones nuevas.
 *
 * Permisos (firestore.rules):
 *   - scheduleEntries / teacherScheduleRequests: escribe admin/subdirector.
 *   - config/scheduleGrid: escribe admin/subdirector.
 *   - Lectura: cualquier autenticado (a futuro, "Mi horario" para maestros).
 */

const HorariosModule = (() => {
  'use strict';

  // ─── Estado privado ────────────────────────────────────────
  let _state = { tab: 'grupo', turno: 'MATUTINO', groupId: null, teacherId: null };
  let _grid = null;          // { dias:[{id,label}], turnos:{MATUTINO:[mod], VESPERTINO:[mod]} }
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
  let _loaded = false;

  const _canEdit = () => App.canActAs('admin') || App.canActAs('subdirector');

  // ─── Helpers de jornada ────────────────────────────────────
  function _dias() { return (_grid && _grid.dias) || K.HORARIOS.DIAS; }
  function _modulos(turno) {
    if (_grid && _grid.turnos && Array.isArray(_grid.turnos[turno])) return _grid.turnos[turno];
    return K.HORARIOS.DEFAULT_MODULOS[turno] || K.HORARIOS.DEFAULT_MODULOS.MATUTINO;
  }
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

    // Jornada: doc de Firestore o semilla por defecto (K.HORARIOS)
    if (gridSnap && gridSnap.exists) {
      const g = gridSnap.data();
      _grid = {
        dias: (Array.isArray(g.dias) && g.dias.length) ? g.dias : K.HORARIOS.DIAS.map(d => ({ ...d })),
        turnos: {
          MATUTINO: (g.turnos && Array.isArray(g.turnos.MATUTINO)) ? g.turnos.MATUTINO : K.HORARIOS.DEFAULT_MODULOS.MATUTINO.map(m => ({ ...m })),
          VESPERTINO: (g.turnos && Array.isArray(g.turnos.VESPERTINO)) ? g.turnos.VESPERTINO : K.HORARIOS.DEFAULT_MODULOS.VESPERTINO.map(m => ({ ...m })),
        },
      };
    } else {
      _grid = {
        dias: K.HORARIOS.DIAS.map(d => ({ ...d })),
        turnos: {
          MATUTINO: K.HORARIOS.DEFAULT_MODULOS.MATUTINO.map(m => ({ ...m })),
          VESPERTINO: K.HORARIOS.DEFAULT_MODULOS.VESPERTINO.map(m => ({ ...m })),
        },
      };
    }

    _rebuildIndices();
    _loaded = true;
  }

  function _rebuildIndices() {
    _byGroupSlot = new Map();
    _byTeacherSlot = new Map();
    _reqByTeacher = new Map();
    for (const e of _entries) {
      _byGroupSlot.set(`${e.groupId}|${e.dia}|${e.modulo}`, e);
      const tk = `${e.teacherId}|${e.dia}|${e.modulo}`;
      if (!_byTeacherSlot.has(tk)) _byTeacherSlot.set(tk, []);
      _byTeacherSlot.get(tk).push(e);
    }
    for (const r of _requests) _reqByTeacher.set(r.teacherId || r.id, r);
  }

  // ─── Detección de choques y bloqueos ───────────────────────
  // Choque de MAESTRO: ese maestro ya está en OTRO grupo en ese día+módulo.
  function _teacherConflict(teacherId, dia, n, exceptGroupId) {
    const arr = _byTeacherSlot.get(`${teacherId}|${dia}|${n}`) || [];
    return arr.find(e => e.groupId !== exceptGroupId) || null;
  }
  // Bloqueo: el maestro pidió NO tener clase en esa hora (solicitud).
  function _teacherBlocked(teacherId, turno, dia, n) {
    const r = _reqByTeacher.get(teacherId);
    if (!r || !Array.isArray(r.bloqueos)) return false;
    return r.bloqueos.some(b => b.dia === dia && Number(b.modulo) === Number(n) && (!b.turno || b.turno === turno));
  }

  // Cuenta global de choques de maestro (para el resumen).
  function _countTeacherConflicts() {
    let n = 0;
    for (const arr of _byTeacherSlot.values()) {
      const groups = new Set(arr.map(e => e.groupId));
      if (groups.size > 1) n += (groups.size - 1);
    }
    return n;
  }

  // ─── RENDER ────────────────────────────────────────────────
  function _renderShell(container) {
    const conflicts = _countTeacherConflicts();
    const tabs = [
      { id: 'grupo', icon: 'grid_on', label: 'Horario por grupo' },
      { id: 'maestro', icon: 'person', label: 'Horario por maestro' },
      { id: 'solicitudes', icon: 'assignment', label: 'Solicitudes de maestros' },
      { id: 'jornada', icon: 'schedule', label: 'Configurar jornada' },
    ];
    const tabsHTML = tabs.map(t => `
      <button class="sch-tab ${_state.tab === t.id ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
        <span class="material-icons-round">${t.icon}</span>${t.label}
      </button>`).join('');

    const header = UI.pageHeader(
      'Horarios',
      'Arma los horarios semanales sin que se contrapongan. Dirección coloca cada bloque y el sistema avisa los choques al instante.',
      conflicts > 0 ? `<span class="badge badge-danger" title="Maestros en dos lugares a la vez">${conflicts} choque(s) de maestro</span>` : `<span class="badge badge-success">Sin choques</span>`
    );

    let body = '';
    if (_state.tab === 'grupo') body = _renderGroupTab();
    else if (_state.tab === 'maestro') body = _renderTeacherTab();
    else if (_state.tab === 'solicitudes') body = _renderRequestsTab();
    else if (_state.tab === 'jornada') body = _renderJornadaTab();

    container.innerHTML = UI.moduleContainer(`
      ${header}
      <div class="sch-tabs">${tabsHTML}</div>
      <div id="sch-body">${body}</div>
    `);
  }

  function _renderBody() {
    // Re-render solo del cuerpo (sin recargar datos) tras un cambio de estado.
    const container = document.getElementById('moduleContainer');
    if (container) _renderShell(container);
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 1 — HORARIO POR GRUPO (rejilla editable)
  // ═══════════════════════════════════════════════════════════
  function _renderGroupTab() {
    const groups = _groups
      .filter(g => g.turno === _state.turno)
      .sort((a, b) => (a.nombre || a.id).localeCompare(b.nombre || b.id));

    if (!_state.groupId || !groups.some(g => g.id === _state.groupId)) {
      _state.groupId = groups.length ? groups[0].id : null;
    }

    const turnoBtns = K.TURNOS.map(t => `
      <button class="chip ${_state.turno === t ? 'active' : ''}" data-action="turno" data-turno="${t}">${t}</button>`).join('');
    const groupOpts = groups.map(g => `<option value="${g.id}" ${g.id === _state.groupId ? 'selected' : ''}>${Utils.sanitize(g.nombre || g.id)}</option>`).join('');

    if (!groups.length) {
      return `<div class="sch-toolbar"><div class="sch-chips">${turnoBtns}</div></div>${UI.emptyState('grid_off', 'No hay grupos en este turno.')}`;
    }

    const grid = _renderGroupGrid(_state.groupId);
    const summary = _renderGroupSummary(_state.groupId);

    return `
      <div class="sch-toolbar">
        <div class="sch-chips">${turnoBtns}</div>
        <div class="form-group sch-select">
          <label for="sch-group">Grupo</label>
          <select id="sch-group" data-action="pick-group">${groupOpts}</select>
        </div>
        ${_canEdit() ? '' : '<span class="badge badge-inactive">Solo lectura</span>'}
      </div>
      ${_renderLegend()}
      ${grid}
      ${summary}
    `;
  }

  function _renderGroupGrid(groupId) {
    const group = _groups.find(g => g.id === groupId);
    if (!group) return UI.emptyState('grid_off', 'Grupo no encontrado.');
    const dias = _dias();
    const mods = _modulos(group.turno);

    const head = `<tr><th class="sch-modcol">Módulo</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;

    const rows = mods.map(m => {
      const cells = dias.map(d => {
        const e = _byGroupSlot.get(`${groupId}|${d.id}|${m.n}`);
        const blocked = false; // el bloqueo se marca respecto a un maestro; en la celda vacía se evalúa al asignar
        if (e) {
          const conflict = _teacherConflict(e.teacherId, d.id, m.n, groupId);
          const cls = conflict ? 'sch-cell filled conflict' : 'sch-cell filled';
          const warn = conflict
            ? `<span class="sch-cell-warn" title="El maestro también está en ${Utils.sanitize(conflict.groupName || conflict.groupId)} a esta hora">⚠ choque</span>`
            : '';
          return `<td class="${cls}" ${_canEdit() ? 'data-action="cell"' : ''} data-dia="${d.id}" data-n="${m.n}">
            <div class="sch-cell-subject">${Utils.sanitize(e.subjectName || e.subjectId)}</div>
            <div class="sch-cell-teacher">${Utils.sanitize(Utils.shortName ? Utils.shortName(e.teacherName) : e.teacherName)}</div>
            ${warn}
          </td>`;
        }
        return `<td class="sch-cell empty ${blocked ? 'blocked' : ''}" ${_canEdit() ? 'data-action="cell"' : ''} data-dia="${d.id}" data-n="${m.n}">
          ${_canEdit() ? '<span class="sch-cell-add">+</span>' : ''}
        </td>`;
      }).join('');
      return `<tr>
        <th class="sch-modcol"><div class="sch-mod-n">Módulo ${m.n}</div><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>
        ${cells}
      </tr>`;
    }).join('');

    return `<div class="sch-grid-wrap"><table class="sch-grid sch-grid-${group.turno.toLowerCase()}">
      <thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  function _renderGroupSummary(groupId) {
    // Horas colocadas por materia/maestro en este grupo.
    const rows = _entries.filter(e => e.groupId === groupId);
    if (!rows.length) return '';
    const byAsg = new Map();
    for (const e of rows) {
      const k = `${e.subjectId}|${e.teacherId}`;
      if (!byAsg.has(k)) byAsg.set(k, { subjectName: e.subjectName, teacherName: e.teacherName, horas: 0 });
      byAsg.get(k).horas++;
    }
    const list = [...byAsg.values()].sort((a, b) => b.horas - a.horas);
    const total = rows.length;
    const items = list.map(x => `<tr>
      <td>${Utils.sanitize(x.subjectName || '')}</td>
      <td>${Utils.sanitize(Utils.displayName ? Utils.displayName(x.teacherName) : x.teacherName)}</td>
      <td class="sch-num">${x.horas}</td>
    </tr>`).join('');
    return `
      <div class="card sch-summary">
        <div class="card-header"><h3 class="card-title">Horas colocadas en este grupo — total ${total}</h3></div>
        <table class="data-table"><thead><tr><th>Materia</th><th>Maestro</th><th>Horas/semana</th></tr></thead>
        <tbody>${items}</tbody></table>
      </div>`;
  }

  // ─── Modal: asignar / vaciar una celda ─────────────────────
  function _openCellModal(groupId, dia, n) {
    if (!_canEdit()) return;
    const group = _groups.find(g => g.id === groupId);
    if (!group) return;
    const current = _byGroupSlot.get(`${groupId}|${dia}|${n}`);

    // Catálogo: asignaciones de ESTE grupo (maestro + materia).
    const asgs = _assignments
      .filter(a => a.groupId === groupId)
      .sort((a, b) => (a.subjectName || '').localeCompare(b.subjectName || ''));

    if (!asgs.length) {
      Modal.open('Sin asignaciones',
        `<p>El grupo <strong>${Utils.sanitize(group.nombre || groupId)}</strong> no tiene materias asignadas todavía. Asígnalas en <strong>Docentes → Asignaciones</strong> y regresa a armar el horario.</p>`,
        `<button class="btn btn-primary" id="sch-modal-close">Entendido</button>`);
      document.getElementById('sch-modal-close')?.addEventListener('click', () => Modal.close());
      return;
    }

    const opts = asgs.map(a => {
      const conflict = _teacherConflict(a.teacherId, dia, n, groupId);
      const blocked = _teacherBlocked(a.teacherId, group.turno, dia, n);
      let flag = '';
      if (conflict) flag = ` — ⚠ CHOQUE: ya está en ${conflict.groupName || conflict.groupId}`;
      else if (blocked) flag = ' — ✋ pidió no dar clase aquí';
      const sel = current && current.subjectId === a.subjectId && current.teacherId === a.teacherId ? 'selected' : '';
      return `<option value="${a.teacherId}||${a.subjectId}" ${sel}>${Utils.sanitize((a.subjectName || a.subjectId) + ' · ' + (a.teacherName || ''))}${Utils.sanitize(flag)}</option>`;
    }).join('');

    const mod = _modulos(group.turno).find(m => m.n === Number(n));
    const timeLbl = mod ? `${mod.inicio}–${mod.fin}` : '';

    const body = `
      <div class="sch-modal">
        <p class="sch-modal-slot"><strong>${Utils.sanitize(group.nombre || groupId)}</strong> · ${Utils.sanitize(_diaLabel(dia))} · Módulo ${n} <span class="sch-mod-time">${timeLbl}</span></p>
        <div class="form-group">
          <label for="sch-asg">Materia — Maestro</label>
          <select id="sch-asg">${opts}</select>
        </div>
        <div id="sch-asg-warn" class="sch-modal-warn"></div>
      </div>`;
    const footer = `
      ${current ? '<button class="btn btn-danger" id="sch-clear">Vaciar celda</button>' : ''}
      <button class="btn btn-secondary" id="sch-cancel">Cancelar</button>
      <button class="btn btn-primary" id="sch-save">Guardar</button>`;
    Modal.open('Asignar clase', body, footer);

    const sel = document.getElementById('sch-asg');
    const warnBox = document.getElementById('sch-asg-warn');
    const refreshWarn = () => {
      const [teacherId] = (sel.value || '').split('||');
      const conflict = _teacherConflict(teacherId, dia, n, groupId);
      const blocked = _teacherBlocked(teacherId, group.turno, dia, n);
      const alsoGroup = _byGroupSlot.get(`${groupId}|${dia}|${n}`);
      let html = '';
      if (conflict) html += `<div class="sch-warn-hard">⚠ Este maestro ya está en <strong>${Utils.sanitize(conflict.groupName || conflict.groupId)}</strong> (${Utils.sanitize(conflict.subjectName || '')}) en ese mismo día y módulo. Guardar dejará un CHOQUE.</div>`;
      if (blocked) html += `<div class="sch-warn-soft">✋ El maestro pidió NO tener clase en esta hora (ver Solicitudes).</div>`;
      if (alsoGroup) html += `<div class="sch-warn-soft">Esta celda ya tiene <strong>${Utils.sanitize(alsoGroup.subjectName || '')}</strong>. Guardar la reemplaza.</div>`;
      warnBox.innerHTML = html;
    };
    sel.addEventListener('change', refreshWarn);
    refreshWarn();

    document.getElementById('sch-cancel')?.addEventListener('click', () => Modal.close());
    document.getElementById('sch-clear')?.addEventListener('click', () => _clearCell(groupId, dia, n));
    document.getElementById('sch-save')?.addEventListener('click', () => {
      const [teacherId, subjectId] = (sel.value || '').split('||');
      const a = asgs.find(x => x.teacherId === teacherId && x.subjectId === subjectId);
      if (a) _saveCell(group, dia, n, a);
    });
  }

  async function _saveCell(group, dia, n, asg) {
    const docId = _entryDocId(group.id, dia, n);
    const btn = document.getElementById('sch-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      await DB.doc('scheduleEntries', docId).set({
        turno: group.turno,
        groupId: group.id,
        groupName: group.nombre || group.id,
        grado: Number(group.grado) || null,
        dia,
        modulo: Number(n),
        teacherId: asg.teacherId,
        teacherName: asg.teacherName || '',
        subjectId: asg.subjectId,
        subjectName: asg.subjectName || '',
        updatedAt: DB.timestamp(),
        updatedBy: auth.currentUser.uid,
      });
      DB.audit('editar', 'horario', docId, {
        description: `Horario ${group.nombre || group.id} · ${_diaLabel(dia)} M${n}: ${asg.subjectName || asg.subjectId} — ${asg.teacherName || ''}`,
      });
      // Actualiza estado en memoria sin recargar todo Firestore.
      _upsertLocalEntry({
        turno: group.turno, groupId: group.id, groupName: group.nombre || group.id,
        grado: Number(group.grado) || null, dia, modulo: Number(n),
        teacherId: asg.teacherId, teacherName: asg.teacherName || '',
        subjectId: asg.subjectId, subjectName: asg.subjectName || '',
      });
      Store.invalidateSchedule();
      Modal.close();
      Toast.show('✓ Clase asignada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] guardar celda:', e);
      Toast.show('Error al guardar: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
  }

  async function _clearCell(groupId, dia, n) {
    const docId = _entryDocId(groupId, dia, n);
    try {
      await DB.doc('scheduleEntries', docId).delete();
      DB.audit('eliminar', 'horario', docId, { description: `Vaciar horario ${groupId} · ${_diaLabel(dia)} M${n}` });
      _entries = _entries.filter(e => !(e.groupId === groupId && e.dia === dia && Number(e.modulo) === Number(n)));
      _rebuildIndices();
      Store.invalidateSchedule();
      Modal.close();
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
  // TAB 2 — HORARIO POR MAESTRO (consolidado, solo lectura)
  // ═══════════════════════════════════════════════════════════
  function _renderTeacherTab() {
    const teachers = _teachers.slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    if (!teachers.length) return UI.emptyState('person_off', 'No hay maestros activos.');
    if (!_state.teacherId || !teachers.some(t => t.id === _state.teacherId)) _state.teacherId = teachers[0].id;

    const opts = teachers.map(t => `<option value="${t.id}" ${t.id === _state.teacherId ? 'selected' : ''}>${Utils.sanitize(Utils.displayName ? Utils.displayName(t.nombre) : t.nombre)}</option>`).join('');
    const teacher = teachers.find(t => t.id === _state.teacherId);
    const mine = _entries.filter(e => e.teacherId === _state.teacherId);
    const turnos = _teacherTurnos(_state.teacherId, teacher);

    const grids = turnos.map(tr => _renderTeacherGrid(_state.teacherId, tr)).join('');
    const req = _reqByTeacher.get(_state.teacherId);

    const stats = UI.statsGrid([
      { label: 'Horas asignadas', value: mine.length, icon: 'schedule', colorClass: 'primary' },
      { label: 'Grupos', value: new Set(mine.map(e => e.groupId)).size, icon: 'groups', colorClass: 'success' },
      { label: 'Materias', value: new Set(mine.map(e => e.subjectId)).size, icon: 'menu_book', colorClass: 'warning' },
      { label: 'Bloqueos pedidos', value: (req && Array.isArray(req.bloqueos)) ? req.bloqueos.length : 0, icon: 'block', colorClass: 'danger' },
    ]);

    const reqBox = req ? `
      <div class="card sch-summary">
        <div class="card-header"><h3 class="card-title">Solicitud del maestro</h3></div>
        <div class="sch-req-view">
          <p><strong>Prioridad:</strong> ${_prioridadBadge(req.prioridad)}</p>
          ${req.dosPlanteles ? `<p><strong>Dos planteles:</strong> Sí — ${Utils.sanitize(req.otroPlantel || 'otro plantel no especificado')}</p>` : ''}
          ${req.necesidades ? `<p><strong>Necesidades:</strong> ${Utils.sanitize(req.necesidades)}</p>` : ''}
        </div>
      </div>` : `<div class="sch-hint">Este maestro no tiene solicitud capturada. Ve a <strong>Solicitudes de maestros</strong> para registrarla.</div>`;

    return `
      <div class="sch-toolbar">
        <div class="form-group sch-select sch-select-wide">
          <label for="sch-teacher">Maestro</label>
          <select id="sch-teacher" data-action="pick-teacher">${opts}</select>
        </div>
      </div>
      ${stats}
      ${_renderLegend()}
      ${grids || UI.emptyState('event_busy', 'Sin horario asignado todavía.')}
      ${reqBox}
    `;
  }

  function _teacherTurnos(teacherId, teacher) {
    const fromAsg = new Set(_assignments.filter(a => a.teacherId === teacherId).map(a => a.turno).filter(Boolean));
    const fromEntries = new Set(_entries.filter(e => e.teacherId === teacherId).map(e => e.turno).filter(Boolean));
    const set = new Set([...fromAsg, ...fromEntries]);
    if (!set.size) {
      if (teacher && teacher.turno === 'AMBOS') return ['MATUTINO', 'VESPERTINO'];
      if (teacher && teacher.turno) return [teacher.turno];
      return ['MATUTINO'];
    }
    return K.TURNOS.filter(t => set.has(t));
  }

  function _renderTeacherGrid(teacherId, turno) {
    const dias = _dias();
    const mods = _modulos(turno);
    const req = _reqByTeacher.get(teacherId);
    const head = `<tr><th class="sch-modcol">Módulo</th>${dias.map(d => `<th>${Utils.sanitize(d.label)}</th>`).join('')}</tr>`;
    const rows = mods.map(m => {
      const cells = dias.map(d => {
        const arr = (_byTeacherSlot.get(`${teacherId}|${d.id}|${m.n}`) || []).filter(e => e.turno === turno);
        const blocked = _teacherBlocked(teacherId, turno, d.id, m.n);
        if (arr.length) {
          const conflict = arr.length > 1;
          const cls = conflict ? 'sch-cell filled conflict' : 'sch-cell filled';
          const inner = arr.map(e => `<div class="sch-cell-subject">${Utils.sanitize(e.subjectName || e.subjectId)}</div><div class="sch-cell-teacher">${Utils.sanitize(e.groupName || e.groupId)}</div>`).join('<hr class="sch-cell-sep">');
          return `<td class="${cls}">${inner}${conflict ? '<span class="sch-cell-warn">⚠ choque</span>' : ''}</td>`;
        }
        return `<td class="sch-cell empty ${blocked ? 'blocked' : ''}">${blocked ? '<span class="sch-cell-block" title="Pidió no dar clase aquí">✋</span>' : ''}</td>`;
      }).join('');
      return `<tr><th class="sch-modcol"><div class="sch-mod-n">Módulo ${m.n}</div><div class="sch-mod-time">${m.inicio}–${m.fin}</div></th>${cells}</tr>`;
    }).join('');
    return `<h4 class="sch-turno-title">${turno}</h4><div class="sch-grid-wrap"><table class="sch-grid sch-grid-${turno.toLowerCase()}"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 3 — SOLICITUDES DE MAESTROS
  // ═══════════════════════════════════════════════════════════
  function _renderRequestsTab() {
    const teachers = _teachers.slice().sort((a, b) => {
      // Los de dos planteles y prioridad alta arriba (para priorizar al armar).
      const ra = _reqByTeacher.get(a.id), rb = _reqByTeacher.get(b.id);
      const wa = _priorityWeight(ra), wb = _priorityWeight(rb);
      if (wa !== wb) return wb - wa;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });
    if (!teachers.length) return UI.emptyState('person_off', 'No hay maestros activos.');

    const rows = teachers.map(t => {
      const r = _reqByTeacher.get(t.id);
      const bloqueos = (r && Array.isArray(r.bloqueos)) ? r.bloqueos.length : 0;
      const nec = (r && r.necesidades) ? r.necesidades : '';
      return `<tr>
        <td>${Utils.sanitize(Utils.displayName ? Utils.displayName(t.nombre) : t.nombre)}</td>
        <td>${Utils.sanitize(t.turno || '')}</td>
        <td>${r ? _prioridadBadge(r.prioridad) : '<span class="badge badge-inactive">sin capturar</span>'}</td>
        <td>${r && r.dosPlanteles ? `<span class="badge badge-warning">Sí</span> <span class="sch-muted">${Utils.sanitize(r.otroPlantel || '')}</span>` : '<span class="sch-muted">—</span>'}</td>
        <td class="sch-num">${bloqueos || '<span class="sch-muted">0</span>'}</td>
        <td class="sch-necesidades">${Utils.sanitize(nec.length > 60 ? nec.slice(0, 60) + '…' : nec)}</td>
        <td>${_canEdit() ? `<button class="btn btn-sm btn-primary" data-action="edit-request" data-teacher="${t.id}">${r ? 'Editar' : 'Capturar'}</button>` : ''}</td>
      </tr>`;
    }).join('');

    return `
      <div class="sch-hint">Prioriza a los maestros que trabajan en <strong>dos planteles</strong> o con prioridad alta (aparecen arriba). Estos datos aparecen como avisos al colocar clases.</div>
      <div class="sch-grid-wrap"><table class="data-table sch-req-table">
        <thead><tr><th>Maestro</th><th>Turno</th><th>Prioridad</th><th>Dos planteles</th><th>Horas que no quiere</th><th>Necesidades</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  function _priorityWeight(r) {
    if (!r) return 0;
    let w = 0;
    if (r.dosPlanteles) w += 10;
    if (r.prioridad === 'alta') w += 3;
    else if (r.prioridad === 'media') w += 1;
    return w;
  }

  function _openRequestModal(teacherId) {
    if (!_canEdit()) return;
    const teacher = _teachers.find(t => t.id === teacherId);
    if (!teacher) return;
    const r = _reqByTeacher.get(teacherId) || {};
    const bloqueos = Array.isArray(r.bloqueos) ? r.bloqueos.slice() : [];
    const turnos = _teacherTurnos(teacherId, teacher);
    const isBlocked = (turno, dia, n) => bloqueos.some(b => b.turno === turno && b.dia === dia && Number(b.modulo) === Number(n));

    const prioOpts = K.HORARIOS.PRIORIDADES.map(p => `<option value="${p.id}" ${r.prioridad === p.id ? 'selected' : ''}>${p.label}</option>`).join('');

    // Mini-rejilla de bloqueos: casillas por día×módulo por cada turno del maestro.
    const blockGrids = turnos.map(turno => {
      const dias = _dias();
      const mods = _modulos(turno);
      const head = `<tr><th></th>${dias.map(d => `<th>${d.id}</th>`).join('')}</tr>`;
      const rows = mods.map(m => `<tr><th class="sch-req-modh">M${m.n}</th>${dias.map(d => `
        <td><label class="sch-check"><input type="checkbox" class="sch-block-cb" data-turno="${turno}" data-dia="${d.id}" data-n="${m.n}" ${isBlocked(turno, d.id, m.n) ? 'checked' : ''}></label></td>`).join('')}</tr>`).join('');
      return `<div class="sch-req-blockwrap"><h5>${turno} — marca las horas que NO quiere</h5><table class="sch-req-grid"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
    }).join('');

    const body = `
      <div class="sch-modal sch-req-modal">
        <p class="sch-modal-slot"><strong>${Utils.sanitize(Utils.displayName ? Utils.displayName(teacher.nombre) : teacher.nombre)}</strong> · ${Utils.sanitize(teacher.turno || '')}</p>
        <div class="sch-req-row">
          <div class="form-group">
            <label for="sch-prio">Prioridad para acomodar</label>
            <select id="sch-prio">${prioOpts}</select>
          </div>
          <div class="form-group sch-check-inline">
            <label class="sch-check"><input type="checkbox" id="sch-dos" ${r.dosPlanteles ? 'checked' : ''}> Trabaja en dos planteles</label>
          </div>
        </div>
        <div class="form-group" id="sch-otro-wrap" style="${r.dosPlanteles ? '' : 'display:none;'}">
          <label for="sch-otro">Otro plantel (nombre / horario allá)</label>
          <input type="text" id="sch-otro" value="${Utils.sanitize(r.otroPlantel || '')}" placeholder="Ej. EPO 45 — matutino lunes y miércoles">
        </div>
        <div class="form-group">
          <label for="sch-nec">Necesidades específicas</label>
          <textarea id="sch-nec" rows="2" placeholder="Ej. entra 2ª hora los martes por traslado; requiere salir 12:00 los viernes">${Utils.sanitize(r.necesidades || '')}</textarea>
        </div>
        ${blockGrids}
      </div>`;
    const footer = `
      <button class="btn btn-secondary" id="sch-req-cancel">Cancelar</button>
      <button class="btn btn-primary" id="sch-req-save">Guardar solicitud</button>`;
    Modal.open('Solicitud de horario', body, footer);

    document.getElementById('sch-dos')?.addEventListener('change', (e) => {
      const w = document.getElementById('sch-otro-wrap');
      if (w) w.style.display = e.target.checked ? '' : 'none';
    });
    document.getElementById('sch-req-cancel')?.addEventListener('click', () => Modal.close());
    document.getElementById('sch-req-save')?.addEventListener('click', () => _saveRequest(teacher));
  }

  async function _saveRequest(teacher) {
    const bloqueos = [...document.querySelectorAll('.sch-block-cb')]
      .filter(cb => cb.checked)
      .map(cb => ({ turno: cb.dataset.turno, dia: cb.dataset.dia, modulo: Number(cb.dataset.n) }));
    const dosPlanteles = !!document.getElementById('sch-dos')?.checked;
    const payload = {
      teacherId: teacher.id,
      teacherName: teacher.nombre || '',
      prioridad: document.getElementById('sch-prio')?.value || 'media',
      dosPlanteles,
      otroPlantel: dosPlanteles ? (document.getElementById('sch-otro')?.value || '').trim() : '',
      necesidades: (document.getElementById('sch-nec')?.value || '').trim(),
      bloqueos,
      updatedAt: DB.timestamp(),
      updatedBy: auth.currentUser.uid,
      updatedByName: App.currentUser?.displayName || App.currentUser?.email || '',
    };
    const btn = document.getElementById('sch-req-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      await DB.doc('teacherScheduleRequests', teacher.id).set(payload, { merge: true });
      DB.audit('editar', 'configuración', 'teacherScheduleRequests/' + teacher.id, {
        description: `Solicitud de horario de ${teacher.nombre}: prioridad ${payload.prioridad}, ${bloqueos.length} bloqueo(s)${dosPlanteles ? ', dos planteles' : ''}`,
      });
      // Estado local
      _requests = _requests.filter(x => (x.teacherId || x.id) !== teacher.id);
      _requests.push({ id: teacher.id, ...payload });
      _rebuildIndices();
      Store.invalidate('teacherRequests');
      Modal.close();
      Toast.show('✓ Solicitud guardada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] guardar solicitud:', e);
      Toast.show('Error al guardar: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar solicitud'; }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TAB 4 — CONFIGURAR JORNADA
  // ═══════════════════════════════════════════════════════════
  function _renderJornadaTab() {
    if (!_canEdit()) {
      return UI.emptyState('lock', 'Solo Dirección (admin/subdirección) puede editar la jornada.');
    }
    const turnoBlocks = K.TURNOS.map(turno => {
      const mods = _modulos(turno);
      const rows = mods.map((m, i) => `<tr data-turno="${turno}" data-idx="${i}">
        <td class="sch-num">M${m.n}</td>
        <td><input type="time" class="sch-j-inicio" value="${m.inicio}"></td>
        <td><input type="time" class="sch-j-fin" value="${m.fin}"></td>
        <td><button class="btn btn-sm btn-danger" data-action="jornada-del" data-turno="${turno}" data-idx="${i}" title="Quitar módulo">✕</button></td>
      </tr>`).join('');
      return `<div class="card sch-jornada-card" data-turno="${turno}">
        <div class="card-header"><h3 class="card-title">${turno}</h3></div>
        <table class="data-table sch-jornada-table"><thead><tr><th>Módulo</th><th>Inicio</th><th>Fin</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="sch-jornada-actions"><button class="btn btn-sm btn-outline" data-action="jornada-add" data-turno="${turno}">+ Agregar módulo</button></div>
      </div>`;
    }).join('');

    return `
      <div class="sch-hint">Define los módulos (bloques) de cada turno. Días: Lunes a Viernes. Los cambios afectan la rejilla de todos los grupos.</div>
      <div class="sch-jornada-grid">${turnoBlocks}</div>
      <div class="sch-jornada-save"><button class="btn btn-success" data-action="jornada-save"><span class="material-icons-round">save</span> Guardar jornada</button></div>
    `;
  }

  // Lee la jornada editada del DOM (inputs) hacia _grid (sin guardar aún).
  function _readJornadaFromDOM() {
    const out = { MATUTINO: [], VESPERTINO: [] };
    K.TURNOS.forEach(turno => {
      const card = document.querySelector(`.sch-jornada-card[data-turno="${turno}"]`);
      if (!card) { out[turno] = _modulos(turno).map(m => ({ ...m })); return; }
      const trs = [...card.querySelectorAll('tbody tr')];
      out[turno] = trs.map((tr, i) => ({
        n: i + 1,
        inicio: tr.querySelector('.sch-j-inicio')?.value || '00:00',
        fin: tr.querySelector('.sch-j-fin')?.value || '00:00',
      }));
    });
    return out;
  }

  async function _saveJornada() {
    const turnos = _readJornadaFromDOM();
    if (!turnos.MATUTINO.length && !turnos.VESPERTINO.length) {
      Toast.show('Debe haber al menos un módulo', 'warning');
      return;
    }
    const dias = _dias().map(d => ({ id: d.id, label: d.label }));
    try {
      await DB.doc('config', 'scheduleGrid').set({
        dias, turnos, updatedAt: DB.timestamp(), updatedBy: auth.currentUser.uid,
      }, { merge: true });
      DB.audit('editar', 'configuración', 'scheduleGrid', {
        description: `Jornada actualizada: ${turnos.MATUTINO.length} módulos matutino, ${turnos.VESPERTINO.length} vespertino`,
      });
      _grid = { dias, turnos };
      Toast.show('✓ Jornada guardada', 'success');
      _renderBody();
    } catch (e) {
      console.error('[horarios] guardar jornada:', e);
      Toast.show('Error al guardar jornada: ' + (e.message || e), 'error');
    }
  }

  function _jornadaAddModulo(turno) {
    const mods = _readJornadaFromDOM()[turno];
    const last = mods[mods.length - 1];
    mods.push({ n: mods.length + 1, inicio: last ? last.fin : '07:00', fin: last ? last.fin : '07:50' });
    _grid.turnos[turno] = mods;
    // reflejar el otro turno editado también
    _grid.turnos[K.TURNOS.find(t => t !== turno)] = _readJornadaFromDOM()[K.TURNOS.find(t => t !== turno)];
    _renderBody();
  }

  function _jornadaDelModulo(turno, idx) {
    const dom = _readJornadaFromDOM();
    dom[turno].splice(Number(idx), 1);
    dom[turno].forEach((m, i) => m.n = i + 1);
    _grid.turnos.MATUTINO = dom.MATUTINO;
    _grid.turnos.VESPERTINO = dom.VESPERTINO;
    _renderBody();
  }

  // ─── UI helpers ────────────────────────────────────────────
  function _renderLegend() {
    return `<div class="sch-legend">
      <span class="sch-leg"><i class="sch-sw sw-filled"></i> Asignado</span>
      <span class="sch-leg"><i class="sch-sw sw-conflict"></i> Choque de maestro</span>
      <span class="sch-leg"><i class="sch-sw sw-blocked"></i> Hora que el maestro no quiere</span>
      <span class="sch-leg"><i class="sch-sw sw-empty"></i> Libre</span>
    </div>`;
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
      else if (a === 'edit-request') { _openRequestModal(el.dataset.teacher); }
      else if (a === 'jornada-save') { _saveJornada(); }
      else if (a === 'jornada-add') { _jornadaAddModulo(el.dataset.turno); }
      else if (a === 'jornada-del') { _jornadaDelModulo(el.dataset.turno, el.dataset.idx); }
    });

    root.addEventListener('change', (e) => {
      if (e.target.id === 'sch-group' || e.target.dataset.action === 'pick-group') {
        _state.groupId = e.target.value; _renderBody();
      } else if (e.target.id === 'sch-teacher' || e.target.dataset.action === 'pick-teacher') {
        _state.teacherId = e.target.value; _renderBody();
      }
    });
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando horarios…');
    try {
      // Recargar siempre datos de horario frescos al entrar (pueden haber
      // cambiado en otra sesión); grupos/materias usan cache.
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
