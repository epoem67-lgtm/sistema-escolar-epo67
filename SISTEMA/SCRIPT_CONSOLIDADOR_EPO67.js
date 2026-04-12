/**
 * ============================================================
 * CONSOLIDADOR DE CALIFICACIONES - EPO 67
 * 73 docentes (35 matutino + 38 vespertino)
 * ============================================================
 *
 * INSTRUCCIONES:
 * 1. Crea un Google Sheet nuevo y vacio
 * 2. Ve a Extensiones > Apps Script
 * 3. Borra el codigo que aparece y pega TODO este script
 * 4. Guarda (Ctrl+S) y cierra Apps Script
 * 5. Recarga el Google Sheet - aparecera un menu "EPO 67"
 * 6. Clic en "EPO 67" > "Consolidar Calificaciones"
 * 7. Acepta los permisos la primera vez
 * 8. Espera 3-8 minutos (son 73 archivos)
 * 9. Descarga como Excel: Archivo > Descargar > Microsoft Excel
 * 10. Abre SISTEMA_ESCOLAR_EPO67.html > Captura > Importar
 * ============================================================
 */

const MAESTROS_MATUTINO = [
  {name: "ALEJANDRA", id: "19tMSH2UXNSY1VoWpC5BT8xRWr5RVfNGLLZNe6BC1dj4"},
  {name: "ANA ISABEL", id: ""}, // TODO: agregar spreadsheet_id
  {name: "ANAYANCI", id: "1Y_ZbBpCE0H7haUPElAVXXbQfvQeOS0OerQJ5536SRZE"},
  {name: "ANDREA", id: "1A7_5GffdjgKkYZO0j38Jl8q-90plO55Huw8_sEqeF9I"},
  {name: "ARACELI LINARES", id: "1Suc2qopRVVxybDoozbhYI-3fnXdSLY03Ab-qquDqzzQ"},
  {name: "ATZIRE", id: "1FKR2U7kkQHfCjelzXVYWHL4wtwWAoevpFyxNI_KSxk8"},
  {name: "BENJAMÍN SALAS", id: "1GqVTc7tthA0s3DSWu49gN9wAx2ZUukyzXHzhHx2xKj4"},
  {name: "BERENICE PALACIOS", id: "15bT4tGt_SY5EX9TmAFufOHHJJzVU7wpgSlESt_nFSzQ"},
  {name: "CHRISTIAN MEDRANO", id: "1R_LufODGbikLoD-Jd0WTt-eYlX8m1ngqZM93CoT4u5M"},
  {name: "CLAUDIA", id: "1DKnpwLMQXJPWWl5_irg-NZKZeRSSre41viCfhLORQ9M"},
  {name: "CLAUDIA MELENDEZ", id: "1DKnpwLMQXJPWWl5_irg-NZKZeRSSre41viCfhLORQ9M"},
  {name: "ERNESTO BRENA", id: "1XXpLVmvERIkOwfwjUI8iua9nnOnyLO6P4Lg4qznMCsI"},
  {name: "GUADALUPE GRANADOS", id: "1gWm5grlICJTE9yzh0EdKexQ0PnWg6cx3Djpo_7ER3Ig"},
  {name: "IVÁN", id: "1DXOG9fQw6plDNWf4ZXLgVvQ_FRZ6M7nGww0_zMJACUc"},
  {name: "IVONNE CEDILLO", id: "1Bp_n31YOQY73dChHnRTG6fgXrhI35khhILEo81Ke6AA"},
  {name: "JÉSSICA ALCÁNTARA", id: "1XEO5qOc1ULli8OYh8L9dVyXgf9n3IMd1IofEfRLvAEk"},
  {name: "JORGE FLORES", id: "1_AFCWkM3jCUHMVRwvoFkZ6syz5Zk2VPuCdzg3T7okfQ"},
  {name: "JORGE ISRAEL", id: "1FzXi7RyoYG1GfH6ZQa4ZJAwut3yfUjsE2trjXNRxIhI"},
  {name: "JOSÉ MÁRTÍN", id: "18XH-tWyTO3gH42Gvu54gWEYK7bDv4GEIXeZqjlgKESU"},
  {name: "JUAN MANUEL", id: "19EFvS-7Tps2ZVwfNjTv2mCanthC1FzY_jtxW0BH-NzM"},
  {name: "JUANITA", id: "19EFvS-7Tps2ZVwfNjTv2mCanthC1FzY_jtxW0BH-NzM"},
  {name: "LAURITA", id: "1US3L4S9thycvZorF32iOJOUyVHiZpdLMZYtLmcBKODQ"},
  {name: "LIZETTE", id: "1K20B7FgyT9_hMfFExwMLlBwvJ8Sd6srYLb2C2L1nQBY"},
  {name: "MARCO", id: "1_cBY8mfX_ajEmDHphWIpZqFhof1bIw1OxD0bKW2jnkw"},
  {name: "MARLENE", id: "1nD9uWST3bppTVmlWOrMXpAxxcPKaqeIaymVAUHtXDd8"},
  {name: "MICHAEL", id: "1qQwqqsNxMG0D4hGzp2lQodpwhpcQ68bQmZOliRVjkhw"},
  {name: "MIGUEL SERRANO", id: "1oczZkBB4J1AhkTffmv-aGacdvcTpVfBb7fURSv7sJlk"},
  {name: "NOHEMI", id: "1dfd1cx1erILPMHbE5AVYb1ULzyUXSbPBzy_olmDN2Lo"},
  {name: "OLIVIA PEÑA", id: "1IwheF3XSbLmldt4Se6BnSq7f8DRFJ3O-aN_RpWWG9kE"},
  {name: "PACO", id: "1Phrq6Nu5ijSMPoXDAnAirikZEGR3wIjwSj-hBjk2u4Y"},
  {name: "RENATA", id: "1hdYffmd0I-t7zVuUXVNptIyuEnU72VzHq_pRAqyBL98"},
  {name: "RICARDO CHAPARRO", id: "1prqMvrRR3aSuNpt6LTQl6bgrnmhYQ4iy8cVbKJYKsv0"},
  {name: "ROSARIO", id: "1EP_hswqwZqMe09uobhGUJsTmBwIfoRYMNR6T0jrWUAo"},
  {name: "SAÚL CAMACHO", id: "13yF9rv4JzECuz3TZ8bN1VgKLDIWGc_plW5kJR6Wxdlk"},
  {name: "YUSSEF", id: "1JN-Bgrlfyfzw7VNqCUaWjs5m5sp0aei6ImLfNoI2niw"},
];

