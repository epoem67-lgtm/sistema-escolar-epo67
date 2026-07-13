/**
 * PARTIAL CLOSE MODULE (Cierre de Parciales)
 * Manages locking/unlocking of evaluation periods
 * - Open/close at will
 * - Schedule closes with date/time
 * - Cancel or reschedule programmed closes
 * - Per-teacher overrides with expiration
 * - History of who opened/closed and when
 */

const PartialCloseModule = (() => {
  let overrides = [];

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Control de Parciales', 'Abre, cierra o programa el cierre de cada parcial. Cuando está cerrado, los docentes no pueden modificar calificaciones.')}
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
          await db.collection('partials').doc(partial.id).update({
            locked: true,
            updatedAt: new Date(),
            updatedBy: 'sistema-auto',
            closedAt: new Date(),
            closedBy: 'Cierre automático programado'
          });
          data.locked = true;
          data.closedAt = new Date();
          data.closedBy = 'Cierre automático programado';
          Toast.show(`${data.nombre || partial.nombre} cerrado automáticamente por fecha programada`, 'info');
        }
      }

      const partialOverrides = overrides.filter(o => o.partialId === partial.id);
      grid.innerHTML += buildPartialCard(partial, data, partialOverrides);
    }
  }

  function _formatDate(d) {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function buildPartialCard(partial, data, partialOverrides) {
    const isLocked = data.locked || false;
    const statusClass = isLocked ? 'stat-card--danger' : 'stat-card--success';
    const statusIcon = isLocked ? 'lock' : 'lock_open';
    const statusText = isLocked ? 'CERRADO' : 'ABIERTO';
    const isAdmin = App.currentUser?.role === 'admin';

    // Last action info
    let lastActionHtml = '';
    if (data.updatedAt) {
      const who = data.closedBy || data.openedBy || data.updatedBy || '';
      const when = _formatDate(data.updatedAt);
      const action = isLocked ? 'Cerrado' : 'Abierto';
      lastActionHtml = `<div style="font-size:10px;color:#6b7280;margin-top:4px;">
        ${action}: ${when}${who ? ' por ' + Utils.sanitize(String(who).substring(0, 30)) : ''}
      </div>`;
    }

    // Scheduled close info
    let scheduledInfo = '';
    if (data.scheduledCloseAt && !isLocked) {
      const d = data.scheduledCloseAt.toDate ? data.scheduledCloseAt.toDate() : new Date(data.scheduledCloseAt);
      const remaining = Math.max(0, Math.ceil((d - new Date()) / (1000 * 60 * 60)));
      const timeLabel = remaining > 24
        ? `${Math.ceil(remaining / 24)} días`
        : `${remaining} hrs`;
      scheduledInfo = `
        <div style="margin-top:8px;padding:6px 8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:6px;font-size:11px;">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;color:#d97706;">schedule</span>
          Cierre programado: <strong>${_formatDate(d)}</strong>
          <br><span style="color:#92400e;">Faltan ~${timeLabel}</span>
          <div style="margin-top:6px;display:flex;gap:6px;">
            <button class="btn btn-sm btn-outline" data-action="reschedule-close" data-partial-id="${partial.id}" data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">Reprogramar</button>
            <button class="btn btn-sm btn-outline" style="color:#dc2626;border-color:#dc2626;" data-action="cancel-schedule" data-partial-id="${partial.id}" data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">Cancelar</button>
          </div>
        </div>`;
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
          <div style="margin-top:8px;padding:6px 8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:6px;">
            <div style="font-size:10px;font-weight:600;color:#1e40af;margin-bottom:4px;">Docentes con acceso especial:</div>
            ${activeOverrides.map(o => {
              const expInfo = o.expiresAt
                ? `<span style="font-size:9px;color:#6b7280;">hasta ${_formatDate(o.expiresAt)}</span>`
                : '<span style="font-size:9px;color:#6b7280;">sin expiración</span>';
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <div>
                  <span style="font-weight:600;font-size:11px;">${Utils.sanitize(o.teacherName)}</span>
                  ${expInfo}
                </div>
                <button class="btn btn-sm" style="color:#dc2626;padding:2px 6px;font-size:11px;" data-action="remove-override" data-override-id="${o.id}">&times;</button>
              </div>`;
            }).join('')}
          </div>
        `;
      }
    }

    const adminButtons = isAdmin ? `
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px;">
        <button class="btn w-full ${isLocked ? 'btn-success' : 'btn-danger'}"
                data-action="${isLocked ? 'unlock' : 'lock'}"
                data-partial-id="${partial.id}"
                data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
          <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">${isLocked ? 'lock_open' : 'lock'}</span>
          ${isLocked ? 'Abrir Parcial' : 'Cerrar Parcial'}
        </button>
        ${isLocked ? `
          <button class="btn btn-primary btn-sm w-full"
                  data-action="teacher-override"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
            <span class="material-icons-round" style="font-size:14px;vertical-align:middle;margin-right:4px;">person_add</span>
            Desbloquear Docente
          </button>
        ` : `
          <button class="btn btn-outline btn-sm w-full"
                  data-action="schedule-close"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
            <span class="material-icons-round" style="font-size:14px;vertical-align:middle;margin-right:4px;">schedule</span>
            Programar Cierre
          </button>
        `}
      </div>
    ` : '';

    return `
      <div class="card" style="min-width:260px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>
            <h3 style="font-size:16px;font-weight:700;margin:0;">${Utils.sanitize(data.nombre || partial.nombre)}</h3>
            <p style="font-size:11px;color:#6b7280;margin:0;">Parcial ${data.numero || partial.numero}</p>
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;
            ${isLocked
              ? 'background:rgba(239,68,68,0.1);color:#dc2626;'
              : 'background:rgba(16,185,129,0.1);color:#059669;'}">
            <span class="material-icons-round" style="font-size:16px;">${statusIcon}</span>
            ${statusText}
          </div>
        </div>
        ${lastActionHtml}
        ${scheduledInfo}
        ${overridesHTML}
        ${adminButtons}
      </div>
    `;
  }

  function bindEvents() {
    const container = document.getElementById('moduleContainer');
    // Remove old listeners by cloning
    const newContainer = container.cloneNode(true);
    container.parentNode.replaceChild(newContainer, container);

    newContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const partialId = btn.dataset.partialId;
      const partialName = btn.dataset.partialName;

      if (action === 'lock' || action === 'unlock') {
        showConfirmDialog(partialId, partialName, action);
      } else if (action === 'teacher-override') {
        showTeacherOverrideModal(partialId, partialName);
      } else if (action === 'schedule-close' || action === 'reschedule-close') {
        showScheduleCloseModal(partialId, partialName);
      } else if (action === 'cancel-schedule') {
        cancelScheduledClose(partialId, partialName);
      } else if (action === 'remove-override') {
        removeOverride(btn.dataset.overrideId);
      }
    });
  }

  function showConfirmDialog(partialId, partialName, action) {
    const isLock = action === 'lock';
    const title = isLock ? 'Cerrar Parcial' : 'Abrir Parcial';
    const message = isLock
      ? `¿Cerrar <strong>${Utils.sanitize(partialName)}</strong>? Los docentes no podrán modificar calificaciones de este parcial.`
      : `¿Abrir <strong>${Utils.sanitize(partialName)}</strong>? Los docentes podrán modificar calificaciones de este parcial.`;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelAction">Cancelar</button>
      <button class="btn ${isLock ? 'btn-danger' : 'btn-success'}" id="confirmAction">
        ${isLock ? 'Cerrar Parcial' : 'Abrir Parcial'}
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
      <p>Selecciona un docente para permitirle editar calificaciones en <strong>${Utils.sanitize(partialName)}</strong> aunque esté cerrado.</p>
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
        <p class="text-muted" style="font-size:11px;margin-top:4px;">Si no se establece fecha, el acceso permanece hasta que se retire manualmente.</p>
      </div>
    `;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelOverride">Cancelar</button>
      <button class="btn btn-primary" id="confirmOverride">Otorgar Acceso</button>
    `;

    Modal.open('Desbloquear Docente Específico', bodyHTML, footerHTML);
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

  function showScheduleCloseModal(partialId, partialName) {
    // Default: tomorrow at 23:59
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);
    const defaultVal = tomorrow.toISOString().slice(0, 16);

    const bodyHTML = `
      <p>Programar cierre automático de <strong>${Utils.sanitize(partialName)}</strong>.</p>
      <div class="form-group">
        <label>Fecha y hora de cierre</label>
        <input type="datetime-local" id="scheduledClose" value="${defaultVal}" required>
      </div>
      <p class="text-muted" style="font-size:11px;">El parcial se cerrará automáticamente al pasar esta fecha. Puedes cancelar o reprogramar en cualquier momento.</p>
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
          scheduledCloseAt: scheduledDate,
          updatedAt: new Date(),
          updatedBy: App.currentUser?.uid
        }, { merge: true });
        Modal.close();
        Toast.show(`Cierre programado para ${scheduledDate.toLocaleDateString('es-MX')} a las ${scheduledDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`, 'success');
        Store.invalidate('partials');
        await loadAndRenderPartials();
        bindEvents();
      } catch (error) {
        console.error('Error scheduling close:', error);
        Toast.show('Error al programar cierre', 'error');
      }
    });
  }

  async function cancelScheduledClose(partialId, partialName) {
    try {
      await db.collection('partials').doc(partialId).update({
        scheduledCloseAt: null,
        updatedAt: new Date(),
        updatedBy: App.currentUser?.uid
      });
      Toast.show(`Cierre programado de ${partialName} cancelado`, 'success');
      Store.invalidate('partials');
      await loadAndRenderPartials();
      bindEvents();
    } catch (error) {
      console.error('Error cancelling schedule:', error);
      Toast.show('Error al cancelar programación', 'error');
    }
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
      const now = new Date();
      const userName = App.currentUser?.displayName || App.currentUser?.email || App.currentUser?.uid;

      const updateData = {
        locked,
        updatedAt: now,
        updatedBy: App.currentUser?.uid
      };

      if (locked) {
        updateData.scheduledCloseAt = null; // Clear schedule
        updateData.closedAt = now;
        updateData.closedBy = userName;
        updateData.openedAt = null;
        updateData.openedBy = null;
      } else {
        updateData.openedAt = now;
        updateData.openedBy = userName;
        updateData.closedAt = null;
        updateData.closedBy = null;
      }

      await db.collection('partials').doc(partialId).set(updateData, { merge: true });

      DB.audit(locked ? 'cerrar_parcial' : 'abrir_parcial', 'parcial', partialId, {
        description: `Parcial ${partialId} ${locked ? 'cerrado' : 'abierto'} por ${userName}`
      });

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
