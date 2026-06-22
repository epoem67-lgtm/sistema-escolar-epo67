/**
 * EXTRAORDINARIOS — Sistema Escolar EPO 67
 *
 * REDISEÑO v7.55 (mayo 2026): 3 oportunidades oficiales (Gaceta EPO 67).
 *   1ª oportunidad: examen extraordinario regular
 *   2ª oportunidad: para alumnos que NO acreditaron 1ª
 *   3ª oportunidad: para alumnos que NO acreditaron 2ª
 *
 * La calificación del extraordinario SUSTITUYE a la ordinaria. Mínima 5, máxima 10.
 *
 * Esquema Firestore (3 docs SEPARADOS por alumno+materia):
 *   extraordinarios/{studentId}_{subjectId}_1
 *   extraordinarios/{studentId}_{subjectId}_2
 *   extraordinarios/{studentId}_{subjectId}_3
 *
 * Cada doc: {
 *   studentId, studentName, subjectId, subjectName, groupId, groupName,
 *   teacherId, teacherName, oportunidad: 1|2|3,
 *   calOriginal, promedioOriginal,
 *   calExtraordinario: 5..10,
 *   estatus: 'APROBADO' | 'REPROBADO',
 *   fechaAplicacion, fechaCaptura,
 *   comentario, ciclo, updatedBy, updatedByName
 * }
 *
 * SELECCIÓN AUTOMÁTICA DE OPORTUNIDAD ACTIVA:
 *   - Si no hay _1 → captura 1ª
 *   - Si _1.estatus === 'APROBADO' → terminado (no más capturas)
 *   - Si _1.estatus === 'REPROBADO' y no hay _2 → captura 2ª
 *   - Si _2.estatus === 'APROBADO' → terminado
 *   - Si _2.estatus === 'REPROBADO' y no hay _3 → captura 3ª
 *   - Si _3.estatus === 'APROBADO' → terminado
 *   - Si _3.estatus === 'REPROBADO' → terminado (reprobado definitivamente)
 *
 * Scope por rol:
 *   - admin / subdirector / directivo / secretario_* / auditor: TODAS las assignments
 *   - orientador puro: assignments de SUS grupos
 *   - maestro / orientador_docente / presidente_academia: SOLO sus assignments
 *     (puede capturar SOLO en SUS materias, lectura del resto si es auditor)
 */

