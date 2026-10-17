/* readiness-path-planner-widget.js — "Path to next level" + trend for the Career Readiness card.
 * The 50-LPA card tells you WHERE you are; this tells you what it takes to move up. It never re-implements the
 * scoring: every number comes from what-if runs of the real calculator (window.__ARISE_CAREER_READINESS_API__),
 * so it can't drift from the card. Read-only — no storage keys of its own.
 * Inputs mirror the card: dsaQuestions, devTasks, cse-syllabus-progress-v1, streak, notes, exams.
 * History comes from the card's own key: arise-career-readiness-history-v1. */
(function () {
  if (window.__ARISE_READINESS_PLANNER__) return;
  window.__ARISE_READINESS_PLANNER__ = true;
  var MOUNT = 'rpp-planner', STYLE = 'rpp-planner-style', CARD = 'lpa50-readiness-card', HIST = 'arise-career-readiness-history-v1', LA_CFG = 'arise-la-config-v1';
  var U = window.__ARISE_WIDGET_UTILS__ || {};
  var DAY = 864e5, SYLLABUS_TOTAL = 56, STREAK_CAP = 30;

  function get(k, fb) { try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; } }
  function num(k, fb) { try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return typeof p === 'number' && isFinite(p) ? p : fb; } catch (e) { var n; try { n = Number(localStorage.getItem(k)); } catch (e2) { return fb; } return isFinite(n) ? n : fb; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function stamp(ms) { return new Date(ms).toISOString().slice(0, 10); }

  function inputs() {
    var syl = get('cse-syllabus-progress-v1', {});
    return { dsaQuestions: arr(get('dsaQuestions', [])), devTasks: arr(get('devTasks', [])), syllabus: syl && typeof syl === 'object' ? syl : {},
      streak: num('streak', 0), notes: arr(get('notes', [])), exams: arr(get('exams', [])) };
  }
  function clone(d) { return { dsaQuestions: d.dsaQuestions.map(function (q) { return q && typeof q === 'object' ? Object.assign({}, q) : q; }), devTasks: d.devTasks.map(function (t) { return t && typeof t === 'object' ? Object.assign({}, t) : t; }), syllabus: Object.assign({}, d.syllabus), streak: d.streak, notes: d.notes, exams: d.exams }; }

  // ---- levers: each knows how to apply n hypothetical actions and how many it can apply at most -------------------
  var DSA_ORDER = { Medium: 0, Easy: 1, Hard: 2 };   // best points-per-effort first
  var DEV_ORDER = { Intermediate: 0, Beginner: 1, Advanced: 2 };
  function ordered(list, isDone, order, key) {
    return list.map(function (x, i) { return { x: x, i: i }; }).filter(function (o) { return o.x && !isDone(o.x); })
      .sort(function (a, b) { var ra = order[a.x[key]] == null ? 9 : order[a.x[key]], rb = order[b.x[key]] == null ? 9 : order[b.x[key]]; return ra - rb || a.i - b.i; });
  }
  function levers(base) {
    var dsaTodo = ordered(base.dsaQuestions, function (q) { return q.solved; }, DSA_ORDER, 'difficulty').filter(function (o) { return { Easy: 1, Medium: 1, Hard: 1 }[o.x.difficulty]; });
    var devTodo = ordered(base.devTasks, function (t) { return t.completed; }, DEV_ORDER, 'difficulty').filter(function (o) { return { Beginner: 1, Intermediate: 1, Advanced: 1 }[o.x.difficulty]; });
    var cleared = Object.keys(base.syllabus).filter(function (k) { return !!base.syllabus[k]; }).length;
    return [
      { key: 'dsa', icon: '🧠', label: 'DSA', unit: 'DSA problem', max: dsaTodo.length,
        note: dsaTodo.length ? 'Mediums first — best points per effort, then Easy, then Hard.' : (base.dsaQuestions.length ? 'Every question in your bank is solved — add new ones.' : 'Add questions in the DSA tracker to use this lever.'),
        apply: function (d, n) { for (var i = 0; i < n; i++) d.dsaQuestions[dsaTodo[i].i].solved = true; } },
      { key: 'development', icon: '💻', label: 'Development', unit: 'Dev Skill Task', max: devTodo.length,
        note: devTodo.length ? 'Intermediate tasks first, then Beginner, then Advanced.' : (base.devTasks.length ? 'All Dev Skill Tasks are complete — add new ones.' : 'Log Dev Skill Tasks in the Learning tracker to use this lever.'),
        apply: function (d, n) { for (var i = 0; i < n; i++) d.devTasks[devTodo[i].i].completed = true; } },
      { key: 'cseSyllabus', icon: '📚', label: 'CSE Syllabus', unit: 'syllabus subject', max: Math.max(0, SYLLABUS_TOTAL - cleared),
        note: 'Each cleared subject is 1 of ' + SYLLABUS_TOTAL + ' in the syllabus tracker.',
        apply: function (d, n) { for (var i = 0; i < n; i++) d.syllabus['__sim' + i] = true; } },
      { key: 'consistency', icon: '🔥', label: 'Consistency', unit: 'more streak day', max: Math.max(0, STREAK_CAP - Math.max(0, base.streak)),
        note: 'Streak counts up to ' + STREAK_CAP + ' days (70% of this score); notes + exam entries make up the rest.',
        apply: function (d, n) { d.streak = base.streak + n; } }
    ];
  }

  function totalWith(api, base, lever, n) {
    var d = clone(base); if (n > 0) lever.apply(d, n);
    return api.calculateCareerReadiness(d);
  }
  // smallest n (1..max) whose total >= target; null if even max isn't enough. Scores are monotonic in n → binary search.
  function minActions(api, base, lever, target) {
    if (lever.max <= 0) return { n: null, best: null };
    var top = totalWith(api, base, lever, lever.max).total;
    if (top < target) return { n: null, best: top };
    var lo = 1, hi = lever.max;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (totalWith(api, base, lever, mid).total >= target) hi = mid; else lo = mid + 1; }
    return { n: lo, best: top };
  }
  function perAction(api, base, lever, cur) {
    if (lever.max <= 0) return 0;
    var k = Math.min(5, lever.max);
    return (totalWith(api, base, lever, k).rawTotal - cur.rawTotal) / k;
  }
  function pace(qs, now) {
    var c = 0, cutoff = stamp(now - 14 * DAY);
    qs.forEach(function (q) { if (q && q.solved && typeof q.dateSolved === 'string' && q.dateSolved.slice(0, 10) >= cutoff) c++; });
    return c / 14;
  }

  function plan(api, base, now) {
    var cur = api.calculateCareerReadiness(base), lv = cur.level, levels = api.LEVELS, atTop = lv.index >= levels.length - 1;
    var target = atTop ? 100 : levels[lv.index].max + 1, targetLabel = atTop ? 'a perfect 100' : levels[lv.index + 1].label;
    var dsaPace = pace(base.dsaQuestions, now);
    var rows = levers(base).map(function (l) {
      var m = atTop ? { n: null, best: null } : minActions(api, base, l, target);
      var per = perAction(api, base, l, cur);
      var eta = null;
      if (l.key === 'dsa' && m.n && dsaPace > 0) eta = Math.ceil(m.n / dsaPace);
      if (l.key === 'consistency' && m.n) eta = m.n;
      return { lever: l, n: m.n, best: m.best, per: per, eta: eta };
    });
    var usable = rows.filter(function (r) { return r.lever.max > 0; }).sort(function (a, b) { return b.per - a.per; });
    return { cur: cur, target: target, targetLabel: targetLabel, atTop: atTop, rows: rows, bestKey: usable.length && usable[0].per > 0 ? usable[0].lever.key : null, dsaPace: dsaPace };
  }

  // ---- trend ------------------------------------------------------------------------------------------------------
  function trend(now) {
    var h = arr(get(HIST, [])).filter(function (p) { return p && typeof p.date === 'string' && isFinite(Number(p.score)); }).slice(-30);
    if (h.length < 2) return { pts: h, ok: false };
    function delta(days) {
      var cutoff = stamp(now - days * DAY), ref = null;
      for (var i = 0; i < h.length; i++) if (h[i].date <= cutoff) ref = h[i];
      if (!ref) ref = h[0];
      return Math.round((Number(h[h.length - 1].score) - Number(ref.score)) * 10) / 10;
    }
    var scores = h.map(function (p) { return Number(p.score); });
    return { pts: h, ok: true, d7: delta(7), d30: delta(30), best: Math.max.apply(null, scores), latest: scores[scores.length - 1] };
  }
  function spark(pts) {
    var w = 220, ht = 44, s = pts.map(function (p) { return Number(p.score); }), mn = Math.min.apply(null, s), mx = Math.max.apply(null, s), span = mx - mn || 1;
    var path = s.map(function (v, i) { return (i ? 'L' : 'M') + (i / (s.length - 1) * w).toFixed(1) + ' ' + (ht - 4 - (v - mn) / span * (ht - 8)).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + ht + '" width="100%" height="' + ht + '" preserveAspectRatio="none" role="img" aria-label="Readiness score, last ' + s.length + ' recorded days"><path d="' + path + '" fill="none" stroke="var(--info)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  // ---- placement-date projection ----------------------------------------------------------------------------------
  // The date lives in the Session Analytics config (arise-la-config-v1.placementDate) so it is set once for the whole app.
  function placementDate() { var c = get(LA_CFG, {}); return c && typeof c.placementDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.placementDate) ? c.placementDate : null; }
  function savePlacementDate(v) {
    var c = get(LA_CFG, {}); c = c && typeof c === 'object' ? c : {};
    if (v) c.placementDate = v; else delete c.placementDate;
    if (c.schemaVersion == null) c.schemaVersion = 1;
    try { localStorage.setItem(LA_CFG, JSON.stringify(c)); return true; } catch (e) { if (U.showToast) U.showToast('Storage is full — export a backup from Backup Center.', 'danger'); return false; }
  }
  function deadline(now, tr, p) {
    var date = placementDate(); if (!date) return null;
    var days = Math.ceil((Date.parse(date + 'T00:00:00Z') - Date.parse(stamp(now) + 'T00:00:00Z')) / DAY);
    if (days < 0) return { date: date, past: true };
    var weeks = Math.max(days / 7, 1 / 7), gap = p.atTop ? 0 : Math.max(0, p.target - p.cur.total), pace = null;
    if (tr.ok) {
      var cutoff = stamp(now - 30 * DAY), ref = null;
      for (var i = 0; i < tr.pts.length; i++) if (tr.pts[i].date >= cutoff) { ref = tr.pts[i]; break; }
      ref = ref || tr.pts[0];
      var last = tr.pts[tr.pts.length - 1], span = (Date.parse(last.date + 'T00:00:00Z') - Date.parse(ref.date + 'T00:00:00Z')) / DAY;
      if (span >= 3) pace = (Number(last.score) - Number(ref.score)) / span * 7;
    }
    var projected = pace == null ? null : Math.max(0, Math.min(100, Math.round((p.cur.total + pace * weeks) * 10) / 10));
    return { date: date, days: days, weeks: weeks, gap: gap, need: gap / weeks, pace: pace == null ? null : Math.round(pace * 10) / 10, projected: projected,
      onTrack: pace == null ? null : (gap === 0 || pace >= gap / weeks) };
  }
  function deadlineHTML(dl, p) {
    var input = '<label class="rpp-note">Placement date <input type="date" class="rpp-date" data-rpp-date value="' + esc(dl && dl.date || '') + '" aria-label="Placement date"></label>';
    if (!dl) return '<div class="rpp-deadline"><div class="rpp-note">Set your placement date to see whether your current pace gets you to the next level in time.</div>' + input + '</div>';
    if (dl.past) return '<div class="rpp-deadline"><div class="rpp-note">The saved placement date (' + esc(dl.date) + ') has passed — pick the next one.</div>' + input + '</div>';
    var head = dl.days + ' day' + (dl.days === 1 ? '' : 's') + ' to your placement date', body;
    if (p.atTop) body = 'You are already at the top level — just keep it above 80%.';
    else if (dl.pace == null) body = 'To reach ' + esc(p.targetLabel) + ' by then you need about +' + (Math.round(dl.need * 10) / 10) + ' pts per week. (A pace estimate appears once the card has 3+ days of history.)';
    else body = 'You need about +' + (Math.round(dl.need * 10) / 10) + ' pts/week for ' + esc(p.targetLabel) + '. Your recent pace is ' + (dl.pace > 0 ? '+' : '') + dl.pace + ' pts/week, which lands you at ≈ ' + dl.projected + '% — ' +
      (dl.onTrack ? '<b class="rpp-up">on track</b>' : '<b class="rpp-down">behind</b>, so pick the fastest lever above and start this week') + '.';
    return '<div class="rpp-deadline"><div class="rpp-eyebrow" style="margin-bottom:.3rem">⏳ ' + head + '</div><div class="rpp-sub">' + body + '</div>' + input + '</div>';
  }
  function sign(n) { return (n > 0 ? '+' : '') + n; }

  // ---- view -------------------------------------------------------------------------------------------------------
  function css() {
    if (document.getElementById(STYLE)) return;
    var s = document.createElement('style'); s.id = STYLE;
    s.textContent = [
      '.rpp-card{position:relative;border-radius:var(--radius-xl,1.4rem);padding:1.4rem;margin-top:1rem;background:var(--bg-card,var(--surface,#111827));border:1px solid var(--border-soft,var(--border,rgba(255,255,255,.07)));font-family:var(--font-body)}',
      '.rpp-eyebrow{font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--info);margin-bottom:.6rem}',
      '.rpp-head{font-family:var(--font-display);font-weight:800;font-size:1.05rem;color:var(--text-primary,#f1f5ff);line-height:1.35}',
      '.rpp-sub{font-size:.74rem;color:var(--text-secondary,#8b93b0);line-height:1.5;margin-top:.25rem}',
      '.rpp-grid{display:grid;grid-template-columns:1fr;gap:.6rem;margin-top:.9rem}',
      '@media (min-width:720px){.rpp-grid{grid-template-columns:1fr 1fr}}',
      '.rpp-lever{padding:.75rem .85rem;border-radius:.9rem;border:1px solid var(--border-soft,rgba(255,255,255,.07));background:var(--surface-soft,rgba(255,255,255,.03))}',
      '.rpp-lever.best{border-color:color-mix(in srgb,var(--success) 50%,transparent)}',
      '.rpp-lever.off{opacity:.65}',
      '.rpp-lt{display:flex;justify-content:space-between;gap:.5rem;font-size:.72rem;font-weight:700;color:var(--text-secondary,#8b93b0);text-transform:uppercase;letter-spacing:.05em}',
      '.rpp-badge{font-size:.6rem;padding:.1rem .45rem;border-radius:999px;background:color-mix(in srgb,var(--success) 16%,transparent);color:var(--success);letter-spacing:0;text-transform:none}',
      '.rpp-big{font-family:var(--font-display);font-weight:800;font-size:.98rem;color:var(--text-primary,#f1f5ff);margin-top:.3rem;line-height:1.35}',
      '.rpp-note{font-size:.66rem;color:var(--text-secondary,#8b93b0);line-height:1.5;margin-top:.25rem}',
      '.rpp-trend{display:grid;grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr));gap:.7rem;align-items:center;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-soft,rgba(255,255,255,.07))}',
      '@media (max-width:600px){.rpp-trend{grid-template-columns:1fr 1fr 1fr}.rpp-trend>:first-child{grid-column:1/-1}}',
      '.rpp-stat b{display:block;font-family:"JetBrains Mono",monospace;font-size:1rem;color:var(--text-primary,#f1f5ff)}',
      '.rpp-stat span{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary,#8b93b0)}',
      '.rpp-up{color:var(--success)!important}.rpp-down{color:var(--danger)!important}',
      '.rpp-deadline{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-soft,rgba(255,255,255,.07))}',
      '.rpp-date{margin-left:.4rem;padding:.3rem .5rem;border-radius:.6rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);font-size:.72rem}',
      '.rpp-warn{margin-top:.9rem;padding:.65rem .8rem;border-radius:.85rem;font-size:.72rem;line-height:1.5;border:1px solid color-mix(in srgb,var(--warning) 35%,transparent);background:color-mix(in srgb,var(--warning) 8%,transparent);color:var(--text-secondary,#8b93b0)}',
      "[data-theme-mode='light'] .rpp-head,[data-theme-mode='light'] .rpp-big,[data-theme-mode='light'] .rpp-stat b{color:var(--text-primary,#000)}",
      "[data-theme-mode='light'] .rpp-sub,[data-theme-mode='light'] .rpp-note,[data-theme-mode='light'] .rpp-lt,[data-theme-mode='light'] .rpp-stat span,[data-theme-mode='light'] .rpp-warn{color:var(--text-secondary,#444)}"
    ].join('');
    document.head.appendChild(s);
  }

  function leverHTML(p, r) {
    var l = r.lever, best = p.bestKey === l.key, txt;
    if (p.atTop) txt = 'Hold this above 80 — keep the habit going.';
    else if (l.max <= 0) txt = 'Nothing to do here yet';
    else if (r.n == null) txt = 'Maxing this out only reaches ' + r.best + ' — combine with another lever';
    else txt = r.n + ' more ' + l.unit + (r.n === 1 ? '' : 's') + (l.key === 'consistency' ? '' : ' alone');
    var eta = r.eta ? (l.key === 'dsa' ? ' · ≈ ' + r.eta + ' day' + (r.eta === 1 ? '' : 's') + ' at your pace (' + p.dsaPace.toFixed(1) + '/day)' : '') : '';
    var per = l.max > 0 && r.per > 0 ? '≈ +' + (Math.round(r.per * 100) / 100) + ' pts per ' + l.unit : '';
    return '<div class="rpp-lever' + (best ? ' best' : '') + (l.max <= 0 ? ' off' : '') + '"><div class="rpp-lt"><span>' + l.icon + ' ' + esc(l.label) + '</span>' + (best ? '<span class="rpp-badge">best return per action</span>' : '') + '</div>' +
      '<div class="rpp-big">' + esc(txt) + '</div><div class="rpp-note">' + esc(per) + esc(eta) + (per || eta ? '<br>' : '') + esc(l.note) + '</div></div>';
  }

  function build(now) {
    var api = window.__ARISE_CAREER_READINESS_API__;
    if (!api || typeof api.calculateCareerReadiness !== 'function') return null;
    var base = inputs(), p = plan(api, base, now), tr = trend(now), cur = p.cur;
    var gap = p.atTop ? 0 : p.target - cur.total;
    var head = p.atTop ? 'You are at the top level (' + cur.total + '%). Keep every pillar healthy.' : 'You need +' + gap + ' points to reach ' + esc(p.targetLabel) + ' (' + p.target + '%)';
    var html = '<div class="rpp-eyebrow">🧭 Path to next level</div><div class="rpp-head">' + head + '</div><div class="rpp-sub">You are at ' + cur.total + '%. Each option below is calculated with the same scoring as the card above — pick whichever you can actually do this week.</div>' +
      '<div class="rpp-grid">' + p.rows.map(function (r) { return leverHTML(p, r); }).join('') + '</div>';
    // bank-size caveat (DSA score is a ratio against the whole bank)
    var solvedW = 0, totalW = 0, W = { Easy: 1, Medium: 3, Hard: 5 };
    base.dsaQuestions.forEach(function (q) { if (!q || !W[q.difficulty]) return; totalW += W[q.difficulty]; if (q.solved) solvedW += W[q.difficulty]; });
    if (totalW > 0 && solvedW / totalW < 0.5 && base.dsaQuestions.filter(function (q) { return q && !q.solved; }).length >= 2 * base.dsaQuestions.filter(function (q) { return q && q.solved; }).length && solvedW > 0)
      html += '<div class="rpp-warn"><b>Heads-up on the DSA score:</b> it is solved points ÷ points in your whole question bank. A big imported backlog lowers it even while you improve, so read it as “how much of my list is done”, not a measure of ability.</div>';
    html += deadlineHTML(deadline(now, tr, p), p);
    if (tr.ok) {
      var cls = function (n) { return n > 0 ? 'rpp-up' : n < 0 ? 'rpp-down' : ''; };
      html += '<div class="rpp-trend"><div>' + spark(tr.pts) + '</div><div class="rpp-stat"><b class="' + cls(tr.d7) + '">' + sign(tr.d7) + '</b><span>vs 7 days ago</span></div><div class="rpp-stat"><b class="' + cls(tr.d30) + '">' + sign(tr.d30) + '</b><span>vs 30 days ago</span></div><div class="rpp-stat"><b>' + Math.round(tr.best) + '</b><span>best recorded</span></div></div>';
    } else html += '<div class="rpp-note" style="margin-top:.9rem">Your trend line appears after the card has recorded two different days — open the dashboard on 2+ days.</div>';
    return html;
  }

  function render() {
    css();
    var card = document.getElementById(CARD); if (!card || !card.parentNode) return;
    var now = Date.now(), html = build(now); if (html == null) return;
    var el = document.getElementById(MOUNT);
    if (!el) { el = document.createElement('div'); el.id = MOUNT; el.className = 'rpp-card'; }
    if (el.previousElementSibling !== card || el.parentNode !== card.parentNode) card.parentNode.insertBefore(el, card.nextSibling);
    if (el.__rppHtml === html && el.firstChild) return;
    el.__rppHtml = html; el.innerHTML = html;
    if (!el.__rppWired) {
      el.__rppWired = true;
      el.addEventListener('change', function (e) {
        var t = e.target; if (!t || !t.hasAttribute || !t.hasAttribute('data-rpp-date')) return;
        var v = t.value; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
        if (savePlacementDate(v || null)) { el.__rppHtml = null; render(); }
      });
    }
  }

  window.__ARISE_READINESS_PLANNER_API__ = { plan: plan, trend: trend, inputs: inputs, levers: levers, deadline: deadline };
  if (U.bootUpdater) U.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
