# Arise — Loading Experience & Skeleton UI System v2 (2026-11-07)

Scope: the checked-in repository `ujjwalmaurya890-ops/Arise.com`, branch
`arena/fd07d4bb-arise-com`, on top of the 2026-10-29 loading-foundation work and
the 2026-11-04 motion pass. This document records what was audited, what exists
now, what was verified by an executed command, and what is still limited.

Everything below was produced by running the repository. Where a claim is not
verified, it is written in §10 (Known limitations) instead.

---

## 1. Summary

The application is a static `index.html` shell plus a React bundle
(`assets/app-bundle.js`) and ~113 classic widget scripts delivered lazily in 12
content-hashed chunks. Almost all widget data is computed **synchronously** from
the account-scoped local store; the genuinely asynchronous surfaces are the
secure cloud boot, cloud sync/backup, AI requests, coding-platform proxies, the
interview-sheet dataset, and file import/export.

The 2026-10-29 pass already provided a shared skeleton/spinner/error foundation
(`styles/animation-upgrade.css`, `src/animation-upgrade.js`) and content-shaped
placeholders for deferred widget mounts. This pass **extends** that system
rather than replacing it:

* a new **loading design layer** (`styles/loading-system.css`) with
  component-shaped skeletons for 30 content kinds, four shimmer variants,
  a four-size spinner, progress bars, an AI thinking/streaming vocabulary, lazy
  image placeholders, refresh-in-place, a full-page boot loader and an offline
  banner — all derived from the existing theme tokens;
* a new **loading runtime** (`src/loading-system.js`, `window.AriseLoading`)
  that owns the async lifecycle: delayed skeletons, minimum visible duration,
  preserved content with a refresh indicator, error + retry, empty states,
  stale-request cancellation, a ref-counted top progress line, guarded buttons,
  one shared polite/assertive live region, image loading/failure states and
  connectivity state;
* targeted integration into the lazy mount queue, route navigation, the backup
  centre, AI insights, interview-sheet filtering and the secure boot screen;
* a new regression suite (380 assertions) and three new browser-level probe
  groups, plus screenshots of the real states.

No existing feature, storage key, widget mount contract, chunk or service-worker
behaviour was replaced.

---

## 2. Audit — what was there before

| Area | Reality found |
| --- | --- |
| Shell | Static `index.html`; protected scripts executed after the secure gate; React shell in `assets/app-bundle.js` |
| Widgets | ~113 ordered classic scripts in 12 chunks; `window.__mountX(el)` contracts; deferred-mount stubs render a skeleton and replay the mount |
| Existing loading layer | `.uxa-skeleton*`, `.uxa-spinner*`, `.uxa-progress-*`, `renderSkeleton`, `renderErrorState`, `renderEmptyState`, `setButtonBusy`, `fetchWithTimeout`, `bindModalA11y` |
| Existing states | Mount skeletons/failures with retry; interview sheets + sheet coverage loading/empty/error/retry; AI insights skeleton + indeterminate bar; CP cached-refresh errors; cloud gate spinner |
| Gaps found | no component skeletons beyond 6 generic variants; no chart-shape family; no profile/nav/sidebar/calendar/timeline/settings/modal/search/notes shapes; no image placeholders; no global navigation progress; no offline state; no guarded-button contract for backup actions; AI had no explicit thinking status; async failures could still leave a placeholder if a widget rolled its own spinner; no refresh-in-place helper; timing constants scattered per call site |
| Async surfaces (real) | `#cloud-gate` bootstrap, `AriseAuth`/`AriseCloudSync` push/pull/export/import (`fflate` ZIP), `/api/ai-ask`, `/api/leetcode`, `/api/codechef`, `/api/gfg`, Codeforces/AtCoder/GitHub/Codewars public APIs, `assets/interview_sheets_data.json`, user file reads (`FileReader`, IndexedDB attachments) |
| Synchronous surfaces | all derived analytics, trackers, notes/wiki filtering, charts computed from `localStorage` — no skeleton was added to these merely for decoration |

---

## 3. Architecture

