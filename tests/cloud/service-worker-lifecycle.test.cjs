'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.resolve(__dirname, '../../service-worker.js'), 'utf8');
const base = 'https://arise.test/';
const absolute = value => new URL(typeof value === 'string' ? value : value.url, base).href;
function worker(options = {}) {
  const events = {}, entries = new Map(), deleted = [], fetched = [], work = [];
  let skipped = 0;
  class WorkerRequest extends Request { constructor(input, init) { super(absolute(input), init); } }
  const cache = {
    match: async request => entries.get(absolute(request))?.clone(),
    put: async (request, response) => { entries.set(absolute(request), response.clone()); },
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    add: async () => { if (options.installFails) throw new Error('asset missing'); },
    addAll: async requests => { if (options.installFails) throw new Error('asset missing'); requests.forEach(request => entries.set(absolute(request), new Response('asset'))); }
  };
  const context = { URL, Request: WorkerRequest, Response, console, Date,
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 1000 ? 25 : 0), clearTimeout,
    fetch: async request => { fetched.push(absolute(request)); return options.fetch ? options.fetch(request) : new Response('network', { headers: { 'content-type': 'text/javascript' } }); },
    caches: { open: async () => cache, match: cache.match, keys: async () => options.cacheNames || [], delete: async name => { deleted.push(name); } },
    self: { location: { origin: new URL(base).origin }, registration: { scope: base },
      addEventListener: (name, handler) => { events[name] = handler; }, skipWaiting: async () => { skipped++; },
      clients: { claim: async () => {}, matchAll: async () => [] } }
  };
  vm.runInNewContext(code, context);
  const dispatch = (name, props = {}) => { let response; events[name]({ ...props, waitUntil: promise => { work.push(promise); }, respondWith: promise => { response = promise; } }); return response; };
  return { cache, entries, events, dispatch, deleted, fetched, work, skipped: () => skipped };
}
const request = (url, props = {}) => ({ url: new URL(url, base).href, method: 'GET', mode: 'cors', destination: '', headers: new Headers(), ...props });

test('activation removes only obsolete Arise caches, never another app cache', async () => {
  const w = worker({ cacheNames: ['arise-developer-system-v244-secure-cloud', 'unrelated-app-cache'] });
  w.dispatch('activate'); await Promise.all(w.work);
  assert.deepEqual(w.deleted, ['arise-developer-system-v244-secure-cloud']);
});

test('a failed core-shell install does not activate a partially cached update', async () => {
  const w = worker({ installFails: true }); w.dispatch('install');
  await assert.rejects(w.work[0], /asset missing/);
  assert.equal(w.skipped(), 0);
});

test('online navigation and fixed-name code prefer the current response, not a cached page or one-hour-old code', async () => {
  for (const [url, props] of [['/', { mode: 'navigate', destination: 'document' }], ['/assets/app-bundle.js', { destination: 'script' }]]) {
    const w = worker();
    await w.cache.put(url, new Response('old', { headers: { date: new Date().toUTCString() } }));
    const response = await w.dispatch('fetch', { request: request(url, props) });
    assert.equal(await response.text(), 'network'); await Promise.all(w.work);
  }
});

test('offline navigation uses the cached shell for a route not previously visited', async () => {
  const w = worker({ fetch: async () => { throw new Error('offline'); } });
  await w.cache.put('./index.html', new Response('offline shell'));
  const response = await w.dispatch('fetch', { request: request('/notes', { mode: 'navigate', destination: 'document' }) });
  assert.equal(await response.text(), 'offline shell'); await Promise.all(w.work);
});

test('a stalled network has a bounded cached navigation fallback and can update cache when it later finishes', async () => {
  let complete;
  const w = worker({ fetch: () => new Promise(resolve => { complete = resolve; }) });
  await w.cache.put('./index.html', new Response('offline shell'));
  const response = await w.dispatch('fetch', { request: request('/', { mode: 'navigate', destination: 'document' }) });
  assert.equal(await response.text(), 'offline shell');
  complete(new Response('new shell', { headers: { 'content-type': 'text/html' } }));
  await Promise.all(w.work);
  assert.equal(await (await w.cache.match('./index.html')).text(), 'new shell');
});

test('immutable hashed chunks are cache-first and protected/range/non-GET/cross-origin requests are bypassed', async () => {
  const w = worker(); await w.cache.put('/assets/chunks/w01.01234567.js', new Response('hashed code'));
  const response = await w.dispatch('fetch', { request: request('/assets/chunks/w01.01234567.js', { destination: 'script' }) });
  assert.equal(await response.text(), 'hashed code'); assert.equal(w.fetched.length, 0);
  for (const req of [request('/api/cloud'), request('/.netlify/functions/cloud'), request('/notes', { method: 'POST' }), request('https://other.test/file.js'), request('/assets/file.mp3', { headers: new Headers({ range: 'bytes=0-3' }) }), request('/private', { headers: new Headers({ authorization: 'Bearer example' }) })]) assert.equal(w.dispatch('fetch', { request: req }), undefined);
});

test('extended-cache requests coalesce and include standalone Analytics while retaining source fallback rules', async () => {
  const w = worker();
  w.dispatch('message', { data: { type: 'arise-fill-cache' } });
  w.dispatch('message', { data: { type: 'arise-fill-cache' } });
  await Promise.all(w.work);
  assert.equal(w.fetched.filter(url => url.endsWith('/assets/app-analytics.js')).length, 1);
  assert.equal(new Set(w.fetched).size, w.fetched.length, 'no simultaneous duplicate cache downloads');
  assert.equal(w.fetched.some(url => url.includes('/src/notes-app-widget.js')), false, 'bundled source is not redundantly cached when chunks succeed');
});
