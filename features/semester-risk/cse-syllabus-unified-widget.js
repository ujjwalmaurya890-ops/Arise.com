(function () {
  if (window.__ARISE_CSE_SYLLABUS_UNIFIED__) return;
  window.__ARISE_CSE_SYLLABUS_UNIFIED__ = true;

  /* ── Storage keys (mirrors cse-syllabus-plus-widget.js) ── */
  var SK_PROG   = 'cse-syllabus-progress-v1';
  var SK_REV    = 'cse-syllabus-revision-v1';
  var SK_CUSTOM = 'cse-syllabus-custom-v1';
  var SK_DIFF   = 'cse-syllabus-difficulty-v1';
  var SK_EXAM   = 'cse-syllabus-exam-dates-v1';
  var SK_STAMPS = 'cse-syllabus-completion-timestamps-v1';
  var SK_IM     = 'cse-syllabus-internal-marks-v1';
  var SK_UNITS  = 'cse-syllabus-topic-progress-v1';
  var SK_FOCUS  = 'focusSessionsV2';
  var SK_GATE   = 'cse-syllabus-gate-mode-v1';
  var SK_SCORE  = 'cse-syllabus-score-mode-v1';
  var SK_CGPA   = 'arise-cgpa-tracker-v1';       /* exam bundle export/import */
  var SK_ATT    = 'arise-attendance-tracker-v1'; /* exam bundle export/import */
  var SK_TABS   = 'csu-unified-tab-v1';          /* own tab persistence */
  var SK_IA     = 'cse-syllabus-ia-tracker-v1';
  var SK_IASES  = 'cse-syllabus-ia-settings-v1';
  var WIDGET_ID = 'csu-unified-root';
  var STYLE_ID  = 'csu-unified-style';

  /* ── Helpers ── */
  function rd(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  }
  function wr(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cfg() { return window.AriseCSEFullSyllabusConfig || null; }

  /* ── Build full subject list (base + custom, same as main widget) ── */
  function allSubjects() {
    var c = cfg(); if (!c) return [];
    var cust = rd(SK_CUSTOM, { added: [], order: {}, removed: [], edits: {} });
    var removed = {}; (cust.removed || []).forEach(function (id) { removed[id] = true; });
    var base = (c.SUBJECTS || []).filter(function (s) { return !removed[s.id]; })
      .map(function (s) {
        var ed = (cust.edits || {})[s.id];
        return ed ? Object.assign({}, s, ed, { custom: false }) : Object.assign({}, s, { custom: false });
      });
    var added = (cust.added || []).map(function (s) { return Object.assign({}, s, { custom: true }); });
    var all = base.concat(added), bySem = {};
    all.forEach(function (s) { (bySem[s.sem] = bySem[s.sem] || []).push(s); });
    Object.keys(bySem).forEach(function (sem) {
      var o = (cust.order || {})[sem];
      if (o && o.length) bySem[sem].sort(function (a, b) {
        var x = o.indexOf(a.id); if (x === -1) x = 999;
        var y = o.indexOf(b.id); if (y === -1) y = 999;
        return x - y;
      });
    });
    return Object.keys(bySem).sort(function (a, b) { return Number(a) - Number(b); })
      .reduce(function (acc, k) { return acc.concat(bySem[k]); }, []);
  }
  function semLabel(sem) {
    var c = cfg(); if (!c) return 'Sem ' + sem;
    var s = (c.SEMESTERS || []).find(function (x) { return String(x.sem) === String(sem); });
    return s ? s.label : 'Sem ' + sem;
  }
  function semColor(sem) {
    var c = cfg(); if (!c) return 'var(--info)';
    var s = (c.SEMESTERS || []).find(function (x) { return String(x.sem) === String(sem); });
    return s ? s.color : 'var(--info)';
  }

  /* ── Progress helpers ── */
  function progress()    { return rd(SK_PROG, {}); }
  function difficulty()  { return rd(SK_DIFF, {}); }
  function stamps()      { return rd(SK_STAMPS, {}); }
  function unitProg()    { return rd(SK_UNITS, {}); }
  function focusSess()   { var e = rd(SK_FOCUS, []); return Array.isArray(e) ? e : []; }
  function internalMks() { return rd(SK_IM, {}); }
  function iaData()      { return rd(SK_IA, {}); }
  function iaSettings()  { var d = { iaMax: 20, assignMax: 10, iaWeightPct: 80 }; return Object.assign(d, rd(SK_IASES, {})); }

  /* study time per subject */
  function studyMin(subj, sessions) {
    var name = String(subj.name || '').trim().toLowerCase();
    var mins = 0;
    sessions.forEach(function (s) {
      if (!s) return;
      var m = Number(s.minutes) || 0; if (m <= 0) return;
      if (s.subjectId === subj.id) { mins += m; return; }
      if (!s.subjectId && String(s.task || '').trim().toLowerCase() === name) mins += m;
    });
    return mins;
  }
  function fmtMin(m) {
    m = Math.round(m);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  /* unit coverage % */
  function unitCovPct(subj, prog) {
    if (prog[subj.id]) return 100;
    if (!subj.units || !subj.units.length) return null;
    var up = (unitProg()[subj.id]) || {};
    var tot = subj.units.reduce(function (a, u) { return a + (Number(u.weightagePct) || 0); }, 0);
    if (tot <= 0) tot = subj.units.length;
    var got = subj.units.reduce(function (a, u) {
      var w = Number(u.weightagePct); if (!isFinite(w) || w <= 0) w = tot / subj.units.length;
      return a + (up[u.id] ? w : 0);
    }, 0);
    return Math.round(got / tot * 100);
  }

  /* ── Stats across all subjects ── */
  function computeStats() {
    var subs = allSubjects(), prog = progress(), sess = focusSess();
    var done = 0, totalCr = 0, doneCr = 0, totalMin = 0;
    var bySem = {}, byType = {};
    subs.forEach(function (s) {
      var isDone = !!prog[s.id];
      var cr = Number(s.credits) || 0;
      if (isDone) done++;
      totalCr += cr; if (isDone) doneCr += cr;
      totalMin += studyMin(s, sess);
      bySem[s.sem] = bySem[s.sem] || { total: 0, done: 0 };
      bySem[s.sem].total++; if (isDone) bySem[s.sem].done++;
      byType[s.type] = byType[s.type] || { total: 0, done: 0 };
      byType[s.type].total++; if (isDone) byType[s.type].done++;
    });
    var simplePct = subs.length ? Math.round(done / subs.length * 100) : 0;
    var creditPct = totalCr ? Math.round(doneCr / totalCr * 100) : 0;
    return { total: subs.length, done, simplePct, creditPct, totalCr, doneCr, totalMin, bySem, byType };
  }

  /* ── IA score calc ── */
  function calcIA(entry, cfg) {
    entry = entry || {};
    var tests = [entry.ia1, entry.ia2, entry.ia3].filter(function (v) { return v != null; })
      .map(function (v) { return v / cfg.iaMax * 100; });
    var iaPct = null;
    if (tests.length === 1) iaPct = tests[0];
    else if (tests.length >= 2) { tests.sort(function (a, b) { return b - a; }); iaPct = (tests[0] + tests[1]) / 2; }
    var asPct = entry.assignment != null ? entry.assignment / cfg.assignMax * 100 : null;
    var combined = null;
    if (iaPct != null && asPct != null) combined = iaPct * (cfg.iaWeightPct / 100) + asPct * (1 - cfg.iaWeightPct / 100);
    else if (iaPct != null) combined = iaPct;
    else if (asPct != null) combined = asPct;
    return { iaPct, asPct, combined, tests: tests.length };
  }

  /* ── PYQ / Resource data from the tabs patch (re-declared light version) ── */
  var PYQ_MAP = {
    's2-3': [{ label: 'GATE DSA PYQs – GFG', url: 'https://www.geeksforgeeks.org/data-structures-gq/', type: 'gate' }, { label: 'Striver DSA Sheet', url: 'https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/', type: 'placement' }],
    's3-5': [{ label: 'GATE OS PYQs – GFG', url: 'https://www.geeksforgeeks.org/operating-systems-gq/', type: 'gate' }, { label: 'OS Interview Qs – InterviewBit', url: 'https://www.interviewbit.com/operating-system-interview-questions/', type: 'placement' }],
    's3-6': [{ label: 'GATE DBMS PYQs – GFG', url: 'https://www.geeksforgeeks.org/dbms-gq/', type: 'gate' }, { label: 'SQL Interview Qs – InterviewBit', url: 'https://www.interviewbit.com/sql-interview-questions/', type: 'placement' }],
    's4-1': [{ label: 'GATE TOC PYQs – GFG', url: 'https://www.geeksforgeeks.org/theory-of-computation-automata-gq/', type: 'gate' }],
    's4-2': [{ label: 'GATE CN PYQs – GFG', url: 'https://www.geeksforgeeks.org/computer-network-gq/', type: 'gate' }, { label: 'CN Interview Qs', url: 'https://www.interviewbit.com/networking-interview-questions/', type: 'placement' }],
    's4-4': [{ label: 'GATE DAA PYQs – GFG', url: 'https://www.geeksforgeeks.org/algorithms-gq/', type: 'gate' }, { label: 'Algorithm Interview Qs', url: 'https://www.interviewbit.com/algorithm-interview-questions/', type: 'placement' }],
    's6-1': [{ label: 'ML Interview Qs – GFG', url: 'https://www.geeksforgeeks.org/machine-learning-interview-questions/', type: 'placement' }],
  };

  /* ── Tab state ── */
  var TABS = ['subjects', 'priority', 'ia-tracker', 'revision', 'overview', 'analytics', 'resources', 'college-sync', 'data'];
  var TAB_LABELS = { subjects: '📋 Subjects', priority: '🎯 Priority', 'ia-tracker': '📝 IA Tracker', revision: '🔄 Revision', overview: '📊 Overview', analytics: '📈 Analytics', resources: '🔗 Resources', 'college-sync': '🏫 College Sync', data: '⚙️ Data' };
  var state = { tab: rd(SK_TABS, 'subjects'), search: '', sem: 'All', type: 'All', status: 'All', addOpen: false, editId: null, openId: null, sort: 'default', focusSearch: null, filteredIds: [] };
  if (TABS.indexOf(state.tab) === -1) state.tab = 'subjects';

  /* ── CSS ── */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
      #csu-unified-root {
        background: var(--surface);
        border: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent);
        border-radius: 1rem;
        margin: 0 0 1.25rem 0;
        overflow: hidden;
        box-shadow: var(--shadow-sm, 0 1px 4px rgba(0,0,0,.2));
      }
      .csu-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        padding: 1.1rem 1.4rem .9rem;
        background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 7%, var(--surface)) 0%, var(--surface) 100%);
        border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 7%, transparent);
      }
      .csu-header-meta { flex: 1; min-width: 0; }
      .csu-header-title {
        font-family: var(--font-display, inherit);
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: .4rem;
        flex-wrap: wrap;
      }
      .csu-header-badge {
        font-size: .62rem;
        font-weight: 700;
        padding: .15rem .55rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary) 14%, transparent);
        color: var(--primary);
        border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
      }
      .csu-header-sub {
        font-size: .68rem;
        color: var(--text-tertiary);
        margin-top: .2rem;
        line-height: 1.5;
      }
      .csu-kpi-row {
        display: flex;
        flex-wrap: wrap;
        gap: .5rem;
        margin-top: .6rem;
      }
      .csu-kpi {
        background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        border: 1px solid color-mix(in srgb, var(--text-primary) 7%, transparent);
        border-radius: .55rem;
        padding: .35rem .6rem;
        text-align: center;
        min-width: 72px;
      }
      .csu-kpi-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: .95rem;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1;
      }
      .csu-kpi-lbl {
        font-size: .58rem;
        color: var(--text-tertiary);
        margin-top: .15rem;
        white-space: nowrap;
      }
      /* Tab nav */
      .csu-tabs {
        display: flex;
        gap: 0;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 7%, transparent);
        background: color-mix(in srgb, var(--surface-muted, var(--surface)) 70%, transparent);
      }
      .csu-tabs::-webkit-scrollbar { display: none; }
      .csu-tab-btn {
        padding: .55rem 1rem;
        font-size: .75rem;
        font-weight: 600;
        background: none;
        border: none;
        border-bottom: 2.5px solid transparent;
        color: var(--text-tertiary);
        cursor: pointer;
        white-space: nowrap;
        transition: color .13s, border-color .13s;
      }
      .csu-tab-btn:hover { color: var(--text-primary); }
      .csu-tab-btn[data-active="1"] {
        color: var(--primary);
        border-bottom-color: var(--primary);
        background: color-mix(in srgb, var(--primary) 5%, transparent);
      }
      /* Tab body */
      .csu-tab-body { padding: 1rem 1.25rem 1.4rem; }

      /* shared helpers */
      .csu-section-title {
        font-size: .78rem;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 .65rem;
        display: flex;
        align-items: center;
        gap: .4rem;
      }
      .csu-card {
        background: color-mix(in srgb, var(--text-primary) 3%, transparent);
        border: 1px solid color-mix(in srgb, var(--text-primary) 7%, transparent);
        border-radius: .7rem;
        padding: .75rem 1rem;
        margin-bottom: .75rem;
      }
      .csu-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
      @media (max-width:540px) { .csu-grid2 { grid-template-columns: 1fr; } }
      .csu-grid4 { display: grid; grid-template-columns: repeat(4,1fr); gap: .5rem; }
      @media (max-width:540px) { .csu-grid4 { grid-template-columns: repeat(2,1fr); } }

      /* Overview tab */
      .csu-progress-bars { display: flex; flex-direction: column; gap: .3rem; }
      .csu-bar-row { display: flex; align-items: center; gap: .5rem; font-size: .7rem; color: var(--text-secondary); }
      .csu-bar-label { width: 72px; flex-shrink: 0; }
      .csu-bar-track { flex: 1; height: 7px; border-radius: 999px; background: color-mix(in srgb, var(--text-primary) 8%, transparent); overflow: hidden; }
      .csu-bar-fill { height: 100%; border-radius: 999px; transition: width .5s ease; }
      .csu-bar-pct { width: 38px; text-align: right; font-family: 'JetBrains Mono', monospace; font-size: .67rem; color: var(--text-tertiary); }

      /* Subject list tab */
      .csu-toolbar { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .7rem; align-items: center; }
      .csu-input, .csu-select {
        background: var(--surface);
        border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent);
        color: var(--text-primary);
        border-radius: .45rem;
        padding: .38rem .55rem;
        font-size: .73rem;
        outline: none;
      }
      .csu-input { flex: 1; min-width: 150px; }
      .csu-btn {
        background: color-mix(in srgb, var(--primary) 12%, transparent);
        color: var(--primary);
        border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
        border-radius: .45rem;
        padding: .38rem .65rem;
        font-size: .71rem;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .csu-btn:hover { background: color-mix(in srgb, var(--primary) 20%, transparent); }
      .csu-btn-ghost { background: none; border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent); color: var(--text-secondary); }
      .csu-subj-list { display: flex; flex-direction: column; gap: .28rem; max-height: 520px; overflow-y: auto; padding-right: .15rem; }
      .csu-subj-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .5rem;
        padding: .42rem .55rem;
        border-radius: .5rem;
        background: color-mix(in srgb, var(--text-primary) 3%, transparent);
        font-size: .74rem;
        cursor: pointer;
        transition: background .1s;
      }
      .csu-subj-row:hover { background: color-mix(in srgb, var(--primary) 7%, transparent); }
      .csu-subj-check {
        width: 16px; height: 16px;
        border-radius: 4px;
        border: 1px solid color-mix(in srgb, var(--text-primary) 25%, transparent);
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; color: var(--surface);
      }
      .csu-subj-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
      .csu-subj-name[data-done="1"] { text-decoration: line-through; color: var(--text-tertiary); }
      .csu-subj-meta { font-size: .62rem; color: var(--text-tertiary); flex-shrink: 0; }
      .csu-tag {
        font-size: .58rem; font-weight: 700; text-transform: uppercase;
        padding: .08rem .42rem; border-radius: 999px; flex-shrink: 0;
      }
      .csu-chip {
        font-size: .6rem; font-weight: 700;
        padding: .08rem .42rem; border-radius: 999px; flex-shrink: 0;
      }
      .csu-chip-rev { color: var(--secondary); background: color-mix(in srgb, var(--secondary) 14%, transparent); }
      .csu-chip-due { color: var(--danger); background: color-mix(in srgb, var(--danger) 13%, transparent); }
      .csu-chip-pc  { color: var(--warning); background: color-mix(in srgb, var(--warning) 13%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 25%, transparent); }
      .csu-chip-gate { color: var(--info); background: var(--info, #3b82f6)1a; }
      .csu-units-bar { display: inline-block; width: 44px; height: 5px; border-radius: 999px; background: color-mix(in srgb, var(--text-primary) 10%, transparent); overflow: hidden; vertical-align: middle; margin-left: .3rem; }
      .csu-units-fill { display: block; height: 100%; border-radius: 999px; }
      .csu-empty { font-size: .75rem; color: var(--text-tertiary); text-align: center; padding: 1.2rem 0; }

      /* Priority tab */
      .csu-prio-row {
        display: flex;
        align-items: flex-start;
        gap: .65rem;
        padding: .45rem .55rem;
        border-radius: .5rem;
        background: color-mix(in srgb, var(--text-primary) 3%, transparent);
        margin-bottom: .3rem;
        font-size: .74rem;
      }
      .csu-prio-rank { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--primary); width: 22px; flex-shrink: 0; }
      .csu-prio-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .2rem; }
      .csu-prio-name { color: var(--text-secondary); font-weight: 600; }
      .csu-prio-meta { font-size: .62rem; color: var(--text-tertiary); }
      .csu-prio-why { font-size: .64rem; color: var(--text-tertiary); line-height: 1.45; font-style: italic; }
      .csu-prio-score { font-family: 'JetBrains Mono', monospace; font-size: .68rem; color: var(--text-tertiary); flex-shrink: 0; }

      /* Analytics tab */
      .csu-ana-stat { text-align: center; }
      .csu-ana-val { font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 700; color: var(--text-primary); }
      .csu-ana-lbl { font-size: .6rem; color: var(--text-tertiary); margin-top: .1rem; }
      .csu-corr-tone-up { color: var(--success); }
      .csu-corr-tone-down { color: var(--danger); }
      .csu-corr-tone-flat { color: var(--text-tertiary); }

      /* IA Tracker */
      .csu-ia-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .5rem;
        padding: .45rem .55rem;
        border-radius: .5rem;
        background: color-mix(in srgb, var(--text-primary) 3%, transparent);
        margin-bottom: .28rem;
        font-size: .73rem;
      }
      .csu-ia-name { flex: 1; min-width: 140px; color: var(--text-secondary); font-weight: 600; }
      .csu-ia-num { width: 64px; }
      .csu-ia-badge {
        font-size: .6rem; font-weight: 700; padding: .1rem .45rem; border-radius: 999px;
        flex-shrink: 0;
      }
      .csu-ia-badge-ok { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
      .csu-ia-badge-warn { color: var(--warning); background: color-mix(in srgb, var(--warning) 13%, transparent); }
      .csu-ia-badge-danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
      .csu-ia-badge-none { color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 6%, transparent); }
      input.csu-ia-num {
        background: var(--surface);
        border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
        color: var(--text-primary);
        border-radius: .4rem;
        padding: .3rem .4rem;
        font-size: .7rem;
        outline: none;
      }

      /* Resources */
      .csu-res-subj { margin-bottom: .6rem; }
      .csu-res-subj-name { font-size: .75rem; font-weight: 700; color: var(--text-primary); margin-bottom: .3rem; }
      .csu-res-links { display: flex; flex-wrap: wrap; gap: .35rem; }
      .csu-res-link {
        font-size: .68rem;
        color: var(--info);
        border: 1px solid color-mix(in srgb, var(--info) 25%, transparent);
        border-radius: .4rem;
        padding: .25rem .55rem;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: .3rem;
      }
      .csu-res-link:hover { background: color-mix(in srgb, var(--info) 8%, transparent); }
      .csu-res-tag-gate { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 25%, transparent); }
      .csu-res-tag-placement { color: var(--success); border-color: color-mix(in srgb, var(--success) 30%, transparent); }

      /* College sync */
      .csu-cs-row {
        display: flex; align-items: center; gap: .5rem;
        font-size: .72rem; padding: .38rem .5rem; border-radius: .45rem;
        background: color-mix(in srgb, var(--text-primary) 3%, transparent);
        margin-bottom: .25rem; cursor: pointer;
      }
      .csu-cs-row-hidden { opacity: .45; }
      .csu-cs-row-hidden .csu-cs-name { text-decoration: line-through; }
      .csu-cs-name { flex: 1; color: var(--text-secondary); }
      .csu-cs-type { font-size: .58rem; color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 8%, transparent); padding: .05rem .4rem; border-radius: 999px; }
      .csu-cs-custom { color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); }
      .csu-note { font-size: .64rem; color: var(--text-tertiary); line-height: 1.55; margin-top: .5rem; }

      /* Data tab */
      .csu-data-btn-row { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .6rem; }

      /* v202 additions: detail drawer, revision, add-subject, bulk */
      .csu-chev { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: .72rem; padding: .1rem .35rem; border-radius: .3rem; flex-shrink: 0; }
      .csu-chev:hover { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
      .csu-chip-diff { color: var(--warning); background: color-mix(in srgb, var(--warning) 9%, transparent); }
      .csu-drawer { display: flex; flex-direction: column; gap: .55rem; background: color-mix(in srgb, var(--info) 5%, transparent); border: 1px solid color-mix(in srgb, var(--info) 16%, transparent); border-radius: .6rem; padding: .6rem .7rem; margin: 0 0 .3rem .4rem; }
      .csu-drawer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: .55rem; }
      .csu-drawer-cell { display: flex; flex-direction: column; gap: .3rem; font-size: .68rem; color: var(--text-secondary); }
      .csu-drawer-lbl { font-size: .6rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-tertiary); }
      .csu-dots { display: inline-flex; gap: 2px; }
      .csu-dot { width: 18px; height: 18px; padding: 0; border: none; background: none; cursor: pointer; font-size: 13px; line-height: 18px; color: color-mix(in srgb, var(--text-primary) 18%, transparent); }
      .csu-dot[data-filled="1"] { color: var(--warning); }
      .csu-unit-row { display: flex; align-items: center; gap: .45rem; font-size: .7rem; color: var(--text-secondary); padding: .12rem 0; cursor: pointer; }
      .csu-unit-row span.csu-unit-name { flex: 1; min-width: 0; }
      .csu-unit-row span.csu-unit-name[data-done="1"] { text-decoration: line-through; color: var(--text-tertiary); }
      .csu-unit-w { font-family: 'JetBrains Mono', monospace; font-size: .62rem; color: var(--text-tertiary); }
      .csu-inline { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
      .csu-form { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: .45rem; align-items: center; background: color-mix(in srgb, var(--text-primary) 3%, transparent); border-radius: .6rem; padding: .55rem; margin-bottom: .6rem; }
      @media (max-width: 640px) { .csu-form { grid-template-columns: 1fr 1fr; } }
      .csu-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-bottom: .55rem; font-size: .66rem; color: var(--text-tertiary); }
      .csu-kpi-due .csu-kpi-val { color: var(--danger); }
      .csu-rev-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: .76rem; padding: .45rem .55rem; border-radius: .55rem; background: color-mix(in srgb, var(--text-primary) 3%, transparent); margin-bottom: .28rem; }
      .csu-rev-name { flex: 1; min-width: 120px; color: var(--text-secondary); }
      .csu-rev-boxes { font-size: .6rem; letter-spacing: 1px; color: var(--secondary); }
      .csu-stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: .45rem; margin-bottom: .6rem; }
      .csu-stat { background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid color-mix(in srgb, var(--text-primary) 6%, transparent); border-radius: .6rem; padding: .45rem .55rem; text-align: center; }
      .csu-stat-val { font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 700; color: var(--text-primary); }
      .csu-stat-lbl { font-size: .6rem; color: var(--text-tertiary); margin-top: .1rem; }

      /* v203 additions */
      .csu-prio-row { cursor: pointer; }
      .csu-chip-risk { color: var(--danger); background: color-mix(in srgb, var(--danger) 13%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent); }
      .csu-banner { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .55rem .8rem; margin: 0 0 .7rem; border-radius: .7rem; font-size: .74rem; line-height: 1.45; color: var(--text-primary); }
      .csu-banner-warn { background: color-mix(in srgb, var(--warning) 12%, transparent); border: 1px dashed color-mix(in srgb, var(--warning) 45%, transparent); }
      .csu-banner-ok { background: color-mix(in srgb, var(--success) 10%, transparent); border: 1px dashed color-mix(in srgb, var(--success) 40%, transparent); }
      .csu-banner span { flex: 1; min-width: 180px; }
      .csu-sempace-row { display: flex; align-items: center; gap: .6rem; font-size: .72rem; padding: .3rem .5rem; border-radius: .4rem; background: color-mix(in srgb, var(--text-primary) 3%, transparent); margin-top: .25rem; }
      .csu-sempace-sem { width: 52px; flex-shrink: 0; font-weight: 600; color: var(--text-secondary); }
      .csu-sempace-cnt { width: 44px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; color: var(--text-tertiary); }
      .csu-sempace-fin { flex: 1; font-family: 'JetBrains Mono', monospace; color: var(--text-tertiary); }
    `;
    document.head.appendChild(el);
  }


  /* ── v202: revision (Leitner), exam dates, actions ── */
  var REV_BOXES = [1, 3, 7, 14, 30];
  var SK_XP = 'cse-syllabus-xp-awarded-v1';
  var SK_ETRK = 'arise_exam_tracker_v1';

  function revNorm(e) {
    if (!e) return null;
    if (e === true) return { flagged: true, box: 1, lastReviewedAt: null, nextDueAt: Date.now() };
    return typeof e === 'object' ? e : null;
  }
  function revIsDue(r) { return !!(r && r.flagged && (r.nextDueAt == null || r.nextDueAt <= Date.now())); }
  function revLabel(r) {
    if (!r || r.nextDueAt == null) return 'Due now';
    var d = Math.ceil((r.nextDueAt - Date.now()) / 86400000);
    return d <= 0 ? (d === 0 ? 'Due today' : 'Overdue ' + Math.abs(d) + 'd') : 'in ' + d + 'd';
  }
  function revDueCount(subs) {
    var rv = rd(SK_REV, {});
    return subs.filter(function (s) { return revIsDue(revNorm(rv[s.id])); }).length;
  }
  function revFlag(id, on) {
    var rv = rd(SK_REV, {});
    if (on) {
      var cur = revNorm(rv[id]);
      rv[id] = { flagged: true, box: cur && cur.box ? cur.box : 1, lastReviewedAt: cur ? cur.lastReviewedAt : null, nextDueAt: cur && cur.nextDueAt != null ? cur.nextDueAt : Date.now() };
    } else delete rv[id];
    wr(SK_REV, rv);
  }
  function revReview(id) {
    var rv = rd(SK_REV, {});
    var cur = revNorm(rv[id]) || { flagged: true, box: 0 };
    var box = Math.min((cur.box || 0) + 1, REV_BOXES.length);
    rv[id] = { flagged: true, box: box, lastReviewedAt: Date.now(), nextDueAt: Date.now() + REV_BOXES[box - 1] * 86400000 };
    wr(SK_REV, rv);
  }

  function etDates() {
    try {
      var raw = localStorage.getItem(SK_ETRK); if (!raw) return {};
      var d = JSON.parse(raw); if (!d || !Array.isArray(d.exams)) return {};
      var t0 = new Date(); t0.setHours(0, 0, 0, 0);
      var out = {};
      d.exams.forEach(function (x) {
        if (!x || x.completed || !x.subjectName || !x.examDate) return;
        var k = String(x.subjectName).trim().toLowerCase(); if (!k) return;
        var cur = out[k]; if (!cur) { out[k] = x.examDate; return; }
        var a = new Date(x.examDate + 'T00:00:00'), b = new Date(cur + 'T00:00:00');
        var au = a >= t0, bu = b >= t0;
        if (au && !bu) out[k] = x.examDate;
        else if (au && bu && a < b) out[k] = x.examDate;
        else if (!au && !bu && a > b) out[k] = x.examDate;
      });
      return out;
    } catch (e) { return {}; }
  }
  /* own override wins; otherwise fall back to the Exam Tracker's date for the same subject name */
  function examMap(subs) {
    var ov = rd(SK_EXAM, {}), et = etDates(), out = {};
    subs.forEach(function (s) {
      var k = String(s.name || '').trim().toLowerCase();
      if (ov[s.id]) out[s.id] = ov[s.id]; else if (et[k]) out[s.id] = et[k];
    });
    Object.keys(ov).forEach(function (id) { if (!out[id]) out[id] = ov[id]; });
    return out;
  }
  function examInfo(dateStr) {
    if (!dateStr) return null;
    var dt = new Date(dateStr + 'T00:00:00'); if (isNaN(dt.getTime())) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d = Math.round((dt - t) / 86400000);
    return { days: d, label: d < 0 ? 'passed ' + Math.abs(d) + 'd ago' : d === 0 ? 'today' : 'in ' + d + 'd' };
  }

  function awardXP(s) {
    if (!s || !window.__XP_ENGINE__ || typeof window.__XP_ENGINE__.syllabusXP !== 'function') return;
    var a = rd(SK_XP, []); if (!Array.isArray(a)) a = [];
    if (a.indexOf(s.id) === -1) {
      try { window.__XP_ENGINE__.syllabusXP(s, 0); } catch (e) {}
      a.push(s.id); wr(SK_XP, a);
    }
  }
  function setDone(ids, val) {
    var p2 = progress(), st = stamps(), now = new Date().toISOString(), byId = {};
    allSubjects().forEach(function (s) { byId[s.id] = s; });
    ids.forEach(function (id) {
      if (val) { p2[id] = true; if (!st[id]) st[id] = now; awardXP(byId[id]); }
      else { delete p2[id]; delete st[id]; }
    });
    wr(SK_PROG, p2); wr(SK_STAMPS, st);
    render();
  }
  function setDifficulty(id, n) {
    var d = difficulty(); if (!n || d[id] === n) delete d[id]; else d[id] = Math.max(1, Math.min(5, n));
    wr(SK_DIFF, d);
  }
  function setExamDate(id, val) {
    var e = rd(SK_EXAM, {}); if (val) e[id] = val; else delete e[id];
    wr(SK_EXAM, e);
  }
  function toggleUnit(sid, uid, on) {
    var up = unitProg(); var m = up[sid] || {};
    if (on) m[uid] = true; else delete m[uid];
    up[sid] = m; wr(SK_UNITS, up);
  }
  function logStudy(s, minutes) {
    minutes = Math.round(Number(minutes));
    if (!minutes || minutes <= 0) return false;
    var arr = focusSess();
    arr.push({ id: 'cse-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), task: s.name, subjectId: s.id, category: 'College', minutes: minutes, date: new Date().toISOString().split('T')[0], startedAt: null, endedAt: Date.now(), completedNote: '', rating: null, distractions: 0 });
    if (arr.length > 2000) arr = arr.slice(arr.length - 2000);
    wr(SK_FOCUS, arr);
    return true;
  }
  function customStore() {
    var c = rd(SK_CUSTOM, null); if (!c || typeof c !== 'object') c = {};
    if (!Array.isArray(c.added)) c.added = [];
    if (!c.edits || typeof c.edits !== 'object') c.edits = {};
    if (!c.order || typeof c.order !== 'object') c.order = {};
    if (!Array.isArray(c.removed)) c.removed = [];
    return c;
  }
  function setPC(s, on) {
    var c = customStore();
    if (s.custom) c.added = c.added.map(function (x) { return x.id === s.id ? Object.assign({}, x, { pc: !!on }) : x; });
    else c.edits[s.id] = Object.assign({}, c.edits[s.id], { pc: !!on });
    wr(SK_CUSTOM, c);
  }
  function sortSubjects(list, diff, exMap) {
    var m = state.sort; if (m === 'default') return list;
    var c = list.slice();
    c.sort(function (a, b) {
      if (m === 'name') return String(a.name).localeCompare(String(b.name));
      if (m === 'credits') return (Number(b.credits) || 0) - (Number(a.credits) || 0);
      if (m === 'difficulty') return (diff[b.id] || 0) - (diff[a.id] || 0);
      if (m === 'exam') {
        var da = exMap[a.id], db = exMap[b.id];
        if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
        return da < db ? -1 : da > db ? 1 : 0;
      }
      return 0;
    });
    return c;
  }

  /* compact chips shown on each subject row */
  function rowExtras(s, diff, exMap, ctx) {
    var h = '';
    if (diff[s.id]) h += '<span class="csu-chip csu-chip-diff" title="Self-rated difficulty">★ ' + diff[s.id] + '/5</span>';
    var ei = examInfo(exMap[s.id]);
    if (ei && ei.days >= 0) {
      var col = ei.days <= 3 ? 'var(--danger)' : ei.days <= 14 ? 'var(--warning)' : 'var(--info)';
      h += '<span class="csu-chip" style="color:' + col + ';background:color-mix(in srgb,' + col + ' 14%,transparent)" title="Exam date ' + esc(exMap[s.id]) + '">📅 ' + ei.label + '</span>';
    }
    if (ctx) {
      var br = backlogRisk(s, ctx.marks, ctx.att);
      if (br.atRisk) h += '<span class="csu-chip csu-chip-risk" title="Backlog risk — ' + esc(br.reasons.join('; ')) + '">⚠️ Backlog Risk</span>';
    }
    return h;
  }
  function dueKpi(subs) {
    var n = revDueCount(subs);
    return n ? '<div class="csu-kpi csu-kpi-due"><div class="csu-kpi-val">' + n + '</div><div class="csu-kpi-lbl">Revise</div></div>' : '';
  }

  /* expandable per-subject detail drawer */
  function drawerHTML(s, prog, diff, exMap, revData, sess) {
    var sid = esc(s.id), done = !!prog[s.id];
    var d = diff[s.id] || 0, dots = '';
    for (var i = 1; i <= 5; i++) dots += '<button class="csu-dot" data-diff-set="' + sid + ':' + i + '" data-filled="' + (i <= d ? '1' : '0') + '" title="Rate difficulty ' + i + '/5">●</button>';

    var ov = rd(SK_EXAM, {}), eff = exMap[s.id] || '';
    var src = ov[s.id] ? 'your override' : eff ? 'auto from Exam Tracker' : '';
    var ei = examInfo(eff);
    var examCell = '<div class="csu-inline"><input type="date" class="csu-input" style="flex:0 0 auto;min-width:130px" data-exam-input="' + sid + '" value="' + esc(eff) + '" />' +
      (ei ? '<span style="font-size:.64rem;color:' + (ei.days < 0 ? 'var(--text-tertiary)' : ei.days <= 7 ? 'var(--danger)' : 'var(--text-secondary)') + '">' + esc(ei.label) + '</span>' : '') + '</div>' +
      (src ? '<span class="csu-note" style="margin:0">' + esc(src) + (ov[s.id] ? ' — clear the date to use the Exam Tracker\'s' : ' — set a date to override') + '</span>' : '');

    var rv = revNorm(revData[s.id]), revCell;
    if (rv && rv.flagged) {
      var boxes = ''; for (var b = 1; b <= REV_BOXES.length; b++) boxes += (b <= (rv.box || 0) ? '●' : '○');
      revCell = '<div class="csu-inline"><span class="csu-chip ' + (revIsDue(rv) ? 'csu-chip-due' : 'csu-chip-rev') + '">🔄 ' + esc(revLabel(rv)) + '</span>' +
        '<span class="csu-rev-boxes" title="Spaced-repetition box (review gaps grow: 3d, 7d, 14d, 30d)">' + boxes + '</span>' +
        '<button class="csu-btn" data-rev-review="' + sid + '">✓ Reviewed</button>' +
        '<button class="csu-btn csu-btn-ghost" data-rev-off="' + sid + '">✕ Remove</button></div>';
    } else {
      revCell = '<div class="csu-inline"><button class="csu-btn csu-btn-ghost" data-rev-on="' + sid + '">🔄 Flag for revision</button></div>';
    }

    var mins = studyMin(s, sess);
    var logCell = '<div class="csu-inline"><input type="number" min="1" max="600" class="csu-input" style="flex:0 0 auto;min-width:0;width:84px" placeholder="Minutes" data-log-input="' + sid + '" />' +
      '<button class="csu-btn" data-log-save="' + sid + '">⏱ Log</button>' +
      '<span style="font-size:.64rem;color:var(--text-tertiary)">' + (mins ? fmtMin(mins) + ' logged' : 'none yet') + '</span></div>';

    var mk = internalMks()[s.id], brk = backlogRisk(s, internalMks(), attData());
    var marksCell = '<div class="csu-inline"><input type="number" min="0" max="100" class="csu-input" style="flex:0 0 auto;min-width:0;width:84px" placeholder="0-100" data-marks-input="' + sid + '" value="' + (mk != null ? esc(mk) : '') + '" />' +
      (brk.atRisk ? '<span class="csu-chip csu-chip-risk">⚠️ ' + esc(brk.reasons.join('; ')) + '</span>' : '<span style="font-size:.64rem;color:var(--text-tertiary)">' + (mk != null ? 'above ' + BACKLOG_MARKS : 'optional — feeds Backlog Risk') + '</span>') + '</div>';
    var fixedPC = !!(window.AriseCSEPlacementCriticalConfig && window.AriseCSEPlacementCriticalConfig.SUBJECT_IDS && window.AriseCSEPlacementCriticalConfig.SUBJECT_IDS[s.id]);
    var pcCell = '<label class="csu-inline" style="cursor:' + (fixedPC ? 'default' : 'pointer') + '"><input type="checkbox" data-pc-set="' + sid + '"' + (fixedPC || s.pc === true ? ' checked' : '') + (fixedPC ? ' disabled' : '') + ' /> 🎯 Placement-critical' + (fixedPC ? ' <span class="csu-note" style="margin:0">(core, fixed)</span>' : '') + '</label>';

    var unitsHTML = '';
    if (s.units && s.units.length) {
      var um = unitProg()[s.id] || {};
      var cov = unitCovPct(s, prog);
      unitsHTML = '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Syllabus units — ' + cov + '% weighted coverage</span>' +
        s.units.map(function (u) {
          var chk = done || !!um[u.id];
          return '<label class="csu-unit-row"><input type="checkbox" data-unit="' + sid + ':' + esc(u.id) + '"' + (chk ? ' checked' : '') + (done ? ' disabled' : '') + ' />' +
            '<span class="csu-unit-name" data-done="' + (chk ? '1' : '0') + '">' + esc(u.name) + '</span>' +
            (u.weightagePct != null ? '<span class="csu-unit-w">' + esc(u.weightagePct) + '%</span>' : '') + '</label>';
        }).join('') +
        (done ? '<span class="csu-note" style="margin:0">Subject is marked done, so units are locked as covered.</span>' : '') + '</div>';
    }

    return '<div class="csu-drawer">' +
      '<div class="csu-drawer-grid">' +
        '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Difficulty</span><span class="csu-dots">' + dots + '</span></div>' +
        '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Exam date</span>' + examCell + '</div>' +
        '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Revision</span>' + revCell + '</div>' +
        '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Study time</span>' + logCell + '</div>' +
        '<div class="csu-drawer-cell"><span class="csu-drawer-lbl">Internal marks</span>' + marksCell + '</div>' +
      '</div>' + pcCell + unitsHTML +
      '<div class="csu-inline">' +
        '<button class="csu-btn csu-btn-ghost" data-edit-open="' + sid + '">✎ Edit</button>' +
        '<button class="csu-btn csu-btn-ghost" data-move="' + sid + ':up" title="Move up within ' + esc(semLabel(s.sem)) + '">▲</button>' +
        '<button class="csu-btn csu-btn-ghost" data-move="' + sid + ':down" title="Move down within ' + esc(semLabel(s.sem)) + '">▼</button>' +
        (s.custom ? '<button class="csu-btn csu-btn-ghost" data-del-custom="' + sid + '" style="color:var(--danger)">🗑 Delete custom subject</button>' : '') +
      '</div>' + (state.editId === s.id ? editFormHTML(s) : '') +
    '</div>';
  }

  function addFormHTML() {
    var c = cfg();
    var semOpts = ((c && c.SEMESTERS) || []).map(function (x) { return '<option value="' + esc(x.sem) + '">Sem ' + esc(x.sem) + '</option>'; }).join('');
    return '<div class="csu-form">' +
      '<input class="csu-input" id="csu-add-name" placeholder="New subject name" />' +
      '<input class="csu-input" id="csu-add-credits" type="number" min="1" max="12" value="3" placeholder="Credits" />' +
      '<select class="csu-select" id="csu-add-type"><option>Core</option><option>Lab</option><option>Elective</option><option>Project</option></select>' +
      '<select class="csu-select" id="csu-add-sem">' + semOpts + '</select>' +
      '<div class="csu-inline"><button class="csu-btn" id="csu-add-save">Add</button><button class="csu-btn csu-btn-ghost" id="csu-add-cancel">Cancel</button></div>' +
      '<label class="csu-inline" style="grid-column:1/-1;font-size:.68rem;color:var(--text-secondary);cursor:pointer"><input type="checkbox" id="csu-add-pc" /> 🎯 Placement-critical</label>' +
    '</div>';
  }

  /* Revision tab (spaced repetition: 1d → 3d → 7d → 14d → 30d) */
  function renderRevision(subs, prog) {
    var rv = rd(SK_REV, {});
    var items = subs.map(function (s) { return { s: s, r: revNorm(rv[s.id]) }; }).filter(function (x) { return x.r && x.r.flagged; });
    items.sort(function (a, b) { return (a.r.nextDueAt == null ? 0 : a.r.nextDueAt) - (b.r.nextDueAt == null ? 0 : b.r.nextDueAt); });
    var due = items.filter(function (x) { return revIsDue(x.r); }).length;
    var nextUp = items.filter(function (x) { return !revIsDue(x.r); })[0];
    var stats = '<div class="csu-stat-row">' +
      '<div class="csu-stat"><div class="csu-stat-val"' + (due ? ' style="color:var(--danger)"' : '') + '>' + due + '</div><div class="csu-stat-lbl">Due now</div></div>' +
      '<div class="csu-stat"><div class="csu-stat-val">' + (items.length - due) + '</div><div class="csu-stat-lbl">Scheduled</div></div>' +
      '<div class="csu-stat"><div class="csu-stat-val">' + items.length + '</div><div class="csu-stat-lbl">Flagged</div></div>' +
      '<div class="csu-stat"><div class="csu-stat-val" style="font-size:.8rem">' + (nextUp ? esc(revLabel(nextUp.r)) : '—') + '</div><div class="csu-stat-lbl">Next up</div></div></div>';

    var flaggedIds = {}; items.forEach(function (x) { flaggedIds[x.s.id] = 1; });
    var candidates = subs.filter(function (s) { return !flaggedIds[s.id]; }).sort(function (a, b) { return (prog[b.id] ? 1 : 0) - (prog[a.id] ? 1 : 0); });
    var doneUnflagged = candidates.filter(function (s) { return !!prog[s.id]; }).length;
    var picker = '<div class="csu-toolbar"><select class="csu-select" id="csu-rev-pick" style="flex:1;min-width:160px">' +
      '<option value="">Flag a subject for revision…</option>' +
      candidates.map(function (s) { return '<option value="' + esc(s.id) + '">' + (prog[s.id] ? '✓ ' : '') + esc(s.name) + ' (' + esc(semLabel(s.sem)) + ')</option>'; }).join('') +
      '</select><button class="csu-btn" id="csu-rev-add">+ Flag</button>' +
      (doneUnflagged ? '<button class="csu-btn csu-btn-ghost" id="csu-rev-flag-done">🔄 Flag all ' + doneUnflagged + ' completed</button>' : '') + '</div>';

    var rows = items.map(function (x) {
      var boxes = ''; for (var b = 1; b <= REV_BOXES.length; b++) boxes += (b <= (x.r.box || 0) ? '●' : '○');
      var isDue = revIsDue(x.r);
      return '<div class="csu-rev-row" style="border-left:2.5px solid ' + semColor(x.s.sem) + '">' +
        '<span class="csu-rev-name">' + esc(x.s.name) + ' <span style="font-size:.62rem;color:var(--text-tertiary)">' + esc(semLabel(x.s.sem)) + '</span></span>' +
        '<span class="csu-rev-boxes" title="Box ' + (x.r.box || 0) + ' of ' + REV_BOXES.length + '">' + boxes + '</span>' +
        '<span class="csu-chip ' + (isDue ? 'csu-chip-due' : 'csu-chip-rev') + '">' + esc(revLabel(x.r)) + '</span>' +
        '<button class="csu-btn' + (isDue ? '' : ' csu-btn-ghost') + '" data-rev-review="' + esc(x.s.id) + '">✓ Reviewed</button>' +
        '<button class="csu-btn csu-btn-ghost" data-rev-off="' + esc(x.s.id) + '" title="Remove from revision">✕</button></div>';
    }).join('');

    return stats + picker + (rows || '<div class="csu-empty">Nothing flagged yet. Flag a subject above, or use 🔄 on any subject\'s detail drawer.</div>') +
      '<p class="csu-note">Each ✓ Reviewed moves a subject up one box, and the gap to its next review grows 3 → 7 → 14 → 30 days. Shares its data with the Syllabus+ panel, so flags set in either place show in both.</p>';
  }

  /* bind all v202 controls (called after every render) */
  function wireFeatures(subs, prog) {
    var byId = {}; subs.forEach(function (s) { byId[s.id] = s; });
    function each(sel, fn) { root.querySelectorAll(sel).forEach(fn); }

    each('[data-open-id]', function (b) { b.addEventListener('click', function (e) {
      e.stopPropagation(); var id = b.getAttribute('data-open-id'); state.openId = state.openId === id ? null : id; render();
    }); });
    each('[data-diff-set]', function (b) { b.addEventListener('click', function () {
      var p = b.getAttribute('data-diff-set').split(':'); setDifficulty(p[0], parseInt(p[1], 10)); render();
    }); });
    each('[data-exam-input]', function (inp) { inp.addEventListener('change', function () {
      setExamDate(inp.getAttribute('data-exam-input'), inp.value); render();
    }); });
    each('[data-rev-on]', function (b) { b.addEventListener('click', function () { revFlag(b.getAttribute('data-rev-on'), true); render(); }); });
    each('[data-rev-off]', function (b) { b.addEventListener('click', function () { revFlag(b.getAttribute('data-rev-off'), false); render(); }); });
    each('[data-rev-review]', function (b) { b.addEventListener('click', function () { revReview(b.getAttribute('data-rev-review')); render(); }); });
    each('[data-unit]', function (cb) { cb.addEventListener('change', function () {
      var p = cb.getAttribute('data-unit').split(':'); toggleUnit(p[0], p[1], cb.checked); render();
    }); });
    each('[data-log-save]', function (b) { b.addEventListener('click', function () {
      var id = b.getAttribute('data-log-save'), inp = root.querySelector('[data-log-input="' + id + '"]');
      if (byId[id] && inp && logStudy(byId[id], inp.value)) render();
    }); });
    each('[data-pc-set]', function (cb) { cb.addEventListener('change', function () {
      var s = byId[cb.getAttribute('data-pc-set')]; if (s) { setPC(s, cb.checked); render(); }
    }); });
    each('[data-del-custom]', function (b) { b.addEventListener('click', function () {
      var id = b.getAttribute('data-del-custom');
      if (!window.confirm('Delete this custom subject? Its saved progress will no longer be shown.')) return;
      var c = customStore(); c.added = c.added.filter(function (x) { return x.id !== id; }); wr(SK_CUSTOM, c);
      if (state.openId === id) state.openId = null; render();
    }); });

    var sortEl = root.querySelector('#csu-sort');
    if (sortEl) sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });

    var addT = root.querySelector('#csu-add-toggle');
    if (addT) addT.addEventListener('click', function () { state.addOpen = !state.addOpen; render(); });
    var addC = root.querySelector('#csu-add-cancel');
    if (addC) addC.addEventListener('click', function () { state.addOpen = false; render(); });
    var addS = root.querySelector('#csu-add-save');
    if (addS) addS.addEventListener('click', function () {
      var name = (root.querySelector('#csu-add-name').value || '').trim();
      if (!name) return;
      var credits = Math.max(1, Math.min(12, parseInt(root.querySelector('#csu-add-credits').value, 10) || 3));
      var pcEl = root.querySelector('#csu-add-pc');
      var c = customStore();
      c.added.push({ id: 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, credits: credits, type: root.querySelector('#csu-add-type').value, sem: root.querySelector('#csu-add-sem').value, pc: !!(pcEl && pcEl.checked) });
      wr(SK_CUSTOM, c); state.addOpen = false; render();
    });

    var bd = root.querySelector('#csu-bulk-done'), bp = root.querySelector('#csu-bulk-pending');
    if (bd) bd.addEventListener('click', function () {
      var ids = state.filteredIds.slice(); if (!ids.length) return;
      if (window.confirm('Mark ' + ids.length + ' filtered subject(s) as Done?')) setDone(ids, true);
    });
    if (bp) bp.addEventListener('click', function () {
      var ids = state.filteredIds.slice(); if (!ids.length) return;
      if (window.confirm('Mark ' + ids.length + ' filtered subject(s) as Pending?')) setDone(ids, false);
    });

    var ra = root.querySelector('#csu-rev-add'), rp = root.querySelector('#csu-rev-pick');
    if (ra && rp) ra.addEventListener('click', function () { if (rp.value) { revFlag(rp.value, true); render(); } });
    var rfd = root.querySelector('#csu-rev-flag-done');
    if (rfd) rfd.addEventListener('click', function () {
      var rv = rd(SK_REV, {}), n = 0;
      subs.forEach(function (s) { if (prog[s.id] && !revNorm(rv[s.id])) { revFlag(s.id, true); n++; } });
      if (n) render();
    });

    /* v203 wiring */
    each('[data-prio-jump]', function (el) { el.addEventListener('click', function (e) {
      e.stopPropagation();
      var id = el.getAttribute('data-prio-jump');
      state.tab = 'subjects'; wr(SK_TABS, state.tab);
      state.search = ''; state.sem = 'All'; state.type = 'All'; state.status = 'All'; state.openId = id;
      render();
      var row = root.querySelector('[data-toggle-id="' + id + '"]');
      if (row && row.scrollIntoView) { try { row.scrollIntoView({ block: 'center' }); } catch (err) {} }
    }); });
    each('[data-edit-open]', function (b) { b.addEventListener('click', function () {
      var id = b.getAttribute('data-edit-open'); state.editId = state.editId === id ? null : id; render();
    }); });
    var ec = root.querySelector('#csu-edit-cancel');
    if (ec) ec.addEventListener('click', function () { state.editId = null; render(); });
    var esv = root.querySelector('[data-edit-save]');
    if (esv) esv.addEventListener('click', function () {
      var id = esv.getAttribute('data-edit-save'), s = byId[id]; if (!s) return;
      var name = (root.querySelector('#csu-edit-name').value || '').trim() || s.name;
      var credits = Math.max(1, Math.min(12, parseInt(root.querySelector('#csu-edit-credits').value, 10) || Number(s.credits) || 3));
      var type = root.querySelector('#csu-edit-type').value, c = customStore();
      if (s.custom) {
        var sem = root.querySelector('#csu-edit-sem').value;
        c.added = c.added.map(function (x) { return x.id === id ? Object.assign({}, x, { name: name, credits: credits, type: type, sem: sem }) : x; });
      } else c.edits[id] = Object.assign({}, c.edits[id], { name: name, credits: credits, type: type });
      wr(SK_CUSTOM, c); state.editId = null; render();
    });
    each('[data-move]', function (b) { b.addEventListener('click', function () {
      var p = b.getAttribute('data-move').split(':'), s = byId[p[0]]; if (!s) return;
      var c = customStore(), sem = String(s.sem);
      var ids = subs.filter(function (x) { return String(x.sem) === sem; }).map(function (x) { return x.id; });
      var o = c.order[sem] && c.order[sem].length ? c.order[sem].slice() : ids.slice();
      ids.forEach(function (id) { if (o.indexOf(id) === -1) o.push(id); });
      var vis = o.filter(function (id) { return ids.indexOf(id) !== -1; }), rest = o.filter(function (id) { return ids.indexOf(id) === -1; });
      var i = vis.indexOf(p[0]), j = p[1] === 'up' ? i - 1 : i + 1;
      if (i === -1 || j < 0 || j >= vis.length) return;
      var t = vis[i]; vis[i] = vis[j]; vis[j] = t;
      c.order[sem] = vis.concat(rest); wr(SK_CUSTOM, c); render();
    }); });
    each('[data-marks-input]', function (inp) { inp.addEventListener('change', function () {
      var id = inp.getAttribute('data-marks-input'), v = parseInt(inp.value, 10), m = internalMks();
      if (inp.value === '' || isNaN(v)) delete m[id]; else m[id] = Math.max(0, Math.min(100, v));
      wr(SK_IM, m); render();
    }); });
    var cs = root.querySelector('#csu-copy-summary');
    if (cs) cs.addEventListener('click', function () {
      copyText(buildSummary()).then(function (okc) {
        cs.textContent = okc ? '✓ Copied' : 'Copy blocked — use Download';
        setTimeout(function () { if (cs.isConnected) cs.textContent = '📋 Copy Summary'; }, 1600);
      });
    });
    var ds = root.querySelector('#csu-dl-summary');
    if (ds) ds.addEventListener('click', function () {
      downloadText('cse-syllabus-summary-' + new Date().toISOString().slice(0, 10) + '.txt', buildSummary());
    });
  }


  /* ── v203: backlog risk, exam banner, history, pace, summary ── */
  var BACKLOG_MARKS = 40;
  function nmKey(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function attData() { var d = rd(SK_ATT, null); return d && typeof d === 'object' && Array.isArray(d.subjects) ? d : null; }
  function attFor(s, att) {
    if (!att) return null;
    var k = nmKey(s.name); if (!k) return null;
    var m = att.subjects.filter(function (x) { return x && nmKey(x.name) === k; })[0];
    if (!m) return null;
    var total = Number(m.total) || 0; if (total <= 0) return null;
    var pct = (Number(m.attended) || 0) / total * 100;
    var thr = typeof m.threshold === 'number' && isFinite(m.threshold) && m.threshold > 0 ? m.threshold : (Number(att.threshold) || 75);
    return { pct: pct, threshold: thr };
  }
  function backlogRisk(s, marks, att) {
    var reasons = [], mk = marks[s.id];
    if (mk != null && mk < BACKLOG_MARKS) reasons.push('internal marks ' + mk + '/100 (below ' + BACKLOG_MARKS + ')');
    var a = attFor(s, att);
    if (a && a.pct < a.threshold) reasons.push('attendance ' + a.pct.toFixed(1) + '% (below ' + a.threshold + '%)');
    return { atRisk: reasons.length > 0, reasons: reasons };
  }
  function riskCount(subs) {
    var m = internalMks(), a = attData();
    return subs.filter(function (s) { return backlogRisk(s, m, a).atRisk; }).length;
  }
  function riskKpi(subs) {
    var n = riskCount(subs);
    return n ? '<div class="csu-kpi csu-kpi-due"><div class="csu-kpi-val">' + n + '</div><div class="csu-kpi-lbl">At risk</div></div>' : '';
  }

  /* soonest pending exam within 14 days, with how much of its syllabus is still open */
  function examBanner(subs, prog) {
    var em = examMap(subs);
    var up = subs.filter(function (s) { return !prog[s.id] && em[s.id]; })
      .map(function (s) { return { s: s, ei: examInfo(em[s.id]) }; })
      .filter(function (x) { return x.ei && x.ei.days >= 0 && x.ei.days <= 14; })
      .sort(function (a, b) { return a.ei.days - b.ei.days; });
    if (!up.length) return '';
    var x = up[0], cov = unitCovPct(x.s, prog), pend = 100 - (cov == null ? 0 : cov);
    var when = x.ei.days === 0 ? 'Exam today' : x.ei.days + (x.ei.days === 1 ? ' day' : ' days') + ' to exam';
    var warn = pend > 20;
    return '<div class="csu-banner ' + (warn ? 'csu-banner-warn' : 'csu-banner-ok') + '" data-exam-banner="1">' +
      '<span>' + (warn ? '⚠️ ' : '✅ ') + when + ': <strong>' + esc(x.s.name) + '</strong> — ' +
      (cov == null ? 'not marked done yet' : pend + '% of its units still pending') +
      (up.length > 1 ? ' · +' + (up.length - 1) + ' more within 14 days' : '') + '</span>' +
      '<button class="csu-btn csu-btn-ghost" data-prio-jump="' + esc(x.s.id) + '">Open</button></div>';
  }

  /* difficulty-weighted finish date per semester, from the last 14 days of real completions */
  function semPaceHTML(subs, prog, stats) {
    var st = stamps(), diff = difficulty(), byId = {};
    subs.forEach(function (s) { byId[s.id] = s; });
    var n = new Date(), t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(), from = t0 - 13 * 86400000;
    var cnt = 0, units = 0;
    Object.keys(st).forEach(function (id) {
      if (!byId[id] || !prog[id]) return;
      var d = new Date(st[id]); if (isNaN(d.getTime())) return;
      var m = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (m >= from && m <= t0) { cnt++; units += diff[id] || 3; }
    });
    var rate = cnt >= 3 ? units / 14 : null;
    var rows = Object.keys(stats.bySem).map(Number).sort(function (a, b) { return a - b; }).map(function (sem) {
      var b = stats.bySem[sem], rem = b.total - b.done, ru = 0;
      subs.forEach(function (s) { if (Number(s.sem) === sem && !prog[s.id]) ru += diff[s.id] || 3; });
      var fin = rem <= 0 ? '<span style="color:var(--success);font-weight:600">✓ Complete</span>'
        : rate ? '~' + new Date(t0 + Math.ceil(ru / rate) * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
      return '<div class="csu-sempace-row"><span class="csu-sempace-sem">Sem ' + sem + '</span><span class="csu-sempace-cnt">' + b.done + '/' + b.total + '</span><span class="csu-sempace-fin">' + fin + '</span></div>';
    }).join('');
    return '<div class="csu-card" data-sem-pace="1"><p class="csu-section-title">🗓️ Semester Pace Projection</p>' +
      (rate ? '<p style="font-size:.72rem;color:var(--text-secondary)">At ~<strong>' + rate.toFixed(2) + ' difficulty-units/day</strong> over the last 14 days (unrated subjects count as 3/5), each semester is projected to finish on the dates below — assuming you keep the same pace.</p>'
        : '<p class="csu-note">Mark at least 3 subjects done within 14 days to unlock per-semester finish dates.</p>') + rows + '</div>';
  }

  function buildSummary() {
    var subs = allSubjects(), prog = progress(), stats = computeStats(), L = [];
    L.push('CSE Syllabus+ progress — ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));
    L.push('Overall: ' + stats.done + '/' + stats.total + ' subjects · ' + stats.doneCr + '/' + stats.totalCr + ' credits');
    L.push('');
    Object.keys(stats.bySem).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sem) {
      L.push(semLabel(sem) + ': ' + stats.bySem[sem].done + '/' + stats.bySem[sem].total + ' done');
    });
    var em = examMap(subs);
    var ex = subs.filter(function (s) { return !prog[s.id] && em[s.id]; }).map(function (s) { return { s: s, ei: examInfo(em[s.id]) }; })
      .filter(function (x) { return x.ei && x.ei.days >= 0 && x.ei.days <= 30; }).sort(function (a, b) { return a.ei.days - b.ei.days; });
    if (ex.length) {
      L.push(''); L.push('Upcoming exams (30 days):');
      ex.forEach(function (x) { var c = unitCovPct(x.s, prog); L.push('- ' + x.s.name + ' — ' + em[x.s.id] + ' (' + x.ei.label + ')' + (c == null ? '' : ', ' + c + '% units covered')); });
    }
    var rv = rd(SK_REV, {});
    var due = subs.filter(function (s) { return revIsDue(revNorm(rv[s.id])); });
    if (due.length) { L.push(''); L.push('Revision due: ' + due.map(function (s) { return s.name; }).join(', ')); }
    var m = internalMks(), a = attData();
    var risk = subs.filter(function (s) { return backlogRisk(s, m, a).atRisk; });
    if (risk.length) {
      L.push(''); L.push('Backlog risk:');
      risk.forEach(function (s) { L.push('- ' + s.name + ': ' + backlogRisk(s, m, a).reasons.join('; ')); });
    }
    var q = priorityQueue(subs, prog, difficulty(), rd(SK_GATE, false)).slice(0, 5);
    if (q.length) { L.push(''); L.push('Study next:'); q.forEach(function (x, i) { L.push((i + 1) + '. ' + x.s.name + ' (' + semLabel(x.s.sem) + ', ' + x.s.credits + ' cr, difficulty ' + x.diff + '/5)'); }); }
    return L.join('\n');
  }
  function downloadText(name, text) {
    try {
      var b = new Blob([text], { type: 'text/plain' }), u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 1000);
      return true;
    } catch (e) { return false; }
  }
  function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; }); } catch (e) {}
    return Promise.resolve(false);
  }

  function editFormHTML(s) {
    var c = cfg();
    var semOpts = ((c && c.SEMESTERS) || []).map(function (x) { return '<option value="' + esc(x.sem) + '"' + (String(x.sem) === String(s.sem) ? ' selected' : '') + '>Sem ' + esc(x.sem) + '</option>'; }).join('');
    var typeOpts = ['Core', 'Lab', 'Elective', 'Project'].map(function (t) { return '<option' + (t === s.type ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    return '<div class="csu-form"><input class="csu-input" id="csu-edit-name" value="' + esc(s.name) + '" placeholder="Subject name" />' +
      '<input class="csu-input" id="csu-edit-credits" type="number" min="1" max="12" value="' + esc(s.credits) + '" />' +
      '<select class="csu-select" id="csu-edit-type">' + typeOpts + '</select>' +
      '<select class="csu-select" id="csu-edit-sem"' + (s.custom ? '' : ' disabled title="Base-syllabus subjects keep their original semester"') + '>' + semOpts + '</select>' +
      '<div class="csu-inline"><button class="csu-btn" data-edit-save="' + esc(s.id) + '">Save</button><button class="csu-btn csu-btn-ghost" id="csu-edit-cancel">Cancel</button></div></div>';
  }

  /* ── Priority scoring (mirrors main widget logic) ── */
  var PC_IDS = { 's4-4': 1, 's4-1': 1, 's4-2': 1, 's3-6': 1, 's3-5': 1, 's3-4': 1 };
  var GATE_IDS = PC_IDS;
  var PC_MULT = 1.6, GATE_MULT = 1.5;
  function isPC(s) { var c = window.AriseCSEPlacementCriticalConfig; return !!(c && c.SUBJECT_IDS && c.SUBJECT_IDS[s.id]) || s.pc === true; }
  function scoreSubject(s, diff, examDates, gateMode, prog) {
    var cr = Number(s.credits) || 1;
    var d  = diff[s.id] || 3;
    var pc = isPC(s) ? PC_MULT : 1;
    var gt = (gateMode && GATE_IDS[s.id]) ? GATE_MULT : 1;
    var ucov = prog ? unitCovPct(s, prog) : null;
    var uf = ucov == null ? 1 : Math.max(0.05, 1 - ucov / 100); // more units covered -> lower priority
    var ef = 1; // exam urgency (simplified — could re-add if needed)
    if (examDates && examDates[s.id]) {
      var days = Math.round((new Date(examDates[s.id] + 'T00:00:00') - new Date()) / 86400000);
      if (days >= 0 && days <= 3) ef = 3; else if (days <= 7) ef = 2.5; else if (days <= 14) ef = 2; else if (days <= 30) ef = 1.5;
    }
    return cr * d * pc * gt * ef * uf;
  }
  function priorityQueue(subjects, prog, diff, gateMode) {
    var pending = subjects.filter(function (s) { return !prog[s.id]; });
    var examDates = examMap(subjects);
    return pending.map(function (s) {
      return { s: s, score: scoreSubject(s, diff, examDates, gateMode, prog), diff: diff[s.id] || 3, pc: isPC(s), gate: !!GATE_IDS[s.id] };
    }).sort(function (a, b) { return b.score - a.score; }).slice(0, 10);
  }

  /* ── Pearson r for analytics ── */
  function pearson(xs, ys) {
    if (xs.length < 3) return null;
    var n = xs.length, mx = xs.reduce(function (a, v) { return a + v; }, 0) / n, my = ys.reduce(function (a, v) { return a + v; }, 0) / n;
    var num = 0, dx = 0, dy = 0;
    for (var i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += Math.pow(xs[i] - mx, 2); dy += Math.pow(ys[i] - my, 2); }
    return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
  }

  /* ── Pace projection ── */
  function paceProjection(subjects, prog) {
    var stmps = stamps();
    var now = Date.now(), cutoff = now - 14 * 86400000;
    var recent = Object.keys(stmps).filter(function (id) {
      var t = new Date(stmps[id]).getTime(); return t >= cutoff && t <= now;
    });
    if (recent.length < 3) return null;
    var rate = recent.length / 14; // subjects/day
    var remaining = subjects.filter(function (s) { return !prog[s.id]; }).length;
    if (!remaining) return { done: true };
    var days = Math.ceil(remaining / rate);
    var finishDate = new Date(now + days * 86400000);
    return { rate: rate.toFixed(2), days, finishDate: finishDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) };
  }

  /* ── Render functions per tab ── */
  function renderOverview(stats, subs, prog) {
    var gateMode = rd(SK_GATE, false);

    // type bars
    var typeColors = { Core: 'var(--info)', Lab: 'var(--warning)', Elective: 'var(--secondary)', Project: 'var(--success)' };
    var typeBars = ['Core', 'Lab', 'Elective', 'Project'].map(function (t) {
      var tb = stats.byType[t] || { total: 0, done: 0 };
      var pct2 = tb.total ? Math.round(tb.done / tb.total * 100) : 0;
      return '<div class="csu-bar-row"><span class="csu-bar-label">' + t + '</span>' +
        '<span class="csu-bar-track"><span class="csu-bar-fill" style="width:' + pct2 + '%;background:' + typeColors[t] + '"></span></span>' +
        '<span class="csu-bar-pct">' + pct2 + '%</span></div>';
    }).join('');

    // sem bars
    var sems = Object.keys(stats.bySem).map(Number).sort(function (a, b) { return a - b; });
    var semBars = sems.map(function (sem) {
      var sb = stats.bySem[sem]; var sp = sb.total ? Math.round(sb.done / sb.total * 100) : 0;
      return '<div class="csu-bar-row"><span class="csu-bar-label">' + esc(semLabel(sem)) + '</span>' +
        '<span class="csu-bar-track"><span class="csu-bar-fill" style="width:' + sp + '%;background:' + semColor(sem) + '"></span></span>' +
        '<span class="csu-bar-pct">' + sb.done + '/' + sb.total + '</span></div>';
    }).join('');

    // pace
    var pace = paceProjection(subs, prog);
    var paceHTML = '';
    if (pace && pace.done) paceHTML = '<div class="csu-card" style="color:var(--success);font-size:.75rem;font-weight:600">🎉 All subjects completed! Great work.</div>';
    else if (pace) paceHTML = '<div class="csu-card"><p class="csu-section-title">🚀 Pace Projection</p><p style="font-size:.74rem;color:var(--text-secondary)">At ~<strong>' + pace.rate + ' subjects/day</strong> (last 14 days), you\'ll finish the remaining ' + (stats.total - stats.done) + ' subjects by <strong>' + pace.finishDate + '</strong>.</p></div>';
    else paceHTML = '<div class="csu-card"><p class="csu-section-title">🚀 Pace Projection</p><p class="csu-note">Mark at least 3 subjects done within 14 days to unlock pace projection.</p></div>';

    // upcoming exams
    var examDates = examMap(subs);
    var today = new Date(); today.setHours(0,0,0,0);
    var upcoming = subs.map(function (s) {
      var d = examDates[s.id]; if (!d) return null;
      var dt = new Date(d + 'T00:00:00'); if (isNaN(dt.getTime())) return null;
      var days = Math.round((dt - today) / 86400000);
      return days >= 0 && days <= 30 ? { s, days } : null;
    }).filter(Boolean).sort(function (a, b) { return a.days - b.days; }).slice(0, 5);

    var upcomingHTML = '';
    if (upcoming.length) {
      upcomingHTML = '<div class="csu-card"><p class="csu-section-title">📅 Upcoming Exams</p>' +
        upcoming.map(function (x) {
          var when = x.days === 0 ? 'Today' : x.days === 1 ? 'Tomorrow' : 'in ' + x.days + 'd';
          return '<div class="csu-bar-row"><span class="csu-bar-label" style="width:auto;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.s.name) + '</span>' +
            '<span style="font-size:.62rem;color:var(--text-tertiary);flex-shrink:0">' + when + '</span>' +
            '</div>';
        }).join('') + '</div>';
    }

    return '<div class="csu-grid2">' +
      '<div class="csu-card">' +
        '<p class="csu-section-title">Subjects</p>' +
        '<div style="font-size:.78rem;font-weight:700;color:var(--text-primary)">' + stats.done + '/' + stats.total + ' subjects done</div>' +
        '<div style="font-size:.66rem;color:var(--text-tertiary);margin-top:.15rem">' + stats.doneCr + '/' + stats.totalCr + ' credits complete</div>' +
      '</div>' +
      '<div class="csu-card"><p class="csu-section-title">By Subject Type</p><div class="csu-progress-bars">' + typeBars + '</div></div>' +
      '</div>' +
      '<div class="csu-card"><p class="csu-section-title">By Semester</p><div class="csu-progress-bars">' + semBars + '</div></div>' +
      paceHTML + semPaceHTML(subs, prog, stats) + upcomingHTML;
  }

  function renderSubjects(subs, prog) {
    var diff = difficulty(), sess = focusSess(), revData = rd(SK_REV, {});
    var c = cfg();
    var exMap = examMap(subs);
    var ctx = { marks: internalMks(), att: attData() };
    var filtered = subs.filter(function (s) {
      var q = state.search.trim().toLowerCase();
      if (q && s.name.toLowerCase().indexOf(q) === -1) return false;
      if (state.sem !== 'All' && String(s.sem) !== String(state.sem)) return false;
      if (state.type !== 'All' && s.type !== state.type) return false;
      if (state.status === 'Done' && !prog[s.id]) return false;
      if (state.status === 'Pending' && prog[s.id]) return false;
      if (state.status === 'Revision' && !revData[s.id]) return false;
      if (state.status === 'Due' && !revIsDue(revNorm(revData[s.id]))) return false;
      if (state.status === 'BacklogRisk' && !backlogRisk(s, ctx.marks, ctx.att).atRisk) return false;
      return true;
    });
    filtered = sortSubjects(filtered, diff, exMap);
    state.filteredIds = filtered.map(function (s) { return s.id; });

    var semOpts = '<option value="All">All Sems</option>' +
      ((c && c.SEMESTERS) ? c.SEMESTERS.map(function (s) {
        return '<option value="' + s.sem + '"' + (String(state.sem) === String(s.sem) ? ' selected' : '') + '>Sem ' + s.sem + '</option>';
      }).join('') : '');
    var typeOpts = ['All','Core','Lab','Elective','Project'].map(function (t) {
      return '<option' + (state.type === t ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
    var statusOpts = ['All','Done','Pending','Revision','Due','BacklogRisk'].map(function (st) {
      return '<option value="' + st + '"' + (state.status === st ? ' selected' : '') + '>' + (st === 'BacklogRisk' ? '⚠️ Backlog Risk' : st) + '</option>';
    }).join('');

    var typeColors = { Core: 'var(--info)', Lab: 'var(--warning)', Elective: 'var(--secondary)', Project: 'var(--success)' };

    var rows = filtered.map(function (s) {
      var done = !!prog[s.id];
      var sc = semColor(s.sem);
      var uc = unitCovPct(s, prog);
      var rev = revNorm(revData[s.id]);
      var isDue = rev && rev.flagged && (rev.nextDueAt == null || rev.nextDueAt <= Date.now());
      var sm = studyMin(s, sess);
      var tc = typeColors[s.type] || 'var(--text-tertiary)';
      var chips = '';
      if (isPC(s)) chips += '<span class="csu-chip csu-chip-pc">🎯 PC</span>';
      if (rev && rev.flagged) chips += '<span class="csu-chip ' + (isDue ? 'csu-chip-due' : 'csu-chip-rev') + '">🔄' + (isDue ? ' Due' : '') + '</span>';
      if (uc !== null && !done) {
        chips += '<span class="csu-bar-track csu-units-bar"><span class="csu-units-fill" style="width:' + uc + '%;background:' + (uc >= 80 ? 'var(--success)' : uc >= 50 ? 'var(--info)' : 'var(--warning)') + '"></span></span>';
      }
      return '<div class="csu-subj-row" data-toggle-id="' + esc(s.id) + '" style="border-left:2.5px solid ' + sc + '">' +
        '<span class="csu-subj-check" style="' + (done ? 'background:' + sc + ';border-color:' + sc : '') + '">' + (done ? '✓' : '') + '</span>' +
        '<span class="csu-subj-name" data-done="' + (done ? '1' : '0') + '">' + esc(s.name) + '</span>' +
        chips + rowExtras(s, diff, exMap, ctx) +
        '<span class="csu-tag" style="color:' + tc + ';background:' + tc + '20">' + esc(s.type) + '</span>' +
        '<span class="csu-subj-meta">' + esc(semLabel(s.sem)) + ' · ' + (s.credits) + 'cr' + (sm > 0 ? ' · ⏱' + fmtMin(sm) : '') + '</span>' +
        (s.custom ? '<span class="csu-chip" style="color:var(--primary);background:color-mix(in srgb,var(--primary) 12%,transparent)">custom</span>' : '') +
        '<button class="csu-chev" data-open-id="' + esc(s.id) + '" title="Details: difficulty, exam date, revision, units, study time" aria-expanded="' + (state.openId === s.id ? 'true' : 'false') + '">' + (state.openId === s.id ? '▾' : '▸') + '</button>' +
        '</div>' + (state.openId === s.id ? drawerHTML(s, prog, diff, exMap, revData, sess) : '');
    }).join('');

    return '<div class="csu-toolbar">' +
      '<input class="csu-input" id="csu-search" placeholder="Search subjects…" value="' + esc(state.search) + '" />' +
      '<select class="csu-select" id="csu-sem-filter" aria-label="Filter by semester">' + semOpts + '</select>' +
      '<select class="csu-select" id="csu-type-filter" aria-label="Filter by subject type">' + typeOpts + '</select>' +
      '<select class="csu-select" id="csu-status-filter" aria-label="Filter by status">' + statusOpts + '</select>' +
      '<select class="csu-select" id="csu-sort" title="Sort subjects" aria-label="Sort subjects">' +
        [['default', 'Sort: Default'], ['name', 'Name A–Z'], ['credits', 'Credits ↓'], ['difficulty', 'Difficulty ↓'], ['exam', 'Exam date ↑']].map(function (o) {
          return '<option value="' + o[0] + '"' + (state.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>' +
      '<button class="csu-btn" id="csu-add-toggle">' + (state.addOpen ? '✕ Close' : '+ Add Subject') + '</button>' +
      '<span style="font-size:.68rem;color:var(--text-tertiary)">' + filtered.length + ' subjects</span>' +
      '</div>' +
      (state.addOpen ? addFormHTML() : '') +
      '<div class="csu-bulk"><span>Bulk (' + filtered.length + ' filtered):</span>' +
        '<button class="csu-btn csu-btn-ghost" id="csu-bulk-done">✓ Mark Done</button>' +
        '<button class="csu-btn csu-btn-ghost" id="csu-bulk-pending">↺ Mark Pending</button></div>' +
      '<div class="csu-subj-list">' + (rows || '<div class="csu-empty">No subjects match your filters.</div>') + '</div>' +
      '<p class="csu-note" style="margin-top:.6rem">Click a subject to toggle done/pending; tap ▸ for difficulty, exam date, revision, units and study-time logging. Progress syncs with the accordion below.</p>';
  }

  function renderPriority(subs, prog) {
    var diff = difficulty();
    var gateMode = rd(SK_GATE, false);
    var queue = priorityQueue(subs, prog, diff, gateMode);
    if (!queue.length) return '<div class="csu-empty">🎉 All subjects are marked done!</div>';
    var rows = queue.map(function (item, i) {
      var s = item.s;
      var why = [];
      if (item.pc) why.push('placement-critical');
      if (item.gate) why.push('GATE-heavy');
      why.push('difficulty ' + item.diff + '/5');
      why.push(s.credits + ' cr');
      return '<div class="csu-prio-row" data-prio-jump="' + esc(s.id) + '" title="Open in Subjects">' +
        '<span class="csu-prio-rank">#' + (i + 1) + '</span>' +
        '<div class="csu-prio-body">' +
          '<span class="csu-prio-name">' + esc(s.name) + '</span>' +
          '<span class="csu-prio-meta">' + esc(semLabel(s.sem)) + ' · ' + s.credits + 'cr · diff ' + item.diff + '/5' +
            (item.pc ? ' · <span style="color:var(--warning)">🎯 PC</span>' : '') +
          '</span>' +
          (i === 0 ? '<span class="csu-prio-why">Study first — highest weighted score: ' + why.join(', ') + '.</span>' : '') +
        '</div>' +
        '<span class="csu-prio-score">' + item.score.toFixed(1) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="csu-card" style="margin-bottom:.6rem">' +
      '<label style="font-size:.72rem;color:var(--text-secondary);display:flex;align-items:center;gap:.4rem;cursor:pointer">' +
      '<input type="checkbox" id="csu-gate-toggle"' + (gateMode ? ' checked' : '') + ' /> 🎓 GATE mode — re-weight toward DAA/TOC/CN/DBMS/OS</label>' +
      '</div>' + rows +
      '<p class="csu-note">Score = credits × difficulty × exam urgency × 1.6 if placement-critical × 1.5 if GATE-heavy × unit-coverage-remaining (subjects you have mostly covered unit-by-unit rank lower). Rate difficulty and set exam dates from the ▸ drawer on any subject in the Subjects tab; exam dates also come from the Exam Tracker automatically.</p>';
  }

  function renderAnalytics(subs, prog) {
    var diff = difficulty(), sess = focusSess();

    // Study time ↔ difficulty correlation
    var ratedLogged = subs.filter(function (s) { return diff[s.id] && studyMin(s, sess) > 0; });
    var r = ratedLogged.length >= 3 ? pearson(
      ratedLogged.map(function (s) { return diff[s.id]; }),
      ratedLogged.map(function (s) { return studyMin(s, sess); })
    ) : null;
    var rTone = r == null ? 'flat' : r >= 0.4 ? 'up' : r >= 0.15 ? 'up' : r > -0.15 ? 'flat' : 'down';
    var rText = r == null ? 'Not enough data yet' : r >= 0.4 ? 'Harder subjects are getting more study time ✓' : r >= 0.15 ? 'Slight lean toward studying harder subjects more' : r > -0.15 ? 'No clear link between difficulty and time spent' : 'Easier subjects are getting more time — flip the balance';

    // Total study time breakdown
    var totalMin = subs.reduce(function (acc, s) { return acc + studyMin(s, sess); }, 0);
    var doneMin = subs.filter(function (s) { return prog[s.id]; }).reduce(function (acc, s) { return acc + studyMin(s, sess); }, 0);
    var pendMin = totalMin - doneMin;

    // Pace
    var pace = paceProjection(subs, prog);
    var paceHTML = '';
    if (pace && pace.done) paceHTML = '<div class="csu-card" style="color:var(--success);font-size:.76rem;font-weight:600">🎉 Everything completed!</div>';
    else if (pace) paceHTML = '<div class="csu-card"><p class="csu-section-title">🚀 Completion Pace</p>' +
      '<p style="font-size:.74rem;color:var(--text-secondary)">~<strong>' + pace.rate + ' subjects/day</strong> over the last 14 days — remaining ' + (subs.length - Object.keys(prog).filter(function (k) { return prog[k]; }).length) + ' subjects → estimated finish <strong>' + pace.finishDate + '</strong>.</p></div>';
    else paceHTML = '<div class="csu-card"><p class="csu-section-title">🚀 Completion Pace</p><p class="csu-note">Mark 3+ subjects done in the last 14 days to see a projection.</p></div>';

    return '<div class="csu-grid2">' +
      '<div class="csu-card">' +
        '<p class="csu-section-title">Study Time ↔ Difficulty</p>' +
        '<p class="' + (rTone === 'up' ? 'csu-corr-tone-up' : rTone === 'down' ? 'csu-corr-tone-down' : 'csu-corr-tone-flat') + '" style="font-size:.74rem;margin:0 0 .4rem">' + rText + '</p>' +
        '<div class="csu-grid4" style="grid-template-columns:1fr 1fr">' +
          '<div class="csu-ana-stat"><div class="csu-ana-val">' + (r != null ? r.toFixed(2) : '—') + '</div><div class="csu-ana-lbl">Correlation (r)</div></div>' +
          '<div class="csu-ana-stat"><div class="csu-ana-val">' + ratedLogged.length + '</div><div class="csu-ana-lbl">Rated & logged</div></div>' +
        '</div>' +
        '<p class="csu-note">r ∈ [−1, 1]. Needs 3+ subjects both rated and with logged time.</p>' +
      '</div>' +
      '<div class="csu-card">' +
        '<p class="csu-section-title">Study Time</p>' +
        '<div class="csu-grid4" style="grid-template-columns:repeat(3,1fr)">' +
          '<div class="csu-ana-stat"><div class="csu-ana-val">' + (totalMin ? fmtMin(totalMin) : '0m') + '</div><div class="csu-ana-lbl">Total logged</div></div>' +
          '<div class="csu-ana-stat"><div class="csu-ana-val">' + (doneMin ? fmtMin(doneMin) : '0m') + '</div><div class="csu-ana-lbl">On done subjs</div></div>' +
          '<div class="csu-ana-stat"><div class="csu-ana-val">' + (pendMin ? fmtMin(pendMin) : '0m') + '</div><div class="csu-ana-lbl">On pending</div></div>' +
        '</div>' +
      '</div>' +
      '</div>' +
      paceHTML;
  }

  function renderIATracker(subs) {
    var data = iaData(), cfg2 = iaSettings();
    var IA_THRESH = 40;
    var sem = state.sem === 'All' ? null : state.sem;
    var shown = sem ? subs.filter(function (s) { return String(s.sem) === String(sem); }) : subs;

    var semOpts = '<option value="All">All Sems</option>' +
      (cfg() && cfg().SEMESTERS ? cfg().SEMESTERS.map(function (s) {
        return '<option value="' + s.sem + '"' + (state.sem === String(s.sem) ? ' selected' : '') + '>Sem ' + s.sem + '</option>';
      }).join('') : '');

    var atRisk = shown.filter(function (s) { return calcIA(data[s.id], cfg2).combined != null && calcIA(data[s.id], cfg2).combined < IA_THRESH; }).length;

    var header = '<div class="csu-toolbar" style="margin-bottom:.75rem">' +
      '<select class="csu-select" id="csu-ia-sem">' + semOpts + '</select>' +
      '<span style="font-size:.68rem;color:var(--text-tertiary)">' + shown.length + ' subjects</span>' +
      (atRisk ? '<span class="csu-chip csu-chip-due">⚠️ ' + atRisk + ' below ' + IA_THRESH + '%</span>' : '') +
      '<span class="csu-note" style="margin:0">&nbsp;IA Max: <input class="csu-ia-num" id="csu-ia-max" type="number" min="1" max="100" value="' + cfg2.iaMax + '" style="width:44px"> &nbsp;Assign Max: <input class="csu-ia-num" id="csu-assign-max" type="number" min="1" max="100" value="' + cfg2.assignMax + '" style="width:44px"></span>' +
      '</div>';

    var rows = shown.map(function (s) {
      var e = data[s.id] || {};
      var sc = calcIA(e, cfg2);
      var tone = sc.combined == null ? 'none' : sc.combined < IA_THRESH ? 'danger' : sc.combined < 60 ? 'warn' : 'ok';
      var badgeCls = 'csu-ia-badge csu-ia-badge-' + tone;
      var badgeText = sc.combined == null ? 'No data' : Math.round(sc.combined) + '%' + (sc.combined < IA_THRESH ? ' ⚠️' : sc.combined >= 75 ? ' ✓' : '');
      return '<div class="csu-ia-row">' +
        '<span class="csu-ia-name">' + esc(s.name) + '</span>' +
        '<input class="csu-ia-num csu-input" type="number" min="0" max="' + cfg2.iaMax + '" step="0.5" placeholder="IA1" value="' + (e.ia1 != null ? e.ia1 : '') + '" data-ia-field="' + esc(s.id) + ':ia1:' + cfg2.iaMax + '" style="width:52px" />' +
        '<input class="csu-ia-num csu-input" type="number" min="0" max="' + cfg2.iaMax + '" step="0.5" placeholder="IA2" value="' + (e.ia2 != null ? e.ia2 : '') + '" data-ia-field="' + esc(s.id) + ':ia2:' + cfg2.iaMax + '" style="width:52px" />' +
        '<input class="csu-ia-num csu-input" type="number" min="0" max="' + cfg2.assignMax + '" step="0.5" placeholder="Asgn" value="' + (e.assignment != null ? e.assignment : '') + '" data-ia-field="' + esc(s.id) + ':assignment:' + cfg2.assignMax + '" style="width:52px" />' +
        '<span class="' + badgeCls + '">' + badgeText + '</span>' +
        '</div>';
    }).join('');

    return header +
      '<div style="font-size:.65rem;color:var(--text-tertiary);margin-bottom:.45rem">IA1 &nbsp;·&nbsp; IA2 &nbsp;·&nbsp; Assignment &nbsp;→&nbsp; Combined score. Best 2 IAs averaged, then blended with assignment at ' + cfg2.iaWeightPct + '% IA / ' + (100 - cfg2.iaWeightPct) + '% assignment.</div>' +
      (rows || '<div class="csu-empty">No subjects in this semester.</div>') +
      '<p class="csu-note" style="margin-top:.6rem">Scores are saved as you type. Below ' + IA_THRESH + '% combined = arrear risk flag. Adjust IA/Assignment max above to match your college\'s scheme.</p>';
  }

  function renderResources(subs) {
    var hasPYQ = subs.filter(function (s) { return !!PYQ_MAP[s.id]; });
    if (!hasPYQ.length) return '<div class="csu-empty">No curated resources yet for your filtered subjects.</div>';
    return hasPYQ.map(function (s) {
      var links = PYQ_MAP[s.id].map(function (lk) {
        return '<a class="csu-res-link csu-res-tag-' + lk.type + '" href="' + lk.url + '" target="_blank" rel="noopener">' +
          (lk.type === 'gate' ? '🎓' : '💼') + ' ' + esc(lk.label) + '</a>';
      }).join('');
      return '<div class="csu-res-subj"><div class="csu-res-subj-name">' + esc(s.name) + '</div><div class="csu-res-links">' + links + '</div></div>';
    }).join('') + '<p class="csu-note" style="margin-top:.6rem">🎓 = GATE PYQs &nbsp;·&nbsp; 💼 = Placement / interview resources. Add your own in the Subjects tab via notes or bookmarks.</p>';
  }

  function renderCollegeSync(subs) {
    var cust = rd(SK_CUSTOM, { added: [], removed: [], edits: {}, order: {} });
    var removed = {};  (cust.removed || []).forEach(function (id) { removed[id] = true; });
    var c = cfg(); if (!c) return '<div class="csu-empty">Syllabus config not loaded.</div>';

    var sem = state.sem === 'All' ? '1' : state.sem;
    var semOpts = '<option value="All">All Sems</option>' +
      c.SEMESTERS.map(function (s) {
        return '<option value="' + s.sem + '"' + (state.sem === String(s.sem) ? ' selected' : '') + '>Sem ' + s.sem + '</option>';
      }).join('');

    var baseSubs = c.SUBJECTS.filter(function (s) { return state.sem === 'All' || String(s.sem) === String(state.sem); });
    var addedCustom = (cust.added || []).filter(function (s) { return state.sem === 'All' || String(s.sem) === String(state.sem); });

    var hidden = baseSubs.filter(function (s) { return removed[s.id]; }).length;
    var rows = baseSubs.map(function (s) {
      var isHidden = !!removed[s.id];
      return '<label class="csu-cs-row ' + (isHidden ? 'csu-cs-row-hidden' : '') + '">' +
        '<input type="checkbox" data-cs-toggle="' + esc(s.id) + '"' + (isHidden ? '' : ' checked') + ' />' +
        '<span class="csu-cs-name">' + esc(s.name) + '</span>' +
        '<span class="csu-cs-type">' + esc(s.type) + '</span>' +
        '</label>';
    }).join('');
    var addedRows = addedCustom.map(function (s) {
      return '<div class="csu-cs-row"><span class="csu-cs-name">' + esc(s.name) + '</span>' +
        '<span class="csu-cs-type csu-cs-custom">custom</span>' +
        '<span class="csu-cs-type">' + s.credits + 'cr</span></div>';
    }).join('');

    return '<div class="csu-toolbar" style="margin-bottom:.7rem">' +
      '<select class="csu-select" id="csu-cs-sem">' + semOpts + '</select>' +
      '<span style="font-size:.68rem;color:var(--text-tertiary)">' + (baseSubs.length - hidden) + ' active · ' + hidden + ' hidden · ' + addedCustom.length + ' custom</span>' +
      (hidden ? '<button class="csu-btn csu-btn-ghost" id="csu-cs-restore" data-sem="' + esc(state.sem) + '">↺ Restore all hidden</button>' : '') +
      '</div>' +
      '<div style="max-height:420px;overflow-y:auto;padding-right:.15rem">' +
      rows + addedRows +
      '</div>' +
      '<div style="margin-top:.8rem">' +
        '<p class="csu-section-title">Paste your college\'s subjects</p>' +
        '<textarea class="csu-input" id="csu-cs-bulk-text" rows="3" style="width:100%;font-family:monospace;font-size:.7rem;resize:vertical" placeholder="Subject Name | Credits | Type&#10;Advanced DSA | 4 | Core&#10;IoT Lab | 1 | Lab"></textarea>' +
        '<button class="csu-btn" id="csu-cs-bulk-add" data-sem="' + esc(state.sem === 'All' ? '1' : state.sem) + '" style="margin-top:.35rem">+ Add Pasted Subjects</button>' +
      '</div>' +
      '<p class="csu-note" style="margin-top:.6rem">Uncheck base subjects your college doesn\'t teach — they\'re hidden from totals but never deleted. Paste bulk subjects in "Name | Credits | Type" format, one per line.</p>';
  }

  function renderData() {
    return '<div class="csu-card"><p class="csu-section-title">Export & Import</p>' +
      '<p style="font-size:.73rem;color:var(--text-secondary);margin-bottom:.5rem">Back up or restore your full Syllabus+ data (progress, custom subjects, difficulty, exam dates, IA scores, revision flags, completion timestamps). The Exam Bundle also includes CGPA Tracker and Attendance Tracker.</p>' +
      '<div class="csu-data-btn-row">' +
        '<button class="csu-btn" id="csu-export-full">⬇️ Export Backup</button>' +
        '<button class="csu-btn csu-btn-ghost" id="csu-import-full">⬆️ Import Backup</button>' +
        '<input type="file" id="csu-import-file" accept="application/json" style="display:none" />' +
        '<button class="csu-btn csu-btn-ghost" id="csu-export-bundle">📦 Export Exam Bundle</button>' +
        '<button class="csu-btn csu-btn-ghost" id="csu-import-bundle">📦 Import Exam Bundle</button>' +
        '<input type="file" id="csu-import-bundle-file" accept="application/json" style="display:none" />' +
      '</div></div>' +
      '<div class="csu-card" style="margin-top:.6rem"><p class="csu-section-title">Progress Summary</p>' +
        '<p style="font-size:.73rem;color:var(--text-secondary);margin-bottom:.5rem">A plain-text snapshot — overall progress, per-semester progress, upcoming exams, revisions due, backlog risks and what to study next. Handy for sharing with a mentor or study group.</p>' +
        '<div class="csu-data-btn-row"><button class="csu-btn" id="csu-copy-summary">📋 Copy Summary</button><button class="csu-btn csu-btn-ghost" id="csu-dl-summary">⬇️ Download (.txt)</button></div></div>' +
      '';
  }

  /* ── Main render ── */
  var root = null;

  /* ═══════════════════════════════════════════════════════════════════
     Readiness Score (v216) — Dev-Mastery-style hero panel for the
     CSE Syllabus+ widget. Theme-safe: only CSS custom properties, no
     hard-coded surface/text colours. Read-only on syllabus data; its
     own keys (history, last-seen level, mode, open/closed) use the
     csu-rs-* prefix so nothing else purges them.
     ═══════════════════════════════════════════════════════════════════ */
  var SK_RS_MODE = 'csu-rs-mode-v2';
  var SK_RS_OPEN = 'csu-rs-open-v2';
  var SK_RS_HIST = 'csu-rs-history-v3';   /* { 'YYYY-MM-DD': { weighted, credit, simple } } — one trend per mode */
  var SK_RS_SEEN = 'csu-rs-level-seen-v3'; /* { weighted: idx, credit: idx, simple: idx } — level-up is per mode */
  var SK_RS_GOAL = 'csu-rs-goal-v1';       /* { level: 1..4, date: 'YYYY-MM-DD' | '' } */
  var RS_STYLE_ID = 'csu-rs-style';
  var RS_K = 2 * Math.PI * 80;
  var RS_LEVELS = [
    { key: 'beginner',     label: 'Beginner',     icon: '🌱', min: 0,  max: 19,  color: 'var(--text-tertiary, #7c8aa8)' },
    { key: 'intermediate', label: 'Intermediate', icon: '⚡', min: 20, max: 39,  color: 'var(--info)' },
    { key: 'advanced',     label: 'Advanced',     icon: '🔥', min: 40, max: 59,  color: 'var(--secondary)' },
    { key: 'expert',       label: 'Expert',       icon: '💎', min: 60, max: 79,  color: 'var(--warning)' },
    { key: 'jobready',     label: 'Job Ready',    icon: '🚀', min: 80, max: 100, color: 'var(--success)' }
  ];
  var RS_MODES = [
    { key: 'weighted', label: 'Weighted', tip: 'Credits × your self-rated difficulty (unrated = 3/5), with partial credit for covered units' },
    { key: 'credit',   label: 'Credits',  tip: 'Credit-weighted, with partial credit for covered units' },
    { key: 'simple',   label: 'Simple',   tip: 'Plain subject completion — every subject counts equally' }
  ];
  var RS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var RS_TYPES = ['Core', 'Lab', 'Elective', 'Project'];
  var rsLast = { pct: 0 };
  var rsPrevHTML = '';

  function rsClamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) n = 0; return Math.min(hi, Math.max(lo, n)); }
  function rsMode() {
    var m = rd(SK_RS_MODE, 'weighted');
    return RS_MODES.some(function (x) { return x.key === m; }) ? m : 'weighted';
  }
  function rsModeLabel(k) { return (RS_MODES.filter(function (m) { return m.key === k; })[0] || RS_MODES[0]).label; }
  function rsLevel(pct) {
    pct = rsClamp(Math.round(pct), 0, 100);
    for (var i = 0; i < RS_LEVELS.length; i++) if (pct <= RS_LEVELS[i].max) return { index: i, info: RS_LEVELS[i] };
    return { index: RS_LEVELS.length - 1, info: RS_LEVELS[RS_LEVELS.length - 1] };
  }
  function rsWeight(s, diff, mode) {
    var cr = Math.max(1, Number(s.credits) || 1);
    if (mode === 'simple') return 1;
    if (mode === 'credit') return cr;
    return cr * rsClamp(diff[s.id] || 3, 1, 5);
  }
  /* done = 1; otherwise partial credit from unit coverage (capped below 1 until ticked done) */
  function rsFrac(s, prog, mode) {
    if (prog[s.id]) return 1;
    if (mode === 'simple') return 0;
    var uc = unitCovPct(s, prog);
    return uc == null ? 0 : Math.min(0.95, rsClamp(uc, 0, 100) / 100);
  }
  function rsYmd(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function rsFmtDate(d) { return RS_MONTHS[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''); }
  function rsGroupPct(list, prog, diff, mode) {
    var tw = 0, gw = 0;
    list.forEach(function (s) { var w = rsWeight(s, diff, mode); tw += w; gw += w * rsFrac(s, prog, mode); });
    return tw > 0 ? Math.round(gw / tw * 100) : null;
  }

  /* pace from real completion timestamps: score points gained per day over the last 14 days, plus streak */
  function rsPace(subs, prog, diff, mode, totalW) {
    var st = stamps(), now = Date.now(), win = 14 * 864e5, gained = 0, n = 0, n7 = 0, days = {};
    subs.forEach(function (s) {
      if (!prog[s.id] || !st[s.id]) return;
      var ms = new Date(st[s.id]).getTime();
      if (!isFinite(ms) || ms > now + 864e5) return;
      days[rsYmd(new Date(ms))] = 1;
      if (now - ms <= win) { gained += rsWeight(s, diff, mode) / totalW * 100; n++; }
      if (now - ms <= 7 * 864e5) n7++;
    });
    var streak = 0, cur = new Date(); cur.setHours(12, 0, 0, 0);
    if (!days[rsYmd(cur)]) cur = new Date(cur.getTime() - 864e5);
    while (days[rsYmd(cur)] && streak < 3650) { streak++; cur = new Date(cur.getTime() - 864e5); }
    return { rate: n >= 2 ? gained / 14 : null, n: n, n7: n7, streak: streak };
  }
  function rsEta(remPts, rate) {
    if (remPts <= 0) return { done: true };
    if (!rate || rate <= 0) return null;
    var dd = Math.ceil(remPts / rate);
    if (dd > 730) return { far: true };
    return { days: dd, date: new Date(Date.now() + dd * 864e5) };
  }
  function rsEtaText(e) {
    if (!e) return '—';
    if (e.done) return '✓ reached';
    if (e.far) return '2+ years at this pace';
    return '≈ ' + rsFmtDate(e.date) + ' (' + e.days + 'd)';
  }
  function rsGoal() {
    var g = rd(SK_RS_GOAL, null);
    if (!g || typeof g !== 'object') return null;
    var lv = Number(g.level);
    if (!(lv >= 1 && lv <= 4)) return null;
    return { level: Math.floor(lv), date: /^\d{4}-\d{2}-\d{2}$/.test(String(g.date || '')) ? String(g.date) : '' };
  }

  function rsCompute() {
    var subs = allSubjects(), prog = progress(), diff = difficulty(), mode = rsMode();
    var rv = rd(SK_REV, {});
    var raws = {};
    RS_MODES.forEach(function (m) {
      var tw = 0, gw = 0;
      subs.forEach(function (s) { var w = rsWeight(s, diff, m.key); tw += w; gw += w * rsFrac(s, prog, m.key); });
      raws[m.key] = tw > 0 ? gw / tw * 100 : 0;
    });
    var totalW = 0, gotW = 0, done = 0, partial = 0, totalCr = 0, doneCr = 0, flagged = 0;
    var bySem = {}, pending = [];
    subs.forEach(function (s) {
      var w = rsWeight(s, diff, mode), f = rsFrac(s, prog, mode), isDone = !!prog[s.id];
      var cr = Number(s.credits) || 0;
      totalW += w; gotW += w * f; totalCr += cr;
      if (isDone) { done++; doneCr += cr; } else if (f > 0) partial++;
      var r = revNorm(rv[s.id]); if (r && r.flagged) flagged++;
      var b = bySem[s.sem] || (bySem[s.sem] = { sem: s.sem, total: 0, done: 0, w: 0, got: 0 });
      b.total++; if (isDone) b.done++; b.w += w; b.got += w * f;
      if (!isDone) pending.push({ s: s, rw: w * (1 - f) });
    });
    var raw = raws[mode];
    var pct = rsClamp(Math.round(raw), 0, 100);
    var lvl = rsLevel(pct);
    var semRows = Object.keys(bySem).map(Number).sort(function (a, b) { return a - b; }).map(function (k) {
      var b = bySem[k]; b.pct = b.w > 0 ? Math.round(b.got / b.w * 100) : 0; b.remW = b.w - b.got; return b;
    });
    var weakest = null;
    semRows.forEach(function (r) {
      if (r.total > 0 && r.pct < 100 && (!weakest || r.pct < weakest.pct || (r.pct === weakest.pct && r.remW > weakest.remW))) weakest = r;
    });
    var gap = null;
    if (lvl.index < RS_LEVELS.length - 1 && totalW > 0) {
      var nx = RS_LEVELS[lvl.index + 1];
      var needW = (nx.min - 0.5) / 100 * totalW - gotW;
      var n = 0, acc = 0;
      pending.slice().sort(function (a, b) { return b.rw - a.rw; }).forEach(function (p) {
        if (acc >= needW) return; acc += p.rw; n++;
      });
      gap = { next: nx, pts: Math.max(1, nx.min - pct), subjects: Math.max(1, n) };
    }
    var pcAll = subs.filter(isPC), pcDone = pcAll.filter(function (s) { return prog[s.id]; }).length;
    var byType = RS_TYPES.map(function (t) {
      var l = subs.filter(function (s) { return s.type === t; });
      return { type: t, total: l.length, done: l.filter(function (s) { return prog[s.id]; }).length, pct: rsGroupPct(l, prog, diff, mode) };
    }).filter(function (x) { return x.total > 0; });
    var avgPending = pending.length && totalW > 0 ? (100 - raw) / pending.length : 0;
    return {
      subs: subs, prog: prog, mode: mode, total: subs.length, done: done, remaining: subs.length - done,
      partial: partial, totalCr: totalCr, doneCr: doneCr, flagged: flagged,
      due: revDueCount(subs), risk: riskCount(subs),
      simplePct: subs.length ? Math.round(done / subs.length * 100) : 0,
      raw: raw, raws: raws, pcts: { weighted: Math.round(raws.weighted), credit: Math.round(raws.credit), simple: Math.round(raws.simple) },
      pct: pct, level: lvl, semRows: semRows, weakest: weakest, gap: gap, totalW: totalW, gotW: gotW,
      pcTotal: pcAll.length, pcDone: pcDone, pcPct: pcAll.length ? rsGroupPct(pcAll, prog, diff, mode) : null,
      byType: byType, pendingCount: pending.length, avgPending: avgPending,
      pace: totalW > 0 ? rsPace(subs, prog, diff, mode, totalW) : { rate: null, n: 0, n7: 0, streak: 0 }
    };
  }

  /* ── history (one point per day per mode, 60 days) + per-mode level-up detection ── */
  function rsHistory() {
    var h = rd(SK_RS_HIST, {});
    return h && typeof h === 'object' && !Array.isArray(h) ? h : {};
  }
  function rsRecord(d) {
    if (!d.total) return rsHistory();
    var h = rsHistory(), key = rsYmd(new Date()), cur = h[key] && typeof h[key] === 'object' ? h[key] : {};
    if (cur.weighted !== d.pcts.weighted || cur.credit !== d.pcts.credit || cur.simple !== d.pcts.simple) {
      h[key] = { weighted: d.pcts.weighted, credit: d.pcts.credit, simple: d.pcts.simple };
      var keys = Object.keys(h).sort();
      while (keys.length > 60) delete h[keys.shift()];
      wr(SK_RS_HIST, h);
    }
    return h;
  }
  function rsTrend(h, mode) {
    function val(k) { var e = h[k]; return e && typeof e === 'object' && isFinite(Number(e[mode])) ? Number(e[mode]) : null; }
    var keys = Object.keys(h).sort().filter(function (k) { return val(k) != null; });
    var pts = keys.slice(-30).map(function (k) { return { k: k, v: val(k) }; });
    var today = rsYmd(new Date()), cut = rsYmd(new Date(Date.now() - 7 * 864e5));
    var base = null;
    keys.forEach(function (k) { if (k <= cut) base = val(k); });
    if (base == null && keys.length && keys[0] < today) base = val(keys[0]);
    var cur = keys.length ? val(keys[keys.length - 1]) : null;
    var best = keys.reduce(function (m, k) { return Math.max(m, val(k)); }, 0);
    return { pts: pts, delta: (base != null && cur != null) ? cur - base : null, best: best, n: keys.length };
  }
  function rsCheckLevelUp(d) {
    if (!d.total) return;
    var seen = rd(SK_RS_SEEN, {});
    if (!seen || typeof seen !== 'object' || Array.isArray(seen)) seen = {};
    var prev = seen[d.mode];
    if (prev == null) { seen[d.mode] = d.level.index; wr(SK_RS_SEEN, seen); return; }
    prev = Number(prev);
    if (d.level.index > prev) { state.rsBanner = d.level.index; seen[d.mode] = d.level.index; wr(SK_RS_SEEN, seen); }
    else if (d.level.index < prev) { seen[d.mode] = d.level.index; wr(SK_RS_SEEN, seen); }
  }

  function rsSegW(i, p) { return Math.round(rsClamp((p - RS_LEVELS[i].min) / 20, 0, 1) * 100); }

  function rsRingSVG(fromPct, toPct) {
    var ticks = '';
    for (var t = 0; t < 44; t++) {
      var o = t / 44 * 2 * Math.PI - Math.PI / 2, major = t % 4 === 0, r = 72 - (major ? 6 : 3);
      ticks += '<line x1="' + (92 + Math.cos(o) * r).toFixed(2) + '" y1="' + (92 + Math.sin(o) * r).toFixed(2) +
        '" x2="' + (92 + 72 * Math.cos(o)).toFixed(2) + '" y2="' + (92 + 72 * Math.sin(o)).toFixed(2) +
        '" stroke="var(--text-primary)" stroke-opacity="' + (major ? 0.22 : 0.1) + '" stroke-width="' + (major ? 1.4 : 1) + '"/>';
    }
    return '<svg class="csu-rs-ring" width="184" height="184" viewBox="0 0 184 184" role="img" aria-label="Readiness ' + toPct + ' percent">' +
      '<defs><linearGradient id="csuRsGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="var(--secondary)"/><stop offset="55%" stop-color="var(--info)"/><stop offset="100%" stop-color="var(--success)"/></linearGradient></defs>' +
      '<g transform="rotate(-90 92 92)">' +
      '<circle cx="92" cy="92" r="80" stroke="var(--text-primary)" stroke-opacity="0.08" stroke-width="12" fill="none"/>' +
      '<circle data-rs-progress data-rs-from="' + fromPct + '" data-rs-to="' + toPct + '" cx="92" cy="92" r="80" stroke="url(#csuRsGrad)" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="' +
      RS_K.toFixed(3) + '" stroke-dashoffset="' + (RS_K * (1 - fromPct / 100)).toFixed(3) + '"/></g>' + ticks + '</svg>';
  }

  function rsSparkSVG(pts) {
    if (pts.length < 2) return '<span class="csu-rs-spark-empty">Trend appears after 2 days of activity</span>';
    var W = 132, H = 34, pad = 3;
    var lo = Math.min.apply(null, pts.map(function (p) { return p.v; })), hi = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
    var xy = pts.map(function (p, i) {
      return [pad + i * (W - 2 * pad) / (pts.length - 1), H - pad - (p.v - lo) / (hi - lo) * (H - 2 * pad)];
    });
    var line = xy.map(function (c) { return c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ');
    var area = pad + ',' + (H - pad) + ' ' + line + ' ' + (W - pad) + ',' + (H - pad);
    var last = xy[xy.length - 1];
    return '<svg class="csu-rs-spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Readiness trend, last ' + pts.length + ' days">' +
      '<polygon class="csu-rs-spark-area" points="' + area + '"/><polyline class="csu-rs-spark-line" points="' + line + '"/>' +
      '<circle class="csu-rs-spark-dot" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6"/></svg>';
  }

  function rsNextMove(d) {
    return priorityQueue(d.subs, d.prog, difficulty(), !!rd(SK_GATE, false))[0] || null;
  }

  function rsSummaryText(d) {
    var top = rsNextMove(d), g = rsGoal();
    var lines = [
      'CSE Syllabus Readiness: ' + d.pct + '% · ' + d.level.info.label,
      'Mode: ' + rsModeLabel(d.mode),
      'Completed ' + d.done + '/' + d.total + ' subjects (' + d.doneCr + '/' + d.totalCr + ' credits)'
    ];
    if (d.gap) lines.push('Next level: ' + d.gap.next.label + ' in +' + d.gap.pts + '% (~' + d.gap.subjects + ' subject' + (d.gap.subjects === 1 ? '' : 's') + ')');
    if (d.pace.rate) lines.push('Pace: ~' + (d.pace.rate * 7).toFixed(1) + ' pts/week · ' + d.pace.n7 + ' subject' + (d.pace.n7 === 1 ? '' : 's') + ' this week' + (d.pace.streak ? ' · ' + d.pace.streak + '-day streak' : ''));
    if (g) lines.push('Goal: ' + RS_LEVELS[g.level].label + (g.date ? ' by ' + g.date : ''));
    if (d.weakest) lines.push('Weakest: ' + semLabel(d.weakest.sem) + ' (' + d.weakest.pct + '%)');
    if (d.due) lines.push('Revisions due: ' + d.due);
    if (d.pcTotal) lines.push('Placement-critical done: ' + d.pcDone + '/' + d.pcTotal + (d.pcPct != null ? ' (' + d.pcPct + '%)' : ''));
    if (top) lines.push('Next best move: ' + top.s.name + ' (' + semLabel(top.s.sem) + ')');
    return lines.join('\n');
  }

  function rsGoalHTML(d) {
    var g = rsGoal(), p = d.pace, rem100 = Math.max(0, 100 - d.raw);
    var etaNext = d.gap ? rsEta(Math.max(0, d.gap.next.min - d.raw), p.rate) : { done: true };
    var etaTop = rsEta(Math.max(0, RS_LEVELS[4].min - d.raw), p.rate);
    var paceLine = p.rate
      ? '~' + (p.rate * 7).toFixed(1) + ' pts/week · ' + p.n + ' subject' + (p.n === 1 ? '' : 's') + ' in the last 14 days'
      : 'Mark 2+ subjects done within 14 days to unlock pace &amp; ETAs';
    var rows = '<div class="csu-rs-kv"><span>Your pace</span><strong>' + paceLine + '</strong></div>';
    if (d.gap) rows += '<div class="csu-rs-kv"><span>' + d.gap.next.icon + ' ' + esc(d.gap.next.label) + '</span><strong>' + esc(rsEtaText(etaNext)) + '</strong></div>';
    if (d.level.index < 4 && !(d.gap && d.gap.next.key === 'jobready')) rows += '<div class="csu-rs-kv"><span>🚀 Job Ready</span><strong>' + esc(rsEtaText(etaTop)) + '</strong></div>';

    var opts = RS_LEVELS.slice(1).map(function (lv, i) {
      return '<option value="' + (i + 1) + '"' + (g && g.level === i + 1 ? ' selected' : '') + '>' + lv.icon + ' ' + lv.label + ' (' + lv.min + '%+)</option>';
    }).join('');
    var today = rsYmd(new Date());
    var form = '<div class="csu-rs-goalform"><label class="csu-rs-lbl">Goal <select class="csu-rs-input" id="csu-rs-goal-level" aria-label="Target level"><option value="">None</option>' + opts + '</select></label>' +
      '<label class="csu-rs-lbl">By <input type="date" class="csu-rs-input" id="csu-rs-goal-date" min="' + today + '" value="' + esc(g ? g.date : '') + '" aria-label="Target date"' + (g ? '' : ' disabled') + '></label>' +
      (g ? '<button type="button" class="csu-rs-act csu-rs-act-sm" data-rs-goal-clear>Clear</button>' : '') + '</div>';

    var status = '';
    if (g) {
      var lv = RS_LEVELS[g.level], remPts = Math.max(0, lv.min - d.raw), tone = 'flat', txt;
      if (d.pct >= lv.min) { tone = 'up'; txt = '✅ Goal reached — ' + lv.icon + ' ' + lv.label; }
      else if (g.date) {
        var ms = new Date(g.date + 'T23:59:59').getTime() - Date.now(), days = Math.ceil(ms / 864e5);
        if (!isFinite(days) || days <= 0) { tone = 'down'; txt = '⏰ Target date passed — ' + Math.ceil(remPts) + '% still to go. Pick a new date.'; }
        else {
          var need = remPts / (days / 7), per = d.avgPending > 0 ? Math.max(1, Math.ceil(need / d.avgPending)) : null;
          var need1 = need.toFixed(1) + ' pts/week' + (per ? ' (≈' + per + ' subject' + (per === 1 ? '' : 's') + '/week)' : '');
          if (p.rate == null) { txt = 'Need ' + need1 + ' to hit ' + lv.label + ' in ' + days + 'd. Log completions to see if you are on track.'; }
          else if (p.rate * 7 >= need) { tone = 'up'; txt = '🟢 On track — need ' + need1 + '; you are at ' + (p.rate * 7).toFixed(1) + '.'; }
          else { tone = 'down'; txt = '🔴 Behind — need ' + need1 + '; you are at ' + (p.rate * 7).toFixed(1) + '.'; }
        }
      } else { txt = 'At your pace: ' + rsEtaText(rsEta(remPts, p.rate)) + '. Add a date to get a weekly target.'; }
      status = '<div class="csu-rs-goalstatus" data-tone="' + tone + '" role="status">' + txt + '</div>';
    } else if (rem100 > 0) {
      status = '<div class="csu-rs-goalstatus" data-tone="flat">Pick a target level and date to get a weekly target.</div>';
    }
    return '<div class="csu-rs-block csu-rs-goal"><div class="csu-rs-blockhead"><span>Goal &amp; pace</span><span class="csu-rs-hint">from your completion dates</span></div>' + rows + form + status + '</div>';
  }

  function rsBreakdownHTML(d) {
    function bar(label, pct, done, total, color, title) {
      return '<div class="csu-rs-bar" title="' + esc(title) + '"><span class="csu-rs-barlbl">' + label + '</span>' +
        '<span class="csu-rs-bartrack"><span class="csu-rs-barfill" style="width:' + (pct == null ? 0 : pct) + '%;background:' + color + '"></span></span>' +
        '<span class="csu-rs-barval">' + (pct == null ? '—' : pct + '%') + '<small>' + done + '/' + total + '</small></span></div>';
    }
    var colors = { Core: 'var(--info)', Lab: 'var(--warning)', Elective: 'var(--secondary)', Project: 'var(--success)' };
    var rows = d.byType.map(function (t) { return bar(t.type, t.pct, t.done, t.total, colors[t.type] || 'var(--primary)', t.type + ' subjects · ' + t.done + '/' + t.total + ' done'); }).join('');
    if (d.pcTotal) rows += bar('🎯 Placement-critical', d.pcPct, d.pcDone, d.pcTotal, 'var(--danger)', 'DSA / OS / DBMS / CN / OOP / DAA — the subjects interviewers ask about');
    return '<div class="csu-rs-block"><div class="csu-rs-blockhead"><span>Breakdown by type</span><span class="csu-rs-hint">' + esc(rsModeLabel(d.mode)) + ' scoring</span></div><div class="csu-rs-bars">' + rows + '</div></div>';
  }

  function rsHowHTML(d) {
    var f = d.mode === 'weighted'
      ? 'Each subject’s weight = credits × your difficulty rating (1–5, unrated = 3).'
      : d.mode === 'credit' ? 'Each subject’s weight = its credits.' : 'Every subject has weight 1.';
    var earned = d.mode === 'simple' ? d.done + ' of ' + d.total + ' subjects' : (Math.round(d.gotW * 10) / 10) + ' of ' + (Math.round(d.totalW * 10) / 10) + ' weight points';
    return '<div class="csu-rs-how" role="note"><strong>How this score works</strong><ul>' +
      '<li>' + f + '</li>' +
      '<li>A subject ticked done earns its full weight' + (d.mode === 'simple' ? '.' : '; a pending one earns partial credit for the units you have covered (never a full 100% until you tick it).') + '</li>' +
      '<li>You have <strong>' + earned + '</strong> → <strong>' + d.pct + '%</strong>.</li>' +
      '<li>Levels: Beginner 0–19 · Intermediate 20–39 · Advanced 40–59 · Expert 60–79 · Job Ready 80+.</li>' +
      '<li>Pace uses the dates you ticked subjects done in the last 14 days. Switch mode above to compare; each mode keeps its own trend.</li></ul></div>';
  }

  function rsHTML() {
    var d = rsCompute();
    if (!d.total) return '';
    rsCheckLevelUp(d);
    var hist = rsRecord(d), tr = rsTrend(hist, d.mode);
    var from = rsLast.pct, to = d.pct, L = d.level.info;
    var open = rd(SK_RS_OPEN, true) !== false;

    var banner = '';
    if (state.rsBanner != null && RS_LEVELS[state.rsBanner]) {
      var bl = RS_LEVELS[state.rsBanner];
      banner = '<div class="csu-rs-banner" role="status" style="--csu-rs-c:' + bl.color + '"><span>🎉 Level up! You reached <strong>' + bl.icon + ' ' + esc(bl.label) + '</strong></span>' +
        '<button type="button" class="csu-rs-x" data-rs-dismiss aria-label="Dismiss">✕</button></div>';
    }

    var modeBtns = RS_MODES.map(function (m) {
      return '<button type="button" class="csu-rs-mode" data-rs-mode="' + m.key + '" data-active="' + (d.mode === m.key ? '1' : '0') + '" title="' + esc(m.tip) + '" aria-pressed="' + (d.mode === m.key ? 'true' : 'false') + '">' + m.label + '</button>';
    }).join('');

    var subtitle = d.mode === 'weighted'
      ? 'Difficulty-weighted progress across your CSE syllabus — every subject counts by credits × your self-rated difficulty, with partial credit for units already covered.'
      : d.mode === 'credit'
        ? 'Credit-weighted progress across your CSE syllabus — heavier-credit subjects count more, with partial credit for units already covered.'
        : 'Plain completion across your CSE syllabus — every subject counts equally toward your score.';

    var pills = RS_LEVELS.map(function (lv, i) {
      var st = i === d.level.index ? 'current' : (i < d.level.index ? 'passed' : 'locked');
      return '<button type="button" class="csu-rs-pill" data-rs-pill="' + i + '" data-state="' + st + '" aria-pressed="' + (state.rsPill === i ? 'true' : 'false') + '" style="--csu-rs-c:' + lv.color + '">' +
        '<span aria-hidden="true">' + (st === 'passed' ? '✓' : lv.icon) + '</span><span>' + lv.label + '</span></button>' +
        (i < RS_LEVELS.length - 1 ? '<span class="csu-rs-arrow" aria-hidden="true">›</span>' : '');
    }).join('');

    var pillDetail = '';
    if (state.rsPill != null && RS_LEVELS[state.rsPill]) {
      var pl = RS_LEVELS[state.rsPill], pi = state.rsPill, msg;
      if (pi < d.level.index) msg = '✓ Passed — you cleared the ' + pl.min + '–' + pl.max + '% band.';
      else if (pi === d.level.index) msg = 'You are here: ' + d.pct + '% (band ' + pl.min + '–' + pl.max + '%).' + (d.gap ? ' ' + d.gap.pts + '% more to ' + d.gap.next.label + '.' : ' Top level reached.');
      else msg = 'Unlocks at ' + pl.min + '% — you are ' + Math.max(1, pl.min - d.pct) + '% away.';
      pillDetail = '<div class="csu-rs-pilldetail" role="status">' + pl.icon + ' <strong>' + esc(pl.label) + '</strong> · ' + esc(msg) + '</div>';
    }

    var segs = RS_LEVELS.map(function (lv, i) {
      return '<div class="csu-rs-seg" title="' + esc(lv.label + ' · ' + lv.min + '–' + lv.max + '%') + '"><div class="csu-rs-segfill" data-rs-seg="' + i + '" data-rs-w="' + rsSegW(i, to) + '" style="background:' + lv.color + ';color:' + lv.color + ';width:' + rsSegW(i, from) + '%"></div></div>';
    }).join('');
    var segLabels = RS_LEVELS.map(function (lv) { return '<span>' + lv.label + '</span>'; }).join('');

    var nextLine = d.gap
      ? '+' + d.gap.pts + '% to ' + d.gap.next.icon + ' ' + esc(d.gap.next.label) + ' · ≈' + d.gap.subjects + ' subject' + (d.gap.subjects === 1 ? '' : 's')
      : '🏆 Top level reached';

    var focus = d.weakest
      ? '<button type="button" class="csu-rs-focus" data-rs-sem="' + esc(d.weakest.sem) + '" title="Open the weakest semester in the Subjects tab">🎯 Focus: ' + esc(semLabel(d.weakest.sem)) + ' · ' + d.weakest.pct + '%</button>' : '';

    var stats = [
      { v: d.done, l: 'Completed', c: 'var(--secondary)', go: 'Done', sub: d.pace.n7 ? '+' + d.pace.n7 + ' this week' : '' },
      { v: d.remaining, l: 'Remaining', c: 'var(--warning)', go: 'Pending', sub: d.partial ? d.partial + ' in progress' : '' },
      { v: d.flagged, l: 'Revision', c: 'var(--info)', go: 'Revision', sub: d.due ? d.due + ' due now' : '' },
      { v: d.simplePct + '%', l: 'Completion', c: 'var(--success)', go: 'overview', sub: d.doneCr + '/' + d.totalCr + ' credits' }
    ].map(function (s) {
      return '<button type="button" class="csu-rs-stat" data-rs-go="' + s.go + '" style="--csu-rs-sc:' + s.c + '"><span class="csu-rs-statv">' + s.v + '</span><span class="csu-rs-statl">' + s.l + '</span>' +
        (s.sub ? '<span class="csu-rs-stats-sub">' + esc(s.sub) + '</span>' : '') + '</button>';
    }).join('');

    var details = '';
    if (open) {
      var top = rsNextMove(d);
      var semChips = d.semRows.map(function (r) {
        var rl = rsLevel(r.pct).info;
        return '<button type="button" class="csu-rs-semchip" data-rs-sem="' + esc(r.sem) + '" style="--csu-rs-c:' + rl.color + '" title="' + esc(semLabel(r.sem) + ' · ' + r.done + '/' + r.total + ' subjects · ' + r.pct + '%') + '">' +
          '<span class="csu-rs-semtop"><span>Sem ' + esc(r.sem) + '</span><span class="csu-rs-sempct">' + r.pct + '%</span></span>' +
          '<span class="csu-rs-semname">' + esc(String(semLabel(r.sem)).replace(/^Semester\s*\d+\s*[—–-]\s*/i, '')) + '</span>' +
          '<span class="csu-rs-semtrack"><span class="csu-rs-semfill" style="width:' + r.pct + '%"></span></span></button>';
      }).join('');

      var deltaTxt = tr.delta == null ? 'Not enough history yet' :
        (tr.delta > 0 ? '▲ +' + tr.delta + ' pts' : tr.delta < 0 ? '▼ ' + tr.delta + ' pts' : '● no change') + ' vs 7 days ago';
      var deltaTone = tr.delta == null ? 'flat' : tr.delta > 0 ? 'up' : tr.delta < 0 ? 'down' : 'flat';

      var chips = [];
      if (d.pace.streak) chips.push('<span class="csu-rs-chip" data-tone="warn" title="Consecutive days with at least one subject marked done">🔥 ' + d.pace.streak + '-day streak</span>');
      if (d.due) chips.push('<button type="button" class="csu-rs-chip" data-tone="warn" data-rs-go="revision-tab">🔄 ' + d.due + ' revision' + (d.due === 1 ? '' : 's') + ' due</button>');
      if (d.risk) chips.push('<button type="button" class="csu-rs-chip" data-tone="danger" data-rs-go="BacklogRisk">⚠️ ' + d.risk + ' backlog risk</button>');
      if (d.pcTotal) chips.push('<span class="csu-rs-chip" data-tone="info" title="Placement-critical subjects (DSA / OS / DBMS / CN / OOP / DAA)">🎯 ' + d.pcDone + '/' + d.pcTotal + ' placement-critical done</span>');
      if (d.partial) chips.push('<span class="csu-rs-chip" data-tone="ok" title="Not ticked done, but some units covered — counted as partial credit">📚 ' + d.partial + ' in progress</span>');

      details = '<div class="csu-rs-details">' +
        '<div class="csu-rs-block"><div class="csu-rs-blockhead"><span>Readiness by semester</span><span class="csu-rs-hint">weakest highlighted · click to open</span></div><div class="csu-rs-semgrid">' + semChips + '</div></div>' +
        '<div class="csu-rs-row2">' +
          '<div class="csu-rs-block csu-rs-trend"><div class="csu-rs-blockhead"><span>30-day trend</span><span class="csu-rs-hint">' + esc(rsModeLabel(d.mode)) + ' · best ' + tr.best + '%</span></div>' +
            '<div class="csu-rs-trendbody">' + rsSparkSVG(tr.pts) + (tr.pts.length < 2 ? '' : '<span class="csu-rs-delta" data-tone="' + deltaTone + '">' + deltaTxt + '</span>') + '</div></div>' +
          '<div class="csu-rs-block csu-rs-next"><div class="csu-rs-blockhead"><span>Next best move</span><span class="csu-rs-hint">from Priority queue</span></div>' +
            (top ? '<button type="button" class="csu-rs-move" data-rs-move="' + esc(top.s.id) + '"><span class="csu-rs-movename">' + esc(top.s.name) + '</span><span class="csu-rs-movemeta">' + esc(semLabel(top.s.sem)) + ' · ' + esc(top.s.credits) + 'cr · difficulty ' + top.diff + '/5' + (top.pc ? ' · 🎯 placement-critical' : '') + '</span></button>'
              : '<span class="csu-rs-spark-empty">Every subject is done — nothing pending 🎉</span>') + '</div>' +
        '</div>' +
        '<div class="csu-rs-row2">' + rsGoalHTML(d) + rsBreakdownHTML(d) + '</div>' +
        (chips.length ? '<div class="csu-rs-chips">' + chips.join('') + '</div>' : '') +
        (state.rsHow ? rsHowHTML(d) : '') +
        '</div>';
    }

    return '<section class="csu-rs" aria-label="Readiness score">' +
      '<div class="csu-rs-glow-a" aria-hidden="true"></div><div class="csu-rs-glow-b" aria-hidden="true"></div>' + banner +
      '<div class="csu-rs-eyebrow"><span class="csu-rs-dot"></span>Readiness Score</div>' +
      '<div class="csu-rs-top">' +
        '<div class="csu-rs-ringwrap">' + rsRingSVG(from, to) +
          '<div class="csu-rs-center"><div><span class="csu-rs-pct" data-rs-count data-rs-from="' + from + '" data-rs-to="' + to + '">' + from + '</span><span class="csu-rs-pctsign">%</span></div>' +
          '<span class="csu-rs-chipl" style="--csu-rs-c:' + L.color + '"><span aria-hidden="true">' + L.icon + '</span>' + esc(L.label) + '</span>' +
          '<div class="csu-rs-nextline">' + nextLine + '</div></div></div>' +
        '<div class="csu-rs-info">' +
          '<div class="csu-rs-titlerow"><h3 class="csu-rs-title">CSE Syllabus Mastery</h3>' + focus +
            '<div class="csu-rs-modes" role="group" aria-label="Score mode">' + modeBtns + '</div></div>' +
          '<p class="csu-rs-sub">' + subtitle + '</p>' +
          '<div class="csu-rs-levels">' + pills + '</div>' + pillDetail +
          '<div class="csu-rs-miles"><div class="csu-rs-track">' + segs + '</div><div class="csu-rs-labels">' + segLabels + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="csu-rs-stats">' + stats + '</div>' +
      '<div class="csu-rs-actions">' +
        '<button type="button" class="csu-rs-act" data-rs-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾ Hide details' : '▸ Show details') + '</button>' +
        (open ? '<button type="button" class="csu-rs-act" data-rs-how aria-pressed="' + (state.rsHow ? 'true' : 'false') + '">ⓘ How it’s scored</button>' : '') +
        '<button type="button" class="csu-rs-act" data-rs-copy title="Copy a plain-text readiness summary">📋 Copy summary</button>' +
        '<button type="button" class="csu-rs-act" data-rs-go="priority-tab">🎯 Priority queue →</button>' +
      '</div>' + details +
    '</section>';
  }

  function rsAnimate() {
    if (!root) return;
    var ring = root.querySelector('[data-rs-progress]'), cnt = root.querySelector('[data-rs-count]');
    if (!ring || !cnt) return;
    var from = Number(ring.getAttribute('data-rs-from')) || 0, to = Number(ring.getAttribute('data-rs-to')) || 0;
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    var raf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };
    function settle() {
      ring.setAttribute('stroke-dashoffset', (RS_K * (1 - to / 100)).toFixed(3));
      cnt.textContent = String(to);
      root.querySelectorAll('[data-rs-seg]').forEach(function (el) { el.style.width = el.getAttribute('data-rs-w') + '%'; });
      rsLast.pct = to;
    }
    if (reduce || from === to) { settle(); return; }
    raf(function () {
      ring.setAttribute('stroke-dashoffset', (RS_K * (1 - to / 100)).toFixed(3));
      root.querySelectorAll('[data-rs-seg]').forEach(function (el) { el.style.width = el.getAttribute('data-rs-w') + '%'; });
    });
    var t0 = Date.now(), dur = 700;
    (function tick() {
      if (!document.body.contains(cnt)) return;
      var p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      cnt.textContent = String(Math.round(from + (to - from) * e));
      if (p < 1) raf(tick); else { cnt.textContent = String(to); }
    })();
    rsLast.pct = to;
  }

  function rsGo(target) {
    if (target === 'revision-tab' || target === 'priority-tab' || target === 'overview') {
      state.tab = target === 'revision-tab' ? 'revision' : target === 'priority-tab' ? 'priority' : 'overview';
    } else {
      state.tab = 'subjects'; state.status = target; state.sem = 'All'; state.type = 'All'; state.search = '';
    }
    wr(SK_TABS, state.tab); render();
    var tabs = root && root.querySelector('.csu-tabs');
    if (tabs && tabs.scrollIntoView) { try { tabs.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
  }

  function rsWire() {
    if (!root) return;
    function each(sel, fn) { root.querySelectorAll('.csu-rs ' + sel).forEach(fn); }
    each('[data-rs-mode]', function (b) { b.addEventListener('click', function () { wr(SK_RS_MODE, b.getAttribute('data-rs-mode')); render(); }); });
    each('[data-rs-pill]', function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-rs-pill'));
        state.rsPill = state.rsPill === i ? null : i; render();
      });
    });
    each('[data-rs-toggle]', function (b) { b.addEventListener('click', function () { wr(SK_RS_OPEN, rd(SK_RS_OPEN, true) === false); render(); }); });
    each('[data-rs-how]', function (b) { b.addEventListener('click', function () { state.rsHow = !state.rsHow; render(); }); });
    each('[data-rs-sem]', function (b) {
      b.addEventListener('click', function () {
        state.tab = 'subjects'; wr(SK_TABS, state.tab);
        state.sem = b.getAttribute('data-rs-sem'); state.status = 'All'; state.type = 'All'; state.search = '';
        render();
        var tabs = root.querySelector('.csu-tabs');
        if (tabs && tabs.scrollIntoView) { try { tabs.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
      });
    });
    each('[data-rs-move]', function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-rs-move');
        state.tab = 'subjects'; wr(SK_TABS, state.tab);
        state.search = ''; state.sem = 'All'; state.type = 'All'; state.status = 'All'; state.openId = id;
        render();
        var row = root.querySelector('[data-toggle-id="' + id + '"]');
        if (row && row.scrollIntoView) { try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
      });
    });
    each('[data-rs-go]', function (b) { b.addEventListener('click', function () { rsGo(b.getAttribute('data-rs-go')); }); });
    each('[data-rs-dismiss]', function (b) {
      b.addEventListener('click', function () {
        clearTimeout(state.rsBannerT); state.rsBanner = null;
        var el = b.closest('.csu-rs-banner'); if (el && el.parentNode) el.parentNode.removeChild(el);
        rsPrevHTML = '';
      });
    });
    each('[data-rs-copy]', function (b) {
      b.addEventListener('click', function () {
        var txt = rsSummaryText(rsCompute()), label = b.textContent;
        copyText(txt).then(function (ok) {
          b.textContent = ok ? '✅ Copied!' : '⚠️ Copy blocked';
          setTimeout(function () { if (document.body.contains(b)) b.textContent = label; }, 1400);
        });
      });
    });
    /* goal: target level + optional date */
    var gl = root.querySelector('#csu-rs-goal-level'), gd = root.querySelector('#csu-rs-goal-date');
    if (gl) gl.addEventListener('change', function () {
      var lv = Number(gl.value);
      if (!(lv >= 1 && lv <= 4)) { try { localStorage.removeItem(SK_RS_GOAL); } catch (e) {} }
      else { var cur = rsGoal(); wr(SK_RS_GOAL, { level: lv, date: cur ? cur.date : '' }); }
      render();
    });
    if (gd) gd.addEventListener('change', function () {
      var cur = rsGoal(); if (!cur) return;
      var v = gd.value, today = rsYmd(new Date());
      wr(SK_RS_GOAL, { level: cur.level, date: /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today ? v : '' });
      render();
    });
    each('[data-rs-goal-clear]', function (b) { b.addEventListener('click', function () { try { localStorage.removeItem(SK_RS_GOAL); } catch (e) {} render(); }); });
    /* auto-dismiss level-up banner */
    if (root.querySelector('.csu-rs-banner')) {
      clearTimeout(state.rsBannerT);
      state.rsBannerT = setTimeout(function () {
        state.rsBanner = null; rsPrevHTML = '';
        var cur = root && root.querySelector('.csu-rs-banner');
        if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
      }, 9000);
    }
  }

  function rsInjectStyle() {
    if (document.getElementById(RS_STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = RS_STYLE_ID;
    el.textContent = `
      .csu-rs { position: relative; overflow: hidden; padding: 1.25rem 1.4rem 1.1rem;
        background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 6%, var(--surface)) 0%, var(--surface) 70%);
        border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent); }
      .csu-rs > * { position: relative; z-index: 1; }
      .csu-rs > .csu-rs-glow-a, .csu-rs > .csu-rs-glow-b { position: absolute; z-index: 0; border-radius: 50%; pointer-events: none; }
      .csu-rs-glow-a { top: -70px; left: -50px; width: 240px; height: 240px;
        background: radial-gradient(circle, color-mix(in srgb, var(--secondary) 16%, transparent) 0%, transparent 70%); animation: csu-rs-pulse 6s ease-in-out infinite; }
      .csu-rs-glow-b { bottom: -80px; right: -60px; width: 280px; height: 280px;
        background: radial-gradient(circle, color-mix(in srgb, var(--info) 13%, transparent) 0%, transparent 70%); animation: csu-rs-pulse 7s ease-in-out infinite reverse; }
      @keyframes csu-rs-pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
      @keyframes csu-rs-blink { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
      @keyframes csu-rs-pop { from { transform: translateY(-6px) scale(.98); opacity: 0 } to { transform: none; opacity: 1 } }

      .csu-rs-banner { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .9rem;
        padding: .55rem .8rem; border-radius: .75rem; font-size: .8rem; color: var(--text-primary);
        background: color-mix(in srgb, var(--csu-rs-c, var(--success)) 16%, var(--surface));
        border: 1px solid color-mix(in srgb, var(--csu-rs-c, var(--success)) 45%, transparent); animation: csu-rs-pop .35s ease; }
      .csu-rs-x { background: none; border: 0; color: var(--text-secondary); cursor: pointer; font-size: .85rem; padding: .1rem .3rem; border-radius: .4rem; }
      .csu-rs-x:hover { color: var(--text-primary); background: color-mix(in srgb, var(--text-primary) 10%, transparent); }

      .csu-rs-eyebrow { display: flex; align-items: center; gap: .5rem; font-size: .68rem; font-weight: 700; letter-spacing: .14em;
        text-transform: uppercase; color: var(--accent, var(--secondary)); margin-bottom: 1rem; }
      .csu-rs-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 8px var(--success); animation: csu-rs-blink 2.2s ease-in-out infinite; }

      .csu-rs-top { display: flex; flex-wrap: wrap; align-items: center; gap: 1.75rem; }
      .csu-rs-ringwrap { position: relative; width: 184px; height: 184px; flex-shrink: 0; margin: 0 auto; }
      .csu-rs-ring { display: block; filter: drop-shadow(0 0 10px color-mix(in srgb, var(--secondary) 25%, transparent)); }
      .csu-rs-ring circle[data-rs-progress] { transition: stroke-dashoffset 1.4s cubic-bezier(.34,1.56,.64,1); }
      .csu-rs-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 2px; }
      .csu-rs-pct { font-family: var(--font-display, inherit); font-weight: 800; font-size: 2.1rem; line-height: 1; color: var(--text-primary);
        text-shadow: 0 0 18px color-mix(in srgb, var(--secondary) 30%, transparent); font-variant-numeric: tabular-nums; }
      .csu-rs-pctsign { font-size: 1.1rem; opacity: .55; font-weight: 700; color: var(--text-primary); }
      .csu-rs-chipl { display: inline-flex; align-items: center; gap: .3rem; font-size: .66rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
        padding: .2rem .55rem; border-radius: 999px; margin-top: .35rem; color: var(--text-primary);
        background: color-mix(in srgb, var(--csu-rs-c) 18%, var(--surface));
        border: 1px solid color-mix(in srgb, var(--csu-rs-c) 45%, transparent); }
      .csu-rs-nextline { font-size: .6rem; color: var(--text-secondary); margin-top: .3rem; max-width: 118px; line-height: 1.3;
        font-family: 'JetBrains Mono', ui-monospace, monospace; }

      .csu-rs-info { flex: 1; min-width: 230px; display: flex; flex-direction: column; gap: .9rem; }
      .csu-rs-titlerow { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; }
      .csu-rs-title { font-family: var(--font-display, inherit); font-weight: 800; font-size: 1.3rem; color: var(--text-primary); margin: 0; }
      .csu-rs-focus { font-size: .64rem; font-weight: 700; padding: .22rem .6rem; border-radius: 999px; cursor: pointer; white-space: nowrap;
        background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger);
        border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); transition: transform .2s ease; }
      .csu-rs-focus:hover { transform: translateY(-1px); }
      .csu-rs-modes { display: inline-flex; margin-left: auto; padding: 2px; border-radius: 999px;
        background: color-mix(in srgb, var(--text-primary) 6%, transparent); border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent); }
      .csu-rs-mode { border: 0; background: transparent; cursor: pointer; font-size: .64rem; font-weight: 700; letter-spacing: .03em;
        padding: .25rem .65rem; border-radius: 999px; color: var(--text-secondary); transition: background .2s, color .2s; }
      .csu-rs-mode:hover { color: var(--text-primary); }
      .csu-rs-mode[data-active="1"] { background: var(--primary); color: var(--primary-contrast, #fff); }
      .csu-rs-sub { font-size: .78rem; color: var(--text-secondary); line-height: 1.5; margin: 0; }

      .csu-rs-levels { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; }
      .csu-rs-arrow { font-size: .8rem; color: var(--text-tertiary); }
      .csu-rs-pill { display: inline-flex; align-items: center; gap: .3rem; padding: .32rem .65rem; border-radius: 999px; cursor: pointer; white-space: nowrap;
        font-size: .66rem; font-weight: 700; color: var(--text-secondary);
        background: color-mix(in srgb, var(--text-primary) 4%, transparent);
        border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent); transition: all .3s ease; }
      .csu-rs-pill:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--csu-rs-c) 60%, transparent); }
      .csu-rs-pill[data-state="passed"] { color: var(--text-primary); border-color: color-mix(in srgb, var(--csu-rs-c) 45%, transparent); }
      .csu-rs-pill[data-state="current"] { color: var(--text-primary);
        background: color-mix(in srgb, var(--csu-rs-c) 24%, var(--surface));
        border-color: color-mix(in srgb, var(--csu-rs-c) 70%, transparent);
        box-shadow: 0 2px 12px color-mix(in srgb, var(--csu-rs-c) 30%, transparent); }
      .csu-rs-pill[aria-pressed="true"] { outline: 2px solid color-mix(in srgb, var(--csu-rs-c) 60%, transparent); outline-offset: 1px; }
      .csu-rs-pilldetail { font-size: .72rem; color: var(--text-secondary); padding: .45rem .7rem; border-radius: .7rem; animation: csu-rs-pop .25s ease;
        background: color-mix(in srgb, var(--text-primary) 5%, transparent); border: 1px dashed color-mix(in srgb, var(--text-primary) 16%, transparent); }
      .csu-rs-pilldetail strong { color: var(--text-primary); }

      .csu-rs-track, .csu-rs-labels { display: flex; gap: 5px; }
      .csu-rs-seg { position: relative; flex: 1; height: 9px; border-radius: 999px; overflow: hidden;
        background: color-mix(in srgb, var(--text-primary) 8%, transparent); }
      .csu-rs-segfill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; transition: width 1.2s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 0 10px color-mix(in srgb, currentColor 55%, transparent); }
      .csu-rs-labels { margin-top: .35rem; }
      .csu-rs-labels span { flex: 1; text-align: center; font-size: .6rem; letter-spacing: .02em; color: var(--text-tertiary);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .csu-rs-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .7rem; margin-top: 1.1rem; }
      @media (min-width: 640px) { .csu-rs-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      .csu-rs-stat { position: relative; text-align: left; cursor: pointer; padding: .85rem .9rem; border-radius: 1rem; overflow: hidden;
        display: flex; flex-direction: column; gap: .1rem; font: inherit; color: inherit;
        background: color-mix(in srgb, var(--text-primary) 4%, var(--surface));
        border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent);
        transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
      .csu-rs-stat::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; opacity: .9;
        background: linear-gradient(90deg, transparent, var(--csu-rs-sc, var(--secondary)), transparent); }
      .csu-rs-stat:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--csu-rs-sc) 50%, transparent);
        box-shadow: 0 6px 18px color-mix(in srgb, var(--csu-rs-sc) 16%, transparent); }
      .csu-rs-statv { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 700; font-size: 1.35rem; color: var(--text-primary); }
      .csu-rs-statl { font-size: .66rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .06em; }
      .csu-rs-stats-sub { font-size: .6rem; color: var(--text-tertiary); margin-top: .1rem; }

      .csu-rs-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .9rem; }
      .csu-rs-act { font-size: .68rem; font-weight: 700; padding: .35rem .8rem; border-radius: 999px; cursor: pointer; color: var(--text-secondary);
        background: transparent; border: 1px solid color-mix(in srgb, var(--text-primary) 14%, transparent); transition: all .2s ease; }
      .csu-rs-act:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--primary) 55%, transparent); background: color-mix(in srgb, var(--primary) 8%, transparent); }

      .csu-rs-details { margin-top: 1rem; padding-top: 1rem; display: flex; flex-direction: column; gap: .9rem;
        border-top: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent); animation: csu-rs-pop .3s ease; }
      .csu-rs-block { min-width: 0; }
      .csu-rs-blockhead { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; flex-wrap: wrap; margin-bottom: .5rem;
        font-size: .72rem; font-weight: 800; color: var(--text-primary); letter-spacing: .02em; }
      .csu-rs-hint { font-size: .6rem; font-weight: 600; color: var(--text-tertiary); }
      .csu-rs-semgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: .5rem; }
      .csu-rs-semchip { text-align: left; cursor: pointer; padding: .5rem .6rem; border-radius: .8rem; font: inherit; color: inherit;
        background: color-mix(in srgb, var(--text-primary) 4%, var(--surface));
        border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent); transition: transform .2s ease, border-color .2s ease; }
      .csu-rs-semchip:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--csu-rs-c) 60%, transparent); }
      .csu-rs-semtop { display: flex; justify-content: space-between; gap: .4rem; font-size: .66rem; font-weight: 700; color: var(--text-secondary); }
      .csu-rs-sempct { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-primary); }
      .csu-rs-semname { display: block; margin-top: .1rem; font-size: .58rem; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .csu-rs-semtrack { display: block; height: 5px; margin-top: .4rem; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--text-primary) 9%, transparent); }
      .csu-rs-semfill { display: block; height: 100%; border-radius: 999px; background: var(--csu-rs-c); transition: width .8s ease; }

      .csu-rs-row2 { display: grid; grid-template-columns: 1fr; gap: .9rem; }
      @media (min-width: 720px) { .csu-rs-row2 { grid-template-columns: 1fr 1fr; } }
      .csu-rs-row2 > .csu-rs-block { padding: .75rem .85rem; border-radius: .9rem;
        background: color-mix(in srgb, var(--text-primary) 4%, var(--surface)); border: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent); }
      .csu-rs-trendbody { display: flex; align-items: center; flex-wrap: wrap; gap: .7rem; }
      .csu-rs-spark { max-width: 100%; overflow: visible; }
      .csu-rs-spark-line { fill: none; stroke: var(--primary); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
      .csu-rs-spark-area { fill: color-mix(in srgb, var(--primary) 14%, transparent); stroke: none; }
      .csu-rs-spark-dot { fill: var(--primary); }
      .csu-rs-spark-empty { font-size: .68rem; color: var(--text-tertiary); }
      .csu-rs-delta { font-size: .7rem; font-weight: 700; color: var(--text-secondary); }
      .csu-rs-delta[data-tone="up"] { color: var(--success); }
      .csu-rs-delta[data-tone="down"] { color: var(--danger); }
      .csu-rs-move { display: flex; flex-direction: column; gap: .15rem; width: 100%; text-align: left; cursor: pointer; padding: .55rem .7rem; border-radius: .7rem; font: inherit; color: inherit;
        background: color-mix(in srgb, var(--primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 28%, transparent); transition: transform .2s ease, border-color .2s ease; }
      .csu-rs-move:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--primary) 60%, transparent); }
      .csu-rs-movename { font-size: .8rem; font-weight: 700; color: var(--text-primary); }
      .csu-rs-movemeta { font-size: .64rem; color: var(--text-secondary); }

      .csu-rs-chips { display: flex; flex-wrap: wrap; gap: .45rem; }
      .csu-rs-chip { font: inherit; font-size: .66rem; font-weight: 700; padding: .28rem .65rem; border-radius: 999px; color: var(--text-primary);
        background: color-mix(in srgb, var(--csu-rs-ct, var(--info)) 12%, transparent); border: 1px solid color-mix(in srgb, var(--csu-rs-ct, var(--info)) 38%, transparent); }
      button.csu-rs-chip { cursor: pointer; }
      .csu-rs-chip[data-tone="warn"]   { --csu-rs-ct: var(--warning); }
      .csu-rs-chip[data-tone="danger"] { --csu-rs-ct: var(--danger); }
      .csu-rs-chip[data-tone="info"]   { --csu-rs-ct: var(--info); }
      .csu-rs-chip[data-tone="ok"]     { --csu-rs-ct: var(--success); }

      .csu-rs-kv { display: flex; justify-content: space-between; align-items: baseline; gap: .6rem; padding: .28rem 0; font-size: .7rem; color: var(--text-secondary);
        border-bottom: 1px dashed color-mix(in srgb, var(--text-primary) 10%, transparent); }
      .csu-rs-kv strong { color: var(--text-primary); font-weight: 700; text-align: right; font-size: .7rem; }
      .csu-rs-goalform { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: .6rem; }
      .csu-rs-lbl { display: inline-flex; align-items: center; gap: .35rem; font-size: .66rem; font-weight: 700; color: var(--text-secondary); }
      .csu-rs-input { font: inherit; font-size: .7rem; padding: .25rem .45rem; border-radius: .55rem; color: var(--text-primary); color-scheme: inherit;
        background: color-mix(in srgb, var(--text-primary) 5%, var(--surface)); border: 1px solid color-mix(in srgb, var(--text-primary) 16%, transparent); }
      .csu-rs-input:disabled { opacity: .5; cursor: not-allowed; }
      .csu-rs-act-sm { padding: .22rem .6rem; font-size: .64rem; }
      .csu-rs-goalstatus { margin-top: .6rem; font-size: .72rem; line-height: 1.45; padding: .45rem .65rem; border-radius: .65rem; color: var(--text-primary);
        background: color-mix(in srgb, var(--text-primary) 5%, transparent); border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent); }
      .csu-rs-goalstatus[data-tone="up"] { background: color-mix(in srgb, var(--success) 12%, transparent); border-color: color-mix(in srgb, var(--success) 40%, transparent); }
      .csu-rs-goalstatus[data-tone="down"] { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
      .csu-rs-bars { display: flex; flex-direction: column; gap: .5rem; }
      .csu-rs-bar { display: grid; grid-template-columns: minmax(70px, 118px) 1fr auto; align-items: center; gap: .55rem; font-size: .68rem; color: var(--text-secondary); }
      .csu-rs-barlbl { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .csu-rs-bartrack { height: 6px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--text-primary) 9%, transparent); }
      .csu-rs-barfill { display: block; height: 100%; border-radius: 999px; transition: width .8s ease; }
      .csu-rs-barval { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-primary); font-weight: 700; display: inline-flex; gap: .35rem; align-items: baseline; }
      .csu-rs-barval small { font-size: .58rem; font-weight: 600; color: var(--text-tertiary); }
      .csu-rs-how { font-size: .72rem; line-height: 1.5; color: var(--text-secondary); padding: .7rem .9rem; border-radius: .8rem; animation: csu-rs-pop .25s ease;
        background: color-mix(in srgb, var(--info) 8%, transparent); border: 1px solid color-mix(in srgb, var(--info) 30%, transparent); }
      .csu-rs-how strong { color: var(--text-primary); }
      .csu-rs-how ul { margin: .35rem 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: .2rem; }
      .csu-rs-act[aria-pressed="true"] { color: var(--text-primary); border-color: color-mix(in srgb, var(--primary) 60%, transparent); background: color-mix(in srgb, var(--primary) 12%, transparent); }
      .csu-rs button:focus-visible { outline: 2px solid var(--accent, var(--primary)); outline-offset: 2px; }
      @media (max-width: 520px) {
        .csu-rs { padding: 1rem; }
        .csu-rs-ringwrap { width: 156px; height: 156px; } .csu-rs-ring { width: 156px; height: 156px; }
        .csu-rs-pct { font-size: 1.8rem; } .csu-rs-nextline { max-width: 100px; font-size: .56rem; }
        .csu-rs-modes { margin-left: 0; }
        .csu-rs-labels span { font-size: .52rem; letter-spacing: 0; text-overflow: clip; }
      }
      @media (prefers-reduced-motion: reduce) {
        .csu-rs *, .csu-rs *::before { animation: none !important; transition: none !important; }
      }
      @media (forced-colors: active) {
        .csu-rs-pill, .csu-rs-stat, .csu-rs-semchip, .csu-rs-act, .csu-rs-chip { border-color: CanvasText; }
        .csu-rs-pill[data-state="current"], .csu-rs-mode[data-active="1"] { forced-color-adjust: none; background: Highlight; color: HighlightText; }
      }
    `;
    document.head.appendChild(el);
  }

  window.__ARISE_CSE_READINESS_API__ = { compute: rsCompute, getLevel: rsLevel, LEVELS: RS_LEVELS, MODES: RS_MODES, getGoal: rsGoal, eta: rsEta };

  function render() {
    if (!root || !document.body.contains(root)) return;
    var subs = allSubjects();
    var prog = progress();
    var stats = computeStats();

    // Header
    var headerHTML = '<div class="csu-header">' +
      '<div class="csu-header-meta">' +
        '<div class="csu-header-title">🧩 CSE Syllabus+ <span class="csu-header-badge">All-in-One</span></div>' +
        '<div class="csu-header-sub">' + stats.done + '/' + stats.total + ' subjects done · ' + stats.doneCr + '/' + stats.totalCr + ' credits · ' + (stats.totalMin ? fmtMin(stats.totalMin) : '0m') + ' studied</div>' +
        '<div class="csu-kpi-row">' +
          ['Core','Lab','Elective','Project'].map(function (t) {
            var bt = stats.byType[t] || { total: 0, done: 0 };
            return '<div class="csu-kpi"><div class="csu-kpi-val">' + bt.done + '/' + bt.total + '</div><div class="csu-kpi-lbl">' + t + '</div></div>';
          }).join('') + dueKpi(subs) + riskKpi(subs) +
        '</div>' +
      '</div>' +
      '</div>';

    // Tab nav
    var navHTML = '<div class="csu-tabs">' +
      TABS.map(function (id) {
        return '<button class="csu-tab-btn" data-tab="' + id + '" data-active="' + (state.tab === id ? '1' : '0') + '">' + TAB_LABELS[id] + '</button>';
      }).join('') +
      '</div>';

    // Tab body
    var bodyHTML = '';
    if (state.tab === 'overview')     bodyHTML = renderOverview(stats, subs, prog);
    else if (state.tab === 'subjects')    bodyHTML = renderSubjects(subs, prog);
    else if (state.tab === 'priority')    bodyHTML = renderPriority(subs, prog);
    else if (state.tab === 'analytics')   bodyHTML = renderAnalytics(subs, prog);
    else if (state.tab === 'ia-tracker')  bodyHTML = renderIATracker(subs);
    else if (state.tab === 'revision')    bodyHTML = renderRevision(subs, prog);
    else if (state.tab === 'resources')   bodyHTML = renderResources(subs);
    else if (state.tab === 'college-sync') bodyHTML = renderCollegeSync(subs);
    else if (state.tab === 'data')        bodyHTML = renderData();

    var oldList = root.querySelector('.csu-subj-list');
    var keepScroll = oldList ? oldList.scrollTop : 0;
    /* keep the readiness panel's DOM (and its animation state) when nothing in it changed — typing in
       Subjects search re-renders the widget on every keystroke, and rebuilding the ring each time flickers */
    var oldRs = root.querySelector('.csu-rs');
    var rsMarkup = rsHTML();
    var reuseRs = !!(oldRs && rsMarkup && rsMarkup === rsPrevHTML);
    rsPrevHTML = rsMarkup;
    root.innerHTML = rsMarkup + headerHTML + examBanner(subs, prog) + navHTML + '<div class="csu-tab-body">' + bodyHTML + '</div>';
    wireEvents(subs, prog);
    wireFeatures(subs, prog);
    if (reuseRs) {
      var freshRs = root.querySelector('.csu-rs');
      if (freshRs && freshRs.parentNode) freshRs.parentNode.replaceChild(oldRs, freshRs);
    } else { rsWire(); rsAnimate(); }
    var newList = root.querySelector('.csu-subj-list');
    if (newList && keepScroll) newList.scrollTop = keepScroll;
    if (state.focusSearch != null) {
      var se = root.querySelector('#csu-search');
      if (se) { se.focus(); try { se.setSelectionRange(state.focusSearch, state.focusSearch); } catch (e) {} }
      state.focusSearch = null;
    }
  }

  /* ── Event wiring ── */
  function wireEvents(subs, prog) {
    /* tab nav */
    root.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.getAttribute('data-tab');
        wr(SK_TABS, state.tab);
        render();
      });
    });

    /* subject toggle */
    root.querySelectorAll('[data-toggle-id]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
        var id = row.getAttribute('data-toggle-id');
        setDone([id], !progress()[id]); /* stamps completion time + awards XP once */
      });
    });

    /* subject search / filters */
    var searchEl = root.querySelector('#csu-search');
    if (searchEl) searchEl.addEventListener('input', function () { state.search = searchEl.value; state.focusSearch = searchEl.selectionStart; render(); });
    var semEl = root.querySelector('#csu-sem-filter');
    if (semEl) semEl.addEventListener('change', function () { state.sem = semEl.value; render(); });
    var typeEl = root.querySelector('#csu-type-filter');
    if (typeEl) typeEl.addEventListener('change', function () { state.type = typeEl.value; render(); });
    var statusEl = root.querySelector('#csu-status-filter');
    if (statusEl) statusEl.addEventListener('change', function () { state.status = statusEl.value; render(); });

    /* gate mode */
    var gateEl = root.querySelector('#csu-gate-toggle');
    if (gateEl) gateEl.addEventListener('change', function () { wr(SK_GATE, gateEl.checked); render(); });

    /* IA tracker inputs */
    root.querySelectorAll('[data-ia-field]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var parts = inp.getAttribute('data-ia-field').split(':');
        var sid = parts[0], field = parts[1], max = parseFloat(parts[2]);
        var val = inp.value === '' ? null : Math.max(0, Math.min(max, parseFloat(inp.value)));
        var d = iaData(); d[sid] = Object.assign({ ia1: null, ia2: null, ia3: null, assignment: null }, d[sid]);
        d[sid][field] = val; wr(SK_IA, d);
        // re-render badge only
        var iaCfg = iaSettings(); var sc = calcIA(d[sid], iaCfg);
        var tone = sc.combined == null ? 'none' : sc.combined < 40 ? 'danger' : sc.combined < 60 ? 'warn' : 'ok';
        var badge = inp.closest('.csu-ia-row') && inp.closest('.csu-ia-row').querySelector('.csu-ia-badge');
        if (badge) {
          badge.className = 'csu-ia-badge csu-ia-badge-' + tone;
          badge.textContent = sc.combined == null ? 'No data' : Math.round(sc.combined) + '%' + (sc.combined < 40 ? ' ⚠️' : sc.combined >= 75 ? ' ✓' : '');
        }
      });
    });
    var iaMaxEl = root.querySelector('#csu-ia-max');
    if (iaMaxEl) iaMaxEl.addEventListener('change', function () { var s2 = iaSettings(); s2.iaMax = Math.max(1, parseInt(iaMaxEl.value) || 20); wr(SK_IASES, s2); render(); });
    var assignMaxEl = root.querySelector('#csu-assign-max');
    if (assignMaxEl) assignMaxEl.addEventListener('change', function () { var s2 = iaSettings(); s2.assignMax = Math.max(1, parseInt(assignMaxEl.value) || 10); wr(SK_IASES, s2); render(); });
    var iaSemEl = root.querySelector('#csu-ia-sem');
    if (iaSemEl) iaSemEl.addEventListener('change', function () { state.sem = iaSemEl.value; render(); });

    /* college sync */
    root.querySelectorAll('[data-cs-toggle]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-cs-toggle');
        var cust = rd(SK_CUSTOM, { added: [], removed: [], edits: {}, order: {} });
        var rm = cust.removed || [];
        var idx = rm.indexOf(id);
        if (cb.checked) { if (idx !== -1) rm.splice(idx, 1); }
        else { if (idx === -1) rm.push(id); }
        cust.removed = rm; wr(SK_CUSTOM, cust); render();
      });
    });
    var csRestoreEl = root.querySelector('#csu-cs-restore');
    if (csRestoreEl) csRestoreEl.addEventListener('click', function () {
      var sem = csRestoreEl.getAttribute('data-sem');
      var c = cfg(); if (!c) return;
      var toRestore = {}; (c.SUBJECTS || []).filter(function (s) {
        return sem === 'All' || String(s.sem) === String(sem);
      }).forEach(function (s) { toRestore[s.id] = true; });
      var cust = rd(SK_CUSTOM, { added: [], removed: [], edits: {}, order: {} });
      cust.removed = (cust.removed || []).filter(function (id) { return !toRestore[id]; });
      wr(SK_CUSTOM, cust); render();
    });
    var csSemEl = root.querySelector('#csu-cs-sem');
    if (csSemEl) csSemEl.addEventListener('change', function () { state.sem = csSemEl.value; render(); });
    var csBulkAdd = root.querySelector('#csu-cs-bulk-add');
    if (csBulkAdd) csBulkAdd.addEventListener('click', function () {
      var sem = csBulkAdd.getAttribute('data-sem');
      var textEl = root.querySelector('#csu-cs-bulk-text');
      var text = textEl ? textEl.value : '';
      var c = cfg(); if (!c) return;
      var existing = {};
      (c.SUBJECTS || []).filter(function (s) { return String(s.sem) === String(sem); }).forEach(function (s) { existing[s.name.trim().toLowerCase()] = true; });
      var cust = rd(SK_CUSTOM, { added: [], removed: [], edits: {}, order: {} });
      (cust.added || []).filter(function (s) { return String(s.sem) === String(sem); }).forEach(function (s) { existing[s.name.trim().toLowerCase()] = true; });
      var typeMap = { core: 'Core', lab: 'Lab', elective: 'Elective', project: 'Project' };
      var added = 0;
      text.split('\n').map(function (line) { return line.trim(); }).filter(Boolean).forEach(function (line) {
        var parts = line.split('|').map(function (p) { return p.trim(); });
        var name = parts[0]; if (!name) return;
        if (existing[name.toLowerCase()]) return;
        var credits = Math.max(1, Math.min(12, parseInt(parts[1]) || 3));
        var type = typeMap[(parts[2] || 'core').toLowerCase()] || 'Core';
        var id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + added;
        cust.added.push({ id, name, credits, type, sem, pc: false });
        existing[name.toLowerCase()] = true;
        added++;
      });
      wr(SK_CUSTOM, cust);
      if (added === 0) window.alert('Nothing new to add — all pasted subjects are already in this semester.');
      else render();
    });

    /* data tab */
    var exportBtn = root.querySelector('#csu-export-full');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      var data = { exportedAt: new Date().toISOString(), progress: progress(), custom: rd(SK_CUSTOM, {}), difficulty: difficulty(), examDates: rd(SK_EXAM, {}), revision: rd(SK_REV, {}), completionTimestamps: stamps(), internalMarks: internalMks(), iaData: iaData() };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href = url; a.download = 'cse-syllabus-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    var importBtn = root.querySelector('#csu-import-full');
    var importFile = root.querySelector('#csu-import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function () {
        var f = importFile.files && importFile.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var d = JSON.parse(reader.result);
            if (!d || typeof d !== 'object') { window.alert('Invalid backup file.'); return; }
            if (!window.confirm('Replace current Syllabus+ data with this backup?')) return;
            if (d.progress) wr(SK_PROG, d.progress);
            if (d.custom) wr(SK_CUSTOM, d.custom);
            if (d.difficulty) wr(SK_DIFF, d.difficulty);
            if (d.examDates) wr(SK_EXAM, d.examDates);
            if (d.revision) wr(SK_REV, d.revision);
            if (d.completionTimestamps) wr(SK_STAMPS, d.completionTimestamps);
            if (d.internalMarks) wr(SK_IM, d.internalMarks);
            if (d.iaData) wr(SK_IA, d.iaData);
            render(); window.alert('Import complete.');
          } catch { window.alert('Could not parse backup file.'); }
        };
        reader.readAsText(f); importFile.value = '';
      });
    }

    /* ── Exam Bundle export ── */
    var exportBundleBtn = root.querySelector('#csu-export-bundle');
    if (exportBundleBtn) exportBundleBtn.addEventListener('click', function () {
      var bundle = {
        kind: 'arise-exam-bundle-v1',
        exportedAt: new Date().toISOString(),
        syllabus: {
          progress: progress(),
          custom: rd(SK_CUSTOM, {}),
          difficulty: difficulty(),
          examDates: rd(SK_EXAM, {}),
          revision: rd(SK_REV, {}),
          completionTimestamps: stamps(),
          internalMarks: internalMks(),
          iaData: iaData(),
          gateMode: rd(SK_GATE, false)
        },
        cgpa: rd(SK_CGPA, null),
        attendance: rd(SK_ATT, null)
      };
      var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href = url; a.download = 'exam-prep-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    /* ── Exam Bundle import ── */
    var importBundleBtn = root.querySelector('#csu-import-bundle');
    var importBundleFile = root.querySelector('#csu-import-bundle-file');
    if (importBundleBtn && importBundleFile) {
      importBundleBtn.addEventListener('click', function () { importBundleFile.click(); });
      importBundleFile.addEventListener('change', function () {
        var f = importBundleFile.files && importBundleFile.files[0]; if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var d = JSON.parse(reader.result);
            if (!d || typeof d !== 'object' || !d.syllabus) { window.alert('Invalid Exam Bundle file.'); return; }
            var parts = ['Syllabus+ progress, custom subjects, difficulty, exam dates, revision & IA marks'];
            if (d.cgpa) parts.push('CGPA Tracker semesters & grades');
            if (d.attendance) parts.push('Attendance Tracker records');
            if (!window.confirm('This will REPLACE: ' + parts.join('; ') + '. Continue?')) return;
            var s = d.syllabus;
            if (s.progress) wr(SK_PROG, s.progress);
            if (s.custom) wr(SK_CUSTOM, s.custom);
            if (s.difficulty) wr(SK_DIFF, s.difficulty);
            if (s.examDates) wr(SK_EXAM, s.examDates);
            if (s.revision) wr(SK_REV, s.revision);
            if (s.completionTimestamps) wr(SK_STAMPS, s.completionTimestamps);
            if (s.internalMarks) wr(SK_IM, s.internalMarks);
            if (s.iaData) wr(SK_IA, s.iaData);
            if (typeof s.gateMode === 'boolean') wr(SK_GATE, s.gateMode);
            if (d.cgpa && typeof d.cgpa === 'object') wr(SK_CGPA, d.cgpa);
            if (d.attendance && typeof d.attendance === 'object') wr(SK_ATT, d.attendance);
            render(); window.alert('Exam bundle import complete. Re-open the CGPA Tracker and Attendance Tracker tabs to see their restored data.');
          } catch { window.alert('Could not parse Exam Bundle file.'); }
        };
        reader.readAsText(f); importBundleFile.value = '';
      });
    }
  }

  /* ── Mount / boot ── */
  function mount() {
    if (document.getElementById(WIDGET_ID)) return;
    if (!cfg()) return; // wait for config
    var anchor = document.getElementById('sem-1');
    if (!anchor) return;
    injectStyle();
    rsInjectStyle();
    root = document.createElement('div');
    root.id = WIDGET_ID;
    anchor.parentNode.insertBefore(root, anchor);
    render();
  }

  function boot() {
    mount();
    if (window.__ARISE_MUTATION_BUS__) {
      window.__ARISE_MUTATION_BUS__.subscribe(mount);
    } else {
      var obs = new MutationObserver(mount);
      obs.observe(document.body, { childList: true, subtree: true });
    }
    if (window.__ARISE_STORAGE_WATCH_BUS__) {
      [SK_PROG, SK_REV, SK_CUSTOM, SK_DIFF, SK_EXAM, SK_IM, SK_FOCUS, SK_UNITS, SK_IA].forEach(function (k) {
        window.__ARISE_STORAGE_WATCH_BUS__.watch(k, function () { if (root && document.body.contains(root)) render(); });
      });
    }
    window.addEventListener('storage', function () { if (root && document.body.contains(root)) render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
