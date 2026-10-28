(function () {
  if (window.__ARISE_AI_REAL_INSIGHTS__) return;
  window.__ARISE_AI_REAL_INSIGHTS__ = !0;
  var v = "air-real-insights-style",
    m = "arise-ai-career-mentor-ai-cache-v1",
    g = "ai-real-insights-card",
    l = !1,
    o = !1,
    u = !1,
    lastErr = "",
    reqSeq = 0,
    activeCtrl = null;

  function x() {
    if (!document.getElementById(v)) {
      var e = document.createElement("style");
      e.id = v;
      e.textContent =
        ".air-card{font-family:var(--font-body);animation:air-fade-in var(--motion-section,260ms) var(--ease-out-quart,ease) both}@keyframes air-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.air-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.7rem}.air-title{font-family:var(--font-display);font-weight:800;font-size:1.05rem;color:var(--text-primary)}.air-sub{font-size:11px;color:var(--text-tertiary);margin-top:2px}.air-actions{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.air-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font-size:11.5px;font-weight:700;padding:.4rem .75rem;border-radius:999px;border:1px solid var(--border);background:var(--surface-muted);color:var(--text-secondary);cursor:pointer}.air-btn:hover:not(:disabled){color:var(--text-primary)}.air-btn:disabled{opacity:.68;cursor:wait}.air-primary{color:var(--primary-contrast);background:var(--primary);border-color:var(--primary)}.air-danger{color:var(--danger);background:transparent;border-color:color-mix(in srgb,var(--danger) 40%,var(--border))}.air-form{display:flex;flex-direction:column;gap:.55rem;background:var(--surface-muted);border:1px solid var(--border);border-radius:var(--radius-md,14px);padding:.85rem;margin-top:.7rem}.air-label{font-size:.72rem;font-weight:700;color:var(--text-secondary)}.air-input,.air-select{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);padding:.5rem .6rem;font-size:.8rem;font-family:'JetBrains Mono',monospace}.air-hint{font-size:10.5px;color:var(--text-tertiary);line-height:1.5}.air-output{font-size:12.5px;line-height:1.65;color:var(--text-secondary);white-space:pre-wrap;background:color-mix(in srgb,var(--surface-muted) 68%,transparent);border:1px solid var(--border);border-radius:var(--radius-md,14px);padding:.8rem .9rem;margin-top:.7rem}.air-empty{font-size:12px;color:var(--text-tertiary);margin-top:.5rem}.air-error{font-size:11.5px;color:var(--danger);margin-top:.6rem;display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;padding:.55rem .75rem;border-radius:10px;border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:color-mix(in srgb,var(--danger) 8%,transparent)}.air-error:empty{display:none}.air-footer{font-size:10px;color:var(--text-tertiary);margin-top:.6rem;font-family:'JetBrains Mono',monospace}.air-pill{font-size:10px;font-weight:800;padding:.2rem .55rem;border-radius:999px;color:var(--success);background:color-mix(in srgb,var(--success) 14%,transparent);border:1px solid color-mix(in srgb,var(--success) 35%,transparent)}@media(max-width:620px){.air-actions{width:100%;justify-content:flex-start}.air-btn{flex:1}}";
      document.head.appendChild(e);
    }
  }

  function _() {
    try {
      var e = localStorage.getItem(m);
      return e ? JSON.parse(e) : null;
    } catch {
      return null;
    }
  }
  function I(e) {
    try {
      localStorage.setItem(m, JSON.stringify(e));
    } catch {}
  }
  function c(e) {
    return String(e ?? "").replace(/[&<>"']/g, function (r) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[r];
    });
  }
  function S(e) {
    return {
      overallReadiness: e.overall,
      readinessLabel: e.label,
      scoreBreakdown: e.scores,
      topStrengths: (e.strengths || []).slice(0, 3),
      topWeaknesses: (e.weaknesses || []).slice(0, 3),
      weakestSubject: e.subjectAnalysis
        ? {
            name: e.subjectAnalysis.subject,
            confidence: e.subjectAnalysis.confidence,
            reasons: e.subjectAnalysis.reasons
          }
        : null,
      trendWarnings: e.warnings || [],
      suggestedNextSteps: (e.suggestions || []).slice(0, 4)
    };
  }

  function A(e) {
    if (o) return;
    var r = window.__ARISE_CAREER_MENTOR_REPORT__;
    if (!r) {
      lastErr = "Rule-based insights haven't loaded yet — open the Career Mentor card above first, then try again.";
      s(e);
      return;
    }
    if (activeCtrl) {
      try { activeCtrl.abort(); } catch (_) {}
    }
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    activeCtrl = ctrl;
    var mySeq = ++reqSeq;
    lastErr = "";
    o = !0;
    s(e);
    var n =
      "You are a direct, supportive career mentor for a computer-science student in India preparing for tech placements. You will be given a JSON snapshot of the student's auto-tracked stats (attendance, DSA practice, dev tasks, projects, exam confidence). Write a short personalized narrative (120-180 words) in a warm but honest coaching tone, followed by exactly 3 concrete, prioritized action items for the next 7 days, each on its own line starting with a dash. Only reference facts present in the JSON — never invent specific numbers, companies, deadlines, or achievements that aren't given to you.";
    var i = S(r);
    window.__ariseAI
      .ask(n, JSON.stringify(i), { maxTokens: 500, signal: ctrl ? ctrl.signal : void 0 })
      .then(function (f) {
        if (mySeq !== reqSeq) return;
        I({
          text: f,
          generatedAt: new Date().toISOString(),
          model: (window.__ariseAI.getSettings() || {}).model,
          basedOnOverall: r.overall
        });
        o = !1;
        activeCtrl = null;
        lastErr = "";
        s(e);
      })
      .catch(function (f) {
        if (mySeq !== reqSeq) return;
        o = !1;
        activeCtrl = null;
        lastErr = "Generation failed: " + ((f && f.message) || "Unknown error");
        s(e);
      });
  }

  function E(e) {
    if (!e) return null;
    var r = new Date(e);
    return isNaN(r.getTime()) ? null : r.toLocaleString();
  }

  function R(e) {
    var r = window.__ARISE_CAREER_MENTOR_REPORT__;
    return !!(r && typeof e.basedOnOverall == "number" && Math.abs(r.overall - e.basedOnOverall) >= 5);
  }

  function B() {
    var e = window.__ariseAI.MODELS,
      r = window.__ariseAI.getSettings().model,
      t = e
        .map(function (a) {
          return '<option value="' + c(a.id) + '"' + (a.id === r ? " selected" : "") + ">" + c(a.label) + "</option>";
        })
        .join("");
    return (
      '<div class="air-form"><div class="air-label">Model</div><select class="air-select" data-air-field="model">' +
      t +
      '</select><div class="air-hint">Haiku is the cheap/fast default; Sonnet is slower but more thorough. The API key itself lives on the server, not in this browser.</div><div class="air-actions"><button type="button" class="air-btn air-primary" data-air-action="save-settings">Save</button></div></div>'
    );
  }

  function k() {
    var r = _();
    var btnContent = o
      ? '<span class="uxa-spinner uxa-spinner--xs" aria-hidden="true"></span><span>Thinking…</span>'
      : r
        ? "🔄 Regenerate"
        : "🤖 Generate AI Insights";
    var t =
      '<div class="air-head"><div><div class="air-title">🤖 Real AI Insights <span class="air-pill">● Available</span></div><div class="air-sub">A genuine LLM reads the stats above and writes its own take. Requests go through this site\'s backend — no API key ever touches your browser.</div></div><div class="air-actions"><button type="button" class="air-btn air-primary" data-air-action="generate"' +
      (o ? ' disabled aria-busy="true"' : "") +
      ">" +
      btnContent +
      '</button><button type="button" class="air-btn" data-air-action="toggle-settings">Model</button></div></div>';
    var bar = o
      ? '<div class="uxa-progress-indeterminate" role="status" aria-live="polite" aria-label="Generating AI insights"><span class="uxa-sr-only">Generating AI insights…</span></div>'
      : "";
    var errHtml = lastErr
      ? '<div class="air-error" role="alert"><span>' +
        c(lastErr) +
        '</span>' +
        (!o ? '<button type="button" class="uxa-retry-btn" data-air-action="retry">Try again</button>' : "") +
        "</div>"
      : '<div class="air-error"></div>';
    var a = l ? B() : "",
      n;
    if (r) {
      var i = R(r);
      n =
        '<div class="air-output' +
        (o ? " uxa-stale-refreshing" : "") +
        '">' +
        c(r.text) +
        '</div><div class="air-footer">Generated ' +
        (E(r.generatedAt) || "—") +
        (r.model ? " · " + c(r.model) : "") +
        (o
          ? " · refreshing with latest stats…"
          : i
            ? " · your stats have changed since this was written — consider regenerating"
            : "") +
        "</div>" +
        errHtml +
        a;
    } else if (o) {
      n =
        '<div class="uxa-skeleton-card" style="margin-top:.7rem" role="status" aria-live="polite" aria-busy="true">' +
        '<span class="uxa-sr-only">Generating personalized AI insights…</span>' +
        '<div class="uxa-skeleton uxa-skeleton-line" style="width:92%" aria-hidden="true"></div>' +
        '<div class="uxa-skeleton uxa-skeleton-line" style="width:84%" aria-hidden="true"></div>' +
        '<div class="uxa-skeleton uxa-skeleton-line" style="width:76%" aria-hidden="true"></div>' +
        '<div class="uxa-skeleton uxa-skeleton-line" style="width:62%" aria-hidden="true"></div>' +
        "</div>" +
        errHtml +
        a;
    } else {
      n = '<div class="air-empty">No AI insights generated yet. Click "Generate AI Insights" above.</div>' + errHtml + a;
    }
    return t + bar + n;
  }

  function s(e) {
    if (!e) return;
    e.setAttribute("aria-busy", o ? "true" : "false");
    e.innerHTML = k();
    O(e);
  }

  function O(e) {
    var r = function (i) {
        return e.querySelector('[data-air-action="' + i + '"]');
      },
      t = r("generate"),
      rt = r("retry");
    t &&
      t.addEventListener("click", function () {
        A(e);
      });
    rt &&
      rt.addEventListener("click", function () {
        A(e);
      });
    var a = r("toggle-settings");
    a &&
      a.addEventListener("click", function () {
        l = !l;
        s(e);
      });
    var n = r("save-settings");
    n &&
      n.addEventListener("click", function () {
        var i = e.querySelector('[data-air-field="model"]');
        window.__ariseAI.saveSettings(i ? i.value : void 0);
        l = !1;
        s(e);
      });
  }

  function b() {
    return document.getElementById("acm-career-mentor-card");
  }
  function y() {
    var e = b();
    if (!(!e || !e.parentNode)) {
      var r = document.getElementById(g);
      r
        ? e.nextElementSibling !== r && e.parentNode.insertBefore(r, e.nextSibling)
        : (x(),
          (r = document.createElement("section")),
          (r.id = g),
          (r.className = "glass-card rounded-2xl p-5 air-card"),
          r.setAttribute("aria-label", "Real AI Insights"),
          e.parentNode.insertBefore(r, e.nextSibling),
          s(r));
    }
  }
  function h() {
    u ||
      document.hidden ||
      ((u = !0),
      setTimeout(function () {
        u = !1;
        y();
      }, 150));
  }
  function w() {
    var e = 0,
      r = setInterval(function () {
        document.hidden || (e++, (b() || e > 60) && (clearInterval(r), y()));
      }, 200);
    window.__ARISE_MUTATION_BUS__.subscribe(h);
    window.addEventListener("storage", h);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", w) : w();
})();
