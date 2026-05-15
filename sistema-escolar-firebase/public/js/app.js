// ═══════════════════════════════════════════════════════════════
// SISTEMA ESCOLAR - APP.JS
// Controlador principal de la aplicación
// Requiere: firebase-config.js cargado previamente
// ═══════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────
// APP - Controlador Principal
// ───────────────────────────────────────────────────────────────
const App = {
  currentUser: null,
  schoolConfig: null,

  /**
   * Inicializa la aplicación
   * Se ejecuta cuando el DOM está completamente cargado
   */
  async init() {
    console.log('📱 Inicializando Sistema Escolar...');

    // Watchdog: si en 10s no se ha ocultado el splash, mostrar error de carga
    const splashWatchdog = setTimeout(() => {
      const splash = document.getElementById('splashScreen');
      if (splash && splash.style.display !== 'none') {
        const card = splash.querySelector('.login-card');
        if (card) {
          card.style.background = '#fff';
          card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          card.innerHTML = `
            <div style="text-align:center;padding:20px;">
              <span class="material-icons-round" style="font-size:48px;color:#dc2626;">error</span>
              <h2 style="margin:14px 0 8px;color:#1a202c;">No pudimos conectar</h2>
              <p style="color:#666;font-size:14px;line-height:1.5;margin-bottom:18px;">
                El sistema lleva más de 10 segundos sin responder. Esto puede deberse a:<br>
                • Conexión lenta o intermitente<br>
                • Caché del navegador con datos viejos<br>
                • Bloqueo de Firebase por firewall
              </p>
              <button onclick="location.reload(true)" class="btn btn-primary btn-block" style="margin-bottom:8px;">
                🔄 Recargar
              </button>
              <button onclick="(async()=>{try{const reg=await navigator.serviceWorker.getRegistration();if(reg)await reg.unregister();const cs=await caches.keys();for(const k of cs)await caches.delete(k);location.reload(true);}catch(e){alert('Error: '+e.message);}})()" class="btn btn-outline btn-block">
                🧹 Limpiar caché y recargar
              </button>
              <p style="font-size:11px;color:#999;margin-top:12px;">
                Si persiste, abre ventana incógnito (Cmd+Shift+N) y prueba ahí.
              </p>
            </div>`;
        }
      }
    }, 10000);

    try {
      // Registrar módulos
      this.registerModules();

      // Setup global del toggle de visibilidad de passwords
      this._setupGlobalPasswordToggle();

      // Persistencia LOCAL — la sesión sobrevive al refresco de página
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      // Configurar escuchador de autenticación
      Auth.setupAuthListener();

      // Cargar configuración escolar
      await this.loadSchoolConfig();

      clearTimeout(splashWatchdog);
      console.log('✅ Sistema Escolar inicializado correctamente');
    } catch (error) {
      clearTimeout(splashWatchdog);
      console.error('❌ Error inicializando la aplicación:', error);
      // Mostrar error visible en la pantalla de splash
      const splash = document.getElementById('splashScreen');
      if (splash) {
        const card = splash.querySelector('.login-card');
        if (card) {
          card.style.background = '#fff';
          card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          card.innerHTML = `
            <div style="text-align:center;padding:20px;">
              <span class="material-icons-round" style="font-size:48px;color:#dc2626;">error</span>
              <h2 style="margin:14px 0 8px;color:#1a202c;">Error al iniciar</h2>
              <p style="color:#666;font-size:13px;margin-bottom:14px;font-family:monospace;background:#f8fafc;padding:8px;border-radius:4px;">
                ${(error && error.message) || 'Error desconocido'}
              </p>
              <button onclick="location.reload(true)" class="btn btn-primary btn-block">🔄 Recargar</button>
            </div>`;
        }
      }
    }
  },

  /**
   * Carga la configuración de la escuela desde Firestore
   */
  async loadSchoolConfig() {
    try {
      const configDoc = await DB.doc('config', 'school').get();

      if (configDoc.exists) {
        this.schoolConfig = configDoc.data();

        // Aplicar configuración a la UI
        const schoolNameEl = document.getElementById('schoolName');
        const schoolLogoEl = document.getElementById('schoolLogo');

        if (schoolNameEl && (this.schoolConfig.nombre || this.schoolConfig.nombreCorto)) {
          schoolNameEl.textContent = this.schoolConfig.nombreCorto || this.schoolConfig.nombre;
        }

        if (schoolLogoEl && this.schoolConfig.logo) {
          schoolLogoEl.src = this.schoolConfig.logo;
          schoolLogoEl.style.display = 'block';
        }

        console.log('✅ Configuración escolar cargada:', this.schoolConfig);
      } else {
        console.warn('⚠️ Documento de configuración no encontrado');
        // Usar valores por defecto
        this.schoolConfig = {
          nombre: 'Sistema Escolar',
          nombreCorto: 'EPO 67',
          logo: null
        };
      }
    } catch (error) {
      console.error('❌ Error cargando configuración:', error);
      this.schoolConfig = { nombre: 'Sistema Escolar', nombreCorto: 'EPO 67', logo: null };
    }
  },

  /**
   * Aplica visibilidad a elementos nav según el rol del usuario
   * @param {string} role - Rol del usuario (admin, maestro, orientador)
   */
  applyRoleVisibility(role) {
    // Ocultar todos los elementos con restricción de rol
    const roleRestrictedElements = document.querySelectorAll('[data-roles]');
    roleRestrictedElements.forEach(el => {
      el.style.display = 'none';
    });

    // Roles efectivos = el rol propio + roles heredados (ver K.ROLE_INHERITS)
    const inherited = (K.ROLE_INHERITS && K.ROLE_INHERITS[role]) || [];
    const effectiveRoles = [role, ...inherited];

    for (const r of effectiveRoles) {
      const visibleElements = document.querySelectorAll(`[data-roles*="${r}"]`);
      visibleElements.forEach(el => { el.style.display = ''; });
    }

    // Aplicar clase al body para CSS condicional (ej. ocultar botones de write
    // para directivos en módulos donde solo deben leer)
    document.body.classList.remove('role-admin','role-directivo','role-subdirector','role-secretario_escolar','role-secretario_admin','role-orientador','role-orientador_docente','role-maestro','role-consulta');
    document.body.classList.add('role-' + role);

    console.log(`👤 Visibilidad aplicada para rol: ${role} (efectivos: ${effectiveRoles.join(',')})`);

    // Cargar contadores de notificaciones (badges en el menu)
    try { App._loadNavBadges?.(); } catch (_) {}
  },

  // ─── BADGES DE NOTIFICACIÓN EN EL MENÚ ───────────────────────
  // Cuenta cosas pendientes para el usuario actual y agrega un badge rojo
  // al lado del item del menú correspondiente.
  async _loadNavBadges() {
    try {
      const role = App.currentUser?.role;
      const fs = firebase.firestore();
      const uid = firebase.auth().currentUser?.uid;
      if (!uid) return;

      // ─── Para maestros: solicitudes propias con cambio de status ───
      if (role === 'maestro' || role === 'orientador_docente' || role === 'admin' || role === 'subdirector') {
        const lastSeen = parseInt(localStorage.getItem('epo67_lastSeenCorrections') || '0', 10);
        try {
          const snap = await fs.collection('gradeCorrections')
            .where('requestedBy', '==', uid)
            .limit(50).get();
          // Contar las que tuvieron cambio de status desde la última visita
          let unseen = 0;
          snap.docs.forEach(d => {
            const data = d.data();
            const ts = data.appliedAt || data.rejectedAt || data.cancelledAt;
            if (ts && ts.toMillis && ts.toMillis() > lastSeen) unseen++;
          });
          App._setNavBadge('correction-request', unseen);
        } catch (_) { /* no-op */ }
      }

      // ─── Para subdirector: solicitudes pendientes de aplicar ───
      if (role === 'subdirector' || role === 'admin') {
        try {
          const snap = await fs.collection('gradeCorrections')
            .where('status', '==', 'pending').limit(60).get();
          const folios = new Set();
          snap.docs.forEach(d => folios.add(d.data().folio));
          App._setNavBadge('grade-corrections', folios.size);
        } catch (_) { /* no-op */ }
      }
    } catch (e) { console.warn('Badges:', e.message); }
  },

  _setNavBadge(moduleId, count) {
    const el = document.querySelector(`[data-module="${moduleId}"]`);
    if (!el) return;
    let badge = el.querySelector('.nav-badge');
    if (!count || count <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.style.cssText = 'background:#dc2626;color:#fff;border-radius:10px;font-size:10px;padding:2px 7px;font-weight:700;margin-left:auto;min-width:18px;text-align:center;';
      el.appendChild(badge);
    }
    badge.textContent = count > 9 ? '9+' : String(count);
  },

  /**
   * ¿El usuario actual puede actuar como targetRole? Considera el rol propio y
   * los roles heredados via K.ROLE_INHERITS. Útil para verificaciones en módulos
   * que antes hacían `App.currentUser.role === 'maestro'`.
   */
  canActAs(targetRole) {
    const role = this.currentUser?.role;
    if (!role) return false;
    if (role === targetRole) return true;
    const inherited = (K.ROLE_INHERITS && K.ROLE_INHERITS[role]) || [];
    return inherited.includes(targetRole);
  },

  /**
   * Devuelve el nombre completo formateado del personal directivo según
   * su rol ('director', 'subdirector', 'secretario'). Lee de
   * `App.schoolConfig.staff[role]` que tiene { titulo, nombre, cargo }.
   * Retorna string como "DRA. KARINA LAGUERENNE CHIQUETE" o '' si no existe.
   * Las plantillas de boletas, concentrados y correcciones llaman aquí
   * en lugar de hardcodear nombres.
   */
  staffName(role) {
    const s = this.schoolConfig?.staff?.[role];
    if (!s || !s.nombre) return '';
    return ((s.titulo || '') + ' ' + s.nombre).trim();
  },

  /** Cargo oficial del personal directivo (DIRECTORA ESCOLAR, etc.). */
  staffCargo(role) {
    return this.schoolConfig?.staff?.[role]?.cargo || '';
  },

  /**
   * Registra los módulos disponibles
   */
  registerModules() {
    // Los modulos se auto-registran en sus archivos (incluido dashboard.js)
    if (!Router.modules) Router.modules = {};
    // Fallback para modulos que no se auto-registraron
    const fallbacks = {
      'school-config': 'Configuración de Escuela',
      teachers: 'Docentes y Grupos',
      students: 'Alumnos',
      enrollment: 'Inscripciones',
      grades: 'Captura de Calificaciones',
      'my-grades': 'Mis Calificaciones',
      'my-lists': 'Mis Listas',
      'my-f1': 'Concentrado F1',
      'partial-close': 'Cierre de Parciales',
      'at-risk': 'Alumnos en Riesgo',
      'my-at-risk': 'Mis Alumnos en Riesgo',
      reports: 'Reportes',
      'users-mgmt': 'Gestión de Usuarios',
      'honor-roll': 'Cuadros de Honor',
      'grades-admin': 'Consulta Calificaciones',
      'bitacora': 'Bitácora del Sistema',
      'captura-progress': 'Monitor de Captura'
    };
    for (const [key, label] of Object.entries(fallbacks)) {
      if (!Router.modules[key]) {
        Router.modules[key] = () => showModulePlaceholder(label);
      }
    }
  }
};

