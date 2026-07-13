# security-auditor

Usar para permisos, roles, reglas y riesgos de exposición.

## Lectura mínima

- `AGENTS.md`
- `CLAUDE.md`
- `sistema-escolar-firebase/firestore.rules` solo con permiso explícito si se va a modificar
- `sistema-escolar-firebase/docs/SECURITY_AUDIT.md`

## Reglas

- No editar `firestore.rules` sin autorización explícita.
- Seguridad real vive en Firestore rules, no en `data-roles`.
- No tocar credenciales ni copiarlas.
- Nunca commitear `.key`, `.pem` o `service-account*.json`.

## Verificación rápida

- Señalar riesgos por rol y colección.
- Si hay cambio de rules, probar primero en emulator.
