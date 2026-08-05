/**
 * main.js — Medickids entry point
 */

import { Auth } from "./auth.js";

document.addEventListener("DOMContentLoaded", () => {

  // דפדפן רגיל → תמיד Landing (הוספה למסך הבית)
  const mq  = window.matchMedia('(display-mode: standalone)').matches;
  const nav = window.navigator.standalone === true;
  const isStandalone = mq || nav;

  // DEBUG זמני — למחוק אחרי בדיקה
  alert('standalone:\nmq=' + mq + '\nnav=' + nav + '\nresult=' + isStandalone);

  if (!isStandalone) {
    App.init({ authDone: false }); // יציג screen-landing
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
      console.error("[main] Auth error:", err);
      _show("screen-login");
    },
  });

  document.getElementById("btn-google-signin")?.addEventListener("click", async () => {
    try {
      _setLoading("btn-google-signin", true);
      await Auth.signInWithGoogle();
    } catch (err) {
      console.error(err);
    } finally {
      _setLoading("btn-google-signin", false);
    }
  });

  document.getElementById("btn-onboarding-continue")?.addEventListener("click", async () => {
    const nameInput = document.getElementById("onboarding-name");
    const familyName = nameInput?.value.trim();
    if (!familyName) { nameInput?.focus(); return; }
    try {
      _setLoading("btn-onboarding-continue", true);
      await Auth.createFamily(familyName);
      App.init({ authDone: true });
    } catch (err) {
      console.error("[main] createFamily error:", err);
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
