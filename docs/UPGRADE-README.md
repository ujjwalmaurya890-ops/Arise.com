# ✅ v229: Cross-browser compatibility pass (static audit + low-risk fixes)

**Not browser-tested.** No Chrome, Edge, Firefox, Safari, Brave or mobile browser was available in this environment, so none of these fixes was verified in a real browser. Verification was code reading, a JS parser scan, jsdom/Node tests, and the new source-level guard `tests/test-cross-browser-compat.cjs`.

Fixed:
- `-webkit-backdrop-filter` added beside every unprefixed-only `backdrop-filter: blur()` (Safari before 18 ignores the unprefixed property): `exam-tracker.css` (2) and the injected styles of `dev-/dsa-mastery-premium`, `dev-/dsa-mastery-trend`, `focus-timer-upgrade`, `hackathon-expense-tracker`, `placement-command-center`, `water-reminder`, `learning-heatmap` widgets.
- Download blob URLs were revoked in the same tick as `click()` (`backup-center` JSON + ZIP, `placement-tracker` backup, `notes-app` export) or after 0 ms (`cgpa-tracker`, `hackathon-tracker`). Safari and Firefox can cancel or empty such downloads. All now revoke after 1 s, matching the other exporters; the placement-tracker anchor is also attached to the DOM before the click.
- `localStorage` reads that sat inside a `catch` fallback (so a blocked-storage `SecurityError` would throw again): `battle-plan`, `readiness-50lpa`, `readiness-path-planner`, and `hackathon-expense-tracker` load. Each now returns its default.
- `styles/widget-nav.css`: the active pill keeps a plain background/border fallback before its `color-mix()` declarations.
- Chunks rebuilt (`node scripts/tools/build-widget-chunks.cjs`); service worker cache name `v229-cross-browser` (the only service-worker edit, plus the build script's chunk list).

Deliberately NOT changed (see the Part 5 report): service-worker lifecycle, loader/chunk fallback, `placement-storage.save()` (throws on quota errors by design), the `localStorage.setItem` wrapper in `cse-syllabus-plus-v144-patch.js`, `localStorage.clear()` in the bundle's reset button, and the `navigator.brave` perf-lite heuristic.

Tests: `tests/test-cross-browser-compat.cjs` 11/11 (8 of its checks fail on v228). Full suite otherwise identical to v228: the same 3 pre-existing failures (`test-aptitude-practice`, `test-session-analytics`, `test-session-analytics-v153`).

# ✅ v225: Widget chunks (101 requests -> 12) + focus-timer layout race

Measured in headless Chromium, 4x CPU throttle. The ~100 widget scripts each cost a service-worker round trip (and Brave Shields inspection), which dominated load after v224 fixed the SW stall.

- **Chunking.** `node scripts/tools/build-widget-chunks.cjs` merges the ordered `SCRIPTS` list into 12 content-hashed chunks (`assets/chunks/wNN.<hash>.js`, ~280 KB each) and writes the `CHUNKS` / `CHUNK_FILES` block in `index.html` (between the `/*CHUNKS:START*/` markers) plus the service-worker cache list. Each source file is wrapped in its own `try{}` so one widget's runtime error is re-thrown asynchronously (still reported) and never stops the next one. All 101 files were checked with a parser: only plain top-level expression statements (no top-level var/let/const/class/function, no leading "use strict", no `document.currentScript`), so scope and strictness are unchanged.
- **Fallback + switch.** If a chunk fails to load, the loader loads that chunk's original files one by one, in order. `?chunks=0` or `localStorage['arise-chunks']='off'` disables chunking entirely. The individual files are still shipped and still in the SW offline list.
- **After editing any widget script, re-run `node scripts/tools/build-widget-chunks.cjs`.** `tests/test-widget-chunks.cjs` fails if a chunk is stale.
- **Focus timer layout race (pre-existing, found while testing).** `src/focus-timer-upgrade-widget.js` inserted its Linked-task block after `.ambient-sound-controls` if that existed yet, else after the Start/Reset row, so the block landed in a different place run-to-run (even in v221: 2 of 3 runs at normal CPU speed). It now inserts after whichever anchor is last in the DOM: 10 of 10 runs identical in both modes.
- Measured (4x CPU): widgets ready 5.8-6.6 s -> 3.3-3.6 s; script requests 142-147 -> 35; with the service worker on: first visit 6.2 s -> 4.2 s, repeat visits 4.4 s -> 3.3 s / 1.9 s. Chunked, unchunked and chunk-blocked fallback give identical window globals and identical section content.
- Tests: new `tests/test-widget-chunks.cjs` (51 checks). Full suite: only the failures that already fail on v221 remain (`test-aptitude-practice`, `test-session-analytics`, `test-session-analytics-v153`).
- Service worker cache: `v225-widget-chunks`.

# ✅ v224: Service-worker stall on first visit / every update (the real Brave lag)

Reproduced in headless Chromium with the service worker enabled (earlier profiling had it blocked, which hid this). With the SW active, widgets finished at ~28 s on a first visit vs ~4 s with it blocked; repeat visits were fine (~4 s). Cause, in `service-worker.js` + the bundle's SW bootstrap:

- `activate` waited 12 s and then downloaded ~110 files one at a time (400 ms apart) INSIDE `event.waitUntil`. Fetch events are held until activation finishes, so every widget script request stalled behind it. Every deploy changes `CACHE_NAME`, so every new version re-triggered this.
- The bundle called `window.location.reload()` on every `controllerchange`, including the very first install, so the page loaded, started the widget loader, then reloaded and started over.

Fixes:
- `service-worker.js`: activation now only deletes old caches and claims clients (no 12 s delay, no cache fill). The extended-cache warm-up runs from a new `message` handler (`arise-fill-cache`).
- `index.html`: after widgets are ready + 5 s, the page posts `arise-fill-cache` to the controlling SW.
- `assets/app-bundle.js`: no reload on the first install; on a real update, reload once, only after widgets are ready (+0.8 s).
- Measured (4x CPU throttle): first visit 28.8 s -> 6.2 s to widgets ready; update visit 4.8 s to widgets ready, then one reload.
- Service worker cache: `v224-sw-activate-nonblocking`.

# ✅ v223: Widgets open blank / slow right after load (loader expedite)

Measured in headless Chromium at 4x CPU throttle (no network delay): the ~100 widget scripts only finished at ~6.2 s, and any section opened before that rendered as an empty shell (e.g. 42-46 characters of text) because the React shell had already called `__mountX` before the widget file existed. The loader started only after `load` + up to 2 s of `requestIdleCallback`, then loaded 6 scripts per batch with a rAF + idle pause between batches.

- `index.html` lazy loader: starts 50 ms after `load` (was idle callback, 2 s timeout).
- New `window.__ariseExpedite()`: called on the first pointer/key/touch press and by every early `__mountX` stub. It starts the loader if needed, cancels the pending yield, and loads all remaining scripts in one ordered pass (same `async=false` order, so redefined globals still resolve identically). Prewarm fetches stop once expedited.
- Batch size 6 -> 8 and yield fallback 200 ms -> 100 ms for the un-expedited path.
- Result (same harness): sections opened right after load now have real content (💰 section 2451 chars vs 42 before); plain load with no interaction 6.2 s -> 5.0 s.
- Service worker cache: `v223-widget-loader-expedite` (changed so browsers drop the old cached index.html).

# ✅ v222: Observer consolidation + last blur leak (Brave lag follow-up)

Profiled what still runs after v219–v221 land. Head/loader are fine (all non-critical CSS/JS is deferred, widgets inject in idle batches). Two leftovers remained:

- **Private full-page MutationObservers.** Five scripts still ran their own `subtree` observer on `<html>`/`<body>` instead of the shared `mutation-bus` (every DOM change fired each one separately, un-coalesced). `src/a11y-color-patch.js` was the worst: after any change it re-ran 5 `querySelectorAll` families over the *entire* document. Now: `src/a11y-color-patch.js`, `src/a11y-toast-patch.js`, `src/focus-timer-upgrade-widget.js`, `src/local-files-widget.js` and the second observer in `cse-syllabus-plus-widget.js` subscribe to the bus (falling back to their old observer if the bus is absent). The two a11y patches scan only newly-added subtrees (full-document scan only for bursts of >40 nodes or attribute changes).
- **Plain `.glass` still blurred.** v220's `[class*=glass-]` override needs a hyphen, so the bare `.glass` class (2 uses in the bundle) kept `blur(14px)`. Added `html[data-theme] .glass{backdrop-filter:none}` in `styles/theme.css`.
- Not changed on purpose: `src/animation-upgrade.js` (loads before the bus, already throttled to 24 nodes/batch), `src/theme-quick-toggle.js` (attribute-only), `placement-tracker-new-features.js` (scoped to its own container).
- Known limit: the bus watches `childList` only, so an in-place `data-level`/`data-tone` change with no node insertion is no longer re-labelled until the next insertion. Widgets re-render nodes, so this isn't hit today.
- Tests: new `tests/test-a11y-observers-v222.cjs` (jsdom, passes); `test-widget-nav-lazy-panels` 37/37, `test-syllabus-unified-features` 104/104, `test-readiness-path-planner` 37/37. `test-session-analytics-v153` fails on v221 too (pre-existing `__LA_EXPOSE__`), untouched.
- Service worker cache: `v222-observer-consolidation-glass-fix`.

# ✅ v221: Load lag + Brave lag (shared mutation bus, perf-lite mode, routing fix)

- `src/mutation-bus.js`: ~35 widgets subscribe to one document-wide MutationObserver. Every DOM change ran all of them immediately, hundreds of times while ~100 widgets mount. Deliveries are now **coalesced** (one fan-out per 250 ms while loading, 60 ms after; full record list, order kept, 5000-record safety flush). Same API.
- `src/career-command-center-widget.js`: its score count-up wrote to the DOM every frame un-muted, which the batching exposed as a render ping-pong with the readiness card (found by `tests/test-readiness-path-planner.js`). Count-up writes are now muted.
- `index.html`: the 3 exam-tracker stylesheets no longer block first paint (async, like the other cosmetic CSS).
- **perf-lite mode** (auto-on in Brave, ≤4 cores / ≤4 GB RAM, or Data Saver): decorative infinite animations run 3 loops then rest (spinners/skeletons/shimmers excluded), leftover blur/drop-shadow/will-change layers removed. Force with `localStorage.setItem("arise-perf-mode","lite"|"full")` then reload.
- `_redirects`: `/api/codechef/*` and `/api/gfg/*` were missing, so the `/* → index.html` catch-all (processed first) returned HTML to the CP widget. Added.
- Service worker cache: `v221-bus-coalesce-perf-lite`.

# ✅ v220: Removed always-on GPU blur (site-wide scroll/interaction lag)

v219 fixed load-time main-thread work, but lag remained across the whole site. Root cause found in CSS: every `.glass*` / `.att-card` / `.skt-card` / `bg-cyber-card` card carried a live `backdrop-filter: blur()` **plus** `will-change: transform` (each card = its own GPU layer that re-blurs on every scroll/animation frame), and the sidebar and sticky header had `blur(20px) saturate(150%)` recomputed on every scroll frame. Their backgrounds are 92–100% opaque (`--surface`, `--navbar-bg: rgba(...,.92)`), so the blur was effectively invisible.

- `styles/theme.css`: card, sidebar and header `backdrop-filter` set to `none` (explicit `none`, so the older `blur()` rules in `app-styles.css` cannot come back), `will-change: transform` removed from cards.
- `assets/app-styles.css`: `.progress-fill:after` shimmer runs 3 times instead of forever.
- Modal overlays that use Tailwind `backdrop-blur-*` are untouched (only exist while open).
- Service worker cache: `v220-gpu-blur-removal`.

# ✅ v219: Load-jank fixes + service-worker bandwidth (performance & stability)

Profiled the load path again (static analysis + jsdom timing; script *evaluation* is cheap now — the lag came from main-thread layout work and background network contention while widgets mount).

**Fixes**
- `src/animation-upgrade.js`: every candidate card/row did `getBoundingClientRect()` (forces layout) and then `classList.add()` (invalidates layout) in one loop → one forced layout per element while widgets mounted (54 forced layouts for 60 cards in the test). Now all rects are read in one pass and classes written after (0 forced layouts), in slices of 150/frame. Duplicate full-document sweep at DOMContentLoaded removed. Behaviour is identical (same elements get the reveal effect).
- `src/a11y-color-patch.js` / `src/a11y-toast-patch.js`: the MutationObservers ran ~15 / 6 `querySelectorAll` sweeps over the whole document on **every frame** with DOM changes. Now throttled to at most one sweep per 300 ms / 250 ms.
- `styles/animation-upgrade.css`: progress-bar shimmer on every `[class*=-fill]` ran forever (dozens of permanently animating layers). Now plays 3 times then rests.
- `index.html` lazy widget loader: between script batches it now also waits for an idle slice (max 60 ms) so batches don't land in the middle of input/rendering. Execution order unchanged.
- `service-worker.js`: the background cache fill re-downloaded files the page had already loaded (it checked the cache only once at start) with `cache:"reload"` — now checks per file and revalidates conditionally; starts after 12 s instead of 8 s; Range requests (audio) are no longer intercepted (SW returned a full 200 instead of 206); cached JS/CSS counts as fresh for 1 h (was 10 min) → fewer background re-fetches per visit.
- Service worker cache: `v219-load-jank-and-sw-bandwidth`. No widget/storage logic touched.

**Not changed (needs source):** `assets/app-bundle.js` (1 MB, minified React build, no sourcemap) can't be code-split safely from the shipped file.

# ✅ v217: Readiness Score upgrade (CSE Syllabus Mastery widget)

Re-checked the v216 panel, fixed four real flaws and added features.

**Fixes**
- Switching score mode (Weighted / Credits / Simple) could fire a false "Level up!" banner — level-up is now tracked per mode (`csu-rs-level-seen-v3`).
- The 30-day trend mixed values from different modes — history now stores all three modes per day and the trend follows the active mode (`csu-rs-history-v3`).
- The panel was rebuilt on every keystroke in Subjects search (ring flicker) — its DOM is now reused when nothing in it changed.
- "Next best move" now has its own handler instead of sharing the Priority queue's, and the Priority queue is only computed when details are open.

**New**
- **Goal & pace**: pick a target level and an optional date; get on-track / behind status, the weekly points and ≈subjects/week you need, or an ETA at your current pace. Pace and ETAs for the next level and Job Ready come from your real completion dates (last 14 days).
- **Streak** and "+N this week" from completion dates.
- **Breakdown by type** (Core / Lab / Elective / Project) and a placement-critical bar.
- **How it's scored** explainer showing your earned weight → percentage.
- Semester chips show "Sem N" plus a short name; no duplicate trend text when there is no history; smaller milestone labels on phones.
- Checked in a real browser on Clean White, Ocean Blue, High Contrast Mono, Dracula and Cyber Midnight Pro, at desktop and 380px widths.
- Service worker cache: `v217-syllabus-readiness-score`. Tests: `node tests/test-cse-readiness-score.cjs` (98 checks).

# ✅ New this round (v216): Readiness Score on the CSE Syllabus Mastery widget

A Dev-Mastery-style **Readiness Score** hero panel now sits at the very top of the CSE Syllabus+ widget (`src/features/semester-risk/cse-syllabus-unified-widget.js`), above the existing header, KPIs and tabs. It is read-only on syllabus data and uses only theme CSS variables, so it follows every Arise theme (light, dark, high-contrast, forced-colors).

- **Score ring** with animated count-up, level chip and "+N% to next level · ≈K subjects".
- **5 level pills** (Beginner → Intermediate → Advanced → Expert → Job Ready, 20-point bands). Click a pill for what it takes; passed levels show ✓. Segmented **milestone bar** underneath.
- **Score modes** (Weighted / Credits / Simple, persisted): Weighted = credits × self-rated difficulty (unrated = 3) with partial credit for covered units; Credits = credit-weighted; Simple = plain completion.
- **Stat cards** (Completed / Remaining / Revision / Completion) — click to jump to the filtered Subjects list or the Overview tab.
- **Details** (collapsible): per-semester readiness chips (click to open that semester), 30-day trend sparkline with change vs 7 days, **Next best move** (top of the Priority queue, click to open it), and chips for due revisions, backlog risk, placement-critical progress and in-progress subjects.
- **Focus badge** for the weakest semester, **Copy summary**, and a dismissible **level-up banner** (never fires on first visit).
- Own storage keys (`csu-rs-*-v2`) so the older purge in the Syllabus+ panel cannot delete them. API: `window.__ARISE_CSE_READINESS_API__`.
- Service worker cache `v216-syllabus-readiness-score`. Test: `node tests/test-cse-readiness-score.cjs` (64 assertions); all existing syllabus tests unchanged and green.

# ✅ New this round (v207): Aptitude Practice tracker — feeds real Readiness

**Why:** aptitude is the first filter in most mass-recruiter/service drives and carries the biggest slice (23%) of the mass-recruiter readiness profile, yet the app had no way to log aptitude practice — Readiness used average *exam confidence* as a stand-in.

- **🧮 Aptitude tab** (in the DSA/placement card; `src/aptitude-practice-widget.js`): log timed sets by section (Quant, Logical, Verbal, Data Interpretation, Technical MCQ) and topic with attempted / correct / time / date (validated: whole numbers, correct ≤ attempted, no future dates). Shows 60-day accuracy, questions, avg sec/question, sets this week vs your weekly goal, per-section bars coloured against your target accuracy (adjustable), an accuracy trend, **Fix first** (10+ questions below target), **Going stale** (14+ days untouched) and **Never practised** topics, recent sets with delete.
- **Readiness integration:** the widget writes a summary (`arise-aptitude-summary-v1`); `src/readiness-engine.js` (`computeReadinessV2` → the main readiness score) and `placement-calculations.js` (placement probability) now use real aptitude accuracy once you have 30+ questions in the last 60 days, otherwise they keep the old exam-confidence proxy. Real data also clears the "missing aptitude" penalty, and its freshness feeds the stale-data check. Deleting all sets cleanly reverts. Saves dispatch `arise:career-updated` so the Career Readiness card and Command Center refresh immediately.
- Topic lists are common aptitude areas, not any one company's syllabus. Keys registered in `src/storage-keys.js`. Cache `v207-aptitude-tracker`; file added to `index.html` + service-worker precache.
- Tests: `node scripts/_run-test.cjs tests/test-aptitude-practice.js` (33 assertions: validation, analytics, engine integration incl. the 30-question gate, XSS/junk-data robustness, no render loop). DSA toolkit test updated for the new tab (68). Placement engine (171) and placement-tracker tests unchanged and green; same six pre-existing sandbox failures as v204.

# ✅ New this round (v206): Readiness — placement-date projection + render-loop fix

- **⏳ Placement-date projection** (Path Planner card): uses the placement date already stored in Session Analytics (`arise-la-config-v1.placementDate`), or lets you set it right on the card (only that one field is written; the rest of the analytics config is preserved). Shows days left, the pts/week you need for the next level, your recent pts/week from the card's history, where that pace lands you by the date, and on-track / behind. No pace is invented: it needs 3+ days of history, otherwise only the "needed per week" figure is shown. A past date is called out instead of showing negative days.
- **Perf:** the Career Readiness card, Career Command Center and Placement Command Center were re-rendering each other in a loop (~100 DOM mutations/second, measured, continuously). They now use `__ARISE_MUTATION_BUS__.mute()` (added in v204) — the card and Placement Command Center only mute once their own root exists, so first-time mounting still notifies dependants (the planner relies on this). Idle mutations after settling: 0. A real change (e.g. solving problems) still refreshes the card and planner. The Dev Mastery widget set was probed the same way and has no loop.
- Cache `v206-readiness-deadline-perf`. Tests: `tests/test-readiness-path-planner.js` now 37 assertions. Full suite unchanged (same six pre-existing sandbox failures as v204).

# ✅ New this round (v205): Readiness — Path Planner + specific daily actions

- **🧭 Path to next level** (`src/readiness-path-planner-widget.js`, sits under the Career Readiness / 50-LPA card): shows the points gap to the next level and, per lever (DSA / Development / CSE Syllabus / Consistency), the smallest number of actions that gets you there ("13 more DSA problems", "1 more Dev Skill Task", …), the points each action is worth, the lever with the best return per action, and a DSA ETA at your last-14-day pace. Every figure is a what-if run of the card's own calculator (`__ARISE_CAREER_READINESS_API__.calculateCareerReadiness`) on a copy of your data, so it can never disagree with the card and never mutates anything. Also adds a 30-day trend line with 7d / 30d change and best score (from the card's existing history key), and a caveat when a large imported backlog is dragging the DSA score down. Read-only, no new storage keys.
- **Career Command Center "Today's actions"** now name the actual work instead of generic text: the DSA action starts with a specific unsolved problem from your weakest topic, and the Dev action lists your next two incomplete Dev Skill Tasks (Critical → High → Medium → Low). All user text is HTML-escaped.
- Cache `v205-readiness-planner`; new file added to `index.html` + service-worker precache.
- Tests: `node scripts/_run-test.cjs tests/test-readiness-path-planner.js` (25 assertions, including a check that n actions reach the target and n−1 do not). Full suite unchanged: the same six pre-existing sandbox failures listed under v204, everything else green.

