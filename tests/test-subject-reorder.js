// Smoke test for the "reorder everything" fix to cse-syllabus-plus-widget.js:
// move up/down (▲▼) buttons used to only render for custom-added subjects,
// even though the underlying custom.order persistence already supported
// reordering ANY subject within a semester. This checks canonical (base)
// subjects can now be reordered too, and that custom subjects still work
// exactly as before (no regression).
//
// Run with: node tests/test-subject-reorder.js
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const BASE = path.join(path.resolve(__dirname, ".."), "src", "features", "semester-risk");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + JSON.stringify(a) + ", expected " + JSON.stringify(b) + ")"); }

function freshDom(seedCustom) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="sem-1"></div></body></html>`,
    { url: "https://example.test/", runScripts: "dangerously" }
  );
  const { window } = dom;
  const store = {};
  if (seedCustom) store["cse-syllabus-custom-v1"] = JSON.stringify(seedCustom);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
  });
  const cfgCode = fs.readFileSync(path.join(BASE, "cse-full-syllabus-config.js"), "utf8");
  const widgetCode = fs.readFileSync(path.join(BASE, "cse-syllabus-plus-widget.js"), "utf8");
  window.eval(cfgCode);
  window.eval(widgetCode);
  if (window.document.readyState === "loading") {
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));
  }
  return { window, document: window.document, store };
}

// Row order helper: canonical rows have no id attr in this panel (only
// custom rows get id='csp-row-<id>'), so read order via each row's
// data-toggle attribute instead of relying on an element id.
function rowOrderForSem(document, subjectIds) {
  const all = Array.from(document.querySelectorAll(".csp-row [data-toggle]")).map((el) => el.getAttribute("data-toggle"));
  return all.filter((id) => subjectIds.indexOf(id) !== -1);
}

// ---- Test 1: canonical (non-custom) subjects now render move buttons ----
{
  const { document } = freshDom();
  // s1-1 is a canonical Sem-1 subject, not custom-added.
  const row = document.querySelector('[data-toggle="s1-1"]').closest(".csp-row");
  ok(!!row.querySelector('[data-move="s1-1:up"]'), "canonical subject row has a move-up button");
  ok(!!row.querySelector('[data-move="s1-1:down"]'), "canonical subject row has a move-down button");
  ok(!row.querySelector('[data-remove="s1-1"]'), "canonical subject row still has no delete button (can't delete a canonical subject)");
}

// ---- Test 2: clicking move-down on a canonical subject actually reorders it ----
{
  const { window, document, store } = freshDom();
  const before = rowOrderForSem(document, ["s1-1", "s1-2"]);
  eq(before[0], "s1-1", "s1-1 starts before s1-2 in the natural base order");

  document.querySelector('[data-move="s1-1:down"]').dispatchEvent(new window.Event("click", { bubbles: true }));

  const stored = JSON.parse(store["cse-syllabus-custom-v1"]);
  ok(stored && stored.order && Array.isArray(stored.order["1"]), "custom.order['1'] was created for Sem 1 after the move");
  const order = stored.order["1"];
  ok(order.indexOf("s1-1") > order.indexOf("s1-2"), "s1-1 now sits after s1-2 in the persisted order");

  const after = rowOrderForSem(document, ["s1-1", "s1-2"]);
  eq(after[0], "s1-2", "s1-2 now renders before s1-1 in the DOM");
}

// ---- Test 3: custom subjects can still be reordered (no regression) ----
{
  const { window, document, store } = freshDom({
    added: [
      { id: "custom-a", name: "Custom A", sem: 1, credits: 2, type: "Elective" },
      { id: "custom-b", name: "Custom B", sem: 1, credits: 2, type: "Elective" },
    ],
    edits: {}, order: {}, removed: [],
  });

  ok(!!document.querySelector('[data-move="custom-a:down"]'), "custom subject still has a move-down button");
  ok(!!document.querySelector('[data-remove="custom-a"]'), "custom subject still has a delete button");

  document.querySelector('[data-move="custom-a:down"]').dispatchEvent(new window.Event("click", { bubbles: true }));
  const stored = JSON.parse(store["cse-syllabus-custom-v1"]);
  const order = stored.order["1"];
  ok(order.indexOf("custom-a") > order.indexOf("custom-b"), "custom-a now sits after custom-b in the persisted order");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
