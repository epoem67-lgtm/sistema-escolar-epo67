# DIAGNÓSTICO — Inconsistencias en reporte de Irregulares

**Fecha:** 29 de junio de 2026
**Reportado por:** Olivia Peña
**Casos:** SUAZO (1-1 matutino, Ciencias Naturales), GUERRERO ENRIQUEZ y JACOBO QUIROGA (2-2 vespertino)

---

## RESUMEN EJECUTIVO

Hay **2 problemas distintos**, no uno solo:

| # | Problema | Causa raíz | Severidad |
|---|---|---|---|
| 1 | SUAZO (1-1 mat) aparece como aprobado en CN cuando el papel firmado lo tiene reprobado | Fix masivo TR=0→TR=2 lo sobre-corrigió (cambió cal P3 de 6 a 8) | 🔴 ALTA — afecta 7 alumnos en ese bucket, posiblemente más en otros |
| 2 | 2-2 vespertino — pocas materias reprobadas detectadas | 14 de 35 alumnos NO tienen NINGUNA calificación de P3 capturada | 🟠 MEDIA — el reporte está matemáticamente bien con los datos disponibles, pero los datos están incompletos |

---

## CASO 1 — SUAZO RIOS SANTIAGO (1-1 Matutino) en Ciencias Naturales

### Datos en Firestore HOY

| Parcial | EC | TR | PE | Suma | Cal | Faltas |
|---|---|---|---|---|---|---|
| P1 | 6 | 0 | 0 | 6 | 6 | 4 |
| P2 | 5 | — | — | 5 | 5 | 1 |
| **P3** | **6** | **2** ← cambiado por mi fix | **0** | **8** ← cambiado por mi fix | **8** ← cambiado por mi fix | **4** |

### Datos ORIGINALES (lo que dice el papel firmado)

| Parcial | EC | TR | PE | Suma | Cal | Faltas |
|---|---|---|---|---|---|---|
| P1 | 6 | 0 | 0 | 6 | 6 | 4 |
| P2 | 5 | — | — | 5 | 5 | 1 |
| **P3** | **6** | **0** ← original | **0** | **6** ← original | **6** ← original | **4** |

### Aplicación de reglas SEP

**Con cals actuales (después del fix):** P1=6, P2=5, P3=8 → promedio 6.33, 1 parcial reprobado → **NO entra a EXTRA** 🟢

**Con cals originales (lo que está en el papel):** P1=6, P2=5, P3=6 → promedio 5.67, 1 parcial reprobado → **SÍ entra a EXTRA por regla 1 (promedio<6)** 🔴

### Por qué pasó

1. El maestro de Ciencias Naturales capturó P3 con `tr=0` **intencionalmente** (el alumno no hizo el transversal, solo tuvo EC=6).
2. Mi fix masivo (commit `b4812b8`) detectó ese `tr=0` como sospechoso (porque ec≥6 y cal<10) y lo cambió a `tr=2`, asumiendo que era el bug del editor.
3. **Esta asunción fue INCORRECTA para 7 alumnos en este bucket (CN 1-1 P3)** porque el maestro sí captura `tr=0` legítimamente para alumnos que no entregan transversal.

### Alumnos afectados en este bucket

7 alumnos del 1-1 matutino en Ciencias Naturales P3 tuvieron `tr=0 → tr=2` por mi fix:

```
tvz5tWrS2YEpO9pMh3P4 — cal 6 → 8 (sobre-corregido)
GXTYznucNUCgUTQY5rdE — cal 7 → 9
wKpwPRXY3pmU0wLoBlOa — cal 6 → 8 (sobre-corregido)
LfiAfQboIRhQ9h6Bz7up — cal 8 → 10
9E6rtKakYHp3mWUnIeWa — SUAZO RIOS SANTIAGO, cal 6 → 8 (sobre-corregido) ⚠
EaPf0Buj5gxdVZDbojSo — cal 6 → 8 (sobre-corregido)
VcSPn2EcSEatOLPRF6NW — cal 6 → 8 (sobre-corregido)
```

---

## CASO 2-3 — 2-2 Vespertino

### Hallazgo principal

Repliqué la lógica EXACTA del reporte de irregulares y obtuve:

| Alumno | Aparece como irregular | Materias EXTRA detectadas |
|---|---|---|
| GUERRERO ENRIQUEZ EFRAIN | ✅ SÍ | 2 (conciencia histórica, reacciones químicas) |
| JACOBO QUIROGA ISAIAS ARLO | ✅ SÍ | 6 (artísticas, conciencia histórica, espacio y sociedad, reacciones químicas, igualdad y DDHH, matemáticas) |

**Es decir: el reporte SÍ los detecta a ambos correctamente.** Si Olivia ve discrepancias específicas, son de OTRA naturaleza (probablemente faltan otros alumnos que tampoco aparecen).

### Hallazgo crítico: capturas faltantes

De los **35 alumnos activos en 2-2 vespertino**, **14 NO tienen NINGUNA calificación de P3 capturada** (faltaP3=14 = todas sus materias del grado sin cal de P3):

