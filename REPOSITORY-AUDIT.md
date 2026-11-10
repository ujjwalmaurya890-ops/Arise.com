# Arise repository audit — baseline before implementation

**Audit date:** 2026-11-10 (UTC)  
**Repository:** `ujjwalmaurya890-ops/Arise.com`  
**Branch:** `arena/e3201572-arise-com` (active)  
**Starting commit:** `5b57def2d88f2c4d87e59f1f003eb896f61010fe`  
**Audit status:** Complete. No application source or configuration was changed during this audit. This report is intended to ship with the separately reviewed image-removal work.

> The prompt described an `arise_final/` directory. This checkout has the project directly at the repository root; no `arise_final/` directory exists.

## 1. Executive summary

Arise is an existing, local-first CSE/developer productivity dashboard, not a blank starter. The project already has a substantial feature set and production-oriented architecture: an authenticated React shell, ordered lazy vanilla-JavaScript widgets, 41 themes, browser persistence with UID-scoped cloud synchronization, IndexedDB attachment storage, backup/restore, a static PWA shell, and a large regression suite. Several requested workstreams already have implementations. The correct approach is to extend them rather than add parallel task managers, analytics pages, notes applications, or navigation systems.

The most relevant image-removal findings are:

- **15 tracked image files** are present: 8 under `assets/` and 7 historical loading screenshots under `docs/screenshots/loading/`.
- **20 production image-rendering paths** were found in first-party runtime code: 12 literal `<img>` templates, 6 React `<img>` elements in the checked-in application bundle, and 2 dynamically created preview images. The generated lazy chunks repeat source code and are not counted as independent implementations.
- The runtime image paths include visible Arise logos, the authenticated profile photo, an illustrative CSE syllabus screenshot, CP/profile and platform marks, company logos, social favicons, Markdown images, certificate images, and locally attached image previews.
- No CSS image/background URL was found. The only CSS/HTML `url(...)` resources found are the two self-hosted WOFF2 fonts. CSS gradients, inline SVG icons, and data charts are not bitmap/background-image dependencies.
- Browser instrumentation on all 20 dashboard routes observed three unique image request URLs in the baseline fixture: the local Arise logo, the test-auth profile photo (`https://example.test/avatar.png`), and the CSE syllabus reference PNG. The intentionally non-resolving test avatar produced one resource-load console error and then fell back to the local logo. No uncaught page errors were observed.
- PWA identity assets must be retained: the SVG favicon, 32px PNG favicon, and 192/512 PNG+WebP manifest icons. The loading screenshots are documentation evidence, not application UI and are not copied into `dist/`.

## 2. Repository and Git baseline

- 344 tracked files at audit start; working tree was clean on the session branch.
- Git history in this checkout is shallow/grafted and exposes the starting merge commit only. No local user modifications were present to overwrite.
- 129 JavaScript files are under `src/`; 113 ordered classic scripts are listed by the protected lazy-widget loader; the build generates 12 content-hashed chunks.
- 20 top-level application routes are exercised by the existing Chromium engineering test.
- 30 distinct `window.__mount…` names were found across source modules. The 113 lazy scripts also include shared utilities, feature calculations, styles/patches, bus modules, and self-mounting widgets, so script count is not a widget count.
- 72 tracked `test-*` source files are run by the repository test shim; `npm test` also runs the cloud/auth/sync TAP suite.
- The package requires Node `>=22.22.0 <25`. The sandbox supplied Node 22.22.3 and npm 10.9.8.
- `npm ci` was required because dependencies were not initially installed. It installed 274 packages. `npm audit` reports **6 moderate transitive findings** (glob/minimatch-related dependency paths); `npm audit --audit-level=high` exits successfully. No dependency upgrade was made during the audit.

## 3. Architecture

### 3.1 Entrypoints and rendering

