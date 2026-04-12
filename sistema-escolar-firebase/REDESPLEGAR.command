#!/bin/bash
clear
echo ""
echo "  REDESPLIEGUE RAPIDO - Sin login"
echo "  Proyecto: epo67-sistema"
echo ""

cd "$(dirname "$0")"
echo "Carpeta: $(pwd)"
echo ""
echo "Desplegando hosting y Firestore..."
echo ""

npx firebase-tools deploy --only hosting,firestore

if [ $? -eq 0 ]; then
    echo ""
    echo "  REDESPLIEGUE EXITOSO!"
    echo "  https://epo67-sistema.web.app"
    echo ""
    open "https://epo67-sistema.web.app" 2>/dev/null
else
    echo ""
    echo "  Error. Ejecuta DESPLEGAR.command para hacer login."
fi

echo ""
read -p "Presiona Enter para cerrar..."
