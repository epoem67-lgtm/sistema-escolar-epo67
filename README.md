# Sistema Escolar EPO 67 — README maestro

> **Si tienes que retomar el proyecto desde cero**, lee esto primero. Es la guía mínima para entender qué hay, qué corre, y cómo deployar.

---

## Qué es

Sistema de administración escolar para la **Escuela Preparatoria Oficial Núm. 67** (Cuautitlán Izcalli, Edo. Méx.). SPA en vanilla JavaScript sobre Firebase (Hosting + Firestore + Auth).

- **URL producción:** https://epo67-sistema.web.app
- **Proyecto Firebase:** `epo67-sistema`
- **Cuenta Firebase:** epoem67@gmail.com
- **Repo GitHub:** https://github.com/devdaalper/sistema-escolar-epo67 (privado)
- **Responsable:** Olivia Peña (admin del sistema, también docente)
- **Ciclo escolar:** 2025‑2026 · ~811 alumnos, 60 docentes, 18 grupos

---

## Cold start en 5 pasos

Si te llega esta carpeta nueva (otra Mac, otro dev), esto es **todo** lo que necesitas:

```bash
# 1. Clonar (si vienes de GitHub) o entrar a la carpeta
cd "ADMINISTRACIÓN ESCOLAR EPO 67"

# 2. Instalar Firebase CLI globalmente (una sola vez)
npm install -g firebase-tools

# 3. Login con la cuenta del proyecto
npx firebase-tools login   # usar: epoem67@gmail.com

# 4. Entrar al código activo
cd sistema-escolar-firebase

# 5. Deploy (cualquier cambio en /public se publica con esto)
npx firebase-tools deploy --only hosting
```

Eso es todo. La página estará en https://epo67-sistema.web.app

### Antes de deployar (si tocaste JS/CSS)
Bumpea estas 3 referencias para que el Service Worker no sirva cache viejo:
- `sistema-escolar-firebase/public/sw.js` → constante `SW_VERSION`
- `sistema-escolar-firebase/public/index.html` → `<meta name="app-version">`
- `sistema-escolar-firebase/public/index.html` → `?v=X.Y` del JS modificado

---

## Mapa del repo

```
ADMINISTRACIÓN ESCOLAR EPO 67/
├── README.md                   ← Este archivo. Léelo primero.
├── CLAUDE.md                   ← Reglas y arquitectura para agentes IA / devs nuevos
├── AGENTS.md                   ← Reglas inviolables para agentes IA
├── ESTADO_DE_PROYECTO.md       ← Historial de versiones y decisiones
├── .claude/                    ← Config de Claude Code + skill epo67-sistema
├── sistema-escolar-firebase/   ← 🟢 CÓDIGO ACTIVO — el único que importa
└── _archivo/                   ← Todo lo legacy (HTMLs viejos, datos fuente, etc.)
```

### Dentro de `sistema-escolar-firebase/`

```
sistema-escolar-firebase/
├── firebase.json               ← Config de hosting
├── firestore.rules             ← 🔒 Reglas de seguridad de Firestore
├── public/
│   ├── index.html              ← Entry point + meta app-version
│   ├── sw.js                   ← Service Worker (SW_VERSION)
│   ├── css/styles.css
│   └── js/
│       ├── app.js              ← Core SPA (App, Auth, Router, Modal, Toast)
│       ├── constants.js        ← K.* (parciales, turnos, materias SEP, umbrales)
│       ├── data-store.js       ← Store.* (cache de Firestore role-aware)
│       ├── components.js       ← UI.*
│       └── modules/            ← Cada módulo IIFE auto-registrado en Router
└── scripts/
    ├── migrations/             ← create-teacher-users, merge-duplicates, etc.
    ├── fixes/                  ← Correcciones puntuales (idempotentes)
    └── audits/                 ← Auditorías solo-lectura
```

---

## Cuentas y credenciales clave

