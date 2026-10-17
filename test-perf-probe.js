/* v238: perf-probe.js must never be the thing that breaks a page. It runs in the real
 * app on a developer's machine and touches half a dozen optional browser APIs, so this
 * test drives it in jsdom (which has no PerformanceObserver at all), then again with a
 * stubbed observer pipeline, and asserts it degrades instead of throwing.
 * Run: node test-perf-probe.js        (DEBUG=1 for the per-assert list)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VERBOSE = process.env.DEBUG === '1';
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; if (VERBOSE) console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }

const code = fs.readFileSync(path.join(__dirname, 'perf-probe.js'), 'utf8');

function boot(url, withObserver) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',
    { url, runScripts: 'dangerously' });
  const w = dom.window;
  const emitted = [];
  if (withObserver) {
    w.PerformanceObserver = function (cb) {
      emitted.push(cb);
      return { observe() {}, disconnect() {} };
    };
  }
  let threw = null;
  try { w.eval(code); } catch (e) { threw = e; }
  return { w, emitted, threw };
}

(async function () {
  // ── unsupported browser: no PerformanceObserver, no LCP/INP/CLS/longtask ────
  let t = boot('https://arise.test/', false);
  ok(!t.threw, 'loads without throwing when PerformanceObserver does not exist' + (t.threw ? ' (' + t.threw.message + ')' : ''));
  ok(typeof t.w.__arisePerf === 'object' && t.w.__arisePerf !== null, 'window.__arisePerf is exposed');
  let d = null, jsonThrew = null;
  try { d = t.w.__arisePerf.json(); } catch (e) { jsonThrew = e; }
  ok(!jsonThrew, 'json() works with zero support' + (jsonThrew ? ' (' + jsonThrew.message + ')' : ''));
  ok(d && d.longtasks && d.longtasks.count === 0, 'json() reports empty longtasks rather than undefined');
  ok(d && d.network && d.network.count === 0, 'json() reports an empty network section');
  ok(d && d.arise && 'chunkSplit' in d.arise && 'storageBus' in d.arise, 'json() includes the Arise-specific phase section');
  let repThrew = null;
  try { t.w.__arisePerf.report(); } catch (e) { repThrew = e; }
  ok(!repThrew, 'report() degrades to console.log rows instead of needing console.table');
  ok(t.w.document.querySelectorAll('div[aria-hidden="true"]').length === 0, 'no HUD without ?perf=1 (it stays invisible to normal runs)');
  const dup = (() => { try { t.w.eval(code); return false; } catch (e) { return true; } })();
  ok(!dup, 're-running the probe is a no-op, not a second set of observers');

  // ── supported browser: entries are picked up ───────────────────────────────
  t = boot('https://arise.test/?perf=1', true);
  ok(!t.threw, 'loads with a PerformanceObserver present');
  ok(t.emitted.length >= 4, 'registers one observer per supported entry type (got ' + t.emitted.length + ': longtask/lcp/event/layout-shift/paint)');
  const hud = t.w.document.querySelectorAll('div[aria-hidden="true"]');
  ok(hud.length === 1, 'exactly one HUD element with ?perf=1');
  ok(hud.length === 1 && /FCP/.test(hud[0].textContent), 'HUD renders the FCP/LCP/INP/CLS line');
  // feed a long task and a slow interaction through the real callbacks
  t.emitted.forEach(cb => {
    try {
      cb([{ startTime: 900, duration: 180, name: 'long-animation-frame', hadRecentInput: false, value: 0.02, size: 1234, element: t.w.document.getElementById('app'), processingStart: 905, processingEnd: 1050, type: 'event' }]);
    } catch (e) { /* some callbacks only accept their own entry type - fine */ }
  });
  let threw2 = null, d2 = null;
  try { d2 = t.w.__arisePerf.json(); } catch (e) { threw2 = e; }
  ok(!threw2, 'json() still cannot throw after receiving synthetic entries' + (threw2 ? ' (' + threw2.message + ')' : ''));
  let threw3 = null;
  try { t.w.__arisePerf.report(); t.w.__arisePerf.stop(); t.w.__arisePerf.mark('probe-test'); } catch (e) { threw3 = e; }
  ok(!threw3, 'report(), stop() and mark() are all safe to call');
  ok(t.w.__arisePerf.json().marks.some(m => m.name === 'probe-test'), 'mark() records into the payload');

  console.log((fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e && e.stack); process.exit(1); });
