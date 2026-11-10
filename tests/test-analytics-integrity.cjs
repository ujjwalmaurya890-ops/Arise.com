/**
 * tests/test-analytics-integrity.cjs
 * ---------------------------------------------------------------------------
 * Contribution 06 — analytics period accuracy (src/analytics-integrity.js).
 *
 * Analytics, Session Analytics and the weekly report all bucketed sessions by
 * `new Date(x).toISOString().split("T")[0]`, i.e. the UTC day. That files a
 * session studied at 05:00 IST under yesterday and resets "today" mid-morning.
 *
 * This module must:
 *   1. produce local calendar day keys, and week ranges that agree with them;
 *   2. bucket real focusSessionsV2 sessions into the right local day;
 *   3. count a session once even when it is also present in legacy
 *      studySessions, and ignore zero-minute/invalid rows;
 *   4. compare the current range with the previous range of equal length, with
 *      an honest "first activity" result instead of a divide-by-zero;
 *   5. expose audit() numbers for records whose UTC day differs from local;
 *   6. render an empty state rather than zero-filled charts, with an
 *      accessible range control, and never rewrite sessions.
 *
 * The suite pins TZ=Asia/Kolkata so the UTC/local difference is real and
 * deterministic. Run: TZ=Asia/Kolkata node tests/test-analytics-integrity.cjs
 */
"use strict";

process.env.TZ = "Asia/Kolkata";

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

// Stamps are literal UTC strings that correspond to known IST wall-clock times,
// so the expectations do not depend on which timezone the test runner happens
// to launch with (jsdom's window is the Date that matters here).
//   2026-11-09T23:30Z = 10 Nov 05:00 IST   (UTC day 9, local day 10)
//   2026-11-09T18:10Z = 09 Nov 23:40 IST
const NOW = new Date("2026-11-10T12:30:00.000Z"); // 18:00 IST
const iso = (y, m, d, h, min) => {
  const utc = Date.UTC(y, m - 1, d, h, min) - 5.5 * 60 * 60 * 1000;
  return new Date(utc).toISOString();
};

const CARD = '<div id="arise-main"><header><h1>Analytics</h1></header>' +
  '<div class="flex-1"><div class="space-y-6"><section id="existing-card">Existing analytics card</section></div></div></div>';

