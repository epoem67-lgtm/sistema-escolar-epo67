# app.js - Documentación Técnica

## Descripción General
`app.js` es el archivo principal de la aplicación del Sistema Escolar. Contiene la lógica central y todos los módulos de soporte necesarios para la gestión académica de EPO 67.

**Ubicación:** `/public/js/app.js`
**Tamaño:** ~745 líneas
**Dependencias:** firebase-config.js (debe cargarse primero)

## Arquitectura Global

El archivo utiliza **arquitectura basada en objetos globales**, NOT ES6 modules. Esto permite que funcione con Firebase compat SDK sin necesidad de bundlers.

### Variables Globales Disponibles (desde firebase-config.js)
- `db` - Instancia de Firestore
- `auth` - Instancia de Authentication
- `storage` - Instancia de Storage
- `googleProvider` - Proveedor de Google para auth
- `DB` - Objeto helper con funciones de Firestore

## Módulos Principales

### 1. **App** - Controlador Principal
```javascript
App.init()                    // Inicialización en DOMContentLoaded
App.currentUser              // Usuario autenticado actual
App.schoolConfig             // Configuración de la escuela
App.loadSchoolConfig()       // Carga config desde Firestore
App.applyRoleVisibility()    // Muestra/oculta elementos por rol
App.registerModules()        // Registra módulos disponibles
```

**Flujo:**
1. DOMContentLoaded → App.init()
2. Registra módulos en Router.modules
3. Configura escuchador de autenticación
4. Carga configuración de la escuela

### 2. **Auth** - Autenticación
```javascript
Auth.setupAuthListener()     // Escucha cambios de autenticación
Auth.loginWithGoogle()       // Login con Google
Auth.logout()               // Cierra sesión
Auth.handleUserLogin()      // Verifica usuario en Firestore
Auth.showLoginScreen()      // Muestra pantalla de login
Auth.showApp()             // Muestra aplicación principal
Auth.updateUserUI()        // Actualiza info del usuario en UI
```

**Comportamiento:**
- Cuando usuario hace login, busca su documento en Firestore `users/{uid}`
- Si no existe documento → Muestra error: "Tu cuenta no está autorizada..."
- Si existe → Almacena datos en App.currentUser y carga app

### 3. **Router** - Sistema de Navegación
```javascript
Router.navigate(moduleName)  // Navega a un módulo
Router.currentModule        // Módulo actual
Router.modules             // Registro de módulos disponibles
```

**Características:**
- Actualiza nav items activos
- Llama función render del módulo
- Renderiza en #moduleContainer

### 4. **Modal** - Sistema de Modales
```javascript
Modal.open(title, bodyHTML, footerHTML)
Modal.close(event)
Modal.confirm(title, message, onConfirm)
```

**Características:**
- Click en overlay cierra modal
- Sanitiza HTML
- Dialogo de confirmación con callbacks

### 5. **Toast** - Notificaciones
```javascript
Toast.show(message, type, duration)
```

**Tipos:** 'success', 'error', 'info', 'warning'
**Default duration:** 3000ms
**Auto-remueve** después de duración

### 6. **Utils** - Funciones Utilitarias
```javascript
Utils.formatDate(timestamp)           // Devuelve DD/MM/YYYY
Utils.formatDateTime(timestamp)       // Devuelve DD/MM/YYYY HH:mm
Utils.sanitize(str)                   // HTML sanitization
Utils.debounce(fn, delay)            // Debounce function
Utils.generateId()                    // ID aleatorio
Utils.gradeColor(value)              // CSS class por nota
Utils.exportToExcel(data, filename)  // Exporta a Excel
Utils.parseExcelFile(file)           // Lee archivo Excel
```

### 7. **Dashboard** - Dashboard Principal
```javascript
Dashboard.render()           // Renderiza dashboard
Dashboard.getAdminStats()    // Estadísticas para admin
Dashboard.getTeacherStats()  // Estadísticas para docente
Dashboard.getDefaultStats()  // Estadísticas por defecto
Dashboard.getHTML()         // Genera HTML del dashboard
```

**Estadísticas mostradas:**
- Total Alumnos
- Total Docentes
- Promedio General
- Alumnos en Riesgo

