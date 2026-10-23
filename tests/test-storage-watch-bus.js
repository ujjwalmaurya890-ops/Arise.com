// Smoke test for src/storage-watch-bus.js — window.__ARISE_STORAGE_WATCH_BUS__,
// the shared 1200ms localStorage poller that every cross-widget "did that
// other widget write this key" listener (readiness engine, XP system, etc.)
// registers against instead of running its own setInterval.
//
// Runs under Node with a fake timer: setInterval/clearInterval are stubbed
// so the test controls exactly when a "tick" fires instead of waiting on
// wall-clock time. Run with: node tests/storage-watch-bus.js
"use strict";

var VERBOSE = process.env.DEBUG === "1" || process.argv.indexOf("--verbose") !== -1;

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function makeLocalStorage() {
  var store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { store = {}; }
  };
}

// Fake timer: capture the tick callback + interval ms instead of actually
// scheduling anything, so the test can fire ticks on demand.
var scheduled = null; // { fn, ms } | null
function fakeSetInterval(fn, ms) { scheduled = { fn: fn, ms: ms }; return 1; }
function fakeClearInterval(id) { scheduled = null; }

var listeners = {};
var fakeDocument = {
  hidden: false,
  addEventListener: function (type, cb) {
    listeners[type] = listeners[type] || [];
    listeners[type].push(cb);
  },
  dispatchEvent: function () { return true; }
};
function fireVisibilityChange() {
  (listeners.visibilitychange || []).forEach(function (cb) { cb(); });
}

var sandbox = {
  console: console,
  setInterval: fakeSetInterval,
  clearInterval: fakeClearInterval,
  document: fakeDocument
};
sandbox.window = {};
sandbox.window.localStorage = makeLocalStorage();
sandbox.localStorage = sandbox.window.localStorage;
vm.createContext(sandbox);

var code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "src/storage-watch-bus.js"), "utf8");
vm.runInContext(code, sandbox, { filename: "src/storage-watch-bus.js" });

var bus = sandbox.window.__ARISE_STORAGE_WATCH_BUS__;

var pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error("FAIL: " + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + " (expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual) + ")");
}

ok(!!bus, "window.__ARISE_STORAGE_WATCH_BUS__ is exposed");
ok(typeof bus.watch === "function", "bus.watch is a function");

// --- watch() starts the shared timer exactly once, at 1200ms ---
var calls = [];
bus.watch("someKey", function (raw) { calls.push(raw); });
ok(!!scheduled, "watch(): registering the first watcher starts the shared interval");
eq(scheduled.ms, 1200, "watch(): shared interval runs at 1200ms");

// --- a second watcher does NOT start a second timer (one shared timer for all watchers) ---
var scheduledBeforeSecondWatch = scheduled;
bus.watch("otherKey", function () {});
ok(scheduled === scheduledBeforeSecondWatch, "watch(): a second watcher reuses the existing shared timer, doesn't create a new one");

// --- callback fires only when the watched key's value actually changes ---
scheduled.fn(); // tick with no change yet (key still unset)
eq(calls.length, 0, "tick: callback does not fire when the key is still null/unset");

sandbox.localStorage.setItem("someKey", "v1");
scheduled.fn();
eq(calls.length, 1, "tick: callback fires once when the watched key changes to a new value");
eq(calls[0], "v1", "tick: callback receives the raw new value");

scheduled.fn(); // tick again, value unchanged since last tick
eq(calls.length, 1, "tick: callback does not fire again if the value hasn't changed since the last tick");

sandbox.localStorage.setItem("someKey", "v2");
scheduled.fn();
eq(calls.length, 2, "tick: callback fires again when the value changes a second time");
eq(calls[1], "v2", "tick: callback receives the latest raw value");

// --- a throwing watcher callback doesn't break other watchers on the same tick ---
var otherCalls = [];
var isolationSandboxOk = true;
bus.watch("boomKey", function () { throw new Error("boom"); });
bus.watch("safeKey", function (raw) { otherCalls.push(raw); });
sandbox.localStorage.setItem("boomKey", "x");
sandbox.localStorage.setItem("safeKey", "y");
try { scheduled.fn(); } catch (e) { isolationSandboxOk = false; }
ok(isolationSandboxOk, "tick: a throwing watcher callback does not propagate out of the tick");
eq(otherCalls.length, 1, "tick: other watchers still run when a sibling watcher's callback throws");

// --- pausing while the tab is hidden, resuming when visible again ---
fakeDocument.hidden = true;
fireVisibilityChange();
eq(scheduled, null, "visibilitychange (hidden): shared timer is cleared while the tab is hidden");

fakeDocument.hidden = false;
fireVisibilityChange();
ok(!!scheduled, "visibilitychange (visible): shared timer restarts when the tab becomes visible again");

// --- calling watch() with a bad signature is a no-op, not a throw ---
var badCallOk = true;
try {
  bus.watch(123, function () {});
  bus.watch("keyWithNoCallback", null);
} catch (e) { badCallOk = false; }
ok(badCallOk, "watch(): non-string key or non-function callback is ignored, not thrown");

if (VERBOSE || fail) console.log((fail === 0 ? "PASS" : "FAIL") + ": " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