# ✅ New this round (v204): DSA Mastery — repairs + tier-3 placement toolkit

**Repairs (the DSA card was not rendering at all).**
- `src/dsa-mastery-premium-widget.js` failed to parse (missing `)` in the level-pill wiring + a stray `})` at the end of the wiring block), so the whole premium card, its tabs and every child widget never mounted. Fixed.
- `src/dsa-sheet-coverage-widget.js` failed to parse (mount lookup had been deleted: `if(t){,o=!t;`). Restored.
- Six Analytics mounts used ids their widgets never look for (`dmt-difficulty-radar`, `dmt-solve-speed`, `dmt-pace-projection`, `dmt-tier3-readiness`, `dmt-problem-insights`, `dmt-sparkline-mount`). Renamed to `ddr-…`, `dss-…`, `dpp-…`, `dt3-…`, `dpi-…`, `dws-…`. Problem Insights also now builds its inner block when handed an empty mount.

**Perf: constant re-render loop removed.** `bootUpdater` and the DSA direct bus subscribers re-rendered ~7×/second forever (each render's own DOM writes re-triggered the bus). New `__ARISE_MUTATION_BUS__.mute(fn)` drains the render's own echo records; `bootUpdater` (all widgets that use it) plus the premium card (update passes only), Problem Insights, Revision Queue and Placement Engine use it. Real external mutations (React commits, user actions) still notify everyone. Measured: 0 mutations in 2.5 s idle vs ~110/s before. Other widgets that subscribe to the bus directly (dev-*, hackathon-*, etc.) are unchanged and can adopt `mute` the same way.

**New DSA tabs / widgets** (all read-only on `dsaQuestions`; own storage keys registered in `src/storage-keys.js`)
- 🎯 **Daily Goal** (Overview): per-day solve target ring, 14-day strip, goal streak, evening streak-save nudge with an Easy quick-pick from your weakest topic. Key `dsaDailyGoal`.
- 🎯 **Mock OA** tab: timed practice (Quick 30m / Standard 60m / Marathon 90m) from your own unsolved bank, scope = all / 3 weakest topics / one topic. Timer survives refresh, auto-ends at zero, then forces a *why did I miss it* reason per unsolved problem and shows your most common miss with a fix. Keys `dsaMockOAActive/History/Settings`. Presets are generic practice formats, not company-official.
- 📚 **Playbook** tab: constraint→complexity table, 14 core patterns (cue / idea / cost / classic problems) with your solved+unaided counts from Problem Insights tags, complexity cheat sheet.
- 📤 **Proof Pack** tab: weekly report, resume bullets, LinkedIn post, GitHub README table — generated only from your logged numbers (mock lines appear only if mocks exist), Copy + Download .md.

Service worker cache bumped to `v204-dsa-tier3-toolkit`; the four new files are in `index.html` and the SW precache.
Tests: `node scripts/_run-test.cjs tests/test-dsa-tier3-toolkit.js` (67 assertions). Six older tests (`test-college-sync`, `test-cse-syllabus-readiness-panel`, `test-session-analytics(-v153)`, `test-subject-reorder`, `test-topic-units`) fail in this sandbox on `requestAnimationFrame`/`__LA_EXPOSE__` identically before and after these changes; all others pass.

# ✅ New this round: Expense Tracker — repeat-last shortcut + duplicate-entry safety net

Fifth scoped upgrade to `src/expenses.js`, continuing on the daily add flow. No
breaking changes.

**Repeat Last Transaction.** For habitual entries (daily coffee, a recurring
manual top-up) that don't rise to the level of setting up a full Recurring
rule, added a one-tap "🔁 Repeat '<title>' (±amount)" button above Add
Transaction. `repeatLastTx_()` finds the most recent transaction (by date,
then `createdAt`) and a click clones it — same title, amount, category/
income source, payment method, tags, and note — onto today's date with a
fresh id. Shows nothing if there are no transactions yet.

**Duplicate-entry warning with undo.** Accidentally submitting the same
title/amount/type/date twice (double-tap, browser back-and-resubmit, etc.)
previously logged silently. The main Add Transaction form now checks for an
existing match right before saving; the transaction is still added either
way (never silently blocked), but a duplicate triggers the same undo-toast
UI already used elsewhere in this widget for deletes — "Possible duplicate:
'Movie' ₹300 already logged today" with an Undo button that removes the
just-added entry. A normal, non-duplicate add shows no toast at all.

Verified: seeded a prior transaction, clicked Repeat and confirmed the clone
carries over title/amount/tags onto today's date; then seeded a same-day/
same-amount/same-title transaction, submitted an identical one through the
Add Transaction form, confirmed the duplicate toast text and that clicking
Undo removes exactly the new entry (original stays), and confirmed a
distinct entry immediately after produces no duplicate toast. Re-ran both
existing `test-expenses-*.js` suites — 36/36 still passing.

# ✅ New this round: Expense Tracker — faster daily expense & income entry

Fourth scoped upgrade to `src/expenses.js`, this time on the day-to-day add flow
rather than the PDF export. No breaking changes.

**Quick Income Entry.** The Transactions tab already had a one-tap "⚡ Quick
Expense Entry" (preset amounts + category chips) but nothing equivalent for
income — logging a stipend or allowance always meant the full Add
Transaction form. Added a matching "⚡ Quick Income Entry" block right above
it: preset amounts (₹100/500/1000/2000/5000 + Custom), one-tap source chips
(Stipend/Allowance/Freelance/Gift/Other, reusing the existing income-source
registry for labels/icons), a payment method selector, and a single-tap
submit — mirrors the expense version's interaction pattern exactly, new
`data-role="quick-income-form"` + `data-qi-amount`/`data-qi-source` actions.

**Title autocomplete.** The Add Transaction title field had no memory of
past entries — typing "Groceries" or "Coffee" from scratch every time. Added
a native `<datalist>` (`titleSuggestions_()`) populated with your up-to-12
most-frequently-used titles, scoped to whichever type (expense/income) is
currently selected in the form's toggle, so switching to Income shows past
income titles instead of expense ones. Native datalist means no extra JS
dependency and normal keyboard/mouse behavior (type to filter, click to
pick, or ignore and type something new).

Verified: seeded repeat "Groceries"/"Coffee" expense entries and confirmed
the datalist ranks "Groceries" first and clears when switching to the Income
type toggle; drove the Quick Income form through its chip clicks and confirmed
the resulting transaction has the right amount, `incomeSource`, and title.
Re-ran both existing `test-expenses-*.js` suites — 36/36 still passing.

# ✅ New this round: Expense Tracker — PDF export: remembers your settings + period-over-period deltas

Third scoped upgrade to the PDF/HTML export in `src/expenses.js`. No breaking changes.

**Remembers your export preferences.** Previously `H` (the export modal's
scope + checkbox state) was a plain in-memory object that reset to defaults
every page load — re-checking the same boxes every time you exported was the
missing piece. `H` now initializes from a new `arise-expenses-pdf-prefs-v1`
localStorage key (merged over the defaults, so older/missing keys don't
break anything), and every scope, custom-date, and checkbox change calls a
new `Hsave_()` to persist the whole state back. Open the export modal next
session and it's exactly how you left it.

**Period-over-period deltas in the Summary section.** When scope is "This
Month" or a "Custom Date Range", the three Summary cards (Income, Expense,
Net Balance) now show a small colored delta line — e.g. "↑ 25% vs last
period" — comparing against the immediately preceding period of equal length
(previous calendar month, or an equal-length window immediately before a
custom range). Direction coloring is metric-aware: rising income/balance is
green, rising expense is red (an expense increase isn't "good" even though
it's numerically up). No previous-period data, or scope "All"/"Filtered"
(no well-defined prior period) → deltas are simply omitted, no broken UI.

Verified: simulated a page reload (re-evaluated the widget module against
the same localStorage, without ever re-checking any box) and confirmed the
export modal reopened with the previously-chosen scope and checkbox state
intact; seeded August vs September transactions, mocked "today" into
September, and confirmed the generated report shows the correct +25%
income / +20% expense deltas with the expected green/red classes. Re-ran
both existing `test-expenses-*.js` suites — 36/36 still passing.

# ✅ New this round: Expense Tracker — PDF export: custom date range + visual donut chart

Second scoped upgrade to the PDF/HTML export in `src/expenses.js`, on top of the
previous round's new sections. No breaking changes.

**Custom date range scope.** The export modal's Scope dropdown previously
offered only "All / Current Filtered View / This Month". Added a fourth
option, "Custom Date Range", which reveals two date inputs (from/to). `mn()`
filters transactions by `date >= customFrom && date <= customTo` (either
bound optional), and `fn()` labels the report header with the resolved range
(e.g. "Custom Range (01 Sept 2026 – 30 Sept 2026)"). State persists on `H`
(`customFrom`/`customTo`) the same way the other scope/checkbox state does,
and the live count line updates as the dates are edited.

**Visual donut chart for category breakdown.** The Category Breakdown section
was a text/bar list only. Added `pdfDonut_()` — a dependency-free inline SVG
donut (stroke-dasharray segments, top 8 categories, "Other" categories still
counted in the underlying bar list below it) with a color-matched legend
showing each category's percentage of total spend. Also added a percentage-
of-total figure to every bar row across all three bar charts (category,
income source, payment method) via a shared change to `xn()`, so all of them
now show "₹X (Y%)" instead of just the amount.

Verified: reused a jsdom mount to switch scope to Custom Range with explicit
from/to dates, confirmed the transaction count and filtered contents (in-
range transaction present, out-of-range transaction absent) matched, and
confirmed the generated report HTML contains the donut `<svg>` markup and
percentage figures. Also re-ran both existing `test-expenses-*.js` suites —
36/36 still passing.

# ✅ New this round: Expense Tracker — loan partial repayments + richer PDF reports

Two scoped additions to `src/expenses.js`, no schema-breaking changes and fully
backward compatible with existing localStorage data.

**Loans — partial repayment.** Loans were previously binary (repaid /
not repaid) with no way to record a part-payment against an outstanding
loan. Each active loan row now has a "Log Payment" form; payments accumulate
in a new optional `paidAmount` field, the row shows remaining balance and
"paid so far", and the loan auto-flips to repaid once `paidAmount` reaches
the original `amount`. All loan totals (`Kr()`, the by-category grouping in
`Ii()`) were updated to compute outstanding/repaid from `amount - paidAmount`
instead of the old binary flag, so existing fully-repaid or untouched loans
(no `paidAmount` field) behave exactly as before.

**PDF / HTML export — four new optional sections.** The export modal
(`Dl()`/`Ml()`) gets four new checkboxes, off by default like the other
opt-in sections (income source chart, payment chart, recurring):

- Savings Goals — progress, target, pace
- Loans & IOUs — active loans (original/paid/remaining) and open IOU balances
- Investments — invested vs current value with gain/loss
- Net Worth Snapshot — assets, liabilities, net figure

Each is a standalone section builder (`pdfGoalsSection_`, `pdfLoansIouSection_`,
`pdfInvestmentsSection_`, `pdfNetWorthSection_`) reusing the widget's existing
calculation helpers (`Kr`, `Ei`, `Fi`, `ft`/`xt`, `rn`), wired into `_o(e)`
conditionally on the new flags and appended to the generated report right
before the footer. The "Copy Summary" clipboard text (`Al()`) also gained a
few extra lines (outstanding loans, IOU balances, active goal count, net
worth) whenever that data exists, regardless of checkbox state.

Verified with a jsdom mount: added a loan, logged a partial payment, confirmed
the stored `paidAmount`/`repaid` fields and the rendered remaining balance,
then re-ran the two existing `test-expenses-*.js` suites (36/36 passing) plus
a manual PDF-export smoke test confirming all four new sections appear in the
generated report with real data.

# ✅ New this round: Exam Tracker → adaptive exam-preparation command center

Upgrades ONLY the Exam Tracker feature from a passive exam database into an
adaptive preparation command center that answers: which exam is most
dangerous, why, what to study today, how to split your study hours, and
whether you're on track for your target marks. Deterministic + explainable
math only — no fake AI, no randomness, no network. All new fields are
backward compatible: v1 localStorage data migrates automatically on load
(storage schema v2, same `arise_exam_tracker_v1` key), and every consumer of
the public APIs (`__ARISE_EXAM_TRACKER_API__`, `AriseExamCalculations`,
`AriseExamStorage.load()`, raw `exams[]` readers) keeps working unchanged.

New files:

| File | Role |
| --- | --- |
| `src/features/exam-tracker/exam-tracker-intelligence.js` | Canonical intelligence engine (`window.AriseExamIntelligence`, also merged onto `AriseExamCalculations`). Pure, deterministic functions: `calculateExamRisk` (explainable 0-100 risk + Safe/Medium/High/Critical levels + reasons), `calculateWeakTopics` (one canonical weak-topic ranking feeding risk, plan, recommendations and the planner), `calculateSyllabusCoverage`, `calculatePyqReadiness`, `calculateStudyLoad` (priority water-filling hour allocator; the sum never exceeds capacity), `generateTodayPlan` (adaptive study blocks with a reserved active-recall slot; regenerates as topics progress), `detectBacklog`, `buildLearningInsights` (transparent descriptive stats), `calculateTargetRisk` (reuses `vtuPassProjection` — no duplicate VTU math), `sortExamsByRisk`. |
| `tests/test-exam-tracker-intelligence.js` | 224 deterministic tests: risk levels/edges (overdue, same-day, no date, completed, 20 exams), weak-topic signals, coverage, PYQ, study-load overload/zero-hours, plan generation, backlog, insights, target simulation, v1→v2 storage migration, malformed data, DOM smoke via jsdom. Run with `node scripts/_run-test.cjs tests/test-exam-tracker-intelligence.js` (the `.cjs` shim bridges the ESM package.json). |
| `_run-test.cjs` | Test runner shim: runs ESM tests directly, copies CJS/jsdom tests to a temp `.cjs` twin. |
| `_browser-verify.cjs` | 34-check real-browser (Edge headless) verification: mounts in the React section, migration of seeded v1 data, Today tab, plan checkboxes, study-hours, overload banner, risk badges, coverage, PYQ save path, target simulator, all tabs, analytics companion, zero console errors, 390px mobile overflow check. |

Modified files (all inside the Exam Tracker feature + its wiring):

| File | Change |
| --- | --- |
| `src/features/exam-tracker/exam-tracker.js` | New **Today** tab (command center: plan, study-hours allocator, weak topics, backlog recovery, learning loop) as the default view; risk badge + hero "Most at risk" line; "Risk (smart)" as the primary sort; detail modal gains syllabus-coverage intelligence, per-topic PYQ tracking (attempted/solved/correct/important/last-practiced) and the Target Simulator with disclosed assumptions; By Subject shows coverage %; planner cards show risk and sort risk-first; dashboard mini-widget shows the riskiest exam; recommendation panel uses the action-oriented generator. |
| `src/features/exam-tracker/exam-tracker-calculations.js` | `examPreparation` gains an additive `opts.ignoreCompleted` mode (post-exam learning loop); `generateRecommendations` rewritten to be action-oriented ("Finish Transactions and Normalization first", "Stop adding new topics — spend remaining time on PYQs + revision") with weak-topic names, PYQ readiness, stale-revision and study-hours/overload advice; same signature + return shape, so battle-plan/command-palette callers are unaffected. |
| `src/features/exam-tracker/exam-tracker-storage.js` | Schema v2 (same key): topic-level PYQ fields (`pyqAttempted/pyqSolved/pyqCorrect/pyqImportant/lastPracticedAt`), `settings.dailyStudyHours`, per-day plan-done state with automatic day roll-forward (`markPlanBlockDone`/`setPlanPlanned`/`getPlanDoneState`), guarded `sanitize` for malformed settings; CSV export adds PYQ sums. Old records load unchanged with safe defaults. |
| `styles/features/exam-tracker/exam-tracker.css` | New components (plan blocks, risk badges with text+color, allocation bars, coverage grid, PYQ fields, assumptions disclosure) using the existing design tokens; responsive rules at 1180/430px; risk never communicated by color alone. |
| `index.html` | Loads `exam-tracker-intelligence.js` after the calculations module. |
| `service-worker.js` | Precache list gains `exam-tracker-intelligence.js`; `CACHE_NAME` bumped to `arise-developer-system-v189-exam-intel` so existing installs pick up the new files. |
| `src/storage-keys.js` | Manifest description updated for the v2 fields. |
| `package.json` | Dev-only: `jsdom` + `puppeteer-core` added for the test/browser verification tooling (not shipped to the site). |

Not touched: React bundle, other widgets, existing Exam Tracker features
(CRUD, filters, D-Day, calendar, subjects, VTU Pass Calc, revision planner,
pinned, analytics, CSV/JSON export, duplicate detection all still work —
verified by the browser run).

---

# ✅ Previous round: Placement Intelligence System (DSA + Dev + Command Center)

Transforms the DSA Mastery and Dev Mastery widgets from passive analytics
into an **action + placement intelligence system** built for Tier-3
off-campus preparation. Built as **one new pure engine + three new mount
widgets** — no existing widget file was modified, no React state touched,
all new localStorage keys registered in `src/storage-keys.js`.

New files:

| File | Role |
| --- | --- |
| `src/placement-engine.js` | Deterministic math core (`window.__ARISE_PLACEMENT_ENGINE__`). Pure functions: no DOM, no randomness, `now` always passed in → same data, same numbers. Loaded in `<head>` next to `src/readiness-engine.js`. |
| `src/dsa-placement-engine-widget.js` | Mounts a "Placement Action Engine" block inside the existing DSA Mastery card (`.dmp-shell`). |
| `src/dev-placement-engine-widget.js` | Adds Depth / Ownership / Defense tabs + Weekly Sprint+ and JD→Skill-Gap blocks inside the existing Dev Mastery card (`.dvp-shell`). |
| `src/placement-command-center-widget.js` | Unified final section after the Dev Mastery card. |
| `tests/placement-engine.js` | 171 deterministic unit tests (`node tests/placement-engine.js`), includes corrupt-storage + wiring checks. |

## 1. ⚡ What Should I Solve Next? (DSA)
Priority = **weakness × placement_relevance × recurrence × learning_value ×
recency_gap** per topic. Per-topic signals come from weighted mastery
(Easy1/Medium3/Hard5), solve-quality mix (unaided/hint/solution credits),
company tags, SRS due counts and bank coverage. Output: one topic, N concrete
problems (Easy→Medium order, links), estimated minutes (base table: Easy 15 /
Medium 30 / Hard 45), and per-reason explanation. 3+ days of inactivity
switches to "restart mode" (2 problems, smaller commitment). Alternates show
the next two topics with reasons. No random picks — full formula shown in the
card footer.

## 2. ⚠️ Blind-Spot Detector (DSA)
Flags solved-but-not-reliably-mastered problems using evidence only:
hint-assisted solves, editorial/solution usage, repeated revisions with
lapses (`dsaRevisionSRS`), 60+ day old solves never revised, and the same
pattern failing across ≥2 different problems (pattern-level banner). Solve
time is **never inferred** — it isn't tracked anywhere, and the card says so.
Each flag carries a concrete remediation step; the top 3 form an ordered
remediation sequence.

## 3. 🔁 Pattern Transfer Test (DSA)
For every learned pattern (≥1 unaided solve or ≥2 solves of any quality) the
engine deterministically picks an **unseen** non-Hard bank problem from that
pattern's topic map. Timer-backed session (survives reload via
`placementPatternTransfer-v1.activeTest`) → outcome, minutes, code quality
(1–5) and explanation (1–5) self-ratings → **PATTERN TRANSFER SCORE** =
independence 40 + time 20 + correctness 15 + code 15 + explanation 10.
Overall score = mean of latest test per learned pattern; positioned in the
UI as more meaningful than solve counts.

