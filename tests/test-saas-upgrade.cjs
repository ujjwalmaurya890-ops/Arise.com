#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(path.resolve(__dirname, ".."));
let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    passed++;
    console.log("  ok  " + label);
  } else {
    failed++;
    console.error("  FAIL  " + label);
  }
}

async function main() {
  // 1. Static asset & CSS verification
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const saasCss = fs.readFileSync(path.join(root, "styles/saas-upgrade.css"), "utf8");
  const themeCss = fs.readFileSync(path.join(root, "styles/theme.css"), "utf8");
  const typoCss = fs.readFileSync(path.join(root, "styles/typography-upgrade.css"), "utf8");
  const swJs = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
  const netlifyToml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");

  check("index.html links ./styles/saas-upgrade.css in <head>", indexHtml.includes('href="./styles/saas-upgrade.css"'));
  check("index.html defines window.__ariseFlushReadyMounts progressive mount helper", indexHtml.includes("window.__ariseFlushReadyMounts"));
  check("styles/theme.css dark input bevel no longer uses #fff9 white top highlight", !themeCss.includes("inset 0 1px #fff9"));
  check("styles/typography-upgrade.css has balanced block comments", (typoCss.match(/\/\*/g) || []).length === (typoCss.match(/\*\//g) || []).length);
  check("styles/saas-upgrade.css includes .arise-saas-backdrop, .arise-bento-grid, and #upp-command-fab",
    saasCss.includes(".arise-saas-backdrop") && saasCss.includes(".arise-bento-grid") && saasCss.includes("#upp-command-fab"));
  check("service-worker.js caches ./styles/saas-upgrade.css in CORE_SHELL and skips duplicate individual JS files when chunks are cached",
    swJs.includes('"./styles/saas-upgrade.css"') && swJs.includes("chunksOk"));
  check("netlify.toml serves /assets/chunks/* with immutable Cache-Control",
    netlifyToml.includes('for = "/assets/chunks/*"') && netlifyToml.includes("immutable"));

  // 2. Full JSDOM integration check of Landing -> Workspace -> Sidebar -> Docked Theme Toggle -> Global Command Palette
  const dom = new JSDOM(
    '<!DOCTYPE html><html lang="en" class="dark" data-theme="cyberMidnightPro"><head></head><body><div id="root"></div></body></html>',
    {
      url: "https://arise.example.com/",
      pretendToBeVisual: true,
      runScripts: "outside-only"
    }
  );
  const { window } = dom;
  window.innerWidth = 1440;
  window.innerHeight = 900;
  window.matchMedia = (q) => ({
    matches: q.includes("dark"),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {}
  });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.fetch = async () => ({
    ok: true,
    json: async () => []
  });

  // Load mutation bus + shared utils + theme system + React app bundle + theme toggle + command palette + widget enhancer
  const scriptsToEval = [
    "src/mutation-bus.js",
    "src/widget-shared-utils.js",
    "src/theme-system.js",
    "assets/app-bundle.js",
    "src/theme-quick-toggle.js",
    "src/premium-productivity-features.js",
    "src/saas-widget-enhancer.js",
    "src/animation-upgrade.js"
  ];
  const runtimeErrors = [];
  window.addEventListener("error", (ev) => {
    runtimeErrors.push(ev.message || String(ev.error || ev));
  });

  for (const rel of scriptsToEval) {
    let code = fs.readFileSync(path.join(root, rel), "utf8");
    if (rel === "assets/app-bundle.js") {
      code = code.replace(/\bimport\.meta\b/g, '({url:"https://arise.example.com/assets/app-bundle.js",env:{}})');
    }
    window.eval(code);
  }

  async function waitFor(pred, timeoutMs = 1500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const res = pred();
      if (res) return res;
      await new Promise((r) => setTimeout(r, 40));
    }
    return pred();
  }

  await waitFor(() => window.document.querySelector(".arise-saas-backdrop"));

  check("Zero runtime errors when booting core SaaS shell in JSDOM", runtimeErrors.length === 0);

  // Verify zero-CPU backdrop replaced animated <canvas>
  const backdrop = window.document.querySelector(".arise-saas-backdrop");
  const bgCanvas = window.document.querySelector("canvas.fixed.inset-0");
  check("CSS .arise-saas-backdrop mounted and full-viewport particle <canvas> removed", !!backdrop && !bgCanvas);

  // Verify SaaS Landing hero & 6 Bento launchers
  const bentoCards = window.document.querySelectorAll(".arise-bento-card");
  const enterBtn = Array.from(window.document.querySelectorAll("button")).find((b) =>
    (b.textContent || "").includes("Enter Dashboard")
  );
  check("SaaS Landing renders 6 interactive Bento capability cards and Enter Dashboard CTA",
    bentoCards.length === 6 && !!enterBtn);

  // Click Enter Dashboard to enter Workspace
  enterBtn.click();
  await waitFor(() => window.document.querySelector("aside"));

  const aside = window.document.querySelector("aside");
  check("Desktop sidebar renders expanded (w-60) by default with 'Arise' + 'OS' brand",
    !!aside && aside.className.includes("w-60") && aside.textContent.includes("Arise") && aside.textContent.includes("OS"));

  const navButtons = aside ? aside.querySelectorAll("nav button.nav-item") : [];
  const navSvgs = aside ? aside.querySelectorAll("nav button.nav-item svg") : [];
  const anyEmojiLabel = Array.from(navButtons).some((b) => /[\u{1F300}-\u{1FAFF}]/u.test(b.textContent || ""));
  check("All 20 sidebar navigation items render crisp inline SVG icons and clean emoji-free labels",
    navButtons.length === 20 && navSvgs.length >= 20 && !anyEmojiLabel);

  // Verify shared singleton fetchInterviewSheets helper & Page Widget Quick-Jump Bar on Dashboard
  check("widget-shared-utils exposes singleton fetchInterviewSheets() deduplicator",
    !!(window.__ARISE_WIDGET_UTILS__ && typeof window.__ARISE_WIDGET_UTILS__.fetchInterviewSheets === "function"));

  await waitFor(() => window.document.getElementById("arise-page-widget-bar"));
  const subbar = window.document.getElementById("arise-page-widget-bar");
  const jumpChips = subbar ? subbar.querySelectorAll(".arise-pwb-chip") : [];
  check("saas-widget-enhancer mounts Page Quick-Jump & Filter Bar on multi-widget Dashboard",
    !!subbar && jumpChips.length >= 3);

  // Toggle Compact Density from Page Widget Bar
  const densityBtn = subbar && subbar.querySelector("#arise-pwb-density");
  if (densityBtn) densityBtn.click();
  check("Compact SaaS density toggle sets html[data-density='compact']",
    window.document.documentElement.getAttribute("data-density") === "compact");
  if (densityBtn) densityBtn.click();

  // Navigate to a non-Dashboard section (e.g. DSA Tracker) and verify clean topbar H1 + Command Palette works there!
  const dsaBtn = Array.from(navButtons).find((b) => (b.textContent || "").trim() === "DSA Tracker");
  assert(dsaBtn, "DSA Tracker nav button should exist");
  dsaBtn.click();
  await waitFor(() => {
    const h = window.document.querySelector("header h1");
    return h && h.textContent.trim() === "DSA Tracker";
  });

  const headerH1 = window.document.querySelector("header h1");
  check("Topbar H1 displays clean emoji-free section title ('DSA Tracker')",
    !!headerH1 && headerH1.textContent.trim() === "DSA Tracker");

  // Wait for shell sync (120ms debounce in src/premium-productivity-features.js)
  await waitFor(() => window.document.getElementById("upp-command-fab") && window.document.getElementById("arise-theme-quick-toggle"));
  const themeBtn = window.document.getElementById("arise-theme-quick-toggle");
  const cmdFab = window.document.getElementById("upp-command-fab");
  check("Theme toggle and ⌘K Search bar both dock cleanly inside Workspace header",
    !!themeBtn &&
    themeBtn.classList.contains("arise-theme-quick-toggle--docked") &&
    !!cmdFab &&
    cmdFab.classList.contains("upp-command-fab--docked"));

  // Verify Command Palette opens while on non-Dashboard section ("DSA")!
  cmdFab.click();
  await waitFor(() => {
    const ov = window.document.getElementById("upp-command-overlay");
    return ov && ov.getAttribute("data-open") === "true";
  });
  const paletteOverlay = window.document.getElementById("upp-command-overlay");
  check("Global Command Palette (⌘K) opens from non-Dashboard sections ('DSA')",
    !!paletteOverlay && paletteOverlay.getAttribute("data-open") === "true");

  // Toggle theme and verify data-theme switches cleanly
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const initialTheme = window.document.documentElement.getAttribute("data-theme");
  themeBtn.click();
  const nextTheme = window.document.documentElement.getAttribute("data-theme");
  check("Docked theme toggle switches between Dark and Light SaaS themes cleanly",
    initialTheme !== nextTheme && (nextTheme === "appleGlassLight" || nextTheme === "cyberMidnightPro"));

  // Verify '?' Keyboard Shortcuts Modal & 'G then P' Go-To Chord Navigation
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "?", bubbles: true }));
  const scOverlay = window.document.getElementById("upp-shortcuts-overlay");
  check("'?' key opens SaaS Keyboard Shortcuts modal",
    !!scOverlay && scOverlay.getAttribute("data-open") === "true");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "g", bubbles: true }));
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "p", bubbles: true }));
  await waitFor(() => {
    const h = window.document.querySelector("header h1");
    return h && h.textContent.trim() === "Projects";
  });
  check("Linear-style 'G then P' chord shortcut navigates straight to Projects",
    window.document.querySelector("header h1").textContent.trim() === "Projects");

  // Verify Ctrl + Shift + K Theme Settings shortcut & conflict guards
  const themePanel = window.document.querySelector(".theme-switcher-panel");
  const themeTrigger = window.document.querySelector(".theme-switcher-trigger");
  const themeCloseBtn = window.document.querySelector(".theme-switcher-close");
  const themeSearchInput = window.document.querySelector(".theme-search-input");

  // 1. Editable fields (input, textarea, search, contenteditable) must not trigger Ctrl+Shift+K
  const testInput = window.document.createElement("input");
  testInput.type = "text";
  const testTextarea = window.document.createElement("textarea");
  const testSearch = window.document.createElement("input");
  testSearch.type = "search";
  const testEditableDiv = window.document.createElement("div");
  testEditableDiv.setAttribute("contenteditable", "true");
  window.document.body.append(testInput, testTextarea, testSearch, testEditableDiv);

  let editableBlockedAll = true;
  for (const el of [testInput, testTextarea, testSearch, testEditableDiv]) {
    el.focus();
    const ev = new window.KeyboardEvent("keydown", {
      key: "K",
      code: "KeyK",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    el.dispatchEvent(ev);
    if (ev.defaultPrevented || themePanel.getAttribute("data-open") === "true") {
      editableBlockedAll = false;
    }
  }
  testInput.remove();
  testTextarea.remove();
  testSearch.remove();
  testEditableDiv.remove();
  if (window.document.activeElement && typeof window.document.activeElement.blur === "function") {
    window.document.activeElement.blur();
  }
  check("Ctrl + Shift + K does not trigger or preventDefault inside input, textarea, search, or contenteditable fields",
    editableBlockedAll && themePanel.getAttribute("data-open") === "false");

  // 2. Unrelated modifier combos (Shift+K, Alt+Shift+K, Ctrl+Alt+Shift+K) do not open Theme Settings
  for (const mods of [
    { shiftKey: true },
    { altKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true, shiftKey: true }
  ]) {
    const ev = new window.KeyboardEvent("keydown", Object.assign({
      key: "K",
      code: "KeyK",
      bubbles: true,
      cancelable: true
    }, mods));
    window.document.dispatchEvent(ev);
  }
  check("Unrelated modifier combinations do not open Theme Settings panel",
    themePanel.getAttribute("data-open") === "false");

  // 3. Ctrl + Shift + K opens Theme Settings panel without opening Command Palette
  const openEv = new window.KeyboardEvent("keydown", {
    key: "K",
    code: "KeyK",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  });
  window.document.dispatchEvent(openEv);
  const allThemeKeys = Object.keys(window.AriseThemeSystem.allThemes());
  const renderedSwatches = themePanel.querySelectorAll("[data-theme-option]");
  check("Ctrl + Shift + K opens Theme Settings panel with all supported themes and does not trigger Command Palette",
    openEv.defaultPrevented === true &&
    themePanel.getAttribute("data-open") === "true" &&
    themePanel.getAttribute("aria-hidden") === "false" &&
    themeTrigger.getAttribute("aria-expanded") === "true" &&
    paletteOverlay.getAttribute("data-open") === "false" &&
    renderedSwatches.length === allThemeKeys.length &&
    renderedSwatches.length >= 41);

  // 4. Repeated Ctrl + Shift + K presses do not duplicate panel or reset search state
  themeSearchInput.value = "dracula";
  themeSearchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  for (let i = 0; i < 3; i++) {
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", {
      key: "K",
      code: "KeyK",
      ctrlKey: true,
      shiftKey: true,
      repeat: i > 0,
      bubbles: true,
      cancelable: true
    }));
  }
  check("Repeated Ctrl + Shift + K presses keep single panel instance and preserve search input filter",
    window.document.querySelectorAll(".theme-switcher-root").length === 1 &&
    window.document.querySelectorAll(".theme-switcher-panel").length === 1 &&
    themePanel.getAttribute("data-open") === "true" &&
    themeSearchInput.value === "dracula" &&
    themePanel.querySelectorAll("[data-theme-option]").length === 1);

  // 5. Selecting a theme from the opened panel applies and persists it
  const draculaSwatch = themePanel.querySelector('[data-theme-option="dracula"]');
  assert(draculaSwatch, "Dracula swatch should be rendered");
  draculaSwatch.click();
  themeSearchInput.value = "";
  themeSearchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  check("Selecting a theme inside Theme Settings applies data-theme and persists to localStorage",
    window.document.documentElement.getAttribute("data-theme") === "dracula" &&
    window.localStorage.getItem(window.AriseThemeSystem.storageKey) === "dracula");

  // 6. Escape closes the panel, Cmd+Shift+K reopens it, and close button closes it
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const closedByEsc = themePanel.getAttribute("data-open") === "false" && themePanel.getAttribute("aria-hidden") === "true";
  const macEv = new window.KeyboardEvent("keydown", {
    key: "k",
    code: "KeyK",
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  });
  window.document.dispatchEvent(macEv);
  const reopenedByCmdShiftK = macEv.defaultPrevented && themePanel.getAttribute("data-open") === "true";
  themeCloseBtn.click();
  const closedByBtn = themePanel.getAttribute("data-open") === "false" && themeTrigger.getAttribute("aria-expanded") === "false";
  check("Escape and close button close Theme Settings panel and Cmd + Shift + K reopens it",
    closedByEsc && reopenedByCmdShiftK && closedByBtn);

  dom.window.close();
  console.log(`\nSaaS Upgrade Verification: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
