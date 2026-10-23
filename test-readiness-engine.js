// Smoke test for readiness-engine.js — specifically computeComposite(), the
// scoring function every "readiness" widget (readiness-50lpa-widget,
// ai-career-mentor-widget, placement-calculations) calls into. This is a
// pure, dependency-free IIFE (window.__READINESS_ENGINE__), so it can be
// exercised directly under Node with a tiny window/localStorage polyfill.
// Run with: node test-readiness-engine.js
"use strict";

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function makeLocalStorage() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
}

var sandbox = { console: console, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array };
sandbox.window = {};
sandbox.window.localStorage = makeLocalStorage();
sandbox.localStorage = sandbox.window.localStorage;
vm.createContext(sandbox);

var code = fs.readFileSync(path.join(__dirname, "readiness-engine.js"), "utf8");
vm.runInContext(code, sandbox, { filename: "readiness-engine.js" });

var engine = sandbox.window.__READINESS_ENGINE__;

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}
function near(actual, expected, tol, msg) {
  ok(typeof actual === "number" && Math.abs(actual - expected) <= tol,
    msg + " (expected ~" + expected + " +/-" + tol + ", got " + JSON.stringify(actual) + ")");
}

ok(!!engine, "window.__READINESS_ENGINE__ is exposed");
ok(typeof engine.computeComposite === "function", "computeComposite is a function");
ok(typeof engine.computeReadinessV2 === "function", "computeReadinessV2 is a function");
ok(typeof engine.explainComposite === "function", "explainComposite is a function");

// --- computeComposite: basic weighted average, no penalties/bonuses ---
(function () {
  var scores = { dsa: 80, aptitude: 60 };
  var weights = { dsa: 50, aptitude: 50 };
  var r = engine.computeComposite(scores, weights, {}, {});
  near(r.overall, 70, 1, "computeComposite: equal-weight average of 80/60 is ~70");
  eq(r.missing.dsa, false, "computeComposite: present factor is not flagged missing");
  eq(r.missing.aptitude, false, "computeComposite: present factor is not flagged missing");
  eq(r.missingPenalty, 0, "computeComposite: no penalty when nothing is missing");
  eq(r.bonus, 0, "computeComposite: no bonus when no achievements passed");
})();

// --- computeComposite: null/undefined score is treated as missing and penalized ---
(function () {
  var scores = { dsa: 90, aptitude: null };
  var weights = { dsa: 50, aptitude: 50 };
  var r = engine.computeComposite(scores, weights, {}, {});
  eq(r.missing.aptitude, true, "computeComposite: null score is flagged missing");
  eq(r.factors.aptitude, 0, "computeComposite: missing factor scores 0, not null");
  ok(r.missingPenalty > 0, "computeComposite: missing factor incurs a penalty");
  ok(r.overall < 45, "computeComposite: overall drops well below the raw 90/2 average once penalized");
})();

// --- computeComposite: scores are clamped to [0,100] even if input is out of range ---
(function () {
  var r = engine.computeComposite({ dsa: 150, aptitude: -20 }, { dsa: 50, aptitude: 50 }, {}, {});
  eq(r.factors.dsa, 100, "computeComposite: score >100 is clamped to 100");
  eq(r.factors.aptitude, 0, "computeComposite: score <0 is clamped to 0");
})();

// --- computeComposite: diminishing returns above threshold pull the score down ---
(function () {
  var cfg = { diminishingReturns: { threshold: 70, retainedFraction: 0.5 } };
  var r = engine.computeComposite({ dsa: 100 }, { dsa: 100 }, cfg, {});
  // raw=100, 30 pts over the 70 threshold retained at 50% -> 70+15=85
  near(r.afterDiminishingReturns, 85, 0.5, "computeComposite: diminishing returns caps a maxed-out factor");
  ok(r.overall <= 100 && r.overall >= 0, "computeComposite: overall stays within [0,100] after DR");
})();

// --- computeComposite: achievement bonus is added and capped at maxBonus ---
(function () {
  var cfg = { bonuses: { perAchievementRarity: { Common: 1, Legendary: 10 }, maxBonus: 10 } };
  var opts = { achievements: [{ unlocked: true, rarity: "Legendary" }, { unlocked: true, rarity: "Legendary" }, { unlocked: false, rarity: "Legendary" }] };
  var r = engine.computeComposite({ dsa: 50 }, { dsa: 100 }, cfg, opts);
  eq(r.bonus, 10, "computeComposite: bonus from two unlocked Legendary achievements is capped at maxBonus, not summed to 20");
})();

// --- computeComposite: empty weights don't divide by zero ---
(function () {
  var r = engine.computeComposite({}, {}, {}, {});
  eq(r.overall, 0, "computeComposite: no weights at all -> overall is 0, not NaN");
  ok(isFinite(r.overall), "computeComposite: overall is finite with empty input");
})();

// --- explainComposite: sanity check it doesn't throw and returns notes for a penalized run ---
(function () {
  var r = engine.computeComposite({ dsa: 90, aptitude: null }, { dsa: 50, aptitude: 50 }, {}, {});
  var notes = engine.explainComposite(r);
  ok(Array.isArray(notes), "explainComposite: returns an array");
  ok(notes.some(function (n) { return /missing/i.test(n); }), "explainComposite: mentions the missing factor");
  eq(engine.explainComposite(null), null, "explainComposite: null input returns null instead of throwing");
})();

if (VERBOSE || fail) console.log((fail === 0 ? "PASS" : "FAIL") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
