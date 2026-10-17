/* daily-learning-tasks-widget.js — Daily Learning Tasks (v3) for Arise.
 *
 * NEW in v3 (over v2)
 * ────────────────────
 * • Tags/categories  — each task carries one tag (DSA / Dev / College / Notes /
 *   Interview / Other); tags filter the live list via a pill-row tab bar.
 * • Pomodoro timer   — built-in per-task 25-min focus timer with pause/resume;
 *   fires studyXP on completion; badge shows session count.
 * • Weekly heatmap   — 7×4 mini-grid showing task-completion density for the
 *   last 28 days; cells shade from surface → success.
 * • Drag-to-reorder  — mousedown/touchstart on the ⠿ handle lets users reorder
 *   within the active (non-completed) list.
 * • Smart suggestions — when the add-input is focused, up to 3 recent incomplete
 *   task texts are shown as quick-insert chips.
 * • Focus-mode hide  — adds the class `dlt-focus-active` to the shell when a
 *   pomodoro runs, dimming everything except the active task row.
 * • Export CSV       — one-click download of today's tasks + 7-day archive as CSV.
 * • v3 schema        — tasks gain { tag, pomodoroCount }; migrates v1/v2 forward.
 *
 * Storage key : arise-daily-learning-tasks-v1  (unchanged)
 * Mount id    : arise-dlt-mount
 */
