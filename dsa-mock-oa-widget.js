/* dsa-mock-oa-widget.js — Timed Mock Online-Assessment simulator for DSA Mastery ("Mock OA" tab).
 * Picks unsolved problems from your own dsaQuestions bank, runs a countdown that survives refresh/tab close,
 * then asks WHY each unsolved problem was missed so you get a pattern of failure, not just a score.
 * Reads dsaQuestions (never writes it — React owns it). Own keys:
 *   dsaMockOAActive   – the running/just-finished session
 *   dsaMockOAHistory  – last 40 finished mocks
 *   dsaMockOASettings – { preset, scope }
 * Presets are generic practice formats, not any company's official pattern. */
(function () {
  if (window.__ARISE_DSA_MOCK_OA__) return;
  window.__ARISE_DSA_MOCK_OA__ = true;
  var MOUNT = 'dmo-mock-oa', STYLE = 'dmo-mock-oa-style';
  var K_ACTIVE = 'dsaMockOAActive', K_HIST = 'dsaMockOAHistory', K_SET = 'dsaMockOASettings';
  var U = window.__ARISE_WIDGET_UTILS__ || {};
  var WEIGHT = { Easy: 1, Medium: 3, Hard: 5 };
  var PRESETS = {
    quick: { label: 'Quick', min: 30, plan: ['Easy', 'Medium'], note: '30 min · 1 Easy + 1 Medium' },
    standard: { label: 'Standard', min: 60, plan: ['Easy', 'Medium', 'Medium'], note: '60 min · 1 Easy + 2 Medium' },
    marathon: { label: 'Marathon', min: 90, plan: ['Easy', 'Medium', 'Hard'], note: '90 min · 1 Easy + 1 Medium + 1 Hard' }
  };
  var MISS = {
    time: { label: 'Ran out of time', tip: 'Time-box: cap each problem at ~15 min for the first pass, then move on and come back.' },
    approach: { label: "Didn't know the approach", tip: 'Study the pattern first (Playbook tab), then solve 3 problems of that pattern before your next mock.' },
    edge: { label: 'Edge cases / bugs', tip: 'Before submitting, test empty input, a single element, duplicates and the max size.' },
    implement: { label: "Couldn't implement it", tip: 'Write pseudocode first, and re-type yesterday\'s solution from scratch to build fluency.' },
    skip: { label: 'Skipped it', tip: 'Attempt every problem for at least 10 minutes — many online tests score per test case, so partial code can still earn marks.' }
  };

  function get(k, fb) { try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; } }
  function set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { if (U.showToast) U.showToast('Storage is full — export a backup from Backup Center.', 'danger'); return false; }
  }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function toast(m, kind) { if (U.showToast) U.showToast(m, kind); }
  function bank() { var q = get('dsaQuestions', []); return Array.isArray(q) ? q.filter(function (x) { return x && x.id != null && x.title; }) : []; }
  function settings() {
    var s = get(K_SET, {}); s = s && typeof s === 'object' ? s : {};
    return { preset: PRESETS[s.preset] ? s.preset : 'standard', scope: typeof s.scope === 'string' && s.scope ? s.scope : 'All' };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(ms) { var t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? h + ':' : '') + pad(m) + ':' + pad(s); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- topic helpers -------------------------------------------------------
  function topicStats(qs) {
    var t = {};
    qs.forEach(function (q) { if (!q.topic) return; var x = t[q.topic] || (t[q.topic] = { total: 0, solved: 0 }); var w = WEIGHT[q.difficulty] || 0; x.total += w; if (q.solved) x.solved += w; });
    return t;
  }
  function weakTopics(qs) {
    var t = topicStats(qs);
    var withUnsolved = {}; qs.forEach(function (q) { if (!q.solved && q.topic) withUnsolved[q.topic] = true; });
    return Object.keys(t).filter(function (k) { return withUnsolved[k]; })
      .sort(function (a, b) { return (t[a].total ? t[a].solved / t[a].total : 0) - (t[b].total ? t[b].solved / t[b].total : 0); }).slice(0, 3);
  }
  function scopePool(qs, scope) {
    var un = qs.filter(function (q) { return !q.solved; });
    if (scope === 'All') return un;
    if (scope === '__weak__') { var w = weakTopics(qs); return un.filter(function (q) { return w.indexOf(q.topic) !== -1; }); }
    return un.filter(function (q) { return q.topic === scope; });
  }

  function pickProblems(qs, presetKey, scope) {
    var plan = PRESETS[presetKey].plan, pool = shuffle(scopePool(qs, scope)), used = {}, out = [];
    function take(pred) { for (var i = 0; i < pool.length; i++) { if (!used[pool[i].id] && pred(pool[i])) { used[pool[i].id] = true; return pool[i]; } } return null; }
    plan.forEach(function (d) { var q = take(function (x) { return x.difficulty === d; }); if (q) out.push(q); });
    while (out.length < plan.length) { var f = take(function () { return true; }); if (!f) break; out.push(f); }
    return out.map(function (q) { return { id: q.id, title: String(q.title), topic: q.topic || '', difficulty: WEIGHT[q.difficulty] ? q.difficulty : 'Medium', link: safeUrl(q.link), solved: false, solvedAt: null, miss: '' }; });
  }

  // ---- session lifecycle ---------------------------------------------------
  function startSession() {
    var s = settings(), qs = bank(), probs = pickProblems(qs, s.preset, s.scope);
    if (!probs.length) { toast('No unsolved problems in this scope — add questions or change scope.', 'danger'); return; }
    var now = Date.now(), min = PRESETS[s.preset].min;
    set(K_ACTIVE, { id: 'mock-' + now, preset: s.preset, durationMin: min, startedAt: now, endsAt: now + min * 60000, finishedAt: null, warned: false, problems: probs });
    render(true);
  }
  function finishSession(reason) {
    var a = get(K_ACTIVE, null); if (!a || a.finishedAt) return;
    a.finishedAt = Math.min(Date.now(), a.endsAt); if (reason === 'early') a.finishedAt = Date.now();
    a.autoEnded = reason === 'timeup';
    set(K_ACTIVE, a); render(true);
    if (reason === 'timeup') toast("Time's up! Log why you missed the unsolved ones.", 'danger');
  }
  function scoreOf(problems) {
    var got = 0, max = 0; problems.forEach(function (p) { var w = WEIGHT[p.difficulty] || 0; max += w; if (p.solved) got += w; });
    return { got: got, max: max, pct: max ? Math.round(got / max * 100) : 0 };
  }
  function saveResult() {
    var a = get(K_ACTIVE, null); if (!a || !a.finishedAt) return;
    var unanswered = a.problems.filter(function (p) { return !p.solved && !p.miss; });
    if (unanswered.length) { toast('Pick a reason for each unsolved problem — that is the useful part.', 'danger'); return; }
    var sc = scoreOf(a.problems), hist = get(K_HIST, []); if (!Array.isArray(hist)) hist = [];
    hist.unshift({ id: a.id, at: a.startedAt, preset: a.preset, durationMin: a.durationMin, usedMin: Math.max(1, Math.round((a.finishedAt - a.startedAt) / 60000)),
      solved: a.problems.filter(function (p) { return p.solved; }).length, total: a.problems.length, score: sc.got, max: sc.max, pct: sc.pct,
      problems: a.problems.map(function (p) { return { title: p.title, topic: p.topic, difficulty: p.difficulty, solved: p.solved, miss: p.miss }; }) });
    set(K_HIST, hist.slice(0, 40)); del(K_ACTIVE); render(true);
    toast('Mock saved — ' + sc.pct + '% score.');
  }

  // ---- history insights ----------------------------------------------------
  function insights(hist) {
    if (!hist.length) return null;
    var pcts = hist.map(function (h) { return h.pct; }), sum = pcts.reduce(function (x, y) { return x + y; }, 0);
    var counts = {}; hist.forEach(function (h) { (h.problems || []).forEach(function (p) { if (!p.solved && p.miss) counts[p.miss] = (counts[p.miss] || 0) + 1; }); });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || null;
    return { n: hist.length, avg: Math.round(sum / hist.length), best: Math.max.apply(null, pcts), top: top, topCount: top ? counts[top] : 0 };
  }

  // ---- view ----------------------------------------------------------------
  function css() {
    if (document.getElementById(STYLE)) return;
    var s = document.createElement('style'); s.id = STYLE;
    s.textContent = [
      '.dmo-block{position:relative;z-index:1;display:flex;flex-direction:column;gap:.9rem}',
      '.dmo-title{font-family:var(--font-display);font-weight:800;font-size:.95rem;color:var(--text-primary,#f1f5ff)}',
      '.dmo-sub{font-size:.74rem;color:var(--text-secondary,#8b93b0);line-height:1.5}',
      '.dmo-chips{display:flex;flex-wrap:wrap;gap:.4rem}',
      '.dmo-chip{padding:.4rem .7rem;border-radius:.7rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:transparent;color:var(--text-secondary,#8b93b0);font-size:.72rem;font-weight:600;cursor:pointer;font-family:inherit}',
      '.dmo-chip.on{background:color-mix(in srgb,var(--info) 16%,transparent);border-color:color-mix(in srgb,var(--info) 40%,transparent);color:var(--text-primary,#f1f5ff)}',
      '.dmo-chip:focus-visible,.dmo-go:focus-visible,.dmo-sel:focus-visible{outline:2px solid var(--accent,var(--info));outline-offset:2px}',
      '.dmo-sel{padding:.4rem .6rem;border-radius:.6rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);font-size:.74rem;max-width:100%}',
      '.dmo-go{align-self:flex-start;padding:.6rem 1.2rem;border-radius:.8rem;border:1px solid color-mix(in srgb,var(--info) 45%,transparent);background:color-mix(in srgb,var(--info) 16%,transparent);color:#7be6ff;font-weight:700;font-size:.8rem;cursor:pointer}',
      '.dmo-go.alt{border-color:var(--border-soft,rgba(255,255,255,.14));background:transparent;color:var(--text-secondary,#8b93b0)}',
      '.dmo-clock{font-family:"JetBrains Mono",monospace;font-weight:800;font-size:2rem;color:var(--text-primary,#f1f5ff)}',
      '.dmo-clock.low{color:var(--danger)}',
      '.dmo-list{display:flex;flex-direction:column;gap:.5rem}',
      '.dmo-row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;padding:.6rem .75rem;border-radius:.85rem;border:1px solid var(--border-soft,rgba(255,255,255,.07));background:var(--surface-soft,rgba(255,255,255,.03))}',
      '.dmo-row.done{border-color:color-mix(in srgb,var(--success) 45%,transparent)}',
      '.dmo-row input[type=checkbox]{width:1.1rem;height:1.1rem}',
      '.dmo-pt{flex:1;min-width:150px;font-size:.8rem;font-weight:700;color:var(--text-primary,#f1f5ff)}',
      '.dmo-pt small{display:block;font-weight:500;color:var(--text-secondary,#8b93b0);font-size:.66rem}',
      '.dmo-pt a{color:var(--info)}',
      '.dmo-tag{font-size:.62rem;font-weight:700;padding:.15rem .5rem;border-radius:999px;border:1px solid var(--border-soft,rgba(255,255,255,.14));color:var(--text-secondary,#8b93b0)}',
      '.dmo-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}',
      '.dmo-stat{padding:.7rem;border-radius:.85rem;background:var(--surface-soft,rgba(255,255,255,.035));border:1px solid var(--border-soft,rgba(255,255,255,.06))}',
      '.dmo-stat b{display:block;font-family:"JetBrains Mono",monospace;font-size:1.15rem;color:var(--text-primary,#f1f5ff)}',
      '.dmo-stat span{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary,#8b93b0)}',
      '.dmo-tip{padding:.65rem .8rem;border-radius:.85rem;font-size:.74rem;line-height:1.5;border:1px solid color-mix(in srgb,var(--warning) 35%,transparent);background:color-mix(in srgb,var(--warning) 8%,transparent);color:var(--text-secondary,#8b93b0)}',
      '.dmo-hist{display:flex;flex-direction:column;gap:.3rem;font-size:.72rem;color:var(--text-secondary,#8b93b0)}',
      '.dmo-hist div{display:flex;justify-content:space-between;gap:.5rem}',
      '.dmo-empty{font-size:.78rem;color:var(--text-secondary,#8b93b0)}',
      "[data-theme-mode='light'] .dmo-title,[data-theme-mode='light'] .dmo-clock,[data-theme-mode='light'] .dmo-pt,[data-theme-mode='light'] .dmo-stat b,[data-theme-mode='light'] .dmo-sel{color:var(--text-primary,#000)}",
      "[data-theme-mode='light'] .dmo-sub,[data-theme-mode='light'] .dmo-chip,[data-theme-mode='light'] .dmo-tip,[data-theme-mode='light'] .dmo-hist,[data-theme-mode='light'] .dmo-stat span,[data-theme-mode='light'] .dmo-pt small{color:var(--text-secondary,#444)}",
      "[data-theme-mode='light'] .dmo-chip.on{color:#000}"
    ].join('');
    document.head.appendChild(s);
  }

  function viewIdle() {
    var qs = bank(), s = settings();
    var topics = {}; qs.forEach(function (q) { if (q.topic && !q.solved) topics[q.topic] = true; });
    var chips = Object.keys(PRESETS).map(function (k) {
      return '<button type="button" class="dmo-chip' + (s.preset === k ? ' on' : '') + '" data-dmo-preset="' + k + '" aria-pressed="' + (s.preset === k) + '">' + PRESETS[k].label + '<br><small>' + PRESETS[k].note + '</small></button>';
    }).join('');
    var opts = '<option value="All"' + (s.scope === 'All' ? ' selected' : '') + '>All topics</option><option value="__weak__"' + (s.scope === '__weak__' ? ' selected' : '') + '>My 3 weakest topics</option>' +
      Object.keys(topics).sort().map(function (t) { return '<option value="' + esc(t) + '"' + (s.scope === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    var avail = scopePool(qs, s.scope).length;
    var h = '<div><div class="dmo-title">🎯 Mock Online Assessment</div><div class="dmo-sub">Practise under a real clock. Problems come from your own unsolved bank; solve them on LeetCode/your platform, tick them here, then log why you missed the rest. Formats are generic practice sets, not any company\'s official pattern.</div></div>' +
      '<div class="dmo-chips" role="group" aria-label="Mock length">' + chips + '</div>' +
      '<label class="dmo-sub">Scope <select class="dmo-sel" data-dmo-scope aria-label="Topic scope">' + opts + '</select></label>' +
      '<div class="dmo-sub">' + avail + ' unsolved problem' + (avail === 1 ? '' : 's') + ' available in this scope.</div>' +
      '<button type="button" class="dmo-go" data-dmo-start' + (avail ? '' : ' disabled') + '>▶ Start mock</button>';
    var ins = insights(get(K_HIST, []));
    if (ins) {
      h += '<div class="dmo-stats"><div class="dmo-stat"><b>' + ins.n + '</b><span>Mocks</span></div><div class="dmo-stat"><b>' + ins.avg + '%</b><span>Avg score</span></div><div class="dmo-stat"><b>' + ins.best + '%</b><span>Best</span></div></div>';
      if (ins.top && MISS[ins.top]) h += '<div class="dmo-tip"><b>Most common miss: ' + esc(MISS[ins.top].label) + '</b> (' + ins.topCount + '×). ' + esc(MISS[ins.top].tip) + '</div>';
      var last = get(K_HIST, []).slice(0, 5).map(function (x) {
        return '<div><span>' + esc(new Date(x.at).toLocaleDateString()) + ' · ' + esc((PRESETS[x.preset] || {}).label || x.preset) + '</span><span>' + x.solved + '/' + x.total + ' solved · ' + x.pct + '%</span></div>';
      }).join('');
      h += '<div class="dmo-hist" aria-label="Recent mocks">' + last + '</div>';
    }
    return h;
  }

  function rowHTML(p, i, mode) {
    var u = p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener noreferrer">' + esc(p.title) + '</a>' : esc(p.title);
    var meta = '<small>' + esc(p.topic) + '</small>';
    if (mode === 'run') {
      return '<div class="dmo-row' + (p.solved ? ' done' : '') + '"><input type="checkbox" data-dmo-solve="' + i + '" aria-label="Mark ' + esc(p.title) + ' solved"' + (p.solved ? ' checked' : '') + '>' +
        '<div class="dmo-pt">' + u + meta + '</div><span class="dmo-tag">' + esc(p.difficulty) + '</span></div>';
    }
    var reasons = p.solved ? '<span class="dmo-tag" style="color:var(--success)">Solved ✓</span>' :
      '<div class="dmo-chips" role="group" aria-label="Why was ' + esc(p.title) + ' missed?">' + Object.keys(MISS).map(function (k) {
        return '<button type="button" class="dmo-chip' + (p.miss === k ? ' on' : '') + '" data-dmo-miss="' + i + '|' + k + '" aria-pressed="' + (p.miss === k) + '">' + esc(MISS[k].label) + '</button>';
      }).join('') + '</div>';
    return '<div class="dmo-row' + (p.solved ? ' done' : '') + '"><div class="dmo-pt">' + u + meta + '</div><span class="dmo-tag">' + esc(p.difficulty) + '</span><div style="flex-basis:100%">' + reasons + '</div></div>';
  }

  function viewRun(a) {
    var rem = a.endsAt - Date.now();
    return '<div><div class="dmo-title">⏱ ' + esc(PRESETS[a.preset] ? PRESETS[a.preset].label : 'Mock') + ' mock in progress</div><div class="dmo-sub">Timer keeps running if you refresh or close the tab. Tick a problem the moment you get it accepted.</div></div>' +
      '<div class="dmo-clock' + (rem <= 600000 ? ' low' : '') + '" role="timer" aria-live="off" data-dmo-clock>' + fmt(rem) + '</div>' +
      '<div class="dmo-list">' + a.problems.map(function (p, i) { return rowHTML(p, i, 'run'); }).join('') + '</div>' +
      '<div class="dmo-chips"><button type="button" class="dmo-go" data-dmo-finish>Finish now</button><button type="button" class="dmo-go alt" data-dmo-abandon>Abandon</button></div>';
  }

  function viewReview(a) {
    var sc = scoreOf(a.problems), solved = a.problems.filter(function (p) { return p.solved; }).length, used = Math.max(1, Math.round((a.finishedAt - a.startedAt) / 60000));
    return '<div><div class="dmo-title">📋 Mock finished' + (a.autoEnded ? " — time's up" : '') + '</div><div class="dmo-sub">For every unsolved problem, pick the honest reason. That pattern is what to fix next.</div></div>' +
      '<div class="dmo-stats"><div class="dmo-stat"><b>' + solved + '/' + a.problems.length + '</b><span>Solved</span></div><div class="dmo-stat"><b>' + sc.pct + '%</b><span>Score</span></div><div class="dmo-stat"><b>' + used + 'm</b><span>Used of ' + a.durationMin + 'm</span></div></div>' +
      '<div class="dmo-list">' + a.problems.map(function (p, i) { return rowHTML(p, i, 'review'); }).join('') + '</div>' +
      '<button type="button" class="dmo-go" data-dmo-save>Save result</button>';
  }

  function render(force) {
    css();
    var el = document.getElementById(MOUNT); if (!el) return;
    el.classList.add('dmo-block');
    var a = get(K_ACTIVE, null), html, running = !!(a && a.problems && !a.finishedAt);
    if (running) {
      if (a.endsAt - Date.now() <= 0) { finishSession('timeup'); return; }
      html = viewRun(a);
      // clock text changes every second — keep it out of the signature so we don't rebuild the list each tick
      html = html.replace(/(data-dmo-clock>)[^<]*/, '$1@@');
    } else if (a && a.problems && a.finishedAt) html = viewReview(a);
    else html = viewIdle();
    if (!force && el.__dmoHtml === html && el.firstChild) return;
    el.__dmoHtml = html;
    el.innerHTML = running ? html.replace('@@', fmt(a.endsAt - Date.now())) : html;
    wire(el);
  }

  function wire(el) {
    if (el.__dmoWired) return; el.__dmoWired = true;
    el.addEventListener('click', function (e) {
      var t = e.target; if (!t.closest) return;
      var b;
      if ((b = t.closest('[data-dmo-preset]'))) { var s = settings(); set(K_SET, { preset: b.getAttribute('data-dmo-preset'), scope: s.scope }); render(true); }
      else if (t.closest('[data-dmo-start]')) startSession();
      else if (t.closest('[data-dmo-finish]')) finishSession('early');
      else if (t.closest('[data-dmo-abandon]')) { if (typeof window.confirm !== 'function' || window.confirm('Abandon this mock? Nothing will be saved.')) { del(K_ACTIVE); render(true); } }
      else if (t.closest('[data-dmo-save]')) saveResult();
      else if ((b = t.closest('[data-dmo-miss]'))) {
        var parts = b.getAttribute('data-dmo-miss').split('|'), a = get(K_ACTIVE, null);
        if (a && a.problems[+parts[0]]) { a.problems[+parts[0]].miss = parts[1]; set(K_ACTIVE, a); render(true); }
      }
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute && t.hasAttribute('data-dmo-scope')) { var s = settings(); set(K_SET, { preset: s.preset, scope: t.value }); render(true); }
      else if (t.hasAttribute && t.hasAttribute('data-dmo-solve')) {
        var a = get(K_ACTIVE, null), i = +t.getAttribute('data-dmo-solve');
        if (a && !a.finishedAt && a.problems[i]) { a.problems[i].solved = !!t.checked; a.problems[i].solvedAt = t.checked ? Date.now() : null; set(K_ACTIVE, a); render(true); }
      }
    });
  }

  // 1-second clock. Uses nodeValue so the DOM mutation observer isn't triggered by every tick.
  function tick() {
    if (document.hidden) return;
    var a = get(K_ACTIVE, null); if (!a || !a.problems || a.finishedAt) return;
    var rem = a.endsAt - Date.now();
    if (rem <= 0) { finishSession('timeup'); return; }
    if (rem <= 600000 && !a.warned) { a.warned = true; set(K_ACTIVE, a); toast('10 minutes left in your mock.'); }
    var c = document.querySelector('#' + MOUNT + ' [data-dmo-clock]');
    if (c && c.firstChild) { c.firstChild.nodeValue = fmt(rem); if (rem <= 600000) c.classList.add('low'); }
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  window.__ARISE_DSA_MOCK_OA_API__ = { pickProblems: pickProblems, insights: insights, scoreOf: scoreOf, PRESETS: PRESETS };
  var mo = function () { render(false); };
  if (U.bootUpdater) U.bootUpdater(mo);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mo); else mo();
})();
