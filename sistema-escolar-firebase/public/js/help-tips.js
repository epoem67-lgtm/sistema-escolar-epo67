/**
 * HELP TIPS — sistema de ayuda contextual
 *
 * 1) Componente reutilizable: <span class="help-tip" data-help="texto">?</span>
 *    Al hover/click muestra un tooltip con explicación.
 *
 * 2) Modo "ayuda activa": un toggle global que resalta TODOS los help-tips
 *    para que el usuario los note (útil la primera vez).
 *
 * Uso desde código JS:
 *   HelpTip.html('Esta calificación se calcula automáticamente...')
 *   → retorna HTML del icono ? con tooltip
 */

(function () {
  // ─── HTML helper ───
  function html(text, opts) {
    opts = opts || {};
    const safe = String(text || '').replace(/"/g, '&quot;');
    const size = opts.size || 14;
    return `<span class="help-tip" data-help="${safe}"
      style="display:inline-flex;align-items:center;justify-content:center;
             width:${size}px;height:${size}px;border-radius:50%;
             background:#eef5fb;color:#3182ce;font-size:${size-3}px;font-weight:700;
             cursor:help;margin-left:4px;vertical-align:middle;border:1px solid #cbd5e0;
             user-select:none;">?</span>`;
  }

  // ─── Tooltip global (un solo nodo flotante) ───
  let tipEl = null;
  function _ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = 'helpTipBubble';
    tipEl.style.cssText = `
      position:fixed;z-index:9996;background:#1e293b;color:#fff;
      padding:8px 12px;border-radius:6px;font-size:12px;line-height:1.4;
      max-width:280px;box-shadow:0 6px 16px rgba(0,0,0,0.25);
      pointer-events:none;opacity:0;transition:opacity 0.15s;
      display:none;
    `;
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function _show(el, text) {
    const tip = _ensureTip();
    tip.textContent = text;
    tip.style.display = 'block';
    tip.style.opacity = '0';
    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      let top = rect.bottom + 6;
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      // Mantener dentro del viewport
      if (left < 8) left = 8;
      if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
      if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 6;
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
      tip.style.opacity = '1';
    });
  }

  function _hide() {
    if (!tipEl) return;
    tipEl.style.opacity = '0';
    setTimeout(() => { if (tipEl) tipEl.style.display = 'none'; }, 150);
  }

  // ─── Listeners globales ───
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('.help-tip[data-help]');
    if (el) _show(el, el.dataset.help);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest?.('.help-tip[data-help]')) _hide();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('.help-tip[data-help]');
    if (el) {
      e.preventDefault();
      e.stopPropagation();
      // En móvil, click muestra/oculta
      if (tipEl?.style.display === 'block') _hide();
      else _show(el, el.dataset.help);
      // Auto-hide después de 5s en móvil
      setTimeout(_hide, 5000);
    }
  });

  // Cerrar al scroll
  document.addEventListener('scroll', _hide, true);

  // Exponer API
  window.HelpTip = { html };
})();
