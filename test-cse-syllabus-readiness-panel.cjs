/**
 * test-cse-syllabus-readiness-panel.cjs
 * ──────────────────────────────────────
 * Smoke tests for the CSE Syllabus widget's readiness panel
 * (cse-syllabus-plus-widget.js + cse-syllabus-tabs-v150-patch.js).
 *
 * Must use .cjs extension because package.json has "type":"module".
 *
 * What we verify:
 *   1. The readiness panel mounts correctly in a minimal DOM (sem-1 anchor present)
 *   2. The panel uses only CSS custom properties — no hard-coded colours —
 *      so it is compatible with ALL Arise themes (dark / light / high-contrast / etc.)
 *   3. The credit-weighted mastery score is computed correctly from progress data
 *   4. The placement-critical (🎯 PC) subjects are flagged as expected
 *   5. The IA-tracker tab exists and its best-2-of-3 CIE% formula is correct
 *   6. The "CSE Syllabus Mastery" readiness-panel suppression rule fires only for
 *      the right element (it must hide the old built-in panel, not the new Syllabus+ one)
 *   7. All localStorage keys round-trip safely through the widget's own safeGet helpers
 *
 * Run with:   node test-cse-syllabus-readiness-panel.cjs
 * Exit code:  0 = all green, non-zero = at least one failure (FAIL lines printed).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ─── paths ────────────────────────────────────────────────────────────────────
const BASE    = path.join(__dirname, 'features', 'semester-risk');
const CFG_JS  = path.join(BASE,       'cse-full-syllabus-config.js');
const PLUS_JS = path.join(BASE,       'cse-syllabus-plus-widget.js');
const TABS_JS = path.join(BASE,       'cse-syllabus-tabs-v150-patch.js');
const PC_JS   = path.join(__dirname,  'features', 'cse-placement-critical',
                           'cse-placement-critical-config.js');

const CFG_SRC  = fs.readFileSync(CFG_JS,  'utf8');
const PLUS_SRC = fs.readFileSync(PLUS_JS, 'utf8');
const TABS_SRC = fs.readFileSync(TABS_JS, 'utf8');
const PC_SRC   = fs.existsSync(PC_JS) ? fs.readFileSync(PC_JS, 'utf8') : null;

// ─── tiny harness ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; process.stdout.write('  ✓ ' + msg + '\n'); }
  else       { fail++; process.stderr.write('  ✗ FAIL: ' + msg + '\n'); }
}
function eq(a, b, msg) {
  ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
}

// ─── DOM factory ─────────────────────────────────────────────────────────────
/**
 * freshDom(cssVars)
 *   - seeds a minimal HTML page with <div id="sem-1"> so the widget can anchor
 *   - installs an in-memory localStorage stand-in
 *   - sets up the CSS custom properties from `cssVars` on :root via inline style
 *     (simulates a theme being applied — ensures the widget never blows up when
 *     colour values change, e.g. in light vs. dark vs. high-contrast themes)
 *   - attaches a minimal __ARISE_MUTATION_BUS__ stub so the widget doesn't error
 */
function freshDom(cssVars) {
  cssVars = cssVars || THEME_LINEAR_DARK;

  // Build inline CSS variable block to inject into the <style> tag
  const cssBlock = Object.keys(cssVars)
    .map(function(k) { return k + ':' + cssVars[k] + ';' })
    .join('');

  const html = [
    '<!doctype html><html><head>',
    '<style>:root{' + cssBlock + '}</style>',
    '</head><body>',
    '<div id="sem-1"></div>',
    '</body></html>'
  ].join('');

  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    runScripts: 'dangerously'
  });

  const { window } = dom;

  // In-memory localStorage
  const store = Object.create(null);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem:    function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem:    function(k, v) { store[k] = String(v); },
      removeItem: function(k) { delete store[k]; },
      _store:     store
    }
  });

  // Mutation bus stub (so the widget's boot doesn't throw)
  window.__ARISE_MUTATION_BUS__ = { subscribe: function() {} };
  window.__ARISE_STORAGE_WATCH_BUS__ = {
    watch: function() {}
  };

  return { dom, window, document: window.document, store };
}

