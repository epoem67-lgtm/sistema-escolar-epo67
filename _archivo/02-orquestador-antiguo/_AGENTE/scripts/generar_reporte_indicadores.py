#!/usr/bin/env python3
# Script de indicadores institucionales - EPO 67
# Uso: python generar_reporte_indicadores.py datos.xlsx --turno MATUTINO --parcial 1
# Metas: Promedio >= 8.3 | Asistencia >= 80% | Reprobación <= 14%
# Requiere: pip install pandas openpyxl

import argparse
import sys
import os

# Colores ANSI
RED = "\033[91m"
YELLOW = "\033[93m"
GREEN = "\033[92m"
BOLD = "\033[1m"
RESET = "\033[0m"

METAS = {
    "promedio": {"valor": 8.3, "op": ">=", "nombre": "Promedio General"},
    "asistencia": {"valor": 80.0, "op": ">=", "nombre": "Asistencia (%)"},
    "reprobacion": {"valor": 14.0, "op": "<=", "nombre": "Reprobación (%)"},
}

def semaforo(valor, meta_info):
    """Retorna color según cercanía a la meta"""
    meta = meta_info["valor"]
    if meta_info["op"] == ">=":
        if valor >= meta: return GREEN
        elif valor >= meta * 0.9: return YELLOW
        else: return RED
    else:  # <=
        if valor <= meta: return GREEN
        elif valor <= meta * 1.1: return YELLOW
        else: return RED

def main():
    parser = argparse.ArgumentParser(description="Indicadores institucionales EPO 67")
    parser.add_argument("archivo", help="Archivo Excel con calificaciones")
    parser.add_argument("--turno", choices=["MATUTINO", "VESPERTINO"], help="Filtrar por turno")
    parser.add_argument("--parcial", type=int, choices=range(1,7), help="Número de parcial")
    parser.add_argument("--output", help="Archivo Excel de salida para el reporte")
    args = parser.parse_args()

    if not os.path.isfile(args.archivo):
        print(f"ERROR: No se encontró: {args.archivo}")
        sys.exit(1)

    try:
        import pandas as pd
    except ImportError:
        print("ERROR: pip install pandas openpyxl")
        sys.exit(1)

    df = pd.read_excel(args.archivo)

    print(f"\n{BOLD}{'='*60}")
    print(f"  INDICADORES INSTITUCIONALES - EPO 67")
    print(f"  Ciclo 2025-2026")
    if args.turno: print(f"  Turno: {args.turno}")
    if args.parcial: print(f"  Parcial: {args.parcial}")
    print(f"  Registros: {len(df)}")
    print(f"{'='*60}{RESET}\n")

    # Buscar columnas de calificaciones (numéricas entre 0-10)
    cols_calif = []
    for col in df.columns:
        if df[col].dtype in ['float64', 'int64']:
            vals = df[col].dropna()
            if len(vals) > 0 and vals.min() >= 0 and vals.max() <= 10:
                cols_calif.append(col)

    if not cols_calif:
        print(f"  {RED}ERROR: No se encontraron columnas de calificaciones{RESET}")
        sys.exit(1)

    print(f"  Columnas de calificaciones detectadas: {len(cols_calif)}")
    print()

    # Calcular indicadores
    all_grades = df[cols_calif].values.flatten()
    all_grades = all_grades[~pd.isna(all_grades)]

    promedio = all_grades.mean()
    reprobados = (all_grades < 6.0).sum()
    total_calif = len(all_grades)
    pct_reprobacion = (reprobados / total_calif * 100) if total_calif > 0 else 0

    # Mostrar indicadores
    print(f"  {BOLD}INDICADORES GENERALES:{RESET}")
    print()
    
    color = semaforo(promedio, METAS["promedio"])
    icono = "✓" if color == GREEN else ("~" if color == YELLOW else "✗")
    print(f"  {color}{icono} Promedio General: {promedio:.2f} (meta: >= {METAS['promedio']['valor']}){RESET}")
    
    color = semaforo(pct_reprobacion, METAS["reprobacion"])
    icono = "✓" if color == GREEN else ("~" if color == YELLOW else "✗")
    print(f"  {color}{icono} Reprobación: {pct_reprobacion:.1f}% (meta: <= {METAS['reprobacion']['valor']}%){RESET}")
    print(f"     ({reprobados} calificaciones reprobatorias de {total_calif})")
    
    print(f"  {YELLOW}~ Asistencia: No disponible en este archivo{RESET}")
    print(f"     (La asistencia se calcula desde los controles de asistencia)")
    
    print(f"\n{'='*60}\n")

    # Exportar si se pidió
    if args.output:
        resumen = pd.DataFrame({
            "Indicador": ["Promedio General", "Reprobación (%)", "Total calificaciones"],
            "Valor": [round(promedio, 2), round(pct_reprobacion, 1), total_calif],
            "Meta": [">= 8.3", "<= 14%", "-"],
            "Estado": [
                "CUMPLE" if promedio >= 8.3 else "NO CUMPLE",
                "CUMPLE" if pct_reprobacion <= 14 else "NO CUMPLE",
                "-"
            ]
        })
        resumen.to_excel(args.output, index=False)
        print(f"  Reporte exportado a: {args.output}")

if __name__ == "__main__":
    main()
