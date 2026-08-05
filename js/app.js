const App = (() => {
  /* ---------- flow constants ---------- */
  /* ⚠️ CLAUDE: bump APP_VERSION on EVERY push to this repo — and bump the -vNN suffix of
     CACHE_NAME in sw.js at the same time (they don't need matching text, just both incremented
     together). This value is shown to the user in Settings and is what "בדוק אם יש עדכון"
     relies on to prove a new version actually loaded. Forgetting to bump it breaks both.
     Beta scheme: 1.0.0-beta.2 → 1.0.0-beta.2 → ... → 1.0.0 once out of beta. */
  const APP_VERSION = '1.0.0-beta.46';
  const SPLASH_DURATION_RETURNING = 1500; // ms — short splash for returning users
  const SPLASH_DURATION_NEW       = 2200; // ms — slightly longer for new users

  const AVATAR_GRADIENT = {
    a1: 'linear-gradient(135deg,#FFB6A3,#FF9F6B)',
    a2: 'linear-gradient(135deg,#7C6FF0,#9B8EFF)',
  };

  let medChildSel = null;
  let medMedicineSel = null;
  let tempChildSel = null;
  let histFilter = 'all';
  let editMedEntryId = null;
  let doseReminderMode = 'auto'; // 'auto' | 'custom' — reminder timing for PRN doses being logged
  let dailyReminderOn = true; // for DAILY-protocol medicines — whether to keep a recurring reminder
  let editTempEntryId = null;
  let editingKidId = null; // null = add mode
  let deferredInstallPrompt = null;

  /* ---------- add-to-home-screen detection ---------- */
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function isAndroid() {
    return /Android/.test(navigator.userAgent);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = 'block';
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showSplash();
  });

  function renderLanding() {
    if (isStandalone()) { showSplash(); return; }
    document.getElementById('landing-ios').style.display = isIOS() ? 'block' : 'none';
    document.getElementById('landing-android').style.display = (isAndroid() || (!isIOS() && deferredInstallPrompt)) ? 'block' : 'none';
    document.getElementById('landing-desktop').style.display = (!isIOS() && !isAndroid() && !deferredInstallPrompt) ? 'block' : 'none';
    const btn = document.getElementById('btn-install');
    if (btn) btn.style.display = deferredInstallPrompt ? 'block' : (isAndroid() ? 'none' : 'none');
  }
  function installNow() {
    if (!deferredInstallPrompt) { toast('פתחו את תפריט הדפדפן ובחרו "התקן אפליקציה"'); return; }
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; });
  }
  function skipLanding() { showSplash(); }

  /* ---------- helpers ---------- */
  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function timeToToday(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  function formatClock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function elapsedString(ts) {
    let diff = Math.max(0, Date.now() - ts);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ממש עכשיו';
    if (mins < 60) return `${mins} דקות`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs < 24) return rem ? `${hrs} שעות ו־${rem} דק׳` : `${hrs} שעות`;
    const days = Math.floor(hrs / 24);
    return `${days} ${days === 1 ? 'יום' : 'ימים'}`;
  }
  function dayLabel(ts) {
    const d = new Date(ts), now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return 'היום';
    if (diffDays === 1) return 'אתמול';
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function childById(id) { return DB.get().children.find((c) => c.id === id); }

  /* ---------- navigation ---------- */
  function goto(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (id === 'screen-kids') renderKids();
  }
  function showSplash() {
    goto('screen-splash');
    // בקש רשות התראות OneSignal — רק ב-PWA מותקן (standalone)
    if (isStandalone()) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      OneSignalDeferred.push(async function(OneSignal) {
        // מזהה את ההתקנה הזו אצל OneSignal לפי deviceId יציב, כדי שתזכורות ישלחו רק
        // למכשיר הזה (include_aliases/external_id בשרת) ולא לכל המנויים. רץ בכל פתיחה
        // standalone כדי לכסות גם התקנות ותיקות (migration אוטומטי, בלי קוד נפרד).
        await OneSignal.login(DB.get().deviceId);
        OneSignal.Notifications.requestPermission();
      });
    }
  }

  /* ---------- splash thermometer animation ---------- */
  let splashAnimId = null;
  function animateSplashThermo() {
    const mercuryEl = document.getElementById('splash-mercury');
    const tempEl = document.getElementById('splash-temp');
    const subEl = document.getElementById('splash-loading-sub');
    if (!mercuryEl || !tempEl || !subEl) return;
    if (splashAnimId) cancelAnimationFrame(splashAnimId);

    const MIN_TEMP = 34.0, MAX_TEMP = 38.5, FULL_RANGE = 8; // tube scale spans 34°–42°; mercury only rises to 38.5° on it
    const TUBE_BOTTOM = 250, TUBE_H = 236;
    const DURATION = 1300; // finishes comfortably before the shortest auto-nav timeout (1500ms)
    const messages = [[35.0, 'טוען נתונים...'], [36.2, 'בודק עדכונים...'], [37.4, 'כמעט מוכן...']];
    let msgIdx = 0;
    let startTime = null;

    mercuryEl.setAttribute('height', 0);
    mercuryEl.setAttribute('y', TUBE_BOTTOM);
    tempEl.textContent = MIN_TEMP.toFixed(1) + '°C';
    subEl.textContent = 'טוען...';

    function tempToHeight(t) { return ((t - MIN_TEMP) / FULL_RANGE) * TUBE_H; }
    function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

    function step(ts) {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / DURATION, 1);
      const currentTemp = MIN_TEMP + easeInOut(progress) * (MAX_TEMP - MIN_TEMP);
      const h = tempToHeight(currentTemp);
      mercuryEl.setAttribute('y', TUBE_BOTTOM - h);
      mercuryEl.setAttribute('height', h);
      tempEl.textContent = currentTemp.toFixed(1) + '°C';
      while (msgIdx < messages.length && currentTemp >= messages[msgIdx][0]) {
        subEl.textContent = messages[msgIdx][1];
        msgIdx++;
      }
      if (progress < 1) splashAnimId = requestAnimationFrame(step);
      else { subEl.textContent = ''; splashAnimId = null; }
    }
    splashAnimId = requestAnimationFrame(step);
  }

  function tab(id) {
    goto(id);
    document.querySelectorAll('.navitem').forEach((n) => n.classList.toggle('active', n.dataset.nav === id));
    if (id === 'screen-dash') renderDashboard();
    if (id === 'screen-hist') renderHistory();
    if (id === 'screen-temp') renderTemp();
  }
  function openSheet(id) { document.getElementById(id).classList.add('open'); }
  function closeSheet(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'sheet-med') editMedEntryId = null;
    if (id === 'sheet-temp') editTempEntryId = null;
  }

  /* ---------- dashboard ---------- */
  /* one prioritized, actionable line per child — fever alert > dose timing > stale weight.
     Only ever returns ONE message so the dashboard stays calm, not noisy. */
  function smartInsight(c) {
    const now = Date.now();
    const temps = DB.tempsFor(c.id); // newest first

    // 1) fever — only interrupt with an alert when it's actually urgent
    if (temps.length && temps[0].value >= 38) {
      const latest = temps[0];
      let feverStart = latest.time;
      for (let i = 1; i < temps.length; i++) {
        if (temps[i].value >= 38) feverStart = temps[i].time; else break;
      }
      const feverHours = (now - feverStart) / 3600000;
      if (latest.value >= 39.5) {
        return { level: 'alert', icon: '🚨', text: `החום הגיע ל־${latest.value}° — כדאי לשקול פנייה לרופא/ה.` };
      }
      if (feverHours >= 24) {
        return { level: 'alert', icon: '🌡️', text: `החום נמשך כבר ${Math.floor(feverHours)} שעות — כדאי לשקול פנייה לרופא/ה.` };
      }
    }

    // 2) dose timing — reuses the same MEDICATION_CATALOG intervals as the dose calculator, so the two never contradict each other
    const lastMed = DB.lastMedFor(c.id);
    if (lastMed) {
      const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(lastMed.medicine, k));
      const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
      if (drug && drug.protocol.intervalHours != null) {
        const hoursSince = (now - lastMed.time) / 3600000;
        const remain = drug.protocol.intervalHours - hoursSince;
        if (remain > 0) {
          const remainLabel = remain >= 1 ? `${Math.ceil(remain)} שעות` : `${Math.max(1, Math.round(remain * 60))} דקות`;
          return { level: 'info', icon: '⏱️', text: `אפשר לתת מנה נוספת של ${lastMed.medicine} בעוד כ־${remainLabel}.` };
        }
        return { level: 'ok', icon: '✅', text: `עברו ${elapsedString(lastMed.time)} מאז ${lastMed.medicine} — אפשר לתת מנה נוספת אם צריך.` };
      }
      return { level: 'info', icon: '💊', text: `עברו ${elapsedString(lastMed.time)} מאז ${lastMed.medicine}.` };
    }

    // 3) stale weight — lowest priority, and only once we actually know when it was last set
    if (c.weightUpdatedAt && (now - c.weightUpdatedAt) > 180 * 24 * 3600000) {
      const months = Math.floor((now - c.weightUpdatedAt) / (30 * 24 * 3600000));
      return { level: 'info', icon: '⚖️', text: `המשקל לא עודכן כבר ${months} חודשים — מינון מדויק דורש משקל עדכני.` };
    }

    return null;
  }

  let heroState = { type: 'calm', childId: null }; // remembers what the hero card currently represents, for heroClick()

  function renderDashboard() {
    const state = DB.get();
    const now = Date.now();

    // ---------- header ----------
    const hour = new Date().getHours();
    const timeGreet = hour < 5 ? 'לילה טוב' : hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : hour < 21 ? 'ערב טוב' : 'לילה טוב';
    const famName = state.family ? `משפחת ${state.family}` : '';
    document.getElementById('dash-greeting').textContent = famName ? `${timeGreet}, ${famName} 👋` : `${timeGreet} 👋`;

    // ---------- empty state ----------
    const wrap = document.getElementById('dash-children');
    if (!state.children.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="ic">👨‍👩‍👧‍👦</div><div class="t">עדיין אין ילדים באפליקציה</div><div class="s">הוסיפו ילד/ה דרך הגדרות ← ניהול ילדים</div></div>`;
      document.getElementById('dash-title').textContent = 'ברוכים הבאים ל-Medickids';
      document.getElementById('dash-updated').style.display = 'none';
      document.getElementById('dash-hero').style.display = 'none';
      document.getElementById('dash-fam-summary').style.display = 'none';
      document.getElementById('dash-active-treatments').style.display = 'none';
      document.getElementById('dash-timeline').style.display = 'none';
      document.getElementById('dash-insight').style.display = 'none';
      return;
    }
    document.getElementById('dash-hero').style.display = '';

    // ---------- compute per-child data ----------
    const childData = state.children.map((c) => {
      const lastMed = DB.lastMedFor(c.id);
      const lastTemp = DB.lastTempFor(c.id);
      const hasFever = lastTemp && lastTemp.value >= 38;

      // next dose countdown
      let nextDoseMs = null;
      let nextDrugName = null;
      if (lastMed) {
        const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(lastMed.medicine, k));
        const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
        if (drug && drug.protocol.intervalHours) {
          const readyAt = lastMed.time + drug.protocol.intervalHours * 3600000;
          if (readyAt > now) { nextDoseMs = readyAt - now; nextDrugName = lastMed.medicine; }
        }
      }

      // mood
      let mood = '😊';
      if (hasFever && lastTemp.value >= 39) mood = '😓';
      else if (hasFever) mood = '🤒';

      return { c, lastMed, lastTemp, hasFever, nextDoseMs, nextDrugName, mood };
    });

    // ---------- title ----------
    const anyFever = childData.some((d) => d.hasFever);
    document.getElementById('dash-title').textContent = anyFever ? 'מה קורה הלילה?' : 'מה קורה עכשיו?';

    // ---------- header: last updated ----------
    const latestEvent = DB.feed(null)[0] || null;
    const updatedEl = document.getElementById('dash-updated');
    if (latestEvent) {
      updatedEl.textContent = `עודכן לפני ${elapsedString(latestEvent.time)}`;
      updatedEl.style.display = '';
    } else {
      updatedEl.style.display = 'none';
    }

    // ---------- dynamic hero card — priority: fever > dose timing > stale weight > calm ----------
    const hero = document.getElementById('dash-hero');

    // worst fever across all children
    const feverChild = childData
      .filter((d) => d.hasFever)
      .sort((a, b) => b.lastTemp.value - a.lastTemp.value)[0] || null;

    // most urgent pending dose across all children
    const urgentDose = childData
      .filter((d) => d.nextDoseMs !== null)
      .sort((a, b) => a.nextDoseMs - b.nextDoseMs)[0] || null;

    // most stale weight across all children
    const staleWeight = state.children
      .filter((c) => c.weightUpdatedAt && (now - c.weightUpdatedAt) > 180 * 24 * 3600000)
      .sort((a, b) => a.weightUpdatedAt - b.weightUpdatedAt)[0] || null;

    if (feverChild) {
      heroState = { type: 'fever', childId: feverChild.c.id };
      hero.className = 'hero-card fever';
      hero.innerHTML = `
        <div class="hero-badge"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">warning</span> שימו לב</div>
        <div class="hero-top">
          <div style="flex:1;">
            <div class="hero-main">ל${feverChild.c.name} יש חום גבוה</div>
            <div class="hero-sub">מדדתם לפני ${elapsedString(feverChild.lastTemp.time)}</div>
          </div>
          <div class="hero-ic-circle">${feverChild.lastTemp.value >= 39.5 ? '<span class="material-symbols-outlined" style="font-size:28px;color:#fff;">thermostat</span>' : '<span class="material-symbols-outlined" style="font-size:28px;color:#fff;">device_thermostat</span>'}</div>
        </div>
        <div class="hero-timer-big">${feverChild.lastTemp.value}°C</div>
        <button class="hero-cta" onclick="App.openTempSheet()">מדוד שוב</button>`;
    } else if (urgentDose) {
      heroState = { type: 'med', childId: urgentDose.c.id };
      const totalMin = Math.ceil(urgentDose.nextDoseMs / 60000);
      const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
      const mm = String(totalMin % 60).padStart(2, '0');
      hero.className = 'hero-card med';
      hero.innerHTML = `
        <div class="hero-badge">הפעולה הבאה</div>
        <div class="hero-top">
          <div style="flex:1;">
            <div class="hero-main">זמן ל${urgentDose.nextDrugName} – ${urgentDose.c.name}</div>
            <div class="hero-sub">מנה אחרונה ניתנה לפני ${elapsedString(urgentDose.lastMed.time)}</div>
          </div>
          <div class="hero-ic-circle"><span class="material-symbols-outlined" style="font-size:28px;color:#fff;font-variation-settings:'FILL' 1;">medication_liquid</span></div>
        </div>
        <button class="hero-cta" onclick="App.openMedSheet()">סמן כבוצע</button>`;
    } else if (staleWeight) {
      heroState = { type: 'weight', childId: staleWeight.id };
      const months = Math.floor((now - staleWeight.weightUpdatedAt) / (30 * 24 * 3600000));
      hero.className = 'hero-card weight';
      hero.innerHTML = `
        <div class="hero-top">
          <div class="hero-ic">⚖️</div>
          <div style="flex:1;">
            <div class="hero-label">תזכורת</div>
            <div class="hero-main">כדאי לעדכן משקל ל${staleWeight.name}</div>
            <div class="hero-sub">עברו ${months} חודשים מאז העדכון האחרון</div>
          </div>
        </div>`;
    } else {
      heroState = { type: 'calm', childId: null };
      const latestTemp = childData
        .filter((d) => d.lastTemp)
        .sort((a, b) => b.lastTemp.time - a.lastTemp.time)[0] || null;
      hero.className = 'hero-card calm';
      hero.innerHTML = `
        <div class="hero-badge">הכול רגוע</div>
        <div class="hero-top">
          <div style="flex:1;">
            <div class="hero-main">אין פעולות דחופות כרגע</div>
            ${latestTemp ? `<div class="hero-sub">המדידה האחרונה: ${latestTemp.lastTemp.value}°</div>` : ''}
          </div>
          <div class="hero-ic-circle"><span class="material-symbols-outlined" style="font-size:28px;color:#fff;">nightlight</span></div>
        </div>`;
    }

    // ---------- family summary — humanized chips ----------
    const famSummary = document.getElementById('dash-fam-summary');
    const medTodayCount = state.medEntries.filter((e) => {
      const d = new Date(e.time); const n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    }).length;
    if (state.children.length > 1) {
      const chips = childData.map(({ c, hasFever }) =>
        hasFever
          ? `<div class="fam-chip warn">🌡️ ${c.name} עם חום</div>`
          : `<div class="fam-chip ok">🙂 ${c.name} מרגיש/ה טוב</div>`
      ).join('') + (medTodayCount ? `<div class="fam-chip">💊 ${medTodayCount} מנות היום</div>` : '');
      famSummary.innerHTML = `
        <div class="fam-top">
          <span class="fam-ic">👨‍👩‍👧‍👦</span>
          <span class="fam-title">${state.children.length} ילדים</span>
        </div>
        <div class="fam-chips">${chips}</div>`;
      famSummary.style.display = '';
    } else {
      famSummary.style.display = 'none';
    }

    // ---------- child cards — row based ----------
    wrap.innerHTML = childData.map(({ c, lastMed, lastTemp, hasFever, nextDoseMs, nextDrugName, mood }) => {
      const cardClass = hasFever ? ' warm' : '';
      const moodText = hasFever ? '🌡️ עם חום כרגע' : '🙂 רגוע';

      let tempRow = '';
      if (lastTemp) {
        tempRow = `<div class="child-subcard${hasFever ? ' subcard-fever' : ''}">
          <div class="subcard-label">חום נוכחי <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;font-variation-settings:'FILL' 1;">device_thermostat</span></div>
          <div class="subcard-val${hasFever ? ' fever-val' : ''}">${lastTemp.value}°C</div>
        </div>`;
      }

      let medRow = '';
      if (lastMed) {
        const canGiveNow = nextDoseMs === null;
        medRow = `<div class="child-subcard${canGiveNow ? ' subcard-ok' : ' subcard-wait'}">
          <div class="subcard-label">${lastMed.medicine} <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;font-variation-settings:'FILL' 1;">medication_liquid</span></div>
          <div class="subcard-status">${canGiveNow ? 'אפשר לתת מנה' : 'ממתין למנה'}</div>
        </div>`;
      }

      let canGiveHtml = '';
      if (nextDoseMs !== null) {
        const totalMin = Math.ceil(nextDoseMs / 60000);
        const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
        const mm = String(totalMin % 60).padStart(2, '0');
        canGiveHtml = `<div class="can-give-bar warn-bar">⏱️ אפשר לתת שוב ${nextDrugName} בעוד ${hh}:${mm}</div>`;
      } else if (lastMed) {
        const recentNormalTemp = lastTemp && !hasFever && (Date.now() - lastTemp.time < 6 * 3600 * 1000);
        if (recentNormalTemp) {
          canGiveHtml = `<div class="can-give-bar ok-bar">🌟 החום תקין — ${c.name} מרגיש/ה טוב!</div>`;
        } else {
          canGiveHtml = `<div class="can-give-bar ok-bar">✅ אפשר לתת מנה נוספת אם צריך</div>`;
        }
      }

      const emptyRow = (!tempRow && !medRow)
        ? `<div class="crow"><div class="crow-ic">✨</div><div class="crow-body"><div class="crow-lbl">אין נתונים עדיין היום</div></div></div>`
        : '';

      return `<div class="child-card${cardClass}">
        <div class="child-top" onclick="App.openEditKid('${c.id}')">
          <div class="child-avatar-wrap">
            <div class="child-avatar-circle" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
            ${hasFever ? '<div class="child-fever-dot"></div>' : ''}
          </div>
          <div class="child-info">
            <div class="child-name">${c.name}</div>
            <div class="child-status-row">
              ${hasFever ? '<span class="child-status-chip fever-chip">🌡️ עם חום</span>' : '<span class="child-status-chip ok-chip">טיפול פעיל</span>'}
              <span class="child-status-dot"></span>
            </div>
          </div>
          <button class="child-menu-btn" onclick="event.stopPropagation();App.openEditKid('${c.id}')">
            <span class="material-symbols-outlined" style="font-size:20px;color:#787586;">more_vert</span>
          </button>
        </div>
        ${tempRow}
        ${tempRow && medRow ? '<div class="child-divider"></div>' : ''}
        ${medRow}
        ${emptyRow}
        ${canGiveHtml}
      </div>`;
    }).join('');

    // ---------- timeline (last 3 events) ----------
    const feed = DB.feed(null).slice(0, 3);
    const tlCard = document.getElementById('dash-timeline');
    if (feed.length) {
      document.getElementById('dash-tl-rows').innerHTML = feed.map((e) => {
        const child = state.children.find((c) => c.id === e.childId);
        const childName = child ? child.name : '';
        const ic = e.kind === 'med' ? '💊' : '🌡️';
        const txt = e.kind === 'med' ? `${e.medicine}${e.dose ? ' ' + e.dose : ''}` : `${e.value}°`;
        return `<div class="tl-row">
          <div class="tl-time">${formatClock(e.time)}</div>
          <div class="tl-ic">${ic}</div>
          <div class="tl-txt">${txt}</div>
          <div class="tl-child">${childName}</div>
        </div>`;
      }).join('');
      tlCard.style.display = '';
    } else {
      tlCard.style.display = 'none';
    }

    // ---------- insight (first child with one) ----------
    const insightEl = document.getElementById('dash-insight');
    let shownInsight = null;
    for (const { c } of childData) {
      const ins = smartInsight(c);
      if (ins) { shownInsight = ins; break; }
    }
    if (shownInsight) {
      document.getElementById('dash-insight-text').textContent = shownInsight.text;
      insightEl.style.display = '';
    } else {
      insightEl.style.display = 'none';
    }

    _renderActiveTreatmentsCard(state.children); // Step 1E — independent, reads only via _activeTreatmentState
  }

  /* ---------- add medication sheet ---------- */
  function openMedSheet(entryId) {
    const state = DB.get();
    editMedEntryId = entryId || null;
    const entry = entryId ? state.medEntries.find((e) => e.id === entryId) : null;
    medChildSel = entry ? entry.childId : (state.children[0]?.id || null);
    medMedicineSel = entry ? entry.medicine : (state.medicines[0] || null);
    document.getElementById('med-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === medChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickMedChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('med-medicine-chips').innerHTML = state.medicines.map((m) =>
      `<button type="button" class="chip ${m === medMedicineSel ? 'sel' : ''}" onclick="App.pickMedMedicine('${m}')">${m}</button>`).join('') +
      `<button type="button" class="chip" onclick="App.addCustomMedicine()">+ אחרת</button>`;
    document.getElementById('med-time').value = entry ? formatClock(entry.time) : nowHHMM();
    document.getElementById('med-dose').value = entry ? (entry.dose || '') : '';
    document.getElementById('med-note').value = entry ? (entry.note || '') : '';
    document.getElementById('med-sheet-title').textContent = entry ? 'עריכת תרופה' : 'נתתי תרופה';
    document.getElementById('med-delete-btn').style.display = entry ? '' : 'none';

    // reminder controls — only relevant when logging a NEW dose, not when editing an old entry
    const remLabel = document.getElementById('med-reminder-label');
    const remChips = document.getElementById('med-reminder-chips');
    const remCustom = document.getElementById('med-reminder-custom');
    if (entry) {
      remLabel.style.display = 'none';
      remChips.style.display = 'none';
      remCustom.style.display = 'none';
    } else {
      remLabel.style.display = '';
      remChips.style.display = '';
      _updateReminderUI(); // decides auto/custom (PRN) vs recurring toggle (daily) based on the medicine itself
    }
    openSheet('sheet-med');
  }
  function pickMedChild(id) {
    medChildSel = id;
    document.querySelectorAll('#med-child-chips .chip').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    if (!editMedEntryId) _updateReminderUI(); // daily-reminder default depends on this child's existing prescriptions
  }
  function pickMedMedicine(name) {
    medMedicineSel = name;
    document.querySelectorAll('#med-medicine-chips .chip').forEach((el) => el.classList.toggle('sel', el.textContent === name));
    if (!editMedEntryId) _updateReminderUI(); // the medicine's protocol type decides which reminder UI to show
  }
  /* the medicine picked decides the reminder UI, not the user: PRN meds get the auto/custom picker,
     DAILY meds get a simple recurring-reminder toggle (and default it from any existing prescription) */
  function _updateReminderUI() {
    const remLabel = document.getElementById('med-reminder-label');
    const remChips = document.getElementById('med-reminder-chips');
    const remCustom = document.getElementById('med-reminder-custom');
    if (!remLabel) return;
    const catalogEntry = _catalogEntryFor(medMedicineSel);

    if (catalogEntry && catalogEntry.protocol.type === TREATMENT_TYPES.DAILY) {
      const existing = medChildSel ? DB.get().prescriptions.find((p) => p.childId === medChildSel && p.productId === catalogEntry.id && p.status === 'active') : null;
      dailyReminderOn = existing ? existing.reminder.on !== false : true;
      remLabel.textContent = 'תזכורת יומית';
      remCustom.style.display = 'none';
      remChips.innerHTML = `
        <button type="button" class="chip ${dailyReminderOn ? 'sel' : ''}" onclick="App.toggleDailyReminder(true)">🔁 להזכיר כל יום</button>
        <button type="button" class="chip ${!dailyReminderOn ? 'sel' : ''}" onclick="App.toggleDailyReminder(false)">🚫 בלי תזכורת קבועה</button>`;
    } else {
      remLabel.textContent = 'תזכורת למנה הבאה';
      doseReminderMode = 'auto';
      remCustom.value = '';
      remCustom.style.display = 'none';
      _renderReminderChips();
    }
  }
  function toggleDailyReminder(on) {
    dailyReminderOn = on;
    _updateReminderUI();
  }
  function addCustomMedicine() {
    const name = prompt('שם התרופה:');
    if (!name) return;
    const state = DB.get();
    if (!state.medicines.includes(name)) { state.medicines.push(name); DB.persist(); }
    medMedicineSel = name;
    openMedSheet();
    pickMedMedicine(name);
  }
  /* ---------- dose reminder push scheduling ---------- */
  function _renderReminderChips() {
    const box = document.getElementById('med-reminder-chips');
    if (!box) return;
    box.innerHTML = `
      <button type="button" class="chip ${doseReminderMode === 'auto' ? 'sel' : ''}" onclick="App.pickReminderMode('auto')">⏱️ אוטומטי (לפי מרווח התרופה)</button>
      <button type="button" class="chip ${doseReminderMode === 'custom' ? 'sel' : ''}" onclick="App.pickReminderMode('custom')">🕐 זמן מותאם אישית</button>`;
  }
  function _toDatetimeLocal(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function pickReminderMode(mode) {
    doseReminderMode = mode;
    _renderReminderChips();
    const customInput = document.getElementById('med-reminder-custom');
    if (mode === 'custom') {
      customInput.style.display = '';
      if (!customInput.value) {
        // prefill with the automatic guess so the user only has to tweak it, not start from scratch
        const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medMedicineSel, k));
        const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
        const baseTime = timeToToday(document.getElementById('med-time').value || nowHHMM());
        const guess = baseTime + (drug && drug.protocol.intervalHours != null ? drug.protocol.intervalHours : 4) * 3600000;
        customInput.value = _toDatetimeLocal(guess);
      }
    } else {
      customInput.style.display = 'none';
    }
  }
  /* finds an earlier, still-pending (not yet fired) reminder for the same child+substance so it can be
     cancelled before scheduling a new one — this is what prevents two near-simultaneous pushes.
     matchFn is _matchesIngredient when we know the active ingredient (catches Acamol+Novimol as one
     substance), or _matchesDrug as a fallback for medicines not yet in the catalog. */
  function _findPendingReminder(childId, key, matchFn, excludeEntryId) {
    const now = Date.now();
    const candidates = DB.get().medEntries.filter((e) =>
      e.id !== excludeEntryId && e.childId === childId && matchFn(e.medicine, key) &&
      e.reminderNotificationId && e.reminderReadyAt && e.reminderReadyAt > now
    );
    if (!candidates.length) return null;
    return candidates.reduce((a, b) => (b.time > a.time ? b : a));
  }
  function _cancelReminder(notificationId) {
    if (!notificationId) return Promise.resolve();
    return fetch(`/api/notify?id=${encodeURIComponent(notificationId)}`, { method: 'DELETE' }).catch(() => {});
  }

  /* Cancel a pending course-dose push (stored on the prescription as courseNotificationId). */
  async function _cancelCourseReminder(rx) {
    if (!rx || !rx.courseNotificationId) return;
    await _cancelReminder(rx.courseNotificationId);
    DB.updatePrescription(rx.id, { courseNotificationId: null, courseReminderAt: null });
  }

  /* Schedule a push for the next course dose.
     Interval = 24h / dosesPerDay from the moment the dose was just marked.
     Does nothing if: notifications off, course completed, or scheduledTime already passed. */
  async function _scheduleCourseReminder(rx) {
    if (!DB.get().settings.notifications) return;
    if (!rx || rx.status === 'completed') return;
    const intervalMs  = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt  = rx.doseLog && rx.doseLog.length ? rx.doseLog[rx.doseLog.length - 1].at : Date.now();
    const readyAt     = lastDoseAt + intervalMs;
    if (readyAt <= Date.now()) return;

    // cancel previous pending reminder for this prescription before scheduling a new one
    await _cancelCourseReminder(rx);

    const entry   = _catalogEntryById(rx.productId);
    const drug    = entry ? entry.key : 'תרופה';
    const child   = childById(rx.childId);
    const childName = child ? child.name : 'הילד/ה';

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `זמן למנה הבאה 💊`,
          message: `הגיע הזמן לתת ל${childName} מנה של ${drug}`,
          childName,
          scheduledTime: new Date(readyAt).toISOString(),
          targetDeviceId: DB.get().deviceId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (data && data.notificationId) {
        DB.updatePrescription(rx.id, {
          courseNotificationId: data.notificationId,
          courseReminderAt: readyAt,
        });
      }
    } catch (e) { /* best-effort — never block UI */ }
  }
  async function scheduleDoseReminder(entry, customReadyAt) {
    if (!entry || !DB.get().settings.notifications) return; // user opted out — don't schedule
    const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(entry.medicine, k));
    const drug = drugKey ? MEDICATION_CATALOG[drugKey] : null;
    const ingredientKey = drug ? drug.activeIngredient : null;

    let readyAt = customReadyAt;
    if (readyAt == null) {
      if (drug && drug.protocol.type === TREATMENT_TYPES.DAILY) {
        readyAt = entry.time + 24 * 3600000; // once-a-day meds — remind at the same time tomorrow
      } else if (drug && drug.protocol.intervalHours != null) {
        readyAt = entry.time + drug.protocol.intervalHours * 3600000;
      } else {
        return; // no known interval and no manual time — nothing to schedule
      }
    }
    if (readyAt <= Date.now()) return; // time already passed — don't schedule in the past

    // avoid duplicate pushes: if an earlier dose of the same active ingredient (across brands) for
    // this child still has a pending reminder, cancel it first — the new dose supersedes it
    if (ingredientKey) {
      const pending = _findPendingReminder(entry.childId, ingredientKey, _matchesIngredient, entry.id);
      if (pending) {
        await _cancelReminder(pending.reminderNotificationId);
        DB.updateMedEntry(pending.id, { reminderNotificationId: null, reminderReadyAt: null });
      }
    } else if (drugKey) {
      const pending = _findPendingReminder(entry.childId, drugKey, _matchesDrug, entry.id);
      if (pending) {
        await _cancelReminder(pending.reminderNotificationId);
        DB.updateMedEntry(pending.id, { reminderNotificationId: null, reminderReadyAt: null });
      }
    }

    const child = childById(entry.childId);
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'זמן למנה הבאה 💊',
          message: `אפשר לתת ל${child ? child.name : 'הילד/ה'} מנה נוספת של ${entry.medicine}`,
          childName: child ? child.name : undefined,
          scheduledTime: new Date(readyAt).toISOString(),
          medEntryId: entry.id, // for debugging/data payload only — NOT used for targeting
          targetDeviceId: DB.get().deviceId, // who the push should actually be delivered to
        }),
      });
      const data = await res.json().catch(() => null);
      if (data && data.notificationId) {
        // store the id + time so a future dose of the same substance can find & cancel this one
        DB.updateMedEntry(entry.id, { reminderNotificationId: data.notificationId, reminderReadyAt: readyAt });
      }
    } catch (e) { /* best-effort — never block the UI on a failed schedule call */ }
  }

  async function saveMed() {
    if (!medChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    const catalogEntry = _catalogEntryFor(medMedicineSel);
    const protocolType = catalogEntry ? catalogEntry.protocol.type : null;
    const drugKey = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medMedicineSel, k));

    // warn (not block) if a dose of the same substance was already given too recently / already
    // given today (for daily meds) — same check the dose calculator uses, now applied here too
    if (!editMedEntryId && drugKey) {
      const warning = _doseHistoryWarning(medChildSel, drugKey);
      if (warning && warning.level === 'alert') {
        const plain = warning.text.replace(/^[⏱️⚠️☀️]\s*/, '');
        if (!confirm(`${plain}\n\nלהמשיך בכל זאת ולרשום את המנה?`)) return;
      }
    }

    const patch = {
      childId: medChildSel,
      medicine: medMedicineSel || 'תרופה',
      dose: document.getElementById('med-dose').value.trim(),
      note: document.getElementById('med-note').value.trim(),
      time: timeToToday(document.getElementById('med-time').value || nowHHMM()),
    };
    try {
      if (editMedEntryId) {
        DB.updateMedEntry(editMedEntryId, patch);
        toast('התרופה עודכנה ✓');
      } else {
        // DAILY-protocol meds: upsert a Prescription representing "ongoing daily treatment" for this
        // child+medicine, so future work (dashboard list, etc.) has a real place to read it from.
        // References the catalog by stable productId, never copies its protocol values.
        if (protocolType === TREATMENT_TYPES.DAILY && catalogEntry) {
          const existingRx = DB.get().prescriptions.find((p) => p.childId === medChildSel && p.productId === catalogEntry.id && p.status === 'active');
          if (existingRx) {
            DB.updatePrescription(existingRx.id, { reminder: { on: dailyReminderOn } });
            patch.prescriptionId = existingRx.id;
          } else {
            const rx = DB.addPrescription({
              childId: medChildSel,
              productId: catalogEntry.id,
              ingredientId: catalogEntry.activeIngredient,
              protocolType: TREATMENT_TYPES.DAILY,
              reminder: { on: dailyReminderOn },
            });
            patch.prescriptionId = rx.id;
          }
        }

        const entry = DB.addMedEntry(patch);
        let customReadyAt = null;
        if (doseReminderMode === 'custom') {
          const val = document.getElementById('med-reminder-custom').value;
          if (val) customReadyAt = new Date(val).getTime(); // parsed as local time, as entered
        }
        const shouldSchedule = protocolType === TREATMENT_TYPES.DAILY ? dailyReminderOn : true;
        if (shouldSchedule) scheduleDoseReminder(entry, customReadyAt); // falls back to automatic timing if no custom time was set
        toast('התרופה נשמרה ✓');
      }
    } catch (e) {
      // localStorage write failed (quota exceeded, private browsing, etc.) — don't claim success,
      // don't close the sheet, so the user doesn't lose what they just filled in
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
    editMedEntryId = null;
    closeSheet('sheet-med');
    renderDashboard();
    renderHistory();
  }
  function deleteMedEntry() {
    if (!editMedEntryId) return;
    if (!confirm('למחוק את הרשומה הזו? הפעולה אינה הפיכה.')) return;
    const entry = DB.get().medEntries.find((e) => e.id === editMedEntryId);
    if (entry && entry.reminderNotificationId && entry.reminderReadyAt && entry.reminderReadyAt > Date.now()) {
      _cancelReminder(entry.reminderNotificationId); // dose record is gone — its reminder shouldn't fire either
    }
    try {
      DB.deleteMedEntry(editMedEntryId);
    } catch (e) {
      toast('⚠️ המחיקה נכשלה — נסו שוב');
      return;
    }
    editMedEntryId = null;
    closeSheet('sheet-med');
    toast('הרשומה נמחקה');
    renderDashboard();
    renderHistory();
  }

  /* ---------- history ---------- */
  function renderHistory() {
    const state = DB.get();
    document.getElementById('hist-filters').innerHTML =
      `<button type="button" class="chip ${histFilter === 'all' ? 'sel' : ''}" onclick="App.setHistFilter('all')">הכל</button>` +
      state.children.map((c) => `<button type="button" class="chip ${histFilter === c.id ? 'sel' : ''}" onclick="App.setHistFilter('${c.id}')">${c.emoji} ${c.name}</button>`).join('');

    const feed = DB.feed(histFilter === 'all' ? null : histFilter);

    // completed courses — inject into feed as synthetic entries
    const completedCourses = state.prescriptions.filter(
      (p) => p.isCourse && p.status === 'completed' &&
             (histFilter === 'all' || p.childId === histFilter)
    );
    const courseEntries = completedCourses.map((rx) => {
      const entry = _catalogEntryById(rx.productId);
      const drugName = entry ? entry.key : 'טיפול';
      const startStr = new Date(rx.startAt).toLocaleDateString('he-IL');
      const endStr   = rx.endAt ? new Date(rx.endAt).toLocaleDateString('he-IL') : '—';
      const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
      const dosesDone  = rx.doseLog ? rx.doseLog.length : 0;
      return {
        id: rx.id,
        kind: 'course',
        childId: rx.childId,
        time: rx.endAt || rx.startAt,
        drugName,
        startStr,
        endStr,
        totalDays: rx.totalDays,
        dosesPerDay: rx.dosesPerDay,
        dosesDone,
        totalDoses,
      };
    });

    const combined = [...feed, ...courseEntries].sort((a, b) => b.time - a.time);
    const list = document.getElementById('hist-list');
    if (!combined.length) {
      list.innerHTML = `<div class="empty-state"><div class="ic">📭</div><div class="t">אין עדיין רשומות</div><div class="s">תרופות ומדידות שיתווספו יופיעו כאן</div></div>`;
      return;
    }
    let lastLabel = null;
    let html = '';
    combined.forEach((e) => {
      const label = dayLabel(e.time);
      if (label !== lastLabel) { html += `<div class="day-label">${label}</div>`; lastLabel = label; }
      const c = childById(e.childId);
      if (!c) return;
      if (e.kind === 'course') {
        html += `<div class="hist-row">
          <div class="hist-time">${formatClock(e.time)}</div>
          <div class="hist-icon" style="background:${AVATAR_GRADIENT[c.color]}">✅</div>
          <div class="hist-main">
            <div class="hist-med">טיפול הושלם · ${e.drugName}</div>
            <div class="hist-child">${c.name} · ${e.totalDays} ימים · ${e.dosesPerDay} מנות/יום · ${e.dosesDone}/${e.totalDoses} מנות · ${e.startStr}–${e.endStr}</div>
          </div>
        </div>`;
        return;
      }
      const icon = e.kind === 'med' ? '💊' : '🌡️';
      const title = e.kind === 'med' ? e.medicine : `מדידת חום — ${e.value}°`;
      const openFn = e.kind === 'med' ? `App.openMedSheet('${e.id}')` : `App.openTempSheet('${e.id}')`;
      html += `<div class="hist-row" onclick="${openFn}">
        <div class="hist-time">${formatClock(e.time)}</div>
        <div class="hist-icon" style="background:${AVATAR_GRADIENT[c.color]}">${icon}</div>
        <div class="hist-main"><div class="hist-med">${title}</div><div class="hist-child">${c.name}${e.note ? ' · ' + e.note : ''}</div></div>
      </div>`;
    });
    list.innerHTML = html;
  }
  function setHistFilter(v) { histFilter = v; renderHistory(); }

  /* ---------- temperature ---------- */
  function renderTemp() {
    const state = DB.get();
    if (!tempChildSel && state.children.length) tempChildSel = state.children[0].id;
    document.getElementById('temp-filters').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${tempChildSel === c.id ? 'sel' : ''}" onclick="App.setTempFilter('${c.id}')">${c.emoji} ${c.name}</button>`).join('');

    const readings = DB.tempsFor(tempChildSel).slice().reverse(); // oldest -> newest for chart
    const svg = document.getElementById('temp-svg');
    const cur = document.getElementById('temp-current');
    const lbl = document.getElementById('temp-current-lbl');

    if (!readings.length) {
      svg.innerHTML = '';
      cur.textContent = '--°';
      lbl.textContent = 'אין מדידות עדיין';
    } else {
      const last = readings[readings.length - 1];
      cur.textContent = last.value + '°';
      lbl.textContent = 'מדידה אחרונה · ' + formatClock(last.time);
      const vals = readings.map((r) => r.value);
      const min = Math.min(...vals, 36), max = Math.max(...vals, 39);
      const pad = 10;
      const w = 300, h = 100;
      const pts = readings.map((r, i) => {
        const x = readings.length > 1 ? pad + (i * (w - 2 * pad)) / (readings.length - 1) : w / 2;
        const y = h - pad - ((r.value - min) / (max - min || 1)) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#FF8A70" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${pts[pts.length - 1].split(',')[0]}" cy="${pts[pts.length - 1].split(',')[1]}" r="5" fill="#FF8A70"/>`;
    }

    document.getElementById('temp-list').innerHTML = readings.slice().reverse().map((r) =>
      `<div class="temp-row" onclick="App.openTempSheet('${r.id}')"><span>${formatClock(r.time)}</span><span class="v">${r.value}°</span></div>`).join('') ||
      `<div class="empty-state"><div class="ic">🌡️</div><div class="t">אין מדידות</div><div class="s">לחצו על "הוספת מדידה" כדי להתחיל</div></div>`;
  }
  function setTempFilter(id) { tempChildSel = id; renderTemp(); }

  function openTempSheet(entryId) {
    const state = DB.get();
    editTempEntryId = entryId || null;
    const entry = entryId ? state.tempEntries.find((e) => e.id === entryId) : null;
    if (entry) tempChildSel = entry.childId;
    else if (!tempChildSel && state.children.length) tempChildSel = state.children[0].id;
    document.getElementById('temp-child-chips').innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === tempChildSel ? 'sel' : ''}" data-id="${c.id}" onclick="App.pickTempChild('${c.id}')">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('temp-value').value = entry ? entry.value : '';
    document.getElementById('temp-error').style.display = 'none';
    document.getElementById('temp-time').value = entry ? formatClock(entry.time) : nowHHMM();
    document.getElementById('temp-sheet-title').textContent = entry ? 'עריכת מדידת חום' : 'הוספת מדידת חום';
    document.getElementById('temp-delete-btn').style.display = entry ? '' : 'none';
    openSheet('sheet-temp');
  }
  function pickTempChild(id) {
    tempChildSel = id;
    document.querySelectorAll('#temp-child-chips .chip').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
  }
  function saveTemp() {
    const val = parseFloat(document.getElementById('temp-value').value);
    const err = document.getElementById('temp-error');
    if (isNaN(val) || val < 30 || val > 43) { err.style.display = 'block'; return; }
    err.style.display = 'none';
    if (!tempChildSel) { toast('אין ילד לבחור — הוסיפו ילד/ה קודם'); return; }
    const patch = { childId: tempChildSel, value: val, time: timeToToday(document.getElementById('temp-time').value || nowHHMM()) };
    try {
      if (editTempEntryId) {
        DB.updateTempEntry(editTempEntryId, patch);
        toast('המדידה עודכנה ✓');
      } else {
        DB.addTempEntry(patch);
        toast('המדידה נשמרה ✓');
      }
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
    editTempEntryId = null;
    closeSheet('sheet-temp');
    renderTemp();
    renderDashboard();
    renderHistory();
  }
  function deleteTempEntry() {
    if (!editTempEntryId) return;
    if (!confirm('למחוק את המדידה הזו? הפעולה אינה הפיכה.')) return;
    try {
      DB.deleteTempEntry(editTempEntryId);
    } catch (e) {
      toast('⚠️ המחיקה נכשלה — נסו שוב');
      return;
    }
    editTempEntryId = null;
    closeSheet('sheet-temp');
    toast('הרשומה נמחקה');
    renderTemp();
    renderDashboard();
    renderHistory();
  }

  /* ---------- hero card interactions ---------- */
  function heroClick() {
    if (heroState.type === 'med') { openMedSheet(); return; }
    if (heroState.type === 'weight' && heroState.childId) { openEditKid(heroState.childId); return; }
    // 'fever' and 'calm' states are informational only — no action on tap
  }

  /* picks the child most in need of a weight update (single child → that child;
     multiple → oldest weightUpdatedAt, or first child if none ever set) and opens the edit sheet directly */
  function quickWeightUpdate() {
    const state = DB.get();
    if (!state.children.length) { toast('הוסיפו ילד/ה קודם דרך הגדרות'); return; }
    if (state.children.length === 1) { openEditKid(state.children[0].id); return; }
    const target = [...state.children].sort((a, b) => (a.weightUpdatedAt || 0) - (b.weightUpdatedAt || 0))[0];
    openEditKid(target.id);
  }

  /* ---------- children management ---------- */
  function renderKids() {
    const state = DB.get();
    document.getElementById('kids-list').innerHTML = state.children.map((c) =>
      `<div class="kid-card">
        <div class="avatar" style="background:${AVATAR_GRADIENT[c.color]}">${c.emoji}</div>
        <div><div class="child-name">${c.name}</div><div class="hist-child">${c.weight} ק״ג${c.birthYear ? ' · נולד/ה ' + c.birthYear : ''}</div></div>
        <button class="kid-edit" onclick="App.openEditKid('${c.id}')">עריכה</button>
      </div>`).join('') || `<div class="empty-state"><div class="ic">👶</div><div class="t">עדיין אין ילדים</div></div>`;
  }
  function openEditKid(id) {
    editingKidId = id;
    const title = document.getElementById('editkid-title');
    if (id) {
      const c = childById(id);
      title.textContent = 'עריכת פרטי ילד/ה';
      document.getElementById('kid-name').value = c.name;
      document.getElementById('kid-weight').value = c.weight;
      document.getElementById('kid-birth').value = c.birthYear || '';
    } else {
      title.textContent = 'הוספת ילד/ה';
      document.getElementById('kid-name').value = '';
      document.getElementById('kid-weight').value = '';
      document.getElementById('kid-birth').value = '';
    }
    openSheet('sheet-editkid');
  }
  function saveKid() {
    const name = document.getElementById('kid-name').value.trim();
    const weight = parseFloat(document.getElementById('kid-weight').value);
    const birthYear = document.getElementById('kid-birth').value ? parseInt(document.getElementById('kid-birth').value, 10) : null;
    if (!name) { toast('נא להזין שם'); return; }
    try {
      if (editingKidId) {
        DB.updateChild(editingKidId, { name, weight: isNaN(weight) ? 0 : weight, birthYear });
      } else {
        DB.addChild({ name, emoji: '🧒', weight: isNaN(weight) ? 0 : weight, birthYear });
      }
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
    closeSheet('sheet-editkid');
    toast('הפרטים נשמרו ✓');
    renderKids();
    renderDashboard();
  }


  /* ---------- dose calculator ---------- */
  /* Active-ingredient layer (phase 1 of the medication architecture — see docs/medication-architecture.md).
     Safety checks (duplicate-dose warnings, reminder dedup) key off activeIngredient, not brand name,
     so e.g. Acamol + Novimol (both paracetamol) are correctly treated as the same substance. */
  const ACTIVE_INGREDIENTS = {
    paracetamol: { id: 'paracetamol', name: 'פרצטמול', aliases: [] },
    ibuprofen: { id: 'ibuprofen', name: 'איבופרופן', aliases: [] },
    vitaminD: { id: 'vitaminD', name: 'ויטמין D', aliases: ['ויטמין די'] },
  };

  /* Treatment protocol types (layer 3) — each is a different logical "engine" for timing/warnings.
     COURSE and WEEKLY are placeholders for phase 2 (not implemented yet — no product uses them). */
  const TREATMENT_TYPES = {
    PRN: 'prn',
    DAILY: 'daily',
    COURSE: 'course',
    WEEKLY: 'weekly',
    CUSTOM: 'custom',
  };

  /* Medication Catalog (layers 2+3): Product info (brand/matchNames/concentrations) + its default
     Protocol (timing/safety rules). See docs/medication-architecture.md for the full model.
     The object key is the Hebrew display name (used for free-text matching against medEntries) —
     `id` is the STABLE identifier that Prescriptions/future references should point to, since the
     display name is allowed to change but the id never should. */
  const MEDICATION_CATALOG = {
    'נובימול': {
      id: 'novimol_drops',
      activeIngredient: 'paracetamol',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: '4–6 שעות', intervalHours: 4, maxDosesPerDay: 5 },
      matchNames: ['נובימול'],
      concentrations: [
        {
          label: 'טיפות 100 מ"ג/מ"ל (טיפטיפות)',
          mgPerMl: 100,
          // exact table from the official patient leaflet — no formula, no rounding
          doseTable: [
            { kg: 3,  mg: 45,  ml: 0.45 },
            { kg: 4,  mg: 60,  ml: 0.60 },
            { kg: 5,  mg: 75,  ml: 0.75 },
            { kg: 6,  mg: 90,  ml: 0.90 },
            { kg: 7,  mg: 105, ml: 1.05 },
            { kg: 8,  mg: 120, ml: 1.20 },
            { kg: 9,  mg: 135, ml: 1.35 },
            { kg: 10, mg: 150, ml: 1.50 },
            { kg: 11, mg: 165, ml: 1.65 },
            { kg: 12, mg: 180, ml: 1.80 },
            { kg: 13, mg: 195, ml: 1.95 },
            { kg: 14, mg: 210, ml: 2.10 },
            { kg: 15, mg: 225, ml: 2.25 },
            { kg: 16, mg: 240, ml: 2.40 },
            { kg: 17, mg: 255, ml: 2.55 },
            { kg: 18, mg: 270, ml: 2.70 },
            { kg: 19, mg: 285, ml: 2.85 },
            { kg: 20, mg: 300, ml: 3.00 },
            { kg: 21, mg: 315, ml: 3.15 },
            { kg: 22, mg: 330, ml: 3.30 },
            { kg: 23, mg: 345, ml: 3.45 },
            { kg: 24, mg: 360, ml: 3.60 },
            { kg: 25, mg: 375, ml: 3.75 },
            { kg: 26, mg: 390, ml: 3.90 },
            { kg: 27, mg: 405, ml: 4.05 },
            { kg: 28, mg: 420, ml: 4.20 },
            { kg: 29, mg: 435, ml: 4.35 },
            { kg: 30, mg: 450, ml: 4.50 },
          ],
        },
      ]
    },
    'אקמול': {
      id: 'acamol_syrup',
      activeIngredient: 'paracetamol',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: null, intervalHours: null, maxDosesPerDay: null },
      matchNames: ['אקמול'],
      concentrations: [
        { label: 'ממתין לעלון רשמי', pendingLeaflet: true },
      ]
    },
    'נורופן': {
      id: 'nurofen_syrup',
      activeIngredient: 'ibuprofen',
      protocol: { version: 1, type: TREATMENT_TYPES.PRN, interval: '6–8 שעות (מרווח מינימלי 4 שעות)', intervalHours: 4, maxDosesPerDay: 4 },
      matchNames: ['נורופן', 'איבופרופן', 'אדוויל'],
      concentrations: [
        {
          label: 'סירופ 100 מ"ג/5מ"ל (20 מ"ג/מ"ל)',
          mgPerMl: 20,
          // exact table from the official patient leaflet — no formula, no rounding
          doseTable: [
            { kgMin: 5,  kgMax: 5.4,  ml: 2 },
            { kgMin: 5.5, kgMax: 8.1, ml: 2.5 },
            { kgMin: 8.2, kgMax: 10.9, ml: 3.75 },
            { kgMin: 11, kgMax: 15,  ml: 5 },
            { kgMin: 16, kgMax: 21,  ml: 7.5 },
            { kgMin: 22, kgMax: 26,  ml: 10 },
            { kgMin: 27, kgMax: 32,  ml: 12.5 },
            { kgMin: 33, kgMax: 43,  ml: 15 },
          ],
        },
        { label: 'פורטה 200 מ"ג/5מ"ל', pendingLeaflet: true },
      ]
    },
    'ויטמין D': {
      id: 'vitamin_d_drops',
      activeIngredient: 'vitaminD',
      protocol: { version: 1, type: TREATMENT_TYPES.DAILY, dosesPerDay: 1 },
      matchNames: ['ויטמין D', 'ויטמין די', 'וויטמין D'],
      concentrations: [
        { label: 'ממתין לנתוני מינון רשמיים', pendingLeaflet: true },
      ]
    },
    /* ── COURSE antibiotics (Step 2A) ────────────────────────────────────── */
    'מוקסיפן': {
      id: 'moxipen_susp',
      activeIngredient: 'amoxicillin',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['מוקסיפן'],
      concentrations: [],
    },
    'אמוקסיצילין': {
      id: 'amoxicillin_generic',
      activeIngredient: 'amoxicillin',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['אמוקסיצילין', 'אמוקסיציל'],
      concentrations: [],
    },
    'אוגמנטין': {
      id: 'augmentin_susp',
      activeIngredient: 'amoxicillin_clavulanate',
      protocol: { version: 1, type: TREATMENT_TYPES.COURSE },
      matchNames: ['אוגמנטין'],
      concentrations: [],
    },
  };
  /* resolves a free-text medicine name (as stored in medEntries / picked in the UI) to its catalog entry */
  function _catalogEntryFor(medicineName) {
    const key = Object.keys(MEDICATION_CATALOG).find((k) => _matchesDrug(medicineName, k));
    return key ? MEDICATION_CATALOG[key] : null;
  }
  /* resolves a stable product id (as stored on a Prescription) back to its display key + entry */
  function _catalogEntryById(productId) {
    const key = Object.keys(MEDICATION_CATALOG).find((k) => MEDICATION_CATALOG[k].id === productId);
    return key ? { key, ...MEDICATION_CATALOG[key] } : null;
  }

  /* ── COURSE helpers (Step 1B) ─────────────────────────────────────────────
     These operate purely on DB data + catalog — no UI side-effects.
     Safe to call from anywhere (dashboard render, reminder scheduler, etc.). */

  /* All active COURSE prescriptions for a child, newest first. */
  function _activeCourses(childId) {
    return DB.activePrescriptionsFor(childId).filter((p) => p.isCourse);
  }

  /* Ideal timestamp of the next dose for a COURSE prescription.
     Returns null if the course is completed/cancelled or has no doses configured.
     Logic: doses are evenly spread across each 24h day.
     e.g. dosesPerDay=2 → dose 0 at startAt, dose 1 at startAt+12h, dose 2 at startAt+24h, ...
     If a dose was already logged, next expected time is based on the last log entry + interval. */
  function _courseNextDoseAt(rx) {
    if (!rx || !rx.isCourse || rx.status !== 'active') return null;
    if (!rx.dosesPerDay || !rx.totalDays) return null;
    const intervalMs = (24 / rx.dosesPerDay) * 3600 * 1000;
    if (!rx.doseLog || rx.doseLog.length === 0) {
      // no doses given yet — first dose is due now (or at startAt, whichever is later)
      return Math.max(rx.startAt, Date.now());
    }
    const lastDoseAt = rx.doseLog[rx.doseLog.length - 1].at;
    return lastDoseAt + intervalMs;
  }

  /* How many doses were logged for this COURSE today (calendar day, 00:00–now).
     Kept for potential future use but no longer drives canMark logic. */
  function _dosesTodayCount(rx) {
    if (!rx || !rx.doseLog) return 0;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return rx.doseLog.filter((d) => d.at >= startOfDay.getTime()).length;
  }

  /* Returns true if enough time has passed since the last logged dose to allow marking a new one.
     Interval = 24h / dosesPerDay (e.g. 3x/day → 8h, 2x/day → 12h).
     Also returns true if no doses have been logged yet (first dose of the course). */
  function _canMarkDoseNow(rx) {
    if (!rx || !rx.isCourse) return false;
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const dosesDone  = rx.doseLog ? rx.doseLog.length : 0;
    if (dosesDone >= totalDoses) return false;
    if (!dosesDone) return true; // first dose — always allowed
    const intervalMs = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt = rx.doseLog[dosesDone - 1].at;
    return Date.now() - lastDoseAt >= intervalMs;
  }

  /* Returns a human-readable string of how long until the next dose is allowed.
     Used in toast when user tries to mark too soon. */
  function _nextDoseInText(rx) {
    if (!rx || !rx.doseLog || !rx.doseLog.length) return '';
    const intervalMs = (24 / (rx.dosesPerDay || 1)) * 3600 * 1000;
    const lastDoseAt = rx.doseLog[rx.doseLog.length - 1].at;
    const remaining  = intervalMs - (Date.now() - lastDoseAt);
    if (remaining <= 0) return '';
    const hrs  = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    if (hrs > 0) return `${hrs} שעות${mins > 0 ? ' ו-' + mins + ' דקות' : ''}`;
    return `${mins} דקות`;
  }

  /* True if the next dose is overdue by more than 30 minutes.
     Used to surface an alert badge on the dashboard card. */
  function _courseIsDoseOverdue(rx) {
    const nextAt = _courseNextDoseAt(rx);
    if (nextAt === null) return false;
    return Date.now() > nextAt + 30 * 60 * 1000;
  }

  /* Human-readable summary string for a COURSE (used in dashboard card subtitle).
     e.g. "יום 3 מתוך 10 · 4/20 מנות" */
  function _courseSummary(rx) {
    if (!rx || !rx.isCourse) return '';
    const dosesDone = rx.doseLog ? rx.doseLog.length : 0;
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const daysSinceStart = Math.floor((Date.now() - rx.startAt) / (24 * 3600 * 1000)) + 1;
    const dayLabel = rx.totalDays ? `יום ${Math.min(daysSinceStart, rx.totalDays)} מתוך ${rx.totalDays}` : '';
    const doseLabel = totalDoses ? `${dosesDone}/${totalDoses} מנות` : '';
    return [dayLabel, doseLabel].filter(Boolean).join(' · ');
  }
  /* Aggregated, read-only snapshot for a child's active treatments — the "ViewModel" a future
     Active Treatments screen (and eventually the dashboard) will read from, instead of each piece
     of UI recomputing this itself. Built entirely on the 4 helpers above; does not touch DB, does
     not render, does not schedule anything.
     "next" = the course whose next dose is soonest among this child's active courses. */
  function _activeTreatmentState(childId) {
    const activeCourses = _activeCourses(childId);
    let nextCourse = null, nextDoseAt = null, overdueCount = 0;
    activeCourses.forEach((rx) => {
      if (_courseIsDoseOverdue(rx)) overdueCount++;
      const at = _courseNextDoseAt(rx);
      if (at != null && (nextDoseAt === null || at < nextDoseAt)) {
        nextDoseAt = at;
        nextCourse = rx;
      }
    });
    return {
      hasActiveCourse: activeCourses.length > 0,
      activeCourses,
      overdueCount,
      nextDoseAt,
      nextCourse,
      summary: nextCourse ? _courseSummary(nextCourse) : '',
    };
  }
  /* ── end COURSE helpers ───────────────────────────────────────────────── */

  /* Step 1E (updated Step 3B) — Active Treatments dashboard card.
     Shows only ACTIVE COURSE prescriptions. Completed ones are hidden here — they appear in History.
     Active courses: "פעיל" badge + "סימון מנה" button (when daily limit not reached) + delete button. */
  function _renderActiveTreatmentsCard(children) {
    const wrap = document.getElementById('dash-active-treatments');
    const dbState = DB.get();
    const rows = [];
    children.forEach((c) => {
      const activeCourses = dbState.prescriptions.filter(
        (p) => p.childId === c.id && p.isCourse && p.status === 'active'
      );
      if (!activeCourses.length) return;
      activeCourses.forEach((rx) => {
        const entry = _catalogEntryById(rx.productId);
        const drugName = entry ? entry.key : 'טיפול פעיל';
        const cardTitle = rx.reason ? `${c.name} — ${rx.reason}` : `${c.name} · ${drugName}`;
        const border = rows.length ? 'border-top:1px solid var(--line);' : '';
        const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
        const dosesDone = rx.doseLog ? rx.doseLog.length : 0;
        const summary = _courseSummary(rx);
        const canMark = _canMarkDoseNow(rx);
        const nextAt  = _courseNextDoseAt(rx);
        let timerText = '';
        if (canMark) {
          timerText = '🟢 זמין עכשיו';
        } else if (nextAt) {
          const remaining = nextAt - Date.now();
          if (remaining > 0) {
            const hrs  = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            timerText = hrs > 0
              ? `⏱ מנה הבאה בעוד ${hrs} שעות${mins > 0 ? ' ו-' + mins + ' דקות' : ''}`
              : `⏱ מנה הבאה בעוד ${mins} דקות`;
          }
        }
        const markBtn = canMark
          ? `<button onclick="App.markCourseDose('${rx.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:var(--accent,#4a90d9);color:#fff;font-size:13px;cursor:pointer;">✓ סימון מנה</button>`
          : `<button onclick="App.markCourseDose('${rx.id}')" style="padding:5px 12px;border-radius:8px;border:none;background:#ccc;color:#888;font-size:13px;cursor:not-allowed;" disabled>✓ סימון מנה</button>`;
        const deleteBtn = `<button onclick="App.deleteCourse('${rx.id}')" style="padding:5px 10px;border-radius:8px;border:none;background:transparent;color:var(--coral,#e57373);font-size:13px;cursor:pointer;">🗑 מחיקה</button>`;
        const editBtn   = `<button onclick="App.openCourseSheet('${rx.id}')" style="padding:5px 10px;border-radius:8px;border:none;background:transparent;color:var(--ink-soft);font-size:13px;cursor:pointer;">✏️ עריכה</button>`;
        rows.push(`
          <div style="padding:9px 0;${border}">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div>
                <div style="font-weight:600;">${cardTitle}</div>
                <div style="font-size:13px;color:var(--ink-soft);">${summary}</div>
                ${timerText ? `<div style="font-size:12px;color:var(--ink-soft);margin-top:2px;">${timerText}</div>` : ''}
              </div>
              <span style="color:var(--mint);white-space:nowrap;">🟢 פעיל</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:6px;">${markBtn}${editBtn}${deleteBtn}</div>
          </div>`);
      });
    });
    if (!rows.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
    wrap.style.display = '';
    wrap.innerHTML = `<div class="info-card"><div style="font-weight:700;margin-bottom:2px;">💊 טיפולים פעילים</div>${rows.join('')}</div>`;
  }

  /* Step 3A — mark a single dose as given for a COURSE prescription.
     Edge cases handled here (not in db.js):
     - rxId not found → null returned from DB → toast + bail
     - course already completed before this call → bail with message
     - doses would exceed totalDays*dosesPerDay → DB auto-completes; we show completion toast */
  async function markCourseDose(rxId) {
    const dbState = DB.get();
    const rx = dbState.prescriptions.find((p) => p.id === rxId);
    if (!rx) { toast('שגיאה: הטיפול לא נמצא'); return; }
    if (rx.status === 'completed') { toast('הטיפול כבר הסתיים'); return; }
    const totalDoses = (rx.totalDays || 0) * (rx.dosesPerDay || 1);
    const doneBeforeLog = rx.doseLog ? rx.doseLog.length : 0;
    if (totalDoses > 0 && doneBeforeLog >= totalDoses) { toast('כל המנות כבר סומנו'); return; }
    if (!_canMarkDoseNow(rx)) {
      const waitText = _nextDoseInText(rx);
      toast(waitText ? `המנה הבאה בעוד ${waitText}` : 'עוד לא הגיע הזמן למנה הבאה');
      return;
    }
    const updated = DB.logCourseDose(rxId, 1);
    if (!updated) { toast('שגיאה בשמירה — נסה שוב'); return; }
    if (updated.status === 'completed') {
      await _cancelCourseReminder(updated); // no more doses — cancel any pending push
      toast('🎉 הטיפול הושלם בהצלחה!');
    } else {
      const done = updated.doseLog.length;
      toast(`✓ מנה ${done} מתוך ${totalDoses} סומנה`);
      _scheduleCourseReminder(updated); // best-effort, not awaited — don't block UI
    }
    renderDashboard();
  }

  let doseMedSel = 'אקמול / נובימול';
  let doseConcIdx = 0;
  let doseChildId = null;

  /* Step 3B — manually delete an active COURSE prescription (with confirm). */
  async function deleteCourse(rxId) {
    const dbState = DB.get();
    const rx = dbState.prescriptions.find((p) => p.id === rxId);
    if (!rx) { toast('הטיפול לא נמצא'); return; }
    const entry = _catalogEntryById(rx.productId);
    const drugName = entry ? entry.key : 'טיפול';
    if (!confirm(`למחוק את הטיפול ב${drugName}? הפעולה לא ניתנת לביטול.`)) return;
    await _cancelCourseReminder(rx);
    DB.deletePrescription(rxId);
    renderDashboard();
    toast('הטיפול נמחק');
  }
  let courseChildId = null;
  let courseDrugSel = null; // key in MEDICATION_CATALOG
  let editCourseRxId = null; // null = new course, rxId = edit mode

  function openCourseSheet(rxId = null) {
    const state = DB.get();
    editCourseRxId = rxId || null;

    if (editCourseRxId) {
      // edit mode — load existing prescription values
      const rx = state.prescriptions.find((p) => p.id === editCourseRxId);
      if (!rx) { toast('הטיפול לא נמצא'); return; }
      courseChildId = rx.childId;
      const entry = _catalogEntryById(rx.productId);
      courseDrugSel = entry ? entry.key : null;
      document.getElementById('course-days').value = rx.totalDays || '';
      document.getElementById('course-doses-per-day').value = rx.dosesPerDay || '';
      document.getElementById('course-reason').value = rx.reason || '';
      document.getElementById('sheet-course-title').textContent = '✏️ עריכת טיפול';
    } else {
      // new course
      courseChildId = state.children[0]?.id || null;
      const firstCourseKey = Object.keys(MEDICATION_CATALOG).find(
        (k) => MEDICATION_CATALOG[k].protocol.type === TREATMENT_TYPES.COURSE
      );
      courseDrugSel = firstCourseKey || null;
      document.getElementById('course-days').value = '';
      document.getElementById('course-doses-per-day').value = '';
      document.getElementById('course-reason').value = '';
      document.getElementById('sheet-course-title').textContent = '💊 פתיחת טיפול';
    }

    _renderCourseChildChips();
    _renderCourseDrugChips();
    openSheet('sheet-course');
  }

  function _renderCourseChildChips() {
    const state = DB.get();
    const box = document.getElementById('course-child-chips');
    if (!box) return;
    if (editCourseRxId) {
      // edit mode — show selected child as read-only
      const c = state.children.find((ch) => ch.id === courseChildId);
      box.innerHTML = c ? `<span class="chip sel" style="opacity:.7;">${c.emoji} ${c.name}</span>` : '';
      return;
    }
    box.innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === courseChildId ? 'sel' : ''}" onclick="App.pickCourseChild('${c.id}')">${c.emoji} ${c.name}</button>`
    ).join('');
  }

  function _renderCourseDrugChips() {
    const box = document.getElementById('course-drug-chips');
    if (!box) return;
    if (editCourseRxId) {
      // edit mode — show selected drug as read-only
      box.innerHTML = courseDrugSel ? `<span class="chip sel" style="opacity:.7;">${courseDrugSel}</span>` : '';
      return;
    }
    const courseKeys = Object.keys(MEDICATION_CATALOG).filter(
      (k) => MEDICATION_CATALOG[k].protocol.type === TREATMENT_TYPES.COURSE
    );
    box.innerHTML = courseKeys.map((k) =>
      `<button type="button" class="chip ${k === courseDrugSel ? 'sel' : ''}" onclick="App.pickCourseDrug('${k}')">${k}</button>`
    ).join('');
  }

  function pickCourseChild(id) {
    courseChildId = id;
    _renderCourseChildChips();
  }

  function pickCourseDrug(key) {
    courseDrugSel = key;
    _renderCourseDrugChips();
  }

  function saveCourse() {
    if (!courseChildId) { toast('יש לבחור ילד/ה'); return; }
    if (!courseDrugSel) { toast('יש לבחור תרופה'); return; }
    const totalDays = parseInt(document.getElementById('course-days').value, 10);
    const dosesPerDay = parseInt(document.getElementById('course-doses-per-day').value, 10);
    if (!totalDays || totalDays < 1 || totalDays > 30) { toast('יש להזין מספר ימים (1–30)'); return; }
    if (!dosesPerDay || dosesPerDay < 1 || dosesPerDay > 6) { toast('יש להזין מספר מנות ביום (1–6)'); return; }
    const reason = (document.getElementById('course-reason').value || '').trim();
    if (!reason) { toast('יש להזין סיבת הטיפול'); return; }

    if (editCourseRxId) {
      // edit mode — update totalDays, dosesPerDay, reason
      const updated = DB.updatePrescription(editCourseRxId, { totalDays, dosesPerDay, reason });
      if (!updated) { toast('שגיאה בשמירה — נסה שוב'); return; }
      // reschedule push with new interval
      _cancelCourseReminder(updated).then(() => _scheduleCourseReminder(
        DB.get().prescriptions.find((p) => p.id === editCourseRxId)
      ));
      closeSheet('sheet-course');
      renderDashboard();
      toast('הטיפול עודכן ✓');
      editCourseRxId = null;
      return;
    }

    // new course
    const drug = MEDICATION_CATALOG[courseDrugSel];
    try {
      DB.addPrescription({
        childId: courseChildId,
        productId: drug.id,
        isCourse: true,
        totalDays,
        dosesPerDay,
        reason,
      });
      closeSheet('sheet-course');
      renderDashboard();
      toast('הטיפול נפתח בהצלחה ✓');
    } catch (e) {
      toast('שגיאה בשמירה — נסה שוב');
    }
  }
  /* ── end sheet-course (Step 2A) ─────────────────────────────────────────── */

  function openDoseSheet() {
    const state = DB.get();
    doseChildId = state.children[0]?.id || null;
    doseMedSel = 'נובימול';
    doseConcIdx = 0;
    _renderDoseChildChips();
    _renderDoseMedChips();
    _renderDoseConcChips();
    document.getElementById('dose-weight').value = ''; // always empty — must be typed fresh every time
    calcDose();
    openSheet('sheet-dose');
  }

  function _renderDoseChildChips() {
    const state = DB.get();
    const box = document.getElementById('dose-child-chips');
    if (!box) return;
    box.innerHTML = state.children.map((c) =>
      `<button type="button" class="chip ${c.id === doseChildId ? 'sel' : ''}" onclick="App.pickDoseChild('${c.id}')">${c.emoji} ${c.name}</button>`
    ).join('');
  }

  function pickDoseChild(id) {
    doseChildId = id;
    _renderDoseChildChips();
    calcDose(); // weight value itself is untouched — only history warnings re-check for the new child
  }

  function _renderDoseMedChips() {
    document.getElementById('dose-med-chips').innerHTML = Object.keys(MEDICATION_CATALOG).map((m) =>
      `<button type="button" class="chip ${m === doseMedSel ? 'sel' : ''}" onclick="App.pickDoseMed('${m}')">${m}</button>`
    ).join('');
  }

  function _renderDoseConcChips() {
    const concs = MEDICATION_CATALOG[doseMedSel].concentrations;
    document.getElementById('dose-conc-chips').innerHTML = concs.map((c, i) =>
      `<button type="button" class="chip ${i === doseConcIdx ? 'sel' : ''}" onclick="App.pickDoseConc(${i})">${c.label}</button>`
    ).join('');
  }

  function pickDoseMed(name) {
    doseMedSel = name;
    doseConcIdx = 0;
    _renderDoseMedChips();
    _renderDoseConcChips();
    calcDose();
  }

  function pickDoseConc(idx) {
    doseConcIdx = idx;
    _renderDoseConcChips();
    calcDose();
  }

  /* does a free-text medicine name (as stored in medEntries) belong to this MEDICATION_CATALOG drug? */
  function _matchesDrug(medicineName, drugKey) {
    if (!medicineName) return false;
    const names = MEDICATION_CATALOG[drugKey].matchNames || [];
    return names.some((n) => medicineName.indexOf(n) !== -1);
  }
  /* all brand keys (MEDICATION_CATALOG entries) that share a given active ingredient — e.g. paracetamol -> ['נובימול','אקמול'] */
  function _brandKeysForIngredient(ingredientKey) {
    return Object.keys(MEDICATION_CATALOG).filter((k) => MEDICATION_CATALOG[k].activeIngredient === ingredientKey);
  }
  /* true if medicineName matches ANY brand sharing this active ingredient — this is what lets the app
     see Acamol + Novimol as "the same substance" for safety checks, instead of two unrelated drugs */
  function _matchesIngredient(medicineName, ingredientKey) {
    return _brandKeysForIngredient(ingredientKey).some((k) => _matchesDrug(medicineName, k));
  }

  function _doseHistoryWarning(childId, drugKey) {
    if (!childId) return null;
    const drug = MEDICATION_CATALOG[drugKey];
    const ingredientKey = drug.activeIngredient;
    const ingredient = ingredientKey ? ACTIVE_INGREDIENTS[ingredientKey] : null;
    const now = Date.now();
    // match on the active ingredient (across brands) when we know it — otherwise fall back to this brand only
    const entries = ingredientKey
      ? DB.get().medEntries.filter((e) => e.childId === childId && _matchesIngredient(e.medicine, ingredientKey))
      : DB.get().medEntries.filter((e) => e.childId === childId && _matchesDrug(e.medicine, drugKey));
    if (!entries.length) return null;

    const last = entries.reduce((a, b) => (b.time > a.time ? b : a));

    if (drug.protocol.type === TREATMENT_TYPES.DAILY) {
      // once-a-day meds: warn if one was already given today (calendar day), not by hour-interval
      const sameDay = new Date(last.time).toDateString() === new Date(now).toDateString();
      if (sameDay) {
        return { level: 'alert', text: `☀️ ${ingredient ? ingredient.name : drugKey} כבר ניתן/ה היום ב-${formatClock(last.time)} — זו תרופה שניתנת פעם אחת ביום.` };
      }
      return null;
    }

    if (drug.protocol.intervalHours != null) {
      const hoursSince = (now - last.time) / 3600000;
      if (hoursSince < drug.protocol.intervalHours) {
        const remain = Math.ceil(drug.protocol.intervalHours - hoursSince);
        const otherBrand = ingredient && !_matchesDrug(last.medicine, drugKey) ? ` (${ingredient.name}, ניתן בתור "${last.medicine}")` : '';
        return { level: 'alert', text: `⏱️ המנה האחרונה${otherBrand} הייתה לפני ${hoursSince < 1 ? 'פחות משעה' : Math.floor(hoursSince) + ' שעות'} — המרווח המומלץ הוא ${drug.protocol.interval}. מומלץ להמתין כ־${remain} שעות נוספות לפני מנה נוספת.` };
      }
    }

    if (drug.protocol.maxDosesPerDay != null) {
      const last24h = entries.filter((e) => now - e.time <= 24 * 3600000).length;
      if (last24h >= drug.protocol.maxDosesPerDay) {
        const substanceNote = ingredient ? `מ${ingredient.name} (כולל מותגים אחרים עם אותו חומר פעיל)` : 'מהתרופה הזו';
        return { level: 'alert', text: `⚠️ כבר ניתנו ${last24h} מנות ${substanceNote} ב־24 השעות האחרונות — זהו המספר המרבי המומלץ ליום. אין לתת מנה נוספת בלי להתייעץ עם רופא/ה או רוקח/ת.` };
      }
    }
    return null;
  }

  /* find the leaflet table row for a given weight — never extrapolates beyond the table.
     Supports two official leaflet formats:
     - per-kg rows ({kg, ml, mg}) — floors to the nearest defined weight (e.g. Novimol)
     - weight-range rows ({kgMin, kgMax, ml}) — exact bracket match (e.g. Nurofen) */
  function _findDoseRow(doseTable, weight) {
    const isRangeTable = doseTable[0].kgMin != null;

    if (isRangeTable) {
      const sorted = [...doseTable].sort((a, b) => a.kgMin - b.kgMin);
      if (weight < sorted[0].kgMin) return { outOfRange: 'below', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax };
      if (weight > sorted[sorted.length - 1].kgMax) return { outOfRange: 'above', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax };
      const row = sorted.find((r) => weight >= r.kgMin && weight <= r.kgMax);
      if (!row) return { outOfRange: 'below', min: sorted[0].kgMin, max: sorted[sorted.length - 1].kgMax }; // falls in a gap between brackets
      return { row };
    }

    const sorted = [...doseTable].sort((a, b) => a.kg - b.kg);
    if (weight < sorted[0].kg) return { outOfRange: 'below', min: sorted[0].kg, max: sorted[sorted.length - 1].kg };
    if (weight > sorted[sorted.length - 1].kg) return { outOfRange: 'above', min: sorted[0].kg, max: sorted[sorted.length - 1].kg };
    // exact match if present, otherwise the nearest lower defined weight
    let row = sorted[0];
    for (const r of sorted) { if (r.kg <= weight) row = r; else break; }
    return { row };
  }

  function calcDose() {
    const weight = parseFloat(document.getElementById('dose-weight').value);
    const box = document.getElementById('dose-result');
    const warnBox = document.getElementById('dose-warning');
    if (warnBox) { warnBox.style.display = 'none'; warnBox.innerHTML = ''; }

    if (!weight || weight < 1 || weight > 60) { box.style.display = 'none'; return; }

    const drug = MEDICATION_CATALOG[doseMedSel];
    const conc = drug.concentrations[doseConcIdx];

    if (conc.pendingLeaflet) {
      box.style.display = 'none';
      if (warnBox) {
        warnBox.style.display = 'block';
        warnBox.className = 'dose-warning dose-warning-block';
        warnBox.innerHTML = `📋 עדיין אין טבלת מינון רשמית לצורת מתן זו במערכת. יש לצלם את עלון היצרן ולשלוח כדי שהמינון המדויק יתווסף — עד אז אין הצגת מינון עבורה.`;
      }
      return;
    }

    const lookup = _findDoseRow(conc.doseTable, weight);
    if (lookup.outOfRange) {
      box.style.display = 'none';
      if (warnBox) {
        warnBox.style.display = 'block';
        warnBox.className = 'dose-warning dose-warning-block';
        const dir = lookup.outOfRange === 'below' ? 'מתחת' : 'מעל';
        warnBox.innerHTML = `🚫 המשקל ${dir} לטווח הטבלה הרשמית של צורת מתן זו (${lookup.min}–${lookup.max} ק"ג). יש לבחור צורת מתן אחרת המתאימה למשקל, או להתייעץ עם רופא/ה או רוקח/ת.`;
      }
      return;
    }

    const { row } = lookup;
    const mg = row.mg != null ? row.mg : (conc.mgPerMl != null ? Math.round(row.ml * conc.mgPerMl) : null);
    const weightLabel = row.kg != null ? `${row.kg} ק"ג` : `${row.kgMin}–${row.kgMax} ק"ג`;
    const subParts = [];
    if (drug.protocol.interval) subParts.push(`כל ${drug.protocol.interval}`);
    if (drug.protocol.maxDosesPerDay != null) subParts.push(`עד ${drug.protocol.maxDosesPerDay} מנות ב-24 שעות`);
    box.style.display = 'block';
    box.innerHTML = `
      <div class="dose-result-title">המינון לפי טבלת היצרן</div>
      <div class="dose-result-ml">${row.ml.toFixed(2)} מ"ל</div>
      <div class="dose-result-sub">${subParts.length ? subParts.join(' · ') : 'יש לבדוק מרווח ומספר מנות מרבי בעלון'}</div>
      <div class="dose-result-detail">${mg != null ? mg + ' מ"ג ' : ''}לילד/ה במשקל ${weightLabel} (טבלת עלון היצרן)</div>
    `;

    const warning = _doseHistoryWarning(doseChildId, doseMedSel);
    if (warning && warnBox) {
      warnBox.style.display = 'block';
      warnBox.className = 'dose-warning dose-warning-' + warning.level;
      warnBox.innerHTML = warning.text;
    }
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const on = DB.get().settings.notifications;
    document.getElementById('toggle-notif').classList.toggle('on', on);
    document.getElementById('set-version-num').textContent = APP_VERSION;
    const aboutV = document.getElementById('about-version-num');
    if (aboutV) aboutV.textContent = APP_VERSION;
  }
  /* generic handler for features that are planned but not built yet — keeps buttons
     visibly "alive" instead of dead, per Step 1.3 (no silent no-op buttons in Settings) */
  function stub() {
    toast('🚧 הפיצ׳ר יתווסף בגרסה עתידית');
  }
  function toggleNotif() {
    const on = !DB.get().settings.notifications;

    // עדכן UI מיד — לפני כל async
    try {
      DB.setSetting('notifications', on);
    } catch (e) {
      toast('⚠️ השמירה נכשלה — בדקו מקום פנוי במכשיר ונסו שוב');
      return;
    }
    renderSettings();

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      if (on) {
        const permState = Notification.permission;

        if (permState === 'denied') {
          // iOS חסם — החזר טאגל לכבוי
          DB.setSetting('notifications', false);
          renderSettings();
          toast('אפשר גישה להתראות: הגדרות ← Medickids ← התראות');
          return;
        }

        if (permState === 'granted') {
          await OneSignal.User.PushSubscription.optIn();
          toast('התראות הופעלו ✅');
          return;
        }

        // default — בקש רשות
        const granted = await OneSignal.Notifications.requestPermission();
        if (granted) {
          await OneSignal.User.PushSubscription.optIn();
          toast('התראות הופעלו ✅');
        } else {
          DB.setSetting('notifications', false);
          renderSettings();
          toast('אפשר גישה להתראות: הגדרות ← Medickids ← התראות');
        }
      } else {
        await OneSignal.User.PushSubscription.optOut();
        toast('התראות כובו');
      }
    });
  }

  /* ---------- version / updates ---------- */
  function checkForUpdate() {
    if (!('serviceWorker' in navigator)) { toast('הדפדפן לא תומך בבדיקת עדכונים'); return; }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { toast('לא נמצא Service Worker פעיל'); return; }
      toast('בודק עדכונים…');
      let updated = false;
      const onControllerChange = () => {
        updated = true;
        toast('נמצא עדכון — טוען מחדש…');
        setTimeout(() => window.location.reload(), 600);
      };
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange, { once: true });
      reg.update().catch(() => {});
      setTimeout(() => {
        if (!updated) {
          navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
          toast(`אתה כבר בגרסה העדכנית (${APP_VERSION}) ✓`);
        }
      }, 2500);
    });
  }

  /* ---------- danger zone ---------- */
  function confirmReset() {
    const sure = confirm('לאפס את כל הנתונים? כל הילדים, התרופות והמדידות יימחקו לצמיתות. הפעולה אינה הפיכה.');
    if (!sure) return;
    const reallySure = confirm('בטוח/ה לגמרי? זו הזדמנות אחרונה לבטל.');
    if (!reallySure) return;
    try {
      DB.reset();
    } catch (e) {
      toast('⚠️ האיפוס נכשל — נסו שוב');
      return;
    }
    toast('כל הנתונים אופסו');
    renderLanding();
    renderDashboard();
    renderHistory();
    renderTemp();
    renderSettings();
    renderKids();
    goto('screen-kids');
  }

  function init() {
    // Render all screens so they're ready before any transition
    renderLanding();
    renderDashboard();
    renderSettings();
    setInterval(renderDashboard, 60000); // keep "elapsed" times fresh
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // ---------- flow routing ----------
    // Step 1: non-standalone browser → show Landing (A2HS prompt), stop here.
    if (!isStandalone()) {
      goto('screen-landing');
      return;
    }

    // Step 2: standalone (installed PWA) — decide by data, not by platform.
    const isReturningUser = DB.get().children.length > 0;

    if (isReturningUser) {
      // Returning user: short splash → Dashboard
      showSplash();
      setTimeout(() => goto('screen-dash'), SPLASH_DURATION_RETURNING);
    } else {
      // New user: splash → Onboarding (add first child) → Dashboard
      showSplash();
      setTimeout(() => goto('screen-kids'), SPLASH_DURATION_NEW);
    }
  }

  return {
    goto, tab, openSheet, closeSheet,
    openMedSheet, pickMedChild, pickMedMedicine, addCustomMedicine, saveMed, pickReminderMode, toggleDailyReminder,
    setHistFilter, setTempFilter, openTempSheet, pickTempChild, saveTemp,
    openEditKid, saveKid, toggleNotif, init,
    installNow, skipLanding,
    openDoseSheet, pickDoseChild, pickDoseMed, pickDoseConc, calcDose,
    openCourseSheet, pickCourseChild, pickCourseDrug, saveCourse,
    markCourseDose, deleteCourse,
    heroClick, quickWeightUpdate,
    deleteMedEntry, deleteTempEntry, confirmReset,
    checkForUpdate,
    stub,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);