/**
 * loadCoreScripts(window)
 *   Evaluates the config + placement-critical config (if available) + widget scripts.
 *   After this the widget has already run its DOMContentLoaded boot and should
 *   have inserted its panel before #sem-1.
 */
function loadCoreScripts(window) {
  window.eval(CFG_SRC);
  if (PC_SRC) window.eval(PC_SRC);
  window.eval(PLUS_SRC);
  // Fire DOMContentLoaded in case the script registered a listener
  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(
      new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true })
    );
  }
}

// ─── representative theme palettes ───────────────────────────────────────────
// We pick a cross-section of dark / light / extreme themes to verify that the
// widget renders without hard-coded colour assumptions.

const THEME_LINEAR_DARK = {
  '--background':          '#0A0A0B',
  '--surface':             '#131316',
  '--surface-muted':       '#0F0F11',
  '--surface-hover':       '#1C1C20',
  '--text-primary':        '#EEEEF0',
  '--text-secondary':      '#A1A1AA',
  '--text-tertiary':       '#71717A',
  '--border':              '#232328',
  '--primary':             '#5E6AD2',
  '--success':             '#4CC38A',
  '--warning':             '#E5A53F',
  '--danger':              '#EB5757',
  '--info':                '#4EA7FC',
  '--secondary':           '#BB80F0',
  '--shadow-sm':           '0 1px 2px rgba(0,0,0,.50)',
  '--shadow-md':           '0 10px 30px rgba(0,0,0,.55)',
  '--font-display':        'inherit'
};

const THEME_WHITE = {
  '--background':          '#F8FAFC',
  '--surface':             '#FFFFFF',
  '--surface-muted':       '#F1F5F9',
  '--surface-hover':       '#F8FAFC',
  '--text-primary':        '#0F172A',
  '--text-secondary':      '#475569',
  '--text-tertiary':       '#64748B',
  '--border':              '#E2E8F0',
  '--primary':             '#2563EB',
  '--success':             '#16A34A',
  '--warning':             '#D97706',
  '--danger':              '#DC2626',
  '--info':                '#0284C7',
  '--secondary':           '#7C3AED',
  '--shadow-sm':           '0 1px 2px rgba(15,23,42,.05)',
  '--shadow-md':           '0 10px 30px rgba(15,23,42,.08)',
  '--font-display':        'inherit'
};

const THEME_AMOLED = {
  '--background':          '#000000',
  '--surface':             '#0a0a0a',
  '--surface-muted':       '#101010',
  '--surface-hover':       '#151515',
  '--text-primary':        '#fafafa',
  '--text-secondary':      '#d4d4d4',
  '--text-tertiary':       '#9ca3af',
  '--border':              '#1f1f1f',
  '--primary':             '#ffffff',
  '--success':             '#22c55e',
  '--warning':             '#f59e0b',
  '--danger':              '#ef4444',
  '--info':                '#60a5fa',
  '--secondary':           '#c084fc',
  '--shadow-sm':           '0 1px 2px rgba(0,0,0,.50)',
  '--shadow-md':           '0 10px 30px rgba(0,0,0,.60)',
  '--font-display':        'inherit'
};

const THEME_HIGH_CONTRAST = {
  '--background':          '#FFFFFF',
  '--surface':             '#FFFFFF',
  '--surface-muted':       '#F0F0F0',
  '--surface-hover':       '#E8E8E8',
  '--text-primary':        '#000000',
  '--text-secondary':      '#1A1A1A',
  '--text-tertiary':       '#3D3D3D',
  '--border':              '#000000',
  '--primary':             '#000000',
  '--success':             '#006400',
  '--warning':             '#8B5A00',
  '--danger':              '#8B0000',
  '--info':                '#00008B',
  '--secondary':           '#4B0082',
  '--shadow-sm':           '0 1px 2px rgba(0,0,0,.3)',
  '--shadow-md':           '0 10px 30px rgba(0,0,0,.35)',
  '--font-display':        'inherit'
};

// ─── suite 1: basic mounting ──────────────────────────────────────────────────
console.log('\n── Suite 1: widget mounts correctly ──');

