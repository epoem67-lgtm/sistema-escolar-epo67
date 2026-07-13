# Estado del Proyecto — Sistema Escolar EPO 67

> **Última actualización:** 11 de abril de 2026 (v3.1 + Git)
> **Responsable del proyecto:** Darío (dev.daalper@gmail.com)
> **Ciclo escolar:** 2025-2026

---

## 1. ¿Qué es este proyecto?

Sistema de administración escolar para la **Escuela Preparatoria Oficial Núm. 67** (EPO 67). Es una aplicación web desplegada en Firebase que permite gestionar alumnos, docentes, calificaciones, indicadores institucionales, listas oficiales, boletas y seguimiento de alumnos en riesgo.

**URL en producción:** https://epo67-sistema.web.app
**Proyecto Firebase:** `epo67-sistema` (cuenta: epoem67@gmail.com)

---

## 2. Datos de la escuela

| Concepto | Valor |
|---|---|
| Alumnos totales | ~811 registrados en Firestore (~368 activos) |
| Docentes | ~73 (35 matutino + 38 vespertino) |
| Turnos | 2 (matutino y vespertino) |
| Grados | 3 por turno |
| Grupos por grado | 3 (A, B, C) |
| Total de grupos | 18 (9 matutino + 9 vespertino) |
| Materias | 37 registradas |
| Asignaciones docente-materia-grupo | 211 |
| Parciales por semestre | 3 |
| Metas institucionales | Promedio ≥8.3, Asistencia ≥80%, Reprobación ≤14% |

---

## 3. Stack técnico

**Frontend:** Vanilla JavaScript SPA (sin frameworks). HTML + CSS + JS modular.
**Backend/Infraestructura:** Firebase (Hosting + Firestore + Auth con Google).
**Datos de origen:** Google Sheets (73 hojas de docentes) + archivos Excel (.xlsx) con controles de evaluación.
**Despliegue:** Firebase Hosting. Se puede desplegar con:
- `npx firebase-tools deploy --only hosting` desde `sistema-escolar-firebase/`
- O doble clic en `REDESPLEGAR.command` en Finder (Mac)

---

## 4. Arquitectura del código (sistema-escolar-firebase/)

```
sistema-escolar-firebase/
├── .firebaserc                    → Proyecto: epo67-sistema
├── firebase.json                  → Config hosting + firestore + storage
├── firestore.rules                → Reglas de seguridad (173 líneas, detalladas)
├── firestore.indexes.json         → Índices compuestos de Firestore
├── storage.rules                  → Reglas de Storage (NO configurado aún)
├── DESPLEGAR.command              → Script de primer despliegue
├── REDESPLEGAR.command            → Script de redespliegue rápido
├── APP_JS_DOCUMENTATION.md        → Documentación de app.js
└── public/
    ├── index.html                 → Shell de la SPA (228 líneas)
    ├── app_data.json              → Datos estáticos/migración (245 KB)
    ├── migration.html             → Herramienta de migración de datos
    ├── css/
    │   └── styles.css             → Design system completo (2,237 líneas)
    └── js/
        ├── firebase-config.js     → Configuración y credenciales Firebase (73 líneas)
        ├── constants.js           → Constantes centralizadas: K.PARCIALES, K.TURNOS, K.ROLES, K.THRESHOLDS (66 líneas)
        ├── data-store.js          → Cache de datos Firestore: Store.getStudents(), Store.getTeacherDocId(), etc. (174 líneas)
        ├── components.js          → Componentes UI reutilizables: UI.statsGrid(), UI.filterBar(), UI.dataTable(), etc. (298 líneas)
        ├── app.js                 → Core de la SPA: App, Auth, Router, Modal, Toast, Utils (577 líneas)
        └── modules/
            ├── dashboard.js       → Dashboard principal (137 líneas)
            ├── students.js        → CRUD de alumnos: edit, delete, baja con motivo (887 líneas)
            ├── teachers.js        → CRUD de docentes, asignaciones, orientadores, 4 tabs (1,017 líneas)
            ├── grades.js          → Captura y consulta de calificaciones, override de parcial (557 líneas)
            ├── enrollment.js      → Control de inscripción con datos de tutor/contacto (411 líneas)
            ├── at-risk.js         → Seguimiento de alumnos en riesgo, 3 vistas (319 líneas)
            ├── honor-roll.js      → Cuadro de honor (249 líneas)
            ├── school-config.js   → Configuración de la escuela y metas (255 líneas)
            ├── my-lists.js        → Listas personalizadas por docente (190 líneas)
            ├── users-mgmt.js      → Gestión de usuarios/roles (217 líneas)
            ├── partial-close.js   → Apertura/cierre de parciales, overrides por docente (342 líneas)
            ├── import-grades.js   → [v3.1] Importar calificaciones desde Excel (695 líneas)
            ├── import-students.js → [v3.1] Importar alumnos desde listas oficiales (249 líneas)
            ├── boletas.js         → [v3.1] Boletas/report cards por alumno o grupo (576 líneas)
            ├── indicadores.js     → [v3.1] Dashboard de indicadores institucionales (494 líneas)
            ├── concentrado.js     → [v3.1] Concentrado de calificaciones (matriz alumnos x materias) (485 líneas)
            ├── attendance.js      → [v3.1] Control de asistencia (383 líneas)
            └── reports-comparative.js → [v3.1] Reportes comparativos por grupo/materia/turno (359 líneas)
```

