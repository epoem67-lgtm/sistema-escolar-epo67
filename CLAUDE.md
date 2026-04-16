# CLAUDE.md — Sistema Escolar EPO 67

> Este archivo es leido automaticamente por Claude Code al iniciar.
> Contiene el contexto completo del proyecto para cualquier agente que trabaje aqui.

## Proyecto

Sistema de administracion escolar para la **Escuela Preparatoria Oficial Num. 67** (EPO 67), Estado de Mexico.
Aplicacion web SPA desplegada en Firebase Hosting.

- **URL produccion:** https://epo67-sistema.web.app
- **Proyecto Firebase:** `epo67-sistema` (cuenta: epoem67@gmail.com)
- **Repositorio GitHub:** https://github.com/devdaalper/sistema-escolar-epo67 (privado)
- **Responsable:** Dario (dev.daalper@gmail.com)
- **Ciclo escolar:** 2025-2026
- **Version actual:** v4.6

## Datos de la escuela

- ~811 alumnos registrados (~368 activos), 2 turnos (matutino/vespertino)
- 73 docentes (35 mat + 38 vesp), 18 grupos (9 por turno), 37 materias
- 3 parciales por semestre
- Metas institucionales: Promedio >=8.3, Asistencia >=80%, Reprobacion <=14%

## Stack tecnico

- **Frontend:** Vanilla JavaScript SPA (sin frameworks). HTML + CSS + JS modular.
- **Backend:** Firebase (Hosting + Firestore + Auth con Google). Sin servidor propio.
- **Datos de origen:** Google Sheets (73 hojas de docentes) + archivos Excel (.xlsx)
- **Despliegue:** `npx firebase-tools deploy --only hosting` desde `sistema-escolar-firebase/`

## Estructura del proyecto

```
ADMINISTRACION ESCOLAR EPO 67/
├── sistema-escolar-firebase/      <-- CODIGO EN PRODUCCION
│   ├── public/
│   │   ├── index.html             Shell de la SPA
│   │   ├── css/styles.css         Design system completo (2,237 lineas)
│   │   └── js/
│   │       ├── firebase-config.js Firebase init
│   │       ├── constants.js       K.* constantes centralizadas
│   │       ├── data-store.js      Store.* cache de datos
│   │       ├── components.js      UI.* componentes reutilizables
│   │       ├── app.js             Core: Auth, Router, Modal, Toast, Utils
│   │       └── modules/           18 modulos IIFE auto-registrados
│   ├── firestore.rules            Seguridad por roles
│   └── REDESPLEGAR.command        Deploy rapido (doble clic en Mac)
├── _AGENTE/                       Sistema de agentes IA (5 sub-agentes)
├── _PROYECTO/                     Archivos de referencia (Excel, docs)
├── _ENTREGABLE/                   Outputs finales
├── _RESPALDOS/                    Backups
├── TURNO MATUTINO/                Controles y listas del turno
├── TURNO VESPERTINO/              Controles y listas del turno
├── ESTADO_DE_PROYECTO.md          Documentacion detallada del proyecto
└── CLAUDE.md                      Este archivo
```

## Arquitectura del codigo

### Capas compartidas

| Capa | Archivo | Objeto global | Proposito |
|------|---------|---------------|-----------|
| Constantes | `constants.js` | `K` | Parciales, turnos, grados, roles, umbrales |
| Data Store | `data-store.js` | `Store` | Cache en memoria de Firestore |
| Componentes | `components.js` | `UI` | Funciones que retornan HTML reutilizable |
| Core | `app.js` | `App, Auth, Router, Modal, Toast, Utils` | SPA core |
| Estilos | `styles.css` | CSS custom properties | Design system con tokens |

### Patron de modulos

Todos los modulos usan IIFE con estado privado y se auto-registran en `Router.modules`:

```js
const MiModulo = (() => {
  async function render() { /* ... */ }
  function bindEvents() { /* ... */ }
  return { render };
})();
Router.modules['mi-modulo'] = () => MiModulo.render();
```

Usan event delegation con `data-action` (nunca `onclick` inline).
Usan clases CSS del design system (nunca inline styles).

### Modulos existentes (18 en modules/)