// ───────────────────────────────────────────────────────────────
// AUTH - Módulo de Autenticación (con métodos también expuestos en App
// para que los onclick inline del HTML que usan "App.xxx" funcionen)
// ───────────────────────────────────────────────────────────────
const Auth = {
  /**
   * Configura el escuchador de cambios de autenticación
   */
  setupAuthListener() {
    auth.onAuthStateChanged(async (firebaseUser) => {
      // Ocultar splash de carga
      const splash = document.getElementById('splashScreen');
      if (splash) splash.style.display = 'none';

      if (firebaseUser) {
        console.log('🔐 Usuario detectado:', firebaseUser.email);
        await this.handleUserLogin(firebaseUser);
      } else {
        console.log('🚪 No hay usuario autenticado');
        this.showLoginScreen();
      }
    });
  },

  /**
   * Maneja el login del usuario
   * @param {Object} firebaseUser - Usuario de Firebase
   */
  async handleUserLogin(firebaseUser) {
    try {
      // Obtener documento del usuario desde Firestore
      let userDoc = await DB.users().doc(firebaseUser.uid).get();

      if (!userDoc.exists) {
        // Intentar crear como admin (solo funciona si las reglas lo permiten)
        try {
          console.log('🏗️ Usuario no encontrado, intentando bootstrap como admin...');
          const adminData = {
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0],
            role: 'admin',
            status: 'active',
            createdAt: DB.timestamp(),
            autoCreated: true
          };
          await DB.users().doc(firebaseUser.uid).set(adminData);
          userDoc = await DB.users().doc(firebaseUser.uid).get();
          console.log('✅ Admin bootstrap exitoso');
          Toast.show('¡Bienvenido! Se te asignó el rol de Administrador.', 'success');
        } catch (bootstrapError) {
          console.log('⛔ Bootstrap no permitido:', bootstrapError.message);
          this.showLoginError('Tu cuenta no está autorizada. Contacta al administrador.');
          await auth.signOut();
          return;
        }
      }

      // Usuario autorizado
      const userData = userDoc.data();
      App.currentUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        ...userData
      };

      console.log('✅ Usuario autorizado:', App.currentUser);

      // ═══ PRIMER INGRESO OBLIGATORIO ═══
      // Si la cuenta tiene mustChangePassword: true, mostrar pantalla de
      // primer ingreso (cambia password + correo recuperación obligatorio)
      // antes de dejar entrar al sistema.
      if (userData.mustChangePassword === true) {
        console.log('🔒 Primer ingreso requerido');
        this.showFirstLoginScreen(firebaseUser, userData);
        return;
      }

      // Mostrar app y aplicar permisos
      this.showApp();
      App.applyRoleVisibility(App.currentUser.role);

      // Actualizar información del usuario en la UI
      this.updateUserUI();

      // Si es admin, sincronizar alias de correo silenciosamente para los
      // maestros que ya completaron primer ingreso pero quedaron sin alias
      // (porque lo terminaron antes de que la feature existiera). Esto
      // permite que esos maestros puedan loguearse con su correo personal.
      if (App.currentUser.role === 'admin') {
        setTimeout(() => this.syncEmailAliases({ silent: true }), 2000);
      }

      // Restaurar la última ruta o ir al dashboard
      const lastRoute = sessionStorage.getItem('epo67_lastRoute');
      const target = (lastRoute && Router.modules[lastRoute]) ? lastRoute : 'dashboard';
      Router.navigate(target);

    } catch (error) {
      console.error('❌ Error verificando usuario:', error);
      // No cerrar sesión por error de red/Firestore — reintentar en 3 segundos
      Toast.show('Error de conexión. Reintentando...', 'warning');
      setTimeout(() => {
        if (auth.currentUser) this.handleUserLogin(auth.currentUser);
      }, 3000);
    }
  },

  /**
   * Estado interno para toggle login/registro
   */
  _isRegisterMode: false,

  /**
   * Toggle entre modo login y registro
   */
  toggleRegister() {
    this._isRegisterMode = !this._isRegisterMode;
    const toggle = document.getElementById('toggleAuth');
    const btn = document.getElementById('btnLogin');
    if (this._isRegisterMode) {
      toggle.textContent = '¿Ya tienes cuenta? Inicia sesión';
      btn.innerHTML = '<span class="material-icons-round" style="font-size:20px;vertical-align:middle;margin-right:6px;">person_add</span> Registrarse';
    } else {
      toggle.textContent = '¿No tienes cuenta? Regístrate';
      btn.innerHTML = '<span class="material-icons-round" style="font-size:20px;vertical-align:middle;margin-right:6px;">login</span> Iniciar Sesión';
    }
    document.getElementById('loginError').style.display = 'none';
  },

  /**
   * Login o registro con email/password.
   * Si el usuario escribe su correo de recuperación (gmail, hotmail, etc.) en
   * lugar de su correo @epo67.local, se busca el alias en /email_aliases/
   * y se traduce al correo sintético antes de llamar a Firebase Auth.
   * Esto permite que los maestros inicien sesión con el correo que mejor
   * recuerdan después de haber configurado su primer ingreso.
   */
  async loginWithEmail(event) {
    event.preventDefault();
    const typedEmail = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    if (!typedEmail || !password) {
      this.showLoginError('Ingresa correo y contraseña');
      return;
    }

    // Traducir correo de recuperación → correo sintético si aplica.
    // No tocamos nada si el usuario ya escribió un @epo67.local.
    let email = typedEmail;
    if (!this._isRegisterMode && !typedEmail.endsWith('@epo67.local')) {
      try {
        const aliasDoc = await DB.emailAliases().doc(typedEmail).get();
        if (aliasDoc.exists) {
          const realEmail = aliasDoc.data().email;
          if (realEmail && realEmail !== typedEmail) {
            console.log(`🔁 Alias de correo: ${typedEmail} → ${realEmail}`);
            email = realEmail;
          }
        }
      } catch (e) {
        console.warn('[login] Falló lookup de alias:', e.message);
        // No bloqueamos: si la lectura del alias falla, intentamos signin
        // con el correo tal cual lo escribió el usuario.
      }
    }

    try {
      if (this._isRegisterMode) {
        await auth.createUserWithEmailAndPassword(email, password);
        console.log('🔑 Registro exitoso');
        DB.audit('crear_usuario', 'usuario', '', { description: `Registro de nuevo usuario: ${email}` });
      } else {
        await auth.signInWithEmailAndPassword(email, password);
        console.log('🔑 Login exitoso');
        DB.audit('login', 'sesion', '', { description: `Inicio de sesión: ${email}` });
        // Recordar el correo que el usuario escribió (no el traducido) — así
        // la próxima vez ve su correo personal en el campo, no el @epo67.local.
        try {
          const remember = document.getElementById('rememberEmail')?.checked;
          if (remember) localStorage.setItem('epo67_lastEmail', typedEmail);
          else localStorage.removeItem('epo67_lastEmail');
        } catch (_) { /* no-op */ }
      }
      // El onAuthStateChanged se encarga del resto
    } catch (error) {
      console.error('❌ Error en autenticación:', error);
      let msg = 'Error de autenticación';
      if (error.code === 'auth/user-not-found') msg = 'No existe una cuenta con este correo';
      else if (error.code === 'auth/wrong-password') msg = 'Contraseña incorrecta';
      else if (error.code === 'auth/email-already-in-use') msg = 'Este correo ya está registrado';
      else if (error.code === 'auth/weak-password') msg = 'La contraseña debe tener al menos 6 caracteres';
      else if (error.code === 'auth/invalid-email') msg = 'Correo electrónico inválido';
      else if (error.code === 'auth/invalid-credential') msg = 'Credenciales inválidas. Verifica tu correo y contraseña';
      else msg = error.message;
      this.showLoginError(msg);
    }
  },

  /**
   * Modal "Cambiar mi contraseña" disponible para cualquier usuario logueado.
   * Pide password actual + nueva (2 veces). Reautentica y aplica el cambio.
   */
  openChangePasswordModal() {
    if (!auth.currentUser) { Toast.show('Inicia sesion primero', 'warning'); return; }
    const body = `
      <div style="display:flex;flex-direction:column;gap:12px;max-width:380px;">
        <p style="margin:0;color:#475569;font-size:13px;">
          Por seguridad, ingresa tu contraseña actual y luego escribe la nueva dos veces.
          La nueva debe tener al menos 6 caracteres.
        </p>
        <label style="font-size:13px;font-weight:600;">Contraseña actual
          <input id="cpw_old" type="password" autocomplete="current-password" required minlength="6"
            style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-top:4px;">
        </label>
        <label style="font-size:13px;font-weight:600;">Contraseña nueva
          <input id="cpw_new1" type="password" autocomplete="new-password" required minlength="6"
            style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-top:4px;">
        </label>
        <label style="font-size:13px;font-weight:600;">Repite la contraseña nueva
          <input id="cpw_new2" type="password" autocomplete="new-password" required minlength="6"
            style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;margin-top:4px;">
        </label>
        <div id="cpw_err" style="display:none;color:#dc2626;font-size:12px;font-weight:600;padding:6px 8px;background:#fef2f2;border-radius:4px;"></div>
      </div>
    `;
    const footer = `
      <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-primary" onclick="Auth.submitChangePassword()">Cambiar contraseña</button>
    `;
    Modal.open('Cambiar mi contraseña', body, footer);
    setTimeout(() => document.getElementById('cpw_old')?.focus(), 100);
  },

  async submitChangePassword() {
    const oldEl = document.getElementById('cpw_old');
    const new1El = document.getElementById('cpw_new1');
    const new2El = document.getElementById('cpw_new2');
    const errEl = document.getElementById('cpw_err');
    const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };

    const oldPwd = (oldEl?.value || '').trim();
    const new1 = (new1El?.value || '').trim();
    const new2 = (new2El?.value || '').trim();

    if (!oldPwd || !new1 || !new2) return showErr('Llena los tres campos.');
    if (new1.length < 6) return showErr('La contraseña nueva debe tener al menos 6 caracteres.');
    if (new1 !== new2) return showErr('Las contraseñas nuevas no coinciden.');
    if (new1 === oldPwd) return showErr('La nueva contraseña debe ser diferente a la actual.');

    const user = auth.currentUser;
    if (!user) { showErr('Tu sesion expiro. Cierra sesion y entra de nuevo.'); return; }

    try {
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, oldPwd);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(new1);
      // Marcar passwordChangedAt en su user doc para futuros analiticos
      try {
        await db.collection('users').doc(user.uid).update({
          passwordChangedAt: DB.timestamp(),
          mustChangePassword: false
        });
      } catch (e) { console.warn('[changePassword] no se pudo actualizar users doc:', e.message); }
      try {
        DB.audit('cambiar_password', 'sesion', user.uid, { description: 'El usuario cambio su propia contraseña' });
      } catch (e) { /* no critico */ }
      Modal.close();
      Toast.show('✅ Contraseña cambiada exitosamente. Usala la proxima vez que entres.', 'success');
    } catch (err) {
      console.error('[changePassword] error:', err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showErr('La contraseña actual no es correcta. Verifica e intenta de nuevo.');
      } else if (err.code === 'auth/weak-password') {
        showErr('Contraseña muy debil. Usa al menos 6 caracteres.');
      } else if (err.code === 'auth/requires-recent-login') {
        showErr('Por seguridad, cierra sesion y vuelve a entrar antes de cambiar la contraseña.');
      } else if (err.code === 'auth/too-many-requests') {
        showErr('Demasiados intentos. Espera unos minutos antes de volver a intentar.');
      } else {
        showErr('Error: ' + (err.message || err.code || 'desconocido'));
      }
    }
  },

  /**
   * Logout
   */
  async logout() {
    try {
      const logoutEmail = auth.currentUser?.email || '';
      DB.audit('logout', 'sesion', '', { description: `Cierre de sesión: ${logoutEmail}` });
      await auth.signOut();
      App.currentUser = null;
      Store.invalidateAll();
      sessionStorage.removeItem('epo67_lastRoute');
      this.showLoginScreen();
      Toast.show('Sesión cerrada', 'info');
      console.log('👋 Logout completado');
    } catch (error) {
      console.error('❌ Error en logout:', error);
      Toast.show('Error al cerrar sesión', 'error');
    }
  },

  /**
   * Muestra pantalla de login
   */
  showLoginScreen() {
    const fl = document.getElementById('firstLoginScreen');
    if (fl) fl.style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';

    // ─── Recordar correo del último login ───
    try {
      const lastEmail = localStorage.getItem('epo67_lastEmail');
      const emailInput = document.getElementById('loginEmail');
      if (lastEmail && emailInput && !emailInput.value) {
        emailInput.value = lastEmail;
        // Mover foco a contraseña
        const pwdInput = document.getElementById('loginPassword');
        if (pwdInput) pwdInput.focus();
      }
    } catch (_) { /* localStorage bloqueado: ignorar */ }

    // ─── Detector de Caps Lock ───
    const pwdInput = document.getElementById('loginPassword');
    const capsWarn = document.getElementById('capsLockWarning');
    if (pwdInput && capsWarn && !pwdInput._capsBound) {
      pwdInput._capsBound = true;
      const updateCaps = (e) => {
        try {
          if (e.getModifierState && e.getModifierState('CapsLock')) {
            capsWarn.style.display = 'block';
          } else {
            capsWarn.style.display = 'none';
          }
        } catch (_) { /* ignore */ }
      };
      pwdInput.addEventListener('keydown', updateCaps);
      pwdInput.addEventListener('keyup', updateCaps);
      pwdInput.addEventListener('focus', updateCaps);
      pwdInput.addEventListener('blur', () => { capsWarn.style.display = 'none'; });
    }
  },

  /**
   * Muestra la aplicación principal
   */
  showApp() {
    const fl = document.getElementById('firstLoginScreen');
    if (fl) fl.style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    // PRIMER INGRESO: si nunca ha hecho el tour, llevarlo al Centro de Ayuda
    // (mejor que el tour porque el Centro de Ayuda combina video + manual +
    // tutorial + FAQs todo en una pantalla, funciona offline-first y no se rompe).
    try {
      const tourDone = localStorage.getItem('epo67_tour_done') === 'true' ||
                       App.currentUser?.tourCompleted === true;
      if (!tourDone) {
        // Pequeño delay para que la app termine de pintarse
        setTimeout(() => {
          try {
            if (Router && Router.modules?.['help-center']) {
              Router.navigate('help-center');
            }
          } catch (_) {}
        }, 600);
      }
    } catch (_) {}
  },

  /**
   * Pantalla de PRIMER INGRESO obligatorio:
   *  - Nueva contraseña + confirmación
   *  - Correo de recuperación OBLIGATORIO (para reset auto-servicio)
   * No permite cerrar sin completar.
   */
  showFirstLoginScreen(firebaseUser, userData) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'none';

    let fl = document.getElementById('firstLoginScreen');
    if (!fl) {
      fl = document.createElement('div');
      fl.id = 'firstLoginScreen';
      fl.className = 'login-screen';
      document.body.appendChild(fl);
    }
    fl.style.display = 'flex';
    fl.innerHTML = `
      <div class="login-card" style="max-width:480px;">
        <div class="login-logo">
          <span class="material-icons-round login-icon">lock_reset</span>
          <h1>Configuración inicial</h1>
          <p class="login-subtitle">Hola, ${Utils.sanitize(userData.displayName || firebaseUser.email)}.<br>Antes de entrar, configura tu cuenta.</p>
        </div>
        <form id="firstLoginForm" onsubmit="App.submitFirstLogin(event)">
          <div class="form-group">
            <label for="flCurrentPwd"><strong>Tu contraseña temporal</strong> <span style="color:#dc2626;">*</span></label>
            <div class="pwd-input-wrapper" style="position:relative;display:block;">
              <input type="password" id="flCurrentPwd" placeholder="La que te dio el administrador" required autocomplete="current-password" style="padding-right:54px;width:100%;box-sizing:border-box;">
              <span class="pwd-toggle-eye" data-target="flCurrentPwd" tabindex="-1" role="button" aria-label="Mostrar/ocultar" title="Click para mostrar/ocultar" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#3182ce;background:#eef5fb;border-radius:6px;user-select:none;z-index:10;border:1px solid #cbd5e0;">
                <span class="material-icons-round" style="font-size:22px;pointer-events:none;">visibility</span>
              </span>
            </div>
            <small style="color:#666;font-size:11px;">Para confirmar tu identidad antes de cambiarla.</small>
          </div>
          <div class="form-group">
            <label for="flNewPwd"><strong>Nueva contraseña</strong> <span style="color:#dc2626;">*</span></label>
            <div class="pwd-input-wrapper" style="position:relative;display:block;">
              <input type="password" id="flNewPwd" placeholder="Mínimo 8 caracteres" required minlength="8" autocomplete="new-password" style="padding-right:54px;width:100%;box-sizing:border-box;">
              <span class="pwd-toggle-eye" data-target="flNewPwd" tabindex="-1" role="button" aria-label="Mostrar/ocultar" title="Click para mostrar/ocultar" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#3182ce;background:#eef5fb;border-radius:6px;user-select:none;z-index:10;border:1px solid #cbd5e0;">
                <span class="material-icons-round" style="font-size:22px;pointer-events:none;">visibility</span>
              </span>
            </div>
            <small style="color:#666;font-size:11px;">Mínimo 8 caracteres. Distinta a la temporal.</small>
          </div>
          <div class="form-group">
            <label for="flConfirmPwd"><strong>Confirmar contraseña</strong> <span style="color:#dc2626;">*</span></label>
            <div class="pwd-input-wrapper" style="position:relative;display:block;">
              <input type="password" id="flConfirmPwd" placeholder="Repite tu contraseña" required minlength="8" autocomplete="new-password" style="padding-right:54px;width:100%;box-sizing:border-box;">
              <span class="pwd-toggle-eye" data-target="flConfirmPwd" tabindex="-1" role="button" aria-label="Mostrar/ocultar" title="Click para mostrar/ocultar" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#3182ce;background:#eef5fb;border-radius:6px;user-select:none;z-index:10;border:1px solid #cbd5e0;">
                <span class="material-icons-round" style="font-size:22px;pointer-events:none;">visibility</span>
              </span>
            </div>
          </div>
          <div class="form-group">
            <label for="flRecoveryEmail"><strong>Correo de recuperación</strong> <span style="color:#dc2626;">*</span></label>
            <input type="email" id="flRecoveryEmail" placeholder="tu.correo@gmail.com" required value="${Utils.sanitize(userData.recoveryEmail || '')}">
            <small style="color:#666;font-size:11px;">Tu correo personal real (gmail, hotmail, etc). Si pierdes tu contraseña, recibirás el enlace de recuperación ahí.</small>
          </div>
          <div class="form-group">
            <label for="flPhone"><strong>Teléfono WhatsApp</strong> <span style="color:#dc2626;">*</span></label>
            <input type="tel" id="flPhone" placeholder="5512345678" required pattern="[0-9]{10}" maxlength="10" inputmode="numeric" value="${Utils.sanitize(userData.phone || '')}">
            <small style="color:#666;font-size:11px;">10 dígitos sin lada (ej: 5512345678). Lo usamos para mandarte avisos importantes y atender tus dudas rápido.</small>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="btnFirstLogin">
            <span class="material-icons-round" style="font-size:20px;vertical-align:middle;margin-right:6px;">check</span>
            Guardar y entrar
          </button>
        </form>
        <div id="flError" class="login-error" style="display:none;margin-top:12px;padding:10px 14px;background:#fef2f2;border:1px solid #dc2626;border-radius:6px;color:#7f1d1d;font-size:13px;"></div>
        <div class="login-toggle" style="margin-top:16px;font-size:12px;color:#666;text-align:center;">
          🔒 No es posible cerrar sesión hasta completar este paso.
        </div>

        <!-- SOS WA en primer ingreso -->
        <a href="https://wa.me/525510782357?text=Hola%20Olivia%2C%20estoy%20configurando%20mi%20cuenta%20por%20primera%20vez%20en%20el%20Sistema%20Escolar%20y%20necesito%20ayuda."
           target="_blank" rel="noopener"
           style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;padding:12px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
          ¿Estás atorado(a)? Pídeme ayuda por WhatsApp
        </a>
      </div>
    `;
  },

  /**
   * Procesa el primer ingreso: reautentica → cambia password → guarda recoveryEmail
   * @param {Event} event
   */
  async submitFirstLogin(event) {
    event.preventDefault();
    console.log('[firstLogin] submit triggered');
    const errEl = document.getElementById('flError');
    if (errEl) errEl.style.display = 'none';

    const tempPwd = document.getElementById('flCurrentPwd').value;
    const newPwd = document.getElementById('flNewPwd').value;
    const confirmPwd = document.getElementById('flConfirmPwd').value;
    const recoveryEmail = document.getElementById('flRecoveryEmail').value.trim().toLowerCase();
    const phone = (document.getElementById('flPhone')?.value || '').replace(/\D/g, '');

    // Validaciones
    if (!tempPwd) { this._flShowError('Ingresa tu contraseña temporal actual'); return; }
    if (newPwd.length < 8) { this._flShowError('La nueva contraseña debe tener al menos 8 caracteres'); return; }
    if (newPwd !== confirmPwd) { this._flShowError('La nueva contraseña y la confirmación no coinciden'); return; }
    if (newPwd === tempPwd) { this._flShowError('La nueva contraseña debe ser distinta a la temporal'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoveryEmail)) { this._flShowError('Ingresa un correo de recuperación válido (ej: tu@gmail.com)'); return; }
    if (recoveryEmail.endsWith('@epo67.local')) { this._flShowError('El correo de recuperación debe ser real (gmail, hotmail, etc), no @epo67.local'); return; }
    if (phone.length !== 10) { this._flShowError('El teléfono debe tener exactamente 10 dígitos (ej: 5512345678)'); return; }

    const btn = document.getElementById('btnFirstLogin');
    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:20px;vertical-align:middle;">autorenew</span> Guardando...';

    // Timeout de seguridad para que no se quede colgado
    const timeoutId = setTimeout(() => {
      this._flShowError('La operación está tardando más de lo normal. Verifica tu internet o intenta de nuevo.');
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }, 20000);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sesión expirada. Recarga la página y vuelve a iniciar sesión.');
      console.log('[firstLogin] reauth user:', user.email);

      // 1. Reautenticar con password actual (necesario para updatePassword)
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, tempPwd);
      await user.reauthenticateWithCredential(credential);
      console.log('[firstLogin] reauth ok');

      // 2. Actualizar password en Firebase Auth
      await user.updatePassword(newPwd);
      console.log('[firstLogin] password updated');

      // 3. Actualizar user doc en Firestore
      await DB.users().doc(user.uid).update({
        recoveryEmail,
        phone,
        mustChangePassword: false,
        passwordChangedAt: DB.timestamp()
      });
      console.log('[firstLogin] firestore updated');

      // 3.5 Guardar alias para login por correo de recuperación.
      // Permite que la próxima vez el maestro inicie sesión con su correo
      // personal (gmail, hotmail) en lugar del @epo67.local sintético.
      try {
        await DB.emailAliases().doc(recoveryEmail).set({
          email: user.email,
          uid: user.uid,
          updatedAt: DB.timestamp()
        });
        console.log('[firstLogin] alias de correo guardado');
      } catch (aliasErr) {
        console.warn('[firstLogin] No se pudo guardar alias (no crítico):', aliasErr.message);
      }

      // 4. Audit log (no bloquea si falla)
      try {
        await DB.audit('primer_ingreso', 'usuario', user.uid, {
          description: `Primer ingreso completado: ${App.currentUser.displayName} configuró nueva contraseña, correo de recuperación y teléfono`,
          metadata: { recoveryEmail, phone }
        });
      } catch (e) { console.warn('[firstLogin] audit log failed (no es crítico):', e.message); }

      clearTimeout(timeoutId);
      Toast.show('¡Listo! Tu cuenta está configurada. Cargando...', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      clearTimeout(timeoutId);
      console.error('[firstLogin] error:', e.code, e.message, e);
      let msg = e.message || 'Error guardando configuración';
      if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials') {
        msg = '⚠ La contraseña temporal es incorrecta. Verifica con tu administrador o revisa el CSV de credenciales.';
      } else if (e.code === 'auth/weak-password') {
        msg = 'La nueva contraseña es muy débil. Usa al menos 8 caracteres.';
      } else if (e.code === 'auth/network-request-failed') {
        msg = 'Error de conexión. Verifica tu internet y vuelve a intentar.';
      } else if (e.code === 'auth/too-many-requests') {
        msg = 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.';
      } else if (e.code === 'auth/requires-recent-login') {
        msg = 'Sesión expirada. Recargo la página para que vuelvas a iniciar sesión...';
        setTimeout(() => window.location.reload(), 2000);
      }
      this._flShowError(msg);
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  },

  _flShowError(msg) {
    const errEl = document.getElementById('flError');
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    } else {
      Toast.show(msg, 'error');
    }
  },

  /**
   * Alterna visibilidad de un input password.
   * Compatible con: <button onclick> directo, o con <span class="pwd-toggle-eye" data-target="...">
   */
  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const icon = btn ? btn.querySelector('.material-icons-round') : null;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.textContent = 'visibility_off';
    } else {
      input.type = 'password';
      if (icon) icon.textContent = 'visibility';
    }
  },

  /**
   * Sincroniza los alias de correo para usuarios que ya completaron su primer
   * ingreso pero no tienen su alias escrito (porque completaron antes de que
   * esta feature existiera). Permite que puedan loguearse con su correo de
   * recuperación. Idempotente — sólo escribe los que faltan.
   *
   * Sólo lo ejecuta el admin (las reglas permiten que admin escriba alias
   * para otros uid). Se llama automáticamente al iniciar sesión admin.
   */
  async syncEmailAliases({ silent = false } = {}) {
    if (App.currentUser?.role !== 'admin') {
      if (!silent) Toast.show('Sólo admin puede sincronizar alias', 'warning');
      return;
    }
    try {
      const usersSnap = await DB.users()
        .where('mustChangePassword', '==', false)
        .get();

      const missing = [];
      for (const doc of usersSnap.docs) {
        const u = doc.data();
        if (!u.recoveryEmail || !u.email) continue;
        const recovery = String(u.recoveryEmail).trim().toLowerCase();
        if (!recovery || recovery.endsWith('@epo67.local')) continue;
        const aliasDoc = await DB.emailAliases().doc(recovery).get();
        if (!aliasDoc.exists) {
          missing.push({ recovery, email: u.email, uid: doc.id });
        }
      }

      if (missing.length === 0) {
        if (!silent) Toast.show('Todos los alias de correo ya están al día', 'success');
        return;
      }

      const batch = DB.batch();
      for (const m of missing) {
        batch.set(DB.emailAliases().doc(m.recovery), {
          email: m.email,
          uid: m.uid,
          updatedAt: DB.timestamp(),
          syncedByMigration: true
        });
      }
      await batch.commit();
      console.log(`✓ Sincronizados ${missing.length} alias de correo:`, missing.map(m => m.recovery));
      if (!silent) {
        Toast.show(`✓ ${missing.length} maestros ya pueden iniciar sesión con su correo personal`, 'success');
      }
    } catch (e) {
      console.warn('[syncEmailAliases] error:', e);
      if (!silent) Toast.show('No se pudieron sincronizar alias: ' + e.message, 'error');
    }
  },

  /**
   * Handler global de clicks en .pwd-toggle-eye (más robusto que onclick inline).
   * Se invoca desde init() en setupAuthListener para que funcione siempre.
   */
  _setupGlobalPasswordToggle() {
    if (this._pwdToggleSetup) return;
    this._pwdToggleSetup = true;
    document.addEventListener('click', (e) => {
      const eye = e.target.closest('.pwd-toggle-eye');
      if (!eye) return;
      e.preventDefault();
      e.stopPropagation();
      const targetId = eye.dataset.target;
      if (!targetId) return;
      this.togglePasswordVisibility(targetId, eye);
    });
  },

  /**
   * Modal "¿Olvidaste tu contraseña?".
   *
   * Estrategia:
   *  - Si el correo es @epo67.local (sintético): no podemos mandar email allí.
   *    Mandamos al usuario con Olivia para reset manual.
   *  - Si el correo es real (gmail, hotmail…): intentamos resolver primero si
   *    es un alias de un maestro (entonces su Auth email es @epo67.local y
   *    tampoco podemos enviar) o si es el Auth email directo (como el de
   *    Olivia admin) — en cuyo caso Firebase manda el reset directo.
   *  - Si Firebase responde EMAIL_NOT_FOUND: redirigimos a soporte.
   *
   * Ya NO hace lookup a /users (queda bloqueado por reglas sin sesión, que
   * era exactamente el bug pre-existente que dejaba inutilizable este flujo).
   */
  openForgotPassword() {
    if (typeof Modal === 'undefined') {
      alert('Por favor recarga la página y vuelve a intentar.');
      return;
    }
    const body = `
      <div style="margin-bottom:14px;font-size:13px;color:#444;line-height:1.4;">
        Ingresa tu correo de inicio de sesión y te enviaremos un enlace para restablecer tu contraseña.
      </div>
      <div class="form-group">
        <label for="fpEmail">Correo</label>
        <input type="email" id="fpEmail" placeholder="tu@correo.com" autocomplete="email">
      </div>
      <div id="fpInfo" style="font-size:12px;color:#666;margin-top:8px;display:none;line-height:1.45;"></div>
    `;
    const footer = `
      <button class="btn btn-outline" data-action="modal-cancel">Cancelar</button>
      <button class="btn btn-primary" data-action="fp-send">Enviar enlace</button>
    `;
    Modal.open('Recuperar contraseña', body, footer);

    document.querySelector('.modal').addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="modal-cancel"]')) { Modal.close(); return; }
      if (!e.target.closest('[data-action="fp-send"]')) return;

      const typed = document.getElementById('fpEmail').value.trim().toLowerCase();
      const info = document.getElementById('fpInfo');
      info.style.display = 'block';
      if (!typed) { info.textContent = '⚠ Ingresa tu correo'; info.style.color = '#dc2626'; return; }

      // Mensaje compartido cuando el reset por email no es viable y
      // el usuario debe contactar a Olivia
      const sosMsg = '⚠ No podemos restablecer este correo automáticamente. ' +
        'Escríbele a Olivia por <a href="https://wa.me/525510782357?text=Hola%20Olivia%2C%20necesito%20que%20me%20generes%20una%20contrase%C3%B1a%20nueva." ' +
        'target="_blank" style="color:#0d6efd;text-decoration:underline;">WhatsApp</a> y te genera una contraseña temporal.';

      // Caso 1: correo sintético @epo67.local — Firebase no puede enviar email
      // a un dominio inexistente. Vamos directo al fallback de soporte.
      if (typed.endsWith('@epo67.local')) {
        info.innerHTML = sosMsg;
        info.style.color = '#dc2626';
        return;
      }

      // Caso 2: correo real. Si es un alias de un maestro (recoveryEmail), el
      // Auth email subyacente es sintético y Firebase no puede enviar reset.
      // Detectamos eso con un lookup público a /email_aliases. Si encontramos
      // alias, redirigimos a soporte. Si NO encontramos alias, asumimos que
      // es el Auth email directo (caso admin/usuarios bootstrap) y Firebase
      // sí puede enviar.
      try {
        const aliasDoc = await DB.emailAliases().doc(typed).get();
        if (aliasDoc.exists) {
          info.innerHTML = sosMsg;
          info.style.color = '#dc2626';
          return;
        }
      } catch (lookupErr) {
        console.warn('[forgotPassword] alias lookup falló (no crítico):', lookupErr.message);
      }

      try {
        await auth.sendPasswordResetEmail(typed);
        info.innerHTML = `✅ Si esa cuenta existe, enviamos un enlace a <strong>${typed}</strong>.<br>Revisa tu bandeja de entrada (y spam).`;
        info.style.color = '#16a34a';
        setTimeout(() => Modal.close(), 4500);
      } catch (err) {
        console.warn('[forgotPassword] sendPasswordResetEmail:', err.code, err.message);
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
          info.innerHTML = sosMsg;
          info.style.color = '#dc2626';
        } else if (err.code === 'auth/too-many-requests') {
          info.textContent = '⚠ Demasiados intentos. Espera unos minutos antes de reintentar.';
          info.style.color = '#dc2626';
        } else {
          info.textContent = '⚠ ' + (err.message || 'Error al procesar la solicitud');
          info.style.color = '#dc2626';
        }
      }
    });
  },

  /**
   * Muestra error de login
   * @param {string} message - Mensaje de error
   */
  showLoginError(message) {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    console.error('🚫 Error de login:', message);
  },

  /**
   * Actualiza la información del usuario en la UI
   */
  updateUserUI() {
    const user = App.currentUser;
    document.getElementById('userName').textContent = user.displayName || user.email;
    document.getElementById('userRole').textContent = this.getRoleLabel(user.role);

    const avatarEl = document.getElementById('userAvatar');
    if (user.photoURL) {
      avatarEl.src = user.photoURL;
      avatarEl.style.display = '';
    } else {
      // Ocultar img y mostrar icono por defecto
      avatarEl.style.display = 'none';
      // Insertar icono si no existe ya
      if (!avatarEl.parentElement.querySelector('.avatar-icon')) {
        const icon = document.createElement('span');
        icon.className = 'material-icons-round avatar-icon';
        icon.textContent = 'account_circle';
        icon.style.cssText = 'font-size:36px; color:var(--color-text-lighter);';
        avatarEl.parentElement.insertBefore(icon, avatarEl);
      }
    }
  },

  /**
   * Obtiene la etiqueta legible del rol
   * @param {string} role - Rol
   * @returns {string} Etiqueta del rol
   */
  getRoleLabel(role) {
    return K.getRoleLabel(role);
  }
};