1. `index.html` is the actual document entrypoint. It defines metadata, the initial security/theme bootstrap, the secure cloud gate, the inert `#root` shell, deferred styles, protected script declarations, the ambient-sound controller, and the ordered lazy-widget loader.
2. `src/cloud/storage-schema.js` and `src/cloud/storage-bridge.js` are loaded before user-facing application code. The cloud-auth entry is bundled by `scripts/build.mjs` from `src/cloud/auth-entry.js` into `dist/assets/cloud-auth.js`.
3. `src/cloud/auth-controller.js` restores/verifies the approved Google account and coordinates the cloud state. `src/cloud/protected-runtime.js` runs protected application scripts only after the approved boot/restore path; the locked gate remains visible otherwise.
4. The main React 19 shell, navigation, state, charts and core dashboard are in the checked-in `assets/app-bundle.js` (about 648 KB source file). The separately lazy-loaded `assets/app-analytics.js` (about 414 KB) supplies Analytics. The original React source/build provenance is **not present or verified**; direct work on this compiled bundle is therefore a review and regression risk.
5. The main dashboard delegates numerous modules through `window.__mount*` / `__unmount*` contracts. These are mixed classic scripts, some self-mounting and some mounted by the React shell. Ordering is intentional: later scripts can decorate or replace globals from earlier scripts.
6. `index.html` defines 113 widget/feature source paths and their chunk mapping. `scripts/tools/build-widget-chunks.cjs` regenerates 12 ordered content-hashed chunks, updates `index.html`, and rebuilds the service worker's extended list. `npm test` and `npm run build` both invoke this generator. Edit source files and regenerate; do not hand-edit the generated chunks.

### 3.2 User-facing dashboard sections

The existing browser route inventory names these sections:

1. Dashboard
2. DSA Tracker
3. Development
4. Competitive Programming
5. CSE Syllabus
6. Placement Tracker
7. Hackathon Tracker
8. Certificates
9. Learning
10. Exam Tracker
11. Attendance & Skills
12. CGPA Tracker
13. Projects
14. Social Media
15. Expenses
16. Notes
17. Resources
18. Analytics
19. Achievements
20. Settings

The compiled app also contains nested panels/tabs for tasks, focus, learning paths, revisions, analytics, study planning, exams, syllabus, placement and career. The lazy source inventory below is the complete ordered script list from `index.html` at audit time; it includes both widget modules and their supporting infrastructure.

### 3.3 Ordered lazy module inventory (113)

