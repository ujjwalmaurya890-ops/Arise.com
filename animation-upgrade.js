(function () {
  "use strict";
  if (window.__ARISE_ANIM_UPGRADE__) return;
  window.__ARISE_ANIM_UPGRADE__ = true;

  var reduced = false;
  try {
    reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {}
  if (reduced || document.documentElement.classList.contains("perf-lite")) return;

  var CARD_SEL = '[class*="-card"]:not([class*="-card-"]):not([class*="-cards"]), .glass-card, .glass-premium, [class*="-panel"]:not([class*="-panel-"]):not([class*="-panels"])';
  var delayMap = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  function nextDelay(parent) {
    if (!delayMap || !parent) return 0;
    var count = delayMap.get(parent) || 0;
    delayMap.set(parent, count + 1);
    return Math.min(count, 4) * 28;
  }

  var io = null;
  function getIO() {
    if (io) return io;
    if (typeof IntersectionObserver === "undefined") return null;
    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        var el = entry.target;
        el.style.animationDelay = nextDelay(el.parentElement) + "ms";
        el.classList.remove("uxa-reveal");
        el.classList.add("uxa-revealed");
        io.unobserve(el);
      }
    }, { threshold: 0.06, rootMargin: "0px 0px -24px 0px" });
    return io;
  }

  var queue = [];
  var rafId = 0;
  var BATCH = 64;

  function scheduleMeasure() {
    if (rafId || !queue.length) return;
    var run = function () { rafId = 0; processQueue(); };
    rafId = (window.requestAnimationFrame ? requestAnimationFrame(run) : setTimeout(run, 16)) || 1;
  }

  function enqueue(el) {
    if (!el || el.nodeType !== 1 || el.__uxaSeen) return;
    el.__uxaSeen = true;
    queue.push(el);
  }

  function processQueue() {
    if (document.hidden) return;
    var obs = getIO();
    if (!obs) { queue.length = 0; return; }
    var slice = queue.splice(0, BATCH);
    var fold = (window.innerHeight || 800) * 0.94;
    var belowFold = [];
    for (var i = 0; i < slice.length; i++) {
      var el = slice[i];
      if (!el.isConnected) continue;
      var rect;
      try { rect = el.getBoundingClientRect(); } catch (e) { continue; }
      if (!rect || (rect.width === 0 && rect.height === 0)) continue;
      if (rect.top >= fold || rect.bottom <= 0) belowFold.push(el);
    }
    for (var j = 0; j < belowFold.length; j++) {
      belowFold[j].classList.add("uxa-reveal");
      obs.observe(belowFold[j]);
    }
    if (queue.length) scheduleMeasure();
  }

  function scanSubtree(root) {
    if (!root) return;
    try {
      if (root.matches && root.matches(CARD_SEL)) enqueue(root);
      var cards = root.querySelectorAll ? root.querySelectorAll(CARD_SEL) : [];
      for (var i = 0; i < cards.length; i++) enqueue(cards[i]);
    } catch (e) {}
    scheduleMeasure();
  }

  var pendingNodes = [];
  var flushTimer = null;
  function flushNodes() {
    flushTimer = null;
    var batch = pendingNodes.splice(0, 20);
    for (var i = 0; i < batch.length; i++) {
      if (batch[i] && batch[i].isConnected) scanSubtree(batch[i]);
    }
    if (pendingNodes.length) flushTimer = setTimeout(flushNodes, 120);
  }

  function onRecords(records) {
    if (document.hidden) return;
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      if (!added) continue;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n && n.nodeType === 1) pendingNodes.push(n);
      }
    }
    if (!flushTimer && pendingNodes.length) flushTimer = setTimeout(flushNodes, 160);
  }

  var fallbackObserver = null;
  var busSubscribed = false;

  function attachBusIfReady() {
    if (busSubscribed || !window.__ARISE_MUTATION_BUS__) return false;
    busSubscribed = true;
    if (fallbackObserver) {
      try { fallbackObserver.disconnect(); } catch (e) {}
      fallbackObserver = null;
    }
    window.__ARISE_MUTATION_BUS__.subscribe(onRecords);
    return true;
  }

  function startObserver() {
    if (attachBusIfReady()) return;
    try {
      fallbackObserver = new MutationObserver(onRecords);
      fallbackObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    window.addEventListener("arise:widgets-ready", attachBusIfReady, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
  window.addEventListener("load", function () {
    attachBusIfReady();
    if (!document.hidden) scanSubtree(document);
  });
})();
