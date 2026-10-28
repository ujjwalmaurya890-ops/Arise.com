(function () {
  "use strict";
  if (window.__ARISE_UX_ANIMATION__) return;
  window.__ARISE_UX_ANIMATION__ = true;

  var CARD_SEL = [
    ".glass-card",
    ".glass-premium",
    ".exw-card",
    ".att-card",
    ".cgpa-card",
    ".htw-card",
    ".cpw-card",
    ".smw-card",
    ".skt-card",
    ".na-card",
    ".pw-card",
    ".pt-card",
    ".cert-card",
    ".et-card",
    ".bd-score-card",
    ".bd-metric-card"
  ].join(",");

  var REDUCED =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (window.matchMedia) {
    try {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onChange = function (e) {
        REDUCED = e.matches;
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch {}
  }

  var seen = typeof WeakSet === "function" ? new WeakSet() : null;
  var bootedParents = typeof WeakSet === "function" ? new WeakSet() : null;
  var io = null;

  function markRevealed(el) {
    if (!el) return;
    el.classList.add("uxa-in");
    if (el.__uxaFallbackTimer) {
      clearTimeout(el.__uxaFallbackTimer);
      el.__uxaFallbackTimer = 0;
    }
  }

  function ensureObserver() {
    if (REDUCED || io || typeof IntersectionObserver !== "function") return io;
    io = new IntersectionObserver(
      function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            markRevealed(entry.target);
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "120px 0px 120px 0px", threshold: 0.01 }
    );
    return io;
  }

  function collectCandidates(roots) {
    var out = [];
    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root || !root.querySelectorAll) continue;
      if (root.nodeType === 1 && root.matches && root.matches(CARD_SEL)) {
        out.push(root);
      }
      var list = root.querySelectorAll(CARD_SEL);
      for (var i = 0; i < list.length; i++) out.push(list[i]);
    }
    return out;
  }

  function scanRoots(roots) {
    if (REDUCED) return;
    var candidates = collectCandidates(roots);
    if (!candidates.length) return;

    var fresh = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el || el.nodeType !== 1) continue;
      if (seen ? seen.has(el) : el.__uxaSeen) continue;
      if (seen) seen.add(el);
      else el.__uxaSeen = true;

      if (el.hasAttribute("data-uxa-no-reveal") || el.closest("[hidden]")) {
        continue;
      }
      // Never hide/re-animate cards inside a parent container that has already rendered once
      var parent = el.parentElement;
      if (parent && (bootedParents ? bootedParents.has(parent) : parent.__uxaBooted)) {
        continue;
      }
      fresh.push(el);
    }

    if (!fresh.length) return;

    // Phase 1: Batch ALL DOM geometry reads before any class writes (zero layout thrashing)
    var vh = window.innerHeight || 900;
    var offscreen = [];
    var parentsToMark = [];
    for (var j = 0; j < fresh.length; j++) {
      var item = fresh[j];
      if (item.parentElement) parentsToMark.push(item.parentElement);
      var rect = item.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.top >= vh * 0.96) {
        offscreen.push(item);
      }
    }

    for (var p = 0; p < parentsToMark.length; p++) {
      var par = parentsToMark[p];
      if (bootedParents) bootedParents.add(par);
      else par.__uxaBooted = true;
    }

    if (!offscreen.length) return;

    // Phase 2: Batch DOM writes + fail-safe reveal guarantee
    var obs = ensureObserver();
    var delayIndex = 0;
    for (var k = 0; k < offscreen.length; k++) {
      var card = offscreen[k];
      var delay = Math.min(delayIndex * 24, 120);
      delayIndex = (delayIndex + 1) % 5;
      if (delay) card.style.setProperty("--uxa-delay", delay + "ms");
      card.classList.add("uxa-reveal");
      if (obs) {
        obs.observe(card);
        // Fail-safe: ensure offscreen cards never remain permanently invisible if IO is throttled
        card.__uxaFallbackTimer = setTimeout(
          (function (target, observer) {
            return function () {
              target.__uxaFallbackTimer = 0;
              markRevealed(target);
              try { observer.unobserve(target); } catch {}
            };
          })(card, obs),
          650
        );
      } else {
        card.classList.add("uxa-in");
      }
    }
  }

  var rafId = 0;
  var pendingRoots = [];

  function scheduleScan(records) {
    if (REDUCED) return;
    if (Array.isArray(records) && records.length) {
      var foundAdded = false;
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        if (!added || !added.length) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node && node.nodeType === 1) {
            pendingRoots.push(node);
            foundAdded = true;
          }
        }
      }
      if (!foundAdded) return;
    } else {
      pendingRoots.push(document);
    }

    if (rafId) return;
    var sched = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    rafId = sched(function () {
      rafId = 0;
      var roots = pendingRoots.length > 24 ? [document] : pendingRoots.slice();
      pendingRoots.length = 0;
      scanRoots(roots);
    });
  }

  var fallbackObserver = null;
  var subscribed = false;

  function connectBus() {
    if (subscribed || !window.__ARISE_MUTATION_BUS__) return false;
    subscribed = true;
    if (fallbackObserver) {
      try { fallbackObserver.disconnect(); } catch {}
      fallbackObserver = null;
    }
    window.__ARISE_MUTATION_BUS__.subscribe(scheduleScan);
    return true;
  }

  function boot() {
    scanRoots([document]);
    if (!connectBus()) {
      try {
        fallbackObserver = new MutationObserver(scheduleScan);
        fallbackObserver.observe(document.documentElement, { childList: true, subtree: true });
      } catch {}
      window.addEventListener("arise:widgets-ready", connectBus, { once: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  window.addEventListener("hashchange", function () { scheduleScan(); });
  window.addEventListener("popstate", function () { scheduleScan(); });
})();
