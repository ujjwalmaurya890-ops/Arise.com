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
        beforeWidth: before ? before.width : null,
        hasBootBar: !!document.querySelector('#cloud-gate .ars-gate-progress .ars-progress[role="progressbar"]'),
        bootBarVisible: (() => {
          const bar = document.querySelector('#cloud-gate .ars-gate-progress');
          return bar ? getComputedStyle(bar).display !== 'none' : false;
        })(),
        bootBarAccessibleName: (document.querySelector('#cloud-gate .ars-gate-progress .ars-progress') || {}).getAttribute
          ? document.querySelector('#cloud-gate .ars-gate-progress .ars-progress').getAttribute('aria-label')
          : null
      };
    });
    assert.equal(gateBusySnapshot.busy, 'true', '#cloud-gate sets data-busy="true" during cloud handshake');
    assert.equal(gateBusySnapshot.ariaBusy, 'true', '#cloud-gate sets aria-busy="true" during cloud handshake');
    assert.equal(gateBusySnapshot.beforeWidth, '16px', '#cloud-message::before renders 16px (--loader-size-md) CSS spinner');
    assert.equal(gateBusySnapshot.hasBootBar, true, 'the full-page boot screen exposes a progressbar');
    assert.equal(gateBusySnapshot.bootBarVisible, true, 'the boot progress bar is visible during the handshake');
    assert.match(String(gateBusySnapshot.bootBarAccessibleName), /workspace/i, 'the boot bar exposes an accessible name');
    console.log('PASS [1/8]: Cloud Gate displays accessible CSS spinner and boot progress during the auth/sync handshake.');

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
    // A hidden gate must not keep a stale busy state after the handshake: this is
    // the leak the per-route audit (scripts/audit-loading-coverage.cjs) found.
    const staleBusy = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-busy="true"]')].map((node) => node.id || String(node.className).slice(0, 60))
    );
    assert.deepEqual(staleBusy, [], 'no host keeps aria-busy="true" once boot has settled');
    metricsReport.boot = bootPerf;
    assert.ok(bootPerf.bootCls < 0.1, `Boot CLS must stay below 0.1 (Good); measured ${bootPerf.bootCls}`);
    console.log(
      `PASS [2/8]: Dashboard boot settled cleanly (FCP=${bootPerf.paints['first-contentful-paint']}ms, DCL=${bootPerf.domContentLoadedMs}ms, CLS=${bootPerf.bootCls}, idleAnimations=${bootPerf.runningAnimationsAtIdle}).`
    );

    // Exercise actual shared skeleton geometry across viewport sizes and both
    // theme token sets, without replacing or delaying any application content.
    const skeletonProbes = [];
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [theme, mode] of [['cyberMidnightPro', 'dark'], ['appleGlassLight', 'light']]) {
        const probe = await page.evaluate(({ theme, mode }) => {
          const root = document.documentElement;
          const oldTheme = root.dataset.theme;
          // ThemeSystem writes palette variables inline, so use its real
          // preview API rather than changing the data attribute alone.
          window.AriseThemeSystem.applyTheme(theme, false, { isPreview: true });
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;inset:0 auto auto 0;width:100%;padding:12px;z-index:-1;box-sizing:border-box';
          host.innerHTML = ['dashboard', 'chart', 'table', 'list', 'form'].map(variant => window.AriseAnimationUpgrade.renderSkeleton({ variant, delayed: false })).join('');
          document.body.appendChild(host);
          const cards = [...host.querySelectorAll('.uxa-skeleton-layout')];
          const base = getComputedStyle(host.querySelector('.uxa-skeleton')).backgroundColor;

          // Loading system v2: content-shaped kit must fit the same viewports.
          const v2 = document.createElement('div');
          v2.style.cssText = 'position:fixed;inset:0 auto auto 0;width:100%;padding:12px;z-index:-1;box-sizing:border-box';
          const v2Kinds = ['dashboard', 'table', 'chart-pie', 'chart-heatmap', 'chart-progress', 'profile', 'calendar', 'timeline', 'settings', 'search', 'notes', 'dsa', 'ai', 'modal', 'sidebar'];
          v2.innerHTML = v2Kinds.map(kind => window.AriseLoading.skeleton(kind, { kind, delayed: false, label: 'Loading ' + kind })).join('');
          document.body.appendChild(v2);
          const v2Roots = [...v2.querySelectorAll('[data-ars-skeleton]')];
          v2.querySelectorAll('.ars-skel').forEach(el => { el.classList.add('ars-skel--static'); });
          const v2Fits = v2Roots.every(el => el.scrollWidth <= el.clientWidth + 1) &&
            v2.scrollWidth <= v2.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 2;
          const v2Base = getComputedStyle(v2.querySelector('.ars-skel')).backgroundColor;
          const v2Shimmer = getComputedStyle(v2.querySelector('.ars-skel-group'), '::after').animationName;

          const result = {
            mode, width: innerWidth, cards: cards.length,
            fits: cards.every(card => card.scrollWidth <= card.clientWidth + 1),
            base, v2Count: v2Roots.length, v2Kinds: v2Kinds.length, v2Fits, v2Base, v2Shimmer,
            perfLite: document.documentElement.classList.contains('perf-lite')
          };
          host.remove(); v2.remove(); window.AriseThemeSystem.applyTheme(oldTheme, false, { isPreview: true });
          return result;
        }, { theme, mode });
        assert.equal(probe.cards, 5); assert.ok(probe.fits, `${mode} skeleton overflow at ${width}px`);
        assert.equal(probe.v2Count, probe.v2Kinds, `every v2 skeleton kind rendered at ${width}px (${mode})`);
        assert.ok(probe.v2Fits, `v2 skeleton kit overflows at ${width}px (${mode})`);
        // The sandboxed browser reports a low core count, so the app's own
        // perf-lite mode is expected here: placeholders must then be static.
        assert.equal(probe.v2Shimmer, probe.perfLite ? 'none' : 'ars-shimmer-slide',
          `v2 shimmer matches the active performance mode at ${width}px (${mode})`);
        skeletonProbes.push(probe);
      }
    }
    assert.notEqual(skeletonProbes[0].base, skeletonProbes[1].base, 'light and dark skeleton surfaces resolve differently');
    assert.notEqual(skeletonProbes[0].v2Base, skeletonProbes[1].v2Base, 'v2 skeleton surfaces also resolve per theme');
    metricsReport.skeletonProbes = skeletonProbes;
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log('PASS: shared and v2 skeleton kits fit 320–1920px in light and dark themes.');

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
    console.log(`PASS [3/8]: Navigated ${visitedRoutes.length} routes (${visitedRoutes.join(', ')}) with zero blank screens (cumulative CLS=${postNavCls}).`);

    // Global navigation progress line: one short transition, then it hides.
    const navBtn = page.getByRole('button', { name: 'DSA Tracker', exact: true }).first();
    await navBtn.click();
    const navProgressState = await page.evaluate(() => {
      const bar = document.querySelector('[data-ars-topbar]');
      return bar ? { state: bar.getAttribute('data-state'), progress: Number(bar.style.getPropertyValue('--ars-progress')) } : null;
    });
    assert.ok(navProgressState && ['active', 'done'].includes(navProgressState.state),
      'widget navigation starts the shared top progress line');
    await page.waitForTimeout(900);
    const navProgressIdle = await page.evaluate(() => document.querySelector('[data-ars-topbar]').getAttribute('data-state'));
    assert.equal(navProgressIdle, 'idle', 'the navigation progress line hides itself after the transition');
    assert.equal(await page.locator('[data-ars-topbar]').count(), 1, 'only one global progress line exists');

    // Image-free UI + button loading guard, verified in a real browser.
    const uiImages = await page.evaluate(() => ({
      appImages: document.querySelectorAll('#arise-main img, #cloud-gate img, #cloud-account img, #root img').length,
      enhancementApi: typeof (window.AriseLoading && window.AriseLoading.enhanceImages)
    }));
    assert.equal(uiImages.appImages, 0, 'the application chrome renders no images');
    assert.equal(uiImages.enhancementApi, 'undefined', 'the removed image placeholder API is no longer exposed');

    const buttonGuard = await page.evaluate(async () => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Sync';
      document.body.appendChild(btn);
      let calls = 0;
      const p1 = window.AriseLoading.button.guard(btn, () => new Promise((resolve) => { calls++; setTimeout(resolve, 150); }));
      const p2 = window.AriseLoading.button.guard(btn, () => { calls++; });
      const busy = { disabled: btn.disabled, spinner: !!btn.querySelector('.uxa-spinner, .ars-spinner'), label: btn.textContent.trim() };
      await Promise.all([p1, p2]);
      const restored = { disabled: btn.disabled, label: btn.textContent.trim() };
      btn.remove();
      return { busy, restored, calls };
    });
    assert.equal(buttonGuard.busy.disabled, true, 'a guarded button disables while the action runs');
    assert.equal(buttonGuard.busy.spinner, true, 'a guarded button shows an inline spinner');
    assert.equal(buttonGuard.calls, 1, 'duplicate browser clicks are blocked by the guard');
    assert.equal(buttonGuard.restored.disabled, false, 'the guarded button is restored afterwards');
    assert.equal(buttonGuard.restored.label, 'Sync', 'the guarded button restores its original label');
    console.log('PASS: Image-free app chrome and guarded-button loading states verified.');

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
        hasProgressBar: !!card.querySelector('.uxa-progress-indeterminate'),
        hasThinkingStatus: !!card.querySelector('.ars-ai-thinking[role="status"]'),
        thinkingText: (card.querySelector('.ars-ai-thinking') || {}).textContent || '',
        hasSkeletonCard: !!card.querySelector('[data-ars-skeleton="1"][role="progressbar"][aria-busy="true"]')
      };
    });
    assert.equal(inFlightAi.disabled, true, 'Generate button disables immediately on click');
    assert.equal(inFlightAi.ariaBusy, 'true', 'Generate button sets aria-busy="true" while pending');
    assert.equal(inFlightAi.hasProgressBar, true, 'Real AI Insights shows an indeterminate bar while waiting');
    assert.equal(inFlightAi.hasThinkingStatus, true, 'Real AI Insights exposes one accessible AI thinking status');
    assert.match(inFlightAi.thinkingText, /waiting for (the model|its response)/i, 'AI thinking text describes the real in-flight request');
    assert.equal(inFlightAi.hasSkeletonCard, true, 'Real AI Insights shows the AI-shaped skeleton on initial generation');
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
    console.log('PASS [4/8]: Delayed API, duplicate-click prevention, 502 error alert, and Retry recovery verified in Chromium.');

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
    console.log('PASS [5/8]: Modal ARIA semantics, Escape dismissal, and focus restoration verified.');

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
    console.log('PASS [6/8]: Tablet (768x1024) layout + Sheet Coverage 503 error state & live Retry recovery verified.');

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
      probeSkel.className = 'uxa-skeleton uxa-skeleton-line';
      const probeGroup = document.createElement('div');
      probeGroup.className = 'uxa-skeleton-group';
      const probeSpin = document.createElement('span');
      probeSpin.className = 'uxa-spinner';
      const v2Skel = document.createElement('div');
      v2Skel.className = 'ars-skel';
      const v2Group = document.createElement('div');
      v2Group.className = 'ars-skel-group';
      const v2Spin = document.createElement('span');
      v2Spin.className = 'ars-spinner';
      document.body.append(probeBtn, probeSkel, probeGroup, probeSpin, v2Skel, v2Group, v2Spin);

      const btnTransition = parseFloat(getComputedStyle(probeBtn).transitionDuration) || 0;
      const skelAnimName = getComputedStyle(probeSkel, '::after').animationName;
      const groupAnimName = getComputedStyle(probeGroup, '::after').animationName;
      const spinAnimName = getComputedStyle(probeSpin).animationName;
      const v2AnimName = getComputedStyle(v2Skel, '::after').animationName;
      const v2GroupAnimName = getComputedStyle(v2Group, '::after').animationName;
      const v2SpinAnimName = getComputedStyle(v2Spin).animationName;

      probeBtn.remove();
      probeSkel.remove();
      probeGroup.remove();
      probeSpin.remove();
      v2Skel.remove();
      v2Group.remove();
      v2Spin.remove();

      return {
        sharedReduced: window.__ariseShared?.prefersReducedMotion?.() === true,
        uxaReduced: window.AriseAnimationUpgrade?.prefersReducedMotion?.() === true,
        loadingReduced: window.AriseLoading?.prefersReducedMotion?.() === true,
        btnTransition,
        skelAnimName,
        groupAnimName,
        spinAnimName,
        v2AnimName,
        v2GroupAnimName,
        v2SpinAnimName,
        mobileNoOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
    });
    metricsReport.reducedMotionAndMobile = rmAudit;
    assert.equal(rmAudit.sharedReduced, true, '__ariseShared.prefersReducedMotion() detects OS reduced motion');
    assert.equal(rmAudit.uxaReduced, true, 'AriseAnimationUpgrade.prefersReducedMotion() detects OS reduced motion');
    assert.ok(rmAudit.btnTransition <= 0.001, `Button transition collapses under reduced motion (got ${rmAudit.btnTransition}s)`);
    assert.equal(rmAudit.skelAnimName, 'none', 'Skeleton shimmer animation is disabled under reduced motion');
    assert.equal(rmAudit.groupAnimName, 'none', 'Grouped shimmer is disabled under reduced motion');
    assert.equal(rmAudit.spinAnimName, 'uxa-reduced-pulse', 'Active spinner uses calm opacity pulse instead of continuous spin under reduced motion');
    assert.equal(rmAudit.loadingReduced, true, 'AriseLoading agrees reduced motion is active');
    assert.equal(rmAudit.v2AnimName, 'none', 'v2 single-shape shimmer is static under reduced motion');
    assert.equal(rmAudit.v2GroupAnimName, 'none', 'v2 grouped shimmer is static under reduced motion');
    assert.equal(rmAudit.v2SpinAnimName, 'ars-reduced-pulse', 'v2 spinner degrades to a calm opacity pulse');
    assert.equal(rmAudit.mobileNoOverflow, true, 'Mobile viewport (390x844) has zero horizontal overflow');
    console.log('PASS [7/8]: prefers-reduced-motion: reduce + Mobile (390x844) responsive checks verified.');

    // -----------------------------------------------------------------------
    // 7. Full-performance mode: shimmer animates, static when perf-lite
    // -----------------------------------------------------------------------
    const fullCtx = await makeAuthContext({ viewport: { width: 1440, height: 900 } });
    await fullCtx.context.addInitScript(() => {
      try { localStorage.setItem('arise-perf-mode', 'full'); } catch (_) {}
    });
    await fullCtx.page.goto(origin);
    await fullCtx.page.locator('#arise-main').waitFor({ timeout: 30000 });
    const shimmerMode = await fullCtx.page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = window.AriseLoading.skeleton('table', { label: 'Loading table', delayed: false });
      document.body.appendChild(host);
      const name = getComputedStyle(host.querySelector('.ars-skel-group'), '::after').animationName;
      const duration = getComputedStyle(host.querySelector('.ars-skel-group'), '::after').animationDuration;
      host.remove();
      return { perfLite: document.documentElement.classList.contains('perf-lite'), name, duration };
    });
    assert.equal(shimmerMode.perfLite, false, 'arise-perf-mode=full is honoured');
    assert.equal(shimmerMode.name, 'ars-shimmer-slide', 'the v2 shimmer animates in full-performance mode');
    assert.equal(shimmerMode.duration, '1.5s', 'one shared shimmer speed is used (--motion-skeleton)');
    console.log('PASS: Shimmer runs at one speed in full mode and stays static in perf-lite.');

    // -----------------------------------------------------------------------
    // 8. Connectivity state: offline banner appears and clears without hiding content
    // -----------------------------------------------------------------------
    const offlineCtx = await makeAuthContext({ viewport: { width: 390, height: 844 } });
    await offlineCtx.page.goto(origin);
    await offlineCtx.page.locator('#arise-main').waitFor({ timeout: 30000 });
    await offlineCtx.page.evaluate(() => window.__ariseExpedite?.());
    await offlineCtx.page.waitForFunction(() => window.__ariseWidgetsReady === true, { timeout: 30000 });
    await offlineCtx.context.setOffline(true);
    await offlineCtx.page.waitForTimeout(250);
    const offlineVisible = await offlineCtx.page.evaluate(() => {
      const banner = document.querySelector('.ars-offline');
      return {
        visible: !!banner && !banner.hidden && getComputedStyle(banner).display !== 'none',
        text: banner ? banner.textContent.trim() : '',
        contentVisible: (document.getElementById('arise-main')?.innerText.trim().length || 0) > 20
      };
    });
    assert.equal(offlineVisible.visible, true, 'going offline shows the connectivity banner');
    assert.match(offlineVisible.text, /offline/i, 'the offline banner explains the state');
    assert.equal(offlineVisible.contentVisible, true, 'offline mode keeps saved content visible');
    await offlineCtx.context.setOffline(false);
    await offlineCtx.page.waitForTimeout(250);
    const offlineHidden = await offlineCtx.page.evaluate(() => document.querySelector('.ars-offline')?.hidden === true);
    assert.equal(offlineHidden, true, 'reconnecting hides the offline banner');
    console.log('PASS [8/8]: Offline banner appears and clears while saved content stays visible.');

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
