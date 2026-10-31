'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const bundle = fs.readFileSync(path.resolve(__dirname, '../assets/app-bundle.js'), 'utf8');
const begin = bundle.indexOf('var __ariseAnalyticsProm = null;');
const loader = bundle.slice(begin, bundle.indexOf('// Contain a rejected lazy import', begin));
function setup() {
  const dom = new JSDOM('<!doctype html><head></head>', { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window, timers = [];
  for (const name of ['b', 'ze', 't_', 'Fi', 'qA', 'hl', 'f6', 'Yn', 'z0', 'y', 'Xe', 'et']) w[name] = {};
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearTimeout = () => {};
  w.eval(loader);
  return { w, timers };
}
(async () => {
  {
    const { w } = setup();
    try {
      const first = w.__loadAriseAnalytics(), second = w.__loadAriseAnalytics();
      assert.equal(first, second, 'concurrent callers share one request');
      const script = w.document.querySelector('script');
      assert.equal(w.document.querySelectorAll('script').length, 1);
      const rejected = assert.rejects(first, /could not load/); script.onerror(); await rejected;
      const retry = w.__loadAriseAnalytics(); assert.notEqual(retry, first);
      const module = { default: () => null }; w.__ARISE_ANALYTICS_MODULE__ = module;
      w.document.querySelector('script').onload(); assert.equal(await retry, module);
      assert.equal(await w.__loadAriseAnalytics(), module);
    } finally { w.close(); }
  }
  {
    const { w, timers } = setup();
    try {
      const promise = w.__loadAriseAnalytics();
      const oldLoad = w.document.querySelector('script').onload;
      const rejected = assert.rejects(promise, /could not load/);
      assert.equal(timers[0].ms, 12000); timers[0].fn(); await rejected;
      assert.equal(w.document.querySelectorAll('script').length, 0);
      oldLoad(); // a late completion cannot settle an already-failed request twice
    } finally { w.close(); }
  }
  {
    const { w } = setup();
    try {
      const promise = w.__loadAriseAnalytics(), rejected = assert.rejects(promise, /could not load/);
      w.document.querySelector('script').onload(); await rejected;
    } finally { w.close(); }
  }
  {
    const { w } = setup();
    try {
      w.__ARISE_ANALYTICS_MODULE__ = { default: 42 };
      const promise = w.__loadAriseAnalytics();
      assert.ok(w.document.querySelector('script'), 'an invalid cached export is not reused');
      const rejected = assert.rejects(promise, /could not load/);
      w.document.querySelector('script').onload(); await rejected;
      const retry = w.__loadAriseAnalytics();
      const module = { default: { $$typeof: Symbol.for('react.memo'), type: () => null } };
      w.__ARISE_ANALYTICS_MODULE__ = module;
      w.document.querySelector('script').onload(); assert.equal(await retry, module);
    } finally { w.close(); }
  }
  const splitter = fs.readFileSync(path.resolve(__dirname, '../scripts/tools/split-app-bundle.cjs'), 'utf8');
  const template = splitter.match(/src: `(var __ariseAnalyticsProm[\s\S]*?)`\n};/)[1]
    .replace('${depsFromMain.join(", ")}', 'b, ze, t_, Fi, qA, hl, f6, Yn, z0, y, Xe, et');
  assert.ok(bundle.includes(template), 'checked-in shim stays identical to its source generation template');
  console.log('Analytics loader: deduplication, retry, deadline, late events, missing export and source/template parity passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