**Total de código JS:** ~9,010 líneas en 23 archivos (core + 18 módulos + utilidades compartidas).

### Arquitectura post-refactorización (v3.0)

**Patrón de módulos:** Todos los módulos usan **IIFE** (Immediately Invoked Function Expression) con estado privado. Se auto-registran en `Router.modules` al final de cada archivo. Usan **event delegation** con `data-action` atributos en lugar de `onclick=""` inline.

**Capas compartidas:**
| Capa | Archivo | Propósito |
|------|---------|-----------|
| Constantes | `constants.js` | Objeto global `K` con parciales, turnos, grados, roles, umbrales, mapeos. Un solo lugar para cambiar valores. |
| Data Store | `data-store.js` | Objeto global `Store` con cache en memoria. Evita queries redundantes entre módulos. Incluye `Store.getTeacherDocId()` centralizado. |
| Componentes UI | `components.js` | Objeto global `UI` con funciones que retornan HTML usando clases CSS del design system. |
| Design System | `styles.css` | CSS custom properties (tokens), clases utilitarias, componentes: `.module-container`, `.filter-bar`, `.table-light`, `.stat-card`, `.badge-*`, etc. |

**Roles de usuario:** admin, orientador, maestro, directivo, consulta — cada uno con permisos distintos definidos en `firestore.rules` y visibilidad de sidebar controlada por `data-roles` en HTML.

**Color primario oficial:** `#3182ce` (azul), definido en `--color-primary` en `styles.css`.

---

## 5. Colecciones en Firestore

| Colección | Propósito |
|---|---|
| `users` | Usuarios del sistema (uid, role, teacherId) |
| `teachers` | Catálogo de docentes |
| `students` | Catálogo de alumnos (con groupId) |
| `groups` | Los 18 grupos (turno + grado + letra) |
| `subjects` | Las 37 materias |
| `assignments` | Asignaciones docente-materia-grupo (211) |
| `assignmentsByGroup` | Índice inverso: grupo → docentes asignados |
| `grades` | Calificaciones (teacherId, studentId, partial, score) |
| `partials` | Estado de parciales (abierto/cerrado, locked) |
| `atRisk` | Registros de alumnos en riesgo |
| `enrollments` | Control de inscripciones |
| `config` | Configuración de la escuela (nombre, logo, metas) |
| `partialOverrides` | [v3.1] Overrides de cierre de parcial por docente (con expiración) |
| `attendance` | [v3.1] Registros de asistencia por grupo/fecha |
| `activityLog` | Auditoría de acciones (solo lectura admin, append-only) |

---

## 6. Reglas de seguridad (resumen)

Las `firestore.rules` implementan control de acceso por rol:

- **Admin:** Acceso total a todo.
- **Orientador:** Lectura de docentes, alumnos, calificaciones, inscripciones. Sin escritura de datos administrativos.
- **Maestro:** Solo puede ver/editar calificaciones de SUS asignaciones. Solo puede capturar en parciales NO bloqueados. Puede ver alumnos de los grupos que tiene asignados.
- **Bootstrap de usuarios:** Un usuario autenticado puede crear su propio doc en `users` si no existe aún (para el primer login).
- **Activity log:** Append-only, solo admin puede leer, nadie puede editar ni borrar.

### Blindaje de calificaciones v8.43 (13 de julio de 2026)

