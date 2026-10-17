/*!
 * test-placement-engine.js
 * ------------------------
 * Deterministic unit tests for placement-engine.js — the pure math core
 * behind the placement-intelligence upgrade (next-best-action, blind spots,
 * pattern transfer, Tier-3 matrix, 90-day plan, ROI, project depth, code
 * ownership, defense scoring, production readiness, portfolio signal,
 * JD match, weekly sprint, command center).
 *
 * Dependency-free Node harness (same pattern as test-readiness-engine.js):
 * the engine IIFE runs in a vm sandbox with a tiny localStorage polyfill.
 * Run: node test-placement-engine.js
 * Exit 0 = all pass, non-zero = failures printed.
 */
"use strict";

// package.json sets "type":"module", so this test is ESM (the older
// require()-style tests in this repo predate that change).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

// ---------------------------------------------------------------- sandbox

function makeLocalStorage(seed) {
  var store = {};
  if (seed) Object.keys(seed).forEach(function (k) { store[k] = seed[k]; });
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
}

function loadEngine(seed) {
  var ls = makeLocalStorage(seed || {});
  var sandbox = {
    console: console, Date: Date, Math: Math, JSON: JSON,
    Object: Object, Array: Array, Number: Number, String: String, RegExp: RegExp,
    isFinite: isFinite, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat
  };
  sandbox.localStorage = ls;
  sandbox.window = { localStorage: ls };
  sandbox.performance = { now: function () { return Date.now(); } };
  vm.createContext(sandbox);
  var code = fs.readFileSync(path.join(__dirname, "placement-engine.js"), "utf8");
  vm.runInContext(code, sandbox, { filename: "placement-engine.js" });
  return { E: sandbox.window.__ARISE_PLACEMENT_ENGINE__, ls: ls, sandbox: sandbox };
}

// ---------------------------------------------------------------- helpers

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok -", msg); }
  else { fail++; console.error("  FAIL:", msg); }
}
function eq(a, b, msg) {
  var ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { pass++; if (VERBOSE) console.log("  ok -", msg); }
  else { fail++; console.error("  FAIL:", msg, "\n    expected:", jb, "\n    actual:  ", ja); }
}
function section(name) { console.log("\n== " + name + " =="); }

var NOW = new Date("2026-09-13T12:00:00Z").getTime();
var DAY = 86400000;
function daysAgo(n) { return new Date(NOW - n * DAY).toISOString(); }

// ---------------------------------------------------------------- fixtures

var Q = [
  { id: "a1", title: "Two Sum", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "http://x/1", solved: true, revision: false, dateSolved: daysAgo(1) },
  { id: "a2", title: "Stock I", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "http://x/2", solved: true, revision: false, dateSolved: daysAgo(2) },
  { id: "a3", title: "Max Subarray", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "http://x/3", solved: true, revision: false, dateSolved: daysAgo(3) },
  { id: "a4", title: "Product Except Self", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "http://x/4", solved: false },
  { id: "dp1", title: "Climbing Stairs", topic: "DP", difficulty: "Easy", platform: "LeetCode", link: "http://x/5", solved: false },
  { id: "dp2", title: "House Robber", topic: "DP", difficulty: "Medium", platform: "LeetCode", link: "http://x/6", solved: false },
  { id: "r1", title: "Fibonacci", topic: "Recursion", difficulty: "Easy", platform: "GFG", link: "http://x/7", solved: true, revision: false, dateSolved: daysAgo(75) },
  { id: "r2", title: "Power Set", topic: "Recursion", difficulty: "Medium", platform: "GFG", link: "http://x/8", solved: false },
  { id: "t1", title: "Implement Trie", topic: "Tries", difficulty: "Medium", platform: "LeetCode", link: "http://x/9", solved: false },
  { id: "s1", title: "Valid Parentheses", topic: "Stack", difficulty: "Easy", platform: "LeetCode", link: "http://x/10", solved: false }
];

var INS = {
  a1: { companies: ["Amazon", "TCS"], pattern: "Hashing", quality: "unaided" },
  a2: { companies: [], pattern: "Two Pointers", quality: "hint" },
  a3: { companies: ["Google"], pattern: "Dynamic Programming", quality: "" }
};

var SRS = {
  a3: { interval: 1, ease: 2.3, dueAt: NOW - DAY, reviews: 4, lastResult: "again" },
  r1: { interval: 3, ease: 2.3, dueAt: NOW + 3 * DAY, reviews: 1, lastResult: "good" }
};

// ===================================================================== tests

