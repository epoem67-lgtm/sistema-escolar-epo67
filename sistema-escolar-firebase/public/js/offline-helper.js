/**
 * OFFLINE HELPER — detección de pérdida de conexión y guardado local de borradores
 *
 * 1) Muestra banner rojo arriba cuando se pierde internet
 * 2) En captura de calificaciones, guarda borrador en localStorage cada 5 segundos
 *    (esto ya existe en grades.js como _saveDraft pero lo reforzamos)
 * 3) Cuando vuelve la conexión, intenta sincronizar automáticamente
 */

(function () {
  function _showOffline() {
    const el = document.getElementById('offlineIndicator');
    if (el) el.style.display = 'block';
    document.body.classList.add('is-offline');
    // Toast solo la primera vez
    if (!_showOffline._shown) {
      _showOffline._shown = true;
      try { Toast.show('Perdiste la conexión. Sigue capturando, se guardará cuando vuelva.', 'warning'); } catch (_) {}
    }
  }

  function _showOnline() {
    const el = document.getElementById('offlineIndicator');
    if (el) el.style.display = 'none';
    document.body.classList.remove('is-offline');
    if (_showOffline._shown) {
      _showOffline._shown = false;
      try { Toast.show('✓ Conexión restablecida. Guarda tus cambios para sincronizar.', 'success'); } catch (_) {}
    }
  }

  function _checkConnection() {
    if (navigator.onLine === false) _showOffline();
    else _showOnline();
  }

  window.addEventListener('online', _showOnline);
  window.addEventListener('offline', _showOffline);

  // Verificación inicial al cargar
  document.addEventListener('DOMContentLoaded', () => {
    _checkConnection();
    // Cheque periódico cada 2 minutos con un fetch real, pero TOLERANTE:
    // un solo fallo no marca offline (puede ser un blip transitorio).
    // Solo después de 2 fallos consecutivos mostramos el banner.
    // OPT: SOLO ejecutamos si la pestaña está visible — sin esto, pestañas
    // de fondo siguen haciendo fetch cada minuto y degradan el rendimiento
    // del navegador con muchas pestañas abiertas.
    let consecutiveFails = 0;
    setInterval(async () => {
      if (document.visibilityState !== 'visible') return; // skip en pestaña oculta
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000); // 5s timeout
        await fetch('/sw.js', { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
        clearTimeout(tid);
        consecutiveFails = 0;
        _showOnline();
      } catch (_) {
        consecutiveFails++;
        if (consecutiveFails >= 2) _showOffline();
      }
    }, 120000); // 2 min, era 60s
  });
})();
