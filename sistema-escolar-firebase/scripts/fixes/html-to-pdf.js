/**
 * HTML TO PDF — EPO 67
 *
 * Convierte cada archivo .html de la carpeta cartas-individuales-{fecha}/
 * en un PDF usando Chrome headless (sin instalar dependencias adicionales).
 *
 * Drive renderiza PDFs perfectamente en su vista previa, mientras que
 * los HTMLs los muestra como código fuente.
 *
 * Uso:
 *   node scripts/fixes/html-to-pdf.js cartas-individuales-2026-05-07
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Uso: node html-to-pdf.js <carpeta-con-htmls>');
  process.exit(1);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.error('No se encontró Google Chrome en /Applications/');
  console.error('Instálalo primero: brew install --cask google-chrome');
  process.exit(1);
}

const outDir = dir + '-pdf';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const htmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
console.log(`\n📄 Convirtiendo ${htmlFiles.length} archivos HTML a PDF...\n`);

let ok = 0, fail = 0;
for (let i = 0; i < htmlFiles.length; i++) {
  const html = htmlFiles[i];
  const pdf = html.replace(/\.html$/, '.pdf');
  const inputPath = path.resolve(dir, html);
  const outputPath = path.resolve(outDir, pdf);

  try {
    execSync(
      `"${CHROME}" --headless=new --disable-gpu --no-pdf-header-footer ` +
      `--print-to-pdf="${outputPath}" --print-to-pdf-no-header ` +
      `"file://${inputPath}"`,
      { stdio: 'pipe', timeout: 30000 }
    );
    console.log(`  ✅ [${i + 1}/${htmlFiles.length}] ${pdf}`);
    ok++;
  } catch (e) {
    console.log(`  ❌ [${i + 1}/${htmlFiles.length}] ${html} — ${e.message.slice(0, 80)}`);
    fail++;
  }
}

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  ✅ PDFs generados:  ${ok}`);
console.log(`  ❌ Fallaron:        ${fail}`);
console.log(`  📂 Carpeta:         ${outDir}/`);
console.log(`═══════════════════════════════════════════════════════════\n`);

if (ok > 0) {
  console.log(`📌 PRÓXIMOS PASOS:`);
  console.log(`  1. Olivia arrastra los PDFs de ${outDir}/ al folder de Drive.`);
  console.log(`  2. Drive los renderiza bonito en su preview.\n`);
}
