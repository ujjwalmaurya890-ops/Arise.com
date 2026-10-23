// Smoke test for the CSE Syllabus Mastery panel in cse-syllabus-plus-widget.js
// (the readiness score, its history, milestones and level-up banner were removed):
//  1. "Upcoming Exams" panel (auto-shown when an exam date is within 30 days),
//     with click-to-jump and no per-subject readiness %.
//  2. "Mastery by Semester" toggle panel (per-semester completion bars).
//  3. Score Breakdown panel (simple vs credit-weighted completion).
//  4. Regression guard: no readiness score / history / milestone UI or storage.
//
// Run with: node test-readiness-panels-upgrade.js
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
  window.requestAnimationFrame = function (cb) { setTimeout(cb, 0); };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  return { dom, window, document: window.document, store };
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

function panel(document) { return document.getElementById("cse-syllabus-plus-panel"); }

// ---- Test 1: no upcoming exams -> panel absent ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const p = panel(document);
  ok(!p.innerHTML.includes("Upcoming Exams"), "Upcoming Exams panel is absent with no exam dates set");
}

// ---- Test 2: an exam date within 30 days shows the panel with the subject + countdown ----
{
  const { window, document, store } = freshDom();
  loadScripts(window);
  const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  // s1-1 is the first Sem-1 subject in the base config.
  store["cse-syllabus-exam-dates-v1"] = JSON.stringify({ "s1-1": soon });
  window.dispatchEvent(new window.Event("storage"));
  // Re-render explicitly in case the storage event isn't wired to this key.
  const toggle = document.getElementById("csp-sembreak-toggle");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true })); // forces a re-render (b())
  toggle.dispatchEvent(new window.Event("click", { bubbles: true })); // toggle back off
  const p = panel(document);
  ok(p.innerHTML.includes("Upcoming Exams"), "Upcoming Exams panel renders once an exam date is within 30 days");
  ok(p.innerHTML.includes("in 5d"), "shows correct days-until-exam countdown");
  const row = p.querySelector('[data-exam-jump="s1-1"]');
  ok(!!row, "exam row rendered with data-exam-jump for the subject");
  ok(!/% ready/.test(p.innerHTML), "exam row no longer shows a per-subject readiness %");
}

// ---- Test 3: exam-jump row click scrolls/filters (reuses jump wiring, sets p.sem back to All) ----
{
  const { window, document, store } = freshDom();
  loadScripts(window);
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  store["cse-syllabus-exam-dates-v1"] = JSON.stringify({ "s1-1": soon });
  const searchInput = document.getElementById("csp-search");
  searchInput.value = "zzz-no-match";
  searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  // Force a full re-render so the exam panel reflects the just-set exam date
  // and the filtered search state, mirroring how storage-watch triggers X().
  const toggle = document.getElementById("csp-sembreak-toggle");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  const row = panel(document).querySelector('[data-exam-jump="s1-1"]');
  if (row) {
    row.dispatchEvent(new window.Event("click", { bubbles: true }));
    eq(document.getElementById("csp-search").value, "", "clicking an exam row clears the active search filter");
  } else {
    fail++; console.error("FAIL: exam row not found for jump test");
  }
}

// ---- Test 4: Semester Breakdown panel is hidden by default, shown on toggle ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  ok(!panel(document).innerHTML.includes("Mastery by Semester"), "Semester Breakdown panel hidden by default");
  const toggle = document.getElementById("csp-sembreak-toggle");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  ok(panel(document).innerHTML.includes("Mastery by Semester"), "Semester Breakdown panel shows after toggle click");
  ok(/Semester 1|Sem 1/.test(panel(document).innerHTML), "renders a Semester 1 row");
}

// ---- Test 5: Semester Breakdown percentages reflect real progress ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const toggle = document.getElementById("csp-sembreak-toggle");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  // Mark every Sem-1 subject done via the checkboxes.
  const boxes = panel(document).querySelectorAll('[data-toggle^="s1-"]');
  ok(boxes.length > 0, "Sem-1 checkboxes found");
  boxes.forEach((cb) => cb.dispatchEvent(new window.Event("click", { bubbles: true })));
  const html = panel(document).innerHTML;
  ok(html.includes("100%"), "Semester Breakdown shows 100% once every Sem-1 subject is marked done");
}

