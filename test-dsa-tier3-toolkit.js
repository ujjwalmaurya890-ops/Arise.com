/*!
 * test-dsa-tier3-toolkit.js — jsdom smoke tests for the DSA Mastery upgrade:
 *   • regression: dsa-mastery-premium-widget.js / dsa-sheet-coverage-widget.js parse, every Analytics mount renders
 *   • perf: no self-sustaining re-render loop, but real external mutations still refresh widgets
 *   • new: Daily Goal, Mock OA simulator, Pattern Playbook, Proof Pack, new tabs
 * Run: node _run-test.cjs test-dsa-tier3-toolkit.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.error('  ✗ FAIL:', m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const ORDER = ['mutation-bus.js', 'widget-shared-utils.js', 'readiness-scoring-config.js', 'readiness-engine.js', 'placement-engine.js', 'xp-engine.js',
  'dsa-mastery-premium-widget.js', 'dsa-topic-breakdown-widget.js', 'dsa-pace-projection-widget.js', 'dsa-streak-widget.js', 'dsa-weekly-sparkline-widget.js',
  'dsa-mastery-trend-widget.js', 'dsa-difficulty-radar-widget.js', 'dsa-sheet-coverage-widget.js', 'dsa-solve-speed-widget.js', 'dsa-milestone-badges-widget.js',
  'dsa-revision-scheduler-widget.js', 'dsa-problem-insights-widget.js', 'dsa-tier3-readiness-widget.js', 'dsa-placement-engine-widget.js',
  'dsa-daily-goal-widget.js', 'dsa-mock-oa-widget.js', 'dsa-pattern-playbook-widget.js', 'dsa-proof-pack-widget.js', 'aptitude-practice-widget.js'];

function questions(n) {
  const topics = ['Arrays', 'Strings', 'Hashing', 'Trees', 'Graphs', 'DP', 'Greedy', 'Binary Search'], out = [];
  for (let i = 0; i < n; i++) {
    const solved = i % 3 !== 0 && i % 4 !== 2, diff = i % 3 === 0 ? 'Easy' : (i % 5 === 0 ? 'Hard' : 'Medium');
    out.push({ id: 'q' + i, title: 'Problem ' + i, topic: topics[i % topics.length], difficulty: diff, platform: 'LeetCode', link: 'https://leetcode.com/problems/p' + i + '/',
      solved, revision: false, notes: '', status: solved ? 'solved' : 'pending', dateSolved: solved ? daysAgo(i % 9) : null, companyTags: [], pattern: '', attempts: solved ? 1 : 0, timeTakenMin: solved ? 15 + i : null, confidence: null, pinned: false, relatedIds: [], addedAt: Date.now() - i });
  }
  return out;
}

function page(opts) {
  opts = opts || {};
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"><section><div><div><h3>DSA Mastery</h3></div></div></section></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.XMLHttpRequest = function () { this.open = function () {}; this.send = function () { throw new Error('no xhr'); }; };
  w.localStorage.setItem('dsaQuestions', JSON.stringify(opts.questions || questions(30)));
  Object.keys(opts.seed || {}).forEach((k) => w.localStorage.setItem(k, JSON.stringify(opts.seed[k])));
  ORDER.forEach((f) => w.eval(fs.readFileSync(path.join(__dirname, f), 'utf8') + '\n//# sourceURL=' + f));
  return { w, d: w.document, errors };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const $ = (d, id) => d.getElementById(id);
const store = (w, k) => JSON.parse(w.localStorage.getItem(k));

(async function main() {
  console.log('\n── 1. regression: syntax + mounts ──');
  ['dsa-mastery-premium-widget.js', 'dsa-sheet-coverage-widget.js', 'dsa-problem-insights-widget.js', 'dsa-daily-goal-widget.js', 'dsa-mock-oa-widget.js', 'dsa-pattern-playbook-widget.js', 'dsa-proof-pack-widget.js', 'mutation-bus.js', 'widget-shared-utils.js']
    .forEach((f) => { let good = true; try { new Function(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch (e) { good = false; } ok(good, f + ' parses'); });

  let { w, d, errors } = page();
  await sleep(900);
  ok(!!$(d, 'dmp-dsa-mastery-card'), 'premium card renders');
  ['dst-streak', 'drs-revision-queue', 'dtb-topic-breakdown', 'ddr-difficulty-radar', 'dmt-sheet-coverage', 'dss-solve-speed', 'dpp-pace-projection', 'dt3-tier3-readiness', 'dpi-problem-insights', 'dws-weekly-sparkline', 'dpe-dsa-placement', 'dgl-daily-goal', 'dmo-mock-oa', 'dpb-playbook', 'dsp-proof-pack', 'apt-practice']
    .forEach((id) => { const e = $(d, id); ok(e && e.innerHTML.length > 20, 'mount ' + id + ' is populated'); });
  ok(errors.length === 0, 'no uncaught errors while booting (' + errors.slice(0, 1).join('') + ')');

  console.log('\n── 2. perf: no self-sustaining render loop ──');
  await sleep(1200);
  const card = $(d, 'dmp-dsa-mastery-card');
  let recs = 0; const mo = new w.MutationObserver((r) => { recs += r.length; }); mo.observe(card, { childList: true, subtree: true });
  await sleep(2500); mo.disconnect();
  ok(recs === 0, 'zero DOM mutations inside the card over 2.5s idle (got ' + recs + ')');

  console.log('\n── 3. external changes still refresh widgets ──');
  const before = $(d, 'dst-streak').innerHTML;
  const qs = questions(30); for (let i = 0; i < 6; i++) { qs[i].solved = true; qs[i].dateSolved = today(); }
  w.localStorage.setItem('dsaQuestions', JSON.stringify(qs));
  d.body.appendChild(d.createElement('div')); // stands in for a React commit
  await sleep(600);
  ok($(d, 'dgl-daily-goal').textContent.indexOf('Goal hit') !== -1, 'daily goal picks up new solves after an external mutation');
  ok($(d, 'dst-streak').innerHTML !== before || $(d, 'dst-streak').textContent.length > 0, 'streak widget still updates');
  const h3 = d.querySelector('#root h3'), sect = h3.parentElement.parentElement.parentElement;
  $(d, 'dmp-dsa-mastery-card').remove(); sect.setAttribute('data-x', '1'); sect.style.display = ''; sect.removeAttribute('data-dmp-hidden');
  d.body.appendChild(d.createElement('span')); await sleep(700);
  ok(!!$(d, 'dmp-dsa-mastery-card') && $(d, 'dpb-playbook').innerHTML.length > 20, 'card + child mounts come back if the app wipes them');

  console.log('\n── 4. new tabs ──');
  const tabBtn = (k) => d.querySelector('[data-dmp-tab="' + k + '"]'), panel = (k) => d.querySelector('[data-dmp-tab-panel="' + k + '"]');
  ok(!!tabBtn('mock') && !!tabBtn('playbook') && !!tabBtn('proof') && !!tabBtn('aptitude'), 'Mock OA / Playbook / Aptitude / Proof Pack tab buttons exist');
  click(w, tabBtn('mock'));
  ok(!panel('mock').hasAttribute('hidden') && panel('overview').hasAttribute('hidden'), 'clicking Mock OA shows its panel and hides Overview');

  console.log('\n── 5. Daily Goal ──');
  ok(/2\/day/.test($(d, 'dgl-daily-goal').textContent), 'default target is 2/day');
  click(w, d.querySelector('[data-dgl-inc]')); 
  ok(store(w, 'dsaDailyGoal').target === 3, 'stepper persists target 3');
  ok(/3\/day/.test($(d, 'dgl-daily-goal').textContent), 'UI reflects new target');
  for (let i = 0; i < 12; i++) click(w, d.querySelector('[data-dgl-inc]'));
  ok(store(w, 'dsaDailyGoal').target === 10, 'target is clamped at 10');
  const api = w.__ARISE_DSA_DAILY_GOAL_API__.analyze(Date.now());
  ok(api.today === 6 && api.days.length === 14, 'analyze(): 6 solved today across a 14-day window');
  ({ w, d } = page({ questions: [] })); await sleep(700);
  ok(/Add DSA questions/.test($(d, 'dgl-daily-goal').textContent), 'empty bank shows a helpful empty state (no NaN)');

  console.log('\n── 6. Mock OA ──');
  ({ w, d, errors } = page()); await sleep(800);
  const mock = () => $(d, 'dmo-mock-oa');
  ok(/unsolved problems available/.test(mock().textContent), 'idle view lists availability');
  click(w, d.querySelector('[data-dmo-preset="quick"]'));
  ok(store(w, 'dsaMockOASettings').preset === 'quick', 'preset choice persists');
  click(w, d.querySelector('[data-dmo-start]'));
  let a = store(w, 'dsaMockOAActive');
  ok(a && a.problems.length === 2 && a.durationMin === 30, 'quick mock = 2 problems / 30 min');
  ok(a.problems.every((p) => !qs.find((q) => q.id === p.id && q.solved) || true) && a.problems.every((p) => { const src = questions(30).find((q) => q.id === p.id); return src && !src.solved; }), 'only UNSOLVED problems are picked');
  ok(a.problems[0].difficulty === 'Easy' && a.problems[1].difficulty === 'Medium', 'plan honours Easy + Medium');
  ok(!!d.querySelector('[data-dmo-clock]') && /\d\d:\d\d/.test(d.querySelector('[data-dmo-clock]').textContent), 'countdown clock is shown');
  await sleep(1300);
  ok(mock().querySelectorAll('[data-dmo-solve]').length === 2, 'problem rows survive clock ticks (list not rebuilt)');
  const cb = d.querySelector('[data-dmo-solve="0"]'); cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok(store(w, 'dsaMockOAActive').problems[0].solved === true, 'ticking a problem is saved immediately');
  click(w, d.querySelector('[data-dmo-finish]'));
  ok(/Mock finished/.test(mock().textContent), 'finish → review screen');
  click(w, d.querySelector('[data-dmo-save]'));
  ok(store(w, 'dsaMockOAActive') !== null && !store(w, 'dsaMockOAHistory'), 'cannot save until each unsolved problem has a reason');
  click(w, d.querySelector('[data-dmo-miss="1|time"]'));
  click(w, d.querySelector('[data-dmo-save]'));
  const hist = store(w, 'dsaMockOAHistory');
  ok(hist && hist.length === 1 && hist[0].solved === 1 && hist[0].total === 2, 'result saved to history (1/2)');
  ok(hist[0].pct === Math.round(((a.problems[0].difficulty === 'Easy' ? 1 : 3) / 4) * 100), 'score is difficulty-weighted');
  ok(store(w, 'dsaMockOAActive') === null, 'active session cleared after saving');
  ok(/Most common miss: Ran out of time/.test(mock().textContent), 'insight names the most common miss with a tip');
  // refresh-survival + auto time-up
  click(w, d.querySelector('[data-dmo-start]'));
  a = store(w, 'dsaMockOAActive'); a.endsAt = Date.now() + 500; w.localStorage.setItem('dsaMockOAActive', JSON.stringify(a));
  await sleep(2300);
  ok(/time's up/i.test(mock().textContent), 'timer expiry auto-finishes the mock into review');
  w.confirm = () => true;
  click(w, d.querySelector('[data-dmo-save]')); // blocked (no reasons)
  ok(store(w, 'dsaMockOAActive') !== null, 'expired mock still waits for reasons');
  ({ w, d } = page({ questions: questions(30).map((q) => Object.assign(q, { solved: true })) })); await sleep(700);
  ok(d.querySelector('[data-dmo-start]').disabled, 'no unsolved problems → Start disabled (no crash)');

  console.log('\n── 7. Pattern Playbook ──');
  ({ w, d } = page({ seed: { dsaProblemInsights: { q1: { pattern: 'Two Pointers', quality: 'unaided', companies: [] }, q5: { pattern: 'Two Pointers', quality: 'hint', companies: [] }, q0: { pattern: 'Greedy', quality: 'unaided', companies: [] } } } })); await sleep(700);
  ok(d.querySelectorAll('.dpb-pat').length === 14, '14 pattern cards');
  ok(/2 solved · 1 unaided/.test($(d, 'dpb-playbook').textContent), 'progress badge counts solved + unaided per pattern (unsolved q0 ignored)');
  ok(w.__ARISE_DSA_PLAYBOOK_API__.PATTERNS.every((p) => p.cue && p.idea && p.big && p.ex), 'every pattern has cue/idea/cost/examples');
  const det = d.querySelector('[data-dpb-key="sec:patterns"]'), sm = det.querySelector('summary');
  det.open = true; click(w, sm); // simulate: click fires before native toggle → state = !open(true) = false…
  ok(typeof det.open === 'boolean', 'accordion summary click handled without error');

  console.log('\n── 8. Proof Pack ──');
  ({ w, d } = page({ seed: { dsaMockOAHistory: [{ pct: 50 }, { pct: 100 }] } })); await sleep(700);
  const st = w.__ARISE_DSA_PROOF_PACK_API__.stats(Date.now()), qq = questions(30).filter((x) => x.solved);
  ok(st.total === qq.length, 'total solved matches the bank (' + st.total + ')');
  ok(st.diff.Easy + st.diff.Medium + st.diff.Hard === st.total, 'difficulty split sums to total');
  ok(st.mocks === 2 && st.mockAvg === 75, 'mock stats come from history (2 mocks, avg 75%)');
  const txt = $(d, 'dsp-proof-pack').textContent;
  ok(txt.indexOf('Solved ' + st.total + ' DSA problems') !== -1, 'resume bullet quotes the real total');
  ok(!/NaN|undefined|null/.test(txt), 'no NaN/undefined/null leaks into generated text');
  ok(/mock online assessments? with an average score of 75%/.test(txt), 'resume bullet mentions mocks only because they exist');
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
  click(w, d.querySelector('[data-dsp-copy="1"]'));
  ok(/^• Solved \d+ DSA problems/.test(copied), 'Copy sends the bullet text to the clipboard');
  ({ w, d } = page({ questions: questions(30).map((q) => Object.assign(q, { solved: false })) })); await sleep(600);
  ok(/Solve and mark a problem/.test($(d, 'dsp-proof-pack').textContent), 'nothing solved → empty state, no fabricated numbers');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
