/**
 * SCHOOL CONFIGURATION MODULE
 * Manages global school settings: name, year, shifts, grades, groups, goals
 */

const SchoolConfig = (() => {
  let config = null;

  function getDefaultConfig() {
    return {
      nombre: 'Escuela Preparatoria Oficial No. 67',
      nombreCorto: 'EPO 67',
      cicloEscolar: '2025-2026',
      semestre: 'SEGUNDO SEMESTRE',
      turnos: K.TURNOS,
      grados: K.GRADOS,
      gruposMatutino: ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3'],
      gruposVespertino: ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3'],
      parciales: K.PARCIALES.map(p => p.numero),
      metas: {
        promedio_minimo: 8.3,
        asistencia_minima: 80,
        reprobacion_maxima: 14
      },
      orientadores: {},
      updatedAt: DB.timestamp()
    };
  }

  async function render() {
    const container = document.getElementById('moduleContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="module-container">
        <div class="module-header">
          <div class="module-header-text">
            <h1 class="module-title">
              <span class="material-icons-round" style="vertical-align:middle;margin-right:8px;color:var(--color-primary)">settings</span>
              Configuraci\u00f3n Escolar
            </h1>
            <p class="module-subtitle">Gestiona la configuraci\u00f3n global de la escuela</p>
          </div>
        </div>
        <div class="loading-state" id="sc-loading">
          <span class="material-icons-round loading-spinner">autorenew</span>
          <p>Cargando configuraci\u00f3n...</p>
        </div>
        <div id="sc-content"></div>
      </div>
    `;

    await loadConfig();
  }

  async function loadConfig() {
    try {
      const snap = await DB.doc('config', 'school').get();
      config = snap.exists ? snap.data() : getDefaultConfig();
      renderContent();
    } catch (e) {
      console.error('Error cargando configuraci\u00f3n:', e);
      Toast.show('Error al cargar configuraci\u00f3n: ' + e.message, 'error');
    }
  }

  function renderContent() {
    const contentEl = document.getElementById('sc-content');
    const loadingEl = document.getElementById('sc-loading');

    contentEl.innerHTML = renderDashboard() + renderSections() + renderButtons();
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    bindEvents();
  }

  function renderDashboard() {
    return `
      <div class="stats-grid mb-lg">
        <div class="stat-card--bordered">
          <div class="stat-label">Escuela</div>
          <div class="stat-number" style="font-size:var(--font-size-lg)">${Utils.sanitize(config.nombreCorto || 'N/A')}</div>
        </div>
        <div class="stat-card--bordered success">
          <div class="stat-label">Ciclo Escolar</div>
          <div class="stat-number" style="font-size:var(--font-size-lg)">${Utils.sanitize(config.cicloEscolar || 'N/A')}</div>
        </div>
        <div class="stat-card--bordered warning">
          <div class="stat-label">Grupos (Matutino)</div>
          <div class="stat-number">${(config.gruposMatutino || []).length}</div>
        </div>
        <div class="stat-card--bordered">
          <div class="stat-label">Grupos (Vespertino)</div>
          <div class="stat-number">${(config.gruposVespertino || []).length}</div>
        </div>
        <div class="stat-card--bordered danger">
          <div class="stat-label">Grados</div>
          <div class="stat-number">${(config.grados || []).length}</div>
        </div>
        <div class="stat-card--bordered">
          <div class="stat-label">Promedio M\u00ednimo</div>
          <div class="stat-number">${config.metas?.promedio_minimo || 'N/A'}</div>
        </div>
      </div>
    `;
  }

  function renderSections() {
    return `
      <div class="config-section">
        <div class="config-section-header">
          <h3>Informaci\u00f3n B\u00e1sica</h3>
        </div>
        <div class="config-section-body">
          <div class="config-grid">
            <div class="form-group">
              <label for="sc-nombre">Nombre Completo</label>
              <input id="sc-nombre" type="text" value="${Utils.sanitize(config.nombre || '')}">
            </div>
            <div class="form-group">
              <label for="sc-nombreCorto">Nombre Corto</label>
              <input id="sc-nombreCorto" type="text" value="${Utils.sanitize(config.nombreCorto || '')}">
            </div>
            <div class="form-group">
              <label for="sc-ciclo">Ciclo Escolar</label>
              <input id="sc-ciclo" type="text" value="${Utils.sanitize(config.cicloEscolar || '')}">
            </div>
            <div class="form-group">
              <label for="sc-semestre">Semestre</label>
              <input id="sc-semestre" type="text" value="${Utils.sanitize(config.semestre || '')}">
            </div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header success">
          <h3>Turnos y Grados</h3>
        </div>
        <div class="config-section-body">
          <div class="config-grid">
            <div class="form-group">
              <label for="sc-turnos">Turnos (uno por l\u00ednea)</label>
              <textarea id="sc-turnos">${(config.turnos || []).join('\n')}</textarea>
            </div>
            <div class="form-group">
              <label for="sc-grados">Grados (uno por l\u00ednea)</label>
              <textarea id="sc-grados">${(config.grados || []).join('\n')}</textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header warning">
          <h3>Grupos por Turno</h3>
        </div>
        <div class="config-section-body">
          <div class="config-grid">
            <div class="form-group">
              <label for="sc-gruposMatutino">Grupos Matutino (uno por l\u00ednea)</label>
              <textarea id="sc-gruposMatutino">${(config.gruposMatutino || []).join('\n')}</textarea>
            </div>
            <div class="form-group">
              <label for="sc-gruposVespertino">Grupos Vespertino (uno por l\u00ednea)</label>
              <textarea id="sc-gruposVespertino">${(config.gruposVespertino || []).join('\n')}</textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="config-section">
        <div class="config-section-header purple">
          <h3>Parciales y Metas</h3>
        </div>
        <div class="config-section-body">
          <div class="config-grid">
            <div class="form-group">
              <label for="sc-parciales">Parciales (uno por l\u00ednea)</label>
              <textarea id="sc-parciales">${(config.parciales || []).join('\n')}</textarea>
            </div>
            <div class="form-group">
              <label for="sc-promedio">Promedio M\u00ednimo</label>
              <input id="sc-promedio" type="number" step="0.1" value="${config.metas?.promedio_minimo || 8.3}">
            </div>
            <div class="form-group">
              <label for="sc-asistencia">Asistencia M\u00ednima (%)</label>
              <input id="sc-asistencia" type="number" step="1" value="${config.metas?.asistencia_minima || 80}">
            </div>
            <div class="form-group">
              <label for="sc-reprobacion">Reprobaci\u00f3n M\u00e1xima (%)</label>
              <input id="sc-reprobacion" type="number" step="1" value="${config.metas?.reprobacion_maxima || 14}">
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderButtons() {
    return `
      <div class="flex gap-md mt-lg" style="padding-top:var(--spacing-xl);border-top:1px solid var(--color-border)">
        <button class="btn btn-success" data-action="save">
          <span class="material-icons-round">save</span> Guardar Cambios
        </button>
        <button class="btn btn-outline" data-action="reload">
          <span class="material-icons-round">refresh</span> Recargar
        </button>
      </div>
    `;
  }

  async function saveConfig() {
    try {
      const updatedConfig = {
        nombre: document.getElementById('sc-nombre').value.trim(),
        nombreCorto: document.getElementById('sc-nombreCorto').value.trim(),
        cicloEscolar: document.getElementById('sc-ciclo').value.trim(),
        semestre: document.getElementById('sc-semestre').value.trim(),
        turnos: document.getElementById('sc-turnos').value.trim().split('\n').filter(t => t.trim()),
        grados: document.getElementById('sc-grados').value.trim().split('\n').filter(g => g.trim()).map(g => parseInt(g.trim()) || g.trim()),
        gruposMatutino: document.getElementById('sc-gruposMatutino').value.trim().split('\n').filter(g => g.trim()),
        gruposVespertino: document.getElementById('sc-gruposVespertino').value.trim().split('\n').filter(g => g.trim()),
        parciales: document.getElementById('sc-parciales').value.trim().split('\n').filter(p => p.trim()).map(p => parseInt(p.trim()) || p.trim()),
        metas: {
          promedio_minimo: parseFloat(document.getElementById('sc-promedio').value) || 8.3,
          asistencia_minima: parseInt(document.getElementById('sc-asistencia').value) || 80,
          reprobacion_maxima: parseInt(document.getElementById('sc-reprobacion').value) || 14
        },
        updatedAt: DB.timestamp()
      };

      await DB.doc('config', 'school').set(updatedConfig, { merge: true });
      DB.audit('editar', 'configuracion', 'school', {
        description: 'Configuración de escuela actualizada',
        after: { nombre: updatedConfig.nombre, ciclo: updatedConfig.cicloEscolar, semestre: updatedConfig.semestre }
      });
      config = updatedConfig;
      Toast.show('Configuraci\u00f3n guardada exitosamente', 'success');
    } catch (e) {
      console.error('Error guardando configuraci\u00f3n:', e);
      Toast.show('Error al guardar: ' + e.message, 'error');
    }
  }

  function bindEvents() {
    document.getElementById('moduleContainer')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      if (btn.dataset.action === 'save') saveConfig();
      else if (btn.dataset.action === 'reload') renderContent();
    });
  }

  return { render };
})();

Router.modules['school-config'] = () => SchoolConfig.render();