```
styles/animation-upgrade.css   existing motion/loading tokens + uxa primitives (unchanged contact surface)
styles/loading-system.css      NEW  component skeletons, shimmer variants, progress, AI, images, boot, offline
src/animation-upgrade.js        existing runtime helpers (kept; used as a fallback and for button width locking)
src/loading-system.js          NEW  window.AriseLoading — async lifecycle, skeletons, progress, buttons, a11y, images
index.html                      boot markup + protective registration + richer mount shapes
```

`window.AriseLoading` API (all methods are safe to call when the DOM is absent):

| Group | Members |
| --- | --- |
| Skeletons | `skeleton(kind, opts)`, `createSkeleton`, `createCardSkeleton`, `createTableSkeleton`, `createChartSkeleton`, `createProfileSkeleton` |
| Full page / inline | `createPageLoader(opts)`, `createInlineLoader(opts)` |
| Mount | `mount(target, kind, opts)`, `clear(target)` |
| States | `state(target, 'loading'|'empty'|'error'|'offline'|'ready', opts)`, `emptyState`, `errorState`, `offlineState` |
| Async lifecycle | `run({ target, kind, task, render, empty, preserve, delay, minVisible, onError, errorTitle, … })` |
| Progress | `progress.start()`, `.set(0..1)`, `.done()`, `.fail()`, `.pulse()`, `showProgressLoader`, `hideProgressLoader` |
| Buttons | `button.busy(btn, busy, label)`, `button.idle(btn)`, `button.guard(btn, fn, opts)`, `showButtonLoading`, `hideButtonLoading` |
| Accessibility | `announce(message, { assertive })` |
| Media / network | `enhanceImages(root)`, `offline.show/hide/isOffline` |
| Config | `config` (mutable) |

### `run()` contract

1. A newer run on the same target **aborts** the previous `AbortSignal` and
   takes the sequence number, so a stale completion can never overwrite fresher
   content.
2. If the target already has meaningful content, `preserve` (default `true`)
   keeps it visible, adds `aria-busy` and a compact refresh chip — a skeleton is
   **never** drawn over readable data.
3. An empty target gets a content-shaped skeleton immediately; a populated
   target that opts out of preservation gets one only after `delay` (160 ms)
   so fast operations do not flash.
4. The skeleton stays for at least `minVisible` (380 ms, or `minVisibleFast`).
5. Success → skeleton/refresh chip removed, `aria-busy` cleared, `render()`
   called; `empty()` classifies "loaded but empty" separately from loading.
6. Failure → `aria-busy` cleared, an `role="alert"` error state with a retry
   control (which re-runs the same spec), or — when content was preserved — the
   old content plus an error chip. `rethrow` is opt-in; the default resolves so
   callers cannot leak an unhandled rejection.

Timing configuration lives in one place (`DEFAULT_CONFIG`) and can be overridden
by `window.__ARISE_LOADING_CONFIG__` or the device-local
`localStorage['arise-loading-config']` JSON, which is registered as a
**local-only** storage key in `src/cloud/storage-schema.js` (never synced or
exported across accounts).

### Content kinds built by `skeleton()`

`widget`, `section`, `dashboard`, `analytics`, `stat`/`stats`, `cards`,
`modules`, `profile`, `nav`, `sidebar`, `table`, `list`, `feed`/`activity`,
`notifications`, `chart`, `chart-line`, `chart-area`, `chart-bar`, `chart-pie`,
`chart-radar`, `chart-heatmap`, `chart-progress`, `calendar`, `timeline`, `form`,
`settings`, `search`, `notes`, `dsa`, `ai`, `modal`.

Each root is a single `role="progressbar"` with an accessible name
(`aria-label="Loading <area>…"`) and `aria-busy="true"`; its geometry is
`aria-hidden`, so nothing announces 30 rectangles. `progressbar` is deliberately
used instead of `role="status"`: status/alert roles are *live regions*, and a
page that mounts a dozen placeholders at once would otherwise create a dozen
competing announcements. Instead the runtime groups announcements through
`announceLoading()`, which announces the first pending area immediately and
coalesces the rest inside a 900 ms window, so simultaneous mounts produce one
"Loading dashboard…" utterance rather than a queue of them, followed by the
single completion announcement from `announce()`.

