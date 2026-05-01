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
- **Version actual:** v5.10-maestro

## Personal directivo (en config/school.staff)

- **Directora Escolar:** Dra. Karina Ilusion Laguerenne Chiquete (rol `admin`)
- **Subdirector:** Profr. Octavio Vazquez Barreto (rol `admin`)
- **Secretario Escolar:** Profr. Roberto Palomares Mejia (rol `admin`)
- **Secretaria Administrativa:** Lupita [apellidos pendientes] (rol `directivo`)
- **Admin del sistema:** Olivia Pena Ramirez (rol `admin`, tambien docente)

Las plantillas (boletas, concentrados, correcciones) leen estos nombres de
`config/school.staff` via `App.staffName('director')` / `App.staffCargo('director')`.
Cambio del director = solo actualizar el documento Firestore.

## Datos de la escuela

- ~811 alumnos registrados (~368 activos), 2 turnos (matutino/vespertino)
- 60 docentes activos (despues de merge de duplicados v5.10), 18 grupos
- 3 parciales por semestre
- Metas: Promedio >=8.3, Asistencia >=80%, Reprobacion <=14%

## Stack tecnico

- **Frontend:** Vanilla JavaScript SPA (sin frameworks). HTML + CSS + JS modular.
- **Backend:** Firebase (Hosting + Firestore + Auth con email/password). Sin servidor propio.
- **Service Worker** activo (`public/sw.js`) con `SW_VERSION` — bumpear al cambiar JS/CSS.
- **Despliegue:** `npx firebase-tools deploy --only hosting` desde `sistema-escolar-firebase/`

⚠️ **Tras editar JS/CSS: bumpear `SW_VERSION` en `public/sw.js` Y los `?v=X.X` en `index.html`.**
Sin esto, los usuarios siguen viendo codigo viejo (cache-first del SW para assets).

## Arquitectura del codigo

### Capas compartidas

| Capa | Archivo | Objeto global | Proposito |
|------|---------|---------------|-----------|
| Constantes | `constants.js` | `K` | Parciales, turnos, grados, roles, umbrales |
| Data Store | `data-store.js` | `Store` | Cache en memoria de Firestore |
| Componentes | `components.js` | `UI` | Funciones que retornan HTML reutilizable |
| Core | `app.js` | `App, Auth, Router, Modal, Toast, Utils` | SPA core |
| Estilos | `styles.css` | CSS custom properties | Design system con tokens |

### API del Store (data-store.js) — IMPORTANTE para nuevos modulos

| Metodo | Para que rol | Que hace |
|---|---|---|
| `Store.getStudents()` | admin/orientador/directivo | TODOS los alumnos (RECHAZADO para maestro) |
| `Store.getStudentsByGroup(gid)` | cualquier rol | Alumnos de UN grupo (firestore.rules friendly) |
| `Store.getStudentsByGroups(gids)` | cualquier rol | Alumnos de varios grupos (paralelo) |
| `Store.getStudentsForUser()` | role-aware | Resolucion automatica segun rol del usuario |
| `Store.getAssignments()` | admin/orientador/directivo | TODAS las assignments (RECHAZADO para maestro) |
| `Store.getMyAssignments()` | role-aware | Mis assignments (filtra por teacherId si maestro) |
| `Store.getTeacherDocId()` | maestro | uid → teacherId del docente. Lee `teacherId` o `teacherDocId` |
| `Store.getGradesByGroup(gid)` | cualquier autenticado | Grades de un grupo |
| `Store.getGradesByGroupAndPartial(gid, p)` | cualquier autenticado | Grades de un grupo en parcial X |

**REGLA DE ORO:** Si un modulo va a ser usado por maestros, NO uses `Store.getStudents()` ni
`Store.getAssignments()` directamente — usa los helpers role-aware. Las firestore.rules
rechazan queries globales para maestros.

### Helpers de App (app.js)

