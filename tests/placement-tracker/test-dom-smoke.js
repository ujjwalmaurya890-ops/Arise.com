// DOM smoke test: mounts the real Placement Tracker widget in jsdom, seeds
// application records that exercise every new code path (logo fallback,
// logo image, reminder banner, feedback rating stars, offer letter link,
// attachments toggle + mount, analytics panel, color-coded timeline), then
// asserts on the rendered HTML. Also exercises the Sprints tab (unaffected
// generic flow) and the interview-stage form submit path.
"use strict";

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

var fs = require("fs");
var path = require("path");
var { JSDOM } = require("jsdom");

var dom = new JSDOM("<!doctype html><html><body><div id=root></div></body></html>", { url: "https://example.test/" });
var window = dom.window;
global.window = window;
global.document = window.document;
global.CSS = window.CSS || { escape: function (s) { return String(s).replace(/[^a-zA-Z0-9_\-]/g, "\\$&"); } };
window.CSS = global.CSS;
global.FormData = window.FormData;
global.localStorage = window.localStorage;
// jsdom's dispatchEvent is picky about CustomEvent realms when scripts are
// injected via eval(); the app doesn't rely on this event firing for
// correctness (it's only a cross-widget "storage changed" signal), so stub it.
window.dispatchEvent = function () { return true; };

function loadScript(file) {
  var code = fs.readFileSync(path.join(path.resolve(__dirname, "../.."), "src/features/placement-tracker", file), "utf8");
  window.eval(code);
}

// A no-op local-files widget stub so the applications-tab mount condition
// (the thing we changed in render()) actually gets exercised end to end.
var mountedOwners = [];
window.__mountLocalFiles = function (el, ownerType, ownerId) {
  mountedOwners.push(ownerType + ":" + ownerId);
  el.innerHTML = '<div class="lf-stub">stub attachments for ' + ownerType + " " + ownerId + "</div>";
};

