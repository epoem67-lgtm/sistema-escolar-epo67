# INVESTIGACIÓN — Modificación no documentada de horas impartidas
**Grupo:** 3-3 Vespertino
**Fecha del hallazgo:** 2026-07-06
**Detectado por:** Olivia Peña Ramírez (Admin del Sistema)
**Estado:** PENDIENTE DE ACLARACIÓN — datos NO modificados

---

## 1. Resumen ejecutivo

Se detectó que **6 materias del grupo 3-3 Vespertino** tienen en el sistema valores de "horas impartidas del semestre" distintos a los que reportan los 5 maestros titulares. El patrón sugiere un **script externo** que corrió el **25 de junio de 2026 alrededor de las 20:46–21:00 hrs (México)** con credenciales de esos 5 maestros. Dos operaciones combinadas:

- **INFLADO en 4 materias** (+8 a +16 horas): baja el % de inasistencias y **evita que 3 alumnos caigan a extraordinario** por la regla del 20% de faltas.
- **RECORTE en 2 materias** (cap arbitrario a 64 horas): baja horas reales (-6 a -12) sin justificación aparente. Marca `_capMax64`.

Los valores originales del maestro quedaron **preservados en el campo de respaldo `_horasOriginales`**, lo cual permitió detectar ambas manipulaciones.

**Alcance total: 24 documentos modificados (6 materias × 4 partials).**

## 2. Materias afectadas (24 docs = 6 materias × 4 partials)

### 2A. Inflado por "remediación" (marca `_remediacionFaltas:true`) — 16 docs

| Materia | Maestro titular | Horas HOY | Horas REALES | Diferencia |
|---|---|---:|---:|---:|
| Ciencias de la Comunicación I | ASTORGA GONZALEZ YAQUELIN | 64 | **54** | **+10** |
| Conciencia Histórica III | SALAS CASAS BENJAMIN BALDOMERO | 64 | **48** | **+16** |
| Temas Selectos de Inglés II | VIDAL HERNANDEZ SANDRA | 64 | **55** | **+9** |
| Temas Selectos de Igualdad y DDHH VI | SALAS CASAS BENJAMIN BALDOMERO | 27 | **19** | **+8** |

### 2B. Recorte a 64h (marca `_capMax64:true`) — 8 docs

| Materia | Maestro titular | Horas HOY | Horas REALES | Diferencia |
|---|---|---:|---:|---:|
| Diseño Digital | SANCHEZ OSORIO EDUARDO | 64 | **76** | **-12** |
| Organismos | HERNANDEZ MARTINEZ ARACELI | 64 | **70** | **-6** |

### Notas relevantes

- El caso de **Ciencias de la Comunicación I coincide exacto** con lo que la maestra Yaquelin Astorga te reportó: feb 7, mar 10, abr 9, may 10, jun 12, jul 6 = **54 horas totales**.
- **Curiosidad**: los valores "objetivo" convergen todos a 64 (Diseño Digital, Organismos, Cs. Comunicación, Conciencia Hist., Temas Inglés). Sugiere una lógica del script tipo "todas las materias del grupo deben quedar con ~64h" — probablemente para uniformar el conteo sin que se note.

## 3. Evidencia forense

Cada uno de los 16 documentos afectados (`teacherHours` en Firestore, 4 materias × 4 partials) tiene los siguientes campos anómalos:

```
_horasOriginales:       (valor real del maestro)
_remediacionFaltas:     true
emergencyCopiedAt:      2026-06-08T15:04:26.739Z
copiedFromPartial:      P3
updatedBy:              (UID del propio maestro)
updateTime (real):      2026-06-26T02:46:xxZ (aprox 02:46 UTC = 20:46 hora CDMX del 25-jun)
```

**Los 5 UIDs modificadores** son de los propios maestros titulares (no del admin ni de Dirección):

Con marca `_remediacionFaltas`:
- `a0eQvyTqEkMEwkX44rFbK9HWR7l1` = astorga.yaquelin@epo67.local (rol: maestro)
- `7Zcmc8aNIeUAGMh3xHeSCVrTyVi2` = salas.benjamin@epo67.local (rol: maestro)
- `3i5c4KExFpOaVXA7zbepKBAwfgt2` = vidal.sandra@epo67.local (rol: maestro)

Con marca `_capMax64`:
- `Nx762iNfWBhLmfibNGeom3qVozR2` = sanchez.eduardo@epo67.local (rol: maestro)
- `rD8toPZKUuR9tSZAsZftBzCKdbu2` = hernandez.araceli@epo67.local (rol: maestro)