section("engine API surface");
{
  var env = loadEngine();
  var E = env.E;
  ok(!!E, "engine exposes __ARISE_PLACEMENT_ENGINE__");
  ["dsaTopicSignals", "computeTopicROI", "computeNextBestAction", "computeBlindSpots",
   "scorePatternTransfer", "pickTransferProblem", "computeTier3Matrix", "compute90DayPlan",
   "computeProjectDepth", "computeCodeOwnership", "buildDefensePack", "scoreDefenseSession",
   "computeProductionReadiness", "computePortfolioSignal", "computeJDMatch",
   "computeWeeklySprint", "computeCommandCenter", "collectContext"].forEach(function (fn) {
    ok(typeof E[fn] === "function", "api." + fn + " is a function");
  });
}

section("dsaTopicSignals: weighted mastery + quality mix");
{
  var E = loadEngine().E;
  var sig = E.dsaTopicSignals(Q, INS, SRS, NOW);
  var arrays = sig.filter(function (s) { return s.topic === "Arrays"; })[0];
  // Arrays: total weight = 1+1+3+3 = 8, solved weight = 1+1+3 = 5 → 62.5 → 63 (round)
  ok(arrays && arrays.masteryPct === 63, "Arrays mastery = 63% (5/8 weighted)");
  ok(arrays.unsolvedCount === 1, "Arrays has 1 unsolved");
  ok(arrays.unaidedPct === 33, "Arrays unaided = 33% (1 of 3)");
  ok(arrays.companyHits === 3, "Arrays companyHits = 3 (2+0+1)");
  var dp = sig.filter(function (s) { return s.topic === "DP"; })[0];
  ok(dp && dp.masteryPct === 0 && dp.unsolvedCount === 2, "DP unsolved topic tracked");
  var tries = sig.filter(function (s) { return s.topic === "Tries"; })[0];
  ok(!!tries, "zero-solved topic still appears");
  // Determinism: same input twice → identical output
  var sig2 = E.dsaTopicSignals(Q, INS, SRS, NOW);
  eq(sig, sig2, "signals deterministic across calls");
}

section("computeTopicROI: prerequisite gate blocks advanced topics");
{
  var E = loadEngine().E;
  // ROI fixture: Arrays barely started (1 easy solved of heavy bank) so it reads
  // as the classic "weak + highly relevant" HIGH-ROI topic.
  var Q_ROI = [
    { id: "a1", title: "Two Sum", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "", solved: true, dateSolved: daysAgo(1) },
    { id: "a2", title: "Stock", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "", solved: false },
    { id: "a3", title: "Max Sub", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "", solved: false },
    { id: "a4", title: "Product", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "", solved: false },
    { id: "dp1", title: "Climbing Stairs", topic: "DP", difficulty: "Easy", platform: "LeetCode", link: "", solved: false },
    { id: "r1", title: "Fibonacci", topic: "Recursion", difficulty: "Easy", platform: "GFG", link: "", solved: true, dateSolved: daysAgo(30) },
    { id: "t1", title: "Trie", topic: "Tries", difficulty: "Medium", platform: "LeetCode", link: "", solved: false }
  ];
  var sig = E.dsaTopicSignals(Q_ROI, {}, {}, NOW);
  var roi = E.computeTopicROI(sig);
  var byName = {};
  roi.forEach(function (r) { byName[r.topic] = r; });
  ok(byName["DP"].band === "LOW", "DP is LOW while Recursion mastery is 25% (gate) — got " + byName["DP"].band + " roi=" + byName["DP"].roi);
  ok(byName["DP"].factors.prereqGate < 0.3, "DP prereqGate steeply suppressed (<0.3), got " + byName["DP"].factors.prereqGate);
  ok(byName["Arrays"].band === "HIGH", "Arrays is HIGH (weak + freq 5), got " + byName["Arrays"].band);
  ok(byName["Arrays"].factors.freq === 5, "Arrays freq = 5");
  ok(byName["Tries"].band === "LOW", "Tries LOW (prereqs Trees+Strings untouched + low freq)");
  // fully-solved topic → LOW with mastered reason
  var solvedQ = Q.map(function (q) { return Object.assign({}, q, { solved: true, dateSolved: daysAgo(2) }); });
  var sigFull = E.dsaTopicSignals(solvedQ, {}, {}, NOW);
  var roiFull = E.computeTopicROI(sigFull);
  var arraysFull = roiFull.filter(function (r) { return r.topic === "Arrays"; })[0];
  ok(arraysFull.band === "LOW", "fully-solved Arrays drops to LOW");
  ok(/Fully solved/.test(arraysFull.reason), "fully-solved reason is honest");
  // Determinism
  eq(roi, E.computeTopicROI(E.dsaTopicSignals(Q_ROI, {}, {}, NOW)), "ROI deterministic");
}

