# Estado Vivo del Proyecto

Actualizado: 2026-05-01

## Proyecto

Sistema Escolar EPO 67. App SPA vanilla JS desplegada en Firebase Hosting con Firestore/Auth.

## Estado reciente

- Trabajo activo en `sistema-escolar-firebase/public/js/modules/grades.js`.
- Se agregó obligación de capturar horas impartidas para maestros antes de guardar o salir de una hoja con cambios.
- Se agregó panel para imprimir listas de calificaciones en lote: todas o seleccionadas por parcial.
- Se agregó botón para dejar en blanco calificaciones/faltas de la lista actual sin borrar alumnos ni horas.
- Se reemplazó la alerta nativa de "Dejar lista en blanco" por modal interno con confirmación escrita `BLANCO` y aviso visible de guardado pendiente.
- Al guardar una lista en blanco, no se exige capturar horas impartidas.
- Al guardar calificaciones, los maestros deben registrar motivo breve para alumnos reprobados antes de completar el guardado.
- Se cambió la navegación entre listas a selector con explicación de estados: Completa, En captura, Sin captura.
- Se mejoró la visibilidad de los campos de horas impartidas.
- Se actualizó riesgo escolar: más de 20% de inasistencias por materia y dos parciales reprobados en una misma materia se marcan como riesgo de extraordinario.
- Se actualizó cache a `?v=5.16` y `SW_VERSION = v5.16-failure-incidents`.
- Servidor local activo en `http://localhost:5173` durante esta sesión.

## Archivos modificados en la sesión

- `sistema-escolar-firebase/public/js/modules/grades.js`
- `sistema-escolar-firebase/public/js/modules/at-risk.js`
- `sistema-escolar-firebase/public/css/styles.css`
- `sistema-escolar-firebase/public/index.html`
- `sistema-escolar-firebase/public/sw.js`

## Verificación hecha

- `node --check sistema-escolar-firebase/public/js/modules/grades.js`
- `node --check sistema-escolar-firebase/public/js/modules/at-risk.js`
- `node --check sistema-escolar-firebase/public/sw.js`
- `curl -I http://localhost:5173/index.html`

## Pendiente recomendado

- Probar en navegador con sesión real de maestro:
  - Guardar sin horas debe bloquear y mostrar modal.
  - Cambiar de lista/parcial sin horas y con cambios debe bloquear.
  - Capturar solo horas y guardar debe persistir `teacherHours`.
  - Imprimir seleccionadas y todas debe abrir un solo documento de impresión.
  - Dejar lista en blanco debe limpiar calificaciones/faltas y persistir al guardar.
  - La confirmación debe mostrar grupo, materia y parcial dentro del sistema, no con `confirm()` del navegador.
  - Actualizar detección de riesgo debe marcar motivos por faltas +20% y dos parciales reprobados.
- Si se despliega, usar `cd sistema-escolar-firebase && npx firebase-tools deploy --only hosting`.

## Precauciones

- Hay cambios no committeados en el repo.
- No tocar `firestore.rules` sin permiso explícito.
- No ejecutar scripts que muten Firestore sin commit previo y confirmación.
