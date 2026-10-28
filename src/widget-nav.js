(function () {
  "use strict";
  if (window.AriseWidgetNav) return;

  function esc(val) {
    return String(val ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function readSaved(key, sections, fallback) {
    if (!key) return fallback;
    try {
      var val = localStorage.getItem(key);
      if (val && sections.some(function (s) { return s.id === val; })) return val;
    } catch {}
    return fallback;
  }

  function writeSaved(key, val) {
    if (key) {
      try {
        localStorage.setItem(key, val);
      } catch {}
    }
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  }

  var seq = 0;
  function nextId() {
    return "awnav-" + ++seq + "-" + Math.random().toString(36).slice(2, 6);
  }

  var liveEl = null;
  function announce(sec) {
    if (!sec) return;
    if (!liveEl) {
      liveEl = document.createElement("div");
      liveEl.setAttribute("role", "status");
      liveEl.setAttribute("aria-live", "polite");
      liveEl.className = "wnav-sr-only";
      document.body.appendChild(liveEl);
    }
    liveEl.textContent = sec.label + " tab selected";
  }

  // Single shared resize registry that automatically prunes disconnected tablists
  var resizeEntries = [];
  var resizeBound = false;
  var resizeRaf = 0;

  function registerResize(rail, fn) {
    resizeEntries.push({ rail: rail, fn: fn });
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener(
      "resize",
      function () {
        if (resizeRaf) return;
        var sched = typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout;
        resizeRaf = sched(function () {
          resizeRaf = 0;
          for (var i = resizeEntries.length - 1; i >= 0; i--) {
            var entry = resizeEntries[i];
            if (!entry.rail || (entry.rail.isConnected === false)) {
              resizeEntries.splice(i, 1);
              continue;
            }
            entry.fn();
          }
        }, 0);
      },
      { passive: true }
    );
  }

  // Shared "Back to tabs" button + tracked IntersectionObservers so detached rails are unobserved
  var backBtn = null;
  var activeScrolledRail = null;

  function ensureBackBtn() {
    if (backBtn) return backBtn;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wnav-back-to-tabs";
    btn.textContent = "↑ Tabs";
    btn.hidden = true;
    btn.addEventListener("click", function () {
      if (activeScrolledRail && typeof activeScrolledRail.scrollIntoView === "function") {
        activeScrolledRail.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start"
        });
      }
      btn.hidden = true;
    });
    document.body.appendChild(btn);
    backBtn = btn;
    return btn;
  }

  function observeBackToTabs(rail) {
    if (!rail || rail.__wnavBackToTabsInit) return;
    rail.__wnavBackToTabsInit = true;
    if (typeof IntersectionObserver !== "function") return;
    var btn = ensureBackBtn();
    var io = new IntersectionObserver(
      function (entries) {
        if (rail.isConnected === false) {
          if (activeScrolledRail === rail) {
            btn.hidden = true;
            activeScrolledRail = null;
          }
          io.disconnect();
          return;
        }
        var first = entries[0];
        if (!first) return;
        if (first.isIntersecting) {
          if (activeScrolledRail === rail) {
            btn.hidden = true;
            activeScrolledRail = null;
          }
        } else if (first.boundingClientRect.top < 0) {
          activeScrolledRail = rail;
          btn.hidden = false;
        }
      },
      { threshold: 0 }
    );
    rail.__wnavIO = io;
    io.observe(rail);
  }

  function wireScrollStateAndChevrons(rail) {
    if (!rail || rail.__wnavScrollInit) return;
    rail.__wnavScrollInit = true;

    var prevBtn = null;
    var nextBtn = null;
    var finePointer = false;
    try {
      finePointer = !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
    } catch {}

    if (finePointer) {
      prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "wnav-chevron wnav-chevron-prev";
      prevBtn.setAttribute("aria-label", "Scroll tabs left");
      prevBtn.setAttribute("tabindex", "-1");
      prevBtn.innerHTML = "‹";

      nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "wnav-chevron wnav-chevron-next";
      nextBtn.setAttribute("aria-label", "Scroll tabs right");
      nextBtn.setAttribute("tabindex", "-1");
      nextBtn.innerHTML = "›";

      var scrollByStep = function (delta) {
        rail.scrollBy({ left: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      };
      prevBtn.addEventListener("click", function () { scrollByStep(-140); });
      nextBtn.addEventListener("click", function () { scrollByStep(140); });

      var parent = rail.parentNode;
      if (parent) {
        if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
        parent.classList.add("wnav-chevron-wrap");
        parent.insertBefore(prevBtn, rail);
        parent.insertBefore(nextBtn, rail.nextSibling);
      }
    }

    var rafId = 0;
    function syncScrollIndicators() {
      rafId = 0;
      if (rail.isConnected === false) return;
      var sl = rail.scrollLeft;
      var maxScroll = rail.scrollWidth - rail.clientWidth;
      var hasStart = sl > 4;
      var hasEnd = sl < maxScroll - 4;
      if (rail.classList.contains("wnav--scroll-start") !== hasStart) {
        rail.classList.toggle("wnav--scroll-start", hasStart);
      }
      if (rail.classList.contains("wnav--scroll-end") !== hasEnd) {
        rail.classList.toggle("wnav--scroll-end", hasEnd);
      }
      if (prevBtn && nextBtn) {
        var overflow = maxScroll > 4;
        if (prevBtn.hidden !== !overflow) prevBtn.hidden = !overflow;
        if (nextBtn.hidden !== !overflow) nextBtn.hidden = !overflow;
      }
    }

    function scheduleSync() {
      if (rafId) return;
      var sched = typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout;
      rafId = sched(syncScrollIndicators, 0);
    }

    rail.addEventListener("scroll", scheduleSync, { passive: true });
    if (prevBtn && nextBtn) registerResize(rail, scheduleSync);
    scheduleSync();
  }

  function wireSwipe(host, stepFn) {
    if (!host || !stepFn || host.__wnavSwipeInit) return;
    host.__wnavSwipeInit = true;
    var startX = 0;
    var startY = 0;
    var tracking = false;
    host.addEventListener(
      "touchstart",
      function (ev) {
        if (!ev.touches || ev.touches.length !== 1) {
          tracking = false;
          return;
        }
        var panel = ev.target.closest("[data-wnav-panel]");
        if (!panel) {
          tracking = false;
          return;
        }
        if (
          ev.target.closest(
            'input, textarea, select, [data-wnav-id], .att-cal-grid, .att-heat-grid, [class*="scroll"], [style*="overflow"]'
          )
        ) {
          tracking = false;
          return;
        }
        startX = ev.touches[0].clientX;
        startY = ev.touches[0].clientY;
        tracking = true;
      },
      { passive: true }
    );
    host.addEventListener(
      "touchend",
      function (ev) {
        if (!tracking) return;
        tracking = false;
        var touch = ev.changedTouches && ev.changedTouches[0];
        if (!touch) return;
        var dx = touch.clientX - startX;
        var dy = touch.clientY - startY;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        stepFn(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );
  }

  function create(opts) {
    opts = opts || {};
    var sections = opts.sections || [];
    var storageKey = opts.storageKey || null;
    var defaultSection = opts.defaultSection || (sections[0] && sections[0].id);
    var activeId = readSaved(storageKey, sections, defaultSection);
    var factories = {};
    var navUid = nextId();
    var lastWiredActiveId = null;

    function tabDomId(id) {
      return navUid + "-tab-" + id;
    }
    function panelDomId(id) {
      return navUid + "-panel-" + id;
    }

    function navHtml() {
      if (!sections.length) return "";
      return (
        '<div class="wnav' +
        (opts.sticky ? " wnav--sticky" : "") +
        '" data-wnav-root role="tablist" aria-orientation="horizontal" id="' +
        navUid +
        '" aria-label="' +
        esc(opts.label || "Navigation") +
        '">' +
        sections
          .map(function (sec) {
            var isAct = sec.id === activeId;
            return (
              '<button type="button" class="wnav-pill' +
              (isAct ? " wnav-pill-active" : "") +
              '" data-wnav-id="' +
              esc(sec.id) +
              '" id="' +
              tabDomId(sec.id) +
              '" role="tab" aria-selected="' +
              isAct +
              '" aria-controls="' +
              panelDomId(sec.id) +
              '" tabindex="' +
              (isAct ? "0" : "-1") +
              '">' +
              (sec.icon ? '<span class="wnav-icon" aria-hidden="true">' + sec.icon + "</span>" : "") +
              "<span>" +
              esc(sec.label) +
              "</span></button>"
            );
          })
          .join("") +
        "</div>"
      );
    }

    function panelWrap(id, content) {
      var isAct = id === activeId;
      var isFn = typeof content === "function";
      if (isFn) factories[id] = content;
      var inner = isFn ? (isAct ? content() : "") : content;
      var rehyd = isAct && lastWiredActiveId === activeId ? ' data-wnav-rehydrated="1"' : "";
      return (
        '<div class="wnav-panel" data-wnav-panel="' +
        esc(id) +
        '" id="' +
        panelDomId(id) +
        '" role="tabpanel" aria-labelledby="' +
        tabDomId(id) +
        '"' +
        rehyd +
        (isAct ? "" : " hidden") +
        ">" +
        inner +
        "</div>"
      );
    }

    function syncAria(host, isUserTabSwitch) {
      if (!host) return;
      host.querySelectorAll("[data-wnav-root] [data-wnav-id]").forEach(function (btn) {
        var isAct = btn.getAttribute("data-wnav-id") === activeId;
        if (btn.classList.contains("wnav-pill-active") !== isAct) {
          btn.classList.toggle("wnav-pill-active", isAct);
        }
        var selStr = String(isAct);
        if (btn.getAttribute("aria-selected") !== selStr) btn.setAttribute("aria-selected", selStr);
        var tabIdx = isAct ? "0" : "-1";
        if (btn.getAttribute("tabindex") !== tabIdx) btn.setAttribute("tabindex", tabIdx);
      });
      host.querySelectorAll("[data-wnav-panel]").forEach(function (panel) {
        var isAct = panel.getAttribute("data-wnav-panel") === activeId;
        if (isAct) {
          if (isUserTabSwitch) panel.removeAttribute("data-wnav-rehydrated");
          if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
        } else if (!panel.hasAttribute("hidden")) {
          panel.setAttribute("hidden", "");
        }
      });
    }

    function hydrateActive(host) {
      if (!host) return;
      var fn = factories[activeId];
      if (!fn) return;
      var panel = host.querySelector('[data-wnav-panel="' + activeId + '"]');
      if (panel && !panel.hasChildNodes() && !panel.textContent) {
        panel.innerHTML = fn();
      }
    }

    function scrollActivePillIntoView(host, allowSmooth) {
      if (!host) return;
      var pill = host.querySelector('[data-wnav-id="' + activeId + '"]');
      if (!pill || typeof pill.scrollIntoView !== "function") return;
      // Only smooth-scroll on explicit tab changes; initial/re-render wire uses auto to avoid forced scroll jitter
      var behavior = allowSmooth && !prefersReducedMotion() ? "smooth" : "auto";
      var parentRail = pill.closest("[data-wnav-root]");
      if (parentRail && parentRail.scrollWidth <= parentRail.clientWidth + 4) return;
      pill.scrollIntoView({ behavior: behavior, block: "nearest", inline: "center" });
    }

    function setActive(id, host, setOpts) {
      if (!sections.some(function (s) { return s.id === id; }) || id === activeId) return;
      activeId = id;
      lastWiredActiveId = id;
      writeSaved(storageKey, id);
      syncAria(host, true);
      hydrateActive(host);
      scrollActivePillIntoView(host, true);
      if (!setOpts || !setOpts.silent) {
        announce(sections.find(function (s) { return s.id === id; }));
      }
    }

    function stepTab(dir, host) {
      var idx = sections.findIndex(function (s) { return s.id === activeId; });
      if (idx < 0) return;
      var nextIdx = (idx + dir + sections.length) % sections.length;
      setActive(sections[nextIdx].id, host);
    }

    function handleKeydown(ev, host) {
      var rail = ev.target.closest("[data-wnav-root]");
      if (!rail || !host.contains(rail)) return;
      var pills = Array.from(rail.querySelectorAll("[data-wnav-id]"));
      var idx = pills.indexOf(ev.target);
      if (idx < 0) return;
      var nextIdx = -1;
      if (ev.key === "ArrowRight" || ev.key === "ArrowDown") nextIdx = (idx + 1) % pills.length;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") nextIdx = (idx - 1 + pills.length) % pills.length;
      if (ev.key === "Home") nextIdx = 0;
      if (ev.key === "End") nextIdx = pills.length - 1;
      if (nextIdx >= 0) {
        ev.preventDefault();
        var nextTabId = pills[nextIdx].getAttribute("data-wnav-id");
        setActive(nextTabId, host);
        var nextPill = host.querySelector('[data-wnav-id="' + nextTabId + '"]');
        if (nextPill) nextPill.focus();
        return;
      }
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        var curId = ev.target.getAttribute("data-wnav-id");
        if (curId) setActive(curId, host);
      }
    }

    function wire(host, wireOpts) {
      if (!host) return;
      wireOpts = wireOpts || {};
      var isRewireSameTab = lastWiredActiveId === activeId;
      if (isRewireSameTab) {
        var curPanel = host.querySelector('[data-wnav-panel="' + activeId + '"]');
        if (curPanel) curPanel.setAttribute("data-wnav-rehydrated", "1");
      }
      lastWiredActiveId = activeId;
      // Disconnect any previous IntersectionObserver owned by this host before wiring a newly rendered rail
      if (host.__wnavActiveRail && host.__wnavActiveRail.__wnavIO) {
        var oldRail = host.__wnavActiveRail;
        var newRailCheck = host.querySelector("[data-wnav-root]");
        if (oldRail !== newRailCheck) {
          try { oldRail.__wnavIO.disconnect(); } catch {}
        }
      }
      syncAria(host, false);
      hydrateActive(host);
      scrollActivePillIntoView(host, false);
      var rail = host.querySelector("[data-wnav-root]");
      host.__wnavActiveRail = rail || null;
      if (rail && !rail.__wnavEventsBound) {
        rail.__wnavEventsBound = true;
        rail.addEventListener("click", function (ev) {
          var pill = ev.target.closest("[data-wnav-id]");
          if (!pill || !rail.contains(pill)) return;
          var nextTabId = pill.getAttribute("data-wnav-id");
          if (nextTabId && nextTabId !== activeId) {
            setActive(nextTabId, host);
            if (typeof wireOpts.onChange === "function") wireOpts.onChange(nextTabId);
          }
        });
        rail.addEventListener("keydown", function (ev) {
          handleKeydown(ev, host);
        });
        wireScrollStateAndChevrons(rail);
        wireSwipe(host, sections.length > 1 ? function (dir) { stepTab(dir, host); } : null);
        if (!opts.sticky) observeBackToTabs(rail);
      }
    }

    return {
      navHtml: navHtml,
      panelWrap: panelWrap,
      wire: wire,
      setActive: setActive,
      getActive: function () { return activeId; },
      sections: sections
    };
  }

  window.AriseWidgetNav = { create: create };
})();
