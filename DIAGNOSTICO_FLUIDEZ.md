# Diagnóstico de fluidez — por qué la app "se traba"

> Auditoría multi-agente + verificación manual · 2026-06-24 · Sistema Escolar EPO 67
> Síntoma reportado: "de repente en cualquier módulo se traba; quiero ver usuarios y se traba;
> cambio de módulo y se traba; tengo que refrescar."

Este documento clasifica las causas por **impacto real** y separa lo **CONFIRMADO** (leído y
verificado en el código) de lo **REPORTADO** (señalado por agentes, plausible, no verificado a fondo).
Cada punto trae archivo:línea y un estado de fix.

---

## TL;DR — las 3 causas raíz reales

1. **Recarga forzada del Service Worker a media sesión** (CONFIRMADO, severidad ALTA).
   Cada 2 min la app busca versión nueva y, si la hay, se **auto-recarga sola**. Con despliegues
   frecuentes, el usuario es expulsado a media captura. → **Es la causa #1 del "se traba y refresco".**
2. **Sin limpieza al cambiar de módulo** (CONFIRMADO, severidad ALTA).
   `Router.navigate` no "desmonta" el módulo anterior: timers (`setInterval`) y listeners
   delegados sobre `#moduleContainer` se **acumulan** en cada visita → lentitud progresiva.
3. **Acumulación de listeners por re-render** (CONFIRMADO en varios módulos, severidad MEDIA-ALTA).
   Módulos que re-renderizan en cada filtro/búsqueda vuelven a hacer `addEventListener` sin
   quitar los viejos → cada tecla deja listeners "fantasma".

El resto (loops N² en dashboard, render de tablas grandes, falta de try/catch en algunos
`render()`) son reales pero secundarios frente a estos tres.

---

## 1. Recarga forzada del SW (CONFIRMADO · ALTA)

**Archivos:** `public/index.html:600-670`, `public/sw.js:76-88`.

Mecanismo verificado:
- `index.html:660` — `setInterval(checkUpdate, 120*1000)` + en `visibilitychange`/`online`.
- `checkUpdate` → `reg.update()` (`index.html:648-653`).
- Al instalarse un SW nuevo: `statechange='installed'` → `postMessage('SKIP_WAITING')` (`index.html:632-639`).
- `sw.js:44-46` aplica `skipWaiting()`; al activar, `sw.js:81-86` manda `SW_ACTIVATED_RELOAD` a TODOS los clientes.
- `index.html:624-628` y `:616-618` → `forceReload()` → **`window.location.reload()`**.

Efecto: tras cada deploy, **toda pestaña abierta se recarga sola en ≤2 min**, aunque el usuario
esté capturando. Además existe un segundo camino de recarga (auto-clean por `app-version` en
`index.html:38-100` → `location.replace`), que puede solaparse.

**Por qué duele tanto ahora:** durante el mantenimiento se despliega muchas veces; cada deploy
= una recarga forzada para todos.

**Fix aplicado (v8.72-fluidez):** la actualización ya NO recarga a la fuerza. Ahora:
- Si el usuario está **inactivo / pestaña oculta**, se recarga en silencio (sin molestar).
- Si está **trabajando**, aparece un aviso discreto "Hay una versión nueva — Actualizar" y
  el usuario decide cuándo. Nunca se le interrumpe a media captura.

---

## 2. Sin limpieza al cambiar de módulo (CONFIRMADO · ALTA)

**Archivo:** `public/js/app.js:2198-2247` (`Router.navigate`).

`Router.navigate` valida acceso, marca el nav activo y llama `await this.modules[moduleName]()`.
**No hay ningún hook de "cleanup/unmount" del módulo anterior.** Consecuencias verificadas:

- `grades.js` arranca `_draftTimer` (auto-save 30s) y `_partialPollTimer` (poll 30s). Se limpian
  al re-entrar a `grades`, pero **NO al navegar a otro módulo** → siguen corriendo en segundo plano.
- `offline-helper.js:50` corre un `setInterval` de 120s que **nunca se detiene** (IIFE global).
- Listeners delegados sobre `#moduleContainer` (que es un elemento **persistente**; sólo se le
  cambia `innerHTML`) se acumulan en módulos que hacen `container.addEventListener(...)` en cada
  render sin clonar el contenedor.

Resultado: con el uso, se acumulan timers y handlers → la UI responde cada vez peor hasta que el
usuario refresca (lo que reinicia todo).

**Fix propuesto (pendiente de tu OK):** agregar a `Router` un registro de "limpieza por módulo"
(`Router.cleanup`) que cada módulo pueda poblar; `navigate()` ejecuta la limpieza del módulo
saliente antes de montar el nuevo. Migrar primero los timers de `grades.js` y el de `offline-helper.js`.

---

## 3. Acumulación de listeners por re-render (CONFIRMADO · MEDIA-ALTA)

