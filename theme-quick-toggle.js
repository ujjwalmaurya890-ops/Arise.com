(function () {
  "use strict";
  if (window.__ARISE_THEME_QUICK_TOGGLE__) return;
  window.__ARISE_THEME_QUICK_TOGGLE__ = true;

  var STORAGE_KEY = "arise-quick-toggle-last-theme-v1";
  var DEFAULTS = { dark: "cyberMidnightPro", light: "appleGlassLight" };

  var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

  function readLast() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeLast(map) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function currentMode() {
    return document.documentElement.getAttribute("data-theme-mode") === "light" ? "light" : "dark";
  }

  function updateButton(btn) {
    var mode = currentMode();
    var target = mode === "dark" ? "light" : "dark";
    btn.innerHTML = mode === "dark" ? ICON_SUN : ICON_MOON;
    btn.setAttribute("aria-label", "Switch to " + target + " mode (currently " + mode + ")");
    btn.setAttribute("aria-pressed", String(mode === "light"));
    btn.title = "Switch to " + target + " mode";
  }

  function toggleTheme(btn) {
    var sys = window.AriseThemeSystem;
    if (!sys) return;
    var cur = currentMode();
    var map = readLast();
    map[cur] = sys.getStoredTheme();
    writeLast(map);
    var nextMode = cur === "dark" ? "light" : "dark";
    var nextTheme = map[nextMode] || DEFAULTS[nextMode];
    var themes = typeof sys.allThemes === "function" ? sys.allThemes() : sys.themes;
    var def = themes && themes[nextTheme];
    if (!def || def.mode !== nextMode) nextTheme = DEFAULTS[nextMode];
    sys.applyTheme(nextTheme, true);
    try {
      if (sys.modeStorageKey) localStorage.setItem(sys.modeStorageKey, nextMode);
    } catch (e) {}
    updateButton(btn);
  }

  function findDockTarget() {
    var landingSlot = document.querySelector(".arise-landing-theme-slot") || document.querySelector(".arise-landing-nav-actions");
    if (landingSlot) return { el: landingSlot, prepend: landingSlot.classList.contains("arise-landing-nav-actions") };
    var hdr = document.querySelector("main header") || document.querySelector("header.sticky.top-0") || document.querySelector("header");
    if (hdr && hdr.querySelector("h1") && hdr.lastElementChild) return { el: hdr.lastElementChild, prepend: false };
    return null;
  }

  var btnEl = null;

  function syncPlacement() {
    if (!window.AriseThemeSystem) return;
    if (!btnEl) {
      btnEl = document.getElementById("arise-theme-quick-toggle") || document.querySelector(".arise-theme-quick-toggle");
      if (!btnEl) {
        btnEl = document.createElement("button");
        btnEl.id = "arise-theme-quick-toggle";
        btnEl.type = "button";
        btnEl.className = "arise-theme-quick-toggle";
        updateButton(btnEl);
        btnEl.addEventListener("click", function () { toggleTheme(btnEl); });
        var mo = new MutationObserver(function () { updateButton(btnEl); });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-mode"] });
        window.addEventListener("storage", function (ev) {
          if (ev.key === STORAGE_KEY || (window.AriseThemeSystem && ev.key === window.AriseThemeSystem.modeStorageKey)) {
            updateButton(btnEl);
          }
        });
      }
    }
    var dock = findDockTarget();
    if (dock && dock.el) {
      btnEl.classList.add("arise-theme-quick-toggle--docked");
      if (btnEl.parentNode !== dock.el) {
        if (dock.prepend && dock.el.firstChild) dock.el.insertBefore(btnEl, dock.el.firstChild);
        else dock.el.appendChild(btnEl);
      }
    } else {
      btnEl.classList.remove("arise-theme-quick-toggle--docked");
      if (document.body && btnEl.parentNode !== document.body) document.body.appendChild(btnEl);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncPlacement);
  } else {
    syncPlacement();
  }
  if (window.__ARISE_MUTATION_BUS__) {
    window.__ARISE_MUTATION_BUS__.subscribe(syncPlacement);
  } else {
    var fallbackMo = null;
    if (typeof MutationObserver === "function" && document.body) {
      fallbackMo = new MutationObserver(syncPlacement);
      fallbackMo.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("arise:widgets-ready", function () {
      syncPlacement();
      if (window.__ARISE_MUTATION_BUS__) {
        if (fallbackMo) { fallbackMo.disconnect(); fallbackMo = null; }
        window.__ARISE_MUTATION_BUS__.subscribe(syncPlacement);
      }
    }, { once: true });
  }
})();