---

## 4. Loader types implemented

| Type | Implementation |
| --- | --- |
| A. Skeleton loaders | 30 content kinds above, used for deferred mounts, the AI card, tables, charts, notes/lists, forms and modals |
| B. Shimmer | one `transform`-only sweep per placeholder group + `--subtle`, `--card`, `--text`, `--circle`, `--full` variants; static under reduced motion/perf-lite |
| C. Spinners | `ars-spinner` xs/sm/md/lg; inline loader; existing `uxa-spinner` kept for compatibility |
| D. Full-page loader | `createPageLoader()` + the secure boot screen now shows a branded indeterminate bar (no percentages) |
| E. Progress bars | ref-counted global top line (navigation, route transitions), inline indeterminate bar for backup/import/export, determinate `progress.set()` for callers that have a real fraction |
| F. Button states | `button.guard()` (width-locked, spinner, duplicate-submit block, restore on success/failure/throw); used by backup actions; existing AI/retry buttons keep their own pending states |
| G. Table states | header + row + avatar + badge + action placeholders, responsive column collapse |
| H. Chart/analytics | line, area, bar, pie, radar, heatmap, progress shapes — never fake data values |
| I. Images/avatars | pending shimmer class, decoded reveal, error hatch fallback, mutation-bus + observer scanning, no layout shift |
| J. Search/filter | preserved content + polite result-count announcements (interview sheets) instead of fake skeletons for synchronous filtering |
| K. AI | AI-shaped skeleton, thinking dots with an honest in-flight message, indeterminate bar, streaming caret style available, completion/failure announcements |
| L. File/data | backup export/import/ZIP/pull/push: indeterminate progress, per-operation busy labels, guaranteed restore, error text + alert |

States are explicit: **loading**, **success with data**, **success with no
data**, **failed with retry**, **offline**. Empty is never shown while loading.

---

## 5. Pages and widgets upgraded

| Area | What changed |
| --- | --- |
| Secure boot (`#cloud-gate`) | static accessible boot progress bar, shown only while `data-busy="true"`; label mirrors the real bootstrap message; no fake percentage |
| Lazy widget mounts | mount-specific shapes (`notes`, `feed`, `cards`, `chart-heatmap`, `chart-area`, `chart-progress`, `calendar`, `timeline`, `analytics`, …) via `AriseLoading.skeleton`, legacy `renderSkeleton` kept as fallback; cleanup/retry unchanged |
| Navigation | `data-nav-id` route clicks and `popstate` drive the global progress line; widget tab rails pulse the same line (`widget-nav.js`) |
| Backup centre | every async action uses the shared busy button + indeterminate bar + `aria-busy` status; duplicate clicks blocked; failure always restores the control |
| AI Real Insights | AI skeleton, thinking status with honest copy, completion announcement |
| Interview Sheets | result-count polite announcement after the search debounce; existing loading/error/retry behaviour untouched |
| Every image/avatar | placeholder → loaded/failed states |
| Whole app | offline banner, single live region, reduced-motion and perf-lite behaviour |

Widgets whose data is synchronous (CGPA, attendance, exams, XP, heatmaps,
planners, dashboards, etc.) were **not** given artificial skeletons; their
loading experience is the deferred-mount placeholder plus the shared global
indicator, which is where time is actually spent.

---

## 6. New files

| File | Purpose |
| --- | --- |
| `styles/loading-system.css` | loading design layer (986 lines before this doc) |
| `src/loading-system.js` | loading runtime / `window.AriseLoading` |
| `tests/test-loading-system-v2.cjs` | 380-assertion jsdom regression suite |
| `scripts/capture-loading-states.cjs` | reproducible screenshot capture for docs |
| `docs/screenshots/loading/01…07.png` | captured states (boot, skeleton kit dark/light, mobile, AI thinking, nav progress, offline) |
| `docs/LOADING-SYSTEM-2026-11-07.md` | this document |

## 7. Modified files

