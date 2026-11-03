(function () {
  if (window.__ARISE_MUTATION_BUS__) return;
  var n = [], r = [], i = 0, s = 5e3, u;
  var NOISE_SEL = "#arise-scroll-top-btn, #arise-page-widget-bar, .recharts-tooltip-wrapper, .lhm-tooltip";
  function isNoiseTarget(t) {
    if (!t || t.nodeType !== 1) return false;
    return typeof t.closest === "function" && !!t.closest(NOISE_SEL);
  }
  function c() {
    if (i && (clearTimeout(i), i = 0), !!r.length) {
      var t = r;
      r = [];
      for (var e = n.slice(), o = 0; o < e.length; o++) {
        if (n.indexOf(e[o]) !== -1) {
          try { e[o](t, u); } catch {}
        }
      }
    }
  }
  function a() {
    if (r.length >= s) { c(); return; }
    i || (i = setTimeout(c, window.__ariseWidgetsReady ? 60 : 250));
  }
  window.__ARISE_MUTATION_BUS__ = {
    mute: function (t) {
      try { t(); } finally { try { u.takeRecords(); } catch {} }
    },
    subscribe: function (t) {
      return typeof t != "function" ? function () {} : (n.push(t), function () {
        var e = n.indexOf(t);
        e !== -1 && n.splice(e, 1);
      });
    }
  };
  u = new MutationObserver(function (t) {
    var addedAny = false;
    for (var e = 0; e < t.length; e++) {
      var rec = t[e];
      if ((!rec.addedNodes || !rec.addedNodes.length) && (!rec.removedNodes || !rec.removedNodes.length)) continue;
      if (isNoiseTarget(rec.target)) continue;
      r.push(rec);
      addedAny = true;
    }
    if (addedAny) a();
  });
  function f() {
    u.observe(document.body, { childList: !0, subtree: !0 });
  }
  document.body ? f() : document.addEventListener("DOMContentLoaded", f);
})();
