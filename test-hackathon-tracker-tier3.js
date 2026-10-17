// Smoke test for the v154 "Tier-3 Reality Check" upgrade to
// hackathon-tracker-widget.js: normalizeRecord's new field clamps, the
// interview-mileage log helpers, and the five new pure computation
// functions (exposure split, fee-adjusted ROI, govt/SIH pipeline, OD
// summary, interview mileage), all exposed on the same
// window.__ARISE_HACKATHON_TRACKER_SCORING__ testing surface used by
// test-hackathon-tracker-widget.js.
// Run with: node test-hackathon-tracker-tier3.js
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

var sandbox = { console: console, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, URL: URL, setTimeout: function () { return 0; }, clearTimeout: function () {} };
sandbox.window = {};
sandbox.window.localStorage = makeLocalStorage();
sandbox.localStorage = sandbox.window.localStorage;
sandbox.document = { getElementById: function () { return null; } };
vm.createContext(sandbox);

var code = fs.readFileSync(path.join(__dirname, "hackathon-tracker-widget.js"), "utf8");
vm.runInContext(code, sandbox, { filename: "hackathon-tracker-widget.js" });

var scoring = sandbox.window.__ARISE_HACKATHON_TRACKER_SCORING__;

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

ok(typeof scoring.normalizeRecord === "function", "normalizeRecord is exposed");
ok(typeof scoring.addInterviewMention === "function", "addInterviewMention is exposed");
ok(typeof scoring.removeInterviewMention === "function", "removeInterviewMention is exposed");
ok(typeof scoring.computeExposureSplit === "function", "computeExposureSplit is exposed");
ok(typeof scoring.computeFeeAdjustedRoi === "function", "computeFeeAdjustedRoi is exposed");
ok(typeof scoring.computeGovtPipeline === "function", "computeGovtPipeline is exposed");
ok(typeof scoring.computeOdSummary === "function", "computeOdSummary is exposed");
ok(typeof scoring.computeInterviewMileage === "function", "computeInterviewMileage is exposed");
ok(typeof scoring.readAttendanceRiskSummary === "function", "readAttendanceRiskSummary is exposed");

// ============ normalizeRecord: new field clamps ============

(function () {
  var r = scoring.normalizeRecord({ id: "a", mode: "Offline", venueCity: "Bengaluru", registrationFee: "500",
    organizerType: "Government/PSU", problemStatementTheme: "Smart Agriculture", internalRoundStatus: "Nominated to Nationals",
    odStatus: "Requested", odNote: "Sent to HOD" });
  eq(r.mode, "Offline", "normalizeRecord: valid mode passes through");
  eq(r.venueCity, "Bengaluru", "normalizeRecord: venueCity passes through");
  eq(r.registrationFee, 500, "normalizeRecord: registrationFee coerces string to number");
  eq(r.organizerType, "Government/PSU", "normalizeRecord: valid organizerType passes through");
  eq(r.internalRoundStatus, "Nominated to Nationals", "normalizeRecord: valid internalRoundStatus passes through");
  eq(r.odStatus, "Requested", "normalizeRecord: valid odStatus passes through");
  eq(r.odNote, "Sent to HOD", "normalizeRecord: odNote passes through");
})();
(function () {
  var r = scoring.normalizeRecord({ id: "b", mode: "Remote", organizerType: "Startup", internalRoundStatus: "Won", odStatus: "Maybe" });
  eq(r.mode, "", "normalizeRecord: invalid mode falls back to ''");
  eq(r.organizerType, "", "normalizeRecord: invalid organizerType falls back to ''");
  eq(r.internalRoundStatus, "", "normalizeRecord: invalid internalRoundStatus falls back to ''");
  eq(r.odStatus, "", "normalizeRecord: invalid odStatus falls back to ''");
})();
(function () {
  var r = scoring.normalizeRecord({ id: "c" });
  eq(r.registrationFee, null, "normalizeRecord: missing registrationFee is null, not 0");
  ok(Array.isArray(r.interviewMentions) && r.interviewMentions.length === 0, "normalizeRecord: interviewMentions defaults to []");
})();
(function () {
  var r = scoring.normalizeRecord({ id: "d", interviewMentions: [{ company: "  Infosys  ", note: "asked about tech stack" }, { company: "" }, "garbage"] });
  eq(r.interviewMentions.length, 1, "normalizeRecord: interviewMentions drops entries with no company and non-object junk");
  eq(r.interviewMentions[0].company, "Infosys", "normalizeRecord: interviewMentions trims company name");
  ok(!!r.interviewMentions[0].id, "normalizeRecord: interviewMentions assigns an id when missing");
})();

// ============ addInterviewMention / removeInterviewMention ============

(function () {
  sandbox.window.localStorage.clear();
  scoring.saveAll([scoring.normalizeRecord({ id: "h1", name: "Smart India Hackathon" })]);
  scoring.addInterviewMention("h1", "TCS", "Asked how the sync conflict was resolved");
  var list = scoring.loadAll();
  eq(list[0].interviewMentions.length, 1, "addInterviewMention: appends a mention to the record");
  eq(list[0].interviewMentions[0].company, "TCS", "addInterviewMention: stores the company name");
  eq(list[0].interviewMentions[0].note, "Asked how the sync conflict was resolved", "addInterviewMention: stores the note");
})();
(function () {
  scoring.addInterviewMention("h1", "Infosys", "");
  var before = scoring.loadAll()[0].interviewMentions;
  eq(before.length, 2, "addInterviewMention: a second call appends rather than overwrites");
  var removeId = before[0].id;
  scoring.removeInterviewMention("h1", removeId);
  var after = scoring.loadAll()[0].interviewMentions;
  eq(after.length, 1, "removeInterviewMention: removes exactly the targeted mention");
  eq(after[0].company, "Infosys", "removeInterviewMention: leaves the other mention intact");
})();
(function () {
  scoring.addInterviewMention("h1", "   ", "blank company should be rejected");
  eq(scoring.loadAll()[0].interviewMentions.length, 1, "addInterviewMention: whitespace-only company is rejected, no-op");
})();
(function () {
  scoring.addInterviewMention("does-not-exist", "TCS", "");
  ok(true, "addInterviewMention: unknown id is a silent no-op, doesn't throw");
})();

