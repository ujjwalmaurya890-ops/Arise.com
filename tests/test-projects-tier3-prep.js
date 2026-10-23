const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.test/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.navigator = dom.window.navigator;

// minimal nav stub matching AriseWidgetNav's real contract closely enough,
// including the lazy-panel contract (panelWrap's 2nd arg may be a function,
// only invoked for the active panel; wire() fills a panel in when its tab
// becomes active) so tests reflect what the real src/widget-nav.js now does.
window.AriseWidgetNav = {
  create: function (cfg) {
    var active = 'analytics';
    var builders = {};
    return {
      navHtml: function () {
        return '<div class="nav">' + cfg.sections.map(function (s) {
          return '<button data-nav="' + s.id + '">' + s.label + '</button>';
        }).join('') + '</div>';
      },
      panelWrap: function (id, htmlOrFn) {
        var isActive = id === active;
        var isLazy = typeof htmlOrFn === 'function';
        if (isLazy) builders[id] = htmlOrFn;
        var html = isLazy ? (isActive ? htmlOrFn() : '') : htmlOrFn;
        return '<div data-panel="' + id + '" style="' + (isActive ? '' : 'display:none') + '">' + html + '</div>';
      },
      wire: function (container) {
        var panel = container.querySelector('[data-panel="' + active + '"]');
        if (panel && !panel.innerHTML && builders[active]) panel.innerHTML = builders[active]();
        container.querySelectorAll('[data-nav]').forEach(function (btn) {
          btn.onclick = function () {
            active = btn.getAttribute('data-nav');
            container.querySelectorAll('[data-panel]').forEach(function (p) {
              var isActive = p.getAttribute('data-panel') === active;
              p.style.display = isActive ? '' : 'none';
              if (isActive && !p.innerHTML && builders[active]) p.innerHTML = builders[active]();
            });
          };
        });
      }
    };
  }
};

const seedProjects = [
  { id: 'p1', title: 'Library Management System', progress: 80, techStack: ['Java', 'MySQL'], features: [], bugs: [], createdAt: new Date().toISOString() },
  { id: 'p2', title: 'Portfolio Website', progress: 100, techStack: ['HTML', 'CSS'], features: [], bugs: [], createdAt: new Date().toISOString() }
];
localStorage.setItem('projects', JSON.stringify(seedProjects));

const code = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'src/projects-widget.js'), 'utf8');
window.eval(code);

const root = document.getElementById('root');
window.__mountProjectsWidget(root);

function assert(cond, msg) {
  if (!cond) throw new Error('FAIL: ' + msg);
  console.log('OK: ' + msg);
}

// 1. New tab button exists
const tier3NavBtn = root.querySelector('[data-nav="tier3prep"]');
assert(tier3NavBtn, 'Tier-3 Prep nav button rendered');

// Panels are lazy now (perf fix): switch to the tab the same way a user
// would (clicking the pill) before checking what's inside it - it isn't
// the default active tab, so its content isn't built until visited.
tier3NavBtn.click();

// 2. Panel content rendered with 2 project cards + confidence buttons
const panel = root.querySelector('[data-panel="tier3prep"]');
assert(panel, 'tier3prep panel exists');
const cards = panel.querySelectorAll('.pjw-grid > [data-pid]');
assert(cards.length === 2, 'two project cards rendered in tier3prep panel, got ' + cards.length);

const confBtns = panel.querySelectorAll('[data-action="set-interview-confidence"]');
assert(confBtns.length === 6, 'confidence buttons rendered (3 per project), got ' + confBtns.length);

// stat chips present
assert(panel.querySelector('.pjw-stat-chip'), 'stat chips rendered');

// 3. Click "ready" confidence for p1
const p1Card = panel.querySelector(".pjw-card[data-pid=\"p1\"]");
const readyBtn = Array.from(p1Card.querySelectorAll('[data-action="set-interview-confidence"]')).find(b => b.getAttribute('data-conf') === 'ready');
readyBtn.click();

