(function () {
  "use strict";
  if (window.__ARISE_PREMIUM_PRODUCTIVITY__) return;
  window.__ARISE_PREMIUM_PRODUCTIVITY__ = true;

  var activeMobileNav = "home";
  var cachedCommandFab = null;
  var APP_PREFIXES = ["arise-", "arise_", "backupCenter:"];
  var NON_JSON_KEYS = {
    "arise-resume-linkedin-readiness-v1": true,
    "arise-today-revision-v1": true,
    "arise-perf-mode": true,
    "arise-chunks": true,
    "arise-sidebar-collapsed": true,
    "arise-dashboard-theme": true,
    "arise-dashboard-theme-mode": true
  };
  var KNOWN_APP_KEYS = {
    dsaQuestions: true,
    notes: true,
    tasks: true,
    devTasks: true,
    projects: true,
    studySessions: true,
    interviewSheetsProgress: true,
    "arise-notes-app-v1": true,
    "arise-personal-wiki-v1": true,
    "arise-cp-tracker-v1": true,
    "arise-attendance-tracker-v1": true,
    "arise-skills-timeline-v1": true,
    "arise-career-readiness-history-v1": true,
    "arise-weekly-ai-report-v1": true,
    "arise-weekly-summary-snapshots-v1": true,
    arise_exam_tracker_v1: true,
    "backupCenter:lastBackupAt": true,
    "arise-dashboard-theme": true,
    "arise-dashboard-theme-mode": true
  };
  var JSON_APP_KEYS = {
    dsaQuestions: true,
    notes: true,
    tasks: true,
    devTasks: true,
    projects: true,
    studySessions: true,
    interviewSheetsProgress: true,
    "arise-notes-app-v1": true,
    "arise-personal-wiki-v1": true,
    "arise-cp-tracker-v1": true,
    "arise-attendance-tracker-v1": true,
    "arise-skills-timeline-v1": true,
    "arise-career-readiness-history-v1": true,
    "arise-weekly-ai-report-v1": true,
    "arise-weekly-summary-snapshots-v1": true,
    arise_exam_tracker_v1: true
  };

  var SECTION_LABELS = {
    dashboard: "Dashboard",
    learning: "Learning",
    "exam-tracker": "Exam Tracker",
    dsa: "DSA Tracker",
    dev: "Development",
    cp: "Competitive Programming",
    projects: "Projects",
    cgpa: "CGPA Tracker",
    "attendance-skills": "Attendance & Skills",
    "cse-syllabus": "CSE Syllabus",
    "placement-tracker": "Placement Tracker",
    "hackathon-tracker": "Hackathon Tracker",
    certificates: "Certificates",
    "social-media": "Social Media",
    notes: "Notes",
    expenses: "Expenses",
    resources: "Resources",
    analytics: "Analytics",
    achievements: "Achievements",
    settings: "Settings"
  };

  var ALL_SECTIONS = [
    ["dashboard", "Dashboard", "Overview, readiness rings, streaks, and daily tasks", "🏠"],
    ["learning", "Learning & Focus", "Pomodoro timer, career command center, smart learning path, wellness", "⏱️"],
    ["exam-tracker", "Exam Tracker", "Exam schedules, syllabus confidence, D-day countdown, and analytics", "📋"],
    ["dsa", "DSA Tracker", "Problem bank, pattern playbook, mock OA, and interview sheets", "🧠"],
    ["dev", "Development", "Engineering roadmap, mastery radar, and portfolio readiness", "💻"],
    ["cp", "Competitive Programming", "LeetCode, Codeforces, CodeChef & GFG sync + rating analytics", "🏆"],
    ["projects", "Projects", "Portfolio project pipeline, milestones, and proof-of-work", "🚀"],
    ["cgpa", "CGPA Tracker", "Semester SGPA/CGPA calculator, grade targets, and projections", "🎓"],
    ["attendance-skills", "Attendance & Skills", "Subject attendance safety simulator and skill growth timeline", "📅"],
    ["cse-syllabus", "CSE Syllabus", "BTech CSE semester subjects, unit mastery, and readiness score", "📚"],
    ["placement-tracker", "Placement Tracker", "Application CRM, CTC analyzer, interview rounds, and upsolves", "💼"],
    ["hackathon-tracker", "Hackathon Tracker", "Hackathon pipeline, team directory, budgets, and prize wall", "⚡"],
    ["certificates", "Certificates", "Credential vault, verification links, and skill mapping", "🏅"],
    ["social-media", "Social Media & Brand", "Developer presence, LinkedIn/GitHub consistency, and content log", "🌐"],
    ["notes", "Notes & Personal Wiki", "Markdown workspace notes and structured engineering wiki", "📝"],
    ["expenses", "Expenses", "Student budget, category analytics, and weekly spend caps", "💳"],
    ["resources", "Resources", "Curated CS learning links, references, and local files", "🗂️"],
    ["analytics", "Analytics", "Weekly AI reports, session correlations, and study insights", "📊"],
    ["achievements", "Achievements", "Unlocked milestones, XP progression, and consistency badges", "⭐"],
    ["settings", "Settings & Backup", "Themes, Data Health Center, Backup Center, and preferences", "⚙️"]
  ];

  var selectedIdx = 0;
  var filteredItems = [];
  var toastTimer = null;
  var syncScheduled = false;
  var healthRunId = 0;
  var cachedHealth = null;
  var lastTriggerEl = null;
  var interviewSheetsData = null;
  var fetchingSheets = false;
  var isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "");

  function esc(val) {
    return String(val == null ? "" : val).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function snippet(raw, maxLen) {
    var clean = String(raw == null ? "" : raw)
      .replace(/<[^>]*>/g, " ")
      .replace(/[#*_`>\-[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return "Open in workspace";
    return clean.length > maxLen ? clean.slice(0, maxLen - 1).trim() + "…" : clean;
  }

  function formatTimestamp(ts) {
    if (!ts) return "Never";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "Never";
    try {
      return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return d.toISOString();
    }
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function readArray(key) {
    var val = readJSON(key, []);
    return Array.isArray(val) ? val : [];
  }

  function joinMeta() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      if (Array.isArray(arg)) {
        if (arg.length) parts.push(arg.join(", "));
      } else if (arg != null && arg !== false && String(arg).trim() !== "") {
        parts.push(String(arg));
      }
    }
    return parts.join(" · ");
  }

  function currentHeading() {
    var el = document.querySelector("main header .section-heading") ||
             document.querySelector("header .section-heading") ||
             document.querySelector("header h1") ||
             document.querySelector("main h1");
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function isWorkspaceActive() {
    return !!document.getElementById("arise-main") && !document.documentElement.classList.contains("arise-focus-active");
  }

  function removeById(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function teardownShellChrome() {
    closePalette();
    removeById("upp-command-overlay");
    removeById("upp-command-fab");
    removeById("upp-bottom-nav");
    document.body.classList.remove("upp-has-mobile-bottom-nav");
    filteredItems = [];
    selectedIdx = 0;
  }

  function navBucket(sectionId) {
    if (sectionId === "dashboard") return "home";
    if (sectionId === "dsa") return "dsa";
    return "more";
  }

  function findSidebarButton(sectionId) {
    var targetLabel = SECTION_LABELS[sectionId] || sectionId;
    var navRoot = document.getElementById("arise-desktop-nav") || document.getElementById("arise-mobile-nav") || document;
    var buttons = Array.prototype.slice.call(navRoot.querySelectorAll("button.nav-item, button"));
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var title = (btn.getAttribute("title") || btn.getAttribute("aria-label") || "").trim();
      var text = (btn.textContent || "").replace(/\s+/g, " ").trim();
      if (title === targetLabel || text === targetLabel || title.indexOf(targetLabel) !== -1 || text.indexOf(targetLabel) !== -1) {
        return btn;
      }
    }
    return null;
  }

  function navigateSection(sectionId, opts) {
    opts = opts || {};
    var btn = findSidebarButton(sectionId);
    if (btn) {
      btn.click();
    } else if (sectionId === "dashboard") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    activeMobileNav = opts.navKey || navBucket(sectionId);
    syncMobileNavActive();
    if (typeof opts.after === "function") {
      setTimeout(opts.after, opts.delay || 320);
    }
  }

  function scrollToTarget(selector, fallbackMsg) {
    var el = document.querySelector(selector);
    if (!el) {
      showToast(fallbackMsg || "Section opened. Target panel is still initializing.");
      return false;
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof el.focus === "function") {
      el.setAttribute("tabindex", "-1");
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
    return true;
  }

  function openDataHealth() {
    navigateSection("settings", {
      navKey: "health",
      after: function () {
        mountDataHealthCard(true);
        scrollToTarget("#upp-data-health-card", "Opened Settings — Data Health Center is loading.");
      },
      delay: 380
    });
  }

  function openBackupCenter() {
    navigateSection("settings", {
      navKey: "more",
      after: function () {
        if (document.querySelector(".bkc-wrap")) {
          scrollToTarget(".bkc-wrap", "Backup Center is ready.");
        } else {
          showToast("Opened Settings — scroll down for Backup Center.");
        }
      },
      delay: 400
    });
  }

  function showToast(msg) {
    var el = document.getElementById("upp-toast");
    if (!el) return;
    el.textContent = msg;
    el.setAttribute("data-show", "true");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.setAttribute("data-show", "false");
    }, 3000);
  }

  function ensureInterviewData() {
    if (interviewSheetsData || fetchingSheets || typeof fetch !== "function") return;
    fetchingSheets = true;
    var u = window.__ARISE_WIDGET_UTILS__;
    var p = (u && typeof u.fetchInterviewSheets === "function")
      ? u.fetchInterviewSheets()
      : fetch("./interview_sheets_data.json", { cache: "force-cache" }).then(function (r) { return r && r.ok ? r.json() : null; });
    p.then(function (json) {
      if (json && typeof json === "object") {
        interviewSheetsData = json;
        if (isPaletteOpen()) renderPaletteResults();
      }
    }).catch(function () {}).then(function () { fetchingSheets = false; });
  }

  function isShortcutsOpen() {
    var el = document.getElementById("upp-shortcuts-overlay");
    return !!(el && el.getAttribute("data-open") === "true");
  }

  function closeShortcutsModal() {
    var el = document.getElementById("upp-shortcuts-overlay");
    if (!el) return;
    el.setAttribute("data-open", "false");
    el.setAttribute("aria-hidden", "true");
  }

  function openShortcutsModal() {
    closePalette();
    var el = document.getElementById("upp-shortcuts-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "upp-shortcuts-overlay";
      el.className = "upp-shortcuts-overlay";
      el.setAttribute("data-open", "false");
      el.setAttribute("aria-hidden", "true");
      var modKey = isMac ? "⌘" : "Ctrl";
      el.innerHTML =
        "<div class='upp-shortcuts-dialog' role='dialog' aria-modal='true' aria-labelledby='upp-shortcuts-title'>" +
        "<div class='upp-shortcuts-head'>" +
        "<div><h3 id='upp-shortcuts-title'>Keyboard Shortcuts</h3><p>Navigate any module or run workspace commands without leaving your keyboard.</p></div>" +
        "<button type='button' class='upp-shortcuts-close' aria-label='Close keyboard shortcuts'>Esc</button>" +
        "</div>" +
        "<div class='upp-shortcuts-body'>" +
        "<div class='upp-shortcuts-group'><h4>Workspace Commands</h4>" +
        "<div class='upp-sc-row'><span>Open Command Palette</span><span class='upp-sc-keys'><kbd>" + modKey + "</kbd><kbd>K</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Quick Search Workspace</span><span class='upp-sc-keys'><kbd>/</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Collapse / Expand Sidebar</span><span class='upp-sc-keys'><kbd>[</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Toggle Dark / Light Theme</span><span class='upp-sc-keys'><kbd>Alt</kbd><kbd>T</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Keyboard Shortcuts Help</span><span class='upp-sc-keys'><kbd>?</kbd></span></div>" +
        "</div>" +
        "<div class='upp-shortcuts-group'><h4>Go-To Module Chords (Press G then…)</h4>" +
        "<div class='upp-sc-row'><span>Go to Dashboard</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>D</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to DSA Tracker</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>S</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Learning &amp; Focus</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>L</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Development</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>V</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Competitive Programming</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>C</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Projects</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>P</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to CSE Syllabus</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>Y</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Placement Tracker</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>J</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Notes &amp; Wiki</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>N</kbd></span></div>" +
        "<div class='upp-sc-row'><span>Go to Analytics</span><span class='upp-sc-keys'><kbd>G</kbd><span>then</span><kbd>A</kbd></span></div>" +
        "</div>" +
        "</div>" +
        "</div>";
      el.addEventListener("mousedown", function (ev) { if (ev.target === el) closeShortcutsModal(); });
      el.querySelector(".upp-shortcuts-close").addEventListener("click", closeShortcutsModal);
      document.body.appendChild(el);
    }
    el.setAttribute("data-open", "true");
    el.setAttribute("aria-hidden", "false");
  }

  function buildSearchCorpus() {
    var items = [];

    // 1. All 20 Workspace Sections
    ALL_SECTIONS.forEach(function (sec) {
      items.push({
        type: "Section",
        icon: sec[3],
        title: sec[1],
        preview: sec[2],
        tag: "Module",
        action: function () { navigateSection(sec[0], { navKey: navBucket(sec[0]) }); }
      });
    });

    // 2. SaaS Quick Commands
    items.push({
      type: "Action",
      icon: "🌗",
      title: "Toggle Dark / Light Theme",
      preview: "Switch instantly between dark and light workspace appearance",
      tag: "Command",
      action: function () {
        var tBtn = document.querySelector(".arise-theme-quick-toggle");
        if (tBtn) tBtn.click();
      }
    });
    items.push({
      type: "Action",
      icon: "🎨",
      title: "Open Theme Studio",
      preview: "Customize workspace palette, accents, and scheduled themes",
      tag: "Command",
      action: function () {
        var trig = document.querySelector(".theme-switcher-trigger");
        if (trig) trig.click();
      }
    });
    items.push({
      type: "Action",
      icon: "📐",
      title: "Collapse / Expand Sidebar",
      preview: "Toggle desktop navigation rail width",
      tag: "Command",
      action: function () {
        var sb = document.querySelector(".arise-sb-toggle");
        if (sb) sb.click();
      }
    });
    items.push({
      type: "Action",
      icon: "💾",
      title: "Export Workspace Backup",
      preview: "Jump to Backup Center in Settings to download your JSON/ZIP snapshot",
      tag: "Backup",
      action: openBackupCenter
    });
    items.push({
      type: "Action",
      icon: "🩺",
      title: "Inspect Storage & Data Health",
      preview: "Verify localStorage integrity, service worker status, and backup freshness",
      tag: "Health",
      action: openDataHealth
    });
    items.push({
      type: "Action",
      icon: "⌨️",
      title: "View Keyboard Shortcuts",
      preview: "Open the workspace shortcuts & Go-To chord cheatsheet (?)",
      tag: "Shortcut",
      action: openShortcutsModal
    });
    items.push({
      type: "Action",
      icon: "▤",
      title: "Toggle Compact / Comfortable Density",
      preview: "Switch card padding and table row density across all modules",
      tag: "View",
      action: function () {
        var root = document.documentElement;
        var next = root.getAttribute("data-density") === "compact" ? "comfortable" : "compact";
        if (next === "compact") root.setAttribute("data-density", "compact");
        else root.removeAttribute("data-density");
        try { localStorage.setItem("arise-ui-density-v1", next); } catch (e) {}
        showToast(next === "compact" ? "Compact SaaS density enabled." : "Comfortable SaaS density restored.");
      }
    });
    items.push({
      type: "Action",
      icon: "⚡",
      title: "Toggle Performance Lite Mode",
      preview: "Reduce decorative motion and blur effects for low-power / battery mode",
      tag: "Perf",
      action: function () {
        var root = document.documentElement;
        var nextLite = !root.classList.contains("perf-lite");
        root.classList.toggle("perf-lite", nextLite);
        try { localStorage.setItem("arise-perf-mode", nextLite ? "lite" : "full"); } catch (e) {}
        showToast(nextLite ? "Performance Lite mode enabled." : "Full visual mode restored.");
      }
    });

    // 3. Notes & Personal Wiki
    var allNotes = [];
    readArray("notes").forEach(function (n) { if (n) allNotes.push(n); });
    var notesV1 = readJSON("arise-notes-app-v1", null);
    if (notesV1 && Array.isArray(notesV1.notes)) {
      notesV1.notes.forEach(function (n) { if (n) allNotes.push(n); });
    }
    allNotes.forEach(function (n) {
      items.push({
        type: "Note",
        icon: "📝",
        title: n.title || "Untitled Note",
        preview: snippet(n.content || n.text || n.body || "Saved workspace note", 110),
        tag: "Note",
        action: function () { navigateSection("notes", { navKey: "more" }); }
      });
    });

    var wiki = readJSON("arise-personal-wiki-v1", null);
    (wiki && Array.isArray(wiki.pages) ? wiki.pages : []).forEach(function (pg) {
      if (!pg) return;
      items.push({
        type: "Wiki",
        icon: "📚",
        title: pg.title || "Wiki Page",
        preview: snippet(pg.content || "Personal wiki entry", 110),
        tag: "Wiki",
        action: function () { navigateSection("notes", { navKey: "more" }); }
      });
    });

    // 4. DSA Questions & Interview Sheets
    readArray("dsaQuestions").forEach(function (q) {
      if (!q) return;
      items.push({
        type: "DSA",
        icon: "🧠",
        title: q.title || q.name || q.problem || "DSA Problem",
        preview: joinMeta(q.category || q.topic, q.difficulty, q.solved || q.completed ? "Solved" : "Pending", q.notes),
        tag: "DSA",
        action: function () { navigateSection("dsa", { navKey: "dsa" }); }
      });
    });

    if (interviewSheetsData && typeof interviewSheetsData === "object") {
      var progress = readJSON("interviewSheetsProgress", {});
      progress = progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {};
      var sheetItems = [];
      var pushSheetQ = function (sheetKey, sheetName, q, company) {
        if (q && q.title) {
          sheetItems.push({
            sheetKey: sheetKey,
            sheetName: sheetName,
            title: String(q.title || ""),
            topic: q.topic || "Interview",
            difficulty: q.difficulty || "",
            company: company || ""
          });
        }
      };
      ["blind75", "neetcode150", "toptech150", "striverA2Z"].forEach(function (k) {
        var s = interviewSheetsData[k];
        if (s && Array.isArray(s.questions)) {
          s.questions.forEach(function (q) { pushSheetQ(k, s.name || k, q, ""); });
        }
      });
      if (interviewSheetsData.companies && typeof interviewSheetsData.companies === "object") {
        Object.keys(interviewSheetsData.companies).forEach(function (comp) {
          var arr = interviewSheetsData.companies[comp];
          if (Array.isArray(arr)) {
            arr.forEach(function (q) { pushSheetQ("companies::" + comp, comp + " Sheet", q, comp); });
          }
        });
      }
      sheetItems.slice(0, 350).forEach(function (sq) {
        var solved = !!progress[sq.sheetKey + "::" + sq.title];
        items.push({
          type: "Interview",
          icon: "🎙️",
          title: sq.title,
          preview: joinMeta(sq.sheetName, sq.topic, sq.difficulty, solved ? "Solved" : "Unsolved", sq.company),
          tag: "Sheet",
          action: function () {
            navigateSection("dsa", {
              navKey: "dsa",
              after: function () { scrollToTarget(".ish-wrap", "Opened DSA Tracker — Interview Sheets ready."); },
              delay: 420
            });
          }
        });
      });
    }

    // 5. Tasks, Dev Tasks, Projects & Exams
    readArray("tasks").forEach(function (t) {
      if (!t) return;
      items.push({
        type: "Task",
        icon: "✅",
        title: t.title || t.name || "Task",
        preview: joinMeta(t.priority, t.completed ? "Completed" : "Pending"),
        tag: "Task",
        action: function () { navigateSection("learning", { navKey: "more" }); }
      });
    });

    readArray("devTasks").forEach(function (t) {
      if (!t) return;
      items.push({
        type: "Task",
        icon: "💻",
        title: t.title || "Development Task",
        preview: joinMeta(t.category, t.completed ? "Completed" : "Pending"),
        tag: "Dev",
        action: function () { navigateSection("dev", { navKey: "more" }); }
      });
    });

    readArray("projects").forEach(function (pr) {
      if (!pr) return;
      items.push({
        type: "Project",
        icon: "🚀",
        title: pr.title || pr.name || "Project",
        preview: snippet(joinMeta(pr.status, pr.tech || pr.stack, pr.description), 110),
        tag: "Project",
        action: function () { navigateSection("projects", { navKey: "more" }); }
      });
    });

    var examStore = readJSON("arise_exam_tracker_v1", { exams: [] });
    (examStore && Array.isArray(examStore.exams) ? examStore.exams : []).forEach(function (ex) {
      if (!ex) return;
      var prep = window.AriseExamCalculations ? window.AriseExamCalculations.examPreparation(ex) : (ex.preparationPercentage || 0);
      items.push({
        type: "Exam",
        icon: "📋",
        title: ex.examName || "Exam",
        preview: joinMeta(ex.subjectName, ex.subjectCode, ex.examDate, prep + "% prepared"),
        tag: "Exam",
        action: function () {
          if (window.__ARISE_EXAM_TRACKER_API__) window.__ARISE_EXAM_TRACKER_API__.navigate(ex.id);
          else navigateSection("exam-tracker", { navKey: "more" });
        }
      });
    });

    return items;
  }

  function isPaletteOpen() {
    var ov = document.getElementById("upp-command-overlay");
    return !!(ov && ov.getAttribute("data-open") === "true");
  }

  function openPalette() {
    ensureShellChrome();
    ensureInterviewData();
    var ov = document.getElementById("upp-command-overlay");
    var inp = document.getElementById("upp-command-input");
    if (!ov || !inp) return;
    lastTriggerEl = document.activeElement;
    ov.setAttribute("data-open", "true");
    ov.setAttribute("aria-hidden", "false");
    inp.value = "";
    selectedIdx = 0;
    renderPaletteResults();
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 10);
  }

  function closePalette() {
    var ov = document.getElementById("upp-command-overlay");
    if (!ov || ov.getAttribute("data-open") !== "true") return;
    ov.setAttribute("data-open", "false");
    ov.setAttribute("aria-hidden", "true");
    if (lastTriggerEl && typeof lastTriggerEl.focus === "function") {
      try { lastTriggerEl.focus({ preventScroll: true }); } catch (e) {}
    }
    lastTriggerEl = null;
  }

  function executePaletteItem(idx) {
    var target = filteredItems[idx != null ? idx : selectedIdx];
    if (!target || typeof target.action !== "function") return;
    closePalette();
    try { target.action(); } catch (e) {}
  }

  function scoreMatch(item, q) {
    if (!q) return 1;
    var title = String(item.title || "").toLowerCase();
    var preview = String(item.preview || "").toLowerCase();
    var tag = String(item.tag || "").toLowerCase();
    if (title === q) return 120;
    if (title.indexOf(q) === 0) return 95;
    if (title.indexOf(q) !== -1) return 75;
    if (tag.indexOf(q) !== -1) return 55;
    if (preview.indexOf(q) !== -1) return 40;
    var tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      var hay = title + " " + preview + " " + tag;
      var allFound = tokens.every(function (tk) { return hay.indexOf(tk) !== -1; });
      if (allFound) return 32;
    }
    return 0;
  }

  function renderPaletteResults() {
    var listEl = document.getElementById("upp-command-list");
    var inp = document.getElementById("upp-command-input");
    if (!listEl) return;
    var query = inp ? String(inp.value || "").trim().toLowerCase() : "";
    var corpus = buildSearchCorpus();
    if (!query) {
      filteredItems = corpus.slice(0, 28);
    } else {
      filteredItems = corpus
        .map(function (it) { return { item: it, score: scoreMatch(it, query) }; })
        .filter(function (x) { return x.score > 0; })
        .sort(function (a, b) { return b.score - a.score; })
        .slice(0, 40)
        .map(function (x) { return x.item; });
    }
    if (selectedIdx >= filteredItems.length) selectedIdx = Math.max(0, filteredItems.length - 1);

    if (!filteredItems.length) {
      listEl.innerHTML = "<div class='upp-command-empty'>No matching modules, tasks, notes, or problems found.</div>";
      return;
    }

    var groups = {};
    var order = [];
    filteredItems.forEach(function (it, idx) {
      var g = it.type || "Results";
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push({ item: it, index: idx });
    });

    var html = "";
    order.forEach(function (groupName) {
      html += "<div class='upp-command-section-title'>" + esc(groupName) + "</div>";
      groups[groupName].forEach(function (entry) {
        var it = entry.item;
        var sel = entry.index === selectedIdx ? "true" : "false";
        html += "<button type='button' class='upp-command-item' data-upp-palette-item='" + entry.index + "' data-selected='" + sel + "'>" +
          "<span class='upp-command-icon' aria-hidden='true'>" + esc(it.icon || "•") + "</span>" +
          "<span><span class='upp-command-title'>" + esc(it.title) + "</span>" +
          "<span class='upp-command-preview' style='display:block'>" + esc(snippet(it.preview, 100)) + "</span></span>" +
          "<span class='upp-command-tag'>" + esc(it.tag || it.type) + "</span>" +
          "</button>";
      });
    });
    listEl.innerHTML = html;
    var activeRow = listEl.querySelector("[data-selected='true']");
    if (activeRow && typeof activeRow.scrollIntoView === "function") {
      try { activeRow.scrollIntoView({ block: "nearest" }); } catch (e) {}
    }
  }

  function trapFocus(ev) {
    if (ev.key !== "Tab" || !isPaletteOpen()) return;
    var dlg = document.querySelector("#upp-command-overlay .upp-command-dialog");
    if (!dlg) return;
    var focusable = Array.prototype.slice
      .call(dlg.querySelectorAll("input,button,[href],[tabindex]:not([tabindex='-1'])"))
      .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function isAppStorageKey(key) {
    if (NON_JSON_KEYS[key]) return true;
    if (KNOWN_APP_KEYS[key]) return true;
    for (var i = 0; i < APP_PREFIXES.length; i++) {
      if (String(key).indexOf(APP_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function shouldParseAsJson(key, raw) {
    if (NON_JSON_KEYS[key]) return false;
    var trimmed = String(raw == null ? "" : raw).trim();
    return !!JSON_APP_KEYS[key] || trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[";
  }

  function inspectDataHealth() {
    var report = (function () {
      var keys = [], appKeys = [], corrupted = [], bytes = 0, available = true;
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k != null) {
            var val = localStorage.getItem(k);
            keys.push(k);
            bytes += 2 * (String(k).length + String(val || "").length);
            if (isAppStorageKey(k)) {
              appKeys.push(k);
              if (shouldParseAsJson(k, val)) {
                try { JSON.parse(val); } catch (e) { corrupted.push(k); }
              }
            }
          }
        }
      } catch (e) {
        available = false;
      }
      var lastBackupAt = null;
      try { lastBackupAt = localStorage.getItem("backupCenter:lastBackupAt"); } catch (e) {}
      return { available: available, keys: keys, appKeys: appKeys, corrupted: corrupted, usageBytes: bytes, lastBackupAt: lastBackupAt };
    })();

    var swCheck = (function () {
      if (!("serviceWorker" in navigator)) {
        return Promise.resolve({ swStatus: "Unavailable", cacheStatus: "Unavailable", cacheNames: [] });
      }
      var status = navigator.serviceWorker.controller ? "Active + controlling" : "Registered";
      var regPromise = navigator.serviceWorker.getRegistration
        ? navigator.serviceWorker.getRegistration().then(function (reg) {
            if (!reg) return "Not registered";
            if (reg.active && navigator.serviceWorker.controller) return "Active + controlling";
            if (reg.active) return "Active (reload to attach)";
            if (reg.installing || reg.waiting) return "Installing";
            return status;
          }).catch(function () { return status; })
        : Promise.resolve(status);
      return regPromise.then(function (swState) {
        if ("caches" in window && window.caches && window.caches.keys) {
          return window.caches.keys().then(function (names) {
            return { swStatus: swState, cacheStatus: names.length ? names.length + " cache(s) ready" : "Empty", cacheNames: names };
          }).catch(function () {
            return { swStatus: swState, cacheStatus: "Unavailable", cacheNames: [] };
          });
        }
        return { swStatus: swState, cacheStatus: "Unavailable", cacheNames: [] };
      });
    })();

    return swCheck.then(function (res) {
      report.swStatus = res.swStatus;
      report.cacheStatus = res.cacheStatus;
      report.cacheNames = res.cacheNames;
      return report;
    });
  }

  function formatBytes(n) {
    if (!isFinite(n) || n < 0) return "Unavailable";
    if (n < 1024) return n + " B";
    var units = ["KB", "MB", "GB"];
    var val = n / 1024;
    var u = 0;
    while (val >= 1024 && u < units.length - 1) { val /= 1024; u++; }
    return val.toFixed(val < 10 ? 1 : 0) + " " + units[u];
  }

  function buildHealthHtml(r) {
    var lastBackup = r.lastBackupAt ? formatTimestamp(r.lastBackupAt) : "No backup exported yet";
    var warnings = [];
    if (!r.available) warnings.push("Browser localStorage is restricted or unavailable (private browsing / strict storage settings).");
    if (r.usageBytes >= 4194304) warnings.push("Workspace storage is approaching browser quota (>4 MB). Export a backup snapshot soon.");
    if (r.corrupted && r.corrupted.length) warnings.push("Malformed JSON detected in keys: " + r.corrupted.slice(0, 6).join(", ") + (r.corrupted.length > 6 ? "…" : ""));
    if (!r.lastBackupAt) warnings.push("No local backup export recorded yet. Export a snapshot from Backup Center to safeguard your progress.");

    var alertHtml = warnings.length
      ? warnings.map(function (w) { return "<div class='upp-health-warning'>⚠️ " + esc(w) + "</div>"; }).join("")
      : "<div class='upp-health-ok'>✓ All workspace storage keys validated with no integrity warnings.</div>";

    return "<div class='upp-health-head'><div><div class='upp-health-kicker'>Workspace Diagnostics</div><h3>Storage &amp; Backup Health</h3><p>Read-only local storage and offline cache diagnostics. Never modifies or deletes your data.</p></div>" +
      "<button type='button' class='upp-health-recheck' data-upp-health-recheck>Run Check</button></div>" +
      alertHtml +
      "<div class='upp-health-grid'>" +
      "<div class='upp-health-stat'><strong>" + esc(formatBytes(r.usageBytes)) + "</strong><span>Storage footprint</span></div>" +
      "<div class='upp-health-stat'><strong>" + esc(String(r.appKeys.length)) + "</strong><span>Active workspace keys</span></div>" +
      "<div class='upp-health-stat'><strong>" + esc(lastBackup) + "</strong><span>Last backup snapshot</span></div>" +
      "<div class='upp-health-stat'><strong>" + esc(r.swStatus || "Unavailable") + "</strong><span>Offline worker</span></div>" +
      "<div class='upp-health-stat'><strong>" + esc(r.cacheStatus || "Unavailable") + "</strong><span>Asset cache</span></div>" +
      "<div class='upp-health-stat'><strong>" + esc(String(r.corrupted.length)) + "</strong><span>Corrupted keys</span></div>" +
      "</div>" +
      "<div class='upp-health-actions'>" +
      "<button type='button' data-upp-health-export>Export JSON Snapshot</button>" +
      "<button type='button' data-upp-health-backup>Open Backup Center</button>" +
      "</div>";
  }

  function isSettingsPage() {
    var h = currentHeading();
    return h === "Settings" || !!document.querySelector(".bkc-wrap");
  }

  function mountDataHealthCard(forceRefresh) {
    if (!forceRefresh && !isSettingsPage()) return;
    if (!isSettingsPage()) return;

    var anchor = (function () {
      var bkc = document.querySelector(".bkc-wrap");
      if (bkc) {
        var wrap = bkc.closest(".glass-card") || bkc.parentNode;
        if (wrap && wrap.parentNode) return { parent: wrap.parentNode, before: wrap };
      }
      var main = document.querySelector("main");
      var container = main && (main.querySelector(".max-w-7xl") || main.querySelector(".space-y-6") || main.firstElementChild);
      return container ? { parent: container, before: container.firstElementChild } : null;
    })();
    if (!anchor || !anchor.parent) return;

    var card = document.getElementById("upp-data-health-card");
    if (!card) {
      card = document.createElement("section");
      card.id = "upp-data-health-card";
      card.className = "glass-card rounded-2xl p-5 upp-health-card";
      card.setAttribute("aria-label", "Data Health Center");
      card.addEventListener("click", function (ev) {
        if (!ev.target || !ev.target.closest) return;
        if (ev.target.closest("[data-upp-health-recheck]")) {
          cachedHealth = null;
          mountDataHealthCard(true);
        } else if (ev.target.closest("[data-upp-health-backup]")) {
          openBackupCenter();
        } else if (ev.target.closest("[data-upp-health-export]")) {
          var expBtn = document.querySelector(".bkc-wrap [data-act='export-json']");
          if (expBtn) expBtn.click();
          else {
            openBackupCenter();
            showToast("Scrolled to Backup Center — click Export JSON.");
          }
        }
      });
    }

    if (card.parentNode !== anchor.parent || (anchor.before && anchor.before !== card && card.nextSibling !== anchor.before)) {
      anchor.parent.insertBefore(card, anchor.before || anchor.parent.firstElementChild || null);
    }

    if (cachedHealth && !forceRefresh) {
      card.innerHTML = buildHealthHtml(cachedHealth);
    } else {
      card.innerHTML = "<div class='upp-health-loading'>Inspecting workspace storage health…</div>";
      var id = ++healthRunId;
      inspectDataHealth().then(function (report) {
        if (id !== healthRunId) return;
        cachedHealth = report;
        if (card && document.contains(card)) card.innerHTML = buildHealthHtml(report);
      }).catch(function () {
        if (card && document.contains(card)) {
          card.innerHTML = "<div class='upp-health-warning'>Storage inspection encountered an error. Your data was not modified.</div>";
        }
      });
    }
  }

  function ensureShellChrome() {
    if (!isWorkspaceActive()) {
      teardownShellChrome();
      return;
    }

    // 1. Mobile Bottom Navigation (persists across ALL 20 sections!)
    if (!document.getElementById("upp-bottom-nav")) {
      var nav = document.createElement("nav");
      nav.id = "upp-bottom-nav";
      nav.className = "upp-bottom-nav";
      nav.setAttribute("aria-label", "Mobile workspace navigation");
      nav.innerHTML = [
        ["home", "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/><rect x='14' y='14' width='7' height='7' rx='1.5'/></svg>", "Home", "Dashboard overview"],
        ["dsa", "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><polyline points='16 18 22 12 16 6'/><polyline points='8 6 2 12 8 18'/></svg>", "DSA", "DSA Tracker"],
        ["notes", "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/></svg>", "Notes", "Notes & Personal Wiki"],
        ["more", "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>", "Search", "Command Palette & All Modules"]
      ].map(function (it) {
        return "<button type='button' data-upp-bottom='" + it[0] + "' aria-label='Open " + esc(it[3]) + "'>" +
          "<span class='upp-nav-icon' aria-hidden='true'>" + it[1] + "</span>" +
          "<span class='upp-nav-label'>" + esc(it[2]) + "</span></button>";
      }).join("");
      nav.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-upp-bottom]") : null;
        if (!btn) return;
        var key = btn.getAttribute("data-upp-bottom");
        if (key === "home") navigateSection("dashboard", { navKey: "home" });
        else if (key === "dsa") navigateSection("dsa", { navKey: "dsa" });
        else if (key === "notes") navigateSection("notes", { navKey: "notes" });
        else if (key === "more") {
          activeMobileNav = "more";
          syncMobileNavActive();
          openPalette();
        }
      });
      document.body.appendChild(nav);
    }
    document.body.classList.add("upp-has-mobile-bottom-nav");

    // 2. SaaS Global Search Trigger in Topbar (#upp-command-fab)
    var fab = cachedCommandFab || document.getElementById("upp-command-fab");
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "upp-command-fab";
      fab.className = "upp-command-fab upp-command-fab--docked";
      fab.type = "button";
      fab.setAttribute("aria-label", "Search workspace and run commands (Ctrl+K)");
      fab.innerHTML =
        "<span class='upp-fab-left'>" +
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>" +
        "<span class='upp-fab-text'>Search workspace…</span>" +
        "</span>" +
        "<kbd>" + (isMac ? "⌘K" : "Ctrl K") + "</kbd>";
      fab.addEventListener("mouseenter", ensureInterviewData, { passive: true });
      fab.addEventListener("focus", ensureInterviewData, { passive: true });
      fab.addEventListener("click", openPalette);
      cachedCommandFab = fab;
    }
    var hdr = document.querySelector("main header") || document.querySelector("header.sticky.top-0") || document.querySelector("header");
    var toolbar = hdr && hdr.querySelector("h1") && hdr.lastElementChild ? hdr.lastElementChild : null;
    if (toolbar && fab.parentNode !== toolbar) {
      toolbar.insertBefore(fab, toolbar.firstChild);
    }

    // 3. Command Palette Modal Overlay
    if (!document.getElementById("upp-command-overlay")) {
      var ov = document.createElement("div");
      ov.id = "upp-command-overlay";
      ov.className = "upp-command-overlay";
      ov.setAttribute("data-open", "false");
      ov.setAttribute("aria-hidden", "true");
      ov.innerHTML =
        "<div class='upp-command-dialog' role='dialog' aria-modal='true' aria-labelledby='upp-command-title'>" +
        "<div class='upp-command-top'>" +
        "<span class='upp-command-icon' aria-hidden='true'>⌘</span>" +
        "<label class='upp-sr-only' for='upp-command-input'>Search workspace modules, notes, DSA, tasks, and commands</label>" +
        "<input id='upp-command-input' class='upp-command-input' type='search' autocomplete='off' placeholder='Jump to any module, search DSA sheets, notes, tasks, or run a command…'>" +
        "<span class='upp-command-kbd'>Esc</span>" +
        "</div>" +
        "<div id='upp-command-title' class='upp-sr-only'>Workspace Command Palette</div>" +
        "<div id='upp-command-list' class='upp-command-list'></div>" +
        "</div>";
      ov.addEventListener("mousedown", function (ev) {
        if (ev.target === ov) closePalette();
      });
      ov.addEventListener("click", function (ev) {
        var row = ev.target && ev.target.closest ? ev.target.closest("[data-upp-palette-item]") : null;
        if (row) {
          var idx = Number(row.getAttribute("data-upp-palette-item"));
          if (Number.isFinite(idx)) executePaletteItem(idx);
        }
      });
      ov.addEventListener("keydown", trapFocus);
      document.body.appendChild(ov);

      var inp = ov.querySelector("#upp-command-input");
      inp.addEventListener("input", function () {
        selectedIdx = 0;
        renderPaletteResults();
      });
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          if (filteredItems.length) {
            selectedIdx = Math.min(filteredItems.length - 1, selectedIdx + 1);
            renderPaletteResults();
          }
        } else if (ev.key === "ArrowUp") {
          ev.preventDefault();
          if (filteredItems.length) {
            selectedIdx = Math.max(0, selectedIdx - 1);
            renderPaletteResults();
          }
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          executePaletteItem();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          closePalette();
        }
      });
    }

    // 4. Accessible Status Toast
    if (!document.getElementById("upp-toast")) {
      var toast = document.createElement("div");
      toast.id = "upp-toast";
      toast.className = "upp-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }

    syncMobileNavActive();
  }

  function syncMobileNavActive() {
    var h = currentHeading();
    if (h === "Dashboard") activeMobileNav = "home";
    else if (h.indexOf("DSA") !== -1) activeMobileNav = "dsa";
    else if (h.indexOf("Notes") !== -1) activeMobileNav = "notes";
    else if (h) activeMobileNav = "more";

    var nav = document.getElementById("upp-bottom-nav");
    if (!nav) return;
    nav.querySelectorAll("[data-upp-bottom]").forEach(function (btn) {
      btn.setAttribute("data-active", btn.getAttribute("data-upp-bottom") === activeMobileNav ? "true" : "false");
    });
  }

  function scheduleSync() {
    if (document.hidden || syncScheduled) return;
    syncScheduled = true;
    setTimeout(function () {
      syncScheduled = false;
      ensureShellChrome();
      mountDataHealthCard(false);
      syncMobileNavActive();
    }, 120);
  }

  var chordTimer = null;
  var chordPending = false;
  var GO_CHORDS = {
    d: "dashboard",
    s: "dsa",
    l: "learning",
    e: "exam-tracker",
    v: "dev",
    c: "cp",
    p: "projects",
    j: "placement-tracker",
    h: "hackathon-tracker",
    n: "notes",
    x: "expenses",
    a: "analytics",
    y: "cse-syllabus",
    o: "settings"
  };

  function init() {
    try {
      if (localStorage.getItem("arise-ui-density-v1") === "compact") {
        document.documentElement.setAttribute("data-density", "compact");
      }
    } catch (e) {}

    ensureShellChrome();
    mountDataHealthCard(false);

    document.addEventListener("keydown", function (ev) {
      var target = ev.target;
      var inField = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === "k") {
        if (!isWorkspaceActive()) return;
        ev.preventDefault();
        closeShortcutsModal();
        if (isPaletteOpen()) closePalette();
        else openPalette();
        return;
      }
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && String(ev.key).toLowerCase() === "t") {
        var tBtn = document.querySelector(".arise-theme-quick-toggle");
        if (tBtn) { ev.preventDefault(); tBtn.click(); }
        return;
      }
      if (ev.key === "Escape") {
        if (isShortcutsOpen()) { ev.preventDefault(); closeShortcutsModal(); return; }
        if (isPaletteOpen()) { ev.preventDefault(); closePalette(); return; }
      }
      if (inField || ev.ctrlKey || ev.metaKey || ev.altKey || !isWorkspaceActive() || isPaletteOpen()) return;

      var k = String(ev.key || "").toLowerCase();
      if (chordPending) {
        chordPending = false;
        clearTimeout(chordTimer);
        if (GO_CHORDS[k]) {
          ev.preventDefault();
          closeShortcutsModal();
          navigateSection(GO_CHORDS[k], { navKey: navBucket(GO_CHORDS[k]) });
          return;
        }
      }
      if (k === "g" && !ev.shiftKey) {
        chordPending = true;
        clearTimeout(chordTimer);
        chordTimer = setTimeout(function () { chordPending = false; }, 1100);
        return;
      }
      if (ev.key === "?") {
        ev.preventDefault();
        if (isShortcutsOpen()) closeShortcutsModal();
        else openShortcutsModal();
      } else if (ev.key === "/" && !isShortcutsOpen()) {
        ev.preventDefault();
        openPalette();
      } else if (ev.key === "[") {
        var sbToggle = document.querySelector(".arise-sb-toggle");
        if (sbToggle) {
          ev.preventDefault();
          sbToggle.click();
        }
      }
    });

    if (window.__ARISE_MUTATION_BUS__) {
      window.__ARISE_MUTATION_BUS__.subscribe(scheduleSync);
    } else if (typeof MutationObserver === "function" && document.body) {
      var fallbackMo = new MutationObserver(scheduleSync);
      fallbackMo.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("arise:widgets-ready", function () {
        if (window.__ARISE_MUTATION_BUS__) {
          fallbackMo.disconnect();
          window.__ARISE_MUTATION_BUS__.subscribe(scheduleSync);
        }
      }, { once: true });
    }
    window.addEventListener("storage", function () { cachedHealth = null; scheduleSync(); });
    window.addEventListener("focus", scheduleSync);
    window.addEventListener("popstate", scheduleSync);
    window.addEventListener("hashchange", scheduleSync);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleSync();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
