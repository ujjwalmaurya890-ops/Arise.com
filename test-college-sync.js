// Smoke test for the new "My College Sync" section added to
// cse-syllabus-plus-widget.js: per-semester hide/restore of base-list
// subjects (custom.removed) and bulk-paste add of college-specific
// subjects, against the real 56-subject production config.
//
// Run with: node test-college-sync.js
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
  return { dom, window, document: window.document };
}

function loadScripts(window) {
  const cfgCode = fs.readFileSync(path.join(BASE, "cse-full-syllabus-config.js"), "utf8");
  const widgetCode = fs.readFileSync(path.join(BASE, "cse-syllabus-plus-widget.js"), "utf8");
  window.eval(cfgCode);
  window.eval(widgetCode);
  if (window.document.readyState === "loading") {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  }
}

function openCollegeSync(document) {
  const toggle = document.getElementById("csp-collegesync-toggle");
  toggle.dispatchEvent(new (document.defaultView.Event)("click", { bubbles: true }));
}

// ---- Test 1: default custom shape includes removed:[] and getAllSubjects is unaffected ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const rows = document.querySelectorAll('[data-toggle^="s1-"]');
  eq(rows.length, 7, "all 7 Sem-1 base subjects render before anything is hidden");
}

// ---- Test 2: hiding a base subject via the checkbox removes it from the panel + stats ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  openCollegeSync(document);

  const panel = document.getElementById("cse-syllabus-plus-panel");
  const cb = panel.querySelector('[data-cs-toggle="s1-6"]'); // Engineering Drawing & Graphics
  ok(!!cb, "college-sync checkbox rendered for s1-6");
  ok(cb.checked, "s1-6 checkbox starts checked (not hidden)");

  cb.checked = false;
  cb.dispatchEvent(new window.Event("change", { bubbles: true }));

  const stored = JSON.parse(window.localStorage.getItem("cse-syllabus-custom-v1"));
  ok(Array.isArray(stored.removed) && stored.removed.indexOf("s1-6") !== -1, "unchecking persists s1-6 into custom.removed");

  const totalStat = document.querySelector(".csp-stat-value");
  const panel2 = document.getElementById("cse-syllabus-plus-panel");
  const row = panel2.querySelector('[data-toggle="s1-6"]');
  ok(!row, "hidden subject s1-6 no longer appears as a row in the main list");
  eq(parseInt(totalStat.textContent, 10), 55, "Total (incl. custom) stat drops from 56 to 55 after hiding one base subject");
}

// ---- Test 3: restoring via the checkbox brings it back ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  openCollegeSync(document);
  let panel = document.getElementById("cse-syllabus-plus-panel");
  let cb = panel.querySelector('[data-cs-toggle="s1-6"]');
  cb.checked = false;
  cb.dispatchEvent(new window.Event("change", { bubbles: true }));

  panel = document.getElementById("cse-syllabus-plus-panel");
  cb = panel.querySelector('[data-cs-toggle="s1-6"]');
  ok(!cb.checked, "checkbox reflects hidden state after re-render");
  cb.checked = true;
  cb.dispatchEvent(new window.Event("change", { bubbles: true }));

  const stored = JSON.parse(window.localStorage.getItem("cse-syllabus-custom-v1"));
  eq(stored.removed.length, 0, "rechecking restores s1-6 (removed list empty again)");
  const panel2 = document.getElementById("cse-syllabus-plus-panel");
  ok(!!panel2.querySelector('[data-toggle="s1-6"]'), "s1-6 row is back in the main list");
}

// ---- Test 4: "Restore all hidden" only touches the selected semester ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  // Hide two Sem-1 subjects and one Sem-2 subject directly via storage, then open the panel.
  window.localStorage.setItem("cse-syllabus-custom-v1", JSON.stringify({ added: [], edits: {}, order: {}, removed: ["s1-6", "s1-7", "s2-2"] }));
  openCollegeSync(document);
  let panel = document.getElementById("cse-syllabus-plus-panel");
  const restoreBtn = panel.querySelector("#csp-cs-restore-all");
  ok(!!restoreBtn, "restore-all button appears when Sem 1 (default) has hidden subjects");
  restoreBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

  const stored = JSON.parse(window.localStorage.getItem("cse-syllabus-custom-v1"));
  ok(stored.removed.indexOf("s1-6") === -1 && stored.removed.indexOf("s1-7") === -1, "Sem 1's hidden subjects are restored");
  ok(stored.removed.indexOf("s2-2") !== -1, "Sem 2's hidden subject (different semester) is left untouched");
}

// ---- Test 5: bulk-paste adds parsed subjects, dedupes against existing names, skips blanks ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  openCollegeSync(document);
  let panel = document.getElementById("cse-syllabus-plus-panel");
  const textarea = panel.querySelector("#csp-cs-bulk-text");
  textarea.value = [
    "Advanced Data Structures | 4 | Core",
    "  ", // blank line, ignored
    "DBMS Lab | 1 | Lab",
    "Mathematics I (Calculus & Linear Algebra)", // duplicate of canonical s1-1 by name, should be skipped
    "No Credits Or Type Given",
  ].join("\n");
  const addBtn = panel.querySelector("#csp-cs-bulk-add");
  // window.alert isn't implemented in jsdom by default - stub it so the click doesn't throw.
  window.alert = () => {};
  addBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

  const stored = JSON.parse(window.localStorage.getItem("cse-syllabus-custom-v1"));
  const names = stored.added.map((s) => s.name);
  ok(names.indexOf("Advanced Data Structures") !== -1, "bulk add included 'Advanced Data Structures'");
  ok(names.indexOf("DBMS Lab") !== -1, "bulk add included 'DBMS Lab'");
  ok(names.indexOf("No Credits Or Type Given") !== -1, "bulk add included the line with no credits/type (defaults applied)");
  eq(names.indexOf("Mathematics I (Calculus & Linear Algebra)"), -1, "duplicate of a canonical subject name was skipped, not added again");
  eq(stored.added.length, 3, "exactly 3 new custom subjects added from the pasted block");

  const ads = stored.added.filter((s) => s.name === "Advanced Data Structures")[0];
  eq(ads.credits, 4, "parsed credits for 'Advanced Data Structures'");
  eq(ads.type, "Core", "parsed type for 'Advanced Data Structures'");
  const noMeta = stored.added.filter((s) => s.name === "No Credits Or Type Given")[0];
  eq(noMeta.credits, 3, "default credits (3) applied when omitted");
  eq(noMeta.type, "Core", "default type (Core) applied when omitted");
  eq(ads.sem, "1", "bulk-added subjects are tagged with the currently-selected semester");

  const panel2 = document.getElementById("cse-syllabus-plus-panel");
  ok(!!panel2.querySelector('[data-toggle="' + ads.id + '"]'), "newly bulk-added subject appears as a real row in the main list");
}

// Test 6 (cross-consistency with the CSE Syllabus Readiness card) removed
// along with the Readiness card / Placement-Critical Readiness / Semester
// Mastery Heatmap / Semester Trend section — that widget is no longer
// loaded by the app, so there's nothing left for this test to check.

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
