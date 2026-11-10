(function () {
  if (window.__ARISE_MUTATION_BUS__) return;
  var n = [], r = [], i = 0, s = 5e3, u;
  var NOISE_SEL = "#arise-scroll-top-btn, #arise-page-widget-bar, .recharts-tooltip-wrapper, .lhm-tooltip";
  function isNoiseTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    return typeof t.closest === "function" && !!t.closest(NOISE_SEL);
  }
  // A subscriber that throws is a widget updater that silently stopped
  // updating: 42 files subscribe here, and `catch {}` meant the failure left no
  // trace at all - not in the console, not in __ariseMountErrors, nothing. The
  // bus must stay fail-open (one broken updater may not stop the rest), but it
  // now records what happened so the failure reporter can surface it.
  var failures = [], MAX_FAILURES = 40;
  function describe(fn) {
    try {
      return String(fn.__ariseSubscriber || fn.name || "").trim() || "anonymous updater";
    } catch (_) { return "anonymous updater"; }
  }
  function recordFailure(fn, error) {
    var name = describe(fn), entry = null;
    for (var k = 0; k < failures.length; k++) {
      if (failures[k].fn === fn) { entry = failures[k]; break; }
    }
    if (!entry) {
      if (failures.length >= MAX_FAILURES) failures.shift();
      entry = { fn: fn, name: name, count: 0, firstAt: new Date().toISOString() };
      failures.push(entry);
    }
    entry.count += 1;
    entry.lastAt = new Date().toISOString();
    entry.message = (error && error.message) || String(error);
    try {
      if (typeof window.__ariseReportWidgetError === "function") {
        window.__ariseReportWidgetError("updater:" + name, entry.message);
      }
    } catch (_) {}
    try { console.error("[mutation-bus] subscriber threw: " + name, error); } catch (_) {}
    return entry;
  }
  function c() {
    if (i && (clearTimeout(i), i = 0), !!r.length) {
      if (window.ArisePerf && typeof window.ArisePerf.noteNotification === "function") {
        try { window.ArisePerf.noteNotification(); } catch {}
      }
      var t = r;
      r = [];
      // Records produced *by* the subscribers are not new information: every
      // subscriber has already been handed this change. Without this, a widget
      // that re-renders on every notification (the Career Readiness card does,
      // 15 times a second while idle) fed the bus its own output forever - the
      // bus re-notified all 40+ subscribers on every frame. Measured idle: 26
      // dispatches per 4 s and 750 DOM mutations; dropping the loop takes it to
      // zero notifications because muting is the documented contract of
      // __ARISE_MUTATION_BUS__.mute(), which widgets already rely on.
      try { u.takeRecords(); } catch {}
      for (var e = n.slice(), o = 0; o < e.length; o++) {
        if (n.indexOf(e[o]) !== -1) {
          try { e[o](t, u); } catch (err) { recordFailure(e[o], err); }
        }
      }
      try { u.takeRecords(); } catch {}
    }
  }
  function a() {
    if (r.length >= s) { c(); return; }
    i || (i = setTimeout(c, window.__ariseWidgetsReady ? 60 : 250));
  }
  window.__ARISE_MUTATION_BUS__ = {
    mute: function (t) {
      try { t(); } finally { try { u.takeRecords(); } catch {} }
    },
    subscribe: function (t) {
      return typeof t != "function" ? function () {} : (n.push(t), function () {
        var e = n.indexOf(t);
        e !== -1 && n.splice(e, 1);
      });
    },
    // Diagnostics: which updaters have thrown, how often, and with what.
    failures: function () {
      return failures.map(function (entry) {
        return { name: entry.name, count: entry.count, message: entry.message, firstAt: entry.firstAt, lastAt: entry.lastAt };
      });
    }
  };
  u = new MutationObserver(function (t) {
    var addedAny = false;
    // Some widgets animate their own DOM with requestAnimationFrame and rewrite
    // text/attributes every frame. Those records cannot introduce new content,
    // so drop them when they come from a subtree that declares itself
    // self-updating (data-arise-bus-idle) - measured: 748 idle mutations and 16
    // redundant re-renders per 4 s on the built dashboard. Real structural
    // changes are never filtered.
    if (window.ArisePerf && typeof window.ArisePerf.filter === "function") {
      try { t = window.ArisePerf.filter(t); } catch (err) { recordFailure(window.ArisePerf.filter, err); }
    }
    for (var e = 0; e < t.length; e++) {
      var rec = t[e];
      if ((!rec.addedNodes || !rec.addedNodes.length) && (!rec.removedNodes || !rec.removedNodes.length)) continue;
      if (isNoiseTarget(rec.target)) continue;
      r.push(rec);
      addedAny = true;
    }
    if (addedAny) a();
  });
  function f() {
    u.observe(document.body, { childList: !0, subtree: !0 });
  }
  document.body ? f() : document.addEventListener("DOMContentLoaded", f);
})();