Validación server-side en `/grades` y `/studentsFinalGrades` (maestro y
orientador; admin/subdirector conservan vía libre de recuperación):

- **Identidad inmutable:** `studentId/subjectId/groupId/partial` no pueden
  cambiarse en un update (impide re-apuntar un doc a otro alumno/materia/
  parcial para brincarse candados de cierre o asignación).
- **Create bien formado:** identidad completa + docId canónico
  `{studentId}_{subjectId}_{partial}`.
- **Cotas de valores:** ec≤8, tr≤2, ex≤3, pe≤10, suma≤10, cal/value 5..10,
  faltas 0..200. Solo se validan los campos que la escritura toca — docs
  legacy con valores raros no bloquean ediciones de otros campos.
- **Coherencia suma→cal** según el redondeo oficial (≥6 redondea, <6 → 5).
- **Autoría real:** `updatedBy == uid` y `cotejoFix.by == uid` (anti-suplantación).
- 14/14 pruebas de escenarios via API firebaserules antes del deploy.

---

## 7. Sistema de agentes (carpeta _AGENTE/)

Se diseñó un sistema de orquestación con 5 sub-agentes especializados, pensado para trabajar desde Cowork/Claude Code:

| Sub-agente | Responsabilidad |
|---|---|
| **data-manager** | Extracción e importación de datos desde Excel/Sheets |
| **report-generator** | Generación de boletas, indicadores, listas oficiales |
| **system-builder** | Modificación del dashboard (HTML/JS/CSS), nuevas features, bugs |
| **security-auditor** | Auditoría de Firebase rules, API keys, permisos |
| **data-validator** | Validación de integridad de datos, detección de anomalías |

**Ubicación de los SKILL.md:** `_AGENTE/subagentes/{nombre}/SKILL.md`
**Skill del orquestador principal:** `_AGENTE/SKILL.md`
**Documentación de arquitectura:** `_AGENTE/ARQUITECTURA_ORQUESTADOR.md`

### Scripts independientes (_AGENTE/scripts/)

| Script | Función |
|---|---|
| `validar_datos.py` | Valida integridad de un Excel de control |
| `generar_reporte_indicadores.py` | Calcula indicadores institucionales desde Excel |
| `backup_firebase.py` | Respalda datos de Firestore |
| `audit_security.py` | Revisa reglas de Firebase |

*Nota: Falta `consolidar_calificaciones.js` (Apps Script para jalar datos de 73 docentes). Está documentado en `_AGENTE/referencias/SCRIPT_CONSOLIDADOR_EPO67.js`.*

---

## 8. Otros archivos importantes en la raíz

| Archivo | Descripción |
|---|---|
| `SISTEMA_FIREBASE_v13.html` | Versión monolítica anterior del dashboard (2,789 KB, todo-en-uno) |
| `SISTEMA_FIREBASE_EPO67_v13.html` | Otra versión monolítica anterior |
| `SISTEMA_ESCOLAR_EPO67.html` | Versión más antigua del sistema |
| `SISTEMA_ESCOLAR_EPO67_backup_v5.html` | Backup de versión anterior |
| `TURNO MATUTINO/` | Carpetas con controles de evaluación, listas, links por docente, indicadores, F1 |
| `TURNO VESPERTINO/` | Misma estructura que matutino |
| `_PROYECTO/` | Copias de archivos de referencia (Excel originales, documentación) |
| `_MEMORIA/` | Carpeta para datos persistentes del agente (actualmente vacía) |
| `_ENTREGABLE/` | Carpeta para outputs finales |
| `_RESPALDOS/` | Backups del skill y configuraciones |

---

## 9. Refactorización v3.0 (11 de abril de 2026)

### Qué se hizo

Se realizó una auditoría completa de mantenibilidad y se ejecutó una refactorización en 5 fases:

| Fase | Descripción | Resultado |
|---|---|---|
| **0** | Crear capa de fundación: `constants.js`, `components.js`, `data-store.js` | 3 archivos nuevos, 538 líneas de infraestructura compartida |
| **1** | Unificar colores y migrar de inline styles a clases CSS | 494 → 27 inline styles (-95%) |
| **2** | Eliminar código duplicado, conectar `K.*`, `Store.*`, `UI.*` | 40 usos de K.*, 30 usos de Store.*, 0 duplicados |
| **3** | Estandarizar patrón IIFE + event delegation en todos los módulos | 0 onclick inline, 0 window.Module hacks |
| **4** | Data layer con cache, Store.invalidateAll() en logout | Queries cacheados, invalidación post-mutación |
| **5** | Extraer Dashboard a módulo propio, limpiar app.js | app.js: 786 → 584 líneas |