(function () {
  if (window.__ARISE_DAILY_LEARNING_TASKS__) return;
  window.__ARISE_DAILY_LEARNING_TASKS__ = true;

  /* ── constants ── */
  var KEY              = 'arise-daily-learning-tasks-v1';
  var STYLE_ID         = 'arise-dlt-style';
  var MOUNT_ID         = 'arise-dlt-mount';
  var TTL              = 24 * 60 * 60 * 1000;
  var MAX_TASKS        = 20;
  var ARCHIVE_KEEP_DAYS = 7;
  var POMODORO_SECS    = 25 * 60;

  var PRIORITIES = {
    high:   { label: 'High',   icon: '🔴', xp: 18, order: 0 },
    medium: { label: 'Medium', icon: '🟡', xp: 10, order: 1 },
    low:    { label: 'Low',    icon: '🟢', xp: 5,  order: 2 },
  };
  var PRIORITY_KEYS = ['high', 'medium', 'low'];

  var TAGS = ['All', 'DSA', 'Dev', 'College', 'Notes', 'Interview', 'Other'];
  var TAG_ICONS = { DSA: '🧮', Dev: '💻', College: '🎓', Notes: '📝', Interview: '🎯', Other: '📌', All: '🗂' };

  /* ── module state ── */
  var _selectedPriority = 'medium';
  var _selectedTag      = 'Other';    // tag for next new task
  var _filterTag        = 'All';      // active filter tab
  var _pomodoroTaskId   = null;       // task currently being timed
  var _pomodoroSecsLeft = POMODORO_SECS;
  var _pomodoroRunning  = false;
  var _pomodoroInterval = null;
  var _renderTimer      = null;       // periodic re-render timer

  /* ── utils ── */
  var U = {};
  function getUtils() { U = window.__ARISE_WIDGET_UTILS__ || {}; return U; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function dateLabel(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtTime(ms) {
    var d = new Date(ms), h = d.getHours(), m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
  }
  function fmtSecs(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function friendlyDate(label) {
    var p = label.split('-'); if (p.length !== 3) return label;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((today - d) / 86400000);
    if (diff === 1) return 'Yesterday';
    if (diff === 0) return 'Today';
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] + ' ' + d.getDate() + ' ' +
      ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  }

  /* ── migrate v1/v2 → v3 ── */
  function migrateTask(t) {
    if (!t || typeof t !== 'object' || !t.id || !t.text || !t.createdAt) return null;
    return {
      id: t.id,
      text: t.text,
      createdAt: t.createdAt,
      completedAt: t.completedAt || null,
      priority: PRIORITY_KEYS.indexOf(t.priority) !== -1 ? t.priority : 'medium',
      note: typeof t.note === 'string' ? t.note.slice(0, 120) : '',
      xpAwarded: !!t.xpAwarded,
      tag: typeof t.tag === 'string' && TAG_ICONS[t.tag] ? t.tag : 'Other',
      pomodoroCount: Math.max(0, parseInt(t.pomodoroCount) || 0),
      order: typeof t.order === 'number' ? t.order : t.createdAt,
    };
  }

  /* ── storage ── */
  function load() {
    getUtils();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return _empty();
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return _empty();
      if (!Array.isArray(data.tasks)) data.tasks = [];
      data.tasks = data.tasks.map(migrateTask).filter(Boolean);
      if (!data.archive || typeof data.archive !== 'object') data.archive = {};
      Object.keys(data.archive).forEach(function (k) {
        if (!Array.isArray(data.archive[k])) { delete data.archive[k]; return; }
        data.archive[k] = data.archive[k].map(migrateTask).filter(Boolean);
      });
      if (typeof data.streak !== 'number') data.streak = 0;
      if (typeof data.streakDate !== 'string') data.streakDate = '';
      if (!data.heatmap || typeof data.heatmap !== 'object') data.heatmap = {};
      return data;
    } catch (e) { return _empty(); }
  }
  function _empty() { return { tasks: [], archive: {}, streak: 0, streakDate: '', heatmap: {} }; }
  function save(data) {
    getUtils();
    var fn = U.safeSet || function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    };
    return fn(KEY, data);
  }

  /* ── XP ── */
  function awardXP(task) {
    if (task.xpAwarded) return 0;
    var xp = (PRIORITIES[task.priority] || PRIORITIES.medium).xp;
    try {
      var eng = window.__XP_ENGINE__;
      if (eng && typeof eng.studyXP === 'function') {
        var mins = task.priority === 'high' ? 20 : task.priority === 'low' ? 10 : 15;
        eng.studyXP(mins, Date.now());
      }
    } catch (e) {}
    task.xpAwarded = true;
    return xp;
  }

  function awardPomodoroXP() {
    try {
      var eng = window.__XP_ENGINE__;
      if (eng && typeof eng.studyXP === 'function') eng.studyXP(25, Date.now());
    } catch (e) {}
  }

  /* ── streak ── */
  function updateStreak(data) {
    var today = dateLabel(Date.now());
    if (data.streakDate === today) return;
    var yesterday = dateLabel(Date.now() - 86400000);
    data.streak = data.streakDate === yesterday ? (data.streak || 0) + 1 : 1;
    data.streakDate = today;
  }

  /* ── heatmap data ── */
  function bumpHeatmap(data) {
    var today = dateLabel(Date.now());
    data.heatmap[today] = (data.heatmap[today] || 0) + 1;
    // prune entries older than 28 days
    var cutoff = dateLabel(Date.now() - 28 * 86400000);
    Object.keys(data.heatmap).forEach(function (k) { if (k < cutoff) delete data.heatmap[k]; });
  }

  /* ── expiry / archive ── */
  function runExpiry(data) {
    var now = Date.now(), live = [], expired = [];
    data.tasks.forEach(function (t) {
      if (!t || !t.createdAt) return;
      (now - t.createdAt >= TTL ? expired : live).push(t);
    });
    expired.forEach(function (t) {
      var label = dateLabel(t.createdAt);
      if (!data.archive[label]) data.archive[label] = [];
      if (!data.archive[label].some(function (a) { return a.id === t.id; })) data.archive[label].push(t);
    });
    var cutoff = dateLabel(now - ARCHIVE_KEEP_DAYS * 86400000);
    Object.keys(data.archive).forEach(function (k) { if (k < cutoff) delete data.archive[k]; });
    data.tasks = live;
    return { data: data, expiredCount: expired.length };
  }

  /* ── sort ── */
  function sortTasks(tasks) {
    return tasks.slice().sort(function (a, b) {
      var aDone = !!a.completedAt, bDone = !!b.completedAt;
      if (aDone !== bDone) return aDone ? 1 : -1;
      var aOrd = (PRIORITIES[a.priority] || PRIORITIES.medium).order;
      var bOrd = (PRIORITIES[b.priority] || PRIORITIES.medium).order;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return (a.order || a.createdAt) - (b.order || b.createdAt);
    });
  }

  /* ── colour grading ── */
  var COLOR_STEPS = [
    { at: 0,    border: 'var(--border)',   glow: 'transparent' },
    { at: 0.01, border: 'var(--info)',     glow: 'rgba(78,167,252,.18)' },
    { at: 0.4,  border: 'var(--warning)',  glow: 'rgba(229,165,63,.18)' },
    { at: 0.75, border: 'var(--success)',  glow: 'rgba(76,195,138,.20)' },
    { at: 1,    border: '#b68fff',         glow: 'rgba(182,143,255,.22)' },
  ];
  function gradeColor(ratio) {
    ratio = Math.max(0, Math.min(1, ratio));
    for (var i = COLOR_STEPS.length - 1; i >= 0; i--) {
      if (ratio >= COLOR_STEPS[i].at) {
        var lo = COLOR_STEPS[i], hi = COLOR_STEPS[i + 1] || lo;
        var t = (ratio - lo.at) / ((hi.at - lo.at) || 1);
        return { border: t < 0.5 ? lo.border : hi.border, glow: t < 0.5 ? lo.glow : hi.glow };
      }
    }
    return COLOR_STEPS[0];
  }
  function taskRowColors(task, now) {
    if (task.completedAt) return { bg: 'rgba(76,195,138,.08)', border: 'rgba(76,195,138,.22)', text: 'var(--text-secondary)' };
    if (task.id === _pomodoroTaskId && _pomodoroRunning) return { bg: 'rgba(182,143,255,.10)', border: 'rgba(182,143,255,.45)', text: 'var(--text-primary)' };
    if (task.priority === 'high')  return { bg: 'rgba(235,87,87,.07)',  border: 'rgba(235,87,87,.22)',  text: 'var(--text-primary)' };
    if (task.priority === 'low')   return { bg: 'rgba(76,195,138,.06)', border: 'rgba(76,195,138,.18)', text: 'var(--text-primary)' };
    var age = Math.min((now - task.createdAt) / TTL, 1);
    if (age >= 0.75) return { bg: 'rgba(235,87,87,.07)',  border: 'rgba(235,87,87,.20)',  text: 'var(--text-primary)' };
    if (age >= 0.5)  return { bg: 'rgba(229,165,63,.07)', border: 'rgba(229,165,63,.20)', text: 'var(--text-primary)' };
    return { bg: 'rgba(78,167,252,.05)', border: 'rgba(78,167,252,.18)', text: 'var(--text-primary)' };
  }
  function ttlLabel(task, now) {
    var rem = TTL - (now - task.createdAt);
    if (rem <= 0) return { text: 'expiring…', style: 'background:rgba(235,87,87,.12);color:var(--danger)' };
    var h = Math.floor(rem / 3600000), m = Math.floor((rem % 3600000) / 60000);
    if (h >= 6) return { text: h + 'h left',            style: 'background:rgba(78,167,252,.10);color:var(--info)' };
    if (h >= 1) return { text: h + 'h ' + m + 'm left', style: 'background:rgba(229,165,63,.10);color:var(--warning)' };
    return          { text: m + 'm left',            style: 'background:rgba(235,87,87,.10);color:var(--danger)' };
  }

  /* ── suggestions (recent incomplete texts) ── */
  function getSuggestions() {
    try {
      var data = load();
      var all = [];
      // from archive: collect incomplete texts from last 3 days
      Object.keys(data.archive).sort().reverse().slice(0, 3).forEach(function (k) {
        data.archive[k].forEach(function (t) { if (!t.completedAt) all.push(t.text); });
      });
      // dedupe & limit
      var seen = {}, out = [];
      for (var i = 0; i < all.length && out.length < 3; i++) {
        if (!seen[all[i]]) { seen[all[i]] = true; out.push(all[i]); }
      }
      return out;
    } catch (e) { return []; }
  }

  /* ── heatmap HTML ── */
  function heatmapHTML(heatmap) {
    var cells = '';
    var now = Date.now();
    for (var i = 27; i >= 0; i--) {
      var label = dateLabel(now - i * 86400000);
      var count = heatmap[label] || 0;
      var level = count === 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
      var opacity = [0.08, 0.25, 0.45, 0.65, 1][level];
      var title = label + (count > 0 ? ': ' + count + ' task' + (count > 1 ? 's' : '') + ' done' : ': no tasks');
      cells += '<span class="dlt-hm-cell" style="background:rgba(76,195,138,' + opacity + ')" title="' + esc(title) + '"></span>';
    }
    return '<div class="dlt-heatmap"><div class="dlt-hm-label">28-day activity</div><div class="dlt-hm-grid">' + cells + '</div></div>';
  }

  /* ── CSV export ── */
  function exportCSV(data) {
    var rows = [['Date', 'Text', 'Priority', 'Tag', 'Created', 'Completed', 'Pomodoros', 'XP']];
    var today = dateLabel(Date.now());
    var pr = PRIORITIES;
    data.tasks.forEach(function (t) {
      rows.push([today, t.text, t.priority, t.tag || 'Other', fmtTime(t.createdAt),
        t.completedAt ? fmtTime(t.completedAt) : '', t.pomodoroCount || 0,
        t.completedAt ? (pr[t.priority] || pr.medium).xp : 0]);
    });
    Object.keys(data.archive).sort().reverse().forEach(function (k) {
      data.archive[k].forEach(function (t) {
        rows.push([k, t.text, t.priority, t.tag || 'Other', fmtTime(t.createdAt),
          t.completedAt ? fmtTime(t.completedAt) : '', t.pomodoroCount || 0,
          t.completedAt ? (pr[t.priority] || pr.medium).xp : 0]);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    try {
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'arise-tasks-' + today + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) {}
  }

  /* ── styles ── */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* shell */
      '.dlt-shell{width:100%;font-family:inherit;transition:opacity .3s}',
      '.dlt-shell.dlt-focus-active .dlt-task:not(.dlt-focus-task){opacity:.25;pointer-events:none}',
      '.dlt-header{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap}',
      '.dlt-title{display:flex;align-items:center;gap:.4rem;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,var(--text-tertiary,#71717a))}',
      '.dlt-header-right{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}',
      '.dlt-badge{font-size:.67rem;font-weight:700;padding:.16rem .52rem;border-radius:999px;background:color-mix(in srgb,var(--info) 12%,transparent);color:var(--info);border:1px solid color-mix(in srgb,var(--info) 25%,transparent);transition:background .3s,color .3s,border-color .3s}',
      '.dlt-badge.grade-warn{background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);border-color:color-mix(in srgb,var(--warning) 25%,transparent)}',
      '.dlt-badge.grade-done{background:color-mix(in srgb,var(--success) 12%,transparent);color:var(--success);border-color:color-mix(in srgb,var(--success) 25%,transparent)}',
      '.dlt-streak{font-size:.67rem;font-weight:700;color:var(--warning);display:flex;align-items:center;gap:.18rem}',
      '.dlt-icon-btn{padding:.2rem .5rem;border-radius:.5rem;border:1px solid var(--border);background:transparent;color:var(--text-secondary);font-size:.68rem;cursor:pointer;transition:background .18s,color .18s}',
      '.dlt-icon-btn:hover{background:color-mix(in srgb,var(--info) 10%,transparent);color:var(--info);border-color:var(--info)}',

      /* progress */
      '.dlt-progress{height:4px;border-radius:999px;background:var(--surface-soft,rgba(255,255,255,.06));margin-bottom:.8rem;overflow:hidden}',
      '.dlt-progress-fill{height:100%;border-radius:999px;width:0%;transition:width .4s cubic-bezier(.4,0,.2,1),background .4s}',

      /* add row */
      '.dlt-add-row{display:flex;gap:.4rem;margin-bottom:.5rem;flex-wrap:wrap;position:relative}',
      '.dlt-input{flex:1;min-width:140px;padding:.5rem .68rem;border-radius:.6rem;border:1.5px solid var(--border,rgba(255,255,255,.1));background:var(--surface,rgba(30,30,46,.6));color:var(--text-primary,#eeeef0);font-size:.82rem;font-family:inherit;outline:none;transition:border-color .25s,box-shadow .25s}',
      '.dlt-input:focus{border-color:var(--info);box-shadow:0 0 0 3px rgba(78,167,252,.15)}',
      '.dlt-input::placeholder{color:var(--text-tertiary,#71717a)}',
      '.dlt-add-btn{padding:.48rem .85rem;border-radius:.6rem;border:1.5px solid var(--info);background:color-mix(in srgb,var(--info) 14%,transparent);color:var(--info);font-size:.81rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:transform .15s,background .2s,box-shadow .2s}',
      '.dlt-add-btn:hover:not(:disabled){background:color-mix(in srgb,var(--info) 22%,transparent);transform:translateY(-1px);box-shadow:0 2px 10px rgba(78,167,252,.22)}',
      '.dlt-add-btn:disabled{opacity:.4;cursor:not-allowed}',

      /* suggestions */
      '.dlt-suggestions{display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.45rem}',
      '.dlt-sug{padding:.18rem .55rem;border-radius:999px;border:1px dashed var(--border);background:transparent;font-size:.68rem;color:var(--text-secondary);cursor:pointer;transition:background .18s,color .18s;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dlt-sug:hover{background:color-mix(in srgb,var(--info) 10%,transparent);color:var(--info);border-color:var(--info)}',
      '.dlt-sug-label{font-size:.63rem;color:var(--text-tertiary);margin-right:.3rem}',

      /* meta row: priority + tag + actions */
      '.dlt-meta-row{display:flex;gap:.35rem;margin-bottom:.7rem;align-items:center;flex-wrap:wrap}',
      '.dlt-meta-label{font-size:.65rem;font-weight:600;color:var(--text-tertiary,#71717a)}',
      '.dlt-pri-btn{padding:.2rem .52rem;border-radius:999px;border:1.5px solid var(--border,rgba(255,255,255,.1));background:transparent;font-size:.68rem;font-weight:700;cursor:pointer;transition:background .18s,border-color .18s;color:var(--text-secondary,#a1a1aa)}',
      '.dlt-pri-btn.active-high{background:rgba(235,87,87,.14);border-color:rgba(235,87,87,.5);color:var(--danger)}',
      '.dlt-pri-btn.active-medium{background:rgba(229,165,63,.12);border-color:rgba(229,165,63,.4);color:var(--warning)}',
      '.dlt-pri-btn.active-low{background:rgba(76,195,138,.12);border-color:rgba(76,195,138,.4);color:var(--success)}',
      '.dlt-tag-btn{padding:.2rem .52rem;border-radius:999px;border:1.5px solid var(--border);background:transparent;font-size:.68rem;font-weight:600;cursor:pointer;transition:background .18s,border-color .18s;color:var(--text-secondary)}',
      '.dlt-tag-btn.active{background:color-mix(in srgb,var(--info) 12%,transparent);border-color:color-mix(in srgb,var(--info) 40%,transparent);color:var(--info)}',

      /* filter tabs */
      '.dlt-filter-row{display:flex;gap:.25rem;margin-bottom:.65rem;overflow-x:auto;padding-bottom:.1rem;scrollbar-width:none}',
      '.dlt-filter-row::-webkit-scrollbar{display:none}',
      '.dlt-filter-tab{padding:.2rem .55rem;border-radius:999px;border:1px solid var(--border);background:transparent;font-size:.67rem;font-weight:600;cursor:pointer;color:var(--text-secondary);white-space:nowrap;transition:background .18s,color .18s,border-color .18s}',
      '.dlt-filter-tab.active{background:color-mix(in srgb,var(--info) 14%,transparent);border-color:color-mix(in srgb,var(--info) 40%,transparent);color:var(--info)}',

      /* action row */
      '.dlt-action-row{display:flex;align-items:center;justify-content:space-between;gap:.45rem;margin-bottom:.5rem;flex-wrap:wrap}',
      '.dlt-stats{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}',
      '.dlt-stat{font-size:.7rem;color:var(--text-secondary,#a1a1aa)}',
      '.dlt-stat b{color:var(--text-primary,#eeeef0)}',
      '.dlt-action-btns{display:flex;gap:.3rem;align-items:center}',
      '.dlt-all-btn{padding:.22rem .65rem;border-radius:999px;border:1px solid var(--border);background:transparent;font-size:.68rem;font-weight:700;cursor:pointer;color:var(--text-secondary);transition:background .18s,color .18s}',
      '.dlt-all-btn:hover{background:color-mix(in srgb,var(--info) 10%,transparent);color:var(--info);border-color:var(--info)}',

      /* task list */
      '.dlt-list{display:flex;flex-direction:column;gap:.4rem;margin-bottom:.7rem}',
      '.dlt-empty{font-size:.77rem;color:var(--text-secondary,#a1a1aa);padding:.55rem 0;text-align:center;line-height:1.6}',
      '.dlt-empty kbd{display:inline-block;padding:.08rem .32rem;border-radius:.28rem;border:1px solid var(--border);background:var(--surface-soft,rgba(255,255,255,.05));font-family:monospace;font-size:.7rem}',

      /* task row */
      '.dlt-task{display:flex;align-items:flex-start;gap:.45rem;padding:.5rem .65rem;border-radius:.65rem;border:1px solid var(--border,rgba(255,255,255,.07));background:rgba(255,255,255,.03);transition:border-color .3s,background .3s,opacity .3s}',
      '.dlt-task.is-done{opacity:.65}',
      '.dlt-task.dlt-focus-task{box-shadow:0 0 0 2px rgba(182,143,255,.4)}',
      '.dlt-drag-handle{flex-shrink:0;cursor:grab;font-size:.75rem;color:var(--text-tertiary);padding:.1rem .05rem;user-select:none;line-height:1.3;margin-top:.1rem;opacity:.4;transition:opacity .18s}',
      '.dlt-drag-handle:hover{opacity:1}',
      '.dlt-task-check{flex-shrink:0;margin-top:.1rem;width:1rem;height:1rem;border-radius:.26rem;border:1.5px solid var(--border-strong,rgba(255,255,255,.18));background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .2s,border-color .2s;padding:0}',
      '.dlt-task-check.checked{background:var(--success);border-color:var(--success)}',
      '.dlt-task-check-icon{font-size:.58rem;color:#fff;display:none}',
      '.dlt-task-check.checked .dlt-task-check-icon{display:block}',
      '.dlt-task-body{flex:1;min-width:0}',
      '.dlt-task-top{display:flex;align-items:center;gap:.32rem;flex-wrap:wrap}',
      '.dlt-task-pri{font-size:.66rem;flex-shrink:0;line-height:1}',
      '.dlt-task-tag{font-size:.62rem;padding:.06rem .3rem;border-radius:999px;background:rgba(78,167,252,.09);color:var(--info);font-weight:600;flex-shrink:0}',
      '.dlt-task-text{font-size:.81rem;color:var(--text-primary,#eeeef0);line-height:1.4;word-break:break-word;flex:1;min-width:0}',
      '.dlt-task-text.is-done{text-decoration:line-through;color:var(--text-secondary,#a1a1aa)}',
      '.dlt-task-edit{width:100%;border:none;background:transparent;font-size:.81rem;color:var(--text-primary,#eeeef0);font-family:inherit;outline:none;border-bottom:1.5px solid var(--info);padding:.08rem 0}',
      '.dlt-task-note{font-size:.69rem;color:var(--text-tertiary,#71717a);margin-top:.16rem;line-height:1.4;word-break:break-word}',
      '.dlt-task-meta{display:flex;align-items:center;gap:.4rem;margin-top:.2rem;flex-wrap:wrap}',
      '.dlt-task-time{font-size:.64rem;color:var(--text-tertiary,#71717a)}',
      '.dlt-task-ttl{font-size:.63rem;padding:.06rem .35rem;border-radius:999px;font-weight:600}',
      '.dlt-task-xp{font-size:.62rem;padding:.05rem .32rem;border-radius:999px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);font-weight:700}',
      '.dlt-task-pomo{font-size:.62rem;color:var(--text-tertiary)}',
      '.dlt-task-actions{display:flex;gap:.22rem;flex-shrink:0;align-items:flex-start;margin-top:.04rem}',
      '.dlt-task-btn{width:1.25rem;height:1.25rem;border-radius:.35rem;border:none;background:transparent;cursor:pointer;font-size:.7rem;display:flex;align-items:center;justify-content:center;opacity:.42;transition:opacity .18s,background .18s,color .18s;color:var(--text-tertiary,#71717a)}',
      '.dlt-task-btn:hover{opacity:1}',
      '.dlt-task-btn.edit-btn:hover{background:color-mix(in srgb,var(--info) 14%,transparent);color:var(--info)}',
      '.dlt-task-btn.del-btn:hover{background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger)}',
      '.dlt-task-btn.pomo-btn{font-size:.75rem}',
      '.dlt-task-btn.pomo-btn:hover{background:color-mix(in srgb,#b68fff 14%,transparent);color:#b68fff}',
      '.dlt-task-btn.pomo-btn.active{opacity:1;color:#b68fff;background:color-mix(in srgb,#b68fff 14%,transparent)}',

      /* pomodoro timer chip */
      '.dlt-pomo-chip{display:flex;align-items:center;gap:.3rem;padding:.18rem .5rem;border-radius:999px;background:color-mix(in srgb,#b68fff 12%,transparent);border:1px solid color-mix(in srgb,#b68fff 30%,transparent);font-size:.68rem;font-weight:700;color:#b68fff;margin-top:.2rem}',
      '.dlt-pomo-time{font-family:monospace;font-size:.7rem;letter-spacing:.03em}',
      '.dlt-pomo-pause{background:none;border:none;cursor:pointer;font-size:.7rem;color:#b68fff;padding:0;line-height:1}',
      '.dlt-pomo-stop{background:none;border:none;cursor:pointer;font-size:.62rem;color:var(--text-tertiary);padding:0;line-height:1;opacity:.7}',
      '.dlt-pomo-stop:hover{color:var(--danger);opacity:1}',

      /* heatmap */
      '.dlt-heatmap{margin-bottom:.65rem}',
      '.dlt-hm-label{font-size:.64rem;color:var(--text-tertiary);margin-bottom:.3rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase}',
      '.dlt-hm-grid{display:grid;grid-template-columns:repeat(28,1fr);gap:2px}',
      '.dlt-hm-cell{border-radius:2px;aspect-ratio:1;transition:transform .15s}',
      '.dlt-hm-cell:hover{transform:scale(1.4)}',

      /* archive */
      '.dlt-archive{margin-top:.5rem;border-top:1px solid var(--border-soft,var(--border,rgba(255,255,255,.07)));padding-top:.5rem}',
      '.dlt-archive-toggle{display:flex;align-items:center;gap:.38rem;background:none;border:none;color:var(--text-secondary,#a1a1aa);font-size:.71rem;font-weight:700;cursor:pointer;padding:.26rem 0;letter-spacing:.03em;width:100%;text-align:left;transition:color .2s}',
      '.dlt-archive-toggle:hover{color:var(--text-primary,#eeeef0)}',
      '.dlt-archive-chevron{font-size:.66rem;transition:transform .25s}',
      '.dlt-archive-chevron.open{transform:rotate(180deg)}',
      '.dlt-archive-body{margin-top:.4rem;display:flex;flex-direction:column;gap:.7rem;animation:dlt-fade-in .2s ease-out}',
      '.dlt-archive-day-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:.28rem}',
      '.dlt-archive-day{font-size:.68rem;font-weight:700;color:var(--text-tertiary,#71717a);letter-spacing:.04em;text-transform:uppercase}',
      '.dlt-archive-day-bar{height:3px;border-radius:999px;background:var(--surface-soft,rgba(255,255,255,.06));flex:1;max-width:72px;margin-left:.45rem;overflow:hidden}',
      '.dlt-archive-day-fill{height:100%;border-radius:999px;transition:width .4s}',
      '.dlt-archive-task{display:flex;align-items:center;gap:.4rem;padding:.34rem .55rem;border-radius:.5rem;background:var(--surface-soft,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.05));opacity:.7}',
      '.dlt-archive-task-text{font-size:.74rem;color:var(--text-secondary,#a1a1aa)}',
      '.dlt-archive-task-done{text-decoration:line-through;color:var(--text-tertiary,#71717a)}',
      '.dlt-archive-dot{width:.38rem;height:.38rem;border-radius:50%;flex-shrink:0}',
      '.dlt-archive-dot.done{background:var(--success)}',
      '.dlt-archive-dot.pending{background:var(--warning)}',

      /* hint */
      '.dlt-hint{font-size:.63rem;color:var(--text-tertiary,#71717a);margin-top:.3rem;text-align:right}',
      '.dlt-hint kbd{display:inline-block;padding:.04rem .26rem;border-radius:.26rem;border:1px solid var(--border);background:var(--surface-soft,rgba(255,255,255,.05));font-family:monospace;font-size:.6rem}',

      /* drag-ghost */
      '.dlt-drag-ghost{opacity:.4;border:1.5px dashed var(--info) !important}',

      /* animations */
      '@keyframes dlt-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
      '.dlt-task.just-added{animation:dlt-fade-in .28s ease-out}',
      '@keyframes dlt-pomo-pulse{0%,100%{box-shadow:0 0 0 0 rgba(182,143,255,.4)}50%{box-shadow:0 0 0 4px rgba(182,143,255,0)}}',
      '.dlt-pomo-chip{animation:dlt-pomo-pulse 2s infinite}',

      /* light-mode */
      "[data-theme-mode='light'] .dlt-input{background:var(--bg-card,#fff);color:var(--text-primary,#0f172a)}",
      "[data-theme-mode='light'] .dlt-task{background:var(--surface-soft,#f8fafc)}",
      "[data-theme-mode='light'] .dlt-archive-task{background:var(--surface-soft,#f1f5f9)}",
    ].join('');
    document.head.appendChild(s);
  }

  /* ── render ── */
  function render() {
    injectStyles();
    var el = document.getElementById(MOUNT_ID);
    if (!el) return;

    var data = load();
    var exResult = runExpiry(data);
    data = exResult.data;
    if (exResult.expiredCount > 0) save(data);

    var now = Date.now();
    var allTasks = data.tasks;
    var filtered = _filterTag === 'All' ? allTasks : allTasks.filter(function (t) { return t.tag === _filterTag; });
    var sorted = sortTasks(filtered);
    var done = allTasks.filter(function (t) { return !!t.completedAt; }).length;
    var total = allTasks.length;
    var ratio = total > 0 ? done / total : 0;

    var badgeCls = 'dlt-badge' + (ratio >= 1 && total > 0 ? ' grade-done' : ratio >= 0.4 ? ' grade-warn' : '');
    var progressBg = ratio >= 1 && total > 0 ? 'var(--success)' : ratio >= 0.4 ? 'var(--warning)' : ratio > 0 ? 'var(--info)' : 'var(--border-strong,rgba(255,255,255,.18))';
    var streakHtml = data.streak > 1 ? '<span class="dlt-streak">🔥 ' + data.streak + 'd</span>' : '';

    /* suggestions */
    var sugs = getSuggestions();
    var sugHtml = sugs.length > 0
      ? '<div class="dlt-suggestions"><span class="dlt-sug-label">↩ recent:</span>' +
        sugs.map(function (s) { return '<button class="dlt-sug" data-action="suggest" data-text="' + esc(s) + '" title="' + esc(s) + '">' + esc(s.length > 22 ? s.slice(0, 22) + '…' : s) + '</button>'; }).join('') +
        '</div>'
      : '';

    /* meta row: priority + tag for new task */
    var metaHtml = '<div class="dlt-meta-row">' +
      '<span class="dlt-meta-label">Pri:</span>' +
      PRIORITY_KEYS.map(function (p) {
        var pr = PRIORITIES[p], active = _selectedPriority === p ? ' active-' + p : '';
        return '<button class="dlt-pri-btn' + active + '" data-action="set-priority" data-priority="' + p + '">' + pr.icon + ' ' + pr.label + '</button>';
      }).join('') +
      '<span class="dlt-meta-label" style="margin-left:.3rem">Tag:</span>' +
      TAGS.slice(1).map(function (tg) {
        var active = _selectedTag === tg ? ' active' : '';
        return '<button class="dlt-tag-btn' + active + '" data-action="set-tag" data-tag="' + tg + '">' + TAG_ICONS[tg] + ' ' + tg + '</button>';
      }).join('') +
      '</div>';

    /* filter tabs */
    var filterHtml = '<div class="dlt-filter-row">' +
      TAGS.map(function (tg) {
        var active = _filterTag === tg ? ' active' : '';
        var cnt = tg === 'All' ? allTasks.length : allTasks.filter(function (t) { return t.tag === tg; }).length;
        return '<button class="dlt-filter-tab' + active + '" data-action="filter-tag" data-tag="' + tg + '">' +
          TAG_ICONS[tg] + ' ' + tg + (cnt > 0 ? ' <b>' + cnt + '</b>' : '') + '</button>';
      }).join('') +
      '</div>';

    /* task rows */
    var taskHtml;
    if (sorted.length === 0) {
      taskHtml = '<div class="dlt-empty">' +
        (_filterTag !== 'All' ? 'No ' + _filterTag + ' tasks — ' : 'No tasks yet — ') +
        'write one above and hit <kbd>Enter</kbd></div>';
    } else {
      var allDone = done === total && total > 0;
      var actionRow = '<div class="dlt-action-row">' +
        '<div class="dlt-stats">' +
          '<span class="dlt-stat"><b>' + done + '</b>/' + total + ' done</span>' +
          (allDone ? '<span class="dlt-stat" style="color:var(--success);font-weight:700">🎉 All done!</span>' : '') +
        '</div>' +
        '<div class="dlt-action-btns">' +
          '<button class="dlt-all-btn" data-action="toggle-all">' + (allDone ? '↩ Undo all' : '✓ All') + '</button>' +
          '<button class="dlt-icon-btn" data-action="export-csv" title="Export CSV">⬇ CSV</button>' +
        '</div>' +
        '</div>';

      taskHtml = actionRow + '<div class="dlt-list" id="dlt-list">' +
        sorted.map(function (t) {
          var rc = taskRowColors(t, now);
          var ttl = ttlLabel(t, now);
          var isDone = !!t.completedAt;
          var pr = PRIORITIES[t.priority] || PRIORITIES.medium;
          var isPomoTask = t.id === _pomodoroTaskId;
          var focusCls = isPomoTask ? ' dlt-focus-task' : '';
          var pomoBtnCls = isPomoTask ? ' pomo-btn active' : ' pomo-btn';
          var pomoBtnTitle = isPomoTask ? (_pomodoroRunning ? 'Pomodoro running' : 'Pomodoro paused') : 'Start 25-min focus';
          var pomoBtnIcon = isPomoTask ? (_pomodoroRunning ? '⏸' : '▶') : '🍅';

          var pomoChip = isPomoTask
            ? '<div class="dlt-pomo-chip"><span>🍅</span><span class="dlt-pomo-time">' + fmtSecs(_pomodoroSecsLeft) + '</span>' +
              '<button class="dlt-pomo-pause" data-action="pomo-toggle" data-id="' + esc(t.id) + '">' + (_pomodoroRunning ? '⏸' : '▶') + '</button>' +
              '<button class="dlt-pomo-stop" data-action="pomo-stop" data-id="' + esc(t.id) + '" title="Stop timer">✕</button></div>'
            : '';

          return '<div class="dlt-task' + (isDone ? ' is-done' : '') + focusCls + '" data-task-id="' + esc(t.id) + '"' +
            ' style="background:' + rc.bg + ';border-color:' + rc.border + '">' +
            (!isDone ? '<span class="dlt-drag-handle" data-action="drag-handle" data-id="' + esc(t.id) + '" title="Drag to reorder">⠿</span>' : '') +
            '<button class="dlt-task-check' + (isDone ? ' checked' : '') + '" data-action="toggle" data-id="' + esc(t.id) + '">' +
              '<span class="dlt-task-check-icon">✓</span></button>' +
            '<div class="dlt-task-body">' +
              '<div class="dlt-task-top">' +
                '<span class="dlt-task-pri">' + pr.icon + '</span>' +
                '<span class="dlt-task-tag">' + TAG_ICONS[t.tag || 'Other'] + ' ' + esc(t.tag || 'Other') + '</span>' +
                '<span class="dlt-task-text' + (isDone ? ' is-done' : '') + '" style="color:' + rc.text + '"' +
                  ' data-action="start-edit" data-id="' + esc(t.id) + '">' + esc(t.text) + '</span>' +
              '</div>' +
              (t.note ? '<div class="dlt-task-note">' + esc(t.note) + '</div>' : '') +
              pomoChip +
              '<div class="dlt-task-meta">' +
                '<span class="dlt-task-time">' + fmtTime(t.createdAt) + '</span>' +
                (!isDone ? '<span class="dlt-task-ttl" style="' + ttl.style + '">' + ttl.text + '</span>' : '') +
                (isDone ? '<span class="dlt-task-xp">+' + pr.xp + ' XP</span>' : '') +
                (isDone ? '<span style="font-size:.63rem;color:var(--success);font-weight:600">✓ Done</span>' : '') +
                (t.pomodoroCount > 0 ? '<span class="dlt-task-pomo">🍅×' + t.pomodoroCount + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="dlt-task-actions">' +
              (!isDone ? '<button class="dlt-task-btn' + pomoBtnCls + '" data-action="pomo-start" data-id="' + esc(t.id) + '" title="' + pomoBtnTitle + '">' + pomoBtnIcon + '</button>' : '') +
              '<button class="dlt-task-btn edit-btn" data-action="start-edit" data-id="' + esc(t.id) + '" title="Edit">✎</button>' +
              '<button class="dlt-task-btn del-btn" data-action="delete" data-id="' + esc(t.id) + '" title="Delete">✕</button>' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>';
    }

    /* archive */
    var archiveKeys = Object.keys(data.archive).sort().reverse();
    var archiveHtml = '';
    if (archiveKeys.length > 0) {
      archiveHtml = '<div class="dlt-archive">' +
        '<button class="dlt-archive-toggle" data-action="toggle-archive">' +
          '<span class="dlt-archive-chevron" id="dlt-arc-chev">▾</span>' +
          'Previous days (' + archiveKeys.length + ')' +
        '</button>' +
        '<div id="dlt-archive-body" style="display:none" class="dlt-archive-body">' +
          archiveKeys.slice(0, ARCHIVE_KEEP_DAYS).map(function (k) {
            var dayTasks = data.archive[k];
            var dayDone = dayTasks.filter(function (t) { return !!t.completedAt; }).length;
            var dayRatio = dayTasks.length > 0 ? dayDone / dayTasks.length : 0;
            var barColor = dayRatio >= 1 ? 'var(--success)' : dayRatio >= 0.5 ? 'var(--warning)' : 'var(--info)';
            return '<div>' +
              '<div class="dlt-archive-day-head">' +
                '<span class="dlt-archive-day">' + friendlyDate(k) + ' — ' + dayDone + '/' + dayTasks.length + '</span>' +
                '<div class="dlt-archive-day-bar"><div class="dlt-archive-day-fill" style="width:' + (dayRatio * 100).toFixed(0) + '%;background:' + barColor + '"></div></div>' +
              '</div>' +
              dayTasks.map(function (t) {
                var isDone = !!t.completedAt;
                var pr = PRIORITIES[t.priority] || PRIORITIES.medium;
                return '<div class="dlt-archive-task">' +
                  '<span class="dlt-archive-dot ' + (isDone ? 'done' : 'pending') + '"></span>' +
                  '<span style="font-size:.66rem;flex-shrink:0">' + pr.icon + '</span>' +
                  '<span style="font-size:.62rem;flex-shrink:0">' + TAG_ICONS[t.tag || 'Other'] + '</span>' +
                  '<span class="dlt-archive-task-text' + (isDone ? ' dlt-archive-task-done' : '') + '">' + esc(t.text) + '</span>' +
                '</div>';
              }).join('') +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
    }

    var html =
      '<div class="dlt-shell' + (_pomodoroRunning ? ' dlt-focus-active' : '') + '">' +
        '<div class="dlt-header">' +
          '<span class="dlt-title">📋 Daily Tasks</span>' +
          '<div class="dlt-header-right">' + streakHtml + '<span class="' + badgeCls + '">' + done + '/' + total + '</span></div>' +
        '</div>' +
        '<div class="dlt-progress"><div class="dlt-progress-fill" id="dlt-bar" style="width:' + (ratio * 100).toFixed(1) + '%;background:' + progressBg + '"></div></div>' +
        heatmapHTML(data.heatmap || {}) +
        '<div class="dlt-add-row"><input id="dlt-input" class="dlt-input" type="text" maxlength="200" placeholder="Add a task… (Ctrl+Enter to focus)" autocomplete="off" /><button id="dlt-add" class="dlt-add-btn" disabled>Add</button></div>' +
        sugHtml +
        metaHtml +
        filterHtml +
        taskHtml +
        archiveHtml +
        '<div class="dlt-hint"><kbd>Ctrl+Enter</kbd> focus · double-click to edit · ⠿ drag to reorder</div>' +
      '</div>';

    el.innerHTML = html;
    if (!el.__dltWired) { el.__dltWired = true; wireEvents(el); }
    wireInputEvents(el);
  }

  /* ── event wiring (persistent delegate) ── */
  function wireEvents(el) {
    el.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!t) return;
      var action = t.getAttribute('data-action');
      var id     = t.getAttribute('data-id');

      if (action === 'set-priority') {
        _selectedPriority = t.getAttribute('data-priority') || 'medium';
        el.querySelectorAll('.dlt-pri-btn').forEach(function (btn) {
          var p = btn.getAttribute('data-priority');
          btn.className = 'dlt-pri-btn' + (_selectedPriority === p ? ' active-' + p : '');
        });
        return;
      }
      if (action === 'set-tag') {
        _selectedTag = t.getAttribute('data-tag') || 'Other';
        el.querySelectorAll('.dlt-tag-btn').forEach(function (btn) {
          btn.className = 'dlt-tag-btn' + (_selectedTag === btn.getAttribute('data-tag') ? ' active' : '');
        });
        return;
      }
      if (action === 'filter-tag') {
        _filterTag = t.getAttribute('data-tag') || 'All';
        render(); return;
      }
      if (action === 'suggest') {
        var inp = document.getElementById('dlt-input');
        if (inp) { inp.value = t.getAttribute('data-text') || ''; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); }
        return;
      }
      if (action === 'toggle' && id) {
        var d1 = load();
        var task = d1.tasks.find(function (x) { return x.id === id; });
        if (!task) return;
        if (!task.completedAt) {
          task.completedAt = Date.now();
          var xp = awardXP(task);
          updateStreak(d1); bumpHeatmap(d1);
          getUtils();
          if (U.showToast && xp > 0) U.showToast('+' + xp + ' XP — ' + (PRIORITIES[task.priority] || PRIORITIES.medium).label + ' ' + (task.tag || '') + ' task done! 🎉', 'success');
          if (_pomodoroTaskId === id) stopPomodoro(false);
        } else { task.completedAt = null; task.xpAwarded = false; }
        save(d1); dispatchUpdate(); render(); return;
      }
      if (action === 'toggle-all') {
        var d2 = load();
        var allDone = d2.tasks.every(function (x) { return !!x.completedAt; });
        var now2 = Date.now();
        d2.tasks.forEach(function (x) {
          if (!allDone && !x.completedAt) { x.completedAt = now2; awardXP(x); }
          else if (allDone) { x.completedAt = null; x.xpAwarded = false; }
        });
        if (!allDone) { updateStreak(d2); bumpHeatmap(d2); }
        save(d2); dispatchUpdate(); render(); return;
      }
      if (action === 'delete' && id) {
        if (_pomodoroTaskId === id) stopPomodoro(false);
        var d3 = load(); d3.tasks = d3.tasks.filter(function (x) { return x.id !== id; });
        save(d3); dispatchUpdate(); render(); return;
      }
      if (action === 'export-csv') {
        exportCSV(load()); return;
      }
      if (action === 'start-edit' && id) {
        if (e.target.classList.contains('dlt-task-text') && e.detail < 2) return;
        startEdit(id); return;
      }
      if (action === 'pomo-start' && id) {
        if (_pomodoroTaskId === id) {
          // toggle pause/resume
          _pomodoroRunning ? pausePomodoro() : resumePomodoro();
        } else {
          startPomodoro(id);
        }
        render(); return;
      }
      if (action === 'pomo-toggle' && id) {
        _pomodoroRunning ? pausePomodoro() : resumePomodoro();
        render(); return;
      }
      if (action === 'pomo-stop' && id) {
        stopPomodoro(false); render(); return;
      }
      if (action === 'toggle-archive') {
        var body = document.getElementById('dlt-archive-body');
        var chev = document.getElementById('dlt-arc-chev');
        if (!body) return;
        var isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        if (chev) chev.classList.toggle('open', !isOpen);
        return;
      }
    });

    el.addEventListener('dblclick', function (e) {
      var t = e.target.closest ? e.target.closest('[data-action="start-edit"]') : null;
      if (t) { e.preventDefault(); startEdit(t.getAttribute('data-id')); }
    });

    /* drag-to-reorder */
    wireDrag(el);
  }

  /* ── per-render input wiring ── */
  function wireInputEvents(el) {
    var input = document.getElementById('dlt-input');
    var addBtn = document.getElementById('dlt-add');
    if (!input || !addBtn) return;
    input.addEventListener('input', function () {
      addBtn.disabled = input.value.trim().length === 0;
      var d0 = load(), total = d0.tasks.length, done = d0.tasks.filter(function (t) { return !!t.completedAt; }).length;
      var grade = gradeColor(total > 0 ? done / total : 0);
      if (input.value.trim()) { input.style.borderColor = grade.border; input.style.boxShadow = '0 0 0 3px ' + grade.glow; }
      else { input.style.borderColor = ''; input.style.boxShadow = ''; }
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  { e.preventDefault(); doAdd(input); }
      if (e.key === 'Escape') { input.value = ''; input.style.borderColor = ''; input.style.boxShadow = ''; addBtn.disabled = true; }
    });
    addBtn.addEventListener('click', function () { doAdd(input); });
  }

  /* ── drag-to-reorder ── */
  function wireDrag(el) {
    var dragId = null, dragEl = null, ghostEl = null, overEl = null;

    function getTaskEl(e) {
      var h = e.target.closest ? e.target.closest('[data-action="drag-handle"]') : null;
      return h ? h.closest('[data-task-id]') : null;
    }
    function cleanup() {
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      if (dragEl) dragEl.classList.remove('dlt-drag-ghost');
      if (overEl) overEl.style.marginTop = '';
      dragId = null; dragEl = null; overEl = null;
    }

    el.addEventListener('mousedown', function (e) {
      var row = getTaskEl(e);
      if (!row) return;
      e.preventDefault();
      dragId = row.getAttribute('data-task-id');
      dragEl = row;
      dragEl.classList.add('dlt-drag-ghost');
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragId) return;
      var list = document.getElementById('dlt-list');
      if (!list) return;
      var rows = Array.prototype.slice.call(list.querySelectorAll('[data-task-id]:not(.is-done)'));
      var newOver = null;
      rows.forEach(function (r) {
        var rect = r.getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        if (e.clientY < mid && r.getAttribute('data-task-id') !== dragId) newOver = r;
      });
      if (overEl && overEl !== newOver) overEl.style.marginTop = '';
      overEl = newOver;
      if (overEl) overEl.style.marginTop = '1.5rem';
    });

    document.addEventListener('mouseup', function (e) {
      if (!dragId) return;
      var list = document.getElementById('dlt-list');
      if (list && overEl) {
        var targetId = overEl.getAttribute('data-task-id');
        var d = load();
        var fromIdx = d.tasks.findIndex(function (t) { return t.id === dragId; });
        var toIdx   = d.tasks.findIndex(function (t) { return t.id === targetId; });
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          var moved = d.tasks.splice(fromIdx, 1)[0];
          d.tasks.splice(toIdx, 0, moved);
          // rebuild order values
          d.tasks.forEach(function (t, i) { t.order = i; });
          save(d);
        }
      }
      cleanup(); render();
    });
  }

  /* ── pomodoro ── */
  function startPomodoro(id) {
    if (_pomodoroInterval) clearInterval(_pomodoroInterval);
    _pomodoroTaskId  = id;
    _pomodoroSecsLeft = POMODORO_SECS;
    _pomodoroRunning  = true;
    _pomodoroInterval = setInterval(tickPomodoro, 1000);
    getUtils();
    if (U.showToast) U.showToast('🍅 25-min focus started!', 'success');
  }
  function pausePomodoro()  { _pomodoroRunning = false; clearInterval(_pomodoroInterval); _pomodoroInterval = null; }
  function resumePomodoro() { _pomodoroRunning = true; _pomodoroInterval = setInterval(tickPomodoro, 1000); }
  function stopPomodoro(completed) {
    clearInterval(_pomodoroInterval); _pomodoroInterval = null;
    if (completed && _pomodoroTaskId) {
      var d = load();
      var task = d.tasks.find(function (t) { return t.id === _pomodoroTaskId; });
      if (task) { task.pomodoroCount = (task.pomodoroCount || 0) + 1; save(d); }
      awardPomodoroXP();
      getUtils();
      if (U.showToast) U.showToast('🍅 Pomodoro complete! +25 XP 🎉', 'success');
    }
    _pomodoroTaskId  = null;
    _pomodoroRunning  = false;
    _pomodoroSecsLeft = POMODORO_SECS;
  }
  function tickPomodoro() {
    if (!_pomodoroRunning) return;
    _pomodoroSecsLeft--;
    if (_pomodoroSecsLeft <= 0) {
      stopPomodoro(true);
      render(); return;
    }
    // update just the timer chip text without full re-render
    var chip = document.querySelector('.dlt-pomo-time');
    if (chip) chip.textContent = fmtSecs(_pomodoroSecsLeft);
  }

  /* ── inline edit ── */
  function startEdit(id) {
    var taskEl = document.querySelector('[data-task-id="' + id + '"]');
    if (!taskEl) return;
    var textEl = taskEl.querySelector('.dlt-task-text');
    if (!textEl) return;
    var orig = textEl.textContent;
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'dlt-task-edit'; inp.value = orig; inp.maxLength = 200;
    textEl.replaceWith(inp); inp.focus(); inp.select();
    function commit() {
      var nv = inp.value.trim();
      if (nv && nv !== orig) {
        var d = load(); var task = d.tasks.find(function (x) { return x.id === id; });
        if (task) { task.text = nv; save(d); }
      }
      render();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') render(); });
    inp.addEventListener('blur', commit);
  }

  /* ── add task ── */
  function doAdd(input) {
    if (!input) return;
    var text = input.value.trim(); if (!text) return;
    getUtils();
    var fresh = load();
    if (fresh.tasks.length >= MAX_TASKS) {
      if (U.showToast) U.showToast('Max ' + MAX_TASKS + ' tasks per day.', 'danger'); return;
    }
    fresh.tasks.push({ id: uid(), text: text, createdAt: Date.now(), completedAt: null,
      priority: _selectedPriority, note: '', xpAwarded: false,
      tag: _selectedTag, pomodoroCount: 0, order: Date.now() });
    save(fresh);
    input.value = ''; input.style.borderColor = ''; input.style.boxShadow = '';
    var addBtn = document.getElementById('dlt-add'); if (addBtn) addBtn.disabled = true;
    dispatchUpdate(); render();
  }

  function dispatchUpdate() {
    try { window.dispatchEvent(new CustomEvent('arise:career-updated')); } catch (e) {}
  }

  /* ── global shortcut ── */
  function handleGlobalKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      var inp = document.getElementById('dlt-input');
      if (inp) { e.preventDefault(); inp.focus(); inp.select(); }
    }
  }

  /* ── periodic refresh ── */
  function startTimer() {
    if (_renderTimer) return;
    _renderTimer = setInterval(function () {
      if (!document.hidden && document.getElementById(MOUNT_ID) && !_pomodoroRunning) render();
    }, 60 * 1000);
  }

  /* ── public API ── */
  window.__ARISE_DAILY_LEARNING_TASKS_API__ = {
    load: load, save: save, runExpiry: runExpiry, render: render,
    KEY: KEY, sortTasks: sortTasks, PRIORITIES: PRIORITIES, TAGS: TAGS,
    startPomodoro: startPomodoro, stopPomodoro: stopPomodoro,
    exportCSV: exportCSV,
    resetFilter: function () { _filterTag = "All"; },
    getFilterTag: function () { return _filterTag; },
  };

  /* ── boot ── */
  function boot() {
    injectStyles(); getUtils();
    if (U.bootUpdater && window.__ARISE_MUTATION_BUS__) {
      U.bootUpdater(render);
    } else {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
      else render();
      window.addEventListener('storage', function (e) { if (!e.key || e.key === KEY) render(); });
    }
    document.addEventListener('keydown', handleGlobalKey);
    startTimer();
  }
  boot();
})();
