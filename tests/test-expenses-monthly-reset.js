'use strict';
// Tests for the Expense Tracker's automatic monthly transition + permanent
// month-wise history (v2.5):
//   - the widget always opens on the real current local calendar month,
//   - when the local month rolls over (open tab, hidden tab, refocus, cold
//     start after days/weeks away) the view follows the new month by itself,
//   - historical transactions are never deleted, re-dated, duplicated or
//     re-IDed - a new month is empty because no record falls in its range,
//   - the month selector (prev / next / picker / "This month") drives the
//     month summary, category / payment / income breakdowns, budget strip and
//     transaction list, and historical months stay reachable.
//
// Same mount contract as the other test-*.js files in this repo:
// src/widget-nav.js + src/expenses.js are evaluated inside jsdom and the
// widget is mounted through window.__mountExpenses. Time is frozen by
// overriding window.Date *before* src/expenses.js is evaluated so month
// detection is deterministic, and the frozen clock can be moved forward to
// simulate a live rollover without a page refresh.
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
  const code = fs.readFileSync(path.join(path.resolve(__dirname, '..'), file), 'utf8');
  window.eval(code);
}

// Freezes `new Date()` / `Date.now()` at iso+'T12:00:00Z' (noon, so no
// timezone rollover edge case) for code evaluated afterwards. `clock.set()`
// moves the frozen "now" forward, exactly like a real calendar day passing.
function freezeClock(window, iso) {
  const RealDate = window.Date;
  let nowMs = new RealDate(iso + 'T12:00:00Z').getTime();
  function FakeDate() {
    if (arguments.length === 0) return new RealDate(nowMs);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = function () { return nowMs; };
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;
  return {
    set: function (nextIso) { nowMs = new RealDate(nextIso + 'T12:00:00Z').getTime(); }
  };
}

function seed(window, list) {
  window.localStorage.setItem('arise-expenses-v1', JSON.stringify(list));
}
function stored(window) {
  return JSON.parse(window.localStorage.getItem('arise-expenses-v1') || '[]');
}

// Boots a widget instance. `opts.beforeScripts` runs after the frozen clock is
// installed but before src/expenses.js is evaluated - that's how the module's
// cold-start state (it reads exw-month-filter once at load) is exercised.
function boot(iso, opts) {
  opts = opts || {};
  const dom = freshDom();
  const window = dom.window;
  const clock = freezeClock(window, iso);
  if (opts.seed) seed(window, opts.seed);
  if (opts.storage) {
    Object.keys(opts.storage).forEach(function (k) {
      if (opts.storage[k] === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, opts.storage[k]);
    });
  }
  if (opts.beforeScripts) opts.beforeScripts(window);
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/expenses.js');
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);
  return { dom: dom, window: window, el: el, clock: clock };
}

function tab(ctx, id) {
  const btn = ctx.el.querySelector('[data-wnav-id="' + id + '"]');
  if (btn) btn.dispatchEvent(new ctx.window.Event('click', { bubbles: true }));
  return btn;
}
function rows(el) {
  return Array.prototype.map.call(el.querySelectorAll('.exw-row-title'), function (n) { return n.textContent; });
}
function selectedMonth(el) {
  const sel = el.querySelector('[data-role="month-select"]');
  return sel ? sel.value : null;
}
function optionValues(el) {
  return Array.prototype.map.call(el.querySelectorAll('[data-role="month-select"] option'), function (o) { return o.value; });
}
// The month "Summary" block on the Overview tab (title ends with "Summary").
function monthSummary(el) {
  const titles = Array.prototype.slice.call(el.querySelectorAll('.exw-block-title'));
  for (let i = 0; i < titles.length; i++) {
    if (/Summary$/.test(titles[i].textContent.trim())) return titles[i].parentNode.textContent;
  }
  return '';
}
function blockTitle(el, needle) {
  const titles = Array.prototype.slice.call(el.querySelectorAll('.exw-block-title'));
  for (let i = 0; i < titles.length; i++) {
    if (titles[i].textContent.indexOf(needle) !== -1) return titles[i].textContent;
  }
  return '';
}
function fire(ctx, node, type) {
  node.dispatchEvent(new ctx.window.Event(type, { bubbles: true, cancelable: true }));
}
function selectMonth(ctx, monthId) {
  const sel = ctx.el.querySelector('[data-role="month-select"]');
  sel.value = monthId;
  fire(ctx, sel, 'change');
}

