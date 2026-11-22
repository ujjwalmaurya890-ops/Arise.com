/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
// Stability patch: the React shell calls window.__mountX(el) exactly once, in a
// useEffect, when a section appears. The ~100 widget scripts load lazily after
// first paint, so a section opened (or restored) before its widget script had
// executed silently stayed blank until the user navigated away and back. These
// stubs remember such early calls; the loader replays them (only for elements
// still in the DOM) once every widget script has executed, using the FINAL
// definition of each mount function. Real definitions simply overwrite a stub.
(function () {
  var NAMES = [
    "__mountAttendanceTracker",
    "__mountBackupCenter",
    "__mountBattlePlan",
    "__mountBurnoutDetector",
    "__mountCGPATracker",
    "__mountCSEPlacementCritical",
    "__mountCareerCommandCenter",
    "__mountCertificates",
    "__mountCompetitiveProgramming",
    "__mountDevMasteryHeatmap",
    "__mountExamTracker",
    "__mountExamTrackerDashboard",
    "__mountExpenses",
    "__mountFocusModeToggle",
    "__mountHabitHeatmap",
    "__mountHackathonTracker",
    "__mountInterviewSheets",
    "__mountLocalFiles",
    "__mountNotesApp",
    "__mountPersonalWiki",
    "__mountPlacementTracker",
    "__mountProjectsWidget",
    "__mountRevisionSystem",
    "__mountSemesterMastery",
    "__mountSkillsTimeline",
    "__mountSmartLearningPath",
    "__mountSocialMedia",
    "__mountWaterReminder"
  ];
  var DEFERRED_MOUNTS = {
    __mountAttendanceTracker: 1,
    __mountBackupCenter: 1,
    __mountCGPATracker: 1,
    __mountCSEPlacementCritical: 1,
    __mountCertificates: 1,
    __mountCompetitiveProgramming: 1,
    __mountExamTracker: 1,
    __mountExpenses: 1,
    __mountHackathonTracker: 1,
    __mountLocalFiles: 1,
    __mountNotesApp: 1,
    __mountPersonalWiki: 1,
    __mountPlacementTracker: 1,
    __mountProjectsWidget: 1,
    __mountSemesterMastery: 1,
    __mountSocialMedia: 1
  };
  var queue = (window.__ariseMountQueue = []);
  var failedQueue = (window.__ariseFailedMounts = []);
  var flushing = false;
  // Content-shaped placeholders from the shared loading design system.
  var MOUNT_SHAPES = {
    __mountAttendanceTracker: "dashboard",
    __mountCGPATracker: "dashboard",
    __mountCompetitiveProgramming: "dashboard",
    __mountExamTracker: "dashboard",
    __mountExpenses: "dashboard",
    __mountHackathonTracker: "cards",
    __mountPlacementTracker: "dashboard",
    __mountSemesterMastery: "chart-progress",
    __mountCareerCommandCenter: "chart-area",
    __mountDevMasteryHeatmap: "chart-heatmap",
    __mountHabitHeatmap: "chart-heatmap",
    __mountInterviewSheets: "table",
    __mountCertificates: "table",
    __mountProjectsWidget: "cards",
    __mountLocalFiles: "list",
    __mountNotesApp: "notes",
    __mountPersonalWiki: "notes",
    __mountSocialMedia: "feed",
    __mountBackupCenter: "form",
    __mountSkillsTimeline: "timeline",
    __mountRevisionSystem: "calendar",
    __mountBattlePlan: "cards",
    __mountBurnoutDetector: "analytics",
    __mountSmartLearningPath: "timeline",
    __mountExamTrackerDashboard: "analytics"
  };
  // These optional hooks have no implementation in the checked-in build.
  var UNAVAILABLE_MOUNTS = { __mountCSEPlacementCritical: 1, __mountSemesterMastery: 1 };
  function renderMountSkeleton(el, isFullSection, name) {
    if (!el || el.nodeType !== 1 || el.children.length) return;
    var label = (name || "Widget").replace(/^__mount/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    var loading = window.AriseLoading;
    var system = window.AriseAnimationUpgrade;
    var kind = MOUNT_SHAPES[name] || (isFullSection ? "dashboard" : "widget");
    el.setAttribute("aria-busy", "true");
    if (loading && typeof loading.skeleton === "function") {
      var mountOpts = {
        label: "Loading " + label + "…",
        height: isFullSection ? "280px" : null
      };
      if (typeof loading.mount === "function") loading.mount(el, kind, mountOpts);
      else el.innerHTML = loading.skeleton(kind, mountOpts);
      el.firstElementChild.setAttribute("data-arise-skeleton", "1");
    } else if (system && typeof system.renderSkeleton === "function") {
      var legacy = {
        dashboard: "dashboard",
        table: "table",
        list: "list",
        form: "form",
        widget: "widget"
      };
      var legacyVariant =
        legacy[kind] ||
        (kind.indexOf("chart") === 0 ? "chart" : isFullSection ? "dashboard" : "widget");
      el.innerHTML = system.renderSkeleton({
        variant: legacyVariant,
        label: "Loading " + label + "…",
        minHeight: isFullSection ? "280px" : null
      });
      el.firstElementChild.setAttribute("data-arise-skeleton", "1");
    } else {
      // The shared runtime normally loads first; keep an accessible fallback.
      el.innerHTML =
        '<div class="arise-mount-skeleton" data-arise-skeleton="1" role="status"><span class="uxa-sr-only">Loading widget…</span><div class="arise-mount-skeleton__bar arise-mount-skeleton__bar--title" aria-hidden="true"></div><div class="arise-mount-skeleton__bar arise-mount-skeleton__bar--stat" aria-hidden="true"></div></div>';
    }
  }
  function renderMountFailure(el, item) {
    if (!el || el.nodeType !== 1) return;
    el.removeAttribute("aria-busy");
    if (UNAVAILABLE_MOUNTS[item.name]) {
      el.innerHTML =
        '<div class="uxa-empty-state" data-arise-mount-error="1"><div class="uxa-state-title">Panel unavailable</div><div class="uxa-state-desc">This optional panel is not included in this version. Your syllabus and saved progress are still available.</div></div>';
      return;
    }
    el.innerHTML =
      '<div class="uxa-error-state" data-arise-mount-error="1" role="alert">' +
      '<div class="uxa-state-title">Widget could not be loaded</div>' +
      '<div class="uxa-state-desc">A network or script error prevented this module from loading. Your saved data is safe.</div>' +
      '<button type="button" class="uxa-retry-btn" data-arise-mount-retry="1">Retry loading module</button>' +
      "</div>";
    var btn = el.querySelector("[data-arise-mount-retry]");
    if (btn) {
      btn.addEventListener("click", function () {
        el.innerHTML = "";
        renderMountSkeleton(el, !!DEFERRED_MOUNTS[item.name], item.name);
        var already = false;
        for (var k = 0; k < queue.length; k++) {
          if (queue[k].name === item.name && queue[k].args[0] === el) {
            already = true;
            break;
          }
        }
        if (!already) queue.push(item);
        if (typeof window.__ariseLoadForMount === "function")
          window.__ariseLoadForMount(item.name);
        if (typeof window.__ariseRetryWidgetScripts === "function") {
          window.__ariseRetryWidgetScripts();
        } else if (typeof window.__ariseFlushMounts === "function") {
          window.__ariseFlushMounts();
        }
      });
    }
  }
  NAMES.forEach(function (name) {
    if (typeof window[name] === "function") return;
    var stub = function () {
      if (flushing) return;
      var el = arguments[0];
      var args = Array.prototype.slice.call(arguments);
      // The widget's chunk can legitimately not be in memory yet: chunks now
      // arrive with the screen that needs them instead of all at startup. Only
      // report a failure when that chunk is known to have failed, or when the
      // whole widget set has settled and this hook has no chunk at all.
      var chunk = typeof window.__ariseMountChunk === "function" ? window.__ariseMountChunk(name) : null;
      var chunkFailed =
        typeof window.__ariseMountChunkFailed === "function" && window.__ariseMountChunkFailed(name);
      // No chunk mapping at all = an optional panel this build does not ship
      // (see UNAVAILABLE_MOUNTS). Waiting for every chunk to be attempted would
      // leave those as endless skeletons on data-saver connections, where the
      // background chunks are deliberately never fetched.
      if (chunkFailed || (!chunk && window.__ariseWidgetsReady)) {
        renderMountFailure(el, { name: name, args: args });
        return;
      }
      // Ask for just the chunk that owns this widget (the loader still runs the
      // earlier chunks first, so load order is unchanged). Sections used to
      // trigger a full "load every remaining chunk" burst, which made the first
      // route opened on a slow connection download the whole widget payload.
      if (typeof window.__ariseLoadForMount === "function") window.__ariseLoadForMount(name);
      else if (typeof window.__ariseExpedite === "function") window.__ariseExpedite();
      renderMountSkeleton(el, !!DEFERRED_MOUNTS[name], name);
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].name === name && queue[i].args[0] === el) return;
      }
      queue.push({ name: name, args: args });
    };
    stub.__ariseStub = true;
    window[name] = stub;
  });
  function isStub(fn) {
    return !!(fn && (fn.__ariseStub || (fn.__ariseOriginal && fn.__ariseOriginal.__ariseStub)));
  }
  function clearSkeleton(el) {
    if (
      el &&
      el.nodeType === 1 &&
      el.firstElementChild &&
      (el.firstElementChild.hasAttribute("data-arise-skeleton") ||
        el.firstElementChild.hasAttribute("data-arise-mount-error")) &&
      el.children.length === 1
    ) {
      el.innerHTML = "";
      el.removeAttribute("aria-busy");
    }
  }
  var MULTI_STAGE_MOUNTS = {
    __mountSemesterMastery: 1,
    __mountLocalFiles: 1,
    __mountPlacementTracker: 1
  };
  window.__ariseFlushReadyMounts = function () {
    if (!queue.length || flushing) return;
    flushing = true;
    try {
      for (var i = queue.length - 1; i >= 0; i--) {
        var item = queue[i];
        if (MULTI_STAGE_MOUNTS[item.name]) continue;
        var fn = window[item.name];
        if (typeof fn !== "function" || isStub(fn)) continue;
        queue.splice(i, 1);
        try {
          var el = item.args[0];
          if (el && el.isConnected === false) continue;
          clearSkeleton(el);
          fn.apply(window, item.args);
        } catch (err) {
          console.error("[mount-replay] " + item.name + " threw:", err);
          renderMountFailure(item.args[0], item);
        }
      }
    } finally {
      flushing = false;
    }
  };
  window.__ariseFlushMounts = function () {
    var pending = queue.splice(0, queue.length);
    flushing = true;
    try {
      pending.forEach(function (item) {
        try {
          var el = item.args[0];
          if (el && el.isConnected === false) return;
          var fn = window[item.name];
          if (typeof fn === "function" && !isStub(fn)) {
            clearSkeleton(el);
            fn.apply(window, item.args);
          } else if (window.__ariseWidgetsSettled) {
            failedQueue.push(item);
            renderMountFailure(el, item);
          } else {
            queue.push(item);
          }
        } catch (err) {
          console.error("[mount-replay] " + item.name + " threw:", err);
          renderMountFailure(item.args[0], item);
        }
      });
    } finally {
      flushing = false;
    }
  };
})();
