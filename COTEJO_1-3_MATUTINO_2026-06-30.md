# Cotejo oficial 1-3 MATUTINO · Parcial 3 · 2026-06-30

Cotejo de las listas oficiales (Control Tercer Parcial, firmadas) de 1-3 matutino (54 alumnos)
contra Firestore. Verificación por **promedio impreso = checksum** + drill celda por celda.

## Materias cotejadas: 11 de 11 — CERRADO ✅

| Materia | Maestro | Sistema | Impreso | Estado |
|---|---|---|---|---|
| Lengua y Comunicación II | Berenice Palacio | 9.13 | 9.13 | ✅ exacto |
| Inglés II | Christian Medrano | 9.52→**9.87** | 9.87 | ✅ corregido (12 alumnos, TR perdida) |
| Pensamiento Matemático II | Ernesto Brena | 8.28 | 8.28 | ✅ exacto |
| Cultura Digital II | Rosalva Azpeitia | 9.74 | 9.74 | ✅ exacto |
| Ciencias Naturales y Tecnología II | Araceli Linares | 8.24 | 8.24 | ✅ exacto |
| Taller de Ciencias I | Juan M. Morales | 9.17 | 9.17 | ✅ exacto |
| Pensamiento Filosófico y Humanidades II | Laurita Martínez | 9.06 | 9.06 | ✅ exacto |
| Ciencias Sociales II | Granados de Loera | 9.41 | 9.41 | ✅ exacto |
| Actividades Físicas y Deportivas II | Michael Gómez | 9.98 | 9.98 | ✅ exacto |
| Educación para la Salud II | Marlene García | 9.67 | 9.67 | ✅ exacto |
| Temas Selectos de Igualdad y DDHH II | Alejandra González Cortés | 9.37 | 9.37 | ✅ exacto |

## Corrección en Inglés II — bug de Transversal perdida EN BLOQUE (12 alumnos)
El sistema tenía Transversal=0 en 12 alumnos que la hoja firmada de Christian Medrano tiene en
**TR=2**. Se restauró TR 0→2 (solo TR; EC/PE/faltas intactos), recalculando suma/cal. Total
**+19 puntos**, promedio 9.52→**9.87** (cuadra al centésimo). Marca `lastCotejoFix=cotejo-hoja-oficial-1-3-ingles-2026-06-30`.

| Alumno | Cal antes | Cal después |
|---|---|---|
| Ávila García Paris Paolette (#4) | 8 | 10 |
| Barrera Naeem (#5) | 8 | 10 |
| Blanco Jaramillo Ingrid Natalia (#6) | 9 | 10 |
| Carlos De la Cruz Javier (#7) | 9 | 10 |
| Como Montoya Ángel Giovanny (#10) | 8 | 10 |
| Cortés Vázquez Zuleima (#11) | 8 | 10 |
| Cruz Bautista Yael Abdiel (#12) | 8 | 10 |
| Cruz Núñez Ximena Lizvet (#13) | 9 | 10 |
| De Jesús González Sharon Noemí (#14) | 9 | 10 |
| Torres De León Amairani (#49) | 8 | 10 |
| Valdez Robles Oscar Yael (#50) | 9 | 10 |
| Vargas Santos Jatziri Vanessa (#51) | 8 | 10 |

**Nota:** aunque fueron 12 cambios, NO fue un fix masivo a ciegas (lección del v8.25): cada celda
verificada contra la hoja firmada (los 12 traen TR=2 impreso) y el checksum cuadró exacto.
Confirmado por Olivia antes de aplicar.

## Conclusión
**1-3 matutino CERRADO al 100% (11/11 materias).** Una sola materia con correcciones: Inglés
(12 alumnos por Transversal perdida en bloque, todos verificados vs hoja firmada y confirmados
por Olivia). Las otras 10 coincidían exacto. Con esto **TODO 1° matutino (1-1, 1-2, 1-3) queda
cotejado.**
