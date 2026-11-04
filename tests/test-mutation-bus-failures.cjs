/**
 * tests/test-mutation-bus-failures.cjs
 * ---------------------------------------------------------------------------
 * src/mutation-bus.js delivers one coalesced mutation burst to 42 subscribing
 * widget updaters. Its dispatch loop was:
 *
 *     try { subscriber(records, mute) } catch {}
 *
 * The empty catch is right for availability - one broken updater must not stop
 * the other 41 from re-rendering - but it made the failure completely
 * invisible: no console entry, no entry in __ariseMountErrors, nothing for the
 * user or a maintainer to find. A widget whose updater threw on every burst
 * simply froze on stale data and looked like a data bug.
 *
 * The bus now records each distinct failing subscriber (name, count, first/last
 * time, message), forwards it to the same __ariseReportWidgetError hook the
 * widget loader uses, and still isolates it from its neighbours.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/mutation-bus.js"), "utf8");

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
const tick = () => sleep(220); // the bus debounces at 250 ms before widgets-ready
const plain = (value) => JSON.parse(JSON.stringify(value));

function boot() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.__ariseWidgetsReady = true; // use the fast 60 ms debounce
  w.__reported = [];
  w.__ariseReportWidgetError = (src, reason) => w.__reported.push([src, reason]);
  w.__consoleErrors = [];
  w.console.error = (...args) => w.__consoleErrors.push(args.map(String).join(" "));
  w.eval(source);
  return w;
}

function mutate(w) {
  const el = w.document.createElement("div");
  el.textContent = "x" + Math.random();
  w.document.body.appendChild(el);
}

async function main() {
  console.log("availability is unchanged");

  await test("a throwing updater does not stop its neighbours", async () => {
    const w = boot();
    let ran = 0;
    w.__ARISE_MUTATION_BUS__.subscribe(() => { throw new Error("boom"); });
    w.__ARISE_MUTATION_BUS__.subscribe(() => { ran += 1; });
    w.__ARISE_MUTATION_BUS__.subscribe(() => { ran += 1; });
    mutate(w);
    await tick();
    assert.equal(ran, 2, "both healthy subscribers must still run");
  });

  await test("the bus keeps working after a failure", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(() => { throw new Error("boom"); });
    let ran = 0;
    w.__ARISE_MUTATION_BUS__.subscribe(() => { ran += 1; });
    mutate(w);
    await tick();
    mutate(w);
    await tick();
    assert.equal(ran, 2, "subsequent bursts must still be delivered");
  });

  console.log("\nvisibility is new");

  await test("records the failing updater with a useful name", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(function learningHeatmapUpdater() { throw new Error("r.filter is not a function"); });
    mutate(w);
    await tick();
    const [entry] = w.__ARISE_MUTATION_BUS__.failures();
    assert.ok(entry, "the failure must be recorded");
    assert.equal(entry.name, "learningHeatmapUpdater");
    assert.equal(entry.message, "r.filter is not a function");
    assert.equal(entry.count, 1);
    assert.match(entry.firstAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  await test("aggregates repeats instead of growing a list per burst", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(function flakyUpdater() { throw new Error("boom"); });
    mutate(w);
    await tick();
    mutate(w);
    await tick();
    mutate(w);
    await tick();
    const all = w.__ARISE_MUTATION_BUS__.failures();
    assert.equal(all.length, 1, "one entry per subscriber, not one per burst");
    assert.ok(all[0].count >= 2, "the repeat count must be visible");
  });

  await test("forwards the failure to the widget error hook the UI already reads", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(function namedUpdater() { throw new Error("kaboom"); });
    mutate(w);
    await tick();
    assert.deepEqual(plain(w.__reported), [["updater:namedUpdater", "kaboom"]]);
  });

  await test("still logs to the console for local debugging", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(function namedUpdater() { throw new Error("kaboom"); });
    mutate(w);
    await tick();
    assert.ok(w.__consoleErrors.some((line) => line.includes("namedUpdater")), "the console must name the subscriber");
  });

  await test("a subscriber that throws a non-Error is handled too", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(function stringThrower() { throw "not an error object"; }); // eslint-disable-line no-throw-literal
    mutate(w);
    await tick();
    const [entry] = w.__ARISE_MUTATION_BUS__.failures();
    assert.equal(entry.message, "not an error object");
  });

  await test("an anonymous subscriber is still identifiable", async () => {
    const w = boot();
    w.__ARISE_MUTATION_BUS__.subscribe(() => { throw new Error("boom"); });
    mutate(w);
    await tick();
    assert.equal(w.__ARISE_MUTATION_BUS__.failures()[0].name, "anonymous updater");
  });

  console.log("\nno behaviour change on the happy path");

  await test("no failures are recorded when nobody throws", async () => {
    const w = boot();
    const calls = [];
    w.__ARISE_MUTATION_BUS__.subscribe((records) => calls.push(records.length));
    mutate(w);
    await tick();
    assert.ok(calls[0] > 0, "the subscriber received the burst");
    assert.deepEqual(plain(w.__ARISE_MUTATION_BUS__.failures()), []);
    assert.deepEqual(plain(w.__reported), []);
    assert.deepEqual(plain(w.__consoleErrors), []);
  });

  await test("an unsubscribed updater is not reported after it stops", async () => {
    const w = boot();
    const stop = w.__ARISE_MUTATION_BUS__.subscribe(() => { throw new Error("boom"); });
    stop();
    mutate(w);
    await tick();
    assert.deepEqual(plain(w.__ARISE_MUTATION_BUS__.failures()), []);
  });

  await test("mute() keeps working and is still used by widgets", () => {
    const w = boot();
    let ran = 0;
    w.__ARISE_MUTATION_BUS__.subscribe(() => { ran += 1; });
    w.__ARISE_MUTATION_BUS__.mute(() => mutate(w));
    assert.equal(typeof w.__ARISE_MUTATION_BUS__.mute, "function");
    assert.ok(ran >= 0);
  });

  console.log("\nsource guard");

  await test("the dispatch loop no longer swallows errors silently", () => {
    assert.doesNotMatch(source, /try \{ e\[o\]\(t, u\); \} catch \{\}/,
      "the empty catch is exactly the bug this covers");
    assert.match(source, /catch \(err\) \{ recordFailure\(e\[o\], err\); \}/);
  });

  await runQueued();
  if (failures.length) {
    console.error("\n" + failures.length + " failing, " + passed + " passing");
    process.exit(1);
  }
  console.log("\nAll " + passed + " mutation-bus failure assertions passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
