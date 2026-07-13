#!/bin/bash
clear
echo ""
echo "  PUBLICAR FIX P3 - HOSTING + FIRESTORE RULES"
echo "  Proyecto: epo67-sistema"
echo ""
echo "  Este comando NO toca datos."
echo "  Publica el sitio y las reglas para que P3 respete cierre por grado."
echo ""

cd "$(dirname "$0")" || exit 1
echo "Carpeta: $(pwd)"
echo ""

echo "Paso 1/3: reautenticando Firebase..."
echo "Usa la cuenta: epoem67@gmail.com"
echo ""
npx firebase-tools login --reauth
if [ $? -ne 0 ]; then
  echo ""
  echo "No se pudo iniciar sesion."
  echo "Revisa internet/DNS y vuelve a intentarlo."
  echo ""
  read -p "Presiona Enter para cerrar..."
  exit 1
fi

echo ""
echo "Paso 2/3: verificando acceso al proyecto..."
npx firebase-tools projects:list
if [ $? -ne 0 ]; then
  echo ""
  echo "La sesion abrio, pero Firebase no dejo listar proyectos."
  echo ""
  read -p "Presiona Enter para cerrar..."
  exit 1
fi

echo ""
echo "Paso 3/3: publicando hosting + firestore rules..."
npx firebase-tools deploy --only hosting,firestore:rules
if [ $? -eq 0 ]; then
  echo ""
  echo "FIX PUBLICADO"
  echo "https://epo67-sistema.web.app"
  open "https://epo67-sistema.web.app" 2>/dev/null
else
  echo ""
  echo "No se pudo publicar el fix."
fi

echo ""
read -p "Presiona Enter para cerrar..."