// Tests 17 runs an asynchronous CSV import; finish() only exits once every
// pending async block has reported. Synchronous suites finish immediately.
var pendingAsync = 0;
function finish() {
  if (pendingAsync > 0) return;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const OCT_TX = [
  { id: 'oct-1', type: 'expense', title: 'October groceries', amount: 1200, category: 'Food', date: '2026-10-05', paymentMethod: 'upi', note: 'keep me' },
  { id: 'oct-2', type: 'income', title: 'October stipend', amount: 5000, category: 'Income', incomeSource: 'stipend', date: '2026-10-01', paymentMethod: 'upi' },
  { id: 'oct-3', type: 'expense', title: 'October rent', amount: 800, category: 'Rent', date: '2026-10-31', paymentMethod: 'netbanking' }
];

// ---------------------------------------------------------------------
// 1. Tonight it is October; at midnight the widget shows a fresh November
//    (no manual refresh). October totals disappear from the CURRENT-month
//    view, November reads zero, and every October record survives untouched.
// ---------------------------------------------------------------------
(function testLiveMonthTransitionWhileOpen() {
  const ctx = boot('2026-10-31', { seed: OCT_TX });
  const before = JSON.stringify(stored(ctx.window));

  assert(selectedMonth(ctx.el) === '2026-10', 'mounts on the current month (2026-10), got ' + selectedMonth(ctx.el));
  assert(monthSummary(ctx.el).indexOf('October 2026') !== -1, 'summary is labelled with the current month');
  assert(monthSummary(ctx.el).indexOf('\u20b95,000') !== -1 && monthSummary(ctx.el).indexOf('\u20b92,000') !== -1,
    'October income (5,000) and expense (2,000) are shown for the current month: ' + monthSummary(ctx.el));
  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 3, 'October transaction list shows all three October records');

  // Midnight passes: same open page, no reload.
  ctx.clock.set('2026-11-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));

  assert(selectedMonth(ctx.el) === '2026-11', 'window focus after midnight auto-selects the new month (2026-11), got ' + selectedMonth(ctx.el));
  tab(ctx, 'overview');
  assert(monthSummary(ctx.el).indexOf('November 2026') !== -1, 'summary relabels to November 2026');
  assert(monthSummary(ctx.el).indexOf('Income\u20b90') !== -1, 'November income total is zero');
  assert(monthSummary(ctx.el).indexOf('Expense\u20b90') !== -1, 'November expense total is zero');
  assert(monthSummary(ctx.el).indexOf('Net Balance\u20b90') !== -1, 'November net balance is zero');
  assert(monthSummary(ctx.el).indexOf('October') === -1, 'no October figure leaks into the November summary');
  assert(ctx.el.innerHTML.indexOf('No expenses logged yet') !== -1,
    'the category breakdown is empty for a month with no expenses (it does not repeat October\'s chart)');
  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 0, 'November transaction list is empty');
  assert(ctx.el.querySelector('.exw-empty') && ctx.el.querySelector('.exw-empty').textContent.indexOf('November 2026') !== -1,
    'empty state names the empty month');
  assert(JSON.stringify(stored(ctx.window)) === before, 'no historical transaction was modified, moved or deleted by the transition');
  assert(stored(ctx.window).length === 3, 'all three October records are still stored');
  assert(ctx.window.localStorage.getItem('arise-expenses-month-seen-v1') === '2026-11',
    'last-seen month marker was advanced to 2026-11');
})();

// ---------------------------------------------------------------------
// 2. The same rollover detected through visibilitychange (tab was hidden
//    while the month flipped) and without touching anything else.
// ---------------------------------------------------------------------
(function testHiddenTabBecomingVisibleDetectsRollover() {
  const ctx = boot('2026-10-31', { seed: OCT_TX });
  // jsdom reports document.hidden = true by default; report visible instead.
  Object.defineProperty(ctx.window.document, 'hidden', { configurable: true, get: function () { return false; } });
  assert(selectedMonth(ctx.el) === '2026-10', 'starts in October');

  ctx.clock.set('2026-11-01');
  ctx.window.document.dispatchEvent(new ctx.window.Event('visibilitychange'));
  assert(selectedMonth(ctx.el) === '2026-11', 'visibilitychange re-check auto-selects November');
  assert(monthSummary(ctx.el).indexOf('November 2026') !== -1, 'November summary after visibilitychange');
  assert(stored(ctx.window).length === 3, 'October records untouched by visibilitychange path');

  // pageshow (bfcache restore) is covered by the same lightweight check.
  ctx.clock.set('2026-12-01');
  ctx.window.dispatchEvent(new ctx.window.Event('pageshow'));
  assert(selectedMonth(ctx.el) === '2026-12', 'pageshow re-check auto-selects December');
  assert(stored(ctx.window).length === 3, 'October records untouched after December rollover');
})();

