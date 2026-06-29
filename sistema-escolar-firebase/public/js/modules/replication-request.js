/**
 * MÓDULO: Replicación de Calificaciones (Orientadora)
 * EPO 67 — Sistema Escolar
 *
 * Permite a la orientadora SOLICITAR la replicación de las calificaciones de
 * un alumno desde un parcial origen a un parcial destino (cualquier dirección),
 * para una o todas las materias del alumno. La solicitud queda como `pending`
 * en /gradeCorrections y aparece en el panel del subdirector con un folio
 * REP-... agrupado, listo para "Autorizar y aplicar TODAS".
 *
 * Flujo de UX:
 *   1. Selecciona alumno (cascada turno→grupo→alumno, solo sus grupos como orientadora)
 *   2. Selecciona parcial ORIGEN y parcial DESTINO
 *   3. Vista previa: tabla con materias del alumno mostrando cal origen vs cal destino actual,
 *      con checkbox por materia para incluir/excluir
 *   4. Captura motivo + número de oficio que respalda
 *   5. Crea N docs gradeCorrections (uno por materia incluida) con:
 *        status='pending'  source='replication_request'
 *        folio REP-YYYYMMDD-HHMMSS-XXXX (compartido)
 *        partial=destino  currentGrade=cal destino actual  newGrade=cal origen
 *        replicationFrom=parcial origen
 *        rubros=[{ec,tr,pe,ex}]  faltas  suma  (todos del origen)
 *   6. Subdirector ve en su panel "Solicitudes pendientes" y aplica con un solo botón.
 *
 * REGLA EPO 67: la replicación es para casos autorizados por Dirección
 * (reingresos, fallas administrativas, etc.). Por eso requiere ejecución del
 * subdirector — la orientadora solicita pero no aplica directo.
 */

