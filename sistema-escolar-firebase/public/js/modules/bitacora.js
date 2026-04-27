/**
 * MÓDULO DE BITÁCORA — Sistema Escolar EPO 67
 *
 * Muestra el registro de auditoría completo del sistema.
 * Acceso: solo administradores.
 *
 * Funcionalidades:
 * - Vista cronológica de todas las acciones del sistema
 * - Filtros por: acción, entidad, usuario, fecha
 * - Detalle expandible con datos antes/después
 * - Exportación a Excel
 * - Indicador de alertas por correo
 */

const BitacoraModule = (function () {
  const CONTAINER = '#moduleContainer';
  const PAGE_SIZE = 50;

  let allLogs = [];
  let filteredLogs = [];
  let currentPage = 0;
  let filters = { action: '', entity: '', user: '', dateFrom: '', dateTo: '' };

  // ─── CONSTANTES ───
  const ACTION_LABELS = {
    'crear': { icon: 'add_circle', color: '#38a169', label: 'Crear' },
    'editar': { icon: 'edit', color: '#3182ce', label: 'Editar' },
    'eliminar': { icon: 'delete', color: '#e53e3e', label: 'Eliminar' },
    'login': { icon: 'login', color: '#805ad5', label: 'Inicio de sesión' },
    'logout': { icon: 'logout', color: '#718096', label: 'Cierre de sesión' },
    'crear_usuario': { icon: 'person_add', color: '#d69e2e', label: 'Crear usuario' },
    'editar_usuario': { icon: 'manage_accounts', color: '#dd6b20', label: 'Editar usuario' },
    'importar': { icon: 'upload_file', color: '#319795', label: 'Importar' },
    'cerrar_parcial': { icon: 'lock', color: '#e53e3e', label: 'Cerrar parcial' },
    'abrir_parcial': { icon: 'lock_open', color: '#38a169', label: 'Abrir parcial' },
    'delete_student': { icon: 'delete', color: '#e53e3e', label: 'Eliminar alumno (legacy)' }
  };

  const ENTITY_LABELS = {
    'alumno': 'Alumno',
    'docente': 'Docente',
    'calificacion': 'Calificación',
    'asignacion': 'Asignación',
    'usuario': 'Usuario',
    'incidencia': 'Incidencia',
    'parcial': 'Parcial',
    'configuracion': 'Configuración',
    'asistencia': 'Asistencia',
    'sesion': 'Sesión'
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;

    if (App.currentUser?.role !== 'admin') {
      container.innerHTML = `<div class="module-container">${UI.emptyState('block', 'Acceso solo para administradores')}</div>`;
      return;
    }

    container.innerHTML = `<div class="module-container">${UI.loadingState('Cargando bitácora...')}</div>`;

    try {
      // Load last 500 entries ordered by date
      const snap = await db.collection('activityLog')
        .orderBy('timestamp', 'desc')
        .limit(500)
        .get();

      allLogs = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          _date: d.timestamp?.toDate ? d.timestamp.toDate() : (d.date ? new Date(d.date) : new Date())
        };
      });

      renderUI();
    } catch (error) {
      console.error('Error loading bitácora:', error);
      container.innerHTML = `<div class="module-container">${UI.errorState('Error al cargar bitácora: ' + error.message)}</div>`;
    }
  }

  function renderUI() {
    const container = document.querySelector(CONTAINER);

    // Unique values for filters
    const actions = [...new Set(allLogs.map(l => l.action).filter(Boolean))].sort();
    const entities = [...new Set(allLogs.map(l => l.entity).filter(Boolean))].sort();
    const users = [...new Set(allLogs.map(l => l.userEmail).filter(Boolean))].sort();

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Bitácora del Sistema', 'Registro de todas las acciones realizadas en el sistema')}

        <!-- ═══ ESTADÍSTICAS RÁPIDAS ═══ -->
        <div class="stats-grid" style="margin-bottom:16px;" id="bitacora-stats"></div>

        <!-- ═══ FILTROS ═══ -->
        <div class="card" style="margin-bottom:16px;">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
            <div class="form-group">
              <label>Acción</label>
              <select id="bFilterAction">
                <option value="">Todas</option>
                ${actions.map(a => `<option value="${a}">${(ACTION_LABELS[a]?.label || a)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Entidad</label>
              <select id="bFilterEntity">
                <option value="">Todas</option>
                ${entities.map(e => `<option value="${e}">${ENTITY_LABELS[e] || e}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Usuario</label>
              <select id="bFilterUser">
                <option value="">Todos</option>
                ${users.map(u => `<option value="${u}">${Utils.sanitize(u)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Desde</label>
              <input type="date" id="bFilterFrom">
            </div>
            <div class="form-group">
              <label>Hasta</label>
              <input type="date" id="bFilterTo">
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="btn btn-outline btn-sm" id="bClearFilters">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">filter_list_off</span> Limpiar filtros
            </button>
            <button class="btn btn-outline btn-sm" id="bExportExcel">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">download</span> Exportar Excel
            </button>
          </div>
        </div>

        <!-- ═══ TABLA DE REGISTROS ═══ -->
        <div class="card" style="padding:0;">
          <div id="bitacora-table" style="overflow-x:auto;"></div>
          <div id="bitacora-pagination" style="padding:12px;text-align:center;"></div>
        </div>
      </div>`;

    // Bind filters
    ['bFilterAction', 'bFilterEntity', 'bFilterUser', 'bFilterFrom', 'bFilterTo'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        filters.action = document.getElementById('bFilterAction')?.value || '';
        filters.entity = document.getElementById('bFilterEntity')?.value || '';
        filters.user = document.getElementById('bFilterUser')?.value || '';
        filters.dateFrom = document.getElementById('bFilterFrom')?.value || '';
        filters.dateTo = document.getElementById('bFilterTo')?.value || '';
        currentPage = 0;
        applyFilters();
      });
    });

    document.getElementById('bClearFilters')?.addEventListener('click', () => {
      filters = { action: '', entity: '', user: '', dateFrom: '', dateTo: '' };
      ['bFilterAction', 'bFilterEntity', 'bFilterUser'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.getElementById('bFilterFrom').value = '';
      document.getElementById('bFilterTo').value = '';
      currentPage = 0;
      applyFilters();
    });

    document.getElementById('bExportExcel')?.addEventListener('click', exportToExcel);

    applyFilters();
  }

  function applyFilters() {
    filteredLogs = allLogs.filter(log => {
      if (filters.action && log.action !== filters.action) return false;
      if (filters.entity && log.entity !== filters.entity) return false;
      if (filters.user && log.userEmail !== filters.user) return false;
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        if (log._date < from) return false;
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        if (log._date > to) return false;
      }
      return true;
    });

    renderStats();
    renderTable();
    renderPagination();
  }

  function renderStats() {
    const container = document.getElementById('bitacora-stats');
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = filteredLogs.filter(l => l._date >= today);
    const deletes = filteredLogs.filter(l => l.action === 'eliminar').length;
    const logins = filteredLogs.filter(l => l.action === 'login').length;
    const uniqueUsers = new Set(filteredLogs.map(l => l.userEmail)).size;

    container.innerHTML = `
      <div class="stat-card--compact"><div class="stat-number">${filteredLogs.length}</div><div class="stat-label">Total registros</div></div>
      <div class="stat-card--compact stat-card--primary"><div class="stat-number">${todayLogs.length}</div><div class="stat-label">Hoy</div></div>
      <div class="stat-card--compact stat-card--danger"><div class="stat-number">${deletes}</div><div class="stat-label">Eliminaciones</div></div>
      <div class="stat-card--compact stat-card--success"><div class="stat-number">${logins}</div><div class="stat-label">Inicios de sesión</div></div>
      <div class="stat-card--compact"><div class="stat-number">${uniqueUsers}</div><div class="stat-label">Usuarios únicos</div></div>`;
  }

  function renderTable() {
    const container = document.getElementById('bitacora-table');
    if (!container) return;

    const start = currentPage * PAGE_SIZE;
    const page = filteredLogs.slice(start, start + PAGE_SIZE);

    if (page.length === 0) {
      container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-light);">No hay registros que coincidan con los filtros.</div>`;
      return;
    }

    let rows = '';
    page.forEach((log, i) => {
      const actionMeta = ACTION_LABELS[log.action] || { icon: 'info', color: '#718096', label: log.action };
      const entityLabel = ENTITY_LABELS[log.entity] || log.entity || '-';
      const dateStr = _formatDate(log._date);
      const timeStr = _formatTime(log._date);

      // Expandable detail
      const hasDetail = log.before || log.after || log.extra;
      const detailId = `detail-${log.id}`;

      rows += `
        <tr class="bitacora-row ${hasDetail ? 'bitacora-expandable' : ''}" ${hasDetail ? `data-detail="${detailId}"` : ''}>
          <td style="text-align:center;font-size:11px;color:var(--text-light);">${start + i + 1}</td>
          <td>
            <span class="bitacora-action-badge" style="background:${actionMeta.color}15;color:${actionMeta.color};border:1px solid ${actionMeta.color}30;">
              <span class="material-icons-round" style="font-size:14px;">${actionMeta.icon}</span>
              ${Utils.sanitize(actionMeta.label)}
            </span>
          </td>
          <td><span class="badge">${Utils.sanitize(entityLabel)}</span></td>
          <td style="font-size:12px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Utils.sanitize(log.description || '')}">${Utils.sanitize(log.description || log.details?.studentName || log.details?.reason || '-')}</td>
          <td style="font-size:12px;">${Utils.sanitize(log.userEmail || '-')}</td>
          <td style="font-size:12px;white-space:nowrap;">${dateStr}</td>
          <td style="font-size:12px;white-space:nowrap;color:var(--text-light);">${timeStr}</td>
          <td style="text-align:center;">
            ${hasDetail ? `<button class="btn-icon bitacora-expand-btn" data-target="${detailId}" title="Ver detalle"><span class="material-icons-round" style="font-size:16px;">expand_more</span></button>` : ''}
          </td>
        </tr>
        ${hasDetail ? `<tr id="${detailId}" class="bitacora-detail-row" style="display:none;">
          <td colspan="8">
            <div class="bitacora-detail-content">${_renderDetail(log)}</div>
          </td>
        </tr>` : ''}`;
    });

    container.innerHTML = `
      <table class="data-table" style="font-size:13px;">
        <thead>
          <tr>
            <th style="width:35px;">#</th>
            <th style="width:130px;">Acción</th>
            <th style="width:100px;">Entidad</th>
            <th>Descripción</th>
            <th style="width:160px;">Usuario</th>
            <th style="width:90px;">Fecha</th>
            <th style="width:70px;">Hora</th>
            <th style="width:35px;"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Bind expand buttons
    container.querySelectorAll('.bitacora-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const row = document.getElementById(targetId);
        if (row) {
          const isOpen = row.style.display !== 'none';
          row.style.display = isOpen ? 'none' : '';
          btn.querySelector('.material-icons-round').textContent = isOpen ? 'expand_more' : 'expand_less';
        }
      });
    });

    // Click on row to expand
    container.querySelectorAll('.bitacora-expandable').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.bitacora-expand-btn')) return;
        const btn = row.querySelector('.bitacora-expand-btn');
        if (btn) btn.click();
      });
    });
  }

  function _renderDetail(log) {
    let html = '';

    if (log.entityId) {
      html += `<div class="bitacora-detail-field"><span class="label">ID:</span> <code>${Utils.sanitize(log.entityId)}</code></div>`;
    }
    if (log.userName) {
      html += `<div class="bitacora-detail-field"><span class="label">Nombre usuario:</span> ${Utils.sanitize(log.userName)}</div>`;
    }
    if (log.userRole) {
      html += `<div class="bitacora-detail-field"><span class="label">Rol:</span> <span class="badge">${Utils.sanitize(log.userRole)}</span></div>`;
    }

    if (log.before) {
      html += `<div class="bitacora-detail-section">
        <div class="bitacora-detail-section-title" style="color:#e53e3e;">Antes (datos eliminados/modificados):</div>
        <pre class="bitacora-json">${Utils.sanitize(JSON.stringify(log.before, null, 2))}</pre>
      </div>`;
    }

    if (log.after) {
      html += `<div class="bitacora-detail-section">
        <div class="bitacora-detail-section-title" style="color:#38a169;">Después (datos nuevos/actualizados):</div>
        <pre class="bitacora-json">${Utils.sanitize(JSON.stringify(log.after, null, 2))}</pre>
      </div>`;
    }

    if (log.extra) {
      html += `<div class="bitacora-detail-section">
        <div class="bitacora-detail-section-title">Información adicional:</div>
        <pre class="bitacora-json">${Utils.sanitize(JSON.stringify(log.extra, null, 2))}</pre>
      </div>`;
    }

    // Legacy support for old logs
    if (log.details && typeof log.details === 'object' && !log.before && !log.after) {
      html += `<div class="bitacora-detail-section">
        <div class="bitacora-detail-section-title">Detalles (registro anterior):</div>
        <pre class="bitacora-json">${Utils.sanitize(JSON.stringify(log.details, null, 2))}</pre>
      </div>`;
    }

    return html || '<em style="color:var(--text-light);">Sin detalles adicionales</em>';
  }

  function renderPagination() {
    const container = document.getElementById('bitacora-pagination');
    if (!container) return;

    const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<span style="font-size:12px;color:var(--text-light);margin-right:12px;">Página ${currentPage + 1} de ${totalPages} (${filteredLogs.length} registros)</span>`;
    html += `<button class="btn btn-outline btn-sm" id="bPrevPage" ${currentPage === 0 ? 'disabled' : ''}>← Anterior</button> `;
    html += `<button class="btn btn-outline btn-sm" id="bNextPage" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Siguiente →</button>`;

    container.innerHTML = html;

    document.getElementById('bPrevPage')?.addEventListener('click', () => {
      if (currentPage > 0) { currentPage--; renderTable(); renderPagination(); }
    });
    document.getElementById('bNextPage')?.addEventListener('click', () => {
      if (currentPage < totalPages - 1) { currentPage++; renderTable(); renderPagination(); }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  function _formatDate(d) {
    if (!d) return '-';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function _formatTime(d) {
    if (!d) return '-';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  async function exportToExcel() {
    if (filteredLogs.length === 0) {
      Toast.show('No hay datos para exportar', 'warning');
      return;
    }

    const rows = filteredLogs.map(log => ({
      'Fecha': _formatDate(log._date),
      'Hora': _formatTime(log._date),
      'Acción': ACTION_LABELS[log.action]?.label || log.action,
      'Entidad': ENTITY_LABELS[log.entity] || log.entity || '-',
      'Descripción': log.description || '',
      'Usuario': log.userEmail || '-',
      'Nombre': log.userName || '',
      'Rol': log.userRole || '',
      'ID Entidad': log.entityId || ''
    }));

    try {
      await Lib.xlsx();
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Bitácora');
      XLSX.writeFile(wb, `Bitacora_EPO67_${new Date().toISOString().slice(0, 10)}.xlsx`);
      Toast.show('Excel exportado', 'success');
    } catch (err) {
      console.error(err);
      Toast.show('Error cargando libreria XLSX', 'error');
    }
  }

  return { render };
})();

Router.modules['bitacora'] = () => BitacoraModule.render();
