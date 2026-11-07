#!/usr/bin/env node
"use strict";

/**
 * Tests for the Arise Loading System v2 (src/loading-system.js +
 * styles/loading-system.css) and its integration into the lazy mount queue.
 *
 * Runs in jsdom: no browser is implied by anything asserted here.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
function ok(condition, label) {
  assert.ok(condition, label);
  passed += 1;
}

function makeDom(html) {
  const dom = new JSDOM(
    html || '<!doctype html><html><body><div id="t"></div><button id="b">Save</button></body></html>',
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true }
  );
  dom.window.eval(read("src/loading-system.js"));
  return dom;
}

(async function main() {
  /* ---------------------------------------------------------------- static */
  const css = read("styles/loading-system.css");
  const indexHtml = read("index.html");
  const sw = read("service-worker.js");

  ok(indexHtml.includes('<link rel="stylesheet" href="./styles/loading-system.css" />'),
    "index.html loads the loading system stylesheet");
  ok(/data-src="\.\/src\/loading-system\.js"/.test(indexHtml),
    "index.html registers the loading runtime as a protected script");
  ok(indexHtml.indexOf('href="./styles/loading-system.css"') > indexHtml.indexOf('href="./styles/animation-upgrade.css"'),
    "the loading layer is loaded after the base animation tokens");
  ok(sw.includes('"./styles/loading-system.css"') && sw.includes('"./src/loading-system.js"'),
    "the service worker caches both loading assets in the core shell");
  ok(/CACHE_NAME="arise-developer-system-v(\d+)-/.test(sw) && Number(RegExp.$1) >= 248,
    "the service worker cache version was bumped for the new assets");

  // Theme derivation: no palette colour may be hardcoded outside a var() fallback.
  const hardcoded = [...css.matchAll(/(?:^|[;{]\s*)(?:color|background|background-color|border-color)\s*:\s*([^;{}]+)/gm)]
    .map((m) => m[1])
    .filter((value) => /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(value.replace(/var\([^)]*\)/g, "")));
  ok(hardcoded.length === 0, "no hardcoded palette colours outside var() fallbacks in the loading CSS");

  for (const token of ["--ars-shimmer-duration", "--ars-skel-base", "--ars-topbar-height", "--ars-skel-gap"]) {
    ok(css.includes(token + ":"), "loading CSS defines token " + token);
  }
  for (const kind of ["ars-sk-table", "ars-sk-chart", "ars-sk-profile", "ars-sk-calendar", "ars-sk-timeline",
    "ars-sk-settings", "ars-sk-ai", "ars-sk-modal", "ars-sk-sidebar", "ars-sk-heatmap", "ars-sk-pie", "ars-sk-radar"]) {
    ok(css.includes("." + kind), "loading CSS ships a " + kind.replace("ars-sk-", "") + " shape");
  }
  ok(css.includes("@media (prefers-reduced-motion: reduce)") && css.includes("html.reduce-motion") &&
    css.includes("html.perf-lite"), "shimmer is disabled for OS reduced motion, app reduce-motion and perf-lite");
  for (const width of ["900px", "640px", "420px", "1921px"]) {
    ok(css.includes(width), "loading CSS defines a responsive rule at " + width);
  }
  ok(/\.ars-skel-group\s*\{[^}]*overflow:\s*hidden/.test(css),
    "placeholder groups clip their shimmer (no page-level overflow)");

  /* ------------------------------------------------------------- lifecycle */
  const dom = makeDom();
  const w = dom.window;
  const L = w.AriseLoading;
  ok(!!L && typeof L.run === "function", "window.AriseLoading exposes the async lifecycle helper");
  ok(w.document.querySelector("[data-ars-topbar]"), "a single global progress bar is created at boot");
  ok(w.document.querySelectorAll("[data-ars-topbar]").length === 1, "the progress bar is not duplicated");
  ok(w.document.querySelector('[data-ars-live="polite"]') && w.document.querySelector('[data-ars-live="assertive"]'),
    "one polite and one assertive live region are provided");
  w.close();

  /* ------------------------------------------------------ skeleton taxonomy */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const kinds = ["widget", "section", "dashboard", "analytics", "stat", "cards", "profile", "nav", "sidebar",
      "table", "list", "feed", "notifications", "chart", "chart-line", "chart-area", "chart-bar", "chart-pie",
      "chart-radar", "chart-heatmap", "chart-progress", "calendar", "timeline", "form", "settings", "search",
      "notes", "dsa", "ai", "modal"];
    for (const kind of kinds) {
      const host = win.document.createElement("div");
      host.innerHTML = api.skeleton(kind, { label: "Loading " + kind });
      const root = host.firstElementChild;
      ok(root.getAttribute("role") === "status", kind + " skeleton is a single polite status");
      ok(root.getAttribute("aria-busy") === "true", kind + " skeleton announces busy state");
      ok(root.querySelector(".ars-sk-body").getAttribute("aria-hidden") === "true",
        kind + " skeleton geometry is hidden from assistive technology");
      ok(host.querySelectorAll("[role='status']").length === 1, kind + " skeleton does not nest live regions");
      ok(host.textContent.trim() === "Loading " + kind, kind + " skeleton exposes only its label text");
      ok(root.getAttribute("data-ars-skeleton") === "1", kind + " skeleton is removable by the loader");
    }
    // Table anatomy
    const table = win.document.createElement("div");
    table.innerHTML = api.createTableSkeleton({ rows: 4, label: "Loading table" });
    ok(table.querySelectorAll(".ars-sk-table-row").length === 4, "table skeleton renders the requested row count");
    ok(table.querySelector(".ars-sk-table-head"), "table skeleton keeps a header row");
    ok(table.querySelectorAll(".ars-sk-table-row .ars-skel--avatar").length === 4,
      "table skeleton renders avatar placeholders");
    ok(table.querySelectorAll(".ars-sk-table-row .ars-skel--badge").length >= 8,
      "table skeleton renders badge and action placeholders");
    // Chart anatomy is shape-specific, never one generic block.
    const shapes = {
      "chart-line": ".ars-sk-line",
      "chart-pie": ".ars-sk-pie",
      "chart-radar": ".ars-sk-radar",
      "chart-heatmap": ".ars-sk-heatmap",
      "chart-progress": ".ars-sk-progress-row",
      "chart-bar": ".ars-sk-bars"
    };
    for (const [kind, selector] of Object.entries(shapes)) {
      const host = win.document.createElement("div");
      host.innerHTML = api.skeleton(kind, { label: "chart" });
      ok(host.querySelector(selector), kind + " skeleton uses its own chart geometry (" + selector + ")");
    }
    const profile = win.document.createElement("div");
    profile.innerHTML = api.createProfileSkeleton({ label: "Loading profile" });
    ok(profile.querySelector(".ars-skel--avatar-lg"), "profile skeleton renders an avatar");
    ok(api.createInlineLoader({ label: "Saving" }).includes("ars-spinner"),
      "inline loader uses the shared spinner");
    const page = api.createPageLoader({ label: "Preparing your workspace…" });
    ok(page.classList.contains("ars-page-loader") && page.querySelector(".ars-page-loader__bar"),
      "full-page loader is branded and provides an indeterminate bar");
    ok(!/%/.test(page.textContent), "full-page loader never invents a percentage");
    d.window.close();
  }

  /* ------------------------------------------------ run(): success & removal */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const host = win.document.getElementById("t");
    api.mount(host, "table", { rows: 2, label: "Loading rows" });
    ok(host.getAttribute("aria-busy") === "true" && host.querySelector("[data-ars-skeleton]"),
      "mount() renders a placeholder and marks the host busy");

    const started = Date.now();
    const data = await api.run({
      target: host,
      kind: "list",
      label: "Loading list",
      task: () => tick(30).then(() => ({ items: [1, 2, 3] })),
      render: (value) => "<p class='done'>" + value.items.length + " items</p>"
    });
    const elapsed = Date.now() - started;
    ok(data.items.length === 3, "run() resolves with the task result");
    ok(!host.querySelector("[data-ars-skeleton]"), "the placeholder is removed after success");
    ok(host.querySelector(".done"), "run() renders the supplied markup");
    ok(host.getAttribute("aria-busy") === null, "aria-busy is cleared after success");
    ok(elapsed >= api.config.minVisible, "the placeholder respects the minimum visible duration (" + elapsed + "ms)");
    d.window.close();
  }

  /* ------------------------------------------------- run(): failure & retry */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const host = win.document.getElementById("t");
    let attempts = 0;
    const spec = {
      target: host,
      kind: "widget",
      minVisible: 10,
      label: "Loading failure case",
      task: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("network down")) : Promise.resolve("ok");
      },
      render: (value) => "<p class='recovered'>" + value + "</p>"
    };
    await api.run(spec);
    ok(!!host.querySelector(".uxa-error-state"), "a failed task renders an error state");
    ok(host.querySelector("[role='alert']"), "the error state is announced as an alert");
    ok(host.getAttribute("aria-busy") === null, "aria-busy is cleared after failure");
    ok(win.document.querySelector('[data-ars-live="assertive"]').textContent.includes("network down"),
      "the failure is announced in the assertive live region");
    const retry = host.querySelector("[data-ars-retry]");
    ok(!!retry, "the error state offers a retry control");
    retry.click();
    await tick(80);
    ok(attempts === 2, "clicking retry re-runs the request");
    ok(!!host.querySelector(".recovered"), "a successful retry replaces the error state");
    ok(!host.querySelector(".ars-btn-busy") && !host.querySelector("[data-ars-retry]"),
      "no retry control or spinner is left behind after recovery");
    d.window.close();
  }

  /* ------------------------------------- run(): preserve existing content */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const host = win.document.getElementById("t");
    host.innerHTML = "<p class='old'>Saved 42 problems</p>";
    const promise = api.run({
      target: host,
      kind: "table",
      label: "Refreshing…",
      minVisible: 10,
      task: () => tick(40).then(() => "new"),
      render: () => "<p class='new'>Saved 43 problems</p>"
    });
    ok(host.textContent.includes("Saved 42 problems"), "a refresh keeps the previous content visible");
    ok(host.classList.contains("ars-refreshing"), "a refresh is marked with the subtle refresh state");
    ok(!!host.querySelector("[data-ars-refresh-chip]"), "a refresh shows a compact refresh indicator");
    ok(!host.querySelector("[data-ars-skeleton]"), "a refresh does not replace content with a skeleton");
    await promise;
    ok(host.textContent.includes("Saved 43 problems") && !host.classList.contains("ars-refreshing"),
      "the refresh finishes into new content and clears its indicator");
    ok(!host.querySelector("[data-ars-refresh-chip]"), "the refresh chip is removed on success");
    d.window.close();
  }

  /* ------------------------------------------ run(): stale & cancelled work */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const host = win.document.getElementById("t");
    let slowSignal = null;
    const slow = api.run({
      target: host,
      kind: "list",
      minVisible: 5,
      task: (ctx) => {
        slowSignal = ctx.signal;
        return tick(120).then(() => "slow");
      },
      render: () => "<p class='slow'>stale</p>"
    });
    const fast = api.run({
      target: host,
      kind: "list",
      minVisible: 5,
      task: () => tick(20).then(() => "fast"),
      render: () => "<p class='fast'>fresh</p>"
    });
    ok(slowSignal && slowSignal.aborted, "a newer run aborts the superseded request");
    await Promise.all([slow, fast]);
    ok(host.querySelector(".fast") && !host.querySelector(".slow"),
      "a stale completion cannot overwrite fresher content");
    ok(host.getAttribute("aria-busy") === null, "aria-busy is cleared once the newest run settles");
    d.window.close();
  }

  /* ------------------------------------------------- empty vs loading vs error */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const host = win.document.getElementById("t");
    await api.run({
      target: host,
      kind: "list",
      minVisible: 5,
      task: () => Promise.resolve([]),
      empty: (rows) => rows.length === 0,
      emptyState: { title: "No notes yet", message: "Create your first note to see it here." }
    });
    ok(host.querySelector(".uxa-empty-state"), "an empty result renders an empty state");
    ok(!host.querySelector("[data-ars-skeleton]"), "no skeleton is left behind on an empty result");
    ok(host.textContent.includes("No notes yet"), "the empty state is the caller's, not a loading message");
    api.state(host, "error", { message: "Could not sync", onRetry: () => {} });
    ok(host.querySelector(".uxa-error-state") && !host.querySelector(".uxa-empty-state"),
      "the same host can move from empty to error without stale markup");
    api.state(host, "offline", { onRetry: () => {} });
    ok(host.querySelector(".uxa-offline-state"), "offline is a distinct state from empty and error");
    d.window.close();
  }

  /* ------------------------------------------------------------- buttons --- */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const btn = win.document.getElementById("b");
    let calls = 0;
    const first = api.button.guard(btn, async () => {
      calls += 1;
      await tick(20);
      return "done";
    }, { label: "Saving…" });
    ok(btn.disabled === true, "a guarded button is disabled while the action runs");
    ok(btn.getAttribute("aria-busy") === "true", "a guarded button exposes aria-busy");
    ok(btn.querySelector(".uxa-spinner, .ars-spinner"), "a guarded button shows an inline spinner");
    ok(btn.textContent.trim() === "Saving…", "a guarded button swaps to the busy label");
    const duplicate = api.button.guard(btn, async () => {
      calls += 1;
    });
    await Promise.all([first, duplicate]);
    ok(calls === 1, "duplicate submissions are prevented while the button is busy");
    ok(btn.disabled === false, "the button is enabled again after success");
    ok(btn.textContent.trim() === "Save", "the original label is restored exactly");
    ok(btn.getAttribute("aria-busy") === null, "aria-busy is removed after success");

    await api.button.guard(btn, async () => {
      throw new Error("save failed");
    }).catch(() => {});
    ok(btn.disabled === false && btn.textContent.trim() === "Save",
      "a failed action can never leave the button permanently loading");
    ok(win.document.querySelector('[data-ars-live="assertive"]').textContent.includes("save failed"),
      "a failed action is announced");
    d.window.close();
  }

  /* ------------------------------------------------------- progress bar ---- */
  {
    const d = makeDom();
    const win = d.window;
    const api = win.AriseLoading;
    const bar = win.document.querySelector("[data-ars-topbar]");
    api.progress.start();
    api.progress.start();
    ok(bar.getAttribute("data-state") === "active", "the top progress bar activates for async work");
    ok(Number(bar.style.getPropertyValue("--ars-progress")) > 0, "the bar advances while work is pending");
    api.progress.done();
    ok(bar.getAttribute("data-state") === "active", "the bar stays visible while another operation is pending");
    api.progress.done();
    ok(bar.getAttribute("data-state") === "done", "the bar completes when the last operation finishes");
    await tick(api.config.progressDone + 40);
    ok(bar.getAttribute("data-state") === "idle", "the completed bar hides itself");
    api.progress.start();
    api.progress.fail();
    ok(bar.getAttribute("data-state") === "error", "a failed operation marks the progress bar as an error");
    api.progress.set(0.5);
    ok(bar.getAttribute("data-mode") === null && Number(bar.style.getPropertyValue("--ars-progress")) === 0.5,
      "determinate progress uses only a caller-supplied fraction");
    d.window.close();
  }

  /* ------------------------------------------------ announcements & images -- */
  {
    const d = makeDom('<!doctype html><html><body><img id="i" src="avatar.png" alt="Avatar"><div id="t"></div></body></html>');
    const win = d.window;
    const api = win.AriseLoading;
    api.announce("Loading your dashboard…");
    const region = win.document.querySelector('[data-ars-live="polite"]');
    ok(region.textContent === "Loading your dashboard…", "polite announcements reach one shared region");
    ok(win.document.querySelectorAll("[data-ars-live]").length === 2,
      "no extra live region is created per announcement");

    const img = win.document.getElementById("i");
    api.enhanceImages(win.document);
    ok(img.getAttribute("data-ars-img") === "pending" && img.classList.contains("ars-img-loading"),
      "images get a placeholder until they decode");
    img.dispatchEvent(new win.Event("load"));
    ok(img.getAttribute("data-ars-img") === "loaded" && !img.classList.contains("ars-img-loading"),
      "a decoded image clears its placeholder");
    const broken = win.document.createElement("img");
    broken.setAttribute("src", "missing.png");
    broken.setAttribute("alt", "Broken");
    win.document.body.appendChild(broken);
    api.enhanceImages(win.document);
    broken.dispatchEvent(new win.Event("error"));
    ok(broken.getAttribute("data-ars-img") === "error" && broken.classList.contains("ars-img-error"),
      "a failed image falls back instead of showing an empty box");

    api.offline.show();
    const banner = win.document.querySelector(".ars-offline");
    ok(banner && banner.hidden === false, "going offline shows the connectivity banner");
    ok(region.textContent.includes("offline"), "the offline transition is announced");
    api.offline.hide();
    ok(banner.hidden === true, "reconnecting hides the banner");
    d.window.close();
  }

  /* -------------------------------- lazy widget mount queue integration ---- */
  {
    const d = makeDom('<!doctype html><html><body><div id="host"></div></body></html>');
    const win = d.window;
    const loader = indexHtml.match(/<script>([\s\S]*?)<\/script>/g)
      .map((tag) => tag.replace(/^<script>|<\/script>$/g, ""))
      .find((src) => src.includes("var NAMES = [") && src.includes("__ariseFlushMounts"));
    ok(!!loader, "the lazy mount queue script is present in index.html");
    win.eval(loader);
    const host = win.document.getElementById("host");
    win.__mountCompetitiveProgramming(host);
    ok(host.getAttribute("aria-busy") === "true", "an early mount marks its host busy");
    const skeleton = host.querySelector("[data-arise-skeleton]");
    ok(!!skeleton, "an early mount renders a content-shaped placeholder");
    ok(skeleton.querySelector(".ars-sk-table, .ars-sk-bars, .ars-sk-card, .ars-sk-grid"),
      "the placeholder matches the widget's real content shape");
    win.__mountCompetitiveProgramming(host);
    ok(host.querySelectorAll("[data-arise-skeleton]").length === 1,
      "repeated mounting does not stack placeholders");
    win.__mountCompetitiveProgramming = (el) => {
      el.textContent = "Competitive programming ready";
    };
    win.__ariseFlushMounts();
    ok(host.textContent === "Competitive programming ready", "the real mount replaces the placeholder");
    ok(host.getAttribute("aria-busy") === null && !host.querySelector("[data-ars-skeleton]"),
      "the placeholder and busy flag are cleared after mounting");
  }

  /* -------------------------------- source integration sanity (no dead code) */
  {
    const aiSource = read("src/ai-real-insights-widget.js");
    ok(aiSource.includes('loading.skeleton("ai"'), "AI insights uses the dedicated AI skeleton");
    ok(aiSource.includes("ars-ai-thinking"), "AI insights shows a thinking indicator while a request is in flight");
    ok(!/showing|analysing your (syllabus|data)/i.test(aiSource), "AI copy makes no claim about hidden work");

    const backup = read("src/backup-center-widget.js");
    ok(backup.includes("Loading.button.busy") && backup.includes("Loading.progress.start"),
      "backup/restore operations use shared button and progress states");
    ok(backup.includes("data-cloud-busy"), "backup actions guard against duplicate submissions");

    const nav = read("src/widget-nav.js");
    ok(nav.includes("AriseLoading.progress") && nav.includes("pulse"),
      "widget navigation shows the shared route transition progress");

    const sheets = read("src/interview-sheets-widget.js");
    ok(sheets.includes("AriseLoading.announce"),
      "interview-sheet filtering reports result counts instead of flashing a skeleton");

    const coverage = read("src/dsa-sheet-coverage-widget.js");
    ok(/aria-busy/.test(coverage) && /uxa-retry-btn/.test(coverage),
      "sheet coverage keeps explicit loading, error and retry states");
  }

  console.log("\nLoading system v2: " + passed + " assertions passed.");
})().catch((error) => {
  console.error("\nLoading system v2 FAILED:");
  console.error(error);
  process.exitCode = 1;
});
