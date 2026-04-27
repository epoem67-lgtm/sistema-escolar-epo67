// ═══════════════════════════════════════════════════════════════
// LIB LOADER — Sistema Escolar EPO 67
// Carga librerias externas (XLSX, JSZip, Chart.js) bajo demanda.
// Antes se cargaban sincronamente al inicio (~612 KB bloqueantes)
// aunque solo se usaban al imprimir/exportar/ver indicadores.
//
// Uso: await Lib.xlsx() antes de la primera llamada a XLSX.*
//      await Lib.jszip() antes de new JSZip()
//      await Lib.chart() antes de new Chart()
//
// La promesa se cachea: la libreria solo se descarga una vez por sesion.
// ═══════════════════════════════════════════════════════════════

const Lib = (() => {
  const _loaded = {};

  function loadScript(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        delete _loaded[src]; // permite reintento
        reject(new Error('Error cargando libreria: ' + src));
      };
      document.head.appendChild(s);
    });
    return _loaded[src];
  }

  return {
    xlsx() {
      // Si ya esta global (cargada por otro lado), no descargar de nuevo
      if (typeof window.XLSX !== 'undefined') return Promise.resolve();
      return loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    },
    jszip() {
      if (typeof window.JSZip !== 'undefined') return Promise.resolve();
      return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    },
    chart() {
      if (typeof window.Chart !== 'undefined') return Promise.resolve();
      return loadScript('https://cdn.jsdelivr.net/npm/chart.js');
    }
  };
})();