| Persona | Rol en sistema | Email | Notas |
|---|---|---|---|
| Olivia Peña Ramírez | `admin` | olivia.admin@epo67.local | Admin del sistema + docente |
| Dra. Karina Laguerenne | `admin` | (directora) | Directora Escolar |
| Profr. Octavio Vázquez | `admin` | octavio.subdirector@epo67.local | Subdirector |
| Profr. Roberto Palomares | `admin` | (secretario) | Secretario Escolar |
| Lupita | `directivo` | (secretaria admin) | Lectura + reportes |
| Jessica Alcántara | `maestro` + `auditor` | (auditor scope global) | Lee todo, edita solo SUS materias |

Roles disponibles: `admin`, `subdirector` (legacy), `directivo`, `orientador`, `orientador_docente` (híbrido), `maestro`, `consulta`. Aditivos: `auditor`, `presidente_academia`.

**Token Firebase para scripts admin:** se obtiene con `npx firebase-tools projects:list` y queda en `~/.config/configstore/firebase-tools.json`. Los scripts de `scripts/audits/` y `scripts/fixes/` lo leen de ahí.

---

## Documentación de referencia (en este orden)

1. **`CLAUDE.md`** — Arquitectura completa, convenciones, patrones de módulo, helpers Store/App, rubros de evaluación, roles, etc. **Leer obligatorio antes de tocar código.**
2. **`AGENTS.md`** — Reglas inviolables (no romper firestore.rules, no commitear sin tests, etc.).
3. **`ESTADO_DE_PROYECTO.md`** — Historial: qué se hizo en cada versión, decisiones, casos peculiares (apellidos compuestos, orientador híbrido, etc.).
4. **`.claude/skills/epo67-sistema/SKILL.md`** — Skill cargado por Claude Code con contexto del proyecto.

---

## Operaciones más comunes

### Despliegue (ya cubierto arriba)
```bash
cd sistema-escolar-firebase
npx firebase-tools deploy --only hosting
```

### Forzar refresh en todos los navegadores tras deploy
Bumpear `SW_VERSION` en `public/sw.js` + `?v=` en `index.html` + meta `app-version`.

### Reset password de un usuario
Usar Firebase Auth Console o Admin SDK desde `scripts/migrations/`.

### Crear usuarios nuevos para docentes
```bash
cd sistema-escolar-firebase
node scripts/migrations/create-teacher-users.js          # dry-run
node scripts/migrations/create-teacher-users.js --apply  # ejecuta
```

### Auditorías típicas
```bash
node scripts/audits/audit-numero-lista.js    # duplicados/bajas mal filtradas
node scripts/audits/audit-teachers.js        # estado de docentes
node scripts/audits/diagnose-grades.js       # promedios inconsistentes
```

---

## Convenciones de Git

```
[modulo/area] Descripción concisa (imperativo)

Ejemplos:
  [boletas] Fix: descarga masiva respeta grupos del orientador
  [grade-corrections] Forzar lectura del servidor tras aplicar
  [data-store] getMyAssignments role-aware
  [v7.82] Bump versions tras refresh de panel
```

---

## ¿Y la carpeta `_archivo/`?

Contiene todo lo que **ya no se usa pero no se borra** (HTMLs del sistema monolítico antes de migrar a Firebase, agentes antiguos, datos fuente xlsx de la importación inicial, etc.). Tiene su propio `_archivo/README.md` que explica qué hay en cada subcarpeta.

Cuando ya no necesites historia, puedes borrarla entera sin afectar al sistema activo.

---

## Notas importantes

- ⚠️ **El nombre de la carpeta raíz tiene caracteres Unicode** (`ADMINISTRACIÓN` con tilde) **y un espacio final** (`EPO 67 `). Algunos terminales se quejan. Usa comillas siempre.
- ⚠️ Firebase Storage **NO** está configurado (la subida de logos no funciona).
- ⚠️ Firebase SDK usa **compat (v8)**. Pendiente migrar a modular (v9).
- ✅ El sistema funciona en producción y procesa ~811 alumnos en 3 parciales por semestre.