const ReplicationRequestModule = (() => {
  const db = firebase.firestore();
  const S = (v) => Utils.sanitize(String(v ?? ''));

  const state = {
    students: [],          // alumnos accesibles a la orientadora
    groups: [],            // grupos accesibles
    assignments: [],       // assignments para resolver materias del grupo
    subjects: [],
    selectedTurno: '',
    selectedGrado: '',
    selectedGroupId: '',
    selectedStudentId: '',
    selectedPartialOrigen: '',
    selectedPartialDestino: '',
    studentGrades: {},     // { subjectId: { P1, P2, P3 } } del alumno seleccionado
    materiasIncluidas: {}, // { subjectId: true } — qué materias incluir
    motivo: '',
    oficio: '',
    autorizadoPor: '',
  };

  function _genFolio() {
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    const tag = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const uidTail = (firebase.auth().currentUser?.uid || 'xxxx').slice(-4);
    return `REP-${tag}-${uidTail}`;
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Replicación de Calificaciones',
          'Solicita copiar las calificaciones de un parcial a otro para uno o todos los rubros de un alumno. La Subdirección autoriza y aplica.')}

        <div class="card" style="background:#eef2ff;border-left:4px solid #4338ca;margin-bottom:16px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <span class="material-icons-round" style="color:#4338ca;font-size:24px;">info</span>
            <div style="font-size:13px;color:#1e1b4b;line-height:1.5;">
              <strong>¿Cuándo usar este módulo?</strong> Cuando Dirección o Subdirección autoriza —
              por escrito, oficio— que un alumno repita la calificación de un parcial en otro
              (reingresos, ausencias justificadas, errores administrativos). Captura el número de
              oficio para que quede registrado quién autorizó. La aplicación final la hace Subdirección
              desde el panel de Correcciones.
            </div>
          </div>
        </div>

        <div id="rep-step1"></div>
        <div id="rep-step2"></div>
        <div id="rep-step3"></div>
        <div id="rep-mis-solicitudes"></div>
      </div>
    `;

    await _loadData();
    _renderStep1();
    _renderMisSolicitudes();
    _bindGlobalEvents(container);
  }

  async function _loadData() {
    try {
      const [g, s, sub, asgn] = await Promise.all([
        Store.getGroups(true), Store.getStudents(true), Store.getSubjects(true), Store.getAssignments(true),
      ]);
      // Filtrar por grupos de orientadora si aplica (admin/subdirector ven todo)
      const oriGroups = await Store.getOrientadorGroups();
      state.groups = oriGroups ? g.filter(gr => oriGroups.includes(gr.id)) : g;
      state.students = s.filter(st => {
        const e = (st.estatus || '').toString().toUpperCase().trim();
        return e === '' || e === 'ACTIVO';
      });
      state.subjects = sub;
      state.assignments = asgn;
    } catch (e) {
      console.error('Error cargando datos:', e);
      Toast.show('Error al cargar datos: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1 — selección de alumno + parciales
  // ═══════════════════════════════════════════════════════════
  function _renderStep1() {
    const root = document.getElementById('rep-step1');
    if (!root) return;

    const turnos = [...new Set(state.groups.map(g => g.turno))].sort();
    const gradosDelTurno = state.selectedTurno
      ? [...new Set(state.groups.filter(g => g.turno === state.selectedTurno).map(g => g.grado))].sort((a,b)=>a-b)
      : [];
    const gruposDelGrado = state.selectedTurno && state.selectedGrado
      ? state.groups.filter(g => g.turno === state.selectedTurno && String(g.grado) === String(state.selectedGrado))
          .sort((a,b) => (a.nombre || '').localeCompare(b.nombre || ''))
      : [];
    const alumnosDelGrupo = state.selectedGroupId
      ? state.students.filter(s => s.groupId === state.selectedGroupId || s.grupo === state.selectedGroupId)
          .sort((a,b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''))
      : [];

    root.innerHTML = `
      <div class="card filter-bar" style="margin-bottom:16px;">
        <h3 class="section-title" style="margin-top:0;">1. Selecciona alumno y parciales</h3>
        <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
          <div class="form-group">
            <label>Turno</label>
            <select id="rep-turno">
              <option value="">— Selecciona —</option>
              ${turnos.map(t => `<option value="${S(t)}" ${state.selectedTurno===t?'selected':''}>${S(t)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Grado</label>
            <select id="rep-grado" ${!state.selectedTurno?'disabled':''}>
              <option value="">— Selecciona —</option>
              ${gradosDelTurno.map(g => `<option value="${g}" ${String(state.selectedGrado)===String(g)?'selected':''}>${g}° Grado</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Grupo</label>
            <select id="rep-grupo" ${!state.selectedGrado?'disabled':''}>
              <option value="">— Selecciona —</option>
              ${gruposDelGrado.map(g => `<option value="${S(g.id)}" ${state.selectedGroupId===g.id?'selected':''}>${S(g.nombre || g.id)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="grid-column:span 2;">
            <label>Alumno <span style="font-size:11px;color:#64748b;font-weight:400;">(orden: APELLIDOS primero)</span></label>
            <select id="rep-alumno" ${!state.selectedGroupId?'disabled':''} style="font-family:'Inter',sans-serif;">
              <option value="">— Selecciona —</option>
              ${alumnosDelGrupo.map((s,i) => `<option value="${S(s.id)}" ${state.selectedStudentId===s.id?'selected':''}>${(i+1).toString().padStart(2,'0')}. ${S(s.nombreCompleto)}</option>`).join('')}
            </select>
          </div>
        </div>

        ${state.selectedStudentId ? (() => {
          const stu = alumnosDelGrupo.find(s => s.id === state.selectedStudentId);
          if (!stu) return '';
          return `<div style="background:#fef3c7;border:3px solid #d97706;padding:14px 18px;border-radius:8px;margin-top:12px;">
            <div style="font-size:11px;color:#78350f;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">
              ✓ ALUMNO SELECCIONADO — verifica que sea correcto
            </div>
            <div style="font-size:20px;font-weight:900;color:#78350f;line-height:1.2;">
              ${S(stu.nombreCompleto)}
            </div>
            <div style="font-size:12px;color:#92400e;margin-top:4px;">
              ${S(Utils.displayName ? Utils.displayName(stu.nombreCompleto) : stu.nombreCompleto)} · ${S(stu.groupId || stu.grupo)} · NL ${S(stu.numLista || stu.nl || '—')}
            </div>
          </div>`;
        })() : ''}

        <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:8px;">
          <div class="form-group">
            <label>Parcial <strong>ORIGEN</strong> (de dónde copiar)</label>
            <select id="rep-origen" ${!state.selectedStudentId?'disabled':''}>
              <option value="">— Selecciona —</option>
              ${K.PARCIALES.map(p => `<option value="${p.id}" ${state.selectedPartialOrigen===p.id?'selected':''}>${S(p.nombre)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Parcial <strong>DESTINO</strong> (a dónde aplicar)</label>
            <select id="rep-destino" ${!state.selectedPartialOrigen?'disabled':''}>
              <option value="">— Selecciona —</option>
              ${K.PARCIALES.filter(p => p.id !== state.selectedPartialOrigen).map(p => `<option value="${p.id}" ${state.selectedPartialDestino===p.id?'selected':''}>${S(p.nombre)}</option>`).join('')}
            </select>
          </div>
        </div>

        ${state.selectedStudentId && state.selectedPartialOrigen && state.selectedPartialDestino ? `
          <div style="margin-top:12px;">
            <button class="btn btn-primary" data-action="rep-load-preview">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">visibility</span>
              Cargar vista previa
            </button>
          </div>
        ` : ''}
      </div>
    `;

    _bindStep1();
  }

  function _bindStep1() {
    document.getElementById('rep-turno')?.addEventListener('change', (e) => {
      state.selectedTurno = e.target.value;
      state.selectedGrado = ''; state.selectedGroupId = ''; state.selectedStudentId = '';
      state.selectedPartialOrigen = ''; state.selectedPartialDestino = '';
      _clearStep2();
      _renderStep1();
    });
    document.getElementById('rep-grado')?.addEventListener('change', (e) => {
      state.selectedGrado = e.target.value;
      state.selectedGroupId = ''; state.selectedStudentId = '';
      state.selectedPartialOrigen = ''; state.selectedPartialDestino = '';
      _clearStep2();
      _renderStep1();
    });
    document.getElementById('rep-grupo')?.addEventListener('change', (e) => {
      state.selectedGroupId = e.target.value;
      state.selectedStudentId = '';
      state.selectedPartialOrigen = ''; state.selectedPartialDestino = '';
      _clearStep2();
      _renderStep1();
    });
    document.getElementById('rep-alumno')?.addEventListener('change', (e) => {
      state.selectedStudentId = e.target.value;
      state.selectedPartialOrigen = ''; state.selectedPartialDestino = '';
      _clearStep2();
      _renderStep1();
    });
    document.getElementById('rep-origen')?.addEventListener('change', (e) => {
      state.selectedPartialOrigen = e.target.value;
      state.selectedPartialDestino = '';
      _clearStep2();
      _renderStep1();
    });
    document.getElementById('rep-destino')?.addEventListener('change', (e) => {
      state.selectedPartialDestino = e.target.value;
      _clearStep2();
      _renderStep1();
    });
  }

  function _clearStep2() {
    state.studentGrades = {};
    state.materiasIncluidas = {};
    const r2 = document.getElementById('rep-step2');
    if (r2) r2.innerHTML = '';
    const r3 = document.getElementById('rep-step3');
    if (r3) r3.innerHTML = '';
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2 — vista previa de materias + selección
  // ═══════════════════════════════════════════════════════════
  async function _loadPreview() {
    const root2 = document.getElementById('rep-step2');
    if (!root2) return;
    if (!state.selectedStudentId || !state.selectedPartialOrigen || !state.selectedPartialDestino) {
      Toast.show('Selecciona alumno, origen y destino primero', 'warning');
      return;
    }
    if (state.selectedPartialOrigen === state.selectedPartialDestino) {
      Toast.show('El parcial origen y destino no pueden ser iguales', 'warning');
      return;
    }
    root2.innerHTML = `<div class="card">${UI.loadingState('Cargando calificaciones del alumno...')}</div>`;

    try {
      // Cargar grades del grupo (para todas las materias del alumno)
      const gid = state.selectedGroupId;
      const groupGrades = await Store.getGradesByGroup(gid, true);
      state.studentGrades = {};
      groupGrades.forEach(g => {
        if (g.studentId !== state.selectedStudentId) return;
        if (!state.studentGrades[g.subjectId]) state.studentGrades[g.subjectId] = {};
        state.studentGrades[g.subjectId][g.partial] = g;
      });

      // Materias del grupo (vía assignments)
      const groupAsgs = state.assignments.filter(a => a.groupId === gid);
      const subjectIds = [...new Set(groupAsgs.map(a => a.subjectId))];
      const groupInfo = state.groups.find(g => g.id === gid);
      const grado = groupInfo ? Number(groupInfo.grado) : null;
      const groupSubjects = K.sortSubjectsByGrado(
        state.subjects.filter(s => subjectIds.includes(s.id)),
        grado
      );

      _renderStep2(groupSubjects, groupAsgs);
    } catch (e) {
      console.error(e);
      root2.innerHTML = `<div class="card">${UI.errorState('Error al cargar: ' + e.message)}</div>`;
    }
  }

  function _renderStep2(groupSubjects, groupAsgs) {
    const root = document.getElementById('rep-step2');
    if (!root) return;
    const student = state.students.find(s => s.id === state.selectedStudentId);
    const nombreAlumno = student ? (Utils.displayName ? Utils.displayName(student.nombreCompleto) : student.nombreCompleto) : '';
    const origenLbl = K.PARCIALES.find(p => p.id === state.selectedPartialOrigen)?.nombre || state.selectedPartialOrigen;
    const destinoLbl = K.PARCIALES.find(p => p.id === state.selectedPartialDestino)?.nombre || state.selectedPartialDestino;

    // Por default todas las materias incluidas
    if (Object.keys(state.materiasIncluidas).length === 0) {
      groupSubjects.forEach(s => { state.materiasIncluidas[s.id] = true; });
    }

    const rows = groupSubjects.map(subj => {
      const grades = state.studentGrades[subj.id] || {};
      const gOrigen = grades[state.selectedPartialOrigen];
      const gDestino = grades[state.selectedPartialDestino];
      const calOrig = gOrigen?.cal != null ? gOrigen.cal : (gOrigen?.value != null ? gOrigen.value : '—');
      const calDest = gDestino?.cal != null ? gDestino.cal : (gDestino?.value != null ? gDestino.value : '(vacío)');
      const faltasOrig = gOrigen?.faltas != null ? gOrigen.faltas : '—';
      const sumaOrig = gOrigen?.suma != null ? gOrigen.suma : '—';
      const incluida = state.materiasIncluidas[subj.id] !== false;
      const sinOrigen = gOrigen == null || gOrigen.cal == null;

      const teacher = groupAsgs.find(a => a.subjectId === subj.id);
      const teacherName = teacher?.teacherName || '—';

      return `
        <tr style="${sinOrigen ? 'background:#fef9c3;' : ''}">
          <td style="text-align:center;width:30px;">
            <input type="checkbox" class="rep-incluir" data-subject-id="${S(subj.id)}"
              ${incluida ? 'checked' : ''} ${sinOrigen ? 'disabled' : ''}>
          </td>
          <td>
            <div style="font-weight:600;font-size:13px;">${S(K.getUACNombre(subj.nombre || subj.id))}</div>
            <div style="font-size:11px;color:#64748b;">Imparte: ${S(teacherName)}</div>
          </td>
          <td style="text-align:center;font-weight:700;font-size:14px;color:${sinOrigen ? '#a16207' : '#1e40af'};">
            ${S(calOrig)}
          </td>
          <td style="text-align:center;font-size:12px;color:#64748b;">
            ${faltasOrig !== '—' ? faltasOrig + ' falta(s)' : '—'}<br>
            ${sumaOrig !== '—' ? 'suma ' + sumaOrig : ''}
          </td>
          <td style="text-align:center;font-weight:600;font-size:14px;color:#64748b;">
            ${S(calDest)}
          </td>
          <td style="font-size:11px;">
            ${sinOrigen
              ? '<span style="color:#a16207;">⚠️ No hay cal en el parcial origen — no se puede replicar</span>'
              : '<span style="color:#15803d;">Cal, rubros y faltas del origen se copiarán al destino</span>'}
          </td>
        </tr>
      `;
    }).join('');

    const incluidasCount = groupSubjects.filter(s =>
      state.materiasIncluidas[s.id] !== false &&
      state.studentGrades[s.id]?.[state.selectedPartialOrigen]?.cal != null
    ).length;

    root.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h3 class="section-title" style="margin-top:0;">
          2. Vista previa de la replicación
        </h3>
        <div style="background:#f1f5f9;padding:10px 14px;border-radius:6px;margin-bottom:12px;font-size:13px;">
          <strong>Alumno:</strong> ${S(nombreAlumno)} ·
          <strong>${S(origenLbl)}</strong> → <strong>${S(destinoLbl)}</strong>
        </div>

        <div style="overflow-x:auto;">
          <table class="table-light" style="font-size:12px;width:100%;">
            <thead style="background:#1e40af;color:#fff;">
              <tr>
                <th style="text-align:center;width:40px;">Incluir</th>
                <th>Materia</th>
                <th style="text-align:center;width:80px;">Cal en ${S(origenLbl)}</th>
                <th style="text-align:center;width:120px;">Detalle origen</th>
                <th style="text-align:center;width:90px;">Cal actual ${S(destinoLbl)}</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" data-action="rep-select-all">Marcar todas</button>
          <button class="btn btn-outline btn-sm" data-action="rep-select-none">Desmarcar todas</button>
          <span style="margin-left:auto;font-size:13px;color:#475569;padding:6px;">
            <strong>${incluidasCount}</strong> materia(s) seleccionada(s) para replicar
          </span>
        </div>
      </div>
    `;

    // Renderizar step 3 (motivo + oficio + botón)
    _renderStep3(incluidasCount);
    _bindStep2();
  }

  function _bindStep2() {
    document.querySelectorAll('.rep-incluir').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const sid = e.target.dataset.subjectId;
        state.materiasIncluidas[sid] = e.target.checked;
        // re-renderizar para actualizar contador y step3
        const groupAsgs = state.assignments.filter(a => a.groupId === state.selectedGroupId);
        const subjectIds = [...new Set(groupAsgs.map(a => a.subjectId))];
        const groupInfo = state.groups.find(g => g.id === state.selectedGroupId);
        const grado = groupInfo ? Number(groupInfo.grado) : null;
        const groupSubjects = K.sortSubjectsByGrado(
          state.subjects.filter(s => subjectIds.includes(s.id)),
          grado
        );
        _renderStep2(groupSubjects, groupAsgs);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 3 — motivo + oficio + botón Crear solicitud
  // ═══════════════════════════════════════════════════════════
  function _renderStep3(incluidasCount) {
    const root = document.getElementById('rep-step3');
    if (!root) return;
    if (incluidasCount === 0) {
      root.innerHTML = `<div class="card" style="background:#fffbeb;border-left:4px solid #d97706;">
        <p style="margin:0;color:#78350f;">Selecciona al menos una materia para replicar.</p>
      </div>`;
      return;
    }
    root.innerHTML = `
      <div class="card" style="margin-bottom:16px;">
        <h3 class="section-title" style="margin-top:0;">3. Justificación y autorización</h3>
        <div class="form-group">
          <label>Motivo de la replicación *</label>
          <textarea id="rep-motivo" rows="2" placeholder="Ej. Reingreso autorizado; el alumno se reincorporó después del cierre de P1..." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;">${S(state.motivo)}</textarea>
        </div>
        <div class="filter-bar-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group">
            <label>Número de oficio (Dirección) *</label>
            <input type="text" id="rep-oficio" placeholder="Ej. EPO67/2026/123" value="${S(state.oficio)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
          </div>
          <div class="form-group">
            <label>Autorizado por *</label>
            <select id="rep-autoriza" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;">
              <option value="">— Selecciona —</option>
              <option value="director" ${state.autorizadoPor==='director'?'selected':''}>Dirección Escolar</option>
              <option value="subdirector" ${state.autorizadoPor==='subdirector'?'selected':''}>Subdirección Escolar</option>
              <option value="secretario" ${state.autorizadoPor==='secretario'?'selected':''}>Secretaría Escolar</option>
            </select>
          </div>
        </div>
        <div style="margin-top:14px;text-align:right;">
          <button class="btn btn-primary" data-action="rep-submit" style="font-weight:700;">
            <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">send</span>
            Crear solicitud de replicación
          </button>
        </div>
        <div style="margin-top:10px;font-size:12px;color:#64748b;line-height:1.5;">
          La solicitud quedará en estado <strong>pendiente</strong>. Aparece en el panel
          "Correcciones de Calificación" del subdirector para que la <strong>autorice y aplique</strong>
          con un solo clic. Mientras tanto las calificaciones actuales no cambian.
        </div>
      </div>
    `;
    document.getElementById('rep-motivo')?.addEventListener('input', e => { state.motivo = e.target.value; });
    document.getElementById('rep-oficio')?.addEventListener('input', e => { state.oficio = e.target.value; });
    document.getElementById('rep-autoriza')?.addEventListener('change', e => { state.autorizadoPor = e.target.value; });
  }

  // ═══════════════════════════════════════════════════════════
  // SUBMIT — crear los gradeCorrections en pending
  // ═══════════════════════════════════════════════════════════
  async function _submit() {
    if (!state.motivo.trim() || !state.oficio.trim() || !state.autorizadoPor) {
      Toast.show('Captura motivo, oficio y quien autoriza', 'warning');
      return;
    }

    const student = state.students.find(s => s.id === state.selectedStudentId);
    if (!student) { Toast.show('Alumno no encontrado', 'error'); return; }

    const grupo = state.groups.find(g => g.id === state.selectedGroupId);
    const groupAsgs = state.assignments.filter(a => a.groupId === state.selectedGroupId);

    // Materias a incluir (con cal en origen)
    const items = [];
    Object.keys(state.materiasIncluidas).forEach(sid => {
      if (!state.materiasIncluidas[sid]) return;
      const gOrigen = state.studentGrades[sid]?.[state.selectedPartialOrigen];
      if (!gOrigen || gOrigen.cal == null) return;
      const subj = state.subjects.find(s => s.id === sid);
      const asg = groupAsgs.find(a => a.subjectId === sid);
      const gDestino = state.studentGrades[sid]?.[state.selectedPartialDestino];
      items.push({
        subjectId: sid,
        subjectName: subj?.nombre || sid,
        teacherId: asg?.teacherId || '',
        teacherName: asg?.teacherName || '',
        currentGrade: gDestino?.cal != null ? Number(gDestino.cal) : null,
        newGrade: Number(gOrigen.cal),
        rubros: {
          ec: gOrigen.ec != null ? Number(gOrigen.ec) : null,
          tr: gOrigen.tr != null ? Number(gOrigen.tr) : null,
          pe: gOrigen.pe != null ? Number(gOrigen.pe) : null,
          ex: gOrigen.ex != null ? Number(gOrigen.ex) : null,
        },
        faltas: gOrigen.faltas != null ? Number(gOrigen.faltas) : null,
        suma: gOrigen.suma != null ? Number(gOrigen.suma) : null,
      });
    });

    if (items.length === 0) {
      Toast.show('No hay materias con cal en el origen para replicar', 'warning');
      return;
    }

    // Confirmación reforzada — el nombre del alumno en MAYÚSCULAS y al inicio,
    // para evitar errores de selección como el caso Sanchez Ponce vs Segura Zamora.
    if (!confirm(
      `═══════════════════════════════════════\n` +
      `  ¿CONFIRMAS REPLICAR CALIFICACIONES?\n` +
      `═══════════════════════════════════════\n\n` +
      `>>> ALUMNO: ${student.nombreCompleto} <<<\n\n` +
      `Grupo: ${state.selectedGroupId}\n` +
      `Origen → Destino: ${K.PARCIALES.find(p => p.id === state.selectedPartialOrigen)?.nombre} → ` +
      `${K.PARCIALES.find(p => p.id === state.selectedPartialDestino)?.nombre}\n` +
      `Materias a replicar: ${items.length}\n` +
      `Oficio: ${state.oficio}\n` +
      `Autoriza: ${state.autorizadoPor}\n\n` +
      `Si el nombre del alumno NO ES CORRECTO, cancela y revisa el dropdown.\n` +
      `La solicitud quedará pendiente — Subdirección la autoriza y aplica.`
    )) return;

    const folio = _genFolio();
    const uid = firebase.auth().currentUser.uid;
    const myName = App.currentUser?.displayName || App.currentUser?.email || '';
    const now = firebase.firestore.FieldValue.serverTimestamp();

    try {
      const batch = db.batch();
      for (const it of items) {
        const docRef = db.collection('gradeCorrections').doc();
        batch.set(docRef, {
          folio,
          status: 'pending',
          source: 'replication_request',  // distingue del wizard de maestro
          // Datos del alumno y contexto
          studentId: state.selectedStudentId,
          studentName: student.nombreCompleto || '',
          groupId: state.selectedGroupId,
          groupName: grupo?.nombre || '',
          grado: grupo?.grado || null,
          turno: grupo?.turno || '',
          subjectId: it.subjectId,
          subjectName: it.subjectName,
          teacherId: it.teacherId,
          teacherName: it.teacherName,
          partial: state.selectedPartialDestino,   // donde se aplica
          // Datos del cambio
          currentGrade: it.currentGrade,
          newGrade: it.newGrade,
          // Datos extra de REPLICACIÓN — sin ellos no se podría aplicar rubros+faltas
          replicationFromPartial: state.selectedPartialOrigen,
          replicationRubros: it.rubros,            // { ec, tr, pe, ex }
          replicationFaltas: it.faltas,
          replicationSuma: it.suma,
          // Justificación
          reason: state.motivo + ' (Oficio ' + state.oficio + ', autoriza ' + state.autorizadoPor + ')',
          authOficio: state.oficio,
          authorizedByRole: state.autorizadoPor,
          // Quién originó
          requestedBy: uid,
          requestedByName: myName,
          requestedAt: now,
        });
      }
      await batch.commit();
      Toast.show(`Solicitud creada con folio ${folio}. ${items.length} materias enviadas a Subdirección.`, 'success', 6000);

      // Limpiar state y volver a step 1
      state.selectedStudentId = '';
      state.selectedPartialOrigen = '';
      state.selectedPartialDestino = '';
      state.studentGrades = {};
      state.materiasIncluidas = {};
      state.motivo = '';
      state.oficio = '';
      state.autorizadoPor = '';
      _clearStep2();
      _renderStep1();
      _renderMisSolicitudes();
    } catch (e) {
      console.error('Error creando solicitud:', e);
      Toast.show('Error al crear solicitud: ' + e.message, 'error', 8000);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MIS SOLICITUDES — lo que esta orientadora ha solicitado
  // ═══════════════════════════════════════════════════════════
  async function _renderMisSolicitudes() {
    const root = document.getElementById('rep-mis-solicitudes');
    if (!root) return;
    const uid = firebase.auth().currentUser?.uid;
    if (!uid) return;
    try {
      const snap = await db.collection('gradeCorrections')
        .where('requestedBy', '==', uid)
        .where('source', '==', 'replication_request')
        .limit(50)
        .get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Agrupar por folio
      const byFolio = {};
      docs.forEach(d => {
        if (!byFolio[d.folio]) byFolio[d.folio] = [];
        byFolio[d.folio].push(d);
      });
      const folios = Object.entries(byFolio).sort((a, b) => {
        const ta = a[1][0].requestedAt?.toMillis ? a[1][0].requestedAt.toMillis() : 0;
        const tb = b[1][0].requestedAt?.toMillis ? b[1][0].requestedAt.toMillis() : 0;
        return tb - ta;
      });
      if (folios.length === 0) {
        root.innerHTML = `<div class="card" style="margin-top:16px;color:#64748b;font-size:13px;">
          <em>No has creado solicitudes de replicación todavía.</em>
        </div>`;
        return;
      }
      const STATUSES = {
        pending:    { label: 'Pendiente de autorizar',   bg: '#fef3c7', color: '#92400e' },
        applied:    { label: 'Aplicada por Subdirección', bg: '#dcfce7', color: '#14532d' },
        rejected:   { label: 'Rechazada',                 bg: '#fee2e2', color: '#7f1d1d' },
        cancelled:  { label: 'Cancelada',                 bg: '#e2e8f0', color: '#475569' },
      };
      root.innerHTML = `
        <div class="card" style="margin-top:24px;border-top:3px solid #4338ca;">
          <h3 class="section-title" style="margin-top:0;">Mis solicitudes de replicación</h3>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${folios.map(([folio, items]) => {
              const first = items[0];
              const st = STATUSES[first.status] || STATUSES.pending;
              const origenLbl = K.PARCIALES.find(p => p.id === first.replicationFromPartial)?.nombre || first.replicationFromPartial;
              const destinoLbl = K.PARCIALES.find(p => p.id === first.partial)?.nombre || first.partial;
              const reqDate = first.requestedAt?.toDate ? first.requestedAt.toDate().toLocaleString('es-MX') : '';
              return `
                <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                      <strong style="font-size:13px;">${S(folio)}</strong>
                      <span style="background:${st.bg};color:${st.color};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-left:8px;">${S(st.label)}</span>
                    </div>
                    <span style="font-size:11px;color:#64748b;">${S(reqDate)}</span>
                  </div>
                  <div style="font-size:12px;color:#475569;margin-top:4px;">
                    ${S(first.studentName)} · ${S(first.groupName)} · ${S(origenLbl)} → ${S(destinoLbl)} · ${items.length} materia(s)
                  </div>
                  <div style="font-size:11px;color:#64748b;margin-top:2px;">Oficio: ${S(first.authOficio || '—')}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
      `;
    } catch (e) {
      console.warn('No se pudieron cargar mis solicitudes:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EVENT DELEGATION
  // ═══════════════════════════════════════════════════════════
  function _bindGlobalEvents(container) {
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === 'rep-load-preview') await _loadPreview();
      else if (a === 'rep-submit') await _submit();
      else if (a === 'rep-select-all') {
        Object.keys(state.materiasIncluidas).forEach(k => state.materiasIncluidas[k] = true);
        await _loadPreview();
      }
      else if (a === 'rep-select-none') {
        Object.keys(state.materiasIncluidas).forEach(k => state.materiasIncluidas[k] = false);
        await _loadPreview();
      }
    });
  }

  return { render };
})();

Router.modules['replication-request'] = () => ReplicationRequestModule.render();
