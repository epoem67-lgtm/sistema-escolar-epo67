// ═══════════════════════════════════════════════════════════════
// STUDENT PROFILE — Consulta individual de situación académica
// e incidencias por alumno. Filtros: Turno → Grupo → Alumno
// ═══════════════════════════════════════════════════════════════

const StudentProfileModule = (() => {
  let _students = [];
  let _groups = [];
  let _subjects = [];
  let _assignments = [];
  let _selectedStudent = null;
  let _studentGrades = [];
  let _incidents = [];
  let _filters = { turno: '', grupo: '', alumno: '' };

  function _el(id) { return document.getElementById(id); }
  function _container() { return document.getElementById('moduleContainer'); }

  // ─── MAIN RENDER ───────────────────────────────────────────
  async function render() {
    const role = App.currentUser?.role;
    if (!role) {
      _container().innerHTML = UI.moduleContainer(UI.emptyState('block', 'Acceso denegado'));
      return;
    }

    _container().innerHTML = UI.moduleContainer(
      UI.pageHeader('Consulta por Alumno', 'Situación académica e incidencias') +
      _buildFilters() +
      '<div id="sp-content"></div>'
    );

    // Load base data
    try {
      [_students, _groups, _subjects, _assignments] = await Promise.all([
        Store.getStudents(), Store.getGroups(), Store.getSubjects(), Store.getAssignments()
      ]);

      // Orientador: filter to their groups only
      const oriGroups = await Store.getOrientadorGroups();
      if (oriGroups) {
        const oriSet = new Set(oriGroups);
        _groups = _groups.filter(g => oriSet.has(g.id));
        _students = _students.filter(s => oriSet.has(s.groupId));
      }

      // Maestro: filter to groups they're assigned to
      if (role === 'maestro') {
        const teacherDocId = await Store.getTeacherDocId();
        if (teacherDocId) {
          const teacherAssignments = _assignments.filter(a => a.teacherId === teacherDocId);
          const teacherGroupIds = new Set(teacherAssignments.map(a => a.groupId));
          _groups = _groups.filter(g => teacherGroupIds.has(g.id));
          _students = _students.filter(s => teacherGroupIds.has(s.groupId));
        }
      }
    } catch (err) {
      console.error('StudentProfile load error:', err);
      _el('sp-content').innerHTML = UI.errorState('Error cargando datos');
      return;
    }

    _bindFilterEvents();
    _el('sp-content').innerHTML = UI.emptyState('person_search', 'Selecciona turno, grupo y alumno para consultar');
  }

  // ─── FILTERS ───────────────────────────────────────────────
  function _buildFilters() {
    return `
    <div class="card filter-bar" style="margin-bottom:16px;">
      <div class="filter-group">
        <label>Turno</label>
        <select id="sp-turno">
          <option value="">Seleccionar...</option>
          ${K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="filter-group">
        <label>Grupo</label>
        <select id="sp-grupo" disabled><option value="">Seleccionar turno...</option></select>
      </div>
      <div class="filter-group" style="flex:2;">
        <label>Alumno</label>
        <select id="sp-alumno" disabled><option value="">Seleccionar grupo...</option></select>
      </div>
    </div>`;
  }

  function _bindFilterEvents() {
    _el('sp-turno').addEventListener('change', function () {
      _filters.turno = this.value;
      _filters.grupo = '';
      _filters.alumno = '';
      _selectedStudent = null;
      _updateGrupoSelect();
      _el('sp-alumno').innerHTML = '<option value="">Seleccionar grupo...</option>';
      _el('sp-alumno').disabled = true;
      _el('sp-content').innerHTML = UI.emptyState('person_search', 'Selecciona grupo y alumno');
    });

    _el('sp-grupo').addEventListener('change', function () {
      _filters.grupo = this.value;
      _filters.alumno = '';
      _selectedStudent = null;
      _updateAlumnoSelect();
      _el('sp-content').innerHTML = UI.emptyState('person_search', 'Selecciona un alumno');
    });

    _el('sp-alumno').addEventListener('change', function () {
      _filters.alumno = this.value;
      if (this.value) {
        _selectedStudent = _students.find(s => s.id === this.value);
        _loadStudentProfile();
      } else {
        _selectedStudent = null;
        _el('sp-content').innerHTML = UI.emptyState('person_search', 'Selecciona un alumno');
      }
    });
  }

  function _updateGrupoSelect() {
    const sel = _el('sp-grupo');
    if (!_filters.turno) {
      sel.innerHTML = '<option value="">Seleccionar turno...</option>';
      sel.disabled = true;
      return;
    }
    const filtered = _groups
      .filter(g => g.turno === _filters.turno)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    sel.innerHTML = '<option value="">Seleccionar...</option>' +
      filtered.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
    sel.disabled = false;
  }

  function _updateAlumnoSelect() {
    const sel = _el('sp-alumno');
    if (!_filters.grupo) {
      sel.innerHTML = '<option value="">Seleccionar grupo...</option>';
      sel.disabled = true;
      return;
    }
    const filtered = _students
      .filter(s => s.groupId === _filters.grupo && s.estatus !== 'BAJA')
      .sort((a, b) => {
        const c = (a.apellido1 || '').localeCompare(b.apellido1 || '');
        if (c) return c;
        const c2 = (a.apellido2 || '').localeCompare(b.apellido2 || '');
        if (c2) return c2;
        return (a.nombres || '').localeCompare(b.nombres || '');
      });
    sel.innerHTML = '<option value="">Seleccionar...</option>' +
      filtered.map(s => {
        const name = `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
        return `<option value="${s.id}">${Utils.sanitize(name)}</option>`;
      }).join('');
    sel.disabled = false;
  }

  // ─── LOAD STUDENT PROFILE ─────────────────────────────────
  async function _loadStudentProfile() {
    const content = _el('sp-content');
    content.innerHTML = UI.loadingState('Cargando perfil del alumno...');

    try {
      // Load grades for this student's group + incidents
      const [gradesByGroup, incidentsSnap] = await Promise.all([
        Store.getGradesByGroup(_filters.grupo, true),
        db.collection('incidents').where('studentId', '==', _selectedStudent.id).orderBy('date', 'desc').get()
          .catch(() => ({ docs: [] }))
      ]);

      _studentGrades = gradesByGroup.filter(g => g.studentId === _selectedStudent.id);
      _incidents = incidentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      content.innerHTML = _renderProfile();
      _bindProfileEvents(content);
    } catch (err) {
      console.error('Profile load error:', err);
      content.innerHTML = UI.errorState('Error cargando perfil: ' + err.message);
    }
  }

  // ─── RENDER PROFILE ───────────────────────────────────────
  function _renderProfile() {
    const s = _selectedStudent;
    const grupo = _groups.find(g => g.id === _filters.grupo);
    const turno = _filters.turno;

    // Build grade matrix: subject → { P1: {...}, P2: {...}, P3: {...} }
    const gradeMatrix = {};
    const subjectIds = new Set();
    _studentGrades.forEach(g => {
      if (!gradeMatrix[g.subjectId]) gradeMatrix[g.subjectId] = {};
      gradeMatrix[g.subjectId][g.partial] = g;
      subjectIds.add(g.subjectId);
    });

    // Also include subjects from assignments for this group
    _assignments.filter(a => a.groupId === _filters.grupo).forEach(a => subjectIds.add(a.subjectId));

    // Calculate stats
    let totalCal = 0, countCal = 0, reprobadas = 0, totalFaltas = 0;
    const subjectArray = [...subjectIds].map(sid => {
      const sub = _subjects.find(x => x.id === sid);
      const name = sub ? K.getUACNombre(sub.nombre || sid) : sid;
      return { id: sid, name };
    }).sort((a, b) => a.name.localeCompare(b.name));

    subjectArray.forEach(sub => {
      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id];
        if (g && g.cal !== undefined && g.cal !== null && g.cal !== '') {
          const cal = parseFloat(g.cal);
          if (!isNaN(cal)) {
            totalCal += cal;
            countCal++;
            if (cal < 6) reprobadas++;
          }
        }
        if (g && g.faltas !== undefined && g.faltas !== null) {
          totalFaltas += parseInt(g.faltas) || 0;
        }
      });
    });

    const promedio = countCal > 0 ? (totalCal / countCal).toFixed(2) : '-';
    const riskLevel = reprobadas >= 5 ? 'ALTO' : reprobadas >= 3 ? 'MEDIO' : reprobadas > 0 ? 'BAJO' : 'SIN RIESGO';
    const riskColor = reprobadas >= 5 ? '#dc2626' : reprobadas >= 3 ? '#f59e0b' : reprobadas > 0 ? '#3b82f6' : '#16a34a';
    const riskIcon = reprobadas >= 5 ? 'error' : reprobadas >= 3 ? 'warning' : reprobadas > 0 ? 'info' : 'check_circle';
    const riskBadgeColor = reprobadas >= 5 ? 'danger' : reprobadas >= 3 ? 'warning' : reprobadas > 0 ? 'inactive' : 'success';

    const fullName = `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();

    return `
    <!-- TARJETA INFO ALUMNO -->
    <div class="card" style="margin-bottom:16px; padding:20px;">
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <div style="width:60px; height:60px; border-radius:50%; background:var(--primary); color:#fff;
                    display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:bold; flex-shrink:0;">
          ${(s.nombres || 'A')[0]}${(s.apellido1 || '')[0] || ''}
        </div>
        <div style="flex:1; min-width:200px;">
          <h2 style="margin:0; font-size:1.25rem; color:var(--text);">${Utils.sanitize(fullName)}</h2>
          <div style="color:var(--text-light); font-size:0.875rem; margin-top:4px;">
            ${Utils.sanitize(turno)} · ${Utils.sanitize(grupo?.nombre || '')} · Grado ${s.grado || ''}°
            ${s.curp ? ' · CURP: ' + Utils.sanitize(s.curp) : ''}
          </div>
          <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
            ${UI.badge(s.estatus || 'ACTIVO', s.estatus === 'ACTIVO' ? 'success' : 'danger')}
            <span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:20px;
                         background:${riskColor}15; color:${riskColor}; font-weight:600; font-size:0.8rem; border:1px solid ${riskColor}40;">
              <span class="material-icons-round" style="font-size:16px;">${riskIcon}</span>
              ${riskLevel}
            </span>
          </div>
        </div>
        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <div class="stat-mini">
            <div class="stat-mini-val" style="color:${promedio !== '-' && parseFloat(promedio) < 6 ? 'var(--danger)' : 'var(--primary)'}">${promedio}</div>
            <div class="stat-mini-lbl">Promedio</div>
          </div>
          <div class="stat-mini">
            <div class="stat-mini-val" style="color:${reprobadas > 0 ? 'var(--danger)' : 'var(--success)'}">${reprobadas}</div>
            <div class="stat-mini-lbl">Reprobadas</div>
          </div>
          <div class="stat-mini">
            <div class="stat-mini-val">${totalFaltas}</div>
            <div class="stat-mini-lbl">Faltas</div>
          </div>
          <div class="stat-mini">
            <div class="stat-mini-val">${countCal}</div>
            <div class="stat-mini-lbl">Evaluaciones</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TABS -->
    <div class="card" style="margin-bottom:16px;">
      <div class="sp-tabs" style="display:flex; border-bottom:2px solid var(--border);">
        <button class="sp-tab active" data-tab="academico" style="flex:1; padding:10px; border:none; background:none;
                cursor:pointer; font-weight:600; color:var(--primary); border-bottom:2px solid var(--primary); margin-bottom:-2px;">
          <span class="material-symbols-outlined" style="font-size:18px; vertical-align:middle;">school</span>
          Situación Académica
        </button>
        <button class="sp-tab" data-tab="incidencias" style="flex:1; padding:10px; border:none; background:none;
                cursor:pointer; font-weight:500; color:var(--text-light);">
          <span class="material-symbols-outlined" style="font-size:18px; vertical-align:middle;">report</span>
          Incidencias (${_incidents.length})
        </button>
      </div>
    </div>

    <!-- TAB CONTENT -->
    <div id="sp-tab-academico">${_renderAcademicTab(subjectArray, gradeMatrix, turno)}</div>
    <div id="sp-tab-incidencias" style="display:none;">${_renderIncidentsTab()}</div>
    `;
  }

  // ─── ACADEMIC TAB ─────────────────────────────────────────
  function _renderAcademicTab(subjectArray, gradeMatrix, turno) {
    if (subjectArray.length === 0) {
      return `<div class="card" style="padding:20px;">${UI.emptyState('school', 'No hay materias registradas para este grupo')}</div>`;
    }

    const rubros = K.getRubros(turno);

    let html = `<div class="card" style="padding:0; overflow-x:auto;">
    <table class="data-table" style="width:100%; font-size:0.85rem;">
      <thead>
        <tr>
          <th style="min-width:180px; text-align:left; padding:10px 12px;">Materia</th>`;

    K.PARCIALES.forEach(p => {
      rubros.forEach(r => {
        html += `<th style="text-align:center; padding:6px 4px; font-size:0.75rem;" title="${r.label}">${r.abbr}</th>`;
      });
      html += `<th style="text-align:center; padding:6px 4px; font-size:0.75rem;">Suma</th>`;
      html += `<th style="text-align:center; padding:6px 4px; font-size:0.75rem;">Ftas</th>`;
      html += `<th style="text-align:center; padding:6px 8px; font-weight:700; font-size:0.8rem; background:var(--primary-light); color:var(--primary);">P${p.numero}</th>`;
    });
    html += `<th style="text-align:center; padding:6px 8px; font-weight:700; background:#333; color:#fff;">PROM</th>`;
    html += `</tr></thead><tbody>`;

    subjectArray.forEach(sub => {
      html += `<tr><td style="padding:8px 12px; font-weight:500;">${Utils.sanitize(sub.name)}</td>`;
      let subTotal = 0, subCount = 0;

      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id] || {};
        rubros.forEach(r => {
          const val = g[r.key];
          html += `<td style="text-align:center; padding:4px;">${val !== undefined && val !== null && val !== '' ? val : ''}</td>`;
        });
        const suma = g.suma !== undefined && g.suma !== null ? g.suma : '';
        const faltas = g.faltas !== undefined && g.faltas !== null ? Math.round(g.faltas) : '';
        const cal = g.cal !== undefined && g.cal !== null ? g.cal : (g.value !== undefined ? Math.min(Number(g.value), 10) : '');

        html += `<td style="text-align:center; padding:4px; font-size:0.8rem;">${suma}</td>`;
        html += `<td style="text-align:center; padding:4px; font-size:0.8rem;">${faltas}</td>`;

        const calNum = parseFloat(cal);
        const calStyle = !isNaN(calNum) && calNum < 6
          ? 'color:#fff; background:var(--danger); font-weight:700; border-radius:4px;'
          : 'font-weight:700;';
        html += `<td style="text-align:center; padding:4px 8px; ${calStyle}">${cal}</td>`;

        if (cal !== '' && !isNaN(calNum)) { subTotal += calNum; subCount++; }
      });

      const avg = subCount > 0 ? (subTotal / subCount).toFixed(1) : '-';
      const avgNum = parseFloat(avg);
      const avgStyle = !isNaN(avgNum) && avgNum < 6
        ? 'color:#fff; background:var(--danger); font-weight:700; border-radius:4px;'
        : 'font-weight:700;';
      html += `<td style="text-align:center; padding:4px 8px; ${avgStyle}">${avg}</td>`;
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;

    // Print buttons
    html += `
    <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
      <button class="btn btn-outline" data-action="print-tira">
        <span class="material-icons-round" style="font-size:18px; vertical-align:middle;">receipt_long</span>
        Tira de Materias (Papás)
      </button>
      <button class="btn btn-primary" data-action="print-profile">
        <span class="material-icons-round" style="font-size:18px; vertical-align:middle;">print</span>
        Reporte Completo
      </button>
    </div>`;

    return html;
  }

  // ─── INCIDENTS TAB ────────────────────────────────────────
  function _renderIncidentsTab() {
    let html = `
    <div class="card" style="padding:16px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0; font-size:1rem;">Registro de Incidencias</h3>
        <button class="btn btn-primary btn-sm" data-action="add-incident">
          <span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle;">add</span>
          Nueva Incidencia
        </button>
      </div>
    </div>`;

    if (_incidents.length === 0) {
      html += `<div class="card" style="padding:20px;">${UI.emptyState('check_circle', 'No hay incidencias registradas para este alumno')}</div>`;
    } else {
      html += '<div class="card" style="padding:0;">';
      _incidents.forEach(inc => {
        const typeIcon = inc.type === 'academica' ? 'school' : inc.type === 'asistencia' ? 'event_busy' : 'warning';
        const typeColor = inc.type === 'academica' ? 'primary' : inc.type === 'asistencia' ? 'warning' : 'danger';
        const dateStr = inc.date ? Utils.formatDate(inc.date.toDate ? inc.date.toDate() : new Date(inc.date)) : '';

        html += `
        <div style="display:flex; gap:12px; padding:12px 16px; border-bottom:1px solid var(--border); align-items:flex-start;">
          <span class="material-symbols-outlined" style="color:var(--${typeColor}); font-size:22px; margin-top:2px;">${typeIcon}</span>
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
              <span style="font-weight:600;">${Utils.sanitize(inc.title || 'Incidencia')}</span>
              <div style="display:flex; gap:6px; align-items:center;">
                ${UI.badge(_getIncidentTypeLabel(inc.type), typeColor)}
                <span style="font-size:0.8rem; color:var(--text-light);">${dateStr}</span>
              </div>
            </div>
            <p style="margin:4px 0 0; font-size:0.875rem; color:var(--text-light);">${Utils.sanitize(inc.description || '')}</p>
            ${inc.reportedBy ? `<div style="font-size:0.75rem; color:var(--text-light); margin-top:4px;">Reportó: ${Utils.sanitize(inc.reportedBy)}</div>` : ''}
          </div>
          <button class="btn-icon" data-action="delete-incident" data-id="${inc.id}" title="Eliminar"
                  style="color:var(--danger); background:none; border:none; cursor:pointer; padding:4px;">
            <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
          </button>
        </div>`;
      });
      html += '</div>';
    }

    return html;
  }

  function _getIncidentTypeLabel(type) {
    const labels = { academica: 'Académica', conducta: 'Conducta', asistencia: 'Asistencia', otra: 'Otra' };
    return labels[type] || 'Otra';
  }

  // ─── EVENT BINDING ────────────────────────────────────────
  function _bindProfileEvents(container) {
    // Tabs
    container.addEventListener('click', (e) => {
      const tab = e.target.closest('.sp-tab');
      if (tab) {
        const tabName = tab.dataset.tab;
        container.querySelectorAll('.sp-tab').forEach(t => {
          t.classList.remove('active');
          t.style.color = 'var(--text-light)';
          t.style.borderBottom = 'none';
          t.style.fontWeight = '500';
        });
        tab.classList.add('active');
        tab.style.color = 'var(--primary)';
        tab.style.borderBottom = '2px solid var(--primary)';
        tab.style.fontWeight = '600';

        _el('sp-tab-academico').style.display = tabName === 'academico' ? '' : 'none';
        _el('sp-tab-incidencias').style.display = tabName === 'incidencias' ? '' : 'none';
        return;
      }

      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'add-incident') _showAddIncidentModal();
      else if (action === 'delete-incident') _deleteIncident(btn.dataset.id);
      else if (action === 'print-profile') _printProfile();
      else if (action === 'print-tira') _printTira();
    });
  }

  // ─── ADD INCIDENT ─────────────────────────────────────────
  function _showAddIncidentModal() {
    const body = `
    <div style="display:flex; flex-direction:column; gap:12px;">
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Tipo de incidencia</label>
        <select id="inc-type" class="form-control" style="width:100%; padding:8px; margin-top:4px;">
          <option value="conducta">Conducta</option>
          <option value="academica">Académica</option>
          <option value="asistencia">Asistencia</option>
          <option value="otra">Otra</option>
        </select>
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Título</label>
        <input id="inc-title" class="form-control" placeholder="Breve descripción" style="width:100%; padding:8px; margin-top:4px;">
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Fecha</label>
        <input id="inc-date" type="date" class="form-control" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px; margin-top:4px;">
      </div>
      <div>
        <label style="font-weight:600; font-size:0.875rem;">Descripción detallada</label>
        <textarea id="inc-desc" class="form-control" rows="3" placeholder="Describe la incidencia..."
                  style="width:100%; padding:8px; margin-top:4px; resize:vertical;"></textarea>
      </div>
    </div>`;

    const footer = `
      <button class="btn" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-primary" id="inc-save-btn">Guardar Incidencia</button>
    `;

    Modal.open('Nueva Incidencia', body, footer);

    setTimeout(() => {
      const saveBtn = _el('inc-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const type = _el('inc-type').value;
          const title = _el('inc-title').value.trim();
          const date = _el('inc-date').value;
          const desc = _el('inc-desc').value.trim();

          if (!title) { Toast.show('Escribe un título', 'warning'); return; }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Guardando...';

          try {
            await db.collection('incidents').add({
              studentId: _selectedStudent.id,
              groupId: _filters.grupo,
              turno: _filters.turno,
              type,
              title,
              description: desc,
              date: new Date(date + 'T12:00:00'),
              reportedBy: App.currentUser?.displayName || App.currentUser?.email || '',
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            Modal.close();
            Toast.show('Incidencia registrada', 'success');
            _loadStudentProfile(); // Refresh
          } catch (err) {
            console.error('Save incident error:', err);
            Toast.show('Error al guardar: ' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar Incidencia';
          }
        });
      }
    }, 100);
  }

  // ─── DELETE INCIDENT ──────────────────────────────────────
  function _deleteIncident(incId) {
    Modal.confirmTyped(
      'Eliminar Incidencia',
      '<div class="alert alert-danger">Esta acción eliminará la incidencia permanentemente.</div>',
      'ELIMINAR',
      async () => {
        try {
          await DB.audit('eliminar', 'incidencia', incId, {
            description: 'Incidencia eliminada'
          });
          await db.collection('incidents').doc(incId).delete();
          Toast.show('Incidencia eliminada', 'success');
          _loadStudentProfile();
        } catch (err) {
          Toast.show('Error al eliminar: ' + err.message, 'error');
        }
      }
    );
  }

  // ─── PRINT TIRA DE MATERIAS (formato simple para papás) ──
  function _printTira() {
    if (!_selectedStudent) return;

    const s = _selectedStudent;
    const grupo = _groups.find(g => g.id === _filters.grupo);
    const turno = _filters.turno;
    const fullName = `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
    const orientador = K.getOrientador(turno, grupo?.nombre || '') || '';

    // Build grade matrix
    const gradeMatrix = {};
    const subjectIds = new Set();
    _studentGrades.forEach(g => {
      if (!gradeMatrix[g.subjectId]) gradeMatrix[g.subjectId] = {};
      gradeMatrix[g.subjectId][g.partial] = g;
      subjectIds.add(g.subjectId);
    });
    _assignments.filter(a => a.groupId === _filters.grupo).forEach(a => subjectIds.add(a.subjectId));

    const subjectArray = [...subjectIds].map(sid => {
      const sub = _subjects.find(x => x.id === sid);
      return { id: sid, name: sub ? K.getUACNombre(sub.nombre || sid) : sid };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Stats
    let totalCal = 0, countCal = 0, reprobadas = 0, totalFaltas = 0;
    subjectArray.forEach(sub => {
      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id];
        if (g && g.cal !== undefined && g.cal !== null && g.cal !== '') {
          const cal = parseFloat(g.cal);
          if (!isNaN(cal)) { totalCal += cal; countCal++; if (cal < 6) reprobadas++; }
        }
        if (g && g.faltas) totalFaltas += parseInt(g.faltas) || 0;
      });
    });
    const promedio = countCal > 0 ? (totalCal / countCal).toFixed(2) : '-';
    const riskLevel = reprobadas >= 5 ? 'ALTO' : reprobadas >= 3 ? 'MEDIO' : reprobadas > 0 ? 'BAJO' : 'SIN RIESGO';
    const riskColor = reprobadas >= 5 ? '#dc2626' : reprobadas >= 3 ? '#f59e0b' : reprobadas > 0 ? '#3b82f6' : '#16a34a';

    // Build simple table rows
    let rows = '';
    subjectArray.forEach((sub, idx) => {
      const bg = idx % 2 === 1 ? ' background:#f7f7f7;-webkit-print-color-adjust:exact;print-color-adjust:exact;' : '';
      rows += `<tr style="${bg}">`;
      rows += `<td style="border:0.5pt solid #999; padding:3px 6px; font-size:8pt;">${Utils.sanitize(sub.name)}</td>`;

      let subTotal = 0, subCount = 0;
      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id] || {};
        const cal = g.cal !== undefined && g.cal !== null ? g.cal : '';
        const calNum = parseFloat(cal);
        const isReprobado = !isNaN(calNum) && calNum < 6;
        const style = isReprobado
          ? 'background:#e5e5e5; font-weight:bold; -webkit-print-color-adjust:exact; print-color-adjust:exact;'
          : 'font-weight:600;';
        const faltas = g.faltas !== undefined && g.faltas !== null ? Math.round(g.faltas) : '';
        rows += `<td style="border:0.5pt solid #999; text-align:center; padding:2px 4px; font-size:8.5pt; ${style}">${cal}</td>`;
        rows += `<td style="border:0.5pt solid #999; text-align:center; padding:2px 4px; font-size:7.5pt; color:#555;">${faltas}</td>`;
        if (cal !== '' && !isNaN(calNum)) { subTotal += calNum; subCount++; }
      });

      const avg = subCount > 0 ? (subTotal / subCount).toFixed(1) : '';
      const avgReprobado = parseFloat(avg) < 6;
      const avgStyle = avgReprobado
        ? 'background:#e5e5e5; font-weight:bold; -webkit-print-color-adjust:exact; print-color-adjust:exact;'
        : 'font-weight:bold;';
      rows += `<td style="border:0.5pt solid #999; text-align:center; padding:2px 4px; font-size:9pt; ${avgStyle}">${avg}</td>`;
      rows += `</tr>`;
    });

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const semMap = { '1': 'SEGUNDO SEMESTRE', '2': 'CUARTO SEMESTRE', '3': 'SEXTO SEMESTRE' };
    const semText = semMap[String(s.grado)] || '';

    // Incidents summary
    let incSummary = '';
    if (_incidents.length > 0) {
      incSummary = `<div style="margin-top:4mm; font-size:8pt;">
        <div style="font-weight:bold; border-bottom:0.5pt solid #000; padding-bottom:1mm; margin-bottom:1mm;">OBSERVACIONES E INCIDENCIAS</div>
        <table style="width:100%; border-collapse:collapse;">
          <tr style="background:#333; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
            <th style="border:0.5pt solid #999; padding:2px 4px; width:18mm; font-size:7pt;">Fecha</th>
            <th style="border:0.5pt solid #999; padding:2px 4px; width:15mm; font-size:7pt;">Tipo</th>
            <th style="border:0.5pt solid #999; padding:2px 4px; font-size:7pt;">Descripción</th>
          </tr>`;
      _incidents.slice(0, 10).forEach(inc => {
        const d = inc.date ? (inc.date.toDate ? inc.date.toDate() : new Date(inc.date)) : null;
        const dateStr = d ? d.toLocaleDateString('es-MX') : '';
        incSummary += `<tr>
          <td style="border:0.5pt solid #999; padding:2px 4px; text-align:center; font-size:7pt;">${dateStr}</td>
          <td style="border:0.5pt solid #999; padding:2px 4px; text-align:center; font-size:7pt;">${Utils.sanitize(_getIncidentTypeLabel(inc.type))}</td>
          <td style="border:0.5pt solid #999; padding:2px 4px; font-size:7pt;">${Utils.sanitize(inc.title || '')}</td>
        </tr>`;
      });
      incSummary += '</table></div>';
    }

    const printHTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Tira de Materias - ${Utils.sanitize(fullName)}</title>
    <style>
      @page { size: letter portrait; margin: 10mm 12mm; }
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:Arial,Helvetica,sans-serif; color:#000; }
      th, td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    </style></head><body>

    <div style="display:flex; align-items:center; gap:8px; margin-bottom:3mm;">
      ${logoHeader ? '<img src="' + logoHeader + '" style="height:9mm;">' : ''}
      <div style="flex:1; text-align:center;">
        <div style="font-size:9pt; font-weight:bold; line-height:1.3;">ESCUELA PREPARATORIA OFICIAL NÚM. 67</div>
        <div style="font-size:7pt; color:#333;">C.C.T. 15EBH0134D · 15EBH0168U</div>
      </div>
    </div>

    <div style="text-align:center; font-size:11pt; font-weight:bold; margin:2mm 0; border-bottom:1pt solid #000; padding-bottom:2mm;">
      TIRA DE MATERIAS
    </div>
    <div style="text-align:center; font-size:8pt; color:#333; margin-bottom:3mm;">${semText} · CICLO ESCOLAR 2025-2026</div>

    <table style="width:100%; border-collapse:collapse; font-size:8pt; margin-bottom:3mm;">
      <tr>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:15%;"><b>Alumno:</b></td>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:45%; font-weight:bold; font-size:9pt;">${Utils.sanitize(fullName)}</td>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:10%;"><b>Grado:</b></td>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:5%; font-weight:bold;">${s.grado || ''}°</td>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:10%;"><b>Grupo:</b></td>
        <td style="border:0.5pt solid #999; padding:3px 6px; width:15%; font-weight:bold;">${Utils.sanitize(grupo?.nombre || '')}</td>
      </tr>
      <tr>
        <td style="border:0.5pt solid #999; padding:3px 6px;"><b>Turno:</b></td>
        <td style="border:0.5pt solid #999; padding:3px 6px;">${Utils.sanitize(turno)}</td>
        <td style="border:0.5pt solid #999; padding:3px 6px;"><b>Orientador:</b></td>
        <td style="border:0.5pt solid #999; padding:3px 6px;" colspan="3">${Utils.sanitize(orientador)}</td>
      </tr>
    </table>

    <!-- SEMÁFORO -->
    <div style="display:flex; gap:4mm; margin-bottom:3mm; align-items:center; justify-content:center;">
      <div style="border:1pt solid #999; border-radius:3mm; padding:2mm 5mm; text-align:center; min-width:22mm;">
        <div style="font-size:14pt; font-weight:bold; color:${parseFloat(promedio) < 6 ? '#c00' : '#000'};">${promedio}</div>
        <div style="font-size:6.5pt; color:#555;">Promedio</div>
      </div>
      <div style="border:1pt solid #999; border-radius:3mm; padding:2mm 5mm; text-align:center; min-width:22mm;">
        <div style="font-size:14pt; font-weight:bold; color:${reprobadas > 0 ? '#c00' : '#090'};">${reprobadas}</div>
        <div style="font-size:6.5pt; color:#555;">Reprobadas</div>
      </div>
      <div style="border:1pt solid #999; border-radius:3mm; padding:2mm 5mm; text-align:center; min-width:22mm;">
        <div style="font-size:14pt; font-weight:bold;">${totalFaltas}</div>
        <div style="font-size:6.5pt; color:#555;">Faltas Total</div>
      </div>
      <div style="border:1pt solid ${riskColor}; border-radius:3mm; padding:2mm 5mm; text-align:center; min-width:28mm; background:${riskColor}10;">
        <div style="font-size:10pt; font-weight:bold; color:${riskColor};">${riskLevel}</div>
        <div style="font-size:6.5pt; color:#555;">Nivel de Riesgo</div>
      </div>
    </div>

    <!-- TABLA DE CALIFICACIONES SIMPLIFICADA -->
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="background:#000; color:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
          <th style="border:0.5pt solid #999; padding:3px 6px; text-align:left; font-size:7.5pt;">MATERIA</th>
          ${K.PARCIALES.map(p => `
            <th style="border:0.5pt solid #999; text-align:center; padding:2px; font-size:7pt; width:8%;">P${p.numero}</th>
            <th style="border:0.5pt solid #999; text-align:center; padding:2px; font-size:6pt; width:5%;">Ftas</th>
          `).join('')}
          <th style="border:0.5pt solid #999; text-align:center; padding:2px; font-size:7.5pt; width:8%; font-weight:bold;">PROM</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${incSummary}

    <div style="margin-top:8mm;">
      <table style="width:100%; border-collapse:collapse;">
        <tr>
          <td style="width:40%; text-align:center; padding-top:12mm; border-top:0.5pt solid #000;">
            <div style="font-size:8pt; font-weight:bold;">ORIENTADOR(A)</div>
            <div style="font-size:7pt;">${Utils.sanitize(orientador)}</div>
          </td>
          <td style="width:20%;"></td>
          <td style="width:40%; text-align:center; padding-top:12mm; border-top:0.5pt solid #000;">
            <div style="font-size:8pt; font-weight:bold;">PADRE/MADRE O TUTOR</div>
            <div style="font-size:7pt;">Nombre y firma</div>
          </td>
        </tr>
      </table>
    </div>

    <div style="text-align:center; margin-top:5mm; font-size:6pt; color:#999;">
      Escuela Preparatoria Oficial Núm. 67 · Av. de los Astros 7, Cuautitlán Izcalli, C.P. 54770
    </div>

    <script>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(printHTML);
    w.document.close();
  }

  // ─── PRINT PROFILE ───────────────────────────────────────
  function _printProfile() {
    if (!_selectedStudent) return;

    const s = _selectedStudent;
    const grupo = _groups.find(g => g.id === _filters.grupo);
    const turno = _filters.turno;
    const fullName = `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim();
    const rubros = K.getRubros(turno);

    // Build grade matrix
    const gradeMatrix = {};
    const subjectIds = new Set();
    _studentGrades.forEach(g => {
      if (!gradeMatrix[g.subjectId]) gradeMatrix[g.subjectId] = {};
      gradeMatrix[g.subjectId][g.partial] = g;
      subjectIds.add(g.subjectId);
    });
    _assignments.filter(a => a.groupId === _filters.grupo).forEach(a => subjectIds.add(a.subjectId));

    const subjectArray = [...subjectIds].map(sid => {
      const sub = _subjects.find(x => x.id === sid);
      return { id: sid, name: sub ? K.getUACNombre(sub.nombre || sid) : sid };
    }).sort((a, b) => a.name.localeCompare(b.name));

    // Stats
    let totalCal = 0, countCal = 0, reprobadas = 0, totalFaltas = 0;
    subjectArray.forEach(sub => {
      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id];
        if (g && g.cal !== undefined && g.cal !== null && g.cal !== '') {
          const cal = parseFloat(g.cal);
          if (!isNaN(cal)) { totalCal += cal; countCal++; if (cal < 6) reprobadas++; }
        }
        if (g && g.faltas) totalFaltas += parseInt(g.faltas) || 0;
      });
    });
    const promedio = countCal > 0 ? (totalCal / countCal).toFixed(2) : '-';

    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';

    // Build table rows
    let rows = '';
    subjectArray.forEach((sub, idx) => {
      const bg = idx % 2 === 1 ? ' background:#f5f5f5;' : '';
      rows += `<tr style="${bg}"><td style="border:0.5pt solid #888; padding:2px 4px; font-size:7pt; font-weight:500;">${Utils.sanitize(sub.name)}</td>`;

      let subTotal = 0, subCount = 0;
      K.PARCIALES.forEach(p => {
        const g = (gradeMatrix[sub.id] || {})[p.id] || {};
        rubros.forEach(r => {
          const val = g[r.key];
          rows += `<td style="border:0.5pt solid #888; text-align:center; padding:1px; font-size:6.5pt;">${val !== undefined && val !== null && val !== '' ? val : ''}</td>`;
        });
        const suma = g.suma !== undefined && g.suma !== null ? g.suma : '';
        const faltas = g.faltas !== undefined && g.faltas !== null ? Math.round(g.faltas) : '';
        const cal = g.cal !== undefined && g.cal !== null ? g.cal : '';
        const calNum = parseFloat(cal);
        const calBg = !isNaN(calNum) && calNum < 6 ? ' background:#D9D9D9; font-weight:bold;' : ' font-weight:bold;';

        rows += `<td style="border:0.5pt solid #888; text-align:center; font-size:6.5pt;">${suma}</td>`;
        rows += `<td style="border:0.5pt solid #888; text-align:center; font-size:6.5pt;">${faltas}</td>`;
        rows += `<td style="border:0.5pt solid #888; text-align:center; font-size:7pt;${calBg}">${cal}</td>`;

        if (cal !== '' && !isNaN(calNum)) { subTotal += calNum; subCount++; }
      });

      const avg = subCount > 0 ? (subTotal / subCount).toFixed(1) : '';
      const avgBg = parseFloat(avg) < 6 ? ' background:#D9D9D9; font-weight:bold;' : ' font-weight:bold;';
      rows += `<td style="border:0.5pt solid #888; text-align:center; font-size:7pt;${avgBg}">${avg}</td></tr>`;
    });

    // Column headers
    let thRubros = '';
    K.PARCIALES.forEach(p => {
      rubros.forEach(r => {
        thRubros += `<th style="border:0.5pt solid #888; text-align:center; font-size:5.5pt; padding:1px; background:#333; color:#fff;">${r.abbr}</th>`;
      });
      thRubros += `<th style="border:0.5pt solid #888; text-align:center; font-size:5.5pt; background:#333; color:#fff;">Suma</th>`;
      thRubros += `<th style="border:0.5pt solid #888; text-align:center; font-size:5.5pt; background:#333; color:#fff;">Ftas</th>`;
      thRubros += `<th style="border:0.5pt solid #888; text-align:center; font-size:6pt; background:#000; color:#fff; font-weight:bold;">P${p.numero}</th>`;
    });
    thRubros += `<th style="border:0.5pt solid #888; text-align:center; font-size:6pt; background:#000; color:#fff; font-weight:bold;">PROM</th>`;

    // Parcial group headers
    const colsPerParcial = rubros.length + 3; // rubros + suma + faltas + cal
    let thParcials = '';
    K.PARCIALES.forEach(p => {
      thParcials += `<th colspan="${colsPerParcial}" style="border:0.5pt solid #888; text-align:center; font-size:6.5pt; background:#555; color:#fff;">${p.nombre}</th>`;
    });
    thParcials += `<th rowspan="2" style="border:0.5pt solid #888; text-align:center; font-size:6pt; background:#000; color:#fff; font-weight:bold; width:8mm;">PROM</th>`;

    // Incidents section
    let incidentsHTML = '';
    if (_incidents.length > 0) {
      incidentsHTML = `<div style="margin-top:4mm;"><div style="font-weight:bold; font-size:8pt; border-bottom:1pt solid #000; padding-bottom:1mm; margin-bottom:2mm;">REGISTRO DE INCIDENCIAS</div>
      <table style="width:100%; border-collapse:collapse; font-size:7pt;">
        <tr style="background:#333; color:#fff;">
          <th style="border:0.5pt solid #888; padding:2px 4px; width:15mm;">Fecha</th>
          <th style="border:0.5pt solid #888; padding:2px 4px; width:18mm;">Tipo</th>
          <th style="border:0.5pt solid #888; padding:2px 4px;">Descripción</th>
          <th style="border:0.5pt solid #888; padding:2px 4px; width:25mm;">Reportó</th>
        </tr>`;
      _incidents.forEach(inc => {
        const d = inc.date ? (inc.date.toDate ? inc.date.toDate() : new Date(inc.date)) : null;
        const dateStr = d ? d.toLocaleDateString('es-MX') : '';
        incidentsHTML += `<tr>
          <td style="border:0.5pt solid #888; padding:2px 4px; text-align:center;">${dateStr}</td>
          <td style="border:0.5pt solid #888; padding:2px 4px; text-align:center;">${Utils.sanitize(_getIncidentTypeLabel(inc.type))}</td>
          <td style="border:0.5pt solid #888; padding:2px 4px;">${Utils.sanitize(inc.title || '')}${inc.description ? ' - ' + Utils.sanitize(inc.description) : ''}</td>
          <td style="border:0.5pt solid #888; padding:2px 4px; font-size:6pt;">${Utils.sanitize(inc.reportedBy || '')}</td>
        </tr>`;
      });
      incidentsHTML += '</table></div>';
    }

    const printHTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Reporte - ${Utils.sanitize(fullName)}</title>
    <style>
      @page { size: letter landscape; margin: 6mm 8mm; }
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:Arial,Helvetica,sans-serif; color:#000; }
      .hdr { display:flex; align-items:center; gap:8px; margin-bottom:3mm; }
      .hdr img { height:7mm; }
      .hdr-txt { text-align:right; font-size:5.5pt; color:#333; line-height:1.3; flex:1; }
      h1 { text-align:center; font-size:10pt; margin-bottom:1mm; }
      .sub { text-align:center; font-size:7pt; color:#333; margin-bottom:3mm; border-bottom:0.5pt solid #000; padding-bottom:1mm; }
      .info { display:flex; gap:8mm; font-size:7.5pt; margin-bottom:3mm; }
      .info b { font-weight:700; }
      .stats { display:flex; gap:5mm; margin-bottom:3mm; }
      .stat-box { border:0.5pt solid #888; padding:2mm 4mm; text-align:center; border-radius:2mm; }
      .stat-box .val { font-size:12pt; font-weight:bold; }
      .stat-box .lbl { font-size:6pt; color:#555; }
      table { border-collapse:collapse; width:100%; }
      th, td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    </style></head><body>

    <div class="hdr">
      ${logoHeader ? '<img src="' + logoHeader + '">' : ''}
      <div class="hdr-txt">
        DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR<br>
        ESCUELA PREPARATORIA OFICIAL NÚM. 67<br>
        <b>C.C.T. 15EBH0134D · 15EBH0168U</b>
      </div>
    </div>

    <h1>REPORTE ACADÉMICO INDIVIDUAL</h1>
    <div class="sub">CICLO ESCOLAR 2025-2026 · ${Utils.sanitize(turno)}</div>

    <div class="info">
      <div><b>Alumno:</b> ${Utils.sanitize(fullName)}</div>
      <div><b>Grupo:</b> ${Utils.sanitize(grupo?.nombre || '')}</div>
      <div><b>Grado:</b> ${s.grado || ''}°</div>
      ${s.curp ? `<div><b>CURP:</b> ${Utils.sanitize(s.curp)}</div>` : ''}
    </div>

    <div class="stats">
      <div class="stat-box"><div class="val">${promedio}</div><div class="lbl">Promedio General</div></div>
      <div class="stat-box"><div class="val" style="color:${reprobadas > 0 ? '#c00' : '#090'}">${reprobadas}</div><div class="lbl">Mat. Reprobadas</div></div>
      <div class="stat-box"><div class="val">${totalFaltas}</div><div class="lbl">Total Faltas</div></div>
      <div class="stat-box"><div class="val">${countCal}</div><div class="lbl">Evaluaciones</div></div>
    </div>

    <table>
      <thead>
        <tr><th rowspan="2" style="border:0.5pt solid #888; text-align:left; font-size:6.5pt; background:#333; color:#fff; padding:2px 4px; min-width:30mm;">Materia</th>${thParcials}</tr>
        <tr>${thRubros}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${incidentsHTML}

    <script>setTimeout(()=>window.print(),400)<\/script>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(printHTML);
    w.document.close();
  }

  // Public API
  return { render };
})();

// Self-register with Router
Router.modules['student-profile'] = () => StudentProfileModule.render();