| File | Change |
| --- | --- |
| `index.html` | loading stylesheet + protected runtime, gate boot bar markup, richer mount shape map, new-system-first mount skeleton with legacy fallback |
| `service-worker.js` | both loading assets added to `CORE_SHELL`; cache name bumped to `v248-secure-cloud-loading-system` |
| `src/widget-nav.js` | route/tab transition progress pulse |
| `src/backup-center-widget.js` | guarded buttons, indeterminate progress, busy labels, restored controls |
| `src/ai-real-insights-widget.js` | AI skeleton, thinking status, completion announcement |
| `src/interview-sheets-widget.js` | polite filtered-result announcements |
| `src/cloud/storage-schema.js` | `arise-loading-config` registered as device-local |
| `scripts/verify-loading-browser-e2e.cjs` | new probes: boot bar, nav progress, v2 skeleton geometry (320–1920 × 2 themes), image states, guarded button, shimmer vs perf-lite, offline banner, reduced-motion v2 |
| `assets/chunks/w01,w03,w06,w08` | regenerated by the existing build (hash change only) |

---

## 8. Performance

* Shimmer is CSS-only (`transform: translate3d`) and **one pseudo-element per
  placeholder group**, not per shape; the shapes themselves are static.
* No JS animation loops; the progress ramp uses three timers, cleared on
  completion. All `run()` timers and listeners are cleared; every run is
  keyed so late completions do nothing.
* The top bar and placeholders use `contain: layout style` where safe, and
  skeletons are plain `span`s (no shadows, filters or blur).
* Image scanning is debounced (160 ms) and only reacts to added `<img>` nodes.
* `html.perf-lite` (≤4 cores, save-data, Brave, reduced motion) renders static
  placeholders; `html.reduce-motion` also converts spinners/indeterminate bars
  to a calm opacity pulse.
* In headless Chromium, boot CLS measured 0.0019–0.0051 across runs (threshold
  < 0.1) and no page/console errors were recorded.

---

## 9. Accessibility

* Placeholders expose `role="progressbar"` + `aria-label` + `aria-busy="true"`
  and keep their geometry `aria-hidden`; they are **not** live regions, so 30
  rectangles never become 30 announcements.
* Announcements are grouped by `announceLoading()` (900 ms window): the first
  mount announces immediately, concurrent mounts are coalesced, and the
  per-region `announce()` keeps its own 700 ms de-duplication. Completion and
  failure are announced once per region (`state("ready")` also clears a
  placeholder left behind by a navigation race).
* `aria-busy` is set while a host is loading and always cleared — including on
  failure, stale results and retries (covered by tests).
* Two shared live regions (polite + assertive); errors use `role="alert"` and
  assertive announcements.
* Retry controls are native buttons; keyboard focus is untouched, and the
  existing modal focus trap continues to run.
* Reduced motion: no shimmer, no sliding bar, calm pulse for spinners; tested in
  Chromium (`prefers-reduced-motion: reduce`).
* Progress bars only appear with a real operation; the boot bar has an
  accessible name and mirrors the real bootstrap message as `aria-valuetext`.
* Loading never replaces readable content (refresh-in-place) and never shows an
  empty state while a request is pending.

---

## 10. Testing (executed, not estimated)

| Command | Result |
| --- | --- |
| `npm test` (build chunks → 69 test files → cloud suite) | **exit 0**; 0 failing files; cloud `node:test` 69/69 pass |
| `node tests/test-loading-system-v2.cjs` | **380/380 assertions pass** (30 skeleton kinds, lifecycle, cloud-sync mapping, CP shared helper, announcement grouping) |
| `npm run test:browser:ux` (real Chromium, mocked secure cloud) | **all checks pass** — 8 numbered passes + skeleton geometry (320/390/768/1440/1920 px × dark + light) |
| `npm run test:browser` (secure cloud, storage, sync, ZIP, offline queue, logout) | **all 10 PASS lines** |
| `npm run test:browser:engineering` (12 chunks, 20 routes × 8 viewports, PWA, failure/retry) | **all 8 PASS lines** |
| `npm run build` | passes; 113 scripts → 12 chunks; `dist/` rebuilt |
| `npm run test:browser:coverage` (per-route audit, mocked cloud) | **pass** — 20 routes × 2 viewports + 6 throttled routes; 0 leftover placeholders, 0 `aria-busy` leaks, 0 overflow, 0 loader-attributed CLS, 0 errors |
| `node scripts/capture-loading-states.cjs` | 7 screenshots written |

