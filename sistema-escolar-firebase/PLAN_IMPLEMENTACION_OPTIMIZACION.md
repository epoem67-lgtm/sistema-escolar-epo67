# PLAN DE IMPLEMENTACIÓN — Optimización Sistema Escolar EPO 67

**Base:** auditoría 2026-04-27 ([AUDITORIA_RENDIMIENTO_2026-04-27.md](AUDITORIA_RENDIMIENTO_2026-04-27.md))
**Punto de partida:** commit `6f63192` (estado limpio en producción)
**Modalidad:** **commit + deploy por cada cambio** + **verificación local antes de cada deploy**
**Filosofía:** cambios pequeños, atómicos, reversibles. Si algo se rompe, `git revert <sha>` y redeploy en < 1 minuto.

---

## 0. METODOLOGÍA POR CAMBIO

Cada uno de los **19 cambios** sigue exactamente este flujo:

```
┌─ 1. PRE-CAMBIO ──────────────────────────────────────┐
│ • git pull                                            │
│ • git status (limpio antes de empezar)                │
└──────────────────────────────────────────────────────┘
            ↓
┌─ 2. IMPLEMENTACIÓN ──────────────────────────────────┐
│ • Editar solo los archivos del scope del cambio       │
│ • Bumpear ?v= en index.html para los archivos tocados│
└──────────────────────────────────────────────────────┘
            ↓
┌─ 3. VERIFICACIÓN LOCAL ──────────────────────────────┐
│ • Levantar servidor: firebase emulators:start \      │
│       --only hosting --project epo67-sistema          │
│   (o: npx http-server public -c-1)                    │
│ • Smoke test (ver §Smoke Test al final)               │
│ • DevTools: Network tab + Console tab limpios         │
└──────────────────────────────────────────────────────┘
            ↓
        ¿OK? ──── NO ──→ debug y reintenta
            ↓ SÍ
┌─ 4. COMMIT ──────────────────────────────────────────┐
│ • git add <archivos específicos>                      │
│ • git commit -m "[opt-A1] título descriptivo          │
│   <razón en cuerpo>"                                  │
└──────────────────────────────────────────────────────┘
            ↓
┌─ 5. DEPLOY ──────────────────────────────────────────┐
│ • npx firebase-tools deploy --only hosting            │
│ • Abrir https://epo67-sistema.web.app                 │
│ • Smoke test de producción (login + 1 módulo crítico) │
└──────────────────────────────────────────────────────┘
            ↓
┌─ 6. MEDICIÓN (cada 3-4 cambios) ─────────────────────┐
│ • DevTools Lighthouse mobile/desktop                  │
│ • Network: tamaño total, tiempo a interactivo         │
│ • Anotar en este plan: "[A1] Bundle: 952KB → X KB"    │
└──────────────────────────────────────────────────────┘
            ↓
        ¿Regresión? ── SÍ ──→ git revert <sha> + deploy
            ↓ NO
        Siguiente cambio
```

> **Si en producción aparece algo raro:** `git revert <sha>` + `npx firebase-tools deploy --only hosting`. Recuperación < 60 s.

---

## 1. SMOKE TEST — Checklist obligatorio en cada deploy

Antes y después de cada cambio, recorrer **todos los puntos** marcando ✓ / ✗. Si alguno falla, **no se hace deploy**.

### 1.1 Login y sesión
- [ ] Cargar la app sin sesión activa → muestra splash → muestra login
- [ ] Login con email/password → entra al dashboard
- [ ] Login con Google (si está activo) → entra al dashboard
- [ ] Refresh de página manteniendo sesión → re-entra sin pedir login
- [ ] Logout → vuelve a login

### 1.2 Sidebar y navegación
- [ ] Sidebar muestra solo las secciones del rol del usuario
- [ ] Cada link de sidebar carga el módulo correspondiente sin error en consola

### 1.3 Módulos críticos (probar al menos estos 5)
- [ ] **Dashboard** (inicio): tarjetas se renderizan con datos
- [ ] **Concentrado**: seleccionar grupo → matriz se genera → "Imprimir/PDF" abre vista → "Excel" descarga archivo válido → "Masivo por Orientador" descarga ZIP válido
- [ ] **Captura de calificaciones** (`my-grades` o `grades-admin`): seleccionar asignación → tabla aparece → tipear notas → guardar → recargar → notas persisten
- [ ] **Indicadores**: charts se renderizan
- [ ] **Boletas**: seleccionar grupo y parcial → boleta se genera