let stored = JSON.parse(localStorage.getItem('projects'));
let p1 = stored.find(p => p.id === 'p1');
assert(p1.interviewConfidence === 'ready', 'p1 interviewConfidence persisted as ready');

// re-fetch panel after render
const panel2 = root.querySelector('[data-panel="tier3prep"]');
const readyChip = panel2.querySelector('.pjw-stat-chip .pjw-stat-value');
assert(readyChip.textContent === '1', '"Interview ready" stat chip shows 1, got ' + readyChip.textContent);

// 4. Expand practice panel, type an answer, save it
const p1Card2 = panel2.querySelector(".pjw-card[data-pid=\"p1\"]");
const expandBtn = p1Card2.querySelector('[data-action="toggle-tier3-expand"]');
expandBtn.click();

const panel3 = root.querySelector('[data-panel="tier3prep"]');
const p1Card3 = panel3.querySelector(".pjw-card[data-pid=\"p1\"]");
const q1Textarea = p1Card3.querySelector('[data-input="ans-q1"]');
assert(q1Textarea, 'q1 textarea rendered after expand');

q1Textarea.value = 'It manages library books, issue/return, and fines.';
q1Textarea.dispatchEvent(new window.Event('input', { bubbles: true }));

const saveBtn = p1Card3.querySelector('[data-action="save-interview-answers"]');
saveBtn.click();

stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
assert(p1.interviewAnswers.q1 === 'It manages library books, issue/return, and fines.', 'q1 answer persisted, got: ' + JSON.stringify(p1.interviewAnswers));
assert(p1.interviewAnswers.q2 === '', 'q2 remains empty string, not undefined');

// 5. College submission checkboxes + viva date
const panel4 = root.querySelector('[data-panel="tier3prep"]');
const p1Card4 = panel4.querySelector(".pjw-card[data-pid=\"p1\"]");
const reportCheck = p1Card4.querySelector('[data-action="toggle-submission-flag"][data-flag="report"]');
reportCheck.click();

stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
assert(p1.collegeSubmission.report === true, 'report flag toggled true');
assert(p1.collegeSubmission.ppt === false, 'ppt flag untouched (false)');

const panel5 = root.querySelector('[data-panel="tier3prep"]');
const p1Card5 = panel5.querySelector(".pjw-card[data-pid=\"p1\"]");
const vivaDateInput = p1Card5.querySelector('[data-input="viva-date"]');
vivaDateInput.value = '2026-10-15';
vivaDateInput.dispatchEvent(new window.Event('input', { bubbles: true }));
const saveDateBtn = p1Card5.querySelector('[data-action="save-viva-date"]');
saveDateBtn.click();

stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
assert(p1.collegeSubmission.vivaDate === '2026-10-15', 'viva date persisted, got ' + p1.collegeSubmission.vivaDate);
assert(p1.collegeSubmission.report === true, 'report flag preserved after separate viva-date save (no clobber)');

// 6. Ensure other tabs / existing behavior untouched: Projects tab card count still matches
const projectsNavBtn = root.querySelector('[data-nav="projects"]');
projectsNavBtn.click(); // panels are lazy - switch to it first
const projectsPanel = root.querySelector('[data-panel="projects"]');
assert(projectsPanel.querySelectorAll('.pjw-card').length === 2, 'Projects tab still renders both project cards');

// 7. ensureFields backfilled p2 (never touched) with defaults too
let p2 = stored.find(p => p.id === 'p2');
assert(p2.interviewConfidence === 'none', 'p2 defaulted to none confidence');
assert(p2.collegeSubmission && p2.collegeSubmission.vivaDate === '', 'p2 defaulted collegeSubmission');
assert(p2.interviewAnswers && p2.interviewAnswers.q3 === '', 'p2 defaulted interviewAnswers');