// ---- Test 6: readiness history toggle/panel no longer exists, and nothing is recorded ----
{
  const { window, document, store } = freshDom();
  loadScripts(window);
  ok(!document.getElementById("csp-history-toggle"), "Readiness History toggle button is gone");
  const toggle = document.getElementById("csp-sembreak-toggle"); // forces re-renders
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  ok(!panel(document).innerHTML.includes("Readiness History"), "no Readiness History panel text");
  ok(store["cse-syllabus-readiness-history-v1"] === undefined, "no readiness history is written to storage");
  ok(store["cse-syllabus-readiness-trend-v1"] === undefined, "no readiness trend snapshot is written to storage");
}

// ---- Test 7: stale readiness data left over from older versions is purged on load ----
{
  const dom = freshDom();
  dom.store["cse-syllabus-readiness-history-v1"] = JSON.stringify([{ d: "2020-01-01", pct: 10 }, { d: "2020-01-02", pct: 25 }]);
  dom.store["cse-syllabus-readiness-trend-v1"] = JSON.stringify({ pct: 10, ts: Date.now() });
  dom.store["cse-syllabus-readiness-milestone-seen-v1"] = JSON.stringify("Building");
  loadScripts(dom.window);
  ok(dom.store["cse-syllabus-readiness-history-v1"] === undefined, "stale readiness history removed");
  ok(dom.store["cse-syllabus-readiness-trend-v1"] === undefined, "stale readiness trend removed");
  ok(dom.store["cse-syllabus-readiness-milestone-seen-v1"] === undefined, "stale milestone marker removed");
}

// ---- Test 8: the readiness hero (ring / % / level badge / milestones / mode toggle) is gone ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const html = panel(document).innerHTML;
  ok(!/readiness/i.test(html), "the word 'readiness' appears nowhere in the mastery panel");
  ok(!panel(document).querySelector(".csp-hero, .csp-ring, .csp-percent, .csp-milestones, .csp-ring-level"), "no hero / ring / percent / milestone elements");
  ok(!panel(document).querySelector("[data-mode]"), "ring-only Simple/Credit toggle is gone");
}
// ---- Test 9: Score Breakdown panel hidden by default; shows both mode percentages + credit totals on toggle ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  ok(!panel(document).innerHTML.includes("Credit-Weighted Mastery"), "Score Breakdown panel content hidden by default");
  const toggle = document.getElementById("csp-scorebreak-toggle");
  toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  const html = panel(document).innerHTML;
  ok(html.includes("Simple Mastery"), "shows Simple Mastery row");
  ok(html.includes("Credit-Weighted Mastery"), "shows Credit-Weighted Mastery row");
  ok(/\d+\/\d+ credits/.test(html), "shows a real credits-done/total figure, not just a percentage");
}

// ---- Test 10: Score Breakdown explains the direction of the simple-vs-credit gap ----
{
  const { window, document } = freshDom();
  loadScripts(window);
  const scoreToggle = document.getElementById("csp-scorebreak-toggle");
  scoreToggle.dispatchEvent(new window.Event("click", { bubbles: true }));
  // Mark done the single highest-credit Sem-1 subject only, to force creditPct > simplePct.
  const panelEl = panel(document);
  const rows = Array.from(panelEl.querySelectorAll('[data-toggle^="s1-"]'));
  ok(rows.length > 0, "Sem-1 subject checkboxes present");
  // Click the first one (deterministic vs. the base config's known credit spread).
  rows[0].dispatchEvent(new window.Event("click", { bubbles: true }));
  const html = panel(document).innerHTML;
  ok(html.includes("Simple Mastery") && html.includes("Credit-Weighted Mastery"), "breakdown panel persists after marking a subject done");
  ok(/point(s)? (higher|lower)|Both scoring modes currently agree exactly/.test(html), "explains the simple-vs-credit relationship in plain language");
}

// ---- Test 11: marking subjects done never produces a level-up / celebration banner ----
{
  const { window, document, store } = freshDom();
  loadScripts(window);
  const allBoxes = Array.from(panel(document).querySelectorAll("[data-toggle]"));
  ok(allBoxes.length >= 10, "at least 10 subject checkboxes found across all semesters");
  const need = Math.ceil(allBoxes.length * 0.6);
  for (let i = 0; i < need; i++) allBoxes[i].dispatchEvent(new window.Event("click", { bubbles: true }));
  ok(!panel(document).innerHTML.includes("Level up!"), "no level-up banner after crossing former readiness bands");
  ok(!document.getElementById("csp-milestone-dismiss"), "no milestone dismiss button");
  ok(store["cse-syllabus-readiness-milestone-seen-v1"] === undefined, "no milestone marker stored");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
