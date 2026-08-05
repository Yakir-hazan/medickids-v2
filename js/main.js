/**
 * main.js — Medickids entry point
 */

import { Auth } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {

  const mq  = window.matchMedia('(display-mode: standalone)').matches;
  const nav = window.navigator.standalone === true;
  const isStandalone = mq || nav;

  if (!isStandalone) {
    App.init({ authDone: false });
    return;
  }

  // PWA מותקן → Auth
  Auth.init({
    onNeedAuth() {
      _show("screen-login");
    },

    onNeedFamilyName(uid, displayName) {
      const nameInput = document.getElementById("onboarding-name");
      if (nameInput && displayName) {
        const parts = displayName.trim().split(" ");
        if (parts.length > 1) nameInput.value = parts[parts.length - 1];
      }
      _show("screen-onboarding");
    },

    onReady(state) {
      App.init({ authDone: true });
    },

    onError(err) {
      console.error("[Auth error]", err);
      _show("screen-login");
    },
  });

  // ─── Google Sign-In ───────────────────────────────────────────────────────
  document.getElementById("btn-google-signin")?.addEventListener("click", async () => {
    try {
      _setLoading("btn-google-signin", true);
      await Auth.signInWithGoogle();
    } catch (err) {
      _showAuthError(err.message);
    } finally {
      _setLoading("btn-google-signin", false);
    }
  });

  // ─── Email/Password Sign-In ───────────────────────────────────────────────
  document.getElementById("btn-email-signin")?.addEventListener("click", async () => {
    const email = document.getElementById("input-email")?.value.trim();
    const password = document.getElementById("input-password")?.value;
    if (!email || !password) { _showAuthError("יש למלא מייל וסיסמא"); return; }
    try {
      _setLoading("btn-email-signin", true);
      await Auth.signInWithEmail(email, password);
    } catch (err) {
      _showAuthError(_emailError(err.code));
    } finally {
      _setLoading("btn-email-signin", false);
    }
  });

  // ─── Email/Password Register ──────────────────────────────────────────────
  document.getElementById("btn-email-register")?.addEventListener("click", async () => {
    const email = document.getElementById("input-email")?.value.trim();
    const password = document.getElementById("input-password")?.value;
    if (!email || !password) { _showAuthError("יש למלא מייל וסיסמא"); return; }
    if (password.length < 6) { _showAuthError("הסיסמא חייבת להכיל לפחות 6 תווים"); return; }
    try {
      _setLoading("btn-email-register", true);
      await Auth.registerWithEmail(email, password);
      // onAuthStateChanged יטפל בהמשך
    } catch (err) {
      _showAuthError(_emailError(err.code));
    } finally {
      _setLoading("btn-email-register", false);
    }
  });

  // ─── Forgot Password ──────────────────────────────────────────────────────
  document.getElementById("btn-forgot-password")?.addEventListener("click", async () => {
    const email = document.getElementById("input-email")?.value.trim();
    if (!email) { _showAuthError("הזן מייל כדי לאפס סיסמא"); return; }
    try {
      await Auth.resetPassword(email);
      _showAuthError("נשלח מייל לאיפוס סיסמא ✓", false);
    } catch (err) {
      _showAuthError(_emailError(err.code));
    }
  });

  // ─── Onboarding Continue ──────────────────────────────────────────────────
  document.getElementById("btn-onboarding-continue")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("onboarding-name");
    const familyName = nameInput?.value.trim();
    if (!familyName) { nameInput?.focus(); return; }
    try {
      _setLoading("btn-onboarding-continue", true);
      await Auth.createFamily(familyName);
      App.init({ authDone: true });
    } catch (err) {
      console.error("[createFamily error]", err);
    } finally {
      _setLoading("btn-onboarding-continue", false);
    }
  });

});

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

function _showAuthError(msg, isError = true) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? "#ff6b6b" : "#4caf50";
  el.style.display = "block";
}

function _emailError(code) {
  const map = {
    "auth/user-not-found":      "משתמש לא נמצא",
    "auth/wrong-password":      "סיסמא שגויה",
    "auth/email-already-in-use":"כתובת המייל כבר רשומה",
    "auth/invalid-email":       "כתובת מייל לא תקינה",
    "auth/weak-password":       "הסיסמא חלשה מדי",
    "auth/too-many-requests":   "יותר מדי ניסיונות, נסה שוב מאוחר יותר",
    "auth/invalid-credential":  "מייל או סיסמא שגויים",
  };
  return map[code] || "שגיאה: " + code;
}
