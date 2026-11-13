/* ==========================================================================
   Notification center (src/notification-center.js)
   --------------------------------------------------------------------------
   Feature widgets already compute their own deadlines and some raise native
   notifications, but there was no single place to see "what needs me today".
   This module aggregates ONLY records that already exist — it never invents an
   event, never writes to a feature store and never claims push delivery.

   Sources (read-only)
   -------------------
   arise_exam_tracker_v1   exams + exam dates (+ cse-syllabus-exam-dates-v1 overrides)
   hackathonPipelineV1     registration deadlines
   arise_placement_tracker_v1  interviews / deadlines on applications
   arise-daily-learning-tasks-v1 / tasks  open tasks with a due date
   dsaRevisionSRS, devRevisionSRS          cards due for revision
   cse-syllabus-progress-v1               nothing (used only for context)

   Read state lives in its own key (arise-notification-read-v1): a map of
   item id -> ISO timestamp. Marking read never mutates the source store, and an
   item that is dismissed but later becomes due again is a NEW id, so it returns.

   Public API (window.AriseNotifications)
   --------------------------------------
   list({ now, withinDays })  -> [{ id, kind, title, detail, due, tone, route, source, read }]
   unreadCount()              -> number
   markRead(id) / markAllRead()
   open() / close()
   refresh()
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseNotifications) return;

  var READ_KEY = "arise-notification-read-v1";
  var MAX_PER_SOURCE = 25;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function readState() {
    var raw = readJSON(READ_KEY, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    var out = {};
    Object.keys(raw).forEach(function (key) {
      if (typeof raw[key] === "string") out[key] = raw[key];
    });
    return out;
  }

  function writeState(state) {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  var DAY = 86400000;

  function toUTC(dayKey) {
    if (!dayKey) return null;
    var parts = String(dayKey).slice(0, 10).split("-");
    if (parts.length !== 3) return null;
    var y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!y || !m || !d) return null;
    var stamp = Date.UTC(y, m - 1, d);
    return Number.isFinite(stamp) ? stamp : null;
  }

  function normalize(dateLike) {
    if (dateLike == null || dateLike === "") return null;
    if (typeof dateLike === "number") return Number.isFinite(dateLike) ? dateLike : null;
    var text = String(dateLike).trim();
    var utcDay = toUTC(text);
    if (utcDay !== null) return utcDay;
    var parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function daysBetween(fromStamp, toStamp) {
    return Math.round((toStamp - fromStamp) / DAY);
  }

  function toneFor(days) {
    if (days < 0) return "overdue";
    if (days === 0) return "today";
    if (days <= 3) return "soon";
    return "later";
  }

  function item(fields) {
    return {
      id: String(fields.id),
      kind: fields.kind,
      title: String(fields.title || "Untitled"),
      detail: String(fields.detail || ""),
      due: fields.due,
      days: fields.days,
      tone: fields.tone,
      route: fields.route,
      source: fields.source,
      read: false
    };
  }

  function examDateFor(exam, overrides) {
    var id = exam && (exam.id || exam.subjectId);
    if (id && overrides && typeof overrides === "object") {
      var override = overrides[id] || (exam.subjectId && overrides[exam.subjectId]);
      if (override) return override;
    }
    return exam && (exam.examDate || exam.date);
  }

  function collect(now) {
    var out = [];
    var today = new Date(now);
    var dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

    /* ------------------------------------------------------------- exams -- */
    var examStore = readJSON("arise_exam_tracker_v1", null);
    var overrides = readJSON("cse-syllabus-exam-dates-v1", {});
    var exams = examStore && Array.isArray(examStore.exams) ? examStore.exams : [];
    exams.slice(0, MAX_PER_SOURCE).forEach(function (exam) {
      if (!exam) return;
      var stamp = normalize(examDateFor(exam, overrides));
      if (stamp === null) return;
      var days = daysBetween(dayStart, stamp);
      // A passed exam is not actionable; the tracker shows its own history.
      if (days < 0 || days > 30) return;
      out.push(item({
        id: "exam:" + (exam.id || exam.title || exam.examName) + ":" + days,
        kind: "Exam",
        title: exam.examName || exam.title || "Exam",
        detail: [exam.subjectName, exam.examType, days < 0 ? "date passed" : days === 0 ? "is today" : "in " + days + " day" + (days === 1 ? "" : "s")].filter(Boolean).join(" · "),
        due: stamp,
        days: days,
        tone: toneFor(days),
        route: "exam-tracker",
        source: "Exam Tracker"
      }));
    });

    /* -------------------------------------------------------- hackathons -- */
    var pipeline = readJSON("hackathonPipelineV1", []);
    (Array.isArray(pipeline) ? pipeline : []).slice(0, MAX_PER_SOURCE).forEach(function (entry) {
      if (!entry) return;
      var stamp = normalize(entry.registrationDeadline || entry.deadline || entry.regDeadline);
      if (stamp === null) return;
      var days = daysBetween(dayStart, stamp);
      if (days < 0 || days > 30) return;
      out.push(item({
        id: "hackathon:" + (entry.id || entry.name) + ":" + days,
        kind: "Deadline",
        title: entry.name || entry.event || "Hackathon",
        detail: [entry.status, days === 0 ? "registration closes today" : days < 0 ? "registration closed" : "registration closes in " + days + " day" + (days === 1 ? "" : "s")].filter(Boolean).join(" · "),
        due: stamp,
        days: days,
        tone: toneFor(days),
        route: "hackathon-tracker",
        source: "Hackathon Pipeline"
      }));
    });

    /* --------------------------------------------------------- placement -- */
    var placement = readJSON("arise_placement_tracker_v1", null);
    var applications = placement && Array.isArray(placement.applications) ? placement.applications : [];
    applications.slice(0, MAX_PER_SOURCE).forEach(function (app) {
      if (!app) return;
      var stamp = normalize(app.interviewDate || app.deadline || app.nextRoundDate);
      if (stamp === null) return;
      var days = daysBetween(dayStart, stamp);
      if (days < 0 || days > 21) return;
      out.push(item({
        id: "placement:" + (app.id || app.company) + ":" + days,
        kind: "Interview",
        title: [app.company, app.role].filter(Boolean).join(" · ") || "Application",
        detail: [app.status, app.interviewMode, days === 0 ? "is today" : days < 0 ? "has passed" : "in " + days + " day" + (days === 1 ? "" : "s")].filter(Boolean).join(" · "),
        due: stamp,
        days: days,
        tone: toneFor(days),
        route: "placement-tracker",
        source: "Placement Tracker"
      }));
    });

    /* ------------------------------------------------------------- tasks -- */
    var taskStores = [
      { key: "arise-daily-learning-tasks-v1", route: "learning", source: "Daily tasks" },
      { key: "tasks", route: "learning", source: "Tasks" }
    ];
    taskStores.forEach(function (store) {
      var rows = readJSON(store.key, []);
      if (rows && !Array.isArray(rows) && Array.isArray(rows.tasks)) rows = rows.tasks;
      (Array.isArray(rows) ? rows : []).slice(0, MAX_PER_SOURCE).forEach(function (task) {
        if (!task || task.completed || task.done) return;
        var stamp = normalize(task.dueDate || task.due || task.date);
        if (stamp === null) return;
        var days = daysBetween(dayStart, stamp);
        if (days < -1 || days > 7) return;
        out.push(item({
          id: "task:" + store.key + ":" + (task.id || task.title) + ":" + days,
          kind: "Task",
          title: task.title || task.text || "Open task",
          detail: [task.priority, days === 0 ? "due today" : days < 0 ? "overdue" : "due in " + days + " day" + (days === 1 ? "" : "s")].filter(Boolean).join(" · "),
          due: stamp,
          days: days,
          tone: toneFor(days),
          route: store.route,
          source: store.source
        }));
      });
    });

    /* --------------------------------------------------------- revisions -- */
    [
      { key: "dsaRevisionSRS", label: "DSA revision", route: "dsa" },
      { key: "devRevisionSRS", label: "Development revision", route: "dev" }
    ].forEach(function (store) {
      var data = readJSON(store.key, null);
      if (!data || typeof data !== "object") return;
      var count = 0;
      Object.keys(data).forEach(function (id) {
        if (count >= MAX_PER_SOURCE) return;
        var card = data[id];
        var stamp = normalize(card && (card.due || card.nextReview || card.dueAt));
        if (stamp === null) return;
        var days = daysBetween(dayStart, stamp);
        if (days > 0) return; // revision is only "due" once the date arrives
        count += 1;
        out.push(item({
          id: "revision:" + store.key + ":" + id + ":" + Math.max(days, -1),
          kind: "Revision",
          title: (card && (card.title || card.name || card.question)) || "Revision card",
          detail: [store.label, days === 0 ? "due today" : "overdue by " + Math.abs(days) + " day" + (days === -1 ? "" : "s")].join(" · "),
          due: stamp,
          days: days,
          tone: days < 0 ? "overdue" : "today",
          route: store.route,
          source: "Spaced repetition"
        }));
      });
    });

    return out;
  }

  var cache = null;
  function compute(options) {
    var opts = options || {};
    var now = typeof opts.now === "number" ? opts.now : Date.now();
    var withinDays = typeof opts.withinDays === "number" ? opts.withinDays : 30;
    var read = readState();
    var items = collect(now).filter(function (entry) {
      return entry.days <= withinDays;
    }).map(function (entry) {
      entry.read = !!read[entry.id];
      return entry;
    });
    items.sort(function (a, b) {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return a.due - b.due;
    });
    cache = items;
    return items;
  }

  function list(options) {
    return compute(options);
  }

  function unreadCount(options) {
    return compute(options).filter(function (entry) { return !entry.read; }).length;
  }

  function markRead(id) {
    if (!id) return false;
    var state = readState();
    state[String(id)] = new Date().toISOString();
    var saved = writeState(state);
    render();
    return saved;
  }

  function markAllRead() {
    var state = readState();
    var stamp = new Date().toISOString();
    compute().forEach(function (entry) { state[entry.id] = stamp; });
    var saved = writeState(state);
    render();
    return saved;
  }

  function refresh() {
    compute();
    render();
    updateBadge();
    return cache;
  }

  /* ------------------------------------------------------------------- UI -- */

  function host() {
    return document.getElementById("anc-panel");
  }

  var TONE_LABEL = { overdue: "Overdue", today: "Today", soon: "Soon", later: "Upcoming" };

  function renderRows(items) {
    if (!items.length) {
      return '<p class="anc-empty">Nothing needs you in the next 30 days. Exams, hackathon deadlines, interviews, dated tasks and due revision cards all appear here automatically.</p>';
    }
    var groups = { overdue: [], today: [], soon: [], later: [] };
    items.forEach(function (entry) {
      var bucket = groups[entry.tone] ? entry.tone : "later";
      groups[bucket].push(entry);
    });
    var html = "";
    ["overdue", "today", "soon", "later"].forEach(function (tone) {
      if (!groups[tone].length) return;
      html += '<div class="anc-group-title" role="presentation">' + TONE_LABEL[tone] + " (" + groups[tone].length + ")</div>";
      groups[tone].forEach(function (entry) {
        html += '<div class="anc-item" data-anc-id="' + esc(entry.id) + '" data-tone="' + esc(entry.tone) + '" data-read="' + (entry.read ? "true" : "false") + '">' +
          '<div class="anc-item-main">' +
          '<span class="anc-kind">' + esc(entry.kind) + "</span>" +
          '<span class="anc-title">' + esc(entry.title) + "</span>" +
          '<span class="anc-detail">' + esc(entry.detail) + "</span>" +
          '<span class="anc-source">' + esc(entry.source) + "</span>" +
          "</div>" +
          '<div class="anc-item-actions">' +
          '<button type="button" class="anc-btn" data-anc-action="open" data-route="' + esc(entry.route) + '" aria-label="Open ' + esc(entry.title) + ' in ' + esc(entry.source) + '">Open</button>' +
          '<button type="button" class="anc-btn" data-anc-action="read" aria-pressed="' + (entry.read ? "true" : "false") + '" aria-label="' + (entry.read ? "Mark unread: " : "Mark as read: ") + esc(entry.title) + '">' + (entry.read ? "Unread" : "Read") + "</button>" +
          "</div></div>";
      });
    });
    return html;
  }

  function runMuted(fn) {
    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.mute === "function") return bus.mute(fn);
    return fn();
  }

  function render() {
    var panel = host();
    if (!panel) return;
    var items = compute();
    var body = panel.querySelector(".anc-list");
    if (body) {
      var nextHtml = renderRows(items);
      if (body.innerHTML !== nextHtml) runMuted(function () { body.innerHTML = nextHtml; });
    }
    var unread = items.filter(function (entry) { return !entry.read; }).length;
    var status = panel.querySelector(".anc-status");
    var nextStatus = unread + " unread · " + items.length + " tracked";
    if (status && status.textContent !== nextStatus) runMuted(function () { status.textContent = nextStatus; });
    updateBadge();
  }

  function updateBadge() {
    var badge = document.getElementById("anc-badge");
    if (!badge) return;
    var count = unreadCount();
    var nextText = count > 9 ? "9+" : String(count);
    var nextHidden = count === 0;
    if (badge.textContent === nextText && badge.hidden === nextHidden) return;
    runMuted(function () {
      if (badge.textContent !== nextText) badge.textContent = nextText;
      if (badge.hidden !== nextHidden) badge.hidden = nextHidden;
    });
  }

  function ensureLauncher() {
    if (document.getElementById("anc-launcher")) return;
    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "anc-launcher";
    launcher.className = "anc-launcher";
    launcher.setAttribute("aria-label", "Open notifications");
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.innerHTML = '<span aria-hidden="true">🔔</span><span id="anc-badge" class="anc-badge" hidden>0</span>';
    launcher.addEventListener("click", open);
    document.body.appendChild(launcher);
    updateBadge();
  }

  function open() {
    var panel = host();
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "anc-panel";
      panel.className = "anc-overlay";
      panel.setAttribute("data-open", "false");
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML =
        '<div class="anc-dialog" role="dialog" aria-modal="true" aria-labelledby="anc-title">' +
        '<div class="anc-head"><div><h2 id="anc-title">Notifications</h2>' +
        '<p class="anc-status" role="status"></p></div>' +
        '<button type="button" class="anc-btn anc-close" data-anc-action="close" aria-label="Close notifications">✕</button></div>' +
        '<p class="anc-hint">Aggregated from your own exam, hackathon, placement, task and revision records. Nothing is pushed or invented; hiding an item only clears its unread marker.</p>' +
        '<div class="anc-list"></div>' +
        '<div class="anc-foot"><button type="button" class="anc-btn" data-anc-action="mark-all">Mark all as read</button>' +
        '<button type="button" class="anc-btn anc-primary" data-anc-action="close">Done</button></div></div>';
      panel.addEventListener("click", onPanelClick);
      document.body.appendChild(panel);
    }
    panel.__previous = document.activeElement;
    panel.setAttribute("data-open", "true");
    panel.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeydown, true);
    render();
    var closeBtn = panel.querySelector(".anc-close");
    if (closeBtn) closeBtn.focus();
    return true;
  }

  function close() {
    var panel = host();
    if (!panel || panel.getAttribute("data-open") !== "true") return false;
    document.removeEventListener("keydown", onKeydown, true);
    panel.setAttribute("data-open", "false");
    panel.setAttribute("aria-hidden", "true");
    var previous = panel.__previous;
    if (previous && typeof previous.focus === "function" && previous.isConnected) {
      try { previous.focus({ preventScroll: true }); } catch { previous.focus(); }
    }
    return true;
  }

  function visible(el) {
    if (!el || el.disabled) return false;
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      if (node !== el && node.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  }

  function onKeydown(event) {
    var panel = host();
    if (!panel || panel.getAttribute("data-open") !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    var dialog = panel.querySelector(".anc-dialog");
    var focusable = dialog ? Array.prototype.slice.call(dialog.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")).filter(visible) : [];
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function navigate(route) {
    if (!route) return;
    var label = {
      "exam-tracker": "Exam Tracker",
      "hackathon-tracker": "Hackathon Tracker",
      "placement-tracker": "Placement Tracker",
      learning: "Learning",
      dsa: "DSA Tracker",
      dev: "Development"
    }[route];
    var buttons = Array.prototype.slice.call(document.querySelectorAll("#arise-desktop-nav button, #arise-mobile-nav button, aside button"));
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || "").replace(/\s+/g, " ").trim();
      if (label && (text === label || text.indexOf(label) !== -1)) {
        buttons[i].click();
        return true;
      }
    }
    return false;
  }

  function onPanelClick(event) {
    var control = event.target.closest ? event.target.closest("[data-anc-action]") : null;
    if (!control) return;
    var action = control.getAttribute("data-anc-action");
    if (action === "close") return void close();
    if (action === "mark-all") return void markAllRead();
    var row = control.closest(".anc-item");
    var id = row && row.getAttribute("data-anc-id");
    if (!id) return;
    if (action === "read") {
      markRead(id);
      return;
    }
    if (action === "open") {
      markRead(id);
      navigate(control.getAttribute("data-route"));
      close();
    }
  }

  /* ------------------------------------------------------------ lifecycle -- */

  var scheduled = 0;
  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = 1;
    setTimeout(function () {
      scheduled = 0;
      refresh();
    }, 250);
  }

  function boot() {
    if (!document.body) return;
    ensureLauncher();
    refresh();
    window.addEventListener("storage", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleRefresh();
    });
    // Re-derive when a widget mounts into the page (it may have loaded records
    // from the cloud after first paint). Debounced, so a busy render pass costs
    // one recomputation, and the launcher itself is not a source of churn.
    function onMutations(records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t && (t.id === "anc-launcher" || t.id === "anc-panel" || t.id === "anc-badge" || (t.closest && (t.closest("#anc-launcher") || t.closest("#anc-panel"))))) continue;
        var added = records[i].addedNodes || [];
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.id === "anc-launcher" || node.id === "anc-panel") continue;
          scheduleRefresh();
          return;
        }
      }
    }
    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.subscribe === "function") {
      bus.subscribe(onMutations);
    } else if (typeof MutationObserver === "function") {
      var observer = new MutationObserver(onMutations);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    scheduleRefresh();
  }

  window.AriseNotifications = {
    storageKey: READ_KEY,
    list: list,
    unreadCount: unreadCount,
    markRead: markRead,
    markAllRead: markAllRead,
    refresh: refresh,
    open: open,
    close: close
  };

  // The loader injects this module after the body exists, so create the
  // launcher immediately; the DOMContentLoaded listener is only a safety net
  // for a script tag placed in <head>.
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