function boot(storage, body) {
  const dom = new JSDOM("<!doctype html><html><body>" + (body == null ? CARD : body) + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [key, value] of Object.entries(storage || {})) {
    w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  w.eval(read("src/analytics-integrity.js"));
  return w;
}

const SEED_SESSIONS = [
  // 05:00 IST on 10 Nov is still 9 Nov in UTC — the regression this fixes.
  { id: "s1", category: "DSA", minutes: 60, startedAt: iso(2026, 11, 10, 5, 0), endedAt: iso(2026, 11, 10, 6, 0), rating: 4, distractions: 1 },
  // Late-night session: 23:40 IST on 9 Nov is still 9 Nov in UTC.
  { id: "s2", category: "Project", minutes: 30, startedAt: iso(2026, 11, 9, 23, 40) },
  // Plain "today" session.
  { id: "s3", category: "DSA", minutes: 45, date: "2026-11-10", rating: 3 },
  // Seven days ago (inside a 7-day window that ends today).
  { id: "s4", category: "College", minutes: 15, startedAt: iso(2026, 11, 4, 20, 0) },
  // Zero minutes and junk rows must never affect a total.
  { id: "s5", category: "DSA", minutes: 0, startedAt: iso(2026, 11, 10, 9, 0) },
  { id: "s6", category: "DSA", minutes: 20, startedAt: "not a date" }
];

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot({});
  const A = w.AriseAnalytics;

  ok(A.dayKey(new Date(2026, 10, 10, 5, 0)) === "2026-11-10", "dayKey uses the local calendar day at 05:00 IST");
  ok(A.utcKey(new Date(2026, 10, 10, 5, 0)) === "2026-11-09", "the old UTC key is demonstrably different (regression guard)");
  ok(A.dayKey("2026-11-10") === "2026-11-10", "a date-only string stays on its own day");
  ok(A.dayKey("nonsense") === null, "an invalid date has no day key");
  ok(A.addDays("2026-11-01", -1) === "2026-10-31" && A.addDays("2026-12-31", 1) === "2027-01-01", "addDays crosses month and year boundaries");
  ok(A.fromKey("2026-11-10").getHours() === 0, "fromKey returns local midnight, not UTC midnight");

  const keys = A.rangeKeys("2026-11-10", 3);
  ok(keys.join(",") === "2026-11-08,2026-11-09,2026-11-10", "rangeKeys is oldest-first and ends today: " + keys.join(","));
  ok(A.rangeKeys("2026-11-10", 0).length === 1, "a zero-length range is clamped to one day");

  const week = A.weekOf(new Date(2026, 10, 10)); // Tuesday
  ok(week.start === "2026-11-09" && week.end === "2026-11-15", "the week starts on Monday: " + week.start + ".." + week.end);
  ok(week.keys.length === 7 && week.keys[0] === week.start && week.keys[6] === week.end, "week keys line up with the range");
  ok(A.weekOf(new Date(2026, 10, 8)).start === "2026-11-02", "a Sunday belongs to the week that started six days earlier");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot({ focusSessionsV2: SEED_SESSIONS });
  const A = w.AriseAnalytics;
  const list = A.sessions();

  ok(list.length === 4, "invalid and zero-minute sessions are dropped: " + list.length);
  const s1 = list.find((entry) => entry.id === "s1");
  ok(!!s1 && s1.day === "2026-11-10", "a 05:00 IST session is bucketed on the local day: " + (s1 && s1.day));
  const s2 = list.find((entry) => entry.id === "s2");
  ok(s2.day === "2026-11-09", "a 23:40 IST session stays on the day it was studied: " + s2.day);

  const summary = A.summarise({ days: 7, now: NOW });
  ok(summary.range.end === "2026-11-10" && summary.range.start === "2026-11-04", "the range is the trailing week: " + summary.range.start + ".." + summary.range.end);
  ok(summary.minutes === 150, "total minutes include the early-morning and late-night sessions: " + summary.minutes);
  ok(summary.buckets["2026-11-10"] === 105, "10 Nov holds the 05:00 and the date-only sessions: " + summary.buckets["2026-11-10"]);
  ok(summary.buckets["2026-11-09"] === 30, "the 23:40 session stays on 9 Nov, its local day: " + summary.buckets["2026-11-09"]);
  ok(summary.buckets["2026-11-04"] === 15, "a session exactly on the range start is included");
  ok(summary.activeDays === 3, "only days with real minutes count as active: " + summary.activeDays);
  ok(summary.byCategory.DSA === 105 && summary.byCategory.Project === 30, "category totals add up to the period total");
  ok(summary.avgRating === 3.5 && summary.distractions === 1, "ratings and distractions come from the real records");
  ok(summary.hasData === true, "hasData is true when sessions exist");

  const stored = JSON.parse(w.localStorage.getItem("focusSessionsV2"));
  ok(stored.length === SEED_SESSIONS.length, "reading sessions never rewrites focusSessionsV2");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot({
    focusSessionsV2: [{ id: "f1", category: "DSA", minutes: 30, startedAt: iso(2026, 11, 10, 9, 0) }],
    studySessions: [
      { id: "f1", category: "DSA", minutes: 30, startedAt: iso(2026, 11, 10, 9, 0) }, // same session, legacy copy
      { id: "l2", category: "College", minutes: 20, startedAt: iso(2026, 11, 10, 11, 0) }
    ]
  });
  const list = w.AriseAnalytics.sessions();
  ok(list.length === 2, "a session present in both stores is counted once: " + list.length);
  const summary = w.AriseAnalytics.summarise({ days: 7, now: NOW });
  ok(summary.minutes === 50, "legacy-only sessions are still included: " + summary.minutes);
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const previous = [
    { id: "p1", category: "DSA", minutes: 100, startedAt: iso(2026, 11, 2, 10, 0) },
    { id: "p2", category: "DSA", minutes: 100, startedAt: iso(2026, 11, 3, 10, 0) }
  ];
  const w = boot({ focusSessionsV2: previous.concat([{ id: "c1", category: "DSA", minutes: 150, startedAt: iso(2026, 11, 10, 10, 0) }]) });
  const summary = w.AriseAnalytics.summarise({ days: 7, now: NOW });
  ok(summary.previous.minutes === 200, "the previous 7 days are measured separately: " + summary.previous.minutes);
  ok(summary.deltaPercent === -25, "the change is a real percentage: " + summary.deltaPercent);
  ok(summary.previous.start === "2026-10-28" && summary.previous.end === "2026-11-03", "the previous range is adjacent, not overlapping");

  const w2 = boot({ focusSessionsV2: [{ id: "n1", category: "DSA", minutes: 30, startedAt: iso(2026, 11, 10, 9, 0) }] });
  const first = w2.AriseAnalytics.summarise({ days: 7, now: NOW });
  ok(first.previous.minutes === 0 && first.deltaPercent === 100, "the first week of data reports first activity, not infinity: " + first.deltaPercent);

  const w3 = boot({ focusSessionsV2: [{ id: "t1", category: "DSA", minutes: 30, startedAt: iso(2026, 11, 10, 9, 0) }] });
  const thirty = w3.AriseAnalytics.summarise({ days: 30, now: NOW });
  ok(thirty.avgPerDay === 1 && thirty.range.keys.length === 30, "averages divide by the range, not the session count: " + thirty.avgPerDay);
  ok(w3.AriseAnalytics.summarise({ days: 0 }).range.days >= 1, "an invalid range falls back to a usable window");
  w3.close(); w2.close(); w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot({
    focusSessionsV2: SEED_SESSIONS.concat([
      { id: "future", category: "DSA", minutes: 100, startedAt: iso(2026, 12, 1, 10, 0) },
      // 00:10 IST on 11 Nov: the only stamp whose UTC day (10 Nov) differs from
      // its local day (11 Nov), i.e. the exact case the old code mis-filed.
      { id: "early", category: "DSA", minutes: 25, startedAt: iso(2026, 11, 11, 0, 10) },
      // Same id as s1, different length: the widget's own id is the identity.
      { id: "s1", category: "DSA", minutes: 12, startedAt: iso(2026, 11, 5, 10, 0) }
    ])
  });
  const audit = w.AriseAnalytics.audit({ now: NOW });
  ok(audit.total === 7, "audit counts the usable sessions: " + audit.total);
  ok(audit.utcMismatchCount >= 1, "audit finds sessions whose UTC day differs from the local day: " + audit.utcMismatchCount);
  ok(audit.utcMismatches.every((row) => row.localDay !== row.utcDay), "every mismatch row shows both days");
  ok(audit.future.length === 1 && audit.future[0].id === "future", "future-dated records are reported, not silently counted");
  ok(audit.duplicateIds === 1, "a duplicated id is reported once: " + audit.duplicateIds);
  ok(audit.timezoneOffsetMinutes === 330, "the browser's real timezone offset is reported: " + audit.timezoneOffsetMinutes);
  const summary = w.AriseAnalytics.summarise({ days: 400, now: NOW });
  ok(!Object.keys(summary.buckets).some((key) => key === "2026-12-01"), "a future session is excluded from totals");
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot({});
  const doc = w.document;
  const card = doc.getElementById("ani-card");
  ok(!!card, "the accuracy card mounts on the Analytics route");
  ok(!!doc.getElementById("existing-card"), "existing analytics cards are left in place");
  ok(card.parentElement.classList.contains("space-y-6"),
    "the card joins the route's card stack (not the flex column): " + (card.parentElement && card.parentElement.className));
  ok(/no focus sessions recorded yet/i.test(card.textContent), "an empty account gets an explanation, not a zeroed chart: " + card.textContent.slice(0, 60));
  ok(card.querySelectorAll(".ani-bar").length === 7, "the chart renders one bar per day in the range");
  ok(card.querySelectorAll('.ani-bar:not([data-empty="true"])').length === 0, "empty days render as flat tracks");
  ok(card.querySelector("[role='img']").getAttribute("aria-label").includes("7-day study minutes"), "the chart has a textual alternative");
  ok(card.querySelectorAll("[data-ani-range]").length === 3, "the range control offers 7/30/90 days");
  ok(card.querySelector("[data-ani-range='7']").getAttribute("aria-pressed") === "true", "the default range is pressed");

  // A second mount call must not duplicate the card (the observer fires often).
  w.AriseAnalytics.mount();
  w.AriseAnalytics.mount();
  ok(doc.querySelectorAll("#ani-card").length === 1, "repeated mounts keep exactly one card");

  card.querySelector("[data-ani-range='30']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(card.querySelectorAll(".ani-bar").length === 30, "switching the range re-renders the chart");
  ok(card.querySelector("[data-ani-range='30']").getAttribute("aria-pressed") === "true", "the chosen range is announced");
  ok(card.querySelector("[data-ani-range='7']").getAttribute("aria-pressed") === "false", "the previous range is released");
  ok(JSON.parse(w.localStorage.getItem("arise-analytics-integrity-v1")).range === 30, "the chosen range is the only thing persisted");

  const w2 = boot({ "arise-analytics-integrity-v1": { version: 1, range: 90 } });
  ok(w2.document.querySelectorAll(".ani-bar").length === 90, "a saved range is restored on the next visit");
  ok(w2.document.querySelectorAll(".ani-stat").length === 4, "the summary keeps the same stat slots in every range");

  const offline = boot({}, '<div id="arise-main"><header><h1>Dashboard</h1></header><div class="flex-1"><div class="space-y-6"></div></div></div>');
  ok(!offline.document.getElementById("ani-card"), "the card never mounts outside the Analytics route");
  const w3 = boot({}, '<div id="arise-main"><header><h1>Analytics</h1></header><div class="flex-1"><div class="space-y-6"></div></div></div>');
  w3.AriseAnalytics.unmount();
  ok(!w3.document.getElementById("ani-card"), "unmount removes the card cleanly");
  offline.close(); w3.close(); w2.close(); w.close();
}

/* ------------------------------------------------------------------ suite 7 */
{
  const w = boot({ focusSessionsV2: SEED_SESSIONS });
  const html = read("index.html");
  const css = read("styles/analytics-integrity.css");
  const keys = read("src/storage-keys.js");
  const schema = read("src/cloud/storage-schema.js");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/analytics-integrity.css"'), "the stylesheet is linked from index.html");
  ok(html.includes("'./src/analytics-integrity.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(html.indexOf("./src/knowledge-assistant.js") < html.indexOf("./src/analytics-integrity.js"), "loader order is stable");
  ok(keys.includes("arise-analytics-integrity-v1") && schema.includes("arise-analytics-integrity-v1"), "the UI key is documented and allow-listed for sync");
  ok(sw.includes("./src/analytics-integrity.js") && sw.includes("./styles/analytics-integrity.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicate entries");
  ok(/prefers-reduced-motion/.test(css) && /@media \(max-width: 680px\)/.test(css), "reduced motion and small screens are handled");
  ok(!/\.glass-card\s*\{/.test(css), "the stylesheet cannot restyle existing cards");
  const code = read("src/analytics-integrity.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  ok(!/toISOString\(\)\.split/.test(code), "the module never derives a day key from toISOString().split");
  ok(/getFullYear\(\)/.test(code), "day keys come from local calendar fields");
  const sources = ["src/learning-session-analytics-widget.js", "src/focus-timer-upgrade-widget.js"];
  ok(sources.every((file) => fs.existsSync(path.join(root, file))), "the widgets this change explains still exist");
  w.close();
}

console.log("\nAnalytics integrity: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
