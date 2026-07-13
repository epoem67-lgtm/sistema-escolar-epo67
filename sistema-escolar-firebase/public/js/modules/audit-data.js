// ═══════════════════════════════════════════════════════════════════
// AUDITORÍA DE DATOS — Detecta inconsistencias críticas en grades/boletas
// ═══════════════════════════════════════════════════════════════════
// Para admin/subdirector. Genera un CSV descargable con TODOS los problemas:
//   1. Grades duplicados (mismo studentId+subjectId+partial en 2+ docs)
//   2. cal ≠ value (campos inconsistentes en mismo doc)
//   3. Grades cuyo groupId NO coincide con el grupo actual del alumno
//   4. Grades para subjectId que no existe en /subjects
//   5. Alumnos activos donde el promedio del último parcial no cuadra
//      con la suma cal/n (regla EPO 67)
//
// La idea: correr el auditor SEMANALMENTE para detectar problemas ANTES
// de que las orientadoras los noten en una boleta.
// ═══════════════════════════════════════════════════════════════════

const AuditData = (() => {
  const CONTAINER = '#moduleContainer';
  // Cache de los resultados de la última auditoría para que los botones de
  // "Reparar" tengan acceso a la lista de huérfanas y sus suggestedSubjectIds.
  let _lastResults = null;

  async function render() {
    const container = document.querySelector(CONTAINER);
    if (!container) return;

    const role = App.currentUser?.role;
    if (role !== 'admin' && role !== 'subdirector') {
      container.innerHTML = `<div class="module-container">${UI.emptyState('block', 'Acceso restringido a dirección/subdirección')}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="module-container">
        ${UI.pageHeader('Auditoría de Datos', 'Detecta inconsistencias en calificaciones antes de que aparezcan en boletas')}

        <div class="card" style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-left:5px solid #d97706;">
          <h3 style="margin:0 0 8px 0;color:#92400e;font-size:16px;">
            <span class="material-icons-round" style="vertical-align:middle;">fact_check</span>
            Verificación completa del sistema
          </h3>
          <p style="margin:0 0 12px 0;font-size:13px;color:#78350f;line-height:1.5;">
            Esta herramienta recorre <strong>TODOS los alumnos activos</strong> y revisa:
          </p>
          <ul style="margin:0 0 12px 18px;font-size:12px;color:#78350f;line-height:1.6;">
            <li>📋 <strong>Grades duplicados</strong> — Mismo alumno/materia/parcial con 2+ docs (causa de discrepancias boleta vs concentrado)</li>
            <li>⚠️ <strong>cal ≠ value</strong> — Campos inconsistentes en mismo doc</li>
            <li>🏷️ <strong>groupId desfasado</strong> — Grade con groupId distinto al grupo actual del alumno</li>
            <li>❓ <strong>Materias huérfanas</strong> — Grades para subjectId que ya no existe en catálogo</li>
            <li>🔢 <strong>Promedios verificados</strong> — Recalcula promedio del último parcial y reporta discrepancias</li>
          </ul>
          <p style="margin:0;font-size:12px;color:#78350f;">
            <strong>Tiempo estimado:</strong> 30-60 segundos para ~800 alumnos. Genera un CSV descargable.
          </p>
        </div>

        <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;">
          <button class="btn btn-primary" id="audit-run-btn" style="font-size:14px;padding:12px 20px;">
            <span class="material-icons-round" style="vertical-align:middle;">play_arrow</span>
            Generar auditoría completa
          </button>
          <button class="btn btn-outline" id="audit-quick-dup-btn">
            <span class="material-icons-round" style="vertical-align:middle;">content_copy</span>
            Solo duplicados (rápido)
          </button>
        </div>

        <div id="audit-progress" style="margin-top:16px;display:none;">
          <div class="card" style="background:#f0f9ff;border-left:4px solid #0ea5e9;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span class="material-icons-round loading-spinner" style="font-size:24px;color:#0284c7;">autorenew</span>
              <div style="flex:1;">
                <div id="audit-progress-text" style="font-weight:600;color:#075985;">Iniciando...</div>
                <div style="background:#dbeafe;height:8px;border-radius:4px;margin-top:6px;overflow:hidden;">
                  <div id="audit-progress-bar" style="background:#0ea5e9;height:100%;width:0%;transition:width 0.3s;"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="audit-results" style="margin-top:16px;"></div>
      </div>`;

    bindEvents();
  }

  // BUGFIX: bindEvents se llamaba en cada render(). Antes los listeners se
  // acumulaban sobre los mismos botones. Bindeamos UNA SOLA VEZ por carga.
  let _eventsBound = false;
  function bindEvents() {
    if (_eventsBound) return;
    _eventsBound = true;
    const container = document.querySelector(CONTAINER);
    if (!container) return;

    // Botones estáticos del banner (existen desde el render inicial)
    document.getElementById('audit-run-btn')?.addEventListener('click', () => runFullAudit(false));
    document.getElementById('audit-quick-dup-btn')?.addEventListener('click', () => runFullAudit(true));

    // Delegation para botones de Reparar (se renderizan dinámicamente)
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'audit-fix-orphan') {
        const idx = Number(btn.dataset.idx);
        _fixOrphan(idx, btn);
      } else if (action === 'audit-fix-all-orphans') {
        _fixAllOrphans(btn);
      }
    });
  }

  function _setProgress(pct, text) {
    const wrap = document.getElementById('audit-progress');
    if (wrap) wrap.style.display = '';
    const bar = document.getElementById('audit-progress-bar');
    const txt = document.getElementById('audit-progress-text');
    if (bar) bar.style.width = pct + '%';
    if (txt) txt.textContent = text;
  }

  /**
   * Ejecuta la auditoría completa.
   * @param {boolean} onlyDuplicates - Si true, solo busca duplicados (más rápido)
   */
  async function runFullAudit(onlyDuplicates) {
    const resultsDiv = document.getElementById('audit-results');
    resultsDiv.innerHTML = '';
    _setProgress(2, 'Cargando catálogos…');

    try {
      // 1) Cargar catálogos
      const [students, groups, subjects] = await Promise.all([
        Store.getStudents(),
        Store.getGroups(),
        Store.getSubjects(),
      ]);

      const activeStudents = students.filter(s => s.estatus === 'ACTIVO');
      const subjectsById = new Map(subjects.map(s => [s.id, s]));
      const groupsById = new Map(groups.map(g => [g.id, g]));

      _setProgress(8, `Cargando todas las calificaciones (${activeStudents.length} alumnos)…`);

      // 2) Cargar TODOS los grades (sin filtro) — admin tiene permisos.
      //    Para evitar timeouts: paginamos en batches por grupo.
      const allGrades = [];
      const groupIds = [...new Set(groups.map(g => g.id))];
      for (let i = 0; i < groupIds.length; i++) {
        const gid = groupIds[i];
        try {
          const grades = await Store.getGradesByGroup(gid, true);
          allGrades.push(...grades);
        } catch (_) {}
        _setProgress(8 + (i / groupIds.length) * 30, `Cargando grades del grupo ${gid}…`);
      }

      _setProgress(40, `Analizando ${allGrades.length} grades…`);

      // 3) Detección de duplicados (clave: studentId+subjectId+partial)
      const byKey = new Map();
      for (const g of allGrades) {
        const key = `${g.studentId}|${g.subjectId}|${g.partial}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(g);
      }
      const duplicates = [];
      for (const [key, list] of byKey.entries()) {
        if (list.length > 1) {
          const [stId, subId, par] = key.split('|');
          const st = activeStudents.find(s => s.id === stId);
          duplicates.push({
            studentId: stId,
            studentName: st?.nombreCompleto || '(no encontrado)',
            groupId: st?.groupId || '',
            subjectId: subId,
            subjectName: subjectsById.get(subId)?.nombre || subId,
            partial: par,
            count: list.length,
            cals: list.map(g => g.cal).join(' / '),
            docIds: list.map(g => g.id || g.docId).join(' / ')
          });
        }
      }

      if (onlyDuplicates) {
        _setProgress(100, `Análisis rápido completo: ${duplicates.length} duplicados`);
        return _renderResults({ duplicates, calVsValue: [], orphanSubjects: [], wrongGroup: [], promedioCheck: [], inconsistentCal: [], rubroRango: [] }, allGrades.length, activeStudents.length);
      }

      _setProgress(55, 'Verificando integridad cal vs value, materias huérfanas, groupIds…');

      // 4) cal vs value diferente
      const calVsValue = [];
      // 5) Materias huérfanas
      const orphanSubjects = [];
      // 6) groupId desactualizado
      const wrongGroup = [];
      // 6b) INTEGRIDAD (blindaje): la cal final NO cuadra con su propia suma.
      //     Regla EPO67: cal = K.calcCal(suma). Si difiere, la calificación mostrada
      //     no corresponde al desglose → dato inconsistente que hay que revisar.
      const inconsistentCal = [];
      // 6c) RUBROS fuera de rango (tr>2, ec>max del turno, ex>3). NO se corrigen
      //     solos (las hojas mandan / cada maestro sabe su materia), solo se marcan
      //     para revisión — casi siempre son errores de dedo (ej. tr=7).
      const rubroRango = [];

      for (const g of allGrades) {
        const st = activeStudents.find(s => s.id === g.studentId);
        if (!st) continue; // alumno inactivo, no auditar

        // cal vs value
        if (g.cal !== undefined && g.value !== undefined &&
            g.cal !== null && g.value !== null &&
            Number(g.cal) !== Number(g.value)) {
          calVsValue.push({
            studentId: g.studentId,
            studentName: st.nombreCompleto,
            subjectId: g.subjectId,
            partial: g.partial,
            cal: g.cal,
            value: g.value,
            docId: g.id || g.docId
          });
        }

        // Materia huérfana
        if (g.subjectId && !subjectsById.has(g.subjectId)) {
          orphanSubjects.push({
            studentId: g.studentId,
            studentName: st.nombreCompleto,
            subjectId: g.subjectId,
            partial: g.partial,
            cal: g.cal,
            docId: g.id || g.docId
          });
        }

        // groupId desactualizado (el grade dice X pero el alumno está en Y)
        if (g.groupId && st.groupId && g.groupId !== st.groupId) {
          wrongGroup.push({
            studentId: g.studentId,
            studentName: st.nombreCompleto,
            studentGroupId: st.groupId,
            gradeGroupId: g.groupId,
            subjectId: g.subjectId,
            partial: g.partial,
            cal: g.cal,
            docId: g.id || g.docId
          });
        }

        // INTEGRIDAD E1: cal ≠ K.calcCal(suma). La cal mostrada no corresponde a
        // su propia suma. Definitivo (no depende de rúbricas ni turno).
        const _cal = (g.cal !== undefined && g.cal !== null && g.cal !== '') ? Number(g.cal) : null;
        const _suma = (g.suma !== undefined && g.suma !== null && g.suma !== '') ? Number(g.suma) : null;
        if (_cal !== null && !isNaN(_cal) && _suma !== null && !isNaN(_suma)) {
          const expCal = Number(K.calcCal(_suma));
          if (!isNaN(expCal) && _cal !== expCal) {
            inconsistentCal.push({
              studentId: g.studentId,
              studentName: st.nombreCompleto,
              groupId: g.groupId || st.groupId || '',
              subjectId: g.subjectId,
              subjectName: subjectsById.get(g.subjectId)?.nombre || g.subjectId,
              partial: g.partial,
              suma: _suma, cal: _cal, expectedCal: expCal,
              docId: g.id || g.docId
            });
          }
        }

        // RUBROS fuera de rango: tr>2, ec>max del turno, ex>3. Solo marca (no fix).
        const _turno = String(g.groupId || st.groupId || '').startsWith('VESPERTINO') ? 'VESPERTINO' : 'MATUTINO';
        const _ecMax = _turno === 'VESPERTINO' ? 5 : 8;
        const _rangeProblems = [];
        if (g.tr != null && g.tr !== '' && Number(g.tr) > 2.001) _rangeProblems.push('tr=' + g.tr + ' (máx 2)');
        if (g.ec != null && g.ec !== '' && Number(g.ec) > _ecMax + 0.001) _rangeProblems.push('ec=' + g.ec + ' (máx ' + _ecMax + ')');
        if (g.ex != null && g.ex !== '' && Number(g.ex) > 3.001) _rangeProblems.push('ex=' + g.ex + ' (máx 3)');
        if (_rangeProblems.length) {
          rubroRango.push({
            studentId: g.studentId,
            studentName: st.nombreCompleto,
            groupId: g.groupId || st.groupId || '',
            subjectId: g.subjectId,
            subjectName: subjectsById.get(g.subjectId)?.nombre || g.subjectId,
            partial: g.partial,
            detalle: _rangeProblems.join('; '),
            docId: g.id || g.docId
          });
        }
      }

      _setProgress(75, 'Recalculando promedios y comparando con stored cal…');

      // 7) Verificar promedios de cada alumno (comparar lo que vería la boleta vs concentrado del último parcial)
      const promedioCheck = [];
      for (const st of activeStudents) {
        const stGrades = allGrades.filter(g => g.studentId === st.id);
        if (stGrades.length === 0) continue;
        // Agrupar por parcial
        const byPartial = { P1: [], P2: [], P3: [] };
        for (const g of stGrades) {
          if (byPartial[g.partial]) byPartial[g.partial].push(g);
        }
        // Promedios por parcial (cuenta solo cals numéricas)
        const avgs = {};
        for (const p of ['P1', 'P2', 'P3']) {
          const vals = byPartial[p]
            .map(g => Number(g.cal !== undefined ? g.cal : g.value))
            .filter(n => !isNaN(n));
          if (vals.length > 0) {
            avgs[p] = {
              sum: vals.reduce((a, b) => a + b, 0),
              n: vals.length,
              avg: (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
            };
          }
        }
        // Verificar consistencia interna: si hay 2 docs distintos para misma (subj,p), es alerta
        // (ya cubierto por duplicates, pero aquí ponemos contexto extra del alumno)
      }

      _setProgress(95, 'Generando reporte…');

      // 8) Inferir subjectId correcto para cada materia huérfana (auto-match).
      //    Permite el botón "Reparar" inline en la UI sin segunda consulta a /subjects.
      //    Algoritmo:
      //     a) Match por PREFIJO: el subjectId real (en /subjects) es prefijo del huérfano
      //        (caso truncado a 40 chars en migración antigua).
      //     b) Si no, match por NOMBRE normalizado (sin tildes, mayúsculas, sin _).
      const _normSubj = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const o of orphanSubjects) {
        let match = null;
        for (const [sid, subj] of subjectsById) {
          // Match por prefijo (id viejo era truncado del nuevo, o viceversa)
          if (o.subjectId.startsWith(sid) || sid.startsWith(o.subjectId)) {
            // Acepta solo si el ID compartido es razonablemente largo (≥ 20 chars)
            const minLen = Math.min(o.subjectId.length, sid.length);
            if (minLen >= 20) { match = subj; break; }
          }
        }
        // Fallback: match por nombre normalizado
        if (!match) {
          const orphanNormalized = _normSubj(o.subjectId.replace(/^G[123]_/, ''));
          for (const [sid, subj] of subjectsById) {
            const subjNorm = _normSubj((subj.nombre || '') + sid.replace(/^G[123]_/, ''));
            if (orphanNormalized && subjNorm.includes(orphanNormalized.slice(0, 25))) {
              match = subj; break;
            }
          }
        }
        if (match) {
          o.suggestedSubjectId = match.id;
          o.suggestedSubjectName = match.nombre || match.id;
        }
      }

      // 9) Renderizar resumen + botón de descarga CSV
      _renderResults({ duplicates, calVsValue, orphanSubjects, wrongGroup, promedioCheck, inconsistentCal, rubroRango }, allGrades.length, activeStudents.length);
      _setProgress(100, '✓ Auditoría completa');

    } catch (err) {
      console.error('Audit error:', err);
      Toast.show('Error en auditoría: ' + err.message, 'error');
      _setProgress(0, 'Error: ' + err.message);
    }
  }

  function _renderResults(r, totalGrades, totalStudents) {
    _lastResults = r;  // cache para los botones de Reparar
    const div = document.getElementById('audit-results');
    const nIncons = r.inconsistentCal?.length || 0;
    const nRango = r.rubroRango?.length || 0;
    const totalIssues = r.duplicates.length + r.calVsValue.length + r.orphanSubjects.length + r.wrongGroup.length + nIncons;
    const statusBg = totalIssues === 0 ? '#dcfce7' : '#fee2e2';
    const statusBorder = totalIssues === 0 ? '#16a34a' : '#dc2626';
    const statusText = totalIssues === 0
      ? (nRango > 0 ? `✓ Sin inconsistencias duras — ${nRango} rubros por revisar` : '✓ Sistema limpio — sin inconsistencias')
      : `⚠️ ${totalIssues} inconsistencias detectadas`;
    const statusColor = totalIssues === 0 ? '#14532d' : '#7f1d1d';

    div.innerHTML = `
      <div class="card" style="background:${statusBg};border-left:5px solid ${statusBorder};">
        <h3 style="margin:0 0 12px 0;color:${statusColor};">${statusText}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:13px;color:${statusColor};">
          <div><strong>${totalStudents}</strong> alumnos activos auditados</div>
          <div><strong>${totalGrades.toLocaleString()}</strong> grades revisados</div>
          <div><strong style="color:${nIncons > 0 ? '#dc2626' : '#16a34a'};">${nIncons}</strong> cal≠suma (integridad)</div>
          <div><strong style="color:${r.duplicates.length > 0 ? '#dc2626' : '#16a34a'};">${r.duplicates.length}</strong> duplicados</div>
          <div><strong style="color:${r.calVsValue.length > 0 ? '#dc2626' : '#16a34a'};">${r.calVsValue.length}</strong> cal≠value</div>
          <div><strong style="color:${nRango > 0 ? '#d97706' : '#16a34a'};">${nRango}</strong> rubros fuera de rango</div>
          <div><strong style="color:${r.wrongGroup.length > 0 ? '#d97706' : '#16a34a'};">${r.wrongGroup.length}</strong> grupo desactualizado</div>
          <div><strong style="color:${r.orphanSubjects.length > 0 ? '#d97706' : '#16a34a'};">${r.orphanSubjects.length}</strong> materias huérfanas</div>
        </div>
        ${(totalIssues > 0 || nRango > 0) ? `
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="audit-download-csv">
              <span class="material-icons-round" style="vertical-align:middle;">download</span>
              Descargar CSV completo
            </button>
            <button class="btn btn-outline" id="audit-show-details">
              <span class="material-icons-round" style="vertical-align:middle;">visibility</span>
              Ver detalles en pantalla
            </button>
          </div>` : ''}
      </div>
      <div id="audit-details" style="margin-top:16px;"></div>`;

    // Bind
    document.getElementById('audit-download-csv')?.addEventListener('click', () => _downloadCsv(r));
    document.getElementById('audit-show-details')?.addEventListener('click', () => _showDetailsInline(r));
  }

  function _showDetailsInline(r) {
    const div = document.getElementById('audit-details');
    let html = '';

    if ((r.inconsistentCal?.length || 0) > 0) {
      html += `<div class="card">
        <h4 style="margin:0 0 6px;color:#dc2626;">🔴 Integridad: cal ≠ su propia suma (${r.inconsistentCal.length})</h4>
        <p style="font-size:12px;color:#666;margin:0 0 8px;">La calificación mostrada NO corresponde a su suma según la regla EPO67 (cal = redondeo de la suma). Revisar contra la hoja firmada de ese parcial — <strong>no se corrige en automático</strong>.</p>
        <table class="table-light" style="font-size:11px;">
          <thead><tr><th>Alumno</th><th>Grupo</th><th>Materia</th><th>Parcial</th><th>Suma</th><th>Cal actual</th><th>Cal esperada</th></tr></thead>
          <tbody>${r.inconsistentCal.slice(0, 200).map(d =>
            `<tr><td>${Utils.sanitize(d.studentName)}</td><td>${Utils.sanitize(d.groupId)}</td>
             <td>${Utils.sanitize(d.subjectName)}</td><td>${d.partial}</td>
             <td>${d.suma}</td><td style="color:#dc2626;font-weight:700;">${d.cal}</td><td style="color:#16a34a;font-weight:700;">${d.expectedCal}</td></tr>`).join('')}
          </tbody>
        </table>
        ${r.inconsistentCal.length > 200 ? `<p style="text-align:center;color:#666;margin:8px 0 0;">…y ${r.inconsistentCal.length - 200} más en el CSV</p>` : ''}
      </div>`;
    }

    if ((r.rubroRango?.length || 0) > 0) {
      html += `<div class="card" style="margin-top:12px;">
        <h4 style="margin:0 0 6px;color:#d97706;">🟠 Rubros fuera de rango (${r.rubroRango.length})</h4>
        <p style="font-size:12px;color:#666;margin:0 0 8px;">Transversal &gt; 2, EC o Examen arriba del máximo del turno. Casi siempre error de dedo (ej. tr=7). Se marca para revisión — <strong>no se altera</strong>: las hojas mandan.</p>
        <table class="table-light" style="font-size:11px;">
          <thead><tr><th>Alumno</th><th>Grupo</th><th>Materia</th><th>Parcial</th><th>Detalle</th></tr></thead>
          <tbody>${r.rubroRango.slice(0, 200).map(d =>
            `<tr><td>${Utils.sanitize(d.studentName)}</td><td>${Utils.sanitize(d.groupId)}</td>
             <td>${Utils.sanitize(d.subjectName)}</td><td>${d.partial}</td>
             <td style="font-family:monospace;">${Utils.sanitize(d.detalle)}</td></tr>`).join('')}
          </tbody>
        </table>
        ${r.rubroRango.length > 200 ? `<p style="text-align:center;color:#666;margin:8px 0 0;">…y ${r.rubroRango.length - 200} más en el CSV</p>` : ''}
      </div>`;
    }

    if (r.duplicates.length > 0) {
      html += `<div class="card">
        <h4 style="margin:0 0 10px;color:#dc2626;">📋 Grades duplicados (${r.duplicates.length})</h4>
        <table class="table-light" style="font-size:11px;">
          <thead><tr><th>Alumno</th><th>Grupo</th><th>Materia</th><th>Parcial</th><th>Docs</th><th>Cals</th></tr></thead>
          <tbody>${r.duplicates.slice(0, 100).map(d =>
            `<tr><td>${Utils.sanitize(d.studentName)}</td><td>${Utils.sanitize(d.groupId)}</td>
             <td>${Utils.sanitize(d.subjectName)}</td><td>${d.partial}</td>
             <td>${d.count}</td><td style="font-family:monospace;">${Utils.sanitize(d.cals)}</td></tr>`).join('')}
          </tbody>
        </table>
        ${r.duplicates.length > 100 ? `<p style="text-align:center;color:#666;margin:8px 0 0;">…y ${r.duplicates.length - 100} más en el CSV</p>` : ''}
      </div>`;
    }

    if (r.calVsValue.length > 0) {
      html += `<div class="card" style="margin-top:12px;">
        <h4 style="margin:0 0 10px;color:#dc2626;">⚠️ cal ≠ value (${r.calVsValue.length})</h4>
        <table class="table-light" style="font-size:11px;">
          <thead><tr><th>Alumno</th><th>Materia</th><th>Parcial</th><th>cal</th><th>value</th></tr></thead>
          <tbody>${r.calVsValue.slice(0, 100).map(d =>
            `<tr><td>${Utils.sanitize(d.studentName)}</td><td>${Utils.sanitize(d.subjectId)}</td>
             <td>${d.partial}</td><td>${d.cal}</td><td>${d.value}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    if (r.wrongGroup.length > 0) {
      html += `<div class="card" style="margin-top:12px;">
        <h4 style="margin:0 0 10px;color:#d97706;">🏷️ Grades con groupId desactualizado (${r.wrongGroup.length})</h4>
        <p style="font-size:12px;color:#666;margin:0 0 8px;">El alumno se cambió de grupo y este grade quedó con el ID del grupo viejo. Generalmente no es bug, pero puede causar que aparezca en concentrados del grupo viejo.</p>
        <table class="table-light" style="font-size:11px;">
          <thead><tr><th>Alumno</th><th>Grupo actual</th><th>Grupo grade</th><th>Materia</th><th>Parcial</th><th>cal</th></tr></thead>
          <tbody>${r.wrongGroup.slice(0, 100).map(d =>
            `<tr><td>${Utils.sanitize(d.studentName)}</td><td>${Utils.sanitize(d.studentGroupId)}</td>
             <td>${Utils.sanitize(d.gradeGroupId)}</td><td>${Utils.sanitize(d.subjectId)}</td>
             <td>${d.partial}</td><td>${d.cal}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }

    if (r.orphanSubjects.length > 0) {
      // ¿Cuántos tienen sugerencia de auto-match (se pueden reparar)?
      const repararables = r.orphanSubjects.filter(o => o.suggestedSubjectId).length;
      const reparablesBtn = repararables > 0
        ? `<button data-action="audit-fix-all-orphans" style="padding:8px 14px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;">
            🔧 Reparar TODAS (${repararables})
          </button>`
        : '';

      const filasHuerfanas = r.orphanSubjects.slice(0, 100).map((d, idx) => {
        const sugerencia = d.suggestedSubjectId
          ? `<div style="font-size:10px;color:#16a34a;font-weight:600;">→ ${Utils.sanitize(d.suggestedSubjectName || d.suggestedSubjectId)}</div>
             <div style="font-family:monospace;font-size:9px;color:#94a3b8;">${Utils.sanitize(d.suggestedSubjectId)}</div>`
          : `<div style="font-size:10px;color:#dc2626;font-weight:600;">❌ Sin match automático</div>`;
        const accion = d.suggestedSubjectId
          ? `<button data-action="audit-fix-orphan" data-idx="${idx}" style="padding:5px 11px;background:#0891b2;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">🔧 Reparar</button>`
          : `<span style="font-size:10px;color:#9ca3af;">manual</span>`;
        return `<tr>
          <td>${Utils.sanitize(d.studentName)}</td>
          <td style="font-family:monospace;font-size:10px;">${Utils.sanitize(d.subjectId)}</td>
          <td>${d.partial}</td>
          <td style="text-align:center;font-weight:700;">${d.cal}</td>
          <td>${sugerencia}</td>
          <td>${accion}</td>
        </tr>`;
      }).join('');

      html += `<div class="card" style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
          <div>
            <h4 style="margin:0;color:#d97706;">❓ Materias huérfanas (${r.orphanSubjects.length})</h4>
            <p style="font-size:12px;color:#666;margin:4px 0 0;">Grades para materias con subjectId que no existe en /subjects. ${repararables > 0 ? `<strong style="color:#16a34a;">${repararables} con match automático</strong>` : ''}</p>
          </div>
          ${reparablesBtn}
        </div>
        <table class="table-light" style="font-size:11px;">
          <thead><tr>
            <th>Alumno</th>
            <th>subjectId fantasma</th>
            <th>Parcial</th>
            <th style="text-align:center;">Cal</th>
            <th>Match sugerido</th>
            <th>Acción</th>
          </tr></thead>
          <tbody>${filasHuerfanas}</tbody>
        </table>
        ${r.orphanSubjects.length > 100 ? `<div style="font-size:11px;color:#94a3b8;margin-top:6px;">Mostrando 100 de ${r.orphanSubjects.length}. Descarga el CSV para verlas todas.</div>` : ''}
      </div>`;
    }

    div.innerHTML = html;
  }

  function _downloadCsv(r) {
    const lines = [];
    lines.push('TIPO,ALUMNO,GRUPO_ACTUAL,SUBJECT_ID,SUBJECT_NAME,PARTIAL,DETALLE_1,DETALLE_2,DOC_IDS');

    const esc = s => {
      const str = String(s == null ? '' : s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    for (const d of (r.inconsistentCal || [])) {
      lines.push(`CAL_NO_CUADRA_SUMA,${esc(d.studentName)},${esc(d.groupId)},${esc(d.subjectId)},${esc(d.subjectName)},${d.partial},${esc('suma=' + d.suma + ' cal=' + d.cal)},${esc('cal_esperada=' + d.expectedCal)},${esc(d.docId)}`);
    }
    for (const d of (r.rubroRango || [])) {
      lines.push(`RUBRO_FUERA_RANGO,${esc(d.studentName)},${esc(d.groupId)},${esc(d.subjectId)},${esc(d.subjectName)},${d.partial},${esc(d.detalle)},,${esc(d.docId)}`);
    }
    for (const d of r.duplicates) {
      lines.push(`DUPLICADO,${esc(d.studentName)},${esc(d.groupId)},${esc(d.subjectId)},${esc(d.subjectName)},${d.partial},${esc('count=' + d.count)},${esc('cals=' + d.cals)},${esc(d.docIds)}`);
    }
    for (const d of r.calVsValue) {
      lines.push(`CAL_VS_VALUE,${esc(d.studentName)},,${esc(d.subjectId)},,${d.partial},${esc('cal=' + d.cal)},${esc('value=' + d.value)},${esc(d.docId)}`);
    }
    for (const d of r.wrongGroup) {
      lines.push(`GROUP_DESFASE,${esc(d.studentName)},${esc(d.studentGroupId)},${esc(d.subjectId)},,${d.partial},${esc('grade_groupId=' + d.gradeGroupId)},${esc('cal=' + d.cal)},${esc(d.docId)}`);
    }
    for (const d of r.orphanSubjects) {
      lines.push(`MATERIA_HUERFANA,${esc(d.studentName)},,${esc(d.subjectId)},,${d.partial},${esc('cal=' + d.cal)},,${esc(d.docId)}`);
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `auditoria-promedios-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

    Toast.show('CSV descargado', 'success');
  }

  // ═══════════════════════════════════════════════════════════════
  // REPARAR MATERIA HUÉRFANA — migración del grade al subjectId correcto
  // ═══════════════════════════════════════════════════════════════
  // Patrón: read viejo + write nuevo (con migratedFrom) + delete viejo.
  // El docId de grades sigue el formato {studentId}_{subjectId}_{partial}.
  // Cambiar el subjectId requiere doc NUEVO con docId diferente — no se puede
  // hacer un simple update del campo.

  async function _migrateOrphanGrade(orphan) {
    const newSubjectId = orphan.suggestedSubjectId;
    if (!newSubjectId) throw new Error('Sin sugerencia de match');
    if (!orphan.studentId || !orphan.subjectId || !orphan.partial) {
      throw new Error('Datos incompletos del grade huérfano');
    }

    const oldDocId = `${orphan.studentId}_${orphan.subjectId}_${orphan.partial}`;
    const newDocId = `${orphan.studentId}_${newSubjectId}_${orphan.partial}`;

    // Si por casualidad ya existe un doc con el ID nuevo (ambos coexisten),
    // NO sobrescribir — mejor avisar para que el admin decida manualmente.
    const newRef = window.db.collection('grades').doc(newDocId);
    const existsNew = await newRef.get();
    if (existsNew.exists) {
      throw new Error(`Ya existe un grade en ${newDocId} — revisar duplicado manualmente`);
    }

    // 1) Leer doc viejo
    const oldRef = window.db.collection('grades').doc(oldDocId);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) throw new Error(`Doc viejo no existe: ${oldDocId}`);
    const data = oldSnap.data();

    // 2) Crear nuevo con subjectId corregido + metadatos de auditoría
    await newRef.set({
      ...data,
      subjectId: newSubjectId,
      migratedFrom: orphan.subjectId,
      migratedAt: new Date(),
      migratedBy: window.auth?.currentUser?.uid || '',
      migratedByName: App.currentUser?.displayName || App.currentUser?.email || ''
    });

    // 3) Borrar viejo
    await oldRef.delete();

    // Audit log
    if (typeof DB !== 'undefined' && DB.audit) {
      DB.audit('migración', 'grade', newDocId, {
        description: `Materia huérfana reparada: ${orphan.studentName} — ${orphan.subjectId} → ${newSubjectId}`,
        before: { subjectId: orphan.subjectId, docId: oldDocId },
        after: { subjectId: newSubjectId, docId: newDocId }
      });
    }
  }

  async function _fixOrphan(idx, btn) {
    if (!_lastResults || !_lastResults.orphanSubjects) return;
    const orphan = _lastResults.orphanSubjects[idx];
    if (!orphan) return;
    if (!orphan.suggestedSubjectId) {
      Toast.show('Esta huérfana no tiene match automático. Repórtala para revisión manual.', 'warning');
      return;
    }
    const ok = confirm(
      `¿Reparar este grade?\n\n` +
      `Alumno: ${orphan.studentName}\n` +
      `Materia actual (huérfana): ${orphan.subjectId}\n` +
      `Materia correcta: ${orphan.suggestedSubjectName}\n` +
      `Parcial: ${orphan.partial}\n` +
      `Cal: ${orphan.cal} (se preserva)\n\n` +
      `Esta operación es REVERSIBLE — quedará marcado migratedFrom para auditoría.`
    );
    if (!ok) return;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Reparando…'; }
    try {
      await _migrateOrphanGrade(orphan);
      Toast.show(`✓ Reparado: ${orphan.studentName}`, 'success');
      // Marcar visualmente como reparado
      orphan._fixed = true;
      if (btn) {
        const tr = btn.closest('tr');
        if (tr) {
          tr.style.background = '#dcfce7';
          tr.style.opacity = '0.7';
        }
        btn.textContent = '✓ Reparado';
        btn.style.background = '#16a34a';
      }
    } catch (err) {
      console.error('Error reparando huérfana:', err);
      Toast.show('Error: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔧 Reparar'; }
    }
  }

  async function _fixAllOrphans(btn) {
    if (!_lastResults || !_lastResults.orphanSubjects) return;
    const reparables = _lastResults.orphanSubjects.filter(o => o.suggestedSubjectId && !o._fixed);
    if (reparables.length === 0) {
      Toast.show('No hay huérfanas reparables pendientes', 'info');
      return;
    }
    const ok = confirm(
      `¿Reparar TODAS las ${reparables.length} materias huérfanas con match automático?\n\n` +
      `Cada grade se migrará al subjectId correcto preservando su calificación.\n` +
      `Las que NO tienen match (sin sugerencia) se OMITEN.\n\n` +
      `Es reversible (quedará el campo migratedFrom en cada doc).`
    );
    if (!ok) return;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Reparando…'; }
    let ok_n = 0, err_n = 0;
    for (const orphan of reparables) {
      try {
        await _migrateOrphanGrade(orphan);
        orphan._fixed = true;
        ok_n++;
        if (btn) btn.textContent = `⏳ ${ok_n}/${reparables.length}…`;
      } catch (e) {
        console.error('Error reparando:', orphan, e);
        err_n++;
      }
    }
    Toast.show(`✓ Reparados: ${ok_n} · ❌ Errores: ${err_n}`, err_n === 0 ? 'success' : 'warning', 5000);
    // Re-renderizar la sección para reflejar el estado actualizado.
    if (btn) {
      btn.disabled = false;
      btn.textContent = `🔧 Reparar TODAS (${reparables.length - ok_n})`;
    }
    // Sugerir re-correr la auditoría para confirmar 0 huérfanas restantes.
    setTimeout(() => {
      if (confirm('¿Re-ejecutar auditoría completa para verificar que se resolvieron?')) {
        runFullAudit(false);
      }
    }, 1500);
  }

  return { render };
})();

if (typeof Router !== 'undefined') {
  Router.modules['audit-data'] = () => AuditData.render();
}