const MAESTROS_VESPERTINO = [
  {name: "ADRIANA", id: "1OgqL3bnHY_lHn78MUmevcexN8nyVkexHvMZTYpLghyc"},
  {name: "ALEJANDRA GARCÍA", id: "19tMSH2UXNSY1VoWpC5BT8xRWr5RVfNGLLZNe6BC1dj4"},
  {name: "ANAYANCI", id: "1Y_ZbBpCE0H7haUPElAVXXbQfvQeOS0OerQJ5536SRZE"},
  {name: "ANDREA", id: "1A7_5GffdjgKkYZO0j38Jl8q-90plO55Huw8_sEqeF9I"},
  {name: "ARACELI HERNÁNDEZ", id: "1B4QQIQ4pfYf43wEI8aC9MAluQ1A82uFfllw0DW3YCBE"},
  {name: "BEATRIZ", id: "1oB2mefsou96lYcKZEcwU4GHtuTjy-pShk3KJL21pL-I"},
  {name: "BENJAMÍN", id: "1GqVTc7tthA0s3DSWu49gN9wAx2ZUukyzXHzhHx2xKj4"},
  {name: "BERENICE", id: "15bT4tGt_SY5EX9TmAFufOHHJJzVU7wpgSlESt_nFSzQ"},
  {name: "CHRISTIAN", id: "1N2j1RNjhYLjumYSvV5julH0p_6Wgr3Mh-_kwoh27rSI"},
  {name: "CLAUDIA", id: "1DKnpwLMQXJPWWl5_irg-NZKZeRSSre41viCfhLORQ9M"},
  {name: "CLAUDIA MELÉNDEZ", id: "1DKnpwLMQXJPWWl5_irg-NZKZeRSSre41viCfhLORQ9M"},
  {name: "CRISTINA", id: "1FSHHPtlb-IPpXGa2s4-38fgcoBIYJ6H0p2PKgPi8w14"},
  {name: "DANIA", id: "1TN1GiGcTk7tQRJgAXdF3rwbce1bQOri2E7V4ZyinfB4"},
  {name: "DANIELA", id: "1jqjnROLPtklSheebNWHX0OTG8rlT3TRvI1LuaH5VF7Q"},
  {name: "EDUARDO", id: "1PRpH6NP0E1NHlY2p8F1v31vdZkbFYET_Bb95d3cSCOU"},
  {name: "ERNESTO", id: "1th4SNjcS3t16Bs3og105JIlq-hZzrFU0yzaKVIYqr20"},
  {name: "FERNANDA RODRÍGUEZ", id: ""}, // TODO: agregar spreadsheet_id
  {name: "IVÁN", id: "1DXOG9fQw6plDNWf4ZXLgVvQ_FRZ6M7nGww0_zMJACUc"},
  {name: "JÉSSICA", id: "1ywlDrIpHI5_LVCCZBQakxmgc7tEb-5ZnmmgNIy0Ou0o"},
  {name: "JORGE FLORES", id: "1_AFCWkM3jCUHMVRwvoFkZ6syz5Zk2VPuCdzg3T7okfQ"},
  {name: "JOSÉ EDGAR", id: "1RMe4WLYbvAjhp7v8aZ5rtwFTMd-OpTnoRHvqpF6zHUw"},
  {name: "LIZETTE", id: "1K20B7FgyT9_hMfFExwMLlBwvJ8Sd6srYLb2C2L1nQBY"},
  {name: "MARCO", id: "1_cBY8mfX_ajEmDHphWIpZqFhof1bIw1OxD0bKW2jnkw"},
  {name: "MARIO", id: "1hPxHiJkxSL_WR-movaLcajagpj12edqM4n57gPDG7Xs"},
  {name: "MARÍA DEL CARMEN", id: "12z8H2k8eePvxOjfHknCbyEi6qgpctSzysZKwNos6y68"},
  {name: "MARTÍN", id: "1pNqyqB_feghJhcLqwQRW2tHiXJd5IPNm4AG1NSxcjgg"},
  {name: "MAYDELIN", id: "1cnrFKFsavw3hquIz1nhW5vjHHmTdQfrqXhRwMX3HZqI"},
  {name: "MICHAEL", id: "1qQwqqsNxMG0D4hGzp2lQodpwhpcQ68bQmZOliRVjkhw"},
  {name: "OMAR", id: "1dJH6ECV1mjUhpTSNG1o7y6fd5K1EndNldSqZkZJY7Og"},
  {name: "PACO", id: "1Phrq6Nu5ijSMPoXDAnAirikZEGR3wIjwSj-hBjk2u4Y"},
  {name: "PAULINA", id: "1iFjpzu1IM42oelvij4RXAVKjAYgBICuAyCo80gNm8ZQ"},
  {name: "RICARDO CHAPARRO", id: "1prqMvrRR3aSuNpt6LTQl6bgrnmhYQ4iy8cVbKJYKsv0"},
  {name: "SANDRA", id: "11lziFLULAdi05jUErXfhvE8VZ3YU_kxSYVBO47FUZ3U"},
  {name: "SARA", id: "14z7blIB2vBh0UTtTwdUIzP3iDvUJnWG8N3ZHMubSNxU"},
  {name: "TANIA", id: "15snbFO3DnScmPzI41o0DIyGtjZm5KW14AJwfKNbphTo"},
  {name: "YAQUELIN", id: "1Jd_suVjyIvG8c1lLREEMWJj99fpjzQjLdQlq_mxkK94"},
  {name: "YOANA", id: "15-ug5b9pBPzuZoJD8T08UMHz8t2lQi_OP_pvQWj4WpY"},
  {name: "ZURISADAY", id: "1n4cD7zL8gtdkBSg_v5RtrM1QLjthpJh-a3qTPZrvAk0"},
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('EPO 67')
    .addItem('Consolidar Todo (ambos turnos)', 'consolidarTodo')
    .addItem('Solo Turno Matutino', 'consolidarMatutino')
    .addItem('Solo Turno Vespertino', 'consolidarVespertino')
    .addSeparator()
    .addItem('Generar Indicadores', 'generarIndicadores')
    .addItem('Reporte de Riesgo', 'generarReporteRiesgo')
    .addItem('Exportar JSON para Sistema HTML', 'exportarParaSistemaHTML')
    .addToUi();
}

