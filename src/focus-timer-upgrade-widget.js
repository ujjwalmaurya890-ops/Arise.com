(function () {
  if (window.__ARISE_TIMER_UPGRADE__) return;
  window.__ARISE_TIMER_UPGRADE__ = true;

  var FOCUS_KEY = "focusSessionsV2";
  var STUDY_KEY = "studySessions";
  var STYLE_ID = "arise-timer-upgrade-style";
  var PANEL_CLS = "arise-timer-upgrade-panel";
  var CATEGORIES = ["DSA", "Project", "College", "Notes", "Interview Prep", "Other"];
  var activeSession = null;
  var lastStudyLen = readList(STUDY_KEY).length;
  var panelMap = new WeakMap();

  function readList(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function makeId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch {}
    return "fs_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function todayIso() {
    try {
      return new Date().toISOString().split("T")[0];
    } catch {
      return "";
    }
  }

  function formatDuration(mins) {
    mins = Number(mins) || 0;
    return mins < 60 ? mins + "m" : Math.floor(mins / 60) + "h " + (mins % 60) + "m";
  }

  function saveFocusRecord(rec) {
    var list = readList(FOCUS_KEY);
    list.push(rec);
    if (list.length > 2000) list = list.slice(list.length - 2000);
    try {
      window.localStorage.setItem(FOCUS_KEY, JSON.stringify(list));
    } catch {}
    document.querySelectorAll("." + PANEL_CLS + " .arise-tu-stats").forEach(function (el) {
      renderStats(el);
    });
  }

  function computeStats() {
    var list = readList(FOCUS_KEY);
    if (!list.length) {
      return { todayMinutes: 0, weekMinutes: 0, bestCategory: "—", avgRating: "—" };
    }
    var today = todayIso();
    var weekAgo = "";
    try {
      var d = new Date();
      d.setDate(d.getDate() - 6);
      weekAgo = d.toISOString().split("T")[0];
    } catch {}

    var todayMin = 0;
    var weekMin = 0;
    var byCat = {};
    var ratingSum = 0;
    var ratingCount = 0;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || typeof item !== "object") continue;
      var m = Number(item.minutes) || 0;
      var dt = typeof item.date === "string" ? item.date : "";
      var cat = typeof item.category === "string" && item.category ? item.category : "Other";
      if (dt === today) todayMin += m;
      if (dt && dt >= weekAgo && dt <= today) weekMin += m;
      byCat[cat] = (byCat[cat] || 0) + m;
      if (typeof item.rating === "number" && item.rating > 0) {
        ratingSum += item.rating;
        ratingCount++;
      }
    }

    var bestCat = "—";
    var bestVal = 0;
    for (var k in byCat) {
      if (Object.prototype.hasOwnProperty.call(byCat, k) && byCat[k] > bestVal) {
        bestVal = byCat[k];
        bestCat = k;
      }
    }

    return {
      todayMinutes: todayMin,
      weekMinutes: weekMin,
      bestCategory: bestCat,
      avgRating: ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : "—"
    };
  }

  function renderStats(el) {
    var s = computeStats();
    var html =
      "<span>Today: <b>" + formatDuration(s.todayMinutes) + "</b></span>" +
      "<span>This week: <b>" + formatDuration(s.weekMinutes) + "</b></span>" +
      "<span>Best category: <b>" + s.bestCategory + "</b></span>" +
      "<span>Avg rating: <b>" + s.avgRating + (s.avgRating !== "—" ? " / 5" : "") + "</b></span>";
    if (el.__tuHtml !== html) {
      el.__tuHtml = html;
      el.innerHTML = html;
    }
  }

  function showCompletionModal(entry) {
    var prev = document.getElementById("arise-tu-overlay");
    if (prev) prev.remove();

    var overlay = document.createElement("div");
    overlay.id = "arise-tu-overlay";
    var card = document.createElement("div");
    card.className = "arise-tu-card";

    var title = document.createElement("h3");
    title.textContent = "Session complete – " + formatDuration(entry.minutes);
    var sub = document.createElement("p");
    sub.className = "arise-tu-sub";
    sub.textContent = entry.task + " · " + entry.category;

    var noteLabel = document.createElement("label");
    noteLabel.className = "arise-tu-label";
    noteLabel.textContent = "What did I complete?";
    var textarea = document.createElement("textarea");
    textarea.placeholder = "e.g. Solved 3 array problems, reviewed notes...";

    var ratingLabel = document.createElement("label");
    ratingLabel.className = "arise-tu-label";
    ratingLabel.textContent = "Focus quality (1-5)";
    var starsWrap = document.createElement("div");
    starsWrap.className = "arise-tu-stars";
    var selectedStars = 0;
    var starBtns = [];
    for (var s = 1; s <= 5; s++) {
      (function (val) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "arise-tu-star";
        btn.textContent = "★";
        btn.setAttribute("aria-label", val + " star" + (val > 1 ? "s" : ""));
        btn.addEventListener("click", function () {
          selectedStars = val;
          starBtns.forEach(function (b, idx) {
            b.classList.toggle("active", idx < selectedStars);
          });
        });
        starBtns.push(btn);
        starsWrap.appendChild(btn);
      })(s);
    }

    var distLabel = document.createElement("label");
    distLabel.className = "arise-tu-label";
    distLabel.textContent = "Distraction count";
    var stepper = document.createElement("div");
    stepper.className = "arise-tu-stepper";
    var distractions = 0;
    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.textContent = "−";
    var distVal = document.createElement("span");
    distVal.textContent = "0";
    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    minusBtn.addEventListener("click", function () {
      distractions = Math.max(0, distractions - 1);
      distVal.textContent = String(distractions);
    });
    plusBtn.addEventListener("click", function () {
      distractions += 1;
      distVal.textContent = String(distractions);
    });
    stepper.appendChild(minusBtn);
    stepper.appendChild(distVal);
    stepper.appendChild(plusBtn);

    var actions = document.createElement("div");
    actions.className = "arise-tu-actions";
    var skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "arise-tu-skip";
    skipBtn.textContent = "Skip details";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "arise-tu-save";
    saveBtn.textContent = "Save session";

    function finish(withDetails) {
      saveFocusRecord({
        id: entry.id,
        task: entry.task,
        category: entry.category,
        minutes: entry.minutes,
        date: entry.date,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        completedNote: withDetails ? textarea.value.trim() : "",
        rating: withDetails && selectedStars > 0 ? selectedStars : null,
        distractions: withDetails ? distractions : 0
      });
      overlay.remove();
    }

    skipBtn.addEventListener("click", function () { finish(false); });
    saveBtn.addEventListener("click", function () { finish(true); });

    actions.appendChild(skipBtn);
    actions.appendChild(saveBtn);
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(noteLabel);
    card.appendChild(textarea);
    card.appendChild(ratingLabel);
    card.appendChild(starsWrap);
    card.appendChild(distLabel);
    card.appendChild(stepper);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  if (!window.__ARISE_TIMER_UPGRADE_LS_PATCHED__) {
    window.__ARISE_TIMER_UPGRADE_LS_PATCHED__ = true;
    try {
      var origSetItem = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = function (key, value) {
        var res = origSetItem(key, value);
        try {
          if (key === STUDY_KEY) {
            var arr;
            try { arr = JSON.parse(value); } catch { arr = null; }
            if (!Array.isArray(arr) || arr.length <= lastStudyLen) {
              lastStudyLen = Array.isArray(arr) ? arr.length : lastStudyLen;
              return res;
            }
            lastStudyLen = arr.length;
            var latest = arr[arr.length - 1];
            if (latest && typeof latest === "object") {
              var mins = Number(latest.minutes) || 0;
              if (mins > 0) {
                try { window.dispatchEvent(new CustomEvent("studySessions:updated")); } catch {}
                var rec = {
                  id: makeId(),
                  task: (activeSession && activeSession.task) || "Untitled session",
                  category: (activeSession && activeSession.category) || "Other",
                  minutes: mins,
                  date: typeof latest.date === "string" ? latest.date : todayIso(),
                  startedAt: (activeSession && activeSession.startedAt) || null,
                  endedAt: Date.now(),
                  completedNote: "",
                  rating: null,
                  distractions: 0
                };
                activeSession = null;
                showCompletionModal(rec);
              }
            }
          }
        } catch {}
        return res;
      };
    } catch {}
  }

  document.addEventListener(
    "click",
    function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("button") : null;
      if (btn && (btn.textContent || "").trim() === "Start") {
        for (var node = btn.parentElement, depth = 0; node && depth < 8; depth++, node = node.parentElement) {
          if (node.querySelector && node.querySelector(":scope > ." + PANEL_CLS) && panelMap.has(node)) {
            var refs = panelMap.get(node);
            activeSession = {
              task: (refs.taskInput.value || "").trim() || "Untitled session",
              category: refs.categorySelect.value || "Other",
              startedAt: Date.now()
            };
            break;
          }
        }
      }
    },
    true
  );

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      "." + PANEL_CLS + "{width:100%;max-width:26rem;margin-top:.75rem;display:flex;flex-direction:column;gap:.6rem;}" +
      "." + PANEL_CLS + " .arise-tu-row{display:flex;gap:.5rem;flex-wrap:wrap;}" +
      "." + PANEL_CLS + " input[type=text],." + PANEL_CLS + " select{flex:1 1 8rem;min-width:8rem;background:var(--surface-muted,#141420);border:1px solid var(--cyber-border,rgba(255,255,255,.15));border-radius:.6rem;padding:.45rem .6rem;font-size:.75rem;color:var(--text-primary,#e5e7eb);}" +
      "." + PANEL_CLS + " input[type=text]:focus,." + PANEL_CLS + " select:focus{outline:none;border-color:var(--info);}" +
      "." + PANEL_CLS + " .arise-tu-again{padding:.45rem .8rem;border-radius:.6rem;font-size:.72rem;font-weight:500;background:color-mix(in srgb, var(--secondary) 15%, transparent);color:var(--secondary);border:1px solid color-mix(in srgb, var(--secondary) 30%, transparent);cursor:pointer;white-space:nowrap;}" +
      "." + PANEL_CLS + " .arise-tu-again:hover{background:color-mix(in srgb, var(--secondary) 25%, transparent);}" +
      "." + PANEL_CLS + " .arise-tu-again:disabled{opacity:.4;cursor:not-allowed;}" +
      "." + PANEL_CLS + " .arise-tu-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:.4rem;font-size:.68rem;color:var(--text-tertiary,#9ca3af);}" +
      "." + PANEL_CLS + " .arise-tu-stats b{color:var(--text-primary,#e5e7eb);font-weight:600;}" +
      "#arise-tu-overlay{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(5,5,10,.72);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);padding:1rem;}" +
      "#arise-tu-overlay .arise-tu-card{width:100%;max-width:26rem;background:var(--surface,#12121c);border:1px solid var(--cyber-border,rgba(255,255,255,.15));border-radius:1rem;padding:1.25rem;display:flex;flex-direction:column;gap:.85rem;box-shadow:0 10px 40px rgba(0,0,0,.5);}" +
      "#arise-tu-overlay h3{font-size:.95rem;font-weight:600;color:var(--text-primary,#e5e7eb);margin:0;}" +
      "#arise-tu-overlay p.arise-tu-sub{font-size:.72rem;color:var(--text-secondary,#9ca3af);margin:0;}" +
      "#arise-tu-overlay textarea{width:100%;min-height:4.5rem;resize:vertical;background:var(--surface-muted,#141420);border:1px solid var(--cyber-border,rgba(255,255,255,.15));border-radius:.6rem;padding:.5rem .6rem;font-size:.78rem;color:var(--text-primary,#e5e7eb);box-sizing:border-box;}" +
      "#arise-tu-overlay .arise-tu-stars{display:flex;gap:.3rem;}" +
      "#arise-tu-overlay .arise-tu-star{font-size:1.4rem;line-height:1;cursor:pointer;color:#3a3a4a;background:none;border:none;padding:0;}" +
      "#arise-tu-overlay .arise-tu-star.active{color:var(--warning);}" +
      "#arise-tu-overlay .arise-tu-stepper{display:flex;align-items:center;gap:.6rem;}" +
      "#arise-tu-overlay .arise-tu-stepper button{width:1.9rem;height:1.9rem;border-radius:.5rem;border:1px solid var(--cyber-border,rgba(255,255,255,.15));background:var(--surface-muted,#141420);color:var(--text-primary,#e5e7eb);cursor:pointer;font-size:1rem;}" +
      "#arise-tu-overlay .arise-tu-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.25rem;}" +
      "#arise-tu-overlay .arise-tu-save{padding:.5rem 1rem;border-radius:.6rem;background:linear-gradient(90deg,var(--info),var(--secondary));color:var(--primary-contrast,#fff);font-weight:600;font-size:.78rem;border:none;cursor:pointer;}" +
      "#arise-tu-overlay .arise-tu-skip{padding:.5rem .9rem;border-radius:.6rem;background:transparent;color:var(--text-secondary,#9ca3af);font-size:.78rem;border:1px solid var(--cyber-border,rgba(255,255,255,.15));cursor:pointer;}" +
      "label.arise-tu-label{font-size:.68rem;color:var(--text-tertiary,#9ca3af);display:block;margin-bottom:.25rem;}";
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildPanel(host) {
    var root = document.createElement("div");
    root.className = PANEL_CLS;

    var row1 = document.createElement("div");
    row1.className = "arise-tu-row";

    var taskCol = document.createElement("div");
    taskCol.style.flex = "1 1 10rem";
    var taskLbl = document.createElement("label");
    taskLbl.className = "arise-tu-label";
    taskLbl.textContent = "Linked task";
    var taskInput = document.createElement("input");
    taskInput.type = "text";
    taskInput.placeholder = "What are you working on?";
    taskInput.setAttribute("aria-label", "Linked task for this focus session");
    taskCol.appendChild(taskLbl);
    taskCol.appendChild(taskInput);

    var catCol = document.createElement("div");
    var catLbl = document.createElement("label");
    catLbl.className = "arise-tu-label";
    catLbl.textContent = "Category";
    var catSelect = document.createElement("select");
    catSelect.setAttribute("aria-label", "Session category");
    CATEGORIES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      catSelect.appendChild(opt);
    });
    catCol.appendChild(catLbl);
    catCol.appendChild(catSelect);

    row1.appendChild(taskCol);
    row1.appendChild(catCol);

    var row2 = document.createElement("div");
    row2.className = "arise-tu-row";
    var againBtn = document.createElement("button");
    againBtn.type = "button";
    againBtn.className = "arise-tu-again";
    againBtn.textContent = "↻ Start same task again";
    row2.appendChild(againBtn);

    var statsEl = document.createElement("div");
    statsEl.className = "arise-tu-stats";

    root.appendChild(row1);
    root.appendChild(row2);
    root.appendChild(statsEl);

    againBtn.addEventListener("click", function () {
      var list = readList(FOCUS_KEY);
      if (list.length) {
        var prev = list[list.length - 1];
        taskInput.value = prev.task || "";
        catSelect.value = CATEGORIES.indexOf(prev.category) !== -1 ? prev.category : "Other";
        var btns = host.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || "").trim() === "Start") {
            btns[i].click();
            break;
          }
        }
      }
    });

    panelMap.set(host, { taskInput: taskInput, categorySelect: catSelect, statsEl: statsEl });
    renderStats(statsEl);
    return root;
  }

  // Fast O(rings) lookup starting directly from .timer-ring-container instead of scanning all <div>s with getComputedStyle
  function findActiveFocusOverlay(rings) {
    var explicit = document.querySelector(".focus-mode");
    if (explicit && explicit.querySelector(".timer-ring-container")) return explicit;
    for (var i = 0; i < rings.length; i++) {
      var ov = rings[i].closest ? rings[i].closest(".fixed") : null;
      if (ov && typeof ov.className === "string" && ov.className.indexOf("z-[9999]") !== -1) {
        return ov;
      }
    }
    return null;
  }

  function install() {
    var rings = document.querySelectorAll(".timer-ring-container");
    if (!rings.length) return;
    ensureStyles();

    var overlay = findActiveFocusOverlay(rings);
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      if (overlay && !overlay.contains(ring)) continue;
      var host = ring.parentElement;
      if (!host) continue;

      // Verify this timer host actually has the Timer mode button (and isn't a decorative ring)
      var existing = host.querySelectorAll(":scope > ." + PANEL_CLS);
      if (existing.length) {
        for (var x = 1; x < existing.length; x++) existing[x].remove();
        continue;
      }

      var hasTimerTab = false;
      for (var up = host, d = 0; up && d < 4; d++, up = up.parentElement) {
        var btns = up.querySelectorAll("button");
        for (var b = 0; b < btns.length; b++) {
          var txt = btns[b].textContent || "";
          if (txt.indexOf("⏱") !== -1 && /Timer/.test(txt)) {
            hasTimerTab = true;
            break;
          }
        }
        if (hasTimerTab) break;
      }
      if (!hasTimerTab) continue;

      var bus = window.__ARISE_MUTATION_BUS__;
      var mountPanel = function () {
        var panel = buildPanel(host);
        var controlsRow = Array.prototype.slice.call(host.children).find(function (ch) {
          var t = ch.textContent || "";
          return t.indexOf("Start") !== -1 && t.indexOf("Reset") !== -1;
        });
        var ambRow = host.querySelector(":scope > .ambient-sound-controls");
        var anchor =
          ambRow && controlsRow
            ? controlsRow.compareDocumentPosition(ambRow) & 4
              ? ambRow
              : controlsRow
            : ambRow || controlsRow;
        if (anchor && anchor.nextSibling) host.insertBefore(panel, anchor.nextSibling);
        else host.appendChild(panel);
      };
      if (bus && typeof bus.mute === "function") bus.mute(mountPanel);
      else mountPanel();
    }
  }

  var timerId = null;
  function onMutations(records) {
    if (document.hidden) return;
    if (Array.isArray(records) && records.length) {
      var relevant = false;
      for (var i = 0; i < records.length && !relevant; i++) {
        var added = records[i].addedNodes;
        if (!added || !added.length) continue;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (
            n &&
            n.nodeType === 1 &&
            ((n.classList && (n.classList.contains("timer-ring-container") || n.classList.contains("focus-mode"))) ||
              (n.querySelector && n.querySelector(".timer-ring-container")))
          ) {
            relevant = true;
            break;
          }
        }
      }
      if (!relevant) return;
    }
    clearTimeout(timerId);
    timerId = setTimeout(install, 60);
  }

  document.addEventListener("DOMContentLoaded", install);
  window.addEventListener("load", install);
  setTimeout(install, 500);

  if (window.__ARISE_MUTATION_BUS__) {
    window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
  } else {
    new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.__mountFocusTimerUpgrade = function () { install(); };
  window.__unmountFocusTimerUpgrade = function () {
    document.querySelectorAll("." + PANEL_CLS).forEach(function (el) { el.remove(); });
    var ov = document.getElementById("arise-tu-overlay");
    if (ov) ov.remove();
  };
})();
