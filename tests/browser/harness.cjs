'use strict';
// Test-only authenticated transport. Never imported by the production build.
const path = require('node:path');
const { chromium } = require('playwright-core');
const binaryModule = require('@sparticuz/chromium');
const binary = binaryModule.default || binaryModule;
const { buildSync } = require('esbuild');
const { fixture } = require('../cloud/helpers.cjs');
const root = path.resolve(__dirname, '../..');
const origin = process.env.ARISE_TEST_URL || 'http://127.0.0.1:8123';

async function launchBrowser() {
  const libraries = process.platform === 'linux' ? await binaryModule.inflate(path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br')) : null;
  return chromium.launch({
    args: binary.args.filter(arg => !['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials', '--single-process'].includes(arg)),
    executablePath: process.env.CHROMIUM_PATH || await binary.executablePath(), headless: true,
    env: { ...process.env, ...(libraries ? { LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') } : {}) }
  });
}

function authBundle() {
  return buildSync({ stdin: { resolveDir: root, contents: `
    import { createController } from './src/cloud/auth-controller.js';
    import { startProtectedRuntime } from './src/cloud/protected-runtime.js';
    import * as codec from './src/cloud/backup-codec.js';
    window.AriseBackupCodec = codec;
    let user = { uid: 'uid-1', getIdToken: async () => 'token-1' }, watch;
    createController({ user: () => user, signIn: async () => watch(user),
      signOut: async () => { user = null; await watch(null); },
      watch: next => { watch = next; next(user); } });
    startProtectedRuntime();
  ` }, bundle: true, format: 'esm', write: false }).outputFiles[0].text;
}

async function authenticatedContext(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', ...options });
  const f = fixture();
  await context.route('**/assets/cloud-auth.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: authBundle() }));
  await context.route('**/api/cloud**', async route => {
    const request = route.request(), url = new URL(request.url());
    const result = await f.handler({ httpMethod: request.method(), headers: request.headers(), queryStringParameters: Object.fromEntries(url.searchParams), body: request.postData() || '' });
    await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
  });
  return context;
}

async function openDashboard(page) {
  await page.goto(origin);
  await page.waitForFunction(() => document.documentElement.dataset.cloudAuth === 'ready' && document.getElementById('arise-main'));
  await page.waitForFunction(() => window.__ariseWidgetsReady === true, null, { timeout: 45000 });
}

async function navigate(page, label) {
  if (page.viewportSize().width < 1024) await page.locator('#arise-menu-btn').click();
  await page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first().click();
}
module.exports = { root, origin, launchBrowser, authenticatedContext, openDashboard, navigate };
