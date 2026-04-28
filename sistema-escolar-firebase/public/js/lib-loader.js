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

// ═══════════════════════════════════════════════════════════════
// XLSX WORKER — serializa XLSX en background sin bloquear el main thread
// Uso:
//   const buf = await XlsxWorker.serialize({ sheets: [{name, aoa, cols, merges, rows}] });
//   const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
//
// El worker importa XLSX desde CDN una sola vez, lo cachea, y procesa
// mensajes secuencialmente. Si el worker no se puede crear (Safari viejo,
// CSP, etc.) cae en fallback usando XLSX en main thread.
// ═══════════════════════════════════════════════════════════════
const XlsxWorker = (() => {
  let _worker = null;
  let _workerOk = null;
  let _id = 0;
  const _pending = new Map();

  function _ensure() {
    if (_worker || _workerOk === false) return;
    try {
      _worker = new Worker('/js/workers/xlsx-worker.js?v=5.9.28');
      _worker.onmessage = (e) => {
        const { id, buf, error } = e.data || {};
        const p = _pending.get(id);
        if (!p) return;
        _pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(buf);
      };
      _worker.onerror = (err) => {
        console.warn('[XlsxWorker] error:', err && err.message);
        for (const p of _pending.values()) p.reject(new Error('Worker error'));
        _pending.clear();
        _workerOk = false;
        try { _worker.terminate(); } catch(e){}
        _worker = null;
      };
      _workerOk = true;
    } catch (err) {
      console.warn('[XlsxWorker] no disponible, usando fallback main thread:', err.message);
      _workerOk = false;
    }
  }

  // Fallback: serializa en main thread con XLSX. Carga XLSX si hace falta.
  async function _fallbackSerialize(spec) {
    await Lib.xlsx();
    const wb = XLSX.utils.book_new();
    for (const s of spec.sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa || []);
      if (Array.isArray(s.merges) && s.merges.length) ws['!merges'] = s.merges;
      if (Array.isArray(s.cols)   && s.cols.length)   ws['!cols']   = s.cols;
      if (Array.isArray(s.rows)   && s.rows.length)   ws['!rows']   = s.rows;
      XLSX.utils.book_append_sheet(wb, ws, (s.name || 'Sheet').slice(0, 31));
    }
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  return {
    /**
     * Serializa un spec a ArrayBuffer en el worker.
     * @param {Object} spec - { sheets: [{name, aoa, cols?, merges?, rows?}] }
     * @returns {Promise<ArrayBuffer>}
     */
    async serialize(spec) {
      _ensure();
      if (_workerOk === false) return _fallbackSerialize(spec);

      const id = ++_id;
      return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        _worker.postMessage({ id, spec });
      });
    }
  };
})();
