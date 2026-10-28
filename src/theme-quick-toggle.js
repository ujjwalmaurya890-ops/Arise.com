(function () {
  "use strict";
  if (window.__ARISE_THEME_QUICK_TOGGLE__) return;
  window.__ARISE_THEME_QUICK_TOGGLE__ = true;

  var STORAGE_KEY = "arise-quick-toggle-last-theme-v1";
  var DEFAULTS = { dark: "cyberMidnightPro", light: "appleGlassLight" };
  var MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function readLastThemes() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeLastThemes(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {}
  }

  function getMode() {
    return document.documentElement.getAttribute("data-theme-mode") === "light" ? "light" : "dark";
  }

  function runMuted(fn) {
    var bus = window.__ARISE_MUTATION_BUS__;
    if (bus && typeof bus.mute === "function") return bus.mute(fn);
    return fn();
  }

  function updateButtonVisuals(btn, force) {
    if (!btn) return;
    var mode = getMode();
    if (!force && btn.__ariseLastMode === mode) return;
    btn.__ariseLastMode = mode;
    var nextMode = mode === "dark" ? "light" : "dark";
    runMuted(function () {
      btn.innerHTML = mode === "dark" ? SUN_SVG : MOON_SVG;
      btn.setAttribute("aria-label", "Switch to " + nextMode + " mode (currently " + mode + ")");
      btn.setAttribute("aria-pressed", String(mode === "light"));
      btn.title = "Switch to " + nextMode + " mode";
    });
  }

  function handleToggle(btn) {
    var sys = window.AriseThemeSystem;
    if (!sys) return;
    var curMode = getMode();
    var saved = readLastThemes();
    saved[curMode] = sys.getStoredTheme();
    writeLastThemes(saved);
    var nextMode = curMode === "dark" ? "light" : "dark";
    var nextTheme = saved[nextMode] || DEFAULTS[nextMode];
    var catalog = typeof sys.allThemes === "function" ? sys.allThemes() : sys.themes;
    var meta = catalog && catalog[nextTheme];
    if (!meta || meta.mode !== nextMode) nextTheme = DEFAULTS[nextMode];
    sys.applyTheme(nextTheme, true);
    try {
      if (sys.modeStorageKey) localStorage.setItem(sys.modeStorageKey, nextMode);
    } catch {}
    updateButtonVisuals(btn, true);
  }

  function findSlot() {
    var landing =
      document.querySelector(".arise-landing-theme-slot") ||
      document.querySelector(".arise-landing-nav-actions");
    if (landing) {
      return { el: landing, prepend: landing.classList.contains("arise-landing-nav-actions") };
    }
    var hdr =
      document.querySelector("main header") ||
      document.querySelector("header.sticky.top-0") ||
      document.querySelector("header");
    return hdr && hdr.querySelector("h1") && hdr.lastElementChild
      ? { el: hdr.lastElementChild, prepend: false }
      : null;
  }

  var btnEl = null;

  function syncMountCore() {
    if (!window.AriseThemeSystem) return;
    if (!btnEl) {
      btnEl =
        document.getElementById("arise-theme-quick-toggle") ||
        document.querySelector(".arise-theme-quick-toggle");
      if (!btnEl) {
        btnEl = document.createElement("button");
        btnEl.id = "arise-theme-quick-toggle";
        btnEl.type = "button";
        btnEl.className = "arise-theme-quick-toggle";
        updateButtonVisuals(btnEl, true);
        btnEl.addEventListener("click", function () {
          handleToggle(btnEl);
        });
        var attrMo = new MutationObserver(function () {
          updateButtonVisuals(btnEl, false);
        });
        attrMo.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme-mode"]
        });
        window.addEventListener("storage", function (ev) {
          if (
            ev.key === STORAGE_KEY ||
            (window.AriseThemeSystem && ev.key === window.AriseThemeSystem.modeStorageKey)
          ) {
            updateButtonVisuals(btnEl, false);
          }
        });
      }
    }

    var slot = findSlot();
    if (slot && slot.el) {
      if (!btnEl.classList.contains("arise-theme-quick-toggle--docked")) {
        btnEl.classList.add("arise-theme-quick-toggle--docked");
      }
      if (btnEl.parentNode !== slot.el) {
        if (slot.prepend && slot.el.firstChild) slot.el.insertBefore(btnEl, slot.el.firstChild);
        else slot.el.appendChild(btnEl);
      }
    } else {
      if (btnEl.classList.contains("arise-theme-quick-toggle--docked")) {
        btnEl.classList.remove("arise-theme-quick-toggle--docked");
      }
      if (document.body && btnEl.parentNode !== document.body) {
        document.body.appendChild(btnEl);
      }
    }
  }

  function syncMount() {
    runMuted(syncMountCore);
  }

  var debounceTimer = 0;
  function onMutations(records) {
    if (document.hidden) return;
    if (btnEl && btnEl.isConnected && Array.isArray(records) && records.length) {
      var relevant = false;
      for (var i = 0; i < records.length && !relevant; i++) {
        var rec = records[i];
        var added = rec.addedNodes;
        if (added && added.length) {
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n && n.nodeType === 1 && n !== btnEl) {
              relevant = true;
              break;
            }
          }
        }
        var removed = rec.removedNodes;
        if (!relevant && removed && removed.length) {
          for (var k = 0; k < removed.length; k++) {
            var rn = removed[k];
            if (rn && rn.nodeType === 1) {
              relevant = true;
              break;
            }
          }
        }
      }
      if (!relevant) return;
    }
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = 0;
      syncMount();
    }, 80);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncMount);
  } else {
    syncMount();
  }

  if (window.__ARISE_MUTATION_BUS__) {
    window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
  } else {
    var mo = null;
    if (typeof MutationObserver === "function" && document.body) {
      mo = new MutationObserver(onMutations);
      mo.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener(
      "arise:widgets-ready",
      function () {
        syncMount();
        if (window.__ARISE_MUTATION_BUS__) {
          if (mo) {
            mo.disconnect();
            mo = null;
          }
          window.__ARISE_MUTATION_BUS__.subscribe(onMutations);
        }
      },
      { once: true }
    );
  }
})();