// ───────────────────────────────────────────────────────────────
// EXPONER MÉTODOS DE AUTH EN APP (para que onclick="App.xxx()" del HTML
// funcione, y para que App.init() pueda llamar setupGlobalPasswordToggle)
// ───────────────────────────────────────────────────────────────
['togglePasswordVisibility', '_setupGlobalPasswordToggle', 'openForgotPassword',
 'submitFirstLogin', '_flShowError', 'showFirstLoginScreen', 'handleUserLogin',
 'showLoginScreen', 'showApp', 'syncEmailAliases'].forEach(method => {
  if (typeof Auth[method] === 'function' && !App[method]) {
    App[method] = Auth[method].bind(Auth);
  }
});

// ───────────────────────────────────────────────────────────────
// ROUTER - Sistema de Navegación
// ───────────────────────────────────────────────────────────────
const Router = {
  currentModule: 'dashboard',
  modules: {},

  /**
   * Control de acceso por rol para cada módulo.
   * Si un módulo no está aquí, se asume acceso para todos los autenticados.
   */
  ACCESS: {
    // Roles con acceso amplio: admin, subdirector (jefe academico), directivo (read-only).
    // secretario_escolar (Roberto): solo inscripciones (students/enrollment); el resto bloqueado.
    // ─── Administracion ───
    'school-config': ['admin', 'directivo', 'subdirector'],
    'teachers': ['admin', 'directivo', 'subdirector'],
    'students': ['admin', 'directivo', 'subdirector', 'secretario_escolar'],
    'enrollment': ['admin', 'directivo', 'subdirector', 'secretario_escolar'],
    'partial-close': ['admin', 'directivo', 'subdirector'],
    'captura-progress': ['admin', 'directivo', 'subdirector'],
    'import-grades': ['admin'],
    'import-students': ['admin', 'subdirector', 'secretario_escolar'],
    'users-mgmt': ['admin'],     // gestión de usuarios SOLO admin
    'bitacora': ['admin', 'directivo', 'subdirector'],
    // ─── Direccion ───
    'grade-corrections': ['admin', 'directivo', 'subdirector'],
    'honor-roll': ['admin', 'directivo', 'subdirector', 'orientador'],
    // ─── Orientacion ───
    'boletas': ['admin', 'directivo', 'subdirector', 'orientador'],
    'boleta-oficial': ['admin', 'directivo', 'subdirector', 'orientador'],
    'concentrado': ['admin', 'directivo', 'subdirector', 'orientador'],
    'at-risk': ['admin', 'directivo', 'subdirector', 'orientador'],
    'student-profile': ['admin', 'directivo', 'subdirector', 'secretario_escolar', 'orientador', 'maestro'],
    'reports': ['admin', 'directivo', 'subdirector', 'orientador'],
    'reports-comparative': ['admin', 'directivo', 'subdirector', 'orientador'],
    // ─── Docentes ───
    // Subdirector: lectura completa de la seccion (NO captura grades — eso queda al maestro).
    // 'my-grades' (capturar calificaciones) queda fuera del menu para subdirector y directivo:
    // las firestore.rules bloquean writes a quien no sea admin o maestro-con-asignacion.
    'my-grades': ['admin', 'maestro', 'orientador_docente'],
    'grades-admin': ['admin', 'directivo', 'subdirector', 'orientador', 'maestro'],
    'my-lists': ['admin', 'directivo', 'subdirector', 'maestro'],
    'my-f1': ['admin', 'directivo', 'subdirector', 'maestro', 'orientador_docente'],
    'indicadores': ['admin', 'directivo', 'subdirector', 'orientador', 'maestro'],
    'attendance': ['admin', 'directivo', 'subdirector', 'maestro'],
    'my-at-risk': ['admin', 'directivo', 'subdirector', 'maestro'],
    // Solicitud de cambio de calificacion (lado del maestro): siempre disponible
    'correction-request': ['admin', 'subdirector', 'maestro', 'orientador_docente'],
    // Consulta de calificaciones (solo lectura, todos los roles que ven datos)
    'grades-query': ['admin', 'subdirector', 'directivo', 'secretario_admin', 'secretario_escolar', 'orientador', 'orientador_docente', 'maestro', 'consulta'],
    // ─── Todos ───
    'dashboard': ['admin', 'orientador', 'maestro', 'directivo', 'subdirector', 'secretario_escolar', 'consulta']
  },

  /**
   * Navega a un módulo
   * @param {string} moduleName - Nombre del módulo
   */
  async navigate(moduleName) {
    try {
      // Validar que el módulo existe
      if (!this.modules[moduleName]) {
        console.error(`❌ Módulo no encontrado: ${moduleName}`);
        return;
      }

      // Verificar acceso por rol — respeta herencia (ROLE_INHERITS)
      // p.ej. orientador_docente hereda 'orientador' y 'maestro'.
      const role = App.currentUser?.role;
      const allowedRoles = this.ACCESS[moduleName];
      if (allowedRoles) {
        const ok = allowedRoles.some(r => App.canActAs(r));
        if (!ok) {
          console.warn(`⛔ Acceso denegado a ${moduleName} para rol ${role}`);
          Toast.show('No tienes acceso a este módulo', 'warning');
          return;
        }
      }

      // Actualizar módulo actual y guardar para restaurar tras refresh
      this.currentModule = moduleName;
      sessionStorage.setItem('epo67_lastRoute', moduleName);

      // Body class para CSS condicional (modo solo-lectura por rol+módulo)
      Array.from(document.body.classList).forEach(c => {
        if (c.startsWith('module-')) document.body.classList.remove(c);
      });
      document.body.classList.add('module-' + moduleName);

      // Actualizar nav items activos
      document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
      });
      const activeEl = document.querySelector(`[data-module="${moduleName}"]`);
      if (activeEl) activeEl.classList.add('active');

      // Renderizar módulo
      console.log(`📄 Navegando a: ${moduleName}`);
      await this.modules[moduleName]();

    } catch (error) {
      console.error(`❌ Error navegando a ${moduleName}:`, error);
      Toast.show(`Error cargando módulo: ${moduleName}`, 'error');
    }
  }
};

