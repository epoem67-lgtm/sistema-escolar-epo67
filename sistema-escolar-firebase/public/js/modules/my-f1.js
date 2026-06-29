/**
 * CONCENTRADO F1 DOCENTE
 * Consulta de avance por lista: parcial individual o acumulado estilo F1.
 */

const MyF1Module = (() => {
  let assignments = [];
  let students = [];
  let grades = [];
  let groups = [];
  let teachers = [];
  let hours = [];
  let lastReport = null;

  const PARTIALS = ['P1', 'P2', 'P3'];
  const MONTHS = ['febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio'];

  function _el(id) { return document.getElementById(id); }

  function _partialLabel(partial) {
    return K.PARCIALES.find(p => p.id === partial)?.nombre || partial;
  }

  function _studentId(student) {
    return student.id || student.docId;
  }

  function _gradeValue(grade) {
    if (!grade) return null;
    const val = grade.cal !== undefined ? grade.cal : grade.value;
    if (val === undefined || val === null || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function _gradeFaltas(grade) {
    if (!grade) return null;
    // v8.39: regla EPO 67 — si el parcial tiene calificación capturada
    // pero el maestro no llenó faltas, asumimos 0 (no 'guión'). Olivia: "no
    // pueden salir guiones bajo ninguna circunstancia, siempre ceros".
    if (grade.faltas !== undefined && grade.faltas !== null && grade.faltas !== '') {
      const n = Number(grade.faltas);
      return Number.isFinite(n) ? n : 0;
    }
    // Sin faltas explícitas: si hay cal capturada → 0 faltas. Sin cal → null.
    const tieneCal = (grade.cal !== undefined && grade.cal !== null && grade.cal !== '')
                  || (grade.value !== undefined && grade.value !== null && grade.value !== '');
    return tieneCal ? 0 : null;
  }

  function _sumHours(doc) {
    if (!doc) return 0;
    return MONTHS.reduce((sum, m) => {
      const n = Number(doc[m]);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  }

  function _formatNum(value, digits = 1) {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(digits);
  }

  function _formatInt(value) {
    if (value === null || value === undefined || value === '') return '-';
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return String(Math.round(n));
  }

  function _statusForAccumulated(row) {
    if (row.gradeCount === 0) return { label: 'Sin captura', className: 'f1-status-empty', reason: 'Sin calificaciones capturadas' };
    const reasons = [];
    if (row.absencePercent !== null && row.absencePercent > 20) reasons.push('Faltas >20%');
    if (row.failedPartials >= 2) reasons.push('2 parciales reprobados');
    if (row.finalGrade !== null && row.finalGrade < K.THRESHOLDS.PASS_GRADE) reasons.push('Promedio <6');
    if (reasons.length > 0) return { label: 'EXTRA', className: 'f1-status-extra', reason: reasons.join(', ') };
    return { label: 'ORD', className: 'f1-status-ord', reason: 'En ordinario' };
  }

  function _statusForPartial(row) {
    if (row.partialGrade === null) return { label: 'Sin captura', className: 'f1-status-empty', reason: 'Sin calificación' };
    const reasons = [];
    if (row.partialGrade < K.THRESHOLDS.PASS_GRADE) reasons.push('Reprobado');
    if (row.absencePercent !== null && row.absencePercent > 20) reasons.push('Faltas >20%');
    if (reasons.length > 0) return { label: 'Atención', className: 'f1-status-extra', reason: reasons.join(', ') };
    return { label: 'ORD', className: 'f1-status-ord', reason: 'En ordinario' };
  }

  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function _sanitizeFilename(text) {
    return (text || 'F1')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  async function render() {
    const container = _el('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Concentrado F1</h1>
            <p class="module-subtitle">Consulta tus calificaciones por parcial o acumuladas</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-success" data-action="f1-export" disabled>Exportar Excel</button>
            <button class="btn btn-primary" data-action="f1-print" disabled>Imprimir</button>
          </div>
        </div>

        <!-- Banner recordatorio: F1 oficial solo al final del ciclo -->
        <div class="card" style="background:#fef3c7;border-left:5px solid #d97706;margin-bottom:16px;">
          <div style="display:flex;gap:12px;align-items:flex-start;">
            <span class="material-icons-round" style="color:#d97706;font-size:28px;">warning</span>
            <div style="flex:1;">
              <strong style="font-size:14px;color:#78350f;">Recuerda</strong>
              <p style="margin:4px 0 0;font-size:13px;color:#1e293b;line-height:1.5;">
                El Concentrado F1 oficial <strong>solo debe imprimirse cuando se hayan completado los 3 parciales</strong>.
                Antes de eso puedes consultar las calificaciones parciales pero no es el documento final del ciclo.
              </p>
            </div>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid f1-filter-grid">
            <div class="form-group">
              <label for="f1-assignment">Lista</label>
              <select id="f1-assignment">
                <option value="">Cargando listas...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="f1-mode">Vista</label>
              <select id="f1-mode">
                <option value="P1">Primer Parcial</option>
                <option value="P2">Segundo Parcial</option>
                <option value="P3">Tercer Parcial</option>
                <option value="acumulado" selected>Acumulado F1</option>
              </select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="f1-generate">Generar</button>
          </div>
        </div>

        <div id="f1-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">grid_on</span>
            <p class="empty-state-text">Selecciona una lista y genera el concentrado</p>
          </div>
        </div>
      </div>`;

    await _loadData();
    _renderAssignmentOptions();
    _bindEvents(container);
  }

  async function _loadData() {
    try {
      // v8.09: STRICT — "Mi F1" es del maestro y solo de sus materias.
      assignments = await Store.getOwnAssignments();
      // Orden: turno → grado → grupo → orden oficial SEP de materias.
      const _norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
      const _sepIdx = (name, grado) => {
        const order = (K.SUBJECT_ORDER || {})[Number(grado)] || [];
        if (order.length === 0) return 999;
        const n = _norm(name);
        const i = order.findIndex(o => _norm(o) === n || n.includes(_norm(o)) || _norm(o).includes(n));
        return i === -1 ? 999 : i;
      };
      assignments = assignments
        .filter(a => a.groupId && a.subjectId)
        .sort((a, b) =>
          (a.turno || '').localeCompare(b.turno || '') ||
          String(a.grado || '').localeCompare(String(b.grado || '')) ||
          (a.groupName || '').localeCompare(b.groupName || '') ||
          (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
          (a.subjectName || '').localeCompare(b.subjectName || '')
        );

      const groupIds = [...new Set(assignments.map(a => a.groupId).filter(Boolean))];
      const role = App.currentUser?.role;
      const needsTeachers = role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo' || role === 'consulta';
      // FIX (mayo 2026): force=true en students+grades para F1. Las listas
      // son oficiales y NO PUEDEN salir incompletas por caché stale.
      // El costo extra de lecturas Firestore es aceptable: el F1 se abre
      // pocas veces al día y la integridad del documento es prioritaria.
      // v8.26: grades SELLADAS — F1 oficial debe leer snapshots certificados
      // (prevalecen sobre grades vivos para garantizar consistencia con la
      // lista impresa firmada por el maestro).
      const [studentsData, gradesData, groupsData, teachersData] = await Promise.all([
        Store.getStudentsByGroups(groupIds, /*force*/ true),
        Promise.all(groupIds.map(gid =>
          Store.getGradesByGroup(gid, true).catch(() => [])
        )).then(arrs => arrs.flat()),
        Store.getGroups(),
        needsTeachers ? Store.getTeachers() : Promise.resolve([])
      ]);

      // FIX defensivo: dedupe por id (por si el flat() de getStudentsByGroups
      // arrastra duplicados de algún cache inconsistente). Conservar el
      // primero que aparezca. Esto NO altera el total real cuando no hay
      // duplicados, solo blinda contra inconsistencias.
      const seenIds = new Set();
      const dedup = studentsData.filter(s => {
        if (!s || !s.id) return false;
        if (seenIds.has(s.id)) return false;
        seenIds.add(s.id);
        return true;
      });
      students = dedup.filter(s => s.estatus !== 'BAJA' && s.estatus !== 'baja' && s.estatus !== 'EGRESADO');
      // Log auditable: si el total post-filtro NO es la suma esperada,
      // queda registro para diagnosticar el mismatch en consola del maestro.
      if (studentsData.length !== students.length + (studentsData.length - dedup.length)) {
        console.warn('[F1] alumnos descartados:', { total: studentsData.length, deduped: dedup.length, final: students.length });
      }
      grades = gradesData;
      groups = groupsData;
      teachers = teachersData;
    } catch (error) {
      console.error('Error cargando F1 docente:', error);
      Toast.show('Error al cargar concentrado F1', 'error');
    }
  }

  function _renderAssignmentOptions() {
    const select = _el('f1-assignment');
    if (!select) return;
    if (assignments.length === 0) {
      select.innerHTML = '<option value="">No tienes listas asignadas</option>';
      return;
    }

    const role = App.currentUser?.role;
    const groupedByTeacher = teachers.length > 0 &&
      (role === 'admin' || role === 'subdirector' || role === 'orientador' || role === 'directivo' || role === 'consulta');

    const optionHtml = (a) => {
      const label = `${a.turno || ''} ${a.groupName || a.groupId} - ${K.getUACNombre(a.subjectName || a.subjectId)}`;
      return `<option value="${Utils.sanitize(a.id)}">${Utils.sanitize(label)}</option>`;
    };

    if (!groupedByTeacher) {
      select.innerHTML = '<option value="">Selecciona lista</option>' +
        assignments.map(optionHtml).join('');
      return;
    }

    const teacherById = new Map(teachers.map(t => [t.id, t]));
    const buckets = new Map();
    assignments.forEach(a => {
      const t = teacherById.get(a.teacherId);
      const teacherName = t ? Utils.displayName(t.nombre) : (a.teacherName || 'Sin docente');
      if (!buckets.has(teacherName)) buckets.set(teacherName, []);
      buckets.get(teacherName).push(a);
    });

    const sortedNames = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
    // Dentro del optgroup por docente: turno → grado → grupo → orden oficial SEP
    const groupsHtml = sortedNames.map(name => {
      const items = buckets.get(name)
        .sort((a, b) =>
          (a.turno || '').localeCompare(b.turno || '') ||
          String(a.grado || '').localeCompare(String(b.grado || '')) ||
          (a.groupName || '').localeCompare(b.groupName || '') ||
          (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
          (a.subjectName || '').localeCompare(b.subjectName || '')
        )
        .map(optionHtml).join('');
      return `<optgroup label="${Utils.sanitize(name)}">${items}</optgroup>`;
    }).join('');

    select.innerHTML = '<option value="">Selecciona lista</option>' + groupsHtml;
  }

  async function _loadHoursForAssignment(assignment) {
    try {
      // Usar cache batched (1 query para todos los grupos del docente, 5 min TTL)
      const allHoursMap = await Store.getTeacherHoursForGroups([assignment.groupId]);
      hours = [];
      allHoursMap.forEach(doc => {
        if (doc.groupId === assignment.groupId && doc.subjectId === assignment.subjectId) {
          hours.push(doc);
        }
      });
    } catch (error) {
      console.warn('No se pudieron cargar horas F1:', error);
      hours = [];
    }
  }

  function _buildReport(assignment, mode) {
    const groupDoc = groups.find(g => g.id === assignment.groupId);
    const groupStudents = students
      .filter(s => s.groupId === assignment.groupId)
      .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

    const gradeMap = {};
    grades
      .filter(g => g.groupId === assignment.groupId && g.subjectId === assignment.subjectId)
      .forEach(g => {
        if (!gradeMap[g.studentId]) gradeMap[g.studentId] = {};
        gradeMap[g.studentId][g.partial] = g;
      });

    const hoursByPartial = {};
    PARTIALS.forEach(partial => {
      const doc = hours.find(h => h.partial === partial);
      hoursByPartial[partial] = _sumHours(doc);
    });
    // FIX bug-horas-triplicadas: desde v8.32 las horas son SEMESTRALES replicadas
    // en los 3 docs (P1/P2/P3 tienen el MISMO valor). Sumarlas triplica el dato
    // real. totalHours debe ser el valor de UN solo doc (los 3 son iguales).
    const totalHours = hoursByPartial.P3 || hoursByPartial.P2 || hoursByPartial.P1 || 0;

    // v8.60 REGLAS SEP: construir grades3 (P1,P2,P3) para pasarlos a
    // App.calcCalFinalSEP, que aplica las 3 reglas estrictas (promedio<6,
    // 2+ reprobados, >20% faltas) y devuelve la calFinal oficial.
    const hoursByPartObj = {};
    hours.forEach(h => { hoursByPartObj[h.partial || 'SEMESTRE'] = h; });

    const rows = groupStudents.map((student, index) => {
      const sid = _studentId(student);
      const byPartial = {};
      let totalFaltas = 0;
      let totalPoints = 0;
      let gradeCount = 0;
      let failedPartials = 0;

      // grades3 ordenados para reglas SEP
      const grades3 = PARTIALS.map(p => gradeMap[sid]?.[p] || null);

      PARTIALS.forEach(partial => {
        const grade = gradeMap[sid]?.[partial] || null;
        const cal = _gradeValue(grade);
        const faltas = _gradeFaltas(grade);
        byPartial[partial] = { cal, faltas };
        if (faltas !== null) totalFaltas += faltas;
        if (cal !== null) {
          totalPoints += cal;
          gradeCount++;
          if (cal < K.THRESHOLDS.PASS_GRADE) failedPartials++;
        }
      });

      // Reglas SEP estrictas: si reprueba por cualquier regla → cal=5 forzosa
      const sepResult = App.calcCalFinalSEP({ grades3, hoursByPart: hoursByPartObj });
      const finalAverage = gradeCount > 0 ? totalPoints / gradeCount : null;
      let finalGrade = sepResult.calFinal; // YA viene con reglas SEP aplicadas (5 si reprobó)
      let reprobadoPorRegla = sepResult.reprobadoPorRegla;
      let motivoSEP = sepResult.motivo;
      const absenceBase = mode === 'acumulado' ? totalHours : hoursByPartial[mode];
      const faltasForMode = mode === 'acumulado' ? totalFaltas : (byPartial[mode]?.faltas || 0);
      const absencePercent = absenceBase > 0 ? (faltasForMode * 100) / absenceBase : null;

      // DOBLE RED DE SEGURIDAD (junio 2026): si el alumno excede 20% de
      // inasistencias en el modo actual (acumulado o por parcial),
      // forzar finalGrade = 5 SIN excepcion. Esto cubre el caso donde la
      // funcion central (calcCalFinalSEP) no aplico la regla 3 por algun
      // motivo edge (cache stale, hoursByPart mal formado, etc.).
      // Reglamento EPO 67 / Gaceta SEP: >20% faltas = reprobado, no acreditado.
      if (absencePercent !== null && absencePercent > 20 && finalGrade !== null) {
        if (finalGrade !== 5) {
          // Solo logear si estamos sobreescribiendo una cal aprobatoria
          // (caso del bug reportado: aparece cal>=6 pero >20% faltas).
          if (finalGrade >= K.THRESHOLDS.PASS_GRADE) {
            console.warn('[F1-SEP] forzando cal=5 por >20% faltas. antes:', finalGrade, 'pct:', absencePercent.toFixed(1));
          }
          finalGrade = 5;
          reprobadoPorRegla = true;
          motivoSEP = (motivoSEP || '') + (motivoSEP ? ' · ' : '') + `${absencePercent.toFixed(1)}% inasistencias (>20%)`;
        }
      }

      const row = {
        num: index + 1,
        student,
        byPartial,
        totalFaltas,
        absencePercent,
        totalPoints,
        gradeCount,
        failedPartials,
        finalAverage,
        finalGrade,
        // v8.60 REGLAS SEP: metadata para que el render pueda destacar visualmente
        // la sustitución forzosa por regla SEP (con tooltip explicando motivo).
        reprobadoPorRegla,
        motivoSEP,
        partialGrade: mode !== 'acumulado' ? byPartial[mode]?.cal ?? null : null,
        partialFaltas: mode !== 'acumulado' ? byPartial[mode]?.faltas ?? null : null
      };
      row.status = mode === 'acumulado' ? _statusForAccumulated(row) : _statusForPartial(row);
      return row;
    });

    const capturedRows = rows.filter(r => mode === 'acumulado' ? r.gradeCount > 0 : r.partialGrade !== null);
    const average = capturedRows.length > 0
      ? capturedRows.reduce((sum, r) => sum + (mode === 'acumulado' ? (r.finalAverage || 0) : (r.partialGrade || 0)), 0) / capturedRows.length
      : null;
    const failing = rows.filter(r => mode === 'acumulado'
      ? (r.status.label === 'EXTRA')
      : (r.partialGrade !== null && r.partialGrade < K.THRESHOLDS.PASS_GRADE)
    ).length;
    const absenceRisk = rows.filter(r => r.absencePercent !== null && r.absencePercent > 20).length;
    const twoFailed = rows.filter(r => r.failedPartials >= 2).length;

    const hombres = groupStudents.filter(s => s.sexo === 'H').length;
    const mujeres = groupStudents.filter(s => s.sexo === 'M').length;
    const total = groupStudents.length;

    const totalsForPartial = (partial) => {
      const cals = rows.map(r => r.byPartial[partial]?.cal).filter(v => v !== null && v !== undefined);
      const promedio = cals.length > 0 ? cals.reduce((a, b) => a + b, 0) / cals.length : null;
      const aprobados = cals.filter(v => v > K.THRESHOLDS.PASS_GRADE - 1).length;
      const reprobados = cals.filter(v => v <= K.THRESHOLDS.PASS_GRADE - 1).length;
      const aprovechamiento = total > 0 ? (aprobados * 100) / total : null;
      const sumaFaltas = rows.reduce((sum, r) => {
        const f = r.byPartial[partial]?.faltas;
        return sum + (Number.isFinite(f) ? f : 0);
      }, 0);
      const horasParcial = hoursByPartial[partial] || 0;
      const faltasPct = horasParcial > 0 ? (sumaFaltas * 100) / (horasParcial * total || 1) : null;
      const asistenciaPct = faltasPct !== null ? 100 - faltasPct : null;
      return { promedio, aprobados, reprobados, aprovechamiento, sumaFaltas, faltasPct, asistenciaPct };
    };

    const finalTotal = (() => {
      const finals = rows.map(r => r.finalGrade).filter(v => v !== null && v !== undefined);
      const promedio = finals.length > 0 ? finals.reduce((a, b) => a + b, 0) / finals.length : null;
      const aprobados = finals.filter(v => v > K.THRESHOLDS.PASS_GRADE - 1).length;
      const reprobados = finals.filter(v => v <= K.THRESHOLDS.PASS_GRADE - 1).length;
      const extraordinarios = rows.filter(r => r.status?.label === 'EXTRA').length;
      const aprovechamiento = total > 0 ? (aprobados * 100) / total : null;
      const sumaFaltas = rows.reduce((sum, r) => sum + (Number.isFinite(r.totalFaltas) ? r.totalFaltas : 0), 0);
      const faltasPct = totalHours > 0 ? (sumaFaltas * 100) / (totalHours * total || 1) : null;
      const asistenciaPct = faltasPct !== null ? 100 - faltasPct : null;
      const totalPoints = rows.reduce((sum, r) => sum + (Number.isFinite(r.totalPoints) ? r.totalPoints : 0), 0);
      return { promedio, aprobados, reprobados, extraordinarios, aprovechamiento, sumaFaltas, faltasPct, asistenciaPct, totalPoints };
    })();

    // Alumnos en riesgo por faltas (umbral 20% = baja a extraordinario)
    // y "alerta" entre 15-20% (acercándose al límite)
    const RIESGO_PCT = 20;
    const ALERTA_PCT = 15;
    const atRiskByAbsence = rows
      .filter(r => r.absencePercent !== null && r.absencePercent >= ALERTA_PCT)
      .map(r => ({
        num: r.num,
        nombre: r.student.nombreCompleto || '',
        faltas: mode === 'acumulado' ? r.totalFaltas : (r.byPartial[mode]?.faltas ?? 0),
        absencePercent: r.absencePercent,
        level: r.absencePercent > RIESGO_PCT ? 'danger' : 'warning'
      }))
      .sort((a, b) => b.absencePercent - a.absencePercent);

    return {
      assignment,
      mode,
      groupName: assignment.groupName || groupDoc?.nombre || assignment.groupId,
      subjectName: K.getUACNombre(assignment.subjectName || assignment.subjectId),
      turno: assignment.turno || groupDoc?.turno || '',
      grado: assignment.grado || groupDoc?.grado || '',
      rows,
      hoursByPartial,
      totalHours,
      header: { hombres, mujeres, total },
      totals: {
        P1: totalsForPartial('P1'),
        P2: totalsForPartial('P2'),
        P3: totalsForPartial('P3'),
        FINAL: finalTotal
      },
      atRiskByAbsence,
      summary: {
        total: rows.length,
        captured: capturedRows.length,
        average,
        failing,
        absenceRisk,
        twoFailed
      }
    };
  }

  async function generate() {
    const assignmentId = _el('f1-assignment')?.value;
    const mode = _el('f1-mode')?.value || 'acumulado';
    const results = _el('f1-results');
    if (!assignmentId) {
      Toast.show('Selecciona una lista', 'warning');
      return;
    }
    const assignment = assignments.find(a => a.id === assignmentId);
    if (!assignment) {
      Toast.show('No se encontró la lista seleccionada', 'error');
      return;
    }

    results.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Generando F1...</p></div>`;
    await _loadHoursForAssignment(assignment);
    lastReport = _buildReport(assignment, mode);
    _renderReport(lastReport);
    document.querySelector('[data-action="f1-export"]')?.removeAttribute('disabled');

    // ─── BLOQUEO DE IMPRESIÓN — REGLA EPO 67 (v8.01, revisada) ───
    // Las horas son SEMESTRALES (febrero–julio). Basta con que el maestro
    // las haya capturado en CUALQUIER parcial para que el cálculo del %
    // de inasistencias funcione. Solo bloqueamos si NO hay horas en
    // ningún parcial (caso real de captura faltante).
    const printBtn = document.querySelector('[data-action="f1-print"]');
    try {
      const hayHorasEnAlgunParcial = ['P1', 'P2', 'P3']
        .some(pid => (lastReport.hoursByPartial[pid] > 0));

      if (!hayHorasEnAlgunParcial) {
        printBtn?.setAttribute('disabled', 'disabled');
        if (printBtn) {
          printBtn.setAttribute('title',
            `No puedes imprimir: no has capturado las horas impartidas del semestre. ` +
            `Captura las horas desde "Capturar Calificaciones".`
          );
        }
        const aviso = document.createElement('div');
        aviso.style.cssText = 'background:#fef2f2;border:2px solid #b91c1c;border-radius:8px;padding:14px 18px;margin-bottom:14px;color:#7f1d1d;';
        aviso.innerHTML = `
          <div style="font-weight:800;font-size:15px;margin-bottom:6px;">⚠️ Impresión BLOQUEADA — faltan horas impartidas</div>
          <div style="font-size:13px;line-height:1.55;">
            No has capturado las <strong>horas impartidas del semestre</strong> en esta materia.
            <br><br>
            Ve a <strong>"Capturar Calificaciones"</strong>, abre la lista y baja al panel naranja
            <strong>"Horas impartidas"</strong> al final. Captura los meses de febrero–julio según corresponda.
            Una sola vez basta — las horas son semestrales.
          </div>
        `;
        results.insertBefore(aviso, results.firstChild);
      } else {
        printBtn?.removeAttribute('disabled');
        printBtn?.removeAttribute('title');
      }
    } catch (e) {
      console.warn('No se pudo validar horas para imprimir:', e);
      printBtn?.removeAttribute('disabled');  // fail-open si Store no responde
    }
  }

  function _renderReport(report) {
    const results = _el('f1-results');
    if (!results) return;

    const title = report.mode === 'acumulado' ? 'Acumulado F1' : _partialLabel(report.mode);
    const rowsHtml = report.mode === 'acumulado' ? _renderAccumulatedRows(report.rows) : _renderPartialRows(report.rows, report.mode);

    const interimNote = report.assignment?.interim ? `
      <div style="background:#fffbeb;border-left:5px solid #d97706;padding:10px 14px;margin-bottom:10px;border-radius:6px;">
        <strong style="color:#78350f;">🟠 Cobertura temporal</strong>
        <span style="color:#78350f;font-size:13px;margin-left:6px;">
          Esta lista es cubierta mientras se asigna al docente oficial.
          ${report.assignment.interimNote ? '· <em>' + Utils.sanitize(report.assignment.interimNote) + '</em>' : ''}
        </span>
      </div>` : '';

    results.innerHTML = `
      <div class="f1-report">
        <div class="f1-report-header">
          <div>
            <h2>${Utils.sanitize(report.subjectName)}</h2>
            <p>${Utils.sanitize(report.groupName)} · ${Utils.sanitize(report.turno)} · ${Utils.sanitize(title)}</p>
          </div>
          <div class="f1-hours-box">
            <span>Horas registradas</span>
            <strong>${report.mode === 'acumulado' ? _formatInt(report.totalHours) : _formatInt(report.hoursByPartial[report.mode])}</strong>
          </div>
        </div>

        ${interimNote}

        <div class="f1-meta-grid">
          <div><span>Hombres</span><strong>${report.header.hombres}</strong></div>
          <div><span>Mujeres</span><strong>${report.header.mujeres}</strong></div>
          <div><span>Total</span><strong>${report.header.total}</strong></div>
        </div>

        <div class="f1-summary-grid">
          <div class="stat-card--compact"><div class="stat-label">Alumnos</div><div class="stat-number">${report.summary.total}</div></div>
          <div class="stat-card--compact"><div class="stat-label">Con captura</div><div class="stat-number">${report.summary.captured}</div></div>
          <div class="stat-card--compact"><div class="stat-label">Promedio</div><div class="stat-number">${_formatNum(report.summary.average, 2)}</div></div>
          <div class="stat-card--compact stat-card--danger"><div class="stat-label">Atención</div><div class="stat-number">${report.summary.failing}</div></div>
          <div class="stat-card--compact stat-card--warning"><div class="stat-label">Faltas +20%</div><div class="stat-number">${report.summary.absenceRisk}</div></div>
          <div class="stat-card--compact stat-card--warning"><div class="stat-label">2 parciales rep.</div><div class="stat-number">${report.summary.twoFailed}</div></div>
        </div>

        <div class="table-container f1-table-wrap">
          <table class="table-light f1-table">
            <thead>${report.mode === 'acumulado' ? _renderAccumulatedHeader() : _renderPartialHeader(report.mode)}</thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot>${_renderTotalesRows(report)}</tfoot>
          </table>
        </div>
      </div>`;
  }

  function _renderTotalesRows(report) {
    if (report.mode === 'acumulado') return _renderAccumulatedTotales(report);
    return _renderPartialTotales(report);
  }

  function _renderAccumulatedTotales(report) {
    const t = report.totals;
    const sumFaltas = (p) => _formatInt(t[p]?.sumaFaltas);
    const promP = (p) => _formatNum(t[p]?.promedio, 2);
    const aprobP = (p) => _formatInt(t[p]?.aprobados);
    const reprobP = (p) => _formatInt(t[p]?.reprobados);
    const aprovP = (p) => t[p]?.aprovechamiento === null || t[p]?.aprovechamiento === undefined
      ? '-' : `${_formatNum(t[p].aprovechamiento, 1)}%`;

    return `
      <tr class="f1-totales-row">
        <td colspan="2" class="f1-totales-label">Totales</td>
        <td>${sumFaltas('P1')}</td><td>${promP('P1')}</td>
        <td>${sumFaltas('P2')}</td><td>${promP('P2')}</td>
        <td>${sumFaltas('P3')}</td><td>${promP('P3')}</td>
        <td>${_formatInt(t.FINAL?.sumaFaltas)}</td>
        <td>${t.FINAL?.faltasPct === null ? '-' : _formatNum(t.FINAL?.faltasPct, 1) + '%'}</td>
        <td>${_formatInt(t.FINAL?.totalPoints)}</td>
        <td>${_formatNum(t.FINAL?.promedio, 2)}</td>
        <td>-</td>
      </tr>
      <tr class="f1-totales-row">
        <td colspan="2" class="f1-totales-label">Aprobados</td>
        <td colspan="2">${aprobP('P1')}</td>
        <td colspan="2">${aprobP('P2')}</td>
        <td colspan="2">${aprobP('P3')}</td>
        <td colspan="4">Final: ${_formatInt(t.FINAL?.aprobados)}</td>
        <td>-</td>
      </tr>
      <tr class="f1-totales-row">
        <td colspan="2" class="f1-totales-label">Reprobados</td>
        <td colspan="2">${reprobP('P1')}</td>
        <td colspan="2">${reprobP('P2')}</td>
        <td colspan="2">${reprobP('P3')}</td>
        <td colspan="4">Final: ${_formatInt(t.FINAL?.reprobados)} · Extra: ${_formatInt(t.FINAL?.extraordinarios)}</td>
        <td>-</td>
      </tr>
      <tr class="f1-totales-row f1-totales-summary">
        <td colspan="2" class="f1-totales-label">% Aprovechamiento</td>
        <td colspan="2">${aprovP('P1')}</td>
        <td colspan="2">${aprovP('P2')}</td>
        <td colspan="2">${aprovP('P3')}</td>
        <td colspan="4">Final: ${t.FINAL?.aprovechamiento === null || t.FINAL?.aprovechamiento === undefined ? '-' : _formatNum(t.FINAL.aprovechamiento, 1) + '%'}</td>
        <td>-</td>
      </tr>
      <tr class="f1-totales-row f1-totales-summary">
        <td colspan="2" class="f1-totales-label">% Asistencia</td>
        <td colspan="12">${t.FINAL?.asistenciaPct === null || t.FINAL?.asistenciaPct === undefined ? '-' : _formatNum(t.FINAL.asistenciaPct, 1) + '%'}</td>
        <td>-</td>
      </tr>`;
  }

  function _renderPartialTotales(report) {
    const t = report.totals[report.mode] || {};
    const aprov = t.aprovechamiento === null || t.aprovechamiento === undefined
      ? '-' : `${_formatNum(t.aprovechamiento, 1)}%`;
    const asis = t.asistenciaPct === null || t.asistenciaPct === undefined
      ? '-' : `${_formatNum(t.asistenciaPct, 1)}%`;
    return `
      <tr class="f1-totales-row">
        <td colspan="2" class="f1-totales-label">Totales</td>
        <td>${_formatInt(t.sumaFaltas)}</td>
        <td>${_formatNum(t.promedio, 2)}</td>
        <td>${t.faltasPct === null || t.faltasPct === undefined ? '-' : _formatNum(t.faltasPct, 1) + '%'}</td>
        <td>-</td>
      </tr>
      <tr class="f1-totales-row">
        <td colspan="2" class="f1-totales-label">Aprobados / Reprobados</td>
        <td colspan="2">${_formatInt(t.aprobados)} / ${_formatInt(t.reprobados)}</td>
        <td colspan="2">-</td>
      </tr>
      <tr class="f1-totales-row f1-totales-summary">
        <td colspan="2" class="f1-totales-label">% Aprovechamiento</td>
        <td colspan="2">${aprov}</td>
        <td>${asis}</td>
        <td>-</td>
      </tr>`;
  }

  function _renderAccumulatedHeader() {
    return `
      <tr>
        <th>#</th>
        <th>Alumno</th>
        <th>P1 F</th><th>P1 Cal</th>
        <th>P2 F</th><th>P2 Cal</th>
        <th>P3 F</th><th>P3 Cal</th>
        <th>Total F</th>
        <th>% Faltas</th>
        <th>Puntos</th>
        <th>Final</th>
        <th>Estatus</th>
      </tr>`;
  }

  function _renderPartialHeader(partial) {
    return `
      <tr>
        <th>#</th>
        <th>Alumno</th>
        <th>${Utils.sanitize(_partialLabel(partial))} Faltas</th>
        <th>${Utils.sanitize(_partialLabel(partial))} Cal.</th>
        <th>% Faltas</th>
        <th>Estatus</th>
      </tr>`;
  }

  function _renderAccumulatedRows(rows) {
    return rows.map(row => `
      <tr class="${row.status.label === 'EXTRA' ? 'f1-row-extra' : ''}">
        <td>${row.num}</td>
        <td class="font-semibold">${Utils.sanitize(row.student.nombreCompleto || '')}</td>
        ${PARTIALS.map(p => `
          <td>${_formatInt(row.byPartial[p].faltas)}</td>
          <td class="${row.byPartial[p].cal !== null && row.byPartial[p].cal < K.THRESHOLDS.PASS_GRADE ? 'f1-cal-fail' : ''}">${_formatInt(row.byPartial[p].cal)}</td>
        `).join('')}
        <td>${_formatInt(row.totalFaltas)}</td>
        <td>${row.absencePercent === null ? '-' : _formatNum(row.absencePercent, 1) + '%'}</td>
        <td>${_formatInt(row.totalPoints)}</td>
        <td class="${row.finalGrade !== null && row.finalGrade < K.THRESHOLDS.PASS_GRADE ? 'f1-cal-fail' : ''}">${_formatInt(row.finalGrade)}</td>
        <td><span class="f1-status ${row.status.className}" title="${Utils.sanitize(row.status.reason)}">${Utils.sanitize(row.status.label)}</span></td>
      </tr>`).join('');
  }

  function _renderPartialRows(rows, partial) {
    return rows.map(row => `
      <tr class="${row.partialGrade !== null && row.partialGrade < K.THRESHOLDS.PASS_GRADE ? 'f1-row-extra' : ''}">
        <td>${row.num}</td>
        <td class="font-semibold">${Utils.sanitize(row.student.nombreCompleto || '')}</td>
        <td>${_formatInt(row.byPartial[partial].faltas)}</td>
        <td class="${row.partialGrade !== null && row.partialGrade < K.THRESHOLDS.PASS_GRADE ? 'f1-cal-fail' : ''}">${_formatInt(row.partialGrade)}</td>
        <td>${row.absencePercent === null ? '-' : _formatNum(row.absencePercent, 1) + '%'}</td>
        <td><span class="f1-status ${row.status.className}" title="${Utils.sanitize(row.status.reason)}">${Utils.sanitize(row.status.label)}</span></td>
      </tr>`).join('');
  }

  function exportReport() {
    if (!lastReport) {
      Toast.show('Genera primero el concentrado F1', 'warning');
      return;
    }

    const round = (v, d = 1) => v === null || v === undefined ? '' : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

    const data = lastReport.rows.map(row => {
      if (lastReport.mode !== 'acumulado') {
        const p = lastReport.mode;
        return {
          '#': row.num,
          Alumno: row.student.nombreCompleto || '',
          Grupo: lastReport.groupName,
          UAC: lastReport.subjectName,
          Parcial: _partialLabel(p),
          Faltas: row.byPartial[p].faltas ?? '',
          Calificacion: row.byPartial[p].cal ?? '',
          '% Faltas': row.absencePercent === null ? '' : Math.round(row.absencePercent * 10) / 10,
          Estatus: row.status.label,
          Motivo: row.status.reason
        };
      }
      return {
        '#': row.num,
        Alumno: row.student.nombreCompleto || '',
        Grupo: lastReport.groupName,
        UAC: lastReport.subjectName,
        'P1 Faltas': row.byPartial.P1.faltas ?? '',
        'P1 Cal': row.byPartial.P1.cal ?? '',
        'P2 Faltas': row.byPartial.P2.faltas ?? '',
        'P2 Cal': row.byPartial.P2.cal ?? '',
        'P3 Faltas': row.byPartial.P3.faltas ?? '',
        'P3 Cal': row.byPartial.P3.cal ?? '',
        'Total Faltas': row.totalFaltas,
        '% Faltas': row.absencePercent === null ? '' : Math.round(row.absencePercent * 10) / 10,
        'Total Puntos': row.totalPoints,
        'Cal Final': row.finalGrade ?? '',
        Estatus: row.status.label,
        Motivo: row.status.reason
      };
    });

    const t = lastReport.totals;
    if (lastReport.mode !== 'acumulado') {
      const p = lastReport.mode;
      const tp = t[p] || {};
      data.push({
        '#': '', Alumno: 'TOTALES', Grupo: '', UAC: '', Parcial: _partialLabel(p),
        Faltas: tp.sumaFaltas ?? '',
        Calificacion: round(tp.promedio, 2),
        '% Faltas': round(tp.faltasPct, 1),
        Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: 'APROBADOS', Grupo: '', UAC: '', Parcial: '',
        Faltas: '', Calificacion: tp.aprobados ?? '', '% Faltas': '', Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: 'REPROBADOS', Grupo: '', UAC: '', Parcial: '',
        Faltas: '', Calificacion: tp.reprobados ?? '', '% Faltas': '', Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: '% APROVECHAMIENTO', Grupo: '', UAC: '', Parcial: '',
        Faltas: '', Calificacion: round(tp.aprovechamiento, 1), '% Faltas': round(tp.faltasPct, 1),
        Estatus: '', Motivo: ''
      });
    } else {
      const f = t.FINAL || {};
      data.push({
        '#': '', Alumno: 'TOTALES', Grupo: '', UAC: '',
        'P1 Faltas': t.P1?.sumaFaltas ?? '', 'P1 Cal': round(t.P1?.promedio, 2),
        'P2 Faltas': t.P2?.sumaFaltas ?? '', 'P2 Cal': round(t.P2?.promedio, 2),
        'P3 Faltas': t.P3?.sumaFaltas ?? '', 'P3 Cal': round(t.P3?.promedio, 2),
        'Total Faltas': f.sumaFaltas ?? '', '% Faltas': round(f.faltasPct, 1),
        'Total Puntos': f.totalPoints ?? '', 'Cal Final': round(f.promedio, 2),
        Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: 'APROBADOS', Grupo: '', UAC: '',
        'P1 Faltas': '', 'P1 Cal': t.P1?.aprobados ?? '',
        'P2 Faltas': '', 'P2 Cal': t.P2?.aprobados ?? '',
        'P3 Faltas': '', 'P3 Cal': t.P3?.aprobados ?? '',
        'Total Faltas': '', '% Faltas': '', 'Total Puntos': '',
        'Cal Final': f.aprobados ?? '', Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: 'REPROBADOS', Grupo: '', UAC: '',
        'P1 Faltas': '', 'P1 Cal': t.P1?.reprobados ?? '',
        'P2 Faltas': '', 'P2 Cal': t.P2?.reprobados ?? '',
        'P3 Faltas': '', 'P3 Cal': t.P3?.reprobados ?? '',
        'Total Faltas': '', '% Faltas': '', 'Total Puntos': '',
        'Cal Final': f.reprobados ?? '', Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: 'EXTRAORDINARIOS', Grupo: '', UAC: '',
        'P1 Faltas': '', 'P1 Cal': '', 'P2 Faltas': '', 'P2 Cal': '',
        'P3 Faltas': '', 'P3 Cal': '', 'Total Faltas': '', '% Faltas': '',
        'Total Puntos': '', 'Cal Final': f.extraordinarios ?? '', Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: '% APROVECHAMIENTO', Grupo: '', UAC: '',
        'P1 Faltas': '', 'P1 Cal': round(t.P1?.aprovechamiento, 1),
        'P2 Faltas': '', 'P2 Cal': round(t.P2?.aprovechamiento, 1),
        'P3 Faltas': '', 'P3 Cal': round(t.P3?.aprovechamiento, 1),
        'Total Faltas': '', '% Faltas': '', 'Total Puntos': '',
        'Cal Final': round(f.aprovechamiento, 1), Estatus: '', Motivo: ''
      });
      data.push({
        '#': '', Alumno: '% ASISTENCIA', Grupo: '', UAC: '',
        'P1 Faltas': '', 'P1 Cal': '', 'P2 Faltas': '', 'P2 Cal': '',
        'P3 Faltas': '', 'P3 Cal': '', 'Total Faltas': '', '% Faltas': '',
        'Total Puntos': '', 'Cal Final': round(f.asistenciaPct, 1), Estatus: '', Motivo: ''
      });
    }

    // Resolver nombre de maestro
    const teacher = teachers.find(t => t.id === lastReport.assignment.teacherId);
    const profesor = teacher
      ? Utils.displayName(teacher.nombre)
      : (lastReport.assignment.teacherName
          ? Utils.displayName(lastReport.assignment.teacherName)
          : Utils.displayName(App.currentUser?.displayName || App.currentUser?.email || ''));
    const filename = Utils.fileName({
      tipo: 'F1',
      turno: lastReport.turno,
      grupo: lastReport.groupName,
      materia: lastReport.subjectName,
      maestro: profesor,
      parcial: lastReport.mode === 'acumulado' ? 'ACUMULADO' : lastReport.mode,
      ext: 'xlsx'
    });
    Utils.exportToExcel(data, filename);
  }

  function printReport() {
    if (!lastReport) {
      Toast.show('Genera primero el concentrado F1', 'warning');
      return;
    }
    const r = lastReport;
    const isAcum = r.mode === 'acumulado';
    const parcMap = { P1: 'PRIMER', P2: 'SEGUNDO', P3: 'TERCER' };
    const titulo = isAcum ? 'CONCENTRADO F1 — ACUMULADO' : `CONCENTRADO F1 — ${parcMap[r.mode] || ''} PARCIAL`;
    // Detecta el semestre corriente según la fecha actual. App.getCurrentSemester
    // retorna {numero, texto}: feb-jul = pares (SEGUNDO/CUARTO/SEXTO),
    // ago-ene = impares (PRIMERO/TERCERO/QUINTO). Antes estaba hardcoded a
    // los pares lo cual fallaba en impresiones de agosto en adelante.
    const semText = (function() {
      try { return App.getCurrentSemester(r.grado).texto + ' SEMESTRE'; }
      catch (_) { return ''; }
    })();

    const teacher = teachers.find(t => t.id === r.assignment.teacherId);
    const profesor = teacher
      ? Utils.displayName(teacher.nombre)
      : (r.assignment.teacherName
          ? Utils.displayName(r.assignment.teacherName)
          : Utils.displayName(App.currentUser?.displayName || App.currentUser?.email || ''));
    const orientador = K.getOrientador(r.turno, r.groupName) || '';

    const horasTotales = isAcum ? r.totalHours : (r.hoursByPartial[r.mode] || 0);
    // Dynamic font sizing — F1 LANDSCAPE (209mm útil verticales vs 272mm en
    // portrait). Caso real: 54 alumnos a 6.5pt cabían pero las firmas se iban
    // a 2da hoja. Bajada de 0.5pt en cada rango alto resuelve sin perder
    // legibilidad significativa. NUNCA recortar alumnos.
    const n = r.rows.length;
    let fs, headerFs;
    if (n <= 25)      { fs = '10pt';  headerFs = '8.5pt'; }
    else if (n <= 32) { fs = '9pt';   headerFs = '8pt';   }
    else if (n <= 40) { fs = '7.5pt'; headerFs = '6.8pt'; }
    else if (n <= 48) { fs = '6.5pt'; headerFs = '6pt';   }
    else if (n <= 55) { fs = '6pt';   headerFs = '5.7pt'; }
    else if (n <= 62) { fs = '5.7pt'; headerFs = '5.4pt'; }
    else if (n <= 70) { fs = '5.4pt'; headerFs = '5.2pt'; }
    else              { fs = '5.2pt'; headerFs = '5pt';   }

    const rowsHtml = r.rows.map(row => {
      const isFail = isAcum
        ? (row.finalGrade !== null && row.finalGrade < K.THRESHOLDS.PASS_GRADE)
        : (row.partialGrade !== null && row.partialGrade < K.THRESHOLDS.PASS_GRADE);
      const bg = isFail ? ' style="background:#D9D9D9;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-weight:bold;"' : '';
      const cells = [];
      cells.push(`<td class="c">${row.num}</td>`);
      cells.push(`<td class="nm">${Utils.sanitize(row.student.nombreCompleto || '')}</td>`);
      if (isAcum) {
        ['P1','P2','P3'].forEach(p => {
          cells.push(`<td class="c">${_formatInt(row.byPartial[p].faltas)}</td>`);
          cells.push(`<td class="c">${_formatInt(row.byPartial[p].cal)}</td>`);
        });
        cells.push(`<td class="c">${_formatInt(row.totalFaltas)}</td>`);
        cells.push(`<td class="c">${row.absencePercent === null ? '-' : _formatNum(row.absencePercent, 1) + '%'}</td>`);
        cells.push(`<td class="c">${_formatInt(row.totalPoints)}</td>`);
        cells.push(`<td class="c">${_formatInt(row.finalGrade)}</td>`);
        cells.push(`<td class="c">${Utils.sanitize(row.status?.label || '')}</td>`);
      } else {
        cells.push(`<td class="c">${_formatInt(row.byPartial[r.mode].faltas)}</td>`);
        cells.push(`<td class="c">${_formatInt(row.partialGrade)}</td>`);
        cells.push(`<td class="c">${row.absencePercent === null ? '-' : _formatNum(row.absencePercent, 1) + '%'}</td>`);
        cells.push(`<td class="c">${Utils.sanitize(row.status?.label || '')}</td>`);
      }
      return `<tr${bg}>${cells.join('')}</tr>`;
    }).join('');

    const tot = r.totals;
    const fmtPct = (v) => v === null || v === undefined ? '-' : _formatNum(v, 1) + '%';
    const tdL = (txt, bold) => `<td class="nm" style="${bold ? 'font-weight:bold;' : ''}padding-left:1mm;">${txt}</td>`;
    const tdC = (txt) => `<td class="c">${txt}</td>`;
    const rowStyle = 'background:#f0f0f0;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-weight:bold;';
    const summaryStyle = 'background:#d9d9d9;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-weight:bold;';

    let totalesHtml;
    if (isAcum) {
      // Fila 1 — TOTALES (suma faltas + promedio cal por parcial + final)
      const r1 = `<tr style="${rowStyle}">
        ${tdC('')}${tdL('TOTALES / PROMEDIO', true)}
        ${tdC(_formatInt(tot.P1.sumaFaltas))}${tdC(_formatNum(tot.P1.promedio,1))}
        ${tdC(_formatInt(tot.P2.sumaFaltas))}${tdC(_formatNum(tot.P2.promedio,1))}
        ${tdC(_formatInt(tot.P3.sumaFaltas))}${tdC(_formatNum(tot.P3.promedio,1))}
        ${tdC(_formatInt(tot.FINAL.sumaFaltas))}${tdC(fmtPct(tot.FINAL.faltasPct))}
        ${tdC(_formatInt(tot.FINAL.totalPoints))}${tdC(_formatNum(tot.FINAL.promedio,1))}
        ${tdC('-')}
      </tr>`;
      // Fila 2 — APROBADOS por parcial (alineado bajo la columna CAL de cada parcial)
      const r2 = `<tr style="${rowStyle}">
        ${tdC('')}${tdL('APROBADOS', true)}
        ${tdC('')}${tdC(_formatInt(tot.P1.aprobados))}
        ${tdC('')}${tdC(_formatInt(tot.P2.aprobados))}
        ${tdC('')}${tdC(_formatInt(tot.P3.aprobados))}
        ${tdC('')}${tdC('')}${tdC('')}${tdC(_formatInt(tot.FINAL.aprobados))}
        ${tdC('-')}
      </tr>`;
      // Fila 3 — REPROBADOS
      const r3 = `<tr style="${rowStyle}">
        ${tdC('')}${tdL('REPROBADOS', true)}
        ${tdC('')}${tdC(_formatInt(tot.P1.reprobados))}
        ${tdC('')}${tdC(_formatInt(tot.P2.reprobados))}
        ${tdC('')}${tdC(_formatInt(tot.P3.reprobados))}
        ${tdC('')}${tdC('')}${tdC('')}${tdC(_formatInt(tot.FINAL.reprobados))}
        ${tdC(_formatInt(tot.FINAL.extraordinarios) + ' EXT')}
      </tr>`;
      // Fila 4 — % APROVECHAMIENTO
      const r4 = `<tr style="${summaryStyle}">
        ${tdC('')}${tdL('% APROVECHAMIENTO', true)}
        ${tdC('')}${tdC(fmtPct(tot.P1.aprovechamiento))}
        ${tdC('')}${tdC(fmtPct(tot.P2.aprovechamiento))}
        ${tdC('')}${tdC(fmtPct(tot.P3.aprovechamiento))}
        ${tdC('')}${tdC('')}${tdC('')}${tdC(fmtPct(tot.FINAL.aprovechamiento))}
        ${tdC('-')}
      </tr>`;
      // Fila 5 — % ASISTENCIA (solo final)
      const r5 = `<tr style="${summaryStyle}">
        ${tdC('')}${tdL('% ASISTENCIA', true)}
        ${tdC('')}${tdC('')}${tdC('')}${tdC('')}${tdC('')}${tdC('')}
        ${tdC('')}${tdC(fmtPct(tot.FINAL.asistenciaPct))}
        ${tdC('')}${tdC('')}
        ${tdC('-')}
      </tr>`;
      totalesHtml = r1 + r2 + r3 + r4 + r5;
    } else {
      const tp = tot[r.mode] || {};
      const r1 = `<tr style="${rowStyle}">
        ${tdC('')}${tdL('TOTALES / PROMEDIO', true)}
        ${tdC(_formatInt(tp.sumaFaltas))}${tdC(_formatNum(tp.promedio,1))}
        ${tdC(fmtPct(tp.faltasPct))}${tdC('-')}
      </tr>`;
      const r2 = `<tr style="${rowStyle}">
        ${tdC('')}${tdL('APROBADOS / REPROBADOS', true)}
        ${tdC('')}${tdC(_formatInt(tp.aprobados) + ' / ' + _formatInt(tp.reprobados))}
        ${tdC('')}${tdC('-')}
      </tr>`;
      const r3 = `<tr style="${summaryStyle}">
        ${tdC('')}${tdL('% APROVECHAMIENTO / ASISTENCIA', true)}
        ${tdC('')}${tdC(fmtPct(tp.aprovechamiento))}
        ${tdC(fmtPct(tp.asistenciaPct))}${tdC('-')}
      </tr>`;
      totalesHtml = r1 + r2 + r3;
    }

    const headerCols = isAcum
      ? `<th rowspan="2">No.</th><th rowspan="2">Nombre del Alumno</th>
         <th colspan="2">PRIMER PARCIAL</th>
         <th colspan="2">SEGUNDO PARCIAL</th>
         <th colspan="2">TERCER PARCIAL</th>
         <th colspan="4">EVALUACIÓN FINAL</th>
         <th rowspan="2">EST.</th>`
      : `<th rowspan="2">No.</th><th rowspan="2">Nombre del Alumno</th>
         <th colspan="2">${parcMap[r.mode]} PARCIAL</th>
         <th rowspan="2">% FALTAS</th>
         <th rowspan="2">EST.</th>`;
    const subHeaderCols = isAcum
      ? `<th>F</th><th>CAL</th><th>F</th><th>CAL</th><th>F</th><th>CAL</th>
         <th>TOT.F</th><th>%F</th><th>PTS</th><th>FINAL</th>`
      : `<th>FALTAS</th><th>CAL.</th>`;

    const colsCount = isAcum ? 13 : 6;
    const nameColW = isAcum ? 22 : 35;
    const numColW = 4;
    const dataW = (100 - nameColW - numColW) / (colsCount - 2);
    let cols = `<col style="width:${numColW}%"><col style="width:${nameColW}%">`;
    for (let i = 0; i < colsCount - 2; i++) cols += `<col style="width:${dataW}%">`;

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    const html = `
<style>
/* F1 LANDSCAPE — márgenes mínimos para máximizar altura útil */
@page { size: letter landscape; margin: 4mm 5mm 3mm 5mm; }
html, body { margin:0; padding:0; }
* { box-sizing:border-box; margin:0; padding:0; }

/* ═══ PAGE LAYOUT ═══
   IMPORTANTE: NUNCA usar overflow:hidden ni height:100vh aquí. Causaron
   pérdida de alumnos en impresión real (reportado por maestros 2026-05-10).
   El font sizing dinámico se encarga del fit; si por extremo no entra,
   thead se repite en página 2. JAMÁS recortar contenido. */
.PG {
    width:100%;
    font-family:Arial,Helvetica,sans-serif; color:#000; line-height:1.0;
    font-size:${fs};
}
.PG table { border-collapse:collapse; }

@media screen {
    body { background:#e2e8f0; padding:16px 0; }
    .PG { background:#fff; max-width:279mm; min-height:208mm; margin:0 auto; padding:4mm 5mm; box-shadow:0 4px 20px rgba(0,0,0,0.15); }
}

@media print {
    .MT { page-break-inside: auto; }
    .MT tr { page-break-inside: avoid; page-break-after: auto; }
    .MT thead { display: table-header-group; }
    .MT tfoot { display: table-footer-group; }
    .PG-bot, .PG-ftr { page-break-inside: avoid; }
}

/* Header MUY compacto: logo + dirección general en lo mínimo posible */
.hdr-t { width:100%; margin-bottom:0; }
.hdr-t td { vertical-align:middle; padding:0; }
.hdr-t img { height:4.5mm; width:auto; }
.hdr-r { text-align:right; font-size:5.5pt; line-height:1.05; color:#333; }

/* Título de la escuela y subtítulo F1: línea base */
.ttl-esc { text-align:center; font-weight:bold; font-size:8.5pt; line-height:1; }
.ttl-ctrl { text-align:center; font-weight:bold; font-size:7.5pt; line-height:1; margin:0;
    border-bottom:0.5pt solid #000; padding-bottom:0.1mm; }

/* Info docente: padding mínimo absoluto */
.nfo { width:100%; font-size:7pt; line-height:1.05; margin-top:0.1mm; }
.nfo td { border:0.5pt solid #000; padding:0.1mm 0.8mm; vertical-align:middle; }
.nfo .lb { font-size:6pt; color:#444; }
.nfo .vl { font-weight:bold; font-size:7pt; }
.nfo .sm { text-align:center; font-weight:bold; font-size:7.5pt; line-height:1.05; }

/* Tabla: padding y line-height al mínimo para que las filas sean lo más compactas
   posible sin perder legibilidad. El font se mantiene controlado por ${fs}. */
.MT { width:100%; table-layout:fixed; font-size:${fs}; line-height:0.95; margin-top:0.2mm; }
.MT th { border:0.5pt solid #000; padding:0.15mm 0.2mm; text-align:center; font-weight:bold; font-size:${headerFs};
    background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;
    line-height:1; vertical-align:middle; overflow:hidden; }
.MT td { border:0.4pt solid #000; font-size:${fs}; line-height:0.95;
    padding:0.1mm 0.3mm; overflow:hidden; white-space:nowrap; vertical-align:middle; }
.MT .c { text-align:center; padding:0.1mm 0; }
/* La celda del nombre del alumno NUNCA corta el texto: el script de print
   reduce el font solo de esta celda hasta que el nombre completo quepa. */
.MT .nm { overflow:hidden; white-space:nowrap; padding-left:1mm; text-align:left; }

/* Firmas más compactas — el bloque que se iba a 2da página */
.SG-tbl { width:100%; border-collapse:collapse; margin-top:0.3mm; }
.SG-tbl td { width:25%; text-align:center; padding:0 2mm; vertical-align:bottom; }
.SG-tbl .sg-line-row td { border-bottom:0.5pt solid #000; height:3mm; }
.SG-tbl .sg-text-row td { vertical-align:top; padding-top:0.1mm; }
.SG-tt { font-weight:bold; font-size:6pt; line-height:1; }
.SG-nm { font-size:5.5pt; line-height:1.05; margin-top:0; }

/* Footer (cinta + dirección): mínimo */
.ftr { margin-top:0; }
.ftr img { width:100%; max-height:2mm; display:block; }
.ftr-t { text-align:center; font-size:4.8pt; color:#333; line-height:1; margin-top:0; }
</style>

<div class="PG">

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

<div class="PG-ttl">
<div class="ttl-esc">ESCUELA PREPARATORIA OFICIAL NÚM. 67</div>
<div class="ttl-ctrl">${Utils.sanitize(titulo)}</div>
</div>

<div class="PG-nfo">
<table class="nfo">
  <tr>
    <td style="width:8%"><span class="lb">Profesor(a):</span></td>
    <td style="width:30%" class="vl">${Utils.sanitize(profesor)}</td>
    <td style="width:7%"><span class="lb">Asignatura:</span></td>
    <td style="width:35%" class="vl">${Utils.sanitize(r.subjectName)}</td>
    <td style="width:20%" class="sm" rowspan="2">${semText}<br><span style="font-size:5.5pt;color:#333;">${Utils.sanitize(r.turno || '')}</span></td>
  </tr>
  <tr>
    <td><span class="lb">Orientador(a):</span></td>
    <td class="vl">${Utils.sanitize(orientador)}</td>
    <td colspan="2">
      <span class="lb">Grado:</span> <span class="vl">${r.grado}°</span>
      &nbsp;<span class="lb">Grupo:</span> <span class="vl">${Utils.sanitize(r.groupName)}</span>
      &nbsp;<span class="lb">H:</span> <span class="vl">${r.header.hombres}</span>
      &nbsp;<span class="lb">M:</span> <span class="vl">${r.header.mujeres}</span>
      &nbsp;<span class="lb">Total:</span> <span class="vl">${r.header.total}</span>
      &nbsp;<span class="lb">Horas:</span> <span class="vl">${horasTotales}</span>
      &nbsp;<span class="lb">Promedio:</span> <span class="vl">${_formatNum(r.summary.average, 2)}</span>
    </td>
  </tr>
</table>
</div>

<div class="PG-data">
<table class="MT">
  <colgroup>${cols}</colgroup>
  <thead>
    <tr>${headerCols}</tr>
    <tr>${subHeaderCols}</tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>${totalesHtml}</tfoot>
</table>
</div>

<div class="PG-bot">
<table style="width:100%; border-collapse:collapse; margin-top:0.3mm;">
  <tr><td style="width:100%; vertical-align:bottom; padding:0;">
    <table class="SG-tbl">
      <tr class="sg-line-row"><td></td><td></td><td></td><td></td></tr>
      <tr class="sg-text-row">
        <td><div class="SG-tt">PROFESOR(A) DE LA ASIGNATURA</div><div class="SG-nm">${Utils.sanitize(profesor)}</div></td>
        <td><div class="SG-tt">ORIENTADOR(A)</div><div class="SG-nm">${Utils.sanitize(orientador)}</div></td>
        <td><div class="SG-tt">VO. BO. SUBDIRECCIÓN ESCOLAR</div><div class="SG-nm">${Utils.sanitize(App.staffName('subdirector'))}</div></td>
        <td><div class="SG-tt">DIRECCIÓN ESCOLAR</div><div class="SG-nm">${Utils.sanitize(App.staffName('director'))}</div></td>
      </tr>
    </table>
  </td></tr>
</table>
</div>

<div class="PG-ftr">
<div class="ftr">
  ${logoFooter ? '<img src="' + logoFooter + '">' : ''}
  <div class="ftr-t">Av. de los Astros 7, Cuautitlán Izcalli, Estado de México, México C.P. 54770 · Tel. 55 5877 0221 · epo67@edu.gem.gob.mx</div>
</div>
</div>

</div>`;

    const docTitle = Utils.fileName({
      tipo: 'F1',
      turno: r.turno,
      grupo: r.groupName,
      materia: r.subjectName,
      maestro: profesor,
      parcial: isAcum ? 'ACUMULADO' : r.mode
    });
    // Script: shrink-to-fit en celdas de nombre + print. Bajo NINGUNA
    // circunstancia se corta un nombre de alumno (regla del usuario 2026-05-11).
    const triggerScript = '<script>(function(){function shrinkNameCells(){document.querySelectorAll(".MT td.nm").forEach(function(td){if(td.scrollWidth<=td.clientWidth+1)return;var cur=parseFloat(getComputedStyle(td).fontSize);var min=5;var step=0.3;var guard=80;while(td.scrollWidth>td.clientWidth+1&&cur>min&&guard-->0){cur-=step;td.style.fontSize=cur+"px";}if(td.scrollWidth>td.clientWidth+1)td.style.overflow="visible";});}window.addEventListener("load",function(){setTimeout(function(){shrinkNameCells();window.print();},300);});})();<\/script>';
    const win = window.open('', '_blank');
    win.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' +
      Utils.sanitize(docTitle) + '</title></head><body>' + html + triggerScript + '</body></html>');
    win.document.close();
  }

  function _bindEvents(container) {
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'f1-generate') generate();
      else if (action === 'f1-export') exportReport();
      else if (action === 'f1-print') printReport();
    });

    _el('f1-assignment')?.addEventListener('change', () => {
      lastReport = null;
      document.querySelector('[data-action="f1-export"]')?.setAttribute('disabled', 'disabled');
      document.querySelector('[data-action="f1-print"]')?.setAttribute('disabled', 'disabled');
    });
  }

  return { render };
})();

Router.modules['my-f1'] = () => MyF1Module.render();
