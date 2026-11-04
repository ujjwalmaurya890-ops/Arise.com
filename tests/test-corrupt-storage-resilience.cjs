/**
 * tests/test-corrupt-storage-resilience.cjs
 * ---------------------------------------------------------------------------
 * Regression cover for widgets that must survive corrupt / wrong-shaped data
 * in localStorage.
 *
 * WHY THIS EXISTS
 * A repository-wide boot probe (every src/*.js widget loaded in jsdom with
 * hostile-but-parseable storage values) showed the Career Command Center
 * throwing `r.filter is not a function` during mount. Its storage reader
 * returned whatever JSON.parse produced, so a stored `null`, `true`, a number
 * or an object where a list was expected reached `.filter()` / `.length` and
 * killed the whole panel - the user saw an empty section, not their data.
 *
 * `JSON.parse` succeeding is not the same as the stored value having the shape
 * the caller requires. These tests pin that distinction.
 *
 * Run: node tests/test-corrupt-storage-resilience.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const WIDGET = "src/career-command-center-widget.js";

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ✓ " + name);
  } catch (error) {
    failures.push({ name, error });
    console.error("  ✗ " + name + "\n      " + error.message);
  }
}

/**
 * Boot only the widget under test, with a container and the shared buses the
 * production page provides. Returns { window, errors, mounted }.
 */
function bootWidget(widgetFile, storedValues) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><main id="arise-main"><header><h1>Dashboard</h1></header></main></body></html>',
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" }
  );
  const w = dom.window;
  for (const [key, value] of Object.entries(storedValues || {})) {
    w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const errors = [];
  w.addEventListener("error", (event) => errors.push(String(event.message || event.error)));
  w.__ariseReportWidgetError = () => {};
  w.eval(
    "window.__ARISE_MUTATION_BUS__={mute:function(f){return f()},subscribe:function(){return function(){}}};" +
      "window.__ARISE_STORAGE_WATCH_BUS__={watch:function(){return function(){}}};"
  );
  w.eval(read("src/widget-shared-utils.js"));
  w.eval(read(widgetFile));

  const container = w.document.createElement("div");
  w.document.getElementById("arise-main").appendChild(container);

  let thrown = null;
  const mount = Object.keys(w).find((key) => key.startsWith("__mount") && typeof w[key] === "function");
  try {
    if (mount) w[mount](container);
  } catch (error) {
    thrown = error;
  }
  return { window: w, errors, thrown, container, mount };
}

console.log("Career Command Center — wrong-shaped stored data");

const CORRUPT_CASES = [
  ["a JSON null where a list is expected", { dsaQuestions: "null", devTasks: "null", projects: "null" }],
  ["a boolean where a list is expected", { dsaQuestions: "true", devTasks: "false" }],
  ["a number where a list is expected", { dsaQuestions: "42" }],
  ["an object where a list is expected", { dsaQuestions: '{"a":1}', devTasks: '{"b":2}', projects: '{"c":3}' }],
  ["an array where an object is expected", { "cse-syllabus-progress-v1": "[1,2,3]", interviewSheetsProgress: "[4]" }],
  ["a string where an object is expected", { "cse-syllabus-progress-v1": '"oops"' }],
  ["unparseable JSON", { dsaQuestions: "{not json", devTasks: "[[[" }],
  ["null sessions", { studySessions: "null", "arise-sessions": "{}" }],
  ["wrong-typed numeric settings", { streak: '"seven"', cgpa: "[]" }]
];

for (const [label, values] of CORRUPT_CASES) {
  test(label + " mounts without throwing", () => {
    const { thrown, errors } = bootWidget(WIDGET, values);
    assert.equal(errors.length, 0, "uncaught window errors: " + errors.join(" | "));
    assert.equal(thrown, null, "mount threw: " + (thrown && thrown.message));
  });
}

test("still renders its section from a valid store", () => {
  const { thrown, container } = bootWidget(WIDGET, {
    dsaQuestions: [{ id: "a", solved: true, difficulty: "Easy", dateSolved: "2026-02-09T10:00:00.000Z" }],
    devTasks: [{ id: "d1", completed: true, category: "Frontend", difficulty: "Intermediate" }]
  });
  assert.equal(thrown, null);
  assert.ok(container.textContent.replace(/\s+/g, "").length > 30, "expected rendered content");
});

test("a corrupt list does not hide the rest of the panel", () => {
  // Previously this combination threw before anything rendered.
  const { thrown, container } = bootWidget(WIDGET, {
    dsaQuestions: "null",
    devTasks: [{ id: "d1", completed: true, category: "Frontend", difficulty: "Intermediate" }]
  });
  assert.equal(thrown, null);
  assert.ok(container.textContent.replace(/\s+/g, "").length > 30, "expected a partial panel, got a blank one");
});

console.log("\nRepository-wide guard: no widget crashes on hostile storage");

test("every widget that exposes __mount survives wrong-shaped storage", () => {
  const HOSTILE = {
    studySessions: '[{"date":"not-a-date","minutes":"abc"}]',
    dsaQuestions: '{"not":"an array"}',
    tasks: "null",
    devTasks: "[]",
    interviewSheetsProgress: "[1,2,3]",
    projects: '{"a":1}',
    revisionSystemProgress: '"str"',
    smartLearningPathProgress: "[]",
    xpState: "[]",
    focusSessionsV2: "{}"
  };
  const failuresHere = [];
  const files = fs.readdirSync(path.join(root, "src")).filter((f) => f.endsWith(".js")).sort();
  for (const file of files) {
    let result;
    try {
      result = bootWidget(path.join("src", file), HOSTILE);
    } catch (error) {
      failuresHere.push(file + ": boot threw " + error.message);
      continue;
    }
    // jsdom has no fetch; a widget that needs the network is not a storage bug.
    const message = result.thrown && result.thrown.message;
    if (result.thrown && !/fetch is not defined|not defined/.test(message)) {
      failuresHere.push(file + ": " + message);
    }
    // Widgets install intervals/listeners; close the window so the process can
    // exit instead of being held open by a live timer.
    try { result.window.close(); } catch (_) {}
  }
  assert.deepEqual(failuresHere, []);
});

if (failures.length) {
  console.error("\n" + failures.length + " failing, " + passed + " passing");
  process.exitCode = 1;
} else {
  console.log("\nAll " + passed + " corrupt-storage assertions passed.");
}
// Widget scripts register intervals/MutationObservers on purpose; nothing here
// is a server, so exit explicitly once assertions are done.
process.exit(failures.length ? 1 : 0);