### 1.4 Permisos
- [ ] Probar la app con un usuario `orientador` real → solo ve sus grupos
- [ ] Probar con un usuario `maestro` → solo ve sus asignaciones

### 1.5 DevTools
- [ ] **Console:** sin errores rojos (`Uncaught ...`). Warnings amarillos OK si son los habituales.
- [ ] **Network:** sin requests 4xx/5xx. Sin requests duplicados sospechosos.
- [ ] **Memory:** snapshot antes y después de navegar 5 módulos. Diferencia < 30 MB.

> **Regla de oro:** si el smoke test detecta un comportamiento que no aparecía antes del cambio → **rollback**, investigar, reintentar.

---

## 2. FASE A — Quick wins (6 cambios, ~3-4 horas, riesgo MUY BAJO)

> **Objetivo:** ~30 % de reducción de tiempo a interactivo sin tocar lógica.
> Ningún cambio toca módulos de negocio.

### A1 · Quitar `force=true` en `Store.getGradesByGroups` desde Concentrado
- **Archivo:** `public/js/modules/concentrado.js:106`
- **Cambio:** `Store.getGradesByGroups(groupIds, true)` → `Store.getGradesByGroups(groupIds)` (deja que el cache TTL de 3 min haga su trabajo).
- **Por qué primero:** cambio de 1 carácter. Si rompe algo es muy fácil de revertir y enseña el flujo.
- **Riesgo:** muy bajo. El cache de calificaciones ya invalida cuando se guarda una nota.
- **Smoke test específico:** abrir Concentrado, seleccionar grupo, ver matriz. Capturar una nota desde Captura, regresar a Concentrado → debe mostrar la nota nueva (Captura llama `Store.invalidateGradesForGroup`).
- **Tiempo:** 10 min.
- **Commit:** `[opt-A1] concentrado: respetar cache de grades por grupo`

---

### A2 · Agregar `defer` a los 21 `<script>` de módulos
- **Archivo:** `public/index.html:255-281`
- **Cambio:** agregar `defer` a TODOS los `<script src="/js/modules/...">` y a `student-profile.js`. **NO tocar** los core (`firebase-config`, `constants`, `data-store`, `app`, `components`, `logos` — algunos se usan inmediatamente).

  Antes:
  ```html
  <script src="/js/modules/dashboard.js?v=5.9"></script>
  ```
  Después:
  ```html
  <script src="/js/modules/dashboard.js?v=5.9" defer></script>
  ```

- **Por qué:** los módulos solo se ejecutan cuando `Router.navigate()` los invoca. Nada los necesita durante el parseo del HTML.
- **Riesgo:** bajo. Si un módulo se auto-ejecuta antes de que `Router` esté listo, fallaría. Hay que confirmar que cada IIFE se registra bien tras `defer`.
- **Smoke test específico:** recorrer **todos** los módulos del sidebar (no solo los 5 críticos), verificar que cada uno carga sin "Module X not registered" en consola.
- **Tiempo:** 30 min (incluye verificación cuidadosa).
- **Commit:** `[opt-A2] index: defer en scripts de modulos`

---

### A3 · `font-display: swap` y `<link rel="preconnect">` para fuentes
- **Archivos:** `public/index.html:7-10`, `public/css/styles.css` (al inicio)
- **Cambios:**
  1. En `index.html` agregar:
     ```html
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link rel="preconnect" href="https://firestore.googleapis.com" crossorigin>
     ```
  2. Cambiar el href de Google Fonts agregando `&display=swap` (la URL ya lo tiene en línea 9, verificar que también lo tenga la de Material Icons en línea 10).
- **Por qué:** texto visible inmediatamente, requests a Firestore se preparan en paralelo.
- **Riesgo:** ninguno.
- **Tiempo:** 15 min.
- **Commit:** `[opt-A3] index: preconnect + font-display swap`

---

### A4 · Subir cache HTTP de assets a `1 año, immutable`
- **Archivo:** `firebase.json:11-20`
- **Cambio:**
  ```json
  "headers": [
    { "source": "**/*.@(js|css)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "**/*.@(png|jpg|jpeg|svg|webp|woff|woff2)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] }
  ]
  ```
