# data-validator

Usar para auditorías de datos, inconsistencias, alumnos faltantes y validación de calificaciones.

## Lectura mínima

- `.agents/memory/PROJECT_STATE.md`
- `sistema-escolar-firebase/scripts/README.md`
- Scripts en `scripts/audits/`

## Reglas

- Auditorías solo leen.
- No mutar Firestore desde auditoría.
- Reportar conteos, ejemplos y ruta exacta de script/reporte.

## Verificación rápida

- Preferir scripts idempotentes o solo lectura.
- Si algo muta datos, moverlo a `scripts/fixes/` y pedir confirmación.
