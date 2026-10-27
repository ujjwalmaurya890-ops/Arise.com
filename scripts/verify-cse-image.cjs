'use strict';
// Isolated real-browser widget fixture; never bypasses production authentication.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const binaryModule = require('@sparticuz/chromium');
const binary = binaryModule.default || binaryModule;
const path = require('node:path');
(async () => {
  fs.mkdirSync('.test-artifacts', { recursive: true });
  const libs = await binaryModule.inflate(path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br'));
  const browser = await chromium.launch({ executablePath: await binary.executablePath(), args: binary.args,
    env: { ...process.env, LD_LIBRARY_PATH: path.join(libs, 'lib') } });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('https://cse.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><style>body{margin:0;padding:16px;background:var(--background);font-family:Arial}*{box-sizing:border-box}</style></head><body><div id="sem-1"></div></body></html>' });
      const file = path.join(process.cwd(), url.pathname);
      return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404, body: '' });
    });
    async function load(source) {
      await page.goto('https://cse.test/');
      await page.evaluate(() => {
        localStorage.clear();
        localStorage.setItem('cse-syllabus-progress-v1', JSON.stringify({ 's1-1': true, 's1-2': true, 's2-1': true }));
        window.__ARISE_MUTATION_BUS__ = { subscribe() {} };
      });
      for (const file of ['src/theme-system.js', 'src/features/semester-risk/cse-full-syllabus-config.js', source])
        await page.addScriptTag({ content: fs.readFileSync(file, 'utf8') });
      await page.locator('#csu-unified-root').waitFor();
    }
    const scores = () => page.evaluate(() => Object.fromEntries(['weighted', 'credits', 'simple'].map(mode => [mode, window.__ARISE_CSE_READINESS_API__.compute(mode)])));
    let baseline;
    if (fs.existsSync('.test-artifacts/csu-baseline.js')) {
      await load('.test-artifacts/csu-baseline.js'); baseline = await scores();
      await page.screenshot({ path: '.test-artifacts/cse-before.png', fullPage: true });
    }
    await load('src/features/semester-risk/cse-syllabus-unified-widget.js');
    const expected = await scores(); if (baseline) assert.deepEqual(expected, baseline);
    const stored = await page.evaluate(() => localStorage.getItem('cse-syllabus-progress-v1'));
    const themes = await page.evaluate(() => Object.keys(window.AriseThemeSystem.themes));
    const rows = [];
    for (const theme of themes) {
      await page.evaluate(t => window.AriseThemeSystem.applyTheme(t, true), theme);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('.csu-header-img').evaluate(img => img.decode());
        const state = await page.evaluate(() => {
          const root = document.querySelector('#csu-unified-root'), img = root.querySelector('.csu-header-img');
          return { count: document.querySelectorAll('#csu-unified-root').length, natural: img.naturalWidth,
            ratio: img.clientWidth / img.clientHeight, overflow: root.scrollWidth > root.clientWidth + 1,
            text: getComputedStyle(root.querySelector('.csu-rs-title')).color,
            background: getComputedStyle(root).backgroundColor };
        });
        assert.equal(state.count, 1); assert.equal(state.natural, 1720);
        assert.ok(Math.abs(state.ratio - 1720 / 772) < .06); assert.equal(state.overflow, false, `${theme}/${width} overflow`);
        assert.notEqual(state.text, state.background);
        assert.deepEqual(await scores(), expected);
        assert.equal(await page.evaluate(() => localStorage.getItem('cse-syllabus-progress-v1')), stored);
      }
      rows.push({ theme, image: 'pass', layouts: '1440 / 768 / 390 pass', switching: 'pass', scoringAndProgress: 'unchanged', contrast: 'distinct title/surface only; full AA audit not performed' });
    }
    await page.screenshot({ path: '.test-artifacts/cse-after-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: '.test-artifacts/cse-after-desktop.png', fullPage: true });
    await page.locator('.csu-header-img').dispatchEvent('error');
    assert.equal(await page.locator('.csu-header-reference').isVisible(), false);
    assert.equal(await page.locator('.csu-rs-title').isVisible(), true);
    assert.deepEqual(errors, []);
    fs.writeFileSync('.test-artifacts/cse-theme-matrix.json', JSON.stringify(rows, null, 2));
    console.log(`PASS: ${themes.length} live theme transitions × 3 viewports, image decode/proportions, single mount, no widget overflow, scoring/progress invariance, image-error fallback, no page errors. Baseline comparison: ${baseline ? 'pass' : 'not available'}.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
