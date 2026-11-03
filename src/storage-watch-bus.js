(function () {
  if (window.__ARISE_STORAGE_WATCH_BUS__) return;
  var n = [], l = null, pending = Object.create(null), queued = false;
  var eventDriven = !!(window.AriseStorage && typeof window.AriseStorage.onChange === "function");

  function f() {
    for (var e = 0; e < n.length; e++) {
      var i = n[e], t = null;
      try { t = localStorage.getItem(i.key); } catch {}
      if (t !== i.lastValue && (i.lastValue = t, t !== null)) {
        try { i.callback(t); } catch {}
      }
    }
  }

  function flushPending() {
    queued = false;
    var map = pending;
    pending = Object.create(null);
    var snapshot = n.slice();
    for (var e = 0; e < snapshot.length; e++) {
      var i = snapshot[e];
      if (!Object.prototype.hasOwnProperty.call(map, i.key)) continue;
      var t = map[i.key];
      if (t === undefined) {
        t = null;
        try { t = localStorage.getItem(i.key); } catch {}
      }
      if (t !== i.lastValue && (i.lastValue = t, t !== null)) {
        try { i.callback(t); } catch {}
      }
    }
  }

  function notifyKey(key, val) {
    if (!key || !n.length) return;
    pending[key] = val;
    if (!queued) {
      queued = true;
      if (typeof queueMicrotask === "function") queueMicrotask(flushPending);
      else Promise.resolve().then(flushPending);
    }
  }

  if (eventDriven) {
    window.AriseStorage.onChange(function (key, value) {
      notifyKey(key, value);
    });
    if (typeof window.addEventListener === "function") {
      window.addEventListener("storage", function (ev) {
        if (!ev || !ev.key) f();
        else notifyKey(ev.key, ev.newValue === undefined ? undefined : ev.newValue);
      });
    }
  }

  function r() {
    if (eventDriven) return;
    l || !n.length || (l = setInterval(f, 1200));
  }
  function u() {
    l && (clearInterval(l), l = null);
  }
  document.addEventListener("visibilitychange", function () {
    document.hidden ? u() : (eventDriven ? f() : r());
  });

  window.__ARISE_STORAGE_WATCH_BUS__ = {
    watch: function (e, i) {
      if (typeof e != "string" || typeof i != "function") return function () {};
      var t = null;
      try { t = localStorage.getItem(e); } catch {}
      var c = { key: e, lastValue: t, callback: i };
      return n.push(c), document.hidden || r(), function () {
        var a = n.indexOf(c);
        a !== -1 && n.splice(a, 1);
        n.length || u();
      };
    }
  };
})();
