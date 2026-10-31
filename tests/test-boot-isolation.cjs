'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const loader = html.match(/<script id="arise-lazy-widget-loader">([\s\S]*?)<\/script>/)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  for (const interaction of ['keydown', 'pointerdown', 'touchstart', 'direct']) {
    const dom = new JSDOM('<!doctype html><div id="arise-main"></div>', { url: 'https://example.test/', runScripts: 'outside-only' });
    const w = dom.window;
    let unlock;
    w.AriseBoot = { ready: new Promise(resolve => { unlock = resolve; }) };
    // Run short input deferral immediately; retain long loader deadlines without sleeping.
    const timers = [];
    w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    w.clearTimeout = () => {};
    w.fetch = () => { throw new Error('Speculative fetch must use script preloads, not unused array buffers'); };
    try {
      w.eval(loader);
      if (interaction === 'direct') w.__ariseExpedite();
      else {
        w.dispatchEvent(new w.Event(interaction));
        timers.filter(t => t.ms === 45).forEach(t => t.fn());
      }
      assert.equal(w.__ariseLazyWidgetsStarted, undefined, interaction + ' must not execute widgets before authorized restore');
      assert.equal(w.document.querySelectorAll('script[src],link[rel="preload"]').length, 0, 'no speculative protected assets while locked');
      unlock(); await tick();
      w.dispatchEvent(new w.Event('load'));
      w.__ariseExpedite();
      assert.equal(w.__ariseLazyWidgetsStarted, true, 'queued interaction is honored after boot');
      const script = w.document.querySelector('script[src]');
      assert.ok(script && script.src.includes('/assets/chunks/w01.'), 'first ordered chunk runs');
      assert.equal(script.async, false, 'dependent scripts remain ordered');
      const preload = w.document.querySelector('link[rel="preload"][as="script"]');
      assert.ok(preload && preload.href.includes('/assets/chunks/w02.'), 'browser-native preload can be reused by the script loader');
    } finally { w.close(); }
  }
  assert.ok(!/<link[^>]+rel="modulepreload"[^>]+app-bundle\.js/.test(html), 'the locked page does not eagerly download the React shell');
  console.log('Boot isolation: keyboard, pointer, touch and direct expedite stay gated; ordered authorized preload path retained.');
})().catch(error => { console.error(error); process.exitCode = 1; });