- **Por qué:** los archivos JS/CSS llevan `?v=5.9` en sus URLs (versionado por query) → seguro marcar `immutable`. `index.html` debe revalidar siempre para que un nuevo deploy se entregue al instante.
- **Riesgo:** bajo. Si surge un bug y necesitamos forzar un cambio de JS, basta con bumpear `?v=` (que ya hacemos).
- **Smoke test:** después del deploy, en DevTools Network, recargar y confirmar que `*.js` viene con `cache-control: public, max-age=31536000, immutable` y `index.html` con `max-age=0`.
- **Tiempo:** 20 min.
- **Commit:** `[opt-A4] firebase: cache 1y immutable para assets, no-cache para index`

---

### A5 · Mover `logos.js` (147 KB base64) a `img/*.png` y cargar bajo demanda
- **Archivos:**
  - Borrar `public/js/logos.js`
  - Crear `public/img/logo-header.png` y `public/img/logo-footer.png` (decodificar el base64 actual y guardar como PNG)
  - Modificar `public/index.html:254` (eliminar el `<script src="/js/logos.js">`)
  - Modificar los módulos que usan `LOGO_HEADER_SRC` / `LOGO_FOOTER_SRC` (probablemente `boletas.js`, `boleta-oficial.js`, `concentrado.js`) → reemplazar la referencia por `/img/logo-header.png` cuando se construye el HTML imprimible
- **Por qué:** **−147 KB del bundle inicial (≈15 %)**. Las imágenes se cachean por separado en el navegador.
- **Riesgo:** medio. Hay que ubicar todos los usos de `LOGO_HEADER_SRC` y reemplazarlos. Si se omite uno, ese print saldrá sin logo.
- **Smoke test específico:**
  - Imprimir/PDF una boleta → logos se ven
  - Imprimir/PDF un concentrado → logos se ven
  - Print masivo por orientador → todos los PDFs tienen logos
- **Tiempo:** 1 hora.
- **Commit:** `[opt-A5] logos: mover de base64 inline a archivos img cargados on-demand`

---

### A6 · Agregar `<link rel="preload">` a JS críticos
- **Archivo:** `public/index.html` (en `<head>`, antes de los `<script>`)
- **Cambio:**
  ```html
  <link rel="preload" href="/js/firebase-config.js?v=5.9" as="script">
  <link rel="preload" href="/js/app.js?v=5.9" as="script">
  <link rel="preload" href="/js/data-store.js?v=5.9" as="script">
  <link rel="preload" href="/css/styles.css?v=5.8" as="style">
  ```
- **Por qué:** el navegador comienza a descargar los archivos críticos antes de llegar al `<script>` correspondiente.
- **Riesgo:** ninguno.
- **Tiempo:** 10 min.
- **Commit:** `[opt-A6] index: preload de assets criticos`

---

### Hito de Fase A
Después de A1-A6, medir con Lighthouse mobile y registrar:

| Métrica | Antes | Después | Δ |
|---|---|---|---|
| First Contentful Paint | __ s | __ s | __ |
| Time to Interactive | __ s | __ s | __ |
| Total Bundle (Network) | 952 KB | __ KB | __ |
| Lighthouse Performance | __ | __ | __ |

**Resultado esperado:** −20 a −30 % en TTI.

---

## 3. FASE B — Optimizaciones medias (6 cambios, ~10-15 horas, riesgo MEDIO)

> **Objetivo:** reducir bundle inicial otros ~600 KB, eliminar lag al teclear notas, reducir lecturas Firestore.

### B1 · Loader de librerías externas bajo demanda (`xlsx`, `jszip`, `chart.js`)
- **Archivos:**
  - Modificar `public/index.html:19-23`: **quitar** los 3 `<script>` de CDN
  - Crear `public/js/lib-loader.js`:
    ```js
    const Lib = (() => {
      const _loaded = {};
      function loadScript(src) {
        if (_loaded[src]) return _loaded[src];
        _loaded[src] = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src; s.onload = () => resolve(); s.onerror = reject;
          document.head.appendChild(s);
        });
        return _loaded[src];
      }
      return {
        xlsx: () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'),
        jszip: () => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
        chart: () => loadScript('https://cdn.jsdelivr.net/npm/chart.js')
      };
    })();
    ```
  - Agregar `<script src="/js/lib-loader.js?v=5.9">` en `index.html`
  - En cada módulo que use `XLSX`, `JSZip`, `Chart`: agregar `await Lib.xlsx();` (o jszip/chart) antes de la primera invocación
  - Usuarios: `import-grades.js`, `import-students.js`, `concentrado.js` (export Excel + ZIP), `boletas.js` (Excel), `indicadores.js` (Chart), `reports-comparative.js` (Chart)