```text
src/mutation-bus.js
src/storage-watch-bus.js
src/storage-keys.js
src/widget-shared-utils.js
src/widget-nav.js
src/mobile-nav-enhance.js
src/dev-task-timestamps-widget.js
src/theme-system.js
src/theme-quick-toggle.js
src/premium-productivity-features.js
src/saas-widget-enhancer.js
src/habit-heatmap-widget.js
src/burnout-detector-widget.js
src/xp-breakdown-widget.js
src/features/exam-tracker/exam-tracker-calculations.js
src/features/exam-tracker/exam-tracker-intelligence.js
src/features/exam-tracker/exam-tracker-storage.js
src/features/exam-tracker/exam-tracker-dday.js
src/features/exam-tracker/exam-tracker.js
src/features/exam-tracker/exam-tracker-analytics-widget.js
src/readiness-50lpa-widget.js
src/career-command-center-widget.js
src/readiness-path-planner-widget.js
src/battle-plan-widget.js
src/ai-smart-learning-path-widget.js
src/revision-system-widget.js
src/water-reminder-widget.js
src/focus-mode-widget.js
src/focus-timer-upgrade-widget.js
src/timer-visual-upgrade-widget.js
src/learning-session-analytics-widget.js
src/learning-mastery-correlation-widget.js
src/weekly-ai-report-widget.js
src/ai-career-mentor-widget.js
src/ai-connect-shared.js
src/ai-real-insights-widget.js
src/mount-safety.js
src/widget-reset.js
src/a11y-toast-patch.js
src/a11y-color-patch.js
src/a11y-label-patch.js
src/widget-failure-reporter.js
src/attendance-tracker-widget.js
src/competitive-programming-widget.js
src/social-media-widget.js
src/problem-log-explorer-widget.js
src/hackathon-tracker-widget.js
src/hackathon-expense-tracker-widget.js
src/hackathon-timeline-widget.js
src/hackathon-pipeline-widget.js
src/hackathon-team-directory-widget.js
src/hackathon-prize-wall-widget.js
src/hackathon-funnel-widget.js
src/dev-mastery-heatmap-widget.js
src/dev-weekly-sparkline-widget.js
src/dev-milestone-badges-widget.js
src/dev-pace-projection-widget.js
src/dev-difficulty-radar-widget.js
src/skills-timeline-widget.js
src/notes-app-widget.js
src/personal-wiki-widget.js
src/interview-sheets-widget.js
src/dsa-mastery-premium-widget.js
src/dev-mastery-premium-widget.js
src/dev-mastery-trend-widget.js
src/dev-topic-breakdown-widget.js
src/dev-streak-widget.js
src/dev-roadmap-coverage-widget.js
src/dev-solve-speed-widget.js
src/dsa-topic-breakdown-widget.js
src/dsa-pace-projection-widget.js
src/dsa-streak-widget.js
src/dsa-weekly-sparkline-widget.js
src/dsa-mastery-trend-widget.js
src/dsa-difficulty-radar-widget.js
src/dsa-sheet-coverage-widget.js
src/dsa-solve-speed-widget.js
src/dsa-milestone-badges-widget.js
src/dsa-revision-scheduler-widget.js
src/dsa-problem-insights-widget.js
src/dsa-tier3-readiness-widget.js
src/dsa-placement-engine-widget.js
src/dsa-daily-goal-widget.js
src/dsa-mock-oa-widget.js
src/dsa-pattern-playbook-widget.js
src/dsa-proof-pack-widget.js
src/dsa-mistake-journal-widget.js
src/dsa-study-planner-widget.js
src/aptitude-practice-widget.js
src/dev-placement-engine-widget.js
src/placement-command-center-widget.js
src/dev-task-insights-widget.js
src/dev-quality-trend-widget.js
src/dev-portfolio-flags-widget.js
src/dev-revision-scheduler-widget.js
src/backup-center-widget.js
src/features/placement-tracker/placement-calculations.js
src/features/placement-tracker/placement-storage.js
src/features/placement-tracker/placement-tracker.js
src/features/placement-tracker/placement-tracker-new-features.js
src/features/cse-placement-critical/cse-placement-critical-config.js
src/features/semester-risk/cse-full-syllabus-config.js
src/features/semester-risk/cse-syllabus-plus-widget.js
src/features/semester-risk/cse-syllabus-plus-v144-patch.js
src/features/semester-risk/cse-syllabus-tabs-v150-patch.js
src/features/semester-risk/cse-syllabus-unified-widget.js
src/local-files-widget.js
src/projects-widget.js
src/expenses.js
src/cgpa-tracker-widget.js
src/features/certificates/certificates-storage.js
src/features/certificates/certificates-widget.js
src/career-intelligence-dashboard.js
```

The 30 discovered mount APIs are: `__mountAttendanceTracker`, `__mountBackupCenter`, `__mountBattlePlan`, `__mountBurnoutDetector`, `__mountCGPATracker`, `__mountCareerCommandCenter`, `__mountCertificates`, `__mountCompetitiveProgramming`, `__mountDevMasteryHeatmap`, `__mountExamTracker`, `__mountExamTrackerDashboard`, `__mountExpenses`, `__mountFocusModeToggle`, `__mountFocusTimerUpgrade`, `__mountHabitHeatmap`, `__mountHackathonTracker`, `__mountInterviewSheets`, `__mountLearningAnalytics`, `__mountLearningCorrelation`, `__mountLearningHeatmap`, `__mountLocalFiles`, `__mountNotesApp`, `__mountPersonalWiki`, `__mountPlacementTracker`, `__mountProjectsWidget`, `__mountRevisionSystem`, `__mountSkillsTimeline`, `__mountSmartLearningPath`, `__mountSocialMedia`, and `__mountWaterReminder`.

Additional protected sources include `src/app-icons.js`, `src/animation-upgrade.js`, `src/loading-system.js`, readiness/placement/XP engines, and cloud modules. Supporting feature files under `src/features/` cover exam tracking, placement tracking, semester/syllabus risk and certificates.

### 3.4 Styles and theme system

The global style stack is `styles/theme.css`, compiled `assets/app-styles.css`, `styles/saas-upgrade.css`, `assets/responsive-patch.css`, `styles/cloud-auth.css`, `styles/animation-upgrade.css`, `styles/loading-system.css`, `styles/typography-upgrade.css`, `styles/design-system.css`, and feature styles under `styles/features/`. Several widget modules inject component-scoped CSS. The theme manager is `src/theme-system.js`; it stores theme/mode/accent/schedule preferences in existing localStorage keys and supports 41 built-in themes plus user themes. `styles/design-system.css` aliases active-theme colors into semantic component tokens. Existing typography roles and local Inter/JetBrains Mono font files are in place.

