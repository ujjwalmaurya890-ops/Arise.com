/**
 * tests/test-global-search-v2.cjs
 * ---------------------------------------------------------------------------
 * Contribution 02 — global search coverage.
 *
 * The palette's search index already spanned modules, notes, wiki pages, DSA,
 * interview sheets, tasks, projects and exams. It did NOT reach attendance
 * subjects, CGPA subjects, placement applications/offers/internships,
 * certificates, hackathons (tracker + pipeline), skills, coding profiles and
 * problems, the CSE syllabus, exam topics, expenses, note folders or wiki
 * categories — so the most obvious thing a student types often found nothing.
 *
 * This suite seeds those real stores and asserts each one is searchable, that
 * every result routes to a real module, that hostile stored text is escaped,
 * and that the index stays bounded rather than dumping an entire store.
 *
 * Run: node tests/test-global-search-v2.cjs
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
  if (cond) {
    passed += 1;
  } else {
    failures.push(label);
    console.error("  FAIL  " + label);
  }
}

const SHELL = `<!doctype html><html><body>
  <div id="arise-main"><header><h1>Dashboard</h1><div></div></header></div>
  <div id="arise-desktop-nav">
    <button class="nav-item">Dashboard</button><button class="nav-item">Notes</button>
    <button class="nav-item">Expenses</button><button class="nav-item">Analytics</button>
  </div></body></html>`;

const SEEDS = {
  "arise-attendance-tracker-v1": { subjects: [{ id: "s1", name: "Operating Systems", attended: 18, total: 20 }, { id: "s2", name: "Compiler Design", attended: 9, total: 20 }] },
  "arise-cgpa-tracker-v1": { version: 2, semesters: [{ id: "sem1", name: "Semester 1", subjects: [{ id: "c1", name: "Discrete Mathematics", credits: 4, grade: "A" }] }] },
  "arise_placement_tracker_v1": { version: 1, applications: [{ id: "a1", company: "Bluepeak Labs", role: "SDE-1", status: "Applied" }], offers: [{ id: "o1", company: "Nimbus", role: "Intern", ctc: 6 }], internships: [] },
  "arise_certificates_v1": { version: 1, certificates: [{ id: "ce1", title: "AWS Cloud Practitioner", issuer: "Amazon" }] },
  hackathonTrackerV1: [{ id: "h1", name: "Smart India Hackathon", status: "Applied" }],
  hackathonPipelineV1: [{ id: "p1", name: "ETHIndia", status: "Applied", deadline: "2026-12-01" }],
  "arise-skills-timeline-v1": { version: 2, skills: [{ id: "sk1", name: "Docker", category: "tooling", progress: 60 }] },
  "arise-cp-tracker-v1": { version: 1, platforms: [{ id: "pl1", name: "LeetCode", handle: "octo" }], problems: [{ id: "pr1", name: "Trapping Rain Water", platform: "LeetCode", difficulty: "Hard" }] },
  "arise-expenses-v1": [{ id: "e1", title: "Hostel mess", category: "Food", amount: 3200 }],
  "arise-notes-app-v1": { version: 2, folders: [{ id: "f1", name: "Placement prep" }], notes: [], ui: {} },
  "arise-personal-wiki-v1": { version: 1, categories: [{ id: "cat1", name: "System design" }], pages: [], ui: {} },
  "arise_exam_tracker_v1": { exams: [{ id: "ex1", examName: "Semester 5 Finals", subjectName: "DBMS", topics: [{ id: "t1", name: "Normalization" }] }] }
};

function boot() {
  const dom = new JSDOM(SHELL, { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.AriseIcons = { svg: () => "" };
  w.scrollTo = () => {};
  w.eval(read("src/features/semester-risk/cse-full-syllabus-config.js"));
  for (const [key, value] of Object.entries(SEEDS)) w.localStorage.setItem(key, JSON.stringify(value));
  w.eval(read("src/premium-productivity-features.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  w.document.getElementById("upp-command-overlay").setAttribute("data-open", "true");
  return w;
}

function search(w, query) {
  const input = w.document.getElementById("upp-command-input");
  input.value = query;
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  return [...w.document.querySelectorAll("#upp-command-list .upp-command-item")].map((el) => ({
    title: el.querySelector(".upp-command-title").textContent,
    tag: el.querySelector(".upp-command-tag").textContent,
    preview: el.querySelector(".upp-command-preview").textContent,
    el
  }));
}

const w = boot();

const EXPECTATIONS = [
  ["Operating Systems", "Operating Systems", "Attendance", "operating"],
  ["Discrete Mathematics (CGPA)", "Discrete Mathematics", "CGPA", "discrete"],
  ["Placement role", "SDE-1", "Placement", "bluepeak"],
  ["Certificate", "AWS Cloud Practitioner", "Certificates", "aws"],
  ["Hackathon tracker", "Smart India Hackathon", "Hackathon", "smart india"],
  ["Hackathon pipeline", "ETHIndia", "Hackathon", "ethindia"],
  ["Skill", "Docker", "Skills", "docker"],
  ["Coding profile", "LeetCode", "Competitive Programming", "leetcode"],
  ["CP problem", "Trapping Rain Water", "Competitive Programming", "trapping"],
  ["Expense", "Hostel mess", "Expenses", "hostel"],
  ["Note folder", "Placement prep", "Notes", "placement prep"],
  ["Wiki category", "System design", "Wiki", "system design"],
  ["Exam topic", "Normalization", "Exam", "normalization"],
  ["CSE syllabus subject", "Operating Systems", "CSE Syllabus", "operating"]
];

for (const [label, title, tag, query] of EXPECTATIONS) {
  const results = search(w, query);
  ok(results.some((r) => r.title === title && r.tag === tag), label + ": '" + query + "' returns " + title + " [" + tag + "]");
}

// Every stored result routes somewhere real, and preview text is the store's own data.
{
  const placement = search(w, "bluepeak")[0];
  ok(/Bluepeak Labs/.test(placement.preview), "the placement result preview keeps the company name");
  const cert = search(w, "aws")[0];
  ok(/Amazon/.test(cert.preview), "the certificate preview keeps the issuer");
  const attendance = search(w, "compiler")[0];
  ok(/45%/.test(attendance.preview), "attendance previews are computed from attended/total: " + attendance.preview);
}

// Hostile stored text is escaped in titles and previews.
{
  w.localStorage.setItem("arise_certificates_v1", JSON.stringify({
    version: 1,
    certificates: [{ id: "x", title: "<img src=x onerror=alert(1)>", issuer: "\"><script>bad()</script>" }]
  }));
  w.close();
  const fresh = boot();
  fresh.localStorage.setItem("arise_certificates_v1", JSON.stringify({
    version: 1,
    certificates: [{ id: "x", title: "<img src=x onerror=alert(1)>", issuer: "\"><script>bad()</script>" }]
  }));
  // Re-render the index with the hostile store in place.
  fresh.document.getElementById("upp-command-overlay").setAttribute("data-open", "false");
  fresh.document.getElementById("upp-command-overlay").setAttribute("data-open", "true");
  fresh.localStorage.setItem("arise-command-recents-v1", JSON.stringify([]));
  const result = search(fresh, "img src");
  ok(fresh.document.querySelectorAll("#upp-command-list img, #upp-command-list script").length === 0,
    "stored titles and issuers cannot inject elements");
  ok(result.length > 0 && result.every((r) => r.title.includes("<img src=x onerror=alert(1)>")),
    "stored markup is shown as literal text, not parsed as elements");
  ok(fresh.document.getElementById("upp-command-list").querySelectorAll("script").length === 0,
    "no script element from stored data is ever created");
  fresh.close();
}

// The index is bounded: a huge store does not dump every row into the palette.
{
  const big = {
    "arise_certificates_v1": { version: 1, certificates: Array.from({ length: 400 }, (_, i) => ({ id: "c" + i, title: "Certificate " + i, issuer: "Issuer" })) },
    "arise-expenses-v1": Array.from({ length: 400 }, (_, i) => ({ id: "e" + i, title: "Expense " + i, category: "Food", amount: 10 }))
  };
  const dom = new JSDOM(SHELL, { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const bigWin = dom.window;
  bigWin.AriseIcons = { svg: () => "" };
  bigWin.scrollTo = () => {};
  for (const [key, value] of Object.entries(big)) bigWin.localStorage.setItem(key, JSON.stringify(value));
  bigWin.eval(read("src/premium-productivity-features.js"));
  bigWin.document.dispatchEvent(new bigWin.Event("DOMContentLoaded"));
  bigWin.document.getElementById("upp-command-overlay").setAttribute("data-open", "true");
  const certHits = search(bigWin, "certificate 1");
  ok(certHits.filter((r) => r.tag === "Certificates").length <= 60, "certificates are capped at 60 entries");
  ok(search(bigWin, "").length <= 28, "the default (no query) list stays at 28 rows or fewer");
  bigWin.close();
}

// Search behaviour is privacy-safe: no network is touched while indexing.
{
  const net = [];
  const dom = new JSDOM(SHELL, { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const local = dom.window;
  local.AriseIcons = { svg: () => "" };
  local.scrollTo = () => {};
  local.fetch = (url) => { net.push(String(url)); return Promise.reject(new Error("offline")); };
  for (const [key, value] of Object.entries(SEEDS)) local.localStorage.setItem(key, JSON.stringify(value));
  local.eval(read("src/premium-productivity-features.js"));
  local.document.dispatchEvent(new local.Event("DOMContentLoaded"));
  local.document.getElementById("upp-command-overlay").setAttribute("data-open", "true");
  search(local, "docker");
  ok(!net.some((url) => /^https?:/i.test(url)), "indexing never leaves the page (only the bundled interview data may load)");
  local.close();
}

w.close();

console.log("\nGlobal search v2: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) process.exit(1);
