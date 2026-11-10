# Contribution report

Seventeen commits on `arena/e3201572-arise-com`, one per workstream, in the order
[REPOSITORY-AUDIT.md](../REPOSITORY-AUDIT.md) prescribed. Every commit has its own
regression file, and every one was verified with the full gate list before the
next began. This report states what was actually measured rather than what was
intended: where something could not be verified in this environment, it says so.

Gate list used for each contribution:

```bash
node tests/test-<feature>.cjs     # the new regression, run first
npm run build                     # hashed chunks + stamped service worker
npm test                          # all feature suites + cloud/auth/sync TAP suite
npm run audit:storage             # storage hygiene
npm run test:browser:ux           # loading/UX in Chromium
npm run test:browser:engineering  # 20 routes x 8 widths, modals, offline shell
```

## Baseline

| Measure | Value |
| --- | --- |
| Tracked files at audit | 344 |
| Ordered lazy scripts | 113 (12 hashed chunks) |
| Feature regression files | 72 (`tests/test-*.cjs`) |
| Routes exercised by the browser suite | 20 |
| `npm audit` | 6 moderate transitive findings; `--audit-level=high` passes |

## The commits

| # | Contribution | Commit | New regression |
| --- | --- | --- | --- |
| 0 | Pre-change audit | `284f644` | — |
| 0 | Interface without images | `4c8e402` | image-removal report |
| 1 | Command palette | `d3b489a` | `test-command-palette-v2.cjs` |
| 2 | Global search | `abe1b80` | `test-global-search-v2.cjs` |
| 3 | Dashboard personalization | `933bfc1` | `test-dashboard-personalization.cjs` |
| 4 | Notification center | `3698ce4` | `test-notification-center.cjs` |
| 5 | Notes and knowledge | `987c461` | `test-knowledge-assistant.cjs` |
| 6 | Analytics | `4bad8fe` | `test-analytics-integrity.cjs` |
| 7 | Daily planner | `fe4f7a0` | `test-day-plan.cjs` |
| 8 | Focus session audit | `bd9d37a` | `test-focus-session-audit.cjs` (54) |
| 9 | Study horizon | `0a495b8` | `test-study-horizon.cjs` (58) |
| 10 | Progress overview | `fc15a45` | `test-progress-overview.cjs` (47) |
| 11 | Accessibility | `3527ca3` | `test-a11y-audit.cjs` (38) |
| 12 | Performance | `c8e7410` | `test-perf-watch.cjs` (32) |
| 13 | PWA | `46c1e25` | `test-pwa-status.cjs` (40) |
| 14 | Backup and data protection | `ea9fba1` | `test-backup-integrity.cjs` (63) |
| 15 | Reliability | `c757d76` | `test-reliability-watch.cjs` (54) |
| 16 | Developer experience | this commit | — (documentation; the removed scratch probe `tests/tmp-probe.cjs` was an ad-hoc script, not a test) |

## What each contribution changed, and why

### 0. Interface without images (`4c8e402`)

15 tracked images existed; 20 production image-rendering paths were found. All
interface images were replaced with text, initials, CSS or inline SVG. The PWA
identity set (SVG + 32/192/512 PNG/WebP) stays because installability, the
manifest and the service worker need it; CSP is `img-src 'self'`. Inventory and
reasoning: [IMAGE-REMOVAL-REPORT.md](../IMAGE-REMOVAL-REPORT.md).

### 1–2. Command palette and global search

The palette already existed, so it was upgraded rather than duplicated: recent
commands with Enter-to-commit, match highlighting, and a real listbox with
`aria-activedescendant`. Search gained providers for attendance, CGPA, placement,
certificates, hackathons, skills, competitive programming, syllabus, exams,
expenses and folders — the categories that had no index at all.

### 3. Dashboard personalization

Card order, visibility and pins persisted per account, applied by moving only the
nodes that are out of place (this matters again in contribution 12), with a reset
that restores the authored order.

### 4. Notification center

One inbox built strictly from existing exam, hackathon, placement, task and
revision records with explicit read state. It invents nothing, claims no push
delivery, and a dismissed item that becomes due again returns as a new id.

### 5. Notes and knowledge

Backlinks, unresolved `[[wiki links]]`, duplicate notes and weak topics across
notes and the personal wiki, preserving the existing schema, export and search
behaviour instead of adding a second notes app.

### 6. Analytics

The original bucketing used UTC day keys, so an evening session landed on the
wrong local day, and the "previous period" was a fixed length. Sessions are now
bucketed by local calendar day and compared with an equal-length preceding
window; empty ranges render as empty rather than zero-filled.

### 7. Daily planner

A Today card that composes the existing task, DSA and study records for the day
instead of creating a second task manager.

### 8. Focus session audit (`bd9d37a`)

Three writers record study time: `focusSessionsV2` (the focus timer),
`studySessions` (the React timer, which also advances the streak with a UTC day
loop) and `stopwatchSessions` (written, read by nobody). The dashboard reads one,
Analytics reads another, so the same run can be counted twice or not at all.

`window.AriseFocusAudit.reconcile()` reports every source, collapses duplicate
writes (same local day, minutes within 0.5, timestamps within 10 minutes), names
the days where the two sources disagree, checks the streak counter against the
session log, and can import unreferenced stopwatch runs once each. Verified live:
status "2 sessions · 80m recorded · 1 duplicate write collapsed · 1 stopwatch run
unrecorded", 7 day bars, the disagreement line, and one imported record.

