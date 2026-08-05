/**
 * db-firestore.js — Medickids data layer backed by Firestore
 *
 * ✅ אותו API בדיוק כמו db.js — app.js לא יודע ולא יצטרך לדעת.
 *
 * מבנה Firestore:
 *   families/{familyId}/
 *     ├── meta         (doc)  → { familyName, createdAt, members:[uid,...] }
 *     ├── children     (col)  → { id, name, emoji, color, weight, birthYear, weightUpdatedAt }
 *     ├── medicines    (doc)  → { list: string[] }
 *     ├── settings     (doc)  → { notifications: bool }
 *     ├── medEntries   (col)  → { childId, medicine, dose, note, time, reminderNotificationId, ... }
 *     ├── tempEntries  (col)  → { childId, value, time }
 *     └── prescriptions(col) → { childId, productId, status, startAt, endAt, isCourse, ... }
 *
 * עיקרון: DB.get() מחזיר snapshot סינכרוני מה-cache המקומי (IndexedDB).
 * כתיבות הולכות ישר ל-Firestore ומעדכנות את ה-cache.
 * onSnapshot listeners מעדכנים את ה-cache ברקע ומפעילים callback אחד (DB.onChange).
 */

import { db }                     from "./firebase.js";
import {
  collection, doc,
  getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, orderBy, where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── INTERNAL STATE ──────────────────────────────────────────────────────────

/** uid יציב לדיוק push — זהה ל-localStorage הישן, נשמר ב-sessionStorage + Firestore */
function _getOrCreateDeviceId() {
  let id = sessionStorage.getItem("mk_device_id");
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) +
         Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    sessionStorage.setItem("mk_device_id", id);
  }
  return id;
}

/** ה-cache הסינכרוני שנחשף דרך DB.get() */
let _state = {
  family:        "",
  familyId:      null,   // Firestore doc id
  children:      [],
  medicines:     ["אקמול ילדים", "נורופן", "נובימול", "ויטמין D"],
  medEntries:    [],
  tempEntries:   [],
  prescriptions: [],
  settings:      { notifications: false },
  deviceId:      _getOrCreateDeviceId(),
};

/** listeners מ-onSnapshot — נשמרים כדי לנתק בעת logout */
let _unsubs = [];

/** callback שה-app.js יכול לרשום — יקרא אחרי כל עדכון מ-Firestore */
let _onChange = null;

/** shortcut לנתיב families/{familyId} */
const _fam = () => doc(db, "families", _state.familyId);
const _col = (name) => collection(db, "families", _state.familyId, name);

// ─── UID helper ──────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── PRESCRIPTION MIGRATION (זהה ל-db.js) ───────────────────────────────────
function _migrateRx(rx) {
  return {
    isCourse:    false,
    totalDays:   null,
    dosesPerDay: null,
    doseLog:     [],
    ...rx,
  };
}

// ─── FIRESTORE LISTENERS ─────────────────────────────────────────────────────

/**
 * _subscribe(familyId)
 * פותח 5 onSnapshot listeners — אחד לכל collection.
 * בכל שינוי מ-Firestore → מעדכן את _state → קורא ל-_onChange().
 */
function _subscribe(familyId) {
  _unsubs.forEach((u) => u());
  _unsubs = [];

  // meta (family name, members)
  _unsubs.push(
    onSnapshot(_fam(), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      _state.family   = d.familyName || "";
      _state.settings = d.settings   || { notifications: false };
      _state.medicines = d.medicines  || _state.medicines;
      _notify();
    })
  );

  // children
  _unsubs.push(
    onSnapshot(_col("children"), (snap) => {
      _state.children = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      _notify();
    })
  );

  // medEntries — ordered newest first
  _unsubs.push(
    onSnapshot(
      query(_col("medEntries"), orderBy("time", "desc")),
      (snap) => {
        _state.medEntries = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        _notify();
      }
    )
  );

  // tempEntries
  _unsubs.push(
    onSnapshot(
      query(_col("tempEntries"), orderBy("time", "desc")),
      (snap) => {
        _state.tempEntries = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
        _notify();
      }
    )
  );

  // prescriptions
  _unsubs.push(
    onSnapshot(_col("prescriptions"), (snap) => {
      _state.prescriptions = snap.docs.map((d) => ({
        ..._migrateRx(d.data()),
        id: d.id,
      }));
      _notify();
    })
  );
}

