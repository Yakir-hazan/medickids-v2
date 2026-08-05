/**
 * main.js — Medickids entry point + Onboarding controller
 */

import { Auth } from "./auth.js";

// ─── Onboarding controller (global, נקרא מ-onclick) ──────────────────────────
window.Onboarding = (() => {
  let _step = 0;
  let _role = { label: 'אבא', emoji: '👨' };
  let _kidEmoji = '🧒';
  let _kidPhotoDataUrl = null;

  function _goto(step) {
    _step = step;
    document.querySelectorAll('.ob-step').forEach((el, i) => {
      el.classList.toggle('active', i === step);
    });
    document.querySelectorAll('.ob-dot').forEach((el, i) => {
      el.classList.toggle('active', i === step);
    });
  }

  return {
    pickRole(label, emoji) {
      _role = { label, emoji };
      document.querySelectorAll('.ob-role-btn').forEach(b => b.classList.remove('selected'));
      const id = label === 'אבא' ? 'ob-role-dad' : 'ob-role-mom';
      document.getElementById(id)?.classList.add('selected');
      // קצר השהייה קלה ואז עוברים לשלב הבא
      setTimeout(() => _goto(1), 300);
    },

    pickEmoji(btn, emoji) {
      _kidEmoji = emoji;
      _kidPhotoDataUrl = null;
      document.querySelectorAll('.ob-avatar-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const preview = document.getElementById('ob-kid-avatar-preview');
      if (preview) preview.innerHTML = emoji;
    },

    pickPhoto() {
      document.getElementById('ob-photo-input')?.click();
    },

    onPhoto(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        _kidPhotoDataUrl = e.target.result;
        _kidEmoji = null;
        document.querySelectorAll('.ob-avatar-opt').forEach(b => b.classList.remove('selected'));
        document.querySelector('.ob-avatar-photo')?.classList.add('selected');
        const preview = document.getElementById('ob-kid-avatar-preview');
        if (preview) preview.innerHTML = `<img src="${_kidPhotoDataUrl}" alt="avatar">`;
      };
      reader.readAsDataURL(file);
    },

    async saveKid() {
      const name    = document.getElementById('ob-kid-name')?.value.trim();
      const weight  = parseFloat(document.getElementById('ob-kid-weight')?.value) || 0;
      const birth   = parseInt(document.getElementById('ob-kid-birth')?.value) || null;

      if (!name) {
        document.getElementById('ob-kid-name')?.focus();
        return;
      }

      const btn = document.querySelector('#ob-step-1 .ob-next-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }

      try {
        const kidData = {
          name,
          emoji:     _kidEmoji || '🧒',
          photoUrl:  _kidPhotoDataUrl || null,
          weight,
          birthYear: birth,
        };
        await window.DB.addChild(kidData);

        const doneText = document.getElementById('ob-done-text');
        if (doneText) doneText.textContent = `${name} נוסף/ה בהצלחה 🎉`;

        _goto(2);
      } catch (err) {
        console.error('[Onboarding] saveKid error', err);
        try{window.DevCenter&&window.DevCenter.log('ERROR','Onboarding:saveKid',err.message+'\n'+(err.stack||'').slice(0,300));}catch(_){}
        if (btn) { btn.disabled = false; btn.textContent = 'המשך →'; }
        alert('שגיאה בשמירה: ' + (err.message || String(err)));
      }
    },

    skipKid() {
      const doneText = document.getElementById('ob-done-text');
      if (doneText) doneText.textContent = 'תוכל/י להוסיף ילדים מהתפריט בכל עת';
      _goto(2);
    },

    finish() {
      App.goto('screen-dash');
    },
  };
})();

// ─── Screen helpers ───────────────────────────────────────────────────────────
function _show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(screenId)?.classList.add('active');
}

function _setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn.style.opacity = on ? '0.6' : '1';
}

function _showAuthError(msg, isError = true) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '#4caf50';
  el.style.display = 'block';
}

function _emailError(code) {
  const map = {
    'auth/user-not-found':      'משתמש לא נמצא',
    'auth/wrong-password':      'סיסמא שגויה',
    'auth/email-already-in-use':'כתובת המייל כבר רשומה',
    'auth/invalid-email':       'כתובת מייל לא תקינה',
    'auth/weak-password':       'הסיסמא חלשה מדי',
    'auth/too-many-requests':   'יותר מדי ניסיונות, נסה שוב מאוחר יותר',
    'auth/invalid-credential':  'מייל או סיסמא שגויים',
  };
  return map[code] || 'שגיאה: ' + code;
}

