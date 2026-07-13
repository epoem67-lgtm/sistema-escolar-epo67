# Contexto del Software — Sistema EPO 67

> Esta carpeta es una **copia limpia solo del código fuente** del sistema.
> Sirve para dar contexto a agentes IA sin exponer datos de la escuela
> (alumnos, calificaciones, listas oficiales, backups, etc).

## Qué incluye

| Ruta | Contenido |
|---|---|
| `CLAUDE.md` | Descripción general del proyecto, stack, módulos, roles |
| `AGENTS.md` | Reglas inviolables para agentes IA que trabajen en el código |
| `sistema-escolar-firebase/public/` | Código frontend completo (HTML, CSS, JS SPA) |
| `sistema-escolar-firebase/docs/` | Arquitectura, convenciones, auditoría de seguridad, troubleshooting |
| `sistema-escolar-firebase/scripts/` | Scripts admin (audits / fixes / migrations) |
| `sistema-escolar-firebase/firestore.rules` | Reglas de seguridad de Firestore |
| `sistema-escolar-firebase/firestore.indexes.json` | Índices de Firestore |
| `sistema-escolar-firebase/firebase.json` | Configuración de Firebase Hosting |

## Qué NO incluye (intencionalmente)

- Datos de alumnos, calificaciones, asistencias (viven en Firestore, no en el repo)
- Listas oficiales en Excel de TURNO MATUTINO / VESPERTINO
- Backups de calificaciones (`_RESPALDOS/`, `Calificaciones/`)
- Archivos del sistema de agentes (`_AGENTE/`, `_PROYECTO/`)
- Reportes y auditorías en Excel
- `node_modules/`, credenciales, `.env`

## Stack del sistema

- **Frontend:** Vanilla JavaScript SPA (sin React/Vue/frameworks)
- **Backend:** Firebase Hosting + Firestore + Auth Google
- **Sin build tools** (se sirve el JS tal cual)
- **Firebase SDK:** compat v8 (no migrado aún a modular v9)

## Puntos de entrada para entender el código

1. **Empieza por:** `CLAUDE.md` → panorama general
2. **Arquitectura:** `sistema-escolar-firebase/docs/ARCHITECTURE.md` → capas, patrón IIFE
3. **Convenciones:** `sistema-escolar-firebase/docs/CONVENTIONS.md` → estilos, nombres, Firestore
4. **SPA:** `sistema-escolar-firebase/public/index.html` → shell; `public/js/app.js` → core
5. **Módulos:** `sistema-escolar-firebase/public/js/modules/*.js` → 23 módulos IIFE auto-registrados
6. **Seguridad:** `sistema-escolar-firebase/firestore.rules` + `docs/SECURITY_AUDIT.md`

## Versión de referencia

v5.9.14 (al momento de esta copia).

## Nota importante

Si el agente modifica algo aquí, **no tendrá efecto en producción** — esta es una
copia inerte para contexto. Los cambios reales se hacen en
`sistema-escolar-firebase/` (una carpeta arriba).