| Modulo | Lineas | Funcion |
|--------|--------|---------|
| `dashboard.js` | 137 | Dashboard principal |
| `students.js` | 887 | CRUD alumnos, bajas con motivo |
| `teachers.js` | 1,017 | CRUD docentes, asignaciones, orientadores |
| `grades.js` | 557 | Captura y consulta de calificaciones |
| `enrollment.js` | 411 | Control de inscripcion con tutor/contacto |
| `at-risk.js` | 319 | Alumnos en riesgo, 3 vistas |
| `honor-roll.js` | 249 | Cuadro de honor |
| `school-config.js` | 255 | Configuracion escolar y metas |
| `my-lists.js` | 190 | Listas personalizadas por docente |
| `users-mgmt.js` | 217 | Gestion de usuarios/roles |
| `partial-close.js` | 342 | Apertura/cierre de parciales, overrides |
| `import-grades.js` | 695 | Importar calificaciones desde Excel |
| `import-students.js` | 249 | Importar alumnos desde listas oficiales |
| `boletas.js` | 576 | Boletas por alumno o grupo, imprimibles |
| `indicadores.js` | 494 | Dashboard de indicadores institucionales |
| `concentrado.js` | 485 | Matriz alumnos x materias con colores |
| `attendance.js` | 383 | Control de asistencia |
| `reports-comparative.js` | 359 | Reportes comparativos multi-dimension |

## Colecciones en Firestore

`users`, `teachers`, `students`, `groups`, `subjects`, `assignments`, `assignmentsByGroup`, `grades`, `partials`, `atRisk`, `enrollments`, `config`, `partialOverrides`, `attendance`, `activityLog`

## Roles de usuario

- **admin**: Acceso total
- **orientador**: Lectura de docentes, alumnos, calificaciones, inscripciones
- **maestro**: Solo calificaciones de SUS asignaciones, solo parciales NO bloqueados
- **directivo**: Lectura de indicadores y reportes
- **consulta**: Solo lectura general

Los permisos estan definidos en `firestore.rules` y la visibilidad del sidebar se controla con `data-roles` en `index.html`.

## Rubros de evaluacion

- **MATUTINO**: EC (max 8) + Transversal (max 2) + P.Extra = Suma -> Calif
- **VESPERTINO**: EC (max 5) + Examen (max 3) + Transversal (max 2) + P.Extra = Suma -> Calif
- **Redondeo**: >=6 redondeo normal, <6 se trunca (5.9->5). Maximo siempre 10.

## Convenciones de codigo

- Prefijo de constantes: `K.`
- Prefijo de cache: `Store.`
- Prefijo de UI: `UI.`
- Sanitizar texto de usuario: `Utils.sanitize()`
- Color primario: `#3182ce` (var `--color-primary`)
- Archivos de modulo: nombre-en-minusculas-con-guiones.js
- Sin frameworks, sin build tools, sin bundlers

## Convenciones de Git

Formato de commits:
```
[modulo/area] Descripcion concisa

Ejemplos:
  [students] Agregar validacion de CURP
  [indicadores] Corregir calculo de tasa de reprobacion
  [styles] Agregar clases para badges de asistencia
  [deploy] Desplegar v4.7 a Firebase
```

Flujo de trabajo:
1. `git pull` antes de empezar a trabajar (sincronizar con GitHub)
2. Hacer cambios
3. `git add <archivos>` + `git commit -m "[modulo] Descripcion"`
4. `git push` al terminar

## Despliegue

Desde `sistema-escolar-firebase/`:
```bash
npx firebase-tools deploy --only hosting
```
O en Mac: doble clic en `REDESPLEGAR.command`

## Documentacion adicional

Para informacion mas detallada, leer:
- `ESTADO_DE_PROYECTO.md` — Estado completo del proyecto, historia de versiones, issues conocidos
- `sistema-escolar-firebase/APP_JS_DOCUMENTATION.md` — Documentacion de app.js
- `_AGENTE/ARQUITECTURA_ORQUESTADOR.md` — Sistema de agentes IA

## Notas importantes

- El nombre de la carpeta del proyecto contiene caracteres Unicode (ADMINISTRACION con tilde). En algunas terminales puede causar problemas de navegacion.
- Firebase Storage NO esta configurado (el upload de logo no funciona).
- Firebase SDK usa version compat (v8). Pendiente migrar a modular (v9).
- El sistema usa localStorage para algunos datos temporales y Firestore como fuente de verdad.
