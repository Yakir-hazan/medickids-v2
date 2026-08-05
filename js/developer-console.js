/* ============================================================================
   MEDICKIDS — DEVELOPER CENTER  (js/developer-console.js)
   ============================================================================
   Self-contained, isolated debugging tool. Does not modify or depend on the
   internals of app.js/db.js — it hooks their PUBLIC surface (window/App/DB,
   console, fetch, window.onerror) from the outside. Fully inert when
   Developer Mode is off (localStorage['madhom_devmode'] !== '1'): hooks still
   run (so nothing is missed once you turn it on), but they only push into an
   in-memory ring buffer — no DOM, no rendering, negligible cost.

   ⚠️ ARCHITECTURAL RULE FOR ALL FUTURE MEDICKIDS WORK (Active Treatments,
   dose calculator changes, sync, anything):
   Developer Center is the single source of truth for debugging this project.
   New features must emit structured events through `DevCenter.log(category,
   label, detail)` instead of adding ad-hoc console.log() calls scattered
   through the code. If you're adding a new subsystem, give it a category
   and log through DevCenter — don't reinvent debug output.

   Activation: tap "גרסת אפליקציה" in Settings 7 times within 2s of each tap.
   Deactivation: Tools tab → "כבה מצב מפתח".
   ============================================================================ */
