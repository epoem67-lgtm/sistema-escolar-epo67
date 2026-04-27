// ═══════════════════════════════════════════════════════════════
// LOGOS — Sistema Escolar EPO 67
// URLs absolutas a los logos del header/footer oficial.
// Antes este archivo era 147 KB con los PNG en base64 inline,
// bloqueando el parser JS al inicio. Ahora los PNG estan en /img/
// y se cargan solo cuando se imprime/exporta (con cache immutable
// de 1 anio en Firebase Hosting).
//
// Compatibilidad: las constantes LOGO_HEADER_SRC y LOGO_FOOTER_SRC
// siguen siendo strings que se inyectan en <img src="..."> dentro
// de templates de impresion. URLs absolutas para que funcionen
// tambien en ventanas about:blank abiertas con window.open().
// ═══════════════════════════════════════════════════════════════

const LOGO_HEADER_SRC = window.location.origin + '/img/logo-header.png';
const LOGO_FOOTER_SRC = window.location.origin + '/img/logo-footer.png';
