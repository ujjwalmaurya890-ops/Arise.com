'use strict';
// Perf fix: src/widget-nav.js's panelWrap() now accepts a function instead of
// a pre-built string, and only invokes it for the currently-active tab -
// inactive tabs are left as empty placeholders and get filled in on demand
// when the user switches to them. This test covers:
//   1. src/widget-nav.js in isolation (call counting, back-compat with plain
//      strings, tab-switch fill-in).
//   2. src/expenses.js and src/attendance-tracker-widget.js actually wired up to
//      use it - confirming the default tab renders real content, inactive
//      tabs are empty until visited, and switching tabs produces correct,
//      fresh content (not stale from an earlier render() call).
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
  dom.window.__ARISE_MUTATION_BUS__ = { subscribe: function () {} };
  return dom;
}

function loadScript(window, file) {
  window.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), file), 'utf8'));
}

function clickTab(win, root, id) {
  const btn = root.querySelector('[data-wnav-id="' + id + '"]');
  if (btn) btn.dispatchEvent(new win.Event('click', { bubbles: true }));
  return btn;
}

// ---------------------------------------------------------------------
// 1. src/widget-nav.js in isolation
// ---------------------------------------------------------------------
(function testLazyPanelCallCounts() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');

  const nav = window.AriseWidgetNav.create({
    sections: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  });

  let calls = { a: 0, b: 0, c: 0 };
  function render() {
    return nav.navHtml() +
      nav.panelWrap('a', function () { calls.a++; return '<p>A content</p>'; }) +
      nav.panelWrap('b', function () { calls.b++; return '<p>B content</p>'; }) +
      nav.panelWrap('c', function () { calls.c++; return '<p>C content</p>'; });
  }

  const dom2 = freshDom();
  const root = dom2.window.document.getElementById('app');
  root.innerHTML = render();
  nav.wire(root);

  assert(calls.a === 1 && calls.b === 0 && calls.c === 0,
    'Only the active (first/default) panel builder should run on initial render, got ' + JSON.stringify(calls));
  assert(root.querySelector('[data-wnav-panel="a"]').innerHTML.indexOf('A content') !== -1, 'Active panel has real content');
  assert(root.querySelector('[data-wnav-panel="b"]').innerHTML === '', 'Inactive panel b is left empty (not built)');
  assert(root.querySelector('[data-wnav-panel="b"]').hasAttribute('hidden'), 'Inactive panel b is hidden');

  // Simulate several unrelated re-renders (e.g. add/edit/delete actions)
  // while still on tab "a" - b and c should never get built.
  for (let i = 0; i < 5; i++) { root.innerHTML = render(); nav.wire(root); }
  assert(calls.a === 6 && calls.b === 0 && calls.c === 0,
    'Repeated renders while on tab a must not build b/c at all, got ' + JSON.stringify(calls));

  // Switch to tab b via the same click path a real user uses.
  clickTab(dom2.window, root, 'b');
  assert(calls.b === 1, 'Switching to tab b builds it exactly once, got ' + calls.b);
  assert(root.querySelector('[data-wnav-panel="b"]').innerHTML.indexOf('B content') !== -1, 'Tab b now has real content after switching to it');
  assert(!root.querySelector('[data-wnav-panel="b"]').hasAttribute('hidden'), 'Tab b is now visible');
  assert(root.querySelector('[data-wnav-panel="a"]').hasAttribute('hidden'), 'Tab a is now hidden');
  assert(calls.c === 0, 'Tab c still never built - only a and b have been visited');

  // A render() call while b is active should rebuild b (fresh data) but
  // still skip a and c.
  root.innerHTML = render(); nav.wire(root);
  assert(calls.a === 6 && calls.b === 2 && calls.c === 0,
    'render() while b is active rebuilds only b, got ' + JSON.stringify(calls));

  // Back-compat: a plain string still works exactly as before (always eager).
  const nav2 = window.AriseWidgetNav.create({ sections: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] });
  const html = nav2.navHtml() + nav2.panelWrap('x', '<p>eager x</p>') + nav2.panelWrap('y', '<p>eager y</p>');
  assert(html.indexOf('eager x') !== -1 && html.indexOf('eager y') !== -1,
    'String-based panelWrap stays eager for both panels (back-compat)');
})();