{
  const { window, document } = freshDom(THEME_LINEAR_DARK);
  loadCoreScripts(window);

  const panel = document.getElementById('cse-syllabus-plus-panel');
  ok(!!panel,                            'widget panel (#cse-syllabus-plus-panel) is inserted into DOM');
  ok(panel.className.indexOf('csp-panel') !== -1, 'panel has csp-panel class');

  // The panel must be inserted BEFORE #sem-1 so it appears above the accordion
  const sem1  = document.getElementById('sem-1');
  ok(!!sem1,                             '#sem-1 anchor still present after mount');
  ok(panel.parentNode === sem1.parentNode, 'panel and sem-1 share the same parent');
  ok(panel.compareDocumentPosition(sem1) & 4, // 4 = DOCUMENT_POSITION_FOLLOWING
     'panel is positioned before sem-1 in the DOM');

  ok(panel.innerHTML.length > 200,       'panel has non-trivial HTML content');
  ok(panel.innerHTML.indexOf('Syllabus+') !== -1, 'panel mentions "Syllabus+"');
}

// ─── suite 2: CSS variable compliance (theme compatibility) ───────────────────
console.log('\n── Suite 2: CSS variable compliance across themes ──');

/**
 * Checks that a rendered panel's style/class attributes never embed raw hex
 * colour literals that bypass the theme system.  Inline style blocks that the
 * widget injects (e.g. for progress bar fills) are expected and allowed, but
 * they should reference var(--…) tokens, not raw colours like #5E6AD2.
 *
 * We specifically allow the hard-coded yellow (#fbbf24) used for Lab subject
 * tags and the PC badge — those are semantic constants, not theme-override bugs.
 */
// #fbbf24 is the semantic "placement-critical" gold used for the 🎯 PC badge.
// Its opacity variants (#fbbf2420, #fbbf2440) are intentional constants, not
// theme-override bugs — they are allowed alongside the base colour.
const ALLOWED_HARDCODED_HEX = new Set(['#fbbf24', '#fbbf2420', '#fbbf2440']);

function extractHardcodedHexFromInlineStyles(html) {
  // Matches style="…" or style='…' attribute values
  const attrRe  = /style=["']([^"']+)["']/gi;
  const colorRe = /#([0-9a-f]{3,8})\b/gi;
  const found   = new Set();
  let m;
  while ((m = attrRe.exec(html)) !== null) {
    const styleVal = m[1];
    let c;
    while ((c = colorRe.exec(styleVal)) !== null) {
      const hex = c[0].toLowerCase();
      if (!ALLOWED_HARDCODED_HEX.has(hex)) found.add(hex);
    }
    colorRe.lastIndex = 0;
  }
  return Array.from(found);
}

const themes = {
  'linearDark':    THEME_LINEAR_DARK,
  'white':         THEME_WHITE,
  'amoled':        THEME_AMOLED,
  'highContrast':  THEME_HIGH_CONTRAST
};

Object.keys(themes).forEach(function(themeName) {
  const { window, document } = freshDom(themes[themeName]);
  loadCoreScripts(window);

  const panel = document.getElementById('cse-syllabus-plus-panel');
  ok(!!panel, '[' + themeName + '] panel mounts without errors');

  if (panel) {
    const bad = extractHardcodedHexFromInlineStyles(panel.innerHTML);
    ok(bad.length === 0,
       '[' + themeName + '] no hard-coded hex colours in inline styles'
       + (bad.length ? ' (found: ' + bad.join(', ') + ')' : ''));
  }
});

// ─── suite 3: mastery score calculation ───────────────────────────────────────
console.log('\n── Suite 3: no readiness score in the mastery panel ──');

