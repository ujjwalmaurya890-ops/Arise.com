/**
 * tests/test-a11y-accessible-names.cjs
 * ---------------------------------------------------------------------------
 * Cover for src/a11y-label-patch.js.
 *
 * WHY THIS EXISTS
 * An audit of the actually-rendered widget DOM (every src/*.js widget mounted
 * in jsdom with a valid store) found 22 interactive controls with no
 * accessible name:
 *   - text/number inputs whose only hint was a `placeholder`;
 *   - `type="file"` inputs driven by a separate visible button.
 * A placeholder is not a label (it vanishes on input and is not reliably
 * announced), so those controls failed WCAG 2.2 AA 1.3.1/3.3.2/4.1.2.
 *
 * The patch fixes them additively in the rendered DOM. These tests pin both
 * directions: it must add a useful name, and it must NOT touch controls that
 * already have one, are excluded, or have no derivable name.
 *
 * Run: node tests/test-a11y-accessible-names.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const failures = [];
const queued = [];
function test(name, fn) {
  queued.push({ name, fn });
}
async function runQueued() {
  for (const { name, fn } of queued) {
    try {
      await fn();
      passed += 1;
      console.log("  ✓ " + name);
    } catch (error) {
      failures.push({ name, error });
      console.error("  ✗ " + name + "\n      " + error.message);
    }
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boot(html) {
  const dom = new JSDOM("<!doctype html><html><body>" + (html || "") + "</body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.test/"
  });
  const w = dom.window;
  w.eval("window.__ariseWidgetsReady = true;");
  w.eval(read("src/mutation-bus.js"));
  w.eval(read("src/a11y-label-patch.js"));
  return w;
}

const API = "window.__ARISE_A11Y_LABEL_PATCH_API__";

console.log("Patch loading");

test("exposes its pure helpers for verification", () => {
  const w = boot();
  const api = w.eval(API);
  assert.equal(typeof api.scan, "function");
  assert.equal(typeof api.nameFor, "function");
  assert.equal(typeof api.hasAccessibleName, "function");
});

test("is idempotent (double load is a no-op)", () => {
  const w = boot();
  assert.doesNotThrow(() => w.eval(read("src/a11y-label-patch.js")));
  assert.equal(w.__ARISE_A11Y_LABEL_PATCH__, true);
});

console.log("\nNaming rules");

test("uses the placeholder as the name, without mangling the author's prose", () => {
  const w = boot('<form><input id="a" type="number" placeholder="Invested amount (₹), e.g. 5000"></form>');
  w.eval(API).scan(w.document);
  const el = w.document.getElementById("a");
  assert.equal(el.getAttribute("aria-label"), "Invested amount (₹), e.g. 5000");
  assert.equal(el.getAttribute("data-uxa-name"), "added");
});

test("never uses a bare example placeholder as the field name", () => {
  // "e.g. 5000" answers no question on its own, so the semantic attribute wins.
  const w = boot('<form><input id="a" type="number" placeholder="e.g. 5000" data-role="monthly-income"></form>');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), "Monthly income");
});

test("strips a trailing ellipsis from a placeholder", () => {
  const w = boot('<input id="a" type="text" placeholder="Search notes…">');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), "Search notes");
});

test("prefers a visible but unassociated label over a placeholder", () => {
  const w = boot(
    '<div class="field"><label>Company name</label><input id="a" type="text" placeholder="e.g. Infosys"></div>'
  );
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), "Company name");
});

test("uses an immediately preceding sibling label", () => {
  const w = boot('<div><label>Semester</label><input id="a" type="text"></div>');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), "Semester");
});

test("does not borrow a sibling label that belongs to another field", () => {
  // Two labelled controls in one row: the second has no own label.
  const w = boot(
    '<div class="row"><label>From date</label><input id="from"><input id="other" type="text" data-role="search-filter"></div>'
  );
  w.eval(API).scan(w.document);
  // "#other" must not be called "From date"; it falls back to its own attribute.
  assert.equal(w.document.getElementById("other").getAttribute("aria-label"), "Search filter");
});

test("falls back to a de-kebab-cased semantic attribute", () => {
  const w = boot('<input id="a" type="number" data-action="bunk-custom-skip">');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), "Bunk custom skip");
});

test("names a hidden file input after the control that opens it", () => {
  const w = boot(
    '<div class="tools"><input id="f" type="file" accept=".zip" hidden>' +
      '<button type="button">Import &amp; restore</button><button type="button">+ Add semester</button></div>'
  );
  w.eval(API).scan(w.document);
  const name = w.document.getElementById("f").getAttribute("aria-label");
  assert.match(name, /import/i, "expected the import verb, got: " + name);
  assert.doesNotMatch(name, /add semester/i);
});

test("falls back to the accepted file type when no trigger verb exists", () => {
  const w = boot('<form><input id="f" type="file" accept="application/json,.json"></form>');
  w.eval(API).scan(w.document);
  assert.match(w.document.getElementById("f").getAttribute("aria-label"), /import backup data/i);
});

console.log("\nNon-interference (the patch must never guess)");

test("keeps an existing aria-label", () => {
  const w = boot('<input id="a" type="text" aria-label="Minimum CGPA" placeholder="Min CGPA">');
  w.eval(API).scan(w.document);
  const el = w.document.getElementById("a");
  assert.equal(el.getAttribute("aria-label"), "Minimum CGPA");
  assert.equal(el.getAttribute("data-uxa-name"), "kept");
});

test("keeps a name provided by aria-labelledby", () => {
  const w = boot('<span id="lbl">Task title</span><input id="a" type="text" aria-labelledby="lbl">');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), null);
});

test("keeps a name provided by an associated <label for>", () => {
  const w = boot('<label for="a">Amount</label><input id="a" type="number">');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), null);
});

test("skips the appended example hint when the placeholder has no question", () => {
  // Everything this patch adds must be honest; "e.g. 5000" alone is not a name
  // for a field whose label is rendered elsewhere, so nothing is invented from
  // an excluded/invalid control.
  const w = boot('<input id="a" type="text" placeholder="e.g. 5000" disabled>');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("a").getAttribute("aria-label"), null);
});

test("skips disabled, readonly and aria-hidden controls", () => {
  const w = boot(
    '<input id="d" type="text" placeholder="Disabled field" disabled>' +
      '<input id="r" type="text" placeholder="Readonly field" readonly>' +
      '<div aria-hidden="true"><input id="h" type="text" placeholder="Hidden field"></div>'
  );
  const api = w.eval(API);
  api.scan(w.document);
  for (const id of ["d", "r", "h"]) {
    assert.equal(w.document.getElementById(id).getAttribute("aria-label"), null, id + " must be untouched");
  }
});

test("ignores buttons, submit inputs and hidden inputs", () => {
  const w = boot(
    '<button id="b"><svg><path d="M0 0"></path></svg></button>' +
      '<input id="s" type="submit" value="Save">' +
      '<input id="h" type="hidden" name="csrf">'
  );
  w.eval(API).scan(w.document);
  for (const id of ["b", "s", "h"]) {
    assert.equal(w.document.getElementById(id).getAttribute("aria-label"), null, id + " must be untouched");
  }
});

test("leaves a control with no derivable name alone", () => {
  const w = boot('<input id="x" type="text">');
  w.eval(API).scan(w.document);
  assert.equal(w.document.getElementById("x").getAttribute("aria-label"), null);
  assert.equal(w.document.getElementById("x").getAttribute("data-uxa-name"), null);
});

test("does not change layout attributes, ids or values", () => {
  const w = boot('<input id="a" type="text" placeholder="Goal" class="exw-input" value="laptop">');
  const before = w.document.getElementById("a").outerHTML;
  w.eval(API).scan(w.document);
  const after = w.document.getElementById("a").outerHTML;
  assert.equal(w.document.getElementById("a").id, "a");
  assert.equal(w.document.getElementById("a").className, "exw-input");
  assert.equal(w.document.getElementById("a").value, "laptop");
  assert.equal(after.replace(/\s*data-uxa-name="added"/, "").replace(/\s*aria-label="[^"]*"/, ""), before);
});

console.log("\nReactivity");

test("labels controls rendered after load, via the mutation bus", async () => {
  const w = boot('<div id="host"></div>');
  const host = w.document.getElementById("host");
  const input = w.document.createElement("input");
  input.type = "number";
  input.setAttribute("placeholder", "How many hours?");
  host.appendChild(input);
  await sleep(400);
  assert.equal(input.getAttribute("aria-label"), "How many hours?");
});

test("labels a control on focus even if it never passed through the observer", async () => {
  const w = boot('<div id="host"><input id="late" type="text"></div>');
  await sleep(20); // let the patch's DOMContentLoaded boot install listeners
  const input = w.document.getElementById("late");
  // The question is added after insertion, so only the focus path can see it.
  input.setAttribute("placeholder", "Late field");
  input.dispatchEvent(new w.Event("focusin", { bubbles: true }));
  assert.equal(input.getAttribute("aria-label"), "Late field");
});

async function main() {
  await runQueued();
  if (failures.length) {
    console.error("\n" + failures.length + " failing, " + passed + " passing");
    process.exit(1);
  }
  console.log("\nAll " + passed + " accessible-name assertions passed.");
  process.exit(0);
}
main();
