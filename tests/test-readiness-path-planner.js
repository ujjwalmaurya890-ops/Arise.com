/*!
 * tests/test-readiness-path-planner.js — Readiness Path Planner (what-if next-level plan + trend) and
 * the data-driven "Today's actions" in the Career Command Center.
 * Run: node scripts/_run-test.cjs tests/test-readiness-path-planner.js
 */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.error('  ✗ FAIL:', m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function bank(solvedN, total) {
  const out = [];
  for (let i = 0; i < total; i++) out.push({ id: 'q' + i, title: 'Prob ' + i, topic: ['Arrays', 'DP', 'Graphs'][i % 3], difficulty: ['Easy', 'Medium', 'Hard'][i % 3], solved: i < solvedN, dateSolved: i < solvedN ? stamp(i % 10) : null });
  return out;
}
function page(seed, files, body) {
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + (body || '<div class="glass-card"><h3>Developer Readiness</h3></div>') + '</body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  Object.keys(seed || {}).forEach((k) => w.localStorage.setItem(k, typeof seed[k] === 'string' ? seed[k] : JSON.stringify(seed[k])));
  files.forEach((f) => w.eval(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8') + '\n//# sourceURL=' + f));
  return { w, d: w.document, errors };
}
const PLAN_FILES = ['src/mutation-bus.js', 'src/widget-shared-utils.js', 'src/readiness-scoring-config.js', 'src/readiness-engine.js', 'src/readiness-50lpa-widget.js', 'src/readiness-path-planner-widget.js'];
const DEV = [{ title: 'A', difficulty: 'Beginner', completed: true, priority: 'High' }, { title: 'B', difficulty: 'Intermediate', completed: false, priority: 'Critical' }, { title: 'C', difficulty: 'Advanced', completed: false, priority: 'Low' }, { title: 'D', difficulty: 'Beginner', completed: false, priority: 'Medium' }];

(async function () {
  console.log('\n── Path planner ──');
  ['src/readiness-path-planner-widget.js', 'src/career-command-center-widget.js'].forEach((f) => { let g = true; try { new Function(fs.readFileSync(path.join(path.resolve(__dirname, ".."), f), 'utf8')); } catch (e) { g = false; } ok(g, f + ' parses'); });
  let { w, d, errors } = page({ dsaQuestions: bank(12, 60), devTasks: DEV, streak: 3, 'cse-syllabus-progress-v1': { s1: true, s2: true } }, PLAN_FILES);
  await sleep(900);
  const card = d.getElementById('lpa50-readiness-card'), el = d.getElementById('rpp-planner');
  ok(!!card && !!el && el.previousElementSibling === card, 'planner is inserted right after the Career Readiness card');
  ok(errors.length === 0, 'no uncaught errors (' + errors.slice(0, 1).join('') + ')');
  const api = w.__ARISE_CAREER_READINESS_API__, P = w.__ARISE_READINESS_PLANNER_API__;

  console.log('\n── Reserved dashboard slots ──');
  {
    const slotPage = page({ dsaQuestions: bank(12, 60), devTasks: DEV, streak: 3 }, PLAN_FILES,
      '<div class="glass-card"><h3>Developer Readiness</h3></div>' +
      '<div id="arise-career-readiness-slot" class="arise-readiness-widget-reserve" aria-hidden="true"></div>' +
      '<div id="arise-readiness-planner-slot" class="arise-readiness-widget-reserve" aria-hidden="true"></div>' +
      '<div id="quick-actions"></div>');
    await sleep(900);
    const devCard = slotPage.d.querySelector('.glass-card');
    const careerCard = slotPage.d.getElementById('lpa50-readiness-card');
    const planner = slotPage.d.getElementById('rpp-planner');
    ok(!!careerCard && !!planner && !slotPage.d.getElementById('arise-career-readiness-slot') && !slotPage.d.getElementById('arise-readiness-planner-slot'), 'both lazy cards replace their reserved slots');
    ok(careerCard.previousElementSibling === devCard && planner.previousElementSibling === careerCard && planner.nextElementSibling.id === 'quick-actions', 'slot replacement preserves the original card order and fallback adjacency');
    ok(slotPage.errors.length === 0, 'reserved-slot mount has no uncaught errors (' + slotPage.errors.slice(0, 1).join('') + ')');
  }
  const appBundle = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'assets/app-bundle.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'index.html'), 'utf8');
  ok(appBundle.includes('id:"arise-career-readiness-slot"') && appBundle.includes('id:"arise-readiness-planner-slot"'), 'compiled dashboard renders both readiness slots');
  ok(indexHtml.includes('#root #arise-career-readiness-slot') && indexHtml.includes('#root #rpp-planner { min-height: 485px; }') && indexHtml.includes('#root #rpp-planner { min-height: 469px; }') && indexHtml.includes('#root #rpp-planner { min-height: 448px; }'), 'critical CSS reserves measured responsive space for wide-desktop readiness cards');
  const base = P.inputs(), plan = P.plan(api, base, Date.now());
  ok(plan.cur.total === api.calculateCareerReadiness(base).total, 'planner "current" equals the card\'s own score (' + plan.cur.total + '%)');
  ok(plan.target === api.LEVELS[plan.cur.level.index].max + 1, 'target = first point of the next level (' + plan.target + '%)');
  const lv = P.levers(base);
  plan.rows.forEach((r) => {
    if (r.n == null) { ok(true, r.lever.key + ': no single-lever path (max reaches ' + r.best + ')'); return; }
    const l = lv.find((x) => x.key === r.lever.key);
    const at = (n) => { const dd = JSON.parse(JSON.stringify(base)); l.apply(dd, n); return api.calculateCareerReadiness(dd).total; };
    ok(at(r.n) >= plan.target && (r.n === 1 || at(r.n - 1) < plan.target), r.lever.key + ': ' + r.n + ' actions reaches the target and ' + (r.n - 1) + ' does not');
  });
  ok(base.dsaQuestions.filter((q) => q.solved).length === 12 && base.devTasks.filter((t) => t.completed).length === 1, 'what-if runs never mutate the real data');
  ok(/best return per action/.test(el.textContent), 'the best-return lever is highlighted');
  ok(/Heads-up on the DSA score/.test(el.textContent), 'big-backlog caveat shown when most of the bank is unsolved');
  ok(!/NaN|undefined|Infinity/.test(el.textContent), 'no NaN/undefined/Infinity in the UI');

  console.log('\n── Trend ──');
  ({ w, d } = page({ dsaQuestions: bank(12, 60), devTasks: DEV, streak: 3, 'arise-career-readiness-history-v1': [{ date: stamp(40), score: 10 }, { date: stamp(8), score: 12 }, { date: stamp(2), score: 15 }] }, PLAN_FILES));
  await sleep(900);
  const tr = w.__ARISE_READINESS_PLANNER_API__.trend(Date.now());
  ok(tr.ok && tr.d7 === Math.round((tr.latest - 12) * 10) / 10 && tr.d30 === Math.round((tr.latest - 10) * 10) / 10, 'trend deltas are measured against the entry on/before 7 and 30 days ago (d7=' + tr.d7 + ', d30=' + tr.d30 + ', latest=' + tr.latest + ')');
  ok(d.querySelector('#rpp-planner svg path'), 'sparkline is drawn');
  ({ w, d } = page({ dsaQuestions: bank(3, 10) }, PLAN_FILES)); await sleep(900);
  ok(/appears after the card has recorded two different days/.test(d.getElementById('rpp-planner').textContent), 'fewer than 2 history days → friendly placeholder, no crash');

  console.log('\n── Placement-date projection ──');
  const plus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  ({ w, d } = page({ dsaQuestions: bank(12, 60), 'arise-la-config-v1': { schemaVersion: 1, weeklyTargets: { dsa: 7 }, dsaHoursNeeded: 120, placementDate: plus(28) } }, PLAN_FILES)); await sleep(900);
  const DL = w.__ARISE_READINESS_PLANNER_API__.deadline, pf = { atTop: false, target: 20, targetLabel: 'Learning', cur: { total: 12 } };
  let r1 = DL(Date.now(), { ok: true, pts: [{ date: stamp(14), score: 8 }, { date: stamp(0), score: 12 }] }, pf);
  ok(r1.days === 28 && r1.gap === 8 && Math.abs(r1.need - 2) < 1e-9 && r1.pace === 2 && r1.projected === 20 && r1.onTrack === true, 'on-track case: need 2/wk, pace +2/wk → lands at 20%');
  r1 = DL(Date.now(), { ok: true, pts: [{ date: stamp(14), score: 10 }, { date: stamp(0), score: 12 }] }, pf);
  ok(r1.pace === 1 && r1.projected === 16 && r1.onTrack === false, 'behind case: pace +1/wk → lands at 16% and is flagged behind');
  ok(DL(Date.now(), { ok: false, pts: [] }, pf).pace === null, 'no usable history → no fabricated pace');
  ok(DL(Date.now(), { ok: true, pts: [{ date: stamp(1), score: 5 }, { date: stamp(0), score: 30 }] }, pf).pace === null, 'history spanning < 3 days → no pace (avoids wild extrapolation)');
  ok(d.getElementById('rpp-planner').textContent.indexOf('28 days to your placement date') !== -1, 'card shows the days remaining from the shared placement date');
  const inp = d.querySelector('[data-rpp-date]'); inp.value = plus(90); inp.dispatchEvent(new w.Event('change', { bubbles: true })); await sleep(50);
  const cfg = JSON.parse(w.localStorage.getItem('arise-la-config-v1'));
  ok(cfg.placementDate === plus(90) && cfg.weeklyTargets.dsa === 7 && cfg.dsaHoursNeeded === 120, 'changing the date updates only placementDate and preserves the rest of the analytics config');
  ok(/90 days to your placement date/.test(d.getElementById('rpp-planner').textContent), 'UI refreshes immediately after the date changes');
  ({ w, d } = page({ dsaQuestions: bank(12, 60), 'arise-la-config-v1': { placementDate: stamp(3) } }, PLAN_FILES)); await sleep(900);
  ok(/has passed/.test(d.getElementById('rpp-planner').textContent), 'a past placement date is called out instead of showing negative days');
  ({ w, d } = page({ dsaQuestions: bank(12, 60) }, PLAN_FILES)); await sleep(900);
  ok(/Set your placement date/.test(d.getElementById('rpp-planner').textContent), 'no date set → prompts for one');

  console.log('\n── Perf: readiness widgets no longer re-render in a loop ──');
  ({ w, d, errors } = page({ dsaQuestions: bank(12, 60), devTasks: DEV, streak: 3 }, PLAN_FILES.concat(['src/career-command-center-widget.js']), '<div class="glass-card"><h3>Developer Readiness</h3></div><div id="host"></div>'));
  w.__mountCareerCommandCenter(d.getElementById('host')); await sleep(2800);
  let recs = 0; const mo = new w.MutationObserver((r) => { recs += r.length; }); mo.observe(d.body, { childList: true, subtree: true });
  await sleep(2200); mo.disconnect();
  ok(recs === 0, 'zero DOM mutations over 2.2s idle with card + planner + command center mounted (got ' + recs + ')');
  const before = w.__ARISE_CAREER_READINESS_API__.lastResult.total;
  const more = bank(40, 60); w.localStorage.setItem('dsaQuestions', JSON.stringify(more));
  d.body.appendChild(d.createElement('div')); await sleep(700);
  ok(w.__ARISE_CAREER_READINESS_API__.lastResult.total > before, 'a real external change still refreshes the card (' + before + '% → ' + w.__ARISE_CAREER_READINESS_API__.lastResult.total + '%)');
  ok(/You are at \d+%/.test(d.getElementById('rpp-planner').textContent), 'planner still re-renders after the change');

  console.log('\n── Edge cases ──');
  ({ w, d, errors } = page({}, PLAN_FILES)); await sleep(900);
  ok(!!d.getElementById('rpp-planner') && errors.length === 0, 'empty app (no data at all) renders without errors');
  ok(/Log Dev Skill Tasks in the Learning tracker/.test(d.getElementById('rpp-planner').textContent), 'no dev tasks → tells you how to unlock that lever');
  ({ w, d } = page({ dsaQuestions: bank(60, 60), devTasks: DEV.map((t) => Object.assign({}, t, { completed: true })), streak: 30, 'cse-syllabus-progress-v1': Object.fromEntries(Array.from({ length: 56 }, (_, i) => ['s' + i, true])) }, PLAN_FILES)); await sleep(900);
  ok(/top level/.test(d.getElementById('rpp-planner').textContent), 'everything done → top-level message');
  ({ w, d } = page({ dsaQuestions: bank(12, 60) }, PLAN_FILES, '<div>no readiness heading here</div>')); await sleep(600);
  ok(!d.getElementById('rpp-planner'), 'no card on the page → planner stays out of the way');

  console.log('\n── Career Command Center: data-driven actions ──');
  const CCC = ['src/mutation-bus.js', 'src/widget-shared-utils.js', 'src/readiness-scoring-config.js', 'src/readiness-engine.js', 'src/career-command-center-widget.js'];
  const qs = bank(10, 30); qs[15].title = 'Evil <img src=x onerror=alert(1)>'; qs[15].topic = 'Tries';
  ({ w, d, errors } = page({ dsaQuestions: qs, devTasks: DEV, streak: 0 }, CCC, '<div id="host"></div>'));
  w.__mountCareerCommandCenter(d.getElementById('host')); await sleep(600);
  const root = d.getElementById('ccc-root'), txt = root ? root.textContent : '';
  ok(!!root && errors.length === 0, 'command center mounts without errors (' + errors.slice(0, 1).join('') + ')');
  ok(!root.querySelector('img'), 'user-supplied titles are escaped (no injected <img>)');
  const missions = Array.from(d.querySelectorAll('.ccc-mission-text')).map((n) => n.textContent);
  ok(missions.some((m) => /Solve \d+ DSA problems — start with “/.test(m)), 'DSA action names a specific problem: ' + (missions.find((m) => /start with/.test(m)) || '').slice(0, 70));
  const strong = { dsaQuestions: bank(30, 30).map((q) => Object.assign(q, { difficulty: 'Medium' })), devTasks: [{ title: 'D', difficulty: 'Beginner', completed: false, priority: 'Medium' }, { title: 'B <b>x</b>', difficulty: 'Intermediate', completed: false, priority: 'Critical' }, { title: 'E', difficulty: 'Beginner', completed: false, priority: 'High' }],
    projects: [1, 2, 3, 4, 5].map((i) => ({ id: i, progress: 100, title: 'p' + i })), streak: 30, 'cse-syllabus-progress-v1': Object.fromEntries(Array.from({ length: 56 }, (_, i) => ['s' + i, true])), interviewSheetsProgress: Object.fromEntries(Array.from({ length: 400 }, (_, i) => ['k' + i, true])) };
  ({ w, d, errors } = page(strong, CCC, '<div id="host"></div>'));
  w.__mountCareerCommandCenter(d.getElementById('host')); await sleep(600);
  const devM = Array.from(d.querySelectorAll('.ccc-mission-text')).map((n) => n.innerHTML).find((m) => /Dev Skill Tasks/.test(m));
  ok(devM && /next up: B &lt;b&gt;x&lt;\/b&gt;, E/.test(devM), 'dev action names the next 2 tasks, Critical → High, HTML-escaped: ' + (devM || 'NOT FOUND'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
