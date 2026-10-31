(function () {
  if (window.__ARISE_WIDGET_UTILS__) return;

  function safeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function highestCrossed(val, thresholds) {
    var best = null;
    for (var i = 0; i < thresholds.length; i++) {
      if (val >= thresholds[i]) best = thresholds[i];
    }
    return best;
  }

  var TOAST_ID = "arise-shared-toast";
  var toastTimer = null;

  function ensureToastStyle() {
    if (document.getElementById("arise-shared-toast-style")) return;
    var css =
      "#" + TOAST_ID + "{" +
      "position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);" +
      "background:color-mix(in srgb,var(--surface,#131722) 94%,transparent);color:var(--text-primary,#fff);" +
      "border:1px solid var(--border-strong,var(--border,rgba(255,255,255,.14)));" +
      "padding:.6rem 1.05rem;border-radius:999px;box-shadow:0 12px 32px rgba(0,0,0,.32);" +
      "-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);" +
      "font-size:.8rem;font-weight:600;letter-spacing:-0.01em;opacity:0;pointer-events:none;" +
      "transition:opacity var(--motion-medium, 180ms) var(--ease-standard, cubic-bezier(0.2,0,0,1)),transform var(--motion-medium, 180ms) var(--ease-standard, cubic-bezier(0.2,0,0,1));" +
      "z-index:99999;max-width:90vw;text-align:center}" +
      "#" + TOAST_ID + ".arise-shared-toast-visible{opacity:1;transform:translateX(-50%) translateY(0)}" +
      "#" + TOAST_ID + ".arise-shared-toast-danger{border-color:color-mix(in srgb,var(--danger,#ef4444) 55%,var(--border));color:var(--danger,#ef4444)}" +
      "#" + TOAST_ID + ".arise-shared-toast-success{border-color:color-mix(in srgb,var(--success,#10b981) 50%,var(--border));color:var(--success,#10b981)}" +
      "@media (prefers-reduced-motion: reduce){#" + TOAST_ID + "{transform:translateX(-50%)}}" ;
    var s = document.createElement("style");
    s.id = "arise-shared-toast-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function showToast(msg, tone) {
    try {
      var body = document.body;
      if (!body) return;
      ensureToastStyle();
      var el = document.getElementById(TOAST_ID);
      if (!el) {
        el = document.createElement("div");
        el.id = TOAST_ID;
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        body.appendChild(el);
      }
      el.textContent = msg;
      el.className = "arise-shared-toast-visible" + (tone ? " arise-shared-toast-" + tone : "");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        el.className = "";
      }, 4000);
    } catch {}
  }

  function isQuotaErr(err) {
    if (!err) return false;
    if (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
    return err.code === 22 || err.code === 1014;
  }

  function safeSet(key, val, opts) {
    opts = opts || {};
    var str;
    try {
      str = typeof val === "string" ? val : JSON.stringify(val);
    } catch {
      return false;
    }
    try {
      localStorage.setItem(key, str);
      return true;
    } catch (err) {
      if (isQuotaErr(err)) {
        showToast(
          opts.quotaMessage ||
            "Storage is full — this change wasn't saved. Export a backup from Backup Center, then free up space.",
          "danger"
        );
      } else if (opts.showErrors !== false) {
        showToast(opts.errorMessage || "Couldn't save that change.", "danger");
      }
      return false;
    }
  }

  function readVersioned(key, opts) {
    opts = opts || {};
    var targetVer = opts.version || 1;
    var migrations = opts.migrations || {};
    var raw = safeGet(key, undefined);
    if (raw === undefined) {
      return { value: opts.fallback, version: targetVer, migrated: false };
    }
    var cur = raw;
    var ver = cur && typeof cur === "object" && typeof cur.__schemaVersion === "number" ? cur.__schemaVersion : 0;
    var migrated = false;
    while (ver < targetVer) {
      var fn = migrations[ver];
      if (typeof fn !== "function") break;
      cur = fn(cur);
      ver += 1;
      migrated = true;
    }
    if (cur && typeof cur === "object" && !Array.isArray(cur)) {
      cur.__schemaVersion = ver;
    }
    return { value: cur, version: ver, migrated: migrated };
  }

  // Consolidated, frame-budgeted updater queue shared by all bootUpdater widgets
  var queue = [];
  var flushTimer = 0;
  var registeredUpdaters = [];
  var sharedBusSubscribed = false;

  function flushQueue() {
    flushTimer = 0;
    var start = performance.now();
    var bus = window.__ARISE_MUTATION_BUS__;
    while (queue.length) {
      var fn = queue.shift();
      try {
        if (bus && bus.mute) bus.mute(fn);
        else fn();
      } catch (err) {
        (function (ex) {
          setTimeout(function () { throw ex; });
        })(err);
      }
      // Yield to browser before exceeding a 10ms slice so input/scroll stays responsive
      if (queue.length && performance.now() - start > 10) {
        flushTimer = setTimeout(flushQueue, 16);
        return;
      }
    }
  }

  function enqueueUpdater(fn) {
    if (queue.indexOf(fn) === -1) queue.push(fn);
    if (!flushTimer) flushTimer = setTimeout(flushQueue, 150);
  }

  function hasStructuralContentMutation(records) {
    if (!Array.isArray(records) || !records.length) return true;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var t = rec.target;
      if (
        t &&
        t.closest &&
        t.closest(
          "#upp-command-overlay, #upp-shortcuts-overlay, #upp-health-overlay, #arise-page-widget-bar, #arise-scroll-top-btn, .recharts-tooltip-wrapper, #arise-shared-toast"
        )
      ) {
        continue;
      }
      var added = rec.addedNodes;
      if (added && added.length) {
        for (var j = 0; j < added.length; j++) {
          if (added[j] && added[j].nodeType === 1) return true;
        }
      }
      var removed = rec.removedNodes;
      if (removed && removed.length) {
        for (var k = 0; k < removed.length; k++) {
          if (removed[k] && removed[k].nodeType === 1) return true;
        }
      }
    }
    return false;
  }

  function ensureSharedSubscription() {
    if (sharedBusSubscribed) return;
    if (!window.__ARISE_MUTATION_BUS__ || typeof window.__ARISE_MUTATION_BUS__.subscribe !== "function") return;
    sharedBusSubscribed = true;
    window.__ARISE_MUTATION_BUS__.subscribe(function (records) {
      if (document.hidden) return;
      if (!hasStructuralContentMutation(records)) return;
      for (var i = 0; i < registeredUpdaters.length; i++) {
        enqueueUpdater(registeredUpdaters[i]);
      }
    });
    window.addEventListener("storage", function () {
      for (var i = 0; i < registeredUpdaters.length; i++) {
        registeredUpdaters[i]();
      }
    });
  }

  function bootUpdater(fn) {
    function start() {
      fn();
      if (registeredUpdaters.indexOf(fn) === -1) registeredUpdaters.push(fn);
      ensureSharedSubscription();
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  function escapeText(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // HTML escaping alone does not make a URL safe. Validate at the render
  // boundary without rewriting the user's stored Markdown or link fields.
  function safeURL(value, opts) {
    if (typeof value !== "string") return "";
    var text = value.trim();
    if (!text || /[\u0000-\u001f\u007f]/.test(text)) return "";
    try {
      var url = new URL(text, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:" &&
          !(opts && opts.allowMailto && url.protocol === "mailto:")) return "";
      if (url.username || url.password) return "";
      return url.href;
    } catch (_) { return ""; }
  }

  function prefersReducedMotion() {
    if (document.documentElement && document.documentElement.classList.contains("perf-lite")) return true;
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function smoothScroll(el, opts) {
    if (!el || typeof el.scrollIntoView !== "function") return;
    var options = Object.assign({ block: "center" }, opts || {});
    options.behavior = prefersReducedMotion() ? "auto" : (options.behavior || "smooth");
    try {
      el.scrollIntoView(options);
    } catch (_) {
      try { el.scrollIntoView(); } catch (__e) {}
    }
  }

  function setHTMLIfChanged(el, sig, html) {
    if (!el) return false;
    var key = String(sig == null ? html : sig);
    if (el.__uxaLastSig === key && el.childNodes.length > 0) return false;
    el.__uxaLastSig = key;
    el.innerHTML = html;
    return true;
  }

  function loadingHTML(label, opts) {
    opts = opts || {};
    var sz = opts.size || "md";
    var szCls = sz === "sm" ? " uxa-spinner-sm" : sz === "lg" ? " uxa-spinner-lg" : "";
    var extra = opts.className ? " " + opts.className : "";
    var inline = opts.inline ? " uxa-loading-state-inline" : "";
    var safeLabel = escapeText(label).replace(/&lt;(\/?b)&gt;/g, "<$1>");
    return (
      '<div class="uxa-loading-state' + inline + extra + '" role="status" aria-live="polite" aria-busy="true">' +
      '<span class="uxa-spinner' + szCls + '" aria-hidden="true"></span>' +
      '<span class="uxa-loading-label">' + safeLabel + "</span></div>"
    );
  }

  function skeletonCardsHTML(count, opts) {
    opts = opts || {};
    var sub = opts.sub !== false;
    var out = "";
    for (var i = 0; i < count; i++) {
      out +=
        '<div class="uxa-skeleton-card uxa-skeleton-group" aria-hidden="true">' +
        '<div class="uxa-skeleton uxa-skeleton-text uxa-skeleton-w-40"></div>' +
        '<div class="uxa-skeleton uxa-skeleton-metric-value"></div>' +
        (sub ? '<div class="uxa-skeleton uxa-skeleton-text uxa-skeleton-w-55"></div>' : "") +
        "</div>";
    }
    return out;
  }

  function skeletonProfileHTML(opts) {
    opts = opts || {};
    var avatar = opts.avatar !== false;
    return (
      '<div class="uxa-skeleton-profile" aria-hidden="true"><div class="uxa-skeleton-group uxa-skeleton-profile-group">' +
      (avatar ? '<div class="uxa-skeleton uxa-skeleton-avatar"></div>' : "") +
      '<div class="uxa-skeleton-profile-info">' +
      '<div class="uxa-skeleton uxa-skeleton-text uxa-skeleton-w-40" style="height:1.05rem"></div>' +
      '<div class="uxa-skeleton uxa-skeleton-text uxa-skeleton-w-60"></div>' +
      "</div></div></div>"
    );
  }

  function setButtonLoading(btn, isLoading, opts) {
    if (!btn) return;
    opts = opts || {};
    if (isLoading) {
      if (btn.getAttribute("data-uxa-original-html") == null) {
        btn.setAttribute("data-uxa-original-html", btn.innerHTML);
        btn.setAttribute("data-uxa-original-minw", btn.style.minWidth || "");
        var w = btn.offsetWidth;
        if (w > 0) btn.style.minWidth = w + "px";
      }
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.setAttribute("aria-disabled", "true");
      btn.classList.add("uxa-btn-loading");
      var label = opts.label != null ? opts.label : btn.textContent.trim();
      btn.innerHTML = '<span class="uxa-spinner uxa-spinner-sm" aria-hidden="true"></span><span>' + escapeText(label) + "</span>";
    } else {
      btn.disabled = !!opts.disabled;
      btn.removeAttribute("aria-busy");
      btn.removeAttribute("aria-disabled");
      btn.classList.remove("uxa-btn-loading");
      var orig = btn.getAttribute("data-uxa-original-html");
      if (orig != null) {
        btn.innerHTML = orig;
        btn.style.minWidth = btn.getAttribute("data-uxa-original-minw") || "";
        btn.removeAttribute("data-uxa-original-html");
        btn.removeAttribute("data-uxa-original-minw");
      }
    }
  }

  function setIndeterminateBar(host, isActive, opts) {
    if (!host) return;
    opts = opts || {};
    var cls = "uxa-progress-track";
    var cur = host.querySelector("." + cls);
    if (isActive) {
      if (cur) return;
      var bar = document.createElement("div");
      bar.className = cls;
      bar.setAttribute("role", "status");
      bar.setAttribute("aria-live", "polite");
      bar.setAttribute("aria-label", opts.label || "Working");
      bar.innerHTML = '<span class="uxa-sr-only">' + escapeText(opts.label || "Working") + '</span><div class="uxa-progress-fill-indeterminate" aria-hidden="true"></div>';
      if (opts.after && opts.after.parentNode === host) {
        opts.after.insertAdjacentElement("afterend", bar);
      } else {
        host.appendChild(bar);
      }
    } else if (cur && cur.parentNode) {
      cur.parentNode.removeChild(cur);
    }
  }

  var cachedSheetsPromise = null;
  var cachedFetchRef = null;
  var sheetsInFlight = null;

  /** The sheets dataset is shared by DSA, coverage, search and command palette.
   * Coalesce concurrent retries, bound both fetch and JSON parsing, and never
   * let an obsolete request invalidate a newer request or a good cached value. */
  function fetchInterviewSheets(opts) {
    opts = opts || {};
    if (typeof fetch !== "function") return Promise.resolve(null);
    var fetchImpl = fetch;
    if (cachedFetchRef !== fetchImpl) {
      if (sheetsInFlight && sheetsInFlight.cancel) sheetsInFlight.cancel();
      cachedFetchRef = fetchImpl;
      cachedSheetsPromise = null;
      sheetsInFlight = null;
    }
    if (sheetsInFlight) return sheetsInFlight.promise;
    if (!opts.force && cachedSheetsPromise) return cachedSheetsPromise;

    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timeout = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 12000;
    var request = {};
    sheetsInFlight = request;
    request.promise = new Promise(function (resolve) {
      var finished = false;
      var timer = setTimeout(function () {
        if (ctrl) { try { ctrl.abort(); } catch (_) {} }
        finish(null);
      }, timeout);
      function finish(value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // A different fetch implementation/request may have replaced this one.
        if (sheetsInFlight !== request) return resolve(null);
        sheetsInFlight = null;
        var valid = value && typeof value === "object" && !Array.isArray(value);
        if (valid) cachedSheetsPromise = Promise.resolve(value);
        // A failed refresh must not evict the last usable cached dataset.
        resolve(valid ? value : null);
      }
      request.cancel = function () {
        if (ctrl) { try { ctrl.abort(); } catch (_) {} }
        finish(null);
      };
      Promise.resolve()
        .then(function () {
          return fetchImpl("./assets/interview_sheets_data.json", ctrl
            ? { cache: "force-cache", signal: ctrl.signal }
            : { cache: "force-cache" });
        })
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(finish, function () { finish(null); });
    });
    return request.promise;
  }

  window.__ARISE_WIDGET_UTILS__ = {
    safeGet: safeGet,
    safeSet: safeSet,
    showToast: showToast,
    readVersioned: readVersioned,
    dayKey: dayKey,
    startOfDay: startOfDay,
    highestCrossed: highestCrossed,
    bootUpdater: bootUpdater,
    safeURL: safeURL,
    prefersReducedMotion: prefersReducedMotion,
    smoothScroll: smoothScroll,
    setHTMLIfChanged: setHTMLIfChanged,
    loadingHTML: loadingHTML,
    skeletonCardsHTML: skeletonCardsHTML,
    skeletonProfileHTML: skeletonProfileHTML,
    setButtonLoading: setButtonLoading,
    setIndeterminateBar: setIndeterminateBar,
    fetchInterviewSheets: fetchInterviewSheets
  };
  window.__ariseShared = window.__ARISE_WIDGET_UTILS__;
  if (!window.__ariseQuotaToastBound) {
    window.__ariseQuotaToastBound = true;
    window.addEventListener("arise:storage-quota", function () {
      showToast(
        "Storage is full — this change wasn't saved. Export a backup from Backup Center, then free up space.",
        "danger"
      );
    });
  }
})();
