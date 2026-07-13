/**
 * FIX puntual — calificación de WENDY GABRIELA COMO MONTOYA
 * Materia: práctica y colaboración ciudadana II  (componente socioemocional)
 * Parcial: P2
 * Grupo:   3-2 MATUTINO
 *
 * Contexto del bug (1 jun 2026):
 * - La cal correcta debía ser 10. La edición directa del 1 jun a las 9:00am
 *   (sin pasar por el flujo de correcciones) dejó el doc en cal=8.
 * - No quedó rastro en el panel de correcciones porque la edición fue directa.
 * - Esta materia es socioemocional → PE no aplica. Para cal=10 necesita EC=8 + TR=2.
 *
 * Este script:
 *   1. Genera un folio ADM-... (formato igual al de admin_direct)
 *   2. Crea un doc en /gradeCorrections con status='applied' (trazabilidad)
 *   3. Actualiza /grades/{determinístico} con la nueva cal y vincula el folio
 *   4. Verifica ambos
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = JSON.parse(fs.readFileSync(
  path.join(require('os').homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'
)).tokens.access_token;
const BASE = `/v1/projects/epo67-sistema/databases/(default)/documents`;

const STUDENT_ID    = 'wTuMAwDdLzzsFAy7BV9k';
const STUDENT_NAME  = 'COMO MONTOYA WENDY GABRIELA';
const SUBJECT_ID    = 'G3_práctica_y_colaboración_ciudadana_ii';
const SUBJECT_NAME  = 'práctica y colaboración ciudadana ii';
const PARTIAL       = 'P2';
const GROUP_ID      = 'MATUTINO_3-2';
const GROUP_NAME    = '3-2';
const TURNO         = 'MATUTINO';
const GRADO         = 3;

const OLIVIA_UID    = 'X2jjeI8nkqVQ8tMYfI2AzyX51sW2';
const OLIVIA_NAME   = 'OLIVIA PEÑA RAMIREZ';

const NEW_CAL = 10;
const PREV_CAL = 8;        // lo que está ahora (resultado de la edición errónea del 1 jun)
const NEW_EC = 8;          // para que ec+tr=10 sin PE
const NEW_TR = 2;
const NEW_PE = 1;          // se conserva el campo del maestro, aunque no suma por ser socioemocional
const NEW_SUMA = 10;       // ec + tr (PE no aplica)
const REASON = 'Corrección admin (re-aplicación). El maestro Velez Salazar Marco Antonio corrigió 9→10 directamente en captura mientras P2 estaba abierto (antes del 20-may-2026), pero el cambio nunca llegó a la base de datos (no se guardó o fue sobrescrito). Este folio admin re-aplica la cal correcta=10 con trazabilidad para que conste en el panel de correcciones, boletas y PDFs. Materia socioemocional (PE no aplica) → EC=8 + TR=2 = 10.';

function nowIso() { return new Date().toISOString(); }
function _pad(n) { return String(n).padStart(2, '0'); }
function genFolio() {
  const d = new Date();
  return `ADM-${d.getFullYear()}${_pad(d.getMonth()+1)}${_pad(d.getDate())}-${_pad(d.getHours())}${_pad(d.getMinutes())}${_pad(d.getSeconds())}-${OLIVIA_UID.slice(-4)}`;
}

function req(method, urlPath, body) {
  return new Promise((res, rej) => {
    const opts = {
      hostname: 'firestore.googleapis.com',
      path: urlPath,
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    const r = https.request(opts, (resp) => {
      let d = ''; resp.on('data', c => d += c);
      resp.on('end', () => resp.statusCode < 300 ? res(d ? JSON.parse(d) : {}) : rej(new Error(`HTTP ${resp.statusCode}: ${d}`)));
    });
    r.on('error', rej);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// Helpers para construir fields según el formato REST de Firestore
const F = {
  s: v => ({ stringValue: String(v) }),
  i: v => ({ integerValue: String(v) }),
  d: v => ({ doubleValue: v }),
  t: v => ({ timestampValue: v }),
};

async function main() {
  const FOLIO = genFolio();
  const NOW   = nowIso();
  console.log(`Folio admin a generar: ${FOLIO}`);
  console.log(`Cambio: cal ${PREV_CAL} → ${NEW_CAL} para ${STUDENT_NAME}`);
  console.log(`Materia: ${SUBJECT_NAME} P${PARTIAL.slice(1)} · grupo ${GROUP_NAME}`);
  console.log('');

  // ── 1. Crear gradeCorrection (status='applied', source='admin_direct') ──
  // Usamos POST con documentId? No, no se puede. Mejor PATCH con createIfMissing=false
  // ni necesario; usaremos POST para crear con ID generado por Firestore.
  console.log('1) Creando doc en gradeCorrections...');
  const corrFields = {
    folio:              F.s(FOLIO),
    status:             F.s('applied'),
    studentId:          F.s(STUDENT_ID),
    studentName:        F.s(STUDENT_NAME),
    subjectId:          F.s(SUBJECT_ID),
    subjectName:        F.s(SUBJECT_NAME),
    partial:            F.s(PARTIAL),
    groupId:            F.s(GROUP_ID),
    groupName:          F.s(GROUP_NAME),
    turno:              F.s(TURNO),
    grado:              F.i(GRADO),
    currentGrade:       F.i(PREV_CAL),
    newGrade:           F.i(NEW_CAL),
    reason:             F.s(REASON),
    requestedBy:        F.s(OLIVIA_UID),
    requestedByName:    F.s(OLIVIA_NAME),
    requestedAt:        F.t(NOW),
    appliedBy:          F.s(OLIVIA_UID),
    appliedByName:      F.s(OLIVIA_NAME),
    appliedAt:          F.t(NOW),
    source:             F.s('admin_direct'),
    teacherId:          F.s('Q7Y0udfY5MBgHdSXClYq'),       // maestro real de la materia
    teacherName:        F.s('VELEZ SALAZAR MARCO ANTONIO'),
  };
  const corrRes = await req('POST', `${BASE}/gradeCorrections`, { fields: corrFields });
  const corrDocId = corrRes.name.split('/').pop();
  console.log(`   ✓ creado: gradeCorrections/${corrDocId}`);

  // ── 2. Actualizar /grades/{determinístico} ──
  console.log('2) Actualizando grade...');
  const gradeDocId = `${STUDENT_ID}_${SUBJECT_ID}_${PARTIAL}`;
  const enc = encodeURIComponent(gradeDocId);
  // Fields a actualizar con updateMask
  const gradeFields = {
    cal:              F.i(NEW_CAL),
    value:            F.i(NEW_CAL),
    suma:             F.i(NEW_SUMA),
    ec:               F.i(NEW_EC),
    tr:               F.i(NEW_TR),
    pe:               F.i(NEW_PE),
    updatedAt:        F.t(NOW),
    updatedBy:        F.s(OLIVIA_UID),
    correctionFolio:  F.s(FOLIO),
    correctedAt:      F.t(NOW),
    correctedFromCal: F.i(PREV_CAL),
  };
  const maskFields = Object.keys(gradeFields);
  const maskQs = maskFields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  await req('PATCH', `${BASE}/grades/${enc}?${maskQs}`, { fields: gradeFields });
  console.log(`   ✓ actualizado: grades/${gradeDocId}`);

  // ── 3. Verificar ──
  console.log('\n3) Verificación post-cambio:');
  const checkGrade = await req('GET', `${BASE}/grades/${enc}`);
  const cf = checkGrade.fields;
  console.log(`   grade.cal=${cf.cal?.integerValue} suma=${cf.suma?.integerValue} ec=${cf.ec?.integerValue} tr=${cf.tr?.integerValue} pe=${cf.pe?.integerValue}`);
  console.log(`   grade.correctionFolio="${cf.correctionFolio?.stringValue}" correctedFromCal=${cf.correctedFromCal?.integerValue}`);

  const checkCorr = await req('GET', `${BASE}/gradeCorrections/${corrDocId}`);
  const ccf = checkCorr.fields;
  console.log(`   correction.status=${ccf.status?.stringValue} folio=${ccf.folio?.stringValue}`);
  console.log(`   correction.currentGrade=${ccf.currentGrade?.integerValue} → newGrade=${ccf.newGrade?.integerValue}`);
  console.log(`   correction.appliedByName="${ccf.appliedByName?.stringValue}"`);

  if (cf.cal?.integerValue === String(NEW_CAL) && ccf.status?.stringValue === 'applied') {
    console.log('\n✅ Corrección aplicada correctamente con folio formal.');
    console.log(`   Folio: ${FOLIO}`);
    console.log('   Aparecerá en "Correcciones de Calificación" pestaña Aplicadas tras refresh.');
  } else {
    console.log('\n⚠️  Revisar: algo no quedó como esperado.');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