(function () {
  'use strict';

  const DEVMODE_KEY = 'madhom_devmode';
  const MAX_EVENTS = 500;
  const SESSION_ID = Math.random().toString(36).slice(2, 7).toUpperCase();
  const SESSION_STARTED = Date.now();

  const CATEGORY = { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', NETWORK: 'NETWORK', DB: 'DB', UI: 'UI' };
  const CAT_ICON = { INFO: '🟢', WARNING: '🟡', ERROR: '🔴', NETWORK: '🔵', DB: '🟣', UI: '⚫' };

  const events = [];
  let eventSeq = 0;
  let panelOpen = false;
  let currentTab = 'timeline';
  let searchQuery = '';
  let quickFilter = 'all'; // all | errors | network | db | hour | today
  let breadcrumbMode = false;
  let replayTimer = null;

  function isDevMode() {
    try { return localStorage.getItem(DEVMODE_KEY) === '1'; } catch (e) { return false; }
  }
  function setDevMode(on) {
    try { localStorage.setItem(DEVMODE_KEY, on ? '1' : '0'); } catch (e) {}
  }

  /* ---------- safe serialization (never let logging itself throw or bloat memory) ---------- */
  function safeStringify(val, maxLen) {
    maxLen = maxLen || 800;
    let out;
    try {
      const seen = new WeakSet();
      out = JSON.stringify(val, function (k, v) {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        if (typeof v === 'function') return '[function]';
        return v;
      });
    } catch (e) { out = String(val); }
    if (out == null) out = String(val);
    if (out.length > maxLen) out = out.slice(0, maxLen) + `… [+${out.length - maxLen} chars]`;
    return out;
  }

  /* ---------- core event log ---------- */
  function logEvent(category, source, label, detail, extra) {
    eventSeq++;
    const ev = Object.assign({
      id: eventSeq, ts: Date.now(), session: SESSION_ID,
      category, source, label, detail: detail || '',
    }, extra || {});
    events.push(ev);
    if (events.length > MAX_EVENTS) events.shift();
    if (panelOpen) scheduleRender();
    return ev;
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => { renderScheduled = false; renderPanelBody(); });
  }

  // public API — this is what future features should call instead of console.log
  window.DevCenter = {
    log: (category, label, detail) => logEvent(CATEGORY[category] || CATEGORY.INFO, 'app-feature', label, detail),
  };

  /* ---------- Phase A: global hooks, installed immediately (before db.js/app.js load) ---------- */
  (function installConsoleHooks() {
    ['log', 'warn', 'error', 'info'].forEach((m) => {
      const orig = console[m];
      console[m] = function (...args) {
        orig.apply(console, args);
        const cat = m === 'error' ? CATEGORY.ERROR : m === 'warn' ? CATEGORY.WARNING : CATEGORY.INFO;
        logEvent(cat, 'console', 'console.' + m, safeStringify(args));
      };
    });
  })();

  window.addEventListener('error', function (e) {
    logEvent(CATEGORY.ERROR, 'window.onerror', e.message || 'Unknown error',
      `${e.filename || ''}:${e.lineno || 0}:${e.colno || 0}`, { stack: e.error && e.error.stack });
  });
  window.addEventListener('unhandledrejection', function (e) {
    logEvent(CATEGORY.ERROR, 'unhandledrejection', 'Promise rejected', safeStringify(e.reason));
  });

  window.addEventListener('online', function () {
    logEvent(CATEGORY.INFO, 'system', 'Back Online', '');
    if (panelOpen && currentTab === 'health') renderPanelBody();
  });
  window.addEventListener('offline', function () {
    logEvent(CATEGORY.WARNING, 'system', 'Went Offline', '');
    if (panelOpen && currentTab === 'health') renderPanelBody();
  });

  (function installFetchHook() {
    const origFetch = window.fetch;
    if (!origFetch) return;
    window.fetch = async function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      const method = (args[1] && args[1].method) || 'GET';
      const start = performance.now();
      try {
        const res = await origFetch.apply(window, args);
        const dur = Math.round(performance.now() - start);
        logEvent(CATEGORY.NETWORK, 'fetch', `${method} ${url}`, `${res.status} · ${dur}ms`, { duration: dur, status: res.status, failed: !res.ok });
        return res;
      } catch (err) {
        const dur = Math.round(performance.now() - start);
        logEvent(CATEGORY.NETWORK, 'fetch', `${method} ${url}`, `FAILED: ${err.message} · ${dur}ms`, { duration: dur, failed: true });
        throw err;
      }
    };
  })();

  /* ---------- Phase B: wrap App/DB public methods once they exist (before App.init runs, since
     we register this DOMContentLoaded listener first — file load order guarantees that) ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    try { wrapPublicMethods('App', window.App || (typeof App !== 'undefined' ? App : null), CATEGORY.UI, 'app'); } catch (e) {}
    try { wrapPublicMethods('DB', window.DB || (typeof DB !== 'undefined' ? DB : null), CATEGORY.DB, 'db'); } catch (e) {}
    setupActivation();
    if (isDevMode()) showFab();
    logEvent(CATEGORY.INFO, 'system', 'App Started', `session ${SESSION_ID}`);
  });

  function wrapPublicMethods(name, obj, category, source) {
    if (!obj) return;
    Object.keys(obj).forEach((key) => {
      const orig = obj[key];
      if (typeof orig !== 'function') return;
      obj[key] = function (...args) {
        const label = `${name}.${key}()`;
        const isDbWrite = source === 'db' && key !== 'get' && !key.startsWith('last') && !key.startsWith('temps')
          && key !== 'feed' && key !== 'nightSummary' && key !== 'activePrescriptionsFor' && key !== 'uid';
        let stateBefore = null;
        try { if (isDbWrite && typeof DB !== 'undefined') stateBefore = safeStringify(DB.get(), 3000); } catch (e) {}
        const start = performance.now();
        let result, threw = null;
        try { result = orig.apply(obj, args); } catch (e) { threw = e; }
        const duration = Math.round(performance.now() - start);
        let stateAfter = null;
        try { if (isDbWrite && typeof DB !== 'undefined') stateAfter = safeStringify(DB.get(), 3000); } catch (e) {}
        logEvent(threw ? CATEGORY.ERROR : category, source, label, threw ? `threw: ${threw.message}` : 'ok', {
          args: safeStringify(args, 400), returnValue: threw ? null : safeStringify(result, 400),
          duration, stateBefore, stateAfter,
        });
        if (threw) throw threw;
        return result;
      };
    });
  }

  /* ---------- activation: 7 taps on the version row ---------- */
  function setupActivation() {
    let tapCount = 0, tapTimer = null;
    document.addEventListener('click', function (e) {
      const target = e.target.closest && e.target.closest('#set-version-num');
      if (!target) return;
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
      if (tapCount >= 7) {
        tapCount = 0;
        setDevMode(true);
        showFab();
        logEvent(CATEGORY.INFO, 'system', 'Developer Mode Activated', '');
        openPanel();
      }
    });
  }

  /* ---------- floating button ---------- */
  function showFab() {
    if (document.getElementById('devctr-fab')) return;
    const btn = document.createElement('div');
    btn.id = 'devctr-fab';
    btn.textContent = '🐞';
    btn.setAttribute('style', 'position:fixed;bottom:78px;left:14px;width:46px;height:46px;border-radius:50%;' +
      'background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;' +
      'z-index:999999;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;user-select:none;');
    btn.onclick = openPanel;
    document.body.appendChild(btn);
  }
  function hideFab() {
    const f = document.getElementById('devctr-fab');
    if (f) f.remove();
  }

  /* ---------- panel shell ---------- */
  function openPanel() {
    panelOpen = true;
    let panel = document.getElementById('devctr-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'devctr-panel';
      panel.setAttribute('style', 'position:fixed;inset:0;z-index:9999999;background:#0f0f1a;color:#e8e8f0;' +
        'font-family:-apple-system,system-ui,sans-serif;display:flex;flex-direction:column;direction:rtl;');
      document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    renderPanel();
  }
  function closePanel() {
    panelOpen = false;
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
    const panel = document.getElementById('devctr-panel');
    if (panel) panel.style.display = 'none';
  }

  const TABS = [
    ['health', '🩺 Health'], ['timeline', '⏱️ Timeline'], ['logs', '📝 Logs'], ['errors', '🔴 Errors'],
    ['network', '🔵 Network'], ['database', '🟣 Database'], ['storage', '💾 Storage'],
    ['tools', '🛠️ Tools'], ['export', '📤 Export'],
  ];

  function renderPanel() {
    const panel = document.getElementById('devctr-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div style="padding:10px 12px;background:#1a1a2e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-weight:700;">🐞 Developer Center <span style="opacity:.5;font-weight:400;font-size:12px;">Session ${SESSION_ID}</span></div>
        <div onclick="DevCenterUI.close()" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;">✕</div>
      </div>
      <div id="devctr-tabs" style="display:flex;overflow-x:auto;background:#16162a;flex-shrink:0;"></div>
      <div id="devctr-body" style="flex:1;overflow-y:auto;padding:10px 12px;"></div>
    `;
    const tabsEl = panel.querySelector('#devctr-tabs');
    tabsEl.innerHTML = TABS.map(([id, label]) =>
      `<div onclick="DevCenterUI.setTab('${id}')" style="padding:9px 12px;white-space:nowrap;cursor:pointer;font-size:13px;
        ${currentTab === id ? 'border-bottom:2px solid #7C6FF0;color:#fff;' : 'color:#888;'}">${label}</div>`).join('');
    renderPanelBody();
  }

  function renderPanelBody() {
    const body = document.getElementById('devctr-body');
    if (!body) return;
    if (currentTab === 'health') body.innerHTML = renderHealthTab();
    else if (currentTab === 'timeline') body.innerHTML = renderTimelineTab();
    else if (currentTab === 'logs') body.innerHTML = renderListTab(events.filter((e) => e.source === 'console' || e.source === 'window.onerror'));
    else if (currentTab === 'errors') body.innerHTML = renderListTab(events.filter((e) => e.category === CATEGORY.ERROR));
    else if (currentTab === 'network') body.innerHTML = renderListTab(events.filter((e) => e.category === CATEGORY.NETWORK));
    else if (currentTab === 'database') body.innerHTML = renderDatabaseTab();
    else if (currentTab === 'storage') body.innerHTML = renderStorageTab();
    else if (currentTab === 'tools') body.innerHTML = renderToolsTab();
    else if (currentTab === 'export') body.innerHTML = renderExportTab();
  }

  /* ---------- Timeline (default tab) ---------- */
  function filteredEvents() {
    let list = events;
    if (quickFilter === 'errors') list = list.filter((e) => e.category === CATEGORY.ERROR);
    else if (quickFilter === 'network') list = list.filter((e) => e.category === CATEGORY.NETWORK);
    else if (quickFilter === 'db') list = list.filter((e) => e.category === CATEGORY.DB);
    else if (quickFilter === 'hour') list = list.filter((e) => e.ts > Date.now() - 3600000);
    else if (quickFilter === 'today') list = list.filter((e) => new Date(e.ts).toDateString() === new Date().toDateString());
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((e) => (e.label + ' ' + e.detail).toLowerCase().includes(q));
    }
    return list;
  }

  function renderTimelineTab() {
    const list = filteredEvents();
    const chips = [['all', 'הכל'], ['errors', 'שגיאות'], ['network', 'Network'], ['db', 'DB'], ['hour', 'שעה אחרונה'], ['today', 'היום']];
    return `
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <input id="devctr-search" value="${escapeHtml(searchQuery)}" placeholder="🔍 חיפוש..." oninput="DevCenterUI.setSearch(this.value)"
          style="flex:1;padding:8px;border-radius:8px;border:1px solid #333;background:#1a1a2e;color:#fff;font-size:13px;">
        <div onclick="DevCenterUI.toggleBreadcrumb()" style="padding:8px 10px;border-radius:8px;background:${breadcrumbMode ? '#7C6FF0' : '#1a1a2e'};font-size:13px;cursor:pointer;white-space:nowrap;">🔗 שרשרת</div>
        <div onclick="DevCenterUI.replay()" style="padding:8px 10px;border-radius:8px;background:#1a1a2e;font-size:13px;cursor:pointer;white-space:nowrap;">▶️ Replay</div>
      </div>
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;">
        ${chips.map(([id, label]) => `<div onclick="DevCenterUI.setFilter('${id}')" style="padding:5px 10px;border-radius:20px;font-size:12px;white-space:nowrap;cursor:pointer;
          background:${quickFilter === id ? '#7C6FF0' : '#1a1a2e'};">${label}</div>`).join('')}
      </div>
      <div id="devctr-timeline-list-wrap">${renderEventList(list)}</div>
    `;
  }

  function renderListTab(list) {
    return `<div style="margin-bottom:8px;opacity:.6;font-size:12px;">${list.length} אירועים</div>${renderEventList(list.slice().reverse())}`;
  }

  function renderEventList(list) {
    if (!list.length) return `<div style="opacity:.5;text-align:center;padding:30px 0;">אין אירועים עדיין</div>`;
    const ordered = list.slice().reverse(); // newest first
    return ordered.map((e, i) => `
      <div id="devctr-ev-${e.id}" onclick="DevCenterUI.toggleDetail(${e.id})" style="padding:8px 0;border-bottom:1px solid #222;cursor:pointer;">
        <div style="display:flex;gap:8px;align-items:baseline;font-size:13px;">
          <span style="opacity:.4;font-size:11px;">#${String(e.id).padStart(6, '0')}</span>
          <span>${CAT_ICON[e.category] || '⚪'}</span>
          <span style="opacity:.5;font-size:11px;">${formatTime(e.ts)}</span>
          <span style="flex:1;">${escapeHtml(e.label)}</span>
        </div>
        <div style="font-size:12px;opacity:.55;margin-right:24px;">${escapeHtml(truncate(e.detail, 120))}</div>
        <div id="devctr-detail-${e.id}" style="display:none;margin-top:6px;margin-right:24px;background:#1a1a2e;border-radius:8px;padding:8px;font-size:11px;font-family:monospace;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-all;"></div>
        ${breadcrumbMode && i < ordered.length - 1 ? '<div style="text-align:center;opacity:.3;font-size:11px;">↓</div>' : ''}
      </div>
    `).join('');
  }

  window.DevCenterUI = {
    close: closePanel,
    setTab: (id) => { currentTab = id; renderPanelBody(); const t = document.getElementById('devctr-tabs'); if (t) renderPanel(); },
    setSearch: (v) => {
      searchQuery = v;
      const wrap = document.getElementById('devctr-timeline-list-wrap');
      if (wrap && currentTab === 'timeline') wrap.innerHTML = renderEventList(filteredEvents());
      else renderPanelBody();
    },
    setFilter: (id) => { quickFilter = id; renderPanelBody(); },
    toggleBreadcrumb: () => { breadcrumbMode = !breadcrumbMode; renderPanelBody(); },
    toggleDetail: (id) => {
      const el = document.getElementById('devctr-detail-' + id);
      if (!el) return;
      if (el.style.display === 'block') { el.style.display = 'none'; return; }
      const ev = events.find((e) => e.id === id);
      if (!ev) return;
      const lines = [];
      lines.push(`session: ${ev.session}   duration: ${ev.duration != null ? ev.duration + 'ms' : '—'}`);
      if (ev.args) lines.push(`args: ${ev.args}`);
      if (ev.returnValue) lines.push(`return: ${ev.returnValue}`);
      if (ev.status != null) lines.push(`status: ${ev.status}`);
      if (ev.stack) lines.push(`stack: ${ev.stack}`);
      if (ev.stateBefore) lines.push(`\nstate BEFORE:\n${ev.stateBefore}`);
      if (ev.stateAfter) lines.push(`\nstate AFTER:\n${ev.stateAfter}`);
      el.textContent = lines.join('\n');
      el.style.display = 'block';
    },
    replay: () => {
      const list = filteredEvents();
      if (!list.length) return;
      if (replayTimer) { clearInterval(replayTimer); replayTimer = null; return; }
      let idx = 0;
      replayTimer = setInterval(() => {
        if (idx >= list.length) { clearInterval(replayTimer); replayTimer = null; return; }
        const ev = list[idx];
        const row = document.getElementById('devctr-ev-' + ev.id);
        if (row) {
          row.style.background = '#7C6FF033';
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setTimeout(() => { if (row) row.style.background = ''; }, 500);
        }
        idx++;
      }, 450);
    },
    exportPackage: exportDebugPackage,
    shareReport: shareReport,
    copyReport: copyReport,
    testToast: () => { if (typeof App !== 'undefined' && App.stub) App.stub(); logEvent(CATEGORY.INFO, 'tools', 'Test Toast', 'triggered manually'); },
    testRender: () => { try { if (typeof App !== 'undefined') { /* re-open current tab to force a real render path indirectly */ } logEvent(CATEGORY.INFO, 'tools', 'Test Render', 'no dedicated render hook exposed — use Timeline to watch real renders as they happen'); } catch (e) {} },
    disableDevMode: () => {
      setDevMode(false);
      hideFab();
      closePanel();
    },
  };

  /* ---------- Health tab — the "one screenshot tells you what's wrong" view ---------- */
  const READ_ONLY_DB_METHODS = ['get', 'lastMedFor', 'lastTempFor', 'tempsFor', 'feed', 'nightSummary', 'activePrescriptionsFor', 'uid'];
  function row(status, label, value) {
    const dot = status === 'ok' ? '🟢' : status === 'warn' ? '🟡' : status === 'bad' ? '🔴' : '⚪';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #222;font-size:13px;">
      <span>${dot} ${label}</span><span style="direction:ltr;opacity:.85;">${escapeHtml(String(value))}</span></div>`;
  }
  function renderHealthTab() {
    const rows = [];

    // Database
    let dbOk = false, medCount = 0, kidCount = 0;
    try {
      const s = DB.get();
      dbOk = !!(s && Array.isArray(s.children));
      kidCount = s.children.length; medCount = s.medEntries.length;
    } catch (e) {}
    rows.push(row(dbOk ? 'ok' : 'bad', 'Database', dbOk ? `OK · ${kidCount} ילדים · ${medCount} רשומות` : 'שגיאה בקריאה'));

    // last DB write outcome (from our own event log)
    let lastWrite = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.source !== 'db') continue;
      const method = (e.label.match(/DB\.(\w+)\(\)/) || [])[1];
      if (method && READ_ONLY_DB_METHODS.indexOf(method) === -1) { lastWrite = e; break; }
    }
    rows.push(row(!lastWrite ? 'warn' : lastWrite.detail.indexOf('threw') === 0 ? 'bad' : 'ok', 'Last Save',
      !lastWrite ? 'אין עדיין כתיבה בסשן זה' : (lastWrite.detail.indexOf('threw') === 0 ? 'נכשלה! ' + lastWrite.detail : 'הצליחה · ' + lastWrite.label)));

    // Device ID
    let deviceId = null;
    try { deviceId = DB.get().deviceId; } catch (e) {}
    rows.push(row(deviceId ? 'ok' : 'bad', 'Device ID', deviceId ? 'קיים' : 'חסר!'));

    // Notification permission
    const perm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    rows.push(row(perm === 'granted' ? 'ok' : perm === 'denied' ? 'bad' : 'warn', 'Notification Permission', perm));

    // Pending reminder queue
    let pending = 0;
    try { pending = DB.get().medEntries.filter((e) => e.reminderReadyAt && e.reminderReadyAt > Date.now()).length; } catch (e) {}
    rows.push(row('ok', 'Pending Reminder Queue', pending));

    // App version
    const appVersion = (document.getElementById('set-version-num') || {}).textContent || '—';
    rows.push(row(appVersion !== '—' ? 'ok' : 'warn', 'App Version', appVersion));

    // Storage used
    let lsSize = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsSize += k.length + (localStorage.getItem(k) || '').length; } } catch (e) {}
    const mb = lsSize / 1024 / 1024;
    rows.push(row(mb < 3 ? 'ok' : mb < 4.5 ? 'warn' : 'bad', 'Storage Used', mb.toFixed(2) + ' MB / ~5 MB'));

    // last network activity — answers "did a request even go out, and when" without digging through the Network tab
    let lastNet = null;
    for (let i = events.length - 1; i >= 0; i--) { if (events[i].category === CATEGORY.NETWORK) { lastNet = events[i]; break; } }
    if (!lastNet) {
      rows.push(row('warn', 'Last Network Activity', 'אין קריאות רשת בסשן זה'));
    } else {
      const secAgo = Math.round((Date.now() - lastNet.ts) / 1000);
      const ago = secAgo < 60 ? `לפני ${secAgo} שנ׳` : secAgo < 3600 ? `לפני ${Math.floor(secAgo / 60)} דק׳` : `לפני ${Math.floor(secAgo / 3600)} שע׳`;
      const ok = !lastNet.failed;
      rows.push(row(ok ? 'ok' : 'bad', 'Last Network Activity', `${lastNet.label} · ${lastNet.detail} · ${ago}`));
    }
    rows.push(row(navigator.onLine ? 'ok' : 'bad', 'Online', navigator.onLine ? 'כן' : 'לא — אין חיבור רשת'));

    const staticHtml = `<div style="opacity:.5;font-size:11px;margin-bottom:10px;">מסך הדיאגנוסטיקה — צילום מסך אחד מכאן לרוב מספיק כדי לדעת איפה הבעיה.</div>` + rows.join('');

    // async checks, filled in after render
    setTimeout(() => {
      if (window.caches) {
        caches.keys().then((names) => {
          const el = document.getElementById('devctr-health-cache');
          if (el) { const n = names.find((x) => x.indexOf('madhom') === 0); el.textContent = n || 'לא נמצא'; }
        });
      }
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          const el = document.getElementById('devctr-health-sw');
          if (el) el.textContent = regs.length ? `רשום (${regs[0].active ? 'active' : 'pending'})` : 'לא רשום!';
        });
      }
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      const osTimeout = setTimeout(() => {
        const el = document.getElementById('devctr-health-os');
        if (el) el.textContent = 'timeout — SDK לא נטען?';
      }, 4000);
      OneSignalDeferred.push(function (OneSignal) {
        clearTimeout(osTimeout);
        const el = document.getElementById('devctr-health-os');
        if (el) {
          try { el.textContent = OneSignal.User && OneSignal.User.onesignalId ? 'מחובר' : 'לא מחובר עדיין'; }
          catch (e) { el.textContent = 'לא ידוע'; }
        }
      });
    }, 50);

    return staticHtml +
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #222;font-size:13px;">
        <span>🟡 Service Worker</span><span id="devctr-health-sw" style="direction:ltr;opacity:.85;">בודק…</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #222;font-size:13px;">
        <span>🟡 Cache Version</span><span id="devctr-health-cache" style="direction:ltr;opacity:.85;">בודק…</span></div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #222;font-size:13px;">
        <span>🟡 OneSignal</span><span id="devctr-health-os" style="direction:ltr;opacity:.85;">בודק…</span></div>`;
  }

  /* ---------- Database tab (read-only) ---------- */
  function renderDatabaseTab() {
    let json = '(DB not ready)';
    try { json = JSON.stringify(typeof DB !== 'undefined' ? DB.get() : {}, null, 2); } catch (e) {}
    return `
      <div style="margin-bottom:10px;">
        <button onclick="DevCenterUI.exportPackage()" style="padding:8px 14px;border-radius:8px;background:#7C6FF0;color:#fff;border:none;font-size:13px;">📤 ייצוא DB (JSON)</button>
      </div>
      <div style="font-size:11px;font-family:monospace;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-all;background:#1a1a2e;padding:10px;border-radius:8px;">${escapeHtml(json)}</div>
    `;
  }

  /* ---------- Storage tab (read-only) ---------- */
  function renderStorageTab() {
    let lsSize = 0, madhomSize = 0, corruptedKeys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || '';
        lsSize += k.length + v.length;
        if (k === 'madhom_v1') madhomSize = v.length;
        if (k.indexOf('madhom_v1_corrupted_') === 0) corruptedKeys.push(k);
      }
    } catch (e) {}
    const appVersion = (document.getElementById('set-version-num') || {}).textContent || '—';
    let deviceId = '—';
    try { deviceId = DB.get().deviceId; } catch (e) {}
    const rows = [
      ['גרסת אפליקציה', appVersion],
      ['Device ID', deviceId],
      ['גודל madhom_v1', (madhomSize / 1024).toFixed(1) + ' KB'],
      ['סה"כ localStorage', (lsSize / 1024).toFixed(1) + ' KB'],
      ['גיבויי corrupted', corruptedKeys.length ? corruptedKeys.join(', ') : 'אין'],
      ['Online', navigator.onLine ? 'כן' : 'לא'],
      ['Standalone (PWA)', window.matchMedia('(display-mode: standalone)').matches ? 'כן' : 'לא'],
      ['Session', SESSION_ID + ' · started ' + formatTime(SESSION_STARTED)],
    ];
    let html = rows.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #222;font-size:13px;"><span style="opacity:.6;">${k}</span><span style="direction:ltr;">${escapeHtml(String(v))}</span></div>`).join('');
    // async cache names
    if (window.caches) {
      caches.keys().then((names) => {
        const el = document.getElementById('devctr-cache-names');
        if (el) el.textContent = names.join(', ') || '—';
      });
    }
    html += `<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;"><span style="opacity:.6;">Cache names</span><span id="devctr-cache-names" style="direction:ltr;">טוען…</span></div>`;
    return html;
  }

  /* ---------- Tools tab (non-destructive only) ---------- */
  function renderToolsTab() {
    return `
      <div style="opacity:.6;font-size:12px;margin-bottom:10px;">כלים לא-הרסניים בלבד. פעולות כמו Reset DB / Import / Clear Cache יתווספו בשלב נפרד עם הגנות ייעודיות.</div>
      <button onclick="DevCenterUI.testToast()" style="display:block;width:100%;margin-bottom:8px;padding:10px;border-radius:8px;background:#1a1a2e;color:#fff;border:none;font-size:13px;text-align:right;">🔔 Test Toast</button>
      <button onclick="DevCenterUI.disableDevMode()" style="display:block;width:100%;margin-bottom:8px;padding:10px;border-radius:8px;background:#3a1a1a;color:#ff8888;border:none;font-size:13px;text-align:right;">🚫 כבה מצב מפתח</button>
    `;
  }

  /* ---------- Export tab ---------- */
  function buildDebugPackage() {
    let appVersion = (document.getElementById('set-version-num') || {}).textContent || '—';
    let dbSnapshot = null, deviceId = '—';
    try { dbSnapshot = DB.get(); deviceId = dbSnapshot.deviceId; } catch (e) {}
    return {
      generatedAt: new Date().toISOString(),
      appVersion,
      session: { id: SESSION_ID, startedAt: new Date(SESSION_STARTED).toISOString() },
      device: { deviceId, userAgent: navigator.userAgent, online: navigator.onLine, standalone: window.matchMedia('(display-mode: standalone)').matches },
      database: dbSnapshot,
      timeline: events,
      errors: events.filter((e) => e.category === CATEGORY.ERROR),
      network: events.filter((e) => e.category === CATEGORY.NETWORK),
    };
  }
  function renderExportTab() {
    return `
      <div style="opacity:.6;font-size:12px;margin-bottom:14px;">Debug Package: גרסה + Device + DB + Timeline מלא + שגיאות + Network, בקובץ JSON אחד.</div>
      <button onclick="DevCenterUI.shareReport()" style="display:block;width:100%;margin-bottom:8px;padding:10px;border-radius:8px;background:#7C6FF0;color:#fff;border:none;font-size:13px;">📤 Share Debug Package</button>
      <button onclick="DevCenterUI.copyReport()" style="display:block;width:100%;margin-bottom:8px;padding:10px;border-radius:8px;background:#1a1a2e;color:#fff;border:none;font-size:13px;">📋 העתקה (Copy)</button>
      <button onclick="DevCenterUI.exportPackage()" style="display:block;width:100%;margin-bottom:8px;padding:10px;border-radius:8px;background:#1a1a2e;color:#fff;border:none;font-size:13px;">⬇️ הורדה כקובץ</button>
      <div style="opacity:.5;font-size:11px;margin-top:14px;">⚠️ הדוח כולל שמות ילדים, משקלים ותרופות — שתפו רק עם מי שאתם סומכים עליו.</div>
    `;
  }
  function exportDebugPackage() {
    const pkg = buildDebugPackage();
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `medickids-debug-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function shareReport() {
    const pkg = buildDebugPackage();
    const text = JSON.stringify(pkg, null, 2);
    if (navigator.share) {
      try {
        const file = new File([text], `medickids-debug-${Date.now()}.json`, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Medickids Debug Report' });
          return;
        }
        await navigator.share({ text: text.slice(0, 5000), title: 'Medickids Debug Report' });
        return;
      } catch (e) { /* user cancelled or unsupported — fall through to copy */ }
    }
    copyReport();
  }
  function copyReport() {
    const text = JSON.stringify(buildDebugPackage(), null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  /* ---------- utils ---------- */
  function formatTime(ts) {
    const d = new Date(ts);
    return d.toTimeString().slice(0, 8);
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
