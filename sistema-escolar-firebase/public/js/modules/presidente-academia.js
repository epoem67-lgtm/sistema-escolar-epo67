/**
 * PRESIDENTE / SECRETARIO DE ACADEMIA — Sistema Escolar EPO 67
 *
 * Rol ADITIVO: el docente conserva su role base (maestro u
 * orientador_docente) y adicionalmente coordina la academia de un grado+turno.
 * En App.effectiveRoles se le agrega 'presidente_academia' en memoria (app.js)
 * cuando el user doc tiene academiaGrado + academiaTurno seteados.
 *
 * MODELO DE DATOS (users/{uid}):
 *   academiaGrado: number   // 1, 2 o 3
 *   academiaTurno: string   // 'MATUTINO' | 'VESPERTINO'
 *   academiaRol:   string   // 'presidente' | 'secretario'
 *
 * Sembrado por: scripts/fixes/asignar-presidentes-academia.js
 *
 * Permisos en firestore.rules:
 *   - students: isAcademiaScopeOf(groupId) — lee alumnos del grado+turno
 *   - grades:   canMaestro() — los 12 son maestros, ya cubre lectura
 *   - groups/subjects/partials: lectura abierta a autenticados
 *   - NO se consulta /assignments (queda sólo para captura de calificaciones)
 */

