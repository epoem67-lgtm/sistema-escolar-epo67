/**
 * TOUR DE BIENVENIDA — primera vez que entra un usuario.
 *
 * v3 (v5.91): Cada paso NAVEGA al módulo real (no solo señala el sidebar).
 * El maestro VE la pantalla del módulo mientras lee la explicación.
 * El tooltip se queda fijo en la parte inferior, no se mueve, no se sale.
 *
 * Por qué cambió:
 *   - v1 trataba de pegar el tooltip al elemento target con coordenadas
 *     calculadas dinámicamente — se rompía cuando el sidebar tenía scroll.
 *   - v2 ponía el tooltip centrado modal — no se rompía pero NO recorría
 *     el sistema, el maestro solo veía el sidebar señalado.
 *   - v3 (esta): cada paso ejecuta Router.navigate(modulo). El maestro
 *     ve la pantalla REAL del módulo durante 1-2 segundos, lee el tooltip,
 *     y avanza. Es como un tour guiado donde el guía te lleva físicamente
 *     a cada lugar.
 *
 * Disparador: si user.tourCompleted !== true en Firestore (o localStorage).
 * Al terminar: marca tourCompleted=true en ambos.
 */

(function () {
  // Cada paso opcionalmente navega a un módulo (navigateTo: 'my-grades' por ejemplo).
  const TOUR_STEPS = {
    maestro: [
      {
        title: '👋 ¡Hola! Bienvenido(a) al Sistema Escolar EPO 67',
        body: 'En 2 minutos te recorro las pantallas más importantes para que sepas dónde está cada cosa. Te voy a llevar pantalla por pantalla — solo lee y dale "Siguiente".',
        navigateTo: 'dashboard',
      },
      {
        title: '📊 Tu Inicio (Dashboard)',
        body: 'Esta es tu pantalla principal. Aquí ves cuántos alumnos tienes en total, tu promedio general, cuántos aprobaron y cuántos reprobaron. También una tarjeta por cada grupo+materia que das.',
        navigateTo: 'dashboard',
      },
      {
        title: '✏️ Capturar Calificaciones — TU TAREA PRINCIPAL',
        body: 'Esta es la pantalla donde vas a pasar la mayor parte del tiempo. Eliges el grupo+materia (las pestañas de arriba), eliges el parcial, y escribes los RUBROS de cada alumno. El sistema calcula la SUMA y la CALIFICACIÓN automáticamente.',
        navigateTo: 'my-grades',
      },
      {
        title: '📋 Mis Listas — Imprime para el salón',
        body: 'Aquí imprimes las listas oficiales de tus grupos. Hay dos formatos: con 15 columnas en blanco para anotar lo que quieras, o con columnas de Evaluación Continua, Transversal, Examen Parcial, Punto Extra y Faltas para llevar control en papel antes de capturar. Se ajustan a una hoja tamaño carta automáticamente.',
        navigateTo: 'my-lists',
      },
      {
        title: '✏️ Cambios de Calificación',
        body: 'Si ya cerró la captura y te das cuenta que hubo un error, aquí creas una SOLICITUD FORMAL. Eliges al alumno, escribes la calificación nueva (NUNCA puede ser menor que la actual), el motivo, y el sistema genera un PDF con folio para que lo lleves a Dirección. Octavio aplica el cambio entre 17 y 18 de mayo.',
        navigateTo: 'correction-request',
      },
      {
        title: '👁️ Consultar Calificaciones',
        body: 'Modo SOLO LECTURA. Útil cuando un papá te pregunta o quieres revisar antes de imprimir, sin riesgo de tocar nada.',
        navigateTo: 'grades-query',
      },
      {
        title: '📑 Concentrado F1',
        body: 'Al FINAL del ciclo, cuando estén capturados los 3 parciales, este es el documento oficial que entregas a Subdirección. NO lo imprimas antes de tener los 3 parciales completos — no es válido si falta uno.',
        navigateTo: 'my-f1',
      },
      {
        title: '🔍 Buscador rápido + Preguntas',
        body: 'Arriba del menú está el botón "Buscar..." (también ⌘K / Ctrl+K). Sirve para 2 cosas: encontrar alumnos/módulos rápido, Y como buscador estilo Google PERO de tu sistema — escribe "como capturo" o "que pasa si reprueba" y te explica.',
        navigateTo: null,
      },
      {
        title: '🆘 ¿Te atoras? WhatsApp directo',
        body: 'Mira la esquina inferior derecha: ese círculo verde es ayuda al instante con Olivia. Tócalo cuando NO sepas qué hacer. SIEMPRE está disponible.',
        navigateTo: null,
      },
      {
        title: '📅 Calendario crítico',
        body: '<strong>Captura:</strong> 11 al 14 de mayo. <strong>Entrega listas firmadas:</strong> 14 de mayo. <strong>Correcciones:</strong> solo 17 y 18 de mayo (con solicitud formal). NO esperes al último día — captura desde el primer día.',
        navigateTo: null,
      },
      {
        title: '✅ ¡Listo! Estás preparado(a)',
        body: 'Las calificaciones son OFICIALES sí y solo sí están guardadas en el sistema. Si lo escribiste solo en papel, NO cuenta. Si tienes dudas: WhatsApp o el buscador (⌘K) y escribe tu pregunta. Siempre puedes ver este tutorial otra vez con el botón verde abajo del menú.',
        navigateTo: 'dashboard',
      },
    ],
    orientador: [
      {
        title: '👋 ¡Bienvenido(a)!',
        body: 'Como orientador(a) tienes acceso a indicadores y reportes de los grupos de tu turno. Te muestro lo más importante.',
        navigateTo: 'dashboard',
      },
      {
        title: '📊 Indicadores',
        body: 'Estadísticas de tu turno completo. Promedio por grupo, % aprobados, faltas, asistencia.',
        navigateTo: 'indicadores',
      },
      {
        title: '⚠️ Alumnos en Riesgo',
        body: 'Aquí están los alumnos con calificaciones bajas, faltas excesivas o problemas. Es tu herramienta principal para canalizar.',
        navigateTo: 'at-risk',
      },
      {
        title: '🔍 Buscador Global',
        body: '⌘K (Mac) / Ctrl+K (Windows) o el botón "Buscar..." abre el buscador de alumnos por nombre o folio rápido. También responde preguntas del sistema.',
        navigateTo: null,
      },
      {
        title: '🆘 Soporte por WhatsApp',
        body: 'Botón verde flotante en la esquina = ayuda directa de Olivia.',
        navigateTo: null,
      },
    ],
    admin: [
      {
        title: '👋 ¡Bienvenida, administradora!',
        body: 'Tienes acceso completo. Te recorro lo esencial.',
        navigateTo: 'dashboard',
      },
      {
        title: '👥 Gestión de Usuarios',
        body: 'Aquí ves "como" cualquier usuario, reseteas contraseñas con WhatsApp pre-armado, generas nuevos usuarios con contraseña automática, y forzás cambios de contraseña.',
        navigateTo: 'users-mgmt',
      },
      {
        title: '🔒 Cierre de Parciales',
        body: 'Aquí abres/cierras los parciales y programas las fechas críticas del ciclo (cierre de captura, entrega de listas, ventana de correcciones). Las fechas aparecen automáticamente en los banners de los maestros.',
        navigateTo: 'partial-close',
      },
      {
        title: '📊 Monitor de Captura',
        body: 'Vista en tiempo real del avance de captura por maestro. Para llamarlos cuando va lento.',
        navigateTo: 'captura-progress',
      },
      {
        title: '🔍 Buscador Global ⌘K',
        body: 'Busca cualquier cosa: alumno, maestro, grupo, materia, módulo. También responde preguntas frecuentes.',
        navigateTo: null,
      },
    ],
  };

  let _currentStep = 0;
  let _steps = [];
  let _escHandler = null;

  function _isFirstTime() {
    try {
      const local = localStorage.getItem('epo67_tour_done');
      if (local === 'true') return false;
      if (App?.currentUser?.tourCompleted === true) return false;
      return true;
    } catch (_) {
      return true;
    }
  }

  function _markDone() {
    try { localStorage.setItem('epo67_tour_done', 'true'); } catch (_) {}
    try {
      const uid = firebase.auth().currentUser?.uid;
      if (uid) {
        firebase.firestore().collection('users').doc(uid).update({
          tourCompleted: true,
          tourCompletedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    } catch (_) {}
  }

  function _stepsForRole() {
    const role = App?.currentUser?.role;
    if (role === 'admin' || role === 'subdirector' || role === 'secretario_admin' || role === 'secretario_escolar') return TOUR_STEPS.admin;
    if (role === 'orientador' || role === 'orientador_docente' || role === 'directivo') return TOUR_STEPS.orientador;
    return TOUR_STEPS.maestro;
  }

  // Resaltar el módulo activo en el sidebar (efecto visual)
  function _flashSidebarItem(moduleName) {
    document.querySelectorAll('.tour-flash').forEach(e => e.classList.remove('tour-flash'));
    if (!moduleName) return;
    const item = document.querySelector(`[data-module="${moduleName}"]`);
    if (item) {
      item.classList.add('tour-flash');
      try {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) { /* ignorar */ }
    }
  }

  function _renderStep() {
    const step = _steps[_currentStep];
    if (!step) { _close(); return; }

    // Asegurar que existe el CSS (una sola vez)
    if (!document.getElementById('tourStyles')) {
      const style = document.createElement('style');
      style.id = 'tourStyles';
      style.textContent = `
        .tour-flash {
          background: rgba(37,211,102,0.18) !important;
          box-shadow: inset 4px 0 0 #25d366 !important;
          animation: tourFlashPulse 1.5s ease-in-out infinite;
        }
        @keyframes tourFlashPulse {
          0%,100% { background: rgba(37,211,102,0.18) !important; }
          50%     { background: rgba(37,211,102,0.32) !important; }
        }
        #tourTooltip {
          animation: tourSlideUp 0.3s ease-out;
        }
        @keyframes tourSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    // Navegar al módulo si el paso lo pide
    if (step.navigateTo && Router && Router.modules[step.navigateTo]) {
      try {
        // Solo navegar si NO estamos ya en ese módulo (evita re-renders innecesarios)
        if (Router.currentModule !== step.navigateTo) {
          Router.navigate(step.navigateTo);
        }
      } catch (_) { /* ignorar errores de navegación */ }
    }

    // Resaltar el item correspondiente del sidebar
    _flashSidebarItem(step.navigateTo);

    // Crear/actualizar tooltip persistente abajo de la pantalla
    let tooltip = document.getElementById('tourTooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'tourTooltip';
      tooltip.style.cssText = `
        position:fixed;
        bottom:24px;
        right:24px;
        max-width:440px;
        width:calc(100vw - 48px);
        background:#fff;
        border-radius:14px;
        box-shadow:0 20px 60px rgba(0,0,0,0.35),0 0 0 1px rgba(0,0,0,0.05);
        z-index:9998;
        overflow:hidden;
      `;
      document.body.appendChild(tooltip);
    }

    const total = _steps.length;
    const isLast = _currentStep === total - 1;
    const isFirst = _currentStep === 0;

    // Indicadores de progreso
    const progressPct = ((_currentStep + 1) / total) * 100;

    tooltip.innerHTML = `
      <div style="height:4px;background:#e2e8f0;">
        <div style="height:100%;width:${progressPct}%;background:linear-gradient(90deg,#3182ce,#25d366);transition:width 0.3s;"></div>
      </div>
      <div style="padding:18px 22px 16px;position:relative;">
        <button id="tourClose" aria-label="Cerrar tutorial" style="
          position:absolute;top:10px;right:12px;
          background:#f1f5f9;border:none;color:#475569;
          width:30px;height:30px;border-radius:50%;
          font-size:20px;line-height:1;cursor:pointer;
          font-weight:700;
          display:flex;align-items:center;justify-content:center;">×</button>

        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:6px;">
          <span style="background:#3182ce;color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;">Paso ${_currentStep + 1} / ${total}</span>
          ${step.navigateTo ? `<span style="color:#25d366;">● Estás viendo: ${step.navigateTo}</span>` : ''}
        </div>
        <h3 style="margin:0 0 8px;font-size:17px;color:#1e293b;line-height:1.3;font-weight:700;padding-right:30px;">${step.title}</h3>
        <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55;">${step.body}</p>

        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
          <button id="tourSkip" style="background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer;padding:6px 4px;text-decoration:underline;">
            Saltar tutorial
          </button>
          <div style="display:flex;gap:6px;">
            ${!isFirst ? `<button id="tourPrev" class="btn btn-outline" style="padding:6px 14px;font-size:13px;">← Atrás</button>` : ''}
            ${!isLast
              ? `<button id="tourNext" class="btn btn-primary" style="padding:6px 16px;font-weight:700;font-size:13px;">Siguiente →</button>`
              : `<button id="tourFinish" class="btn btn-primary" style="padding:6px 16px;background:#16a34a;border-color:#16a34a;font-weight:700;font-size:13px;">¡Listo! 🎉</button>`
            }
          </div>
        </div>
      </div>`;

    // Bind buttons
    setTimeout(() => {
      document.getElementById('tourPrev')?.addEventListener('click', _prev);
      document.getElementById('tourNext')?.addEventListener('click', _next);
      document.getElementById('tourSkip')?.addEventListener('click', _skip);
      document.getElementById('tourFinish')?.addEventListener('click', _finish);
      document.getElementById('tourClose')?.addEventListener('click', _close);
    }, 30);
  }

  function _next() {
    if (_currentStep < _steps.length - 1) {
      _currentStep++;
      _renderStep();
    } else {
      _finish();
    }
  }
  function _prev() {
    if (_currentStep > 0) { _currentStep--; _renderStep(); }
  }
  function _skip() {
    _close();
  }
  function _finish() { _close(); }
  function _close() {
    _markDone();
    document.getElementById('tourTooltip')?.remove();
    document.querySelectorAll('.tour-flash').forEach(e => e.classList.remove('tour-flash'));
    if (_escHandler) {
      document.removeEventListener('keydown', _escHandler);
      _escHandler = null;
    }
  }

  function start() {
    _steps = _stepsForRole();
    _currentStep = 0;
    if (_steps.length === 0) return;

    // Permite cerrar con Esc / navegar con flechas
    _escHandler = (e) => {
      // Solo si el tour está activo
      if (!document.getElementById('tourTooltip')) return;
      if (e.key === 'Escape') _close();
      else if (e.key === 'ArrowRight') {
        // Solo si no estamos en un input
        if (document.activeElement?.tagName !== 'INPUT' &&
            document.activeElement?.tagName !== 'TEXTAREA') {
          _next();
        }
      }
      else if (e.key === 'ArrowLeft') {
        if (document.activeElement?.tagName !== 'INPUT' &&
            document.activeElement?.tagName !== 'TEXTAREA') {
          _prev();
        }
      }
    };
    document.addEventListener('keydown', _escHandler);

    _renderStep();
  }

  // Auto-iniciar tras login si es primera vez
  function maybeAutoStart() {
    if (!App?.currentUser) return;
    if (!_isFirstTime()) return;
    setTimeout(() => start(), 800);
  }

  window.OnboardingTour = { start, maybeAutoStart };
})();
