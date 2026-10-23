/* dsa-proof-pack-widget.js — turns your real DSA numbers into shareable proof-of-work
 * (weekly report, resume bullets, LinkedIn caption, GitHub README table). Read-only; never invents a number.
 * Reads dsaQuestions, dsaProblemInsights (optional), dsaMockOAHistory (optional). */
(function () {
  if (window.__ARISE_DSA_PROOF_PACK__) return;
  window.__ARISE_DSA_PROOF_PACK__ = true;
  var MOUNT = 'dsp-proof-pack', STYLE = 'dsp-proof-pack-style', DAY = 864e5;
  var U = window.__ARISE_WIDGET_UTILS__ || {};

  function get(k, fb) { try { var v = localStorage.getItem(k); if (v == null) return fb; var p = JSON.parse(v); return p == null ? fb : p; } catch (e) { return fb; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stamp(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function toast(m, k) { if (U.showToast) U.showToast(m, k); }
  function top(map, n) { return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || (a < b ? -1 : 1); }).slice(0, n); }

  function stats(now) {
    var qs = get('dsaQuestions', []); if (!Array.isArray(qs)) qs = [];
    var ins = get('dsaProblemInsights', {}); if (!ins || typeof ins !== 'object') ins = {};
    var solved = qs.filter(function (q) { return q && q.solved; });
    var diff = { Easy: 0, Medium: 0, Hard: 0 }, topics = {}, plats = {}, by = {}, tagged = 0, unaided = 0;
    solved.forEach(function (q) {
      if (diff[q.difficulty] != null) diff[q.difficulty]++;
      if (q.topic) topics[q.topic] = (topics[q.topic] || 0) + 1;
      if (q.platform && q.platform !== 'Custom') plats[q.platform] = (plats[q.platform] || 0) + 1;
      if (typeof q.dateSolved === 'string' && /^\d{4}-\d{2}-\d{2}/.test(q.dateSolved)) { var k = q.dateSolved.slice(0, 10); by[k] = (by[k] || 0) + 1; }
      var r = ins[q.id]; if (r && r.quality) { tagged++; if (r.quality === 'unaided') unaided++; }
    });
    var week = 0, weekTopics = {};
    for (var i = 0; i < 7; i++) week += by[stamp(now - i * DAY)] || 0;
    solved.forEach(function (q) { if (q.topic && typeof q.dateSolved === 'string') { for (var j = 0; j < 7; j++) if (q.dateSolved.slice(0, 10) === stamp(now - j * DAY)) { weekTopics[q.topic] = (weekTopics[q.topic] || 0) + 1; break; } } });
    var streak = 0, start = by[stamp(now)] ? 0 : 1;
    for (var d = start; d < 400; d++) { if (by[stamp(now - d * DAY)]) streak++; else break; }
    var hist = get('dsaMockOAHistory', []); if (!Array.isArray(hist)) hist = [];
    return { total: solved.length, bank: qs.length, diff: diff, topics: topics, topicCount: Object.keys(topics).length, plats: plats, week: week, weekTopics: weekTopics, streak: streak,
      tagged: tagged, unaidedPct: tagged >= 5 ? Math.round(unaided / tagged * 100) : null, mocks: hist.length, mockAvg: hist.length ? Math.round(hist.reduce(function (a, h) { return a + (h.pct || 0); }, 0) / hist.length) : null };
  }

  function platformText(s) { var p = top(s.plats, 2); return p.length ? ' on ' + p.join(' and ') : ''; }

  function blocks(s, now) {
    var d = s.diff, tt = top(s.topics, 3).map(function (t) { return t + ' (' + s.topics[t] + ')'; }).join(', ');
    var wk = top(s.weekTopics, 3).join(', ');
    var weekly = 'DSA weekly report — ' + stamp(now) + '\n' +
      '• Solved this week: ' + s.week + '\n• Total solved: ' + s.total + ' (Easy ' + d.Easy + ' · Medium ' + d.Medium + ' · Hard ' + d.Hard + ')\n' +
      (s.streak ? '• Current streak: ' + s.streak + ' day' + (s.streak === 1 ? '' : 's') + '\n' : '') +
      (wk ? '• This week I worked on: ' + wk + '\n' : '') +
      (s.mocks ? '• Timed mock tests taken: ' + s.mocks + ' (avg score ' + s.mockAvg + '%)\n' : '') + '#DSA #placements';
    var resume = ['Solved ' + s.total + ' DSA problems' + platformText(s) + ' (' + d.Easy + ' Easy, ' + d.Medium + ' Medium, ' + d.Hard + ' Hard) across ' + s.topicCount + ' topic' + (s.topicCount === 1 ? '' : 's') + (tt ? ', strongest in ' + tt : '') + '.'];
    if (s.mocks) resume.push('Practised under timed conditions: completed ' + s.mocks + ' mock online assessment' + (s.mocks === 1 ? '' : 's') + ' with an average score of ' + s.mockAvg + '%.');
    if (s.unaidedPct != null) resume.push('Solved ' + s.unaidedPct + '% of my tagged problems without hints or reading the solution.');
    var linkedin = 'Consistency update 📈\n\nI have solved ' + s.total + ' DSA problems so far (' + d.Easy + ' Easy / ' + d.Medium + ' Medium / ' + d.Hard + ' Hard)' + (s.streak > 1 ? ' and I am on a ' + s.streak + '-day streak' : '') + '.' +
      (tt ? '\nMost practised: ' + tt + '.' : '') + (s.mocks ? '\nI also run timed mock tests — ' + s.mocks + ' so far.' : '') + '\n\nStill learning every day. Open to advice from anyone who has been through campus placements!\n\n#DSA #Placements #LearningInPublic';
    var md = '## DSA Progress\n\n| Metric | Count |\n|---|---|\n| Total solved | ' + s.total + ' |\n| Easy / Medium / Hard | ' + d.Easy + ' / ' + d.Medium + ' / ' + d.Hard + ' |\n| Topics covered | ' + s.topicCount + ' |\n' +
      (s.mocks ? '| Timed mocks (avg score) | ' + s.mocks + ' (' + s.mockAvg + '%) |\n' : '') + '\n| Topic | Solved |\n|---|---|\n' +
      Object.keys(s.topics).sort(function (a, b) { return s.topics[b] - s.topics[a] || (a < b ? -1 : 1); }).map(function (t) { return '| ' + t + ' | ' + s.topics[t] + ' |'; }).join('\n') + '\n\n_Updated ' + stamp(now) + '_\n';
    return [
      { id: 'weekly', label: '📅 Weekly report (WhatsApp / study group)', text: weekly },
      { id: 'resume', label: '📄 Resume bullets', text: resume.map(function (r) { return '• ' + r; }).join('\n') },
      { id: 'linkedin', label: '💼 LinkedIn post', text: linkedin },
      { id: 'readme', label: '🐙 GitHub README table', text: md }
    ];
  }

  function css() {
    if (document.getElementById(STYLE)) return;
    var s = document.createElement('style'); s.id = STYLE;
    s.textContent = [
      '.dsp-block{position:relative;z-index:1;display:flex;flex-direction:column;gap:.8rem}',
      '.dsp-title{font-family:var(--font-display);font-weight:800;font-size:.95rem;color:var(--text-primary,#f1f5ff)}',
      '.dsp-sub{font-size:.74rem;color:var(--text-secondary,#8b93b0);line-height:1.5}',
      '.dsp-card{border:1px solid var(--border-soft,rgba(255,255,255,.08));border-radius:.85rem;background:var(--surface-soft,rgba(255,255,255,.03));padding:.7rem .8rem}',
      '.dsp-head{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.4rem;flex-wrap:wrap;font-size:.76rem;font-weight:700;color:var(--text-primary,#f1f5ff)}',
      '.dsp-btns{display:flex;gap:.4rem}',
      '.dsp-btn{padding:.3rem .65rem;border-radius:.6rem;border:1px solid color-mix(in srgb,var(--info) 40%,transparent);background:color-mix(in srgb,var(--info) 12%,transparent);color:#7be6ff;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit}',
      '.dsp-btn:focus-visible{outline:2px solid var(--accent,var(--info));outline-offset:2px}',
      '.dsp-pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:"JetBrains Mono",monospace;font-size:.68rem;line-height:1.5;color:var(--text-secondary,#8b93b0);max-height:12rem;overflow:auto}',
      '.dsp-empty{font-size:.78rem;color:var(--text-secondary,#8b93b0)}',
      "[data-theme-mode='light'] .dsp-title,[data-theme-mode='light'] .dsp-head,[data-theme-mode='light'] .dsp-btn{color:var(--text-primary,#000)}",
      "[data-theme-mode='light'] .dsp-sub,[data-theme-mode='light'] .dsp-pre{color:var(--text-secondary,#444)}"
    ].join('');
    document.head.appendChild(s);
  }

  var current = [];

  function copy(text) {
    function fallback() {
      try { var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(t); t.select(); var ok = document.execCommand && document.execCommand('copy'); document.body.removeChild(t); toast(ok ? 'Copied.' : 'Copy failed — select the text manually.', ok ? '' : 'danger'); }
      catch (e) { toast('Copy failed — select the text manually.', 'danger'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Copied.'); }, fallback); else fallback();
  }
  function download(name, text) {
    if (typeof Blob === 'undefined' || !window.URL || !URL.createObjectURL) return;
    var u = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(u); }, 500);
  }

  function render() {
    css();
    var el = document.getElementById(MOUNT); if (!el) return;
    el.classList.add('dsp-block');
    var now = Date.now(), s = stats(now), html;
    if (!s.total) {
      html = '<div class="dsp-title">📤 Proof Pack</div><span class="dsp-empty">Solve and mark a problem to generate resume bullets, a weekly report and a LinkedIn post from your real numbers.</span>';
      current = [];
    } else {
      current = blocks(s, now);
      html = '<div><div class="dsp-title">📤 Proof Pack</div><div class="dsp-sub">Recruiters and seniors trust numbers. Everything below is generated only from what you have actually logged — edit before posting.</div></div>' +
        current.map(function (b, i) {
          return '<div class="dsp-card"><div class="dsp-head"><span>' + b.label + '</span><span class="dsp-btns"><button type="button" class="dsp-btn" data-dsp-copy="' + i + '">Copy</button>' +
            (b.id === 'readme' ? '<button type="button" class="dsp-btn" data-dsp-dl="' + i + '">Download .md</button>' : '') + '</span></div><pre class="dsp-pre">' + esc(b.text) + '</pre></div>';
        }).join('');
    }
    if (el.__dspHtml === html && el.firstChild) return;
    el.__dspHtml = html; el.innerHTML = html;
    if (!el.__dspWired) {
      el.__dspWired = true;
      el.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-dsp-copy],[data-dsp-dl]') : null; if (!b) return;
        if (b.hasAttribute('data-dsp-copy')) { var c = current[+b.getAttribute('data-dsp-copy')]; if (c) copy(c.text); }
        else { var d = current[+b.getAttribute('data-dsp-dl')]; if (d) download('dsa-progress.md', d.text); }
      });
    }
  }

  window.__ARISE_DSA_PROOF_PACK_API__ = { stats: stats, blocks: blocks };
  if (U.bootUpdater) U.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
