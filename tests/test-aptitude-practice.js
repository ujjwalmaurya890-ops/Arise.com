/*!
 * tests/test-aptitude-practice.js — Aptitude tracker (log, validation, analytics) and its Readiness integration.
 * Run: node scripts/_run-test.cjs tests/test-aptitude-practice.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.error('  ✗ FAIL:', m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILES = ['src/mutation-bus.js', 'src/widget-shared-utils.js', 'src/readiness-scoring-config.js', 'src/readiness-engine.js', 'src/aptitude-practice-widget.js'];

function page(seed) {
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="apt-practice"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  Object.keys(seed || {}).forEach((k) => w.localStorage.setItem(k, JSON.stringify(seed[k])));
  FILES.forEach((f) => w.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8') + '\n//# sourceURL=' + f));
  return { w, d: w.document, errors };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const store = (w, k) => JSON.parse(w.localStorage.getItem(k));
function fill(d, w, o) {
  const set = (k, v) => { const e = d.querySelector('[data-apt-f="' + k + '"]'); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); };
  if (o.section) set('section', o.section);
  if (o.topic) set('topic', o.topic);
  if (o.attempted != null) set('attempted', o.attempted);
  if (o.correct != null) set('correct', o.correct);
  if (o.time != null) set('time', o.time);
  if (o.date) set('date', o.date);
}
function log(w, d, o) { fill(d, w, o); click(w, d.querySelector('[data-apt-add]')); }
const msg = (d) => d.querySelector('[data-apt-msg]').textContent;
const ago = (n) => { const x = new Date(Date.now() - n * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

(async function () {
  console.log('\n── syntax + mount ──');
  ['src/aptitude-practice-widget.js', 'src/readiness-engine.js', 'src/features/placement-tracker/placement-calculations.js', 'src/dsa-mastery-premium-widget.js'].forEach((f) => { let g = true; try { new Function(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8')); } catch (e) { g = false; } ok(g, f + ' parses'); });
  let { w, d, errors } = page(); await sleep(500);
  ok(d.querySelectorAll('[data-apt-f]').length === 6 && !!d.querySelector('[data-apt-add]'), 'log form renders (6 fields + Add)');
  ok(/No sets logged yet/.test(d.getElementById('apt-practice').textContent) && errors.length === 0, 'empty state, no errors');
  ok(/\d+% of the mass-recruiter readiness profile/.test(d.getElementById('apt-practice').textContent), 'shows the aptitude weight from the readiness config');

  console.log('\n── logging + validation ──');
  log(w, d, { section: 'Quant', topic: 'Time & Work', attempted: 20, correct: 14, time: 25 });
  let st = store(w, 'arise-aptitude-log-v1');
  ok(st && st.sessions.length === 1 && st.sessions[0].correct === 14 && st.sessions[0].topic === 'Time & Work', 'valid set is stored');
  ok(/70%/.test(d.getElementById('apt-practice').textContent) && /75s/.test(d.getElementById('apt-practice').textContent), 'accuracy 70% and 75 sec/question are computed (25 min × 60 / 20 Q)');
  const before = st.sessions.length;
  log(w, d, { attempted: 10, correct: 12 }); ok(/can't be more than attempted/.test(msg(d)) && store(w, 'arise-aptitude-log-v1').sessions.length === before, 'correct > attempted is rejected');
  log(w, d, { attempted: 0, correct: 0 }); ok(/whole number from 1 to 200/.test(msg(d)), 'attempted = 0 rejected');
  log(w, d, { attempted: 5.5, correct: 2 }); ok(/whole number from 1 to 200/.test(msg(d)), 'decimal attempted rejected');
  log(w, d, { attempted: 10, correct: 5, time: -3 }); ok(/Time must be/.test(msg(d)), 'negative time rejected');
  const fut = new Date(Date.now() + 5 * 864e5); log(w, d, { attempted: 10, correct: 5, time: 5, date: fut.toISOString().slice(0, 10) });
  ok(/valid date/.test(msg(d)) && store(w, 'arise-aptitude-log-v1').sessions.length === before, 'future dates rejected');
  fill(d, w, { section: 'Verbal' });
  ok(Array.from(d.querySelector('[data-apt-f="topic"]').options).some((o) => o.value === 'Reading Comprehension') && !Array.from(d.querySelector('[data-apt-f="topic"]').options).some((o) => o.value === 'Time & Work'), 'changing section swaps the topic list');

  console.log('\n── analytics ──');
  ({ w, d } = page()); await sleep(400);
  log(w, d, { section: 'Quant', topic: 'Time & Work', attempted: 12, correct: 5, time: 20, date: ago(3) });
  log(w, d, { section: 'Quant', topic: 'Time & Work', attempted: 12, correct: 6, time: 20, date: ago(2) });
  log(w, d, { section: 'Logical', topic: 'Syllogisms', attempted: 10, correct: 9, time: 10, date: ago(20) });
  const txt = () => d.getElementById('apt-practice').textContent;
  ok(/Fix first/.test(txt()) && /Time & Work · 46% \(24 Q\)/.test(txt()), 'weak topic flagged: Time & Work 46% over 24 Q vs 75% target');
  ok(!/Syllogisms · 90%/.test(txt().split('Fix first')[1] || ''), 'a strong topic is not in the fix-first list');
  ok(/Going stale/.test(txt()) && /Syllogisms · 20d/.test(txt()), 'topic untouched for 14+ days is listed as going stale');
  ok(/Never practised/.test(txt()) && !/Never practised[^]*Time & Work/.test(txt().split('Never practised')[1].slice(0, 80)), 'never-practised list excludes topics you have logged');
  click(w, d.querySelector('[data-apt-target="-5"]')); click(w, d.querySelector('[data-apt-target="-5"]'));
  ok(store(w, 'arise-aptitude-log-v1').settings.targetAcc === 65, 'target accuracy stepper persists (65%)');
  ok(/Sets this week/.test(txt()) && /2\/5/.test(txt()), 'weekly sets counted (2 in the last 7 days of 5)');

  console.log('\n── readiness integration ──');
  const E = w.__READINESS_ENGINE__;
  const apx = E.aptitudeFromLog();
  ok(apx && apx.questions === 34 && apx.score === Math.round(20 / 34 * 100), '34 questions in 60 days (>= 30) → engine uses the log: ' + (apx && apx.score) + '% (20/34)');
  ({ w, d } = page()); await sleep(400);
  const eng = () => w.__READINESS_ENGINE__;
  const exams = [{ confidence: 40, date: new Date().toISOString() }, { confidence: 60, date: new Date().toISOString() }];
  const v2 = () => eng().computeReadinessV2({ examEntries: exams, streak: 5 }).breakdown.find((b) => b.key === 'aptitude');
  ok(v2().score === 50 && !eng().aptitudeFromLog(), 'no log → aptitude factor = exam-confidence proxy (50)');
  let events = 0; w.addEventListener('arise:career-updated', () => events++);
  log(w, d, { section: 'Quant', topic: 'Percentages', attempted: 20, correct: 10, time: 20 });
  ok(store(w, 'arise-aptitude-summary-v1').questions === 20 && !eng().aptitudeFromLog(), '20 questions → summary written but engine still ignores it (needs 30)');
  log(w, d, { section: 'Logical', topic: 'Syllogisms', attempted: 20, correct: 18, time: 20 });
  const ap = eng().aptitudeFromLog();
  ok(ap && ap.score === 70 && ap.questions === 40, '40 questions → engine reads score 70% (28/40)');
  ok(v2().score === 70 && v2().missing === false, 'Readiness aptitude factor now uses real accuracy (70), not the exam proxy');
  ok(events >= 1, 'saving announces arise:career-updated so cards refresh');
  const noExams = eng().computeReadinessV2({ examEntries: [], streak: 5 }).breakdown.find((b) => b.key === 'aptitude');
  ok(noExams.score === 70 && noExams.missing === false, 'no exam entries but real aptitude data → factor is not flagged missing (no missing-data penalty)');
  d.querySelector('[data-apt-del]').click();
  d.querySelectorAll('[data-apt-del]').forEach((b) => b.click());
  await sleep(50);
  ok(store(w, 'arise-aptitude-log-v1').sessions.length === 0 && w.localStorage.getItem('arise-aptitude-summary-v1') === null, 'deleting every set clears the summary so Readiness falls back cleanly');
  ok(v2().score === 50, 'and Readiness returns to the exam-confidence proxy');

  console.log('\n── robustness ──');
  ({ w, d, errors } = page({ 'arise-aptitude-log-v1': { sessions: [{ id: 'x', at: Date.now(), section: 'Quant', topic: '<img src=x onerror=alert(1)>', attempted: 10, correct: 5, timeMin: 5 }, { id: 'bad1', at: Date.now(), section: 'Nope', attempted: 10, correct: 5 }, { id: 'bad2', at: Date.now(), section: 'Quant', attempted: 5, correct: 9 }, null, 'junk'], settings: { targetAcc: 'abc' } } })); await sleep(500);
  ok(!d.getElementById('apt-practice').querySelector('img') && errors.length === 0, 'tampered topic text is escaped; junk entries never crash rendering');
  ok(w.__ARISE_APTITUDE__.load().sessions.length === 1 && w.__ARISE_APTITUDE__.load().settings.targetAcc === 75, 'only the valid session survives; bad target falls back to 75');
  await sleep(1200);
  let recs = 0; const mo = new w.MutationObserver((r) => { recs += r.length; }); mo.observe(d.body, { childList: true, subtree: true }); await sleep(1800); mo.disconnect();
  ok(recs === 0, 'no render loop while idle (mutations: ' + recs + ')');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
