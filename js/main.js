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
  try {
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
        alert("[Auth error] " + err.message);
        _show("screen-login");
      },
    });
  } catch(e) {
    alert("[main catch] " + e.message);
  }

  document.getElementById("btn-google-signin")?.addEventListener("click", async () => {
    try {
      _setLoading("btn-google-signin", true);
      await Auth.signInWithGoogle();
    } catch (err) {
      alert("[Google signin error] " + err.message);
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
      alert("[createFamily error] " + err.message);
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
