/* ==========================================================================
   Study horizon (src/study-horizon.js)
   --------------------------------------------------------------------------
   Exam dates, syllabus topic states, DSA backlog and daily study capacity all
   exist in separate widgets, and each of them plans only for itself. Nothing
   answered the question a student actually asks: "which of the next two weeks
   is going to be impossible, and why?"

   This module builds a fourteen-day horizon from those existing stores. Every
   day carries its drivers, so a "heavy" day can be traced to the exam that
   caused it and the topics still open. It writes nothing: the plan is a view,
   and the widgets that own the data remain the only writers.

   Public API (window.AriseHorizon)
   --------------------------------
   capacity({ now })    -> minutes/day inferred from recent sessions
   days({ now, days })  -> [{ key, load, minutesNeeded, capacity, drivers[] }]
   summary({ now })     -> { heaviest, overloaded, nextExam, totals }
   mount() / unmount()  -> the card on the Exam Tracker route
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseHorizon) return;

  var EXAM_KEY = "arise_exam_tracker_v1";
  var EXAM_DATES_KEY = "cse-syllabus-exam-dates-v1";
  var DSA_KEY = "dsaQuestions";
  var GOAL_KEY = "dsaDailyGoal";
  var TASK_KEY = "arise-daily-learning-tasks-v1";
  var FOCUS_KEY = "focusSessionsV2";
  var DEFAULT_CAPACITY = 90;
  var TOPIC_MINUTES = 12;
  var DSA_MINUTES = 20;
  var HORIZON = 14;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad(v) { return (v < 10 ? "0" : "") + v; }

  function dayKey(value) {
    var d = value instanceof Date ? value : new Date(value);
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

  // Exams live in the tracker; the syllabus widget may override a date, and the
  // override wins at read time (it is only written when the user diverges).
  // `includePast` is for history views; the horizon itself never plans for a
  // day that has already happened.
  function exams(options) {
    var includePast = !!(options && options.includePast);
    var store = read(EXAM_KEY) || {};
    var overrides = read(EXAM_DATES_KEY) || {};
    return list(store.exams).map(function (exam) {
      if (!exam || !exam.id) return null;
      var override = overrides[exam.id];
      var date = typeof override === "string" && /^\d{4}-\d{2}-\d{2}/.test(override) ? override : exam.examDate;
      if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
      var topics = list(exam.topics).map(function (topic) {
        if (!topic) return null;
        if (typeof topic === "string") return { title: topic, done: false, confidence: 0 };
        var status = String(topic.status || "");
        var confidence = Number(topic.confidence);
        return {
          title: String(topic.title || topic.name || "Topic"),
          done: status === "Completed" || status === "Done",
          confidence: isFinite(confidence) ? Math.max(0, Math.min(5, confidence)) : 0
        };
      }).filter(Boolean);
      return {
        id: String(exam.id),
        title: String(exam.examName || "Exam"),
        subject: String(exam.subjectName || exam.subjectCode || ""),
        day: dayKey(date),
        topics: topics,
        openTopics: topics.filter(function (topic) { return !topic.done; }).length,
        // A topic the user rated 1-2/5 needs the most time; unrated topics get
        // the default. This keeps the estimate explainable.
        weakTopics: topics.filter(function (topic) { return !topic.done && topic.confidence > 0 && topic.confidence <= 2; }).length,
        weightage: isFinite(Number(exam.weightage)) ? Number(exam.weightage) : null
      };
    }).filter(Boolean).filter(function (exam) {
      return includePast || exam.day >= dayKey(new Date());
    }).sort(function (a, b) { return a.day.localeCompare(b.day); });
  }

  function dsaBacklog() {
    var questions = list(read(DSA_KEY));
    var open = questions.filter(function (q) { return q && q.solved !== true; }).length;
    var goal = Number((read(GOAL_KEY) || {}).target);
    return { open: open, perDay: isFinite(goal) && goal > 0 ? Math.min(20, Math.round(goal)) : 2 };
  }

  function capacity(options) {
    var now = (options && options.now) || new Date();
    var sessions = list(read(FOCUS_KEY));
    var byDay = {};
    sessions.forEach(function (session) {
      if (!session) return;
      var minutes = Number(session.minutes);
      if (!isFinite(minutes) || minutes <= 0) return;
      var key = dayKey(session.endedAt || session.startedAt || session.date);
      if (!key) return;
      byDay[key] = (byDay[key] || 0) + minutes;
    });
    var totals = [];
    for (var i = 1; i <= 7; i++) {
      var key = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
      if (byDay[key]) totals.push(byDay[key]);
    }
    if (!totals.length) return { minutes: DEFAULT_CAPACITY, basis: "default", sample: 0 };
    var average = totals.reduce(function (sum, value) { return sum + value; }, 0) / totals.length;
    // A single heroic Sunday should not set the expectation for the next two
    // weeks, so the median of active days is used instead of the mean.
    var sorted = totals.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    return {
      minutes: Math.max(30, Math.min(480, Math.round(median || average))),
      basis: "recent sessions",
      sample: totals.length
    };
  }

  function days(options) {
    var opts = options || {};
    var now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    var span = Math.max(1, Math.min(60, Number(opts.days) || HORIZON));
    var cap = capacity({ now: now });
    var examList = exams();
    var backlog = dsaBacklog();
    var todayKey = dayKey(now);
    var out = [];

    for (var i = 0; i < span; i++) {
      var key = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
      var drivers = [];
      var needed = 0;

      examList.forEach(function (exam) {
        if (exam.day < todayKey) return;
        // The gap must be measured from the day being planned, not from today,
        // or prep work would follow the exam into the following week.
        var gap = Math.round((new Date(exam.day + "T00:00:00") - new Date(key + "T00:00:00")) / 86400000);
        if (gap < 0) return;
        if (exam.day === key) {
          var examCost = 180;
          needed += examCost;
          drivers.push({ kind: "exam", label: exam.title + (exam.subject ? " · " + exam.subject : ""), minutes: examCost, note: "exam today" });
          return;
        }
        // Study load is spread over the days before the exam: weak topics cost
        // more, and the last two days are reserved for revision.
        if (gap > 0 && gap <= 7 && exam.openTopics > 0) {
          var spread = exam.openTopics * TOPIC_MINUTES * (exam.weakTopics ? 1.5 : 1) / Math.min(gap, 7);
          var cost = Math.round(spread);
          if (cost <= 0) return;
          needed += cost;
          drivers.push({
            kind: gap <= 2 ? "revision" : "prep",
            label: exam.title + " · " + exam.openTopics + " open topic" + (exam.openTopics === 1 ? "" : "s"),
            minutes: cost,
            note: gap === 1 ? "exam tomorrow" : "exam in " + gap + " days"
          });
        }
      });

      if (backlog.open > 0) {
        var dsaCost = backlog.perDay * DSA_MINUTES;
        needed += dsaCost;
        drivers.push({
          kind: "dsa",
          label: backlog.perDay + " DSA problem" + (backlog.perDay === 1 ? "" : "s"),
          minutes: dsaCost,
          note: backlog.open + " still open"
        });
      }

      drivers.sort(function (a, b) { return b.minutes - a.minutes; });
      var ratio = cap.minutes ? needed / cap.minutes : 0;
      out.push({
        key: key,
        isToday: key === todayKey,
        capacity: cap.minutes,
        minutesNeeded: needed,
        ratio: Math.round(ratio * 100) / 100,
        load: needed === 0 ? "free" : ratio > 1.25 ? "overloaded" : ratio > 0.85 ? "full" : "light",
        drivers: drivers
      });
    }
    return out;
  }

  function summary(options) {
    var rows = days(options);
    var overloaded = rows.filter(function (row) { return row.load === "overloaded"; });
    var heaviest = rows.slice().sort(function (a, b) { return b.minutesNeeded - a.minutesNeeded; })[0] || null;
    var nextExam = exams().filter(function (exam) { return exam.day >= dayKey(new Date()); })[0] || null;
    return {
      rows: rows,
      overloaded: overloaded,
      heaviest: heaviest,
      nextExam: nextExam,
      totals: {
        minutes: rows.reduce(function (sum, row) { return sum + row.minutesNeeded; }, 0),
        days: rows.length,
        capacity: capacity()
      }
    };
  }

  /* ------------------------------------------------------------------- UI -- */

  var mounted = null;

  function routeWantsCard() {
    var main = document.getElementById("arise-main");
    var heading = main && main.querySelector("header h1");
    return !!heading && /exam tracker|cse syllabus/i.test(heading.textContent || "");
  }

  // Routes do not share one stack class: the Dashboard uses .space-y-6 and the
  // Exam Tracker uses .space-y-5, so the card joins whichever stack the current
  // route actually renders instead of silently never mounting.
  function host() {
    var main = document.getElementById("arise-main");
    if (!main) return null;
    return main.querySelector(".space-y-6") || main.querySelector(".space-y-5") ||
      (main.querySelector(":scope > div.flex-1 > div > div") || main.querySelector(":scope > div.flex-1 > div"));
  }

  function loadLabel(load) {
    return { free: "Free", light: "Light", full: "Full", overloaded: "Overloaded" }[load] || load;
  }

  function cardHtml(state) {
    var rows = state.rows.map(function (row) {
      var date = new Date(row.key + "T00:00:00");
      var label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
      var drivers = row.drivers.map(function (driver) {
        return '<li class="sh-driver"><span class="sh-driver-kind">' + esc(driver.kind) + "</span>" +
          esc(driver.label) + '<span class="sh-driver-cost">' + driver.minutes + "m · " + esc(driver.note) + "</span></li>";
      }).join("");
      return '<li class="sh-day" data-load="' + esc(row.load) + '" data-today="' + (row.isToday ? "true" : "false") + '">' +
        '<div class="sh-day-head"><span class="sh-day-label">' + label + " " + esc(row.key.slice(8)) + "</span>" +
        '<span class="sh-day-load">' + esc(loadLabel(row.load)) + "</span>" +
        '<span class="sh-day-cost">' + (row.minutesNeeded ? row.minutesNeeded + "m / " + row.capacity + "m" : "nothing planned") + "</span></div>" +
        (drivers ? '<ul class="sh-drivers">' + drivers + "</ul>" : "") +
        "</li>";
    }).join("");

    var headline = state.overloaded.length
      ? state.overloaded.length + " of the next " + state.totals.days + " days ask for more than you can realistically study."
      : "Every day in the next " + state.totals.days + " days fits inside your recent daily capacity.";

    var nextExam = state.nextExam
      ? "Next exam: " + state.nextExam.title + " on " + state.nextExam.day +
        (state.nextExam.openTopics ? " · " + state.nextExam.openTopics + " open topic" + (state.nextExam.openTopics === 1 ? "" : "s") : "")
      : "No dated exam in the tracker.";

    return '<div class="sh-head"><div><h2 class="sh-title" id="sh-title">Two-week horizon</h2>' +
      '<p class="sh-sub">' + esc(nextExam) + "</p></div>" +
      '<span class="sh-cap">' + state.totals.capacity.minutes + "m/day</span></div>" +
      '<p class="sh-summary">' + esc(headline) + "</p>" +
      '<ul class="sh-days">' + rows + "</ul>" +
      '<p class="sh-hint">Capacity is the median of your active study days in the last week. Exam cost uses 12 minutes per open topic (more when the topic confidence is 1–2), 20 minutes per DSA problem. Nothing here writes to a widget.</p>';
  }

  function render() {
    if (!mounted) return;
    var body = mounted.querySelector(".sh-body");
    if (body) body.innerHTML = cardHtml(summary({ days: HORIZON }));
  }

  function mount() {
    if (!routeWantsCard()) return false;
    var target = host();
    if (!target) return false;
    if (!mounted || !mounted.isConnected) {
      mounted = document.createElement("section");
      mounted.id = "sh-card";
      mounted.className = "glass-card rounded-2xl p-5 sh-card";
      mounted.setAttribute("aria-labelledby", "sh-title");
      mounted.innerHTML = '<div class="sh-body"></div>';
    }
    if (mounted.parentElement !== target) target.appendChild(mounted);
    render();
    return true;
  }

  function unmount() {
    if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);
  }

  window.AriseHorizon = {
    capacity: capacity,
    days: days,
    summary: summary,
    exams: exams,
    dsaBacklog: dsaBacklog,
    mount: mount,
    unmount: unmount,
    refresh: render
  };

  /* --------------------------------------------------------------- boot -- */

  var pending = null;

  function tick() {
    try {
      if (routeWantsCard()) mount();
      else if (mounted && mounted.isConnected) unmount();
    } catch {}
  }

  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; tick(); }, 240);
  }

  function start() {
    tick();
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