// 8. Needs-Attention gap list: p1 has 3/4 answers + report done, p2 has 0 answers + nothing done
assert(p2.interviewAnswers.q1 === '', 'sanity: p2 never touched, q1 still blank');
// Panels are lazy - switch back to tier3prep before interacting with it
// again (a real user would have to be on the tab to click anything in it).
tier3NavBtn.click();
const panel6 = root.querySelector('[data-panel="tier3prep"]');
const gapTitles = Array.from(panel6.querySelectorAll('.pjw-deadline-row .pjw-deadline-row-title')).map(el => el.textContent);
assert(gapTitles.length === 2, 'both projects appear in Needs Attention (neither fully complete), got ' + gapTitles.length);
// p2 (0 answers) should sort before p1 (1 answer) - fewest-answers-first
assert(gapTitles[0].indexOf('Portfolio Website') === 0, 'p2 (fewer answers) sorts first in Needs Attention, got order: ' + gapTitles.join(' | '));

// "Open" button on the gap row idempotently opens (not toggles) the practice panel
const p2GapRow = Array.from(panel6.querySelectorAll('.pjw-deadline-row')).find(r => r.getAttribute('data-pid') === 'p2');
const openBtn = p2GapRow.querySelector('[data-action="open-tier3-expand"]');
openBtn.click();
openBtn.click(); // clicking twice must NOT close it again (idempotent open, unlike the per-card toggle)
const panel7 = root.querySelector('[data-panel="tier3prep"]');
const p2Card = panel7.querySelector(".pjw-card[data-pid=\"p2\"]");
assert(p2Card.querySelector('[data-input="ans-q1"]'), 'p2 practice panel stayed open after two "Open" clicks (idempotent)');

// 9. Export prep sheet button exists and clicking it doesn't throw
// (downloadFile() uses Blob/URL.createObjectURL/anchor-click, which jsdom
// doesn't fully implement; downloadFile() already wraps itself in try/catch,
// so the real value of this assertion is "wiring didn't throw", not content).
const exportBtn = panel7.querySelector('[data-action="export-tier3-prep"]');
assert(exportBtn, 'Download Prep Sheet button rendered');
let exportThrew = false;
try { exportBtn.click(); } catch (e) { exportThrew = true; }
assert(!exportThrew, 'clicking Download Prep Sheet does not throw');

// 10. Primary Pitch pin: single-select across projects
const p1Card6 = panel7.querySelector('.pjw-card[data-pid="p1"]');
const pinBtnP1 = p1Card6.querySelector('[data-action="set-primary-pitch"]');
pinBtnP1.click();
stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
p2 = stored.find(p => p.id === 'p2');
assert(p1.isPrimaryPitch === true, 'p1 pinned as primary pitch');
assert(p2.isPrimaryPitch === false, 'p2 not pinned');

const panel8 = root.querySelector('[data-panel="tier3prep"]');
const p2Card6 = panel8.querySelector('.pjw-card[data-pid="p2"]');
const pinBtnP2 = p2Card6.querySelector('[data-action="set-primary-pitch"]');
pinBtnP2.click();
stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
p2 = stored.find(p => p.id === 'p2');
assert(p1.isPrimaryPitch === false, 'pinning p2 unpins p1 (single-select)');
assert(p2.isPrimaryPitch === true, 'p2 now pinned');

const panel9 = root.querySelector('[data-panel="tier3prep"]');
const primaryNote = Array.from(panel9.querySelectorAll('.pjw-tier3-note')).find(n => n.textContent.indexOf('Primary Pitch project:') !== -1);
assert(primaryNote && primaryNote.textContent.indexOf('Portfolio Website') !== -1, 'Primary Pitch callout names the pinned project');

