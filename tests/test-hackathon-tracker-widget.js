// Smoke test for src/hackathon-tracker-widget.js — specifically the pure scoring
// helpers (computeScorePct, computeWeightedScore, xpBonusFactor) and the
// findDuplicateCandidate name+date fuzzy check, exposed for testing as
// window.__ARISE_HACKATHON_TRACKER_SCORING__. This is the biggest and most
// logic-heavy file in the project, so it gets the same dependency-free Node
// harness used for src/readiness-engine.js and src/storage-watch-bus.js.
// Run with: node tests/hackathon-tracker-widget.js
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

// The widget's top-level code only ever *reads* window/document/localStorage
// (e.g. "if (window.__ARISE_STORAGE_WATCH_BUS__)") - it never calls DOM
// APIs until __mountHackathonTracker(el) runs, so a minimal stub is enough
// to load the file and get at the exposed pure functions.
var sandbox = { console: console, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, URL: URL, setTimeout: function () { return 0; }, clearTimeout: function () {} };
sandbox.window = {};
sandbox.window.localStorage = makeLocalStorage();
sandbox.localStorage = sandbox.window.localStorage;
sandbox.document = { getElementById: function () { return null; } };
vm.createContext(sandbox);

var code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "src/hackathon-tracker-widget.js"), "utf8");
vm.runInContext(code, sandbox, { filename: "src/hackathon-tracker-widget.js" });

var scoring = sandbox.window.__ARISE_HACKATHON_TRACKER_SCORING__;

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

ok(!!scoring, "window.__ARISE_HACKATHON_TRACKER_SCORING__ is exposed");
ok(typeof scoring.computeScorePct === "function", "computeScorePct is a function");
ok(typeof scoring.computeWeightedScore === "function", "computeWeightedScore is a function");
ok(typeof scoring.xpBonusFactor === "function", "xpBonusFactor is a function");
ok(typeof scoring.findDuplicateCandidate === "function", "findDuplicateCandidate is a function");

// ============ computeScorePct ============

(function () {
  eq(scoring.computeScorePct({ rank: 1, totalTeams: 100 }), 100, "computeScorePct: rank #1 of N scores 100");
})();
(function () {
  var pct = scoring.computeScorePct({ rank: 50, totalTeams: 100 });
  near(pct, 50.5, 0.6, "computeScorePct: mid-pack rank/totalTeams gives a proportional score");
})();
(function () {
  // Last place still gets a sliver of credit (1/totalTeams) rather than a
  // hard 0 - use near() to sidestep floating-point noise in the division.
  near(scoring.computeScorePct({ rank: 100, totalTeams: 100 }), 1, 0.01, "computeScorePct: last place of N scores ~1, not a hard 0");
})();
(function () {
  // No totalTeams -> falls back to rank tiers.
  eq(scoring.computeScorePct({ rank: 1 }), 100, "computeScorePct: rank tier - #1 with no totalTeams is 100");
  eq(scoring.computeScorePct({ rank: 3 }), 85, "computeScorePct: rank tier - #3 with no totalTeams is 85");
  eq(scoring.computeScorePct({ rank: 10 }), 60, "computeScorePct: rank tier - #10 with no totalTeams is 60");
  eq(scoring.computeScorePct({ rank: 50 }), 35, "computeScorePct: rank tier - #50 with no totalTeams is 35");
})();
(function () {
  eq(scoring.computeScorePct({}), null, "computeScorePct: no rank at all returns null, not 0");
  eq(scoring.computeScorePct({ rank: 0 }), null, "computeScorePct: rank 0 (invalid/unranked) returns null");
})();

// ============ computeWeightedScore ============

