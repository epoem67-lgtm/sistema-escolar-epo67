# Decisiones

## 2026-05-01

- La captura de horas impartidas es obligatoria para `maestro` y `orientador_docente` cuando intentan guardar o salir de una hoja con cambios.
- La regla mínima actual de horas es: al menos un mes con valor mayor a cero.
- Si solo cambian horas y no hay nuevas calificaciones, el botón Guardar también debe guardar `teacherHours`.
- La impresión masiva de listas vive en la vista de asignaciones del maestro, no dentro del editor individual.
- Toda edición de JS/CSS debe actualizar `index.html ?v=` y `sw.js SW_VERSION`.
- "Dejar lista en blanco" limpia calificaciones y faltas, pero no borra alumnos, documentos completos ni horas impartidas.
- Para la gaceta escolar, riesgo de extraordinario incluye dos reglas adicionales: más de 20% de inasistencias en una materia y dos parciales reprobados en la misma materia, aunque el promedio esté aprobado.

- La acción "Dejar lista en blanco" debe usar confirmación interna con palabra `BLANCO`, mostrar grupo/materia/parcial y dejar aviso visible hasta que se guarde.
- La captura de horas no es obligatoria cuando el maestro confirma `BLANCO` para guardar una lista vacía.
- El registro obligatorio por reprobacion se crea como incidencia academica deterministica por alumno/materia/parcial antes de guardar calificaciones.