### 9. Study horizon (`0a495b8`)

Fourteen days of attributable load. Exams come from the Exam Tracker and honour
the CSE Syllabus date override; every planned minute names its driver (exam, prep,
revision, DSA); capacity is the median of the last week's active study days with a
documented 90-minute fallback; each day is classified free/light/full/overloaded.
Exam prep stops once the exam has happened. Verified live on the Exam Tracker
route: "2 of the next 14 days ask for more than you can realistically study",
two overloaded days, no horizontal overflow at 390px.

### 10. Progress overview (`fc15a45`)

One read-only row per area, computed from real stores: attendance from totals (not
per-subject rounded percentages), CGPA credit-weighted and ignoring ungraded
subjects, skills only from numeric progress, projects only when completed/shipped.
Sample rows that some widgets render before the user adds data are explicitly not
counted, and the average excludes empty areas instead of scoring them zero.

### 11. Accessibility (`3527ca3`)

The shell already had a skip link, labelled landmarks, live regions, Escape
handling and reduced-motion styles — but the skip target `#arise-main` was not
focusable, so the link scrolled without moving focus, and route changes were
silent. Both are fixed, and `window.AriseA11y.audit()` reports the landmark, skip
link, live region and control-naming state, counting wrapper/`label[for]`
associations as naming so forms are not reported as unlabelled.

### 12. Performance (`c8e7410`)

Measured on the built dashboard, idle for 4 seconds: 3,985 `querySelector(All)`
calls, ~750 DOM mutations, 5 long tasks (max 84 ms) and 26 mutation-bus
notifications, 16 of which were full `innerHTML` re-renders of the DSA
problem-insights widget.

Two causes: the layout re-appended every card on every pass (`appendChild` moves a
node even when it is already the right child), and the mutation bus notified
subscribers about records produced by the subscribers themselves. After: 1,187
`querySelector` calls, 0 long tasks, ~33 bus records per 4 s. `window.ArisePerf`
keeps the counters so the claim stays checkable.

### 13. PWA (`46c1e25`)

The worker calls `skipWaiting()`/`clients.claim()`, so a new build takes control
while the open tab keeps running the old files, and nothing said so. The status
notice reports the installed shell version (from the cache name, including the
build digest), a ready update, a background update, and offline state with and
without a populated cache. The first `clients.claim()` is deliberately not
reported as an update, because reloading there would discard an active session.
Verified in Chromium with the real worker.

### 14. Backup and data protection (`ea9fba1`)

Restore asked one question — "does this backup belong to you?" — without reading
the file. The inspector now blocks files that cannot be restored (no stores,
oversized, or a header declaring more stores than the file carries, which is the
truncated-download case) and explains the legitimate-but-destructive ones (stores
that are empty in the file, attachment records without bytes, unknown stores,
legacy files without owner metadata). The existing ownership confirmation and the
before-restore recovery copy are untouched.

### 15. Reliability (`c757d76`)

A chunk that failed once stayed missing for the rest of the session. The watch
retries up to three times (2s, 8s, 20s) while online and visible, retries a
deterministic 404 or syntax failure only once and then says plainly that reloading
will not help, distinguishes network/timeout/missing/broken reasons, and remembers
attempts in `arise-widget-retry-v1` so the explanation survives the reload.
`index.html` gained the documented `window.__ariseLoadModule(src)` hook, which
re-injects one script with the ordered-execution guarantee and the source-file
fallback. Verified in Chromium by failing a source file and its chunk.

### 16. Developer experience (this commit)

`ARCHITECTURE.md` (runtime shape, boot order, storage ownership, reaction model,
failure surfaces, styling, testing map, build/deploy), `CONTRIBUTING.md` (the
change loop, definition of done, the style rules review actually enforces) and
`CHANGELOG.md`, plus a navigation section in `README.md` and this report.

## Final verification

Run after contribution 16 on this branch:

| Gate | Result |
| --- | --- |
| `npm run build` | PASS — 12 hashed chunks, offline shell stamped |
| `npm test` | exit 0 — every feature regression plus the cloud suite |
| `npm run audit:storage` | PASS — 184 keys / 163 script inputs, no unknown keys |
| `npm run test:browser:ux` | PASS — 11 checks |
| `npm run test:browser:engineering` | PASS — 6 checks, no uncaught page errors |

## Honest limitations

- **Firestore rules and real provider credentials** are not exercised here:
  `npm run test:rules` needs a local emulator and skips without one. Cloud
  behaviour is verified through the in-repo fixture harness, not a live project.
- **The React shell is a compiled bundle** (`assets/app-bundle.js`). Changes that
  belonged inside it were avoided; module behaviour was added around it instead.
  Contribution 8 documents the timer's limitations rather than patching the minified
  bundle.
- **Idle DOM mutations** remain (animated cards re-render themselves); they are
  now filtered out of the mutation bus instead of being driven to zero, because
  the animation is intentional.
- **Performance numbers** are lab measurements from this sandbox, not field data.
- Two lists in the codebase are conventional rather than derived: `SCRIPTS` in
  `index.html` and the offline shell list. Both are validated by
  `npm run audit:storage`/the build, but adding a module still means editing two
  files.
