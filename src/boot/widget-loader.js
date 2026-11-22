/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
// Widget loader. The ~126 widget scripts self-mount through window.__mountX
// contracts read by the React shell (and a couple intentionally redefine the
// same global, e.g. __mountLocalFiles), so their execution order must stay
// exactly the manifest order. They are delivered as 12 generated chunks.
//
// 2026-11 performance pass — route-scoped startup:
// the page used to fetch AND execute all 12 chunks (~2.8 MB raw) immediately
// after boot, although the default Dashboard only mounts widgets from the first
// three. On a mid-range phone over Fast 3G that measured ~10 s of competing
// network/compile work, 2-3 s of total blocking time and ~1 s of click latency
// before the app was interactive. The loader now:
//   stage 1  executes the manifest `core` chunks (shared runtime + default
//            Dashboard widgets) first, in order;
//   stage 2  executes the remaining chunks one at a time during browser idle
//            time, in manifest order, so they never sit on the critical path;
//   demand   any chunk whose widget the shell asks for jumps the queue
//            (window.__ariseLoadForMount) together with the earlier chunks that
//            have not executed yet, so the manifest order every widget relies on
//            is preserved while opening a route never waits for unrelated work.
// Execution order, failure handling, retry hooks and the source-file fallback
// are unchanged; __ariseExpedite() still loads everything immediately for the
// capture/verification scripts.
(function () {
  "use strict";
  var CSS_FILES = [
    "./styles/widget-nav.css",
    "./styles/premium-productivity-features.css",
    "./styles/features/placement-tracker/placement-tracker.css",
    "./styles/features/certificates/certificates.css",
    "./styles/theme-quick-toggle.css"
  ];
  var __ariseManifest = JSON.parse(document.getElementById("arise-widget-manifest").textContent);
  var SCRIPTS = __ariseManifest.scripts;
  var CHUNKS = __ariseManifest.chunks;
  var CHUNK_FILES = __ariseManifest.chunkFiles;
  var CORE_CHUNKS = Array.isArray(__ariseManifest.core) ? __ariseManifest.core : [];
  var MOUNT_CHUNKS = __ariseManifest.mountChunks || null;

  function loadCss() {
    CSS_FILES.forEach(function (href) {
      if (document.querySelector('link[href="' + href + '"]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  // Stability patch: a script that 404s or throws during parsing used to
  // fail completely silently - the loader just moved on, so a broken
  // widget file would only ever be noticed if a user happened to click
  // into that specific tab and reported it. This collects failures (and,
  // if window.__ariseReportWidgetError is defined elsewhere, reports
  // them) without changing load order, load timing, or which scripts get
  // skipped - purely additive visibility.
  var failedWidgetScripts = [];
  window.__ariseWidgetLoadFailures = failedWidgetScripts;

  // v222: EXPEDITE. Sections the user opens render as empty shells until their
  // widget script has run. Per-mount demand loading (below) means most of that
  // is now handled by loading just the chunk a route needs, but the documented
  // "load everything now" switch is still supported: it is what the loading
  // capture + verification scripts call, and what a queued interaction asked
  // for before per-mount demand existed.
  var bootReady = false;
  var expedite = false;
  var startFn = null;
  window.__ariseExpedite = function () {
    if (window.__ariseWidgetsSettled) return;
    expedite = true;
    if (!bootReady) return;
    if (!window.__ariseLazyWidgetsStarted) {
      if (startFn) startFn();
      return;
    }
    expediteAll();
  };

  // A real user is present. Do not jump to loading every chunk (that used to
  // make the first click download ~0.7 MB of JS on a slow connection); just let
  // the background prefetch continue without waiting for a long idle window.
  var lastInteractionAt = 0;
  function noteInteraction() {
    lastInteractionAt = Date.now();
    if (prefetchStarted && !expedite) urgentUntil = Math.max(urgentUntil, Date.now() + 1200);
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, noteInteraction, { passive: true, capture: true });
  });

  // A request that never fires load/error must not strand an entire route.
  // Removing a timed-out script also releases the ordered script queue so the
  // source-file fallback can run. Completion is guarded against late events.
  function injectWidgetScript(src, onLoad, onFailure) {
    var script = document.createElement("script");
    var done = false;
    var timer = setTimeout(function () {
      finish(false, "timed out");
    }, 12000);
    function finish(ok, reason) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (!ok && script.parentNode) script.parentNode.removeChild(script);
      if (ok) onLoad();
      else onFailure(reason);
    }
    script.src = src;
    script.async = false;
    script.onload = function () {
      finish(true);
    };
    script.onerror = function () {
      finish(false, "failed");
    };
    document.body.appendChild(script);
  }

  function rememberWidgetFailure(src) {
    if (failedWidgetScripts.indexOf(src) === -1) failedWidgetScripts.push(src);
    console.error("[widget-loader] failed to load: " + src);
    if (typeof window.__ariseReportWidgetError === "function") {
      try {
        window.__ariseReportWidgetError(src);
      } catch (e) {}
    }
  }

  // Documented retry hook (see src/reliability-watch.js). A chunk that failed
  // once stays missing for the rest of the session unless the whole page is
  // reloaded; this injects that one script again, with the same ordered
  // execution guarantee and the same source-file fallback, and reports the
  // outcome through the resolved promise. It never touches modules that
  // already loaded.
  window.__ariseLoadModule = function (src) {
    if (!src) return Promise.resolve(false);
    var index = SCRIPTS.indexOf(src) === -1 ? CHUNKS.indexOf(src) : -1;
    var isChunk = index !== -1;
    if (!isChunk && SCRIPTS.indexOf(src) === -1) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        var failures = failedWidgetScripts;
        var at = failures.indexOf(src);
        if (ok && at !== -1) failures.splice(at, 1);
        if (ok) {
          try {
            if (typeof window.__ariseFlushReadyMounts === "function")
              window.__ariseFlushReadyMounts();
          } catch (e) {}
          try {
            window.dispatchEvent(new CustomEvent("arise:module-retried", { detail: { src: src } }));
          } catch (e) {}
        }
        resolve(ok);
      }
      function failed(reason) {
        rememberWidgetFailure(src);
        // A chunk has a source-file fallback for exactly this case.
        var parts = isChunk ? CHUNK_FILES[src] : null;
        if (parts && parts.length) {
          var n = parts.length,
            okAll = true;
          parts.forEach(function (file) {
            injectWidgetScript(
              file,
              function () {
                if (--n === 0) done(okAll);
              },
              function () {
                okAll = false;
                rememberWidgetFailure(file);
                if (--n === 0) done(false);
              }
            );
          });
          return;
        }
        done(false);
      }
      injectWidgetScript(
        src,
        function () {
          done(true);
        },
        failed
      );
    });
  };

  // Native preload shares the script request even when HTTP caching is
  // disabled. fetch().arrayBuffer() used to allocate unused copies and
  // could download every chunk twice. Execution still happens in the queue
  // below, so order is unaffected.
  var preloaded = Object.create(null);
  function prewarm(urls) {
    urls.forEach(function (url) {
      if (preloaded[url]) return;
      preloaded[url] = true;
      var link = document.createElement("link");
      link.rel = "preload";
      link.setAttribute("as", "script");
      link.href = url;
      link.fetchPriority = "low";
      document.head.appendChild(link);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Route-scoped chunk scheduler                                           */
  /* ---------------------------------------------------------------------- */
  var chunkState = Object.create(null); // url -> "done" | "failed"
  var pendingChunks = []; // urls waiting to be injected, manifest/priority order
  var inFlight = null;
  var pumping = false;
  var settled = false;
  var coreDone = false;
  var prefetchStarted = false;
  var urgentUntil = 0;
  var earlyDemand = [];
  var idleHandle = null;
  // Background chunks (routes the user has not opened) are executed at a
  // deliberately low rate. The startup chunks and every on-demand request jump
  // this queue. Slow / low-core devices wait longer: their main thread is the
  // bottleneck, and executing nine unused chunks during the first seconds is
  // exactly what used to push interaction latency past 500 ms.
  var lowPower =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    false;
  var BACKGROUND_GAP = lowPower ? 1500 : 400;

  var idle =
    typeof window.requestIdleCallback === "function"
      ? function (fn, timeout) {
          return window.requestIdleCallback(fn, { timeout: timeout || 800 });
        }
      : function (fn) {
          return setTimeout(fn, 60);
        };

  function flushReadyMounts() {
    try {
      if (typeof window.__ariseFlushReadyMounts === "function") window.__ariseFlushReadyMounts();
    } catch (e) {}
  }

  // "Widgets ready" means the widgets of the current screen are in place —
  // that is what every listener of this event needs (scans, toolbar, shortcuts,
  // theme controls). Background route chunks keep arriving afterwards and are
  // announced separately. Waiting for all of them used to hold those features
  // back until the last unseen route had been downloaded and compiled.
  function notifyCoreReady() {
    if (coreDone) return;
    coreDone = true;
    window.__ariseCoreWidgetsReady = true;
    window.__ariseCoreWidgetsReadyAt = Math.round(performance.now());
    try {
      window.dispatchEvent(new Event("arise:core-widgets-ready"));
    } catch (e) {}
    if (!window.__ariseWidgetsReady) {
      window.__ariseWidgetsReady = true;
      window.__ariseWidgetsReadyAt = window.__ariseCoreWidgetsReadyAt;
      try {
        window.dispatchEvent(new Event("arise:widgets-ready"));
      } catch (e) {}
    }
  }

  // Demand loads keep the manifest order that the sequential loader always
  // guaranteed: the target chunk is queued behind every earlier chunk that has
  // not executed yet. Widget files read globals defined by earlier files at load
  // time (sometimes through local aliases of `window`, which no static scan can
  // see reliably), so skipping ahead would risk initialising a module before its
  // dependencies. Background fetches already put those bytes in the HTTP cache,
  // so the ordered steps are cheap.
  function enqueueThrough(url, urgent) {
    var end = CHUNKS.indexOf(url);
    if (end === -1) return;
    var list = [];
    for (var i = 0; i <= end; i++) {
      var item = CHUNKS[i];
      if (chunkState[item]) continue;
      var at = pendingChunks.indexOf(item);
      if (at !== -1) {
        if (!urgent) continue; // already queued and in order
        pendingChunks.splice(at, 1);
      } else if (item === inFlight) {
        continue;
      }
      list.push(item);
    }
    if (!list.length) return;
    if (urgent) {
      pendingChunks = list.concat(pendingChunks);
      urgentUntil = Math.max(urgentUntil, Date.now() + 1200);
    } else {
      pendingChunks = pendingChunks.concat(list);
    }
  }

  function expediteAll() {
    enqueueThrough(CHUNKS[CHUNKS.length - 1], true);
    urgentUntil = 0;
    pumpChunks();
  }

  function allChunksAttempted() {
    for (var i = 0; i < CHUNKS.length; i++) if (!chunkState[CHUNKS[i]]) return false;
    return true;
  }

  function maybeSettle() {
    if (settled || pumping || pendingChunks.length) return;
    if (!allChunksAttempted()) return;
    settled = true;
    window.__ariseWidgetsSettled = true;
    window.__ariseAllWidgetsSettledAt = Math.round(performance.now());
    try {
      if (typeof window.__ariseFlushMounts === "function") window.__ariseFlushMounts();
    } catch (e) {}
    if (!window.__ariseWidgetsReady) notifyCoreReady();
    try {
      window.dispatchEvent(new Event("arise:widgets-settled"));
    } catch (e) {}
    setTimeout(function () {
      try {
        var c = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (c) c.postMessage({ type: "arise-fill-cache" });
      } catch (e) {}
    }, 5000);
  }

  // A connection that drops mid-payload must not leave the routes that never
  // executed un-mountable for the rest of the session. When the browser reports
  // that the network is back, every chunk that failed is cleared from the
  // "failed" state and re-queued in manifest order; without this the only
  // recovery was a full page reload. Settle state is left alone on purpose so
  // listeners that already ran for "all chunks attempted" are not told twice.
  var onlineRetryBound = false;
  function bindOnlineRetry() {
    if (onlineRetryBound || typeof window.addEventListener !== "function") return;
    onlineRetryBound = true;
    window.addEventListener("online", function () {
      var requeued = false;
      for (var i = 0; i < CHUNKS.length; i++) {
        var url = CHUNKS[i];
        if (chunkState[url] !== "failed") continue;
        delete chunkState[url];
        if (url !== inFlight && pendingChunks.indexOf(url) === -1) pendingChunks.push(url);
        requeued = true;
      }
      if (!requeued) {
        // Legacy source-file path: re-inject whatever failed, in list order.
        if (failedWidgetScripts.length && typeof window.__ariseRetryWidgetScripts === "function")
          window.__ariseRetryWidgetScripts();
        return;
      }
      failedWidgetScripts.length = 0;
      pumpChunks();
    });
  }

  // Execution pacing. Each chunk is compiled + executed as one task, so the
  // next one is scheduled only after the browser has had a slice to paint, run
  // the app's own effects and handle input. requestIdleCallback is deliberately
  // not used as the trigger: while the React shell is rendering, idle windows
  // can be seconds away (measured 2.3 s), which left the startup chunks stuck
  // behind each other. Startup chunks run back to back; background chunks use
  // BACKGROUND_GAP and back off further right after an interaction.
  function scheduleNext() {
    if (idleHandle !== null) return;
    if (!pendingChunks.length) {
      maybeSettle();
      return;
    }
    var urgent = expedite || Date.now() < urgentUntil;
    var gap;
    if (urgent || !coreDone) gap = 0; // startup chunks run back to back
    else if (Date.now() - lastInteractionAt < 2000) gap = 2500; // user is working
    else gap = BACKGROUND_GAP;
    idleHandle = "pending";
    function run() {
      idleHandle = null;
      pumpChunks();
    }
    // setTimeout, not rAF: a frame callback can be deferred for seconds when
    // the page is not compositing (background tab, headless, throttled
    // renderer), which stalled the whole ordered queue in earlier attempts.
    setTimeout(run, gap);
  }

  function pumpChunks() {
    if (pumping) return;
    while (pendingChunks.length) {
      var url = pendingChunks.shift();
      if (chunkState[url]) continue;
      pumping = true;
      inFlight = url;
      injectWidgetScript(url, onChunkLoaded.bind(null, url), onChunkFailed.bind(null, url));
      return;
    }
    maybeSettle();
  }

  function chunkSettled(url, ok) {
    chunkState[url] = ok ? "done" : "failed";
    pumping = false;
    inFlight = null;
    if (ok) flushReadyMounts();
    if (!coreDone) {
      var core = CORE_CHUNKS.length ? CORE_CHUNKS : [];
      var coreComplete = core.length > 0;
      for (var i = 0; i < core.length; i++) if (!chunkState[core[i]]) coreComplete = false;
      if (coreComplete) {
        notifyCoreReady();
        startPrefetch();
      }
    }
    scheduleNext();
  }

  function onChunkLoaded(url) {
    chunkSettled(url, true);
  }

  function onChunkFailed(url) {
    // Keep the long-standing behaviour: a chunk that cannot be fetched is
    // replaced by its source files in order, so dependants still initialise.
    var parts = CHUNK_FILES[url];
    if (parts && parts.length) {
      console.warn(
        "[widget-loader] chunk unavailable, falling back to " + parts.length + " files: " + url
      );
      var left = parts.length;
      parts.forEach(function (file) {
        injectWidgetScript(
          file,
          function () {
            if (--left === 0) chunkSettled(url, false);
          },
          function () {
            rememberWidgetFailure(file);
            if (--left === 0) chunkSettled(url, false);
          }
        );
      });
      return;
    }
    rememberWidgetFailure(url);
    chunkSettled(url, false);
  }

  // Remaining chunks: their network fetch starts now at low priority (so a
  // route opened later finds them in the HTTP cache), but their execution —
  // the part that blocks the main thread — is spread one chunk at a time in
  // manifest order, with a gap that backs off further right after a real
  // interaction. On-demand requests preempt the queue, so a route the user
  // actually opens is never stuck behind background work. Data-saver / 2G
  // connections skip the speculative fetch and only download what is opened.
  function connectionIsMetered() {
    try {
      var c = navigator.connection || {};
      if (c.saveData === true) return true;
      return c.effectiveType === "slow-2g" || c.effectiveType === "2g";
    } catch (e) {
      return false;
    }
  }

  function startPrefetch() {
    if (prefetchStarted || expedite || !CHUNKS.length) return;
    prefetchStarted = true;
    var begun = false;
    function begin() {
      if (begun || expedite) return;
      begun = true;
      var rest = [];
      for (var i = 0; i < CHUNKS.length; i++) if (!chunkState[CHUNKS[i]]) rest.push(CHUNKS[i]);
      if (connectionIsMetered()) {
        // Data-saver / 2G: only fetch what the user actually opens.
        earlyDemand.splice(0, earlyDemand.length).forEach(function (url) {
          enqueueThrough(url, false);
        });
      } else {
        prewarm(rest);
        enqueueThrough(CHUNKS[CHUNKS.length - 1], false);
      }
      pumpChunks();
    }
    // Start as soon as the startup chunks are in: the startup screen is
    // already rendered and mounted, so the remaining bytes only have to avoid
    // the main thread (execution stays paced below), not wait for the window
    // load event — that event can trail by seconds on a slow connection and
    // used to leave later routes with nothing cached.
    setTimeout(begin, 300);
  }

  // Called by the mount stubs: load just the chunk that owns this widget (plus
  // the earlier chunks it needs) instead of the whole widget payload.
  window.__ariseLoadForMount = function (name) {
    if (!MOUNT_CHUNKS || !name) return false;
    var url = MOUNT_CHUNKS[name];
    if (!url) return false;
    if (!window.__ariseLazyWidgetsStarted) {
      if (earlyDemand.indexOf(url) === -1) earlyDemand.push(url);
      return true;
    }
    if (chunkState[url] === "done") return true;
    enqueueThrough(url, true);
    pumpChunks();
    return true;
  };
  window.__ariseMountChunk = function (name) {
    return (MOUNT_CHUNKS && name && MOUNT_CHUNKS[name]) || null;
  };
  window.__ariseMountChunkFailed = function (name) {
    var url = window.__ariseMountChunk(name);
    return !!url && chunkState[url] === "failed";
  };

  function startChunkSchedule() {
    if (!CHUNKS.length) return finish();
    bindOnlineRetry();
    var core = CORE_CHUNKS.length ? CORE_CHUNKS : CHUNKS.slice(0, 1);
    // Start the Dashboard core first; the rest of the core set is preloaded at
    // low priority so each ordered step starts without a cold-network wait.
    prewarm(core.slice(1));
    core.forEach(function (url) {
      enqueueThrough(url, false);
    });
    // Captures and verification scripts ask for "everything now" before boot.
    if (expedite) enqueueThrough(CHUNKS[CHUNKS.length - 1], true);
    pumpChunks();
  }

  // Debug/legacy path (?chunks=0 or arise-chunks=off): load the individual
  // source files instead of the generated chunks, in small ordered batches.
  function loadSourceFilesInOrder(list) {
    var BATCH = 6;
    var index = 0;
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      window.__ariseWidgetsSettled = true;
      notifyCoreReady();
      try {
        if (typeof window.__ariseFlushMounts === "function") window.__ariseFlushMounts();
      } catch (e) {}
    }
    function nextBatch() {
      if (index >= list.length) {
        finish();
        return;
      }
      var batch = list.slice(index, index + BATCH);
      index += BATCH;
      var left = batch.length;
      function settle() {
        if (--left !== 0) return;
        flushReadyMounts();
        if (expedite) setTimeout(nextBatch, 0);
        else setTimeout(nextBatch, 80);
      }
      batch.forEach(function (src) {
        injectWidgetScript(src, settle, function () {
          rememberWidgetFailure(src);
          settle();
        });
      });
    }
    // Safety net: still replay early mounts if one script hangs.
    setTimeout(function () {
      try {
        if (!finished && typeof window.__ariseFlushMounts === "function")
          window.__ariseFlushMounts();
      } catch (e) {}
    }, 30000);
    nextBatch();
  }

  function loadScriptsInOrder(list) {
    if (list === CHUNKS) {
      startChunkSchedule();
      return;
    }
    loadSourceFilesInOrder(list);
  }

  function startLazyLoad() {
    if (!bootReady || window.__ariseLazyWidgetsStarted) return;
    window.__ariseLazyWidgetsStarted = true;
    loadCss();
    var useChunks = CHUNKS.length > 0;
    try {
      if (/[?&]chunks=0\b/.test(location.search) || localStorage.getItem("arise-chunks") === "off")
        useChunks = false;
    } catch (e) {}
    loadScriptsInOrder(useChunks ? CHUNKS : SCRIPTS);
  }

  var retryingScripts = false;
  window.__ariseRetryWidgetScripts = function () {
    if (retryingScripts) return;
    var retryList = failedWidgetScripts.splice(0, failedWidgetScripts.length);
    if (!retryList.length) {
      // The script loaded but its mount hook failed to initialize. Re-running
      // an already-executed guarded module cannot recover it; reload instead.
      location.reload();
      return;
    }
    retryingScripts = true;
    var remaining = retryList.length;
    function retrySettled() {
      if (--remaining !== 0) return;
      retryingScripts = false;
      try {
        if (typeof window.__ariseFlushMounts === "function") window.__ariseFlushMounts();
      } catch (e) {}
    }
    retryList.forEach(function (src) {
      var retryUrl = src + (src.indexOf("?") === -1 ? "?retry=" : "&retry=") + Date.now();
      injectWidgetScript(retryUrl, retrySettled, function () {
        rememberWidgetFailure(src);
        retrySettled();
      });
    });
  };

  startFn = startLazyLoad;
  function schedule() {
    // Let initial paint + LCP settle before starting the widget payload.
    if (expedite) {
      startLazyLoad();
      return;
    }
    setTimeout(startLazyLoad, 320);
  }

  window.AriseBoot.ready.then(function () {
    bootReady = true;
    if (expedite) {
      startLazyLoad();
      return;
    }
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  });
})();