section("computeNextBestAction: pick, count, minutes, restart mode");
{
  var E = loadEngine().E;
  // Action fixture: Arrays dominates (weak, freq 5, 4 unsolved); other topics solved.
  var Q_ACT = [
    { id: "a0", title: "Two Sum", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "http://x/1", solved: true, dateSolved: daysAgo(1) },
    { id: "a1", title: "Stock I", topic: "Arrays", difficulty: "Easy", platform: "LeetCode", link: "http://x/2", solved: false },
    { id: "a2", title: "Max Subarray", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "http://x/3", solved: false },
    { id: "a3", title: "Product Except Self", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "http://x/4", solved: false },
    { id: "a4", title: "Rotate Array", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "http://x/5", solved: false },
    { id: "r1", title: "Fibonacci", topic: "Recursion", difficulty: "Easy", platform: "GFG", link: "", solved: true, dateSolved: daysAgo(1) },
    { id: "r2", title: "Power Set", topic: "Recursion", difficulty: "Medium", platform: "GFG", link: "", solved: true, dateSolved: daysAgo(1) }
  ];
  var sig = E.dsaTopicSignals(Q_ACT, {}, {}, NOW);
  var roi = E.computeTopicROI(sig);
  var nba = E.computeNextBestAction(sig, Q_ACT, roi, NOW, 0);
  ok(!!nba, "action produced");
  ok(nba.topic === "Arrays", "action targets the weak dominant topic (got " + nba.topic + ")");
  ok(nba.count === 3, "default 3 problems (got " + nba.count + ")");
  ok(nba.problems.length === nba.count, "problem list matches count");
  var minutes = nba.problems.reduce(function (m, p) { return m + (E.BASE_MINUTES[p.difficulty] || 30); }, 0);
  ok(nba.minutes === minutes, "minutes = sum of base minutes");
  ok(nba.reasons.length >= 2, "reasons explain the pick");
  ok(/weak topic/i.test(nba.reasons[0]), "first reason names weakness");
  // restart mode: 5+ days inactive
  var nbaRestart = E.computeNextBestAction(sig, Q_ACT, roi, NOW, 6);
  ok(nbaRestart.restartMode === true && nbaRestart.count === 2, "restart mode: 2 problems after inactivity");
  // Fundamentals-first ordering: Easy before Medium within the topic
  var weights = nba.problems.map(function (p) { return E.DIFF_WEIGHT[p.difficulty]; });
  var sorted = weights.slice().sort(function (a, b) { return a - b; });
  eq(weights, sorted, "problems ordered Easy → Medium");
  // count never exceeds the topic's unsolved supply
  var nbaTight = E.computeNextBestAction(sig, Q_ACT, roi, NOW, 0);
  var unsolvedArrays = Q_ACT.filter(function (q) { return q.topic === nbaTight.topic && !q.solved; }).length;
  ok(nbaTight.count <= unsolvedArrays, "count respects bank supply");
  // Determinism
  var sig2 = E.dsaTopicSignals(Q_ACT, {}, {}, NOW);
  var nba2 = E.computeNextBestAction(sig2, Q_ACT, E.computeTopicROI(sig2), NOW, 0);
  eq(nba, nba2, "next action deterministic");
}

section("computeBlindSpots: evidence flags only");
{
  var E = loadEngine().E;
  // SRS has only a3 (lapsing). r1 deliberately has NO srs entry → stale flag.
  var bs = E.computeBlindSpots(Q, INS, { a3: SRS.a3 }, NOW);
  var byId = {};
  bs.items.forEach(function (i) { byId[i.id] = i; });
  ok(!!byId.a2, "hint-assisted solve flagged (a2)");
  ok(byId.a2.flags.some(function (f) { return f.code === "hint"; }), "a2 has hint flag");
  ok(!!byId.a3, "a3 flagged (SRS reviews>=4 lapsing)");
  ok(!!byId.r1, "r1 flagged (solved 40d ago, never revised)");
  ok(byId.r1.flags.some(function (f) { return f.code === "stale"; }), "r1 has stale flag");
  ok(!byId.a1, "clean unaided recent solve (a1) NOT flagged");
  // pattern-level: Two Pointers failing once — not enough; need 2+
  var Q2 = Q.concat([
    { id: "a9", title: "3Sum", topic: "Arrays", difficulty: "Medium", platform: "LeetCode", link: "", solved: true, dateSolved: daysAgo(1) }
  ]);
  var INS2 = JSON.parse(JSON.stringify(INS));
  INS2.a9 = { companies: [], pattern: "Two Pointers", quality: "hint" };
  var bs2 = E.computeBlindSpots(Q2, INS2, SRS, NOW);
  ok(bs2.patterns.some(function (p) { return p.pattern === "Two Pointers" && p.affectedCount === 2; }),
    "same pattern failing across 2 problems detected");
  ok(bs2.remediation.length >= 1 && /^\d\./.test(bs2.remediation[0]), "remediation sequence is ordered steps");
  // No solves → no items, honest empty state
  var bsEmpty = E.computeBlindSpots(Q.filter(function (q) { return !q.solved; }), INS, SRS, NOW);
  ok(bsEmpty.items.length === 0, "no blind spots without solves");
}

