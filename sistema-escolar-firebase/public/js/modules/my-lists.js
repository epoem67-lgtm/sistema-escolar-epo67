/**
 * MIS LISTAS — Vista del maestro
 * Selector simple arriba, lista del grupo abajo, botones de imprimir destacados.
 *
 * 2 formatos PDF disponibles:
 *   1) ANOTACIONES — 15 columnas en blanco (asistencia / observaciones)
 *   2) RUBROS      — Evaluación Continua, (Examen Parcial si vesp), Transversal, Punto Extra, Faltas, Suma, Calificación
 *
 * Ambos formatos ocupan TODA la hoja carta y caben en una sola página.
 */

const MyListsModule = (() => {
  const state = {
    assignments: [],
    selected: null, // { groupId, groupName, subjectName, turno, grado, teacherName }
    students: [],
    statusByStudent: {}, // {studentId → result de App.calcStatusExtraordinario en la materia del asg}
  };

  const S = (v) => Utils.sanitize(String(v ?? ''));

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `<div class="module-container"><div class="loading-state">
      <span class="material-icons-round loading-spinner">autorenew</span>
      <p>Cargando tus grupos...</p></div></div>`;

    try {
      // v8.09: SIEMPRE STRICT — "Mis Listas" debe ser SOLO las propias del usuario.
      // Si Jessica (auditor) entrara con getMyAssignments, vería las 216 listas
      // de toda la escuela en lugar de sus 4.
      state.assignments = (await Store.getOwnAssignments()) || [];
      // Ordenar el dropdown por turno → grado → grupo → orden SEP de materias.
      const _norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
      const _sepIdx = (name, grado) => {
        const order = (K.SUBJECT_ORDER || {})[Number(grado)] || [];
        if (order.length === 0) return 999;
        const n = _norm(name);
        const i = order.findIndex(o => _norm(o) === n || n.includes(_norm(o)) || _norm(o).includes(n));
        return i === -1 ? 999 : i;
      };
      state.assignments.sort((a, b) =>
        (a.turno || '').localeCompare(b.turno || '') ||
        String(a.grado || '').localeCompare(String(b.grado || '')) ||
        (a.groupName || '').localeCompare(b.groupName || '') ||
        (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
        (a.subjectName || '').localeCompare(b.subjectName || '')
      );
    } catch (e) {
      container.innerHTML = `<div class="module-container"><div class="error-state">
        <span class="material-icons-round">error</span><p>${S(e.message)}</p></div></div>`;
      return;
    }

    if (!state.assignments.length) {
      container.innerHTML = `<div class="module-container">
        <h1 class="module-title">Mis Listas</h1>
        <div class="empty-state">
          <span class="material-icons-round empty-state-icon">folder_off</span>
          <p class="empty-state-text">No tienes grupos asignados.</p>
        </div></div>`;
      return;
    }

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Mis Listas</h1>
        <p class="module-subtitle">Imprime las listas de tus grupos en 2 formatos: anotaciones libres o con rubros.</p>

        <!-- SELECTOR DE GRUPO (un solo dropdown grande) -->
        <div class="card" style="margin-bottom:16px;">
          <label style="font-size:14px;font-weight:700;color:#1e293b;display:block;margin-bottom:8px;">
            ¿De qué grupo quieres la lista?
          </label>
          <select id="ml-asg" style="width:100%;max-width:600px;padding:12px;font-size:15px;border:2px solid #cbd5e0;border-radius:8px;background:#fff;cursor:pointer;">
            <option value="">— Selecciona un grupo —</option>
            ${state.assignments.map(a => `
              <option value="${S(a.id)}">
                ${S(a.groupName)} · ${S(K.getUACNombre(a.subjectName))} · ${S(a.turno)}
              </option>`).join('')}
          </select>
        </div>

        <!-- DETALLE DEL GRUPO + BOTONES -->
        <div id="ml-detail"></div>
      </div>`;

    _bindGlobalEvents();
  }

  // ═══════════════════════════════════════════════════════════════
  // SELECCIÓN DE GRUPO
  // ═══════════════════════════════════════════════════════════════
  async function _selectAssignment(asgId) {
    const asg = state.assignments.find(a => a.id === asgId);
    if (!asg) {
      state.selected = null;
      document.getElementById('ml-detail').innerHTML = '';
      return;
    }
    state.selected = asg;

    const root = document.getElementById('ml-detail');
    root.innerHTML = `<div class="card"><div class="loading-state">
      <span class="material-icons-round loading-spinner">autorenew</span>
      <p>Cargando estudiantes...</p></div></div>`;

    try {
      const all = await Store.getStudentsByGroup(asg.groupId);
      state.students = (all || [])
        .filter(s => {
          const e = (s.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      _renderDetail();
      // Cargar estatus extra/riesgo en background (no bloquea el render).
      // Cuando termine, refresca solo la columna de estatus.
      _loadStatusForAssignment(asg).catch(() => {});
    } catch (e) {
      root.innerHTML = `<div class="card"><div class="error-state">
        <span class="material-icons-round">error</span><p>${S(e.message)}</p></div></div>`;
    }
  }

  /**
   * Calcula el estatus de extra/riesgo de cada alumno EN LA MATERIA del asg
   * seleccionado, y refresca solo las celdas de la columna estatus.
   * No bloquea el render principal — corre asíncrono.
   */
  async function _loadStatusForAssignment(asg) {
    state.statusByStudent = {};
    if (!asg || !state.students.length) return;
    try {
      // Cargar grades de la materia × grupo (los 3 parciales) + hours
      const groupGrades = await Store.getGradesByGroup(asg.groupId, true);
      const filtered = (groupGrades || []).filter(g => g.subjectId === asg.subjectId);
      // Index por studentId × parcial
      const gIdx = {};
      filtered.forEach(g => {
        if (!gIdx[g.studentId]) gIdx[g.studentId] = {};
        gIdx[g.studentId][g.partial] = g;
      });
      // Hours
      const hoursByPart = {};
      if (window.db) {
        const docs = await Promise.all(['P1', 'P2', 'P3'].map(p => {
          const docId = `${asg.groupId}_${asg.subjectId}_${p}`;
          return window.db.collection('teacherHours').doc(docId).get()
            .then(d => d.exists ? d.data() : null)
            .catch(() => null);
        }));
        ['P1', 'P2', 'P3'].forEach((p, i) => { hoursByPart[p] = docs[i]; });
      }
      // Calcular status por alumno
      for (const stu of state.students) {
        const sg = gIdx[stu.docId || stu.id] || {};
        const grades3 = [sg.P1 || null, sg.P2 || null, sg.P3 || null];
        state.statusByStudent[stu.docId || stu.id] = App.calcStatusExtraordinario({ grades3, hoursByPart });
      }
      // Refrescar solo el área de la lista (mantener seleccionador y botones intactos)
      _renderDetail();
    } catch (e) {
      console.warn('No se pudo cargar estatus en Mis Listas:', e);
    }
  }

  function _renderDetail() {
    const root = document.getElementById('ml-detail');
    if (!root || !state.selected) return;
    const asg = state.selected;
    const counts = _countSex();

    // Conteos para chip header (si ya cargó el estatus)
    let cntExtra = 0, cntRiesgo = 0;
    Object.values(state.statusByStudent || {}).forEach(st => {
      if (!st) return;
      if (st.isExtra) cntExtra++;
      else if (st.isRiesgo) cntRiesgo++;
    });

    const rows = state.students.map((s, i) => {
      const sid = s.docId || s.id;
      const st = state.statusByStudent[sid];
      let rowBg = '';
      let statusCell = '<td style="text-align:center;width:130px;color:#cbd5e0;font-size:11px;">—</td>';
      if (st) {
        if (st.isExtra) {
          rowBg = 'background:#fef2f2;border-left:4px solid #dc2626;';
          const lbl = st.estatus === 'EXTRA_AMBAS' ? 'EXTRA · ambas'
                   : st.estatus === 'EXTRA_CAL'   ? 'EXTRA · calif'
                   : 'EXTRA · faltas';
          statusCell = `<td style="text-align:center;width:130px;">
            <span title="${S(st.causa)}" style="background:#dc2626;color:#fff;padding:3px 10px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.3px;">${lbl}</span>
          </td>`;
        } else if (st.isRiesgo) {
          rowBg = 'background:#fffbeb;border-left:4px solid #d97706;';
          const lbl = st.estatus === 'EN_RIESGO_AMBAS' ? 'Riesgo · ambas'
                   : st.estatus === 'EN_RIESGO_CAL'   ? 'Riesgo · calif'
                   : 'Riesgo · faltas';
          statusCell = `<td style="text-align:center;width:130px;">
            <span title="${S(st.causa)}" style="background:#d97706;color:#fff;padding:3px 10px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.3px;">${lbl}</span>
          </td>`;
        } else if (st.estatus === 'APROBADO' || st.estatus === 'APROBADO_REGLA') {
          statusCell = `<td style="text-align:center;width:130px;">
            <span style="color:#16a34a;font-size:11px;font-weight:600;">✓ aprobado</span>
          </td>`;
        }
      }
      return `<tr style="${rowBg}">
        <td style="text-align:center;color:#888;width:40px;">${i + 1}</td>
        <td style="font-weight:600;">${S(Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto)}</td>
        <td style="text-align:center;width:80px;">${S(s.expediente || '—')}</td>
        <td style="text-align:center;width:90px;">${S(s.folio || '—')}</td>
        <td style="text-align:center;width:50px;">${S(s.sexo || '')}</td>
        ${statusCell}
      </tr>`;
    }).join('');

    root.innerHTML = `
      <!-- BOTONES DE IMPRIMIR ARRIBA, GRANDES -->
      <div class="card" style="background:#f0f9ff;border:2px solid #3182ce;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:18px;font-weight:700;color:#1e40af;">
              ${S(asg.groupName)} · ${S(K.getUACNombre(asg.subjectName))}
            </div>
            <div style="font-size:13px;color:#475569;margin-top:2px;">
              Turno ${S(asg.turno)} · ${state.students.length} alumno(s) · H: ${counts.h} · M: ${counts.m}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <div style="flex:1;min-width:300px;">
            <div style="font-size:11px;font-weight:700;color:#0c4a6e;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">
              📋 Lista para anotaciones (15 columnas en blanco)
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-primary" data-action="ml-print-anotaciones" style="font-weight:600;padding:8px 14px;flex:1;">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">picture_as_pdf</span>
                Imprimir PDF
              </button>
              <button class="btn btn-success" data-action="ml-excel-anotaciones" style="font-weight:600;padding:8px 14px;flex:1;">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">file_download</span>
                Excel
              </button>
            </div>
          </div>
          <div style="flex:1;min-width:300px;">
            <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">
              📊 Lista con rubros (Evaluación Continua, Transversal, Examen Parcial, Punto Extra, Faltas, Suma, Cal.)
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-primary" data-action="ml-print-rubros" style="font-weight:600;padding:8px 14px;flex:1;background:#16a34a;border-color:#16a34a;">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">picture_as_pdf</span>
                Imprimir PDF
              </button>
              <button class="btn btn-success" data-action="ml-excel-rubros" style="font-weight:600;padding:8px 14px;flex:1;">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">file_download</span>
                Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- TABLA EN PANTALLA -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <h3 class="section-title" style="margin:0;">Vista previa de los estudiantes</h3>
          ${(cntExtra + cntRiesgo) > 0 ? `
          <div style="display:flex;gap:6px;font-size:11px;font-weight:700;">
            ${cntExtra > 0 ? `<span style="background:#dc2626;color:#fff;padding:3px 10px;border-radius:10px;">${cntExtra} en EXTRA</span>` : ''}
            ${cntRiesgo > 0 ? `<span style="background:#d97706;color:#fff;padding:3px 10px;border-radius:10px;">${cntRiesgo} en RIESGO</span>` : ''}
          </div>` : ''}
        </div>
        <div class="table-container" style="max-height:400px;overflow-y:auto;">
          <table class="table-light" style="font-size:13px;">
            <thead style="position:sticky;top:0;background:#fff;">
              <tr>
                <th>#</th>
                <th>Nombre completo</th>
                <th style="text-align:center;">Expediente</th>
                <th style="text-align:center;">Folio</th>
                <th style="text-align:center;">Sexo</th>
                <th style="text-align:center;">Estatus</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function _countSex() {
    const h = state.students.filter(s => /^H/i.test(String(s.sexo || ''))).length;
    const m = state.students.filter(s => /^M/i.test(String(s.sexo || ''))).length;
    return { h, m, t: state.students.length };
  }

  // ═══════════════════════════════════════════════════════════════
  // PDFs OFICIALES — TODO en una hoja carta, ocupando TODO el ancho/largo
  // ═══════════════════════════════════════════════════════════════
  function _gradoText(g) { return ({ 1: 'PRIMER GRADO', 2: 'SEGUNDO GRADO', 3: 'TERCER GRADO' })[Number(g)] || ''; }
  function _semestreText(g) {
    // Usa App.getCurrentSemester para detectar automáticamente el semestre
    // según la fecha actual (1er sem ago-ene / 2do sem feb-jul).
    try { return App.getCurrentSemester(g).texto + ' SEMESTRE'; }
    catch (_) { return ''; }
  }
  function _grupoNumText(name) {
    const num = (name || '').split('-')[1] || '';
    return ({ '1': 'UNO', '2': 'DOS', '3': 'TRES' })[num] || num;
  }

  function _commonHeader() {
    const asg = state.selected;
    const teacherName = asg?.teacherName || App.currentUser?.displayName || '';
    const teacherDisplay = (Utils.displayName ? Utils.displayName(teacherName) : teacherName).toUpperCase();
    const orientador = (typeof K?.getOrientador === 'function')
      ? K.getOrientador(asg.turno, asg.groupName) : '';
    const subdir = (typeof App.staffName === 'function' ? App.staffName('subdirector') : '') || '';
    const directora = (typeof App.staffName === 'function' ? App.staffName('director') : '') || '';
    return { teacherDisplay, orientador, subdir, directora, counts: _countSex() };
  }

  // CSS para que la tabla ocupe TODO el ancho y la altura disponible.
  // Calcula altura de fila para que N alumnos quepan exactos en la hoja.
  function _commonStyles(numStudents) {
    const n = Math.max(numStudents || 30, 1);
    // Altura util para tabla = ~22cm tras header + firmas + legal
    // En mm. 1 hoja carta = 27.94cm = 279.4mm
    // Margen vertical 0.5cm × 2 = 1cm = 10mm. Total util ~270mm.
    // Header (~28mm) + Firmas (~22mm) + Legal (~10mm) = 60mm.
    // Altura tabla = 270 - 60 = 210mm = 21cm
    // Por fila: 210 / (n + 1 header) mm
    const tableMm = 215;
    const rowMm = (tableMm / (n + 1)).toFixed(2);
    // Tamaño de fuente proporcional
    const fontSize = n <= 30 ? 10 : (n <= 40 ? 9 : (n <= 50 ? 8 : 7.5));
    const headerFs = Math.max(7, fontSize - 0.5);

    return `
      @page { size: letter; margin: 0.5cm 0.5cm; }
      html, body { margin: 0; padding: 0; height: 100%; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: ${fontSize}px; line-height: 1.1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .hdr { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 3px; margin-bottom: 4px; }
      .hdr h1 { margin: 0; color: #1e3a8a; font-size: 12px; letter-spacing: 0.5px; }
      .hdr .sub { margin: 1px 0; font-size: 9px; color: #444; font-weight: 600; }
      .meta { display: grid; grid-template-columns: 1.4fr 1.4fr 1fr; gap: 1px 12px; margin-bottom: 4px; font-size: 9px; }
      .meta b { color: #1e3a8a; }
      table.lt { width: 100%; border-collapse: collapse; table-layout: fixed; }
      table.lt th, table.lt td {
        border: 1px solid #555;
        padding: 0 2px;
        vertical-align: middle;
        height: ${rowMm}mm;
        font-size: ${fontSize}px;
        overflow: hidden;
      }
      table.lt th { background: #1e3a8a; color: #fff; text-align: center; font-size: ${headerFs}px; padding: 1px 2px; height: auto; }
      table.lt td.num { text-align: center; }
      table.lt td.folio { text-align: center; font-size: ${headerFs}px; }
      table.lt .blank { background: #fff; }
      table.lt td.nm { padding-left: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .firmas { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin-top: 6px; page-break-inside: avoid; }
      .firma { text-align: center; }
      .firma .firma-space { height: 26px; border-bottom: 1px solid #111; margin: 0 2px 2px; }
      .firma .role { font-size: 7px; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
      .firma .name { font-size: 8px; font-weight: 700; margin-top: 1px; line-height: 1.1; }
      .legal { background: #fef3c7; border: 1px solid #d97706; padding: 3px 8px; font-size: 7.5px; color: #78350f; margin-top: 4px; text-align: center; font-weight: 600; line-height: 1.3; }
      .totals { margin-top: 2px; font-size: 9px; }
      .totals b { background: #1e3a8a; color: #fff; padding: 1px 6px; border-radius: 3px; }
    `;
  }

  // ─── PDF FORMATO 1: ANOTACIONES (15 columnas en blanco) ──────────
  function printListAnotaciones() {
    if (!state.students.length) {
      Toast.show('No hay estudiantes para imprimir', 'warning');
      return;
    }
    const meta = _commonHeader();
    const asg = state.selected;
    const blankCols = 15;

    const rows = state.students.map((s, i) => {
      const blanks = Array(blankCols).fill('<td class="blank"></td>').join('');
      const fullName = Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="folio">${S(s.folio || '')}</td>
        <td class="nm">${S(fullName)}</td>
        ${blanks}
      </tr>`;
    }).join('');

    const blankHeaderCells = Array(blankCols).fill('<th></th>').join('');

    // Anchos: # (4%), Folio (8%), Nombre (28%), 15 cols (60% / 15 = 4% c/u)
    const colgroup = `
      <colgroup>
        <col style="width:5%;">
        <col style="width:8%;">
        <col style="width:27%;">
        ${Array(blankCols).fill(`<col style="width:${(60 / blankCols).toFixed(2)}%;">`).join('')}
      </colgroup>`;

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Lista ${S(asg.groupName)} - Anotaciones</title>
      <style>${_commonStyles(state.students.length)}</style></head><body>
      <div class="hdr">
        <h1>ESCUELA PREPARATORIA OFICIAL No. 67</h1>
        <div class="sub">CICLO ESCOLAR 2025-2026 · ${S(_semestreText(asg.grado))}</div>
        <div class="sub">${S(_gradoText(asg.grado))} · GRUPO ${S(_grupoNumText(asg.groupName))} · TURNO ${S(asg.turno)} · ${S(K.getUACNombre(asg.subjectName))}</div>
      </div>
      <div class="meta">
        <div><b>Profesor(a):</b> ${S(meta.teacherDisplay)}</div>
        <div><b>Orientador(a):</b> ${S(meta.orientador)}</div>
        <div><b>Total:</b> H ${meta.counts.h} · M ${meta.counts.m} · T ${meta.counts.t}</div>
      </div>
      <table class="lt">
        ${colgroup}
        <thead>
          <tr>
            <th>#</th>
            <th>Folio</th>
            <th style="text-align:left;">NOMBRE COMPLETO</th>
            ${blankHeaderCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="firmas">
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Profesor(a)</div>
          <div class="name">${S(meta.teacherDisplay)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Orientador(a)</div>
          <div class="name">${S(meta.orientador)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">V°B° Subdirección</div>
          <div class="name">${S(meta.subdir)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Dirección Escolar</div>
          <div class="name">${S(meta.directora)}</div>
        </div>
      </div>
      <div class="legal">
        ⚠ Las calificaciones son OFICIALES sí y solo sí están capturadas en la plataforma del Sistema Escolar EPO 67.
      </div>
      <script>setTimeout(()=>window.print(),400)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('Tu navegador bloqueó la ventana de impresión.', 'warning'); return; }
    w.document.write(html); w.document.close();
  }

  // ─── PDF FORMATO 2: CON RUBROS ─────────────────────────────────
  function printListRubros() {
    if (!state.students.length) {
      Toast.show('No hay estudiantes para imprimir', 'warning');
      return;
    }
    const meta = _commonHeader();
    const asg = state.selected;
    const isVesp = String(asg.turno || '').toUpperCase() === 'VESPERTINO';
    const rubrosCols = isVesp
      ? [{ label: 'EVALUACIÓN<br>CONTINUA', max: 5 }, { label: 'TRANSVERSAL', max: 2 }, { label: 'EXAMEN<br>PARCIAL', max: 3 }, { label: 'PUNTO<br>EXTRA', max: null }]
      : [{ label: 'EVALUACIÓN<br>CONTINUA', max: 8 }, { label: 'TRANSVERSAL', max: 2 }, { label: 'PUNTO<br>EXTRA', max: null }];

    const totalCols = 3 /*#,Folio,Nombre*/ + rubrosCols.length + 3 /*Faltas,Suma,Cal*/;
    // Ancho del nombre = lo que sobre. Resto fijo.
    // # (4%), Folio (8%), [Nombre flexible], rubros + faltas+suma+cal (cada uno 5%)
    const fixedCols = rubrosCols.length + 3; // rubros + faltas + suma + cal
    const fixedPct = fixedCols * 5; // 5% cada uno
    const namePct = 100 - 4 - 8 - fixedPct;

    const colgroup = `
      <colgroup>
        <col style="width:4%;">
        <col style="width:8%;">
        <col style="width:${namePct}%;">
        ${Array(fixedCols).fill(`<col style="width:5%;">`).join('')}
      </colgroup>`;

    const rubroHeaders = rubrosCols.map(r =>
      `<th><div>${r.label}</div><div style="font-size:6.5px;font-weight:400;">${r.max ? '(máx ' + r.max + ')' : '(extra)'}</div></th>`
    ).join('');
    const rubroCells = rubrosCols.map(() => '<td class="blank"></td>').join('');

    const rows = state.students.map((s, i) => {
      const fullName = Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="folio">${S(s.folio || '')}</td>
        <td class="nm">${S(fullName)}</td>
        ${rubroCells}
        <td class="blank"></td>
        <td class="blank"></td>
        <td class="blank"></td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Lista ${S(asg.groupName)} - Rubros</title>
      <style>${_commonStyles(state.students.length)}</style></head><body>
      <div class="hdr">
        <h1>ESCUELA PREPARATORIA OFICIAL No. 67 — FORMATO BORRADOR DE CALIFICACIONES</h1>
        <div class="sub">CICLO ESCOLAR 2025-2026 · ${S(_semestreText(asg.grado))}</div>
        <div class="sub">${S(_gradoText(asg.grado))} · GRUPO ${S(_grupoNumText(asg.groupName))} · TURNO ${S(asg.turno)} · ${S(K.getUACNombre(asg.subjectName))}</div>
      </div>
      <div class="meta">
        <div><b>Profesor(a):</b> ${S(meta.teacherDisplay)}</div>
        <div><b>Orientador(a):</b> ${S(meta.orientador)}</div>
        <div><b>Total:</b> H ${meta.counts.h} · M ${meta.counts.m} · T ${meta.counts.t}</div>
      </div>
      <table class="lt">
        ${colgroup}
        <thead>
          <tr>
            <th>#</th>
            <th>Folio</th>
            <th style="text-align:left;">NOMBRE COMPLETO</th>
            ${rubroHeaders}
            <th>FALTAS</th>
            <th>SUMA</th>
            <th>CAL</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="firmas">
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Profesor(a)</div>
          <div class="name">${S(meta.teacherDisplay)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Orientador(a)</div>
          <div class="name">${S(meta.orientador)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">V°B° Subdirección</div>
          <div class="name">${S(meta.subdir)}</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Dirección Escolar</div>
          <div class="name">${S(meta.directora)}</div>
        </div>
      </div>
      <div class="legal">
        ⚠ FORMATO BORRADOR — Las calificaciones son OFICIALES sí y solo sí están capturadas en la plataforma del Sistema Escolar EPO 67.
      </div>
      <script>setTimeout(()=>window.print(),400)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('Tu navegador bloqueó la ventana de impresión.', 'warning'); return; }
    w.document.write(html); w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // EXCEL — mismo formato que PDF, sin colores, solo bordes y datos.
  // Usa ExcelJS para tener control sobre bordes y anchos de columna.
  // ═══════════════════════════════════════════════════════════════
  async function _buildExcelWorkbook(formatType) {
    if (typeof Lib === 'undefined' || !Lib.exceljs) {
      throw new Error('Libreria ExcelJS no disponible');
    }
    await Lib.exceljs();

    const meta = _commonHeader();
    const asg = state.selected;
    const isVesp = String(asg.turno || '').toUpperCase() === 'VESPERTINO';

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(asg.groupName, {
      pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
    });

    const isAnot = formatType === 'anotaciones';
    const blankCount = isAnot ? 15 : 0;
    const rubrosCols = isVesp
      ? [{ label: 'EVALUACIÓN CONTINUA', max: 5 }, { label: 'TRANSVERSAL', max: 2 }, { label: 'EXAMEN PARCIAL', max: 3 }, { label: 'PUNTO EXTRA', max: null }]
      : [{ label: 'EVALUACIÓN CONTINUA', max: 8 }, { label: 'TRANSVERSAL', max: 2 }, { label: 'PUNTO EXTRA', max: null }];
    const rubroCount = isAnot ? 0 : rubrosCols.length + 3; // + FALTAS, SUMA, CAL

    // Total cols: # + Folio + Nombre + (blanks o rubros)
    const totalCols = 3 + (isAnot ? blankCount : rubroCount);

    // Border thin negro (sin colores, todo simple)
    const thinBorder = { style: 'thin', color: { argb: 'FF000000' } };
    const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

    // ─── ENCABEZADO (3 filas, sin color de fondo) ───
    ws.mergeCells(1, 1, 1, totalCols);
    ws.getCell(1, 1).value = 'ESCUELA PREPARATORIA OFICIAL No. 67';
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };

    ws.mergeCells(2, 1, 2, totalCols);
    ws.getCell(2, 1).value = `CICLO ESCOLAR 2025-2026 · ${_semestreText(asg.grado)}`;
    ws.getCell(2, 1).font = { size: 10 };
    ws.getCell(2, 1).alignment = { horizontal: 'center' };

    ws.mergeCells(3, 1, 3, totalCols);
    ws.getCell(3, 1).value = `${_gradoText(asg.grado)} · GRUPO ${_grupoNumText(asg.groupName)} · TURNO ${asg.turno} · ${K.getUACNombre(asg.subjectName)}${isAnot ? '' : ' (FORMATO BORRADOR)'}`;
    ws.getCell(3, 1).font = { size: 10, bold: true };
    ws.getCell(3, 1).alignment = { horizontal: 'center' };

    // ─── INFO MAESTRO/ORIENTADOR ───
    ws.getCell(4, 1).value = 'Profesor(a):';
    ws.getCell(4, 1).font = { bold: true, size: 9 };
    ws.getCell(4, 2).value = meta.teacherDisplay;
    ws.getCell(4, 2).font = { size: 9 };

    const orientadorCol = Math.min(5, totalCols);
    ws.getCell(4, orientadorCol).value = 'Orientador(a):';
    ws.getCell(4, orientadorCol).font = { bold: true, size: 9 };
    ws.getCell(4, orientadorCol + 1).value = meta.orientador || '';
    ws.getCell(4, orientadorCol + 1).font = { size: 9 };

    const totalCol = Math.min(totalCols - 2, totalCols);
    ws.getCell(4, totalCol).value = `H ${meta.counts.h} · M ${meta.counts.m} · T ${meta.counts.t}`;
    ws.getCell(4, totalCol).font = { bold: true, size: 9 };

    // ─── HEADERS de la tabla (fila 6) ───
    const headerRow = 6;
    const headers = ['#', 'Folio', 'NOMBRE COMPLETO'];
    if (isAnot) {
      // 15 columnas en blanco con encabezado vacío
      for (let i = 0; i < blankCount; i++) headers.push('');
    } else {
      rubrosCols.forEach(r => headers.push(`${r.label}${r.max ? ' (máx ' + r.max + ')' : ' (extra)'}`));
      headers.push('FALTAS', 'SUMA', 'CAL');
    }

    headers.forEach((h, idx) => {
      const cell = ws.getCell(headerRow, idx + 1);
      cell.value = h;
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = allBorders;
      // Sin fill (sin color de fondo)
    });

    // ─── DATOS DE ALUMNOS ───
    state.students.forEach((s, i) => {
      const row = headerRow + 1 + i;
      const fullName = Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto;
      ws.getCell(row, 1).value = i + 1;
      ws.getCell(row, 2).value = s.folio || '';
      ws.getCell(row, 3).value = fullName;

      ws.getCell(row, 1).alignment = { horizontal: 'center' };
      ws.getCell(row, 2).alignment = { horizontal: 'center' };
      ws.getCell(row, 1).font = { size: 9 };
      ws.getCell(row, 2).font = { size: 9 };
      ws.getCell(row, 3).font = { size: 9 };

      // Bordes en todas las celdas (incluyendo en blanco)
      for (let c = 1; c <= totalCols; c++) {
        ws.getCell(row, c).border = allBorders;
      }
    });

    // ─── ANCHOS DE COLUMNA ───
    ws.getColumn(1).width = 4;   // #
    ws.getColumn(2).width = 10;  // Folio
    ws.getColumn(3).width = 32;  // Nombre completo

    if (isAnot) {
      // 15 columnas en blanco, ancho equilibrado
      for (let c = 4; c <= totalCols; c++) ws.getColumn(c).width = 5;
    } else {
      // Rubros: 6 wide, FALTAS/SUMA/CAL: 8
      for (let c = 4; c <= 3 + rubrosCols.length; c++) ws.getColumn(c).width = 7;
      for (let c = 4 + rubrosCols.length; c <= totalCols; c++) ws.getColumn(c).width = 8;
    }

    // ─── PIE: firmas y banner legal ───
    const footerRow = headerRow + 1 + state.students.length + 2;
    const firmas = ['Profesor(a)', 'Orientador(a)', 'V°B° Subdirección', 'Dirección Escolar'];
    const firmaNames = [meta.teacherDisplay, meta.orientador || '', meta.subdir || '', meta.directora || ''];
    const colsPerFirma = Math.floor(totalCols / 4);
    firmas.forEach((label, i) => {
      const startCol = i * colsPerFirma + 1;
      ws.mergeCells(footerRow, startCol, footerRow, startCol + colsPerFirma - 1);
      ws.getCell(footerRow, startCol).value = '';
      ws.getCell(footerRow, startCol).border = { bottom: thinBorder };

      ws.mergeCells(footerRow + 1, startCol, footerRow + 1, startCol + colsPerFirma - 1);
      ws.getCell(footerRow + 1, startCol).value = label;
      ws.getCell(footerRow + 1, startCol).font = { bold: true, size: 8 };
      ws.getCell(footerRow + 1, startCol).alignment = { horizontal: 'center' };

      ws.mergeCells(footerRow + 2, startCol, footerRow + 2, startCol + colsPerFirma - 1);
      ws.getCell(footerRow + 2, startCol).value = firmaNames[i];
      ws.getCell(footerRow + 2, startCol).font = { size: 8 };
      ws.getCell(footerRow + 2, startCol).alignment = { horizontal: 'center' };
    });

    // Banner legal abajo
    const legalRow = footerRow + 4;
    ws.mergeCells(legalRow, 1, legalRow, totalCols);
    const legalText = isAnot
      ? '⚠ Las calificaciones son OFICIALES sí y solo sí están capturadas en la plataforma del Sistema Escolar EPO 67.'
      : '⚠ FORMATO BORRADOR — Las calificaciones son OFICIALES sí y solo sí están capturadas en la plataforma del Sistema Escolar EPO 67.';
    ws.getCell(legalRow, 1).value = legalText;
    ws.getCell(legalRow, 1).font = { bold: true, size: 9 };
    ws.getCell(legalRow, 1).alignment = { horizontal: 'center', wrapText: true };

    return wb;
  }

  function _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  async function exportExcelAnotaciones() {
    if (!state.students.length) { Toast.show('No hay alumnos', 'warning'); return; }
    try {
      const wb = await _buildExcelWorkbook('anotaciones');
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fname = `Lista_Anotaciones_${state.selected.groupName}_${(state.selected.subjectName || '').replace(/\s+/g, '_').slice(0, 25)}.xlsx`;
      _downloadBlob(blob, fname);
      Toast.show('Excel descargado', 'success');
    } catch (e) {
      Toast.show('Error al exportar: ' + e.message, 'error');
    }
  }

  async function exportExcelRubros() {
    if (!state.students.length) { Toast.show('No hay alumnos', 'warning'); return; }
    try {
      const wb = await _buildExcelWorkbook('rubros');
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fname = `Lista_Rubros_${state.selected.groupName}_${(state.selected.subjectName || '').replace(/\s+/g, '_').slice(0, 25)}.xlsx`;
      _downloadBlob(blob, fname);
      Toast.show('Excel descargado', 'success');
    } catch (e) {
      Toast.show('Error al exportar: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENTOS
  // ═══════════════════════════════════════════════════════════════
  let _eventsBound = false;
  function _bindGlobalEvents() {
    if (_eventsBound) return;
    _eventsBound = true;

    document.getElementById('moduleContainer')?.addEventListener('change', (e) => {
      if (e.target.id === 'ml-asg') {
        _selectAssignment(e.target.value);
      }
    });

    document.getElementById('moduleContainer')?.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'ml-print-anotaciones') printListAnotaciones();
      else if (action === 'ml-print-rubros') printListRubros();
      else if (action === 'ml-excel-anotaciones') exportExcelAnotaciones();
      else if (action === 'ml-excel-rubros') exportExcelRubros();
    });
  }

  return { render };
})();

Router.modules['my-lists'] = () => MyListsModule.render();
