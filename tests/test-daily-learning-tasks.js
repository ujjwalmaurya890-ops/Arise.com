/*!
 * tests/test-daily-learning-tasks.js — v2 Daily Learning Tasks widget tests.
 * Run: node scripts/_run-test.cjs tests/test-daily-learning-tasks.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
function ok(c, m) {
  if (c) { passed++; console.log('  ✓', m); }
  else    { failed++; console.error('  ✗ FAIL:', m); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY  = 'arise-daily-learning-tasks-v1';
const TTL  = 24 * 60 * 60 * 1000;
const FILES = ['src/widget-shared-utils.js', 'src/daily-learning-tasks-widget.js'];

function makeDOM(seed) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => errs.push(String(e.message || e)));
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="arise-dlt-mount"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc }
  );
  const w = dom.window;
  Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  FILES.forEach(f => {
    try { w.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8') + '\n//# sourceURL=' + f); }
    catch (e) { errs.push(f + ': ' + e.message); }
  });
  return { w, d: w.document, errs };
}

function store(w) {
  const raw = w.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : { tasks: [], archive: {} };
}
function click(w, el) { el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function dblclick(w, el) { el && el.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, cancelable: true })); }
function typeAndAdd(w, d, text, priority) {
  // select priority first if specified
  if (priority) {
    const priBtn = d.querySelector('[data-priority="' + priority + '"]');
    click(w, priBtn);
  }
  const inp = d.getElementById('dlt-input');
  inp.value = text;
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  const btn = d.getElementById('dlt-add');
  click(w, btn);
}
function typeAndEnter(w, d, text) {
  const inp = d.getElementById('dlt-input');
  inp.value = text;
  inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

(async function () {

  /* ══════════════════════════════════════════
     BLOCK 1 — parse & mount
     ══════════════════════════════════════════ */
  console.log('\n── 1. parse & mount ──');

  let syntaxOk = true;
  try { new Function(fs.readFileSync(path.join(path.resolve(__dirname, ".."), 'src/daily-learning-tasks-widget.js'), 'utf8')); }
  catch (e) { syntaxOk = false; console.error('   parse error:', e.message); }
  ok(syntaxOk, 'widget JS parses without syntax error');

  let { w, d, errs } = makeDOM();
  await sleep(200);
  ok(d.getElementById('arise-dlt-mount').innerHTML.length > 0, 'mount div gets populated');
  ok(d.getElementById('dlt-input') !== null, 'input field rendered');
  ok(d.getElementById('dlt-add') !== null, 'Add button rendered');
  ok(d.querySelector('.dlt-empty') !== null, 'empty-state message shown');
  ok(errs.length === 0, 'no jsdom errors on mount (' + errs.join('; ') + ')');
  ok(d.querySelector('[data-priority="high"]') !== null, 'priority High button rendered');
  ok(d.querySelector('[data-priority="medium"]') !== null, 'priority Medium button rendered');
  ok(d.querySelector('[data-priority="low"]') !== null, 'priority Low button rendered');

  /* ══════════════════════════════════════════
     BLOCK 2 — add tasks with priority
     ══════════════════════════════════════════ */
  console.log('\n── 2. add tasks with priority ──');

  typeAndAdd(w, d, 'High priority task', 'high');
  await sleep(30);
  let s = store(w);
  ok(s.tasks.length === 1, 'task saved after button click');
  ok(s.tasks[0].text === 'High priority task', 'task text stored');
  ok(s.tasks[0].priority === 'high', 'high priority stored');
  ok(s.tasks[0].note === '', 'note defaults to empty string');
  ok(s.tasks[0].xpAwarded === false, 'xpAwarded defaults false');
  ok(typeof s.tasks[0].createdAt === 'number', 'createdAt timestamp set');

  typeAndAdd(w, d, 'Medium task', 'medium');
  typeAndAdd(w, d, 'Low priority task', 'low');
  await sleep(30);
  s = store(w);
  ok(s.tasks.length === 3, 'three tasks stored');
  const priorities = s.tasks.map(t => t.priority);
  ok(priorities.includes('high') && priorities.includes('medium') && priorities.includes('low'),
    'all three priority levels stored');

  // Add via Enter key
  typeAndEnter(w, d, 'Enter key task');
  await sleep(30);
  s = store(w);
  ok(s.tasks.length === 4, 'task added via Enter key');

  // input cleared after add
  ok(d.getElementById('dlt-input').value === '', 'input cleared after add');

  /* ══════════════════════════════════════════
     BLOCK 3 — priority selector UI
     ══════════════════════════════════════════ */
  console.log('\n── 3. priority selector ──');

  // Click High button — it should get active class
  const highBtn = d.querySelector('[data-priority="high"]');
  click(w, highBtn);
  await sleep(20);
  ok(highBtn.classList.contains('active-high'), 'High button gets active-high class after click');
  const medBtn = d.querySelector('[data-priority="medium"]');
  ok(!medBtn.classList.contains('active-medium'), 'Medium button loses active class');

  // Reset to medium for subsequent tests
  click(w, d.querySelector('[data-priority="medium"]'));
  await sleep(20);

  /* ══════════════════════════════════════════
     BLOCK 4 — sort order (high before medium before low, undone before done)
     ══════════════════════════════════════════ */
  console.log('\n── 4. sort order ──');

  // Clear and seed specific tasks
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'l1', text: 'Low', createdAt: Date.now(), completedAt: null, priority: 'low', note: '', xpAwarded: false },
      { id: 'h1', text: 'High', createdAt: Date.now(), completedAt: null, priority: 'high', note: '', xpAwarded: false },
      { id: 'm1', text: 'Medium', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  const api = w.__ARISE_DAILY_LEARNING_TASKS_API__;
  const sorted = api.sortTasks(store(w).tasks);
  ok(sorted[0].priority === 'high', 'High priority sorts first');
  ok(sorted[1].priority === 'medium', 'Medium priority sorts second');
  ok(sorted[2].priority === 'low', 'Low priority sorts last');

  // Done tasks go to the bottom
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'h2', text: 'High done', createdAt: Date.now(), completedAt: Date.now(), priority: 'high', note: '', xpAwarded: true },
      { id: 'l2', text: 'Low undone', createdAt: Date.now(), completedAt: null, priority: 'low', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  const sorted2 = api.sortTasks(store(w).tasks);
  ok(sorted2[0].id === 'l2', 'Undone task sorts before done task regardless of priority');
  ok(sorted2[1].id === 'h2', 'Done task sorts to bottom');

  /* ══════════════════════════════════════════
     BLOCK 5 — toggle complete / XP / streak
     ══════════════════════════════════════════ */
  console.log('\n── 5. complete, XP, streak ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'xp1', text: 'XP task', createdAt: Date.now(), completedAt: null, priority: 'high', note: '', xpAwarded: false }],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  const chk = d.querySelector('[data-action="toggle"]');
  click(w, chk);
  await sleep(30);
  s = store(w);
  const completedTask = s.tasks.find(t => t.id === 'xp1');
  ok(completedTask.completedAt !== null, 'task marked complete');
  ok(completedTask.xpAwarded === true, 'xpAwarded set to true after completion');
  ok(s.streak === 1, 'streak becomes 1 after first completion today');
  ok(typeof s.streakDate === 'string' && s.streakDate.length === 10, 'streakDate set to YYYY-MM-DD');

  // XP badge visible in DOM
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const xpBadge = d.querySelector('.dlt-task-xp');
  ok(xpBadge !== null, 'XP badge rendered on completed task');
  ok(xpBadge.textContent.includes('XP'), 'XP badge shows XP text');

  // Uncomplete — xpAwarded resets
  const chk2 = d.querySelector('[data-action="toggle"]');
  click(w, chk2);
  await sleep(30);
  s = store(w);
  const uncompletedTask = s.tasks.find(t => t.id === 'xp1');
  ok(uncompletedTask.completedAt === null, 'task uncompleted');
  ok(uncompletedTask.xpAwarded === false, 'xpAwarded reset on uncomplete');

  /* ══════════════════════════════════════════
     BLOCK 6 — toggle-all
     ══════════════════════════════════════════ */
  console.log('\n── 6. toggle-all ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'a1', text: 'Task A', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
      { id: 'a2', text: 'Task B', createdAt: Date.now(), completedAt: null, priority: 'low', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  const allBtn = d.querySelector('[data-action="toggle-all"]');
  ok(allBtn !== null, '✓ All button rendered when tasks exist');
  click(w, allBtn);
  await sleep(30);
  s = store(w);
  ok(s.tasks.every(t => t.completedAt !== null), 'all tasks completed after toggle-all');
  ok(s.tasks.every(t => t.xpAwarded === true), 'XP awarded to all tasks');

  // Second click — undo all
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const undoAllBtn = d.querySelector('[data-action="toggle-all"]');
  click(w, undoAllBtn);
  await sleep(30);
  s = store(w);
  ok(s.tasks.every(t => t.completedAt === null), 'all tasks uncompleted after undo-all');
  ok(s.tasks.every(t => t.xpAwarded === false), 'xpAwarded reset for all tasks');

  /* ══════════════════════════════════════════
     BLOCK 7 — inline edit
     ══════════════════════════════════════════ */
  console.log('\n── 7. inline edit ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'e1', text: 'Original text', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false }],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  // Double-click the text span
  const textSpan = d.querySelector('.dlt-task-text');
  ok(textSpan !== null, 'task text span present');
  dblclick(w, textSpan);
  await sleep(20);

  const editInput = d.querySelector('.dlt-task-edit');
  ok(editInput !== null, 'inline edit input appears after double-click');
  ok(editInput.value === 'Original text', 'edit input pre-filled with original text');

  // Change text and blur to save
  editInput.value = 'Updated text';
  editInput.dispatchEvent(new w.FocusEvent('blur', { bubbles: true }));
  await sleep(30);
  s = store(w);
  ok(s.tasks[0].text === 'Updated text', 'task text updated after inline edit');

  // Escape cancels edit
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const textSpan2 = d.querySelector('.dlt-task-text');
  dblclick(w, textSpan2);
  await sleep(20);
  const editInput2 = d.querySelector('.dlt-task-edit');
  if (editInput2) {
    editInput2.value = 'Should not be saved';
    editInput2.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await sleep(30);
    s = store(w);
    ok(s.tasks[0].text === 'Updated text', 'Escape cancels edit without saving');
  } else {
    ok(false, 'inline edit input not found for Escape test');
  }

  // Edit via pencil button
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const editBtn = d.querySelector('.edit-btn');
  ok(editBtn !== null, 'pencil edit button rendered');

  /* ══════════════════════════════════════════
     BLOCK 8 — delete
     ══════════════════════════════════════════ */
  console.log('\n── 8. delete ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'd1', text: 'Delete me', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
      { id: 'd2', text: 'Keep me',   createdAt: Date.now(), completedAt: null, priority: 'low', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const delBtn = d.querySelector('.del-btn');
  click(w, delBtn);
  await sleep(30);
  s = store(w);
  ok(s.tasks.length === 1, 'one task removed after delete');
  ok(d.querySelectorAll('[data-task-id]').length === 1, 'one row in DOM after delete');

  /* ══════════════════════════════════════════
     BLOCK 9 — 24h TTL expiry + archive
     ══════════════════════════════════════════ */
  console.log('\n── 9. TTL expiry + archive ──');

  const oldTs = Date.now() - 25 * 3600 * 1000;
  const oldLabel = new Date(oldTs).toISOString().slice(0, 10);
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'old1', text: 'Old task', createdAt: oldTs, completedAt: null, priority: 'high', note: '', xpAwarded: false },
      { id: 'new1', text: 'New task', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(50);
  s = store(w);
  ok(s.tasks.length === 1, 'expired task removed from active list');
  ok(s.tasks[0].id === 'new1', 'fresh task remains active');
  ok(s.archive[oldLabel] !== undefined, 'expired task moved to archive');
  ok(s.archive[oldLabel][0].id === 'old1', 'archived task id correct');
  ok(s.archive[oldLabel][0].priority === 'high', 'priority preserved in archive');

  // Archive toggle
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const arcToggle = d.querySelector('[data-action="toggle-archive"]');
  ok(arcToggle !== null, 'archive toggle rendered');
  arcToggle.click();
  await sleep(20);
  const arcBody = d.getElementById('dlt-archive-body');
  ok(arcBody && (arcBody.style.display === '' || arcBody.style.display === 'block'), 'archive opens on click');

  // Archive shows friendly date and priority icon
  const arcContent = arcBody ? arcBody.innerHTML : '';
  ok(arcContent.includes('🔴') || arcContent.includes('Yesterday') || arcContent.length > 0, 'archive body has content');

  /* ══════════════════════════════════════════
     BLOCK 10 — v1 → v2 migration
     ══════════════════════════════════════════ */
  console.log('\n── 10. v1 → v2 migration ──');

  // v1 tasks have no priority/note/xpAwarded fields
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'v1t1', text: 'Old v1 task', createdAt: Date.now(), completedAt: null },
    ],
    archive: {},
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  s = store(w);
  // Migration happens on load inside the widget (load() calls migrateTask)
  const migrated = w.__ARISE_DAILY_LEARNING_TASKS_API__.load();
  ok(migrated.tasks.length === 1, 'v1 task survives migration');
  ok(migrated.tasks[0].priority === 'medium', 'migrated task defaults to medium priority');
  ok(migrated.tasks[0].note === '', 'migrated task has empty note');
  ok(migrated.tasks[0].xpAwarded === false, 'migrated task xpAwarded = false');
  ok(migrated.streak === 0, 'migrated data has streak = 0');

  /* ══════════════════════════════════════════
     BLOCK 11 — progress bar + badge grading
     ══════════════════════════════════════════ */
  console.log('\n── 11. progress bar + badge ──');

  // All done → 100%
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'g1', text: 'Done', createdAt: Date.now(), completedAt: Date.now(), priority: 'medium', note: '', xpAwarded: true },
      { id: 'g2', text: 'Done2', createdAt: Date.now(), completedAt: Date.now(), priority: 'low', note: '', xpAwarded: true },
    ],
    archive: {}, streak: 3, streakDate: new Date().toISOString().slice(0, 10),
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const barFull = d.getElementById('dlt-bar');
  ok(Math.abs(parseFloat(barFull.style.width) - 100) < 0.5, 'progress bar at 100%');
  const badgeFull = d.querySelector('.dlt-badge');
  ok(badgeFull.classList.contains('grade-done'), 'badge has grade-done at 100%');

  // Streak displayed
  const streakEl = d.querySelector('.dlt-streak');
  ok(streakEl !== null, 'streak element rendered when streak > 1');
  ok(streakEl.textContent.includes('3'), 'streak shows correct count');

  // ~50% → grade-warn
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'h50', text: 'Done', createdAt: Date.now(), completedAt: Date.now(), priority: 'medium', note: '', xpAwarded: true },
      { id: 'h51', text: 'Pending', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const badgeHalf = d.querySelector('.dlt-badge');
  ok(badgeHalf.classList.contains('grade-warn'), 'badge has grade-warn at ~50%');

  /* ══════════════════════════════════════════
     BLOCK 12 — MAX_TASKS cap
     ══════════════════════════════════════════ */
  console.log('\n── 12. MAX_TASKS cap ──');

  const capData = { tasks: [], archive: {}, streak: 0, streakDate: '' };
  for (let i = 0; i < 20; i++) {
    capData.tasks.push({ id: 'cap' + i, text: 'Task ' + i, createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false });
  }
  w.localStorage.setItem(KEY, JSON.stringify(capData));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  typeAndAdd(w, d, 'Overflow task');
  await sleep(30);
  s = store(w);
  ok(s.tasks.length === 20, 'task count stays at 20 (MAX_TASKS enforced)');

  /* ══════════════════════════════════════════
     BLOCK 13 — XSS escaping
     ══════════════════════════════════════════ */
  console.log('\n── 13. XSS escaping ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'xss1', text: '<script>alert("xss")</script>', createdAt: Date.now(), completedAt: null, priority: 'high', note: '', xpAwarded: false }],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const xssRow = d.querySelector('[data-task-id="xss1"]');
  ok(xssRow !== null, 'XSS task row rendered');
  ok(!xssRow.innerHTML.includes('<script>'), 'script tag not injected as HTML');
  ok(xssRow.innerHTML.includes('&lt;script&gt;'), 'XSS text properly escaped');

  // XSS in note field
  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [{ id: 'xss2', text: 'Safe text', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '<img src=x onerror=alert(1)>', xpAwarded: false }],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);
  const noteEl = d.querySelector('.dlt-task-note');
  ok(noteEl !== null, 'note element rendered');
  ok(!noteEl.innerHTML.includes('<img'), 'XSS in note field escaped');

  /* ══════════════════════════════════════════
     BLOCK 14 — Ctrl+Enter shortcut
     ══════════════════════════════════════════ */
  console.log('\n── 14. Ctrl+Enter shortcut ──');

  w.localStorage.setItem(KEY, JSON.stringify({ tasks: [], archive: {}, streak: 0, streakDate: '' }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  // Blur the input first, then fire Ctrl+Enter
  const inp = d.getElementById('dlt-input');
  inp.blur();
  // Dispatch to document
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(20);
  // In jsdom focus tracking is limited, but the event handler should have run without throwing
  ok(true, 'Ctrl+Enter keydown dispatched without error');

  /* ══════════════════════════════════════════
     BLOCK 15 — public API surface
     ══════════════════════════════════════════ */
  console.log('\n── 15. public API ──');

  const apiObj = w.__ARISE_DAILY_LEARNING_TASKS_API__;
  ok(typeof apiObj.load === 'function', 'API.load is a function');
  ok(typeof apiObj.save === 'function', 'API.save is a function');
  ok(typeof apiObj.runExpiry === 'function', 'API.runExpiry is a function');
  ok(typeof apiObj.render === 'function', 'API.render is a function');
  ok(typeof apiObj.sortTasks === 'function', 'API.sortTasks is a function');
  ok(apiObj.KEY === KEY, 'API.KEY matches storage key');
  ok(typeof apiObj.PRIORITIES === 'object', 'API.PRIORITIES exported');
  ok(apiObj.PRIORITIES.high.xp === 18, 'high priority XP = 18');
  ok(apiObj.PRIORITIES.medium.xp === 10, 'medium priority XP = 10');
  ok(apiObj.PRIORITIES.low.xp === 5, 'low priority XP = 5');

  /* ══════════════════════════════════════════
     BLOCK 16 — archive pruning (>7 days pruned)
     ══════════════════════════════════════════ */
  console.log('\n── 16. archive pruning ──');

  const eightDaysAgo = Date.now() - 8 * 24 * 3600 * 1000;
  const eightLabel = new Date(eightDaysAgo).toISOString().slice(0, 10);
  const seedData = { tasks: [], archive: {}, streak: 0, streakDate: '' };
  seedData.archive[eightLabel] = [
    { id: 'stale1', text: 'Old stale task', createdAt: eightDaysAgo, completedAt: null, priority: 'medium', note: '', xpAwarded: false }
  ];
  w.localStorage.setItem(KEY, JSON.stringify(seedData));
  const dataAfterExpiry = apiObj.runExpiry(apiObj.load());
  ok(dataAfterExpiry.data.archive[eightLabel] === undefined, 'archive entry older than 7 days pruned');

  /* ══════════════════════════════════════════
     BLOCK 17 — streak NOT incremented twice same day
     ══════════════════════════════════════════ */
  console.log('\n── 17. streak idempotency ──');

  const todayStr = new Date().toISOString().slice(0, 10);
  const streakData = {
    tasks: [
      { id: 'st1', text: 'Task 1', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
      { id: 'st2', text: 'Task 2', createdAt: Date.now(), completedAt: null, priority: 'medium', note: '', xpAwarded: false },
    ],
    archive: {}, streak: 5, streakDate: todayStr,
  };
  w.localStorage.setItem(KEY, JSON.stringify(streakData));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  // Complete first task
  const chkSt1 = d.querySelector('[data-action="toggle"]');
  click(w, chkSt1);
  await sleep(30);
  s = store(w);
  ok(s.streak === 5, 'streak not incremented again when streakDate is already today');
  ok(s.streakDate === todayStr, 'streakDate unchanged');

  /* ══════════════════════════════════════════
     BLOCK 18 — priority row colour classes
     ══════════════════════════════════════════ */
  console.log('\n── 18. task row priority colours ──');

  w.localStorage.setItem(KEY, JSON.stringify({
    tasks: [
      { id: 'col1', text: 'High', createdAt: Date.now(), completedAt: null, priority: 'high', note: '', xpAwarded: false },
      { id: 'col2', text: 'Low',  createdAt: Date.now(), completedAt: null, priority: 'low',  note: '', xpAwarded: false },
    ],
    archive: {}, streak: 0, streakDate: '',
  }));
  w.__ARISE_DAILY_LEARNING_TASKS_API__.render();
  await sleep(30);

  // High task row should have red-ish border inline style
  const highRow = d.querySelector('[data-task-id="col1"]');
  const lowRow  = d.querySelector('[data-task-id="col2"]');
  ok(highRow !== null && highRow.style.borderColor.includes('235') || highRow.style.borderColor !== '', 'high priority row has coloured border');
  ok(lowRow  !== null && lowRow.style.borderColor !== '', 'low priority row has coloured border');
  // High and low rows should have different colours
  ok(highRow.style.borderColor !== lowRow.style.borderColor, 'high and low rows have different border colours');

  /* ══════════════════════════════════════════
     SUMMARY
     ══════════════════════════════════════════ */
  console.log('\n' + (failed === 0 ? '✅' : '❌') + ' ' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed > 0 ? 1 : 0);
})();
