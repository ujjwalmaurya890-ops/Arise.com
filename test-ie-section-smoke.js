'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); }
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
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  window.eval(code);
}

// Panels are now lazy (perf fix): a tab's markup is only built once it's
// actually the active one. Tests that assert on a non-default tab's
// content need to switch to it first, exactly like a real user clicking
// the pill - this helper does that via the same click path wire() listens
// on, rather than reaching into nav internals.
function switchTab(win, root, id) {
  const btn = root.querySelector('[data-wnav-id="' + id + '"]');
  if (btn) btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  return btn;
}

function iso(daysAgoFromToday) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgoFromToday);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const dom = freshDom();
const window = dom.window;
loadScript(window, 'widget-nav.js');
loadScript(window, 'expenses.js');

// seed some income + expense entries spread across recent weeks/months
const entries = [
  { id: 'e1', title: 'Stipend', amount: 5000, type: 'income', incomeSource: 'stipend', category: 'Income', date: iso(2), paymentMethod: 'upi' },
  { id: 'e2', title: 'Groceries', amount: 1200, type: 'expense', category: 'Food', date: iso(3), paymentMethod: 'cash' },
  { id: 'e3', title: 'Freelance', amount: 3000, type: 'income', incomeSource: 'freelance', category: 'Income', date: iso(20), paymentMethod: 'upi' },
  { id: 'e4', title: 'Rent', amount: 4000, type: 'expense', category: 'Rent', date: iso(25), paymentMethod: 'netbanking' },
  { id: 'e5', title: 'Books', amount: 500, type: 'expense', category: 'Education', date: iso(40), paymentMethod: 'cash' }
];
window.localStorage.setItem('arise-expenses-v1', JSON.stringify(entries));

const el = window.document.getElementById('app');
window.__mountExpenses(el);

// nav should include the new tab
assert(el.innerHTML.indexOf('Weekly &amp; Monthly') !== -1 || el.innerHTML.indexOf('Weekly & Monthly') !== -1, 'Nav should show Weekly & Monthly tab label');
assert(el.innerHTML.indexOf('data-wnav-panel="weeklymonthly"') !== -1, 'Weekly & Monthly panel should exist');
// Panel content is lazy - switch to it before checking what's inside.
switchTab(window, el, 'weeklymonthly');
assert(el.innerHTML.indexOf('Income vs Expense') !== -1, 'Section heading should render');
assert(el.innerHTML.indexOf('exw-ie-section') !== -1, 'Section wrapper should render');
assert(el.innerHTML.indexOf('exw-ie-toggle-btn') !== -1, 'Weekly/Monthly toggle buttons should render');
assert(el.innerHTML.indexOf('exw-ie-bar-income') !== -1, 'Income bars should render (default monthly view has data)');
assert(el.innerHTML.indexOf('exw-ie-bar-expense') !== -1, 'Expense bars should render');
assert(el.innerHTML.indexOf('Net Savings') !== -1, 'Net Savings summary chip should render');
assert(el.innerHTML.indexOf('exw-ie-head-actions') !== -1, 'Header actions row (toggle + export button) should render');

// click "Weekly" toggle
const weeklyBtn = el.querySelector('[data-ie-view="weekly"]');
assert(!!weeklyBtn, 'Weekly toggle button should exist in DOM');
if (weeklyBtn) {
  weeklyBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(el.querySelector('[data-ie-view="weekly"]').className.indexOf('exw-ie-toggle-active') !== -1, 'Weekly button should become active after click');
  assert(el.innerHTML.indexOf('Last 8 Weeks') !== -1, 'Range label should switch to weekly wording');
}

// click back to "Monthly"
const monthlyBtn = el.querySelector('[data-ie-view="monthly"]');
if (monthlyBtn) {
  monthlyBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(el.innerHTML.indexOf('Last 6 Months') !== -1, 'Range label should switch back to monthly wording');
}

// view mode should persist to localStorage so a cold-started remount
// remembers it (verified properly below via a fresh window/container -
// this widget uses a single module-level `container` singleton, so
// re-mounting a second instance into the SAME window would rebind that
// singleton and break the first instance, which isn't a real usage pattern).
const weeklyBtn2 = el.querySelector('[data-ie-view="weekly"]');
if (weeklyBtn2) {
  weeklyBtn2.dispatchEvent(new window.Event('click', { bubbles: true }));
  const stored = window.localStorage.getItem('arise-expenses-ie-view-v1');
  assert(stored === 'weekly', 'Weekly view choice should be persisted to localStorage');
  // switch back to monthly for the rest of the assertions below
  const monthlyBtnAgain = el.querySelector('[data-ie-view="monthly"]');
  if (monthlyBtnAgain) monthlyBtnAgain.dispatchEvent(new window.Event('click', { bubbles: true }));
}

