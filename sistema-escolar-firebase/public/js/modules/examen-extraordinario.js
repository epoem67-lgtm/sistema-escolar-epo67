/**
 * EXAMEN EXTRAORDINARIO — Captura del extra y actualización de cal final.
 *
 * Flujo:
 *   1. El módulo lista los alumnos del scope que están en EXTRA confirmado.
 *      - Maestro: solo SUS materias.
 *      - Orientador: SUS grupos.
 *      - Admin/directivo: todos.
 *   2. Por cada (alumno × materia en extra), input para capturar:
 *      - Calificación del examen extraordinario (5–10, entero)
 *      - Fecha de aplicación
 *      - Comentario opcional
 *   3. Al guardar, se crea/actualiza doc en colección `extraordinarios/{studentId}_{subjectId}`.
 *   4. En boletas y certificados, la cal de la materia muestra la del extraordinario
 *      con marca "(EXT)" cuando exista doc en esta colección.
 *
 * Modelo en Firestore:
 *   extraordinarios/{studentId}_{subjectId} {
 *     studentId, subjectId, groupId,
 *     teacherId, teacherName,
 *     calOriginal: number | null,    // cal final que tenía antes (info)
 *     promedioOriginal: number | null,
 *     calExtraordinario: number,      // 5..10, entero
 *     estatus: 'APROBADO' | 'REPROBADO',
 *     fechaAplicacion: Timestamp,
 *     fechaCaptura: Timestamp,
 *     comentario: string,
 *     ciclo: string,
 *   }
 */

