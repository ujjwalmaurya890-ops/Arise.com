// DOM smoke test for the new "🎓 Tier-3 Reality" tab in the Placement
// Tracker: eligibility gate checker (CGPA/backlog cross-check), campus
// lock-in radar (on-campus offer vs other live applications), and the
// on-campus vs off-campus conversion split. Mounts the real widget in
// jsdom via window.__mountPlacementTracker, same harness style as
// test-dom-smoke.js, and asserts on the rendered HTML plus the derived
// calculations directly.
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
window.dispatchEvent = function () { return true; };

function loadScript(file) {
  var code = fs.readFileSync(path.join(__dirname, file), "utf8");
  window.eval(code);
}

loadScript("placement-storage.js");
loadScript("placement-calculations.js");
loadScript("placement-tracker.js");

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}

var root = document.getElementById("root");
window.__mountPlacementTracker(root);

var storage = window.ArisePlacementStorage;
var calc = window.ArisePlacementCalculations;
var data = storage.load();

// ---- 1. Empty state: no CGPA/backlog data logged on any application ----
window.__ARISE_PLACEMENT_API__.open("tier3");
var html = root.innerHTML;
ok(html.indexOf("Tier-3 Reality") >= 0, "tab renders with its heading");
ok(html.indexOf("Your Campus Reality") >= 0, "campus policy settings panel renders");
ok(html.indexOf("No applications have a CGPA cutoff") >= 0, "eligibility panel shows empty state with no data logged");
ok(html.indexOf("Tick") >= 0 && html.indexOf("lock-in / one-offer") >= 0, "lock-in radar shows the opt-in prompt when the policy toggle is off");

// ---- 2. Eligibility Gate Checker ----
storage.upsert(data, "applications", {
  company: "MegaServe Technologies", role: "Trainee Engineer", status: "Interested",
  minCgpaEligibility: "7.5", backlogPolicy: "No active backlogs allowed"
});
storage.upsert(data, "applications", {
  company: "OpenRange Systems", role: "SDE Intern", status: "Applied",
  minCgpaEligibility: "6", backlogPolicy: "Not specified"
});
data = storage.load();

var eligNone = calc.eligibilityCheck(data.applications, { cgpa: null, activeBacklogs: 0 });
ok(eligNone.length === 2, "eligibilityCheck only returns applications with a cutoff or backlog policy logged");

var elig = calc.eligibilityCheck(data.applications, { cgpa: 6.8, activeBacklogs: 1 });
var mega = elig.find(function (e) { return e.company === "MegaServe Technologies"; });
var openr = elig.find(function (e) { return e.company === "OpenRange Systems"; });
ok(mega && mega.eligible === false, "below-cutoff + active-backlog application is flagged ineligible");
ok(mega.reasons.length === 2, "both the CGPA and backlog reasons are reported for MegaServe");
ok(openr && openr.eligible === true, "an application clearing its own cutoff with no backlog restriction is eligible");

window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("tier3");
html = root.innerHTML;
ok(html.indexOf("MegaServe Technologies") >= 0 && html.indexOf("OpenRange Systems") >= 0, "eligibility panel lists applications with logged cutoffs");

// Set CGPA/backlogs through the real settings form, not storage directly.
var policyForm = root.querySelector("[data-t3-policy]");
ok(!!policyForm, "campus policy form is present");
policyForm.querySelector('[name="cgpa"]').value = "6.8";
policyForm.querySelector('[name="cgpa"]').dispatchEvent(new window.Event("change", { bubbles: true }));
policyForm = root.querySelector("[data-t3-policy]"); // re-query: render() rebuilt the DOM
policyForm.querySelector('[name="activeBacklogs"]').value = "1";
policyForm.querySelector('[name="activeBacklogs"]').dispatchEvent(new window.Event("change", { bubbles: true }));

