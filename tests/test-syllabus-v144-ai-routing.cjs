'use strict';
// Regression test: the CSE Syllabus+ v144 "AI Insights" button used to call
// /api/ai-ask with a bare fetch(), so the request never carried the
// Authorization header. The Netlify function rejects unauthenticated calls
// (401 sign-in-required), meaning the feature failed in every real session.
// It must route through window.AriseAuth.fetch (which injects the bearer
// token), exactly like src/ai-connect-shared.js and the certificates widget.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }
const tick = (ms) => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
const PATCH = path.join(ROOT, 'src/features/semester-risk/cse-syllabus-plus-v144-patch.js');

function boot() {
  const dom = new JSDOM('<!doctype html><html><body><div id="cse-syllabus-plus-panel"></div></body></html>',
    { url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const store = {};
  Object.defineProperty(w, 'localStorage', { configurable: true, value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  } });
  w.confirm = () => true;
  w.alert = () => {};
  w.__ariseAuthCalls = [];
  w.__bareFetchCalls = [];
  w.AriseAuth = {
    // Mirrors the production controller: same-origin fetch with the bearer token.
    fetch: (url, opts) => { w.__ariseAuthCalls.push({ url: String(url), opts }); return w.__aiReply(); }
  };
  w.fetch = (url) => { w.__bareFetchCalls.push(String(url)); return Promise.reject(new Error('bare fetch must not be used for /api/ai-ask')); };
  w.eval(fs.readFileSync(PATCH, 'utf8'));
  if (w.document.readyState === 'loading') {
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  }
  return w;
}

(async function main() {
  const source = fs.readFileSync(PATCH, 'utf8');
  ok(!/fetch\(["']\/api\/ai-ask["']\)/.test(source), 'no bare fetch() call to /api/ai-ask remains');
  ok(/window\.AriseAuth\.fetch\(["']\/api\/ai-ask["']/.test(source), 'AI call is routed through window.AriseAuth.fetch');

  // 1) Authenticated session: clicking AI Insights uses the authenticated fetch and renders the reply.
  let w = boot();
  w.__aiReply = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'Focus on DBMS normalization this week.' }) });
  const panel = w.document.getElementById('csp-v144-panel');
  ok(!!panel, 'v144 toolbar panel mounts beside the syllabus panel');
  const btn = w.document.getElementById('csp144-ai-btn');
  ok(!!btn, 'AI Insights button is rendered');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(120);
  ok(w.__ariseAuthCalls.length === 1, 'exactly one authenticated AI request on click (' + w.__ariseAuthCalls.length + ')');
  ok(w.__ariseAuthCalls[0] && w.__ariseAuthCalls[0].url === '/api/ai-ask', 'request targets the same-origin /api/ai-ask proxy');
  ok(w.__bareFetchCalls.length === 0, 'no unauthenticated bare fetch bypasses the auth layer');
  const sent = JSON.parse(w.__ariseAuthCalls[0].opts.body);
  ok(typeof sent.prompt === 'string' && sent.prompt.length > 0, 'request body carries a prompt');
  await tick(120);
  ok(panel.textContent.indexOf('Focus on DBMS normalization this week.') >= 0, 'AI insight text is rendered in the panel');
  ok(panel.textContent.indexOf('Could not reach the AI endpoint') === -1, 'no error state after a successful reply');

  // 2) The 4h cache stores the successful insight (re-render shows it without another request).
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); // hide
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); // show again (cached)
  await tick(80);
  ok(w.__ariseAuthCalls.length === 1, 'reopening the panel reuses the cached insight instead of re-requesting');
  ok(panel.textContent.indexOf('Focus on DBMS normalization this week.') >= 0, 'cached insight is still displayed');

  // 3) Proxy failure is surfaced and the loading flag is released (no permanent spinner).
  w = boot();
  w.__aiReply = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Anthropic request failed (502).' }) });
  w.document.getElementById('csp144-ai-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(120);
  ok(w.__ariseAuthCalls.length === 1, 'failed click still makes exactly one request');
  const failPanel = w.document.getElementById('csp-v144-panel');
  ok(failPanel.textContent.indexOf('Could not reach the AI endpoint') >= 0, 'proxy failure is shown to the user');
  // Retry works because the in-flight guard (k) was released in the catch path.
  w.__aiReply = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: 'Recovered insight.' }) });
  w.document.getElementById('csp144-ai-refresh-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(120);
  ok(w.__ariseAuthCalls.length === 2, 'refresh button issues a new request after a failure (loading flag released)');
  ok(failPanel.textContent.indexOf('Recovered insight.') >= 0, 'retry renders the recovered insight');

  // 4) Without an authenticated session the helper rejects cleanly instead of sending an anonymous request.
  w = boot();
  delete w.AriseAuth;
  w.document.getElementById('csp144-ai-btn').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(120);
  ok(w.__bareFetchCalls.length === 0, 'no anonymous network request is attempted when signed out');
  ok(w.document.getElementById('csp-v144-panel').textContent.indexOf('Could not reach the AI endpoint') >= 0, 'signed-out state shows the failure message');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
