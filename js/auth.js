/**
 * auth.js — Medickids Authentication & Family routing
 *
 * Flow:
 *   1. onAuthStateChanged → יש user?
 *      כן  → חפש family לפי uid → connect DB → migrate → renderApp()
 *      לא  → הצג מסך Google Sign-In
 *   2. Sign-In עם Google → אם משפחה חדשה → Onboarding (שם משפחה)
 *   3. שיתוף בן/בת זוג → קוד הצטרפות 6 ספרות
 */

import { auth, googleProvider, db }  from "./firebase.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc,
  collection, query, where, getDocs, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { DB }                         from "./db-firestore.js";
import { migrateIfNeeded }            from "./migration.js";

// ─── FAMILY HELPERS ──────────────────────────────────────────────────────────

/**
 * מחפש family לפי uid של המשתמש.
 * מחזיר familyId אם נמצא, null אחרת.
 */
async function _findFamilyForUser(uid) {
  const q = query(
    collection(db, "families"),
    where("members", "array-contains", uid)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

/**
 * יוצר family חדשה עבור משתמש.
 * מחזיר familyId.
 */
async function _createFamily(uid, familyName) {
  // קוד הצטרפות 6 ספרות — ייחודי מספיק לצרכינו
  const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();

  const ref = doc(collection(db, "families"));
  await setDoc(ref, {
    familyName,
    members:   [uid],
    joinCode,
    createdAt: serverTimestamp(),
    medicines: ["אקמול ילדים", "נורופן", "נובימול", "ויטמין D"],
    settings:  { notifications: false },
  });
  return ref.id;
}

/**
 * מצטרף למשפחה קיימת לפי קוד.
 * מחזיר familyId אם הצליח, null אם הקוד לא נמצא.
 */
async function joinFamily(joinCode) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("לא מחובר");

  const q = query(
    collection(db, "families"),
    where("joinCode", "==", joinCode.toUpperCase())
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const famDoc = snap.docs[0];
  const members = famDoc.data().members || [];
  if (!members.includes(uid)) {
    await updateDoc(famDoc.ref, { members: [...members, uid] });
  }
  return famDoc.id;
}

// ─── PUBLIC AUTH API ─────────────────────────────────────────────────────────

const Auth = {

  /**
   * Auth.init(callbacks)
   * קרא פעם אחת ב-DOMContentLoaded.
   * callbacks: { onReady, onNeedFamilyName, onNeedAuth, onError }
   *
   * onReady(state)         — המשך ל-app רגיל
   * onNeedFamilyName(uid)  — משתמש חדש, צריך להזין שם משפחה
   * onNeedAuth()           — הצג כפתור Google Sign-In
   * onError(err)           — שגיאה
   */
  init({ onReady, onNeedFamilyName, onNeedAuth, onError }) {
    // טפל בחזרה מ-redirect (iOS Google Sign-In)
    getRedirectResult(auth).catch((err) => {
      if (err.code !== "auth/cancelled-popup-request") {
        console.error("[Auth] redirect result error:", err);
      }
    });

    onAuthStateChanged(auth, async (user) => {
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:onAuthStateChanged',user ? "user="+user.uid : "no user");}catch(_){}
      if (!user) {
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:onNeedAuth',"");}catch(_){}
        onNeedAuth();
        return;
      }

      try {
        // 1. מצא family
        let familyId = await _findFamilyForUser(user.uid);

        // 2. משתמש חדש לגמרי — צריך שם משפחה לפני שיוצרים family
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:familyId',familyId || "null - new user");}catch(_){}
        if (!familyId) {
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:onNeedFamilyName',"");}catch(_){}
          onNeedFamilyName(user.uid, user.displayName);
          return;
        }

        // 3. חבר ל-DB
        const famSnap = await getDoc(doc(db, "families", familyId));
        const familyName = famSnap.data()?.familyName || "";
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:DB.connect',familyId);}catch(_){}
        await DB.connect(familyId, familyName);

        // 4. מיגרציה מ-localStorage (חד-פעמית)
        await migrateIfNeeded(familyId);

        // 5. הכל מוכן
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:onReady',"");}catch(_){}
        onReady(DB.get());

      } catch (err) {
        console.error("[Auth] שגיאה באתחול:", err);
    try{window.DevCenter&&window.DevCenter.log('ERROR','Auth:catch',err.message+"\\n"+(err.stack||"").slice(0,300));}catch(_){}
        onError(err);
      }
    });
  },

  /**
   * Auth.signInWithGoogle()
   * iOS → redirect (popup לא עובד ב-Safari/PWA)
   * אחר → popup
   */
  async signInWithGoogle() {
    try{window.DevCenter&&window.DevCenter.log('INFO','Auth:signInWithGoogle',"");}catch(_){}

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    try {
      if (isIOS) {
        await signInWithRedirect(auth, googleProvider);
        // הדף יעשה redirect — onAuthStateChanged יטפל בחזרה
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        console.error("[Auth] Google sign-in failed:", err);
        throw err;
      }
    }
  },

  /**
   * Auth.createFamily(uid, familyName)
   * נקרא אחרי שהמשתמש הזין שם משפחה ב-Onboarding.
   */
  async createFamily(familyName) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("לא מחובר");
    const familyId = await _createFamily(uid, familyName);
    await DB.connect(familyId, familyName);
    await migrateIfNeeded(familyId);
    return familyId;
  },

  /**
   * Auth.joinFamily(joinCode)
   * בן/בת זוג מזין קוד הצטרפות.
   * מחזיר true אם הצליח.
   */
  async joinFamily(joinCode) {
    const familyId = await joinFamily(joinCode);
    if (!familyId) return false;
    const famSnap = await getDoc(doc(db, "families", familyId));
    const familyName = famSnap.data()?.familyName || "";
    await DB.connect(familyId, familyName);
    return true;
  },

  /**
   * Auth.getJoinCode()
   * מחזיר את קוד ההצטרפות של המשפחה הנוכחית.
   */
  async getJoinCode() {
    const familyId = DB.get().familyId;
    if (!familyId) return null;
    const snap = await getDoc(doc(db, "families", familyId));
    return snap.data()?.joinCode || null;
  },

  /**
   * Auth.signOut()
   */
  async signOut() {
    DB.disconnect();
    await signOut(auth);
  },


  /**
   * Auth.signInWithEmail(email, password)
   */
  async signInWithEmail(email, password) {
    const { signInWithEmailAndPassword } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
    );
    await signInWithEmailAndPassword(auth, email, password);
  },

  /**
   * Auth.registerWithEmail(email, password)
   */
  async registerWithEmail(email, password) {
    const { createUserWithEmailAndPassword } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
    );
    await createUserWithEmailAndPassword(auth, email, password);
  },

  /**
   * Auth.resetPassword(email)
   */
  async resetPassword(email) {
    const { sendPasswordResetEmail } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
    );
    await sendPasswordResetEmail(auth, email);
  },

  /** המשתמש הנוכחי */
  currentUser: () => auth.currentUser,
};

export { Auth, joinFamily };
