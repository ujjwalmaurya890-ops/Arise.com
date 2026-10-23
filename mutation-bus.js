// Shared document-wide MutationObserver fan-out (~35 widgets subscribe).
// v221: deliveries are now COALESCED. Before, every DOM mutation batch ran all
// ~35 subscriber callbacks synchronously in a microtask; while 100 widget scripts
// mount at load that meant hundreds of back-to-back fan-outs (the main source of
// the load-time lag). Now records are buffered and delivered once per window
// (250 ms while widgets are still loading, 60 ms afterwards). Subscribers still
// receive the full list of MutationRecords, in order, so nothing is dropped.
// API unchanged: subscribe(fn) -> unsubscribe(), mute(fn).
(function () {
  if (window.__ARISE_MUTATION_BUS__) return;
  var subs = [];
  var buf = [];
  var timer = 0;
  var MAX_BUF = 5000; // safety valve: flush immediately instead of growing forever
  var obs;

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!buf.length) return;
    var recs = buf;
    buf = [];
    var list = subs.slice();
    for (var i = 0; i < list.length; i++) {
      if (subs.indexOf(list[i]) === -1) continue; // unsubscribed meanwhile
      try { list[i](recs, obs); } catch (e) {}
    }
  }

  function schedule() {
    if (buf.length >= MAX_BUF) { flush(); return; }
    if (timer) return;
    timer = setTimeout(flush, window.__ariseWidgetsReady ? 60 : 250);
  }

  window.__ARISE_MUTATION_BUS__ = {
    mute: function (fn) {
      try { fn(); } finally { try { obs.takeRecords(); } catch (e) {} }
    },
    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      subs.push(fn);
      return function () {
        var i = subs.indexOf(fn);
        if (i !== -1) subs.splice(i, 1);
      };
    }
  };

  obs = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) buf.push(records[i]);
    schedule();
  });

  function start() { obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
