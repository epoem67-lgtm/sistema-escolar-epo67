# Sistema Orquestador EPO 67
## Arquitectura: Agente Principal + 5 Sub-agentes

---

## Visión General

```
                    ┌─────────────────────────┐
                    │   AGENTE ORQUESTADOR     │
                    │   (epo67-orchestrator)   │
                    │                          │
                    │  • Analiza tu petición   │
                    │  • Decide qué sub-agente │
                    │    invocar               │
                    │  • Coordina flujos       │
                    │    multi-paso            │
                    └────────┬────────────────┘
                             │
            ┌────────────────┼────────────────────┐
            │                │                     │
     ┌──────▼──────┐  ┌─────▼──────┐  ┌──────────▼────────┐
     │ data-manager│  │  report-   │  │  system-builder   │
     │             │  │  generator │  │                   │
     │ Extrae datos│  │ Boletas,   │  │ Modifica HTML/JS  │
     │ de Excel/   │  │ indicadores│  │ del dashboard,    │
     │ Sheets,     │  │ listas     │  │ agrega funciones  │
     │ transforma  │  │ oficiales  │  │ corrige bugs      │
     └──────┬──────┘  └─────┬──────┘  └──────────┬────────┘
            │                │                     │
     ┌──────▼──────┐  ┌─────▼──────┐
     │ data-       │  │  security- │
     │ validator   │  │  auditor   │
     │             │  │            │
     │ Valida      │  │ Firebase   │
     │ integridad, │  │ rules, API │
     │ detecta     │  │ keys,      │
     │ anomalías   │  │ permisos   │
     └─────────────┘  └────────────┘
```

---

## Sub-agentes y sus responsabilidades

### 1. data-manager (Gestión de Datos)
**Trigger**: "importar", "extraer datos", "consolidar calificaciones", "actualizar datos", "Excel", "Sheets"

- Leer y parsear archivos Excel (.xlsx) de controles de evaluación
- Extraer datos de las hojas de Google Sheets de los 73 docentes
- Transformar datos al formato que necesita el dashboard Firebase
- Generar el archivo consolidado para importación
- Detectar cambios entre versiones de datos

### 2. report-generator (Generación de Reportes)
**Trigger**: "boleta", "reporte", "indicador", "lista oficial", "imprimir", "generar PDF"

- Generar boletas individuales por alumno
- Calcular y presentar indicadores institucionales (promedio ≥8.3, asistencia ≥80%, reprobación ≤14%)
- Crear listas oficiales por turno/grado/grupo
- Exportar reportes en Excel, PDF o para impresión
- Generar análisis comparativos entre parciales

### 3. system-builder (Mantenimiento del Sistema)
**Trigger**: "agregar función", "modificar dashboard", "bug", "nueva vista", "actualizar sistema"

- Modificar el HTML/JS/CSS del dashboard (SISTEMA_FIREBASE_v13.html)
- Agregar nuevos módulos o vistas
- Corregir bugs en funcionalidades existentes
- Optimizar rendimiento del dashboard
- Actualizar la integración con Firebase

### 4. security-auditor (Seguridad)
**Trigger**: "seguridad", "auditoría", "permisos", "Firebase rules", "API key", "vulnerabilidad"

- Auditar reglas de seguridad de Firebase (Firestore rules)
- Verificar que las API keys no estén expuestas indebidamente
- Revisar permisos de usuarios (quién puede leer/escribir qué)
- Detectar vulnerabilidades en el código del dashboard
- Generar reporte de seguridad con recomendaciones
- Validar que los datos sensibles de alumnos estén protegidos

### 5. data-validator (Validación de Datos)
**Trigger**: "validar", "verificar datos", "inconsistencia", "datos faltantes", "anomalía"

- Verificar integridad de calificaciones (rango 0-10, sin vacíos)
- Detectar alumnos sin calificaciones en alguna materia
- Cruzar listas oficiales vs datos capturados (¿faltan alumnos?)
- Validar que los promedios estén bien calculados
- Detectar anomalías estadísticas (calificaciones sospechosas)
- Generar reporte de inconsistencias

---

## Scripts Independientes (para correr sin Claude)

```
_AGENTE/scripts/
├── consolidar_calificaciones.js   → Apps Script para jalar datos de 73 docentes
├── validar_datos.py               → Valida integridad de un Excel de control
├── generar_reporte_indicadores.py → Calcula indicadores desde Excel
├── backup_firebase.py             → Respalda datos de Firestore
└── audit_security.py              → Revisa reglas de Firebase
```

---

## Estructura de Carpetas Final

```
_AGENTE/
├── SKILL.md                    → Skill del orquestador principal
├── subagentes/
│   ├── data-manager/
│   │   └── SKILL.md
│   ├── report-generator/
│   │   └── SKILL.md
│   ├── system-builder/
│   │   └── SKILL.md
│   ├── security-auditor/
│   │   └── SKILL.md
│   └── data-validator/
│       └── SKILL.md
├── skills/                     → Skills auxiliares compartidos
│   ├── excel-extractor/
│   │   └── SKILL.md
│   └── firebase-helper/
│       └── SKILL.md
├── scripts/                    → Scripts independientes
│   ├── consolidar_calificaciones.js
│   ├── validar_datos.py
│   ├── generar_reporte.py
│   ├── backup_firebase.py
│   └── audit_security.py
└── referencias/
    └── DOCUMENTACION_SISTEMA_EPO67.md
```

---

## Flujo de Uso

### Desde Cowork (conmigo):
1. Tú dices: "Necesito generar las boletas del primer parcial del turno matutino"
2. El orquestador analiza → invoca **report-generator**
3. report-generator lee los datos → genera las boletas → te las entrega

### Desde scripts independientes:
1. Tú ejecutas: `python validar_datos.py "CONTROL EVALUACIONES PRIMER GRADO/PRIMER PARCIAL"`
2. El script lee el Excel, valida, y genera un reporte de inconsistencias

### Flujos multi-paso:
1. "Consolida las calificaciones y dime si hay problemas"
2. Orquestador → **data-manager** (consolida) → **data-validator** (valida) → te presenta resultados