The source-level design-system test covers 41 themes and 656 text/status contrast pairs. This is a meaningful baseline, not proof of a complete WCAG 2.2 AA audit of every interactive state or screen-reader flow. Preserve all theme names, preference keys and active-theme variable contracts.

### 3.5 Storage, backup and communication

- Widgets primarily own their localStorage keys and serialize their own JSON. `src/storage-keys.js` documents/audits keys; `src/cloud/storage-schema.js` separately allowlists cloud/backup stores and two IndexedDB attachment databases.
- `src/cloud/storage-bridge.js` wraps localStorage and IndexedDB writes with UID-scoped physical keys and mutation journals. `src/cloud/sync-engine.js` handles ordered sync, retries, conflict detection, recovery, and snapshots; `src/cloud/backup-codec.js` produces/reads JSON and ZIP backups; `src/cloud/auth-controller.js` validates imports and ownership.
- `src/mutation-bus.js` broadcasts DOM mutations to widget subscribers; `src/storage-watch-bus.js` notifies owners of store changes. Widgets also use explicit `CustomEvent`s and shared `window` APIs.
- Native browser notifications/reminders are implemented within some feature widgets, but the repository audit found no single, shared notification inbox with cross-feature read/unread state.
- Avoid changing unrelated store formats or keys. New derived views should read existing sources and not duplicate user data.

### 3.6 PWA, network and build

`manifest.webmanifest` contains multiple Arise icon sizes/formats. `service-worker.js` has a core shell and generated extended asset list, content-versioned cache names, atomic core caching, bounded network-first navigation/mutable-code behavior, cache-first immutable chunks, and explicit API/auth/range bypasses. `scripts/build.mjs` creates a safe `dist/` site, builds the auth bundle, verifies private server files are absent, and computes a deterministic cache revision. `scripts/serve.mjs` binds `0.0.0.0`, handles static routes and same-origin API functions, compression, ETags and ranges. Netlify publishes `dist/`; the repository root must not be published.

The existing worker does not itself expose a complete, user-facing update-available/update-now prompt. Any PWA work must preserve account-gate behavior, current cache invalidation, attachment/offline semantics, and PWA install icons.

## 4. Image inventory (baseline)

### 4.1 Tracked files

| Tracked asset | Baseline role | Audit disposition |
|---|---|---|
| `assets/arise-logo.svg` | Arise browser-tab favicon; also used as visible brand/logo artwork by several UI modules and fallback paths | Retain as technical favicon only; replace in-page logo uses with text branding. |
| `assets/arise-logo-32.png` | 32px PNG favicon; also referenced by a visible attendance fallback | Retain only for favicon/PWA compatibility; remove the widget fallback reference. |
| `assets/arise-logo-192.png` | 192px PNG manifest icon, including maskable entry | Retain as PWA identity. |
| `assets/arise-logo-192.webp` | 192px WebP manifest icon | Retain as PWA identity. |
| `assets/arise-logo-512.png` | 512px PNG manifest icon, including maskable entry | Retain as PWA identity. |
| `assets/arise-logo-512.webp` | 512px WebP manifest icon | Retain as PWA identity. |
| `assets/cse-syllabus-mastery-reference.png` | Displayed illustrative screenshot in the unified CSE syllabus header; linked to full-size image | Remove from application UI and delete after the source/chunk/cache references are removed. |
| `assets/cse-syllabus-mastery-banner.png` | 1,002,716-byte PNG; no production code or manifest reference found | Confirmed unused; delete as part of image cleanup. |
| `docs/screenshots/loading/01-boot-gate.png` through `07-offline-banner.png` | Seven historical screenshots used only as documentation evidence | Retain outside the app. The build does not publish `docs/`. |

The 15 tracked image assets above are the complete tracked inventory found by extension. Two additional browser screenshots appeared under ignored `.test-artifacts/` after running QA; they are generated test output, not tracked application assets. The PNG/WebP icon variants are intentional technical format coverage, not evidence of a duplicate displayed image.

### 4.2 Runtime render paths discovered

