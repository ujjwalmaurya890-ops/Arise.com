#!/usr/bin/env node
"use strict";

/**
 * Regression test suite for the Loading, Skeleton, Async Race, Error Boundary,
 * Motion Design System & Reduced-Motion Overhaul.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log("  ok  " + label);
  } else {
    failed++;
    console.error("  FAIL  " + label);
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function walkJs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJs(p));
    else if (ent.name.endsWith(".js")) out.push(p);
  }
  return out;
}

(async function main() {
  // -------------------------------------------------------------------------
  // 1. Static Design System & Reduced-Motion Contract Checks
  // -------------------------------------------------------------------------
  const animCss = fs.readFileSync(path.join(ROOT, "styles/animation-upgrade.css"), "utf8");
  const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  for (const token of [
    "--motion-fast",
    "--motion-micro",
    "--motion-normal",
    "--motion-panel",
    "--motion-section",
    "--motion-spinner",
    "--motion-skeleton",
    "--ease-standard",
    "--ease-out-quart",
    "--loader-size-sm",
    "--loader-size-md",
    "--skeleton-radius-md",
    "--skeleton-delay",
    "--overlay-scrim-bg"
  ]) {
    ok(animCss.includes(token + ":"), "styles/animation-upgrade.css defines centralized token " + token);
  }

  ok(
    indexHtml.includes('<link rel="stylesheet" href="./styles/animation-upgrade.css" />') &&
      !indexHtml.includes('href="./styles/animation-upgrade.css" media="print"'),
    "index.html loads ./styles/animation-upgrade.css synchronously without print-media FOUC race"
  );

  const unguardedSmooth = walkJs(path.join(ROOT, "src")).filter((f) =>
    /behavior:\s*["']smooth["']/.test(fs.readFileSync(f, "utf8"))
  );
  ok(unguardedSmooth.length === 0, "zero unguarded scrollIntoView({ behavior: 'smooth' }) calls remain in src/");

  // -------------------------------------------------------------------------
  // 2. Mount Safety Error Boundary & Button Busy Width-Lock Helpers
  // -------------------------------------------------------------------------
  {
    const dom = new JSDOM("<!doctype html><html><body><div id='slot'></div><button id='btn'>Save</button></body></html>", {
      url: "https://arise.example.test/",
      pretendToBeVisual: true,
      runScripts: "outside-only"
    });
    const w = dom.window;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };

    let attempts = 0;
    w.__mountBrokenTestWidget = function (el) {
      attempts++;
      if (attempts === 1) throw new Error("Simulated mount crash");
      el.innerHTML = "<div class='recovered-widget'>Widget Ready</div>";
    };

    w.eval(fs.readFileSync(path.join(ROOT, "src/animation-upgrade.js"), "utf8"));
    w.eval(fs.readFileSync(path.join(ROOT, "src/mount-safety.js"), "utf8"));

    const slot = w.document.getElementById("slot");
    slot.setAttribute("aria-busy", "true");
    w.__mountBrokenTestWidget(slot);

    const errBox = slot.querySelector('[data-uxa-mount-error="1"][role="alert"]');
    ok(!!errBox && !slot.hasAttribute("aria-busy"), "mount-safety clears aria-busy and renders role='alert' error boundary on crash");

    const retryBtn = slot.querySelector("[data-uxa-mount-retry]");
    ok(!!retryBtn, "mount-safety renders a retry button inside failed mount slot");
    retryBtn.click();
    ok(
      !!slot.querySelector(".recovered-widget") && attempts === 2,
      "clicking Retry re-runs wrapped mount and recovers cleanly"
    );

    const btn = w.document.getElementById("btn");
    Object.defineProperty(btn, "offsetWidth", { value: 94, configurable: true });
    w.AriseAnimationUpgrade.setButtonBusy(btn, true, "Saving…");
    ok(
      btn.disabled === true &&
        btn.getAttribute("aria-busy") === "true" &&
        btn.style.minWidth === "94px" &&
        !!btn.querySelector(".uxa-spinner"),
      "setButtonBusy locks button width, disables button, sets aria-busy='true', and renders inline spinner"
    );
    w.AriseAnimationUpgrade.setButtonBusy(btn, false);
    ok(
      btn.disabled === false &&
        !btn.hasAttribute("aria-busy") &&
        btn.textContent === "Save" &&
        btn.style.minWidth === "",
      "setButtonBusy restores original label, enabled state, and minWidth cleanly"
    );
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  // 3. Competitive Programming Stale-Handle Cancellation & Account Switch Race
  // -------------------------------------------------------------------------
  {
    const dom = new JSDOM("<!doctype html><html><body><div id='cp-root'></div></body></html>", {
      url: "https://arise.example.test/",
      pretendToBeVisual: true,
      runScripts: "outside-only"
    });
    const w = dom.window;
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.setInterval = () => 0;
    w.clearInterval = () => {};
    w.requestIdleCallback = () => {};
    w.alert = () => {};

    let resolveSlowUser = null;
    w.fetch = (url) => {
      const u = String(url);
      if (u.includes("slow_octo")) {
        return new Promise((resolve) => {
          resolveSlowUser = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () =>
                u.endsWith("/repos?per_page=100&sort=updated") || u.includes("/events/")
                  ? []
                  : { login: "slow_octo", name: "Slow Octo", public_repos: 99, followers: 1 }
            });
        });
      }
      if (u.includes("fast_torvalds")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            u.endsWith("/repos?per_page=100&sort=updated") || u.includes("/events/")
              ? []
              : { login: "fast_torvalds", name: "Fast Torvalds", public_repos: 7, followers: 500 }
        });
      }
      return Promise.reject(new Error("no network"));
    };

    w.eval(fs.readFileSync(path.join(ROOT, "src/widget-shared-utils.js"), "utf8"));
    w.eval(fs.readFileSync(path.join(ROOT, "src/competitive-programming-widget.js"), "utf8"));

    const root = w.document.getElementById("cp-root");
    w.__mountCompetitiveProgramming(root);

    // Switch to GitHub tab
    const ghTab = root.querySelector('[data-tab="github"]');
    ghTab.click();

    // Connect slow_octo (remains in flight)
    w.document.getElementById("gh-username-input").value = "slow_octo";
    root.querySelector('[data-action="gh-connect"]').click();
    await tick(20);
    ok(root.innerHTML.includes("Fetching GitHub data"), "initial GitHub connect renders skeleton + status");

    // User immediately cancels / switches account to fast_torvalds BEFORE slow_octo resolves
    // Simulate disconnect via state action or connect replacement: first trigger gh-change-account if present, or set new handle
    // In loading state, simulate switching account via stored input flow after clearing:
    const dummyBtn = w.document.createElement("button");
    dummyBtn.setAttribute("data-action", "gh-change-account");
    root.appendChild(dummyBtn);
    dummyBtn.click();

    w.document.getElementById("gh-username-input").value = "fast_torvalds";
    root.querySelector('[data-action="gh-connect"]').click();
    await tick(40);
    ok(root.textContent.includes("Fast Torvalds"), "second handle resolves immediately without being blocked by prior loading flag");

    // Now let the stale slow_octo response resolve late!
    if (resolveSlowUser) resolveSlowUser();
    await tick(40);
    ok(
      root.textContent.includes("Fast Torvalds") && !root.textContent.includes("Slow Octo"),
      "late response from cancelled handle is ignored and never overwrites active profile"
    );
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  // 4. Interview Sheets Skeleton, Error State, Retry & Company-Tab Safety
  // -------------------------------------------------------------------------
  {
    const dom = new JSDOM("<!doctype html><html><body><div id='ish-root'></div></body></html>", {
      url: "https://arise.example.test/",
      pretendToBeVisual: true,
      runScripts: "outside-only"
    });
    const w = dom.window;
    let shouldFail = true;
    w.fetch = async () => {
      if (shouldFail) return { ok: false, status: 503, json: async () => null };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          blind75: {
            name: "Blind 75",
            description: "Core 75",
            questions: [{ title: "Two Sum", difficulty: "Easy", topic: "Arrays", platform: "LeetCode", link: "https://example.com" }]
          },
          companies: {
            Amazon: [{ title: "LRU Cache", difficulty: "Medium", topic: "Design", platform: "LeetCode", link: "https://example.com" }]
          }
        })
      };
    };

    w.eval(fs.readFileSync(path.join(ROOT, "src/widget-shared-utils.js"), "utf8"));
    w.eval(fs.readFileSync(path.join(ROOT, "src/interview-sheets-widget.js"), "utf8"));

    const host = w.document.getElementById("ish-root");
    w.__mountInterviewSheets(host);
    ok(
      host.getAttribute("aria-busy") === "true" && !!host.querySelector('[role="status"]'),
      "Interview Sheets mounts structured skeleton with aria-busy='true' while fetching"
    );

    await tick(60);
    const errEl = host.querySelector('.uxa-error-state[role="alert"]');
    const retryBtn = host.querySelector("[data-ish-retry]");
    ok(!!errEl && !!retryBtn && !host.hasAttribute("aria-busy"), "failed sheet fetch renders role='alert' error state with Retry button");

    shouldFail = false;
    retryBtn.click();
    await tick(60);
    ok(host.textContent.includes("Two Sum"), "clicking Retry reloads sheets data and renders questions");

    const compTab = host.querySelector('[data-sheet="companies"]');
    compTab.click();
    ok(host.textContent.includes("LRU Cache"), "switching to Company-wise tab renders company problems cleanly");
    dom.window.close();
  }

  // -------------------------------------------------------------------------
  // 5. Real AI Insights Stale-While-Revalidate Refresh & Error Retry
  // -------------------------------------------------------------------------
  {
    const dom = new JSDOM("<!doctype html><html><body><section id='acm-career-mentor-card'></section></body></html>", {
      url: "https://arise.example.test/",
      pretendToBeVisual: true,
      runScripts: "outside-only"
    });
    const w = dom.window;
    w.__ARISE_MUTATION_BUS__ = { subscribe() {} };
    w.__ARISE_CAREER_MENTOR_REPORT__ = {
      overall: 68,
      label: "Building",
      scores: { dsa: 70 },
      strengths: ["Arrays"],
      weaknesses: ["Graphs"],
      warnings: [],
      suggestions: ["Solve 3 graph problems"]
    };
    w.localStorage.setItem(
      "arise-ai-career-mentor-ai-cache-v1",
      JSON.stringify({ text: "Cached coaching insight.", generatedAt: new Date().toISOString(), model: "claude-haiku-4-5-20251001", basedOnOverall: 68 })
    );

    let resolveAi = null;
    let rejectNext = false;
    w.AriseAuth = {
      fetch: () =>
        new Promise((resolve, reject) => {
          resolveAi = () => {
            if (rejectNext) {
              resolve({ ok: false, status: 502, json: async () => ({ error: "Upstream unavailable" }) });
            } else {
              resolve({ ok: true, status: 200, json: async () => ({ text: "Fresh coaching insight." }) });
            }
          };
        })
    };

    w.eval(fs.readFileSync(path.join(ROOT, "src/widget-shared-utils.js"), "utf8"));
    w.eval(fs.readFileSync(path.join(ROOT, "src/ai-connect-shared.js"), "utf8"));
    w.eval(fs.readFileSync(path.join(ROOT, "src/ai-real-insights-widget.js"), "utf8"));

    await tick(250);
    const card = w.document.getElementById("ai-real-insights-card");
    ok(!!card && card.textContent.includes("Cached coaching insight."), "Real AI Insights mounts with cached insight");

    // Trigger refresh that stays in-flight
    rejectNext = true;
    card.querySelector('[data-air-action="generate"]').click();
    await tick(20);
    ok(
      !!card.querySelector(".uxa-progress-indeterminate") &&
        !!card.querySelector(".air-output.uxa-stale-refreshing") &&
        card.querySelector('[data-air-action="generate"]').disabled === true,
      "refreshing Real AI Insights keeps cached insight visible (stale-while-revalidate), shows indeterminate bar, and disables button"
    );

    resolveAi();
    await tick(40);
    ok(
      !!card.querySelector('.air-error[role="alert"]') &&
        !!card.querySelector('[data-air-action="retry"]') &&
        card.textContent.includes("Cached coaching insight."),
      "failed refresh preserves prior cached insight and surfaces role='alert' error with Try again button"
    );

    rejectNext = false;
    card.querySelector('[data-air-action="retry"]').click();
    await tick(20);
    resolveAi();
    await tick(40);
    ok(card.textContent.includes("Fresh coaching insight."), "clicking Try again recovers and renders fresh AI insight");
    dom.window.close();
  }

  console.log(`\nLoading & UX Overhaul Regression Suite: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
