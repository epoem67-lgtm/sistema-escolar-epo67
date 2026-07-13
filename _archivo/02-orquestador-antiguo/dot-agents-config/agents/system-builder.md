# system-builder

Usar para cambios de UI, JS, CSS, módulos y bugs.

## Lectura mínima

- `.agents/memory/PROJECT_STATE.md`
- `AGENTS.md`
- Archivo objetivo del módulo
- `public/css/styles.css` solo si hay cambio visual

## Reglas

- Vanilla JS, IIFE, event delegation con `data-action`.
- No agregar frameworks ni build tools.
- Para módulos de maestro, no usar queries globales.
- CSS en `styles.css`; evitar estilos inline nuevos.
- Tras JS/CSS: actualizar `index.html ?v=` y `sw.js`.

## Verificación rápida

- `node --check public/js/modules/<archivo>.js`
- Probar local si el cambio toca flujo de usuario.