// ---------------------------------------------------------------------
// 3. Reopening the site in a new month: a stale saved month filter from
//    last month must not pin the widget to the old month, and the older
//    records must remain fully accessible through the selector.
// ---------------------------------------------------------------------
(function testReopenAfterMonthTransition() {
  const ctx = boot('2026-11-02', {
    seed: OCT_TX,
    storage: { 'exw-month-filter': '2026-10', 'arise-expenses-month-seen-v1': '2026-10' }
  });
  assert(selectedMonth(ctx.el) === '2026-11', 'reopening in November ignores the stale October filter, got ' + selectedMonth(ctx.el));
  assert(ctx.window.localStorage.getItem('exw-month-filter') === null, 'stale month filter was cleared (not the transactions)');
  assert(stored(ctx.window).length === 3 && stored(ctx.window)[0].id === 'oct-1', 'October records still stored byte-for-byte');

  selectMonth(ctx, '2026-10');
  assert(selectedMonth(ctx.el) === '2026-10', 'October is still reachable');
  assert(monthSummary(ctx.el).indexOf('October 2026') !== -1 && monthSummary(ctx.el).indexOf('\u20b95,000') !== -1,
    'selecting October restores October totals: ' + monthSummary(ctx.el));
  assert(ctx.window.localStorage.getItem('exw-month-filter') === '2026-10', 'an explicit historical selection is remembered');

  // ... and an *intentional* historical selection survives a remount in the
  // same month (it is only reset when the calendar month actually changes).
  ctx.el.innerHTML = '';
  ctx.window.__mountExpenses(ctx.el);
  assert(selectedMonth(ctx.el) === '2026-10', 'historical selection is preserved across remounts within the same month');

  // ... but not across a real rollover.
  ctx.clock.set('2026-12-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  assert(selectedMonth(ctx.el) === '2026-12', 'the next real rollover returns to the new current month');
  assert(stored(ctx.window).length === 3, 'no data lost across the rollover');
})();

// ---------------------------------------------------------------------
// 4. December -> January year boundary, and year-aware month navigation.
// ---------------------------------------------------------------------
(function testYearBoundaryTransition() {
  const dec = [
    { id: 'dec-1', type: 'expense', title: 'December mess bill', amount: 900, category: 'Food', date: '2026-12-31' },
    { id: 'dec-2', type: 'expense', title: 'December books', amount: 600, category: 'Books & Courses', date: '2026-12-01' }
  ];
  const ctx = boot('2026-12-31', { seed: dec });
  assert(selectedMonth(ctx.el) === '2026-12', 'starts in December 2026');

  ctx.clock.set('2027-01-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  assert(selectedMonth(ctx.el) === '2027-01', 'January 1 2027 auto-selects 2027-01, got ' + selectedMonth(ctx.el));
  assert(monthSummary(ctx.el).indexOf('January 2027') !== -1, 'summary says January 2027 (year is part of the label)');
  assert(monthSummary(ctx.el).indexOf('Expense\u20b90') !== -1, 'January starts at zero');
  const opts = optionValues(ctx.el);
  assert(opts.indexOf('2027-01') !== -1 && opts.indexOf('2026-12') !== -1, 'selector distinguishes 2027-01 from 2026-12: ' + opts.join(','));
  assert(opts.indexOf('2026-01') === -1, 'selector does not offer a bogus 2026-01 (only months with data + current)');

  // Previous-month button walks back across the year boundary in one step.
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-12', 'prev from January 2027 lands on December 2026');
  assert(monthSummary(ctx.el).indexOf('December 2026') !== -1, 'December 2026 summary restored');
  assert(monthSummary(ctx.el).indexOf('\u20b91,500') !== -1, 'December expense total (900+600=1,500) restored');
  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 2, 'December transaction list is back');

  // Forward again, then "This month".
  fire(ctx, ctx.el.querySelector('[data-action="month-next"]'), 'click');
  assert(selectedMonth(ctx.el) === '2027-01', 'next from December 2026 returns to January 2027');
  assert(ctx.el.querySelector('[data-action="month-next"]').disabled === true, 'next is disabled on the current month');
  assert(ctx.el.querySelector('[data-action="month-current"]').disabled === true, '"This month" is disabled while already current');
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  fire(ctx, ctx.el.querySelector('[data-action="month-current"]'), 'click');
  assert(selectedMonth(ctx.el) === '2027-01', '"This month" jumps straight back to the current month');
  assert(stored(ctx.window).length === 2, 'navigation never changes stored records');
})();

// ---------------------------------------------------------------------
// 5. Historical month access when BOTH months have data, and switching
//    back and forth never rewrites a record.
// ---------------------------------------------------------------------
(function testHistoricalMonthAccess() {
  const both = OCT_TX.concat([
    { id: 'nov-1', type: 'expense', title: 'November canteen', amount: 250, category: 'Food', date: '2026-11-04' },
    { id: 'nov-2', type: 'income', title: 'November freelance', amount: 1500, category: 'Income', incomeSource: 'freelance', date: '2026-11-10' }
  ]);
  const ctx = boot('2026-11-15', { seed: both });
  const before = JSON.stringify(stored(ctx.window));

  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 2 && rows(ctx.el).indexOf('November canteen') !== -1 && rows(ctx.el).indexOf('November freelance') !== -1,
    'November view lists only the two November rows: ' + rows(ctx.el).join('|'));

  selectMonth(ctx, '2026-10');
  assert(rows(ctx.el).length === 3, 'October view lists exactly the three October rows: ' + rows(ctx.el).join('|'));
  assert(rows(ctx.el).indexOf('October groceries') !== -1, 'October rows are present: ' + rows(ctx.el).join('|'));
  assert(rows(ctx.el).indexOf('November canteen') === -1, 'November rows do not leak into the October view');

  selectMonth(ctx, '2026-11');
  assert(rows(ctx.el).length === 2 && rows(ctx.el).indexOf('October rent') === -1, 'switching back to November lists only November rows');
  assert(JSON.stringify(stored(ctx.window)) === before, 'switching months never modifies stored transaction records');

  // A month with no transactions at all, reached by walking back with the
  // month navigator (September sits before the first October record).
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-10', 'prev from November reaches October');
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-09', 'prev from October reaches the empty September');
  assert(rows(ctx.el).length === 0, 'empty month shows no rows');
  assert(ctx.el.querySelector('.exw-empty') && ctx.el.querySelector('.exw-empty').textContent.indexOf('September 2026') !== -1,
    'empty month shows a clear empty state naming that month');
  tab(ctx, 'overview');
  assert(monthSummary(ctx.el).indexOf('September 2026') !== -1 && monthSummary(ctx.el).indexOf('Expense\u20b90') !== -1,
    'empty month totals are zero, not another month numbers: ' + monthSummary(ctx.el));
  tab(ctx, 'transactions');
  assert(JSON.stringify(stored(ctx.window)) === before, 'viewing an empty month never creates fake transactions');
  assert(ctx.el.querySelector('[data-role="month-select"]').value === '2026-09', 'selector stays functional on an empty month');
})();

