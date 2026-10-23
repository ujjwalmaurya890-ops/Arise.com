/**
 * test-cse-readiness-score.cjs
 * Smoke tests for the Readiness Score hero panel that sits at the top of the
 * CSE Syllabus+ (unified) widget — features/semester-risk/cse-syllabus-unified-widget.js
 *
 * Run:  node test-cse-readiness-score.cjs      (needs jsdom, already in package.json)
 * Exit: 0 = all green, 1 = at least one FAIL line.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BASE = path.join(__dirname, 'features', 'semester-risk');
const CFG = fs.readFileSync(path.join(BASE, 'cse-full-syllabus-config.js'), 'utf8');
const WID = fs.readFileSync(path.join(BASE, 'cse-syllabus-unified-widget.js'), 'utf8');
const PCF = path.join(__dirname, 'features', 'cse-placement-critical', 'cse-placement-critical-config.js');
const PC = fs.existsSync(PCF) ? fs.readFileSync(PCF, 'utf8') : '';

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.error('FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

function boot(seed) {
  const dom = new JSDOM('<!doctype html><html><body><div id="sem-1"></div></body></html>', { url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window, store = Object.assign({}, seed || {});
  Object.defineProperty(w, 'localStorage', { configurable: true, value: {
    getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; }
  } });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.navigator.clipboard = { writeText: () => Promise.resolve() };
  w.eval(CFG); if (PC) w.eval(PC); w.eval(WID);
  if (w.document.readyState === 'loading') w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, d: w.document, store };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = o => JSON.stringify(o);

(async () => {
  /* 1 ─ mounts at the very top, empty state = 0 % Beginner */
  {
    const { w, d } = boot();
    const root = d.getElementById('csu-unified-root');
    ok(!!root, 'unified widget mounts');
    const rs = root.querySelector('.csu-rs');
    ok(!!rs, 'readiness panel present');
    ok(root.firstElementChild === rs, 'readiness panel is the FIRST block in the widget');
    ok(root.querySelector('.csu-header') && rs.compareDocumentPosition(root.querySelector('.csu-header')) & 4, 'original header still renders below it');
    eq(root.querySelectorAll('.csu-rs-pill').length, 5, 'five level pills');
    eq(root.querySelectorAll('.csu-rs-segfill').length, 5, 'five milestone segments');
    eq(root.querySelectorAll('.csu-rs-stat').length, 4, 'four stat cards');
    const api = w.__ARISE_CSE_READINESS_API__;
    ok(!!api, 'API exposed');
    const c = api.compute();
    eq(c.pct, 0, 'score 0 when nothing done');
    eq(c.level.info.key, 'beginner', 'Beginner at 0%');
    ok(root.querySelector('.csu-rs-chipl').textContent.indexOf('Beginner') !== -1, 'level chip says Beginner');
    ok(/Readiness Score/.test(rs.textContent) && /CSE Syllabus Mastery/.test(rs.textContent), 'eyebrow + title text');
    ok(c.gap && c.gap.next.key === 'intermediate' && c.gap.pts === 20, 'gap to Intermediate = 20 pts at 0%');
  }

  /* 2 ─ score maths: weighted vs credit vs simple, checked against an independent calc */
  {
    const probe = boot();
    const cfg = probe.w.AriseCSEFullSyllabusConfig, subs = cfg.SUBJECTS;
    const doneIds = subs.slice(0, Math.ceil(subs.length / 3)).map(s => s.id);
    const prog = {}; doneIds.forEach(i => { prog[i] = true; });
    const diff = {}; subs.slice(0, 5).forEach(s => { diff[s.id] = 5; });
    const seed = { 'cse-syllabus-progress-v1': J(prog), 'cse-syllabus-difficulty-v1': J(diff) };
    const { w, d } = boot(seed);
    const api = w.__ARISE_CSE_READINESS_API__;
    const wgt = s => Math.max(1, Number(s.credits) || 1) * (diff[s.id] || 3);
    let tw = 0, gw = 0; subs.forEach(s => { tw += wgt(s); if (prog[s.id]) gw += wgt(s); });
    const expW = Math.round(gw / tw * 100);
    const c = api.compute();
    ok(Math.abs(c.pct - expW) <= 1, 'weighted score matches independent calc (' + c.pct + ' vs ' + expW + ')');
    eq(c.done, doneIds.length, 'done count');
    eq(c.remaining, subs.length - doneIds.length, 'remaining count');
    const root = d.getElementById('csu-unified-root');
    const vals = [...root.querySelectorAll('.csu-rs-statv')].map(n => n.textContent);
    eq(vals[0], String(doneIds.length), 'Completed card');
    eq(vals[1], String(subs.length - doneIds.length), 'Remaining card');
    eq(vals[3], Math.round(doneIds.length / subs.length * 100) + '%', 'Completion card = simple %');
    ok(c.level.index === api.getLevel(c.pct).index, 'level matches score band');

    root.querySelector('[data-rs-mode="simple"]').click();
    eq(api.compute().mode, 'simple', 'mode switches to simple');
    eq(api.compute().pct, Math.round(doneIds.length / subs.length * 100), 'simple score = plain completion');
    root.querySelector('[data-rs-mode="credit"]').click();
    let tc = 0, gc = 0; subs.forEach(s => { const x = Math.max(1, Number(s.credits) || 1); tc += x; if (prog[s.id]) gc += x; });
    ok(Math.abs(api.compute().pct - Math.round(gc / tc * 100)) <= 1, 'credit mode matches independent calc');
    ok(d.getElementById('csu-unified-root').querySelector('[data-rs-mode="credit"]').getAttribute('data-active') === '1', 'mode button reflects choice');
    ok(w.localStorage.getItem('csu-rs-mode-v2') === '"credit"', 'mode persisted');
  }

  /* 3 ─ partial credit from unit coverage never reaches full until ticked */
  {
    const probe = boot();
    const withUnits = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS.find(s => s.units && s.units.length);
    if (withUnits) {
      const up = {}; up[withUnits.id] = {}; up[withUnits.id][withUnits.units[0].id] = true;
      const { w } = boot({ 'cse-syllabus-topic-progress-v1': J(up) });
      const c = w.__ARISE_CSE_READINESS_API__.compute();
      ok(c.pct >= 0 && c.partial >= 1, 'covered units count as in-progress');
    } else ok(true, 'no unit data in config (skipped)');
  }

  /* 4 ─ interactions: pill detail, details toggle, semester jump, stat jump */
  {
    const { w, d } = boot();
    const root = () => d.getElementById('csu-unified-root');
    root().querySelector('[data-rs-pill="2"]').click();
    ok(!!root().querySelector('.csu-rs-pilldetail'), 'clicking a level pill shows its detail');
    ok(/Advanced/.test(root().querySelector('.csu-rs-pilldetail').textContent), 'detail names the level');
    root().querySelector('[data-rs-pill="2"]').click();
    ok(!root().querySelector('.csu-rs-pilldetail'), 'clicking again hides detail');

    ok(!!root().querySelector('.csu-rs-details'), 'details open by default');
    root().querySelector('[data-rs-toggle]').click();
    ok(!root().querySelector('.csu-rs-details'), 'details collapse');
    eq(w.localStorage.getItem('csu-rs-open-v2'), 'false', 'collapsed state persisted');
    root().querySelector('[data-rs-toggle]').click();
    ok(!!root().querySelector('.csu-rs-details'), 'details re-open');

    const chip = root().querySelector('.csu-rs-semchip');
    ok(!!chip, 'per-semester chips render');
    const sem = chip.getAttribute('data-rs-sem');
    chip.click();
    const sel = root().querySelector('#csu-sem-filter');
    ok(sel && sel.value === sem, 'semester chip opens that semester in Subjects tab');

    root().querySelector('[data-rs-go="Pending"]').click();
    const st = root().querySelector('#csu-status-filter');
    ok(st && st.value === 'Pending', 'Remaining card filters Subjects to Pending');

    root().querySelector('[data-rs-go="priority-tab"]').click();
    eq(root().querySelector('.csu-tab-btn[data-active="1"]').getAttribute('data-tab'), 'priority', 'Priority shortcut switches tab');

    const move = root().querySelector('[data-rs-move]');
    ok(!!move, 'Next-best-move button present');
    const mid = move.getAttribute('data-rs-move');
    move.click();
    ok(root().querySelector('.csu-tab-btn[data-active="1"]').getAttribute('data-tab') === 'subjects', 'Next best move opens Subjects tab');
    ok(!!root().querySelector('[data-toggle-id="' + mid + '"]'), 'Next best move shows that subject');
  }

  /* 5 ─ copy summary */
  {
    const { w, d } = boot();
    let copied = '';
    w.navigator.clipboard.writeText = t => { copied = t; return Promise.resolve(); };
    d.querySelector('[data-rs-copy]').click();
    await sleep(20);
    ok(/CSE Syllabus Readiness: 0% · Beginner/.test(copied), 'summary text copied');
    ok(/Next best move:/.test(copied), 'summary names the next move');
  }

  /* 6 ─ history, trend and level-up banner */
  {
    const probe = boot();
    const subs = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS;
    const seed = { 'csu-rs-level-seen-v3': J({ weighted: 0 }) };
    const prog = {}; subs.forEach(s => { prog[s.id] = true; });
    seed['cse-syllabus-progress-v1'] = J(prog);
    const { w, d, store } = boot(seed);
    const root = d.getElementById('csu-unified-root');
    eq(w.__ARISE_CSE_READINESS_API__.compute().pct, 100, '100% when everything done');
    ok(!!root.querySelector('.csu-rs-banner'), 'level-up banner appears when level rises');
    ok(/Job Ready/.test(root.querySelector('.csu-rs-banner').textContent), 'banner names the new level');
    root.querySelector('[data-rs-dismiss]').click();
    ok(!root.querySelector('.csu-rs-banner'), 'banner dismisses');
    eq(JSON.parse(store['csu-rs-level-seen-v3']).weighted, 4, 'seen level stored per mode');
    ok(/Top level reached/.test(root.querySelector('.csu-rs-nextline').textContent), 'top-level message at 100%');
    const h = JSON.parse(store['csu-rs-history-v3'] || '{}');
    ok(Object.keys(h).length === 1 && Object.values(h)[0].weighted === 100 && Object.values(h)[0].simple === 100, 'today recorded in history for every mode');
  }
  {
    const { d } = boot();   /* first ever visit: no banner even though seen-key is unset */
    ok(!d.querySelector('.csu-rs-banner'), 'no banner on first visit');
  }
  {
    const probe = boot(), subs = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS;
    const day = n => { const x = new Date(Date.now() - n * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const E = v => ({ weighted: v, credit: v, simple: v });
    const hist = {}; hist[day(9)] = E(5); hist[day(8)] = E(8); hist[day(3)] = E(10);
    const prog = {}; subs.slice(0, 8).forEach(s => { prog[s.id] = true; });
    const { d } = boot({ 'csu-rs-history-v3': J(hist), 'cse-syllabus-progress-v1': J(prog) });
    ok(d.querySelector('.csu-rs-spark-line'), 'sparkline renders with 2+ history points');
    ok(/vs 7 days ago/.test(d.querySelector('.csu-rs-delta').textContent), 'delta vs 7 days shown');
  }

  /* 7 ─ theme safety: every colour in the panel CSS is a CSS variable */
  {
    const { d } = boot();
    const css = d.getElementById('csu-rs-style').textContent;
    const stripped = css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '');   /* drop var(--x, fallback) incl. fallbacks */
    ok(!/#[0-9a-fA-F]{3,8}\b/.test(stripped), 'no hard-coded hex colours outside var() fallbacks');
    ok(!/\brgba?\(/.test(stripped), 'no hard-coded rgb()/rgba() colours');
    ok(!/\b(white|black)\b\s*[;}]/.test(stripped), 'no named white/black colours');
    ok(/prefers-reduced-motion/.test(css) && /forced-colors/.test(css), 'reduced-motion + forced-colors handled');
    const svg = d.querySelector('.csu-rs-ring').outerHTML;
    ok(!/#[0-9a-fA-F]{3,8}\b/.test(svg.replace(/url\(#[^)]*\)/g, '').replace(/id="csuRsGrad"/g, '')), 'ring SVG uses theme variables only');
    for (const t of ['light', 'dark', 'midnight']) {
      d.documentElement.setAttribute('data-theme', t);
      ok(!!d.querySelector('.csu-rs'), 'panel survives theme switch to ' + t);
    }
  }

  /* 8 ─ robustness: junk storage, XSS, no render loop */
  {
    const { w, d } = boot({
      'cse-syllabus-progress-v1': '{not json', 'cse-syllabus-difficulty-v1': '"x"',
      'csu-rs-history-v3': '[1,2]', 'csu-rs-mode-v2': '"bogus"', 'csu-rs-open-v2': '123'
    });
    ok(!!d.querySelector('.csu-rs'), 'renders despite corrupt storage');
    eq(w.__ARISE_CSE_READINESS_API__.compute().mode, 'weighted', 'unknown mode falls back to weighted');
  }
  {
    const custom = { added: [{ id: 'x1', name: '<img src=x onerror=window.__pwn=1>', credits: 4, type: 'Core', sem: 1, pc: false }], order: {}, removed: [], edits: {} };
    const { w, d } = boot({ 'cse-syllabus-custom-v1': J(custom) });
    d.querySelectorAll('.csu-rs [data-rs-pill]')[0].click();
    ok(!w.__pwn && !d.querySelector('.csu-rs img'), 'user-supplied subject names are escaped in the panel');
  }
  {
    const { w, d } = boot();
    await sleep(60);
    let n = 0; const mo = new w.MutationObserver(r => { n += r.length; });
    mo.observe(d.getElementById('csu-unified-root'), { childList: true, subtree: true, attributes: true, characterData: true });
    await sleep(600);
    mo.disconnect();
    ok(n < 80, 'no render loop while idle (' + n + ' mutations in 600ms, from the 0.7s count-up only)');
  }
  {
    const { w, d } = boot();
    const before = d.querySelector('.csu-rs-pct').textContent;
    await sleep(900);
    eq(d.querySelector('.csu-rs-pct').textContent, '0', 'count-up settles on the final number');
    ok(typeof before === 'string', 'count element exists at first paint');
  }


  /* 9 ─ upgrade: per-mode level-up + per-mode trend (switching mode must not fake a level-up or mix trends) */
  {
    const probe = boot(), subs = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS;
    const prog = {}; subs.slice(0, Math.ceil(subs.length * 0.45)).forEach(s => { prog[s.id] = true; });
    const seed = { 'cse-syllabus-progress-v1': J(prog), 'csu-rs-level-seen-v3': J({ weighted: 99 }) };
    const { w, d, store } = boot(seed);
    const root = () => d.getElementById('csu-unified-root');
    const api = w.__ARISE_CSE_READINESS_API__;
    root().querySelector('[data-rs-mode="simple"]').click();
    ok(!root().querySelector('.csu-rs-banner'), 'switching score mode never fires a level-up banner');
    const seen = JSON.parse(store['csu-rs-level-seen-v3']);
    ok(seen.simple === api.compute().level.index, 'each mode tracks its own seen level');
    const h = JSON.parse(store['csu-rs-history-v3']);
    const today = Object.keys(h)[0];
    ok(h[today].weighted != null && h[today].credit != null && h[today].simple != null, 'history stores all three modes');
    ok(h[today].simple === Math.round(Object.keys(prog).length / subs.length * 100), 'simple history value is plain completion');
  }

  /* 10 ─ upgrade: pace, ETA, streak from real completion timestamps */
  {
    const probe = boot(), subs = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS;
    const iso = n => new Date(Date.now() - n * 864e5).toISOString();
    const prog = {}, st = {};
    subs.slice(0, 6).forEach((s, i) => { prog[s.id] = true; st[s.id] = iso(i < 3 ? i : i + 4); });  /* today, 1d, 2d ago + 3 more in window */
    const { w, d } = boot({ 'cse-syllabus-progress-v1': J(prog), 'cse-syllabus-completion-timestamps-v1': J(st) });
    const c = w.__ARISE_CSE_READINESS_API__.compute();
    ok(c.pace.rate > 0, 'pace computed from timestamps (rate ' + (c.pace.rate && c.pace.rate.toFixed(3)) + ')');
    eq(c.pace.streak, 3, 'streak counts consecutive days ending today');
    ok(c.pace.n7 >= 3, 'this-week count');
    const txt = d.querySelector('.csu-rs-goal').textContent;
    ok(/pts\/week/.test(txt) && /≈/.test(txt), 'goal & pace block shows pace and ETA');
    ok(/3-day streak/.test(d.querySelector('.csu-rs-chips').textContent), 'streak chip');
    const e = w.__ARISE_CSE_READINESS_API__.eta(10, 0.5);
    eq(e.days, 20, 'eta = remaining / rate');
    ok(w.__ARISE_CSE_READINESS_API__.eta(0, 1).done, 'eta done when nothing remains');
    ok(w.__ARISE_CSE_READINESS_API__.eta(10, null) === null, 'eta null without a pace');
    ok(w.__ARISE_CSE_READINESS_API__.eta(10, 0.001).far, 'eta flags 2+ years');
  }
  {
    const { d } = boot();
    ok(/Mark 2\+ subjects done/.test(d.querySelector('.csu-rs-goal').textContent), 'no-pace hint when nothing completed');
  }

  /* 11 ─ upgrade: goal level + date, status, persistence, clear */
  {
    const { w, d, store } = boot();
    const root = () => d.getElementById('csu-unified-root');
    ok(root().querySelector('#csu-rs-goal-date').disabled, 'date disabled until a goal level is picked');
    const sel = root().querySelector('#csu-rs-goal-level');
    sel.value = '4'; sel.dispatchEvent(new w.Event('change'));
    eq(JSON.parse(store['csu-rs-goal-v1']).level, 4, 'goal level persisted');
    ok(!root().querySelector('#csu-rs-goal-date').disabled, 'date enabled once goal set');
    const dt = root().querySelector('#csu-rs-goal-date');
    const fut = new Date(Date.now() + 60 * 864e5), ymd = fut.getFullYear() + '-' + String(fut.getMonth() + 1).padStart(2, '0') + '-' + String(fut.getDate()).padStart(2, '0');
    dt.value = ymd; dt.dispatchEvent(new w.Event('change'));
    eq(JSON.parse(store['csu-rs-goal-v1']).date, ymd, 'goal date persisted');
    ok(/Need .* pts\/week/.test(root().querySelector('.csu-rs-goalstatus').textContent), 'weekly target shown for a future date');
    const dt2 = root().querySelector('#csu-rs-goal-date');
    dt2.value = '2001-01-01'; dt2.dispatchEvent(new w.Event('change'));
    eq(JSON.parse(store['csu-rs-goal-v1']).date, '', 'past dates are rejected');
    root().querySelector('[data-rs-goal-clear]').click();
    ok(store['csu-rs-goal-v1'] == null, 'clear removes goal');
    ok(/Pick a target level/.test(root().querySelector('.csu-rs-goalstatus').textContent), 'prompt after clearing');
  }
  {
    const probe = boot(), subs = probe.w.AriseCSEFullSyllabusConfig.SUBJECTS;
    const prog = {}; subs.slice(0, Math.ceil(subs.length * 0.3)).forEach(s => { prog[s.id] = true; });
    const { d } = boot({ 'cse-syllabus-progress-v1': J(prog), 'csu-rs-goal-v1': J({ level: 1, date: '' }) });
    ok(/Goal reached/.test(d.querySelector('.csu-rs-goalstatus').textContent), 'goal reached state');
  }
  {
    const { d } = boot({ 'csu-rs-goal-v1': '{"level":"abc"}' });
    ok(!!d.querySelector('.csu-rs'), 'corrupt goal ignored');
  }

  /* 12 ─ upgrade: breakdown + how-it-works */
  {
    const { w, d } = boot();
    const root = () => d.getElementById('csu-unified-root');
    ok(root().querySelectorAll('.csu-rs-bar').length >= 2, 'breakdown bars render');
    ok(/Placement-critical/.test(root().querySelector('.csu-rs-bars').textContent), 'placement-critical bar');
    ok(!root().querySelector('.csu-rs-how'), 'explainer hidden by default');
    root().querySelector('[data-rs-how]').click();
    ok(/How this score works/.test(root().querySelector('.csu-rs-how').textContent), 'explainer opens');
    root().querySelector('[data-rs-how]').click();
    ok(!root().querySelector('.csu-rs-how'), 'explainer closes');
  }

  /* 13 ─ upgrade: panel DOM is reused across unrelated re-renders (no ring flicker while typing) */
  {
    const { w, d } = boot();
    const root = () => d.getElementById('csu-unified-root');
    root().querySelector('[data-tab="subjects"]').click();
    await sleep(900);
    const before = root().querySelector('.csu-rs');
    const input = root().querySelector('#csu-search') || root().querySelector('input[type="search"], input[type="text"]');
    if (input) {
      input.value = 'data'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
      await sleep(50);
      ok(root().querySelector('.csu-rs') === before, 'readiness panel node survives a search re-render');
      const pill = before.querySelector('[data-rs-pill="1"]'); pill.click();
      ok(root().querySelector('.csu-rs') !== before, 'panel is rebuilt when its own state changes');
      ok(!!root().querySelector('.csu-rs-pilldetail'), 'pill detail still works after reuse');
    } else ok(true, 'no search input found (skipped)');
  }

  console.log((fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
