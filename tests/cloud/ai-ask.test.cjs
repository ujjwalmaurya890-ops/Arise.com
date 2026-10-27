'use strict';
// Unit tests for netlify/functions/ai-ask.js: authentication gate, request
// validation, upstream payload shaping (model allow-list + maxTokens cap),
// error mapping, no-store response headers and the AbortController timeout
// path. The Firebase admin dependencies and the Anthropic endpoint are
// stubbed via the require cache / global.fetch — no network is used.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ApiError } = require('../../server/access.cjs');

const accessPath = require.resolve('../../server/access.cjs');
const firebasePath = require.resolve('../../server/firebase.cjs');
const functionPath = require.resolve('../../netlify/functions/ai-ask.js');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'netlify/functions/ai-ask.js'), 'utf8');

const stubs = { authError: null };
// Pre-load the real http.cjs while access.cjs is still the real module, so its
// ApiError class binding is captured before the cache stub is installed.
require('../../server/http.cjs');
const realAccess = require.cache[accessPath] ? require.cache[accessPath].exports : null;
const realFirebase = require.cache[firebasePath] ? require.cache[firebasePath].exports : null;

require.cache[accessPath] = {
  id: accessPath, filename: accessPath, loaded: true,
  exports: { authorize: async () => { if (stubs.authError) throw stubs.authError; } }
};
require.cache[firebasePath] = {
  id: firebasePath, filename: firebasePath, loaded: true,
  exports: { getServices: () => ({}) }
};
delete require.cache[functionPath];
const { handler } = require('../../netlify/functions/ai-ask.js');

const realFetch = global.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
let upstream;
global.fetch = (url, options) => upstream(url, options);

before(() => { process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'; });
after(() => {
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = realKey;
  global.fetch = realFetch;
  if (realAccess) require.cache[accessPath].exports = realAccess;
  if (realFirebase) require.cache[firebasePath].exports = realFirebase;
});
beforeEach(() => {
  stubs.authError = null;
  upstream = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '  hello coach  ' }] }) });
});

const post = (payload) => ({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify(payload) });
const privateHeaders = (res) => {
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
};

test('unauthenticated requests are rejected before any upstream call', async () => {
  stubs.authError = new ApiError(401, 'sign-in-required');
  let called = false;
  upstream = async () => { called = true; throw new Error('must not call Anthropic'); };
  const res = await handler(post({ prompt: 'hi' }));
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
  privateHeaders(res);
});

test('only POST is accepted', async () => {
  const res = await handler({ httpMethod: 'GET', headers: { authorization: 'Bearer token' }, body: '' });
  assert.equal(res.statusCode, 405);
  assert.match(JSON.parse(res.body).error, /Method not allowed/);
});

test('missing server API key fails with a configuration error', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const res = await handler(post({ prompt: 'hi' }));
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).error, /ANTHROPIC_API_KEY/);
});

test('malformed JSON, missing prompt and oversized payloads are rejected as 400', async () => {
  const badJson = await handler({ httpMethod: 'POST', headers: {}, body: '{not json' });
  assert.equal(badJson.statusCode, 400);
  const noPrompt = await handler(post({ system: 'sys' }));
  assert.equal(noPrompt.statusCode, 400);
  const huge = await handler(post({ prompt: 'x'.repeat(6001) }));
  assert.equal(huge.statusCode, 400);
});

test('happy path: allow-listed model, capped maxTokens, trimmed text and no-store headers', async () => {
  let received;
  upstream = async (url, options) => {
    received = { url, options };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '  plan  ' }, { type: 'image' }] }) };
  };
  const res = await handler(post({ system: 'coach', prompt: 'advise me', model: 'claude-sonnet-5', maxTokens: 9999 }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { text: 'plan', model: 'claude-sonnet-5' });
  privateHeaders(res);
  assert.equal(received.url, 'https://api.anthropic.com/v1/messages');
  const sent = JSON.parse(received.options.body);
  assert.equal(sent.model, 'claude-sonnet-5');
  assert.equal(sent.max_tokens, 800); // hard cap, client asked for 9999
  assert.equal(sent.system, 'coach');
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'advise me' }]);
  assert.equal(received.options.headers['x-api-key'], 'sk-ant-test-key');
  assert.ok(received.options.signal instanceof AbortSignal, 'upstream fetch is bounded by an AbortSignal');
});

test('unknown models fall back to the default; missing maxTokens defaults to 500', async () => {
  let sent;
  upstream = async (url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; };
  await handler(post({ prompt: 'hi', model: 'claude-sonnet-4-6' }));
  assert.equal(sent.model, 'claude-haiku-4-5-20251001');
  assert.equal(sent.max_tokens, 500);
});

test('upstream 429 is preserved; other upstream failures become 502; empty content becomes 502', async () => {
  upstream = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
  const rate = await handler(post({ prompt: 'hi' }));
  assert.equal(rate.statusCode, 429);
  assert.equal(JSON.parse(rate.body).error, 'rate limited');

  upstream = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
  const bad = await handler(post({ prompt: 'hi' }));
  assert.equal(bad.statusCode, 502);
  assert.equal(JSON.parse(bad.body).error, 'boom');

  upstream = async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) });
  const empty = await handler(post({ prompt: 'hi' }));
  assert.equal(empty.statusCode, 502);
  assert.match(JSON.parse(empty.body).error, /no text/i);
});

test('an aborted upstream call maps to a friendly 504 instead of a generic failure', async () => {
  upstream = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
    // Simulate the timeout firing immediately rather than waiting the full 20 s.
    options.signal.dispatchEvent(new Event('abort'));
  });
  const res = await handler(post({ prompt: 'hi' }));
  assert.equal(res.statusCode, 504);
  assert.match(JSON.parse(res.body).error, /too long/i);
  privateHeaders(res);
});

test('source guard: timeout is bounded and every response uses the private header set', async () => {
  assert.match(source, /FETCH_TIMEOUT_MS\s*=\s*20000/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  const respondMatches = source.match(/'Cache-Control': 'no-store, private'/g);
  assert.ok(respondMatches && respondMatches.length === 1, 'single respond() helper owns the shared headers');
});
