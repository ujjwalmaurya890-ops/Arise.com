/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
// Perf patch: these widgets are all tab-scoped (not part of the default
// Dashboard view) and were previously loaded eagerly via <script defer>,
// competing with the critical render path. They're now injected after
// first paint is settled, in the exact same order as before (the vanilla
// widget files self-mount via window.__mountX contracts read by the React
// bundle, and a couple of files intentionally redefine the same global -
// e.g. __mountLocalFiles - so preserving order is required for identical
// behavior). No widget, feature, or localStorage logic is touched.
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

  // v222: EXPEDITE. Until every widget script has run, sections the user opens render
  // as empty shells (the React shell calls __mountX before the widget file exists).
  // The polite batch-and-yield schedule is only worth it while nobody is waiting.
  // The moment the user interacts (first pointer/key press) or a section asks for a
  // not-yet-loaded widget (the __mountX stubs call this), start immediately if we
  // haven't, drop the yields and load every remaining script in one ordered pass.
  var bootReady = false;
  var expedite = false;
  var pendingGo = null;
  var startFn = null;
  window.__ariseExpedite = function () {
    if (expedite || window.__ariseWidgetsReady) return;
    expedite = true;
    if (!bootReady) return;
    if (startFn) startFn();
    if (pendingGo) {
      var g = pendingGo;
      pendingGo = null;
      g();
    }
  };
  var expediteQueued = false;
  function scheduleInteractionExpedite() {
    if (expediteQueued || expedite || window.__ariseWidgetsReady) return;
    expediteQueued = true;
    // Yield 45ms (~2-3 frames) so pointerdown + click + route paint complete
    // cleanly at 60fps before streaming remaining background widget chunks.
    setTimeout(function () {
      window.__ariseExpedite();
    }, 45);
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    window.addEventListener(ev, scheduleInteractionExpedite, {
      once: true,
      passive: true,
      capture: true
    });
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

  function loadScriptsInOrder(list) {
    // Perf patch #3 (chunked + yielding). Perf patch #2 created all ~100
    // <script async=false> tags at once: the network was parallel, but the
    // browser then compiled and executed ~2.5 MB of JS back-to-back, which froze
    // scrolling/typing for seconds on mid-range hardware right as the dashboard
    // was becoming interactive. Now scripts are injected in small ordered
    // batches; between batches the loader yields to the browser (next animation frame) so rendering and input are never starved. Execution order is
    // still exactly the list order (async=false inside a batch, batches run
    // sequentially), so every __mountX / redefine-the-same-global contract
    // holds. Batches after the first are preloaded by the browser at
    // low priority so each batch starts without a cold-network
    // wait. A script that fails to load is skipped and logged, as before.
    var BATCH = list === CHUNKS ? 1 : 6;
    var bootCap =
      list === CHUNKS
        ? document.getElementById("arise-main")
          ? 3
          : 1
        : document.getElementById("arise-main")
          ? 52
          : 12;
    var stage2Prewarmed = false;
    var index = 0;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      window.__ariseWidgetsSettled = true;
      try {
        if (typeof window.__ariseFlushMounts === "function") window.__ariseFlushMounts();
      } catch (e) {}
      window.__ariseWidgetsReady = true;
      window.__ariseWidgetsReadyAt = Math.round(performance.now());
      try {
        window.dispatchEvent(new Event("arise:widgets-ready"));
      } catch (e) {}
      setTimeout(function () {
        try {
          var c = navigator.serviceWorker && navigator.serviceWorker.controller;
          if (c) c.postMessage({ type: "arise-fill-cache" });
        } catch (e) {}
      }, 5000);
    }

    function yieldThen(fn) {
      var once = false;
      function go() {
        if (once) return;
        once = true;
        pendingGo = null;
        if (!stage2Prewarmed && index >= bootCap) {
          stage2Prewarmed = true;
          prewarm(list.slice(index));
        }
        fn();
      }
      pendingGo = go;
      if (expedite) {
        // Yield a macrotask slice between expedited 2-chunk batches so input &
        // animation frames are never starved by a single 500ms+ script-compile burst.
        setTimeout(go, 0);
        return;
      }
      if (index === bootCap) {
        // Stage 1 (Dashboard core & active UX) is live & mounted.
        // Yield to paint + first idle window so LCP/input never stall,
        // then stream remaining background route chunks cleanly without an 8.5s sleep.
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () {
            if (typeof requestIdleCallback === "function")
              requestIdleCallback(go, { timeout: 220 });
            else setTimeout(go, 60);
          });
        }
        setTimeout(go, 260);
        return;
      }
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(function () {
          if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 60 });
          else setTimeout(go, 0);
        });
      }
      setTimeout(go, 100);
    }

    // Native preload shares the script request even when HTTP caching is
    // disabled. fetch().arrayBuffer() used to allocate unused copies and
    // could download every chunk twice. Execution still happens below.
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

    function nextBatch() {
      if (index >= list.length) {
        finish();
        return;
      }
      // A failed chunk must finish its source-file fallback before the next
      // chunk executes, otherwise dependent modules can initialize out of order.
      var expStep = list === CHUNKS ? 1 : 12;
      var size = expedite
        ? Math.min(expStep, list.length - index)
        : index < bootCap
          ? Math.min(BATCH, bootCap - index)
          : BATCH;
      var batch = list.slice(index, index + size);
      index += size;
      var left = batch.length;
      batch.forEach(function (src) {
        var settled = false;
        function settle() {
          if (settled) return;
          settled = true;
          if (--left === 0) {
            try {
              if (typeof window.__ariseFlushReadyMounts === "function")
                window.__ariseFlushReadyMounts();
            } catch (e) {}
            if (index >= list.length) finish();
            else yieldThen(nextBatch);
          }
        }
        injectWidgetScript(src, settle, function () {
          var parts = CHUNK_FILES[src];
          if (parts && parts.length) {
            // Chunk unavailable: retain ordered execution of the original files.
            console.warn(
              "[widget-loader] chunk unavailable, falling back to " +
                parts.length +
                " files: " +
                src
            );
            var n = parts.length;
            parts.forEach(function (f) {
              injectWidgetScript(
                f,
                function () {
                  if (--n === 0) settle();
                },
                function () {
                  rememberWidgetFailure(f);
                  if (--n === 0) settle();
                }
              );
            });
            return;
          }
          rememberWidgetFailure(src);
          settle();
        });
      });
    }

    // Safety net: if one script hangs, still replay early mounts after 30 s
    // (finish() still runs when the stragglers eventually settle).
    setTimeout(function () {
      try {
        if (!finished && typeof window.__ariseFlushMounts === "function")
          window.__ariseFlushMounts();
      } catch (e) {}
    }, 30000);
    if (bootCap > 1) prewarm(list.slice(Math.min(BATCH, bootCap), bootCap));
    nextBatch();
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
    // Let initial paint + LCP settle before streaming Stage 1 widget chunks in frame-yielded slices.
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