function _notify() {
  if (typeof _onChange === "function") _onChange(_state);
}

// ─── INIT / CONNECT ──────────────────────────────────────────────────────────

/**
 * DB.connect(familyId, familyName?)
 * נקרא מ-auth.js אחרי שיש familyId מאומת.
 * מגדיר את familyId ב-state ופותח את כל ה-listeners.
 */
async function connect(familyId, familyName = "") {
  _state.familyId = familyId;
  if (familyName) _state.family = familyName;

  // וודא שה-family doc קיים
  const famSnap = await getDoc(_fam());
  if (!famSnap.exists()) {
    // משפחה חדשה — צור doc בסיסי
    await setDoc(_fam(), {
      familyName,
      createdAt: serverTimestamp(),
      members:   [],
      medicines: _state.medicines,
      settings:  _state.settings,
    });
  } else {
    // טען נתוני meta לפני שה-listener עולה
    const d = famSnap.data();
    _state.family    = d.familyName || "";
    _state.medicines = d.medicines  || _state.medicines;
    _state.settings  = d.settings   || _state.settings;
  }

  _subscribe(familyId);
}

/**
 * DB.disconnect()
 * נקרא ב-logout — סוגר את כל ה-listeners ומנקה את ה-state.
 */
function disconnect() {
  _unsubs.forEach((u) => u());
  _unsubs = [];
  _state  = {
    family: "", familyId: null,
    children: [], medicines: ["אקמול ילדים", "נורופן", "נובימול", "ויטמין D"],
    medEntries: [], tempEntries: [], prescriptions: [],
    settings: { notifications: false },
    deviceId: _getOrCreateDeviceId(),
  };
}

// ─── PUBLIC API (זהה ל-db.js) ────────────────────────────────────────────────

