/* dsa-daily-goal-widget.js — Daily Goal + streak-save nudge for DSA Mastery (Overview tab).
 * Reads dsaQuestions (never writes it). Own key: dsaDailyGoal = { target }.
 * "Day" = the same UTC date stamp the app writes into dateSolved, so it always agrees with the streak widget. */
(function () {
  if (window.__ARISE_DSA_DAILY_GOAL__) return;
  window.__ARISE_DSA_DAILY_GOAL__ = true;
  var MOUNT = 'dgl-daily-goal', STYLE = 'dgl-daily-goal-style', KEY = 'dsaDailyGoal', DAY = 864e5;
  var U = window.__ARISE_WIDGET_UTILS__ || {};
  var WEIGHT = { Easy: 1, Medium: 3, Hard: 5 };

  function get(k, fb) {
    try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; }
  }
  function set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { if (U.showToast) U.showToast('Storage is full — export a backup from Backup Center.', 'danger'); return false; }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function stamp(ms) { return new Date(ms).toISOString().slice(0, 10); }

  function quickPick(qs) {
    var topics = {};
    qs.forEach(function (q) {
      if (!q || !q.topic) return;
      var t = topics[q.topic] || (topics[q.topic] = { total: 0, solved: 0, easy: null });
      var w = WEIGHT[q.difficulty] || 0;
      t.total += w; if (q.solved) t.solved += w;
      if (!q.solved && q.difficulty === 'Easy' && !t.easy) t.easy = q;
    });
    var best = null;
    Object.keys(topics).forEach(function (k) {
      var t = topics[k]; if (!t.easy) return;
      var pct = t.total > 0 ? t.solved / t.total : 0;
      if (!best || pct < best.pct) best = { pct: pct, topic: k, q: t.easy };
    });
    return best;
  }

  function analyze(now) {
    var qs = get('dsaQuestions', []); if (!Array.isArray(qs)) qs = [];
    var g = get(KEY, {});
    var target = clamp(Math.round(Number(g && g.target)) || 2, 1, 10);
    var by = {};
    qs.forEach(function (q) {
      if (q && q.solved && typeof q.dateSolved === 'string' && /^\d{4}-\d{2}-\d{2}/.test(q.dateSolved)) {
        var k = q.dateSolved.slice(0, 10); by[k] = (by[k] || 0) + 1;
      }
    });
    var days = [];
    for (var i = 13; i >= 0; i--) { var k = stamp(now - i * DAY); days.push({ key: k, n: by[k] || 0 }); }
    var today = days[13].n, week = 0;
    for (var j = 7; j < 14; j++) week += days[j].n;
    var streak = 0;
    for (var d = 13; d >= 0; d--) {
      if (d === 13 && days[d].n < target) continue; // today still pending — don't break the streak yet
      if (days[d].n >= target) streak++; else break;
    }
    return { has: qs.length > 0, target: target, days: days, today: today, week: week, streak: streak, pick: quickPick(qs) };
  }

  function css() {
    if (document.getElementById(STYLE)) return;
    var s = document.createElement('style'); s.id = STYLE;
    s.textContent = [
      '.dgl-block{margin-top:1.1rem;padding-top:1.1rem;border-top:1px solid var(--border-soft,var(--border,rgba(255,255,255,.07)));position:relative;z-index:1}',
      '.dgl-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.7rem;flex-wrap:wrap}',
      '.dgl-title{font-size:.68rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted,var(--text-tertiary,#5c6480))}',
      '.dgl-step{display:flex;align-items:center;gap:.4rem;font-size:.72rem;color:var(--text-secondary,#8b93b0)}',
      '.dgl-btn{width:1.7rem;height:1.7rem;border-radius:.5rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);cursor:pointer;font-weight:700}',
      '.dgl-btn:focus-visible{outline:2px solid var(--accent,var(--info));outline-offset:2px}',
      '.dgl-body{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}',
      '.dgl-txt{flex:1;min-width:180px}',
      '.dgl-main{font-size:.9rem;font-weight:700;color:var(--text-primary,#f1f5ff)}',
      '.dgl-sub{font-size:.72rem;color:var(--text-secondary,#8b93b0);margin-top:.15rem;line-height:1.4}',
      '.dgl-strip{display:flex;gap:3px;margin-top:.5rem}',
      '.dgl-cell{width:14px;height:14px;border-radius:4px;background:var(--surface-soft,rgba(255,255,255,.07))}',
      '.dgl-cell.part{background:color-mix(in srgb,var(--warning) 55%,transparent)}',
      '.dgl-cell.full{background:var(--success)}',
      '.dgl-nudge{margin-top:.7rem;padding:.6rem .75rem;border-radius:.8rem;font-size:.74rem;line-height:1.45;border:1px solid color-mix(in srgb,var(--warning) 35%,transparent);background:color-mix(in srgb,var(--warning) 8%,transparent);color:var(--text-secondary,#8b93b0)}',
      '.dgl-nudge a{color:var(--info);font-weight:700}',
      '.dgl-empty{font-size:.78rem;color:var(--text-secondary,#8b93b0)}',
      "[data-theme-mode='light'] .dgl-main,[data-theme-mode='light'] .dgl-btn{color:var(--text-primary,#000)}",
      "[data-theme-mode='light'] .dgl-sub,[data-theme-mode='light'] .dgl-title,[data-theme-mode='light'] .dgl-step,[data-theme-mode='light'] .dgl-nudge{color:var(--text-secondary,#444)}"
    ,
      "[data-theme-mode='light'] circle[stroke='rgba(255,255,255,.1)']{stroke:var(--border-soft,var(--border,rgba(15,23,42,.14)))}"
    ].join('');
    document.head.appendChild(s);
  }

  function ring(n, t) {
    var C = 2 * Math.PI * 26, off = C - Math.min(1, n / t) * C, done = n >= t;
    return '<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-90 32 32)"><circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,.1)" stroke-width="7" fill="none"/>' +
      '<circle cx="32" cy="32" r="26" stroke="' + (done ? 'var(--success)' : 'var(--info)') + '" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/></g>' +
      '<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="800" fill="currentColor">' + n + '/' + t + '</text></svg>';
  }

  function build(a, hour) {
    var head = '<div class="dgl-head"><span class="dgl-title">🎯 Daily Goal</span><span class="dgl-step">Target' +
      '<button type="button" class="dgl-btn" data-dgl-dec aria-label="Lower daily target">−</button><b>' + a.target + '/day</b>' +
      '<button type="button" class="dgl-btn" data-dgl-inc aria-label="Raise daily target">+</button></span></div>';
    if (!a.has) return head + '<span class="dgl-empty">Add DSA questions to start tracking a daily goal.</span>';
    var met = a.today >= a.target, left = a.target - a.today;
    var main = met ? 'Goal hit today 🎉' : left + ' more to hit today\'s goal';
    var sub = a.streak > 0 ? a.streak + '-day goal streak · ' : '';
    sub += 'last 7 days: ' + a.week + ' solved (avg ' + (a.week / 7).toFixed(1) + '/day)';
    var cells = a.days.map(function (d) {
      var c = d.n >= a.target ? 'full' : d.n > 0 ? 'part' : '';
      return '<span class="dgl-cell ' + c + '" title="' + esc(d.key) + ': ' + d.n + ' solved"></span>';
    }).join('');
    var nudge = '';
    if (a.today === 0 && hour >= 18) {
      nudge = 'Nothing solved yet today. Even one Easy keeps your streak alive.';
      if (a.pick) {
        var u = safeUrl(a.pick.q.link);
        nudge += ' Quick pick (' + esc(a.pick.topic) + '): ' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(a.pick.q.title) + '</a>' : '<b>' + esc(a.pick.q.title) + '</b>') + '.';
      }
    }
    return head + '<div class="dgl-body"><div>' + ring(a.today, a.target) + '</div><div class="dgl-txt"><div class="dgl-main">' + main + '</div><div class="dgl-sub">' + sub +
      '</div><div class="dgl-strip" aria-label="Last 14 days">' + cells + '</div></div></div>' + (nudge ? '<div class="dgl-nudge">' + nudge + '</div>' : '');
  }

  function render() {
    css();
    var el = document.getElementById(MOUNT); if (!el) return;
    el.classList.add('dgl-block');
    var html = build(analyze(Date.now()), new Date().getHours());
    if (el.__dglHtml === html && el.firstChild) return;
    el.__dglHtml = html; el.innerHTML = html;
    if (!el.__dglWired) {
      el.__dglWired = true;
      el.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-dgl-dec],[data-dgl-inc]') : null; if (!t) return;
        var cur = analyze(Date.now()).target;
        set(KEY, { target: clamp(cur + (t.hasAttribute('data-dgl-inc') ? 1 : -1), 1, 10) });
        render();
      });
    }
  }

  window.__ARISE_DSA_DAILY_GOAL_API__ = { analyze: analyze };
  if (U.bootUpdater) U.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