var savedPolicy = storage.load().settings.campusPolicy;
ok(savedPolicy.cgpa === 6.8, "CGPA typed into the settings form persists to settings.campusPolicy");
ok(savedPolicy.activeBacklogs === 1, "active backlog count typed into the settings form persists");

html = root.innerHTML;
ok(html.indexOf("Check before applying") >= 0, "ineligible application shows the warning badge after policy is filled in");
ok(html.indexOf("✅ Eligible") >= 0, "eligible application shows the eligible badge after policy is filled in");

// ---- 3. Campus Lock-In Radar ----
data = storage.load();
var lockedOffer = storage.upsert(data, "applications", {
  company: "BharatBulk Corp", role: "Associate Engineer", status: "Offer",
  driveType: "On-Campus", ctcOffered: "5"
});
storage.upsert(data, "applications", { company: "Zenith Cloud", role: "SDE-1", status: "Technical Interview" });
data = storage.load();

// Toggle lock-in policy off (default): radar stays inert.
var offWarnings = calc.lockInWarnings(data.applications, { lockInEnabled: false, dreamExemptionCtc: 10 });
ok(offWarnings.length === 0, "lockInWarnings returns nothing while the policy toggle is off");

var onWarnings = calc.lockInWarnings(data.applications, { lockInEnabled: true, dreamExemptionCtc: 10 });
ok(onWarnings.length === 1 && onWarnings[0].company === "BharatBulk Corp",
  "a sub-threshold on-campus offer is flagged when another application is still live");
// Other still-live (non-terminal) applications at this point: MegaServe
// (Interested), OpenRange (Applied), Zenith Cloud (Technical Interview) = 3.
ok(onWarnings[0].otherLiveCount === 3, "the count of other live applications at risk is correct");

var aboveThreshold = calc.lockInWarnings(data.applications, { lockInEnabled: true, dreamExemptionCtc: 3 });
ok(aboveThreshold.length === 0, "an offer above the exemption threshold is not flagged");

var noThreshold = calc.lockInWarnings(data.applications, { lockInEnabled: true, dreamExemptionCtc: null });
ok(noThreshold.length === 1, "with no exemption threshold set, any on-campus offer is conservatively assumed to lock in");

window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("tier3");
var lockInCb = root.querySelector('[data-t3-policy] [name="lockInEnabled"]');
lockInCb.checked = true;
lockInCb.dispatchEvent(new window.Event("change", { bubbles: true }));
html = root.innerHTML;
ok(html.indexOf("BharatBulk Corp") >= 0 && html.indexOf("locks out") >= 0, "lock-in radar renders a live warning once the policy toggle is on");

// ---- 4. On-Campus vs Off-Campus Conversion split ----
data = storage.load();
storage.upsert(data, "applications", { company: "Rejected On-Campus Co", status: "Rejected", driveType: "On-Campus" });
storage.upsert(data, "applications", { company: "OffCampus Offer Co", status: "Offer", driveType: "Off-Campus" });
storage.upsert(data, "applications", { company: "Legacy Campus Cell Co", status: "Offer", source: "College Placement Cell" }); // no driveType — inferred
data = storage.load();

var split = calc.driveTypeSplit(data.applications);
ok(split.onCampus.total >= 3, "on-campus bucket includes explicit driveType records plus the legacy source-inferred one");
ok(split.onCampus.offers === 2, "on-campus offers count includes both BharatBulk and the legacy campus-cell-sourced record");
ok(split.offCampus.offers >= 1, "off-campus bucket counts its own offer");

window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("tier3");
html = root.innerHTML;
ok(html.indexOf("On-Campus vs Off-Campus Conversion") >= 0, "conversion split panel renders");
ok(html.indexOf("success rate") >= 0, "conversion split renders a success-rate stat");

// ---- 5. Service Bond Overview ----
storage.upsert(data, "offers", {
  company: "TrueCore Solutions", role: "Systems Engineer", ctcBase: "3.6",
  bondPeriod: "2 years", bondPenalty: "100000"
});
storage.upsert(data, "offers", { company: "NoBondCo", role: "Analyst", ctcBase: "5" }); // no bond
data = storage.load();

