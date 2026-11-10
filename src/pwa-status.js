/* ==========================================================================
   PWA status (src/pwa-status.js)
   --------------------------------------------------------------------------
   The offline shell registers itself silently (src/cloud/protected-runtime.js)
   and its service worker calls skipWaiting()/clients.claim() on install, so a
   new version takes control *while the page you are looking at keeps running the
   files it already loaded*. Nothing told the user that:

     - a newer version had been installed and a reload would pick it up;
     - the shell had just changed underneath them, so a reload is what makes the
       current tab match the cache;
     - the app was offline but still fully usable from the cache, or offline with
       pages that were never cached.

   This module adds one small, non-modal status card for exactly those moments
   and nothing else. It does not duplicate the existing "you are offline" banner
   in src/loading-system.js, it never claims push support, it never blocks the
   page, and it disappears when there is nothing to say.

   Public API (window.ArisePwaStatus)
   ----------------------------------
   state()          -> { supported, phase, version, cachedCaches, dismissed }
   shellVersion()   -> "v248" (parsed from service-worker.js) or null
   check()          -> Promise<{ ok, version, error }>  (asks for an update now)
   reload()         -> reloads the page (the only action the card offers)
   dismiss()        -> hides the card until the next real event
   mount()/render() -> DOM control, used by the tests
   ========================================================================== */