loadScript("placement-storage.js");
loadScript("placement-calculations.js");
loadScript("placement-tracker.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}

var root = document.getElementById("root");
window.__mountPlacementTracker(root);

// Seed data directly through storage + updateInterviewStage, the way the
// real form submit handler now does for the Applications tab.
var storage = window.ArisePlacementStorage;
var data = storage.load();

var withInterviewToday = storage.updateInterviewStage(data, null, {
  company: "Nimbus Systems", role: "Backend Intern",
  status: "Technical Interview",
  interviewDate: new Date().toISOString().slice(0, 10),
  reminderBefore: "1 day before", interviewMode: "Online",
  recruiterName: "Priya Shah", recruiterEmail: "priya@nimbus.test",
  feedbackRating: "4"
});
data = storage.load();

var withLogoAndOffer = storage.updateInterviewStage(data, null, {
  company: "Bluepeak Labs", role: "SDE-1",
  status: "Offer", logoUrl: "https://example.test/bluepeak-logo.png",
  ctcOffered: "14", offerLetterUrl: "https://example.test/offer.pdf",
  interviewMode: "Offline", officeLocation: "Bengaluru HQ"
});
data = storage.load();

// A plain, minimally-filled record to make sure nothing new is *required*.
storage.updateInterviewStage(data, null, { company: "Quietcorp", status: "Interested" });
data = storage.load();

// Also touch a sprint task to prove the Sprints/generic flow is untouched.
storage.upsert(data, "sprintTasks", { title: "Refactor auth", status: "In Progress" });

// Seeding above went straight through storage, bypassing the mounted widget's
// own submit handler (which always reloads `data` after saving), so re-mount
// to pick up the freshly seeded records — same as a real remount/tab switch.
window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("applications");

var html = root.innerHTML;

ok(html.indexOf("Nimbus Systems") >= 0, "renders application card for seeded company");
ok(html.indexOf("ptx-a-reminder") >= 0 && html.indexOf("Interview today") >= 0, "reminder banner renders for a same-day interview with reminderBefore set");
ok(html.indexOf("★★★★☆") >= 0, "feedback rating renders as stars (4/5)");
ok(html.indexOf('src="https://example.test/bluepeak-logo.png"') >= 0, "company logo <img> renders when logoUrl is set");
ok(html.indexOf("ptx-a-logo-fallback") >= 0, "initials-avatar fallback renders for companies without a logoUrl");
ok(html.indexOf('href="https://example.test/offer.pdf"') >= 0, "offer letter link renders when offerLetterUrl is set");
ok(html.indexOf("Pipeline Analytics") >= 0, "analytics panel renders on the Applications tab");
ok(html.indexOf("Color-coded Timeline") >= 0, "timeline section renders on the Applications tab");
ok(/style="[^"]*#22c55e/.test(html), "timeline/badges use the Offer stage color (#22c55e)");

// Attachments: toggle open for the Bluepeak record and confirm the local
// files widget gets mounted with the correct owner type/id.
var toggleBtn = root.querySelector('[data-toggle-files="' + withLogoAndOffer.id + '"]');
ok(!!toggleBtn, "attachments toggle button is present on an application card");
toggleBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
ok(mountedOwners.indexOf("application:" + withLogoAndOffer.id) >= 0, "render() mounts local-files widget with ownerType 'application' for the Applications tab");

// Sprints tab must still render via the untouched generic kanban path.
window.__ARISE_PLACEMENT_API__.open("sprints");
ok(root.innerHTML.indexOf("Refactor auth") >= 0, "Sprints tab still renders via the generic/unmodified kanban path");

// Editing the interview-stage record through the real form (not calling
// storage directly) should route through updateInterviewStage.
window.__ARISE_PLACEMENT_API__.open("applications", withInterviewToday.id);
var editBtn = root.querySelector('[data-edit="' + withInterviewToday.id + '"]');
editBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
var form = root.querySelector('[data-form="applications"]');
ok(!!form, "edit form opens for an application record");
form.querySelector('[name="status"]').value = "HR Interview";
form.querySelector('[name="feedbackRating"]').value = "5";
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

var savedRec = storage.load().applications.find(function (r) { return r.id === withInterviewToday.id; });
ok(savedRec.status === "HR Interview", "form submit updates status via updateInterviewStage");
ok(savedRec.stageHistory && savedRec.stageHistory.length === 2, "form submit appends a new stageHistory entry through the real submit handler");
ok(savedRec.stageHistory[savedRec.stageHistory.length - 1].feedbackRating === 5, "form submit carries the feedback rating into stageHistory");

// Editing the SAME record again without touching status/rating (only notes)
// must NOT create another stageHistory entry — "notes save correctly" /
// "no unnecessary rebuilds" of the timeline.
window.__ARISE_PLACEMENT_API__.open("applications", withInterviewToday.id);
editBtn = root.querySelector('[data-edit="' + withInterviewToday.id + '"]');
editBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
form = root.querySelector('[data-form="applications"]');
form.querySelector('[name="notes"]').value = "Great chat with the hiring manager.";
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
var afterNotesEdit = storage.load().applications.find(function (r) { return r.id === withInterviewToday.id; });
ok(afterNotesEdit.notes === "Great chat with the hiring manager.", "a notes-only edit saves the note correctly");
ok(afterNotesEdit.stageHistory.length === 2, "a notes-only edit does not append a spurious timeline entry (rating re-submit bug fixed)");

// ---- Rejected / Offer ("Selected") stop further progression ----
window.__ARISE_PLACEMENT_API__.open("applications", withInterviewToday.id);
editBtn = root.querySelector('[data-edit="' + withInterviewToday.id + '"]');
editBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
form = root.querySelector('[data-form="applications"]');
form.querySelector('[name="status"]').value = "Offer";
form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
var offeredRec = storage.load().applications.find(function (r) { return r.id === withInterviewToday.id; });
ok(offeredRec.status === "Offer", "application can be moved to Offer (Selected)");

window.__ARISE_PLACEMENT_API__.open("applications", withInterviewToday.id);
editBtn = root.querySelector('[data-edit="' + withInterviewToday.id + '"]');
editBtn.dispatchEvent(new window.Event("click", { bubbles: true }));
var statusField = root.querySelector('[data-form="applications"] [name="status"]');
ok(statusField.disabled === true, "status field is disabled in the edit form once an application reaches Offer");
ok(root.innerHTML.indexOf("pipeline stage is locked") >= 0, "a locked-stage explanation is shown once terminal");
ok(root.innerHTML.indexOf("🔒 Offer") >= 0, "the kanban badge shows a lock indicator for a terminal-status card");

// A disabled field is excluded from FormData, so submitting should leave the
// status untouched even if something else on the form changes.
root.querySelector('[data-form="applications"] [name="notes"]').value = "Signed and returned the offer letter.";
root.querySelector('[data-form="applications"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
var stillOffered = storage.load().applications.find(function (r) { return r.id === withInterviewToday.id; });
ok(stillOffered.status === "Offer", "status stays Offer after saving other fields (progression stopped)");
ok(stillOffered.notes === "Signed and returned the offer letter.", "other fields remain editable after the application is terminal");

if (VERBOSE || fail) console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