section("pattern transfer: deterministic pick + score math");
{
  var E = loadEngine().E;
  // Learned pattern "Hashing" (a1 unaided) → unseen problem in Hashing/Arrays topics
  var pick = E.pickTransferProblem("Hashing", Q);
  ok(!!pick && !pick.solved, "picks an unsolved problem");
  ok(pick.topic === "Arrays" || pick.topic === "Strings" || pick.topic === "Hashing" || pick.topic === "Binary Search" || pick.topic === "Sliding Window",
    "pick comes from the pattern's topic map (got " + pick.topic + ")");
  ok(pick.difficulty !== "Hard", "never picks a Hard problem for a transfer check");
  var pick2 = E.pickTransferProblem("Hashing", Q);
  eq(pick && pick.id, pick2 && pick2.id, "pick is deterministic");
  // Perfect test: unaided, fast, solved, great code+explanation
  var perfect = E.scorePatternTransfer({
    outcome: "unaided", result: "solved", minutes: 20, difficulty: "Easy",
    codeQuality: 5, explained: true, explainQuality: 5
  });
  ok(perfect.score === 100, "perfect run scores 100 (got " + perfect.score + ")");
  // Copied-solution slow failure scores low
  var bad = E.scorePatternTransfer({
    outcome: "solution", result: "failed", minutes: 240, difficulty: "Easy",
    codeQuality: 1, explained: false, explainQuality: 0
  });
  ok(bad.score <= 25, "solution-assisted failure scores low (got " + bad.score + ")");
  ok(bad.breakdown.independence === 8, "independence component = 8/40 for solution outcome");
  // Unaided but 4x over time → time component 0
  var slow = E.scorePatternTransfer({
    outcome: "unaided", result: "solved", minutes: 120, difficulty: "Easy",
    codeQuality: 5, explained: true, explainQuality: 5
  });
  ok(slow.breakdown.time === 0, "4x-over-time run loses all time points");
  ok(slow.score === 80, "slow unaided = 80 (indep 40 + correct 15 + code 15 + explain 10), got " + slow.score);
}

section("dsaSubScores + Tier-3 matrix");
{
  var E = loadEngine().E;
  var sub = E.dsaSubScores(Q, {}, {}, {}, NOW);
  // Bank-wide mass weights: Easy a1:2,a2:2,dp1:2,r1:2,s1:2 (solved: a1,a2,r1 = 6 of 8 easy)
  // + Medium a3:1,a4:1,dp2:1,r2:1,t1:1 (solved: a3 = 1 of 5) → total 15, solved 7 → 47%
  ok(sub.mass === 47, "mass score = 47% bank-wide Easy/Medium-weighted (got " + sub.mass + ")");
  ok(sub.medium === 20, "medium mastery = 20% (3 of 15 weighted)");
  ok(sub.consistency === 21, "consistency = 3 active days of 14 → 21%");
  ok(sub.coreUnaided === null, "coreUnaided null when no CORE pattern tagged");
  var subTagged = E.dsaSubScores(Q, INS, {}, {}, NOW);
  ok(subTagged.coreUnaided === 0, "coreUnaided 0 when the only core tag is hint-assisted");
  var devScores = { depthAvg: 60, ownership: 70, portfolio: 50 };
  var matrix = E.computeTier3Matrix(sub, devScores);
  ok(matrix.length === 5, "five company targets");
  var mass = matrix.filter(function (t) { return t.key === "mass"; })[0];
  ok(mass.current != null && mass.gap != null, "mass target has numbers");
  // mass: .55*47 + .2*0(sheets) + .15*21 + .1*20 = 25.85+0+3.15+2 = 31
  ok(mass.current === 31, "mass current = 31 (got " + mass.current + ")");
  ok(mass.status === "major-gap", "34-point gap reads as major-gap");
  var startup = matrix.filter(function (t) { return t.key === "startup"; })[0];
  ok(startup.current != null, "startup target computable with dev scores");
  ok(matrix.every(function (t) { return typeof t.action === "string" && t.action.length > 10; }), "every target has an action");
  // Missing factors are renormalized, not zeroed: matrix without dev scores still computes
  var matrixNoDev = E.computeTier3Matrix(sub, {});
  var startupND = matrixNoDev.filter(function (t) { return t.key === "startup"; })[0];
  ok(startupND.current != null && startupND.estimated === true, "startup estimated (renormalized) without dev data");
  // Determinism
  eq(matrix, E.computeTier3Matrix(E.dsaSubScores(Q, {}, {}, {}, NOW), devScores), "matrix deterministic");
}

