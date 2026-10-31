// Reproducible local lab protocol used for the 2026-10-30 audit.
// Test-only auth/cloud fixture; no field INP, Lighthouse or live-service claims.
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("playwright-core"), binModule = require("@sparticuz/chromium"), bin = binModule.default || binModule;
const { buildSync } = require("esbuild");
const root = process.cwd(), { fixture } = require(path.join(root, "tests/cloud/helpers.cjs"));
const origin = process.env.ARISE_TEST_URL || "http://127.0.0.1:8123";
const label = process.argv[2] || "measurement";
if (!/^[a-z0-9-]{1,50}$/i.test(label)) throw new Error("Use a short alphanumeric measurement label.");
fs.mkdirSync(path.join(root, ".test-artifacts/overhaul"), { recursive: true });
const auth = buildSync({ stdin: { contents: `import {createController} from './src/cloud/auth-controller.js';import {startProtectedRuntime} from './src/cloud/protected-runtime.js';import * as codec from './src/cloud/backup-codec.js';window.AriseBackupCodec=codec;let user={uid:'uid-1',getIdToken:async()=> 'token-1'},watch;createController({user:()=>user,signIn:async()=>watch(user),signOut:async()=>{user=null;await watch(null)},watch:next=>{watch=next;next(user)}});startProtectedRuntime();`, resolveDir: root }, bundle: true, format: "esm", write: false }).outputFiles[0].text;
function observe() {
  window.__lab = { lcp: 0, shifts: [], events: [], longTasks: [] };
  for (const type of ["largest-contentful-paint", "layout-shift", "event", "longtask"]) {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (type === "largest-contentful-paint") window.__lab.lcp = e.startTime;
          if (type === "layout-shift" && !e.hadRecentInput) window.__lab.shifts.push({ t: e.startTime, v: e.value, sources: (e.sources || []).map((s) => ({ node: s.node?.tagName + "#" + s.node?.id + "." + String(s.node?.className).slice(0, 80), previous: s.previousRect, current: s.currentRect })) });
          if (type === "event" && e.interactionId) window.__lab.events.push({ id: e.interactionId, duration: e.duration, name: e.name, t: e.startTime });
          if (type === "longtask") window.__lab.longTasks.push({ t: e.startTime, duration: e.duration });
        }
      }).observe({ type, buffered: true, ...type === "event" ? { durationThreshold: 16 } : {} });
    } catch {
    }
  }
}
function collect() {
  const n = performance.getEntriesByType("navigation")[0], p = performance.getEntriesByType("paint"), l = window.__lab;
  let max = 0, current = 0, start = 0, last = 0;
  for (const s of l.shifts) {
    if (s.t - last > 1e3 || s.t - start > 5e3) {
      current = 0;
      start = s.t;
    }
    current += s.v;
    max = Math.max(max, current);
    last = s.t;
  }
  const res = performance.getEntriesByType("resource").filter((r) => r.name.startsWith(location.origin));
  return { fcpMs: p.find((x) => x.name === "first-contentful-paint")?.startTime ?? null, lcpMs: l.lcp, ttfbMs: n.responseStart, domContentLoadedMs: n.domContentLoadedEventEnd, loadEventMs: n.loadEventEnd, widgetsReadyMs: window.__ariseWidgetsReadyAt ?? null, cls: max, clsSum: l.shifts.reduce((s, x) => s + x.v, 0), maxInteractionMs: l.events.length ? Math.max(...l.events.map((x) => x.duration)) : null, interactionCount: new Set(l.events.map((x) => x.id)).size, longTaskCount: l.longTasks.length, longTaskTotalMs: l.longTasks.reduce((s, x) => s + x.duration, 0), resourceCount: res.length, decodedBytes: res.reduce((s, r) => s + r.decodedBodySize, 0), scriptDecodedBytes: res.filter((r) => new URL(r.name).pathname.endsWith(".js")).reduce((s, r) => s + r.decodedBodySize, 0), cssDecodedBytes: res.filter((r) => new URL(r.name).pathname.endsWith(".css")).reduce((s, r) => s + r.decodedBodySize, 0), resources: res.map((r) => ({ path: new URL(r.name).pathname, encoded: r.encodedBodySize, decoded: r.decodedBodySize })), shifts: l.shifts };
}
(async () => {
  const libraries = await binModule.inflate(path.join(path.dirname(require.resolve("@sparticuz/chromium")), "../bin/al2023.tar.br"));
  const browser = await chromium.launch({ args: bin.args.filter((x) => !["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials", "--single-process"].includes(x)), executablePath: await bin.executablePath(), headless: true, env: { ...process.env, LD_LIBRARY_PATH: path.join(libraries, "lib") + ":" + (process.env.LD_LIBRARY_PATH || "") } });
  const report = { label, date: (/* @__PURE__ */ new Date()).toISOString(), browser: browser.version(), method: "Cold browser contexts, local server, no CPU/network throttling, 3 runs per viewport; fixture-auth only for authenticated runs; service workers blocked. Event Timing is lab maximum, NOT field INP.", runs: [] };
  try {
    const locked = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await locked.addInitScript(observe);
    let p = await locked.newPage(), req = [];
    p.on("request", (r) => req.push(r.url()));
    await p.goto(origin);
    await p.getByRole("button", { name: "Retry connection", exact: true }).waitFor();
    await p.waitForTimeout(500);
    report.lockedBeforeInteraction = await p.evaluate(collect);
    await p.keyboard.press("Tab");
    await p.waitForTimeout(2500);
    report.lockedAfterInteraction = { ...await p.evaluate(collect), widgetRequests: req.filter((u) => u.includes("/assets/chunks/")), widgetStarted: await p.evaluate(() => !!window.__ariseLazyWidgetsStarted), widgetReady: await p.evaluate(() => !!window.__ariseWidgetsReady) };
    await locked.close();
    console.log("locked gate", report.lockedAfterInteraction.widgetRequests.length, "widget chunks requested");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) for (let run = 1; run <= 3; run++) {
      const f = fixture(), context = await browser.newContext({ viewport, serviceWorkers: "block" });
      await context.addInitScript(observe);
      await context.route("**/assets/cloud-auth.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: auth }));
      await context.route("**/api/cloud**", async (r) => {
        let q = r.request(), u = new URL(q.url()), res = await f.handler({ httpMethod: q.method(), headers: q.headers(), queryStringParameters: Object.fromEntries(u.searchParams), body: q.postData() || "" });
        await r.fulfill({ status: res.statusCode, headers: res.headers, body: res.body });
      });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin);
      await page.waitForFunction(() => document.documentElement.dataset.cloudAuth === "ready" && document.getElementById("arise-main"));
      await page.waitForTimeout(2e3);
      let initial = await page.evaluate(collect);
      await page.waitForFunction(() => window.__ariseWidgetsReady === true, null, { timeout: 45e3 });
      await page.waitForTimeout(1e3);
      let boot = await page.evaluate(collect);
      if (run === 1) await page.screenshot({ path: path.join(root, ".test-artifacts/overhaul", label + "-" + viewport.width + ".png") });
      async function nav(name) {
        if (viewport.width < 1024) {
          await page.locator("#arise-menu-btn").click();
        }
        await page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click();
        await page.waitForTimeout(700);
      }
      await nav("Analytics");
      await page.waitForFunction(() => !!globalThis.__ARISE_ANALYTICS_MODULE__);
      await page.waitForTimeout(1e3);
      let analytics = await page.evaluate(collect);
      await nav("Notes");
      await nav("Dashboard");
      let final = await page.evaluate(collect);
      report.runs.push({ viewport, run, initial, boot, analytics, final, errors });
      console.log(viewport.width, run, JSON.stringify({ fcp: boot.fcpMs, lcp: boot.lcpMs, cls: boot.cls, navCLS: analytics.cls, event: final.maxInteractionMs, ready: boot.widgetsReadyMs, requests: boot.resourceCount, errors }));
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(root, ".test-artifacts/overhaul", label + "-metrics.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
