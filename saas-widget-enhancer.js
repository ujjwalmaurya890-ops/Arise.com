(function () {
  "use strict";
  if (window.__ARISE_SAAS_WIDGET_ENHANCER__) return;
  window.__ARISE_SAAS_WIDGET_ENHANCER__ = true;

  var DENSITY_KEY = "arise-ui-density-v1";
  var activePageTitle = "";
  var filterQuery = "";
  var syncTimer = null;
  var boundMainEl = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cleanHeadingText(raw) {
    return String(raw || "")
      .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]+/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getMainEl() {
    return document.getElementById("arise-main");
  }

  function getHeaderTitle(mainEl) {
    var h1 = mainEl && mainEl.querySelector("header h1");
    return h1 ? (h1.textContent || "").trim() : "";
  }

  function discoverWidgetBlocks(mainEl) {
    if (!mainEl) return [];
    // Locate the active page content container inside #arise-main
    var canvasWrap = mainEl.querySelector(":scope > div.flex-1");
    if (!canvasWrap) return [];
    var motionRoot = canvasWrap.firstElementChild || canvasWrap;
    var pageRoot = motionRoot.firstElementChild || motionRoot;

    var candidates = [];
    // Collect direct children & grid children that represent distinct cards/widgets
    var children = Array.prototype.slice.call(pageRoot.children || []);
    children.forEach(function (child) {
      if (!child || child.nodeType !== 1) return;
      if (child.classList && (child.classList.contains("wnav") || child.tagName === "NAV")) return;
      var cs = window.getComputedStyle ? window.getComputedStyle(child) : null;
      if (cs && cs.display === "none" && !child.hasAttribute("data-arise-filtered-out")) return;

      // If a child is a pure layout grid holding multiple cards, inspect its card children too
      var cls = String(child.className || "");
      var isPureGrid = /\bgrid\b/.test(cls) && !/\b(glass|card|rounded-2xl|ptx|crt|exw|na-wrap|pw-wrap|csu|csp|att|cgpa|cp-wrap)\b/.test(cls);
      if (isPureGrid && child.children.length >= 2 && child.children.length <= 8) {
        Array.prototype.slice.call(child.children).forEach(function (sub) {
          if (sub && sub.nodeType === 1) candidates.push(sub);
        });
      } else {
        candidates.push(child);
      }
    });

    var blocks = [];
    var seenTitles = Object.create(null);
    candidates.forEach(function (el) {
      var headingEl = el.querySelector(
        "h2, h3, [class*='-title'], [class*='-heading'], .lpa50-title, .ccc-title, .pcc-title, .dpe-title"
      );
      if (!headingEl) return;
      var label = cleanHeadingText(headingEl.textContent);
      if (!label || label.length < 2 || label.length > 54) return;
      var key = label.toLowerCase();
      if (seenTitles[key]) return;
      seenTitles[key] = true;
      blocks.push({ el: el, label: label });
    });

    return blocks;
  }

  function applyFilter(mainEl) {
    var blocks = discoverWidgetBlocks(mainEl);
    var q = filterQuery.trim().toLowerCase();
    var shown = 0;
    blocks.forEach(function (b) {
      if (!q) {
        if (b.el.hasAttribute("data-arise-filtered-out")) {
          b.el.removeAttribute("data-arise-filtered-out");
          b.el.style.display = "";
        }
        shown++;
        return;
      }
      var hay = (b.label + " " + (b.el.textContent || "").slice(0, 900)).toLowerCase();
      var match = hay.indexOf(q) !== -1;
      if (match) {
        if (b.el.hasAttribute("data-arise-filtered-out")) {
          b.el.removeAttribute("data-arise-filtered-out");
          b.el.style.display = "";
        }
        shown++;
      } else {
        b.el.setAttribute("data-arise-filtered-out", "true");
        b.el.style.display = "none";
      }
    });
    var countEl = document.getElementById("arise-subbar-count");
    if (countEl) {
      countEl.textContent = q ? (shown + " / " + blocks.length + " widgets") : (blocks.length + " widgets");
    }
  }

  function clearAllFilters(mainEl) {
    if (!mainEl) return;
    Array.prototype.slice.call(mainEl.querySelectorAll("[data-arise-filtered-out]")).forEach(function (el) {
      el.removeAttribute("data-arise-filtered-out");
      el.style.display = "";
    });
  }

  function ensureScrollTopBtn(mainEl) {
    var btn = document.getElementById("arise-scroll-top-btn");
    if (!mainEl) {
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
      boundMainEl = null;
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "arise-scroll-top-btn";
      btn.type = "button";
      btn.className = "arise-scroll-top-btn";
      btn.setAttribute("aria-label", "Scroll back to top of page");
      btn.innerHTML =
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='m18 15-6-6-6 6'/></svg>" +
        "<span>Top</span>";
      btn.addEventListener("click", function () {
        var m = getMainEl();
        if (m) m.scrollTo({ top: 0, behavior: "smooth" });
      });
      document.body.appendChild(btn);
    }
    if (boundMainEl !== mainEl) {
      boundMainEl = mainEl;
      mainEl.addEventListener("scroll", function () {
        btn.setAttribute("data-visible", mainEl.scrollTop > 380 ? "true" : "false");
      }, { passive: true });
    }
    btn.setAttribute("data-visible", mainEl.scrollTop > 380 ? "true" : "false");
  }

  function syncSubbar() {
    var mainEl = getMainEl();
    ensureScrollTopBtn(mainEl);
    var existing = document.getElementById("arise-page-widget-bar");
    if (!mainEl || document.documentElement.classList.contains("arise-focus-active")) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    var title = getHeaderTitle(mainEl);
    if (title !== activePageTitle) {
      activePageTitle = title;
      if (filterQuery) {
        filterQuery = "";
        clearAllFilters(mainEl);
      }
    }

    var blocks = discoverWidgetBlocks(mainEl);
    if (blocks.length < 3) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    var hdr = mainEl.querySelector(":scope > header");
    if (!hdr) return;

    if (!existing) {
      existing = document.createElement("div");
      existing.id = "arise-page-widget-bar";
      existing.className = "arise-page-widget-bar";
      existing.setAttribute("role", "region");
      existing.setAttribute("aria-label", "Page widget quick jump and filter");
      existing.innerHTML =
        "<div class='arise-pwb-inner'>" +
        "<div class='arise-pwb-left'>" +
        "<span id='arise-subbar-count' class='arise-pwb-count'></span>" +
        "<div id='arise-subbar-chips' class='arise-pwb-chips' role='navigation' aria-label='Jump to widget'></div>" +
        "</div>" +
        "<div class='arise-pwb-right'>" +
        "<div class='arise-pwb-filter'>" +
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><polygon points='22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3'/></svg>" +
        "<input id='arise-pwb-input' type='search' autocomplete='off' placeholder='Filter widgets…' aria-label='Filter widgets on this page'>" +
        "</div>" +
        "<button id='arise-pwb-density' type='button' class='arise-pwb-density' title='Toggle Compact / Standard card density'></button>" +
        "</div>" +
        "</div>";

      var inp = existing.querySelector("#arise-pwb-input");
      inp.addEventListener("input", function () {
        filterQuery = inp.value || "";
        applyFilter(getMainEl());
      });

      var densBtn = existing.querySelector("#arise-pwb-density");
      densBtn.addEventListener("click", function () {
        var root = document.documentElement;
        var next = root.getAttribute("data-density") === "compact" ? "comfortable" : "compact";
        if (next === "compact") root.setAttribute("data-density", "compact");
        else root.removeAttribute("data-density");
        try { localStorage.setItem(DENSITY_KEY, next); } catch (e) {}
        updateDensityLabel(densBtn);
      });

      existing.querySelector("#arise-subbar-chips").addEventListener("click", function (ev) {
        var chip = ev.target && ev.target.closest ? ev.target.closest("[data-arise-jump-idx]") : null;
        if (!chip) return;
        var idx = Number(chip.getAttribute("data-arise-jump-idx"));
        var curBlocks = discoverWidgetBlocks(getMainEl());
        var target = curBlocks[idx] && curBlocks[idx].el;
        if (!target) return;
        if (target.hasAttribute("data-arise-filtered-out")) {
          filterQuery = "";
          var inputEl = document.getElementById("arise-pwb-input");
          if (inputEl) inputEl.value = "";
          applyFilter(getMainEl());
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("arise-widget-spotlight");
        setTimeout(function () { target.classList.remove("arise-widget-spotlight"); }, 1300);
      });
    }

    if (existing.previousElementSibling !== hdr) {
      hdr.insertAdjacentElement("afterend", existing);
    }

    var inpEl = existing.querySelector("#arise-pwb-input");
    if (inpEl && document.activeElement !== inpEl && inpEl.value !== filterQuery) {
      inpEl.value = filterQuery;
    }

    updateDensityLabel(existing.querySelector("#arise-pwb-density"));

    var chipsHtml = blocks.slice(0, 14).map(function (b, idx) {
      return "<button type='button' class='arise-pwb-chip' data-arise-jump-idx='" + idx + "'>" + esc(b.label) + "</button>";
    }).join("");
    var chipsContainer = existing.querySelector("#arise-subbar-chips");
    if (chipsContainer && chipsContainer.__lastHtml !== chipsHtml) {
      chipsContainer.__lastHtml = chipsHtml;
      chipsContainer.innerHTML = chipsHtml;
    }

    var countEl = existing.querySelector("#arise-subbar-count");
    if (countEl && !filterQuery) {
      countEl.textContent = blocks.length + " widgets";
    }
  }

  function updateDensityLabel(btn) {
    if (!btn) return;
    var isCompact = document.documentElement.getAttribute("data-density") === "compact";
    btn.setAttribute("aria-pressed", String(isCompact));
    btn.textContent = isCompact ? "Compact ✓" : "Compact";
  }

  function scheduleSync() {
    if (document.hidden || syncTimer) return;
    syncTimer = setTimeout(function () {
      syncTimer = null;
      syncSubbar();
    }, 140);
  }

  function boot() {
    try {
      if (localStorage.getItem(DENSITY_KEY) === "compact") {
        document.documentElement.setAttribute("data-density", "compact");
      }
    } catch (e) {}
    syncSubbar();
    if (window.__ARISE_MUTATION_BUS__) {
      window.__ARISE_MUTATION_BUS__.subscribe(scheduleSync);
    } else if (typeof MutationObserver === "function" && document.body) {
      var mo = new MutationObserver(scheduleSync);
      mo.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("arise:widgets-ready", function () {
        if (window.__ARISE_MUTATION_BUS__) {
          mo.disconnect();
          window.__ARISE_MUTATION_BUS__.subscribe(scheduleSync);
        }
      }, { once: true });
    }
    window.addEventListener("arise:widgets-ready", scheduleSync);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
