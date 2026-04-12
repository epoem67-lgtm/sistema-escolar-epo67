/**
 * PARTIAL CLOSE MODULE (Cierre de Parciales)
 * Manages locking/unlocking of evaluation periods
 * Supports per-teacher overrides and scheduled closes
 */

const PartialCloseModule = (() => {
  let overrides = [];

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">Control de Parciales</h1>
            <p class="module-subtitle">Gestiona el estado de cada parcial. Cuando est\u00e1 cerrado, los docentes no pueden modificar calificaciones.</p>
          </div>
        </div>
        <div id="partials-grid" class="stats-grid"></div>
      </div>
    `;

    await loadAndRenderPartials();
    bindEvents();
  }

  async function loadOverrides() {
    try {
      const snap = await db.collection('partialOverrides').get();
      overrides = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      overrides = [];
    }
  }

  async function loadAndRenderPartials() {
    const grid = document.getElementById('partials-grid');
    if (!grid) return;
    grid.innerHTML = '';

    await loadOverrides();

    for (const partial of K.PARCIALES) {
      const docRef = db.collection('partials').doc(partial.id);
      const doc = await docRef.get();
      const data = doc.exists ? doc.data() : { locked: false, nombre: partial.nombre, numero: partial.numero };

      // Check scheduled close
      if (!data.locked && data.scheduledCloseAt) {
        const scheduledDate = data.scheduledCloseAt.toDate ? data.scheduledCloseAt.toDate() : new Date(data.scheduledCloseAt);
        if (scheduledDate <= new Date()) {
          await db.collection('partials').doc(partial.id).update({ locked: true, updatedAt: new Date(), updatedBy: 'sistema-auto' });
          data.locked = true;
          Toast.show(`${data.nombre} cerrado autom\u00e1ticamente por fecha programada`, 'info');
        }
      }

      const gradesSnap = await db.collection('grades')
        .where('partial', '==', partial.id)
        .get();

      const partialOverrides = overrides.filter(o => o.partialId === partial.id);

      grid.innerHTML += buildPartialCard(partial, data, gradesSnap.size, partialOverrides);
    }
  }

  function buildPartialCard(partial, data, gradeCount, partialOverrides) {
    const isLocked = data.locked || false;
    const statusClass = isLocked ? 'closed' : 'open';
    const statusIcon = isLocked ? '\uD83D\uDD12' : '\uD83D\uDD13';
    const statusText = isLocked ? 'Cerrado' : 'Abierto';
    const isAdmin = App.currentUser?.role === 'admin';

    // Scheduled close info
    let scheduledInfo = '';
    if (data.scheduledCloseAt && !isLocked) {
      const d = data.scheduledCloseAt.toDate ? data.scheduledCloseAt.toDate() : new Date(data.scheduledCloseAt);
      scheduledInfo = `<div class="badge badge-warning mt-sm">Cierre programado: ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>`;
    }

    // Active overrides list
    let overridesHTML = '';
    if (isLocked && partialOverrides.length > 0 && isAdmin) {
      const activeOverrides = partialOverrides.filter(o => {
        if (!o.expiresAt) return true;
        const exp = o.expiresAt.toDate ? o.expiresAt.toDate() : new Date(o.expiresAt);
        return exp > new Date();
      });
      if (activeOverrides.length > 0) {
        overridesHTML = `
          <div class="mt-sm">
            <div class="stat-label mb-sm">Docentes con acceso especial:</div>
            ${activeOverrides.map(o => `
              <div class="flex justify-between items-center mb-sm">
                <span class="badge badge-warning">${Utils.sanitize(o.teacherName)}</span>
                <button class="btn btn-sm btn-danger" data-action="remove-override" data-override-id="${o.id}">&times;</button>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    const adminButtons = isAdmin ? `
      <div class="btn-group mt-sm" style="flex-direction:column;gap:var(--spacing-sm)">
        <button class="btn w-full ${isLocked ? 'btn-warning' : 'btn-danger'}"
                data-action="${isLocked ? 'unlock' : 'lock'}"
                data-partial-id="${partial.id}"
                data-partial-name="${Utils.sanitize(data.nombre)}">
          ${isLocked ? '\uD83D\uDD13 Abrir Parcial' : '\uD83D\uDD12 Cerrar Parcial'}
        </button>
        ${isLocked ? `
          <button class="btn btn-primary btn-sm w-full"
                  data-action="teacher-override"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre)}">
            Desbloquear Docente Espec\u00edfico
          </button>
        ` : `
          <button class="btn btn-outline btn-sm w-full"
                  data-action="schedule-close"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre)}">
            Programar Cierre
          </button>
        `}
      </div>
    ` : '';

    return `
      <div class="partial-card">
        <div class="partial-card-header">
          <h3 class="partial-card-title">${Utils.sanitize(data.nombre)}</h3>
          <p class="partial-card-subtitle">Parcial ${data.numero}</p>
        </div>
        <div class="partial-status-box ${statusClass}">
          <span>${statusIcon}</span>
          <span>${statusText}</span>
        </div>
        ${scheduledInfo}
        <div class="partial-grade-count">
          <div class="stat-label">Calificaciones capturadas</div>
          <div class="stat-number">${gradeCount}</div>
        </div>
        ${overridesHTML}
        ${adminButtons}
      </div>
    `;
  }

  function bindEvents() {
    const container = document.getElementById('moduleContainer');
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const partialId = btn.dataset.partialId;
      const partialName = btn.dataset.partialName;

      if (action === 'lock' || action === 'unlock') {
        showConfirmDialog(partialId, partialName, action);
      } else if (action === 'teacher-override') {
        showTeacherOverrideModal(partialId, partialName);
      } else if (action === 'schedule-close') {
        showScheduleCloseModal(partialId, partialName);
      } else if (action === 'remove-override') {
        removeOverride(btn.dataset.overrideId);
      }
    });
  }

  function showConfirmDialog(partialId, partialName, action) {
    const title = action === 'lock' ? 'Cerrar Parcial' : 'Abrir Parcial';
    const message = action === 'lock'
      ? `\u00bfCerrar ${partialName}? Los docentes no podr\u00e1n modificar calificaciones.`
      : `\u00bfAbrir ${partialName}? Los docentes podr\u00e1n modificar calificaciones.`;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelAction">Cancelar</button>
      <button class="btn ${action === 'lock' ? 'btn-danger' : 'btn-warning'}" id="confirmAction">
        ${action === 'lock' ? 'Cerrar' : 'Abrir'}
      </button>
    `;

    Modal.open(title, `<p>${message}</p>`, footerHTML);
    document.getElementById('cancelAction').addEventListener('click', () => Modal.close());
    document.getElementById('confirmAction').addEventListener('click', async () => {
      await executeAction(partialId, action);
      Modal.close();
    });
  }

  async function showTeacherOverrideModal(partialId, partialName) {
    const teachers = await Store.getTeachers();
    const activeTeachers = teachers.filter(t => t.status === 'active').sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    const teacherOptions = activeTeachers.map(t =>
      `<option value="${t.id}" data-name="${Utils.sanitize(t.nombre)}">${Utils.sanitize(t.nombre)} (${Utils.sanitize(t.turno || '')})</option>`
    ).join('');

    const bodyHTML = `
      <p>Selecciona un docente para permitirle editar calificaciones en <strong>${Utils.sanitize(partialName)}</strong> aunque est\u00e9 cerrado.</p>
      <div class="form-group">
        <label>Docente</label>
        <select id="overrideTeacher">
          <option value="">Seleccionar docente...</option>
          ${teacherOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Expira el (opcional)</label>
        <input type="datetime-local" id="overrideExpiry">
        <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:var(--spacing-xs)">Si no se establece fecha, el acceso permanece hasta que se retire manualmente.</p>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelOverride">Cancelar</button>
      <button class="btn btn-primary" id="confirmOverride">Otorgar Acceso</button>
    `;

    Modal.open('Desbloquear Docente Espec\u00edfico', bodyHTML, footerHTML);
    document.getElementById('cancelOverride').addEventListener('click', () => Modal.close());
    document.getElementById('confirmOverride').addEventListener('click', async () => {
      const select = document.getElementById('overrideTeacher');
      const teacherId = select.value;
      if (!teacherId) {
        Toast.show('Selecciona un docente', 'warning');
        return;
      }
      const teacherName = select.options[select.selectedIndex].dataset.name;
      const expiryInput = document.getElementById('overrideExpiry').value;
      const expiresAt = expiryInput ? new Date(expiryInput) : null;

      try {
        await db.collection('partialOverrides').add({
          partialId,
          teacherId,
          teacherName,
          grantedBy: App.currentUser.uid,
          grantedByName: App.currentUser.displayName || App.currentUser.email,
          grantedAt: new Date(),
          expiresAt
        });
        Modal.close();
        Toast.show(`Acceso otorgado a ${teacherName}`, 'success');
        await loadAndRenderPartials();
        bindEvents();
      } catch (error) {
        console.error('Error granting override:', error);
        Toast.show('Error al otorgar acceso', 'error');
      }
    });
  }

  async function showScheduleCloseModal(partialId, partialName) {
    const bodyHTML = `
      <p>Programar cierre autom\u00e1tico de <strong>${Utils.sanitize(partialName)}</strong>.</p>
      <div class="form-group">
        <label>Fecha y hora de cierre</label>
        <input type="datetime-local" id="scheduledClose" required>
      </div>
      <p class="text-muted" style="font-size:var(--font-size-xs)">El parcial se cerrar\u00e1 autom\u00e1ticamente cuando se cargue el m\u00f3dulo despu\u00e9s de esta fecha.</p>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelSchedule">Cancelar</button>
      <button class="btn btn-primary" id="confirmSchedule">Programar Cierre</button>
    `;

    Modal.open('Programar Cierre de Parcial', bodyHTML, footerHTML);
    document.getElementById('cancelSchedule').addEventListener('click', () => Modal.close());
    document.getElementById('confirmSchedule').addEventListener('click', async () => {
      const dateVal = document.getElementById('scheduledClose').value;
      if (!dateVal) {
        Toast.show('Selecciona una fecha', 'warning');
        return;
      }
      const scheduledDate = new Date(dateVal);
      if (scheduledDate <= new Date()) {
        Toast.show('La fecha debe ser futura', 'warning');
        return;
      }
      try {
        await db.collection('partials').doc(partialId).set({
          scheduledCloseAt: scheduledDate
        }, { merge: true });
        Modal.close();
        Toast.show(`Cierre programado para ${scheduledDate.toLocaleDateString()}`, 'success');
        await loadAndRenderPartials();
        bindEvents();
      } catch (error) {
        console.error('Error scheduling close:', error);
        Toast.show('Error al programar cierre', 'error');
      }
    });
  }

  async function removeOverride(overrideId) {
    try {
      await db.collection('partialOverrides').doc(overrideId).delete();
      Toast.show('Acceso especial retirado', 'success');
      await loadAndRenderPartials();
      bindEvents();
    } catch (error) {
      console.error('Error removing override:', error);
      Toast.show('Error al retirar acceso', 'error');
    }
  }

  async function executeAction(partialId, action) {
    try {
      const locked = action === 'lock';
      const updateData = {
        locked,
        updatedAt: new Date(),
        updatedBy: App.currentUser?.uid
      };
      // Clear scheduled close when manually locking/unlocking
      if (locked) updateData.scheduledCloseAt = null;

      await db.collection('partials').doc(partialId).set(updateData, { merge: true });

      Toast.show(locked ? 'Parcial cerrado' : 'Parcial abierto', 'success');
      Store.invalidate('partials');
      await loadAndRenderPartials();
      bindEvents();
    } catch (error) {
      console.error('Error executing action:', error);
      Toast.show('Error al actualizar parcial', 'error');
    }
  }

  return { render };
})();

Router.modules['partial-close'] = () => PartialCloseModule.render();
