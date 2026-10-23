// Browser verification of the Exam Tracker upgrade against the real
// production (minified) build, driven through system Edge headless.
// Usage: node _browser-verify.cjs
const puppeteer = require("puppeteer-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:8123/";
const today = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

let pass = 0, fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ok  " + msg); }
  else { fail++; failures.push(msg); console.log("  FAIL " + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--no-first-run", "--disable-extensions", "--window-size=1400,1000"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 250)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 250)));

  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1500);

  // Enter the dashboard (skip the intro screen if present)
  const entered = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").includes("Enter Dashboard"));
    if (b) { b.click(); return true; }
    return false;
  });
  await sleep(2000);
  console.log("intro skipped:", entered);

  // ---- localStorage seeding: simulate an EXISTING v1 user (migration check) ----
  await page.evaluate((key) => {
    const v1 = {
      version: 1,
      settings: { activeTab: "dashboard" },
      exams: [{
        id: "legacy1", examName: "DBMS Legacy", subjectName: "Database Systems", examType: "End Sem",
        examDate: TODAY_PLUS_4, priority: "High", targetPercentage: 80, cieObtained: 41,
        pinned: false, completed: false,
        topics: [
          { id: "lt1", title: "Normalization", status: "Not Started", difficulty: "Hard", confidence: 1 },
          { id: "lt2", title: "Transactions", status: "In Progress", difficulty: "Hard", confidence: 2 },
          { id: "lt3", title: "ER Model", status: "Completed", difficulty: "Easy", confidence: 5 }
        ]
      }]
    }.replace ? null : null;
    return true;
  }, "arise_exam_tracker_v1").catch(() => {});

  // (Do the seeding properly with the helper inlined.)
  await page.evaluate((key, futureDate) => {
    const v1 = {
      version: 1,
      settings: { activeTab: "dashboard" },
      exams: [{
        id: "legacy1", examName: "DBMS Legacy", subjectName: "Database Systems", examType: "End Sem",
        examDate: futureDate, priority: "High", targetPercentage: 80, cieObtained: 41,
        pinned: false, completed: false,
        topics: [
          { id: "lt1", title: "Normalization", status: "Not Started", difficulty: "Hard", confidence: 1 },
          { id: "lt2", title: "Transactions", status: "In Progress", difficulty: "Hard", confidence: 2 },
          { id: "lt3", title: "ER Model", status: "Completed", difficulty: "Easy", confidence: 5 }
        ]
      }]
    };
    localStorage.setItem(key, JSON.stringify(v1));
  }, "arise_exam_tracker_v1", today(4));

  // ---- Navigate to the Exam Tracker section through the sidebar ----
  const navOk = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((x) => (x.textContent || "").trim() === "📋");
    if (b) { b.click(); return true; }
    return false;
  });
  await sleep(2500);
  assert(navOk, "sidebar Exam Tracker nav clicked");

  const widget = await page.evaluate(() => ({
    etRoot: !!document.querySelector(".et-root"),
    activeTab: (document.querySelector(".et-tab[data-active=\"true\"]") || { getAttribute: () => null }).getAttribute("data-tab"),
    heroRiskLine: /Most at risk:/.test(document.body.innerText) && /— (High|Critical|Medium|Safe) · \d+d · \d+% prepared/.test(document.body.innerText.replace(/\n/g, " ")),
    heroRiskText: (document.body.innerText.replace(/\n/g, " ").match(/Most at risk:[\s\S]{0,60}?—[^|]*?(?= \+ Add Exam|$)/) || [""])[0].slice(0, 80),
    planBlocks: document.querySelectorAll(".et-plan-block").length,
    hoursInput: !!document.querySelector("[data-study-hours]"),
    weakCard: /Weak Topics/.test(document.body.innerText),
    weakTopic: (document.querySelector(".et-rec strong") || { textContent: null }).textContent
  }));
  assert(widget.etRoot, "Exam Tracker widget mounted in the React section");
  assert(widget.activeTab === "today", "Today (command center) is the default tab");
  assert(widget.hoursInput, "study-hours input present");
  assert(widget.weakCard, "Weak Topics card present");
  assert(widget.planBlocks >= 1, "Today plan generated blocks (" + widget.planBlocks + ")");
  assert(widget.heroRiskLine, "hero shows most-at-risk line: " + widget.heroRiskText.trim());
  assert(!!widget.weakTopic, "weak topic ranked first: " + widget.weakTopic);

  // ---- Set study hours, expect allocation + overload behavior ----
  await page.evaluate(() => {
    const input = document.querySelector("[data-study-hours]");
    input.value = "0.5";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(800);
  const loadState = await page.evaluate(() => ({
    saved: (JSON.parse(localStorage.getItem("arise_exam_tracker_v1")).settings.dailyStudyHours),
    overload: /exceeds available study time/.test(document.body.innerText),
    allocRows: document.querySelectorAll(".et-alloc-row").length
  }));
  assert(loadState.saved === 0.5, "study-hours preference persisted (0.5h)");
  assert(loadState.overload, "overload message shown for tight budget");
  assert(loadState.allocRows >= 1, "allocation rows rendered");

  // ---- Check a plan block; verify persistence ----
  const blockId = await page.evaluate(() => {
    const box = document.querySelector("[data-plan-block]");
    if (!box) return null;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return box.getAttribute("data-plan-block");
  });
  await sleep(600);
  const blockState = await page.evaluate((id) => {
    const store = JSON.parse(localStorage.getItem("arise_exam_tracker_v1"));
    const today = new Date().toISOString().slice(0, 10);
    return { done: !!(store.settings.planDone && store.settings.planDone.blocks[id]), planned: !!(store.settings.planDone && Array.isArray(store.settings.planDone.plannedIds)) };
  }, blockId);
  assert(blockState.done, "plan block marked done persisted");
  assert(blockState.planned, "planned block ids recorded");

  // ---- Upcoming tab: risk badge on the exam card (text, not color-only) ----
  await page.evaluate(() => {
    const b = document.querySelector('[data-tab="upcoming"]');
    if (b) b.click();
  });
  await sleep(600);
  const cardBadge = await page.evaluate(() => {
    const card = document.querySelector(".et-exam-card");
    const badge = card ? card.querySelector(".et-badge[data-risk]") : null;
    return { badge: badge ? badge.textContent.trim() : null, sortValue: (document.querySelector("[data-sort]") || { value: null }).value };
  });
  assert(/Critical|High|Medium|Safe/.test(cardBadge.badge || "") && /prepared/.test(cardBadge.badge || ""), "exam card risk badge is text-based: " + cardBadge.badge);
  assert(cardBadge.sortValue === "risk", "Risk is the default sort");

  // ---- Open detail modal from the card's Details button ----
  await page.evaluate(() => {
    const b = document.querySelector(".et-exam-card [data-detail]");
    if (b) b.click();
  });
  await sleep(800);
  const modal = await page.evaluate(() => {
    const m = document.querySelector(".et-modal");
    return {
      open: !!m,
      coverage: !!document.querySelector(".et-coverage") && /covered/i.test(m ? m.innerText : ""),
      targetSim: /Target Simulator/.test(m ? m.innerText : ""),
      assumptions: /Assumptions/.test(m ? m.innerText : ""),
      pyqBtns: m ? m.querySelectorAll("[data-pyq-toggle]").length : 0,
      vtuintegration: /SEE/.test(m ? m.innerText : "")
    };
  });
  assert(modal.open, "detail modal opened");
  assert(modal.coverage, "coverage summary visible");
  assert(modal.targetSim, "target simulator visible");
  assert(modal.assumptions, "assumptions disclosed");
  assert(modal.pyqBtns >= 1, "PYQ toggles present per topic (" + modal.pyqBtns + ")");
  assert(modal.vtuintegration, "VTU SEE requirement surfaced in simulator");

  // ---- Log PYQ data through the UI ----
  await page.evaluate(() => {
    const btn = document.querySelector('[data-pyq-toggle="lt1"]');
    if (btn) btn.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const input = document.querySelector('[data-pyq-field="pyqAttempted"][data-topic-id="lt1"]');
    input.value = "12";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(600);
  const pyqState = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("arise_exam_tracker_v1"));
    const t = store.exams.find((e) => e.id === "legacy1").topics.find((x) => x.id === "lt1");
    return { attempted: t.pyqAttempted, last: !!t.lastPracticedAt, panelStillOpen: (() => { const p = document.querySelector('[data-pyq-fields="lt1"]'); return p && !p.hidden; })(), readiness: /PYQ readiness/.test(document.querySelector(".et-modal").innerText) };
  });
  assert(pyqState.attempted === 12, "PYQ attempted saved via UI");
  assert(pyqState.last, "lastPracticedAt stamped");
  assert(pyqState.panelStillOpen, "PYQ panel stays open after save");
  assert(pyqState.readiness, "PYQ readiness line visible after logging");

  // ---- Other tabs still render (regression check) ----
  await page.evaluate(() => {
    const close = document.querySelector(".et-modal [data-close], [data-detail-backdrop]");
    if (close) close.click();
  });
  await sleep(500);
  const tabsCheck = await page.evaluate(() => {
    const out = {};
    const click = (id) => {
      const b = document.querySelector('[data-tab="' + id + '"]');
      if (b) b.click();
    };
    click("upcoming"); out.upcomingCards = document.querySelectorAll(".et-exam-card").length;
    click("calendar"); out.calendar = !!document.querySelector(".et-calendar-grid");
    click("subjects"); out.subjects = /Database Systems/.test(document.body.innerText);
    click("vtu"); out.vtu = /VTU/.test(document.body.innerText);
    click("planner"); out.planner = /Revision Planner|pending/.test(document.body.innerText) || document.querySelectorAll(".et-plan-row").length >= 0;
    return out;
  });
  await sleep(600);
  assert(tabsCheck.upcomingCards >= 1, "Upcoming tab renders exam cards");
  assert(tabsCheck.calendar, "Calendar tab renders");
  assert(tabsCheck.subjects, "By Subject tab renders");
  assert(tabsCheck.vtu, "VTU tab renders");

  // ---- Analytics companion + data tools ----
  const companion = await page.evaluate(() => ({
    analytics: /Score & Performance Analytics|Data Tools/.test(document.body.innerText),
    etaRoot: !!document.querySelector(".eta-root")
  }));
  assert(companion.etaRoot, "analytics companion panel mounted");

  // ---- Console errors ----
  assert(consoleErrors.length === 0, "no console/page errors (" + consoleErrors.length + ")");
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 10));

  // ---- Mobile viewport smoke ----
  await page.evaluate(() => {
    const b = document.querySelector('[data-tab="today"]');
    if (b) b.click();
  });
  await page.setViewport({ width: 390, height: 844 });
  await sleep(700);
  const mobile = await page.evaluate(() => ({
    noHScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    todayGrid: !!document.querySelector(".et-today-grid"),
    planVisible: /Today's Plan/.test(document.body.innerText)
  }));
  assert(mobile.noHScroll, "no horizontal overflow at 390px");
  assert(mobile.todayGrid, "Today grid present on mobile");
  assert(mobile.planVisible, "plan card visible on mobile");

  console.log("\nBrowser verification: " + pass + " passed, " + fail + " failed");
  if (failures.length) failures.forEach((f) => console.log("  - " + f));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(2); });