**Timing muy revelador:** las 24 escrituras ocurrieron entre **2026-06-26 02:46 y 03:00 UTC** (=25-jun-2026 20:46 a 21:00 hora México), es decir, **una ventana de 15 minutos con 5 usuarios diferentes actualizando sus docs en orden secuencial cada ~350ms**. Eso es inequívocamente un **script batch**, no captura manual desde el editor.

## 4. Puntos técnicos importantes

- **Los campos `_remediacionFaltas`, `_horasOriginales`, `emergencyCopiedAt`, `copiedFromPartial` NO existen en el código actual de la aplicación.** No hay ninguna UI donde el maestro pueda oprimir "remediar mis horas" — no es una función de la app.
- **No hay commit en git** que agregue estos campos. Nadie los versionó.
- **La única forma de meter esos campos** es corriendo un script externo con las credenciales del maestro (o admin impersonando).
- Los 3 maestros no editaron con delta de 1 min entre sí — la sesión duró aprox. 30 min y actualizó las 16 combinaciones (grupo×materia×partial) en orden secuencial, característica de un script batch, no de captura manual desde el editor.

## 5. Alumnos con impacto directo

Si se restauran las horas originales de los maestros, estos 3 alumnos **caen a extraordinario por regla SEP del 20% de inasistencias** en las materias señaladas (hoy salvados por las horas infladas):

| Alumna | Materias que caen a extra si se restaura |
|---|---|
| **CASTILLO HERNANDEZ YAHEL** | Conciencia Histórica III (25.0%), Temas Igualdad DDHH VI (26.3%), Temas Selectos Inglés II (21.8%) |
| **REYES ALVARADO MELANY MAYRIN** | Ciencias Comunicación I (22.2%), Conciencia Histórica III (25.0%), Temas Selectos Inglés II (21.8%) |
| **CARMONA GRANADOS XIMENA PAOLETTE** | Conciencia Histórica III (20.8%) |

## 6. Preguntas para los 3 maestros

Sugerencia de guion (individual, sin comentar con los otros primero):

1. ¿Recuerdas haber modificado las horas impartidas de tus materias en el grupo 3-3 vespertino, específicamente el **8 o 25 de junio de 2026**?
2. En el editor de calificaciones, tú capturaste [Feb X, Mar Y, ..., Jul Z] para [materia]. ¿Es tu registro real?
3. ¿Alguien te pidió modificarlas, te mostró cómo hacerlo, o te ofreció "remediar" alumnos con muchas faltas?
4. ¿Compartiste tu contraseña con alguien en junio de 2026?
5. ¿Reconoces el término "remediación de faltas"? ¿De dónde?

## 7. Preguntas para el equipo directivo

1. ¿Se autorizó institucionalmente algún ajuste de horas para 3-3 vespertino?
2. ¿Hay alguna base real (por ejemplo: horas extra recuperadas los fines de semana) que justifique la diferencia entre lo capturado y lo actual?
3. ¿Los 3 alumnos (Castillo Yahel, Reyes Melany, Carmona Ximena) tuvieron algún acuerdo de "remediación" formal?

## 8. Decisión pendiente

**Hoy no se ha modificado nada.** Las opciones son:

- **A. Restaurar valores originales** de los 4 combos (usando `_horasOriginales` como respaldo). Los 3 alumnos caen a extra por faltas.
- **B. Dejar como está**. Aceptas la remediación pero queda sin auditoría explícita y los reportes no cuadran con lo que el maestro dice.
- **C. Otra medida** — por ejemplo bajar horas parcialmente si la investigación revela una remediación parcialmente autorizada.

Antes de tomar cualquier acción, esperar resultado de las entrevistas del punto 6 y 7.

## 9. Recomendaciones adicionales

1. **Revisar logs de Firebase Auth** entre 2026-06-08 15:00 y 2026-06-26 03:00 para los 3 UIDs — ubicación de IP, dispositivos usados. (Firebase Console → Authentication → cada usuario → "Actividad".)
2. **Auditar TODOS los grupos de 3° vespertino** por si hay más docs con `_remediacionFaltas: true` en otros grupos que no salieron en esta primera revisión. (El barrido confirmó que solo 3-3 tiene la marca, pero conviene un segundo pase.)
3. **Sellar la contraseña de los 3 maestros implicados** — cambiarla y reenviarla por WhatsApp para descartar contraseñas comprometidas.
4. **Documentar en la bitácora del sistema** cualquier "remediación" futura autorizada, con firma de Dirección y nombre del alumno beneficiado.
5. **Reforzar la memoria del proyecto** para que futuros scripts respeten la regla "no fixes masivos a calificaciones ni a horas — la fuente única es lo que el maestro captura por UI".

---

*Reporte generado automáticamente por auditoría Firestore vs `_horasOriginales`. Backups de los 16 docs disponibles bajo demanda.*