Counted source-of-truth production paths (not generated chunk copies):

| Location | Paths | Use / risk |
|---|---:|---|
| `index.html` | 4 | Cloud-gate Arise logo; cloud profile avatar slot; landing-brand logo; fallback dashboard-brand logo. |
| `assets/app-bundle.js` | 6 | React loading/landing/sidebar/widget branding plus an account/profile avatar. The source React project is not present. |
| `src/loading-system.js` | 1 | Arise logo in the page-loading state; module also contains image-specific lazy/skeleton enhancement helpers. |
| `src/attendance-tracker-widget.js` | 1 | Arise logo inside the gamification card. |
| `src/competitive-programming-widget.js` | 2 | Coding-account avatar and data-supplied platform icon. |
| `src/social-media-widget.js` | 1 | Profile/favicons for social providers. |
| `src/features/placement-tracker/placement-tracker.js` | 1 | User-supplied company `logoUrl`; can fetch a remote image. |
| `src/features/semester-risk/cse-syllabus-unified-widget.js` | 1 | CSE reference screenshot. |
| `src/notes-app-widget.js` | 1 | Markdown `![](...)` renders remote/local image URLs. |
| `src/local-files-widget.js` | 1 | Dynamically creates an image preview for uploaded image files; image opening may also navigate to a blob image. |
| `src/features/certificates/certificates-widget.js` | 1 | Dynamically creates a preview for uploaded certificate image files. |
| **Total** | **20** | Source paths include static tags, React elements, templates and dynamically created previews. |

External/dynamic image sources include Google `photoURL`, competitive-programming avatar/icon data, social favicon URLs, user-entered placement `logoUrl`s, Markdown image links and user-uploaded attachments. A static textual scan cannot enumerate arbitrary image URLs stored in user data; runtime verification must therefore check request types and DOM elements with seeded representative data.

No production `new Image()` call or CSS `background-image` / image `url()` was found. The two `url(...)` references in CSS and one font URL in the HTML bootstrap are WOFF2 fonts; SVG `url(#gradient-id)` references are inline chart/ring gradients, not external images. Inline SVG icons and data visualizations are functional UI iconography; retain them unless an item is an actual illustration rather than an icon/chart. The only standalone SVG file is the Arise logo used by favicon/PWA and currently by UI branding.

The CSP currently allows `img-src 'self' data: blob:` to support visible avatars and uploaded previews. The production baseline scan must revisit this allowance after all runtime image renderers are removed. File upload/attachment bytes and certificate/project metadata are user data; removal of display previews must not delete or rewrite those records. Existing automated tests also contain deliberate hostile `<img>` payload fixtures and browser image probes; these are test inputs, not production rendering requirements.

## 5. Existing feature overlap and implementation direction

The following capabilities already exist and should be extended rather than duplicated:

- **Command palette / navigation commands:** `src/premium-productivity-features.js` already builds an `upp-command-overlay`, has `Ctrl/Meta+K` shortcuts, a search field, arrow/Enter/Escape handling, section navigation, and workspace commands. The theme studio also has its own `Ctrl/Meta+Shift+K` shortcut. The palette does not show a recent-command history in the inspected implementation. Contribution 01 should upgrade this single palette, not add another keyboard system.
- **Search:** command-palette search spans workspace modules, notes, DSA and tasks; individual Notes, Wiki, Interview Sheets, DSA, syllabus and widget-filter controls also search local content. Contribution 02 should add missing categories to the same index/interface, not replace those input experiences.
- **Personalization:** navigation collapse, group state, density/theme/accent settings, and widget-level filters exist. The audit did not find a unified persisted dashboard-card reorder/show/hide/pin layout preference. Build that against supported dashboard widgets only, without reordering mount scripts or moving source data.
- **Notifications:** deadline/reminder logic exists in feature widgets and some modules may request native notification permission. No central inbox/read-state model was found; a new center must derive only real source data and avoid push claims.
- **Notes/knowledge:** `src/notes-app-widget.js` and `src/personal-wiki-widget.js` already provide Markdown, autosave, search, folders/tags, pin/trash/archive patterns, linking and export functionality. Add focused missing controls (e.g. visible word count/last-edited/export regression gaps) only after inspecting actual current paths and preserve `arise-notes-app-v1` data.
- **Analytics/progress/planning:** the React Analytics route, `assets/app-analytics.js`, learning-session analytics, weekly report, DSA study planner, exam planner, syllabus progression, readiness dashboards, placement tracker and Career Intelligence are established. Improve shared calculations/filters from existing user data rather than create fake counters or parallel records.
- **Focus:** the React dashboard and focus/focus-timer modules already provide timers and focus UI. Guard timer lifecycle/remount and page visibility before adding further session machinery.
- **Accessibility/performance:** focus trap, reduced-motion, labels/toasts/color patches, visible focus styles, lazy 12-chunk loading, Analytics retry, mutation/storage buses, design tokens and browser responsiveness checks already exist. The remaining work should target uncovered interactions and measure any performance change.
- **PWA, backup and reliability:** versioned offline shell, safe sync/backup/import, widget mount isolation, and a user-facing failure reporter already exist. Extend tested gaps, do not rewrite those systems.
- **Developer experience:** `README.md`, 27 files under `docs/`, `CONTRIBUTING` guidance inside README, test scripts and `.github/workflows/secure-sync.yml` already exist. Improve clarity and add the missing standalone architecture/contribution/changelog/report documents without removing useful existing docs.

