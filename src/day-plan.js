/* ==========================================================================
   Day plan (src/day-plan.js)
   --------------------------------------------------------------------------
   Daily Tasks already stores a real per-day task list (arise-daily-learning-
   tasks-v1: tasks + archive + heatmap), and the DSA Daily Goal widget already
   tracks a target and per-problem `dateSolved`. What was missing was a single
   answer to "what is on me today?" — the dashboard showed "Study Today" and
   nothing else, the task list lives on the Learning route, and finished days
   were archived without ever being summarised.

   This module composes those existing stores into today's plan. It is not a
   second task manager: it never creates, renames, reorders or completes a
   task, and it never writes a task store. The only persisted value is its own
   UI flag.

   Public API (window.AriseDayPlan)
   --------------------------------
   today({ now })      -> { key, tasks, done, total, percent, dsa, study, next, isNewDay }
   week({ now })       -> [{ key, done, total, archived }] for the last 7 days
   tasksFor(key)       -> the same task shape for an archived day
   mount() / unmount() -> the dashboard "Today" card
   refresh()
   storageKey          -> "arise-day-plan-v1"
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseDayPlan) return;

  var TASK_KEY = "arise-daily-learning-tasks-v1";
  var DSA_KEY = "dsaQuestions";
  var DSA_GOAL_KEY = "dsaDailyGoal";
  var UI_KEY = "arise-day-plan-v1";
  var DAY_MS = 86400000;
  var MAX_TASKS = 40;
  var PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(value) { return (value < 10 ? "0" : "") + value; }

  // Local calendar day, never UTC: a task added at 01:00 IST belongs to today.
  function keyOf(value) {
    var d = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function list(value) { return Array.isArray(value) ? value : []; }

  function normaliseTask(task) {
    if (!task || typeof task !== "object" || !task.id || !task.text) return null;
    return {
      id: String(task.id),
      text: String(task.text),
      done: !!task.completedAt,
      completedAt: task.completedAt || null,
      priority: PRIORITY_RANK.hasOwnProperty(task.priority) ? task.priority : "medium",
      tag: typeof task.tag === "string" && task.tag ? task.tag : "Other",
      note: typeof task.note === "string" ? task.note.slice(0, 120) : "",
      pomodoros: Math.max(0, parseInt(task.pomodoroCount, 10) || 0)
    };
  }

  function sortTasks(tasks) {
    return tasks.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.text.localeCompare(b.text);
    });
  }

  function store() { return read(TASK_KEY) || {}; }

  function tasksOfStore(data) {
    return sortTasks(list(data && data.tasks).map(normaliseTask).filter(Boolean)).slice(0, MAX_TASKS);
  }

  function dsaToday(now) {
    var today = keyOf(now);
    var questions = list(read(DSA_KEY));
    var solved = 0;
    questions.forEach(function (question) {
      if (!question || !question.solved) return;
      var stamp = question.dateSolved || question.date;
      if (typeof stamp === "string" && stamp.slice(0, 10) === today) solved += 1;
    });
    var goal = Number((read(DSA_GOAL_KEY) || {}).target);
    var target = isFinite(goal) && goal > 0 ? Math.min(20, Math.round(goal)) : 2;
    return { solved: solved, target: target, met: solved >= target, remaining: Math.max(0, target - solved) };
  }

  function studyToday(now) {
    // Prefer the shared analytics maths so this card can never disagree with
    // the Analytics page about how many minutes today held.
    var analytics = window.AriseAnalytics;
    if (analytics && typeof analytics.summarise === "function") {
      try {
        var summary = analytics.summarise({ days: 1, now: now });
        return { minutes: Math.round(summary.minutes), source: "analytics" };
      } catch {}
    }
    var sessions = list(read("focusSessionsV2"));
    var today = keyOf(now);
    var minutes = 0;
    sessions.forEach(function (session) {
      if (!session) return;
      var value = Number(session.minutes);
      if (!isFinite(value) || value <= 0) return;
      var stamp = session.endedAt || session.startedAt || session.date;
      if (stamp && keyOf(stamp) === today) minutes += value;
    });
    return { minutes: Math.round(minutes), source: "local" };
  }

  function pickNext(tasks, dsa, study) {
    var open = tasks.filter(function (task) { return !task.done; });
    if (open.length) {
      var top = open[0];
      return { kind: "task", label: top.text, reason: top.priority + " priority · " + top.tag };
    }
    if (!dsa.met) {
      return { kind: "dsa", label: "Solve " + dsa.remaining + " more DSA problem" + (dsa.remaining === 1 ? "" : "s"), reason: "today's goal is " + dsa.target };
    }
    if (study.minutes < 25) {
      return { kind: "study", label: "Log one focus session", reason: "no study time recorded today" };
    }
    return null;
  }

  function tasksFor(key) {
    var data = store();
    if (key === keyOf(Date.now())) return tasksOfStore(data);
    var archived = data && data.archive && data.archive[key];
    return sortTasks(list(archived).map(normaliseTask).filter(Boolean));
  }

  function today(options) {
    var now = (options && options.now) || Date.now();
    var key = keyOf(now);
    var data = store();
    var tasks = tasksOfStore(data);
    var done = tasks.filter(function (task) { return task.done; }).length;
    var dsa = dsaToday(now);
    var study = studyToday(now);
    var byTag = {};
    tasks.forEach(function (task) {
      byTag[task.tag] = byTag[task.tag] || { done: 0, total: 0 };
      byTag[task.tag].total += 1;
      if (task.done) byTag[task.tag].done += 1;
    });
    return {
      key: key,
      tasks: tasks,
      done: done,
      total: tasks.length,
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      byTag: byTag,
      dsa: dsa,
      study: study,
      next: pickNext(tasks, dsa, study),
      // The store keeps a single list for "now"; a stale list from an earlier
      // day is reported instead of silently looking like today's plan.
      isNewDay: !!data.streakDate && data.streakDate !== key,
      streak: Math.max(0, Number(data.streak) || 0),
      heatmapToday: Math.max(0, Number((data.heatmap || {})[key]) || 0)
    };
  }

  function week(options) {
    var now = (options && options.now) || Date.now();
    var data = store();
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var key = keyOf(now - i * DAY_MS);
      var live = i === 0 ? tasksOfStore(data) : [];
      var archived = sortTasks(list(data.archive && data.archive[key]).map(normaliseTask).filter(Boolean));
      var tasks = live.length ? live : archived;
      out.push({
        key: key,
        isToday: i === 0,
        done: tasks.filter(function (task) { return task.done; }).length,
        total: tasks.length,
        archived: archived.length,
        heat: Math.max(0, Number((data.heatmap || {})[key]) || 0)
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------- UI -- */

  var mounted = null;
  var lastFocus = null;

  function routeIsDashboard() {
    var main = document.getElementById("arise-main");
    var heading = main && main.querySelector("header h1");
    return !!heading && /dashboard/i.test(heading.textContent || "");
  }

  function stack() {
    var main = document.getElementById("arise-main");
    if (!main) return null;
    var found = main.querySelector(".space-y-6");
    if (found) return found;
    var routeState = main.querySelector(":scope > div.flex-1 > .arise-route-state");
    return routeState ? routeState.firstElementChild : null;
  }

  function minutesLabel(minutes) {
    var value = Number(minutes) || 0;
    if (!value) return "0m";
    if (value < 60) return Math.round(value) + "m";
    var hours = Math.floor(value / 60);
    var rest = Math.round(value - hours * 60);
    return rest ? hours + "h " + rest + "m" : hours + "h";
  }

  function rowHtml(task) {
    return '<li class="dp-task" data-done="' + (task.done ? "true" : "false") + '" data-priority="' + esc(task.priority) + '">' +
      '<span class="dp-check" aria-hidden="true">' + (task.done ? "✓" : "") + "</span>" +
      '<span class="dp-task-text">' + esc(task.text) + "</span>" +
      '<span class="dp-task-tag">' + esc(task.tag) + "</span></li>";
  }

  function cardHtml(plan, weekRows) {
    var list = plan.tasks.length
      ? '<ul class="dp-list">' + plan.tasks.slice(0, 6).map(rowHtml).join("") + "</ul>"
      : '<p class="dp-empty">Nothing planned yet. Add tasks in Learning → Daily Tasks; they show up here immediately.</p>';
    var more = plan.tasks.length > 6 ? '<p class="dp-more">+' + (plan.tasks.length - 6) + " more in Daily Tasks</p>" : "";
    var weekStrip = weekRows.map(function (row) {
      var label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(row.key + "T00:00:00").getDay()];
      var state = row.total === 0 ? "empty" : row.done === row.total ? "done" : "partial";
      return '<span class="dp-day" data-state="' + state + '" data-today="' + (row.isToday ? "true" : "false") +
        '" title="' + esc(row.key + " · " + row.done + "/" + row.total + " tasks") + '">' +
        '<span class="dp-day-label">' + label.slice(0, 1) + "</span>" +
        '<span class="dp-day-dot">' + (row.total ? row.done + "/" + row.total : "–") + "</span></span>";
    }).join("");

    var next = plan.next
      ? '<p class="dp-next"><span class="dp-next-kicker">Next</span>' + esc(plan.next.label) +
        '<span class="dp-next-reason">' + esc(plan.next.reason) + "</span></p>"
      : '<p class="dp-next" data-complete="true"><span class="dp-next-kicker">Done</span>Today\'s plan is clear — the study session and DSA goal are both logged.</p>';

    return '<div class="dp-head"><div><h2 class="dp-title" id="dp-title">Today</h2>' +
      '<p class="dp-sub">' + plan.done + " of " + plan.total + " tasks · " + plan.dsa.solved + "/" + plan.dsa.target + " DSA · " +
      minutesLabel(plan.study.minutes) + " studied" + (plan.streak ? " · " + plan.streak + "-day streak" : "") + "</p></div>" +
      '<div class="dp-ring" role="img" aria-label="' + esc(plan.percent + "% of today's tasks complete") + '" style="--dp-fill:' + plan.percent + '%">' +
      '<span class="dp-ring-value">' + plan.percent + "%</span></div></div>" +
      (plan.isNewDay ? '<p class="dp-notice">These tasks were written yesterday. Daily Tasks rolls them into yesterday\'s archive on its next visit.</p>' : "") +
      '<div class="dp-progress"><span class="dp-progress-fill" style="--dp-w:' + plan.percent + '%"></span></div>' +
      list + more + next +
      '<div class="dp-week" role="group" aria-label="Last seven days">' + weekStrip + "</div>" +
      '<div class="dp-actions"><button type="button" class="dp-btn" data-dp-action="open-tasks">Open Daily Tasks</button></div>';
  }

  function render() {
    if (!mounted) return;
    var body = mounted.querySelector(".dp-body");
    if (!body) return;
    body.innerHTML = cardHtml(today(), week());
  }

  function mount() {
    if (!routeIsDashboard()) return false;
    var host = stack();
    if (!host) return false;
    if (!mounted || !mounted.isConnected) {
      mounted = document.createElement("section");
      mounted.id = "dp-card";
      mounted.className = "glass-card rounded-2xl p-5 dp-card";
      mounted.setAttribute("aria-labelledby", "dp-title");
      mounted.innerHTML = '<div class="dp-body"></div>';
      mounted.addEventListener("click", onClick);
    }
    if (mounted.parentElement !== host) host.appendChild(mounted);
    render();
    return true;
  }

  function unmount() {
    if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);
  }

  function onClick(event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-dp-action]") : null;
    if (!button) return;
    if (button.getAttribute("data-dp-action") === "open-tasks") {
      // Daily Tasks only mounts on the Learning route; use the real navigation
      // instead of drawing a second task list here.
      var nav = document.getElementById("arise-desktop-nav") || document.getElementById("arise-mobile-nav");
      var target = null;
      if (nav) {
        target = Array.prototype.find.call(nav.querySelectorAll("button"), function (btn) {
          return /^Learning$/.test((btn.textContent || "").trim());
        }) || null;
      }
      if (target) { target.click(); return; }
      button.textContent = "Open Learning from the sidebar";
    }
  }

  function refresh() { render(); }

  window.AriseDayPlan = {
    today: today,
    week: week,
    tasksFor: tasksFor,
    mount: mount,
    unmount: unmount,
    refresh: refresh,
    keyOf: keyOf,
    storageKey: UI_KEY
  };

  /* --------------------------------------------------------------- boot -- */

  var scheduled = null;
  function tick() {
    try {
      if (routeIsDashboard()) mount();
      else if (mounted && mounted.isConnected) unmount();
    } catch {}
  }

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(function () { scheduled = null; tick(); }, 240);
  }

  function start() {
    tick();
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("storage", schedule);
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
