# Scripts de administración — Sistema EPO 67

Scripts Node.js de ejecución puntual contra Firestore (vía `firebase-admin` o REST).
**No se ejecutan en producción** — son herramientas de mantenimiento.

## Prerequisitos

```bash
npx firebase-tools projects:list   # refresca el token OAuth
cd sistema-escolar-firebase
node scripts/<categoria>/<script>.js
```

El token de Firebase expira. Si un script falla silenciosamente, refresca el token.

## Estructura

### `audits/` — Auditoría (solo lectura)
Verifican consistencia de datos sin modificar nada. **Siempre ejecutar primero.**

| Script | Propósito |
|---|---|
| `audit-teachers.js` | Busca docentes duplicados y desajustes entre `teachers.nombre` y `assignments.teacherName` |
| `diagnose-grades.js` | Detecta calificaciones faltantes, default 5.0, o inconsistencias por parcial |

### `fixes/` — Correcciones idempotentes
Modifican datos. Diseñados para ser seguros si se re-ejecutan.

| Script | Propósito |
|---|---|
| `fix-assignment-names.js` | Resincroniza `assignment.teacherName` con el nombre actual del docente (53 registros corregidos en v5.8) |
| `fix-all-grades.js` | Reemplaza calificaciones por defecto (5.0) con valores reales |
| `fix-claudia-dania.js` | One-off: corrigió homologación Claudia Meléndez / Dania Gutiérrez |
| `fix-ximena-grades.js` | One-off: calificaciones faltantes de Ximena |
| `fix-final-missing.js` | Calificaciones finales faltantes de parciales cerrados |

### `migrations/` — Migraciones de datos únicas
**Ejecutar solo una vez por ciclo escolar.**

| Script | Propósito |
|---|---|
| `extract-grades.js` | Extrae calificaciones desde archivos Excel de TURNO MATUTINO/VESPERTINO |
| `migrate-from-drive.js` | Importó 73 hojas de Google Drive al arranque inicial |
| `migrate-grades.js` | Bulk upload de calificaciones extraídas |
| `migrate-p1.js` | Migración específica de Parcial 1 al inicio del ciclo |
| `create-teacher-users.js` | Genera cuentas Firebase Auth + docs `users/{uid}` con `role='maestro'` y `teacherId` para todos los docentes activos. Idempotente. Soporta `--dry-run` y `--only=<teacherId>`. Produce CSV con credenciales temporales (`credenciales-docentes-FECHA.csv`, chmod 600, en `.gitignore`). |

## Convenciones para nuevos scripts

1. **Nombre**: `<accion>-<alcance>.js` (p.ej. `fix-duplicate-groups.js`)
2. **Categoría**: audits (lee) / fixes (escribe, idempotente) / migrations (escribe, única)
3. **Salida**: usar `console.log` con contadores `{ actualizadas, errores, omitidas }`
4. **Dry-run opcional**: soportar `DRY_RUN=1 node script.js` antes de escribir
5. **Documentar aquí**: agregar fila a la tabla correspondiente
6. **NO commitear credenciales**: usar Application Default Credentials de firebase-tools

## Pendientes conocidos

- Ninguno de estos scripts tiene tests.
- `fixes/fix-*.js` one-off podrían archivarse en `_archive/` después del cierre del ciclo 2025-2026.
