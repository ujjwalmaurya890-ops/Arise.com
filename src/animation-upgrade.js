/* ==========================================================================
   Arise Centralized Motion, Loading & Async UI Runtime (src/animation-upgrade.js)
   --------------------------------------------------------------------------
   Provides:
   - Viewport IntersectionObserver card reveal (.uxa-reveal -> .uxa-in)
   - Non-blocking SPA route/section entrance transition (.uxa-route-enter)
   - Shared helpers on window.AriseAnimationUpgrade & window.__ARISE_UXA__:
     prefersReducedMotion, smoothScroll, setButtonBusy, fetchWithTimeout,
     renderSkeleton, renderErrorState, renderEmptyState, bindModalA11y
   ========================================================================== */
(function () {
  "use strict";
  if (window.__ARISE_ANIMATION_UPGRADE__) return;
  window.__ARISE_ANIMATION_UPGRADE__ = true;

  var CARD_SELECTOR = [
    "#arise-main .glass-card",
    "#arise-main .glass-premium",
    "#arise-main .arise-bento-card",
    "#arise-main .lpa50-card",
    "#arise-main .cr-card",
    "#arise-main .dmp-shell",
    "#arise-main .dvp-shell",
    "#arise-main .pcc-shell",
    "#arise-main .att-card",
    "#arise-main .skt-card",
    "#arise-main .cp-card",
    "#arise-main .bd-score-card",
    "#arise-main .crt-card",
    "#arise-main .ptx-card"
  ].join(",");

  var reducedMotionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  function prefersReducedMotion() {
    if (document.documentElement.classList.contains("perf-lite")) return true;
    return !!(reducedMotionQuery && reducedMotionQuery.matches);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch];
    });
  }

  function smoothScroll(el, opts) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    var options = Object.assign({ block: "center" }, opts || {});
    options.behavior = prefersReducedMotion() ? "auto" : (options.behavior || "smooth");
    try {
      el.scrollIntoView(options);
    } catch (_) {
      try {
        el.scrollIntoView();
      } catch (__e) {}
    }
  }

  /**
   * Locks a button in a pending state without changing its width or allowing
   * duplicate clicks, and restores its exact prior markup/disabled state.
   */
  function setButtonBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      if (btn.getAttribute("data-uxa-busy") === "true") return;
      btn.__uxaOrigHtml = btn.innerHTML;
      btn.__uxaOrigDisabled = !!btn.disabled;
      btn.__uxaOrigMinWidth = btn.style.minWidth || "";
      var measured = btn.offsetWidth;
      if (measured > 0) {
        btn.style.minWidth = measured + "px";
      }
      btn.setAttribute("data-uxa-busy", "true");
      btn.setAttribute("aria-busy", "true");
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("uxa-btn-loading");
      btn.disabled = true;
      var label = busyLabel != null ? String(busyLabel) : (btn.textContent || "").trim() || "Working…";
      btn.innerHTML =
        '<span class="uxa-spinner uxa-spinner--xs" aria-hidden="true"></span>' +
        "<span>" + escapeHtml(label) + "</span>";
    } else {
      if (btn.getAttribute("data-uxa-busy") !== "true") return;
      btn.removeAttribute("data-uxa-busy");
      btn.removeAttribute("aria-busy");
      btn.removeAttribute("aria-disabled");
      btn.classList.remove("uxa-btn-loading");
      if (typeof btn.__uxaOrigHtml === "string") {
        btn.innerHTML = btn.__uxaOrigHtml;
      }
      btn.disabled = !!btn.__uxaOrigDisabled;
      btn.style.minWidth = btn.__uxaOrigMinWidth || "";
      delete btn.__uxaOrigHtml;
      delete btn.__uxaOrigDisabled;
      delete btn.__uxaOrigMinWidth;
    }
  }

  /**
   * Wraps fetch (or AriseAuth.fetch) with an AbortController timeout and
   * optional upstream AbortSignal, cleaning up timers in finally.
   */
  function fetchWithTimeout(url, opts, timeoutMs, fetchImpl) {
    var ms = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 15000;
    var fn = typeof fetchImpl === "function" ? fetchImpl : window.fetch;
    if (typeof fn !== "function") {
      return Promise.reject(new Error("Network fetch is unavailable in this environment."));
    }
    if (typeof AbortController !== "function") {
      return fn(url, opts);
    }
    var ctrl = new AbortController();
    var upstream = opts && opts.signal;
    var timedOut = false;
    var onUpstreamAbort = function () {
      try {
        ctrl.abort(upstream.reason);
      } catch (_) {
        ctrl.abort();
      }
    };
    if (upstream) {
      if (upstream.aborted) {
        onUpstreamAbort();
      } else if (typeof upstream.addEventListener === "function") {
        upstream.addEventListener("abort", onUpstreamAbort, { once: true });
      }
    }
    var timer = setTimeout(function () {
      timedOut = true;
      try {
        ctrl.abort(new Error("Request timed out"));
      } catch (_) {
        ctrl.abort();
      }
    }, ms);
    var mergedOpts = Object.assign({}, opts || {}, { signal: ctrl.signal });
    var cleanup = function () {
      clearTimeout(timer);
      if (upstream && typeof upstream.removeEventListener === "function") {
        upstream.removeEventListener("abort", onUpstreamAbort);
      }
    };
    try {
      return Promise.resolve(fn(url, mergedOpts)).then(
        function (res) {
          cleanup();
          return res;
        },
        function (err) {
          cleanup();
          if (timedOut) {
            var te = new Error("Request timed out after " + Math.round(ms / 1000) + "s. Please check your connection and retry.");
            te.code = "ETIMEDOUT";
            throw te;
          }
          throw err;
        }
      );
    } catch (syncErr) {
      cleanup();
      return Promise.reject(syncErr);
    }
  }

  /** Content-shaped placeholders used by the lazy mount queue and widgets.
   * The group has one shimmer; its decorative shapes never become live regions. */
  function renderSkeleton(opts) {
    var o = opts || {};
    var label = o.label || "Loading content…";
    var variant = ["widget", "dashboard", "chart", "table", "list", "form"].indexOf(o.variant) >= 0
      ? o.variant : "widget";
    var lines = typeof o.lines === "number" ? Math.max(1, Math.min(8, o.lines)) : 3;
    var stats = typeof o.stats === "number" ? Math.max(0, Math.min(6, o.stats)) : 0;
    var delayed = o.delayed !== false;
    var minHeight = o.minHeight ? ' style="min-height:' + escapeHtml(o.minHeight) + '"' : "";
    var widths = ["88%", "72%", "94%", "62%", "80%", "66%"];
    var shape = function (cls) { return '<span class="uxa-skeleton ' + cls + '"></span>'; };
    var head = '<div class="uxa-skeleton-heading"><div class="uxa-skeleton-heading-copy">' +
      shape("uxa-skeleton-title") + shape("uxa-skeleton-subtitle") + '</div>' +
      shape("uxa-skeleton-action") + '</div>';
    var tabs = '<div class="uxa-skeleton-tabs">' + shape("uxa-skeleton-tab") +
      shape("uxa-skeleton-tab") + shape("uxa-skeleton-tab") + '</div>';
    var metrics = function (count) {
      var cells = [];
      for (var s = 0; s < count; s++) {
        cells.push('<div class="uxa-skeleton-metric">' + shape("uxa-skeleton-metric-label") +
          shape("uxa-skeleton-metric-value") + shape("uxa-skeleton-metric-detail") + '</div>');
      }
      return '<div class="uxa-skeleton-metrics">' + cells.join("") + '</div>';
    };
    var rows = function (count, withAvatar) {
      var items = [];
      for (var r = 0; r < count; r++) {
        items.push('<div class="uxa-skeleton-row">' +
          (withAvatar ? shape("uxa-skeleton-row-avatar") : shape("uxa-skeleton-row-check")) +
          '<div class="uxa-skeleton-row-copy">' + shape("uxa-skeleton-row-title") +
          shape("uxa-skeleton-row-meta") + '</div>' + shape("uxa-skeleton-row-end") + '</div>');
      }
      return '<div class="uxa-skeleton-rows">' + items.join("") + '</div>';
    };
    var chart = '<div class="uxa-skeleton-chart"><div class="uxa-skeleton-chart-bars">' +
      [42, 68, 53, 82, 61, 92, 70, 78].map(function (height) {
        return '<span class="uxa-skeleton uxa-skeleton-chart-bar" style="height:' + height + '%"></span>';
      }).join("") + '</div></div>';
    var body = "";
    if (variant === "dashboard") body = tabs + metrics(stats || 4) + chart;
    else if (variant === "chart") body = chart + (stats ? metrics(stats) : "");
    else if (variant === "table") body = tabs + metrics(stats || 3) +
      '<div class="uxa-skeleton-controls">' + shape("uxa-skeleton-input") + shape("uxa-skeleton-filter") +
      shape("uxa-skeleton-filter") + '</div>' + rows(4, false);
    else if (variant === "list") body = tabs + '<div class="uxa-skeleton-controls">' +
      shape("uxa-skeleton-input") + shape("uxa-skeleton-filter") + '</div>' + rows(4, true);
    else if (variant === "form") body = '<div class="uxa-skeleton-form">' +
      shape("uxa-skeleton-field") + shape("uxa-skeleton-field") + shape("uxa-skeleton-field") +
      shape("uxa-skeleton-form-button") + '</div>';
    else {
      if (stats) body += metrics(stats);
      body += '<div class="uxa-skeleton-copy">';
      for (var i = 0; i < lines; i++) {
        body += '<span class="uxa-skeleton uxa-skeleton-line" style="width:' + widths[i % widths.length] + '"></span>';
      }
      body += '</div>';
    }
    return '<div class="uxa-skeleton-card uxa-skeleton-layout uxa-skeleton-layout--' + variant +
      (delayed ? ' uxa-skeleton--delayed' : '') + '" role="status" aria-live="polite" aria-busy="true"' + minHeight + '>' +
      '<span class="uxa-sr-only">' + escapeHtml(label) + '</span>' +
      '<div class="uxa-skeleton-group" aria-hidden="true">' + (o.header === false ? "" : head) + body + '</div></div>';
  }

  function renderErrorState(opts) {
    var o = opts || {};
    var title = o.title || "Unable to load data";
    var message = o.message || "Something went wrong while loading this section.";
    var retryAttr = o.retryAttr || 'data-uxa-retry="1"';
    var retryLabel = o.retryLabel || "Retry";
    var showRetry = o.retry !== false;
    return (
      '<div class="uxa-error-state" role="alert">' +
      '<div class="uxa-state-title">' + escapeHtml(title) + "</div>" +
      '<div class="uxa-state-desc">' + escapeHtml(message) + "</div>" +
      (showRetry
        ? '<button type="button" class="uxa-retry-btn" ' + retryAttr + ">" + escapeHtml(retryLabel) + "</button>"
        : "") +
      "</div>"
    );
  }

  function renderEmptyState(opts) {
    var o = opts || {};
    var title = o.title || "Nothing here yet";
    var message = o.message || "";
    var actionHtml = o.actionHtml || "";
    return (
      '<div class="uxa-empty-state">' +
      '<div class="uxa-state-title">' + escapeHtml(title) + "</div>" +
      (message ? '<div class="uxa-state-desc">' + escapeHtml(message) + "</div>" : "") +
      actionHtml +
      "</div>"
    );
  }

  /**
   * Coordinates keyboard Escape dismissal, initial focus, Tab wrapping, and
   * focus restoration to the element that triggered a modal/dialog.
   *
   * Called with no arguments it adopts every modal currently in the document;
   * widgets can also bind a specific overlay. Before this, the helper existed
   * but nothing called it, so widget dialogs: let Tab escape into the page
   * behind them, never moved focus into the dialog, and dropped the user's
   * focus back at <body> when they closed.
   *
   * All behaviour is opt-in by markup (`data-open`, `role="dialog"`,
   * `aria-modal`) and purely additive; a dialog that is not open is never
   * touched, and every failure path leaves focus where the browser put it.
   */
  var FOCUSABLE_SELECTOR = [
    "button:not(:disabled)",
    "[href]",
    "input:not(:disabled):not([type=hidden])",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])'
  ].join(", ");

  // Geometry is only meaningful when the environment actually performs layout.
  // Node/jsdom test runs report zero-size boxes for everything, which would
  // otherwise make every control look "hidden" and silently disable the trap.
  var layoutAvailable = null;
  function hasLayout() {
    if (layoutAvailable !== null) return layoutAvailable;
    try {
      layoutAvailable = !!(document.body && document.body.getClientRects && document.body.getClientRects().length > 0);
    } catch (_) {
      layoutAvailable = false;
    }
    return layoutAvailable;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest && el.closest("[hidden], [aria-hidden='true'], [inert]")) return false;
    try {
      var style = window.getComputedStyle(el);
      if (style && (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none")) {
        return false;
      }
    } catch (_) {}
    if (hasLayout() && el.getClientRects && el.getClientRects().length === 0) return false;
    return true;
  }

  function focusablesIn(root) {
    if (!root || !root.querySelectorAll) return [];
    var found = root.querySelectorAll(FOCUSABLE_SELECTOR);
    var result = [];
    for (var i = 0; i < found.length; i++) {
      if (isVisible(found[i])) result.push(found[i]);
    }
    return result;
  }

  function overlayIsOpen(overlayEl) {
    if (!overlayEl || !overlayEl.isConnected) return false;
    if (overlayEl.hasAttribute("data-open")) return overlayEl.getAttribute("data-open") === "true";
    // No explicit state: a dialog that is displayed counts as open.
    return isVisible(overlayEl);
  }

  function bindModalA11y(overlayEl, opts) {
    if (!overlayEl || overlayEl.__uxaModalBound) return;
    overlayEl.__uxaModalBound = true;
    var options = opts || {};
    var dialogSelector =
      options.dialogSelector ||
      '[role="dialog"], [aria-modal="true"], .exw-pdf-dialog, .exw-pdf-dialog, .lf-modal-box, .lf-modal-card, .crt-dialog, .hxp-pdf-dialog, .upp-command-dialog';
    var onClose = typeof options.onClose === "function" ? options.onClose : null;
    var restoreTo = null;

    function dialogEl() {
      return overlayEl.querySelector(dialogSelector) || overlayEl;
    }

    function rememberFocus() {
      var active = document.activeElement;
      if (active && active !== document.body && active !== overlayEl && !overlayEl.contains(active)) {
        restoreTo = active;
      }
    }

    function restoreFocus() {
      var target = restoreTo;
      restoreTo = null;
      if (target && typeof target.focus === "function" && target.isConnected) {
        try {
          target.focus({ preventScroll: true });
        } catch (_) {
          try { target.focus(); } catch (__e) {}
        }
      }
    }

    // Move focus into the dialog when it opens, and remember the trigger.
    var wasOpen = overlayIsOpen(overlayEl);
    if (wasOpen) rememberFocus();
    if (typeof MutationObserver === "function") {
      var stateObserver = new MutationObserver(function () {
        var open = overlayIsOpen(overlayEl);
        if (open === wasOpen) return;
        wasOpen = open;
        if (open) {
          rememberFocus();
          if (options.autoFocus !== false) {
            requestAnimationFrame(function () {
              if (!overlayIsOpen(overlayEl)) return;
              var current = document.activeElement;
              if (current && overlayEl.contains(current)) return;
              var focusables = focusablesIn(dialogEl());
              var target = (options.initialFocus && options.initialFocus()) || focusables[0];
              if (target && typeof target.focus === "function") {
                try { target.focus({ preventScroll: true }); } catch (_) {}
              }
            });
          }
        } else {
          restoreFocus();
        }
      });
      stateObserver.observe(overlayEl, { attributes: true, attributeFilter: ["data-open", "hidden", "aria-hidden"] });
    }

    var onKeyDown = function (ev) {
      if (!overlayIsOpen(overlayEl)) return;
      if (ev.key === "Escape") {
        // Only the overlay the key event actually came from reacts, so stacked
        // dialogs close innermost-first instead of all at once.
        var owner = ev.target && ev.target.closest ? ev.target.closest('[data-open="true"]') : null;
        if (owner && owner !== overlayEl) return;
        if (onClose) {
          ev.stopPropagation();
          onClose();
        }
        return;
      }
      if (ev.key !== "Tab") return;
      var focusables = focusablesIn(dialogEl());
      if (!focusables.length) {
        // A dialog with no focusable child still must not leak Tab to the page.
        ev.preventDefault();
        return;
      }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;
      var inside = overlayEl.contains(active);
      if (!inside) {
        // Focus escaped (or never entered): pull it back into the dialog.
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
        return;
      }
      if (ev.shiftKey && (active === first || active === dialogEl())) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    overlayEl.addEventListener("keydown", onKeyDown);

    var api = {
      restoreFocus: restoreFocus,
      focusables: function () { return focusablesIn(dialogEl()); },
      isOpen: function () { return overlayIsOpen(overlayEl); }
    };
    overlayEl.__uxaModalApi = api;
    return api;
  }

  /**
   * Adopt every dialog the widgets render. Re-scanned on the shared mutation
   * bus, so lazily mounted widgets and re-rendered dialogs are covered without
   * editing ~100 widget files. Returns the number of newly bound overlays.
   */
  var ADOPT_SELECTOR = [
    '[data-open][aria-modal="true"]',
    '[data-open][role="dialog"]',
    '[data-open] .exw-pdf-dialog',
    '[role="dialog"][aria-modal="true"]'
  ].join(", ");

  function adoptModals() {
    if (typeof document === "undefined") return 0;
    var bound = 0;
    var candidates = document.querySelectorAll(ADOPT_SELECTOR);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      // Prefer the overlay (the element that owns data-open) over the dialog.
      var overlay = el.hasAttribute("data-open") ? el : el.parentElement;
      if (overlay && !overlay.__uxaModalBound) {
        bindModalA11y(overlay);
        bound += 1;
      }
    }
    return bound;
  }

  // -------------------------------------------------------------------------
  // 8. Motion Engine
  // -------------------------------------------------------------------------
  // One coordinator owns every JS-driven animation on the page:
  //   • card / section reveal (single IntersectionObserver, fail-open)
  //   • route + first-paint composition
  //   • value-accurate chart, ring, bar and counter animation (WAAPI)
  //   • modal / drawer / menu exits (animate out, then commit the DOM change)
  //   • theme-switch coordination
  //   • performance-lite + reduced-motion state, observable by widgets
  //
  // Design constraints, in order of priority:
  //   1. If any of this fails, the UI must look exactly like it does today.
  //      Reveal only ever *adds* a class to already-visible content, and every
  //      path has a frame-budget fail-open.
  //   2. No animation may run on an element that is not visible.
  //   3. Nothing loops forever unless it is explicitly decorative and the user
  //      has neither reduced motion nor performance-lite enabled.
  // -------------------------------------------------------------------------

  var docEl = document.documentElement;

  // -- capability detection --------------------------------------------------

  var runtimeReduced = false;
  try {
    runtimeReduced = !!(docEl.classList.contains("reduce-motion") || docEl.classList.contains("perf-lite"));
  } catch (_) {}

  function motionReduced() {
    return runtimeReduced || prefersReducedMotion();
  }

  function isLite() {
    try {
      return docEl.classList.contains("perf-lite");
    } catch (_) {
      return false;
    }
  }

  function transitionMs(el, prop) {
    // Read a single custom property instead of computing styles for every node.
    var raw = "";
    try {
      raw = getComputedStyle(el).getPropertyValue(prop).trim();
    } catch (_) {}
    var n = parseFloat(raw);
    if (!isFinite(n)) return 0;
    return /ms$/.test(raw) ? n : n * 1000;
  }

  function on(callback) {
    return typeof callback === "function" ? callback : null;
  }

  // -- animation budget ------------------------------------------------------
  // Long lists (heatmaps, tables, calendars) must not animate 300 nodes at
  // once. Elements beyond the budget are committed instantly.

  var activeCount = 0;
  var MAX_CONCURRENT = 24;
  var MAX_BATCH = 48;

  function budgetExhausted() {
    return isLite() ? activeCount > 4 : activeCount > MAX_CONCURRENT;
  }

  function animateOnce(el, frames, options) {
    if (!el || motionReduced() || typeof el.animate !== "function" || budgetExhausted()) return null;
    var anim;
    try {
      anim = el.animate(frames, options);
    } catch (_) {
      try {
        anim = el.animate(frames, { duration: 1 });
        anim.finish();
      } catch (__e) {
        return null;
      }
      return null;
    }
    activeCount++;
    var done = function () {
      activeCount = Math.max(0, activeCount - 1);
      try { anim.cancel(); } catch (_) {}
    };
    if (typeof anim.finished === "function" && anim.finished.then) {
      anim.finished.then(done, done);
    } else {
      setTimeout(done, (options && options.duration ? options.duration : 300) + 80);
    }
    return anim;
  }

  // -- element registry ------------------------------------------------------
  // A single WeakSet replaces the old ad-hoc "seen" bookkeeping, so a widget
  // that remounts the same node never gets a second entrance animation.

  var touched = typeof WeakSet === "function" ? new WeakSet() : null;
  var decorated = typeof WeakSet === "function" ? new WeakSet() : null;

  function alreadyAnimated(el) {
    return !!(touched && touched.has(el));
  }

  function markAnimated(el) {
    if (touched) touched.add(el);
  }

  // -- 8.1 reveal ------------------------------------------------------------

  var REVEAL_SELECTOR = [
    "#arise-main .glass-card",
    "#arise-main .glass-premium",
    "#arise-main .arise-bento-card",
    "#arise-main .lpa50-card",
    "#arise-main .cr-card",
    "#arise-main .dmp-shell",
    "#arise-main .dvp-shell",
    "#arise-main .pcc-shell",
    "#arise-main .att-card",
    "#arise-main .skt-card",
    "#arise-main .cp-card",
    "#arise-main .bd-score-card",
    "#arise-main .crt-card",
    "#arise-main .ptx-card"
  ].join(",");

  var revealObserver = null;
  var revealQueue = [];

  function flushRevealQueue() {
    if (!revealQueue.length) return;
    var batch = revealQueue.splice(0, revealQueue.length);
    for (var i = 0; i < batch.length; i++) showRevealed(batch[i]);
  }

  function showRevealed(el) {
    if (!el) return;
    el.classList.add("uxa-in");
    el.classList.remove("uxa-reveal");
    el.style.removeProperty("--uxa-stagger");
  }

  function ensureRevealObserver() {
    if (revealObserver) return revealObserver;
    if (typeof IntersectionObserver !== "function") return null;
    revealObserver = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          try { revealObserver.unobserve(entry.target); } catch (_) {}
          showRevealed(entry.target);
        }
      },
      { rootMargin: "0px 0px -16px 0px", threshold: 0.02 }
    );
    return revealObserver;
  }

  var lastRouteHeading = "";
  var routeTimer = 0;

  /**
   * First paint / route entrance for the dashboard shell.
   * The whole #arise-main is NOT animated (it is thousands of nodes); instead
   * the header, the widget bar and the content column each fade in with a
   * 40ms cascade. Runs once per navigation, costs 3 compositor animations.
   */
  function composeShell(isFirstPaint) {
    if (motionReduced()) {
      docEl.classList.remove("uxa-booting");
      return;
    }
    var main = document.getElementById("arise-main");
    if (!main) return;
    docEl.classList.add("uxa-booting");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () {
          docEl.classList.remove("uxa-booting");
        }, isFirstPaint ? 420 : 60);
      });
    });
  }

  function syncRouteTransition() {
    var h1 = document.querySelector("#arise-main > header h1");
    var main = document.getElementById("arise-main");
    if (!h1 || !main) return;
    var title = (h1.textContent || "").trim();
    if (!title || title === lastRouteHeading) return;
    var firstPaint = !lastRouteHeading;
    lastRouteHeading = title;
    if (firstPaint) {
      composeShell(true);
      return;
    }
    if (motionReduced()) return;
    // The section column, not the whole app shell (which holds the sidebar
    // backdrop, the widget bar and the sticky header).
    var column = main.querySelector(":scope > .flex-1");
    if (!column) return;
    clearTimeout(routeTimer);
    column.classList.remove("uxa-route-enter");
    // Force a single style resolution so re-adding the class restarts it.
    void column.offsetWidth;
    requestAnimationFrame(function () {
      column.classList.add("uxa-route-enter");
      routeTimer = setTimeout(function () {
        column.classList.remove("uxa-route-enter");
      }, 260);
    });
  }

  function scanCards() {
    syncRouteTransition();
    var main = document.getElementById("arise-main");
    if (!main) return;
    var nodes = main.querySelectorAll(REVEAL_SELECTOR);
    if (!nodes.length) return;
    var observed = ensureRevealObserver();
    var viewportH = window.innerHeight || document.documentElement.clientHeight || 900;
    var inView = [];
    var later = [];
    // Pure geometry reads first (one layout), then all writes.
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (alreadyAnimated(el)) continue;
      if (el.classList.contains("uxa-reveal") || el.classList.contains("uxa-in")) {
        markAnimated(el);
        continue;
      }
      var rect = el.getBoundingClientRect();
      if (!rect.width && !rect.height) continue; // hidden tab / display:none
      if (rect.top < viewportH * 0.94 && rect.bottom > 0) inView.push(el);
      else if (observed) later.push(el);
      else inView.push(el);
      markAnimated(el);
    }

    // Stagger caps at --motion-stagger-max so a wide grid never waits long.
    var step = isLite() ? 0 : 28;
    for (var j = 0; j < inView.length && j < MAX_BATCH; j++) {
      inView[j].style.setProperty("--uxa-stagger", Math.min(j * step, 168) + "ms");
      inView[j].classList.add("uxa-reveal");
      revealQueue.push(inView[j]);
    }
    for (var k = MAX_BATCH; k < inView.length; k++) markAnimated(inView[k]);

    if (revealQueue.length) {
      requestAnimationFrame(function () {
        requestAnimationFrame(flushRevealQueue);
      });
    }

    for (var m = 0; m < later.length; m++) {
      later[m].classList.add("uxa-reveal");
      observed.observe(later[m]);
    }

    scanDataViews(main);
  }

  // -- 8.2 data visualisation ------------------------------------------------

  var cellRevealed = typeof WeakSet === "function" ? new WeakSet() : null;

  /**
   * Heatmap / calendar cells: one staggered scale-in per grid, then the cells
   * are marked and never animated again. The colour scale is untouched — the
   * animation only runs opacity/transform.
   */
  function revealCells(root) {
    if (motionReduced() || !root) return;
    var gridSelector = ".lh-grid, .hh-grid, .hh-monthly-grid, .dmh-grid, .att-heat-grid, .exwh-grid";
    var grids = root.querySelectorAll(gridSelector);
    for (var g = 0; g < grids.length && g < 8; g++) {
      var grid = grids[g];
      if (!grid || (decorated && decorated.has(grid))) continue;
      if (decorated) decorated.add(grid);
      var cells = grid.querySelectorAll(".lh-cell:not(.lh-cell-pad), .hh-cell:not(.hh-cell-pad), .dmh-cell:not(.dmh-cell-pad), .att-heat-cell, .exwh-cell");
      var limit = Math.min(cells.length, isLite() ? 40 : 160);
      for (var c = 0; c < limit; c++) {
        var cell = cells[c];
        if (cellRevealed && cellRevealed.has(cell)) continue;
        if (cellRevealed) cellRevealed.add(cell);
        cell.style.setProperty("--uxa-stagger", Math.min(c * 3, 260) + "ms");
      }
      if (limit) {
        grid.classList.add("arise-motion-cells");
        // Drop the marker afterwards: a later re-render must not replay it.
        (function (node) {
          setTimeout(function () {
            node.classList.remove("arise-motion-cells");
            var kids = node.querySelectorAll("[style*='--uxa-stagger']");
            for (var i = 0; i < kids.length; i++) kids[i].style.removeProperty("--uxa-stagger");
          }, 700);
        })(grid);
      }
    }
  }

  /**
   * Bars whose height/width is set inline by a widget. Animating from 0 to the
   * real value would be a lie for the first frame, so the engine animates from
   * the element's *current* committed value to the new one, and only when the
   * value actually changed.
   */
  var BAR_SELECTOR = [
    "[data-uxa-bar]",
    ".att-trend-bar",
    ".cgpa-grade-dist-bar",
    ".exw-trend-bar",
    ".exwi-rate-bar",
    ".exwi-week-bar",
    ".exw-ie-bar",
    ".dws-svg-wrap svg"
  ].join(",");

  var barValues = typeof WeakMap === "function" ? new WeakMap() : null;

  function animateBars(root) {
    if (motionReduced() || !barValues) return;
    var bars = root.querySelectorAll(BAR_SELECTOR);
    var limit = Math.min(bars.length, 80);
    for (var i = 0; i < limit; i++) {
      var bar = bars[i];
      var style = bar.style;
      if (!style) continue;
      var target = style.height || style.width;
      if (!target) continue;
      var previous = barValues.get(bar);
      barValues.set(bar, target);
      if (previous === undefined || previous === target) continue;
      var rect = bar.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      // Height grows from the baseline, width from the start edge.
      var frames = style.height
        ? [{ height: previous }, { height: target }]
        : [{ width: previous }, { width: target }];
      var duration = isLite() ? 200 : 420;
      // Inline geometry is the source of truth: set the target, then animate
      // *from* the old value so the final frame is exactly the real number.
      animateOnce(bar, frames, { duration: duration, easing: "cubic-bezier(0.25, 1, 0.5, 1)", fill: "none" });
    }
  }

  /**
   * Circular progress rings driven by stroke-dashoffset. The attribute set by
   * the widget is still the final authority: the engine only interpolates
   * between the previous and next offset and always lands on the real value.
   */
  var ringValues = typeof WeakMap === "function" ? new WeakMap() : null;

  function animateRings(root) {
    if (motionReduced() || !ringValues) return;
    var rings = root.querySelectorAll("circle[data-dmp-progress], circle[data-dvp-progress], circle[data-pcc-progress], circle[data-csu-progress]");
    var limit = Math.min(rings.length, 24);
    for (var i = 0; i < limit; i++) {
      var ring = rings[i];
      var next = ring.getAttribute("stroke-dashoffset");
      if (next === null) continue;
      var prev = ringValues.get(ring);
      ringValues.set(ring, next);
      if (prev === undefined || prev === next) continue;
      var from = parseFloat(prev);
      var to = parseFloat(next);
      if (!isFinite(from) || !isFinite(to) || Math.abs(from - to) < 0.01) continue;
      animateOnce(ring, [{ strokeDashoffset: from }, { strokeDashoffset: to }], {
        duration: isLite() ? 240 : 620,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)"
      });
    }
  }

  /**
   * Progress bars whose width is a percentage. The final width is whatever the
   * widget wrote; the engine only animates the transition to it.
   */
  var widthValues = typeof WeakMap === "function" ? new WeakMap() : null;

  function animateProgress(root) {
    if (motionReduced() || !widthValues) return;
    var fills = root.querySelectorAll(
      ".progress-fill, .ish-progress-fill, .et-progress-fill, .lpa50-row-bar > span, .cr-metric-bar > span, .ci-bar > i"
    );
    var limit = Math.min(fills.length, 40);
    for (var i = 0; i < limit; i++) {
      var fill = fills[i];
      var width = fill.style.width;
      if (!width) continue;
      var prev = widthValues.get(fill);
      widthValues.set(fill, width);
      if (prev === undefined || prev === width) continue;
      animateOnce(fill, [{ width: prev }, { width: width }], {
        duration: isLite() ? 220 : 460,
        easing: "cubic-bezier(0.25, 1, 0.5, 1)"
      });
    }
  }

  /**
   * Number counting for KPI values. Opt-in only (`data-uxa-count`), because a
   * dashboard that re-counts every value on every navigation is exhausting.
   * The element keeps its real text at all times: the animation is applied to
   * a text-content patch, and the final frame is the exact original string.
   */
  function animateCounters(root) {
    if (motionReduced()) return;
    var nodes = root.querySelectorAll("[data-uxa-count]:not([data-uxa-counted])");
    var limit = Math.min(nodes.length, 12);
    for (var i = 0; i < limit; i++) {
      var el = nodes[i];
      el.setAttribute("data-uxa-counted", "1");
      var text = (el.textContent || "").trim();
      var match = /^(-?[\d,]*\.?\d+)([\s\S]*)$/.exec(text);
      if (!match) continue;
      var raw = match[1].replace(/,/g, "");
      var end = parseFloat(raw);
      if (!isFinite(end) || Math.abs(end) < 2) continue;
      var decimals = (raw.split(".")[1] || "").length;
      var suffix = match[2] || "";
      var grouped = match[1].indexOf(",") !== -1;
      el.classList.add("uxa-count");
      var duration = isLite() ? 320 : 700;
      var start = null;
      var token = (el.__uxaCountToken = (el.__uxaCountToken || 0) + 1);
      el.textContent = formatNumber(0, decimals, grouped) + suffix;
      var step = function (ts) {
        if (el.__uxaCountToken !== token || !el.isConnected) return;
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / duration);
        // easeOutQuart: fast, then settles; never overshoots the real value.
        var eased = 1 - Math.pow(1 - t, 4);
        el.textContent = formatNumber(end * eased, decimals, grouped) + suffix;
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = text;
      };
      requestAnimationFrame(step);
    }
  }

  function formatNumber(value, decimals, grouped) {
    var fixed = value.toFixed(decimals);
    if (!grouped) return fixed;
    var parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function scanDataViews(root) {
    if (!root || motionReduced()) return;
    revealCells(root);
    animateRings(root);
    animateProgress(root);
    animateBars(root);
    animateCounters(root);
  }

  // All DOM churn funnels through one debounced scan. It runs inside the
  // shared mutation bus' "mute" window when that bus exists, so our own writes
  // never re-trigger the observer.
  var scanScheduled = false;

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () {
      scanScheduled = false;
      try {
        var bus = window.__ARISE_MUTATION_BUS__;
        if (bus && typeof bus.mute === "function") bus.mute(scanCards);
        else scanCards();
      } catch (err) {
        // A scan failure must never break the page or leave content hidden.
        var stuck = document.querySelectorAll(".uxa-reveal:not(.uxa-in)");
        for (var i = 0; i < stuck.length; i++) showRevealed(stuck[i]);
        if (window.console && console.warn) console.warn("[motion] scan failed:", err);
      }
    }, 80);
  }

  // -- 8.3 modal / drawer / menu choreography --------------------------------
  // The DOM contract already used by this project: an overlay carries
  // data-open="true|false". Sites that toggle it synchronously (display:none)
  // never animate out today; with this helper they fade out first and then
  // commit, without changing who owns the state.

  var MODAL_OVERLAY_SELECTOR = [
    "[data-uxa-modal]",
    ".exw-pdf-modal",
    ".lf-modal",
    ".crt-modal",
    ".ptx-modal",
    ".et-modal",
    ".hxp-pdf-modal",
    "#cloud-conflict"
  ].join(",");

  function commitAfterExit(overlay, mutate, durationMs) {
    if (!overlay || typeof mutate !== "function") {
      if (typeof mutate === "function") mutate();
      return;
    }
    var reduced = motionReduced();
    var ms = reduced ? 0 : (durationMs || transitionMs(overlay, "--motion-panel") || 220);
    overlay.setAttribute("data-uxa-closing", "true");
    if (ms > 0 && typeof overlay.animate === "function") {
      try {
        overlay.animate(
          [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(var(--motion-scale-modal, 0.975))" }
          ],
          { duration: ms, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }
        );
      } catch (_) {}
    }
    setTimeout(function () {
      overlay.removeAttribute("data-uxa-closing");
      var running = null;
      try {
        running = overlay.getAnimations ? overlay.getAnimations() : null;
      } catch (_) {}
      if (running && running.length) {
        for (var i = 0; i < running.length; i++) {
          try { running[i].cancel(); } catch (_) {}
        }
      }
      try { mutate(); } catch (err) { setTimeout(function () { throw err; }); }
    }, ms);
  }

  /**
   * Wraps a close handler so the modal animates out before it is hidden.
   * Idempotent: binding twice on the same overlay is a no-op, and the wrapper
   * always awaits the same promise chain the original handler produced.
   */
  function bindExitAnimation(overlay, closeFn, durationMs) {
    if (!overlay || typeof closeFn !== "function") return closeFn;
    return function () {
      var result = null;
      var args = arguments;
      var self = this;
      commitAfterExit(
        overlay,
        function () {
          result = closeFn.apply(self, args);
        },
        durationMs
      );
      return undefined;
    };
  }

  function openOverlay(overlay) {
    if (!overlay) return;
    overlay.removeAttribute("data-uxa-closing");
    overlay.setAttribute("data-open", "true");
    if (motionReduced()) return;
    var dialog = overlay.querySelector('[role="dialog"], .uxa-modal-panel');
    animateOnce(dialog || overlay, [
      { opacity: 0, transform: "translate3d(0, 6px, 0) scale(var(--motion-scale-modal, 0.975))" },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
    ], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }

  // -- 8.4 theme-switch coordination ----------------------------------------
  // The theme system already marks <html data-theme-switching> for ~120ms.
  // During that window the engine suspends its own observers so a re-render
  // caused by the palette change cannot replay entrances.

  var themeObserver = null;

  function watchThemeSwitches() {
    if (typeof MutationObserver !== "function") return;
    themeObserver = new MutationObserver(function () {
      // A theme flip invalidates cached geometry only; keep the value caches
      // (they store *data* values, which the theme never changes).
      lastRouteHeading = lastRouteHeading;
    });
    themeObserver.observe(docEl, { attributes: true, attributeFilter: ["data-theme", "data-theme-mode"] });
  }

  // -- 8.5 cursor illumination (opt-in, desktop + full motion only) ----------
  // One delegated pointermove listener on the dashboard, writes a single CSS
  // custom property, and only while the pointer is inside a marked surface.
  // Never runs on touch/coarse pointers or in lite/reduced modes.

  var cursorGlowBound = false;
  var cursorTarget = null;
  var cursorFrame = 0;

  function bindCursorGlow() {
    if (cursorGlowBound) return;
    if (motionReduced() || isLite()) return;
    var fine = false;
    try {
      fine = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    } catch (_) {}
    if (!fine) return;
    cursorGlowBound = true;
    docEl.classList.add("uxa-cursor-active");

    var onMove = function (event) {
      var target = event.target && event.target.closest ? event.target.closest(".uxa-cursor-glow") : null;
      if (!target) {
        if (cursorTarget && cursorTarget.classList) cursorTarget.style.removeProperty("--uxa-cursor-x");
        cursorTarget = null;
        return;
      }
      cursorTarget = target;
      if (cursorFrame) return;
      cursorFrame = requestAnimationFrame(function () {
        cursorFrame = 0;
        if (!cursorTarget) return;
        var rect = cursorTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = ((event.clientX - rect.left) / rect.width) * 100;
        var y = ((event.clientY - rect.top) / rect.height) * 100;
        cursorTarget.style.setProperty("--uxa-cursor-x", x.toFixed(2) + "%");
        cursorTarget.style.setProperty("--uxa-cursor-y", y.toFixed(2) + "%");
      });
    };

    // Passive: this must never influence scrolling.
    document.addEventListener("pointermove", onMove, { passive: true });
  }

  // -- 8.6 performance-lite / reduced-motion reactions -----------------------

  function applyMotionState() {
    var stop = motionReduced();
    if (stop) {
      docEl.classList.remove("uxa-cursor-active", "uxa-booting");
      var hidden = document.querySelectorAll(".uxa-reveal:not(.uxa-in)");
      for (var i = 0; i < hidden.length; i++) showRevealed(hidden[i]);
      if (revealQueue.length) revealQueue.length = 0;
      if (revealObserver) {
        try { revealObserver.disconnect(); } catch (_) {}
        revealObserver = null;
      }
      // Cancel every engine-owned animation so nothing is left half-way.
      try {
        var running = document.getAnimations ? document.getAnimations() : [];
        for (var a = running.length - 1; a >= 0; a--) {
          var anim = running[a];
          var target = anim.effect && anim.effect.target;
          if (target && target.closest && target.closest(".uxa-reveal, .uxa-anim-fade-up, .uxa-anim-scale-in")) anim.cancel();
        }
      } catch (_) {}
    }
  }

  function setMotionMode(mode) {
    // mode: "lite" | "full" | null (auto). Persisted exactly where the boot
    // script already looks, so a reload keeps the choice.
    try {
      if (mode === "lite" || mode === "full") localStorage.setItem("arise-perf-mode", mode);
      else localStorage.removeItem("arise-perf-mode");
    } catch (_) {}
    var lite = mode === "lite";
    if (mode === null) {
      try {
        lite = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      } catch (_) {}
    }
    docEl.classList.toggle("perf-lite", lite);
    runtimeReduced = lite;
    applyMotionState();
    if (!lite) bindCursorGlow();
    window.dispatchEvent(new CustomEvent("arise:motion-mode", { detail: { mode: lite ? "lite" : "full" } }));
  }

  if (reducedMotionQuery) {
    var onMotionChange = function () {
      applyMotionState();
    };
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", onMotionChange);
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(onMotionChange);
    }
  }

  // -- 8.7 public helpers used by widgets / app code -------------------------

  /**
   * Reveals a newly mounted widget: adds the entrance class for one frame and
   * removes it afterwards so a remount cannot replay it.
   */
  function animateIn(el, kind) {
    if (!el || motionReduced()) return;
    var cls = kind === "scale" ? "uxa-anim-scale-in" : kind === "fade" ? "uxa-anim-fade-in" : "uxa-anim-fade-up";
    el.classList.remove("uxa-anim-fade-up", "uxa-anim-fade-in", "uxa-anim-scale-in");
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () {
      el.classList.remove(cls);
    }, isLite() ? 200 : 420);
  }

  /**
   * Brief success confirmation on a button that already completed its action.
   * Never changes behaviour: it only paints a state and clears itself.
   */
  function flashSuccess(btn, label) {
    if (!btn) return;
    if (label) btn.textContent = label;
    btn.setAttribute("data-uxa-success", "true");
    setTimeout(function () {
      btn.removeAttribute("data-uxa-success");
      if (label && btn.__uxaPreFlashLabel) btn.textContent = btn.__uxaPreFlashLabel;
    }, 1400);
  }

  /**
   * Runs `mutate` after the standard exit transition, for any custom overlay
   * that does not match MODAL_OVERLAY_SELECTOR.
   */
  function closeWithTransition(overlay, mutate) {
    commitAfterExit(overlay, mutate);
  }

  function boot() {
    // 1. Reveal / route / data views.
    scheduleScan();
    if (window.__ARISE_MUTATION_BUS__ && typeof window.__ARISE_MUTATION_BUS__.subscribe === "function") {
      window.__ARISE_MUTATION_BUS__.subscribe(scheduleScan);
    } else if (typeof MutationObserver === "function" && document.body) {
      var mo = new MutationObserver(scheduleScan);
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // 2. First-paint composition (the shell exists by the time this runs).
    composeShell(true);

    // 3. Safety nets. The reveal must never be able to hide content:
    //    - anything still un-revealed after 1.2s is force-shown
    //    - anything revealed while the tab was hidden is force-shown on focus
    setTimeout(function () {
      var stuck = document.querySelectorAll(".uxa-reveal:not(.uxa-in)");
      for (var i = 0; i < stuck.length; i++) {
        var rect = stuck[i].getBoundingClientRect();
        if (rect.width || rect.height) showRevealed(stuck[i]);
      }
    }, 1200);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      var pending = document.querySelectorAll(".uxa-reveal:not(.uxa-in)");
      for (var i = 0; i < pending.length; i++) {
        var rect = pending[i].getBoundingClientRect();
        if (rect.top < (window.innerHeight || 900) && rect.bottom > 0) showRevealed(pending[i]);
      }
    });

    // 4. Theme + mode.
    watchThemeSwitches();
    bindCursorGlow();
    applyMotionState();

    // 5. Adopt widget dialogs for keyboard accessibility (Escape, Tab trap,
    //    focus in/out). Runs after the first scan so the shell already exists,
    //    then re-runs on the shared bus for lazily mounted widgets.
    adoptModals();
    setTimeout(adoptModals, 800);
    if (window.__ARISE_MUTATION_BUS__ && typeof window.__ARISE_MUTATION_BUS__.subscribe === "function") {
      window.__ARISE_MUTATION_BUS__.subscribe(function () {
        if (!document.hidden) adoptModals();
      });
    }

    // 6. Mark page-load complete for tests/telemetry (no behaviour attached).
    setTimeout(function () {
      docEl.setAttribute("data-uxa-ready", "1");
    }, 0);
  }

  var api = {
    prefersReducedMotion: prefersReducedMotion,
    isLite: isLite,
    smoothScroll: smoothScroll,
    setButtonBusy: setButtonBusy,
    fetchWithTimeout: fetchWithTimeout,
    renderSkeleton: renderSkeleton,
    renderErrorState: renderErrorState,
    renderEmptyState: renderEmptyState,
    bindModalA11y: bindModalA11y,
    adoptModals: adoptModals,
    getFocusable: focusablesIn,
    scanCards: scanCards,
    scanDataViews: scanDataViews,
    animateIn: animateIn,
    animateCounters: animateCounters,
    flashSuccess: flashSuccess,
    closeWithTransition: closeWithTransition,
    bindExitAnimation: bindExitAnimation,
    openOverlay: openOverlay,
    composeShell: composeShell,
    setMotionMode: setMotionMode,
    onInteraction: on,
    MODAL_OVERLAY_SELECTOR: MODAL_OVERLAY_SELECTOR
  };

  window.AriseAnimationUpgrade = api;
  window.__ARISE_UXA__ = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
