/*
 * Widget failure reporter (src/widget-failure-reporter.js)
 * ---------------------------------------------------------------------------
 * Two independent pieces of this app detect a broken widget and then have
 * nowhere to put the result:
 *
 *   1. The widget loader in index.html records every script that 404s or times
 *      out in `window.__ariseWidgetLoadFailures`. Nothing in src/ ever read it,
 *      so a chunk that failed to deploy meant the user sat in front of an empty
 *      tab with no way to know a reload would fix it.
 *   2. mount-safety.js pushes render failures onto `window.__ariseMountErrors`
 *      and draws a per-widget error state. The list was written for a human to
 *      inspect in devtools - on a phone there is no devtools.
 *
 * The loader also calls `window.__ariseReportWidgetError(src)` on failure,
 * documented in index.html as "if defined elsewhere". It was never defined
 * anywhere in the repository, so that call was dead.
 *
 * This file defines it, and adds a single quiet, dismissible status line that
 * appears only when something is actually wrong. It deliberately does not pop
 * a modal or a toast per failure: with ~100 independently loaded chunks one bad
 * deploy would otherwise produce a wall of interruptions.
 */
(function () {
  "use strict";
  if (window.__ARISE_WIDGET_FAILURE_REPORTER__) return;
  window.__ARISE_WIDGET_FAILURE_REPORTER__ = true;

  var BANNER_ID = "arise-widget-failure-banner";
  var dismissed = false;
  var failures = []; // { src, reason, at }

  function humanName(src) {
    return String(src || "")
      .split("/")
      .pop()
      .replace(/\.js$/, "")
      .replace(/-widget$/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || "A module";
  }

  function remember(src, reason) {
    var entry = { src: String(src || ""), reason: String(reason || "failed to load"), at: new Date().toISOString() };
    for (var i = 0; i < failures.length; i++) {
      if (failures[i].src === entry.src) { failures[i] = entry; return entry; }
    }
    failures.push(entry);
    return entry;
  }

  function ensureStyle() {
    if (document.getElementById(BANNER_ID + "-style")) return;
    var style = document.createElement("style");
    style.id = BANNER_ID + "-style";
    style.textContent = [
      "#" + BANNER_ID + "{position:fixed;inset-inline:12px;bottom:12px;z-index:2147483000;",
      "display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;",
      "background:var(--surface-elevated, #16181d);color:var(--text-primary, #f5f6f8);",
      "border:1px solid var(--border-strong, rgba(255,255,255,.18));",
      "box-shadow:0 12px 32px rgba(0,0,0,.35);font-size:13px;line-height:1.45;max-width:560px;margin-inline:auto}",
      "#" + BANNER_ID + " p{margin:0}",
      "#" + BANNER_ID + " .awf-actions{display:flex;gap:8px;margin-left:auto;flex:0 0 auto}",
      "#" + BANNER_ID + " button{font:inherit;cursor:pointer;border-radius:8px;padding:4px 10px;",
      "border:1px solid var(--border-strong, rgba(255,255,255,.24));",
      "background:transparent;color:inherit}",
      "#" + BANNER_ID + " button[data-awf-retry]{background:var(--accent, #6ea8fe);color:#0b0d12;border-color:transparent}",
      "@media (prefers-reduced-motion:no-preference){#" + BANNER_ID + "{animation:awf-in 160ms ease-out}}",
      "@keyframes awf-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function render() {
    if (dismissed || !failures.length || !document.body) return;
    ensureStyle();
    var banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement("div");
      banner.id = BANNER_ID;
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      banner.setAttribute("data-awf-banner", "1");
      banner.innerHTML =
        '<p data-awf-message></p>' +
        '<span class="awf-actions">' +
        '<button type="button" data-awf-retry="1">Reload</button>' +
        '<button type="button" data-awf-dismiss="1" aria-label="Dismiss this notice">Dismiss</button>' +
        "</span>";
      banner.querySelector("[data-awf-retry]").addEventListener("click", function () {
        window.location.reload();
      });
      banner.querySelector("[data-awf-dismiss]").addEventListener("click", function () {
        dismissed = true;
        banner.remove();
      });
      document.body.appendChild(banner);
    }
    var names = failures.slice(0, 3).map(function (entry) { return humanName(entry.src); });
    var message = failures.length === 1
      ? names[0] + " could not be loaded."
      : failures.length + " modules could not be loaded (" + names.join(", ") + (failures.length > 3 ? ", …" : "") + ").";
    banner.querySelector("[data-awf-message]").textContent =
      message + " Your saved progress is safe. Reloading usually fixes this.";
  }

  /* ---------------------------------------------------------------- public */

  /**
   * Documented extension point in index.html; it is what the widget loader
   * calls when a chunk 404s or times out. Previous behaviour: nothing.
   */
  window.__ariseReportWidgetError = function (src, reason) {
    try {
      remember(src, reason);
      render();
    } catch (_) {
      /* reporting a failure must never itself fail the boot */
    }
  };

  /** Exposed for tests and for the loader to seed failures recorded earlier. */
  window.__ariseWidgetFailureReport = {
    report: window.__ariseReportWidgetError,
    // Widgets that already failed before this file ran.
    adopt: function (list) {
      (Array.isArray(list) ? list : []).forEach(function (src) { remember(src, "failed to load"); });
      render();
    },
    failures: function () { return failures.slice(); },
    clear: function () { failures = []; var el = document.getElementById(BANNER_ID); if (el) el.remove(); }
  };

  function boot() {
    // The loader starts injecting chunks before this file is evaluated, so
    // adopt anything it has already recorded rather than waiting for new ones.
    window.__ariseWidgetFailureReport.adopt(window.__ariseWidgetLoadFailures);
    var scanTimer = null;
    function scan() {
      try {
        var loaded = window.__ariseWidgetLoadFailures;
        if (Array.isArray(loaded)) {
          for (var i = 0; i < loaded.length; i++) remember(loaded[i], "failed to load");
        }
        var errors = window.__ariseMountErrors;
        if (Array.isArray(errors)) {
          for (var j = 0; j < errors.length; j++) remember("widget:" + errors[j].widget, errors[j].message);
        }
        var bus = window.__ARISE_MUTATION_BUS__;
        if (bus && typeof bus.failures === "function") {
          var updaters = bus.failures();
          for (var k = 0; k < updaters.length; k++) remember("updater:" + updaters[k].name, updaters[k].message);
        }
        render();
      } catch (_) {}
    }
    scanTimer = setInterval(function () {
      scan();
      if (window.__ariseWidgetsReady && !failures.length) {
        clearInterval(scanTimer);
        scanTimer = null;
      }
    }, 2000);
    window.addEventListener("arise:widgets-ready", function () {
      setTimeout(function () {
        scan();
        if (scanTimer && !failures.length) {
          clearInterval(scanTimer);
          scanTimer = null;
        }
      }, 1000);
    }, { once: true });
    window.addEventListener("arise:mount-error", scan);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
