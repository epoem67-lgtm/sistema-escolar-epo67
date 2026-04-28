// ═══════════════════════════════════════════════════════════════
// XLSX WEB WORKER — Sistema Escolar EPO 67
// Off-loads XLSX serialization off the main thread.
// Main thread sends a sheet "spec" (plain JSON, no XLSX dependency)
// and receives back an ArrayBuffer with the .xlsx bytes.
//
// Spec format:
//   {
//     sheets: [
//       { name: 'Sheet1', aoa: [[...], [...], ...],
//         merges?: [{s:{r,c},e:{r,c}}, ...],
//         cols?: [{wch:N}, ...],
//         rows?: [{hpx:N}, ...]
//       },
//       ...
//     ]
//   }
//
// Mensaje: { id, spec }
// Respuesta: { id, buf } (transferable) o { id, error }
// ═══════════════════════════════════════════════════════════════

importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');

self.onmessage = function(e) {
  const { id, spec } = e.data || {};
  if (!spec || !Array.isArray(spec.sheets)) {
    self.postMessage({ id, error: 'spec.sheets requerido' });
    return;
  }

  try {
    const wb = XLSX.utils.book_new();
    for (const s of spec.sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa || []);
      if (Array.isArray(s.merges) && s.merges.length) ws['!merges'] = s.merges;
      if (Array.isArray(s.cols)   && s.cols.length)   ws['!cols']   = s.cols;
      if (Array.isArray(s.rows)   && s.rows.length)   ws['!rows']   = s.rows;
      // Truncar nombre a 31 chars (limite Excel)
      const sheetName = (s.name || 'Sheet').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    // Transferable: el ArrayBuffer se mueve sin copia
    self.postMessage({ id, buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