**Por Rol:**
- **Admin:** Ve estadísticas generales de toda la escuela
- **Maestro:** Ve solo estadísticas de sus grupos
- **Otros:** Estadísticas básicas

## Módulos Registrados

Todos estos módulos están registrados pero inicialmente muestran placeholder:
- dashboard ✅ (implementado completamente)
- school-config
- teachers
- students
- enrollment
- grades
- my-grades
- my-lists
- partial-close
- at-risk
- my-at-risk
- reports
- users-mgmt

Para implementar un módulo, editar su función en `Router.modules` o crear archivo en `/js/modules/`

## Control de Acceso Basado en Roles

### Sistema de Visibilidad
Los elementos nav usan atributo `data-roles`:
```html
<div class="nav-section admin-only" data-roles="admin">
  <!-- Solo visible para admin -->
</div>
```

### Roles Disponibles
- `admin` - Administrador (acceso total)
- `maestro` - Docente (acceso a grupos y calificaciones)
- `orientador` - Orientador (seguimiento de alumnos)
- `directivo` - Directivo (reportes)

## Flujo de Autenticación

```
1. Usuario accede a aplicación
   ↓
2. onAuthStateChanged dispara
   ↓
3. ¿Usuario autenticado?
   NO → Mostrar pantalla de login
   ↓
   SÍ → ¿Documento en Firestore 'users/{uid}'?
      NO → Mostrar error de autorización
      ↓
      SÍ → Almacenar en App.currentUser
         → Aplicar visibilidad de rol
         → Mostrar aplicación
         → Navegar a dashboard
```

## Estructura de Datos

### Document: users/{uid}
```javascript
{
  email: string,
  displayName: string,
  role: 'admin' | 'maestro' | 'orientador' | 'directivo',
  photoURL?: string,
  createdAt: timestamp
}
```

### Document: config/school
```javascript
{
  name: string,           // "EPO 67"
  logoUrl?: string,
  address?: string,
  phone?: string,
  email?: string
}
```

## Carga de Scripts

**IMPORTANTE:** El orden es crítico:

```html
<!-- 1. Firebase SDKs (compat) -->
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js"></script>

<!-- 2. SheetJS para Excel -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>

<!-- 3. Configuración Firebase -->
<script src="/js/firebase-config.js"></script>

<!-- 4. Aplicación Principal -->
<script src="/js/app.js"></script>
```

**NO** usar `type="module"` en estos scripts - son globales.

## Handleando Errores

Todos los módulos usan:
- `console.log()` con emojis para debugging
- `Toast.show()` para notificaciones a usuario
- `try/catch` para manejo de errores

Ejemplo:
```javascript
try {
  const data = await DB.collection('students').get();
} catch (error) {
  console.error('❌ Error:', error);
  Toast.show('Error al cargar alumnos', 'error');
}
```

## Exportación de Datos

Para exportar a Excel:
```javascript
const data = [
  { nombre: 'Juan', calificacion: 8.5 },
  { nombre: 'María', calificacion: 9.0 }
];
Utils.exportToExcel(data, 'estudiantes.xlsx');
```

## Lectura de Excel

```javascript
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', async (e) => {
  const data = await Utils.parseExcelFile(e.target.files[0]);
  console.log('Datos:', data);
});
```

## Debugging

Abrir console del navegador (F12) para ver:
- Logs con emojis del sistema
- Errores de Firestore
- Estado de autenticación
- Módulos cargados

Ejemplo de salida esperada:
```
🚀 DOM cargado, iniciando aplicación...
📱 Inicializando Sistema Escolar...
✅ Sistema Escolar inicializado correctamente
🔐 Usuario detectado: usuario@escuela.edu
✅ Configuración escolar cargada:
   {name: "EPO 67", ...}
✅ Usuario autorizado
👤 Visibilidad aplicada para rol: admin
📄 Navegando a: dashboard
✅ Dashboard renderizado
```

## Proximos Pasos

Para completar la aplicación:
1. Implementar módulos en `/js/modules/`
2. Importar módulos en app.js
3. Conectar a CSS (styles.css)
4. Crear Firestore rules
5. Configurar Storage
6. Agregar datos de prueba

