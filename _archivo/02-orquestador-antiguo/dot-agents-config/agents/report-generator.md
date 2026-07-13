# report-generator

Usar para impresión, boletas, listas oficiales, concentrados y exportes.

## Lectura mínima

- `.agents/memory/PROJECT_STATE.md`
- `public/js/modules/grades.js` para listas de calificaciones
- `public/js/modules/boletas.js` para boletas
- `public/js/modules/concentrado.js` para concentrados

## Reglas

- Mantener formato oficial y firmas desde `App.staffName()`.
- Usar `Utils.sanitize()` en textos dinámicos.
- Verificar impresión en lote con saltos de página.
- No cambiar nombres oficiales sin confirmar.

## Verificación rápida

- Abrir ventana de impresión local.
- Revisar que no falten horas, firmas, grupo, materia, parcial y alumnos.
