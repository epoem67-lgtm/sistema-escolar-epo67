# Convenciones de código — EPO 67

## Nombres

- **Archivos módulo:** `kebab-case.js` (ej: `partial-close.js`)
- **Constantes globales:** `K.*` (ej: `K.TURNOS`, `K.PARCIALES`)
- **Cache:** `Store.*` (ej: `Store.getStudents()`)
- **Componentes UI:** `UI.*` (ej: `UI.card(...)`)
- **Utils:** `Utils.*` (ej: `Utils.sanitize()`)
- **CSS variables:** `--color-primary`, `--spacing-md`, etc.

## HTML dentro de JS

- Usar template literals.
- **Sanitizar** con `Utils.sanitize(x)` (alias `S(x)` en algunos módulos) cualquier valor dinámico.
- Evitar `innerHTML +=`; preferir reconstrucción completa.
- Interpolar clases: `class="btn btn-${variant}"`.

## Event handling

```js
// ✅ correcto
container.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  switch (btn.dataset.action) {
    case 'edit': openEdit(id); break;
    case 'delete': confirmDelete(id); break;
  }
});

// ❌ incorrecto
`<button onclick="MyModule.edit('${id}')">…</button>`
```

## Firestore access

```js
// Lectura con cache
const students = await Store.getStudents();       // usa cache
const fresh = await Store.getStudents(true);      // fuerza fetch

// Escritura
await db.collection('students').doc(id).update({ nombre });
// Si el módulo va a re-renderizar:
await Store.getStudents(true);
render();
```

## Estados de UI

Usar clases existentes: `.empty-state`, `.loading`, `.error-card`, `.stat-card`, etc. Ver `styles.css`.

## Toasts y modales

```js
Toast.success('Guardado');
Toast.error('Algo falló');
Modal.open({ title: 'Confirmar', content: '…', actions: [...] });
```

## Commits

```
[modulo] Acción concisa en imperativo

Detalle opcional.
```

Ejemplos:
- `[teachers] Eliminar función legacy _oldAsignacionesTab`
- `[grades] Corregir redondeo < 6 en parcial 3`
- `[security] Restringir bootstrap de users a rol consulta`
- `[docs] Agregar SECURITY_AUDIT.md`

## Versionado de assets

Cada deploy que toca JS debe subir `?v=X.Y` en `public/index.html` para todos los scripts afectados (rompe cache del navegador).

## Qué NO hacer

- ❌ Frameworks JS (React, Vue, etc.)
- ❌ Build tools (webpack, vite, rollup)
- ❌ Estilos inline (`style="..."`)
- ❌ `onclick` / `onchange` inline en HTML strings
- ❌ `innerHTML` con datos sin `sanitize()`
- ❌ Hard-delete de alumnos (usar soft delete con `estado: 'baja'`)
- ❌ Modificar `firestore.rules` sin probar en emulator
