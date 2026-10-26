(function () {
  'use strict';
  if (window.__ARISE_DSA_STUDY_PLANNER__) return;
  window.__ARISE_DSA_STUDY_PLANNER__ = true;

  var KEY = 'dsaStudyPlanner-v1';
  var ROOT_ID = 'dsp-study-planner';
  var STYLE_ID = 'dsp-study-planner-style';
  var utils = window.__ARISE_WIDGET_UTILS__ || {};
  var formOpen = false;
  var editingId = '';
  var statusMessage = '';
  var DAYS = [
    { id: 1, label: 'Monday' }, { id: 2, label: 'Tuesday' }, { id: 3, label: 'Wednesday' },
    { id: 4, label: 'Thursday' }, { id: 5, label: 'Friday' }, { id: 6, label: 'Saturday' }, { id: 7, label: 'Sunday' }
  ];
  var FOCUSES = [
    { id: 'solve', label: 'Solve questions', tab: '' },
    { id: 'review', label: 'Spaced revision', tab: 'overview' },
    { id: 'pattern', label: 'Pattern practice', tab: 'playbook' },
    { id: 'mock', label: 'Timed mock', tab: 'mock' },
    { id: 'mistakes', label: 'Review mistake journal', tab: 'mistakes' }
  ];

  function localDate(date) {
    var value = date || new Date();
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }
  function validDate(value) {
    if (value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T12:00:00');
    return !isNaN(date.getTime()) && localDate(date) === value;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function read(key, fallback) {
    if (typeof utils.safeGet === 'function') return utils.safeGet(key, fallback);
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function write(value) {
    if (typeof utils.safeSet === 'function') return utils.safeSet(KEY, value, {
      quotaMessage: 'Storage is full — export a backup from Backup Center before saving your DSA plan.',
      errorMessage: 'Could not save the DSA study plan.'
    });
    try { localStorage.setItem(KEY, JSON.stringify(value)); return true; }
    catch (_) {
      if (utils.showToast) utils.showToast('Could not save the DSA study plan.', 'danger');
      return false;
    }
  }
  function makeId() {
    try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'dsa-session-' + window.crypto.randomUUID(); }
    catch (_) { /* Fall through for older browsers and test DOMs. */ }
    return 'dsa-session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function dayNumber(date) { return date.getDay() === 0 ? 7 : date.getDay(); }
  function mondayOf(date) {
    var monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  function dateOffset(date, days) {
    var result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + days);
    return result;
  }
  function dayLabel(number) {
    var match = DAYS.find(function (day) { return day.id === number; });
    return match ? match.label : 'Monday';
  }
  function focus(id) {
    var match = FOCUSES.find(function (item) { return item.id === id; });
    return match || FOCUSES[0];
  }
  function validTime(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
    return true;
  }
  function normalize(raw) {
    var source = raw && typeof raw === 'object' && Array.isArray(raw.sessions) ? raw.sessions : [];
    var seen = Object.create(null);
    var sessions = [];
    source.forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var id = String(item.id || '').trim().slice(0, 120);
      var weekday = Number(item.weekday);
      var minutes = Number(item.minutes);
      if (!id || seen[id] || !isFinite(weekday) || Math.floor(weekday) !== weekday || weekday < 1 || weekday > 7 || !validTime(item.startTime) || !isFinite(minutes)) return;
      minutes = Math.max(15, Math.min(240, Math.round(minutes / 15) * 15));
      var selectedFocus = focus(item.focus).id;
      seen[id] = true;
      sessions.push({
        id: id,
        weekday: weekday,
        startTime: item.startTime,
        minutes: minutes,
        focus: selectedFocus,
        topic: String(item.topic || '').trim().slice(0, 120)
      });
    });
    sessions.sort(function (left, right) { return left.weekday - right.weekday || left.startTime.localeCompare(right.startTime); });
    var completed = {};
    if (raw && raw.completed && typeof raw.completed === 'object' && !Array.isArray(raw.completed)) {
      Object.keys(raw.completed).forEach(function (date) {
        if (!validDate(date) || !raw.completed[date] || typeof raw.completed[date] !== 'object' || Array.isArray(raw.completed[date])) return;
        var dayEntries = {};
        Object.keys(raw.completed[date]).forEach(function (id) {
          if (raw.completed[date][id] === true) dayEntries[String(id).slice(0, 120)] = true;
        });
        if (Object.keys(dayEntries).length) completed[date] = dayEntries;
      });
    }
    return {
      schemaVersion: 1,
      examDate: raw && validDate(raw.examDate) ? String(raw.examDate) : '',
      lowAvailability: !!(raw && raw.lowAvailability),
      sessions: sessions,
      completed: completed
    };
  }
  function readPlan() { return normalize(read(KEY, { schemaVersion: 1, sessions: [], completed: {} })); }
  function effectiveMinutes(session, lowAvailability) { return lowAvailability ? Math.min(15, session.minutes) : session.minutes; }
  function examDays(examDate, today) {
    if (!validDate(examDate) || !examDate) return null;
    var base = new Date((today || localDate()) + 'T12:00:00');
    var exam = new Date(examDate + 'T12:00:00');
    if (isNaN(base.getTime()) || isNaN(exam.getTime())) return null;
    return Math.round((Date.UTC(exam.getFullYear(), exam.getMonth(), exam.getDate()) - Date.UTC(base.getFullYear(), base.getMonth(), base.getDate())) / 86400000);
  }
  function weekAgenda(plan, now) {
    var today = now || new Date();
    var start = mondayOf(today);
    var agenda = DAYS.map(function (day, index) {
      var date = dateOffset(start, index);
      var dateKey = localDate(date);
      var sessions = plan.sessions.filter(function (session) { return session.weekday === day.id; }).map(function (session) {
        return Object.assign({}, session, { date: dateKey, done: !!(plan.completed[dateKey] && plan.completed[dateKey][session.id]) });
      });
      return { weekday: day.id, label: day.label, date: date, dateKey: dateKey, sessions: sessions };
    });
    return agenda;
  }
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.dspn-block{display:flex;flex-direction:column;gap:.8rem;color:var(--text-primary,#f1f5ff)}',
      '.dspn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.75rem;flex-wrap:wrap}',
      '.dspn-title{margin:0;font-family:var(--font-display,inherit);font-size:1rem;font-weight:800;color:var(--text-primary,#f1f5ff)}',
      '.dspn-sub,.dspn-muted{margin:.2rem 0 0;font-size:.73rem;line-height:1.5;color:var(--text-secondary,#8b93b0)}',
      '.dspn-card{padding:.75rem;border:1px solid var(--border-soft,var(--border,rgba(255,255,255,.08)));border-radius:.85rem;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.03)))}',
      '.dspn-summary{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap;font-size:.7rem;color:var(--text-secondary,#8b93b0)}',
      '.dspn-chip{display:inline-flex;align-items:center;border:1px solid color-mix(in srgb,var(--info) 35%,transparent);border-radius:999px;padding:.16rem .48rem;color:var(--info,#38bdf8);font-size:.63rem;font-weight:700}',
      '.dspn-alert{padding:.6rem .7rem;border:1px solid color-mix(in srgb,var(--warning) 36%,transparent);border-radius:.75rem;background:color-mix(in srgb,var(--warning) 7%,transparent);color:var(--text-primary,#f1f5ff);font-size:.73rem;line-height:1.5}',
      '.dspn-alert[data-kind=exam]{border-color:color-mix(in srgb,var(--success) 38%,transparent);background:color-mix(in srgb,var(--success) 7%,transparent)}',
      '.dspn-settings{display:grid;grid-template-columns:minmax(160px,.75fr) minmax(220px,1fr) auto;gap:.6rem;align-items:end}',
      '.dspn-field{display:flex;flex-direction:column;gap:.25rem;min-width:0;font-size:.67rem;font-weight:650;color:var(--text-secondary,#a7aec4)}',
      '.dspn-control{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--border-soft,rgba(255,255,255,.12));border-radius:.6rem;padding:.46rem .55rem;background:var(--surface,var(--surface-soft,#151a25));color:var(--text-primary,#f1f5ff);font-family:inherit;font-size:.74rem;font-weight:400}',
      '.dspn-check{display:flex;align-items:center;gap:.42rem;min-height:2rem;font-size:.7rem;color:var(--text-secondary,#a7aec4)}',
      '.dspn-btn{border:1px solid var(--border-soft,rgba(255,255,255,.14));border-radius:.62rem;padding:.43rem .65rem;background:var(--surface-soft,rgba(255,255,255,.04));color:var(--text-primary,#f1f5ff);font-family:inherit;font-size:.7rem;font-weight:600;cursor:pointer}',
      '.dspn-btn:hover{border-color:color-mix(in srgb,var(--info) 55%,transparent);background:color-mix(in srgb,var(--info) 10%,transparent)}',
      '.dspn-btn:focus-visible,.dspn-control:focus-visible{outline:2px solid var(--info,#38bdf8);outline-offset:2px}',
      '.dspn-btn-primary{border-color:color-mix(in srgb,var(--info) 50%,transparent);background:color-mix(in srgb,var(--info) 14%,transparent)}',
      '.dspn-btn-danger{color:var(--danger,#ef4444)}',
      '.dspn-editor{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.55rem;padding:.75rem;border:1px solid var(--border-soft,rgba(255,255,255,.1));border-radius:.85rem;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.035)))}',
      '.dspn-editor-actions{grid-column:1/-1;display:flex;gap:.4rem;flex-wrap:wrap}',
      '.dspn-agenda{display:flex;flex-direction:column;gap:.55rem}',
      '.dspn-day{display:grid;grid-template-columns:minmax(105px,.32fr) 1fr;gap:.65rem;padding:.65rem;border:1px solid var(--border-soft,var(--border,rgba(255,255,255,.07)));border-radius:.8rem;background:var(--surface-soft,var(--surface-muted,rgba(255,255,255,.025)))}',
      '.dspn-day-today{border-color:color-mix(in srgb,var(--info) 48%,transparent);background:color-mix(in srgb,var(--info) 5%,transparent)}',
      '.dspn-day-title{font-size:.72rem;font-weight:750;color:var(--text-primary,#f1f5ff)}',
      '.dspn-day-date{display:block;margin-top:.12rem;font-size:.64rem;color:var(--text-secondary,#8b93b0)}',
      '.dspn-day-list{display:flex;flex-direction:column;gap:.4rem;min-width:0}',
      '.dspn-session{display:flex;align-items:center;justify-content:space-between;gap:.55rem;flex-wrap:wrap;padding:.48rem .55rem;border:1px solid var(--border-soft,rgba(255,255,255,.07));border-radius:.65rem;background:var(--surface,var(--surface-soft,rgba(0,0,0,.08)))}',
      '.dspn-session-done{opacity:.74}',
      '.dspn-session-main{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;min-width:0;flex:1}',
      '.dspn-time{font:700 .68rem var(--font-mono,monospace);color:var(--text-primary,#f1f5ff);white-space:nowrap}',
      '.dspn-session-name{font-size:.7rem;font-weight:700;color:var(--text-primary,#f1f5ff)}',
      '.dspn-session-meta{font-size:.64rem;color:var(--text-secondary,#8b93b0);overflow-wrap:anywhere}',
      '.dspn-session-actions{display:flex;gap:.3rem;flex-wrap:wrap}',
      '.dspn-empty{padding:.75rem;border:1px dashed var(--border-soft,rgba(255,255,255,.16));border-radius:.75rem;font-size:.73rem;line-height:1.5;color:var(--text-secondary,#8b93b0)}',
      '.dspn-status{min-height:1rem;font-size:.7rem;color:var(--success,#34d399)}',
      '[data-theme-mode=light] .dspn-title,[data-theme-mode=light] .dspn-day-title,[data-theme-mode=light] .dspn-time,[data-theme-mode=light] .dspn-session-name{color:var(--text-primary,#111827)}',
      '[data-theme-mode=light] .dspn-sub,[data-theme-mode=light] .dspn-muted,[data-theme-mode=light] .dspn-field,[data-theme-mode=light] .dspn-check,[data-theme-mode=light] .dspn-day-date,[data-theme-mode=light] .dspn-session-meta,[data-theme-mode=light] .dspn-empty{color:var(--text-secondary,#4b5563)}',
      '[data-theme-mode=light] .dspn-control,[data-theme-mode=light] .dspn-btn{color:var(--text-primary,#111827);background:var(--surface,#fff)}',
      '@media(max-width:700px){.dspn-settings{grid-template-columns:1fr 1fr}.dspn-settings .dspn-settings-save{grid-column:1/-1;justify-self:start}}',
      '@media(max-width:560px){.dspn-editor{grid-template-columns:1fr 1fr}.dspn-editor .dspn-field-topic{grid-column:1/-1}.dspn-day{grid-template-columns:1fr}.dspn-settings{grid-template-columns:1fr}.dspn-settings .dspn-settings-save{grid-column:auto}}'
    ].join('');
    document.head.appendChild(style);
  }
  function sessionForm(plan) {
    if (!formOpen) return '';
    var editing = plan.sessions.find(function (session) { return session.id === editingId; }) || null;
    var selectedDay = editing ? editing.weekday : dayNumber(new Date());
    var dayOptions = DAYS.map(function (day) { return '<option value="' + day.id + '"' + (day.id === selectedDay ? ' selected' : '') + '>' + day.label + '</option>'; }).join('');
    var focusOptions = FOCUSES.map(function (item) { return '<option value="' + escapeHtml(item.id) + '"' + (item.id === (editing ? editing.focus : 'solve') ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>'; }).join('');
    return '<form class="dspn-editor" data-plan-session-form>' +
      '<label class="dspn-field">Day<select class="dspn-control" data-plan-day>' + dayOptions + '</select></label>' +
      '<label class="dspn-field">Start time<input class="dspn-control" type="time" data-plan-time value="' + escapeHtml(editing ? editing.startTime : '18:00') + '" required></label>' +
      '<label class="dspn-field">Duration (minutes)<input class="dspn-control" type="number" data-plan-minutes min="15" max="240" step="15" value="' + (editing ? editing.minutes : 45) + '" required></label>' +
      '<label class="dspn-field">Session focus<select class="dspn-control" data-plan-focus>' + focusOptions + '</select></label>' +
      '<label class="dspn-field dspn-field-topic">Topic (optional)<input class="dspn-control" type="text" data-plan-topic maxlength="120" value="' + escapeHtml(editing ? editing.topic : '') + '" placeholder="e.g., Graphs or DP"></label>' +
      '<div class="dspn-editor-actions"><button class="dspn-btn dspn-btn-primary" type="submit">' + (editing ? 'Save session' : 'Add to weekly plan') + '</button><button class="dspn-btn" type="button" data-plan-cancel>Cancel</button></div>' +
      '</form>';
  }
  function examReminder(plan, today) {
    if (!plan.examDate) return '<div class="dspn-alert">Optional: add an exam date to show an in-app countdown. No browser notifications are sent.</div>';
    var left = examDays(plan.examDate, localDate(today));
    var dateText = escapeHtml(new Date(plan.examDate + 'T12:00:00').toLocaleDateString());
    if (left === 0) return '<div class="dspn-alert" data-kind="exam" role="status">Exam day — your selected date is today (' + dateText + '). This is an in-app reminder only.</div>';
    if (left > 0) return '<div class="dspn-alert" role="status">Exam date: ' + dateText + ' · ' + left + ' day' + (left === 1 ? '' : 's') + ' away. This is an in-app reminder only.</div>';
    return '<div class="dspn-alert" role="status">The exam date you selected (' + dateText + ') has passed. Update it if you are preparing for another date.</div>';
  }
  function sessionHtml(session, day, plan, todayKey, today) {
    var details = focus(session.focus);
    var minutes = effectiveMinutes(session, plan.lowAvailability);
    var completed = session.done;
    var future = day.dateKey > todayKey;
    var dateSuffix = plan.lowAvailability && session.minutes > 15 ? ' · 15-min low-availability block (saved plan: ' + session.minutes + 'm)' : ' · ' + session.minutes + 'm';
    var topic = session.topic ? ' · ' + escapeHtml(session.topic) : '';
    var link = details.tab ? '<button class="dspn-btn" type="button" data-plan-open-tab="' + escapeHtml(details.tab) + '">Open ' + escapeHtml(details.tab === 'overview' ? 'revision queue' : details.tab === 'playbook' ? 'Playbook' : details.tab === 'mock' ? 'Mock OA' : 'Mistakes') + '</button>' : '';
    return '<article class="dspn-session' + (completed ? ' dspn-session-done' : '') + '"><div class="dspn-session-main"><time class="dspn-time">' + escapeHtml(session.startTime) + '</time><span class="dspn-session-name">' + escapeHtml(details.label) + '</span><span class="dspn-session-meta">' + minutes + ' min' + dateSuffix + topic + '</span></div>' +
      '<div class="dspn-session-actions">' + link + '<button class="dspn-btn" type="button" data-plan-done="' + escapeHtml(session.id) + '" data-plan-date="' + escapeHtml(day.dateKey) + '" aria-pressed="' + String(completed) + '"' + (future ? ' disabled title="This session is scheduled for a future day."' : '') + '>' + (completed ? 'Done · undo' : 'Mark done') + '</button>' +
      '<button class="dspn-btn" type="button" data-plan-edit="' + escapeHtml(session.id) + '">Edit</button><button class="dspn-btn dspn-btn-danger" type="button" data-plan-delete="' + escapeHtml(session.id) + '">Remove</button></div></article>';
  }
  function renderAgenda(plan, today) {
    var agenda = weekAgenda(plan, today);
    var todayKey = localDate(today);
    var count = 0;
    var completed = 0;
    var minutes = 0;
    agenda.forEach(function (day) {
      day.sessions.forEach(function (session) {
        count++;
        if (session.done) completed++;
        minutes += effectiveMinutes(session, plan.lowAvailability);
      });
    });
    var summary = count ? '<div class="dspn-summary"><span class="dspn-chip">' + completed + ' / ' + count + ' sessions checked off this week</span><span>' + minutes + ' scheduled minutes' + (plan.lowAvailability ? ' in low-availability mode' : '') + '</span><span class="dspn-muted">Check-offs are self-reported; they are not a timer or an activity log.</span></div>' : '';
    var days = agenda.map(function (day) {
      var isToday = day.dateKey === todayKey;
      var daySessions = day.sessions.length ? day.sessions.map(function (session) { return sessionHtml(session, day, plan, todayKey, today); }).join('') : '<div class="dspn-muted">No session planned.</div>';
      return '<section class="dspn-day' + (isToday ? ' dspn-day-today' : '') + '" aria-label="' + escapeHtml(day.label + ' ' + day.dateKey) + '"><div class="dspn-day-title">' + (isToday ? 'Today · ' : '') + escapeHtml(day.label) + '<time class="dspn-day-date" datetime="' + escapeHtml(day.dateKey) + '">' + escapeHtml(day.date.toLocaleDateString()) + '</time></div><div class="dspn-day-list">' + daySessions + '</div></section>';
    }).join('');
    return summary + (count ? '<div class="dspn-agenda">' + days + '</div>' : '<div class="dspn-empty">No sessions in this weekly plan yet. Add the days, time blocks, and focus areas that fit your schedule. This planner does not create or change your general task list.</div>');
  }
  function render() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    ensureStyles();
    var plan = readPlan();
    var today = new Date();
    var editExists = plan.sessions.some(function (session) { return session.id === editingId; });
    if (editingId && !editExists) { editingId = ''; formOpen = false; }
    var markup = '<section class="dspn-block" aria-labelledby="dspn-title"><header class="dspn-head"><div><h3 class="dspn-title" id="dspn-title">DSA study plan</h3><p class="dspn-sub">Build a repeating weekly schedule with your own time blocks and focus. This complements the daily solve target and does not add tasks elsewhere.</p></div><button class="dspn-btn dspn-btn-primary" type="button" data-plan-new>＋ Add session</button></header>' +
      '<div class="dspn-status" role="status" aria-live="polite">' + escapeHtml(statusMessage) + '</div>' +
      '<div class="dspn-card"><form class="dspn-settings" data-plan-settings><label class="dspn-field">Exam date (optional)<input class="dspn-control" type="date" data-plan-exam value="' + escapeHtml(plan.examDate) + '"></label><label class="dspn-check"><input type="checkbox" data-plan-low' + (plan.lowAvailability ? ' checked' : '') + '> Low-availability mode · use up to 15 minutes per block</label><button class="dspn-btn dspn-settings-save" type="submit">Save plan settings</button></form></div>' +
      examReminder(plan, today) + sessionForm(plan) +
      '<div class="dspn-head"><div><h4 class="dspn-title">This week</h4><p class="dspn-sub">' + (plan.lowAvailability ? 'Short blocks are shown without changing your saved session durations.' : 'Your recurring sessions for the current Monday–Sunday week.') + '</p></div></div>' +
      '<div data-plan-agenda>' + renderAgenda(plan, today) + '</div></section>';
    if (root.__dspnMarkup !== markup) { root.__dspnMarkup = markup; root.innerHTML = markup; }
    if (!root.__dspnWired) {
      root.__dspnWired = true;
      root.addEventListener('click', onClick);
      root.addEventListener('submit', onSubmit);
    }
  }
  function onClick(event) {
    var target = event.target.closest && event.target.closest('[data-plan-new], [data-plan-cancel], [data-plan-edit], [data-plan-delete], [data-plan-done], [data-plan-open-tab]');
    if (!target) return;
    if (target.hasAttribute('data-plan-new')) { formOpen = true; editingId = ''; statusMessage = ''; render(); return; }
    if (target.hasAttribute('data-plan-cancel')) { formOpen = false; editingId = ''; statusMessage = ''; render(); return; }
    if (target.hasAttribute('data-plan-open-tab')) {
      var tabId = target.getAttribute('data-plan-open-tab');
      var tab = document.querySelector('#dmp-dsa-mastery-card [data-dmp-tab="' + tabId.replace(/[^a-z-]/g, '') + '"]');
      if (tab) tab.click();
      return;
    }
    var plan = readPlan();
    if (target.hasAttribute('data-plan-edit')) { editingId = target.getAttribute('data-plan-edit'); formOpen = true; statusMessage = ''; render(); return; }
    if (target.hasAttribute('data-plan-delete')) {
      var idToDelete = target.getAttribute('data-plan-delete');
      var session = plan.sessions.find(function (item) { return item.id === idToDelete; });
      if (!session || (typeof window.confirm === 'function' && !window.confirm('Remove this ' + focus(session.focus).label.toLowerCase() + ' session from your weekly plan? Past check-offs are kept.'))) return;
      plan.sessions = plan.sessions.filter(function (item) { return item.id !== idToDelete; });
      if (write(plan)) { if (editingId === idToDelete) { editingId = ''; formOpen = false; } statusMessage = 'Session removed from the weekly plan.'; render(); }
      return;
    }
    if (target.hasAttribute('data-plan-done')) {
      var date = target.getAttribute('data-plan-date');
      var sessionId = target.getAttribute('data-plan-done');
      if (!validDate(date) || date > localDate()) return;
      plan.completed[date] = plan.completed[date] || {};
      if (plan.completed[date][sessionId]) delete plan.completed[date][sessionId];
      else plan.completed[date][sessionId] = true;
      if (Object.keys(plan.completed[date]).length === 0) delete plan.completed[date];
      if (write(plan)) { statusMessage = 'Self-reported session check-off updated.'; render(); }
    }
  }
  function onSubmit(event) {
    if (event.target.matches('[data-plan-settings]')) {
      event.preventDefault();
      var plan = readPlan();
      var exam = event.target.querySelector('[data-plan-exam]').value;
      if (!validDate(exam)) { statusMessage = 'Choose a valid exam date or leave it blank.'; render(); return; }
      plan.examDate = exam;
      plan.lowAvailability = event.target.querySelector('[data-plan-low]').checked;
      if (write(plan)) { statusMessage = 'Plan settings saved.'; render(); }
      return;
    }
    if (!event.target.matches('[data-plan-session-form]')) return;
    event.preventDefault();
    var form = event.target;
    var weekday = Number(form.querySelector('[data-plan-day]').value);
    var startTime = form.querySelector('[data-plan-time]').value;
    var minutes = Number(form.querySelector('[data-plan-minutes]').value);
    if (weekday < 1 || weekday > 7 || !validTime(startTime) || !isFinite(minutes) || minutes < 15 || minutes > 240 || minutes % 15 !== 0) {
      statusMessage = 'Choose a day, a valid start time, and a duration from 15 to 240 minutes in 15-minute steps.';
      render();
      return;
    }
    var plan = readPlan();
    var previous = plan.sessions.find(function (session) { return session.id === editingId; }) || null;
    var session = {
      id: previous ? previous.id : makeId(),
      weekday: weekday,
      startTime: startTime,
      minutes: minutes,
      focus: focus(form.querySelector('[data-plan-focus]').value).id,
      topic: form.querySelector('[data-plan-topic]').value.trim().slice(0, 120)
    };
    if (previous) plan.sessions[plan.sessions.indexOf(previous)] = session;
    else plan.sessions.push(session);
    plan = normalize(plan);
    if (!write(plan)) return;
    formOpen = false; editingId = ''; statusMessage = previous ? 'Weekly session updated.' : 'Weekly session added.';
    render();
  }

  window.__ARISE_DSA_STUDY_PLANNER_API__ = {
    normalize: normalize,
    weekAgenda: weekAgenda,
    effectiveMinutes: effectiveMinutes,
    examDays: examDays,
    dayNumber: dayNumber
  };
  if (typeof utils.bootUpdater === 'function') utils.bootUpdater(render);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
