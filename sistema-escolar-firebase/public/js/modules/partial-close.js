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
  let correctionGrants = []; // permisos individuales para PEDIR corrección

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Control de Parciales', 'Abre, cierra o programa el cierre de cada parcial. Cuando está cerrado, los docentes no pueden modificar calificaciones.')}

        <!-- PANEL FECHAS CRITICAS (solo admin) -->
        <div id="capture-window-panel" style="margin-bottom:16px;"></div>

        <div id="partials-grid" class="stats-grid"></div>
      </div>
    `;

    await loadAndRenderPartials();
    await renderCaptureWindowPanel();
    bindEvents();
  }

  // ─── PANEL DE FECHAS CRITICAS (admin + subdirector) ─────────
  // Permite a Olivia/Octavio programar cuando se cierra la captura y mostrar
  // fecha limite en banners de los maestros (Capturar Calificaciones y F1).
  //
  // v8.10: soporta fechas DIFERENTES por grado. Modelo en Firestore:
  //   config/captureWindow = {
  //     closesAt, deliveryDate, correctionsStart, correctionsEnd, // global (fallback)
  //     byGrade: {
  //       '1': { closesAt, deliveryDate, correctionsStart, correctionsEnd },
  //       '2': { ... }, '3': { ... }
  //     }
  //   }
  // Si byGrade[grado][campo] existe, manda. Si no, fallback al global.
  // Permite "3° entrega antes que 1°/2°" sin tocar a los otros grados.
  async function renderCaptureWindowPanel() {
    const root = document.getElementById('capture-window-panel');
    if (!root) return;
    const _r = App.currentUser?.role;
    if (_r !== 'admin' && _r !== 'subdirector') return;

    let cfg = {};
    try {
      const doc = await db.collection('config').doc('captureWindow').get();
      cfg = doc.exists ? doc.data() : {};
    } catch (e) {
      console.warn('captureWindow:', e.message);
    }

    const fmt = (ts) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    const fmtJustDate = (ts) => {
      if (!ts) return '—';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    // Resolver fechas efectivas para cada grado vía K.captureWindowForGrade.
    // Marcar visualmente si ese grado tiene override propio.
    // v8.12: ahora también muestra la APERTURA de la ventana de captura.
    const byG = cfg.byGrade || {};
    const renderGradeBlock = (gNum) => {
      const eff = K.captureWindowForGrade(cfg, gNum);
      const hasOverride = !!(byG[String(gNum)] && Object.keys(byG[String(gNum)]).length > 0);
      const badge = hasOverride
        ? '<span style="background:#d97706;color:#fff;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:700;margin-left:6px;">fechas propias</span>'
        : '<span style="background:#cbd5e0;color:#475569;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600;margin-left:6px;">usa fechas globales</span>';
      return `
        <div style="background:#fff;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;">
          <div style="font-size:13px;font-weight:800;color:#78350f;margin-bottom:6px;">
            ${gNum}° grado ${badge}
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:11px;margin-bottom:6px;">
            <div>
              <div style="color:#78350f;text-transform:uppercase;font-weight:700;font-size:10px;">Apertura de captura</div>
              <div style="font-weight:700;color:#1e293b;">${fmt(eff.opensAt)}</div>
            </div>
            <div>
              <div style="color:#78350f;text-transform:uppercase;font-weight:700;font-size:10px;">Cierre de captura</div>
              <div style="font-weight:700;color:#1e293b;">${fmt(eff.closesAt)}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px;font-size:11px;">
            <div>
              <div style="color:#78350f;text-transform:uppercase;font-weight:700;font-size:10px;">Entrega listas</div>
              <div style="font-weight:700;color:#1e293b;">${fmtJustDate(eff.deliveryDate)}</div>
            </div>
            <div>
              <div style="color:#78350f;text-transform:uppercase;font-weight:700;font-size:10px;">Correcciones</div>
              <div style="font-weight:700;color:#1e293b;font-size:11px;">
                ${eff.correctionsStart ? fmtJustDate(eff.correctionsStart) : '—'}
                <span style="color:#64748b;">→</span>
                ${eff.correctionsEnd ? fmtJustDate(eff.correctionsEnd) : '—'}
              </div>
            </div>
          </div>
        </div>`;
    };

    root.innerHTML = `
      <div class="card" style="background:linear-gradient(90deg,#fff7ed 0%,#fffbeb 100%);border-left:5px solid #d97706;">
        <h3 class="section-title" style="margin:0 0 10px 0;color:#92400e;">
          <span class="material-icons-round" style="vertical-align:middle;">event</span>
          Fechas críticas del ciclo (visibles en los banners de los maestros)
        </h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;margin-bottom:12px;">
          ${renderGradeBlock(1)}
          ${renderGradeBlock(2)}
          ${renderGradeBlock(3)}
        </div>
        <button class="btn btn-sm" style="background:#d97706;color:#fff;font-weight:700;" data-action="cw-edit">
          <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">edit_calendar</span>
          Programar fechas
        </button>
        <p style="font-size:11px;color:#92400e;margin:8px 0 0;font-style:italic;">
          Las fechas pueden ser distintas por grado (ejemplo: 3° entrega antes que 1° y 2°).
          Si un grado no tiene fechas propias, usa las globales. Cada maestro ve en su banner
          las fechas que aplican a SU grado.
        </p>
      </div>`;

    // NOTA: NO agregamos addEventListener directo aquí porque bindEvents()
    // clona el container y se perdería. El click se maneja por delegación
    // en el listener global de bindEvents() (case 'cw-edit').
  }

  // v8.10: Modal con pestañas (Global + 1° + 2° + 3°) — permite fechas por grado.
  // El admin programa una vez las "globales" y opcionalmente sobreescribe por
  // grado. Cada maestro ve en su banner las fechas que aplican a SU grado.
  async function editCaptureWindow() {
    // Cargar valores actuales si existen para pre-llenar el form
    let cur = {};
    try {
      const fs = firebase.firestore();
      const doc = await fs.collection('config').doc('captureWindow').get();
      cur = doc.exists ? doc.data() : {};
    } catch (e) {
      console.warn('No se pudo cargar captureWindow actual:', e.message);
    }
    const curByG = cur.byGrade || {};

    const fmtForInput = (ts, type) => {
      if (!ts) return '';
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (type === 'datetime-local') {
        return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      return date;
    };

    // Builder de los 5 campos de un grupo (global o por grado).
    //  - scope: 'global' o '1'/'2'/'3'
    //  - cfg: objeto con los valores actuales para ese scope (puede estar vacío
    //    si es un grado sin override — los inputs van en blanco)
    //  - required: true solo para 'global' (los grados pueden quedar vacíos = usa global)
    // v8.12: agrega opensAt (apertura de la ventana de captura) + botón
    // "Copiar a otros grados" para combinar grados sin teclear lo mismo 3 veces.
    const renderTab = (scope, cfg, required) => {
      const req = required ? 'required' : '';
      const reqMark = required ? ' *' : '';
      const prefix = scope === 'global' ? 'cw' : ('cwG' + scope);
      const placeholderNote = required
        ? `<div style="background:#fef3c7;border-left:3px solid #d97706;padding:6px 10px;font-size:11px;color:#78350f;margin-bottom:8px;border-radius:4px;">
            <strong>Fechas globales:</strong> aplican a TODOS los grados que no tengan fechas propias.
          </div>`
        : `<div style="background:#eff6ff;border-left:3px solid #3182ce;padding:6px 10px;font-size:11px;color:#1e40af;margin-bottom:8px;border-radius:4px;">
            <strong>Override del ${scope}° grado:</strong> deja un campo en blanco para usar la fecha global.
            Si dejas TODOS en blanco, este grado simplemente usa las fechas globales.
            <button type="button" data-clear-grade="${scope}" style="background:none;border:none;color:#dc2626;text-decoration:underline;font-size:11px;font-weight:700;cursor:pointer;padding:0;margin-left:4px;">Borrar fechas de este grado</button>
          </div>`;
      const defaults = required
        ? { o: '2026-04-28T00:00', c: '2026-05-14T23:59', d: '2026-05-14', s: '2026-05-17', e: '2026-05-18' }
        : { o: '', c: '', d: '', s: '', e: '' };
      // Botón de copiar visible siempre — ofrece replicar las fechas de ESTA
      // pestaña a uno o varios grados a la vez (checkboxes en mini panel).
      const copyTargets = ['1','2','3'].filter(g => g !== scope);
      const copyChecks = copyTargets.map(g =>
        `<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#1e3a8a;margin-right:10px;">
          <input type="checkbox" data-copy-target="${g}" style="width:14px;height:14px;cursor:pointer;"> ${g}° grado
        </label>`
      ).join('');
      return `
        <div data-tab-pane="${scope}" style="display:none;flex-direction:column;gap:10px;">
          ${placeholderNote}
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700;font-size:12px;">🟢 Apertura de captura${reqMark}</label>
            <input type="datetime-local" id="${prefix}OpensAt" value="${fmtForInput(cfg.opensAt, 'datetime-local') || defaults.o}" ${req} style="width:100%;padding:6px 10px;font-size:13px;border:1px solid #cbd5e0;border-radius:6px;">
            <small style="color:#64748b;font-size:11px;">Fecha y hora en que los maestros pueden empezar a capturar este parcial.</small>
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700;font-size:12px;">📅 Cierre de captura${reqMark}</label>
            <input type="datetime-local" id="${prefix}ClosesAt" value="${fmtForInput(cfg.closesAt, 'datetime-local') || defaults.c}" ${req} style="width:100%;padding:6px 10px;font-size:13px;border:1px solid #cbd5e0;border-radius:6px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700;font-size:12px;">📋 Entrega de listas firmadas${reqMark}</label>
            <input type="date" id="${prefix}Delivery" value="${fmtForInput(cfg.deliveryDate, 'date') || defaults.d}" ${req} style="width:100%;padding:6px 10px;font-size:13px;border:1px solid #cbd5e0;border-radius:6px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700;font-size:12px;">✏️ Inicio ventana de correcciones${reqMark}</label>
            <input type="date" id="${prefix}CorrStart" value="${fmtForInput(cfg.correctionsStart, 'date') || defaults.s}" ${req} style="width:100%;padding:6px 10px;font-size:13px;border:1px solid #cbd5e0;border-radius:6px;">
          </div>
          <div class="form-group" style="margin:0;">
            <label style="font-weight:700;font-size:12px;">✏️ Fin ventana de correcciones${reqMark}</label>
            <input type="date" id="${prefix}CorrEnd" value="${fmtForInput(cfg.correctionsEnd, 'date') || defaults.e}" ${req} style="width:100%;padding:6px 10px;font-size:13px;border:1px solid #cbd5e0;border-radius:6px;">
          </div>

          <!-- v8.12: Combinar grados — copiar estas fechas a otro(s) grado(s) -->
          <div style="background:#f1f5f9;border:1px dashed #94a3b8;border-radius:6px;padding:8px 10px;margin-top:6px;">
            <div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:4px;display:flex;align-items:center;gap:4px;">
              <span class="material-icons-round" style="font-size:14px;">content_copy</span>
              Copiar estas fechas a otro(s) grado(s):
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              ${copyChecks}
              <button type="button" data-copy-from="${scope}" style="background:#3182ce;color:#fff;border:none;padding:4px 12px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">
                Copiar
              </button>
            </div>
            <small style="color:#64748b;font-size:10.5px;display:block;margin-top:4px;">
              Útil cuando ${scope === 'global' ? '1° y 2°' : 'varios grados'} llevan las mismas fechas pero ${scope === 'global' ? '3° las cambia' : 'otros cambian'}.
            </small>
          </div>
        </div>`;
    };

    const body = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="background:#eff6ff;border-left:3px solid #3182ce;padding:8px 12px;font-size:12px;color:#1e40af;border-radius:4px;">
          ℹ️ Las fechas aparecen en los banners de los maestros. Las "globales" aplican a todos.
          Cada grado puede tener fechas propias (ej. 3° entrega antes que 1° y 2°).
        </div>

        <!-- Pestañas -->
        <div style="display:flex;gap:4px;border-bottom:2px solid #fde68a;">
          <button type="button" data-cw-tab="global" class="cw-tab-btn" style="background:#d97706;color:#fff;border:none;padding:7px 14px;font-weight:700;font-size:13px;border-radius:6px 6px 0 0;cursor:pointer;">Global (todos)</button>
          <button type="button" data-cw-tab="1" class="cw-tab-btn" style="background:#fde68a;color:#78350f;border:none;padding:7px 14px;font-weight:700;font-size:13px;border-radius:6px 6px 0 0;cursor:pointer;">1° grado</button>
          <button type="button" data-cw-tab="2" class="cw-tab-btn" style="background:#fde68a;color:#78350f;border:none;padding:7px 14px;font-weight:700;font-size:13px;border-radius:6px 6px 0 0;cursor:pointer;">2° grado</button>
          <button type="button" data-cw-tab="3" class="cw-tab-btn" style="background:#fde68a;color:#78350f;border:none;padding:7px 14px;font-weight:700;font-size:13px;border-radius:6px 6px 0 0;cursor:pointer;">3° grado</button>
        </div>

        ${renderTab('global', cur, true)}
        ${renderTab('1', curByG['1'] || {}, false)}
        ${renderTab('2', curByG['2'] || {}, false)}
        ${renderTab('3', curByG['3'] || {}, false)}
      </div>`;

    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" id="cwSaveBtn" style="background:#d97706;border-color:#d97706;font-weight:700;">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">save</span>
        Guardar fechas
      </button>`;

    Modal.open('Programar fechas críticas del ciclo', body, footer);

    // Mostrar la pestaña global por defecto
    const modalBody = document.getElementById('modalBody') || document;
    const showTab = (scope) => {
      modalBody.querySelectorAll('[data-tab-pane]').forEach(p => {
        p.style.display = p.dataset.tabPane === scope ? 'flex' : 'none';
      });
      modalBody.querySelectorAll('[data-cw-tab]').forEach(b => {
        if (b.dataset.cwTab === scope) {
          b.style.background = '#d97706'; b.style.color = '#fff';
        } else {
          b.style.background = '#fde68a'; b.style.color = '#78350f';
        }
      });
    };
    showTab('global');

    // Delegación: pestañas + botón "borrar fechas de este grado" + botón "Copiar a otros grados"
    const FIELD_KEYS = ['OpensAt','ClosesAt','Delivery','CorrStart','CorrEnd'];
    const prefixOf = (scope) => scope === 'global' ? 'cw' : ('cwG' + scope);
    modalBody.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-cw-tab]');
      if (tabBtn) { showTab(tabBtn.dataset.cwTab); return; }
      const clearBtn = e.target.closest('[data-clear-grade]');
      if (clearBtn) {
        const g = clearBtn.dataset.clearGrade;
        FIELD_KEYS.forEach(f => {
          const el = document.getElementById('cwG' + g + f);
          if (el) el.value = '';
        });
        Toast.show(`Campos del ${g}° grado limpiados — usará las fechas globales`, 'info');
        return;
      }
      // v8.12: COPIAR fechas de esta pestaña a otro(s) grado(s) marcados
      const copyBtn = e.target.closest('[data-copy-from]');
      if (copyBtn) {
        const fromScope = copyBtn.dataset.copyFrom;
        const fromPrefix = prefixOf(fromScope);
        // Localizar la pestaña actual y sus checkboxes
        const pane = copyBtn.closest('[data-tab-pane]');
        if (!pane) return;
        const targets = [...pane.querySelectorAll('[data-copy-target]:checked')].map(cb => cb.dataset.copyTarget);
        if (targets.length === 0) {
          Toast.show('Marca al menos un grado destino para copiar', 'warning');
          return;
        }
        // Leer los valores actuales (raw, sin parseo) y copiar tal cual
        const values = {};
        FIELD_KEYS.forEach(f => {
          const el = document.getElementById(fromPrefix + f);
          values[f] = el ? el.value : '';
        });
        targets.forEach(g => {
          const toPrefix = 'cwG' + g;
          FIELD_KEYS.forEach(f => {
            const el = document.getElementById(toPrefix + f);
            if (el) el.value = values[f];
          });
        });
        // Limpiar los checkboxes
        pane.querySelectorAll('[data-copy-target]').forEach(cb => { cb.checked = false; });
        Toast.show(`Fechas copiadas a: ${targets.map(g => g + '°').join(', ')}`, 'success');
      }
    });

    const modalFooter = document.getElementById('modalFooter');
    if (!modalFooter) return;

    // Lee un grupo de 5 inputs y devuelve {opensAt, closesAt, deliveryDate, correctionsStart, correctionsEnd}
    // con Timestamps. Si algún campo está vacío, lo deja como undefined (señal de "no override").
    // Si TODOS están vacíos para un grado, devuelve isEmpty=true (señal de "limpiar override").
    const readGroup = (prefix, requireAll) => {
      const o = document.getElementById(prefix + 'OpensAt')?.value || '';
      const c = document.getElementById(prefix + 'ClosesAt')?.value || '';
      const d = document.getElementById(prefix + 'Delivery')?.value || '';
      const s = document.getElementById(prefix + 'CorrStart')?.value || '';
      const e = document.getElementById(prefix + 'CorrEnd')?.value || '';
      if (requireAll) {
        if (!o || !c || !d || !s || !e) return { error: 'Faltan campos en las fechas GLOBALES (todos son requeridos, incluyendo la APERTURA).' };
      } else {
        // Si TODOS están vacíos, retornar isEmpty = borrar override
        if (!o && !c && !d && !s && !e) return { isEmpty: true };
      }
      const out = {};
      if (o) {
        const dt = new Date(o);
        if (isNaN(dt.getTime())) return { error: 'Fecha de apertura inválida.' };
        out.opensAt = firebase.firestore.Timestamp.fromDate(dt);
      }
      if (c) {
        const dt = new Date(c);
        if (isNaN(dt.getTime())) return { error: 'Fecha de cierre inválida.' };
        out.closesAt = firebase.firestore.Timestamp.fromDate(dt);
      }
      if (d) {
        const dt = new Date(d + 'T23:59:00');
        if (isNaN(dt.getTime())) return { error: 'Fecha de entrega inválida.' };
        out.deliveryDate = firebase.firestore.Timestamp.fromDate(dt);
      }
      if (s) {
        const dt = new Date(s + 'T00:00:00');
        if (isNaN(dt.getTime())) return { error: 'Inicio de correcciones inválido.' };
        out.correctionsStart = firebase.firestore.Timestamp.fromDate(dt);
      }
      if (e) {
        const dt = new Date(e + 'T23:59:00');
        if (isNaN(dt.getTime())) return { error: 'Fin de correcciones inválido.' };
        out.correctionsEnd = firebase.firestore.Timestamp.fromDate(dt);
      }
      // Validaciones de orden lógico
      if (out.opensAt && out.closesAt && out.closesAt.toMillis() < out.opensAt.toMillis()) {
        return { error: 'La fecha de CIERRE no puede ser antes de la fecha de APERTURA.' };
      }
      if (out.correctionsStart && out.correctionsEnd && out.correctionsEnd.toMillis() < out.correctionsStart.toMillis()) {
        return { error: 'Fin de correcciones no puede ser antes del inicio.' };
      }
      return { data: out };
    };

    modalFooter.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) {
        Modal.close();
        return;
      }
      if (e.target.closest('#cwSaveBtn')) {
        // Leer las 4 secciones
        const globalRes = readGroup('cw', true);
        if (globalRes.error) { Toast.show(globalRes.error, 'error'); return; }
        const g1Res = readGroup('cwG1', false);
        if (g1Res.error) { Toast.show('1° grado: ' + g1Res.error, 'error'); return; }
        const g2Res = readGroup('cwG2', false);
        if (g2Res.error) { Toast.show('2° grado: ' + g2Res.error, 'error'); return; }
        const g3Res = readGroup('cwG3', false);
        if (g3Res.error) { Toast.show('3° grado: ' + g3Res.error, 'error'); return; }

        const saveBtn = document.getElementById('cwSaveBtn');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:16px;vertical-align:middle;">autorenew</span> Guardando...';
        }

        try {
          const fs = firebase.firestore();
          const data = {
            ...globalRes.data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: firebase.auth().currentUser?.uid || 'unknown',
            byGrade: {},
          };
          // Si un grado está vacío, NO se incluye en byGrade (limpia override).
          // Si tiene al menos un campo, se incluye (parcial — fallback a global por campo).
          if (!g1Res.isEmpty && g1Res.data) data.byGrade['1'] = g1Res.data;
          if (!g2Res.isEmpty && g2Res.data) data.byGrade['2'] = g2Res.data;
          if (!g3Res.isEmpty && g3Res.data) data.byGrade['3'] = g3Res.data;

          await fs.collection('config').doc('captureWindow').set(data, { merge: false });
          Toast.show('✓ Fechas actualizadas. Cada maestro verá las de SU grado.', 'success');
          Modal.close();
          await renderCaptureWindowPanel();
        } catch (e) {
          console.error('Error guardando captureWindow:', e);
          Toast.show('No se pudo guardar: ' + (e.message || 'error desconocido'), 'error');
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px;vertical-align:middle;">save</span> Guardar fechas';
          }
        }
      }
    });
  }

  async function loadOverrides() {
    try {
      const snap = await db.collection('partialOverrides').get();
      overrides = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      overrides = [];
    }
    try {
      const gsnap = await db.collection('correctionGrants').get();
      correctionGrants = gsnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      correctionGrants = [];
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

      // v8.08: Check scheduled close — por grado o global
      const now = new Date();

      // 1) Check scheduledCloseByGrade — cierres programados por grado
      if (data.scheduledCloseByGrade && typeof data.scheduledCloseByGrade === 'object') {
        const lbg = (data.lockedByGrade && typeof data.lockedByGrade === 'object') ? { ...data.lockedByGrade } : {};
        const closedBG = (data.closedByGrade && typeof data.closedByGrade === 'object') ? { ...data.closedByGrade } : {};
        const remainingSched = { ...data.scheduledCloseByGrade };
        let mutated = false;
        let firedGrados = [];
        for (const [g, ts] of Object.entries(data.scheduledCloseByGrade)) {
          if (!ts) continue;
          const d = ts.toDate ? ts.toDate() : new Date(ts);
          if (d <= now && lbg[g] !== true) {
            lbg[g] = true;
            closedBG[g] = now.toISOString();
            delete remainingSched[g];
            firedGrados.push(g);
            mutated = true;
          }
        }
        if (mutated) {
          // Si los 3 grados quedaron cerrados, también cerrar globalmente
          const allClosed = ['1', '2', '3'].every(g => lbg[g] === true);
          const update = {
            lockedByGrade: lbg,
            closedByGrade: closedBG,
            scheduledCloseByGrade: remainingSched,
            updatedAt: now,
            updatedBy: 'sistema-auto',
          };
          if (allClosed && !data.locked) {
            update.locked = true;
            update.closedAt = now;
            update.closedBy = 'Cierre automático programado (último grado)';
            update.scheduledCloseAt = null;
          }
          await db.collection('partials').doc(partial.id).set(update, { merge: true });
          data.lockedByGrade = lbg;
          data.closedByGrade = closedBG;
          data.scheduledCloseByGrade = remainingSched;
          if (allClosed) {
            data.locked = true;
            data.closedAt = now;
            data.closedBy = update.closedBy;
          }
          Toast.show(`${data.nombre || partial.nombre} cerrado automáticamente para ${firedGrados.map(g => g + '°').join(' y ')} grado`, 'info');
        }
      }

      // 2) Check scheduledCloseAt global (compatibilidad hacia atrás)
      if (!data.locked && data.scheduledCloseAt) {
        const scheduledDate = data.scheduledCloseAt.toDate ? data.scheduledCloseAt.toDate() : new Date(data.scheduledCloseAt);
        if (scheduledDate <= now) {
          await db.collection('partials').doc(partial.id).update({
            locked: true,
            lockedByGrade: { '1': true, '2': true, '3': true },
            closedByGrade: { '1': now.toISOString(), '2': now.toISOString(), '3': now.toISOString() },
            updatedAt: now,
            updatedBy: 'sistema-auto',
            closedAt: now,
            closedBy: 'Cierre automático programado'
          });
          data.locked = true;
          data.lockedByGrade = { '1': true, '2': true, '3': true };
          data.closedAt = now;
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
    // Subdirector tiene mismas facultades que admin para abrir/cerrar parciales.
    const _r = App.currentUser?.role;
    const isAdmin = _r === 'admin' || _r === 'subdirector';

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

    // Scheduled close info — global o por grado (v8.08)
    let scheduledInfo = '';
    const sbg = (data.scheduledCloseByGrade && typeof data.scheduledCloseByGrade === 'object') ? data.scheduledCloseByGrade : null;
    const hasByGradeSchedule = sbg && Object.values(sbg).some(v => !!v);

    if (hasByGradeSchedule && !isLocked) {
      // Agrupar grados por fecha (ej. 1°+2° tienen misma fecha, 3° tiene otra)
      const groupsByDate = new Map();
      ['1', '2', '3'].forEach(g => {
        const ts = sbg[g];
        if (!ts) return;
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const key = d.getTime();
        if (!groupsByDate.has(key)) groupsByDate.set(key, { date: d, grados: [] });
        groupsByDate.get(key).grados.push(g);
      });
      const items = [...groupsByDate.values()].sort((a, b) => a.date - b.date);
      const rows = items.map(it => {
        const remaining = Math.max(0, Math.ceil((it.date - new Date()) / (1000 * 60 * 60)));
        const timeLabel = remaining > 24 ? `${Math.ceil(remaining / 24)} días` : `${remaining} hrs`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-top:1px dashed rgba(245,158,11,0.3);">
          <div>
            <strong>${it.grados.map(g => g + '°').join(' y ')} grado</strong>
            <span style="color:#92400e;font-size:10px;"> · ${_formatDate(it.date)} · faltan ~${timeLabel}</span>
          </div>
        </div>`;
      }).join('');
      scheduledInfo = `
        <div style="margin-top:8px;padding:8px 10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:6px;font-size:11px;">
          <div style="font-weight:700;color:#92400e;display:flex;align-items:center;gap:6px;">
            <span class="material-icons-round" style="font-size:14px;color:#d97706;">schedule</span>
            Cierres programados por grado:
          </div>
          ${rows}
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button class="btn btn-sm btn-outline" data-action="reschedule-close" data-partial-id="${partial.id}" data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">Programar otro</button>
            <button class="btn btn-sm btn-outline" style="color:#dc2626;border-color:#dc2626;" data-action="cancel-schedule" data-partial-id="${partial.id}" data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">Cancelar todos</button>
          </div>
        </div>`;
    } else if (data.scheduledCloseAt && !isLocked) {
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
                  <span style="font-weight:600;font-size:11px;">${Utils.sanitize(Utils.displayName(o.teacherName))}</span>
                  ${expInfo}
                </div>
                <button class="btn btn-sm" style="color:#dc2626;padding:2px 6px;font-size:11px;" data-action="remove-override" data-override-id="${o.id}">&times;</button>
              </div>`;
            }).join('')}
          </div>
        `;
      }
    }

    // Permisos individuales de SOLICITUD de corrección (correctionGrants).
    let grantsHTML = '';
    if (isLocked && isAdmin) {
      const now = new Date();
      const activeGrants = correctionGrants.filter(g => {
        if (g.partialId !== partial.id) return false;
        if (!g.closesAt) return true;
        const c = g.closesAt.toDate ? g.closesAt.toDate() : new Date(g.closesAt);
        return c > now;
      });
      if (activeGrants.length > 0) {
        grantsHTML = `
          <div style="margin-top:8px;padding:6px 8px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:6px;">
            <div style="font-size:10px;font-weight:600;color:#166534;margin-bottom:4px;">Pueden PEDIR corrección:</div>
            ${activeGrants.map(g => {
              const expInfo = g.closesAt
                ? `<span style="font-size:9px;color:#6b7280;">hasta ${_formatDate(g.closesAt)}</span>`
                : '<span style="font-size:9px;color:#6b7280;">sin expiración</span>';
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                <div>
                  <span style="font-weight:600;font-size:11px;">${Utils.sanitize(Utils.displayName(g.teacherName))}</span>
                  ${expInfo}
                </div>
                <button class="btn btn-sm" style="color:#dc2626;padding:2px 6px;font-size:11px;" data-action="remove-correction-grant" data-grant-id="${g.id}">&times;</button>
              </div>`;
            }).join('')}
          </div>
        `;
      }
    }
    overridesHTML += grantsHTML;

    // v8.07: estado por GRADO (lockedByGrade)
    // Si el doc tiene lockedByGrade, mostrar matriz por grado. Si no, fallback global.
    const lockedByGrade = (data.lockedByGrade && typeof data.lockedByGrade === 'object') ? data.lockedByGrade : {};
    const gradeButtonsHtml = isAdmin ? `
      <div style="margin-top:10px;padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <div style="font-size:10px;font-weight:700;color:#475569;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;">
          <span class="material-icons-round" style="font-size:14px;color:#3182ce;">school</span>
          Estado por grado
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${[1, 2, 3].map(g => {
            const lockedG = (g.toString() in lockedByGrade) ? (lockedByGrade[g.toString()] === true) : isLocked;
            const bg = lockedG ? '#fef2f2' : '#f0fdf4';
            const color = lockedG ? '#991b1b' : '#166534';
            const icon = lockedG ? 'lock' : 'lock_open';
            const action = lockedG ? 'unlock-grade' : 'lock-grade';
            const btnText = lockedG ? 'Abrir' : 'Cerrar';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:${bg};border-radius:4px;font-size:11px;">
              <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:${color};">
                <span class="material-icons-round" style="font-size:13px;">${icon}</span>
                ${g}° grado · ${lockedG ? 'CERRADO' : 'ABIERTO'}
              </div>
              <button class="btn btn-sm btn-outline" style="padding:2px 8px;font-size:10px;"
                data-action="${action}"
                data-partial-id="${partial.id}"
                data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}"
                data-grado="${g}">${btnText}</button>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    const adminButtons = isAdmin ? `
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px;">
        <button class="btn w-full ${isLocked ? 'btn-success' : 'btn-danger'}"
                data-action="${isLocked ? 'unlock' : 'lock'}"
                data-partial-id="${partial.id}"
                data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
          <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">${isLocked ? 'lock_open' : 'lock'}</span>
          ${isLocked ? 'Abrir TODO el parcial' : 'Cerrar TODO el parcial'}
        </button>
        ${isLocked ? `
          <button class="btn btn-primary btn-sm w-full"
                  data-action="teacher-override"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
            <span class="material-icons-round" style="font-size:14px;vertical-align:middle;margin-right:4px;">edit</span>
            Dejar que un docente CAPTURE
          </button>
          <button class="btn btn-outline btn-sm w-full"
                  data-action="correction-grant"
                  data-partial-id="${partial.id}"
                  data-partial-name="${Utils.sanitize(data.nombre || partial.nombre)}">
            <span class="material-icons-round" style="font-size:14px;vertical-align:middle;margin-right:4px;">rate_review</span>
            Dejar que un docente PIDA corrección
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
        ${gradeButtonsHtml}
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
      } else if (action === 'lock-grade' || action === 'unlock-grade') {
        // v8.07: cierre/apertura por grado individual
        const grado = btn.dataset.grado;
        showGradeLockConfirm(partialId, partialName, grado, action === 'lock-grade');
      } else if (action === 'teacher-override') {
        showTeacherOverrideModal(partialId, partialName);
      } else if (action === 'correction-grant') {
        showCorrectionGrantModal(partialId, partialName);
      } else if (action === 'schedule-close' || action === 'reschedule-close') {
        showScheduleCloseModal(partialId, partialName);
      } else if (action === 'cancel-schedule') {
        cancelScheduledClose(partialId, partialName);
      } else if (action === 'remove-override') {
        removeOverride(btn.dataset.overrideId);
      } else if (action === 'remove-correction-grant') {
        removeCorrectionGrant(btn.dataset.grantId);
      } else if (action === 'cw-edit') {
        // BUGFIX v5.89: el listener directo en renderCaptureWindowPanel se
        // perdía porque bindEvents() clona el container. Ahora se maneja
        // aquí por delegación, que sobrevive al clone.
        editCaptureWindow();
      }
    });
  }

  function showConfirmDialog(partialId, partialName, action) {
    const isLock = action === 'lock';
    const title = isLock ? 'Cerrar Parcial' : 'Abrir Parcial';
    const message = isLock
      ? `¿Cerrar <strong>${Utils.sanitize(partialName)}</strong> para TODOS los grados? Los docentes no podrán modificar calificaciones de este parcial.`
      : `¿Abrir <strong>${Utils.sanitize(partialName)}</strong> para TODOS los grados? Los docentes podrán modificar calificaciones de este parcial.`;

    const footerHTML = `
      <button class="btn btn-outline" id="cancelAction">Cancelar</button>
      <button class="btn ${isLock ? 'btn-danger' : 'btn-success'}" id="confirmAction">
        ${isLock ? 'Cerrar Parcial (los 3 grados)' : 'Abrir Parcial (los 3 grados)'}
      </button>
    `;

    Modal.open(title, `<p>${message}</p>`, footerHTML);
    document.getElementById('cancelAction').addEventListener('click', () => Modal.close());
    document.getElementById('confirmAction').addEventListener('click', async () => {
      await executeAction(partialId, action);
      Modal.close();
    });
  }

  // v8.07: cierre/apertura del parcial SOLO para un grado específico
  function showGradeLockConfirm(partialId, partialName, grado, isLock) {
    const title = isLock ? `Cerrar ${grado}° grado` : `Abrir ${grado}° grado`;
    const message = isLock
      ? `¿Cerrar <strong>${Utils.sanitize(partialName)}</strong> SOLO para <strong>${grado}° grado</strong>? Los docentes que capturan en ese grado no podrán editar calificaciones. Los otros grados no se afectan.`
      : `¿Abrir <strong>${Utils.sanitize(partialName)}</strong> para <strong>${grado}° grado</strong>? Los docentes que capturan en ese grado podrán editar calificaciones. Los otros grados no se afectan.`;
    const footerHTML = `
      <button class="btn btn-outline" id="cancelGrade">Cancelar</button>
      <button class="btn ${isLock ? 'btn-danger' : 'btn-success'}" id="confirmGrade">
        ${isLock ? `Cerrar SOLO ${grado}° grado` : `Abrir SOLO ${grado}° grado`}
      </button>
    `;
    Modal.open(title, `<p>${message}</p>`, footerHTML);
    document.getElementById('cancelGrade').addEventListener('click', () => Modal.close());
    document.getElementById('confirmGrade').addEventListener('click', async () => {
      await executeGradeLockAction(partialId, grado, isLock);
      Modal.close();
    });
  }

  async function executeGradeLockAction(partialId, grado, isLock) {
    try {
      const docRef = db.collection('partials').doc(partialId);
      const snap = await docRef.get();
      const current = snap.exists ? snap.data() : {};
      const lockedByGrade = (current.lockedByGrade && typeof current.lockedByGrade === 'object')
        ? { ...current.lockedByGrade }
        : {};
      // Si no hay info por grado todavía, hereda del estado global actual
      ['1', '2', '3'].forEach(g => {
        if (!(g in lockedByGrade)) lockedByGrade[g] = current.locked === true;
      });
      lockedByGrade[String(grado)] = !!isLock;

      // El campo global `locked` queda en true SOLO si los 3 grados están cerrados.
      // Esto preserva la semántica retrocompatible: módulos viejos siguen leyendo
      // `locked` como "todo cerrado".
      const allLocked = ['1', '2', '3'].every(g => lockedByGrade[g] === true);
      const noneLocked = ['1', '2', '3'].every(g => lockedByGrade[g] === false);

      const closedByGrade = (current.closedByGrade && typeof current.closedByGrade === 'object')
        ? { ...current.closedByGrade }
        : {};
      if (isLock) {
        closedByGrade[String(grado)] = new Date().toISOString();
      } else {
        delete closedByGrade[String(grado)];
      }

      const userName = App.currentUser?.displayName || App.currentUser?.email || 'admin';
      const update = {
        lockedByGrade,
        closedByGrade,
        locked: allLocked,                  // true solo si los 3 cerrados
        updatedAt: new Date(),
        updatedBy: userName,
      };
      if (allLocked && !current.locked) {
        update.closedAt = new Date();
        update.closedBy = userName;
      } else if (noneLocked && current.locked) {
        update.openedAt = new Date();
        update.openedBy = userName;
        update.closedAt = null;
      }

      // GARANTÍA: al ABRIR un grado, eliminar CUALQUIER cierre programado que
      // pudiera re-cerrarlo solo en el siguiente render (loadAndRenderPartials).
      // Sin esto, el admin "abre" y el auto-cierre lo vuelve a cerrar, obligándolo
      // a mover/cancelar fechas a mano. Un grado abierto manualmente NUNCA debe
      // re-cerrarse por una fecha programada — la acción manual siempre gana.
      if (!isLock) {
        const g = String(grado);
        const schedBG = (current.scheduledCloseByGrade && typeof current.scheduledCloseByGrade === 'object')
          ? { ...current.scheduledCloseByGrade } : {};
        // 1) Quitar el cierre programado de ESTE grado (si lo tenía).
        delete schedBG[g];
        // 2) El scheduledCloseAt GLOBAL cierra los 3 grados al vencer — cerraría
        //    también el que acabamos de abrir. Lo "bajamos" a los OTROS grados
        //    (preservando su intención de cierre) y limpiamos el global. Así el
        //    grado abierto queda sin ninguna fecha que lo afecte.
        if (current.scheduledCloseAt) {
          ['1', '2', '3'].forEach(other => {
            if (other !== g && !(other in schedBG)) schedBG[other] = current.scheduledCloseAt;
          });
          update.scheduledCloseAt = null;
        }
        update.scheduledCloseByGrade = schedBG;
      }

      await docRef.set(update, { merge: true });
      Toast.show(`${isLock ? 'Cerrado' : 'Abierto'} ${partialId} para ${grado}° grado`, 'success');

      // Invalidar caché de partials para que la siguiente lectura sea fresca
      try { if (Store && typeof Store.invalidatePartials === 'function') Store.invalidatePartials(); } catch (_) {}

      await loadAndRenderPartials();
    } catch (e) {
      console.error('executeGradeLockAction:', e);
      Toast.show('Error: ' + (e.message || e), 'error');
    }
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
        // ID DETERMINÍSTICO: `${partialId}_${teacherId}` para que las
        // firestore.rules puedan validarlo con exists()/get() sin queries.
        // .set() reemplaza si ya existía un override del mismo maestro para
        // el mismo parcial (renueva la vigencia).
        const overrideDocId = `${partialId}_${teacherId}`;
        await db.collection('partialOverrides').doc(overrideDocId).set({
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

  // Otorga a UN docente permiso para PEDIR corrección de este parcial cerrado,
  // sin abrir la ventana global a todos. Escribe correctionGrants/{partial}_{teacherId}.
  // El docente verá el parcial habilitado en "Cambios de Calificación" y podrá
  // mandar su solicitud, que Dirección aprueba como cualquier corrección.
  async function showCorrectionGrantModal(partialId, partialName) {
    const teachers = await Store.getTeachers();
    const activeTeachers = teachers.filter(t => t.status === 'active')
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    const teacherOptions = activeTeachers.map(t =>
      `<option value="${t.id}" data-name="${Utils.sanitize(t.nombre)}">${Utils.sanitize(Utils.displayName ? Utils.displayName(t.nombre) : t.nombre)} (${Utils.sanitize(t.turno || '')})</option>`
    ).join('');

    const bodyHTML = `
      <p>Permite a un docente <strong>pedir corrección</strong> de <strong>${Utils.sanitize(partialName)}</strong> (cerrado) sin abrir la ventana general a todos.</p>
      <div style="background:#eff6ff;border-left:3px solid #3182ce;padding:8px 12px;font-size:12px;color:#1e40af;border-radius:4px;margin-bottom:12px;line-height:1.45;">
        El docente NO captura directo: manda una <strong>solicitud</strong> que tú apruebas en "Cambios de Calificación".
      </div>
      <div class="form-group">
        <label>Docente</label>
        <select id="grantTeacher">
          <option value="">Seleccionar docente...</option>
          ${teacherOptions}
        </select>
      </div>
      <div class="form-group">
        <label>Cierra el (opcional)</label>
        <input type="datetime-local" id="grantExpiry">
        <p class="text-muted" style="font-size:11px;margin-top:4px;">Si lo dejas vacío, el permiso queda hasta que lo retires manualmente.</p>
      </div>
    `;
    const footerHTML = `
      <button class="btn btn-outline" id="cancelGrant">Cancelar</button>
      <button class="btn btn-primary" id="confirmGrant">Otorgar permiso</button>
    `;
    Modal.open('Permitir solicitud de corrección', bodyHTML, footerHTML);
    document.getElementById('cancelGrant').addEventListener('click', () => Modal.close());
    document.getElementById('confirmGrant').addEventListener('click', async () => {
      const select = document.getElementById('grantTeacher');
      const teacherId = select.value;
      if (!teacherId) { Toast.show('Selecciona un docente', 'warning'); return; }
      const teacherName = select.options[select.selectedIndex].dataset.name;
      const expiryInput = document.getElementById('grantExpiry').value;
      const closesAt = expiryInput ? new Date(expiryInput) : null;
      try {
        await db.collection('correctionGrants').doc(`${partialId}_${teacherId}`).set({
          partialId,
          teacherId,
          teacherName,
          closesAt,
          grantedBy: App.currentUser.uid,
          grantedByName: App.currentUser.displayName || App.currentUser.email,
          grantedAt: new Date()
        });
        DB.audit('otorgar_permiso_correccion', 'parcial', partialId, {
          description: `Permiso de solicitud de corrección otorgado a ${teacherName} en ${partialName}`
        });
        Modal.close();
        Toast.show(`${teacherName} ya puede pedir corrección de ${partialName}`, 'success');
        await loadAndRenderPartials();
        bindEvents();
      } catch (e) {
        console.error('correction-grant:', e);
        Toast.show('Error al otorgar permiso: ' + (e.message || e), 'error');
      }
    });
  }

  // v8.08: programar cierre por grado(s) — útil cuando un parcial tiene fechas
  // distintas por nivel (ej. P3: 3° cierra 12 jun, 1°+2° cierran 24 jun).
  function showScheduleCloseModal(partialId, partialName) {
    // Default: mañana 23:59
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 0, 0);
    // BUG FIX: NO usar toISOString() (devuelve UTC). El input datetime-local
    // interpreta su valor como hora LOCAL, así que toISOString corría el
    // default +6h (México UTC-6): "24 jun 23:59" salía como "25 jun 05:59" y
    // los cierres ocurrían a horas equivocadas. Construir desde partes locales.
    const _pad = (n) => String(n).padStart(2, '0');
    const defaultVal = `${tomorrow.getFullYear()}-${_pad(tomorrow.getMonth() + 1)}-${_pad(tomorrow.getDate())}T${_pad(tomorrow.getHours())}:${_pad(tomorrow.getMinutes())}`;

    const bodyHTML = `
      <p>Programar cierre automático de <strong>${Utils.sanitize(partialName)}</strong>.</p>

      <div class="form-group">
        <label>¿Para qué grado(s)?</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;border-radius:6px;cursor:pointer;border:2px solid transparent;" data-scope-label>
            <input type="radio" name="scheduleScope" value="all" checked style="margin:0;">
            <span style="font-weight:600;">Todos los grados</span>
            <span style="font-size:11px;color:#64748b;">(1°, 2° y 3°)</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;border-radius:6px;cursor:pointer;border:2px solid transparent;" data-scope-label>
            <input type="radio" name="scheduleScope" value="1,2" style="margin:0;">
            <span style="font-weight:600;">Solo 1° y 2° grado</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;border-radius:6px;cursor:pointer;border:2px solid transparent;" data-scope-label>
            <input type="radio" name="scheduleScope" value="3" style="margin:0;">
            <span style="font-weight:600;">Solo 3° grado</span>
            <span style="font-size:11px;color:#64748b;">(suele cerrar antes)</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;border-radius:6px;cursor:pointer;border:2px solid transparent;" data-scope-label>
            <input type="radio" name="scheduleScope" value="1" style="margin:0;">
            <span style="font-weight:600;">Solo 1° grado</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f1f5f9;border-radius:6px;cursor:pointer;border:2px solid transparent;" data-scope-label>
            <input type="radio" name="scheduleScope" value="2" style="margin:0;">
            <span style="font-weight:600;">Solo 2° grado</span>
          </label>
        </div>
      </div>

      <div class="form-group">
        <label>Fecha y hora de cierre</label>
        <input type="datetime-local" id="scheduledClose" value="${defaultVal}" required>
      </div>
      <p class="text-muted" style="font-size:11px;">El parcial se cerrará automáticamente para los grados seleccionados al pasar esta fecha. Puedes programar otra fecha distinta para los demás grados después.</p>
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
      const scope = document.querySelector('input[name="scheduleScope"]:checked')?.value || 'all';
      const grados = scope === 'all' ? ['1', '2', '3'] : scope.split(',').map(s => s.trim());

      try {
        const docRef = db.collection('partials').doc(partialId);
        const snap = await docRef.get();
        const current = snap.exists ? snap.data() : {};

        // Si el scope incluye TODOS los grados, también guardamos el campo
        // global `scheduledCloseAt` (compat con código viejo). Si es por
        // subconjunto, dejamos solo scheduledCloseByGrade.
        const scheduledByGrade = (current.scheduledCloseByGrade && typeof current.scheduledCloseByGrade === 'object')
          ? { ...current.scheduledCloseByGrade }
          : {};
        grados.forEach(g => { scheduledByGrade[g] = scheduledDate; });

        const update = {
          scheduledCloseByGrade: scheduledByGrade,
          updatedAt: new Date(),
          updatedBy: App.currentUser?.uid,
        };
        // Mantener scheduledCloseAt global SOLO si los 3 grados tienen la MISMA fecha
        const allGrades = ['1', '2', '3'];
        const allSame = allGrades.every(g => {
          const d = scheduledByGrade[g];
          if (!d) return false;
          const dt = d.toDate ? d.toDate() : new Date(d);
          return dt.getTime() === scheduledDate.getTime();
        });
        update.scheduledCloseAt = allSame ? scheduledDate : null;

        await docRef.set(update, { merge: true });
        Modal.close();
        const fechaStr = scheduledDate.toLocaleDateString('es-MX') + ' a las ' + scheduledDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const scopeStr = scope === 'all' ? 'todos los grados' : grados.map(g => g + '°').join(' y ') + ' grado';
        Toast.show(`Cierre programado para ${scopeStr}: ${fechaStr}`, 'success');
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
        scheduledCloseByGrade: {},
        updatedAt: new Date(),
        updatedBy: App.currentUser?.uid
      });
      Toast.show(`Cierres programados de ${partialName} cancelados`, 'success');
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

  async function removeCorrectionGrant(grantId) {
    try {
      await db.collection('correctionGrants').doc(grantId).delete();
      Toast.show('Permiso de corrección retirado', 'success');
      await loadAndRenderPartials();
      bindEvents();
    } catch (error) {
      console.error('Error removing correction grant:', error);
      Toast.show('Error al retirar permiso', 'error');
    }
  }

  async function executeAction(partialId, action) {
    try {
      const locked = action === 'lock';
      const now = new Date();
      const userName = App.currentUser?.displayName || App.currentUser?.email || App.currentUser?.uid;

      const updateData = {
        locked,
        // v8.07: el toggle global afecta los 3 grados de una vez
        lockedByGrade: { '1': locked, '2': locked, '3': locked },
        updatedAt: now,
        updatedBy: App.currentUser?.uid
      };

      if (locked) {
        updateData.scheduledCloseAt = null; // Clear schedule
        updateData.scheduledCloseByGrade = {};
        updateData.closedAt = now;
        updateData.closedBy = userName;
        updateData.openedAt = null;
        updateData.openedBy = null;
        updateData.closedByGrade = { '1': now.toISOString(), '2': now.toISOString(), '3': now.toISOString() };
      } else {
        updateData.openedAt = now;
        updateData.openedBy = userName;
        updateData.closedAt = null;
        updateData.closedBy = null;
        updateData.closedByGrade = {};
        // CRÍTICO: limpiar el cierre programado también, porque el auto-cierre
        // se dispara en cada render si la fecha ya pasó — sin esto, el parcial
        // se re-cierra al instante después de cada apertura manual.
        updateData.scheduledCloseAt = null;
        updateData.scheduledCloseByGrade = {};
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