section("90-day plan: not started / adaptive recalculation");
{
  var E = loadEngine().E;
  var sig = E.dsaTopicSignals(Q, {}, {}, NOW);
  var roi = E.computeTopicROI(sig);
  var plan0 = E.compute90DayPlan(Q, roi, {}, {}, NOW);
  ok(plan0.started === false, "plan not started without startDate");
  // Started 10 days ago; last activity 7 days ago → 6-day gap → recalculate.
  // All DSA solves pushed to 75d ago so they don't count as recent activity.
  var Q_OLD = Q.map(function (q) {
    return q.solved ? Object.assign({}, q, { dateSolved: daysAgo(75) }) : q;
  });
  var planState = { startDate: daysAgo(10), recalcs: [] };
  var activity = {};
  [7, 8, 9].forEach(function (n) { activity[E.dayKey(NOW - n * DAY)] = { coding: 30 }; });
  var plan1 = E.compute90DayPlan(Q_OLD, roi, planState, activity, NOW);
  ok(plan1.started === true && plan1.daysElapsed === 11, "daysElapsed = 11");
  ok(plan1.missedStreak === 6, "missedStreak = 6 (last activity 7 days ago), got " + plan1.missedStreak);
  ok(plan1.needsRecalc === true, "recalculation triggered after 3+ missed days");
  ok(plan1.dailyTarget >= 1, "daily target recomputed (" + plan1.dailyTarget + "/day)");
  ok(plan1.currentPhase && plan1.currentPhase.state === "current", "current phase identified");
  ok(plan1.phases.length === 5, "five phases present");
  ok(plan1.today && plan1.today.items.length >= 1, "today has concrete items");
  // Active plan, no misses, recent start → no recalc banner
  var planState2 = { startDate: daysAgo(5), recalcs: [] };
  var activity2 = {};
  [0, 1, 2].forEach(function (n) { activity2[E.dayKey(NOW - n * DAY)] = { coding: 30 }; });
  var plan2 = E.compute90DayPlan(Q, roi, planState2, activity2, NOW);
  ok(plan2.missedStreak === 0 && plan2.needsRecalc === false, "active plan does not recalc");
}

section("project depth: evidence-based, deterministic");
{
  var E = loadEngine().E;
  var deepProject = {
    id: "p1", title: "CampusConnect", description: "A full-stack placement prep platform with JWT auth, REST API, MongoDB database, jest tests, deployed on Render with docker, caching with redis, logging via morgan",
    techStack: ["React", "Node", "Express", "MongoDB"],
    features: [{ text: "auth" }, { text: "dashboard" }], bugs: [{ text: "fixed login bug" }],
    githubLink: "http://github.com/x", demoLink: "http://x.onrender.com",
    progress: 90, archived: false
  };
  var d1 = E.computeProjectDepth(deepProject, { tests: true, readme: true, deployment: true, responsiveUI: true });
  ok(d1.score >= 50, "deep project scores well (got " + d1.score + ")");
  ok(d1.dimensions.length === 15, "15 dimensions evaluated");
  ok(d1.topImprovements.length <= 3, "top-3 improvements");
  var shallow = {
    id: "p2", title: "Netflix Clone", description: "todo", techStack: ["HTML"], features: [], bugs: [],
    githubLink: "", demoLink: "", progress: 10, archived: false
  };
  var d2 = E.computeProjectDepth(shallow, {});
  ok(d2.score < d1.score, "shallow clone scores below deep project");
  ok(d2.dimensions.some(function (x) { return x.state === "missing" && x.improvement; }), "missing dimensions carry concrete improvements");
  eq(d1, E.computeProjectDepth(deepProject, { tests: true, readme: true, deployment: true, responsiveUI: true }), "depth deterministic");
  // corrupt project object must not throw
  var d3 = E.computeProjectDepth(null, "garbage");
  ok(typeof d3.score === "number", "null project handled gracefully");
}

section("code ownership: independent >> copied");
{
  var E = loadEngine().E;
  var tasks = [
    { id: 1, title: "Auth flow", category: "Backend", difficulty: "Intermediate", completed: true },
    { id: 2, title: "Table component", category: "Frontend", difficulty: "Beginner", completed: true },
    { id: 3, title: "API client", category: "Backend", difficulty: "Intermediate", completed: true },
    { id: 4, title: "Form validation", category: "Frontend", difficulty: "Beginner", completed: true }
  ];
  var insights = {
    1: { quality: "independent", concept: "Auth" },
    2: { quality: "guided", concept: "UI" },
    3: { quality: "copied", concept: "API" },
    4: { quality: "copied", concept: "Validation" }
  };
  var own = E.computeCodeOwnership(tasks, insights);
  ok(own.score != null && own.score > 0 && own.score < 100, "ownership score in range (got " + own.score + ")");
  // Independent-only version must be much higher
  var insightsAllInd = JSON.parse(JSON.stringify(insights));
  Object.keys(insightsAllInd).forEach(function (k) { insightsAllInd[k].quality = "independent"; });
  var ownAll = E.computeCodeOwnership(tasks, insightsAllInd);
  ok(ownAll.score === 100, "all-independent scores 100");
  ok(ownAll.score - own.score >= 30, "independent carries ~5x copied weight (delta " + (ownAll.score - own.score) + ")");
  ok(own.queue.length === 3, "re-implement queue holds copied+guided tasks (3)");
  ok(own.queue[0].quality === "copied", "queue prioritizes copied first");
  ok(typeof own.verdict === "string" && own.verdict.length > 10, "verdict present");
  ok(!/shame|lazy|cheat|fake/i.test(own.verdict), "verdict is encouraging, not shaming");
  ok(/re-build|re-build/i.test(own.queue[0] ? "re-build" : ""), "queue frames the next action as a rebuild");
  // No tags → honest null + guidance
  var ownUntagged = E.computeCodeOwnership(tasks, {});
  ok(ownUntagged.score === null, "untagged tasks → null score, not a fake number");
  ok(ownUntagged.mix.untagged === 4, "untagged count disclosed");
  // Untagged tasks don't dilute tagged scores
  var ownMixed = E.computeCodeOwnership(
    [tasks[0], { id: 9, title: "x", category: "c", difficulty: "Advanced", completed: true }],
    { 1: { quality: "independent", concept: "Auth" } });
  ok(ownMixed.score === 100, "untagged work excluded — independent task still scores 100, got " + ownMixed.score);
}

