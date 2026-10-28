(function () {
  if (window.__ARISE_DSA_SHEET_COVERAGE__) return;
  window.__ARISE_DSA_SHEET_COVERAGE__ = !0;
  var s = window.__ARISE_WIDGET_UTILS__,
    m = "dsc-sheet-coverage",
    u = "dsc-sheet-coverage-style",
    h = [
      { key: "blind75", fallbackLabel: "Blind 75" },
      { key: "neetcode150", fallbackLabel: "NeetCode 150" },
      { key: "toptech150", fallbackLabel: "LC Top 150" },
      { key: "striverA2Z", fallbackLabel: "Striver A2Z" }
    ],
    i = null,
    f = !1,
    l = !1;

  function b(force) {
    if (force) {
      f = !1;
      l = !1;
      i = null;
    }
    if (f) return i;
    f = !0;
    try {
      (s && s.fetchInterviewSheets
        ? s.fetchInterviewSheets({ force: !!force })
        : fetch("./assets/interview_sheets_data.json", { cache: "force-cache" }).then(function (e) {
            return e && e.ok ? e.json() : null;
          })
      )
        .then(function (e) {
          i = e && typeof e == "object" ? e : null;
        })
        .catch(function () {
          i = null;
        })
        .then(function () {
          l = !0;
          try {
            v();
          } catch {}
        });
    } catch {
      i = null;
      l = !0;
    }
    return i;
  }

  function g() {
    var e = s.safeGet("interviewSheetsProgress", {});
    (!e || typeof e != "object") && (e = {});
    var r = b(!1);
    return h.map(function (t) {
      var n = r && r[t.key],
        d = n && Array.isArray(n.questions) ? n.questions.length : 0,
        p = (n && n.name) || t.fallbackLabel,
        o = 0,
        a = t.key + "::";
      for (var c in e) Object.prototype.hasOwnProperty.call(e, c) && e[c] && c.indexOf(a) === 0 && o++;
      var _ = d > 0 ? Math.min(100, Math.round((o / d) * 100)) : 0;
      return { label: p, solved: o, total: d, pct: _ };
    });
  }

  function y(e) {
    return e < 34 ? "var(--danger)" : e < 67 ? "var(--warning)" : "var(--success)";
  }

  function w() {
    if (!document.getElementById(u)) {
      var e = [
          ".dsc-block{margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid var(--border-soft,var(--border,rgba(255,255,255,.07)));position:relative;z-index:1;min-height:112px}",
          ".dsc-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.7rem}",
          ".dsc-title{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,var(--text-tertiary,#5c6480))}",
          ".dsc-link{font-size:.68rem;font-weight:700;color:var(--accent,var(--info));background:none;border:none;cursor:pointer;padding:0}",
          ".dsc-rows{display:flex;flex-direction:column;gap:.5rem}",
          ".dsc-row{display:grid;grid-template-columns:110px 1fr 70px;align-items:center;gap:.6rem}",
          ".dsc-name{font-size:.74rem;font-weight:700;color:var(--text-secondary,#8b93b0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
          ".dsc-track{position:relative;height:8px;border-radius:999px;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.06)));overflow:hidden}",
          ".dsc-fill{position:absolute;inset:0;width:0%;border-radius:999px;box-shadow:0 0 8px currentColor;transition:width var(--motion-section,260ms) var(--ease-out-quart,ease)}",
          ".dsc-meta{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:var(--text-muted,var(--text-tertiary,#5c6480));text-align:right;white-space:nowrap}",
          ".dsc-empty{font-size:.76rem;color:var(--text-secondary,#8b93b0);display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap}",
          "@media (max-width:480px){.dsc-row{grid-template-columns:82px 1fr 54px;gap:.4rem}.dsc-name{font-size:.68rem}.dsc-meta{font-size:.62rem}}",
          "[data-theme-mode='light'] .dsc-title{color:var(--text-secondary,#444)}",
          "[data-theme-mode='light'] .dsc-name,[data-theme-mode='light'] .dsc-meta{color:var(--text-secondary,#444)}",
          "[data-theme-mode='light'] .dsc-track{background:var(--surface-muted,#f0f1f3)}"
        ].join(""),
        r = document.createElement("style");
      r.id = u;
      r.textContent = e;
      document.head.appendChild(r);
    }
  }

  function x() {
    var e = document.querySelector(".ish-wrap");
    if (!e) return;
    if (s && typeof s.smoothScroll === "function") {
      s.smoothScroll(e, { block: "start" });
    } else {
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      e.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }

  function k(e) {
    w();
    var r = document.getElementById("dmt-sheet-coverage");
    if (!r) return;
    var t = document.getElementById(m),
      n = !t;
    n && ((t = document.createElement("div")), (t.id = m), (t.className = "dsc-block"), r.appendChild(t));

    if (!l && e.every(function (a) { return a.total === 0; })) {
      var skelSig = "loading";
      if (t.__uxaLastSig !== skelSig) {
        t.__uxaLastSig = skelSig;
        var skRows = h
          .map(function (item) {
            return (
              '<div class="dsc-row" aria-hidden="true"><span class="dsc-name">' +
              item.fallbackLabel +
              '</span><div class="uxa-skeleton" style="height:8px;border-radius:999px"></div><div class="uxa-skeleton" style="height:10px;border-radius:4px"></div></div>'
            );
          })
          .join("");
        t.innerHTML =
          '<div class="dsc-head"><span class="dsc-title">Sheet Coverage</span></div><div class="dsc-rows uxa-skeleton--delayed" role="status" aria-live="polite" aria-busy="true"><span class="uxa-sr-only">Loading sheet coverage…</span>' +
          skRows +
          "</div>";
      }
      return;
    }

    var d = e.every(function (a) {
      return a.total === 0;
    });
    if (d) {
      var errSig = "error";
      if (t.__uxaLastSig !== errSig) {
        t.__uxaLastSig = errSig;
        t.innerHTML =
          '<div class="dsc-head"><span class="dsc-title">Sheet Coverage</span></div><div class="dsc-empty" role="alert"><span>Sheet data unavailable right now.</span><button type="button" class="uxa-retry-btn" data-dsc-retry="1">Retry</button></div>';
        var rb = t.querySelector("[data-dsc-retry]");
        rb &&
          (rb.onclick = function () {
            b(!0);
            v();
          });
      }
      return;
    }

    var sig = JSON.stringify(e);
    if (t.__uxaLastSig === sig) return;
    t.__uxaLastSig = sig;
    var p = e
      .map(function (a) {
        var c = y(a.pct);
        return (
          '<div class="dsc-row"><span class="dsc-name">' +
          a.label +
          '</span><div class="dsc-track"><div class="dsc-fill" style="width:' +
          a.pct +
          "%;background:" +
          c +
          ";color:" +
          c +
          '"></div></div><span class="dsc-meta">' +
          a.solved +
          "/" +
          a.total +
          "</span></div>"
        );
      })
      .join("");
    t.innerHTML =
      '<div class="dsc-head"><span class="dsc-title">Sheet Coverage</span><button type="button" class="dsc-link" data-dsc-open>Open Sheets &#8594;</button></div><div class="dsc-rows">' +
      p +
      "</div>";
    var o = t.querySelector("[data-dsc-open]");
    o && (o.onclick = x);
  }

  function v() {
    k(g());
  }
  s.bootUpdater(v);
})();