## 4. 🏢 Tier-3 Readiness Matrix (DSA + Dev)
Five targets with **separate bars and bars-requirements**: Mass Recruiter
(TCS/Infosys/Wipro, Easy/Medium-weighted 2/1/0 scoring), Service Company,
Startup, Mid-Level Product, High-Bar Product. Each target blends its own
factor weights (mass coverage, unaided core patterns, Medium/Hard mastery,
sheets, project depth, ownership, portfolio, CP rating). Missing factors are
**renormalized and disclosed** ("estimated") rather than zeroed. Each row
shows current → required, gap band (Ready / Almost / Needs work / Major gap)
and the deterministic action for that target's weakest factor.

## 5. 📅 90-Day Placement Plan (DSA)
Five phases (Fundamentals → Patterns+Medium → Timed → Mocks → Revision +
company-specific). Stores only `startDate` + recalculation history
(`placement90DayPlan-v1`); everything else derives from live data. Missed
≥3 days or pace <35% of plan → recalculation banner: daily target =
remaining problems ÷ remaining days, phases re-anchor, and if the target
exceeds 3/day the card honestly says full coverage is no longer realistic
and switches to HIGH-ROI topics only.

## 6. 💎 Topic ROI (DSA)
ROI = placement frequency × weakness × learning value × **prerequisite
gate** × remaining gap. The squared prerequisite gate (opens fully at 60%
prereq mastery) is what makes DP/Graphs/Tries read LOW until
Arrays/Recursion/Trees fundamentals are real — the "advanced before
fundamentals" trap. HIGH/MEDIUM/LOW bands with a reason line per topic, plus
the "do NOT waste time on" list surfaced in the Command Center.

