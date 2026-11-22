(function () {
  "use strict";
  if (window.__ARISE_SAAS_WIDGET_ENHANCER__) return;
  window.__ARISE_SAAS_WIDGET_ENHANCER__ = true;

  var DENSITY_KEY = "arise-ui-density-v1";
  var lastSectionTitle = "";
  var filterQuery = "";
  var debounceTimer = null;
  var scrollBoundMain = null;
  // Coalesces the "bar does not exist yet" fast path. During boot the route
  // container mutates dozens of times (React commits + widget mounts); running
  // the full widget discovery for each batch cost ~175 ms of main-thread time on
  // a 4x-throttled phone. The trailing debounce below still guarantees a scan
  // once the DOM settles, so the bar appears exactly as before.
  var lastSyncAt = 0;
  var SYNC_COALESCE_MS = 150;
  // While the bar does not exist yet, the first structural mutation must be
  // answered immediately: the bar has to be in the DOM before the route body
  // lays out, otherwise inserting it moves every card on the page (measured
  // 0.15 CLS). One immediate scan per BAR_SCAN_MS is enough to win that race
  // and still keeps a boot-time mutation storm from running discovery dozens
  // of times (that cost ~175 ms of main-thread time on a 4x-throttled phone).
  var lastBarScanAt = 0;
  var BAR_SCAN_MS = 250;

  function esc(val) {
    return String(val ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function cleanHeading(str) {
    return String(str || "")
      .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]+/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  }

  function runMuted(fn) {
    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.mute === "function") return bus.mute(fn);
    return fn();
  }

  function getMain() {
    return document.getElementById("arise-main");
  }

  function getSectionTitle(mainEl) {
    var h1 = mainEl && mainEl.querySelector("header h1");
    return h1 ? (h1.textContent || "").trim() : "";
  }

  function discoverWidgets(mainEl) {
    if (!mainEl) return [];
    var flexBody = mainEl.querySelector(":scope > div.flex-1");
    if (!flexBody) return [];
    // Supplemental Settings diagnostics may briefly precede the React route
    // during navigation. They are not the route's card container.
    var l1 =
      Array.prototype.find.call(flexBody.children, function (child) {
        return child.id !== "upp-data-health-card";
      }) || flexBody;
    var container = l1.firstElementChild || l1;
    // The Analytics error boundary is a layout wrapper, not a widget. Keep
    // existing quick-jump/filter discovery aimed at the actual chart cards.
    if (container.classList && container.classList.contains("arise-route-state")) {
      container = container.firstElementChild || container;
    }
    var candidates = [];
    var children = Array.prototype.slice.call(container.children || []);
    children.forEach(function (child) {
      if (!child || child.nodeType !== 1) return;
      if (child.classList && (child.classList.contains("wnav") || child.tagName === "NAV")) return;
      // Avoid getComputedStyle forced reflow across every top-level section card
      var inlineHidden =
        (child.hidden || (child.style && child.style.display === "none")) &&
        !child.hasAttribute("data-arise-filtered-out");
      if (inlineHidden) return;
      var cls = String(child.className || "");
      var isMultiGrid =
        /\bgrid\b/.test(cls) &&
        !/\b(glass|card|rounded-2xl|ptx|crt|exw|na-wrap|pw-wrap|csu|csp|att|cgpa|cp-wrap)\b/.test(
          cls
        );
      if (isMultiGrid && child.children.length >= 2 && child.children.length <= 8) {
        Array.prototype.slice.call(child.children).forEach(function (sub) {
          if (sub && sub.nodeType === 1) candidates.push(sub);
        });
      } else {
        candidates.push(child);
      }
    });

    var out = [];
    var seen = Object.create(null);
    candidates.forEach(function (el) {
      var h = el.querySelector(
        "h2, h3, [class*='-title'], [class*='-heading'], .lpa50-title, .ccc-title, .pcc-title, .dpe-title"
      );
      if (!h) return;
      var label = cleanHeading(h.textContent);
      if (!label || label.length < 2 || label.length > 54) return;
      var key = label.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        out.push({ el: el, label: label });
      }
    });
    return out;
  }

  function applyFilter(mainEl) {
    var list = discoverWidgets(mainEl);
    var q = filterQuery.trim().toLowerCase();
    var shown = 0;
    list.forEach(function (item) {
      if (!q) {
        if (item.el.hasAttribute("data-arise-filtered-out")) {
          item.el.removeAttribute("data-arise-filtered-out");
          item.el.style.display = "";
        }
        shown++;
        return;
      }
      var hay = (item.label + " " + (item.el.textContent || "").slice(0, 900)).toLowerCase();
      if (hay.indexOf(q) !== -1) {
        if (item.el.hasAttribute("data-arise-filtered-out")) {
          item.el.removeAttribute("data-arise-filtered-out");
          item.el.style.display = "";
        }
        shown++;
      } else {
        if (!item.el.hasAttribute("data-arise-filtered-out")) {
          item.el.setAttribute("data-arise-filtered-out", "true");
        }
        if (item.el.style.display !== "none") item.el.style.display = "none";
      }
    });
    var countEl = document.getElementById("arise-subbar-count");
    if (countEl) {
      var nextText = q ? shown + " / " + list.length + " widgets" : list.length + " widgets";
      if (countEl.textContent !== nextText) countEl.textContent = nextText;
    }
  }

  function clearFilteredOut(mainEl) {
    if (!mainEl) return;
    Array.prototype.slice
      .call(mainEl.querySelectorAll("[data-arise-filtered-out]"))
      .forEach(function (el) {
        el.removeAttribute("data-arise-filtered-out");
        el.style.display = "";
      });
  }

  function syncScrollTopBtn(mainEl) {
    var btn = document.getElementById("arise-scroll-top-btn");
    if (!mainEl) {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      scrollBoundMain = null;
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "arise-scroll-top-btn";
      btn.type = "button";
      btn.className = "arise-scroll-top-btn";
      btn.setAttribute("aria-label", "Top — scroll back to top of page");
      btn.innerHTML =
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m18 15-6-6-6 6'/></svg><span>Top</span>";
      btn.addEventListener("click", function () {
        var curMain = getMain();
        if (curMain) {
          curMain.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
      });
      document.body.appendChild(btn);
    }

    function updateVis() {
      var nextVis = mainEl.scrollTop > 380 ? "true" : "false";
      if (btn.getAttribute("data-visible") !== nextVis) {
        runMuted(function () {
          btn.setAttribute("data-visible", nextVis);
        });
      }
    }

    if (scrollBoundMain !== mainEl) {
      scrollBoundMain = mainEl;
      var scrollRaf = 0;
      mainEl.addEventListener(
        "scroll",
        function () {
          if (scrollRaf) return;
          var sched =
            typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout;
          scrollRaf = sched(function () {
            scrollRaf = 0;
            updateVis();
          }, 0);
        },
        { passive: true }
      );
    }
    updateVis();
  }

  function syncDensityBtn(btn) {
    if (!btn) return;
    var isCompact = document.documentElement.getAttribute("data-density") === "compact";
    var pressedStr = String(isCompact);
    var labelStr = isCompact ? "Compact ✓" : "Compact";
    if (btn.getAttribute("aria-pressed") !== pressedStr)
      btn.setAttribute("aria-pressed", pressedStr);
    if (btn.textContent !== labelStr) btn.textContent = labelStr;
  }

  var ASYNC_MULTI_SECTIONS = {
    Dashboard: 1,
    Learning: 1,
    "DSA Tracker": 1,
    Development: 1,
    Projects: 1,
    "CSE Syllabus": 1,
    Analytics: 1,
    Achievements: 1,
    Settings: 1
  };
  var routeSettleUntil = 0;
  var routeSettleTimer = null;
  var observedHeader = null;
  var headerObserver = null;

  function ensureHeaderObserver(mainEl) {
    if (!mainEl || typeof MutationObserver !== "function") return;
    var hdr = mainEl.querySelector(":scope > header");
    if (!hdr || hdr === observedHeader) return;
    observedHeader = hdr;
    if (headerObserver) headerObserver.disconnect();
    headerObserver = new MutationObserver(function () {
      var curMain = getMain();
      if (!curMain) return;
      var nextTitle = getSectionTitle(curMain);
      if (nextTitle !== lastSectionTitle) {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        syncEnhancements();
      }
    });
    headerObserver.observe(hdr, { childList: true, characterData: true, subtree: true });
  }

  // Creates the jump/filter bar and its handlers. Kept separate from the sync
  // logic so the bar can also be created early as a hidden placeholder (see
  // reserveBarSlot) without duplicating markup or listeners.
  function ensureBar(hdr) {
    var bar = document.createElement("div");
    bar.id = "arise-page-widget-bar";
    bar.className = "arise-page-widget-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Page widget quick jump and filter");
    bar.innerHTML =
      "<div class='arise-pwb-inner'><div class='arise-pwb-left'><span id='arise-subbar-count' class='arise-pwb-count'></span><div id='arise-subbar-chips' class='arise-pwb-chips' role='navigation' aria-label='Jump to widget'></div></div><div class='arise-pwb-right'><div class='arise-pwb-filter'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><polygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'/></svg><input id='arise-pwb-input' type='search' autocomplete='off' placeholder='Filter widgets\u2026' aria-label='Filter widgets on this page'></div><button id='arise-pwb-density' type='button' class='arise-pwb-density' title='Toggle Compact / Standard card density'></button></div></div>";

    var input = bar.querySelector("#arise-pwb-input");
    input.addEventListener("input", function () {
      filterQuery = input.value || "";
      runMuted(function () {
        applyFilter(getMain());
      });
    });

    var densityBtn = bar.querySelector("#arise-pwb-density");
    densityBtn.addEventListener("click", function () {
      var root = document.documentElement;
      var next = root.getAttribute("data-density") === "compact" ? "comfortable" : "compact";
      if (next === "compact") root.setAttribute("data-density", "compact");
      else root.removeAttribute("data-density");
      try {
        localStorage.setItem(DENSITY_KEY, next);
      } catch {}
      syncDensityBtn(densityBtn);
    });

    bar.querySelector("#arise-subbar-chips").addEventListener("click", function (ev) {
      var chip =
        ev.target && ev.target.closest ? ev.target.closest("[data-arise-jump-idx]") : null;
      if (!chip) return;
      var idx = Number(chip.getAttribute("data-arise-jump-idx"));
      var curList = discoverWidgets(getMain());
      var target = curList[idx] && curList[idx].el;
      if (!target) return;
      if (target.hasAttribute("data-arise-filtered-out")) {
        filterQuery = "";
        var inp = document.getElementById("arise-pwb-input");
        if (inp) inp.value = "";
        applyFilter(getMain());
      }
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start"
      });
      target.classList.add("arise-widget-spotlight");
      setTimeout(function () {
        target.classList.remove("arise-widget-spotlight");
      }, 1300);
    });

    hdr.insertAdjacentElement("afterend", bar);
    return bar;
  }


  function syncEnhancementsCore() {
    var mainEl = getMain();
    syncScrollTopBtn(mainEl);
    ensureHeaderObserver(mainEl);
    var bar = document.getElementById("arise-page-widget-bar");
    if (!mainEl || document.documentElement.classList.contains("arise-focus-active")) {
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      return;
    }
    var title = getSectionTitle(mainEl);
    if (title !== lastSectionTitle) {
      lastSectionTitle = title;
      if (filterQuery) {
        filterQuery = "";
        clearFilteredOut(mainEl);
      }
      if (window.__ariseWidgetsReady && ASYNC_MULTI_SECTIONS[title]) {
        routeSettleUntil = Date.now() + 260;
        if (routeSettleTimer) clearTimeout(routeSettleTimer);
        routeSettleTimer = setTimeout(function () {
          routeSettleTimer = null;
          syncEnhancements();
        }, 270);
      } else {
        routeSettleUntil = 0;
      }
    }
    var widgets = discoverWidgets(mainEl);
    var routeLoading = !!mainEl.querySelector("[data-arise-route-loading]");
    var asyncSettling = !!(
      window.__ariseWidgetsReady &&
      ASYNC_MULTI_SECTIONS[title] &&
      Date.now() < routeSettleUntil
    );
    if (widgets.length < 3 && !routeLoading && !asyncSettling) {
      // The reserved strip is kept while the widget payload is still
      // streaming: dropping it here and adding the bar again a moment later
      // moved the whole route body (75 px at 390 px wide). Once the payload has
      // settled, a route with fewer than three widgets really has no bar.
      if (bar && bar.hasAttribute("data-arise-bar-pending") && !window.__ariseWidgetsSettled) {
        bar.style.visibility = "hidden";
        return;
      }
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      return;
    }
    var hdr = mainEl.querySelector(":scope > header");
    if (!hdr) return;

    if (!bar) bar = ensureBar(hdr);

    if (bar.previousElementSibling !== hdr) {
      hdr.insertAdjacentElement("afterend", bar);
    }

    // Preserve the bar's footprint while a lazy route or external widget mount is pending.
    // Removing it and reinserting it after the asset/widget loads shifted the entire route body.
    var pending = (routeLoading || asyncSettling) && widgets.length < 3;
    bar.style.visibility = pending ? "hidden" : "";
    bar.inert = pending;
    if (pending) {
      bar.setAttribute("aria-hidden", "true");
      return;
    }
    bar.removeAttribute("aria-hidden");
    bar.removeAttribute("data-arise-bar-pending");

    var inpEl = bar.querySelector("#arise-pwb-input");
    if (inpEl && document.activeElement !== inpEl && inpEl.value !== filterQuery) {
      inpEl.value = filterQuery;
    }
    syncDensityBtn(bar.querySelector("#arise-pwb-density"));

    var chipsHtml = widgets
      .slice(0, 14)
      .map(function (w, idx) {
        return (
          "<button type='button' class='arise-pwb-chip' data-arise-jump-idx='" +
          idx +
          "'>" +
          esc(w.label) +
          "</button>"
        );
      })
      .join("");
    var chipsBox = bar.querySelector("#arise-subbar-chips");
    if (chipsBox && chipsBox.__lastHtml !== chipsHtml) {
      chipsBox.__lastHtml = chipsHtml;
      chipsBox.innerHTML = chipsHtml;
    }

    var countBox = bar.querySelector("#arise-subbar-count");
    if (countBox && !filterQuery) {
      var labelCount = widgets.length + " widgets";
      if (countBox.textContent !== labelCount) countBox.textContent = labelCount;
    }
  }

  // Reserves the bar's strip before the route body is painted. The bar can only
  // be populated once the widget cards exist (~0.7 s); inserting it at that
  // point pushed the whole dashboard down by its own height (measured ~0.15
  // CLS). Creating the same element up front, hidden, keeps the space and the
  // later sync only fills it in. The normal "not enough widgets" guard removes
  // it again on routes that do not get a bar.
  var barSlotReserved = false;
  var barSlotObserver = null;
  function reserveBarSlot() {
    if (barSlotReserved) return true;
    var mainEl = getMain();
    if (!mainEl) return false;
    if (document.documentElement.classList.contains("arise-focus-active")) return false;
    var hdr = mainEl.querySelector(":scope > header");
    if (!hdr) return false;
    barSlotReserved = true;
    if (barSlotObserver) {
      barSlotObserver.disconnect();
      barSlotObserver = null;
    }
    if (document.getElementById("arise-page-widget-bar")) return true;
    var bar = ensureBar(hdr);
    // Placeholder chips, not empty markup: below 600 px the bar wraps to two
    // rows only once chips exist (44 px empty vs ~116 px populated), so an
    // empty placeholder would reserve the wrong height and still move the page.
    // The first real sync replaces them before the bar is ever shown.
    var placeholderChips = bar.querySelector("#arise-subbar-chips");
    if (placeholderChips) {
      placeholderChips.innerHTML =
        "<span class='arise-pwb-chip' aria-hidden='true'></span><span class='arise-pwb-chip' aria-hidden='true'></span><span class='arise-pwb-chip' aria-hidden='true'></span>";
    }
    bar.style.visibility = "hidden";
    bar.inert = true;
    bar.setAttribute("aria-hidden", "true");
    bar.setAttribute("data-arise-bar-pending", "");
    return true;
  }

  // The route container is mounted by React after the cloud gate resolves, so
  // the first call usually finds nothing. Watch for the header once and reserve
  // as soon as it exists.
  function armBarSlotReservation() {
    if (barSlotReserved || reserveBarSlot()) return;
    if (typeof MutationObserver !== "function" || !document.body) return;
    if (barSlotObserver) return;
    barSlotObserver = new MutationObserver(function () {
      if (reserveBarSlot() && barSlotObserver) {
        barSlotObserver.disconnect();
        barSlotObserver = null;
      }
    });
    barSlotObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      if (barSlotObserver) {
        barSlotObserver.disconnect();
        barSlotObserver = null;
      }
    }, 20000);
  }

  function syncEnhancements() {
    lastSyncAt = Date.now();
    runMuted(syncEnhancementsCore);
  }

  function hasStructuralMainChange(records) {
    if (!Array.isArray(records) || !records.length) return true;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var t = rec.target;
      if (
        t &&
        t.closest &&
        t.closest(
          "#arise-page-widget-bar, #arise-scroll-top-btn, #upp-command-overlay, #upp-shortcuts-overlay, .recharts-tooltip-wrapper"
        )
      ) {
        continue;
      }
      var added = rec.addedNodes;
      if (added && added.length) {
        for (var j = 0; j < added.length; j++) {
          if (added[j] && added[j].nodeType === 1) return true;
        }
      }
      var removed = rec.removedNodes;
      if (removed && removed.length) {
        for (var k = 0; k < removed.length; k++) {
          if (removed[k] && removed[k].nodeType === 1) return true;
        }
      }
    }
    return false;
  }

  function onMutations(records) {
    if (document.hidden) return;
    if (!hasStructuralMainChange(records)) return;
    if (
      !document.getElementById("arise-page-widget-bar") &&
      document.getElementById("arise-main") &&
      Date.now() - lastBarScanAt > BAR_SCAN_MS
    ) {
      lastBarScanAt = Date.now();
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      syncEnhancements();
      return;
    }
    if (!debounceTimer) {
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        syncEnhancements();
      }, 140);
    }
  }

  function boot() {
    try {
      if (localStorage.getItem(DENSITY_KEY) === "compact") {
        document.documentElement.setAttribute("data-density", "compact");
      }
    } catch {}
    armBarSlotReservation();
    syncEnhancements();
    if (window.__ARISE_MUTATION_BUS__) {
      window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
    } else if (typeof MutationObserver === "function" && document.body) {
      var mo = new MutationObserver(onMutations);
      mo.observe(document.body, { childList: true, subtree: true });
      window.addEventListener(
        "arise:widgets-ready",
        function () {
          if (window.__ARISE_MUTATION_BUS__) {
            mo.disconnect();
            window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
          }
        },
        { once: true }
      );
    }
    window.addEventListener("arise:widgets-ready", function () {
      syncEnhancements();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
