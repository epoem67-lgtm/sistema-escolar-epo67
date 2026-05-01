#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SCRIPT DE MIGRACIÓN DE CALIFICACIONES
# Ejecuta la migración completa con todas las dependencias
# ═══════════════════════════════════════════════════════════════

cd "$(dirname "$0")"

echo "════════════════════════════════════════════════════"
echo "  MIGRACIÓN DE CALIFICACIONES — EPO 67"
echo "════════════════════════════════════════════════════"

# 1. Refresh access token
echo ""
echo "📋 Paso 1: Refrescando token de acceso..."
node -e "
const fs = require('fs');
const https = require('https');
const config = JSON.parse(fs.readFileSync(require('os').homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const data = 'client_id=563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com&client_secret=j9iVZfS8kkCEFUPaAeJV0sAi&refresh_token=' + config.tokens.refresh_token + '&grant_type=refresh_token';
const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':data.length}}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    const r = JSON.parse(body);
    if (r.access_token) {
      fs.writeFileSync('/tmp/firebase-access-token.txt', r.access_token);
      console.log('   ✅ Token refrescado');
    } else {
      console.error('   ❌ Error:', body);
      process.exit(1);
    }
  });
});
req.write(data);
req.end();
"

if [ $? -ne 0 ]; then
  echo "❌ Error al refrescar token. Verifica tu login con: npx firebase-tools login"
  exit 1
fi

sleep 2

# 2. Dry run first
echo ""
echo "📋 Paso 2: Dry run (verificar matching sin escribir)..."
node migrate-from-drive.js --dry-run

echo ""
read -p "¿Continuar con la escritura real? (s/N): " CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
  echo "Cancelado."
  exit 0
fi

# 3. Run migration (live write)
echo ""
echo "📋 Paso 3: Ejecutando migración (escritura real)..."
node migrate-from-drive.js

echo ""
echo "════════════════════════════════════════════════════"
echo "  Migración finalizada. Verifica los resultados arriba."
echo "════════════════════════════════════════════════════"