function consolidarTodo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  ui.alert('Inicio', 'Se consolidaran 73 docentes de ambos turnos.\nEsto puede tomar 3-8 minutos.\nHaz clic en OK y espera.', ui.ButtonSet.OK);
  consolidarTurno(ss, 'MATUTINO', MAESTROS_MATUTINO);
  consolidarTurno(ss, 'VESPERTINO', MAESTROS_VESPERTINO);
  generarHojaResumen(ss);
  ui.alert('Listo!', 'Datos de 73 docentes consolidados.\nYa puedes descargar como Excel.', ui.ButtonSet.OK);
}

function consolidarMatutino() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  consolidarTurno(ss, 'MATUTINO', MAESTROS_MATUTINO);
  generarHojaResumen(ss);
  SpreadsheetApp.getUi().alert('Turno Matutino consolidado (35 docentes).');
}

function consolidarVespertino() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  consolidarTurno(ss, 'VESPERTINO', MAESTROS_VESPERTINO);
  generarHojaResumen(ss);
  SpreadsheetApp.getUi().alert('Turno Vespertino consolidado (38 docentes).');
}

function consolidarTurno(ss, turno, maestros) {
  var sheet = ss.getSheetByName(turno);
  if (sheet) { sheet.clear(); } else { sheet = ss.insertSheet(turno); }

  var headers = [
    'TURNO','DOCENTE','GRUPO','MATERIA','NP',
    'AP. PATERNO','AP. MATERNO','NOMBRE(S)','NOMBRE COMPLETO',
    'EVAL1','EVAL2','EVAL3','SUMA','CALIF FINAL'
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a365d').setFontColor('white');
  sheet.setFrozenRows(1);

  var currentRow = 2;
  var errores = 0;
  var exitos = 0;

  for (var m = 0; m < maestros.length; m++) {
    if (!maestros[m].id) {
      sheet.getRange(currentRow, 1, 1, 5).setValues([[turno, maestros[m].name, '', 'SIN LINK', 'Agregar spreadsheet_id']]);
      sheet.getRange(currentRow, 1, 1, 5).setBackground('#fefcbf');
      currentRow++;
      continue;
    }

    try {
      var src = SpreadsheetApp.openById(maestros[m].id);
      var sheets = src.getSheets();

      for (var s = 0; s < sheets.length; s++) {
        var sName = sheets[s].getName();
        var match = sName.match(/^(\d-\d)\s+(.+)$/);
        if (!match) continue;

        var grupo = match[1];
        var materia = match[2];
        var lastRow = sheets[s].getLastRow();
        if (lastRow < 10) continue;

        var data = sheets[s].getDataRange().getValues();

        for (var i = 10; i < data.length; i++) {
          var row = data[i];
          var np = '';

          // Buscar NP (numero de lista)
          for (var j = 0; j < Math.min(5, row.length); j++) {
            if (typeof row[j] === 'number' && row[j] > 0 && row[j] < 100) { np = row[j]; break; }
          }
          if (!np) continue;

          // Buscar nombres (textos)
          var texts = [];
          for (var j = 0; j < Math.min(8, row.length); j++) {
            if (typeof row[j] === 'string' && row[j].trim().length > 1) { texts.push(row[j].trim()); }
          }

          var ap1 = texts[0] || '';
          var ap2 = texts[1] || '';
          var nombres = texts[2] || '';

          // Buscar calificaciones (numeros despues de la columna 4)
          var grades = [];
          for (var j = 4; j < row.length; j++) {
            if (typeof row[j] === 'number') { grades.push(row[j]); }
          }

          var nombreComp = [ap1, ap2, nombres].filter(Boolean).join(' ');
          if (!nombreComp) continue;

          sheet.getRange(currentRow, 1, 1, headers.length).setValues([[
            turno, maestros[m].name, grupo, materia, np,
            ap1, ap2, nombres, nombreComp,
            grades[0] || '', grades[1] || '', grades[2] || '',
            grades[3] || '', grades[4] || grades[3] || ''
          ]]);
          currentRow++;
        }
      }
      exitos++;
    } catch (e) {
      Logger.log('Error con ' + maestros[m].name + ': ' + e);
      sheet.getRange(currentRow, 1, 1, 5).setValues([[turno, maestros[m].name, 'ERROR', e.toString().substring(0, 100), '']]);
      sheet.getRange(currentRow, 1, 1, 5).setBackground('#fed7d7');
      currentRow++;
      errores++;
    }
  }

  // Resumen al final
  sheet.getRange(currentRow + 1, 1, 1, 5).setValues([['RESUMEN:', 'Exitosos: ' + exitos, 'Errores: ' + errores, 'Total filas: ' + (currentRow - 2), '']]);
  sheet.getRange(currentRow + 1, 1, 1, 5).setFontWeight('bold').setBackground('#e2e8f0');

  for (var i = 1; i <= headers.length; i++) { sheet.autoResizeColumn(i); }
}

function generarHojaResumen(ss) {
  var sheet = ss.getSheetByName('RESUMEN');
  if (sheet) { sheet.clear(); } else { sheet = ss.insertSheet('RESUMEN'); }

  sheet.getRange('A1').setValue('RESUMEN CONSOLIDADO - EPO 67').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A2').setValue('Fecha: ' + new Date().toLocaleDateString('es-MX'));
  sheet.getRange('A3').setValue('Metas: Promedio >= 8.3 | Asistencia >= 80% | Reprobacion <= 14%');

  var row = 5;
  var turnos = ['MATUTINO', 'VESPERTINO'];

  for (var t = 0; t < turnos.length; t++) {
    var ds = ss.getSheetByName(turnos[t]);
    if (!ds || ds.getLastRow() < 2) continue;

    sheet.getRange(row, 1).setValue('TURNO ' + turnos[t]).setFontSize(12).setFontWeight('bold');
    sheet.getRange(row, 1, 1, 7).setBackground('#1a365d').setFontColor('white');
    row++;

    sheet.getRange(row, 1, 1, 7).setValues([['GRUPO','ALUMNOS','REGISTROS','PROMEDIO','% APROB','% REPROB','ESTADO']]);
    sheet.getRange(row, 1, 1, 7).setFontWeight('bold').setBackground('#e2e8f0');
    row++;

    var data = ds.getDataRange().getValues().slice(1);
    var grupos = {};

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var g = r[2], nombre = r[8], calif = r[13];
      if (!g || g === 'ERROR' || g === 'SIN LINK') continue;
      if (!grupos[g]) { grupos[g] = {students: {}, grades: []}; }
      if (nombre) grupos[g].students[nombre] = true;
      if (typeof calif === 'number' && calif > 0 && calif <= 10) grupos[g].grades.push(calif);
    }

    var gKeys = Object.keys(grupos).sort();
    for (var i = 0; i < gKeys.length; i++) {
      var gd = grupos[gKeys[i]];
      var avg = gd.grades.length > 0 ? gd.grades.reduce(function(a,b){return a+b;},0) / gd.grades.length : 0;
      var pass = gd.grades.filter(function(x){return x >= 6;}).length;
      var failR = gd.grades.length > 0 ? ((gd.grades.length-pass)/gd.grades.length*100) : 0;
      var estado = avg >= 8.3 && failR <= 14 ? 'OK' : avg < 7 || failR > 25 ? 'CRITICO' : 'ATENCION';

      sheet.getRange(row, 1, 1, 7).setValues([[
        gKeys[i], Object.keys(gd.students).length, gd.grades.length,
        Math.round(avg*100)/100,
        gd.grades.length > 0 ? Math.round((pass/gd.grades.length*100)*10)/10+'%' : '0%',
        Math.round(failR*10)/10+'%',
        estado
      ]]);

      if (avg < 8.3) sheet.getRange(row, 4).setFontColor('#c53030');
      if (failR > 14) sheet.getRange(row, 6).setFontColor('#c53030');
      if (estado === 'CRITICO') sheet.getRange(row, 7).setBackground('#fed7d7');
      else if (estado === 'ATENCION') sheet.getRange(row, 7).setBackground('#fefcbf');
      else sheet.getRange(row, 7).setBackground('#c6f6d5');
      row++;
    }
    row += 2;
  }
  for (var i = 1; i <= 7; i++) { sheet.autoResizeColumn(i); }
}

