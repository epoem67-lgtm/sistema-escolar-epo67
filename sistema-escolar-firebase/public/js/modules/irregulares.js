/**
 * ═══════════════════════════════════════════════════════════════
 * Módulo IRREGULARES — Control de Irregulares de 2° semestre
 * ═══════════════════════════════════════════════════════════════
 * Genera el reporte oficial SEP de alumnos irregulares de un grupo.
 *
 * Identifica:
 *   - Alumnos con AL MENOS 1 materia en Extraordinario por:
 *     - Calificación (2+ parciales reprobados, ó 1 reprob + prom<6)
 *     - Faltas (>20% inasistencia con horas completas)
 *     - Ambas
 *
 * Cada materia se marca con:
 *   E.E.X.C  → Extra por Calificación
 *   E.E.X.F  → Extra por Faltas
 *   E.E.X.A  → Extra por Ambas
 *
 * Formato visual y diseño replican el PDF oficial entregado por
 * orientadores ("EXTRAS 3°2 SEG.pdf" de junio 2026).
 *
 * Roles que ven el módulo: admin, subdirector, directivo, orientador,
 * orientador_docente, auditor.
 *
 * Uso normal: orientador entra → elige grupo → genera → imprime.
 * El reporte se entrega a Dirección al cierre del ciclo escolar.
 * ═══════════════════════════════════════════════════════════════
 */