// ---------------------------------------------------------------------
// 2. src/expenses.js wired up: default tab has content, others don't until
//    visited, and switching preserves correct/fresh data.
// ---------------------------------------------------------------------
(function testExpensesLazyIntegration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/expenses.js');
  window.localStorage.setItem('arise-expenses-v1', JSON.stringify([
    { id: 'e1', type: 'expense', title: 'Snacks', amount: 250, category: 'Food', date: new Date().toISOString().slice(0, 10) }
  ]));
  const el = window.document.getElementById('app');
  window.__mountExpenses(el);

  assert(el.querySelector('[data-wnav-panel="overview"]').innerHTML.length > 0, 'Default Overview tab has content on mount');
  assert(el.querySelector('[data-wnav-panel="premium"]').innerHTML === '', 'Premium tab (not visited) is empty on mount');
  assert(el.querySelector('[data-wnav-panel="loans"]').innerHTML === '', 'Loans tab (not visited) is empty on mount');

  clickTab(window, el, 'loans');
  assert(el.querySelector('[data-wnav-panel="loans"]').innerHTML.length > 0, 'Loans tab has content after switching to it');
  assert(!el.querySelector('[data-wnav-panel="loans"]').hasAttribute('hidden'), 'Loans tab is visible after switching');
  assert(el.querySelector('[data-wnav-panel="overview"]').hasAttribute('hidden'), 'Overview tab is hidden after switching away');
})();

// ---------------------------------------------------------------------
// 3. src/attendance-tracker-widget.js wired up: same contract, plus data
//    added while on one tab is correctly reflected once another tab is
//    visited (proves lazy panels aren't showing stale/cached markup).
// ---------------------------------------------------------------------
(function testAttendanceLazyIntegration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/attendance-tracker-widget.js');
  const el = window.document.getElementById('app');
  window.__mountAttendanceTracker(el);

  assert(el.querySelector('[data-wnav-panel="overview"]').innerHTML.length > 0, 'Default Overview tab has content on mount');
  assert(el.querySelector('[data-wnav-panel="trends"]').innerHTML === '', 'Trends tab (not visited) is empty on mount');
  assert(el.querySelector('[data-wnav-panel="subjects"]').innerHTML === '', 'Subjects tab (not visited) is empty on mount');

  // Add a subject while on the (default) Overview tab.
  const addBtn = el.querySelector('[data-action="add-subject"]');
  assert(!!addBtn, 'Add Subject button exists on Overview tab');
  addBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  // Switch to Subjects & Archive - it was never built before, so this
  // exercises the on-demand fill path, and must reflect the just-added
  // subject (fresh data, not a stale empty snapshot from mount time).
  clickTab(window, el, 'subjects');
  const subjectsPanel = el.querySelector('[data-wnav-panel="subjects"]');
  assert(subjectsPanel.innerHTML.length > 0, 'Subjects tab has content after switching to it');
  assert(subjectsPanel.innerHTML.indexOf('New Subject') !== -1, 'Newly-added subject is reflected in Subjects tab on first visit');
  assert(!subjectsPanel.hasAttribute('hidden'), 'Subjects tab is visible after switching');
  assert(el.querySelector('[data-wnav-panel="overview"]').hasAttribute('hidden'), 'Overview tab is hidden after switching away');

  // Trends tab still untouched/empty (never visited).
  assert(el.querySelector('[data-wnav-panel="trends"]').innerHTML === '', 'Trends tab still empty - only Overview and Subjects have been visited');
})();

