/**
 * firebase.js — Medickids Firebase initialization
 *
 * ⚠️  הגדרות: החלף את FIREBASE_CONFIG בערכים האמיתיים מ-Firebase Console.
 *    Project settings → Your apps → SDK setup and configuration → Config
 *
 * כדי שהקובץ הזה יעבוד:
 *   1. צור Firebase project ב-console.firebase.google.com
 *   2. הפעל Firestore (Native mode)
 *   3. הפעל Authentication → Sign-in method → Google
 *   4. הוסף את הדומיין שלך ל-Authorized domains
 *   5. הדבק את הconfig מ-Project settings כאן
 */

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// TODO: החלף בערכים מ-Firebase Console
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};
// ────────────────────────────────────────────────────────────────────────────

import { initializeApp }                    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence }
                                             from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider }       from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ─── INIT ────────────────────────────────────────────────────────────────────
const _app  = initializeApp(FIREBASE_CONFIG);
const db    = getFirestore(_app);
const auth  = getAuth(_app);
const googleProvider = new GoogleAuthProvider();

// Offline persistence (PWA חיוני) — נכשל בשקט אם כבר פתוח בטאב שני
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("[Firebase] Persistence disabled — multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.warn("[Firebase] Persistence not supported in this browser");
  }
});

export { db, auth, googleProvider };
