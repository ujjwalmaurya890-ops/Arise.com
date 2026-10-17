/* storage-watch-bus.js — one shared 1200 ms localStorage poller for the whole app.
 *
 * window.__ARISE_STORAGE_WATCH_BUS__.watch(key, callback) -> unwatch()
 *
 * v238 perf: the tick now reads each *distinct* localStorage key once instead of once
 * per subscription. There are 25 watch() call sites covering 17 keys today
 * (hackathonPipelineV1 ×3, focusSessionsV2 ×3, cse-syllabus-progress-v1 ×2, devTasks
 * ×2, studySessions ×2, hackathonTrackerV1 ×2 …), so every tick used to issue 25
 * synchronous localStorage.getItem calls; it now issues 17, and a future widget that
 * watches an already-watched key costs zero extra reads. getItem is the expensive
 * part (synchronous, main-thread, quota-tracked); the callback fan-out is untouched,
 * so every subscriber is still invoked exactly when it used to be, with the same
 * argument.
 *
 * Also added, both purely additive:
 *   - the interval is cleared when the last watcher unsubscribes (previously an
 *     empty but running timer could survive if the tab was visible at that moment),
 *   - stats() for measurement, and a console.warn after 64 watchers on one key,
 *     which is the signature of a render loop calling watch() without unwatch().
 *
 * Deliberately unchanged: values are re-read from localStorage every tick (nothing
 * is cached/parsed here), callbacks get the raw string, and a key that is *removed*
 * updates lastValue without firing (the `value !== null` quirk) — that is the
 * contract the existing 16 subscriber files were written against, and
 * test-storage-watch-bus.js pins it.
 */
(function () {
  "use strict";
  if (window.__ARISE_STORAGE_WATCH_BUS__) return;

  var TICK_MS = 1200;
  var WATCHERS_PER_KEY_WARN_AT = 64;

  var byKey = Object.create(null);            // key -> { last, subs: [callback…] }
  var timer = null;
  var stats = { ticks: 0, reads: 0, notified: 0, maxWatchersPerKey: 0 };

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function hasWatchers() {
    for (var k in byKey) return true;
    return false;
  }

  function tick() {
    stats.ticks++;
    for (var key in byKey) {
      var entry = byKey[key];
      if (!entry || !entry.subs.length) continue;
      var value = read(key);                  // ONE read per distinct key, per tick
      stats.reads++;
      if (value === entry.last) continue;
      entry.last = value;
      if (value === null) continue;           // key removed: record, do not fire
      var subs = entry.subs.slice();          // a callback may watch/unwatch mid-fan-out
      for (var i = 0; i < subs.length; i++) {
        try { subs[i](value); stats.notified++; } catch (e) { /* one bad watcher must not stop the others */ }
      }
    }
  }

  function start() {
    if (timer || document.hidden || !hasWatchers()) return;
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  window.__ARISE_STORAGE_WATCH_BUS__ = {
    watch: function (key, callback) {
      if (typeof key !== "string" || typeof callback !== "function") return function () {};
      var entry = byKey[key] || (byKey[key] = { last: read(key), subs: [] });
      entry.subs.push(callback);
      if (entry.subs.length > stats.maxWatchersPerKey) {
        stats.maxWatchersPerKey = entry.subs.length;
        if (entry.subs.length === WATCHERS_PER_KEY_WARN_AT) {
          console.warn('[storage-watch-bus] ' + entry.subs.length + ' watchers on key "' + key +
            '" — something is calling watch() without the returned unwatch().');
        }
      }
      start();
      // Look the entry up again on unwatch: if the key was deleted and re-watched in
      // between, byKey[key] is a different object and the stale one must not be the
      // thing we prune.
      return function () {
        var cur = byKey[key];
        if (!cur) return;
        var i = cur.subs.indexOf(callback);
        if (i !== -1) cur.subs.splice(i, 1);
        if (!cur.subs.length) delete byKey[key];
        if (!hasWatchers()) stop();
      };
    },
    stats: function () {
      var keys = 0, watchers = 0;
      for (var k in byKey) { keys++; watchers += byKey[k].subs.length; }
      return {
        keys: keys, watchers: watchers, ticks: stats.ticks, reads: stats.reads,
        notified: stats.notified, maxWatchersPerKey: stats.maxWatchersPerKey,
        ticking: !!timer, tickMs: TICK_MS,
        readsWithoutDedupe: watchers * stats.ticks
      };
    }
  };
})();
