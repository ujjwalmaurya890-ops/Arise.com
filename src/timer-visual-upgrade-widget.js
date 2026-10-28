(function () {
  if (window.__ARISE_TIMER_VISUAL_UPGRADE__) return;
  window.__ARISE_TIMER_VISUAL_UPGRADE__ = true;

  var STYLE_ID = "arise-tv-style";
  var CLS_ICON = "arise-tv-icon";
  var CLS_STREAK = "arise-tv-streak";
  var CLS_BURST = "arise-tv-burst";
  var DAY_MS = 86400000;
  var CAT_ICONS = {
    DSA: "🧩",
    Project: "💻",
    College: "🎓",
    Notes: "📝",
    "Interview Prep": "🎯",
    Other: "📚"
  };

  var cachedRawSessions = null;
  var cachedDayKey = "";
  var cachedStreak = 0;

  function todayUtc() {
    try {
      return new Date().toISOString().split("T")[0];
    } catch {
      return "";
    }
  }

  function addDays(isoDate, delta) {
    var d = new Date(isoDate + "T00:00:00Z");
    return new Date(d.getTime() + delta * DAY_MS).toISOString().split("T")[0];
  }

  function computeStreak() {
    var raw = "";
    try {
      raw = window.localStorage.getItem("studySessions") || "";
    } catch {
      return 0;
    }
    var day = todayUtc();
    if (raw === cachedRawSessions && day === cachedDayKey) {
      return cachedStreak;
    }
    cachedRawSessions = raw;
    cachedDayKey = day;
    if (!raw) {
      cachedStreak = 0;
      return 0;
    }
    var list;
    try {
      list = JSON.parse(raw);
    } catch {
      cachedStreak = 0;
      return 0;
    }
    if (!Array.isArray(list) || !list.length) {
      cachedStreak = 0;
      return 0;
    }
    var activeDays = {};
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item && typeof item.date === "string" && (Number(item.minutes) || 0) > 0) {
        activeDays[item.date] = true;
      }
    }
    var cur = day;
    if (!activeDays[cur]) cur = addDays(cur, -1);
    var count = 0;
    while (activeDays[cur]) {
      count++;
      cur = addDays(cur, -1);
    }
    cachedStreak = count;
    return count;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      "." + CLS_ICON + ",." + CLS_STREAK + ",." + CLS_BURST + "{position:absolute;pointer-events:none;}" +
      "." + CLS_ICON + "{top:22%;left:50%;transform:translate(-50%,-50%);font-size:1.1rem;z-index:2;filter:drop-shadow(0 0 4px color-mix(in srgb, var(--info) 50%, transparent));transition:opacity var(--motion-fast, 120ms) var(--ease-standard, cubic-bezier(0.2,0,0,1));}" +
      "." + CLS_STREAK + "{bottom:14%;left:50%;transform:translate(-50%,0);display:flex;align-items:center;gap:.2rem;font-size:.68rem;font-weight:600;color:#fbbf24;z-index:2;white-space:nowrap;}" +
      "." + CLS_BURST + "{inset:-14%;border-radius:50%;z-index:1;opacity:0;background:radial-gradient(circle, color-mix(in srgb, var(--info) 55%, transparent) 0%, color-mix(in srgb, var(--secondary) 35%, transparent) 45%, transparent 72%);}" +
      "." + CLS_BURST + ".active{animation:arise-tv-burst-anim .65s var(--ease-standard, cubic-bezier(0.2,0,0,1));}" +
      "@keyframes arise-tv-burst-anim{0%{opacity:0;transform:scale(.7);}25%{opacity:1;}100%{opacity:0;transform:scale(1.25);}}" +
      ".arise-tv-paused-ring{position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:1;opacity:0;transition:opacity var(--motion-base, 160ms) var(--ease-standard, cubic-bezier(0.2,0,0,1));}" +
      ".arise-tv-paused-ring.active{opacity:1;}";
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function measureRing(el) {
    var svg = el.querySelector("svg");
    if (!svg) return null;
    var circles = svg.querySelectorAll("circle");
    if (!circles.length) return null;
    var c = circles[0];
    var cx = parseFloat(c.getAttribute("cx"));
    var cy = parseFloat(c.getAttribute("cy"));
    var r = parseFloat(c.getAttribute("r"));
    var vb = svg.getAttribute("viewBox");
    var dims = vb ? vb.split(" ").slice(2, 4).map(Number) : [svg.clientWidth || 108, svg.clientHeight || 108];
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r)) return null;
    return { cx: cx, cy: cy, r: r, width: dims[0] || 108, height: dims[1] || 108 };
  }

  function buildPausedRing(geom) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", "0 0 " + geom.width + " " + geom.height);
    var circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", geom.cx);
    circle.setAttribute("cy", geom.cy);
    circle.setAttribute("r", geom.r);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "rgba(148,163,184,.55)");
    circle.setAttribute("stroke-width", "2");
    circle.setAttribute("stroke-dasharray", "5 5");
    svg.appendChild(circle);
    return svg;
  }

  function readCategoryIcon(ringEl) {
    var root = (ringEl.closest && ringEl.closest(".focus-mode")) || ringEl.parentElement || document;
    var sel = root.querySelector ? root.querySelector(".arise-timer-upgrade-panel select, .arise-tu-panel select") : null;
    return sel && sel.value && CAT_ICONS[sel.value] ? CAT_ICONS[sel.value] : null;
  }

  function readTimerState(ringEl) {
    var parent = ringEl.parentElement || ringEl;
    var btns = parent.querySelectorAll ? parent.querySelectorAll("button") : [];
    for (var i = 0; i < btns.length; i++) {
      var label = (btns[i].textContent || "").trim();
      if (/^Pause$/i.test(label)) return "running";
      if (/^Resume$/i.test(label)) return "paused";
    }
    return "idle";
  }

  function syncRing(ringEl) {
    var state = ringEl.__ariseTv;
    if (!state) return;

    var icon = readCategoryIcon(ringEl) || "";
    if (state.lastIcon !== icon) {
      state.lastIcon = icon;
      if (icon) {
        state.icon.textContent = icon;
        state.icon.style.display = "";
      } else {
        state.icon.style.display = "none";
      }
    }

    var streakVal = computeStreak();
    if (state.lastStreak !== streakVal) {
      state.lastStreak = streakVal;
      if (streakVal > 0) {
        state.streakCount.textContent = String(streakVal);
        state.streak.style.display = "";
      } else {
        state.streak.style.display = "none";
      }
    }

    var runState = readTimerState(ringEl);
    var isPaused = runState === "paused";
    if (state.lastPaused !== isPaused) {
      state.lastPaused = isPaused;
      state.pausedRing.classList.toggle("active", isPaused);
    }
  }

  function mountRing(ringEl) {
    if (!ringEl || ringEl.getAttribute("data-arise-tv") === "1") return;
    var geom = measureRing(ringEl);
    if (!geom) return;
    ensureStyles();
    ringEl.setAttribute("data-arise-tv", "1");
    if (getComputedStyle(ringEl).position === "static") {
      ringEl.style.position = "relative";
    }
    var pausedRing = buildPausedRing(geom);
    pausedRing.classList.add("arise-tv-paused-ring");
    ringEl.appendChild(pausedRing);

    var burst = document.createElement("div");
    burst.className = CLS_BURST;
    ringEl.appendChild(burst);

    var icon = document.createElement("div");
    icon.className = CLS_ICON;
    icon.style.display = "none";
    ringEl.appendChild(icon);

    var streak = document.createElement("div");
    streak.className = CLS_STREAK;
    streak.style.display = "none";
    streak.appendChild(document.createTextNode("🔥"));
    var streakCount = document.createElement("span");
    streak.appendChild(streakCount);
    ringEl.appendChild(streak);

    ringEl.__ariseTv = {
      icon: icon,
      streak: streak,
      streakCount: streakCount,
      burst: burst,
      pausedRing: pausedRing,
      lastIcon: null,
      lastStreak: null,
      lastPaused: null
    };
    syncRing(ringEl);
  }

  function playBurst(ringEl) {
    var state = ringEl.__ariseTv;
    if (!state) return;
    state.burst.classList.remove("active");
    void state.burst.offsetWidth;
    state.burst.classList.add("active");
    setTimeout(function () {
      state.burst.classList.remove("active");
    }, 700);
  }

  var mountedRings = [];

  function pruneDisconnected() {
    for (var i = mountedRings.length - 1; i >= 0; i--) {
      if (!mountedRings[i] || !mountedRings[i].isConnected) {
        mountedRings.splice(i, 1);
      }
    }
  }

  function discoverRings() {
    pruneDisconnected();
    var nodes = document.querySelectorAll(".timer-ring-container");
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i];
      mountRing(r);
      if (r.__ariseTv && mountedRings.indexOf(r) === -1) {
        mountedRings.push(r);
      }
    }
  }

  function syncAll() {
    pruneDisconnected();
    for (var i = 0; i < mountedRings.length; i++) {
      syncRing(mountedRings[i]);
    }
  }

  function burstAll() {
    pruneDisconnected();
    for (var i = 0; i < mountedRings.length; i++) {
      playBurst(mountedRings[i]);
    }
  }

  function runMuted(fn) {
    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.mute === "function") bus.mute(fn);
    else fn();
  }

  function onMutations(records) {
    if (document.hidden) return;
    var needsDiscover = false;
    var needsSync = false;
    if (Array.isArray(records) && records.length) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        var added = rec.addedNodes;
        if (added && added.length) {
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n && n.nodeType === 1) {
              if (
                (n.classList && n.classList.contains("timer-ring-container")) ||
                (n.querySelector && n.querySelector(".timer-ring-container"))
              ) {
                needsDiscover = true;
              }
              if (n.tagName === "BUTTON" || (n.querySelector && n.querySelector("button"))) {
                needsSync = true;
              }
            } else if (n && n.nodeType === 3 && mountedRings.length) {
              // Button text change (Start -> Pause -> Resume)
              var par = rec.target;
              if (par && par.tagName === "BUTTON") needsSync = true;
            }
          }
        }
      }
    } else {
      needsDiscover = true;
      needsSync = true;
    }
    if (!needsDiscover && !needsSync) return;
    runMuted(function () {
      if (needsDiscover) discoverRings();
      if (needsSync && mountedRings.length) syncAll();
    });
  }

  document.addEventListener("DOMContentLoaded", function () { runMuted(discoverRings); });
  window.addEventListener("load", function () { runMuted(discoverRings); });
  setTimeout(function () { runMuted(discoverRings); }, 500);

  document.addEventListener("change", function (ev) {
    if (mountedRings.length && ev.target && ev.target.tagName === "SELECT") {
      runMuted(syncAll);
    }
  });

  if (window.__ARISE_MUTATION_BUS__ && window.__ARISE_MUTATION_BUS__.subscribe) {
    window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
  } else {
    setInterval(function () {
      if (!document.hidden) runMuted(function () { discoverRings(); syncAll(); });
    }, 3000);
  }

  window.addEventListener("studySessions:updated", function () {
    cachedRawSessions = null;
    runMuted(function () {
      syncAll();
      burstAll();
    });
  });

  if (window.__ARISE_STORAGE_WATCH_BUS__ && window.__ARISE_STORAGE_WATCH_BUS__.watch) {
    window.__ARISE_STORAGE_WATCH_BUS__.watch("studySessions", function () {
      cachedRawSessions = null;
      runMuted(syncAll);
    });
  }
})();
