/**
 * HONOR ROLL MODULE
 * Top students by group and shift, with filters and print-ready view
 */

const HonorRollModule = (() => {
  let groups = [];
  let students = [];

  /**
   * Asigna ranking denso: alumnos con el mismo promedio comparten lugar,
   * y el siguiente promedio distinto avanza un solo número.
   * Ej: 10.0, 10.0, 10.0, 9.8, 9.5  →  1, 1, 1, 2, 3
   *
   * IMPORTANTE: compara al mismo nivel de precisión que se muestra al usuario.
   * Ej: 9.83 y 9.77 se muestran como "9.8" con decimals=1 → deben compartir lugar.
   *
   * @param {Array} arr - previamente ordenado desc por promedio
   * @param {number} decimals - precisión de comparación (1 = 9.8, 2 = 9.83)
   */
  function assignDenseRanks(arr, decimals = 2) {
    const factor = Math.pow(10, decimals);
    let currentRank = 0;
    let lastKey = null;
    return arr.map(s => {
      const key = Math.round(s.promedio * factor) / factor;
      if (key !== lastKey) {
        currentRank++;
        lastKey = key;
      }
      return { ...s, rank: currentRank };
    });
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    const turnoOptions = K.TURNOS.map(t => `<option value="${t}">${t}</option>`).join('');
    const gradoOptions = K.GRADOS.map(g => `<option value="${g}">${g}\u00ba Grado</option>`).join('');
    const parcialOptions = K.PARCIALES.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Cuadros de Honor</h1>
            <p class="module-subtitle">Mejores promedios por grupo, turno y parcial</p>
          </div>
        </div>

        <div class="card filter-bar">
          <div class="filter-bar-grid">
            <div class="form-group">
              <label for="hr-turno">Turno</label>
              <select id="hr-turno">
                <option value="">Todos los turnos</option>
                ${turnoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="hr-grado">Grado</label>
              <select id="hr-grado">
                <option value="">Todos los grados</option>
                ${gradoOptions}
              </select>
            </div>
            <div class="form-group">
              <label for="hr-partial">Parcial</label>
              <select id="hr-partial">${parcialOptions}</select>
            </div>
            <div class="form-group">
              <label for="hr-top">Cantidad</label>
              <select id="hr-top">
                <option value="5">Top 5</option>
                <option value="10" selected>Top 10</option>
                <option value="15">Top 15</option>
                <option value="20">Top 20</option>
              </select>
            </div>
          </div>
          <div class="filter-bar-actions">
            <button class="btn btn-primary" data-action="generate">Generar</button>
            <button class="btn btn-outline" data-action="print"><span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">print</span>Imprimir</button>
            <button class="btn btn-success" data-action="mass-print"><span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">file_download</span>Masiva por Grupo</button>
          </div>
        </div>

        <div id="hr-results">
          <div class="empty-state">
            <span class="material-icons-round empty-state-icon">emoji_events</span>
            <p class="empty-state-text">Selecciona los filtros y haz clic en Generar</p>
          </div>
        </div>
      </div>
    `;

    await loadData();
    bindEvents(container);
  }

  async function loadData() {
    try {
      const [groupsSnap, studentsSnap] = await Promise.all([
        Store.getGroups(),
        Store.getStudents()
      ]);
      groups = groupsSnap;
      students = studentsSnap.filter(s => s.estatus === 'ACTIVO');
    } catch (e) {
      console.error('Error cargando datos para cuadros de honor:', e);
      Toast.show('Error al cargar datos', 'error');
    }
  }

  async function generate() {
    const turno = document.getElementById('hr-turno').value;
    const grado = document.getElementById('hr-grado').value;
    const partial = document.getElementById('hr-partial').value;
    const topCount = parseInt(document.getElementById('hr-top').value);
    const resultsDiv = document.getElementById('hr-results');

    resultsDiv.innerHTML = `<div class="loading-state"><span class="material-icons-round loading-spinner">autorenew</span><p>Calculando promedios...</p></div>`;

    try {
      let filtered = [...students];
      if (turno) filtered = filtered.filter(s => s.turno === turno);
      if (grado) filtered = filtered.filter(s => s.grado === parseInt(grado));

      if (filtered.length === 0) {
        resultsDiv.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">search_off</span><p class="empty-state-text">No hay estudiantes que coincidan con los filtros seleccionados.</p></div>`;
        return;
      }

      // Get grades via Store cache (per-group), filtered to relevant groups only
      const relevantGroupIds = [...new Set(filtered.map(s => s.groupId).filter(Boolean))];
      const allGrades = await Store.getGradesByGroups(relevantGroupIds, true);

      const gradesByStudent = {};
      for (const g of allGrades) {
        if (g.partial !== partial) continue;
        if (!gradesByStudent[g.studentId]) gradesByStudent[g.studentId] = [];
        gradesByStudent[g.studentId].push(g.value || 0);
      }

      const studentAverages = filtered.map(s => {
        const grades = gradesByStudent[s.id] || [];
        const avg = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : 0;
        return { ...s, promedio: Math.round(avg * 100) / 100, numMaterias: grades.length };
      }).filter(s => s.numMaterias > 0).sort((a, b) => b.promedio - a.promedio);

      if (studentAverages.length === 0) {
        resultsDiv.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <span class="material-icons-round empty-state-icon">school</span>
              <p class="empty-state-text">No hay calificaciones capturadas para el parcial seleccionado.</p>
            </div>
          </div>
        `;
        return;
      }

      // Group by turno + grupo
      const byGroup = {};
      studentAverages.forEach(s => {
        const key = `${s.turno}_${s.grupo}`;
        if (!byGroup[key]) {
          byGroup[key] = { turno: s.turno, grupo: s.grupo, grado: s.grado, students: [] };
        }
        byGroup[key].students.push(s);
      });

      Object.values(byGroup).forEach(g => {
        g.students.sort((a, b) => b.promedio - a.promedio);
        // Ranking denso a 1 decimal (coincide con la visualización .toFixed(1))
        g.students = assignDenseRanks(g.students, 1).filter(s => s.rank <= topCount);
      });

      const sortedGroups = Object.values(byGroup).sort((a, b) => {
        if (a.turno !== b.turno) return a.turno.localeCompare(b.turno);
        return a.grupo.localeCompare(b.grupo);
      });

      const partialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;
      const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

      let html = `<h2 class="section-title">Cuadro de Honor - ${Utils.sanitize(partialLabel)}</h2>`;
      html += '<div class="stats-grid">';

      for (const group of sortedGroups) {
        const rows = group.students.map((s) => {
          const medalOrRank = s.rank <= 3 ? medals[s.rank - 1] : `<span class="text-muted font-bold">${s.rank}</span>`;
          const gradeStyle = s.promedio >= 9 ? 'background:#1b5e20;color:#fff;' : s.promedio >= 8 ? 'background:#1b3a5c;color:#fff;' : 'background:#6b7280;color:#fff;';

          return `
            <tr${s.rank <= 3 ? ' class="font-semibold"' : ''}>
              <td class="text-center">${medalOrRank}</td>
              <td>${Utils.sanitize(s.nombreCompleto)}</td>
              <td class="text-center text-muted">${s.numMaterias}</td>
              <td class="text-center"><span style="display:inline-block;padding:4px 12px;border-radius:6px;font-weight:700;font-size:14px;${gradeStyle}">${s.promedio.toFixed(1)}</span></td>
            </tr>
          `;
        }).join('');

        const turnoClass = group.turno === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';

        html += `
          <div class="honor-card">
            <div class="honor-card-header">
              <h3 class="honor-card-title">\uD83C\uDFC6 Grupo ${Utils.sanitize(group.grupo)}</h3>
              <span class="badge ${turnoClass}">${Utils.sanitize(group.turno)}</span>
            </div>
            <table class="table-light w-full">
              <thead>
                <tr>
                  <th class="text-center">#</th>
                  <th>Alumno</th>
                  <th class="text-center">Mat.</th>
                  <th class="text-center">Promedio</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      }

      html += '</div>';

      // ── TOP 3 INSTITUCIONAL POR TURNO (ranking denso, empates comparten lugar) ──
      const turnos = [...new Set(studentAverages.map(s => s.turno))].sort();
      html += '<h2 class="section-title" style="margin-top:24px;">Top 3 Institucional por Turno</h2>';
      for (const t of turnos) {
        // Top 3 institucional a 2 decimales (coincide con .toFixed(2))
        const ranked = assignDenseRanks(studentAverages.filter(s => s.turno === t), 2);
        const top3 = ranked.filter(s => s.rank <= 3);
        if (top3.length === 0) continue;
        const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
        const rows10 = top3.map((s) => {
          const medal = s.rank <= 3 ? `<span style="font-size:20px;">${medals[s.rank - 1]}</span>` : `<strong>${s.rank}</strong>`;
          const gradeStyle = s.promedio >= 9 ? 'background:#1b5e20;color:#fff;' : s.promedio >= 8 ? 'background:#1b3a5c;color:#fff;' : 'background:#6b7280;color:#fff;';
          return `<tr style="font-size:15px;${s.rank <= 3 ? 'font-weight:700;' : ''}">
            <td style="text-align:center;width:50px;">${medal}</td>
            <td>${Utils.sanitize(s.nombreCompleto)}</td>
            <td style="text-align:center;">${Utils.sanitize(s.grupo)}</td>
            <td style="text-align:center;">${s.numMaterias}</td>
            <td style="text-align:center;"><span style="display:inline-block;padding:6px 16px;border-radius:8px;font-weight:800;font-size:16px;${gradeStyle}">${s.promedio.toFixed(2)}</span></td>
          </tr>`;
        }).join('');
        const tClass = t === 'MATUTINO' ? 'badge-matutino' : 'badge-vespertino';
        html += `
          <div class="card" style="margin-bottom:16px;border:2px solid #1b3a5c;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
              <span style="font-size:28px;">&#127942;</span>
              <h3 class="section-title" style="margin:0;">TOP 3 INSTITUCIONAL</h3>
              <span class="badge ${tClass}" style="font-size:13px;">${Utils.sanitize(t)}</span>
            </div>
            <table class="table-light">
              <thead><tr>
                <th style="text-align:center;width:50px;">Lugar</th>
                <th>Alumno</th>
                <th style="text-align:center;">Grupo</th>
                <th style="text-align:center;">Mat.</th>
                <th style="text-align:center;">Promedio</th>
              </tr></thead>
              <tbody>${rows10}</tbody>
            </table>
          </div>`;
      }

      resultsDiv.innerHTML = html;
    } catch (e) {
      console.error('Error generando cuadro de honor:', e);
      resultsDiv.innerHTML = `<div class="error-state"><span class="material-icons-round">error</span><p>${Utils.sanitize(e.message)}</p></div>`;
      Toast.show('Error al generar cuadro de honor', 'error');
    }
  }

  function printHonorRoll() {
    const results = document.getElementById('hr-results');
    if (!results || results.querySelector('.empty-state')) {
      Toast.show('Genera primero los cuadros de honor', 'warning');
      return;
    }

    const turno = document.getElementById('hr-turno').value;
    const grado = document.getElementById('hr-grado').value;
    const partial = document.getElementById('hr-partial').value;
    const partialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;
    const turnoLabel = turno || 'AMBOS TURNOS';
    const gradoLabel = grado ? `${grado}\u00ba GRADO` : 'TODOS LOS GRADOS';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
      <title>Cuadro de Honor EPO 67</title>
      <style>
        @page { size: letter portrait; margin: 14mm 16mm; }
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #000; }
        -webkit-print-color-adjust: exact; print-color-adjust: exact;

        .header { text-align:center; margin-bottom:16px; }
        .header h1 { font-size:16pt; font-weight:700; margin-bottom:4px; }
        .header h2 { font-size:14pt; font-weight:700; margin-bottom:4px; }
        .header .info { font-size:12pt; color:#333; margin-bottom:4px; }

        .group-card { page-break-inside:avoid; margin-bottom:20px; border:2px solid #1b3a5c; border-radius:8px; overflow:hidden; }
        .group-header { background:#1b3a5c; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;
          -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        .group-header h3 { font-size:14pt; font-weight:700; }
        .group-header .turno { font-size:11pt; background:rgba(255,255,255,.2); padding:3px 10px; border-radius:4px; }

        table { width:100%; border-collapse:collapse; }
        th { background:#e8ecf1; padding:8px 12px; text-align:left; font-size:11pt; font-weight:700; color:#1b3a5c; border-bottom:2px solid #1b3a5c;
          -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        td { padding:8px 12px; font-size:12pt; border-bottom:1px solid #ddd; }
        tr:nth-child(even) { background:#f7f9fb; -webkit-print-color-adjust:exact; print-color-adjust:exact; }

        .rank { font-size:14pt; font-weight:800; text-align:center; width:40px; }
        .rank-1 { color:#d4782a; }
        .rank-2 { color:#1b3a5c; }
        .rank-3 { color:#6b7280; }
        .name { font-weight:600; }
        .top3 { font-weight:700; }
        .avg { font-size:13pt; font-weight:800; text-align:center; }
        .avg-high { color:#1b5e20; }
        .avg-good { color:#1b3a5c; }
        .avg-ok { color:#6b7280; }

        .medal { font-size:16pt; text-align:center; width:40px; }

        .footer { text-align:center; margin-top:20px; font-size:9pt; color:#888; }
      </style>
      </head><body>
        <div class="header">
          <h1>ESCUELA PREPARATORIA OFICIAL NUM. 67</h1>
          <h2>CUADRO DE HONOR</h2>
          <div class="info">${Utils.sanitize(partialLabel).toUpperCase()} &mdash; ${Utils.sanitize(turnoLabel)} &mdash; ${Utils.sanitize(gradoLabel)}</div>
          <div class="info" style="font-size:10pt;color:#666;">Ciclo Escolar 2025-2026</div>
        </div>
        ${results.innerHTML}
        <div class="footer">Generado por Sistema Escolar EPO 67 &mdash; ${new Date().toLocaleDateString('es-MX')}</div>
        <script>document.title=' ';setTimeout(()=>window.print(),500)<\/script>
      </body></html>`);
    printWindow.document.close();
  }

  let _massPrinting = false;
  async function massPrintHonorRoll() {
    if (_massPrinting) return;
    _massPrinting = true;

    const turno = document.getElementById('hr-turno').value;
    const partial = document.getElementById('hr-partial').value;
    const topCount = parseInt(document.getElementById('hr-top').value);

    if (!turno) { Toast.show('Selecciona un turno', 'warning'); _massPrinting = false; return; }

    const partialLabel = K.PARCIALES.find(p => p.id === partial)?.nombre || partial;
    // Medallas como caracteres reales (surrogate pairs)
    const TROFEO = '\uD83C\uDFC6';  // 🏆
    const MEDAL1 = '\uD83E\uDD47';  // 🥇
    const MEDAL2 = '\uD83E\uDD48';  // 🥈
    const MEDAL3 = '\uD83E\uDD49';  // 🥉

    try {
      const filtered = students.filter(s => s.turno === turno);
      const relevantGroupIds = [...new Set(filtered.map(s => s.groupId).filter(Boolean))];
      const allGrades = await Store.getGradesByGroups(relevantGroupIds, true);

      const gradesByStudent = {};
      for (const g of allGrades) {
        if (g.partial !== partial) continue;
        if (!gradesByStudent[g.studentId]) gradesByStudent[g.studentId] = [];
        gradesByStudent[g.studentId].push(g.value || 0);
      }

      const studentAverages = filtered.map(s => {
        const grades = gradesByStudent[s.id] || [];
        const avg = grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : 0;
        return { ...s, promedio: Math.round(avg * 100) / 100, numMaterias: grades.length };
      }).filter(s => s.numMaterias > 0).sort((a, b) => b.promedio - a.promedio);

      // Group by grupo
      const byGroup = {};
      studentAverages.forEach(s => {
        const key = s.grupo;
        if (!byGroup[key]) byGroup[key] = { turno: s.turno, grupo: s.grupo, grado: s.grado, students: [] };
        byGroup[key].students.push(s);
      });

      const sortedGroups = Object.values(byGroup).sort((a, b) => (a.grado || 0) - (b.grado || 0) || a.grupo.localeCompare(b.grupo));
      // Top 3 institucional: ranking denso a 2 decimales (la tabla muestra .toFixed(2))
      const rankedAll = assignDenseRanks(studentAverages, 2);
      const top3 = rankedAll.filter(s => s.rank <= 3);

      if (sortedGroups.length === 0) {
        Toast.show('No hay calificaciones capturadas para este turno y parcial', 'warning');
        _massPrinting = false;
        return;
      }

      Toast.show('Generando documento con ' + sortedGroups.length + ' cuadros de honor + Top 3...', 'info');

      // Build single HTML document with all groups + top 5
      let allPagesHtml = '';

      // One page per group
      sortedGroups.forEach((group, idx) => {
        const sorted = group.students.sort((a, b) => b.promedio - a.promedio);
        // Ranking denso a 1 decimal (la tabla muestra .toFixed(1))
        const top = assignDenseRanks(sorted, 1).filter(s => s.rank <= topCount);
        const medalImgs = [MEDAL1, MEDAL2, MEDAL3];
        const rows = top.map((s) => {
          const medal = s.rank <= 3 ? `<span class="medal">${medalImgs[s.rank - 1]}</span>` : `<strong>${s.rank}</strong>`;
          const avgClass = s.promedio >= 9 ? 'avg-high' : s.promedio >= 8 ? 'avg-good' : 'avg-ok';
          return `<tr${s.rank <= 3 ? ' class="top3"' : ''}>
            <td class="rank">${medal}</td>
            <td class="name">${Utils.sanitize(s.nombreCompleto)}</td>
            <td class="mat">${s.numMaterias}</td>
            <td><span class="avg ${avgClass}">${s.promedio.toFixed(1)}</span></td>
          </tr>`;
        }).join('');

        allPagesHtml += `
          <section class="page">
            <div class="hdr">
              <h1>ESCUELA PREPARATORIA OFICIAL NUM. 67</h1>
              <h2>CUADRO DE HONOR</h2>
              <div class="info">${Utils.sanitize(partialLabel).toUpperCase()} &mdash; TURNO ${Utils.sanitize(turno)}</div>
              <div class="info subtle">Ciclo Escolar 2025-2026</div>
            </div>
            <div class="group-card">
              <div class="group-header">
                <span>${TROFEO} GRUPO ${Utils.sanitize(group.grupo)}</span>
                <span class="badge-g">${group.grado}&ordm; GRADO</span>
              </div>
              <table>
                <thead>
                  <tr><th style="width:50px;">#</th><th>Alumno</th><th style="width:60px;text-align:center;">Mat.</th><th style="width:90px;text-align:center;">Promedio</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>`;
      });

      // Top 3 Institucional — ranking denso: empates comparten lugar
      const top3Rows = top3.map((s) => {
        const medals = [MEDAL1, MEDAL2, MEDAL3];
        const medal = `<span class="t5-medal">${medals[s.rank - 1]}</span>`;
        return `<tr>
          <td class="t5-rank">${medal}</td>
          <td class="t5-name">${Utils.sanitize(s.nombreCompleto)}</td>
          <td class="t5-group">${Utils.sanitize(s.grupo)}</td>
          <td class="t5-avg"><span class="t5-avg-badge">${s.promedio.toFixed(2)}</span></td>
        </tr>`;
      }).join('');

      allPagesHtml += `
        <section class="page t5-page">
          <div class="t5-ornament"></div>
          <div class="t5-head">
            <div class="t5-school">ESCUELA PREPARATORIA OFICIAL NUM. 67</div>
            <div class="t5-trophy">${TROFEO}</div>
            <h1 class="t5-title">TOP 3 INSTITUCIONAL</h1>
            <div class="t5-subtitle">Excelencia Acad&eacute;mica &mdash; Turno ${Utils.sanitize(turno)}</div>
            <div class="t5-partial">${Utils.sanitize(partialLabel).toUpperCase()}</div>
            <div class="t5-cycle">Ciclo Escolar 2025-2026</div>
          </div>
          <table class="t5-table">
            <thead>
              <tr>
                <th style="width:60px;">Lugar</th>
                <th>Alumno</th>
                <th style="width:90px;">Grupo</th>
                <th style="width:110px;">Promedio</th>
              </tr>
            </thead>
            <tbody>${top3Rows}</tbody>
          </table>
          <div class="t5-footer">
            <div class="t5-signature">
              <div class="t5-sig-line"></div>
              <div>DIRECCI&Oacute;N ESCOLAR</div>
            </div>
          </div>
          <div class="t5-ornament bottom"></div>
        </section>`;

      const fullHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
        <title>Cuadros de Honor ${turno}</title>
        <style>
          @page { size: letter portrait; margin: 14mm 16mm; }
          * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; }

          .page { page-break-after: always; }
          .page:last-child { page-break-after: auto; }

          /* ─── GROUP PAGES ─── */
          .hdr { text-align:center; margin-bottom:20px; }
          .hdr h1 { font-size:18pt; font-weight:700; margin-bottom:6px; }
          .hdr h2 { font-size:16pt; font-weight:700; margin-bottom:8px; color:#1b3a5c; }
          .hdr .info { font-size:12pt; color:#333; margin-bottom:4px; }
          .hdr .subtle { font-size:10pt; color:#888; }

          .group-card { border:2px solid #1b3a5c; border-radius:10px; overflow:hidden; }
          .group-header { background:#1b3a5c; color:#fff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; font-size:15pt; font-weight:700; }
          .group-header .badge-g { background:rgba(255,255,255,.2); padding:4px 12px; border-radius:4px; font-size:12pt; }

          .group-card table { width:100%; border-collapse:collapse; }
          .group-card th { background:#e8ecf1; padding:10px 14px; text-align:left; font-size:12pt; font-weight:700; color:#1b3a5c; border-bottom:2px solid #1b3a5c; }
          .group-card td { padding:10px 14px; font-size:13pt; border-bottom:1px solid #ddd; }
          .group-card tr:nth-child(even) { background:#f7f9fb; }
          .group-card .top3 { font-weight:700; }
          .group-card .rank { text-align:center; font-size:14pt; }
          .group-card .medal { font-size:18pt; }
          .group-card .name { font-weight:600; }
          .group-card .mat { text-align:center; color:#666; }
          .group-card td .avg { display:inline-block; padding:4px 14px; border-radius:6px; font-weight:800; font-size:13pt; color:#fff; }
          .group-card td .avg-high { background:#1b5e20; }
          .group-card td .avg-good { background:#1b3a5c; }
          .group-card td .avg-ok { background:#6b7280; }

          /* ─── TOP 3 INSTITUCIONAL PAGE ─── */
          .t5-page { padding: 10px; }

          .t5-ornament { height: 6px; background: linear-gradient(90deg, transparent, #d4782a 20%, #1b3a5c 50%, #d4782a 80%, transparent); border-radius:3px; margin: 0 0 24px 0; }
          .t5-ornament.bottom { margin: 30px 0 0 0; }

          .t5-head { text-align:center; margin-bottom:28px; }
          .t5-school { font-size:13pt; font-weight:700; color:#1b3a5c; letter-spacing:1px; margin-bottom:14px; }
          .t5-trophy { font-size:54pt; line-height:1; margin:6px 0; }
          .t5-title { font-size:28pt; font-weight:900; color:#1b3a5c; letter-spacing:2px; margin:8px 0; }
          .t5-subtitle { font-size:13pt; color:#d4782a; font-weight:600; font-style:italic; margin-bottom:10px; }
          .t5-partial { font-size:12pt; color:#333; font-weight:600; letter-spacing:1px; }
          .t5-cycle { font-size:10pt; color:#888; margin-top:4px; }

          .t5-table { width:100%; border-collapse:separate; border-spacing:0 5px; margin:16px 0; }
          .t5-table th { background:#1b3a5c; color:#fff; padding:10px 14px; font-size:11pt; text-align:center; font-weight:700; letter-spacing:1px; text-transform:uppercase; }
          .t5-table th:nth-child(2) { text-align:left; }
          .t5-table th:first-child { border-radius:8px 0 0 8px; }
          .t5-table th:last-child { border-radius:0 8px 8px 0; }

          .t5-table td { background:#fff; padding:10px 14px; font-size:12pt; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; }
          .t5-table td:first-child { border-left:1px solid #e2e8f0; border-radius:8px 0 0 8px; text-align:center; }
          .t5-table td:last-child { border-right:1px solid #e2e8f0; border-radius:0 8px 8px 0; text-align:center; }

          .t5-rank { font-size:18pt; }
          .t5-medal { font-size:22pt; line-height:1; }
          .t5-name { font-size:12pt; font-weight:700; color:#1b3a5c; }
          .t5-group { text-align:center; font-size:11pt; color:#64748b; font-weight:600; }

          .t5-avg-badge { display:inline-block; padding:6px 16px; background:#1b5e20; color:#fff; font-weight:800; font-size:13pt; border-radius:8px; letter-spacing:1px; }

          .t5-footer { text-align:center; margin-top:36px; }
          .t5-signature { display:inline-block; min-width:260px; }
          .t5-sig-line { border-bottom:1.5px solid #1b3a5c; height:40px; margin-bottom:6px; }
          .t5-signature div:last-child { font-weight:700; font-size:11pt; color:#1b3a5c; letter-spacing:1px; }
        </style>
      </head><body>
        ${allPagesHtml}
        <script>
          document.title = 'Cuadros_Honor_${turno}_${partial}';
          setTimeout(() => window.print(), 600);
        <\/script>
      </body></html>`;

      const w = window.open('', '_blank');
      w.document.write(fullHtml);
      w.document.close();

      Toast.show('Documento generado con ' + sortedGroups.length + ' grupos + Top 10 institucional. Guarda como PDF.', 'success');
    } catch (e) {
      console.error('Error:', e);
      Toast.show('Error: ' + e.message, 'error');
    }
    _massPrinting = false;
  }

  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'generate') generate();
      else if (btn.dataset.action === 'print') printHonorRoll();
      else if (btn.dataset.action === 'mass-print') massPrintHonorRoll();
    });
  }

  return { render };
})();

Router.modules['honor-roll'] = () => HonorRollModule.render();
