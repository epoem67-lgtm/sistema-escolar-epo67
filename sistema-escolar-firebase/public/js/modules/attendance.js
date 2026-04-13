/**
 * ATTENDANCE MODULE
 * Track student attendance (present/absent/late/justified)
 * Teacher view: record attendance by date+group
 * Admin view: summary with % attendance per group
 */

const AttendanceModule = (() => {
  let students = [];
  let groups = [];
  let assignments = [];
  let selectedGroupId = null;
  let selectedDate = new Date().toISOString().split('T')[0];
  let attendanceRecords = {};

  async function render() {
    const container = document.getElementById('moduleContainer');
    const role = App.currentUser?.role;

    if (role === 'maestro') {
      await renderTeacherView(container);
    } else if (role === 'admin' || role === 'orientador') {
      await renderAdminView(container);
    } else {
      container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado</p></div></div>`;
    }
  }

  // ─── TEACHER VIEW ───
  async function renderTeacherView(container) {
    const teacherDocId = await Store.getTeacherDocId();
    if (!teacherDocId) {
      container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">person_off</span><p>No se pudo identificar al docente.</p></div></div>`;
      return;
    }

    const allAssignments = await Store.getAssignments();
    assignments = allAssignments.filter(a => a.teacherId === teacherDocId);
    const groupIds = [...new Set(assignments.map(a => a.groupId))];
    groups = (await Store.getGroups()).filter(g => groupIds.includes(g.id));

    const groupOptions = groups.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre)} (${Utils.sanitize(g.turno)})</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Registro de Asistencia</h1>
            <p class="module-subtitle">Selecciona grupo y fecha para registrar asistencia</p>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label>Grupo</label>
              <select id="att-group">
                <option value="">Seleccionar grupo...</option>
                ${groupOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Fecha</label>
              <input type="date" id="att-date" value="${selectedDate}">
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="load-attendance">Cargar</button>
            <button class="btn btn-success" data-action="save-attendance">Guardar Asistencia</button>
          </div>
        </div>

        <div id="att-list"></div>
      </div>
    `;

    bindEvents(container);
  }

  // ─── ADMIN VIEW ───
  async function renderAdminView(container) {
    groups = await Store.getGroups();
    students = await Store.getStudents();

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Asistencia - Panel Administrativo</h1>
            <p class="module-subtitle">Resumen de asistencia por grupo y turno</p>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label>Turno</label>
              <select id="att-turno">
                <option value="">Todos</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Desde</label>
              <input type="date" id="att-from" value="${getMonthStart()}">
            </div>
            <div class="form-group">
              <label>Hasta</label>
              <input type="date" id="att-to" value="${selectedDate}">
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="generate-summary">Generar Resumen</button>
            <button class="btn btn-outline" data-action="export-attendance">Exportar Excel</button>
          </div>
        </div>

        <div id="att-summary"></div>
      </div>
    `;

    bindEvents(container);
  }

  function getMonthStart() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  // ─── LOAD ATTENDANCE FOR A GROUP+DATE ───
  async function loadAttendance() {
    const groupId = document.getElementById('att-group')?.value;
    const date = document.getElementById('att-date')?.value;
    if (!groupId || !date) {
      Toast.show('Selecciona grupo y fecha', 'warning');
      return;
    }

    selectedGroupId = groupId;
    selectedDate = date;
    const listContainer = document.getElementById('att-list');
    listContainer.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Cargando...</p></div>`;

    try {
      const allStudents = await Store.getStudents();
      students = allStudents.filter(s => s.groupId === groupId && s.estatus === 'ACTIVO')
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));

      // Load existing records
      const snap = await db.collection('attendance')
        .where('groupId', '==', groupId)
        .where('date', '==', date)
        .get();

      attendanceRecords = {};
      snap.forEach(doc => {
        const d = doc.data();
        attendanceRecords[d.studentId] = { id: doc.id, ...d };
      });

      renderAttendanceList();
    } catch (error) {
      console.error('Error loading attendance:', error);
      Toast.show('Error al cargar asistencia', 'error');
      listContainer.innerHTML = '';
    }
  }

  function renderAttendanceList() {
    const listContainer = document.getElementById('att-list');
    if (students.length === 0) {
      listContainer.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">people</span><p class="empty-state-text">No hay alumnos activos en este grupo</p></div>`;
      return;
    }

    const statusOptions = [
      { value: 'present', label: 'Presente', badgeClass: 'badge-success' },
      { value: 'absent', label: 'Falta', badgeClass: 'badge-danger' },
      { value: 'late', label: 'Retardo', badgeClass: 'badge-warning' },
      { value: 'justified', label: 'Justificada', badgeClass: 'badge-inactive' }
    ];

    const rows = students.map((s, i) => {
      const current = attendanceRecords[s.id]?.status || '';
      const buttons = statusOptions.map(opt => {
        const active = current === opt.value ? 'btn-primary' : 'btn-outline btn-sm';
        return `<button class="btn btn-sm ${active}" data-action="set-status" data-student-id="${s.id}" data-status="${opt.value}">${opt.label}</button>`;
      }).join('');

      return `
        <tr>
          <td class="text-muted">${i + 1}</td>
          <td class="font-semibold">${Utils.sanitize(s.nombreCompleto)}</td>
          <td><div class="btn-group">${buttons}</div></td>
        </tr>
      `;
    }).join('');

    const presentCount = Object.values(attendanceRecords).filter(r => r.status === 'present').length;

    listContainer.innerHTML = `
      <div class="stats-grid mt-lg">
        <div class="stat-card--compact">
          <div class="stat-number">${students.length}</div>
          <div class="stat-label">Total Alumnos</div>
        </div>
        <div class="stat-card--compact">
          <div class="stat-number text-success">${presentCount}</div>
          <div class="stat-label">Presentes</div>
        </div>
        <div class="stat-card--compact">
          <div class="stat-number text-danger">${Object.values(attendanceRecords).filter(r => r.status === 'absent').length}</div>
          <div class="stat-label">Faltas</div>
        </div>
      </div>

      <div class="card mt-lg">
        <div class="flex justify-between items-center mb-md">
          <span class="font-semibold">Fecha: ${selectedDate}</span>
          <button class="btn btn-sm btn-outline" data-action="mark-all-present">Marcar Todos Presente</button>
        </div>
        <div class="table-container">
          <table class="table-light">
            <thead><tr><th>#</th><th>Alumno</th><th>Asistencia</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ─── SAVE ATTENDANCE ───
  async function saveAttendance() {
    if (!selectedGroupId) {
      Toast.show('Primero carga un grupo', 'warning');
      return;
    }

    try {
      const batch = db.batch();
      let count = 0;

      for (const [studentId, record] of Object.entries(attendanceRecords)) {
        if (record._new || record._changed) {
          const docId = `${studentId}_${selectedDate}`;
          const ref = db.collection('attendance').doc(docId);
          batch.set(ref, {
            studentId,
            groupId: selectedGroupId,
            date: selectedDate,
            status: record.status,
            turno: students.find(s => s.id === studentId)?.turno || '',
            recordedBy: auth.currentUser.uid,
            recordedAt: new Date()
          }, { merge: true });
          count++;
        }
      }

      await batch.commit();
      DB.audit('editar', 'asistencia', '', {
        description: `Asistencia guardada: ${count} registros`,
        extra: { count }
      });
      Toast.show(`Asistencia guardada: ${count} registros`, 'success');
    } catch (error) {
      console.error('Error saving attendance:', error);
      Toast.show('Error al guardar asistencia', 'error');
    }
  }

  // ─── ADMIN SUMMARY ───
  async function generateSummary() {
    const turno = document.getElementById('att-turno')?.value;
    const fromDate = document.getElementById('att-from')?.value;
    const toDate = document.getElementById('att-to')?.value;
    const summaryContainer = document.getElementById('att-summary');

    summaryContainer.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Calculando...</p></div>`;

    try {
      let query = db.collection('attendance');
      if (fromDate) query = query.where('date', '>=', fromDate);
      if (toDate) query = query.where('date', '<=', toDate);

      const snap = await query.get();
      const records = snap.docs.map(d => d.data());

      const filteredGroups = turno ? groups.filter(g => g.turno === turno) : groups;

      const summaryByGroup = {};
      filteredGroups.forEach(g => {
        const groupRecords = records.filter(r => r.groupId === g.id);
        const total = groupRecords.length;
        const present = groupRecords.filter(r => r.status === 'present').length;
        const absent = groupRecords.filter(r => r.status === 'absent').length;
        const pct = total > 0 ? Math.round((present / total) * 100) : 0;
        const pctClass = pct >= 80 ? '' : pct >= 60 ? 'warning' : 'critical';

        summaryByGroup[g.id] = { nombre: g.nombre, turno: g.turno, total, present, absent, pct, pctClass };
      });

      const rows = Object.values(summaryByGroup).sort((a, b) => a.nombre.localeCompare(b.nombre)).map(g => `
        <tr>
          <td class="font-semibold">${Utils.sanitize(g.nombre)}</td>
          <td><span class="badge badge-${g.turno === 'MATUTINO' ? 'matutino' : 'vespertino'}">${Utils.sanitize(g.turno)}</span></td>
          <td>${g.total}</td>
          <td class="text-success">${g.present}</td>
          <td class="text-danger">${g.absent}</td>
          <td>
            <div class="flex items-center gap-sm">
              <div class="progress-bar flex-1"><div class="progress-fill ${g.pctClass}" style="width:${g.pct}%"></div></div>
              <span class="font-semibold">${g.pct}%</span>
            </div>
          </td>
        </tr>
      `).join('');

      summaryContainer.innerHTML = `
        <div class="table-container mt-lg">
          <table class="table-light">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Turno</th>
                <th>Registros</th>
                <th>Presentes</th>
                <th>Faltas</th>
                <th>% Asistencia</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (error) {
      console.error('Error generating summary:', error);
      summaryContainer.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>Error al generar resumen</p></div>`;
    }
  }

  // ─── EVENTS ───
  function bindEvents(container) {
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;

      if (action === 'load-attendance') {
        await loadAttendance();
      } else if (action === 'save-attendance') {
        await saveAttendance();
      } else if (action === 'set-status') {
        const studentId = btn.dataset.studentId;
        const status = btn.dataset.status;
        if (!attendanceRecords[studentId]) {
          attendanceRecords[studentId] = { status, _new: true };
        } else {
          attendanceRecords[studentId].status = status;
          attendanceRecords[studentId]._changed = true;
        }
        renderAttendanceList();
      } else if (action === 'mark-all-present') {
        students.forEach(s => {
          if (!attendanceRecords[s.id]) {
            attendanceRecords[s.id] = { status: 'present', _new: true };
          } else {
            attendanceRecords[s.id].status = 'present';
            attendanceRecords[s.id]._changed = true;
          }
        });
        renderAttendanceList();
      } else if (action === 'generate-summary') {
        await generateSummary();
      } else if (action === 'export-attendance') {
        Toast.show('Genera primero el resumen', 'info');
      }
    });
  }

  return { render };
})();

Router.modules['attendance'] = () => AttendanceModule.render();
