/**
 * tests/test-reliability-watch.cjs
 * ---------------------------------------------------------------------------
 * Contribution 15 — reliability (src/reliability-watch.js + the loader hook).
 *
 * Before this, a widget chunk that failed once stayed missing for the rest of the
 * session, the notice that reported it recommended a reload it could not make
 * better, and nothing at all was remembered across that reload.
 *
 * Run: node tests/test-reliability-watch.cjs
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

const KEY = "arise-widget-retry-v1";
const fast = (w) => {
  // The module's delays are seconds; the tests only need the ordering.
  w.setTimeout = (fn) => setTimeout(fn, 0);
  w.clearTimeout = (id) => clearTimeout(id);
};

function boot(options) {
  const opts = options || {};
  const dom = new JSDOM("<!doctype html><html><body>" + (opts.body || "") + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.navigator, "onLine", { value: opts.online !== false, configurable: true });
  if (opts.storage) w.localStorage.setItem(KEY, typeof opts.storage === "string" ? opts.storage : JSON.stringify(opts.storage));
  if (opts.hook) w.__ariseLoadModule = opts.hook;
  if (opts.reporter) w.__ariseWidgetFailureReport = opts.reporter;
  fast(w);
  w.eval(read("src/reliability-watch.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

(async () => {
  /* ---------------------------------------------------------------- suite 1 */
  {
    const w = boot();
    const R = w.AriseReliability;
    ok(R.storageKey === KEY && R.maxAttempts === 3, "the key and the attempt cap are documented");
    ok(R.classify("404") === "missing", "a 404 is a missing file, not a network blip");
    ok(R.classify("failed to fetch") === "network", "a fetch failure is a network problem");
    ok(R.classify("timed out") === "slow", "a timeout is classified separately");
    ok(R.classify("Unexpected token '<'") === "broken", "a syntax error is a broken file");
    ok(R.classify("") === "unknown", "an unknown reason is not guessed");

    ok(R.shouldRetry(null, "failed") === true, "a first failure is always worth a retry");
    ok(R.shouldRetry({ attempts: 1, reason: "404" }, "404") === false, "a 404 is not retried twice");
    ok(R.shouldRetry({ attempts: 1, reason: "timed out" }, "timed out") === true, "a timeout is retried again");
    ok(R.shouldRetry({ attempts: 3, reason: "failed" }, "failed") === false, "the attempt cap is enforced: " + R.shouldRetry({ attempts: 3 }, "failed"));
    w.close();
  }

  /* ---------------------------------------------------------------- suite 2 */
  {
    let calls = [];
    // A hook whose outcome never resolves keeps each attempt observable on its
    // own; the chained-retry behaviour is covered separately below.
    const w = boot({ hook: (src) => { calls.push(src); return new Promise(() => {}); } });
    const R = w.AriseReliability;
    const plan = R.schedule("./src/example-widget.js", "failed");
    ok(plan.attempt === 1 && plan.kind === "network", "the first attempt is planned and classified: " + JSON.stringify(plan));
    ok(plan.retried === true, "the first failure is scheduled for a retry");
    ok(R.attempts()["./src/example-widget.js"].attempts === 1, "the attempt is persisted before it runs");
    await flush();
    ok(calls.length === 1 && calls[0] === "./src/example-widget.js", "the loader hook is asked to load the module again");

    const again = R.schedule("./src/example-widget.js", "failed");
    ok(again.attempt === 2, "a second failure advances the attempt count: " + again.attempt);
    ok(again.delay > plan.delay, "the delay grows between attempts: " + plan.delay + " -> " + again.delay);
    await flush();
    R.schedule("./src/example-widget.js", "failed");
    await flush();
    const capped = R.schedule("./src/example-widget.js", "failed");
    ok(capped.attempt === 4 && capped.retried === false && capped.blocked === "deterministic",
      "after the cap the retry is refused with a reason: " + JSON.stringify(capped));
    ok(calls.length === 3, "the loader is never asked more than three times: " + calls.length);

    ok(R.summaries().length === 1, "one row per failed module");
    ok(/after 3 attempts/.test(R.describe()), "the status explains the exhausted retries: " + R.describe());
    ok(R.reset() === true && R.summaries().length === 0, "reset clears the bookkeeping");
    w.close();
  }

  /* -------------------------------------------------------------- suite 2b */
  {
    // A retry that keeps failing must be bounded, and one that succeeds must stop.
    let failing = 0;
    const broken = boot({ hook: () => { failing += 1; return Promise.resolve(false); } });
    broken.AriseReliability.schedule("./src/flaky-widget.js", "failed");
    await flush(); await flush(); await flush(); await flush();
    ok(failing === 3, "a failing retry chain stops at the attempt cap: " + failing);
    ok(broken.AriseReliability.attempts()["./src/flaky-widget.js"].attempts === 3, "the cap is what stopped it");
    broken.close();

    let fixed = 0;
    const good = boot({ hook: () => { fixed += 1; return Promise.resolve(true); } });
    good.AriseReliability.schedule("./src/fixed-widget.js", "failed");
    await flush(); await flush();
    ok(fixed === 1, "a successful retry runs once: " + fixed);
    ok(!good.AriseReliability.attempts()["./src/fixed-widget.js"], "a module that loads is forgotten");
    ok(good.AriseReliability.describe() === "", "nothing is reported once the module is back");
    good.close();
  }

  /* ---------------------------------------------------------------- suite 3 */
  {
    const calls = [];
    const w = boot({ online: false, hook: (src) => { calls.push(src); return true; } });
    const R = w.AriseReliability;
    const plan = R.schedule("./src/offline-widget.js", "failed to fetch");
    ok(plan.retried === false && plan.blocked === "offline", "nothing is retried while offline: " + JSON.stringify(plan));
    ok(R.attempts()["./src/offline-widget.js"].attempts === 1, "the offline failure is still recorded for the next session");
    await flush();
    ok(calls.length === 0, "no request is made while offline");

    Object.defineProperty(w.navigator, "onLine", { value: true, configurable: true });
    w.dispatchEvent(new w.Event("online"));
    await flush();
    ok(calls.length === 1, "reconnecting retries what is still missing: " + calls.length);
    w.close();
  }

  /* ---------------------------------------------------------------- suite 4 */
  {
    // A deterministic 404: one retry, then it says reloading will not help.
    const calls = [];
    const w = boot({ hook: () => { calls.push(1); return Promise.resolve(false); } });
    const R = w.AriseReliability;
    R.schedule("./src/gone-widget.js", "404 not found");
    await flush();
    const second = R.schedule("./src/gone-widget.js", "404 not found");
    ok(second.retried === false && second.blocked === "deterministic", "a missing file is not retried forever");
    ok(calls.length === 1, "exactly one retry for a 404: " + calls.length);
    ok(/will not load on this device/.test(R.describe()) && /Reloading will not help/.test(R.describe()),
      "the status stops recommending a pointless reload: " + R.describe());
    ok(/gone/.test(R.describe()), "the module is named in human words: " + R.describe());

    // No loader hook (an older cached shell): honest about it, no fake success.
    const legacy = boot();
    const plan = legacy.AriseReliability.schedule("./src/x-widget.js", "failed");
    ok(plan.retried === true, "a retry is still attempted when the hook is absent");
    await flush();
    ok(legacy.AriseReliability.reloadModule("./src/x-widget.js").how === "unavailable",
      "the missing hook is reported instead of pretending the module reloaded");
    ok(plan.blocked === "no loader hook", "the plan carries the reason: " + plan.blocked);
    legacy.close();
    w.close();
  }

  /* ---------------------------------------------------------------- suite 5 */
  {
    // Corrupt bookkeeping must not break the page, and must not be trusted.
    const bad = boot({ storage: "{not json" });
    ok(bad.AriseReliability.attempts() && Object.keys(bad.AriseReliability.attempts()).length === 0,
      "corrupt bookkeeping is treated as empty");
    bad.close();

    const odd = boot({ storage: { "./src/a-widget.js": { attempts: 99, reason: 42, firstAt: 7 }, "./src/b-widget.js": "nope" } });
    ok(odd.AriseReliability.attempts()["./src/a-widget.js"].attempts === 3, "an out-of-range attempt count is clamped");
    ok(!odd.AriseReliability.attempts()["./src/b-widget.js"], "a malformed entry is dropped");
    odd.close();

    // The reporter is whose list is watched; it must be optional.
    const noReporter = boot();
    ok(typeof noReporter.AriseReliability.schedule === "function", "the module works without the failure reporter");
    noReporter.close();

    // A widget that mounted and then threw is observed, never re-fetched.
    const reported = [];
    const w = boot({ reporter: { failures: () => [{ src: "widget:ExamTracker", reason: "boom" }, { src: "./src/real-widget.js", reason: "failed" }] } });
    await flush();
    ok(!w.AriseReliability.attempts()["widget:ExamTracker"], "a render error is not a missing file");
    ok(w.AriseReliability.observed()["widget:ExamTracker"] === "boom", "the render error is still recorded for the status line");
    ok(!!w.AriseReliability.attempts()["./src/real-widget.js"], "a missing script is retried");
    w.close();
  }

  /* ---------------------------------------------------------------- suite 6 */
  {
    const html = read("index.html");
    const source = read("src/reliability-watch.js");
    const schema = read("src/cloud/storage-schema.js");
    const keys = read("src/storage-keys.js");
    const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

    ok(html.includes("'./src/reliability-watch.js'"), "the module is registered in the ordered SCRIPTS list");
    ok(sw.includes("./src/reliability-watch.js"), "the module joins the offline shell");
    ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");
    ok(/window\.__ariseLoadModule = function/.test(html), "the loader exposes the documented retry hook");
    ok(/CHUNK_FILES\[src\]/.test(html.slice(html.indexOf("window.__ariseLoadModule"), html.indexOf("function loadScriptsInOrder"))),
      "the hook reuses the source-file fallback instead of loading a chunk blindly");
    ok(html.indexOf("window.__ariseLoadModule") < html.indexOf("function loadScriptsInOrder"),
      "the hook is defined before the loader starts");
    ok(schema.includes('"arise-widget-retry-v1"'), "the new key is part of the audited cloud schema");
    ok(keys.includes("arise-widget-retry-v1"), "the key is documented in the key manifest");
    ok(/Holds no user data/.test(keys), "the manifest says what the key is for");
    ok(/localStorage\.setItem/.test(source) && !/localStorage\.clear|removeItem/.test(source),
      "the module writes its own bookkeeping and deletes nothing else");
  }

  console.log("\nReliability watch: " + passed + " assertions passed, " + failures.length + " failed.");
  if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
})();
