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

const SW_VERSION = 'v5.11-paste';
const STATIC_CACHE = `epo67-static-${SW_VERSION}`;

// Recursos a precachear durante la instalacion (la app shell minima)
// Si algun fetch falla, no se rompe la instalacion (continueOnError).
const PRECACHE_URLS = [
  '/',
  '/index.html',
];

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
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('epo67-static-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
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