function generarIndicadores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('INDICADORES');
  if (sheet) { sheet.clear(); } else { sheet = ss.insertSheet('INDICADORES'); }

  sheet.getRange('A1').setValue('INDICADORES INSTITUCIONALES - EPO 67').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A2').setValue('Meta promedio >= 8.3 | Reprobacion <= 14%');

  var row = 4;
  var turnos = ['MATUTINO', 'VESPERTINO'];

  for (var t = 0; t < turnos.length; t++) {
    var ds = ss.getSheetByName(turnos[t]);
    if (!ds || ds.getLastRow() < 2) continue;

    sheet.getRange(row, 1).setValue('TURNO ' + turnos[t]).setFontWeight('bold');
    sheet.getRange(row, 1, 1, 8).setBackground('#1a365d').setFontColor('white');
    row++;
    sheet.getRange(row, 1, 1, 8).setValues([['DOCENTE','MATERIA','GRUPO','PROMEDIO','% APROB','% REPROB','ALUMNOS','ESTADO']]);
    sheet.getRange(row, 1, 1, 8).setFontWeight('bold').setBackground('#e2e8f0');
    row++;

    var data = ds.getDataRange().getValues().slice(1);
    var combos = {};
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (!r[2] || r[2] === 'ERROR') continue;
      var key = r[1]+'|'+r[3]+'|'+r[2];
      if (!combos[key]) combos[key] = {d:r[1],m:r[3],g:r[2],grades:[]};
      if (typeof r[13] === 'number' && r[13] > 0 && r[13] <= 10) combos[key].grades.push(r[13]);
    }

    var keys = Object.keys(combos).sort();
    for (var i = 0; i < keys.length; i++) {
      var c = combos[keys[i]];
      if (c.grades.length === 0) continue;
      var avg = c.grades.reduce(function(a,b){return a+b;},0)/c.grades.length;
      var pass = c.grades.filter(function(x){return x>=6;}).length;
      var failR = (c.grades.length-pass)/c.grades.length*100;
      var estado = (avg >= 8.3 && failR <= 14) ? 'OK' : (avg < 7 || failR > 25) ? 'CRITICO' : 'ATENCION';

      sheet.getRange(row, 1, 1, 8).setValues([[c.d, c.m, c.g, Math.round(avg*100)/100, Math.round(pass/c.grades.length*1000)/10+'%', Math.round(failR*10)/10+'%', c.grades.length, estado]]);
      if (avg < 8.3) sheet.getRange(row, 4).setFontColor('#c53030');
      if (failR > 14) sheet.getRange(row, 6).setFontColor('#c53030');
      if (estado === 'CRITICO') sheet.getRange(row, 8).setBackground('#fed7d7');
      else if (estado === 'ATENCION') sheet.getRange(row, 8).setBackground('#fefcbf');
      else sheet.getRange(row, 8).setBackground('#c6f6d5');
      row++;
    }
    row += 2;
  }
  for (var i = 1; i <= 8; i++) { sheet.autoResizeColumn(i); }
  SpreadsheetApp.getUi().alert('Indicadores generados.');
}

