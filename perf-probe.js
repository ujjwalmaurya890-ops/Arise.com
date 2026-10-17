/* perf-probe.js — Arise's opt-in field-measurement overlay (v238).
 *
 * The audit in PERF-AUDIT-v237.md is byte-counting and code reading; this is the
 * missing half: what the browser actually experienced. It is NOT loaded unless you ask
 * for it, so production users pay nothing (the ~10-line bootstrap in index.html only
 * creates the <script> when the flag is on, so this file is not even fetched):
 *
 *   ?perf=1                      one-off look (also prints a console table)
 *   localStorage 'arise-perf'='on'   keep it on across navigations
 *
 * In the console:  __arisePerf.report()   → formatted summary
 *                  __arisePerf.json()     → raw payload for pasting into an issue
 *                  __arisePerf.stop()     → detach observers
 *
 * Every API is feature-detected; in unsupported browsers the probe degrades to the
 * subset that exists rather than throwing. Nothing here changes app behaviour, and
 * the file is deliberately absent from the service-worker precache lists.
 */
(function () {
  "use strict";
  if (window.__ARISE_PERF_PROBE__) return;
  window.__ARISE_PERF_PROBE__ = true;

  var t0 = performance.timeOrigin || (Date.now() - performance.now());
  var P = { marks: [], longtasks: [], events: [], shifts: [], lcp: null, paint: {}, nav: null, resources: null };
  var observers = [];

  function now() { return Math.round(performance.now()); }
  function mark(name) { P.marks.push({ name: name, at: now() }); }
  function observe(type, cb, opts) {
    if (typeof PerformanceObserver !== "function") return;
    var po;
    try {
      po = new PerformanceObserver(function (list) {
        try { cb(list.getEntries()); } catch (e) { /* never break the page */ }
      });
      po.observe(Object.assign({ type: type, buffered: true }, opts || {}));
      observers.push(po);
    } catch (e) { /* unsupported entry type — fine, that metric is just absent */ }
  }

  // ── paint / navigation ─────────────────────────────────────────────────────
  function collectTiming() {
    try {
      performance.getEntriesByType("paint").forEach(function (e) { P.paint[e.name] = Math.round(e.startTime); });
    } catch (e) {}
    try {
      var n = performance.getEntriesByType("navigation")[0];
      if (n) {
        P.nav = {
          ttfb: Math.round(n.responseStart - n.requestStart),
          domContentLoaded: Math.round(n.domContentLoadedEventEnd - n.startTime),
          load: Math.round(n.loadEventEnd - n.startTime),
          transferSize: n.transferSize, encodedBodySize: n.encodedBodySize
        };
      }
    } catch (e) {}
  }
  observe("paint", function () { collectTiming(); });

  // ── Core Web Vitals-ish ────────────────────────────────────────────────────
  observe("largest-contentful-paint", function (es) {
    var e = es[es.length - 1];
    if (e) P.lcp = { at: Math.round(e.startTime), size: e.size, element: describe(e.element) };
  });
  var cls = 0;
  observe("layout-shift", function (es) {
    es.forEach(function (e) { if (!e.hadRecentInput) cls += e.value; });
  });
  // INP = worst observed interaction latency; durationThreshold keeps the noise down.
  var inp = { max: 0, worst: null, samples: 0 };
  observe("event", function (es) {
    es.forEach(function (e) {
      if (!e.duration) return;
      inp.samples++;
      if (e.duration > inp.max) {
        inp.max = Math.round(e.duration);
        inp.worst = { type: e.name, processorStart: Math.round(e.processingStart - e.startTime), processing: Math.round(e.processingEnd - e.processingStart), at: Math.round(e.startTime) };
      }
      if (P.events.length < 40) P.events.push({ type: e.name, dur: Math.round(e.duration), at: Math.round(e.startTime) });
    });
  }, { durationThreshold: 40 });
  observe("longtask", function (es) {
    es.forEach(function (e) {
      if (P.longtasks.length < 200) P.longtasks.push({ at: Math.round(e.startTime), dur: Math.round(e.duration) });
    });
  });

  function describe(el) {
    try {
      if (!el) return null;
      var id = el.id ? "#" + el.id : "";
      var cls2 = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      return el.tagName.toLowerCase() + id + cls2;
    } catch (e) { return String(el && el.tagName || "?"); }
  }

  // ── resource accounting (this is what the cache-header work shows up in) ───
  function resources() {
    var out = { count: 0, transferBytes: 0, encodedBytes: 0, decodedBytes: 0, byType: {}, cacheHits: 0, slowest: [], missingTiming: 0 };
    try {
      var list = performance.getEntriesByType("resource");
      list.forEach(function (e) {
        out.count++;
        var t = e.transferSize, enc = e.encodedBodySize, dec = e.decodedBodySize;
        if (t === 0 && enc === 0 && dec === 0) { out.missingTiming++; return; }   // cross-origin, no Timing-Allow-Origin
        out.transferBytes += t; out.encodedBytes += enc; out.decodedBytes += dec;
        if (t === 0 && enc > 0) out.cacheHits++;                                   // served from cache, no body transferred
        var kind = (e.initiatorType || (/\.(css)(\?|$)/.test(e.name) ? "css" : "other")).toLowerCase();
        var b = out.byType[kind] || (out.byType[kind] = { n: 0, bytes: 0 });
        b.n++; b.bytes += t;
        out.slowest.push({ url: short(e.name), ms: Math.round(e.duration), bytes: t });
      });
      out.slowest.sort(function (a, b) { return b.ms - a.ms; });
      out.slowest = out.slowest.slice(0, 12);
    } catch (e) {}
    return out;
  }
  function short(u) { try { return new URL(u, location.href).pathname; } catch (e) { return String(u).slice(-60); } }

  // ── Arise-specific phase timings (already recorded by the app itself) ─────
  function phases() {
    var out = { widgetReadyAt: null, widgetReadyLateMs: null, chunkSplit: null, loadFailures: 0, audio: null };
    try { out.widgetReadyAt = window.__ariseWidgetsReadyAt != null ? window.__ariseWidgetsReadyAt : null; } catch (e) {}
    try { out.chunkSplit = window.__ariseChunkSplit || null; } catch (e) {}
    try { out.loadFailures = (window.__ariseWidgetLoadFailures || []).length; } catch (e) {}
    try { out.perfMode = document.documentElement.classList.contains("perf-lite") ? "lite" : "full"; } catch (e) {}
    try { out.animRevealSkipped = !!window.__ARISE_ANIM_UPGRADE_LITE__; } catch (e) {}
    try { out.storageBus = window.__ARISE_STORAGE_WATCH_BUS__ && window.__ARISE_STORAGE_WATCH_BUS__.stats ? window.__ARISE_STORAGE_WATCH_BUS__.stats() : null; } catch (e) {}
    if (out.widgetReadyAt != null && P.nav) out.widgetReadyLateMs = out.widgetReadyAt - P.nav.load;
    return out;
  }

  function json() {
    collectTiming();
    var lt = P.longtasks;
    var tbt = lt.reduce(function (a, b) { return a + Math.max(0, b.dur - 50); }, 0);
    return {
      at: new Date().toISOString(), href: location.href,
      paint: P.paint, lcp: P.lcp, cls: Math.round(cls * 1000) / 1000,
      inp: inp, navigation: P.nav,
      longtasks: { count: lt.length, totalMs: lt.reduce(function (a, b) { return a + b.dur; }, 0), maxMs: lt.reduce(function (a, b) { return Math.max(a, b.dur); }, 0), blockingMs: tbt, worst: lt.slice().sort(function (a, b) { return b.dur - a.dur; }).slice(0, 5) },
      arise: phases(),
      network: resources(),
      marks: P.marks
    };
  }

  function report() {
    var d = json();
    var kb = function (n) { return (n / 1024).toFixed(0) + " KB"; };
    var rows = [
      ["TTFB", d.navigation ? d.navigation.ttfb + " ms" : "-"],
      ["FCP", d.paint["first-contentful-paint"] != null ? d.paint["first-contentful-paint"] + " ms" : "-"],
      ["LCP", d.lcp ? d.lcp.at + " ms  (" + (d.lcp.element || "?") + ")" : "-"],
      ["CLS", d.cls],
      ["INP (worst)", d.inp.max ? d.inp.max + " ms  " + JSON.stringify(d.inp.worst) : "-"],
      ["DCL / load", (d.navigation ? d.navigation.domContentLoaded + " / " + d.navigation.load + " ms" : "-")],
      ["widgets ready", d.arise.widgetReadyAt != null ? d.arise.widgetReadyAt + " ms (+" + d.arise.widgetReadyLateMs + " vs load)" : "not recorded"],
      ["long tasks", d.longtasks.count + " (total " + d.longtasks.totalMs + " ms, blocking " + d.longtasks.blockingMs + " ms, max " + d.longtasks.maxMs + " ms)"],
      ["resources", d.network.count + " | transfer " + kb(d.network.transferBytes) + " | decoded " + kb(d.network.decodedBytes)],
      ["served from cache", d.network.cacheHits + " (transferSize 0 with a body)"],
      ["chunk split", d.arise.chunkSplit ? JSON.stringify(d.arise.chunkSplit) : "off (single phase)"],
      ["mode", d.arise.perfMode + (d.arise.animRevealSkipped ? " (reveal pipeline skipped)" : "")],
      ["storage bus", d.arise.storageBus ? d.arise.storageBus.watchers + " watchers / " + d.arise.storageBus.keys + " keys / " +
        d.arise.storageBus.reads + " reads over " + d.arise.storageBus.ticks + " ticks" + (d.arise.storageBus.ticks ? " (" + (d.arise.storageBus.reads / d.arise.storageBus.ticks).toFixed(1) + " getItem/tick; pre-v238 it would be " + (d.arise.storageBus.readsWithoutDedupe / d.arise.storageBus.ticks).toFixed(1) + ")" : "") : "not loaded yet"],
      ["widget load failures", d.arise.loadFailures]
    ];
    if (typeof console.table === "function") console.table(Object.fromEntries(rows.map(function (r) { return [r[0], r[1]]; })));
    else rows.forEach(function (r) { console.log(r[0] + ": " + r[1]); });
    if (d.network.slowest.length) console.log("[perf] slowest resources:", d.network.slowest);
    if (d.longtasks.worst.length) console.log("[perf] worst long tasks (ms after load):", d.longtasks.worst);
    console.log("[perf] full payload: __arisePerf.json()");
    return d;
  }

  // tiny HUD so the numbers are visible without opening devtools.
  // This file is injected by a <script> created at runtime, so it can execute before
  // or after DOMContentLoaded - try at parse time, on DOMContentLoaded, and on load,
  // guarded by hudDone so it appears exactly once either way.
  var hudDone = false;
  function hud() {
    if (hudDone || !/[?&]perf=1\b/.test(location.search)) return;
    var d = document.createElement("div");
    d.setAttribute("aria-hidden", "true");
    d.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483000;font:11px/1.5 ui-monospace,monospace;color:#e6edf3;background:rgba(6,10,20,.88);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:.45rem .6rem;max-width:min(46ch,90vw);white-space:pre;pointer-events:none";
    function draw() {
      var x = json();
      d.textContent =
        "FCP " + (x.paint["first-contentful-paint"] || "-") + "  LCP " + (x.lcp ? x.lcp.at : "-") +
        "  INP " + (x.inp.max || "-") + "  CLS " + x.cls +
        "\nlongtasks " + x.longtasks.count + " / " + x.longtasks.totalMs + "ms  widgets " +
        (x.arise.widgetReadyAt != null ? x.arise.widgetReadyAt : "-") +
        "\nxfer " + (x.network.transferBytes / 1024).toFixed(0) + "KB  cached " + x.network.cacheHits + "/" + x.network.count +
        "\nmode " + x.arise.perfMode + (x.arise.animRevealSkipped ? " (no reveal)" : "");
    }
    if (!document.body) return;            // not attachable yet; a later hook will retry
    hudDone = true;
    document.body.appendChild(d);
    draw(); setInterval(draw, 1000);
  }

  window.__arisePerf = {
    mark: mark, json: json, report: report,
    stop: function () { observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); observers = []; }
  };
  hud();
  document.addEventListener("DOMContentLoaded", hud);
  window.addEventListener("load", hud);
  window.addEventListener("load", function () { mark("load"); });
})();