- `App.staffName(role)` — "DRA. KARINA…" (role: 'director'/'subdirector'/'secretario')
- `App.staffCargo(role)` — "DIRECTORA ESCOLAR" 
- `App.canActAs(targetRole)` — considera ROLE_INHERITS (orientador_docente puede actuar como maestro y como orientador)
- `Utils.displayName(nombre)` — "APELLIDO1 APELLIDO2 NOMBRES" → "NOMBRES APELLIDO1 APELLIDO2"
- `Utils.shortName(nombre)` — "NOMBRE APELLIDO1" (compacto, para celdas)
- Manejan apellidos compuestos (DE LA TORRE, DE LOERA) y abreviaciones (MA., JOSE.)

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

### Modulos clave (selectos)

| Modulo | Nota |
|---|---|
| `dashboard.js` | Role-aware: maestro ve dashboard simplificado con sus asignaciones |
| `grades.js` | Editor con PESTAÑAS de asignaciones del maestro (✅⚠️❌ + count). Cache local. Paste arregla bug de vacios |
| `teachers.js` | CRUD docentes, asignaciones, orientadores. Lista hardcoded ORIENTADOR_NAMES |
| `my-lists.js` | Listas de alumnos del maestro (usa getMyAssignments + getStudentsByGroup) |
| `attendance.js` | Asistencia (usa getMyAssignments + getStudentsByGroup) |
| `student-profile.js` | Consulta por alumno (filtrado por grupos del maestro) |
| `at-risk.js` | Renderiza vista admin/orientador/maestro segun rol. Maestro: query con teacherId |
| `boleta-oficial.js`, `boletas.js`, `concentrado.js` | Firmas leen de `App.staffName()` |

## Colecciones en Firestore

`users`, `teachers`, `students`, `groups`, `subjects`, `assignments`, `assignmentsByGroup`,
`grades`, `partials`, `atRisk`, `enrollments`, `config`, `partialOverrides`, `attendance`,
`activityLog`, `gradeCorrections`, `emailAlerts`, `incidents`, `notifications`,
`teacherHours`

## Roles de usuario (firestore.rules)

- **admin** — Acceso total (Karina, Octavio, Roberto, Olivia)
- **directivo** — Lectura completa + reportes/email-alerts. NO captura calificaciones (Lupita)
- **orientador_docente** — HIBRIDO: maestro + orientador. Captura SUS calificaciones Y accede a seccion orientacion
- **orientador** — Lectura amplia, gestiona at-risk. NO captura calificaciones
- **maestro** — Captura SOLO sus assignments, parciales NO bloqueados. Lee solo SUS alumnos
- **consulta** — Solo lectura general

`K.ROLE_INHERITS`: orientador_docente hereda permisos de maestro+orientador.
`firestore.rules` tiene helpers `canMaestro()` / `canOrientador()` que aplican el hibrido.

## Asignacion automatica de roles (create-teacher-users.js)

El script lee teachers de Firestore + config/school.staff y asigna:

1. **Personal directivo (config/school.staff)** → rol del campo `role` (default 'admin')
2. **Nombre en ADMIN_NAMES** (ej. PEÑA RAMIREZ OLIVIA) → 'admin'
3. **Nombre en CONSULTA_NAMES** (VALDES ESCALONA ROSALVA) → 'consulta'
4. **En ORIENTADOR_NAMES + tiene assignments** → 'orientador_docente'
5. **En ORIENTADOR_NAMES + sin assignments** → 'orientador'
6. **Otros docentes** → 'maestro'

Los hibridos detectados en datos actuales: 7 docentes (Cedillo Ivonne mat+orient vesp,
Correa Salgado, Martinez Laurita, Rangel Juana, Garcia Beatriz, Rodriguez Fernanda, Salazar Edgar).

## Rubros de evaluacion

- **MATUTINO**: EC (max 8) + Transversal (max 2) + P.Extra = Suma → Calif
- **VESPERTINO**: EC (max 5) + Examen (max 3) + Transversal (max 2) + P.Extra = Suma → Calif
- **Redondeo**: ≥6 redondeo normal, <6 se trunca (5.9→5). Min 5, Max 10.

