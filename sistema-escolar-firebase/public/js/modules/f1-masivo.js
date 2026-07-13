// ═══════════════════════════════════════════════════════════════
// F1 MASIVO — Genera TODOS los concentrados F1 del turno seleccionado.
// Solo admin/subdirector. Delega la impresión a MyF1Module.printConcentrados,
// que ya bundlea múltiples F1 en un PDF único con page-break entre cada uno.
// ═══════════════════════════════════════════════════════════════

const F1MasivoModule = (() => {
  const CONTAINER = '#moduleContainer';
  let _turnoSelected = 'MATUTINO';
  let _audit = null;

  function _el(id) { return document.getElementById(id); }

  function _normTight(s) {
    return (s || '').toString().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]/g, '');
  }

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) {
      console.error('[f1-masivo] No se encontró #moduleContainer');
      return;
    }

    const role = App.currentUser?.role;
    if (role !== 'admin' && role !== 'subdirector') {
      container.innerHTML = `<div class="module-container">${UI.emptyState ? UI.emptyState('block', 'Acceso restringido a dirección/subdirección') : '<h3>Sin acceso</h3>'}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div>
            <h2><span class="material-icons-round" style="vertical-align:middle;color:var(--color-primary);">library_books</span>
                F1 Masivo por Materia</h2>
            <p class="text-muted">Genera los concentrados F1 (cal + faltas de los 3 parciales) de todas las materias del turno en un solo documento.</p>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <div class="card-body" style="padding:16px;">
            <div style="display:flex;gap:20px;align-items:end;flex-wrap:wrap;">
              <div style="flex:1;min-width:200px;">
                <label class="form-label"><b>Turno</b></label>
                <select id="f1m-turno" class="form-control">
                  <option value="MATUTINO" selected>MATUTINO</option>
                  <option value="VESPERTINO">VESPERTINO</option>
                </select>
              </div>
              <div>
                <button class="btn btn-secondary" id="f1m-audit-btn">
                  <span class="material-icons-round" style="vertical-align:middle;">fact_check</span>
                  1. Auditar integridad
                </button>
              </div>
              <div>
                <button class="btn btn-primary" id="f1m-generate-btn" disabled>
                  <span class="material-icons-round" style="vertical-align:middle;">print</span>
                  2. Generar F1 masivo
                </button>
              </div>
            </div>
            <div style="margin-top:12px;padding:10px 14px;background:#fff8e1;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;color:#555;">
              <b>Flujo:</b> primero <b>Auditar integridad</b> (compara Sistema vs MIGE del turno).
              Al terminar, se habilita <b>Generar F1 masivo</b> → PDF único con page-break por materia.
            </div>
          </div>
        </div>

        <div id="f1m-audit-results"></div>
        <div id="f1m-progress" style="display:none;margin-top:16px;padding:14px;background:#e3f2fd;border-radius:6px;">
          <div id="f1m-progress-text" style="font-size:14px;color:#0d47a1;"></div>
        </div>
      </div>
    `;

    // Bind events DIRECTAMENTE (sin setTimeout ni event delegation compleja)
    const auditBtn = _el('f1m-audit-btn');
    const generateBtn = _el('f1m-generate-btn');
    const turnoSelect = _el('f1m-turno');

    if (auditBtn) auditBtn.addEventListener('click', _runAudit);
    if (generateBtn) generateBtn.addEventListener('click', _generateMassiveF1);
    if (turnoSelect) turnoSelect.addEventListener('change', (e) => {
      _turnoSelected = e.target.value;
      _audit = null;
      const resDiv = _el('f1m-audit-results'); if (resDiv) resDiv.innerHTML = '';
      if (generateBtn) generateBtn.disabled = true;
    });
  }

  // ─────────────────────────────────────────────────────────────
  // AUDITORÍA DE INTEGRIDAD (Sistema vs MIGE) por grupo
  // ─────────────────────────────────────────────────────────────
  async function _runAudit() {
    const turno = _turnoSelected;
    const resultsEl = _el('f1m-audit-results');
    if (!resultsEl) return;

    resultsEl.innerHTML = `
      <div class="card"><div class="card-body" style="padding:20px;">
        <div style="text-align:center;padding:20px;">
          <div class="loading-spinner" style="margin:0 auto 12px;"></div>
          <p>Auditando integridad del turno <b>${turno}</b>…</p>
        </div>
      </div></div>
    `;

    try {
      const [groups, subjects, allStudents, migeAll] = await Promise.all([
        Store.getGroups(),
        Store.getSubjects(),
        Store.getStudents(),
        _fetchAllMige(),
      ]);

      const turnoGroups = (groups || [])
        .filter(g => (g.turno || '').toUpperCase() === turno)
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      const subjById = {};
      (subjects || []).forEach(s => { subjById[s.id] = s.nombre; });

      const stByGroup = {};
      (allStudents || []).forEach(s => {
        if (!s || !s.groupId) return;
        if (!stByGroup[s.groupId]) stByGroup[s.groupId] = [];
        const name = ((s.apellido1||'')+' '+(s.apellido2||'')+' '+(s.nombres||'')).toUpperCase().trim();
        stByGroup[s.groupId].push({ id: s.id, name });
      });

      const migeByGroup = {};
      (migeAll || []).forEach(m => { migeByGroup[m.id] = m; });

      const perGroup = [];

      for (const g of turnoGroups) {
        const gradesForGroup = await Store.getGradesByGroup(g.id, true);
        const gradesIdx = {};
        (gradesForGroup || []).forEach(gr => {
          const k = gr.studentId + '|' + gr.subjectId + '|' + gr.partial;
          gradesIdx[k] = gr;
        });

        const mige = migeByGroup[g.id];
        let migeDiff = 0, migeMatch = 0;
        const examples = [];

        if (mige && mige.subjects) {
          const subjNormMap = {};
          Object.keys(subjById).forEach(sid => {
            const n = _normTight(subjById[sid]);
            if (n) subjNormMap[n] = sid;
          });

          for (const ms of (mige.subjects || [])) {
            const migeNorm = _normTight(ms.materiaNorm || ms.materiaName || '');
            let subjectId = null;
            for (const catNorm of Object.keys(subjNormMap)) {
              if (!catNorm) continue;
              if (migeNorm.indexOf(catNorm) === 0 || catNorm.indexOf(migeNorm) === 0) {
                subjectId = subjNormMap[catNorm];
                break;
              }
            }
            if (!subjectId) continue;
            for (const r of (ms.rows || [])) {
              if (!r || !r.nombreCompleto) continue;
              const nombreU = r.nombreCompleto.toUpperCase().trim();
              const nParts = nombreU.split(/\s+/).filter(w => w.length >= 2);
              const candidatos = (stByGroup[g.id] || []).filter(s => {
                const sParts = s.name.split(/\s+/);
                return nParts.every(w => sParts.includes(w));
              });
              const st = candidatos.length === 1 ? candidatos[0] : null;
              if (!st) continue;
              for (const p of ['P1','P2','P3']) {
                const migeCal = r.cal && r.cal[p] !== undefined && r.cal[p] !== '' ? Number(r.cal[p]) : null;
                const gr = gradesIdx[st.id + '|' + subjectId + '|' + p];
                const sysCal = gr && gr.cal !== undefined ? Number(gr.cal) : null;
                if (migeCal !== null && !isNaN(migeCal) && migeCal > 0 && sysCal !== null) {
                  if (migeCal !== sysCal) {
                    migeDiff++;
                    if (examples.length < 3) examples.push(`${st.name} · ${subjById[subjectId]} ${p}: sistema=${sysCal} MIGE=${migeCal}`);
                  } else {
                    migeMatch++;
                  }
                }
              }
            }
          }
        }

        const status = !mige ? 'sinMige'
                     : migeDiff === 0 ? 'verde'
                     : migeDiff <= 5 ? 'amarillo'
                     : 'rojo';

        perGroup.push({
          id: g.id, nombre: g.nombre, grado: g.grado,
          migeDiff, migeMatch, status, examples, hasMige: !!mige,
        });
      }

      _audit = { turno, perGroup };
      _renderAuditResults();

    } catch (err) {
      console.error('[f1-masivo] audit error:', err);
      resultsEl.innerHTML = `<div class="alert alert-error" style="padding:16px;background:#fee2e2;color:#991b1b;border-radius:6px;">Error auditando: ${Utils.sanitize(err.message || String(err))}</div>`;
    }
  }

  async function _fetchAllMige() {
    const snap = await firebase.firestore().collection('migeData').get();
    const out = [];
    snap.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
    return out;
  }

  function _renderAuditResults() {
    if (!_audit) return;
    const resultsEl = _el('f1m-audit-results');
    if (!resultsEl) return;

    const groups = _audit.perGroup;
    const verdes = groups.filter(g => g.status === 'verde');
    const amarillos = groups.filter(g => g.status === 'amarillo');
    const rojos = groups.filter(g => g.status === 'rojo');
    const sinMige = groups.filter(g => g.status === 'sinMige');

    let html = `
      <div class="card" style="margin-top:16px;">
        <div class="card-body" style="padding:16px;">
          <h3 style="margin-top:0;">Resultado auditoría — ${Utils.sanitize(_audit.turno)}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
            <div style="text-align:center;padding:14px;background:#e6f4ea;border-radius:6px;">
              <div style="font-size:28px;font-weight:bold;color:#0a7c2e;">${verdes.length}</div>
              <div style="font-size:12px;color:#0a7c2e;">🟢 VERDES</div>
            </div>
            <div style="text-align:center;padding:14px;background:#fff8e1;border-radius:6px;">
              <div style="font-size:28px;font-weight:bold;color:#b45309;">${amarillos.length}</div>
              <div style="font-size:12px;color:#b45309;">🟡 AMARILLOS</div>
            </div>
            <div style="text-align:center;padding:14px;background:#fee2e2;border-radius:6px;">
              <div style="font-size:28px;font-weight:bold;color:#b91c1c;">${rojos.length}</div>
              <div style="font-size:12px;color:#b91c1c;">🔴 ROJOS</div>
            </div>
            <div style="text-align:center;padding:14px;background:#f3f4f6;border-radius:6px;">
              <div style="font-size:28px;font-weight:bold;color:#4b5563;">${sinMige.length}</div>
              <div style="font-size:12px;color:#4b5563;">⚪ SIN MIGE</div>
            </div>
          </div>

          <table class="table" style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db;">Grupo</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db;">Estado</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #d1d5db;">Diff MIGE</th>
                <th style="padding:8px;text-align:right;border-bottom:2px solid #d1d5db;">Celdas OK</th>
                <th style="padding:8px;text-align:left;border-bottom:2px solid #d1d5db;">Ejemplos</th>
              </tr>
            </thead>
            <tbody>
              ${groups.map(g => {
                const emoji = g.status === 'verde' ? '🟢'
                            : g.status === 'amarillo' ? '🟡'
                            : g.status === 'rojo' ? '🔴' : '⚪';
                return `<tr style="border-bottom:1px solid #e5e7eb;">
                  <td style="padding:8px;"><b>${Utils.sanitize(g.nombre)}</b></td>
                  <td style="padding:8px;">${emoji} ${g.status}</td>
                  <td style="padding:8px;text-align:right;">${g.migeDiff}</td>
                  <td style="padding:8px;text-align:right;">${g.migeMatch}</td>
                  <td style="padding:8px;font-size:11px;color:#666;">${g.examples.length ? Utils.sanitize(g.examples.join(' · ')) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>

          <div style="margin-top:16px;padding:12px;background:#e6f4ea;border-radius:6px;color:#0a5c2e;">
            <b>✅ Auditoría completa.</b> Ya puedes generar el F1 masivo (aunque haya amarillos/rojos, tú decides).
          </div>
        </div>
      </div>
    `;
    resultsEl.innerHTML = html;

    const btn = _el('f1m-generate-btn');
    if (btn) btn.disabled = false;
  }

  // ─────────────────────────────────────────────────────────────
  // GENERAR F1 MASIVO — delega en MyF1Module.printConcentrados
  // ─────────────────────────────────────────────────────────────
  async function _generateMassiveF1() {
    const turno = _turnoSelected;
    const progressEl = _el('f1m-progress');
    const progressText = _el('f1m-progress-text');
    if (progressEl) progressEl.style.display = 'block';
    if (progressText) progressText.innerHTML = 'Recolectando materias del turno ' + turno + '…';

    try {
      const [groups, allAsg] = await Promise.all([
        Store.getGroups(),
        Store.getAssignments(),
      ]);

      const turnoGroupIds = new Set(
        (groups || [])
          .filter(g => (g.turno || '').toUpperCase() === turno)
          .map(g => g.id)
      );

      const asgTurno = (allAsg || [])
        .filter(a => turnoGroupIds.has(a.groupId))
        .sort((a, b) => {
          const gCmp = (a.groupName || '').localeCompare(b.groupName || '');
          if (gCmp !== 0) return gCmp;
          return (a.subjectName || '').localeCompare(b.subjectName || '');
        });

      if (!asgTurno.length) {
        Toast.show('No hay materias asignadas para el turno ' + turno, 'warning');
        if (progressEl) progressEl.style.display = 'none';
        return;
      }

      if (progressText) progressText.innerHTML = `Generando <b>${asgTurno.length}</b> concentrados F1 del turno ${turno}… (puede tardar 30-90 segundos)`;

      const assignmentIds = asgTurno.map(a => a.id);

      if (typeof MyF1Module === 'undefined' || !MyF1Module.printConcentrados) {
        throw new Error('MyF1Module.printConcentrados no disponible. Recarga la página.');
      }
      await MyF1Module.printConcentrados(assignmentIds, {});

      if (progressText) progressText.innerHTML = `✅ F1 generados: <b>${asgTurno.length}</b>. Revisa la ventana emergente.`;
      Toast.show(`F1 masivo generado (${asgTurno.length} materias)`, 'success');

    } catch (err) {
      console.error('[f1-masivo] generate error:', err);
      if (progressText) progressText.innerHTML = `❌ Error: ${Utils.sanitize(err.message || String(err))}`;
      Toast.show('Error generando F1 masivo: ' + (err.message || ''), 'error');
    }
  }

  return { render };
})();

Router.modules['f1-masivo'] = () => F1MasivoModule.render();