## 6. Baseline verification results

Commands were executed before application changes:

| Check | Result |
|---|---|
| `npm ci` | **PASS** — dependencies installed; npm reports 6 moderate transitive advisories. |
| `npm test` | **PASS** — exit code 0; all feature regression scripts and all 70 cloud/auth/sync TAP subtests passed. The harness writes an expected simulated mount exception to stderr and jsdom reports a non-fatal navigation-not-implemented diagnostic. |
| `npm run build` | **PASS** — 113 source scripts → 12 chunks, service-worker extended list 131 entries, safe `dist/`, Firebase Auth bundle about 166 KiB, content revision `4a442687b7b0c8c0`. |
| `npm run test:browser:engineering` | **PASS** — Chromium 153.0.8010.0; locked-gate protections, 12 chunk requests, 20 routes × 8 viewport widths (320–1920px), theme controls, keyboard tabs, short/landscape modal geometry, attachment safety, Analytics retry and actual PWA offline behavior. 160 responsive route samples plus 3 short viewports; no uncaught page errors. Measured delayed Analytics session-window CLS was approximately 0.00010 (lab-only). |
| `npm run test:rules` | **SKIPPED** — no Firestore emulator is running. This is not a rules authorization pass. |
| `npm audit --audit-level=high` | **PASS at the requested threshold** — the full audit still reports 6 moderate transitive findings. |
| Additional 20-route image probe | **PASS as an inventory run** — captured visible image candidates and image resource requests in each route. It found the three URLs recorded above and one failed test-fixture avatar request; no page errors. |

Browser verification uses the repository's test-only authenticated transport and fake account fixture. It does not test a live Firebase project, real approved account, provider deployment, Safari, Firefox, or Edge. No production credentials or real user data were accessed. The test server was built from the unchanged baseline and bound to `0.0.0.0:8123`.

## 7. Existing technical problems and regression risks

### Confirmed baseline constraints

1. **Compiled React bundle has no checked-in source project.** Main shell edits need strict, narrow bundle diffs and behavior tests; avoid pretending the bundle is generated from an unavailable source tree.
2. **Image removal spans both code and user data rendering.** Remote avatar/favicon/company logo and Markdown renderers must stop issuing requests, but persisted URLs, attachment bytes, filenames, certificate records, and backups should remain compatible.
3. **The loader is order-sensitive and generated.** `index.html`, `assets/chunks/*`, and the SW extended URL list must be regenerated and checked together after source-module edits.
4. **Many stores are cloud/backup allowlisted.** Avoid adding new user data keys without updating/auditing the correct schema; do not reformat or migrate unrelated widget JSON.
5. **Mobile coverage is currently Chromium-only.** Existing responsive tests are strong for the listed widths but not a Safari/Firefox verification.
6. **The complete WCAG 2.2 AA / screen-reader audit remains open.** Existing automated contrast and naming tests are valuable but do not verify every ARIA role/state or all modal/menu keyboard paths.
7. **No emulator/live provider is configured.** Firestore rules and external auth/provider integrations cannot be called production-verified here.
8. **Dependency audit has moderate advisories.** The CI gate is `--audit-level=high`, so it does not fail for the six moderate transitive advisories.
9. **Image-specific loading helpers and CSP allowances exist.** These must be audited alongside visible tags so removal does not leave image placeholders, hidden loading behavior, or permissive request paths.
10. **One baseline console resource error is fixture-driven.** The browser test profile photo points at an intentionally non-resolving example host; image-free work should remove this network path entirely.