## 7. 🏗️ Project Depth Analyzer (Dev)
15 engineering dimensions (frontend → monitoring) scored 0/1/2 from real
evidence: stack keywords, `devGithubProjects-v1` + Project Quality checks
(readme/tests/deployment/authDbApi/responsiveUI), bug log, links,
description depth. Missing evidence scores 0 and shows ✕ with the exact fix
— never silently rewarded. Output: depth score /100, level, and top-3
improvements ordered by placement weight × gap.

## 8. 🤖 Code Ownership / AI-Code Dependency (Dev)
CODE OWNERSHIP SCORE over **tagged tasks only** (untagged disclosed, never
guessed): difficulty-weighted independent ×1.0 / guided ×0.55 / copied ×0.2.
Independent work counts ~5× copied. Per-concept ownership table, and a
re-build queue ("re-build X from a blank file — no AI, no peeking").
Framed as "AI helped you build this. Now prove that you understand it." —
never shaming.

## 9. 🛡️ Project Defense Simulator (Dev)
For the top-3 active projects, 10 categories (Architecture, Why-this-tech,
Database, API, Security, Performance, Scalability, Deployment, Debugging,
Trade-offs) with questions generated from the project's **actual fields** —
tech stack vs a deterministic alternative ("Why MongoDB instead of
PostgreSQL?"), 10,000-users scale question, endpoint security, production
debugging. Self-scored 0–4 per question against rubrics; session score =
mean × 25; weak categories stored and fed back into the weekly sprint.

## 10. 🧭 JD → Skill Gap Engine (Dev, upgraded)
Appended below the existing JD checker: parses required vs preferred
sections (heuristic split, preferred ×0.6 weight), ~34-skill dictionary,
DSA/portfolio/experience-signal detection. Coverage comes from the
student's real data (dev category readiness, concept tags, project tech
stacks) **with mastery %**. Output: weighted JOB MATCH %, missing skills
ranked by importance, already-strong (≥70%), and a NEXT 7-DAY ACTION
generated per top gap (Docker → containerize your API project; Redis →
cache your slowest endpoint; …).

## 11. 🚦 Production Readiness (Dev)
Every project: 11 checks (auth, validation, error handling, testing, env
vars, DB safety, logging, deployment, README, performance, security) →
Prototype < 40 ≤ Functional < 65 ≤ Deployable < 85 ≤ Production-ready, with
"why" naming the missing checks and the top-3 fixes for the next level.

## 12. 📣 Portfolio Signal (Dev)
Top-3 active projects scored across originality (tutorial-clone detection),
technical depth, README, live demo, git, organization, testing,
documentation, deployment, problem-solved. **Repo count is deliberately not
a factor** (stated in the UI). Weak components become per-project fixes.

## 13. 🎯 Weekly Placement Sprint+ (Dev, upgraded)
Appended below the existing dev-task sprint: cross-track weekly actions —
DSA problems (from the Next-Best-Action engine), 1 dev feature (weakest
category), 1 production improvement (worst project's first missing check),
2 applications, 1 mock/defense session, 3 weak-concept revisions. Checkbox
state persists per ISO week (`placementSprintLog-v1`, ~12 weeks kept); next
week's DSA count auto-adjusts (≥80% → +1, ≤40% → −1, floor 3) with the
adjustment disclosed.

## 🖥️ Placement Command Center (unified)
Final dashboard section: overall PLACEMENT READINESS (DSA 25 / Dev 20 /
Project 15 / Interview 20 / Resume 10 / Consistency 10 — interview weighted
like DSA because it's the usual Tier-3 bottleneck), five sub-scores with the
bottleneck highlighted, BIGGEST BOTTLENECK with a "so what" line,
HIGHEST-ROI ACTION (attacking the bottleneck), THIS WEEK (from the sprint
engine), and DO NOT WASTE TIME ON (from the ROI engine, with reasons).
DSA sub-score = 0.6 × mass-weighted coverage + 0.4 × unaided core patterns
— ability over activity.

## UX / safety notes
- Progressive disclosure throughout: the action is visible, evidence and
  formula expand on demand. Every score carries a "how this was calculated"
  line; every warning carries a "what to do" line.
- Same visual language as the existing cards: `--var` theming,
  glassmorphism, light-mode overrides, `prefers-reduced-motion`,
  `focus-visible` outlines, aria-expanded/aria-selected, responsive at
  640/720/900/520px breakpoints. Existing widgets untouched.
- The dev widget integrates via the card's **existing delegated tab
  handler** (`[data-dvp-tab]`/`[data-dvp-tab-panel]`), so the three new tabs
  are native to the card. Renders are signature-guarded so background
  refreshes never wipe in-progress form input.
- Defensive storage: every read tolerates missing/corrupt JSON (covered by
  tests); empty states instruct rather than fake numbers; writes are
  try/catch + capped history.
- `src/storage-keys.js` manifest extended (5 new keys, all non-sensitive);
  lazy-loader list and service-worker precache extended; `CACHE_NAME`
  bumped to `v188-placement`.

---

# ✅ Prior round: Dev Mastery — Weak-Concept Question Bank tab

Additive to `src/dev-mastery-premium-widget.js` only — no other widget touched,
service-worker `CACHE_NAME` bumped.

## ❓ Question Bank
The existing Interview Prep tab is a checklist (resume ready, LinkedIn done,
etc) — this is different: actual likely interview questions, picked for the
student's own weakest spots. Pulls the 2 weakest tagged concepts (from
`computeConceptCoverage()`) plus enough of the weakest categories (from
`computeCategoryReadiness()`, skipping any already covered as a concept) to
reach 4 groups total. Each term maps to a small static template bank (Auth,
Backend, Frontend, Database, Testing, System Design, API, DevOps — ~3
questions each); any category/concept name without an exact template still
gets 3 generic-but-specific fallback questions built from the term itself,
so a custom category never renders an empty tab. Each question is
collapsed by default with a "reveal hint" tap — a one-line nudge, not a
scripted answer, so it's rehearsal rather than memorisation. No new storage
— fully derived from data the other panels already read.

Cache bumped: `v176-dev-mastery-sprint-jd-gap` → `v177-dev-mastery-question-bank`
in `service-worker.js`.

---

# ✅ New this round: Dev Mastery — Weekly Sprint + JD Skill Gap tabs

Additive to `src/dev-mastery-premium-widget.js` only — no other widget touched,
no new script tags, only the service-worker `CACHE_NAME` bumped. Two more
tabs added alongside last round's Concepts/Projects/Interview Prep/Resume
Bullets/Openings:

## 1. 🗓️ Weekly Sprint (new default/first tab)
Picks up to 5 incomplete `devTasks`, round-robining across the 3 weakest
categories (reuses `computeCategoryReadiness()` — no separate weighting
logic to keep in sync), easiest-incomplete-task-first within each category
so a weak spot doesn't turn into an all-Advanced wall on day one. Tops up
from any other incomplete task if the weak categories run out. Purely
derived — no new storage, no checkboxes here; completion still happens the
normal way in the Dev Skills task list. An empty state shows if there's
nothing incomplete left to pick.

## 2. 🔍 JD Skill Gap Checker
A textarea to paste a job description, matched case-insensitively against
the student's own logged categories/concepts (via `computeCategoryReadiness()`
and `computeConceptCoverage()`) plus a fixed list of ~28 common
placement-relevant keywords (React, Docker, System Design, SQL, etc). Shows
what's already covered (with current readiness %) and what the JD mentions
that isn't logged yet. Deliberately simple substring matching, not NLP — no
hidden scoring to second-guess. The pasted text is saved to its own
`devMasteryJDCheck-v1` key (same isolated-key pattern `devGithubProjects-v1`
already uses) so it survives a refresh.

Cache bumped: `v175-dev-mastery-tabs-resume-bullets` → `v176-dev-mastery-sprint-jd-gap`
in `service-worker.js`.

---

# ✅ New this round: Dev Mastery — Tabbed sections + Resume Bullet Generator

Additive to `src/dev-mastery-premium-widget.js` only — no other widget touched,
no new script tags in `index.html` (already in `APP_SHELL`), only the
service-worker `CACHE_NAME` bumped.

The card had grown to five stacked panels (Concept Coverage, Job Readiness
by Category, GitHub Tracker, Interview Prep, Tier-3 Openings) below the
ring — all always rendered, all always scrolled through. Two changes, kept
separate on purpose:

## 1. 🗂️ Tabs
Concept Coverage + Category Readiness are grouped under a **Concepts** tab;
GitHub Tracker under **Projects**; Interview Prep and Tier-3 Openings each
keep their own tab; a new **Resume Bullets** tab sits alongside them. Purely
a display-layer change — every `render*()` function for the existing panels
is untouched, still targeting the same panel IDs, just nested one level
deeper inside a `[data-dvp-tab-panel]` wrapper. Tab state lives in the DOM
(active classes / `[hidden]`) on the reused card element, so it survives
every re-render tick without new storage.

## 2. 📝 Resume Bullet Generator (new tab)
Tier-3 students usually have the work logged (completed `devTasks` with a
title + category) but not the resume vocabulary for it. Reads completed,
titled tasks — skipping untitled ones, since a blank bullet needs editing
anyway — groups them by category, and ranks Advanced + independently-built
tasks (cross-referenced against `devTaskInsights`, same read-only pattern
Concept Coverage already uses) to the top of each group. Each bullet has a
Copy button; a Copy-all button copies every shown bullet as a `•`-prefixed
list. Explicitly framed as draft starting points — the hint text says to
add real metrics, tech stack and outcomes before using them for real.
Exposes `computeResumeBullets()` on the existing public API for parity with
the other `computeX` helpers.

Cache bumped: `v174-expenses-week-start-unified` → `v175-dev-mastery-tabs-resume-bullets`
in `service-worker.js`.

---

# Focus Timer / Stopwatch Ring — Upgrade

# ✅ New this round: Placement Tracker — Tier-3 Reality extended (Service Bonds + Off-Campus NOC)

Second additive pass on the same four files as the prior round
(`placement-tracker.js`, `placement-calculations.js`, `placement-storage.js`,
`placement-tracker.css`) — no new files, no new script tags, only the
service-worker `CACHE_NAME` bumped again.

Re-audited the just-added 🎓 Tier-3 Reality tab (Eligibility Gate Checker,
Campus Lock-In Radar, On-Campus vs Off-Campus Conversion) before adding
more. Two further tier-3-specific gaps, both concrete and commonly
underestimated until the offer letter is already in hand:

## 4. 💰 Service Bond Overview
Mass recruiters and service companies dominating tier-3 on-campus drives
routinely attach a service bond — a fixed period with a cash penalty for
leaving early — that a raw CTC comparison hides completely. Two new Offers
fields, **Service bond period** and **Bond penalty for early exit (INR)**,
feed a new panel that expresses the penalty as a plain **% of first-year
CTC** next to the company and period. Deliberately makes no judgement call
about what counts as "too high" — it's presented as a number to weigh, not
a warning, since that threshold is personal and situational. Offers with no
bond penalty logged simply don't appear.

## 5. 🧾 Off-Campus NOC Tracker
Many tier-3 colleges require a No-Objection Certificate from the placement
cell before a student can continue (or start) an off-campus process once
registered for on-campus drives — a rule that's easy to forget about until
an off-campus interview is already underway. Two new Applications fields,
**Off-campus NOC from college** (Not Applicable/Required/Not Required) and
**NOC status** (Not Requested/Requested/Granted/Denied), feed a panel that
flags only applications both past the "just browsing" stage (Applied or
later) *and* marked NOC-required-but-not-granted — so filling the fields in
for an application still sitting at "Interested" doesn't produce noise.

Both panels sit in the existing 🎓 Tier-3 Reality tab, after the Lock-In
Radar and before the Conversion split. All four new fields default to
empty/Not Applicable, so every already-logged application/offer renders
exactly as before until filled in. No existing field, panel, or storage
shape changed.

## Tests
`tests/test-tier3-reality.js` grew from 30 to 43 assertions (added 13): bond
overview only includes offers with a logged penalty, the %-of-CTC math is
verified against a hand-computed value, the bonded offer's period and
company render correctly on the tab; NOC gaps correctly flag an in-progress
application with NOC required-but-not-granted while excluding one already
Granted and one still at "Interested"; a full click-through confirming
Overview, Applications *and* Offers all still render untouched by the new
fields. All three suites (`tests/test-storage-calculations.js` 39,
`tests/test-dom-smoke.js` 24, `tests/test-tier3-reality.js` 43 — 106 total) pass.

Cache bumped: `v168-placement-tier3-reality` → `v169-placement-tier3-bond-noc`
in `service-worker.js`.

---

# ✅ Prior round: Placement Tracker — 🎓 Tier-3 Reality tab

Additive to `placement-tracker.js`, `placement-calculations.js`,
`placement-storage.js` and `placement-tracker.css` only — no other widget
touched, no new script tags in `index.html` (all four files are already in
`APP_SHELL`; only the service-worker `CACHE_NAME` was bumped).

Audited all 13 existing tabs (Overview, Applications, Offers, Internships,
Contest Upsolve, Contests, Code Patterns, Bug Journal, Interview Prep,
Project Sprints, Mock Interviews, STAR Stories, Round Log) before adding
anything. The tracker already covers the generic pipeline well — kanban,
stage timeline, reminders, offer comparison — but assumes an off-campus,
apply-anywhere hiring process. Three gaps are specific to what a tier-3
student's placement season actually looks like:

## 1. 🎯 Eligibility Gate Checker
Tier-3 on-campus drives almost always carry a minimum-CGPA cutoff and/or a
"no active backlogs" rule, usually discovered only after a slot is wasted on
an ineligible application. Two new optional Applications fields — **Min CGPA
required to apply** and **Backlog policy** — get cross-checked against a
one-time **Your CGPA** / **Active backlogs** entry in the new tab, flagging
each logged application ✅ Eligible or ⚠️ Check before applying, with the
specific reason (below cutoff, backlogs not allowed, or both). Applications
with neither field filled in don't show up here at all — this is opt-in per
application, not a new required field.

