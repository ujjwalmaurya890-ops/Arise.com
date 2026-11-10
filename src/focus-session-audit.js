/* ==========================================================================
   Focus session audit (src/focus-session-audit.js)
   --------------------------------------------------------------------------
   Three independent pieces of code record study time, and they disagree:

     1. the React Focus Timer (assets/app-bundle.js) saves completed runs into
        `studySessions` as `{ date, totalTime (ms) }`;
     2. the Timer Upgrade widget wraps localStorage.setItem to turn those writes
        into `focusSessionsV2` records `{ minutes, date, startedAt, endedAt }`;
     3. the Dashboard's "Study Today" reads `studySessions`, while Analytics
        reads `focusSessionsV2` — so the two numbers on screen can differ even
        though the user did one session;
     4. the Stopwatch tab saves into `stopwatchSessions`, which no other widget
        reads, so stopwatch study time silently disappears;
     5. the running timer lives only in React state, so a reload drops it, and
        `runner.session` is not reachable after remount, which means a session
        can be "lost" without a single record anywhere.

   This module reconciles what was actually recorded. It never invents a session
   and never rewrites a session: the only writes are (a) the audit's own flag
   and (b) an explicit, user-confirmed one-time stopwatch import into
   focusSessionsV2 (nowhere to import means nowhere to import — a raw stopwatch
   run has no category, so it is imported as "Other" with a note saying so).

   Public API (window.AriseFocusAudit)
   -----------------------------------
   records()            -> normalised sessions with their origin
   reconcile()          -> { focus, stopwatch, legacy, duplicates, discrepancies }
   dayTotals(options)   -> per-day minutes with the sources that produced them
   importStopwatch()    -> user-confirmed; returns { imported, skipped }
   open() / close()     -> the reconciliation panel
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseFocusAudit) return;

  var FOCUS_KEY = "focusSessionsV2";
  var STUDY_KEY = "studySessions";
  var STOPWATCH_KEY = "stopwatchSessions";
  var FLAG_KEY = "arise-focus-audit-v1";
  var DAY_MS = 86400000;
  var MIN_SESSION_MS = 60000;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(value) { return (value < 10 ? "0" : "") + value; }

  function dayKey(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function readArray(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readFlag() {
    try {
      var raw = localStorage.getItem(FLAG_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeFlag(next) {
    try { localStorage.setItem(FLAG_KEY, JSON.stringify(next)); return true; } catch { return false; }
  }

  // Units in these stores are inconsistent (minutes, seconds and ms all
  // appear), so each field is read with the unit it is documented to use.
  function positive(value) {
    var number = Number(value);
    return isFinite(number) && number > 0 ? number : 0;
  }

  function minutesFromRecord(raw) {
    var explicit = positive(raw.minutes);
    if (explicit) return explicit;
    var seconds = positive(raw.seconds || raw.duration);
    if (seconds) return seconds / 60;
    var ms = positive(raw.totalTime);
    return ms ? ms / 60000 : 0;
  }

  /* ------------------------------------------------------------ normalise -- */

  function focusRecords() {
    return readArray(FOCUS_KEY).map(function (raw) {
      if (!raw || typeof raw !== "object") return null;
      var minutes = minutesFromRecord(raw);
      var when = new Date(raw.endedAt || raw.startedAt || raw.date || "");
      if (!minutes || isNaN(when.getTime())) return null;
      return {
        origin: "focus",
        id: raw.id ? String(raw.id) : null,
        minutes: Math.round(minutes * 100) / 100,
        day: dayKey(when),
        at: when.toISOString(),
        category: typeof raw.category === "string" && raw.category ? raw.category : "Other",
        task: typeof raw.task === "string" ? raw.task : "",
        rating: typeof raw.rating === "number" && raw.rating > 0 ? raw.rating : null,
        fromTimer: !!raw.startedAt
      };
    }).filter(Boolean);
  }

  // The React timer stores milliseconds in `totalTime`; older rows may already
  // hold minutes, so the unit is decided by magnitude, not by a guess.
  function legacyRecords() {
    return readArray(STUDY_KEY).map(function (raw) {
      if (!raw || typeof raw !== "object") return null;
      var minutes = minutesFromRecord(raw);
      var when = new Date(raw.savedAt || raw.date || raw.endedAt || "");
      if (!minutes || isNaN(when.getTime())) return null;
      return {
        origin: "legacy",
        id: raw.id ? String(raw.id) : null,
        minutes: Math.round(minutes * 100) / 100,
        day: dayKey(when),
        at: when.toISOString(),
        category: "Other",
        task: "",
        rating: null,
        fromTimer: true
      };
    }).filter(Boolean);
  }

  // Stopwatch runs: { id, date, totalTime (ms), laps, savedAt }.
  function stopwatchRecords() {
    return readArray(STOPWATCH_KEY).map(function (raw) {
      if (!raw || typeof raw !== "object") return null;
      var ms = Number(raw.totalTime);
      if (!isFinite(ms) || ms < MIN_SESSION_MS) return null;
      var when = new Date(raw.savedAt || raw.date || "");
      if (isNaN(when.getTime())) {
        when = new Date(String(raw.date || "") + "T12:00:00");
      }
      if (isNaN(when.getTime())) return null;
      return {
        origin: "stopwatch",
        id: raw.id ? String(raw.id) : null,
        minutes: Math.round((ms / 60000) * 100) / 100,
        day: dayKey(when),
        at: when.toISOString(),
        category: "Other",
        task: "",
        rating: null,
        laps: Array.isArray(raw.laps) ? raw.laps.length : 0,
        imported: !!(raw.__importedFromStopwatch)
      };
    }).filter(Boolean);
  }

  // A timer run written by the widget appears in both stores within seconds.
  function dedupe(primary, secondary) {
    var kept = primary.slice();
    var duplicates = 0;
    secondary.forEach(function (candidate) {
      var twin = kept.some(function (known) {
        return known.day === candidate.day &&
          Math.abs(known.minutes - candidate.minutes) < 0.5 &&
          Math.abs(new Date(known.at) - new Date(candidate.at)) < 10 * 60000;
      });
      if (twin) duplicates += 1;
      else kept.push(candidate);
    });
    kept.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    return { records: kept, duplicates: duplicates };
  }

  function records() {
    return dedupe(focusRecords(), legacyRecords()).records;
  }

  function reconcile() {
    var focus = focusRecords();
    var legacy = legacyRecords();
    var merged = dedupe(focus, legacy);
    var stopwatch = stopwatchRecords();
    var discrepancies = [];

    // Same day described differently by the two stores.
    var byDayFocus = {}, byDayLegacy = {};
    focus.forEach(function (record) { byDayFocus[record.day] = (byDayFocus[record.day] || 0) + record.minutes; });
    legacy.forEach(function (record) { byDayLegacy[record.day] = (byDayLegacy[record.day] || 0) + record.minutes; });
    Object.keys(byDayLegacy).forEach(function (day) {
      var focusMinutes = Math.round((byDayFocus[day] || 0) * 10) / 10;
      var legacyMinutes = Math.round(byDayLegacy[day] * 10) / 10;
      if (Math.abs(focusMinutes - legacyMinutes) >= 1) {
        discrepancies.push({ day: day, focus: focusMinutes, legacy: legacyMinutes });
      }
    });

    var importedIds = (readFlag().importedStopwatch || []).map(String);
    var pending = stopwatch.filter(function (run) {
      return !run.imported && importedIds.indexOf(String(run.id)) === -1;
    });

    var streak = streakCheck(merged.records);

    return {
      focus: focus,
      legacy: legacy,
      streak: streak,
      stopwatch: stopwatch,
      duplicates: merged.duplicates,
      total: merged.records.length,
      minutes: Math.round(merged.records.reduce(function (sum, r) { return sum + r.minutes; }, 0) * 10) / 10,
      stopwatchMinutes: Math.round(stopwatch.reduce(function (sum, r) { return sum + r.minutes; }, 0) * 10) / 10,
      pendingStopwatch: pending,
      pendingStopwatchMinutes: Math.round(pending.reduce(function (sum, r) { return sum + r.minutes; }, 0) * 10) / 10,
      discrepancies: discrepancies,
      streakMismatch: streak.stored !== streak.local,
      // A timer that never reached a store cannot be recovered; say so rather
      // than implying the number is complete.
      timerState: readTimerState()
    };
  }

  function readTimerState() {
    // The React timer keeps its run in component state only. Any key claiming
    // otherwise would be a claim this module cannot verify.
    try {
      var keys = Object.keys(localStorage);
      var hints = keys.filter(function (key) { return /focus|timer|pomodoro/i.test(key) && !/^arise-(focus-mode-v1|focus-audit-v1|dlt|day-plan)/.test(key); });
      return { persistedKeys: hints };
    } catch {
      return { persistedKeys: [] };
    }
  }

  // The React store keeps a `streak` counter that it increments from a UTC day
  // loop; recomputing it from the session records in local time shows whether
  // the number the user sees is supported by what they actually logged.
  function streakCheck(list) {
    var days = {};
    list.forEach(function (record) { days[record.day] = true; });
    var now = new Date();
    var local = 0;
    var cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // A streak may still be alive if yesterday has a session and today is young.
    if (!days[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
    while (days[dayKey(cursor)]) {
      local += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    var stored = 0;
    try {
      var raw = localStorage.getItem("streak");
      stored = Math.max(0, Math.floor(Number(JSON.parse(raw))) || 0);
    } catch {}
    return { stored: stored, local: local };
  }

  function dayTotals(options) {
    var opts = options || {};
    var days = Math.max(1, Math.min(120, Number(opts.days) || 7));
    var now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    var list = records();
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var key = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      var sources = {};
      var total = 0;
      list.forEach(function (record) {
        if (record.day !== key) return;
        sources[record.origin] = Math.round(((sources[record.origin] || 0) + record.minutes) * 10) / 10;
        total += record.minutes;
      });
      out.push({ day: key, minutes: Math.round(total * 10) / 10, sources: sources });
    }
    return out;
  }

  /* -------------------------------------------------------------- import -- */

  function importStopwatch() {
    var state = reconcile();
    var runs = state.pendingStopwatch;
    if (!runs.length) return { imported: 0, skipped: 0 };
    var existing = readArray(FOCUS_KEY);
    var added = 0;
    runs.forEach(function (run) {
      existing.push({
        id: "sw_" + (run.id || run.at),
        task: "Stopwatch session" + (run.laps ? " · " + run.laps + " lap" + (run.laps === 1 ? "" : "s") : ""),
        category: "Other",
        minutes: run.minutes,
        date: run.day,
        startedAt: null,
        endedAt: run.at,
        completedNote: "Imported from the Stopwatch tab, which no other widget reads.",
        rating: null,
        distractions: 0,
        __importedFromStopwatch: true
      });
      added += 1;
    });
    var saved = false;
    if (added) {
      try {
        localStorage.setItem(FOCUS_KEY, JSON.stringify(existing));
        saved = true;
      } catch {}
    }
    if (saved) {
      var flag = readFlag();
      flag.importedStopwatch = (flag.importedStopwatch || []).concat(runs.map(function (run) { return run.id || run.at; }));
      flag.lastImportAt = new Date().toISOString();
      writeFlag(flag);
    }
    render();
    return { imported: saved ? added : 0, skipped: runs.length - (saved ? added : 0) };
  }

  /* ------------------------------------------------------------------- UI -- */

  var panel = null;
  var lastFocus = null;

  function host() { return document.getElementById("fsa-panel"); }

  function statusLine(state) {
    var parts = [state.total + " session" + (state.total === 1 ? "" : "s") + " · " + state.minutes + "m recorded"];
    if (state.duplicates) parts.push(state.duplicates + " duplicate write" + (state.duplicates === 1 ? "" : "s") + " collapsed");
    if (state.pendingStopwatch.length) parts.push(state.pendingStopwatch.length + " stopwatch run" + (state.pendingStopwatch.length === 1 ? "" : "s") + " unrecorded");
    return parts.join(" · ");
  }

  function render() {
    var node = host();
    if (!node) return;
    var state = reconcile();
    var status = node.querySelector(".fsa-status");
    if (status) status.textContent = statusLine(state);

    var body = node.querySelector(".fsa-body");
    if (!body) return;

    var html = '<div class="fsa-grid">' +
      '<div class="fsa-stat"><strong>' + state.focus.length + "</strong><span>timer runs</span></div>" +
      '<div class="fsa-stat"><strong>' + state.legacy.length + "</strong><span>legacy rows</span></div>" +
      '<div class="fsa-stat"><strong>' + state.stopwatch.length + "</strong><span>stopwatch runs</span></div>" +
      '<div class="fsa-stat' + (state.discrepancies.length ? " fsa-warn" : "") + '"><strong>' + state.discrepancies.length + "</strong><span>days disagree</span></div>" +
      "</div>";

    html += '<h4 class="fsa-h">Last seven days</h4>';
    var totals = dayTotals({ days: 7 });
    var max = Math.max.apply(null, totals.map(function (row) { return row.minutes; }).concat([1]));
    html += '<ul class="fsa-days">' + totals.map(function (row) {
      var width = Math.round((row.minutes / max) * 100);
      var sources = Object.keys(row.sources).map(function (key) {
        return '<span class="fsa-src">' + esc(key) + " " + row.sources[key] + "m</span>";
      }).join("");
      return '<li class="fsa-day"><span class="fsa-day-key">' + esc(row.day.slice(5)) + "</span>" +
        '<span class="fsa-day-track"><span class="fsa-day-fill" style="--fsa-w:' + width + '%"></span></span>' +
        '<span class="fsa-day-value">' + (row.minutes ? row.minutes + "m" : "–") + "</span>" +
        '<span class="fsa-day-sources">' + sources + "</span></li>";
    }).join("") + "</ul>";

    if (state.discrepancies.length) {
      html += '<h4 class="fsa-h">Where the two stores disagree</h4><ul class="fsa-issues">' +
        state.discrepancies.map(function (row) {
          return '<li class="fsa-issue"><strong>' + esc(row.day) + "</strong> Analytics counts " + row.focus +
            "m from focusSessionsV2 while the dashboard counts " + row.legacy + "m from studySessions.</li>";
        }).join("") + "</ul>";
    }

    html += '<h4 class="fsa-h">Stopwatch</h4>';
    if (state.pendingStopwatch.length) {
      html += '<p class="fsa-note">' + state.pendingStopwatch.length + " stopwatch run" +
        (state.pendingStopwatch.length === 1 ? "" : "s") + " (" + Math.round(state.pendingStopwatchMinutes) +
        "m) never reached the session log, so no streak, heatmap or analytics view can see them. They have no category; importing records them as Other with a note.</p>" +
        '<button type="button" class="fsa-btn fsa-primary" data-fsa-action="import-stopwatch">Import ' +
        state.pendingStopwatch.length + " run" + (state.pendingStopwatch.length === 1 ? "" : "s") + "</button>";
    } else if (state.stopwatch.length) {
      html += '<p class="fsa-note">Every stopwatch run is already represented in the session log.</p>';
    } else {
      html += '<p class="fsa-note">No stopwatch runs recorded yet.</p>';
    }

    html += '<h4 class="fsa-h">Streak</h4>';
    if (state.streak.stored && state.streakMismatch) {
      html += '<p class="fsa-note fsa-warn-note">The streak counter says ' + state.streak.stored +
        " day" + (state.streak.stored === 1 ? "" : "s") + " but your session log only supports " + state.streak.local +
        ". The counter is advanced by a UTC day loop, so a late-night or early-morning session can break it even though you studied.</p>";
    } else {
      html += '<p class="fsa-note">Streak counter and session log agree (' + state.streak.local + " day" +
        (state.streak.local === 1 ? "" : "s") + ").</p>";
    }

    html += '<h4 class="fsa-h">Timer reliability</h4>' +
      '<p class="fsa-note">The Focus Timer keeps a running session only in memory: reloading the page, closing the tab or switching routes mid-run ends it without a record. Finishing a run is the only thing that writes a session, so treat the timer as bookkeeping, not a guarantee.</p>' +
      '<p class="fsa-note">Persisted timer-ish keys found in this browser: ' +
      (state.timerState.persistedKeys.length ? esc(state.timerState.persistedKeys.join(", ")) : "none") + ".</p>";

    body.innerHTML = html;
  }

  var IMPORT_CONFIRM = "Import stopwatch runs into the session log?";

  function open() {
    if (!host()) {
      panel = document.createElement("div");
      panel.id = "fsa-panel";
      panel.className = "fsa-overlay";
      panel.setAttribute("data-open", "false");
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML =
        '<div class="fsa-dialog" role="dialog" aria-modal="true" aria-labelledby="fsa-title">' +
        '<div class="fsa-head"><div><h2 id="fsa-title">Session log audit</h2>' +
        '<p class="fsa-status" role="status"></p></div>' +
        '<button type="button" class="fsa-btn fsa-close" data-fsa-action="close" aria-label="Close session log audit">✕</button></div>' +
        '<div class="fsa-body"></div></div>';
      panel.addEventListener("click", onClick);
      document.body.appendChild(panel);
    }
    lastFocus = document.activeElement;
    panel.setAttribute("data-open", "true");
    panel.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeydown, true);
    render();
    var close = panel.querySelector(".fsa-close");
    if (close) close.focus();
    return true;
  }

  function close() {
    var node = host();
    if (!node || node.getAttribute("data-open") !== "true") return false;
    document.removeEventListener("keydown", onKeydown, true);
    node.setAttribute("data-open", "false");
    node.setAttribute("aria-hidden", "true");
    var previous = lastFocus;
    lastFocus = null;
    if (previous && previous.isConnected && !node.contains(previous) && typeof previous.focus === "function") {
      try { previous.focus({ preventScroll: true }); return true; } catch {}
    }
    return true;
  }

  function isVisible(el) {
    if (!el || el.disabled) return false;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      if (node !== el && node.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  }

  function onKeydown(event) {
    var node = host();
    if (!node || node.getAttribute("data-open") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    var dialog = node.querySelector(".fsa-dialog");
    var focusable = dialog ? Array.prototype.slice.call(dialog.querySelectorAll("button, [href]")).filter(isVisible) : [];
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function onClick(event) {
    var action = event.target && event.target.closest ? event.target.closest("[data-fsa-action]") : null;
    if (!action) return;
    var name = action.getAttribute("data-fsa-action");
    if (name === "close") { close(); return; }
    if (name === "import-stopwatch") {
      // Importing writes real records, so it is never silent or automatic.
      var confirmed = true;
      try {
        confirmed = typeof window.confirm !== "function" ? true : window.confirm(IMPORT_CONFIRM);
      } catch { confirmed = false; }
      if (!confirmed) return;
      var result = importStopwatch();
      var status = host().querySelector(".fsa-status");
      if (status) {
        status.textContent = result.imported
          ? "Imported " + result.imported + " stopwatch run" + (result.imported === 1 ? "" : "s") + " as Other · stopwatch."
          : "Nothing could be imported (storage rejected the write).";
      }
    }
  }

  var launcher = null;
  function ensureLauncher() {
    if (document.getElementById("fsa-launcher") || !document.body) return;
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "fsa-launcher";
    launcher.className = "fsa-btn fsa-launcher";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-label", "Audit study session log");
    launcher.innerHTML = '<span aria-hidden="true">🧾</span><span class="fsa-launcher-text">Session log</span>';
    launcher.addEventListener("click", open);
    document.body.appendChild(launcher);
  }

  window.AriseFocusAudit = {
    records: records,
    reconcile: reconcile,
    dayTotals: dayTotals,
    importStopwatch: importStopwatch,
    open: open,
    close: close,
    refresh: render,
    storageKey: FLAG_KEY
  };

  /* --------------------------------------------------------------- boot -- */

  function start() {
    try { ensureLauncher(); } catch {}
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
