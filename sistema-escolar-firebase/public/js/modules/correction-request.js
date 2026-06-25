/**
 * MODULO: SOLICITUD DE CAMBIO DE CALIFICACION (lado del maestro)
 * EPO 67 — Sistema Escolar
 *
 * Wizard paso a paso (4 pantallas):
 *   1) Elegir grupo + materia (asignacion)
 *   2) Elegir parcial
 *   3) Elegir alumno (uno a la vez, con buscador)
 *   4) Capturar nueva cal con botones +/- grandes y motivo
 *
 * Cada alumno seleccionado se agrega a un "carrito" en el paso 3. Cuando el
 * maestro termina, le da "Generar solicitud y PDF" y el sistema crea TODOS los
 * docs en gradeCorrections compartiendo el mismo folio.
 *
 * REGLA EPO 67: la cal solicitada NUNCA puede ser menor que la actual.
 * Validacion en frontend (3 botones quick-set y boton +) + firestore.rules + apply.
 */

const CorrectionRequestModule = (() => {
  const db = firebase.firestore();

  const MOTIVOS = [
    'Error de captura del maestro',
    'Error en suma de rubros',
    'Calificación de extraordinario',
    'Trabajo extemporáneo aceptado',
    'Error de identidad (otro alumno)',
    'Otro'
  ];

  const state = {
    wizardOpen: false, // si esta cerrado se muestra solo el boton "Nueva solicitud"
    step: 1,           // 1=asg, 2=parcial, 3=alumno, 4=detalle
    assignments: [],
    partials: [],      // docs de la colección partials para saber cuáles están cerrados
    selectedAsg: null,
    selectedPartial: null,
    students: [],
    grades: {},
    cart: {},
    activeStudent: null,
    studentSearch: '',
    myRecent: [],
  };

  // Devuelve los parciales según su estado de cerradura ahora mismo.
  // Regla EPO 67: solo se pueden solicitar cambios para parciales CERRADOS.
  // Mientras un parcial está abierto el maestro edita directamente en su lista.
  // v8.07: clasifica parciales considerando los grados de TODAS las asignaciones
  // del maestro. Un parcial es "cerrado" si está cerrado para AL MENOS UNO de
  // los grados que el maestro imparte (puede solicitar correcciones para ese
  // grado). Es "abierto" si está abierto para TODOS los grados del maestro
  // (no puede solicitar nada, debe editar directo).
  function _classifyPartials() {
    const closed = [];
    const open = [];
    // Grados únicos del maestro (extraídos de sus asignaciones)
    const myGrados = new Set();
    (state.assignments || []).forEach(a => {
      const g = K.gradeFromGroupId(a.groupId);
      if (g) myGrados.add(g);
    });
    const gradosArr = [...myGrados];
    K.PARCIALES.forEach(p => {
      const doc = state.partials.find(pp => pp.id === p.id);
      // Si no se puede inferir grados del maestro, fallback al campo global.
      let lockedForAny = false;
      if (gradosArr.length === 0) {
        lockedForAny = doc?.locked === true;
      } else {
        lockedForAny = gradosArr.some(g => K.isPartialLockedForGrade(doc, g));
      }
      if (lockedForAny) closed.push(p);
      else open.push(p);
    });
    return { closed, open };
  }

  // v8.07: ¿está la ventana de correcciones abierta?
  function _isCorrectionsWindowOpen() {
    return K.isCorrectionsWindowOpen(state.correctionsWindow);
  }

  const S = (v) => Utils.sanitize(String(v ?? ''));

  function _generateFolio() {
    const yy = new Date().getFullYear();
    const t = Date.now().toString(36).toUpperCase().slice(-6);
    return `SC-${yy}-${t}`;
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER PRINCIPAL — selecciona pantalla por step
  // ═══════════════════════════════════════════════════════════
  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    // Reset wizard al entrar al modulo
    state.wizardOpen = false;
    state.step = 1;
    state.selectedAsg = null;
    state.selectedPartial = null;
    state.students = [];
    state.grades = {};
    state.cart = {};
    state.activeStudent = null;
    state.studentSearch = '';

    container.innerHTML = `
      <div class="module-container">
        <h1 class="module-title">Cambios de Calificación</h1>
        <p class="module-subtitle">Aquí ves el estado de tus solicitudes y puedes crear nuevas.</p>

        <!-- 1. Solicitudes recientes (lo primero que ve el maestro) -->
        <div id="cr-recent"></div>

        <!-- 2. Boton para crear nueva (o wizard expandido) -->
        <div id="cr-newbtn" style="margin-top:16px;"></div>
        <div id="cr-stepper"></div>
        <div id="cr-screen"></div>
      </div>`;

    try {
      // FORCE=true en getPartials: el estado de cierre puede haber cambiado
      // hace segundos (admin cerró el parcial). Sin force, el cliente usa el
      // caché viejo y le bloquea las solicitudes diciendo "todos los parciales
      // están abiertos" aunque ya estén cerrados.
      // v8.37: admin/subdirector ven TODAS las assignments para poder
      // solicitar correcciones a nombre de cualquier maestro (caso típico:
      // un maestro reporta error pero no tiene acceso, Olivia lo hace por él).
      // Maestros normales (incluyendo Jessica con role aditivo): SOLO las suyas.
      const role = App.currentUser?.role;
      const isAdminFlow = role === 'admin' || role === 'subdirector';
      const asgsPromise = isAdminFlow ? Store.getAssignments() : Store.getOwnAssignments();
      const [asgs, parts, cw] = await Promise.all([
        asgsPromise,
        Store.getPartials(true),
        // v8.07: leer ventana de correcciones para bloqueo cuando esté cerrada
        db.collection('config').doc('correctionsWindow').get()
          .then(d => d.exists ? d.data() : null)
          .catch(() => null),
      ]);
      state.assignments = asgs || [];
      state.partials = parts || [];
      state.correctionsWindow = cw;
    } catch (e) {
      Toast.show('Error cargando datos: ' + e.message, 'error');
      state.assignments = [];
      state.partials = [];
      state.correctionsWindow = null;
    }

    // Permisos INDIVIDUALES de corrección (correctionGrants): Dirección puede
    // autorizar a ESTE docente a pedir corrección de un parcial específico
    // aunque la ventana global esté cerrada. docId = `${partialId}_${teacherId}`.
    state.correctionGrants = {};
    try {
      const tid = await Store.getTeacherDocId();
      if (tid) {
        const now = Date.now();
        const grantDocs = await Promise.all(K.PARCIALES.map(p =>
          db.collection('correctionGrants').doc(`${p.id}_${tid}`).get().catch(() => null)
        ));
        grantDocs.forEach((d, i) => {
          if (d && d.exists) {
            const g = d.data();
            const closes = g.closesAt
              ? (g.closesAt.toDate ? g.closesAt.toDate().getTime() : new Date(g.closesAt).getTime())
              : null;
            if (closes === null || closes > now) state.correctionGrants[K.PARCIALES[i].id] = true;
          }
        });
      }
    } catch (e) { console.warn('correctionGrants load:', e.message); }

    _bindGlobalEvents();
    await _loadMyRecent();
    _renderNewBtn();
    _renderStep();
  }

  function _renderNewBtn() {
    const root = document.getElementById('cr-newbtn');
    if (!root) return;
    if (state.wizardOpen) {
      root.innerHTML = `<button class="btn btn-outline" data-action="cr-close-wizard">
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">close</span>
        Cerrar nueva solicitud
      </button>`;
      return;
    }

    const { closed, open } = _classifyPartials();

    // Bloqueo total: ningún parcial está cerrado → no se pueden hacer solicitudes.
    // Esto fuerza al maestro a editar directamente en "Capturar Calificaciones".
    if (closed.length === 0) {
      root.innerHTML = `
        <div class="card" style="background:linear-gradient(135deg,#e0e7ff 0%,#c7d2fe 100%);border:2px solid #6366f1;border-radius:14px;padding:28px;">
          <div style="display:flex;gap:14px;align-items:flex-start;">
            <span class="material-icons-round" style="font-size:42px;color:#4338ca;flex-shrink:0;">lock_clock</span>
            <div style="flex:1;">
              <h2 style="font-size:18px;font-weight:800;color:#312e81;margin:0 0 8px;">
                Las solicitudes de cambio están bloqueadas
              </h2>
              <p style="font-size:14px;color:#3730a3;line-height:1.55;margin:0 0 12px;">
                Mientras el parcial esté <strong>abierto</strong>, NO puedes pedir un cambio
                formal a Dirección. Edita directamente en
                <a href="#grades" style="color:#1d4ed8;font-weight:700;text-decoration:underline;">Capturar Calificaciones</a>
                las veces que necesites — el sistema guarda solo.
              </p>
              <div style="background:#fff;border-radius:8px;padding:12px 14px;font-size:13px;color:#374151;border:1px solid #c7d2fe;">
                <strong style="color:#4338ca;">Estado de los parciales:</strong>
                <div style="margin-top:6px;">
                  ${open.map(p => `<div>🟢 <strong>${p.nombre}</strong>: abierto — edita libremente en tu lista</div>`).join('')}
                  ${closed.map(p => `<div>🔒 ${p.nombre}: cerrado</div>`).join('')}
                </div>
              </div>
            </div>
          </div>

          <div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:10px;padding:14px 16px;margin-top:14px;">
            <div style="display:flex;gap:10px;align-items:flex-start;">
              <span class="material-icons-round" style="color:#b45309;font-size:22px;flex-shrink:0;margin-top:1px;">warning</span>
              <div style="font-size:13px;color:#78350f;line-height:1.5;">
                <strong>Importante — Entrega a Dirección:</strong>
                Dirección recibe <strong>UNA sola lista impresa</strong> al final, con TODAS las firmas
                de tus alumnos. <strong>No puedes</strong> entregar primero una lista con errores y
                luego otra "con las correcciones" firmada solo por los corregidos. Si imprimes a
                medias o con errores, deberás <strong>reimprimir la lista completa y volver a
                recoger TODAS las firmas</strong> antes de entregar.
              </div>
            </div>
          </div>
        </div>`;
      return;
    }

    // Hay al menos un parcial cerrado: permitir solicitud.
    root.innerHTML = `
      <div class="card" style="background:#eff6ff;border:2px dashed #3182ce;text-align:center;padding:24px;">
        <span class="material-icons-round" style="color:#3182ce;font-size:36px;">add_circle</span>
        <div style="font-size:15px;font-weight:600;color:#1e40af;margin:6px 0;">¿Necesitas pedir un cambio para un parcial ya cerrado?</div>
        <p style="font-size:12px;color:#1e40af;opacity:0.85;margin:4px 0 12px;max-width:520px;margin-left:auto;margin-right:auto;line-height:1.45;">
          Solo se aceptan solicitudes para parciales cerrados.
          ${open.length > 0 ? `Para el ${open.map(p => p.nombre).join(' o ')} (abierto), edita directamente en tu lista.` : ''}
        </p>
        <button class="btn btn-primary" data-action="cr-open-wizard" style="font-weight:700;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">add</span>
          Crear nueva solicitud
        </button>
      </div>`;
  }

  // Stepper visual arriba (1 - 2 - 3 - 4)
  function _renderStepper() {
    const root = document.getElementById('cr-stepper');
    if (!root) return;
    const steps = [
      { n: 1, label: 'Materia y grupo' },
      { n: 2, label: 'Parcial' },
      { n: 3, label: 'Alumno(s)' },
      { n: 4, label: 'Cambio' },
    ];
    root.innerHTML = `
      <div style="display:flex;gap:4px;margin-bottom:20px;flex-wrap:wrap;">
        ${steps.map(s => {
          const isCurrent = state.step === s.n;
          const isPast = state.step > s.n;
          const color = isCurrent ? '#1e40af' : (isPast ? '#16a34a' : '#cbd5e1');
          const bg = isCurrent ? '#dbeafe' : (isPast ? '#d1fae5' : '#f1f5f9');
          const fontWeight = isCurrent ? '700' : '500';
          const icon = isPast ? 'check_circle' : 'radio_button_unchecked';
          return `<div style="flex:1;min-width:120px;padding:10px;background:${bg};border-left:4px solid ${color};border-radius:4px;">
            <div style="display:flex;gap:6px;align-items:center;">
              <span class="material-icons-round" style="color:${color};font-size:18px;">${icon}</span>
              <span style="font-size:11px;color:${color};font-weight:600;text-transform:uppercase;">PASO ${s.n}</span>
            </div>
            <div style="font-size:13px;color:#1e293b;font-weight:${fontWeight};margin-top:2px;">${s.label}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function _renderStep() {
    const stepper = document.getElementById('cr-stepper');
    const screen = document.getElementById('cr-screen');
    if (!state.wizardOpen) {
      if (stepper) stepper.innerHTML = '';
      if (screen) screen.innerHTML = '';
      return;
    }
    _renderStepper();
    if (state.step === 1) _renderStep1();
    else if (state.step === 2) _renderStep2();
    else if (state.step === 3) _renderStep3();
    else if (state.step === 4) _renderStep4();
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 1 — ELEGIR GRUPO + MATERIA
  // ═══════════════════════════════════════════════════════════
  function _renderStep1() {
    const root = document.getElementById('cr-screen');
    if (!root) return;

    if (!state.assignments.length) {
      root.innerHTML = `<div class="card"><div class="empty-state">
        <span class="material-icons-round empty-state-icon">folder_off</span>
        <p class="empty-state-text">No tienes grupos asignados.</p></div></div>`;
      return;
    }

    // Orden SEP universal: turno → grado → grupo → SEP de materia → alfabético
    const _sepIdx = (name, grado) => {
      const order = (K.SUBJECT_ORDER && K.SUBJECT_ORDER[Number(grado)]) || [];
      const i = order.findIndex(n => K.normalizeSubjectName ? K.normalizeSubjectName(n) === K.normalizeSubjectName(name) : n === name);
      return i === -1 ? 9999 : i;
    };
    const _asgsSorted = [...state.assignments].sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') ||
      (Number(a.grado) || 0) - (Number(b.grado) || 0) ||
      (a.groupName || '').localeCompare(b.groupName || '') ||
      (_sepIdx(a.subjectName, a.grado) - _sepIdx(b.subjectName, b.grado)) ||
      (a.subjectName || '').localeCompare(b.subjectName || '')
    );

    // v8.37: admin/subdirector pueden ver muchas asignaciones (hasta 216).
    // Mostramos buscador para filtrar por nombre de maestro/grupo/materia.
    const userRole = App.currentUser?.role;
    const isAdminFlow = userRole === 'admin' || userRole === 'subdirector';

    const cards = _asgsSorted.map(a => {
      // En modo admin, mostrar también el nombre del maestro responsable
      const teacherNameStr = isAdminFlow && a.teacherName
        ? `<div style="font-size:11px;color:#3182ce;font-weight:600;margin-bottom:6px;">👤 ${S(Utils.displayName ? Utils.displayName(a.teacherName) : a.teacherName)}</div>`
        : '';
      const searchKey = `${a.groupName || ''} ${a.subjectName || ''} ${a.teacherName || ''} ${a.turno || ''}`.toLowerCase();
      return `
      <button data-action="cr-pick-asg" data-asg-id="${S(a.id)}" data-search-key="${S(searchKey)}"
              class="cr-asg-card"
              style="background:#fff;border:2px solid #cbd5e1;border-radius:8px;padding:16px;text-align:left;cursor:pointer;transition:all 0.15s;font-family:inherit;width:100%;"
              onmouseover="this.style.borderColor='#3182ce';this.style.background='#eff6ff';"
              onmouseout="this.style.borderColor='#cbd5e1';this.style.background='#fff';">
        ${teacherNameStr}
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:4px;">
          ${S(a.groupName)}
        </div>
        <div style="font-size:14px;color:#475569;margin-bottom:8px;">
          ${S(K.getUACNombre(a.subjectName))}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span class="badge badge-${(a.turno || '').toLowerCase() === 'matutino' ? 'matutino' : 'vespertino'}">${S(a.turno)}</span>
          <span class="badge" style="background:#f1f5f9;color:#475569;">${S(a.grado)}° grado</span>
        </div>
      </button>
    `}).join('');

    // Buscador solo aparece si hay muchas tarjetas (admin)
    const searchBar = _asgsSorted.length > 10 ? `
      <div style="margin:14px 0 6px;">
        <input type="text" id="cr-asg-search" placeholder="🔍 Buscar por maestro, grupo o materia..."
          style="width:100%;padding:10px 14px;font-size:14px;border:2px solid #cbd5e1;border-radius:6px;">
        <div id="cr-asg-search-count" style="font-size:11px;color:#64748b;margin-top:4px;font-style:italic;">${_asgsSorted.length} asignaciones</div>
      </div>` : '';

    const adminBanner = isAdminFlow && _asgsSorted.length > 30 ? `
      <div style="background:#fef3c7;border-left:3px solid #d97706;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#78350f;border-radius:4px;">
        <strong>Modo administrativo:</strong> puedes solicitar correcciones a nombre de cualquier maestro.
        La solicitud quedará registrada con tu cuenta como "aplicada por" y el maestro responsable de la materia como dueño.
      </div>` : '';

    root.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0;">¿En qué grupo y materia está el error?</h2>
        <p style="color:#64748b;font-size:14px;margin-top:0;">
          Toca la tarjeta del grupo donde quieres cambiar una calificación.
        </p>
        ${adminBanner}
        ${searchBar}
        <div id="cr-asg-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:16px;">
          ${cards}
        </div>
      </div>`;

    // Búsqueda en vivo (admin)
    const searchEl = document.getElementById('cr-asg-search');
    const countEl = document.getElementById('cr-asg-search-count');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        const q = (searchEl.value || '').toLowerCase().trim();
        const cards = document.querySelectorAll('.cr-asg-card');
        let visible = 0;
        cards.forEach(c => {
          const key = c.dataset.searchKey || '';
          const match = !q || key.includes(q);
          c.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        if (countEl) countEl.textContent = q
          ? `${visible} de ${_asgsSorted.length} asignaciones`
          : `${_asgsSorted.length} asignaciones`;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 2 — ELEGIR PARCIAL
  // ═══════════════════════════════════════════════════════════
  function _renderStep2() {
    const root = document.getElementById('cr-screen');
    if (!root) return;

    const asg = state.selectedAsg;
    // v8.07: grado del grupo de la asignación seleccionada (1, 2 o 3)
    const grado = K.gradeFromGroupId(asg?.groupId);
    const windowOpen = _isCorrectionsWindowOpen();

    // Solo parciales CERRADOS para EL GRADO de este grupo son seleccionables.
    // Adicional: si la ventana de correcciones está cerrada → nada es clickeable.
    const buttons = K.PARCIALES.map(p => {
      const doc = state.partials.find(pp => pp.id === p.id);
      const isLockedForGrade = K.isPartialLockedForGrade(doc, grado);
      // Permiso individual de Dirección para ESTE parcial (sin ventana global).
      const hasGrant = !!(state.correctionGrants && state.correctionGrants[p.id]);
      const canClick = isLockedForGrade && (windowOpen || hasGrant);

      if (canClick) {
        const permLabel = (!windowOpen && hasGrant)
          ? '🔒 Cerrado para ' + grado + '° · ✅ Autorizado por Dirección'
          : '🔒 Cerrado para ' + grado + '° · Solicitud permitida';
        return `<button data-action="cr-pick-partial" data-partial-id="${S(p.id)}"
                style="background:#fff;border:2px solid #cbd5e1;border-radius:8px;padding:24px;cursor:pointer;font-family:inherit;font-size:18px;font-weight:700;color:#1e293b;transition:all 0.15s;"
                onmouseover="this.style.borderColor='#3182ce';this.style.background='#eff6ff';"
                onmouseout="this.style.borderColor='#cbd5e1';this.style.background='#fff';">
          <div style="font-size:28px;color:#3182ce;margin-bottom:8px;">${S(p.numero)}°</div>
          <div>${S(p.nombre)}</div>
          <div style="margin-top:8px;font-size:11px;color:#16a34a;font-weight:600;">${permLabel}</div>
        </button>`;
      }

      // Razón de bloqueo según el caso
      let reasonHtml;
      if (!windowOpen && !hasGrant) {
        reasonHtml = `<div style="margin-top:8px;font-size:11px;color:#b91c1c;font-weight:700;line-height:1.35;">
          ⏰ Ventana de correcciones<br><strong>CERRADA</strong>
        </div>`;
      } else if (!isLockedForGrade) {
        reasonHtml = `<div style="margin-top:8px;font-size:11px;color:#b45309;font-weight:700;line-height:1.35;">
          🟢 Abierto para ${grado}°<br>Edita en tu lista, no aquí
        </div>`;
      } else {
        reasonHtml = `<div style="margin-top:8px;font-size:11px;color:#94a3b8;font-weight:700;">No disponible</div>`;
      }
      return `<button disabled
              style="background:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;padding:24px;cursor:not-allowed;font-family:inherit;font-size:18px;font-weight:700;color:#94a3b8;opacity:0.85;">
        <div style="font-size:28px;color:#94a3b8;margin-bottom:8px;">${S(p.numero)}°</div>
        <div>${S(p.nombre)}</div>
        ${reasonHtml}
      </button>`;
    }).join('');

    // Banner extra cuando la ventana está cerrada. Si Dirección le dio un
    // permiso INDIVIDUAL a este docente, mostramos un aviso verde en su lugar.
    const anyGrant = state.correctionGrants && Object.keys(state.correctionGrants).length > 0;
    let windowBanner = '';
    if (!windowOpen && anyGrant) {
      windowBanner = `
      <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:10px;padding:14px 18px;margin-bottom:14px;display:flex;gap:12px;align-items:flex-start;">
        <span class="material-icons-round" style="color:#15803d;font-size:26px;flex-shrink:0;">verified</span>
        <div style="flex:1;font-size:13px;color:#166534;line-height:1.5;">
          <strong style="font-size:14px;">Tienes autorización individual de Dirección</strong><br>
          La ventana general está cerrada, pero Dirección te permitió pedir corrección de un parcial específico (marcado en verde abajo).
        </div>
      </div>`;
    } else if (!windowOpen) {
      windowBanner = `
      <div style="background:#fef2f2;border:2px solid #dc2626;border-radius:10px;padding:14px 18px;margin-bottom:14px;display:flex;gap:12px;align-items:flex-start;">
        <span class="material-icons-round" style="color:#b91c1c;font-size:26px;flex-shrink:0;">lock_clock</span>
        <div style="flex:1;font-size:13px;color:#7f1d1d;line-height:1.5;">
          <strong style="font-size:14px;">Ventana de correcciones CERRADA</strong><br>
          No se pueden mandar nuevas solicitudes hasta que Dirección abra la ventana.
          Habla con Subdirección/Dirección si necesitas hacer un cambio urgente.
        </div>
      </div>`;
    }

    root.innerHTML = `
      <div class="card">
        <button data-action="cr-back" style="background:none;border:none;color:#3182ce;cursor:pointer;font-size:14px;padding:0;margin-bottom:8px;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">arrow_back</span>
          Cambiar grupo/materia
        </button>
        <h2 style="margin-top:8px;">¿En que parcial esta el error?</h2>
        <div style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:13px;color:#475569;margin-bottom:12px;display:inline-block;">
          <strong>${S(asg.groupName)}</strong> · ${S(K.getUACNombre(asg.subjectName))}
        </div>
        ${windowBanner}
        <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:12px;color:#78350f;margin-bottom:16px;line-height:1.45;">
          <strong>Reglas EPO 67:</strong> solo se aceptan solicitudes para parciales <strong>cerrados</strong> Y mientras la ventana de correcciones esté abierta.
          Si el parcial sigue abierto para ${grado}° grado, edita las calificaciones tú mismo en
          <a href="#grades" style="color:#1d4ed8;font-weight:700;">"Capturar Calificaciones"</a>
          y reimprime tu lista al final con todas las firmas.
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:600px;">
          ${buttons}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 3 — ELEGIR ALUMNO
  // ═══════════════════════════════════════════════════════════
  function _renderStep3() {
    const root = document.getElementById('cr-screen');
    if (!root) return;

    const asg = state.selectedAsg;
    const partialName = K.PARCIALES.find(p => p.id === state.selectedPartial)?.nombre || '';

    const cartCount = Object.keys(state.cart).length;
    const cartHtml = cartCount > 0 ? `
      <div class="card" style="background:#f0fdf4;border-left:4px solid #16a34a;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:14px;font-weight:700;color:#065f46;">
              ✓ ${cartCount} alumno(s) listo(s) para solicitud
            </div>
            <div style="font-size:12px;color:#047857;margin-top:2px;">
              ${Object.values(state.cart).map(c => S(c.studentName.split(' ').slice(-2).join(' ')) + ' (' + c.currentGrade + '→' + c.newGrade + ')').join(', ')}
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" data-action="cr-clear-cart">
              <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">delete</span>
              Limpiar
            </button>
            <button class="btn btn-primary" data-action="cr-finalize" style="font-weight:700;">
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">picture_as_pdf</span>
              Generar solicitud y PDF
            </button>
          </div>
        </div>
      </div>` : '';

    // Filtro por busqueda
    const q = state.studentSearch.toLowerCase().trim();
    const filtered = state.students.filter(s => {
      if (!q) return true;
      return (s.nombreCompleto || '').toLowerCase().includes(q);
    });

    const rows = filtered.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#888;padding:24px;">
           ${state.students.length === 0 ? 'Cargando alumnos...' : 'No hay alumnos que coincidan con tu busqueda.'}
         </td></tr>`
      : filtered.map((s, i) => {
        const sid = s.docId || s.id;
        const g = state.grades[sid] || {};
        const calActual = (g.cal !== undefined && g.cal !== null && g.cal !== '') ? Number(g.cal) : null;
        const inCart = !!state.cart[sid];
        const calBadge = calActual === null
          ? '<span style="color:#888;font-style:italic;">Sin captura</span>'
          : `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;background:${calActual < 6 ? '#fee2e2' : '#dcfce7'};color:${calActual < 6 ? '#991b1b' : '#166534'};">${calActual}</span>`;
        return `
          <tr style="${inCart ? 'background:#f0fdf4;' : ''}">
            <td style="text-align:center;color:#888;width:40px;">${i + 1}</td>
            <td style="font-weight:600;">${S(Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto)}</td>
            <td style="text-align:center;">${calBadge}</td>
            <td style="text-align:center;">
              ${inCart
                ? `<button class="btn btn-sm" style="background:#16a34a;color:#fff;" data-action="cr-pick-student" data-student-id="${S(sid)}">
                    <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">edit</span>
                    Editar
                  </button>`
                : `<button class="btn btn-sm btn-primary" data-action="cr-pick-student" data-student-id="${S(sid)}">
                    <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">add</span>
                    Solicitar cambio
                  </button>`
              }
            </td>
          </tr>`;
      }).join('');

    root.innerHTML = `
      <div class="card">
        <button data-action="cr-back" style="background:none;border:none;color:#3182ce;cursor:pointer;font-size:14px;padding:0;margin-bottom:8px;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">arrow_back</span>
          Cambiar parcial
        </button>
        <h2 style="margin-top:8px;">¿De cual alumno quieres cambiar la calificación?</h2>
        <div style="background:#f1f5f9;padding:8px 12px;border-radius:6px;font-size:13px;color:#475569;margin-bottom:16px;display:inline-block;">
          <strong>${S(asg.groupName)}</strong> · ${S(K.getUACNombre(asg.subjectName))} · ${S(partialName)}
        </div>

        ${cartHtml}

        <div class="form-group" style="max-width:400px;">
          <label style="font-size:13px;font-weight:600;">Buscar alumno por nombre</label>
          <input type="text" id="cr-search" placeholder="Empieza a escribir..."
                 value="${S(state.studentSearch)}"
                 style="width:100%;padding:10px;font-size:14px;border:1px solid #cbd5e0;border-radius:6px;">
        </div>

        <div class="table-container" style="margin-top:8px;max-height:480px;overflow-y:auto;">
          <table class="table-light" style="font-size:14px;">
            <thead style="position:sticky;top:0;background:#fff;z-index:1;">
              <tr>
                <th style="width:40px;">#</th>
                <th>Nombre</th>
                <th style="text-align:center;">Cal. actual</th>
                <th style="text-align:center;width:160px;">Accion</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    // Buscador en vivo
    const searchEl = document.getElementById('cr-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.studentSearch = searchEl.value;
        _renderStep3();
        // Mantener foco en el input
        const newSearch = document.getElementById('cr-search');
        if (newSearch) {
          newSearch.focus();
          newSearch.setSelectionRange(state.studentSearch.length, state.studentSearch.length);
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PASO 4 — DETALLE DEL CAMBIO (alumno seleccionado)
  // ═══════════════════════════════════════════════════════════
  function _renderStep4() {
    const root = document.getElementById('cr-screen');
    if (!root) return;
    const sid = state.activeStudent;
    if (!sid) { state.step = 3; _renderStep(); return; }

    const stu = state.students.find(s => (s.docId || s.id) === sid);
    if (!stu) { state.step = 3; _renderStep(); return; }

    const g = state.grades[sid] || {};
    const calActual = (g.cal !== undefined && g.cal !== null && g.cal !== '') ? Number(g.cal) : null;
    const minAllowed = calActual !== null ? calActual : 5;

    // Si ya estaba en cart, recuperar valores
    const existing = state.cart[sid] || {};
    const newGrade = existing.newGrade || (calActual !== null ? calActual : minAllowed);
    const motivo = existing.motivo || '';
    const motivoOtro = existing.motivoOtro || '';

    const motivoOpts = MOTIVOS.map(m =>
      `<option value="${S(m)}" ${motivo === m ? 'selected' : ''}>${S(m)}</option>`
    ).join('');

    const calActualDisplay = calActual === null
      ? `<div style="font-size:14px;color:#888;font-style:italic;">Sin captura previa</div>`
      : `<div style="font-size:64px;font-weight:800;color:${calActual < 6 ? '#dc2626' : '#16a34a'};line-height:1;">${calActual}</div>`;

    const isMin = newGrade <= minAllowed;
    const isMax = newGrade >= 10;

    root.innerHTML = `
      <div class="card">
        <button data-action="cr-step4-back" style="background:none;border:none;color:#3182ce;cursor:pointer;font-size:14px;padding:0;margin-bottom:8px;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">arrow_back</span>
          Volver a la lista de alumnos
        </button>

        <h2 style="margin-top:8px;color:#1e293b;">
          Cambio para: <span style="color:#3182ce;">${S(Utils.displayName ? Utils.displayName(stu.nombreCompleto) : stu.nombreCompleto)}</span>
        </h2>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px;align-items:center;">
          <!-- CAL ACTUAL -->
          <div style="text-align:center;background:#f8fafc;padding:24px;border-radius:8px;border:2px solid #e2e8f0;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:1px;margin-bottom:8px;">
              Cal. ACTUAL en el sistema
            </div>
            ${calActualDisplay}
          </div>

          <!-- CAL NUEVA -->
          <div style="text-align:center;background:#eff6ff;padding:24px;border-radius:8px;border:2px solid #3182ce;">
            <div style="font-size:11px;color:#1e40af;text-transform:uppercase;font-weight:700;letter-spacing:1px;margin-bottom:8px;">
              Cal. NUEVA solicitada
            </div>
            <div style="display:flex;gap:12px;justify-content:center;align-items:center;">
              <button data-action="cr-grade-minus"
                      style="width:54px;height:54px;border-radius:50%;border:none;background:${isMin ? '#cbd5e1' : '#dc2626'};color:#fff;font-size:32px;font-weight:700;cursor:${isMin ? 'not-allowed' : 'pointer'};"
                      ${isMin ? 'disabled' : ''}>−</button>
              <div style="font-size:64px;font-weight:800;color:#1e40af;line-height:1;min-width:80px;">
                ${newGrade}
              </div>
              <button data-action="cr-grade-plus"
                      style="width:54px;height:54px;border-radius:50%;border:none;background:${isMax ? '#cbd5e1' : '#16a34a'};color:#fff;font-size:32px;font-weight:700;cursor:${isMax ? 'not-allowed' : 'pointer'};"
                      ${isMax ? 'disabled' : ''}>+</button>
            </div>
            ${calActual !== null ? `
              <div style="font-size:12px;color:${isMin ? '#dc2626' : '#475569'};margin-top:8px;font-weight:${isMin ? '700' : '500'};">
                ${isMin ? '⚠ No puedes bajar de la cal. actual' : `Minimo permitido: ${minAllowed}`}
              </div>` : '<div style="font-size:12px;color:#475569;margin-top:8px;">Rango: 5 a 10</div>'}
          </div>
        </div>

        <div style="margin-top:24px;">
          <label style="font-size:14px;font-weight:600;color:#1e293b;display:block;margin-bottom:6px;">
            Motivo del cambio *
          </label>
          <select id="cr-motivo" style="width:100%;max-width:500px;padding:10px;font-size:14px;border:1px solid #cbd5e0;border-radius:6px;">
            <option value="">Selecciona un motivo</option>
            ${motivoOpts}
          </select>
        </div>

        ${motivo === 'Otro' ? `
          <div style="margin-top:16px;">
            <label style="font-size:14px;font-weight:600;color:#1e293b;display:block;margin-bottom:6px;">
              Detalle del motivo "Otro" *
            </label>
            <textarea id="cr-motivo-otro" rows="2"
                      placeholder="Explica brevemente"
                      style="width:100%;max-width:500px;padding:10px;font-size:14px;border:1px solid #cbd5e0;border-radius:6px;resize:vertical;">${S(motivoOtro)}</textarea>
          </div>` : `
          <div style="margin-top:16px;">
            <label style="font-size:14px;font-weight:600;color:#1e293b;display:block;margin-bottom:6px;">
              Detalle adicional (opcional)
            </label>
            <textarea id="cr-motivo-otro" rows="2"
                      placeholder="Aclaraciones (opcional)"
                      style="width:100%;max-width:500px;padding:10px;font-size:14px;border:1px solid #cbd5e0;border-radius:6px;resize:vertical;">${S(motivoOtro)}</textarea>
          </div>`}

        <div style="margin-top:32px;display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn btn-outline" data-action="cr-step4-cancel">Cancelar</button>
          <button class="btn btn-primary" data-action="cr-step4-add" style="font-weight:700;">
            <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">check_circle</span>
            Agregar a la solicitud
          </button>
        </div>

        <div style="margin-top:16px;padding:10px 12px;background:#fef3c7;border-left:4px solid #d97706;border-radius:4px;font-size:13px;color:#78350f;">
          <strong>Nota:</strong> Aun no se ha generado la solicitud. Después de agregar
          este alumno puedes seguir agregando mas. Genera el PDF cuando termines.
        </div>
      </div>`;

    // Bind motivo change para mostrar/ocultar el "detalle obligatorio"
    const motivoEl = document.getElementById('cr-motivo');
    if (motivoEl) {
      motivoEl.addEventListener('change', () => {
        // Guardar temporal en cart partial para no perder al re-render
        if (!state.cart[sid]) state.cart[sid] = {};
        state.cart[sid].motivo = motivoEl.value;
        // re-render para actualizar el textarea label
        _renderStep4();
      });
    }
    const motivoOtroEl = document.getElementById('cr-motivo-otro');
    if (motivoOtroEl) {
      motivoOtroEl.addEventListener('input', () => {
        if (!state.cart[sid]) state.cart[sid] = {};
        state.cart[sid].motivoOtro = motivoOtroEl.value;
      });
    }

    // Guardar el currentGrade en el cart pre-existente para persistencia
    if (!state.cart[sid]) state.cart[sid] = {};
    state.cart[sid].currentGrade = calActual;
    state.cart[sid].newGrade = newGrade;
    state.cart[sid].studentName = stu.nombreCompleto;
  }

  // ═══════════════════════════════════════════════════════════
  // EVENTOS GLOBAL
  // ═══════════════════════════════════════════════════════════
  let _eventsBound = false;
  function _bindGlobalEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    const container = document.getElementById('moduleContainer');
    container.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const a = target.dataset.action;

      if (a === 'cr-open-wizard') {
        state.wizardOpen = true;
        state.step = 1;
        _renderNewBtn();
        _renderStep();
        // Scroll suave al wizard
        setTimeout(() => {
          const screen = document.getElementById('cr-screen');
          if (screen) screen.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        return;
      }

      if (a === 'cr-close-wizard') {
        state.wizardOpen = false;
        state.step = 1;
        state.selectedAsg = null;
        state.selectedPartial = null;
        state.cart = {};
        state.activeStudent = null;
        _renderNewBtn();
        _renderStep();
        return;
      }

      if (a === 'cr-pick-asg') {
        const asgId = target.dataset.asgId;
        state.selectedAsg = state.assignments.find(x => x.id === asgId);
        state.step = 2;
        _renderStep();
        return;
      }

      if (a === 'cr-pick-partial') {
        const pid = target.dataset.partialId;
        // Defensa: re-verificar que el parcial siga cerrado (puede haberse abierto
        // desde que cargó la pantalla).
        try {
          const partials = await Store.getPartials();
          state.partials = partials || state.partials;
          const doc = state.partials.find(p => p.id === pid);
          if (!doc || doc.locked !== true) {
            Toast.show('Ese parcial está abierto. Edita directamente en tu lista.', 'warning');
            _renderStep();  // re-pinta con estado actualizado
            return;
          }
        } catch (e) {
          // Si falla la verificación seguimos con el flujo (Firestore rules lo bloqueará).
        }
        state.selectedPartial = pid;
        state.step = 3;
        _renderStep();
        await _loadStudents();
        _renderStep();
        return;
      }

      if (a === 'cr-back') {
        if (state.step === 2) state.step = 1;
        else if (state.step === 3) state.step = 2;
        _renderStep();
        return;
      }

      if (a === 'cr-pick-student') {
        const sid = target.dataset.studentId;
        state.activeStudent = sid;
        state.step = 4;
        _renderStep();
        return;
      }

      if (a === 'cr-step4-back' || a === 'cr-step4-cancel') {
        // No persistir si era nuevo, mantener si ya estaba en cart
        const sid = state.activeStudent;
        if (sid && state.cart[sid] && !state.cart[sid].motivo) {
          delete state.cart[sid];
        }
        state.activeStudent = null;
        state.step = 3;
        _renderStep();
        return;
      }

      if (a === 'cr-grade-minus') {
        const sid = state.activeStudent;
        if (!sid || !state.cart[sid]) return;
        const cur = Number(state.cart[sid].newGrade) || 5;
        const min = state.cart[sid].currentGrade !== null ? state.cart[sid].currentGrade : 5;
        if (cur > min) {
          state.cart[sid].newGrade = cur - 1;
          _renderStep4();
        }
        return;
      }

      if (a === 'cr-grade-plus') {
        const sid = state.activeStudent;
        if (!sid || !state.cart[sid]) return;
        const cur = Number(state.cart[sid].newGrade) || 5;
        if (cur < 10) {
          state.cart[sid].newGrade = cur + 1;
          _renderStep4();
        }
        return;
      }

      if (a === 'cr-step4-add') {
        const sid = state.activeStudent;
        if (!sid) return;
        const c = state.cart[sid] || {};
        if (!c.motivo) {
          Toast.show('Selecciona un motivo del cambio.', 'error');
          return;
        }
        if (c.motivo === 'Otro' && !(c.motivoOtro || '').trim()) {
          Toast.show('Detalla el motivo "Otro".', 'error');
          return;
        }
        // Sanity: la cal nueva no puede ser menor que la actual
        if (c.currentGrade !== null && Number(c.newGrade) < c.currentGrade) {
          Toast.show('La calificación solicitada no puede ser menor que la actual.', 'error');
          return;
        }
        // Listo, ya esta en cart con valores. Volver al paso 3.
        Toast.show('Alumno agregado a la solicitud.', 'success');
        state.activeStudent = null;
        state.step = 3;
        _renderStep();
        return;
      }

      if (a === 'cr-clear-cart') {
        if (!confirm('¿Quitar todos los alumnos de la solicitud?')) return;
        state.cart = {};
        _renderStep();
        return;
      }

      if (a === 'cr-finalize') {
        await _finalize();
        return;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CARGA DE ALUMNOS Y CALIFICACIONES
  // ═══════════════════════════════════════════════════════════
  async function _loadStudents() {
    if (!state.selectedAsg || !state.selectedPartial) return;
    try {
      const [students, gradesByGroup] = await Promise.all([
        Store.getStudentsByGroup(state.selectedAsg.groupId),
        Store.getGradesByGroupAndPartial(state.selectedAsg.groupId, state.selectedPartial),
      ]);
      state.students = (students || [])
        .filter(s => {
          const e = (s.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })
        .sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      state.grades = {};
      (gradesByGroup || []).forEach(g => {
        if (g.subjectId === state.selectedAsg.subjectId) {
          state.grades[g.studentId] = g;
        }
      });
    } catch (e) {
      console.error(e);
      Toast.show('Error cargando alumnos: ' + e.message, 'error');
      state.students = [];
      state.grades = {};
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FINALIZAR — guardar en Firestore + PDF
  // ═══════════════════════════════════════════════════════════
  async function _finalize() {
    const items = Object.entries(state.cart).map(([sid, c]) => ({
      studentId: sid,
      studentName: c.studentName,
      currentGrade: c.currentGrade,
      newGrade: Number(c.newGrade),
      motivo: c.motivo,
      motivoDetalle: c.motivoOtro || '',
    }));
    if (!items.length) {
      Toast.show('Agrega al menos un alumno antes de generar la solicitud.', 'warning');
      return;
    }
    // Validacion final defensiva
    for (const it of items) {
      if (it.currentGrade !== null && Number(it.newGrade) < it.currentGrade) {
        Toast.show(`${it.studentName}: la cal. solicitada no puede ser menor que la actual.`, 'error');
        return;
      }
    }
    // Defensa final: el parcial DEBE seguir cerrado en el momento de submit.
    // Esto cubre el caso de que entre seleccionar el parcial y dar "Generar" pase
    // mucho tiempo y el admin lo haya re-abierto.
    try {
      const partials = await Store.getPartials();
      state.partials = partials || state.partials;
      const pdoc = state.partials.find(p => p.id === state.selectedPartial);
      if (!pdoc || pdoc.locked !== true) {
        Toast.show('El parcial seleccionado ya no está cerrado. Edita directamente en tu lista.', 'error');
        state.wizardOpen = false;
        _renderNewBtn();
        _renderStep();
        return;
      }
    } catch (e) {
      // No bloquear si la red falla — las firestore.rules son la última línea de defensa.
    }

    const folio = _generateFolio();
    const asg = state.selectedAsg;
    // BUG FIX: el nombre y teacherId DEBEN venir de la asignación SELECCIONADA,
    // no de state.assignments[0] (la primera del array). Cuando un admin/subdirector
    // abre el wizard, getMyAssignments() devuelve TODAS las asignaciones y [0] es
    // la de OTRO profesor → la solicitud quedaba con el nombre equivocado
    // (ej. "ALARCON VARGAS MARIO ALBERTO" en una solicitud de Araceli Linares).
    // selectedAsg.teacherName/teacherId corresponden al docente real de la materia.
    // v8.37: aplicar Utils.displayName() para garantizar formato "NOMBRES APELLIDOS"
    // (antes se guardaba el formato bruto "APELLIDO1 APELLIDO2 NOMBRES" del registro
    // de teachers, que al mostrarse se veía mal — ej. "RAMIREZ OLIVIA PEÑA").
    const teacherNameRaw = asg?.teacherName || state.assignments[0]?.teacherName || App.currentUser?.displayName || '';
    const teacherName = Utils.displayName ? Utils.displayName(teacherNameRaw) : teacherNameRaw;
    const teacherDocId = asg?.teacherId || await Store.getTeacherDocId();
    const partialId = state.selectedPartial;
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const requestedAt = new Date();

    try {
      const batch = db.batch();
      for (const it of items) {
        const docRef = db.collection('gradeCorrections').doc();
        batch.set(docRef, {
          folio,
          status: 'pending',
          requestedAt: now,
          requestedBy: firebase.auth().currentUser.uid,
          requestedByName: teacherName,
          teacherId: teacherDocId,
          subjectId: asg.subjectId,
          subjectName: asg.subjectName,
          groupId: asg.groupId,
          groupName: asg.groupName,
          grado: asg.grado,
          turno: asg.turno,
          partial: partialId,
          studentId: it.studentId,
          studentName: it.studentName,
          currentGrade: it.currentGrade,
          newGrade: it.newGrade,
          reason: it.motivo + (it.motivoDetalle ? ' — ' + it.motivoDetalle : ''),
        });
      }
      await batch.commit();
      Toast.show(`Solicitud ${folio} creada con ${items.length} alumno(s).`, 'success');

      _printPDF({ folio, requestedAt, teacherName, asg, partialId, items });

      // Cerrar wizard y volver a la vista de solicitudes con la nueva ya visible
      state.wizardOpen = false;
      state.step = 1;
      state.selectedAsg = null;
      state.selectedPartial = null;
      state.cart = {};
      state.activeStudent = null;
      _renderNewBtn();
      _renderStep();
      await _loadMyRecent();
      // Scroll arriba
      setTimeout(() => {
        const recent = document.getElementById('cr-recent');
        if (recent) recent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (e) {
      console.error(e);
      Toast.show('Error al guardar: ' + e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PDF
  // ═══════════════════════════════════════════════════════════
  // Convierte un numero de calificacion (5-10) a palabra mayuscula.
  // Se usa en el PDF: "8 (OCHO)" — formato oficial mexicano que evita alteraciones.
  function _calToWord(n) {
    if (n === null || n === undefined || n === '') return '';
    const map = { 5: 'CINCO', 6: 'SEIS', 7: 'SIETE', 8: 'OCHO', 9: 'NUEVE', 10: 'DIEZ' };
    return map[Number(n)] || '';
  }

  function _printPDF({ folio, requestedAt, teacherName, asg, partialId, items }) {
    const fechaStr = requestedAt.toLocaleString('es-MX', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const partialName = K.PARCIALES.find(p => p.id === partialId)?.nombre || partialId;
    const parcialNum = K.PARCIALES.find(p => p.id === partialId)?.numero || 1;
    const parcMap = { 1: 'PRIMER', 2: 'SEGUNDO', 3: 'TERCER' };
    const parcText = parcMap[parcialNum] || partialName;
    const semMap = { 1: 'SEGUNDO SEMESTRE', 2: 'CUARTO SEMESTRE', 3: 'SEXTO SEMESTRE' };
    const semText = semMap[asg.grado] || '';
    const subdir = (typeof App.staffName === 'function' ? App.staffName('subdirector') : '') || 'OCTAVIO VAZQUEZ BARRETO';
    const directora = (typeof App.staffName === 'function' ? App.staffName('director') : '') || 'DRA. KARINA ILUSION LAGUERENNE CHIQUETE';
    // v8.40: usar officialName() — formato SEP "APELLIDOS NOMBRES" para
    // documentos oficiales. displayName() invertía mal cuando el input venía
    // ya en formato cotidiano (ej. "OLIVIA PEÑA RAMIREZ" salía "RAMIREZ OLIVIA PEÑA").
    const teacherDisplay = (Utils.officialName ? Utils.officialName(teacherName) : teacherName).toUpperCase();
    const groupNum = (asg.groupName || '').split('-')[1] || asg.groupName || '';

    const itemRows = items.map((it, i) => {
      const curNum = it.currentGrade !== null && it.currentGrade !== undefined ? it.currentGrade.toFixed(0) : 'S/C';
      const curWord = _calToWord(it.currentGrade);
      const newNum = it.newGrade;
      const newWord = _calToWord(it.newGrade);
      const curHtml = curNum === 'S/C'
        ? `<span style="color:#888;font-style:italic;">S/C</span>`
        : `<div style="font-size:14px;font-weight:800;">${curNum}</div><div style="font-size:9px;color:#555;font-weight:400;letter-spacing:0.5px;">(${curWord})</div>`;
      const newHtml = `<div style="font-size:14px;font-weight:800;color:#0369a1;">${newNum}</div><div style="font-size:9px;color:#0369a1;font-weight:400;letter-spacing:0.5px;">(${newWord})</div>`;
      const motivoFull = it.motivoDetalle ? `${it.motivo}<br><span style="font-size:10px;color:#555;">${S(it.motivoDetalle)}</span>` : it.motivo;
      return `<tr>
        <td style="text-align:center;width:30px;">${i + 1}</td>
        <td>${S(Utils.displayName ? Utils.displayName(it.studentName) : it.studentName)}</td>
        <td style="text-align:center;width:80px;">${curHtml}</td>
        <td style="text-align:center;width:80px;">${newHtml}</td>
        <td>${motivoFull}</td>
      </tr>`;
    }).join('');

    // v8.40: usar logos oficiales (Edomex banderín + escudo) para formato SEP oficial
    const logoHeader = typeof LOGO_HEADER_SRC !== 'undefined' ? LOGO_HEADER_SRC : '';
    const logoFooter = typeof LOGO_FOOTER_SRC !== 'undefined' ? LOGO_FOOTER_SRC : '';

    const html = `<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8">
      <title>Solicitud de Cambio de Calificación ${folio}</title>
      <style>
        @page { size: letter; margin: 0.8cm 1cm; }
        html, body { margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
        .official-header { text-align: center; margin-bottom: 8px; }
        .official-header img { max-width: 100%; height: auto; max-height: 70px; }
        .hdr { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin: 8px 0 6px; }
        .hdr h1 { margin: 0; color: #1e3a8a; font-size: 14px; letter-spacing: 0.8px; }
        .hdr .sub { margin: 2px 0; font-size: 10px; color: #444; }
        .hdr .folio { display: inline-block; margin-top: 3px; padding: 2px 10px; background: #1e3a8a; color: #fff; font-weight: 700; font-size: 11px; letter-spacing: 1px; }
        .official-footer { margin-top: 16px; text-align: center; }
        .official-footer img { max-width: 100%; height: auto; max-height: 60px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; margin-bottom: 6px; font-size: 10px; }
        .meta b { color: #1e3a8a; }
        table.dt { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
        table.dt th, table.dt td { border: 1px solid #555; padding: 4px 6px; vertical-align: top; }
        table.dt th { background: #1e3a8a; color: #fff; font-size: 10px; text-align: left; }
        table.dt td { font-size: 10px; }
        .legal { background: #fffbeb; border: 1px solid #d97706; padding: 5px 8px; font-size: 9px; color: #78350f; margin-bottom: 8px; line-height: 1.35; }
        .legal ol { margin: 3px 0 0 16px; padding: 0; }
        .firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-top: 18px; page-break-inside: avoid; }
        .firma { text-align: center; }
        .firma .firma-space { height: 50px; border-bottom: 1px solid #111; margin: 0 6px 4px; }
        .firma .role { font-size: 8px; color: #555; text-transform: uppercase; letter-spacing: 0.4px; }
        .firma .name { font-size: 10px; font-weight: 700; margin-top: 1px; line-height: 1.15; }
        .firma .cargo { font-size: 8px; color: #555; margin-top: 1px; }
        .footer-ts { margin-top: 8px; text-align: center; font-size: 8px; color: #888; border-top: 1px dashed #ccc; padding-top: 3px; }
      </style></head><body>
      ${logoHeader ? `<div class="official-header"><img src="${logoHeader}" alt="EPO 67"></div>` : ''}
      <div class="hdr">
        <h1>SOLICITUD DE CAMBIO DE CALIFICACIÓN</h1>
        <div class="sub">ESCUELA PREPARATORIA OFICIAL No. 67 — Ciclo Escolar 2025-2026</div>
        <div class="sub" style="font-size:9px;">DEPARTAMENTO DE SUBDIRECCIÓN ESCOLAR · DIRECCIÓN GENERAL DE EDUCACIÓN MEDIA SUPERIOR</div>
        <div class="folio">FOLIO: ${S(folio)}</div>
      </div>
      <div class="meta">
        <div><b>Profesor(a):</b> ${S(teacherDisplay)}</div>
        <div><b>Fecha y hora de solicitud:</b> ${S(fechaStr)}</div>
        <div><b>Materia:</b> ${S(K.getUACNombre(asg.subjectName))}</div>
        <div><b>Turno:</b> ${S(asg.turno)}</div>
        <div><b>Semestre:</b> ${S(semText)} — Grupo ${S(groupNum)}</div>
        <div><b>Parcial:</b> ${S(parcText)}</div>
      </div>
      <div class="legal">
        <strong>IMPORTANTE — PASOS PARA QUE SE APLIQUE EL CAMBIO:</strong>
        <ol style="margin:6px 0 0 18px;padding:0;">
          <li><strong>Profesor(a):</strong> firma autógrafamente este formato y llevalo a <strong>DIRECCIÓN ESCOLAR</strong> para que la directora lo firme autorizando.</li>
          <li><strong>Profesor(a):</strong> entrega el formato firmado en <strong>SUBDIRECCIÓN ESCOLAR</strong>.</li>
          <li><strong>Subdirección Escolar (Octavio):</strong> autoriza y aplica el cambio en el sistema unicamente durante los dias <strong>17 y 18 de mayo de 2026</strong>.</li>
        </ol>
        Sin las firmas fisicas de Dirección en este formato, ningun cambio procede.
        Conserva el folio <strong>${S(folio)}</strong> para dar seguimiento desde tu sesion.
      </div>
      <table class="dt">
        <thead><tr>
          <th style="width:30px;text-align:center;">#</th>
          <th>Nombre del alumno</th>
          <th style="width:80px;text-align:center;">
            Calificación actual<br>
            <span style="font-weight:400;font-size:9px;text-transform:none;letter-spacing:0;">(lo que dice)</span>
          </th>
          <th style="width:80px;text-align:center;">
            Calificación solicitada<br>
            <span style="font-weight:400;font-size:9px;text-transform:none;letter-spacing:0;">(lo que debe decir)</span>
          </th>
          <th>Motivo</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="firmas">
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Profesor(a) Solicitante</div>
          <div class="name">${S(teacherDisplay)}</div>
          <div class="cargo">Firma autógrafa</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Autoriza</div>
          <div class="name">${S(directora)}</div>
          <div class="cargo">Dirección Escolar</div>
        </div>
        <div class="firma">
          <div class="firma-space"></div>
          <div class="role">Recibe y aplica</div>
          <div class="name">${S(subdir)}</div>
          <div class="cargo">Subdirección Escolar</div>
        </div>
      </div>
      <div class="footer-ts">
        Documento generado automáticamente por el Sistema Escolar EPO 67.
        Folio ${S(folio)} · ${S(fechaStr)}
      </div>
      ${logoFooter ? `<div class="official-footer"><img src="${logoFooter}" alt="Edomex"></div>` : ''}
      <script>setTimeout(()=>window.print(),400)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      Toast.show('Tu navegador bloqueo la ventana de impresion. Permitelo y reintenta.', 'warning');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  // ═══════════════════════════════════════════════════════════
  // SOLICITUDES RECIENTES (debajo del wizard, siempre visibles)
  // ═══════════════════════════════════════════════════════════
  async function _loadMyRecent() {
    const root = document.getElementById('cr-recent');
    if (!root) return;
    try {
      const uid = firebase.auth().currentUser?.uid;
      if (!uid) {
        _renderMyRecent({});
        return;
      }
      // Buscar por uid del que pidio (incluye solicitudes hechas en impersonacion).
      // Tambien buscar por teacherId para cubrir casos donde el campo quedo asi.
      const teacherId = await Store.getTeacherDocId().catch(() => null);

      // Sin orderBy en la query — evita necesitar indice compuesto.
      // Ordenamos en JS despues de traer.
      const queries = [db.collection('gradeCorrections').where('requestedBy', '==', uid).limit(50).get()];
      if (teacherId && teacherId !== uid) {
        queries.push(db.collection('gradeCorrections').where('teacherId', '==', teacherId).limit(50).get());
      }

      const snaps = await Promise.all(queries.map(q => q.catch(e => {
        console.warn('Query gradeCorrections falló:', e.message);
        return { docs: [] };
      })));

      // Combinar, deduplicar y ordenar
      const map = {};
      snaps.forEach(s => s.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; }));

      // v8.40: FILTRO ESTRICTO DE PRIVACIDAD client-side.
      // Solo maestros (no admin/subdirector). Si el usuario es maestro,
      // SOLO debe ver correcciones donde:
      //   1) Él/ella las pidió (requestedBy == uid) — sus propias solicitudes
      //   2) Admin las pidió a SU nombre (teacherId == su teacherDocId Y
      //      requestedBy es admin)
      // CUALQUIER otra correccion NO se muestra aunque la query la haya traído
      // (las firestore.rules bloquean lectura indebida; este filtro es la
      // segunda red de seguridad por si hubiera un edge case).
      const role = App.currentUser?.role;
      const isAdminOrSub = (role === 'admin' || role === 'subdirector' || role === 'directivo' || role === 'orientador');
      let docs = Object.values(map);
      if (!isAdminOrSub) {
        // Es un maestro normal — filtrar estrictamente.
        docs = docs.filter(d => {
          if (d.requestedBy === uid) return true; // pidió él
          if (teacherId && d.teacherId === teacherId) return true; // a su nombre
          // Cualquier otra → ocultar (no debería llegar aquí por rules, pero seguro)
          console.warn('[privacy] Doc filtrado client-side, no era del maestro:', d.id);
          return false;
        });
      }

      docs.sort((a, b) => {
        const ta = a.requestedAt?.toMillis ? a.requestedAt.toMillis() : 0;
        const tb = b.requestedAt?.toMillis ? b.requestedAt.toMillis() : 0;
        return tb - ta;
      });

      const byFolio = {};
      docs.forEach(d => {
        if (!byFolio[d.folio]) byFolio[d.folio] = [];
        byFolio[d.folio].push(d);
      });
      console.log('[correction-request] cargadas', docs.length, 'solicitudes,', Object.keys(byFolio).length, 'folios');
      _renderMyRecent(byFolio);
    } catch (e) {
      console.error('Error cargando solicitudes recientes:', e);
      // Mostrar error visible al maestro en lugar de quedarse en silencio
      root.innerHTML = `<div class="card" style="background:#fee2e2;border-left:4px solid #dc2626;">
        <strong style="color:#991b1b;">No se pudieron cargar tus solicitudes:</strong>
        <div style="font-size:12px;color:#7f1d1d;margin-top:4px;">${Utils.sanitize(e.message || String(e))}</div>
        <div style="font-size:12px;color:#7f1d1d;margin-top:6px;">
          Intenta recargar la página. Si persiste, contacta a Soporte: WhatsApp 55 1078 2357.
        </div>
      </div>`;
    }
  }

  function _renderMyRecent(byFolio) {
    const root = document.getElementById('cr-recent');
    if (!root) return;
    const folios = Object.entries(byFolio);
    if (!folios.length) {
      root.innerHTML = `
        <div class="card" style="background:#f8fafc;text-align:center;padding:24px;color:#64748b;">
          <span class="material-icons-round" style="font-size:36px;color:#cbd5e1;">inbox</span>
          <div style="margin-top:6px;font-size:14px;">
            <strong>Aun no tienes solicitudes de cambio de calificación.</strong>
          </div>
          <div style="font-size:12px;margin-top:4px;">Cuando crees una nueva, aparecera aquí con su estado.</div>
        </div>`;
      return;
    }

    // Cache de byFolio para acciones (re-imprimir, anular, expandir)
    state.myByFolio = byFolio;
    state.expandedFolios = state.expandedFolios || new Set();

    const stateMeta = {
      pending:    { label: 'PENDIENTE',  color: '#d97706', bg: '#fef3c7', icon: 'schedule', desc: 'Lleva el formato firmado por la directora a Subdirección. El cambio se aplica entre 17 y 18 de mayo.' },
      applied:    { label: 'APLICADA',   color: '#6366f1', bg: '#e0e7ff', icon: 'check_circle', desc: 'Cambio aplicado. Tu calificación ya esta corregida en el sistema.' },
      rejected:   { label: 'RECHAZADA',  color: '#dc2626', bg: '#fee2e2', icon: 'cancel', desc: 'Esta solicitud fue rechazada.' },
      cancelled:  { label: 'ANULADA',    color: '#64748b', bg: '#f1f5f9', icon: 'block', desc: 'Anulada por ti.' },
    };

    const fmt = (ts) => ts?.toDate
      ? ts.toDate().toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';

    const cards = folios.map(([folio, docs]) => {
      const first = docs[0];
      const status = first.status || 'pending';
      const m = stateMeta[status] || stateMeta.pending;
      const isExpanded = state.expandedFolios.has(folio);

      // Timeline simplificado: Creada → Aplicada (en un solo paso)
      const isDone = (st) => {
        if (st === 'pending') return true; // siempre creada
        if (st === 'applied') return status === 'applied';
        return false;
      };

      const tlSteps = [
        { key: 'pending',  label: 'Solicitud creada por ti',          ts: first.requestedAt, who: null },
        { key: 'applied',  label: 'Autorizada y aplicada por Subdirección', ts: first.appliedAt, who: first.appliedByName },
      ];

      const timelineHtml = tlSteps.map(s => {
        const done = isDone(s.key) && (s.key === 'pending' || s.ts);
        const icon = done ? 'check_circle' : 'radio_button_unchecked';
        const color = done ? '#16a34a' : '#cbd5e1';
        const tsStr = done && s.ts ? fmt(s.ts) : '';
        const whoStr = done && s.who ? ` por ${S(s.who)}` : '';
        return `<div style="display:flex;gap:8px;align-items:center;font-size:12px;color:${done ? '#1e293b' : '#94a3b8'};padding:3px 0;">
          <span class="material-icons-round" style="color:${color};font-size:16px;">${icon}</span>
          <span style="flex:1;"><strong>${S(s.label)}</strong>${tsStr ? ' · ' + S(tsStr) + whoStr : (done ? '' : '<span style="color:#94a3b8;font-style:italic;"> — pendiente</span>')}</span>
        </div>`;
      }).join('');

      // Detalle de alumnos (expandible)
      const detailHtml = isExpanded ? `
        <table class="table-light" style="font-size:12px;width:100%;margin-top:8px;">
          <thead><tr>
            <th>Alumno</th>
            <th style="text-align:center;width:80px;">Cal. actual</th>
            <th style="text-align:center;width:80px;">Cal. solicitada</th>
            <th>Motivo</th>
          </tr></thead>
          <tbody>
            ${docs.map(d => `<tr>
              <td>${S(Utils.displayName ? Utils.displayName(d.studentName) : d.studentName)}</td>
              <td style="text-align:center;font-weight:700;">${d.currentGrade !== null && d.currentGrade !== undefined ? d.currentGrade : 'S/C'}</td>
              <td style="text-align:center;font-weight:700;color:#0369a1;">${d.newGrade}</td>
              <td style="font-size:11px;">${S(d.reason)}</td>
            </tr>`).join('')}
          </tbody>
        </table>` : '';

      // Banner de rechazo si aplica
      const rejBanner = status === 'rejected' && first.rejectedReason ? `
        <div style="background:#fee2e2;border-left:3px solid #dc2626;padding:8px 12px;margin-top:8px;font-size:12px;color:#991b1b;">
          <strong>Motivo de rechazo:</strong> ${S(first.rejectedReason)}
          ${first.rejectedByName ? ` — por ${S(first.rejectedByName)}` : ''}
        </div>` : '';

      // Acciones disponibles
      const actions = [];
      // Re-imprimir disponible siempre que no este cancelada/rechazada (se mantiene como respaldo)
      if (status !== 'cancelled') {
        actions.push(`<button class="btn btn-sm btn-outline" data-action="cr-reprint" data-folio="${S(folio)}">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">print</span>
          Re-imprimir PDF
        </button>`);
      }
      // Anular solo si es del propio maestro y esta pending
      if (status === 'pending') {
        actions.push(`<button class="btn btn-sm btn-outline btn-danger-soft" data-action="cr-cancel" data-folio="${S(folio)}" style="color:#dc2626;border-color:#fecaca;">
          <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">close</span>
          Anular
        </button>`);
      }
      // Toggle expandir/colapsar
      actions.push(`<button class="btn btn-sm btn-outline" data-action="cr-toggle-expand" data-folio="${S(folio)}">
        <span class="material-icons-round" style="font-size:14px;vertical-align:middle;">${isExpanded ? 'expand_less' : 'expand_more'}</span>
        ${isExpanded ? 'Ocultar' : 'Ver detalle'}
      </button>`);

      return `
        <div class="card" style="margin-bottom:10px;border-left:4px solid ${m.color};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div style="flex:1;min-width:240px;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <strong style="font-size:14px;color:${m.color};">${S(folio)}</strong>
                <span style="background:${m.bg};color:${m.color};padding:2px 10px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:0.5px;">
                  <span class="material-icons-round" style="font-size:12px;vertical-align:middle;">${m.icon}</span>
                  ${S(m.label)}
                </span>
              </div>
              <div style="font-size:12px;color:#475569;margin-top:4px;">
                ${S(first.groupName)} · ${S(K.getUACNombre(first.subjectName))} · ${S(K.PARCIALES.find(p => p.id === first.partial)?.nombre || first.partial)}
                · ${docs.length} alumno(s)
              </div>
              <div style="font-size:11px;color:${m.color};margin-top:4px;font-style:italic;">${S(m.desc)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${actions.join('')}</div>
          </div>

          <div style="background:#f8fafc;border-radius:6px;padding:8px 12px;margin-top:8px;">
            ${timelineHtml}
          </div>

          ${rejBanner}
          ${detailHtml}
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="card">
        <h3 class="section-title">Mis solicitudes recientes</h3>
        <p class="text-muted" style="font-size:13px;margin-top:0;">
          Aquí ves el estado de cada una de tus solicitudes. Toca "Ver detalle" para ver los alumnos y motivos.
        </p>
        ${cards}
      </div>`;

    // Eventos
    root.querySelectorAll('[data-action="cr-toggle-expand"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const folio = btn.dataset.folio;
        if (state.expandedFolios.has(folio)) state.expandedFolios.delete(folio);
        else state.expandedFolios.add(folio);
        _renderMyRecent(state.myByFolio);
      });
    });
    root.querySelectorAll('[data-action="cr-reprint"]').forEach(btn => {
      btn.addEventListener('click', () => _reprintFolio(btn.dataset.folio));
    });
    root.querySelectorAll('[data-action="cr-cancel"]').forEach(btn => {
      btn.addEventListener('click', () => _cancelFolio(btn.dataset.folio));
    });
  }

  // Re-imprimir un folio existente (recupera datos del cache, mismo folio)
  function _reprintFolio(folio) {
    const docs = state.myByFolio?.[folio];
    if (!docs?.length) return;
    const first = docs[0];
    const items = docs.map(d => ({
      studentId: d.studentId,
      studentName: d.studentName,
      currentGrade: d.currentGrade,
      newGrade: d.newGrade,
      motivo: (d.reason || '').split(' — ')[0],
      motivoDetalle: (d.reason || '').split(' — ').slice(1).join(' — '),
    }));
    const reqAt = first.requestedAt?.toDate ? first.requestedAt.toDate() : new Date();
    const fakeAsg = {
      groupName: first.groupName, subjectName: first.subjectName,
      groupId: first.groupId, subjectId: first.subjectId,
      grado: first.grado, turno: first.turno,
    };
    _printPDF({
      folio, requestedAt: reqAt,
      teacherName: first.requestedByName,
      asg: fakeAsg, partialId: first.partial, items
    });
  }

  // Anular solicitud (solo el maestro autor, solo en estado pending)
  async function _cancelFolio(folio) {
    const docs = state.myByFolio?.[folio];
    if (!docs?.length) return;
    if (!confirm(`¿Anular la solicitud ${folio}?\n\nEsta accion solo es posible mientras la solicitud esta pendiente. Después no se podra revertir.`)) return;

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const uid = firebase.auth().currentUser.uid;
    let count = 0;
    for (const d of docs) {
      if (d.status !== 'pending') continue;
      try {
        await db.collection('gradeCorrections').doc(d.id).update({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: uid,
        });
        count++;
      } catch (e) {
        console.error(e);
        Toast.show('Error al anular: ' + e.message, 'error');
        return;
      }
    }
    Toast.show(`Solicitud ${folio} anulada (${count} alumnos).`, 'info');
    _loadMyRecent();
  }

  return { render };
})();

Router.modules['correction-request'] = () => CorrectionRequestModule.render();