const DB = {

  // meta
  uid,
  get:          () => _state,
  onChange:     (fn) => { _onChange = fn; },
  connect,
  disconnect,

  // ── persist (עבור app.js שקורא DB.persist() אחרי שינוי ב-medicines) ───────
  async persist() {
    if (!_state.familyId) return;
    await updateDoc(_fam(), { medicines: _state.medicines });
  },

  // ── reset (Danger zone) ──────────────────────────────────────────────────
  async reset() {
    if (!_state.familyId) return;
    const batch = writeBatch(db);

    // מחק את כל הקולקציות
    for (const colName of ["children", "medEntries", "tempEntries", "prescriptions"]) {
      const snaps = await getDocs(_col(colName));
      snaps.forEach((d) => batch.delete(d.ref));
    }
    // אפס את ה-meta doc
    batch.update(_fam(), {
      familyName: "",
      medicines: ["אקמול ילדים", "נורופן", "נובימול", "ויטמין D"],
      settings: { notifications: false },
    });
    await batch.commit();
    // _state יתעדכן דרך ה-listeners
  },

  // ── MED ENTRIES ──────────────────────────────────────────────────────────

  async addMedEntry(entry) {
    const full = { time: Date.now(), ...entry };
    const ref  = await addDoc(_col("medEntries"), full);
    // מחזיר מיד עם id — לפני שה-listener חוזר (חשוב לtimestamp)
    const local = { ...full, id: ref.id };
    _state.medEntries.unshift(local);
    return local;
  },

  async updateMedEntry(id, patch) {
    await updateDoc(doc(db, "families", _state.familyId, "medEntries", id), patch);
    const e = _state.medEntries.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  },

  async deleteMedEntry(id) {
    await deleteDoc(doc(db, "families", _state.familyId, "medEntries", id));
    _state.medEntries = _state.medEntries.filter((x) => x.id !== id);
  },

  // ── TEMP ENTRIES ─────────────────────────────────────────────────────────

  async addTempEntry(entry) {
    const full = { time: Date.now(), ...entry };
    const ref  = await addDoc(_col("tempEntries"), full);
    _state.tempEntries.unshift({ ...full, id: ref.id });
  },

  async updateTempEntry(id, patch) {
    await updateDoc(doc(db, "families", _state.familyId, "tempEntries", id), patch);
    const e = _state.tempEntries.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  },

  async deleteTempEntry(id) {
    await deleteDoc(doc(db, "families", _state.familyId, "tempEntries", id));
    _state.tempEntries = _state.tempEntries.filter((x) => x.id !== id);
  },

  // ── CHILDREN ─────────────────────────────────────────────────────────────

  async updateChild(id, patch) {
    const c = _state.children.find((x) => x.id === id);
    if (c && patch.weight !== undefined && patch.weight !== c.weight) {
      patch.weightUpdatedAt = Date.now();
    }
    await updateDoc(doc(db, "families", _state.familyId, "children", id), patch);
    if (c) Object.assign(c, patch);
  },

  async addChild(child) {
    const data = {
      color: _state.children.length % 2 ? "a2" : "a1",
      weightUpdatedAt: Date.now(),
      ...child,
    };
    const ref = await addDoc(_col("children"), data);
    _state.children.push({ ...data, id: ref.id });
  },

  // ── SETTINGS ─────────────────────────────────────────────────────────────

  async setSetting(key, value) {
    _state.settings[key] = value;
    await updateDoc(_fam(), { [`settings.${key}`]: value });
  },

  // ── PRESCRIPTIONS ────────────────────────────────────────────────────────

  async addPrescription(rx) {
    const full = _migrateRx({
      status:  "active",
      startAt: Date.now(),
      endAt:   null,
      reminder: { on: true },
      ...rx,
    });
    const ref = await addDoc(_col("prescriptions"), full);
    const local = { ...full, id: ref.id };
    _state.prescriptions.unshift(local);
    return local;
  },

  async updatePrescription(id, patch) {
    await updateDoc(
      doc(db, "families", _state.familyId, "prescriptions", id),
      patch
    );
    const p = _state.prescriptions.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
    return p || null;
  },

  async deletePrescription(id) {
    await deleteDoc(
      doc(db, "families", _state.familyId, "prescriptions", id)
    );
    _state.prescriptions = _state.prescriptions.filter((x) => x.id !== id);
  },

  async logCourseDose(rxId, doseAmount) {
    const p = _state.prescriptions.find((x) => x.id === rxId);
    if (!p || !p.isCourse) return null;
    p.doseLog = p.doseLog || [];
    p.doseLog.push({ at: Date.now(), dose: doseAmount });
    const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
    if (totalDoses > 0 && p.doseLog.length >= totalDoses) {
      p.status = "completed";
      p.endAt  = Date.now();
    }
    await updateDoc(
      doc(db, "families", _state.familyId, "prescriptions", rxId),
      { doseLog: p.doseLog, status: p.status, endAt: p.endAt }
    );
    return p;
  },

  courseProgress(rxId) {
    const p = _state.prescriptions.find((x) => x.id === rxId);
    if (!p || !p.isCourse) return null;
    const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
    if (!totalDoses) return null;
    return Math.min(1, (p.doseLog?.length || 0) / totalDoses);
  },

  // ── READ HELPERS (סינכרוני — זהה ל-db.js) ───────────────────────────────

  activePrescriptionsFor: (childId) =>
    _state.prescriptions.filter((p) => p.childId === childId && p.status === "active"),

  lastMedFor: (childId) =>
    _state.medEntries
      .filter((e) => e.childId === childId)
      .sort((a, b) => b.time - a.time)[0] || null,

  lastTempFor: (childId) =>
    _state.tempEntries
      .filter((e) => e.childId === childId)
      .sort((a, b) => b.time - a.time)[0] || null,

  tempsFor: (childId) =>
    _state.tempEntries
      .filter((e) => e.childId === childId)
      .sort((a, b) => b.time - a.time),

  feed: (childId) => {
    const meds  = _state.medEntries.map((e) => ({ ...e, kind: "med" }));
    const temps = _state.tempEntries.map((e) => ({ ...e, kind: "temp" }));
    return meds
      .concat(temps)
      .filter((e) => !childId || e.childId === childId)
      .sort((a, b) => b.time - a.time);
  },

  nightSummary: (childId, withinHours = 12) => {
    const cutoff  = Date.now() - withinHours * 3600 * 1000;
    const isNight = (t) => { const h = new Date(t).getHours(); return h >= 22 || h < 6; };
    const meds    = _state.medEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
    const temps   = _state.tempEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
    if (!meds.length && !temps.length) return null;
    const maxTemp = temps.length ? Math.max(...temps.map((t) => t.value)) : null;
    return { medCount: meds.length, maxTemp };
  },
};

// Override window.DB so app.js (non-module) uses Firestore instead of localStorage
window.DB = DB;

export default DB;
export { DB };