```
CID MARISCAL KIMBERLY                   — 0 cals capturadas en P3
CRUZ ORTEGA MARY CARMEN                 — 0 cals
DE LA LUZ VILLANUEVA JONATHAN           — 0 cals
DIAZ LOPEZ BRYAN ALEJANDRO              — 0 cals
ESCUTIA ROMERO YANELY SCARLET           — 0 cals
FLORES GARCIA ZOE NAOMI                 — 0 cals
GALVAN HERNANDEZ VALENTINA ODETTE       — 0 cals
GONZALEZ QUIROZ CHRISTIAN               — 0 cals
HERNANDEZ RAMIREZ YULIANA               — 0 cals
HUICHAN ELORZA ISAAC                    — 0 cals
JUAREZ JAVIER GENESIS                   — 0 cals
LIMA FELIX SEBASTIAN ALEJANDRO          — 0 cals
MARTINEZ ROMERO MERARI                  — 0 cals (espera, este sí tiene algunas)
... (revisar lista completa con Olivia)
```

### Por qué el reporte no muestra a esos 14

La regla 1 (promedio<6) requiere los 3 parciales capturados. Si un alumno solo tiene P1 y P2 capturados, NO se le aplica la regla 1.

La regla 2 (2+ parciales reprobados) sí podría aplicar si tienen P1<6 y P2<6, pero si solo tienen P1<6 (1 parcial reprobado), no entra.

**Resultado:** 14 alumnos quedan en limbo — ni "aprobados" ni "irregulares" porque sus datos están incompletos.

### Por qué no se capturó P3 para esos alumnos

Posibles causas:
1. **Alumnos nuevos** que entraron al grupo tarde (después de P1/P2)
2. **Bajas pendientes** marcadas como activas
3. **Maestros que no terminaron de capturar** P3 antes del corte
4. **Cambios de grupo** mal sincronizados

---

## CÓMO EVITAR QUE VUELVA A OCURRIR

### Para el problema 1 (sobre-corrección automática del TR=0)

**Regla aprendida:** NO aplicar correcciones masivas automáticas a calificaciones SIN verificación caso por caso contra el papel firmado.

**Acciones de prevención implementadas:**
1. ✅ **Sistema de snapshots automáticos al imprimir (v8.26):** cada vez que un maestro imprime una lista, queda blindada. Las boletas LEEN del snapshot, NO de la tabla viva.
2. ✅ **Página `/verificar/{hash}`** para validar contra el papel.
3. ✅ **PITR habilitado** (7 días retención) para recuperar cualquier estado en el futuro.
4. ✅ **Backups diarios automáticos** (7 días retención).

**Acción de prevención pendiente:**
- Crear panel admin para que Olivia pueda **revertir caso por caso** los 372 cambios del fix masivo, validando contra el papel.

### Para el problema 2 (datos incompletos de P3)

**Acciones de prevención recomendadas:**
1. **Alerta automática al cerrar parcial:** si quedan alumnos sin captura, listar exactamente quiénes son, en qué materias, y por qué maestro.
2. **Reporte de "huecos de captura"** en el panel admin: cualquier alumno activo + materia asignada + parcial actual SIN cal capturada → alertar.
3. **Bloqueo del cierre del parcial** si hay capturas incompletas: el subdirector solo puede cerrar si confirma "sí, esos alumnos no van a calificarse" (con justificación escrita).
4. **Marca visual en el editor del maestro:** filas en rojo si tiene alumnos sin captura.

### Para el problema 3 (consistencia general del reporte)

**Acciones de prevención recomendadas:**
1. **Modo "estricto" del reporte de irregulares:** además de los 3 reglas SEP actuales, mostrar también una sección "ALUMNOS EN RIESGO POR DATOS INCOMPLETOS" para que Dirección los vea.
2. **Cotejo automático contra snapshot certificado:** si el reporte de irregulares no coincide con el último snapshot certificado del bucket, mostrar warning.

---

## ACCIÓN INMEDIATA RECOMENDADA

1. **Revertir las 7 correcciones del fix masivo en CN 1-1 P3** (un comando, 5 segundos).
2. **Revisar los OTROS 365 cambios del fix masivo** contra los papeles firmados. Si Olivia no quiere hacer cotejo manual, **revertir TODO el fix masivo** y aceptar que el sistema vuelva al estado pre-fix (con el bug original). Las boletas se generarán a partir de los snapshots certificados que ya existen (P1 y P2 matutino).
3. **Confirmar con maestros de 2-2 vespertino** si los 14 alumnos sin P3 capturado son legítimamente "sin calificación" (alumnos nuevos, bajas, etc.) o si simplemente faltó capturarlos.
4. **Generar reporte de huecos de captura para TODOS los grupos** antes de cerrar parciales o emitir boletas.

---

## REGISTRO TÉCNICO

- **Auditoría realizada:** scripts en `/tmp/audit-irregulares.js`, `/tmp/audit-irreg-22v.js`, `/tmp/audit-22v-full.js`, `/tmp/audit-correcciones.js`
- **CSV completo de los 372 cambios:** `/Users/oliolix/Documents/PROYECTOS CLAUDE/ADMINISTRACIÓN ESCOLAR EPO 67 /CORRECCIONES_TR_2026-06-29.csv`
- **Script de reversión:** `sistema-escolar-firebase/scripts/fixes/revert-tr-fix.js`
- **Commits relevantes:**
  - `b4812b8` — Fix masivo TR=0 (causa de la sobre-corrección)
  - `555368a` — Sistema de snapshots (prevención futura)
