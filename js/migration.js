/**
 * migration.js — העברה חד-פעמית מ-localStorage ל-Firestore
 *
 * קורא את כל הנתונים מ-localStorage (מפתח "madhom_v1"),
 * כותב אותם ל-Firestore תחת families/{familyId},
 * ולבסוף מסמן שהמיגרציה בוצעה (כדי שלא תרוץ שוב).
 *
 * הפעלה:
 *   import { migrateIfNeeded } from "./migration.js";
 *   await migrateIfNeeded(familyId);
 *
 * בטוח לקרוא כמה פעמים — פועל רק פעם אחת.
 */

import { db }                         from "./firebase.js";
import {
  doc, collection, addDoc, setDoc,
  writeBatch, getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LS_KEY        = "madhom_v1";
const MIGRATION_KEY = "mk_migrated_v1"; // sessionStorage flag

/**
 * migrateIfNeeded(familyId)
 * אם יש נתונים ב-localStorage שעוד לא הועברו — מעביר אותם.
 * מחזיר { migrated: true } אם הועבר, { migrated: false } אחרת.
 */
export async function migrateIfNeeded(familyId) {
  // כבר עבר מיגרציה ב-session זה
  if (sessionStorage.getItem(MIGRATION_KEY)) {
    return { migrated: false };
  }

  // בדוק שיש נתונים ב-localStorage
  let localData;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) { _markDone(); return { migrated: false }; }
    localData = JSON.parse(raw);
  } catch {
    _markDone();
    return { migrated: false };
  }

  // בדוק אם ה-family doc כבר יש בו ילדים — אם כן, דלג
  const famRef = doc(db, "families", familyId);
  const famSnap = await getDoc(famRef);
  if (famSnap.exists() && famSnap.data()._migrationDone) {
    _markDone();
    return { migrated: false };
  }

  console.info("[Migration] מתחיל העברת נתונים מ-localStorage…");

  try {
    await _runMigration(familyId, localData);
    // סמן ב-Firestore שהמיגרציה נגמרה
    await setDoc(famRef, { _migrationDone: true }, { merge: true });
    _markDone();
    console.info("[Migration] הסתיימה בהצלחה ✓");
    return { migrated: true };
  } catch (err) {
    console.error("[Migration] נכשלה:", err);
    // לא מסמנים — ננסה שוב בפעם הבאה
    return { migrated: false, error: err.message };
  }
}

// ─── INTERNALS ───────────────────────────────────────────────────────────────

function _markDone() {
  sessionStorage.setItem(MIGRATION_KEY, "1");
}

/**
 * כותב את כל הנתונים מ-localStorage ל-Firestore ב-batches.
 * Firestore מגביל ל-500 פעולות לכל batch.
 */
async function _runMigration(familyId, data) {
  const famRef = doc(db, "families", familyId);

  // ── 1. family meta ──────────────────────────────────────────────────────
  await setDoc(famRef, {
    familyName: data.family || "",
    medicines:  data.medicines || ["אקמול ילדים", "נורופן", "נובימול", "ויטמין D"],
    settings:   data.settings  || { notifications: false },
  }, { merge: true });

  // ── 2. children ─────────────────────────────────────────────────────────
  if (data.children?.length) {
    const batch = writeBatch(db);
    for (const child of data.children) {
      const { id, ...rest } = child;
      // שמור עם ה-id המקורי כ-doc id כדי שהפניות מ-medEntries/tempEntries ישמרו תקינות
      const ref = doc(db, "families", familyId, "children", id);
      batch.set(ref, rest);
    }
    await batch.commit();
  }

  // ── 3. medEntries (בחלוקה ל-batches של 400) ────────────────────────────
  await _batchWrite(familyId, "medEntries", data.medEntries || []);

  // ── 4. tempEntries ──────────────────────────────────────────────────────
  await _batchWrite(familyId, "tempEntries", data.tempEntries || []);

  // ── 5. prescriptions ────────────────────────────────────────────────────
  await _batchWrite(familyId, "prescriptions", data.prescriptions || []);
}

/**
 * כותב מערך של רשומות ל-collection, תוך שמירה על id המקורי.
 * מחלק ל-batches של 400 (מרווח ביטחון מ-500).
 */
async function _batchWrite(familyId, colName, items) {
  if (!items.length) return;
  const BATCH_SIZE = 400;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = items.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      const { id, ...rest } = item;
      const ref = doc(db, "families", familyId, colName, id);
      batch.set(ref, rest);
    }
    await batch.commit();
  }
}
