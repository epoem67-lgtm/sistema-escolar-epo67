// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN FIREBASE
// Cambia estos valores por los de tu proyecto Firebase
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDX4za0avN20Lplmf5LAR7pdfZlvNtvcJc",
  authDomain: "epo67-sistema.firebaseapp.com",
  projectId: "epo67-sistema",
  storageBucket: "epo67-sistema.firebasestorage.app",
  messagingSenderId: "425082037377",
  appId: "1:425082037377:web:4bd72a502c874acfa25980"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Referencias globales
const db = firebase.firestore();
const auth = firebase.auth();
const storage = firebase.storage();

// Proveedor de Google
const googleProvider = new firebase.auth.GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ═══════════════════════════════════════════════════════════════
// HELPERS DE FIRESTORE
// ═══════════════════════════════════════════════════════════════

const DB = {
  // Colecciones principales
  config: () => db.collection('config'),
  users: () => db.collection('users'),
  teachers: () => db.collection('teachers'),
  groups: () => db.collection('groups'),
  subjects: () => db.collection('subjects'),
  assignments: () => db.collection('assignments'),
  assignmentsByGroup: () => db.collection('assignmentsByGroup'),
  students: () => db.collection('students'),
  grades: () => db.collection('grades'),
  partials: () => db.collection('partials'),
  atRisk: () => db.collection('atRisk'),
  activityLog: () => db.collection('activityLog'),
  enrollments: () => db.collection('enrollments'),

  // Helpers
  doc: (collection, id) => db.collection(collection).doc(id),
  timestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
  increment: (n) => firebase.firestore.FieldValue.increment(n),
  arrayUnion: (...items) => firebase.firestore.FieldValue.arrayUnion(...items),
  arrayRemove: (...items) => firebase.firestore.FieldValue.arrayRemove(...items),
  batch: () => db.batch(),

  // Log de actividad
  async log(action, details = {}) {
    try {
      await db.collection('activityLog').add({
        action,
        details,
        userId: auth.currentUser?.uid || 'system',
        userEmail: auth.currentUser?.email || 'system',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.warn('Error logging activity:', e);
    }
  }
};

// Nota: No usamos ES6 exports porque los scripts se cargan globalmente
// Los objetos db, auth, storage, googleProvider, y DB están disponibles
// como variables globales para app.js
