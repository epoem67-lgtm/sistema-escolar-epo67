# Auditoría de Seguridad — EPO 67

**Fecha:** 2026-04-16
**Versión del sistema:** v5.9
**Scope:** `firestore.rules`, autenticación, exposición de datos, XSS, manejo de tokens.

## Resumen ejecutivo

| Severidad | Hallazgos |
|---|---|
| 🔴 Crítico | 2 |
| 🟠 Alto | 3 |
| 🟡 Medio | 4 |
| 🟢 Bajo | 3 |

**Sistema funcional pero con vectores de escalación de privilegios reales.** Los hallazgos críticos se recomienda corregir antes del siguiente despliegue a admins externos.

---

## 🔴 CRÍTICO

### C-1. Bootstrap de usuario permite auto-asignación de rol admin

**Archivo:** `firestore.rules:51-53`

```
allow create: if isAuthenticated()
  && request.auth.uid == userId
  && !exists(/databases/$(database)/documents/users/$(userId));
```

**Problema:** Cualquier usuario con Google Auth puede crear su propio `users/{uid}` con `role: 'admin'` en su primer login. No hay validación del campo `role` en la creación.

**Explotación:** Un usuario malicioso con cualquier cuenta Google, si no tiene doc previo, puede escribir `{ role: 'admin' }` y obtener control total.

**Mitigación recomendada:**
```
allow create: if isAuthenticated()
  && request.auth.uid == userId
  && !exists(/databases/$(database)/documents/users/$(userId))
  && request.resource.data.role in ['consulta'];  // forzar rol mínimo
```
O eliminar bootstrap automático y crear usuarios solo desde admin.

---

### C-2. Maestros pueden escribir calificaciones de cualquier grupo/materia

**Archivo:** `firestore.rules:110-118`

```
allow create: if isAuthenticated() && (
  isAdmin() ||
  (isMaestro() && !isPartialLocked(request.resource.data.partial))
);
```

**Problema:** La regla solo valida que el parcial esté abierto. **No valida** que el maestro esté asignado a ese grupo+materia. Cualquier maestro autenticado puede escribir calificaciones de cualquier alumno.

**Mitigación recomendada:** agregar check de asignación:
```
&& exists(/databases/$(database)/documents/assignments/$(getTeacherId() + '_' + request.resource.data.groupId + '_' + request.resource.data.subjectId))
```

---

## 🟠 ALTO

### A-1. Asistencia: sin validación por grupo del maestro
**`firestore.rules:174-178`.** Cualquier maestro puede registrar/modificar asistencia de cualquier grupo. Mismo patrón que C-2.

### A-2. `gradeCorrections` sin validación de payload
**`firestore.rules:197-201`.** Directivos pueden crear correcciones sin validar que `studentId`, `subjectId`, `newGrade` sean coherentes. Riesgo de alterar calificaciones sin rastro suficiente.

### A-3. `emailAlerts` permite spam
**`firestore.rules:154-159`.** Cualquier autenticado puede crear emails. Si el sistema tiene un worker que envía estos, un maestro puede mandar emails masivos. Agregar rate-limiting externo o restringir `create` a `isAdmin() || isOrientador() || isDirectivo()`.

---

## 🟡 MEDIO

### M-1. Rol `directivo` no está en helpers
**`firestore.rules`.** Se usa `getUserData().role == 'directivo'` inline en 4 lugares. Refactorizar a `isDirectivo()` reduce riesgo de typo ('directiva', 'director').

### M-2. `activityLog` permite `create` sin validar autor
**`firestore.rules:147-151`.** Un autenticado puede loggear en nombre de otro (`request.resource.data.userId != request.auth.uid`). Agregar validación.

### M-3. `incidents` read abierto
**`firestore.rules:183-184`.** Todo autenticado lee todas las incidencias. Un maestro puede leer incidencias de otros docentes/alumnos. Considerar filtrar por `teacherId` o `groupId`.

### M-4. Sanitización inconsistente
Algunos módulos usan `Utils.sanitize()` otros no (ej: `students.js` en modales de detalle). Revisar todos los `innerHTML` con strings derivados de Firestore. Aunque los datos vienen de admin, es defensa-en-profundidad.

---

## 🟢 BAJO

### B-1. Firebase SDK compat v8 obsoleto
El SDK v8 entra en mantenimiento. Plan sugerido: migración progresiva módulo por módulo a v9 modular. No urgente pero inevitable.

### B-2. No hay CSP header
Firebase Hosting permite `firebase.json > headers`. Agregar `Content-Security-Policy` reduce superficie XSS.

### B-3. Scripts administrativos usan Application Default Credentials
Seguro localmente pero si alguien clona el repo y ejecuta scripts con su token, puede mutar producción. Documentado en `scripts/README.md`. Considerar script-wrapper que valide `project_id`.

---

## Lo que SÍ está bien

- ✅ `delete` casi siempre restringido a admin.
- ✅ `partials` bloqueados previenen edición retroactiva de calificaciones cerradas (a nivel de grade, no de grupo).
- ✅ `users` write solo admin.
- ✅ No hay uso de `eval()`, `new Function()`, ni `document.write`.
- ✅ Tokens OAuth nunca se committean (usa firebase-tools global).
- ✅ No hay secretos hardcoded en el código cliente (las API keys de Firebase son públicas por diseño; seguridad vive en rules).
- ✅ Bajas de alumnos son soft-delete con motivo (no pierden historial).

## Plan de remediación sugerido

1. **Inmediato:** Cerrar C-1 (bootstrap de rol) y C-2 (grades sin validar asignación).
2. **Corto plazo:** A-1, A-2, A-3 (asistencia, correcciones, emails).
3. **Mantenimiento:** Refactor helpers (M-1), CSP header (B-2).
4. **Próximo semestre:** Plan de migración a Firebase SDK v9.

**Antes de aplicar cambios:** probar en Firebase Emulator (`npx firebase-tools emulators:start`) para no bloquear acceso a admins.
