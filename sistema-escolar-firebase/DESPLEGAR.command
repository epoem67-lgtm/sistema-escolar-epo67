#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SCRIPT DE DESPLIEGUE - Sistema Escolar Firebase
# Doble clic en este archivo para ejecutar
# ═══════════════════════════════════════════════════════════════

clear
echo ""
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║   DESPLIEGUE - Sistema Escolar Firebase       ║"
echo "  ║   Proyecto: epo67-sistema                     ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo ""

# Ir a la carpeta del proyecto
cd "$(dirname "$0")"
echo "📁 Carpeta del proyecto: $(pwd)"
echo ""

# ─── PASO 1: Verificar Node.js ───────────────────────────────
echo "━━━ Paso 1/4: Verificando Node.js... ━━━"
if ! command -v node &> /dev/null; then
    echo ""
    echo "❌ Node.js no está instalado."
    echo ""
    echo "   Instálalo desde: https://nodejs.org"
    echo "   Descarga la versión LTS y ejecuta el instalador."
    echo "   Después vuelve a ejecutar este script."
    echo ""
    read -p "Presiona Enter para cerrar..."
    exit 1
fi
echo "✅ Node.js $(node -v) encontrado"
echo ""

# ─── PASO 2: Verificar npx (viene con Node.js) ──────────────
echo "━━━ Paso 2/4: Verificando herramientas... ━━━"
if ! command -v npx &> /dev/null; then
    echo "❌ npx no encontrado. Reinstala Node.js desde https://nodejs.org"
    read -p "Presiona Enter para cerrar..."
    exit 1
fi
echo "✅ npx disponible (usaremos npx firebase-tools, sin instalar nada)"
echo ""

# ─── PASO 3: Iniciar sesión en Firebase ──────────────────────
echo "━━━ Paso 3/4: Iniciando sesión en Firebase... ━━━"
echo ""
echo "  Se abrirá tu navegador para iniciar sesión."
echo "  Usa la cuenta: epoem67@gmail.com"
echo ""
read -p "  Presiona Enter cuando estés listo..."
echo ""

npx firebase-tools login --reauth
if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Error en la autenticación. Intenta de nuevo."
    read -p "Presiona Enter para cerrar..."
    exit 1
fi
echo ""
echo "✅ Sesión iniciada correctamente"
echo ""

# ─── PASO 4: Desplegar ──────────────────────────────────────
echo "━━━ Paso 4/4: Desplegando a Firebase... ━━━"
echo ""

echo "Desplegando hosting y reglas de Firestore..."
echo ""

npx firebase-tools deploy --only hosting,firestore
DEPLOY_RESULT=$?

echo ""
if [ $DEPLOY_RESULT -eq 0 ]; then
    echo "  ╔═══════════════════════════════════════════════╗"
    echo "  ║                                               ║"
    echo "  ║   ✅ ¡DESPLIEGUE EXITOSO!                    ║"
    echo "  ║                                               ║"
    echo "  ║   Tu sistema está en línea en:                ║"
    echo "  ║   https://epo67-sistema.web.app               ║"
    echo "  ║                                               ║"
    echo "  ╚═══════════════════════════════════════════════╝"
    echo ""
    echo "  También disponible en:"
    echo "  https://epo67-sistema.firebaseapp.com"
    echo ""

    # Abrir en el navegador
    open "https://epo67-sistema.web.app" 2>/dev/null
else
    echo "  ❌ Hubo un error en el despliegue."
    echo "  Revisa los mensajes de arriba para más detalles."
    echo ""
    echo "  Si el error menciona 'Hosting' no habilitado:"
    echo "  1. Ve a https://console.firebase.google.com/project/epo67-sistema/hosting"
    echo "  2. Haz clic en 'Comenzar'"
    echo "  3. Ejecuta este script de nuevo"
fi

echo ""
read -p "Presiona Enter para cerrar..."
