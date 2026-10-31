'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('service worker bypasses protected APIs, fetches security scripts network-first and reloads pre-auth cached pages without touching user data', async () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../service-worker.js'), 'utf8');
  for (const oldCache of ['arise-developer-system-v243', 'arise-developer-system-v244-secure-cloud']) {
    const events = {}, deleted = [], navigation = [], calls = [];
    const response = new Response('new security code');
    const context = {
      URL, Request, Response, setTimeout, clearTimeout,
      self: { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/' },
        addEventListener: (name, handler) => { events[name] = handler; },
        clients: { claim: async () => {}, matchAll: async () => [{ url: 'https://example.test/notes', navigate: async url => navigation.push(url) }] } },
      caches: { keys: async () => [oldCache], delete: async name => { deleted.push(name); }, open: async () => ({ match: async () => new Response('stale'), put: async () => {} }) },
      fetch: async request => { calls.push(request.url); return response; }
    };
    vm.runInNewContext(code, context);
    let work; events.activate({ waitUntil: promise => { work = promise; } }); await work;
    assert.equal(navigation.length, oldCache.includes('secure-cloud') ? 0 : 1);
    assert.ok(deleted.every(name => name.startsWith('arise-developer-system-')));
    for (const pathname of ['/api/cloud', '/api/public-config', '/api/ai-ask', '/.netlify/functions/cloud']) {
      events.fetch({ request: new Request('https://example.test' + pathname), respondWith: () => assert.fail('protected response must never be cached') });
    }
    let fetched;
    events.fetch({ request: new Request('https://example.test/assets/cloud-auth.js'), waitUntil: promise => { work = promise; }, respondWith: promise => { fetched = promise; } });
    assert.equal(await (await fetched).text(), 'new security code');
    assert.equal(calls.at(-1), 'https://example.test/assets/cloud-auth.js');
    assert.ok(!/localStorage|indexedDB/.test(code), 'cache upgrades never delete progress/backup/session storage');
  }
});
