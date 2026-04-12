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

    try {
      // Registrar módulos
      this.registerModules();

      // Configurar escuchador de autenticación
      Auth.setupAuthListener();

      // Cargar configuración escolar
      await this.loadSchoolConfig();

      console.log('✅ Sistema Escolar inicializado correctamente');
    } catch (error) {
      console.error('❌ Error inicializando la aplicación:', error);
      Toast.show('Error al inicializar la aplicación', 'error');
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

    // Mostrar elementos que coinciden con el rol actual
    const visibleElements = document.querySelectorAll(`[data-roles*="${role}"]`);
    visibleElements.forEach(el => {
      el.style.display = '';
    });

    console.log(`👤 Visibilidad aplicada para rol: ${role}`);
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
      'partial-close': 'Cierre de Parciales',
      'at-risk': 'Alumnos en Riesgo',
      'my-at-risk': 'Mis Alumnos en Riesgo',
      reports: 'Reportes',
      'users-mgmt': 'Gestión de Usuarios',
      'honor-roll': 'Cuadros de Honor',
      'grades-admin': 'Calificaciones (Admin)'
    };
    for (const [key, label] of Object.entries(fallbacks)) {
      if (!Router.modules[key]) {
        Router.modules[key] = () => showModulePlaceholder(label);
      }
    }
  }
};

// ───────────────────────────────────────────────────────────────
// AUTH - Módulo de Autenticación
// ───────────────────────────────────────────────────────────────
const Auth = {
  /**
   * Configura el escuchador de cambios de autenticación
   */
  setupAuthListener() {
    auth.onAuthStateChanged(async (firebaseUser) => {
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
            displayName: firebaseUser.displayName || 'Administrador',
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

      // Mostrar app y aplicar permisos
      this.showApp();
      App.applyRoleVisibility(App.currentUser.role);

      // Actualizar información del usuario en la UI
      this.updateUserUI();

      // Navegar al dashboard
      Router.navigate('dashboard');

    } catch (error) {
      console.error('❌ Error verificando usuario:', error);
      this.showLoginError('Error al verificar tu cuenta. Intenta de nuevo.');
      await auth.signOut();
    }
  },

  /**
   * Login con Google
   */
  async loginWithGoogle() {
    try {
      const result = await auth.signInWithPopup(googleProvider);
      console.log('🔑 Login Google exitoso');
      // El onAuthStateChanged se encarga del resto
    } catch (error) {
      console.error('❌ Error en login Google:', error);
      this.showLoginError(`Error: ${error.message}`);
    }
  },

  /**
   * Logout
   */
  async logout() {
    try {
      await auth.signOut();
      App.currentUser = null;
      Store.invalidateAll();
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
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginError').style.display = 'none';
  },

  /**
   * Muestra la aplicación principal
   */
  showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
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

    if (user.photoURL) {
      document.getElementById('userAvatar').src = user.photoURL;
    } else {
      // Avatar por defecto
      document.getElementById('userAvatar').innerHTML =
        '<span class="material-icons-round">account_circle</span>';
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
// ROUTER - Sistema de Navegación
// ───────────────────────────────────────────────────────────────
const Router = {
  currentModule: 'dashboard',
  modules: {},

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

      // Actualizar módulo actual
      this.currentModule = moduleName;

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

  _confirmCallback: null
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
   * Exporta datos a Excel
   * @param {Array} data - Array de objetos
   * @param {string} filename - Nombre del archivo
   */
  exportToExcel(data, filename = 'export.xlsx') {
    try {
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
   * Lee un archivo Excel
   * @param {File} file - Archivo Excel
   * @returns {Promise<Array>} Promise que resuelve con array de objetos
   */
  async parseExcelFile(file) {
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
  if (e.target.matches('.nav-item, .btn')) {
    // Evitar comportamiento por defecto si es necesario
  }
}, true);
