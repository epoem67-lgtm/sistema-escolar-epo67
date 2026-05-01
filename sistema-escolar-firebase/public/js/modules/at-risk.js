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

  // ─── ADMIN VIEW ───
  async function renderAdmin(container) {
    try {
      if (!App.currentUser || !(App.currentUser.role === 'admin' || App.canActAs('orientador'))) {
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

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Clasificaci\u00f3n por sem\u00e1foro: materias reprobadas (cal &lt; 6)</p>
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
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted p-lg">No hay estudiantes en riesgo con los filtros seleccionados</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      const level = s.riskLevel || 'MEDIO';
      const rl = RISK_LEVELS[level] || RISK_LEVELS.MEDIO;
      const failingNames = (s.failingSubjects || s.subjects?.map(x => x.subjectName) || []);
      const failingCount = s.failingCount ?? failingNames.length;
      const totalFaltas = s.totalFaltas || 0;
      const faltasStyle = totalFaltas >= 15 ? 'color:#dc2626;font-weight:700;' : totalFaltas >= 10 ? 'color:#d97706;font-weight:600;' : '';
      const faltasIcon = s.attendanceRisk ? ' <span title="Riesgo de extraordinario por inasistencias" style="color:#dc2626;">!</span>' : '';
      return `
        <tr style="${riskStyle(level)}padding:0;">
          <td>${riskBadge(level)}</td>
          <td class="font-semibold">${Utils.sanitize(s.studentName || '')}</td>
          <td class="text-muted">${Utils.sanitize(s.groupId || '')}</td>
          <td class="text-muted">${Utils.sanitize(s.turno || '')}</td>
          <td style="font-weight:700;color:${rl.color};">${failingCount}</td>
          <td style="${faltasStyle}">${totalFaltas}${faltasIcon}</td>
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
    // Use Store cache per group instead of reading entire grades collection
    const allGroups = await Store.getGroups();
    const groupIds = allGroups.map(g => g.id);
    const allGrades = await Store.getGradesByGroups(groupIds, true);
    const studentData = {}; // track both failures and attendance

    for (const grade of allGrades) {
      const calValue = getGradeValue(grade);
      const key = grade.studentId;
      if (!key) continue;

      if (!studentData[key]) {
        studentData[key] = {
          studentId: grade.studentId,
          studentName: grade.studentName,
          groupId: grade.groupId,
          turno: grade.turno || '',
          grado: grade.grado || null,
          partial: grade.partial || '',
          subjects: [],
          failingSubjects: [],
          grades: [],
          totalFaltas: 0,
          gradeCount: 0,
          faltasDetail: []
        };
      }

      // Track attendance
      const faltas = parseInt(grade.faltas) || 0;
      if (faltas > 0) {
        studentData[key].totalFaltas += faltas;
        const subjectName = grade.subjectName || grade.subject || '';
        studentData[key].faltasDetail.push({ subject: subjectName, partial: grade.partial, faltas });
      }
      studentData[key].gradeCount++;

      // Track failing grades
      if (calValue !== null && calValue < 6) {
        const subjectName = grade.subjectName || grade.subject || '';
        if (!studentData[key].failingSubjects.includes(subjectName)) {
          studentData[key].failingSubjects.push(subjectName);
        }
        studentData[key].subjects.push({ subjectName, grade: calValue });
        studentData[key].grades.push(calValue);
      }
    }

    // Process each student — collect writes, then batch commit
    const pendingWrites = [];
    for (const [key, data] of Object.entries(studentData)) {
      const failingCount = data.failingSubjects.length;

      // Determine risk level from grades
      let riskLevel = classifyRiskLevel(failingCount);

      // Check attendance risk (high absences = potential extraordinarios)
      // Flag if total faltas across all subjects >= 15 for any parcial
      const attendanceRisk = data.totalFaltas >= 15;
      if (attendanceRisk && !riskLevel) riskLevel = 'BAJO';
      if (attendanceRisk && riskLevel === 'BAJO') riskLevel = 'MEDIO';

      if (!riskLevel) continue;

      const avg = data.grades.length > 0
        ? data.grades.reduce((s, x) => s + x, 0) / data.grades.length
        : 0;

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
      const sd = studentData[d.studentId];
      if (!sd || (sd.failingSubjects.length === 0 && sd.totalFaltas < 15)) {
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
  async function renderTeacher(container) {
    try {
      if (!App.currentUser || !App.canActAs('maestro')) {
        container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
        return;
      }

      // Maestro: query filtrada por teacherId (firestore.rules requieren esto)
      let teacherStudents;
      const role = App.currentUser?.role;
      if (role === 'maestro' || role === 'orientador_docente') {
        const teacherDocId = await Store.getTeacherDocId();
        if (!teacherDocId) {
          container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">person_off</span><p>Tu cuenta no está vinculada a un docente.</p></div></div>`;
          return;
        }
        const snap = await db.collection('atRisk').where('teacherId', '==', teacherDocId).get();
        teacherStudents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
        teacherStudents = await Store.getAtRisk();
      }
      teacherStudents = sortByRiskLevel(teacherStudents);

      container.innerHTML = `
        <div class="module-container">
          <div class="module-header">
            <div class="module-header-text">
              <h1 class="module-title">Mis Estudiantes en Riesgo</h1>
              <p class="module-subtitle">Alumnos de tus grupos clasificados por nivel de riesgo</p>
            </div>
          </div>
          <div id="teacher-list"></div>
        </div>
      `;

      const listContainer = document.getElementById('teacher-list');

      if (teacherStudents.length === 0) {
        listContainer.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">check_circle</span><p class="empty-state-text">No hay estudiantes en riesgo en tus grupos.</p></div>`;
        return;
      }

      listContainer.innerHTML = teacherStudents.map(s => {
        const level = s.riskLevel || 'MEDIO';
        const rl = RISK_LEVELS[level] || RISK_LEVELS.MEDIO;
        const failingNames = (s.failingSubjects || s.subjects?.map(x => x.subjectName) || []);
        return `
          <div class="risk-item" style="${riskStyle(level)}padding:12px 16px;margin-bottom:8px;border-radius:8px;">
            <div class="risk-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span class="risk-title" style="font-weight:700;">${Utils.sanitize(s.studentName)}</span>
              ${riskBadge(level)}
            </div>
            <div class="risk-description" style="margin-bottom:4px;">Promedio: ${s.average?.toFixed(2) || 'N/A'} | Reprobadas: ${s.failingCount ?? failingNames.length}</div>
            ${failingNames.length ? `<div class="text-muted" style="font-size:var(--font-size-sm)">Materias: ${failingNames.map(n => Utils.sanitize(n)).join(', ')}</div>` : ''}
          </div>
        `;
      }).join('');
    } catch (error) {
      console.error('Error in renderTeacher:', error);
      Toast.show('Error al cargar datos', 'error');
    }
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