const PresidenteAcademiaModule = (() => {
  let _data = null;
  // Default parcial = el último capturado/abierto (calculado en App.warmDefaultPartial
  // al login). Se lee al render, no al init del módulo, para usar el cache más fresco.
  let _filters = { parcial: null };

  // Orden oficial SEP de materias por grado. Copia de INDICADORES_SUBJECTS
  // (concentrado.js:2482). Si se actualiza allá, replicar aquí.
  const SEP_ORDER = {
    1: [
      'LENGUA Y COMUNICACION II', 'INGLES II', 'PENSAMIENTO MATEMATICO II',
      'CULTURA DIGITAL II', 'CIENCIAS NATURALES EXPERIMENTALES Y TECNOLOGIA II',
      'TALLER DE CIENCIAS I', 'PENSAMIENTO FILOSOFICO Y HUMANIDADES II',
      'CIENCIAS SOCIALES II', 'ACTIVIDADES FISICAS Y DEPORTIVAS II',
      'EDUCACION PARA LA SALUD II', 'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS II',
    ],
    2: [
      'PENSAMIENTO LITERARIO', 'INGLES IV', 'TEMAS SELECTOS DE MATEMATICAS I',
      'CONCIENCIA HISTORICA I', 'TALLER DE CULTURA DIGITAL',
      'REACCIONES QUIMICAS Y CONSERVACION DE LA MATERIA', 'ESPACIO Y SOCIEDAD',
      'CIENCIAS SOCIALES III', 'COMUNIDADES VIRTUALES', 'MANTENIMIENTO DE REDES DE COMPUTO',
      'ACTIVIDADES ARTISTICAS Y CULTURALES I', 'EDUCACION INTEGRAL EN SEXUALIDAD Y GENERO II',
      'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS IV',
    ],
    3: [
      'CIENCIAS DE LA COMUNICACION I', 'TEMAS SELECTOS DE INGLES II',
      'TEMAS SELECTOS DE MATEMATICAS II', 'CONCIENCIA HISTORICA III', 'ORGANISMOS',
      'TEMAS SELECTOS DE FILOSOFIA', 'ECONOMIA I', 'PAGINAS WEB', 'DISENO DIGITAL',
      'ACTIVIDADES ARTISTICAS Y CULTURALES III', 'PRACTICA Y COLABORACION CIUDADANA II',
      'TEMAS SELECTOS DE IGUALDAD Y DERECHOS HUMANOS VI',
    ],
  };

  function _normSubj(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  }

  // Ordena `subjects` según el orden oficial SEP del grado. Las materias que
  // no estén en la lista (raro) van al final, alfabéticamente.
  function _sortBySEP(subjects, grado) {
    const order = (SEP_ORDER[grado] || []).map(_normSubj);
    const idxOf = name => {
      const n = _normSubj(name);
      const i = order.findIndex(o => o === n || o.includes(n) || n.includes(o));
      return i === -1 ? 9999 : i;
    };
    return subjects.slice().sort((a, b) => {
      const ia = idxOf(a.nombre || a.id);
      const ib = idxOf(b.nombre || b.id);
      if (ia !== ib) return ia - ib;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });
  }

  function _canAdminOverride() {
    return App.canActAs('admin') || App.canActAs('subdirector') || App.canActAs('directivo');
  }

  function _getMyConfig() {
    const u = App.currentUser || {};
    const canOverride = _canAdminOverride();

    // ADMIN OVERRIDE: si el usuario es admin/subdirector/directivo y eligió
    // grado+turno con el selector, mostrar esa academia. Permite ver
    // CUALQUIER academia sin tener que impersonar a un presidente.
    if (canOverride && _filters.adminGrado && _filters.adminTurno) {
      const grado = Number(_filters.adminGrado);
      const turno = _filters.adminTurno;
      const turnoLabel = turno === 'MATUTINO' ? 'Matutino' : 'Vespertino';
      return {
        grado, turno,
        rol: 'admin-view',
        cargo: 'Vista de Administrador',
        nombre: `Academia · ${grado}° ${turnoLabel}`,
        isAdminView: true,
      };
    }

    // ADMIN SIN OVERRIDE elegido todavía: default a 1° matutino para que
    // el módulo cargue algo (en lugar del mensaje "no configurada").
    if (canOverride && (!u.academiaGrado || !u.academiaTurno)) {
      return {
        grado: 1, turno: 'MATUTINO',
        rol: 'admin-view',
        cargo: 'Vista de Administrador',
        nombre: 'Academia · 1° Matutino',
        isAdminView: true,
      };
    }

    // Presidente/Secretario normal: lee de su user doc
    const grado = u.academiaGrado != null ? Number(u.academiaGrado) : null;
    const turno = u.academiaTurno || null;
    const rol = (u.academiaRol || '').toLowerCase();
    const cargo = rol === 'secretario' ? 'Secretario' : 'Presidente';
    const turnoLabel = turno === 'MATUTINO' ? 'Matutino' : turno === 'VESPERTINO' ? 'Vespertino' : '';
    const nombre = grado && turno
      ? `${cargo} de Academia · ${grado}° ${turnoLabel}`
      : 'Mi Academia';
    return { grado, turno, rol, cargo, nombre, isAdminView: false };
  }

  async function renderDashboard(container) {
    // Si aún no hay parcial elegido por el usuario, usar el default global
    // (último capturado). Refresca el cache si está vacío.
    if (!_filters.parcial) {
      try { await App.warmDefaultPartial(); } catch (_) {}
      _filters.parcial = App.getDefaultPartial();
    }
    const cfg = _getMyConfig();
    container.innerHTML = UI.loadingState('Cargando indicadores de tu academia…');

    if (!cfg.grado || !cfg.turno) {
      container.innerHTML = UI.moduleContainer([
        UI.pageHeader(cfg.nombre, 'Indicadores académicos de tu grado y turno'),
        `<div class="alert alert-warning" style="margin:14px 0;">
          <strong>⚠ Tu academia no está configurada todavía.</strong><br>
          Pide a un administrador que ejecute el script
          <code>scripts/fixes/asignar-presidentes-academia.js --apply</code>
          o que edite tu usuario para asignar
          <code>academiaGrado</code>, <code>academiaTurno</code> y
          <code>academiaRol</code>.
        </div>`
      ].join(''));
      return;
    }

    try {
      const [groupsAll, subjectsAll, partials] = await Promise.all([
        Store.getGroups(), Store.getSubjects(), Store.getPartials(),
      ]);

      const scopedGroups = groupsAll.filter(g =>
        Number(g.grado) === cfg.grado && g.turno === cfg.turno
      );
      const groupIds = scopedGroups.map(g => g.id);

      const students = groupIds.length > 0
        ? await Store.getStudentsByGroups(groupIds)
        : [];
      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      let allGrades = [];
      try {
        allGrades = groupIds.length > 0 ? await Store.getGradesByGroups(groupIds, true) : [];
      } catch (e) { console.warn('grades load deferred', e); }

      // FIX v8.06: solo subjectIds del grado actual (drop G2_ leftovers en 3°, etc.).
      // Antes incluía cualquier subjectId que apareciera en grades — incluyendo
      // datos huérfanos donde el subjectId pertenece a otro grado.
      const gradoPrefix = cfg.grado ? `G${cfg.grado}_` : null;
      const subjectIdsInScope = new Set(
        allGrades
          .map(g => g.subjectId)
          .filter(sid => !gradoPrefix || String(sid).startsWith(gradoPrefix))
      );
      const subjectsMine = subjectsAll.filter(s => subjectIdsInScope.has(s.id));

      _data = {
        cfg, scopedGroups, subjectsMine, students, activeStudents, allGrades, partials,
      };

      _renderFull();
    } catch (e) {
      console.error('Error renderizando academia:', e);
      container.innerHTML = UI.errorState('Error al cargar tu academia: ' + (e.message || ''));
    }
  }

  function _renderFull() {
    const container = document.getElementById('moduleContainer');
    if (!container || !_data) return;

    const { cfg, scopedGroups, activeStudents, allGrades } = _data;

    let grades = allGrades;
    if (_filters.parcial && _filters.parcial !== 'ACUM') {
      grades = grades.filter(g => g.partial === _filters.parcial);
    }

    const filteredGroups = scopedGroups;
    const filteredGroupIds = new Set(filteredGroups.map(g => g.id));

    const studentsFiltered = activeStudents.filter(s => filteredGroupIds.has(s.groupId));
    const studentIds = new Set(studentsFiltered.map(s => s.id));
    grades = grades.filter(g => studentIds.has(g.studentId) && filteredGroupIds.has(g.groupId));

    // Solo mostrar materias con al menos 1 calificación VÁLIDA (numérica) en
    // el parcial actual. Algunas materias tienen docs en `grades` con cal=null
    // (placeholder de captura abierta sin valor) — sin checar validez aparecen
    // con "0 alumnos eval / — / — / —" en pantalla.
    const subjectsConDatos = new Set(
      grades
        .filter(g => {
          const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
          return !isNaN(c);
        })
        .map(g => g.subjectId)
    );
    const subjectsMine = _sortBySEP(
      _data.subjectsMine.filter(s => subjectsConDatos.has(s.id)),
      cfg.grado
    );

    const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
    const cals = grades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
    const promedio = cals.length ? (cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : '—';
    const incidencias = cals.filter(c => c < passGrade).length;

    const failsByStudent = {};
    const evaluatedSet = new Set();
    grades.forEach(g => {
      const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
      if (isNaN(c)) return;
      evaluatedSet.add(g.studentId);
      if (c < passGrade) failsByStudent[g.studentId] = (failsByStudent[g.studentId] || 0) + 1;
    });
    const totalEval = evaluatedSet.size;
    const irregulares = Object.keys(failsByStudent).length;
    const aprobados = totalEval - irregulares;
    const pctIrreg = totalEval > 0 ? ((irregulares * 100) / totalEval).toFixed(1) : '—';
    const pctAprob = totalEval > 0 ? ((aprobados * 100) / totalEval).toFixed(1) : '—';

    const numAlumnos = studentsFiltered.length;
    const numGrupos = filteredGroups.length;
    const numMaterias = subjectsMine.length;

    const META_PROM = 8.3, META_IRREG = 14;
    const promCumple = promedio !== '—' && parseFloat(promedio) >= META_PROM;
    const irregCumple = pctIrreg !== '—' && parseFloat(pctIrreg) <= META_IRREG;

    const matRows = subjectsMine.map(subj => {
      const subjGrades = grades.filter(g => g.subjectId === subj.id);
      const subjCals = subjGrades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
      const subjProm = subjCals.length ? (subjCals.reduce((a, b) => a + b, 0) / subjCals.length).toFixed(2) : '—';
      const subjEvalStudents = new Set();
      let subjReprobStudents = 0;
      subjGrades.forEach(g => {
        const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
        if (isNaN(c)) return;
        subjEvalStudents.add(g.studentId);
        if (c < passGrade) subjReprobStudents++;
      });
      const subjTotalEval = subjEvalStudents.size;
      const subjAprob = subjTotalEval - subjReprobStudents;
      const subjPctIrr = subjTotalEval > 0 ? ((subjReprobStudents * 100) / subjTotalEval).toFixed(1) : '—';
      const promBg = subjProm !== '—' && parseFloat(subjProm) < META_PROM ? 'background:#fee2e2;' : '';
      const irrBg = subjPctIrr !== '—' && parseFloat(subjPctIrr) > META_IRREG ? 'background:#fee2e2;' : '';
      return `<tr>
        <td>${Utils.sanitize(subj.nombre || subj.id)}</td>
        <td style="text-align:center;">${subjTotalEval}</td>
        <td style="text-align:center;font-weight:700;${promBg}">${subjProm}</td>
        <td style="text-align:center;color:#16a34a;font-weight:600;">${subjTotalEval > 0 ? subjAprob : '—'}</td>
        <td style="text-align:center;font-weight:700;${irrBg}">${subjTotalEval > 0 ? `${subjReprobStudents} (${subjPctIrr}%)` : '—'}</td>
      </tr>`;
    }).join('');

    const grpRows = filteredGroups.map(grp => {
      const grpStudents = studentsFiltered.filter(s => s.groupId === grp.id);
      const grpGrades = grades.filter(g => g.groupId === grp.id);
      const grpCals = grpGrades.map(g => Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN))).filter(c => !isNaN(c));
      const grpProm = grpCals.length ? (grpCals.reduce((a, b) => a + b, 0) / grpCals.length).toFixed(2) : '—';
      const grpFails = {};
      const grpEvalSet = new Set();
      grpGrades.forEach(g => {
        const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
        if (isNaN(c)) return;
        grpEvalSet.add(g.studentId);
        if (c < passGrade) grpFails[g.studentId] = (grpFails[g.studentId] || 0) + 1;
      });
      const grpTotalEval = grpEvalSet.size;
      const grpIrreg = Object.keys(grpFails).length;
      const grpAprob = grpTotalEval - grpIrreg;
      const grpPctIrr = grpTotalEval > 0 ? ((grpIrreg * 100) / grpTotalEval).toFixed(1) : '—';
      const promBg = grpProm !== '—' && parseFloat(grpProm) < META_PROM ? 'background:#fee2e2;' : '';
      const irrBg = grpPctIrr !== '—' && parseFloat(grpPctIrr) > META_IRREG ? 'background:#fee2e2;' : '';
      return `<tr>
        <td><strong>${Utils.sanitize(grp.nombre)}</strong></td>
        <td style="text-align:center;">${grpStudents.length}</td>
        <td style="text-align:center;font-weight:700;${promBg}">${grpProm}</td>
        <td style="text-align:center;color:#16a34a;font-weight:600;">${grpTotalEval > 0 ? grpAprob : '—'}</td>
        <td style="text-align:center;font-weight:700;${irrBg}">${grpTotalEval > 0 ? `${grpIrreg} (${grpPctIrr}%)` : '—'}</td>
      </tr>`;
    }).join('');

    container.innerHTML = UI.moduleContainer([
      UI.pageHeader(
        cfg.nombre,
        `Indicadores de ${numAlumnos} alumnos en ${numGrupos} grupos · ${numMaterias} materias activas`
      ),
      _renderAdminSelector(cfg),
      _renderFilters(),
      _renderKPIs({ numAlumnos, numGrupos, numMaterias, promedio, totalEval, aprobados, irregulares, pctAprob, pctIrreg, incidencias, promCumple, irregCumple }),
      _renderDownloads(),
      `<div class="card" style="margin-top:18px;">
        <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;">📚 Por Materia</h3>
          <span style="font-size:12px;color:#6b7280;">${subjectsMine.length} materias</span>
        </div>
        <p style="margin:0;padding:0 18px 6px;font-size:11px;color:#6b7280;">
          <strong>Aprobados / Irregulares:</strong> alumnos sin / con reprobada en esa materia. NO son sumatorias — un mismo alumno aparece UNA vez.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead style="background:#1e40af;color:#fff;"><tr>
              <th style="text-align:left;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Materia</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Alumnos eval.</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Promedio</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Aprobados</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Irregulares</th>
            </tr></thead>
            <tbody>${matRows || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#9ca3af;">Sin datos en este parcial.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`,
      `<div class="card" style="margin-top:14px;">
        <div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;">👥 Por Grupo</h3>
          <span style="font-size:12px;color:#6b7280;">${filteredGroups.length} grupos · ${cfg.grado}° ${cfg.turno}</span>
        </div>
        <p style="margin:0;padding:0 18px 6px;font-size:11px;color:#6b7280;">
          <strong>Irregulares:</strong> alumnos del grupo con ≥1 reprobada en CUALQUIER materia.
        </p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead style="background:#1e40af;color:#fff;"><tr>
              <th style="text-align:left;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Grupo</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Alumnos</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Promedio</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Aprobados</th>
              <th style="text-align:center;padding:12px 14px;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">Irregulares</th>
            </tr></thead>
            <tbody>${grpRows || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#9ca3af;">No hay grupos en tu academia.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`,
    ].join(''));

    _bindEvents();
  }

  // Selector de academia visible SOLO para admin/subdirector/directivo.
  // Permite ver cualquier grado + turno sin tener que impersonar.
  function _renderAdminSelector(cfg) {
    if (!cfg.isAdminView) return '';
    const gradoOpts = [1, 2, 3].map(g =>
      `<option value="${g}"${cfg.grado === g ? ' selected' : ''}>${g}° Grado</option>`
    ).join('');
    const turnoOpts = ['MATUTINO', 'VESPERTINO'].map(t =>
      `<option value="${t}"${cfg.turno === t ? ' selected' : ''}>${t === 'MATUTINO' ? 'Matutino' : 'Vespertino'}</option>`
    ).join('');
    return `<div class="card" style="padding:14px 18px;margin-bottom:14px;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-left:5px solid #d97706;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <strong style="color:#92400e;font-size:15px;">🛠️ Vista de Administrador</strong>
          <div style="font-size:13px;color:#78350f;margin-top:2px;">Como admin puedes ver cualquier academia. Selecciona grado y turno:</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <select id="adm-acad-grado" class="form-control" style="padding:8px 14px;border:1px solid #d97706;border-radius:8px;font-weight:600;background:#fff;">${gradoOpts}</select>
          <select id="adm-acad-turno" class="form-control" style="padding:8px 14px;border:1px solid #d97706;border-radius:8px;font-weight:600;background:#fff;">${turnoOpts}</select>
        </div>
      </div>
    </div>`;
  }

  function _renderFilters() {
    return `<div class="chip-filter-bar" style="padding:12px 16px;margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap;">
      <div class="chip-filter-row" style="margin:0;display:flex;align-items:center;gap:8px;">
        <span class="chip-filter-label" style="font-weight:600;">Parcial:</span>
        <div class="chip-group">
          ${K.PARCIALES.map(p => `<button class="chip${p.id === _filters.parcial ? ' active' : ''}" data-filter="parcial" data-value="${p.id}">${p.nombre}</button>`).join('')}
          <button class="chip${_filters.parcial === 'ACUM' ? ' active' : ''}" data-filter="parcial" data-value="ACUM">📊 Acumulado</button>
        </div>
      </div>
    </div>`;
  }

  function _renderKPIs(k) {
    const card = (icon, label, value, sub, ok) => {
      const color = ok === true ? '#16a34a' : ok === false ? '#dc2626' : '#0891b2';
      return `<div class="card" style="padding:18px 20px;border-left:5px solid ${color};">
        <div style="font-size:28px;">${icon}</div>
        <div style="font-size:32px;font-weight:900;color:${color};">${value}</div>
        <div style="font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;">${label}</div>
        ${sub ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px;">${sub}</div>` : ''}
      </div>`;
    };
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-bottom:18px;">
      ${card('👥', 'Alumnos', k.numAlumnos, `en ${k.numGrupos} grupos`)}
      ${card('📚', 'Materias', k.numMaterias, 'con captura')}
      ${card('📈', 'Promedio', k.promedio, 'meta ≥ 8.3', k.promCumple)}
      ${card('✅', 'Alumnos Aprobados', k.totalEval > 0 ? `${k.aprobados}` : '—', k.totalEval > 0 ? `de ${k.totalEval} (${k.pctAprob}%) sin reprobadas` : 'sin datos')}
      ${card('🚨', 'Alumnos Irregulares', k.totalEval > 0 ? `${k.irregulares}` : '—', k.totalEval > 0 ? `${k.pctIrreg}% · meta ≤ 14%` : 'sin datos', k.irregCumple)}
    </div>`;
  }

  function _renderDownloads() {
    return `<div class="card" style="padding:14px 18px;margin-bottom:14px;background:linear-gradient(135deg,#ecfeff 0%,#cffafe 100%);border-left:5px solid #0891b2;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <strong style="color:#155e75;font-size:15px;">📥 Descargar estadísticas de tu academia</strong>
          <div style="font-size:13px;color:#0e7490;margin-top:2px;">Genera un Excel con el detalle de tus materias y grupos.</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" data-action="download-excel" style="background:#0891b2;border-color:#0891b2;">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:6px;">grid_on</span>Excel de mi academia
          </button>
        </div>
      </div>
    </div>`;
  }

  function _bindEvents() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.querySelectorAll('.chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        const f = chip.dataset.filter;
        const v = chip.dataset.value;
        _filters[f] = v;
        _renderFull();
      });
    });

    const downloadBtn = container.querySelector('[data-action="download-excel"]');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => _downloadExcel());
    }

    // Admin selector: al cambiar grado o turno, recargar dashboard completo
    // (los datos vienen de Firestore filtrados por grupo, así que cambiar el
    // scope requiere fetch nuevo de students/grades).
    const admGrado = container.querySelector('#adm-acad-grado');
    const admTurno = container.querySelector('#adm-acad-turno');
    const onAdminChange = () => {
      if (!admGrado || !admTurno) return;
      _filters.adminGrado = admGrado.value;
      _filters.adminTurno = admTurno.value;
      renderDashboard(container);
    };
    if (admGrado) admGrado.addEventListener('change', onAdminChange);
    if (admTurno) admTurno.addEventListener('change', onAdminChange);
  }

  async function _downloadExcel() {
    if (!_data) return;
    Toast.show('Generando Excel…', 'info');
    try {
      await Lib.exceljs();
      const ExcelJS = window.ExcelJS;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EPO 67';
      wb.created = new Date();

      const { cfg, scopedGroups, activeStudents, allGrades } = _data;
      const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;
      const META_PROM = 8.3, META_IRREG = 14;
      const parcialFiltro = _filters.parcial;
      const parcialLabel = parcialFiltro === 'ACUM'
        ? 'Acumulado'
        : (K.PARCIALES.find(p => p.id === parcialFiltro)?.nombre || parcialFiltro);

      const escuelaNombre = (App.schoolConfig && App.schoolConfig.nombre) || 'EPO 67';
      const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';

      // ─── Estilos comunes ───
      const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF1E40AF' } },
        left: { style: 'thin', color: { argb: 'FF1E40AF' } },
        bottom: { style: 'thin', color: { argb: 'FF1E40AF' } },
        right: { style: 'thin', color: { argb: 'FF1E40AF' } }
      };
      const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0891B2' } };
      const titleFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 };
      const subtitleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      const subtitleFont = { bold: true, color: { argb: 'FF1E3A8A' }, size: 11 };
      const center = { horizontal: 'center', vertical: 'middle', wrapText: true };
      const left = { horizontal: 'left', vertical: 'middle', wrapText: true };

      function applyHeaderRow(ws, row, fromCol, toCol) {
        for (let c = fromCol; c <= toCol; c++) {
          const cell = ws.getCell(row, c);
          cell.font = headerFont;
          cell.fill = headerFill;
          cell.alignment = center;
          cell.border = thinBorder;
        }
        ws.getRow(row).height = 28;
      }

      // ═══ Pre-cálculo de stats ═══
      // Grades del scope filtradas por parcial
      let grades = allGrades;
      if (parcialFiltro && parcialFiltro !== 'ACUM') {
        grades = grades.filter(g => g.partial === parcialFiltro);
      }
      const studentIds = new Set(activeStudents.map(s => s.id));
      grades = grades.filter(g => studentIds.has(g.studentId));

      // Solo materias con al menos 1 calificación VÁLIDA (numérica) en el
      // parcial actual. Algunas materias tienen docs en `grades` con cal=null
      // (placeholder) — sin checar validez salen filas vacías en el Excel.
      const subjectsConDatos = new Set(
        grades
          .filter(g => {
            const c = Number(g.cal != null ? g.cal : (g.value != null ? g.value : NaN));
            return !isNaN(c);
          })
          .map(g => g.subjectId)
      );
      const subjectsMine = _sortBySEP(
        _data.subjectsMine.filter(s => subjectsConDatos.has(s.id)),
        cfg.grado
      );

      // Reprobadas por alumno
      const failsByStudent = {};
      const failsBySubjectByStudent = {};
      const evaluatedSet = new Set();
      grades.forEach(g => {
        const cal = Number(g.cal != null ? g.cal : g.value);
        if (isNaN(cal)) return;
        evaluatedSet.add(g.studentId);
        if (cal < passGrade) {
          failsByStudent[g.studentId] = (failsByStudent[g.studentId] || 0) + 1;
          if (!failsBySubjectByStudent[g.studentId]) failsBySubjectByStudent[g.studentId] = [];
          failsBySubjectByStudent[g.studentId].push(g.subjectId);
        }
      });
      const totalEvaluados = evaluatedSet.size;
      const totalIrregulares = Object.keys(failsByStudent).length;
      const totalAprobados = totalEvaluados - totalIrregulares;
      const promGlobal = (() => {
        const cals = grades.map(g => Number(g.cal != null ? g.cal : g.value)).filter(c => !isNaN(c));
        return cals.length > 0 ? +(cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : null;
      })();
      const pctIrregGlobal = totalEvaluados > 0 ? +((totalIrregulares * 100) / totalEvaluados).toFixed(1) : 0;
      const pctAprobGlobal = totalEvaluados > 0 ? +((totalAprobados * 100) / totalEvaluados).toFixed(1) : 0;

      // ═══════════════════════════════════════════════════════════════
      // HOJA 1 — RESUMEN
      // ═══════════════════════════════════════════════════════════════
      const ws1 = wb.addWorksheet('Resumen', {
        pageSetup: { paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      ws1.getColumn(1).width = 28;
      ws1.getColumn(2).width = 22;
      ws1.getColumn(3).width = 18;
      ws1.getColumn(4).width = 22;

      // Título
      ws1.mergeCells('A1:D1');
      ws1.getCell('A1').value = escuelaNombre;
      ws1.getCell('A1').font = titleFont;
      ws1.getCell('A1').fill = titleFill;
      ws1.getCell('A1').alignment = center;
      ws1.getRow(1).height = 32;

      ws1.mergeCells('A2:D2');
      ws1.getCell('A2').value = cfg.nombre;
      ws1.getCell('A2').font = { bold: true, color: { argb: 'FF1E40AF' }, size: 13 };
      ws1.getCell('A2').fill = subtitleFill;
      ws1.getCell('A2').alignment = center;
      ws1.getRow(2).height = 24;

      // Info de cabecera
      const infoRows = [
        ['Escuela',          escuelaNombre],
        ['Ciclo escolar',    cicloEscolar],
        ['Academia',         `${cfg.grado}° ${cfg.turno}`],
        ['Rol',              cfg.cargo],
        ['Parcial',          parcialLabel],
        ['Generado',         new Date().toLocaleString('es-MX')],
      ];
      infoRows.forEach(([k, v], i) => {
        const r = 4 + i;
        ws1.getCell(r, 1).value = k;
        ws1.getCell(r, 1).font = { bold: true, color: { argb: 'FF374151' } };
        ws1.getCell(r, 1).alignment = left;
        ws1.getCell(r, 1).border = thinBorder;
        ws1.mergeCells(r, 2, r, 4);
        ws1.getCell(r, 2).value = v;
        ws1.getCell(r, 2).alignment = left;
        ws1.getCell(r, 2).border = thinBorder;
      });

      // KPIs principales
      const kpiStart = 11;
      ws1.mergeCells(kpiStart, 1, kpiStart, 4);
      ws1.getCell(kpiStart, 1).value = '📊 INDICADORES DE TU ACADEMIA';
      ws1.getCell(kpiStart, 1).font = subtitleFont;
      ws1.getCell(kpiStart, 1).fill = subtitleFill;
      ws1.getCell(kpiStart, 1).alignment = center;
      ws1.getRow(kpiStart).height = 24;

      const kpiHeaders = ['Indicador', 'Valor', 'Meta', 'Estado'];
      kpiHeaders.forEach((h, i) => {
        const c = ws1.getCell(kpiStart + 1, 1 + i);
        c.value = h;
        c.font = headerFont;
        c.fill = headerFill;
        c.alignment = center;
        c.border = thinBorder;
      });

      const kpiData = [
        ['Alumnos del scope',     activeStudents.length,                              '—',          ''],
        ['Grupos',                scopedGroups.length,                                '—',          ''],
        ['Materias con captura',  subjectsMine.length,                                '—',          ''],
        ['Alumnos evaluados',     totalEvaluados,                                     '—',          ''],
        ['Promedio',              promGlobal != null ? promGlobal : '—',              `≥ ${META_PROM}`,    promGlobal != null && promGlobal >= META_PROM ? '✓' : '✗'],
        ['Alumnos aprobados',     totalAprobados,                                     '—',          ''],
        ['% Aprobación',          totalEvaluados > 0 ? pctAprobGlobal + '%' : '—',    '—',          ''],
        ['Alumnos irregulares',   totalIrregulares,                                   '—',          ''],
        ['% Reprobación',         totalEvaluados > 0 ? pctIrregGlobal + '%' : '—',    `≤ ${META_IRREG}%`,  totalEvaluados > 0 && pctIrregGlobal <= META_IRREG ? '✓' : '✗'],
      ];
      kpiData.forEach((row, i) => {
        const r = kpiStart + 2 + i;
        row.forEach((v, ci) => {
          const c = ws1.getCell(r, 1 + ci);
          c.value = v;
          c.alignment = ci === 0 ? left : center;
          c.border = thinBorder;
          if (ci === 0) c.font = { bold: true };
          if (ci === 3) {
            if (v === '✓') {
              c.font = { bold: true, color: { argb: 'FF16A34A' }, size: 13 };
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
            } else if (v === '✗') {
              c.font = { bold: true, color: { argb: 'FFDC2626' }, size: 13 };
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            }
          }
        });
      });

      // ═══════════════════════════════════════════════════════════════
      // HOJA 2 — POR MATERIA
      // ═══════════════════════════════════════════════════════════════
      const ws2 = wb.addWorksheet('Por Materia', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      ws2.getColumn(1).width = 40;
      [14, 14, 14, 14, 14, 14].forEach((w, i) => ws2.getColumn(2 + i).width = w);

      ws2.mergeCells('A1:G1');
      ws2.getCell('A1').value = `📚 INDICADORES POR MATERIA · ${cfg.grado}° ${cfg.turno} · ${parcialLabel}`;
      ws2.getCell('A1').font = titleFont;
      ws2.getCell('A1').fill = titleFill;
      ws2.getCell('A1').alignment = center;
      ws2.getRow(1).height = 32;

      const matHeaders = ['Materia', 'Alumnos evaluados', 'Promedio', 'Aprobados', '% Aprobación', 'Irregulares', '% Reprobación'];
      matHeaders.forEach((h, i) => {
        ws2.getCell(2, 1 + i).value = h;
      });
      applyHeaderRow(ws2, 2, 1, 7);

      const matData = subjectsMine.map(subj => {
        const subjGrades = grades.filter(g => g.subjectId === subj.id);
        const cals = subjGrades.map(g => Number(g.cal != null ? g.cal : g.value)).filter(c => !isNaN(c));
        const prom = cals.length > 0 ? +(cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : null;
        const evalSet = new Set();
        let rep = 0;
        subjGrades.forEach(g => {
          const c = Number(g.cal != null ? g.cal : g.value);
          if (isNaN(c)) return;
          evalSet.add(g.studentId);
          if (c < passGrade) rep++;
        });
        const tot = evalSet.size;
        const aprob = tot - rep;
        const pctAprob = tot > 0 ? +((aprob * 100) / tot).toFixed(1) : null;
        const pctRep = tot > 0 ? +((rep * 100) / tot).toFixed(1) : null;
        return { nombre: subj.nombre || subj.id, tot, prom, aprob, pctAprob, rep, pctRep };
      }); // ya viene en orden SEP porque subjectsMine fue ordenado con _sortBySEP

      matData.forEach((m, i) => {
        const r = 3 + i;
        ws2.getCell(r, 1).value = m.nombre;
        ws2.getCell(r, 1).alignment = left;
        ws2.getCell(r, 2).value = m.tot;
        ws2.getCell(r, 3).value = m.prom != null ? m.prom : '—';
        ws2.getCell(r, 4).value = m.tot > 0 ? m.aprob : '—';
        ws2.getCell(r, 5).value = m.pctAprob != null ? m.pctAprob / 100 : '—';
        ws2.getCell(r, 5).numFmt = '0.0%';
        ws2.getCell(r, 6).value = m.tot > 0 ? m.rep : '—';
        ws2.getCell(r, 7).value = m.pctRep != null ? m.pctRep / 100 : '—';
        ws2.getCell(r, 7).numFmt = '0.0%';

        for (let c = 1; c <= 7; c++) {
          ws2.getCell(r, c).border = thinBorder;
          if (c !== 1) ws2.getCell(r, c).alignment = center;
        }

        // Resaltar promedio bajo
        if (m.prom != null && m.prom < META_PROM) {
          ws2.getCell(r, 3).font = { bold: true, color: { argb: 'FFB91C1C' } };
          ws2.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
        // Resaltar % reprobación alto
        if (m.pctRep != null && m.pctRep > META_IRREG) {
          ws2.getCell(r, 7).font = { bold: true, color: { argb: 'FFB91C1C' } };
          ws2.getCell(r, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      });

      // ═══════════════════════════════════════════════════════════════
      // HOJA 3 — POR GRUPO
      // ═══════════════════════════════════════════════════════════════
      const ws3 = wb.addWorksheet('Por Grupo', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      ws3.getColumn(1).width = 18;
      [14, 14, 14, 14, 14, 14].forEach((w, i) => ws3.getColumn(2 + i).width = w);

      ws3.mergeCells('A1:G1');
      ws3.getCell('A1').value = `👥 INDICADORES POR GRUPO · ${cfg.grado}° ${cfg.turno} · ${parcialLabel}`;
      ws3.getCell('A1').font = titleFont;
      ws3.getCell('A1').fill = titleFill;
      ws3.getCell('A1').alignment = center;
      ws3.getRow(1).height = 32;

      const grpHeaders = ['Grupo', 'Alumnos del grupo', 'Promedio', 'Aprobados', '% Aprobación', 'Irregulares', '% Reprobación'];
      grpHeaders.forEach((h, i) => { ws3.getCell(2, 1 + i).value = h; });
      applyHeaderRow(ws3, 2, 1, 7);

      const grpData = scopedGroups.map(grp => {
        const grpStudents = activeStudents.filter(s => s.groupId === grp.id);
        const grpStudentIds = new Set(grpStudents.map(s => s.id));
        const grpGrades = grades.filter(g => grpStudentIds.has(g.studentId));
        const cals = grpGrades.map(g => Number(g.cal != null ? g.cal : g.value)).filter(c => !isNaN(c));
        const prom = cals.length > 0 ? +(cals.reduce((a, b) => a + b, 0) / cals.length).toFixed(2) : null;
        const failsInGrp = {};
        const evalInGrp = new Set();
        grpGrades.forEach(g => {
          const c = Number(g.cal != null ? g.cal : g.value);
          if (isNaN(c)) return;
          evalInGrp.add(g.studentId);
          if (c < passGrade) failsInGrp[g.studentId] = (failsInGrp[g.studentId] || 0) + 1;
        });
        const tot = evalInGrp.size;
        const rep = Object.keys(failsInGrp).length;
        const aprob = tot - rep;
        const pctAprob = tot > 0 ? +((aprob * 100) / tot).toFixed(1) : null;
        const pctRep = tot > 0 ? +((rep * 100) / tot).toFixed(1) : null;
        return { nombre: grp.nombre, totalAlumnos: grpStudents.length, tot, prom, aprob, pctAprob, rep, pctRep };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre));

      grpData.forEach((g, i) => {
        const r = 3 + i;
        ws3.getCell(r, 1).value = g.nombre;
        ws3.getCell(r, 1).font = { bold: true };
        ws3.getCell(r, 1).alignment = center;
        ws3.getCell(r, 2).value = g.totalAlumnos;
        ws3.getCell(r, 3).value = g.prom != null ? g.prom : '—';
        ws3.getCell(r, 4).value = g.tot > 0 ? g.aprob : '—';
        ws3.getCell(r, 5).value = g.pctAprob != null ? g.pctAprob / 100 : '—';
        ws3.getCell(r, 5).numFmt = '0.0%';
        ws3.getCell(r, 6).value = g.tot > 0 ? g.rep : '—';
        ws3.getCell(r, 7).value = g.pctRep != null ? g.pctRep / 100 : '—';
        ws3.getCell(r, 7).numFmt = '0.0%';

        for (let c = 1; c <= 7; c++) {
          ws3.getCell(r, c).border = thinBorder;
          if (c >= 2) ws3.getCell(r, c).alignment = center;
        }

        if (g.prom != null && g.prom < META_PROM) {
          ws3.getCell(r, 3).font = { bold: true, color: { argb: 'FFB91C1C' } };
          ws3.getCell(r, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
        if (g.pctRep != null && g.pctRep > META_IRREG) {
          ws3.getCell(r, 7).font = { bold: true, color: { argb: 'FFB91C1C' } };
          ws3.getCell(r, 7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      });

      // ═══════════════════════════════════════════════════════════════
      // HOJA 4 — ALUMNOS IRREGULARES (con materias reprobadas)
      // ═══════════════════════════════════════════════════════════════
      const ws4 = wb.addWorksheet('Alumnos Irregulares', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });
      ws4.getColumn(1).width = 6;
      ws4.getColumn(2).width = 36;
      ws4.getColumn(3).width = 12;
      ws4.getColumn(4).width = 14;
      ws4.getColumn(5).width = 60;

      ws4.mergeCells('A1:E1');
      ws4.getCell('A1').value = `🚨 ALUMNOS IRREGULARES · ${cfg.grado}° ${cfg.turno} · ${parcialLabel}`;
      ws4.getCell('A1').font = titleFont;
      ws4.getCell('A1').fill = titleFill;
      ws4.getCell('A1').alignment = center;
      ws4.getRow(1).height = 32;

      const irrHeaders = ['#', 'Apellidos y nombre', 'Grupo', 'Materias reprobadas', 'Materias'];
      irrHeaders.forEach((h, i) => { ws4.getCell(2, 1 + i).value = h; });
      applyHeaderRow(ws4, 2, 1, 5);

      const subjectMap = {}; subjectsMine.forEach(s => { subjectMap[s.id] = s.nombre || s.id; });
      const groupMap = {}; scopedGroups.forEach(g => { groupMap[g.id] = g.nombre; });

      const irregulares = Object.keys(failsByStudent)
        .map(sid => {
          const stu = activeStudents.find(s => s.id === sid);
          if (!stu) return null;
          const nombre = ((stu.apellido1 || '') + ' ' + (stu.apellido2 || '') + ' ' + (stu.nombres || '')).trim();
          const matIds = failsBySubjectByStudent[sid] || [];
          // Materias reprobadas en orden SEP (no alfabético) para consistencia
          // con el resto del Excel.
          const sepOrderNorm = (SEP_ORDER[cfg.grado] || []).map(_normSubj);
          const matNombres = matIds
            .map(mid => subjectMap[mid] || mid)
            .sort((a, b) => {
              const na = _normSubj(a), nb = _normSubj(b);
              const ia = sepOrderNorm.findIndex(o => o === na || o.includes(na) || na.includes(o));
              const ib = sepOrderNorm.findIndex(o => o === nb || o.includes(nb) || nb.includes(o));
              const aa = ia === -1 ? 9999 : ia;
              const bb = ib === -1 ? 9999 : ib;
              return aa !== bb ? aa - bb : a.localeCompare(b);
            });
          return {
            nombre,
            grupo: groupMap[stu.groupId] || '',
            count: failsByStudent[sid],
            materias: matNombres.join(', ')
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre));

      if (irregulares.length === 0) {
        ws4.mergeCells('A3:E3');
        ws4.getCell('A3').value = '✓ Ningún alumno irregular en este parcial — ¡felicidades!';
        ws4.getCell('A3').font = { italic: true, color: { argb: 'FF16A34A' }, bold: true, size: 12 };
        ws4.getCell('A3').alignment = center;
        ws4.getCell('A3').border = thinBorder;
      } else {
        irregulares.forEach((alu, i) => {
          const r = 3 + i;
          ws4.getCell(r, 1).value = i + 1;
          ws4.getCell(r, 2).value = alu.nombre;
          ws4.getCell(r, 3).value = alu.grupo;
          ws4.getCell(r, 4).value = alu.count;
          ws4.getCell(r, 5).value = alu.materias;

          ws4.getCell(r, 1).alignment = center;
          ws4.getCell(r, 2).alignment = left;
          ws4.getCell(r, 3).alignment = center;
          ws4.getCell(r, 4).alignment = center;
          ws4.getCell(r, 5).alignment = left;

          for (let c = 1; c <= 5; c++) ws4.getCell(r, c).border = thinBorder;

          // Severidad por número de reprobadas
          if (alu.count >= 4) {
            ws4.getCell(r, 4).font = { bold: true, color: { argb: 'FFB91C1C' }, size: 13 };
            ws4.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          } else if (alu.count >= 2) {
            ws4.getCell(r, 4).font = { bold: true, color: { argb: 'FFC2410C' } };
            ws4.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
          } else {
            ws4.getCell(r, 4).font = { bold: true, color: { argb: 'FFCA8A04' } };
            ws4.getCell(r, 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          }
        });
      }

      // ─── Descargar ───
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = `${cfg.grado}o_${cfg.turno}_${cfg.rol || 'academia'}`.replace(/[^\w-]/g, '');
      a.download = `Academia_${safeName}_${_filters.parcial}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      Toast.show('✓ Excel descargado', 'success');
    } catch (e) {
      console.error('Excel error:', e);
      Toast.show('Error generando Excel: ' + (e.message || ''), 'error');
    }
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (container) return renderDashboard(container);
  }

  return { render, renderDashboard };
})();

Router.modules['mi-academia'] = () => PresidenteAcademiaModule.render();