New browser assertions specifically verify: boot progress visibility and
accessible name, top progress activation/idle after a route click, single global
bar, v2 skeleton kit fit at all breakpoints in both themes, shimmer animation
name in full-performance mode and static in perf-lite, image pending→loaded and
pending→error, guarded button disabled + spinner + single call + restore,
offline banner appear/clear with content still visible, and v2 reduced-motion
behaviour (`animation: none` for shimmer, `ars-reduced-pulse` for spinners).

The unit suite additionally pins the sync contract (idle → saving → real 40%
attachment fraction → done; failure; repeated events do not double-start the
bar; a real value clears the synthetic creep timer), the shared
`setIndeterminateBar()` helper (one idempotent `.ars-progress` element, removed
on `false`, host `aria-busy` never touched, legacy fallback when `AriseLoading`
is absent), and the grouped-announcement behaviour described in §9.

### Screenshots

`docs/screenshots/loading/`
1. `01-boot-gate.png` — branded secure boot with indeterminate bar
2. `02-skeleton-kit-dark.png` — dashboard/table/pie/heatmap/progress/profile (Cyber Midnight)
3. `03-skeleton-kit-light.png` — same kit in Apple Glass Light
4. `04-mobile-dashboard.png` — 390 px dashboard placeholder
5. `05-ai-thinking.png` — AI thinking status + skeleton + indeterminate bar
6. `06-navigation-progress.png` — global top progress line
7. `07-offline-banner.png` — offline banner over live content

---

## 11. Known limitations

* **Synchronous widgets deliberately have no per-widget skeleton.** CGPA,
  attendance, exams, planners, XP, heatmaps and similar sections render from
  local storage in one tick; adding fake waits would be dishonest and slower.
  Their loading coverage is the deferred-mount placeholder and the shared
  indicator.
* **Numeric progress is sparse and honest.** `AriseLoading.cloudStatus()` maps
  the sync engine's real statuses onto the shared indicator (saving/retrying →
  indeterminate, attachment upload → `progress.set(pct/100)` because the engine
  reports a true fraction, saved → done, failed/conflict → fail, offline →
  quiet end; a refcount guard prevents repeated events from leaking starts, and
  real values clear the synthetic creep timer). ZIP/JSON export and import still
  expose no fraction, so they stay indeterminate — no invented percentages.
* **Most widget files are minified single-line bundles.** Integration was done
  where source is readable (backup, AI insights, interview sheets, sheet
  coverage, widget nav) and generically through the mount queue, live regions
  and image handling. Per-widget bespoke retry states inside minified widgets
  (local files, certificates, notes export, expenses PDF) were not rewritten.
* **The full-page `createPageLoader()` element** is exercised in tests and used
  for the boot screen concept, but the application's own blocking screen remains
  `#cloud-gate` (now enhanced) rather than swapping the gate for a new overlay.
* **Verification is Chromium-only** with mocked Google/Firebase providers and
  mocked `/api/*` responses. No real provider, no Firefox/Safari, no screen
  reader session, and no low-end device measurement was performed.
* **Perf-lite is active in the sandboxed browser** (≤4 cores), so the shimmer
  screenshots are static by design; the full-motion path is asserted separately
  with `arise-perf-mode=full`.
* Knobs: `skeletonDelay` 160 ms, `minVisible` 380 ms, `announceThrottle` 700 ms
  were chosen from the existing 120 ms token and are configurable at runtime.

---

## 12. Running and verifying

```bash
npm ci
npm run dev                      # build + serve on :8123 (needs .env + five-account policy for real sign-in)
npm test                         # chunks + 69 test files + cloud suite
node tests/test-loading-system-v2.cjs
npm run build && npm start       # serve dist/ for the browser suites
npm run test:browser:ux
npm run test:browser
npm run test:browser:engineering
npm run test:browser:coverage    # per-route measured coverage -> docs/loading-coverage.md
node scripts/capture-loading-states.cjs
```