// true cold-start test: fresh window/localStorage seeded with 'weekly'
// BEFORE expenses.js is even evaluated, so this exercises readIeViewMode()'s
// actual cold read path (not just in-memory state carried over from above).
{
  const dom2 = freshDom();
  const window2 = dom2.window;
  window2.localStorage.setItem('arise-expenses-v1', JSON.stringify(entries));
  window2.localStorage.setItem('arise-expenses-ie-view-v1', 'weekly');
  loadScript(window2, 'widget-nav.js');
  loadScript(window2, 'expenses.js');
  const el3 = window2.document.getElementById('app');
  window2.__mountExpenses(el3);
  switchTab(window2, el3, 'weeklymonthly');
  const weeklyBtnColdStart = el3.querySelector('[data-ie-view="weekly"]');
  assert(!!weeklyBtnColdStart && weeklyBtnColdStart.className.indexOf('exw-ie-toggle-active') !== -1, 'Cold-started widget should read the persisted Weekly preference from localStorage');
}

// trend line (latest vs previous period) and weekly-budget comparison strip
{
  const dom3 = freshDom();
  const window3 = dom3.window;
  const trendEntries = [
    { id: 't1', title: 'Stipend', amount: 4000, type: 'income', incomeSource: 'stipend', category: 'Income', date: iso(5), paymentMethod: 'upi' },
    { id: 't2', title: 'Stipend', amount: 2000, type: 'income', incomeSource: 'stipend', category: 'Income', date: iso(35), paymentMethod: 'upi' },
    { id: 't3', title: 'Rent', amount: 1000, type: 'expense', category: 'Rent', date: iso(6), paymentMethod: 'upi' },
    { id: 't4', title: 'Rent', amount: 500, type: 'expense', category: 'Rent', date: iso(36), paymentMethod: 'upi' }
  ];
  window3.localStorage.setItem('arise-expenses-v1', JSON.stringify(trendEntries));
  window3.localStorage.setItem('arise-expenses-weekly-budget-v1', JSON.stringify({ weekly: 2000 }));
  loadScript(window3, 'widget-nav.js');
  loadScript(window3, 'expenses.js');
  const el4 = window3.document.getElementById('app');
  window3.__mountExpenses(el4);
  switchTab(window3, el4, 'weeklymonthly');
  assert(el4.innerHTML.indexOf('exw-ie-trend-line') !== -1, 'A month-over-month trend line should render when there is a previous period to compare against');
  assert(el4.innerHTML.indexOf('exw-ie-trend-up') !== -1 || el4.innerHTML.indexOf('exw-ie-trend-down') !== -1, 'Trend line should include an up/down colored delta');
  const weeklyBtn3 = el4.querySelector('[data-ie-view="weekly"]');
  if (weeklyBtn3) {
    weeklyBtn3.dispatchEvent(new window3.Event('click', { bubbles: true }));
    assert(el4.innerHTML.indexOf('This Week\u2019s Budget') !== -1, 'Weekly view with a weekly budget set should show a This Week\'s Budget strip');
  }
}

// PDF modal: new checkboxes should exist. The export button lives in the
// Transactions tab, so switch there first (panels are lazy - see above).
switchTab(window, el, 'transactions');
const openPdfBtn = el.querySelector('[data-action="open-pdf-export"]');
assert(!!openPdfBtn, 'Export PDF button should exist');
if (openPdfBtn) {
  openPdfBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const modal = window.document.getElementById('exw-pdf-modal');
  assert(!!modal, 'PDF modal should be created');
  if (modal) {
    assert(!!modal.querySelector('#exw-pdf-inc-ietrend'), 'PDF modal should have Weekly/Monthly trend checkbox');
    assert(!!modal.querySelector('#exw-pdf-inc-highlights'), 'PDF modal should have Key highlights checkbox');
    assert(!!modal.querySelector('#exw-pdf-inc-srcchart'), 'PDF modal should have Income source breakdown checkbox');
    assert(!!modal.querySelector('#exw-pdf-copy-summary'), 'PDF modal should have Copy Summary button');
    assert(!!modal.querySelector('#exw-pdf-download-html'), 'PDF modal should have Download Report button');

    // "Copy Summary" - stub navigator.clipboard and click it
    let copiedText = null;
    window.navigator.clipboard = { writeText: function (t) { copiedText = t; return Promise.resolve(); } };
    modal.querySelector('#exw-pdf-copy-summary').dispatchEvent(new window.Event('click', { bubbles: true }));
    Promise.resolve().then(function () {
      assert(typeof copiedText === 'string' && copiedText.indexOf('KEY HIGHLIGHTS') !== -1, 'Copy Summary should write a bullet-point text summary to the clipboard');
      const msgEl = modal.querySelector('#exw-pdf-share-msg');
      assert(!!msgEl && msgEl.getAttribute('data-tone') === 'success', 'Copy Summary should show a success message');

      // "Download Report" - stub URL.createObjectURL / anchor click to avoid jsdom Blob issues
      let downloadedName = null;
      window.URL.createObjectURL = function () { return 'blob:stub'; };
      window.URL.revokeObjectURL = function () {};
      const realCreateElement = window.document.createElement.bind(window.document);
      window.document.createElement = function (tag) {
        const node = realCreateElement(tag);
        if (tag === 'a') {
          node.click = function () { downloadedName = node.download; };
        }
        return node;
      };
      modal.querySelector('#exw-pdf-download-html').dispatchEvent(new window.Event('click', { bubbles: true }));
      assert(typeof downloadedName === 'string' && downloadedName.indexOf('expense-report-') === 0, 'Download Report should trigger an anchor download with the expected filename');

      console.log('\n' + pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    });
  } else {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }
} else {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
