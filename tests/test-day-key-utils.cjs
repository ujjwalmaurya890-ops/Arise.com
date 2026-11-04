/**
 * tests/test-day-key-utils.cjs
 * ---------------------------------------------------------------------------
 * Regression cover for the shared local-day helpers in
 * src/widget-shared-utils.js.
 *
 * WHY THIS EXISTS
 * `dayKey()` used to return an unpadded string ("2026-1-9"). Because callers
 * use day keys as sort keys, comparison values and (in two mastery-trend
 * widgets) as *display labels*, the unpadded form is a real defect:
 *
 *   - as a string, "2026-1-9" > "2026-1-10"  ("9" > "1"), so any lexical
 *     sort/compare/bucket lookup is wrong from January to September;
 *   - the same value was rendered to users, e.g. "2026-2-9".
 *
 * These tests fail on the old implementation and pass on the padded one.
 * They also pin the DST and timezone behaviour of the surrounding helpers so a
 * future "fix" cannot silently reintroduce day drift.
 *
 * Run: node tests/test-day-key-utils.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/widget-shared-utils.js"), "utf8");

function loadUtils() {
  const store = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    Promise,
    performance: { now: () => Date.now() },
    queueMicrotask,
    URL,
    DOMException,
    document: {
      readyState: "complete",
      baseURI: "https://example.test/",
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {} } }),
      addEventListener() {}
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  };
  sandbox.window = sandbox;
  sandbox.window.matchMedia = () => ({ matches: false });
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "src/widget-shared-utils.js" });
  return sandbox.window.__ARISE_WIDGET_UTILS__;
}

const U = loadUtils();

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

console.log("dayKey() — canonical local YYYY-MM-DD");

test("zero-pads single-digit months and days", () => {
  assert.equal(U.dayKey(new Date(2026, 0, 9)), "2026-01-09");
  assert.equal(U.dayKey(new Date(2026, 8, 5)), "2026-09-05");
  assert.equal(U.dayKey(new Date(2026, 11, 31)), "2026-12-31");
});

test("day keys sort chronologically as plain strings across a month boundary", () => {
  // The exact case the unpadded implementation got backwards.
  assert.ok(U.dayKey(new Date(2026, 0, 9)) < U.dayKey(new Date(2026, 0, 10)));
  assert.ok(U.dayKey(new Date(2026, 8, 9)) < U.dayKey(new Date(2026, 8, 10)));
  const days = [9, 10, 11, 1, 2, 31, 30].map((d) => U.dayKey(new Date(2026, 0, d)));
  const sorted = days.slice().sort();
  assert.deepEqual(
    sorted,
    [1, 2, 9, 10, 11, 30, 31].map((d) => U.dayKey(new Date(2026, 0, d)))
  );
});

test("is stable for the same calendar day at any hour (local midnight based)", () => {
  const early = new Date(2026, 1, 3, 0, 0, 1);
  const late = new Date(2026, 1, 3, 23, 59, 59);
  assert.equal(U.dayKey(early), "2026-02-03");
  assert.equal(U.dayKey(early), U.dayKey(late));
});

test("rejects invalid input instead of emitting NaN keys", () => {
  assert.equal(U.dayKey(new Date("nope")), "");
  assert.equal(U.dayKey(NaN), "");
});

console.log("\nutcDayKey() — reads legacy toISOString()-derived records");

test("returns the UTC calendar date", () => {
  assert.equal(U.utcDayKey(new Date(Date.UTC(2026, 0, 5, 23, 30))), "2026-01-05");
});

test("is padded, so it stays sortable", () => {
  assert.equal(U.utcDayKey(new Date(Date.UTC(2026, 0, 9))), "2026-01-09");
  assert.ok(U.utcDayKey(new Date(Date.UTC(2026, 0, 9))) < U.utcDayKey(new Date(Date.UTC(2026, 0, 10))));
});

console.log("\ndayKeyToDate() — parses back to local midnight");

test("round-trips a key to the same local day", () => {
  const date = U.dayKeyToDate("2026-03-08");
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 2);
  assert.equal(date.getDate(), 8);
  assert.equal(date.getHours(), 0);
  assert.equal(U.dayKey(date), "2026-03-08");
});

test("does not shift the day for timezones behind UTC", () => {
  // `new Date("2026-03-08")` is UTC midnight; in e.g. UTC-8 that is 2026-03-07.
  const parsed = U.dayKeyToDate("2026-03-08");
  assert.equal(parsed.getDate(), 8);
});

test("rejects malformed and impossible dates", () => {
  for (const bad of ["2026-3-8", "not-a-date", "", "2026-02-30", "2026-13-01", null, undefined, 0]) {
    assert.equal(U.dayKeyToDate(bad), null, "expected null for " + String(bad));
  }
});

console.log("\ndaysBetween() — calendar-day arithmetic");

test("counts calendar days, not elapsed milliseconds", () => {
  assert.equal(U.daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 2)), 1);
  assert.equal(U.daysBetween(new Date(2026, 0, 1), new Date(2026, 2, 1)), 59);
  assert.equal(U.daysBetween(new Date(2026, 2, 1), new Date(2026, 0, 1)), -59);
});

test("returns 0 within one day", () => {
  assert.equal(U.daysBetween(new Date(2026, 4, 6, 0, 5), new Date(2026, 4, 6, 23, 55)), 0);
});

test("handles a DST transition as exactly one day", () => {
  // US spring forward (2026-03-08) and EU spring forward (2026-03-29).
  assert.equal(U.daysBetween(new Date(2026, 2, 7, 12), new Date(2026, 2, 9, 12)), 2);
  assert.equal(U.daysBetween(new Date(2026, 2, 28, 12), new Date(2026, 2, 30, 12)), 2);
});

console.log("\nweekLabel() — human-facing label");

test("formats a readable label instead of a machine day key", () => {
  assert.equal(U.weekLabel(new Date(2026, 1, 9)), "9 Feb 2026");
  assert.equal(U.weekLabel(new Date(2026, 11, 25)), "25 Dec 2026");
});

test("never looks like a raw day key", () => {
  assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test(U.weekLabel(new Date(2026, 1, 9))));
  assert.equal(U.weekLabel(new Date("nope")), "");
});

console.log("\nisSameLocalDay()");

test("compares timestamps, Dates and keys", () => {
  const a = new Date(2026, 6, 4, 1).getTime();
  const b = new Date(2026, 6, 4, 22).getTime();
  assert.equal(U.isSameLocalDay(a, b), true);
  assert.equal(U.isSameLocalDay("2026-07-04", b), true);
  assert.equal(U.isSameLocalDay(a, new Date(2026, 6, 5)), false);
});

console.log("\nstartOfDay() defensiveness");

test("returns NaN rather than throwing on invalid input", () => {
  assert.ok(Number.isNaN(U.startOfDay(new Date("nope"))));
  assert.ok(Number.isFinite(U.startOfDay(new Date(2026, 0, 1, 15, 30))));
  assert.equal(new Date(U.startOfDay(new Date(2026, 0, 1, 15, 30))).getHours(), 0);
});

console.log("\nRegression guards — the shipped helper is the padded one");

test("source no longer contains the unpadded key expression", () => {
  assert.ok(!/getFullYear\(\)\s*\+\s*"-"\s*\+\s*\(\s*\w+\.getMonth\(\)\s*\+\s*1\s*\)\s*\+\s*"-"/.test(source));
});

test("every dashboard widget that compares day keys uses the shared helper", () => {
  // Guards against a widget reintroducing its own unpadded formatter.
  const dir = path.join(root, "src");
  const offenders = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    if (/getFullYear\(\)\s*\+\s*"-"\s*\+\s*\(\s*\w+\.getMonth\(\)/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

if (failures.length) {
  console.error("\n" + failures.length + " failing, " + passed + " passing");
  process.exitCode = 1;
} else {
  console.log("\nAll " + passed + " day-key assertions passed.");
}
