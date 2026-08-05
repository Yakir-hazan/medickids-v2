/* Simple localStorage-backed data layer.
   Swap-in point for IndexedDB later without touching app.js's public API. */
const DB = (() => {
  const KEY = 'madhom_v1';

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    return {
      family: '',
      children: [],
      medicines: ['אקמול ילדים', 'נורופן', 'נובימול', 'ויטמין D'],
      medEntries: [],
      tempEntries: [],
      prescriptions: [], // active/past treatments (e.g. "daily vitamin D reminder", future: antibiotic courses)
      settings: { notifications: false },
      // stable per-installation id used to target push notifications to THIS device only
      // (via OneSignal external_id / login) instead of broadcasting to all subscribers.
      // generated once and carried forward by the load() merge below on every existing install.
      deviceId: uid() + uid(),
    };
  }

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      raw = null; // localStorage itself inaccessible (very rare) — fall through to a fresh in-memory seed
    }

    if (!raw) {
      const s = seed();
      try { save(s); } catch (e) { /* nothing persisted yet; state still works in-memory for this session */ }
      return s;
    }

    try {
      // merge: any top-level field added to seed() since this user last saved (e.g. `prescriptions`)
      // gets its default value, without touching the user's existing data
      const merged = { ...seed(), ...JSON.parse(raw) };
      // Migration: ensure every existing prescription has COURSE fields (defaults for non-course rx)
      merged.prescriptions = merged.prescriptions.map(migrateRx);
      return merged;
    } catch (e) {
      // JSON is corrupted — back up the raw string BEFORE we overwrite it with a fresh seed,
      // so a corrupted save can still be recovered manually later (data isn't just gone silently)
      try { localStorage.setItem(KEY + '_corrupted_' + Date.now(), raw); } catch (e2) { /* best-effort backup only */ }
      const s = seed();
      try {
        save(s);
      } catch (e3) {
        // even a brand-new empty seed can't be saved (e.g. storage quota already full) — nothing
        // the user does from here on will persist, so this has to be loud, not a silent no-op
        alert('שגיאה קריטית: לא ניתן לשמור נתונים במכשיר זה. יש לפנות מקום אחסון ולרענן את הדף.');
      }
      return s;
    }
  }

  /* Ensure a prescription record has all COURSE fields.
     Safe to run on old records — leaves non-course prescriptions intact (isCourse stays false). */
  function migrateRx(rx) {
    return {
      isCourse:     false,   // true = antibiotic-style multi-day course
      totalDays:    null,    // number of days (e.g. 10)
      dosesPerDay:  null,    // doses per day (e.g. 2)
      doseLog:      [],      // [{at: timestamp, dose: number, childId}]
      ...rx,
    };
  }

  function save(state) {
    // intentionally NOT wrapped in try/catch here — if localStorage.setItem throws (e.g. quota
    // exceeded, Safari Private Browsing), the error propagates up to whoever called the DB write
    // method (addMedEntry, updateChild, etc.), which app.js catches to show a real failure toast
    // instead of silently claiming success. See app.js saveMed/saveTemp/saveKid/etc.
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  let state = load();

  return {
    uid,
    get: () => state,
    reset: () => { state = seed(); save(state); return state; },
    persist: () => save(state),

    addMedEntry(entry) {
      const full = { id: uid(), time: Date.now(), ...entry };
      state.medEntries.unshift(full);
      save(state);
      return full;
    },
    updateMedEntry(id, patch) {
      const e = state.medEntries.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      save(state);
    },
    deleteMedEntry(id) {
      state.medEntries = state.medEntries.filter((x) => x.id !== id);
      save(state);
    },
    addTempEntry(entry) {
      state.tempEntries.unshift({ id: uid(), time: Date.now(), ...entry });
      save(state);
    },
    updateTempEntry(id, patch) {
      const e = state.tempEntries.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
      save(state);
    },
    deleteTempEntry(id) {
      state.tempEntries = state.tempEntries.filter((x) => x.id !== id);
      save(state);
    },
    updateChild(id, patch) {
      const c = state.children.find((x) => x.id === id);
      if (c) {
        if (patch.weight !== undefined && patch.weight !== c.weight) patch.weightUpdatedAt = Date.now();
        Object.assign(c, patch);
      }
      save(state);
    },
    addChild(child) {
      state.children.push({ id: uid(), color: state.children.length % 2 ? 'a2' : 'a1', weightUpdatedAt: Date.now(), ...child });
      save(state);
    },
    setSetting(key, value) {
      state.settings[key] = value;
      save(state);
    },

    /* --- prescriptions: an active/past treatment for a specific child ---
       global array with a childId field on each record (not nested under the child), so queries
       like "all active prescriptions today" or "what's active for this child" stay simple filters.
       References the catalog by stable `productId`/`ingredientId` (not the display name), so a
       product's Hebrew label can change without breaking existing prescriptions.
       Only ever stores what's specific to THIS treatment (status, timing, reminder) — protocol
       defaults (intervalHours etc.) live in MEDICATION_CATALOG and are read from there, not copied.

       COURSE fields (isCourse: true):
         totalDays    — total days of treatment (e.g. 10)
         dosesPerDay  — doses per day (e.g. 2)
         doseLog      — [{at: timestamp, dose: number}] one entry per dose given
    */
    addPrescription(rx) {
      const full = migrateRx({
        id: uid(),
        status: 'active', // 'active' | 'completed' | 'cancelled'
        startAt: Date.now(),
        endAt: null,
        reminder: { on: true },
        ...rx,
      });
      state.prescriptions.unshift(full);
      save(state);
      return full;
    },
    updatePrescription(id, patch) {
      const p = state.prescriptions.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
      save(state);
      return p || null;
    },
    deletePrescription(id) {
      state.prescriptions = state.prescriptions.filter((x) => x.id !== id);
      save(state);
    },

    /* Log a single dose for a COURSE prescription.
       Returns the updated prescription, or null if not found. */
    logCourseDose(rxId, doseAmount) {
      const p = state.prescriptions.find((x) => x.id === rxId);
      if (!p || !p.isCourse) return null;
      p.doseLog.push({ at: Date.now(), dose: doseAmount });
      // auto-complete: if total doses reached, mark as completed
      const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
      if (totalDoses > 0 && p.doseLog.length >= totalDoses) {
        p.status = 'completed';
        p.endAt = Date.now();
      }
      save(state);
      return p;
    },

    /* Progress for a COURSE prescription (0–1 float, or null if not a course). */
    courseProgress(rxId) {
      const p = state.prescriptions.find((x) => x.id === rxId);
      if (!p || !p.isCourse) return null;
      const totalDoses = (p.totalDays || 0) * (p.dosesPerDay || 1);
      if (!totalDoses) return null;
      return Math.min(1, p.doseLog.length / totalDoses);
    },

    activePrescriptionsFor(childId) {
      return state.prescriptions.filter((p) => p.childId === childId && p.status === 'active');
    },
    lastMedFor(childId) {
      return state.medEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time)[0] || null;
    },
    lastTempFor(childId) {
      return state.tempEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time)[0] || null;
    },
    tempsFor(childId) {
      return state.tempEntries.filter((e) => e.childId === childId).sort((a, b) => b.time - a.time);
    },
    /* combined feed of meds + temps, newest first */
    feed(childId) {
      const meds = state.medEntries.map((e) => ({ ...e, kind: 'med' }));
      const temps = state.tempEntries.map((e) => ({ ...e, kind: 'temp' }));
      return meds.concat(temps)
        .filter((e) => !childId || e.childId === childId)
        .sort((a, b) => b.time - a.time);
    },
    /* night-window entries (22:00-06:00) in the last N hours, per child */
    nightSummary(childId, withinHours = 12) {
      const cutoff = Date.now() - withinHours * 3600 * 1000;
      const isNight = (t) => { const h = new Date(t).getHours(); return h >= 22 || h < 6; };
      const meds = state.medEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
      const temps = state.tempEntries.filter((e) => e.childId === childId && e.time >= cutoff && isNight(e.time));
      if (!meds.length && !temps.length) return null;
      const maxTemp = temps.length ? Math.max(...temps.map((t) => t.value)) : null;
      return { medCount: meds.length, maxTemp };
    },
  };
})();



