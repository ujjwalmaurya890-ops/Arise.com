#!/usr/bin/env node
'use strict';

/**
 * Captures screenshots of the real loading states for documentation.
 *
 *   npm run build && npm start           # in one terminal (serves dist/ on :8123)
 *   node scripts/capture-loading-states.cjs
 *
 * Output: docs/screenshots/loading/*.png
 *
 * This script only renders components that ship in the application; it does not
 * modify any widget behaviour. It uses the same mocked secure-cloud fixture as
 * the browser test suites.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const binaryModule = require('@sparticuz/chromium');
const binary = binaryModule.default || binaryModule;
const { buildSync } = require('esbuild');
const { fixture } = require('../tests/cloud/helpers.cjs');

const origin = process.env.ARISE_TEST_URL || 'http://127.0.0.1:8123';
const outDir = path.resolve(__dirname, '../docs/screenshots/loading');
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
  stdin: { contents: authSource, resolveDir: process.cwd(), sourcefile: 'capture-entry.js' },
  bundle: true,
  format: 'esm',
  write: false
}).outputFiles[0].text;

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const libraries =
    process.platform === 'linux'
      ? await binaryModule.inflate(
          path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br')
        )
      : null;

  const browser = await chromium.launch({
    args: binary.args.filter(
      (arg) =>
        !['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials', '--single-process'].includes(arg)
    ),
    executablePath: process.env.CHROMIUM_PATH || (await binary.executablePath()),
    headless: true,
    env: {
      ...process.env,
      ...(libraries ? { LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') } : {})
    }
  });

  async function context(viewport, setup) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await ctx.route('**/assets/cloud-auth.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle })
    );
    await ctx.route('**/api/cloud**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const result = await f.handler({
        httpMethod: req.method(),
        headers: req.headers(),
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: req.postData() || ''
      });
      await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
    });
    if (setup) await setup(ctx);
    const page = await ctx.newPage();
    return { ctx, page };
  }

  async function boot(page) {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#arise-main').waitFor({ timeout: 30000 });
    await page.evaluate(() => window.__ariseExpedite?.());
    await page.waitForFunction(() => window.__ariseWidgetsReady === true, { timeout: 30000 });
    await page.waitForTimeout(400);
  }

  // 1. Secure boot screen (delayed cloud handshake).
  {
    let first = true;
    const { ctx, page } = await context({ width: 1440, height: 900 }, async (c) => {
      await c.route('**/api/cloud**', async (route) => {
        if (first) {
          first = false;
          await new Promise((r) => setTimeout(r, 900));
        }
        const req = route.request();
        const url = new URL(req.url());
        const result = await f.handler({
          httpMethod: req.method(),
          headers: req.headers(),
          queryStringParameters: Object.fromEntries(url.searchParams),
          body: req.postData() || ''
        });
        await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
      });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(outDir, '01-boot-gate.png') });
    await ctx.close();
    console.log('captured 01-boot-gate.png');
  }

  const kit = ['dashboard', 'table', 'chart-pie', 'chart-heatmap', 'chart-progress', 'profile'];
  const kitLabels = { dashboard: 'Dashboard', table: 'Data table', 'chart-pie': 'Pie chart', 'chart-heatmap': 'Heatmap', 'chart-progress': 'Progress chart', profile: 'Profile' };

  // 2 + 3. Skeleton kit in both themes.
  for (const [theme, name] of [
    ['cyberMidnightPro', '02-skeleton-kit-dark'],
    ['appleGlassLight', '03-skeleton-kit-light']
  ]) {
    const { ctx, page } = await context({ width: 1440, height: 1600 });
    await boot(page);
    await page.evaluate(
      ({ theme, kit, labels }) => {
        window.AriseThemeSystem.applyTheme(theme, false, { isPreview: true });
        const host = document.createElement('div');
        host.id = 'ars-capture-host';
        host.style.cssText =
          'position:fixed;inset:0;z-index:99999;overflow:auto;padding:20px;background:var(--background);display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;align-content:start';
        host.innerHTML = kit
          .map(
            (kind) =>
              '<section style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:14px">' +
              '<h2 style="font:700 12px var(--font-sans,sans-serif);color:var(--text-secondary);margin:0 0 10px;text-transform:uppercase;letter-spacing:.08em">' +
              labels[kind] +
              '</h2>' +
              window.AriseLoading.skeleton(kind, { label: 'Loading ' + labels[kind], delayed: false }) +
              '</section>'
          )
          .join('');
        document.body.appendChild(host);
      },
      { theme, kit, labels: kitLabels }
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, name + '.png') });
    await ctx.close();
    console.log('captured ' + name + '.png');
  }

  // 4. Mobile (390px) dashboard skeleton, dark.
  {
    const { ctx, page } = await context({ width: 390, height: 844 });
    await boot(page);
    await page.evaluate(() => {
      window.AriseThemeSystem.applyTheme('cyberMidnightPro', false, { isPreview: true });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;padding:12px;background:var(--background)';
      host.innerHTML = window.AriseLoading.skeleton('dashboard', { label: 'Loading dashboard', delayed: false });
      document.body.appendChild(host);
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outDir, '04-mobile-dashboard.png') });
    await ctx.close();
    console.log('captured 04-mobile-dashboard.png');
  }

  // 5. AI thinking state (delayed /api/ai-ask).
  {
    const { ctx, page } = await context({ width: 1440, height: 900 }, async (c) => {
      await c.route('**/api/ai-ask', async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Captured AI response.' }) });
      });
    });
    await boot(page);
    await page.getByRole('button', { name: 'Analytics', exact: true }).first().click();
    await page.locator('#ai-real-insights-card').waitFor({ timeout: 10000 });
    await page.locator('#ai-real-insights-card [data-air-action="generate"]').click();
    await page.waitForTimeout(400);
    await page.locator('#ai-real-insights-card').screenshot({ path: path.join(outDir, '05-ai-thinking.png') });
    await ctx.close();
    console.log('captured 05-ai-thinking.png');
  }

  // 6. Global navigation progress line + 7. offline banner.
  {
    const { ctx, page } = await context({ width: 1440, height: 900 });
    await boot(page);
    await page.evaluate(() => window.AriseLoading.progress.pulse());
    await page.waitForTimeout(140);
    await page.screenshot({ path: path.join(outDir, '06-navigation-progress.png'), clip: { x: 0, y: 0, width: 1440, height: 120 } });
    await ctx.setOffline(true);
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(outDir, '07-offline-banner.png'), clip: { x: 300, y: 640, width: 840, height: 240 } });
    await ctx.close();
    console.log('captured 06-navigation-progress.png, 07-offline-banner.png');
  }

  await browser.close();
  console.log('Loading-state screenshots written to docs/screenshots/loading/');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