function generarReporteRiesgo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('RIESGO');
  if (sheet) { sheet.clear(); } else { sheet = ss.insertSheet('RIESGO'); }

  sheet.getRange('A1').setValue('ALUMNOS EN RIESGO - EPO 67').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A2').setValue('Generado: ' + new Date().toLocaleDateString('es-MX'));

  var row = 4;
  sheet.getRange(row, 1, 1, 7).setValues([['TURNO','GRUPO','ALUMNO','MAT. REPROB','PROMEDIO','RIESGO','DETALLE']]);
  sheet.getRange(row, 1, 1, 7).setFontWeight('bold').setBackground('#c53030').setFontColor('white');
  row++;

  var totalRiesgo = 0;
  var turnos = ['MATUTINO', 'VESPERTINO'];

  for (var t = 0; t < turnos.length; t++) {
    var ds = ss.getSheetByName(turnos[t]);
    if (!ds || ds.getLastRow() < 2) continue;
    var data = ds.getDataRange().getValues().slice(1);

    var students = {};
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var nombre = r[8], grupo = r[2], materia = r[3], calif = r[13];
      if (!nombre || nombre === 'ERROR') continue;
      var key = nombre + '|' + grupo;
      if (!students[key]) students[key] = {nombre:nombre, grupo:grupo, califs:[], matRep:[]};
      if (typeof calif === 'number' && calif > 0 && calif <= 10) {
        students[key].califs.push(calif);
        if (calif < 6) students[key].matRep.push(materia);
      }
    }

    var sKeys = Object.keys(students).sort();
    for (var i = 0; i < sKeys.length; i++) {
      var s = students[sKeys[i]];
      if (s.califs.length === 0) continue;
      var avg = s.califs.reduce(function(a,b){return a+b;},0)/s.califs.length;
      var nFail = s.matRep.length;

      var riesgo = '';
      if (nFail >= 3 || avg < 6) riesgo = 'ALTO';
      else if (nFail >= 1 || avg < 7) riesgo = 'MEDIO';
      else continue;

      var det = [];
      if (nFail > 0) det.push(nFail + ' reprobadas: ' + s.matRep.join(', '));
      if (avg < 7) det.push('Promedio: ' + (Math.round(avg*100)/100));

      sheet.getRange(row, 1, 1, 7).setValues([[turnos[t], s.grupo, s.nombre, nFail, Math.round(avg*100)/100, riesgo, det.join(' | ')]]);
      if (riesgo === 'ALTO') sheet.getRange(row, 6).setBackground('#fed7d7').setFontColor('#c53030').setFontWeight('bold');
      else sheet.getRange(row, 6).setBackground('#fefcbf').setFontColor('#975a16');
      row++; totalRiesgo++;
    }
  }
  for (var i = 1; i <= 7; i++) { sheet.autoResizeColumn(i); }
  SpreadsheetApp.getUi().alert('Reporte generado: ' + totalRiesgo + ' alumnos en riesgo.');
}

