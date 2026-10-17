/*!
 * test-session-analytics-v153.js
 * -------------------------------
 * jsdom smoke tests for the v153 learning-session-analytics-widget.js additions:
 *   1. computeDeadDays() — 30-day dead/active/no-data classification
 *   2. computeWeeklyTargetGrid() — trailing-7-day actual vs stored target
 *   3. sessionEfficiency() / computeEfficiencyTrend() — output-per-hour score
 *   4. computePlacementCountdown() — days-left / hours-needed pressure figure
 *
 * Same dependency-free jsdom harness pattern as test-session-analytics.js.
 * Run: node test-session-analytics-v153.js
 * Exit 0 = all pass, non-zero = failures printed.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const WIDGET_SRC = fs.readFileSync(
  path.join(__dirname, 'learning-session-analytics-widget.js'), 'utf8');

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

// Expose compute functions via a thin shim injected before the widget runs.
function makeWindowWithShim(sessions, config) {
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
  if (config) {
    dom.window.eval(`localStorage.setItem('arise-la-config-v1', ${JSON.stringify(JSON.stringify(config))});`);
  }
  const src = WIDGET_SRC; // widget ships minified; it exposes its own hook when __LA_TEST__ is set
  dom.window.eval(src);
  return dom.window;
}

// ── Suite 1: computeDeadDays ─────────────────────────────────────────────
console.log('\n── Suite 1: computeDeadDays() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const info = api.computeDeadDays([], 30);
  assert(info.days.length === 30, '30-day window');
  assert(info.hasTracking === false, 'no sessions ever → hasTracking false');
  assert(info.deadCount === 0, 'no sessions ever → 0 dead days (all no-data)');
  assert(info.days.every(d => d.status === 'no-data'), 'every day is no-data with no history');
}
{
  const sessions = [
    { minutes: 30, date: dateMinusDays(10) },   // active
    { minutes: 0,  date: dateMinusDays(5) },    // explicit 0-min session on a tracked day
    { minutes: 45, date: todayStr() }           // active (today)
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const info = api.computeDeadDays(sessions, 30);
  assert(info.hasTracking === true, 'has tracking once a session exists');
  const before = info.days.find(d => d.date === dateMinusDays(15));
  assert(before && before.status === 'no-data', 'day before first session is no-data, not dead');
  const gapDay = info.days.find(d => d.date === dateMinusDays(7));
  assert(gapDay && gapDay.status === 'dead', 'untouched day after tracking began is dead');
  const zeroSessionDay = info.days.find(d => d.date === dateMinusDays(5));
  assert(zeroSessionDay && zeroSessionDay.status === 'dead', '0-minute session day counts as dead too');
  const activeDay = info.days.find(d => d.date === dateMinusDays(10));
  assert(activeDay && activeDay.status === 'active', 'day with logged minutes is active');
  assert(info.deadCount > 0, 'deadCount reflects dead days');
}

// ── Suite 2: computeWeeklyTargetGrid ─────────────────────────────────────
console.log('\n── Suite 2: computeWeeklyTargetGrid() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const rows = api.computeWeeklyTargetGrid([], { DSA: 15, Dev: 5, College: 0, 'Interview Prep': 8 });
  assert(rows.length === 4, '4 rows: DSA/Dev/College/Interview Prep');
  const college = rows.find(r => r.key === 'College');
  assert(college.met === null, 'target 0 → met is null (neutral)');
  const dsa = rows.find(r => r.key === 'DSA');
  assert(dsa.actualH === 0, 'no sessions → 0 actual hours');
  assert(dsa.met === false, 'target > 0 with 0 actual → not met');
}
{
  const sessions = [
    { minutes: 600, category: 'DSA', date: dateMinusDays(1) },   // 10h, within last 7 days
    { minutes: 60,  category: 'Project', date: dateMinusDays(2) }, // 1h dev
    { minutes: 600, category: 'DSA', date: dateMinusDays(20) }    // outside window, ignored
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const rows = api.computeWeeklyTargetGrid(sessions, { DSA: 15, Dev: 5, College: 0, 'Interview Prep': 8 });
  const dsa = rows.find(r => r.key === 'DSA');
  assert(Math.abs(dsa.actualH - 10) < 0.01, 'DSA actual = 10h (only trailing 7 days counted)');
  assert(dsa.met === false, '10h < 15h target → not met');
  const dev = rows.find(r => r.key === 'Dev');
  assert(Math.abs(dev.actualH - 1) < 0.01, "Dev row sums the 'Project' category = 1h");
  assert(dev.met === false, '1h < 5h target → not met');
}
{
  const sessions = [{ minutes: 900, category: 'DSA', date: dateMinusDays(1) }]; // 15h
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const rows = api.computeWeeklyTargetGrid(sessions, { DSA: 15, Dev: 5, College: 0, 'Interview Prep': 8 });
  const dsa = rows.find(r => r.key === 'DSA');
  assert(dsa.met === true, '15h actual >= 15h target → met');
}

// ── Suite 3: sessionEfficiency / computeEfficiencyTrend ──────────────────
console.log('\n── Suite 3: sessionEfficiency() / computeEfficiencyTrend() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  assert(api.sessionEfficiency({ rating: 5, distractions: 0 }) === 100, 'rating 5, 0 distractions → 100');
  assert(api.sessionEfficiency({ rating: 5, distractions: 5 }) === 0, 'rating 5, 5+ distractions clamped → 0');
  assert(Math.abs(api.sessionEfficiency({ rating: 4, distractions: 2 }) - 48) < 0.01, 'rating 4, 2 distractions → 48');
  assert(api.sessionEfficiency({ rating: 5 }) === 100, 'missing distractions treated as 0, not penalized');
  assert(api.sessionEfficiency({ rating: 0, distractions: 0 }) === null, 'no rating → null (excluded)');
  assert(api.sessionEfficiency({}) === null, 'empty session → null');
  assert(api.sessionEfficiency({ rating: 7, distractions: 0 }) === 100, 'out-of-range rating > 5 clamps to 100, not >100');
  assert(api.sessionEfficiency({ rating: -3, distractions: 0 }) === null, 'negative rating fails the >0 check → null');
}
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const info = api.computeEfficiencyTrend([], 7);
  assert(info.sampleSize === 0, 'no sessions → sample size 0');
  assert(info.overallAvg === null, 'no sessions → overallAvg null');
  assert(info.trend.length === 7, '7-day trend array');
  assert(info.trend.every(d => d.avg === null), 'every day null with no rated sessions');
}
{
  const sessions = [
    { minutes: 60, rating: 5, distractions: 0, date: todayStr() },
    { minutes: 60, rating: 3, distractions: 1, date: todayStr() },
    { minutes: 60, rating: 4, distractions: 0, date: dateMinusDays(2) }
  ];
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const info = api.computeEfficiencyTrend(sessions, 7);
  assert(info.sampleSize === 3, 'sample size counts all rated sessions');
  const todayEntry = info.trend[info.trend.length - 1];
  assert(todayEntry.count === 2, "today's bucket aggregates both today sessions");
  assert(info.overallAvg > 0 && info.overallAvg <= 100, 'overallAvg in valid range');
}

// ── Suite 4: computePlacementCountdown ───────────────────────────────────
console.log('\n── Suite 4: computePlacementCountdown() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const pc = api.computePlacementCountdown([], { placementDate: null, dsaHoursNeeded: null });
  assert(pc.daysLeft === null, 'no placement date → daysLeft null');
  assert(pc.hoursPerDay === null, 'no placement date → hoursPerDay null');
  assert(pc.hoursBanked === 0, 'no sessions → 0 hours banked');
}
{
  // 60 days out, need 300h, have 120h banked → gap 180h / 60 days = 3h/day
  const future = new Date();
  future.setDate(future.getDate() + 60);
  const placementDate = future.toISOString().split('T')[0];
  const sessions = [{ minutes: 120 * 60, category: 'DSA', date: dateMinusDays(1) }]; // 120h
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const pc = api.computePlacementCountdown(sessions, { placementDate: placementDate, dsaHoursNeeded: 300 });
  assert(pc.hoursBanked === 120, '120h banked');
  assert(pc.daysLeft === 60 || pc.daysLeft === 61, '~60 days left (' + pc.daysLeft + ')');
  assert(Math.abs(pc.gap - 180) < 0.01, 'gap = 300 - 120 = 180h');
  assert(pc.hoursPerDay > 2.9 && pc.hoursPerDay < 3.1, 'hours/day needed ≈ 3.0 (' + pc.hoursPerDay + ')');
}
{
  // Target already met
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const placementDate = future.toISOString().split('T')[0];
  const sessions = [{ minutes: 400 * 60, category: 'DSA', date: dateMinusDays(1) }]; // 400h
  const w = makeWindowWithShim(sessions);
  const api = w.__LA_EXPOSE__();
  const pc = api.computePlacementCountdown(sessions, { placementDate: placementDate, dsaHoursNeeded: 300 });
  assert(pc.gap === 0, 'banked exceeds needed → gap clamped to 0');
  assert(pc.hoursPerDay === null, 'gap is 0 → no pressure figure');
}
{
  // Placement date already passed
  const past = dateMinusDays(5);
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const pc = api.computePlacementCountdown([], { placementDate: past, dsaHoursNeeded: 100 });
  assert(pc.daysLeft < 0, 'past placement date → negative daysLeft');
}

// ── Suite 5: readConfig / writeConfig ────────────────────────────────────
console.log('\n── Suite 5: readConfig() / writeConfig() ──');
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const cfg = api.readConfig();
  assert(cfg.weeklyTargets.DSA === 15, 'default DSA target = 15');
  assert(cfg.weeklyTargets.Dev === 5, 'default Dev target = 5');
  assert(cfg.weeklyTargets['Interview Prep'] === 8, 'default Interview Prep target = 8');
  assert(cfg.placementDate === null, 'default placementDate null');
  assert(cfg.dsaHoursNeeded === null, 'default dsaHoursNeeded null');
}
{
  const w = makeWindowWithShim([], { weeklyTargets: { DSA: 20 }, placementDate: '2027-01-15', dsaHoursNeeded: 250 });
  const api = w.__LA_EXPOSE__();
  const cfg = api.readConfig();
  assert(cfg.weeklyTargets.DSA === 20, 'stored DSA target overrides default');
  assert(cfg.weeklyTargets.Dev === 5, 'missing Dev target falls back to default');
  assert(cfg.placementDate === '2027-01-15', 'stored placementDate read back');
  assert(cfg.dsaHoursNeeded === 250, 'stored dsaHoursNeeded read back');
}
{
  const w = makeWindowWithShim([]);
  const api = w.__LA_EXPOSE__();
  const cfg = api.readConfig();
  cfg.weeklyTargets.DSA = 12;
  api.writeConfig(cfg);
  const reread = api.readConfig();
  assert(reread.weeklyTargets.DSA === 12, 'writeConfig persists a change that readConfig then sees');
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
