'use strict';
// Regression test: Certificates AI features must go through the same-origin /api/ai-ask proxy
// (API key stays server-side) and must surface failures instead of hanging or hiding them.
// Usage: node tests/test-certificates-ai-routing.cjs   (WIDGET_FILE=<path> to test another copy)
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }
const WIDGET = process.env.WIDGET_FILE || path.join(path.resolve(__dirname, ".."), 'src/features/certificates/certificates-widget.js');
const tick = (ms) => new Promise(r => setTimeout(r, ms));

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.__ARISE_MUTATION_BUS__ = { subscribe() {} };
  w.confirm = () => true;
  w.__calls = [];
  w.__reply = null;
  w.fetch = (u, o) => {
    w.__calls.push({ url: String(u), body: o && o.body ? JSON.parse(o.body) : null });
    return w.__reply();
  };
  const load = (f) => w.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8'));
  load('src/features/certificates/certificates-storage.js');
  if (!opts.noShared) load('src/ai-connect-shared.js');
  w.eval(fs.readFileSync(WIDGET, 'utf8'));
  const cert = w.AriseCertificatesStorage.upsert({ title: 'Intro to ML', issuer: 'Coursera', category: 'Course', tags: ['ml'] });
  const root = w.document.getElementById('root');
  w.__mountCertificates(root);
  return { w, root, cert };
}
const ok = (obj) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(obj) });
const bad = (status, obj) => () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(obj) });
const click = (root, action) => { const b = root.querySelector('[data-action="' + action + '"]'); if (!b) return false; b.click(); return true; };

(async function () {
  assert(fs.readFileSync(WIDGET, 'utf8').indexOf('api.anthropic.com') === -1, 'widget source never references api.anthropic.com directly');

  // 1) Analyze -> proxy, success
  let t = boot();
  t.w.__reply = ok({ text: '{"score":80,"missing":[],"suggestedTags":["ml"],"resumeBlurb":"Completed ML course","advice":"Add the credential URL"}' });
  assert(click(t.root, 'analyze'), 'analyze button exists');
  await tick(200);
  assert(t.w.__calls.length === 1 && t.w.__calls[0].url === '/api/ai-ask', 'analyze posts to same-origin /api/ai-ask');
  const b1 = t.w.__calls[0].body || {};
  assert(typeof b1.system === 'string' && typeof b1.prompt === 'string' && b1.maxTokens === 500, 'request has system, prompt and maxTokens (proxy shape)');
  assert(!('model' in b1) || b1.model !== 'claude-sonnet-4-6', 'client does not request a model the proxy would reject');
  assert(t.root.textContent.indexOf('Add the credential URL') >= 0, 'analysis result is rendered');
  assert(t.w.__calls.length === 1, 'one click makes exactly ONE request (analyze handler was bound twice before)');
  click(t.root, 'analyze');
  await tick(200);
  assert(t.w.__calls.length === 2, 'Re-analyze after completion still works');

  // 2) Interview prep -> proxy, success
  t = boot();
  t.w.__reply = ok({ text: '[{"q":"What is overfitting?","a":"Fitting noise."}]' });
  assert(click(t.root, 'interview-prep'), 'interview-prep button exists');
  await tick(200);
  assert(t.w.__calls.length === 1 && t.w.__calls[0].url === '/api/ai-ask', 'interview prep posts to /api/ai-ask');
  assert(t.root.textContent.indexOf('What is overfitting?') >= 0, 'interview questions are rendered');

  // 3) Proxy error is surfaced, not swallowed
  t = boot();
  t.w.__reply = bad(502, { error: 'Anthropic request failed (502).' });
  click(t.root, 'analyze');
  await tick(200);
  assert(t.root.textContent.indexOf('Analysis failed') >= 0, 'a proxy failure is shown to the user (not left spinning or hidden)');
  assert(t.w.__calls.length === 1, 'a failing click still makes exactly one request');

  // 4) Missing shared helper -> clear error, no network call
  t = boot({ noShared: true });
  t.w.__reply = ok({ text: '{}' });
  click(t.root, 'analyze');
  await tick(200);
  assert(t.w.__calls.length === 0, 'no request is made when src/ai-connect-shared.js is missing');
  assert(t.root.textContent.indexOf('Analysis failed') >= 0, 'the missing-helper case is shown as a failure, not a hang');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
