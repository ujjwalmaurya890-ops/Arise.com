/**
 * tests/test-widget-failure-reporter.cjs
 * ---------------------------------------------------------------------------
 * Two independent parts of the app detected a broken widget and then dropped
 * the information on the floor:
 *
 *   - index.html's widget loader records every chunk that 404s or times out in
 *     window.__ariseWidgetLoadFailures. No file in src/ read it, so a failed
 *     deploy meant an empty tab and no explanation.
 *   - The loader also calls window.__ariseReportWidgetError(src), documented as
 *     "if defined elsewhere". It was not defined anywhere in the repository, so
 *     the call was dead.
 *
 * This covers the reporter that now defines that hook and surfaces both failure
 * modes in one quiet, dismissible, accessible line.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/widget-failure-reporter.js"), "utf8");

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

const BANNER = "#arise-widget-failure-banner";

function boot({ failuresAlready = [], readyState = "complete" } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.__ariseWidgetLoadFailures = failuresAlready.slice();
  w.__ariseMountErrors = [];
  w.eval(source);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}

async function main() {
  console.log("the previously-dead extension point");

  await test("defines the hook the widget loader already calls", () => {
    const w = boot();
    assert.equal(typeof w.__ariseReportWidgetError, "function");
    assert.doesNotThrow(() => w.__ariseReportWidgetError("./src/chunks/broken.js"));
  });

  await test("is idempotent - a second load does not stack listeners or banners", () => {
    const w = boot();
    w.eval(source);
    w.__ariseReportWidgetError("./src/a.js");
    w.__ariseReportWidgetError("./src/b.js");
    assert.equal(w.document.querySelectorAll(BANNER).length, 1, "exactly one banner");
  });

  await test("never throws, whatever it is handed", () => {
    const w = boot();
    for (const value of [undefined, null, "", 0, {}, [], "<img src=x onerror=alert(1)>"]) {
      assert.doesNotThrow(() => w.__ariseReportWidgetError(value));
    }
  });

  console.log("\nsurfacing a failure");

  await test("renders a single polite status line, not a modal or a toast storm", () => {
    const w = boot();
    w.__ariseReportWidgetError("./src/chunks/notes-app-widget.abc123.js");
    const banner = w.document.querySelector(BANNER);
    assert.ok(banner, "a banner must appear");
    assert.equal(banner.getAttribute("role"), "status");
    assert.equal(banner.getAttribute("aria-live"), "polite");
  });

  await test("turns the chunk filename into something a human can read", () => {
    const w = boot();
    w.__ariseReportWidgetError("./src/chunks/learning-session-analytics-widget.9f2a.js");
    const text = w.document.querySelector(BANNER).textContent;
    assert.match(text, /Learning Session Analytics/, "got: " + text);
    assert.doesNotMatch(text, /\.js|\.abc|chunks/);
  });

  await test("summarises several failures instead of listing all ~100", () => {
    const w = boot();
    for (const name of ["a-widget.js", "b-widget.js", "c-widget.js", "d-widget.js", "e-widget.js"]) {
      w.__ariseReportWidgetError("./src/chunks/" + name);
    }
    const text = w.document.querySelector(BANNER).textContent;
    assert.match(text, /5 modules could not be loaded/);
    assert.match(text, /…/, "the list must be elided");
  });

  await test("reuses the banner for repeated reports of the same file", () => {
    const w = boot();
    w.__ariseReportWidgetError("./src/one.js");
    w.__ariseReportWidgetError("./src/one.js");
    assert.equal(w.__ariseWidgetFailureReport.failures().length, 1);
  });

  await test("reassures the user that their data is not lost and offers a reload", () => {
    const w = boot();
    w.__ariseReportWidgetError("./src/one.js");
    const text = w.document.querySelector(BANNER).textContent;
    assert.match(text, /saved progress is safe/i);
    assert.ok(w.document.querySelector("[data-awf-retry]"), "a reload action must exist");
  });

  await test("escapes an attacker-controlled filename rather than injecting it", () => {
    const w = boot();
    w.__ariseReportWidgetError('"><img src=x onerror="window.__pwned=1">');
    assert.equal(w.document.querySelectorAll("img").length, 0, "the payload must be text, not markup");
    assert.equal(w.__pwned, undefined);
  });

  await test("dismissing removes it and later failures do not nag again", () => {
    const w = boot();
    w.__ariseReportWidgetError("./src/one.js");
    w.document.querySelector("[data-awf-dismiss]").click();
    assert.equal(w.document.querySelector(BANNER), null);
    w.__ariseReportWidgetError("./src/two.js");
    assert.equal(w.document.querySelector(BANNER), null, "dismissal must be respected");
  });

  console.log("\nadopting failures recorded before it ran");

  await test("picks up failures the loader recorded earlier", () => {
    const w = boot({ failuresAlready: ["./src/chunks/expenses-widget.aaa.js"] });
    assert.equal(w.document.querySelectorAll(BANNER).length, 1);
    assert.match(w.document.querySelector(BANNER).textContent, /Expenses/);
  });

  await test("picks up failures the loader records later", async () => {
    const w = boot();
    assert.equal(w.document.querySelector(BANNER), null, "nothing to report yet");
    w.__ariseWidgetLoadFailures.push("./src/chunks/late-widget.bbb.js");
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.ok(w.document.querySelector(BANNER), "a failure arriving later must still surface");
  });

  await test("mount errors share the same line instead of being devtools-only", async () => {
    const w = boot();
    w.__ariseMountErrors.push({ widget: "__mountNotesApp", message: "boom", time: new Date().toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.ok(w.document.querySelector(BANNER));
  });

  console.log("\nintegration");

  await test("index.html loads the reporter and the loader's hook now exists", () => {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    assert.match(html, /'\.\/src\/widget-failure-reporter\.js'/, "the module must be in the SCRIPTS list");
    assert.match(html, /__ariseReportWidgetError/, "the loader must still call the hook");
  });

  await test("the reporter is published to the production build", () => {
    // The build copies src/ verbatim; this asserts the copy list still covers
    // the file rather than the exact state of dist/.
    const build = fs.readFileSync(path.join(root, "scripts/build.mjs"), "utf8");
    assert.match(build, /'src'/, "the build must publish src/");
    if (fs.existsSync(path.join(root, "dist"))) {
      assert.ok(fs.existsSync(path.join(root, "dist", "src", "widget-failure-reporter.js")),
        "run npm run build so the module reaches dist/src");
    }
  });

  await runQueued();
  if (failures.length) {
    console.error("\n" + failures.length + " failing, " + passed + " passing");
    process.exit(1);
  }
  console.log("\nAll " + passed + " widget-failure-reporter assertions passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
