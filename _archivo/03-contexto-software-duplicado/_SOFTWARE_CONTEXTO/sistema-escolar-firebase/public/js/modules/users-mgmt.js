/**
 * USER MANAGEMENT MODULE
 * Admin panel for managing user accounts and roles
 */

const UsersMgmt = (() => {
  let users = [];

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
            <h1 class="module-title">Gesti\u00f3n de Usuarios</h1>
            <p class="module-subtitle">Administra cuentas de usuario y roles del sistema</p>
          </div>
          <div class="module-actions">
            <button class="btn btn-primary" data-action="add-user">Agregar Usuario</button>
          </div>
        </div>
        <div id="usersTableContainer"></div>
      </div>
    `;

    users = await Store.getUsers();
    renderTable();
    bindEvents();
  }

  function renderTable() {
    const tableContainer = document.getElementById('usersTableContainer');

    if (users.length === 0) {
      tableContainer.innerHTML = `<div class="empty-state"><span class="material-icons-round empty-state-icon">people</span><p class="empty-state-text">No se encontraron usuarios</p></div>`;
      return;
    }

    const rows = users.map(user => {
      const createdDate = user.createdAt
        ? new Date(user.createdAt.toDate?.() || user.createdAt).toLocaleDateString()
        : '-';
      const roleColor = K.getRoleColor(user.role);
      const isActive = user.status === 'active';

      return `
        <tr>
          <td class="font-semibold">${Utils.sanitize(user.displayName || '-')}</td>
          <td class="text-muted">${Utils.sanitize(user.email)}</td>
          <td><span class="badge" style="background-color: ${roleColor}20; color: ${roleColor};">${Utils.sanitize(user.role)}</span></td>
          <td>${isActive ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>'}</td>
          <td class="text-muted">${createdDate}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" data-action="edit-role" data-user-id="${user.id}">Editar Rol</button>
              <button class="btn btn-sm btn-outline" data-action="toggle-status" data-user-id="${user.id}">Cambiar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tableContainer.innerHTML = `
      <div class="table-container">
        <table class="table-light">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function bindEvents() {
    const container = document.getElementById('moduleContainer');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const { action, userId } = btn.dataset;

      switch (action) {
        case 'add-user': openAddUserModal(); break;
        case 'edit-role': editRole(userId); break;
        case 'toggle-status': toggleStatus(userId); break;
      }
    });
  }

  function openAddUserModal() {
    const roleOptions = K.ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('');

    const bodyHTML = `
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="newUserEmail" placeholder="user@example.com" required>
      </div>
      <div class="form-group">
        <label>Nombre</label>
        <input type="text" id="newUserName" placeholder="Nombre completo" required>
      </div>
      <div class="form-group">
        <label>Rol</label>
        <select id="newUserRole" required>
          <option value="">Seleccionar rol</option>
          ${roleOptions}
        </select>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelAddUser">Cancelar</button>
      <button class="btn btn-primary" id="confirmAddUser">Agregar</button>
    `;

    Modal.open('Agregar Usuario', bodyHTML, footerHTML);

    document.getElementById('cancelAddUser').addEventListener('click', () => Modal.close());
    document.getElementById('confirmAddUser').addEventListener('click', saveNewUser);
  }

  async function saveNewUser() {
    const email = document.getElementById('newUserEmail')?.value;
    const displayName = document.getElementById('newUserName')?.value;
    const role = document.getElementById('newUserRole')?.value;

    if (!email || !displayName || !role) {
      Toast.show('Todos los campos son requeridos', 'warning');
      return;
    }

    try {
      const docId = email.replace(/[^a-z0-9]/gi, '');
      await DB.users().doc(docId).set({
        email, displayName, role, status: 'active',
        createdAt: new Date(), autoCreado: false
      });
      DB.audit('crear_usuario', 'usuario', docId, {
        description: `Usuario creado: ${displayName} (${email}) con rol ${role}`,
        after: { email, displayName, role }
      });
      Modal.close();
      Store.invalidate('users');
      users = await Store.getUsers(true);
      renderTable();
      Toast.show('Usuario agregado', 'success');
    } catch (error) {
      Toast.show('Error al agregar usuario', 'error');
    }
  }

  function editRole(userId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const roleOptions = K.ROLES.map(r =>
      `<option value="${r.id}" ${user.role === r.id ? 'selected' : ''}>${r.label}</option>`
    ).join('');

    const bodyHTML = `
      <div class="form-group">
        <label>Rol</label>
        <select id="editRoleSelect">${roleOptions}</select>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelEditRole">Cancelar</button>
      <button class="btn btn-primary" id="confirmEditRole">Guardar</button>
    `;

    Modal.open('Editar Rol: ' + Utils.sanitize(user.displayName || user.email), bodyHTML, footerHTML);

    document.getElementById('cancelEditRole').addEventListener('click', () => Modal.close());
    document.getElementById('confirmEditRole').addEventListener('click', async () => {
      const newRole = document.getElementById('editRoleSelect')?.value;
      try {
        await DB.users().doc(userId).update({ role: newRole });
        DB.audit('editar_usuario', 'usuario', userId, {
          description: `Rol cambiado: ${user.displayName || user.email} de ${user.role} a ${newRole}`,
          before: { role: user.role },
          after: { role: newRole }
        });
        Modal.close();
        Store.invalidate('users');
        users = await Store.getUsers(true);
        renderTable();
        Toast.show('Rol actualizado', 'success');
      } catch (error) {
        Toast.show('Error al actualizar rol', 'error');
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

  return { render };
})();

Router.modules['users-mgmt'] = () => UsersMgmt.render();
