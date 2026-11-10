/**
 * tests/test-progress-overview.cjs
 * ---------------------------------------------------------------------------
 * Contribution 10 — progress overview (src/progress-overview.js).
 *
 * Seven widgets each own one area of progress and each defaults to demo data
 * when its store is empty, so an untouched account looks populated and nobody
 * can see the seven numbers side by side.
 *
 * The overview must:
 *   1. report one row per area, computed from the real store only;
 *   2. never count a widget's sample subjects/semesters as user data;
 *   3. exclude empty areas from the average instead of scoring them zero;
 *   4. stay read-only and survive corrupt stores;
 *   5. mount only on the Achievements route.
 *
 * Run: node tests/test-progress-overview.cjs
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

const NOW = new Date(2026, 10, 10, 9, 0, 0);
const iso = (dayOffset, hour) => new Date(2026, 10, 10 + dayOffset, hour || 10, 0).toISOString();

const SEED = {
  "arise-attendance-tracker-v1": { version: 1, threshold: 75, subjects: [
    { id: "a", name: "DBMS", attended: 8, total: 20 },
    { id: "b", name: "OS", attended: 18, total: 20 }
  ] },
  "arise-cgpa-tracker-v1": { version: 2, semesters: [
    { id: "s1", name: "Sem 1", subjects: [
      { id: "x", name: "Maths", credits: 4, grade: "A" },
      { id: "y", name: "Programming", credits: 4, grade: "A+" },
      { id: "z", name: "Ungraded", credits: 4, grade: "" }
    ] }
  ], target: { cgpa: 8.5 } },
  "arise-skills-timeline-v1": { version: 1, skills: [
    { id: "s1", name: "Java", progress: 60 },
    { id: "s2", name: "SQL", progress: 80 },
    { id: "s3", name: "Broken", progress: "lots" }
  ] },
  dsaQuestions: [
    { id: "q1", solved: true, difficulty: "Easy" },
    { id: "q2", solved: false, difficulty: "Medium" },
    { id: "q3", solved: true, difficulty: "Hard" }
  ],
  focusSessionsV2: [
    { id: "f1", category: "DSA", minutes: 60, startedAt: iso(0) },
    { id: "f2", category: "Dev", minutes: 30, startedAt: iso(-1) },
    { id: "f3", category: "Dev", minutes: 45, startedAt: iso(-30) }
  ],
  projects: [
    { id: "p1", name: "Arise", status: "completed" },
    { id: "p2", name: "Draft", status: "in-progress" }
  ],
  arise_certificates_v1: { certificates: [
    { id: "c1", title: "Cloud", verificationId: "V-1" },
    { id: "c2", title: "DSA" }
  ] },
  "arise-cp-tracker-v1": { version: 1, platforms: [{ id: "p", name: "Codeforces", handle: "someone" }], problems: [
    { id: "pr1", status: "solved" }, { id: "pr2", status: "todo" }
  ] }
};

function boot(storage, body) {
  const html = body == null
    ? '<div id="arise-main"><header><h1>Achievements</h1></header><div class="space-y-6"><section id="existing">existing</section></div></div>'
    : body;
  const dom = new JSDOM("<!doctype html><html><body>" + html + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  for (const [k, value] of Object.entries(storage || {})) {
    w.localStorage.setItem(k, typeof value === "string" ? value : JSON.stringify(value));
  }
  w.eval(read("src/progress-overview.js"));
  w.MutationObserver = w.MutationObserver || function () { return { observe() {} }; };
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const empty = w.AriseProgress.overview({ now: NOW });
  ok(empty.areas.length === 8, "one row per area: " + empty.areas.length);
  ok(empty.covered === 0 && empty.completeness === 0, "an untouched account has no data: " + empty.covered);
  ok(empty.average === null, "nothing is averaged when nothing is logged");
  ok(empty.missing.length === 8, "every area is reported as missing");
  ok(empty.areas.every((area) => area.hasData === false), "an empty area claims no data");
  const attendance = empty.areas.find((area) => area.id === "attendance");
  ok(attendance.display === "—" && /sample/i.test(attendance.detail),
    "the attendance widget's demo subjects are not counted: " + attendance.detail);
  const cgpa = empty.areas.find((area) => area.id === "cgpa");
  ok(cgpa.display === "—", "the CGPA widget's demo semesters are not counted");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot(SEED);
  const state = w.AriseProgress.overview({ now: NOW });
  const byId = Object.fromEntries(state.areas.map((area) => [area.id, area]));

  ok(byId.attendance.value === 65, "attendance is totals-based, not per-subject rounded: " + byId.attendance.value);
  ok(byId.attendance.risky.length === 1 && byId.attendance.risky[0].name === "DBMS",
    "subjects below the threshold are named: " + JSON.stringify(byId.attendance.risky));
  ok(byId.cgpa.value === 8.5, "CGPA is credit-weighted and ignores ungraded subjects: " + byId.cgpa.value);
  ok(byId.cgpa.detail.includes("2 graded subjects"), "the CGPA detail says how many subjects were graded");
  ok(byId.skills.value === 70, "skills average only numeric progress: " + byId.skills.value);
  ok(byId.dsa.display === "2/3", "DSA shows solved of total: " + byId.dsa.display);
  ok(byId.dsa.detail === "Easy 1/1 · Medium 0/1 · Hard 1/1", "DSA breaks down by difficulty: " + byId.dsa.detail);
  ok(byId.projects.display === "1/2", "only completed projects count as shipped: " + byId.projects.display);
  ok(byId.certificates.value === 2 && byId.certificates.unit === "1 verified",
    "certificates separate saved from verified: " + byId.certificates.unit);
  ok(byId.cp.value === 1 && /1 connected profile/.test(byId.cp.detail), "competitive coding counts logged problems and real handles");
  ok(byId.study.value === 90, "study time counts only the last seven local days: " + byId.study.value);
  ok(byId.study.detail.includes("2 active days"), "study reports active days: " + byId.study.detail);

  ok(state.covered === 8, "every seeded area counts as data: " + state.covered);
  ok(state.average !== null && state.average > 0, "the average is computed from populated areas: " + state.average);

  // The average must not be dragged down by empty areas.
  const partial = boot({ dsaQuestions: SEED.dsaQuestions });
  const half = partial.AriseProgress.overview({ now: NOW });
  ok(half.covered === 1 && half.average === 67, "empty areas are excluded, not scored zero: " + half.average);
  ok(half.missing.includes("cgpa") && !half.missing.includes("dsa"), "missing lists only the empty areas");
  partial.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot(SEED);
  const doc = w.document;
  const card = doc.getElementById("po-card");
  ok(!!card, "the overview mounts on the Achievements route");
  ok(card.parentElement.classList.contains("space-y-6"), "it joins the route stack");
  ok(!!doc.getElementById("existing"), "existing cards are untouched");
  ok(card.querySelectorAll(".po-row").length === 8, "eight rows render");
  ok(card.querySelectorAll('.po-row[data-has-data="true"]').length === 8, "rows carry their data state");
  ok(card.querySelector(".po-completeness").textContent === "8/8", "the header reports coverage: " + card.querySelector(".po-completeness").textContent);
  ok(/Average of the 8 areas/.test(card.querySelector(".po-note").textContent), "the note explains what is averaged");
  ok(card.querySelector('[data-area="attendance"] .po-bar-fill').style.getPropertyValue("--po-w") === "65%",
    "the bar reflects the real percentage");
  w.AriseProgress.mount();
  w.AriseProgress.mount();
  ok(doc.querySelectorAll("#po-card").length === 1, "repeat mounts keep a single card");

  const mobile = boot(SEED, '<div id="arise-main"><header><h1>Achievements</h1></header><div class="space-y-5"></div></div>');
  ok(!!mobile.document.getElementById("po-card"), "the card follows the route's own stack class");
  mobile.close();

  const dashboard = boot(SEED, '<div id="arise-main"><header><h1>Dashboard</h1></header><div class="space-y-6"></div></div>');
  ok(!dashboard.document.getElementById("po-card"), "it never mounts on unrelated routes");
  dashboard.close();

  w.AriseProgress.unmount();
  ok(!doc.getElementById("po-card"), "unmount removes the card");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot({
    "arise-attendance-tracker-v1": "broken",
    "arise-cgpa-tracker-v1": { semesters: "nope" },
    "arise-skills-timeline-v1": 42,
    dsaQuestions: { not: "an array" },
    focusSessionsV2: [{ minutes: "lots" }],
    projects: null,
    arise_certificates_v1: { certificates: "nope" }
  });
  const state = w.AriseProgress.overview({ now: NOW });
  ok(state.areas.every((area) => typeof area.hasData === "boolean"), "corrupt stores never throw");
  ok(state.covered === 0, "corrupt stores report no data rather than fake numbers: " + state.covered);
  ok(w.AriseProgress.area("cgpa").display === "—", "area() works on a single id");
  ok(state.sources.length === 8, "every row names its source store");
  const source = read("src/progress-overview.js");
  ok(!/localStorage\.setItem|removeItem|clear\(/.test(source), "the overview never writes to storage");
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot(SEED);
  const html = read("index.html");
  const css = read("styles/progress-overview.css");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/progress-overview.css"'), "the stylesheet is linked");
  ok(html.includes("'./src/progress-overview.js'"), "the module is in the ordered SCRIPTS list");
  ok(sw.includes("./src/progress-overview.js") && sw.includes("./styles/progress-overview.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");
  ok(/prefers-reduced-motion/.test(css) && /@media \(max-width: 680px\)/.test(css), "reduced motion and small screens are handled");
  ok(!/\.glass-card\s*\{/.test(css), "the stylesheet cannot restyle existing cards");
  ok(typeof w.AriseProgress.overview === "function" && typeof w.AriseProgress.mount === "function", "the public API is complete");
  w.close();
}

console.log("\nProgress overview: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
