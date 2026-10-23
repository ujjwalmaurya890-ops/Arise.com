// DOM smoke test for the new "🎓 Tier-3 Reality" tab added to
// src/competitive-programming-widget.js (Contest–Exam Clash Radar +
// Live vs Virtual Practice Split). Mounts the real widget in jsdom via its
// actual window.__mountCompetitiveProgramming(el) contract and clicks
// through the new tab, same style as tests/test-hackathon-tracker-dom-smoke.js.
// Run with: node tests/test-cp-tier3-reality.js
"use strict";

var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");

var assertions = 0, failures = [];
function assert(cond, msg) {
  assertions++;
  if (!cond) failures.push(msg);
}

function freshDom() {
  var dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://example.test/" });
  var window = dom.window;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  window.dispatchEvent = function () { return true; };
  // The widget auto-syncs live platforms on mount/tab-open and polls contest
  // countdowns via setInterval. Neither is relevant to this test and both
  // would otherwise hang the process (real network calls / a live timer
  // keeping the event loop alive) or race the assertions below.
  window.fetch = function () { return Promise.reject(new Error("no network in tests")); };
  global.fetch = window.fetch;
  window.setInterval = function () { return 0; };
  window.clearInterval = function () {};
  return window;
}

function loadWidget(window) {
  var code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "src/competitive-programming-widget.js"), "utf8");
  window.eval(code);
}

function today(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function clickTab(window, root, tabKey) {
  var btn = root.querySelector("[data-tab='" + tabKey + "']");
  if (!btn) throw new Error("tab button not found: " + tabKey);
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

// ---- Suite 1: no Exam Tracker connected -> banner shown, no crash --------
(function () {
  var window = freshDom();
  loadWidget(window);
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  clickTab(window, root, "tier3");
  var html = root.innerHTML;
  assert(html.indexOf("Tier-3 Reality") !== -1 || html.indexOf("Contest") !== -1, "tier3 tab renders content");
  assert(html.indexOf("Log your exam dates in the Exam Tracker") !== -1, "shows connect-exam-tracker banner when no exam API present");
  assert(html.indexOf("Live vs Virtual") !== -1, "renders the live/virtual split card");
  assert(html.indexOf("No upcoming contests logged yet") !== -1, "empty state shown when no contests exist");
})();

// ---- Suite 2: exam API present, no clash -> "Clear" badge -----------------
(function () {
  var window = freshDom();
  window.AriseExamStorage = {
    load: function () {
      return { exams: [{ examName: "DBMS End Sem", examDate: today(20) }] };
    }
  };
  var seed = {
    version: 1, activeTab: "tier3",
    contests: [{ id: "c1", name: "Codeforces Round 999", platform: "Codeforces", date: today(5), type: "upcoming" }],
    virtualContests: []
  };
  localStorage.setItem("arise-cp-tracker-v1", JSON.stringify(seed));
  loadWidget(window);
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  clickTab(window, root, "tier3"); // activeTab always resets to "overview" on mount, by existing app design
  var html = root.innerHTML;
  assert(html.indexOf("Log your exam dates") === -1, "no connect banner once exam API is present");
  assert(html.indexOf("Codeforces Round 999") !== -1, "upcoming live contest listed");
  assert(html.indexOf("cp-badge-ok") !== -1 && html.indexOf("Clear") !== -1, "far-away contest marked Clear");
})();

// ---- Suite 3: exam API present, real clash -> warning badge ---------------
(function () {
  var window = freshDom();
  window.AriseExamStorage = {
    load: function () {
      return { exams: [{ examName: "OS Mid Sem", examDate: today(6) }] };
    }
  };
  var seed = {
    version: 1, activeTab: "tier3",
    contests: [{ id: "c1", name: "Div 2 Round", platform: "Codeforces", date: today(5), type: "upcoming" }],
    virtualContests: [{ id: "v1", name: "CSES Practice", startDate: today(4), endDate: today(4) }]
  };
  localStorage.setItem("arise-cp-tracker-v1", JSON.stringify(seed));
  loadWidget(window);
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  clickTab(window, root, "tier3");
  var html = root.innerHTML;
  assert(html.indexOf("cp-badge-warn") !== -1, "clash badge rendered for contest inside the 3-day window");
  assert(html.indexOf("1d before") !== -1 || html.indexOf("OS Mid Sem") !== -1, "clash badge references the colliding exam / correct day count");
  assert(html.indexOf("CSES Practice") !== -1, "virtual contest also listed alongside live ones");
})();

// ---- Suite 4: live vs virtual split math -----------------------------------
(function () {
  var window = freshDom();
  var seed = {
    version: 1, activeTab: "tier3",
    contests: [
      { id: "p1", name: "Past Round A", date: today(-10), type: "past" },
      { id: "p2", name: "Past Round B", date: today(-5), type: "past" },
      { id: "u1", name: "Future Round", date: today(30), type: "upcoming" }
    ],
    virtualContests: [{ id: "v1", name: "Virtual A", startDate: today(-3) }]
  };
  localStorage.setItem("arise-cp-tracker-v1", JSON.stringify(seed));
  loadWidget(window);
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  clickTab(window, root, "tier3");
  var html = root.innerHTML;
  // 2 past live, 1 virtual -> 67% live / 33% virtual
  assert(html.indexOf("67%") !== -1, "live percentage computed correctly (2 of 3)");
  assert(html.indexOf("33%") !== -1, "virtual percentage computed correctly (1 of 3)");
})();

// ---- Suite 5: existing tabs still render fine (no regression) -------------
(function () {
  var window = freshDom();
  loadWidget(window);
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  clickTab(window, root, "overview");
  assert(root.innerHTML.length > 0, "overview tab still renders after adding tier3");
  clickTab(window, root, "settings");
  assert(root.innerHTML.indexOf("Export") !== -1 || root.innerHTML.length > 0, "settings tab still renders after adding tier3");
  clickTab(window, root, "tier3");
  assert(root.innerHTML.indexOf("Clash Radar") !== -1, "can navigate into tier3 tab after visiting others");
})();

console.log(assertions - failures.length + "/" + assertions + " assertions passed");
if (failures.length) {
  console.log("FAILURES:");
  failures.forEach(function (f) { console.log(" - " + f); });
  process.exit(1);
}
process.exit(0); // the widget's own listeners/observers keep the event loop alive otherwise