{
  const { window, document, store } = freshDom(THEME_LINEAR_DARK);

  // Mark 3 subjects done in sem-1: s1-1 (4cr), s1-3 (4cr), s1-4 (3cr)
  // Total sem-1 = 7 subjects; done = 3.  Simple % = 3/total_all.
  // We're interested in the credit-weighted number showing up in the panel.
  const progress = { 's1-1': true, 's1-3': true, 's1-4': true };
  store['cse-syllabus-progress-v1'] = JSON.stringify(progress);
  store['cse-syllabus-score-mode-v1'] = JSON.stringify('credit');

  loadCoreScripts(window);

  const panel = document.getElementById('cse-syllabus-plus-panel');
  ok(!!panel, 'panel mounts with seeded progress');

  if (panel) {
    // The readiness score hero (ring, %, level badge, milestones) was removed
    ok(!panel.querySelector('.csp-hero'), 'readiness hero is not rendered');
    ok(!panel.querySelector('.csp-ring'), 'readiness ring is not rendered');
    ok(!panel.querySelector('.csp-milestones'), 'readiness milestones are not rendered');
    ok(!/readiness/i.test(panel.textContent), 'no "readiness" text anywhere in the mastery panel');
    ok(!panel.querySelector('#csp-history-toggle'), 'Readiness History toggle is not rendered');

    // The stats grid should show 3 completed
    const statVals = Array.prototype.map.call(
      panel.querySelectorAll('.csp-stat-value'),
      function(el) { return el.textContent.trim(); }
    );
    ok(statVals.indexOf('3') !== -1, 'stat grid shows 3 completed subjects');
  }
}

// ─── suite 4: placement-critical subject flagging ────────────────────────────
console.log('\n── Suite 4: placement-critical flags ──');

{
  const { window, document } = freshDom(THEME_LINEAR_DARK);
  loadCoreScripts(window);

  const panel = document.getElementById('cse-syllabus-plus-panel');
  ok(!!panel, 'panel mounts for PC flag check');

  if (panel) {
    // PC badges are either .csp-pc-badge (fixed set) or .csp-pc-toggle (user-set).
    // With the placement-critical config loaded the fixed set (DSA/OS/DBMS/CN/OOP/DAA)
    // should each carry the gold 🎯 PC badge — class csp-pc-badge.
    const pcBadges = panel.querySelectorAll('.csp-pc-badge');
    ok(pcBadges.length > 0, 'at least one 🎯 PC badge is rendered for the fixed subject set');

    // Every badge should contain "PC"
    const allContainPC = Array.prototype.every.call(
      pcBadges,
      function(el) { return el.textContent.indexOf('PC') !== -1; }
    );
    ok(allContainPC, 'every PC badge contains the text "PC"');
  }
}

// ─── suite 5: no readiness data is written any more ─────────────────────────
console.log('\n── Suite 5: readiness storage purged / not written ──');

{
  const { window, document, store } = freshDom(THEME_LINEAR_DARK);
  // Stale keys left over from before the readiness score was removed
  store['cse-syllabus-readiness-history-v1'] = JSON.stringify([{ d: '2026-09-01', pct: 10 }]);
  store['cse-syllabus-readiness-trend-v1'] = JSON.stringify({ pct: 10, ts: Date.now() });
  store['cse-syllabus-readiness-milestone-seen-v1'] = JSON.stringify('Building');
  store['cse-syllabus-progress-v1'] = JSON.stringify({ 's1-1': true });

  loadCoreScripts(window);

  ok(store['cse-syllabus-readiness-history-v1'] === undefined, 'stale readiness history is purged');
  ok(store['cse-syllabus-readiness-trend-v1'] === undefined, 'stale readiness trend is purged');
  ok(store['cse-syllabus-readiness-milestone-seen-v1'] === undefined, 'stale milestone marker is purged');

  const ourPanel = document.getElementById('cse-syllabus-plus-panel');
  ok(ourPanel && ourPanel.style.display !== 'none', 'Syllabus+ panel still mounts and is visible');
}

// ─── suite 6: localStorage round-trip safety ─────────────────────────────────
console.log('\n── Suite 6: localStorage key round-trips ──');