section("defense simulator: packs + scoring");
{
  var E = loadEngine().E;
  var project = {
    id: "p1", title: "CampusConnect", progress: 90,
    description: "Full-stack app with JWT auth and MongoDB, express REST API, deployed on render",
    techStack: ["React", "Node", "Express", "MongoDB"], features: [], bugs: []
  };
  var pack = E.buildDefensePack(project);
  ok(pack.categories.length === 10, "10 defense categories");
  var allQ = [];
  pack.categories.forEach(function (c) { c.questions.forEach(function (q) { allQ.push(q.q); }); });
  ok(allQ.length >= 12, "at least 12 questions");
  ok(allQ.some(function (q) { return /MongoDB instead of PostgreSQL|instead of/.test(q); }), "why-this-tech question uses real stack + alternative");
  ok(allQ.some(function (q) { return /10,000 users/.test(q); }), "scale question present");
  ok(allQ.some(function (q) { return /secure|authentication/i.test(q); }), "security question present");
  ok(allQ.some(function (q) { return /debug/i.test(q); }), "debugging question present");
  var scored = E.scoreDefenseSession([
    { key: "architecture", score: 4 }, { key: "api", score: 3 },
    { key: "security", score: 1 }, { key: "scalability", score: 0 }
  ]);
  ok(scored.score === 50, "defense score = avg(4,3,1,0)/4 = 50% (got " + scored.score + ")");
  ok(scored.weakCats.indexOf("security") !== -1 && scored.weakCats.indexOf("scalability") !== -1, "weak categories recorded");
  ok(E.scoreDefenseSession([]).score === null, "empty session → null score");
  var summary = E.computeDefenseSummary([project], { p1: { sessions: [{ at: NOW, score: 62, weakCats: ["api"] }] } });
  ok(summary.overall === 62 && summary.perProject[0].score === 62, "defense summary reads stored sessions");
}

section("production readiness + portfolio signal");
{
  var E = loadEngine().E;
  var proj = {
    id: "p1", title: "ShopLite", progress: 80,
    description: "E-commerce app with jwt auth, express REST API, mongodb with mongoose schema, dotenv env vars, morgan logging, deployed on render, jest unit tests, input validation with zod",
    techStack: ["React", "Express", "MongoDB"], features: [], bugs: [{ text: "x" }],
    githubLink: "http://gh", demoLink: "http://demo", archived: false
  };
  var pr = E.computeProductionReadiness(proj, { tests: true, readme: true, deployment: true });
  ok(pr.score > 0, "production score computed (got " + pr.score + ")");
  ok(["Prototype", "Functional", "Deployable", "Production-ready"].indexOf(pr.level) !== -1, "level is one of the four stages (" + pr.level + ")");
  ok(pr.checks.length === 11 && pr.checks.every(function (c) { return c.done || c.fix; }), "11 checks, each missing one has a fix");
  ok(typeof pr.why === "string" && pr.why.length > 5, "why-string explains the level");
  var empty = E.computeProductionReadiness({ id: "p2", title: "x", techStack: [] }, {});
  ok(empty.level === "Prototype" && empty.score === 0, "empty project = Prototype 0");
  // Portfolio: clone penalized, real project scored, count not a factor
  var clone = { id: "c1", title: "Netflix Clone", description: "tutorial clone project", techStack: ["HTML"], features: [], bugs: [], progress: 40, archived: false };
  var real = { id: "r1", title: "ShopLite", description: "Inventory system for local shops with billing and gst reports", techStack: ["React", "Node", "MongoDB"], features: [{ text: "a" }, { text: "b" }], bugs: [{ text: "b" }], githubLink: "http://g", demoLink: "http://d", progress: 90, archived: false };
  var pf = E.computePortfolioSignal([clone, real], [], []);
  ok(pf.score != null, "portfolio score computed");
  var pfReal = pf.perProject.filter(function (p) { return p.title === "ShopLite"; })[0];
  var pfClone = pf.perProject.filter(function (p) { return p.title === "Netflix Clone"; })[0];
  ok(pfReal.score > pfClone.score, "real project outscores tutorial clone (" + pfReal.score + " vs " + pfClone.score + ")");
  ok(/not a factor/i.test(pf.note), "repo-count vanity explicitly disclaimed");
  ok(pf.topFixes.length >= 1, "top fixes listed");
  ok(E.computePortfolioSignal([], [], []).score === null, "no projects → null with guidance");
}

