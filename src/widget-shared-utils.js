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

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /**
   * Canonical "which day was this for the user" key: the LOCAL calendar date
   * as YYYY-MM-DD.
   *
   * The previous implementation returned an unpadded string
   * ("2026-1-9"). That is not a sortable or comparable day key: as a plain
   * string "2026-1-9" sorts AFTER "2026-1-10" because "9" > "1", so every
   * lexicographic sort/compare/bucket lookup on a day key was wrong for
   * January-September, and any label rendered from it lost its alignment.
   * Zero padding fixes that without changing the meaning of the key.
   *
   * Consumers that only ever use the key as an opaque map key are unaffected;
   * consumers that compare, sort, or display it are corrected.
   */
  function dayKey(d) {
    var date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date.getTime())) return "";
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  /** UTC calendar date as YYYY-MM-DD. Needed to read legacy records that were
   *  written with `toISOString().split("T")[0]` (which is UTC, not local). */
  function utcDayKey(d) {
    var date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  /** Parse a YYYY-MM-DD key back to LOCAL midnight (never via `new Date("...")`,
   *  which parses a bare date as UTC midnight and can shift the day backwards
   *  in negative-offset timezones). Returns null for anything unparseable. */
  function dayKeyToDate(key) {
    if (typeof key !== "string") return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    var date = new Date(y, mo - 1, da);
    date.setHours(0, 0, 0, 0);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== da) return null;
    return date;
  }

  /** True when two timestamps/Date objects/keys fall on the same local day. */
  function isSameLocalDay(a, b) {
    var ka = typeof a === "string" ? a : dayKey(a);
    var kb = typeof b === "string" ? b : dayKey(b);
    return !!ka && ka === kb;
  }

  /** Whole local days from `from` to `to` (DST-safe: compares calendar days,
   *  not elapsed milliseconds, so a 23h/25h clock-change day still counts as 1). */
  function daysBetween(from, to) {
    var a = new Date(startOfDay(from instanceof Date ? from : new Date(from)));
    var b = new Date(startOfDay(to instanceof Date ? to : new Date(to)));
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return NaN;
    var utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcB - utcA) / 86400000);
  }

  /** Short human label for a day, e.g. "9 Feb 2026". Widgets used to store a
   *  raw day key as a *display* string ("2026-2-9"), which reads as machine
   *  output in the UI. Storage keys and labels are now separate concerns. */
  function weekLabel(d) {
    var date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date.getTime())) return "";
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear();
  }

  function startOfDay(d) {
    var date = d instanceof Date ? d : new Date(d);
    if (!date || isNaN(date.getTime())) return NaN;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
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
    if (!flushTimer) flushTimer = setTimeout(flushQueue, 16);
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
          "#upp-command-overlay, #upp-shortcuts-overlay, #upp-health-overlay, #arise-page-widget-bar, #arise-scroll-top-btn, .recharts-tooltip-wrapper, .lhm-tooltip, #arise-shared-toast"
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

  var remoteStorageQueued = false;
  function runAllUpdaters() {
    remoteStorageQueued = false;
    for (var i = 0; i < registeredUpdaters.length; i++) {
      registeredUpdaters[i]();
    }
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
      if (updaterCoalescers.length) scheduleUpdaterCoalescers();
    });
    window.addEventListener("storage", function (ev) {
      if (ev && ev.__ariseRemote) {
        if (!remoteStorageQueued) {
          remoteStorageQueued = true;
          if (typeof queueMicrotask === "function") queueMicrotask(runAllUpdaters);
          else Promise.resolve().then(runAllUpdaters);
        }
        return;
      }
      runAllUpdaters();
    });
  }

  /**
   * Wrap a full-document updater so many widgets running it for the same burst
   * of mutations cost one pass, not one pass per widget.
   *
   * Measured before this helper existed (5 mounted widgets, 25 content
   * mutations on a dashboard-sized DOM): 51 document-level querySelectorAll
   * calls returning 25,092 elements, purely from widgets rescanning the whole
   * document in response to each other's DOM writes. These updaters are
   * idempotent (they rewrite a signature-checked section), so collapsing a
   * burst into a single trailing run is behaviour-preserving - it only removes
   * duplicated work inside the same ~80ms window.
   *
   * `bus.mute()` is deliberately NOT used here: mute() drains and discards the
   * observer's pending records, which would swallow legitimate sibling widget
   * updates. registerUpdaterCoalescer() stays purely timing based.
   */
  function bootUpdater(fn) {    function start() {
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

  var updaterCoalescers = [];
  var coalescerQueued = false;

  /** See bootUpdater(): register a whole-document updater that several widgets
   *  would otherwise each run for the same mutation burst. */
  function registerUpdaterCoalescer(fn) {
    if (typeof fn !== "function" || updaterCoalescers.indexOf(fn) !== -1) return;
    updaterCoalescers.push(fn);
  }

  function runUpdaterCoalescers() {
    coalescerQueued = false;
    if (document.hidden) return;
    var pending = updaterCoalescers.slice();
    for (var i = 0; i < pending.length; i++) {
      try {
        pending[i]();
      } catch (err) {
        (function (ex) {
          setTimeout(function () { throw ex; });
        })(err);
      }
    }
  }

  function scheduleUpdaterCoalescers() {
    if (coalescerQueued) return;
    coalescerQueued = true;
    setTimeout(runUpdaterCoalescers, 80);
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

  /**
   * Inline indeterminate bar for widget-level operations (Competitive
   * Programming "sync all platforms" is the current consumer). When the shared
   * loading system is present it renders the v2 progress component — same
   * lifecycle, same insertion rules, but an accessible progressbar instead of a
   * bare strip. It never sets aria-busy on the host: widgets that re-render over
   * themselves would otherwise be left permanently busy.
   */
  function setIndeterminateBar(host, isActive, opts) {
    if (!host) return;
    opts = opts || {};
    var loading = window.AriseLoading;
    var useV2 = !!(loading && typeof loading.createInlineLoader === "function");
    var cur = host.querySelector("[data-uxa-indeterminate-bar]");
    if (isActive) {
      if (cur) return;
      var bar = document.createElement("div");
      bar.setAttribute("data-uxa-indeterminate-bar", "1");
      if (useV2) {
        bar.className = "ars-progress";
        bar.setAttribute("data-mode", "indeterminate");
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-label", opts.label || "Working");
        bar.innerHTML =
          '<div class="ars-progress-track"><div class="ars-progress-fill"></div></div>';
      } else {
        bar.className = "uxa-progress-track";
        bar.setAttribute("role", "status");
        bar.setAttribute("aria-live", "polite");
        bar.setAttribute("aria-label", opts.label || "Working");
        bar.innerHTML =
          '<span class="uxa-sr-only">' + escapeText(opts.label || "Working") + '</span><div class="uxa-progress-fill-indeterminate" aria-hidden="true"></div>';
      }
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
    utcDayKey: utcDayKey,
    weekLabel: weekLabel,
    dayKeyToDate: dayKeyToDate,
    isSameLocalDay: isSameLocalDay,
    daysBetween: daysBetween,
    startOfDay: startOfDay,
    highestCrossed: highestCrossed,
    bootUpdater: bootUpdater,
    registerUpdaterCoalescer: registerUpdaterCoalescer,
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