## 2. 🔒 Campus Lock-In Radar
Many tier-3 colleges enforce a "clear enough rounds (or accept an offer) and
you're locked out of further drives this season" policy, often with a CTC
threshold above which the rule is waived for higher-package companies. A new
**Drive type** field (On-Campus/Off-Campus/Pool Campus/Walk-in) plus a small
"Your Campus Reality" settings panel (own CGPA, a CTC exemption threshold,
and a toggle for whether this rule even applies) lets the radar warn *before*
confirming: any On-Campus application at Offer or one round away from it,
below the exemption threshold, gets flagged with exactly how many other live
applications accepting it would forfeit. With no threshold set, any
acceptance is conservatively assumed to lock in. The toggle defaults off, so
students whose colleges don't run this policy see nothing.

## 3. 📡 On-Campus vs Off-Campus Conversion
Tier-3 on-campus drives skew heavily toward mass recruiters/service
companies; off-campus effort (LinkedIn, referrals, job portals) is usually
the only realistic route to product/dream companies. A simple split — total
applied, offers, success rate — for On-Campus vs Off-Campus (using the new
`driveType` field, falling back to inferring it from the existing `source`
field for records logged before this upgrade) makes that balance visible
instead of guessed at.

All three panels are purely derived/read-only except the small campus-policy
settings form (mirrors the Offers tab's `data-offer-weights` pattern — plain
inputs, saved to `data.settings.campusPolicy` on change, no submit button).
New application fields (`driveType`, `minCgpaEligibility`, `backlogPolicy`)
default to empty, so every already-logged application renders exactly as
before until filled in. The global search API (`__ARISE_PLACEMENT_API__.search`)
was patched to skip the new tab, since it — unlike every other tab — has no
backing entity in `ENTITIES`.

## Tests
`tests/test-tier3-reality.js` — 30 assertions across 5 suites, mounting the real
widget in jsdom via `window.__mountPlacementTracker`: empty states with
nothing logged, the eligibility checker's below-cutoff/backlog-blocked/
eligible cases (filled in through the real settings form, not storage
directly), the lock-in radar's on/off toggle, sub-threshold vs
above-threshold vs no-threshold behavior, the on-campus/off-campus split
including the legacy source-inferred fallback, a full click-through
confirming Overview and Applications still render untouched, and that the
global search API no longer throws now a no-entity tab exists. Run with
`node tests/test-tier3-reality.js` (needs the `jsdom` devDependency already
declared in the root `package.json` — `npm install` once first). The two
pre-existing suites (`tests/test-storage-calculations.js`, 39 assertions;
`tests/test-dom-smoke.js`, 24 assertions) were re-run and still pass unchanged.

Cache bumped: `v167-expenses-ie-trend-persist` → `v168-placement-tier3-reality`
in `service-worker.js`.

---

# ✅ Prior round: Expenses — ⭐ Premium (Scenario Planner) tab

Additive to `src/expenses.js` only — no other widget touched, no new script
tags in `index.html` (the widget is already in `APP_SHELL`).

The Expenses widget already has 10 tabs (Overview, Trends & Analysis,
Budgets & Goals, Semester, Investments, IOUs, Loans, Payoff Plan,
Transactions, Insights). Audited all of them before adding anything: net
worth exists but as a single live number with no history; savings goals
track progress but never project a reach-by date; and nothing lets you
ask "what if I cut X" before actually doing it. Three panels close those
gaps, grouped into a new "⭐ Premium" tab:

## 1. 🧪 What-If Simulator
Pick one expense category, a cut percentage (0–100%), and an optional
monthly income change (₹, +/-). Projects against the actual trailing
3-*complete*-month average income/expense (current, still-in-progress
month excluded, same principle the existing Forecast card uses within a
single month) — not a made-up baseline. Shows the ₹ saved, the projected
monthly net, and the delta vs current pace. Inputs persist in their own
`SCENARIO_KEY` so they survive re-opening the tab.

## 2. 📈 Net Worth Trend
The existing Net Worth Snapshot (Insights tab) is a live number with no
history. Adds a manual "Save Snapshot" button — one entry per calendar
day (own `NET_WORTH_HISTORY_KEY` array; re-saving the same day overwrites
in place instead of duplicating), rendered as a trend bar row using the
same visual language as the Savings Rate chart. Keeps the last 24
snapshots. Deliberately manual, not automatic — same "you decide when it
counts" spirit as the Investments tab's "Update Value" action.

## 3. 🎯 Goal Projections
Each existing Savings Goal now gets a reach-by date, derived from the
trailing 3-month average savings rate — and a second projected date using
the What-If Simulator's current settings, so the simulator ties into
something concrete ("cut Food 30% → laptop goal lands 2 months sooner")
instead of floating on its own.

All three panels are purely derived/additive — no existing tab's markup,
storage shape, or totals/budgets/XP changed; a fresh install with zero
goals/snapshots/scenario shows clean empty states pointing at what to do
first.

## Tests
`tests/test-expenses-premium-scenario.js` — 27 assertions across 5 suites,
mounting the real widget in jsdom via `window.__mountExpenses` (plus
`src/widget-nav.js` for the real pill-nav, same as production): empty states
with no history, populated What-If numbers once trailing-month data
exists, scenario submit persisting and correctly feeding both the
projected-net line and the Goal Projections "With scenario" line, net
worth snapshot save + same-day overwrite (no duplicate), and a full
click-through confirming every one of the prior 10 tabs still renders.
Run with `node tests/test-expenses-premium-scenario.js` (`npm install` once for
the `jsdom` devDependency).

Cache bumped: `v163-projects-board-actionable` →
`v164-expenses-premium-scenario-planner` in `service-worker.js`.

---

# ✅ Prior round: Competitive Programming — 🎓 Tier-3 Reality tab

Additive to `src/competitive-programming-widget.js` only — no other widget
touched, no new files except a new test.

Audited all 14 existing tabs (Sync Center, API Health, Overview, Ratings,
Problems, Activity, Contests, LeetCode, Integrations, Custom Platforms,
GitHub, Project Quality, Resume Readiness, Settings) before adding
anything — the widget already covers the generic CP-tracking case well.
Two gaps were specific to tier-3 reality that nothing above already caught:

## 1. 📅 Contest–Exam Clash Radar
Tier-3 colleges typically run fixed, strict exam schedules with little
room to skip a lecture or lab for a contest — unlike colleges where
faculty are more flexible about it. A live or virtual contest landing a
day or two before an exam is a real scheduling conflict, and until now
nothing surfaced that. The new tab reads the Exam Tracker widget's own
storage read-only via its exposed `window.AriseExamStorage.load()` API
(never written to, degrades silently to a "connect your exams" banner if
that widget hasn't been used) and cross-checks every upcoming contest —
both live (`contests`) and virtual practice (`virtualContests`) — against
exam dates, flagging anything landing in the 3 days before an exam with
an inline "⚠️ Xd before <exam name>" badge; everything else gets a plain
"✓ Clear" badge.

## 2. 🖥️ Live vs Virtual Practice Split
Tier-3 students disproportionately end up doing virtual contests over
live ones — not from avoiding live pressure, but because live rounds
often clash with fixed lab hours, attendance-mandatory classes, or
unreliable hostel/campus internet during the actual contest window. This
adds a simple live-vs-virtual % split (past `contests` marked `type:
"past"` vs logged `virtualContests`) so that balance is visible instead
of invisible, framed as a fact about circumstances rather than a knock
against the student.

Both features live together in a new "🎓 Tier-3 Reality" tab, inserted
right after Contests & Calendar. New CSS is two small badge-tone variants
(`.cp-badge-warn` / `.cp-badge-ok`) reusing the existing `.cp-badge`
shape — nothing else in the stylesheet changed.

## Tests
`tests/test-cp-tier3-reality.js` — 15 assertions across 5 suites, mounting the
real widget in jsdom via its actual `window.__mountCompetitiveProgramming`
contract (not just pure functions): no-Exam-Tracker-connected banner state,
a clash-free contest correctly marked "Clear", a real clash correctly
flagged with the right day-count and exam name, live/virtual split math,
and a full click-through of every tab (old and new) to confirm nothing
regressed. Run with `node tests/test-cp-tier3-reality.js` (needs the `jsdom`
devDependency already declared in the root `package.json` — `npm install`
once first). Note for anyone re-running DOM tests against this widget:
stub `window.fetch` and `window.setInterval` before mounting, since the
real widget auto-syncs platforms and polls contest countdowns on mount,
either of which will otherwise hang a test process or hit real network.

No existing tab's markup, storage shape, or behavior changed. Cache
should be bumped (e.g. `v154-tier3-hackathon-upgrade` →
`v155-cp-tier3-reality`) wherever the service worker precache list or app
version string lives, same as prior rounds. No new script tags needed in
`index.html` — the widget is already in `APP_SHELL`; everything lives
inside the updated `src/competitive-programming-widget.js`.

---

# ✅ Prior round: Hackathon Tracker — v154 "Tier-3 Reality Check" upgrade

Five additive features in `src/hackathon-tracker-widget.js`, all grounded in
what's actually different about a tier-3 college hackathon circuit versus
the generic case the widget already covered well. Nothing existing removed
or changed in shape — new record fields default to empty/null so every
already-logged hackathon renders exactly as before until you fill them in.

## 1. 📶 Online vs On-site Exposure
New **Mode** (Online/Offline) and **Venue/City** fields per hackathon.
Offline hackathons show a 🏟️ badge with the city on their row; online ones
show 📶. A new "Online vs On-site Exposure" card in Analytics reports the
%-on-site split and, if it's been 100% online so far, nudges toward
targeting one in-person event — tier-3 students overwhelmingly do online
circuits (no travel budget/sponsorship), and an all-online record reads
differently to recruiters than one with even a single on-site result.

## 2. 📝 College Permission (OD) Status + Attendance Cross-Check
New **College Permission (OD) Status** (Not Needed/Requested/Approved/
Rejected) and **OD Note** fields, shown as a colour-coded 🏛 badge on
offline hackathons' rows (mirrors the attendance widget's condonation
status-cycle tones). The Analytics section summarizes offline hackathons by
OD status and flags any with no status set yet. It also does a **read-only**
peek at `arise-attendance-tracker-v1` (the Attendance Tracker's own
storage, never written to) — if any subject there is already below the 85%
VTU cutoff, a warning banner surfaces at the top of the new section:
"get college permission sorted before committing to another offline
hackathon." Degrades silently to no banner if that widget hasn't been used.

## 3. 🎯 Interview Mileage
A small per-hackathon log (company + optional note) you tag the first time
that project actually comes up in an interview — rendered as a removable
chip strip under each hackathon's card, next to the existing AI Postmortem
block. The Analytics section turns this into a leaderboard: "3 of 12 logged
hackathons have come up in interviews — these are your go-to talking
points," since with limited interview panel time, which 2-3 projects
actually land matters more than the raw hackathon count.

## 4. 🏛️ SIH / Govt Pipeline
New **Organizer Type** (Corporate/College·University/Government·PSU/
Community·Nonprofit), **Internal Round Status** (Internal Round → Nominated
to Nationals → Selected for Nationals / Not Selected), and **Problem
Statement / Theme** fields. Smart India Hackathon and similar PSU/ministry
hackathons run their own internal-college-round-then-nationals funnel,
unlike direct-entry platforms — the Analytics section now has a dedicated
"SIH / Govt Pipeline" card bucketing Government/PSU-tagged hackathons by
round status and listing themes, instead of that funnel being invisible.

## 5. 💸 Fee-Adjusted ROI
New **Registration Fee (₹)** field. The existing "Time ROI" card in Growth
& Patterns already divided prize money by hours worked; a new "Fee-Adjusted
ROI" card in the Tier-3 section does the same but nets out registration
fees first, plus totals overall fee spend — a ₹500-1000 entry fee paid out
of pocket on a tight budget shouldn't look free in the ROI math.

All five surface together in a new "🎓 Tier-3 Reality Check" section at the
bottom of the existing Analytics Dashboard (same expand/collapse toggle),
plus inline row badges/logs where the data is per-hackathon rather than
aggregate.

## Tests
`tests/test-hackathon-tracker-tier3.js` — 55 assertions covering `normalizeRecord`'s
new field clamps, `addInterviewMention`/`removeInterviewMention`, and all
five new pure computation functions (`computeExposureSplit`,
`computeFeeAdjustedRoi`, `computeGovtPipeline`, `computeOdSummary`,
`computeInterviewMileage`, `readAttendanceRiskSummary`). Run with
`node tests/test-hackathon-tracker-tier3.js`. The pre-existing
`tests/hackathon-tracker-widget.js` (60 assertions) and
`tests/test-hackathon-tracker-dom-smoke.js` (56 assertions, needs `jsdom`) were
both re-run and pass unchanged.

New CSV export/import columns: `mode`, `venueCity`, `registrationFee`,
`organizerType`, `problemStatementTheme`, `internalRoundStatus`, `odStatus`,
`odNote` (added to `CSV_FIELDS`, so existing exports/imports keep working —
old CSVs just leave these columns blank on import). `interviewMentions` is
a structured array like `postmortem`, so it's intentionally excluded from
CSV (same precedent as postmortem).

Cache should be bumped (e.g. `v153-analytics-upgrade` → `v154-tier3-upgrade`)
wherever the service worker precache list or app version string lives, same
as prior rounds.

---

# ✅ Prior round: Session Analytics — v153 upgrade