section("JD match: deterministic parse + weighted coverage");
{
  var E = loadEngine().E;
  var ctx = {
    skillCoverage: {
      "react": { pct: 80, source: "dev tasks" }, "node.js": { pct: 75, source: "dev tasks" },
      "git": { pct: 90, source: "dev tasks" }, "rest api": { pct: 60, source: "dev tasks" }
    }
  };
  var jd = "We are hiring a MERN fresher.\nRequired: React, Node.js, REST API, Git, Docker, Redis, DSA/problem solving.\nPreferred: GraphQL, Kubernetes.";
  var m = E.computeJDMatch(jd, ctx);
  ok(m && m.matchPct != null, "match % computed (got " + m.matchPct + ")");
  ok(m.dsaExpected === true, "DSA expectation detected");
  ok(m.missing.indexOf("Docker") !== -1 && m.missing.indexOf("Redis") !== -1, "Docker + Redis flagged missing");
  ok(m.strong.some(function (s) { return s.name === "React"; }), "React listed as strong");
  ok(m.actions.length >= 1, "next-7-day action produced");
  ok(m.actions.some(function (a) { return /DSA/i.test(a); }), "DSA action present because JD tests DSA");
  ok(m.preferred.indexOf("GraphQL") !== -1, "preferred section parsed");
  // Preferred skills still count in the denominator (they're part of the JD),
  // so an unmet preferred skill dilutes the match — never inflates it.
  var m2 = E.computeJDMatch("Required: React, Node.js, REST API, Git, Docker, Redis, DSA/problem solving.", ctx);
  ok(m2.matchPct >= m.matchPct, "removing unmet preferred skills can only raise match (got " + m2.matchPct + " vs " + m.matchPct + ")");
  // deterministic
  eq(m, E.computeJDMatch(jd, ctx), "JD match deterministic");
  ok(E.computeJDMatch("", ctx) === null, "empty JD → null");
  // corrupt ctx must not throw
  var m3 = E.computeJDMatch(jd, null);
  ok(m3 && m3.matchPct != null && m3.matchPct === 0, "missing coverage → 0% match, no throw");
}

section("weekly sprint: base counts + auto-adjustment");
{
  var E = loadEngine().E;
  var ctx = {
    nextBestAction: { topic: "Arrays", count: 3, minutes: 60, restartMode: false, reasons: [], problems: [], alternates: [] },
    devNextTask: { id: 1, title: "Auth flow", category: "Backend" },
    projectNextFix: "ShopLite: add tests", revisionTargets: ["Arrays", "DP"]
  };
  var wk = E.computeWeeklySprint(ctx, NOW, {});
  ok(wk.rows.length === 6, "six sprint rows");
  eq(wk.counts, { dsa: 5, dev: 1, project: 1, career: 2, interview: 1, revision: 3 }, "base counts");
  ok(wk.rows[0].detail.indexOf("Arrays") !== -1, "DSA row references the action topic");
  // Last week 100% complete → dsa +1
  var lastWeekKey = E.isoWeekKey(NOW - 7 * DAY);
  var logGood = { weeks: {} }; logGood.weeks[lastWeekKey] = { checks: { dsa: 1, dev: 1, project: 1, career: 1, interview: 1, revision: 1 } };
  ok(E.computeWeeklySprint(ctx, NOW, logGood).counts.dsa === 6, "great week raises DSA target to 6");
  // Last week ~0% → dsa -1 (floor 3)
  var logBad = { weeks: {} }; logBad.weeks[lastWeekKey] = { checks: {} };
  ok(E.computeWeeklySprint(ctx, NOW, logBad).counts.dsa === 4, "weak week lowers DSA target to 4");
  ok(E.computeWeeklySprint(ctx, NOW, logBad).adjustments.length === 1, "adjustment is disclosed, not silent");
}