### Métricas antes vs después

| Métrica | Antes (v2.0) | Después (v3.0) |
|---|---|---|
| Inline `style="..."` en JS | 494 | 27 (-95%) |
| `onclick="..."` en templates | 29 | 0 (-100%) |
| `window.Module` hacks | 3 | 0 |
| `getTeacherDocId()` copias | 3 | 1 (centralizado en Store) |
| Valores hardcodeados (P1/P2/P3, >=6, >=3) | 15+ | 0 (todos en K.*) |
| app.js líneas | 786 | 584 (-26%) |

### Bugs corregidos post-deploy
- **Scroll bloqueado:** `.main-content` tenía `overflow: hidden`, cambiado a `overflow-y: auto`
- **Clase CSS faltante:** `.assignment-grid` no existía en styles.css, agregada
- **thead sticky conflicto:** `position: sticky` global en `thead` causaba problemas de layout, eliminado

---

## 10. Control de versiones (Git)

### Estado actual

El proyecto tiene un repositorio Git inicializado en la raíz de la carpeta `ADMINISTRACIÓN ESCOLAR EPO 67/`. El repositorio está en la rama `main` con un commit inicial que incluye todos los archivos del proyecto.

| Concepto | Valor |
|---|---|
| Rama principal | `main` |
| Commit inicial | `ce06bd1` — "Commit inicial - Sistema de Administracion Escolar EPO 67" (12 abril 2026) |
| Archivos versionados | 196 |
| Remoto configurado | Ninguno (repositorio local únicamente) |
| Autor configurado | Darío \<dev.daalper@gmail.com\> |

### Ubicación del repositorio

El `.git/` vive en la raíz del proyecto:

```
ADMINISTRACIÓN ESCOLAR EPO 67/
├── .git/                          ← Repositorio Git
├── .gitignore                     ← Reglas de exclusión
├── ESTADO_DE_PROYECTO.md
├── sistema-escolar-firebase/      ← Código en producción (versionado)
├── _AGENTE/                       ← Sistema de agentes (versionado)
├── TURNO MATUTINO/                ← Datos escolares (versionados)
├── TURNO VESPERTINO/              ← Datos escolares (versionados)
└── ...
```

### .gitignore

El archivo `.gitignore` excluye:

- **macOS:** `.DS_Store`, `._*`, `.Spotlight-V100`, `.Trashes`
- **Firebase:** `sistema-escolar-firebase/.firebase/`, `sistema-escolar-firebase/node_modules/`
- **Editores:** `.vscode/`, `.idea/`, archivos swap (`*.swp`, `*.swo`)
- **Temporales:** `*.tmp`, `*.temp`, `*.log`
- **Backups automáticos:** `*~backup*`, `*.bak`

Los respaldos manuales en `_RESPALDOS/` **sí** se versionan.

### Instrucciones para Claude Code

**IMPORTANTE — Unicode NFD/NFC:** El nombre de la carpeta contiene "ADMINISTRACIÓN" que macOS almacena en NFD (la `Ó` se descompone en `O` + combining accent). Desde bash en el sandbox Linux, usar glob para navegar al directorio:

```bash
cd "/ruta/a/ADMINISTRACI"*"N ESCOLAR EPO 67 "
```

O usar `find` para localizar la carpeta:

```bash
find /ruta -maxdepth 1 -name "ADMINISTRACI*N ESCOLAR*" -type d
```

**Comandos Git esenciales para este proyecto:**

```bash
# Ver estado actual
git status

# Ver historial de commits
git log --oneline

# Agregar cambios y hacer commit (después de modificar archivos)
git add -A
git commit -m "Descripción clara del cambio"

# Ver qué archivos cambiaron
git diff --stat

# Ver cambios específicos en un archivo
git diff sistema-escolar-firebase/public/js/modules/students.js

# Revertir un archivo a su último commit (descartar cambios locales)
git checkout -- ruta/al/archivo

# Ver archivos versionados
git ls-files

# Ver archivos no rastreados
git ls-files --others --exclude-standard
```

**Convención de commits para este proyecto:**

Los mensajes de commit deben seguir este formato:

