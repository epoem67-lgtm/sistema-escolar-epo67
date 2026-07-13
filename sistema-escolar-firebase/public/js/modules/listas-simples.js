/**
 * LISTAS SIMPLES
 * Lista de nombres en orden alfabético por grupo, con N columnas en blanco
 * para que cada docente/directivo anote lo que necesite (asistencia,
 * observaciones, participación, etc.).
 *
 * Visible para TODOS los roles autenticados.
 *   - Maestro: solo puede seleccionar los grupos donde tiene asignación
 *     (limitado por firestore.rules: students requiere teacherHasGroup).
 *   - Resto (admin/orientador/directivo/subdirector/consulta/auditor/academia):
 *     puede seleccionar cualquier grupo de la escuela.
 */
const ListasSimplesModule = (() => {
  const S = t => Utils.sanitize(t || '');
  // state.selection = { label, mode, items: [{ group, students }] }
  const state = {
    groups: [],
    selection: null,
    blankCols: 15
  };

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `<div class="module-container"><div class="loading-state">
      <span class="material-icons-round loading-spinner">autorenew</span>
      <p>Cargando grupos...</p></div></div>`;

    try {
      state.groups = await _loadGroupsForUser();
    } catch (e) {
      container.innerHTML = `<div class="module-container"><div class="error-state">
        <span class="material-icons-round">error</span><p>${S(e.message)}</p></div></div>`;
      return;
    }

    if (!state.groups.length) {
      container.innerHTML = `<div class="module-container">
        <h1 class="module-title">Listas de seguimiento</h1>
        <div class="empty-state">
          <span class="material-icons-round empty-state-icon">folder_off</span>
          <p class="empty-state-text">No hay grupos disponibles para imprimir.</p>
        </div></div>`;
      return;
    }

    const optionsHtml = _buildOptionsHtml(state.groups);

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Listas de seguimiento</h1>
        <p class="module-subtitle">
          Lista de alumnos por grupo en orden alfabético, con columnas en blanco
          para que anotes lo que necesites (asistencia, participación, tareas…).
        </p>

        <div class="card" style="margin-bottom:16px;">
          <div style="display:grid;grid-template-columns:1fr 220px;gap:16px;align-items:end;">
            <div>
              <label style="font-size:14px;font-weight:700;color:#1e293b;display:block;margin-bottom:8px;">
                Grupo
              </label>
              <select id="ls-group" style="width:100%;padding:12px;font-size:15px;border:2px solid #cbd5e0;border-radius:8px;background:#fff;cursor:pointer;">
                <option value="">— Selecciona un grupo —</option>
                ${optionsHtml}
              </select>
            </div>
            <div>
              <label style="font-size:14px;font-weight:700;color:#1e293b;display:block;margin-bottom:8px;">
                Columnas en blanco
              </label>
              <input id="ls-blank-cols" type="number" min="1" max="30" step="1" value="${state.blankCols}"
                style="width:100%;padding:12px;font-size:15px;border:2px solid #cbd5e0;border-radius:8px;background:#fff;">
            </div>
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:8px;">
            💡 Sugerido: 15 columnas para pases de lista mensuales, 5 para observaciones.
          </div>
        </div>

        <div id="ls-detail"></div>
      </div>`;

    _bindEvents();
  }

  async function _loadGroupsForUser() {
    const role = App.currentUser?.role;
    const allGroups = await Store.getGroups();

    // Non-maestro roles ven todos los grupos (rules ya se los permiten).
    if (role !== 'maestro') return _sortGroups(allGroups);

    // Maestro: solo grupos donde tiene assignment.
    const asgs = (await Store.getMyAssignments()) || [];
    const groupIds = new Set(asgs.map(a => a.groupId));
    return _sortGroups(allGroups.filter(g => groupIds.has(g.id)));
  }

  function _sortGroups(list) {
    return [...list].sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') ||
      String(a.grado || '').localeCompare(String(b.grado || '')) ||
      (a.nombre || '').localeCompare(b.nombre || '')
    );
  }

  function _buildOptionsHtml(groups) {
    // Agrupar por turno para <optgroup>
    const byTurno = {};
    groups.forEach(g => {
      const t = g.turno || 'SIN TURNO';
      if (!byTurno[t]) byTurno[t] = [];
      byTurno[t].push(g);
    });

    // Opciones de "grado completo" — un grado × un turno, ordenadas
    const gradeOptions = [];
    Object.keys(byTurno).sort().forEach(turno => {
      const byGrado = {};
      byTurno[turno].forEach(g => {
        const gr = String(g.grado || '?');
        if (!byGrado[gr]) byGrado[gr] = [];
        byGrado[gr].push(g);
      });
      Object.keys(byGrado).sort().forEach(gr => {
        const count = byGrado[gr].length;
        if (count < 2) return; // si solo hay 1 grupo del grado, no tiene sentido "completo"
        gradeOptions.push(
          `<option value="grade:${S(gr)}:${S(turno)}">📚 ${S(gr)}° grado completo · ${S(turno)} · ${count} grupos</option>`
        );
      });
    });

    const gradeOptgroup = gradeOptions.length
      ? `<optgroup label="── GRADO COMPLETO ──">${gradeOptions.join('')}</optgroup>`
      : '';

    const groupOptgroups = Object.keys(byTurno).sort().map(turno => {
      const items = byTurno[turno].map(g =>
        `<option value="${S(g.id)}">${S(g.nombre)} · ${g.grado || '?'}° grado</option>`
      ).join('');
      return `<optgroup label="${S(turno)}">${items}</optgroup>`;
    }).join('');

    return gradeOptgroup + groupOptgroups;
  }

  async function _onSelectionChange(value) {
    if (!value) {
      state.selection = null;
      document.getElementById('ls-detail').innerHTML = '';
      return;
    }

    const root = document.getElementById('ls-detail');
    root.innerHTML = `<div class="card"><div class="loading-state">
      <span class="material-icons-round loading-spinner">autorenew</span>
      <p>Cargando alumnos...</p></div></div>`;

    // Determinar grupos a cargar según el modo
    let targetGroups = [];
    let label = '';
    let mode = 'single';

    if (value.startsWith('grade:')) {
      // grade:<grado>:<turno>
      const parts = value.split(':');
      const grado = parts[1];
      const turno = parts.slice(2).join(':');
      targetGroups = state.groups
        .filter(g => String(g.grado) === String(grado) && (g.turno || '') === turno)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      label = `${grado}° grado completo · ${turno}`;
      mode = 'grade';
    } else {
      const g = state.groups.find(x => x.id === value);
      if (!g) {
        state.selection = null;
        document.getElementById('ls-detail').innerHTML = '';
        return;
      }
      targetGroups = [g];
      label = `${g.nombre || ''} · ${g.grado || '?'}° · ${g.turno || ''}`;
      mode = 'single';
    }

    if (!targetGroups.length) {
      root.innerHTML = `<div class="card"><div class="empty-state">
        <span class="material-icons-round empty-state-icon">group_off</span>
        <p class="empty-state-text">No hay grupos que coincidan.</p></div></div>`;
      return;
    }

    // Cargar alumnos de cada grupo en paralelo
    try {
      const items = await Promise.all(targetGroups.map(async g => {
        const all = await Store.getStudentsByGroup(g.id);
        const students = (all || [])
          .filter(s => {
            const e = (s.estatus || '').toString().toUpperCase().trim();
            return e === '' || e === 'ACTIVO';
          })
          .map(s => ({
            ...s,
            _display: Utils.displayName(s.nombreCompleto || `${s.apellido1 || ''} ${s.apellido2 || ''} ${s.nombres || ''}`.trim())
          }))
          .sort((a, b) => (a._display || '').localeCompare(b._display || '', 'es'));
        return { group: g, students };
      }));
      state.selection = { label, mode, items };
    } catch (e) {
      root.innerHTML = `<div class="card"><div class="error-state">
        <span class="material-icons-round">error</span>
        <p>No se pudieron cargar alumnos: ${S(e.message)}</p></div></div>`;
      return;
    }

    const totalStudents = state.selection.items.reduce((n, it) => n + it.students.length, 0);
    if (totalStudents === 0) {
      root.innerHTML = `<div class="card"><div class="empty-state">
        <span class="material-icons-round empty-state-icon">group_off</span>
        <p class="empty-state-text">No hay alumnos activos.</p></div></div>`;
      return;
    }

    _renderDetail();
  }

  function _renderDetail() {
    const sel = state.selection;
    const totalStudents = sel.items.reduce((n, it) => n + it.students.length, 0);
    const groupCount = sel.items.length;

    // Preview: primeros 5 del PRIMER grupo (siempre)
    const first = sel.items[0];
    const previewRows = first.students.slice(0, 5).map((s, i) =>
      `<tr>
        <td style="text-align:center;padding:4px 8px;border-bottom:1px solid #e2e8f0;color:#64748b;">${i + 1}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;">${S(s._display)}</td>
      </tr>`).join('');

    // Resumen de grupos (si son >1)
    const groupSummary = groupCount > 1
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${
          sel.items.map(it => `<span style="background:#e0e7ff;color:#3730a3;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;">${S(it.group.nombre)} (${it.students.length})</span>`).join('')
        }</div>`
      : '';

    const filesText = groupCount > 1
      ? ` · <strong>${groupCount} listas</strong> en 1 archivo (una por página / hoja)`
      : '';

    document.getElementById('ls-detail').innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <div>
            <div style="font-size:18px;font-weight:700;color:#1e293b;">
              ${S(sel.label)}
            </div>
            <div style="font-size:13px;color:#64748b;margin-top:2px;">
              <strong>${totalStudents}</strong> alumnos activos${filesText}
            </div>
            ${groupSummary}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" data-action="ls-print" style="font-weight:600;padding:10px 18px;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">print</span>
              Imprimir PDF
            </button>
            <button class="btn btn-success" data-action="ls-excel" style="font-weight:600;padding:10px 18px;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">table_view</span>
              Descargar Excel
            </button>
          </div>
        </div>

        <div style="background:#f1f5f9;border-radius:6px;padding:10px 12px;font-size:12px;color:#475569;margin-bottom:12px;">
          <strong>Vista previa</strong> — primeros 5 nombres de ${S(first.group.nombre)}. El archivo trae los ${totalStudents} alumnos${groupCount > 1 ? ` de los ${groupCount} grupos` : ''}.
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8fafc;">
              <th style="padding:6px 8px;text-align:center;width:40px;border-bottom:2px solid #cbd5e0;">#</th>
              <th style="padding:6px 8px;text-align:left;border-bottom:2px solid #cbd5e0;">NOMBRE COMPLETO</th>
            </tr>
          </thead>
          <tbody>${previewRows}</tbody>
        </table>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // IMPRIMIR PDF (1 o N grupos, cada grupo en su propia página)
  // ═══════════════════════════════════════════════════════════════
  function printListPDF() {
    if (!state.selection || !state.selection.items.length) { Toast.show('No hay alumnos', 'warning'); return; }
    const blankCols = _readBlankCols();
    const blankHeaders = Array(blankCols).fill('<th></th>').join('');
    const nameColPct = Math.max(20, 55 - blankCols * 1.5).toFixed(1);
    const blankColPct = ((100 - 5 - Number(nameColPct)) / blankCols).toFixed(2);
    const colgroup = `
      <colgroup>
        <col style="width:5%;">
        <col style="width:${nameColPct}%;">
        ${Array(blankCols).fill(`<col style="width:${blankColPct}%;">`).join('')}
      </colgroup>`;

    const sections = state.selection.items.map((item, idx) => {
      const g = item.group;
      const students = item.students;
      const total = students.length;
      if (total === 0) return '';
      const h = students.filter(s => (s.sexo || '').toUpperCase().startsWith('H')).length;
      const m = students.filter(s => (s.sexo || '').toUpperCase().startsWith('M')).length;
      const rowFont = total > 45 ? 9 : (total > 35 ? 10 : 11);
      const rowPad = total > 45 ? 2 : (total > 35 ? 3 : 4);

      const rows = students.map((s, i) => {
        const blanks = Array(blankCols).fill('<td></td>').join('');
        return `<tr>
          <td class="num">${i + 1}</td>
          <td class="name">${S(s._display)}</td>
          ${blanks}
        </tr>`;
      }).join('');

      const pageBreakStyle = idx > 0 ? 'page-break-before: always;' : '';

      return `
      <section style="${pageBreakStyle}">
        <div class="hdr">
          <h1>ESCUELA PREPARATORIA OFICIAL No. 67</h1>
          <div class="sub">CICLO ESCOLAR 2025-2026 · GRUPO ${S(g.nombre)} · ${g.grado || '?'}° GRADO · TURNO ${S(g.turno || '')}</div>
        </div>
        <div class="meta">
          <div><b>Total:</b> ${total} · H ${h} · M ${m}</div>
          <div>Impreso: ${new Date().toLocaleDateString('es-MX')}</div>
        </div>
        <table class="lt" style="--font-size:${rowFont}px;--row-pad:${rowPad}px;">
          ${colgroup}
          <thead>
            <tr>
              <th>#</th>
              <th style="text-align:left;">NOMBRE COMPLETO</th>
              ${blankHeaders}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="foot">Lista de seguimiento — formato editable a mano.</div>
      </section>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Listas — ${S(state.selection.label)}</title>
      <style>
        @page { size: letter landscape; margin: 10mm 10mm 8mm 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #0f172a; margin: 0; }
        .hdr { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 8px; }
        .hdr h1 { font-size: 15px; margin: 0; font-weight: 800; color: #1e3a8a; letter-spacing: 0.5px; }
        .hdr .sub { font-size: 11px; color: #475569; margin-top: 2px; font-weight: 600; }
        .meta { display: flex; justify-content: space-between; font-size: 11px; color: #334155; margin-bottom: 6px; padding: 0 4px; }
        table.lt { width: 100%; border-collapse: collapse; }
        table.lt th, table.lt td { border: 1px solid #94a3b8; padding: var(--row-pad, 4px) 4px; }
        table.lt thead th { background: #1e3a8a; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; }
        table.lt tbody td { font-size: var(--font-size, 11px); }
        table.lt tbody td.num { text-align: center; color: #64748b; width: 5%; font-weight: 600; }
        table.lt tbody td.name { text-align: left; font-weight: 500; }
        table.lt tbody tr:nth-child(even) td { background: #f8fafc; }
        .foot { margin-top: 8px; font-size: 10px; color: #475569; text-align: right; }
      </style></head><body>
      ${sections}
      <script>setTimeout(()=>window.print(),400)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { Toast.show('Tu navegador bloqueó la ventana de impresión.', 'warning'); return; }
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // EXCEL (1 workbook, 1 hoja por grupo)
  // ═══════════════════════════════════════════════════════════════
  async function exportExcel() {
    if (!state.selection || !state.selection.items.length) { Toast.show('No hay alumnos', 'warning'); return; }

    try {
      // ExcelJS se carga bajo demanda (Lib.exceljs) — inyecta el script si falta.
      if (typeof Lib === 'undefined' || !Lib.exceljs) {
        throw new Error('Librería ExcelJS no disponible');
      }
      await Lib.exceljs();
      if (typeof ExcelJS === 'undefined') {
        throw new Error('ExcelJS no cargó');
      }

      const blankCols = _readBlankCols();
      const totalCols = 2 + blankCols;
      const thin = { style: 'thin', color: { argb: 'FF64748B' } };

      const wb = new ExcelJS.Workbook();
      wb.creator = 'EPO 67';
      wb.created = new Date();

      state.selection.items.forEach(item => {
        const g = item.group;
        const students = item.students;
        const total = students.length;
        const h = students.filter(s => (s.sexo || '').toUpperCase().startsWith('H')).length;
        const mm = students.filter(s => (s.sexo || '').toUpperCase().startsWith('M')).length;
        const sheetName = (g.nombre || 'Lista').replace(/[\/\\?*[\]]/g, '').slice(0, 31);

        const ws = wb.addWorksheet(sheetName, {
          pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
        });

        // Título
        ws.mergeCells(1, 1, 1, totalCols);
        const titleCell = ws.getCell(1, 1);
        titleCell.value = 'ESCUELA PREPARATORIA OFICIAL No. 67';
        titleCell.font = { bold: true, size: 13, color: { argb: 'FF1E3A8A' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(1).height = 22;

        // Subtítulo
        ws.mergeCells(2, 1, 2, totalCols);
        const subCell = ws.getCell(2, 1);
        subCell.value = `CICLO 2025-2026 · ${g.nombre || ''} · ${g.grado || '?'}° · TURNO ${g.turno || ''} · Total ${total} (H ${h} · M ${mm})`;
        subCell.font = { bold: true, size: 10, color: { argb: 'FF475569' } };
        subCell.alignment = { horizontal: 'center' };
        ws.getRow(2).height = 18;

        // Header
        const headerRowIdx = 4;
        const headerVals = ['#', 'NOMBRE COMPLETO', ...Array(blankCols).fill('')];
        headerVals.forEach((v, i) => {
          const c = ws.getCell(headerRowIdx, i + 1);
          c.value = v;
          c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
          c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle' };
          c.border = { top: thin, bottom: thin, left: thin, right: thin };
        });
        ws.getRow(headerRowIdx).height = 20;

        // Filas
        students.forEach((s, i) => {
          const rowIdx = headerRowIdx + 1 + i;
          const rowVals = [i + 1, s._display, ...Array(blankCols).fill('')];
          rowVals.forEach((v, ci) => {
            const c = ws.getCell(rowIdx, ci + 1);
            c.value = v;
            c.font = { size: 10 };
            c.alignment = { horizontal: ci === 1 ? 'left' : 'center', vertical: 'middle', wrapText: false };
            c.border = { top: thin, bottom: thin, left: thin, right: thin };
            if (i % 2 === 1) {
              c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            }
          });
          ws.getRow(rowIdx).height = 18;
        });

        // Anchos
        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 38;
        for (let i = 3; i <= totalCols; i++) ws.getColumn(i).width = 5;
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const safeLabel = (state.selection.label || 'lista').replace(/[^\w-]+/g, '_').slice(0, 50);
      const fname = `Lista_${safeLabel}.xlsx`;
      _downloadBlob(blob, fname);
      Toast.show('Excel descargado', 'success');
    } catch (e) {
      Toast.show('Error al exportar: ' + e.message, 'error');
    }
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

  function _readBlankCols() {
    const inp = document.getElementById('ls-blank-cols');
    const n = inp ? parseInt(inp.value, 10) : state.blankCols;
    if (isNaN(n) || n < 1) return 1;
    if (n > 30) return 30;
    return n;
  }

  function _bindEvents() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const sel = document.getElementById('ls-group');
    if (sel) sel.addEventListener('change', e => _onSelectionChange(e.target.value));

    container.addEventListener('click', e => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (action === 'ls-print') printListPDF();
      else if (action === 'ls-excel') exportExcel();
    });
  }

  return { render };
})();

Router.modules['listas-simples'] = () => ListasSimplesModule.render();