The mock-auth browser suites do not need Firebase credentials. Without a
configured `.env` the app intentionally stays on the locked sign-in screen.

---

## 13. Coverage report

Two kinds of evidence are kept separate on purpose: **implemented** (what the
code does, verified in jsdom) and **measured in a browser** (what actually
happened when the route was opened). The measured per-route tables are generated
by `node scripts/audit-loading-coverage.cjs --write` and live in
[`docs/loading-coverage.md`](loading-coverage.md) (raw data in
`loading-coverage.json`); regenerate them rather than editing.

### Area coverage

| Application Area | Loader Implemented | Measured in Chromium | Status |
| --- | --- | --- | --- |
| Dashboard | Yes — deferred mounts, stat/dashboard/chart shapes, global bar | Yes — boot skeleton, boot CLS, route visit, 0 leftover placeholders | Complete |
| DSA | Yes — mount shapes, table/list, sheet coverage error/retry, topic charts | Yes — route visit + cold-chunk placeholder (`Loading Interview Sheets…`) | Complete |
| Competitive Programming | Yes — dashboard shape, shared indeterminate bar via `setIndeterminateBar()` | Yes — route visit + cold-chunk placeholder, alternative-platform sync bar | Complete |
| Placement | Yes — dashboard/progress shapes via mount queue; shared indicators | Yes — route visit + cold-chunk placeholder | Complete |
| CGPA | Yes — mount placeholder + shared indicators (data is local/sync) | Yes — route visit, aria-busy cleared | Complete for async surfaces |
| Attendance | Yes — same | Yes — route visit + cold-chunk placeholder | Complete for async surfaces |
| Exams | Yes — mount + analytics shapes | Yes — route visit, no stuck state | Complete for async surfaces |
| Notes | Yes — notes/list shapes, image placeholders, preserved search | Yes — route visit + cold-chunk placeholder | Partial (minified widget has no bespoke retry) |
| Hackathons | Yes — cards/feed shapes | Yes — route visit, no stuck state | Complete for async surfaces |
| Analytics | Yes — analytics/line/area/heatmap shapes, AI states | Yes — route visit + shell route placeholder (`role=status`) | Complete |
| AI Features | Yes — AI skeleton, thinking status, indeterminate bar, announcements | Yes — 502 error + retry + thinking text (browser suite) | Complete (AI Real Insights); other AI widgets use shared/mount states |
| Remaining Widgets | Yes — mount shape map + shared layer | Yes — all 20 top-level routes audited at 1440 and 390 px | Partial (per-widget bespoke retry, see limitations) |

### What the audit measures, per route

For each of the 20 top-level routes at 1440 px and 390 px it records: whether a
placeholder or the global progress line appeared, settle time, leftover
placeholders, leftover `aria-busy` hosts, document/main overflow, and layout
shift split into **loading-layer shift** (a shift whose moved node is placeholder,
progress or state geometry) versus the application's own route re-render.

Last measured run (real Chromium, mocked cloud transport):

* 20/20 routes × 2 viewports rendered content, with **0 leftover placeholders,
  0 `aria-busy` leaks, 0 overflow and 0 loading-layer layout shift**.
* 6/6 throttled routes rendered a placeholder while their chunk was in flight
  and removed it after mount — five through the v2 runtime
  (`role="progressbar"`, e.g. `Loading Attendance Tracker…`), one (Analytics)
  through the prebuilt React shell's own route placeholder
  (`role="status"` / "Loading section…"), which uses the same skeleton tokens.
* 0 page or console errors across the whole audit.
* Route-transition CLS is reported for transparency but not asserted: replacing
  one route's content with another (and the minified widgets re-rendering
  asynchronously afterwards) moves content by design on mobile. The loading
  layer's own contribution measured 0 on every route. Boot CLS is asserted
  separately at < 0.1.

### Found by the audit and fixed

The gate kept `aria-busy="true"` after a successful handshake: `gate('Workspace
ready', …, true)` set the busy state, then hid the gate without clearing it, so a
hidden `#cloud-gate` and `#cloud-message` stayed marked busy for the life of the
session. The success path now clears both, which is why the audit reports zero
busy hosts at rest.

---