```
[módulo/área] Descripción concisa del cambio

Ejemplos:
  [students] Agregar validación de CURP en modal de edición
  [firestore.rules] Permitir lectura de attendance a orientadores
  [indicadores] Corregir cálculo de tasa de reprobación
  [styles] Agregar clases para badges de asistencia
  [deploy] Actualizar script REDESPLEGAR.command
  [docs] Actualizar ESTADO_DE_PROYECTO.md
  [git] Actualizar .gitignore
  [config] Cambiar umbral de riesgo en constants.js
  [import] Mejorar matching fuzzy en import-grades
  [multi] Refactorizar data-store + actualizar módulos dependientes
```

**Flujo de trabajo recomendado para Claude Code:**

1. **Antes de editar:** Ejecutar `git status` para verificar que el working tree está limpio.
2. **Después de editar:** Ejecutar `git diff --stat` para revisar los archivos modificados.
3. **Antes de hacer commit:** Verificar que los cambios son correctos con `git diff`.
4. **Hacer commit:** `git add -A && git commit -m "[módulo] Descripción"`.
5. **Después de deploy:** Hacer commit con `[deploy] Desplegar vX.X a Firebase`.
6. **Nunca hacer force push** ni reescribir historial — este repo es solo local por ahora.

**Archivos que se modifican con más frecuencia (priorizar en commits):**

| Archivo | Razón de cambio frecuente |
|---------|--------------------------|
| `sistema-escolar-firebase/public/js/modules/*.js` | Nuevas features, bug fixes en módulos |
| `sistema-escolar-firebase/public/css/styles.css` | Nuevos componentes visuales, ajustes de layout |
| `sistema-escolar-firebase/public/index.html` | Nuevos scripts, ítems de sidebar |
| `sistema-escolar-firebase/firestore.rules` | Nuevas reglas de seguridad por colección/rol |
| `sistema-escolar-firebase/public/js/constants.js` | Nuevas constantes, umbrales, mapeos |
| `sistema-escolar-firebase/public/js/data-store.js` | Nuevos métodos de cache |
| `ESTADO_DE_PROYECTO.md` | Documentar avances y cambios |

### Pendientes de Git

- **Configurar remoto:** No hay remoto configurado. Si se desea respaldar en GitHub/GitLab, ejecutar:
  ```bash
  git remote add origin https://github.com/usuario/repo.git
  git push -u origin main
  ```
- **Ramas de feature:** Actualmente todo se trabaja en `main`. Para features grandes, considerar crear ramas:
  ```bash
  git checkout -b feature/nombre-de-feature
  # ... trabajar ...
  git checkout main
  git merge feature/nombre-de-feature
  ```

---

## 11. Issues conocidos y pendientes

### Bugs / Issues técnicos (nota: el issue de Unicode NFD/NFC también aplica a Git, ver sección 10)
- **Unicode NFD/NFC en el nombre de la carpeta:** macOS usa NFD para "ADMINISTRACIÓN", el sandbox Linux usa NFC. Al copiar archivos desde scripts, siempre usar `find -exec` para detectar ambas variantes.
- **Firebase Storage NO configurado:** El upload de logo en school-config no funciona porque Storage no está activo.
- **Bootstrap rule en users:** Cualquier usuario autenticado puede crear su propio doc. Esto es intencional para el primer login, pero puede ser un vector si no se vigila.

### Features pendientes
- **Consolidador de datos desde Sheets:** El script Apps Script (`SCRIPT_CONSOLIDADOR_EPO67.js`) está documentado pero no integrado como un flujo automatizado.
- ~~**Dashboard de indicadores institucionales en tiempo real:**~~ Implementado en v3.1 (`indicadores.js`).
- ~~**Boletas (report cards):**~~ Implementado en v3.1 (`boletas.js`).
- **Sistema de notificaciones para docentes.**

### Mejoras deseables
- Implementar backup automático de Firestore.
- ~~Agregar módulo de indicadores institucionales~~ (implementado en v3.1).
- ~~Agregar generación de boletas desde el dashboard web~~ (implementado en v3.1).
- Migrar Firebase SDK de compat (v8 API) a modular (v9) para tree-shaking.

---

## 12. Cómo trabajar en este proyecto

### Para desarrollar localmente
El sistema es estático (no requiere build). Editar los archivos en `sistema-escolar-firebase/public/` y ver en navegador o desplegar a Firebase.

