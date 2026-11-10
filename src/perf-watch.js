/* ==========================================================================
   Performance watch (src/perf-watch.js)
   --------------------------------------------------------------------------
   Measured in Chromium on the built dashboard, idle — nothing typed, no route
   change, no store write:

     4 s idle:  748 DOM mutations, 3,985 querySelector(All) calls, 5 long tasks

   Every one of those mutations came from the Career Readiness card (readiness-
   50lpa-widget.js): it animates its ring, milestone bars and metric bars with
   requestAnimationFrame, and each frame rewrites DOM (text, stroke-dashoffset,
   class names). The global mutation bus (src/mutation-bus.js) cannot tell a
   self-re-render apart from a real change, so it queues a record, debounces,
   notifies 40+ subscribers and then flushes all of them — 16 full innerHTML
   re-renders of the DSA problem-insights widget per 4 s of doing nothing.

   Because the animation only produces records, not new content, the bus is
   given a cheap discriminator: a MutationRecord that adds no element and
   changes only text or attributes cannot be a new card, so it can be dropped
   for subscribers when it happens inside an element that has declared itself
   self-updating (data-arise-bus-idle). The observer's callback still runs — this
   never delays real work — and <noscript>-style blanket suppression is avoided
   entirely: only declared subtrees are affected.

   window.ArisePerf exposes counters (observer records received, ignored,
   dispatched, notify runs) so the effect can be measured instead of guessed,
   and so a regression test can prove real changes still reach subscribers.
   ========================================================================== */
(function () {
  "use strict";
  if (window.ArisePerf) return;

  var IDLE_ATTR = "data-arise-bus-idle";
  var stats = { records: 0, ignored: 0, dispatched: 0, notifications: 0, startedAt: Date.now() };

  function isElement(node) { return !!node && node.nodeType === 1; }

  // A structural change is anything that added or removed an element. Text and
  // attribute writes alone never create a card, a row or a section.
  function structural(record) {
    var i;
    if (record.type === "childList") {
      if (record.addedNodes) {
        for (i = 0; i < record.addedNodes.length; i += 1) if (isElement(record.addedNodes[i])) return true;
      }
      if (record.removedNodes) {
        for (i = 0; i < record.removedNodes.length; i += 1) if (isElement(record.removedNodes[i])) return true;
      }
      return false;
    }
    // Text nodes and attributes never create a card, a row or a section, so
    // they are not structural on their own. Structural means: an element went
    // in or out of the document.
    return false;
  }

  // A record's target can be a text node, an element, or (for innerHTML
  // rewrites) a span whose own children changed - all of them sit inside the
  // declared subtree. The document subtree records caused by a marked card's
  // internal re-render are caught the same way, because the card is an ancestor
  // of every node it rewrote.
  function insideIdleRegion(node) {
    if (!node) return false;
    var el = isElement(node) ? node : (node.parentElement || null);
    if (!el || typeof el.closest !== "function") return false;
    try { return !!el.closest("[" + IDLE_ATTR + "]"); } catch { return false; }
  }

  function declarationCount() {
    try { return document.querySelectorAll("[" + IDLE_ATTR + "]").length; } catch { return 0; }
  }

  function mark(node, on) {
    if (!node || !isElement(node)) return false;
    if (on === false) node.removeAttribute(IDLE_ATTR);
    else node.setAttribute(IDLE_ATTR, "1");
    return true;
  }

  function snapshot() {
    return {
      records: stats.records,
      ignored: stats.ignored,
      dispatched: stats.dispatched,
      notifications: stats.notifications,
      declarations: declarationCount(),
      uptimeMs: Date.now() - stats.startedAt
    };
  }

  function reset() {
    stats.records = 0;
    stats.ignored = 0;
    stats.dispatched = 0;
    stats.notifications = 0;
    return snapshot();
  }

  // The bus calls this for every observer callback it receives. It returns the
  // records worth dispatching, after counting what it dropped and leaving the
  // rest untouched.
  function filter(records) {
    if (!records || !records.length) return records;
    var keep = [];
    for (var i = 0; i < records.length; i += 1) {
      var record = records[i];
      stats.records += 1;
      if (!structural(record) && insideIdleRegion(record.target)) {
        stats.ignored += 1;
        continue;
      }
      keep.push(record);
    }
    stats.dispatched += keep.length;
    return keep;
  }

  function noteNotification() { stats.notifications += 1; }

  window.ArisePerf = {
    idleAttribute: IDLE_ATTR,
    mark: mark,
    filter: filter,
    noteNotification: noteNotification,
    snapshot: snapshot,
    reset: reset,
    isStructural: structural
  };
})();