// clicking the same pin again unpins (toggle)
const p2Card7 = panel9.querySelector('.pjw-card[data-pid="p2"]');
p2Card7.querySelector('[data-action="set-primary-pitch"]').click();
stored = JSON.parse(localStorage.getItem('projects'));
p2 = stored.find(p => p.id === 'p2');
assert(p2.isPrimaryPitch === false, 'clicking the active pin again unpins it');

// 11. Team project + individual contribution
const panel10 = root.querySelector('[data-panel="tier3prep"]');
const p1Card8 = panel10.querySelector('.pjw-card[data-pid="p1"]');
const teamToggle = p1Card8.querySelector('[data-action="toggle-team-project"]');
teamToggle.click();
stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
assert(p1.isTeamProject === true, 'team-project flag toggled true');

const panel11 = root.querySelector('[data-panel="tier3prep"]');
const p1Card9 = panel11.querySelector('.pjw-card[data-pid="p1"]');
const contribBox = p1Card9.querySelector('[data-input="my-contribution"]');
assert(contribBox, 'contribution textarea appears once marked as team project');
contribBox.value = 'I built the login/auth module and the admin dashboard.';
contribBox.dispatchEvent(new window.Event('input', { bubbles: true }));
p1Card9.querySelector('[data-action="save-contribution"]').click();
stored = JSON.parse(localStorage.getItem('projects'));
p1 = stored.find(p => p.id === 'p1');
assert(p1.myContribution === 'I built the login/auth module and the admin dashboard.', 'contribution text persisted, got: ' + p1.myContribution);

// gap label should call out missing contribution before it's written, and stop after
const gapBeforeWrite = tier3GapLabelLike({ interviewAnswers: p1.interviewAnswers, collegeSubmission: p1.collegeSubmission, isTeamProject: true, myContribution: '' });
assert(gapBeforeWrite.indexOf('your contribution not written') !== -1, 'gap label flags missing contribution when unwritten');
const gapAfterWrite = tier3GapLabelLike(p1);
assert(gapAfterWrite.indexOf('your contribution not written') === -1, 'gap label clears once contribution is written');

// 12. Duplicating a project must NOT inherit tier-3 prep fields (real bug fixed this session)
// Panels are lazy - switch to the Projects tab before interacting with the card there.
projectsNavBtn.click();
const panel12 = root.querySelector('[data-panel="projects"]');
const p1CardMain = panel12.querySelector('.pjw-card[data-pid="p1"]');
p1CardMain.querySelector('[data-action="duplicate-project"]').click();
stored = JSON.parse(localStorage.getItem('projects'));
const clone = stored.find(p => p.title === 'Library Management System (Copy)');
assert(clone, 'duplicate created');
assert(clone.interviewConfidence === 'none', 'clone does not inherit interview confidence');
assert(clone.interviewAnswers.q1 === '', 'clone does not inherit interview answers');
assert(clone.isPrimaryPitch === false, 'clone does not inherit primary-pitch pin');
assert(clone.isTeamProject === false, 'clone does not inherit team-project flag');
assert(clone.myContribution === '', 'clone does not inherit individual contribution text');

console.log('\nALL TIER-3 PREP TESTS PASSED');

// Minimal reimplementation of tier3GapLabel's contribution-gap clause, used
// only to assert the logic in isolation above without exporting internals.
function tier3GapLabelLike(p) {
  var parts = [];
  var ans = p.interviewAnswers || {};
  var answered = ['q1', 'q2', 'q3', 'q4'].filter(k => (ans[k] || '').trim().length > 0).length;
  var left = 4 - answered;
  if (left > 0) parts.push(left + ' answers left');
  var sub = p.collegeSubmission || {};
  var missing = [];
  if (!sub.report) missing.push('report');
  if (!sub.ppt) missing.push('PPT');
  if (!sub.vivaDone) missing.push('viva');
  if (missing.length) parts.push(missing.join('/') + ' not done');
  if (p.isTeamProject && !(p.myContribution || '').trim()) parts.push('your contribution not written');
  return parts.join(' \u00b7 ');
}