// ---------------------------------------------------------------------
// 6. Historical data integrity across a transition: ids, dates, amounts,
//    categories, notes and payment methods are byte-identical before/after.
// ---------------------------------------------------------------------
(function testHistoricalDataIntegrity() {
  const rich = [
    { id: 'i-1', type: 'expense', title: 'Groceries', amount: 1200.5, category: 'Food', date: '2026-10-05', paymentMethod: 'upi', tags: ['weekly'], note: 'keep me', createdAt: '2026-10-05T10:00:00.000Z' },
    { id: 'i-2', type: 'income', title: 'Stipend', amount: 5000, category: 'Income', incomeSource: 'stipend', date: '2026-10-01', paymentMethod: 'netbanking' },
    { id: 'i-3', type: 'expense', title: 'Rent', amount: 800, category: 'Rent', date: '2026-09-30', paymentMethod: 'cash' },
    { id: 'i-4', type: 'expense', title: 'Books', amount: 450, category: 'Books & Courses', date: '2026-10-31', paymentMethod: 'card' }
  ];
  const ctx = boot('2026-10-31', { seed: rich });
  const before = JSON.stringify(stored(ctx.window));

  ctx.clock.set('2026-11-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  selectMonth(ctx, '2026-09');
  selectMonth(ctx, '2026-10');
  selectMonth(ctx, '2026-11');
  ctx.clock.set('2027-01-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));

  const after = JSON.stringify(stored(ctx.window));
  assert(after === before, 'the stored transaction array is byte-identical after two transitions and three month switches');
  const ids = stored(ctx.window).map(function (t) { return t.id; });
  assert(new Set(ids).size === ids.length, 'no transaction was duplicated');
  assert(ids.join(',') === 'i-1,i-2,i-3,i-4', 'original ids and order are unchanged');
  const first = stored(ctx.window)[0];
  assert(first.date === '2026-10-05' && first.amount === 1200.5 && first.category === 'Food' &&
    first.note === 'keep me' && first.paymentMethod === 'upi', 'dates, amounts, categories, notes and payment methods are untouched');
})();

// ---------------------------------------------------------------------
// 7. Existing add / edit / delete / search / sort / filter behaviour.
// ---------------------------------------------------------------------
(function testExistingCrudAndFilteringStillWork() {
  const ctx = boot('2026-11-10', { seed: OCT_TX });
  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 0, 'November starts empty');

  // add (the date field defaults to the real today, so the entry lands in the
  // current month and the list shows it immediately)
  const form = ctx.el.querySelector('[data-role="add-form"]');
  form.querySelector('[name="title"]').value = 'Canteen lunch';
  form.querySelector('[name="amount"]').value = '150';
  form.querySelector('[name="category"]').value = 'Food';
  fire(ctx, form, 'submit');
  let all = stored(ctx.window);
  const added = all[all.length - 1];
  assert(all.length === 4, 'adding a transaction appends one record');
  assert(added.title === 'Canteen lunch' && added.amount === 150 && added.date === '2026-11-10',
    'the new transaction keeps its real date and the entered amount');
  assert(rows(ctx.el).indexOf('Canteen lunch') !== -1, 'the new row is visible in the current-month list');

  // edit
  const newRow = ctx.el.querySelector('.exw-row[data-id="' + added.id + '"]');
  fire(ctx, newRow.querySelector('[data-action="edit"]'), 'click');
  const editForm = ctx.el.querySelector('[data-role="edit-form"]');
  assert(!!editForm, 'edit form opens');
  editForm.querySelector('[name="amount"]').value = '175';
  fire(ctx, editForm, 'submit');
  const edited = stored(ctx.window).filter(function (t) { return t.id === added.id; })[0];
  assert(edited && edited.amount === 175 && edited.id === added.id, 'editing updates the amount without changing the id');

  // search
  const search = ctx.el.querySelector('[data-role="tx-search"]');
  search.value = 'Canteen';
  fire(ctx, search, 'input');
  assert(rows(ctx.el).length === 1 && rows(ctx.el)[0] === 'Canteen lunch', 'search narrows the month list');
  search.value = '';
  fire(ctx, search, 'input');
  assert(rows(ctx.el).length === 1, 'clearing the search restores the month list');

  // type filter
  fire(ctx, ctx.el.querySelector('[data-filter="income"]'), 'click');
  assert(rows(ctx.el).length === 0, 'type filter (Income) hides the November expense');
  fire(ctx, ctx.el.querySelector('[data-filter="all"]'), 'click');
  assert(rows(ctx.el).length === 1, 'type filter (All) restores it');

  // sort
  selectMonth(ctx, '2026-10');
  fire(ctx, ctx.el.querySelector('[data-sort="amount-asc"]'), 'click');
  assert(rows(ctx.el)[0] === 'October rent', 'sorting by amount asc puts the smallest October expense first: ' + rows(ctx.el).join('|'));

  // delete
  const victim = ctx.el.querySelector('.exw-row[data-id="oct-3"]');
  fire(ctx, victim.querySelector('[data-action="delete"]'), 'click');
  assert(stored(ctx.window).length === 3 && !stored(ctx.window).some(function (t) { return t.id === 'oct-3'; }),
    'delete removes only the chosen record');
  assert(stored(ctx.window).some(function (t) { return t.id === 'oct-1'; }) && stored(ctx.window).some(function (t) { return t.id === 'oct-2'; }),
    'delete leaves the other historical records alone');
})();

// ---------------------------------------------------------------------
// 8. Adding while browsing a historical month: the record keeps a real
//    date, it is never silently back-dated into the viewed month, and the
//    view follows the entry so it can't "disappear".
// ---------------------------------------------------------------------
(function testAddWhileViewingHistoricalMonth() {
  const ctx = boot('2026-11-10', { seed: OCT_TX });
  selectMonth(ctx, '2026-10');
  tab(ctx, 'transactions');
  assert(rows(ctx.el).length === 3, 'October view is active with its three records');

  const form = ctx.el.querySelector('[data-role="add-form"]');
  assert(form.querySelector('[name="date"]').value === '2026-11-10', 'the add form always defaults to the real today, never a fabricated past date');
  form.querySelector('[name="title"]').value = 'Late fee';
  form.querySelector('[name="amount"]').value = '300';
  fire(ctx, form, 'submit');

  const all = stored(ctx.window);
  const added = all[all.length - 1];
  assert(added.date === '2026-11-10', 'the added record keeps today\'s real date (2026-11-10)');
  assert(selectedMonth(ctx.el) === '2026-11', 'the view follows the new entry to its month so it is not lost');
  assert(rows(ctx.el).indexOf('Late fee') !== -1, 'the new November row is visible after the add');
  assert(stored(ctx.window).filter(function (t) { return t.id.indexOf('oct-') === 0; }).length === 3,
    'the three October records are untouched by the add');
})();

// ---------------------------------------------------------------------
// 9. Repeated (un)mounting: no duplicate listeners, no duplicate recurring
//    transactions, no repeated resets.
// ---------------------------------------------------------------------
(function testRepeatedInitializationIsIdempotent() {
  const ctx = boot('2026-11-05', { seed: OCT_TX });

  // Double-mounting the same container must not double-bind the month nav.
  ctx.window.__mountExpenses(ctx.el);
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-10', 'one prev click moves exactly one month even after a second mount, got ' + selectedMonth(ctx.el));

  // mount/unmount cycles, then remount.
  for (let i = 0; i < 3; i++) {
    ctx.window.__unmountExpenses(ctx.el);
    assert(ctx.el.innerHTML === '', 'unmount clears the container (cycle ' + i + ')');
    ctx.window.__mountExpenses(ctx.el);
  }
  assert(selectedMonth(ctx.el) === '2026-10', 'remounting keeps the intentionally selected month within the same calendar month');
  fire(ctx, ctx.el.querySelector('[data-action="month-current"]'), 'click');
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-10', 'after 4 mounts one prev click still moves exactly one month');

  // Recurring templates must not be generated twice by repeated mounts.
  ctx.window.localStorage.setItem('arise-expenses-recurring-v1', JSON.stringify([
    { id: 'rec-1', title: 'Hostel rent', amount: 4000, type: 'expense', category: 'Rent', dayOfMonth: 1, active: true, createdAt: '2026-08-01T00:00:00.000Z', lastGeneratedPeriod: '2026-10' }
  ]));
  ctx.window.__mountExpenses(ctx.el);
  ctx.window.__mountExpenses(ctx.el);
  ctx.window.__mountExpenses(ctx.el);
  const generated = stored(ctx.window).filter(function (t) { return t.recurringId === 'rec-1'; });
  assert(generated.length === 1, 'a recurring template generates exactly one November entry across repeated mounts, got ' + generated.length);
  assert(generated[0] && generated[0].date === '2026-11-01', 'the generated recurring entry is dated inside November');
  assert(stored(ctx.window).length === OCT_TX.length + 1, 'repeated mounts never duplicate stored transactions');
})();

// ---------------------------------------------------------------------
// 10. Date boundaries, leap years and local-calendar assignment.
// ---------------------------------------------------------------------
(function testDateBoundariesAndLeapYear() {
  const boundary = [
    { id: 'b-oct-last', type: 'expense', title: 'Oct last day', amount: 10, category: 'Other', date: '2026-10-31' },
    { id: 'b-nov-first', type: 'expense', title: 'Nov first day', amount: 20, category: 'Other', date: '2026-11-01' },
    { id: 'b-nov-last', type: 'expense', title: 'Nov last day', amount: 30, category: 'Other', date: '2026-11-30' },
    { id: 'b-dec-first', type: 'expense', title: 'Dec first day', amount: 40, category: 'Other', date: '2026-12-01' },
    { id: 'b-feb28', type: 'expense', title: 'Feb 28 2028', amount: 50, category: 'Other', date: '2028-02-28' },
    { id: 'b-feb29', type: 'expense', title: 'Feb 29 2028', amount: 60, category: 'Other', date: '2028-02-29' },
    { id: 'b-mar1', type: 'expense', title: 'Mar 1 2028', amount: 70, category: 'Other', date: '2028-03-01' }
  ];
  const ctx = boot('2026-11-15', { seed: boundary });
  tab(ctx, 'transactions');
  assert(rows(ctx.el).join('|') === 'Nov last day|Nov first day', 'only November entries (1st and 30th) appear in November: ' + rows(ctx.el).join('|'));

  selectMonth(ctx, '2026-10');
  assert(rows(ctx.el).join('|') === 'Oct last day', 'a 31st-of-October record stays in October (no UTC shift into November)');
  selectMonth(ctx, '2026-12');
  assert(rows(ctx.el).join('|') === 'Dec first day', 'a 1st-of-December record stays in December');

  ctx.clock.set('2028-02-29');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  assert(selectedMonth(ctx.el) === '2028-02', 'leap-day rollover selects 2028-02');
  assert(rows(ctx.el).join('|') === 'Feb 29 2028|Feb 28 2028', 'both Feb 28 and the leap day Feb 29 2028 belong to February: ' + rows(ctx.el).join('|'));
  selectMonth(ctx, '2028-03');
  assert(rows(ctx.el).join('|') === 'Mar 1 2028', 'March 2028 starts on the 1st with only its own record');

  // Feb 2027 is not a leap year - nobody can be assigned a 29th.
  assert(optionValues(ctx.el).indexOf('2028-02') !== -1, 'the leap month is offered by the selector');
})();

// ---------------------------------------------------------------------
// 11. Budgets and long-term settings survive a month transition (they are
//     not month-specific data and must never be reset by the rollover).
// ---------------------------------------------------------------------
(function testBudgetsSurviveRollover() {
  const ctx = boot('2026-10-31', {
    seed: OCT_TX,
    storage: {
      'arise-expenses-monthly-budget-v1': JSON.stringify(6000),
      'arise-expenses-budgets-v1': JSON.stringify({ Food: 1500, Rent: 900 }),
      'arise-expenses-weekly-budget-v1': JSON.stringify({ monthly: 6000, weekly: 1500 })
    }
  });
  ctx.clock.set('2026-11-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));

  assert(ctx.window.localStorage.getItem('arise-expenses-monthly-budget-v1') === JSON.stringify(6000),
    'monthly budget setting is not erased by the new month');
  assert(ctx.window.localStorage.getItem('arise-expenses-budgets-v1') === JSON.stringify({ Food: 1500, Rent: 900 }),
    'per-category budgets are not erased');
  assert(ctx.window.localStorage.getItem('arise-expenses-weekly-budget-v1') === JSON.stringify({ monthly: 6000, weekly: 1500 }),
    'weekly budget settings are not erased');
  assert(ctx.el.innerHTML.indexOf('6,000') !== -1, 'the configured monthly budget is still shown in the budget strip');
  assert(monthSummary(ctx.el).indexOf('Expense\u20b90') !== -1, 'budget usage starts from zero spend in the new month');
})();

// ---------------------------------------------------------------------
// 12. Malformed / partial storage never destroys data and never breaks the
//     month logic (no migration is performed by this feature).
// ---------------------------------------------------------------------
(function testMalformedStorageIsHarmless() {
  const dom = freshDom();
  const window = dom.window;
  freezeClock(window, '2026-11-01');
  window.localStorage.setItem('arise-expenses-v1', '{not json');
  window.localStorage.setItem('exw-month-filter', 'garbage');
  window.localStorage.setItem('arise-expenses-month-seen-v1', 'garbage');
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/expenses.js');
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);
  assert(selectedMonth(el) === '2026-11', 'an invalid stored month filter falls back to the current month');
  assert(window.localStorage.getItem('arise-expenses-v1') === '{not json', 'corrupt transaction storage is left untouched (not overwritten or cleared)');
  assert(window.localStorage.getItem('exw-month-filter') === null, 'the invalid month filter value is dropped, nothing else');
  assert(el.innerHTML.indexOf('November 2026') !== -1, 'the widget still renders the current month');
})();


// ---------------------------------------------------------------------
// 13. The month is re-validated on EVERY render that follows changed data
//     (storage-watch refresh), not only on mount/focus/visibility/timer.
// ---------------------------------------------------------------------
(function testRolloverOnDataChangeRender() {
  const ctx = boot('2026-10-31', {
    seed: OCT_TX,
    beforeScripts: function (w) {
      w.__ARISE_STORAGE_WATCH_BUS__ = {
        watch: function (key, cb) { w.__exwWatch = { key: key, cb: cb }; }
      };
    }
  });
  assert(ctx.window.__exwWatch && ctx.window.__exwWatch.key === 'arise-expenses-v1',
    'the widget subscribes to the transaction store for live data changes');
  assert(selectedMonth(ctx.el) === '2026-10', 'starts on 2026-10');

  const before = JSON.stringify(stored(ctx.window));
  ctx.clock.set('2026-11-01');
  ctx.window.__exwWatch.cb();          // data-change render only - no focus/pageshow event

  assert(selectedMonth(ctx.el) === '2026-11', 'a data-change render AFTER midnight selects the new month, got ' + selectedMonth(ctx.el));
  assert(monthSummary(ctx.el).indexOf('November 2026') !== -1, 'the render is labelled November 2026');
  assert(monthSummary(ctx.el).indexOf('Income\u20b90') !== -1 && monthSummary(ctx.el).indexOf('Expense\u20b90') !== -1,
    'the new month starts at zero on a data-change render: ' + monthSummary(ctx.el));
  assert(JSON.stringify(stored(ctx.window)) === before, 'no historical record is touched by this render');
})();

// ---------------------------------------------------------------------
// 14. Budget configuration is global, but its USAGE is computed from the
//     selected month's expenses - overall monthly budget, per-category
//     budgets, and the Income-vs-Expense monthly budget strip.
// ---------------------------------------------------------------------
const BUDGET_TX = [
  { id: 'b-oct-food', type: 'expense', title: 'October food', amount: 1000, category: 'Food', date: '2026-10-05', paymentMethod: 'upi' },
  { id: 'b-nov-food', type: 'expense', title: 'November food', amount: 400, category: 'Food', date: '2026-11-03', paymentMethod: 'upi' },
  { id: 'b-nov-rent', type: 'expense', title: 'November rent', amount: 150, category: 'Rent', date: '2026-11-04', paymentMethod: 'netbanking' }
];
(function testBudgetUsageFollowsSelectedMonth() {
  const ctx = boot('2026-11-15', {
    seed: BUDGET_TX,
    storage: {
      'arise-expenses-budgets-v1': JSON.stringify({ Food: 1500 }),
      'arise-expenses-monthly-budget-v1': JSON.stringify(5000)
    }
  });
  const budgetCard = function () {
    const node = ctx.el.querySelector('.exw-mb-section');
    return node ? node.textContent.replace(/\s+/g, ' ') : '';
  };
  assert(budgetCard().indexOf('Total Spent\u20b9550') !== -1 && budgetCard().indexOf('Remaining\u20b94,450') !== -1,
    'the overall monthly budget card uses the selected month (November) expenses: ' + budgetCard());

  tab(ctx, 'budgets');
  const catBudgets = function () {
    const node = ctx.el.querySelector('.exw-budgets');
    return node ? node.textContent.replace(/\s+/g, ' ') : '';
  };
  assert(catBudgets().indexOf('November food') === -1 && catBudgets().indexOf('\u20b9400 / \u20b91,500') !== -1,
    'per-category budget usage is November spend (400) against the saved 1,500 limit: ' + catBudgets());
  assert(catBudgets().indexOf('(Nov 26)') !== -1, 'the budget block is labelled with the selected month');

  tab(ctx, 'weeklymonthly');
  const strip = function () {
    const node = ctx.el.querySelector('.exw-ie-budget-strip');
    return node ? node.textContent.replace(/\s+/g, ' ') : '';
  };
  assert(strip().indexOf('November 2026 Budget') !== -1 && strip().indexOf('\u20b9550 / \u20b95,000') !== -1,
    'the monthly budget strip shows November usage against the same monthly cap: ' + strip());

  selectMonth(ctx, '2026-10');
  assert(strip().indexOf('October 2026 Budget') !== -1 && strip().indexOf('\u20b91,000 / \u20b95,000') !== -1,
    'switching to October recomputes the same budget against October spend: ' + strip());

  tab(ctx, 'budgets');
  assert(catBudgets().indexOf('\u20b91,000 / \u20b91,500') !== -1,
    'per-category usage switches to October too: ' + catBudgets());
  tab(ctx, 'overview');
  assert(budgetCard().indexOf('Total Spent\u20b91,000') !== -1 && budgetCard().indexOf('Remaining\u20b94,000') !== -1,
    'the overall monthly budget card follows the historical month: ' + budgetCard());

  assert(ctx.window.localStorage.getItem('arise-expenses-monthly-budget-v1') === JSON.stringify(5000) &&
    ctx.window.localStorage.getItem('arise-expenses-budgets-v1') === JSON.stringify({ Food: 1500 }),
    'the saved budget configuration itself is never rewritten by month navigation');
})();

// ---------------------------------------------------------------------
// 15. Every current-month chart/breakdown is month-scoped, and month
//     navigation updates the totals and the charts together.
// ---------------------------------------------------------------------
const CHART_TX = [
  { id: 'c-oct-food', type: 'expense', title: 'October food', amount: 1000, category: 'Food', date: '2026-10-05', paymentMethod: 'upi' },
  { id: 'c-oct-pay', type: 'income', title: 'October stipend', amount: 5000, category: 'Income', incomeSource: 'stipend', date: '2026-10-01', paymentMethod: 'upi' },
  { id: 'c-nov-food', type: 'expense', title: 'November food', amount: 400, category: 'Food', date: '2026-11-03', paymentMethod: 'upi' },
  { id: 'c-nov-rent', type: 'expense', title: 'November rent', amount: 150, category: 'Rent', date: '2026-11-04', paymentMethod: 'netbanking' },
  { id: 'c-nov-pay', type: 'income', title: 'November stipend', amount: 2000, category: 'Income', incomeSource: 'stipend', date: '2026-11-01', paymentMethod: 'upi' }
];
function chartTotal(el, needle) {
  const charts = Array.prototype.slice.call(el.querySelectorAll('.exw-chart'));
  for (let i = 0; i < charts.length; i++) {
    const title = charts[i].querySelector('.exw-block-title');
    if (title && title.textContent.indexOf(needle) !== -1) {
      const total = charts[i].querySelector('.exw-donut-total');
      return total ? total.textContent : '(no donut)';
    }
  }
  return '(chart not found)';
}
(function testChartsAreMonthScoped() {
  const ctx = boot('2026-11-15', { seed: CHART_TX });
  assert(chartTotal(ctx.el, 'Spending by Category') === '\u20b9550', 'November category chart totals only November spend, got ' + chartTotal(ctx.el, 'Spending by Category'));
  assert(chartTotal(ctx.el, 'Payment Method Breakdown') === '\u20b9550', 'November payment breakdown totals only November spend, got ' + chartTotal(ctx.el, 'Payment Method Breakdown'));
  assert(chartTotal(ctx.el, 'Income Sources') === '\u20b92,000', 'November income chart totals only November income, got ' + chartTotal(ctx.el, 'Income Sources'));

  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-10', 'prev moves to October');
  assert(chartTotal(ctx.el, 'Spending by Category') === '\u20b91,000', 'October category chart shows October spend, got ' + chartTotal(ctx.el, 'Spending by Category'));
  assert(chartTotal(ctx.el, 'Income Sources') === '\u20b95,000', 'October income chart shows October income, got ' + chartTotal(ctx.el, 'Income Sources'));
  assert(monthSummary(ctx.el).indexOf('Income\u20b95,000') !== -1 && monthSummary(ctx.el).indexOf('Expense\u20b91,000') !== -1 &&
    monthSummary(ctx.el).indexOf('Net Balance\u20b94,000') !== -1, 'October summary totals are restored: ' + monthSummary(ctx.el));

  fire(ctx, ctx.el.querySelector('[data-action="month-next"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-11', 'next returns to November');
  assert(chartTotal(ctx.el, 'Spending by Category') === '\u20b9550', 'November chart is restored');
  assert(ctx.el.querySelector('[data-action="month-next"]').disabled === true, 'next is disabled on the current month');
  fire(ctx, ctx.el.querySelector('[data-action="month-prev"]'), 'click');
  fire(ctx, ctx.el.querySelector('[data-action="month-current"]'), 'click');
  assert(selectedMonth(ctx.el) === '2026-11', '"This month" returns to the current month');
})();

// ---------------------------------------------------------------------
// 16. A recurring template generates exactly one entry per month across a
//     live rollover; focus/remount never duplicates it.
// ---------------------------------------------------------------------
(function testRecurringAcrossRollover() {
  const template = [{
    id: 'rec-live', title: 'Hostel rent', amount: 4000, type: 'expense', category: 'Rent',
    dayOfMonth: 1, active: true, createdAt: '2026-07-01T00:00:00.000Z', lastGeneratedPeriod: '2026-09'
  }];
  const ctx = boot('2026-10-31', {
    seed: OCT_TX,
    storage: { 'arise-expenses-recurring-v1': JSON.stringify(template) }
  });
  const generated = function () {
    return stored(ctx.window).filter(function (t) { return t.recurringId === 'rec-live'; });
  };
  assert(generated().length === 1 && generated()[0].date === '2026-10-01',
    'the pending October occurrence is generated once on mount, got ' + JSON.stringify(generated()));

  ctx.clock.set('2026-11-01');
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  assert(generated().length === 1, 'a focus-driven rollover does not generate anything by itself (startup generation only)');

  ctx.window.__mountExpenses(ctx.el);
  ctx.window.__mountExpenses(ctx.el);
  ctx.window.dispatchEvent(new ctx.window.Event('focus'));
  ctx.window.__mountExpenses(ctx.el);

  const rowsAfter = generated();
  assert(rowsAfter.length === 2, 'exactly one November occurrence is generated across repeated mounts, got ' + rowsAfter.length);
  assert(rowsAfter.map(function (t) { return t.date; }).sort().join('|') === '2026-10-01|2026-11-01',
    'the recurring entries are dated in their own months: ' + rowsAfter.map(function (t) { return t.date; }).join('|'));
  assert(stored(ctx.window).filter(function (t) { return t.id.indexOf('oct-') === 0; }).length === 3,
    'the three seeded October records are untouched');
  const tmpl = JSON.parse(ctx.window.localStorage.getItem('arise-expenses-recurring-v1'))[0];
  assert(tmpl.lastGeneratedPeriod === '2026-11', 'the template watermark advances to November, got ' + tmpl.lastGeneratedPeriod);
})();

// ---------------------------------------------------------------------
// 17. Backup / export / import contracts: export never mutates data, CSV
//     import keeps history and files rows under their real months, and the
//     account backup schema still includes the transaction store.
// ---------------------------------------------------------------------
(function testExportImportAndBackupContract() {
  const schema = require('../src/cloud/storage-schema.js');
  const required = [
    'arise-expenses-v1', 'arise-expenses-budgets-v1', 'arise-expenses-monthly-budget-v1',
    'arise-expenses-recurring-v1', 'arise-expenses-month-seen-v1', 'arise-expenses-goals-v1',
    'arise-expenses-loans-v1', 'arise-expenses-investments-v1', 'arise-expenses-networth-history-v1',
    'arise-expenses-iou-v1', 'arise-expenses-weekly-budget-v1'
  ];
  const missing = required.filter(function (k) { return !schema.isLocalKey(k); });
  assert(missing.length === 0, 'the account backup/sync allowlist still covers every expense store; missing: ' + missing.join(', '));

  const ctx = boot('2026-11-15', { seed: OCT_TX });
  ctx.window.alert = function () {};
  tab(ctx, 'transactions');
  const snapshot = function () {
    const out = {};
    for (let i = 0; i < ctx.window.localStorage.length; i++) {
      const k = ctx.window.localStorage.key(i);
      out[k] = ctx.window.localStorage.getItem(k);
    }
    return JSON.stringify(out, Object.keys(out).sort());
  };
  const before = snapshot();
  assert(ctx.el.querySelector('[data-action="export-json"]') && ctx.el.querySelector('[data-action="export-csv"]'),
    'the JSON and CSV export controls still exist');
  fire(ctx, ctx.el.querySelector('[data-action="export-json"]'), 'click');
  fire(ctx, ctx.el.querySelector('[data-action="export-csv"]'), 'click');
  assert(snapshot() === before, 'exporting does not modify any stored record');

  const input = ctx.el.querySelector('[data-role="import-csv"]');
  assert(input && input.type === 'file', 'the CSV import control still exists');
  const csv = 'id,title,amount,type,category,date,paymentMethod\n' +
    'csv-oct,Imported October,250,expense,Food,2026-10-20,upi\n' +
    'csv-nov,Imported November,125,expense,Food,2026-11-02,upi\n';
  const file = new ctx.window.File([csv], 'import.csv', { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  pendingAsync++;
  fire(ctx, input, 'change');

  let tries = 0;
  const timer = setInterval(function () {
    const list = stored(ctx.window);
    if (list.length <= OCT_TX.length && tries < 150) { tries++; return; }
    clearInterval(timer);
    const imported = list.filter(function (t) { return String(t.id).indexOf('csv-') === 0; });
    assert(imported.length === 2, 'CSV import added both rows, got ' + imported.length);
    assert(imported.every(function (t) { return t.date === (t.id === 'csv-oct' ? '2026-10-20' : '2026-11-02'); }),
      'imported rows keep their real dates (no re-dating into the current month)');
    assert(OCT_TX.every(function (seed) {
      const found = list.filter(function (t) { return t.id === seed.id; })[0];
      return found && JSON.stringify(found) === JSON.stringify(seed);
    }), 'every previously stored record survives the import byte-for-byte');
    tab(ctx, 'overview');
    assert(monthSummary(ctx.el).indexOf('Expense\u20b9125') !== -1 && monthSummary(ctx.el).indexOf('Income\u20b90') !== -1,
      'November totals include only the November import (125), not the October rows: ' + monthSummary(ctx.el));
    tab(ctx, 'transactions');

    // Re-importing the same file must not duplicate rows (id-based de-dupe).
    const input2 = ctx.el.querySelector('[data-role="import-csv"]');
    Object.defineProperty(input2, 'files', { value: [file], configurable: true });
    fire(ctx, input2, 'change');
    setTimeout(function () {
      assert(stored(ctx.window).length === OCT_TX.length + 2, 're-importing the same CSV does not duplicate records, got ' + stored(ctx.window).length);
      assert(stored(ctx.window).filter(function (t) { return t.id.indexOf('oct-') === 0; }).length === 3,
        'the original history is still intact after re-import');
      pendingAsync--;
      finish();
    }, 400);
  }, 20);
})();

// ---------------------------------------------------------------------
// 18. Closing and reopening the browser: a fresh DOM hydrated from the same
//     localStorage lands on the current month, keeps history accessible and
//     does not re-date or duplicate anything.
// ---------------------------------------------------------------------
function dumpStorage(window) {
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    out[key] = window.localStorage.getItem(key);
  }
  return out;
}
function bootFromStorage(iso, entries) {
  const dom = freshDom();
  const window = dom.window;
  const clock = freezeClock(window, iso);
  Object.keys(entries).forEach(function (key) {
    if (entries[key] === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, entries[key]);
  });
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/expenses.js');
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);
  return { dom: dom, window: window, el: el, clock: clock };
}
(function testColdRestartAfterRollover() {
  const first = boot('2026-10-31', { seed: OCT_TX });
  first.clock.set('2026-11-01');
  first.window.dispatchEvent(new first.window.Event('focus'));
  assert(selectedMonth(first.el) === '2026-11', 'the open page moved to November before the restart');
  const saved = dumpStorage(first.window);
  first.window.__unmountExpenses(first.el);

  // Fresh window, same storage - the equivalent of closing the browser and
  // reopening the site weeks later.
  const second = bootFromStorage('2026-12-05', saved);
  assert(selectedMonth(second.el) === '2026-12', 'reopening in December lands on 2026-12, got ' + selectedMonth(second.el));
  assert(monthSummary(second.el).indexOf('December 2026') !== -1 &&
    monthSummary(second.el).indexOf('Income\u20b90') !== -1 &&
    monthSummary(second.el).indexOf('Expense\u20b90') !== -1,
    'December starts from zero after the restart: ' + monthSummary(second.el));
  tab(second, 'transactions');
  assert(rows(second.el).length === 0, 'December has no transactions after the restart');

  selectMonth(second, '2026-10');
  assert(rows(second.el).length === 3, 'the three October records are still there after closing/reopening');
  tab(second, 'overview');
  assert(monthSummary(second.el).indexOf('Income\u20b95,000') !== -1 && monthSummary(second.el).indexOf('Expense\u20b92,000') !== -1,
    'October historical totals are intact after the restart: ' + monthSummary(second.el));
  const after = stored(second.window);
  assert(after.length === OCT_TX.length, 'no transaction was duplicated by the restart, got ' + after.length);
  assert(OCT_TX.every(function (seed) {
    const found = after.filter(function (t) { return t.id === seed.id; })[0];
    return found && JSON.stringify(found) === JSON.stringify(seed);
  }), 'every October record is unchanged after the restart');
})();

finish();