section("command center: bottleneck + weights");
{
  var E = loadEngine().E;
  var ctx = {
    dsaReadiness: 68, devReadiness: 76, projectReadiness: 64,
    interviewReadiness: 51, resumeReadiness: 73, consistency: 60,
    nextBestAction: { topic: "Binary Search", count: 3, minutes: 75, reasons: [], problems: [] },
    ownershipQueue: [{ title: "API client" }],
    projectNextFix: "ShopLite: add tests",
    defenseProjectTitle: "CampusConnect",
    avoidTopics: [{ topic: "Tries", reason: "rarely asked" }],
    sprint: { rows: [{ key: "dsa", count: 5, label: "DSA", detail: "x", icon: "x" }] }
  };
  var cc = E.computeCommandCenter(ctx, NOW);
  ok(cc.bottleneck && cc.bottleneck.key === "interview", "bottleneck = interview (51)");
  ok(cc.overall != null, "overall computed (got " + cc.overall + ")");
  // weighted: (68*25+76*20+64*15+51*20+73*10+60*10)/100 = 65.1 → 65
  ok(cc.overall === 65, "overall = 65 with the documented weights (got " + cc.overall + ")");
  ok(/mock|defense/i.test(cc.roiAction), "highest-ROI action targets the bottleneck");
  ok(cc.week.length === 1, "this-week rows flow from sprint");
  ok(cc.avoid.length === 1 && cc.avoid[0].topic === "Tries", "avoid list flows from ROI engine");
  // all nulls → honest empty
  var ccEmpty = E.computeCommandCenter({}, NOW);
  ok(ccEmpty.overall === null, "no data → null overall, no fake number");
}

section("collectContext: corrupt + empty localStorage safety");
{
  var E = loadEngine({
    dsaQuestions: "{corrupt json!!",
    devTasks: "[1,2,",
    projects: "null",
    dsaProblemInsights: "42",
    dsaRevisionSRS: '"oops"',
    devTaskInsights: "[]",
    arise_placement_tracker_v1: "{{{"
  }).E;
  var ctx = E.collectContext(NOW);
  ok(Array.isArray(ctx.questions) && ctx.questions.length === 0, "corrupt dsaQuestions → empty array");
  ok(Array.isArray(ctx.devTasks) && ctx.devTasks.length === 0, "corrupt devTasks → empty array");
  ok(Array.isArray(ctx.projects), "corrupt projects → array");
  ok(Array.isArray(ctx.roi) || ctx.roi == null, "roi safe with corrupt data");
  ok(ctx.nextBestAction === null, "no questions → null next action (not a crash)");
  ok(ctx.sprint && ctx.sprint.rows.length === 6, "sprint still renders base rows with no data");
  var cc = E.computeCommandCenter(Object.assign({}, ctx, { ownershipQueue: [] }), NOW);
  ok(cc.overall === null, "command center safe on corrupt storage");
  // writeJSON roundtrip still works
  ok(E.writeJSON("t1", { a: 1 }) && E.readJSON("t1", null).a === 1, "read/write helpers work");
}

section("wiring: index.html + storage manifest + service worker");
{
  var html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  ok(html.indexOf('src="./placement-engine.js"') !== -1, "index.html loads placement-engine.js in head");
  ok(html.indexOf("'./dsa-placement-engine-widget.js'") !== -1, "lazy loader includes dsa widget");
  ok(html.indexOf("'./dev-placement-engine-widget.js'") !== -1, "lazy loader includes dev widget");
  ok(html.indexOf("'./placement-command-center-widget.js'") !== -1, "lazy loader includes command center");
  var dsaIdx = html.indexOf("'./dsa-placement-engine-widget.js'");
  var devIdx = html.indexOf("'./dev-placement-engine-widget.js'");
  var ccIdx = html.indexOf("'./placement-command-center-widget.js'");
  var tier3Idx = html.indexOf("'./dsa-tier3-readiness-widget.js'");
  ok(tier3Idx !== -1 && dsaIdx > tier3Idx, "dsa widget loads after dsa-tier3 (card exists first)");
  ok(dsaIdx < devIdx && devIdx < ccIdx, "widget load order dsa → dev → command center");
  var sw = fs.readFileSync(path.join(__dirname, "service-worker.js"), "utf8");
  ["./placement-engine.js", "./dsa-placement-engine-widget.js", "./dev-placement-engine-widget.js", "./placement-command-center-widget.js"].forEach(function (f) {
    ok(sw.indexOf('"' + f + '"') !== -1, "service worker precaches " + f);
  });
  // storage manifest
  var ls = makeLocalStorage({});
  var sb = { console: console, window: {}, localStorage: ls };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "storage-keys.js"), "utf8"), sb, { filename: "storage-keys.js" });
  var manifest = sb.window.__ARISE_STORAGE_KEYS__.all;
  ["placementPatternTransfer-v1", "placementDefense-v1", "placement90DayPlan-v1", "placementSprintLog-v1", "placementJD-v1"].forEach(function (k) {
    ok(manifest.some(function (e) { return e.key === k; }), "storage manifest registers " + k);
  });
  ok(!sb.window.__ARISE_STORAGE_KEYS__.find("placementJD-v1").sensitive, "JD key marked non-sensitive");
}

// ------------------------------------------------------------------ result

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