(function () {
  eq(scoring.computeWeightedScore({}), null, "computeWeightedScore: a completely empty record scores null, not 0/NaN");
})();
(function () {
  // Only a satisfaction score present - single-part weighted average should
  // just equal that part's normalized score.
  var s = scoring.computeWeightedScore({ satisfaction: 10 });
  eq(s, 100, "computeWeightedScore: satisfaction alone at 10/10 scores 100");
  var s2 = scoring.computeWeightedScore({ satisfaction: 5 });
  eq(s2, 50, "computeWeightedScore: satisfaction alone at 5/10 scores 50");
})();
(function () {
  // A maxed-out record across every scored dimension should hit 100.
  var rec = {
    rank: 1, totalTeams: 50,
    teamMembers: 4,
    technologiesUsed: 'React, Node.js, MongoDB, Docker',
    hoursWorked: 36,
    satisfaction: 10
  };
  eq(scoring.computeWeightedScore(rec), 100, "computeWeightedScore: an ideal-on-every-axis record scores 100");
})();
(function () {
  var out = scoring.computeWeightedScore({ satisfaction: -5 });
  ok(out >= 0 && out <= 100, "computeWeightedScore: stays within [0,100] even with an out-of-range satisfaction input");
})();

// ============ xpBonusFactor ============

(function () {
  eq(scoring.xpBonusFactor({ position: '' }), 0, "xpBonusFactor: plain participation (no position, no prize) is 0");
  eq(scoring.xpBonusFactor({ position: 'Finalist' }), 10, "xpBonusFactor: Finalist alone is 10");
  eq(scoring.xpBonusFactor({ position: 'Winner' }), 20, "xpBonusFactor: Winner alone is 20");
  eq(scoring.xpBonusFactor({ position: 'Winner', prizeMoney: 5000 }), 25, "xpBonusFactor: Winner + prize money is 20+5=25");
  eq(scoring.xpBonusFactor({ position: 'Winner', prizeMoney: 0 }), 20, "xpBonusFactor: zero prize money doesn't add the +5");
  eq(scoring.xpBonusFactor({ position: 'Participant', prizeMoney: 1000 }), 5, "xpBonusFactor: prize money alone (no outcome position) still adds +5");
})();
(function () {
  // Factor is capped at 25 even if future position tiers push it higher.
  var f = scoring.xpBonusFactor({ position: 'Winner', prizeMoney: 999999 });
  ok(f <= 25, "xpBonusFactor: result never exceeds the 25 cap");
})();

// ============ findDuplicateCandidate ============

(function () {
  var list = [{ id: 'a1', name: 'Smart India Hackathon', date: '2026-03-10' }];
  var dup = scoring.findDuplicateCandidate(list, 'Smart India Hackathon', '2026-03-10', null);
  ok(!!dup && dup.id === 'a1', "findDuplicateCandidate: exact name+date match is flagged as a duplicate");
})();
(function () {
  var list = [{ id: 'a1', name: '  smart  india   hackathon  ', date: '2026-03-10' }];
  var dup = scoring.findDuplicateCandidate(list, 'Smart India Hackathon', '2026-03-11', null);
  ok(!!dup && dup.id === 'a1', "findDuplicateCandidate: case/whitespace differences and a 1-day date gap still match");
})();
(function () {
  var list = [{ id: 'a1', name: 'Smart India Hackathon', date: '2026-03-10' }];
  var dup = scoring.findDuplicateCandidate(list, 'Smart India Hackathon', '2027-03-10', null);
  eq(dup, null, "findDuplicateCandidate: same name a year apart (>3 days) is not flagged");
})();
(function () {
  var list = [{ id: 'a1', name: 'HackNITR', date: '2026-01-01' }];
  var dup = scoring.findDuplicateCandidate(list, 'Something Else', '2026-01-01', null);
  eq(dup, null, "findDuplicateCandidate: same date but a different name is not flagged");
})();
(function () {
  var list = [{ id: 'a1', name: 'HackNITR', date: '' }];
  var dup = scoring.findDuplicateCandidate(list, 'HackNITR', '2026-01-01', null);
  ok(!!dup && dup.id === 'a1', "findDuplicateCandidate: same name with one side missing a date still flags (can't rule it out)");
})();
(function () {
  var list = [{ id: 'a1', name: 'HackNITR', date: '2026-01-01' }];
  var dup = scoring.findDuplicateCandidate(list, 'HackNITR', '2026-01-01', 'a1');
  eq(dup, null, "findDuplicateCandidate: excludeId keeps a record from matching itself (editing in place)");
})();
(function () {
  eq(scoring.findDuplicateCandidate([{ id: 'a1', name: 'X', date: '2026-01-01' }], '', '2026-01-01', null), null,
    "findDuplicateCandidate: an empty submitted name never matches anything");
})();

