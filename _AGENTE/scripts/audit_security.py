#!/usr/bin/env python3
# Script de auditoría de seguridad - EPO 67
# Uso: python audit_security.py SISTEMA_FIREBASE_v13.html
# No requiere dependencias externas

import argparse
import re
import sys
import os

# Colores ANSI
RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
BOLD = "\033[1m"
RESET = "\033[0m"

def main():
    parser = argparse.ArgumentParser(description="Auditoría de seguridad del dashboard EPO 67")
    parser.add_argument("archivo", help="Archivo HTML del dashboard")
    args = parser.parse_args()

    if not os.path.isfile(args.archivo):
        print(f"ERROR: No se encontró: {args.archivo}")
        sys.exit(1)

    with open(args.archivo, 'r', encoding='utf-8') as f:
        contenido = f.read()
    lineas = contenido.split("\n")

    print(f"\n{BOLD}{'='*60}")
    print(f"  AUDITORÍA DE SEGURIDAD - EPO 67")
    print(f"  Archivo: {os.path.basename(args.archivo)}")
    print(f"  Líneas: {len(lineas)}")
    print(f"{'='*60}{RESET}\n")

    hallazgos = {"CRÍTICO": [], "ALTO": [], "MEDIO": [], "BAJO": []}

    # 1. API Keys expuestas
    api_keys = re.findall(r'apiKey["\'\s:]+(["\'](AIza[\w-]+)["\'\s])', contenido)
    if api_keys:
        hallazgos["MEDIO"].append("API Key de Firebase encontrada en código frontend (normal en Firebase, pero verificar Firestore Rules)")

    # 2. Contraseñas hardcodeadas
    passwords = re.findall(r'(?:password|passwd|pwd|contraseña)["\'\s:=]+["\'](\S+)["\'\s]', contenido, re.IGNORECASE)
    if passwords:
        hallazgos["CRÍTICO"].append(f"Posible(s) contraseña(s) hardcodeada(s): {len(passwords)} encontrada(s)")

    # 3. Console.log con datos potencialmente sensibles
    console_logs = []
    for i, linea in enumerate(lineas):
        if 'console.log' in linea.lower():
            if any(kw in linea.lower() for kw in ['alumno', 'nombre', 'calificaci', 'password', 'email', 'token']):
                console_logs.append(i+1)
    if console_logs:
        hallazgos["MEDIO"].append(f"console.log con datos potencialmente sensibles en líneas: {console_logs[:5]}")

    # 4. eval() usage
    evals = [i+1 for i, l in enumerate(lineas) if 'eval(' in l and not l.strip().startswith('//')]
    if evals:
        hallazgos["ALTO"].append(f"Uso de eval() encontrado en líneas: {evals}")

    # 5. innerHTML sin sanitizar
    inner_html = [i+1 for i, l in enumerate(lineas) if '.innerHTML' in l and ('input' in l.lower() or 'value' in l.lower())]
    if inner_html:
        hallazgos["ALTO"].append(f"innerHTML con posible input no sanitizado en líneas: {inner_html[:10]}")

    # 6. localStorage con datos sensibles
    ls_writes = [i+1 for i, l in enumerate(lineas) if 'localStorage.set' in l]
    if ls_writes:
        hallazgos["MEDIO"].append(f"Escritura a localStorage en {len(ls_writes)} ubicaciones (verificar que no almacene datos sensibles)")

    # 7. Firestore rules reference check
    if 'allow read, write: if true' in contenido or 'allow read, write;' in contenido:
        hallazgos["CRÍTICO"].append("Reglas de Firestore abiertas detectadas en el código")

    # 8. HTTP en lugar de HTTPS
    http_refs = re.findall(r'http://(?!localhost)', contenido)
    if http_refs:
        hallazgos["BAJO"].append(f"Referencias HTTP (no HTTPS) encontradas: {len(http_refs)}")

    # 9. Sin Content Security Policy
    if 'Content-Security-Policy' not in contenido:
        hallazgos["BAJO"].append("Sin meta tag Content-Security-Policy")

    # Presentar resultados
    color_map = {"CRÍTICO": RED, "ALTO": RED, "MEDIO": YELLOW, "BAJO": GREEN}
    total = sum(len(v) for v in hallazgos.values())

    for nivel in ["CRÍTICO", "ALTO", "MEDIO", "BAJO"]:
        items = hallazgos[nivel]
        color = color_map[nivel]
        if items:
            print(f"  {color}{BOLD}[{nivel}]{RESET}")
            for item in items:
                print(f"    {color}• {item}{RESET}")
            print()

    # Semáforo general
    if hallazgos["CRÍTICO"]:
        sem = f"{RED}🔴 REQUIERE ATENCIÓN INMEDIATA{RESET}"
    elif hallazgos["ALTO"]:
        sem = f"{YELLOW}🟡 HAY ISSUES IMPORTANTES{RESET}"
    else:
        sem = f"{GREEN}🟢 ESTADO ACEPTABLE{RESET}"

    print(f"  {BOLD}ESTADO GENERAL: {sem}")
    print(f"  Total hallazgos: {total}{RESET}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
