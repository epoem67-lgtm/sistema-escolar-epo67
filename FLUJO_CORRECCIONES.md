# Flujo de Correcciones de Calificación — EPO 67

> Cómo funciona pedir y aplicar una corrección de calificación, quién puede hacer qué,
> y los blindajes que garantizan que Dirección siempre pueda aplicar sin trabas.
> Módulos: `correction-request.js` (maestro) y `grade-corrections.js` (Dirección).

## 1. Pasos del flujo

```
MAESTRO pide  →  (papel firmado por la Directora)  →  DIRECCIÓN aplica  →  Calificación corregida
  (pending)                                              (applied)
```

### Paso 1 — El maestro solicita  (módulo "Cambios de Calificación")
- El maestro elige: parcial **cerrado** → grupo/materia → alumno → nueva calificación → motivo.
- Se crea un documento en `gradeCorrections` con `status: 'pending'` y un **folio**.
- Requisitos (reglas Firestore, FLUJO 1):
  - El parcial debe estar **CERRADO** para el grado del alumno (si está abierto, el maestro
    edita directo en "Capturar Calificaciones", no aquí).
  - **Ventana de correcciones abierta** (`config/correctionsWindow`) **O** un **permiso individual**
    que Dirección le otorgó para ese parcial (`correctionGrants/{partialId}_{teacherId}`).
  - El maestro **solo puede SUBIR** la calificación (`newGrade >= currentGrade`).
- Admin/subdirector también pueden crear solicitudes **a nombre de** un maestro.

### Paso 2 — Autorización física
- La **Directora** firma el formato físico (oficio). Ese papel respalda el cambio digital.

### Paso 3 — Dirección aplica  (módulo "Correcciones de Cal." → panel admin)
- Admin / subdirector / directivo presiona **"Autorizar y aplicar"** en el folio pendiente.
- El sistema, por cada alumno del folio:
  1. Escribe la nueva calificación en `grades/{studentId}_{subjectId}_{partial}` (**ID
     determinístico** — nunca crea documentos duplicados con ID aleatorio).
  2. Marca la solicitud como `status: 'applied'` con `appliedBy`, `appliedAt`, `appliedByName`
     y el `authOficio` (si lo capturó).
  3. Registra en la **bitácora** (auditoría).
- **Dirección NO depende de la ventana**: admin/subdirector/directivo pueden aplicar **siempre**,
  esté la ventana abierta o cerrada (acceso administrativo).

## 2. Quién puede qué

| Acción | Maestro | Admin / Subdirector / Directivo |
|---|---|---|
| Pedir corrección (parcial cerrado) | ✅ (ventana abierta o permiso individual) | ✅ siempre, a nombre de cualquiera |
| Solo SUBIR la cal | ✅ obligado | — |
| SUBIR o BAJAR | ❌ | ✅ (con oficio firmado, confirmando) |
| Aplicar la corrección | ❌ | ✅ siempre (sin depender de la ventana) |
| Anular su propia solicitud pendiente | ✅ | ✅ |

## 3. Blindajes (para que Dirección aplique SIN trabas)

1. **`_currentUserName()` a prueba de fallos** — el nombre de quién aplica es solo cosmético;
   va envuelto en `try/catch` y **nunca puede tronar ni bloquear** la aplicación.
   (Bug histórico jun‑2026: la función se llamaba a sí misma → "Maximum call stack" → la cal
   se cambiaba pero la solicitud quedaba "pendiente". Corregido y blindado.)
2. **Cambios que BAJAN la cal = decisión, no muro** — si una solicitud pediría una cal menor a
   la actual (típico de una solicitud vieja), el sistema **pregunta UNA vez** si aplicarla de
   todos modos (Dirección tiene autoridad con el oficio). Antes quedaba atorada para siempre.
3. **Errores con motivo real** — si una aplicación falla por algo técnico, se muestra **la razón
   exacta**, no un "error" sin explicación.
4. **ID determinístico de calificación** — `{studentId}_{subjectId}_{partial}` es la única fuente
   de verdad; evita documentos duplicados y promedios inconsistentes.
5. **Aplicación ATÓMICA** — por cada alumno, cambiar la calificación y marcar la solicitud como
   "aplicada" se guardan **juntos en una sola operación** (batch de Firestore): o se guardan los
   dos, o ninguno. Nunca queda el estado raro de "cal cambiada pero solicitud pendiente".
6. **Reintento idempotente** — si algo se interrumpe, volver a darle "Aplicar" no daña nada: si la
   cal ya está en el valor correcto, solo termina de marcar la solicitud como aplicada.

## 4. Si algo sale mal (guía rápida para Dirección)

- **"Sale error al aplicar":** refresca la página (ciérrala y ábrela) y vuelve a aplicar. La
  calificación pudo haberse cambiado ya; el reintento solo cierra el trámite. Si el aviso muestra
  un motivo técnico, repórtalo a Soporte (WhatsApp 55 1078 2357).
- **"La solicitud no aparece":** revisa que la ventana de correcciones esté abierta, o que el
  maestro tenga permiso individual para ese parcial.
- **"No me deja porque baja la cal":** si Dirección lo autoriza con oficio, al aplicar elige
  **"Aceptar"** en el aviso de "baja la calificación".