// ───────────────────────────────────────────────────────────────
// MODAL - Sistema de Modales
// ───────────────────────────────────────────────────────────────
const Modal = {
  /**
   * Abre un modal
   * @param {string} title - Título del modal
   * @param {string} bodyHTML - HTML del cuerpo
   * @param {string} footerHTML - HTML del pie (opcional)
   */
  open(title, bodyHTML, footerHTML = '') {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHTML;
    document.getElementById('modalFooter').innerHTML = footerHTML;
    overlay.style.display = 'flex';
    console.log('📋 Modal abierto:', title);
  },

  /**
   * Cierra el modal
   */
  close() {
    document.getElementById('modalOverlay').style.display = 'none';
  },

  /**
   * Muestra un diálogo de confirmación
   * @param {string} title - Título
   * @param {string} message - Mensaje
   * @param {Function} onConfirm - Callback al confirmar
   */
  confirm(title, message, onConfirm) {
    const bodyHTML = `<p>${Utils.sanitize(message)}</p>`;
    const footerHTML = `
      <button class="btn btn-secondary" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-primary" onclick="Modal._confirmCallback()">Confirmar</button>
    `;

    this._confirmCallback = onConfirm;
    this.open(title, bodyHTML, footerHTML);
  },

  _confirmCallback: null,

  /**
   * Confirmación por escritura — el usuario debe escribir una palabra exacta para confirmar.
   * Evita accidentes con acciones destructivas.
   * @param {string} title       - Título del modal
   * @param {string} message     - Mensaje descriptivo (HTML permitido)
   * @param {string} confirmWord - Palabra que el usuario debe escribir (ej: "ELIMINAR")
   * @param {Function} onConfirm - Callback al confirmar exitosamente
   */
  confirmTyped(title, message, confirmWord, onConfirm) {
    const bodyHTML = `
      <div style="margin-bottom:16px;">${message}</div>
      <div class="typed-confirm-box">
        <label class="typed-confirm-label">
          Para confirmar, escribe <strong class="typed-confirm-word">${Utils.sanitize(confirmWord)}</strong> en el campo de abajo:
        </label>
        <input type="text" id="typedConfirmInput" class="typed-confirm-input"
          placeholder="Escribe aquí..." autocomplete="off" spellcheck="false">
        <div id="typedConfirmHint" class="typed-confirm-hint"></div>
      </div>`;

    const footerHTML = `
      <button class="btn btn-outline" onclick="Modal.close()">Cancelar</button>
      <button class="btn btn-danger" id="typedConfirmBtn" disabled>
        <span class="material-icons-round" style="font-size:16px;vertical-align:middle;margin-right:4px;">warning</span>
        Confirmar
      </button>`;

    this.open(title, bodyHTML, footerHTML);

    // Bind input validation
    setTimeout(() => {
      const input = document.getElementById('typedConfirmInput');
      const btn = document.getElementById('typedConfirmBtn');
      const hint = document.getElementById('typedConfirmHint');
      if (!input || !btn) return;

      input.focus();

      input.addEventListener('input', () => {
        const val = input.value.trim();
        if (val === confirmWord) {
          btn.disabled = false;
          input.classList.add('typed-confirm-match');
          input.classList.remove('typed-confirm-nomatch');
          hint.textContent = '✓ Correcto';
          hint.className = 'typed-confirm-hint typed-confirm-hint--ok';
        } else {
          btn.disabled = true;
          input.classList.remove('typed-confirm-match');
          if (val.length > 0) {
            input.classList.add('typed-confirm-nomatch');
            hint.textContent = 'No coincide';
            hint.className = 'typed-confirm-hint typed-confirm-hint--err';
          } else {
            input.classList.remove('typed-confirm-nomatch');
            hint.textContent = '';
            hint.className = 'typed-confirm-hint';
          }
        }
      });

      // Allow Enter to confirm when valid
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btn.disabled) {
          btn.click();
        }
      });

      btn.addEventListener('click', () => {
        if (input.value.trim() === confirmWord) {
          Modal.close();
          onConfirm();
        }
      });
    }, 100);
  }
};

