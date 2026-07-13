// ═══════════════════════════════════════════════════════════════════
// COTEJO MIGE — Compara el MIGE (plataforma oficial) contra el sistema
// ═══════════════════════════════════════════════════════════════════
// MODELO cargar/consultar (para que el orientador NO necesite el archivo):
//   • ADMIN / SUBDIRECTOR / DIRECTIVA (los que tienen el export del MIGE)
//     CARGAN la carpeta completa una vez → se reparte por grupo y se guarda
//     en Firestore (migeData/{groupId}).
//   • ORIENTADOR / ORIENTADOR_DOCENTE solo CONSULTAN: eligen su grupo y ven
//     el cotejo desde lo guardado, sin subir nada. (Scope: solo sus grupos.)
//
// Formato MIGE (confirmado 2026A): un CSV POR materia, nombre del archivo =
// materia; cols 0-9 POSICIONALES (curp,nombre,apP,apM,faltasP1-3,calP1-3).
// El nombreUAC (col 19) trae comas → por eso se lee por índice fijo.
//
// El cotejo empareja alumno por NOMBRE (no hay CURP) y materia por nombre
// (IDF: exige palabra distintiva o prefijo). cal=0 en MIGE = "no capturado"
// (la cal mínima del sistema es 5) → esas materias/parciales salen como
// "pendiente en MIGE", no como focos. NO escribe calificaciones.
// ═══════════════════════════════════════════════════════════════════

