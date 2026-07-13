# Acta de condonación de inasistencias — Dirección Escolar EPO 67

**Escuela Preparatoria Oficial Núm. 67** · Ciclo escolar 2025-2026 · Turno Vespertino
**Fecha:** 08 de julio de 2026
**Autoriza:** Dra. Karina Ilusión Laguerenne Chiquete — **Directora Escolar**
**Aplicó en el sistema:** Olivia Peña Ramírez — Administradora del sistema
**Fundamento del ajuste:** Decisión administrativa de Dirección para alumnos de 3° en el
límite del umbral de inasistencias (>20% → examen extraordinario por faltas).

> **Naturaleza del ajuste — importante.** El conteo **real** de faltas de cada alumno **se
> conserva intacto** en el sistema (no se borró ni se alteró). Lo que se registró es una
> **condonación** de N inasistencias, autorizada por Dirección, que **sólo** se descuenta
> para el cálculo del 20%. Cada registro queda **sellado y auditable** con quién autorizó,
> el motivo y la fecha. Esto es tamper-evidente: cualquiera puede ver exactamente qué se
> condonó, para quién y por orden de quién.

## Condonaciones aplicadas

| # | Alumno | Grupo | Materia | Faltas reales | Condonadas | Efectivas | % efectivo | Resultado |
|---|--------|-------|---------|:---:|:---:|:---:|:---:|---|
| 1 | Castillo Hernández Yahel | 3-3 vesp | Conciencia Histórica III | 16 | **4** | 12 | 18.8% | Fuera de extra |
| 2 | Castillo Hernández Yahel | 3-3 vesp | Temas Selectos de Inglés II | 15 | **3** | 12 | 18.8% | Fuera de extra |
| 3 | Castillo Hernández Yahel | 3-3 vesp | Temas Selectos de Matemáticas II | 8 | **1** | 7 | 17.9% | Fuera de extra |
| 4 | Reyes Alvarado Melany Mayrin | 3-3 vesp | Conciencia Histórica III | 13 | **1** | 12 | 18.8% | Fuera de extra |
| 5 | Reyes Alvarado Melany Mayrin | 3-3 vesp | Temas Selectos de Inglés II | 13 | **1** | 12 | 18.8% | Fuera de extra |
| 6 | Bárcenas González Ricardo Yamil | 3-2 vesp | Temas Selectos de Matemáticas II | 9 | **2** | 7 | 17.9% | Fuera de extra |

**Total: 12 inasistencias condonadas · 3 alumnos · 6 materias.**

## Casos revisados que NO requirieron ajuste

- **Carmona Granados Ximena Paolette (3-3):** su materia más alta (Conciencia Histórica III)
  está en **15.6%** — por debajo del 20%. **No estaba en extraordinario por faltas; no se tocó.**
- **Reyes Alvarado Melany — Ciencias de la Comunicación I:** 18.8%, por debajo del umbral.
  No requirió condonación.

## Trazabilidad (para auditoría)

Cada condonación quedó grabada en el documento de calificación del parcial (P3) de la
materia correspondiente, con el campo `faltasCondonadas` y el objeto `condonacion`:

```
condonacion: {
  faltas:        <N condonadas>,
  autorizadoPor: "Dra. Karina Ilusión Laguerenne Chiquete (Directora)",
  motivo:        "Condonación de inasistencias autorizada por Dirección · ciclo 2025-2026",
  fecha:         "2026-07-08",
  aplicadoPor:   "Olivia Peña Ramírez (admin)",
  umbral:        20
}
```

El sistema (v9.21) descuenta estas faltas condonadas en los **4 puntos** donde se evalúa el
20%: cálculo central de extraordinario, alumnos en riesgo, reporte de extraordinarios y
concentrados/boletas. El número **bruto** sigue visible; sólo el estatus de extra refleja
el efectivo.

---

**_______________________________**
Dra. Karina Ilusión Laguerenne Chiquete
Directora Escolar — EPO 67