Four additive sections in `src/learning-session-analytics-widget.js`, on top of
v152. Nothing existing removed or changed in shape; the v152 bar chart got
one small visual addition (see #1).

## 1. 🔴 Dead Days Log
Classifies the last 30 days as **active** (minutes logged), **dead**
(tracking was underway that day but zero minutes logged), or **no-data**
(before the very first session ever — doesn't count against you). Shows the
confronting count ("7 dead days in last 30") plus a 30-cell strip, each cell
title-tooltipped with the date and status. The existing 7-day bar chart also
picked up a small red tick for a dead day, distinct from the blank ghost bar
used for a no-data day — so "zero and tracked" now reads differently from
"zero because nothing was logged yet."

## 2. 📅 Weekly Target vs Actual Grid
A 4-row table — DSA / Dev / College / Interview Prep — each with an editable
weekly-hour target (defaults: DSA 15h, Dev 5h, College 0h, Interview Prep
8h) compared against actual hours logged in the trailing 7 days. Green
check when at/above target, red cross when below, dash when no target is
set. "Dev" sums the existing `Project` session category, since that's what
dev/build work is logged under elsewhere in the app. Targets persist in a
new `arise-la-config-v1` storage key and edit in place — change a number,
tab out, the row re-renders.

## 3. 📊 Efficiency Score
Per-session score: `(rating / 5) × (1 − clamp(distractions/5, 0, 1)) × 100`.
Sessions without a `distractions` field are treated as 0 distractions
(untracked isn't the same as distracted), so old sessions aren't unfairly
penalized. Rendered as a 7-day rolling bar trend (red/amber/green by score)
plus an overall average — makes a long low-quality session visibly worse
than a short focused one.

## 4. 🎯 Placement Countdown Pressure Tracker
Two one-time inputs — placement season date and DSA hours needed — persisted
in the same config key. Derives days remaining, DSA hours banked (all-time,
category-filtered), the gap, and a stark **"X.Xh/day needed"** figure once
both fields are set (color-coded: green under 2h/day, amber 2–4h, red 4h+).
Handles target-already-met and placement-date-already-passed as distinct
states rather than showing a nonsense number.

## Tests
`tests/test-session-analytics-v153.js` — 52 assertions across 5 suites:
`computeDeadDays()`, `computeWeeklyTargetGrid()`, `sessionEfficiency()` /
`computeEfficiencyTrend()`, `computePlacementCountdown()`, and
`readConfig()`/`writeConfig()`. All 52 pass (same jsdom harness as v152;
`node tests/test-session-analytics-v153.js`). The v152 suite
(`tests/test-session-analytics.js`, 22 assertions) was re-run and confirmed
unaffected.

Cache should be bumped (e.g. `v152-analytics-upgrade` →
`v153-analytics-upgrade`) wherever the service worker precache list or app
version string lives, same as prior rounds. No new script tags needed in
`index.html` — the widget is already in `APP_SHELL`; everything lives
inside the updated `src/learning-session-analytics-widget.js`.

New storage key: `arise-la-config-v1` (registered in `src/storage-keys.js`).

---

# ✅ Prior round: Session Analytics — v152 upgrade

Five additive improvements to `src/learning-session-analytics-widget.js`.
No existing markup or behaviour removed; all new blocks appear below the
v151 insight chip.

## 1. Weekly Hours Bar Chart
Last 7 days as an SVG bar chart (minutes per day). Today's bar is
highlighted in cyan; prior days in purple. Zero-minute days render as a
ghost bar. Helps spot study-volume gaps at a glance — the donuts show
*what* and *when*, this shows *how much*, day-by-day.

## 2. Distraction Score & Deep-Work Rate
Reads the `distractions` field saved by `src/focus-timer-upgrade-widget.js`.
Shows two derived stats: **avg distractions/session** and **deep-work rate**
(% of sessions with 0 distractions AND rating ≥ 4). Falls back to
"Log a few sessions with the distraction counter…" when the field is absent.

## 3. Category Streaks
Per-category count of consecutive days with ≥1 session, rendered as
chip badges (e.g. "DSA 🔥5"). Uses `CATEGORY_COLORS` so colours match
the donut legend. Sorted by streak length descending.

## 4. Productivity Heatmap (hour-bucket × day-of-week)
A 6-row × 7-column grid coloured by avg focus rating. Rows = hour
buckets (12–4am / 4–8am / 8am–12 / 12–4pm / 4–8pm / 8pm–12);
columns = Mon–Sun. Cell colour: dark (no data) → red (low) → amber →
cyan → green (peak ≥ 4.2). Only sessions with a rating contribute.

## 5. Session Log (last 10, collapsed)
A toggle-able table: Date · Task · Category · Duration · Rating (★☆☆☆☆)
· Distractions. Collapsed by default so the panel stays compact on first
render. Uses `aria-expanded` for accessibility.

## Tests
`tests/test-session-analytics.js` — 22 assertions across 4 suites:
- Suite 1: `computeWeeklyBars()` — bar count, today flag, minute totals
- Suite 2: `computeDistractionStats()` — null guard, avg, deep-work rate
- Suite 3: `computeCategoryStreaks()` — empty, 3-day, broken-streak
- Suite 4: `computeProductivityHeatmap()` — grid shape, cell aggregation,
  no-rating guard

All 22 pass (same jsdom harness; run `npm install` once, then
`node tests/test-session-analytics.js`). The v151 tests
(`tests/test-dev-mastery-panels.js`, 39 assertions) were confirmed unaffected.

Cache bumped: `v151-dev-mastery-concept-category-panels` →
`v152-analytics-upgrade`. No new script tags needed in `index.html`
(the widget is already in `APP_SHELL`; new features live entirely
inside the updated `src/learning-session-analytics-widget.js`).

---


This is your full project with the timer-ring work applied.

## ✅ New this round: Skills Timeline — 📚 Skill Log section

A new "Skill Log" tab in `src/skills-timeline-widget.js`, alongside the
existing Overview/Skills tabs, for logging individual learned skills
(distinct from the timeline's yearly milestones): name, category
(free-text with datalist suggestions, supports fully custom categories
while still mapping back to a known category's color/emoji when it
matches one), skill type, time taken (value + unit), used-for text,
source type + video/playlist URL (renders a clickable open link),
optional notes, and a progress slider with a colored progress bar and
derived Not Started/In Progress/Completed status. Own storage arrays
(`skillLogs`, `customLogCategories`) in the same widget storage key.

Also added in this round:

- **Search box** — filters log entries by name, category, used-for, and
  notes (tested: searching a word that only appears in a note correctly
  surfaces that entry).
- **Notes field** — optional free-text note per entry, matching the
  pattern used elsewhere in the widget.
- **"Time Invested" stat card** — sums every entry's time (normalized
  across hours/days/weeks/months) into a total, e.g. `60h (≈2d 12h)`.
- **Sort by Time Invested** — alongside the existing recent/progress/name
  sorts.
- **One-click "✓ Mark Complete" button** — jumps straight to 100% instead
  of dragging the slider all the way.
- **XP integration** — completing a skill log now awards XP through the
  same engine the rest of the dashboard uses, with a guard so it never
  double-awards (verified across re-renders and a full unmount/remount).

Also includes a per-category average-progress bar breakdown and category
filter chips. Scoped to the Skills Timeline widget only — the Attendance
Tracker widget is untouched, since it has no skill-tracking concept.

Verified with three jsdom-based smoke-test scripts (47 assertions total,
not committed to the repo): core add/edit/delete/persist flow, edge
cases (HTML-unsafe input, case-insensitive category matching, empty/
clamped values), and the search/notes/time-stat/sort/complete/XP
upgrades described above. Confirmed the existing Skills Timeline tab
(seed data, cards) renders unchanged.

## ✅ New this round: CSE Syllabus+ — Topic/unit-level breakdown per subject

Additive across three files: `cse-full-syllabus-config.js` (data),
`cse-syllabus-plus-widget.js` (logic + UI), and a new
`tests/test-topic-units.js` (tests). Nothing removed from prior rounds.

**The gap this closes:** every prior round tracked a subject as a single
done/pending flag — the GPA-impact preview, pace projection, priority
queue, and portfolio auto-flag all treated "80% through Operating
Systems" the same as "haven't opened the book," because there was
nowhere finer-grained to read from.

- **Config data** — every one of the 56 canonical subjects in
  `cse-full-syllabus-config.js` now ships a `units:[{id, name,
  weightagePct}]` array with real per-course topics (e.g. Data
  Structures → Arrays/Stacks, Trees & BSTs, Graphs, Sorting/Searching/
  Hashing; Operating Systems → Process Scheduling, Concurrency, Deadlocks,
  Memory Management, File Systems), each subject's weights summing to
  exactly 100. Flattened onto `SUBJECTS` too, so anything reading that
  array picks it up. Custom (user-added) subjects intentionally have no
  units[] — same "additive, not a replacement" boundary as every other
  custom-subject limitation already documented in this file.
- **Per-unit tracking** — a new `📚 XX%` chip on each canonical subject's
  row (own storage key, `cse-syllabus-topic-progress-v1`) expands into a
  checklist with a weighted progress bar. Checking units rolls up into a
  real weighted %, computed from each unit's own weightagePct rather than
  a flat 1/N split. Marking the whole subject done via the existing row
  checkbox still reports 100% regardless of which units were ticked
  individually — the binary flag stays the quick-override source of
  truth, unit tracking is the finer lens on top of it, not a replacement
  for it.
- **Priority queue re-weighted by actual coverage** — `priorityScore()`
  now multiplies by `topicRemainingFraction()` (1 − weighted % covered,
  floored at 0.05 so a subject at 100% unit coverage but not yet flipped
  to "done" still gets a small nudge for a final pass rather than
  vanishing). A subject that's 80% covered unit-by-unit but still
  technically "pending" now correctly ranks below one that's untouched,
  instead of competing on equal footing. Surfaced in the queue's "why"
  text and the score-formula note. Subjects without units[] get
  `remaining = 1` unconditionally, so their ranking is bit-for-bit
  unchanged from every prior round.

Verified with a new jsdom-based test, `tests/test-topic-units.js` (18
assertions) — config sanity (56/56 subjects have units[], every
subject's weights sum to exactly 100), chip + checklist rendering,
storage persistence on checkbox toggle, the whole-subject-done override,
priority-score math (confirmed the 0.2× multiplier at 80% coverage to
within rounding), and the custom-subject fallback (no chip, no crash).
This is the project's first DOM-driven test rather than a pure-function
harness, since the feature's value is in the wiring (checkbox → storage
→ re-render → re-ranked queue), not just the math in isolation — added a
root `package.json` with `jsdom` as a devDependency for this reason (run
`npm install` once before `node tests/test-topic-units.js`; every other test
in this project remains dependency-free). `node_modules` is a dev-only
artifact and shouldn't be deployed with the static site.

Cache bumped (`v149-dead-skeleton-removed` → `v150-syllabus-topic-units`);
no new script files were added to `index.html`'s load list (units live
inside the existing `cse-syllabus-plus-widget.js` and
`cse-full-syllabus-config.js`), so nothing new needed adding to
`APP_SHELL`. Note: `service-worker.js` was already at v149 - ahead of
where this README's most recent logged entry (v124) suggested - so
several undocumented rounds happened between them; worth reconciling
next time this file gets a full audit.

## ✅ New this round: Expense Tracker — 🎓 College Fee Reserve

Additive to `src/expenses.js` (+ one new manifest line in `src/storage-keys.js`)
only — no other file touched, no existing feature's behavior changed.

Inspected the Account/Semester/Budget/Goal systems already in this file
before adding anything, per the request:

- **Savings Goals** (`GOALS_KEY`) derive "amount saved" automatically —
  net income since the goal's creation date, clamped to the target. No
  manual allocation step.
- **Semester Budget** (`SEMESTER_KEY`) is a date-range cash-flow view
  (income vs. spend across a whole semester), not a per-fee tracker.
- **Loans** (`LOANS_KEY`) already fed a `feeReserves` figure into
  `computeSafeToSpend()`, but that was outstanding loan balances, not
  actual fee obligations like tuition or hostel fees.

None of the three covered "I owe ₹45,000 tuition by a date, and want to
earmark money toward it without spending it" — so this is a genuinely new
feature, not a duplicate of Goals. Where the two *do* overlap (row
layout, progress bar, delete button, stat-chip summary, CSS classes) the
Fee Reserve UI reuses the existing `exwg-*` / `exw-budget-*` markup and
styles Goals already defined, adding only one new tone class
(`.exwg-pace-warn`) and a small allocation-form layout class.

**What it does:**

- New "🎓 College Fee Reserve" block, folded into the existing Semester
  tab (own storage key `arise-expenses-fee-reserves-v1`, own array —
  nothing shared with Goals/Budgets/Semester state).
- Add a fee obligation: Name, Total amount, Due date (optional),
  Semester label (optional), Notes (optional).
- Each obligation tracks Total required, Amount reserved (manually
  allocated via "+ Add to Reserve", not auto-derived), Amount remaining,
  and a progress bar.
- Status auto-calculates in this priority order: **Fully Reserved** →
  **Overdue** (past due date, not fully reserved) → **Due Soon** (due
  within 7 days) → **Behind Target** (reserved % trails the elapsed-time
  % between creation and due date) → **On Track**. No due date set just
  skips the date-based statuses and falls back to On Track / Fully
  Reserved.
- "Add to Reserve" is logical earmarking only — no money actually moves
  between accounts or transactions. The amount is clamped so a fee can
  never show more reserved than required.
- Reserved fee money is **not** treated as spendable: `computeSafeToSpend()`
  now folds a fee's reserved amount into the same "Reserved Money" figure
  Loans and Goals already contributed to (the internal loan-only variable
  was renamed `loanReserves` to make room for `collegeFeeReserved` — this
  is an in-memory calculation field, not a storage key, so nothing
  persisted changes shape).
- Edge cases handled: no obligations yet (empty state with copy), fees
  past their due date, a fully-funded fee (progress bar caps at 100%,
  allocation form replaced with a "✅ Fully funded" note instead of an
  input), several obligations at once (sorted overdue-first, then by due
  date, un-dated and fully-reserved ones pushed to the end), and
  zero/invalid amounts (form requires a positive total; allocation input
  requires a positive amount and is capped to what's actually remaining).

Verified with a Node smoke test exercising `feeReserveStatus()` against
all five statuses, the zero-amount and no-due-date edge cases, the
allocation-clamping math, and `computeSafeToSpend()`'s new
`collegeFeeReserved` field — all before wiring anything into the DOM.
Existing Goals/Budgets/Semester panels were re-checked afterward and are
unchanged.

## 🐛 Fix this round: API Health checks silently stopping after the first blocked platform

Found via your report of checks "not firing." Root cause: `cpPingApiHealth()`
called `fetch(spec.url)` directly inside a plain `Array.prototype.forEach`
loop over the 5 platforms. `forEach` has no exception handling of its own —
if any single iteration throws *synchronously* (not a rejected promise, an
actual `throw`), the loop stops dead and every platform after that one in
the list never gets its request sent at all.

This is exactly the kind of throw an ad-blocker or privacy extension can
produce: some of them patch `window.fetch` to throw `net::ERR_BLOCKED_BY_CLIENT`
synchronously for domains they've flagged, rather than rejecting the
returned promise — and third-party API domains like `codeforces.com`,
`codechef-api.vercel.app`, or `atcoder.jp` are exactly the kind of thing
generic tracker/analytics blocklists sometimes catch, even though they're
not trackers. GitHub and the same-origin LeetCode proxy are far less likely
to get blocked this way, which is consistent with some platforms appearing
to "work" while others silently never even started.

Fix: each fetch is now dispatched via `Promise.resolve().then(() =>
fetch(spec.url))` instead of a bare `fetch(spec.url)` call — this defers
the call into a microtask, so a synchronous throw becomes a normal promise
rejection that the existing `.catch()` already handles (rendering that one
platform as "Unreachable" with a note), instead of aborting every
remaining check in the loop.

Reproduced the exact failure mode and the fix with a standalone Node
harness simulating a blocking `fetch`: the old code reached only 1 of 5
platforms before crashing the loop; the fixed code reaches all 5 every
time, with blocked ones correctly shown as Unreachable instead of stuck
on "Checking…" forever. Re-verified the full render/click-handler path
afterwards too.

No other behavior changed — same tab, same endpoints, same UI.

Cache bumped (`v146-cp-api-health` → `v147-cp-api-health-fix`).

## ✅ New this round: Competitive Programming — 🔌 API Health tab

Additive to `src/competitive-programming-widget.js` only — no other widget
touched, no new files.

Audited every platform integration in this widget first, as requested,
before adding anything:

- **GitHub** — official REST API (`api.github.com`). Reliable.
- **Codeforces** — official public API (`codeforces.com/api`). Reliable.
- **LeetCode** — already goes through the server-side proxy
  (`/api/leetcode`) added in an earlier round: official GraphQL first,
  community-mirror fallback only if that's unreachable.
- **CodeChef** — a free, community-hosted API
  (`codechef-api.vercel.app`), not an official CodeChef endpoint. This
  is the one most likely to sleep, rate-limit, or go down without
  warning — already called out in the Settings tab.
- **AtCoder** — an official but undocumented per-user JSON endpoint
  (`atcoder.jp/users/:id/history/json`). No solved-count API exists on
  AtCoder itself, which is a real gap but not one a client-side fetch
  can close.
- **HackerRank** — confirmed (again) that there is no public stats API
  at all, which is why it's already handled as profile-link +
  manual-entry only.

The gap: every one of these syncs is account-specific, so a failed
sync only ever showed up as "handle not found" or a generic error —
with no way to tell, before typing in a username, whether a given
platform's API was actually up right now. Added a new **🔌 API
Health** tab (right after Sync Center) that pings all five platform
APIs directly — no username needed — using the *same* endpoints the
real integrations already call wherever one exists generically
(Codeforces' `contest.list`, CodeChef's `/contests`, AtCoder's real
per-user endpoint against a known-active handle), so a green check
here is a genuine signal the live integration will work. Each card
shows: whether it's an official API, a community-hosted one, or a
server proxy; live status (Online / Responded with an error /
Unreachable); response time; and last-checked time. A "Check All
Platform APIs" button re-runs it on demand, and it also auto-runs
once the first time the tab is opened (mirroring how GitHub/LeetCode/
Codeforces/CodeChef already lazy-fetch on tab-open elsewhere in this
widget) — no new intervals, no change to existing sync behavior.

Verified with a standalone Node + stubbed-DOM harness covering all
three states (online, HTTP-error "degraded", and network-failure
"unreachable") for every platform, plus the existing render path, tab
switch, and click-handler wiring — no runtime errors, correct badges
in each case.

Cache bumped (`v145-dev-mastery-parity` → `v146-cp-api-health`); no
new files, so nothing to add to `APP_SHELL`.

## ✅ New this round: Dev Mastery — parity fixes with DSA Mastery

Both additive to `src/dev-mastery-premium-widget.js` only — no other widget
touched.

- **Next-level gap chip** — a new `nextLevelGap()` (mirroring
  `src/dsa-mastery-premium-widget.js`'s own `x()`/`.dmp-next-level`) projects
  how many more difficulty-weighted points (Beginner=1/Intermediate=3/
  Advanced=5, the same weights `computeStats()` already uses) are needed
  to cross into the next level. Renders as a small line under the level
  chip (`.dvp-next-level`), hidden at Job Ready or when there's no
  weighted total yet to project from — same as the DSA version.
- **Clickable level pills** — DSA's pills already jump to Interview
  Sheets pre-filtered to the weakest difficulty. Dev's pills were static
  decoration. One real adaptation was needed: DSA's filter keys off a
  per-tier Easy/Medium/Hard split that Dev has no equivalent of, and
  `src/dev-task-insights-widget.js` (which renders *inside this same
  `.dvp-shell`*, as `#dti-task-insights`) only exposes a global
  category filter, not a concept one. So every pill now scrolls to Task
  Insights and pre-selects `weakestCategory()` in `#dti-category-filter`
  (only if that category currently exists as an option — categories are
  rebuilt from live tasks, so this is a real check, not decorative),
  dispatching a `change` event the same way DSA's `p(diff)` does. Pills
  got `role="button"`/`tabindex`/keyboard support and hover/focus-visible
  styling to match.

Verified against edge cases (no tasks, maxed-out score, mixed categories)
with a standalone Node harness — `computeStats()`/`nextLevelGap()`/
`weakestCategory()` all behave as expected at the boundaries.

Cache bumped (`v144-stability-hardening` → `v145-dev-mastery-parity`); no
new files, so nothing to add to `APP_SHELL`.

## ✅ New this round: Stability audit + one real fix

Did a full pass over storage safety, JSON parsing, interval/listener
cleanup, and the mount-safety coverage list, looking for genuine crash
risks rather than style nitpicks. Most of the codebase held up —
`safeSet()`/`safeGet()` are already used almost everywhere raw
`localStorage` access exists, every `JSON.parse` call site that isn't
test code is already try/caught, every `setInterval` either self-clears
or is a page-lifetime decorator by design, and `src/mount-safety.js`'s
`NAMES` list already covers every `__mountX`/`__unmountX` pair that
exists in this build (62/62).

One real gap found and fixed: **`src/ai-career-mentor-widget.js`** read
eight React-owned shared keys (`dsaQuestions`, `devTasks`, `projects`,
`tasks`, `studySessions`, `notes`, `exams`, `achievements`) with only
a `|| []` fallback, which only catches a missing/null value — not a
present-but-wrong-shaped one (e.g. an object instead of an array, from
a corrupted write or a future schema hiccup). Since this widget's own
`(o.sessions||[]).forEach(...)`-style call sites re-check truthiness
rather than shape, a wrong-shaped value would have thrown mid-render
and silently broken the Career Mentor card until the data was fixed by
hand. Added a small `aa()` array-assert helper (mirroring the
`Array.isArray(...)?...:[]` guard already used by
`src/readiness-50lpa-widget.js` and `src/ai-smart-learning-path-widget.js` for
these same shared keys) and wrapped all eight reads in it. Nothing
else in the file changed.

Cache bumped (`v141-precache-gap-fix` → `v144-stability-hardening`).

## ✅ New this round: Accessibility + quick theme toggle

Two small, additive fixes from a UI/UX pass:

- **Toast screen-reader announcements** (`src/a11y-toast-patch.js`, new) —
  audited every toast/snackbar in the codebase: `.et-toast`
  (exam-tracker) and `#upp-toast` (premium-productivity-features)
  already had `role="status" aria-live="polite"`; `.htw-toast`
  (hackathon-tracker) had `role="status"` but no explicit `aria-live`;
  `#arise-xp-breakdown-toast` had `aria-live` but no `role`; `#cp-toast`
  (competitive-programming) and `.water-reminder-toast` had neither, so
  a screen reader user never learned a sync failed or a water reminder
  fired. Since every one of these widgets rebuilds its toast via
  `innerHTML` on each show (so a hand-added attribute would just get
  wiped on the next render), this patches the DOM directly and
  re-patches on every re-render via a coalesced `MutationObserver` —
  same "reach everything from one file" approach `src/animation-upgrade.js`
  and `src/mount-safety.js` already use. No widget file touched.
- **Quick light/dark toggle** (`src/theme-quick-toggle.js` + `.css`, new) —
  src/theme-system.js already has a full System/Light/Dark + all-themes
  picker, but it only lives in Settings. This adds a persistent
  top-right icon button (fixed position, safe-area aware, keyboard
  focusable) that flips just the light/dark axis in one tap from
  anywhere. It remembers the last theme actually used in each mode
  (`arise-quick-toggle-last-theme-v1`) so flipping from a custom pick
  like Dracula to light and back returns to Dracula, not the plain
  default dark theme — and it writes back to src/theme-system.js's own
  `modeStorageKey` so the Settings picker stays in sync either
  direction. Purely additive: reads/writes src/theme-system.js's own public
  API and documented storage key, no edits to src/theme-system.js itself.

Also investigated and **not** changed, with reasons:
- *Per-widget loading skeletons* — turned out to be largely a non-issue:
  of ~85 widgets, only `src/competitive-programming-widget.js` does live
  network fetches (GitHub/LeetCode/Codeforces/CodeChef/AtCoder), and it
  already uses `src/widget-shared-utils.js`'s `skeletonCardsHTML()` /
  `skeletonProfileHTML()`. Every other widget reads synchronously from
  `localStorage` and renders immediately on mount, so there's no
  meaningful loading window to put a skeleton in.
- *Nav "only 4 tabs"* — an earlier pass misread `src/widget-nav.js` (a
  generic in-widget tab-pill helper used by individual widgets like the
  13-tab attendance tracker) as the top-level app navigation. The real
  top-level nav has ~19 sections (Dashboard, Learning, Exam Tracker, DSA
  Tracker, Development, CGPA, Competitive Programming, Social Media,
  Hackathon Tracker, Placement Tracker, Certificates, Attendance &
  Skills, CSE Syllabus, Projects, Notes, Expenses, Resources, Analytics,
  Achievements, Settings) and lives inside the compiled React bundle
  (`assets/app-bundle.js`), which this project intentionally avoids
  hand-editing (same reason the Syllabus+ accordion sync above only
  patches DOM properties rather than touching that JSX). Confirming
  whether every widget is reachable from one of those 19 sections would
  need to trace the compiled bundle's own routing, not something safe
  to script blind.

Cache bumped (`v137-appbundle-syntaxfix` → `v138-a11y-theme-toggle`);
`styles/theme-quick-toggle.css`, `src/theme-quick-toggle.js`, and
`src/a11y-toast-patch.js` added to `APP_SHELL`.

## ✅ New this round: CSE Syllabus+ — GPA impact, portfolio auto-flag, weighted pace, accordion sync, exam bundle backup

All additive to `src/features/semester-risk/cse-syllabus-plus-widget.js` —
nothing removed or restructured from prior rounds.

- **Semester GPA-impact preview** — a new 📈 chip per subject row (only
  rendered when a real match exists — nothing fabricated). Reads the CGPA
  Tracker's own `arise-cgpa-tracker-v1` state read-only, matches this
  subject by semester number + exact name, and lets you pick a
  hypothetical grade to preview "if this scores X, Sem N's SGPA moves
  A → B". The SGPA math itself is copied from `src/cgpa-tracker-widget.js`'s
  own `f()`/`v()` (counted-subjects-only, credits × grade-point / total
  credits) so the number matches what that widget would actually show.
  Nothing here writes back to the CGPA Tracker.
- **Resume/portfolio auto-flag** — a 🏆 "Portfolio-ready" row appears once
  a subject is placement-critical + done + has linked notes + 120+
  minutes of logged study time (all signals this file already tracks).
  "+ Certificates" writes through the Certificates widget's own exposed
  `window.AriseCertificatesStorage.upsert()` API; "+ Skills Timeline"
  appends a compliant entry directly to `arise-skills-timeline-v1` (no
  exposed API there, so it matches that widget's own `normalizeSkill()`
  shape exactly, de-duped by name). A ✕ dismiss option and a
  `cse-syllabus-portfolio-suggested-v1` per-subject state key keep it from
  nagging once actioned. A new "🏆 Portfolio-Ready" stat card shows the
  count when non-zero.
- **Accordion live-sync (best-effort)** — the long-standing "checking a
  subject here only updates the compiled accordion's own checkboxes on
  next tab visit" note is now mitigated: `syncAccordionCheckboxes()`
  patches the real `#subj-<id>` checkbox's `.checked` DOM property
  (property only — no synthetic click/change events, so the compiled
  React handler stays untouched) on every write plus a 1200ms poll +
  MutationObserver + focus/visibilitychange gate, the exact same pattern
  `cse-placement-critical-widget.js` already uses on these same rows for
  its badges. This is a real improvement (~1.2s instead of "next tab
  visit"), not a full fix — the accordion's own stats/heatmap next to it
  still only refresh on next mount, since actually forcing that requires
  hand-patching the compiled, sourcemap-less JSX this file has always
  avoided touching.
- **Pace projection weighted by difficulty** — `overallDailyRate()` and
  `computePaceProjection()` now count "difficulty-units" (each subject's
  1–5 self-rating, unrated = 3, same default the Priority Queue score
  already uses) instead of raw subject counts, so a semester loaded with
  hard subjects no longer gets the same finish-date credit as one with
  the same count of easy subjects. The "need 3+ completions in 14 days"
  data-floor stays a raw count (guards data volume, not workload).
- **Exam Bundle export/import** — new "📦 Export/Import Exam Bundle"
  buttons alongside the existing widget-scoped Export/Import. Bundles
  Syllabus+ together with the CGPA Tracker (`arise-cgpa-tracker-v1`) and
  Attendance Tracker (`arise-attendance-tracker-v1`) into one JSON file —
  a middle ground between the single-widget export and the app-wide
  Backup & Restore Center, matching how a student actually thinks about
  "back up before exams".

Cache bumped (`v123-placement-critical-sync` →
`v124-syllabus-gpa-portfolio-pace`); no new files were added, so nothing
new needed adding to `APP_SHELL`.

## ✅ New this round: Animation upgrade, round 2 — rows, toggles, toasts, empty states, load stagger, focus rings

Second pass on top of the animation upgrade below, same file-once /
reaches-everything approach. All additive to `styles/animation-upgrade.css` /
`src/animation-upgrade.js` — nothing removed or restructured from round 1.

- **Rows** (`dsc-row`, `exw-row`, `drs-row`, etc.) — hover highlight +
  slide-in-from-left scroll reveal, deliberately excluding real `<tr>`
  elements (`:not(tr)`) since a few widgets — attendance tracker,
  competitive programming, notes, placement tracker — use actual
  `<table>`/`<tr>` markup where a `transform` has inconsistent browser
  support.
- **Toggles** (`exw-recur-toggle`, `exw-type-toggle`) — same press/hover
  feedback as regular buttons, since these don't share the `-btn` suffix.
- **Toasts** (`et-toast`, `htw-toast`, `water-reminder-toast`) — slide-up +
  fade entrance. These widgets already rebuild their toast markup via
  `innerHTML` on every show, so the CSS animation replays naturally each
  time one appears — no JS hook needed.
- **Empty states** (`dsc-empty`, `exw-empty`, `hpw-empty`, etc.) — gentle
  fade+scale instead of an abrupt snap-in.
- **First-paint stagger** — pure-CSS `nth-child` delays for the first 5
  items inside any `*-badges`/`*-chips`/`*-pills`/`*-cards` wrapper, so
  above-the-fold groups (which the JS scroll-reveal intentionally skips,
  to avoid a blank flash on load) still get a staggered pop-in instead of
  appearing all at once.
- **Focus-visible ring** — a clearer keyboard-navigation ring on buttons,
  toggles, nav pills, and form inputs.

Cache bumped again (`v116-animation-upgrade` → `v117-animation-upgrade-2`);
no new files were added this round, so nothing new needed adding to
`APP_SHELL` beyond what round 1 already precaches.

## ✅ New this round: Site-wide animation & micro-interaction upgrade

Every widget already follows the same `<prefix>-card` / `<prefix>-btn` /
`<prefix>-badge` / `<prefix>-chip` / `<prefix>-pill` / `<prefix>-fill` /
`<prefix>-panel` / `<prefix>-modal` class-suffix convention (that's how
`styles/theme.css` already re-skins all of them from one place with selectors like
`[class*="glass-"]`). This upgrade hooks into that same convention, so it
reaches all ~85 widget/feature files at once without editing any of them:

- **`styles/animation-upgrade.css`** (new) — hover-lift + press feedback on every
  card, panel, and button across every widget; animated width transitions
  and a shimmer sweep on every progress/skill/budget/mastery fill bar;
  pop-in animation for badges/chips/pills; smoother modal open transitions;
  a re-playing entrance animation on `AriseWidgetNav` tab panels (`.wnav-panel`)
  every time a tab is switched, plus a small icon bounce on the active pill.
  Excludes compound sub-classes (e.g. `hxp-card-value`, `htw-badge-chip`) via
  `:not([class*="-card-"])`-style guards so only the actual card/badge/etc.
  containers animate, not their nested labels.
- **`src/animation-upgrade.js`** (new) — a scroll-reveal (IntersectionObserver,
  one-shot, unobserves after firing) that fades/rises widget cards and
  panels in as you scroll to them, staggered per parent, skipping anything
  already visible on first paint so nothing flashes blank on load; and a
  single delegated click listener that spawns a short ripple on whatever
  button or `.wnav-pill` was clicked. A `MutationObserver` on
  `document.documentElement` picks up widgets mounted later by the lazy
  widget loader, so newly-injected widgets get the same treatment without
  needing to be wired in individually.

Both files are additive only — no widget markup, storage key, or business
logic was touched. Both fully respect `prefers-reduced-motion` (the JS
no-ops entirely if it's set; the CSS is already covered by the existing
`@media (prefers-reduced-motion: reduce)` guard at the bottom of
`styles/theme.css`, since that guard targets `html[data-theme] *`). Both also
check `document.hidden` before doing work, matching the guard pattern
already used by the ambient-sound and mutation-bus watchers elsewhere in
this codebase.

Wired into `index.html` (`<link>`/`<script defer>` added right after
`styles/theme.css`, near the top of `<head>`, so it's ready before most widgets
mount) and into `service-worker.js`'s `APP_SHELL` precache list, with the
cache name bumped (`v115-pace-bulk-export` → `v116-animation-upgrade`) so
existing installs pick up the new files on next load.

## ✅ New this round: Dev/DSA widget pairs de-duplicated

The 8 near-identical `dev-*`/`dsa-*` widget pairs (streak, milestone-badges,
pace-projection, solve-speed, difficulty-radar, topic-breakdown,
weekly-sparkline, roadmap/sheet-coverage — 16 files, 2,785 lines) each
redefined byte-identical copies of `safeGet()`, `boot()`, and (where used)
`dayKey()`/`startOfDay()`/`highestCrossed()`. That boilerplate now lives in
one place, `src/widget-shared-utils.js`, exposed as
`window.__ARISE_WIDGET_UTILS__`. Every one of the 16 files was mechanically
rewritten to call it instead of redefining it — nothing else changed: same
DOM ids, CSS classes, host selectors, thresholds, and business logic per
widget, verified with a headless Node harness that ran the original and
refactored `computeStreak()`/`computeBadges()` against identical fake
localStorage data and diffed the JSON output (all matched exactly). Net
effect: ~2,785 lines → ~2,366 lines across those files, and a bug fix to
the shared plumbing (e.g. the mutation-bus debounce) now only needs to
happen once instead of being copied into 16 places.

`src/widget-shared-utils.js` was added to `index.html`'s lazy-load script list
(right after `src/storage-watch-bus.js`, before any widget that needs it) and
to `service-worker.js`'s `APP_SHELL` precache list; the service worker
cache name was bumped (`v107-about-panel-sync-copy` →
`v108-widget-utils-consolidation`) so existing installs pick up the changed
files on next load instead of serving stale cached versions of the 16
rewritten widgets.

No other widget-pair behavior was touched — the *business logic* differences
between dev and dsa tracks (different data sources, badge types, thresholds)
were intentionally left alone rather than force-merged into one generic
factory, since that would have meant guessing at intended behavior across
8 different widget kinds without a way to run the live app to verify.

## 🔧 Still pending — `FocusRing.jsx` / `useStudyStreak.js` integration

This is the other item flagged last round and still unresolved: it needs
your actual Vite source project (the component that renders
`.timer-ring-container`), not this deploy zip — `assets/app-bundle.js`
ships with no sourcemap, so a JSX-level rewrite can't be safely hand-patched
into the minified bundle. Upload the source repo or just that one component
file and I'll do the real integration next.

## ✅ Live now, no action needed

`src/timer-visual-upgrade-widget.js` has been patched in place — the redundant
40-tick overlay ring is deleted. That was the actual cause of the tick
misalignment: your React ring (in `assets/app-bundle.js`) already draws 60
ticks aligned to the progress circle's own geometry; this file was drawing a
*second*, independent 40-tick ring on top with its own guessed radius. One
source of truth now. Nothing else in this zip needs to change for that fix
to take effect — just deploy as-is.

## ✅ Also live now — patched directly into `assets/app-bundle.js`

The two `setInterval` bugs described in `useSmoothStopwatch.js` and
`useCountdownTimer.js` below have been fixed **in place, inside the minified
bundle**, without waiting on a source-level integration:

- **Stopwatch tick**: was `setInterval(...,10)` — 100 re-renders/sec of the
  whole widget while the stopwatch runs. Now ticks at 250ms (4/sec). Elapsed
  time is still computed from `Date.now() - startTimestamp`, not from a tick
  counter, so display accuracy is unaffected — only the re-render rate
  dropped. (The more thorough fix in `useSmoothStopwatch.js` — moving the
  digits to a direct DOM write with *zero* re-renders while running — is
  still a further optimization on top of this; see below for why it wasn't
  also folded into the bundle.)
- **Countdown timer**: the effect no longer lists the remaining-seconds
  state in its own dependency array, so it's no longer torn down and
  rebuilt every single second. It now anchors to a wall-clock deadline
  (`Date.now() + remainingSeconds * 1000`) computed once per start/resume
  and polls at 250ms, so a throttled/backgrounded tab self-corrects instead
  of drifting.

Both were minimal, self-contained edits to two existing `useEffect` blocks —
low risk to hand-patch directly into a minified file since neither touches
JSX structure or adds new state/props.

## 🔧 Still to integrate — `upgrade/focus-ring/`

`FocusRing.jsx` and `useStudyStreak.js` were **not** folded into the bundle
in this pass, and deliberately so: unlike the two interval fixes above,
`FocusRing.jsx` restructures the inline ring JSX itself and introduces new
props (`category`, `streakCount`, `celebrateToken`) that don't exist
anywhere in the current data flow yet. `assets/app-bundle.js` has no
sourcemap in this deploy zip, so there's no safe way to verify a JSX-level
rewrite of that scope against the real component tree by patching minified
text — that's exactly the situation this file already flagged as needing
the real source. Wiring these in still needs to happen in your actual Vite
project (where the original `Hx` component's JSX lives), not in this deploy
zip:

| File | Replaces | Fixes |
|---|---|---|
| `FocusRing.jsx` | inline `.timer-ring-container` JSX | duplicate/misaligned ticks, category+streak+paused-ring+burst as props instead of DOM-scraped/polled, animated `filter` glow → static-blur + opacity/scale, comet head synced to real seconds, last-10% urgency, `prefers-reduced-motion`, `role="timer"` + `aria-live`, stopwatch ring freezing after 60 min |
| `useStudyStreak.js` | overlay's 2s localStorage poll | event-driven via the app's existing `studySessions:updated` / storage-watch-bus |

`useSmoothStopwatch.js` and `useCountdownTimer.js` remain in this folder too
as the "fuller" version of the fix already applied above (direct-DOM-write
digits, ref-based `onComplete` to avoid stale-closure risk) — worth pasting
in at the source level next time you're in the real component, even though
the bundle-level patch already closes the two concrete bugs.

Each file has full integration notes (exact prop mapping, which variables
in the minified component to wire up) in its own comment block.

### Suggested order
1. Deploy as-is — the tick fix, the stopwatch re-render fix, and the
   countdown drift/rebuild fix are all already live.
2. At the source level, paste `useCountdownTimer` and `useSmoothStopwatch`
   in place of the now-patched interval effects, for the direct-DOM-write
   and stale-closure improvements the bundle-level patch didn't attempt.
3. Paste `FocusRing` in place of the inline ring JSX, wiring
   `category`/`streakCount` from `useStudyStreak` and a `celebrateToken`
   counter bumped on session completion.
4. Once `FocusRing` is live, delete `src/timer-visual-upgrade-widget.js` and
   its `<script>` tag from `index.html` — every visual duty it had is now
   prop-driven in React. `src/focus-timer-upgrade-widget.js` (the
   session-complete note/rating modal) is untouched — separate concern.

### Required CSS additions (wherever your global styles live)
```css
.focus-ring-comet-pulse { animation: focus-ring-comet-pulse 1s ease-in-out infinite; }
@keyframes focus-ring-comet-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.6); opacity: .6; }
}
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
}
```

## ✅ New: smoke tests for the shared cross-widget plumbing

`placement-tracker` was the only widget with tests. Two more were added at
the project root, same dependency-free Node-harness style as
`src/features/placement-tracker/test-storage-calculations.js`:

- `tests/storage-watch-bus.js` — exercises `window.__ARISE_STORAGE_WATCH_BUS__`
  directly: shared single timer across multiple `watch()` calls, callback
  only fires on an actual value change (not every tick), one throwing
  watcher doesn't take down its siblings, and the timer pauses/resumes on
  `visibilitychange`. Uses a fake `setInterval` so it runs instantly instead
  of waiting on the real 1200ms cadence.
- `tests/readiness-engine.js` — exercises `window.__READINESS_ENGINE__.computeComposite()`:
  weighted averaging, null/missing scores flagged and penalized, out-of-range
  scores clamped to `[0,100]`, diminishing returns above the configured
  threshold, achievement bonus capped at `maxBonus` instead of summed
  unbounded, empty-weights doesn't divide by zero, and `explainComposite()`
  doesn't throw on `null`.

Run either with `node tests/storage-watch-bus.js` / `node tests/readiness-engine.js`
— both exit non-zero on any failed assertion, so they drop straight into a
CI step if you add one.

## ✅ Verified: service-worker precache list

Diffed `APP_SHELL` in `service-worker.js` against every actual file in the
zip. It's complete — every widget, feature file, sound, and icon that ships
is listed, and every listed path resolves to a real file (no dead entries
either). The only files on disk *not* in `APP_SHELL` are the two test files
above, the `netlify/functions/*` serverless handlers (never fetched by the
client, so they don't belong in a client precache), and `service-worker.js`
itself — all correctly excluded. No changes needed here this round, but
worth re-running this diff any time widgets are added, since nothing
currently catches a missed entry automatically.

## ✅ DSA Mastery: Mistake Journal + weekly Study Plan

The existing DSA Mastery card keeps its original seven tabs and adds two
sections at the end: **Mistakes** and **Study Plan**.

- `src/dsa-mistake-journal-widget.js` stores dated, categorized entries with
  a description, optional corrective takeaway, optional linked bank problem,
  and open/resolved state. A linked problem's title snapshot remains visible
  if the bank item is later removed. Repeat counts are computed only for the
  same linked problem ID and category. Search and status/category filters are
  included. The journal does not rewrite `dsaQuestions.notes` or
  `dsaProblemInsights`.
- `src/dsa-study-planner-widget.js` stores a user-defined recurring weekly
  schedule (day, start time, duration, focus and optional topic), a selected
  exam date, and per-date self-reported session check-offs. Low-availability
  mode displays a 15-minute version of each block without changing the saved
  duration. The exam date is an in-app countdown/reminder only; it does not
  request notification permission or send browser notifications. The planner
  does not create or mutate global daily-learning tasks or claim actual study
  time.
- The existing DSA tablist now has panel associations, roving focus, and
  Arrow/Home/End keyboard navigation while retaining its button-based layout.
- `src/dsa-solve-speed-widget.js` now reads the main bank's `timeTakenMin`
  field as well as its prior supported aliases.
- New storage keys `dsaMistakeJournal-v1` and `dsaStudyPlanner-v1` are
  registered in `src/storage-keys.js`, the cloud/backup allowlist, and this
  storage map. New keys are independent version-1 stores; existing DSA data
  is not migrated or rewritten.

Focused DSA tests: `node scripts/_run-test.cjs tests/test-dsa-tier3-toolkit.js`.
Storage inventory: `npm run audit:storage`. Full suite: `npm test`.
Production build: `npm run build`. Real Chromium smoke suite (requires the
built app and the local test server at port 8123): `npm run test:browser`.
