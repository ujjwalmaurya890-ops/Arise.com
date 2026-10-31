#!/usr/bin/env node
'use strict';
// Real Chromium regression tests. Auth/cloud responses use the existing test
// backend, not a live Firebase/Google service. PWA tests use real CacheStorage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, origin, launchBrowser, authenticatedContext, openDashboard, navigate } = require('../tests/browser/harness.cjs');
const output = path.join(root, '.test-artifacts/overhaul');
fs.mkdirSync(output, { recursive: true });
const routes = ['Dashboard', 'DSA Tracker', 'Development', 'Competitive Programming', 'CSE Syllabus', 'Placement Tracker', 'Hackathon Tracker', 'Certificates', 'Learning', 'Exam Tracker', 'Attendance & Skills', 'CGPA Tracker', 'Projects', 'Social Media', 'Expenses', 'Notes', 'Resources', 'Analytics', 'Achievements', 'Settings'];

(async () => {
  const browser = await launchBrowser();
  const report = { browser: browser.version(), fixtures: 'authenticated cloud transport only; no live provider calls', responsive: [], themes: [], errors: [] };
  try {
    const locked = await browser.newContext({ serviceWorkers: 'block' });
    const gate = await locked.newPage(), gateRequests = [];
    gate.on('request', request => gateRequests.push(new URL(request.url()).pathname));
    await gate.goto(origin);
    await gate.getByRole('button', { name: 'Retry connection', exact: true }).waitFor();
    await gate.keyboard.press('Tab');
    await gate.locator('#cloud-title').click();
    await gate.evaluate(() => window.__ariseExpedite());
    await gate.waitForTimeout(500);
    assert.equal(await gate.evaluate(() => !!window.__ariseLazyWidgetsStarted), false);
    assert.equal(gateRequests.some(url => url.includes('/assets/chunks/') || url === '/assets/app-bundle.js'), false);
    assert.equal(await gate.locator('#root').isVisible(), false);
    report.lockedGate = { protectedRequests: 0, keyboardPointerAndDirectExpedite: 'passed' };
    await locked.close();
    console.log('PASS: keyboard/pointer/direct expedite do not preload or run protected widgets while locked.');

    const context = await authenticatedContext(browser);
    const page = await context.newPage(), requests = [];
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    await openDashboard(page);
    const chunks = requests.filter(url => url.startsWith('/assets/chunks/'));
    assert.equal(chunks.length, 12);
    assert.equal(new Set(chunks).size, chunks.length, 'preload + execution must share each chunk request');
    assert.equal(requests.filter(url => url === '/assets/app-bundle.js').length, 1);
    report.chunkRequests = chunks.length;
    console.log('PASS: all 12 ordered chunks load once, with no duplicate prewarm downloads.');

    for (const width of [320, 360, 390, 430, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.evaluate(label => { const button = [...document.querySelectorAll('aside button')].find(button => button.textContent.trim() === label); if (!button) throw new Error('Missing navigation: ' + label); button.click(); }, route);
        if (route === 'Analytics') await page.waitForFunction(() => !!window.__ARISE_ANALYTICS_MODULE__);
        await page.waitForTimeout(220);
        const result = await page.evaluate(() => {
          const main = document.getElementById('arise-main');
          return { heading: main.querySelector('header h1')?.textContent, documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            mainOverflow: main.scrollWidth > main.clientWidth + 1,
            nonblank: main.innerText.trim().length > 30,
            width: main.clientWidth, scrollWidth: main.scrollWidth,
            headerButtons: [...main.querySelectorAll(':scope > header button')].map(button => {
              const rect = button.getBoundingClientRect();
              return { name: button.getAttribute('aria-label') || button.textContent.trim(), width: rect.width, height: rect.height };
            }).filter(rect => rect.width > 0) };
        });
        report.responsive.push({ viewport: width, route, ...result });
        assert.ok(result.nonblank, route + ' renders content');
        assert.equal(result.documentOverflow, false, route + ' document overflow at ' + width);
        assert.equal(result.mainOverflow, false, route + ' main overflow at ' + width + ': ' + result.scrollWidth + ' > ' + result.width);
        if (width < 1024) for (const button of result.headerButtons) assert.ok(button.width >= 44 && button.height >= 44 && button.name, route + ': touch target ' + button.name);
      }
    }
    console.log('PASS: 20 routes × 8 actual viewports (320–1920px), including main-pane overflow and mobile header hit areas.');

    await navigate(page, 'Dashboard');
    await page.locator('#arise-pwb-input').waitFor();
    await page.waitForFunction(() => !document.getElementById('upp-data-health-card'));
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['cyberMidnightPro', 'appleGlassLight']) {
        await page.evaluate(theme => window.AriseThemeSystem.applyTheme(theme, false, { isPreview: true }), theme);
        await page.waitForTimeout(100);
        const info = await page.evaluate(() => {
          const main = document.getElementById('arise-main'), input = document.getElementById('arise-pwb-input');
          input?.focus();
          return { theme: document.documentElement.dataset.theme, overflow: main.scrollWidth > main.clientWidth + 1,
            filterHeight: input?.getBoundingClientRect().height, chipHeight: main.querySelector('.arise-pwb-chip')?.getBoundingClientRect().height };
        });
        report.themes.push({ width, ...info });
        assert.equal(info.overflow, false);
        if (width < 1024) { assert.ok(info.filterHeight >= 44); assert.ok(info.chipHeight >= 44); }
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.ci-tab').first().focus();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'Settings & Data Management');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'Overview');
    await page.evaluate(() => { document.getElementById('arise-main').scrollTop = 0; window.AriseThemeSystem.applyTheme('cyberMidnightPro', false, { isPreview: true }); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.activeElement?.blur(); document.getElementById('arise-main').scrollTo({ top: 0, behavior: 'instant' }); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(output, 'upgraded-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { document.getElementById('arise-main').scrollTo({ top: 0, behavior: 'instant' }); window.scrollTo(0, 0); });
    await page.screenshot({ path: path.join(output, 'upgraded-desktop.png') });
    console.log('PASS: light/dark shared controls, filter focus and real Career Home/End keyboard navigation.');

    report.shortViewports = [];
    for (const viewport of [{ width: 568, height: 320 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      await page.locator('#cloud-account summary').click();
      await page.locator('#cloud-signout').scrollIntoViewIfNeeded();
      const account = await page.evaluate(() => {
        const panel = document.getElementById('cloud-account-panel'), rect = panel.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight };
      });
      assert.ok(account.left >= 0 && account.right <= viewport.width && account.top >= 0 && account.bottom <= viewport.height, 'account actions fit ' + JSON.stringify(viewport));
      await page.locator('#cloud-account summary').click();
      // Geometry only: reveal the existing dialog markup in this test context;
      // this does not claim a real provider conflict or a completed resolution.
      const conflictLayoutOnly = await page.evaluate(() => {
        const host = document.getElementById('cloud-conflict'); host.hidden = false;
        const rect = host.querySelector('.cloud-card').getBoundingClientRect();
        const result = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        host.hidden = true; return result;
      });
      assert.ok(conflictLayoutOnly.left >= 0 && conflictLayoutOnly.right <= viewport.width && conflictLayoutOnly.top >= 0 && conflictLayoutOnly.bottom <= viewport.height, 'conflict card fits ' + JSON.stringify(viewport));
      report.shortViewports.push({ viewport, account, conflictLayoutOnly });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log('PASS: account actions and recovery-card geometry fit three short/landscape viewports.');

    // Harmless malicious attachment fixture; no production user data is used.
    const pdfObjects = ['<</Type /Catalog /Pages 2 0 R>>', '<</Type /Pages /Kids [3 0 R] /Count 1>>', '<</Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>', '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>'];
    const stream = 'BT /F1 18 Tf 30 130 Td (Arise attachment regression) Tj ET\n';
    pdfObjects.push('<</Length ' + Buffer.byteLength(stream) + '>>\nstream\n' + stream + 'endstream');
    let pdf = '%PDF-1.4\n', offsets = [0];
    pdfObjects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
    const xref = Buffer.byteLength(pdf);
    pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF';
    const attack = '<script>globalThis.__blobExecuted=true;parent.__filePreviewSentinel=true</script>';
    await page.evaluate(async ({ attack, pdf }) => {
      await AriseStorage.putFile('arise-local-files-db-v1', { id: 'audit-html', ownerType: 'project', ownerId: 'audit', name: 'not-a-pdf.pdf', type: 'text/html', size: attack.length, blob: new Blob([attack], { type: 'text/html' }), uploadedAt: new Date().toISOString() });
      await AriseStorage.putFile('arise-local-files-db-v1', { id: 'audit-source', ownerType: 'project', ownerId: 'audit', name: 'source.html', type: 'text/html', size: attack.length, blob: new Blob([attack], { type: 'text/html' }), uploadedAt: new Date().toISOString() });
      await AriseStorage.putFile('arise-local-files-db-v1', { id: 'audit-pdf', ownerType: 'project', ownerId: 'audit', name: 'fixture.pdf', type: 'application/pdf', size: pdf.length, blob: new Blob([pdf], { type: 'application/pdf' }), uploadedAt: new Date().toISOString() });
      const host = document.createElement('div'); host.id = 'audit-files'; host.style = 'position:fixed;inset:40px;z-index:1000;background:var(--surface)'; document.body.append(host);
      window.__mountLocalFiles(host, 'project', 'audit');
    }, { attack, pdf });
    await page.locator('#audit-files [data-file-id="audit-html"] [data-action="preview"]').click();
    await page.locator('#lf-preview-modal[data-open="true"]').waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => !!window.__filePreviewSentinel), false);
    assert.match(await page.locator('#lf-modal-body').innerText(), /No safe inline preview/);
    await page.locator('#lf-modal-close').click();
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#audit-files [data-file-id="audit-html"] [data-action="download"]').click();
    const download = await downloadEvent;
    assert.equal(fs.readFileSync(await download.path(), 'utf8'), attack, 'original attachment bytes retained for download');
    const popupEvent = context.waitForEvent('page');
    await page.locator('#audit-files [data-file-id="audit-source"] [data-action="open"]').click();
    const popup = await popupEvent; await popup.waitForLoadState('domcontentloaded');
    assert.equal(await popup.evaluate(() => document.contentType), 'text/plain');
    assert.equal(await popup.evaluate(() => !!window.__blobExecuted), false);
    assert.equal(await popup.evaluate(() => window.opener === null), true); await popup.close();
    await page.locator('#audit-files [data-file-id="audit-pdf"] [data-action="preview"]').click();
    assert.equal(await page.locator('#lf-modal-body iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.locator('#lf-modal-body iframe').getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(await page.evaluate(async () => (await (await fetch(document.querySelector('#lf-modal-body iframe').src)).blob()).type), 'application/pdf');
    await page.locator('#lf-modal-close').click();
    await page.evaluate(() => { const host = document.getElementById('audit-files'); window.__unmountLocalFiles(host); host.remove(); });
    await navigate(page, 'Certificates');
    const certificates = await page.evaluate(async ({ attack, pdf }) => {
      const store = window.AriseCertificatesStorage;
      const bad = store.upsert({ title: 'HTML attachment audit', issuer: 'Test fixture' });
      const good = store.upsert({ title: 'PDF attachment audit', issuer: 'Test fixture' });
      const image = store.upsert({ title: 'Image attachment audit', issuer: 'Test fixture' });
      await store.attachFile(bad.id, new File([attack], 'attack.pdf', { type: 'text/html' }));
      await store.attachFile(good.id, new File([pdf], 'valid.pdf', { type: 'application/pdf' }));
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const picture = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await store.attachFile(image.id, new File([picture], 'image.png', { type: 'image/png' }));
      return { bad: bad.id, good: good.id, image: image.id };
    }, { attack, pdf });
    await page.locator('[data-cert-id="' + certificates.bad + '"] [data-action="preview"]').click();
    await page.locator('#crt-preview-modal[data-open="true"]').waitFor();
    assert.equal(await page.evaluate(() => !!window.__filePreviewSentinel), false);
    assert.equal(await page.locator('#crt-preview-body iframe').count(), 0);
    assert.match(await page.locator('#crt-preview-body').innerText(), /not a PDF/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#crt-preview-modal').getAttribute('aria-hidden'), 'true');
    await page.locator('[data-cert-id="' + certificates.good + '"] [data-action="preview"]').click();
    assert.equal(await page.locator('#crt-preview-body iframe').getAttribute('sandbox'), 'allow-scripts');
    assert.equal(await page.evaluate(async () => (await (await fetch(document.querySelector('#crt-preview-body iframe').src)).blob()).type), 'application/pdf');
    await page.getByRole('button', { name: 'Close certificate preview', exact: true }).click();
    const pdfDownloadEvent = page.waitForEvent('download');
    await page.locator('[data-cert-id="' + certificates.good + '"] [data-action="download"]').click();
    assert.equal(fs.readFileSync(await (await pdfDownloadEvent).path(), 'utf8'), pdf);
    await page.locator('[data-cert-id="' + certificates.image + '"] [data-action="preview"]').click();
    await page.locator('#crt-preview-body img').evaluate(image => image.decode());
    assert.equal(await page.locator('#crt-preview-body img').evaluate(image => image.naturalWidth), 2);
    await page.getByRole('button', { name: 'Close certificate preview', exact: true }).click();
    report.certificatePreviews = 'HTML masquerade blocked; actual PDF MIME/sandbox/download bytes, PNG decode and keyboard close passed; native PDF visual fidelity not asserted';
    report.attachmentSafety = 'HTML-as-PDF blocked; top-level HTML opens inertly; PDF MIME/sandbox and original download bytes verified';
    console.log('PASS: attachment attack blocked; safe open/PDF sandbox and unchanged download bytes verified.');
    await context.close();

    const delayed = await authenticatedContext(browser);
    const analytics = await delayed.newPage(); let fail = true;
    const analyticsErrors = [];
    analytics.on('pageerror', error => analyticsErrors.push(error.message));
    await analytics.addInitScript(() => {
      window.__routeShifts = [];
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__routeShifts.push({ t: entry.startTime, v: entry.value }); }).observe({ type: 'layout-shift', buffered: true });
    });
    await delayed.route('**/assets/app-analytics.js', async route => {
      if (fail) return route.abort();
      await new Promise(resolve => setTimeout(resolve, 1400));
      await route.continue();
    });
    await openDashboard(analytics);
    await analytics.evaluate(() => { localStorage.setItem('notes', '["analytics-regression-sentinel"]'); });
    await navigate(analytics, 'Analytics');
    await analytics.getByRole('button', { name: 'Retry Analytics', exact: true }).waitFor();
    assert.equal(await analytics.locator('#arise-main').isVisible(), true, 'failed import does not blank the workspace');
    await navigate(analytics, 'Notes');
    await navigate(analytics, 'Analytics');
    await analytics.getByRole('button', { name: 'Retry Analytics', exact: true }).waitFor();
    fail = false;
    await analytics.evaluate(() => { window.__routeShifts = []; });
    await analytics.getByRole('button', { name: 'Retry Analytics', exact: true }).click();
    await analytics.locator('[data-arise-route-loading]').waitFor();
    await analytics.waitForFunction(() => !!window.__ARISE_ANALYTICS_MODULE__);
    await analytics.locator('#ai-real-insights-card').waitFor();
    await analytics.waitForTimeout(600);
    const routeCLS = await analytics.evaluate(() => {
      let max = 0, value = 0, start = 0, last = 0;
      for (const entry of window.__routeShifts) { if (entry.t - last > 1000 || entry.t - start > 5000) { value = 0; start = entry.t; } value += entry.v; max = Math.max(max, value); last = entry.t; }
      return max;
    });
    assert.ok(routeCLS < 0.1, 'delayed Analytics session-window CLS < 0.1: ' + routeCLS);
    assert.equal(await analytics.evaluate(() => localStorage.getItem('notes')), '["analytics-regression-sentinel"]');
    assert.deepEqual(analyticsErrors, []);
    report.delayedAnalyticsCLS = routeCLS;
    await delayed.close();
    console.log('PASS: failed Analytics keeps navigation/data intact; Retry works after 1.4s latency; CLS=' + routeCLS.toFixed(5));

    // Real worker installation/offline lifecycle, without replacing production
    // auth. Registration here is test-controlled; the gate must remain locked.
    const pwa = await browser.newContext({ serviceWorkers: 'allow' });
    await pwa.addInitScript(() => { window.__nativeStorageForTest = window.localStorage; });
    const offline = await pwa.newPage();
    await offline.goto(origin);
    await offline.evaluate(async () => {
      window.__nativeStorageForTest.setItem('arise-audit-sentinel', 'retained');
      await caches.open('unrelated-app-cache');
      await caches.open('arise-developer-system-v244-secure-cloud');
      await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
    });
    await offline.waitForFunction(() => !!navigator.serviceWorker.controller);
    const installed = await offline.evaluate(async () => ({ caches: await caches.keys(), stored: window.__nativeStorageForTest.getItem('arise-audit-sentinel') }));
    assert.ok(installed.caches.includes('unrelated-app-cache'));
    assert.equal(installed.caches.includes('arise-developer-system-v244-secure-cloud'), false);
    assert.ok(installed.caches.some(name => /arise-developer-system-.*secure-cloud.*-[a-f0-9]{16}$/.test(name)));
    assert.equal(installed.stored, 'retained');
    await offline.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'arise-fill-cache' }));
    await offline.waitForFunction(async () => !!(await caches.match('/assets/app-analytics.js')), null, { timeout: 45000 });
    await pwa.setOffline(true);
    await offline.reload();
    await offline.getByRole('button', { name: 'Retry connection', exact: true }).waitFor();
    assert.equal(await offline.locator('#root').isVisible(), false, 'offline cache must never bypass sign-in');
    assert.equal(await offline.evaluate(() => !!window.__ariseLazyWidgetsStarted), false);
    assert.equal(await offline.evaluate(() => window.__nativeStorageForTest.getItem('arise-audit-sentinel')), 'retained');
    const cachedAPIs = await offline.evaluate(async () => {
      const keys = (await Promise.all((await caches.keys()).map(async name => (await caches.open(name)).keys()))).flat();
      return keys.filter(request => new URL(request.url).pathname.startsWith('/api/')).length;
    });
    assert.equal(cachedAPIs, 0);
    report.pwa = { installation: 'passed', offlineShell: 'passed', analyticsCached: true, cachedAPIs, unrelatedCacheAndSentinelRetained: true, offlineAuthBypass: false };
    await pwa.close();
    assert.deepEqual(report.errors, []);
    console.log('PASS: real PWA install, content-versioned cache, offline locked shell, Analytics cache and unrelated-data retention.');
  } finally {
    fs.writeFileSync(path.join(output, 'engineering-browser.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