// ───────────────────────────────────────────────────────────────
// TOAST - Sistema de Notificaciones
// ───────────────────────────────────────────────────────────────
const Toast = {
  /**
   * Muestra una notificación toast
   * @param {string} message - Mensaje
   * @param {string} type - Tipo: 'success', 'error', 'info', 'warning' (default: 'info')
   * @param {number} duration - Duración en ms (default: 3000)
   */
  show(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${Utils.sanitize(message)}</span>
      <button class="toast-close" onclick="this.parentElement.remove()">
        <span class="material-icons-round">close</span>
      </button>
    `;

    container.appendChild(toast);

    // Auto-remover después de la duración
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
    }, duration);

    console.log(`🔔 Toast [${type}]: ${message}`);
  }
};

// ───────────────────────────────────────────────────────────────
// UTILS - Funciones Utilitarias
// ───────────────────────────────────────────────────────────────
const Utils = {
  /**
   * Genera nombres de archivo consistentes para descargas e impresiones.
   * Patrón: EPO67-<TIPO>-<TURNO>-<GRUPO>-<MATERIA>-<MAESTRO>-<PARCIAL>-<ALUMNO>-<FECHA>.<ext>
   * Los segmentos vacíos se omiten. Nombres se sanitizan (sin acentos,
   * espacios → "_", solo a-zA-Z0-9_).
   *
   * @param {Object} p
   * @param {string} p.tipo - Identificador del tipo (F1, CONCENTRADO, BOLETA, etc)
   * @param {string} [p.turno] - MATUTINO/VESPERTINO → MAT/VESP
   * @param {string|number} [p.grado]
   * @param {string} [p.grupo] - "2-1" → "2-1"
   * @param {string} [p.materia]
   * @param {string} [p.maestro]
   * @param {string} [p.parcial] - P1/P2/P3/ACUMULADO/FINAL
   * @param {string} [p.alumno]
   * @param {Date|string} [p.fecha] - Default: hoy. Formato YYYYMMDD
   * @param {string} p.ext - 'xlsx', 'pdf', etc (sin punto)
   * @returns {string} Nombre de archivo limpio
   */
  fileName(p = {}) {
    const sanitize = (s) => (s || '')
      .toString()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .slice(0, 60);

    const turnoShort = (t) => {
      const u = (t || '').toUpperCase();
      if (u.startsWith('MAT')) return 'MAT';
      if (u.startsWith('VES')) return 'VESP';
      return sanitize(t);
    };

    const fechaStr = (() => {
      const d = p.fecha ? (p.fecha instanceof Date ? p.fecha : new Date(p.fecha)) : new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${dd}`;
    })();

    // Maestro: tomar 2 palabras significativas (apellido paterno + nombre)
    const maestroShort = (() => {
      if (!p.maestro) return '';
      const norm = p.maestro
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
        .replace(/\bPROFRA?\.?|\bMTRA?\.?|\bDR[A]?\.?|\bLIC\.?|\bMA\.?/g, '').trim();
      const words = norm.split(/\s+/).filter(w => w.length > 2);
      return words.slice(0, 2).join('_');
    })();

    // Materia: tomar primeras 3 palabras significativas
    const materiaShort = (() => {
      if (!p.materia) return '';
      const norm = p.materia
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      const words = norm.split(/\s+/).filter(w => w.length > 2 && !['DE','DEL','LA','LAS','LOS','EL','Y','EN'].includes(w));
      return words.slice(0, 3).join('_').slice(0, 28);
    })();

    const parts = [
      'EPO67',
      sanitize(p.tipo),
      turnoShort(p.turno),
      p.grupo ? sanitize(p.grupo) : (p.grado ? sanitize(p.grado + 'GRADO') : ''),
      materiaShort,
      maestroShort,
      sanitize(p.parcial),
      sanitize(p.alumno),
      fechaStr
    ].filter(Boolean);

    const ext = (p.ext || '').replace(/^\./, '');
    const base = parts.join('-');
    return ext ? `${base}.${ext}` : base;
  },

  /**
   * Restringe los <select> de turno y grado a sólo los valores presentes
   * en la lista de grupos pasada (típicamente los del orientador). Si solo
   * queda una opción, la auto-selecciona y dispara `change`. Si role es
   * 'admin', no hace nada (mantiene todas las opciones).
   *
   * @param {Array} allowedGroups - Array de groups con {turno, grado}
   * @param {string} turnoSelectId
   * @param {string} gradoSelectId
   * @param {Object} [opts] - { keepEmpty: false (no mostrar option vacío si autoselect) }
   */
  restrictTurnoGradoOptions(allowedGroups, turnoSelectId, gradoSelectId, opts = {}) {
    if (App.currentUser?.role === 'admin') return;
    if (!Array.isArray(allowedGroups) || allowedGroups.length === 0) return;
    const turnoSel = document.getElementById(turnoSelectId);
    const gradoSel = document.getElementById(gradoSelectId);
    const turnos = [...new Set(allowedGroups.map(g => g.turno).filter(Boolean))];
    const grados = [...new Set(allowedGroups.map(g => Number(g.grado)).filter(g => Number.isFinite(g)))].sort();

    if (turnoSel) {
      turnoSel.innerHTML = '<option value="">Selecciona turno</option>' +
        turnos.map(t => `<option value="${t}">${t}</option>`).join('');
      if (turnos.length === 1) {
        turnoSel.value = turnos[0];
        turnoSel.dispatchEvent(new Event('change'));
      }
    }
    if (gradoSel) {
      gradoSel.innerHTML = '<option value="">Selecciona grado</option>' +
        grados.map(g => `<option value="${g}">${g}º Grado</option>`).join('');
      if (grados.length === 1) {
        gradoSel.value = grados[0];
        gradoSel.dispatchEvent(new Event('change'));
      }
    }
  },

  /**
   * Formatea un timestamp de Firestore a DD/MM/YYYY
   * @param {Object} timestamp - Timestamp de Firestore
   * @returns {string} Fecha formateada
   */
  formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  },

  /**
   * Formatea un timestamp a DD/MM/YYYY HH:mm
   * @param {Object} timestamp - Timestamp de Firestore
   * @returns {string} Fecha y hora formateadas
   */
  formatDateTime(timestamp) {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const dateStr = this.formatDate(date);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${dateStr} ${hours}:${minutes}`;
  },

  /**
   * Sanitiza HTML básico
   * @param {string} str - String a sanitizar
   * @returns {string} String sanitizado
   */
  sanitize(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /**
   * Función debounce
   * @param {Function} fn - Función a debounce
   * @param {number} delay - Retardo en ms
   * @returns {Function} Función debounceada
   */
  debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Genera un ID aleatorio
   * @returns {string} ID aleatorio
   */
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  },

  /**
   * Retorna clase CSS según calificación
   * @param {number} value - Calificación
   * @returns {string} Nombre de clase CSS
   */
  gradeColor(value) {
    if (value >= 8) return 'grade-excellent';
    if (value >= 6) return 'grade-good';
    return 'grade-poor';
  },

  /**
   * Parsea un nombre mexicano "APELLIDO1 [APELLIDO2] NOMBRES" en sus partes,
   * reconociendo conectores (DE, DEL, LA, LAS, LOS, Y) que agrupan el siguiente
   * token con el anterior como apellido compuesto, y abreviaciones (MA., JOSE,
   * etc.) que terminan con punto y se interpretan como nombre.
   */
  _parseName(fullName) {
    const CONNECTORS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y']);
    const t = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (t.length === 0) return { apellidos: [], nombres: [] };
    if (t.length === 1) return { apellidos: [], nombres: [t[0]] };
    if (t.length === 2) return { apellidos: [t[0]], nombres: [t[1]] };

    // Toma 1 apellido a partir del índice i. Si el siguiente token es conector
    // y hay otro después, agrupa los 3. Si el token actual termina en "." se
    // interpreta como abreviación de nombre — no es apellido.
    const take = (i) => {
      if (i >= t.length) return ['', i];
      if (t[i].endsWith('.')) return ['', i]; // abreviación → es nombre
      if (i + 2 < t.length && CONNECTORS.has(t[i + 1].toUpperCase())) {
        return [`${t[i]} ${t[i + 1]} ${t[i + 2]}`, i + 3];
      }
      return [t[i], i + 1];
    };

    const [a1, i1] = take(0);
    const [a2, i2] = take(i1);
    return {
      apellidos: [a1, a2].filter(Boolean),
      nombres: t.slice(i2).filter(Boolean),
    };
  },

  /** "Nombre Apellido1" — versión corta para celdas estrechas. */
  shortName(fullName) {
    const { apellidos, nombres } = this._parseName(fullName);
    const apCorto = apellidos[0] ? apellidos[0].split(/\s+/)[0] : '';
    if (nombres.length === 0) return apCorto;
    if (!apCorto) return nombres[0];
    return `${nombres[0]} ${apCorto}`;
  },

  /** "NOMBRES APELLIDO1 APELLIDO2" — versión completa. */
  displayName(fullName) {
    const { apellidos, nombres } = this._parseName(fullName);
    return [...nombres, ...apellidos].join(' ');
  },

  /**
   * Exporta datos a Excel (carga XLSX bajo demanda)
   * @param {Array} data - Array de objetos
   * @param {string} filename - Nombre del archivo
   */
  async exportToExcel(data, filename = 'export.xlsx') {
    try {
      await Lib.xlsx();
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Datos');
      XLSX.writeFile(wb, filename);
      Toast.show('Archivo exportado correctamente', 'success');
      console.log('💾 Datos exportados a Excel:', filename);
    } catch (error) {
      console.error('❌ Error exportando a Excel:', error);
      Toast.show('Error al exportar Excel', 'error');
    }
  },

  /**
   * Lee un archivo Excel (carga XLSX bajo demanda)
   * @param {File} file - Archivo Excel
   * @returns {Promise<Array>} Promise que resuelve con array de objetos
   */
  async parseExcelFile(file) {
    await Lib.xlsx();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          console.log('📊 Archivo Excel leído:', jsonData.length, 'registros');
          resolve(jsonData);
        } catch (error) {
          console.error('❌ Error leyendo Excel:', error);
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }
};

// Dashboard se carga desde js/modules/dashboard.js

// ───────────────────────────────────────────────────────────────
// FUNCIONES AUXILIARES
// ───────────────────────────────────────────────────────────────

/**
 * Muestra un placeholder para módulos no implementados
 */
function showModulePlaceholder(moduleName) {
  const container = document.getElementById('moduleContainer');
  container.innerHTML = `
    <div class="module-container">
      <div class="empty-state">
        <span class="material-icons-round empty-state-icon">hourglass_empty</span>
        <h2>${Utils.sanitize(moduleName)}</h2>
        <p class="empty-state-text">Este m\u00f3dulo est\u00e1 en desarrollo...</p>
      </div>
    </div>
  `;
}

// ───────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ───────────────────────────────────────────────────────────────

/**
 * Se ejecuta cuando el DOM está completamente cargado
 */
document.addEventListener('DOMContentLoaded', function() {
  console.log('🚀 DOM cargado, iniciando aplicación...');
  App.init();
});

// Permitir preventDefault en botones
document.addEventListener('click', function(e) {
  const nav = e.target.closest('.nav-item[data-module]');
  if (nav && !nav.getAttribute('onclick')) {
    e.preventDefault();
    Router.navigate(nav.dataset.module);
    return;
  }
  if (e.target.matches('.nav-item, .btn')) {
    // Evitar comportamiento por defecto si es necesario
  }
}, true);
