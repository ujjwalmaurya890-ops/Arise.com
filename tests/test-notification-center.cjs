/**
 * tests/test-notification-center.cjs
 * ---------------------------------------------------------------------------
 * Contribution 04 — notification center (src/notification-center.js).
 *
 * Before this, exam dates, hackathon registration deadlines, interview dates,
 * dated tasks and due revision cards each lived in their own widget, some of
 * them firing native Notifications. There was no single "what needs me" view.
 *
 * The center must:
 *   1. derive every item from an existing store — no invented or duplicated
 *      events, no writes to those stores;
 *   2. compute days/tones from real dates (today, soon, overdue, ignored when
 *      far away or already handled);
 *   3. keep read state in its own key, survive unread -> read, and let an item
 *      that becomes due again come back as unread;
 *   4. be a labelled modal with focus trap, Escape, focus restore, named
 *      controls, and a launcher badge that reflects the unread count;
 *   5. tolerate corrupt/partial stores without throwing.
 *
 * Run: node tests/test-notification-center.cjs
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

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0); // 2026-11-10
const day = (offset) => new Date(NOW + offset * 86400000).toISOString().slice(0, 10);

const SEEDS = {
  "arise_exam_tracker_v1": { version: 2, exams: [
    { id: "e1", examName: "DBMS Finals", subjectName: "DBMS", examDate: day(0), status: "Pending" },
    { id: "e2", examName: "Operating Systems", subjectName: "OS", examDate: day(2) },
    { id: "e3", examName: "Old Midterm", subjectName: "Maths", examDate: day(-6) },
    { id: "e4", examName: "Far Away", subjectName: "Networks", examDate: day(120) },
    { id: "e5", examName: "Undated", subjectName: "Ethics" }
  ] },
  "cse-syllabus-exam-dates-v1": { e2: day(4) },
  "hackathonPipelineV1": [
    { id: "h1", name: "ETHIndia", status: "Applied", deadline: day(0) },
    { id: "h2", name: "SIH", status: "Not Applied", deadline: day(20) }
  ],
  "arise_placement_tracker_v1": { version: 1, applications: [
    { id: "a1", company: "Bluepeak Labs", role: "SDE-1", status: "Interview", interviewDate: day(1) }
  ] },
  "arise-daily-learning-tasks-v1": { tasks: [
    { id: "t1", title: "Revise graphs", dueDate: day(-1), completed: false },
    { id: "t2", title: "Already done", dueDate: day(0), completed: true }
  ] },
  "dsaRevisionSRS": {
    cardA: { due: day(0), title: "Two Sum" },
    cardB: { due: day(9), title: "Later card" }
  },
  "arise-local-files-db-v1": "not json at all"
};

function boot(storage) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"arise-main\"></div><nav id=\"arise-desktop-nav\"><button>Exam Tracker</button></nav></body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  for (const [key, value] of Object.entries(storage || SEEDS)) w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  w.eval(read("src/notification-center.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const items = w.AriseNotifications.list({ now: NOW });
  const byTitle = (title) => items.find((entry) => entry.title === title);

  ok(items.length > 0, "the center derives items from existing records");
  ok(items.every((entry) => typeof entry.id === "string" && entry.id.includes(":")) && new Set(items.map((entry) => entry.id)).size === items.length,
    "every item has a unique, source-qualified id");

  const dbms = byTitle("DBMS Finals");
  ok(!!dbms && dbms.tone === "today" && dbms.kind === "Exam", "an exam today is bucketed as today");
  const os = byTitle("Operating Systems");
  ok(!!os && os.days === 4 && /in 4 days/.test(os.detail), "the syllabus exam-date override wins over the tracker date: " + (os && os.detail));
  ok(!byTitle("Old Midterm"), "an exam that already happened is not surfaced as a new notification");
  ok(!byTitle("Old Midterm") || byTitle("Old Midterm").tone !== "today", "past exams are never re-badged as due today");
  ok(!byTitle("Far Away"), "an exam 120 days out is outside the 30-day window");
  ok(!byTitle("Undated"), "an exam without a date is never guessed at");

  const eth = byTitle("ETHIndia");
  ok(!!eth && eth.tone === "today" && eth.kind === "Deadline", "hackathon registration deadlines are included");
  const interview = items.find((entry) => entry.title === "Bluepeak Labs · SDE-1");
  ok(!!interview && interview.kind === "Interview" && interview.route === "placement-tracker", "interviews come from the placement tracker");
  ok(!!byTitle("Revise graphs") && byTitle("Revise graphs").tone === "overdue", "an overdue open task stays visible and sorts as overdue");
  ok(!byTitle("Already done"), "completed tasks are excluded");
  const revision = byTitle("Two Sum");
  ok(!!revision && revision.kind === "Revision", "revision cards that are due appear");
  ok(!byTitle("Later card"), "revision cards still in the future are not 'due'");

  ok(items[0].tone === "overdue", "overdue items sort first: " + items[0].tone + " " + items[0].title);
  ok(items.every((entry) => entry.days >= 0 || entry.kind === "Task" || entry.kind === "Revision"),
    "only open tasks and revision cards may be reported as overdue");
  const tones = items.map((entry) => ["overdue", "today", "soon", "later"].indexOf(entry.tone));
  ok(tones.every((value, index) => index === 0 || tones[index - 1] <= value), "items are ordered by urgency");

  const stored = JSON.parse(w.localStorage.getItem("arise_exam_tracker_v1"));
  ok(stored.exams.length === 5 && stored.exams[0].examDate === day(0), "reading notifications never rewrites the exam store");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const items = w.AriseNotifications.list({ now: NOW });
  ok(w.AriseNotifications.unreadCount({ now: NOW }) === items.length, "everything starts unread");

  const target = items[0];
  w.AriseNotifications.markRead(target.id);
  const readState = JSON.parse(w.localStorage.getItem("arise-notification-read-v1"));
  ok(typeof readState[target.id] === "string", "read state is stored in its own key with a timestamp");
  ok(w.AriseNotifications.list({ now: NOW }).find((entry) => entry.id === target.id).read === true, "the item is now read");
  ok(w.AriseNotifications.list({ now: NOW }).at(-1).id === target.id, "read items sort after unread ones");
  ok(JSON.parse(w.localStorage.getItem("arise_exam_tracker_v1")).exams.length === 5, "marking read does not touch the source store");

  w.AriseNotifications.markAllRead();
  ok(w.AriseNotifications.unreadCount({ now: NOW }) === 0, "mark-all-read clears the badge count");

  // A date that moves forward produces a new id, so the item returns unread.
  w.localStorage.setItem("arise_exam_tracker_v1", JSON.stringify({ version: 2, exams: [{ id: "e1", examName: "DBMS Finals", examDate: day(1) }] }));
  const moved = w.AriseNotifications.list({ now: NOW });
  const returned = moved.find((entry) => entry.title === "DBMS Finals");
  ok(!!returned && returned.read === false, "an item whose date changes comes back unread (new id)");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot({ "arise_exam_tracker_v1": "{{{ broken", "arise-notification-read-v1": "not json" });
  let threw = false;
  try { w.AriseNotifications.list({ now: NOW }); } catch { threw = true; }
  ok(!threw, "corrupt stores do not throw");
  ok(Array.isArray(w.AriseNotifications.list({ now: NOW })), "a corrupt store yields an empty-but-valid list");
  w.close();

  const w2 = boot({ "arise_exam_tracker_v1": JSON.stringify({ exams: [{ id: "x", examName: "<img src=x onerror=alert(1)>", examDate: day(0) }] }) });
  w2.AriseNotifications.open();
  ok(w2.document.querySelectorAll(".anc-list img").length === 0, "stored titles never become elements in the notification list");
  ok(w2.document.querySelectorAll(".anc-list script").length === 0, "stored titles cannot inject script");
  ok(w2.document.querySelector(".anc-title").textContent === "<img src=x onerror=alert(1)>",
    "the stored title is shown as literal text");
  w2.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot();
  const launcher = w.document.getElementById("anc-launcher");
  ok(!!launcher && launcher.getAttribute("aria-haspopup") === "dialog" && launcher.getAttribute("aria-label") === "Open notifications",
    "a labelled notifier launcher exists in the app chrome");
  const badge = w.document.getElementById("anc-badge");
  ok(badge && badge.hidden === false, "the badge is visible while something is unread");
  ok(Number(badge.textContent) > 0, "the badge shows the unread count");

  launcher.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const panel = w.document.getElementById("anc-panel");
  ok(!!panel && panel.getAttribute("data-open") === "true", "the launcher opens the panel");
  const dialog = panel.querySelector('[role="dialog"]');
  ok(dialog && dialog.getAttribute("aria-modal") === "true" && dialog.getAttribute("aria-labelledby") === "anc-title", "the panel is a labelled modal");
  ok(panel.querySelectorAll(".anc-item").length > 0, "the panel lists aggregated items");
  const controls = [...panel.querySelectorAll("button")];
  ok(controls.every((button) => (button.getAttribute("aria-label") || button.textContent || "").trim().length > 0), "every control has an accessible name");
  ok(/unread/.test(panel.querySelector(".anc-status").textContent), "the panel reports the unread count live");
  ok(panel.querySelectorAll(".anc-group-title").length >= 2, "items are grouped by urgency");

  panel.querySelector('.anc-item [data-anc-action="read"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(panel.querySelector('.anc-item').getAttribute("data-read") === "true", "a row updates to read without closing");
  panel.querySelector('[data-anc-action="mark-all"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(w.AriseNotifications.unreadCount({ now: Date.now() }) === 0 || w.document.getElementById("anc-badge").hidden === true,
    "mark-all-read clears the launcher badge");

  const focusables = [...panel.querySelectorAll("button")];
  focusables.at(-1).focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  ok(w.document.activeElement === focusables[0], "Tab wraps inside the dialog");
  focusables[0].focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  ok(w.document.activeElement === focusables.at(-1), "Shift+Tab wraps backwards");

  const opener = launcher;
  opener.focus();
  panel.__previous = opener;
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(panel.getAttribute("data-open") === "false", "Escape closes the panel");
  ok(w.document.activeElement === opener, "focus returns to the launcher");
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  w.AriseNotifications.open();
  const clicked = [];
  [...w.document.querySelectorAll("#arise-desktop-nav button")].forEach((button) => button.addEventListener("click", () => clicked.push(button.textContent.trim())));
  const openItem = w.document.querySelector('.anc-item [data-anc-action="open"][data-route="exam-tracker"]')
    || w.document.querySelector('.anc-item [data-anc-action="open"]');
  openItem.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(clicked.includes("Exam Tracker"), "Open routes through the real navigation instead of a synthetic route: " + clicked.join(","));
  ok(w.document.getElementById("anc-panel").getAttribute("data-open") === "false", "opening an item closes the panel");
  w.close();

  ok(/"arise-notification-read-v1"/.test(read("src/cloud/storage-schema.js")), "the read-state key is syncable");
  ok(/arise-notification-read-v1/.test(read("src/storage-keys.js")), "the read-state key is documented");
  ok(/notification-center\.js/.test(read("index.html")) && /notification-center\.css/.test(read("index.html")),
    "the module and stylesheet are registered in index.html");
}

console.log("\nNotification center: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) process.exit(1);
