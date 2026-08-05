/**
 * main.js — Medickids entry point
 *
 * סדר טעינה:
 *   1. Auth.init() מאזין ל-onAuthStateChanged
 *   2. onNeedAuth()       → מציג מסך Login
 *   3. onNeedFamilyName() → מציג מסך Onboarding
 *   4. onReady(state)     → מזריק state ל-DB, קורא App.init()
 */

import { Auth } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {

  Auth.init({

    // ── המשתמש לא מחובר ──────────────────────────────────────────────
    onNeedAuth() {
      _show("screen-login");
    },

    // ── משתמש חדש — צריך שם משפחה ───────────────────────────────────
    onNeedFamilyName(uid, displayName) {
      // מלא שם מוצע אם יש
      const nameInput = document.getElementById("onboarding-name");
      if (nameInput && displayName) {
        // displayName = "ישראל ישראלי" → שם משפחה אחרון
        const parts = displayName.trim().split(" ");
        if (parts.length > 1) nameInput.value = parts[parts.length - 1];
      }
      _show("screen-onboarding");
    },

    // ── הכל מוכן — אפשר להפעיל את האפליקציה ─────────────────────────
    onReady(state) {
      // החלף את DB.get() של localStorage ב-state של Firestore
      // db-firestore.js כבר חיבר את DB לפני שנקרא onReady
      App.init();
    },

    onError(err) {
      console.error("[main] Auth error:", err);
      _show("screen-login");
    },
  });

  // ── כפתור Google Sign-In ──────────────────────────────────────────────
  document.getElementById("btn-google-signin")?.addEventListener("click", async () => {
    try {
      _setLoading("btn-google-signin", true);
      await Auth.signInWithGoogle();
      // onAuthStateChanged יטפל בהמשך
    } catch (err) {
      console.error(err);
    } finally {
      _setLoading("btn-google-signin", false);
    }
  });

  // ── כפתור המשך אחרי הזנת שם משפחה ───────────────────────────────────
  document.getElementById("btn-onboarding-continue")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("onboarding-name");
    const familyName = nameInput?.value.trim();
    if (!familyName) {
      nameInput?.focus();
      return;
    }
    try {
      _setLoading("btn-onboarding-continue", true);
      await Auth.createFamily(familyName);
      App.init();
    } catch (err) {
      console.error("[main] createFamily error:", err);
    } finally {
      _setLoading("btn-onboarding-continue", false);
    }
  });

});

// ── helpers ───────────────────────────────────────────────────────────────
function _show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId)?.classList.add("active");
}

function _setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn.style.opacity = on ? "0.6" : "1";
}
