/**
 * firebase.js — Medickids Firebase initialization
 */

import { initializeApp }                              from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider }                from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBg2izecXmu0dHDCSpUAOe2JztbhdTQ7gY",
  authDomain:        "medickids-4b5de.firebaseapp.com",
  projectId:         "medickids-4b5de",
  storageBucket:     "medickids-4b5de.firebasestorage.app",
  messagingSenderId: "1015048057094",
  appId:             "1:1015048057094:web:3042aff8ba22a643e76e87",
  measurementId:     "G-W1FRY2Q8QV",
};

const _app = initializeApp(FIREBASE_CONFIG);
const db   = getFirestore(_app);
const auth = getAuth(_app);
const googleProvider = new GoogleAuthProvider();

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("[Firebase] Persistence disabled — multiple tabs open");
  } else if (err.code === "unimplemented") {
    console.warn("[Firebase] Persistence not supported in this browser");
  }
});

export { db, auth, googleProvider };
