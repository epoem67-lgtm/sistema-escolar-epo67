#!/usr/bin/env python3
# Script de respaldo de Firebase - EPO 67
# Uso: python backup_firebase.py --project-id epo67-sistema --credentials serviceAccount.json
# Requiere: pip install firebase-admin

import argparse
import json
import os
import sys
from datetime import datetime

def main():
    parser = argparse.ArgumentParser(description="Respaldo de Firestore - EPO 67")
    parser.add_argument("--project-id", default="epo67-sistema", help="ID del proyecto Firebase")
    parser.add_argument("--credentials", required=True, help="Ruta al archivo serviceAccount.json")
    parser.add_argument("--output", help="Directorio de salida (default: _RESPALDOS/backup_FECHA)")
    args = parser.parse_args()

    if not os.path.isfile(args.credentials):
        print(f"ERROR: No se encontró credenciales: {args.credentials}")
        sys.exit(1)

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERROR: Necesitas instalar firebase-admin: pip install firebase-admin")
        sys.exit(1)

    # Directorio de salida
    fecha = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = args.output or os.path.join("_RESPALDOS", f"backup_{fecha}")
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  RESPALDO DE FIREBASE - EPO 67")
    print(f"  Proyecto: {args.project_id}")
    print(f"  Fecha: {fecha}")
    print(f"  Destino: {output_dir}")
    print(f"{'='*60}\n")

    # Inicializar Firebase
    cred = credentials.Certificate(args.credentials)
    firebase_admin.initialize_app(cred, {"projectId": args.project_id})
    db = firestore.client()

    # Obtener todas las colecciones
    colecciones = db.collections()
    total_docs = 0

    for col in colecciones:
        nombre = col.id
        docs = col.stream()
        datos = {}
        count = 0
        for doc in docs:
            datos[doc.id] = doc.to_dict()
            count += 1
        
        # Guardar como JSON
        archivo = os.path.join(output_dir, f"{nombre}.json")
        with open(archivo, 'w', encoding='utf-8') as f:
            json.dump(datos, f, ensure_ascii=False, indent=2, default=str)
        
        print(f"  ✓ {nombre}: {count} documentos")
        total_docs += count

    # Resumen
    print(f"\n  Total: {total_docs} documentos respaldados")
    print(f"  Ubicación: {output_dir}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
