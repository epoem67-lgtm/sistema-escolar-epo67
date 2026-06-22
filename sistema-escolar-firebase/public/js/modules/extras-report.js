/**
 * ═══════════════════════════════════════════════════════════════
 * Módulo REPORTE DE EXTRAORDINARIOS — vista por orientador
 * ═══════════════════════════════════════════════════════════════
 * Tabla formal con TODOS los alumnos del grupo que tienen al menos
 * una materia en extraordinario. Una fila por (alumno × materia).
 *
 * REGLAS SEP aplicadas (Gaceta EPO 67):
 *   1) PROMEDIO REPROBATORIO — el promedio de los 3 parciales es < 6.
 *      (requiere los 3 parciales capturados)
 *   2) DOS PARCIALES REPROBADOS — sin importar el promedio, 2 o más
 *      parciales con calificación < 6 mandan a extra.
 *   3) INASISTENCIA > 20% — sin importar la calificación, si las faltas
 *      acumuladas pasan del 20% de las horas impartidas, va a extra.
 *
 * Un mismo alumno puede activar varias reglas a la vez. La columna
 * "Causa" muestra TODAS las reglas activas para ese caso.
 *
 * Roles que ven el módulo: admin, subdirector, directivo, orientador,
 * orientador_docente, auditor. Orientadores ven SOLO sus grupos.
 * ═══════════════════════════════════════════════════════════════
 */