// ============ mergeImportedRows: import-time duplicate merging ============

(function () {
  sandbox.window.localStorage.clear();
  var first = scoring.mergeImportedRows([
    { name: 'Smart India Hackathon', date: '2026-03-10', organizer: 'MIC' }
  ]);
  eq(first.added, 1, "mergeImportedRows: first row with no id and no existing match is added");
  eq(first.merged, 0, "mergeImportedRows: nothing to merge on the very first import");

  // Re-import an overlapping export with no ids (e.g. a fresh CSV pull) -
  // same name, date one day off. Should merge into the existing record
  // instead of creating a second one.
  var second = scoring.mergeImportedRows([
    { name: '  smart india hackathon ', date: '2026-03-11', organizer: 'MIC', projectDescription: 'Updated after import' }
  ]);
  eq(second.added, 0, "mergeImportedRows: a fuzzy-duplicate row is not added as new");
  eq(second.merged, 1, "mergeImportedRows: a fuzzy-duplicate row is merged instead");

  var all = scoring.loadAll();
  eq(all.length, 1, "mergeImportedRows: merging keeps a single record, not two");
  eq(all[0].projectDescription, 'Updated after import', "mergeImportedRows: merge applies the incoming row's fields onto the existing record");
})();

(function () {
  sandbox.window.localStorage.clear();
  var r = scoring.mergeImportedRows([{ id: 'fixed-1', name: 'HackNITR', date: '2026-02-01' }]);
  eq(r.added, 1, "mergeImportedRows: a row with an explicit id is added on first import");
  var r2 = scoring.mergeImportedRows([{ id: 'fixed-1', name: 'HackNITR (renamed)', date: '2026-02-01' }]);
  eq(r2.updated, 1, "mergeImportedRows: a matching explicit id is a straight update, not a fuzzy merge");
  eq(r2.merged, 0, "mergeImportedRows: exact id match doesn't also count as merged");
})();

(function () {
  sandbox.window.localStorage.clear();
  scoring.mergeImportedRows([{ name: 'HackNITR', date: '2026-02-01' }]);
  var r = scoring.mergeImportedRows([{ name: 'Totally Different Event', date: '2026-02-01' }]);
  eq(r.added, 1, "mergeImportedRows: a same-date but different-named row is added, not merged");
  eq(scoring.loadAll().length, 2, "mergeImportedRows: unrelated rows stay as separate records");
})();

(function () {
  // Two fuzzy-duplicate rows arriving in the *same* import batch (no prior
  // records at all) should collapse into one record, not two.
  sandbox.window.localStorage.clear();
  var r = scoring.mergeImportedRows([
    { name: 'Devfolio Buildathon', date: '2026-05-01' },
    { name: 'devfolio buildathon', date: '2026-05-02' }
  ]);
  eq(r.added, 1, "mergeImportedRows: within one batch, the first fuzzy-duplicate row is added");
  eq(r.merged, 1, "mergeImportedRows: within one batch, the second fuzzy-duplicate row merges into the first");
  eq(scoring.loadAll().length, 1, "mergeImportedRows: intra-batch duplicates collapse to a single stored record");
})();

// ============ applyFilters: multi-select chips (OR within a category, AND across) ============

