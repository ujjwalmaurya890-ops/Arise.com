/* v238 perf guard: the lazy widget loader now runs in two ordered phases
 * (CHUNK_PRIORITY first, then the rest) instead of walking all 12 chunks back to
 * back. This test extracts the real loader source out of index.html and runs it in
 * a tiny deterministic sandbox with every browser API stubbed, asserting:
 *   1. phase 1 loads exactly CHUNK_PRIORITY, which must be a prefix of CHUNKS;
 *   2. window.__ariseWidgetsReady does NOT flip after phase 1, so early mount stubs
 *      keep queueing and nothing that waits on "all widgets up" fires early;
 *   3. phase 2 starts on the idle timer when nobody interacts, and the full
 *      execution order still equals the original CHUNKS order;
 *   4. an interaction (pointerdown) cuts the idle wait short;
 *   5. ?chunkPriority=0 (and the localStorage twin) reproduce pre-v238 single-phase;
 *   6. CHUNK_PRIORITY = [] behaves exactly as before v238;
 *   7. the un-chunked SCRIPTS fallback path ignores CHUNK_PRIORITY entirely.
 * Run: node _run-test.cjs test-chunk-priority-loader.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } }

const idx = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loaderSrc = idx.match(/<script id="arise-lazy-widget-loader">\n([\s\S]*?)\n  <\/script>/)[1];
const CHUNKS = JSON.parse(idx.match(/var CHUNKS = (\[[\s\S]*?\]);/)[1]);
const PRIORITY = JSON.parse((idx.match(/var CHUNK_PRIORITY = (\[[^\]]*\]);/) || [, '[]'])[1]);
const SCRIPTS = [...idx.match(/var SCRIPTS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.js)'/g)].map(m => m[1]);
const IDLE_MS = Number((loaderSrc.match(/var DEFERRED_IDLE_MS = (\d+);/) || [, '4000'])[1]);

// The generated chunk data block is swapped for a harness-supplied one so each
// scenario can drive the chunk list without touching the shipped index.html.
const body = loaderSrc.replace(/\/\*CHUNKS:START\*\/[\s\S]*?\/\*CHUNKS:END\*\//, '__DATA__');
const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*\bid="arise-lazy-widget-loader">[\s\S]*$/;
void SCRIPT_RE;

function run(opts) {
  opts = opts || {};
  const st = { executed: [], css: [], prewarmed: [], events: [] };
  const timers = [];
  let now = 0, seq = 0;
  function setTimeoutStub(fn, ms) { const t = { at: now + (ms || 0), id: ++seq, fn }; timers.push(t); return t.id; }
  function clearTimeoutStub(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); }
  // The loader's prewarm() chains .then() onto the fetch stub, and those
  // microtasks can schedule further timers. A fake clock has to drain them
  // between timer firings or it diverges from a real event loop (that is a
  // harness artefact, not a product bug — prewarm(deferred) legitimately runs
  // after the first fetch promise resolves).
  function drainMicrotasks() { return new Promise(r => setTimeout(r, 0)); }
  async function advance(ms) {
    const target = now + ms;
    for (;;) {
      await drainMicrotasks();
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers.find(x => x.at <= target);
      if (!t) break;
      timers.splice(timers.indexOf(t), 1);
      now = t.at; t.fn();
    }
    now = target;
    await drainMicrotasks();
  }
  const store = new Map(Object.entries(opts.localStorage || {}));
  const listeners = {};
  const doc = {
    readyState: opts.readyState || 'loading',
    hidden: false,
    documentElement: {},
    createElement: tag => ({ tagName: String(tag).toUpperCase() }),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: (t, f) => { (listeners['doc:' + t] = listeners['doc:' + t] || []).push(f); },
    dispatchEvent: e => { st.events.push(e && e.type); return true; },
    head: { appendChild: n => { if (n && n.tagName === 'LINK') st.css.push(n.href); return n; } },
    body: {
      appendChild: n => {
        if (n && n.tagName === 'SCRIPT') {
          st.executed.push(n.src);
          if (typeof n.onload === 'function') n.onload();      // synchronous, always succeeds
        }
        return n;
      }
    }
  };
  const win = {
    document: doc,
    location: { search: opts.search || '' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    performance: { now: () => now },
    navigator: { serviceWorker: { controller: { postMessage: m => st.events.push('sw:' + m.type) } } },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    dispatchEvent: e => { (listeners[e.type] || []).forEach(f => { try { f(e) } catch (x) {} }); st.events.push(e.type); return true; },
    setTimeout: setTimeoutStub, clearTimeout: clearTimeoutStub,
    requestAnimationFrame: f => setTimeoutStub(f, 16),
    fetch: u => { st.prewarmed.push(String(u)); return Promise.resolve({ arrayBuffer: () => Promise.resolve({}) }); },
    Event: function (type) { this.type = type; },
    console: { warn: () => {}, error: () => {}, log: () => {} }
  };
  win.window = win; win.self = win; win.globalThis = win;
  if (!opts.idle) win.requestIdleCallback = undefined;
  else win.requestIdleCallback = f => setTimeoutStub(() => f({ timeRemaining: () => 20 }), 1);
  const data = 'var CHUNKS = ' + JSON.stringify(opts.chunks) + ';\n    ' +
    'var CHUNK_FILES = {};\n    ' +
    'var CHUNK_PRIORITY = ' + JSON.stringify(opts.priority) + ';';
  win.__dbg = { onDoneFired: 0, finishReached: 0 };
  let src = body.replace('__DATA__', data);
  if (opts.instrument) {
    src = src.replace('      function finish() {', '      function finish() { window.__dbg.finishReached++;');
    src = src.replace('        priorityDone = true;', '        priorityDone = true; window.__dbg.onDoneFired++;');
    src = src.replace('      function startDeferred() {', '      function startDeferred() { window.__dbg.deferredCall = (window.__dbg.deferredCall || 0) + 1;');
  }
  const ctx = vm.createContext(win);
  vm.runInContext(src, ctx, { filename: 'arise-lazy-widget-loader' });

  return Object.assign(st, {
    w: win, win, timers, advance,
    fireLoad() { (listeners['load'] || []).forEach(f => f()); },
    pointerdown() { (listeners['pointerdown'] || []).forEach(f => f()); },
    pending() { return timers.length; }
  });
}

(async function scenarios() {
// ── scenarios ────────────────────────────────────────────────────────────────
let t = run({ chunks: CHUNKS, priority: PRIORITY, instrument: true });
t.fireLoad(); await t.advance(60);
ok(t.executed.length === PRIORITY.length,
  'phase 1 loads exactly the ' + PRIORITY.length + ' priority chunks, not all ' + CHUNKS.length + ' (got ' + t.executed.length + ')');
ok(JSON.stringify(t.executed) === JSON.stringify(PRIORITY), 'phase 1 order == CHUNK_PRIORITY');
ok(t.win.__ariseWidgetsReady !== true, '__ariseWidgetsReady stays false after phase 1 (early mounts keep queueing)');
ok(!t.events.some(e => e === 'arise:widgets-ready'), 'no arise:widgets-ready event before the full set is in');
ok(t.win.__ariseChunkSplit && t.win.__ariseChunkSplit.deferred === CHUNKS.length - PRIORITY.length,
  'loader reports ' + (t.win.__ariseChunkSplit && t.win.__ariseChunkSplit.deferred) + ' deferred chunks');
ok(t.css.length === 5, 'all 5 widget stylesheets are still injected up front (unchanged)');

// +5.2 s more: finish() asks the SW to warm its cache 5 s after the FINAL phase
  // only, exactly as before v238 (the priority phase must not trigger it).
  await t.advance(IDLE_MS + 5200);
  ok(t.executed.length === CHUNKS.length, 'phase 2 starts on the idle timer and loads the remaining ' + (CHUNKS.length - PRIORITY.length) + ' chunks');
ok(JSON.stringify(t.executed) === JSON.stringify(CHUNKS), 'combined execution order is still exactly CHUNKS (nothing reordered)');
ok(t.win.__ariseWidgetsReady === true, '__ariseWidgetsReady flips only after the full set has executed');
ok(t.events.indexOf('arise:widgets-ready') !== -1, 'arise:widgets-ready fires once, at the end');
ok(t.events.indexOf('sw:arise-fill-cache') !== -1, 'the SW cache fill is still requested after the last phase');

t = run({ chunks: CHUNKS, priority: PRIORITY });
t.fireLoad(); await t.advance(60); t.pointerdown(); await t.advance(50);
ok(t.executed.length === CHUNKS.length, 'a pointerdown after phase 1 loads the deferred chunks immediately (no 4 s wait)');

t = run({ chunks: CHUNKS, priority: PRIORITY, search: '?chunkPriority=0' });
t.fireLoad(); await t.advance(IDLE_MS + 200);
ok(t.executed.length === CHUNKS.length, '?chunkPriority=0 disables the split (single phase, as before v238)');
ok(JSON.stringify(t.executed) === JSON.stringify(CHUNKS), '?chunkPriority=0 keeps the exact original order');

t = run({ chunks: CHUNKS, priority: PRIORITY, localStorage: { 'arise-chunk-priority': 'off' } });
t.fireLoad(); await t.advance(120);   // startLazyLoad itself runs 50 ms after load
ok(t.executed.length > PRIORITY.length, "localStorage arise-chunk-priority=off also disables the split (loaded " + t.executed.length + " in phase 1)");

t = run({ chunks: CHUNKS, priority: [] });
t.fireLoad(); await t.advance(IDLE_MS + 200);
ok(JSON.stringify(t.executed) === JSON.stringify(CHUNKS) && t.win.__ariseWidgetsReady === true,
  'CHUNK_PRIORITY = [] behaves exactly as before v238');

t = run({ chunks: [], priority: PRIORITY });
t.fireLoad(); await t.advance(IDLE_MS + 200);
ok(t.executed.length === SCRIPTS.length && t.executed.every(u => u.indexOf('/chunks/') === -1),
  'the un-chunked SCRIPTS fallback ignores CHUNK_PRIORITY and still loads all ' + SCRIPTS.length + ' files');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
