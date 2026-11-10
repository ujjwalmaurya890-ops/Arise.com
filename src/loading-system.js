/* ==========================================================================
   Arise Loading System v2 (src/loading-system.js)
   --------------------------------------------------------------------------
   A single, additive runtime for every loading / empty / error / offline state
   in the application. It extends — never replaces — the primitives already
   exported by src/animation-upgrade.js (window.AriseAnimationUpgrade) and
   src/widget-shared-utils.js.

   Public API (window.AriseLoading)
   -------------------------------
   skeleton(kind, opts) / createSkeleton(...)        -> placeholder HTML string
   createCardSkeleton / createTableSkeleton /
   createChartSkeleton / createProfileSkeleton        -> convenience wrappers
   createPageLoader(opts)                             -> full-page loader element
   createInlineLoader(opts)                           -> compact inline loader HTML
   mount(target, kind, opts)                          -> render a placeholder
   clear(target)                                      -> remove placeholder/state
   state(target, name, opts)                          -> loading/empty/error/offline
   run({ target, kind, task, render, preserve, ... }) -> full async lifecycle
   progress.{start,set,done,fail,pulse}               -> top navigation bar
   button.{busy,idle,guard}                           -> in-button loading state
   showButtonLoading / hideButtonLoading
   showProgressLoader / hideProgressLoader
   announce(message, { assertive })                   -> one shared live region
   offline.{show,hide,isOffline}
   config                                             -> timing configuration

   Design constraints
   ------------------
   - No dependencies, no build step, ES5-compatible.
   - Every async path is guaranteed to clear aria-busy and its loader, including
     failures, stale completions and detached hosts.
   - No invented progress: `progress.set()` is only used by callers that have a
     real fraction; everything else is indeterminate.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__ARISE_LOADING_SYSTEM__) return;
  window.__ARISE_LOADING_SYSTEM__ = true;

  var doc = window.document;
  var rootEl = doc.documentElement;

  /* ------------------------------------------------------------------ config */
  var DEFAULT_CONFIG = {
    // Placeholder appearance thresholds (ms)
    skeletonDelay: 160,
    // Minimum visible lifetime of a placeholder (ms) — prevents flicker
    minVisible: 380,
    minVisibleFast: 180,
    // Progress bar behaviour
    progressCreep: 700,
    progressDone: 240,
    progressError: 620,
    // Live-region de-duplication window
    announceThrottle: 700
  };

  function readConfigOverrides() {
    var out = {};
    try {
      var stored = window.localStorage && window.localStorage.getItem("arise-loading-config");
      if (stored) {
        var parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object") out = parsed;
      }
    } catch (_) {}
    if (window.__ARISE_LOADING_CONFIG__ && typeof window.__ARISE_LOADING_CONFIG__ === "object") {
      out = Object.assign(out, window.__ARISE_LOADING_CONFIG__);
    }
    return out;
  }

  var config = Object.assign({}, DEFAULT_CONFIG, readConfigOverrides());

  /* ------------------------------------------------------------------ helpers */
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, ms || 0));
    });
  }

  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === "string") return doc.querySelector(target);
    if (target.nodeType === 1) return target;
    return null;
  }

  function prefersReducedMotion() {
    try {
      var upgrade = window.AriseAnimationUpgrade;
      if (upgrade && typeof upgrade.prefersReducedMotion === "function") {
        return !!upgrade.prefersReducedMotion();
      }
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (_) {
      return false;
    }
  }

  function hasMeaningfulContent(el) {
    if (!el) return false;
    if (el.querySelector("[data-ars-skeleton]")) return false;
    if (el.children.length) return true;
    return !!(el.textContent && el.textContent.trim());
  }

  function setAttr(el, name, value) {
    if (!el) return;
    if (value === false || value == null) el.removeAttribute(name);
    else el.setAttribute(name, String(value));
  }

  /* -------------------------------------------------------------- skeletons */
  function shape(cls, style) {
    return '<span class="ars-skel ' + cls + '"' + (style ? ' style="' + style + '"' : "") + "></span>";
  }

  function repeat(count, factory) {
    var out = [];
    for (var i = 0; i < count; i += 1) out.push(factory(i));
    return out.join("");
  }

  function headShapes() {
    return (
      '<div class="ars-sk-head">' +
      '<div class="ars-sk-head-copy">' +
      shape("ars-skel--title ars-skel--static") +
      shape("ars-skel--subtitle ars-skel--static") +
      "</div>" +
      '<div class="ars-sk-head-actions">' +
      shape("ars-skel--button ars-skel--static") +
      shape("ars-skel--button ars-skel--static") +
      "</div></div>"
    );
  }

  function navShapes() {
    return (
      '<div class="ars-sk-nav">' +
      repeat(5, function () {
        return shape("ars-sk-nav-pill ars-skel--static");
      }) +
      "</div>"
    );
  }

  function statShapes(count) {
    return (
      '<div class="ars-sk-grid">' +
      repeat(count || 4, function () {
        return (
          '<div class="ars-sk-card ars-sk-stat">' +
          '<div class="ars-sk-stat-top">' +
          shape("ars-sk-stat-label ars-skel--static") +
          shape("ars-sk-stat-icon ars-skel--static") +
          "</div>" +
          shape("ars-sk-stat-value ars-skel--static") +
          shape("ars-sk-stat-detail ars-skel--static") +
          "</div>"
        );
      }) +
      "</div>"
    );
  }

  function tableShapes(opts) {
    var rows = Math.max(1, Math.min(12, opts.rows || 5));
    var withAvatar = opts.avatar !== false;
    var cols = opts.columns === 3 ? "1.2rem minmax(0,1fr) 4rem" : null;
    return (
      '<div class="ars-sk-table"' +
      (cols ? ' style="--ars-sk-table-cols:' + cols + '"' : "") +
      ">" +
      '<div class="ars-sk-table-head">' +
      shape("ars-skel--static") +
      shape("ars-skel--static") +
      shape("ars-skel--static") +
      shape("ars-skel--static") +
      shape("ars-skel--static") +
      "</div>" +
      repeat(rows, function () {
        return (
          '<div class="ars-sk-table-row">' +
          (withAvatar ? shape("ars-skel--avatar ars-skel--static") : shape("ars-skel--badge ars-skel--static")) +
          '<div class="ars-sk-table-copy">' +
          shape("ars-sk-table-title ars-skel--static") +
          shape("ars-sk-table-meta ars-skel--static") +
          "</div>" +
          shape("ars-skel--badge ars-skel--static") +
          shape("ars-skel--badge ars-skel--static") +
          shape("ars-skel--button ars-skel--static") +
          "</div>"
        );
      }) +
      "</div>"
    );
  }

  function listShapes(opts) {
    var rows = Math.max(1, Math.min(10, opts.rows || 4));
    var avatar = opts.avatar !== false;
    return (
      '<div class="ars-sk-list">' +
      repeat(rows, function () {
        return (
          '<div class="ars-sk-list-row">' +
          (avatar ? shape("ars-skel--avatar ars-skel--static") : shape("ars-skel--badge ars-skel--static")) +
          '<div class="ars-sk-list-copy">' +
          shape("ars-sk-list-title ars-skel--static") +
          shape("ars-sk-list-meta ars-skel--static") +
          "</div>" +
          shape("ars-sk-list-end ars-skel--static") +
          "</div>"
        );
      }) +
      "</div>"
    );
  }

  function feedShapes(opts) {
    var rows = Math.max(1, Math.min(10, opts.rows || 5));
    return (
      '<div class="ars-sk-list ars-skel-group--subtle">' +
      repeat(rows, function () {
        return (
          '<div class="ars-sk-feed-row">' +
          shape("ars-sk-feed-dot ars-skel--static") +
          '<div class="ars-sk-feed-copy">' +
          shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
          shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
          "</div>" +
          shape("ars-sk-feed-time ars-skel--static") +
          "</div>"
        );
      }) +
      "</div>"
    );
  }

  function chartShapes(type, opts) {
    var o = opts || {};
    var variant = type || "bar";
    var body = "";
    var tall = o.tall ? " ars-sk-chart--tall" : "";
    if (variant === "line" || variant === "sparkline" || variant === "area") {
      // A real (static) polyline reads as a chart instead of a block. It is
      // decorative, hidden from assistive technology, and animated only by the
      // group shimmer — no per-point animation loop.
      var points = "0,27 14,19 28,23 42,11 56,16 70,7 84,12 100,5";
      var area =
        variant === "area"
          ? '<path class="ars-sk-line-area" d="M0,27 L0,36 L100,36 L100,5 L84,12 L70,7 L56,16 L42,11 L28,23 L14,19 Z"></path>'
          : "";
      body =
        '<div class="ars-sk-line"' + (variant === "sparkline" ? ' style="min-height:2.5rem"' : "") + ">" +
        '<svg class="ars-sk-plot" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
        area +
        '<polyline points="' + points + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
        "</svg></div>" +
        '<div class="ars-sk-chart-legend">' +
        repeat(3, function () {
          return shape("ars-skel--static");
        }) +
        "</div>";
    } else if (variant === "pie") {
      body =
        '<div class="ars-sk-pie-wrap"><div class="ars-sk-pie"></div>' +
        '<div class="ars-sk-pie-legend">' +
        repeat(4, function () {
          return shape("ars-skel--line ars-skel--static");
        }) +
        "</div></div>";
    } else if (variant === "radar") {
      body =
        '<div class="ars-sk-radar" style="flex:1"></div>' +
        '<div class="ars-sk-chart-legend">' +
        repeat(3, function () {
          return shape("ars-skel--static");
        }) +
        "</div>";
    } else if (variant === "heatmap") {
      body =
        '<div class="ars-sk-heatmap">' +
        repeat(91, function (i) {
          var opacity = 0.35 + ((i * 37) % 60) / 100;
          return shape("ars-skel--static", "opacity:" + opacity.toFixed(2));
        }) +
        "</div>";
    } else if (variant === "progress") {
      body =
        '<div class="ars-sk-progress-rows">' +
        repeat(5, function () {
          return (
            '<div class="ars-sk-progress-row">' +
            shape("ars-sk-progress-label ars-skel--static") +
            shape("ars-sk-progress-track ars-skel--static") +
            shape("ars-sk-progress-value ars-skel--static") +
            "</div>"
          );
        }) +
        "</div>";
    } else {
      body =
        '<div class="ars-sk-bars">' +
        [44, 66, 52, 78, 58, 88, 70, 62].map(function (height) {
          return shape("ars-skel--static", "height:" + height + "%");
        }).join("") +
        "</div>" +
        '<div class="ars-sk-chart-legend">' +
        repeat(3, function () {
          return shape("ars-skel--static");
        }) +
        "</div>";
    }
    return '<div class="ars-sk-chart' + tall + '">' + body + "</div>";
  }

  function formShapes() {
    return (
      '<div class="ars-sk-form">' +
      repeat(3, function () {
        return (
          '<div class="ars-sk-field">' +
          shape("ars-sk-field-label ars-skel--static") +
          shape("ars-skel--input ars-skel--static") +
          "</div>"
        );
      }) +
      '<div class="ars-sk-form-actions">' +
      shape("ars-skel--button ars-skel--static") +
      shape("ars-skel--button ars-skel--static") +
      "</div></div>"
    );
  }

  function bodyFor(kind, opts) {
    switch (kind) {
      case "dashboard":
        return navShapes() + statShapes(opts.stats || 4) + chartShapes("area", { tall: true });
      case "analytics":
        return headShapes() + statShapes(opts.stats || 3) + chartShapes("line", { tall: true }) + chartShapes("bar", opts);
      case "stats":
      case "stat":
        return statShapes(opts.stats || opts.count || 4);
      case "cards":
      case "modules":
        return (
          '<div class="ars-sk-card-grid">' +
          repeat(Math.max(1, Math.min(6, opts.count || 3)), function () {
            return (
              '<div class="ars-sk-card">' +
              shape("ars-sk-card-media ars-skel--static") +
              shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
              shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
              '<div class="ars-sk-card-row">' +
              '<div class="ars-sk-card-tags">' +
              shape("ars-skel--static") +
              shape("ars-skel--static") +
              "</div>" +
              shape("ars-skel--badge ars-skel--static") +
              "</div></div>"
            );
          }) +
          "</div>"
        );
      case "profile":
        return (
          '<div class="ars-sk-profile">' +
          shape("ars-skel--avatar-lg ars-skel--static") +
          '<div class="ars-sk-profile-copy">' +
          shape("ars-skel--line ars-skel-w-55 ars-skel--static") +
          shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
          '<div class="ars-sk-profile-meta">' +
          shape("ars-skel--badge ars-skel--static") +
          shape("ars-skel--badge ars-skel--static") +
          "</div></div></div>"
        );
      case "nav":
        return navShapes();
      case "sidebar":
        return (
          '<div class="ars-sk-sidebar">' +
          repeat(Math.max(1, Math.min(10, opts.rows || 6)), function (i) {
            return (
              '<div class="ars-sk-sidebar-row">' +
              shape("ars-sk-sidebar-icon ars-skel--static") +
              shape("ars-sk-sidebar-label ars-skel--static", "width:" + (45 + ((i * 13) % 35)) + "%") +
              "</div>"
            );
          }) +
          "</div>"
        );
      case "table":
        return tableShapes(opts);
      case "list":
        return listShapes(opts);
      case "feed":
      case "activity":
        return feedShapes(opts);
      case "notifications":
        return (
          '<div class="ars-sk-list ars-skel-group--subtle">' +
          repeat(Math.max(1, Math.min(6, opts.rows || 4)), function () {
            return (
              '<div class="ars-sk-list-row">' +
              shape("ars-skel--avatar ars-skel--static") +
              '<div class="ars-sk-list-copy">' +
              shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
              shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
              "</div>" +
              shape("ars-sk-feed-time ars-skel--static") +
              "</div>"
            );
          }) +
          "</div>"
        );
      case "chart":
        return chartShapes(opts.type || "bar", opts);
      case "chart-line":
        return chartShapes("line", opts);
      case "chart-area":
        return chartShapes("area", opts);
      case "chart-bar":
        return chartShapes("bar", opts);
      case "chart-pie":
        return chartShapes("pie", opts);
      case "chart-radar":
        return chartShapes("radar", opts);
      case "chart-heatmap":
        return chartShapes("heatmap", opts);
      case "chart-progress":
        return chartShapes("progress", opts);
      case "calendar":
        return (
          '<div class="ars-sk-calendar">' +
          '<div class="ars-sk-calendar-head">' +
          repeat(7, function () {
            return shape("ars-skel--static");
          }) +
          "</div>" +
          '<div class="ars-sk-calendar-grid">' +
          repeat(28, function (i) {
            return shape("ars-sk-calendar-cell ars-skel--static", "opacity:" + (i % 7 === 0 ? "1" : "0.72"));
          }) +
          "</div></div>"
        );
      case "timeline":
        return (
          '<div class="ars-sk-timeline">' +
          repeat(Math.max(1, Math.min(8, opts.rows || 4)), function () {
            return (
              '<div class="ars-sk-timeline-item">' +
              '<div class="ars-sk-timeline-copy">' +
              shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
              shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
              "</div>" +
              shape("ars-skel--badge ars-skel--static") +
              "</div>"
            );
          }) +
          "</div>"
        );
      case "form":
        return formShapes();
      case "settings":
        return (
          '<div class="ars-sk-settings">' +
          repeat(Math.max(1, Math.min(8, opts.rows || 4)), function () {
            return (
              '<div class="ars-sk-settings-row">' +
              '<div class="ars-sk-settings-copy">' +
              shape("ars-skel--line ars-skel-w-55 ars-skel--static") +
              shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
              "</div>" +
              shape("ars-sk-switch ars-skel--static") +
              "</div>"
            );
          }) +
          "</div>"
        );
      case "search":
        return (
          '<div class="ars-sk-search">' +
          '<div class="ars-sk-search-bar">' +
          shape("ars-skel--input ars-skel--static") +
          shape("ars-skel--button ars-skel--static") +
          "</div>" +
          shape("ars-sk-search-hint ars-skel--static") +
          listShapes({ rows: opts.rows || 4, avatar: false }) +
          "</div>"
        );
      case "notes":
        return '<div class="ars-sk-list">' + repeat(Math.max(1, Math.min(8, opts.rows || 5)), function () {
          return (
            '<div class="ars-sk-list-row">' +
            shape("ars-skel--badge ars-skel--static") +
            '<div class="ars-sk-list-copy">' +
            shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
            shape("ars-skel--line ars-skel-w-85 ars-skel--static") +
            "</div>" +
            shape("ars-sk-list-end ars-skel--static") +
            "</div>"
          );
        }) + "</div>";
      case "dsa":
        return (
          '<div class="ars-sk-table">' +
          '<div class="ars-sk-table-head">' +
          repeat(5, function () {
            return shape("ars-skel--static");
          }) +
          "</div>" +
          repeat(Math.max(1, Math.min(10, opts.rows || 5)), function () {
            return (
              '<div class="ars-sk-table-row" style="grid-template-columns:1.2rem minmax(0,1fr) 5rem 3.5rem">' +
              shape("ars-skel--static") +
              '<div class="ars-sk-table-copy">' +
              shape("ars-sk-table-title ars-skel--static") +
              shape("ars-sk-table-meta ars-skel--static") +
              "</div>" +
              shape("ars-skel--badge ars-skel--static") +
              shape("ars-skel--badge ars-skel--static") +
              "</div>"
            );
          }) +
          "</div>"
        );
      case "ai":
        return (
          '<div class="ars-sk-ai">' +
          '<div class="ars-sk-ai-head">' +
          shape("ars-sk-ai-badge ars-skel--static") +
          shape("ars-skel--line ars-skel-w-25 ars-skel--static") +
          "</div>" +
          '<div class="ars-sk-ai-copy">' +
          shape("ars-skel--line ars-skel-w-85 ars-skel--static") +
          shape("ars-skel--line ars-skel-w-70 ars-skel--static") +
          shape("ars-skel--line ars-skel-w-85 ars-skel--static") +
          shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
          "</div></div>"
        );
      case "modal":
        return (
          '<div class="ars-sk-modal">' +
          '<div class="ars-sk-modal-head">' +
          shape("ars-skel--line ars-skel-w-40 ars-skel--static") +
          shape("ars-skel--badge ars-skel--static") +
          "</div>" +
          '<div class="ars-sk-modal-body">' +
          repeat(3, function () {
            return shape("ars-skel--line ars-skel--static");
          }) +
          "</div>" +
          '<div class="ars-sk-modal-foot">' +
          shape("ars-skel--button ars-skel--static") +
          shape("ars-skel--button ars-skel--static") +
          "</div></div>"
        );
      case "widget":
        return headShapes() + '<div class="ars-sk-card">' + shape("ars-skel--line ars-skel-w-85 ars-skel--static") + shape("ars-skel--line ars-skel-w-70 ars-skel--static") + shape("ars-skel--line ars-skel-w-55 ars-skel--static") + "</div>";
      case "section":
      default:
        return headShapes() +
          '<div class="ars-sk-card">' +
          repeat(3, function () {
            return shape("ars-skel--line ars-skel--static");
          }) +
          "</div>";
    }
  }

  var SKELETON_ROOTS = {
    dashboard: "ars-sk-section",
    analytics: "ars-sk-section",
    section: "ars-sk-section",
    widget: "ars-sk-widget",
    stats: "ars-sk-section",
    stat: "ars-sk-section",
    cards: "ars-sk-section",
    modules: "ars-sk-section",
    profile: "ars-sk-section",
    nav: "ars-sk-section",
    sidebar: "ars-sk-section",
    table: "ars-sk-section",
    list: "ars-sk-section",
    feed: "ars-sk-section",
    activity: "ars-sk-section",
    notifications: "ars-sk-section",
    chart: "ars-sk-section",
    "chart-line": "ars-sk-section",
    "chart-area": "ars-sk-section",
    "chart-bar": "ars-sk-section",
    "chart-pie": "ars-sk-section",
    "chart-radar": "ars-sk-section",
    "chart-heatmap": "ars-sk-section",
    "chart-progress": "ars-sk-section",
    calendar: "ars-sk-section",
    timeline: "ars-sk-section",
    form: "ars-sk-section",
    settings: "ars-sk-section",
    search: "ars-sk-section",
    notes: "ars-sk-section",
    dsa: "ars-sk-section",
    ai: "ars-sk-section",
    modal: "ars-sk-section"
  };

  /**
   * Build placeholder markup for a content shape.
   * @param {string} kind   one of the keys documented above
   * @param {object} [opts] { label, rows, stats, count, type, height, delayed, subtle, header }
   * @returns {string}
   */
  function skeleton(kind, opts) {
    var o = opts || {};
    var name = typeof kind === "string" ? kind : "widget";
    if (!bodyFor(name, o)) name = "widget";
    var label = o.label || "Loading content…";
    var root = SKELETON_ROOTS[name] || "ars-sk-section";
    var classes = [root, "ars-skel-group"];
    if (o.subtle) classes.push("ars-skel-group--subtle");
    if (o.delayed !== false) classes.push("ars-skel-group--delayed");
    if (o.className) classes.push(String(o.className));
    var style = o.height ? ' style="min-height:' + escapeHtml(o.height) + '"' : "";
    var body = (o.header === false ? "" : "") + bodyFor(name, o);
    // One indeterminate progressbar (not a live region): a dashboard can mount
    // six placeholders at once, and six polite regions would announce six times.
    // Loading is announced once through announceLoading() instead.
    return (
      '<div class="' + classes.join(" ") + '" role="progressbar" aria-label="' + escapeHtml(label) + '" aria-busy="true" data-ars-skeleton="1"' + style + ">" +
      '<span class="ars-sr">' + escapeHtml(label) + "</span>" +
      '<div class="ars-sk-body" aria-hidden="true">' + body + "</div>" +
      "</div>"
    );
  }

  function createSkeleton(kind, opts) {
    return skeleton(kind, opts);
  }
  function createCardSkeleton(opts) {
    return skeleton("cards", opts);
  }
  function createTableSkeleton(opts) {
    return skeleton("table", opts);
  }
  function createChartSkeleton(opts) {
    var o = opts || {};
    return skeleton("chart-" + (o.type || "bar"), o);
  }
  function createProfileSkeleton(opts) {
    return skeleton("profile", opts);
  }
  function createInlineLoader(opts) {
    var o = opts || {};
    var size = o.size === "lg" ? "md" : o.size === "sm" ? "xs" : "sm";
    return (
      '<span class="ars-inline-loader" role="status" aria-live="polite">' +
      '<span class="ars-spinner ars-spinner--' + size + '" aria-hidden="true"></span>' +
      (o.label ? "<span>" + escapeHtml(o.label) + "</span>" : "") +
      "</span>"
    );
  }

  /** Full-page loader element — only for genuinely blocking boots. */
  function createPageLoader(opts) {
    var o = opts || {};
    var el = doc.createElement("div");
    el.className = "ars-page-loader";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-busy", "true");
    el.innerHTML =
      '<div class="ars-page-loader__brand">' +
      '<span class="arise-brand-mark arise-brand-mark--loading ars-page-loader__logo" aria-hidden="true">A</span>' +
      "<span>Arise</span></div>" +
      '<div class="ars-page-loader__label">' + escapeHtml(o.label || "Preparing your workspace…") + "</div>" +
      '<div class="ars-page-loader__bar" aria-hidden="true"></div>';
    return el;
  }

  /* ------------------------------------------------------------------ mount */
  var lastLoadingAnnounceAt = -Infinity;

  /** At most one "loading" announcement per 900ms window, even when several
   * widgets mount together. Each host still carries aria-busy for AT. */
  function announceLoading(label) {
    var stamp = now();
    if (stamp - lastLoadingAnnounceAt < 900) return;
    lastLoadingAnnounceAt = stamp;
    announce(label);
  }

  function mount(target, kind, opts) {
    var el = resolveTarget(target);
    if (!el) return null;
    var o = opts || {};
    el.setAttribute("aria-busy", "true");
    el.innerHTML = skeleton(kind, o);
    announceLoading(o.label || "Loading content…");
    return el.firstElementChild;
  }

  function clear(target) {
    var el = resolveTarget(target);
    if (!el) return;
    el.removeAttribute("aria-busy");
    el.classList.remove("ars-refreshing");
    if (el.firstElementChild && el.firstElementChild.hasAttribute("data-ars-skeleton") && el.children.length === 1) {
      el.innerHTML = "";
    }
  }

  /* ------------------------------------------------------------ state blocks */
  function emptyState(opts) {
    var o = opts || {};
    return (
      '<div class="uxa-empty-state" role="status">' +
      '<div class="uxa-state-title">' + escapeHtml(o.title || "Nothing here yet") + "</div>" +
      (o.message ? '<div class="uxa-state-desc">' + escapeHtml(o.message) + "</div>" : "") +
      (o.actionHtml || "") +
      "</div>"
    );
  }

  function errorState(opts) {
    var o = opts || {};
    return (
      '<div class="uxa-error-state" role="alert">' +
      '<div class="uxa-state-title">' + escapeHtml(o.title || "Unable to load this section") + "</div>" +
      '<div class="uxa-state-desc">' + escapeHtml(o.message || "The request did not complete. Your saved data is unchanged.") + "</div>" +
      (o.retry === false
        ? ""
        : '<button type="button" class="uxa-retry-btn" data-ars-retry="1">' + escapeHtml(o.retryLabel || "Retry") + "</button>") +
      "</div>"
    );
  }

  function offlineState(opts) {
    var o = opts || {};
    return (
      '<div class="uxa-offline-state" role="status">' +
      '<div class="uxa-state-title">' + escapeHtml(o.title || "You are offline") + "</div>" +
      '<div class="uxa-state-desc">' + escapeHtml(o.message || "This section needs a network connection. Cached data is still available.") + "</div>" +
      (o.retry === false ? "" : '<button type="button" class="uxa-retry-btn" data-ars-retry="1">' + escapeHtml(o.retryLabel || "Try again") + "</button>") +
      "</div>"
    );
  }

  function state(target, name, opts) {
    var el = resolveTarget(target);
    if (!el) return null;
    var o = opts || {};
    el.classList.remove("ars-refreshing");
    if (name === "loading") return mount(el, o.kind || "widget", o);
    el.removeAttribute("data-ars-skeleton");
    el.removeAttribute("aria-busy");
    if (name === "ready") {
      if (el.firstElementChild && el.firstElementChild.getAttribute("data-ars-skeleton") === "1" && el.children.length === 1) {
        el.innerHTML = "";
      }
      return el;
    }
    if (name === "empty") el.innerHTML = emptyState(o);
    else if (name === "error") {
      el.innerHTML = errorState(o);
      bindRetry(el, o.onRetry);
    } else if (name === "offline") {
      el.innerHTML = offlineState(o);
      bindRetry(el, o.onRetry);
    }
    return el;
  }

  function bindRetry(container, handler) {
    var btn = container.querySelector("[data-ars-retry]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (btn.disabled) return;
      button.busy(btn, true, "Retrying…");
      var result;
      try {
        result = typeof handler === "function" ? handler() : null;
      } catch (err) {
        button.idle(btn);
        return;
      }
      Promise.resolve(result).then(
        function () {
          button.idle(btn);
        },
        function () {
          button.idle(btn);
        }
      );
    });
  }

  /* ------------------------------------------------------ async lifecycle --- */
  function run(spec) {
    var s = spec || {};
    var target = resolveTarget(s.target);
    var kind = s.kind || "widget";
    var label = s.label || "Loading…";
    var minVisible = typeof s.minVisible === "number" ? s.minVisible : config.minVisible;
    var startDelay = typeof s.delay === "number" ? s.delay : config.skeletonDelay;

    if (!target) {
      return Promise.resolve().then(function () {
        return typeof s.task === "function" ? s.task({ signal: undefined }) : s.data;
      });
    }

    var seq = (target.__arsRunSeq || 0) + 1;
    target.__arsRunSeq = seq;
    var live = function () {
      return target.__arsRunSeq === seq && target.isConnected !== false;
    };

    var preserved = s.preserve !== false && hasMeaningfulContent(target);
    var hadContent = hasMeaningfulContent(target);
    var skeletonShownAt = 0;
    var skeletonTimer = null;
    // A newer run supersedes the previous one: signal the old request to stop so
    // its result cannot overwrite fresher content.
    if (target.__arsRunCtrl) {
      try { target.__arsRunCtrl.abort(); } catch (_) {}
    }
    var ctrl = typeof AbortController === "function" && s.abortable !== false ? new AbortController() : null;
    target.__arsRunCtrl = ctrl;

    target.setAttribute("aria-busy", "true");
    if (preserved) {
      target.classList.add("ars-refreshing");
      if (s.chip !== false) showRefreshChip(target, label);
    } else if (!hadContent) {
      target.innerHTML = skeleton(kind, { label: label, rows: s.rows, stats: s.stats, type: s.type, height: s.height, subtle: s.subtle });
      skeletonShownAt = now();
      announceLoading(label);
    } else {
      skeletonTimer = setTimeout(function () {
        if (!live()) return;
        target.innerHTML = skeleton(kind, { label: label, rows: s.rows, stats: s.stats, type: s.type, height: s.height, subtle: s.subtle });
        skeletonShownAt = now();
        announceLoading(label);
      }, startDelay);
    }

    var taskPromise;
    try {
      taskPromise = Promise.resolve(s.task ? s.task({ signal: ctrl ? ctrl.signal : undefined }) : s.data);
    } catch (err) {
      taskPromise = Promise.reject(err);
    }

    function settle() {
      var wait = 0;
      if (skeletonShownAt) wait = Math.max(0, minVisible - (now() - skeletonShownAt));
      return delay(wait);
    }

    function finishLoadingUi() {
      if (skeletonTimer) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
      if (!live()) return;
      target.removeAttribute("aria-busy");
      target.classList.remove("ars-refreshing");
      removeRefreshChip(target);
    }

    return taskPromise.then(
      function (data) {
        return settle().then(function () {
          if (!live()) return data;
          finishLoadingUi();
          var isEmpty = false;
          if (typeof s.empty === "function") {
            try {
              isEmpty = !!s.empty(data);
            } catch (_) {
              isEmpty = false;
            }
          }
          if (isEmpty) {
            target.innerHTML =
              (typeof s.emptyHtml === "string" && s.emptyHtml) ||
              emptyState(Object.assign({}, s.emptyState || {}));
            announce((s.emptyState && s.emptyState.announce) || "Loaded — no results to show.");
            return data;
          }
          var rendered;
          if (typeof s.render === "function") rendered = s.render(data, target);
          if (typeof rendered === "string") target.innerHTML = rendered;
          else if (rendered && rendered.nodeType === 1) {
            target.innerHTML = "";
            target.appendChild(rendered);
          }
          if (s.announceSuccess) announce(s.announceSuccess);
          return data;
        });
      },
      function (err) {
        return settle().then(function () {
          if (!live()) return null;
          finishLoadingUi();
          var message = (err && err.message) || "The request did not complete.";
          if (s.busyMessage) message = s.busyMessage;
          if (typeof s.onError === "function") {
            try {
              s.onError(err, target);
            } catch (_) {}
          } else if (preserved) {
            showRefreshChip(target, "Could not refresh", { tone: "error" });
          } else {
            target.innerHTML = errorState({
              title: s.errorTitle || "Unable to load this section",
              message: s.errorMessage || message
            });
            bindRetry(target, function () {
              return run(Object.assign({}, s, { target: target }));
            });
          }
          announce((s.errorTitle || "Loading failed") + ": " + message, { assertive: true });
          if (s.rethrow) throw err;
          return null;
        });
      }
    ).then(function (result) {
      if (target.__arsRunCtrl === ctrl) target.__arsRunCtrl = null;
      return result;
    });
  }

  function showRefreshChip(target, text, opts) {
    var o = opts || {};
    removeRefreshChip(target);
    var chip = doc.createElement("span");
    chip.className = "ars-refresh-chip";
    chip.setAttribute("data-ars-refresh-chip", "1");
    chip.setAttribute("role", "status");
    if (o.tone === "error") chip.setAttribute("data-tone", "error");
    chip.innerHTML =
      '<span class="ars-spinner ars-spinner--xs" aria-hidden="true"></span><span>' + escapeHtml(text) + "</span>";
    chip.style.position = "absolute";
    chip.style.top = "0.5rem";
    chip.style.right = "0.5rem";
    chip.style.zIndex = "2";
    var position = window.getComputedStyle ? window.getComputedStyle(target).position : "";
    if (!position || position === "static") target.style.position = "relative";
    target.appendChild(chip);
    return chip;
  }

  function removeRefreshChip(target) {
    var existing = target.querySelector("[data-ars-refresh-chip]");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  /* ------------------------------------------------------------- buttons --- */
  var button = {
    busy: function (btn, isBusy, label) {
      if (!btn) return;
      var upgrade = window.AriseAnimationUpgrade;
      if (upgrade && typeof upgrade.setButtonBusy === "function") {
        upgrade.setButtonBusy(btn, !!isBusy, label);
        return;
      }
      if (isBusy) {
        if (btn.getAttribute("data-ars-busy") === "true") return;
        btn.__arsHtml = btn.innerHTML;
        btn.__arsDisabled = !!btn.disabled;
        var width = btn.offsetWidth;
        if (width > 0) btn.style.minWidth = width + "px";
        btn.setAttribute("data-ars-busy", "true");
        btn.setAttribute("aria-busy", "true");
        btn.disabled = true;
        btn.classList.add("ars-btn-busy");
        var text = label != null ? label : (btn.textContent || "").trim() || "Working…";
        btn.innerHTML = '<span class="ars-spinner ars-spinner--xs" aria-hidden="true"></span><span>' + escapeHtml(text) + "</span>";
      } else {
        if (btn.getAttribute("data-ars-busy") !== "true") return;
        btn.removeAttribute("data-ars-busy");
        btn.removeAttribute("aria-busy");
        btn.classList.remove("ars-btn-busy");
        if (typeof btn.__arsHtml === "string") btn.innerHTML = btn.__arsHtml;
        btn.disabled = !!btn.__arsDisabled;
        btn.style.minWidth = "";
        delete btn.__arsHtml;
        delete btn.__arsDisabled;
      }
    },
    idle: function (btn) {
      button.busy(btn, false);
    },
    /**
     * Runs `fn` with the button locked, guaranteeing the lock is released on
     * success, failure or a synchronous throw, and preventing double submits.
     */
    guard: function (btn, fn, opts) {
      var o = opts || {};
      if (btn && btn.getAttribute("data-ars-guard") === "1") return Promise.resolve(null);
      if (btn) btn.setAttribute("data-ars-guard", "1");
      button.busy(btn, true, o.label);
      var started = now();
      function release() {
        if (!btn) return Promise.resolve();
        var remaining = Math.max(0, (o.minDuration || 0) - (now() - started));
        return delay(remaining).then(function () {
          btn.removeAttribute("data-ars-guard");
          button.busy(btn, false);
          if (o.announceSuccess) announce(o.announceSuccess);
        });
      }
      var result;
      try {
        result = typeof fn === "function" ? fn() : null;
      } catch (err) {
        return release().then(function () {
          announce((o.errorPrefix || "Action failed") + ": " + ((err && err.message) || "Unexpected error"), { assertive: true });
          throw err;
        });
      }
      return Promise.resolve(result).then(
        function (value) {
          return release().then(function () {
            return value;
          });
        },
        function (err) {
          return release().then(function () {
            announce((o.errorPrefix || "Action failed") + ": " + ((err && err.message) || "Unexpected error"), { assertive: true });
            if (o.rethrow === false) return null;
            throw err;
          });
        }
      );
    }
  };

  function showButtonLoading(btn, label) {
    button.busy(btn, true, label);
    return btn;
  }
  function hideButtonLoading(btn) {
    button.busy(btn, false);
    return btn;
  }

  /* ------------------------------------------------------------ top progress */
  var progressState = { count: 0, el: null, timers: [], hideTimer: null, determinate: false };

  function ensureTopbar() {
    if (progressState.el && progressState.el.isConnected !== false) return progressState.el;
    if (!doc.body) return null;
    var el = doc.createElement("div");
    el.className = "ars-topbar";
    el.setAttribute("data-ars-topbar", "1");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("data-state", "idle");
    el.innerHTML = '<span class="ars-topbar__fill"></span>';
    doc.body.appendChild(el);
    progressState.el = el;
    return el;
  }

  function clearProgressTimers() {
    progressState.timers.forEach(function (t) {
      clearTimeout(t);
    });
    progressState.timers = [];
    if (progressState.hideTimer) {
      clearTimeout(progressState.hideTimer);
      progressState.hideTimer = null;
    }
  }

  function setBar(value) {
    var el = ensureTopbar();
    if (!el) return;
    el.style.setProperty("--ars-progress", String(Math.max(0, Math.min(1, value))));
  }

  var progress = {
    /** Start (or join) an indeterminate operation. Ref-counted. */
    start: function () {
      progressState.count += 1;
      clearProgressTimers();
      var el = ensureTopbar();
      if (!el) return progress;
      el.removeAttribute("data-mode");
      el.setAttribute("data-state", "active");
      setBar(0.08);
      progressState.timers.push(setTimeout(function () {
        if (progressState.count > 0) setBar(0.42);
      }, 120));
      progressState.timers.push(setTimeout(function () {
        if (progressState.count > 0) setBar(0.72);
      }, config.progressCreep));
      return progress;
    },
    /** Real determinate progress (0..1). Only call when a true fraction exists. */
    set: function (value) {
      var v = Number(value);
      if (!isFinite(v)) return progress;
      progressState.determinate = true;
      var el = ensureTopbar();
      if (!el) return progress;
      // A real fraction supersedes the synthetic creep; otherwise a timer would
      // overwrite the measured value on the next tick.
      progressState.timers.forEach(function (t) {
        clearTimeout(t);
      });
      progressState.timers = [];
      el.removeAttribute("data-mode");
      el.setAttribute("data-state", "active");
      setBar(Math.max(0.02, Math.min(0.98, v)));
      return progress;
    },
    done: function () {
      progressState.count = Math.max(0, progressState.count - 1);
      if (progressState.count > 0) return progress;
      var el = ensureTopbar();
      if (!el) return progress;
      clearProgressTimers();
      setBar(1);
      el.setAttribute("data-state", "done");
      progressState.hideTimer = setTimeout(function () {
        el.setAttribute("data-state", "idle");
        el.style.setProperty("--ars-progress", "0");
        progressState.determinate = false;
      }, config.progressDone);
      return progress;
    },
    fail: function () {
      progressState.count = 0;
      var el = ensureTopbar();
      if (!el) return progress;
      clearProgressTimers();
      setBar(1);
      el.setAttribute("data-state", "error");
      progressState.hideTimer = setTimeout(function () {
        el.setAttribute("data-state", "idle");
        el.style.setProperty("--ars-progress", "0");
      }, config.progressError);
      return progress;
    },
    /** A short, single navigation transition (panel/route switch). */
    pulse: function () {
      var el = ensureTopbar();
      if (!el) return progress;
      if (el.getAttribute("data-state") === "active") return progress;
      clearProgressTimers();
      el.setAttribute("data-state", "active");
      setBar(0.1);
      progressState.timers.push(setTimeout(function () {
        setBar(0.65);
      }, 90));
      progressState.timers.push(setTimeout(function () {
        setBar(1);
        el.setAttribute("data-state", "done");
        progressState.timers.push(setTimeout(function () {
          el.setAttribute("data-state", "idle");
          el.style.setProperty("--ars-progress", "0");
        }, config.progressDone));
      }, 300));
      return progress;
    },
    element: function () {
      return ensureTopbar();
    }
  };

  function showProgressLoader(opts) {
    return progress.start(opts);
  }
  function hideProgressLoader() {
    return progress.done();
  }

  /* --------------------------------------------------- navigation progress -- */
  /**
   * Route changes in the React shell are triggered by nav items that carry
   * `data-nav-id` (mobile drawer and desktop rail). A single capture-phase
   * listener keeps the indicator accurate without touching the shell bundle.
   */
  function initNavigationProgress() {
    if (doc.__arsNavBound) return;
    doc.__arsNavBound = true;
    doc.addEventListener(
      "click",
      function (ev) {
        var target = ev.target;
        if (!target || typeof target.closest !== "function") return;
        if (target.closest("[data-ars-topbar], .ars-page-loader")) return;
        if (target.closest("[data-nav-id]")) progress.pulse();
      },
      true
    );
    window.addEventListener("popstate", function () {
      progress.pulse();
    });
  }

  /* ------------------------------------------------------- cloud sync state -- */
  /**
   * Maps the sync engine's real status stream (onStatus) to the shared
   * indicator. Attachment uploads report a true percentage, so that step uses
   * determinate progress; queued store writes have no measurable fraction and
   * stay indeterminate. Waiting for a user decision is not progress, so
   * `conflict`/`offline` terminate the indicator instead of leaving it running.
   */
  var cloudProgressActive = false;

  function cloudStatus(info) {
    if (!info || typeof info !== "object") return "idle";
    var status = String(info.status || "");
    var busy = status === "saving" || status === "retrying";
    if (busy) {
      if (!cloudProgressActive) {
        cloudProgressActive = true;
        progress.start();
      }
      var pct = Number(info.attachmentProgress);
      if (isFinite(pct)) progress.set(pct / 100);
      return "busy";
    }
    if (cloudProgressActive) {
      cloudProgressActive = false;
      if (status === "failed" || status === "conflict") progress.fail();
      else progress.done();
    }
    return status || "idle";
  }

  /* ------------------------------------------------------------ live region */
  var liveRegions = { polite: null, assertive: null };
  var lastAnnouncement = { text: "", at: 0 };

  function ensureLiveRegion(kind) {
    var key = kind === "assertive" ? "assertive" : "polite";
    if (liveRegions[key] && liveRegions[key].isConnected !== false) return liveRegions[key];
    if (!doc.body) return null;
    var el = doc.createElement("div");
    el.className = "ars-sr";
    el.setAttribute("data-ars-live", key);
    el.setAttribute("role", key === "assertive" ? "alert" : "status");
    el.setAttribute("aria-live", key);
    el.setAttribute("aria-atomic", "true");
    doc.body.appendChild(el);
    liveRegions[key] = el;
    return el;
  }

  function announce(message, opts) {
    var text = String(message == null ? "" : message).trim();
    if (!text) return;
    var o = opts || {};
    var stamp = now();
    if (!o.assertive && text === lastAnnouncement.text && stamp - lastAnnouncement.at < config.announceThrottle) {
      return;
    }
    lastAnnouncement = { text: text, at: stamp };
    var region = ensureLiveRegion(o.assertive ? "assertive" : "polite");
    if (!region) return;
    region.textContent = text;
  }

  /* Loading states remain focused on navigation, operations and network state.
     User attachments are stored and downloadable, but are not rendered as images. */

  /* --------------------------------------------------------------- offline -- */
  var offlineEl = null;

  function ensureOfflineBanner() {
    if (offlineEl && offlineEl.isConnected !== false) return offlineEl;
    if (!doc.body) return null;
    offlineEl = doc.createElement("div");
    offlineEl.className = "ars-offline";
    offlineEl.setAttribute("role", "status");
    offlineEl.setAttribute("aria-live", "polite");
    offlineEl.hidden = true;
    offlineEl.innerHTML =
      '<span class="ars-offline__dot" aria-hidden="true"></span>' +
      "<span>You are offline. Cached data stays available; network actions resume when you reconnect.</span>";
    doc.body.appendChild(offlineEl);
    return offlineEl;
  }

  var offline = {
    isOffline: function () {
      return window.navigator && window.navigator.onLine === false;
    },
    show: function () {
      var el = ensureOfflineBanner();
      if (!el) return;
      el.hidden = false;
      announce("You are offline. Cached data is still available.");
    },
    hide: function () {
      var el = ensureOfflineBanner();
      if (!el) return;
      el.hidden = true;
      announce("Back online.");
    }
  };

  function initNetwork() {
    ensureOfflineBanner();
    if (offline.isOffline()) offline.show();
    window.addEventListener("online", function () {
      offline.hide();
    });
    window.addEventListener("offline", function () {
      offline.show();
    });
  }

  /* ------------------------------------------------------ boot gate loader -- */
  function enhanceBootGate() {
    var gate = doc.getElementById("cloud-gate");
    if (!gate) return;
    // index.html ships the boot bar statically so it is visible before any
    // protected script runs; this only keeps its label in sync with the real
    // bootstrap message (no fabricated phases).
    var wrap = gate.querySelector(".ars-gate-progress");
    if (!wrap) {
      var card = gate.querySelector(".cloud-card");
      if (!card) return;
      wrap = doc.createElement("div");
      wrap.className = "ars-gate-progress";
      wrap.innerHTML =
        '<div class="ars-progress" data-mode="indeterminate" role="progressbar" aria-label="Preparing your workspace">' +
        '<div class="ars-progress-track"><div class="ars-progress-fill"></div></div>' +
        '<div class="ars-progress-label"></div></div>';
      card.appendChild(wrap);
    }
    if (wrap.__arsBootBound) return;
    wrap.__arsBootBound = true;
    var labelEl = wrap.querySelector(".ars-progress-label");
    var messageEl = doc.getElementById("cloud-message");
    function syncLabel() {
      var text = messageEl && messageEl.textContent ? messageEl.textContent.trim() : "";
      if (labelEl) labelEl.textContent = text || "";
      var progress = wrap.querySelector(".ars-progress");
      if (progress) {
        if (text) progress.setAttribute("aria-valuetext", text);
        else progress.removeAttribute("aria-valuetext");
      }
    }
    syncLabel();
    if (messageEl && typeof MutationObserver === "function") {
      var obs = new MutationObserver(syncLabel);
      obs.observe(messageEl, { childList: true, characterData: true, subtree: true });
      wrap.__arsObs = obs;
    }
  }

  /* ------------------------------------------------------------------ boot -- */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    ensureTopbar();
    ensureLiveRegion("polite");
    ensureLiveRegion("assertive");
    initNetwork();
    initNavigationProgress();
    enhanceBootGate();
    rootEl.setAttribute("data-ars-loading", "ready");
  }

  var api = {
    version: "2.0.0",
    config: config,
    skeleton: skeleton,
    createSkeleton: createSkeleton,
    createCardSkeleton: createCardSkeleton,
    createTableSkeleton: createTableSkeleton,
    createChartSkeleton: createChartSkeleton,
    createProfileSkeleton: createProfileSkeleton,
    createPageLoader: createPageLoader,
    createInlineLoader: createInlineLoader,
    mount: mount,
    clear: clear,
    state: state,
    emptyState: emptyState,
    errorState: errorState,
    offlineState: offlineState,
    run: run,
    progress: progress,
    cloudStatus: cloudStatus,
    button: button,
    showButtonLoading: showButtonLoading,
    hideButtonLoading: hideButtonLoading,
    showProgressLoader: showProgressLoader,
    hideProgressLoader: hideProgressLoader,
    announce: announce,
    offline: offline,
    prefersReducedMotion: prefersReducedMotion
  };

  window.AriseLoading = api;
  window.__ARISE_LOADING_API__ = api;

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
    // The protected runtime is normally injected after the body exists; boot
    // immediately in that case so the global indicator is ready before the
    // first async operation starts.
    if (doc.body) boot();
  } else {
    boot();
  }
})();
