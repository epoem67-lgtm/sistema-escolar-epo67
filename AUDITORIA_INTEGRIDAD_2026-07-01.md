# Auditoría de integridad TOTAL — 2026-07-01

Barrido de las **29,106 calificaciones** de toda la base (matutino + vespertino, P1/P2/P3),
usando las MISMAS fórmulas del sistema (`K.calcSuma` / `K.calcCal`). Solo lectura.
CSV completo: `AUDITORIA_INTEGRIDAD_2026-07-01.csv`.

## Hallazgo principal: el problema es HISTÓRICO, ya casi no ocurre

| Parcial | Grades | Con hallazgo | % |
|---|---|---|---|
| **P1** | 9,708 | 4,313 | **44%** |
| **P2** | 9,701 | 314 | **3.2%** |
| **P3** | 9,696 | 34 | **0.35%** |

La caída P1 → P2 → P3 es la prueba de que **los arreglos al editor funcionaron**. Los bugs se
capturaron con versiones viejas; el editor de hoy ya casi no los produce. **P3 está esencialmente
limpio.**

## Desglose por tipo

| Código | Qué es | Total | ¿Bug real? |
|---|---|---|---|
| E2_suma≠calcSuma | La suma no cuadra con los rubros | 4,012 | **Casi todo NO** (ver abajo) |
| E4_ec>max | EC arriba del máximo del turno | 523 | Vespertino con rúbrica matutina (legado) |
| W1_pe>1 | Punto extra mayor a 1 | 181 | **NO** — decisión del maestro (cal auto-consistente) |
| W3_cal_sin_rubros | Hay cal pero no rubros | 45 | Imports/migraciones viejas |
| **E1_cal≠calcCal(suma)** | **La cal final no cuadra con su suma** | **30** | **SÍ — revisar** |
| **E4_tr>2** | **Transversal imposible (>2)** | **11** | **SÍ — dato erróneo** |
| E3_value≠cal | Campo espejo desalineado | 7 | Cosmético (todos P1) |

### El 90% del ruido son 2 patrones sistémicos, NO bugs
1. **Vespertino sin campo `ex` (3,707 casos):** la suma incluye el examen pero el rubro `ex` quedó
   en blanco. La **cal final es auto-consistente** (cal = calcCal(suma)) → la calificación del alumno
   está bien; lo que falta es el desglose. Es un tema de modelo de datos del vespertino, no grados mal.
2. **PE en socioemocional / PE con base<6 (P1-P2, ~200 matutino):** el punto extra se contó en
   parciales viejos antes de la regla que lo bloquea (esa regla entró en P3, por eso P3 no los tiene).
   En socioemocionales sí infló +1 algunas cal de P1/P2.

## Lo GENUINAMENTE accionable: 41 casos, TODOS en P1/P2 (P3 no tiene ninguno)

### E1 — cal ≠ su propia suma (30) — la cal no corresponde al desglose
Concentrados en dos focos:
- **Actividades Físicas y Deportivas II (P2 matutino):** ~10 alumnos con cal por encima de la suma
  (ej. suma 8 → cal 10). Parece cal escrita a mano sin rúbricas completas.
- **Temas Selectos de Filosofía (P1 vespertino):** 6 alumnos (Silva, González Pérez, Hernández Rosas,
  Silva González, Reyes Alvarado, Gallegos) — cal y `value` desalineados. (Corresponde al pendiente
  histórico "Filosofía VESP — verificar con maestra Franco".)
- Sueltos: Sánchez Carreño Daniela (P2, 3 materias), Mares González José Carlos (P2 suma 2 → cal 10),
  Luna Hurtado Jade, etc.

### E4 — Transversal > 2 (11) — dato imposible, todos P1
Gutiérrez Basurto (tr=7!), Bocanegra, Molina Cervantes, Castañeda (tr=4), Morales García, etc. En casi
todos la suma quedó topada en 10, así que el impacto en la cal final es mínimo, pero son datos sucios.

> **Importante — NO se corrigen en masa.** Las hojas impresas de P1/P2 MANDAN. Si esas hojas mostraban
> el valor "inflado", el sistema está bien y no se toca. Si mostraban otra cosa, se corrige UNA por UNA
> contra la hoja firmada de ese parcial. Esta lista es para *revisar con criterio*, no para un fix masivo.

## Conclusión
- **P3 (lo que alimenta boletas y fin de ciclo): limpio.** Los 34 hallazgos son PE>1 auto-consistentes,
  ya validados por el cotejo contra hojas.
- Los bugs reales son **41 casos históricos de P1/P2**, y el editor actual ya no los genera.
- Este barrido, convertido en **módulo dentro del sistema**, reemplaza el cotejo manual: se corre cuando
  se quiera y marca solo lo que se sale de la regla.
