// ═══════════════════════════════════════════════════════════════
// PROMOCIÓN DE FIN DE CICLO
// ───────────────────────────────────────────────────────────────
// Promueve a TODOS los alumnos activos al grado inmediato superior
// (1°→2°, 2°→3°) y gradúa (estatus EGRESADO) a los de 3°, que
// PERMANECEN en la base de forma indefinida para cotejos.
//
// Seguridad:
//   - Solo admin (Router.ACCESS + data-roles + guard interno).
//   - Vista previa con conteos exactos antes de aplicar.
//   - Confirmación por escritura ("PROMOVER").
//   - RESPALDO completo (grado/grupo/groupId/estatus de cada alumno
//     afectado) guardado en `promotions/{id}` ANTES de tocar nada.
//   - Botón "Deshacer" que restaura el respaldo (reversible).
//
// Modelo de datos:
//   - Promovido: grado N→N+1, grupo 'N-x'→'N+1-x', groupId
//     'TURNO_N-x'→'TURNO_N+1-x'. Las calificaciones viejas NO se pisan
//     (van con prefijo G1_/G2_/G3_ por materia → quedan como histórico).
//   - Egresado: estatus='EGRESADO'; se preserva su grupo final en
//     gradoEgreso/grupoEgreso/groupIdEgreso; su groupId pasa a
//     'EGRESADOS_<ciclo>' para que NINGUNA lista de grupo activo lo
//     muestre (evita choque con la nueva generación que ocupará 3-x).
// ═══════════════════════════════════════════════════════════════
const Promocion = (() => {
  let _students = [];
  let _cfg = {};
  let _lastPromo = null; // { id, data } de la última promoción aplicable a deshacer

  const norm = s => (s || '').toString().toUpperCase().trim();
  const isActivo = s => { const e = norm(s.estatus); return e === '' || e === 'ACTIVO'; };

  // '2025-2026' → '2026-2027'
  function _nextCiclo(ciclo) {
    const m = String(ciclo || '').match(/(\d{4})\D+(\d{4})/);
    return m ? `${+m[1] + 1}-${+m[2] + 1}` : ciclo;
  }
  // Sección del grupo: '2-1' → '1'  (fallback al groupId 'TURNO_2-1' → '1')
  function _section(s) {
    const g = (s.grupo || '').toString();
    if (g.includes('-')) return g.split('-')[1];
    const gid = (s.groupId || '').toString();
    return gid.includes('-') ? gid.split('-').pop() : '';
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    // Guard defensivo: solo admin (además del ACCESS del Router).
    if (App.currentUser?.role !== 'admin') {
      container.innerHTML = UI.errorState('Solo el administrador puede promover alumnos de fin de ciclo.');
      return;
    }

    container.innerHTML = UI.loadingState('Cargando alumnos…');
    try {
      _cfg = (await DB.doc('config', 'school').get()).data() || {};
      _students = await Store.getStudents(true);
      _lastPromo = await _fetchLastPromo();
    } catch (e) {
      console.error('[promocion] carga', e);
      container.innerHTML = UI.errorState('Error al cargar: ' + (e.message || ''));
      return;
    }
    _renderUI(container);
  }

  async function _fetchLastPromo() {
    try {
      const snap = await db.collection('promotions').orderBy('executedAt', 'desc').limit(1).get();
      if (snap.empty) return null;
      const d = snap.docs[0];
      const data = d.data();
      return data.status === 'applied' ? { id: d.id, data } : null;
    } catch (e) {
      console.warn('[promocion] no se pudo leer historial:', e.message);
      return null;
    }
  }

  function _renderUI(container) {
    const active = _students.filter(isActivo);
    const g1 = active.filter(s => String(s.grado) === '1').length;
    const g2 = active.filter(s => String(s.grado) === '2').length;
    const g3 = active.filter(s => String(s.grado) === '3').length;
    const otros = active.filter(s => !['1', '2', '3'].includes(String(s.grado))).length;
    const egresados = _students.filter(s => norm(s.estatus) === 'EGRESADO').length;
    const ciclo = _cfg.cicloEscolar || '';
    const nuevo = _nextCiclo(ciclo);

    const card = (color, from, to, n, sub) => `
      <div class="card" style="padding:18px 20px;border-left:5px solid ${color};">
        <div style="font-size:13px;color:#64748b;font-weight:600;">${from}</div>
        <div style="font-size:30px;font-weight:800;color:${color};line-height:1.1;margin:4px 0;">${n}</div>
        <div style="font-size:13px;color:#334155;font-weight:600;">${to}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${sub}</div>
      </div>`;

    const undoBlock = _lastPromo ? `
      <div class="card" style="padding:16px 20px;margin-top:20px;border:1px dashed #f59e0b;background:#fffbeb;">
        <div style="font-weight:700;color:#92400e;margin-bottom:4px;">Última promoción aplicada</div>
        <div style="font-size:13px;color:#78350f;">
          Ciclo ${Utils.sanitize(_lastPromo.data.ciclo || '')} ·
          ${_lastPromo.data.counts?.total || 0} alumnos movidos ·
          por ${Utils.sanitize(_lastPromo.data.executedByName || '—')}
        </div>
        <button class="btn btn-outline" data-action="deshacer" style="margin-top:10px;">
          <span class="material-icons-round" style="font-size:16px;vertical-align:middle;">undo</span>
          Deshacer esta promoción
        </button>
      </div>` : '';

    container.innerHTML = UI.moduleContainer(`
      <div class="module-header">
        <div class="module-header-text">
          <h1 class="module-title">Promoción de Fin de Ciclo</h1>
          <p class="module-subtitle">Sube a todos los alumnos activos al grado siguiente y gradúa a 3°. Ciclo actual: <b>${Utils.sanitize(ciclo) || '—'}</b></p>
        </div>
      </div>

      <div class="card" style="padding:14px 18px;margin-bottom:18px;background:#eff6ff;border-left:5px solid #3182ce;">
        <b>¿Qué hace?</b> Mueve a cada alumno <b>ACTIVO</b> al grado inmediato superior conservando su número de grupo
        (1-1→2-1, 2-3→3-3…). Los de 3° quedan como <b>EGRESADOS</b> y <b>permanecen en la base</b> (consultables,
        fuera de listas activas). Las calificaciones de cada ciclo se conservan como histórico. Hay <b>respaldo</b> y
        botón para <b>deshacer</b>.
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
        ${card('#3182ce', '1er grado', '→ 2do grado', g1, 'se promueven')}
        ${card('#0d9488', '2do grado', '→ 3er grado', g2, 'se promueven')}
        ${card('#9333ea', '3er grado', '→ EGRESADOS', g3, 'permanecen en base')}
      </div>

      ${otros ? `<div class="card" style="padding:12px 16px;margin-top:14px;background:#fef2f2;color:#991b1b;border-left:5px solid #dc2626;">
        ⚠️ ${otros} alumno(s) activo(s) con grado distinto de 1/2/3 — <b>no</b> se tocarán. Revísalos en Alumnos.
      </div>` : ''}

      ${egresados ? `<div style="font-size:13px;color:#64748b;margin-top:14px;">Ya hay <b>${egresados}</b> egresado(s) en base de promociones anteriores.</div>` : ''}

      <div class="card" style="padding:18px 20px;margin-top:20px;">
        <label style="display:flex;align-items:center;gap:10px;font-weight:600;color:#334155;cursor:pointer;">
          <input type="checkbox" id="promo-update-ciclo" checked style="width:18px;height:18px;">
          Avanzar también el ciclo escolar a <b>${Utils.sanitize(nuevo)}</b> (y reiniciar a PRIMER SEMESTRE)
        </label>
        <div style="font-size:12px;color:#94a3b8;margin-top:6px;margin-left:28px;">
          Desmárcalo si todavía necesitas imprimir documentos oficiales del ciclo ${Utils.sanitize(ciclo)}.
        </div>

        <div style="margin-top:18px;padding:14px;background:#fef2f2;border-radius:8px;color:#991b1b;font-size:13px;">
          <b>Importante:</b> esto mueve a <b>${g1 + g2 + g3}</b> alumnos a la vez. Hazlo solo cuando el 3er parcial
          esté <b>cerrado</b> y los extraordinarios/correcciones del ciclo estén terminados.
        </div>

        <button class="btn btn-primary" data-action="ejecutar" style="margin-top:16px;font-size:15px;padding:12px 22px;"
          ${(g1 + g2 + g3) === 0 ? 'disabled' : ''}>
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;">upgrade</span>
          Ejecutar promoción de fin de ciclo
        </button>
      </div>

      ${undoBlock}
    `);

    container.querySelector('[data-action="ejecutar"]')?.addEventListener('click', _ejecutar);
    container.querySelector('[data-action="deshacer"]')?.addEventListener('click', _deshacer);
  }

  function _ejecutar() {
    const updateCiclo = !!document.getElementById('promo-update-ciclo')?.checked;
    const ciclo = _cfg.cicloEscolar || '';
    const nuevo = _nextCiclo(ciclo);
    const active = _students.filter(isActivo);
    const p12 = active.filter(s => String(s.grado) === '1').length;
    const p23 = active.filter(s => String(s.grado) === '2').length;
    const egr = active.filter(s => String(s.grado) === '3').length;

    Modal.confirmTyped(
      '⚠️ Promoción de fin de ciclo',
      `<div>Vas a aplicar la promoción del ciclo <b>${Utils.sanitize(ciclo)}</b>:</div>
       <ul style="margin:10px 0;padding-left:20px;line-height:1.7;">
         <li><b>${p12}</b> alumnos de 1° → 2°</li>
         <li><b>${p23}</b> alumnos de 2° → 3°</li>
         <li><b>${egr}</b> alumnos de 3° → <b>EGRESADOS</b> (permanecen en base)</li>
       </ul>
       <div>${updateCiclo ? `El ciclo escolar pasará a <b>${Utils.sanitize(nuevo)}</b>.` : 'El ciclo escolar <b>NO</b> cambiará.'}</div>
       <div style="margin-top:8px;color:#b91c1c;">Se guarda un respaldo completo: podrás <b>Deshacer</b> si algo sale mal.</div>`,
      'PROMOVER',
      () => _run(updateCiclo)
    );
  }

  async function _run(updateCiclo) {
    Modal.close();
    const container = document.getElementById('moduleContainer');
    if (container) container.innerHTML = UI.loadingState('Aplicando promoción… NO cierres esta ventana.');
    try {
      const active = _students.filter(isActivo);
      const ciclo = _cfg.cicloEscolar || '';
      const nuevoCiclo = _nextCiclo(ciclo);
      const stamp = firebase.firestore.FieldValue.serverTimestamp();

      const backup = [];
      const updates = []; // { id, data }
      let p12 = 0, p23 = 0, egr = 0;

      for (const s of active) {
        const grado = String(s.grado);
        if (grado !== '1' && grado !== '2' && grado !== '3') continue; // anomalías: no tocar
        // respaldo del estado ORIGINAL (antes de cualquier cambio)
        backup.push({ id: s.id, grado: s.grado, grupo: s.grupo || '', groupId: s.groupId || '', estatus: s.estatus || 'ACTIVO' });

        if (grado === '1' || grado === '2') {
          const to = grado === '1' ? '2' : '3';
          const sec = _section(s);
          updates.push({ id: s.id, data: {
            grado: to,
            grupo: `${to}-${sec}`,
            groupId: `${s.turno}_${to}-${sec}`,
            promotedFrom: grado,
            promotedCiclo: ciclo,
            promotedAt: stamp,
          }});
          if (grado === '1') p12++; else p23++;
        } else { // grado 3 → egresa
          updates.push({ id: s.id, data: {
            estatus: 'EGRESADO',
            gradoEgreso: s.grado,
            grupoEgreso: s.grupo || '',
            groupIdEgreso: s.groupId || '',
            groupId: `EGRESADOS_${ciclo}`,
            grupo: `EGRESADO ${s.grupo || ''}`.trim(),
            egresadoCiclo: ciclo,
            generacion: ciclo,
            egresadoFecha: stamp,
          }});
          egr++;
        }
      }

      if (!updates.length) { Toast.show('No hay alumnos activos por promover.', 'warning'); await render(); return; }

      // 1) RESPALDO + log ANTES de modificar nada (para poder deshacer aunque falle a la mitad).
      const promoRef = db.collection('promotions').doc();
      await promoRef.set({
        ciclo, nuevoCiclo, cicloActualizado: !!updateCiclo,
        counts: { promovidos_1_2: p12, promovidos_2_3: p23, egresados: egr, total: updates.length },
        executedBy: auth.currentUser?.uid || '',
        executedByName: (App.currentUser && (App.currentUser.displayName || App.currentUser.email)) || '',
        executedAt: stamp,
        status: 'applied',
        backup,
      });

      // 2) Aplicar en lotes (máx 500 por batch de Firestore).
      await _commitUpdates(updates);

      // 3) Avanzar ciclo escolar (opcional).
      if (updateCiclo) {
        await DB.doc('config', 'school').set({ cicloEscolar: nuevoCiclo, semestre: 'PRIMER SEMESTRE' }, { merge: true });
      }

      // 4) Invalidar caché para que TODO el sistema (listas, concentrados, indicadores…) refleje el cambio.
      Store.invalidate('students');
      Store.invalidate('grades');

      DB.audit('promocion', 'alumno', promoRef.id, {
        description: `Promoción fin de ciclo ${ciclo}: ${p12} (1→2), ${p23} (2→3), ${egr} egresados${updateCiclo ? ` · ciclo→${nuevoCiclo}` : ''}.`,
        extra: { ciclo, nuevoCiclo, counts: { p12, p23, egr } }
      });
      Toast.show(`✓ Promoción aplicada: ${p12 + p23} promovidos, ${egr} egresados.`, 'success', 7000);
      await render();
    } catch (e) {
      console.error('[promocion] error al aplicar', e);
      Toast.show('Error al promover: ' + (e.message || '') + ' — usa "Deshacer" y reintenta.', 'error', 8000);
      await render();
    }
  }

  async function _commitUpdates(updates) {
    const CHUNK = 450; // < 500 ops/batch
    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = db.batch();
      for (const u of updates.slice(i, i + CHUNK)) {
        batch.update(db.collection('students').doc(u.id), u.data);
      }
      await batch.commit();
    }
  }

  function _deshacer() {
    if (!_lastPromo) return;
    const d = _lastPromo.data;
    Modal.confirmTyped(
      'Deshacer promoción',
      `<div>Esto <b>revertirá</b> la última promoción del ciclo <b>${Utils.sanitize(d.ciclo || '')}</b>
       (${d.counts?.total || 0} alumnos) y restaurará grado, grupo y estatus originales${d.cicloActualizado ? ' y el ciclo escolar' : ''}.</div>`,
      'DESHACER',
      async () => {
        Modal.close();
        const container = document.getElementById('moduleContainer');
        if (container) container.innerHTML = UI.loadingState('Revirtiendo promoción…');
        try {
          const del = firebase.firestore.FieldValue.delete();
          const updates = (d.backup || []).map(b => ({ id: b.id, data: {
            grado: b.grado, grupo: b.grupo, groupId: b.groupId, estatus: b.estatus,
            // limpiar campos agregados por la promoción/egreso
            gradoEgreso: del, grupoEgreso: del, groupIdEgreso: del,
            egresadoCiclo: del, generacion: del, egresadoFecha: del,
            promotedFrom: del, promotedCiclo: del, promotedAt: del,
          }}));
          await _commitUpdates(updates);
          if (d.cicloActualizado) {
            await DB.doc('config', 'school').set({ cicloEscolar: d.ciclo, semestre: 'SEGUNDO SEMESTRE' }, { merge: true });
          }
          await db.collection('promotions').doc(_lastPromo.id).set({
            status: 'undone',
            undoneAt: firebase.firestore.FieldValue.serverTimestamp(),
            undoneBy: auth.currentUser?.uid || '',
          }, { merge: true });
          Store.invalidate('students');
          Store.invalidate('grades');
          DB.audit('deshacer_promocion', 'alumno', _lastPromo.id, { description: `Promoción revertida (ciclo ${d.ciclo})` });
          Toast.show('✓ Promoción revertida. Todo volvió a su estado anterior.', 'success', 6000);
          await render();
        } catch (e) {
          console.error('[promocion] error al deshacer', e);
          Toast.show('Error al revertir: ' + (e.message || ''), 'error');
          await render();
        }
      }
    );
  }

  return { render };
})();
Router.modules['promocion'] = () => Promocion.render();
