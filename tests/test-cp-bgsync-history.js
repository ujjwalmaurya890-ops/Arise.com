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
  window.setInterval = function () { return 0; };
  window.clearInterval = function () {};
  window.requestIdleCallback = function () {}; // don't auto-run the real scheduled sync during load
  return window;
}

function loadWidget(window) {
  var code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "src/competitive-programming-widget.js"), "utf8");
  window.eval(code);
}

function jsonRes(body) {
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
}

// ---- Suite: __cpBackgroundSync exists and is callable without a mounted widget ----
(function () {
  var window = freshDom();
  window.fetch = function () { return Promise.reject(new Error("no network in tests")); };
  global.fetch = window.fetch;
  loadWidget(window);

  assert(typeof window.__cpBackgroundSync === "function", "window.__cpBackgroundSync should be exposed as a function");

  // No platforms connected yet -> should be a safe no-op, not throw, even though
  // no widget is mounted (n is null) and Yt() would try to touch a null node.
  var threw = false;
  try { window.__cpBackgroundSync(); } catch (e) { threw = true; }
  assert(!threw, "__cpBackgroundSync() must not throw when nothing is connected and nothing is mounted");
})();

// ---- Suite: background sync (with no widget mounted) fetches live data and
// records a history snapshot for a connected GitHub account ----
(function () {
  var window = freshDom();

  var calls = [];
  window.fetch = function (url) {
    calls.push(url);
    if (/\/users\/octocat\/repos/.test(url)) return jsonRes([{ language: "JS", size: 10, fork: false, stargazers_count: 5, forks_count: 1 }]);
    if (/\/users\/octocat\/events/.test(url)) return jsonRes([]);
    if (/\/users\/octocat$/.test(url)) return jsonRes({ public_repos: 12, followers: 34, avatar_url: "", created_at: "2020-01-01" });
    return Promise.reject(new Error("unexpected url: " + url));
  };
  global.fetch = window.fetch;

  // Seed state as if the user had connected GitHub in a previous session
  // (mirrors what "sync once" is supposed to persist across app loads) --
  // written BEFORE the widget script runs, since that's when it reads and
  // sanitizes whatever is already in localStorage into its live `a` object.
  var STORAGE_KEY = "arise-cp-tracker-v1";
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1, platforms: [], ratings: [], problems: [], contests: [],
    virtualContests: [], activities: [], goals: { targetRating: 1600, targetDailyProblems: 1 },
    github: { username: "octocat" }, leetcode: { username: "" }, projects: [],
    customPlatforms: [], customRatings: [],
    readiness: { resume: false, portfolioUrl: "", linkedinUrl: "", skills: "", targetRole: "" },
    integrations: { codeforces: { username: "" }, codechef: { username: "" }, atcoder: { username: "" }, hackerrank: { username: "", badges: "", stars: "" } },
    lastSynced: null, cpHistory: {}
  }));

  loadWidget(window);

  // Deliberately never mount the widget in this test — background sync
  // must work with no DOM node at all, which is the whole point of #1.

  return window.__cpBackgroundSync
    ? Promise.resolve()
        .then(function () { return window.__cpBackgroundSync(); })
        // let the Promise.all([...]).then(...) chain inside ht() resolve
        .then(function () { return new Promise(function (r) { setTimeout(r, 20); }); })
        .then(function () { return new Promise(function (r) { setTimeout(r, 20); }); })
        .then(function () {
          assert(calls.some(function (u) { return /api\.github\.com\/users\/octocat$/.test(u); }), "background sync should have called the GitHub API for the connected username");

          var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
          assert(stored.cpHistory && Array.isArray(stored.cpHistory.github), "cpHistory.github should exist and be an array after a successful background sync");
          assert(stored.cpHistory.github.length === 1, "exactly one snapshot should be recorded for today");
          var snap = stored.cpHistory.github[0];
          assert(snap.metrics && snap.metrics.repos === 12, "recorded snapshot should capture public_repos from the live API response");

          // Run it again "the same day" -> should update in place, not duplicate.
          return window.__cpBackgroundSync();
        })
        .then(function () { return new Promise(function (r) { setTimeout(r, 20); }); })
        .then(function () {
          var stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
          assert(stored.cpHistory.github.length === 1, "a same-day re-sync should update the existing snapshot, not append a duplicate");
        })
    : Promise.resolve();
})().then(function () {
  console.log(assertions + " assertions, " + failures.length + " failures");
  failures.forEach(function (f) { console.log("FAIL: " + f); });
  process.exit(failures.length ? 1 : 0);
});
