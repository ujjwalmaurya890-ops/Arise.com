/**
 * tests/test-perf-watch.cjs
 * ---------------------------------------------------------------------------
 * Contribution 12 — performance watch (src/perf-watch.js + the two probes it
 * exposed).
 *
 * Measured on the built dashboard in Chromium, idle for 4 s, before the fix:
 *   3,985 querySelector(All) calls, 5 long tasks, ~750 DOM mutations and 26
 *   mutation-bus notifications — 16 of them full innerHTML re-renders of another
 *   widget — with nobody typing anything.
 *
 * Causes: the mutation bus notified subscribers for records produced by the
 * subscribers themselves, and the dashboard layout re-appended every card on
 * every pass (appendChild moves a node even when it is already in place).
 *
 * These tests pin the filter's semantics, the bus contract and the layout fix.
 *
 * Run: node tests/test-perf-watch.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed += 1;
  else { failures.push(label); console.error("  FAIL  " + label); }
}

function boot(body) {
  const dom = new JSDOM("<!doctype html><html><body>" + (body || "<div id='arise-main'><div class='space-y-6'><section class='first'>a</section></div></div>") + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.eval(read("src/perf-watch.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const P = w.ArisePerf;
  const doc = w.document;
  const idle = doc.createElement("div");
  doc.body.appendChild(idle);
  P.mark(idle);

  const record = (target, extra) => Object.assign({ target, type: "characterData", attributeName: null, addedNodes: [], removedNodes: [] }, extra || {});
  const textNode = doc.createTextNode("frame 1");
  idle.appendChild(textNode);

  const kept = P.filter([
    record(textNode),
    record(idle, { type: "attributes", attributeName: "class" })
  ]);
  ok(kept.length === 0, "animation frames inside a declared subtree are dropped: " + kept.length);
  ok(P.snapshot().ignored === 2, "dropped records are counted: " + P.snapshot().ignored);
  ok(P.snapshot().records === 2 && P.snapshot().dispatched === 0, "received and dispatched are counted separately");

  // A structural change inside the same subtree is still real: a new row.
  const row = doc.createElement("span");
  const structural = P.filter([record(idle, { type: "childList", addedNodes: [row] })]);
  ok(structural.length === 1, "a newly added element is never dropped");
  ok(P.isStructural(record(idle, { type: "childList", removedNodes: [row] })) === true, "removing an element is structural");
  ok(P.isStructural(record(idle, { type: "childList", addedNodes: [doc.createTextNode("x")] })) === false,
    "adding a text node is not structural");
  ok(P.isStructural(record(idle, { type: "attributes", attributeName: "style" })) === false, "attribute writes are not structural");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const P = w.ArisePerf;
  const doc = w.document;
  const elsewhere = doc.querySelector("section.first");
  const record = (target, extra) => Object.assign({ target, type: "characterData", attributeName: null, addedNodes: [], removedNodes: [] }, extra || {});

  ok(P.filter([record(elsewhere)]).length === 1, "text changes outside a declared subtree are kept");
  ok(P.mark(doc.createElement("div")) === true, "mark() declares a subtree");
  const node = doc.createElement("div");
  P.mark(node);
  ok(node.hasAttribute("data-arise-bus-idle"), "the declaration is a data attribute, not a style hack");
  P.mark(node, false);
  ok(!node.hasAttribute("data-arise-bus-idle"), "mark(node, false) withdraws the declaration");

  const nested = doc.createElement("div");
  const parent = doc.createElement("div");
  P.mark(parent);
  parent.appendChild(nested);
  doc.body.appendChild(parent);
  const deepText = doc.createTextNode("still animating");
  nested.appendChild(deepText);
  ok(P.filter([record(deepText)]).length === 0, "descendants of a declared subtree are covered");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const source = read("src/mutation-bus.js");
  ok(/ArisePerf\.filter/.test(source), "the mutation bus consults the filter");
  ok(/takeRecords/.test(source), "the bus discards records produced by its own subscribers");
  ok(/noteNotification/.test(source), "the bus counts how often it notifies");

  // The filter must never let a bus failure go silent.
  ok(/recordFailure/.test(source), "a throwing filter is recorded, not swallowed");

  // The animation loop is declared, and only its own subtree.
  const readiness = read("src/readiness-50lpa-widget.js");
  ok(/ArisePerf\.mark/.test(readiness), "the animating card declares itself self-updating");
  ok(!/mark\(document\.documentElement\)/.test(readiness), "the declaration is not applied to the whole document");
}

/* ------------------------------------------------------------------ suite 4 */
{
  // The layout pass must not re-append cards that are already in place.
  const source = read("src/dashboard-personalization.js");
  ok(/insertBefore\(card\.node, placed\[index\] \|\| null\)/.test(source), "cards are only moved when they are out of place");
  ok(!/stack\.appendChild\(card\.node\)/.test(source), "the unconditional appendChild is gone");

  const w = boot('<div id="arise-main"><div class="max-w-7xl"><div class="space-y-6">' +
    '<section class="glass-card rounded-2xl p-5"><h3>Alpha</h3></section>' +
    '<section class="glass-card rounded-2xl p-5"><h3>Beta</h3></section>' +
    '<section class="glass-card rounded-2xl p-5"><h3>Gamma</h3></section>' +
    '</div></div></div>');
  const doc = w.document;
  w.__ariseWidgetsReady = true;
  w.eval(read("src/storage-watch-bus.js"));
  w.eval(read("src/dashboard-personalization.js"));

  const stack = doc.querySelector(".space-y-6");
  const labels = () => Array.from(stack.children).map((el) => (el.querySelector("h3") || {}).textContent);
  ok(labels().join(",") === "Alpha,Beta,Gamma", "the authored order is preserved: " + labels().join(","));

  // Count actual re-insertions while idling.
  let moves = 0;
  const original = w.Node.prototype.insertBefore;
  w.Node.prototype.insertBefore = function (...args) { moves += 1; return original.apply(this, args); };
  const originalAppend = w.Node.prototype.appendChild;
  w.Node.prototype.appendChild = function (...args) { moves += 1; return originalAppend.apply(this, args); };
  w.AriseDashboardLayout.apply();
  w.AriseDashboardLayout.apply();
  w.Node.prototype.insertBefore = original;
  w.Node.prototype.appendChild = originalAppend;
  ok(moves === 0, "re-applying unchanged preferences moves nothing: " + moves);

  const cards = w.AriseDashboardLayout.cards();
  ok(cards.length === 3, "all three cards are still discoverable: " + cards.length);
  const target = cards.find((card) => card.label === "Gamma").key;
  w.AriseDashboardLayout.move(target, -1);
  ok(stack.children.length === 3, "moving a card keeps the stack size");
  ok(new Set(Array.from(stack.children)).size === 3, "no card is duplicated");
  ok(labels().join(",") === "Alpha,Gamma,Beta", "moving a card still reorders: " + labels().join(","));
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const html = read("index.html");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));
  ok(html.includes("'./src/perf-watch.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(html.indexOf("'./src/perf-watch.js'") > html.indexOf("'./src/mutation-bus.js'"), "it loads after the bus it serves");
  ok(sw.includes("./src/perf-watch.js"), "the module joins the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");
  const w = boot();
  ok(typeof w.ArisePerf.filter === "function" && typeof w.ArisePerf.snapshot === "function", "the public API is complete");
  ok(w.ArisePerf.idleAttribute === "data-arise-bus-idle", "the declaration attribute is stable");
  w.close();
}

console.log("\nPerformance watch: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