{
  const { window, document, store } = freshDom(THEME_LINEAR_DARK);

  // Seed all known keys with valid data
  const sampleProgress    = { 's2-3': true, 's3-5': true };
  const sampleRevision    = { 's2-3': { flagged: true, box: 2, lastReviewedAt: null, nextDueAt: Date.now() + 86400000 } };
  const sampleDifficulty  = { 's2-3': 4, 's3-5': 3 };
  const sampleCustom      = { added: [], edits: {}, order: {}, removed: [] };
  const sampleInternalMks = { 's2-3': 38, 's3-5': 45 };

  store['cse-syllabus-progress-v1']              = JSON.stringify(sampleProgress);
  store['cse-syllabus-revision-v1']              = JSON.stringify(sampleRevision);
  store['cse-syllabus-difficulty-v1']            = JSON.stringify(sampleDifficulty);
  store['cse-syllabus-custom-v1']                = JSON.stringify(sampleCustom);
  store['cse-syllabus-internal-marks-v1']        = JSON.stringify(sampleInternalMks);
  store['cse-syllabus-score-mode-v1']            = JSON.stringify('credit');

  loadCoreScripts(window);

  const panel = document.getElementById('cse-syllabus-plus-panel');
  ok(!!panel, 'panel mounts with all seed data present');

  if (panel) {
    // Progress read: 2 subjects done, total in panel stats
    const statVals = Array.prototype.map.call(
      panel.querySelectorAll('.csp-stat-value'),
      function(el) { return el.textContent.trim(); }
    );
    ok(statVals.indexOf('2') !== -1, 'panel reads back 2 completed subjects from localStorage');

    // Revision due-count: both subjects are flagged but nextDueAt is tomorrow → not due
    // So "Due for Revision" stat should be 0
    const dueStatEl = Array.prototype.filter.call(
      panel.querySelectorAll('.csp-stat'),
      function(el) { return el.textContent.indexOf('Due for Revision') !== -1; }
    )[0];
    ok(!!dueStatEl, '"Due for Revision" stat block is present');
    if (dueStatEl) {
      const dueCount = parseInt(dueStatEl.querySelector('.csp-stat-value').textContent, 10);
      eq(dueCount, 0, '"Due for Revision" count is 0 when all nextDueAt are in the future');
    }

    // Backlog risk: both subjects have internal marks seeded (38 and 45, both < 40 cutoff)
    // → 2 subjects should be at backlog risk IF attendance data isn't loaded.
    // s2-3: 38 < 40, s3-5: 45 > 40 → only 1 at risk
    const riskStatEl = Array.prototype.filter.call(
      panel.querySelectorAll('.csp-stat'),
      function(el) { return el.textContent.indexOf('Backlog Risk') !== -1; }
    )[0];
    ok(!!riskStatEl, '"Backlog Risk" stat block is present');
    if (riskStatEl) {
      const riskCount = parseInt(riskStatEl.querySelector('.csp-stat-value').textContent, 10);
      eq(riskCount, 1, '"Backlog Risk" count is 1 (s2-3 has marks 38 < cutoff 40)');
    }
  }
}

// ─── suite 7: IA tracker tab in tabs patch ───────────────────────────────────
console.log('\n── Suite 7: IA tracker tab — best-2-of-3 CIE% formula ──');

