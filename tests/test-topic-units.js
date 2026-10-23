// Smoke test for the new topic/unit-level breakdown feature added to
// cse-syllabus-plus-widget.js: config units[], per-unit checkboxes,
// weighted subject %, and priority-score weighting by unit coverage.
//
// Unlike the project's other (dependency-free) Node-harness tests, this
// one needs a real DOM - the feature's checkbox wiring, chip rendering,
// and top-5 priority panel truncation can't be exercised faithfully with
// plain innerHTML-string assertions. Uses jsdom (devDependency - see the
// root package.json this round added; run `npm install` once first).
//
// Run with: node tests/test-topic-units.js
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const BASE = path.join(path.resolve(__dirname, ".."), "src", "features", "semester-risk");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", expected " + JSON.stringify(b) + ")"); }

function freshDom() {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="sem-1"></div></body></html>`,
    { url: "https://example.test/", runScripts: "dangerously" }
  );
  const { window } = dom;
  // localStorage polyfill (jsdom's is origin-restricted in some setups; roll our own to be safe)
  const store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  });
  return { dom, window, document: window.document };
}

function loadScripts(window) {
  const cfgCode = fs.readFileSync(path.join(BASE, "cse-full-syllabus-config.js"), "utf8");
  const widgetCode = fs.readFileSync(path.join(BASE, "cse-syllabus-plus-widget.js"), "utf8");
  window.eval(cfgCode);
  window.eval(widgetCode);
  // The widget defers its boot() to DOMContentLoaded when the document is
  // still 'loading' (true for a freshly-constructed jsdom document) - fire
  // it manually so the panel mounts synchronously for the test.
  if (window.document.readyState === "loading") {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  }
}

// ---- Test 1: config sanity ----
{
  const { window } = freshDom();
  loadScripts(window);
  const cfg = window.AriseCSEFullSyllabusConfig;
  ok(!!cfg, "config loaded");
  eq(cfg.SUBJECTS.length, 56, "56 subjects in flattened SUBJECTS");
  const withUnits = cfg.SUBJECTS.filter((s) => s.units);
  eq(withUnits.length, 56, "every subject has a units[] array");
  const badWeights = withUnits.filter((s) => {
    const total = s.units.reduce((a, u) => a + u.weightagePct, 0);
    return total !== 100;
  });
  eq(badWeights.length, 0, "every subject's unit weightagePct sums to exactly 100");
}

// ---- Test 2: panel renders units chip + panel, checkbox drives storage ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  // panel auto-injects on boot (document was already 'complete' via jsdom by the time eval ran)
  const panel = document.getElementById("cse-syllabus-plus-panel");
  ok(!!panel, "panel injected next to #sem-1 anchor");

  const chip = panel.querySelector('[data-units-toggle="s1-1"]');
  ok(!!chip, "units chip rendered for a subject with units[] (s1-1)");
  ok(/0%/.test(chip.textContent), "chip shows 0% before any unit is checked");

  // open the units panel for s1-1
  chip.dispatchEvent(new window.Event("click", { bubbles: true }));
  const panel2 = document.getElementById("cse-syllabus-plus-panel");
  const unitRows = panel2.querySelectorAll('[data-unit-toggle^="s1-1:"]');
  eq(unitRows.length, 5, "5 unit checkboxes rendered for s1-1 (Mathematics I)");

  // check the first unit (weight 20%) and confirm storage + re-rendered %
  unitRows[0].checked = true;
  unitRows[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  const stored = JSON.parse(window.localStorage.getItem("cse-syllabus-topic-progress-v1"));
  ok(stored && stored["s1-1"] && Object.keys(stored["s1-1"]).length === 1, "checking one unit persists to cse-syllabus-topic-progress-v1");

  const panel3 = document.getElementById("cse-syllabus-plus-panel");
  const chip3 = panel3.querySelector('[data-units-toggle="s1-1"]');
  ok(/20%/.test(chip3.textContent), "chip updates to 20% after checking the first (20%-weighted) unit");
}

// ---- Test 3: marking the whole subject done shows 100% regardless of units ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const check = document.querySelector('[data-toggle="s1-2"]');
  ok(!!check, "row checkbox found for s1-2 (Physics)");
  check.dispatchEvent(new window.Event("click", { bubbles: true }));
  const panel = document.getElementById("cse-syllabus-plus-panel");
  const chip = panel.querySelector('[data-units-toggle="s1-2"]');
  ok(/100%/.test(chip.textContent), "marking whole subject done reports 100% unit coverage even with no units individually checked");
}

// ---- Test 4: priority queue is weighted down by partial unit coverage ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const cfg = window.AriseCSEFullSyllabusConfig;

  // Mark every subject except s1-1 as done, so the (top-5-only) priority
  // panel isn't just showing unrelated higher-scoring subjects — this
  // isolates s1-1's own score before/after its units change.
  cfg.SUBJECTS.filter((s) => s.id !== "s1-1").forEach((s) => {
    const check = document.querySelector('[data-toggle="' + s.id + '"]');
    if (check) check.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  const priorityToggle = document.getElementById("csp-priority-toggle");
  priorityToggle.dispatchEvent(new window.Event("click", { bubbles: true }));

  function scoreFor(id) {
    const panel = document.getElementById("cse-syllabus-plus-panel");
    const row = panel.querySelector('[data-priority-jump="' + id + '"]');
    return row ? parseFloat(row.querySelector(".csp-priority-score").textContent) : null;
  }

  const beforeS11 = scoreFor("s1-1"); // Mathematics I, untouched, now the only pending subject
  ok(beforeS11 !== null && beforeS11 > 0, "s1-1 is the sole entry in the priority queue with a nonzero score");

  // Cover 80% of s1-1's units (4 of 5, each weighted 20%) — still "pending" overall
  const panel = document.getElementById("cse-syllabus-plus-panel");
  const chip = panel.querySelector('[data-units-toggle="s1-1"]');
  chip.dispatchEvent(new window.Event("click", { bubbles: true }));
  const panel2 = document.getElementById("cse-syllabus-plus-panel");
  const unitRows = Array.from(panel2.querySelectorAll('[data-unit-toggle^="s1-1:"]')).slice(0, 4);
  unitRows.forEach((el) => {
    el.checked = true;
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });

  const afterS11 = scoreFor("s1-1");
  ok(afterS11 !== null, "s1-1 still appears in the priority queue at 80% unit coverage (not yet marked fully done)");
  ok(afterS11 !== null && afterS11 < beforeS11, "s1-1's priority score dropped after covering 80% of its units (" + beforeS11 + " -> " + afterS11 + ")");
  // Expected multiplier ~ max(0.05, 1-0.8) = 0.2
  const ratio = afterS11 / beforeS11;
  ok(Math.abs(ratio - 0.2) < 0.02, "score dropped by roughly the expected 0.2x (20% remaining) factor, got ratio " + ratio.toFixed(3));
}

// ---- Test 5: a subject with no units[] (custom subject) is unaffected ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const addToggle = document.getElementById("csp-add-toggle");
  addToggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  document.getElementById("csp-f-name").value = "Elective: Quantum Computing";
  document.querySelector('[data-add-save]').dispatchEvent(new window.Event("click", { bubbles: true }));

  const panel = document.getElementById("cse-syllabus-plus-panel");
  // find the custom row by name
  const rows = Array.from(panel.querySelectorAll(".csp-row"));
  const customRow = rows.find((r) => /Quantum Computing/.test(r.textContent));
  ok(!!customRow, "custom subject row rendered");
  const chip = customRow.querySelector("[data-units-toggle]");
  ok(!chip, "no units chip rendered for a custom subject (no units[] breakdown) — falls back cleanly");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
