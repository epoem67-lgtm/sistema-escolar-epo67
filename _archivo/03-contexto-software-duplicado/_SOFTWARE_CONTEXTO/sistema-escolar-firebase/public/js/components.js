// ════════════════════════════════════���══════════════════════════
// COMPONENTES UI REUTILIZABLES — Sistema Escolar EPO 67
// Funciones que retornan HTML usando clases de styles.css.
// Zero inline styles. Cada modulo llama UI.* en lugar de
// construir su propio HTML con style="...".
// ═══════════════════════���═══════════════════════════════════════

const UI = {

  /**
   * Header principal de un modulo
   * @param {string} title - Titulo del modulo
   * @param {string} [subtitle] - Descripcion corta
   * @param {string} [actionsHTML] - HTML de botones de accion (ej. "Nuevo", "Exportar")
   * @returns {string} HTML
   */
  pageHeader(title, subtitle = '', actionsHTML = '') {
    return `
      <div class="module-header">
        <div class="module-header-text">
          <h1 class="module-title">${Utils.sanitize(title)}</h1>
          ${subtitle ? `<p class="module-subtitle">${Utils.sanitize(subtitle)}</p>` : ''}
        </div>
        ${actionsHTML ? `<div class="module-actions">${actionsHTML}</div>` : ''}
      </div>
    `;
  },

  /**
   * Grid de tarjetas de estadisticas
   * @param {Array<{label:string, value:string|number, icon?:string, colorClass?:string}>} cards
   *   colorClass: 'primary' | 'success' | 'danger' | 'warning'
   * @returns {string} HTML
   */
  statsGrid(cards) {
    const cardsHTML = cards.map(card => {
      const iconClass = card.colorClass || 'primary';
      const iconHTML = card.icon
        ? `<div class="stat-icon ${iconClass}"><span class="material-icons-round">${card.icon}</span></div>`
        : '';
      return `
        <div class="stat-card">
          ${iconHTML}
          <div class="stat-content">
            <div class="stat-label">${Utils.sanitize(card.label)}</div>
            <div class="stat-number">${card.value}</div>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="stats-grid">${cardsHTML}</div>`;
  },

  /**
   * Barra de filtros configurable
   * @param {Object} options
   * @param {string} [options.idPrefix='filter'] - Prefijo para IDs de los selects
   * @param {Array<string>} [options.turnos] - Opciones de turno
   * @param {Array<number>} [options.grados] - Opciones de grado
   * @param {Array<string>} [options.grupos] - Opciones de grupo
   * @param {Array<{id:string,nombre:string}>} [options.parciales] - Opciones de parcial
   * @param {boolean} [options.showSearch=false] - Mostrar campo de busqueda
   * @param {string} [options.searchPlaceholder='Buscar...'] - Placeholder del campo de busqueda
   * @param {string} [options.extraHTML=''] - HTML adicional (botones, etc.)
   * @returns {string} HTML
   */
  filterBar(options = {}) {
    const prefix = options.idPrefix || 'filter';
    let filtersHTML = '';

    if (options.turnos && options.turnos.length > 0) {
      filtersHTML += `
        <div class="form-group">
          <label for="${prefix}-turno">Turno</label>
          <select id="${prefix}-turno">
            <option value="">Todos los turnos</option>
            ${options.turnos.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
      `;
    }

    if (options.grados && options.grados.length > 0) {
      filtersHTML += `
        <div class="form-group">
          <label for="${prefix}-grado">Grado</label>
          <select id="${prefix}-grado">
            <option value="">Todos los grados</option>
            ${options.grados.map(g => `<option value="${g}">${g}° Grado</option>`).join('')}
          </select>
        </div>
      `;
    }

    if (options.grupos && options.grupos.length > 0) {
      filtersHTML += `
        <div class="form-group">
          <label for="${prefix}-grupo">Grupo</label>
          <select id="${prefix}-grupo">
            <option value="">Todos los grupos</option>
            ${options.grupos.map(g => `<option value="${g}">${g}</option>`).join('')}
          </select>
        </div>
      `;
    }

    if (options.parciales && options.parciales.length > 0) {
      filtersHTML += `
        <div class="form-group">
          <label for="${prefix}-parcial">Parcial</label>
          <select id="${prefix}-parcial">
            <option value="">Todos</option>
            ${options.parciales.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
          </select>
        </div>
      `;
    }

    if (options.showSearch) {
      filtersHTML += `
        <div class="form-group">
          <label for="${prefix}-search">Buscar</label>
          <input type="text" id="${prefix}-search" placeholder="${options.searchPlaceholder || 'Buscar...'}">
        </div>
      `;
    }

    return `
      <div class="card filter-bar">
        <div class="filter-bar-grid">
          ${filtersHTML}
        </div>
        ${options.extraHTML ? `<div class="filter-bar-actions">${options.extraHTML}</div>` : ''}
      </div>
    `;
  },

  /**
   * Tabla de datos reutilizable
   * @param {Object} options
   * @param {Array<{key:string, label:string, align?:string, render?:Function}>} options.columns
   * @param {Array<Object>} options.rows - Array de objetos con datos
   * @param {string} [options.emptyMessage='No hay datos'] - Mensaje cuando no hay filas
   * @param {string} [options.rowDataAttr] - Nombre del atributo data-* para filas (ej: 'student-id')
   * @param {Function} [options.rowDataValue] - Funcion que recibe la fila y retorna el valor del data attr
   * @returns {string} HTML
   */
  dataTable(options) {
    const { columns, rows, emptyMessage = 'No hay datos para mostrar' } = options;

    if (!rows || rows.length === 0) {
      return UI.emptyState('inbox', emptyMessage);
    }

    const headerCells = columns.map(col => {
      const align = col.align === 'center' ? ' class="text-center"' : '';
      return `<th${align}>${Utils.sanitize(col.label)}</th>`;
    }).join('');

    const bodyRows = rows.map((row, idx) => {
      const dataAttr = options.rowDataAttr && options.rowDataValue
        ? ` data-${options.rowDataAttr}="${options.rowDataValue(row)}"`
        : '';
      const cells = columns.map(col => {
        const align = col.align === 'center' ? ' class="text-center"' : '';
        const content = col.render ? col.render(row, idx) : Utils.sanitize(String(row[col.key] ?? ''));
        return `<td${align}>${content}</td>`;
      }).join('');
      return `<tr${dataAttr}>${cells}</tr>`;
    }).join('');

    return `
      <div class="table-container">
        <table>
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  },

  /**
   * Badge/etiqueta con tipo semantico
   * @param {string} text - Texto del badge
   * @param {string} [type='success'] - 'success' | 'danger' | 'warning' | 'inactive' | 'closed' | 'primary'
   * @returns {string} HTML
   */
  badge(text, type = 'success') {
    return `<span class="badge badge-${type}">${Utils.sanitize(text)}</span>`;
  },

  /**
   * Estado vacio centrado
   * @param {string} icon - Nombre del Material Icon
   * @param {string} message - Mensaje a mostrar
   * @returns {string} HTML
   */
  emptyState(icon, message) {
    return `
      <div class="empty-state">
        <span class="material-icons-round empty-state-icon">${icon}</span>
        <p class="empty-state-text">${Utils.sanitize(message)}</p>
      </div>
    `;
  },

  /**
   * Estado de carga con spinner
   * @param {string} [message='Cargando...'] - Mensaje
   * @returns {string} HTML
   */
  loadingState(message = 'Cargando...') {
    return `
      <div class="loading-state">
        <span class="material-icons-round loading-spinner">autorenew</span>
        <p>${Utils.sanitize(message)}</p>
      </div>
    `;
  },

  /**
   * Estado de error
   * @param {string} message - Mensaje de error
   * @returns {string} HTML
   */
  errorState(message) {
    return `
      <div class="error-state">
        <span class="material-icons-round">error_outline</span>
        <p>${Utils.sanitize(message)}</p>
      </div>
    `;
  },

  /**
   * Contenedor principal de modulo
   * @param {string} content - HTML interno
   * @returns {string} HTML
   */
  moduleContainer(content) {
    return `<div class="module-container">${content}</div>`;
  },

  /**
   * Paginacion
   * @param {Object} options
   * @param {number} options.currentPage
   * @param {number} options.totalPages
   * @param {number} options.totalItems
   * @param {number} options.itemsPerPage
   * @param {string} [options.idPrefix='page'] - Prefijo para IDs de botones
   * @returns {string} HTML
   */
  pagination(options) {
    const { currentPage, totalPages, totalItems, itemsPerPage, idPrefix = 'page' } = options;

    if (totalPages <= 1) return '';

    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, totalItems);

    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    let pageButtons = '';

    if (startPage > 1) {
      pageButtons += `<button class="btn btn-sm btn-outline ${idPrefix}-btn" data-page="1">1</button>`;
      if (startPage > 2) pageButtons += `<span class="pagination-ellipsis">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
      const activeClass = i === currentPage ? ' btn-primary' : ' btn-outline';
      pageButtons += `<button class="btn btn-sm${activeClass} ${idPrefix}-btn" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) pageButtons += `<span class="pagination-ellipsis">...</span>`;
      pageButtons += `<button class="btn btn-sm btn-outline ${idPrefix}-btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    return `
      <div class="pagination">
        <span class="pagination-info">Mostrando ${start} a ${end} de ${totalItems}</span>
        <div class="pagination-buttons">
          <button class="btn btn-sm btn-outline" id="${idPrefix}-prev" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
          ${pageButtons}
          <button class="btn btn-sm btn-outline" id="${idPrefix}-next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
        </div>
      </div>
    `;
  }
};
