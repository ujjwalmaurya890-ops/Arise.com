# Loading experience audit and plan — 2026-10-29

## Audit checklist

- [x] Map the React shell (`assets/app-bundle.js`), protected cloud boot, theme CSS, and 111 vanilla scripts loaded in 12 ordered widget chunks (`index.html` and `scripts/tools/build-widget-chunks.cjs`).
- [x] Find existing loaders, animation tokens, mount stubs, retries, timeouts, and reduced-motion rules. The primary shared system is `styles/animation-upgrade.css` / `src/animation-upgrade.js`; `src/widget-shared-utils.js` supplies widget helpers.
- [x] Trace the principal data sources. Most dashboard, study, analytics, chart, table, form, navigation, and tracker widgets compute synchronously from the account's local storage. Cloud restore/sync, coding-platform profiles/contests, interview-sheet JSON, AI requests, and file/certificate operations have real async work. No skeleton should be added to synchronous filtering or calculation merely for decoration.
- [x] Check baseline: `npm test` passed (including 51 cloud tests); `npm run build` passed. The existing Chromium UX test failed its boot CLS threshold: 0.3805 versus < 0.1. An instrumented rerun traced the largest shift (0.3724) to the late career-intelligence section being inserted before the workspace header.
- [x] Identify async gaps: a hanging script does not settle the lazy loader; a force-retry can race the shared sheets request; valid empty sheet data is displayed as an error; some fetch timers stop before JSON is read; auth/bootstrap failure can leave the gate marked busy. The mount safety wrapper also clears a widget's own `aria-busy` after a synchronous mount that starts async work.
- [x] Identify existing working behavior to preserve: local-first calculations, sync queue and conflict resolution, cloud access gate, cached coding-platform and AI content during refresh, responsive navigation, tabs, forms, and reduced-motion handling.

## Implementation plan

1. Extend the existing shared theme-aware skeleton primitives with component-shaped layouts and a single soft shimmer per grouped placeholder. Keep existing class and helper contracts compatible; respect reduced motion.
2. Use those layouts for genuinely deferred widget mounts, with a bounded script load and retryable module failure instead of an indefinite placeholder. Avoid disrupting already-mounted widgets.
3. Make the shared interview-sheet request deduplicated, bounded through body parsing, and safe against stale completions. Distinguish empty, unavailable, retrying, and successful sheet/coverage data.
4. Improve bounded AI/auth request handling, keep usable cached content visible on refresh, and clean up detached requests. Do not invent progress.
5. Preserve coding-platform data while refreshing and surface failures and empty contest lists rather than silently hiding them.
6. Place the career-intelligence section without shifting the workspace header. Preserve its functionality.
7. Rebuild checked-in widget chunks and service-worker references; add targeted state/race/failure tests. Verify the real browser experience at multiple viewport sizes and motion/theme settings. Record actual results and limitations rather than treating the audit as proof of complete coverage.

## Implementation and verification

- Extended the existing system with responsive dashboard, chart, table, list, form, and generic widget layouts, theme-derived surfaces, one shimmer per grouped placeholder, and static shimmer under reduced motion. Existing primitives remain available.
- Deferred mounts now select an appropriate shape, announce busy state, handle unavailable optional hooks, and have bounded script loads plus fallback/retry. The mount safety wrapper no longer clears a widget-owned async busy state or lets an older rejected mount replace a newer one.
- Interview sheets and sheet coverage distinguish empty data from failure; shared requests coalesce retries, bound body parsing, and preserve a previous cache on failed refresh. AI requests have bounded body parsing and cancellation; detached Real AI Insights requests are cancelled. Competitive Programming keeps cached profiles/contests on refresh and displays errors or genuinely empty contest lists. Cloud bootstrap failures and consent decisions no longer leave a misleading busy spinner.
- Career Intelligence now mounts below the route content rather than ahead of the workspace header. This changes the panel's position but preserves its contents and interactions.

