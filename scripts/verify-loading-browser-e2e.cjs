#!/usr/bin/env node
'use strict';

/**
 * Real Headless Chromium E2E Verification for Loading Animations, Skeletons,
 * Async Error/Retry Flows, Duplicate-Click Locks, Modals, Responsive Viewports,
 * Reduced Motion, and Layout Stability (CLS).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const binaryModule = require('@sparticuz/chromium');
const binary = binaryModule.default || binaryModule;
const { buildSync } = require('esbuild');
const { fixture } = require('../tests/cloud/helpers.cjs');

const origin = process.env.ARISE_TEST_URL || 'http://127.0.0.1:8123';
const f = fixture();

const authSource = `
import { createController } from './src/cloud/auth-controller.js';
import { startProtectedRuntime } from './src/cloud/protected-runtime.js';
import * as codec from './src/cloud/backup-codec.js';
window.AriseBackupCodec = codec;
let user = { uid: 'uid-1', getIdToken: async () => 'token-1' }, watch;
createController({
  user: () => user,
  signIn: async () => { await watch(user); },
  signOut: async () => { user = null; await watch(null); },
  watch: next => { watch = next; next(user); }
});
startProtectedRuntime();
`;

const bundle = buildSync({
  stdin: { contents: authSource, resolveDir: process.cwd(), sourcefile: 'ux-browser-entry.js' },
  bundle: true,
  format: 'esm',
  write: false
}).outputFiles[0].text;

(async () => {
  const libraries =
    process.platform === 'linux'
      ? await binaryModule.inflate(
          path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br')
        )
      : null;

  const browser = await chromium.launch({
    args: binary.args.filter(
      (arg) =>
        ![
          '--disable-web-security',
          '--allow-running-insecure-content',
          '--disable-site-isolation-trials',
          '--single-process'
        ].includes(arg)
    ),
    executablePath: process.env.CHROMIUM_PATH || (await binary.executablePath()),
    headless: true,
    env: {
      ...process.env,
      ...(libraries
        ? { LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') }
        : {})
    }
  });

  const pageErrors = [];
  const consoleErrors = [];
  const contexts = [];
  const metricsReport = {};

  async function makeAuthContext(options = {}, routeHooks = {}) {
    const context = await browser.newContext({
      viewport: options.viewport || { width: 1440, height: 900 },
      reducedMotion: options.reducedMotion || 'no-preference',
      serviceWorkers: 'block'
    });
    contexts.push(context);

    await context.addInitScript(() => {
      window.__uxClsTotal = 0;
      window.__uxClsEntries = [];
      window.__uxPaints = {};
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) {
              window.__uxClsTotal += e.value;
              window.__uxClsEntries.push({
                value: Number(e.value.toFixed(4)),
                startTime: Math.round(e.startTime),
                route: document.querySelector('main h1')?.textContent?.trim() || '',
                sources: (e.sources || []).map(
                  (x) => (x.node?.tagName || '') + '#' + (x.node?.id || '') + '.' + String(x.node?.className || '').slice(0, 40)
                )
              });
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch (_) {}
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__uxPaints[e.name] = Math.round(e.startTime);
          }
        }).observe({ type: 'paint', buffered: true });
      } catch (_) {}
    });

    await context.route('**/assets/cloud-auth.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle })
    );

    await context.route('**/api/cloud**', async (route) => {
      if (routeHooks.delayCloudMs) {
        await new Promise((r) => setTimeout(r, routeHooks.delayCloudMs));
      }
      const request = route.request();
      const url = new URL(request.url());
      const result = await f.handler({
        httpMethod: request.method(),
        headers: request.headers(),
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: request.postData() || ''
      });
      await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
    });

    if (routeHooks.setup) {
      await routeHooks.setup(context);
    }

    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Ignore sandbox-blocked external Google Fonts CDN DNS failures; fail on any broken local/same-origin asset
      if (url.startsWith(origin) && !req.failure()?.errorText?.includes('ERR_ABORTED')) {
        consoleErrors.push(`Same-origin request failed: ${url} (${req.failure()?.errorText})`);
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        if (
          !txt.includes('Failed to load resource: the server responded with a status of 50') &&
          !txt.includes('net::ERR_NAME_NOT_RESOLVED')
        ) {
          consoleErrors.push(txt);
        }
      }
    });
    return { context, page };
  }

  try {
    // -----------------------------------------------------------------------
    // 1. Cloud Gate Busy Spinner + Initial Boot + CLS + Route Transitions
    // -----------------------------------------------------------------------
    let cloudDelayActive = true;
    const { page } = await makeAuthContext(
      { viewport: { width: 1440, height: 900 } },
      {
        setup: async (ctx) => {
          // Intercept /api/cloud once with a small delay to inspect #cloud-gate[data-busy="true"]
          await ctx.unroute('**/api/cloud**');
          await ctx.route('**/api/cloud**', async (route) => {
            if (cloudDelayActive) {
              cloudDelayActive = false;
              await new Promise((r) => setTimeout(r, 220));
            }
            const request = route.request();
            const url = new URL(request.url());
            const result = await f.handler({
              httpMethod: request.method(),
              headers: request.headers(),
              queryStringParameters: Object.fromEntries(url.searchParams),
              body: request.postData() || ''
            });
            await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
          });
        }
      }
    );

    const navPromise = page.goto(origin, { waitUntil: 'domcontentloaded' });
    await navPromise;

    const gateBusySnapshot = await page.evaluate(() => {
      const gate = document.getElementById('cloud-gate');
      const msg = document.getElementById('cloud-message');
      const before = msg ? getComputedStyle(msg, '::before') : null;
      return {
        busy: gate ? gate.getAttribute('data-busy') : null,
        ariaBusy: gate ? gate.getAttribute('aria-busy') : null,
        beforeContent: before ? before.content : null,
        beforeWidth: before ? before.width : null
      };
    });
    assert.equal(gateBusySnapshot.busy, 'true', '#cloud-gate sets data-busy="true" during cloud handshake');
    assert.equal(gateBusySnapshot.ariaBusy, 'true', '#cloud-gate sets aria-busy="true" during cloud handshake');
    assert.equal(gateBusySnapshot.beforeWidth, '16px', '#cloud-message::before renders 16px (--loader-size-md) CSS spinner');
    console.log('PASS [1/7]: Cloud Gate displays accessible CSS spinner during initial auth/sync handshake.');

    await page.locator('#arise-main').waitFor({ timeout: 30000 });
    await page.evaluate(() => window.__ariseExpedite?.());
    await page.waitForFunction(() => window.__ariseWidgetsReady === true && window.__ariseWidgetsSettled === true, {
      timeout: 30000
    });
    await page.waitForTimeout(350);

    const bootPerf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const runningAnims = document.getAnimations().filter((a) => a.playState === 'running');
      return {
        paints: window.__uxPaints,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
        bootCls: Number(window.__uxClsTotal.toFixed(4)),
        runningAnimationsAtIdle: runningAnims.length
      };
    });
    metricsReport.boot = bootPerf;
    assert.ok(bootPerf.bootCls < 0.1, `Boot CLS must stay below 0.1 (Good); measured ${bootPerf.bootCls}`);
    console.log(
      `PASS [2/7]: Dashboard boot settled cleanly (FCP=${bootPerf.paints['first-contentful-paint']}ms, DCL=${bootPerf.domContentLoadedMs}ms, CLS=${bootPerf.bootCls}, idleAnimations=${bootPerf.runningAnimationsAtIdle}).`
    );

    // -----------------------------------------------------------------------
    // 2. Key Route Navigation, Non-Blank Screens & Route Transition Stability
    // -----------------------------------------------------------------------
    const routesToVisit = [
      'DSA Tracker',
      'Development',
      'Competitive Programming',
      'CSE Syllabus',
      'Placement Tracker',
      'Hackathon Tracker',
      'Certificates',
      'Learning',
      'Expenses',
      'Notes',
      'Analytics',
      'Dashboard'
    ];
    const visitedRoutes = [];
    for (const label of routesToVisit) {
      const btn = page.getByRole('button', { name: label, exact: true }).first();
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(160);
        const mainInfo = await page.evaluate(() => {
          const main = document.getElementById('arise-main');
          return {
            visible: !!main && main.offsetHeight > 100,
            textLen: main ? main.innerText.trim().length : 0,
            overflow: document.documentElement.scrollWidth <= window.innerWidth + 2
          };
        });
        assert.ok(mainInfo.visible && mainInfo.textLen > 20, `Route "${label}" rendered non-blank content`);
        assert.ok(mainInfo.overflow, `Route "${label}" has no horizontal overflow on desktop`);
        visitedRoutes.push(label);
      }
    }
    const postNavCls = await page.evaluate(() => Number(window.__uxClsTotal.toFixed(4)));
    metricsReport.postRouteNavigationCls = postNavCls;
    metricsReport.clsEntries = await page.evaluate(() => window.__uxClsEntries.filter((e) => e.value > 0.01));
    metricsReport.visitedRoutes = visitedRoutes;
    console.log(`PASS [3/7]: Navigated ${visitedRoutes.length} routes (${visitedRoutes.join(', ')}) with zero blank screens (cumulative CLS=${postNavCls}).`);

    // -----------------------------------------------------------------------
    // 3. Delayed API, Duplicate-Click Prevention, Error Alert & Retry Recovery
    // -----------------------------------------------------------------------
    // Navigate to Analytics where Real AI Insights (#ai-real-insights-card) mounts
    const analyticsBtn = page.getByRole('button', { name: 'Analytics', exact: true }).first();
    await analyticsBtn.click();
    await page.locator('#ai-real-insights-card').waitFor({ timeout: 10000 });

    let aiCallCount = 0;
    let failAi = true;
    await page.context().route('**/api/ai-ask', async (route) => {
      aiCallCount++;
      await new Promise((r) => setTimeout(r, 260));
      if (failAi) {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Simulated upstream timeout' })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ text: 'Verified live AI coaching summary after retry.' })
        });
      }
    });

    const genBtn = page.locator('#ai-real-insights-card [data-air-action="generate"]');
    await genBtn.scrollIntoViewIfNeeded();
    // Click rapidly 3 times (second & third via dispatchEvent since button becomes disabled immediately!)
    await genBtn.click();
    await page.evaluate(() => {
      const b = document.querySelector('#ai-real-insights-card [data-air-action="generate"]');
      if (b) {
        b.click();
        b.click();
      }
    });

    const inFlightAi = await page.evaluate(() => {
      const card = document.getElementById('ai-real-insights-card');
      const btn = card.querySelector('[data-air-action="generate"]');
      return {
        disabled: btn ? btn.disabled : false,
        ariaBusy: btn ? btn.getAttribute('aria-busy') : null,
        hasProgressBar: !!card.querySelector('.uxa-progress-indeterminate[role="status"]'),
        hasSkeletonCard: !!card.querySelector('.uxa-skeleton-card[role="status"][aria-busy="true"]')
      };
    });
    assert.equal(inFlightAi.disabled, true, 'Generate button disables immediately on click');
    assert.equal(inFlightAi.ariaBusy, 'true', 'Generate button sets aria-busy="true" while pending');
    assert.equal(inFlightAi.hasProgressBar, true, 'Real AI Insights shows accessible indeterminate bar while waiting');
    assert.equal(inFlightAi.hasSkeletonCard, true, 'Real AI Insights shows accessible skeleton card on initial generation');
    assert.equal(aiCallCount, 1, 'Duplicate clicks were blocked — exactly 1 network request fired');

    await page.locator('#ai-real-insights-card .air-error[role="alert"]').waitFor({ timeout: 5000 });
    assert.equal(await genBtn.isDisabled(), false, 'Generate button unlocks cleanly after error');

    failAi = false;
    await page.locator('#ai-real-insights-card [data-air-action="retry"]').click();
    await page.waitForFunction(
      () =>
        document
          .getElementById('ai-real-insights-card')
          ?.innerText.includes('Verified live AI coaching summary after retry.'),
      { timeout: 5000 }
    );
    console.log('PASS [4/7]: Delayed API, duplicate-click prevention, 502 error alert, and Retry recovery verified in Chromium.');

    // -----------------------------------------------------------------------
    // 4. Modal Open/Close Transitions, ARIA Dialog Semantics, Escape & Focus Return
    // -----------------------------------------------------------------------
    const certBtn = page.getByRole('button', { name: 'Certificates', exact: true }).first();
    await certBtn.click();
    const addCertBtn = page.locator('[data-action="add"]').first();
    await addCertBtn.waitFor({ timeout: 10000 });
    await addCertBtn.focus();
    await addCertBtn.click();
    await page.locator('#crt-form-modal[data-open="true"] .crt-dialog[role="dialog"][aria-modal="true"]').waitFor({ timeout: 5000 });
    const crtModalAttrs = await page.evaluate(() => {
      const m = document.querySelector('#crt-form-modal[data-open="true"] .crt-dialog');
      return {
        role: m?.getAttribute('role'),
        ariaModal: m?.getAttribute('aria-modal')
      };
    });
    assert.equal(crtModalAttrs.role, 'dialog', 'Certificates modal exposes role="dialog"');
    assert.equal(crtModalAttrs.ariaModal, 'true', 'Certificates modal exposes aria-modal="true"');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.getElementById('crt-form-modal')?.getAttribute('data-open') === 'false',
      { timeout: 5000 }
    );
    const certFocusRestored = await page.evaluate(
      () => document.activeElement?.getAttribute('data-action') === 'add'
    );
    assert.equal(certFocusRestored, true, 'Escape closes Certificates modal and restores focus to trigger button');

    // Switch back to Dashboard and test global Keyboard Shortcuts modal (?)
    await page.getByRole('button', { name: 'Dashboard', exact: true }).first().click();
    await page.waitForTimeout(100);
    await page.keyboard.press('?');
    await page.locator('#upp-shortcuts-overlay[data-open="true"] .upp-shortcuts-dialog[role="dialog"]').waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.getElementById('upp-shortcuts-overlay')?.getAttribute('data-open') === 'false',
      { timeout: 5000 }
    );
    console.log('PASS [5/7]: Modal ARIA semantics, Escape dismissal, and focus restoration verified.');

    // -----------------------------------------------------------------------
    // 5. Interview Sheets Delayed Skeleton + Failed Fetch + Retry in Fresh Context
    // -----------------------------------------------------------------------
    let failSheets = true;
    const sheetsCtx = await makeAuthContext(
      { viewport: { width: 768, height: 1024 } }, // Tablet viewport check simultaneously!
      {
        setup: async (ctx) => {
          await ctx.route('**/interview_sheets_data.json*', async (route) => {
            await new Promise((r) => setTimeout(r, 220));
            if (failSheets) {
              await route.fulfill({ status: 503, body: 'Service Unavailable' });
            } else {
              await route.continue();
            }
          });
        }
      }
    );

    await sheetsCtx.page.goto(origin);
    await sheetsCtx.page.locator('#arise-main').waitFor({ timeout: 30000 });
    await sheetsCtx.page.evaluate(() => window.__ariseExpedite?.());
    await sheetsCtx.page.waitForFunction(() => window.__ariseWidgetsReady === true, { timeout: 30000 });

    const tabletOverflow = await sheetsCtx.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2
    );
    assert.ok(tabletOverflow, 'Tablet viewport (768x1024) has zero horizontal overflow');

    // Navigate to DSA Tracker on tablet (via mobile/tablet bottom nav or Go-to-DSA shortcut) and open Analytics tab
    const bottomDsa = sheetsCtx.page.locator('[data-upp-bottom="dsa"]');
    if (await bottomDsa.isVisible()) {
      await bottomDsa.click();
    } else {
      await sheetsCtx.page.keyboard.press('g');
      await sheetsCtx.page.keyboard.press('s');
    }
    await sheetsCtx.page.locator('#dmp-dsa-mastery-card [data-dmp-tab="analytics"]').waitFor({ timeout: 10000 });
    await sheetsCtx.page.locator('#dmp-dsa-mastery-card [data-dmp-tab="analytics"]').click();
    await sheetsCtx.page.locator('#dmt-sheet-coverage [data-dsc-retry]').waitFor({ timeout: 10000 });
    failSheets = false;
    await sheetsCtx.page.locator('#dmt-sheet-coverage [data-dsc-retry]').click();
    await sheetsCtx.page.waitForFunction(
      () => document.getElementById('dmt-sheet-coverage')?.innerText.includes('Blind 75'),
      { timeout: 10000 }
    );
    console.log('PASS [6/7]: Tablet (768x1024) layout + Sheet Coverage 503 error state & live Retry recovery verified.');

    // -----------------------------------------------------------------------
    // 6. Reduced Motion (prefers-reduced-motion: reduce) + Mobile (390x844)
    // -----------------------------------------------------------------------
    const rmCtx = await makeAuthContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: 'reduce'
    });
    await rmCtx.page.goto(origin);
    await rmCtx.page.locator('#arise-main').waitFor({ timeout: 30000 });
    await rmCtx.page.evaluate(() => window.__ariseExpedite?.());
    await rmCtx.page.waitForFunction(() => window.__ariseWidgetsReady === true, { timeout: 30000 });

    const rmAudit = await rmCtx.page.evaluate(() => {
      const probeBtn = document.createElement('button');
      probeBtn.className = 'btn';
      const probeSkel = document.createElement('div');
      probeSkel.className = 'uxa-skeleton-line';
      const probeSpin = document.createElement('span');
      probeSpin.className = 'uxa-spinner';
      document.body.append(probeBtn, probeSkel, probeSpin);

      const btnTransition = parseFloat(getComputedStyle(probeBtn).transitionDuration) || 0;
      const skelAnimName = getComputedStyle(probeSkel).animationName;
      const spinAnimName = getComputedStyle(probeSpin).animationName;

      probeBtn.remove();
      probeSkel.remove();
      probeSpin.remove();

      return {
        sharedReduced: window.__ariseShared?.prefersReducedMotion?.() === true,
        uxaReduced: window.AriseAnimationUpgrade?.prefersReducedMotion?.() === true,
        btnTransition,
        skelAnimName,
        spinAnimName,
        mobileNoOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
    });
    metricsReport.reducedMotionAndMobile = rmAudit;
    assert.equal(rmAudit.sharedReduced, true, '__ariseShared.prefersReducedMotion() detects OS reduced motion');
    assert.equal(rmAudit.uxaReduced, true, 'AriseAnimationUpgrade.prefersReducedMotion() detects OS reduced motion');
    assert.ok(rmAudit.btnTransition <= 0.001, `Button transition collapses under reduced motion (got ${rmAudit.btnTransition}s)`);
    assert.equal(rmAudit.skelAnimName, 'none', 'Skeleton shimmer animation is disabled under reduced motion');
    assert.equal(rmAudit.spinAnimName, 'uxa-reduced-pulse', 'Active spinner uses calm opacity pulse instead of continuous spin under reduced motion');
    assert.equal(rmAudit.mobileNoOverflow, true, 'Mobile viewport (390x844) has zero horizontal overflow');
    console.log('PASS [7/7]: prefers-reduced-motion: reduce + Mobile (390x844) responsive checks verified.');

    assert.deepEqual(pageErrors, [], 'Uncaught page errors: ' + pageErrors.join('; '));
    assert.deepEqual(consoleErrors, [], 'Unexpected console errors: ' + consoleErrors.join('; '));

    console.log('\n=== CHROMIUM UX & PERFORMANCE METRICS ===');
    console.log(JSON.stringify(metricsReport, null, 2));
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
