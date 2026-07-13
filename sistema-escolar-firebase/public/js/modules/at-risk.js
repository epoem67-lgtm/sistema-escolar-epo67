/**
 * AT-RISK STUDENTS MODULE
 * Admin view: all at-risk students with filtering, detection, status tracking
 * Teacher view: students from assigned groups
 * Reports view: summary stats and CSS bar charts
 *
 * Traffic-light (semaforo) classification:
 *   ALTO  (Red)    - 5+ failing subjects - Critical risk
 *   MEDIO (Yellow) - 3-4 failing subjects - Moderate risk
 *   BAJO  (Green)  - 1-2 failing subjects - Low risk
 */

const AtRiskModule = (() => {
  let allAtRiskStudents = [];

  // ─── RISK LEVEL HELPERS ───
  const RISK_LEVELS = {
    ALTO:  { label: 'Alto',  icon: '\ud83d\udd34', color: '#dc2626', bg: '#fef2f2', order: 0 },
    MEDIO: { label: 'Medio', icon: '\ud83d\udfe1', color: '#d97706', bg: '#fffbeb', order: 1 },
    BAJO:  { label: 'Bajo',  icon: '\ud83d\udfe2', color: '#16a34a', bg: '#f0fdf4', order: 2 }
  };

  function classifyRiskLevel(failingCount) {
    if (failingCount >= 5) return 'ALTO';
    if (failingCount >= 3) return 'MEDIO';
    if (failingCount >= 1) return 'BAJO';
    return null; // no risk
  }

  function riskStyle(level) {
    const r = RISK_LEVELS[level];
    if (!r) return '';
    return `color: ${r.color}; background: ${r.bg}; border-left: 4px solid ${r.color};`;
  }

  function riskBadge(level) {
    const r = RISK_LEVELS[level];
    if (!r) return '';
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:12px;font-weight:600;font-size:var(--font-size-sm,0.85rem);color:${r.color};background:${r.bg};">${r.icon} ${r.label}</span>`;
  }

  function sortByRiskLevel(students) {
    return [...students].sort((a, b) => {
      const orderA = RISK_LEVELS[a.riskLevel]?.order ?? 99;
      const orderB = RISK_LEVELS[b.riskLevel]?.order ?? 99;
      return orderA - orderB;
    });
  }

  function getGradeValue(g) {
    if (g.cal !== undefined) return Number(g.cal);
    if (g.value !== undefined) return Math.min(Number(g.value), 10);
    return null;
  }

  function formatRiskReasons(s) {
    const reasons = [];
    if ((s.failingCount || 0) > 0) reasons.push(`${s.failingCount} materia(s) con parcial reprobado`);
    if (s.twoPartialFailureRisk) reasons.push('Dos parciales reprobados en la misma materia');
    if (s.attendanceRisk) reasons.push('Mas de 20% de inasistencias en una materia');
    return reasons.length ? reasons : ['Riesgo academico'];
  }

  function riskReasonDetails(s) {
    const parts = [];
    if (s.twoPartialFailureSubjects?.length) {
      parts.push('Dos parciales: ' + s.twoPartialFailureSubjects.map(x =>
        `${x.subjectName} (${(x.partials || []).join(', ')})`
      ).join('; '));
    }
    if (s.attendanceSubjects?.length) {
      parts.push('Faltas +20%: ' + s.attendanceSubjects.map(x =>
        `${x.subjectName} (${x.faltas}/${x.hours} hrs, ${x.percent}%)`
      ).join('; '));
    }
    return parts.join(' | ');
  }

  // ─── ADMIN VIEW ───
  async function renderAdmin(container) {
    try {
      // Admin, subdirector, orientador y auditor pueden ver at-risk completo.
      // Auditor (Jessica con auditorScope=true) lee TODO el sistema sin filtros.
      if (!App.currentUser || !(App.currentUser.role === 'admin' || App.currentUser.role === 'subdirector' || App.canActAs('orientador') || App.canActAs('auditor'))) {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
        return;
      }

      let allAtRiskRaw = await Store.getAtRisk();

      // Orientador filtering: only show students from assigned groups
      const oriGroups = await Store.getOrientadorGroups();
      if (oriGroups) {
        const oriGroupSet = new Set(oriGroups);
        const allGroups = await Store.getGroups();
        const oriGroupNames = new Set(
          allGroups.filter(g => oriGroupSet.has(g.id)).map(g => g.nombre || g.grupo).filter(Boolean)
        );
        allAtRiskRaw = allAtRiskRaw.filter(s =>
          oriGroupSet.has(s.groupId) || oriGroupNames.has(s.groupId)
        );
      }
      allAtRiskStudents = sortByRiskLevel(allAtRiskRaw);

      const turnos = [...new Set(allAtRiskStudents.map(s => s.turno))].sort();
      // Dedup robusto coercionando a Number — protege contra grado mixto (string + integer)
      const grados = [...new Set(allAtRiskStudents.map(s => Number(s.grado)))].filter(g => Number.isFinite(g) && g > 0).sort((a, b) => a - b);

      // Stats per risk level
      const countAlto  = allAtRiskStudents.filter(s => s.riskLevel === 'ALTO').length;
      const countMedio = allAtRiskStudents.filter(s => s.riskLevel === 'MEDIO').length;
      const countBajo  = allAtRiskStudents.filter(s => s.riskLevel === 'BAJO').length;
      const countExtra = allAtRiskStudents.filter(s => s.extraordinaryRisk).length;
      const countFaltas = allAtRiskStudents.filter(s => s.attendanceRisk).length;
      const countDosParciales = allAtRiskStudents.filter(s => s.twoPartialFailureRisk).length;

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Sem\u00e1foro por materias reprobadas, dos parciales reprobados y m\u00e1s de 20% de inasistencias</p>
            </div>
            <div class="module-actions">
              <button class="btn btn-primary" data-action="update-detection">Actualizar detecci\u00f3n</button>
            </div>
          </div>

          <!-- Stats bar -->
          <div class="card" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:12px 20px;margin-bottom:16px;">
            <span style="font-weight:600;margin-right:8px;">Sem\u00e1foro:</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#dc2626;background:#fef2f2;">\ud83d\udd34 Alto: ${countAlto}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#d97706;background:#fffbeb;">\ud83d\udfe1 Medio: ${countMedio}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#16a34a;background:#f0fdf4;">\ud83d\udfe2 Bajo: ${countBajo}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#991b1b;background:#fee2e2;">Extraordinario: ${countExtra}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#9a3412;background:#ffedd5;">Faltas +20%: ${countFaltas}</span>
            <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 14px;border-radius:8px;font-weight:600;color:#7c2d12;background:#fef3c7;">2 parciales: ${countDosParciales}</span>
            <span style="margin-left:auto;font-weight:600;color:var(--text-secondary,#666);">Total: ${allAtRiskStudents.length}</span>
          </div>

          <div class="card filter-bar">
            <div class="filter-bar-grid">
              <div class="form-group">
                <label for="filter-risk-level">Nivel de riesgo</label>
                <select id="filter-risk-level">
                  <option value="">Todos</option>
                  <option value="ALTO">\ud83d\udd34 Alto (5+)</option>
                  <option value="MEDIO">\ud83d\udfe1 Medio (3-4)</option>
                  <option value="BAJO">\ud83d\udfe2 Bajo (1-2)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="filter-turno">Turno</label>
                <select id="filter-turno">
                  <option value="">Todos</option>
                  ${turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="filter-grado">Grado</label>
                <select id="filter-grado">
                  <option value="">Todos</option>
                  ${grados.map(g => `<option value="${g}">${g}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label for="filter-partial">Parcial</label>
                <select id="filter-partial">
                  <option value="">Todos</option>
                  ${K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="table-container">
            <table class="table-light">
              <thead>
                <tr>
                  <th>Nivel</th>
                  <th>Alumno</th>
                  <th>Grupo</th>
                  <th>Turno</th>
                  <th>Reprobadas</th>
                  <th>Faltas</th>
                  <th>Motivo</th>
                  <th>Materias</th>
                  <th>Promedio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody id="admin-table-body"></tbody>
            </table>
          </div>
        </div>
      `;

      renderAdminTable(allAtRiskStudents);
      bindAdminEvents(container);
    } catch (error) {
      console.error('Error in renderAdmin:', error);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  function renderAdminTable(students) {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted p-lg">No hay estudiantes en riesgo con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      const level = s.riskLevel || 'MEDIO';
      const rl = RISK_LEVELS[level] || RISK_LEVELS.MEDIO;
      const failingNames = (s.failingSubjects || s.subjects?.map(x => x.subjectName) || []);
      const failingCount = s.failingCount ?? failingNames.length;
      const totalFaltas = s.totalFaltas || 0;
      const faltasStyle = totalFaltas >= 15 ? 'color:#dc2626;font-weight:700;' : totalFaltas >= 10 ? 'color:#d97706;font-weight:600;' : '';
      const faltasIcon = s.attendanceRisk ? ' <span title="Riesgo de extraordinario por inasistencias" style="color:#dc2626;font-weight:800;">+20%</span>' : '';
      const reasons = formatRiskReasons(s);
      const detail = riskReasonDetails(s);
      return `
        <tr style="${riskStyle(level)}padding:0;">
          <td>${riskBadge(level)}</td>
          <td class="font-semibold">${Utils.sanitize(s.studentName || '')}</td>
          <td class="text-muted">${Utils.sanitize(s.groupId || '')}</td>
          <td class="text-muted">${Utils.sanitize(s.turno || '')}</td>
          <td style="font-weight:700;color:${rl.color};">${failingCount}</td>
          <td style="${faltasStyle}">${totalFaltas}${faltasIcon}</td>
          <td style="font-size:var(--font-size-sm,0.8rem);max-width:260px;white-space:normal;" title="${Utils.sanitize(detail)}">${reasons.map(n => Utils.sanitize(n)).join('<br>')}</td>
          <td style="font-size:var(--font-size-sm,0.8rem);max-width:220px;white-space:normal;">${failingNames.map(n => Utils.sanitize(n)).join(', ') || '-'}</td>
          <td><span class="grade-badge grade-badge--fail">${s.average?.toFixed(2) || 'N/A'}</span></td>
          <td>${s.status === 'active' ? '<span class="badge badge-danger">Activo</span>' : '<span class="badge badge-success">Resuelto</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  function applyAdminFilters() {
    const riskLevel = document.getElementById('filter-risk-level')?.value;
    const turno = document.getElementById('filter-turno')?.value;
    const grado = document.getElementById('filter-grado')?.value;
    const partial = document.getElementById('filter-partial')?.value;

    let filtered = [...allAtRiskStudents];
    if (riskLevel) filtered = filtered.filter(s => s.riskLevel === riskLevel);
    if (turno) filtered = filtered.filter(s => s.turno === turno);
    if (grado) filtered = filtered.filter(s => s.grado === parseInt(grado));
    if (partial) filtered = filtered.filter(s => s.partial === partial);

    renderAdminTable(filtered);
  }

  function bindAdminEvents(container) {
    // Filter changes
    ['filter-risk-level', 'filter-turno', 'filter-grado', 'filter-partial'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', applyAdminFilters);
    });

    // Event delegation
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'update-detection') {
        btn.disabled = true;
        btn.textContent = 'Actualizando...';
        try {
          await detectAndFlagAtRisk();
          Store.invalidate('atRisk');
          Toast.show('Detecci\u00f3n completada', 'success');
          // Reload from cache (force refresh)
          allAtRiskStudents = sortByRiskLevel(await Store.getAtRisk(true));
          renderAdminTable(allAtRiskStudents);
          // Update stats bar counts
          updateStatsBar();
        } catch (error) {
          console.error('Error in manual detection:', error);
          Toast.show('Error al actualizar detecci\u00f3n', 'error');
        }
        btn.textContent = 'Actualizar detecci\u00f3n';
        btn.disabled = false;
      }
    });
  }

  function updateStatsBar() {
    // Re-render the whole admin view is simplest; but we can just update counts in-place
    // For now we re-render the admin view
    const container = document.getElementById('moduleContainer');
    if (container) renderAdmin(container);
  }

  // ─── AUTO-DETECTION (Semaforo) ───
  // Detects at-risk students by: 1) failing grades (cal < 6), 2) excessive absences
  // Attendance risk: 20%+ absences per subject may lead to extraordinarios
  async function detectAndFlagAtRisk() {
    // Use Store cache per group instead of reading entire grades collection.
    // Risk rules:
    // 1) any failed partial is academic risk,
    // 2) two failed partials in the same subject means extraordinary,
    // 3) absences above 20% of taught hours in a subject means extraordinary.
    const [allGroups, allAssignments] = await Promise.all([
      Store.getGroups(),
      Store.getAssignments()
    ]);
    const groupIds = allGroups.map(g => g.id);
    const [allGrades, allStudents] = await Promise.all([
      Store.getGradesByGroups(groupIds, true),
      Store.getStudentsByGroups(groupIds, true)
    ]);

    const groupMap = {};
    allGroups.forEach(g => { groupMap[g.id] = g; });

    const studentMap = {};
    allStudents.forEach(s => { studentMap[s.id] = s; });

    const assignmentMap = {};
    allAssignments.forEach(a => {
      assignmentMap[`${a.groupId}_${a.subjectId}`] = a;
    });

    const hoursBySubject = {};
    try {
      const hoursSnap = await db.collection('teacherHours').get();
      // FIX bug-horas-triplicadas (v8.46): desde v8.32 cada asignación tiene 4
      // docs replicados (P1/P2/P3/SEMESTRE) con el MISMO valor. SUMARLOS daba
      // 4× el total real. Ahora tomamos UN solo doc por asignación (prioridad
      // SEMESTRE > P3 > P2 > P1) y leemos el total una vez.
      const docsByKey = {};
      const priority = { 'SEMESTRE': 4, 'P3': 3, 'P2': 2, 'P1': 1 };
      hoursSnap.forEach(doc => {
        const h = doc.data() || {};
        if (!h.groupId || !h.subjectId) return;
        const key = `${h.groupId}_${h.subjectId}`;
        const myPrio = priority[h.partial] || 0;
        const curPrio = docsByKey[key] ? (priority[docsByKey[key].partial] || 0) : -1;
        if (myPrio > curPrio) docsByKey[key] = h;
      });
      for (const [key, h] of Object.entries(docsByKey)) {
        const total = ['febrero','marzo','abril','mayo','junio','julio']
          .reduce((sum, month) => sum + (parseInt(h[month], 10) || 0), 0);
        hoursBySubject[key] = total;
      }
    } catch (error) {
      console.warn('No se pudieron cargar horas impartidas para riesgo por faltas:', error);
    }

    const studentData = {}; // track both failures and attendance

    for (const grade of allGrades) {
      const calValue = getGradeValue(grade);
      const key = grade.studentId;
      if (!key) continue;
      const student = studentMap[key] || {};
      const group = groupMap[grade.groupId] || {};
      const assignment = assignmentMap[`${grade.groupId}_${grade.subjectId}`] || {};
      const subjectName = K.getUACNombre(grade.subjectName || grade.subject || assignment.subjectName || grade.subjectId || '');

      if (!studentData[key]) {
        studentData[key] = {
          studentId: grade.studentId,
          studentName: student.nombreCompleto || grade.studentName || '',
          groupId: grade.groupId,
          turno: group.turno || student.turno || grade.turno || '',
          grado: Number(group.grado || student.grado || grade.grado) || null,
          partial: grade.partial || '',
          subjects: [],
          failingSubjects: [],
          gradeValues: [],
          totalFaltas: 0,
          gradeCount: 0,
          faltasDetail: [],
          bySubject: {},
          teacherIds: new Set()
        };
      }

      if (!studentData[key].bySubject[grade.subjectId]) {
        studentData[key].bySubject[grade.subjectId] = {
          subjectId: grade.subjectId,
          subjectName,
          failedPartials: new Set(),
          faltas: 0,
          condonadas: 0,
          hours: hoursBySubject[`${grade.groupId}_${grade.subjectId}`] || 0
        };
      }
      if (assignment.teacherId) studentData[key].teacherIds.add(assignment.teacherId);

      // Track attendance
      const faltas = parseInt(grade.faltas) || 0;
      if (faltas > 0) {
        studentData[key].totalFaltas += faltas;
        studentData[key].faltasDetail.push({ subject: subjectName, partial: grade.partial, faltas });
        studentData[key].bySubject[grade.subjectId].faltas += faltas;
      }
      // Faltas condonadas por Dirección (jul-2026): restan al efectivo del umbral.
      // Suele venir en el doc P3; se acumula aparte del bruto.
      studentData[key].bySubject[grade.subjectId].condonadas += parseInt(grade.faltasCondonadas) || 0;
      studentData[key].gradeCount++;
      if (calValue !== null && !isNaN(calValue)) studentData[key].gradeValues.push(calValue);

      // Track failing grades
      if (calValue !== null && calValue < 6) {
        if (!studentData[key].failingSubjects.includes(subjectName)) {
          studentData[key].failingSubjects.push(subjectName);
        }
        studentData[key].subjects.push({ subjectName, grade: calValue });
        studentData[key].bySubject[grade.subjectId].failedPartials.add(grade.partial || '');
      }
    }

    // Process each student — collect writes, then batch commit
    const pendingWrites = [];
    for (const [key, data] of Object.entries(studentData)) {
      const failingCount = data.failingSubjects.length;
      const subjectEntries = Object.values(data.bySubject);
      const twoPartialFailureSubjects = subjectEntries
        .filter(s => s.failedPartials.size >= 2)
        .map(s => ({ subjectId: s.subjectId, subjectName: s.subjectName, partials: [...s.failedPartials].filter(Boolean).sort() }));
      const attendanceSubjects = subjectEntries
        .map(s => {
          // Faltas efectivas = brutas − condonadas por Dirección (nunca < 0).
          const efectivas = Math.max(0, s.faltas - (s.condonadas || 0));
          return {
            subjectId: s.subjectId,
            subjectName: s.subjectName,
            faltas: efectivas,
            faltasBrutas: s.faltas,
            condonadas: s.condonadas || 0,
            hours: s.hours,
            percent: s.hours > 0 ? Math.round((efectivas / s.hours) * 1000) / 10 : 0
          };
        })
        .filter(s => s.hours > 0 && (s.faltas / s.hours) > 0.20);

      // Determine risk level from grades
      let riskLevel = classifyRiskLevel(failingCount);

      const attendanceRisk = attendanceSubjects.length > 0;
      const twoPartialFailureRisk = twoPartialFailureSubjects.length > 0;
      const extraordinaryRisk = attendanceRisk || twoPartialFailureRisk;
      if (extraordinaryRisk) riskLevel = 'ALTO';

      if (!riskLevel) continue;

      const avg = data.gradeValues.length > 0
        ? data.gradeValues.reduce((s, x) => s + x, 0) / data.gradeValues.length
        : 0;
      const teacherIds = [...data.teacherIds].filter(Boolean);

      const docData = {
        studentId: data.studentId,
        studentName: data.studentName,
        groupId: data.groupId,
        turno: data.turno,
        grado: data.grado,
        partial: data.partial,
        subjects: data.subjects,
        failingSubjects: data.failingSubjects,
        failingCount: failingCount,
        riskLevel: riskLevel,
        average: parseFloat(avg.toFixed(2)),
        totalFaltas: data.totalFaltas,
        attendanceRisk: attendanceRisk,
        attendanceSubjects,
        twoPartialFailureRisk,
        twoPartialFailureSubjects,
        extraordinaryRisk,
        teacherId: teacherIds[0] || '',
        teacherIds,
        status: 'active',
        flaggedBy: App.currentUser.uid,
        flaggedAt: new Date(),
        updatedAt: new Date()
      };

      pendingWrites.push({ studentId: data.studentId, docData });
    }

    // Batch write: fetch all existing atRisk docs once, then use batch
    const existingAtRisk = await db.collection('atRisk').get();
    const existingByStudent = {};
    existingAtRisk.docs.forEach(doc => {
      const d = doc.data();
      if (d.studentId) existingByStudent[d.studentId] = doc;
    });

    // Write in batches of 400 (Firestore limit is 500)
    const BATCH_LIMIT = 400;
    let batchOps = [];

    for (const { studentId, docData } of pendingWrites) {
      const existingDoc = existingByStudent[studentId];
      if (existingDoc) {
        batchOps.push({ type: 'update', ref: existingDoc.ref, data: {
          subjects: docData.subjects,
          failingSubjects: docData.failingSubjects,
          failingCount: docData.failingCount,
          riskLevel: docData.riskLevel,
          average: docData.average,
          turno: docData.turno,
          grado: docData.grado,
          partial: docData.partial,
          totalFaltas: docData.totalFaltas,
          attendanceRisk: docData.attendanceRisk,
          attendanceSubjects: docData.attendanceSubjects,
          twoPartialFailureRisk: docData.twoPartialFailureRisk,
          twoPartialFailureSubjects: docData.twoPartialFailureSubjects,
          extraordinaryRisk: docData.extraordinaryRisk,
          teacherId: docData.teacherId,
          teacherIds: docData.teacherIds,
          studentName: docData.studentName,
          updatedAt: new Date()
        }});
      } else {
        batchOps.push({ type: 'set', ref: db.collection('atRisk').doc(), data: docData });
      }
    }

    // Mark students that no longer have risk as resolved
    for (const doc of existingAtRisk.docs) {
      const d = doc.data();
      if (d.status !== 'active') continue;
      if (!pendingWrites.some(w => w.studentId === d.studentId)) {
        batchOps.push({ type: 'update', ref: doc.ref, data: { status: 'resolved', riskLevel: null, updatedAt: new Date() } });
      }
    }

    // Commit all writes in batches
    for (let i = 0; i < batchOps.length; i += BATCH_LIMIT) {
      const chunk = batchOps.slice(i, i + BATCH_LIMIT);
      const batch = db.batch();
      chunk.forEach(op => {
        if (op.type === 'set') batch.set(op.ref, op.data);
        else batch.update(op.ref, op.data);
      });
      await batch.commit();
    }
  }

  // ─── TEACHER VIEW ───
  let teacherAtRiskRecords = [];
  let teacherGroupSubjectBuckets = [];
  let teacherAssignmentMeta = { turnos: [], groups: [], subjects: [] };
  let teacherViewMode = 'tabla'; // 'tabla' | 'semaforo'

  async function renderTeacher(container) {
    try {
      if (!App.currentUser || !App.canActAs('maestro')) {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
        return;
      }

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Mis Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Detección automática desde tus calificaciones y faltas. Filtra y consulta por grupo, materia o tipo de riesgo.</p>
            </div>
          </div>
          <div id="teacher-loading" class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Calculando riesgos...</p></div>
          <div id="teacher-content" style="display:none;"></div>
        </div>
      `;

      const loadingEl = document.getElementById('teacher-loading');
      const contentEl = document.getElementById('teacher-content');

      // v8.09: vista MAESTRO de at-risk usa STRICT — Jessica como auditor
      // tiene su propia ruta admin; cuando entra como maestro, solo ve SUS
      // 4 asignaciones, no las 216 de toda la escuela.
      const assignments = (await Store.getOwnAssignments()).filter(a => a.groupId && a.subjectId);
      if (assignments.length === 0) {
        loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
        contentEl.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">inbox</span><p class="empty-state-text">No tienes asignaciones registradas.</p></div>`;
        return;
      }

      const groupIds = [...new Set(assignments.map(a => a.groupId))];
      // Las 3 lecturas grandes en paralelo + cache de 3-5 min
      const [studentsRaw, gradesRaw, hoursMap] = await Promise.all([
        Store.getStudentsByGroups(groupIds),
        Store.getGradesByGroups(groupIds, true),
        Store.getTeacherHoursForGroups(groupIds)
      ]);
      const students = studentsRaw.filter(s => s.estatus !== 'BAJA' && s.estatus !== 'baja' && s.estatus !== 'EGRESADO');

      const horaMap = {};
      hoursMap.forEach((doc, docId) => {
        horaMap[docId] = doc.total;
      });

      const RIESGO_PCT = 20, ALERTA_PCT = 15, PASS = K.THRESHOLDS.PASS_GRADE;
      const byStudent = new Map();
      const buckets = new Map(); // groupId__subjectId → bucket

      assignments.forEach(asg => {
        const subjectName = K.getUACNombre(asg.subjectName || asg.subjectId);
        const groupStudents = students.filter(s => s.groupId === asg.groupId);
        const subjGrades = gradesRaw.filter(g => g.groupId === asg.groupId && g.subjectId === asg.subjectId);
        const bucketKey = `${asg.groupId}__${asg.subjectId}`;

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            groupId: asg.groupId,
            groupName: asg.groupName || asg.groupId,
            turno: asg.turno || '',
            grado: asg.grado || '',
            subjectId: asg.subjectId,
            subjectName,
            totalStudents: groupStudents.length,
            alumnos: []
          });
        }
        const bucket = buckets.get(bucketKey);

        groupStudents.forEach(student => {
          const sId = student.id;
          const myGrades = subjGrades.filter(g => g.studentId === sId);
          if (myGrades.length === 0) return;

          let failingPartialsInThisSubject = 0;
          const failingPartialIds = [];
          let attendanceTriggered = false;
          let attendanceWarning = false;
          let topFaltas = 0, topHours = 0, topPct = 0, topPartial = '';
          let totalFaltasSubj = 0;
          const detailByPartial = {};

          K.PARCIALES.forEach(p => {
            const grade = myGrades.find(g => g.partial === p.id);
            const horas = horaMap[`${asg.groupId}_${asg.subjectId}_${p.id}`] || 0;
            detailByPartial[p.id] = { cal: null, faltas: null, hours: horas, pct: null };
            if (!grade) return;
            const cal = getGradeValue(grade);
            detailByPartial[p.id].cal = cal;
            if (cal !== null && cal < PASS) {
              failingPartialsInThisSubject++;
              failingPartialIds.push(p.id);
            }
            const faltas = parseInt(grade.faltas) || 0;
            detailByPartial[p.id].faltas = faltas;
            totalFaltasSubj += faltas;
            if (horas > 0 && faltas > 0) {
              const pct = (faltas * 100) / horas;
              detailByPartial[p.id].pct = pct;
              if (pct > topPct) { topPct = pct; topFaltas = faltas; topHours = horas; topPartial = p.id; }
              if (pct > RIESGO_PCT) attendanceTriggered = true;
              else if (pct >= ALERTA_PCT) attendanceWarning = true;
            }
          });

          // Condonación por Dirección (jul-2026): las faltas condonadas (guardadas
          // en el doc del parcial, normalmente P3) restan al total efectivo de la
          // materia. Solo afecta materias con condonación (condSubj > 0); el resto
          // conserva su lógica por parcial intacta. Se re-evalúa el umbral con base
          // semestral efectiva = brutas − condonadas.
          const condSubj = myGrades.reduce((s, g) => s + (parseInt(g.faltasCondonadas) || 0), 0);
          if (condSubj > 0) {
            const semHoras = (detailByPartial.P3 && detailByPartial.P3.hours)
              || (detailByPartial.P2 && detailByPartial.P2.hours)
              || (detailByPartial.P1 && detailByPartial.P1.hours) || 0;
            const efectivas = Math.max(0, totalFaltasSubj - condSubj);
            const effPct = semHoras > 0 ? (efectivas * 100) / semHoras : 0;
            attendanceTriggered = effPct > RIESGO_PCT;
            attendanceWarning = !attendanceTriggered && effPct >= ALERTA_PCT;
            detailByPartial.__condonadas = condSubj;
            detailByPartial.__faltasEfectivas = efectivas;
          }

          const hasAnyIssue = failingPartialsInThisSubject > 0 || attendanceTriggered || attendanceWarning;
          if (!hasAnyIssue) return;

          // Nivel del alumno EN ESTA materia específica
          let subjectLevel;
          if (attendanceTriggered || failingPartialsInThisSubject >= 2) subjectLevel = 'ALTO';
          else if (failingPartialsInThisSubject >= 1 || attendanceWarning) subjectLevel = 'MEDIO';
          else subjectLevel = 'BAJO';

          // Push a bucket por (grupo, materia)
          bucket.alumnos.push({
            studentId: sId,
            studentName: student.nombreCompleto || '',
            level: subjectLevel,
            failingPartials: failingPartialsInThisSubject,
            failingPartialIds,
            attendanceRisk: attendanceTriggered,
            attendanceWarning,
            topFaltas, topHours, topPct, topPartial,
            totalFaltasSubj,
            detailByPartial
          });

          // Aggregate por alumno (vista global)
          if (!byStudent.has(sId)) {
            byStudent.set(sId, {
              studentId: sId,
              studentName: student.nombreCompleto || '',
              groupId: student.groupId,
              groupName: asg.groupName || student.groupId,
              turno: asg.turno || student.turno || '',
              grado: asg.grado || student.grado || '',
              failingSubjects: [],
              failingSubjectIds: [],
              attendanceSubjects: [],
              attendanceWarningSubjects: [],
              twoPartialFailureSubjects: [],
              failingCount: 0,
              totalFaltas: 0,
              affectedSubjectIds: new Set(),
              average: null,
              _allCals: []
            });
          }
          const rec = byStudent.get(sId);
          rec.affectedSubjectIds.add(asg.subjectId);
          rec.totalFaltas += totalFaltasSubj;
          if (failingPartialsInThisSubject > 0) {
            rec.failingSubjects.push(subjectName);
            rec.failingSubjectIds.push(asg.subjectId);
            rec.failingCount++;
          }
          if (failingPartialsInThisSubject >= 2) {
            rec.twoPartialFailureSubjects.push({ subjectName, partials: failingPartialIds });
          }
          if (attendanceTriggered) {
            rec.attendanceSubjects.push({
              subjectName, subjectId: asg.subjectId,
              faltas: topFaltas, hours: topHours,
              percent: topPct.toFixed(1), partial: topPartial
            });
          } else if (attendanceWarning) {
            rec.attendanceWarningSubjects.push({
              subjectName, subjectId: asg.subjectId,
              faltas: topFaltas, hours: topHours,
              percent: topPct.toFixed(1), partial: topPartial
            });
          }
          myGrades.forEach(g => {
            const v = getGradeValue(g);
            if (v !== null) rec._allCals.push(v);
          });
        });
      });

      // Computar conteos por bucket + ordenar alumnos por severidad
      buckets.forEach(b => {
        b.altoCount = b.alumnos.filter(a => a.level === 'ALTO').length;
        b.medioCount = b.alumnos.filter(a => a.level === 'MEDIO').length;
        b.bajoCount = b.alumnos.filter(a => a.level === 'BAJO').length;
        b.alumnos.sort((a, x) =>
          (RISK_LEVELS[a.level]?.order ?? 99) - (RISK_LEVELS[x.level]?.order ?? 99) ||
          a.studentName.localeCompare(x.studentName)
        );
      });
      // Orden: turno → grupo → orden oficial SEP de materias del grado.
      // Para el bucket conocemos grado vía bucket.grado (lo guarda el caller).
      teacherGroupSubjectBuckets = [...buckets.values()].sort((a, b) => {
        const t = (a.turno || '').localeCompare(b.turno || '');
        if (t !== 0) return t;
        const g = (a.groupName || '').localeCompare(b.groupName || '');
        if (g !== 0) return g;
        // Mismo grupo → orden SEP del grado (si lo conocemos)
        if (a.grado && b.grado && a.grado === b.grado) {
          const order = K.SUBJECT_ORDER[Number(a.grado)] || [];
          const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
          const ia = order.findIndex(o => norm(o) === norm(a.subjectName) || norm(a.subjectName).includes(norm(o)) || norm(o).includes(norm(a.subjectName)));
          const ib = order.findIndex(o => norm(o) === norm(b.subjectName) || norm(b.subjectName).includes(norm(o)) || norm(o).includes(norm(b.subjectName)));
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        }
        return (a.subjectName || '').localeCompare(b.subjectName || '');
      });

      const records = [...byStudent.values()].map(r => {
        if (r._allCals.length > 0) {
          r.average = r._allCals.reduce((a, b) => a + b, 0) / r._allCals.length;
        }
        delete r._allCals;
        const hasAttendanceRisk = r.attendanceSubjects.length > 0;
        const hasTwoPartialFailure = r.twoPartialFailureSubjects.length > 0;
        const hasAttendanceWarning = r.attendanceWarningSubjects.length > 0;
        if (hasAttendanceRisk || hasTwoPartialFailure || r.failingCount >= 3) {
          r.riskLevel = 'ALTO';
        } else if (r.failingCount >= 1 || hasAttendanceWarning) {
          r.riskLevel = 'MEDIO';
        } else {
          r.riskLevel = 'BAJO';
        }
        r.attendanceRisk = hasAttendanceRisk;
        r.twoPartialFailureRisk = hasTwoPartialFailure;
        r.affectedSubjects = [...r.affectedSubjectIds];
        delete r.affectedSubjectIds;
        return r;
      });

      teacherAtRiskRecords = sortByRiskLevel(records);

      // Construir listas para los filtros (mapeo turno→grupos, grupo→materias)
      const turnos = [...new Set(assignments.map(a => a.turno).filter(Boolean))].sort();
      const groupsAll = [...new Map(assignments.map(a => [a.groupId, {
        id: a.groupId,
        name: a.groupName || a.groupId,
        turno: a.turno || '',
        grado: a.grado || ''
      }])).values()].sort((a, b) => (a.turno + a.name).localeCompare(b.turno + b.name));
      const subjectsAll = [...new Map(assignments.map(a => [a.subjectId, {
        id: a.subjectId,
        name: K.getUACNombre(a.subjectName || a.subjectId),
        nombre: K.getUACNombre(a.subjectName || a.subjectId),  // alias para sortSubjectsByGrado
        grado: Number(a.grado) || null,
        groupIds: []
      }])).values()];
      // Para cada materia, ¿en qué grupos la imparto?
      assignments.forEach(a => {
        const subj = subjectsAll.find(s => s.id === a.subjectId);
        if (subj && !subj.groupIds.includes(a.groupId)) subj.groupIds.push(a.groupId);
      });
      // Orden: grado ascendente → orden SEP dentro del grado
      const _byGrado = {};
      for (const s of subjectsAll) {
        const g = s.grado || 0;
        if (!_byGrado[g]) _byGrado[g] = [];
        _byGrado[g].push(s);
      }
      const _sortedByGrado = [];
      for (const g of Object.keys(_byGrado).sort((a, b) => Number(a) - Number(b))) {
        _sortedByGrado.push(...K.sortSubjectsByGrado(_byGrado[g], Number(g)));
      }
      subjectsAll.length = 0;
      subjectsAll.push(..._sortedByGrado);

      teacherAssignmentMeta = { turnos, groups: groupsAll, subjects: subjectsAll };

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

      _renderTeacherShell(contentEl);
      _applyTeacherFilters();
    } catch (error) {
      console.error('Error in renderTeacher:', error);
      const lc = document.getElementById('teacher-loading');
      if (lc) lc.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>Error al calcular riesgos: ${Utils.sanitize(error.message || 'desconocido')}</p></div>`;
    }
  }

  function _renderTeacherShell(contentEl) {
    const counts = {
      ALTO: teacherAtRiskRecords.filter(r => r.riskLevel === 'ALTO').length,
      MEDIO: teacherAtRiskRecords.filter(r => r.riskLevel === 'MEDIO').length,
      BAJO: teacherAtRiskRecords.filter(r => r.riskLevel === 'BAJO').length
    };
    const countFaltas = teacherAtRiskRecords.filter(r => r.attendanceRisk).length;
    const countDosParciales = teacherAtRiskRecords.filter(r => r.twoPartialFailureRisk).length;

    const turnoOptions = teacherAssignmentMeta.turnos.map(t =>
      `<option value="${Utils.sanitize(t)}">${Utils.sanitize(t)}</option>`
    ).join('');

    contentEl.innerHTML = `
      <!-- Stats / semáforo global -->
      <div class="card" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 18px;margin-bottom:14px;">
        <span style="font-weight:600;margin-right:8px;">Semáforo global:</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:8px;font-weight:600;color:#dc2626;background:#fef2f2;">🔴 Alto: ${counts.ALTO}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:8px;font-weight:600;color:#d97706;background:#fffbeb;">🟡 Medio: ${counts.MEDIO}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:8px;font-weight:600;color:#16a34a;background:#f0fdf4;">🟢 Bajo: ${counts.BAJO}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:8px;font-weight:600;color:#9a3412;background:#ffedd5;">Faltas +20%: ${countFaltas}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:5px 14px;border-radius:8px;font-weight:600;color:#7c2d12;background:#fef3c7;">2 parciales: ${countDosParciales}</span>
        <span style="margin-left:auto;font-weight:600;color:#666;">Total: ${teacherAtRiskRecords.length}</span>
      </div>

      <!-- Tabs vista -->
      <div style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid #e5e7eb;">
        <button class="tch-view-tab" data-view="tabla" style="padding:10px 20px;border:none;background:none;font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid transparent;color:#6b7280;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">table_view</span>
          Tabla por alumno
        </button>
        <button class="tch-view-tab" data-view="semaforo" style="padding:10px 20px;border:none;background:none;font-weight:600;font-size:14px;cursor:pointer;border-bottom:3px solid transparent;color:#6b7280;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">grid_view</span>
          Semáforo por grupo / materia
        </button>
      </div>

      <!-- Filtros en cascada -->
      <div class="card filter-bar">
        <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));">
          <div class="form-group">
            <label for="tch-filter-turno">1. Turno</label>
            <select id="tch-filter-turno">
              <option value="">Todos</option>
              ${turnoOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="tch-filter-group">2. Grupo</label>
            <select id="tch-filter-group">
              <option value="">Todos mis grupos</option>
            </select>
          </div>
          <div class="form-group">
            <label for="tch-filter-subject">3. Materia</label>
            <select id="tch-filter-subject">
              <option value="">Todas mis materias</option>
            </select>
          </div>
          <div class="form-group">
            <label for="tch-filter-level">4. Nivel de riesgo</label>
            <select id="tch-filter-level">
              <option value="">Todos</option>
              <option value="ALTO">🔴 Alto</option>
              <option value="MEDIO">🟡 Medio</option>
              <option value="BAJO">🟢 Bajo</option>
            </select>
          </div>
          <div class="form-group">
            <label for="tch-search">Buscar alumno</label>
            <input type="text" id="tch-search" placeholder="Nombre..." class="ge-input" style="width:100%;">
          </div>
          <div class="form-group">
            <label for="tch-filter-reason">Motivo</label>
            <select id="tch-filter-reason">
              <option value="">Todos</option>
              <option value="faltas">Faltas +20% (riesgo extraordinario)</option>
              <option value="alerta-faltas">Alerta faltas (15-20%)</option>
              <option value="reprobado">Calificación reprobada</option>
              <option value="dos-parciales">Dos parciales reprobados</option>
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:flex-end;gap:6px;">
            <button class="btn btn-outline" data-action="tch-clear-filters" style="flex:1;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">filter_alt_off</span>
              Limpiar
            </button>
          </div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" data-action="tch-print-filtered">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">print</span>
            Imprimir filtrado
          </button>
          <button class="btn btn-outline btn-sm" data-action="tch-print-all-separated">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">print</span>
            Imprimir todo separado (1 hoja por grupo/materia)
          </button>
        </div>
      </div>

      <div id="tch-result-summary" style="margin:8px 0;font-size:13px;color:#555;"></div>

      <div id="tch-view-content"></div>
    `;

    // Activar tab inicial
    _setTeacherViewTab(teacherViewMode);

    // Inicializar dropdowns en cascada
    _updateTeacherCascadeOptions();

    // Eventos de filtros (cambios cascadean)
    document.getElementById('tch-filter-turno')?.addEventListener('change', () => {
      // al cambiar turno, reset grupo y materia
      const gSel = document.getElementById('tch-filter-group');
      const sSel = document.getElementById('tch-filter-subject');
      if (gSel) gSel.value = '';
      if (sSel) sSel.value = '';
      _updateTeacherCascadeOptions();
      _applyTeacherFilters();
    });
    document.getElementById('tch-filter-group')?.addEventListener('change', () => {
      const sSel = document.getElementById('tch-filter-subject');
      if (sSel) sSel.value = '';
      _updateTeacherCascadeOptions();
      _applyTeacherFilters();
    });
    ['tch-search', 'tch-filter-level', 'tch-filter-subject', 'tch-filter-reason'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', _applyTeacherFilters);
    });

    contentEl.addEventListener('click', e => {
      const tab = e.target.closest('.tch-view-tab');
      if (tab) {
        teacherViewMode = tab.dataset.view;
        _setTeacherViewTab(teacherViewMode);
        _applyTeacherFilters();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'tch-clear-filters') {
        ['tch-filter-turno','tch-filter-group','tch-filter-subject','tch-filter-level','tch-filter-reason'].forEach(id => {
          const el = document.getElementById(id); if (el) el.value = '';
        });
        const s = document.getElementById('tch-search'); if (s) s.value = '';
        _updateTeacherCascadeOptions();
        _applyTeacherFilters();
      } else if (action === 'tch-print-filtered') {
        _printTeacherFiltered();
      } else if (action === 'tch-print-all-separated') {
        _printTeacherAllSeparated();
      } else if (action === 'tch-print-bucket') {
        const bucketKey = btn.dataset.bucketKey;
        const b = teacherGroupSubjectBuckets.find(x => `${x.groupId}__${x.subjectId}` === bucketKey);
        if (b) _printTeacherBuckets([b], `Riesgo ${b.groupName} – ${b.subjectName}`);
      }
    });
  }

  function _setTeacherViewTab(mode) {
    document.querySelectorAll('.tch-view-tab').forEach(b => {
      const isActive = b.dataset.view === mode;
      b.style.color = isActive ? '#3182ce' : '#6b7280';
      b.style.borderBottomColor = isActive ? '#3182ce' : 'transparent';
    });
  }

  function _updateTeacherCascadeOptions() {
    const turno = document.getElementById('tch-filter-turno')?.value || '';
    const groupId = document.getElementById('tch-filter-group')?.value || '';

    // Grupos visibles según turno
    const gSel = document.getElementById('tch-filter-group');
    if (gSel) {
      const filteredGroups = teacherAssignmentMeta.groups.filter(g => !turno || g.turno === turno);
      const currentValue = gSel.value;
      gSel.innerHTML = '<option value="">Todos mis grupos</option>' +
        filteredGroups.map(g => `<option value="${Utils.sanitize(g.id)}">${Utils.sanitize(g.turno || '')} ${Utils.sanitize(g.name)}${g.grado ? ' (' + g.grado + '°)' : ''}</option>`).join('');
      if (filteredGroups.find(g => g.id === currentValue)) gSel.value = currentValue;
    }

    // Materias visibles según grupo (si hay) o todas
    const sSel = document.getElementById('tch-filter-subject');
    if (sSel) {
      const realGroupId = document.getElementById('tch-filter-group')?.value || '';
      const filteredSubjects = realGroupId
        ? teacherAssignmentMeta.subjects.filter(s => s.groupIds.includes(realGroupId))
        : teacherAssignmentMeta.subjects.filter(s => {
            if (!turno) return true;
            // materia visible si la imparte en algún grupo del turno
            const groupsInTurno = teacherAssignmentMeta.groups.filter(g => g.turno === turno).map(g => g.id);
            return s.groupIds.some(gid => groupsInTurno.includes(gid));
          });
      const currentValue = sSel.value;
      sSel.innerHTML = '<option value="">Todas mis materias</option>' +
        filteredSubjects.map(s => `<option value="${Utils.sanitize(s.id)}">${Utils.sanitize(s.name)}</option>`).join('');
      if (filteredSubjects.find(s => s.id === currentValue)) sSel.value = currentValue;
    }
  }

  function _getCurrentFilters() {
    return {
      search: (document.getElementById('tch-search')?.value || '').toLowerCase().trim(),
      turno: document.getElementById('tch-filter-turno')?.value || '',
      groupId: document.getElementById('tch-filter-group')?.value || '',
      subjectId: document.getElementById('tch-filter-subject')?.value || '',
      level: document.getElementById('tch-filter-level')?.value || '',
      reason: document.getElementById('tch-filter-reason')?.value || ''
    };
  }

  function _filterAtRiskRecords(f) {
    let filtered = [...teacherAtRiskRecords];
    if (f.search) {
      const norm = f.search.normalize('NFD').replace(/[̀-ͯ]/g, '');
      filtered = filtered.filter(r => {
        const n = (r.studentName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return n.includes(norm);
      });
    }
    if (f.turno) filtered = filtered.filter(r => r.turno === f.turno);
    if (f.level) filtered = filtered.filter(r => r.riskLevel === f.level);
    if (f.groupId) filtered = filtered.filter(r => r.groupId === f.groupId);
    if (f.subjectId) {
      filtered = filtered.filter(r => Array.isArray(r.affectedSubjects) && r.affectedSubjects.includes(f.subjectId));
    }
    if (f.reason) {
      if (f.reason === 'faltas') filtered = filtered.filter(r => r.attendanceRisk);
      else if (f.reason === 'alerta-faltas') filtered = filtered.filter(r => r.attendanceWarningSubjects.length > 0);
      else if (f.reason === 'reprobado') filtered = filtered.filter(r => r.failingCount > 0);
      else if (f.reason === 'dos-parciales') filtered = filtered.filter(r => r.twoPartialFailureRisk);
    }
    return filtered;
  }

  function _filterBuckets(f) {
    let filtered = [...teacherGroupSubjectBuckets];
    if (f.turno) filtered = filtered.filter(b => b.turno === f.turno);
    if (f.groupId) filtered = filtered.filter(b => b.groupId === f.groupId);
    if (f.subjectId) filtered = filtered.filter(b => b.subjectId === f.subjectId);

    // Filtrar alumnos dentro de cada bucket por search/level/reason
    filtered = filtered.map(b => {
      let alumnos = [...b.alumnos];
      if (f.search) {
        const norm = f.search.normalize('NFD').replace(/[̀-ͯ]/g, '');
        alumnos = alumnos.filter(a => {
          const n = (a.studentName || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
          return n.includes(norm);
        });
      }
      if (f.level) alumnos = alumnos.filter(a => a.level === f.level);
      if (f.reason) {
        if (f.reason === 'faltas') alumnos = alumnos.filter(a => a.attendanceRisk);
        else if (f.reason === 'alerta-faltas') alumnos = alumnos.filter(a => a.attendanceWarning && !a.attendanceRisk);
        else if (f.reason === 'reprobado') alumnos = alumnos.filter(a => a.failingPartials > 0);
        else if (f.reason === 'dos-parciales') alumnos = alumnos.filter(a => a.failingPartials >= 2);
      }
      return { ...b, alumnos };
    }).filter(b => b.alumnos.length > 0);
    return filtered;
  }

  function _applyTeacherFilters() {
    const f = _getCurrentFilters();
    const summaryEl = document.getElementById('tch-result-summary');
    const viewEl = document.getElementById('tch-view-content');
    if (!viewEl) return;

    if (teacherViewMode === 'semaforo') {
      const buckets = _filterBuckets(f);
      _renderSemaforoView(viewEl, buckets);
      if (summaryEl) {
        const total = buckets.reduce((s, b) => s + b.alumnos.length, 0);
        summaryEl.textContent = buckets.length === 0
          ? 'No hay grupos/materias que coincidan con los filtros.'
          : `Mostrando ${buckets.length} grupo/materia(s) · ${total} alumno(s) en riesgo.`;
      }
    } else {
      const filtered = _filterAtRiskRecords(f);
      _renderTeacherTable(viewEl, filtered);
      if (summaryEl) {
        summaryEl.textContent = filtered.length === teacherAtRiskRecords.length
          ? `Mostrando ${filtered.length} alumno(s) en riesgo.`
          : `Mostrando ${filtered.length} de ${teacherAtRiskRecords.length} alumno(s) en riesgo.`;
      }
    }
  }

  function _renderTeacherTable(container, records) {
    if (records.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">filter_list</span><p class="empty-state-text">No hay alumnos que coincidan con los filtros aplicados.</p></div>`;
      return;
    }
    container.innerHTML = `
      <div class="table-container">
        <table class="table-light">
          <thead>
            <tr>
              <th style="width:80px;">Nivel</th>
              <th>Alumno</th>
              <th style="width:90px;">Grupo</th>
              <th style="width:90px;">Promedio</th>
              <th style="width:140px;">Materias afectadas</th>
              <th>Motivo</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(s => {
              const level = s.riskLevel;
              const reasons = formatRiskReasons(s);
              const detail = riskReasonDetails(s);
              const warnAtt = s.attendanceWarningSubjects?.length > 0
                ? ' Alerta faltas (15-20%): ' + s.attendanceWarningSubjects.map(x => `${x.subjectName} (${x.percent}%)`).join('; ')
                : '';
              const fullDetail = (detail + warnAtt).trim();
              return `
                <tr style="${riskStyle(level)}">
                  <td>${riskBadge(level)}</td>
                  <td class="font-semibold">${Utils.sanitize(s.studentName || '')}</td>
                  <td class="text-muted">${Utils.sanitize(s.groupName || '')}</td>
                  <td><strong>${s.average !== null ? s.average.toFixed(2) : '-'}</strong></td>
                  <td style="font-size:12.5px;">${s.failingSubjects.length > 0 ? s.failingSubjects.map(n => Utils.sanitize(n)).join(', ') : '-'}</td>
                  <td style="font-size:12.5px;font-weight:600;">${reasons.map(n => Utils.sanitize(n)).join('<br>')}</td>
                  <td style="font-size:12px;color:#444;max-width:280px;white-space:normal;">${fullDetail ? Utils.sanitize(fullDetail) : '-'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function _renderSemaforoView(container, buckets) {
    if (buckets.length === 0) {
      container.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">grid_view</span><p class="empty-state-text">No hay grupos/materias con alumnos en riesgo en los filtros.</p></div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;">
        ${buckets.map(b => {
          const key = `${b.groupId}__${b.subjectId}`;
          return `
          <div class="card" style="padding:14px;border-left:6px solid ${b.altoCount > 0 ? '#dc2626' : (b.medioCount > 0 ? '#d97706' : '#16a34a')};">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;gap:8px;">
              <div style="min-width:0;">
                <div style="font-weight:700;font-size:15px;color:#111;">${Utils.sanitize(b.groupName)} <span style="color:#6b7280;font-weight:500;font-size:12px;">${Utils.sanitize(b.turno || '')}${b.grado ? ' · ' + b.grado + '°' : ''}</span></div>
                <div style="font-size:13px;color:#374151;font-weight:600;margin-top:2px;">${Utils.sanitize(b.subjectName)}</div>
              </div>
              <button class="btn btn-outline btn-sm" data-action="tch-print-bucket" data-bucket-key="${key}" title="Imprimir esta lista" style="padding:4px 8px;flex-shrink:0;">
                <span class="material-icons-round" style="font-size:16px;">print</span>
              </button>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:10px;">
              <span style="flex:1;text-align:center;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px;">🔴 ${b.altoCount}</span>
              <span style="flex:1;text-align:center;background:#fffbeb;color:#d97706;border:1px solid #fde68a;border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px;">🟡 ${b.medioCount}</span>
              <span style="flex:1;text-align:center;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:6px;padding:4px 8px;font-weight:700;font-size:13px;">🟢 ${b.bajoCount}</span>
              <span style="flex:1;text-align:center;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-weight:600;font-size:13px;">Total ${b.alumnos.length}</span>
            </div>
            <div style="max-height:240px;overflow-y:auto;">
              ${b.alumnos.length === 0
                ? '<div style="color:#9ca3af;font-style:italic;font-size:13px;padding:8px;">Sin alumnos en riesgo en esta combinación.</div>'
                : b.alumnos.map(a => {
                    const partialDetails = K.PARCIALES.map(p => {
                      const d = a.detailByPartial[p.id];
                      if (!d || (d.cal === null && d.faltas === null)) return '';
                      const calStr = d.cal !== null ? d.cal : '-';
                      // v8.39: si hay cal capturada pero faltas null → mostrar 0 (no guión)
                      const fStr = d.faltas !== null ? d.faltas : (d.cal !== null ? 0 : '-');
                      const pctStr = d.pct !== null ? ` (${d.pct.toFixed(0)}%)` : '';
                      return `<span style="display:inline-block;font-size:11px;color:#444;margin-right:6px;">${p.id}: <strong>${calStr}</strong> · ${fStr}f${pctStr}</span>`;
                    }).join('');
                    const sty = a.level === 'ALTO' ? 'background:#fef2f2;border-left:3px solid #dc2626;' :
                                a.level === 'MEDIO' ? 'background:#fffbeb;border-left:3px solid #d97706;' :
                                'background:#f0fdf4;border-left:3px solid #16a34a;';
                    return `
                      <div style="${sty}padding:6px 10px;margin-bottom:4px;border-radius:4px;">
                        <div style="font-weight:600;font-size:13px;display:flex;justify-content:space-between;gap:6px;">
                          <span>${Utils.sanitize(a.studentName)}</span>
                          ${riskBadge(a.level)}
                        </div>
                        <div style="margin-top:2px;">${partialDetails}</div>
                      </div>`;
                  }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // ─── PRINTING ───
  function _printTeacherFiltered() {
    const f = _getCurrentFilters();
    if (teacherViewMode === 'semaforo') {
      const buckets = _filterBuckets(f);
      if (buckets.length === 0) { Toast.show('Nada que imprimir con los filtros actuales', 'warning'); return; }
      _printTeacherBuckets(buckets, 'Reporte de alumnos en riesgo');
    } else {
      const records = _filterAtRiskRecords(f);
      if (records.length === 0) { Toast.show('Nada que imprimir con los filtros actuales', 'warning'); return; }
      _printTeacherFlatList(records, f);
    }
  }

  function _printTeacherAllSeparated() {
    const f = _getCurrentFilters();
    const buckets = _filterBuckets(f);
    if (buckets.length === 0) { Toast.show('Nada que imprimir con los filtros actuales', 'warning'); return; }
    _printTeacherBuckets(buckets, 'Reporte de alumnos en riesgo (separado)');
  }

  function _buildPrintHead(title) {
    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    return `
      <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
        <tr>
          <td style="width:50%;vertical-align:middle;">${logoHeader ? '<img src="' + logoHeader + '" style="height:14mm;">' : ''}</td>
          <td style="text-align:right;font-size:8.5pt;line-height:1.3;color:#333;">
            DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR<br>
            DIRECCIÓN DE BACHILLERATO GENERAL<br>
            ZONA ESCOLAR NÚM. 63 BC<br>
            ESCUELA PREPARATORIA OFICIAL NÚM. 67<br>
            <b>C.C.T. 15EBH0134D · 15EBH0168U</b>
          </td>
        </tr>
      </table>
      <h1 style="text-align:center;font-size:13pt;margin:6px 0 2px;">ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
      <h2 style="text-align:center;font-size:11pt;margin:0 0 8px;font-weight:700;border-bottom:1pt solid #000;padding-bottom:4px;">${Utils.sanitize(title)}</h2>
    `;
  }

  function _buildPrintFootSignatures(profesor, orientador) {
    return `
      <div style="margin-top:14mm;page-break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="width:25%;text-align:center;border-top:1px solid #000;padding-top:4px;font-size:9pt;font-weight:700;">PROFESOR(A) DE LA ASIGNATURA</td>
            <td style="width:25%;text-align:center;border-top:1px solid #000;padding-top:4px;font-size:9pt;font-weight:700;">ORIENTADOR(A)</td>
            <td style="width:25%;text-align:center;border-top:1px solid #000;padding-top:4px;font-size:9pt;font-weight:700;">VO. BO. SUBDIRECCIÓN ESCOLAR</td>
            <td style="width:25%;text-align:center;border-top:1px solid #000;padding-top:4px;font-size:9pt;font-weight:700;">DIRECCIÓN ESCOLAR</td>
          </tr>
          <tr>
            <td style="text-align:center;font-size:8.5pt;">${Utils.sanitize(profesor || '')}</td>
            <td style="text-align:center;font-size:8.5pt;">${Utils.sanitize(orientador || '')}</td>
            <td style="text-align:center;font-size:8.5pt;">${Utils.sanitize(App.staffName('subdirector'))}</td>
            <td style="text-align:center;font-size:8.5pt;">${Utils.sanitize(App.staffName('director'))}</td>
          </tr>
        </table>
      </div>
    `;
  }

  function _bucketTeacherName() {
    return Utils.displayName(App.currentUser?.displayName || App.currentUser?.email || '');
  }

  function _printTeacherBuckets(buckets, baseTitle) {
    const profesor = _bucketTeacherName();
    const sections = buckets.map((b, idx) => {
      const orientador = K.getOrientador(b.turno, b.groupName) || '';
      const isLast = idx === buckets.length - 1;
      const pageBreak = isLast ? '' : 'page-break-after:always;';
      const rows = b.alumnos.map((a, i) => {
        const partialCells = K.PARCIALES.map(p => {
          const d = a.detailByPartial[p.id];
          const cal = d?.cal !== null && d?.cal !== undefined ? d.cal : '-';
          // v8.39: si hay cal capturada pero faltas null → mostrar 0 (no guión)
          const hasCal = d?.cal !== null && d?.cal !== undefined;
          const faltas = (d?.faltas !== null && d?.faltas !== undefined)
            ? d.faltas
            : (hasCal ? 0 : '-');
          const pct = d?.pct !== null && d?.pct !== undefined ? d.pct.toFixed(0) + '%' : '-';
          return `<td style="text-align:center;font-size:9pt;border:0.5pt solid #000;">${cal}</td>
                  <td style="text-align:center;font-size:9pt;border:0.5pt solid #000;">${faltas}</td>
                  <td style="text-align:center;font-size:9pt;border:0.5pt solid #000;">${pct}</td>`;
        }).join('');
        const reasons = [];
        if (a.attendanceRisk) reasons.push(`Faltas >20% (${a.topPct.toFixed(1)}%)`);
        else if (a.attendanceWarning) reasons.push(`Alerta faltas (${a.topPct.toFixed(1)}%)`);
        if (a.failingPartials > 0) reasons.push(`${a.failingPartials} parcial(es) reprobado(s)`);
        const lvlColor = a.level === 'ALTO' ? '#dc2626' : (a.level === 'MEDIO' ? '#d97706' : '#16a34a');
        return `
          <tr>
            <td style="text-align:center;font-size:9pt;border:0.5pt solid #000;">${i + 1}</td>
            <td style="font-size:9pt;border:0.5pt solid #000;padding:2px 4px;">${Utils.sanitize(a.studentName)}</td>
            <td style="text-align:center;font-size:9pt;border:0.5pt solid #000;color:${lvlColor};font-weight:700;">${a.level}</td>
            ${partialCells}
            <td style="font-size:8.5pt;border:0.5pt solid #000;padding:2px 4px;">${Utils.sanitize(reasons.join(' · '))}</td>
          </tr>`;
      }).join('');
      return `
        <div style="${pageBreak}padding:5mm;">
          ${_buildPrintHead('Reporte de alumnos en riesgo')}
          <table style="width:100%;font-size:9.5pt;margin-bottom:6px;">
            <tr>
              <td><strong>Profesor(a):</strong> ${Utils.sanitize(profesor)}</td>
              <td><strong>Asignatura:</strong> ${Utils.sanitize(b.subjectName)}</td>
              <td><strong>Grupo:</strong> ${Utils.sanitize(b.groupName)}${b.grado ? ' · ' + b.grado + '°' : ''}</td>
              <td><strong>Turno:</strong> ${Utils.sanitize(b.turno || '')}</td>
            </tr>
            <tr>
              <td colspan="2"><strong>Orientador(a):</strong> ${Utils.sanitize(orientador)}</td>
              <td><strong>Total alumnos en riesgo:</strong> ${b.alumnos.length}</td>
              <td>🔴 ${b.altoCount} · 🟡 ${b.medioCount} · 🟢 ${b.bajoCount}</td>
            </tr>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:9pt;">
            <thead>
              <tr style="background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
                <th rowspan="2" style="width:6%;border:0.5pt solid #000;padding:3px;">No.</th>
                <th rowspan="2" style="width:24%;border:0.5pt solid #000;padding:3px;">Nombre del Alumno</th>
                <th rowspan="2" style="width:9%;border:0.5pt solid #000;padding:3px;">Nivel</th>
                <th colspan="3" style="border:0.5pt solid #000;padding:3px;">Primer Parcial</th>
                <th colspan="3" style="border:0.5pt solid #000;padding:3px;">Segundo Parcial</th>
                <th colspan="3" style="border:0.5pt solid #000;padding:3px;">Tercer Parcial</th>
                <th rowspan="2" style="border:0.5pt solid #000;padding:3px;">Motivo</th>
              </tr>
              <tr style="background:#333;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">Cal</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">F</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">%</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">Cal</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">F</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">%</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">Cal</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">F</th>
                <th style="border:0.5pt solid #000;padding:2px;font-size:8pt;">%</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="13" style="text-align:center;padding:8px;font-style:italic;color:#666;">Sin alumnos en riesgo</td></tr>'}</tbody>
          </table>
          ${_buildPrintFootSignatures(profesor, orientador)}
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${Utils.sanitize(baseTitle)}</title>
      <style>
        @page { size: letter landscape; margin: 6mm 8mm; }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family: Arial, Helvetica, sans-serif; color:#000; }
        table { border-collapse:collapse; }
      </style>
      </head><body>${sections}<script>setTimeout(()=>window.print(),400)<\/script></body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  function _printTeacherFlatList(records, filters) {
    const profesor = _bucketTeacherName();
    const filterDesc = [];
    if (filters.turno) filterDesc.push(`Turno: ${filters.turno}`);
    if (filters.groupId) {
      const g = teacherAssignmentMeta.groups.find(x => x.id === filters.groupId);
      if (g) filterDesc.push(`Grupo: ${g.name}`);
    }
    if (filters.subjectId) {
      const s = teacherAssignmentMeta.subjects.find(x => x.id === filters.subjectId);
      if (s) filterDesc.push(`Materia: ${s.name}`);
    }
    if (filters.level) filterDesc.push(`Nivel: ${filters.level}`);
    if (filters.reason) filterDesc.push(`Motivo: ${filters.reason}`);
    const filterText = filterDesc.length > 0 ? filterDesc.join(' · ') : 'Sin filtros';

    const rows = records.map((s, i) => {
      const reasons = formatRiskReasons(s);
      const detail = riskReasonDetails(s);
      const lvlColor = s.riskLevel === 'ALTO' ? '#dc2626' : (s.riskLevel === 'MEDIO' ? '#d97706' : '#16a34a');
      return `
        <tr>
          <td style="text-align:center;border:0.5pt solid #000;padding:3px;font-size:9pt;">${i + 1}</td>
          <td style="border:0.5pt solid #000;padding:3px;font-size:9pt;font-weight:600;">${Utils.sanitize(s.studentName)}</td>
          <td style="text-align:center;border:0.5pt solid #000;padding:3px;font-size:9pt;color:${lvlColor};font-weight:700;">${s.riskLevel}</td>
          <td style="text-align:center;border:0.5pt solid #000;padding:3px;font-size:9pt;">${Utils.sanitize(s.groupName)}</td>
          <td style="text-align:center;border:0.5pt solid #000;padding:3px;font-size:9pt;">${s.average !== null ? s.average.toFixed(2) : '-'}</td>
          <td style="border:0.5pt solid #000;padding:3px;font-size:8.5pt;">${s.failingSubjects.map(n => Utils.sanitize(n)).join(', ') || '-'}</td>
          <td style="border:0.5pt solid #000;padding:3px;font-size:8.5pt;">${reasons.map(n => Utils.sanitize(n)).join(' · ')}</td>
          <td style="border:0.5pt solid #000;padding:3px;font-size:8pt;color:#444;">${Utils.sanitize(detail)}</td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Alumnos en Riesgo</title>
      <style>
        @page { size: letter landscape; margin: 8mm 10mm; }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family: Arial, Helvetica, sans-serif; color:#000; padding:5mm; }
        table { border-collapse:collapse; }
        tr { page-break-inside: avoid; }
      </style>
      </head><body>
        ${_buildPrintHead('Reporte de alumnos en riesgo (consolidado)')}
        <div style="font-size:10pt;margin-bottom:6px;">
          <strong>Profesor(a):</strong> ${Utils.sanitize(profesor)} ·
          <strong>Filtros:</strong> ${Utils.sanitize(filterText)} ·
          <strong>Total:</strong> ${records.length} alumno(s)
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:9pt;">
          <thead>
            <tr style="background:#000;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <th style="width:5%;border:0.5pt solid #000;padding:4px;">No.</th>
              <th style="width:18%;border:0.5pt solid #000;padding:4px;">Alumno</th>
              <th style="width:7%;border:0.5pt solid #000;padding:4px;">Nivel</th>
              <th style="width:7%;border:0.5pt solid #000;padding:4px;">Grupo</th>
              <th style="width:7%;border:0.5pt solid #000;padding:4px;">Promedio</th>
              <th style="width:18%;border:0.5pt solid #000;padding:4px;">Materias afectadas</th>
              <th style="border:0.5pt solid #000;padding:4px;">Motivo</th>
              <th style="border:0.5pt solid #000;padding:4px;">Detalle</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${_buildPrintFootSignatures(profesor, '')}
        <script>setTimeout(()=>window.print(),400)<\/script>
      </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  }

  // ─── REPORTS VIEW ───
  async function renderReports(container) {
    try {
      const students = await Store.getAtRisk();

      // Risk level distribution
      const byRisk = { ALTO: 0, MEDIO: 0, BAJO: 0 };
      students.forEach(s => {
        if (s.riskLevel && byRisk[s.riskLevel] !== undefined) {
          byRisk[s.riskLevel]++;
        }
      });

      // Per-turno breakdown
      const byTurno = {};
      students.forEach(s => {
        const t = s.turno || 'Sin turno';
        if (!byTurno[t]) byTurno[t] = { ALTO: 0, MEDIO: 0, BAJO: 0, total: 0 };
        byTurno[t].total++;
        if (s.riskLevel && byTurno[t][s.riskLevel] !== undefined) {
          byTurno[t][s.riskLevel]++;
        }
      });

      // Per-group breakdown (sorted by ALTO count desc)
      const byGroup = {};
      students.forEach(s => {
        const g = s.groupId || 'Sin grupo';
        if (!byGroup[g]) byGroup[g] = { ALTO: 0, MEDIO: 0, BAJO: 0, total: 0 };
        byGroup[g].total++;
        if (s.riskLevel && byGroup[g][s.riskLevel] !== undefined) {
          byGroup[g][s.riskLevel]++;
        }
      });
      const groupsSorted = Object.entries(byGroup).sort((a, b) => b[1].ALTO - a[1].ALTO);

      // By grado and partial (legacy charts)
      const byGrado = {}, byPartial = {};
      students.forEach(s => {
        byGrado[s.grado] = (byGrado[s.grado] || 0) + 1;
        byPartial[s.partial] = (byPartial[s.partial] || 0) + 1;
      });

      // ─ Build risk distribution chart (CSS bar chart)
      const totalStudents = students.length || 1;
      function riskDistributionChart() {
        return `
          <div class="card" style="margin-bottom:16px;">
            <h3 class="section-title" style="margin-bottom:12px;">Distribuci\u00f3n por Nivel de Riesgo</h3>
            <div style="display:flex;gap:0;height:36px;border-radius:8px;overflow:hidden;margin-bottom:12px;">
              ${byRisk.ALTO > 0 ? `<div style="flex:${byRisk.ALTO};background:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">${byRisk.ALTO}</div>` : ''}
              ${byRisk.MEDIO > 0 ? `<div style="flex:${byRisk.MEDIO};background:#d97706;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">${byRisk.MEDIO}</div>` : ''}
              ${byRisk.BAJO > 0 ? `<div style="flex:${byRisk.BAJO};background:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;">${byRisk.BAJO}</div>` : ''}
            </div>
            <div style="display:flex;gap:20px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:6px;"><span style="width:14px;height:14px;border-radius:50%;background:#dc2626;display:inline-block;"></span> Alto: <strong>${byRisk.ALTO}</strong> (${(byRisk.ALTO / totalStudents * 100).toFixed(1)}%)</div>
              <div style="display:flex;align-items:center;gap:6px;"><span style="width:14px;height:14px;border-radius:50%;background:#d97706;display:inline-block;"></span> Medio: <strong>${byRisk.MEDIO}</strong> (${(byRisk.MEDIO / totalStudents * 100).toFixed(1)}%)</div>
              <div style="display:flex;align-items:center;gap:6px;"><span style="width:14px;height:14px;border-radius:50%;background:#16a34a;display:inline-block;"></span> Bajo: <strong>${byRisk.BAJO}</strong> (${(byRisk.BAJO / totalStudents * 100).toFixed(1)}%)</div>
            </div>
          </div>
        `;
      }

      // ─ Build per-group breakdown table
      function groupBreakdownChart() {
        if (groupsSorted.length === 0) return '<div class="card"><p class="text-muted">Sin datos de grupos</p></div>';
        const maxTotal = Math.max(...groupsSorted.map(([, d]) => d.total), 1);
        const rows = groupsSorted.map(([group, d]) => `
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span class="font-semibold">${Utils.sanitize(String(group))}</span>
              <span style="font-size:0.8rem;color:#666;">${d.total} alumnos</span>
            </div>
            <div style="display:flex;gap:0;height:22px;border-radius:6px;overflow:hidden;background:#f3f4f6;">
              ${d.ALTO > 0 ? `<div style="flex:${d.ALTO};background:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.ALTO}</div>` : ''}
              ${d.MEDIO > 0 ? `<div style="flex:${d.MEDIO};background:#d97706;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.MEDIO}</div>` : ''}
              ${d.BAJO > 0 ? `<div style="flex:${d.BAJO};background:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.BAJO}</div>` : ''}
            </div>
          </div>
        `).join('');

        return `
          <div class="card" style="margin-bottom:16px;">
            <h3 class="section-title" style="margin-bottom:12px;">Desglose por Grupo (ordenado por riesgo Alto)</h3>
            ${rows}
          </div>
        `;
      }

      // ─ Build per-turno comparison
      function turnoComparisonChart() {
        const turnoEntries = Object.entries(byTurno);
        if (turnoEntries.length === 0) return '';
        const rows = turnoEntries.map(([turno, d]) => `
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span class="font-semibold">${Utils.sanitize(String(turno))}</span>
              <span style="font-size:0.8rem;color:#666;">${d.total} alumnos</span>
            </div>
            <div style="display:flex;gap:0;height:22px;border-radius:6px;overflow:hidden;background:#f3f4f6;">
              ${d.ALTO > 0 ? `<div style="flex:${d.ALTO};background:#dc2626;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.ALTO}</div>` : ''}
              ${d.MEDIO > 0 ? `<div style="flex:${d.MEDIO};background:#d97706;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.MEDIO}</div>` : ''}
              ${d.BAJO > 0 ? `<div style="flex:${d.BAJO};background:#16a34a;color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;">${d.BAJO}</div>` : ''}
            </div>
          </div>
        `).join('');

        return `
          <div class="card" style="margin-bottom:16px;">
            <h3 class="section-title" style="margin-bottom:12px;">Comparaci\u00f3n por Turno</h3>
            ${rows}
          </div>
        `;
      }

      function buildBarChart(title, data) {
        const max = Math.max(...Object.values(data), 1);
        const bars = Object.entries(data).map(([label, count]) => `
          <div class="mb-md">
            <div class="flex justify-between mb-sm">
              <span class="font-semibold">${Utils.sanitize(String(label))}</span>
              <span class="font-semibold text-muted">${count}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${(count / max * 100)}%"></div>
            </div>
          </div>
        `).join('');

        return `
          <div class="card">
            <h3 class="section-title">${title}</h3>
            ${bars || '<p class="text-muted">Sin datos</p>'}
          </div>
        `;
      }

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Reportes de Estudiantes en Riesgo</h1>
              <p class="module-subtitle">${students.length} estudiantes identificados</p>
            </div>
          </div>

          ${riskDistributionChart()}
          ${groupBreakdownChart()}
          ${turnoComparisonChart()}

          <div class="stats-grid">
            ${buildBarChart('Por Grado', byGrado)}
            ${buildBarChart('Por Parcial', byPartial)}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error in renderReports:', error);
      Toast.show('Error al cargar reportes', 'error');
    }
  }

  // ─── MODULE INIT ───
  function init() {
    Router.modules['at-risk'] = () => renderAdmin(document.getElementById('moduleContainer'));
    Router.modules['my-at-risk'] = () => renderTeacher(document.getElementById('moduleContainer'));
    Router.modules['reports'] = () => renderReports(document.getElementById('moduleContainer'));
  }

  return { init, renderAdmin, renderTeacher, renderReports };
})();

// Self-register with Router (same pattern as other modules)
AtRiskModule.init();
