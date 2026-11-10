/* ==========================================================================
   Progress overview (src/progress-overview.js)
   --------------------------------------------------------------------------
   Attendance, CGPA, skills, DSA, projects, certificates and study time are each
   owned by their own widget, and each shows its own numbers. Nothing showed the
   seven together, so "am I actually improving?" meant visiting seven routes and
   comparing numbers from memory — and several of those widgets default to demo
   subjects/semesters when their store is empty, which makes an untouched
   account look like it has data.

   This module reads every store once and reports one honest row per area with
   what it was computed from. It is strictly read-only: no store is written, no
   widget is re-mounted, and a missing store is reported as "no data" instead of
   borrowing a widget's sample row.

   Public API (window.AriseProgress)
   ---------------------------------
   overview({ now })   -> { areas[], completeness, sources, missing[] }
   area(id)            -> one area row
   mount() / unmount() -> the card on the Achievements route
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseProgress) return;

  var KEYS = {
    attendance: "arise-attendance-tracker-v1",
    cgpa: "arise-cgpa-tracker-v1",
    skills: "arise-skills-timeline-v1",
    dsa: "dsaQuestions",
    goal: "dsaDailyGoal",
    projects: "projects",
    certificates: "arise_certificates_v1",
    focus: "focusSessionsV2",
    cp: "arise-cp-tracker-v1",
    syllabus: "cse-syllabus-progress-v1"
  };
  var AREAS = ["study", "dsa", "attendance", "cgpa", "skills", "projects", "certificates", "cp"];

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
      if (parsed == null) return null;
      return typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function list(value) { return Array.isArray(value) ? value : []; }
  function ratio(part, whole) {
    if (!whole) return null;
    return Math.max(0, Math.min(1, part / whole));
  }

  /* --------------------------------------------------------------- areas -- */

  // Sessions per local day, for the plain-text detail line.
  function minutes7(now) {
    var start = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    var end = dayKey(now);
    var total = 0;
    list(read(KEYS.focus)).forEach(function (session) {
      if (!session) return;
      var value = Number(session.minutes);
      var key = dayKey(session.endedAt || session.startedAt || session.date);
      if (!isFinite(value) || !key) return;
      if (key >= start && key <= end) total += value;
    });
    return Math.round(total) + "m counted";
  }

  function studyArea(now) {
    // Reuse the analytics maths when present so this card can never disagree
    // with the Analytics page about the same week.
    var minutes = null;
    var sessions = list(read(KEYS.focus));
    var analytics = window.AriseAnalytics;
    if (analytics && typeof analytics.summarise === "function") {
      try {
        var summary = analytics.summarise({ days: 7, now: now });
        return {
          id: "study",
          label: "Study time",
          value: Math.round(summary.minutes),
          unit: "m this week",
          display: summary.minutes >= 60 ? (Math.round(summary.minutes / 6) / 10) + "h" : Math.round(summary.minutes) + "m",
          detail: summary.activeDays + " active day" + (summary.activeDays === 1 ? "" : "s") + " · " + minutes7(now) + " over 7 days",
          progress: ratio(summary.activeDays, 7),
          hasData: summary.hasData,
          source: KEYS.focus
        };
      } catch {}
    }
    var today = dayKey(now);
    var weekAgo = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    var active = {};
    sessions.forEach(function (session) {
      if (!session) return;
      var value = Number(session.minutes);
      if (!isFinite(value) || value <= 0) return;
      var key = dayKey(session.endedAt || session.startedAt || session.date);
      if (!key || key < weekAgo || key > today) return;
      active[key] = (active[key] || 0) + value;
      minutes = (minutes || 0) + value;
    });
    var days = Object.keys(active).length;
    return {
      id: "study",
      label: "Study time",
      value: Math.round(minutes || 0),
      unit: "m this week",
      display: (minutes || 0) >= 60 ? (Math.round((minutes || 0) / 6) / 10) + "h" : Math.round(minutes || 0) + "m",
      detail: days + " active day" + (days === 1 ? "" : "s") + " · " + sessions.length + " session" + (sessions.length === 1 ? "" : "s") + " logged",
      progress: ratio(days, 7),
      hasData: !!minutes,
      source: KEYS.focus
    };
  }

  function dsaArea() {
    var questions = list(read(KEYS.dsa));
    var solved = questions.filter(function (q) { return q && q.solved === true; });
    var byDifficulty = { Easy: { done: 0, total: 0 }, Medium: { done: 0, total: 0 }, Hard: { done: 0, total: 0 } };
    questions.forEach(function (q) {
      if (!q) return;
      var bucket = byDifficulty[q.difficulty];
      if (!bucket) return;
      bucket.total += 1;
      if (q.solved) bucket.done += 1;
    });
    var total = questions.length;
    return {
      id: "dsa",
      label: "DSA problems",
      value: solved.length,
      unit: "of " + total + " solved",
      display: solved.length + "/" + total,
      detail: "Easy " + byDifficulty.Easy.done + "/" + byDifficulty.Easy.total +
        " · Medium " + byDifficulty.Medium.done + "/" + byDifficulty.Medium.total +
        " · Hard " + byDifficulty.Hard.done + "/" + byDifficulty.Hard.total,
      progress: ratio(solved.length, total),
      hasData: total > 0,
      source: KEYS.dsa
    };
  }

  function attendanceArea() {
    var store = read(KEYS.attendance);
    var subjects = list(store && store.subjects);
    var attended = 0;
    var held = 0;
    var risky = [];
    var threshold = store && isFinite(Number(store.threshold)) ? Number(store.threshold) : 75;
    subjects.forEach(function (subject) {
      if (!subject) return;
      var present = Number(subject.attended);
      var total = Number(subject.total);
      if (!isFinite(present) || !isFinite(total) || total <= 0) return;
      attended += present;
      held += total;
      var percent = (present / total) * 100;
      if (percent < threshold) risky.push({ name: String(subject.name || "Subject"), percent: Math.round(percent) });
    });
    var percent = held ? Math.round((attended / held) * 100) : null;
    return {
      id: "attendance",
      label: "Attendance",
      value: percent,
      unit: percent == null ? "no classes" : "%",
      display: percent == null ? "—" : percent + "%",
      detail: held
        ? attended + " of " + held + " classes · " + (risky.length ? risky.length + " below " + threshold + "%" : "all above " + threshold + "%")
        : "No classes logged yet (the widget's sample subjects are not counted)",
      progress: percent == null ? null : percent / 100,
      hasData: held > 0,
      risky: risky,
      source: KEYS.attendance
    };
  }

  var GRADE_POINTS = { "O": 10, "A+": 9, "A": 8, "B+": 7, "B": 6, "C": 5, "P": 4, "F": 0 };

  function cgpaArea() {
    var store = read(KEYS.cgpa);
    var semesters = list(store && store.semesters);
    var points = 0;
    var credits = 0;
    var graded = 0;
    semesters.forEach(function (semester) {
      list(semester && semester.subjects).forEach(function (subject) {
        if (!subject) return;
        var credit = Number(subject.credits);
        var grade = String(subject.grade || "");
        if (!isFinite(credit) || credit <= 0) return;
        if (!Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade)) return;
        points += credit * GRADE_POINTS[grade];
        credits += credit;
        graded += 1;
      });
    });
    var cgpa = credits ? Math.round((points / credits) * 100) / 100 : null;
    var target = store && store.target && isFinite(Number(store.target.cgpa)) ? Number(store.target.cgpa) : null;
    return {
      id: "cgpa",
      label: "CGPA",
      value: cgpa,
      unit: cgpa == null ? "no graded subjects" : "credit-weighted",
      display: cgpa == null ? "—" : cgpa.toFixed(2),
      detail: graded
        ? graded + " graded subject" + (graded === 1 ? "" : "s") + " · " + credits + " credits" + (target ? " · target " + target : "")
        : "No graded subjects yet (sample semesters are not counted)",
      progress: cgpa == null ? null : Math.max(0, Math.min(1, cgpa / 10)),
      hasData: graded > 0,
      source: KEYS.cgpa
    };
  }

  function skillsArea() {
    var store = read(KEYS.skills);
    var skills = list(store && store.skills);
    var scored = [];
    skills.forEach(function (skill) {
      if (!skill) return;
      var progress = Number(skill.progress);
      if (!isFinite(progress)) return;
      scored.push(Math.max(0, Math.min(100, progress)));
    });
    var average = scored.length ? Math.round(scored.reduce(function (sum, v) { return sum + v; }, 0) / scored.length) : null;
    return {
      id: "skills",
      label: "Skills",
      value: average,
      unit: scored.length ? "avg progress" : "no skills tracked",
      display: average == null ? "—" : average + "%",
      detail: scored.length ? scored.length + " skill" + (scored.length === 1 ? "" : "s") + " tracked" : "No skills added yet",
      progress: average == null ? null : average / 100,
      hasData: scored.length > 0,
      source: KEYS.skills
    };
  }

  function projectsArea() {
    var projects = list(read(KEYS.projects));
    var shipped = projects.filter(function (project) {
      if (!project) return false;
      var status = String(project.status || "").toLowerCase();
      return status === "completed" || status === "shipped" || status === "done";
    });
    return {
      id: "projects",
      label: "Projects",
      value: shipped.length,
      unit: "shipped of " + projects.length,
      display: shipped.length + "/" + projects.length,
      detail: projects.length ? "Completed or shipped projects only" : "No projects tracked yet",
      progress: ratio(shipped.length, projects.length),
      hasData: projects.length > 0,
      source: KEYS.projects
    };
  }

  function certificatesArea() {
    var store = read(KEYS.certificates);
    var certificates = list(store && store.certificates);
    var verified = certificates.filter(function (cert) {
      return cert && (cert.verified === true || cert.verificationStatus === "verified" || cert.verificationId);
    });
    return {
      id: "certificates",
      label: "Certificates",
      value: certificates.length,
      unit: certificates.length ? (verified.length + " verified") : "of 0 saved",
      display: String(certificates.length),
      detail: certificates.length ? verified.length + " with a verification reference" : "No certificates saved yet",
      progress: ratio(verified.length, certificates.length),
      hasData: certificates.length > 0,
      source: KEYS.certificates
    };
  }

  function cpArea() {
    var store = read(KEYS.cp);
    var problems = list(store && store.problems);
    var solved = problems.filter(function (problem) {
      if (!problem) return false;
      var status = String(problem.status || "").toLowerCase();
      return status === "solved" || status === "accepted" || problem.solved === true;
    });
    var platforms = list(store && store.platforms).filter(function (platform) {
      return platform && typeof platform.handle === "string" && platform.handle.trim();
    });
    return {
      id: "cp",
      label: "Competitive coding",
      value: solved.length,
      unit: solved.length ? "logged" : "none yet",
      display: String(solved.length),
      detail: platforms.length + " connected profile" + (platforms.length === 1 ? "" : "s") + " · " + problems.length + " logged",
      progress: ratio(solved.length, problems.length),
      hasData: problems.length > 0 || platforms.length > 0,
      source: KEYS.cp
    };
  }

  function overview(options) {
    var now = (options && options.now instanceof Date) ? options.now : new Date((options && options.now) || Date.now());
    var areas = [studyArea(now), dsaArea(), attendanceArea(), cgpaArea(), skillsArea(), projectsArea(), certificatesArea(), cpArea()];
    var withData = areas.filter(function (area) { return area.hasData; });
    var scored = withData.filter(function (area) { return typeof area.progress === "number"; });
    return {
      areas: areas,
      covered: withData.length,
      total: areas.length,
      completeness: Math.round((withData.length / areas.length) * 100),
      // An average of only the areas that actually contain data: counting an
      // empty area as zero would punish a new user for not having used it yet.
      average: scored.length
        ? Math.round((scored.reduce(function (sum, area) { return sum + area.progress; }, 0) / scored.length) * 100)
        : null,
      missing: areas.filter(function (area) { return !area.hasData; }).map(function (area) { return area.id; }),
      sources: areas.map(function (area) { return area.source; })
    };
  }

  function area(id) {
    return overview().areas.filter(function (row) { return row.id === id; })[0] || null;
  }

  /* ------------------------------------------------------------------- UI -- */

  var mounted = null;

  function routeWantsCard() {
    var main = document.getElementById("arise-main");
    var heading = main && main.querySelector("header h1");
    return !!heading && /achievements/i.test(heading.textContent || "");
  }

  function host() {
    var main = document.getElementById("arise-main");
    if (!main) return null;
    return main.querySelector(".space-y-6") || main.querySelector(".space-y-5");
  }

  function barHtml(progress) {
    if (typeof progress !== "number") return '<span class="po-bar" data-empty="true"></span>';
    var percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    return '<span class="po-bar"><span class="po-bar-fill" style="--po-w:' + percent + '%"></span></span>';
  }

  function cardHtml(state) {
    var rows = state.areas.map(function (row) {
      return '<li class="po-row" data-area="' + esc(row.id) + '" data-has-data="' + (row.hasData ? "true" : "false") + '">' +
        '<div class="po-row-head"><span class="po-label">' + esc(row.label) + '</span>' +
        '<span class="po-value">' + esc(row.display) + '<span class="po-unit">' + esc(row.unit) + "</span></span></div>" +
        barHtml(row.progress) +
        '<p class="po-detail">' + esc(row.detail) + "</p></li>";
    }).join("");

    return '<div class="po-head"><div><h2 class="po-title" id="po-title">Progress overview</h2>' +
      '<p class="po-sub">One read-only line per area, computed from what you have actually logged.</p></div>' +
      '<span class="po-completeness" title="Areas with real data">' + state.covered + "/" + state.total + "</span></div>" +
      (state.average == null
        ? '<p class="po-note">Nothing has been logged yet, so there is nothing to average. The areas below fill in as you use their widgets.</p>'
        : '<p class="po-note">Average of the ' + state.covered + " area" + (state.covered === 1 ? "" : "s") +
          " that contain data: <strong>" + state.average + "%</strong>. Empty areas are excluded, not counted as zero.</p>") +
      '<ul class="po-rows">' + rows + "</ul>" +
      '<p class="po-hint">Sources: ' + esc(state.sources.length + " stores read, none written") + ". Sample rows that some widgets display before you add your own data are deliberately ignored.</p>";
  }

  function render() {
    if (!mounted) return;
    var body = mounted.querySelector(".po-body");
    if (body) body.innerHTML = cardHtml(overview());
  }

  function mount() {
    if (!routeWantsCard()) return false;
    var target = host();
    if (!target) return false;
    if (!mounted || !mounted.isConnected) {
      mounted = document.createElement("section");
      mounted.id = "po-card";
      mounted.className = "glass-card rounded-2xl p-5 po-card";
      mounted.setAttribute("aria-labelledby", "po-title");
      mounted.innerHTML = '<div class="po-body"></div>';
    }
    if (mounted.parentElement !== target) target.appendChild(mounted);
    render();
    return true;
  }

  function unmount() {
    if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);
  }

  window.AriseProgress = {
    overview: overview,
    area: area,
    areas: AREAS,
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
    window.addEventListener("storage", schedule);
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
