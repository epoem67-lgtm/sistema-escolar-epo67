# EPO67 Sistema Escolar - Skill de Desarrollo y Mantenimiento

## Contexto del Proyecto
Sistema de gestión escolar para la Escuela Preparatoria Oficial Núm. 67 (EPO67) del Estado de México.
Archivo principal: `SISTEMA_ESCOLAR_EPO67.html` - aplicación single-file HTML con vanilla JS, Chart.js, y SheetJS.

## Arquitectura
- **Single-file HTML** (~3500+ líneas) con todo embebido
- **localStorage** para persistencia de calificaciones, horas, bajas, metas
- **APP_DATA** JSON embebido con 812+ alumnos, 218+ maestros, subjects_by_grade
- **Print system**: inyección dinámica de HTML en `#printOfficialFormat` + `window.print()` + cleanup con setTimeout
- **@media print CSS** oculta todo excepto `#printOfficialFormat`

## Datos Clave
- **Turnos**: MATUTINO, VESPERTINO
- **Grados**: 1, 2, 3 (6 semestres)
- **Grupos**: 9 por turno (1-1 a 3-3)
- **Grupo más grande**: MATUTINO 1-1 con 55 alumnos
- **Materias por grado**: ~10-11 UACs

## Patrones de Almacenamiento
```
grades_{studentId}_p{parcial} → JSON {
  materia_ec: float,     // Evaluación Continua
  materia_tr: float,     // Transversal
  materia_pe: float,     // Puntaje Extra
  materia_ex: float,     // Examen (solo VESPERTINO)
  materia_suma: float,   // Suma auto-calculada
  materia: float,        // Calificación final (redondeada)
  materia_faltas: int    // Faltas
}
horas_{turno}_{grupo}_{materia}_p{parcial} → JSON {feb, mar, abr, may, jun, jul}
```

## Rubros de Evaluación
- **MATUTINO**: EC (máx 8) + Transversal (máx 2) + P.Extra = Suma → Calif (redondeo)
- **VESPERTINO**: EC (máx 5) + Examen (máx 3) + Transversal (máx 2) + P.Extra = Suma → Calif (redondeo)
- **Regla de redondeo**: ≥6 redondeo normal, <6 se trunca (5.9→5)
- **Máximo**: 10 siempre

## Formato de Impresión (Listas Oficiales)
- Tamaño: Letter portrait, márgenes 4mm/5mm/3mm/5mm
- Budget: 272.4mm verticales
- Logos base64 embebidos (LOGO_HEADER_SRC, LOGO_FOOTER_SRC)
- Font sizes dinámicos según número de alumnos (5.5pt a 4pt)
- Row heights dinámicos (4.5mm a 2.8mm)
- Firmas: tabla de 2 filas (fila 1 = líneas border-bottom, fila 2 = textos) → NUNCA usar divs dentro de la misma celda para líneas y texto
- Todo B&W, reprobados con background:#bbb, zebra striping #eee
- UAC_NOMBRES dictionary para nombres completos con acentos

## Formato de Impresión (Controles por Grupo)
- Tamaño: Letter LANDSCAPE
- Budget: ~208.9mm verticales
- Todas las materias como columnas
- Font sizes más pequeños (3.5pt headers, 4-5pt datos)

## Constantes Importantes
- ORIENTADORES: mapeo turno → grado → nombre del orientador
- UAC_NOMBRES: mapeo materia_key → nombre completo con acentos
- subjectsByGrade: mapeo grado → array de materias

## Sistema de Usuarios (v12.0)
- 4 admins individuales: olivia, lupita, octavio, roberto
- Orientadores por turno: orientador_mat, orientador_vesp
- Maestros: generados dinámicamente desde APP_DATA
- Consulta: acceso de lectura
- Contraseña patrón: nombre_corto + "67"

## Workspace
- Carpeta tiene trailing space: `ADMINISTRACIÓN ESCOLAR EPO 67 ` (importante para paths)
- Para Playwright: usar symlink `ln -sf "$WSDIR/file" /sessions/laughing-jolly-noether/file`
- Inyección de funciones: grep -n "^function X", calcular líneas, head/cat/tail

## Problemas Resueltos
1. **Firmas desalineadas**: Usar tabla 2 filas (líneas en fila 1, texto en fila 2), NUNCA divs en misma celda
2. **Overflow de página**: Ajustar font-size y row-height dinámicamente según n_alumnos
3. **Trailing space en path**: Usar find + variable WSDIR, o symlinks para Playwright
4. **setTimeout cleanup**: Override `window.setTimeout = () => 0` antes de llamar print functions
5. **Dropdown values**: Verificar IDs exactos de los selects antes de setear .value
6. **Landscape vs Portrait**: Controles en landscape (@page size: letter landscape), Listas en portrait

## Módulos del Sistema
1. Dashboard - estadísticas generales
2. Listas de Calificaciones - con filtros cascading + formato oficial imprimible
3. Controles Oficiales - concentrado por grupo, imprimible en landscape
4. Indicadores - comparación por grupo/materia + gráficas + análisis
5. Alertas y Riesgo - semáforo (rojo/amarillo/verde) + búsqueda + reporte individual
6. Boletas - selección por grupo, individual o masiva
7. Captura de Datos - rubros diferenciados MAT/VESP + auto-cálculo + Excel import/export
8. Administración - alumnos, bajas, cambio de grupo, metas, respaldo, bitácora, MIGE export
