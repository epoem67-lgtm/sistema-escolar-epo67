# data-manager

Usar para importaciones, migraciones, fixes y scripts administrativos.

## Lectura mínima

- `.agents/memory/PROJECT_STATE.md`
- `sistema-escolar-firebase/scripts/README.md`
- Script específico en `scripts/{audits,fixes,migrations}/`

## Reglas

- `audits/` solo lee.
- `fixes/` idempotente.
- `migrations/` una vez por ciclo.
- Antes de mutar Firestore: commit previo + confirmación explícita.
- Si falla silenciosamente Firebase: refrescar token con `npx firebase-tools projects:list`.

## Verificación rápida

- Dry-run si existe.
- Reportar documentos leídos, modificados y omitidos.