- **Por qué:** **−612 KB del bundle inicial**. Solo los usuarios que entren a esos módulos descargan las librerías.
- **Riesgo:** medio. Olvidar un `await Lib.xxx()` = error en runtime cuando el usuario intenta usar la función.
- **Smoke test específico:** entrar a CADA módulo que usa esas librerías y ejercitar la funcionalidad (export, charts, import).
- **Tiempo:** 3 horas.
- **Commit:** `[opt-B1] libs: lazy-load de XLSX, JSZip, Chart.js`

---

### B2 · Filtrar queries de calificaciones por `partial` en el servidor
- **Archivos:**
  - `public/js/data-store.js`: agregar método `getGradesByGroupAndPartial(groupId, partial)` con `.where('groupId','==',groupId).where('partial','==',partial)`
  - Módulos que filtran calificaciones por parcial **en cliente** (concentrado, boletas, indicadores, at-risk): cambiar a `getGradesByGroupAndPartial`
- **Por qué:** Firestore puede devolver 1/3 de los documentos si filtra por parcial.
- **Riesgo:** medio. Requiere agregar índice compuesto en Firestore (`groupId asc, partial asc`) en `firestore.indexes.json`. Si falta el índice, la query falla.
- **Smoke test específico:** cada módulo que cambió, abrir y verificar que datos siguen apareciendo correctamente.
- **Tiempo:** 2 horas.
- **Commit:** `[opt-B2] grades: queries filtradas por parcial en servidor`

---

### B3 · `getStudentsForOrientador()` — filtrar alumnos por servidor
- **Archivos:**
  - `public/js/data-store.js`: nuevo método que solo trae alumnos de los grupos del orientador (con `.where('grupo','in', [...])` o equivalente)
  - Módulos `students.js`, `at-risk.js`, `boletas.js`, `concentrado.js`, etc. que ya filtran post-hoc → cambiar a este método cuando rol === 'orientador'
- **Por qué:** orientador con 5 grupos descarga ~150 alumnos en lugar de 811. **−80 % de transferencia**.
- **Riesgo:** medio. La query `where('grupo','in', array)` tiene límite de 30 valores en Firestore — pero ningún orientador tiene tantos grupos.
- **Smoke test específico:** logueado como orientador, abrir Concentrado, Boletas, At-Risk, Consulta por Alumno → verificar que se ven todos los alumnos correctos.
- **Tiempo:** 2 horas.
- **Commit:** `[opt-B3] store: getStudentsForOrientador filtrado en servidor`

---

### B4 · `WriteBatch` en `import-grades.js` e `import-students.js`
- **Archivos:** `public/js/modules/import-grades.js`, `public/js/modules/import-students.js`
- **Cambio:** reemplazar el loop de `db.collection().doc().set()` por agrupaciones de hasta 400 ops en `db.batch()` + `batch.commit()`.
- **Por qué:** importaciones 5–10× más rápidas y sin throttling de Firestore.
- **Riesgo:** medio-alto. Errores de batch se propagan en bloque (si falla 1 op, falla todo el batch). Hay que manejar bien los errores.
- **Smoke test específico:** importar un Excel pequeño (5-10 alumnos/notas) y luego uno grande (~100). Verificar que todo aparece.
- **Tiempo:** 3 horas.
- **Commit:** `[opt-B4] imports: WriteBatch en import-grades + import-students`

---

