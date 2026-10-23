// Static structural test for the tabbed Learning page (component Oq in
// assets/app-bundle.js). The bundle is a single ES module that jsdom can't
// run, so this asserts the component source directly: every bolt-on ref and
// section lives in exactly one tab panel, nothing was dropped, and the
// always-mounted contract (hidden, not unmounted) holds.
// Run with: node test-learning-page-tabs.js
"use strict";
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "assets", "app-bundle.js"), "utf8");
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.error("FAIL: " + m); } }

const start = src.indexOf("Oq=b.memo(function(){");
const end = src.indexOf("Eq=Object.freeze(Object.defineProperty({__proto__:null,default:Oq}");
ok(start > 0 && end > start, "Learning component located");
const seg = src.slice(start, end);
const tabs = src.slice(src.indexOf("LPT=[{id"), start);

const ids = ["focus", "career", "path", "revision", "stats", "wellness"];
ids.forEach(function (id) { ok(tabs.indexOf('{id:"' + id + '"') !== -1, "tab defined: " + id); });
ok((tabs.match(/\{id:"/g) || []).length === ids.length, "exactly " + ids.length + " tabs defined");

// Panels: each id used exactly once as lpPanel("id",[...])
const panelIdx = {};
ids.forEach(function (id) {
  const n = seg.split('lpPanel("' + id + '",[').length - 1;
  ok(n === 1, "panel rendered once: " + id + " (got " + n + ")");
  panelIdx[id] = seg.indexOf('lpPanel("' + id + '",[');
});

// Content -> panel mapping (each marker must sit inside its own panel's slice)
const order = ids.map(function (id) { return [id, panelIdx[id]]; }).sort(function (a, b) { return a[1] - b[1]; });
function panelOf(marker) {
  const at = seg.lastIndexOf(marker);
  ok(at > -1, "content present: " + marker);
  let owner = null;
  order.forEach(function (o) { if (o[1] < at) owner = o[0]; });
  return owner;
}
const expect = {
  "Focus Timer": "focus", "\uD83D\uDCCB Tasks": "focus", "ref:battlePlanRef": "focus", "Enter Focus Mode": "focus", "ref:focusModeRef": "focus",
  "ref:careerCommandCenterRef})": "career", "ref:smartLearningPathRef})": "path", "ref:revisionSystemRef})": "revision",
  "Study Statistics": "stats", "Recent Stopwatch Sessions": "stats",
  "Water Reminder": "wellness", "ref:waterReminderRef": "wellness", "ref:burnoutRef})": "wellness"
};
Object.keys(expect).forEach(function (m) {
  if (m === "Water Reminder") return; // text comes from the vanilla widget, ref check covers it
  ok(panelOf(m) === expect[m], m + " lives in the " + expect[m] + " tab");
});

// Every bolt-on ref is still rendered exactly once (no duplicates / drops)
["careerCommandCenterRef", "focusModeRef", "battlePlanRef", "smartLearningPathRef", "revisionSystemRef", "waterReminderRef", "burnoutRef"].forEach(function (r) {
  ok(seg.split("{ref:" + r + "}").length - 1 === 1, "ref rendered once: " + r);
  ok(seg.indexOf(r + ".current") !== -1 && seg.indexOf("window.__mount") !== -1, "mount effect kept: " + r);
});
ok(seg.indexOf("y.jsx(oD,{isOpen:v,onClose:C,onComplete:O})") !== -1, "fullscreen focus modal still rendered at root");

// Hidden-not-unmounted contract + a11y wiring
ok(seg.indexOf("hidden:off") !== -1 && seg.indexOf('style:off?{display:"none"}') !== -1, "inactive panels are hidden (not unmounted), with inline display:none fallback");
ok(seg.indexOf('role:"tablist"') !== -1 && seg.indexOf('role:"tab"') !== -1 && seg.indexOf('role:"tabpanel"') !== -1, "tablist/tab/tabpanel roles present");
ok(seg.indexOf('"aria-selected":on') !== -1 && seg.indexOf('"aria-controls":"lp-panel-"+t.id') !== -1, "aria-selected + aria-controls wired");
ok(seg.indexOf('useState("focus")') !== -1, "default tab is focus");
["ArrowRight", "ArrowLeft", "Home", "End"].forEach(function (k) { ok(seg.indexOf('"' + k + '"') !== -1, "keyboard: " + k); });
ok(seg.indexOf('link[href="./widget-nav.css"]') !== -1, "widget-nav.css safety-net link present");

// Cache-bust: bundle changed => service worker cache name must be a Learning-tabs (or later) bump
const sw = fs.readFileSync(path.join(__dirname, "service-worker.js"), "utf8");
ok(/CACHE_NAME="arise-developer-system-v(\d+)/.test(sw) && Number(RegExp.$1) >= 200, "service worker cache bumped to v200+");

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
