# Troubleshooting — EPO 67

## Firebase scripts fallan silenciosamente

**Síntoma:** Script de admin corre sin errores pero no modifica datos.
**Causa:** Token OAuth expirado.
**Fix:**
```bash
npx firebase-tools projects:list
# Si pide login, autenticar y reintentar
```

## Cambios de JS no aparecen en el navegador

**Causa:** Cache de navegador o de Cloudflare.
**Fix:**
1. Subir versión en `public/index.html`: `?v=X.Y` → `?v=X.Y+1`.
2. Redesplegar: `npx firebase-tools deploy --only hosting`.
3. Hard refresh: Cmd+Shift+R / Ctrl+Shift+F5.

## Calificaciones muestran 5.0 en alumnos con datos reales

**Causa:** Datos por defecto (placeholder) persistidos en Firestore.
**Fix:** Ejecutar `scripts/audits/diagnose-grades.js` para identificar, luego `scripts/fixes/fix-all-grades.js` con datos reales desde Excel.

## Nombres de maestros incompletos en calificaciones / reportes

**Causa:** Denormalización stale — `assignment.teacherName` no actualizado tras editar `teachers.nombre`.
**Fix:** `node scripts/fixes/fix-assignment-names.js` (ya ejecutado en v5.8).

## "const reassignment" error al editar module

**Causa:** `replace_all` accidental convirtió `const x = ...` en reasignación.
**Fix:** Revisar diff del último cambio; usar `let` si debe reasignarse o recalcular inline.

## Admin no puede entrar / rules bloquean todo

**Causa:** Deploy de `firestore.rules` mal configurado.
**Fix rápido:**
1. Desde Firebase Console → Firestore → Rules, revertir manualmente.
2. O desde CLI: `git checkout HEAD~1 firestore.rules && npx firebase-tools deploy --only firestore:rules`.

**Prevención:** Antes de tocar rules, probar con emulator:
```bash
npx firebase-tools emulators:start --only firestore
```

## Nombre de carpeta con tildes rompe scripts

**Síntoma:** Comandos `cd` fallan, scripts no encuentran path.
**Causa:** "ADMINISTRACIÓN" tiene carácter Unicode.
**Fix:** Usar comillas dobles alrededor de rutas completas, o `cd` por tramos:
```bash
cd "/Users/oliolix/Documents/PROYECTOS CLAUDE/ADMINISTRACIÓN ESCOLAR EPO 67 "
```

## Window.open bloqueado al generar múltiples PDFs

**Causa:** Chrome bloquea más de 1 `window.open` por interacción.
**Fix:** Generar un único documento HTML con todas las páginas usando page-break CSS, luego un solo `window.open`.

## Emoji aparece como `\uXXXX` literal

**Causa:** Doble escape en string literal (`\\u{1F3C6}`).
**Fix:** Usar surrogate pairs directos: `'\uD83C\uDFC6'`.

## Calificaciones después de cerrar parcial cambiaron solas

**Causa imposible en v5.9+:** Las rules bloquean escritura cuando `partials/{id}.locked == true`. Si ocurre, revisar `activityLog` y `gradeCorrections` — alguien con rol admin o directivo hizo la corrección con trazabilidad.

## "Error: permission-denied" para maestro que sí tiene el grupo

**Causa común:** `assignmentsByGroup/{groupId}_{teacherId}` no existe (índice no generado).
**Fix:** Al crear `assignments/{teacherId}_{groupId}_{subjectId}`, también crear `assignmentsByGroup/{groupId}_{teacherId}` con `{ teacherId, groupId }`. Revisar `teachers.js` función de asignación.