const ExamenExtraordinarioModule = (() => {
  let _data = null;
  let _filters = { search: '', soloPendientes: true };

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando alumnos en extraordinario…');

    try {
      const user = App.currentUser || {};
      const role = user.role;
      const canSeeAll = ['admin', 'subdirector', 'directivo', 'secretario_escolar', 'secretario_admin'].includes(role);
      const isOrientadorOnly = App.canActAs('orientador') && !canSeeAll;
      const isMaestroScope = App.canActAs('maestro') && !canSeeAll;
      const isAcademia = !!(user.academiaGrado && user.academiaTurno);

      // ═══ CARGA DE DATOS ═══
      const [groupsAll, subjectsAll, oriGroups] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        Store.getOrientadorGroups().catch(() => []),
      ]);
      const subjMap = {}; subjectsAll.forEach(s => { subjMap[s.id] = s; });
      const groupMap = {}; groupsAll.forEach(g => { groupMap[g.id] = g; });

      // Determinar assignments visibles.
      // REGLA: cada docente captura SOLO el extraordinario de SUS materias.
      // Aunque sea presidente_academia, en este módulo no captura por otros
      // maestros. Esa restricción coincide con firestore.rules: maestro solo
      // puede escribir extraordinarios donde tiene teacherHasAssignment.
      let assignments = [];
      if (canSeeAll) {
        assignments = await Store.getAssignments();
      } else if (isMaestroScope) {
        // v8.09: STRICT — el maestro SOLO captura el extraordinario de SUS
        // propias asignaciones, ignorando auditorScope/presidente_academia.
        assignments = await Store.getOwnAssignments();
      } else if (isOrientadorOnly && oriGroups && oriGroups.length > 0) {
        // Orientador puro: lectura de extras de sus grupos.
        const set = new Set(oriGroups);
        const allA = await Store.getAssignments().catch(() => []);
        assignments = allA.filter(a => set.has(a.groupId));
      }

      if (assignments.length === 0) {
        container.innerHTML = UI.moduleContainer([
          UI.pageHeader('Examen Extraordinario', 'Sin materias en tu scope'),
          `<div class="alert alert-warning" style="margin:14px 0;">
            No tienes materias o grupos asignados para capturar examen extraordinario.
          </div>`
        ].join(''));
        return;
      }

      const groupIds = [...new Set(assignments.map(a => a.groupId))];
      const [students, gradesAll, hoursAll, extrasExistentes] = await Promise.all([
        Store.getStudentsByGroups(groupIds).catch(() => []),
        Store.getGradesByGroups(groupIds, true).catch(() => []),
        _loadHours(groupIds).catch(() => []),
        _loadExtrasExistentes(groupIds).catch(() => []),
      ]);
      const activeStudents = students.filter(s => (s.estatus || '').toUpperCase() === 'ACTIVO');

      // Index grades por student × subject × parcial
      const gIdx = {};
      for (const g of gradesAll) {
        if (!gIdx[g.studentId]) gIdx[g.studentId] = {};
        if (!gIdx[g.studentId][g.subjectId]) gIdx[g.studentId][g.subjectId] = {};
        gIdx[g.studentId][g.subjectId][g.partial] = g;
      }
      // Index hours
      const hIdx = {};
      for (const h of hoursAll) {
        if (!hIdx[h.groupId]) hIdx[h.groupId] = {};
        if (!hIdx[h.groupId][h.subjectId]) hIdx[h.groupId][h.subjectId] = {};
        hIdx[h.groupId][h.subjectId][h.partial] = h;
      }
      // Index extras existentes por studentId_subjectId
      const extraIdx = {};
      for (const e of extrasExistentes) {
        const key = `${e.studentId}_${e.subjectId}`;
        extraIdx[key] = e;
      }

      // ═══ Detectar alumnos EN EXTRA confirmado ═══
      const rows = [];
      for (const a of assignments) {
        const grupo = groupMap[a.groupId];
        if (!grupo) continue;
        const subj = subjMap[a.subjectId];
        const subjName = subj?.nombre || a.subjectName || a.subjectId;
        const studs = activeStudents.filter(s => s.groupId === a.groupId);
        for (const stu of studs) {
          const sg = gIdx[stu.id]?.[a.subjectId] || {};
          const grades3 = [sg.P1 || null, sg.P2 || null, sg.P3 || null];
          const hoursByPart = hIdx[a.groupId]?.[a.subjectId] || {};
          const status = App.calcStatusExtraordinario({ grades3, hoursByPart });
          if (!status.isExtra) continue; // solo extras confirmados, no riesgo
          const extraKey = `${stu.id}_${a.subjectId}`;
          const extraDoc = extraIdx[extraKey] || null;
          rows.push({
            studentId: stu.id,
            studentName: ((stu.apellido1 || '') + ' ' + (stu.apellido2 || '') + ' ' + (stu.nombres || '')).trim(),
            groupId: a.groupId,
            groupName: grupo.nombre,
            turno: grupo.turno,
            grado: grupo.grado,
            subjectId: a.subjectId,
            subjectName: subjName,
            calOriginal: status.cals.find(c => c != null) != null ? Math.min(...status.cals.filter(c => c != null)) : null,
            promedioOriginal: status.promedio,
            causaExtra: status.causa,
            estatusExtra: status.estatus,
            extraDoc,
          });
        }
      }

      _data = { rows };
      _renderUI(container);
    } catch (e) {
      console.error('Error en Examen Extraordinario:', e);
      container.innerHTML = UI.errorState('Error al cargar: ' + (e.message || ''));
    }
  }

  async function _loadHours(groupIds) {
    if (!groupIds || !groupIds.length || !window.db) return [];
    const all = [];
    const chunks = [];
    for (let i = 0; i < groupIds.length; i += 30) chunks.push(groupIds.slice(i, i + 30));
    for (const chunk of chunks) {
      try {
        const snap = await window.db.collection('teacherHours').where('groupId', 'in', chunk).get();
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      } catch (_) {}
    }
    return all;
  }

  async function _loadExtrasExistentes(groupIds) {
    if (!groupIds || !groupIds.length || !window.db) return [];
    const all = [];
    const chunks = [];
    for (let i = 0; i < groupIds.length; i += 30) chunks.push(groupIds.slice(i, i + 30));
    for (const chunk of chunks) {
      try {
        const snap = await window.db.collection('extraordinarios').where('groupId', 'in', chunk).get();
        snap.forEach(d => all.push({ id: d.id, ...d.data() }));
      } catch (e) {
        // Si la colección no existe aún, no es error
        if (!String(e.message || '').includes('NOT_FOUND')) console.warn('hours chunk:', e);
      }
    }
    return all;
  }

  function _renderUI(container) {
    if (!_data) return;
    let { rows } = _data;

    // Conteos
    const total = rows.length;
    const capturados = rows.filter(r => r.extraDoc).length;
    const pendientes = total - capturados;
    const aprobados = rows.filter(r => r.extraDoc?.estatus === 'APROBADO').length;
    const reprobados = rows.filter(r => r.extraDoc?.estatus === 'REPROBADO').length;

    // Filtros
    if (_filters.soloPendientes) {
      rows = rows.filter(r => !r.extraDoc);
    }
    if (_filters.search) {
      const q = _filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      rows = rows.filter(r => {
        const t = `${r.studentName} ${r.groupName} ${r.subjectName}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return t.includes(q);
      });
    }

    // Ordenar: grupo → orden SEP del grado → alumno.
    const _norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
    const _sepIdx = (name, grado) => {
      const order = (K.SUBJECT_ORDER || {})[Number(grado)] || [];
      if (order.length === 0) return 999;
      const n = _norm(name);
      const i = order.findIndex(o => _norm(o) === n || n.includes(_norm(o)) || _norm(o).includes(n));
      return i === -1 ? 999 : i;
    };
    rows.sort((a, b) =>
      (a.groupName || '').localeCompare(b.groupName || '') ||
      (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
      (a.subjectName || '').localeCompare(b.subjectName || '') ||
      a.studentName.localeCompare(b.studentName)
    );

    // ═══ HTML ═══
    const fechaHoy = new Date().toISOString().slice(0, 10);

    const filasHtml = rows.length === 0
      ? `<tr><td colspan="7" style="padding:32px;text-align:center;color:#9ca3af;font-size:14px;">
          ${_filters.soloPendientes && capturados > 0
            ? '✓ Ya capturaste todos los extras pendientes.'
            : '✓ No hay alumnos en extraordinario en tu scope.'}
        </td></tr>`
      : rows.map((r, i) => {
          const yaCapturado = !!r.extraDoc;
          const calVal = r.extraDoc?.calExtraordinario ?? '';
          const fechaVal = r.extraDoc?.fechaAplicacion
            ? (typeof r.extraDoc.fechaAplicacion.toDate === 'function'
                ? r.extraDoc.fechaAplicacion.toDate().toISOString().slice(0, 10)
                : new Date(r.extraDoc.fechaAplicacion).toISOString().slice(0, 10))
            : fechaHoy;
          const comentVal = r.extraDoc?.comentario || '';
          const statusBadge = yaCapturado
            ? (r.extraDoc.estatus === 'APROBADO'
                ? '<span style="background:#16a34a;color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;">✓ APROBÓ</span>'
                : '<span style="background:#dc2626;color:#fff;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;">✗ NO APROBÓ</span>')
            : '<span style="background:#fbbf24;color:#78350f;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700;">PENDIENTE</span>';
          const causaTexto = r.causaExtra || r.estatusExtra;
          const rowBg = yaCapturado
            ? (r.extraDoc.estatus === 'APROBADO' ? 'background:#f0fdf4;' : 'background:#fef2f2;')
            : '';
          return `<tr data-key="${r.studentId}_${r.subjectId}" style="${rowBg}border-bottom:1px solid #e5e7eb;">
            <td style="padding:10px 8px;text-align:center;color:#9ca3af;font-size:12px;">${i + 1}</td>
            <td style="padding:10px 12px;">
              <div style="font-weight:600;color:#1e40af;">${Utils.sanitize(r.studentName)}</div>
              <div style="font-size:11px;color:#6b7280;">${Utils.sanitize(r.groupName)} · ${Utils.sanitize(r.subjectName)}</div>
              <div style="font-size:10px;color:#dc2626;margin-top:2px;" title="${Utils.sanitize(causaTexto)}">${Utils.sanitize(causaTexto.length > 60 ? causaTexto.slice(0, 57) + '…' : causaTexto)}</div>
            </td>
            <td style="padding:10px 8px;text-align:center;">
              <input type="number" min="5" max="10" step="1" value="${calVal}"
                data-field="cal" data-key="${r.studentId}_${r.subjectId}"
                placeholder="5–10"
                style="width:70px;padding:8px;border:2px solid ${yaCapturado ? '#16a34a' : '#cbd5e0'};border-radius:8px;text-align:center;font-size:16px;font-weight:700;color:${yaCapturado ? '#16a34a' : '#1f2937'};">
            </td>
            <td style="padding:10px 8px;text-align:center;">
              <input type="date" value="${fechaVal}"
                data-field="fecha" data-key="${r.studentId}_${r.subjectId}"
                style="padding:7px;border:1px solid #cbd5e0;border-radius:6px;font-size:12px;">
            </td>
            <td style="padding:10px 8px;">
              <input type="text" value="${Utils.sanitize(comentVal)}"
                data-field="comentario" data-key="${r.studentId}_${r.subjectId}"
                placeholder="Comentario (opcional)…"
                style="width:100%;padding:7px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:12px;">
            </td>
            <td style="padding:10px 8px;text-align:center;">${statusBadge}</td>
            <td style="padding:10px 8px;text-align:center;">
              <button data-action="save-row" data-key="${r.studentId}_${r.subjectId}"
                style="padding:8px 14px;background:#0891b2;color:#fff;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
                ${yaCapturado ? 'Actualizar' : 'Guardar'}
              </button>
            </td>
          </tr>`;
        }).join('');

    container.innerHTML = UI.moduleContainer([
      UI.pageHeader(
        'Examen Extraordinario',
        'Captura la calificación del extraordinario. Reemplaza la cal final de la materia y se marca como EXT en boletas.'
      ),

      // KPIs
      `<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:16px;">
        ${_kpi('🎓', 'TOTAL EN EXTRA', total, '#1e40af')}
        ${_kpi('⏳', 'PENDIENTES', pendientes, '#d97706')}
        ${_kpi('✅', 'APROBARON EXTRA', aprobados, '#16a34a')}
        ${_kpi('❌', 'REPROBARON EXTRA', reprobados, '#dc2626')}
      </div>`,

      // Banner instrucciones
      `<div class="card" style="padding:12px 16px;margin-bottom:14px;background:#fffbeb;border-left:4px solid #d97706;font-size:13px;color:#78350f;">
        <strong>📋 Instrucciones:</strong>
        Captura la calificación del examen extraordinario (entero 5–10). La fecha por defecto es hoy.
        Al guardar, el sistema marca como <strong>APROBADO</strong> si la cal es ≥6, o <strong>NO APROBADO</strong> si es &lt;6.
        Esta cal reemplazará la calificación final de la materia en boletas y certificados, con la marca <strong>(EXT)</strong>.
      </div>`,

      // Filtros
      `<div style="display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap;">
        <div style="flex:1;min-width:280px;position:relative;">
          <span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#94a3b8;">🔍</span>
          <input id="ext-search" type="text" placeholder="Buscar alumno, grupo o materia…"
            value="${Utils.sanitize(_filters.search)}"
            style="width:100%;padding:10px 14px 10px 42px;border:1.5px solid #cbd5e0;border-radius:10px;font-size:13px;outline:none;">
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:#374151;font-weight:600;">
          <input type="checkbox" id="ext-pendientes" ${_filters.soloPendientes ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
          Solo pendientes
        </label>
      </div>`,

      // Tabla
      `<div class="card" style="padding:0;overflow:hidden;">
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead style="background:#1e40af;color:#fff;"><tr>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">#</th>
              <th style="text-align:left;padding:11px 12px;font-size:11px;font-weight:700;letter-spacing:.5px;">ALUMNO · GRUPO · MATERIA</th>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">CAL EXTRA</th>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">FECHA</th>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">COMENTARIO</th>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">RESULTADO</th>
              <th style="padding:11px 8px;font-size:11px;font-weight:700;letter-spacing:.5px;">ACCIÓN</th>
            </tr></thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
      </div>`,
    ].join(''));

    _bindEvents(container);
  }

  function _kpi(icon, label, value, color) {
    return `<div class="card" style="padding:14px 16px;border-left:4px solid ${color};">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.2px;">${label}</div>
          <div style="font-size:30px;font-weight:900;color:${color};line-height:1;margin-top:4px;">${value}</div>
        </div>
        <div style="font-size:30px;opacity:.4;">${icon}</div>
      </div>
    </div>`;
  }

  function _bindEvents(container) {
    // Búsqueda con debounce
    const searchInput = container.querySelector('#ext-search');
    if (searchInput) {
      let timer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          _filters.search = e.target.value;
          _renderUI(container);
          const ni = container.querySelector('#ext-search');
          if (ni) { ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length); }
        }, 200);
      });
    }
    // Checkbox solo pendientes
    const cb = container.querySelector('#ext-pendientes');
    if (cb) cb.addEventListener('change', () => {
      _filters.soloPendientes = cb.checked;
      _renderUI(container);
    });
    // Botones de guardar
    container.querySelectorAll('[data-action="save-row"]').forEach(btn => {
      btn.addEventListener('click', () => _saveRow(container, btn.dataset.key));
    });
  }

  async function _saveRow(container, key) {
    if (!_data) return;
    const row = _data.rows.find(r => `${r.studentId}_${r.subjectId}` === key);
    if (!row) return;

    const calInput = container.querySelector(`input[data-field="cal"][data-key="${key}"]`);
    const fechaInput = container.querySelector(`input[data-field="fecha"][data-key="${key}"]`);
    const comentInput = container.querySelector(`input[data-field="comentario"][data-key="${key}"]`);
    if (!calInput) return;

    const cal = parseInt(calInput.value, 10);
    if (isNaN(cal) || cal < 5 || cal > 10) {
      Toast.show('La calificación debe ser un número entero entre 5 y 10', 'error');
      calInput.focus();
      return;
    }
    const fecha = fechaInput?.value || new Date().toISOString().slice(0, 10);
    const comentario = (comentInput?.value || '').trim();
    const estatus = cal >= 6 ? 'APROBADO' : 'REPROBADO';

    try {
      Toast.show('Guardando…', 'info', 1500);
      const docId = `${row.studentId}_${row.subjectId}`;
      const user = App.currentUser || {};
      const payload = {
        studentId: row.studentId,
        subjectId: row.subjectId,
        groupId: row.groupId,
        teacherId: user.teacherId || null,
        teacherName: user.displayName || '',
        calOriginal: row.calOriginal,
        promedioOriginal: row.promedioOriginal,
        calExtraordinario: cal,
        estatus,
        fechaAplicacion: firebase.firestore.Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
        fechaCaptura: firebase.firestore.FieldValue.serverTimestamp(),
        comentario,
        ciclo: (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026',
        updatedBy: firebase.auth().currentUser?.uid || null,
      };
      await window.db.collection('extraordinarios').doc(docId).set(payload, { merge: true });
      Toast.show(`✓ Extraordinario guardado · ${estatus === 'APROBADO' ? 'APROBÓ' : 'NO APROBÓ'} (cal ${cal})`, 'success');
      // Refrescar datos
      await render();
    } catch (e) {
      console.error('Error guardando extra:', e);
      Toast.show('Error al guardar: ' + (e.message || 'desconocido'), 'error');
    }
  }

  return { render };
})();

Router.modules['examen-extraordinario'] = () => ExamenExtraordinarioModule.render();
