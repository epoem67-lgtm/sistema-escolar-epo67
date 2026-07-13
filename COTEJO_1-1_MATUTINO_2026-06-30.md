# Cotejo oficial 1-1 MATUTINO · Parcial 3 · 2026-06-30

Cotejo de las **11 listas oficiales** (Control Tercer Parcial, firmadas) de 1-1 matutino
(55 alumnos) contra Firestore. Verificación por **promedio impreso** (checksum) + dictado de
columna donde el promedio difería. 1-1 incluye la materia del "MEGA PROBLEMA" original
(Lengua y Comunicación, maestra Atzire).

## Resultado: calificaciones coinciden tras 3 correcciones; faltas tras 3

| Materia | Maestro | Estado |
|---|---|---|
| Inglés II | Christian Medrano | ✅ exacto (9.27) |
| Pensamiento Matemático II | Anayancy Quijada | ✅ exacto (8.31) |
| Cultura Digital II | Rosalva Azpeitia | ✅ exacto (8.71) |
| Ciencias Naturales II | Jorge Barrera | ✅ corregido (2 alumnos) |
| Pensamiento Filosófico II | Lizette Martínez | ✅ corregido (1 alumno) |
| Ciencias Sociales II | Granados de Loera | ✅ exacto (9.22) |
| Taller de Ciencias I | Juan M. Morales | ✅ exacto (8.82) |
| Actividades Físicas II | Michael Gómez | ✅ exacto (9.75) |
| Educación para la Salud II | Marlene García | ✅ exacto (8.93) |
| Temas de Igualdad y DDHH II | Nohemí Mata | ✅ exacto (8.65) |
| Lengua y Comunicación II | **Atzire** Alvarado | ✅ cal exacta (9.05); faltas corregidas |

## Correcciones de calificación (cada una con marca `lastCotejoFix`, verificada vs hoja)
| Materia | Alumno | Antes | Después | Causa |
|---|---|---|---|---|
| Ciencias Naturales II | Arrazola Romero Diego Iván (#4) | EC 0 → Cal 5 | EC 6.4 → **Cal 9** | EC perdida |
| Ciencias Naturales II | Castillo Hernández Xunelly (#9) | EC 0 → Cal 5 | EC 6.4 → **Cal 9** | EC perdida |
| Pensamiento Filosófico II | Arrazola Romero Diego Iván (#4) | PE 0 → Cal 9 | PE 1 → **Cal 10** | punto extra no guardado |

## Correcciones de faltas (marca `lastFaltasFix`, NO cambian calificación) — materia de Atzire
| Alumno | Antes | Después | Nota |
|---|---|---|---|
| Cruz Paz Carlos Alfonso (#13) | 0 | 2 | corregido en la mañana (queja original) |
| Islas García Mariana (#30) | 1 | 4 | corregido en la mañana (queja original) |
| Islas Vélez Santiago (#31) | 1 | 3 | corregido hoy en el cotejo (estaba marcado en círculo) |

## Dato menor de roster
**Ximena Muñoz Magaña** tiene número de lista = **0** en el sistema (debería ser **40**).
No afecta calificaciones; conviene corregir el `np` aparte.

## Conclusión
**1-1 matutino queda confirmado contra las hojas oficiales.** La materia del reclamo original
(Lengua, Atzire): calificaciones idénticas y las 3 faltas en disputa ya corregidas. El bug en
1° se manifestó como EC/PE perdidos (no solo transversal) — todo restaurado celda por celda.
