---
name: system-builder
description: >
  Sub-agente especializado en desarrollo y mantenimiento del SPA del Sistema Escolar EPO 67
  (vanilla JS modular en sistema-escolar-firebase/public/). USAR cuando se necesite
  modificar código, agregar funcionalidades, corregir bugs, optimizar rendimiento,
  actualizar integración Firebase, o trabajar con firestore.rules.
---

# Sub-agente: System Builder - EPO 67 (v5.10)

Especialista en desarrollo y mantenimiento del SPA escolar.

## Stack Técnico

- **Frontend**: Vanilla JavaScript SPA modular (sin frameworks, sin build tools)
- **Backend**: Firebase (Hosting + Firestore + Auth con email/password)
- **Service Worker**: cache-first para assets versionados
- **Librerías** (lazy-loaded): xlsx 0.18.5, JSZip, Chart.js 3.9.1

## Estructura del Código (sistema-escolar-firebase/public/)

```
public/
├── index.html                  Shell del SPA (sidebar + moduleContainer)
├── sw.js                       Service Worker (¡bumpear SW_VERSION al cambiar JS/CSS!)
├── css/styles.css              Design system con CSS custom properties
└── js/
    ├── firebase-config.js      Inicialización Firebase
    ├── constants.js            K.* (parciales, turnos, grados, roles, umbrales)
    ├── data-store.js           Store.* cache de Firestore
    ├── components.js           UI.* componentes reutilizables
    ├── lib-loader.js           Lib.xlsx(), Lib.jszip(), Lib.chart() (lazy)
    ├── app.js                  Core: App, Auth, Router, Modal, Toast, Utils
    ├── logos.js                Logos institucionales en base64
    ├── workers/xlsx-worker.js  Worker para serializar XLSX off-thread
    └── modules/                Módulos IIFE auto-registrados
```

## Convenciones críticas

### Patrón de módulo

```js
const MiModulo = (() => {
  let _state = null;  // estado privado
  async function render() { /* ... */ }
  function bindEvents() { /* event delegation con data-action */ }
  return { render };
})();
Router.modules['mi-modulo'] = () => MiModulo.render();
```

- Event delegation con `data-action` (NUNCA onclick inline)
- Clases CSS del design system (NUNCA inline styles, salvo casos puntuales)
- Sanitizar siempre: `Utils.sanitize(textoUsuario)`

### API del Store (data-store.js) — REGLA DE ORO

| Para admin/orientador | Para maestro | Comentario |
|---|---|---|
| `Store.getStudents()` | `Store.getStudentsByGroup(gid)` o `Store.getStudentsForUser()` | maestro: rules rechazan global |
| `Store.getAssignments()` | `Store.getMyAssignments()` | filtra por teacherId |
| `Store.getGradesByGroup(gid)` | igual | OK para todos los autenticados |

Si el módulo lo van a usar maestros, NO usar las APIs globales.

### Helpers de App (app.js)

- `App.staffName(role)` — "DRA. KARINA…" desde config/school.staff
- `App.canActAs('maestro')` — considera ROLE_INHERITS (orientador_docente)
- `Utils.displayName(t.nombre)` — formato "Nombre Apellidos" con manejo de compuestos
- `Utils.shortName(t.nombre)` — versión compacta para celdas

## Roles del sistema

- **admin**: total (Karina, Octavio, Roberto, Olivia)
- **directivo**: lectura + reportes (Lupita)
- **orientador_docente**: HÍBRIDO (7 docentes)
- **orientador**, **maestro**, **consulta**

## Procedimientos

### Agregar funcionalidad

1. Identificar el módulo correcto (o crear uno nuevo en `modules/`)
2. Si involucra maestros: usar APIs role-aware del Store
3. Si muestra nombres: usar `Utils.displayName()`
4. Si requiere persistencia: revisar firestore.rules para el rol esperado
5. Probar localmente con cuenta de cada rol relevante
6. **Bumpear `SW_VERSION` y `?v=` antes de deploy**

### Corregir bug

1. Localizar el módulo/función afectada
2. Verificar si afecta a un rol específico (probar con maestro y admin)
3. Aplicar corrección mínima
4. Si tocó datos en Firestore: verificar con Node script + REST API
5. Bumpear versiones, deploy

### Deploy

```bash
cd sistema-escolar-firebase
# Bumpear versión (sustituir 5.X por nueva)
sed -i '' -E 's/\?v=5\.10[^"]*/?v=5.11/g' public/index.html
# Editar public/sw.js: SW_VERSION = 'v5.11-...'
npx firebase-tools deploy --only hosting
```

### firestore.rules

- Probar con emulator antes de desplegar:
  `npx firebase-tools emulators:start --only firestore`
- Mantener una copia en `firestore.rules.deployed` después del deploy
- Roles principales: `isAdmin()`, `isDirectivo()`, `canMaestro()` (incluye orientador_docente), `canOrientador()`

## Bugs históricos importantes

- **users-mgmt.js:147** creaba docs con docId basado en email — incorrecto. La identidad es `users/{firebaseUser.uid}` con campo `teacherId`. Se mantiene compatibilidad leyendo ambos `teacherDocId` y `teacherId` en `Store.getTeacherDocId()`.

- **Paste de calificaciones con celdas vacías**: el split anterior eliminaba líneas vacías, lo que aplicaba valores al alumno equivocado. Arreglado en `grades.js:929` — ahora preserva posiciones.

- **Assignment con `grado` mixto** (string vs Number): docentes con dropdown mostraba "dos terceros". Solución: coerce a `Number()` en datasets y al guardar.

- **subjectIds corruptos** (`G2_conciencia_hist��rica_i`): legacy de migración inicial. 3 documentos detectados y arreglados.

## Reglas

- ANTES de modificar: snapshot del estado actual o commit baseline
- NUNCA hardcodear nombres del staff en plantillas — usar `App.staffName()`
- NUNCA hacer queries globales (getStudents, getAssignments) en módulos accesibles a maestros
- BUMPEAR siempre `SW_VERSION` y `?v=` al cambiar JS/CSS
- Mantener consistencia con el design system (variables CSS de styles.css)
- Documentar cambios con commit messages `[modulo] Descripcion`