// ---------------------------------------------------------------------
// 4. src/cgpa-tracker-widget.js: the "semesters" tab's per-subject row
//    building was a pre-built variable (not a function call) before this
//    fix, so it needed real restructuring, not just wrapping - worth its
//    own check that semester/subject content still appears correctly.
// ---------------------------------------------------------------------
(function testCgpaLazyIntegration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');
  // Seed localStorage BEFORE the widget script loads - its state is read
  // once at script-eval time, not lazily on mount.
  window.localStorage.setItem('arise-cgpa-tracker-v1', JSON.stringify({
    semesters: [{ id: 's1', name: 'Semester 1', collapsed: false, subjects: [{ id: 'sub1', name: 'Maths', credits: 4, grade: 'A', status: 'passed' }] }]
  }));
  loadScript(window, 'src/cgpa-tracker-widget.js');
  const el = window.document.getElementById('app');
  window.__mountCGPATracker(el);

  assert(el.querySelector('[data-wnav-panel="semesters"]').innerHTML.indexOf('Maths') !== -1, 'Default Semesters tab shows the seeded subject');
  assert(el.querySelector('[data-wnav-panel="settings"]').innerHTML === '', 'Settings tab (not visited) is empty on mount');

  clickTab(window, el, 'settings');
  assert(el.querySelector('[data-wnav-panel="settings"]').innerHTML.length > 0, 'Settings tab has content after switching to it');
})();

// ---------------------------------------------------------------------
// 5. src/hackathon-tracker-widget.js: only "overview"/"hackathons" are lazy -
//    the 6 satellite embed-mount tabs stay eager (cheap placeholders,
//    laziness would only risk their mount points for no benefit).
// ---------------------------------------------------------------------
(function testHackathonLazyIntegration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');
  loadScript(window, 'src/hackathon-tracker-widget.js');
  window.localStorage.setItem('hackathonTrackerV1', JSON.stringify([
    { id: 'h1', name: 'HackNITR', organizer: 'NITR', date: '2026-01-16', result: 'Winner' }
  ]));
  const el = window.document.getElementById('app');
  window.__mountHackathonTracker(el);

  assert(el.querySelector('[data-wnav-panel="overview"]').innerHTML.length > 0, 'Default Overview tab has content on mount');
  assert(el.querySelector('[data-wnav-panel="hackathons"]').innerHTML === '', 'Hackathons tab (not visited) is empty on mount');
  // Embed-mount tabs stay eager on purpose - their placeholder divs exist
  // immediately so satellite scripts can find them, regardless of tab.
  assert(el.querySelector('[data-wnav-panel="pipeline"]').innerHTML.indexOf('data-embed="pipeline"') !== -1, 'Pipeline embed-mount placeholder exists eagerly (not lazy)');

  clickTab(window, el, 'hackathons');
  assert(el.querySelector('[data-wnav-panel="hackathons"]').innerHTML.indexOf('HackNITR') !== -1, 'Hackathons tab shows the seeded record after switching to it');
})();

// ---------------------------------------------------------------------
// 6. src/skills-timeline-widget.js: "skills" tab's filtered-view building was
//    a pre-built variable before this fix, same restructuring risk as cgpa.
// ---------------------------------------------------------------------
(function testSkillsTimelineLazyIntegration() {
  const dom = freshDom();
  const window = dom.window;
  loadScript(window, 'src/widget-nav.js');
  // Seed localStorage BEFORE the widget script loads (state read at eval-time).
  window.localStorage.setItem('arise-skills-timeline-v1', JSON.stringify({
    skills: [{ id: 'sk1', name: 'Docker', category: 'DevOps', year: new Date().getFullYear(), status: 'in-progress', progress: 40 }]
  }));
  loadScript(window, 'src/skills-timeline-widget.js');
  const el = window.document.getElementById('app');
  window.__mountSkillsTimeline(el);

  assert(el.querySelector('[data-wnav-panel="overview"]').innerHTML.length > 0, 'Default Overview tab has content on mount');
  assert(el.querySelector('[data-wnav-panel="skills"]').innerHTML === '', 'Skills tab (not visited) is empty on mount');

  clickTab(window, el, 'skills');
  assert(el.querySelector('[data-wnav-panel="skills"]').innerHTML.indexOf('Docker') !== -1, 'Skills tab shows the seeded skill after switching to it');
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
