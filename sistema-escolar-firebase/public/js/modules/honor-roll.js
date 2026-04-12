/**
 * HONOR ROLL MODULE
 * Top students by group and shift, with filters and print-ready view
 */

const HonorRollModule = (() => {
  let groups = [];
  let students = [];

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
            <button class="btn btn-success" data-action="print">Imprimir</button>
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

      const gradesSnap = await db.collection('grades')
        .where('partial', '==', partial)
        .get();

      const gradesByStudent = {};
      gradesSnap.forEach(doc => {
        const g = doc.data();
        if (!gradesByStudent[g.studentId]) gradesByStudent[g.studentId] = [];
        gradesByStudent[g.studentId].push(g.value || 0);
      });

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
        g.students = g.students.slice(0, topCount);
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
        const rows = group.students.map((s, i) => {
          const medalOrRank = i < 3 ? medals[i] : `<span class="text-muted font-bold">${i + 1}</span>`;
          const gradeClass = s.promedio >= 9 ? 'grade-badge--excellent' : s.promedio >= 8 ? 'grade-badge--good' : s.promedio >= 7 ? 'grade-badge--fair' : 'grade-badge--fail';

          return `
            <tr${i < 3 ? ' class="font-semibold"' : ''}>
              <td class="text-center">${medalOrRank}</td>
              <td>${Utils.sanitize(s.nombreCompleto)}</td>
              <td class="text-center text-muted">${s.numMaterias}</td>
              <td class="text-center"><span class="grade-badge ${gradeClass}">${s.promedio.toFixed(1)}</span></td>
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
    const filterDesc = `${turno || 'Todos los turnos'} - ${grado ? `Grado ${grado}` : 'Todos los grados'} - ${partialLabel}`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cuadro de Honor - EPO 67</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;padding:20px;color:#1f2937}h1{text-align:center;font-size:24px;margin-bottom:8px}
      .filter-info{text-align:center;font-size:13px;color:#6b7280;margin-bottom:20px}.honor-card{page-break-inside:avoid;margin-bottom:24px;border:1px solid #e5e7eb;padding:16px;border-radius:8px}
      table{width:100%;border-collapse:collapse}th{background:#f3f4f6;padding:8px;text-align:left;font-weight:600;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb}
      td{padding:8px;border-bottom:1px solid #f3f4f6}.school-footer{margin-top:30px;text-align:center;font-size:12px;color:#9ca3af}@media print{body{padding:0}}</style>
      </head><body><h1>ESCUELA PREPARATORIA OFICIAL NUM. 67</h1><p class="filter-info">Cuadro de Honor - ${Utils.sanitize(filterDesc)}</p>
      ${results.innerHTML}<div class="school-footer"><p>Generado por el Sistema Escolar EPO 67</p></div>
      <script>setTimeout(()=>window.print(),500)<\/script></body></html>`);
    printWindow.document.close();
  }

  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'generate') generate();
      else if (btn.dataset.action === 'print') printHonorRoll();
    });
  }

  return { render };
})();

Router.modules['honor-roll'] = () => HonorRollModule.render();
