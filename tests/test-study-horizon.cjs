/**
 * tests/test-study-horizon.cjs
 * ---------------------------------------------------------------------------
 * Contribution 09 — study horizon (src/study-horizon.js).
 *
 * Exam dates (with the CSE syllabus override), syllabus topic states, the DSA
 * backlog and the daily study goal each live in their own widget, and none of
 * them answers "which of the next two weeks is impossible?".
 *
 * The horizon must:
 *   1. read exams from the tracker and let the syllabus date override win;
 *   2. attribute every planned minute to a driver (exam, prep, revision, DSA);
 *   3. derive capacity from real recent sessions, with a documented fallback;
 *   4. classify each day so an overloaded day is obvious, and say when a day is
 *      free instead of implying zero work is bad;
 *   5. never write to any store;
 *   6. tolerate missing/corrupt stores and exams without topics.
 *
 * Run: node tests/test-study-horizon.cjs
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

const NOW = new Date(2026, 10, 10, 9, 0, 0); // Tuesday 10 Nov 2026
const key = (offset) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

const EXAMS = {
  version: 2,
  exams: [
    {
      id: "e1", examName: "DBMS Finals", subjectName: "DBMS", examDate: key(2),
      topics: [
        { id: "t1", title: "Normalisation", status: "Not Started", confidence: 1 },
        { id: "t2", title: "Transactions", status: "In Progress", confidence: 2 },
        { id: "t3", title: "Indexing", status: "Completed", confidence: 4 }
      ]
    },
    {
      id: "e2", examName: "Operating Systems", subjectName: "OS", examDate: key(10),
      topics: [{ id: "t4", title: "Deadlock", status: "Not Started", confidence: 3 }]
    },
    { id: "e3", examName: "Undated Quiz", topics: [] },
    { id: "e4", examName: "Old Exam", examDate: key(-5), topics: [{ id: "t5", title: "X", status: "Not Started" }] }
  ]
};

const SESSIONS = [
  { id: "s1", category: "DSA", minutes: 60, startedAt: new Date(2026, 10, 9, 10, 0).toISOString() },
  { id: "s2", category: "DSA", minutes: 120, startedAt: new Date(2026, 10, 8, 10, 0).toISOString() },
  { id: "s3", category: "Dev", minutes: 30, startedAt: new Date(2026, 10, 6, 10, 0).toISOString() }
];

function boot(storage, body) {
  const dom = new JSDOM("<!doctype html><html><body>" + (body == null ? "<div id=\"arise-main\"><header><h1>Exam Tracker</h1></header><div class=\"space-y-6\"><section id=\"existing\">existing</section></div></div>" : body) + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const seed = storage || {
    "arise_exam_tracker_v1": EXAMS,
    "dsaQuestions": [{ id: "q1", solved: true }, { id: "q2", solved: false }, { id: "q3", solved: false }],
    "dsaDailyGoal": { target: 2 },
    "focusSessionsV2": SESSIONS
  };
  for (const [k, value] of Object.entries(seed)) {
    w.localStorage.setItem(k, typeof value === "string" ? value : JSON.stringify(value));
  }
  w.eval(read("src/study-horizon.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const H = w.AriseHorizon;
  const exams = H.exams();

  ok(exams.length === 2, "undated and past exams are dropped, upcoming ones kept: " + exams.length);
  ok(exams[0].id === "e1" && exams[0].day === key(2), "exams are ordered by date: " + exams.map((e) => e.day).join(","));
  const dbms = exams[0];
  ok(dbms.openTopics === 2 && dbms.weakTopics === 2,
    "completed topics are excluded and 1-2 confidence topics flagged: " + JSON.stringify({ open: dbms.openTopics, weak: dbms.weakTopics }));
  ok(!exams.some((exam) => exam.id === "e4"), "an exam in the past is not part of the horizon input");
  ok(w.AriseHorizon.exams({ includePast: true }).some((exam) => exam.id === "e4"), "history callers can still ask for past exams");

  // The syllabus override wins over the tracker date, exactly as the widgets read it.
  const w2 = boot({
    "arise_exam_tracker_v1": EXAMS,
    "cse-syllabus-exam-dates-v1": { e1: key(6) },
    dsaQuestions: [], focusSessionsV2: []
  });
  const overridden = w2.AriseHorizon.exams().find((exam) => exam.id === "e1");
  ok(overridden.day === key(6), "the syllabus exam-date override wins: " + overridden.day);
  w2.close();

  ok(H.dsaBacklog().open === 2 && H.dsaBacklog().perDay === 2, "the DSA backlog and daily goal are read: " + JSON.stringify(H.dsaBacklog()));
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const cap = w.AriseHorizon.capacity({ now: NOW });
  ok(cap.basis === "recent sessions" && cap.sample === 3, "capacity is derived from real sessions: " + JSON.stringify(cap));
  ok(cap.minutes === 60, "the median of active days is used, not the best day: " + cap.minutes);

  const empty = boot({ dsaQuestions: [], focusSessionsV2: [] });
  const fallback = empty.AriseHorizon.capacity({ now: NOW });
  ok(fallback.basis === "default" && fallback.minutes === 90, "with no history the documented default is used: " + fallback.minutes);
  empty.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const rows = w.AriseHorizon.days({ now: NOW, days: 14 });
  ok(rows.length === 14, "the horizon spans fourteen days");
  ok(rows[0].isToday === true && rows[0].key === key(0), "the horizon starts today");
  ok(rows.every((row) => ["free", "light", "full", "overloaded"].includes(row.load)), "every day carries a load state");

  const examDay = rows.find((row) => row.key === key(2));
  ok(examDay.drivers.some((d) => d.kind === "exam" && /DBMS/.test(d.label)), "the exam day names the exam: " + JSON.stringify(examDay.drivers));
  ok(examDay.load === "overloaded", "an exam day is judged against capacity: " + examDay.load);

  const prepDay = rows.find((row) => row.key === key(1));
  ok(prepDay.drivers.some((d) => d.kind === "revision"), "the day before an exam is revision work: " + JSON.stringify(prepDay.drivers.map((d) => d.kind)));
  ok(prepDay.drivers.some((d) => /exam (tomorrow|in \d+ days)/.test(d.note)), "the driver explains why the day is loaded: " +
    JSON.stringify(prepDay.drivers.map((d) => d.note)));

  ok(rows.some((row) => row.drivers.some((d) => d.kind === "dsa")), "the DSA backlog is part of the daily load");
  const afterExam = rows.find((row) => row.key === key(5));
  ok(afterExam.drivers.some((d) => d.kind === "prep" || d.kind === "dsa"), "the OS exam on day 10 is spread across the week before");

  const farDay = rows.find((row) => row.key === key(13));
  ok(farDay.drivers.every((d) => d.kind !== "exam"), "no exam is attributed beyond its own day");
  const dayAfter = rows.find((row) => row.key === key(3));
  ok(!dayAfter.drivers.some((d) => /DBMS/.test(d.label)),
    "exam prep stops once the exam has happened: " + JSON.stringify(dayAfter.drivers.map((d) => d.label)));
  ok(rows.every((row) => row.minutesNeeded === row.drivers.reduce((sum, d) => sum + d.minutes, 0)),
    "every planned minute is attributed to a driver");
  ok(rows.every((row) => row.capacity === 60), "capacity is applied consistently across the horizon");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot();
  const state = w.AriseHorizon.summary({ now: NOW, days: 14 });
  ok(state.rows.length === 14, "the summary carries the rows");
  ok(state.heaviest && state.heaviest.minutesNeeded >= 180, "the heaviest day is identified: " + (state.heaviest && state.heaviest.key));
  ok(state.overloaded.length >= 1, "overloaded days are listed: " + state.overloaded.length);
  ok(state.nextExam && state.nextExam.id === "e1", "the next exam is the nearest dated one");
  ok(state.totals.minutes > 0 && state.totals.capacity.minutes === 60, "totals add up");

  const free = boot({
    "arise_exam_tracker_v1": { version: 2, exams: [] },
    dsaQuestions: [{ id: "q", solved: true }],
    focusSessionsV2: []
  });
  const quiet = free.AriseHorizon.summary({ now: NOW, days: 3 });
  ok(quiet.rows.every((row) => row.load === "free" && row.minutesNeeded === 0), "with nothing planned every day is honestly free");
  ok(quiet.overloaded.length === 0 && quiet.nextExam === null, "nothing is invented when there is no data");
  free.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const doc = w.document;
  const card = doc.getElementById("sh-card");
  ok(!!card, "the horizon card mounts on the Exam Tracker route");
  ok(card.parentElement.classList.contains("space-y-6"), "it joins the route card stack");
  ok(!!doc.getElementById("existing"), "existing cards are untouched");
  ok(card.querySelectorAll(".sh-day").length === 14, "fourteen day rows are rendered");
  ok(card.querySelector('.sh-day[data-today="true"]') !== null, "today is marked");
  ok(card.querySelectorAll('.sh-day[data-load="overloaded"]').length >= 1, "overloaded days are visually distinct");
  ok(/DBMS/.test(card.textContent), "the card names the exam that drives the load");
  ok(card.querySelector(".sh-cap").textContent === "60m/day", "capacity is shown next to the plan: " + card.querySelector(".sh-cap").textContent);
  ok(/Nothing here writes to a widget/i.test(card.textContent), "the card states its read-only contract");
  ok(doc.querySelectorAll("#sh-card").length === 1, "repeated mounts keep a single card");

  // The Exam Tracker route renders its cards in a .space-y-5 stack, not .space-y-6.
  const tighter = boot(undefined, '<div id="arise-main"><header><h1>Exam Tracker</h1></header><div class="space-y-5"><section id="exam-body">body</section></div></div>');
  const tighterCard = tighter.document.getElementById("sh-card");
  ok(!!tighterCard && tighterCard.parentElement.classList.contains("space-y-5"),
    "the card follows the route's own stack class: " + (tighterCard && tighterCard.parentElement.className));
  tighter.close();

  // The CSE Syllabus route needs the same answer.
  const syllabus = boot(undefined, '<div id="arise-main"><header><h1>CSE Syllabus</h1></header><div class="space-y-6"></div></div>');
  ok(!!syllabus.document.getElementById("sh-card"), "the card also mounts on CSE Syllabus");

  const other = boot(undefined, '<div id="arise-main"><header><h1>Dashboard</h1></header><div class="space-y-6"></div></div>');
  ok(!other.document.getElementById("sh-card"), "it never mounts on unrelated routes");
  other.close(); syllabus.close();
  w.AriseHorizon.unmount();
  ok(!doc.getElementById("sh-card"), "unmount removes the card");
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot({ "arise_exam_tracker_v1": "broken", dsaQuestions: 42, dsaDailyGoal: { target: "x" }, focusSessionsV2: [{ minutes: "lots" }] });
  const state = w.AriseHorizon.summary({ now: NOW, days: 3 });
  ok(state.rows.length === 3 && state.rows.every((row) => row.load === "free"), "corrupt stores produce an honest empty horizon");
  ok(w.AriseHorizon.exams().length === 0, "a corrupt exam store has no exams");
  ok(w.AriseHorizon.capacity().basis === "default", "capacity falls back safely");

  const tight = boot({
    "arise_exam_tracker_v1": { exams: [{ id: "e", examName: "Only", examDate: key(0), topics: "not an array" }] },
    dsaQuestions: [], focusSessionsV2: []
  });
  const days = tight.AriseHorizon.days({ now: NOW, days: 2 });
  ok(days[0].drivers.some((d) => d.kind === "exam"), "an exam with malformed topics still shows up on its day");
  ok(tight.AriseHorizon.exams()[0].openTopics === 0, "malformed topics are ignored, not guessed");
  tight.close(); w.close();
}

/* ------------------------------------------------------------------ suite 7 */
{
  const w = boot();
  const html = read("index.html");
  const css = read("styles/study-horizon.css");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/study-horizon.css"'), "the stylesheet is linked from index.html");
  ok(html.includes("'./src/study-horizon.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(sw.includes("./src/study-horizon.js") && sw.includes("./styles/study-horizon.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicate entries");
  ok(/prefers-reduced-motion/.test(css) && /@media \(max-width: 680px\)/.test(css), "reduced motion and small screens are handled");
  ok(/\.sh-driver \{ flex-direction: column/.test(css), "driver labels and costs stack on small screens instead of overlapping");
  const source = read("src/study-horizon.js");
  ok(!/localStorage\.setItem/.test(source), "the horizon never writes to storage");
  ok(!/\.glass-card\s*\{/.test(css), "the stylesheet cannot restyle existing cards");
  ok(typeof w.AriseHorizon.days === "function" && typeof w.AriseHorizon.summary === "function", "the public API is complete");
  w.close();
}

console.log("\nStudy horizon: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
