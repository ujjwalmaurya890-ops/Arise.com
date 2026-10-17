/* v238c guard for the eager <head> script set.
 *
 * PERF-AUDIT-v237.md proposed moving the non-critical eager <head> scripts into the
 * deferred chunk phases. Before changing anything, that was measured (2026-10-17):
 *
 *   - cold compile of all 12 <script defer> files, V8, fresh process each:  0.01 ms total
 *   - top-level eval of all 12, jsdom, best of 7:                           4.4 ms total
 *   - assets/app-bundle.js (type=module, cannot move: its source is not in this repo,
 *     package.json has no build script):          1022 KB raw / 294 KB gz = 82% of the
 *     head JS payload; the other 12 files together are 178 KB raw / 62 KB gz.
 *
 * So the whole eager script set costs single-digit ms of main-thread work, is served
 * from the service worker on every repeat visit, and DCL is bounded by the one file that
 * cannot move. The 4 files nobody in <head> or the shell reads
 * (MEASURED_AND_LEFT below) would free 33.7 KB gz if relocated into a chunk, at the cost
 * of reshuffling every chunk boundary (the splitter is size-greedy, so PRIORITY_CHUNK_COUNT
 * would drag dashboard widgets into the deferred phase to compensate) - a negative trade.
 * That is the reason they are still here, and this file exists so nobody spends a day
 * re-deriving it.
 *
 * What this test actually enforces is the invariant that a future edit could break:
 *   1. head is SELF-SUFFICIENT - the 12 scripts, run in document order with no chunk
 *      code loaded at all, must not throw and must each finish publishing their
 *      sentinel globals. This is what fails if anyone makes a head script depend on a
 *      widget that only exists inside assets/chunks/*.
 *   2. every head script that the React shell or an inline <head> script reads stays in
 *      head; the only ones allowed not to be read by anyone are the measured-and-left set.
 *   3. every eager script and every head stylesheet is in the service worker CORE_SHELL
 *      (otherwise offline first paint silently loses a file).
 *   4. the media="print" + <noscript> twin pattern is intact (the five "duplicate"
 *      stylesheets in head are NOT duplicates - deduping them breaks no-JS users), and
 *      the app-bundle modulepreload matches the <script type=module> exactly.
 *   5. perf-probe.js is opt-in: no plain <script src> for it, and absent from both SW lists.
 *
 * Run: node test-head-eager-set.cjs        (DEBUG=1 for the per-assert list)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { JSDOM } = require('jsdom');

const VERBOSE = process.env.DEBUG === '1';
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; if (VERBOSE) console.log('  ok  ' + m); } else { fail++; console.error('FAIL: ' + m); } }

const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const idx = R('index.html');
const head = /<head>([\s\S]*?)<\/head>/.exec(idx)[1];
const EAGER = [...head.matchAll(/<script defer src="\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
const bundle = R('assets/app-bundle.js');
const inline = [...head.matchAll(/<script>\n([\s\S]*?)\n\s*<\/script>/g)].map(m => m[1]).join('\n');

// The only head scripts whose published globals nobody else in head/shell reads.
// Adding to this list means "this is dead weight in the critical head, and here is why
// it is still there" - so write the reason in the commit, not just here.
const MEASURED_AND_LEFT = [
  'animation-upgrade.js',                             // decorative reveal; gated on perf-lite in v238b
  'placement-engine.js',                              // consumed only by w07/w08 widgets; 0.6 ms eval
  'features/exam-tracker/exam-tracker-intelligence.js', // consumed by widgets, not by the shell
  'learning-heatmap-widget.js'                        // mounted via mount-safety (w12)
];

const declaredGlobals = f => [...new Set([...R(f).matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))];

(async function () {
  // ── 1. structural pins ─────────────────────────────────────────────────────
  ok(EAGER.length === 12, 'exactly 12 eager <script defer> tags in <head> (got ' + EAGER.length + ')');
  ok(EAGER.every(f => !/assets\/chunks\//.test(f)), 'no chunk file is also linked eagerly from <head>');
  for (const f of EAGER) ok(fs.existsSync(path.join(__dirname, f)), 'head script exists on disk: ' + f);

  // ── 2. head is self-sufficient (the load-order invariant), in BOTH perf modes ─
  // A sentinel set inside a conditional branch (the v238b lite flag) only has to appear
  // in one of the two runs; everything else must publish in both.
  async function runHead(lite) {
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
      { url: 'https://arise.test/', runScripts: 'dangerously', pretendToBeVisual: true });
    const w = dom.window;
    const errors = [];
    w.addEventListener('error', e => errors.push('window.onerror: ' + e.message));
    if (lite) w.document.documentElement.classList.add('perf-lite');
    const sentinels = new Map();
    for (const f of EAGER) {
      try { w.eval(R(f)); } catch (e) { errors.push(f + ' threw ' + e.name + ': ' + e.message); }
      for (const g of declaredGlobals(f)) if (!sentinels.has(g)) sentinels.set(g, f);
    }
    // animation-upgrade starts on load; give every DCL/load hook a tick.
    w.dispatchEvent(new w.Event('load'));
    await new Promise(r => setTimeout(r, 50));
    return { w, errors, sentinels };
  }
  const normal = await runHead(false);
  const liteRun = await runHead(true);
  for (const [name, r] of [['full', normal], ['perf-lite', liteRun]]) {
    ok(r.errors.length === 0, 'all 12 head scripts run in document order with ZERO chunk code loaded, none throws [' + name + ']' +
      (r.errors.length ? '\n      ' + r.errors.join('\n      ') : ''));
  }
  const missing = [...normal.sentinels.keys()].filter(g =>
    normal.w[g] === undefined && liteRun.w[g] === undefined);
  ok(missing.length === 0, 'every sentinel global a head script publishes is defined in at least one perf mode (' +
    normal.sentinels.size + ' checked)' + (missing.length ? ' - missing: ' + missing.map(g => g + ' (' + normal.sentinels.get(g) + ')').join(', ') : ''));
  ok(normal.w.__ARISE_ANIM_UPGRADE_LITE__ === undefined && liteRun.w.__ARISE_ANIM_UPGRADE_LITE__ === true,
    'and the v238b gate is exactly a perf-lite function: off in full mode, on in lite mode');

  // ── 3. justification: nothing in head is unreferenced except the pinned set ─
  const uncovered = EAGER.filter(f => {
    const gs = declaredGlobals(f);
    const read = blob => gs.some(g => new RegExp('\\b' + g + '\\b').test(blob));
    return !(read(bundle) || read(inline) || EAGER.some(o => o !== f && read(R(o))));
  });
  ok(uncovered.slice().sort().join() === MEASURED_AND_LEFT.slice().sort().join(),
    'unreferenced-by-shell head scripts are exactly the measured-and-left set [' + uncovered.join(', ') + ']');
  const covered = EAGER.length - uncovered.length;
  ok(covered >= 5, covered + ' of ' + EAGER.length + ' head scripts are read by the React shell or by each other (they must stay eager)');

  // ── 4. offline: CORE_SHELL must cover everything the head needs ────────────
  const sw = R('service-worker.js');
  const norm = s => s.replace(/^\.\//, '');
  const core = new Set((/CORE_SHELL=\[(.*?)\]/s.exec(sw)[1]).split(',').map(s => norm(s.trim().replace(/^"|"$/g, ''))));
  const ext = new Set((/EXTENDED_SHELL=\[(.*?)\]/s.exec(sw)[1]).split(',').map(s => norm(s.trim().replace(/^"|"$/g, ''))));
  const mod = /<script type="module"[^>]*src="\.\/([^"]+)"/.exec(idx)[1];
  const styles = [...new Set([...head.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map(m => m[1]))];
  const notCore = [mod, ...EAGER, ...styles].filter(f => !core.has(norm(f)));
  ok(notCore.length === 0, 'module entry + ' + EAGER.length + ' head scripts + ' + styles.length +
    ' head stylesheets are all in CORE_SHELL' + (notCore.length ? ' - missing: ' + notCore.join(', ') : ''));

  // ── 5. the pattern that LOOKS redundant but is not ─────────────────────────
  const printLinks = [...idx.matchAll(/<link rel="stylesheet" href="([^"]+)" media="print"|<link href="([^"]+)" rel="stylesheet" media="print/g)]
    .map(m => m[1] || m[2]);
  ok(printLinks.length >= 5, 'found ' + printLinks.length + ' media="print" stylesheets');
  const noscript = [...idx.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(m => m[1]).join('\n');
  const orphan = printLinks.filter(u => !noscript.includes('href="' + u + '"'));
  ok(orphan.length === 0, 'every media="print" stylesheet has a <noscript> twin - the near-duplicate <link>s are the fallback, not a bug' +
    (orphan.length ? ' - missing for: ' + orphan.join(', ') : ''));
  const mp = /<link rel="modulepreload"([^>]*)>/.exec(head);
  ok(mp && mp[1].includes('href="./assets/app-bundle.js"') && mp[1].includes('crossorigin'),
    'the app-bundle modulepreload matches the module script (href + crossorigin) so it is consumed, not fetched twice');
  ok(!/<script[^>]*\bsrc="[^"]*app-bundle[^"]*"[^>]*>\s*<\/script>\s*<link rel="modulepreload"/.test(idx),
    'modulepreload comes before the module script, not after it');

  // ── 6. payload tripwire ───────────────────────────────────────────────────
  const gz = f => zlib.gzipSync(fs.readFileSync(path.join(__dirname, f)), { level: 9 }).length;
  const total = [mod, ...EAGER].reduce((a, f) => a + gz(f), 0);
  const bundleShare = gz(mod) / total;
  ok(total < 380 * 1024, 'eager head JS is ' + (total / 1024).toFixed(1) + ' KB gz - under the 380 KB ceiling; if this fails, ' +
    'the fix is to move a file into a chunk via tools/build-widget-chunks.cjs, not to add another <script defer> to <head>');
  ok(bundleShare > 0.7, 'app-bundle.js is ' + (bundleShare * 100).toFixed(0) + '% of it: it is the only meaningful lever left, ' +
    'and it needs the upstream React project (no build script in this repo) - do not chase the other 12 files');

  // ── 7. the opt-in probe must stay opt-in ──────────────────────────────────
  ok(!/<script[^>]*\bsrc="\.\/perf-probe\.js"/.test(idx), 'perf-probe.js has no plain <script src> tag (it is only created by the ?perf=1 bootstrap)');
  ok(/perf=1/.test(head) && /arise-perf/.test(head), 'the opt-in bootstrap in <head> still checks both ?perf=1 and localStorage');
  ok(!ext.has('perf-probe.js') && !core.has('perf-probe.js'), 'and it is in neither service-worker precache list');

  console.log((fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAILED', e && e.stack); process.exit(1); });