const IrregularesModule = (() => {
  let _state = {
    turno: '',
    grado: '',
    grupo: '',
    generated: null, // { meta, rows, totales }
  };

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;
    container.innerHTML = UI.loadingState('Cargando módulo Irregulares...');

    try {
      // Cargar datos básicos + scope del orientador.
      // getOrientadorGroups() retorna:
      //   - null → admin/subdirector/auditor (ven todos los grupos)
      //   - []   → no es orientador ni admin → sin acceso
      //   - [ids…] → orientador real, solo SUS grupos
      const [groups, teachers, oriGroupIds] = await Promise.all([
        Store.getGroups(),
        Store.getTeachers(),
        Store.getOrientadorGroups().catch(() => []),
      ]);

      _state.allTeachers = teachers;
      _state.orientadorScope = oriGroupIds; // null = global, array = restringido

      // Filtrar grupos visibles según rol
      if (Array.isArray(oriGroupIds)) {
        if (oriGroupIds.length === 0) {
          container.innerHTML = UI.errorState(
            'No tienes grupos asignados como orientador. Solo los orientadores con grupos pueden generar el reporte de Irregulares.'
          );
          return;
        }
        const oriSet = new Set(oriGroupIds);
        _state.allGroups = groups.filter(g => oriSet.has(g.id));
      } else {
        // Admin/subdirector/auditor: ven todos los grupos
        _state.allGroups = groups;
      }

      _renderUI(container);
    } catch (e) {
      console.error('[irregulares] error', e);
      container.innerHTML = UI.errorState('Error al cargar el módulo: ' + (e.message || ''));
    }
  }

  function _renderUI(container) {
    const role = App.currentUser?.role;
    const isRestricted = Array.isArray(_state.orientadorScope);
    // Turnos y grados visibles SOLO los que estén en sus grupos asignados
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
          <h1 class="module-title">Control de Irregulares ${scopeMsg}</h1>
          <p class="module-subtitle">Reporte oficial de alumnos en extraordinario por grupo · Formato SEP entregable a Dirección</p>
        </div>
      </div>

      <!-- Selector -->
      <div class="card no-print" style="padding:18px 20px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;align-items:end;">
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Turno</label>
            <select id="irr-turno" class="form-input" style="margin-top:4px;width:100%;">
              <option value="">Selecciona turno</option>${turnoOptions}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Grado</label>
            <select id="irr-grado" class="form-input" style="margin-top:4px;width:100%;">
              <option value="">Selecciona grado</option>${gradoOptions}
            </select>
          </div>
          <div>
            <label style="font-size:12px;color:#475569;font-weight:600;">Grupo</label>
            <select id="irr-grupo" class="form-input" style="margin-top:4px;width:100%;" disabled>
              <option value="">Selecciona turno y grado</option>
            </select>
          </div>
          <div>
            <button id="irr-generar" class="btn btn-primary" style="width:100%;padding:10px 16px;" disabled>
              <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">summarize</span>
              Generar reporte
            </button>
          </div>
        </div>
        <div style="margin-top:10px;padding:10px 14px;background:#fef3c7;border-left:3px solid #d97706;border-radius:4px;font-size:12px;color:#78350f;">
          <strong>Regla SEP:</strong> Un alumno es <strong>IRREGULAR</strong> si tiene al menos UNA materia con estatus
          <strong>Extraordinario</strong>. La materia entra a extra por: 2+ parciales reprobados (E.E.X.C),
          inasistencias mayores al 20% (E.E.X.F) o ambas (E.E.X.A).
        </div>
      </div>

      <!-- Acciones (solo visible cuando hay reporte generado) -->
      <div id="irr-actions" class="no-print" style="display:none;margin-bottom:12px;text-align:right;">
        <button id="irr-imprimir" class="btn btn-outline" style="padding:8px 14px;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">print</span>
          Imprimir / Guardar PDF
        </button>
        <button id="irr-excel" class="btn btn-primary" style="padding:8px 14px;margin-left:6px;">
          <span class="material-icons-round" style="font-size:18px;vertical-align:middle;margin-right:4px;">file_download</span>
          Descargar Excel
        </button>
      </div>

      <!-- Resultado -->
      <div id="irr-result"></div>
    `);

    _bindEvents();
  }

  function _bindEvents() {
    const elTurno = document.getElementById('irr-turno');
    const elGrado = document.getElementById('irr-grado');
    const elGrupo = document.getElementById('irr-grupo');
    const elGenerar = document.getElementById('irr-generar');

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
      const groupsFiltered = (_state.allGroups || [])
        .filter(gr => gr.turno === t && String(gr.grado) === String(g))
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      if (groupsFiltered.length === 0) {
        elGrupo.innerHTML = '<option value="">Sin grupos disponibles</option>';
        elGrupo.disabled = true;
        elGenerar.disabled = true;
        return;
      }
      elGrupo.innerHTML = '<option value="">Selecciona grupo</option>' +
        groupsFiltered.map(gr => `<option value="${gr.id}">${gr.nombre}</option>`).join('');
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

    document.getElementById('irr-imprimir')?.addEventListener('click', () => window.print());
    document.getElementById('irr-excel')?.addEventListener('click', _exportExcel);
  }

  async function _generate() {
    const resultsDiv = document.getElementById('irr-result');
    resultsDiv.innerHTML = UI.loadingState('Generando reporte...');

    try {
      const groupId = _state.grupo;
      const groupDoc = (_state.allGroups || []).find(g => g.id === groupId);
      if (!groupDoc) throw new Error('Grupo no encontrado');

      // BLINDAJE: si el rol es orientador (no admin), verificar que el groupId
      // esté en su scope. Defensivo: nunca debería pasar porque el dropdown
      // ya filtra, pero alguien podría manipular el DOM.
      if (Array.isArray(_state.orientadorScope)) {
        const oriSet = new Set(_state.orientadorScope);
        if (!oriSet.has(groupId)) {
          throw new Error('No tienes permiso para consultar este grupo. Solo puedes ver tus grupos asignados como orientador.');
        }
      }

      // Cargar TODO lo necesario
      const [allStudents, allGrades, allSubjects, allAssignments, hoursAll] = await Promise.all([
        Store.getStudentsByGroup(groupId),
        Store.getGradesByGroup(groupId, true),
        Store.getSubjects(),
        Store.getAssignments(),
        _loadGroupHours(groupId),
      ]);

      const passGrade = (K.THRESHOLDS && K.THRESHOLDS.PASS_GRADE) || 6;

      // Alumnos activos del grupo, ordenados alfabéticamente
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

      const inscripcionInicial = allStudents.length;
      const bajas = allStudents.filter(s => {
        const e = (s.estatus || '').toString().toUpperCase().trim();
        return e === 'BAJA' || s.bajaPendiente;
      }).length;
      const altas = allStudents.filter(s => s.altaPendiente || s.alta === true).length;
      const existenciaFinal = groupStudents.length;

      // Materias del grado, ordenadas SEP
      const subsRaw = allSubjects.filter(s => String(s.grado) === String(groupDoc.grado));
      const subjects = (typeof K.sortSubjectsByGrado === 'function')
        ? K.sortSubjectsByGrado(subsRaw, groupDoc.grado)
        : subsRaw;

      // Resolver maestro por materia (asignaciones del grupo)
      // Helper inline: nombre corto del docente = solo primer nombre
      // ej. "GOMEZ GUZMAN MICHAEL" → "Michael"
      const _firstName = (nombre) => {
        if (!nombre) return '';
        const display = Utils.displayName(nombre); // "NOMBRES APELLIDOS"
        const firstTok = display.split(' ')[0] || '';
        return firstTok.charAt(0).toUpperCase() + firstTok.slice(1).toLowerCase();
      };
      const teacherByAsg = {};
      const assignmentsOfGroup = allAssignments.filter(a => a.groupId === groupId);
      for (const a of assignmentsOfGroup) {
        const tDoc = (_state.allTeachers || []).find(t => t.id === a.teacherId);
        teacherByAsg[a.subjectId] = tDoc ? _firstName(tDoc.nombre || '') : '';
      }

      // Index hours por subjectId (1 doc por materia: SEMESTRE > P3 > P2 > P1)
      const hoursBySubject = {};
      for (const h of hoursAll) {
        if (!h.subjectId) continue;
        if (!hoursBySubject[h.subjectId]) hoursBySubject[h.subjectId] = {};
        if (h.partial) hoursBySubject[h.subjectId][h.partial] = h;
      }

      // Construir filas: solo alumnos IRREGULARES (al menos 1 materia EXTRA)
      const rows = [];
      const reprobByCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }; // reprobados en X UAC
      let sumAvg = 0, cntAvg = 0;
      const reprobBySex = {
        H: { ins: 0, bajas: 0, altas: 0, final: 0, aprob: 0, r1: 0, r2: 0, r3: 0, r4: 0 },
        M: { ins: 0, bajas: 0, altas: 0, final: 0, aprob: 0, r1: 0, r2: 0, r3: 0, r4: 0 },
      };

      for (const stu of allStudents) {
        const sex = (stu.sexo || '').toUpperCase() === 'M' ? 'M' : 'H';
        const isActive = (() => {
          const e = (stu.estatus || '').toString().toUpperCase().trim();
          return e === '' || e === 'ACTIVO';
        })();
        if (!isActive) continue;

        reprobBySex[sex].ins++;
        reprobBySex[sex].final++;

        // Para cada materia, calcular status del alumno
        const subjectsExtraMark = {}; // subjectId -> 'C' | 'F' | 'A' | null
        let materiasEnExtra = 0;
        for (const subj of subjects) {
          const sGrades = {};
          for (const p of ['P1', 'P2', 'P3']) {
            const g = allGrades.find(gg => gg.studentId === stu.id && gg.subjectId === subj.id && gg.partial === p);
            if (g) sGrades[p] = g;
          }
          const grades3 = [sGrades.P1 || null, sGrades.P2 || null, sGrades.P3 || null];
          const hoursByPart = hoursBySubject[subj.id] || {};
          const status = App.calcStatusExtraordinario({ grades3, hoursByPart, passGrade });
          if (status.isExtra) {
            materiasEnExtra++;
            if (status.estatus === 'EXTRA_AMBAS') subjectsExtraMark[subj.id] = 'A';
            else if (status.estatus === 'EXTRA_FALTAS') subjectsExtraMark[subj.id] = 'F';
            else subjectsExtraMark[subj.id] = 'C';
          }
        }

        // Conteo de reprobados por categoría
        if (materiasEnExtra === 0) {
          reprobBySex[sex].aprob++;
          reprobByCount[0]++;
        } else if (materiasEnExtra === 1) {
          reprobBySex[sex].r1++;
          reprobByCount[1]++;
        } else if (materiasEnExtra === 2) {
          reprobBySex[sex].r2++;
          reprobByCount[2]++;
        } else if (materiasEnExtra === 3) {
          reprobBySex[sex].r3++;
          reprobByCount[3]++;
        } else {
          reprobBySex[sex].r4++;
          reprobByCount[4]++;
        }

        // Promedio general del alumno (todas las cals de los 3 parciales)
        const allCals = [];
        for (const subj of subjects) {
          for (const p of ['P1', 'P2', 'P3']) {
            const g = allGrades.find(gg => gg.studentId === stu.id && gg.subjectId === subj.id && gg.partial === p);
            if (g && g.cal != null) {
              const c = Number(g.cal);
              if (!isNaN(c)) allCals.push(c);
            }
          }
        }
        const promedio = allCals.length > 0 ? allCals.reduce((s, c) => s + c, 0) / allCals.length : null;
        if (promedio !== null) { sumAvg += promedio; cntAvg++; }

        // Si tiene al menos 1 materia en extra → es IRREGULAR
        if (materiasEnExtra > 0) {
          rows.push({
            student: stu,
            sex,
            totalUAC: materiasEnExtra,
            subjectsExtraMark,
          });
        }
      }

      const promedioGeneral = cntAvg > 0 ? (sumAvg / cntAvg) : 0;

      // Construir meta
      const orientador = K.getOrientador(_state.turno, groupDoc.nombre || groupDoc.grupo || '') || '';
      const cicloEscolar = (App.schoolConfig && App.schoolConfig.cicloEscolar) || '2025-2026';
      const grupoLabel = `${groupDoc.grado}°${(groupDoc.nombre || '').split('-')[1] || groupDoc.nombre || ''}`;

      _state.generated = {
        meta: { groupDoc, grupoLabel, turno: _state.turno, cicloEscolar, orientador },
        subjects,
        teacherByAsg,
        rows,
        totales: {
          inscripcionInicial,
          bajas,
          altas,
          existenciaFinal,
          reprobBySex,
          promedioGeneral,
        },
      };

      _renderReport();
    } catch (e) {
      console.error('[irregulares] generate error', e);
      resultsDiv.innerHTML = UI.errorState('Error al generar: ' + (e.message || ''));
    }
  }

  async function _loadGroupHours(groupId) {
    try {
      const snap = await db.collection('teacherHours').where('groupId', '==', groupId).get();
      const out = [];
      snap.forEach(doc => out.push({ id: doc.id, ...doc.data() }));
      return out;
    } catch (e) {
      console.warn('[irregulares] No se pudieron cargar teacherHours:', e.message);
      return [];
    }
  }

  function _renderReport() {
    const resultsDiv = document.getElementById('irr-result');
    const { meta, subjects, teacherByAsg, rows, totales } = _state.generated;

    if (rows.length === 0) {
      resultsDiv.innerHTML = `
        <div class="card" style="padding:40px;text-align:center;">
          <span class="material-icons-round" style="font-size:48px;color:#16a34a;">check_circle</span>
          <h3 style="margin:12px 0 6px;color:#166534;">¡Grupo SIN irregulares!</h3>
          <p style="color:#475569;">Ningún alumno activo del grupo ${Utils.sanitize(meta.grupoLabel)} tiene materias en extraordinario.</p>
        </div>
      `;
      document.getElementById('irr-actions').style.display = 'none';
      return;
    }

    document.getElementById('irr-actions').style.display = 'block';
    resultsDiv.innerHTML = _buildReportHTML();
    _injectPrintStyles();
  }

  function _buildReportHTML() {
    const { meta, subjects, teacherByAsg, rows, totales } = _state.generated;

    const logoHeader = (typeof LOGO_HEADER_SRC !== 'undefined' && LOGO_HEADER_SRC) ? LOGO_HEADER_SRC : '';
    const logoEdomex = (typeof LOGO_FOOTER_SRC !== 'undefined' && LOGO_FOOTER_SRC) ? LOGO_FOOTER_SRC : '';

    // Columnas por materia: 3 oportunidades (1, 2, 3) cada una
    const headerMaterias = subjects.map(s => {
      const teacher = teacherByAsg[s.id] || '';
      const teacherLine = teacher ? `<div class="teacher-name">(${Utils.sanitize(teacher)})</div>` : '';
      return `<th class="mat-h" colspan="3">
        <div class="subject-name">${Utils.sanitize(K.getUACNombre(s.nombre || s.id))}</div>
        ${teacherLine}
      </th>`;
    }).join('');

    const headerOportunidades = subjects.map(() =>
      `<th class="op">1</th><th class="op">2</th><th class="op">3</th>`
    ).join('');

    // Helper Title Case: "KALEB CASTILLO HERNANDEZ" → "Kaleb Castillo Hernandez"
    const toTitleCase = (s) => (s || '').toLowerCase().replace(/\b([a-záéíóúñ])/g, c => c.toUpperCase());

    // Filas de alumnos (cada alumno ocupa 2 filas: # con E.E.X.* en 1ª, H/M en 2ª vacía)
    let rowsHtml = '';
    rows.forEach((r, idx) => {
      const numero = idx + 1;
      const nombre = toTitleCase(Utils.displayName(r.student.nombreCompleto || `${r.student.apellido1 || ''} ${r.student.apellido2 || ''} ${r.student.nombres || ''}`));
      const cellsRow1 = subjects.map(s => {
        const mark = r.subjectsExtraMark[s.id];
        if (!mark) return '<td class="mat-c"></td><td class="mat-c"></td><td class="mat-c"></td>';
        // mark = 'C' | 'F' | 'A'
        const label = mark === 'A' ? 'E.E.X.A' : mark === 'F' ? 'E.E.X.F' : 'E.E.X.C';
        return `<td class="mat-c extra-cell">${label}</td><td class="mat-c"></td><td class="mat-c"></td>`;
      }).join('');
      // Segunda fila: H/M en posición de la primera oportunidad (visual igual al PDF)
      // y 2 celdas vacías por cada materia (ops 2 y 3)
      const cellsRow2 = subjects.map(() =>
        '<td class="mat-c"></td><td class="mat-c"></td><td class="mat-c"></td>'
      ).join('');

      rowsHtml += `
        <tr class="alumno-row-top">
          <td class="nl">${numero}</td>
          <td class="nombre" rowspan="2">${Utils.sanitize(nombre)}</td>
          <td class="uac-total" rowspan="2">${r.totalUAC}</td>
          ${cellsRow1}
        </tr>
        <tr class="alumno-row-bot">
          <td class="sex">${r.sex}</td>
          ${cellsRow2}
        </tr>
      `;
    });

    // Datos generales del grupo
    const t = totales;
    const totalH = t.reprobBySex.H;
    const totalM = t.reprobBySex.M;
    const total = {
      ins: totalH.ins + totalM.ins,
      bajas: totalH.bajas + totalM.bajas,
      altas: totalH.altas + totalM.altas,
      final: totalH.final + totalM.final,
      aprob: totalH.aprob + totalM.aprob,
      r1: totalH.r1 + totalM.r1,
      r2: totalH.r2 + totalM.r2,
      r3: totalH.r3 + totalM.r3,
      r4: totalH.r4 + totalM.r4,
    };

    return `
      <div class="irr-document">
        <!-- Encabezado oficial -->
        <div class="irr-banner">
          <div class="irr-banner-left">
            ${logoHeader ? `<img src="${logoHeader}" class="logo-gobierno">` : ''}
          </div>
          <div class="irr-banner-center">
            <div class="irr-year">"2026. Año del Humanismo Mexicano en el Estado de México"</div>
          </div>
          <div class="irr-banner-right">
            ${logoEdomex ? `<img src="${logoEdomex}" class="logo-edomex">` : ''}
          </div>
        </div>

        <div class="irr-title">
          <h1>ESCUELA PREPARATORIA OFICIAL NÚM. 67</h1>
          <p class="irr-subtitle">C.C.T. 15EBH0134D, TURNO ${meta.turno}. CICLO ESCOLAR ${meta.cicloEscolar}-2</p>
          <p class="irr-ctrl">CONTROL DE IRREGULARES DE 2do SEMESTRE DEL CICLO ESCOLAR</p>
        </div>

        <!-- Tabla principal -->
        <div class="irr-op-caption">OPORTUNIDADES DE REGULARIZACIÓN</div>
        <table class="irr-table">
          <thead>
            <tr>
              <th class="grp-header" colspan="2" rowspan="2">
                <div class="grp-num">GRUPO ${Utils.sanitize(meta.grupoLabel)}</div>
                <div class="grp-orient">${Utils.sanitize(meta.orientador || 'Sin orientador asignado')}</div>
              </th>
              <th class="uac-h" rowspan="2">TOTAL DE UAC</th>
              ${headerMaterias}
            </tr>
            <tr>${headerOportunidades}</tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <!-- Datos generales del grupo -->
        <div class="irr-generales">
          <h2>DATOS GENERALES DEL GRUPO</h2>
          <table class="irr-gen-table">
            <thead>
              <tr>
                <th></th>
                <th>Inscripción inicial</th>
                <th>Bajas</th>
                <th>Altas</th>
                <th>Existencia Final</th>
                <th>Aprobados en todas las UAC</th>
                <th>Reprobados en 1 UAC</th>
                <th>Reprobados en 2 UAC</th>
                <th>Reprobados en 3 UAC</th>
                <th>Reprobados en 4 UAC o más UAC</th>
                <th>Promedio general</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="sex-label">Hombres</td>
                <td>${totalH.ins}</td>
                <td>${totalH.bajas}</td>
                <td>${totalH.altas}</td>
                <td>${totalH.final}</td>
                <td>${totalH.aprob}</td>
                <td>${totalH.r1}</td>
                <td>${totalH.r2}</td>
                <td>${totalH.r3}</td>
                <td>${totalH.r4}</td>
                <td rowspan="3" class="promedio-gen">${(Math.floor(t.promedioGeneral * 10) / 10).toFixed(1)}</td>
              </tr>
              <tr>
                <td class="sex-label">Mujeres</td>
                <td>${totalM.ins}</td>
                <td>${totalM.bajas}</td>
                <td>${totalM.altas}</td>
                <td>${totalM.final}</td>
                <td>${totalM.aprob}</td>
                <td>${totalM.r1}</td>
                <td>${totalM.r2}</td>
                <td>${totalM.r3}</td>
                <td>${totalM.r4}</td>
              </tr>
              <tr class="row-total">
                <td class="sex-label">Total</td>
                <td>${total.ins}</td>
                <td>${total.bajas}</td>
                <td>${total.altas}</td>
                <td>${total.final}</td>
                <td>${total.aprob}</td>
                <td>${total.r1}</td>
                <td>${total.r2}</td>
                <td>${total.r3}</td>
                <td>${total.r4}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Leyenda -->
        <div class="irr-leyenda">
          <strong>Leyenda:</strong>
          <span><strong>E.E.X.C</strong> = Examen Extraordinario por Calificación</span> ·
          <span><strong>E.E.X.F</strong> = Examen Extraordinario por Faltas</span> ·
          <span><strong>E.E.X.A</strong> = Examen Extraordinario por Ambas</span>
        </div>
      </div>
    `;
  }

  function _injectPrintStyles() {
    // Re-inyectar siempre que se llame para que se actualice tras cambios.
    const existing = document.getElementById('irr-styles');
    if (existing) existing.remove();

    // Estilos basados en el PDF oficial "EXTRAS 3°2 SEG.pdf":
    // - Bordes y encabezados azules (#1e40af)
    // - Sombreado azul claro (#e0e8f4) en celdas de cabecera
    // - Celdas EXTRA con fondo rojo claro (#fde0e0) y texto rojo
    // - Promedio en amarillo claro
    // - Fuente Inter para legibilidad
    const css = `
      .irr-document {
        background:#fff;
        padding:8px 10px;
        font-family:'Inter','Helvetica Neue',Helvetica,Arial,sans-serif;
        color:#000;
        max-width:100%;
        overflow:auto;
      }
      /* ─── Banner oficial: logos a los lados con ancho fijo, año al centro real ─── */
      .irr-banner {
        display:flex;
        align-items:center;
        margin-bottom:6px;
        padding:4px 6px 6px;
        border-bottom:1.5pt solid #1e40af;
        gap:10px;
      }
      .irr-banner-left, .irr-banner-right {
        flex:0 0 130px;
        display:flex;
        align-items:center;
      }
      .irr-banner-right { justify-content:flex-end; }
      .irr-banner img {
        height:42px;
        width:auto;
        max-width:100%;
        object-fit:contain;
      }
      .irr-banner-center {
        flex:1;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:0 6px;
        text-align:center;
      }
      .irr-year {
        font-style:italic;
        font-size:9.5pt;
        font-weight:600;
        color:#000;
        line-height:1.3;
      }
      /* ─── Bloque oficial: ESCUELA, CCT, CONTROL ─── */
      .irr-title {
        text-align:center;
        margin:4px 0 8px;
        padding:4px 0 6px;
        border-bottom:0.6pt solid #1e40af;
      }
      .irr-title h1 {
        font-size:14pt;
        font-weight:800;
        margin:0;
        letter-spacing:0.4px;
        color:#000;
        line-height:1.2;
      }
      .irr-subtitle {
        font-size:8.5pt;
        margin:3px 0 2px;
        color:#000;
        letter-spacing:0.2px;
      }
      .irr-ctrl {
        font-size:10.5pt;
        font-weight:700;
        margin:3px 0 0;
        color:#000;
        text-transform:uppercase;
        letter-spacing:0.3px;
      }

      /* ─── Caption arriba de la tabla principal ─── */
      .irr-op-caption {
        text-align:center;
        font-size:8.5pt;
        font-weight:700;
        color:#1e40af;
        margin:2px 0 3px;
        text-transform:uppercase;
        letter-spacing:0.6px;
      }
      /* ─── Tabla principal ─── */
      .irr-table {
        border-collapse:collapse;
        width:100%;
        font-size:6.5pt;
        table-layout:fixed;
      }
      .irr-table th, .irr-table td {
        border:0.5pt solid #1e40af;
        padding:1px 2px;
        text-align:center;
        vertical-align:middle;
        line-height:1.05;
        color:#1e3a8a;
      }
      .irr-table .grp-header {
        background:#fff;
        text-align:center;
        padding:6px 4px;
        width:130px;
        color:#000;
        vertical-align:middle;
      }
      .irr-table .grp-header .grp-num {
        font-size:15pt;
        font-weight:800;
        color:#000;
        line-height:1;
        letter-spacing:0.3px;
      }
      .irr-table .grp-header .grp-orient {
        font-size:6.5pt;
        font-weight:600;
        margin-top:5px;
        color:#374151;
        font-style:italic;
        line-height:1.25;
        padding:0 2px;
      }
      .irr-table .uac-h {
        background:#e0e8f4;
        color:#1e40af;
        font-weight:700;
        writing-mode:vertical-rl;
        transform:rotate(180deg);
        padding:2px 3px;
        font-size:6.5pt;
        width:18px;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-table .mat-h {
        background:#e0e8f4;
        color:#1e40af;
        font-weight:700;
        font-size:6.5pt;
        padding:2px 1px;
        line-height:1.1;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-table .mat-h .subject-name { font-weight:700; }
      .irr-table .mat-h .teacher-name { font-weight:400; font-size:5.5pt; margin-top:1px; color:#1e40af; font-style:italic; }
      .irr-table .op {
        background:#e0e8f4;
        color:#1e40af;
        font-weight:700;
        font-size:6.5pt;
        width:11px;
        padding:1px;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-table .op-label {
        background:#e0e8f4;
        color:#1e40af;
        font-weight:700;
        text-align:center;
        padding:2px 4px;
        font-size:6.5pt;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-table tbody td { background:#fff; height:14px; }
      .irr-table .nl { width:14px; font-weight:700; background:#fff; color:#000; }
      .irr-table .nombre {
        text-align:left;
        padding-left:4px;
        font-weight:500;
        font-size:7.5pt;
        width:120px;
        color:#000;
      }
      .irr-table .uac-total {
        font-weight:700;
        background:#fff;
        font-size:9pt;
        color:#000;
      }
      .irr-table .mat-c { width:11px; height:14px; padding:0; }
      .irr-table .sex { background:#fff; font-weight:700; font-size:6.5pt; color:#000; }
      .irr-table .extra-cell {
        background:#fde0e0 !important;
        color:#991b1b;
        font-weight:700;
        font-size:5.5pt;
        letter-spacing:-0.3px;
        padding:0;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .alumno-row-top td { border-bottom:none; }
      .alumno-row-bot td { border-top:none; }

      /* ─── Datos generales del grupo ─── */
      .irr-generales { margin-top:8px; }
      .irr-generales h2 {
        text-align:center;
        font-size:10.5pt;
        font-weight:700;
        margin:0 0 5px;
        color:#000;
        text-transform:uppercase;
        letter-spacing:0.5px;
      }
      .irr-gen-table {
        border-collapse:collapse;
        width:100%;
        font-size:8pt;
        table-layout:fixed;
      }
      .irr-gen-table th, .irr-gen-table td {
        border:0.5pt solid #1e40af;
        padding:4px 3px;
        text-align:center;
        vertical-align:middle;
        line-height:1.2;
        color:#1e3a8a;
        font-variant-numeric:tabular-nums;
      }
      .irr-gen-table thead th {
        background:#e0e8f4;
        font-weight:700;
        font-size:7.5pt;
        color:#1e40af;
        padding:6px 3px;
        line-height:1.25;
        word-wrap:break-word;
        hyphens:auto;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-gen-table .sex-label {
        background:#fff;
        font-weight:700;
        text-align:center;
        padding:6px 8px;
        font-size:9pt;
        color:#000;
        letter-spacing:0.3px;
      }
      .irr-gen-table tbody td {
        background:#fff;
        color:#000;
        font-size:9.5pt;
        font-weight:600;
      }
      .irr-gen-table .row-total td {
        background:#f8fafc;
        font-weight:800;
        font-size:10pt;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }
      .irr-gen-table .row-total .sex-label {
        background:#f8fafc;
      }
      .irr-gen-table .promedio-gen {
        background:#fff4c2 !important;
        font-weight:800;
        font-size:18pt;
        color:#000;
        vertical-align:middle;
        text-align:center;
        -webkit-print-color-adjust:exact; print-color-adjust:exact;
      }

      /* ─── Leyenda ─── */
      .irr-leyenda {
        margin-top:7px;
        padding:5px 10px;
        background:#f8fafc;
        border-left:3pt solid #1e40af;
        border-radius:0 3px 3px 0;
        font-size:7.5pt;
        color:#000;
        line-height:1.5;
        display:flex;
        flex-wrap:wrap;
        gap:8px 14px;
        align-items:center;
      }
      .irr-leyenda strong { color:#1e40af; }
      .irr-leyenda > strong:first-child {
        font-size:8pt;
        color:#000;
        text-transform:uppercase;
        letter-spacing:0.5px;
      }
      .irr-leyenda span {
        margin-right:0;
        white-space:nowrap;
      }

      /* ─── Impresión: cabe en 1 página Letter landscape ─── */
      @media print {
        body * { visibility:hidden; }
        .irr-document, .irr-document * { visibility:visible; }
        .irr-document {
          position:absolute;
          left:0; top:0;
          width:100%;
          padding:3mm 5mm;
        }
        .no-print { display:none !important; }
        @page { size: letter landscape; margin:3mm; }
        .irr-table, .irr-gen-table { page-break-inside:avoid; }
        .irr-table tbody tr { page-break-inside:avoid; }
        .irr-document { page-break-after:avoid; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'irr-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function _exportExcel() {
    if (!_state.generated) return;
    Toast.show('Cargando librería de Excel...', 'info');
    try {
      await Lib.exceljs();
      if (typeof window.ExcelJS === 'undefined') {
        Toast.show('No se pudo cargar la librería de Excel', 'error');
        return;
      }
      const { meta, subjects, teacherByAsg, rows, totales } = _state.generated;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EPO 67';
      const ws = wb.addWorksheet('Irregulares', {
        pageSetup: { paperSize: 1, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });

      // Encabezado
      ws.mergeCells(1, 1, 1, 3 + subjects.length * 3);
      ws.getCell(1, 1).value = `ESCUELA PREPARATORIA OFICIAL NÚM. 67`;
      ws.getCell(1, 1).font = { size: 14, bold: true };
      ws.getCell(1, 1).alignment = { horizontal: 'center' };

      ws.mergeCells(2, 1, 2, 3 + subjects.length * 3);
      ws.getCell(2, 1).value = `CONTROL DE IRREGULARES — ${meta.grupoLabel} · TURNO ${meta.turno} · CICLO ${meta.cicloEscolar}`;
      ws.getCell(2, 1).font = { size: 11, bold: true };
      ws.getCell(2, 1).alignment = { horizontal: 'center' };

      // Headers de tabla
      const headerRow = ['#', 'Nombre', 'Total UAC'];
      subjects.forEach(s => {
        const name = K.getUACNombre(s.nombre || s.id);
        const teacher = teacherByAsg[s.id] ? ` (${teacherByAsg[s.id]})` : '';
        headerRow.push(`${name}${teacher} - 1ª`, '2ª', '3ª');
      });
      ws.addRow([]);
      ws.addRow(headerRow);
      const r = ws.lastRow.number;
      ws.getRow(r).font = { bold: true, size: 9 };
      ws.getRow(r).alignment = { horizontal: 'center', wrapText: true };
      ws.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

      // Filas de alumnos
      rows.forEach((row, idx) => {
        const nombre = Utils.displayName(row.student.nombreCompleto || `${row.student.apellido1 || ''} ${row.student.apellido2 || ''} ${row.student.nombres || ''}`);
        const dataRow = [idx + 1, nombre, row.totalUAC];
        subjects.forEach(s => {
          const mark = row.subjectsExtraMark[s.id];
          const label = mark === 'A' ? 'E.E.X.A' : mark === 'F' ? 'E.E.X.F' : mark === 'C' ? 'E.E.X.C' : '';
          dataRow.push(label, '', '');
        });
        const addedRow = ws.addRow(dataRow);
        addedRow.font = { size: 9 };
        addedRow.alignment = { horizontal: 'center' };
        addedRow.getCell(2).alignment = { horizontal: 'left' };
        // Pintar celdas con E.E.X.* en rojo
        for (let c = 4; c <= dataRow.length; c++) {
          const v = addedRow.getCell(c).value;
          if (v && String(v).startsWith('E.E.X')) {
            addedRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            addedRow.getCell(c).font = { size: 8, bold: true, color: { argb: 'FF991B1B' } };
          }
        }
      });

      // Datos generales (debajo)
      ws.addRow([]);
      ws.addRow(['DATOS GENERALES DEL GRUPO']);
      const titleRow = ws.lastRow.number;
      ws.mergeCells(titleRow, 1, titleRow, 11);
      ws.getCell(titleRow, 1).font = { bold: true, size: 12 };
      ws.getCell(titleRow, 1).alignment = { horizontal: 'center' };

      ws.addRow(['', 'Inscripción inicial', 'Bajas', 'Altas', 'Existencia Final', 'Aprobados todas UAC',
                 'Reprob 1 UAC', 'Reprob 2 UAC', 'Reprob 3 UAC', 'Reprob 4+ UAC', 'Promedio general']);
      ws.getRow(ws.lastRow.number).font = { bold: true, size: 9 };
      const tH = totales.reprobBySex.H, tM = totales.reprobBySex.M;
      const totals = {
        ins: tH.ins + tM.ins, bajas: tH.bajas + tM.bajas, altas: tH.altas + tM.altas, final: tH.final + tM.final,
        aprob: tH.aprob + tM.aprob, r1: tH.r1 + tM.r1, r2: tH.r2 + tM.r2, r3: tH.r3 + tM.r3, r4: tH.r4 + tM.r4,
      };
      ws.addRow(['Hombres', tH.ins, tH.bajas, tH.altas, tH.final, tH.aprob, tH.r1, tH.r2, tH.r3, tH.r4, totales.promedioGeneral.toFixed(1)]);
      ws.addRow(['Mujeres', tM.ins, tM.bajas, tM.altas, tM.final, tM.aprob, tM.r1, tM.r2, tM.r3, tM.r4, '']);
      ws.addRow(['Total', totals.ins, totals.bajas, totals.altas, totals.final, totals.aprob, totals.r1, totals.r2, totals.r3, totals.r4, '']);

      // Anchos
      ws.getColumn(1).width = 5;
      ws.getColumn(2).width = 32;
      ws.getColumn(3).width = 10;
      for (let c = 4; c <= 3 + subjects.length * 3; c++) ws.getColumn(c).width = 8;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Irregulares_${meta.grupoLabel}_${meta.turno}_${meta.cicloEscolar}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.show('Excel descargado', 'success');
    } catch (e) {
      console.error('[irregulares] excel error', e);
      Toast.show('Error generando Excel: ' + (e.message || ''), 'error');
    }
  }

  return { render };
})();

if (typeof Router !== 'undefined') {
  if (!Router.modules) Router.modules = {};
  Router.modules['irregulares'] = () => IrregularesModule.render();
}
