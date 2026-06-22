// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — Sistema Escolar EPO 67
// Estrategia:
//   - Network-first para index.html y "/" → siempre la ultima version
//   - Cache-first (immutable) para *.js, *.css, *.png, *.woff2, etc.
//     (las URLs llevan ?v=X.Y, asi que un cambio bumpea la URL y
//     el cache vence implicitamente).
//   - Pass-through para Firestore / Auth / fonts.googleapis (deja al
//     navegador y a Firebase manejar sus propios caches).
//
// Bandera de version: cambiar SW_VERSION fuerza purga de caches viejos
// y re-instala el SW en todos los clientes (skipWaiting + clientsClaim).
//
// Deshabilitar en emergencia: borrar este archivo y desplegar.
// El siguiente fetch retornara 404, que dispara unregister automatico
// en algunos navegadores. Para ser explicito tambien podemos
// reemplazar el contenido por:  self.registration.unregister();
// ═══════════════════════════════════════════════════════════════

const SW_VERSION = "v8.60-reglas-sep-cal-final-unificada";
// PERFORMANCE: el cache YA NO depende de SW_VERSION. Antes cada bump de versión
// borraba los 46 JS (~1.9 MB) y forzaba a redescargarlos. Ahora el cache es
// estable y persistente — los archivos viejos se reemplazan naturalmente cuando
// cambia su `?v=` en index.html (Cache API trata cada URL como entrada distinta).
// Resultado: deploys subsecuentes son casi instantáneos para el usuario.
const STATIC_CACHE = 'epo67-static-v1';
// Bumpear este flag dispara una limpieza del IndexedDB de Firestore en todos
// los clientes al activar el nuevo SW. Útil cuando hay datos viejos cacheados
// en navegadores de usuarios que no responden a refresh normal.
const PURGE_FIRESTORE_CACHE_FLAG = '2026-05-23-laurita-cards-v711';

// Recursos a precachear durante la instalacion (la app shell minima)
// Si algun fetch falla, no se rompe la instalacion (continueOnError).
const PRECACHE_URLS = [
  '/',
  '/index.html',
];

// ─── MESSAGE: SKIP_WAITING desde la pagina ────────────────────
// La pagina pide al SW nuevo que se active sin esperar a que se cierren
// las pestanias viejas. Pareado con clientsClaim() en activate, el cliente
// recibe controllerchange y se auto-recarga.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] precache fail', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────
// Solo borra caches MUY viejos (los que ya no usamos). Las entries del cache
// activo NO se tocan — los assets viejos quedan "huérfanos" automáticamente
// cuando el index.html nuevo pide URLs con `?v=` distinto. Esos huérfanos los
// limpiamos pasivamente cuando crecen demasiado (lógica futura si hace falta).
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('epo67-static-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();

    // v8.44: REFRESH FORZADO a todos los clientes (incluido tabs en background).
    // Cuando un SW nuevo se activa, manda un mensaje a TODAS las pestañas
    // controladas para que recarguen — útil cuando los usuarios no saben
    // hacer Ctrl+Shift+R manualmente. El listener en index.html recibe este
    // mensaje y ejecuta window.location.reload().
    const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of allClients) {
      try {
        client.postMessage({ type: 'SW_ACTIVATED_RELOAD', version: SW_VERSION });
      } catch (_) { /* cliente cerrado, ignorar */ }
    }
  })());
});

// ─── FETCH ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Solo manejamos same-origin
  if (url.origin !== self.location.origin) return;

  // Network-first para navegacion (index.html) -> siempre la ultima version
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache-first para assets versionados (con ?v=) o archivos estaticos
  // Heuristica: extensiones tipicas
  if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|otf)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: deja pasar (Firebase SDKs cargan otras rutas como /firestore.googleapis.com etc.,
  // pero esas son cross-origin y ya se filtraron arriba).
});

// ─── STRATEGIES ───────────────────────────────────────────────
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    // Cachea solo respuestas validas
    if (fresh && fresh.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    // Offline: cae a cache
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    // Si falla y no hay cache, propagar el error
    throw err;
  }
}
