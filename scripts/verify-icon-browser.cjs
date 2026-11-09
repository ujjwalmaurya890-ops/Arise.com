#!/usr/bin/env node
'use strict';
// Start the built app first; this uses the existing test-only auth fixture.
const assert = require('node:assert/strict');
const { launchBrowser, authenticatedContext, openDashboard, navigate } = require('../tests/browser/harness.cjs');
(async () => {
  const browser = await launchBrowser();
  try {
    const context = await authenticatedContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openDashboard(page);
    // Command palette results are application-owned metadata, even when a
    // result points to user content; names/previews remain untouched.
    await page.keyboard.press('Control+k');
    await page.locator('.upp-command-icon svg[aria-hidden="true"]').first().waitFor();
    await page.keyboard.press('Escape');
    await navigate(page, 'Analytics');
    const analyticsHeading = page.getByRole('heading', { name: 'Study Trend (14 Days)', exact: true });
    await analyticsHeading.waitFor();
    assert.equal(await analyticsHeading.locator('svg[aria-hidden="true"]').count(), 1);
    await navigate(page, 'Hackathon Tracker');
    await page.locator('.htd-title').waitFor({ state: 'attached' });
    await page.locator('[data-wnav-id="team"]').click();
    await page.locator('.htd-title svg[aria-hidden="true"]').waitFor();
    assert.equal((await page.locator('.htd-title').innerText()).trim(), 'Team Directory');
    await page.locator('[data-wnav-id="prizes"]').click();
    await page.locator('.hpz-title svg[aria-hidden="true"]').waitFor();
    await page.locator('[data-wnav-id="funnel"]').click();
    await page.locator('.hfs-title svg[aria-hidden="true"]').waitFor();
    await navigate(page, 'Learning');
    const timer = page.locator('[data-arise-timer-tab]:visible');
    await timer.waitFor();
    assert.equal(await timer.locator('svg[aria-hidden="true"]').count(), 1);
    await page.locator('.ambient-sound-controls:visible').first().waitFor();
    await page.evaluate(() => window.__mountFocusTimerUpgrade());
    assert.ok(await page.locator('.arise-timer-upgrade-panel:visible').count() > 0, 'timer enhancement recognizes the stable tab marker');
    assert.ok(await page.locator('.ambient-sound-controls:visible').count() > 0, 'ambient controls recognize the timer tab');
    await page.getByRole('button', { name: 'Stopwatch', exact: true }).filter({ visible: true }).first().click();
    await timer.click();
    await page.locator('#lp-tab-wellness').click();
    const water = page.locator('#lp-panel-wellness');
    assert.equal(await water.getByRole('button', { name: 'Water reminder settings' }).locator('svg[aria-hidden="true"]').count(), 1);
    await water.getByRole('button', { name: 'Water reminder settings' }).click();
    assert.ok((await water.innerText()).includes('Reminders'));
    await water.getByRole('button', { name: '+1 Glass' }).click();
    assert.match(await water.innerText(), /1\s*\/\s*8 glasses/);
    await page.locator('#lp-tab-career').click();
    await page.locator('.ccc-level-badge svg[aria-hidden="true"]').waitFor();
    assert.equal(await page.locator('.ccc-qa-icon svg[aria-hidden="true"]').count(), 5);
    assert.equal(await page.locator('.ccc-skill-label svg[aria-hidden="true"]').count(), 6);
    await page.locator('#lp-tab-path').click();
    await page.locator('.slp-enhanced-head-title svg[aria-hidden="true"]').waitFor();
    assert.equal(await page.locator('.slp-enhanced-cat-icon svg[aria-hidden="true"]').count(), 5);
    await page.locator('[data-slp-toggle="dsa-1"]').click();
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('smartLearningPathProgress'))['dsa-1']));
    await page.locator('#lp-tab-revision').click();
    await page.locator('.rev-row-icon svg[aria-hidden="true"]').first().waitFor();
    assert.ok((await page.locator('#lp-panel-revision').innerText()).includes('Arrays & Hashing'));
    await page.locator('#lp-tab-stats').click();
    await page.locator('.arise-la-title svg[aria-hidden="true"]').waitFor();
    assert.ok((await page.locator('.arise-la-title').innerText()).includes('Session Analytics'));
    await navigate(page, 'DSA Tracker');
    await page.locator('.dgl-title svg[aria-hidden="true"]').waitFor();
    assert.equal(await page.locator('.dmp-tabs svg[aria-hidden="true"]').count(), 9);
    assert.equal(await page.locator('[data-dmp-level-chip] svg[aria-hidden="true"]').count(), 1);
    await page.locator('[data-dmp-tab="mock"]').click();
    await page.locator('.dmo-title svg[aria-hidden="true"]').first().waitFor();
    await page.locator('[data-dmp-tab="aptitude"]').click();
    await page.locator('.apt-title svg[aria-hidden="true"]').waitFor();
    const sectionOption = page.locator('.apt-form select').first().locator('option').first();
    assert.ok(!(await sectionOption.innerHTML()).includes('<svg'), 'native options remain text-only');
    await page.locator('[data-dmp-tab="playbook"]').click();
    await page.locator('.dpb-title svg[aria-hidden="true"]').waitFor();
    await navigate(page, 'Development');
    for (const id of ['dev-weekly-sparkline-card', 'dev-difficulty-radar-card', 'dev-milestone-badges-card', 'dev-pace-projection-card']) {
      await page.locator('#' + id).waitFor();
    }
    assert.equal(await page.locator('.ddvr-title svg[aria-hidden="true"]').count(), 1);
    assert.equal(await page.locator('.dmh-log-icon svg[aria-hidden="true"]').count(), 4);
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, 'document overflow at ' + width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigate(page, 'CGPA Tracker');
    await page.locator('.cgpa-title svg[aria-hidden="true"]').waitFor();
    assert.equal(await page.locator('.cgpa-wrap .wnav-icon svg[aria-hidden="true"]').count(), 4);
    // Existing achievement records may contain old decorative characters.
    // Render the known icon by stable ID without mutating the stored record or
    // treating unknown, user-owned records as application defaults.
    const legacy = [
      { id: 'ach1', title: 'First Steps', description: 'Legacy test', icon: String.fromCodePoint(0x1f3af), rarity: 'Common', xp: 10, category: 'Study', unlocked: true },
      { id: 'custom-achievement', title: 'Custom', description: 'User note ' + String.fromCodePoint(0x1f680), icon: String.fromCodePoint(0x1f680), rarity: 'Rare', xp: 1, category: 'Misc', unlocked: false }
    ];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(data => localStorage.setItem('achievements', JSON.stringify(data)), legacy);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.cloudAuth === 'ready' && window.__ariseWidgetsReady === true);
    await navigate(page, 'Achievements');
    const known = page.locator('#arise-main h4', { hasText: 'First Steps' }).locator('..').locator('..').locator('..');
    await known.locator('svg[aria-hidden="true"]').waitFor();
    assert.equal(await known.innerText().then(text => text.includes(legacy[0].icon)), false);
    assert.ok((await page.locator('#arise-main').innerText()).includes(legacy[1].description));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('achievements'))), legacy);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('Icon and integration browser checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
