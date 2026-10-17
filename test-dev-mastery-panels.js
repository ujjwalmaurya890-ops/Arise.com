/*!
 * test-dev-mastery-panels.js
 * --------------------------
 * jsdom smoke tests for the two new panels added in v151:
 *   1. Concept Coverage breakdown (dvp-concept-coverage)
 *   2. Job Readiness by Category (dvp-category-readiness)
 *
 * Dependency-free Node harness (same pattern as test-topic-units.js).
 * Run: node test-dev-mastery-panels.js
 * Exit 0 = all pass, non-zero = failures printed.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const WIDGET_SRC = fs.readFileSync(
  path.join(__dirname, 'dev-mastery-premium-widget.js'), 'utf8');

// ---------- helpers ---------------------------------------------------------

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg); }
  else       { failed++; console.error('  ✗ FAIL:', msg); }
}

function makeDOM(devTasks, devTaskInsights) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Seed localStorage inside the jsdom window's own eval context
  const seedScript = `
    (function() {
      var _store = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
          setItem: function(k, v) { _store[k] = String(v); },
          removeItem: function(k) { delete _store[k]; }
        },
        writable: false,
        configurable: true
      });
    })();
  `;
  dom.window.eval(seedScript);

  if (devTasks)        dom.window.eval(`localStorage.setItem('devTasks', ${JSON.stringify(JSON.stringify(devTasks))});`);
  if (devTaskInsights) dom.window.eval(`localStorage.setItem('devTaskInsights', ${JSON.stringify(JSON.stringify(devTaskInsights))});`);

  // Minimal stubs the widget needs
  dom.window.eval(`
    window.__ARISE_MUTATION_BUS__ = { subscribe: function() {} };
    window.performance = { now: function() { return Date.now(); } };
    window.requestAnimationFrame = function(cb) { setTimeout(cb, 0); };
    window.__ARISE_WIDGET_UTILS__ = {
      readVersioned: function(key, opts) {
        var raw = localStorage.getItem(key);
        var parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch(e) {}
        if (!parsed) return { value: opts.fallback };
        var ver = parsed.__schemaVersion;
        if (ver === undefined && opts.migrations && opts.migrations[0]) {
          return { value: opts.migrations[0](parsed) };
        }
        return { value: parsed };
      },
      safeGet: function(key, fb) {
        try {
          var v = localStorage.getItem(key);
          return v ? JSON.parse(v) : fb;
        } catch(e) { return fb; }
      }
    };
  `);

  // Load the widget
  dom.window.eval(WIDGET_SRC);

  return dom.window;
}

// ---------- suite 1: computeConceptCoverage() --------------------------------

console.log('\n── Suite 1: computeConceptCoverage() ──');

{
  const w = makeDOM([], null);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(Array.isArray(cov) && cov.length === 0, 'empty tasks+insights → [] coverage');
}

{
  // Missing quality field → not counted
  const tasks = [
    { id: 1, category: 'Frontend', difficulty: 'Beginner', completed: true, revision: false }
  ];
  const insights = { entries: { 1: { stack: ['React'], concept: 'Auth', quality: '' } } };
  const w = makeDOM(tasks, insights);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(cov.length === 0, 'missing quality field → not counted');
}

{
  // One concept, all independent
  const tasks = [
    { id: 1, category: 'Backend', difficulty: 'Intermediate', completed: true, revision: false },
    { id: 2, category: 'Backend', difficulty: 'Advanced',     completed: true, revision: false },
  ];
  const insights = {
    entries: {
      1: { stack: ['Node'], concept: 'Auth', quality: 'independent' },
      2: { stack: ['Node'], concept: 'Auth', quality: 'independent' },
    }
  };
  const w = makeDOM(tasks, insights);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(cov.length === 1,             '1 concept → 1 row');
  assert(cov[0].concept === 'Auth',    'concept name = Auth');
  assert(cov[0].total === 2,           'total = 2');
  assert(cov[0].independent === 2,     'independent = 2');
  assert(cov[0].indPct === 100,        'indPct = 100');
}

{
  // Three concepts, mixed quality — weakest-first sort
  const tasks = [
    { id: 1, category: 'Backend',  difficulty: 'Beginner',     completed: true, revision: false },
    { id: 2, category: 'Backend',  difficulty: 'Intermediate', completed: true, revision: false },
    { id: 3, category: 'Frontend', difficulty: 'Beginner',     completed: true, revision: false },
    { id: 4, category: 'DevOps',   difficulty: 'Advanced',     completed: true, revision: false },
  ];
  const insights = {
    entries: {
      1: { concept: 'Auth',     quality: 'independent' }, // Auth: 1/1 = 100%
      2: { concept: 'Database', quality: 'copied'      }, // Database: 0/2 = 0%
      3: { concept: 'Testing',  quality: 'guided'      }, // Testing: 0/1 = 0%
      4: { concept: 'Database', quality: 'guided'      }, // Database total=2
    }
  };
  const w = makeDOM(tasks, insights);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(cov.length === 3,                 '3 distinct concepts');
  assert(cov[0].concept === 'Database',    'Database first (0%, 2 tasks)');
  assert(cov[1].concept === 'Testing',     'Testing second (0%, 1 task)');
  assert(cov[2].concept === 'Auth',        'Auth last (100%)');
  assert(cov[0].copied === 1,              'Database.copied = 1');
  assert(cov[0].guided === 1,              'Database.guided = 1');
  assert(cov[2].indPct === 100,            'Auth.indPct = 100');
}

{
  // Uncompleted task → not counted
  const tasks = [
    { id: 1, category: 'Backend', difficulty: 'Intermediate', completed: false, revision: false },
  ];
  const insights = { entries: { 1: { concept: 'Auth', quality: 'independent' } } };
  const w = makeDOM(tasks, insights);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(cov.length === 0, 'incomplete task → not counted');
}

{
  // Legacy flat-map insights shape (pre-versioning migration)
  const tasks = [
    { id: 1, category: 'Backend', difficulty: 'Intermediate', completed: true, revision: false },
  ];
  const legacyInsights = { 1: { concept: 'Deployment', quality: 'guided' } };
  const w = makeDOM(tasks, legacyInsights);
  const cov = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeConceptCoverage();
  assert(cov.length === 1 && cov[0].concept === 'Deployment', 'legacy flat-map migrated correctly');
}

// ---------- suite 2: computeCategoryReadiness() ------------------------------

console.log('\n── Suite 2: computeCategoryReadiness() ──');

{
  const w = makeDOM([], null);
  const cats = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeCategoryReadiness();
  assert(cats.length === 0, 'no tasks → empty category readiness');
}

{
  // Single category, weighted math
  const tasks = [
    { id: 1, category: 'Backend', difficulty: 'Beginner',     completed: true,  revision: false },
    { id: 2, category: 'Backend', difficulty: 'Intermediate', completed: false, revision: false },
    { id: 3, category: 'Backend', difficulty: 'Advanced',     completed: false, revision: false },
  ];
  const w = makeDOM(tasks, null);
  const cats = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeCategoryReadiness();
  assert(cats.length === 1,          '1 category');
  assert(cats[0].weightDone === 1,   'weightDone = 1 (Beginner)');
  assert(cats[0].weightTotal === 9,  'weightTotal = 9 (1+3+5)');
  assert(cats[0].pct === 11,         'pct = 11%');
}

{
  // Weakest-first order across 3 categories
  const tasks = [
    // Backend: 5/9 ≈ 56%
    { id: 1, category: 'Backend',       difficulty: 'Advanced',     completed: true,  revision: false },
    { id: 2, category: 'Backend',       difficulty: 'Intermediate', completed: false, revision: false },
    { id: 3, category: 'Backend',       difficulty: 'Beginner',     completed: false, revision: false },
    // Frontend: 1/1 = 100%
    { id: 4, category: 'Frontend',      difficulty: 'Beginner',     completed: true,  revision: false },
    // System Design: 0/5 = 0%
    { id: 5, category: 'System Design', difficulty: 'Advanced',     completed: false, revision: false },
  ];
  const w = makeDOM(tasks, null);
  const cats = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeCategoryReadiness();
  assert(cats.length === 3,                        '3 categories');
  assert(cats[0].category === 'System Design',     'System Design first (0%)');
  assert(cats[1].category === 'Backend',           'Backend second');
  assert(cats[2].category === 'Frontend',          'Frontend last (100%)');
}

{
  // Level mapping sanity check
  const w = makeDOM([], null);
  const api = w.__ARISE_DEV_MASTERY_PREMIUM_API__;
  assert(api.getLevel(0).info.key   === 'beginner',     '0% → Beginner');
  assert(api.getLevel(19).info.key  === 'beginner',     '19% → Beginner');
  assert(api.getLevel(20).info.key  === 'intermediate', '20% → Intermediate');
  assert(api.getLevel(40).info.key  === 'advanced',     '40% → Advanced');
  assert(api.getLevel(60).info.key  === 'expert',       '60% → Expert');
  assert(api.getLevel(80).info.key  === 'jobready',     '80% → Job Ready');
  assert(api.getLevel(100).info.key === 'jobready',     '100% → Job Ready');
}

{
  // Each category has a valid level object
  const tasks = [
    { id: 1, category: 'Frontend', difficulty: 'Beginner',     completed: true,  revision: false },
    { id: 2, category: 'Backend',  difficulty: 'Intermediate', completed: false, revision: false },
    { id: 3, category: 'DevOps',   difficulty: 'Advanced',     completed: false, revision: false },
  ];
  const w = makeDOM(tasks, null);
  const cats = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeCategoryReadiness();
  assert(cats.every(c => c.level && c.level.info && c.level.info.icon),
    'every category has a level with icon');
}

// ---------- suite 3: existing scoring regression ----------------------------

console.log('\n── Suite 3: existing scoring regression ──');

{
  const tasks = [
    { id: 1, category: 'Backend',  difficulty: 'Beginner',     completed: true,  revision: false },
    { id: 2, category: 'Backend',  difficulty: 'Intermediate', completed: true,  revision: false },
    { id: 3, category: 'Backend',  difficulty: 'Advanced',     completed: false, revision: true  },
    { id: 4, category: 'Frontend', difficulty: 'Beginner',     completed: false, revision: false },
  ];
  const w = makeDOM(tasks, null);
  const stats = w.__ARISE_DEV_MASTERY_PREMIUM_API__.computeStats();
  // weightedTotal = 1+3+5+1 = 10, weightedDone = 1+3 = 4, pct = 40
  assert(stats.completed  === 2,  'computeStats: completed = 2');
  assert(stats.remaining  === 2,  'computeStats: remaining = 2');
  assert(stats.revision   === 1,  'computeStats: revision = 1');
  assert(stats.completion === 40, 'computeStats: completion = 40%');
}

{
  // weakestConcept() still returns the worst concept after migration
  const tasks = [
    { id: 1, category: 'Backend', difficulty: 'Intermediate', completed: true, revision: false },
    { id: 2, category: 'Backend', difficulty: 'Advanced',     completed: true, revision: false },
  ];
  const insights = {
    entries: {
      1: { concept: 'Auth',    quality: 'copied'      }, // 0% independent
      2: { concept: 'Testing', quality: 'independent' }, // 100% independent
    }
  };
  const w = makeDOM(tasks, insights);
  const worst = w.__ARISE_DEV_MASTERY_PREMIUM_API__.weakestConcept();
  assert(worst && worst.concept === 'Auth', 'weakestConcept → Auth (0%)');
  assert(worst.pct === 0,                   'weakestConcept pct = 0');
}

{
  // weakestCategory() unchanged
  const tasks = [
    { id: 1, category: 'Backend',  difficulty: 'Advanced', completed: true,  revision: false },
    { id: 2, category: 'DevOps',   difficulty: 'Beginner', completed: false, revision: false },
  ];
  const w = makeDOM(tasks, null);
  const wc = w.__ARISE_DEV_MASTERY_PREMIUM_API__.weakestCategory();
  assert(wc && wc.category === 'DevOps', 'weakestCategory → DevOps (0%)');
}

{
  // nextLevelGap() returns null when no tasks
  const w = makeDOM([], null);
  const gap = w.__ARISE_DEV_MASTERY_PREMIUM_API__.nextLevelGap();
  assert(gap === null, 'nextLevelGap → null when no tasks');
}

// ---------- summary ---------------------------------------------------------

console.log('\n' + '─'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