## Convenciones

- Prefijos: `K.` constantes, `Store.` cache, `UI.` componentes, `App.*` core
- Sanitizar texto de usuario: `Utils.sanitize()`
- Nombres de docentes en pantalla: SIEMPRE `Utils.displayName(t.nombre)` (formato Nombre+Apellidos)
- Color primario: `#3182ce` (var `--color-primary`)
- Archivos de modulo: kebab-case
- Sin frameworks, sin build tools, sin bundlers

## Convenciones de Git

```
[modulo/area] Descripcion concisa

Ejemplos:
  [grades] Pestañas de asignaciones en editor de captura
  [data-store] getMyAssignments + getStudentsByGroup role-aware
  [config/school] Cargar staff con directora Karina
  [v5.10] Bump SW_VERSION para forzar refresh global del cache
```

## Despliegue

```bash
# 1. Hacer cambios en JS/CSS
# 2. Bumpear SW_VERSION en public/sw.js (ej: v5.10 → v5.11)
# 3. Bumpear ?v= en public/index.html (sed -i '' -E 's/\?v=5\.10[^"]*/?v=5.11/g' public/index.html)
# 4. Deploy
cd sistema-escolar-firebase
npx firebase-tools deploy --only hosting
# O en Mac: doble clic en REDESPLEGAR.command
```

## Scripts admin (sistema-escolar-firebase/scripts/)

| Categoria | Script | Proposito |
|---|---|---|
| migrations | `create-teacher-users.js` | Genera Auth + users docs con rol correcto. Procesa teachers + config/school.staff. Soporta `--dry-run` y `--only=<id>` |
| migrations | `migrate-from-drive.js` | Importacion historica de 73 hojas Drive |
| fixes | `merge-duplicate-teachers.js` | Fusion idempotente de docentes con turnos duplicados (1 record con turno=AMBOS) |
| audits | `audit-teachers.js`, `diagnose-grades.js` | Solo lectura |

⚠️ Token OAuth para los scripts: `/tmp/firebase-access-token.txt`. Refrescar con `npx firebase-tools projects:list`.

## Casos especiales conocidos

- **Apellidos compuestos:** GRANADOS DE LOERA, HERNANDEZ DE JESUS, etc. — `Utils.displayName` los maneja con conectores DE/DEL/LA/LOS/Y
- **Abreviaciones de nombre:** MA., JOSE. — se interpretan como nombre, no apellido
- **Docentes con multiples turnos:** unificados via `merge-duplicate-teachers.js`. Turno = 'AMBOS'
- **Orientador en grupos sin teacherId:** `groups.orientador` guarda el nombre limpio (sin "PROFR./PROFRA.") pero a veces no enlaza el teacherId. Matching tolerante en `_namesMatch` (>=2 palabras significativas comunes).

## Notas importantes

- Carpeta del proyecto contiene caracteres Unicode (ADMINISTRACION con tilde) — terminales pueden quejarse
- Firebase Storage NO esta configurado (logo upload no funciona)
- Firebase SDK usa version compat (v8). Pendiente migrar a modular (v9)
- Usuarios sin email real (en proceso): correos sinteticos `apellido.nombre@epo67.local`
- Bug historico arreglado: `users-mgmt.js:147` creaba docs con docId basado en email — incorrecto. La identidad correcta es `users/{uid}` con `teacherId` apuntando a teacher record
- Documentos huerfanos en `users` (id ≠ uid) detectados pero NO borrados por seguridad

## Documentacion adicional

- `AGENTS.md` (raiz) — Reglas inviolables para agentes IA
- `ESTADO_DE_PROYECTO.md` — Estado completo del proyecto, historia de versiones
- `_AGENTE/ARQUITECTURA_ORQUESTADOR.md` — Sistema de agentes IA
- `sistema-escolar-firebase/scripts/README.md` — Scripts administrativos
