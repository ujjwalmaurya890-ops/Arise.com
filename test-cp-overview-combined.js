"use strict";
var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");

var assertions = 0, failures = [];
function assert(cond, msg) { assertions++; if (!cond) failures.push(msg); }

function freshDom() {
  var dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://example.test/" });
  var window = dom.window;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  window.setInterval = function () { return 0; };
  window.clearInterval = function () {};
  window.fetch = function () { return Promise.reject(new Error("no network in tests")); };
  global.fetch = window.fetch;
  return window;
}

function loadWidgetWithState(window, state) {
  window.localStorage.setItem("arise-cp-tracker-v1", JSON.stringify(state));
  var code = fs.readFileSync(path.join(__dirname, "competitive-programming-widget.js"), "utf8");
  window.eval(code);
}

function baseState(overrides) {
  return Object.assign({
    version: 1, activeTab: "overview", platforms: [], ratings: [], problems: [],
    contests: [], virtualContests: [], activities: [],
    goals: { targetRating: 1600, targetDailyProblems: 1 },
    github: { username: "" }, leetcode: { username: "" }, projects: [],
    customPlatforms: [], customRatings: [],
    readiness: { resume: false, portfolioUrl: "", linkedinUrl: "", skills: "", targetRole: "" },
    integrations: { codeforces: { username: "" }, codechef: { username: "" }, atcoder: { username: "" }, hackerrank: { username: "", badges: "", stars: "" } },
    lastSynced: null, cpHistory: {}
  }, overrides || {});
}

// ---- Empty state: no platforms connected, no problems logged ----
(function () {
  var window = freshDom();
  loadWidgetWithState(window, baseState());
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  var html = root.innerHTML;
  assert(html.indexOf("Total Problems Solved") !== -1, "Overview should show the combined 'Total Problems Solved' card even with nothing connected");
  assert(html.indexOf("Connect a platform in Integrations to see it here.") !== -1, "empty state should nudge the user to connect a platform");
  window.__unmountCompetitiveProgramming(root);
})();

// ---- Populated: manual problems only should count toward the total ----
(function () {
  var window = freshDom();
  loadWidgetWithState(window, baseState({
    problems: [
      { id: "p1", date: "2026-08-01", title: "Two Sum", difficulty: "Easy" },
      { id: "p2", date: "2026-08-02", title: "Add Two Numbers", difficulty: "Medium" },
      { id: "p3", date: "2026-08-02", title: "LRU Cache", difficulty: "Hard" }
    ]
  }));
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  var html = root.innerHTML;
  assert(html.indexOf(">3<") !== -1 || /cp-stat-value[^>]*>\s*3\s*</.test(html), "combined total should include 3 manually-logged problems");
  assert(html.indexOf("Manually logged: 3") !== -1, "breakdown should show the manually-logged contribution");
  window.__unmountCompetitiveProgramming(root);
})();

// ---- History present -> chart renders instead of the empty-history message ----
(function () {
  var window = freshDom();
  loadWidgetWithState(window, baseState({
    cpHistory: {
      leetcode: [
        { date: "2026-08-01", metrics: { totalSolved: 100, rating: 1500 } },
        { date: "2026-08-05", metrics: { totalSolved: 110, rating: 1520 } },
        { date: "2026-08-10", metrics: { totalSolved: 125, rating: 1550 } }
      ]
    }
  }));
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  var html = root.innerHTML;
  assert(html.indexOf("Not enough sync history yet") === -1, "3 days of history should be enough to render a chart, not the empty state");
  assert(/<svg[^>]*class='cp-chart-svg'/.test(html) || html.indexOf('class="cp-chart-svg"') !== -1, "a chart svg should be rendered once history exists");
  assert(html.indexOf("LeetCode") !== -1, "chart legend should mention the platform with history");
  window.__unmountCompetitiveProgramming(root);
})();

// ---- Single day of history -> still shows the empty-history message, not a broken chart ----
(function () {
  var window = freshDom();
  loadWidgetWithState(window, baseState({
    cpHistory: { gfg: [{ date: "2026-08-10", metrics: { totalSolved: 50 } }] }
  }));
  var root = window.document.getElementById("root");
  window.__mountCompetitiveProgramming(root);
  var html = root.innerHTML;
  assert(html.indexOf("Not enough sync history yet") !== -1, "a single day of history isn't a trend yet — should show the friendly empty state");
  window.__unmountCompetitiveProgramming(root);
})();

console.log(assertions + " assertions, " + failures.length + " failures");
failures.forEach(function (f) { console.log("FAIL: " + f); });
process.exit(failures.length ? 1 : 0);