// ============ computeExposureSplit ============

(function () {
  var r = scoring.computeExposureSplit([]);
  eq(r.offlinePct, null, "computeExposureSplit: empty list gives null offlinePct, not 0 or NaN");
})();
(function () {
  var list = [{ mode: "Online" }, { mode: "Online" }, { mode: "Offline" }, { mode: "" }];
  var r = scoring.computeExposureSplit(list);
  eq(r.online, 2, "computeExposureSplit: counts online correctly");
  eq(r.offline, 1, "computeExposureSplit: counts offline correctly");
  eq(r.offlinePct, 33, "computeExposureSplit: offlinePct is over known-mode entries only (1 of 3, not 1 of 4)");
})();

// ============ computeFeeAdjustedRoi ============

(function () {
  eq(scoring.computeFeeAdjustedRoi([{ hoursWorked: 0, prizeMoney: 1000 }]), null, "computeFeeAdjustedRoi: zero hours excluded, no crash / no result");
  eq(scoring.computeFeeAdjustedRoi([{ hoursWorked: 10 }]), null, "computeFeeAdjustedRoi: no prize or fee data returns null");
})();
(function () {
  var list = [
    { name: "Low net", hoursWorked: 10, prizeMoney: 1000, registrationFee: 800 },
    { name: "High net", hoursWorked: 10, prizeMoney: 5000, registrationFee: 200 }
  ];
  var r = scoring.computeFeeAdjustedRoi(list);
  eq(r.best.name, "High net", "computeFeeAdjustedRoi: picks the best net-of-fee rate, not raw prize money");
  eq(r.totalFees, 1000, "computeFeeAdjustedRoi: sums registration fees across all entries");
})();

// ============ computeGovtPipeline ============

(function () {
  eq(scoring.computeGovtPipeline([{ organizerType: "Corporate" }]), null, "computeGovtPipeline: no Government/PSU entries returns null");
})();
(function () {
  var list = [
    { organizerType: "Government/PSU", internalRoundStatus: "Nominated to Nationals", problemStatementTheme: "Smart Agriculture" },
    { organizerType: "Government/PSU", internalRoundStatus: "Not Selected" },
    { organizerType: "Corporate" }
  ];
  var r = scoring.computeGovtPipeline(list);
  eq(r.total, 2, "computeGovtPipeline: only counts Government/PSU entries");
  eq(r.counts["Nominated to Nationals"], 1, "computeGovtPipeline: buckets by internalRoundStatus");
  eq(r.themes.length, 1, "computeGovtPipeline: collects non-empty problem statement themes only");
})();

// ============ computeOdSummary ============

(function () {
  eq(scoring.computeOdSummary([{ mode: "Online" }]), null, "computeOdSummary: no offline entries returns null");
})();
(function () {
  var list = [{ mode: "Offline", odStatus: "Approved" }, { mode: "Offline", odStatus: "" }, { mode: "Offline" }, { mode: "Online" }];
  var r = scoring.computeOdSummary(list);
  eq(r.total, 3, "computeOdSummary: counts only offline entries");
  eq(r.missing, 2, "computeOdSummary: unset/blank odStatus counted as missing");
})();

// ============ computeInterviewMileage ============

(function () {
  var list = [
    { interviewMentions: [{ company: "TCS" }, { company: "Infosys" }] },
    { interviewMentions: [{ company: "TCS" }] },
    { interviewMentions: [] }
  ];
  var r = scoring.computeInterviewMileage(list);
  eq(r.total, 3, "computeInterviewMileage: total counts all records");
  eq(r.mentioned, 2, "computeInterviewMileage: mentioned counts only records with at least one mention");
  eq(r.companies.length, 2, "computeInterviewMileage: dedupes company names across records");
})();

// ============ readAttendanceRiskSummary ============

(function () {
  sandbox.window.localStorage.clear();
  eq(scoring.readAttendanceRiskSummary(), null, "readAttendanceRiskSummary: absent attendance data returns null, no throw");
})();
(function () {
  sandbox.window.localStorage.setItem("arise-attendance-tracker-v1", JSON.stringify({
    subjects: [{ id: "s1", attended: 60, total: 100 }, { id: "s2", attended: 90, total: 100 }]
  }));
  var r = scoring.readAttendanceRiskSummary();
  eq(r.totalSubjects, 2, "readAttendanceRiskSummary: counts total subjects from the attendance widget's storage");
  eq(r.risky, 1, "readAttendanceRiskSummary: flags only the subject below the 85% cutoff");
})();
(function () {
  sandbox.window.localStorage.setItem("arise-attendance-tracker-v1", "{not valid json");
  eq(scoring.readAttendanceRiskSummary(), null, "readAttendanceRiskSummary: malformed JSON degrades to null, doesn't throw");
})();

sandbox.window.localStorage.clear();

if (VERBOSE || fail) console.log((fail === 0 ? "PASS" : "FAIL") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