### Sequence and risk controls

- Finish the audit first (this report), then remove the image UI in its own commit and verify the image-free interface before starting Contribution 01.
- Keep the implementation on `arena/e3201572-arise-com`; preserve the existing history and never push without separate authorization.
- Deliver one image-removal commit plus exactly one meaningful, tested commit for each of the 16 numbered contribution workstreams. Do not produce placeholder commits for capabilities already complete; improve and test their actual gaps.
- For each contribution, inspect current owner/storage/contracts, modify a narrow set of files, add a targeted regression test, run relevant tests/build, review the diff, then commit and record the hash before moving on.
- Run the full suite and full production build again after the 16 contributions. Report any uncompleted browser/provider/emulator coverage honestly.

## 8. Proposed implementation sequence

1. **Image removal (separate prerequisite commit):** replace visible branding with text, remove all production `<img>` render paths and image previews, preserve downloads/attachments/manifest icons, remove the unused CSE banner and the CSE reference image, update the image-related loading path and CSP, regenerate chunks/cache list, and add automated no-image/no-image-request checks. Create `IMAGE-REMOVAL-REPORT.md` and update the stale CSE image-verification note.
2. **Contribution 01 — command palette:** enhance the existing palette (recents, search highlighting, keyboard and mobile behavior); do not create a second palette.
3. **Contribution 02 — global search:** add missing local data providers/categories to the palette's shared search index with privacy-safe, debounced results.
4. **Contribution 03 — dashboard personalization:** persist supported card order, visibility and favorites; provide reset; do not reorder the script loader.
5. **Contribution 04 — notifications:** add a centralized inbox using real exam/task/revision/goal records and explicit read state; no unsupported push claims.
6. **Contribution 05 — notes/knowledge:** improve missing note workflows while preserving the current notes/wiki schema and exports.
7. **Contribution 06 — analytics:** extend existing analytics with real-data ranges/empty states and date-correct calculations.
8. **Contribution 07 — daily planner:** improve the existing daily task system instead of creating a second task manager.
9. **Contribution 08 — focus mode:** verify timer ownership, pause/resume, visibility behavior and history in the existing focus widgets.
10. **Contribution 09 — study planner:** improve current syllabus/DSA/exam planning using explainable source data.
11. **Contribution 10 — progress overview:** unify read-only metrics from existing attendance, CGPA, skills, DSA, project, certification and learning stores.
12. **Contribution 11 — accessibility:** audit semantic structure, modal focus, keyboard states, reduced motion and theme contrast; add targeted regressions.
13. **Contribution 12 — performance:** measure, then fix proven repeated DOM work/listeners/mount cleanup or asset delivery issues.
14. **Contribution 13 — PWA:** add user-visible update/offline status and test cache lifecycle while preserving install/auth/privacy guarantees.
15. **Contribution 14 — backup/data protection:** strengthen backup validation/restore confirmations and compatibility tests without replacing the existing secure backup system.
16. **Contribution 15 — reliability:** extend centralized error surfaces/retry/storage failure handling and safe remount behavior without swallowing exceptions.
17. **Contribution 16 — developer experience:** add/update README, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, the contribution report and final QA report; keep CI and existing docs intact.

---

## Appendix A — Baseline image counts/method

The counts above are from a tracked-asset extension scan, source-of-truth regex scan of HTML/JS/CSS/manifest/config (with tests/docs/generated chunks separated), review of HTML/JS image creation/render paths, CSS `url(...)` inspection, service-worker/manifest reference review, and the authenticated Chromium route/network probe. Generated widget chunks are outputs of the 113-source loader and intentionally excluded from source-path totals. Documentation screenshots and test fixtures are not app UI. A post-removal AST/source scan, DOM scan over all routes, computed-background scan, and intercepted network-request assertion will be required before claiming zero displayed images.
