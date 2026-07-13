---
name: epo67-sistema
description: Contexto compacto para trabajar en el Sistema Escolar EPO 67 sin releer todo el repositorio.
---

# EPO 67 Sistema Escolar

## Lectura mínima al iniciar

1. `AGENTS.md`
2. `CLAUDE.md`
3. `.agents/README.md`
4. `.agents/memory/PROJECT_STATE.md`
5. El brief de `.agents/agents/` que corresponda a la tarea

## Estado técnico actual

- App SPA vanilla JS en `sistema-escolar-firebase/public/`.
- Firebase Hosting + Firestore + Auth compat.
- Sin frameworks, sin build tools, sin migrar SDK modular.
- Módulos IIFE en `public/js/modules/`.
- Design system en `public/css/styles.css`.
- Cache obligatorio: al editar JS/CSS, subir `?v=` en `public/index.html` y `SW_VERSION` en `public/sw.js`.

## Reglas críticas

- No tocar `firestore.rules` sin autorización explícita.
- No borrar datos reales sin confirmación explícita.
- Para maestros usar `Store.getMyAssignments()`, `Store.getStudentsByGroup()` o `Store.getStudentsByGroups()`.
- Nunca usar estilos inline nuevos si puede ir al design system.
- Event delegation con `data-action`; evitar `onclick` nuevo.
- Sanitizar texto de usuario con `Utils.sanitize()`.
- Scripts admin en `sistema-escolar-firebase/scripts/{audits,fixes,migrations}/`.

## Archivos calientes

- Calificaciones/listas: `public/js/modules/grades.js`
- Cache y queries role-aware: `public/js/data-store.js`
- Shell y versiones: `public/index.html`, `public/sw.js`
- Estilos: `public/css/styles.css`

## Agentes locales

- `system-builder`: cambios de código y UI.
- `data-validator`: auditorías de datos y consistencia.
- `report-generator`: impresión, boletas, concentrados y exportes.
- `security-auditor`: permisos y riesgos.
- `data-manager`: scripts de importación/migración.
