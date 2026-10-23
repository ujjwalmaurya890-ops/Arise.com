/*!
 * tests/test-daily-learning-tasks-v3.js — v3 feature tests.
 * Run: node scripts/_run-test.cjs tests/test-daily-learning-tasks-v3.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.error('  ✗ FAIL:', m); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'arise-daily-learning-tasks-v1';
const FILES = ['src/widget-shared-utils.js', 'src/daily-learning-tasks-widget.js'];

function makeDOM(seed) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => errs.push(String(e.message || e)));
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="arise-dlt-mount"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  FILES.forEach(f => { try { w.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8')); } catch (e) { errs.push(e.message); } });
  return { w, d: w.document, errs };
}
function store(w) { const r = w.localStorage.getItem(KEY); return r ? JSON.parse(r) : { tasks: [], archive: {}, streak: 0, streakDate: '', heatmap: {} }; }
function click(w, el) { el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function dblclick(w, el) { el && el.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true })); }
function addTask(w, d, text, priority, tag) {
  if (priority) click(w, d.querySelector('[data-priority="' + priority + '"]'));
  if (tag)      click(w, d.querySelector('[data-action="set-tag"][data-tag="' + tag + '"]'));
  const inp = d.getElementById('dlt-input');
  inp.value = text;
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  click(w, d.getElementById('dlt-add'));
}

(async function () {

  /* ── 1. parse & v3 mount ── */
  console.log('\n── 1. parse & v3 mount ──');
  let syntaxOk = true;
  try { new Function(fs.readFileSync(path.join(path.resolve(__dirname, ".."), 'src/daily-learning-tasks-widget.js'), 'utf8')); }
  catch (e) { syntaxOk = false; }
  ok(syntaxOk, 'v3 widget parses without syntax error');

  let { w, d, errs } = makeDOM();
  await sleep(200);
  ok(errs.length === 0, 'no jsdom errors on mount');
  ok(d.querySelector('.dlt-filter-row') !== null, 'filter tab row rendered');
  ok(d.querySelector('.dlt-hm-grid') !== null, 'heatmap grid rendered');
  ok(d.querySelectorAll('.dlt-filter-tab').length === 7, '7 filter tabs (All + 6 tags)');
  ok(d.querySelectorAll('[data-action="set-tag"]').length === 6, '6 tag buttons in meta row');
  ok(d.querySelectorAll('.dlt-hm-cell').length === 28, '28 heatmap cells');

  /* ── 2. tags ── */
  console.log('\n── 2. tags ──');
  addTask(w, d, 'DSA task', 'high', 'DSA');
  await sleep(30);
  let s = store(w);
  ok(s.tasks[0].tag === 'DSA', 'task stored with DSA tag');
  ok(s.tasks[0].pomodoroCount === 0, 'pomodoroCount defaults to 0');

  addTask(w, d, 'Dev task', 'medium', 'Dev');
  addTask(w, d, 'Interview task', 'low', 'Interview');
  await sleep(30);
  s = store(w);
  const tags = s.tasks.map(t => t.tag);
  ok(tags.includes('DSA') && tags.includes('Dev') && tags.includes('Interview'), 'all three tag types stored');

  /* ── 3. filter tabs ── */
  console.log('\n── 3. filter tabs ──');
  // filter by DSA
  const dsaTab = d.querySelector('[data-action="filter-tag"][data-tag="DSA"]');
  ok(dsaTab !== null, 'DSA filter tab exists');
  click(w, dsaTab);
  await sleep(30);
  const rows = d.querySelectorAll('[data-task-id]');
  ok(rows.length === 1, 'only 1 row shown when filtered to DSA');
  const shownText = rows[0].querySelector('.dlt-task-text');
  ok(shownText && shownText.textContent === 'DSA task', 'correct task shown in DSA filter');

  // filter back to All
  const allTab = d.querySelector('[data-action="filter-tag"][data-tag="All"]');
  click(w, allTab);
  await sleep(30);
  ok(d.querySelectorAll('[data-task-id]').length === 3, 'all 3 tasks shown after clearing filter');

  /* ── 4. filter tab active state ── */
  console.log('\n── 4. filter tab active state ──');
  const devTab = d.querySelector('[data-action="filter-tag"][data-tag="Dev"]');
  click(w, devTab);
  await sleep(30);
  // re-query after render (DOM replaced)
  const devTabFresh = d.querySelector('[data-action="filter-tag"][data-tag="Dev"]');
  ok(devTabFresh && devTabFresh.classList.contains('active'), 'Dev filter tab has active class');
  const allTabRef = d.querySelector('[data-action="filter-tag"][data-tag="All"]');
  ok(!allTabRef.classList.contains('active'), 'All tab loses active class');
  // restore to All
  click(w, allTabRef);
  await sleep(30);

  /* ── 5. tag icon shows in task row ── */
  console.log('\n── 5. tag chip in task row ──');
  const tagChips = d.querySelectorAll('.dlt-task-tag');
  ok(tagChips.length === 3, '3 tag chips rendered in task rows');
  const chipTexts = Array.from(tagChips).map(c => c.textContent);
  ok(chipTexts.some(t => t.includes('DSA')), 'DSA tag chip visible');
  ok(chipTexts.some(t => t.includes('Dev')), 'Dev tag chip visible');

  /* ── 6. heatmap updates on task completion ── */
  console.log('\n── 6. heatmap on completion ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'hm1', text: 'Heatmap task', createdAt: Date.now(), completedAt: null,
              priority: 'medium', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  click(w, d.querySelector('[data-action="toggle"]'));
  await sleep(30);
  s = store(w);
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  ok(s.heatmap[todayKey] === 1, 'heatmap entry created for today on completion');

  // Complete another task → heatmap count bumps
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'hm2', text: 'Second heatmap', createdAt: Date.now(), completedAt: null,
              priority: 'low', note: '', xpAwarded: false, tag: 'Dev', pomodoroCount: 0, order: 2 }],
    archive: {}, streak: 0, streakDate: '', heatmap: { [todayKey]: 1 },
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  click(w, d.querySelector('[data-action="toggle"]'));
  await sleep(30);
  s = store(w);
  ok(s.heatmap[todayKey] === 2, 'heatmap count increments on second completion');

  /* ── 7. heatmap prunes entries > 28 days ── */
  console.log('\n── 7. heatmap pruning ──');
  const oldDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const hmData = {
    tasks: [{ id: 'hm3', text: 'Old heatmap', createdAt: Date.now(), completedAt: null,
              priority: 'medium', note: '', xpAwarded: false, tag: 'Other', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: { [oldDate]: 5 },
  };
  w.localStorage.setItem(KEY, JSON.stringify(hmData));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  click(w, d.querySelector('[data-action="toggle"]'));
  await sleep(30);
  s = store(w);
  ok(s.heatmap[oldDate] === undefined, 'heatmap entry older than 28 days pruned');

  /* ── 8. pomodoro timer ── */
  console.log('\n── 8. pomodoro timer ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'p1', text: 'Pomo task', createdAt: Date.now(), completedAt: null,
              priority: 'high', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  const pomoBtn = d.querySelector('.pomo-btn');
  ok(pomoBtn !== null, 'pomodoro button rendered on task');
  ok(pomoBtn.textContent.includes('🍅'), 'pomo button shows tomato emoji');
  click(w, pomoBtn);
  await sleep(30);

  // Timer chip should appear
  const chip = d.querySelector('.dlt-pomo-chip');
  ok(chip !== null, 'pomodoro chip appears after starting timer');
  const timerText = d.querySelector('.dlt-pomo-time');
  ok(timerText !== null, 'timer countdown text present');
  ok(timerText.textContent === '25:00' || timerText.textContent.match(/^\d{2}:\d{2}$/), 'timer shows MM:SS format');

  // pause/resume
  const pauseBtn = d.querySelector('.dlt-pomo-pause');
  ok(pauseBtn !== null, 'pause button in chip');
  click(w, pauseBtn);
  await sleep(30);
  const pauseBtn2 = d.querySelector('.dlt-pomo-pause');
  ok(pauseBtn2 && (pauseBtn2.textContent === '▶' || pauseBtn2.textContent.includes('▶')), 'pause becomes resume icon');

  // stop
  const stopBtn = d.querySelector('.dlt-pomo-stop');
  ok(stopBtn !== null, 'stop button in chip');
  click(w, stopBtn);
  await sleep(30);
  ok(d.querySelector('.dlt-pomo-chip') === null, 'chip disappears after stop');

  /* ── 9. pomodoro completion increments pomodoroCount ── */
  console.log('\n── 9. pomodoro count ──');
  const api = w.__ARISE_DAILY_LEARNING_TASKS_API__;
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'pc1', text: 'Count task', createdAt: Date.now(), completedAt: null,
              priority: 'medium', note: '', xpAwarded: false, tag: 'Notes', pomodoroCount: 2, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  // Simulate pomodoro completion: start then call stopPomodoro(true)
  api.startPomodoro('pc1');
  await sleep(30);
  api.stopPomodoro(true);
  await sleep(30);
  s = store(w);
  // pomodoroCount should have incremented from 2 to 3
  const updatedTask = s.tasks.find(t => t.id === 'pc1');
  ok(updatedTask && updatedTask.pomodoroCount === 3, 'pomodoroCount incremented on pomodoro completion');

  // Pomo count badge shown
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const pomoBadge = d.querySelector('.dlt-task-pomo');
  ok(pomoBadge !== null, 'pomo count badge rendered for task with pomodoroCount > 0');
  ok(pomoBadge.textContent.includes('3'), 'pomo badge shows correct count');

  /* ── 10. suggestions from archive ── */
  console.log('\n── 10. smart suggestions ──');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [],
    archive: {
      [yesterday]: [
        { id: 'sug1', text: 'Repeat BST task', createdAt: Date.now() - 86400000, completedAt: null, priority: 'medium', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 1 },
        { id: 'sug2', text: 'Completed task',  createdAt: Date.now() - 86400000, completedAt: Date.now() - 86400000, priority: 'low', note: '', xpAwarded: true, tag: 'Dev', pomodoroCount: 0, order: 2 },
      ]
    },
    streak: 0, streakDate: '', heatmap: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const sugRow = d.querySelector('.dlt-suggestions');
  ok(sugRow !== null, 'suggestions row rendered when archive has incomplete tasks');
  const sugs = d.querySelectorAll('.dlt-sug');
  ok(sugs.length >= 1, 'at least 1 suggestion chip shown');
  ok(Array.from(sugs).some(s => s.textContent.includes('Repeat BST')), 'incomplete archive task suggested');
  // Completed task should NOT be suggested
  ok(!Array.from(sugs).some(s => s.textContent.includes('Completed task')), 'completed archive task not suggested');

  // Click suggestion → populates input
  click(w, sugs[0]);
  await sleep(20);
  const inp = d.getElementById('dlt-input');
  ok(inp && inp.value.length > 0, 'clicking suggestion populates input');

  /* ── 11. export CSV (data shape) ── */
  console.log('\n── 11. export CSV ──');
  // exportCSV is a public API — test that it runs without throwing
  let csvError = null;
  try {
    const testData = api.load();
    // Override URL.createObjectURL so it doesn't throw in jsdom
    w.URL.createObjectURL = () => 'blob:fake';
    w.URL.revokeObjectURL = () => {};
    api.exportCSV(testData);
  } catch (e) { csvError = e; }
  ok(csvError === null, 'exportCSV runs without throwing (csvError: ' + (csvError && csvError.message) + ')');

  /* ── 12. drag-to-reorder data ── */
  console.log('\n── 12. drag-to-reorder ──');
  // reset module filter state before this test
  api.resetFilter();
  const nowTs = Date.now();
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'dr1', text: 'Task A', createdAt: nowTs,     completedAt: null, priority: 'medium', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 0 },
      { id: 'dr2', text: 'Task B', createdAt: nowTs + 1, completedAt: null, priority: 'medium', note: '', xpAwarded: false, tag: 'Dev', pomodoroCount: 0, order: 1 },
      { id: 'dr3', text: 'Task C', createdAt: nowTs + 2, completedAt: null, priority: 'medium', note: '', xpAwarded: false, tag: 'Other', pomodoroCount: 0, order: 2 },
    ],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  // Verify drag handles rendered
  const handles = d.querySelectorAll('[data-action="drag-handle"]');
  ok(handles.length === 3, '3 drag handles rendered for 3 undone tasks');
  // Simulate a reorder directly (drag is mouse-event heavy in jsdom)
  let dData = api.load();
  ok(dData.tasks.length === 3, 'load() returns all 3 tasks for reorder test');
  if (dData.tasks.length >= 1) {
    const moved = dData.tasks.splice(0, 1)[0]; // move Task A to end
    dData.tasks.push(moved);
    dData.tasks.filter(Boolean).forEach((t, i) => { t.order = i; });
    api.save(dData);
    api.render();
    await sleep(30);
    dData = api.load();
    ok(dData.tasks[2].id === 'dr1', 'task order persisted after manual reorder');
  } else {
    ok(false, 'task order persisted after manual reorder (skipped — no tasks loaded)');
  }

  /* ── 13. v1/v2 → v3 migration ── */
  console.log('\n── 13. v1/v2 → v3 migration ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'old1', text: 'No tag', createdAt: Date.now(), completedAt: null, priority: 'high', note: 'a note', xpAwarded: false },
      { id: 'old2', text: 'No pomo', createdAt: Date.now(), completedAt: null },
    ],
    archive: {}, streak: 2, streakDate: new Date().toISOString().slice(0, 10),
  }));
  const migrated = api.load();
  ok(migrated.tasks.length === 2, 'both v1/v2 tasks survive migration');
  ok(migrated.tasks[0].tag === 'Other', 'missing tag defaults to Other');
  ok(migrated.tasks[0].pomodoroCount === 0, 'missing pomodoroCount defaults to 0');
  ok(typeof migrated.tasks[0].order === 'number', 'order field added on migration');
  ok(migrated.tasks[1].priority === 'medium', 'missing priority defaults to medium');
  ok(migrated.tasks[1].note === '', 'missing note defaults to empty string');
  ok(Array.isArray(migrated.tasks) && migrated.heatmap !== undefined, 'heatmap field present after migration');
  ok(migrated.streak === 2, 'streak preserved through migration');

  /* ── 14. TAGS exported on API ── */
  console.log('\n── 14. API.TAGS export ──');
  ok(Array.isArray(api.TAGS), 'API.TAGS is an array');
  ok(api.TAGS.includes('DSA'), 'TAGS includes DSA');
  ok(api.TAGS.includes('Interview'), 'TAGS includes Interview');
  ok(api.TAGS.length === 7, 'TAGS has 7 entries (All + 6)');

  /* ── 15. focus-mode class on shell ── */
  console.log('\n── 15. focus-mode class ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'fm1', text: 'Focus', createdAt: Date.now(), completedAt: null,
              priority: 'high', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  api.startPomodoro('fm1');
  api.render();
  await sleep(30);
  const shell = d.querySelector('.dlt-shell');
  ok(shell && shell.classList.contains('dlt-focus-active'), 'dlt-focus-active class on shell during pomodoro');
  api.stopPomodoro(false);
  api.render();
  await sleep(30);
  const shellAfter = d.querySelector('.dlt-shell');
  ok(shellAfter && !shellAfter.classList.contains('dlt-focus-active'), 'dlt-focus-active removed after pomodoro stops');

  /* ── 16. XSS in tag field ── */
  console.log('\n── 16. XSS escaping (tag) ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'xss3', text: 'Safe', createdAt: Date.now(), completedAt: null,
              priority: 'medium', note: '', xpAwarded: false, tag: '<script>bad()</script>', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  // migrateTask will default unknown tag to 'Other'
  const xssData = api.load();
  ok(xssData.tasks[0].tag === 'Other', 'invalid tag coerced to Other in migration (XSS sanitized)');

  /* ── 17. empty filter shows empty state ── */
  console.log('\n── 17. empty filter state ──');
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'ef1', text: 'Only DSA', createdAt: Date.now(), completedAt: null,
              priority: 'medium', note: '', xpAwarded: false, tag: 'DSA', pomodoroCount: 0, order: 1 }],
    archive: {}, streak: 0, streakDate: '', heatmap: {},
  }));
  api.render();
  await sleep(30);
  // Filter to Interview — no tasks
  const intTab = d.querySelector('[data-action="filter-tag"][data-tag="Interview"]');
  click(w, intTab);
  await sleep(30);
  const emptyDiv = d.querySelector('.dlt-empty');
  ok(emptyDiv !== null, 'empty state shown when filter has no matches');
  ok(emptyDiv.textContent.includes('Interview'), 'empty state mentions filtered tag name');

  /* ── summary ── */
  console.log('\n' + (failed === 0 ? '✅' : '❌') + ' ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed > 0 ? 1 : 0);
})();
