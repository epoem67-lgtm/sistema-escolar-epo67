# AUDITORÍA DE RENDIMIENTO — Sistema Escolar EPO 67

**Fecha:** 2026-04-27
**Versión auditada:** v5.9 (commit `6f63192`)
**Alcance:** identificar cuellos de botella, consumo excesivo de recursos y oportunidades de optimización **sin modificar código**.
**Síntoma reportado:** el sistema se traba y se cuelga frecuentemente.

---

## 1. RESUMEN EJECUTIVO

El sistema sufre de **3 problemas estructurales** que combinados explican los cuelgues:

1. **Carga inicial de 952 KB de JavaScript bloqueante** (28 scripts síncronos sin `defer`/`async`, sin code‑splitting). El parser se detiene varios segundos antes de que la SPA pueda renderizar.
2. **Lecturas de Firestore sin paginación ni filtros**: cada vez que un orientador o admin abre Concentrado / Boletas / Indicadores se traen miles de documentos a memoria y se procesan en bucles O(n²).
3. **Renderizado masivo del DOM con `innerHTML`** y miles de listeners por celda en módulos como `grades.js` (96 KB) y `concentrado.js` (62 KB), causando reflows que congelan el navegador.

**Impacto cuantificado** (con la base actual de ~811 alumnos × 37 materias × 3 parciales):

| Métrica | Valor actual | Aceptable |
|---|---|---|
| Bundle inicial JS | **952 KB** | < 250 KB |
| Scripts bloqueantes en `<head>/<body>` | **28** | ≤ 4 (con `defer`) |
| Documentos Firestore cargados al abrir Concentrado (admin) | **~9 500** | < 500 |
| Listeners DOM en tabla de captura de notas | **~1 500** (~50 alumnos × 6 rubros × 5 listeners) | < 50 (event delegation) |
| Bucles O(n²) activos | **3** (concentrado matriz, seguimiento, export XLSX) | 0 |
| Cache HTTP | `max-age=3600` (1 h) sin `immutable` | `max-age=31536000, immutable` |
| Service Worker / offline | **No existe** | Recomendado |

> **Diagnóstico general:** el sistema no tiene problemas funcionales — los cuelgues son consecuencia directa de patrones de carga y procesamiento que no escalan con el volumen de datos reales (~90 000 calificaciones acumuladas).

---

## 2. INVENTARIO DEL BUNDLE INICIAL

### 2.1 Tamaño actual de assets (`public/`)

| Archivo | Tamaño | Líneas | Observación |
|---|---|---|---|
| `js/logos.js` | **147 KB** | **2** | ⚠ Dos imágenes PNG en base64 inline. Bloquea el parser. |
| `js/modules/grades.js` | 96 KB | ~2 192 | Módulo más pesado. Tabla de captura. |
| `js/modules/concentrado.js` | 62 KB | ~1 350 | Recién engrosado con seguimiento + cuadro de honor. |
| `js/modules/indicadores.js` | 56 KB | ~1 043 | Charts. |
| `js/modules/teachers.js` | 48 KB | 1 017 | |
| `js/modules/boletas.js` | 47 KB | 576 | |
| `js/modules/student-profile.js` | 45 KB | – | |
| `js/modules/grade-corrections.js` | 44 KB | – | |
| `js/modules/honor-roll.js` | 36 KB | – | |
| `js/modules/students.js` | 30 KB | 887 | |
| Resto módulos (×13) | ~270 KB | – | Cargados aunque el usuario nunca entre. |
| `js/app.js` + `constants.js` + `data-store.js` + `components.js` + `firebase-config.js` | ~70 KB | – | Núcleo (necesario). |
| **TOTAL `js/`** | **952 KB** | **~17 600** | |
| `css/styles.css` | 68 KB | 2 237 | |
| `img/` | 196 KB | – | |

### 2.2 Librerías externas cargadas síncronamente desde CDN ([index.html:13-23](sistema-escolar-firebase/public/index.html#L13))