const ExtrasReportModule = (() => {
  let _state = {
    turno: '',
    grado: '',
    grupo: '',
    generated: null,
  };

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando reporte de extraordinarios...');

    try {
      const [groups, teachers, oriGroupIds] = await Promise.all([
        Store.getGroups(),
        Store.getTeachers(),
        Store.getOrientadorGroups().catch(() => []),
      ]);

      _state.allTeachers = teachers;
      _state.orientadorScope = oriGroupIds;

      if (Array.isArray(oriGroupIds)) {
        if (oriGroupIds.length === 0) {
          container.innerHTML = UI.errorState(
            'No tienes grupos asignados como orientador. Solo los orientadores con grupos pueden generar este reporte.'
          );
          return;
        }
        const oriSet = new Set(oriGroupIds);
        _state.allGroups = groups.filter(g => oriSet.has(g.id));
      } else {
        _state.allGroups = groups;
      }

      _renderUI(container);
    } catch (e) {
      console.error('[extras-report] error', e);
      container.innerHTML = UI.errorState('Error al cargar: ' + (e.message || ''));
    }
  }

  function _renderUI(container) {
    const isRestricted = Array.isArray(_state.orientadorScope);
    const myTurnos = isRestricted
      ? [...new Set(_state.allGroups.map(g => g.turno).filter(Boolean))]
      : K.TURNOS;
    const myGrados = isRestricted
      ? [...new Set(_state.allGroups.map(g => Number(g.grado)).filter(Boolean))].sort()
      : K.GRADOS;
    const turnoOptions = myTurnos.map(t => `<option value="${t}">${t}</option>`).join('');
    const gradoOptions = myGrados.map(g => `<option value="${g}">${g}° Grado</option>`).join('');

    const scopeMsg = isRestricted
      ? `<span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:6px;font-weight:600;font-size:12px;margin-left:8px;">Solo tus ${_state.allGroups.length} grupo(s) como orientador</span>`
      : '';

    container.innerHTML = UI.moduleContainer(`
      <div class="module-header">
        <div class="module-header-text">
          <h1 class="module-title">Reporte de Extraordinarios ${scopeMsg}</h1>
          <p class="module-subtitle">Tabla formal por alumno/materia con la regla SEP que activa cada caso · Para entrevistas, Consejo Técnico y Dirección</p>
        </div>
      </div>

      <div class="card no-print" style="padding:18px 20px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;align-items:end;">
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Turno</label>
            <select id="exr-turno" class="form-input" style="margin-top:4px;width:100%;">
              <option value="">Selecciona turno</option>${turnoOptions}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Grado</label>
            <select id="exr-grado" class="form-input" style="margin-top:4px;width:100%;">
              <option value="">Selecciona grado</option>${gradoOptions}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Grupo</label>
            <select id="exr-grupo" class="form-input" style="margin-top:4px;width:100%;" disabled>
              <option value="">Selecciona turno y grado</option>
            </select>
          </div>
          <div>
            <button id="exr-generar" class="btn btn-primary" style="width:100%;padding:10px 16px;" disabled>
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">summarize</span>
              Generar reporte
            </button>
          </div>
        </div>
        <div style="margin-top:10px;padding:10px 14px;background:#eef2ff;border-left:3px solid #4338ca;border-radius:4px;font-size:12px;color:#312e81;line-height:1.5;">
          <strong>Reglas aplicadas (Gaceta EPO 67 · SEP):</strong>
          <span style="display:inline-block;margin-left:4px;"><strong>(1)</strong> Promedio de los 3 parciales &lt; 6</span> ·
          <span><strong>(2)</strong> 2 o más parciales reprobados</span> ·
          <span><strong>(3)</strong> Inasistencias &gt; 20%</span>
        </div>
      </div>

      <div id="exr-actions" class="no-print" style="display:none;margin-bottom:12px;text-align:right;">
        <button id="exr-imprimir" class="btn btn-outline" style="padding:8px 14px;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">print</span>
          Imprimir / Guardar PDF
        </button>
      </div>

      <div id="exr-result"></div>
    `);

    _bindEvents();
  }

  function _bindEvents() {
    const elTurno = document.getElementById('exr-turno');
    const elGrado = document.getElementById('exr-grado');
    const elGrupo = document.getElementById('exr-grupo');
    const elGenerar = document.getElementById('exr-generar');

    const updateGroups = () => {
      const t = elTurno.value;
      const g = elGrado.value;
      _state.turno = t;
      _state.grado = g;
      if (!t || !g) {
        elGrupo.innerHTML = '<option value="">Selecciona turno y grado</option>';
        elGrupo.disabled = true;
        elGenerar.disabled = true;
        return;
      }
      const filtered = (_state.allGroups || [])
        .filter(gr => gr.turno === t && String(gr.grado) === String(g))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      if (filtered.length === 0) {
        elGrupo.innerHTML = '<option value="">Sin grupos disponibles</option>';
        elGrupo.disabled = true;
        elGenerar.disabled = true;
        return;
      }
      elGrupo.innerHTML = '<option value="">Selecciona grupo</option>' +
        filtered.map(gr => `<option value="${gr.id}">${gr.nombre}</option>`).join('');
      elGrupo.disabled = false;
      elGenerar.disabled = true;
    };

    elTurno.addEventListener('change', updateGroups);
    elGrado.addEventListener('change', updateGroups);
    elGrupo.addEventListener('change', () => {
      _state.grupo = elGrupo.value;
      elGenerar.disabled = !elGrupo.value;
    });
    elGenerar.addEventListener('click', _generate);
    document.getElementById('exr-imprimir')?.addEventListener('click', () => window.print());
  }

  /**
   * Determina las 3 reglas SEP que aplican para una materia.
   * @returns {Object} { reglas: ['PROM_BAJO', 'DOS_REPROB', 'INASIST'], descripcion: '...' }
   */
  function _evaluarReglasSEP(cals, faltasTotal, horasTotal, passGrade) {
    const reglas = [];
    const valid = cals.filter(c => c != null && !isNaN(Number(c))).map(Number);
    const reprobados = valid.filter(c => c < passGrade).length;
    const promedio = valid.length > 0 ? (valid.reduce((s, c) => s + c, 0) / valid.length) : null;
    const tiene3 = valid.length === 3;
    const pct = horasTotal > 0 ? (faltasTotal * 100) / horasTotal : 0;

    // Regla 1: promedio reprobatorio (solo con 3 parciales)
    if (tiene3 && promedio !== null && promedio < passGrade) {
      reglas.push('PROM_BAJO');
    }
    // Regla 2: dos o más parciales reprobados
    if (reprobados >= 2) {
      reglas.push('DOS_REPROB');
    }
    // Regla 3: inasistencias > 20%
    if (horasTotal > 0 && pct > 20) {
      reglas.push('INASIST');
    }

    return { reglas, promedio, reprobados, pct, valid };
  }

  async function _generate() {
    const resultsDiv = document.getElementById('exr-result');
    resultsDiv.innerHTML = UI.loadingState('Analizando alumnos en extraordinario...');

    try {
      const groupId = _state.grupo;
      const groupDoc = (_state.allGroups || []).find(g => g.id === groupId);
      if (!groupDoc) throw new Error('Grupo no encontrado');

      if (Array.isArray(_state.orientadorScope)) {
        const oriSet = new Set(_state.orientadorScope);
        if (!oriSet.has(groupId)) {
          throw new Error('No tienes permiso para consultar este grupo.');
        }
      }

      const [allStudents, allGrades, allSubjects, allAssignments, hoursAll] = await Promise.all([
        Store.getStudentsByGroup(groupId),
        Store.getGradesByGroup(groupId, true),
        Store.getSubjects(),
        Store.getAssignments(),
        _loadGroupHours(groupId),
      ]);

      const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;

      const groupStudents = allStudents
        .filter(s => {
          const e = (s.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })
        .sort((a, b) =>
          (a.apellido1 || '').localeCompare(b.apellido1 || '') ||
          (a.apellido2 || '').localeCompare(b.apellido2 || '') ||
          (a.nombres || '').localeCompare(b.nombres || '')
        );

      const subsRaw = allSubjects.filter(s => String(s.grado) === String(groupDoc.grado));
      const subjects = (typeof K.sortSubjectsByGrado === 'function')
        ? K.sortSubjectsByGrado(subsRaw, groupDoc.grado)
        : subsRaw;

      const teacherByAsg = {};
      const assignmentsOfGroup = allAssignments.filter(a => a.groupId === groupId);
      for (const a of assignmentsOfGroup) {
        const tDoc = (_state.allTeachers || []).find(t => t.id === a.teacherId);
        teacherByAsg[a.subjectId] = tDoc ? Utils.displayName(tDoc.nombre || '') : '';
      }

      const hoursBySubject = {};
      for (const h of hoursAll) {
        if (!h.subjectId) continue;
        if (!hoursBySubject[h.subjectId]) hoursBySubject[h.subjectId] = {};
        if (h.partial) hoursBySubject[h.subjectId][h.partial] = h;
      }

      // Helper Title Case
      const toTitleCase = (s) => (s || '').toLowerCase().replace(/\b([a-záéíóúñ])/g, c => c.toUpperCase());

      // Construir filas planas: una por (alumno, materia) que esté en extra
      const filas = [];
      const causaCount = { PROM_BAJO: 0, DOS_REPROB: 0, INASIST: 0 };

      groupStudents.forEach((stu, idx) => {
        const np = idx + 1;
        for (const subj of subjects) {
          // Cals del alumno en esta materia
          const sGrades = {};
          for (const p of ['P1', 'P2', 'P3']) {
            const g = allGrades.find(gg => gg.studentId === stu.id && gg.subjectId === subj.id && gg.partial === p);
            if (g) sGrades[p] = g;
          }
          const grades3 = [sGrades.P1 || null, sGrades.P2 || null, sGrades.P3 || null];
          const hoursByPart = hoursBySubject[subj.id] || {};

          // Faltas totales y horas
          let faltasTotal = 0;
          for (const g of grades3) if (g && g.faltas != null) faltasTotal += Number(g.faltas) || 0;
          const MESES = ['febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio'];
          let horasTotal = 0;
          const hSem = hoursByPart.SEMESTRE || hoursByPart.P3 || hoursByPart.P2 || hoursByPart.P1;
          if (hSem) MESES.forEach(m => { horasTotal += Number(hSem[m] || 0); });

          // Extraer cals
          const cals = grades3.map(g => {
            if (!g) return null;
            const c = g.cal != null ? Number(g.cal) : (g.value != null ? Number(g.value) : null);
            return (c == null || isNaN(c)) ? null : c;
          });

          // Evaluar las 3 reglas
          const eval_ = _evaluarReglasSEP(cals, faltasTotal, horasTotal, passGrade);

          // Si NO aplica ninguna regla, NO va a extra
          if (eval_.reglas.length === 0) continue;

          // Contar causas (sumar 1 por cada regla activa)
          eval_.reglas.forEach(r => { causaCount[r]++; });

          filas.push({
            np,
            student: stu,
            nombre: toTitleCase(Utils.displayName(stu.nombreCompleto || '')),
            sexo: (stu.sexo || '').toUpperCase(),
            subject: subj,
            materia: K.getUACNombre(subj.nombre || subj.id),
            teacher: teacherByAsg[subj.id] || '',
            cals,
            promedio: eval_.promedio,
            reprobados: eval_.reprobados,
            faltasTotal,
            horasTotal,
            pctInasistencia: eval_.pct,
            reglas: eval_.reglas,
          });
        }
      });

      // Conteo de alumnos únicos en extra (independiente del # de materias)
      const alumnosUnicos = new Set(filas.map(f => f.student.id)).size;

      const orientador = K.getOrientador(_state.turno, groupDoc.nombre || groupDoc.grupo || '') || '';
      const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
      const grupoLabel = `${groupDoc.grado}°${(groupDoc.nombre || '').split('-')[1] || groupDoc.nombre || ''}`;

      _state.generated = {
        meta: { groupDoc, grupoLabel, turno: _state.turno, cicloEscolar, orientador },
        filas,
        totalActivos: groupStudents.length,
        alumnosUnicos,
        causaCount,
      };

      _renderReport();
    } catch (e) {
      console.error('[extras-report] generate', e);
      resultsDiv.innerHTML = UI.errorState('Error al generar: ' + (e.message || ''));
    }
  }

  async function _loadGroupHours(groupId) {
    try {
      const snap = await db.collection('teacherHours').where('groupId', '==', groupId).get();
      const out = [];
      snap.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
      return out;
    } catch (e) { return []; }
  }

  function _renderReport() {
    const resultsDiv = document.getElementById('exr-result');
    const { meta, filas } = _state.generated;

    if (filas.length === 0) {
      resultsDiv.innerHTML = `
        <div class="card" style="padding:40px;text-align:center;">
          <span class="material-icons-round" style="font-size:48px;color:#16a34a;">check_circle</span>
          <h3 style="margin:12px 0 6px;color:#166534;">¡Grupo SIN extraordinarios!</h3>
          <p style="color:#475569;">Ningún alumno activo del grupo ${Utils.sanitize(meta.grupoLabel)} cae en alguna de las 3 reglas SEP.</p>
        </div>
      `;
      document.getElementById('exr-actions').style.display = 'none';
      return;
    }

    document.getElementById('exr-actions').style.display = 'block';
    resultsDiv.innerHTML = _buildReportHTML();
    _injectPrintStyles();
  }

  function _buildReportHTML() {
    const { meta, filas, totalActivos, alumnosUnicos, causaCount } = _state.generated;
    const logoHeader = (typeof LOGO_HEADER_SRC !== 'undefined' && LOGO_HEADER_SRC) ? LOGO_HEADER_SRC : '';
    const logoEdomex = (typeof LOGO_FOOTER_SRC !== 'undefined' && LOGO_FOOTER_SRC) ? LOGO_FOOTER_SRC : '';

    const totalMaterias = filas.length;
    const pctIrreg = totalActivos > 0 ? ((alumnosUnicos * 100) / totalActivos).toFixed(1) : '0.0';

    // Agrupar por alumno para usar rowspan
    const filasByStudent = new Map();
    for (const f of filas) {
      if (!filasByStudent.has(f.student.id)) filasByStudent.set(f.student.id, []);
      filasByStudent.get(f.student.id).push(f);
    }

    // Construir filas HTML con rowspan en # y Nombre
    let bodyRows = '';
    let zebraIdx = 0;
    for (const [, group] of filasByStudent) {
      const first = group[0];
      const rowsSpan = group.length;
      const zebraClass = (zebraIdx % 2 === 0) ? 'row-zebra-a' : 'row-zebra-b';
      group.forEach((f, i) => {
        const isFirst = i === 0;
        // TRUNCAR (no redondear) el promedio mostrado: regla SEP "calificación debajo
        // de 6 no se redondea arriba". 5.99 sigue siendo 5.99, no 6.00.
        const promTrunc = f.promedio !== null ? Math.floor(f.promedio * 100) / 100 : null;
        const promText = promTrunc !== null ? promTrunc.toFixed(2) : '—';
        const promClass = f.promedio !== null && f.promedio < 6 ? 'cell-fail' : '';
        const pctText = f.horasTotal > 0
          ? `${f.pctInasistencia.toFixed(1)}%`
          : '—';
        const faltasHorasText = f.horasTotal > 0
          ? `${f.faltasTotal}/${f.horasTotal}`
          : `${f.faltasTotal}/—`;
        const inasistClass = (f.horasTotal > 0 && f.pctInasistencia > 20) ? 'cell-fail' : '';

        // Tags de causa (las 3 reglas SEP)
        const tagsCausa = [];
        if (f.reglas.includes('PROM_BAJO')) tagsCausa.push(`<span class="tag tag-prom" title="Promedio de los 3 parciales menor a 6">(1) Promedio &lt; 6</span>`);
        if (f.reglas.includes('DOS_REPROB')) tagsCausa.push(`<span class="tag tag-reprob" title="2 o más parciales reprobados (regla SEP)">(2) 2+ parciales reprob.</span>`);
        if (f.reglas.includes('INASIST')) tagsCausa.push(`<span class="tag tag-faltas" title="Inasistencias mayores al 20% de horas impartidas">(3) Inasist. &gt; 20%</span>`);

        const calCells = f.cals.map(c => {
          if (c == null) return `<td class="cal-cell cell-none">—</td>`;
          const cls = c < 6 ? 'cal-cell cell-fail' : 'cal-cell';
          return `<td class="${cls}">${c}</td>`;
        }).join('');

        if (isFirst) {
          // row-first-of-student → CSS aplica borde superior fuerte (1.5pt)
          // para delimitar visualmente donde inicia un nuevo alumno.
          bodyRows += `
            <tr class="${zebraClass} row-first-of-student">
              <td class="col-np" rowspan="${rowsSpan}">${first.np}</td>
              <td class="col-nombre" rowspan="${rowsSpan}">
                <div class="alumno-nombre">${Utils.sanitize(first.nombre)}</div>
                <div class="alumno-meta">${first.sexo === 'M' ? 'Mujer' : 'Hombre'} · ${rowsSpan} ${rowsSpan === 1 ? 'materia' : 'materias'}</div>
              </td>
              <td class="col-mat">${Utils.sanitize(f.materia)}</td>
              <td class="col-teacher">${Utils.sanitize(f.teacher || '—')}</td>
              ${calCells}
              <td class="col-prom ${promClass}">${promText}</td>
              <td class="col-faltas">${faltasHorasText}</td>
              <td class="col-pct ${inasistClass}">${pctText}</td>
              <td class="col-causa">${tagsCausa.join(' ')}</td>
            </tr>
          `;
        } else {
          bodyRows += `
            <tr class="${zebraClass}">
              <td class="col-mat">${Utils.sanitize(f.materia)}</td>
              <td class="col-teacher">${Utils.sanitize(f.teacher || '—')}</td>
              ${calCells}
              <td class="col-prom ${promClass}">${promText}</td>
              <td class="col-faltas">${faltasHorasText}</td>
              <td class="col-pct ${inasistClass}">${pctText}</td>
              <td class="col-causa">${tagsCausa.join(' ')}</td>
            </tr>
          `;
        }
      });
      zebraIdx++;
    }

    return `
      <div class="exr-document">
        <div class="exr-title">
          <h1>ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
          <p class="exr-subtitle">C.C.T. 15EBH0134D · TURNO ${Utils.sanitize(meta.turno)} · CICLO ESCOLAR ${Utils.sanitize(meta.cicloEscolar)}-2</p>
          <p class="exr-ctrl">REPORTE DE ALUMNOS EN EXTRAORDINARIO — GRUPO ${Utils.sanitize(meta.grupoLabel)}</p>
        </div>

        <div class="exr-meta">
          <div class="meta-row">
            <div><strong>Orientador(a):</strong> ${Utils.sanitize(meta.orientador || 'Sin asignar')}</div>
            <div><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
          </div>
          <div class="meta-row meta-stats">
            <span><strong>Alumnos activos:</strong> ${totalActivos}</span>
            <span><strong>En extraordinario:</strong> ${alumnosUnicos} (${pctIrreg}%)</span>
            <span><strong>Total casos (materias):</strong> ${totalMaterias}</span>
          </div>
          <div class="meta-row meta-causas">
            <strong>Reglas SEP activadas:</strong>
            <span class="tag tag-prom">(1) Promedio &lt; 6: ${causaCount.PROM_BAJO}</span>
            <span class="tag tag-reprob">(2) 2+ parciales reprob.: ${causaCount.DOS_REPROB}</span>
            <span class="tag tag-faltas">(3) Inasist. &gt; 20%: ${causaCount.INASIST}</span>
          </div>
        </div>

        <table class="exr-table">
          <thead>
            <tr>
              <th class="col-np" rowspan="2">#</th>
              <th class="col-nombre" rowspan="2">Alumno</th>
              <th class="col-mat" rowspan="2">Materia</th>
              <th class="col-teacher" rowspan="2">Maestro(a)</th>
              <th colspan="3" class="col-cals-header">Calificaciones</th>
              <th class="col-prom" rowspan="2">Promedio</th>
              <th class="col-faltas" rowspan="2">Faltas / Horas</th>
              <th class="col-pct" rowspan="2">% Inasist.</th>
              <th class="col-causa" rowspan="2">Causa(s) que activan EXTRA</th>
            </tr>
            <tr>
              <th class="cal-cell">P1</th>
              <th class="cal-cell">P2</th>
              <th class="cal-cell">P3</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>

        <div class="exr-leyenda">
          <div class="leyenda-title"><strong>REGLAMENTO APLICADO</strong> · Gaceta Oficial EPO 67 / SEP</div>
          <div class="leyenda-rule">
            <span class="rule-num">1</span>
            <div><strong>Promedio reprobatorio:</strong> Si el promedio de los 3 parciales es <strong>menor a 6</strong>, pasa a extraordinario. Las calificaciones por debajo de 6 <strong>NO se redondean al alza</strong> (ej. 5.99 sigue siendo reprobatorio).</div>
          </div>
          <div class="leyenda-rule">
            <span class="rule-num">2</span>
            <div><strong>Dos parciales reprobados:</strong> Si el alumno reprueba <strong>2 o más parciales</strong> (sin importar cuáles), pasa automáticamente a extraordinario <strong>sin importar el promedio</strong>.</div>
          </div>
          <div class="leyenda-rule">
            <span class="rule-num">3</span>
            <div><strong>Inasistencias &gt; 20%:</strong> Si las faltas acumuladas <strong>superan el 20%</strong> de las horas impartidas del semestre, pasa a extraordinario <strong>sin importar el promedio</strong>.</div>
          </div>
          <div class="leyenda-note">
            <strong>Importante:</strong> las 3 reglas son <strong>independientes</strong>. Basta con que se cumpla <strong>UNA</strong> para que el alumno vaya a extraordinario. Si cumple varias, todas se muestran en la columna "Causa(s)".
          </div>
        </div>

        <div class="exr-banner exr-banner-footer">
          <div class="exr-banner-left">${logoHeader ? `<img src="${logoHeader}">` : ''}</div>
          <div class="exr-banner-center">
            <div class="exr-year">"2026. Año del Humanismo Mexicano en el Estado de México"</div>
          </div>
          <div class="exr-banner-right">${logoEdomex ? `<img src="${logoEdomex}">` : ''}</div>
        </div>
      </div>
    `;
  }

  function _injectPrintStyles() {
    const existing = document.getElementById('exr-styles');
    if (existing) existing.remove();
    const css = `
      .exr-document {
        background:#fff;
        padding:8px 12px;
        font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;
        color:#1f2937;
      }
      .exr-banner { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
      .exr-banner img { height:38px; }
      .exr-banner-center { flex:1; text-align:center; padding:0 12px; }
      .exr-year { font-style:italic; font-size:9pt; font-weight:600; color:#000; }
      /* Bandin oficial movido al PIE del documento (junio 2026, por peticion de direccion) */
      .exr-banner-footer {
        margin-top:14px;
        padding-top:8px;
        border-top:0.5pt solid #cbd5e1;
      }
      .exr-title { text-align:center; margin:0 0 8px; }
      .exr-title h1 { font-size:13pt; font-weight:800; margin:0; color:#000; letter-spacing:0.3px; }
      .exr-subtitle { font-size:9pt; margin:2px 0; color:#374151; }
      .exr-ctrl { font-size:11pt; font-weight:700; margin:3px 0 0; color:#000; }

      /* ─── Bloque de meta + estadísticas ─── */
      .exr-meta {
        margin:8px 0 10px;
        padding:8px 12px;
        background:#f8fafc;
        border:0.5pt solid #cbd5e1;
        border-radius:4px;
        font-size:9pt;
        color:#1e293b;
      }
      .exr-meta .meta-row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:4px; }
      .exr-meta .meta-row:last-child { margin-bottom:0; }
      .exr-meta .meta-stats span { padding-right:18px; }
      .exr-meta .meta-causas { padding-top:4px; border-top:0.4pt dashed #cbd5e1; }
      .exr-meta .meta-causas .tag { margin-left:6px; }

      /* ─── Tags de regla SEP (3 tipos) ─── */
      .tag {
        display:inline-block;
        padding:2px 7px;
        border-radius:3px;
        font-size:7.5pt;
        font-weight:700;
        letter-spacing:0.2px;
        margin-right:4px;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .tag.tag-prom    { background:#dbeafe; color:#1e3a8a; border:0.4pt solid #93c5fd; }
      .tag.tag-reprob  { background:#fef3c7; color:#78350f; border:0.4pt solid #fcd34d; }
      .tag.tag-faltas  { background:#fee2e2; color:#7f1d1d; border:0.4pt solid #fca5a5; }

      /* ─── Tabla principal ─── */
      .exr-table {
        border-collapse:collapse;
        width:100%;
        font-size:8pt;
        table-layout:fixed;
        border:1pt solid #1e40af;
      }
      .exr-table th, .exr-table td {
        border:0.4pt solid #94a3b8;
        padding:4px 5px;
        vertical-align:middle;
        word-wrap:break-word;
        overflow-wrap:break-word;
      }
      .exr-table thead th {
        background:#1e40af;
        color:#fff;
        font-weight:700;
        text-align:center;
        font-size:7.5pt;
        line-height:1.15;
        padding:5px 3px;
        letter-spacing:0.1px;
        white-space:normal;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      /* Anchos optimizados (landscape carta = ~270mm utiles).
         Suma manual: 22+150+155+105+(28*3)+45+55+44+auto = ~660px de 1020px disponibles
         dejando ~360px para "Causa" — suficiente para 3 tags en linea. */
      .exr-table .col-np      { width:22px; text-align:center; font-weight:700; }
      .exr-table .col-nombre  { width:150px; text-align:left; padding:5px 7px; }
      .exr-table .col-mat     { width:155px; text-align:left; font-weight:500; }
      .exr-table .col-teacher { width:105px; text-align:left; font-size:7.5pt; color:#475569; font-style:italic; }
      .exr-table .col-cals-header { background:#1e40af; }
      .exr-table .cal-cell    { width:28px; text-align:center; font-weight:600; }
      .exr-table .col-prom    { width:45px; text-align:center; font-weight:700; }
      .exr-table .col-faltas  { width:55px; text-align:center; font-size:7.5pt; }
      .exr-table .col-pct     { width:44px; text-align:center; font-weight:600; }
      .exr-table .col-causa   { width:auto; padding:5px 6px; line-height:1.6; }
      .exr-table .alumno-nombre { font-weight:700; color:#000; line-height:1.2; }
      .exr-table .alumno-meta { font-size:7pt; color:#64748b; margin-top:2px; font-style:normal; font-weight:500; }
      .exr-table .cell-fail   { background:#fef2f2 !important; color:#b91c1c; font-weight:800; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .exr-table .cell-none   { color:#94a3b8; font-style:italic; }

      /* ═══ ZEBRA POR ALUMNO ═══
         row-zebra-a (alumnos 1, 3, 5...) → fondo BLANCO
         row-zebra-b (alumnos 2, 4, 6...) → fondo GRIS CLARO (#eef2f7)
         Todas las filas (materias) de un mismo alumno comparten el mismo color.
         La columna # y el nombre llevan un tono ligeramente mas marcado para
         enfatizar que ahi inicia un nuevo alumno. */
      .exr-table .row-zebra-a td { background:#ffffff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .exr-table .row-zebra-b td { background:#eef2f7; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .exr-table .row-zebra-a .col-np,
      .exr-table .row-zebra-a .col-nombre { background:#e2e8f0; }
      .exr-table .row-zebra-b .col-np,
      .exr-table .row-zebra-b .col-nombre { background:#cbd5e1; }
      /* Borde superior FUERTE en la primera fila de cada alumno (la del rowspan)
         para que se vea claramente donde termina un alumno y empieza otro. */
      .exr-table tbody tr.row-first-of-student td {
        border-top:1.5pt solid #1e293b !important;
      }
      /* cell-fail siempre toma precedencia visual */
      .exr-table .row-zebra-a .cell-fail,
      .exr-table .row-zebra-b .cell-fail { background:#fef2f2 !important; }

      /* ─── Leyenda con reglas detalladas ─── */
      .exr-leyenda {
        margin-top:10px;
        padding:10px 14px;
        background:#f8fafc;
        border:0.5pt solid #cbd5e1;
        border-radius:4px;
        font-size:8.5pt;
        color:#1e293b;
        line-height:1.5;
      }
      .leyenda-title {
        font-size:9pt;
        font-weight:700;
        color:#1e40af;
        text-align:center;
        padding-bottom:5px;
        margin-bottom:6px;
        border-bottom:0.5pt solid #cbd5e1;
      }
      .leyenda-rule {
        display:flex;
        align-items:flex-start;
        gap:10px;
        padding:4px 0;
      }
      .rule-num {
        flex-shrink:0;
        width:18px; height:18px;
        background:#1e40af;
        color:#fff;
        border-radius:50%;
        text-align:center;
        line-height:18px;
        font-size:8.5pt;
        font-weight:800;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .leyenda-note {
        margin-top:6px;
        padding:4px 8px;
        background:#fef3c7;
        border-left:2pt solid #d97706;
        font-size:8pt;
        font-style:italic;
        color:#78350f;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }

      @media print {
        body * { visibility:hidden; }
        .exr-document, .exr-document * { visibility:visible; }
        .exr-document {
          position:absolute;
          left:0; top:0;
          width:100%;
          padding:0;
        }
        .no-print { display:none !important; }
        /* Margenes de impresion profesionales:
           - top/bottom 10mm para que la tabla NUNCA quede tan cerca del borde
           - left/right 8mm para aprovechar landscape sin pegarse a los bordes */
        @page { size: letter landscape; margin:10mm 8mm; }
        .exr-table { page-break-inside:auto; }
        .exr-table thead { display:table-header-group; }
        .exr-table tr { page-break-inside:avoid; }
        .exr-leyenda { page-break-inside:avoid; }
        .exr-banner-footer { page-break-inside:avoid; page-break-before:avoid; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'exr-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  return { render };
})();

if (typeof Router !== 'undefined') {
  if (!Router.modules) Router.modules = {};
  Router.modules['extras-report'] = () => ExtrasReportModule.render();
}