### B5 · Event delegation en `grades.js` (tabla de captura)
- **Archivo:** `public/js/modules/grades.js` (sección de render de tabla, ~líneas 700-770 y 1800-1850)
- **Cambio:** reemplazar el patrón "for each input → addEventListener" por un solo listener en el `<tbody>` que use `e.target.closest('.ge-input')` y `e.target.dataset.studentId / .dataset.rubro`.
- **Por qué:** **de ~1500 listeners a 1**. Lag al teclear desaparece. Memoria −5-10 MB en sesiones largas de captura.
- **Riesgo:** alto **dentro de un módulo aislado**. Es la pieza más usada del sistema (captura diaria de notas). Probar exhaustivamente.
- **Smoke test específico:**
  - Capturar 10 notas seguidas con teclado (Tab, Enter, flechas) → comportamiento idéntico a antes
  - Borrar una nota → se borra en Firestore
  - Cambiar de parcial sin guardar → confirma descarte
  - Pegar varias notas con copy-paste → se distribuyen
  - Cerrar pestaña con notas pendientes → muestra confirmación
- **Tiempo:** 4 horas (la mitad es prueba).
- **Commit:** `[opt-B5] grades: event delegation en tabla de captura`

---

### B6 · `Store.invalidateGradesForGroup()` siempre que se sepa el grupo
- **Archivos:** `public/js/modules/grades.js`, `import-grades.js`, cualquier mutación de calificaciones que llame `Store.invalidate('grades')`
- **Cambio:** sustituir `Store.invalidate('grades')` por `Store.invalidateGradesForGroup(groupId)` cuando se conoce el grupo de la mutación.
- **Por qué:** evita que TODOS los caches por grupo se borren cuando solo cambió uno. Concentrado/Boletas no recargan datos innecesariamente tras una captura.
- **Riesgo:** bajo. Si se olvida invalidar, datos viejos se ven hasta TTL (3 min) — no rompe nada.
- **Smoke test específico:** capturar una nota → ir a Concentrado del mismo grupo → ver la nota actualizada. Ir a Concentrado de OTRO grupo → no debió recargar (verificar en Network que no hay query nueva).
- **Tiempo:** 1 hora.
- **Commit:** `[opt-B6] store: invalidacion granular por grupo en lugar de toda la coleccion`

---

### Hito de Fase B
Re-medir Lighthouse y registrar:

| Métrica | Después de A | Después de B | Δ |
|---|---|---|---|
| Bundle inicial JS | __ KB | __ KB | __ |
| Tiempo de carga Concentrado (admin) | __ s | __ s | __ |
| Lag al teclear nota | __ ms | __ ms | __ |
| Tiempo importar 100 calificaciones | __ s | __ s | __ |

**Resultado esperado:** bundle < 350 KB, captura de notas fluida, imports 5× más rápidos.

---

## 4. FASE C — Reestructuración (7 cambios, ~30-50 horas, riesgo ALTO)

> **Objetivo:** alcanzar < 250 KB de bundle, capa offline, y arquitectura sostenible.
> **Importante:** cada cambio aquí merece más cuidado. Recomiendo hacer pausa de 1-2 días entre fase B y C para verificar estabilidad.

### C1 · Auditar y purgar `styles.css`
- **Archivo:** `public/css/styles.css` (2 237 líneas, 68 KB)
- **Procedimiento:** abrir DevTools → Coverage → recargar app → recorrer todos los módulos → exportar lista de reglas no usadas → eliminar.
- **Por qué:** −30-50 % CSS sin afectar el render.
- **Riesgo:** medio. Una regla aparentemente no usada puede aplicarse en un modal/condición rara.
- **Smoke test específico:** recorrer cada modal, cada estado de error, cada toast. Visual diff con el estado anterior.
- **Tiempo:** 4 horas.
- **Commit:** `[opt-C1] css: purgar reglas no usadas`

---

### C2 · Mover `K.ORIENTADORES` y `K.UAC_NOMBRES` a Firestore
- **Archivos:**
  - `public/js/constants.js`: vaciar esos 2 mapas, dejar solo lo realmente constante (parciales, umbrales, roles)
  - Crear colección `config/orientadores` y `config/uacNombres` en Firestore
  - Cargar al iniciar sesión vía `Store.getConfig()`
  - Crear pantalla de admin para editarlos en `school-config.js`
- **Por qué:** cambiar nombres de orientadores no requiere redeploy. Reduce bundle JS.
- **Riesgo:** medio. Hay que migrar los datos actuales sin perder ninguno.
- **Smoke test específico:** entrar como admin → editar un orientador → guardar → recargar → confirmar persistencia. Concentrado masivo sigue funcionando.
- **Tiempo:** 4 horas.
- **Commit:** `[opt-C2] config: migrar orientadores y uacNombres a Firestore`

