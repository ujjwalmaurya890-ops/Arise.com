// DOM smoke test: mounts the real hackathon-tracker-widget.js in jsdom (not
// just the extracted pure functions - the actual __mountHackathonTracker
// render/bindEvents cycle) and clicks through:
//   1. the delete -> undo-toast -> Undo flow, and the same flow left to
//      expire so the delete becomes permanent;
//   2. the Add-form duplicate-detection flow - Merge into existing,
//      Add anyway, and Cancel.
// Complements test-hackathon-tracker-widget.js (which exercises the pure
// scoring/dedup functions directly under a bare vm sandbox with no DOM).
// Run with: node test-hackathon-tracker-dom-smoke.js
"use strict";

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");

var dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://example.test/" });
var window = dom.window;
global.window = window;
global.document = window.document;
global.FormData = window.FormData;
global.localStorage = window.localStorage;
global.Blob = window.Blob;
global.URL = window.URL;
window.dispatchEvent = function () { return true; };

// ---- fake timers: the widget's undo-toast schedules a real setTimeout to
// finalize a delete after UNDO_WINDOW_MS (5s). Rather than actually waiting
// 5 real seconds, capture every scheduled timeout and let the test fire the
// undo-delete one on demand. ------------------------------------------------
var scheduled = [];
window.setTimeout = function (fn, ms) {
  var id = scheduled.length + 1;
  scheduled.push({ id: id, fn: fn, ms: ms, cleared: false });
  return id;
};
window.clearTimeout = function (id) {
  var t = scheduled.filter(function (t) { return t.id === id; })[0];
  if (t) t.cleared = true;
};
global.setTimeout = window.setTimeout;
global.clearTimeout = window.clearTimeout;
function fireLastUndoTimeout() {
  // The delete-undo timer is scheduled at 5000ms; other setTimeout(...,0)
  // calls in the widget (triggerDownload's URL.revokeObjectURL, the
  // copy-bullet icon revert) use a different delay, so filtering on ms
  // isolates the one we want even if other timers were scheduled first.
  var pending = scheduled.filter(function (t) { return t.ms === 5000 && !t.cleared; });
  var last = pending[pending.length - 1];
  if (!last) throw new Error("No pending 5000ms (undo-delete) timeout to fire");
  last.cleared = true;
  last.fn();
}