// ─── Entry point ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  try { window.DevCenter && window.DevCenter.log('INFO','main:start','standalone='+
    (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true)); } catch(_){}

  const mq  = window.matchMedia('(display-mode: standalone)').matches;
  const nav = window.navigator.standalone === true;
  const isStandalone = mq || nav;

  if (!isStandalone) {
    try { window.DevCenter && window.DevCenter.log('INFO','main:notStandalone','skipping auth'); } catch(_){}
    App.init({ authDone: false });
    return;
  }

  try { window.DevCenter && window.DevCenter.log('INFO','main:callingAuthInit',''); } catch(_){}

  Auth.init({
    onNeedAuth() {
      _show('screen-login');
    },

    onNeedFamilyName(uid, displayName) {
      const nameInput = document.getElementById('onboarding-name');
      if (nameInput && displayName) {
        const parts = displayName.trim().split(' ');
        if (parts.length > 1) nameInput.value = parts[parts.length - 1];
      }
      _show('screen-onboarding');
    },

    onReady(state) {
      try { window.DevCenter && window.DevCenter.log('INFO','main:onReady','children='+state?.children?.length); } catch(_){}
      const isNewUser = !state?.children?.length;
      App.init({ authDone: true, skipKidsScreen: true });
      if (isNewUser) {
        // משתמש חדש → onboarding flow
        App.goto('screen-onboarding-flow');
      }
      // משתמש קיים → App.init מוביל לדאשבורד דרך ה-splash
    },

    onError(err) {
      console.error('[Auth error]', err);
      _show('screen-login');
    },
  });

  // ─── Google Sign-In ─────────────────────────────────────────────────────────
  document.getElementById('btn-google-signin')?.addEventListener('click', async () => {
    try {
      _setLoading('btn-google-signin', true);
      await Auth.signInWithGoogle();
    } catch (err) {
      _showAuthError(err.message);
    } finally {
      _setLoading('btn-google-signin', false);
    }
  });

  // ─── Email Sign-In ───────────────────────────────────────────────────────────
  document.getElementById('btn-email-signin')?.addEventListener('click', async () => {
    const email    = document.getElementById('input-email')?.value.trim();
    const password = document.getElementById('input-password')?.value;
    if (!email || !password) { _showAuthError('יש למלא מייל וסיסמא'); return; }
    try {
      _setLoading('btn-email-signin', true);
      await Auth.signInWithEmail(email, password);
    } catch (err) {
      _showAuthError(_emailError(err.code));
    } finally {
      _setLoading('btn-email-signin', false);
    }
  });

  // ─── Email Register ──────────────────────────────────────────────────────────
  document.getElementById('btn-email-register')?.addEventListener('click', async () => {
    const email    = document.getElementById('input-email')?.value.trim();
    const password = document.getElementById('input-password')?.value;
    if (!email || !password) { _showAuthError('יש למלא מייל וסיסמא'); return; }
    if (password.length < 6) { _showAuthError('הסיסמא חייבת להכיל לפחות 6 תווים'); return; }
    try {
      _setLoading('btn-email-register', true);
      await Auth.registerWithEmail(email, password);
    } catch (err) {
      _showAuthError(_emailError(err.code));
    } finally {
      _setLoading('btn-email-register', false);
    }
  });

  // ─── Forgot Password ─────────────────────────────────────────────────────────
  document.getElementById('btn-forgot-password')?.addEventListener('click', async () => {
    const email = document.getElementById('input-email')?.value.trim();
    if (!email) { _showAuthError('הזן מייל כדי לאפס סיסמא'); return; }
    try {
      await Auth.resetPassword(email);
      _showAuthError('נשלח מייל לאיפוס סיסמא ✓', false);
    } catch (err) {
      _showAuthError(_emailError(err.code));
    }
  });

  // ─── Onboarding (family name) ─────────────────────────────────────────────
  document.getElementById('btn-onboarding-continue')?.addEventListener('click', async () => {
    const nameInput  = document.getElementById('onboarding-name');
    const familyName = nameInput?.value.trim();
    if (!familyName) { nameInput?.focus(); return; }
    try {
      _setLoading('btn-onboarding-continue', true);
      await Auth.createFamily(familyName);
      // אחרי יצירת משפחה → onboarding flow
      App.init({ authDone: true, skipKidsScreen: true });
      App.goto('screen-onboarding-flow');
    } catch (err) {
      console.error('[createFamily error]', err);
    } finally {
      _setLoading('btn-onboarding-continue', false);
    }
  });

});

