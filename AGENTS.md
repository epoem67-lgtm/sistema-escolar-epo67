# AGENTS.md — Reglas para agentes IA en este repositorio

Este archivo complementa `CLAUDE.md`. Aplica a **cualquier agente** (Claude Code, Codex, Cursor, etc.) que trabaje sobre el sistema escolar EPO 67.

## Reglas inviolables

1. **Commit antes de operaciones masivas.** Nunca mutar datos en Firestore ni refactorizar >200 líneas sin un commit previo del estado actual.
2. **Nunca borrar datos sin confirmación explícita del usuario.** Las eliminaciones deben usar `estado: 'baja'` (soft delete) y `motivoBaja`, no `delete()`.
3. **No modificar `firestore.rules` sin autorización explícita.** Un cambio errado puede exponer datos de 811 alumnos o bloquear al admin.
4. **No tocar credenciales.** Tokens de Firebase viven en `~/.config/firebase/`; nunca committearlos ni copiarlos a archivos.
5. **Refrescar token antes de scripts:** `npx firebase-tools projects:list` si un script falla silenciosamente.

## Antes de escribir código

- Leer `CLAUDE.md` (raíz) y `sistema-escolar-firebase/CLAUDE.md` si existe.
- Revisar `docs/ARCHITECTURE.md` para patrón IIFE y capas.
- Respetar el design system (`styles.css`) — **nunca** estilos inline.
- Event delegation con `data-action`; **nunca** `onclick` inline.
- Sanitizar user input con `Utils.sanitize()` antes de renderizar.

## Convenciones de cache

- `Store.getX(force=true)` cuando se acaba de escribir y se necesita recomputar.
- Subir `index.html` `?v=X.Y` al desplegar cambios de JS para romper cache del navegador.

## Scripts de administración

Van en `sistema-escolar-firebase/scripts/{audits,fixes,migrations}/`. Ver `scripts/README.md`.

- **audits/** solo lee — ejecutar primero para diagnóstico.
- **fixes/** idempotente — seguro si se re-ejecuta.
- **migrations/** única ejecución por ciclo escolar.

## Roles y permisos

| Rol | Lectura | Escritura |
|---|---|---|
| `admin` | Todo | Todo |
| `directivo` | Indicadores, reportes, correcciones | Correcciones de calificaciones, notificaciones |
| `orientador` | Docentes, alumnos, calificaciones, inscripciones, incidencias | Incidencias, at-risk |
| `maestro` | Sus asignaciones, sus alumnos | Calificaciones (solo parcial abierto), asistencia, horas, incidencias |
| `consulta` | Lectura general | — |

La visibilidad del sidebar se controla con `data-roles` en `index.html`.
**El `data-roles` es solo UX** — la seguridad real está en `firestore.rules`.

## Deploy

```bash
cd sistema-escolar-firebase
npx firebase-tools deploy --only hosting
# o en Mac: REDESPLEGAR.command
```

Subir versión en `public/index.html` (`?v=X.Y`) en cada deploy de JS.

## Commits

Formato: `[modulo] Descripción concisa`

Ejemplos:
- `[teachers] Eliminar dead code de asignaciones v1`
- `[security] Endurecer rules de grades`
- `[scripts] Reorganizar scripts en subcarpetas`

## Qué NO hacer

- ❌ Agregar frameworks (React, Vue, etc.) — el proyecto es vanilla JS intencionalmente.
- ❌ Agregar build tools (webpack, vite). Los JS se sirven tal cual.
- ❌ Migrar Firebase SDK a modular (v9) sin plan explícito — hay 23 módulos que usan compat (v8).
- ❌ Usar `innerHTML` con datos sin sanitizar.
- ❌ Commitear archivos `.key`, `.pem`, `service-account*.json`.
- ❌ Bloquear a admins con cambios de rules sin probar primero en emulator.
