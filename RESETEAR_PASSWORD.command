#!/bin/bash
# Reset rapido de contraseña de un docente.
# Doble clic para usar — NO necesita abrir Terminal manualmente.

cd "$(dirname "$0")/sistema-escolar-firebase"

# Refrescar token de Firebase si caducó (silencioso)
npx firebase-tools projects:list >/dev/null 2>&1

# Correr el script interactivo
node scripts/fixes/reset-rapido.js