function exportarParaSistemaHTML() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var output = {
    meta: {escuela:'EPO 67', ciclo:'2025-2026', fecha:new Date().toISOString()},
    students: [], grades: {}, teachers: []
  };

  var turnos = ['MATUTINO', 'VESPERTINO'];
  var sIdx = {};
  var tSet = {};

  for (var t = 0; t < turnos.length; t++) {
    var ds = ss.getSheetByName(turnos[t]);
    if (!ds || ds.getLastRow() < 2) continue;
    var data = ds.getDataRange().getValues().slice(1);

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var nombre = r[8], grupo = r[2], materia = r[3], calif = r[13], docente = r[1];
      if (!nombre || nombre === 'ERROR' || !grupo) continue;

      var sKey = turnos[t]+'|'+grupo+'|'+nombre;
      if (!sIdx[sKey]) {
        var sid = output.students.length + 1;
        output.students.push({id:sid, nombre:nombre, ap1:r[5], ap2:r[6], nombres:r[7], grupo:grupo, grado:parseInt(grupo.charAt(0)), turno:turnos[t]});
        sIdx[sKey] = sid;
        output.grades[sid] = {};
      }
      var sid = sIdx[sKey];
      if (typeof calif === 'number' && calif > 0 && calif <= 10) {
        if (!output.grades[sid]['1']) output.grades[sid]['1'] = {};
        output.grades[sid]['1'][materia] = calif;
      }

      var tKey = docente+'|'+materia+'|'+grupo+'|'+turnos[t];
      if (!tSet[tKey]) {
        tSet[tKey] = true;
        output.teachers.push({docente:docente, materia:materia, grupo:grupo, turno:turnos[t]});
      }
    }
  }

  var jsonSheet = ss.getSheetByName('PARA_SISTEMA_HTML');
  if (jsonSheet) jsonSheet.clear(); else jsonSheet = ss.insertSheet('PARA_SISTEMA_HTML');
  jsonSheet.getRange('A1').setValue(JSON.stringify(output));
  jsonSheet.getRange('A2').setValue('INSTRUCCIONES: Copia el contenido de la celda A1 y pegalo en el Sistema HTML > Captura > Importar JSON');

  SpreadsheetApp.getUi().alert('Exportacion lista en pestana PARA_SISTEMA_HTML.\nAlumnos: ' + output.students.length + '\nCopia la celda A1 y pegala en el importador del Sistema HTML.');
}
