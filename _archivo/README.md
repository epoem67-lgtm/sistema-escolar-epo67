# `_archivo/` — Material legacy del proyecto

Esta carpeta agrupa **todo lo que ya no se usa** pero se conserva por historia, referencia o respaldo. Si necesitas espacio, puedes borrarla entera sin afectar al sistema en producción (`sistema-escolar-firebase/`).

Última reorganización: **2026-06-01** (v7.82).

---

## Mapa

### `01-codigo-monolitico/` — Sistema HTML pre-Firebase
El sistema antes de migrar a Firebase era **un solo HTML monolítico** con vanilla JS, Chart.js, SheetJS y localStorage. Lo migramos a SPA Firebase a mediados de 2025.

- `respaldos/` — HTMLs versionados (v5, v13) + `DOCUMENTACION_SISTEMA_EPO67.md` (la doc del sistema viejo) + `SCRIPT_CONSOLIDADOR_EPO67.js` + `skill-epo67/`
- `entregable-html-v13/` — Última versión del HTML monolítico que se entregó
- `sistema-html-antiguo/` — Otra copia del HTML viejo + skill viejo

> **No corre nada de esto en producción.** Toda la lógica está reescrita en módulos JS bajo `sistema-escolar-firebase/public/js/modules/`.

### `02-orquestador-antiguo/` — Sistema de agentes IA previo
Antes de usar **Claude Code skills** (en `.claude/skills/epo67-sistema/`), hubo dos intentos de arquitectura de agentes:

- `_AGENTE/` — Orquestador con subagentes (data-manager, data-validator, report-generator, security-auditor, system-builder). Tenía `SKILL.md`, `ARQUITECTURA_ORQUESTADOR.md`, `scripts/` Python, `referencias/`.
- `dot-agents-config/` — Otra iteración (`.agents/`) con `agents/`, `skills/`, `memory/`, `README.md`.

> **Reemplazados por** `.claude/skills/epo67-sistema/SKILL.md` (skill activo de Claude Code) + Anthropic Skills bundled.

### `03-contexto-software-duplicado/`
- `_SOFTWARE_CONTEXTO/` — Era un snapshot duplicado de `sistema-escolar-firebase/` (1.4 MB) + copias desactualizadas de `CLAUDE.md`, `AGENTS.md`, `README_CONTEXTO.md`. Se mantenía como "contexto para que un agente IA tuviera todo a la mano". Innecesario porque el código real ya está en `sistema-escolar-firebase/`.

### `04-carpetas-vacias/`
- `_MEMORIA/datos/` — Vacía. Iba a ser memoria persistente del agente; nunca se llenó.
- `_PROYECTO/{documentacion,scripts}/` — Carpetas creadas al iniciar el proyecto, nunca poblaron contenido. Solo tenían xlsx iniciales (ya movidos a `05-datos-fuente-xlsx/`).

### `05-datos-fuente-xlsx/` — Datos originales antes de la importación a Firestore
xlsx con los rosters, calificaciones y links que se importaron al sistema en mar‑abr 2025. **Toda esta información está ahora en Firestore** (colecciones `students`, `teachers`, `grades`, `groups`).

- `turno-matutino/` — Controles de evaluaciones y F1 por grado del matutino
- `turno-vespertino/` — Idem vespertino
- `calificaciones-originales/` — Listas por docente que se usaron como fuente
- `1-1-cuadro-calificaciones.xlsx`, `LINKS-PRIMER-PARCIAL.xlsx`, `celdas-editables-matutino.xlsx`, `links-controles.xlsx` — sueltos de raíz
- `VISTA_PREVIA_LISTA_1-1_55alumnos.pdf` — Mockup inicial del formato de listas

> **Útiles si** alguna vez hay que re-importar desde cero, hacer auditoría histórica, o reconstruir un grupo. **No tocar** para operación normal.

---

## ¿Puedo borrar `_archivo/`?

Sí, pero con cautela:

| Subcarpeta | ¿Seguro borrar? |
|---|---|
| `01-codigo-monolitico/` | Sí, si nunca vas a volver al HTML viejo. |
| `02-orquestador-antiguo/` | Sí, el skill activo está en `.claude/skills/`. |
| `03-contexto-software-duplicado/` | Sí, era duplicado. |
| `04-carpetas-vacias/` | Sí, están vacías. |
| `05-datos-fuente-xlsx/` | **Conservar**. Si re-importas datos algún día, son la fuente original. |

Recomendación: **conserva todo hasta cerrar el ciclo escolar 2025‑2026**. Después, archiva `_archivo/` en cloud (Drive/iCloud) y borra del repo.