(function () {
  var list = [
    { id: 'a', name: 'Smart India Hackathon', organizer: 'MIC', date: '2025-03-10', technologiesUsed: 'React, Node.js' },
    { id: 'b', name: 'HackNITR', organizer: 'NIT Rourkela', date: '2025-06-01', technologiesUsed: 'Python, Flask' },
    { id: 'c', name: 'Devfolio Buildathon', organizer: 'Devfolio', date: '2024-11-20', technologiesUsed: 'React, MongoDB' }
  ];

  var out1 = scoring.applyFilters(list, { filterOrg: ['mic'], filterTech: [], filterYear: [] });
  eq(out1.length, 1, "applyFilters: a single selected organizer narrows to just that org's hackathons");
  eq(out1[0].id, 'a', "applyFilters: single-org filter picks the right record");

  var out2 = scoring.applyFilters(list, { filterOrg: ['mic', 'nit rourkela'], filterTech: [], filterYear: [] });
  eq(out2.length, 2, "applyFilters: two selected organizers are OR'd together (either one matches)");

  var out3 = scoring.applyFilters(list, { filterOrg: [], filterTech: ['react'], filterYear: ['2025'] });
  eq(out3.length, 1, "applyFilters: tech AND year across categories narrows correctly (2025 AND React)");
  eq(out3[0].id, 'a', "applyFilters: the 2025+React combination picks the one record satisfying both");

  var out4 = scoring.applyFilters(list, { filterTech: ['react'], filterOrg: [], filterYear: [] });
  eq(out4.length, 2, "applyFilters: a single tech filter alone is OR'd across matching records (a and c both used React)");

  var out5 = scoring.applyFilters(list, { filterOrg: [], filterTech: [], filterYear: [] });
  eq(out5.length, 3, "applyFilters: no filters selected returns everything");

  var out6 = scoring.applyFilters(list, { filterOrg: ['mic'], filterTech: ['python'], filterYear: [] });
  eq(out6.length, 0, "applyFilters: an org AND a tech that don't co-occur on any record yields nothing");
})();

// ============ reinsertDeletedItems: bulk-delete undo restores original order ============

(function () {
  ok(typeof scoring.reinsertDeletedItems === "function", "reinsertDeletedItems is a function");
})();
(function () {
  // Three records; delete the middle two (indices 1 and 2) in one bulk
  // action, then undo - they should land back exactly where they were.
  var full = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  var remaining = [{ id: 'a' }, { id: 'd' }]; // b and c removed
  var removed = [{ rec: { id: 'b' }, index: 1 }, { rec: { id: 'c' }, index: 2 }];
  var restored = scoring.reinsertDeletedItems(remaining, removed);
  eq(restored.map(function (x) { return x.id; }).join(','), 'a,b,c,d',
    "reinsertDeletedItems: a contiguous bulk delete restores to the exact original order");
})();
(function () {
  // Non-contiguous bulk delete: remove index 0 and index 3 out of 4, then
  // undo both at once - order should still come back correctly regardless
  // of which order the two items are passed in.
  var remaining = [{ id: 'b' }, { id: 'c' }];
  var removed = [{ rec: { id: 'd' }, index: 3 }, { rec: { id: 'a' }, index: 0 }]; // deliberately out of order
  var restored = scoring.reinsertDeletedItems(remaining, removed);
  eq(restored.map(function (x) { return x.id; }).join(','), 'a,b,c,d',
    "reinsertDeletedItems: non-contiguous bulk delete restores correctly even if items arrive unsorted");
})();
(function () {
  // Single-row delete (the pre-existing path) is just the 1-item case of
  // the same helper - confirm it still works standalone.
  var remaining = [{ id: 'a' }, { id: 'c' }];
  var removed = [{ rec: { id: 'b' }, index: 1 }];
  var restored = scoring.reinsertDeletedItems(remaining, removed);
  eq(restored.map(function (x) { return x.id; }).join(','), 'a,b,c',
    "reinsertDeletedItems: single-item undo (the original delete-button path) still works");
})();
(function () {
  // Deleting everything and undoing should return the list to its full,
  // correctly-ordered state.
  var removed = [{ rec: { id: 'a' }, index: 0 }, { rec: { id: 'b' }, index: 1 }, { rec: { id: 'c' }, index: 2 }];
  var restored = scoring.reinsertDeletedItems([], removed);
  eq(restored.map(function (x) { return x.id; }).join(','), 'a,b,c',
    "reinsertDeletedItems: undoing a bulk delete of an entire list restores it in full");
})();

sandbox.window.localStorage.clear();

if (VERBOSE || fail) console.log((fail === 0 ? "PASS" : "FAIL") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
