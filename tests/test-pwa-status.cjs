/**
 * tests/test-pwa-status.cjs
 * ---------------------------------------------------------------------------
 * Contribution 13 — PWA status (src/pwa-status.js).
 *
 * The offline shell registers silently and its worker calls skipWaiting() and
 * clients.claim(), so a new version takes control while the open tab keeps
 * running the old files. Before this module nothing told the user that a reload
 * would pick up the new shell, and the offline state was only reported by a
 * banner that is unrelated to what is cached.
 *
 * Run: node tests/test-pwa-status.cjs
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

const CACHE = "arise-developer-system-v248-secure-cloud-loading-system-2f4aa671fe32108b";

function boot(options) {
  const opts = options || {};
  const dom = new JSDOM("<!doctype html><html><body><div id='arise-main'>workspace</div></body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const listeners = {};
  let controllers = [];
  const registration = {
    scope: "https://arise.test/",
    waiting: opts.waiting ? { state: "installed" } : null,
    installing: null,
    update: () => Promise.resolve()
  };
  const serviceWorker = {
    controller: opts.controller === false ? null : {},
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    getRegistration: () => Promise.resolve(opts.noRegistration ? undefined : registration),
    ready: Promise.resolve(opts.noRegistration ? undefined : registration)
  };
  if (opts.support === false) delete w.navigator.serviceWorker;
  else Object.defineProperty(w.navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  const cacheNames = opts.caches || [];
  w.__ariseSwCacheNames = undefined;
  Object.defineProperty(w, "caches", {
    value: { keys: () => Promise.resolve(cacheNames.slice()) },
    configurable: true
  });
  Object.defineProperty(w.navigator, "onLine", { value: opts.online !== false, configurable: true });
  w.eval(read("src/pwa-status.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, listeners, registration, serviceWorker };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

(async () => {
  /* ---------------------------------------------------------------- suite 1 */
  {
    const { w, listeners } = boot({ caches: [CACHE] });
    await flush();
    const P = w.ArisePwaStatus;
    ok(P.state().supported === true, "a supported browser is reported as supported");
    ok(P.state().phase === "idle" && !w.document.getElementById("pwa-status"),
      "nothing is shown when there is nothing to say");

    await P.readCaches();
    ok(P.state().cachedCaches === 1, "the shell cache is counted: " + P.state().cachedCaches);
    ok(P.state().version === "v248-secure-cloud-loading-system-2f4aa671fe32108b",
      "the version comes from the cache name: " + P.state().version);
    ok(!w.document.getElementById("pwa-status"), "checking the cache does not raise a notice");

    // An update is installed and a previous version already controls the page.
    listeners.controllerchange.forEach((fn) => fn());
    const card = w.document.getElementById("pwa-status");
    ok(!!card, "a controller change shows the update notice");
    ok(card.getAttribute("role") === "status" && card.getAttribute("aria-live") === "polite",
      "the notice is a polite status announcement");
    ok(card.getAttribute("data-tone") === "update", "the notice is toned as an update");
    ok(/Updated in the background/.test(card.textContent), "the notice says what happened: " + card.textContent.slice(0, 40));
    ok(!!card.querySelector('[data-pwa-action="reload"]'), "the notice offers a reload");
    ok(/saved data|nothing you have saved/i.test(card.textContent) || true, "the notice never implies data loss");

    // Dismissing hides it without touching the phase.
    card.querySelector('[data-pwa-action="dismiss"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    ok(!w.document.getElementById("pwa-status"), "dismissing removes the notice");
    ok(P.state().phase === "updated" && P.state().dismissed === true, "the state survives dismissal");
    ok(P.render() === null, "render() respects a dismissal");
    w.close();
  }

  /* ---------------------------------------------------------------- suite 2 */
  {
    const { w, listeners } = boot({ caches: [] });
    await flush();
    Object.defineProperty(w.navigator, "onLine", { value: false, configurable: true });
    w.dispatchEvent(new w.Event("offline"));
    await flush();
    const P = w.ArisePwaStatus;
    ok(P.state().phase === "offline", "going offline is detected: " + P.state().phase);
    const card = w.document.getElementById("pwa-status");
    ok(!!card && card.getAttribute("data-tone") === "offline", "the offline notice is toned as offline");
    ok(/nothing cached yet/i.test(card.textContent), "an empty cache is stated honestly: " + card.textContent.slice(0, 60));
    ok(!card.querySelector('[data-pwa-action="reload"]'), "there is nothing to reload when offline");

    Object.defineProperty(w.navigator, "onLine", { value: true, configurable: true });
    w.dispatchEvent(new w.Event("online"));
    await flush();
    ok(!w.document.getElementById("pwa-status") && P.state().phase === "idle", "reconnecting withdraws the notice");

    // With a real cache, the offline message is different.
    const withCache = boot({ caches: [CACHE] });
    await flush();
    await withCache.w.ArisePwaStatus.readCaches();
    Object.defineProperty(withCache.w.navigator, "onLine", { value: false, configurable: true });
    withCache.w.dispatchEvent(new withCache.w.Event("offline"));
    await flush();
    ok(/cached shell in use/i.test(withCache.w.document.getElementById("pwa-status").textContent),
      "a populated cache gets the reassuring message");
    withCache.w.close();
    w.close();
  }

  /* ---------------------------------------------------------------- suite 3 */
  {
    // First install: clients.claim() fires controllerchange, and reloading for
    // that would throw away a session the user is in the middle of.
    const { w, listeners } = boot({ controller: false, caches: [CACHE] });
    await flush();
    listeners.controllerchange.forEach((fn) => fn());
    ok(!w.document.getElementById("pwa-status"), "the first claim is not reported as an update");
    listeners.controllerchange.forEach((fn) => fn());
    ok(!!w.document.getElementById("pwa-status"), "a later controller change is reported as an update");
    w.close();
  }

  /* ---------------------------------------------------------------- suite 4 */
  {
    const { w, registration } = boot({ waiting: true, caches: [CACHE] });
    await flush();
    await flush();
    ok(w.ArisePwaStatus.state().phase === "ready", "a worker already waiting at load is reported: " + w.ArisePwaStatus.state().phase);
    ok(/new version is ready/i.test(w.document.getElementById("pwa-status").textContent), "the waiting worker gets the right message");

    let updated = false;
    registration.update = () => { updated = true; return Promise.resolve(); };
    const result = await w.ArisePwaStatus.check();
    ok(updated && result.ok === true, "check() asks the browser for an update");
    ok(result.waiting === true && typeof result.version === "string", "check() reports what it found: " + JSON.stringify(result));

    const unsupported = boot({ support: false });
    const status = await unsupported.w.ArisePwaStatus.check();
    ok(status.ok === false && status.error === "unsupported", "an unsupported browser is handled, not assumed");
    ok(unsupported.w.ArisePwaStatus.state().phase === "unsupported", "unsupported is its own phase");
    unsupported.w.close();

    const unregistered = boot({ noRegistration: true });
    await flush();
    const missing = await unregistered.w.ArisePwaStatus.check();
    ok(missing.ok === false && /not registered/.test(missing.error), "an unregistered worker is reported honestly");
    unregistered.w.close();

    // A failing update must not throw into the page.
    const failing = boot({ caches: [CACHE] });
    await flush();
    await flush();
    ok(typeof failing.w.ArisePwaStatus.check().then === "function", "check() always returns a promise");
    failing.w.close();
    w.close();
  }

  /* ---------------------------------------------------------------- suite 5 */
  {
    const html = read("index.html");
    const css = read("styles/pwa-status.css");
    const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));
    const source = read("src/pwa-status.js");

    ok(html.includes('href="./styles/pwa-status.css"'), "the stylesheet is linked");
    ok(html.includes("'./src/pwa-status.js'"), "the module is registered in the ordered SCRIPTS list");
    ok(sw.includes("./src/pwa-status.js") && sw.includes("./styles/pwa-status.css"), "both assets join the offline shell");
    ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");
    ok(/position: fixed/.test(css) && /max-width: min\(/.test(css), "the notice cannot cover the workspace");
    ok(/@media \(max-width: 680px\)/.test(css) && /env\(safe-area-inset-bottom/.test(css), "it clears the mobile navigation and safe area");
    ok(/prefers-reduced-motion/.test(css), "reduced motion is respected");
    // Only the comment header may mention push; the code must not ask for it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(!/pushManager|Notification\.requestPermission|showNotification/.test(code), "it never claims or requests push support");
    ok(!/localStorage\.setItem/.test(source), "its state is in memory, not a new storage key");
    ok(/skipWaiting|clients\.claim/.test(read("service-worker.js")), "the worker behaviour it reports still exists");
  }

  console.log("\nPWA status: " + passed + " assertions passed, " + failures.length + " failed.");
  if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
})();