```
firebase-app-compat.js          ~30 KB
firebase-auth-compat.js        ~110 KB
firebase-firestore-compat.js   ~280 KB
firebase-storage-compat.js      ~40 KB    ← solo se usa en 1 módulo
xlsx.full.min.js               ~369 KB    ← solo en import-grades, import-students, exports de concentrado/boletas
jszip.min.js                    ~62 KB    ← solo en concentrado (zip masivo)
chart.js                       ~181 KB    ← solo en indicadores
fonts.googleapis.com (Inter)            ← bloqueante en <head>
fonts.googleapis.com (Material Icons)   ← bloqueante en <head>
```

**~1 070 KB extra** de librerías de CDN bloqueantes. **Nada tiene `defer` ni `async`**.

### 2.3 Cache HTTP ([firebase.json:11-20](sistema-escolar-firebase/firebase.json#L11))

```json
"headers": [
  { "source": "**/*.js",  "headers": [{ "key": "Cache-Control", "value": "max-age=3600" }] },
  { "source": "**/*.css", "headers": [{ "key": "Cache-Control", "value": "max-age=3600" }] }
]
```

- TTL: solo **1 hora**. Cualquier usuario que vuelva al día siguiente re-descarga 952 KB.
- No hay `immutable`. No hay versionado por hash (los `?v=5.9` ayudan, pero el navegador igual revalida tras 1 h).
- No hay cache para imágenes, fuentes, ni `index.html`.
- **No existe Service Worker.** No hay capa offline. Una red móvil intermitente provoca recarga total.

---

## 3. TOP 10 CUELLOS DE BOTELLA (ordenados por impacto)

### #1 · Carga inicial bloqueante de 28 scripts JS — `index.html:248-281`
- 18 módulos IIFE se cargan y **se ejecutan completos** aunque el usuario solo visite 1–2 secciones.
- Cada IIFE se auto-registra en `Router.modules` durante el parseo → todo el código corre antes del primer pintado.
- **Síntoma directo del cuelgue inicial al abrir la app** en redes 3G/4G o equipos modestos.
- **Sin `defer` ni `async`** en ningún `<script>`.

> **Costo estimado:** 3–8 s de "white screen" en 4G; 1–2 s en banda ancha modesta.

---

### #2 · `logos.js` = 147 KB de PNG en base64 — `js/logos.js:1`
- Archivo de **2 líneas** que contiene dos imágenes (logo de la escuela, encabezado oficial) embebidas como `data:image/png;base64,...`.
- Equivale a **15 % del bundle JS** y se parsea como código sincrónicamente.
- Solo se usa en boletas/concentrados oficiales — no debería cargarse al inicio.

> **Recomendación:** mover a `img/` y cargar como `<img src>` lazy desde los módulos que las usan. Ahorra ~147 KB del bundle inicial.

---