(function () {
  "use strict";
  if (window.ArisePwaStatus) return;

  var CARD_ID = "pwa-status";
  var state = {
    supported: false,
    phase: "idle", // idle | ready | updated | offline | unsupported
    version: null,
    cachedCaches: 0,
    dismissed: false,
    reloading: false
  };
  var registration = null;
  var startedWithController = false;
  var booted = false;

  function sw() {
    return (window.navigator && window.navigator.serviceWorker) || null;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  // The cache name carries the shell version plus the build digest from
  // service-worker.js, so a user (or a bug report) can tell exactly which shell
  // is serving the page. Cache names are the truth about what is installed.
  function shellVersion() {
    if (state.version) return state.version;
    try {
      var names = window.__ariseSwCacheNames || [];
      for (var i = 0; i < names.length; i += 1) {
        var found = /^arise-developer-system-(v\d+[a-z0-9-]*-?[a-f0-9]*)/i.exec(names[i] || "");
        if (found) { state.version = found[1].replace(/-+$/, ""); return state.version; }
      }
    } catch {}
    return state.version;
  }

  function readCaches() {
    if (!window.caches || typeof window.caches.keys !== "function") return Promise.resolve(0);
    return window.caches.keys().then(function (names) {
      var own = (names || []).filter(function (name) { return name.indexOf("arise-developer-system-") === 0; });
      window.__ariseSwCacheNames = own;
      shellVersion();
      state.cachedCaches = own.length;
      return own.length;
    }).catch(function () { return 0; });
  }

  function online() {
    return !(window.navigator && window.navigator.onLine === false);
  }

  function setPhase(phase) {
    if (state.phase === phase) return;
    state.phase = phase;
    // A new event deserves another chance to be seen.
    if (phase === "ready" || phase === "updated" || phase === "offline") state.dismissed = false;
    render();
  }

  /* ------------------------------------------------------------------- UI -- */

  function message() {
    if (state.phase === "ready") {
      return { tone: "update", title: "A new version is ready", detail: "It was installed in the background. Reload to use it — nothing you have saved is affected.", action: "Reload" };
    }
    if (state.phase === "updated") {
      return { tone: "update", title: "Updated in the background", detail: "The newest version is serving this tab now. Reload so the page matches it.", action: "Reload" };
    }
    if (state.phase === "offline") {
      if (state.cachedCaches > 0) {
        return { tone: "offline", title: "Offline — cached shell in use", detail: "This page and its saved data came from the offline cache. Network actions resume when you reconnect.", action: null };
      }
      return { tone: "offline", title: "Offline — nothing cached yet", detail: "The offline shell has not finished caching on this device. Pages you have not opened may not load until you reconnect.", action: null };
    }
    return null;
  }

  function card() {
    return document.getElementById(CARD_ID);
  }

  function remove() {
    var node = card();
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function render() {
    var copy = state.dismissed ? null : message();
    if (!copy) { remove(); return null; }
    var node = card();
    if (!node) {
      node = document.createElement("div");
      node.id = CARD_ID;
      node.className = "pwa-status";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      node.setAttribute("aria-atomic", "true");
      document.body.appendChild(node);
    }
    node.setAttribute("data-tone", copy.tone);
    node.innerHTML =
      '<span class="pwa-status-dot" aria-hidden="true"></span>' +
      '<span class="pwa-status-text"><strong class="pwa-status-title">' + esc(copy.title) + "</strong>" +
      '<span class="pwa-status-detail">' + esc(copy.detail) + "</span></span>" +
      (copy.action ? '<button type="button" class="pwa-status-action" data-pwa-action="reload">' + esc(copy.action) + "</button>" : "") +
      '<button type="button" class="pwa-status-close" data-pwa-action="dismiss" aria-label="Dismiss this notice">&times;</button>';
    return node;
  }

  function onCardClick(event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-pwa-action]") : null;
    if (!button) return;
    var action = button.getAttribute("data-pwa-action");
    if (action === "reload") reload();
    else if (action === "dismiss") dismiss();
  }

  /* -------------------------------------------------------------- lifecycle -- */

  function watch(target) {
    if (!target || !target.addEventListener) return;
    target.addEventListener("updatefound", function () {
      var installing = target.installing;
      if (!installing) return;
      setPhase("idle");
      installing.addEventListener("statechange", function () {
        if (installing.state === "installed" && sw() && sw().controller) {
          // A previous version already controls this tab: this is a real update.
          setPhase("ready");
        }
      });
    });
  }

  function boot() {
    if (booted) return;
    booted = true;
    var api = sw();
    state.supported = !!api;
    if (!api) {
      state.phase = "unsupported";
      return;
    }
    startedWithController = !!api.controller;
    if (api.addEventListener) {
      api.addEventListener("controllerchange", function () {
        // The very first claim (no controller at load) is the install, not an
        // update, and reloading for it would lose an in-progress session.
        if (!startedWithController) { startedWithController = true; return; }
        setPhase("updated");
      });
    }
    var adopt = function (reg) {
      if (!reg) return null;
      registration = reg;
      watch(reg);
      // An update may already be waiting when this script runs.
      if (reg.waiting && api.controller) setPhase("ready");
      return reg;
    };
    if (typeof api.getRegistration === "function") {
      api.getRegistration().then(adopt).catch(function () {});
    }
    if (api.ready) api.ready.then(adopt).catch(function () {});
    readCaches().then(refreshConnectivity);
    document.addEventListener("click", onCardClick, true);
    window.addEventListener("online", refreshConnectivity);
    window.addEventListener("offline", refreshConnectivity);
    // Returning to a backgrounded tab is the natural moment to look for updates.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) check();
    });
    // Ask for the extended shell once the page is idle, as before, but now the
    // status card can report whether it worked.
    setTimeout(readCaches, 4000);
  }

  function refreshConnectivity() {
    if (!state.supported) return;
    if (!online()) {
      readCaches().then(function () { setPhase("offline"); });
      return;
    }
    // Back online: an update notice may still be waiting; otherwise stand down.
    if (registration && registration.waiting && sw() && sw().controller) setPhase("ready");
    else if (state.phase === "offline") setPhase("idle");
  }

  function check() {
    var api = sw();
    if (!api) return Promise.resolve({ ok: false, error: "unsupported" });
    var target = registration || (typeof api.getRegistration === "function" ? api.getRegistration() : Promise.resolve(null));
    return Promise.resolve(target).then(function (reg) {
      if (!reg) return { ok: false, error: "not registered" };
      registration = reg;
      watch(reg);
      if (typeof reg.update !== "function") return { ok: false, error: "update unavailable" };
      return reg.update().then(function () {
        if (reg.waiting && api.controller) setPhase("ready");
        return readCaches().then(function () {
          return { ok: true, version: state.version, waiting: !!reg.waiting };
        });
      });
    }).catch(function (error) {
      return { ok: false, error: (error && error.message) || "update failed" };
    });
  }

  function reload() {
    state.reloading = true;
    try { remove(); } catch {}
    try {
      window.location.reload();
      return true;
    } catch {
      // jsdom and locked-down browsers throw here; the caller can still see it.
      return false;
    }
  }

  function dismiss() {
    state.dismissed = true;
    remove();
    return true;
  }

  function api() {
    return {
      supported: state.supported,
      phase: state.phase,
      version: state.version,
      cachedCaches: state.cachedCaches,
      dismissed: state.dismissed,
      reloading: state.reloading,
      card: !!card(),
      message: state.dismissed ? null : message()
    };
  }

  window.ArisePwaStatus = {
    state: api,
    shellVersion: shellVersion,
    check: check,
    reload: reload,
    dismiss: dismiss,
    render: render,
    mount: function () { boot(); return render(); },
    refreshConnectivity: refreshConnectivity,
    readCaches: readCaches
  };

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
