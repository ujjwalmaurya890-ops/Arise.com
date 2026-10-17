// Smoke test for the new "📝 IA Tracker" tab added to
// cse-syllabus-tabs-v150-patch.js (v151 addition): per-subject
// IA1/IA2/IA3/Assignment entry, best-2-of-3 CIE% computation, and the
// Sync-to-Internal-Marks action against cse-syllabus-internal-marks-v1.
//
// Run with: node test-syllabus-ia-tracker.js
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const BASE = path.join(__dirname, "features", "semester-risk");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", expected " + JSON.stringify(b) + ")"); }

function freshDom() {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="sem-1"></div></body></html>`,
    { url: "https://example.test/", runScripts: "dangerously" }
  );
  const { window } = dom;
  const store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  });
  return { dom, window, document: window.document, store };
}

function loadScripts(window) {
  const cfgCode = fs.readFileSync(path.join(BASE, "cse-full-syllabus-config.js"), "utf8");
  const tabsCode = fs.readFileSync(path.join(BASE, "cse-syllabus-tabs-v150-patch.js"), "utf8");
  window.eval(cfgCode);
  window.eval(tabsCode);
  if (window.document.readyState === "loading") {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  }
}

function waitForMount(window, cb) {
  // boot() mounts on a setTimeout(800) with a retry loop; jsdom's timers
  // run for real, so just poll briefly.
  const start = Date.now();
  (function poll() {
    const root = window.document.getElementById("csp-v150-tabs-root");
    if (root && root.innerHTML) { cb(root); return; }
    if (Date.now() - start > 3000) { cb(null); return; }
    setTimeout(poll, 50);
  })();
}

// ---- Test 1: IA tab renders with default settings ----
(function testDefaultRender(next) {
  const { window, document } = freshDom();
  loadScripts(window);
  waitForMount(window, (root) => {
    ok(!!root, "tabs root mounted");
    const iaBtn = root.querySelector('[data-tab="ia"]');
    ok(!!iaBtn, "IA Tracker tab button exists");
    iaBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    const body = root.querySelector('[data-tab-body="ia"]');
    ok(!!body && body.classList.contains("active"), "IA tab body becomes active");
    ok(body.innerHTML.indexOf("IA max marks") !== -1, "settings row rendered");
    ok(body.querySelectorAll(".csp150-ia-row").length > 0, "subject rows rendered");
    next();
  });
})(function () {

// ---- Test 2: entering IA marks computes best-2-of-3 CIE% and syncs ----
(function testComputeAndSync(next) {
  const { window, document, store } = freshDom();
  loadScripts(window);
  waitForMount(window, (root) => {
    const iaBtn = root.querySelector('[data-tab="ia"]');
    iaBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

    // s1-1 is the first subject (Sem 1, Mathematics I). Enter IA1=18, IA2=14, IA3=16 (max 20),
    // Assignment=8 (max 10). Best 2 of {90%, 70%, 80%} -> (90+80)/2 = 85%.
    // Default weight 80% IA / 20% Assignment: 85*0.8 + 80*0.2 = 68 + 16 = 84%.
    const subjId = "s1-1";
    function setField(field, val) {
      const input = root.querySelector('[data-ia-field="' + field + '"][data-ia-subj="' + subjId + '"]');
      ok(!!input, "input exists for " + field);
      input.value = String(val);
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    setField("ia1", 18);
    setField("ia2", 14);
    setField("ia3", 16);
    setField("assignment", 8);

    // Re-fetch root/body after each rerender (innerHTML replaced)
    const rootAfter = window.document.getElementById("csp-v150-tabs-root");
    const badge = rootAfter.querySelector('[data-ia-field="ia1"][data-ia-subj="' + subjId + '"]')
      .closest(".csp150-ia-row").querySelector(".csp150-ia-badge");
    eq(badge.textContent.trim(), "84%", "computed CIE% badge shows 84%");
    ok(badge.classList.contains("success"), "84% bands as success");

    // Sync this subject to Internal Marks
    const syncBtn = rootAfter.querySelector('[data-ia-sync="' + subjId + '"]');
    ok(!!syncBtn, "sync button present once CIE is computed");
    syncBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

    const internalMarksRaw = store["cse-syllabus-internal-marks-v1"];
    ok(!!internalMarksRaw, "internal marks key written");
    const internalMarks = JSON.parse(internalMarksRaw);
    eq(internalMarks[subjId], 84, "synced internal marks value matches computed CIE%");

    next();
  });
})(function () {

// ---- Test 3: only 1 IA test entered still produces a (lower-confidence) CIE ----
(function testSingleIA(next) {
  const { window, store } = freshDom();
  loadScripts(window);
  waitForMount(window, (root) => {
    const iaBtn = root.querySelector('[data-tab="ia"]');
    iaBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
    const subjId = "s1-2";
    const input = root.querySelector('[data-ia-field="ia1"][data-ia-subj="' + subjId + '"]');
    input.value = "10"; // 10/20 = 50%
    input.dispatchEvent(new window.Event("change", { bubbles: true }));

    const rootAfter = window.document.getElementById("csp-v150-tabs-root");
    const badge = rootAfter.querySelector('[data-ia-field="ia1"][data-ia-subj="' + subjId + '"]')
      .closest(".csp150-ia-row").querySelector(".csp150-ia-badge");
    eq(badge.textContent.trim(), "50%", "single IA entry still yields a % (no assignment yet)");
    ok(badge.classList.contains("warning"), "50% bands as warning");
    next();
  });
})(function () {

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
});
});
