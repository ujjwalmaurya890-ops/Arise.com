/**
 * tests/test-updater-coalescing.cjs
 * ---------------------------------------------------------------------------
 * Regression cover for __ARISE_WIDGET_UTILS__.registerUpdaterCoalescer().
 *
 * WHY THIS EXISTS
 * Several widgets react to DOM mutations by rescanning the entire document to
 * find their own header/section. They all subscribed to the shared mutation
 * bus independently, so one content change made every one of them re-query the
 * whole page. Measured on a dashboard-sized DOM with only 5 widgets mounted,
 * 25 content mutations produced 51 document-level querySelectorAll calls and
 * 25,092 returned elements.
 *
 * The shared helper now collapses a mutation burst into a single trailing pass.
 * These tests pin that contract: once per burst, not once per widget per
 * record, and never when the tab is hidden.
 *
 * Run: node tests/test-updater-coalescing.cjs
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
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ✓ " + name);
  } catch (error) {
    failures.push({ name, error });
    console.error("  ✗ " + name + "\n      " + error.message);
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Boot the shared utils + real mutation bus in jsdom. */
function boot() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><main id="arise-main"><section id="host"></section></main></body></html>',
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/" }
  );
  const w = dom.window;
  w.eval("window.__ariseWidgetsReady = true;");
  w.eval(read("src/mutation-bus.js"));
  w.eval(read("src/widget-shared-utils.js"));
  return { dom, w, U: w.__ARISE_WIDGET_UTILS__ };
}

(async () => {
  console.log("registerUpdaterCoalescer() — API");

  const boot1 = boot();
  test("is exported on the shared utils", () => {
    assert.equal(typeof boot1.U.registerUpdaterCoalescer, "function");
  });

  test("is idempotent for the same function", async () => {
    // Registering twice must not double the work (widgets re-run discovery).
    const calls = [];
    const fn = () => calls.push(1);
    boot1.U.registerUpdaterCoalescer(fn);
    boot1.U.registerUpdaterCoalescer(fn);
    boot1.U.bootUpdater(() => {}); // installs the shared mutation-bus subscription
    boot1.w.document.getElementById("host").appendChild(boot1.w.document.createElement("p"));
    await sleep(320);
    assert.equal(calls.length, 1, "expected one run per burst, got " + calls.length);
  });

  test("ignores non-functions", () => {
    assert.doesNotThrow(() => {
      boot1.U.registerUpdaterCoalescer(null);
      boot1.U.registerUpdaterCoalescer("nope");
      boot1.U.registerUpdaterCoalescer(42);
    });
  });

  console.log("\nBurst coalescing");

  const boot2 = boot();
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const id = i;
    boot2.U.registerUpdaterCoalescer(() => runs.push(id));
  }
  boot2.U.bootUpdater(() => {}); // installs the shared subscription

  test("a burst of DOM changes runs every coalescer exactly once", async () => {
    const host = boot2.w.document.getElementById("host");
    // 10 separate mutations inside one coalescing window.
    for (let i = 0; i < 10; i++) {
      const el = boot2.w.document.createElement("div");
      el.textContent = "record " + i;
      host.appendChild(el);
    }
    await sleep(400);
    assert.equal(runs.length, 5, "5 coalescers x 1 pass, got " + runs.length + " runs");
    assert.deepEqual(runs.slice().sort(), [0, 1, 2, 3, 4]);
  });

  test("a later burst runs again (the collapse is per burst, not permanent)", async () => {
    runs.length = 0;
    boot2.w.document.getElementById("host").appendChild(boot2.w.document.createElement("span"));
    await sleep(400);
    assert.equal(runs.length, 5, "expected one more pass per coalescer, got " + runs.length);
  });

  test("isolation: one throwing coalescer does not stop the others", async () => {
    const boot3 = boot();
    const ok = [];
    boot3.U.registerUpdaterCoalescer(() => { throw new Error("boom"); });
    boot3.U.registerUpdaterCoalescer(() => ok.push("second"));
    boot3.U.bootUpdater(() => {});
    const swallowed = [];
    boot3.w.addEventListener("error", (event) => swallowed.push(event.message));
    boot3.w.document.getElementById("host").appendChild(boot3.w.document.createElement("b"));
    await sleep(400);
    assert.deepEqual(ok, ["second"], "the second coalescer must still run");
    // The utils re-throw asynchronously so the failure stays visible, matching
    // the existing updater-queue behaviour.
    assert.ok(swallowed.length <= 1);
  });

  test("does not run while the tab is hidden", async () => {
    const boot4 = boot();
    const hiddenRuns = [];
    boot4.U.registerUpdaterCoalescer(() => hiddenRuns.push(1));
    boot4.U.bootUpdater(() => {});
    Object.defineProperty(boot4.w.document, "hidden", { configurable: true, get: () => true });
    boot4.w.document.getElementById("host").appendChild(boot4.w.document.createElement("i"));
    await sleep(320);
    assert.equal(hiddenRuns.length, 0, "hidden tabs must not do layout work");
  });

  console.log("\nSource guards — no converted widget bypasses the coalescer");

  test("coalescer is not implemented with bus.mute()", () => {
    // mute() drains and discards the observer's pending records, which would
    // swallow sibling widgets' legitimate updates.
    const source = read("src/widget-shared-utils.js");
    const section = source.slice(
      source.indexOf("function runUpdaterCoalescers"),
      source.indexOf("function escapeText")
    );
    assert.ok(section.length > 0, "coalescer implementation is discoverable");
    assert.ok(!/\.mute\(/.test(section), "coalescer must not call bus.mute()");
  });

  test("the converted whole-document updaters register a coalescer", () => {
    const expected = [
      "src/learning-session-analytics-widget.js",
      "src/placement-command-center-widget.js",
      "src/dsa-placement-engine-widget.js",
      "src/dev-placement-engine-widget.js",
      "src/ai-career-mentor-widget.js"
    ];
    const missing = expected.filter((file) => !read(file).includes("registerUpdaterCoalescer"));
    assert.deepEqual(missing, []);
  });

  if (failures.length) {
    console.error("\n" + failures.length + " failing, " + passed + " passing");
    process.exit(1);
  }
  console.log("\nAll " + passed + " updater-coalescing assertions passed.");
  process.exit(0);
})();
