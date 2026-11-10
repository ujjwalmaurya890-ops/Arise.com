'use strict';
// Isolated real-browser widget fixture; never bypasses production authentication.
// Image-free successor to verify-cse-image.cjs: the CSE header no longer ships an
// illustrative screenshot, so this fixture asserts layout, theming and scoring
// invariance for a header that renders text and controls only.
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
        const state = await page.evaluate(() => {
          const root = document.querySelector('#csu-unified-root');
          return { count: document.querySelectorAll('#csu-unified-root').length,
            images: root.querySelectorAll('img, picture, svg image, [style*="background-image"]').length,
            headerWidth: root.querySelector('.csu-rs-title') ? root.querySelector('.csu-rs-title').getBoundingClientRect().width : 0,
            overflow: root.scrollWidth > root.clientWidth + 1,
            text: getComputedStyle(root.querySelector('.csu-rs-title')).color,
            background: getComputedStyle(root).backgroundColor };
        });
        assert.equal(state.count, 1, 'the widget mounts exactly once');
        assert.equal(state.images, 0, `${theme}/${width}: the CSE widget renders no images`);
        assert.ok(state.headerWidth > 0, `${theme}/${width}: the readiness title still lays out`);
        assert.equal(state.overflow, false, `${theme}/${width} overflow`);
        assert.notEqual(state.text, state.background);
        assert.deepEqual(await scores(), expected);
        assert.equal(await page.evaluate(() => localStorage.getItem('cse-syllabus-progress-v1')), stored);
      }
      rows.push({ theme, images: 'none rendered', layouts: '1440 / 768 / 390 pass', switching: 'pass', scoringAndProgress: 'unchanged', contrast: 'distinct title/surface only; full AA audit not performed' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.locator('#csu-unified-root img').count(), 0, 'no image survives in the rendered widget');
    assert.equal(await page.locator('#csu-unified-root .csu-header-reference').count(), 0, 'the reference figure was removed, not hidden');
    assert.equal(await page.locator('.csu-rs-title').isVisible(), true, 'the live readiness title is always visible');
    assert.deepEqual(errors, []);
    fs.writeFileSync('.test-artifacts/cse-theme-matrix.json', JSON.stringify(rows, null, 2));
    console.log(`PASS: ${themes.length} live theme transitions × 3 viewports, zero rendered images, single mount, no widget overflow, scoring/progress invariance, no page errors. Baseline comparison: ${baseline ? 'pass' : 'not available'}.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
