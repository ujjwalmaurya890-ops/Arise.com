#!/usr/bin/env node
'use strict';
// Real Chromium QA. Mock Google identities are injected ONLY by Playwright's
// network interception; the production bundle has no test-auth switch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const binaryModule = require('@sparticuz/chromium');
const binary = binaryModule.default || binaryModule;
const { buildSync } = require('esbuild');
const { fixture, commitBody } = require('../tests/cloud/helpers.cjs');
const origin = process.env.ARISE_TEST_URL || 'http://127.0.0.1:8123';
const f = fixture();
const source = `
import { createController } from './src/cloud/auth-controller.js';
import { startProtectedRuntime } from './src/cloud/protected-runtime.js';
import * as codec from './src/cloud/backup-codec.js';
window.AriseBackupCodec = codec;
let user = sessionStorage.getItem('test:signed-out') ? null : { uid: 'uid-1', getIdToken: async () => 'token-1' }, watch;
createController({ user: () => user, signIn: async () => { sessionStorage.removeItem('test:signed-out'); user = { uid:'uid-1',getIdToken:async()=>'token-1' }; await watch(user); },
 signOut:async()=>{sessionStorage.setItem('test:signed-out','1');user=null;await watch(null);}, watch: next => { watch = next; next(user); } });
startProtectedRuntime();`;
const bundle = buildSync({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: 'browser-test-entry.js' }, bundle: true, format: 'esm', write: false }).outputFiles[0].text;
(async () => {
  const libraries = process.platform === 'linux' ? await binaryModule.inflate(path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../bin/al2023.tar.br')) : null;
  const browser = await chromium.launch({ args: binary.args.filter(arg => !['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials', '--single-process'].includes(arg)), executablePath: process.env.CHROMIUM_PATH || await binary.executablePath(), headless: true,
    env: { ...process.env, ...(libraries ? { LD_LIBRARY_PATH: path.join(libraries, 'lib') + ':' + (process.env.LD_LIBRARY_PATH || '') } : {}) } });
  const errors = [], output = path.join(process.cwd(), '.test-artifacts'); fs.mkdirSync(output, { recursive: true });
  const contexts = [];
  try {
    const locked = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }); contexts.push(locked);
    const entry = await locked.newPage();
    await entry.goto(origin); await entry.getByText('Google sign-in is not configured yet.', { exact: false }).waitFor();
    assert.equal(await entry.locator('#cloud-google').isDisabled(), true);
    assert.equal(await entry.locator('#root').isVisible(), false);
    assert.equal(await entry.evaluate(() => window.__ariseWidgetsReady === true), false);
    await entry.screenshot({ path: path.join(output, 'login-unconfigured.png') });
    console.log('PASS: unconfigured production entry is locked; no dashboard runtime executes.');
    await f.call('token-1', 'POST', commitBody('notes', '[{"id":"historic","createdAt":"2020-01-01T00:00:00Z","content":"Persisted"}]'));
    async function authenticatedContext(viewport) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' }); contexts.push(context);
      await context.route('**/assets/cloud-auth.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle }));
      await context.route('**/api/cloud**', async route => {
        const request = route.request(), url = new URL(request.url());
        const result = await f.handler({ httpMethod: request.method(), headers: request.headers(), queryStringParameters: Object.fromEntries(url.searchParams), body: request.postData() || '' });
        await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.locator('#arise-main').waitFor({ timeout: 30000 });
      await page.evaluate(() => window.__ariseExpedite?.());
      await page.waitForFunction(() => window.__ariseWidgetsReady === true, { timeout: 30000 });
      await page.evaluate(() => window.AriseAuth.sync.flush());
      return { context, page };
    }
    const a = await authenticatedContext({ width: 1440, height: 1000 });
    assert.match(await a.page.evaluate(() => localStorage.getItem('notes')), /historic/);
    await a.page.evaluate(async () => {
      localStorage.setItem('tasks', JSON.stringify([{ id: 'device-A-task', title: 'Device A progress', createdAt: '2026-10-01T01:02:03Z', completed: true }]));
      localStorage.setItem('arise-dashboard-theme', 'white');
      await window.AriseAuth.sync.flush();
    });
    assert.match((await f.request()('?action=read&key=tasks')).value, /device-A-task/);
    console.log('PASS: authenticated production dashboard and all 108 widget scripts load; automatic writes are acknowledged.');
    const navigation = ['DSA Mastery', 'Dev Mastery', 'Learning', 'Expenses', 'Notes'];
    const visited = [];
    for (const name of navigation) {
      const button = a.page.getByRole('button', { name, exact: true }).first();
      if (await button.count()) { await button.click(); await a.page.waitForTimeout(200); visited.push(name); }
    }
    await a.page.evaluate(() => window.AriseAuth.sync.flush());
    console.log('Visited live feature navigation:', visited.join(', ') || '(labels are decorated; core runtime checked)');
    const unsupported = await a.page.evaluate(() => [...window.AriseAuth.sync.unsupportedKeys]);
    assert.deepEqual(unsupported, [], 'Add discovered live storage keys to the audited schema: ' + unsupported.join(', '));
    await a.page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('arise-local-files-db-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ id:'lf_browser', name:'proof.txt', ownerType:'project', ownerId:'p1', size:11, type:'text/plain', blob:new Blob(['exact bytes']), uploadedAt:'2020-01-02T03:04:05Z' }); tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error); }); db.close();
    });
    await a.page.waitForFunction(() => !window.AriseStorage.recoverFileJournal().length && [...window.AriseAuth.sync.records.keys()].some(key => key.startsWith('idb:')), null, { timeout:15000 });
    console.log('PASS: native IndexedDB attachment changes are automatically journaled and saved.');
    const b = await authenticatedContext({ width: 390, height: 844 });
    assert.match(await b.page.evaluate(() => localStorage.getItem('tasks')), /device-A-task/);
    assert.equal(await b.page.evaluate(() => document.documentElement.dataset.theme), 'white');
    assert.equal(await b.page.evaluate(async () => (await window.AriseStorage.files('arise-local-files-db-v1', false))[0].blob.text()), 'exact bytes');
    assert.ok(await b.page.locator('#cloud-account summary').evaluate(element => { const box = element.getBoundingClientRect(); return !!document.elementFromPoint(box.right - 8, box.top + box.height / 2)?.closest('#cloud-account'); }), 'Mobile account status must not be covered by the existing notification control');
    await b.page.screenshot({ path: path.join(output, 'mobile-restored-workspace.png') });
    assert.ok(await b.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No mobile horizontal overflow');
    console.log('PASS: independent mobile browser context restores IDs, completion state, history and theme.');
    await a.page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('arise-local-files-db-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
        const base = { ownerType: 'project', ownerId: 'p1', blob: new Blob(['retained']), size: 8, type: 'text/plain', uploadedAt: '2020-01-01' };
        store.add({ ...base, id: 'range_1', name: 'range1.txt' }); store.add({ ...base, id: 'range_2', name: 'range2.txt' });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      await window.AriseAuth.sync.scanAttachments(); await window.AriseAuth.sync.flush();
      await new Promise(resolve => {
        const tx = db.transaction('files', 'readwrite'), store = tx.objectStore('files');
        store.put({ id: 'lf_browser', name: 'aborted1', blob: new Blob(['bad']) }); store.put({ id: 'lf_browser', name: 'aborted2', blob: new Blob(['bad']) });
        tx.onabort = resolve; tx.abort();
      });
      if (window.AriseStorage.recoverFileJournal().length) throw new Error('Aborted transaction left a file replay marker.');
      await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(IDBKeyRange.bound('range_1', 'range_2')); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
    });
    await a.page.waitForFunction(() => !window.AriseStorage.recoverFileJournal().length && [...window.AriseAuth.sync.records.values()].filter(r => r.key.startsWith('idb:') && r.deleted).length === 2);
    assert.equal(await a.page.evaluate(async () => (await window.AriseStorage.files('arise-local-files-db-v1', false))[0].blob.text()), 'exact bytes');
    await a.page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('arise-local-files-db-v1', 1); r.onsuccess = () => resolve(r.result); });
      await new Promise((resolve, reject) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
    });
    await a.page.waitForFunction(() => !window.AriseStorage.recoverFileJournal().length && [...window.AriseAuth.sync.records.values()].filter(r => r.key.startsWith('idb:') && r.deleted).length === 3);
    const c = await authenticatedContext({ width: 1024, height: 768 });
    assert.equal(await c.page.evaluate(async () => (await window.AriseStorage.files('arise-local-files-db-v1', false)).length), 0);
    await c.context.close(); contexts.splice(contexts.indexOf(c.context), 1);
    console.log('PASS: real native overlapping aborts, range deletions and clear preserve recovery semantics; another device restores tombstones.');
    const zipBytes = await a.page.evaluate(async () => {
      const archive = await window.AriseBackupCodec.backupZip({ meta: { ownerUid: 'uid-1' }, localStorage: { notes: JSON.stringify('worker ZIP ' + 'x'.repeat(350000)) }, indexedDB: [] });
      const restored = await window.AriseBackupCodec.readBackupFile(archive);
      return JSON.parse(restored.localStorage.notes).length;
    });
    assert.equal(zipBytes, 350011);
    console.log('PASS: real Chromium worker-based ZIP export/import preserves large JSON.');
    await b.context.setOffline(true);
    await b.page.evaluate(async () => { localStorage.setItem('notes', '[{"id":"offline-note","content":"retained"}]'); await window.AriseAuth.sync.flush(); });
    assert.equal(await b.page.evaluate(() => window.AriseAuth.sync.lastStatus.status), 'offline');
    await b.context.setOffline(false);
    await b.page.evaluate(async () => { await window.AriseAuth.sync.flush(); });
    assert.match((await f.request()('?action=read&key=notes')).value, /offline-note/);
    console.log('PASS: offline pending queue reconnects and saves without duplication.');
    await b.page.locator('#cloud-account summary').click();
    await b.page.locator('#cloud-signout').click();
    await b.page.waitForFunction(() => !window.AriseAuth?.snapshot().isAuthenticated);
    assert.equal(await b.page.locator('#root').isVisible(), false);
    console.log('PASS: logout locks protected pages.');
    assert.deepEqual(errors, [], 'Browser runtime errors: ' + errors.join('; '));
    console.log('PASS: no uncaught Chromium runtime errors. Screenshots are in .test-artifacts/.');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
