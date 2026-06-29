/**
 * MÓDULO: MONITOR DE CAPTURA DE CALIFICACIONES
 * EPO 67 — Sistema Escolar
 *
 * Muestra qué maestros ya capturaron calificaciones en el parcial abierto
 * y quiénes faltan. Incluye tabla de datos para habilitar usuarios.
 */

const CapturaProgressModule = (function () {
  const CONTAINER = '#moduleContainer';

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;
    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando progreso de captura...')}</div>`;

    try {
      const [assignments, teachers, groups, subjects, partials, students] = await Promise.all([
        Store.getAssignments(),
        Store.getTeachers(),
        Store.getGroups(),
        Store.getSubjects(),
        Store.getPartials()  ,
        Store.getStudents()
      ]);

      // Find the current open partial
      const openPartial = K.PARCIALES.find(kp => {
        const doc = partials.find(p => p.id === kp.id);
        return !doc || !doc.locked;
      });
      const currentPartialId = openPartial ? openPartial.id : K.PARCIALES[0].id;

      // Load all grades in a single query (cached 5 min — sin force=true).
      // Antes hacíamos getAllGrades(true) que IGNORABA el cache y siempre
      // re-consultaba Firestore (~10s en cada apertura). Ahora respetamos
      // el TTL de 5min; cuando admin necesite refresh tira el cache aparte.
      const allGrades = await Store.getAllGrades();
      const partialGrades = allGrades.filter(g => g.partial === currentPartialId);

      // Build lookup maps
      const teacherMap = {};
      teachers.forEach(t => { teacherMap[t.id] = t; });
      const groupMap = {};
      groups.forEach(g => { groupMap[g.id] = g; });
      const subjectMap = {};
      subjects.forEach(s => { subjectMap[s.id] = s; });

      // PRE-INDEX para evitar N² (218 assignments × 800 students × 5000 grades).
      // Antes: students.filter() + partialGrades.filter() por cada assignment
      //   = ~5.8M comparaciones, ~3s bloqueando UI.
      // Ahora: 1 pasada de indexado + lookup O(1) por assignment.
      const studentsByGroupId = new Map();
      for (const s of students) {
        if (s.estatus !== 'ACTIVO' || s.bajaPendiente) continue;
        const gid = s.groupId;
        if (!gid) continue;
        if (!studentsByGroupId.has(gid)) studentsByGroupId.set(gid, []);
        studentsByGroupId.get(gid).push(s);
      }
      const gradeCountByAssignment = new Map();
      for (const g of partialGrades) {
        const key = g.groupId + '|' + g.subjectId;
        gradeCountByAssignment.set(key, (gradeCountByAssignment.get(key) || 0) + 1);
      }

      // For each assignment, check if grades exist
      const progress = assignments.map(asg => {
        const group = groupMap[asg.groupId];
        const teacher = teacherMap[asg.teacherId];
        const subject = subjectMap[asg.subjectId];

        // O(1) lookups en lugar de filter()
        const groupStudents = studentsByGroupId.get(asg.groupId) || [];
        const totalStudents = groupStudents.length;
        const gradedCount = gradeCountByAssignment.get(asg.groupId + '|' + asg.subjectId) || 0;
        const pct = totalStudents > 0 ? Math.round((gradedCount / totalStudents) * 100) : 0;

        return {
          assignmentId: asg.id,
          teacherId: asg.teacherId,
          teacherName: asg.teacherName || teacher?.nombre || 'Sin docente',
          teacherEmail: teacher?.email || '',
          groupId: asg.groupId,
          groupName: asg.groupName || group?.nombre || asg.groupId,
          turno: group?.turno || asg.turno || '',
          grado: group?.grado || asg.grado || '',
          subjectId: asg.subjectId,
          subjectName: K.getUACNombre(asg.subjectName || subject?.nombre || asg.subjectId),
          totalStudents,
          gradedCount,
          pct,
          status: pct >= 100 ? 'completo' : pct > 0 ? 'parcial' : 'pendiente'
        };
      });

      // Sort: pendientes first, then by turno, grado, group, SEP de materia
      const _sepIdx = (name, grado) => {
        const order = (K.SUBJECT_ORDER && K.SUBJECT_ORDER[Number(grado)]) || [];
        const i = order.findIndex(n => K.normalizeSubjectName ? K.normalizeSubjectName(n) === K.normalizeSubjectName(name) : n === name);
        return i === -1 ? 9999 : i;
      };
      progress.sort((a, b) => {
        const statusOrder = { pendiente: 0, parcial: 1, completo: 2 };
        const d = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
        if (d !== 0) return d;
        return (a.turno || '').localeCompare(b.turno || '') ||
               ((Number(a.grado) || 0) - (Number(b.grado) || 0)) ||
               (a.groupName || '').localeCompare(b.groupName || '') ||
               (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
               (a.subjectName || '').localeCompare(b.subjectName || '');
      });

      // Stats
      const total = progress.length;
      const completos = progress.filter(p => p.status === 'completo').length;
      const parciales = progress.filter(p => p.status === 'parcial').length;
      const pendientes = progress.filter(p => p.status === 'pendiente').length;
      const pctGeneral = total > 0 ? Math.round((completos / total) * 100) : 0;

      // Teachers summary
      const teacherSummary = {};
      progress.forEach(p => {
        if (!teacherSummary[p.teacherId]) {
          teacherSummary[p.teacherId] = {
            name: p.teacherName,
            email: p.teacherEmail,
            turno: p.turno,
            total: 0, completos: 0, pendientes: 0,
            pendingAssignments: []
          };
        }
        teacherSummary[p.teacherId].total++;
        if (p.status === 'completo') teacherSummary[p.teacherId].completos++;
        else {
          teacherSummary[p.teacherId].pendientes++;
          teacherSummary[p.teacherId].pendingAssignments.push(p);
        }
      });

      const teacherList = Object.values(teacherSummary).sort((a, b) => b.pendientes - a.pendientes);

      // Partial selector
      const parcialOptions = K.PARCIALES.map(p => {
        const doc = partials.find(pp => pp.id === p.id);
        const locked = doc?.locked ? ' (Cerrado)' : ' (Abierto)';
        const sel = p.id === currentPartialId ? 'selected' : '';
        return `<option value="${p.id}" ${sel}>${p.nombre}${locked}</option>`;
      }).join('');

      // Turno filter
      const turnos = [...new Set(progress.map(p => p.turno))].sort();

      container.innerHTML = `
        <div class="module-container">
          ${UI.pageHeader('Monitor de Captura', `Progreso de captura de calificaciones — ${openPartial?.nombre || 'Parcial'}`)}

          <div class="stats-grid" style="margin-bottom:16px;">
            <div class="stat-card--compact"><div class="stat-number">${pctGeneral}%</div><div class="stat-label">Avance general</div></div>
            <div class="stat-card--compact stat-card--success"><div class="stat-number">${completos}</div><div class="stat-label">Completos</div></div>
            <div class="stat-card--compact stat-card--warning"><div class="stat-number">${parciales}</div><div class="stat-label">Parciales</div></div>
            <div class="stat-card--compact stat-card--danger"><div class="stat-number">${pendientes}</div><div class="stat-label">Pendientes</div></div>
          </div>

          <!-- ═══ BARRA DE AVANCE GENERAL ═══ -->
          <div class="card" style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-weight:600;font-size:0.9rem;">Avance de captura</span>
              <span style="font-weight:700;color:${pctGeneral >= 80 ? '#38a169' : pctGeneral >= 50 ? '#d69e2e' : '#e53e3e'};">${completos}/${total} asignaciones completas</span>
            </div>
            <div class="progress-bar" style="height:20px;border-radius:10px;">
              <div class="progress-fill" style="width:${pctGeneral}%;background:${pctGeneral >= 80 ? '#38a169' : pctGeneral >= 50 ? '#d69e2e' : '#e53e3e'};border-radius:10px;transition:width 0.5s;"></div>
            </div>
          </div>

          <!-- ═══ FILTROS ═══ -->
          <div class="card" style="margin-bottom:16px;">
            <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
              <div class="form-group">
                <label>Turno</label>
                <select id="cp-turno">
                  <option value="">Todos</option>
                  ${turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Estado</label>
                <select id="cp-status">
                  <option value="">Todos</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="parcial">Parcial</option>
                  <option value="completo">Completo</option>
                </select>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-outline btn-sm" id="cp-print-pending">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">print</span> Imprimir pendientes
              </button>
              <button class="btn btn-outline btn-sm" id="cp-print-teacher-form">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">assignment_ind</span> Formato datos de docentes
              </button>
            </div>
          </div>

          <!-- ═══ TABS: POR ASIGNACIÓN / POR DOCENTE ═══ -->
          <div class="card" style="padding:0;">
            <div style="display:flex;border-bottom:2px solid #e2e8f0;">
              <button class="cp-tab active" data-tab="assignments" style="flex:1;padding:12px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid #3182ce;color:#3182ce;">Por Asignación</button>
              <button class="cp-tab" data-tab="teachers" style="flex:1;padding:12px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:3px solid transparent;color:#718096;">Por Docente</button>
            </div>

            <div id="cp-tab-assignments" style="overflow-x:auto;">
              <table class="data-table" id="cp-table" style="font-size:13px;">
                <thead>
                  <tr>
                    <th style="width:30px;">#</th>
                    <th>Docente</th>
                    <th>Grupo</th>
                    <th>Materia</th>
                    <th style="width:60px;text-align:center;">Alumnos</th>
                    <th style="width:80px;text-align:center;">Capturados</th>
                    <th style="width:100px;">Avance</th>
                    <th style="width:70px;text-align:center;">Estado</th>
                  </tr>
                </thead>
                <tbody id="cp-tbody"></tbody>
              </table>
            </div>

            <div id="cp-tab-teachers" style="display:none;overflow-x:auto;">
              <table class="data-table" style="font-size:13px;">
                <thead>
                  <tr>
                    <th style="width:30px;">#</th>
                    <th>Docente</th>
                    <th>Turno</th>
                    <th style="text-align:center;">Asignaciones</th>
                    <th style="text-align:center;">Completas</th>
                    <th style="text-align:center;">Pendientes</th>
                    <th style="width:100px;">Avance</th>
                    <th style="width:70px;text-align:center;">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${teacherList.map((t, i) => {
                    const tPct = t.total > 0 ? Math.round((t.completos / t.total) * 100) : 0;
                    const statusClass = tPct >= 100 ? 'cp-status-completo' : tPct > 0 ? 'cp-status-parcial' : 'cp-status-pendiente';
                    const statusLabel = tPct >= 100 ? 'Listo' : tPct > 0 ? `${tPct}%` : 'Pendiente';
                    const pendingLinks = t.pendingAssignments.map(p =>
                      `<span class="link-button" data-action="open-capture" data-assignment-id="${p.assignmentId}" data-group-id="${p.groupId}" data-subject-id="${p.subjectId}" style="font-size:11px;margin:2px 4px 2px 0;display:inline-block;cursor:pointer;color:var(--color-primary);text-decoration:underline;">${Utils.sanitize(p.groupName)} - ${Utils.sanitize(p.subjectName)}</span>`
                    ).join('');
                    return `<tr>
                      <td>${i + 1}</td>
                      <td class="font-semibold">${Utils.sanitize(t.name)}${pendingLinks ? '<div style="margin-top:4px;">' + pendingLinks + '</div>' : ''}</td>
                      <td>${Utils.sanitize(t.turno)}</td>
                      <td style="text-align:center;">${t.total}</td>
                      <td style="text-align:center;color:#38a169;font-weight:600;">${t.completos}</td>
                      <td style="text-align:center;color:${t.pendientes > 0 ? '#e53e3e' : '#38a169'};font-weight:600;">${t.pendientes}</td>
                      <td>
                        <div class="progress-bar" style="height:14px;border-radius:7px;">
                          <div class="progress-fill" style="width:${tPct}%;background:${tPct >= 100 ? '#38a169' : tPct > 0 ? '#d69e2e' : '#e2e8f0'};border-radius:7px;"></div>
                        </div>
                      </td>
                      <td style="text-align:center;"><span class="badge ${statusClass}">${statusLabel}</span></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;

      // Render assignments table
      _renderAssignmentsTable(progress);

      // ═══ EVENT BINDINGS ═══
      // Tab switching
      container.querySelectorAll('.cp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.cp-tab').forEach(t => {
            t.classList.remove('active');
            t.style.borderBottomColor = 'transparent';
            t.style.color = '#718096';
          });
          tab.classList.add('active');
          tab.style.borderBottomColor = '#3182ce';
          tab.style.color = '#3182ce';
          document.getElementById('cp-tab-assignments').style.display = tab.dataset.tab === 'assignments' ? '' : 'none';
          document.getElementById('cp-tab-teachers').style.display = tab.dataset.tab === 'teachers' ? '' : 'none';
        });
      });

      // Filters — default to showing only incomplete
      const statusEl = document.getElementById('cp-status');
      if (statusEl && pendientes + parciales > 0) {
        // Don't pre-filter, but hint user
      }
      document.getElementById('cp-turno')?.addEventListener('change', () => _filterTable(progress));
      statusEl?.addEventListener('change', () => _filterTable(progress));

      // Print pending
      document.getElementById('cp-print-pending')?.addEventListener('click', () => _printPending(progress));

      // Print teacher form
      document.getElementById('cp-print-teacher-form')?.addEventListener('click', () => _printTeacherForm(teachers));

      // Click on row to open grade editor for that assignment
      container.addEventListener('click', (e) => {
        const row = e.target.closest('[data-action="open-capture"]');
        if (!row) return;
        const groupId = row.dataset.groupId;
        const subjectId = row.dataset.subjectId;
        const assignmentId = row.dataset.assignmentId;
        // Navigate to grades module and open editor with highlight-empty flag
        sessionStorage.setItem('epo67_highlightEmpty', '1');
        Router.navigate('my-grades');
        // Wait for module render then open editor
        setTimeout(() => {
          if (typeof GradesModule !== 'undefined' && GradesModule.openGradeEditor) {
            GradesModule.openGradeEditor(assignmentId, groupId, subjectId);
          }
        }, 300);
      });

    } catch (error) {
      console.error('Error loading capture progress:', error);
      container.innerHTML = `<div class="module-container">${UI.errorState('Error al cargar progreso: ' + error.message)}</div>`;
    }
  }

  function _renderAssignmentsTable(data) {
    const tbody = document.getElementById('cp-tbody');
    if (!tbody) return;

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-light);">No hay asignaciones que mostrar.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((p, i) => {
      const barColor = p.pct >= 100 ? '#38a169' : p.pct > 0 ? '#d69e2e' : '#e2e8f0';
      const statusClass = p.status === 'completo' ? 'cp-status-completo' : p.status === 'parcial' ? 'cp-status-parcial' : 'cp-status-pendiente';
      const statusLabel = p.status === 'completo' ? 'Listo' : p.status === 'parcial' ? `${p.pct}%` : 'Pendiente';
      const clickable = p.status !== 'completo';

      return `<tr ${clickable ? `data-action="open-capture" data-assignment-id="${p.assignmentId}" data-group-id="${p.groupId}" data-subject-id="${p.subjectId}" style="cursor:pointer;" title="Clic para abrir editor"` : ''}>
        <td>${i + 1}</td>
        <td class="font-semibold">${Utils.sanitize(Utils.displayName(p.teacherName))}${clickable ? ' <span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:var(--color-primary);opacity:0.6;">open_in_new</span>' : ''}</td>
        <td>${Utils.sanitize(p.groupName)}</td>
        <td style="font-size:12px;">${Utils.sanitize(p.subjectName)}</td>
        <td style="text-align:center;">${p.totalStudents}</td>
        <td style="text-align:center;font-weight:600;color:${p.gradedCount > 0 ? '#2b6cb0' : '#a0aec0'};">${p.gradedCount}</td>
        <td>
          <div class="progress-bar" style="height:14px;border-radius:7px;">
            <div class="progress-fill" style="width:${p.pct}%;background:${barColor};border-radius:7px;"></div>
          </div>
        </td>
        <td style="text-align:center;"><span class="badge ${statusClass}">${statusLabel}</span></td>
      </tr>`;
    }).join('');
  }

  function _filterTable(allProgress) {
    const turno = document.getElementById('cp-turno')?.value || '';
    const status = document.getElementById('cp-status')?.value || '';

    let filtered = allProgress;
    if (turno) filtered = filtered.filter(p => p.turno === turno);
    if (status) filtered = filtered.filter(p => p.status === status);

    _renderAssignmentsTable(filtered);
  }

  function _printPending(progress) {
    const pending = progress.filter(p => p.status !== 'completo');
    if (pending.length === 0) {
      Toast.show('No hay asignaciones pendientes', 'success');
      return;
    }

    let rows = pending.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${Utils.sanitize(Utils.displayName(p.teacherName))}</td>
        <td>${Utils.sanitize(p.groupName)}</td>
        <td>${Utils.sanitize(p.subjectName)}</td>
        <td style="text-align:center;">${p.gradedCount}/${p.totalStudents}</td>
        <td style="text-align:center;">${p.pct}%</td>
      </tr>
    `).join('');

    const html = `
      <style>
        @page { size: letter portrait; margin: 15mm; }
        body { font-family: Arial, sans-serif; font-size: 11pt; margin: 0; }
        h1 { font-size: 14pt; text-align: center; margin-bottom: 4px; }
        h2 { font-size: 11pt; text-align: center; color: #666; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #2d3748; color: #fff; padding: 6px 8px; font-size: 10pt; text-align: left; }
        td { padding: 5px 8px; border-bottom: 1px solid #ddd; font-size: 10pt; }
        tr:nth-child(even) { background: #f7fafc; }
        .footer { text-align: center; font-size: 9pt; color: #999; margin-top: 20px; }
      </style>
      <h1>ASIGNACIONES PENDIENTES DE CAPTURA</h1>
      <h2>EPO 67 &middot; ${new Date().toLocaleDateString('es-MX')} &middot; ${pending.length} asignaciones pendientes</h2>
      <table>
        <thead><tr><th>#</th><th>Docente</th><th>Grupo</th><th>Materia</th><th>Capturados</th><th>Avance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">Generado por Sistema Escolar EPO 67</div>`;

    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pendientes de Captura</title></head><body>' + html + '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // FORMATO DE DATOS DE DOCENTES (tabla imprimible para recopilar)
  // ═══════════════════════════════════════════════════════════════

  function _printTeacherForm(teachers) {
    // Create a form with existing teachers pre-filled + blank rows
    const sorted = [...teachers].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const totalRows = Math.max(sorted.length + 5, 25); // Extra blank rows

    let rows = '';
    for (let i = 0; i < totalRows; i++) {
      const t = sorted[i];
      rows += `<tr style="height:28px;">
        <td style="text-align:center;">${i + 1}</td>
        <td style="font-weight:${t ? '600' : '400'};">${t ? Utils.sanitize(Utils.displayName(t.nombre || '')) : ''}</td>
        <td>${t ? Utils.sanitize(t.email || '') : ''}</td>
        <td></td>
        <td>${t ? Utils.sanitize(t.turno || '') : ''}</td>
        <td>${t ? Utils.sanitize(t.especialidad || '') : ''}</td>
        <td></td>
      </tr>`;
    }

    const html = `
      <style>
        @page { size: letter landscape; margin: 10mm 12mm; }
        body { font-family: Arial, sans-serif; margin: 0; }
        h1 { font-size: 13pt; text-align: center; margin: 0 0 2px 0; }
        h2 { font-size: 10pt; text-align: center; color: #555; margin: 0 0 8px 0; font-weight: 400; }
        .note { font-size: 9pt; color: #888; text-align: center; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #2d3748; color: #fff; padding: 5px 6px; font-size: 9pt; text-align: left; }
        td { padding: 3px 6px; border: 1px solid #ccc; font-size: 9pt; }
        tr:nth-child(even) { background: #f9f9f9; }
        .footer { text-align: center; font-size: 9pt; color: #aaa; margin-top: 8px; }
      </style>
      <h1>REGISTRO DE DATOS DE DOCENTES — EPO 67</h1>
      <h2>Formato para recopilar datos y habilitar cuentas de usuario en el sistema</h2>
      <div class="note">Instrucciones: Llenar con letra clara. El correo electrónico se usará como usuario de acceso al sistema. La contraseña deseada debe tener al menos 6 caracteres.</div>
      <table>
        <thead>
          <tr>
            <th style="width:25px;">#</th>
            <th style="width:22%;">Nombre Completo</th>
            <th style="width:20%;">Correo Electrónico</th>
            <th style="width:15%;">Contraseña deseada (mín. 6 caract.)</th>
            <th style="width:10%;">Turno</th>
            <th style="width:15%;">Especialidad / Perfil</th>
            <th style="width:13%;">Teléfono</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">
        <strong>IMPORTANTE:</strong> Este documento contiene información sensible. Manejar con discreción. &middot; Fecha: ${new Date().toLocaleDateString('es-MX')}
      </div>`;

    const w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Registro Docentes EPO 67</title></head><body>' + html + '<script>setTimeout(()=>window.print(),400)<\/script></body></html>');
    w.document.close();
  }

  return { render };
})();

Router.modules['captura-progress'] = () => CapturaProgressModule.render();
