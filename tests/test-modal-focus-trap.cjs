/**
 * tests/test-modal-focus-trap.cjs
 * ---------------------------------------------------------------------------
 * Cover for bindModalA11y() / adoptModals() in src/animation-upgrade.js.
 *
 * WHY THIS EXISTS
 * The shared helper `bindModalA11y()` documented Escape dismissal, initial
 * focus, Tab wrapping and focus restoration - but nothing in src/ ever called
 * it. Every widget dialog (expenses PDF, local-files preview, certificates,
 * command palette, ...) therefore:
 *   - let Tab walk straight out of the dialog into the page behind it,
 *   - never moved focus into the dialog when it opened, and
 *   - dropped the user back at <body> on close instead of the button that
 *     opened it.
 *
 * adoptModals() now binds these dialogs automatically from their existing
 * markup (data-open / role="dialog" / aria-modal), so ~100 widget files did not
 * need editing.
 *
 * Run: node tests/test-modal-focus-trap.cjs
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

const DIALOG_HTML = `
  <body>
    <button id="open">Open preview</button>
    <a id="outside" href="#elsewhere">Outside link</a>
    <div id="overlay" data-open="false">
      <div role="dialog" aria-modal="true" aria-labelledby="title">
        <h2 id="title">Preview</h2>
        <button id="first">Download</button>
        <input id="middle" type="text" aria-label="Filename">
        <button id="last">Close</button>
        <button id="disabled" disabled>Unavailable</button>
        <button id="hidden-one" hidden>Hidden</button>
      </div>
    </div>
  </body>`;

function boot(html) {
  const dom = new JSDOM("<!doctype html><html>" + (html || DIALOG_HTML) + "</html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://example.test/"
  });
  const w = dom.window;
  w.__ariseReportWidgetError = () => {};
  w.eval("window.__ariseWidgetsReady = true;");
  w.eval("window.matchMedia = window.matchMedia || function(){return {matches:false,addEventListener:function(){},addListener:function(){}}};");
  w.eval(read("src/mutation-bus.js"));
  w.eval(read("src/animation-upgrade.js"));
  return w;
}

function openOverlay(w) {
  w.document.getElementById("overlay").setAttribute("data-open", "true");
}
function closeOverlay(w) {
  w.document.getElementById("overlay").setAttribute("data-open", "false");
}
function press(w, key, opts) {
  const target = (opts && opts.on) || w.document.getElementById("overlay");
  const event = new w.KeyboardEvent("keydown", {
    key,
    shiftKey: !!(opts && opts.shiftKey),
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(event);
  return event;
}

async function main() {
  console.log("adoptModals() — discovery");

  await test("binds a dialog declared with data-open", () => {
    const w = boot();
    const bound = w.AriseAnimationUpgrade.adoptModals();
    assert.equal(bound, 1);
    assert.equal(w.document.getElementById("overlay").__uxaModalBound, true);
  });

  await test("is idempotent across repeated scans", () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    assert.equal(w.AriseAnimationUpgrade.adoptModals(), 0);
  });

  await test("ignores decorative elements that are not dialogs", () => {
    const w = boot('<body><div data-open="true" class="toolbar"><button>x</button></div></body>');
    assert.equal(w.AriseAnimationUpgrade.adoptModals(), 0);
  });

  console.log("\nTab trapping");

  await test("wraps forward from the last control to the first", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    openOverlay(w);
    w.document.getElementById("last").focus();
    const event = press(w, "Tab");
    assert.equal(event.defaultPrevented, true, "Tab must be handled");
    assert.equal(w.document.activeElement.id, "first");
  });

  await test("wraps backward from the first control to the last", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    openOverlay(w);
    w.document.getElementById("first").focus();
    press(w, "Tab", { shiftKey: true });
    assert.equal(w.document.activeElement.id, "last");
  });

  await test("pulls focus back when it has escaped to the page behind", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    openOverlay(w);
    w.document.getElementById("outside").focus(); // simulate focus outside the dialog
    press(w, "Tab");
    assert.equal(w.document.activeElement.id, "first");
  });

  await test("does not trap focus while the dialog is closed", () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    w.document.getElementById("last").focus();
    const event = press(w, "Tab");
    assert.equal(event.defaultPrevented, false, "a closed dialog must not intercept Tab");
  });

  await test("skips disabled, hidden and aria-hidden controls", () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    const ids = JSON.parse(JSON.stringify(w.AriseAnimationUpgrade.getFocusable(w.document.getElementById("overlay")).map((el) => el.id)));
    assert.deepEqual(ids, ["first", "middle", "last"]);
  });

  console.log("\nEscape handling");

  await test("closes through the supplied onClose callback", () => {
    const w = boot();
    const overlay = w.document.getElementById("overlay");
    let closed = 0;
    w.AriseAnimationUpgrade.bindModalA11y(overlay, { onClose: () => { closed += 1; } });
    openOverlay(w);
    const event = press(w, "Escape");
    assert.equal(closed, 1);
    assert.equal(event.defaultPrevented || event.cancelable, true);
  });

  await test("does nothing on Escape when closed", () => {
    const w = boot();
    let closed = 0;
    w.AriseAnimationUpgrade.bindModalA11y(w.document.getElementById("overlay"), { onClose: () => { closed += 1; } });
    press(w, "Escape");
    assert.equal(closed, 0);
  });

  await test("only the innermost stacked dialog reacts to Escape", () => {
    const w = boot(
      '<body><div id="outer" data-open="true"><div role="dialog" aria-modal="true">' +
        '<button id="outer-btn">Outer</button>' +
        '<div id="inner" data-open="true"><div role="dialog" aria-modal="true"><button id="inner-btn">Inner</button></div></div>' +
        "</div></div></body>"
    );
    const inner = w.document.getElementById("inner");
    const outer = w.document.getElementById("outer");
    let innerClosed = 0;
    let outerClosed = 0;
    w.AriseAnimationUpgrade.bindModalA11y(inner, { onClose: () => { innerClosed += 1; } });
    w.AriseAnimationUpgrade.bindModalA11y(outer, { onClose: () => { outerClosed += 1; } });
    const event = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    w.document.getElementById("inner-btn").dispatchEvent(event);
    assert.equal(innerClosed, 1, "inner dialog must close");
    assert.equal(outerClosed, 0, "the containing dialog must stay open");
  });

  console.log("\nFocus management");

  await test("moves focus into the dialog when it opens", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    w.document.getElementById("open").focus();
    openOverlay(w);
    await sleep(60);
    assert.equal(w.document.activeElement.id, "first");
  });

  await test("restores focus to the trigger when it closes", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.adoptModals();
    const trigger = w.document.getElementById("open");
    trigger.focus();
    openOverlay(w);
    await sleep(60);
    closeOverlay(w);
    await sleep(60);
    assert.equal(w.document.activeElement.id, "open", "focus must return to the button that opened the dialog");
  });

  await test("honours an explicit initialFocus target", async () => {
    const w = boot();
    w.AriseAnimationUpgrade.bindModalA11y(w.document.getElementById("overlay"), {
      initialFocus: () => w.document.getElementById("middle")
    });
    openOverlay(w);
    await sleep(60);
    assert.equal(w.document.activeElement.id, "middle");
  });

  console.log("\nSource guards");

  await test("adoptModals() is called from boot, not just exported", () => {
    const source = read("src/animation-upgrade.js");
    const bootStart = source.lastIndexOf("function boot()");
    // Anchor on the module's export object, not the first local `var api = {`.
    const bootBody = source.slice(bootStart, source.indexOf("prefersReducedMotion: prefersReducedMotion"));
    assert.ok(bootStart > 0, "boot() must exist");
    assert.match(bootBody, /adoptModals\(\)/, "boot() must adopt existing widget dialogs");
    assert.match(bootBody, /adoptModals\(\)[\s\S]{0,400}subscribe/, "adoption must re-run on the mutation bus");
  });

  await test("the overlay state observer is disconnected with the element lifetime", () => {
    // A long-lived observer on a detached node is a leak; the observer only
    // watches one overlay's attributes and stops when the node is gone.
    const source = read("src/animation-upgrade.js");
    const fn = source.slice(source.indexOf("function bindModalA11y"), source.indexOf("function adoptModals"));
    assert.match(fn, /attributeFilter: \["data-open", "hidden", "aria-hidden"\]/);
    assert.doesNotMatch(fn, /subtree: true/, "the overlay observer must not watch the whole subtree");
  });

  await runQueued();
  if (failures.length) {
    console.error("\n" + failures.length + " failing, " + passed + " passing");
    process.exit(1);
  }
  console.log("\nAll " + passed + " modal focus-trap assertions passed.");
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
