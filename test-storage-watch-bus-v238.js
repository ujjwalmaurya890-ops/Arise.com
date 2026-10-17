/* v238 perf guard for storage-watch-bus.js — pins the behaviour the rewrite added on
 * top of the pre-existing contract in test-storage-watch-bus.js (which still passes
 * unchanged):
 *   1. one localStorage.getItem per DISTINCT key per tick, not per subscriber;
 *   2. every subscriber on a shared key still gets called, with the raw value;
 *   3. the shared interval stops when the last watcher unsubscribes (it used to keep
 *      an empty timer running if the tab was visible at that moment);
 *   4. unwatch after the key was re-watched prunes the right entry;
 *   5. a throwing watcher cannot starve the others on the same tick.
 * Run: node test-storage-watch-bus-v238.js        (DEBUG=1 for the per-assert list)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VERBOSE = process.env.DEBUG === '1' || process.argv.indexOf('--verbose') !== -1;
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; if (VERBOSE) console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }

const code = fs.readFileSync(path.join(__dirname, 'storage-watch-bus.js'), 'utf8');

function makeBus() {
  const store = Object.create(null);
  let reads = 0, writes = 0, scheduled = null;
  const listeners = {};
  const localStorage = {
    getItem(k) { reads++; return k in store ? store[k] : null; },
    setItem(k, v) { writes++; store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const document = {
    hidden: false,
    addEventListener(t, cb) { (listeners[t] = listeners[t] || []).push(cb); },
    dispatchEvent() { return true; }
  };
  const sb = {
    console: { warn() {}, log() {}, error() {} }, document, localStorage,
    setInterval(fn, ms) { scheduled = { fn, ms }; return 1; },
    clearInterval() { scheduled = null; }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'storage-watch-bus.js' });
  return {
    bus: sb.window.__ARISE_STORAGE_WATCH_BUS__,
    counts: () => ({ reads, writes }),
    resetReads() { reads = 0; },
    tick() { scheduled.fn(); },
    isTicking() { return !!scheduled; },
    tickMs() { return scheduled && scheduled.ms; },
    set(k, v) { store[k] = v; },
    del(k) { delete store[k]; },
    hide() { document.hidden = true; (listeners.visibilitychange || []).forEach(f => f()); },
    show() { document.hidden = false; (listeners.visibilitychange || []).forEach(f => f()); }
  };
}

// ── 1 + 2: dedupe the read, keep the fan-out ─────────────────────────────────
{
  const h = makeBus();
  const seen = { a: [], b: [], c: [] };
  h.bus.watch('focusSessionsV2', v => seen.a.push(v));
  h.bus.watch('focusSessionsV2', v => seen.b.push(v));
  h.bus.watch('focusSessionsV2', v => seen.c.push(v));
  h.bus.watch('devTasks', () => {});

  h.resetReads(); h.tick();
  ok(h.counts().reads === 2, `tick reads each distinct key once (2 keys -> 2 getItem calls, got ${h.counts().reads})`);

  h.set('focusSessionsV2', '[1,2,3]');
  h.resetReads(); h.tick();
  ok(h.counts().reads === 2, 'a changed value does not add extra reads for the extra watchers');
  ok(seen.a.length === 1 && seen.b.length === 1 && seen.c.length === 1,
    'all three subscribers on the shared key fire exactly once');
  ok(seen.a[0] === '[1,2,3]' && seen.c[0] === '[1,2,3]', 'each gets the raw stored string');

  // production shape: 25 subscriptions over 17 keys
  const h2 = makeBus();
  const keys = {};
  const counts = { hackathonPipelineV1: 3, focusSessionsV2: 3, 'cse-syllabus-progress-v1': 2, devTasks: 2, studySessions: 2, hackathonTrackerV1: 2 };
  for (const k in counts) for (let i = 0; i < counts[k]; i++) { h2.bus.watch(k, () => {}); keys[k] = (keys[k] || 0) + 1; }
  for (const k of ['projects', 'dsaQuestions', 'arise-expenses-v1']) h2.bus.watch(k, () => {});
  h2.resetReads(); h2.tick();
  const subs = Object.values(keys).reduce((a, b) => a + b, 0) + 3;
  const distinct = Object.keys(keys).length + 3;
  ok(h2.counts().reads === distinct,
    `${subs}-subscription shape (like today's app) costs ${distinct} reads/tick, not ${subs}`);
}

// ── 3: interval stops when the last watcher goes away ────────────────────────
{
  const h = makeBus();
  const un1 = h.bus.watch('someKey', () => {});
  const un2 = h.bus.watch('otherKey', () => {});
  ok(h.isTicking() && h.tickMs() === 1200, 'two watchers still share one 1200 ms timer');
  un1();
  ok(h.isTicking(), 'unwatching one of two keeps the timer (otherKey still watched)');
  un2();
  ok(!h.isTicking(), 'unwatching the last subscriber clears the interval (no empty timer)');
  const un3 = h.bus.watch('again', () => {});
  ok(h.isTicking(), 'watch() restarts the timer after everything was unsubscribed');
  un3();
}

// ── 4: unwatch must prune the CURRENT entry, not a captured stale one ────────
{
  const h = makeBus();
  const seen = [];
  const un1 = h.bus.watch('k', v => seen.push('first:' + v));
  h.bus.watch('k', v => seen.push('second:' + v));
  un1();                        // drops the last sub -> entry deleted
  h.bus.watch('k', () => {});   // creates a FRESH entry object for the same key
  const before = seen.length;
  h.set('k', 'V');
  h.tick();
  ok(seen.length === before + 1 && seen[before] === 'second:V',
    'after re-watching, the surviving subscriber still fires (unwatch did not orphan a stale entry)');
  ok(seen.filter(s => s.startsWith('first:')).length === 0, 'the unsubscribed watcher never fires again');
}

// ── 5: isolation, and the hidden/visible pause still works ───────────────────
{
  const h = makeBus();
  const got = [];
  h.bus.watch('boom', () => { throw new Error('boom'); });
  h.bus.watch('safe', v => got.push(v));
  h.set('boom', 'x'); h.set('safe', 'y');
  let threw = false;
  try { h.tick(); } catch (e) { threw = true; }
  ok(!threw && got.length === 1 && got[0] === 'y', 'a throwing watcher neither breaks the tick nor starves its neighbours');

  h.hide();
  ok(!h.isTicking(), 'hidden tab: timer cleared');
  h.set('safe', 'z');
  ok(got.length === 1, 'no callbacks run while hidden');
  h.show();
  ok(h.isTicking(), 'visible again: timer restarts');
  h.tick();
  ok(got.length === 2 && got[1] === 'z', 'the change made while hidden is delivered on the first visible tick');
}

// ── bad signatures stay no-ops ───────────────────────────────────────────────
{
  const h = makeBus();
  let threw = false;
  try { h.bus.watch(123, () => {}); h.bus.watch('k', null); h.bus.watch(undefined, undefined); }
  catch (e) { threw = true; }
  ok(!threw && !h.isTicking(), 'bad watch() signatures are ignored and do not start the timer');
  ok(typeof h.bus.stats === 'function' && h.bus.stats().keys === 0, 'stats() reports an empty bus');
}

console.log((fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
