#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function dom(html = '<div id="host"></div>') {
  const d = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', { url: 'https://arise.example/', runScripts: 'outside-only', pretendToBeVisual: true });
  d.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  return d;
}
function load(w, file) { w.eval(source(file)); }
(async () => {
  // One request is shared, including retries, and a stalled body reaches a
  // terminal state even when the transport does not honor AbortSignal.
  {
    const d = dom(), w = d.window, pending = deferred(); let calls = 0;
    w.fetch = () => { calls++; return Promise.resolve({ ok: true, json: () => pending.promise }); };
    load(w, 'src/widget-shared-utils.js');
    const a = w.__ariseShared.fetchInterviewSheets({ timeoutMs: 30 });
    const b = w.__ariseShared.fetchInterviewSheets({ force: true });
    assert.equal(a, b); await tick(0); assert.equal(calls, 1);
    assert.equal(await a, null);
    w.fetch = () => { calls++; return Promise.resolve({ ok: true, json: async () => ({ blind75: { questions: [{ title: 'New' }] } }) }); };
    const fresh = await w.__ariseShared.fetchInterviewSheets();
    pending.resolve({ blind75: { questions: [{ title: 'Old' }] } });
    await tick(5);
    assert.equal((await w.__ariseShared.fetchInterviewSheets()).blind75.questions[0].title, 'New');
    assert.equal(fresh.blind75.questions[0].title, 'New');
    d.window.close();
  }
  // A failed forced refresh does not evict the existing cache.
  {
    const d = dom(), w = d.window; let fail = false, calls = 0;
    w.fetch = async () => { calls++; return fail ? { ok: false } : { ok: true, json: async () => ({ blind75: { questions: [] } }) }; };
    load(w, 'src/widget-shared-utils.js');
    const cached = await w.__ariseShared.fetchInterviewSheets(); fail = true;
    assert.equal(await w.__ariseShared.fetchInterviewSheets({ force: true }), null);
    assert.equal(await w.__ariseShared.fetchInterviewSheets(), cached); assert.equal(calls, 2);
    d.window.close();
  }
  // A successful empty dataset must not be presented as a failed request.
  {
    const d = dom(), w = d.window; w.fetch = async () => ({ ok: true, json: async () => ({}) });
    load(w, 'src/widget-shared-utils.js'); load(w, 'src/interview-sheets-widget.js');
    const host = w.document.getElementById('host'); w.__mountInterviewSheets(host);
    assert.equal(host.getAttribute('aria-busy'), 'true'); await tick(15);
    assert.match(host.textContent, /No interview sheets available/);
    assert.equal(host.querySelector('[role="alert"]'), null); assert.equal(host.hasAttribute('aria-busy'), false);
    w.__unmountInterviewSheets(host); d.window.close();
  }
  // Mount safety must not clear a widget-owned busy state or render an old
  // rejected async mount over a newer mount.
  {
    const d = dom(), w = d.window, old = deferred(); let count = 0;
    w.__mountExample = el => { count++; if (count === 1) { el.setAttribute('aria-busy', 'true'); return old.promise; } el.textContent = 'Current content'; };
    load(w, 'src/mount-safety.js'); const host = w.document.getElementById('host');
    const first = w.__mountExample(host); assert.equal(host.getAttribute('aria-busy'), 'true');
    w.__mountExample(host); old.reject(new Error('old failure')); await first;
    assert.equal(host.textContent, 'Current content'); assert.equal(host.querySelector('[role="alert"]'), null);
    d.window.close();
  }
  // AI cancellation and deadlines include response parsing and tolerate a
  // non-cooperative fetch implementation.
  {
    const d = dom(), w = d.window; let calls = 0;
    w.AriseAuth = { fetch: () => { calls++; return Promise.resolve({ ok: true, json: () => new Promise(() => {}) }); } };
    load(w, 'src/ai-connect-shared.js');
    await assert.rejects(w.__ariseAI.ask('system', 'prompt', { timeoutMs: 20 }), /timed out/);
    const ctrl = new w.AbortController(); ctrl.abort();
    await assert.rejects(w.__ariseAI.ask('system', 'prompt', { signal: ctrl.signal }), e => e.name === 'AbortError');
    assert.equal(calls, 1); d.window.close();
  }
  // Deferred mounts show shaped placeholders, settle to a retryable failure,
  // and replay only against a still-connected host when the module recovers.
  {
    const d = dom(), w = d.window;
    load(w, 'src/animation-upgrade.js');
    const index = source('index.html');
    const script = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(text => text.includes('var NAMES = [') && text.includes('__ariseFlushMounts'));
    assert.ok(script); w.eval(script);
    const host = w.document.getElementById('host');
    w.__mountCompetitiveProgramming(host);
    assert.ok(host.querySelector('.uxa-skeleton-layout--dashboard'));
    assert.equal(host.getAttribute('aria-busy'), 'true');
    w.__ariseWidgetsSettled = true; w.__ariseFlushMounts();
    assert.ok(host.querySelector('[data-arise-mount-error][role="alert"]'));
    assert.equal(host.hasAttribute('aria-busy'), false);
    w.__ariseRetryWidgetScripts = () => { w.__mountCompetitiveProgramming = el => { el.textContent = 'Recovered'; }; w.__ariseFlushMounts(); };
    host.querySelector('[data-arise-mount-retry]').click();
    assert.equal(host.textContent, 'Recovered'); assert.equal(host.hasAttribute('aria-busy'), false);
    d.window.close();
  }
  // Each shaped variant exposes one status and hides its decorative geometry.
  {
    const d = dom(), w = d.window; load(w, 'src/animation-upgrade.js');
    for (const variant of ['widget', 'dashboard', 'chart', 'table', 'list', 'form']) {
      const host = w.document.createElement('div'); host.innerHTML = w.AriseAnimationUpgrade.renderSkeleton({ variant, label: 'Loading example' });
      assert.equal(host.querySelectorAll('[role="status"]').length, 1);
      assert.equal(host.querySelector('.uxa-skeleton-group').getAttribute('aria-hidden'), 'true');
      assert.ok(host.querySelector('.uxa-skeleton-layout--' + variant));
    }
    d.window.close();
  }
  console.log('Loading foundation: deduplication, timeout, cache, empty, cancellation, stale mount and skeleton shape checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