### #3 · `Store.getStudents/Teachers/Groups/Grades` cargan **toda la colección** — `data-store.js:84-138`
- Ningún método del Store usa `.where()` ni `.limit()`. Todo es `db.collection(...).get()`.
- `getAllGrades()` ([data-store.js:135](sistema-escolar-firebase/public/js/data-store.js#L135)) descarga **~9 000–10 000 documentos** (`grades`) en cada cache miss.
- `getStudents()` trae los 811 alumnos aunque un orientador solo necesite los suyos (~50–150).
- Cache TTL razonable (10 min) **mitiga** pero no resuelve: cada 10 min se recarga todo.

> **Costo estimado:** 1–3 s de espera bloqueante al primer acceso a cualquier módulo. Para orientadores: 80 % de los datos descargados son inútiles.

---

### #4 · `concentrado.js loadData()` fuerza re-fetch de calificaciones cada vez — `js/modules/concentrado.js:106`
```js
allGrades = await Store.getGradesByGroups(groupIds, true); // ← force=true ignora cache
```
- El `force=true` invalida deliberadamente el cache por grupo en cada `render()`.
- Para admin: 18 grupos × 1 query c/u = **18 queries Firestore en paralelo**, cada vez que entra a Concentrado.
- Para orientador con 5 grupos: 5 queries Firestore por entrada.
- Cambiar a `force=false` no rompe nada (el cache TTL ya es de 3 min).

> **Costo estimado:** 1–2 s adicionales por cada vez que se abre el módulo, sin razón funcional.

---

### #5 · Bucles O(n²) en generación de Concentrado — `js/modules/concentrado.js:228-248, 723-769, 813-819`
- `groupStudents.forEach { subjectList.forEach { ... } }` → **~50 alumnos × 37 materias = 1 850 iteraciones** por matriz visible.
- En el export masivo XLSX por orientador: `forEach(grupo) { forEach(stu) { forEach(sub) {...} } }` → **~10 grupos × 50 × 37 = 18 500 iteraciones síncronas**, bloqueando el main thread.
- Toda la transformación corre síncronamente — sin `requestAnimationFrame`, sin Web Worker, sin yield.

---

### #6 · `grades.js` ata listeners por cada input de la tabla — `js/modules/grades.js` (95 ocurrencias de `innerHTML/addEventListener/querySelectorAll`)
- En la tabla de captura: para 50 alumnos × 6 rubros, se generan **~300 inputs**, cada uno con 4–5 listeners (`input`, `blur`, `keydown`, `focus`, `change`) = **~1 500 listeners DOM activos**.
- Patrón `row.querySelectorAll('.ge-input')` dentro de `keydown` → se reescanea el DOM **en cada pulsación**.
- 45 `document.getElementById` repartidos por todo el módulo (suelen estar dentro de funciones llamadas en bucles).

> **Síntoma directo:** lag al teclear notas, especialmente en tablas grandes.

---

### #7 · `innerHTML` masivo causa reflows costosos — múltiples módulos
- `concentrado.js:283-324` genera la matriz completa con un solo `html += ...` y un único `innerHTML =` final → reflow gigante.
- `grades.js:1849`, `students.js:316`, `boletas.js:737`, `teachers.js`, `concentrado.js:361` — todos construyen tablas de 500–1 500 celdas vía concatenación de strings.
- No hay virtualización (windowing) ni paginación en el renderizado.

---

### #8 · `import-grades.js` y `import-students.js` sin rate-limiting ni transacciones — `import-grades.js:517-536`, `import-students.js:221-233`
- Hacen hasta **400 writes consecutivos** en un loop síncrono sin `batch.commit()` agrupado ni delay.
- Firestore tiene cuota de 500 ops/s antes de throttling. Importaciones grandes pueden fallar silenciosamente o ralentizar al resto.
- No usan `WriteBatch` (`firebase.firestore().batch()`).

---

### #9 · Closures de módulos retienen referencias después de navegar — patrón general en `*.js modules/`
- Cada IIFE mantiene variables privadas (`students`, `assignments`, `grades`, etc.) que **nunca se liberan** cuando el usuario sale del módulo.
- Navegar entre 5 módulos en una sesión = ~5 × 200 KB retenidos = **~1 MB de memoria que crece con la sesión**.
- Si un usuario deja la pestaña abierta varias horas y navega activamente, se acumula.

---

### #10 · Sin Service Worker, sin compresión Brotli explícita — `firebase.json`
- Firebase Hosting comprime con gzip por default, pero no se aprovecha Brotli.
- Sin SW, no hay capa offline. No hay precarga estratégica de módulos probables.
- TTL de 1 hora obliga a re-validar todo demasiado pronto.

---

## 4. HALLAZGOS SECUNDARIOS

### 4.1 Datos
- **`concentrado.js:209` filtra calificaciones en cliente** después de traer todas las del grupo. Podría incluir `partial` en la query.
- **`Store.invalidate('grades')` ([data-store.js:266](sistema-escolar-firebase/public/js/data-store.js#L266)) hace `forEach` sobre todas las claves del cache** para limpiar las del prefijo `grades_group_`. Con 18 grupos cargados son ~20 iteraciones — costo bajo pero innecesario; se puede usar un sub-mapa.
- **11 lecturas Firestore directas saltándose `Store`** — ej. [partial-close.js:31](sistema-escolar-firebase/public/js/modules/partial-close.js#L31) (`db.collection('partialOverrides').get()`), [at-risk.js:357](sistema-escolar-firebase/public/js/modules/at-risk.js#L357). Cada una pierde la deduplicación y el cache.
- **`Store.getOrientadorGroups()` ([data-store.js:235](sistema-escolar-firebase/public/js/data-store.js#L235)) trae los 811 alumnos a memoria** vía `Store.getGroups()` aunque solo necesite IDs.

### 4.2 Render / DOM
- **CSS `styles.css` = 68 KB / 2 237 líneas**: probablemente reglas duplicadas y no usadas. Sin auditar con cobertura.
- **CSS Custom Properties bien aplicadas**, pero hay **inline styles** abundantes en `concentrado.js` (líneas 296–323, 951–970) que rompen la consistencia y pueden disparar recálculos.
- `Material Icons Round` y `Inter` cargan **bloqueando el render** sin `<link rel="preload">` ni `font-display: swap` configurado en CSS.

### 4.3 Memoria / listeners
- **Búsqueda de `unsubscribe|.off(|detach`: 0 resultados.** Como hoy no se usa `onSnapshot`, no hay leak inmediato — pero cualquier futura migración a tiempo real generaría leaks por el patrón actual.
- **No hay `Router.beforeNavigate` ni teardown** entre módulos. Las refs antiguas sobreviven a la navegación.

### 4.4 Build / pipeline
- **Sin minificación de los archivos propios.** `app.js`, `grades.js`, etc. se sirven en claro desde `public/`. Minificar reduciría ~30–40 % el tamaño transferido.
- **Sin tree-shaking** porque no hay bundler; pero migrar a ES modules con import dinámico permitiría cargar bajo demanda sin tooling pesado.

---

## 5. PLAN DE OPTIMIZACIÓN PROPUESTO (no implementar aún)

> Estas son **recomendaciones priorizadas**. El usuario decidirá cuáles ejecutar y en qué orden. Cada una es independiente y reversible.

### Fase A — Quick wins (alto impacto, bajo riesgo, ≤ 1 hora c/u)

| # | Acción | Impacto esperado | Riesgo |
|---|---|---|---|
| A1 | Mover `logos.js` (147 KB base64) a `img/*.png` y cargarlas como `<img src>` solo en boletas/concentrado | **−147 KB del bundle inicial (−15 %)** | Muy bajo: solo afecta impresiones |
| A2 | Agregar `defer` a los 21 `<script>` de módulos en `index.html:255-281` | Página interactiva ~50 % antes | Muy bajo: módulos ya se ejecutan después del DOM |
| A3 | Quitar `force=true` en [concentrado.js:106](sistema-escolar-firebase/public/js/modules/concentrado.js#L106) | −1 a −2 s al abrir Concentrado | Bajo: cache TTL ya es 3 min |
| A4 | Subir `Cache-Control` a `max-age=31536000, immutable` en `firebase.json` (con `?v=` en URLs el versionado ya rompe cache) | Re-visitas casi instantáneas | Bajo: ya hay versionado en URLs |
| A5 | Añadir `<link rel="preconnect">` a Firestore y `<link rel="preload">` para `app.js`, `data-store.js` | −200 ms en TTFB de queries | Ninguno |
| A6 | `font-display: swap` en `@font-face` (CSS) y precargar Material Icons | Texto visible sin esperar fuentes | Ninguno |

**Total Fase A:** ~ **−30 % de tiempo a interactivo** sin cambios funcionales.

### Fase B — Optimizaciones medias (alto impacto, riesgo moderado, 1–4 h c/u)

| # | Acción | Impacto |
|---|---|---|
| B1 | Cargar `xlsx`, `jszip`, `chart.js` **bajo demanda** (inyectar `<script>` solo cuando el módulo lo necesita) | **−612 KB** del bundle inicial |
| B2 | Filtrar `Store.getStudents()` por orientador cuando el rol lo permita (nuevo método `getStudentsForOrientador()`) | Orientadores: −80 % de datos cargados |
| B3 | Añadir `.where('partial','==',parcial)` a las queries de calificaciones | −66 % de docs leídos en módulos por parcial |
| B4 | Convertir `import-grades.js` y `import-students.js` a `WriteBatch` (lotes de 400 + commit + delay) | Imports 5–10× más rápidos, sin throttling |
| B5 | Event delegation en `grades.js`: un solo `addEventListener` en el `<tbody>` con `e.target.closest('.ge-input')` | **−1 500 listeners → 1**. Lag al teclear desaparece |
| B6 | Llamar a `Store.invalidateGradesForGroup(groupId)` en lugar de `invalidate('grades')` siempre que se sepa el grupo | Menos cache misses tras captura |

### Fase C — Reestructuración (alto impacto, alto esfuerzo, 1–3 días c/u)

| # | Acción | Impacto |
|---|---|---|
| C1 | Migrar la carga de módulos a ES Modules con `import()` dinámico desde el `Router.navigate()` | Solo se descarga el módulo abierto. Bundle inicial < 250 KB |
| C2 | Service Worker con estrategia "stale-while-revalidate" para `js/`, `css/`, `img/` | Carga instantánea en re-visitas. Capa offline. |
| C3 | Virtualización (windowing) en tablas > 100 filas (concentrado, grades) — renderizar solo las filas visibles | DOM 10–20× más liviano. Reflows instantáneos. |
| C4 | Mover el procesamiento XLSX a un Web Worker | Main thread libre durante export masivo |
| C5 | Auditar y purgar `styles.css` con herramienta de cobertura (Chrome DevTools) | −30–50 % CSS |
| C6 | Migrar Firebase SDK de v8 compat a v9 modular | −100 a −150 KB con tree-shaking |
| C7 | Mover datos hardcodeados (orientadores, UAC names) de `constants.js` a Firestore | Editar sin redeploy |

---

## 6. SIGUIENTES PASOS RECOMENDADOS

1. **Validar este reporte** con el usuario y priorizar fases.
2. **Implementar Fase A completa** en una sola sesión y medir antes/después con DevTools (Lighthouse, Network, Performance).
3. Tras Fase A, **reevaluar** si los cuelgues persisten — la mayor parte del problema percibido suele estar en Fase A + B5 (event delegation).
4. Considerar habilitar **Firebase Performance Monitoring** (gratis hasta 100 K eventos/día) para tener métricas reales en producción.

---

## 7. ARCHIVOS REVISADOS (referencia)

- `public/index.html` (283 líneas) — shell SPA, scripts bloqueantes
- `public/firebase.json` — config Hosting/cache
- `public/js/firebase-config.js`, `app.js`, `constants.js`, `data-store.js`, `components.js`, `logos.js`
- `public/js/modules/concentrado.js` (1 350 líneas)
- `public/js/modules/grades.js` (2 192 líneas)
- `public/js/modules/indicadores.js`, `boletas.js`, `students.js`, `teachers.js`, `at-risk.js`, `import-grades.js`, `import-students.js`, `partial-close.js`, `student-profile.js`
- 101 llamadas a Firestore localizadas en 16 archivos (`grep`)

---

**Responsable de la auditoría:** Claude Code (Opus 4.7)
**Estado del repositorio al iniciar:** commit `6f63192` (base limpia, sin código modificado en esta auditoría).
