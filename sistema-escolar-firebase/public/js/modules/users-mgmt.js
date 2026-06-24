/**
 * USER MANAGEMENT MODULE
 * Admin panel for managing user accounts and roles
 */

const UsersMgmt = (() => {
  let users = [];
  let searchQuery = '';
  let roleFilter = '';
  let passwordFilter = '';  // '' | 'pending' | 'configured'

  async function render() {
    const container = document.getElementById('moduleContainer');

    if (App.currentUser?.role !== 'admin') {
      container.innerHTML = `<div class="module-container"><div class="error-state"><span class="material-icons-round">block</span><p>Acceso denegado: se requiere rol de administrador</p></div></div>`;
      return;
    }

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Gestión de Usuarios</h1>
            <p class="module-subtitle">Cuentas, roles, contraseñas y modo "ver como"</p>
          </div>
          <div class="module-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" style="background:#dc2626;color:#fff;font-weight:700;" data-action="generate-letters" title="PDF con 1 hoja por maestro: nombre, credenciales y manual personal. Lo imprimes o lo subes a Drive.">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">picture_as_pdf</span>
              Cartas personales (PDF)
            </button>
            <button class="btn" style="background:#16a34a;color:#fff;font-weight:700;" data-action="export-credentials" title="Excel con credenciales de TODOS los maestros para subir a Drive/Sheets">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">table_chart</span>
              Exportar Excel
            </button>
            <button class="btn" style="background:#25d366;color:#fff;font-weight:700;" data-action="mass-welcome" title="Mensajes WhatsApp personalizados para mandar uno a uno">
              <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">campaign</span>
              WhatsApp masivo
            </button>
            <button class="btn btn-primary" data-action="add-user">+ Nuevo Usuario</button>
          </div>
        </div>

        <div id="loginStatusPanel"></div>

        <div class="card filter-bar">
          <div class="filter-bar-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));align-items:end;">
            <div class="form-group">
              <label for="usrSearch">Buscar</label>
              <div style="position:relative;">
                <input type="text" id="usrSearch" placeholder="Nombre o email" class="ge-input" style="padding-right:32px;">
                <button id="usrSearchClear" data-action="clear-search" title="Limpiar búsqueda" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#e2e8f0;color:#475569;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;display:none;align-items:center;justify-content:center;padding:0;font-size:14px;font-weight:700;line-height:1;">✕</button>
              </div>
            </div>
            <div class="form-group">
              <label for="usrRoleFilter">Rol</label>
              <select id="usrRoleFilter">
                <option value="">Todos</option>
                ${K.ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="usrPasswordFilter">Estado de cuenta</label>
              <select id="usrPasswordFilter">
                <option value="">Todos</option>
                <option value="pending">⏳ Pendientes (no han entrado)</option>
                <option value="configured">✅ Ya entraron</option>
              </select>
            </div>
            <div class="form-group">
              <label style="opacity:0;">.</label>
              <button class="btn btn-outline" data-action="clear-all-filters" title="Quitar todos los filtros y ver a TODOS los usuarios" style="white-space:nowrap;">
                <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">refresh</span>
                Mostrar todos
              </button>
            </div>
          </div>
        </div>

        <div id="usersTableContainer"></div>
      </div>
    `;

    users = await Store.getUsers(true);
    _renderLoginStatusPanel();
    renderTable();
    bindEvents();
  }

  // ─── PANEL DE ESTADO DE INGRESOS ─────────────────────────────
  // Muestra arriba: total, cuántos ya entraron, cuántos pendientes,
  // barra de progreso y los últimos 3 que entraron.
  function _renderLoginStatusPanel() {
    const root = document.getElementById('loginStatusPanel');
    if (!root) return;

    // Solo contar docentes (excluyendo admins, demos)
    const docenteRoles = ['maestro', 'orientador_docente', 'orientador', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'consulta'];
    const docentes = users.filter(u =>
      u.status === 'active' &&
      !u.isDemo &&
      docenteRoles.includes(u.role)
    );

    const yaEntraron = docentes.filter(u => u.mustChangePassword === false);
    const pendientes = docentes.filter(u => u.mustChangePassword !== false);
    const total = docentes.length;
    const pct = total > 0 ? Math.round((yaEntraron.length / total) * 100) : 0;

    // Últimos 3 que entraron, ordenados por passwordChangedAt
    const ultimos = [...yaEntraron]
      .filter(u => u.passwordChangedAt)
      .sort((a, b) => {
        const ta = a.passwordChangedAt?.toDate?.() || new Date(a.passwordChangedAt || 0);
        const tb = b.passwordChangedAt?.toDate?.() || new Date(b.passwordChangedAt || 0);
        return tb - ta;
      })
      .slice(0, 3);

    const fmtFecha = (ts) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      const ahora = new Date();
      const diffMin = Math.floor((ahora - d) / 60000);
      if (diffMin < 1) return 'hace segundos';
      if (diffMin < 60) return `hace ${diffMin} min`;
      const diffHoras = Math.floor(diffMin / 60);
      if (diffHoras < 24) return `hace ${diffHoras} h`;
      const diffDias = Math.floor(diffHoras / 24);
      if (diffDias === 1) return 'ayer';
      if (diffDias < 7) return `hace ${diffDias} días`;
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
    };

    const ultimosHtml = ultimos.length > 0 ? ultimos.map(u => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;border-bottom:1px solid #f1f5f9;">
        <span style="color:#16a34a;">✅</span>
        <strong style="flex:1;color:#1e293b;">${Utils.sanitize(u.displayName || u.email)}</strong>
        <span style="color:#64748b;font-size:11px;">${fmtFecha(u.passwordChangedAt)}</span>
      </div>
    `).join('') : '<p style="color:#94a3b8;font-size:12px;font-style:italic;text-align:center;padding:8px;">Aún nadie ha completado su primer ingreso</p>';

    root.innerHTML = `
      <div class="card" style="background:linear-gradient(90deg,#eff6ff 0%,#f0fdf4 100%);border-left:5px solid #3182ce;margin-bottom:16px;">
        <h3 style="margin:0 0 12px;font-size:16px;color:#1e40af;">
          <span class="material-icons-round" style="vertical-align:middle;color:#3182ce;">how_to_reg</span>
          Estado de ingresos al sistema
          <button data-action="refresh-login-status" style="float:right;background:transparent;border:1px solid #3182ce;color:#3182ce;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">
            🔄 Actualizar
          </button>
        </h3>

        <!-- KPIs -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
          <div style="background:#fff;padding:12px 16px;border-radius:8px;border:1px solid #cbd5e0;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Total</div>
            <div style="font-size:24px;font-weight:700;color:#1e293b;">${total}</div>
          </div>
          <div style="background:#dcfce7;padding:12px 16px;border-radius:8px;border:1px solid #16a34a;">
            <div style="font-size:11px;color:#166534;text-transform:uppercase;font-weight:700;">✅ Ya entraron</div>
            <div style="font-size:24px;font-weight:700;color:#166534;">${yaEntraron.length} <span style="font-size:14px;font-weight:600;">(${pct}%)</span></div>
          </div>
          <div style="background:#fef3c7;padding:12px 16px;border-radius:8px;border:1px solid #d97706;">
            <div style="font-size:11px;color:#92400e;text-transform:uppercase;font-weight:700;">⏳ Pendientes</div>
            <div style="font-size:24px;font-weight:700;color:#92400e;">${pendientes.length} <span style="font-size:14px;font-weight:600;">(${100 - pct}%)</span></div>
          </div>
        </div>

        <!-- Barra de progreso -->
        <div style="background:#e2e8f0;border-radius:8px;height:14px;overflow:hidden;margin-bottom:12px;">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#3182ce,#16a34a);transition:width 0.5s;"></div>
        </div>

        <!-- Últimos 3 ingresos -->
        ${ultimos.length > 0 ? `
          <div style="margin-top:10px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px;">📈 Últimos en entrar</div>
            ${ultimosHtml}
          </div>
        ` : ''}
      </div>
    `;

    // Bind refresh button
    document.querySelector('[data-action="refresh-login-status"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '🔄 Actualizando...';
      try {
        Store.invalidate('users');
        users = await Store.getUsers(true);
        _renderLoginStatusPanel();
        renderTable();
      } catch (err) {
        Toast.show('Error: ' + err.message, 'error');
      }
    });
  }

  function getFilteredUsers() {
    let list = [...users];
    if (roleFilter) list = list.filter(u => u.role === roleFilter);
    if (passwordFilter === 'pending') list = list.filter(u => u.mustChangePassword !== false);
    if (passwordFilter === 'configured') list = list.filter(u => u.mustChangePassword === false);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(u =>
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.recoveryEmail || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  function renderTable() {
    const tableContainer = document.getElementById('usersTableContainer');
    const filtered = getFilteredUsers();

    if (filtered.length === 0) {
      tableContainer.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">people</span><p class="empty-state-text">${users.length === 0 ? 'No hay usuarios' : 'No hay usuarios que coincidan con los filtros'}</p></div>`;
      return;
    }

    const summary = `<div style="margin-bottom:8px;font-size:13px;color:#555;">Mostrando ${filtered.length} de ${users.length} usuarios.</div>`;

    const rows = filtered.map(user => {
      const roleColor = K.getRoleColor(user.role);
      const isActive = user.status === 'active';
      const mustChange = user.mustChangePassword === true;
      const recoveryEmail = user.recoveryEmail || '';

      const pwdStatus = mustChange
        ? '<span class="badge" style="background:#fef3c7;color:#78350f;border:1px solid #d97706;">🔒 Pendiente</span>'
        : '<span class="badge badge-success">✅ Configurada</span>';

      // Badges ADITIVOS: presidente_academia y auditor son flags que SUMAN al
      // role base. Los mostramos junto al chip de rol para que se vea claramente
      // que el usuario tiene permisos extra.
      const isAuditor = user.auditorScope === true;
      const isAcademia = !!(user.academiaGrado && user.academiaTurno);
      const adidaPills = [
        isAuditor   ? '<span class="badge" style="background:#dbeafe;color:#1e40af;border:1px solid #3b82f6;font-size:10px;" title="Acceso lectura global a indicadores/concentrados/F1">🔍 Auditor</span>' : '',
        isAcademia  ? `<span class="badge" style="background:#fce7f3;color:#9d174d;border:1px solid #ec4899;font-size:10px;" title="Presidente/Secretario de Academia ${user.academiaGrado}° ${user.academiaTurno}">🎓 Academia</span>` : '',
      ].filter(Boolean).join(' ');

      return `
        <tr>
          <td class="font-semibold" style="font-size:13px;">${Utils.sanitize(user.displayName || '-')}</td>
          <td class="text-muted" style="font-size:12px;">${Utils.sanitize(user.email)}</td>
          <td>
            <span class="badge" style="background-color: ${roleColor}20; color: ${roleColor};">${Utils.sanitize(user.role)}</span>
            ${adidaPills ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' + adidaPills + '</div>' : ''}
          </td>
          <td>${isActive ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
          <td>${pwdStatus}</td>
          <td class="text-muted" style="font-size:12px;">${Utils.sanitize(recoveryEmail) || '<em>—</em>'}</td>
          <td class="users-actions-cell">
            <div class="users-actions">
              <button class="user-icon-btn user-icon-impersonate" data-action="impersonate" data-user-id="${user.id}" title="Ver como este usuario" aria-label="Ver como este usuario">
                <span class="material-icons-round">visibility</span>
              </button>
              <button class="user-icon-btn user-icon-reset" data-action="reset-password" data-user-id="${user.id}" title="Reset de contraseña + enviar por WhatsApp" aria-label="Reset de contraseña">
                <span class="material-icons-round">restart_alt</span>
              </button>
              <button class="user-icon-btn user-icon-force" data-action="force-change" data-user-id="${user.id}" title="Forzar cambio de contraseña en próximo ingreso" aria-label="Forzar cambio de contraseña">
                <span class="material-icons-round">key</span>
              </button>
              <button class="user-icon-btn user-icon-role" data-action="edit-role" data-user-id="${user.id}" title="Editar rol" aria-label="Editar rol">
                <span class="material-icons-round">badge</span>
              </button>
              <button class="user-icon-btn" data-action="toggle-auditor" data-user-id="${user.id}" title="${isAuditor ? 'Quitar acceso de auditor' : 'Otorgar acceso de auditor (lectura global)'}" aria-label="${isAuditor ? 'Quitar auditor' : 'Activar auditor'}" style="${isAuditor ? 'background:#dbeafe;color:#1e40af;' : 'background:#f1f5f9;color:#64748b;'}">
                <span class="material-icons-round">${isAuditor ? 'visibility' : 'visibility_off'}</span>
              </button>
              <button class="user-icon-btn ${isActive ? 'user-icon-deactivate' : 'user-icon-activate'}" data-action="toggle-status" data-user-id="${user.id}" title="${isActive ? 'Desactivar usuario' : 'Activar usuario'}" aria-label="${isActive ? 'Desactivar usuario' : 'Activar usuario'}">
                <span class="material-icons-round">${isActive ? 'block' : 'check_circle'}</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tableContainer.innerHTML = `
      ${summary}
      <div class="table-container">
        <table class="table-light">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Contraseña</th>
              <th>Correo recuperación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // BUGFIX: bindEvents se llamaba en cada render() y los listeners se
  // acumulaban sobre el mismo `container` persistente. Tras 2 renders, cada
  // click disparaba 2 handlers — por eso el confirm de "Ver como" salia dos
  // veces. Bindeamos UNA SOLA VEZ por carga del modulo.
  let _eventsBound = false;
  let _searchDebounceTimer = null;
  function bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    const container = document.getElementById('moduleContainer');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, userId } = btn.dataset;
      switch (action) {
        case 'add-user': openAddUserModal(); break;
        case 'edit-role': editRole(userId); break;
        case 'toggle-status': toggleStatus(userId); break;
        case 'toggle-auditor': toggleAuditor(userId); break;
        case 'force-change': forceChangePassword(userId); break;
        case 'reset-password': resetPasswordAdmin(userId); break;
        case 'impersonate': impersonateUser(userId); break;
        case 'mass-welcome': openMassWelcomeModal(); break;
        case 'generate-letters': openGenerateLettersModal(); break;
        case 'export-credentials': openExportCredentialsModal(); break;
        case 'clear-search': _clearSearch(); break;
        case 'clear-all-filters': _clearAllFilters(); break;
      }
    });

    container.addEventListener('input', (e) => {
      if (e.target.id === 'usrSearch') {
        // Mostrar/ocultar la X según haya texto
        const clearBtn = document.getElementById('usrSearchClear');
        if (clearBtn) clearBtn.style.display = e.target.value ? 'inline-flex' : 'none';

        // DEBOUNCE: esperar 300ms después de que pare de teclear antes de
        // re-renderizar. Evita 10+ re-renders pesados cuando el maestro borra
        // caracteres con backspace o cuando pega/borra rápido.
        if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
        _searchDebounceTimer = setTimeout(() => {
          searchQuery = (e.target.value || '').trim();
          renderTable();
        }, 300);
      }
    });

    container.addEventListener('change', (e) => {
      if (e.target.id === 'usrRoleFilter') {
        roleFilter = e.target.value;
        renderTable();
      }
      if (e.target.id === 'usrPasswordFilter') {
        passwordFilter = e.target.value;
        renderTable();
      }
    });

    // Tecla Escape dentro del search → limpia el campo y muestra todos
    container.addEventListener('keydown', (e) => {
      if (e.target.id === 'usrSearch' && e.key === 'Escape') {
        e.preventDefault();
        _clearSearch();
      }
    });
  }

  // Limpia solo el campo de búsqueda (deja los filtros de rol y estado intactos)
  function _clearSearch() {
    if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
    searchQuery = '';
    const input = document.getElementById('usrSearch');
    if (input) {
      input.value = '';
      input.focus();
    }
    const clearBtn = document.getElementById('usrSearchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    renderTable();
  }

  // Limpia TODOS los filtros: búsqueda + rol + estado. Vuelve a mostrar a TODOS.
  function _clearAllFilters() {
    if (_searchDebounceTimer) { clearTimeout(_searchDebounceTimer); _searchDebounceTimer = null; }
    searchQuery = '';
    roleFilter = '';
    passwordFilter = '';
    const input = document.getElementById('usrSearch');
    if (input) input.value = '';
    const role = document.getElementById('usrRoleFilter');
    if (role) role.value = '';
    const pwd = document.getElementById('usrPasswordFilter');
    if (pwd) pwd.value = '';
    const clearBtn = document.getElementById('usrSearchClear');
    if (clearBtn) clearBtn.style.display = 'none';
    renderTable();
  }

  async function forceChangePassword(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`¿Forzar cambio de contraseña para ${user.displayName || user.email}?\n\nLa próxima vez que entre, el sistema le exigirá fijar nueva contraseña + correo de recuperación. Necesitará conocer su contraseña actual para hacer login.`)) return;
    try {
      await DB.users().doc(userId).update({
        mustChangePassword: true
      });
      DB.audit('forzar_cambio_pwd', 'usuario', userId, {
        description: `Admin forzó cambio de contraseña: ${user.displayName || user.email}`,
        before: { mustChangePassword: user.mustChangePassword || false },
        after: { mustChangePassword: true }
      });
      Store.invalidate('users');
      users = await Store.getUsers(true);
      renderTable();
      Toast.show('Cambio forzado. El usuario verá la pantalla de configuración inicial al ingresar.', 'success');
    } catch (e) {
      Toast.show('Error: ' + e.message, 'error');
    }
  }

  // ─── RESET DE CONTRASEÑA + WHATSAPP ──────────────────────────
  // Genera una contraseña temporal (sugerida) y abre modal con instrucciones
  // para aplicarla via script + plantilla WhatsApp para enviar al maestro.
  function _generateTempPassword() {
    // Patrón fácil de dictar por WhatsApp: epo67- + 4 dígitos
    const digits = Math.floor(1000 + Math.random() * 9000);
    return `epo67-${digits}`;
  }

  function _normalizePhone(phone) {
    return (phone || '').replace(/\D/g, '');
  }

  async function resetPasswordAdmin(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    if (!confirm(
      `Reset de contraseña para:\n${user.displayName || user.email}\n\n` +
      `Se generará una contraseña temporal nueva y se aplicará automáticamente ` +
      `en Firebase Auth (sin terminal). Después podrás enviársela por WhatsApp.\n\n¿Continuar?`
    )) return;

    // Llamar a la Cloud Function adminResetPassword (server-side, 1 clic).
    // Usamos fetch() con el ID token del admin para evitar problemas del SDK
    // v8 compat con Cloud Functions v2.
    let resp;
    try {
      const idToken = await firebase.auth().currentUser.getIdToken();
      const r = await fetch('https://us-central1-epo67-sistema.cloudfunctions.net/adminResetPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({ data: { userId } })
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json.error) {
        const msg = (json.error && (json.error.message || json.error.status)) || `HTTP ${r.status}`;
        throw new Error(msg);
      }
      resp = json.result || json;
    } catch (e) {
      Toast.show('No se pudo resetear: ' + e.message, 'error');
      return;
    }

    if (!resp || !resp.success || !resp.password) {
      Toast.show('El servidor no devolvió una contraseña válida.', 'error');
      return;
    }

    const newPwd = resp.password;
    try {
      DB.audit('reset_pwd_admin', 'usuario', userId, {
        description: `Admin reseteó contraseña (1 clic) para: ${user.displayName || user.email}`,
      });
      Store.invalidate('users');
    } catch (_) { /* auditoría best-effort */ }

    // Abrir modal con la contraseña aplicada + plantilla WhatsApp
    const teacherPhone = _normalizePhone(user.phone || user.whatsapp || '');
    const userEmail = resp.email || user.email || '';
    const displayName = resp.displayName || user.displayName || userEmail;

    const waMessage = `Hola ${displayName.split(' ')[0] || ''}, soy Olivia del Sistema Escolar EPO 67.\n\n` +
      `Te he reseteado tu contraseña. Tus datos para entrar son:\n\n` +
      `🔗 https://epo67-sistema.web.app\n` +
      `📧 Correo: ${userEmail}\n` +
      `🔑 Contraseña temporal: ${newPwd}\n\n` +
      `Cuando entres, el sistema te pedirá que cambies la contraseña por una propia. ¡Listo!`;

    const waHref = teacherPhone
      ? `https://wa.me/52${teacherPhone}?text=${encodeURIComponent(waMessage)}`
      : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

    const body = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:12px 14px;border-radius:6px;">
          <strong style="color:#166534;font-size:14px;">✅ Contraseña reseteada y aplicada</strong>
          <div style="margin-top:8px;font-size:13px;color:#166534;">Nueva contraseña temporal:</div>
          <div style="background:#1e293b;border-radius:6px;padding:12px;text-align:center;margin-top:6px;">
            <span style="font-family:'Courier New',monospace;font-size:26px;color:#fff;font-weight:700;letter-spacing:2px;user-select:all;">${Utils.sanitize(newPwd)}</span>
          </div>
          <button id="copyPwd" class="btn btn-sm btn-outline" style="margin-top:8px;">📋 Copiar contraseña</button>
        </div>

        <div style="background:#eff6ff;border-left:4px solid #3182ce;padding:10px 14px;border-radius:6px;">
          <strong style="color:#1e40af;">Avísale al maestro por WhatsApp</strong><br>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <a href="${waHref}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25d366;color:#fff;font-weight:700;">
              📱 Abrir WhatsApp con el mensaje
            </a>
            <button id="copyMsg" class="btn btn-sm btn-outline">Copiar mensaje</button>
          </div>
          <details style="margin-top:8px;font-size:11px;color:#1e40af;">
            <summary style="cursor:pointer;font-weight:600;">Ver mensaje completo</summary>
            <pre style="background:#fff;padding:8px;border-radius:4px;white-space:pre-wrap;font-size:11px;color:#1e293b;margin-top:6px;">${Utils.sanitize(waMessage)}</pre>
          </details>
        </div>

        <div style="font-size:12px;color:#64748b;">
          Usuario: <strong>${Utils.sanitize(displayName)}</strong> · Correo: <strong>${Utils.sanitize(userEmail)}</strong><br>
          El maestro deberá cambiar la contraseña al entrar (mustChangePassword ✓).
        </div>
      </div>`;

    const footer = `<button class="btn btn-primary" data-action="modal-cancel">Listo</button>`;
    Modal.open('Reset de contraseña — ' + (displayName.split(' ')[0] || ''), body, footer);

    setTimeout(() => {
      document.getElementById('copyPwd')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(newPwd);
        Toast.show('Contraseña copiada', 'success');
      });
      document.getElementById('copyMsg')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(waMessage);
        Toast.show('Mensaje copiado', 'success');
      });
      document.getElementById('modalFooter')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
      });
    }, 100);
  }

  async function impersonateUser(userId) {
    // Forzar refresh de la lista de usuarios para que `user.auditorScope`
    // refleje el estado actual. Sin esto, si Olivia acaba de dar el flag
    // auditor a Jessica y luego impersona, podría leer el cached user sin el flag.
    try { users = await Store.getUsers(true); } catch (_) { /* sigue con cache */ }
    const user = users.find(u => u.id === userId);
    if (!user) return;
    if (!confirm(`Vista "Ver como": el sistema te mostrará lo que ${user.displayName || user.email} (rol: ${user.role}) puede ver.\n\nSe muestra una barra naranja arriba con un botón para volver a tu sesión normal. Tu sesión real NO se cierra ni se cambia.`)) return;

    // Guardar estado original SOLO la primera vez
    if (!sessionStorage.getItem('_originalAdmin')) {
      sessionStorage.setItem('_originalAdmin', JSON.stringify(App.currentUser));
    }
    // FIX (mayo 2026): guardar el UID impersonado para que sobreviva a refresh.
    // Sin esto, el admin perdia el contexto al recargar y debia re-iniciar el
    // proceso de impersonacion completo. Ahora app.js detecta este sessionStorage
    // en el login flow y re-aplica la impersonacion automaticamente.
    sessionStorage.setItem('_impersonatedUid', userId);

    // Override App.currentUser con datos del target.
    // Importante: copiamos TODOS los campos ADITIVOS para que el sidebar y los
    // módulos detecten correctamente los permisos extra del usuario impersonado:
    //   - academiaGrado/Turno/Rol → sección Academia (12 presidentes/secretarios)
    //   - auditorScope → sección Orientación + lectura global (auditores)
    // Sin esto, applyRoleVisibility solo ve el rol base y oculta las secciones
    // que dependen de flags aditivos.
    App.currentUser = {
      ...App.currentUser, // mantiene uid real, email auth real (para reglas Firestore)
      _impersonating: true,
      _realRole: App.currentUser.role,
      _realDisplay: App.currentUser.displayName,
      _realAcademiaGrado: App.currentUser.academiaGrado,
      _realAcademiaTurno: App.currentUser.academiaTurno,
      _realAcademiaRol: App.currentUser.academiaRol,
      _realAuditorScope: App.currentUser.auditorScope,
      role: user.role,
      teacherId: user.teacherId || '',
      displayName: user.displayName || user.email,
      academiaGrado: user.academiaGrado != null ? user.academiaGrado : null,
      academiaTurno: user.academiaTurno || null,
      academiaRol: user.academiaRol || null,
      auditorScope: user.auditorScope === true,
      _impersonatedUid: userId
    };

    // Limpiar TODO el cache para que cualquier query (assignments_my_*, students,
    // orientadorGroups, etc.) se re-consulte con la identidad impersonada.
    // Sin esto se quedan datos del admin original visibles bajo el rol falso.
    if (Store && typeof Store.invalidateAll === 'function') {
      Store.invalidateAll();
    }

    // Aplicar visibilidad y mostrar banner
    App.applyRoleVisibility(user.role);
    if (typeof App.updateUserUI === 'function') App.updateUserUI();

    // Mostrar banner naranja arriba
    let banner = document.getElementById('impersonateBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'impersonateBanner';
      banner.style.cssText = 'position:sticky;top:0;left:0;right:0;background:#d97706;color:#fff;padding:8px 16px;z-index:9999;display:flex;justify-content:space-between;align-items:center;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.innerHTML = `
      <span>🔍 Viendo como <strong>${Utils.sanitize(user.displayName)}</strong> (rol: ${Utils.sanitize(user.role)}) — Tus permisos reales NO han cambiado, solo la vista UI</span>
      <button class="btn btn-sm" onclick="UsersMgmt.stopImpersonation()" style="background:#fff;color:#d97706;font-weight:700;">Volver a mi sesión</button>
    `;
    banner.style.display = 'flex';

    Toast.show(`Ahora ves como ${user.displayName}`, 'info');
    // Ir al dashboard para mostrar la vista del impersonado
    Router.navigate('dashboard');
  }

  /**
   * Restaura una impersonacion guardada en sessionStorage al recargar la app.
   * Llamada desde app.js despues de que App.currentUser se carga con el usuario REAL.
   * Si no hay impersonacion guardada o el rol real no la permite, no hace nada.
   */
  async function restoreImpersonationFromSession() {
    const impersonatedUid = sessionStorage.getItem('_impersonatedUid');
    if (!impersonatedUid) return;
    // Solo admin/subdirector pueden impersonar — si por alguna razon el rol real
    // no esta entre esos, limpiamos el sessionStorage y salimos.
    const realRole = App.currentUser?.role;
    if (realRole !== 'admin' && realRole !== 'subdirector') {
      sessionStorage.removeItem('_impersonatedUid');
      sessionStorage.removeItem('_originalAdmin');
      return;
    }
    try {
      const doc = await db.collection('users').doc(impersonatedUid).get();
      if (!doc.exists) {
        sessionStorage.removeItem('_impersonatedUid');
        return;
      }
      const target = { id: doc.id, ...doc.data() };
      _applyImpersonationOverride(target, /*silent*/ true);
      console.log('🔍 Impersonacion restaurada tras refresh:', target.displayName || target.email);
    } catch (e) {
      console.warn('No se pudo restaurar impersonacion:', e.message);
      sessionStorage.removeItem('_impersonatedUid');
    }
  }

  /**
   * Aplica el override de App.currentUser para impersonar a `user`.
   * Comparte la logica entre `impersonateUser` (nuevo) y `restoreImpersonationFromSession` (refresh).
   * Si silent=true no muestra Toast ni hace Router.navigate (caso refresh).
   */
  function _applyImpersonationOverride(user, silent) {
    // Override App.currentUser con datos del target.
    App.currentUser = {
      ...App.currentUser,
      _impersonating: true,
      _realRole: App.currentUser._realRole || App.currentUser.role,
      _realDisplay: App.currentUser._realDisplay || App.currentUser.displayName,
      _realAcademiaGrado: App.currentUser._realAcademiaGrado !== undefined ? App.currentUser._realAcademiaGrado : App.currentUser.academiaGrado,
      _realAcademiaTurno: App.currentUser._realAcademiaTurno !== undefined ? App.currentUser._realAcademiaTurno : App.currentUser.academiaTurno,
      _realAcademiaRol: App.currentUser._realAcademiaRol !== undefined ? App.currentUser._realAcademiaRol : App.currentUser.academiaRol,
      _realAuditorScope: App.currentUser._realAuditorScope !== undefined ? App.currentUser._realAuditorScope : App.currentUser.auditorScope,
      role: user.role,
      teacherId: user.teacherId || '',
      displayName: user.displayName || user.email,
      academiaGrado: user.academiaGrado != null ? user.academiaGrado : null,
      academiaTurno: user.academiaTurno || null,
      academiaRol: user.academiaRol || null,
      auditorScope: user.auditorScope === true,
      _impersonatedUid: user.id
    };
    if (Store && typeof Store.invalidateAll === 'function') Store.invalidateAll();
    App.applyRoleVisibility(user.role);
    if (typeof App.updateUserUI === 'function') App.updateUserUI();

    // Banner naranja
    let banner = document.getElementById('impersonateBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'impersonateBanner';
      banner.style.cssText = 'position:sticky;top:0;left:0;right:0;background:#d97706;color:#fff;padding:8px 16px;z-index:9999;display:flex;justify-content:space-between;align-items:center;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.innerHTML = `
      <span>🔍 Viendo como <strong>${Utils.sanitize(user.displayName || user.email || '')}</strong> (rol: ${Utils.sanitize(user.role || '')}) — Tus permisos reales NO han cambiado, solo la vista UI</span>
      <button class="btn btn-sm" onclick="UsersMgmt.stopImpersonation()" style="background:#fff;color:#d97706;font-weight:700;">Volver a mi sesión</button>
    `;
    banner.style.display = 'flex';

    if (!silent) {
      Toast.show(`Ahora ves como ${user.displayName || user.email}`, 'info');
      Router.navigate('dashboard');
    }
  }

  function stopImpersonation() {
    const original = sessionStorage.getItem('_originalAdmin');
    if (original) {
      App.currentUser = JSON.parse(original);
      sessionStorage.removeItem('_originalAdmin');
      App.applyRoleVisibility(App.currentUser.role);
      if (typeof App.updateUserUI === 'function') App.updateUserUI();
    }
    // FIX (mayo 2026): limpiar tambien el UID impersonado del sessionStorage
    // para que el proximo refresh no reintente la impersonacion ya cerrada.
    sessionStorage.removeItem('_impersonatedUid');
    // Limpiar cache para volver a leer con la identidad real
    if (Store && typeof Store.invalidateAll === 'function') {
      Store.invalidateAll();
    }
    const banner = document.getElementById('impersonateBanner');
    if (banner) banner.style.display = 'none';
    Toast.show('De vuelta a tu sesión de admin', 'success');
    Router.navigate('users-mgmt');
  }

  // ─── NUEVO USUARIO: flujo en 2 pasos ─────────────────────────
  // PASO 1: Modal con formulario (email, nombre, rol, telefono opcional)
  //         + contraseña auto-generada visible con boton de regenerar.
  // PASO 2: Al confirmar, modal con instrucciones:
  //         - Comando para correr en Terminal (crea Auth + Firestore)
  //         - Plantilla WhatsApp con credenciales para mandar al usuario
  //
  // La contraseña NO se guarda en Firestore (solo en Auth). El admin la ve
  // SOLO una vez en este modal y debe mandarla por WA inmediatamente.
  // Para resetear despues, usa el boton "Reset + WA".
  function openAddUserModal() {
    const roleOptions = K.ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('');
    const initialPwd = _generateTempPassword();

    const bodyHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group">
          <label>Email <span style="color:#dc2626;">*</span></label>
          <input type="email" id="newUserEmail" placeholder="apellido.nombre@epo67.local" required>
          <small style="color:#64748b;font-size:11px;">Si el docente no tiene email real, usa el formato sintético <code>apellido.nombre@epo67.local</code></small>
        </div>
        <div class="form-group">
          <label>Nombre completo <span style="color:#dc2626;">*</span></label>
          <input type="text" id="newUserName" placeholder="APELLIDO1 APELLIDO2 NOMBRES" required>
        </div>
        <div class="form-group">
          <label>Rol <span style="color:#dc2626;">*</span></label>
          <select id="newUserRole" required>
            <option value="">Seleccionar rol</option>
            ${roleOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Teléfono WhatsApp (opcional, sin lada)</label>
          <input type="tel" id="newUserPhone" placeholder="5512345678">
          <small style="color:#64748b;font-size:11px;">10 dígitos. Sirve para abrir WhatsApp directo con el mensaje.</small>
        </div>
        <div class="form-group">
          <label>Contraseña temporal (auto-generada)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" id="newUserPwd" value="${Utils.sanitize(initialPwd)}" readonly style="font-family:monospace;background:#f8fafc;font-weight:700;color:#0f172a;flex:1;">
            <button type="button" id="regenPwd" class="btn btn-sm btn-outline" title="Generar otra contraseña">
              <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">refresh</span>
            </button>
            <button type="button" id="copyPwdNew" class="btn btn-sm btn-outline" title="Copiar al portapapeles">
              <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">content_copy</span>
            </button>
          </div>
          <small style="color:#64748b;font-size:11px;">Se le mostrará al usuario UNA SOLA VEZ aquí. Después solo se puede resetear (no recuperar).</small>
        </div>
        <div style="background:#eff6ff;border-left:4px solid #3182ce;border-radius:6px;padding:10px 14px;font-size:12px;color:#1e40af;">
          🔒 <strong>Privacidad:</strong> La contraseña NO se guarda en Firestore (solo en Auth, encriptada por Google).
          El usuario tendrá que cambiarla la primera vez que entre. Si la olvida, usa "Reset + WA" para generar una nueva.
        </div>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelAddUser">Cancelar</button>
      <button class="btn btn-primary" id="confirmAddUser">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">arrow_forward</span>
        Generar credenciales
      </button>
    `;

    Modal.open('Crear Usuario + Generar Contraseña', bodyHTML, footerHTML);

    setTimeout(() => {
      document.getElementById('cancelAddUser')?.addEventListener('click', () => Modal.close());
      document.getElementById('confirmAddUser')?.addEventListener('click', saveNewUser);
      document.getElementById('regenPwd')?.addEventListener('click', () => {
        const fld = document.getElementById('newUserPwd');
        if (fld) fld.value = _generateTempPassword();
      });
      document.getElementById('copyPwdNew')?.addEventListener('click', () => {
        const fld = document.getElementById('newUserPwd');
        if (fld?.value) {
          navigator.clipboard?.writeText(fld.value);
          Toast.show('Contraseña copiada', 'success');
        }
      });
    }, 100);
  }

  async function saveNewUser() {
    const email = document.getElementById('newUserEmail')?.value?.trim();
    const displayName = document.getElementById('newUserName')?.value?.trim();
    const role = document.getElementById('newUserRole')?.value;
    const phone = (document.getElementById('newUserPhone')?.value || '').replace(/\D/g, '');
    const password = document.getElementById('newUserPwd')?.value;

    if (!email || !displayName || !role || !password) {
      Toast.show('Email, Nombre, Rol y Contraseña son obligatorios', 'warning');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Toast.show('Formato de email inválido', 'warning');
      return;
    }
    if (password.length < 6) {
      Toast.show('La contraseña debe tener al menos 6 caracteres', 'warning');
      return;
    }

    // Audit log: registramos la INTENCION de crear (sin password) para que
    // quede rastro aunque el admin no termine de correr el script.
    try {
      DB.audit('crear_usuario_solicitado', 'usuario', email, {
        description: `Admin solicitó crear usuario: ${displayName} (${email}) con rol ${role}. Pendiente correr script.`,
        after: { email, displayName, role, hasPhone: !!phone }
      });
    } catch (_) { /* ignorar audit fail */ }

    // Cerrar el modal del formulario y abrir el de instrucciones
    Modal.close();
    setTimeout(() => _showCreateUserInstructionsModal({ email, displayName, role, phone, password }), 250);
  }

  // ─── Modal post-creacion: comando + WA ───
  function _showCreateUserInstructionsModal({ email, displayName, role, phone, password }) {
    const cmdParts = [
      'cd "sistema-escolar-firebase" &&',
      'node scripts/fixes/create-single-user.js',
      `--email "${email}"`,
      `--name "${displayName}"`,
      `--role ${role}`,
      `--password "${password}"`
    ];
    if (phone) cmdParts.push(`--phone ${phone}`);
    const cmd = cmdParts.join(' ');

    const firstName = (displayName.split(' ').slice(-1)[0] || '').replace(/[^a-zA-Z]/g, '');
    const waMessage =
      `Hola ${firstName ? firstName.charAt(0) + firstName.slice(1).toLowerCase() : ''}, soy Olivia del Sistema Escolar EPO 67.\n\n` +
      `Tu cuenta ya está lista. Estos son tus datos para entrar:\n\n` +
      `🔗 https://epo67-sistema.web.app\n` +
      `📧 Correo: ${email}\n` +
      `🔑 Contraseña temporal: ${password}\n\n` +
      `La primera vez que entres, el sistema te pedirá cambiar la contraseña por una propia y registrar un correo personal de respaldo. ` +
      `Te tomará 1 minuto. ¡Bienvenido!`;

    const waHref = phone
      ? `https://wa.me/52${phone}?text=${encodeURIComponent(waMessage)}`
      : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

    const body = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;">
          <strong style="color:#166534;">✓ Credenciales generadas para</strong>
          <ul style="margin:6px 0 0 18px;padding:0;color:#166534;font-size:13px;">
            <li><strong>${Utils.sanitize(displayName)}</strong></li>
            <li>Email: <strong>${Utils.sanitize(email)}</strong></li>
            <li>Rol: <strong>${Utils.sanitize(role)}</strong></li>
            <li>Contraseña: <strong style="background:#fff;padding:2px 6px;border-radius:3px;font-family:monospace;">${Utils.sanitize(password)}</strong></li>
          </ul>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px 14px;border-radius:6px;">
          <strong style="color:#78350f;">Paso 1: aplicar en Firebase Auth</strong><br>
          <span style="font-size:12px;color:#78350f;">Abre tu Terminal en la Mac (cmd+espacio → "Terminal") y pega este comando:</span>
          <div style="position:relative;margin-top:6px;">
            <textarea id="newUserCmd" readonly style="width:100%;padding:8px 10px;font-family:monospace;font-size:11px;border:1px solid #d97706;border-radius:4px;background:#fff;min-height:60px;resize:none;">${Utils.sanitize(cmd)}</textarea>
            <button id="copyNewCmd" class="btn btn-sm btn-warning" style="margin-top:4px;">📋 Copiar comando</button>
          </div>
          <details style="margin-top:8px;font-size:11px;color:#78350f;">
            <summary style="cursor:pointer;font-weight:600;">¿Cómo se ve cuando funciona?</summary>
            <pre style="background:#fff;padding:8px;border-radius:4px;font-size:10px;color:#1e293b;margin-top:6px;white-space:pre-wrap;">✅ USUARIO CREADO EXITOSAMENTE
   uid:      AbCd1234...
   email:    ${Utils.sanitize(email)}
   password: ${Utils.sanitize(password)}
   rol:      ${Utils.sanitize(role)}</pre>
          </details>
        </div>

        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;">
          <strong style="color:#166534;">Paso 2: avisar al usuario por WhatsApp</strong><br>
          <span style="font-size:12px;color:#166534;">Abre WhatsApp con el mensaje pre-llenado:</span>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <a href="${waHref}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25d366;color:#fff;font-weight:700;">
              📱 Abrir WhatsApp ${phone ? '(directo)' : '(elige contacto)'}
            </a>
            <button id="copyNewMsg" class="btn btn-sm btn-outline">Copiar mensaje</button>
          </div>
          <details style="margin-top:8px;font-size:11px;color:#166534;">
            <summary style="cursor:pointer;font-weight:600;">Ver mensaje completo</summary>
            <pre style="background:#fff;padding:8px;border-radius:4px;white-space:pre-wrap;font-size:11px;color:#1e293b;margin-top:6px;">${Utils.sanitize(waMessage)}</pre>
          </details>
        </div>

        <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:10px 14px;border-radius:6px;font-size:12px;color:#991b1b;">
          ⚠ <strong>IMPORTANTE:</strong> esta es la <strong>única vez</strong> que verás esta contraseña.
          Si cierras el modal sin copiarla o mandarla, tendrás que generar una nueva con el botón "Reset + WA" en la lista de usuarios.
        </div>
      </div>`;

    const footer = `<button class="btn btn-primary" data-action="modal-cancel">Listo, ya copié todo</button>`;
    Modal.open('Credenciales para ' + (firstName || 'el nuevo usuario'), body, footer);

    setTimeout(() => {
      document.getElementById('copyNewCmd')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(cmd);
        Toast.show('Comando copiado', 'success');
      });
      document.getElementById('copyNewMsg')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(waMessage);
        Toast.show('Mensaje copiado', 'success');
      });
      document.getElementById('modalFooter')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) {
          Modal.close();
          // Refrescar lista (puede que el usuario ya haya corrido el comando)
          Store.invalidate('users');
          Store.getUsers(true).then(u => { users = u; renderTable(); });
        }
      });
    }, 100);
  }

  async function editRole(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const roleOptions = K.ROLES.map(r =>
      `<option value="${r.id}" ${user.role === r.id ? 'selected' : ''}>${r.label}</option>`
    ).join('');

    // Cargar subjects para el selector de academia (solo si va a ser usado)
    let subjectsAll = [];
    try { subjectsAll = await Store.getSubjects(); } catch (_) {}
    const currentAcademiaSubjects = Array.isArray(user.academiaSubjects) ? user.academiaSubjects : [];
    const currentAcademiaGrados = Array.isArray(user.academiaGrados) ? user.academiaGrados.map(Number) : [];
    const currentAcademiaNombre = user.academiaNombre || '';
    const subjectsOptions = subjectsAll
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
      .map(s => {
        const checked = currentAcademiaSubjects.includes(s.id) ? 'checked' : '';
        return `<label style="display:flex;gap:6px;align-items:center;font-size:13px;padding:3px 0;">
          <input type="checkbox" class="academia-subject-chk" value="${s.id}" ${checked}>
          <span>${Utils.sanitize(s.nombre || s.id)}</span>
        </label>`;
      }).join('');

    const bodyHTML = `
      <div class="form-group">
        <label>Rol</label>
        <select id="editRoleSelect">${roleOptions}</select>
      </div>
      <div id="academia-config" style="display:${user.role === 'presidente_academia' ? 'block' : 'none'};margin-top:12px;padding:14px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:6px;">
        <div style="font-weight:700;color:#155e75;margin-bottom:8px;">📚 Configuración de Academia</div>
        <div class="form-group" style="margin-bottom:10px;">
          <label style="font-size:13px;">Nombre de la academia</label>
          <input type="text" id="academiaNombre" value="${Utils.sanitize(currentAcademiaNombre)}" placeholder="Ej. Academia de Matemáticas" style="width:100%;padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;">
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label style="font-size:13px;">Grados que atiende (selecciona uno o varios)</label>
          <div style="display:flex;gap:14px;">
            ${[1,2,3].map(g => `<label style="display:flex;gap:6px;align-items:center;font-size:13px;">
              <input type="checkbox" class="academia-grado-chk" value="${g}" ${currentAcademiaGrados.includes(g) ? 'checked' : ''}> ${g}°
            </label>`).join('')}
          </div>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:13px;">Materias bajo su academia (${subjectsAll.length} disponibles)</label>
          <div style="max-height:240px;overflow-y:auto;border:1px solid #cbd5e1;border-radius:6px;padding:8px 12px;background:#fff;">
            ${subjectsOptions || '<div style="color:#9ca3af;font-style:italic;">No hay materias en el sistema</div>'}
          </div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px;">Marcadas: <span id="academia-count">${currentAcademiaSubjects.length}</span></div>
        </div>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelEditRole">Cancelar</button>
      <button class="btn btn-primary" id="confirmEditRole">Guardar</button>
    `;

    Modal.open('Editar Rol: ' + Utils.sanitize(user.displayName || user.email), bodyHTML, footerHTML);

    // Mostrar/ocultar config de academia según el rol
    const roleSelect = document.getElementById('editRoleSelect');
    const academiaCfg = document.getElementById('academia-config');
    roleSelect?.addEventListener('change', () => {
      academiaCfg.style.display = roleSelect.value === 'presidente_academia' ? 'block' : 'none';
    });

    // Contador de materias
    const updateCount = () => {
      const n = document.querySelectorAll('.academia-subject-chk:checked').length;
      const el = document.getElementById('academia-count');
      if (el) el.textContent = n;
    };
    document.querySelectorAll('.academia-subject-chk').forEach(c => c.addEventListener('change', updateCount));

    document.getElementById('cancelEditRole').addEventListener('click', () => Modal.close());
    document.getElementById('confirmEditRole').addEventListener('click', async () => {
      const newRole = roleSelect?.value;
      const updates = { role: newRole };
      const before = { role: user.role, academiaNombre: user.academiaNombre, academiaSubjects: user.academiaSubjects, academiaGrados: user.academiaGrados };

      if (newRole === 'presidente_academia') {
        const subjects = Array.from(document.querySelectorAll('.academia-subject-chk:checked')).map(c => c.value);
        const grados = Array.from(document.querySelectorAll('.academia-grado-chk:checked')).map(c => Number(c.value));
        const nombre = document.getElementById('academiaNombre')?.value.trim() || 'Mi Academia';
        updates.academiaNombre = nombre;
        updates.academiaSubjects = subjects;
        updates.academiaGrados = grados;
      }

      try {
        await DB.users().doc(userId).update(updates);
        DB.audit('editar_usuario', 'usuario', userId, {
          description: `Rol cambiado: ${user.displayName || user.email} de ${user.role} a ${newRole}` + (newRole === 'presidente_academia' ? ` (academia: ${updates.academiaNombre}, ${updates.academiaSubjects.length} materias)` : ''),
          before,
          after: { role: newRole, academiaNombre: updates.academiaNombre, academiaSubjects: updates.academiaSubjects, academiaGrados: updates.academiaGrados }
        });
        Modal.close();
        Store.invalidate('users');
        users = await Store.getUsers(true);
        renderTable();
        Toast.show('Rol actualizado', 'success');
      } catch (error) {
        console.error('Error actualizando rol:', error);
        Toast.show('Error al actualizar rol: ' + (error.message || ''), 'error');
      }
    });
  }

  async function toggleStatus(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await DB.users().doc(userId).update({ status: newStatus });
      DB.audit('editar_usuario', 'usuario', userId, {
        description: `Estatus de ${user.displayName || user.email} cambiado a ${newStatus}`,
        before: { status: user.status },
        after: { status: newStatus }
      });
      Store.invalidate('users');
      users = await Store.getUsers(true);
      renderTable();
      Toast.show(`Estado cambiado a ${newStatus === 'active' ? 'activo' : 'inactivo'}`, 'success');
    } catch (error) {
      Toast.show('Error al actualizar estatus', 'error');
    }
  }

  // ─── TOGGLE AUDITOR (rol aditivo) ─────────────────────────────
  // Otorga/quita el flag users.auditorScope. NO toca el rol base — el usuario
  // mantiene sus permisos de maestro/orientador/etc Y SUMA acceso lectura global
  // a indicadores, concentrados, F1 y at-risk de ambos turnos. No genera boletas.
  async function toggleAuditor(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    const currently = user.auditorScope === true;
    const action = currently ? 'QUITAR' : 'OTORGAR';
    const confirmMsg = currently
      ? `¿Quitar el acceso de AUDITOR a ${user.displayName || user.email}?\n\nPerderá la visibilidad de indicadores/concentrados/F1 de otros turnos. Mantiene su rol base (${user.role}).`
      : `¿OTORGAR acceso de AUDITOR a ${user.displayName || user.email}?\n\nPodrá VER (solo lectura) indicadores, concentrados, F1 y at-risk de TODA la escuela en ambos turnos. NO podrá editar nada ni generar boletas.\n\nSu rol base (${user.role}) NO cambia.`;
    if (!confirm(confirmMsg)) return;

    try {
      await DB.users().doc(userId).update({ auditorScope: !currently });
      DB.audit('editar_usuario', 'usuario', userId, {
        description: `Flag auditor de ${user.displayName || user.email} cambiado a ${!currently}`,
        before: { auditorScope: currently },
        after: { auditorScope: !currently }
      });
      Store.invalidate('users');
      users = await Store.getUsers(true);
      renderTable();
      Toast.show(`Auditor ${action === 'OTORGAR' ? 'otorgado' : 'quitado'} a ${user.displayName || user.email}`, 'success');
    } catch (error) {
      console.error('toggleAuditor:', error);
      Toast.show('Error al cambiar flag auditor: ' + error.message, 'error');
    }
  }

  // ─── MENSAJE MASIVO DE BIENVENIDA ────────────────────────────
  // Muestra una lista de TODOS los usuarios activos (filtrable por rol).
  // Para cada uno: botón "Abrir WhatsApp" con mensaje personalizado pre-llenado.
  // No envía nada solo: Olivia hace clic uno por uno y va mandando.
  // (Es lo más rápido sin pagar Twilio/WA Business API.)
  function openMassWelcomeModal() {
    const targetableUsers = users.filter(u =>
      u.status === 'active' &&
      ['maestro', 'orientador_docente', 'orientador'].includes(u.role)
    );

    const tplTextarea = `Hola {NOMBRE}, soy Olivia, del Sistema Escolar EPO 67.

Tu cuenta para capturar calificaciones ya está activa.

🔗 https://epo67-sistema.web.app
📧 Correo: {EMAIL}

📅 IMPORTANTE: del 11 al 14 de mayo capturas las calificaciones de tus 3 parciales (todos los grupos y materias).

🎓 Cuando entres POR PRIMERA VEZ:
1. Te pedirá cambiar tu contraseña por una propia.
2. Registra un correo personal de respaldo (gmail/hotmail) — si la olvidas, te llega ahí y la recuperas en segundos.
3. Te saldrá automático el TUTORIAL guiado. NO lo saltes — son 2 minutos y te explica todo.
4. Hay un nuevo botón verde "🆘 Centro de Ayuda" en el menú con el manual completo, video, preguntas frecuentes y todo.

🆘 Si te atoras EN CUALQUIER MOMENTO:
• Botón verde de WhatsApp en la esquina del sistema → me llega directo
• O presiona ⌘K (Mac) / Ctrl+K (Windows) y escribe tu duda como en Google
• El sistema te responde en el momento.

NO te frustres. Está hecho fácil. Te toma 5-10 minutos por grupo.

¡Vamos! 💪
— Olivia`;

    const userRows = targetableUsers.map(u => {
      const phone = (u.phone || '').replace(/\D/g, '');
      const firstName = (u.displayName || '').split(' ').slice(-1)[0]
        ?.charAt(0) + (u.displayName || '').split(' ').slice(-1)[0]?.slice(1).toLowerCase() || '';
      const msg = tplTextarea
        .replace('{NOMBRE}', firstName || u.displayName || '')
        .replace('{EMAIL}', u.email || '');
      const waLink = phone
        ? `https://wa.me/52${phone}?text=${encodeURIComponent(msg)}`
        : `https://wa.me/?text=${encodeURIComponent(msg)}`;

      return `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 4px;font-size:12px;">
            <div style="font-weight:600;color:#1e293b;">${Utils.sanitize(u.displayName || u.email)}</div>
            <div style="color:#64748b;font-size:11px;">${Utils.sanitize(u.email)}</div>
          </td>
          <td style="padding:8px 4px;font-size:12px;color:#64748b;">${u.role}</td>
          <td style="padding:8px 4px;font-size:12px;">
            ${phone ? `<span style="color:#16a34a;">${Utils.sanitize(phone)}</span>` : '<span style="color:#dc2626;font-size:11px;">sin tel.</span>'}
          </td>
          <td style="padding:8px 4px;text-align:right;">
            <a href="${waLink}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25d366;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;">
              📱 Mandar WA
            </a>
            <button data-copy-msg="${encodeURIComponent(msg)}" class="btn btn-sm btn-outline" style="font-size:11px;padding:4px 8px;">
              📋
            </button>
          </td>
        </tr>`;
    }).join('');

    const body = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;font-size:13px;color:#166534;">
          <strong>📣 Cómo usar este envío masivo:</strong>
          <ol style="margin:6px 0 0 18px;padding:0;">
            <li>Revisa la plantilla del mensaje abajo. Edítala si quieres.</li>
            <li>Para CADA maestro, clic en "📱 Mandar WA" → abre WhatsApp con el mensaje pre-llenado y personalizado.</li>
            <li>En WhatsApp Web/App, simplemente le das ENVIAR.</li>
            <li>Repites para los ${targetableUsers.length} maestros (toma ~10 minutos en total).</li>
          </ol>
        </div>

        <div class="form-group">
          <label style="font-weight:700;font-size:13px;">📝 Plantilla del mensaje (la puedes editar)</label>
          <textarea id="mwTemplate" style="width:100%;min-height:240px;padding:10px;border:1px solid #cbd5e0;border-radius:6px;font-family:inherit;font-size:12px;line-height:1.4;">${tplTextarea}</textarea>
          <small style="color:#64748b;font-size:11px;">
            <strong>{NOMBRE}</strong> y <strong>{EMAIL}</strong> se reemplazan automáticamente para cada maestro.
            Si editas, presiona "🔄 Regenerar enlaces" abajo.
          </small>
          <button id="mwRegen" class="btn btn-sm btn-outline" style="margin-top:6px;">🔄 Regenerar enlaces con la nueva plantilla</button>
        </div>

        <div class="card" style="padding:0;max-height:380px;overflow-y:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead style="background:#f8fafc;position:sticky;top:0;">
              <tr>
                <th style="padding:8px 4px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Docente</th>
                <th style="padding:8px 4px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Rol</th>
                <th style="padding:8px 4px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Tel.</th>
                <th style="padding:8px 4px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;">Acción</th>
              </tr>
            </thead>
            <tbody id="mwTableBody">${userRows}</tbody>
          </table>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px 14px;border-radius:6px;font-size:12px;color:#78350f;">
          ⚠ <strong>Maestros sin teléfono</strong>: el botón abre WhatsApp pero te pide elegir contacto manualmente.
          Para que el envío sea automático, asegúrate de que cada usuario tenga su teléfono en su perfil
          (lo puedes editar en "Reset + WA" o cuando crees al usuario).
        </div>
      </div>`;

    const footer = `<button class="btn btn-primary" data-action="modal-cancel">Cerrar</button>`;
    Modal.open('Mensaje masivo de bienvenida — ' + targetableUsers.length + ' maestros', body, footer);

    setTimeout(() => {
      // Botón regenerar: re-renderiza la tabla con la nueva plantilla
      document.getElementById('mwRegen')?.addEventListener('click', () => {
        const newTpl = document.getElementById('mwTemplate')?.value || tplTextarea;
        const tbody = document.getElementById('mwTableBody');
        if (!tbody) return;
        tbody.innerHTML = targetableUsers.map(u => {
          const phone = (u.phone || '').replace(/\D/g, '');
          const lastName = (u.displayName || '').split(' ').slice(-1)[0] || '';
          const firstName = lastName.charAt(0) + lastName.slice(1).toLowerCase();
          const msg = newTpl
            .replace(/\{NOMBRE\}/g, firstName || u.displayName || '')
            .replace(/\{EMAIL\}/g, u.email || '');
          const waLink = phone
            ? `https://wa.me/52${phone}?text=${encodeURIComponent(msg)}`
            : `https://wa.me/?text=${encodeURIComponent(msg)}`;
          return `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 4px;font-size:12px;">
                <div style="font-weight:600;color:#1e293b;">${Utils.sanitize(u.displayName || u.email)}</div>
                <div style="color:#64748b;font-size:11px;">${Utils.sanitize(u.email)}</div>
              </td>
              <td style="padding:8px 4px;font-size:12px;color:#64748b;">${u.role}</td>
              <td style="padding:8px 4px;font-size:12px;">
                ${phone ? `<span style="color:#16a34a;">${Utils.sanitize(phone)}</span>` : '<span style="color:#dc2626;font-size:11px;">sin tel.</span>'}
              </td>
              <td style="padding:8px 4px;text-align:right;">
                <a href="${waLink}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25d366;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;">📱 Mandar WA</a>
                <button data-copy-msg="${encodeURIComponent(msg)}" class="btn btn-sm btn-outline" style="font-size:11px;padding:4px 8px;">📋</button>
              </td>
            </tr>`;
        }).join('');
        // Re-bind copy buttons
        bindCopy();
        Toast.show('Enlaces regenerados con la nueva plantilla', 'success');
      });

      // Botón cerrar
      document.getElementById('modalFooter')?.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
      });

      function bindCopy() {
        document.querySelectorAll('[data-copy-msg]').forEach(btn => {
          btn.addEventListener('click', () => {
            const msg = decodeURIComponent(btn.dataset.copyMsg);
            navigator.clipboard?.writeText(msg);
            Toast.show('Mensaje copiado al portapapeles', 'success');
          });
        });
      }
      bindCopy();
    }, 100);
  }

  // ─── CARTAS PERSONALES (PDF con 1 hoja por maestro) ──────────
  // Es el reemplazo del WhatsApp masivo: genera un PDF con 1 hoja por maestro
  // que contiene SUS credenciales + manual + tutorial. Olivia puede:
  //   - Imprimirlo y entregarlo en mano
  //   - Subirlo a Drive y compartir el folder con la escuela
  //   - Mandarlo por correo institucional
  // Cada maestro busca SU hoja por su nombre.
  //
  // PROBLEMA DE SEGURIDAD: las contraseñas en cleartext NO están guardadas en
  // Firestore (solo en Auth). Por eso este flujo solo funciona PARA USUARIOS
  // QUE TIENES QUE CREAR DESDE CERO con el script. Para usuarios que ya
  // existen, se requiere un reset previo (que ya tiene su flujo en "Reset + WA").
  function openGenerateLettersModal() {
    const targetable = users.filter(u =>
      u.status === 'active' &&
      ['maestro', 'orientador_docente', 'orientador'].includes(u.role)
    );

    const body = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;font-size:13px;color:#166534;">
          <strong>📄 ¿Qué es esto?</strong>
          <p style="margin:6px 0 0;">Genera un PDF con UNA HOJA por maestro. Cada hoja trae:</p>
          <ul style="margin:4px 0 0 18px;">
            <li>Nombre, email y contraseña inicial</li>
            <li>Manual rápido de captura</li>
            <li>Calendario crítico</li>
            <li>QR para abrir el sistema</li>
          </ul>
          <p style="margin:8px 0 0;"><strong>Lo subes a Drive y compartes el link con tu personal — como hacían en el sistema anterior.</strong></p>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px 14px;border-radius:6px;font-size:12px;color:#78350f;">
          ⚠ <strong>Importante sobre las contraseñas:</strong>
          <ul style="margin:4px 0 0 18px;">
            <li>El sistema NO guarda contraseñas en cleartext (es ilegal y mala práctica).</li>
            <li>Solo puedo poner contraseñas <em>nuevas</em> para los maestros que voy a crear/resetear ahora.</li>
            <li>Si un maestro ya cambió su contraseña, en su carta aparecerá <strong>[contraseña personal — la que el maestro ya tiene]</strong>.</li>
            <li>Para forzar reset masivo y poner contraseñas nuevas a TODOS, marca la opción de abajo.</li>
          </ul>
        </div>

        <div class="form-group">
          <label style="display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="ltrResetAll" style="margin:0;width:auto;">
            <span>Generar contraseñas NUEVAS para TODOS (incluso si ya cambiaron la suya)</span>
          </label>
          <small style="color:#64748b;font-size:11px;display:block;margin-top:4px;">
            Si la marcas: se generará una contraseña nueva por maestro y se marcarán como mustChangePassword=true en Firestore.
            <strong>Aún tienes que correr un script en Terminal para aplicar los resets en Auth</strong> (te muestro el comando al final).
          </small>
        </div>

        <div class="form-group">
          <label style="display:flex;gap:8px;align-items:center;font-weight:600;cursor:pointer;">
            <input type="checkbox" id="ltrOnlyPending" checked style="margin:0;width:auto;">
            <span>Solo incluir maestros con mustChangePassword=true (pendientes de primer ingreso)</span>
          </label>
        </div>

        <div style="font-size:13px;color:#1e293b;">
          <strong>Maestros encontrados:</strong> ${targetable.length}<br>
          <strong>Pendientes de primer ingreso:</strong> ${targetable.filter(u => u.mustChangePassword).length}
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" id="ltrGenerate" style="background:#dc2626;border-color:#dc2626;font-weight:700;">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">picture_as_pdf</span>
        Generar PDF
      </button>`;

    Modal.open('Cartas personales para los maestros', body, footer);

    setTimeout(() => {
      document.getElementById('modalFooter')?.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
        if (e.target.closest('#ltrGenerate')) {
          const onlyPending = document.getElementById('ltrOnlyPending')?.checked;
          const resetAll = document.getElementById('ltrResetAll')?.checked;
          const targets = onlyPending ? targetable.filter(u => u.mustChangePassword) : targetable;
          if (targets.length === 0) {
            Toast.show('No hay maestros que cumplan el filtro', 'warning');
            return;
          }
          // Generar contraseñas nuevas si "resetAll" está marcado
          const withCreds = targets.map(u => ({
            user: u,
            tempPwd: resetAll ? _generateTempPassword() : (u.mustChangePassword ? '[contraseña que te dieron]' : '[contraseña personal — la que el maestro ya tiene]')
          }));
          // Si resetAll, marcar todos como mustChangePassword en Firestore
          if (resetAll) {
            try {
              await Promise.all(withCreds.map(({ user }) =>
                DB.users().doc(user.id).update({ mustChangePassword: true })
                  .catch(e => console.warn('Reset mark failed for', user.id, e))
              ));
              Toast.show('Marcados como reset pendiente en Firestore', 'info');
            } catch (e) {
              Toast.show('Algunos no se pudieron marcar: ' + e.message, 'warning');
            }
          }

          Modal.close();
          _printLettersPDF(withCreds, resetAll);
        }
      });
    }, 100);
  }

  // Genera el PDF con 1 hoja por maestro abriendo una ventana
  function _printLettersPDF(withCreds, withRealPwds) {
    const w = window.open('', '_blank');
    if (!w) {
      Toast.show('Activa los pop-ups para generar el PDF', 'warning');
      return;
    }

    const pages = withCreds.map(({ user, tempPwd }) => {
      const firstName = (user.displayName || user.email || '').split(' ').slice(-1)[0];
      const fname = firstName ? firstName.charAt(0) + firstName.slice(1).toLowerCase() : 'docente';
      return `
        <section class="letter-page">
          <header class="lh">
            <div class="lh-school">
              <strong>ESCUELA PREPARATORIA OFICIAL No. 67</strong><br>
              <span style="font-size:9pt;color:#64748b;">Sistema Escolar — Acceso para personal docente</span>
            </div>
            <div class="lh-school" style="text-align:right;">
              <span style="font-size:8pt;color:#64748b;">Ciclo escolar 2025-2026<br>Mayo 2026</span>
            </div>
          </header>

          <h1 class="hello">Hola, ${Utils.sanitize(fname)}</h1>
          <p class="intro">Soy Olivia. Tu cuenta personal del Sistema Escolar EPO 67 ya está activa. Aquí tienes tus datos para entrar y todo lo que necesitas saber para capturar tus calificaciones.</p>

          <div class="creds">
            <h2>🔐 Tus datos de acceso</h2>
            <table>
              <tr><td><strong>Sistema:</strong></td><td><code>https://epo67-sistema.web.app</code></td></tr>
              <tr><td><strong>Tu correo:</strong></td><td><code>${Utils.sanitize(user.email || '')}</code></td></tr>
              <tr><td><strong>Contraseña inicial:</strong></td><td><code>${Utils.sanitize(tempPwd)}</code></td></tr>
              <tr><td><strong>Tu nombre:</strong></td><td>${Utils.sanitize(user.displayName || '')}</td></tr>
              <tr><td><strong>Tu rol:</strong></td><td>${Utils.sanitize(user.role)}</td></tr>
            </table>
          </div>

          <div class="grid2">
            <div class="card-info">
              <h2>📅 Cuándo capturar</h2>
              <ul>
                <li><strong>11 al 14 de mayo:</strong> captura abierta</li>
                <li><strong>14 de mayo:</strong> entrega listas firmadas</li>
                <li><strong>17 y 18 de mayo:</strong> correcciones (con solicitud)</li>
              </ul>
            </div>

            <div class="card-info warn">
              <h2>⚠ Reglas importantes</h2>
              <ul>
                <li>Si SUMA &lt; 6 → calificación = <strong>5</strong></li>
                <li>Si faltas &gt; 20% → <strong>EXTRAORDINARIO</strong></li>
                <li>Si reprueba (5) → registrar motivo OBLIGATORIO</li>
              </ul>
            </div>
          </div>

          <div class="card-info success">
            <h2>📱 Tu primer ingreso (5 min)</h2>
            <ol>
              <li>Entra a <strong>epo67-sistema.web.app</strong> en tu compu o celular.</li>
              <li>Pega tu correo y contraseña inicial (los de arriba).</li>
              <li>El sistema te pide cambiar la contraseña, registrar correo de respaldo y tu teléfono.</li>
              <li>Te lleva al <strong>Centro de Ayuda</strong>: ahí está el manual, video, tutorial guiado y FAQ.</li>
              <li>Imprime tus listas (Mis Listas) y captura tu primer alumno de prueba.</li>
            </ol>
          </div>

          <footer class="lf">
            <div class="lf-help">
              <strong>🆘 Si te atoras</strong><br>
              Botón verde de WhatsApp en el sistema → Olivia<br>
              O directo: <strong>55 1078 2357</strong><br>
              ⌘K / Ctrl+K → buscador de preguntas frecuentes
            </div>
            <div class="lf-warn">
              <strong>⚠ Tu contraseña es PERSONAL</strong><br>
              No la compartas. La cambias al entrar.<br>
              Si la pierdes, el sistema te ayuda a recuperarla.
            </div>
          </footer>
        </section>`;
    }).join('');

    w.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Cartas personales — EPO 67</title>
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:#1e293b; margin:0; line-height:1.4; font-size:10pt; }
  .letter-page {
    width: 8.5in;
    height: 11in;
    padding: 0.5in;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lh {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #3182ce;
    padding-bottom: 8px;
  }
  .lh-school strong { color:#1e40af; font-size:13pt; }
  h1.hello {
    font-size: 28pt;
    margin: 16px 0 8px;
    color: #1e40af;
  }
  p.intro { font-size: 11pt; color:#475569; margin: 0 0 12px; }
  .creds {
    background: #eff6ff;
    border-left: 5px solid #3182ce;
    padding: 14px 18px;
    border-radius: 6px;
  }
  .creds h2 { margin: 0 0 8px; font-size: 12pt; color:#1e40af; }
  .creds table { width: 100%; }
  .creds td { padding: 3px 0; font-size: 11pt; vertical-align: top; }
  .creds td:first-child { width: 130px; color:#475569; }
  .creds code {
    background: #fff;
    padding: 3px 8px;
    border: 1px solid #cbd5e0;
    border-radius: 4px;
    font-size: 11pt;
    font-weight: 600;
    color: #1e293b;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .card-info {
    background: #f8fafc;
    border-left: 4px solid #64748b;
    padding: 10px 14px;
    border-radius: 6px;
  }
  .card-info.warn { background: #fef3c7; border-left-color: #d97706; }
  .card-info.success { background: #f0fdf4; border-left-color: #16a34a; }
  .card-info h2 { margin: 0 0 6px; font-size: 11pt; }
  .card-info ul, .card-info ol { margin: 0; padding-left: 16px; font-size: 9.5pt; line-height: 1.5; }
  .card-info li { margin: 1px 0; }
  .lf {
    margin-top: auto;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 10px;
    border-top: 2px dashed #cbd5e0;
    padding-top: 10px;
  }
  .lf-help, .lf-warn {
    font-size: 9pt;
    line-height: 1.5;
    padding: 8px 10px;
    border-radius: 6px;
  }
  .lf-help { background: #dcfce7; color: #166534; }
  .lf-warn { background: #fee2e2; color: #991b1b; }
</style></head><body>${pages}<script>setTimeout(function(){ window.print(); }, 600);</script></body></html>`);
    w.document.close();

    // Si reseteamos contraseñas, mostrar comando para correr en Terminal
    if (withRealPwds) {
      setTimeout(() => {
        const cmds = withCreds.map(({ user, tempPwd }) =>
          `node scripts/fixes/reset-user-password.js ${user.id} "${tempPwd}"`
        ).join('\n');

        const cmdBody = `
          <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:10px 14px;border-radius:6px;margin-bottom:14px;">
            <strong>⚠ Falta el paso final: aplicar los resets en Firebase Auth</strong>
            <p style="margin:6px 0 0;font-size:13px;">
              El PDF se generó. Pero para que las contraseñas funcionen, debes correr estos comandos en tu Terminal de Mac:
            </p>
          </div>
          <div style="margin-bottom:8px;">
            <button id="cmdsCopy" class="btn btn-warning btn-sm">📋 Copiar TODOS los comandos</button>
          </div>
          <textarea readonly style="width:100%;min-height:300px;padding:10px;font-family:monospace;font-size:11px;border:1px solid #cbd5e0;border-radius:6px;background:#0f172a;color:#22c55e;">cd "sistema-escolar-firebase"\n${cmds}</textarea>
          <p style="margin-top:8px;font-size:12px;color:#64748b;">
            Pega esto en Terminal y dale Enter. Tarda ~10 segundos por maestro (~10 min para 60).
            Cuando termine, los maestros ya pueden entrar con sus contraseñas del PDF.
          </p>`;
        Modal.open('Aplicar resets en Auth — paso final', cmdBody,
          `<button class="btn btn-primary" data-action="modal-cancel">Listo</button>`);
        setTimeout(() => {
          document.getElementById('cmdsCopy')?.addEventListener('click', () => {
            navigator.clipboard?.writeText(`cd "sistema-escolar-firebase"\n${cmds}`);
            Toast.show('Comandos copiados', 'success');
          });
          document.getElementById('modalFooter')?.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
          });
        }, 100);
      }, 1000);
    } else {
      Toast.show('PDF generado en otra ventana. Imprime o guarda como PDF.', 'success');
    }
  }

  // ─── EXPORTAR CREDENCIALES (Excel/Sheets) ─────────────────────
  function openExportCredentialsModal() {
    const targetable = users.filter(u =>
      u.status === 'active' &&
      ['maestro', 'orientador_docente', 'orientador'].includes(u.role)
    );

    // Construir tabla en formato compatible con Google Sheets
    // Headers: Nombre | Email | Contraseña | Rol | Teléfono | Recovery | Estado
    const rows = targetable.map(u => ({
      Nombre: u.displayName || '',
      Email: u.email || '',
      'Contraseña': u.mustChangePassword ? '[pendiente — usa Reset+WA o Cartas]' : '[contraseña personal del maestro]',
      Rol: u.role || '',
      'Teléfono WA': u.phone || '',
      'Correo respaldo': u.recoveryEmail || '',
      'Estado contraseña': u.mustChangePassword ? 'PENDIENTE PRIMER INGRESO' : 'CONFIGURADA',
    }));

    const body = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:10px 14px;border-radius:6px;font-size:13px;color:#166534;">
          <strong>📊 Exportar a Excel/Google Sheets</strong>
          <p style="margin:6px 0 0;">Descarga un Excel con los datos de ${targetable.length} maestros activos. Lo puedes:</p>
          <ul style="margin:4px 0 0 18px;">
            <li>Importar a Google Sheets (subir → abrir como Sheet)</li>
            <li>Mandarlo por correo institucional</li>
            <li>Filtrar/ordenar por rol, estado de contraseña, etc.</li>
          </ul>
        </div>

        <div style="background:#fef3c7;border-left:4px solid #d97706;padding:10px 14px;border-radius:6px;font-size:12px;color:#78350f;">
          ⚠ <strong>El Excel NO incluye contraseñas en cleartext</strong> por seguridad.
          Si necesitas mandar contraseñas a los maestros, usa el botón <strong>"Cartas personales (PDF)"</strong>
          que genera contraseñas nuevas en el momento.
        </div>

        <div style="max-height:200px;overflow:auto;font-size:11px;background:#f8fafc;padding:8px;border-radius:6px;border:1px solid #e2e8f0;">
          <strong>Vista previa:</strong>
          <table style="width:100%;border-collapse:collapse;margin-top:6px;">
            <thead style="background:#fff;">
              <tr>${Object.keys(rows[0] || {}).map(k => `<th style="padding:4px 6px;text-align:left;font-size:10px;border-bottom:1px solid #cbd5e0;">${k}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${rows.slice(0, 5).map(r => `<tr>${Object.values(r).map(v => `<td style="padding:3px 6px;font-size:10px;border-bottom:1px solid #f1f5f9;">${Utils.sanitize(String(v))}</td>`).join('')}</tr>`).join('')}
              ${rows.length > 5 ? `<tr><td colspan="${Object.keys(rows[0] || {}).length}" style="padding:6px;text-align:center;color:#64748b;font-style:italic;">... y ${rows.length - 5} maestros más</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>`;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" id="expExcel" style="background:#16a34a;border-color:#16a34a;font-weight:700;">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">download</span>
        Descargar Excel
      </button>`;

    Modal.open('Exportar credenciales', body, footer);

    setTimeout(() => {
      document.getElementById('modalFooter')?.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="modal-cancel"]')) Modal.close();
        if (e.target.closest('#expExcel')) {
          try {
            const filename = `credenciales-maestros-${new Date().toISOString().slice(0, 10)}`;
            if (Utils.exportToExcel) {
              await Utils.exportToExcel(rows, filename);
              Toast.show('Excel descargado', 'success');
              Modal.close();
            } else {
              // Fallback: CSV
              const headers = Object.keys(rows[0] || {});
              const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = filename + '.csv';
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
              Toast.show('CSV descargado', 'success');
              Modal.close();
            }
          } catch (e) {
            Toast.show('Error: ' + e.message, 'error');
          }
        }
      });
    }, 100);
  }

  return { render, stopImpersonation, restoreImpersonationFromSession };
})();

Router.modules['users-mgmt'] = () => UsersMgmt.render();
