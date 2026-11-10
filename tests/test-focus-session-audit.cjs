/**
 * tests/test-focus-session-audit.cjs
 * ---------------------------------------------------------------------------
 * Contribution 08 — focus session audit (src/focus-session-audit.js).
 *
 * Three writers record study time and they disagree:
 *   - the React Focus Timer writes studySessions { date, minutes };
 *   - the Timer Upgrade widget mirrors a finished run into focusSessionsV2
 *     { minutes, startedAt, endedAt } (so one run can appear twice);
 *   - the Stopwatch tab writes stopwatchSessions { totalTime: ms }, which no
 *     other widget reads, so that study time is invisible to streaks/analytics.
 * The React store also keeps a `streak` counter that it advances with a UTC day
 * loop, and the running timer only exists in memory.
 *
 * This module must:
 *   1. read every source with the unit each one actually uses;
 *   2. collapse the duplicate write of a single timer run;
 *   3. report per-day totals with the sources that produced them;
 *   4. flag days where the two stores disagree and a streak the log cannot back;
 *   5. import stopwatch runs only on an explicit, confirmed action;
 *   6. never invent a session, never write a session store silently.
 *
 * Run: node tests/test-focus-session-audit.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed += 1;
  else { failures.push(label); console.error("  FAIL  " + label); }
}

// Timestamps are derived from "now" so the suite keeps meaning on any day.
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0).toISOString();
const daysAgo = (n, h, min) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
};
const TODAY = (() => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
})();
const YESTERDAY = (() => {
  const d = new Date(Date.now() - 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
})();

const FOCUS = [
  { id: "f1", task: "Graphs", category: "DSA", minutes: 50, date: TODAY, startedAt: daysAgo(0, 9, 0), endedAt: daysAgo(0, 9, 50), rating: 4, distractions: 0 },
  { id: "f2", task: "Portfolio", category: "Project", minutes: 25, date: YESTERDAY, startedAt: null, endedAt: daysAgo(1, 20, 0) }
];

const STUDY = [
  // Same run as f1, written by the widget from the same event.
  { date: TODAY, minutes: 50, savedAt: daysAgo(0, 9, 51) },
  // A legacy row the widget never mirrored (timer finished while the widget was off).
  { date: TODAY, minutes: 30, savedAt: daysAgo(0, 15, 0) }
];

const STOPWATCH = [
  { id: "sw1", date: TODAY, totalTime: 42 * 60000, laps: [{ lapNumber: 1 }, { lapNumber: 2 }], savedAt: daysAgo(0, 17, 0) },
  // Under a minute: React itself refuses to save these, so neither do we.
  { id: "sw2", date: TODAY, totalTime: 30000, laps: [], savedAt: daysAgo(0, 18, 0) }
];

function boot(storage, options) {
  const opts = options || {};
  const dom = new JSDOM("<!doctype html><html><body><div id=\"arise-main\"></div></body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const seed = storage || { focusSessionsV2: FOCUS, studySessions: STUDY, stopwatchSessions: STOPWATCH };
  for (const [key, value] of Object.entries(seed)) {
    w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  let confirmCalls = 0;
  w.confirm = () => {
    confirmCalls += 1;
    return opts.confirmAnswer !== false;
  };
  w.__confirmCalls = () => confirmCalls;
  w.eval(read("src/focus-session-audit.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const A = w.AriseFocusAudit;
  const state = A.reconcile();

  ok(state.focus.length === 2, "focusSessionsV2 rows are read: " + state.focus.length);
  ok(state.legacy.length === 2, "studySessions rows are read: " + state.legacy.length);
  ok(state.stopwatch.length === 1, "stopwatch runs under a minute are ignored, like the React timer does: " + state.stopwatch.length);
  ok(state.stopwatch[0].minutes === 42 && state.stopwatch[0].laps === 2, "stopwatch totalTime is milliseconds: " + state.stopwatch[0].minutes);
  ok(state.duplicates === 1, "the mirrored write of one timer run is counted once: " + state.duplicates);
  ok(state.total === 3, "three distinct sessions remain: " + state.total);
  ok(state.minutes === 105, "total minutes are summed in one unit: " + state.minutes);

  const records = A.records();
  ok(records.every((record) => record.origin === "focus" || record.origin === "legacy"), "records carry their origin");
  ok(records.filter((record) => record.day === TODAY).length === 2, "same-day sessions stay on their local day");
  ok(A.records().every((record) => /^\d{4}-\d{2}-\d{2}$/.test(record.day)), "every record has a calendar day key");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const state = w.AriseFocusAudit.reconcile();
  const todayRow = state.discrepancies.find((row) => row.day === TODAY);
  ok(!!todayRow, "a day the two stores describe differently is reported: " + JSON.stringify(state.discrepancies));
  ok(todayRow.focus === 50 && todayRow.legacy === 80,
    "the discrepancy compares real totals: focus " + todayRow.focus + " vs legacy " + todayRow.legacy);
  ok(!state.discrepancies.some((row) => row.day === YESTERDAY), "a day only one store knows about is not a discrepancy");

  const totals = w.AriseFocusAudit.dayTotals({ days: 3 });
  ok(totals.length === 3 && totals[2].day === TODAY, "dayTotals ends today and covers the requested window");
  ok(totals[2].minutes === 80, "today's reconciled minutes include the mirrored run once: " + totals[2].minutes);
  ok(Object.keys(totals[2].sources).sort().join(",") === "focus,legacy", "per-day sources are reported");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const state = w.AriseFocusAudit.reconcile();
  ok(state.pendingStopwatch.length === 1 && state.pendingStopwatch[0].id === "sw1", "unimported stopwatch runs are queued");
  ok(state.pendingStopwatchMinutes === 42, "the pending stopwatch time is quantified: " + state.pendingStopwatchMinutes);

  // Declining the confirmation must write nothing at all.
  w.confirm = () => false;
  w.AriseFocusAudit.open();
  const before = w.localStorage.getItem("focusSessionsV2");
  w.document.querySelector("[data-fsa-action='import-stopwatch']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(w.localStorage.getItem("focusSessionsV2") === before, "declining the confirmation writes nothing");
  ok(w.localStorage.getItem("arise-focus-audit-v1") === null, "declining does not record an import");
  w.AriseFocusAudit.close();

  // Accepting imports exactly the pending runs, once.
  w.confirm = () => true;
  const result = w.AriseFocusAudit.importStopwatch();
  ok(result.imported === 1 && result.skipped === 0, "confirming imports the pending run: " + JSON.stringify(result));
  const stored = JSON.parse(w.localStorage.getItem("focusSessionsV2"));
  ok(stored.length === 3, "one record is appended, nothing is replaced: " + stored.length);
  const imported = stored[stored.length - 1];
  ok(imported.__importedFromStopwatch === true && imported.category === "Other", "the import is labelled with its source and a real category");
  ok(/Stopwatch session/.test(imported.task) && /2 laps/.test(imported.task), "the import keeps the lap count in the task name: " + imported.task);
  ok(imported.endedAt === daysAgo(0, 17, 0), "the import keeps the original timestamp");
  const flag = JSON.parse(w.localStorage.getItem("arise-focus-audit-v1"));
  ok(flag.importedStopwatch.includes("sw1") && flag.lastImportAt, "the import is recorded so it cannot run twice");
  ok(w.AriseFocusAudit.importStopwatch().imported === 0, "importing again is a no-op");
  ok(w.AriseFocusAudit.reconcile().pendingStopwatch.length === 0, "the queue is now empty");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  // Streak counter the session log cannot support (the UTC day loop defect).
  const w = boot({
    focusSessionsV2: [{ id: "f", category: "DSA", minutes: 20, endedAt: daysAgo(0, 9, 0) }],
    studySessions: [],
    stopwatchSessions: [],
    streak: 6
  });
  const state = w.AriseFocusAudit.reconcile();
  ok(state.streak.stored === 6, "the stored streak counter is read");
  ok(state.streakMismatch === true, "a streak the log cannot support is flagged");
  w.AriseFocusAudit.open();
  ok(/only supports/i.test(w.document.getElementById("fsa-panel").textContent), "the panel explains the mismatch in words");
  w.AriseFocusAudit.close();

  const consistent = boot({
    focusSessionsV2: [
      { id: "a", category: "DSA", minutes: 20, endedAt: daysAgo(0, 9, 0) },
      { id: "b", category: "DSA", minutes: 20, endedAt: daysAgo(1, 9, 0) }
    ],
    studySessions: [], stopwatchSessions: [], streak: 2
  });
  const clean = consistent.AriseFocusAudit.reconcile();
  ok(clean.streak.local === 2 && clean.streakMismatch === false,
    "a counter backed by two consecutive logged days is confirmed: " + JSON.stringify(clean.streak));
  consistent.close(); w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const doc = w.document;
  const launcher = doc.getElementById("fsa-launcher");
  ok(!!launcher, "an audit launcher exists in the app chrome");
  ok(launcher.getAttribute("aria-haspopup") === "dialog", "the launcher announces the dialog");

  w.AriseFocusAudit.open();
  const panel = doc.getElementById("fsa-panel");
  ok(panel.getAttribute("data-open") === "true", "open() shows the panel");
  ok(!!panel.querySelector('[role="dialog"][aria-modal="true"][aria-labelledby="fsa-title"]'), "the panel is a labelled modal");
  ok(doc.activeElement === panel.querySelector(".fsa-close"), "focus moves into the dialog");
  ok(panel.querySelectorAll(".fsa-day").length === 7, "the panel charts the last seven days");
  ok(panel.querySelector(".fsa-status").textContent.includes("duplicate"), "the live status mentions the collapsed duplicate");
  ok(panel.querySelector(".fsa-primary").textContent.includes("Import"), "the import action names what it will do");

  const event = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  doc.dispatchEvent(event);
  ok(panel.getAttribute("data-open") === "false", "Escape closes the panel");
  ok(panel.getAttribute("aria-hidden") === "true", "the closed panel is hidden from assistive technology");

  // Corrupt stores must not throw and must not be "repaired".
  const w2 = boot({ focusSessionsV2: "nope", studySessions: { not: "an array" }, stopwatchSessions: "[broken" });
  const empty = w2.AriseFocusAudit.reconcile();
  ok(empty.total === 0 && empty.minutes === 0, "corrupt stores degrade to an empty audit");
  ok(empty.pendingStopwatch.length === 0, "a corrupt stopwatch store has nothing to import");
  w2.AriseFocusAudit.open();
  ok(/No stopwatch runs recorded/i.test(w2.document.getElementById("fsa-panel").textContent), "the panel says there is nothing rather than guessing");
  w2.close(); w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot();
  const html = read("index.html");
  const css = read("styles/focus-session-audit.css");
  const keys = read("src/storage-keys.js");
  const schema = read("src/cloud/storage-schema.js");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/focus-session-audit.css"'), "the stylesheet is linked from index.html");
  ok(html.includes("'./src/focus-session-audit.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(keys.includes("arise-focus-audit-v1") && schema.includes("arise-focus-audit-v1"), "the audit key is documented and synced");
  ok(sw.includes("./src/focus-session-audit.js") && sw.includes("./styles/focus-session-audit.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicate entries");
  ok(/prefers-reduced-motion/.test(css) && /@media \(max-width: 680px\)/.test(css), "reduced motion and small screens are handled");
  ok(!/\.glass-card\s*\{/.test(css), "the stylesheet cannot restyle existing cards");

  const source = read("src/focus-session-audit.js");
  ok(/window\.confirm/.test(source), "the only store write is behind a confirmation");
  ok(!/localStorage\.setItem\(\s*STUDY_KEY/.test(source) && !/localStorage\.setItem\(\s*STOPWATCH_KEY/.test(source),
    "the module never rewrites the legacy or stopwatch stores");
  w.close();
}

console.log("\nFocus session audit: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