### Actual tests

- `npm test`: passed on the final rerun — 50 feature regression files and 51 cloud tests. An earlier run failed a timing-sensitive existing dock assertion; the test now waits for the actual docked condition and the full rerun passed.
- `npm run build`: passed; 111 scripts generated into 12 ordered chunks and the protected auth bundle built in `dist/`.
- `npm run test:browser:ux`: passed all existing checks plus skeleton geometry probes at 320, 390, 768, 1440 and 1920px in Cyber Midnight and Apple Glass Light; reduced-motion checks inspect both skeleton pseudo-elements. Twelve routes were visited with mocked authenticated cloud data. Initial boot CLS was 0.0051 in the final run, versus 0.3805 in the baseline run. These are individual local measurements, not a field-performance claim.
- `npm run test:browser`: passed with mocked secure cloud backend, real Chromium, mobile restore, storage, sync and logout checks. Live Google/Firebase providers were not tested.
- `npm run test:rules`: skipped; no Firestore emulator was running. This is not a passed authorization test.
- New `tests/test-loading-foundation.cjs` covers shared-request deduplication, stalled body timeout, stale completion, failed refresh cache, empty dataset, cancellation, mount races, retry, and shaped skeleton semantics in jsdom.

### Remaining limitations

- Complete website-wide widget/state coverage has not been established. In particular, local-file, weather, certificate, legacy AI, and other independently authored paths have not all been exercised under every failure/cancellation scenario. The script timeout and fallback have not been tested against a genuinely hanging browser network request.
- The UX run observed cumulative layout-shift entries of 0.2817 during route navigation; the largest (0.2766) involved the route content and Career Intelligence on Analytics. Boot CLS improved, but navigation layout stability is not verified as acceptable. The test reports this value but currently only enforces the boot threshold.
- Only two of the available themes were probed; geometry checks are not a formal contrast or screen-reader audit. The browser tests use mocked authentication and network data. No low-powered-device or field performance measurement was made.
- `__mountCSEPlacementCritical` and `__mountSemesterMastery` are referenced by the bundled shell but no corresponding implementations were found in the checked-in source; their deferred slots show an unavailable state rather than indefinitely claiming to load.

### Changed files

- `index.html`: lazy mount shapes, accessible states, timeout, ordered fallback and retry.
- `styles/animation-upgrade.css`, `src/animation-upgrade.js`: shared tokens and component-shaped skeleton system.
- `src/widget-shared-utils.js`, `src/mount-safety.js`: deduplicated, bounded sheets fetch and safe mount lifecycle.
- `src/interview-sheets-widget.js`, `src/dsa-sheet-coverage-widget.js`: loading, empty, error, retry and refresh behavior.
- `src/competitive-programming-widget.js`: request deadline, cached-refresh errors and empty contest lists.
- `src/ai-connect-shared.js`, `src/ai-real-insights-widget.js`: AI deadline/cancellation and shared loading presentation.
- `src/cloud/auth-controller.js`, `src/cloud/auth-entry.js`, `src/cloud/protected-runtime.js`: accurate bootstrap, consent, and failure state.
- `src/career-intelligence-dashboard.js`: prevent the late panel from displacing the header on boot.
- `assets/chunks/` and `service-worker.js`: regenerated hashed chunks and cache version/reference updates.
- `tests/test-loading-foundation.cjs`, `tests/test-saas-upgrade.cjs`, `scripts/verify-loading-browser-e2e.cjs`: targeted regressions and browser checks.
- `docs/LOADING-AUDIT-2026-10-29.md`: this audit, plan, evidence, and limitations.

No dependency was added. Run `npm ci`, configure `.env` and the five-account Firebase policy as described in `docs/SECURE-SYNC.md`, then run `npm run dev`. Without configuration the secure sign-in gate intentionally remains locked. To reproduce the mocked browser checks, start the built server (`npm run build && npm start`) and run `npm run test:browser:ux` in another terminal.