---

### C3 · Service Worker con estrategia "stale-while-revalidate"
- **Archivos:**
  - Crear `public/sw.js` con cache de `js/`, `css/`, `img/`, `index.html`
  - Registrar en `public/index.html` (al final, después de la app)
  - Cuando cambia versión de un asset (`?v=`), el SW lo actualiza en background
- **Por qué:** carga instantánea en re-visitas. Capa offline básica.
- **Riesgo:** alto. Un SW mal configurado puede dejar a usuarios atrapados con una versión vieja sin forma de actualizar. Hay que incluir mecanismo de invalidación forzada.
- **Smoke test específico:** primera carga normal → recargar → debe verse instantáneo. En DevTools Application → Service Workers ver que está activo. Probar `Unregister` desde DevTools y recargar → debe re-instalarse.
- **Tiempo:** 5 horas.
- **Commit:** `[opt-C3] sw: service worker stale-while-revalidate`

---

### C4 · Web Worker para procesamiento de XLSX
- **Archivos:**
  - Crear `public/js/workers/xlsx-worker.js` que importe XLSX y exponga `generate(data)` / `parse(blob)` por `postMessage`
  - Modificar módulos que generan XLSX (`concentrado.js`, `boletas.js`, `import-grades.js`) para usar el worker
- **Por qué:** main thread libre durante export masivo (Concentrado por orientador con 30 grupos). UI no se congela.
- **Riesgo:** medio. La transferencia de datos al worker puede ser lenta si los objetos son enormes.
- **Smoke test específico:** generar export masivo de Concentrado por orientador → durante la generación, hacer scroll y clickear en sidebar → debe responder fluidamente.
- **Tiempo:** 4 horas.
- **Commit:** `[opt-C4] xlsx: procesamiento en Web Worker`

---

### C5 · Virtualización (windowing) en tablas grandes
- **Módulos afectados:** `concentrado.js`, `grades.js`, `students.js`, `boletas.js` (cualquier tabla > 100 filas)
- **Cambio:** implementar un mini-virtualizador (~80 líneas) o adoptar una librería ligera (ej. `tabulator-tables` solo si vale la pena el peso). Renderizar solo las filas visibles + buffer.
- **Por qué:** DOM 10–20× más liviano. Reflows instantáneos.
- **Riesgo:** alto. Reescribir el render de las tablas más usadas. Imprimir/PDF debe seguir mostrando TODAS las filas (modo print = sin virtualización).
- **Smoke test específico:** scroll fluido en tabla de 800 alumnos. Imprimir → todas las filas. Búsqueda → resalta correcta. Selección múltiple → conserva estado.
- **Tiempo:** 8 horas (probablemente el cambio más laborioso).
- **Commit:** `[opt-C5] tables: virtualizacion para listas largas`

---

### C6 · Migrar carga de módulos a `import()` dinámico desde `Router.navigate()`
- **Archivos:**
  - `public/js/app.js`: `Router.navigate(name)` → `import(\`./modules/\${name}.js\`).then(m => Router.modules[name]())`
  - Cada módulo: cambiar IIFE auto-registrado por `export default function render() { ... }` (o convención similar)
  - `public/index.html`: quitar TODOS los `<script>` de módulos, dejar solo el core
  - Archivos `.js` de módulos: convertir a ES Modules (`type="module"`)
- **Por qué:** **bundle inicial < 250 KB**. Solo el módulo abierto se descarga.
- **Riesgo:** muy alto. Es un cambio arquitectónico. Puede tener efectos sutiles en el orden de inicialización.
- **Smoke test específico:** **completo, módulo por módulo**. Especial atención a módulos que se referencian entre sí (concentrado usa funciones de boletas, etc.). Verificar también que el splash desaparece correctamente.
- **Tiempo:** 8 horas.
- **Commit:** `[opt-C6] arch: lazy load de modulos via import dinamico`

---