### Para desplegar
1. Desde `sistema-escolar-firebase/`: `npx firebase-tools deploy --only hosting`
2. O en Mac: doble clic en `REDESPLEGAR.command`
3. Nota: Firebase CLI no está instalado globalmente, usar `npx firebase-tools` para ejecutar comandos.

### Para agregar un nuevo módulo
1. Crear `public/js/modules/mi-modulo.js` siguiendo el patrón IIFE:
   ```js
   const MiModulo = (() => {
     async function render() { ... }
     function bindEvents() { ... }
     return { render };
   })();
   Router.modules['mi-modulo'] = () => MiModulo.render();
   ```
2. Agregar `<script src="/js/modules/mi-modulo.js?v=X.X"></script>` en `index.html`
3. Agregar link en sidebar de `index.html` con `data-module="mi-modulo"` y `data-roles="admin"` (o el rol correspondiente)
4. Usar clases CSS de `styles.css` (nunca inline styles)
5. Usar `K.*` para constantes, `Store.*` para datos, `Utils.sanitize()` para texto de usuario

### Para cambiar una constante global
Editar `public/js/constants.js`. Ejemplo: cambiar umbral de riesgo de 3 a 4 materias:
```js
THRESHOLDS: Object.freeze({
  PASS_GRADE: 6,
  AT_RISK_SUBJECTS: 4  // era 3
})
```

### Para Claude Code
Este proyecto se puede abrir directamente en Claude Code apuntando a la carpeta `sistema-escolar-firebase/` para trabajo de código, o a la raíz `ADMINISTRACIÓN ESCOLAR EPO 67/` para contexto completo incluyendo los agentes y datos.

---

## 13. Estructura de carpetas (resumen visual)

```
ADMINISTRACIÓN ESCOLAR EPO 67/
├── sistema-escolar-firebase/      ← CÓDIGO EN PRODUCCIÓN (v3.1)
│   ├── public/                    ← Frontend (SPA)
│   │   ├── index.html
│   │   ├── css/styles.css         ← Design system completo
│   │   └── js/
│   │       ├── firebase-config.js ← Firebase init
│   │       ├── constants.js       ← K.* constantes centralizadas
│   │       ├── data-store.js      ← Store.* cache de datos
│   │       ├── components.js      ← UI.* componentes reutilizables
│   │       ├── app.js             ← Core: Auth, Router, Modal, Toast, Utils
│   │       └── modules/           ← 18 módulos IIFE auto-registrados
│   ├── firestore.rules            ← Seguridad
│   └── REDESPLEGAR.command        ← Deploy rápido
├── _AGENTE/                       ← Sistema de agentes IA
│   ├── SKILL.md                   ← Orquestador principal
│   ├── ARQUITECTURA_ORQUESTADOR.md
│   ├── subagentes/                ← 5 sub-agentes especializados
│   ├── scripts/                   ← Scripts Python independientes
│   └── referencias/               ← Docs y script consolidador
├── _PROYECTO/                     ← Archivos de referencia (Excel, docs)
├── _MEMORIA/                      ← Datos persistentes
├── _ENTREGABLE/                   ← Outputs finales
├── _RESPALDOS/                    ← Backups
├── TURNO MATUTINO/                ← Controles, listas, links del turno
├── TURNO VESPERTINO/              ← Controles, listas, links del turno
└── *.html                         ← Versiones monolíticas anteriores del sistema
```

---

## 14. Actualización v3.1 (11 de abril de 2026)

La versión 3.1 amplió significativamente el sistema con 7 módulos nuevos, CRUD completo en módulos existentes, importación de datos desde Excel, y corrección de bugs de la v3.0. El total de código JS pasó de ~4,350 a ~9,010 líneas.

### Fase 1: Bug Fixes

| Fix | Detalle |
|-----|---------|
| Modal roto | `class="modal-card"` corregido a `class="modal"` en `index.html`. Los modales no se mostraban por clase CSS incorrecta. |
| Modal.close() bloqueado | Se simplificó `Modal.close()` eliminando un event guard que impedía el cierre con botones de cerrar/cancelar. |
| Filtros de alumnos independientes | Los selectores turno, grado y grupo ahora son dependientes en cascada: cambiar turno resetea grado y grupo, cambiar grado resetea grupo. |

### Fase 2: CRUD en módulos existentes

**students.js** (547 -> 887 líneas):
- Modal de edición de alumno (edit inline con campos pre-llenados)
- Eliminación con motivo (delete with reason)
- Baja (withdrawal) con motivo, detalle y dropdown de razones predefinidas

