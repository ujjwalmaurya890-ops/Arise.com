'use strict';
// Tests for v168: Weekly Budget section now buckets spend into true
// Sunday-Saturday calendar weeks (previously fixed day-of-month quartiles
// 1-7/8-14/15-21/22-end, which never actually turned over on a weekday).
// Installs a fake "today" by overriding window.Date before src/expenses.js
// loads, so the week-bucket boundaries are fully deterministic regardless
// of the real date this test happens to run on. Same mount contract as
// the other test-*.js files in this repo.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}

function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://example.test/', runScripts: 'dangerously'
  });
  const window = dom.window;
  window.__ARISE_MUTATION_BUS__ = { subscribe: function () {} };
  return dom;
}

// Fixes "now" to fixedISO (interpreted as noon UTC, to stay clear of any
// timezone rollover edge cases) for every no-arg `new Date()` / `Date.now()`
// call made by the widget after this runs. Dated `new Date(x)` calls pass
// straight through to the real Date so existing date-math is unaffected.
function installFakeToday(window, fixedISO) {
  const RealDate = window.Date;
  const fixedMs = new RealDate(fixedISO + 'T12:00:00Z').getTime();
  function FakeDate() {
    if (arguments.length === 0) return new RealDate(fixedMs);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return fixedMs; };
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;
}

function loadScript(window, file) {
  const code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), file), 'utf8');
  window.eval(code);
}

// Panels are lazy now (perf fix): a tab's markup is only built once it
// becomes the active one. The Weekly Budget section lives under the
// "trends" tab, which isn't the default, so switch to it the same way a
// user would (clicking the pill) right after mount.
function switchTab(win, root, id) {
  const btn = root.querySelector('[data-wnav-id="' + id + '"]');
  if (btn) btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  return btn;
}

function mount(window) {
  loadScript(window, 'src/widget-nav.js');
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);
  switchTab(window, el, 'trends');
  return el;
}

function seedTransactions(window, list) {
  window.localStorage.setItem('arise-expenses-v1', JSON.stringify(list));
}

function seedWeeklyBudget(window, monthly, weekly) {
  window.localStorage.setItem('arise-expenses-weekly-budget-v1', JSON.stringify({ monthly: monthly, weekly: weekly }));
}

// Fixed "today" = 2026-09-10 (a Thursday). September 2026 starts on a
// Tuesday, so its weekly buckets (Sunday-bounded, first bucket short) are:
// [1-5], [6-12], [13-19], [20-26], [27-30] - 5 buckets, and day 10 falls
// in the 2nd bucket (6-12), i.e. "Week 2 of 5".
const TODAY = '2026-09-10';

// ---------------------------------------------------------------------
// 1. Weekly section reports the correct bucket count/index for a month
//    that doesn't start on a Sunday, and sums only the current week.
// ---------------------------------------------------------------------
(function testSundayBucketingAndCurrentWeekSum() {
  const dom = freshDom();
  const window = dom.window;
  installFakeToday(window, TODAY);
  loadScript(window, 'src/expenses.js');

  seedWeeklyBudget(window, 8000, 2000);
  seedTransactions(window, [
    { id: 'w1', type: 'expense', title: 'Snacks', amount: 100, category: 'Food', date: '2026-09-10' },   // today, in-week
    { id: 'w2', type: 'expense', title: 'Bus', amount: 50, category: 'Transport', date: '2026-09-06' },   // bucket start (Sun), in-week
    { id: 'w3', type: 'expense', title: 'Movie', amount: 300, category: 'Entertainment', date: '2026-09-12' }, // bucket end (Sat), in-week
    { id: 'w4', type: 'expense', title: 'Books', amount: 999, category: 'Education', date: '2026-09-05' },  // previous bucket - excluded
    { id: 'w5', type: 'expense', title: 'Late fee', amount: 777, category: 'Other', date: '2026-09-13' }    // next bucket - excluded
  ]);

  const el = mount(window);
  const html = el.innerHTML;

  assert(html.indexOf('Week 2 of 5') !== -1, 'Sept 2026 (starts on a Tuesday) reports "Week 2 of 5" for day 10');
  assert(el.querySelectorAll('.exwwb-week-card').length === 5, 'Renders exactly 5 week cards for a 5-bucket month');

  const weeklyExpenseEl = el.querySelector('.exwwb-section .exw-stat-expense .exw-stat-value');
  assert(!!weeklyExpenseEl, 'Weekly Expense stat chip renders');
  // 100 + 50 + 300 = 450; the 999 and 777 entries fall in adjacent buckets
  assert(weeklyExpenseEl.textContent.indexOf('450') !== -1,
    'Weekly Expense sums only in-week entries (100+50+300=450), excluding the adjacent-bucket 999/777 entries: got ' + weeklyExpenseEl.textContent);

  const currentCard = el.querySelector('.exwwb-week-current .exwwb-week-range');
  assert(!!currentCard && currentCard.textContent.indexOf('6\u201312') !== -1,
    'Current week card shows the 6-12 Sunday-bounded range, got: ' + (currentCard && currentCard.textContent));
})();

// ---------------------------------------------------------------------
// 2. A month that starts on a Sunday cleanly splits into exactly 4 full
//    weeks (no short first bucket needed).
// ---------------------------------------------------------------------
(function testSundayStartMonthGetsFourEvenBuckets() {
  const dom = freshDom();
  const window = dom.window;
  installFakeToday(window, '2026-02-15'); // Feb 2026 starts on a Sunday
  loadScript(window, 'src/expenses.js');

  seedWeeklyBudget(window, 4000, 1000);
  seedTransactions(window, [
    { id: 'f1', type: 'expense', title: 'Groceries', amount: 200, category: 'Food', date: '2026-02-15' }
  ]);

  const el = mount(window);
  const html = el.innerHTML;
  assert(html.indexOf('Week 3 of 4') !== -1, 'Feb 2026 (starts on a Sunday) reports "Week 3 of 4" for day 15 (15-21 bucket)');
  assert(el.querySelectorAll('.exwwb-week-card').length === 4, 'Renders exactly 4 week cards for a Sunday-start month');
})();

// ---------------------------------------------------------------------
// 3. weekStartUTC (shared by the Weekly Trend chart, Week-over-Week
//    chart, Weekly & Monthly weekly view, heatmap grid, and the AI
//    this-week-vs-last-week comparison) now aligns to Sunday too, so
//    "week" means the same thing everywhere in the widget.
// ---------------------------------------------------------------------
(function testSharedWeekStartIsNowSunday() {
  const dom = freshDom();
  const window = dom.window;
  installFakeToday(window, TODAY); // 2026-09-10, a Thursday; its Sunday is 2026-09-06
  loadScript(window, 'src/expenses.js');
  const el = mount(window);

  const weekCols = el.querySelectorAll('.exwi-week-col');
  assert(weekCols.length > 0, 'Week-over-Week Spending chart renders its week columns');
  const lastCol = weekCols[weekCols.length - 1];
  assert(lastCol.getAttribute('title').indexOf('Week of 06 Sep') === 0,
    'Current week column starts from Sunday 06 Sep (not a Monday-start week), got: ' + lastCol.getAttribute('title'));
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
