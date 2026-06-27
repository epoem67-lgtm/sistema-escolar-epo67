/**
 * MÓDULO: CONSULTA DE CALIFICACIONES (solo lectura)
 * EPO 67 — Sistema Escolar
 *
 * Permite a maestros, administrativos y directivos consultar calificaciones
 * en cualquier momento — incluso después del cierre del parcial — SIN poder
 * editar nada. Útil cuando un papá viene a reclamar y necesitas verificar
 * datos rápido sin abrir captura ni arriesgar cambios accidentales.
 *
 * Filtros cascada: turno → grado → grupo → materia → parcial.
 */

const GradesQueryModule = (() => {
  const db = firebase.firestore();

  const state = {
    turno: '',
    grado: '',
    grupoId: '',
    materiaId: '',
    parcialId: '',
    students: [],
    grades: [],
    groups: [],
    subjects: [],
    assignments: [],
    // Restricciones por rol
    role: '',
    fullAccess: false,
    isMaestro: false,
    isOrientador: false,
    orientadorGroupIds: new Set(),
    teacherGroupIds: new Set(),
  };

  const S = (v) => Utils.sanitize(String(v ?? ''));

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando...')}</div>`;

    // ─── Acceso por rol ───
    const role = App.currentUser?.role || '';
    state.role = role;
    state.fullAccess = ['admin', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'].includes(role);
    state.isMaestro = role === 'maestro' || role === 'orientador_docente';
    state.isOrientador = role === 'orientador' || role === 'orientador_docente';

    try {
      // v8.09: usar getOwnAssignments() para maestros (incluye Jessica),
      // y getAssignments() para roles con acceso completo. Así Jessica
      // en su rol maestro ve solo sus 4 materias, no las 216 de toda la escuela.
      const myAssignmentsPromise = state.fullAccess
        ? Store.getAssignments()
        : Store.getOwnAssignments();
      const [groups, subjects, assignments] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        myAssignmentsPromise,
      ]);
      state.subjects = subjects;
      state.assignments = assignments || [];

      if (state.fullAccess) {
        state.groups = groups;
      } else {
        // Maestro/Orientador: filtrar grupos
        state.teacherGroupIds = new Set(state.assignments.map(a => a.groupId));
        if (state.isOrientador) {
          try {
            const orientGroups = await Store.getOrientadorGroups();
            (orientGroups || []).forEach(gid => state.orientadorGroupIds.add(gid));
          } catch (e) { console.warn('No se pudieron cargar grupos de orientador:', e.message); }
        }
        const allowed = new Set([...state.teacherGroupIds, ...state.orientadorGroupIds]);
        state.groups = groups.filter(g => allowed.has(g.id));
      }
    } catch (e) {
      container.innerHTML = `<div class="module-container">${UI.errorState(e.message)}</div>`;
      return;
    }

    // ─── UI condicional según rol ───
    if (state.fullAccess) {
      _renderFilterBarFullAccess(container);
      _bindFiltersFullAccess();
    } else {
      _renderFilterBarSimple(container);
      _bindFiltersSimple();
    }
  }

  // ─── UI: Admin / Directivos / Secretarios — cascada completa ───
  function _renderFilterBarFullAccess(container) {
    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Consulta de Calificaciones</h1>
        <p class="module-subtitle">Consulta de calificaciones capturadas en cualquier momento. Esta vista es <strong>solo lectura</strong>.</p>

        <div class="card" style="background:#eff6ff;border-left:4px solid #3182ce;margin-bottom:16px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <span class="material-icons-round" style="color:#3182ce;font-size:24px;">visibility</span>
            <div style="font-size:13px;color:#1e293b;">
              <strong>Modo solo consulta:</strong> Si necesitas <em>cambiar</em> una calificación, ve a "Cambios de Calificación" y crea una solicitud formal.
            </div>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
            <div class="form-group">
              <label>Turno</label>
              <select id="gq-turno">
                <option value="">Selecciona...</option>
                ${K.TURNOS.map(t => `<option value="${S(t)}">${S(t)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Grado</label>
              <select id="gq-grado" disabled>
                <option value="">Selecciona...</option>
                ${K.GRADOS.map(g => `<option value="${S(g)}">${S(g)}°</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Grupo</label>
              <select id="gq-grupo" disabled><option value="">Selecciona...</option></select>
            </div>
            <div class="form-group">
              <label>Materia</label>
              <select id="gq-materia" disabled><option value="">Selecciona...</option></select>
            </div>
            <div class="form-group">
              <label>Parcial</label>
              <select id="gq-parcial" disabled>
                <option value="">Todos los parciales</option>
                ${K.PARCIALES.map(p => `<option value="${S(p.id)}">${S(p.nombre)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div id="gq-results"></div>
      </div>`;
  }

  // ─── UI: Maestros y Orientadores — selector simple de mis asignaciones ───
  function _renderFilterBarSimple(container) {
    // Construir lista de "opciones de consulta":
    //  - Para maestro: cada asignación (groupId + subjectId)
    //  - Para orientador: cada (grupo donde es orientador × cada materia del grado de ese grupo)
    const opciones = [];

    // Asignaciones propias (como maestro)
    state.assignments.forEach(a => {
      opciones.push({
        id: `asg:${a.groupId}:${a.subjectId}`,
        groupId: a.groupId,
        subjectId: a.subjectId,
        groupName: a.groupName,
        subjectName: K.getUACNombre(a.subjectName),
        turno: a.turno,
        grado: a.grado,
        rolEnGrupo: 'docente',
      });
    });

    // Grupos como orientador (todas las materias del grado)
    state.orientadorGroupIds.forEach(gid => {
      const grupo = state.groups.find(g => g.id === gid);
      if (!grupo) return;
      const materiasDelGrado = state.subjects.filter(s => String(s.grado) === String(grupo.grado));
      materiasDelGrado.forEach(m => {
        // Evitar duplicados si ya está como asignación
        const alreadyExists = opciones.some(o => o.groupId === gid && o.subjectId === m.id);
        if (alreadyExists) return;
        opciones.push({
          id: `ori:${gid}:${m.id}`,
          groupId: gid,
          subjectId: m.id,
          groupName: grupo.nombre,
          subjectName: K.getUACNombre(m.nombre),
          turno: grupo.turno,
          grado: grupo.grado,
          rolEnGrupo: 'orientador',
        });
      });
    });

    // Ordenar por turno → grado → grupo → materia (orden SEP por grado)
    const _sepIdx = (name, grado) => {
      const order = (K.SUBJECT_ORDER && K.SUBJECT_ORDER[Number(grado)]) || [];
      const i = order.findIndex(n => K.normalizeSubjectName ? K.normalizeSubjectName(n) === K.normalizeSubjectName(name) : n === name);
      return i === -1 ? 9999 : i;
    };
    opciones.sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') ||
      (Number(a.grado) || 0) - (Number(b.grado) || 0) ||
      (a.groupName || '').localeCompare(b.groupName || '') ||
      (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
      (a.subjectName || '').localeCompare(b.subjectName || '')
    );

    state._opciones = opciones;

    if (opciones.length === 0) {
      container.innerHTML = `
        <div class="module-container">
          <h1 class="module-title">Consulta de Calificaciones</h1>
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">block</span>
            <p class="empty-state-text">No tienes acceso a consultar calificaciones. Contacta a la administración.</p>
          </div>
        </div>`;
      return;
    }

    const accessMsg = state.isOrientador && state.orientadorGroupIds.size > 0
      ? `Puedes consultar las materias y grupos que tienes asignados, y todas las materias de los grupos donde eres orientador.`
      : `Puedes consultar las materias y grupos que tienes asignados.`;

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Consulta de Calificaciones</h1>
        <p class="module-subtitle">Vista de <strong>solo lectura</strong> en cualquier momento.</p>

        <div class="card" style="background:#eff6ff;border-left:4px solid #3182ce;margin-bottom:16px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <span class="material-icons-round" style="color:#3182ce;font-size:24px;">visibility</span>
            <div style="font-size:13px;color:#1e293b;">
              ${accessMsg} Si necesitas cambiar una calificación, ve a "Cambios de Calificación".
            </div>
          </div>
        </div>

        <div class="card">
          <div class="form-group" style="max-width:600px;">
            <label style="font-size:14px;font-weight:700;color:#1e293b;">¿Qué grupo y materia quieres consultar?</label>
            <select id="gq-asg" style="width:100%;padding:12px;font-size:15px;border:2px solid #cbd5e0;border-radius:8px;background:#fff;cursor:pointer;">
              <option value="">— Selecciona —</option>
              ${opciones.map(o => `
                <option value="${S(o.id)}">${S(o.groupName)} · ${S(o.subjectName)} · ${S(o.turno)}${o.rolEnGrupo === 'orientador' ? ' (como orientador)' : ''}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group" style="max-width:300px;margin-top:12px;">
            <label style="font-size:13px;font-weight:600;color:#475569;">Parcial (opcional)</label>
            <select id="gq-parcial" disabled style="width:100%;padding:8px;font-size:14px;border:1px solid #cbd5e0;border-radius:6px;">
              <option value="">Todos los parciales (P1, P2, P3)</option>
              ${K.PARCIALES.map(p => `<option value="${S(p.id)}">${S(p.nombre)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="gq-results"></div>
      </div>`;
  }

  // ─── Eventos: cascada FULL ACCESS ───
  function _bindFiltersFullAccess() {
    _bindFilters();
  }

  // ─── Eventos: selector simple ───
  function _bindFiltersSimple() {
    const asgEl = document.getElementById('gq-asg');
    const parcialEl = document.getElementById('gq-parcial');
    if (!asgEl) return;

    asgEl.addEventListener('change', () => {
      const opt = state._opciones.find(o => o.id === asgEl.value);
      if (!opt) {
        state.grupoId = state.materiaId = '';
        parcialEl.disabled = true;
        _clearResults();
        return;
      }
      state.grupoId = opt.groupId;
      state.materiaId = opt.subjectId;
      parcialEl.disabled = false;
      _loadAndRender();
    });

    parcialEl.addEventListener('change', () => {
      state.parcialId = parcialEl.value;
      if (state.grupoId && state.materiaId) _loadAndRender();
    });
  }

  function _bindFilters() {
    const turnoEl = document.getElementById('gq-turno');
    const gradoEl = document.getElementById('gq-grado');
    const grupoEl = document.getElementById('gq-grupo');
    const materiaEl = document.getElementById('gq-materia');
    const parcialEl = document.getElementById('gq-parcial');

    turnoEl.addEventListener('change', () => {
      state.turno = turnoEl.value;
      state.grado = ''; state.grupoId = ''; state.materiaId = '';
      gradoEl.disabled = !state.turno;
      grupoEl.disabled = true; materiaEl.disabled = true; parcialEl.disabled = true;
      gradoEl.value = ''; grupoEl.value = ''; materiaEl.value = ''; parcialEl.value = '';
      _clearResults();
    });

    gradoEl.addEventListener('change', () => {
      state.grado = gradoEl.value;
      state.grupoId = ''; state.materiaId = '';
      const grupos = state.groups.filter(g =>
        g.turno === state.turno && String(g.grado) === String(state.grado)
      ).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      grupoEl.innerHTML = '<option value="">Selecciona...</option>' +
        grupos.map(g => `<option value="${S(g.id)}">${S(g.nombre)}</option>`).join('');
      grupoEl.disabled = grupos.length === 0;
      materiaEl.disabled = true; parcialEl.disabled = true;
      _clearResults();
    });

    grupoEl.addEventListener('change', () => {
      state.grupoId = grupoEl.value;
      state.materiaId = '';
      const grupo = state.groups.find(g => g.id === state.grupoId);
      const grado = grupo ? grupo.grado : null;
      let materias = state.subjects.filter(s => String(s.grado) === String(grado));

      // ─── Filtrar materias segun rol ───
      // Si NO es full access:
      //   - Si es orientador del grupo: ve TODAS las materias del grupo
      //   - Si es maestro de este grupo (pero no orientador): ve SOLO las materias que tiene asignadas
      if (!state.fullAccess && state.grupoId) {
        const isOrientadorOfGroup = state.orientadorGroupIds.has(state.grupoId);
        if (!isOrientadorOfGroup) {
          // Maestro: solo materias de sus asignaciones en ESTE grupo
          const mySubjectIds = new Set(
            state.assignments
              .filter(a => a.groupId === state.grupoId)
              .map(a => a.subjectId)
          );
          materias = materias.filter(m => mySubjectIds.has(m.id));
        }
        // Si es orientador del grupo: deja todas las materias
      }

      // Orden oficial SEP del grado (en vez de alfabético)
      materias = K.sortSubjectsByGrado(materias, Number(grado));
      materiaEl.innerHTML = '<option value="">Selecciona...</option>' +
        materias.map(m => `<option value="${S(m.id)}">${S(K.getUACNombre(m.nombre))}</option>`).join('');
      materiaEl.disabled = materias.length === 0;
      parcialEl.disabled = true;
      _clearResults();
    });

    materiaEl.addEventListener('change', () => {
      state.materiaId = materiaEl.value;
      parcialEl.disabled = !state.materiaId;
      if (state.materiaId) _loadAndRender();
      else _clearResults();
    });

    parcialEl.addEventListener('change', () => {
      state.parcialId = parcialEl.value;
      _loadAndRender();
    });
  }

  function _clearResults() {
    const el = document.getElementById('gq-results');
    if (el) el.innerHTML = '';
  }

  async function _loadAndRender() {
    const root = document.getElementById('gq-results');
    if (!root) return;
    if (!state.grupoId || !state.materiaId) return;

    root.innerHTML = `<div class="card">${UI.loadingState('Cargando calificaciones...')}</div>`;

    try {
      const [students, allGrades] = await Promise.all([
        Store.getStudentsByGroup(state.grupoId),
        state.parcialId
          ? Store.getGradesByGroupAndPartial(state.grupoId, state.parcialId, true)
          : Store.getGradesByGroup(state.grupoId, true),
      ]);

      state.students = (students || [])
        .filter(s => {
          const e = (s.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      state.grades = (allGrades || []).filter(g =>
        g.subjectId === state.materiaId &&
        (!state.parcialId || g.partial === state.parcialId)
      );

      _renderResults();
    } catch (e) {
      root.innerHTML = `<div class="card">${UI.errorState(e.message)}</div>`;
    }
  }

  function _renderResults() {
    const root = document.getElementById('gq-results');
    if (!root) return;

    const grupo = state.groups.find(g => g.id === state.grupoId);
    const materia = state.subjects.find(s => s.id === state.materiaId);

    if (!state.students.length) {
      root.innerHTML = `<div class="card">${UI.emptyState('No hay alumnos en este grupo.')}</div>`;
      return;
    }

    // Map: studentId -> { p1, p2, p3, faltas_p1, ... }
    const byStudent = {};
    state.students.forEach(s => {
      const sid = s.docId || s.id;
      byStudent[sid] = { p1: null, p2: null, p3: null, f1: 0, f2: 0, f3: 0, suma: 0, count: 0 };
    });
    state.grades.forEach(g => {
      const sid = g.studentId;
      if (!byStudent[sid]) return;
      const p = g.partial; // 'p1','p2','p3' o 'P1' etc.
      const key = (p || '').toLowerCase().replace(/[^p123]/g, '');
      const faltasKey = 'f' + key.replace('p', '');
      const cal = g.cal !== undefined && g.cal !== null && g.cal !== '' ? Number(g.cal) : null;
      if (cal !== null && !isNaN(cal)) {
        byStudent[sid][key] = cal;
        byStudent[sid].suma += cal;
        byStudent[sid].count += 1;
      }
      if (g.faltas !== undefined) byStudent[sid][faltasKey] = Number(g.faltas) || 0;
    });

    // Si hay parcial específico mostrar columna única, si no mostrar 3 parciales
    const showAllPartials = !state.parcialId;

    const headerCells = showAllPartials
      ? `
        <th style="text-align:center;width:60px;">P1</th>
        <th style="text-align:center;width:60px;">P2</th>
        <th style="text-align:center;width:60px;">P3</th>
        <th style="text-align:center;width:80px;">Promedio</th>
        <th style="text-align:center;width:60px;">Faltas</th>`
      : `
        <th style="text-align:center;width:80px;">Calificación</th>
        <th style="text-align:center;width:80px;">Faltas</th>`;

    const rows = state.students.map((s, i) => {
      const sid = s.docId || s.id;
      const d = byStudent[sid];
      const fmt = (n) => n === null || n === undefined ? '<span style="color:#888;">—</span>' :
        `<span style="font-weight:700;color:${n < 6 ? '#dc2626' : '#16a34a'};">${n}</span>`;
      let cells = '';
      if (showAllPartials) {
        const promedio = d.count > 0 ? (d.suma / d.count).toFixed(1) : '—';
        cells = `
          <td style="text-align:center;">${fmt(d.p1)}</td>
          <td style="text-align:center;">${fmt(d.p2)}</td>
          <td style="text-align:center;">${fmt(d.p3)}</td>
          <td style="text-align:center;font-weight:700;">${promedio}</td>
          <td style="text-align:center;">${(d.f1 || 0) + (d.f2 || 0) + (d.f3 || 0)}</td>`;
      } else {
        const k = (state.parcialId || '').toLowerCase().replace(/[^p123]/g, '');
        const fk = 'f' + k.replace('p', '');
        cells = `
          <td style="text-align:center;">${fmt(d[k])}</td>
          <td style="text-align:center;">${d[fk] || 0}</td>`;
      }
      return `<tr>
        <td style="text-align:center;color:#888;width:40px;">${i + 1}</td>
        <td>${S(Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto)}</td>
        ${cells}
      </tr>`;
    }).join('');

    // Stats
    const aprobados = state.students.filter(s => {
      const sid = s.docId || s.id;
      const d = byStudent[sid];
      if (showAllPartials) return d.count > 0 && (d.suma / d.count) >= 6;
      const k = (state.parcialId || '').toLowerCase().replace(/[^p123]/g, '');
      return d[k] !== null && d[k] >= 6;
    }).length;
    const reprobados = state.students.filter(s => {
      const sid = s.docId || s.id;
      const d = byStudent[sid];
      if (showAllPartials) return d.count > 0 && (d.suma / d.count) < 6;
      const k = (state.parcialId || '').toLowerCase().replace(/[^p123]/g, '');
      return d[k] !== null && d[k] < 6;
    }).length;
    const sinCaptura = state.students.length - aprobados - reprobados;

    root.innerHTML = `
      <div class="card" style="background:#f8fafc;margin-bottom:8px;">
        <h3 class="section-title" style="margin:0 0 6px 0;">
          ${S(grupo?.nombre || '')} · ${S(K.getUACNombre(materia?.nombre || ''))}
          ${state.parcialId ? ' · ' + S(K.PARCIALES.find(p => p.id === state.parcialId)?.nombre || '') : ''}
        </h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#475569;">
          <span><strong>${state.students.length}</strong> alumnos</span>
          <span style="color:#16a34a;"><strong>${aprobados}</strong> aprobados</span>
          <span style="color:#dc2626;"><strong>${reprobados}</strong> reprobados</span>
          <span style="color:#888;"><strong>${sinCaptura}</strong> sin captura</span>
        </div>
      </div>

      <div class="table-container">
        <table class="table-light" style="font-size:13px;">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th>Nombre del alumno</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  return { render };
})();

Router.modules['grades-query'] = () => GradesQueryModule.render();
