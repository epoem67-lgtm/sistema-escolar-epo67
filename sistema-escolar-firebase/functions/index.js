// ═══════════════════════════════════════════════════════════════
// CLOUD FUNCTIONS — Sistema Escolar EPO 67
// Reset autonomo de contrasenas (junio 2026).
//
// NOTA (v8.63): El cliente usa fetch() directo en lugar del SDK
// httpsCallable para evitar incompatibilidades entre SDK v8 compat
// y Cloud Functions v2 (Cloud Run).
// ═══════════════════════════════════════════════════════════════

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const auth = getAuth();
const db = getFirestore();

// ─── Helpers ────────────────────────────────────────────────────
function sha256(text) {
  return crypto.createHash('sha256')
    .update(text.toLowerCase().trim())
    .digest('hex');
}

function generateTempPassword() {
  // 8 caracteres: 4 letras + 4 numeros. Fackiles de dictar/copiar.
  const letters = 'abcdefghkmnpqrstuvwxyz'; // sin caracteres confusos i, j, l, o
  const numbers = '23456789'; // sin 0 y 1 (confunden con o y l)
  let pwd = '';
  for (let i = 0; i < 4; i++) pwd += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++) pwd += numbers[Math.floor(Math.random() * numbers.length)];
  return pwd;
}

async function logAttempt(uid, success, reason = '') {
  try {
    await db.collection('passwordResetLog').add({
      uid: uid || 'unknown',
      success,
      reason,
      timestamp: FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('[logAttempt] no se pudo registrar:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNCTION 1: getSecurityQuestion
// Recibe un email y retorna la pregunta de seguridad asociada
// (sin revelar si el email existe o no para evitar enumeracion).
// ═══════════════════════════════════════════════════════════════
exports.getSecurityQuestion = onCall(
  { region: 'us-central1', maxInstances: 10, cors: true },
  async (request) => {
    const { email } = request.data || {};

    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'Falta el correo.');
    }

    const cleanEmail = email.trim().toLowerCase();

    // Buscar usuario por email en Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(cleanEmail);
    } catch (e) {
      // No revelar si existe o no
      return { question: null, hasSecurityQuestion: false };
    }

    // Buscar doc en Firestore
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    if (!userDoc.exists) {
      return { question: null, hasSecurityQuestion: false };
    }

    const data = userDoc.data();
    if (!data.securityQuestion || !data.securityAnswerHash) {
      return { question: null, hasSecurityQuestion: false };
    }

    return {
      question: data.securityQuestion,
      hasSecurityQuestion: true
    };
  }
);

// ═══════════════════════════════════════════════════════════════
// FUNCTION 2: resetPasswordWithSecurityQuestion
// Recibe email + respuesta de seguridad. Si la respuesta es
// correcta, genera contrasena temporal y la retorna al cliente.
// ═══════════════════════════════════════════════════════════════
exports.resetPasswordWithSecurityQuestion = onCall(
  { region: 'us-central1', maxInstances: 10, cors: true },
  async (request) => {
    const { email, answer } = request.data || {};

    if (!email || !answer) {
      throw new HttpsError('invalid-argument', 'Faltan datos.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanAnswer = String(answer).toLowerCase().trim();

    // Buscar usuario
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(cleanEmail);
    } catch (e) {
      await logAttempt(null, false, `email-not-found:${cleanEmail}`);
      throw new HttpsError('not-found', 'No encontramos esta cuenta.');
    }

    // Verificar bloqueo (3 intentos fallidos = 1 hora de bloqueo)
    const userDocRef = db.collection('users').doc(userRecord.uid);
    const userDoc = await userDocRef.get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (userData.resetLockedUntil) {
      const lockedUntil = userData.resetLockedUntil.toDate
        ? userData.resetLockedUntil.toDate()
        : new Date(userData.resetLockedUntil);
      if (lockedUntil > new Date()) {
        const mins = Math.ceil((lockedUntil - new Date()) / 60000);
        throw new HttpsError('resource-exhausted',
          `Demasiados intentos fallidos. Espera ${mins} minuto(s) antes de volver a intentar.`);
      }
    }

    // Verificar pregunta de seguridad
    if (!userData.securityAnswerHash) {
      throw new HttpsError('failed-precondition',
        'Esta cuenta no tiene pregunta de seguridad configurada. Pide a Olivia que te ayude.');
    }

    const inputHash = sha256(cleanAnswer);
    if (inputHash !== userData.securityAnswerHash) {
      // Incrementar contador de fallos
      const failedCount = (userData.resetFailedAttempts || 0) + 1;
      const update = { resetFailedAttempts: failedCount };
      if (failedCount >= 3) {
        update.resetLockedUntil = new Date(Date.now() + 60 * 60 * 1000); // +1h
        update.resetFailedAttempts = 0;
      }
      await userDocRef.update(update);
      await logAttempt(userRecord.uid, false, 'wrong-answer');
      throw new HttpsError('permission-denied',
        `Respuesta incorrecta. Te quedan ${3 - failedCount} intento(s) antes de bloqueo.`);
    }

    // Respuesta correcta. Generar contrasena temporal.
    const newPassword = generateTempPassword();

    try {
      await auth.updateUser(userRecord.uid, { password: newPassword });
      await userDocRef.update({
        mustChangePassword: true,
        resetFailedAttempts: 0,
        resetLockedUntil: null,
        lastPasswordResetAt: FieldValue.serverTimestamp()
      });
      await logAttempt(userRecord.uid, true, 'auto-reset-via-security-question');

      return {
        success: true,
        password: newPassword,
        email: cleanEmail,
        displayName: userRecord.displayName || cleanEmail
      };
    } catch (e) {
      console.error('[resetPassword] falla al actualizar:', e);
      throw new HttpsError('internal', 'Error al aplicar la nueva contrasena. Reporta a Olivia.');
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// FUNCTION 3: setSecurityQuestion
// El usuario LOGUEADO configura su pregunta+respuesta de seguridad.
// La respuesta se guarda como SHA-256 hash.
// (Nota: el cliente ya usa write directo a Firestore para esto,
//  pero se mantiene la función por compatibilidad.)
// ═══════════════════════════════════════════════════════════════
exports.setSecurityQuestion = onCall(
  { region: 'us-central1', maxInstances: 10, cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Inicia sesion primero.');
    }

    const { question, answer } = request.data || {};
    if (!question || !answer) {
      throw new HttpsError('invalid-argument', 'Faltan pregunta o respuesta.');
    }
    if (String(question).length < 5 || String(answer).length < 2) {
      throw new HttpsError('invalid-argument', 'Pregunta o respuesta demasiado corta.');
    }

    const uid = request.auth.uid;
    const answerHash = sha256(String(answer));

    await db.collection('users').doc(uid).update({
      securityQuestion: String(question).trim(),
      securityAnswerHash: answerHash,
      securityQuestionSetAt: FieldValue.serverTimestamp()
    });

    return { success: true };
  }
);