const CotejoMige = (() => {
  const CONTAINER = '#moduleContainer';
  const ROLES_OK = ['admin', 'subdirector', 'directivo', 'orientador', 'orientador_docente'];
  const ROLES_LOADER = ['admin', 'subdirector', 'directivo']; // pueden CARGAR el MIGE
  const PARTIALS = ['P1', 'P2', 'P3'];

  // Estado privado
  let _groups = [];
  let _scopedGroups = [];    // grupos visibles según rol (orientador = solo los suyos)
  let _subjects = [];
  let _assignments = [];
  let _selectedGroupId = null;
  let _isLoader = false;
  let _canApply = false;     // admin/subdirector: pueden APLICAR correcciones al Sistema (ya tienen write en grades)
  let _migeSubjects = [];    // MIGE del grupo elegido (cargado de Firestore)
  let _migeMeta = null;      // { uploadedAt, uploadedBy } del grupo elegido
  let _lastResult = null;    // último resultado de cotejo (para recomputar acciones)
  let _lastCorrectedAsgs = []; // assignment ids de materias corregidas (para reimprimir F1 de golpe)
  let _lastCorrectedMats = []; // nombres de materias corregidas
  let _correctedSubjIds = new Set(); // subjectIds con cotejoFix — persiste entre recargas (badge + leyenda F1)
  let _progressDecisions = {}; // avance guardado: { key -> valor hoja } por grupo
  let _saveTimer = null;       // debounce del auto-guardado
  let _lastConcentrado = null; // snapshot de lo aplicado (para la constancia PDF)
  let _lastFolio = '';         // folio del último lote aplicado (COT-...) — liga Acta ↔ panel Correcciones

  // Folio único del lote de cotejo: COT-{yyyymmdd}-{hhmmss}-{uid4}.
  // Distinto de los folios de solicitudes de maestros y de ADM- (dirección),
  // para identificar en el panel de Correcciones que vino del Cotejo MIGE.
  function _cotejoFolio() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const uid4 = ((auth.currentUser && auth.currentUser.uid) || 'xxxx').slice(-4);
    return `COT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${uid4}`;
  }

  // ── Normalización ──
  function _norm(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function _normTight(s) { return _norm(s).replace(/\s+/g, ''); }
  function _nameWords(s) { return _norm(s).split(' ').filter(w => w.length > 1); }
  function _words4(s) { return _norm(s).split(' ').filter(w => w.length >= 4); }
  function _subjectNorm(subj) { return _normTight((subj && (subj.nombre || subj.name)) || ''); }
  // Último parcial (el F1 igual trae los 3; esto solo es el contexto que pide printMultipleAssignments)
  function _lastPartialId() {
    return (K.PARCIALES && K.PARCIALES.length)
      ? K.PARCIALES.reduce((m, p) => (p.numero > (m.numero || 0) ? p : m), K.PARCIALES[0]).id
      : 'P3';
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════
  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;

    if (!ROLES_OK.some(r => App.canActAs(r))) {
      container.innerHTML = `<div class="module-container">${UI.emptyState('block', 'Acceso restringido a Orientación / Dirección')}</div>`;
      return;
    }
    _isLoader = ROLES_LOADER.some(r => App.canActAs(r));
    // Orientación aplica en el momento (permiso acotado por cotejoFix en las rules).
    _canApply = ['admin', 'subdirector', 'orientador', 'orientador_docente'].some(r => App.canActAs(r));

    const loaderCard = _isLoader ? `
      <div class="card" style="margin-top:16px;background:#ecfdf5;border-left:4px solid #16a34a;">
        <p style="margin:0;font-size:13px;color:#14532d;line-height:1.5;">
          <span class="material-icons-round" style="vertical-align:middle;color:#16a34a;">check_circle</span>
          <strong>El MIGE ya está cargado en el sistema.</strong> Para cotejar, solo elige turno y grupo abajo — <strong>NO necesitas volver a subir la carpeta</strong>. (Aunque el recuadro de archivo se vea vacío, los datos quedaron guardados.)
        </p>
      </div>
      <details class="card" style="margin-top:12px;background:#f8fafc;border-left:4px solid #94a3b8;">
        <summary style="cursor:pointer;font-weight:600;color:#475569;font-size:13px;list-style:none;">
          <span class="material-icons-round" style="vertical-align:middle;font-size:18px;">cloud_upload</span>
          Cargar / actualizar el MIGE (solo administración) — ábrelo únicamente si el MIGE cambió
        </summary>
        <div style="margin-top:10px;">
          <p style="margin:0 0 10px;font-size:12.5px;color:#475569;line-height:1.5;">
            Sube <strong>la carpeta completa</strong> con los CSV del MIGE (elige el turno del lote). Se reparte por grupo y <strong>reemplaza</strong> lo guardado. Hazlo solo cuando actualices calificaciones en MIGE.
          </p>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;">
            <div style="flex:0 0 auto;min-width:150px;">
              <label class="form-label" for="cm-load-turno">Turno de la carpeta</label>
              <select id="cm-load-turno" class="form-select">
                <option value="MATUTINO">MATUTINO</option>
                <option value="VESPERTINO">VESPERTINO</option>
              </select>
            </div>
            <div style="flex:1;min-width:240px;">
              <label class="form-label" for="cm-load-folder">Carpeta del MIGE (todos los grupos)</label>
              <input type="file" id="cm-load-folder" webkitdirectory directory multiple class="form-input" />
              <div style="font-size:11px;color:#64748b;margin-top:3px;">Carpeta con las subcarpetas por grupo (1-1, 1-2, …).</div>
            </div>
            <div>
              <button class="btn btn-primary" id="cm-load-save" disabled>
                <span class="material-icons-round" style="vertical-align:middle;">save</span> Guardar en el sistema
              </button>
            </div>
          </div>
          <div id="cm-load-status" style="margin-top:8px;font-size:12px;color:#475569;"></div>
        </div>
      </details>` : '';

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Cotejo MIGE', 'Compara lo capturado en MIGE contra el sistema (calif + faltas de los 3 parciales)')}

        <div class="card" style="background:#f0f9ff;border-left:4px solid #0ea5e9;">
          <p style="margin:0 0 8px;font-size:13px;color:#075985;line-height:1.5;">
            <span class="material-icons-round" style="vertical-align:middle;color:#0284c7;">info</span>
            <strong>¿Qué hace esta herramienta?</strong> Compara, materia por materia, lo que tiene el <strong>Sistema EPO 67</strong> contra lo capturado en <strong>MIGE</strong>, y te muestra dónde NO coinciden. La <strong>hoja impresa firmada del maestro decide</strong> quién tiene la razón.
          </p>
          <div style="font-size:12.5px;color:#075985;line-height:1.6;">
            <strong>Pasos:</strong>
            <span style="display:inline-block;margin-left:4px;">1) Elige turno y grupo${_isLoader ? ' (si eres admin, primero carga la carpeta del MIGE abajo)' : ''}.</span>
            &nbsp; 2) Pulsa <strong>Cotejar</strong>.
            &nbsp; 3) En cada diferencia, mira la <strong>hoja firmada</strong> y escribe su valor en <strong>“Hoja dice”</strong>: el sistema te dice solo si hay que corregir MIGE o el Sistema.
            &nbsp; 4) Descarga el <strong>Concentrado</strong> y reimprime los F1 afectados.
          </div>
        </div>

        ${loaderCard}

        <!-- BLOQUE — DESCARGAR TODOS MIS GRUPOS (orientador) -->
        <div class="card" style="margin-top:16px;background:#fefce8;border-left:5px solid #eab308;">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;align-items:center;">
            <div style="flex:1;min-width:280px;">
              <h4 style="margin:0 0 6px;color:#854d0e;font-size:15px;">📋 Cotejar TODOS mis grupos de un solo tiro</h4>
              <ol style="margin:0;padding-left:20px;font-size:12.5px;color:#713f12;line-height:1.6;">
                <li>Descargas el reporte con <strong>todos tus grupos</strong> en un PDF.</li>
                <li><strong>Imprime</strong> y coteja contra las <strong>hojas firmadas</strong> de los maestros.</li>
                <li>Regresa al sistema y captura <strong>grupo por grupo</strong> las decisiones ("Sistema", "MIGE" o valor manual).</li>
                <li>Al terminar, reimprime los <strong>F1 de los grupos que se corrigieron</strong> con el botón verde de cada cotejo.</li>
              </ol>
            </div>
            <div>
              <button class="btn btn-primary" id="cm-run-all">
                <span class="material-icons-round" style="vertical-align:middle;">library_books</span>
                Descargar reporte de todos mis grupos
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div style="font-size:12.5px;color:#475569;margin-bottom:8px;">O si prefieres, coteja un grupo individual:</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
            <div style="flex:0 0 auto;min-width:150px;">
              <label class="form-label" for="cm-turno">Turno</label>
              <select id="cm-turno" class="form-select"><option value="">Cargando…</option></select>
            </div>
            <div style="flex:0 0 auto;min-width:150px;">
              <label class="form-label" for="cm-group">Grupo</label>
              <select id="cm-group" class="form-select" disabled><option value="">— Elige turno —</option></select>
            </div>
            <div>
              <button class="btn btn-primary" id="cm-run" disabled>
                <span class="material-icons-round" style="vertical-align:middle;">fact_check</span> Cotejar
              </button>
            </div>
          </div>
          <div id="cm-mige-status" style="margin-top:8px;font-size:12.5px;color:#64748b;"></div>
        </div>

        <div id="cm-progress" style="margin-top:16px;display:none;">
          <div class="card" style="background:#f0f9ff;border-left:4px solid #0ea5e9;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span class="material-icons-round loading-spinner" style="font-size:22px;color:#0284c7;">autorenew</span>
              <div id="cm-progress-text" style="font-weight:600;color:#075985;">Iniciando…</div>
            </div>
          </div>
        </div>

        <div id="cm-results" style="margin-top:16px;"></div>
        <div id="cm-subjects" style="margin-top:16px;"></div>
      </div>`;

    await _loadCatalogs();
    bindEvents();
  }

  async function _loadCatalogs() {
    let oriGroups = null;
    try {
      [_groups, _subjects, _assignments, oriGroups] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        Store.getMyAssignments(),
        Store.getOrientadorGroups(), // null = admin/subdir/directivo (todo); array = solo suyos
      ]);
    } catch (e) {
      console.error('[cotejo-mige] error cargando catálogos:', e);
      Toast.show('Error cargando catálogos: ' + (e.message || ''), 'error');
      return;
    }

    _scopedGroups = (oriGroups === null) ? [..._groups] : _groups.filter(g => oriGroups.includes(g.id));
    _scopedGroups.sort((a, b) =>
      (a.turno || '').localeCompare(b.turno || '') || (a.nombre || '').localeCompare(b.nombre || ''));

    const turnoSel = document.getElementById('cm-turno');
    if (!turnoSel) return;
    if (!_scopedGroups.length) {
      turnoSel.innerHTML = '<option value="">— sin grupos —</option>';
      turnoSel.disabled = true;
      const gsel = document.getElementById('cm-group');
      if (gsel) gsel.innerHTML = '<option value="">No tienes grupos asignados como orientador</option>';
      return;
    }
    const turnos = [...new Set(_scopedGroups.map(g => g.turno || 'SIN TURNO'))].sort();
    turnoSel.innerHTML = (turnos.length > 1 ? '<option value="">— Elige turno —</option>' : '') +
      turnos.map(t => `<option value="${Utils.sanitize(t)}">${Utils.sanitize(t)}</option>`).join('');
    if (turnos.length === 1) { turnoSel.value = turnos[0]; _populateGroups(turnos[0]); }
  }

  function _populateGroups(turno) {
    const gsel = document.getElementById('cm-group');
    if (!gsel) return;
    _selectedGroupId = null; _migeSubjects = []; _migeMeta = null;
    _setMigeStatus('');
    if (!turno) {
      gsel.innerHTML = '<option value="">— Elige turno —</option>';
      gsel.disabled = true; _updateRunBtn(); return;
    }
    const list = _scopedGroups.filter(g => (g.turno || 'SIN TURNO') === turno);
    gsel.disabled = false;
    gsel.innerHTML = '<option value="">— Elige un grupo —</option>' +
      list.map(g => `<option value="${g.id}">${Utils.sanitize(g.nombre || g.id)}</option>`).join('');
    _updateRunBtn();
  }

  let _eventsBound = false;
  function bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    const container = document.querySelector(CONTAINER);
    if (!container) return;

    document.getElementById('cm-turno')?.addEventListener('change', (e) => {
      _populateGroups(e.target.value || null);
      _renderSubjectsList();
    });
    document.getElementById('cm-group')?.addEventListener('change', (e) => {
      _onGroupSelected(e.target.value || null);
    });
    document.getElementById('cm-run')?.addEventListener('click', () => _runCotejo());
    document.getElementById('cm-run-all')?.addEventListener('click', () => _runCotejoAllMyGroups());

    // Carga masiva (solo loader)
    document.getElementById('cm-load-folder')?.addEventListener('change', (e) => {
      const btn = document.getElementById('cm-load-save');
      const files = Array.from(e.target.files || []).filter(f => /\.csv$/i.test(f.name));
      const st = document.getElementById('cm-load-status');
      _pendingLoadFiles = files;
      if (files.length) {
        if (st) st.innerHTML = `<span style="color:#16a34a;">✓ ${files.length} CSV listos. Elige el turno y pulsa "Guardar en el sistema".</span>`;
        if (btn) btn.disabled = false;
      } else {
        if (st) st.innerHTML = '<span style="color:#dc2626;">Esa carpeta no tiene archivos .csv del MIGE.</span>';
        if (btn) btn.disabled = true;
      }
    });
    document.getElementById('cm-load-save')?.addEventListener('click', () => _saveBulkMige());

    // Clicks delegados: reimprimir F1, imprimir constancia, aplicar correcciones
    container.addEventListener('click', (e) => {
      const f1 = e.target.closest('[data-action="cm-print-f1"]');
      if (f1) { _reprintF1(f1.dataset.asg, f1.dataset.partial, f1); return; }
      const cons = e.target.closest('[data-action="cm-consulta"]');
      if (cons) { _downloadConsulta(cons.dataset.asg); return; }
      if (e.target.id === 'cm-f1-all') { // marcar/desmarcar todas
        const on = e.target.checked;
        document.querySelectorAll('#cm-subjects .cm-f1-chk').forEach(c => { c.checked = on; });
        return;
      }
      if (e.target.closest('[data-action="cm-print-selected"]')) { _reprintF1Bulk(false); return; }
      const pick = e.target.closest('[data-action="cm-pick"]');
      if (pick && _lastResult) {
        const i = Number(pick.dataset.fi);
        const f = _lastResult.focos[i];
        if (!f) return;
        f.hoja = pick.dataset.val === 'SISTEMA' ? Number(f.sistema) : Number(f.mige);
        const pc = document.getElementById('cm-pick-' + i); if (pc) pc.innerHTML = _pickCellHtml(f);
        const ac = document.getElementById('cm-act-' + i); if (ac) ac.innerHTML = _pill(_decide(f));
        _recordDecision(f); _renderActions(); _renderCorreccion();
        return;
      }
      if (e.target.closest('[data-action="cm-print-mige"]')) { _printConcentrado(null, { soloMige: true }); return; }
      if (e.target.closest('[data-action="cm-print-concentrado"]')) { _printConcentrado(); return; }
      if (e.target.closest('[data-action="cm-print-constancia"]')) { _printConcentrado(_lastConcentrado); return; }
      if (e.target.closest('[data-action="cm-apply-sys"]')) { _applyCorrections(_corrList()); return; }
      if (e.target.closest('[data-action="cm-reprint-affected"]')) {
        if (!_lastCorrectedAsgs.length) { Toast.show('No hay materias corregidas por reimprimir', 'info'); return; }
        if (typeof MyF1Module === 'undefined' || typeof MyF1Module.printConcentrados !== 'function') {
          Toast.show('El módulo de Concentrado F1 no está disponible.', 'error'); return;
        }
        const _cLeg = 'COTEJADO Y CORREGIDO CON MIGE · ' + new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + (_lastFolio ? ' · Folio ' + _lastFolio : '');
        MyF1Module.printConcentrados(_lastCorrectedAsgs, { legend: _cLeg }); // Concentrado F1 (3 parciales) de lo corregido, 1 documento
        return;
      }
    });

    // "Hoja dice" → recalcula la acción de esa fila + resumen + hoja de corrección
    container.addEventListener('input', (e) => {
      const inp = e.target.closest('.cm-hoja');
      if (!inp || !_lastResult) return;
      const i = Number(inp.dataset.fi);
      const f = _lastResult.focos[i];
      if (!f) return;
      const v = String(inp.value).trim();
      f.hoja = (v === '') ? undefined : Number(v);
      const cell = document.getElementById('cm-act-' + i);
      if (cell) cell.innerHTML = _pill(_decide(f));
      _recordDecision(f);
      _renderActions();
      _renderCorreccion();
    });
  }

  let _pendingLoadFiles = [];

  function _updateRunBtn() {
    const btn = document.getElementById('cm-run');
    if (btn) btn.disabled = !(_selectedGroupId && _migeSubjects.length > 0);
  }
  function _setMigeStatus(html) {
    const el = document.getElementById('cm-mige-status');
    if (el) el.innerHTML = html;
  }

  // ═════════════════════════════════════════════════════════════════
  // PARSE CSV
  // ═════════════════════════════════════════════════════════════════
  function _materiaFromFilename(name) {
    const noExt = name.replace(/\.csv$/i, '');
    const m = noExt.match(/_\d{4}-\d{4}_\d+_\d+_(.+)$/);
    return (m ? m[1] : noExt).trim();
  }
  function _splitPositional(line) {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  }
  // Parsea un CSV → { materiaName, materiaNorm, rows:[{nombreCompleto, faltas, cal}] }
  function _parseOneCsv(text, fileName) {
    const clean = String(text || '').replace(/^﻿/, '');
    const lines = clean.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    const materiaName = _materiaFromFilename(fileName);
    const out = { materiaName, materiaNorm: _normTight(materiaName), rows: [] };
    for (let li = 1; li < lines.length; li++) {
      const r = _splitPositional(lines[li]);
      const nombre = r[1] || '', apP = r[2] || '', apM = r[3] || '';
      const nombreCompleto = [apP, apM, nombre].filter(Boolean).join(' ');
      if (!nombreCompleto.trim()) continue;
      out.rows.push({
        nombreCompleto,
        faltas: { P1: r[4], P2: r[5], P3: r[6] },
        cal: { P1: r[7], P2: r[8], P3: r[9] },
      });
    }
    return out;
  }

  // ═════════════════════════════════════════════════════════════════
  // CARGA MASIVA (loader) → reparte por grupo y guarda en Firestore
  // ═════════════════════════════════════════════════════════════════
  async function _saveBulkMige() {
    const files = _pendingLoadFiles || [];
    if (!files.length) return;
    const turno = (document.getElementById('cm-load-turno') || {}).value || 'MATUTINO';
    const st = document.getElementById('cm-load-status');
    const btn = document.getElementById('cm-load-save');
    if (btn) btn.disabled = true;

    try {
      // Agrupar archivos por su subcarpeta inmediata (nombre del grupo, ej "1-1")
      const readText = (f) => new Promise((res) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result || ''));
        rd.onerror = () => res('');
        rd.readAsText(f, 'UTF-8');
      });

      const byFolder = {};
      files.forEach(f => {
        const parts = (f.webkitRelativePath || f.name).split('/');
        const folder = parts.length >= 2 ? parts[parts.length - 2] : null;
        if (!folder) return;
        (byFolder[folder] = byFolder[folder] || []).push(f);
      });

      const uploadedBy = App.currentUser?.nombre || App.currentUser?.displayName || App.currentUser?.email || 'administración';
      const stamp = new Date().toISOString();
      const saved = [], skipped = [];

      for (const folder of Object.keys(byFolder)) {
        // Mapear carpeta → grupo del sistema (turno del lote + nombre de carpeta)
        const grp = _groups.find(g => g.id === (turno + '_' + folder) ||
          (String(g.nombre) === String(folder) && (g.turno || '') === turno));
        if (!grp) { skipped.push(folder); continue; }

        const subjects = [];
        for (const f of byFolder[folder]) {
          const parsed = _parseOneCsv(await readText(f), f.name);
          if (parsed.rows.length) subjects.push(parsed);
        }
        if (!subjects.length) { skipped.push(folder); continue; }

        await Store.saveMigeData(grp.id, {
          turno, grupoNombre: grp.nombre || folder, uploadedAt: stamp, uploadedBy, subjects,
        });
        saved.push((grp.nombre || folder) + ' (' + subjects.length + ')');
      }

      if (st) {
        st.innerHTML =
          (saved.length ? `<span style="color:#16a34a;">✓ Guardados ${saved.length} grupos: ${Utils.sanitize(saved.join(', '))}. Ya quedó en el sistema — <strong>no necesitas volver a subir</strong> (salvo que MIGE cambie).</span>` : '<span style="color:#dc2626;">No se guardó ningún grupo.</span>') +
          (skipped.length ? `<br><span style="color:#b45309;">⚠ Sin grupo equivalente en ${turno} (revisa el turno): ${Utils.sanitize(skipped.join(', '))}.</span>` : '');
      }
      Toast.show(saved.length ? `MIGE guardado: ${saved.length} grupos` : 'No se guardó nada', saved.length ? 'success' : 'error');

      // Si el grupo actualmente elegido se acaba de cargar, refrescar su estado
      if (_selectedGroupId) _onGroupSelected(_selectedGroupId);
    } catch (err) {
      console.error('[cotejo-mige] error guardando MIGE:', err);
      if (st) st.innerHTML = `<span style="color:#dc2626;">Error al guardar: ${Utils.sanitize(err.message || '')}</span>`;
      Toast.show('Error al guardar el MIGE: ' + (err.message || ''), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // SELECCIÓN DE GRUPO → cargar su MIGE guardado
  // ═════════════════════════════════════════════════════════════════
  async function _onGroupSelected(groupId) {
    _selectedGroupId = groupId || null;
    _migeSubjects = []; _migeMeta = null; _progressDecisions = {};
    // Reset del estado por-grupo para no arrastrar badges/leyendas del grupo anterior.
    _correctedSubjIds = new Set(); _lastCorrectedAsgs = []; _lastCorrectedMats = []; _lastConcentrado = null; _lastFolio = '';
    document.getElementById('cm-results') && (document.getElementById('cm-results').innerHTML = '');
    _renderSubjectsList();
    if (!_selectedGroupId) { _setMigeStatus(''); _updateRunBtn(); return; }

    // Cargar avance guardado del cotejo (borrador de decisiones) para este grupo
    try {
      const prog = await Store.getCotejoProgress(_selectedGroupId, true);
      _progressDecisions = (prog && prog.decisions) ? prog.decisions : {};
    } catch (_) { _progressDecisions = {}; }

    _setMigeStatus('<span style="color:#64748b;">Buscando MIGE guardado…</span>');
    try {
      const data = await Store.getMigeData(_selectedGroupId, true);
      if (data && Array.isArray(data.subjects) && data.subjects.length) {
        _migeSubjects = data.subjects;
        _migeMeta = { uploadedAt: data.uploadedAt, uploadedBy: data.uploadedBy };
        const fecha = _fmtFecha(data.uploadedAt);
        _setMigeStatus(`<span style="color:#16a34a;">✓ MIGE cargado (${_migeSubjects.length} materias)${fecha ? ' · ' + fecha : ''}${data.uploadedBy ? ' · por ' + Utils.sanitize(data.uploadedBy) : ''}. Pulsa <strong>Cotejar</strong>.</span>`);
      } else {
        _setMigeStatus(_isLoader
          ? '<span style="color:#b45309;">⚠ Este grupo aún no tiene MIGE cargado. Súbelo arriba en “Cargar MIGE al sistema”.</span>'
          : '<span style="color:#b45309;">⚠ La administración aún no ha cargado el MIGE de este grupo. Pídeselo para poder cotejar.</span>');
      }
    } catch (err) {
      console.error('[cotejo-mige] error leyendo MIGE:', err);
      _setMigeStatus(`<span style="color:#dc2626;">Error leyendo el MIGE: ${Utils.sanitize(err.message || '')}</span>`);
    }
    _updateRunBtn();
  }

  function _fmtFecha(iso) {
    if (!iso) return '';
    try { const d = new Date(iso); if (isNaN(d)) return ''; return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (_) { return ''; }
  }

  // ═════════════════════════════════════════════════════════════════
  // MATCHING
  // ═════════════════════════════════════════════════════════════════
  function _matchStudent(migeRow, systemStudents) {
    const target = migeRow._words || _nameWords(migeRow.nombreCompleto);
    if (!target.length) return null;
    let best = null, bestScore = 0;
    for (const st of systemStudents) {
      const w = st._words || _nameWords(st.nombreCompleto || '');
      const overlap = target.filter(x => w.includes(x)).length;
      if (overlap > bestScore) { bestScore = overlap; best = st; }
    }
    return bestScore >= 2 ? best : null;
  }
  function _matchSubject(materiaNorm, materiaName, groupSubjects) {
    const freq = {};
    const subWords = groupSubjects.map(s => {
      const w = [...new Set(_words4(s.nombre || s.name || ''))];
      w.forEach(x => { freq[x] = (freq[x] || 0) + 1; });
      return w;
    });
    const mWords = new Set(_words4(materiaName));
    let best = null, bestScore = 0;
    groupSubjects.forEach((s, i) => {
      const sn = _subjectNorm(s);
      const shared = subWords[i].filter(w => mWords.has(w));
      const hasDistinct = shared.some(w => freq[w] === 1);
      const prefix = sn.length >= 5 && (materiaNorm.startsWith(sn) || sn.startsWith(materiaNorm));
      if (!hasDistinct && !prefix) return;
      const score = shared.reduce((a, w) => a + 1 / freq[w], 0) + (prefix ? 5 : 0);
      if (score > bestScore) { bestScore = score; best = s; }
    });
    return best;
  }

  // ═════════════════════════════════════════════════════════════════
  // COTEJO
  // ═════════════════════════════════════════════════════════════════
  function _toNum(v) {
    if (v === undefined || v === null || v === '' || v === '-') return null;
    const n = Number(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function _setProgress(show, text) {
    const wrap = document.getElementById('cm-progress');
    if (wrap) wrap.style.display = show ? '' : 'none';
    const t = document.getElementById('cm-progress-text');
    if (t && text) t.textContent = text;
  }

  async function _runCotejo() {
    if (!_selectedGroupId || !_migeSubjects.length) return;
    document.getElementById('cm-results').innerHTML = '';
    _setProgress(true, 'Cargando alumnos y calificaciones del grupo…');
    try {
      const group = _groups.find(g => g.id === _selectedGroupId);
      const [students, gP1, gP2, gP3] = await Promise.all([
        Store.getStudentsByGroup(_selectedGroupId, true),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P1', true),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P2', true),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P3', true),
      ]);
      students.forEach(s => { s._words = _nameWords(s.nombreCompleto || ''); });
      const gradesByPartial = { P1: gP1, P2: gP2, P3: gP3 };
      // Materias YA corregidas por cotejo (grades con marcador cotejoFix). Persiste
      // aunque recargues la página → alimenta el badge y la leyenda del F1 oficial.
      _correctedSubjIds = new Set();
      [gP1, gP2, gP3].forEach(arr => arr.forEach(g => { if (g && g.cotejoFix && g.subjectId) _correctedSubjIds.add(g.subjectId); }));
      const subjectsById = new Map(_subjects.map(s => [s.id, s]));
      const subjIds = new Set();
      PARTIALS.forEach(p => gradesByPartial[p].forEach(g => g.subjectId && subjIds.add(g.subjectId)));
      const groupSubjects = [...subjIds].map(id => subjectsById.get(id)).filter(Boolean);
      const gradeIndex = new Map();
      PARTIALS.forEach(p => gradesByPartial[p].forEach(g => gradeIndex.set(p + '|' + g.studentId + '|' + g.subjectId, g)));

      _setProgress(true, 'Comparando celda por celda…');
      const focos = [], unmatchedSubjects = [], unmatchedStudents = new Set();
      let comparedCells = 0;

      // PASO 1: emparejar materia + detectar (materia,parcial) capturada en MIGE
      const capturado = new Set();
      for (const ms of _migeSubjects) {
        ms._subj = _matchSubject(ms.materiaNorm || _normTight(ms.materiaName), ms.materiaName, groupSubjects);
        if (!ms._subj) { unmatchedSubjects.push(ms.materiaName); continue; }
        for (const p of PARTIALS) if (ms.rows.some(r => (_toNum(r.cal[p]) || 0) > 0)) capturado.add(ms._subj.id + '|' + p);
      }
      // PASO 2: comparar
      const pendMap = new Map();
      const addPend = (subj, p) => {
        const k = subj.id + '|' + p;
        const e = pendMap.get(k) || { materia: subj.nombre || subj.name, parcial: p, alumnos: 0 };
        e.alumnos++; pendMap.set(k, e);
      };
      for (const ms of _migeSubjects) {
        const subj = ms._subj; if (!subj) continue;
        for (const mr of ms.rows) {
          const st = _matchStudent(mr, students);
          if (!st) { unmatchedStudents.add(ms.materiaName + ' · ' + mr.nombreCompleto); continue; }
          for (const p of PARTIALS) {
            const g = gradeIndex.get(p + '|' + st.id + '|' + subj.id);
            const sysCal = g ? _toNum(g.cal) : null;
            const cap = capturado.has(subj.id + '|' + p);
            if (!cap) { if (sysCal !== null) addPend(subj, p); continue; }
            const migeCal = _toNum(mr.cal[p]);
            if (sysCal !== null) {
              if (migeCal !== null && migeCal > 0) {
                comparedCells++;
                if (Number(migeCal) !== Number(sysCal)) focos.push({ materia: subj.nombre || subj.name, alumno: st.nombreCompleto, studentId: st.id, subjectId: subj.id, parcial: p, campo: 'Calif', mige: migeCal, sistema: sysCal });
              } else addPend(subj, p);
            }
            const migeF = _toNum(mr.faltas[p]);
            const sysF = g ? (_toNum(g.faltas) || 0) : null;
            if (migeF !== null && sysF !== null) {
              comparedCells++;
              if (Number(migeF) !== Number(sysF)) focos.push({ materia: subj.nombre || subj.name, alumno: st.nombreCompleto, studentId: st.id, subjectId: subj.id, parcial: p, campo: 'Faltas', mige: migeF, sistema: sysF });
            }
          }
        }
      }
      focos.sort((a, b) => (a.materia || '').localeCompare(b.materia || '') || (a.alumno || '').localeCompare(b.alumno || '') || a.parcial.localeCompare(b.parcial));
      // Restaurar el avance guardado (clics previos) sobre los focos actuales
      focos.forEach(f => { const v = _progressDecisions[_fkey(f)]; if (v !== undefined && v !== null) f.hoja = v; });
      const pendientes = [...pendMap.values()].sort((a, b) => (a.materia || '').localeCompare(b.materia || '') || a.parcial.localeCompare(b.parcial));

      _setProgress(false);
      _renderResults({
        group, focos, pendientes, unmatchedSubjects,
        unmatchedStudents: [...unmatchedStudents], comparedCells,
        materiasMatched: _migeSubjects.length - unmatchedSubjects.length,
        materiasTotal: _migeSubjects.length,
      });
      _renderSubjectsList(); // re-render con badges "✓ Cotejada y corregida" (ya se construyó _correctedSubjIds)
    } catch (err) {
      console.error('[cotejo-mige] error en cotejo:', err);
      _setProgress(false);
      Toast.show('Error en el cotejo: ' + (err.message || ''), 'error');
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // RESULTADOS — separados CALIFICACIONES / FALTAS, por materia → parcial,
  // Sistema vs MIGE, con "Hoja dice" (la hoja manda) y acciones que se
  // arman solas. La regla de decisión la pone el orientador con la hoja.
  // ═════════════════════════════════════════════════════════════════
  function _decide(f) {
    const s = Number(f.sistema), m = Number(f.mige), h = f.hoja;
    if (h === undefined || h === null || h === '') return { t: '⬅ elige con la hoja', c: 'rev', side: null };
    const hn = Number(h), eqS = hn === s, eqM = hn === m;
    if (eqS && !eqM) return { t: 'Corregir MIGE → ' + s, c: 'sys', side: 'mige' };
    if (eqM && !eqS) return { t: 'Corregir Sistema → ' + m, c: 'mige', side: 'sistema' };
    if (!eqS && !eqM) return { t: 'Corregir ambos → ' + hn, c: 'both', side: 'ambos' };
    return { t: 'Ya coincide', c: 'sys', side: null };
  }
  function _pill(d) {
    const map = { sys: 'background:#c6f6d5;color:#22543d;', mige: 'background:#feebc8;color:#7b341e;', rev: 'background:#e2e8f0;color:#475569;', both: 'background:#fed7d7;color:#822727;' };
    return `<span style="display:inline-block;${map[d.c] || map.rev}padding:2px 9px;border-radius:20px;font-size:11.5px;font-weight:600;white-space:nowrap;">${d.t}</span>`;
  }

  // ── Auto-guardado del avance (borrador de decisiones) ──
  function _fkey(f) { return [f.studentId, f.subjectId, f.parcial, f.campo].join('|'); }
  function _recordDecision(f) {
    const k = _fkey(f);
    if (f.hoja === undefined || f.hoja === null || f.hoja === '') delete _progressDecisions[k];
    else _progressDecisions[k] = Number(f.hoja);
    _scheduleSaveProgress();
  }
  function _setSaveState(txt, color) {
    const el = document.getElementById('cm-save-state');
    if (el) { el.textContent = txt; el.style.color = color || '#64748b'; }
  }
  function _scheduleSaveProgress() {
    if (!_selectedGroupId) return;
    _setSaveState('Guardando…', '#b45309');
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      try {
        await Store.saveCotejoProgress(_selectedGroupId, {
          decisions: _progressDecisions,
          updatedAt: new Date().toISOString(),
          updatedBy: (App.currentUser && (App.currentUser.nombre || App.currentUser.displayName || App.currentUser.email)) || '',
        });
        _setSaveState('✓ Guardado', '#16a34a');
      } catch (e) {
        console.error('[cotejo-mige] error guardando avance:', e);
        _setSaveState('⚠ No se pudo guardar', '#dc2626');
      }
    }, 700);
  }
  // Celda "¿cuál coincide con la hoja?": 2 botones (Sistema/MIGE) + input "otro".
  function _pickCellHtml(f) {
    const sel = (f.hoja !== undefined && f.hoja !== null && f.hoja !== '');
    const isS = sel && Number(f.hoja) === Number(f.sistema);
    const isM = sel && Number(f.hoja) === Number(f.mige);
    const otro = sel && !isS && !isM ? f.hoja : '';
    const btn = (val, label, on, color) => `<button type="button" data-action="cm-pick" data-fi="${f._i}" data-val="${val}" title="La hoja dice lo mismo que ${label}" style="cursor:pointer;margin:1px 2px;padding:4px 9px;border-radius:6px;border:1px solid ${on ? color : '#cbd5e0'};background:${on ? (val === 'SISTEMA' ? '#dbeafe' : '#fde9d3') : '#fff'};font-size:11.5px;font-weight:700;color:${on ? color : '#334155'};">${on ? '✓ ' : ''}${label}</button>`;
    return `${btn('SISTEMA', 'Sistema ' + f.sistema, isS, '#1d4ed8')}${btn('MIGE', 'MIGE ' + f.mige, isM, '#b45309')}<input type="number" class="cm-hoja" data-fi="${f._i}" value="${otro}" placeholder="otro" title="Si la hoja dice un número distinto, escríbelo aquí" style="width:48px;text-align:center;padding:3px;border:1px solid #cbd5e0;border-radius:6px;margin-left:2px;">`;
  }
  function _rowHtml(f) {
    return `<tr>
      <td>${Utils.sanitize(Utils.displayName ? Utils.displayName(f.alumno) : f.alumno)}</td>
      <td style="text-align:center;">${f.parcial}</td>
      <td style="text-align:center;font-weight:700;color:#2563eb;">${f.sistema}</td>
      <td style="text-align:center;font-weight:700;color:#b45309;">${f.mige}</td>
      <td id="cm-pick-${f._i}" style="white-space:nowrap;">${_pickCellHtml(f)}</td>
      <td id="cm-act-${f._i}">${_pill(_decide(f))}</td>
    </tr>`;
  }
  function _bloque(titulo, icon, color, list) {
    if (!list.length) return '';
    const byMat = new Map();
    list.forEach(f => { if (!byMat.has(f.materia)) byMat.set(f.materia, []); byMat.get(f.materia).push(f); });
    let inner = '';
    [...byMat.keys()].sort((a, b) => a.localeCompare(b)).forEach(mat => {
      const rows = byMat.get(mat).sort((a, b) => a.parcial.localeCompare(b.parcial) || (a.alumno || '').localeCompare(b.alumno || ''));
      inner += `<div style="margin-top:14px;">
        <div style="font-weight:700;color:${color};font-size:14px;margin-bottom:4px;">${Utils.sanitize(mat)} <span style="font-weight:400;color:#94a3b8;font-size:12px;">· ${rows.length} alumno(s)</span></div>
        <table class="table-light" style="font-size:12px;">
          <thead><tr>
            <th>Alumno</th><th style="text-align:center;">Parcial</th>
            <th style="text-align:center;color:#2563eb;">Sistema EPO 67</th>
            <th style="text-align:center;color:#b45309;">MIGE</th>
            <th style="text-align:center;">¿Cuál coincide con la hoja? (da clic)</th><th>Acción</th>
          </tr></thead>
          <tbody>${rows.map(_rowHtml).join('')}</tbody>
        </table></div>`;
    });
    return `<div class="card" style="margin-top:12px;border-top:4px solid ${color};">
        <h4 style="margin:0;color:${color};">${icon} ${titulo} — ${list.length} diferencia(s) en ${byMat.size} materia(s)</h4>
        ${inner}</div>`;
  }
  function _renderActions() {
    const el = document.getElementById('cm-actions');
    if (!el || !_lastResult) return;
    const focos = _lastResult.focos;
    const decided = focos.filter(f => f.hoja !== undefined && f.hoja !== null && f.hoja !== '');
    const migeN = decided.filter(f => { const d = _decide(f); return d.side === 'mige' || d.side === 'ambos'; }).length;
    const sysList = decided.filter(f => { const d = _decide(f); return d.side === 'sistema' || d.side === 'ambos'; });
    const f1Mat = [...new Set(sysList.map(f => f.materia))];
    const restan = focos.length - decided.length;
    const total = focos.length;
    const pct = total ? Math.round(decided.length / total * 100) : 0;
    el.innerHTML = `<div class="card" style="margin-top:12px;background:#f8fafc;border-left:4px solid #334155;">
      <h4 style="margin:0 0 6px;color:#1e293b;">✅ Tu avance y qué sigue</h4>
      <div style="font-size:12.5px;color:#1e293b;margin:0 0 6px;">
        <strong>Avance: ${decided.length} de ${total} resueltas</strong> (${pct}%).
        ${restan ? `Faltan <strong>${restan}</strong> por elegir con la hoja.` : '✓ ¡Terminaste de revisar todas!'}
        <div style="height:8px;background:#e2e8f0;border-radius:20px;margin-top:4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${pct===100?'#16a34a':'#2563eb'};"></div></div>
      </div>
      <ol style="margin:6px 0 0;padding-left:20px;font-size:13px;color:#334155;line-height:1.8;">
        <li><strong>MIGE (plataforma):</strong> ${migeN} celda(s) a capturar en MIGE. Están listadas en el <strong>Concentrado</strong> abajo.</li>
        <li><strong>Sistema EPO 67:</strong> ${sysList.length} celda(s) a corregir. ${_canApply ? 'Pulsa <strong>Aplicar al Sistema</strong> en el Concentrado.' : 'Lo aplica Dirección.'}</li>
        <li><strong>Reimprimir F1:</strong> ${f1Mat.length ? '<strong>' + f1Mat.map(m => Utils.sanitize(m)).join(', ') + '</strong>' : '<span style="color:#94a3b8;">— ninguna aún</span>'}.</li>
      </ol>
      <div style="margin-top:8px;padding:8px 10px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px;font-size:11.5px;color:#3730a3;line-height:1.5;">
        <strong>¿Cuándo se guarda y dónde lo compruebo?</strong> Tus clics son un <strong>borrador</strong> (aún no cambian nada). Se <strong>guarda de verdad</strong> cuando Dirección pulsa <strong>“Aplicar al Sistema”</strong>: ahí queda escrito en el sistema y registrado en <strong>Bitácora de Cambios</strong> (menú izquierdo), con tu nombre y la fecha. Lo de MIGE se captura aparte en esa plataforma.
      </div>
    </div>`;
  }
  function _pendientesHtml(pend, pendCeldas) {
    if (!pend.length) return '';
    return `<div class="card" style="margin-top:12px;background:#f0f9ff;border-left:4px solid #0ea5e9;">
        <h4 style="margin:0 0 6px;color:#075985;"><span class="material-icons-round" style="vertical-align:middle;font-size:18px;">cloud_upload</span> A revisar en MIGE — calificación en 0 (${pend.length} materia-parcial · ${pendCeldas} alumnos)</h4>
        <p style="margin:0 0 8px;font-size:12px;color:#075985;">El sistema sí tiene calificación; MIGE la trae en 0 (pendiente de capturar o CSV desfasado). No es un error de discrepancia.</p>
        <table class="table-light" style="font-size:12px;"><thead><tr><th>Materia</th><th style="text-align:center;">Parcial</th><th style="text-align:center;">Alumnos</th></tr></thead>
          <tbody>${pend.map(e => `<tr><td>${Utils.sanitize(e.materia)}</td><td style="text-align:center;">${e.parcial}</td><td style="text-align:center;font-weight:600;">${e.alumnos}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function _unmatchedHtml(r) {
    let h = '';
    if (r.unmatchedSubjects.length) h += `<div class="card" style="margin-top:12px;background:#fffbeb;border-left:4px solid #d97706;">
        <h4 style="margin:0 0 6px;color:#92400e;">🟠 Materias del MIGE sin equivalente en el grupo (${r.unmatchedSubjects.length})</h4>
        <ul style="margin:0 0 0 18px;font-size:12px;color:#78350f;">${r.unmatchedSubjects.map(m => `<li>${Utils.sanitize(m)}</li>`).join('')}</ul></div>`;
    if (r.unmatchedStudents.length) h += `<div class="card" style="margin-top:12px;background:#fffbeb;border-left:4px solid #d97706;">
        <h4 style="margin:0 0 6px;color:#92400e;">🟠 Alumnos del MIGE sin match en el sistema (${r.unmatchedStudents.length})</h4>
        <ul style="margin:0 0 0 18px;font-size:12px;color:#78350f;">${r.unmatchedStudents.slice(0, 40).map(x => `<li>${Utils.sanitize(x)}</li>`).join('')}</ul>
        ${r.unmatchedStudents.length > 40 ? `<p style="font-size:11px;color:#a16207;margin:6px 0 0;">…y ${r.unmatchedStudents.length - 40} más</p>` : ''}</div>`;
    return h;
  }

  function _renderResults(r) {
    _lastResult = r;
    r.focos.forEach((f, i) => { f._i = i; });
    const div = document.getElementById('cm-results');
    const cal = r.focos.filter(f => f.campo === 'Calif');
    const fal = r.focos.filter(f => f.campo === 'Faltas');
    const pend = r.pendientes || [];
    const pendCeldas = pend.reduce((s, e) => s + e.alumnos, 0);

    if (!r.focos.length) {
      div.innerHTML = `<div class="card" style="background:#dcfce7;border-left:5px solid #16a34a;">
          <h3 style="margin:0;color:#14532d;">✓ Todo coincide — el MIGE y el sistema son idénticos en este grupo</h3>
          <p style="margin:8px 0 0;font-size:13px;color:#14532d;">${r.materiasMatched}/${r.materiasTotal} materias · ${r.comparedCells.toLocaleString()} celdas comparadas, sin diferencias.</p>
        </div>` + _pendientesHtml(pend, pendCeldas) + _unmatchedHtml(r);
      return;
    }

    const materiasAfectadas = new Set(r.focos.map(f => f.materia)).size;
    let html = `
      <div class="card" style="background:#eff6ff;border-left:5px solid #2563eb;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;color:#1e3a8a;">Resultado del cotejo — ${Utils.sanitize(r.group?.nombre || '')}</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span id="cm-save-state" style="font-size:12px;font-weight:600;color:#16a34a;">✓ Avance guardado</span>
            <button class="btn btn-outline btn-sm" id="cm-download-report"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">picture_as_pdf</span> Descargar reporte (PDF)</button>
            <button class="btn btn-outline btn-sm" id="cm-download-csv"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">download</span> CSV</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12.5px;margin:8px 0;">
          <span style="background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:20px;font-weight:600;">📘 ${cal.length} de calificación</span>
          <span style="background:#ede9fe;color:#5b21b6;padding:3px 10px;border-radius:20px;font-weight:600;">🗓️ ${fal.length} de faltas</span>
          <span style="background:#f1f5f9;color:#334155;padding:3px 10px;border-radius:20px;font-weight:600;">en ${materiasAfectadas} materia(s)</span>
        </div>
      </div>`;

    // Guía con EJEMPLO usando el primer alumno real de la lista
    const ex = r.focos[0];
    if (ex) {
      const exAl = Utils.displayName ? Utils.displayName(ex.alumno) : ex.alumno;
      html += `
      <div class="card" style="background:#fefce8;border:1px solid #fde047;border-left:5px solid #eab308;">
        <h4 style="margin:0 0 6px;color:#854d0e;">📋 ¿Qué tengo que hacer aquí? (léelo una vez)</h4>
        <p style="margin:0 0 6px;font-size:12.5px;color:#713f12;line-height:1.55;">
          Cada renglón es un alumno donde el <strong style="color:#2563eb;">Sistema</strong> y <strong style="color:#b45309;">MIGE</strong> NO coinciden.
          Tú, con la <strong>hoja firmada del maestro</strong> en la mano, das <strong>UN clic</strong> en el botón que coincide con la hoja. Nada de escribir.
        </p>
        <div style="background:#fff;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;font-size:12px;color:#422006;line-height:1.6;">
          <strong>Ejemplo (tu primer renglón):</strong> <strong>${Utils.sanitize(exAl)}</strong> · ${Utils.sanitize(ex.materia)} · ${ex.parcial} — el Sistema dice <strong style="color:#2563eb;">${ex.sistema}</strong> y MIGE dice <strong style="color:#b45309;">${ex.mige}</strong>.<br>
          Mira su hoja firmada: si dice <strong>${ex.sistema}</strong> → clic en <strong>“Sistema ${ex.sistema}”</strong> (se corrige MIGE). Si dice <strong>${ex.mige}</strong> → clic en <strong>“MIGE ${ex.mige}”</strong> (se corrige el Sistema). Si dice otro número, escríbelo en la casilla.
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:#854d0e;">Al terminar de dar clic en todos, baja al <strong>🗂️ Concentrado de ajustes</strong>: ahí está la lista para MIGE y el botón para descargar todo / aplicar.</p>
      </div>`;
    }

    html += _bloque('CALIFICACIONES', '📘', '#2563eb', cal);
    html += _bloque('FALTAS', '🗓️', '#7c3aed', fal);
    html += `<div id="cm-actions"></div>`;
    html += `<div id="cm-correccion"></div>`;
    html += _pendientesHtml(pend, pendCeldas);
    html += _unmatchedHtml(r);

    div.innerHTML = html;
    _renderActions();
    _renderCorreccion();
    document.getElementById('cm-download-csv')?.addEventListener('click', () => _downloadFocosCsv(r.focos, r.group));
    document.getElementById('cm-download-report')?.addEventListener('click', () => _printReport(r));
  }

  // Reporte imprimible/descargable (PDF vía diálogo) — para cotejar en papel con
  // las hojas: incluye columna "Hoja" en blanco para anotar a mano.
  function _printReport(r) {
    const g = r.group || {};
    const esc = s => Utils.sanitize(String(s == null ? '' : s));
    const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    const cal = r.focos.filter(f => f.campo === 'Calif');
    const fal = r.focos.filter(f => f.campo === 'Faltas');
    const sec = (titulo, subt, list) => {
      if (!list.length) return `<h3>${titulo}</h3><p style="color:#555;">Sin diferencias en ${subt}. ✓</p>`;
      const rows = list.slice().sort((a, b) => (a.materia || '').localeCompare(b.materia || '') || a.parcial.localeCompare(b.parcial) || (a.alumno || '').localeCompare(b.alumno || ''));
      return `<h3>${titulo} — ${list.length} por revisar</h3>
        <table><thead><tr><th>Materia</th><th>Alumno</th><th>Parcial</th><th>Sistema<br>EPO 67</th><th>MIGE</th><th>¿Qué dice<br>la hoja?</th><th>¿Dónde corregir?<br>(marca)</th></tr></thead>
        <tbody>${rows.map(f => `<tr><td>${esc(f.materia)}</td><td>${esc(Utils.displayName ? Utils.displayName(f.alumno) : f.alumno)}</td><td class="c">${esc(f.parcial)}</td><td class="c b">${esc(f.sistema)}</td><td class="c b">${esc(f.mige)}</td><td class="c anota"></td><td class="c mini">☐ MIGE&nbsp;&nbsp;☐ Sist.</td></tr>`).join('')}</tbody></table>`;
    };
    const w = window.open('', '_blank');
    if (!w) { Toast.show('Permite ventanas emergentes para descargar el reporte', 'error'); return; }
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Cotejo MIGE ${esc(g.nombre || '')}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:22px;font-size:11.5px;}
        h1{font-size:15px;text-align:center;margin:0 0 2px;} .sub{text-align:center;color:#444;font-size:10.5px;margin:0;}
        h2t{}
        h3{font-size:12.5px;margin:14px 0 4px;border-bottom:2px solid #333;padding-bottom:2px;}
        .meta{margin:10px 0;} .meta b{min-width:55px;display:inline-block;}
        .guia{border:2px solid #2563eb;border-radius:8px;padding:10px 14px;margin:10px 0;background:#f0f6ff;}
        .guia h2{font-size:13px;margin:0 0 4px;color:#1e3a8a;}
        .guia ol{margin:4px 0 0 18px;padding:0;line-height:1.6;font-size:11.5px;}
        .guia .regla{margin-top:8px;font-size:11px;background:#fff;border:1px solid #bfd3f5;border-radius:6px;padding:7px 9px;}
        table{border-collapse:collapse;width:100%;margin-top:4px;} th,td{border:1px solid #999;padding:4px 6px;} th{background:#eee;text-align:left;font-size:10px;} td.c{text-align:center;} td.b{font-weight:bold;} td.anota{min-width:60px;} td.mini{font-size:10px;white-space:nowrap;}
        .foot{margin-top:14px;font-size:10px;color:#555;}
        @media print{body{margin:10mm;}}
      </style></head><body>
      <h1>ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
      <p class="sub">C.C.T. 15EBH0134D · Ciclo 2025-2026</p>
      <p class="sub" style="font-size:12px;color:#111;margin-top:4px;"><strong>HOJA DE COTEJO — Sistema EPO 67 vs MIGE</strong></p>
      <div class="meta"><b>Grupo:</b> ${esc(g.nombre || '')} &nbsp; <b>Turno:</b> ${esc(g.turno || '')} &nbsp; <b>Fecha:</b> ${esc(hoy)} &nbsp; <b>Total por revisar:</b> ${r.focos.length} (${cal.length} de calificación · ${fal.length} de faltas)</div>

      <div class="guia">
        <h2>¿Qué es esta hoja?</h2>
        <p style="margin:0;font-size:11.5px;">Son los alumnos donde <b>NO coincide</b> lo que tiene el Sistema EPO 67 con lo capturado en MIGE. <b>Todavía no sabemos quién está mal</b>: lo decide la <b>hoja impresa firmada por el maestro</b>.</p>
        <h2 style="margin-top:8px;">¿Qué debes hacer tú (Orientación)? — 4 pasos</h2>
        <ol>
          <li>Toma la <b>hoja firmada del maestro</b> de esa materia.</li>
          <li>Busca al alumno y ese parcial; fíjate qué calificación/falta tiene en la hoja.</li>
          <li>Escribe ese número en la columna <b>"¿Qué dice la hoja?"</b>.</li>
          <li>Compara y <b>marca</b> dónde corregir, según la regla de abajo.</li>
        </ol>
        <div class="regla">
          <b>Regla para decidir (usa la hoja como juez):</b><br>
          • Si la hoja dice <b>lo mismo que “Sistema EPO 67”</b> → el error está en MIGE → marca <b>☐ MIGE</b> (hay que corregir MIGE).<br>
          • Si la hoja dice <b>lo mismo que “MIGE”</b> → el error está en el Sistema → marca <b>☐ Sist.</b> (avisar a Dirección para corregir el Sistema).<br>
          • Si la hoja dice <b>otro número distinto</b> a ambos → anótalo y marca los dos (hay que corregir MIGE y Sistema).
        </div>
        <p style="margin:6px 0 0;font-size:10.5px;color:#555;">Al terminar, entrega esta hoja a Dirección: las de "MIGE" se capturan en la plataforma; las de "Sist." las aplica Dirección en el sistema y se reimprime el F1 de esa materia.</p>
      </div>

      ${sec('CALIFICACIONES', 'calificaciones', cal)}
      ${sec('FALTAS', 'faltas', fal)}
      <p class="foot">Sistema Escolar EPO 67 · La hoja física firmada es la fuente de verdad. Cotejó (Orientación): ____________________________</p>
      </body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
  }

  // ── Concentrado de ajustes: Sistema (Dirección aplica) + MIGE (capturar en plataforma) ──
  const _sortFocos = (a, b) => (a.materia || '').localeCompare(b.materia || '') || a.parcial.localeCompare(b.parcial) || (a.alumno || '').localeCompare(b.alumno || '');
  function _corrList() { // cambios al SISTEMA (la hoja difiere del sistema)
    if (!_lastResult) return [];
    return _lastResult.focos.filter(f => { const d = _decide(f); return d.side === 'sistema' || d.side === 'ambos'; });
  }
  function _migeList() { // ajustes en MIGE (la hoja difiere de MIGE)
    if (!_lastResult) return [];
    return _lastResult.focos.filter(f => { const d = _decide(f); return d.side === 'mige' || d.side === 'ambos'; });
  }
  function _renderCorreccion() {
    const el = document.getElementById('cm-correccion');
    if (!el) return;
    const sysList = _corrList(), migeL = _migeList();
    if (!sysList.length && !migeL.length) { el.innerHTML = ''; return; }
    const rowTxt = (f, actualKey) => `<tr><td>${Utils.sanitize(Utils.displayName ? Utils.displayName(f.alumno) : f.alumno)}</td><td>${Utils.sanitize(f.materia)}</td><td style="text-align:center;">${f.parcial}</td><td style="text-align:center;">${f.campo}</td><td style="text-align:center;color:#64748b;">${f[actualKey]}</td><td style="text-align:center;font-weight:700;color:#16a34a;">${f.hoja}</td></tr>`;

    const migeBlock = migeL.length ? `
      <div style="margin-top:6px;padding-top:8px;border-top:1px dashed #cbd5e0;">
        <div style="font-weight:700;color:#b45309;font-size:13px;">🟠 En MIGE — capturar directamente en la plataforma (${migeL.length})</div>
        <p style="font-size:11.5px;color:#7b341e;margin:2px 0 6px;">El Sistema/hoja ya coinciden; falta ajustar MIGE. Quien tenga acceso a MIGE cambia estos valores.</p>
        <table class="table-light" style="font-size:12px;"><thead><tr><th>Alumno</th><th>Materia</th><th style="text-align:center;">Parcial</th><th style="text-align:center;">Campo</th><th style="text-align:center;">MIGE tiene</th><th style="text-align:center;">→ Poner</th></tr></thead>
          <tbody>${migeL.slice().sort(_sortFocos).map(f => rowTxt(f, 'mige')).join('')}</tbody></table>
      </div>` : '';

    const sysBlock = sysList.length ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #cbd5e0;">
        <div style="font-weight:700;color:#5b21b6;font-size:13px;">📝 En el Sistema EPO 67 — Dirección aplica (${sysList.length})</div>
        <p style="font-size:11.5px;color:#6b21a8;margin:2px 0 6px;">Se corrige el Sistema con el valor de la <strong>hoja firmada</strong>. ${_canApply ? 'Pulsa <strong>Aplicar</strong>; queda en la Bitácora.' : 'Lo aplica Dirección (admin/subdirección).'}</p>
        <table class="table-light" style="font-size:12px;"><thead><tr><th>Alumno</th><th>Materia</th><th style="text-align:center;">Parcial</th><th style="text-align:center;">Campo</th><th style="text-align:center;">Sistema actual</th><th style="text-align:center;">→ Nuevo (hoja)</th></tr></thead>
          <tbody>${sysList.slice().sort(_sortFocos).map(f => rowTxt(f, 'sistema')).join('')}</tbody></table>
        ${_canApply ? `<div style="margin-top:8px;"><button class="btn btn-primary btn-sm" data-action="cm-apply-sys"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">save</span> Aplicar al Sistema (${sysList.length})</button></div>` : ''}
      </div>` : '';

    el.innerHTML = `<div class="card" style="margin-top:12px;border:2px solid #334155;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h4 style="margin:0;color:#1e293b;">🗂️ Concentrado de ajustes del grupo</h4>
          <button class="btn btn-outline btn-sm" data-action="cm-print-mige"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">upload_file</span> Reporte para MIGE (Dirección)</button>
          <button class="btn btn-outline btn-sm" data-action="cm-print-concentrado"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">picture_as_pdf</span> Reporte completo (MIGE + Sistema)</button>
        </div>
        <p style="font-size:12px;color:#475569;margin:6px 0 4px;">Todo lo que se tuvo que mover en este grupo, en un solo documento: lo que va a <strong>MIGE</strong> y lo que va al <strong>Sistema</strong>. La hoja física firmada es la fuente de verdad.</p>
        ${migeBlock}${sysBlock}</div>`;
  }

  // Concentrado de ajustes (PDF): Parte A = ajustes en MIGE (por capturar);
  // Parte B = correcciones al Sistema (constancia con firmas). Un solo documento.
  function _printConcentrado(snap, opts = {}) {
    const soloMige = !!(opts && opts.soloMige);
    const migeL = (snap && snap.mige) ? snap.mige : _migeList();
    const sysList = soloMige ? [] : ((snap && snap.sys) ? snap.sys : _corrList());
    if (!migeL.length && !sysList.length) { Toast.show(soloMige ? 'No hay ajustes de MIGE que reportar' : 'No hay ajustes que reportar todavía (captura la hoja primero)', 'info'); return; }
    const g = snap ? snap.group : (_lastResult && _lastResult.group);
    const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    const quien = App.currentUser?.nombre ? Utils.displayName(App.currentUser.nombre) : (App.currentUser?.displayName || '________________________');
    const folio = (snap && snap.folio) ? snap.folio : '';
    const dir = (App.staffName && App.staffName('director')) || 'Dirección Escolar';
    const esc = s => Utils.sanitize(String(s == null ? '' : s));
    const tabla = (list, actualKey, actualLabel) => {
      const rows = list.slice().sort(_sortFocos);
      return `<table><thead><tr><th>#</th><th>Alumno</th><th>Materia</th><th>Parcial</th><th>Dato</th><th>${actualLabel}</th><th>Debe decir</th></tr></thead>
        <tbody>${rows.map((f, i) => `<tr><td class="c">${i + 1}</td><td>${esc(Utils.displayName ? Utils.displayName(f.alumno) : f.alumno)}</td><td>${esc(f.materia)}</td><td class="c">${esc(f.parcial)}</td><td class="c">${esc(f.campo)}</td><td class="c">${esc(f[actualKey])}</td><td class="c"><strong>${esc(f.hoja)}</strong></td></tr>`).join('')}</tbody></table>`;
    };
    const w = window.open('', '_blank');
    if (!w) { Toast.show('Permite ventanas emergentes para imprimir', 'error'); return; }
    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Concentrado de ajustes ${esc((g && g.nombre) || '')}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:30px;font-size:11.5px;}
        h1{font-size:15px;text-align:center;margin:0 0 2px;} .sub{text-align:center;color:#444;font-size:10.5px;margin:0;}
        h3{font-size:12.5px;margin:16px 0 4px;border-bottom:2px solid #333;padding-bottom:2px;}
        .meta{margin:12px 0;} .meta b{display:inline-block;min-width:60px;}
        p.intro{font-size:10.5px;line-height:1.5;color:#333;}
        table{border-collapse:collapse;width:100%;margin-top:4px;font-size:11px;} th,td{border:1px solid #999;padding:4px 6px;} th{background:#eee;text-align:left;} td.c{text-align:center;}
        .firmas{display:flex;justify-content:space-around;margin-top:50px;text-align:center;font-size:11px;} .firmas div{width:40%;border-top:1px solid #333;padding-top:4px;}
        @media print{body{margin:12mm;}}
      </style></head><body>
      <h1>ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
      <p class="sub">C.C.T. 15EBH0134D · Ciclo 2025-2026</p>
      <p class="sub"><strong>${soloMige ? 'AJUSTES A CAPTURAR EN MIGE — PARA DIRECCIÓN' : 'CONCENTRADO DE AJUSTES POR COTEJO CON MIGE'}</strong></p>
      <div class="meta"><b>Grupo:</b> ${esc((g && g.nombre) || '')} &nbsp; <b>Turno:</b> ${esc((g && g.turno) || '')} &nbsp; <b>Fecha:</b> ${esc(hoy)}${folio ? ` &nbsp; <b>Folio:</b> ${esc(folio)}` : ''}</div>
      <p class="intro">Resultado del cotejo entre el Sistema Escolar EPO 67 y la plataforma MIGE, verificado contra las <strong>hojas oficiales firmadas</strong> por los docentes (fuente de verdad). Se detallan los ajustes a realizar en cada plataforma.</p>
      <h3>${soloMige ? 'Ajustes a capturar en MIGE' : 'PARTE A — Ajustes a capturar en MIGE'} (${migeL.length})</h3>
      ${migeL.length ? `<p class="intro">En la plataforma MIGE, cambiar cada celda al valor de la columna "Debe decir".</p>${tabla(migeL, 'mige', 'MIGE tiene')}` : '<p class="intro">Sin ajustes en MIGE.</p>'}
      ${soloMige ? '' : `<h3>PARTE B — Correcciones aplicadas al Sistema EPO 67 (${sysList.length})</h3>
      ${sysList.length ? `<p class="intro">Corregidas en el Sistema conforme a la hoja firmada. Quedan registradas en la <strong>Bitácora de Cambios</strong>; las de calificación además en el panel <strong>Correcciones → Aplicadas</strong>${folio ? ` (folio ${esc(folio)})` : ''}.</p>${tabla(sysList, 'sistema', 'Sistema tenía')}` : '<p class="intro">Sin correcciones al sistema.</p>'}`}
      <div class="firmas"><div>${esc(quien)}<br>Cotejó — Orientación</div><div>${esc(dir)}<br>Vo. Bo. Dirección</div></div>
      </body></html>`);
    w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
  }

  async function _applyCorrections(list) {
    if (!_canApply) { Toast.show('Solo Dirección (admin/subdirección) puede aplicar', 'error'); return; }
    if (!list.length) return;
    if (!window.confirm(`Vas a aplicar ${list.length} corrección(es) al Sistema EPO 67 (según las hojas firmadas). Cada cambio queda en la Bitácora a tu nombre; las de calificación también en el panel de Correcciones (Aplicadas). ¿Continuar?`)) return;
    _setProgress(true, 'Aplicando correcciones al sistema…');

    // Folio único del lote (liga el Acta con el panel de Correcciones).
    const _folio = _cotejoFolio();
    const _role = App.currentUser && App.currentUser.role;
    const _canWriteCorr = (_role === 'admin' || _role === 'subdirector'); // rules FLUJO 2: 'applied' solo admin/subdir
    const _userName = (App.currentUser && App.currentUser.nombre && Utils.displayName)
      ? Utils.displayName(App.currentUser.nombre)
      : ((App.currentUser && (App.currentUser.displayName || App.currentUser.email)) || '');
    const _g = _lastResult && _lastResult.group;

    let okN = 0, errN = 0, corrN = 0;
    for (const f of list) {
      try {
        const gradeDocId = `${f.studentId}_${f.subjectId}_${f.parcial}`;
        const nuevo = Number(f.hoja);
        const payload = {
          // v8.43 BLINDAJE: identidad completa SIEMPRE. Las rules exigen doc
          // bien formado al CREAR (cal que faltaba en el sistema) y que la
          // identidad no cambie al EDITAR. Sin esto, corregir una cal
          // inexistente crearía un doc huérfano sin studentId/groupId.
          studentId: f.studentId, subjectId: f.subjectId,
          groupId: _selectedGroupId, partial: f.parcial,
          updatedAt: new Date(), updatedBy: auth.currentUser.uid,
          cotejoFix: { at: new Date().toISOString(), by: auth.currentUser.uid, campo: f.campo, antes: f.sistema, despues: nuevo, mige: f.mige, group: _selectedGroupId },
        };
        if (f.campo === 'Calif') { payload.cal = nuevo; payload.value = nuevo; payload.suma = nuevo; payload.correctedFromCal = f.sistema; }
        else { payload.faltas = nuevo; }
        await db.collection('grades').doc(gradeDocId).set(payload, { merge: true });
        await DB.audit('corrección post-cotejo', f.campo === 'Calif' ? 'calificación' : 'faltas', gradeDocId, {
          description: `Cotejo MIGE ${(_lastResult.group && _lastResult.group.nombre) || ''}: ${f.alumno} · ${f.materia} · ${f.parcial} · ${f.campo}: ${f.sistema} → ${nuevo}`,
          extra: { before: f.sistema, after: nuevo, mige: f.mige, group: _selectedGroupId, campo: f.campo },
        });
        okN++;

        // Registrar la corrección de CALIFICACIÓN en el panel de Correcciones
        // (pestaña "Aplicadas"). Solo calif 5–10 y solo admin/subdirección
        // (firestore.rules FLUJO 2). Las FALTAS no caben ahí (la regla exige
        // newGrade 5–10) → quedan en la Bitácora + el Acta. Best-effort: si la
        // regla rechaza, se registra el aviso pero no rompe la aplicación.
        if (_canWriteCorr && f.campo === 'Calif' && Number.isFinite(nuevo) && nuevo >= 5 && nuevo <= 10) {
          try {
            const _cur = Number(f.sistema);
            const _curNum = Number.isFinite(_cur) ? _cur : null;
            const _ts = new Date();
            await db.collection('gradeCorrections').add({
              studentId: f.studentId, subjectId: f.subjectId, partial: f.parcial,
              newGrade: nuevo, reason: `Cotejo MIGE (hoja firmada): ${f.sistema} → ${nuevo}`,
              folio: _folio, status: 'applied',
              currentGrade: _curNum, oldCal: _curNum, newCal: nuevo, motivo: 'Cotejo MIGE',
              studentName: f.alumno, subjectName: f.materia,
              groupId: _selectedGroupId, groupName: (_g && _g.nombre) || '',
              turno: (_g && _g.turno) || '', grado: (_g && _g.grado) || null,
              appliedBy: auth.currentUser.uid, appliedByName: _userName, appliedAt: _ts,
              correctedBy: auth.currentUser.uid, correctedByName: _userName, correctedAt: _ts,
              requestedBy: auth.currentUser.uid, requestedByName: _userName, requestedAt: _ts,
              source: 'cotejo_mige',
            });
            corrN++;
          } catch (ce) { console.warn('[cotejo-mige] no se registró en panel Correcciones', f, ce); }
        }
      } catch (err) { console.error('[cotejo-mige] error aplicando', f, err); errN++; }
    }
    if (Store.invalidateGradesForGroup) Store.invalidateGradesForGroup(_selectedGroupId);
    _setProgress(false);

    // Materias corregidas → sus assignments, para reimprimir todos sus F1 de golpe
    _lastCorrectedMats = [...new Set(list.map(f => f.materia))];
    const affectedSubjIds = [...new Set(list.map(f => f.subjectId).filter(Boolean))];
    _lastCorrectedAsgs = affectedSubjIds
      .map(sid => _assignments.find(a => a.groupId === _selectedGroupId && a.subjectId === sid))
      .filter(Boolean).map(a => a.id);

    _lastFolio = _folio;

    // Snapshot para el ACTA (lo aplicado al Sistema + lo que queda en MIGE),
    // capturado ANTES del re-cotejo (que borra los focos ya resueltos).
    _lastConcentrado = {
      group: _lastResult.group, sys: list.slice(), mige: _migeList().slice(),
      when: new Date().toISOString(), folio: _folio, aplicadoPor: _userName, panelCorrN: corrN,
    };

    const _corrMsg = corrN ? ` · ${corrN} en el panel de Correcciones` : '';
    Toast.show(`${okN} corrección(es) aplicadas${_corrMsg}${errN ? ', ' + errN + ' con error' : ''}.`, errN ? 'warning' : 'success');
    await _runCotejo();       // recotejar para reflejar el estado ya corregido
    _prependReprintBanner();  // banner con Acta + panel Correcciones + "Imprimir F1 de lo corregido"
  }

  // Banner tras aplicar: reimprime de UN clic el F1 de todas las materias corregidas.
  function _prependReprintBanner() {
    const div = document.getElementById('cm-results');
    if (!div) return;
    const snap = _lastConcentrado;
    const sysN = (snap && snap.sys) ? snap.sys.length : 0;
    if (!sysN) return; // no se aplicó nada al Sistema
    const panelN = (snap && snap.panelCorrN) || 0;
    const faltasN = (snap && snap.sys) ? snap.sys.filter(f => f.campo !== 'Calif').length : 0;
    const mats = _lastCorrectedMats.map(m => Utils.sanitize(m)).join(', ');
    const folio = (snap && snap.folio) ? Utils.sanitize(snap.folio) : '';

    // Desglose de dónde quedó registrado cada cambio (certeza para Olivia)
    const panelLine = panelN
      ? `<li><strong>${panelN}</strong> de calificación → panel <strong>Correcciones → Aplicadas</strong>${folio ? ` (folio ${folio})` : ''}.</li>`
      : '';
    const faltasLine = faltasN
      ? `<li><strong>${faltasN}</strong> de faltas → <strong>Bitácora</strong> y el Acta (el panel de Correcciones solo admite calificaciones).</li>`
      : '';

    const f1Btn = _lastCorrectedAsgs.length
      ? `<button class="btn btn-primary" data-action="cm-reprint-affected"><span class="material-icons-round" style="vertical-align:middle;font-size:18px;">print</span> Reimprimir F1 de lo corregido — 1 documento (${_lastCorrectedAsgs.length})</button>`
      : `<span style="font-size:12px;color:#166534;align-self:center;">Reimprime el F1 desde la lista de materias (abajo).</span>`;

    const banner = document.createElement('div');
    banner.className = 'card';
    banner.setAttribute('style', 'background:#ecfdf5;border-left:5px solid #16a34a;margin-bottom:12px;');
    banner.innerHTML = `
      <h4 style="margin:0 0 6px;color:#14532d;">✓ Aplicado y registrado — ${sysN} corrección(es) al Sistema</h4>
      <p style="margin:0 0 6px;font-size:12.5px;color:#166534;line-height:1.5;">Materia(s): <strong>${mats}</strong>. Quedó registrado en:</p>
      <ul style="margin:0 0 10px;padding-left:18px;font-size:12.5px;color:#166534;line-height:1.6;">
        <li>Todas en <strong>Bitácora de Cambios</strong> (menú izquierdo), con quién y cuándo.</li>
        ${panelLine}${faltasLine}
      </ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-outline" data-action="cm-print-constancia"><span class="material-icons-round" style="vertical-align:middle;font-size:18px;">picture_as_pdf</span> Descargar Acta de lo aplicado (PDF)</button>
        ${f1Btn}
      </div>`;
    div.insertBefore(banner, div.firstChild);
  }

  function _downloadFocosCsv(focos, group) {
    const esc = s => { const str = String(s == null ? '' : s); return (/[",\n]/.test(str)) ? '"' + str.replace(/"/g, '""') + '"' : str; };
    const lines = ['MATERIA,ALUMNO,PARCIAL,CAMPO,MIGE_DICE,DEBE_DECIR_SISTEMA'];
    focos.forEach(f => lines.push([f.materia, f.alumno, f.parcial, f.campo, f.mige, f.sistema].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cotejo-mige-${(group?.nombre || _selectedGroupId || 'grupo').replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    Toast.show('CSV descargado', 'success');
  }

  // ═════════════════════════════════════════════════════════════════
  // MATERIAS DEL GRUPO + Reimprimir F1
  // ═════════════════════════════════════════════════════════════════
  function _renderSubjectsList() {
    const div = document.getElementById('cm-subjects');
    if (!div) return;
    if (!_selectedGroupId) { div.innerHTML = ''; return; }
    // SOLO materias CORREGIDAS por cotejo (marcador cotejoFix → _correctedSubjIds).
    // La reimpresión es para lo que se movió, NO para todo el grupo.
    const asgs = _assignments.filter(a => a.groupId === _selectedGroupId && _correctedSubjIds.has(a.subjectId))
      .sort((a, b) => (K.getUACNombre(a.subjectName || a.subjectId || '') || '').localeCompare(K.getUACNombre(b.subjectName || b.subjectId || '') || ''));
    if (!asgs.length) {
      div.innerHTML = `<div class="card" style="border-left:4px solid #94a3b8;">
        <h4 style="margin:0 0 4px;">🖨️ Reimprimir Concentrado F1 de lo corregido</h4>
        <p style="font-size:12px;color:#64748b;margin:0;">Aquí aparecen <strong>solo las materias que corregiste</strong> en el cotejo, para reimprimir su Concentrado F1 (los 3 parciales) con el sello ✓. Todavía no hay correcciones en este grupo.</p></div>`;
      return;
    }
    const partial = _lastPartialId();
    const f1Btn = (asgId) => `<button class="btn btn-primary btn-sm" data-action="cm-print-f1" data-asg="${Utils.sanitize(asgId)}" data-partial="${partial}" title="Reimprime el Concentrado F1 (3 parciales) de esta materia"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">print</span> Reimprimir F1</button>`;
    const consultaBtn = (asgId) => `<button class="btn btn-outline btn-sm" data-action="cm-consulta" data-asg="${Utils.sanitize(asgId)}" title="Copia de consulta (no oficial): 3 parciales + faltas"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">visibility</span> Consulta</button>`;
    const corrBadge = `<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px;white-space:nowrap;">✓ Cotejada y corregida</span>`;
    div.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h4 style="margin:0;">🖨️ Reimprimir Concentrado F1 de lo corregido <span style="font-weight:400;color:#64748b;font-size:13px;">(${asgs.length})</span></h4>
          <button class="btn btn-primary btn-sm" data-action="cm-print-selected"><span class="material-icons-round" style="vertical-align:middle;font-size:16px;">print</span> Reimprimir seleccionados (1 archivo)</button>
        </div>
        <p style="font-size:12px;color:#64748b;margin:6px 0 12px;">Aquí <strong>solo</strong> están las materias que <strong>cotejaste y corregiste</strong>. Vienen todas marcadas; desmarca las que no quieras e imprímelas <strong>juntas en un solo documento</strong> (Concentrado F1, 3 parciales, con el sello <strong style="color:#166534;">✓ Cotejada y corregida</strong>). La <strong>Consulta</strong> es copia no oficial.</p>
        <table class="table-light" style="font-size:13px;"><thead><tr>
          <th style="width:34px;text-align:center;"><input type="checkbox" id="cm-f1-all" title="Marcar / desmarcar todas" checked></th>
          <th>Materia</th><th>Docente</th><th style="text-align:right;">Individual</th></tr></thead>
          <tbody>${asgs.map(a => `<tr style="background:#f0fdf4;">
            <td style="text-align:center;"><input type="checkbox" class="cm-f1-chk" data-asg="${Utils.sanitize(a.id)}" data-subj="${Utils.sanitize(a.subjectId || '')}" checked></td>
            <td>${Utils.sanitize(K.getUACNombre(a.subjectName || a.subjectId || ''))} &nbsp;${corrBadge}</td>
            <td style="color:#64748b;">${Utils.sanitize(Utils.displayName(a.teacherName || '') || '—')}</td>
            <td style="text-align:right;white-space:nowrap;">${f1Btn(a.id)} ${consultaBtn(a.id)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // Reimprime en 1 solo documento el Concentrado F1 de varias materias.
  // all=true → todas del grupo; all=false → solo las marcadas. El sello
  // "cotejado y corregido" se pone SOLO en las corregidas (leyenda por-materia).
  function _reprintF1Bulk(all) {
    if (typeof MyF1Module === 'undefined' || typeof MyF1Module.printConcentrados !== 'function') {
      Toast.show('El módulo de Concentrado F1 no está disponible.', 'error'); return;
    }
    const rows = [...document.querySelectorAll('#cm-subjects .cm-f1-chk')];
    const chosen = all ? rows : rows.filter(c => c.checked);
    if (!chosen.length) { Toast.show(all ? 'No hay materias en el grupo' : 'Marca al menos una materia', 'info'); return; }
    const leg = 'COTEJADO Y CORREGIDO CON MIGE · ' + new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + (_lastFolio ? ' · Folio ' + _lastFolio : '');
    const items = chosen.map(c => ({ id: c.dataset.asg, legend: _correctedSubjIds.has(c.dataset.subj) ? leg : '' }));
    MyF1Module.printConcentrados(items, {});
  }

  // Descarga read-only (PDF vía print) de las calificaciones de una materia:
  // alumno × P1/P2/P3 (cal + faltas). No crea snapshot, no edita. Para consulta.
  async function _downloadConsulta(asgId) {
    const asg = _assignments.find(a => a.id === asgId);
    if (!asg) { Toast.show('Materia no encontrada', 'error'); return; }
    Toast.show('Generando lista de consulta…', 'info');
    try {
      const [students, gP1, gP2, gP3] = await Promise.all([
        Store.getStudentsByGroup(_selectedGroupId, true),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P1'),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P2'),
        Store.getGradesByGroupAndPartial(_selectedGroupId, 'P3'),
      ]);
      const idx = (arr) => { const m = {}; arr.forEach(g => { if (g.subjectId === asg.subjectId) m[g.studentId] = g; }); return m; };
      const mP1 = idx(gP1), mP2 = idx(gP2), mP3 = idx(gP3);
      const grupo = _groups.find(g => g.id === _selectedGroupId) || {};
      const alumnos = students.slice().sort((a, b) => (a.nombreCompleto || '').localeCompare(b.nombreCompleto || ''));
      const esc = s => Utils.sanitize(String(s == null ? '' : s));
      const cell = (m, id, campo) => { const g = m[id]; if (!g) return ''; const v = g[campo]; return (v === undefined || v === null || v === '') ? '' : v; };
      const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      const materia = K.getUACNombre(asg.subjectName || asg.subjectId || '');
      const docente = Utils.displayName(asg.teacherName || '') || '';
      const w = window.open('', '_blank');
      if (!w) { Toast.show('Permite ventanas emergentes para descargar', 'error'); return; }
      w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Consulta ${esc(materia)} ${esc(grupo.nombre || '')}</title>
        <style>
          body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:11px;}
          h1{font-size:14px;text-align:center;margin:0 0 2px;} .sub{text-align:center;color:#444;font-size:10px;margin:0;}
          .tag{text-align:center;color:#b45309;font-weight:bold;font-size:10px;margin:6px 0;}
          .meta{margin:10px 0;} .meta b{display:inline-block;min-width:60px;}
          table{border-collapse:collapse;width:100%;margin-top:6px;} th,td{border:1px solid #999;padding:3px 5px;} th{background:#eee;} td.c,th.c{text-align:center;}
          @media print{body{margin:12mm;}}
        </style></head><body>
        <h1>ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
        <p class="sub">C.C.T. 15EBH0134D · Ciclo 2025-2026</p>
        <p class="tag">COPIA PARA CONSULTA — NO OFICIAL, SOLO LECTURA</p>
        <div class="meta"><b>Grupo:</b> ${esc(grupo.nombre || '')} &nbsp; <b>Turno:</b> ${esc(grupo.turno || '')} &nbsp; <b>Materia:</b> ${esc(materia)} &nbsp; <b>Docente:</b> ${esc(docente)} &nbsp; <b>Fecha:</b> ${esc(hoy)}</div>
        <table><thead>
          <tr><th rowspan="2">Nº</th><th rowspan="2">Alumno</th><th class="c" colspan="2">Parcial 1</th><th class="c" colspan="2">Parcial 2</th><th class="c" colspan="2">Parcial 3</th></tr>
          <tr><th class="c">Calif</th><th class="c">Faltas</th><th class="c">Calif</th><th class="c">Faltas</th><th class="c">Calif</th><th class="c">Faltas</th></tr>
        </thead><tbody>${alumnos.map((s, i) => `<tr>
          <td class="c">${i + 1}</td><td>${esc(Utils.displayName ? Utils.displayName(s.nombreCompleto) : s.nombreCompleto)}</td>
          <td class="c">${esc(cell(mP1, s.id, 'cal'))}</td><td class="c">${esc(cell(mP1, s.id, 'faltas'))}</td>
          <td class="c">${esc(cell(mP2, s.id, 'cal'))}</td><td class="c">${esc(cell(mP2, s.id, 'faltas'))}</td>
          <td class="c">${esc(cell(mP3, s.id, 'cal'))}</td><td class="c">${esc(cell(mP3, s.id, 'faltas'))}</td>
        </tr>`).join('')}</tbody></table>
        <p style="font-size:9.5px;color:#666;margin-top:12px;">Documento de consulta generado del Sistema Escolar EPO 67. La lista oficial firmada (F1) es la fuente de verdad.</p>
        </body></html>`);
      w.document.close(); w.focus();
      setTimeout(() => { try { w.print(); } catch (_) {} }, 350);
    } catch (err) {
      console.error('[cotejo-mige] error consulta:', err);
      Toast.show('Error generando la consulta: ' + (err.message || ''), 'error');
    }
  }

  async function _reprintF1(asgId, partial, btn) {
    if (!asgId) return;
    if (typeof MyF1Module === 'undefined' || typeof MyF1Module.printConcentrados !== 'function') {
      Toast.show('El módulo de Concentrado F1 no está disponible.', 'error'); return;
    }
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-icons-round loading-spinner" style="font-size:16px;">autorenew</span>'; }
    // Leyenda "cotejado y corregido" si esa materia se corrigió — en esta sesión
    // (_lastCorrectedAsgs) o en cualquier cotejo previo (marcador cotejoFix → _correctedSubjIds).
    const _asg = _assignments.find(a => a.id === asgId);
    const _wasCorr = (Array.isArray(_lastCorrectedAsgs) && _lastCorrectedAsgs.includes(asgId)) ||
      !!(_asg && _correctedSubjIds && _correctedSubjIds.has(_asg.subjectId));
    const _leg = _wasCorr ? ('COTEJADO Y CORREGIDO CON MIGE · ' + new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }) + (_lastFolio ? ' · Folio ' + _lastFolio : '')) : '';
    try { await MyF1Module.printConcentrados([asgId], { legend: _leg }); } // Concentrado F1 (3 parciales) de la materia
    catch (e) { console.error('[cotejo-mige] error reimprimiendo Concentrado F1:', e); Toast.show('No se pudo reimprimir el Concentrado F1: ' + (e.message || ''), 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = orig; } }
  }

  // ═════════════════════════════════════════════════════════════════
  // COTEJAR TODOS MIS GRUPOS DE UN SOLO TIRO (v8.28)
  // Genera UN PDF con todos los grupos del orientador. Los grupos sin
  // MIGE cargado se muestran con aviso "no subido — se subirá en breve".
  // ═════════════════════════════════════════════════════════════════
  async function _runCotejoAllMyGroups() {
    if (!_scopedGroups.length) {
      Toast.show('No tienes grupos asignados como orientador.', 'warning');
      return;
    }
    const btn = document.getElementById('cm-run-all');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="material-icons-round loading-spinner" style="vertical-align:middle;">autorenew</span> Procesando…'; }
    _setProgress(true, `Procesando 0 de ${_scopedGroups.length} grupos…`);

    const allResults = [];
    try {
      for (let i = 0; i < _scopedGroups.length; i++) {
        const g = _scopedGroups[i];
        _setProgress(true, `Procesando ${i + 1} de ${_scopedGroups.length}: ${g.nombre || g.id}…`);

        // Cargar MIGE del grupo
        let migeData = null;
        try {
          migeData = await Store.getMigeData(g.id, true);
        } catch (e) { console.warn('[cotejo-mige-all] error MIGE ' + g.id, e); }

        if (!migeData || !Array.isArray(migeData.subjects) || !migeData.subjects.length) {
          allResults.push({ group: g, noMige: true });
          continue;
        }

        // Cotejar contra grades del grupo
        try {
          const result = await _computeCotejoForGroup(g, migeData.subjects);
          allResults.push(result);
        } catch (e) {
          console.warn('[cotejo-mige-all] error cotejo ' + g.id, e);
          allResults.push({ group: g, error: e.message || 'error' });
        }
      }

      _setProgress(false);
      _printAllGroupsReport(allResults);
    } catch (err) {
      console.error('[cotejo-mige-all] falla global:', err);
      _setProgress(false);
      Toast.show('Error al cotejar todos los grupos: ' + (err.message || ''), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-icons-round" style="vertical-align:middle;">library_books</span> Descargar reporte de todos mis grupos'; }
    }
  }

  // Motor de cotejo reusable — extraído de _runCotejo pero sin renderizar.
  // Devuelve el objeto de resultados listo para _printReport.
  async function _computeCotejoForGroup(group, migeSubjects) {
    const [students, gP1, gP2, gP3] = await Promise.all([
      Store.getStudentsByGroup(group.id, true),
      Store.getGradesByGroupAndPartial(group.id, 'P1', true),
      Store.getGradesByGroupAndPartial(group.id, 'P2', true),
      Store.getGradesByGroupAndPartial(group.id, 'P3', true),
    ]);
    students.forEach(s => { s._words = _nameWords(s.nombreCompleto || ''); });
    const gradesByPartial = { P1: gP1, P2: gP2, P3: gP3 };
    const subjectsById = new Map(_subjects.map(s => [s.id, s]));
    const subjIds = new Set();
    PARTIALS.forEach(p => gradesByPartial[p].forEach(g => g.subjectId && subjIds.add(g.subjectId)));
    const groupSubjects = [...subjIds].map(id => subjectsById.get(id)).filter(Boolean);
    const gradeIndex = new Map();
    PARTIALS.forEach(p => gradesByPartial[p].forEach(g => gradeIndex.set(p + '|' + g.studentId + '|' + g.subjectId, g)));

    const focos = [], unmatchedSubjects = [], unmatchedStudents = new Set();
    let comparedCells = 0;
    const capturado = new Set();
    for (const ms of migeSubjects) {
      ms._subj = _matchSubject(ms.materiaNorm || _normTight(ms.materiaName), ms.materiaName, groupSubjects);
      if (!ms._subj) { unmatchedSubjects.push(ms.materiaName); continue; }
      for (const p of PARTIALS) if (ms.rows.some(r => (_toNum(r.cal[p]) || 0) > 0)) capturado.add(ms._subj.id + '|' + p);
    }
    const pendMap = new Map();
    const addPend = (subj, p) => {
      const k = subj.id + '|' + p;
      const e = pendMap.get(k) || { materia: subj.nombre || subj.name, parcial: p, alumnos: 0 };
      e.alumnos++; pendMap.set(k, e);
    };
    for (const ms of migeSubjects) {
      const subj = ms._subj; if (!subj) continue;
      for (const mr of ms.rows) {
        const st = _matchStudent(mr, students);
        if (!st) { unmatchedStudents.add(ms.materiaName + ' · ' + mr.nombreCompleto); continue; }
        for (const p of PARTIALS) {
          const g = gradeIndex.get(p + '|' + st.id + '|' + subj.id);
          const sysCal = g ? _toNum(g.cal) : null;
          const cap = capturado.has(subj.id + '|' + p);
          if (!cap) { if (sysCal !== null) addPend(subj, p); continue; }
          const migeCal = _toNum(mr.cal[p]);
          if (sysCal !== null) {
            if (migeCal !== null && migeCal > 0) {
              comparedCells++;
              if (Number(migeCal) !== Number(sysCal)) focos.push({ materia: subj.nombre || subj.name, alumno: st.nombreCompleto, studentId: st.id, subjectId: subj.id, parcial: p, campo: 'Calif', mige: migeCal, sistema: sysCal });
            } else addPend(subj, p);
          }
          const migeF = _toNum(mr.faltas[p]);
          const sysF = g ? (_toNum(g.faltas) || 0) : null;
          if (migeF !== null && sysF !== null) {
            comparedCells++;
            if (Number(migeF) !== Number(sysF)) focos.push({ materia: subj.nombre || subj.name, alumno: st.nombreCompleto, studentId: st.id, subjectId: subj.id, parcial: p, campo: 'Faltas', mige: migeF, sistema: sysF });
          }
        }
      }
    }
    focos.sort((a, b) => (a.materia || '').localeCompare(b.materia || '') || (a.alumno || '').localeCompare(b.alumno || '') || a.parcial.localeCompare(b.parcial));
    const pendientes = [...pendMap.values()].sort((a, b) => (a.materia || '').localeCompare(b.materia || '') || a.parcial.localeCompare(b.parcial));
    return {
      group, focos, pendientes, unmatchedSubjects,
      unmatchedStudents: [...unmatchedStudents], comparedCells,
      materiasMatched: migeSubjects.length - unmatchedSubjects.length,
      materiasTotal: migeSubjects.length,
    };
  }

  // Genera UN PDF con todos los grupos concatenados (page-break entre grupos).
  function _printAllGroupsReport(allResults) {
    const esc = s => Utils.sanitize(String(s == null ? '' : s));
    const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
    const orient = App.currentUser?.displayName || 'Orientador(a)';

    // Contadores globales
    const withMige = allResults.filter(r => !r.noMige && !r.error);
    const noMige = allResults.filter(r => r.noMige);
    const errored = allResults.filter(r => r.error);
    const totalFocos = withMige.reduce((s, r) => s + (r.focos?.length || 0), 0);
    const gruposConDiferencias = withMige.filter(r => (r.focos?.length || 0) > 0).length;

    // Portada
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cotejo MIGE — ${esc(orient)}</title>
<style>
  body{font-family:Arial,sans-serif;color:#0f172a;padding:24px 32px;}
  h1{margin:0 0 6px;font-size:20px;color:#1e40af;}
  h2{margin:24px 0 8px;font-size:16px;color:#1e3a8a;border-bottom:2px solid #1e40af;padding-bottom:4px;}
  h3{margin:16px 0 6px;font-size:14px;color:#334155;}
  .meta{font-size:12px;color:#475569;margin-bottom:12px;}
  .summary{background:#eff6ff;border:1px solid #bfdbfe;padding:12px 14px;border-radius:6px;margin:16px 0;font-size:13px;}
  .flow{background:#fefce8;border-left:4px solid #eab308;padding:10px 14px;font-size:12px;margin:12px 0;}
  .flow ol{margin:4px 0 0 20px;padding:0;line-height:1.6;}
  table{width:100%;border-collapse:collapse;font-size:11px;margin:8px 0;}
  th,td{border:1px solid #cbd5e1;padding:5px 8px;text-align:left;vertical-align:top;}
  th{background:#f1f5f9;font-weight:700;color:#0f172a;}
  tr.calif{background:#eff6ff;}
  tr.faltas{background:#f5f3ff;}
  .no-mige{background:#fef3c7;border:1px solid #fcd34d;padding:14px;border-radius:6px;color:#78350f;font-size:13px;margin:8px 0;}
  .ok{background:#dcfce7;border:1px solid #86efac;padding:14px;border-radius:6px;color:#166534;font-size:13px;margin:8px 0;}
  .err{background:#fef2f2;border:1px solid #fca5a5;padding:14px;border-radius:6px;color:#7f1d1d;font-size:13px;margin:8px 0;}
  .col-hoja{background:#fff8dc;font-weight:700;text-align:center;}
  .brk{page-break-after:always;}
  @media print{body{padding:14mm;}}
</style></head><body>
<h1>Cotejo MIGE vs Sistema EPO 67 — TODOS MIS GRUPOS</h1>
<div class="meta"><strong>Orientador(a):</strong> ${esc(orient)} · <strong>Fecha:</strong> ${esc(hoy)}</div>

<div class="flow">
  <strong>📋 Flujo de trabajo con este documento:</strong>
  <ol>
    <li><strong>Imprime</strong> este reporte completo.</li>
    <li>En cada renglón, anota en la columna <strong>"Hoja dice"</strong> lo que dice la hoja firmada del maestro (si dice lo mismo que Sistema o MIGE, subráyalo; si dice otro valor, escríbelo).</li>
    <li>Regresa al sistema, entra al módulo Cotejo MIGE, selecciona <strong>grupo por grupo</strong> y captura las decisiones (Sistema/MIGE/valor manual).</li>
    <li>Reimprime los F1 <strong>solo</strong> de los grupos que se corrigieron y recolecta firmas.</li>
  </ol>
</div>

<div class="summary">
  <strong>Resumen:</strong>
  Total grupos: <strong>${allResults.length}</strong> ·
  Con MIGE cargado: <strong>${withMige.length}</strong> ·
  Sin MIGE aún: <strong>${noMige.length}</strong>
  ${errored.length ? ` · Con error: <strong>${errored.length}</strong>` : ''}
  <br>
  Grupos con diferencias detectadas: <strong>${gruposConDiferencias}</strong> ·
  Total diferencias a resolver: <strong>${totalFocos}</strong>
</div>

<div class="brk"></div>`;

    // Una sección por grupo
    allResults.forEach((r, idx) => {
      const g = r.group;
      const nombre = g.nombre || g.id;
      const turno = g.turno || '';
      html += `<h2>Grupo: ${esc(nombre)} · ${esc(turno)}</h2>`;

      if (r.noMige) {
        html += `<div class="no-mige">⚠ El MIGE de este grupo aún NO ha sido cargado al sistema. Se subirá en breve. Vuelve a intentar más tarde o pide a la administración que lo suba.</div>`;
      } else if (r.error) {
        html += `<div class="err">❌ Error al procesar este grupo: ${esc(r.error)}</div>`;
      } else if (!r.focos.length) {
        html += `<div class="ok">✓ Todo coincide. MIGE y Sistema son idénticos en este grupo (${r.materiasMatched}/${r.materiasTotal} materias comparadas, ${r.comparedCells.toLocaleString()} celdas sin diferencias).</div>`;
      } else {
        const cal = r.focos.filter(f => f.campo === 'Calif');
        const fal = r.focos.filter(f => f.campo === 'Faltas');
        html += `<div class="meta"><strong>${r.focos.length}</strong> diferencia(s) detectada(s) · ${cal.length} de calificación · ${fal.length} de faltas</div>`;

        if (cal.length) {
          html += `<h3>📘 Diferencias en CALIFICACIONES (${cal.length})</h3>`;
          html += `<table><thead><tr><th>#</th><th>Alumno</th><th>Materia</th><th>Parcial</th><th>Sistema</th><th>MIGE</th><th style="width:80px">Hoja dice</th></tr></thead><tbody>`;
          cal.forEach((f, i) => {
            html += `<tr class="calif"><td>${i + 1}</td><td>${esc(f.alumno)}</td><td>${esc(f.materia)}</td><td>${f.parcial}</td><td style="text-align:center"><strong>${f.sistema}</strong></td><td style="text-align:center"><strong>${f.mige}</strong></td><td class="col-hoja">___</td></tr>`;
          });
          html += `</tbody></table>`;
        }

        if (fal.length) {
          html += `<h3>🗓️ Diferencias en FALTAS (${fal.length})</h3>`;
          html += `<table><thead><tr><th>#</th><th>Alumno</th><th>Materia</th><th>Parcial</th><th>Sistema</th><th>MIGE</th><th style="width:80px">Hoja dice</th></tr></thead><tbody>`;
          fal.forEach((f, i) => {
            html += `<tr class="faltas"><td>${i + 1}</td><td>${esc(f.alumno)}</td><td>${esc(f.materia)}</td><td>${f.parcial}</td><td style="text-align:center"><strong>${f.sistema}</strong></td><td style="text-align:center"><strong>${f.mige}</strong></td><td class="col-hoja">___</td></tr>`;
          });
          html += `</tbody></table>`;
        }
      }

      // Page break entre grupos, excepto el último
      if (idx < allResults.length - 1) html += `<div class="brk"></div>`;
    });

    html += `</body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  return { render };
})();

if (typeof Router !== 'undefined') {
  Router.modules['cotejo-mige'] = () => CotejoMige.render();
}