### C7 · Migrar Firebase SDK v8 compat → v9 modular
- **Archivos:** todo el proyecto que usa `firebase.firestore()`, `firebase.auth()`, etc.
- **Cambio:** reemplazar API global por imports puntuales (`import { getFirestore, collection, query, where } from 'firebase/firestore'`). Solo carga lo que se usa.
- **Por qué:** **−100-150 KB con tree-shaking**. SDK más moderno, mejor tipado.
- **Riesgo:** muy alto. La API es completamente distinta. Cada llamada a Firestore cambia.
- **Prerequisito:** C6 (ES modules) DEBE estar hecho primero.
- **Smoke test:** TODO. Es la mayor superficie de cambio. Recomendable hacerlo módulo por módulo en sub-commits.
- **Tiempo:** 12 horas.
- **Commit:** `[opt-C7] firebase: migracion v8 compat → v9 modular`

---

### Hito de Fase C
Re-medir y comparar contra estado original (antes de A1):

| Métrica | Original | Final | Δ |
|---|---|---|---|
| Bundle inicial JS | 952 KB | __ KB | __ |
| Time to Interactive | __ s | __ s | __ |
| Lighthouse Performance | __ | __ | __ |
| Carga repetida (con SW) | __ s | __ s | __ |
| Memoria a los 30 min | __ MB | __ MB | __ |

**Resultado esperado:** bundle < 250 KB, TTI < 1.5 s, app fluida en redes 3G.

---

## 5. ORDEN GLOBAL Y CRONOGRAMA SUGERIDO

| Día | Cambios | Riesgo acumulado |
|---|---|---|
| 1 (mañana) | A1, A2, A3, A4 | Muy bajo |
| 1 (tarde) | A5, A6 → **Hito Fase A** | Bajo |
| 2-3 | B1, B2, B3 | Medio |
| 4-5 | B4, B5, B6 → **Hito Fase B** | Medio |
| **Pausa de 2-3 días** | (verificar estabilidad en producción) | — |
| 8 | C1, C2 | Medio |
| 9-10 | C3, C4 | Alto |
| 11-12 | C5 | Alto |
| 13-15 | C6 | Muy alto |
| 16-18 | C7 → **Hito final** | Muy alto |

> **Total estimado:** ~3 semanas de trabajo focalizado, distribuibles en más tiempo si se atienden otras prioridades.

---

## 6. CONDICIONES DE ABORTO / ROLLBACK

Detener la fase actual y revertir si:

- Aparece un error rojo en consola que no estaba antes
- Un módulo del smoke test falla
- Un usuario reporta comportamiento extraño tras un deploy
- Lighthouse Performance baja en lugar de subir
- Algún rol pierde visibilidad de datos que sí tenía

**Procedimiento de rollback:**
```bash
git revert <sha-del-cambio>
npx firebase-tools deploy --only hosting
# y se discute qué pasó antes de reintentar
```

---

## 7. PUNTOS QUE REQUIEREN TU CONFIRMACIÓN ANTES DE EJECUTAR

Cuando llegue el momento de ejecutar, voy a confirmar contigo los siguientes puntos sensibles:

1. **A4 (cache 1 año):** ¿hay algún momento esperado en que un cambio deba propagarse en menos de 1 minuto sin bumpear `?v=`? Si sí, la estrategia debe ajustarse.
2. **B3 (filtrado por orientador):** ¿algún orientador tiene >30 grupos asignados? (límite de Firestore `where in`).
3. **C2 (orientadores en Firestore):** ¿quieres una pantalla de UI para editarlos, o solo migrar la data y dejar la edición vía consola por ahora?
4. **C3 (Service Worker):** ¿es OK que un usuario siga viendo la versión vieja durante segundos hasta que el SW actualice en background, o necesitas siempre la última versión al instante?
5. **C7 (Firebase v9):** este es un cambio que toma 1-2 días enteros. ¿Lo hacemos en una semana sin actividad escolar (vacaciones)?

---

## 8. ARCHIVOS DE REFERENCIA

- [AUDITORIA_RENDIMIENTO_2026-04-27.md](AUDITORIA_RENDIMIENTO_2026-04-27.md) — auditoría base
- `public/index.html` — shell SPA
- `public/firebase.json` — config hosting
- `public/js/data-store.js` — capa de cache (no requiere reescritura, solo extensiones)
- `public/js/modules/*.js` — módulos a optimizar

---

**Estado actual del repositorio:** commit `6f63192` (limpio).
**Listos para ejecutar cuando me des luz verde.** Cada cambio confirmado con su smoke test antes del deploy.
