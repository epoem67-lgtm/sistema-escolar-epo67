# Cotejo oficial 1-2 MATUTINO · Parcial 3 · 2026-06-30

Cotejo de las listas oficiales (Control Tercer Parcial, firmadas) de 1-2 matutino
(54 inscritos, 53 calificados — Rangel Jiménez Paola #44 sin nota en todas) contra Firestore.
Verificación por **promedio impreso al pie = checksum** + dictado/confirmación de columna donde difería.

## Materias cotejadas: 11 de 11 — CERRADO ✅

| Materia | Maestro | Sistema | Impreso | Estado |
|---|---|---|---|---|
| Lengua y Comunicación II | Berenice Palacio | 8.26 | 8.26 | ✅ exacto |
| Inglés II | Christian Medrano | 9.08 | 9.08 | ✅ exacto |
| Pensamiento Matemático II | Ernesto Brena | 7.94 | 7.94 | ✅ exacto |
| Ciencias Naturales y Tecnología II | Jorge Barrera | 8.36 | 8.36 | ✅ exacto |
| Cultura Digital II | Rosalva Azpeitia | 8.70→**8.75** | 8.75 | ✅ corregido (1 alumno) |
| Actividades Físicas y Deportivas II | Michael Gómez | 8.45 | 8.45 | ✅ exacto |
| Educación para la Salud II | Marlene García | 8.83 | 8.83 | ✅ exacto |
| Taller de Ciencias I | Juan M. Morales | 8.42 | 8.42 | ✅ exacto |
| Ciencias Sociales II | Granados de Loera | 8.89→**8.83** | 8.83 | ✅ corregido (Legorreta) |
| Pensamiento Filosófico y Humanidades II | Laurita Martínez | 8.21→**8.19** | 8.19 | ✅ corregido (Legorreta) |
| Temas Selectos de Igualdad y DDHH II | Nohemí Mata Solís | 8.45 | 8.45 | ✅ exacto |

## Correcciones de calificación (verificadas vs hoja, marca `lastCotejoFix`)
| Materia | Alumno | Antes | Después | Causa |
|---|---|---|---|---|
| Cultura Digital II | Pérez Hernández Edgar Alejandro (#40) | EC 0 → Cal 5 | EC 6 (TR 2) → **Cal 8** | EC perdida (confirmado EC=6, TR=2 por Olivia) |
| Ciencias Sociales II | Legorreta Hernández Liliana (#27) | EC 6, TR 2 → Cal 8 | EC 0, TR 0 → **Cal 5** | sistema inflado vs hoja firmada (alumna inasistente) |
| Pensamiento Filosófico II | Legorreta Hernández Liliana (#27) | EC 6 → Cal 6, faltas 0 | EC 0 → **Cal 5**, faltas **30** | sistema inflado vs hoja firmada (alumna inasistente) |

**Nota Legorreta #27:** es la única alumna donde el sistema estaba **más alto** que la hoja
(al revés del bug de captura). Es prácticamente baja por inasistencia (30 faltas en Filosófico);
ambas maestras la firmaron en 5 y así quedó. Confirmado por Olivia ("en ambas tiene 5"). Luna
Samantha #30 (mismo perfil de inasistencia) sí coincidía y NO se tocó.

## Falsa alarma aclarada (NO era problema de datos)
En el primer dump, Matemático pareció tener un "subjectId corrupto" con una calificación
escondida. **Era un bug de MI script de lectura** (decodificaba mal los acentos UTF-8 cuando
la respuesta HTTP llegaba partida en chunks: `d += c` sobre Buffers parte los caracteres
multibyte). Al inspeccionar los bytes reales: **un solo subjectId limpio, 52 calificaciones,
promedio exacto 7.94**. Cero problema en Firestore. (Script de fix ya usa `Buffer.concat`.)

## Notas menores de roster (no afectan calificaciones)
- **Números de lista desfasados**: el sistema salta el np 2 y el 23, y llega hasta 55; además
  **Hernández García Samanta** tiene np=0. El orden alfabético y las notas son correctos; solo
  la numeración interna está corrida. Mismo tipo de detalle que Ximena en 1-1.
- **Luna Francisco Samantha #30** aparece con 0 en la hoja de Matemático pero sin doc de captura
  en el sistema para esa materia (las dos lecturas = reprobada/sin nota). No afecta el promedio.

## Conclusión
**1-2 matutino CERRADO al 100% (11/11 materias).** 3 correcciones celda por celda, todas
verificadas y confirmadas por Olivia: 1 por EC perdida (Pérez, Cultura Digital) y 2 por sistema
inflado de la misma alumna inasistente (Legorreta, Ciencias Sociales + Filosófico). Las otras 8
coincidían exacto.

**Nota sobre las 2 hojas de Filosófico:** Olivia mandó dos versiones de la lista de Laurita — una
de 8.21 (Legorreta cal 6, aprobada, SIN firmas de alumnos) y la firmada por los alumnos de 8.19
(Legorreta cal 5, reprobada). El sistema quedó en la versión firmada (8.19, Legorreta = 5), que
es la autoridad y lo que Olivia confirmó.
