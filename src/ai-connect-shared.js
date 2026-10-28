(function () {
  if (window.__ARISE_AI_CONNECT__) return;
  window.__ARISE_AI_CONNECT__ = !0;
  var a = "arise-ai-connect-v2",
    l = "/api/ai-ask",
    o = [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast & cheap, default)" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (slower, more thorough)" }
    ];
  function u() {
    try {
      var e = localStorage.getItem(a),
        t = e ? JSON.parse(e) : null;
      return { model: (t && t.model) || o[0].id };
    } catch {
      return { model: o[0].id };
    }
  }
  function c(e) {
    try {
      return localStorage.setItem(a, JSON.stringify({ model: e || o[0].id })), !0;
    } catch {
      return !1;
    }
  }
  function s() {
    try {
      localStorage.removeItem(a);
    } catch {}
  }
  function d() {
    return !0;
  }
  function S(e, t, n) {
    n = n || {};
    var f = u();
    if (!window.AriseAuth || typeof window.AriseAuth.fetch !== "function") {
      return Promise.reject(new Error("Sign in to use AI assistance."));
    }
    var timeoutMs = typeof n.timeoutMs === "number" && n.timeoutMs > 0 ? n.timeoutMs : 30000;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timedOut = !1;
    var upstream = n.signal;
    var onAbort = function () {
      if (ctrl) {
        try { ctrl.abort(); } catch (_) {}
      }
    };
    if (upstream) {
      if (upstream.aborted) onAbort();
      else if (typeof upstream.addEventListener === "function") upstream.addEventListener("abort", onAbort, { once: !0 });
    }
    var timer = ctrl
      ? setTimeout(function () {
          timedOut = !0;
          try { ctrl.abort(); } catch (_) {}
        }, timeoutMs)
      : 0;
    var cleanup = function () {
      if (timer) clearTimeout(timer);
      if (upstream && typeof upstream.removeEventListener === "function") {
        upstream.removeEventListener("abort", onAbort);
      }
    };
    var fetchOpts = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system: e,
        prompt: t,
        model: n.model || f.model,
        maxTokens: n.maxTokens || 500
      })
    };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    return Promise.resolve()
      .then(function () {
        return window.AriseAuth.fetch(l, fetchOpts);
      })
      .then(
        function (i) {
          cleanup();
          return i
            .json()
            .catch(function () {
              return {};
            })
            .then(function (r) {
              if (!i.ok)
                throw new Error(
                  (r && r.error) ||
                    (i.status === 429 ? "Rate limited — try again in a bit." : "Request failed (" + i.status + ").")
                );
              if (!r || !r.text) throw new Error("Model returned no text.");
              return r.text;
            });
        },
        function (err) {
          cleanup();
          if (timedOut) throw new Error("AI request timed out. Check your connection and try again.");
          throw err;
        }
      );
  }
  window.__ariseAI = { MODELS: o, getSettings: u, saveSettings: c, clearSettings: s, hasKey: d, ask: S };
})();
