# Cotejo oficial 3er grado MATUTINO · Parcial 3 · 2026-06-30

Cotejo celda por celda de las **36 listas oficiales impresas** (Control Tercer Parcial,
firmadas) contra Firestore, para los 3 grupos de 3° matutino. Hecho por la administradora
(Olivia) con las hojas en mano. Método: dump READ-ONLY del sistema + verificación por
**promedio impreso** (checksum) y dictado de columnas cuando el promedio difería.

## Resultado global: el sistema coincidía con las hojas en >99.8%

| Grupo | Materias | Alumnos | Calificaciones mal | Faltas sincronizadas |
|---|---|---|---|---|
| 3-1 | 12/12 ✅ | 45 | **0** | 9 (Práctica) |
| 3-2 | 12/12 ✅ | 40 | **0** | 0 |
| 3-3 | 12/12 ✅ | 45 | **3** | 0 |

**~1,560 calificaciones cotejadas. Solo 3 estaban mal** (las 3 corregidas abajo) + 9 faltas
en 3-1. Las "sospechas" del análisis automático (transversales en 0) resultaron TODAS
legítimas: los maestros las pusieron así y la hoja firmada lo confirma.

## Correcciones aplicadas (solo celdas verificadas vs hoja, una por una)

### 3-1 — faltas (Práctica y Colaboración, Marco Vélez): 9 alumnos 0→1 falta
(No cambió ninguna calificación.) Marca `lastFaltasFix=cotejo-hoja-oficial-3-1-practica-2026-06-30`.
Álvarez González, Cardona Zárate, García Rangel, Hernández Chávez, López Godínez,
Martínez Montero, Ramírez Maldonado, Serrano Magallón, Vargas Romero.

### 3-3 — 3 calificaciones (cada una con marca `lastCotejoFix=...2026-06-30`)
| Materia | Alumno | Antes | Después | Causa |
|---|---|---|---|---|
| Ciencias de la Comunicación I | Barrientos Lorenzana Attis Josué (#3) | EC 8 → Cal 10 | EC 7 → **Cal 9** | EC sobrado |
| Conciencia Histórica III | Villegas Sánchez Nadia Donaji (#42) | TR 1 → Cal 9 | TR 2 → **Cal 10** | bug transversal |
| Páginas Web | Hernández Padilla Estefany Naomi (#17) | PE 0 → Cal 9 | PE 1 → **Cal 10** | punto extra no guardado |

## Falsas alarmas confirmadas (NO se tocó nada)
- 3-2 Filosofía, Castillo/Cerritos: mi mala lectura — el sistema ya estaba bien.
- 3-2 Economía, Solís: typo de la usuaria al dictar — el sistema ya estaba bien (9).
- 3-3 Conciencia, Zamora: la usuaria dio 8 y luego 10; con la hoja confirmó **9** = sistema.
- 3-3 Páginas Web, Villegas: 7 = sistema, coincidía.

## Conclusión
**3er grado matutino queda confirmado contra las listas oficiales.** Concentrado, F1,
preboletas y boletas de 3° reflejan exactamente lo impreso. Para ver las correcciones en
reportes basta refrescar (la sesión cachea ~5 min). NO se hizo ninguna operación masiva:
cada cambio fue una celda verificada contra la hoja firmada y aprobada por la administradora.
