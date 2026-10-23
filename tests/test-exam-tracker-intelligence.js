'use strict';
// Exam Tracker intelligence upgrade — deterministic unit + storage + DOM
// smoke tests. Run via the .cjs shim (package.json is "type":"module"):
//   node scripts/_run-test.cjs tests/test-exam-tracker-intelligence.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; failures.push(msg); console.error('FAIL:', msg); }
}
function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) { pass++; }
  else { fail++; failures.push(msg + ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); console.error('FAIL:', msg, `— expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ISO date string offset from today (relative dates keep tests clock-proof).
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const TODAY = dateOffset(0);
const NOW = new Date();

function freshDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  dom.window.__ARISE_MUTATION_BUS__ = { subscribe: function () {} };
  return dom;
}

function loadScript(window, file) {
  const code = fs.readFileSync(path.join(path.resolve(__dirname, ".."), file), 'utf8');
  window.eval(code);
}

function loadExamTrackerStack(window) {
  window.localStorage.clear();
  loadScript(window, 'src/features/exam-tracker/exam-tracker-calculations.js');
  loadScript(window, 'src/features/exam-tracker/exam-tracker-intelligence.js');
  loadScript(window, 'src/features/exam-tracker/exam-tracker-storage.js');
  loadScript(window, 'src/features/exam-tracker/exam-tracker-dday.js');
  loadScript(window, 'src/features/exam-tracker/exam-tracker.js');
  loadScript(window, 'src/features/exam-tracker/exam-tracker-analytics-widget.js');
}

function examFixture(overrides) {
  return Object.assign({
    id: 'ex1',
    examName: 'DBMS',
    subjectName: 'Database Systems',
    examType: 'End Sem',
    examDate: dateOffset(4),
    priority: 'High',
    targetPercentage: 80,
    topics: [
      { id: 't1', title: 'Normalization', status: 'Not Started', difficulty: 'Hard', confidence: 1 },
      { id: 't2', title: 'Transactions', status: 'In Progress', difficulty: 'Hard', confidence: 2 },
      { id: 't3', title: 'Indexing', status: 'Revision', difficulty: 'Medium', confidence: 3 },
      { id: 't4', title: 'ER Model', status: 'Completed', difficulty: 'Easy', confidence: 5 },
      { id: 't5', title: 'Query Optimization', status: 'Not Started', difficulty: 'Medium', confidence: 2 }
    ]
  }, overrides || {});
}

// =====================================================================
// 1. Exam Risk Engine
// =====================================================================
(function testExamRisk() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;
  const calc = w.AriseExamCalculations;

  // Deterministic: same input, same output.
  const ex = examFixture();
  const r1 = intel.calculateExamRisk(ex);
  const r2 = intel.calculateExamRisk(examFixture());
  assertEq(r1.score, r2.score, 'risk: deterministic score');
  assertEq(r1.level, r2.level, 'risk: deterministic level');

  assert(r1.score >= 0 && r1.score <= 100, 'risk: score within 0-100');
  assert(r1.score >= 45 && r1.score <= 75, 'risk: 4 days out, ~49% prep, 3 weak topics, 31pt target gap → High band (' + r1.score + ')');
  assertEq(r1.level, 'High', 'risk: 4 days out with weak topics and target gap → High');
  assert(r1.reasons.length >= 3, 'risk: reasons are populated');
  assert(r1.reasons.some(function (x) { return x.indexOf('4 days remaining') !== -1; }), 'risk: reason mentions days remaining');
  assert(r1.reasons.some(function (x) { return /% prepared/.test(x); }), 'risk: reason mentions preparation %');
  assert(r1.reasons.some(function (x) { return /weak topic/.test(x); }), 'risk: reason mentions weak topics');
  assert(r1.reasons.some(function (x) { return /Target gap/.test(x); }), 'risk: reason mentions target gap');
  assert(r1.factors && typeof r1.factors.urgency === 'number', 'risk: factor breakdown present');
  assert(r1.weights && r1.weights.urgency === 0.32, 'risk: weights exposed for explainability');

  // Spec reference case: exam tomorrow, everything unstarted, 14pt target gap → Critical.
  const specCase = examFixture({
    id: 'spec', examDate: dateOffset(1), priority: 'Medium', targetPercentage: 14,
    topics: [
      { id: 's1', title: 'A', status: 'Not Started', difficulty: 'Hard', confidence: 0 },
      { id: 's2', title: 'B', status: 'Not Started', difficulty: 'Hard', confidence: 0 },
      { id: 's3', title: 'C', status: 'Not Started', difficulty: 'Hard', confidence: 0 },
      { id: 's4', title: 'D', status: 'Not Started', difficulty: 'Hard', confidence: 0 },
      { id: 's5', title: 'E', status: 'Not Started', difficulty: 'Hard', confidence: 0 }
    ]
  });
  const rs = intel.calculateExamRisk(specCase);
  assertEq(rs.level, 'Critical', 'risk: spec reference case (1 day, unstarted syllabus, weak topics) → Critical');

  // Well-prepared exam far out → Safe/Medium.
  const easy = examFixture({
    id: 'ex2', examName: 'Easy one', examDate: dateOffset(20), priority: 'Low', targetPercentage: null,
    topics: [
      { id: 't1', title: 'A', status: 'Completed', difficulty: 'Easy', confidence: 5 },
      { id: 't2', title: 'B', status: 'Completed', difficulty: 'Easy', confidence: 4 }
    ]
  });
  const re = intel.calculateExamRisk(easy);
  assert(re.score < 32, 'risk: well-prepared exam 20d out stays Safe (' + re.score + ')');
  assertEq(re.level, 'Safe', 'risk: well-prepared exam level Safe');

  // Overdue → Critical.
  const overdue = examFixture({ id: 'ex3', examDate: dateOffset(-3), topics: [] });
  const ro = intel.calculateExamRisk(overdue);
  assertEq(ro.level, 'Critical', 'risk: overdue exam is Critical');
  assert(ro.reasons.some(function (x) { return /Overdue/.test(x); }), 'risk: overdue reason present');

  // Missing date → Medium with explanation, no crash.
  const noDate = examFixture({ id: 'ex4', examDate: '' });
  const rn = intel.calculateExamRisk(noDate);
  assert(rn && rn.level, 'risk: missing date still returns a level');
  assert(rn.reasons.some(function (x) { return /No exam date/.test(x); }), 'risk: missing-date reason present');

  // Exam today → urgency maxed.
  const today = examFixture({ id: 'ex5', examDate: TODAY, topics: [] });
  const rt = intel.calculateExamRisk(today);
  assertEq(rt.factors.urgency, 100, 'risk: exam today has max urgency');
  assert(rt.reasons.some(function (x) { return /today/i.test(x); }), 'risk: exam-today reason present');

  // Tomorrow + high prep + floor: stays below Critical.
  const tomorrowReady = examFixture({
    id: 'ex6', examDate: dateOffset(1), priority: 'Medium', targetPercentage: null,
    topics: [{ id: 't1', title: 'A', status: 'Completed', difficulty: 'Hard', confidence: 5 }]
  });
  const rtr = intel.calculateExamRisk(tomorrowReady);
  assert(rtr.level !== 'Critical', 'risk: tomorrow with 100% prep is not Critical');

  // Completed exams have no risk.
  assertEq(intel.calculateExamRisk(examFixture({ completed: true })), null, 'risk: completed exam → null');

  // null/undefined input safety.
  assertEq(intel.calculateExamRisk(null), null, 'risk: null exam → null');

  // sortExamsByRisk puts the designed-critical exam first.
  const list = [easy, examFixture(), tomorrowReady];
  const sorted = intel.sortExamsByRisk(list);
  assertEq(sorted[0].id, 'ex1', 'risk sort: critical exam first');

  // Canonical namespace: risk APIs also live on AriseExamCalculations.
  assert(typeof calc.calculateExamRisk === 'function', 'risk: exposed on AriseExamCalculations');
  assert(typeof calc.generateTodayPlan === 'function', 'plan: exposed on AriseExamCalculations');
})();

// =====================================================================
// 2. Weak Topic Detector (canonical)
// =====================================================================
(function testWeakTopics() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  const ex = examFixture();
  const weak = intel.calculateWeakTopics([ex]);

  assert(weak.length >= 4, 'weak: non-completed topics ranked (got ' + weak.length + ')');
  assertEq(weak[0].title, 'Normalization', 'weak: hardest/least-confident/unstarted first');
  assert(!weak.some(function (t) { return t.title === 'ER Model'; }), 'weak: completed topics excluded');
  assert(['Critical', 'High', 'Medium', 'Low'].indexOf(weak[0].level) !== -1, 'weak: level labels valid');
  assert(weak[0].score >= weak[weak.length - 1].score, 'weak: sorted by score desc');

  // Same-topic confidence effect: more confidence → lower score.
  const lowConf = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Hard', confidence: 0 }, { days: 4, priority: 'High' });
  const highConf = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Hard', confidence: 5 }, { days: 4, priority: 'High' });
  assert(lowConf > highConf, 'weak: low confidence scores higher than high confidence');

  // Difficulty effect.
  const hard = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Hard', confidence: 2 }, { days: 4, priority: 'High' });
  const easyT = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Easy', confidence: 2 }, { days: 4, priority: 'High' });
  assert(hard > easyT, 'weak: hard difficulty scores higher');

  // Priority effect.
  const critExam = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Medium', confidence: 2 }, { days: 4, priority: 'Critical' });
  const lowExam = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Medium', confidence: 2 }, { days: 4, priority: 'Low' });
  assert(critExam > lowExam, 'weak: exam priority boosts score');

  // PYQ importance adds weight.
  const base = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Medium', confidence: 2 }, { days: 4, priority: 'High' });
  const important = intel.weakTopicScore({ title: 'X', status: 'Not Started', difficulty: 'Medium', confidence: 2, pyqImportant: true }, { days: 4, priority: 'High' });
  assert(important === base + 8, 'weak: pyqImportant adds +8');

  // Missing confidence / difficulty tolerated.
  const bare = intel.weakTopicScore({ title: 'X', status: 'Not Started' }, { days: 4, priority: 'Medium' });
  assert(typeof bare === 'number' && !isNaN(bare), 'weak: missing confidence/difficulty handled');
  assertEq(intel.weakTopicScore(null, {}), 0, 'weak: null topic → 0');

  // calculateHighImpactTopics wraps the same engine.
  const hi = intel.calculateHighImpactTopics(ex, { limit: 2 });
  assertEq(hi.length, 2, 'high-impact: limit respected');
  assertEq(hi[0].title, weak[0].title, 'high-impact: consistent with canonical ranking');
})();

// =====================================================================
// 3. Syllabus Coverage
// =====================================================================
(function testCoverage() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  const cov = intel.calculateSyllabusCoverage(examFixture());
  assertEq(cov.total, 5, 'coverage: total topics');
  assertEq(cov.completed, 1, 'coverage: completed count');
  assertEq(cov.inProgress, 1, 'coverage: in-progress count');
  assertEq(cov.revision, 1, 'coverage: revision count');
  assertEq(cov.unstarted, 2, 'coverage: unstarted count');
  assert(cov.coveragePct > 0 && cov.coveragePct <= 100, 'coverage: percentage sane (' + cov.coveragePct + '%)');
  assert(cov.weak >= 2, 'coverage: weak count present');
  assert(cov.highImpact.length <= 5, 'coverage: high-impact list capped');

  // No topics → null percentage, not a misleading zero.
  const none = intel.calculateSyllabusCoverage({ id: 'x', topics: [] });
  assertEq(none.coveragePct, null, 'coverage: no topics → coveragePct null');
  assertEq(none.total, 0, 'coverage: no topics → total 0');

  // Missing exam / malformed topics.
  assertEq(intel.calculateSyllabusCoverage(null).total, 0, 'coverage: null exam safe');
  assertEq(intel.calculateSyllabusCoverage({ id: 'x', topics: 'garbage' }).total, 0, 'coverage: malformed topics safe');

  // Fully complete syllabus → 100%.
  const full = intel.calculateSyllabusCoverage({
    id: 'x',
    topics: [
      { id: 'a', title: 'A', status: 'Completed' },
      { id: 'b', title: 'B', status: 'Completed' }
    ]
  });
  assertEq(full.coveragePct, 100, 'coverage: all completed → 100%');
})();

// =====================================================================
// 4. PYQ Readiness
// =====================================================================
(function testPyq() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  // No data → hasData false, readiness null (never a fake 0%).
  const noData = intel.calculatePyqReadiness(examFixture());
  assertEq(noData.hasData, false, 'pyq: no data → hasData false');
  assertEq(noData.readiness, null, 'pyq: no data → readiness null');
  assert(noData.neglected.length >= 4, 'pyq: open topics flagged neglected');

  // Partial data.
  const partial = examFixture({
    topics: [
      { id: 't1', title: 'A', status: 'In Progress', pyqAttempted: 10, pyqSolved: 8, pyqCorrect: 6 },
      { id: 't2', title: 'B', status: 'Not Started' },
      { id: 't3', title: 'C', status: 'Completed', confidence: 5 }
    ]
  });
  const p = intel.calculatePyqReadiness(partial);
  assertEq(p.hasData, true, 'pyq: partial data detected');
  assertEq(p.attempted, 10, 'pyq: attempted total');
  assertEq(p.solved, 8, 'pyq: solved total');
  assertEq(p.correct, 6, 'pyq: correct total');
  assertEq(p.accuracy, 60, 'pyq: accuracy 60%');
  assert(p.readiness > 0 && p.readiness < 100, 'pyq: partial readiness between 0-100 (' + p.readiness + '%)');
  assert(p.neglected.indexOf('B') !== -1, 'pyq: untouched open topic listed as neglected');
  assert(!p.neglected.some(function (t) { return t === 'C'; }), 'pyq: completed topics not neglected');

  // Zero attempted counts as data (explicitly logged, nothing practiced).
  const zero = intel.calculatePyqReadiness({ id: 'x', examDate: dateOffset(3), topics: [{ id: 't1', title: 'A', pyqAttempted: 0 }] });
  assertEq(zero.hasData, true, 'pyq: attempted=0 counts as logged data');
  assertEq(zero.readiness, 0, 'pyq: attempted=0 → readiness 0 is honest');

  // Empty exam safe.
  const empty = intel.calculatePyqReadiness({ id: 'x', topics: [] });
  assertEq(empty.hasData, false, 'pyq: empty topics safe');
  assertEq(intel.calculatePyqReadiness(null).hasData, false, 'pyq: null exam safe');
})();

// =====================================================================
// 5. Study Load
// =====================================================================
(function testStudyLoad() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  const exams = [examFixture(), examFixture({ id: 'ex2', examName: 'DSA', subjectName: 'DSA', examDate: dateOffset(10), priority: 'Medium', targetPercentage: null })];

  // No preference → guidance, not fabricated allocation.
  const noPref = intel.calculateStudyLoad(exams, {}, {});
  assertEq(noPref.hasPreference, false, 'load: no preference flagged');
  assert(noPref.message && /Set your available study hours/.test(noPref.message), 'load: unset-hours message');
  assertEq(noPref.allocation.length, 0, 'load: no allocation without preference');
  assert(noPref.perExam.length === 2, 'load: per-exam needs still computed');

  // Comfortable capacity → plan fits, never exceeds capacity.
  const comfy = intel.calculateStudyLoad(exams, { dailyStudyHours: 8 }, {});
  assertEq(comfy.hasPreference, true, 'load: preference detected');
  assert(comfy.allocation.length === 2, 'load: allocation for both exams');
  const sumComfy = comfy.allocation.reduce(function (s, a) { return s + a.hoursPerDay; }, 0);
  assert(sumComfy <= 8 + 0.001, 'load: allocation sum ' + sumComfy + 'h within 8h capacity');
  assert(comfy.allocation.some(function (a) { return a.hoursPerDay > 0; }), 'load: positive allocations');
  const riskyFirst = comfy.allocation[0];
  assertEq(riskyFirst.examId, 'ex1', 'load: riskiest exam first in allocation');

  // Impossible plan: 0.5h/day vs heavy load → explicit overload, capped sum.
  const tight = intel.calculateStudyLoad(exams, { dailyStudyHours: 0.5 }, {});
  assertEq(tight.overloaded, true, 'load: 0.5h/day vs heavy syllabus → overloaded');
  assert(/exceeds available study time/.test(tight.message), 'load: explicit overload message');
  const sumTight = tight.allocation.reduce(function (s, a) { return s + a.hoursPerDay; }, 0);
  assert(sumTight <= 0.5 + 0.001, 'load: allocation capped at capacity even when overloaded (' + sumTight + ')');

  // Zero hours → explicit message, zero allocations, no NaN.
  const zero = intel.calculateStudyLoad(exams, { dailyStudyHours: 0 }, {});
  assert(zero.message && /0 hours/.test(zero.message), 'load: 0-hour message present');
  assert(zero.allocation.every(function (a) { return a.hoursPerDay === 0; }), 'load: 0-hour → zero allocations');

  // Exams without dates are excluded but reported.
  const noDate = intel.calculateStudyLoad([examFixture({ examDate: '' })], { dailyStudyHours: 4 }, {});
  assertEq(noDate.perExam.length, 0, 'load: date-less exam excluded from plan');
  assert(noDate.examsWithoutDates.length === 1, 'load: date-less exam reported');

  // Overdue exams excluded from forward load.
  const overdueOnly = intel.calculateStudyLoad([examFixture({ examDate: dateOffset(-2) })], { dailyStudyHours: 4 }, {});
  assertEq(overdueOnly.perExam.length, 0, 'load: overdue exam excluded from forward plan');

  // 1 exam / 20 exams scale.
  const one = intel.calculateStudyLoad([examFixture()], { dailyStudyHours: 6 }, {});
  assertEq(one.perExam.length, 1, 'load: single exam handled');
  const many = [];
  for (let i = 0; i < 20; i++) many.push(examFixture({ id: 'm' + i, examDate: dateOffset(3 + i), examName: 'E' + i }));
  const manyLoad = intel.calculateStudyLoad(many, { dailyStudyHours: 2 }, {});
  assertEq(manyLoad.perExam.length, 20, 'load: 20 exams all processed');
  const sumMany = manyLoad.allocation.reduce(function (s, a) { return s + a.hoursPerDay; }, 0);
  assert(sumMany <= 2 + 0.001, 'load: 20-exam allocation still capped (' + sumMany + ')');

  // No NaN/undefined anywhere in output.
  JSON.stringify(one); // throws on circular only; check explicit fields:
  assert(one.perExam.every(function (e) { return typeof e.recommendedPerDay === 'number' && !isNaN(e.recommendedPerDay); }), 'load: recommendedPerDay always numeric');
})();

// =====================================================================
// 6. Today Plan
// =====================================================================
(function testTodayPlan() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;
  const nineAm = new Date(); nineAm.setHours(9, 0, 0, 0);

  const exams = [examFixture(), examFixture({ id: 'ex2', examName: 'DSA', subjectName: 'DSA', examDate: dateOffset(12), priority: 'Medium', targetPercentage: 70 })];
  const plan = intel.generateTodayPlan(exams, { dailyStudyHours: 4 }, { now: nineAm });

  assert(plan.blocks.length >= 2, 'plan: blocks generated (' + plan.blocks.length + ')');
  const totalMin = plan.blocks.reduce(function (s, b) { return s + b.durationMin; }, 0);
  assert(totalMin <= 240, 'plan: total minutes ' + totalMin + ' within 4h budget');
  assert(/^09:00$/.test(plan.blocks[0].start), 'plan: starts at 09:00 when now is earlier');
  assert(plan.blocks.every(function (b) { return /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end); }), 'plan: HH:MM times');
  assert(plan.blocks.every(function (b) { return b.examId && b.reason && b.priority; }), 'plan: blocks carry exam, reason, priority');
  assert(plan.blocks.some(function (b) { return b.kind === 'topic'; }), 'plan: topic blocks present');
  assert(plan.blocks.some(function (b) { return b.kind === 'recall'; }), 'plan: active-recall block present');
  // Weakest topic should be scheduled first.
  assertEq(plan.blocks[0].topic, 'Normalization', 'plan: weakest topic scheduled first');
  // Deterministic.
  const plan2 = intel.generateTodayPlan(exams, { dailyStudyHours: 4 }, { now: nineAm });
  assertEq(JSON.stringify(plan.blocks), JSON.stringify(plan2.blocks), 'plan: deterministic output');

  // Exam tomorrow → its topics become revision, no new-topic blocks for it.
  const tomorrow = examFixture({ id: 'tm', examName: 'OS', subjectName: 'Operating Systems', examDate: dateOffset(1) });
  const planT = intel.generateTodayPlan([tomorrow], { dailyStudyHours: 4 }, { now: nineAm });
  assert(planT.blocks.length > 0, 'plan: exam-tomorrow still generates blocks');
  assert(planT.blocks.every(function (b) { return b.kind !== 'topic' || b.examId !== 'tm'; }), 'plan: no new-topic study for tomorrow exam');
  assert(planT.blocks.some(function (b) { return b.examId === 'tm' && b.kind === 'revise'; }), 'plan: revision blocks for tomorrow exam');
  assert(planT.blocks.some(function (b) { return /no new topics/i.test(b.reason); }), 'plan: no-new-topics reason visible');

  // Tiny budget: blocks shrink or drop, never exceed budget.
  const tiny = intel.generateTodayPlan(exams, { dailyStudyHours: 0.5 }, { now: nineAm });
  const tinyMin = tiny.blocks.reduce(function (s, b) { return s + b.durationMin; }, 0);
  assert(tinyMin <= 30, 'plan: 0.5h budget respected (' + tinyMin + ' min)');

  // No exams → empty with guidance.
  const emptyPlan = intel.generateTodayPlan([], { dailyStudyHours: 4 }, { now: nineAm });
  assertEq(emptyPlan.blocks.length, 0, 'plan: no exams → no blocks');
  assert(emptyPlan.note && /No upcoming exams/.test(emptyPlan.note), 'plan: empty note');

  // No topics anywhere → study-session fallback blocks, not an empty plan.
  const topicless = intel.generateTodayPlan([examFixture({ topics: [] })], { dailyStudyHours: 3 }, { now: nineAm });
  assert(topicless.blocks.length > 0, 'plan: topicless exam still gets study blocks');
  assert(topicless.blocks.every(function (b) { return b.kind === 'pyq' || b.kind === 'recall' || b.kind === 'study'; }), 'plan: fallback block kinds');

  // 20 exams: plan stays within budget and exam cap.
  const many = [];
  for (let i = 0; i < 20; i++) many.push(examFixture({ id: 'm' + i, examDate: dateOffset(3 + i), examName: 'E' + i, subjectName: 'S' + i }));
  const manyPlan = intel.generateTodayPlan(many, { dailyStudyHours: 3 }, { now: nineAm });
  const manyMin = manyPlan.blocks.reduce(function (s, b) { return s + b.durationMin; }, 0);
  assert(manyMin <= 180, 'plan: 20-exam plan within budget (' + manyMin + ')');

  // Blocks carry stable ids for the per-day done state.
  assert(plan.blocks.every(function (b) { return b.id && b.id.length > 3; }), 'plan: stable block ids');
})();

// =====================================================================
// 7. Backlog Detection
// =====================================================================
(function testBacklog() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  const exams = [
    examFixture({ id: 'od', examName: 'OldExam', examDate: dateOffset(-5), topics: [{ id: 't1', title: 'Leftover', status: 'Not Started' }] }),
    examFixture({ id: 'res', examName: 'NoResult', completed: true, resultPercentage: null, examDate: dateOffset(-10) }),
    examFixture({ id: 'stale', examName: 'StaleRev', examDate: dateOffset(6), topics: [{ id: 't2', title: 'Stale', status: 'Revision', confidence: 4, updatedAt: new Date(Date.now() - 12 * 86400000).toISOString() }] })
  ];
  const bl = intel.detectBacklog(exams, { now: NOW, planDonePrev: { date: 'yesterday', blocks: {}, plannedIds: ['topic:od:t1', 'pyq:stale'] } });

  assertEq(bl.total, 4, 'backlog: all four kinds detected (overdue, result, stale, missed plan)');
  assert(bl.items.some(function (i) { return i.kind === 'overdue' && i.examId === 'od'; }), 'backlog: overdue exam detected');
  assert(bl.items.some(function (i) { return i.kind === 'result-missing' && i.examId === 'res'; }), 'backlog: missing result detected');
  assert(bl.items.some(function (i) { return i.kind === 'stale-revision'; }), 'backlog: stale revision topic detected');
  assert(bl.items.some(function (i) { return i.kind === 'missed-plan'; }), 'backlog: missed plan items detected');
  assertEq(bl.items[0].kind, 'overdue', 'backlog: overdue exam ranked first (closest exam priority)');

  // No backlog → clean.
  const clean = intel.detectBacklog([examFixture({ id: 'ok' })], { now: NOW });
  assertEq(clean.hasBacklog, false, 'backlog: clean state has none');

  // limit respected.
  assert(bl.items.length <= 6, 'backlog: limit respected');
})();

// =====================================================================
// 8. Post-Exam Learning Loop
// =====================================================================
(function testInsights() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  const none = intel.buildLearningInsights([examFixture()]);
  assertEq(none.hasData, false, 'insights: no results → hasData false');
  assertEq(none.insights.length, 0, 'insights: no results → no lines');

  const results = [
    examFixture({ id: 'r1', examName: 'DBMS 1', completed: true, resultPercentage: 76, targetPercentage: 80, examDate: dateOffset(-30), topics: [{ id: 't1', title: 'A', status: 'Completed', difficulty: 'Medium', confidence: 3 }] }),
    examFixture({ id: 'r2', examName: 'DSA 1', completed: true, resultPercentage: 72, targetPercentage: 70, examDate: dateOffset(-20), topics: [{ id: 't2', title: 'B', status: 'Completed', difficulty: 'Hard', confidence: 4 }] }),
    examFixture({ id: 'r3', examName: 'OS 1', completed: true, resultPercentage: 75, targetPercentage: null, examDate: dateOffset(-10), topics: [{ id: 't3', title: 'C', status: 'Completed', difficulty: 'Easy', confidence: 4 }] })
  ];
  const ins = intel.buildLearningInsights(results);
  assertEq(ins.hasData, true, 'insights: data detected');
  assertEq(ins.sampleSize, 3, 'insights: sample size');
  assert(ins.insights.length >= 2, 'insights: lines produced');
  assert(ins.insights.some(function (l) { return /average result after .+ preparation is/.test(l); }), 'insights: prep-band line present');
  assert(ins.insights.some(function (l) { return /met or beat your target in 1 of 2/.test(l); }), 'insights: target summary line');
  assert(ins.insights.some(function (l) { return /DBMS 1/.test(l) && /4% short/.test(l); }), 'insights: worst-miss names DBMS 1 (80 target, 76 actual)');

  // Topic-less completed exam: prep unknown → excluded from bands, no crash.
  const mixed = intel.buildLearningInsights([examFixture({ id: 'x', completed: true, resultPercentage: 50, examDate: dateOffset(-5), topics: [] })]);
  assertEq(mixed.hasData, true, 'insights: topic-less completed exam still counted for averages');
})();

// =====================================================================
// 9. Target Simulator
// =====================================================================
(function testTargetRisk() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const intel = w.AriseExamIntelligence;

  // No target → hasTarget false.
  assertEq(intel.calculateTargetRisk({ id: 'x' }, []).hasTarget, false, 'target: no target → false');

  // Upcoming with history.
  const history = [
    examFixture({ id: 'h1', examName: 'DBMS UT1', subjectName: 'Database Systems', completed: true, resultPercentage: 70, targetPercentage: 75, examDate: dateOffset(-40), topics: [] }),
    examFixture({ id: 'h2', examName: 'DBMS UT2', subjectName: 'Database Systems', completed: true, resultPercentage: 78, targetPercentage: null, examDate: dateOffset(-20), topics: [] })
  ];
  const sim = intel.calculateTargetRisk(examFixture(), history);
  assertEq(sim.hasTarget, true, 'target: upcoming mode');
  assertEq(sim.target, 80, 'target: target echoed');
  assertEq(sim.personalAvg, 74, 'target: same-subject history average 74');
  assertEq(sim.historyScope, 'subject', 'target: same-subject scope chosen');
  assert(Array.isArray(sim.projectedRange) && sim.projectedRange.length === 2, 'target: projected range pair');
  assert(sim.projectedRange[0] <= sim.forecast && sim.forecast <= sim.projectedRange[1] + 1, 'target: forecast inside range');
  assert(['On Track', 'At Risk', 'Off Track', 'Unreachable'].indexOf(sim.status) !== -1, 'target: valid status');
  assert(sim.assumptions.length >= 2, 'target: assumptions exposed');
  assertEq(sim.usesVtuProjection, false, 'target: no VTU data → own forecast (no duplication)');

  // VTU integration: with CIE marks the required SEE reuses vtuPassProjection.
  const withCie = examFixture({ cieObtained: 42 });
  const simV = intel.calculateTargetRisk(withCie, history);
  assertEq(simV.usesVtuProjection, true, 'target: VTU projection used when CIE present');
  assert(/SEE/.test(simV.requiredPerformance), 'target: required SEE performance stated');
  const vp = w.AriseExamCalculations.vtuPassProjection(withCie);
  assert(simV.requiredPerformance.indexOf(String(vp.seeNeededTarget)) !== -1, 'target: SEE number matches vtuPassProjection (' + vp.seeNeededTarget + ')');

  // Unreachable via VTU math.
  const hopeless = examFixture({ cieObtained: 5 });
  const simH = intel.calculateTargetRisk(hopeless, history);
  assertEq(simH.status, 'Unreachable', 'target: impossible CIE → Unreachable');
  assert(/cap you at/.test(simH.requiredPerformance), 'target: unreachable message includes the max-possible cap');

  // A null target (present but empty) is NOT a 0% target.
  const nullTarget = examFixture({ id: 'nt', targetPercentage: null });
  assertEq(intel.calculateTargetRisk(nullTarget, []).hasTarget, false, 'target: explicit null target → no simulation, not a 0% target');

  // Completed exam → post mode.
  const done = examFixture({ id: 'd1', completed: true, resultPercentage: 76, targetPercentage: 80, topics: [] });
  const simP = intel.calculateTargetRisk(done, []);
  assertEq(simP.mode, 'post', 'target: completed → post mode');
  assertEq(simP.met, false, 'target: 76 vs 80 → not met');
  assertEq(simP.delta, -4, 'target: delta -4');
  assert(/Missed by 4%/.test(simP.summary), 'target: post summary line');
})();

// =====================================================================
// 10. Storage v1→v2 migration + settings + plan state
// =====================================================================
(function testStorageMigration() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const storage = w.AriseExamStorage;

  // Seed a raw v1 payload (no pyq fields, no v2 settings).
  const v1 = {
    version: 1,
    settings: { activeTab: 'dashboard' },
    exams: [{
      id: 'e1', examName: 'DBMS', subjectName: 'DB', examType: 'End Sem', examDate: dateOffset(4),
      priority: 'High', pinned: true, completed: false, cieMax: 50, seeMax: 100,
      topics: [{ id: 't1', title: 'Normalization', status: 'In Progress', difficulty: 'Hard', confidence: 2, createdAt: '2026-08-01T00:00:00.000Z' }]
    }]
  };
  w.localStorage.setItem(storage.KEY, JSON.stringify(v1));
  const loaded = storage.load();
  assertEq(loaded.version, 2, 'migration: version bumped to 2');
  assertEq(loaded.exams.length, 1, 'migration: exam preserved');
  assertEq(loaded.exams[0].examName, 'DBMS', 'migration: exam fields preserved');
  assertEq(loaded.exams[0].pinned, true, 'migration: pin preserved');
  const topic = loaded.exams[0].topics[0];
  assertEq(topic.title, 'Normalization', 'migration: topic preserved');
  assertEq(topic.pyqAttempted, null, 'migration: pyqAttempted defaults to null');
  assertEq(topic.pyqSolved, null, 'migration: pyqSolved defaults to null');
  assertEq(topic.pyqCorrect, null, 'migration: pyqCorrect defaults to null');
  assertEq(topic.pyqImportant, false, 'migration: pyqImportant defaults false');
  assertEq(topic.lastPracticedAt, null, 'migration: lastPracticedAt defaults null');
  assertEq(loaded.settings.dailyStudyHours, null, 'migration: dailyStudyHours defaults null');
  assertEq(loaded.settings.activeTab, 'dashboard', 'migration: existing settings preserved');

  // Malformed payloads never crash.
  w.localStorage.setItem(storage.KEY, 'not-json{');
  assertEq(storage.load().exams.length, 0, 'migration: corrupt JSON → clean base');
  w.localStorage.setItem(storage.KEY, JSON.stringify({ exams: 'nope', settings: 5 }));
  assertEq(storage.load().exams.length, 0, 'migration: wrong types tolerated');
  w.localStorage.setItem(storage.KEY, JSON.stringify({ exams: [{ id: 'x', topics: 'bad', confidence: 'zzz' }] }));
  const weird = storage.load();
  assertEq(weird.exams.length, 1, 'migration: exam kept despite bad topics');
  assertEq(weird.exams[0].topics.length, 0, 'migration: bad topics → empty array');

  // PYQ topic upsert via public API.
  w.localStorage.removeItem(storage.KEY);
  storage.upsertExam({ examName: 'DSA', examDate: dateOffset(6) });
  const ex = storage.load().exams[0];
  storage.upsertTopic(ex.id, { title: 'Trees' });
  const topic2 = storage.load().exams[0].topics[0];
  storage.upsertTopic(ex.id, Object.assign({}, topic2, { pyqAttempted: 12, pyqSolved: 9, pyqCorrect: 7, pyqImportant: true, lastPracticedAt: TODAY }));
  const updated = storage.load().exams[0].topics[0];
  assertEq(updated.pyqAttempted, 12, 'pyq storage: attempted saved');
  assertEq(updated.pyqSolved, 9, 'pyq storage: solved saved');
  assertEq(updated.pyqImportant, true, 'pyq storage: important saved');
  assertEq(updated.lastPracticedAt, TODAY, 'pyq storage: last practiced saved');
  assertEq(updated.title, 'Trees', 'pyq storage: other fields intact after pyq update');
  assertEq(updated.status, 'Not Started', 'pyq storage: status intact');

  // Negative / garbage pyq values sanitized.
  storage.upsertTopic(ex.id, Object.assign({}, updated, { pyqAttempted: -5 }));
  assertEq(storage.load().exams[0].topics[0].pyqAttempted, null, 'pyq storage: negative → null');

  // Settings + plan state.
  storage.updateSettings({ dailyStudyHours: 3.5 });
  assertEq(storage.load().settings.dailyStudyHours, 3.5, 'settings: study hours saved');
  storage.updateSettings({ dailyStudyHours: 0 });
  assertEq(storage.load().settings.dailyStudyHours, null, 'settings: 0 normalized to null');
  storage.updateSettings({ dailyStudyHours: 99 });
  assertEq(storage.load().settings.dailyStudyHours, 99, 'settings: non-zero values preserved (UI caps at 16)');

  storage.markPlanBlockDone('blk1', true, TODAY);
  const st1 = storage.getPlanDoneState(TODAY);
  assertEq(st1.today.blk1, true, 'plan: block marked done');
  storage.markPlanBlockDone('blk1', false, TODAY);
  assert(!storage.getPlanDoneState(TODAY).today.blk1, 'plan: block unmarked');

  // Roll-forward to next day keeps yesterday as prev.
  storage.markPlanBlockDone('blkA', true, '2026-09-12');
  storage.setPlanPlanned(['blkA', 'blkB'], '2026-09-12');
  const st2 = storage.getPlanDoneState('2026-09-13');
  assert(st2.prev && st2.prev.date === '2026-09-12', 'plan: previous day preserved in prev');
  assertEq(st2.prev.plannedIds.join(','), 'blkA,blkB', 'plan: plannedIds preserved for backlog');
  assertEq(st2.prev.blocks.blkA, true, 'plan: done blocks preserved in prev');
  assertEq(Object.keys(st2.today).length, 0, 'plan: new day starts empty');
})();

// =====================================================================
// 11. Actionable recommendations
// =====================================================================
(function testRecommendations() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const calc = w.AriseExamCalculations;

  const exams = [
    examFixture({ id: 'a1', examName: 'DBMS', examDate: dateOffset(2), topics: [
      { id: 't1', title: 'Transactions', status: 'In Progress', difficulty: 'Hard', confidence: 1 },
      { id: 't2', title: 'Normalization', status: 'Not Started', difficulty: 'Hard', confidence: 0 }
    ] }),
    examFixture({ id: 'a2', examName: 'DSA', examDate: dateOffset(1), priority: 'Medium', targetPercentage: null, topics: [
      { id: 't3', title: 'Trees', status: 'Completed', difficulty: 'Hard', confidence: 5 }
    ] })
  ];
  const recs = calc.generateRecommendations(exams, new Date(), 6, { settings: { dailyStudyHours: null } });
  assert(recs.length > 0, 'recs: produced for urgent exams');
  assert(recs.every(function (r) { return r.message && r.id && typeof r.priority === 'number'; }), 'recs: shape intact (id/priority/message)');
  const urgent = recs.find(function (r) { return r.id === 'a1:urgent-prep'; });
  assert(urgent && /DBMS is in 2 day/.test(urgent.message) && /% prepared/.test(urgent.message), 'recs: urgent message names exam + days + prep');
  assert(urgent && /Transactions/.test(urgent.message), 'recs: urgent message names a weak topic');
  const tomorrow = recs.find(function (r) { return r.id === 'a2:tomorrow-ready'; });
  assert(tomorrow && /Stop adding new topics/.test(tomorrow.message) && /PYQs \+ revision/.test(tomorrow.message), 'recs: prepared-tomorrow message is actionable');
  const hours = recs.find(function (r) { return r.kind === 'hours'; });
  assert(hours && /Set your available study hours/.test(hours.message), 'recs: study-hours nudge when unset');

  // Battle-plan compatibility: old 3-arg call still works.
  const oldCall = calc.generateRecommendations(exams, new Date(), 1);
  assert(oldCall.length === 1 && oldCall[0].message, 'recs: legacy 3-arg call intact');

  // Empty store.
  assertEq(calc.generateRecommendations([], new Date(), 6).length, 0, 'recs: empty exams → empty list');
})();

// =====================================================================
// 12. DOM smoke: mount, Today tab, risk badges, plan interaction
// =====================================================================
(function testDomSmoke() {
  const dom = freshDom();
  const w = dom.window;
  const doc = w.document;
  loadExamTrackerStack(w);

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  w.__mountExamTracker(container);

  const root = container.querySelector('.et-root');
  assert(!!root, 'dom: widget mounted');

  // Default tab is Today (command center first).
  const activeTab = root.querySelector('.et-tab[data-active="true"]');
  assert(!!activeTab && activeTab.getAttribute('data-tab') === 'today', 'dom: Today tab is default');

  // Empty-data rendering: no NaN/undefined leaked into the DOM.
  const html = root.innerHTML;
  assert(html.indexOf('NaN') === -1, 'dom: no NaN in empty render');
  assert(html.indexOf('undefined') === -1, 'dom: no undefined in empty render');
  assert(/Set your available study hours|Welcome to your command center/.test(html), 'dom: empty state guides the user');

  // Seed data through the storage API, re-render via storage event.
  const storage = w.AriseExamStorage;
  const ex = storage.upsertExam({ id: 'seed1', examName: 'DBMS', subjectName: 'Database Systems', examDate: dateOffset(4), priority: 'High', targetPercentage: 80 });
  storage.upsertTopic('seed1', { id: 'tp1', title: 'Transactions', status: 'In Progress', difficulty: 'Hard', confidence: 2 });
  storage.upsertTopic('seed1', { id: 'tp2', title: 'Normalization', status: 'Not Started', difficulty: 'Hard', confidence: 0 });
  w.__unmountExamTracker(container);
  w.__mountExamTracker(container);
  const root2 = container.querySelector('.et-root');
  const html2 = root2.innerHTML;

  // Plan blocks render with times, reasons, checkboxes.
  const blocks = root2.querySelectorAll('.et-plan-block');
  assert(blocks.length >= 1, 'dom: plan blocks rendered (' + blocks.length + ')');
  assert(/Today's Plan/.test(html2), 'dom: plan card heading');
  assert(/Study Hours/.test(html2), 'dom: study hours card');
  assert(/Weak Topics/.test(html2), 'dom: weak topics card');
  assert(/Normalization/.test(html2), 'dom: weakest topic surfaced on Today tab');

  // Check a plan block → persists and re-renders as done.
  const box = root2.querySelector('[data-plan-block]');
  const blockId = box.getAttribute('data-plan-block');
  box.checked = true;
  box.dispatchEvent(new w.Event('change', { bubbles: true }));
  const state = w.AriseExamStorage.getPlanDoneState(new Date().toISOString().slice(0, 10));
  assertEq(state.today[blockId], true, 'dom: checking a block persists done state');
  const reBox = container.querySelector('[data-plan-block="' + blockId + '"]');
  assert(reBox && reBox.checked, 'dom: re-rendered checkbox stays checked');

  // Set study hours through the UI.
  const hoursInput = container.querySelector('[data-study-hours]');
  assert(!!hoursInput, 'dom: study hours input present');
  hoursInput.value = '4';
  hoursInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  assertEq(w.AriseExamStorage.load().settings.dailyStudyHours, 4, 'dom: study hours saved from UI');

  // Switch to Upcoming tab → risk badge present with text (not color-only).
  const tabBtn = Array.from(container.querySelectorAll('[data-tab]')).find(function (b) { return b.getAttribute('data-tab') === 'upcoming'; });
  tabBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  const riskBadge = container.querySelector('.et-badge[data-risk]');
  assert(!!riskBadge, 'dom: risk badge rendered on exam card');
  assert(/prepared/.test(riskBadge.textContent), 'dom: risk badge includes preparation text ("' + riskBadge.textContent.trim() + '")');

  // Detail modal: coverage + PYQ UI + target simulator.
  const detailBtn = container.querySelector('[data-detail="seed1"]');
  detailBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  const modal = container.querySelector('[data-detail-backdrop] .et-modal');
  assert(!!modal, 'dom: detail modal opens');
  assert(/covered/.test(modal.innerHTML), 'dom: coverage summary in modal');
  assert(/PYQ/.test(modal.innerHTML), 'dom: PYQ controls in modal');
  assert(/Target Simulator/.test(modal.innerHTML), 'dom: target simulator present (target 80% set)');
  assert(/Assumptions/.test(modal.innerHTML), 'dom: assumptions disclosed');

  // PYQ field save path.
  const pyqToggle = modal.querySelector('[data-pyq-toggle="tp2"]');
  pyqToggle.dispatchEvent(new w.Event('click', { bubbles: true }));
  const attempted = modal.querySelector('[data-pyq-field="pyqAttempted"][data-topic-id="tp2"]');
  assert(!!attempted && !attempted.closest('[data-pyq-fields]').hidden, 'dom: PYQ panel opens');
  attempted.value = '10';
  attempted.dispatchEvent(new w.Event('change', { bubbles: true }));
  const savedTopic = w.AriseExamStorage.load().exams.find(function (e) { return e.id === 'seed1'; }).topics.find(function (t) { return t.id === 'tp2'; });
  assertEq(savedTopic.pyqAttempted, 10, 'dom: PYQ attempted saved');
  assert(!!savedTopic.lastPracticedAt, 'dom: last practiced stamped on PYQ save');
  const reModal = container.querySelector('[data-detail-backdrop] .et-modal');
  const panel = reModal.querySelector('[data-pyq-fields="tp2"]');
  assert(panel && !panel.hidden, 'dom: PYQ panel stays open after save+re-render');
  assert(/PYQ readiness/.test(reModal.innerHTML), 'dom: PYQ readiness line appears after data logged');

  // Analytics companion mounted after base widget.
  assert(!!container.querySelector('.eta-root'), 'dom: analytics companion panel mounted');

  // Dashboard mini widget renders with the risk line.
  const dash = doc.createElement('div');
  doc.body.appendChild(dash);
  w.__mountExamTrackerDashboard(dash);
  assert(/Most at risk/.test(dash.innerHTML), 'dom: dashboard widget shows risk line');
  w.__unmountExamTrackerDashboard(dash);

  // No NaN/undefined anywhere in final DOM.
  assert(container.innerHTML.indexOf('NaN') === -1, 'dom: no NaN after interactions');
  assert(container.innerHTML.indexOf('undefined') === -1, 'dom: no undefined after interactions');

  w.__unmountExamTracker(container);
})();

// =====================================================================
// 13. Definition-of-done integration: the five questions
// =====================================================================
(function testFiveQuestions() {
  const dom = freshDom();
  const w = dom.window;
  loadExamTrackerStack(w);
  const calc = w.AriseExamCalculations;
  const storage = w.AriseExamStorage;
  const today = new Date();

  const dbms = storage.upsertExam({ id: 'q1', examName: 'DBMS', subjectName: 'DBMS', examDate: dateOffset(4), priority: 'High', targetPercentage: 80, cieObtained: 41, topics: [
    { id: 'w1', title: 'Transactions', status: 'In Progress', difficulty: 'Hard', confidence: 2 },
    { id: 'w2', title: 'Normalization', status: 'Not Started', difficulty: 'Hard', confidence: 1 },
    { id: 'w3', title: 'Indexing', status: 'Not Started', difficulty: 'Medium', confidence: 2 }
  ] });
  storage.upsertExam({ id: 'q2', examName: 'DSA', subjectName: 'DSA', examDate: dateOffset(9), priority: 'Medium', targetPercentage: 75, topics: [
    { id: 'w4', title: 'Trees', status: 'Completed', difficulty: 'Medium', confidence: 5 }
  ] });

  // 1. Which exam is most dangerous?
  const ranked = calc.sortExamsByRisk(storage.load().exams);
  assertEq(ranked[0].id, 'q1', 'Q1: DBMS identified as most dangerous');
  // 2. Why?
  const risk = calc.calculateExamRisk(ranked[0]);
  assert(risk.reasons.length >= 2, 'Q2: reasons explain the risk');
  assert(risk.level === 'Critical' || risk.level === 'High', 'Q2: DBMS level Critical/High (' + risk.level + ')');
  // 3. What should I study today?
  const plan = calc.generateTodayPlan(storage.load().exams, { dailyStudyHours: 4 }, { now: (function () { var d = new Date(); d.setHours(9, 0, 0, 0); return d; })() });
  assert(plan.blocks.length >= 2, 'Q3: plan generated');
  assert(plan.blocks.some(function (b) { return b.examId === 'q1'; }), 'Q3: plan focuses on the dangerous exam');
  // 4. How many hours per subject?
  const load = calc.calculateStudyLoad(storage.load().exams, { dailyStudyHours: 5 }, { now: today });
  const dbmsAlloc = load.allocation.find(function (a) { return a.examId === 'q1'; });
  const dsaAlloc = load.allocation.find(function (a) { return a.examId === 'q2'; });
  assert(dbmsAlloc && dbmsAlloc.hoursPerDay > dsaAlloc.hoursPerDay, 'Q4: DBMS gets more hours than DSA (' + dbmsAlloc.hoursPerDay + ' vs ' + dsaAlloc.hoursPerDay + ')');
  // 5. Am I on track for my target?
  const sim = calc.calculateTargetRisk(dbms, storage.load().exams);
  assert(sim.hasTarget && sim.status && sim.usesVtuProjection, 'Q5: target status available with VTU integration');
  assert(/SEE/.test(sim.requiredPerformance), 'Q5: required SEE performance stated (CIE 41/50 → needs ' + (sim.requiredPerformance.match(/(\d+)\/100/) || [])[1] + ')');
})();

// =====================================================================
console.log('\nExam Tracker intelligence tests: ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) {
  failures.forEach(function (f) { console.error('  - ' + f); });
  process.exit(1);
}
setTimeout(function () { process.exit(0); }, 50);
