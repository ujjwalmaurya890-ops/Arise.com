'use strict';
// Tests for v148: Expenses widget "⭐ Premium" tab (Scenario Planner) -
// What-If Simulator, Net Worth Trend snapshots, Goal Projections.
// Mounts the real widget in jsdom via window.__mountExpenses, same
// contract as the other test-*.js files in this repo.
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

function loadScript(window, file) {
  const code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), file), 'utf8');
  window.eval(code);
}

// Panels are lazy now (perf fix): a tab's markup is only built once it
// becomes the active one. This whole file exercises the "premium" tab,
// which isn't the default, so switch to it the same way a user would
// (clicking the pill) right after every mount.
function switchTab(win, root, id) {
  const btn = root.querySelector('[data-wnav-id="' + id + '"]');
  if (btn) btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  return btn;
}

function mount(window) {
  loadScript(window, 'src/widget-nav.js'); // real app loads this before src/expenses.js's nav is first used
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);
  switchTab(window, el, 'premium');
  return el;
}

function iso(daysAgoFromToday) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgoFromToday);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function monthsAgoISO(n, day) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  if (day) d.setDate(day);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function seedTransactions(window, list) {
  window.localStorage.setItem('arise-expenses-v1', JSON.stringify(list));
}

// ---------------------------------------------------------------------
// 1. Premium tab renders with its three sections and a Save Snapshot btn
// ---------------------------------------------------------------------
(function testPremiumTabRenders() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/expenses.js');
  const el = mount(window);

  const html = el.innerHTML;
  assert(html.indexOf('What-If Simulator') !== -1, 'What-If Simulator section renders');
  assert(html.indexOf('Net Worth Trend') !== -1, 'Net Worth Trend section renders');
  assert(html.indexOf('Goal Projections') !== -1, 'Goal Projections section renders');
  assert(el.querySelector('[data-action="save-nw-snapshot"]') !== null, 'Save snapshot button renders');
})();

// ---------------------------------------------------------------------
// 2. What-If Simulator shows an empty state with no expense history, and
//    real numbers once trailing-complete-month data exists.
// ---------------------------------------------------------------------
(function testWhatIfEmptyThenPopulated() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/expenses.js');
  let el = mount(window);
  assert(el.innerHTML.indexOf('Needs at least one full month') !== -1, 'What-If shows empty state with no history');

  seedTransactions(window, [
    { id: 'a1', type: 'income', title: 'Stipend', amount: 10000, category: 'Income', date: monthsAgoISO(1, 5) },
    { id: 'a2', type: 'expense', title: 'Mess bill', amount: 4000, category: 'Food', date: monthsAgoISO(1, 6) },
    { id: 'a3', type: 'expense', title: 'Data pack', amount: 500, category: 'Subscriptions', date: monthsAgoISO(1, 7) }
  ]);
  el.innerHTML = '';
  window.__mountExpenses(el);
  const html = el.innerHTML;
  assert(html.indexOf('based on last 3 complete months') !== -1, 'What-If reports the 3-month trailing window');
  assert(html.indexOf('Food (avg') !== -1, 'Food category offered as a cut option with its avg spend');
})();

