#!/usr/bin/env python3
# Script independiente de validación de datos - EPO 67
# Uso: python validar_datos.py archivo.xlsx --turno MATUTINO --parcial 1
# Requiere: pip install openpyxl pandas

import argparse
import sys
import os

def main():
    parser = argparse.ArgumentParser(description="Validador de datos escolares EPO 67")
    parser.add_argument("archivo", help="Archivo Excel (.xlsx) o CSV a validar")
    parser.add_argument("--turno", choices=["MATUTINO", "VESPERTINO"], help="Turno a validar")
    parser.add_argument("--parcial", type=int, choices=range(1,7), help="Número de parcial (1-6)")
    parser.add_argument("--verbose", action="store_true", help="Mostrar detalles de cada error")
    args = parser.parse_args()

    if not os.path.isfile(args.archivo):
        print(f"ERROR: No se encontró el archivo: {args.archivo}")
        sys.exit(1)

    try:
        import pandas as pd
    except ImportError:
        print("ERROR: Necesitas instalar pandas: pip install pandas openpyxl")
        sys.exit(1)

    # Leer archivo
    ext = os.path.splitext(args.archivo)[1].lower()
    if ext == ".csv":
        df = pd.read_csv(args.archivo)
    elif ext in [".xlsx", ".xls"]:
        df = pd.read_excel(args.archivo)
    else:
        print(f"ERROR: Formato no soportado: {ext}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  REPORTE DE VALIDACIÓN - EPO 67")
    print(f"  Archivo: {os.path.basename(args.archivo)}")
    if args.turno: print(f"  Turno: {args.turno}")
    if args.parcial: print(f"  Parcial: {args.parcial}")
    print(f"  Registros: {len(df)}")
    print(f"{'='*60}\n")

    errores = []
    advertencias = []

    # Buscar columnas numéricas que parezcan calificaciones
    for col in df.columns:
        if df[col].dtype in ['float64', 'int64']:
            vals = df[col].dropna()
            if len(vals) == 0:
                continue
            
            # Verificar rango 0-10
            fuera_rango = vals[(vals < 0) | (vals > 10)]
            if len(fuera_rango) > 0:
                for idx in fuera_rango.index:
                    errores.append(f"[RANGO] Fila {idx+2}, '{col}': valor {df[col][idx]} fuera de rango 0-10")
            
            # Verificar valores vacíos
            vacios = df[col].isna().sum()
            if vacios > 0:
                advertencias.append(f"[VACÍO] Columna '{col}': {vacios} valores vacíos de {len(df)}")
            
            # Detectar anomalías: todos iguales
            if len(vals) > 3 and vals.nunique() == 1:
                advertencias.append(f"[ANOMALÍA] Columna '{col}': todos los valores son {vals.iloc[0]}")
            
            # Detectar anomalías: desviación estándar muy baja
            if len(vals) > 5:
                std = vals.std()
                if std < 0.1 and vals.nunique() > 1:
                    advertencias.append(f"[ANOMALÍA] Columna '{col}': variabilidad muy baja (std={std:.3f})")
                
                # Outliers (más de 2 desviaciones)
                mean = vals.mean()
                outliers = vals[abs(vals - mean) > 2 * std] if std > 0 else pd.Series()
                if len(outliers) > 0:
                    for idx in outliers.index:
                        advertencias.append(f"[OUTLIER] Fila {idx+2}, '{col}': valor {df[col][idx]} (media={mean:.1f}, std={std:.1f})")

    # Resumen
    total = len(errores) + len(advertencias)
    print(f"  RESUMEN:")
    print(f"  {'🔴' if errores else '🟢'} Errores críticos: {len(errores)}")
    print(f"  {'🟡' if advertencias else '🟢'} Advertencias: {len(advertencias)}")
    print()

    if errores:
        print(f"  ERRORES CRÍTICOS:")
        for e in errores[:20]:
            print(f"    ✗ {e}")
        if len(errores) > 20:
            print(f"    ... y {len(errores)-20} errores más")
        print()

    if advertencias:
        print(f"  ADVERTENCIAS:")
        for a in advertencias[:20]:
            print(f"    ⚠ {a}")
        if len(advertencias) > 20:
            print(f"    ... y {len(advertencias)-20} advertencias más")
        print()

    if not errores and not advertencias:
        print(f"  ✓ No se encontraron problemas")
    
    print(f"{'='*60}")
    return 1 if errores else 0

if __name__ == "__main__":
    sys.exit(main())
