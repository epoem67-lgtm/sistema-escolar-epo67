# ARQUITECTURA — Sistema EPO 67

## Vista general

SPA vanilla JavaScript servida por Firebase Hosting, con Firestore como única fuente de verdad.
**Sin frameworks. Sin build tools. Sin bundlers.**

```
Browser (SPA)
  │
  ├── firebase-config.js      ← init Firebase compat v8
  ├── constants.js (K)        ← parciales, turnos, grados, umbrales
  ├── data-store.js (Store)   ← cache in-memory de Firestore
  ├── components.js (UI)      ← helpers que retornan HTML
  ├── app.js                  ← App, Auth, Router, Modal, Toast, Utils
  └── modules/*.js            ← 23 módulos IIFE auto-registrados
                 │
                 ▼
         Firestore (14 colecciones)
```

## Capas

| Capa | Archivo | Global | Responsabilidad |
|---|---|---|---|
| Firebase | `firebase-config.js` | `firebase`, `db`, `auth` | SDK compat v8 |
| Constantes | `constants.js` | `K` | Todo lo hardcodeado va aquí |
| Cache | `data-store.js` | `Store` | Invalidable con `force=true` |
| UI helpers | `components.js` | `UI` | Badges, cards, empty-states |
| Core SPA | `app.js` | `App, Auth, Router, Modal, Toast, Utils` | Hash routing, modal stack, toasts |
| Módulos | `modules/*.js` | IIFE privado | Una feature por archivo |

## Patrón de módulo

```js
// modules/my-module.js
const MyModule = (() => {
  const state = { /* privado */ };

  async function load() {
    await Store.getStudents(); // usa cache; force=true para refrescar
  }

  function render() {
    const container = document.getElementById('app-content');
    container.innerHTML = `<div class="card">…</div>`;
    bindEvents(container);
  }

  function bindEvents(container) {
    container.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'do-x') handleX();
    });
  }

  return { render };
})();

Router.modules['my-module'] = () => MyModule.render();
```

Reglas:
- **IIFE**: estado privado, exponer solo `{ render }` (y quizá `refresh`).
- **Event delegation**: un solo listener en container, despachar por `data-action`.
- **Sin inline handlers**: jamás `onclick="..."` en strings HTML.
- **Sin estilos inline**: usar clases del design system.
- **Sanitizar**: `Utils.sanitize(s)` en cualquier string de usuario antes de interpolar.

## Routing

Hash-based. `#/dashboard` ejecuta `Router.modules['dashboard']()`. El shell (`index.html`) no cambia; solo `#app-content`.

## Datos: cache y sincronía

- `Store.getX()` → devuelve array cacheado o lo trae de Firestore.
- `Store.getX(true)` → fuerza fetch.
- Tras escribir en Firestore, el módulo que escribió debe pedir `force=true` para refrescar su vista.
- **Limitación conocida**: otros módulos abiertos en paralelo pueden mostrar datos stale hasta su siguiente render. No hay invalidación cross-module automática.

## Roles

Ver `AGENTS.md` raíz. Los roles viven en `users/{uid}.role`. La seguridad efectiva está en `firestore.rules` — `data-roles` en sidebar es solo UX.

## Rubros de evaluación (importante)

- **MATUTINO**: EC (≤8) + Transversal (≤2) + P.Extra → suma → calif
- **VESPERTINO**: EC (≤5) + Examen (≤3) + Transversal (≤2) + P.Extra → suma → calif
- **Redondeo**: ≥6 normal, <6 se trunca (5.9 → 5). Máximo 10.

Lógica en `grades.js`. Cualquier cambio en este cálculo afecta boletas, concentrado, indicadores y at-risk.

## Módulos (23)

Ver `CLAUDE.md` raíz para tabla completa.

Módulos críticos:
- **grades.js** (2192 líneas) — candidato a refactor; split sugerido: teacher / admin / common.
- **teachers.js** (1076 líneas, post-cleanup v5.9) — CRUD docentes + carga académica.
- **students.js** (887 líneas) — bajas soft con motivo.

## Despliegue

```bash
cd sistema-escolar-firebase
npx firebase-tools deploy --only hosting
```

Versionar `<script src="...?v=X.Y">` en `index.html` para romper cache.