// ---------------------------------------------------------------------
// 3. Applying a scenario persists it and changes the projected numbers,
//    and feeds into the Goal Projections "With scenario" line.
// ---------------------------------------------------------------------
(function testApplyScenarioAffectsProjections() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/expenses.js');
  let el = mount(window);

  seedTransactions(window, [
    { id: 'b1', type: 'income', title: 'Stipend', amount: 8000, category: 'Income', date: monthsAgoISO(1, 5) },
    { id: 'b2', type: 'expense', title: 'Food', amount: 6000, category: 'Food', date: monthsAgoISO(1, 6) }
  ]);
  window.localStorage.setItem('arise-expenses-goals-v1', JSON.stringify([
    { id: 'g1', title: 'New laptop', targetAmount: 40000, createdAt: monthsAgoISO(2) + 'T00:00:00.000Z' }
  ]));
  el.innerHTML = '';
  window.__mountExpenses(el);

  // current avg net = 8000 - 6000 = 2000/mo -> goal projected, not "not projected"
  assert(el.innerHTML.indexOf('Not projected') === -1, 'Positive current pace yields a projected date, not a stall message');

  const form = el.querySelector('[data-role="scenario-form"]');
  form.querySelector('[name="scenarioCategory"]').value = 'Food';
  form.querySelector('[name="scenarioCutPct"]').value = '50';
  form.querySelector('[name="scenarioIncomeDelta"]').value = '1000';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  const stored = JSON.parse(window.localStorage.getItem('arise-expenses-scenario-v1'));
  assert(stored.category === 'Food' && stored.cutPct === 50 && stored.incomeDelta === 1000, 'Scenario form submit persists the chosen inputs');

  const html = el.innerHTML;
  // The app averages income/expense over the trailing 3 *complete* months
  // (avgMonthlyNet), so a single seeded month still divides by 3:
  // avgIncome=8000/3, avgExpense=6000/3, catAvg(Food)=6000/3;
  // projectedIncome = avgIncome+1000, projectedExpense = avgExpense - catAvg*0.5
  // -> projectedNet = 2666.67. (This assertion previously matched "6,000"
  // by coincidence against the unrelated Overview tab's "Total Expense"
  // stat chip, which eager cross-tab rendering happened to also put in the
  // page; now that tabs render lazily, only the active tab's real figure
  // is present, so we assert the actual computed value.)
  assert(html.indexOf('2,666.67') !== -1, 'Projected net reflects the applied scenario, averaged over the trailing 3 complete months (\u20b92,666.67/mo)');
  assert(html.indexOf('With scenario') !== -1, 'Goal Projections shows a With-scenario line once a goal exists');
})();

// ---------------------------------------------------------------------
// 4. Net Worth snapshot: save today, re-save same day overwrites (no dupe),
//    a prior day's entry is kept separate.
// ---------------------------------------------------------------------
(function testNetWorthSnapshotSaveAndOverwrite() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/expenses.js');
  let el = mount(window);

  window.localStorage.setItem('arise-expenses-net-worth-v1', JSON.stringify({
    assets: [{ name: 'Savings', value: 50000 }],
    liabilities: [{ name: 'Loan', value: 20000 }]
  }));
  const yesterday = iso(1);
  window.localStorage.setItem('arise-expenses-networth-history-v1', JSON.stringify([
    { date: yesterday, value: 10000 }
  ]));
  el.innerHTML = '';
  window.__mountExpenses(el);

  const btn = el.querySelector('[data-action="save-nw-snapshot"]');
  assert(btn.textContent.indexOf('Save Today') !== -1, 'Button reads "Save Today\'s Snapshot" before today has an entry');
  btn.click();

  let history = JSON.parse(window.localStorage.getItem('arise-expenses-networth-history-v1'));
  assert(history.length === 2, 'First save-today appends a new entry (yesterday + today)');
  assert(history[1].value === 30000, 'New snapshot value = assets(50000) - liabilities(20000) = 30000');

  // Re-save same day: should overwrite, not duplicate
  const btn2 = el.querySelector('[data-action="save-nw-snapshot"]');
  assert(btn2.textContent.indexOf('Update Today') !== -1, 'Button switches to "Update Today\'s Snapshot" once today already has an entry');
  btn2.click();
  history = JSON.parse(window.localStorage.getItem('arise-expenses-networth-history-v1'));
  assert(history.length === 2, 'Re-saving the same day overwrites in place rather than duplicating');
})();

// ---------------------------------------------------------------------
// 5. Existing tabs unaffected - a full click-through of the nav still
//    finds every prior tab's landmark content.
// ---------------------------------------------------------------------
(function testExistingTabsUnaffected() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/expenses.js');
  const el = mount(window);
  const html = el.innerHTML;
  ['Overview', 'Trends &amp; Analysis', 'Budgets &amp; Goals', 'Semester', 'Investments',
    'IOUs', 'Loans', 'Payoff Plan', 'Transactions', 'Insights', 'Premium'
  ].forEach(function (label) {
    assert(html.indexOf(label) !== -1, 'Nav still contains "' + label + '" tab');
  });
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
