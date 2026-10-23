/* aptitude-practice-widget.js — Aptitude & Reasoning practice tracker ("Aptitude" tab of the DSA/placement card).
 * Why: for mass-recruiter and service-company drives the aptitude round is usually the first filter, and the
 * readiness engine only had a proxy for it (average exam-confidence). This logs real timed practice, shows where you
 * lose marks, and feeds a real aptitude score into Readiness.
 *
 * Storage (own keys, registered in storage-keys.js):
 *   arise-aptitude-log-v1      { sessions:[{id,at,section,topic,attempted,correct,timeMin}], settings:{targetAcc,weeklySets} }
 *   arise-aptitude-summary-v1  { score, questions, latest, updatedAt }  ← read by readiness-engine.js (write-through, so the
 *                               engine never has to duplicate this file's maths). Engine ignores it until 30+ questions in 60 days.
 * Topic lists are common aptitude-test areas, not any specific company's syllabus. */
(function () {
  if (window.__ARISE_APTITUDE__) return;
  var MOUNT = 'apt-practice', STYLE = 'apt-practice-style', K_LOG = 'arise-aptitude-log-v1', K_SUM = 'arise-aptitude-summary-v1';
  var DAY = 864e5, WINDOW_DAYS = 60, MIN_Q = 30, MAX_SESSIONS = 1000;
  var U = window.__ARISE_WIDGET_UTILS__ || {};
  var SECTIONS = {
    Quant: ['Percentages', 'Profit & Loss', 'Ratio & Proportion', 'Time & Work', 'Time, Speed & Distance', 'Averages', 'Simple & Compound Interest', 'Number System', 'Permutation & Combination', 'Probability', 'Number Series', 'Mixtures & Alligation'],
    Logical: ['Series & Patterns', 'Syllogisms', 'Blood Relations', 'Coding-Decoding', 'Seating Arrangement', 'Direction Sense', 'Puzzles', 'Data Sufficiency'],
    Verbal: ['Reading Comprehension', 'Sentence Correction', 'Synonyms & Antonyms', 'Para Jumbles', 'Fill in the Blanks'],
    'Data Interpretation': ['Tables', 'Bar & Line Charts', 'Pie Charts'],
    'Technical MCQ': ['Operating Systems', 'DBMS & SQL', 'Computer Networks', 'OOP Concepts', 'C / Java Output Questions']
  };
  var ICON = { Quant: '➗', Logical: '🧩', Verbal: '📖', 'Data Interpretation': '📊', 'Technical MCQ': '💻' };

  function get(k, fb) { try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { if (U.showToast) U.showToast('Storage is full — export a backup from Backup Center.', 'danger'); return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function toast(m, k) { if (U.showToast) U.showToast(m, k); }
  function dayStr(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  function load() {
    var raw = get(K_LOG, {}); raw = raw && typeof raw === 'object' ? raw : {};
    var sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(function (s) {
      return s && SECTIONS[s.section] && isFinite(s.at) && isFinite(s.attempted) && isFinite(s.correct) && s.attempted > 0 && s.correct >= 0 && s.correct <= s.attempted;
    }).map(function (s) { return { id: String(s.id || s.at), at: Number(s.at), section: s.section, topic: typeof s.topic === 'string' ? s.topic : '', attempted: Math.round(s.attempted), correct: Math.round(s.correct), timeMin: isFinite(s.timeMin) && s.timeMin >= 0 ? Number(s.timeMin) : 0 }; })
      .sort(function (a, b) { return b.at - a.at; }).slice(0, MAX_SESSIONS);
    var st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    return { sessions: sessions, settings: { targetAcc: clamp(Math.round(Number(st.targetAcc)) || 75, 40, 100), weeklySets: clamp(Math.round(Number(st.weeklySets)) || 5, 1, 21) } };
  }
  function save(d) { return put(K_LOG, { version: 1, sessions: d.sessions, settings: d.settings }); }

  function agg(list) {
    var a = 0, c = 0, t = 0; list.forEach(function (s) { a += s.attempted; c += s.correct; t += s.timeMin; });
    return { n: list.length, attempted: a, correct: c, acc: a ? Math.round(c / a * 100) : null, secPerQ: a && t > 0 ? Math.round(t * 60 / a) : null };
  }
  function analyze(d, now) {
    var cut = now - WINDOW_DAYS * DAY, recent = d.sessions.filter(function (s) { return s.at >= cut; });
    var week = d.sessions.filter(function (s) { return s.at >= now - 7 * DAY; });
    var perSection = {}, perTopic = {}, lastTopic = {};
    Object.keys(SECTIONS).forEach(function (k) { perSection[k] = agg(recent.filter(function (s) { return s.section === k; })); });
    d.sessions.forEach(function (s) { if (!s.topic) return; var key = s.section + '|' + s.topic; (perTopic[key] = perTopic[key] || []).push(s); if (!lastTopic[key] || s.at > lastTopic[key]) lastTopic[key] = s.at; });
    var weak = [], stale = [], untouched = [];
    var startOfDay = function (ms) { var dt = new Date(ms); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime(); };
    var todayStart = startOfDay(now);
    Object.keys(SECTIONS).forEach(function (sec) {
      SECTIONS[sec].forEach(function (t) {
        var key = sec + '|' + t, list = perTopic[key];
        if (!list) { untouched.push({ section: sec, topic: t }); return; }
        var a = agg(list);
        if (a.attempted >= 10 && a.acc < d.settings.targetAcc) weak.push({ section: sec, topic: t, acc: a.acc, attempted: a.attempted, gap: d.settings.targetAcc - a.acc });
        var staleDays = Math.round((todayStart - startOfDay(lastTopic[key])) / DAY);
        if (staleDays >= 14) stale.push({ section: sec, topic: t, days: staleDays });
      });
    });
    weak.sort(function (a, b) { return b.gap - a.gap; });
    var overall = agg(recent), trend = d.sessions.slice(0, 15).reverse().map(function (s) { return Math.round(s.correct / s.attempted * 100); });
    return { overall: overall, week: agg(week), perSection: perSection, weak: weak, stale: stale, untouched: untouched, trend: trend, qToUnlock: Math.max(0, MIN_Q - overall.attempted), unlocked: overall.attempted >= MIN_Q };
  }

  // write-through summary for readiness-engine.js
  function syncSummary(d, a) {
    var sum = a.overall.attempted ? { score: a.overall.acc, questions: a.overall.attempted, latest: d.sessions.length ? d.sessions[0].at : null } : null, cur = get(K_SUM, null);
    if (!sum) { if (cur) try { localStorage.removeItem(K_SUM); } catch (e) { /* ignore */ } return false; }
    if (cur && cur.score === sum.score && cur.questions === sum.questions && cur.latest === sum.latest) return false;
    sum.updatedAt = Date.now(); put(K_SUM, sum); return true;
  }
  function announce() { try { window.dispatchEvent(new CustomEvent('arise:career-updated', { detail: { source: 'aptitude' } })); } catch (e) { /* ignore */ } }

  // ---- view ------------------------------------------------------------------------------------------------------
  function css() {
    if (document.getElementById(STYLE)) return;
    var s = document.createElement('style'); s.id = STYLE;
    s.textContent = [
      '.apt-block{position:relative;z-index:1;display:flex;flex-direction:column;gap:.9rem}',
      '.apt-title{font-family:var(--font-display);font-weight:800;font-size:.95rem;color:var(--text-primary,#f1f5ff)}',
      '.apt-sub{font-size:.74rem;color:var(--text-secondary,#8b93b0);line-height:1.5}',
      '.apt-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.55rem}',
      '@media (max-width:560px){.apt-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.apt-stat{padding:.65rem .7rem;border-radius:.85rem;background:var(--surface-soft,rgba(255,255,255,.035));border:1px solid var(--border-soft,rgba(255,255,255,.06))}',
      '.apt-stat b{display:block;font-family:"JetBrains Mono",monospace;font-size:1.1rem;color:var(--text-primary,#f1f5ff)}',
      '.apt-stat span{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary,#8b93b0)}',
      '.apt-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem;padding:.75rem;border-radius:.9rem;border:1px solid var(--border-soft,rgba(255,255,255,.08));background:var(--surface-soft,rgba(255,255,255,.03))}',
      '.apt-form label{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary,#8b93b0);display:flex;flex-direction:column;gap:.2rem}',
      '.apt-in{padding:.4rem .5rem;border-radius:.6rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);font-size:.78rem;width:100%;box-sizing:border-box;font-family:inherit}',
      '.apt-in:focus-visible,.apt-btn:focus-visible{outline:2px solid var(--accent,var(--info));outline-offset:2px}',
      '.apt-btn{padding:.5rem .9rem;border-radius:.7rem;border:1px solid color-mix(in srgb,var(--info) 45%,transparent);background:color-mix(in srgb,var(--info) 16%,transparent);color:#7be6ff;font-weight:700;font-size:.76rem;cursor:pointer;align-self:end;font-family:inherit}',
      '.apt-btn.ghost{background:transparent;border-color:var(--border-soft,rgba(255,255,255,.14));color:var(--text-secondary,#8b93b0)}',
      '.apt-msg{grid-column:1/-1;font-size:.72rem;min-height:1em;color:var(--danger)}',
      '.apt-sec{display:flex;flex-direction:column;gap:.35rem}',
      '.apt-row{display:grid;grid-template-columns:8.5rem 1fr 6.5rem;gap:.6rem;align-items:center;font-size:.74rem;color:var(--text-secondary,#8b93b0)}',
      '@media (max-width:520px){.apt-row{grid-template-columns:6.5rem 1fr 5rem}}',
      '.apt-bar{height:8px;border-radius:999px;background:var(--surface-soft,rgba(255,255,255,.08));overflow:hidden;position:relative}',
      '.apt-fill{height:100%;border-radius:999px;background:var(--info)}',
      '.apt-fill.ok{background:var(--success)}.apt-fill.low{background:var(--warning)}.apt-fill.bad{background:var(--danger)}',
      '.apt-chips{display:flex;flex-wrap:wrap;gap:.35rem}',
      '.apt-chip{font-size:.66rem;padding:.2rem .55rem;border-radius:999px;border:1px solid var(--border-soft,rgba(255,255,255,.14));color:var(--text-secondary,#8b93b0)}',
      '.apt-chip.weak{border-color:color-mix(in srgb,var(--danger) 45%,transparent);color:var(--danger)}',
      '.apt-note{padding:.65rem .8rem;border-radius:.85rem;font-size:.72rem;line-height:1.5;border:1px solid color-mix(in srgb,var(--info) 30%,transparent);background:color-mix(in srgb,var(--info) 7%,transparent);color:var(--text-secondary,#8b93b0)}',
      '.apt-hist{display:flex;flex-direction:column;gap:.3rem;font-size:.72rem;color:var(--text-secondary,#8b93b0)}',
      '.apt-hist div{display:flex;justify-content:space-between;gap:.5rem;align-items:center;padding:.3rem 0;border-bottom:1px dashed var(--border-soft,rgba(255,255,255,.07))}',
      '.apt-del{background:none;border:0;color:var(--text-secondary,#8b93b0);cursor:pointer;font-size:.8rem;padding:.1rem .35rem}',
      '.apt-step{display:flex;align-items:center;gap:.4rem;font-size:.72rem;color:var(--text-secondary,#8b93b0);flex-wrap:wrap}',
      '.apt-sq{width:1.7rem;height:1.7rem;border-radius:.5rem;border:1px solid var(--border-soft,rgba(255,255,255,.12));background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);cursor:pointer;font-weight:700}',
      "[data-theme-mode='light'] .apt-title,[data-theme-mode='light'] .apt-stat b,[data-theme-mode='light'] .apt-in,[data-theme-mode='light'] .apt-sq{color:var(--text-primary,#000)}",
      "[data-theme-mode='light'] .apt-sub,[data-theme-mode='light'] .apt-stat span,[data-theme-mode='light'] .apt-form label,[data-theme-mode='light'] .apt-row,[data-theme-mode='light'] .apt-chip,[data-theme-mode='light'] .apt-note,[data-theme-mode='light'] .apt-hist,[data-theme-mode='light'] .apt-step{color:var(--text-secondary,#444)}"
    ].join('');
    document.head.appendChild(s);
  }
  function topicOptions(sec) { return SECTIONS[sec].map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join(''); }
  function barClass(acc, target) { return acc >= target ? 'ok' : acc >= target - 15 ? 'low' : 'bad'; }
  function spark(vals) {
    if (vals.length < 2) return '';
    var w = 200, h = 34, p = vals.map(function (v, i) { return (i ? 'L' : 'M') + (i / (vals.length - 1) * w).toFixed(1) + ' ' + (h - 3 - v / 100 * (h - 6)).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img" aria-label="Accuracy of your last ' + vals.length + ' sessions"><path d="' + p + '" fill="none" stroke="var(--info)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function build(d, a, now) {
    var t = d.settings.targetAcc, cfg = window.__READINESS_SCORING_CONFIG__, wMass = cfg && cfg.profiles && cfg.profiles.placement && cfg.profiles.placement.tiers && cfg.profiles.placement.tiers.massRecruiter && cfg.profiles.placement.tiers.massRecruiter.aptitude;
    var o = a.overall;
    var html = '<div><div class="apt-title">🧮 Aptitude Practice</div><div class="apt-sub">Log every timed set you do (Quant, Logical, Verbal, DI, Technical MCQ). ' +
      (wMass ? 'Aptitude carries ' + esc(wMass) + '% of the mass-recruiter readiness profile — the biggest single slice. ' : '') + 'Topic lists are common aptitude areas, not any one company\'s syllabus.</div></div>';
    html += '<div class="apt-stats"><div class="apt-stat"><b>' + (o.acc == null ? '—' : o.acc + '%') + '</b><span>Accuracy (60 days)</span></div><div class="apt-stat"><b>' + o.attempted + '</b><span>Questions (60 days)</span></div>' +
      '<div class="apt-stat"><b>' + (o.secPerQ == null ? '—' : o.secPerQ + 's') + '</b><span>Avg sec / question</span></div><div class="apt-stat"><b>' + a.week.n + '/' + d.settings.weeklySets + '</b><span>Sets this week</span></div></div>';
    html += a.unlocked ? '<div class="apt-note">✅ This score now feeds your Readiness (aptitude factor) instead of the exam-confidence proxy.</div>'
      : '<div class="apt-note">Log <b>' + a.qToUnlock + '</b> more question' + (a.qToUnlock === 1 ? '' : 's') + ' (within 60 days) to replace the exam-confidence proxy in Readiness with your real aptitude accuracy.</div>';
    // form
    var secOpts = Object.keys(SECTIONS).map(function (k) { return '<option value="' + esc(k) + '">' + ICON[k] + ' ' + esc(k) + '</option>'; }).join('');
    html += '<div class="apt-form" role="group" aria-label="Log an aptitude set"><label>Section<select class="apt-in" data-apt-f="section">' + secOpts + '</select></label>' +
      '<label>Topic<select class="apt-in" data-apt-f="topic">' + topicOptions('Quant') + '</select></label>' +
      '<label>Attempted<input class="apt-in" data-apt-f="attempted" type="number" min="1" max="200" inputmode="numeric" placeholder="20"></label>' +
      '<label>Correct<input class="apt-in" data-apt-f="correct" type="number" min="0" max="200" inputmode="numeric" placeholder="14"></label>' +
      '<label>Time (min)<input class="apt-in" data-apt-f="time" type="number" min="0" max="300" inputmode="decimal" placeholder="25"></label>' +
      '<label>Date<input class="apt-in" data-apt-f="date" type="date" value="' + dayStr(now) + '" max="' + dayStr(now) + '"></label>' +
      '<button type="button" class="apt-btn" data-apt-add>Add set</button><div class="apt-msg" data-apt-msg role="alert"></div></div>';
    // sections
    html += '<div class="apt-sec">' + Object.keys(SECTIONS).map(function (k) {
      var s = a.perSection[k];
      return '<div class="apt-row"><span>' + ICON[k] + ' ' + esc(k) + '</span><div class="apt-bar" aria-hidden="true"><div class="apt-fill ' + (s.acc == null ? '' : barClass(s.acc, t)) + '" style="width:' + (s.acc == null ? 0 : s.acc) + '%"></div></div><span>' + (s.acc == null ? 'no data' : s.acc + '% · ' + s.attempted + ' Q') + '</span></div>';
    }).join('') + '<div class="apt-sub">Target accuracy: <span class="apt-step"><button type="button" class="apt-sq" data-apt-target="-5" aria-label="Lower target accuracy">−</button><b>' + t + '%</b><button type="button" class="apt-sq" data-apt-target="5" aria-label="Raise target accuracy">+</button></span>' +
      ' &nbsp; Weekly sets: <span class="apt-step"><button type="button" class="apt-sq" data-apt-weekly="-1" aria-label="Fewer weekly sets">−</button><b>' + d.settings.weeklySets + '</b><button type="button" class="apt-sq" data-apt-weekly="1" aria-label="More weekly sets">+</button></span></div></div>';
    if (a.trend.length >= 2) html += '<div><div class="apt-sub">Accuracy, last ' + a.trend.length + ' sets</div>' + spark(a.trend) + '</div>';
    // focus
    if (a.weak.length) html += '<div><div class="apt-sub"><b>Fix first</b> (10+ questions, below your ' + t + '% target)</div><div class="apt-chips">' + a.weak.slice(0, 5).map(function (w) { return '<span class="apt-chip weak">' + esc(w.topic) + ' · ' + w.acc + '% (' + w.attempted + ' Q)</span>'; }).join('') + '</div></div>';
    if (a.stale.length) html += '<div><div class="apt-sub"><b>Going stale</b> (not practised for 14+ days)</div><div class="apt-chips">' + a.stale.slice(0, 6).map(function (w) { return '<span class="apt-chip">' + esc(w.topic) + ' · ' + w.days + 'd</span>'; }).join('') + '</div></div>';
    if (a.untouched.length && a.untouched.length < 36) html += '<div><div class="apt-sub"><b>Never practised</b> (' + a.untouched.length + ' topics)</div><div class="apt-chips">' + a.untouched.slice(0, 8).map(function (w) { return '<span class="apt-chip">' + esc(w.topic) + '</span>'; }).join('') + (a.untouched.length > 8 ? '<span class="apt-chip">+' + (a.untouched.length - 8) + ' more</span>' : '') + '</div></div>';
    // history
    if (d.sessions.length) html += '<div class="apt-hist" aria-label="Recent sets">' + d.sessions.slice(0, 8).map(function (s) {
      return '<div><span>' + esc(new Date(s.at).toLocaleDateString()) + ' · ' + esc(s.section) + (s.topic ? ' · ' + esc(s.topic) : '') + '</span><span>' + s.correct + '/' + s.attempted + ' (' + Math.round(s.correct / s.attempted * 100) + '%)' + (s.timeMin ? ' · ' + s.timeMin + 'm' : '') +
        ' <button type="button" class="apt-del" data-apt-del="' + esc(s.id) + '" aria-label="Delete this set">✕</button></span></div>';
    }).join('') + '</div>';
    else html += '<div class="apt-sub">No sets logged yet — add your first one above. Even a 10-question practice set counts.</div>';
    return html;
  }

  function render() {
    css();
    var el = document.getElementById(MOUNT); if (!el) return;
    el.classList.add('apt-block');
    var now = Date.now(), d = load(), a = analyze(d, now);
    if (syncSummary(d, a)) announce();
    var html = build(d, a, now);
    if (el.__aptHtml === html && el.firstChild) return;
    el.__aptHtml = html; el.innerHTML = html;
    if (!el.__aptWired) { el.__aptWired = true; wire(el); }
  }
  function field(el, k) { return el.querySelector('[data-apt-f="' + k + '"]'); }
  function wire(el) {
    el.addEventListener('change', function (e) {
      var t = e.target; if (t && t.getAttribute && t.getAttribute('data-apt-f') === 'section') { field(el, 'topic').innerHTML = topicOptions(t.value); }
    });
    el.addEventListener('click', function (e) {
      var t = e.target; if (!t.closest) return; var b;
      if (t.closest('[data-apt-add]')) return add(el);
      if ((b = t.closest('[data-apt-del]'))) { var d = load(), id = b.getAttribute('data-apt-del'); d.sessions = d.sessions.filter(function (s) { return s.id !== id; }); if (save(d)) { el.__aptHtml = null; render(); announce(); } return; }
      if ((b = t.closest('[data-apt-target]'))) { var d2 = load(); d2.settings.targetAcc = clamp(d2.settings.targetAcc + Number(b.getAttribute('data-apt-target')), 40, 100); if (save(d2)) { el.__aptHtml = null; render(); } return; }
      if ((b = t.closest('[data-apt-weekly]'))) { var d3 = load(); d3.settings.weeklySets = clamp(d3.settings.weeklySets + Number(b.getAttribute('data-apt-weekly')), 1, 21); if (save(d3)) { el.__aptHtml = null; render(); } }
    });
  }
  function add(el) {
    var msg = el.querySelector('[data-apt-msg]'), sec = field(el, 'section').value, topic = field(el, 'topic').value;
    var att = Number(field(el, 'attempted').value), cor = Number(field(el, 'correct').value), time = field(el, 'time').value === '' ? 0 : Number(field(el, 'time').value), date = field(el, 'date').value;
    function bad(m) { msg.textContent = m; }
    if (!SECTIONS[sec]) return bad('Pick a section.');
    if (!isFinite(att) || att < 1 || att > 200 || Math.floor(att) !== att) return bad('Attempted must be a whole number from 1 to 200.');
    if (!isFinite(cor) || cor < 0 || Math.floor(cor) !== cor) return bad('Correct must be a whole number (0 or more).');
    if (cor > att) return bad('Correct can\'t be more than attempted.');
    if (!isFinite(time) || time < 0 || time > 300) return bad('Time must be between 0 and 300 minutes.');
    var at = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T12:00:00').getTime() : Date.now();
    if (!isFinite(at) || at > Date.now() + DAY) return bad('Pick a valid date (not in the future).');
    var d = load(); d.sessions.unshift({ id: 'apt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: at, section: sec, topic: topic, attempted: att, correct: cor, timeMin: time });
    d.sessions.sort(function (a, b) { return b.at - a.at; }); d.sessions = d.sessions.slice(0, MAX_SESSIONS);
    if (!save(d)) return;
    el.__aptHtml = null; render(); announce(); toast('Set logged — ' + Math.round(cor / att * 100) + '% accuracy.');
  }

  window.__ARISE_APTITUDE__ = { SECTIONS: SECTIONS, load: load, analyze: analyze, summary: function () { return get(K_SUM, null); } };
  if (U.bootUpdater) U.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
