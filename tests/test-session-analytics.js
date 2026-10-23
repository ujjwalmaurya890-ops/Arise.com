/*!
 * tests/test-session-analytics.js
 * -------------------------
 * jsdom smoke tests for the v152 src/learning-session-analytics-widget.js additions:
 *   1. computeWeeklyBars() — last-7-days bar chart data
 *   2. computeDistractionStats() — avg distractions + deep-work rate
 *   3. computeCategoryStreaks() — per-category consecutive-day streaks
 *   4. computeProductivityHeatmap() — hour-bucket × day-of-week rating grid
 *
 * Dependency-free Node harness (same pattern as tests/test-dev-mastery-panels.js).
 * Run: node tests/test-session-analytics.js
 * Exit 0 = all pass, non-zero = failures printed.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const WIDGET_SRC = fs.readFileSync(
  path.join(path.resolve(__dirname, ".."), 'src/learning-session-analytics-widget.js'), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg); }
  else       { failed++; console.error('  ✗ FAIL:', msg); }
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}
function dateMinusDays(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function makeWindow(sessions) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously', pretendToBeVisual: true,
  });
  dom.window.eval(`
    (function() {
      var _store = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
          setItem: function(k, v) { _store[k] = String(v); },
          removeItem: function(k) { delete _store[k]; }
        }, writable: false, configurable: true
      });
    })();
    window.__ARISE_MUTATION_BUS__ = { subscribe: function() {} };
    window.performance = { now: function() { return Date.now(); } };
    window.requestAnimationFrame = function(cb) { setTimeout(cb, 0); };
  `);
  if (sessions) {
    dom.window.eval(`localStorage.setItem('focusSessionsV2', ${JSON.stringify(JSON.stringify(sessions))});`);
  }
  dom.window.eval(WIDGET_SRC);
  return dom.window;
}

// Expose compute functions via a thin shim injected before the widget
function makeWindowWithShim(sessions) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'dangerously', pretendToBeVisual: true,
  });
  dom.window.eval(`
    (function() {
      var _store = {};
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: function(k) { return _store[k] !== undefined ? _store[k] : null; },
          setItem: function(k, v) { _store[k] = String(v); },
          removeItem: function(k) { delete _store[k]; }
        }, writable: false, configurable: true
      });
    })();
    window.__LA_TEST__ = true;
    window.__ARISE_MUTATION_BUS__ = { subscribe: function() {} };
    window.performance = { now: function() { return Date.now(); } };
    window.requestAnimationFrame = function(cb) { setTimeout(cb, 0); };
  `);
  if (sessions) {
    dom.window.eval(`localStorage.setItem('focusSessionsV2', ${JSON.stringify(JSON.stringify(sessions))});`);
  }
  // Patch: expose internal fns by modifying source before eval
  const src = WIDGET_SRC; // widget ships minified; it exposes its own hook when __LA_TEST__ is set
  dom.window.eval(src);
  return dom.window;
}

// ── Suite 1: computeWeeklyBars ───────────────────────────────────────────────
console.log('\n── Suite 1: computeWeeklyBars() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const bars = api.computeWeeklyBars();
  assert(bars.length === 7, 'always 7 bars');
  assert(bars[bars.length - 1].isToday === true, 'last bar is today');
  assert(bars.every(b => b.minutes === 0), 'all zero with no sessions');
}
{
  const today = todayStr();
  const sessions = [
    { minutes: 45, date: today, endedAt: Date.now() },
    { minutes: 30, date: today, endedAt: Date.now() },
    { minutes: 60, date: dateMinusDays(3), endedAt: Date.now() - 3 * 86400000 }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const bars = api.computeWeeklyBars();
  const todayBar = bars.find(b => b.isToday);
  assert(todayBar && todayBar.minutes === 75, 'today bar sums to 75');
  const d3bar = bars.find(b => b.date === dateMinusDays(3));
  assert(d3bar && d3bar.minutes === 60, 'day-3 bar = 60');
  const d1bar = bars.find(b => b.date === dateMinusDays(1));
  assert(d1bar && d1bar.minutes === 0, 'day-1 bar = 0 (no sessions)');
}

// ── Suite 2: computeDistractionStats ────────────────────────────────────────
console.log('\n── Suite 2: computeDistractionStats() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  assert(api.computeDistractionStats([]) === null, 'no sessions → null');
}
{
  const sessions = [
    { minutes: 30, distractions: 0, rating: 5, endedAt: Date.now() },
    { minutes: 30, distractions: 2, rating: 3, endedAt: Date.now() },
    { minutes: 30, distractions: 0, rating: 4, endedAt: Date.now() }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const s = api.computeDistractionStats(sessions);
  assert(s !== null, 'has stats');
  assert(s.avgDistractions === '0.7', 'avg distractions = 0.7');
  // deep-work = sessions with dist=0 AND rating≥4: sessions[0] (5★) + sessions[2] (4★) = 2/3 = 67%
  assert(s.deepWorkRate === 67, 'deep-work rate = 67%');
  assert(s.sampleSize === 3, 'sample size = 3');
}
{
  // Sessions without distractions field → not counted
  const sessions = [
    { minutes: 30, rating: 5, endedAt: Date.now() }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  assert(api.computeDistractionStats(sessions) === null, 'no distractions field → null');
}

// ── Suite 3: computeCategoryStreaks ──────────────────────────────────────────
console.log('\n── Suite 3: computeCategoryStreaks() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const streaks = api.computeCategoryStreaks([]);
  assert(Array.isArray(streaks) && streaks.length === 0, 'empty → []');
}
{
  const today = todayStr();
  const sessions = [
    { minutes: 30, category: 'DSA', date: today },
    { minutes: 30, category: 'DSA', date: dateMinusDays(1) },
    { minutes: 30, category: 'DSA', date: dateMinusDays(2) },
    { minutes: 30, category: 'Project', date: today }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const streaks = api.computeCategoryStreaks(sessions);
  const dsa = streaks.find(s => s.cat === 'DSA');
  assert(dsa && dsa.streak === 3, 'DSA streak = 3 days');
  const proj = streaks.find(s => s.cat === 'Project');
  assert(proj && proj.streak === 1, 'Project streak = 1');
}
{
  // Gap in DSA study → streak breaks
  const today = todayStr();
  const sessions = [
    { minutes: 30, category: 'DSA', date: today },
    // gap on day-1
    { minutes: 30, category: 'DSA', date: dateMinusDays(2) }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const streaks = api.computeCategoryStreaks(sessions);
  const dsa = streaks.find(s => s.cat === 'DSA');
  assert(dsa && dsa.streak === 1, 'DSA streak = 1 (broken by gap)');
}

// ── Suite 4: computeProductivityHeatmap ──────────────────────────────────────
console.log('\n── Suite 4: computeProductivityHeatmap() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const grid = api.computeProductivityHeatmap([]);
  assert(grid.length === 6, '6 hour buckets');
  assert(grid[0].length === 7, '7 day-of-week columns');
  assert(grid.every(row => row.every(cell => cell.count === 0)), 'all cells empty');
}
{
  // Monday 9am session (Mon = dayIndex 0, bucket "8am–12" = index 2)
  // Use a known Monday — 2026-09-07 is a Monday
  const mondayMorning = new Date('2026-09-07T09:00:00').getTime();
  const sessions = [
    { minutes: 45, rating: 5, startedAt: mondayMorning, endedAt: mondayMorning + 45*60000 },
    { minutes: 45, rating: 3, startedAt: mondayMorning + 60000, endedAt: mondayMorning + 45*60000 + 60000 }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const grid = api.computeProductivityHeatmap(sessions);
  const cell = grid[2][0]; // bucket 2 (8am-12), Mon (index 0)
  assert(cell.count === 2, 'Mon 8am–12 has 2 sessions');
  assert(Math.abs(cell.sum / cell.count - 4) < 0.01, 'avg = 4.0 ((5+3)/2)');
}
{
  // Sessions without rating are not counted in heatmap
  const mondayMorning = new Date('2026-09-07T09:00:00').getTime();
  const sessions = [
    { minutes: 45, startedAt: mondayMorning, endedAt: mondayMorning + 45*60000 }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const grid = api.computeProductivityHeatmap(sessions);
  assert(grid[2][0].count === 0, 'no-rating session not counted in heatmap');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
