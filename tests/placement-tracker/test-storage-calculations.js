// Minimal, dependency-free test harness for the Placement Tracker's storage
// and calculations layers (placement-storage.js / placement-calculations.js).
// These two files are plain `window.X = {...}` IIFEs with no DOM dependency,
// so they can be exercised directly under Node with a tiny localStorage +
// CustomEvent polyfill. Run with: node tests/test-storage-calculations.js
"use strict";

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

var fs = require("fs");
var path = require("path");
var vm = require("vm");

// ---- minimal browser polyfills ----
function makeLocalStorage() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
}

function CustomEvent(type, params) { this.type = type; this.detail = params && params.detail; }

var sandbox = {
  window: {},
  console: console,
  Date: Date,
  Math: Math,
  JSON: JSON,
  Object: Object,
  Array: Array
};
sandbox.window.localStorage = makeLocalStorage();
sandbox.window.CustomEvent = CustomEvent;
sandbox.window.dispatchEvent = function () {};
sandbox.window.addEventListener = function () {};
sandbox.localStorage = sandbox.window.localStorage;
sandbox.CustomEvent = CustomEvent;
vm.createContext(sandbox);

function load(file) {
  var code = fs.readFileSync(path.join(path.resolve(__dirname, "../.."), "src/features/placement-tracker", file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
}

load("placement-storage.js");
load("placement-calculations.js");

var storage = sandbox.window.ArisePlacementStorage;
var calc = sandbox.window.ArisePlacementCalculations;

// ---- tiny assert helpers ----
var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

// =========================================================================
// OLD behavior regression: generic upsert/load/save/remove/import/export
// still work for every entity, unaffected by the new interview-stage code.
// =========================================================================
(function regressionTests() {
  sandbox.window.localStorage.clear();
  var data = storage.load();
  ok(data && Array.isArray(data.applications), "load() returns a base shape with applications[]");
  ok(Array.isArray(data.sprintTasks), "load() still includes sprintTasks[] (Sprints tab untouched)");

  var task = storage.upsert(data, "sprintTasks", { title: "Ship feature", status: "In Progress" });
  ok(task.id && task.createdAt && task.updatedAt, "generic upsert() still stamps id/createdAt/updatedAt");
  data = storage.load();
  eq(data.sprintTasks.length, 1, "sprint task persisted via generic upsert()");

  storage.remove(data, "sprintTasks", task.id);
  data = storage.load();
  eq(data.sprintTasks.length, 0, "generic remove() still works");

  var exported = storage.exportData(storage.load());
  ok(exported.schemaVersion === 1 && exported.data, "exportData() still returns the expected envelope");
})();

// =========================================================================
// NEW: updateInterviewStage — captures stage changes + feedback rating
// =========================================================================
(function updateInterviewStageTests() {
  sandbox.window.localStorage.clear();
  var data = storage.load();

  // Creating a new application seeds stageHistory with its first status.
  var rec = storage.updateInterviewStage(data, null, { company: "Acme", role: "SDE Intern", status: "Interested" });
  ok(rec.id, "updateInterviewStage() assigns an id for new records (delegates to upsert)");
  eq(rec.stageHistory.length, 1, "new application seeds stageHistory with one entry");
  eq(rec.stageHistory[0].status, "Interested", "seeded stageHistory entry has the initial status");

  data = storage.load();

  // Advancing the stage appends a new history entry.
  rec = storage.updateInterviewStage(data, rec.id, {
    company: "Acme", role: "SDE Intern", status: "Technical Interview",
    interviewDate: "2026-08-10", interviewMode: "Online"
  });
  eq(rec.stageHistory.length, 2, "status change appends a new stageHistory entry");
  eq(rec.stageHistory[1].status, "Technical Interview", "latest stageHistory entry reflects the new status");
  eq(rec.stageHistory[1].interviewMode, "Online", "stageHistory entry captures interview mode");

  data = storage.load();

  // Re-saving the SAME status with no rating should NOT add a redundant entry.
  rec = storage.updateInterviewStage(data, rec.id, { company: "Acme", role: "SDE Intern", status: "Technical Interview" });
  eq(rec.stageHistory.length, 2, "unrelated re-save at the same stage does not duplicate history");

  data = storage.load();

  // Attaching feedback WITHOUT a status change still logs a snapshot (this is
  // the "feedback rating in updateInterviewStage" requirement).
  rec = storage.updateInterviewStage(data, rec.id, {
    company: "Acme", role: "SDE Intern", status: "Technical Interview", feedbackRating: "4"
  });
  eq(rec.stageHistory.length, 3, "feedback rating alone (same stage) still appends a history snapshot");
  eq(rec.stageHistory[2].feedbackRating, 4, "feedback rating is captured as a number on the history entry");
  eq(rec.feedbackRating, "4", "feedback rating is also saved on the record itself");

  data = storage.load();
  eq(data.applications.length, 1, "updateInterviewStage never creates duplicate application records");

  // REGRESSION GUARD: the edit form always re-submits the *already selected*
  // rating (selects are pre-filled from the record). A naive "is a rating
  // present" check would append a fresh timeline entry on every unrelated
  // save from then on — e.g. editing notes only. Verify that does NOT happen.
  rec = storage.updateInterviewStage(data, rec.id, {
    company: "Acme", role: "SDE Intern", status: "Technical Interview",
    feedbackRating: "4", notes: "Went well, waiting on HR round."
  });
  eq(rec.stageHistory.length, 3, "re-submitting the SAME feedback rating alongside a notes-only edit does not duplicate history");
  eq(rec.notes, "Went well, waiting on HR round.", "notes save correctly on a save that doesn't touch status or rating");

  // A genuinely CHANGED rating (same stage) should still log once, not duplicate.
  data = storage.load();
  rec = storage.updateInterviewStage(data, rec.id, { company: "Acme", role: "SDE Intern", status: "Technical Interview", feedbackRating: "5" });
  eq(rec.stageHistory.length, 4, "a changed feedback rating (same stage) appends exactly one new entry");
  eq(rec.stageHistory[3].feedbackRating, 5, "the new history entry reflects the updated rating");
})();

// =========================================================================
// NEW: Rejected / Offer ("Selected") stop further stage progression
// =========================================================================
(function terminalStageTests() {
  sandbox.window.localStorage.clear();
  var data = storage.load();

  var offerRec = storage.updateInterviewStage(data, null, { company: "Globex", status: "Final Round" });
  data = storage.load();
  offerRec = storage.updateInterviewStage(data, offerRec.id, { company: "Globex", status: "Offer" });
  eq(offerRec.status, "Offer", "application can reach the Offer (Selected) terminal status");
  data = storage.load();

  // Attempting to move it again (e.g. a stray/duplicate submit) must be a no-op on status.
  var afterAttempt = storage.updateInterviewStage(data, offerRec.id, { company: "Globex", status: "Withdrawn" });
  eq(afterAttempt.status, "Offer", "status cannot progress/change once an application has an Offer");
  eq(afterAttempt.stageHistory.length, offerRec.stageHistory.length, "blocked status-change attempt does not add a bogus history entry");

  // Notes/feedback should still be editable after the terminal status is reached.
  var afterNotesEdit = storage.updateInterviewStage(sandbox.window.ArisePlacementStorage.load(), offerRec.id, {
    company: "Globex", status: "Offer", notes: "Signed the offer letter.", feedbackRating: "5"
  });
  eq(afterNotesEdit.notes, "Signed the offer letter.", "notes remain editable after the application is terminal");
  eq(afterNotesEdit.status, "Offer", "status stays Offer while editing other fields");

  // Same check for Rejected.
  sandbox.window.localStorage.clear();
  data = storage.load();
  var rejRec = storage.updateInterviewStage(data, null, { company: "Initech", status: "Rejected" });
  data = storage.load();
  var afterRejAttempt = storage.updateInterviewStage(data, rejRec.id, { company: "Initech", status: "Applied" });
  eq(afterRejAttempt.status, "Rejected", "status cannot progress/change once an application is Rejected");
})();

// =========================================================================
// NEW: applicationAnalytics — total / OA cleared / interviews cleared /
// offers received / success rate
// =========================================================================
(function analyticsTests() {
  var list = [
    { status: "Interested" },
    { status: "Applied" },
    { status: "Online Assessment" },
    { status: "Technical Interview" },
    { status: "HR Interview" },
    { status: "Final Round" },
    { status: "Offer" },
    { status: "Offer" },
    { status: "Rejected" }
  ];
  var a = calc.applicationAnalytics(list);
  eq(a.total, 9, "analytics: total applications counts every record");
  eq(a.oaCleared, 5, "analytics: OA cleared counts Technical Interview and beyond (incl. Offer)");
  eq(a.interviewsCleared, 4, "analytics: interviews cleared counts HR Interview and beyond (incl. Offer)");
  eq(a.offers, 2, "analytics: offers received counts Offer-status records");
  // resolved = offers(2) + rejections(1) = 3; success = 2/3 -> 67%
  eq(a.successRate, 67, "analytics: success rate = offers / (offers + rejections)");

  var empty = calc.applicationAnalytics([]);
  eq(empty.successRate, 0, "analytics: success rate is 0 (not NaN) with no resolved applications");
})();

// =========================================================================
// NEW: interviewReminderDue — coarse, date-only reminder logic
// =========================================================================
(function reminderTests() {
  var today = new Date();
  function isoOffset(days) {
    var d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  ok(calc.interviewReminderDue({ interviewDate: isoOffset(0), reminderBefore: "1 day before" }, today),
    "reminder due: interview today with '1 day before' setting");
  ok(calc.interviewReminderDue({ interviewDate: isoOffset(1), reminderBefore: "1 day before" }, today),
    "reminder due: interview tomorrow with '1 day before' setting");
  ok(!calc.interviewReminderDue({ interviewDate: isoOffset(3), reminderBefore: "1 day before" }, today),
    "reminder NOT due: interview 3 days out with '1 day before' setting");
  ok(!calc.interviewReminderDue({ interviewDate: isoOffset(1), reminderBefore: "None" }, today),
    "reminder NOT due: reminderBefore is 'None'");
  ok(!calc.interviewReminderDue({ interviewDate: isoOffset(-1), reminderBefore: "2 days before" }, today),
    "reminder NOT due: interview date already passed");
  ok(!calc.interviewReminderDue({ reminderBefore: "1 day before" }, today),
    "reminder NOT due: no interviewDate set");
})();

if (VERBOSE || fail) console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