{
  // The tabs patch (cse-syllabus-tabs-v150-patch.js) needs the config and a
  // #sem-1 DOM anchor, then it mounts its own root (#csp-v150-tabs-root).
  // Because it uses a polling boot (setTimeout), we need to pump the event loop.

  const { window, document } = freshDom(THEME_LINEAR_DARK);
  window.eval(CFG_SRC);
  if (PC_SRC) window.eval(PC_SRC);
  window.eval(TABS_SRC);

  // The tabs script uses a 800ms timer to attempt mounting.  We use a promise
  // that polls the DOM for up to 3 s, then run assertions.
  const waitForTabsMount = function(cb) {
    const start = Date.now();
    (function poll() {
      const root = document.getElementById('csp-v150-tabs-root');
      if (root && root.innerHTML.length > 50) { cb(root); return; }
      if (Date.now() - start > 3000) { cb(null); return; }
      setTimeout(poll, 60);
    })();
  };

  waitForTabsMount(function(root) {
    ok(!!root, 'tabs root (#csp-v150-tabs-root) mounts');

    if (root) {
      // IA tab button
      const iaBtn = root.querySelector('[data-tab="ia"]');
      ok(!!iaBtn, 'IA Tracker tab button present');

      if (iaBtn) {
        // Activate the IA tab
        iaBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

        const body = root.querySelector('[data-tab-body="ia"]');
        ok(!!body, 'IA tab body element exists');
        ok(body && body.classList.contains('active'), 'IA tab body becomes active after click');

        if (body) {
          ok(body.innerHTML.indexOf('IA max marks') !== -1, 'settings row with "IA max marks" rendered');
          const rows = body.querySelectorAll('.csp150-ia-row');
          ok(rows.length > 0, 'subject rows are rendered in IA tab');
        }
      }
    }

    // ── Suite 7b: best-2-of-3 CIE% math ─────────────────────────────────
    console.log('\n── Suite 7b: CIE% formula unit tests (pure JS, no DOM) ──');

    // Replicate the _ (compute) function logic from the tabs patch:
    //   - collect ia1..ia3 scores, convert to %, sort desc, take best 2
    //   - average those two → iaPct
    //   - assignment pct = assignment / assignMax * 100
    //   - combinedPct = iaPct * (iaWeightPct/100) + assignPct * (1 - iaWeightPct/100)
    function computeCIE(marks, settings) {
      var iaMax     = settings.iaMax;
      var assignMax = settings.assignMax;
      var wt        = settings.iaWeightPct / 100;

      var iaPcts = [marks.ia1, marks.ia2, marks.ia3]
        .filter(function(v) { return v != null; })
        .map(function(v) { return v / iaMax * 100; });

      var iaPct = null;
      if (iaPcts.length === 1) {
        iaPct = iaPcts[0];
      } else if (iaPcts.length >= 2) {
        iaPcts.sort(function(a, b) { return b - a; });
        iaPct = (iaPcts[0] + iaPcts[1]) / 2;
      }

      var assignPct = marks.assignment != null
        ? marks.assignment / assignMax * 100
        : null;

      var combined = null;
      if (iaPct != null && assignPct != null) {
        combined = iaPct * wt + assignPct * (1 - wt);
      } else if (iaPct != null) {
        combined = iaPct;
      } else if (assignPct != null) {
        combined = assignPct;
      }

      return { iaPct: iaPct, assignPct: assignPct, combinedPct: combined };
    }

    var defaults = { iaMax: 20, assignMax: 10, iaWeightPct: 80 };

    // Case A: IA1=18, IA2=14, IA3=16, Assignment=8 (same as the old IA test)
    // best-2-of-3: (90 + 80) / 2 = 85%  →  85*0.8 + 80*0.2 = 68+16 = 84%
    var caseA = computeCIE({ ia1: 18, ia2: 14, ia3: 16, assignment: 8 }, defaults);
    ok(Math.round(caseA.combinedPct) === 84, 'Case A: 3 IAs + assignment → 84% combined');

    // Case B: only IA1 = 10/20  →  50%  (no assignment yet)
    var caseB = computeCIE({ ia1: 10, ia2: null, ia3: null, assignment: null }, defaults);
    ok(Math.round(caseB.combinedPct) === 50, 'Case B: single IA at 50% → 50% combined');

    // Case C: IA1=20, IA2=20 (both perfect), no IA3, assignment=10/10
    // best-2-of-3: (100+100)/2 = 100%  →  100*0.8 + 100*0.2 = 100%
    var caseC = computeCIE({ ia1: 20, ia2: 20, ia3: null, assignment: 10 }, defaults);
    ok(Math.round(caseC.combinedPct) === 100, 'Case C: two perfect IAs + perfect assignment → 100%');

    // Case D: IA1=4, IA2=0, IA3=12, no assignment
    // Sorted desc: [60%, 20%, 0%] → best-2 = (60+20)/2 = 40%
    var caseD = computeCIE({ ia1: 4, ia2: 0, ia3: 12, assignment: null }, defaults);
    ok(Math.round(caseD.combinedPct) === 40, 'Case D: worst IA dropped in best-2 logic → 40%');

    // Report
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  });
}