const ExtraordinariosModule = (() => {
  let _filters = { search: '', soloConCasos: false };
  let _expandedCards = new Set();
  let _data = null;
  // BUGFIX (v7.59): el listener se agregaba en cada _renderUI() (cada toggle, cada
  // filtro, cada save). Resultado: con N renders, cada click disparaba N veces el
  // handler → toggle 2 veces = no-op → "no se puede cerrar ni abrir otra tarjeta".
  // Fix: bindeamos UNA SOLA VEZ; el handler usa event delegation y sigue funcionando
  // con DOM regenerado en cada render.
  let _eventsBound = false;

  // ═══════════════════════════════════════════════════════════════
  // PERMISOS DE CAPTURA (lista blanca explícita)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Decide si el usuario actual puede CAPTURAR extraordinarios para
   * una asignación dada. Es lista blanca estricta:
   *   - admin (Olivia)
   *   - subdirector (Octavio)
   *   - el maestro cuya teacherId coincide con t.teacherId (interim incluido)
   *
   * Cualquier otro rol → NO captura, aunque la UI muestre inputs por error
   * (el rule de Firestore es el backstop autoritario).
   */
  function _canCurrentUserCaptureForAssignment(t) {
    const user = App.currentUser;
    if (!user) return false;
    const role = user.role;
    // 1) Admin y subdirector siempre pueden (override administrativo)
    if (role === 'admin' || role === 'subdirector') return true;
    // 2) Cualquier otro rol DEBE tener teacherId, Y debe coincidir con
    //    el teacherId de la asignación. Esto cubre: maestro, orientador_docente,
    //    presidente_academia con asignación real, e interim (porque el interim
    //    tiene su propio teacherId en la asignación).
    const myTeacherId = user.teacherId;
    if (!myTeacherId) return false;
    if (!t || !t.teacherId) return false;
    return t.teacherId === myTeacherId;
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando extraordinarios…');

    try {
      const user = App.currentUser || {};
      const role = user.role;

      // ─── VISIBILIDAD v8.03 ───
      // Extraordinarios es un módulo CENTRADO EN CAPTURA. Por eso:
      //   - Si el usuario PUEDE capturar (es maestro/orientador_docente),
      //     ve SOLO SUS materias — aunque tenga auditorScope.
      //   - Si NO puede capturar pero es admin/subdirector/directivo,
      //     ve todas (responsabilidad institucional).
      //   - Auditores puros (sin teacherId) y orientadores puros ven
      //     vista de SU scope (auditor=todo, orientador=sus grupos).
      //
      // Esto evita que Jessica (auditor + maestro) vea 216 tarjetas con
      // tentación de capturar en materias ajenas. Para auditar, usa
      // Indicadores, Dashboard, Concentrado — esos siguen siendo globales.
      const isCaptureRole = App.canActAs('maestro'); // maestro u orientador_docente
      const hasInstitucionalScope = ['admin', 'subdirector', 'directivo', 'secretario_escolar', 'secretario_admin']
        .includes(role);
      const canSeeAll = hasInstitucionalScope ||
                        (!isCaptureRole && App.canActAs('auditor'));
      const isOrientadorOnly = App.canActAs('orientador') && !canSeeAll && !isCaptureRole;
      const isMaestroScope = isCaptureRole && !canSeeAll;

      const [groupsAll, subjectsAll, oriGroups] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        Store.getOrientadorGroups().catch(() => []),
      ]);
      const subjMap = {}; subjectsAll.forEach(s => { subjMap[s.id] = s; });
      const groupMap = {}; groupsAll.forEach(g => { groupMap[g.id] = g; });

      let assignments = [];
      if (canSeeAll) {
        assignments = await Store.getAssignments();
      } else if (isMaestroScope) {
        // PRIVACIDAD ESTRICTA (junio 2026): usar getOwnAssignments() que hace
        // .where('teacherId','==',myTeacherId) en Firestore directamente, sin
        // depender de un filter() del lado cliente. Antes pedíamos TODAS las
        // assignments y filtrabamos en JS, lo que dejaba escapar materias
        // ajenas si el maestro tenia algun flag aditivo (auditorScope,
        // presidente_academia con academiaGrado/Turno, etc.) que las rules
        // permitian leer globalmente. Ahora la query MISMA esta restringida
        // a su teacherId — imposible que aparezca una materia ajena.
        const myTeacherId = await Store.getTeacherDocId();
        if (myTeacherId) {
          assignments = await Store.getOwnAssignments().catch(() => []);
        }
      } else if (isOrientadorOnly && oriGroups && oriGroups.length > 0) {
        const groupSet = new Set(oriGroups);
        const allA = await Store.getAssignments().catch(() => []);
        assignments = allA.filter(a => groupSet.has(a.groupId));
      }

      // DOBLE BLINDAJE (junio 2026): aunque getOwnAssignments YA filtra en
      // Firestore, si por cualquier razón se mezclaran assignments ajenos
      // (cache stale, race con cambio de impersonacion, etc.), volvemos a
      // filtrar en cliente con el teacherId actual. Cinturon y tirantes.
      if (isMaestroScope) {
        const myTeacherId = await Store.getTeacherDocId();
        if (myTeacherId) {
          const antes = assignments.length;
          assignments = assignments.filter(a => a.teacherId === myTeacherId);
          if (antes !== assignments.length) {
            console.warn('[extraordinarios] assignments ajenas filtradas a posteriori:', antes - assignments.length);
          }
        } else {
          assignments = []; // sin teacherId no mostramos nada
        }
      }

      if (assignments.length === 0) {
        container.innerHTML = UI.moduleContainer([
          UI.pageHeader('Extraordinarios', 'Sin materias en tu scope'),
          `<div class="alert alert-warning" style="margin:14px 0;">
            No tienes materias o grupos asignados para revisar extraordinarios.
          </div>`
        ].join(''));
        return;
      }

      const groupIdsSet = new Set(assignments.map(a => a.groupId));
      const groupIds = [...groupIdsSet];

      const [students, gradesAll, hoursAll, extrasAll] = await Promise.all([
        Store.getStudentsByGroups(groupIds).catch(() => []),
        Store.getGradesByGroups(groupIds).catch(() => []),
        _loadHoursForGroups(groupIds).catch(() => []),
        _loadExtrasForGroups(groupIds).catch(() => []),
      ]);

      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      // PRE-INDEX studentsByGroupId — evita filter() N² en el loop de assignments.
      // Antes: por cada assignment (hasta ~216 para admin) hacíamos
      // activeStudents.filter(s => s.groupId === a.groupId) recorriendo ~360 alumnos.
      // Ahora: O(1) lookup en Map.
      const studentsByGroupId = new Map();
      for (const s of activeStudents) {
        const gid = s.groupId;
        if (!gid) continue;
        if (!studentsByGroupId.has(gid)) studentsByGroupId.set(gid, []);
        studentsByGroupId.get(gid).push(s);
      }

      // Index grades por studentId × subjectId × partial
      const gradeIdx = {};
      for (const g of gradesAll) {
        const sid = g.studentId, suj = g.subjectId, p = g.partial;
        if (!sid || !suj || !p) continue;
        if (!gradeIdx[sid]) gradeIdx[sid] = {};
        if (!gradeIdx[sid][suj]) gradeIdx[sid][suj] = {};
        gradeIdx[sid][suj][p] = g;
      }

      // Index hours por groupId × subjectId × partial
      const hourIdx = {};
      for (const h of hoursAll) {
        const gid = h.groupId, suj = h.subjectId, p = h.partial;
        if (!gid || !suj || !p) continue;
        if (!hourIdx[gid]) hourIdx[gid] = {};
        if (!hourIdx[gid][suj]) hourIdx[gid][suj] = {};
        hourIdx[gid][suj][p] = h;
      }

      // Index extras por studentId × subjectId × oportunidad (1|2|3)
      const extraIdx = {};
      for (const e of extrasAll) {
        if (!e.studentId || !e.subjectId) continue;
        const op = Number(e.oportunidad) || 1; // fallback a 1ª por compatibilidad
        if (!extraIdx[e.studentId]) extraIdx[e.studentId] = {};
        if (!extraIdx[e.studentId][e.subjectId]) extraIdx[e.studentId][e.subjectId] = {};
        extraIdx[e.studentId][e.subjectId][op] = e;
      }

      // ═══ CONSTRUCCIÓN DE TARJETAS POR (GRUPO + MATERIA) ═══
      const tarjetas = [];
      for (const a of assignments) {
        const grupo = groupMap[a.groupId];
        if (!grupo) continue;
        const subj = subjMap[a.subjectId];
        const subjName = subj?.nombre || a.subjectName || a.subjectId;
        const studsOfGroup = studentsByGroupId.get(a.groupId) || [];

        const alumnosEnExtra = [];
        for (const stu of studsOfGroup) {
          const sGrades = gradeIdx[stu.id]?.[a.subjectId] || {};
          const grades3 = [sGrades.P1 || null, sGrades.P2 || null, sGrades.P3 || null];
          const hoursByPart = hourIdx[a.groupId]?.[a.subjectId] || {};
          const status = App.calcStatusExtraordinario({ grades3, hoursByPart });
          if (!status.isExtra) continue;

          const existing = extraIdx[stu.id]?.[a.subjectId] || {};
          const op1 = existing[1] || null;
          const op2 = existing[2] || null;
          const op3 = existing[3] || null;

          // Determinar oportunidad ACTIVA (la que se debe capturar ahora)
          // y estado global del alumno en esta materia.
          // REGLA: tanto REPROBADO (cal < 6) como NO_PRESENTO (faltó al examen)
          // se consideran "no acreditó" y mandan al alumno a la siguiente
          // oportunidad. Solo APROBADO termina el proceso favorable.
          // Si llega a 3ª y termina REPROBADO o NO_PRESENTO → baja pendiente.
          const noAcredito = (e) => e && (e.estatus === 'REPROBADO' || e.estatus === 'NO_PRESENTO');
          const aprobo = (e) => e && e.estatus === 'APROBADO';

          let oportunidadActiva = 1;
          let estadoGlobal = 'PENDIENTE_1';
          let calFinal = null;
          if (op1) {
            if (aprobo(op1)) { oportunidadActiva = null; estadoGlobal = 'APROBADO_1'; calFinal = op1.calExtraordinario; }
            else if (noAcredito(op1)) {
              if (op2) {
                if (aprobo(op2)) { oportunidadActiva = null; estadoGlobal = 'APROBADO_2'; calFinal = op2.calExtraordinario; }
                else if (noAcredito(op2)) {
                  if (op3) {
                    if (aprobo(op3)) { oportunidadActiva = null; estadoGlobal = 'APROBADO_3'; calFinal = op3.calExtraordinario; }
                    else {
                      // 3ª no acreditada → BAJA pendiente (NP en 3ª = no acreditó la materia)
                      oportunidadActiva = null;
                      estadoGlobal = op3.estatus === 'NO_PRESENTO' ? 'BAJA_NP' : 'REPROBADO_FINAL';
                      calFinal = op3.calExtraordinario;
                    }
                  } else { oportunidadActiva = 3; estadoGlobal = 'PENDIENTE_3'; }
                }
              } else { oportunidadActiva = 2; estadoGlobal = 'PENDIENTE_2'; }
            }
          }

          alumnosEnExtra.push({
            studentId: stu.id,
            studentName: _formatStudentName(stu),
            cals: status.cals,
            promedio: status.promedio,
            faltasTotal: status.faltasTotal,
            horasTotal: status.horasTotal,
            pctInasistencia: status.pctInasistencia,
            causa: status.causa,
            estatus: status.estatus,
            // Historial de oportunidades
            op1, op2, op3,
            oportunidadActiva,  // null si terminado, o 1/2/3 si pendiente
            estadoGlobal,       // PENDIENTE_1 | APROBADO_1 | PENDIENTE_2 | APROBADO_2 | PENDIENTE_3 | APROBADO_3 | REPROBADO_FINAL
            calFinal,           // la cal del último intento APROBADO, o la del 3ª si reprobado final
          });
        }

        alumnosEnExtra.sort((x, y) => x.studentName.localeCompare(y.studentName));

        tarjetas.push({
          key: `${a.groupId}|${a.subjectId}`,
          groupId: a.groupId,
          groupName: grupo.nombre,
          turno: grupo.turno,
          grado: grupo.grado,
          subjectId: a.subjectId,
          subjectName: subjName,
          teacherId: a.teacherId,
          teacherName: a.teacherName || '',
          alumnos: alumnosEnExtra,
          totalAlumnos: studsOfGroup.length,
        });
      }

      // Orden de tarjetas
      const _norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
      const _sepIdx = (name, grado) => {
        const order = (K.SUBJECT_ORDER || {})[Number(grado)] || [];
        if (order.length === 0) return 999;
        const n = _norm(name);
        const i = order.findIndex(o => _norm(o) === n || n.includes(_norm(o)) || _norm(o).includes(n));
        return i === -1 ? 999 : i;
      };
      tarjetas.sort((x, y) =>
        (x.turno || '').localeCompare(y.turno || '') ||
        Number(x.grado) - Number(y.grado) ||
        (x.groupName || '').localeCompare(y.groupName || '') ||
        (_sepIdx(x.subjectName, x.grado) - _sepIdx(y.subjectName, y.grado))
      );

      _data = { tarjetas, canSeeAll, isMaestroScope, isOrientadorOnly };
      _renderUI(container);
    } catch (e) {
      console.error('Error en extraordinarios:', e);
      container.innerHTML = UI.errorState('Error al cargar extraordinarios: ' + (e.message || ''));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CARGA DE COLECCIONES AUXILIARES
  // ═══════════════════════════════════════════════════════════════

  async function _loadHoursForGroups(groupIds) {
    if (!groupIds || groupIds.length === 0 || !window.db) return [];
    const all = [];
    const chunks = [];
    for (let i = 0; i < groupIds.length; i += 30) chunks.push(groupIds.slice(i, i + 30));
    for (const chunk of chunks) {
      try {
        const snap = await window.db.collection('teacherHours').where('groupId', 'in', chunk).get();
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      } catch (e) { console.warn('hours chunk falló:', e); }
    }
    return all;
  }

  async function _loadExtrasForGroups(groupIds) {
    if (!groupIds || groupIds.length === 0 || !window.db) return [];
    const all = [];
    const chunks = [];
    for (let i = 0; i < groupIds.length; i += 30) chunks.push(groupIds.slice(i, i + 30));
    for (const chunk of chunks) {
      try {
        const snap = await window.db.collection('extraordinarios').where('groupId', 'in', chunk).get();
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      } catch (e) { console.warn('extraordinarios chunk falló:', e); }
    }
    return all;
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER UI PRINCIPAL
  // ═══════════════════════════════════════════════════════════════

  function _renderUI(container) {
    if (!_data) return;
    let tarjetas = _data.tarjetas.slice();

    // KPIs
    const totalAlumnosEnExtra = new Set();
    let pend1 = 0, pend2 = 0, pend3 = 0, aprobados = 0, reprobadosFinal = 0, bajaNP = 0;
    for (const t of tarjetas) {
      for (const al of t.alumnos) {
        totalAlumnosEnExtra.add(al.studentId);
        if (al.estadoGlobal === 'PENDIENTE_1') pend1++;
        else if (al.estadoGlobal === 'PENDIENTE_2') pend2++;
        else if (al.estadoGlobal === 'PENDIENTE_3') pend3++;
        else if (al.estadoGlobal.startsWith('APROBADO')) aprobados++;
        else if (al.estadoGlobal === 'REPROBADO_FINAL') reprobadosFinal++;
        else if (al.estadoGlobal === 'BAJA_NP') bajaNP++;
      }
    }
    const tarjetasConCasos = tarjetas.filter(t => t.alumnos.length > 0).length;

    if (_filters.soloConCasos) tarjetas = tarjetas.filter(t => t.alumnos.length > 0);
    if (_filters.search) {
      const q = _filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      tarjetas = tarjetas.filter(t => {
        const headerMatch = `${t.groupName} ${t.subjectName}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);
        if (headerMatch) return true;
        return t.alumnos.some(a => a.studentName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
      });
    }

    const cardsHtml = tarjetas.length === 0
      ? `<div class="card" style="padding:32px;text-align:center;color:#9ca3af;">
          ${_filters.search || _filters.soloConCasos ? 'Ningún resultado con los filtros.' : '✓ Sin materias asignadas.'}
        </div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px;">
          ${tarjetas.map(_renderTarjeta).join('')}
        </div>`;

    container.innerHTML = UI.moduleContainer([
      UI.pageHeader(
        '⚠️ Extraordinarios',
        'Tres oportunidades (1ª, 2ª, 3ª) · El sistema decide automáticamente cuál capturar según el historial · La cal extraordinaria sustituye a la ordinaria'
      ),

      // KPIs por oportunidad
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
        <div class="card" style="padding:14px;border-left:5px solid #dc2626;background:linear-gradient(135deg,#fff,#fef2f2);">
          <div style="font-size:10px;font-weight:700;color:#991b1b;letter-spacing:1.5px;">EN EXTRA</div>
          <div style="font-size:30px;font-weight:900;color:#dc2626;line-height:1;margin-top:4px;">${totalAlumnosEnExtra.size}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">alumnos únicos</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #f59e0b;background:linear-gradient(135deg,#fff,#fffbeb);">
          <div style="font-size:10px;font-weight:700;color:#92400e;letter-spacing:1.5px;">PENDIENTE 1ª</div>
          <div style="font-size:30px;font-weight:900;color:#d97706;line-height:1;margin-top:4px;">${pend1}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">sin captura aún</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #ea580c;background:linear-gradient(135deg,#fff,#fff7ed);">
          <div style="font-size:10px;font-weight:700;color:#9a3412;letter-spacing:1.5px;">PENDIENTE 2ª</div>
          <div style="font-size:30px;font-weight:900;color:#ea580c;line-height:1;margin-top:4px;">${pend2}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">no acreditó 1ª</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #b91c1c;background:linear-gradient(135deg,#fff,#fef2f2);">
          <div style="font-size:10px;font-weight:700;color:#7f1d1d;letter-spacing:1.5px;">PENDIENTE 3ª</div>
          <div style="font-size:30px;font-weight:900;color:#b91c1c;line-height:1;margin-top:4px;">${pend3}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">no acreditó 2ª</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #10b981;background:linear-gradient(135deg,#fff,#ecfdf5);">
          <div style="font-size:10px;font-weight:700;color:#065f46;letter-spacing:1.5px;">APROBADOS</div>
          <div style="font-size:30px;font-weight:900;color:#10b981;line-height:1;margin-top:4px;">${aprobados}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">acreditaron en alguna oportunidad</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #1f2937;background:linear-gradient(135deg,#fff,#f9fafb);">
          <div style="font-size:10px;font-weight:700;color:#111827;letter-spacing:1.5px;">REPROBADO FINAL</div>
          <div style="font-size:30px;font-weight:900;color:#1f2937;line-height:1;margin-top:4px;">${reprobadosFinal}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">tras las 3 oportunidades</div>
        </div>
        <div class="card" style="padding:14px;border-left:5px solid #be123c;background:linear-gradient(135deg,#fff,#fff1f2);">
          <div style="font-size:10px;font-weight:700;color:#9f1239;letter-spacing:1.5px;">BAJA PENDIENTE</div>
          <div style="font-size:30px;font-weight:900;color:#be123c;line-height:1;margin-top:4px;">${bajaNP}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">NP en 3ª — tramitar baja</div>
        </div>
      </div>`,

      `<div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap;">
        <div style="flex:1;min-width:280px;position:relative;">
          <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:18px;">🔍</span>
          <input id="extra-search" type="text" placeholder="Buscar por alumno, grupo o materia…"
            value="${Utils.sanitize(_filters.search)}"
            style="width:100%;padding:11px 14px 11px 42px;border:1.5px solid #cbd5e0;border-radius:10px;font-size:14px;outline:none;"
            onfocus="this.style.borderColor='#1e40af'" onblur="this.style.borderColor='#cbd5e0'">
        </div>
        <label style="display:flex;align-items:center;gap:8px;padding:11px 16px;background:#fff;border:1.5px solid #cbd5e0;border-radius:10px;cursor:pointer;font-size:13px;color:#475569;font-weight:600;">
          <input type="checkbox" id="extra-only-casos" ${_filters.soloConCasos ? 'checked' : ''} style="cursor:pointer;">
          Solo con casos
        </label>
        <div style="font-size:11px;color:#6b7280;background:#f8fafc;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;">
          <strong>Tarjetas:</strong> ${_data.tarjetas.length} (${tarjetasConCasos} con casos)
        </div>
      </div>`,

      cardsHtml,
    ].join(''));

    _bindEvents();
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDER DE UNA TARJETA (grupo + materia)
  // ═══════════════════════════════════════════════════════════════

  function _renderTarjeta(t) {
    const isExpanded = _expandedCards.has(t.key);
    const count = t.alumnos.length;

    // Stats por oportunidad
    const p1 = t.alumnos.filter(a => a.estadoGlobal === 'PENDIENTE_1').length;
    const p2 = t.alumnos.filter(a => a.estadoGlobal === 'PENDIENTE_2').length;
    const p3 = t.alumnos.filter(a => a.estadoGlobal === 'PENDIENTE_3').length;
    const apr = t.alumnos.filter(a => a.estadoGlobal.startsWith('APROBADO')).length;
    const rep = t.alumnos.filter(a => a.estadoGlobal === 'REPROBADO_FINAL').length;
    const pendientesTot = p1 + p2 + p3;

    let borderColor, bgGradient, badgeColor, badgeText;
    if (count === 0) {
      borderColor = '#10b981';
      bgGradient = 'linear-gradient(135deg,#fff,#ecfdf5)';
      badgeColor = '#10b981';
      badgeText = 'Sin extraordinarios';
    } else if (pendientesTot === 0) {
      borderColor = '#6366f1';
      bgGradient = 'linear-gradient(135deg,#fff,#eef2ff)';
      badgeColor = '#6366f1';
      badgeText = `${apr} aprobados${rep > 0 ? ` · ${rep} reprobados final` : ''}`;
    } else {
      borderColor = '#dc2626';
      bgGradient = 'linear-gradient(135deg,#fff,#fef2f2)';
      badgeColor = '#dc2626';
      // Texto resumen: cuántos pendientes por oportunidad
      const partes = [];
      if (p1) partes.push(`${p1} en 1ª`);
      if (p2) partes.push(`${p2} en 2ª`);
      if (p3) partes.push(`${p3} en 3ª`);
      badgeText = partes.join(' · ');
    }

    const header = `<div data-action="toggle-card" data-card-key="${t.key}" style="cursor:pointer;padding:16px 18px;background:${bgGradient};border-left:5px solid ${borderColor};border-radius:10px 10px ${isExpanded ? '0 0' : '10px 10px'};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span style="background:#1e40af;color:#fff;padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.5px;">${Utils.sanitize(t.groupName)}</span>
            <span style="font-size:10px;color:#94a3b8;font-weight:600;">${Utils.sanitize(t.turno || '')}</span>
          </div>
          <div style="font-size:15px;font-weight:700;color:#1e293b;line-height:1.3;">${Utils.sanitize(K.getUACNombre(t.subjectName))}</div>
          <div style="margin-top:6px;">
            <span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;">${badgeText}</span>
          </div>
        </div>
        <span style="font-size:18px;color:#94a3b8;">${isExpanded ? '▼' : '▶'}</span>
      </div>
    </div>`;

    const body = isExpanded ? _renderTarjetaBody(t) : '';

    return `<div class="card" data-card-root="${t.key}" style="padding:0;overflow:hidden;border:none;">
      ${header}
      ${body}
    </div>`;
  }

  // Re-render PARCIAL: reemplaza solo el HTML de una tarjeta cuando se hace
  // toggle. Si el elemento DOM no existe (edge case), cae al re-render total.
  function _rerenderTarjeta(key) {
    if (!_data) return;
    const tarjeta = _data.tarjetas.find(t => t.key === key);
    if (!tarjeta) { _renderUI(document.getElementById('moduleContainer')); return; }
    const root = document.querySelector(`[data-card-root="${CSS.escape(key)}"]`);
    if (!root) { _renderUI(document.getElementById('moduleContainer')); return; }
    // Reemplazar el outerHTML por el nuevo HTML de la tarjeta.
    root.outerHTML = _renderTarjeta(tarjeta);
  }

  // ═══════════════════════════════════════════════════════════════
  // CUERPO EXPANDIDO (tabla + captura inline + botones imprimir)
  // ═══════════════════════════════════════════════════════════════

  function _renderTarjetaBody(t) {
    if (t.alumnos.length === 0) {
      return `<div style="padding:24px;text-align:center;color:#6b7280;background:#f9fafb;font-size:13px;">
        ✓ No hay alumnos en extraordinario en este grupo+materia.
      </div>`;
    }

    // ─── REGLA EPO 67 (v8.02, definitiva) ───
    // Solo pueden CAPTURAR extraordinarios:
    //   1) Admin (Olivia)
    //   2) Subdirector (Octavio)
    //   3) El MAESTRO ASIGNADO a esa materia+grupo (su teacherId coincide
    //      con t.teacherId — incluye orientador_docente, presidente_academia
    //      con asignación real, y cobertura interim).
    // NADIE MÁS captura: orientador puro, auditor, directivo, secretarios,
    // consulta — todos read-only.
    const canCapture = _canCurrentUserCaptureForAssignment(t);
    const role = App.currentUser?.role;
    const isAuditorOnly = !canCapture && (role === 'maestro' || App.canActAs('auditor') || App.canActAs('orientador'));

    const filas = t.alumnos.map((a, i) => _renderFilaAlumno(t, a, i, canCapture)).join('');

    let modoBanner = '';
    if (canCapture) {
      modoBanner = `<div style="font-size:11px;color:#1e40af;background:#eff6ff;padding:6px 10px;border-radius:6px;border-left:3px solid #1e40af;">
        <strong>✏️ Captura inline:</strong> el sistema decide automáticamente la oportunidad activa (1ª, 2ª o 3ª). Ingresa <strong>5-10</strong> (cal) o <strong>NP</strong> (no presentó). NP en 3ª = baja pendiente.
      </div>`;
    } else if (isAuditorOnly) {
      modoBanner = `<div style="font-size:11px;color:#92400e;background:#fef3c7;padding:6px 10px;border-radius:6px;border-left:3px solid #d97706;">
        <strong>📖 Solo lectura:</strong> esta asignación pertenece a <strong>${escapeHtml(_displayTeacherName(t.teacherName) || 'otro docente')}</strong>.
      </div>`;
    } else {
      modoBanner = `<div style="font-size:11px;color:#64748b;background:#f8fafc;padding:6px 10px;border-radius:6px;border-left:3px solid #94a3b8;">
        <strong>📖 Solo lectura:</strong> no tienes permisos para capturar.
      </div>`;
    }

    // Conteo de grupos con la MISMA materia (incluye el actual). Direccion
    // exige que la impresion sea SIEMPRE por MATERIA — la hoja unica con
    // columna GRUPO. Ya NO se permite imprimir un solo grupo aislado
    // porque eso multiplica hojas innecesarias y el examen oficial es por
    // materia, no por grupo. Si solo hay 1 grupo con esta materia, el
    // mismo print sale con 1 grupo (la columna GRUPO igual ayuda al
    // archivo y traza institucional).
    const totalGruposMateria = (_data.tarjetas || [])
      .filter(x => x.subjectId === t.subjectId).length;

    const sufijoGrupos = totalGruposMateria > 1
      ? ` (${totalGruposMateria} grupos)`
      : '';

    // Un único set: SIEMPRE imprime por materia (consolidado).
    const printBtns = `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:2px;">
        🖨️ Imprimir lista oficial${totalGruposMateria > 1 ? ` (juntará ${totalGruposMateria} grupos en una hoja)` : ''}:
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button data-action="print-extra-materia" data-subject-id="${escapeHtml(t.subjectId)}" data-op="1"
          title="${totalGruposMateria > 1 ? 'Imprime 1ª oportunidad de TODOS los grupos donde se imparte esta materia en una sola hoja con columna GRUPO' : 'Imprime 1ª oportunidad de esta materia'}"
          style="padding:8px 12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
          1ª Oportunidad${sufijoGrupos}
        </button>
        <button data-action="print-extra-materia" data-subject-id="${escapeHtml(t.subjectId)}" data-op="2"
          style="padding:8px 12px;background:#ea580c;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
          2ª Oportunidad${sufijoGrupos}
        </button>
        <button data-action="print-extra-materia" data-subject-id="${escapeHtml(t.subjectId)}" data-op="3"
          style="padding:8px 12px;background:#b91c1c;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
          3ª Oportunidad${sufijoGrupos}
        </button>
      </div>
    </div>`;

    const guardarTodoBtn = canCapture ? `<button data-action="save-all-extra" data-card-key="${t.key}"
      style="padding:8px 14px;background:#1e40af;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
      💾 Guardar todo
    </button>` : '';

    return `<div style="padding:14px 16px;background:#fff;border-top:1px solid #e5e7eb;">
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-bottom:10px;align-items:start;">
        <div>${modoBanner}</div>
        <div style="display:flex;gap:8px;flex-direction:column;align-items:flex-end;">
          ${guardarTodoBtn}
          ${printBtns}
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead style="background:#1e40af;color:#fff;">
            <tr>
              <th style="padding:8px 4px;font-size:10px;width:24px;">#</th>
              <th style="padding:8px 10px;font-size:10px;text-align:left;">ALUMNO</th>
              <th style="padding:8px 4px;font-size:10px;text-align:center;">HIST</th>
              <th style="padding:8px 4px;font-size:10px;text-align:center;">OPORT.</th>
              <th style="padding:8px 4px;font-size:10px;text-align:center;">CAL</th>
              <th style="padding:8px 4px;font-size:10px;text-align:center;">FECHA</th>
              <th style="padding:8px 4px;font-size:10px;text-align:center;">${canCapture ? 'COMENT.' : 'COMENT.'}</th>
              ${canCapture ? '<th style="padding:8px 4px;font-size:10px;width:40px;"></th>' : ''}
              <th style="padding:8px 4px;font-size:10px;text-align:center;">ESTADO</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>`;
  }

  function _renderFilaAlumno(t, a, i, canCapture) {
    // HIST: chips compactos con cal o NP de cada oportunidad ya tomada
    const histChips = [];
    [['1', a.op1], ['2', a.op2], ['3', a.op3]].forEach(([op, e]) => {
      if (e) {
        let bg, text, tooltip;
        if (e.estatus === 'APROBADO') {
          bg = '#10b981'; text = e.calExtraordinario; tooltip = `Oportunidad ${op}: ${text} (aprobó)`;
        } else if (e.estatus === 'NO_PRESENTO') {
          bg = '#f97316'; text = 'NP'; tooltip = `Oportunidad ${op}: No presentó`;
        } else {
          bg = '#dc2626'; text = e.calExtraordinario; tooltip = `Oportunidad ${op}: ${text} (no aprobó)`;
        }
        histChips.push(`<span style="background:${bg};color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;margin-right:2px;" title="${tooltip}">${op}ª:${text}</span>`);
      }
    });
    const histStr = histChips.length === 0 ? '<span style="color:#cbd5e0;font-size:10px;">—</span>' : histChips.join('');

    // Etiqueta de oportunidad activa
    let opLabel = '<span style="color:#9ca3af;">—</span>';
    if (a.oportunidadActiva === 1) opLabel = '<span style="background:#d97706;color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">1ª</span>';
    else if (a.oportunidadActiva === 2) opLabel = '<span style="background:#ea580c;color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">2ª</span>';
    else if (a.oportunidadActiva === 3) opLabel = '<span style="background:#b91c1c;color:#fff;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">3ª</span>';

    // Badge de estado global
    let estadoBadge = '';
    let rowBg = '#fff';
    if (a.estadoGlobal === 'PENDIENTE_1') estadoBadge = '<span style="background:#fde68a;color:#92400e;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">PENDIENTE 1ª</span>';
    else if (a.estadoGlobal === 'PENDIENTE_2') { estadoBadge = '<span style="background:#fed7aa;color:#9a3412;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">PENDIENTE 2ª</span>'; rowBg = '#fff7ed'; }
    else if (a.estadoGlobal === 'PENDIENTE_3') { estadoBadge = '<span style="background:#fecaca;color:#7f1d1d;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">PENDIENTE 3ª</span>'; rowBg = '#fef2f2'; }
    else if (a.estadoGlobal === 'APROBADO_1') { estadoBadge = `<span style="background:#10b981;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">APROBÓ EN 1ª (${a.calFinal})</span>`; rowBg = '#f0fdf4'; }
    else if (a.estadoGlobal === 'APROBADO_2') { estadoBadge = `<span style="background:#10b981;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">APROBÓ EN 2ª (${a.calFinal})</span>`; rowBg = '#f0fdf4'; }
    else if (a.estadoGlobal === 'APROBADO_3') { estadoBadge = `<span style="background:#10b981;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">APROBÓ EN 3ª (${a.calFinal})</span>`; rowBg = '#f0fdf4'; }
    else if (a.estadoGlobal === 'REPROBADO_FINAL') { estadoBadge = `<span style="background:#1f2937;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;">REPROBADO FINAL (${a.calFinal})</span>`; rowBg = '#f3f4f6'; }
    else if (a.estadoGlobal === 'BAJA_NP') { estadoBadge = `<span style="background:#be123c;color:#fff;padding:2px 6px;border-radius:6px;font-size:10px;font-weight:700;" title="No presentó la 3ª oportunidad — no acreditó la materia">⚠️ BAJA PENDIENTE</span>`; rowBg = '#fff1f2'; }

    const showInputs = canCapture && a.oportunidadActiva !== null;
    // Input cambió a type="text" para aceptar "NP" además de números 5-10.
    // La validación se hace en _readInputsForStudent.
    const inputsHtml = showInputs ? `
      <td style="padding:6px 4px;text-align:center;">
        <input type="text" maxlength="2"
          data-field="cal" data-student-id="${a.studentId}" data-card-key="${t.key}"
          value=""
          style="width:62px;padding:6px;border:1.5px solid #cbd5e0;border-radius:6px;font-size:14px;font-weight:700;text-align:center;outline:none;text-transform:uppercase;"
          placeholder="5-10 / NP" title="Ingresa 5-10 (cal) o NP (no presentó). NP en 3ª = baja.">
      </td>
      <td style="padding:6px 4px;">
        <input type="date"
          data-field="fecha" data-student-id="${a.studentId}" data-card-key="${t.key}"
          style="width:130px;padding:6px;border:1.5px solid #cbd5e0;border-radius:6px;font-size:11px;outline:none;">
      </td>
      <td style="padding:6px 4px;">
        <input type="text" maxlength="60"
          data-field="comentario" data-student-id="${a.studentId}" data-card-key="${t.key}"
          placeholder="Opcional"
          style="width:100%;padding:6px;border:1.5px solid #cbd5e0;border-radius:6px;font-size:11px;outline:none;">
      </td>
      <td style="padding:6px 4px;text-align:center;">
        <button data-action="save-extra" data-student-id="${a.studentId}" data-card-key="${t.key}"
          style="padding:6px 10px;background:#1e40af;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">💾</button>
      </td>
    ` : (canCapture
      ? `<td style="text-align:center;color:#cbd5e0;">—</td>
         <td style="text-align:center;color:#cbd5e0;">—</td>
         <td style="text-align:center;color:#cbd5e0;font-size:10px;">terminado</td>
         <td></td>`
      : `<td style="text-align:center;color:#cbd5e0;">—</td>
         <td style="text-align:center;color:#cbd5e0;">—</td>
         <td style="text-align:center;color:#cbd5e0;font-size:10px;">solo lectura</td>`);

    return `<tr style="background:${rowBg};border-top:1px solid #e5e7eb;">
      <td style="padding:8px 4px;text-align:center;color:#9ca3af;font-size:11px;">${i + 1}</td>
      <td style="padding:8px 10px;font-weight:600;font-size:13px;">${Utils.sanitize(a.studentName)}</td>
      <td style="padding:8px 4px;text-align:center;white-space:nowrap;">${histStr}</td>
      <td style="padding:8px 4px;text-align:center;">${opLabel}</td>
      ${inputsHtml}
      <td style="padding:8px 4px;text-align:center;">${estadoBadge}</td>
    </tr>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ═══════════════════════════════════════════════════════════════

  function _bindEvents() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    // ─── LISTENERS GLOBALES (una sola vez por carga de la app) ───
    // Usan event delegation contra `data-action` — siguen funcionando
    // cuando el _renderUI regenera el innerHTML del container.
    if (!_eventsBound) {
      _eventsBound = true;

      container.addEventListener('click', (e) => {
        // Solo respondemos si el click es DENTRO del módulo extraordinarios
        // (evita que el listener se dispare cuando el usuario navega a otros).
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        // Verificar que el botón es de extraordinarios (tiene una de NUESTRAS acciones)
        const action = btn.dataset.action;
        const ourActions = ['toggle-card', 'save-extra', 'save-all-extra', 'print-extra'];
        if (!ourActions.includes(action)) return;

        if (action === 'toggle-card') {
          const key = btn.dataset.cardKey;
          if (_expandedCards.has(key)) _expandedCards.delete(key);
          else _expandedCards.add(key);
          // PERFORMANCE: re-renderizar SOLO la tarjeta clickeada (no toda la UI).
          // Antes: 1 click → _renderUI() regeneraba 216 tarjetas (~500ms-2s freeze).
          // Ahora: solo reemplaza el HTML de UNA tarjeta. <50ms.
          _rerenderTarjeta(key);
        } else if (action === 'save-extra') {
          _saveSingle(btn.dataset.cardKey, btn.dataset.studentId);
        } else if (action === 'save-all-extra') {
          _saveAll(btn.dataset.cardKey);
        } else if (action === 'print-extra') {
          _printConcentrado(btn.dataset.cardKey, Number(btn.dataset.op));
        } else if (action === 'print-extra-materia') {
          _printConcentradoMateria(btn.dataset.subjectId, Number(btn.dataset.op));
        }
      });

      // Búsqueda y toggle "Solo con casos": usan event delegation
      // contra IDs específicos del módulo (extra-search, extra-only-casos).
      let _searchTimer = null;
      container.addEventListener('input', (e) => {
        if (e.target.id !== 'extra-search') return;
        clearTimeout(_searchTimer);
        const val = e.target.value;
        _searchTimer = setTimeout(() => {
          _filters.search = val;
          _renderUI(document.getElementById('moduleContainer'));
        }, 250);
      });

      container.addEventListener('change', (e) => {
        if (e.target.id !== 'extra-only-casos') return;
        _filters.soloConCasos = e.target.checked;
        _renderUI(document.getElementById('moduleContainer'));
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GUARDADO EN FIRESTORE
  // ═══════════════════════════════════════════════════════════════

  async function _saveSingle(cardKey, studentId) {
    const tarjeta = _data.tarjetas.find(t => t.key === cardKey);
    if (!tarjeta) return;
    const alumno = tarjeta.alumnos.find(a => a.studentId === studentId);
    if (!alumno) return;
    if (alumno.oportunidadActiva === null) {
      Toast.show('Este alumno ya terminó sus 3 oportunidades o aprobó. No se permite capturar más.', 'warning');
      return;
    }

    const row = _readInputsForStudent(cardKey, studentId);
    if (row.error) { Toast.show(row.error, 'warning'); return; }
    // Acepta cal numérica O NP (no presentó). Si nada se ingresó, error.
    if (row.cal == null && !row.noPresento) { Toast.show('Ingresa la calificación (5-10) o NP', 'warning'); return; }

    try {
      await _persistExtra(tarjeta, alumno, alumno.oportunidadActiva, row);
      const op = alumno.oportunidadActiva;
      const valorTxt = row.noPresento ? 'NP (no presentó)' : row.cal;
      // Si NP en 3ª oportunidad → mensaje especial de baja pendiente
      if (row.noPresento && op === 3) {
        Toast.show(`⚠️ ${alumno.studentName}: NP en 3ª oportunidad → BAJA PENDIENTE — no acreditó la materia`, 'warning', 6000);
      } else {
        Toast.show(`✓ Guardado: ${alumno.studentName} → ${op}ª oportunidad: ${valorTxt}`, 'success');
      }
      // Recarga completa para recalcular siguientes oportunidades
      await render();
    } catch (err) {
      console.error('Error guardar extra:', err);
      Toast.show('Error: ' + (err.message || ''), 'error');
    }
  }

  async function _saveAll(cardKey) {
    const tarjeta = _data.tarjetas.find(t => t.key === cardKey);
    if (!tarjeta) return;
    let saved = 0, errors = 0, skipped = 0, terminados = 0;
    for (const alumno of tarjeta.alumnos) {
      if (alumno.oportunidadActiva === null) { terminados++; continue; }
      const row = _readInputsForStudent(cardKey, alumno.studentId);
      if (row.error) { skipped++; continue; }
      // Acepta cal numérica O NP. Si nada → skip.
      if (row.cal == null && !row.noPresento) { skipped++; continue; }
      try {
        await _persistExtra(tarjeta, alumno, alumno.oportunidadActiva, row);
        saved++;
      } catch (err) {
        console.error('save-all error:', err);
        errors++;
      }
    }
    Toast.show(`Guardados ${saved} · Omitidos ${skipped + terminados} · Errores ${errors}`, errors === 0 ? 'success' : 'warning');
    await render();
  }

  function _readInputsForStudent(cardKey, studentId) {
    const calInp = document.querySelector(`input[data-card-key="${cardKey}"][data-student-id="${studentId}"][data-field="cal"]`);
    const fechaInp = document.querySelector(`input[data-card-key="${cardKey}"][data-student-id="${studentId}"][data-field="fecha"]`);
    const comInp = document.querySelector(`input[data-card-key="${cardKey}"][data-student-id="${studentId}"][data-field="comentario"]`);
    if (!calInp) return { cal: null, noPresento: false, fecha: '', comentario: '' };
    const rawCal = calInp.value.trim();
    const fecha = fechaInp?.value || '';
    const comentario = comInp?.value || '';
    if (rawCal === '') return { cal: null, noPresento: false, fecha, comentario };
    // NP (No Presentó) — acepta varias formas: NP, np, N.P., n.p.
    const normalized = rawCal.toUpperCase().replace(/\./g, '');
    if (normalized === 'NP') {
      return { cal: null, noPresento: true, fecha, comentario };
    }
    const cal = parseInt(rawCal, 10);
    if (isNaN(cal) || cal < 5 || cal > 10) {
      return { error: `Valor inválido: "${rawCal}". Ingresa 5-10 o NP.` };
    }
    return { cal, noPresento: false, fecha, comentario };
  }

  async function _persistExtra(tarjeta, alumno, oportunidad, row) {
    if (!window.db) throw new Error('Firebase no disponible');
    // GUARDA DEFENSIVA: bloquea cualquier intento de guardar de quien no
    // sea admin/subdirector/maestro-asignado. La regla de Firestore es el
    // backstop autoritario, pero esto da feedback inmediato y evita rondas
    // a la red.
    if (!_canCurrentUserCaptureForAssignment(tarjeta)) {
      const msg = 'No tienes permiso para capturar extraordinarios de esta asignación. Solo el maestro asignado puede hacerlo.';
      Toast.show(msg, 'error');
      throw new Error(msg);
    }
    const docId = `${alumno.studentId}_${tarjeta.subjectId}_${oportunidad}`;
    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
    // Determinar estatus:
    //   - NP (no presentó): estatus='NO_PRESENTO', cal=null
    //   - cal >= 6: APROBADO
    //   - cal < 6: REPROBADO
    let estatus, calToSave;
    if (row.noPresento) {
      estatus = 'NO_PRESENTO';
      calToSave = null;
    } else {
      estatus = row.cal >= 6 ? 'APROBADO' : 'REPROBADO';
      calToSave = row.cal;
    }
    const data = {
      studentId: alumno.studentId,
      studentName: alumno.studentName,
      subjectId: tarjeta.subjectId,
      subjectName: tarjeta.subjectName,
      groupId: tarjeta.groupId,
      groupName: tarjeta.groupName,
      teacherId: tarjeta.teacherId || '',
      teacherName: tarjeta.teacherName || '',
      oportunidad: Number(oportunidad),
      calOriginal: alumno.cals ? alumno.cals.filter(c => c != null) : null,
      promedioOriginal: alumno.promedio,
      calExtraordinario: calToSave,
      estatus,
      noPresento: row.noPresento === true,
      fechaAplicacion: row.fecha || '',
      fechaCaptura: new Date(),
      comentario: row.comentario || '',
      ciclo: cicloEscolar,
      updatedBy: window.auth?.currentUser?.uid || '',
      updatedByName: App.currentUser?.displayName || App.currentUser?.email || '',
    };
    await window.db.collection('extraordinarios').doc(docId).set(data, { merge: true });
  }

  // ═══════════════════════════════════════════════════════════════
  // IMPRESIÓN DE CONCENTRADO (formato OFICIAL estilo preboleta)
  // ═══════════════════════════════════════════════════════════════

  async function _printConcentrado(cardKey, op) {
    const t = _data.tarjetas.find(x => x.key === cardKey);
    if (!t) return;

    // GARANTÍA de que App.schoolConfig esté disponible. Si init aún no lo cargó
    // (race condition rara) o si falta el campo `staff`, lo leemos directamente
    // de Firestore antes de generar el HTML. Sin esto, App.staffName retorna ''
    // y las firmas del subdirector/directora salen sin nombre — solo la línea.
    if (!App.schoolConfig?.staff?.director?.nombre ||
        !App.schoolConfig?.staff?.subdirector?.nombre) {
      try {
        const doc = await window.db.collection('config').doc('school').get();
        if (doc.exists) {
          App.schoolConfig = doc.data();
        }
      } catch (e) {
        console.warn('No se pudo cargar config/school para print:', e);
      }
    }

    // No acreditó = REPROBADO o NO_PRESENTO. Ambos mandan a la siguiente oportunidad.
    const noAcredito = (e) => e && (e.estatus === 'REPROBADO' || e.estatus === 'NO_PRESENTO');
    let alumnosDeOportunidad;
    if (op === 1) {
      alumnosDeOportunidad = t.alumnos.slice();
    } else if (op === 2) {
      alumnosDeOportunidad = t.alumnos.filter(a => noAcredito(a.op1));
    } else if (op === 3) {
      alumnosDeOportunidad = t.alumnos.filter(a => noAcredito(a.op2));
    } else {
      alumnosDeOportunidad = [];
    }

    if (alumnosDeOportunidad.length === 0) {
      Toast.show(`No hay alumnos para la ${op}ª oportunidad en esta materia.`, 'info');
      return;
    }

    const opLabel = op === 1 ? 'PRIMERA OPORTUNIDAD' : (op === 2 ? 'SEGUNDA OPORTUNIDAD' : 'TERCERA OPORTUNIDAD');
    const opLabelCorta = op === 1 ? '1ª' : (op === 2 ? '2ª' : '3ª');

    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
    const fechaHoy = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    // Fallback explícito: si el helper retorna '' (p. ej. campo no existe),
    // se usa el valor por defecto. Garantiza que SIEMPRE haya un nombre visible.
    const directorName = (App.staffName && App.staffName('director')) ||
      'DRA. KARINA ILUSIÓN LAGUERENNE CHIQUETE';
    const directorCargo = (App.staffCargo && App.staffCargo('director')) ||
      'DIRECTORA ESCOLAR';
    const subdirName = (App.staffName && App.staffName('subdirector')) ||
      'PROFR. OCTAVIO VÁZQUEZ BARRETO';
    const subdirCargo = (App.staffCargo && App.staffCargo('subdirector')) ||
      'SUBDIRECTOR ESCOLAR';

    // Header oficial idéntico al de preboleta (BOLETA_HEADER)
    const headerLines = (K.BOLETA_HEADER || [
      'GOBIERNO DEL ESTADO DE MÉXICO',
      'SECRETARÍA DE EDUCACIÓN',
      'SUBSECRETARÍA DE EDUCACIÓN MEDIA SUPERIOR Y SUPERIOR',
      'DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR',
      'ESCUELA PREPARATORIA OFICIAL NÚM. 67'
    ]).map(line =>
      `<div style="font-size:10px;font-weight:600;letter-spacing:0.3px;line-height:1.3;">${escapeHtml(line)}</div>`
    ).join('');

    // Semestre = grado × 2 (siempre par porque extras son a fin de semestre par)
    const gradoNum = Number(t.grado) || 0;
    const semestre = ({ 1: 'SEGUNDO', 2: 'CUARTO', 3: 'SEXTO' })[gradoNum] || '';

    const filas = alumnosDeOportunidad.map((a, i) => {
      const e = op === 1 ? a.op1 : (op === 2 ? a.op2 : a.op3);
      // Display de cal: número si aprobó/reprobó, "NP" si no presentó, vacío si pendiente.
      let cal, observ;
      if (e?.estatus === 'NO_PRESENTO') {
        cal = 'NP';
        // En 3ª oportunidad NP = baja pendiente (no acreditó la materia).
        observ = op === 3 ? 'BAJA PENDIENTE' : 'NO PRESENTÓ';
      } else if (e?.calExtraordinario != null) {
        cal = String(e.calExtraordinario);
        observ = e.estatus === 'APROBADO' ? 'APROBADO' : 'NO APROBADO';
      } else {
        cal = '_____';
        observ = 'PENDIENTE';
      }
      const fecha = e?.fechaAplicacion || '_____________';
      // Resaltar fila de baja pendiente en color rojo claro
      const rowStyle = (e?.estatus === 'NO_PRESENTO' && op === 3) ? ' style="background:#fee2e2;-webkit-print-color-adjust:exact;print-color-adjust:exact;"' : '';
      return `<tr${rowStyle}>
        <td style="text-align:center;">${i + 1}</td>
        <td>${escapeHtml(a.studentName)}</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${cal === 'NP' ? 'color:#be123c;' : ''}">${cal}</td>
        <td style="text-align:center;">${escapeHtml(fecha)}</td>
        <td style="text-align:center;font-weight:600;${observ === 'BAJA PENDIENTE' ? 'color:#be123c;' : ''}">${observ}</td>
        <td style="height:24px;"></td>
      </tr>`;
    }).join('');

    // Estilo idéntico al de preboleta: Arial 10px, table border 1px solid #333,
    // headers con bg #e0e0e0. Header con imagen header-gobierno-edomex.png arriba
    // y bandin-edomex.png abajo (igual que preboletas).
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Concentrado Extraordinarios ${opLabelCorta} — ${escapeHtml(t.groupName)} ${escapeHtml(t.subjectName)}</title>
<style>
  @page { size: letter portrait; margin: 10mm 12mm 8mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 3px 5px; border: 1px solid #333; }
  thead { background: #e0e0e0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .titulo-doc { text-align: center; margin: 6px 0 10px; }
  .titulo-doc .t1 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .titulo-doc .t2 { font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #b91c1c; margin-top: 2px; }
  .titulo-doc .t3 { font-size: 9px; margin-top: 2px; }
  .meta-tabla td.lbl { background: #f3f4f6; font-weight: 700; width: 14%; text-transform: uppercase; font-size: 9px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nota { background: #fef3c7; border-left: 3px solid #d97706; padding: 5px 8px; margin: 8px 0; font-size: 9px; color: #78350f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .firma-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 36px; }
  .firma-box { text-align: center; padding: 0 4px; }
  .firma-line { border-top: 1px solid #333; margin: 36px 4px 6px; }
  .firma-label { font-size: 10px; font-weight: 700; text-transform: uppercase; line-height: 1.25; word-break: break-word; }
  .firma-sublabel { font-size: 9px; color: #4b5563; margin-top: 2px; font-weight: 600; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>
</head>
<body>
  <!-- Header oficial con imagen del banderín (idéntico a preboletas) -->
  <div style="text-align:center;margin-bottom:4px;">
    <img src="/img/header-gobierno-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
  </div>
  <div style="text-align:center;margin-bottom:8px;">
    ${headerLines}
    <div style="font-size:9px;font-weight:600;margin-top:4px;">DEPARTAMENTO DE CONTROL ESCOLAR &mdash; TURNO ${escapeHtml((t.turno || '').toUpperCase())}</div>
  </div>

  <div class="titulo-doc">
    <div class="t1">Concentrado de Examen Extraordinario</div>
    <div class="t2">${escapeHtml(opLabel)}</div>
    <div class="t3">CICLO ESCOLAR ${escapeHtml(cicloEscolar)}</div>
  </div>

  <table class="meta-tabla" style="margin-bottom:6px;">
    <tr>
      <td class="lbl">Grupo</td><td>${escapeHtml(t.groupName)}</td>
      <td class="lbl">Grado</td><td>${escapeHtml(String(t.grado || ''))}°</td>
      <td class="lbl">Semestre</td><td>${escapeHtml(semestre)}</td>
    </tr>
    <tr>
      <td class="lbl">Materia</td><td colspan="3">${escapeHtml(K.getUACNombre(t.subjectName))}</td>
      <td class="lbl">Turno</td><td>${escapeHtml(t.turno || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Docente</td><td colspan="3">${escapeHtml(_displayTeacherName(t.teacherName))}</td>
      <td class="lbl">Fecha</td><td>${escapeHtml(fechaHoy)}</td>
    </tr>
  </table>

  ${op === 3
    ? `<div class="nota"><strong>Aviso oficial:</strong> Esta es la 3ª y última oportunidad. Los alumnos que obtengan calificación menor a 6 o registren <strong>NP (No Presentó)</strong> NO acreditarán la materia y se tramitará la baja correspondiente conforme a la normativa.</div>`
    : op === 2
      ? `<div class="nota"><strong>Aviso:</strong> Esta 2ª oportunidad solo aplica para alumnos que NO acreditaron la 1ª oportunidad (calificación menor a 6 o NP). La calificación obtenida sustituye a la anterior. Si no acreditan tampoco esta, irán a 3ª oportunidad. Valores válidos: 5-10 o NP.</div>`
      : `<div class="nota"><strong>Aviso:</strong> La calificación obtenida en el examen extraordinario sustituye a la calificación ordinaria. Mínima aprobatoria: 6. Máxima: 10. Mínima a registrar: 5. Si el alumno NO se presenta, registre <strong>NP</strong> — automáticamente pasará a 2ª oportunidad.</div>`}

  <table>
    <thead>
      <tr>
        <th style="width:24px;">#</th>
        <th style="text-align:left;">NOMBRE DEL ALUMNO</th>
        <th style="width:50px;">CALIF.<br>EXTRA</th>
        <th style="width:90px;">FECHA<br>APLICACIÓN</th>
        <th style="width:80px;">OBSERVACIÓN</th>
        <th style="width:160px;">FIRMA DEL ALUMNO</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <div style="margin-top:6px;font-size:9px;color:#4b5563;">
    <strong>Total de alumnos en ${escapeHtml(opLabelCorta)} oportunidad:</strong> ${alumnosDeOportunidad.length}
  </div>

  <div class="firma-row">
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(_displayTeacherName(t.teacherName))}</div>
      <div class="firma-sublabel">DOCENTE DE LA ASIGNATURA</div>
    </div>
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(subdirName)}</div>
      <div class="firma-sublabel">${escapeHtml(subdirCargo)}</div>
    </div>
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(directorName)}</div>
      <div class="firma-sublabel">${escapeHtml(directorCargo)}</div>
    </div>
  </div>

  <!-- Bandín oficial al pie (idéntico a preboletas) -->
  <div style="text-align:center;margin-top:14px;">
    <img src="/img/bandin-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
  </div>

  <script>setTimeout(() => window.print(), 400);<\/script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('Permite ventanas emergentes para imprimir', 'warning'); return; }
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // IMPRESIÓN CONSOLIDADA POR MATERIA (mayo 2026)
  // ═══════════════════════════════════════════════════════════════
  // Junta alumnos en extraordinario de TODOS los grupos donde se imparte
  // la misma materia (mismo subjectId). Útil cuando un docente da la
  // misma materia a 2-3 grupos y quiere una sola hoja con todos los
  // alumnos en extraordinario, agrupados por GRUPO con una columna extra.
  // El formato oficial es idéntico al de print individual: bandín
  // header-gobierno-edomex.png arriba, bandin-edomex.png abajo, firmas
  // de docente / subdirector / director.
  // ═══════════════════════════════════════════════════════════════
  async function _printConcentradoMateria(subjectId, op) {
    if (!_data || !Array.isArray(_data.tarjetas)) return;
    // Todas las tarjetas (= grupos) con esta misma materia
    const tarjetasMateria = _data.tarjetas.filter(t => t.subjectId === subjectId);
    if (tarjetasMateria.length === 0) {
      Toast.show('No hay grupos con esta materia', 'warning');
      return;
    }

    // Asegurar staff cargado (igual que _printConcentrado)
    if (!App.schoolConfig?.staff?.director?.nombre ||
        !App.schoolConfig?.staff?.subdirector?.nombre) {
      try {
        const doc = await window.db.collection('config').doc('school').get();
        if (doc.exists) App.schoolConfig = doc.data();
      } catch (e) { console.warn('No se pudo cargar config/school:', e); }
    }

    const noAcredito = (e) => e && (e.estatus === 'REPROBADO' || e.estatus === 'NO_PRESENTO');

    // Para CADA tarjeta filtramos por oportunidad y juntamos todos los
    // alumnos con su grupo de origen. La fila guarda groupName para la
    // columna GRUPO. Ordenamos por grupo, luego por nombre.
    const filasData = [];
    let totalTurnos = new Set();
    let totalGrados = new Set();
    let totalGruposConAlumnos = 0;
    for (const t of tarjetasMateria) {
      let alumnos;
      if (op === 1) alumnos = t.alumnos.slice();
      else if (op === 2) alumnos = t.alumnos.filter(a => noAcredito(a.op1));
      else if (op === 3) alumnos = t.alumnos.filter(a => noAcredito(a.op2));
      else alumnos = [];
      if (alumnos.length === 0) continue;
      totalGruposConAlumnos++;
      totalTurnos.add(t.turno || '');
      totalGrados.add(t.grado);
      for (const a of alumnos) {
        filasData.push({
          groupName: t.groupName,
          turno: t.turno,
          grado: t.grado,
          teacherName: t.teacherName,
          alumno: a
        });
      }
    }

    if (filasData.length === 0) {
      Toast.show(`No hay alumnos para la ${op}ª oportunidad en esta materia (todos los grupos)`, 'info');
      return;
    }

    // Ordenar: turno → grado → grupo → nombre del alumno
    filasData.sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') ||
      (Number(a.grado) - Number(b.grado)) ||
      (a.groupName || '').localeCompare(b.groupName || '') ||
      (a.alumno.studentName || '').localeCompare(b.alumno.studentName || '')
    );

    const opLabel = op === 1 ? 'PRIMERA OPORTUNIDAD' : (op === 2 ? 'SEGUNDA OPORTUNIDAD' : 'TERCERA OPORTUNIDAD');
    const opLabelCorta = op === 1 ? '1ª' : (op === 2 ? '2ª' : '3ª');

    const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
    const fechaHoy = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });

    const directorName = (App.staffName && App.staffName('director')) ||
      'DRA. KARINA ILUSIÓN LAGUERENNE CHIQUETE';
    const directorCargo = (App.staffCargo && App.staffCargo('director')) ||
      'DIRECTORA ESCOLAR';
    const subdirName = (App.staffName && App.staffName('subdirector')) ||
      'PROFR. OCTAVIO VÁZQUEZ BARRETO';
    const subdirCargo = (App.staffCargo && App.staffCargo('subdirector')) ||
      'SUBDIRECTOR ESCOLAR';

    const headerLines = (K.BOLETA_HEADER || [
      'GOBIERNO DEL ESTADO DE MÉXICO',
      'SECRETARÍA DE EDUCACIÓN',
      'SUBSECRETARÍA DE EDUCACIÓN MEDIA SUPERIOR Y SUPERIOR',
      'DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR',
      'ESCUELA PREPARATORIA OFICIAL NÚM. 67'
    ]).map(line =>
      `<div style="font-size:10px;font-weight:600;letter-spacing:0.3px;line-height:1.3;">${escapeHtml(line)}</div>`
    ).join('');

    // Nombre de la materia (todas las tarjetas comparten subjectId)
    const subjectName = K.getUACNombre(tarjetasMateria[0].subjectName);
    // Docentes participantes (suelen ser 1, pero si la materia la dan
    // varios maestros, los listamos todos en el meta header)
    const docentesUnicos = [...new Set(filasData.map(f => f.teacherName).filter(Boolean))]
      .map(_displayTeacherName).join(' / ');

    // Resumen de turnos involucrados
    const turnosLabel = [...totalTurnos].filter(Boolean).join(' / ') || '—';
    const gradosLabel = [...totalGrados].map(g => g + '°').join(' / ') || '—';

    const filas = filasData.map((row, i) => {
      const a = row.alumno;
      const e = op === 1 ? a.op1 : (op === 2 ? a.op2 : a.op3);
      let cal, observ;
      if (e?.estatus === 'NO_PRESENTO') {
        cal = 'NP';
        observ = op === 3 ? 'BAJA PENDIENTE' : 'NO PRESENTÓ';
      } else if (e?.calExtraordinario != null) {
        cal = String(e.calExtraordinario);
        observ = e.estatus === 'APROBADO' ? 'APROBADO' : 'NO APROBADO';
      } else {
        cal = '_____';
        observ = 'PENDIENTE';
      }
      const fecha = e?.fechaAplicacion || '_____________';
      const rowStyle = (e?.estatus === 'NO_PRESENTO' && op === 3)
        ? ' style="background:#fee2e2;-webkit-print-color-adjust:exact;print-color-adjust:exact;"'
        : '';
      return `<tr${rowStyle}>
        <td style="text-align:center;">${i + 1}</td>
        <td style="text-align:center;font-weight:700;background:#f3f4f6;-webkit-print-color-adjust:exact;print-color-adjust:exact;">${escapeHtml(row.groupName)}</td>
        <td>${escapeHtml(a.studentName)}</td>
        <td style="text-align:center;font-weight:700;font-size:12px;${cal === 'NP' ? 'color:#be123c;' : ''}">${cal}</td>
        <td style="text-align:center;">${escapeHtml(fecha)}</td>
        <td style="text-align:center;font-weight:600;${observ === 'BAJA PENDIENTE' ? 'color:#be123c;' : ''}">${observ}</td>
        <td style="height:24px;"></td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Concentrado Extraordinarios ${opLabelCorta} — ${escapeHtml(subjectName)} (todos los grupos)</title>
<style>
  @page { size: letter portrait; margin: 10mm 12mm 8mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 3px 5px; border: 1px solid #333; }
  thead { background: #e0e0e0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tbody tr { page-break-inside: avoid; }
  .titulo-doc { text-align: center; margin: 6px 0 10px; }
  .titulo-doc .t1 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .titulo-doc .t2 { font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #b91c1c; margin-top: 2px; }
  .titulo-doc .t3 { font-size: 9px; margin-top: 2px; }
  .meta-tabla td.lbl { background: #f3f4f6; font-weight: 700; width: 14%; text-transform: uppercase; font-size: 9px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nota { background: #fef3c7; border-left: 3px solid #d97706; padding: 5px 8px; margin: 8px 0; font-size: 9px; color: #78350f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nota-consolidado { background: #dbeafe; border-left: 3px solid #1d4ed8; padding: 5px 8px; margin: 8px 0; font-size: 9px; color: #1e3a8a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .firma-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 36px; }
  .firma-box { text-align: center; padding: 0 4px; }
  .firma-line { border-top: 1px solid #333; margin: 36px 4px 6px; }
  .firma-label { font-size: 10px; font-weight: 700; text-transform: uppercase; line-height: 1.25; word-break: break-word; }
  .firma-sublabel { font-size: 9px; color: #4b5563; margin-top: 2px; font-weight: 600; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>
</head>
<body>
  <!-- Bandín oficial superior (mismo que en preboletas y print individual) -->
  <div style="text-align:center;margin-bottom:4px;">
    <img src="/img/header-gobierno-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
  </div>
  <div style="text-align:center;margin-bottom:8px;">
    ${headerLines}
    <div style="font-size:9px;font-weight:600;margin-top:4px;">DEPARTAMENTO DE CONTROL ESCOLAR &mdash; TURNO ${escapeHtml(turnosLabel.toUpperCase())}</div>
  </div>

  <div class="titulo-doc">
    <div class="t1">Concentrado Consolidado de Examen Extraordinario por Materia</div>
    <div class="t2">${escapeHtml(opLabel)}</div>
    <div class="t3">CICLO ESCOLAR ${escapeHtml(cicloEscolar)}</div>
  </div>

  <table class="meta-tabla" style="margin-bottom:6px;">
    <tr>
      <td class="lbl">Materia</td><td colspan="3">${escapeHtml(subjectName)}</td>
      <td class="lbl">Fecha</td><td>${escapeHtml(fechaHoy)}</td>
    </tr>
    <tr>
      <td class="lbl">Docente${docentesUnicos.includes('/') ? 's' : ''}</td><td colspan="5">${escapeHtml(docentesUnicos) || '_________________________'}</td>
    </tr>
    <tr>
      <td class="lbl">Grupos</td><td>${totalGruposConAlumnos}</td>
      <td class="lbl">Grados</td><td>${escapeHtml(gradosLabel)}</td>
      <td class="lbl">Turno(s)</td><td>${escapeHtml(turnosLabel)}</td>
    </tr>
  </table>

  <div class="nota-consolidado">
    <strong>📑 Documento consolidado:</strong> reúne en una sola hoja a los alumnos en extraordinario de
    <strong>${totalGruposConAlumnos} grupo${totalGruposConAlumnos > 1 ? 's' : ''}</strong>
    que cursan la misma materia. La columna <strong>GRUPO</strong> identifica el grupo de origen de cada alumno.
  </div>

  ${op === 3
    ? `<div class="nota"><strong>Aviso oficial:</strong> Esta es la 3ª y última oportunidad. Los alumnos con calificación menor a 6 o <strong>NP (No Presentó)</strong> NO acreditarán y se tramitará la baja correspondiente.</div>`
    : op === 2
      ? `<div class="nota"><strong>Aviso:</strong> Esta 2ª oportunidad solo aplica para alumnos que NO acreditaron la 1ª (calificación menor a 6 o NP). La calificación obtenida sustituye a la anterior. Valores válidos: 5-10 o NP.</div>`
      : `<div class="nota"><strong>Aviso:</strong> La calificación obtenida en el examen extraordinario sustituye a la calificación ordinaria. Mínima aprobatoria: 6. Máxima: 10. Mínima a registrar: 5. Si el alumno NO se presenta, registre <strong>NP</strong>.</div>`}

  <table>
    <thead>
      <tr>
        <th style="width:24px;">#</th>
        <th style="width:60px;">GRUPO</th>
        <th style="text-align:left;">NOMBRE DEL ALUMNO</th>
        <th style="width:50px;">CALIF.<br>EXTRA</th>
        <th style="width:90px;">FECHA<br>APLICACIÓN</th>
        <th style="width:80px;">OBSERVACIÓN</th>
        <th style="width:160px;">FIRMA DEL ALUMNO</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  <div style="margin-top:6px;font-size:9px;color:#4b5563;">
    <strong>Total de alumnos en ${escapeHtml(opLabelCorta)} oportunidad (consolidado):</strong> ${filasData.length}
    &nbsp;·&nbsp; <strong>Grupos incluidos:</strong> ${totalGruposConAlumnos}
  </div>

  <div class="firma-row">
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(docentesUnicos || '_________________________')}</div>
      <div class="firma-sublabel">DOCENTE${docentesUnicos.includes('/') ? 'S' : ''} DE LA ASIGNATURA</div>
    </div>
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(subdirName)}</div>
      <div class="firma-sublabel">${escapeHtml(subdirCargo)}</div>
    </div>
    <div class="firma-box">
      <div class="firma-line"></div>
      <div class="firma-label">${escapeHtml(directorName)}</div>
      <div class="firma-sublabel">${escapeHtml(directorCargo)}</div>
    </div>
  </div>

  <!-- Bandín oficial inferior -->
  <div style="text-align:center;margin-top:14px;">
    <img src="/img/bandin-edomex.png" alt="" style="width:100%;max-width:680px;height:auto;" onerror="this.style.display='none'">
  </div>

  <script>setTimeout(() => window.print(), 400);<\/script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('Permite ventanas emergentes para imprimir', 'warning'); return; }
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  function _formatStudentName(stu) {
    return ((stu.apellido1 || '') + ' ' + (stu.apellido2 || '') + ' ' + (stu.nombres || '')).trim().toUpperCase();
  }

  function _displayTeacherName(rawName) {
    if (!rawName) return '_________________________';
    return Utils.displayName ? Utils.displayName(rawName) : rawName;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[c]));
  }

  return { render };
})();

if (typeof Router !== 'undefined' && Router.modules) {
  Router.modules['extraordinarios'] = () => ExtraordinariosModule.render();
}
