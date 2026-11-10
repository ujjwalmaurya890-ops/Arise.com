/**
 * tests/test-day-plan.cjs
 * ---------------------------------------------------------------------------
 * Contribution 07 — day plan (src/day-plan.js).
 *
 * Daily Tasks already owns the real task list (arise-daily-learning-tasks-v1:
 * tasks + archive + heatmap + streak) and the DSA goal widget owns the daily
 * target. The dashboard only showed "Study Today".
 *
 * This module must compose, never duplicate:
 *   1. read today's tasks from the existing store, ordered by open/priority;
 *   2. fold in the DSA goal and today's study minutes (via the analytics maths
 *      when it is present) without recomputing them differently;
 *   3. summarise completed days from the widget's own archive;
 *   4. warn when the live list belongs to an earlier day instead of pretending
 *      it is today's plan;
 *   5. never create, complete or rewrite a task;
 *   6. render a labelled, keyboard-reachable card that hands off to the real
 *      Daily Tasks widget via the real navigation.
 *
 * Run: node tests/test-day-plan.cjs
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

const NOW = new Date(2026, 10, 10, 18, 0, 0);
const TODAY = "2026-11-10";
const YESTERDAY = "2026-11-09";
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min, 0).toISOString();

const TASKS = {
  tasks: [
    { id: "t1", text: "Finish graphs revision", createdAt: 1, completedAt: null, priority: "high", note: "Kahn + DFS", xpAwarded: false, tag: "DSA", pomodoroCount: 2, order: 1 },
    { id: "t2", text: "Ship portfolio fix", createdAt: 2, completedAt: at(2026, 11, 10, 9, 30), priority: "medium", note: "", xpAwarded: true, tag: "Dev", pomodoroCount: 0, order: 2 },
    { id: "t3", text: "Read systems notes", createdAt: 3, completedAt: null, priority: "low", note: "", xpAwarded: false, tag: "College", pomodoroCount: 0, order: 3 },
    { id: "t4", text: "Solve two mediums", createdAt: 4, completedAt: null, priority: "high", note: "", xpAwarded: false, tag: "DSA", pomodoroCount: 0, order: 4 }
  ],
  archive: {
    "2026-11-08": [
      { id: "a1", text: "Old task one", createdAt: at(2026, 11, 8, 8, 0), completedAt: at(2026, 11, 8, 10, 0), priority: "medium", tag: "DSA" },
      { id: "a2", text: "Old task two", createdAt: at(2026, 11, 8, 9, 0), completedAt: null, priority: "high", tag: "Dev" }
    ],
    "2026-11-07": [
      { id: "a3", text: "Old task three", createdAt: at(2026, 11, 7, 8, 0), createdAt2: null, completedAt: at(2026, 11, 7, 9, 0), priority: "low", tag: "Notes" }
    ]
  },
  streak: 4,
  streakDate: TODAY,
  heatmap: { "2026-11-10": 3, "2026-11-08": 2 }
};

const DSA = [
  { id: "q1", title: "Two Sum", solved: true, dateSolved: TODAY },
  { id: "q2", title: "Course Schedule", solved: true, dateSolved: YESTERDAY },
  { id: "q3", title: "Merge Intervals", solved: false }
];

const SESSIONS = [
  { id: "s1", category: "DSA", minutes: 50, startedAt: at(2026, 11, 10, 9, 0) },
  { id: "s2", category: "Dev", minutes: 40, startedAt: at(2026, 11, 9, 20, 0) }
];

const DASHBOARD = '<div id="arise-main"><header><h1>Dashboard</h1></header>' +
  '<div class="flex-1"><div class="arise-route-state"><div class="space-y-6"><section id="first-card">first</section></div></div></div>' +
  '<nav id="arise-desktop-nav"><button>Learning</button><button>Dashboard</button></nav></div>';

function boot(storage, body) {
  const dom = new JSDOM("<!doctype html><html><body>" + (body == null ? DASHBOARD : body) + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const seed = storage || {
    "arise-daily-learning-tasks-v1": TASKS,
    dsaQuestions: DSA,
    dsaDailyGoal: { target: 3 },
    focusSessionsV2: SESSIONS
  };
  for (const [key, value] of Object.entries(seed)) {
    w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  w.eval(read("src/day-plan.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const plan = w.AriseDayPlan.today({ now: NOW });

  ok(plan.key === TODAY, "the plan is keyed by the local calendar day: " + plan.key);
  ok(plan.total === 4 && plan.done === 1, "every stored task is counted: " + plan.done + "/" + plan.total);
  ok(plan.percent === 25, "progress is a real percentage: " + plan.percent);
  ok(plan.tasks[0].done === false && plan.tasks[0].priority === "high", "open high-priority tasks come first");
  ok(plan.tasks[plan.tasks.length - 1].done === true, "completed tasks sink to the bottom");
  ok(plan.tasks.filter((task) => task.priority === "high").length === 2, "priority is read from the stored task, not the order");
  ok(plan.tasks[0].text === "Finish graphs revision" && plan.tasks[0].tag === "DSA" && plan.tasks[0].pomodoros === 2,
    "task fields survive normalisation: " + JSON.stringify(plan.tasks[0]));
  ok(plan.byTag.DSA.total === 2 && plan.byTag.DSA.done === 0 && plan.byTag.Dev.done === 1, "per-tag progress is reported");

  ok(plan.dsa.solved === 1 && plan.dsa.target === 3 && plan.dsa.remaining === 2 && plan.dsa.met === false,
    "the DSA goal uses dateSolved for today only: " + JSON.stringify(plan.dsa));
  ok(plan.study.minutes === 50, "today's study minutes come from focusSessionsV2: " + plan.study.minutes);
  ok(plan.next && plan.next.kind === "task" && plan.next.label === "Finish graphs revision", "the next action is the top open task");
  ok(plan.streak === 4 && plan.heatmapToday === 3, "the widget's streak and heatmap are surfaced, not recalculated");
  ok(plan.isNewDay === false, "a fresh day is not flagged as stale");

  const stored = JSON.parse(w.localStorage.getItem("arise-daily-learning-tasks-v1"));
  ok(stored.tasks.length === 4 && stored.tasks[0].completedAt === null, "reading the plan never rewrites the task store");
  ok(w.localStorage.getItem("arise-day-plan-v1") === null, "reading the plan does not create a UI key");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const week = w.AriseDayPlan.week({ now: NOW });
  ok(week.length === 7, "the week strip has seven days");
  ok(week[6].key === TODAY && week[6].isToday, "the strip ends on today");
  ok(week[0].key === "2026-11-04", "the strip starts six days back: " + week[0].key);
  const eighth = week.find((row) => row.key === "2026-11-08");
  ok(eighth.total === 2 && eighth.done === 1 && eighth.archived === 2, "archived days are summarised from the widget's archive: " + JSON.stringify(eighth));
  const seventh = week.find((row) => row.key === "2026-11-07");
  ok(seventh.total === 1 && seventh.done === 1, "a fully completed archived day is reported as such");
  const emptyDay = week.find((row) => row.key === "2026-11-06");
  ok(emptyDay.total === 0 && emptyDay.done === 0, "days with no tasks are reported honestly, not zero-filled as failed");
  ok(week[6].done === 1 && week[6].total === 4, "today's row comes from the live list");

  const archived = w.AriseDayPlan.tasksFor("2026-11-08");
  ok(archived.length === 2 && archived[0].id === "a2", "an archived day can be inspected directly: " + archived.map((t) => t.id).join(","));
  ok(w.AriseDayPlan.tasksFor(TODAY).length === 4, "tasksFor(today) matches the live plan");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  // A stale list: the widget's streakDate says the tasks were written yesterday.
  const stale = boot({
    "arise-daily-learning-tasks-v1": Object.assign({}, TASKS, { streakDate: YESTERDAY }),
    dsaQuestions: DSA,
    dsaDailyGoal: { target: 3 },
    focusSessionsV2: SESSIONS
  });
  const plan = stale.AriseDayPlan.today({ now: NOW });
  ok(plan.isNewDay === true, "a list left over from an earlier day is flagged");
  stale.AriseDayPlan.mount();
  ok(/written yesterday/i.test(stale.document.getElementById("dp-card").textContent), "the card says the list is stale instead of implying it is today's");

  // No tasks at all: the plan must still answer with the DSA/study facts.
  const empty = boot({ dsaQuestions: [], focusSessionsV2: [] });
  const blank = empty.AriseDayPlan.today({ now: NOW });
  ok(blank.total === 0 && blank.percent === 0 && blank.tasks.length === 0, "an empty account has an empty plan");
  ok(blank.next && blank.next.kind === "dsa", "the next action falls back to the DSA goal: " + (blank.next && blank.next.kind));
  ok(blank.study.minutes === 0 && blank.dsa.solved === 0, "missing stores read as zero without throwing");

  const finished = boot({
    "arise-daily-learning-tasks-v1": { tasks: [{ id: "x", text: "Only task", createdAt: 1, completedAt: at(2026, 11, 10, 8, 0), priority: "medium", tag: "DSA" }], archive: {}, streak: 1, streakDate: TODAY, heatmap: {} },
    dsaQuestions: [{ id: "q", solved: true, dateSolved: TODAY }],
    dsaDailyGoal: { target: 1 },
    focusSessionsV2: [{ id: "s", category: "DSA", minutes: 30, startedAt: at(2026, 11, 10, 9, 0) }]
  });
  const donePlan = finished.AriseDayPlan.today({ now: NOW });
  ok(donePlan.percent === 100 && donePlan.next === null, "a completed day has no next action: " + JSON.stringify(donePlan.next));
  finished.AriseDayPlan.mount();
  ok(/plan is clear/i.test(finished.document.getElementById("dp-card").textContent), "the card celebrates a cleared plan");
  finished.close(); empty.close(); stale.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot({
    "arise-daily-learning-tasks-v1": "corrupt json",
    dsaQuestions: "also corrupt",
    dsaDailyGoal: { target: "not a number" },
    focusSessionsV2: [{ id: "bad", minutes: "lots", startedAt: "nope" }, { id: "ok", minutes: 25, startedAt: at(2026, 11, 10, 7, 0) }]
  });
  const plan = w.AriseDayPlan.today({ now: NOW });
  ok(plan.total === 0 && plan.tasks.length === 0, "a corrupt task store degrades to an empty plan");
  ok(plan.dsa.target >= 1 && plan.dsa.target <= 20, "a nonsense goal target falls back inside a sane range: " + plan.dsa.target);
  ok(plan.study.minutes === 25, "unusable sessions are skipped, valid ones still count: " + plan.study.minutes);
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const doc = w.document;
  const card = doc.getElementById("dp-card");
  ok(!!card, "the Today card mounts on the dashboard");
  ok(card.parentElement.classList.contains("space-y-6"), "it joins the dashboard card stack: " + (card.parentElement && card.parentElement.className));
  ok(!!doc.getElementById("first-card"), "existing dashboard cards keep their place");
  ok(doc.querySelectorAll("#dp-card").length === 1, "mounting repeatedly keeps exactly one card");
  ok(card.querySelector(".dp-title").id === "dp-title" && card.getAttribute("aria-labelledby") === "dp-title", "the card is labelled by its heading");
  ok(card.querySelectorAll(".dp-task").length === 4, "every task is listed (six max)");
  ok(!!card.querySelector(".dp-task[data-done='true']"), "completed tasks are marked in the DOM, not hidden");
  ok(card.querySelectorAll(".dp-day").length === 7, "the week strip renders seven days");
  ok(card.querySelector('.dp-day[data-today="true"]') !== null, "today is marked in the strip");
  ok(card.querySelector(".dp-ring").getAttribute("aria-label").includes("25%"), "the ring exposes its value as text");
  ok(/1 of 4 tasks/.test(card.querySelector(".dp-sub").textContent), "the summary line states real counts: " + card.querySelector(".dp-sub").textContent);
  ok(/1\/3 DSA/.test(card.querySelector(".dp-sub").textContent), "the DSA line uses today's solves");

  // The hand-off must use the real navigation, never a second task list.
  const clicked = [];
  doc.querySelectorAll("#arise-desktop-nav button").forEach((button) => {
    button.addEventListener("click", () => clicked.push(button.textContent.trim()));
  });
  card.querySelector("[data-dp-action='open-tasks']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(clicked.includes("Learning"), "Open Daily Tasks navigates with the real sidebar button: " + clicked.join(","));

  // A dashboard-less DOM must not mount anything.
  const other = boot({}, '<div id="arise-main"><header><h1>Analytics</h1></header><div class="flex-1"><div class="space-y-6"></div></div></div>');
  ok(!other.document.getElementById("dp-card"), "the card never mounts outside the dashboard");
  other.close();
  w.AriseDayPlan.unmount();
  ok(!w.document.getElementById("dp-card"), "unmount removes the card");
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot();
  const html = read("index.html");
  const css = read("styles/day-plan.css");
  const keys = read("src/storage-keys.js");
  const schema = read("src/cloud/storage-schema.js");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/day-plan.css"'), "the stylesheet is linked from index.html");
  ok(html.includes("'./src/day-plan.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(html.indexOf("./src/analytics-integrity.js") < html.indexOf("./src/day-plan.js"), "it loads after the analytics maths it reuses");
  ok(keys.includes("arise-day-plan-v1") && schema.includes("arise-day-plan-v1"), "the UI key is documented and allow-listed for sync");
  ok(keys.includes("arise-daily-learning-tasks-v1"), "the store it composes is documented too");
  ok(sw.includes("./src/day-plan.js") && sw.includes("./styles/day-plan.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicate entries");
  ok(/prefers-reduced-motion/.test(css) && /@media \(max-width: 680px\)/.test(css), "reduced motion and small screens are handled");
  ok(!/\.glass-card\s*\{/.test(css) && !/#arise-main/.test(css), "the stylesheet cannot restyle the dashboard");
  ok(!/localStorage\.setItem\(\s*TASK_KEY/.test(read("src/day-plan.js")), "the module never writes the task store");
  w.close();
}

console.log("\nDay plan: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