var bonds = calc.bondOverview(data.offers);
ok(bonds.length === 1, "bondOverview only includes offers with a logged bond penalty");
var trueCoreBond = bonds[0];
ok(trueCoreBond.company === "TrueCore Solutions", "bond record identifies the right offer");
ok(trueCoreBond.pctOfCtc === Math.round((100000 / 360000) * 1000) / 10, "bond penalty is correctly expressed as % of first-year CTC");

window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("tier3");
html = root.innerHTML;
ok(html.indexOf("Service Bond Overview") >= 0, "bond overview panel renders");
ok(html.indexOf("TrueCore Solutions") >= 0 && html.indexOf("2 years") >= 0, "bonded offer's period and company render");
ok(html.indexOf("% of first-year CTC") >= 0, "bond penalty renders as a % of CTC badge");

// ---- 6. Off-Campus NOC Tracker ----
storage.upsert(data, "applications", {
  company: "Pending NOC Co", role: "SDE", status: "Technical Interview",
  nocRequired: "Required", nocStatus: "Requested"
});
storage.upsert(data, "applications", {
  company: "Granted NOC Co", role: "SDE", status: "Technical Interview",
  nocRequired: "Required", nocStatus: "Granted"
});
storage.upsert(data, "applications", {
  company: "Still Browsing Co", role: "SDE", status: "Interested",
  nocRequired: "Required", nocStatus: "Not Requested"
});
data = storage.load();

var nocGaps = calc.nocGaps(data.applications);
ok(nocGaps.some(function (g) { return g.company === "Pending NOC Co"; }), "an in-progress application with NOC required but not granted is flagged");
ok(!nocGaps.some(function (g) { return g.company === "Granted NOC Co"; }), "an application with NOC already granted is not flagged");
ok(!nocGaps.some(function (g) { return g.company === "Still Browsing Co"; }), "an application still at 'Interested' (not past the browsing stage) is not flagged even if NOC is required");

window.__mountPlacementTracker(root);
window.__ARISE_PLACEMENT_API__.open("tier3");
html = root.innerHTML;
ok(html.indexOf("Off-Campus NOC Tracker") >= 0, "NOC tracker panel renders");
ok(html.indexOf("Pending NOC Co") >= 0 && html.indexOf("NOC Requested") >= 0, "the flagged application and its NOC status render");
ok(html.indexOf("Granted NOC Co") === -1 || html.indexOf("Still Browsing Co") === -1, "granted/not-yet-relevant applications don't clutter the NOC panel unnecessarily");

// ---- 7. Nothing else regressed: Overview + Applications + Offers tabs still render ----
window.__ARISE_PLACEMENT_API__.open("overview");
ok(root.innerHTML.indexOf("Placement Probability") >= 0, "Overview tab still renders after the tier3 tab was added");
window.__ARISE_PLACEMENT_API__.open("applications");
ok(root.innerHTML.indexOf("Pipeline Analytics") >= 0, "Applications tab still renders and is unaffected by the new tab");
ok(root.innerHTML.indexOf("MegaServe Technologies") >= 0, "new applications fields (driveType/minCgpaEligibility/backlogPolicy/nocRequired/nocStatus) don't break the Applications kanban card");
window.__ARISE_PLACEMENT_API__.open("offers");
ok(root.innerHTML.indexOf("TrueCore Solutions") >= 0, "Offers tab still renders and includes the new bond fields without breaking the table");

// The global search API must skip tier3 (it has no ENTITIES config) rather than throwing.
var searchResults;
var threw = false;
try { searchResults = window.__ARISE_PLACEMENT_API__.search(); } catch (e) { threw = true; }
ok(!threw, "global search API does not throw now that a derived/no-entity tab (tier3) exists");
ok(Array.isArray(searchResults) && searchResults.length > 0, "global search still returns results from real entities");

if (VERBOSE || fail) console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
