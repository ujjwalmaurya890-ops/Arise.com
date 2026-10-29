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
   */
  function bindModalA11y(overlayEl, opts) {
    if (!overlayEl || overlayEl.__uxaModalBound) return;
    overlayEl.__uxaModalBound = true;
    var options = opts || {};
    var dialogSelector = options.dialogSelector || '[role="dialog"], .exw-pdf-dialog, .lf-modal-card, .crt-dialog';
    var onClose = typeof options.onClose === "function" ? options.onClose : null;

    var onKeyDown = function (ev) {
      var isOpen =
        overlayEl.getAttribute("data-open") === "true" ||
        (!overlayEl.hasAttribute("data-open") && overlayEl.isConnected && overlayEl.offsetParent !== null);
      if (!isOpen) return;
      if (ev.key === "Escape" && onClose) {
        ev.stopPropagation();
        onClose();
        return;
      }
      if (ev.key === "Tab") {
        var dialog = overlayEl.querySelector(dialogSelector) || overlayEl;
        var focusables = Array.prototype.slice
          .call(
            dialog.querySelectorAll(
              'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
            )
          )
          .filter(function (el) {
            return !el.hidden && el.getAttribute("aria-hidden") !== "true";
          });
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    overlayEl.addEventListener("keydown", onKeyDown);
  }

  // -------------------------------------------------------------------------
  // Viewport Card Reveal + Route Entrance Coordinator
  // -------------------------------------------------------------------------
  var seen = typeof WeakSet === "function" ? new WeakSet() : null;
  var io = null;

  function ensureObserver() {
    if (io || typeof IntersectionObserver !== "function" || prefersReducedMotion()) {
      return io;
    }
    io = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.isIntersecting) {
            entry.target.classList.add("uxa-in");
            entry.target.style.removeProperty("--uxa-stagger");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -24px 0px", threshold: 0.04 }
    );
    return io;
  }

  var lastRouteHeading = "";
  var routeAnimTimer = 0;

  function syncRouteTransition() {
    var h1 = document.querySelector("header h1");
    var main = document.getElementById("arise-main");
    if (!h1 || !main) return;
    var title = (h1.textContent || "").trim();
    if (!title || title === lastRouteHeading) return;
    var hadPrior = !!lastRouteHeading;
    lastRouteHeading = title;
    if (!hadPrior || prefersReducedMotion()) return;
    main.classList.remove("uxa-route-enter");
    clearTimeout(routeAnimTimer);
    requestAnimationFrame(function () {
      main.classList.add("uxa-route-enter");
      routeAnimTimer = setTimeout(function () {
        main.classList.remove("uxa-route-enter");
      }, 240);
    });
  }

  function scanCards() {
    syncRouteTransition();
    if (prefersReducedMotion()) return;
    var obs = ensureObserver();
    if (!obs) return;

    var nodes = document.querySelectorAll(CARD_SELECTOR);
    var viewportH = window.innerHeight || 900;
    var staggerIndex = 0;

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (seen && seen.has(el)) continue;
      if (seen) seen.add(el);

      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      if (rect.top < viewportH * 0.92 && rect.bottom > 0) {
        var delay = Math.min(staggerIndex * 24, 120);
        staggerIndex++;
        el.style.setProperty("--uxa-stagger", delay + "ms");
        el.classList.add("uxa-reveal");
        (function (target) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              target.classList.add("uxa-in");
            });
          });
        })(el);
      } else {
        el.classList.add("uxa-reveal");
        obs.observe(el);
      }
    }
  }

  var scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () {
      scanScheduled = false;
      try {
        var bus = window.__ARISE_MUTATION_BUS__;
        if (bus && typeof bus.mute === "function") {
          bus.mute(scanCards);
        } else {
          scanCards();
        }
      } catch (_) {}
    }, 80);
  }

  if (reducedMotionQuery) {
    var onMotionChange = function (e) {
      if (e.matches) {
        var hidden = document.querySelectorAll(".uxa-reveal:not(.uxa-in)");
        for (var i = 0; i < hidden.length; i++) {
          hidden[i].classList.add("uxa-in");
        }
        if (io) {
          io.disconnect();
          io = null;
        }
      }
    };
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", onMotionChange);
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(onMotionChange);
    }
  }

  function boot() {
    scheduleScan();
    if (window.__ARISE_MUTATION_BUS__ && typeof window.__ARISE_MUTATION_BUS__.subscribe === "function") {
      window.__ARISE_MUTATION_BUS__.subscribe(scheduleScan);
    } else if (typeof MutationObserver === "function" && document.body) {
      var mo = new MutationObserver(scheduleScan);
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  var api = {
    prefersReducedMotion: prefersReducedMotion,
    smoothScroll: smoothScroll,
    setButtonBusy: setButtonBusy,
    fetchWithTimeout: fetchWithTimeout,
    renderSkeleton: renderSkeleton,
    renderErrorState: renderErrorState,
    renderEmptyState: renderEmptyState,
    bindModalA11y: bindModalA11y,
    scanCards: scanCards
  };

  window.AriseAnimationUpgrade = api;
  window.__ARISE_UXA__ = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