**teachers.js** (418 -> 1,017 líneas):
- CRUD completo: crear, editar, eliminar docentes
- Ordenamiento A-Z por nombre
- Filtro por turno
- Editor de asignaciones por docente (asignar/desasignar materias y grupos)
- Asignación de orientador por grupo
- Tab de materias muestra docentes asignados
- Tab de asignaciones con buscador, filtros y CRUD

**enrollment.js** (395 -> 411 líneas):
- Campos nuevos: `tutorNombre`, `direccionContacto`, `telefonoContacto`

**partial-close.js** (147 -> 342 líneas):
- Override por docente individual (con fecha de expiración)
- Cierres programados (scheduled closes)
- UI de gestión de overrides activos

**grades.js** (531 -> 557 líneas):
- `saveGrades()` ahora verifica si existe un override activo para el docente antes de bloquear por parcial cerrado

**firestore.rules** (146 -> 173 líneas):
- Reglas para la colección `partialOverrides`
- Reglas para la colección `attendance`

### Fase 3: Importación de datos

**import-grades.js** (NUEVO, 695 líneas):
- Importar calificaciones desde archivos Excel (.xlsx)
- Mapeo de columnas configurable (el usuario asigna columnas del Excel a campos del sistema)
- Matching fuzzy de alumnos por nombre
- Vista previa de datos antes de importar
- Importación por lotes (batch import) a Firestore

**import-students.js** (NUEVO, 249 líneas):
- Importar datos de alumnos desde listas oficiales (Excel)
- Match por CURP, expediente o nombre
- Llenado de campos faltantes en registros existentes

### Fase 4: Módulos nuevos

**boletas.js** (NUEVO, 576 líneas):
- Boletas (report cards) por alumno individual o por grupo completo
- Visualización por parcial: P1, P2, P3 y Final
- Impresión directa desde el navegador
- Exportación de datos

**indicadores.js** (NUEVO, 494 líneas):
- Dashboard de indicadores institucionales
- Promedio general vs meta institucional
- Tasa de reprobación vs meta
- Gráficas de barras CSS por grupo y por materia
- Comparación visual con umbrales definidos en school-config

**concentrado.js** (NUEVO, 485 líneas):
- Matriz de concentración de calificaciones (alumnos x materias)
- Código de colores por rango de calificación
- Estadísticas por fila y columna (promedios, aprobados/reprobados)
- Exportación de datos

**attendance.js** (NUEVO, 383 líneas):
- Control de asistencia por grupo y fecha
- El maestro registra: presente, ausente, retardo
- Vista admin con resumen y porcentaje de asistencia por grupo
- Colección Firestore: `attendance`

**reports-comparative.js** (NUEVO, 359 líneas):
- Reportes comparativos con múltiples dimensiones: por grupo, por materia, por turno, por parcial
- Tablas comparativas con estadísticas
- Gráficas de barras para visualización

### Resumen de cambios en arquitectura

| Métrica | v3.0 | v3.1 |
|---------|------|------|
| Archivos JS | 16 | 23 (+7) |
| Módulos en `modules/` | 11 | 18 (+7) |
| Total líneas JS | ~4,350 | ~9,010 (+107%) |
| Colecciones Firestore | 13 | 15 (+2) |
| `firestore.rules` líneas | 146 | 173 |
| `index.html` líneas | 183 | 228 |
| `styles.css` líneas | 1,950 | 2,237 |

### Módulos nuevos en v3.1

| Módulo | Líneas | Rol(es) con acceso |
|--------|--------|--------------------|
| `import-grades.js` | 695 | admin |
| `boletas.js` | 576 | admin, orientador |
| `indicadores.js` | 494 | admin, orientador, directivo |
| `concentrado.js` | 485 | admin, orientador |
| `attendance.js` | 383 | admin, orientador, maestro |
| `reports-comparative.js` | 359 | admin, orientador |
| `import-students.js` | 249 | admin |

### Colecciones Firestore nuevas

| Colección | Propósito |
|-----------|-----------|
| `partialOverrides` | Override de cierre de parcial por docente individual, con campo de expiración |
| `attendance` | Registros de asistencia: grupo, fecha, alumno, estado (presente/ausente/retardo), registrado por |

### Sidebar actualizado

Se agregaron todos los nuevos ítems de navegación en el sidebar de `index.html`, con atributos `data-roles` correspondientes para admin, orientador y maestro.