function loadScript(file) {
  var code = fs.readFileSync(path.join(__dirname, file), "utf8");
  window.eval(code);
}
loadScript("hackathon-tracker-widget.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

var root = window.document.getElementById("root");
window.__mountHackathonTracker(root);

function storedList() {
  var raw = window.localStorage.getItem("hackathonTrackerV1");
  return raw ? JSON.parse(raw) : [];
}
function click(el) {
  el.dispatchEvent(new window.Event("click", { bubbles: true, cancelable: true }));
}
function submit(form) {
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}
function openAddForm() {
  click(root.querySelector('[data-act="open-form"]'));
}
function fillAndSubmit(name, date, organizer) {
  openAddForm();
  var form = root.querySelector(".htw-form");
  form.querySelector('[name="name"]').value = name;
  form.querySelector('[name="date"]').value = date || "";
  if (organizer) form.querySelector('[name="organizer"]').value = organizer;
  submit(form);
}

// ============ baseline: adding a hackathon actually renders it ============

fillAndSubmit("Smart India Hackathon", "2026-03-10");
eq(storedList().length, 1, "DOM: submitting the Add form creates one stored record");
ok(root.innerHTML.indexOf("Smart India Hackathon") >= 0, "DOM: the new hackathon's name renders in the list");

// ============ delete -> undo toast -> Undo ============

var deleteBtn = root.querySelector('[data-act="delete"]');
ok(!!deleteBtn, "DOM: a delete button is rendered for the logged hackathon");
click(deleteBtn);

eq(storedList().length, 0, "DOM: clicking delete removes the record from storage immediately (no confirm dialog blocking it)");
ok(root.innerHTML.indexOf("htw-toast") >= 0, "DOM: an undo toast renders right after delete");
ok(root.innerHTML.indexOf('Deleted "Smart India Hackathon"') >= 0,
  "DOM: the toast names the deleted hackathon");

var undoBtn = root.querySelector('[data-act="undo-delete"]');
ok(!!undoBtn, "DOM: the toast has an Undo button");
click(undoBtn);

eq(storedList().length, 1, "DOM: clicking Undo restores the deleted record to storage");
ok(root.innerHTML.indexOf("htw-toast") === -1, "DOM: the toast is gone after Undo");
ok(root.innerHTML.indexOf("Smart India Hackathon") >= 0, "DOM: the restored hackathon is back in the rendered list");

// ============ delete -> toast expires -> permanent, Undo no longer works ============

click(root.querySelector('[data-act="delete"]'));
eq(storedList().length, 0, "DOM: (second delete) record removed from storage immediately");
ok(root.innerHTML.indexOf("htw-toast") >= 0, "DOM: (second delete) toast is showing again");

fireLastUndoTimeout();

eq(storedList().length, 0, "DOM: once the undo window elapses, the record stays deleted");
ok(root.innerHTML.indexOf("htw-toast") === -1, "DOM: the toast disappears once the undo window elapses");
ok(root.innerHTML.indexOf('data-act="undo-delete"') === -1, "DOM: there's no dangling Undo button once the toast is gone");

// ============ Add-form duplicate detection: Cancel keeps the form open ============

fillAndSubmit("HackNITR", "2026-01-15");
eq(storedList().length, 1, "DOM: (dup setup) first HackNITR entry logged normally");

fillAndSubmit("hacknitr", "2026-01-16"); // same name (case/space-insensitive), 1 day off -> should be flagged
eq(storedList().length, 1, "DOM: a fuzzy-duplicate submission does not create a second record right away");
ok(root.innerHTML.indexOf("This looks like a duplicate") >= 0, "DOM: the duplicate warning banner renders inside the form");
ok(root.querySelector('.htw-form') !== null, "DOM: the form stays open while the duplicate warning is showing");
var dupNameField = root.querySelector('.htw-form [name="name"]');
ok(!!dupNameField && dupNameField.value.toLowerCase() === "hacknitr",
  "DOM: the submitted (not-yet-saved) values are preserved while the warning is shown");

var dupCancelBtn = root.querySelector('[data-act="dup-cancel"]');
ok(!!dupCancelBtn, "DOM: duplicate warning offers a Cancel action");
click(dupCancelBtn);
eq(storedList().length, 1, "DOM: Cancel does not save anything");
ok(root.innerHTML.indexOf("This looks like a duplicate") === -1, "DOM: Cancel dismisses the warning banner");
ok(root.querySelector('.htw-form') !== null, "DOM: Cancel returns to the normal editable form (not closed)");
ok(root.querySelector('[data-act="cancel-form"]') !== null, "DOM: the normal Save/Cancel footer is back after dismissing the warning");

// ============ Add-form duplicate detection: Add anyway ============

var form2 = root.querySelector(".htw-form");
form2.querySelector('[name="name"]').value = "hacknitr";
form2.querySelector('[name="date"]').value = "2026-01-16";
submit(form2);
ok(root.innerHTML.indexOf("This looks like a duplicate") >= 0, "DOM: resubmitting the same near-duplicate re-triggers the warning");

var addAnywayBtn = root.querySelector('[data-act="dup-add-anyway"]');
ok(!!addAnywayBtn, "DOM: duplicate warning offers an Add anyway action");
click(addAnywayBtn);
eq(storedList().length, 2, "DOM: Add anyway saves it as a genuinely new second record");
ok(root.querySelector('.htw-form') === null, "DOM: the form closes after Add anyway");

// ============ Add-form duplicate detection: Merge into existing ============

fillAndSubmit("hacknitr", "2026-01-17"); // still within 3 days of one of the two HackNITR entries
ok(root.innerHTML.indexOf("This looks like a duplicate") >= 0, "DOM: a third near-duplicate submission is flagged too");

var mergeBtn = root.querySelector('[data-act="dup-merge"]');
ok(!!mergeBtn, "DOM: duplicate warning offers a Merge into existing action");
click(mergeBtn);
eq(storedList().length, 2, "DOM: Merge into existing does not create a third record");
ok(root.querySelector('.htw-form') === null, "DOM: the form closes after merging");

// ============ multi-select filter chips: OR within category, AND across ============

fillAndSubmit("Devfolio Buildathon", "2026-04-01", "Devfolio");
var formTech = root.querySelector(".htw-form");
if (formTech) { /* no-op: fillAndSubmit already submitted */ }
eq(storedList().length, 3, "DOM: (filter setup) three hackathons now logged for filter testing");

// Give the earlier two records distinct organizers too, via direct edit,
// so the organizer-chip group actually has something to select between.
(function () {
  var list = storedList();
  list.forEach(function (rec) {
    if (rec.name === "HackNITR" || /hacknitr/i.test(rec.name)) rec.organizer = rec.organizer || "NIT Rourkela";
  });
  window.localStorage.setItem("hackathonTrackerV1", JSON.stringify(list));
})();
window.__unmountHackathonTracker(root);
window.__mountHackathonTracker(root);

var orgChips = Array.prototype.slice.call(root.querySelectorAll('[data-act="filter-org"]'));
ok(orgChips.length >= 2, "DOM: at least two organizer filter chips render for the logged hackathons");

if (orgChips.length >= 2) {
  click(orgChips[0]);
  ok(orgChips[0] === root.querySelector('.htw-filter-chip-active') || root.querySelector('.htw-filter-chip-active') !== null,
    "DOM: clicking an organizer chip marks it active");
  var firstFilteredCount = root.querySelectorAll(".htw-row").length;

  // Re-query after re-render, click a second chip in the SAME group -
  // this is the multi-select behavior: it should ADD to the selection
  // (OR), not replace it, so the visible row count should not shrink
  // below what a single chip already showed (it should grow or stay level
  // since both chips are now active together).
  var orgChipsAfter = Array.prototype.slice.call(root.querySelectorAll('[data-act="filter-org"]'));
  var activeCount = root.querySelectorAll('.htw-filter-chip-active').length;
  eq(activeCount, 1, "DOM: exactly one organizer chip is active after selecting just one");

  if (orgChipsAfter.length >= 2) {
    click(orgChipsAfter[1]);
    var activeAfterSecond = root.querySelectorAll('[data-act="filter-org"].htw-filter-chip-active').length;
    eq(activeAfterSecond, 2, "DOM: clicking a second organizer chip keeps the first active too (multi-select, not replace)");
    var rowsWithBoth = root.querySelectorAll(".htw-row").length;
    ok(rowsWithBoth >= firstFilteredCount, "DOM: selecting a second organizer chip widens (or holds steady) the visible results, never narrows below one chip's results");
  }

  var clearBtn = root.querySelector('[data-act="filter-clear"]');
  if (clearBtn) click(clearBtn);
  eq(root.querySelectorAll('.htw-filter-chip-active').length, 0, "DOM: Clear filters removes all active chips");
}

// ============ bulk select + bulk delete + undo ============

eq(root.querySelectorAll(".htw-row").length, storedList().length, "DOM: (bulk setup) list is unfiltered again before bulk-select testing");

var rowChecks = Array.prototype.slice.call(root.querySelectorAll('[data-act="select-row"]'));
ok(rowChecks.length === storedList().length, "DOM: every row renders a select checkbox");
ok(root.querySelector('.htw-bulk-bar') === null, "DOM: the bulk action bar is hidden with nothing selected");

if (rowChecks.length >= 2) {
  rowChecks[0].checked = true;
  rowChecks[0].dispatchEvent(new window.Event("change", { bubbles: true, cancelable: true }));

  ok(root.querySelector('.htw-bulk-bar') !== null, "DOM: checking a row reveals the bulk action bar");
  ok(root.innerHTML.indexOf("1 selected") >= 0, "DOM: the bulk bar shows the correct selected count for one row");

  var rowChecksAfter = Array.prototype.slice.call(root.querySelectorAll('[data-act="select-row"]'));
  rowChecksAfter[1].checked = true;
  rowChecksAfter[1].dispatchEvent(new window.Event("change", { bubbles: true, cancelable: true }));
  ok(root.innerHTML.indexOf("2 selected") >= 0, "DOM: checking a second row updates the count to 2 selected");

  var beforeBulkDelete = storedList().length;
  var confirmCalls = 0;
  var originalConfirm = window.confirm;
  window.confirm = function () { confirmCalls++; return true; };

  var bulkDeleteBtn = root.querySelector('[data-act="bulk-delete"]');
  ok(!!bulkDeleteBtn, "DOM: the bulk bar has a Delete Selected button");
  click(bulkDeleteBtn);

  eq(confirmCalls, 1, "DOM: bulk delete asks for confirmation before removing anything");
  eq(storedList().length, beforeBulkDelete - 2, "DOM: bulk delete removes exactly the checked records");
  ok(root.innerHTML.indexOf("Deleted 2 hackathons") >= 0, "DOM: the undo toast reports the bulk-delete count, not a single name");
  ok(root.querySelector('.htw-bulk-bar') === null, "DOM: the bulk bar disappears once its selection has been deleted");

  var bulkUndoBtn = root.querySelector('[data-act="undo-delete"]');
  ok(!!bulkUndoBtn, "DOM: the bulk-delete toast has an Undo button too");
  click(bulkUndoBtn);
  eq(storedList().length, beforeBulkDelete, "DOM: undoing a bulk delete restores every record that was removed together");

  window.confirm = originalConfirm;
}

// ============ select-all checkbox ============

var selectAllBox = root.querySelector('[data-act="select-all"]');
ok(!!selectAllBox, "DOM: a select-all checkbox renders in the toolbar");
if (selectAllBox) {
  selectAllBox.checked = true;
  selectAllBox.dispatchEvent(new window.Event("change", { bubbles: true, cancelable: true }));
  var checkedCount = Array.prototype.slice.call(root.querySelectorAll('[data-act="select-row"]')).filter(function (c) { return c.checked; }).length;
  eq(checkedCount, storedList().length, "DOM: select-all checks every currently visible row");

  var selectAllAfter = root.querySelector('[data-act="select-all"]');
  selectAllAfter.checked = false;
  selectAllAfter.dispatchEvent(new window.Event("change", { bubbles: true, cancelable: true }));
  var checkedAfterUncheck = Array.prototype.slice.call(root.querySelectorAll('[data-act="select-row"]')).filter(function (c) { return c.checked; }).length;
  eq(checkedAfterUncheck, 0, "DOM: unchecking select-all clears every row's selection");
}

if (VERBOSE || fail) console.log((fail === 0 ? "PASS" : "FAIL") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
