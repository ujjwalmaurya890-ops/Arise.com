/* ==========================================================================
   Reliability watch (src/reliability-watch.js)
   --------------------------------------------------------------------------
   src/widget-failure-reporter.js does one honest thing well: when a chunk 404s
   or a widget throws, it shows one quiet status line with a Reload button. What
   it cannot do is the thing a flaky mobile connection actually needs:

     - retry the failed script. The loader in index.html injects each chunk with
       a `data-module` placeholder; once it fails, that widget stays missing for
       the rest of the session unless the whole page is reloaded.
     - remember the failure across a reload. The message is built from
       in-memory arrays, so after the reload it recommends, the user either sees
       a fixed app (fine) or the same blank widget with no explanation (not
       fine).
     - distinguish a transient network failure from a deterministic one. The
       loader records "<src> failed" for a 404, a timeout and an offline blip
       alike, and the reporter therefore offers the same advice for all three.

   This module adds a small, bounded retry layer around those failures and one
   storage key that remembers the *attempts*, not the data:

     arise-widget-retry-v1 = { "<src>": { attempts, firstAt, lastAt, reason } }

   Rules it follows, deliberately:
     - a widget is retried at most MAX_ATTEMPTS times with growing delays, and
       only when the browser is online;
     - a deterministic failure (a 404 or a syntax error) is retried once, not
       forever: the second failure marks the src as "won't load" and says so;
     - retrying re-creates the module placeholder the loader uses and asks the
       loader to fetch it again, through the documented
       window.__ariseLoadModule() hook if present;
     - nothing is retried while the tab is hidden, and everything stops as soon
       as the widget mounts;
     - the report is readable through the same status line, so there is still
       only one place that tells the user something is wrong.
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseReliability) return;

  var KEY = "arise-widget-retry-v1";
  var MAX_ATTEMPTS = 3;
  var DELAYS = [2000, 8000, 20000];
  var clock = { online: true };
  var observed = {};
  var inFlight = {};
  var timers = {};

  function nowIso() { return new Date().toISOString(); }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var clean = {};
      Object.keys(parsed).forEach(function (src) {
        var entry = parsed[src];
        if (!entry || typeof entry !== "object") return;
        clean[src] = {
          attempts: Math.max(0, Math.min(MAX_ATTEMPTS, Number(entry.attempts) || 0)),
          firstAt: typeof entry.firstAt === "string" ? entry.firstAt : null,
          lastAt: typeof entry.lastAt === "string" ? entry.lastAt : null,
          reason: typeof entry.reason === "string" ? entry.reason.slice(0, 160) : ""
        };
      });
      return clean;
    } catch {
      return {};
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      // A full or blocked storage must never stop the retry itself.
      return false;
    }
  }

  function online() {
    return !(window.navigator && window.navigator.onLine === false);
  }

  // The loader's own language: "<src> failed" / "<src> timed out" / "404".
  function classify(reason) {
    var text = String(reason || "").toLowerCase();
    if (/404|not found/.test(text)) return "missing";
    // The loader's own reason strings are terse: "failed" is what an `error`
    // event produces, i.e. the request never completed.
    if (/failed|error/.test(text)) return "network";
    if (/syntax|unexpected token|is not defined/.test(text)) return "broken";
    if (/timed? ?out|timeout/.test(text)) return "slow";
    if (/offline|network|failed to fetch|load failed/.test(text)) return "network";
    return "unknown";
  }

  function shouldRetry(entry, reason) {
    if (!entry) return true;
    if (entry.attempts >= MAX_ATTEMPTS) return false;
    var kind = classify(reason || entry.reason);
    // A 404 or a broken file will fail again the same way; one retry covers a
    // deploy that was mid-rollout when the page loaded, not a missing file.
    if ((kind === "missing" || kind === "broken") && entry.attempts >= 1) return false;
    return true;
  }

  function placeholderFor(src) {
    if (!src || typeof document === "undefined") return null;
    var nodes = document.querySelectorAll("script[data-module]");
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute("data-module") === src) return nodes[i];
    }
    return null;
  }

  function finish(src) {
    var state = read();
    if (state[src]) {
      delete state[src];
      write(state);
    }
  }

  /**
   * Ask the loader to fetch this module again. index.html owns the chunk map and
   * the injection; this module only supplies the intent. If the hook is not
   * available (older shell served from cache) the retry is reported as
   * unavailable instead of pretending it happened.
   */
  function reloadModule(src) {
    if (typeof window.__ariseLoadModule === "function") {
      try {
        var result = window.__ariseLoadModule(src);
        // The loader returns a promise (true only when the module really ran).
        if (result && typeof result.then === "function") {
          return { ok: true, how: "loader", result: Promise.resolve(result).then(function (value) { return value === true; }, function () { return false; }) };
        }
        return { ok: result !== false, how: "loader", result: result !== false };
      } catch (error) {
        return { ok: false, how: "loader", error: (error && error.message) || "loader threw" };
      }
    }
    return { ok: false, how: "unavailable" };
  }

  function schedule(src, reason) {
    if (!src || timers[src] || inFlight[src]) return false;
    var state = read();
    var entry = state[src];
    var attempt = (entry ? entry.attempts : 0) + 1;
    var kind = classify(reason);
    var plan = {
      src: src,
      attempt: attempt,
      kind: kind,
      delay: DELAYS[Math.min(attempt - 1, DELAYS.length - 1)],
      retried: false
    };
    state[src] = {
      attempts: attempt,
      firstAt: (entry && entry.firstAt) || nowIso(),
      lastAt: nowIso(),
      reason: String(reason || "").slice(0, 160)
    };
    write(state);

    if (!shouldRetry({ attempts: attempt - 1, reason: reason }, reason) || !online()) {
      plan.blocked = !online() ? "offline" : "deterministic";
      return plan;
    }

    inFlight[src] = true;
    plan.retried = true;
    timers[src] = setTimeout(function () {
      delete timers[src];
      inFlight[src] = false;
      if (!online()) { plan.blocked = "offline"; return; }
      var outcome = reloadModule(src);
      plan.outcome = outcome;
      if (outcome.how === "unavailable") {
        plan.blocked = "no loader hook";
        return;
      }
      // The hook answers with a promise; a retry that fails must be allowed to
      // schedule the next (bounded) attempt, otherwise one retry is all a flaky
      // connection ever gets.
      Promise.resolve(outcome && outcome.result).then(function (loaded) {
        plan.loaded = loaded === true;
        if (loaded === true) {
          var placeholder = placeholderFor(src);
          if (placeholder) placeholder.removeAttribute("data-failed");
          finish(src);
          return;
        }
        var next = read()[src];
        if (next && next.attempts < MAX_ATTEMPTS) schedule(src, next.reason || "failed");
      }, function () {
        var next = read()[src];
        if (next && next.attempts < MAX_ATTEMPTS) schedule(src, next.reason || "failed");
      });
    }, plan.delay);
    return plan;
  }

  /* ------------------------------------------------------------- status UI -- */

  function summaries() {
    var state = read();
    return Object.keys(state).sort().map(function (src) {
      var entry = state[src];
      return {
        src: src,
        name: String(src).split("/").pop().replace(/\.js$/, "").replace(/-widget$/, "").replace(/-/g, " "),
        attempts: entry.attempts,
        kind: classify(entry.reason),
        retryable: shouldRetry(entry, entry.reason),
        lastAt: entry.lastAt
      };
    });
  }

  function describe() {
    var list = summaries();
    if (!list.length) return "";
    // "Stuck" means deterministic (a 404 or a broken file), not merely out of
    // attempts: those two need different advice.
    var stuck = list.filter(function (item) {
      return (item.kind === "missing" || item.kind === "broken") && item.attempts >= 2;
    });
    if (stuck.length) {
      return stuck.length + " module" + (stuck.length === 1 ? "" : "s") + " will not load on this device (" +
        stuck.map(function (item) { return item.name; }).join(", ") +
        "). Reloading will not help; the file is missing or damaged.";
    }
    var retrying = list.filter(function (item) { return item.attempts < MAX_ATTEMPTS; });
    if (retrying.length) {
      return retrying.length + " module" + (retrying.length === 1 ? " is" : "s are") +
        " being retried automatically (" + retrying.map(function (item) { return item.name; }).join(", ") + ").";
    }
    return list.length + " module" + (list.length === 1 ? "" : "s") + " could not be loaded after " + MAX_ATTEMPTS +
      " attempts. Check your connection, then reload.";
  }

  /* ------------------------------------------------------------- lifecycle -- */

  function watch() {
    var reporter = window.__ariseWidgetFailureReport;
    if (!reporter || typeof reporter.failures !== "function") return false;
    var seen = {};
    var timer = null;
    var tick = function () {
      var failures = reporter.failures();
      for (var i = 0; i < failures.length; i += 1) {
        var entry = failures[i] || {};
        var src = String(entry.src || "");
        if (!src || seen[src]) continue;
        seen[src] = true;
        if (/^widget:|^updater:/.test(src)) {
          observed[src] = entry.reason || "failed";
          continue;
        }
        schedule(src, entry.reason);
      }
      Object.keys(seen).forEach(function (src) {
        var selector;
        if (/^widget:|^updater:/.test(src)) return;
        selector = 'script[data-loaded-module="' + src + '"], script[data-module="' + src + '"][data-loaded="true"]';
        var loaded = false;
        try { loaded = !!document.querySelector(selector); } catch { loaded = false; }
        if (loaded) finish(src);
      });
      if (window.__ariseWidgetsReady && !failures.length && !Object.keys(read()).length && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    tick();
    timer = setInterval(tick, 2500);
    window.addEventListener("arise:widgets-ready", function () { setTimeout(tick, 500); }, { once: true });
    window.addEventListener("arise:widget-failure", function () {
      tick();
      if (!timer) timer = setInterval(tick, 2500);
    });
    return true;
  }

  function boot() {
    clock.online = online();
    window.addEventListener("online", function () {
      clock.online = true;
      // Come back online and the next tick retries whatever is still missing.
      var state = read();
      Object.keys(state).forEach(function (src) {
        if (state[src].attempts < MAX_ATTEMPTS) {
          try { delete timers[src]; } catch {}
          schedule(src, "network restored");
        }
      });
    });
    window.addEventListener("offline", function () { clock.online = false; });
    // A visible tab is when a retry is worth its request.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        var state = read();
        Object.keys(state).forEach(function (src) {
          if (state[src].attempts < MAX_ATTEMPTS && !timers[src]) schedule(src, state[src].reason);
        });
      }
    });
    window.AriseReliability.lastBoot = nowIso();
    watch();
  }

  window.AriseReliability = {
    storageKey: KEY,
    maxAttempts: MAX_ATTEMPTS,
    classify: classify,
    shouldRetry: shouldRetry,
    schedule: schedule,
    reloadModule: reloadModule,
    summaries: summaries,
    observed: function () { return Object.assign({}, observed); },
    describe: describe,
    attempts: read,
    reset: function () { write({}); Object.keys(timers).forEach(function (src) { clearTimeout(timers[src]); delete timers[src]; }); return true; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