Patrón: el módulo re-renderiza dentro de un handler (búsqueda/filtro/paginación) y vuelve a
`addEventListener` sin quitar los previos. El `#moduleContainer` u otros nodos persistentes
acumulan handlers.

Sitios confirmados:
- `students.js:896-980` — listeners en `searchInput`, filtros, `.student-row` (re-bind en cada `render()`).
- `users-mgmt.js:316-365` — listeners delegados en `container`; búsqueda dispara renders.
- `enrollment.js:416-440` — `bindEvents()` en cada `render()` sin desbindeo.
- `grades.js:3034-3056` — listeners en inputs (`.horas-input`, `.grade-faltas`) por cada render del editor.
- `dashboard.js:404-714` y `partial-close.js` (modales) — re-bind al reabrir el mismo modal.

Nota: algunos módulos YA evitan esto clonando el contenedor (`partial-close.js bindEvents()` hace
`cloneNode` + `replaceChild`). Conviene estandarizar ese patrón o usar un único listener delegado
montado una sola vez.

**Estado:** documentado; fix por módulo (no aplicado aún — es un barrido grande, hacerlo por fases).

---

## 4. "Ver usuarios se traba" — causa real (MATIZADO)

El render de ~69 filas de usuarios **no** es el cuello real (HTML de ~30 KB se pinta en <50 ms;
el estimado de "800-1500 ms" de un agente está **sobredimensionado**). Las causas verosímiles del
freeze al ver usuarios son, en orden:

- **`Store.invalidateAll()` al impersonar** (`users-mgmt.js:600-602`) borra TODO el cache → la
  siguiente navegación re-consulta students/teachers/assignments/grades (lecturas grandes). REPORTADO.
- **Re-fetch forzado repetido** (`Store.getUsers(true)`) tras cada acción + doble render
  (panel de estado de ingresos + tabla) en `users-mgmt.js`. REPORTADO.
- **Acumulación de listeners** del punto 3.

**Fix propuesto:** invalidación selectiva (no `invalidateAll`) al impersonar; evitar refetch
forzado cuando sólo se mostró un modal; un solo render por acción.

---

## 5. Robustez de navegación / "faltas de flujo" (REPORTADO · MEDIA)

- `Router.navigate` SÍ tiene try/catch (`app.js:2243`) → un error de módulo muestra un Toast,
  **pero no resetea el contenedor**: si el módulo ya pintó un spinner y luego falla, el spinner
  queda girando. Módulos señalados sin try/catch en su `render()`: `concentrado.js:139`,
  `indicadores.js`, y el patrón general "pinta spinner → await sin catch → si falla, spinner eterno".
- **Sin timeout en queries**: `Store.get*()` no tienen timeout; si Firestore cuelga, la promesa
  no resuelve y el spinner queda infinito. REPORTADO (depende de red).
- **Pérdida de sesión a media navegación**: si el token expira, `onAuthStateChanged` no siempre
  re-dispara y un `permission-denied` deja el módulo a medio cargar. REPORTADO.

**Fix propuesto:** envolver cada `render()` en try/catch que, ante error, muestre un estado de
error recuperable (botón "Reintentar") en lugar de dejar el spinner; opcional: timeout en `Store`.

---

## 6. Cálculos pesados que bloquean el hilo (REPORTADO · MEDIA)

- `dashboard.js:216-303` — loops anidados con `.find()` lineales sobre ~800 alumnos × grupos →
  cientos de miles de operaciones al abrir el dashboard; bloquea el hilo ~1-3 s. Plausible.
  **Fix:** pre-indexar grupos/alumnos en `Map` por id (ya se hizo en otros módulos, tarea #78).

---

## Plan de fix priorizado

| # | Fix | Impacto | Riesgo | Estado |
|---|-----|---------|--------|--------|
| 1 | SW: no recargar a la fuerza; avisar y recargar en idle | ALTO | Bajo | ✅ Aplicado (v8.72) |
| 2 | `Router.cleanup` por módulo + migrar timers (grades, offline-helper) | ALTO | Medio | ⏳ Propuesto |
| 3 | Estandarizar bind de listeners (clonar contenedor / delegación única) | MEDIO-ALTO | Medio | ⏳ Propuesto |
| 4 | users-mgmt: invalidación selectiva + un render por acción | MEDIO | Bajo | ⏳ Propuesto |
| 5 | try/catch + estado de error recuperable en cada `render()` | MEDIO | Bajo | ⏳ Propuesto |
| 6 | dashboard: pre-indexar en Map (quitar loops N²) | MEDIO | Bajo | ⏳ Propuesto |

**Recomendación:** aplicar #1 (ya hecho) resuelve el síntoma más visible. #2 y #3 atacan la
lentitud progresiva — conviene hacerlos por fases con prueba en cada módulo para no romper flujos.
