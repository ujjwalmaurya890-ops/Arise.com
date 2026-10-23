# Pre-implementation audit — 2026-10-23

Inspected the tracked tree, package/lock files, HTML entry, bundled React state, all widget sources, styles/themes, service worker, Netlify functions/redirects, build tooling and 44 test suites before implementation.

## Actual architecture

- Static HTML + prebuilt React 19.2.6 dashboard (`assets/app-bundle.js`); original React/Vite source/build project is **not** present. Vanilla JS widgets are maintained in `src/`, assembled verbatim into 12 hashed chunks (108 scripts) by `scripts/tools/build-widget-chunks.cjs`. CSS uses existing theme variables and light/dark themes. Navigation is client state rather than server routes; Netlify has an SPA fallback.
- Hosting: `netlify.toml`, `_redirects`, publish `.`. Node functions proxy coding platforms, AI, and snapshots. No Supabase, Firebase, OAuth implementation, functioning authenticated backend, or account database exists.
- React `userSession` is only a locally asserted "local user", not authentication. `showLanding`/`data-arise-auth` are presentation flags, not authorization.
- Existing `/api/sync`: Netlify Blobs full snapshots keyed by a 4–64-character shared code, public CORS, unauthenticated GET/POST/DELETE. Its read-then-write timestamp check is not atomic. Replace/disable this insecure path; do not import old remote blobs automatically.
- Backup Center exports JSON (optional ZIP with externally supplied JSZip), copies localStorage and enumerates IndexedDB, offers Gist/code pairing. It retains a plaintext Gist PAT in localStorage. Existing generic JSON export cannot faithfully encode Blob values, and restores skip missing object stores. Preserve local export/restore but replace insecure cloud controls and serialize attachments correctly.
- No application sessionStorage usage found. IndexedDB: `arise-local-files-db-v1` / `files` and `arise-certificates-files-db-v1` / `certFiles`, containing attachment metadata and Blob bodies. Firebase provider-managed authentication storage must never be included in backups.

## Persistence inventory / migration mapping

All rows below have local persistence, but **none** has verified per-user automatic cloud persistence. Cloud migration must retain the exact legacy key/string and nested arrays/maps rather than replacing feature schemas.

| Feature | Existing keys / structures |
|---|---|
| React core | `dsaQuestions`, `devTasks`, `projects`, `tasks`, `studySessions`, `achievements`, `notes`, `exams`, `streak`, `xp`, `appSettings`, `showLanding` |
| Tasks / study / timer | `arise-daily-learning-tasks-v1`, `studySessions`, `focusSessionsV2`, `stopwatchSessions`, learning-path progress and what-I-learned log |
| DSA / interview | insights, SRS, interviewSheetsProgress, mastery snapshots, mock OA active/history/settings, daily goal, toolkit/proof progress where stored |
| Development / placement | task insights/timestamps, activity and completion logs, revision SRS, mastery snapshots, portfolio stars, openings, pattern-transfer/defense/90-day plan/sprint/JD state, applications/offers/internships |
| Competitive programming | `arise-cp-tracker-v1`, platform history/settings; optional provider caches are reproducible and not authoritative history |
| Academics | attendance, CGPA, syllabus progress/revision/notes/customization/exam dates/difficulty/timestamps/undo/internal marks/topic progress/IA/PYQ/resources/tab state; unified syllabus readiness history/goals |
| Exams / revision | `arise_exam_tracker_v1`, `examLiveTimers-v1`, `revisionSystemProgress` (contains history), study-hour/daily plans within exam store |
| Expenses | entries, budgets, recurring templates, goals, custom categories, weekly/monthly budgets, reserves, investments, loans/debt plan/IOUs, semester/next inflow, scenarios, net-worth history, alerts/PDF/view preferences |
| Hackathons | tracker, expenses (v1 migration input and v2), pipeline/checklists/notifications, team directory, timeline/milestones |
| Notes / portfolio | notes app (folders/tags/bodies), personal wiki, skills timeline, projects, social handles, certificates/goals; binary attachments in the two known IndexedDB stores |
| Health / achievements | water settings/log/weather, streak check-ins/freezes/XP, XP daily log, achievements |
| AI / analytics | model preference only (current AI module has no browser API key), mentor snapshots/cache, readiness history, weekly reports/snapshots, resume checklist, mastery correlation preferences |
| Personalization | theme/mode/schedule/custom themes/accent, density, focus mode, sidebar/group state, widget navigation, ambient audio preferences |

The pre-existing `src/storage-keys.js` inventory is incomplete: for example it omits daily learning tasks, streak-engine keys, many expense/syllabus keys, and some preferences. A new shared, explicit sync schema will supplement it; unknown keys will not be silently uploaded. Pub/sub signals, browser-specific performance switches, legacy credentials/pairing codes, transient pseudo-auth state, and unknown/provider databases are excluded.

Derived dashboards (heatmaps, readiness panels, badges, battle plan, burnout etc.) often have no independent state: they recompute from the authoritative stores above. Runtime countdown intervals/audio playback, transient forms, and browser notification permissions are device-local; session records and stored preferences are synchronized. Original timestamps are uneven: some records have IDs/createdAt/updatedAt/completedAt/date, others are booleans/maps with no historical event time. Array order must be preserved; missing historical times cannot be reconstructed honestly.

## Baseline actually run

- Node `v22.22.3`, npm `10.9.8`.
- `npm ci`: passed. Initial dependency audit: one high-severity transitive `source-map-js` advisory (fix available).
- `npm test`: **44 suites passed, exit 0** (2026-10-23). Chunk generation succeeded. No baseline failed suites.
- No Java or installed Chromium found; Firebase Emulator Suite is not preinstalled. Outbound sandbox access is restricted; emulator/browsers may require permitted downloads or a documented external run.

## Selected implementation

Keep the existing frontend/Netlify deployment. Add official modular Firebase Auth (Google only), Firebase Admin on Netlify, and Firestore as the sole new progress database, replacing—not competing with—the insecure snapshot backend. Deny direct client Firestore access entirely; every API call verifies the ID token/revocation, verified Google email, private valid exactly-five-email configuration, and UID ownership. Use transaction-based per-store versions, immutable operation receipts/activity, UID-scoped local queues, explicit conflict recovery, and consented backed-up legacy migration. No service key in browser assets. Provider project/Google setup and production credentials require owner action; unconfigured deployments must remain locked.

Official API references inspected: Firebase's `quickstart-js/auth/google-popup.ts` and current `firebase-admin-node` README (Node 22+). Full operational links and setup will be in `docs/SECURE-SYNC.md`.

## Implementation verification addendum

A follow-up Acorn-based source call-graph audit and real Chromium interactions identified additional non-prefixed display keys (expense/project sorting), certificate/attendance settings and revision migration backups that the original manifest omitted. The final shared schema contains **173 explicit keys** plus the bounded widget-nav family and both real file databases. `npm run audit:storage` is the regression guard for constant storage keys and local wrappers; dynamic watch/theme keys are explicitly audited. Real browser QA discovered and fixed the relocated typography font path and a stale lost-response replay edge case. See the final test report for actual run status, not the initial baseline alone.

Persisted readiness signals are included for legacy compatibility in the final map; transient observer dispatch is not itself a new progress store. Final recovery review added content-addressed archives, real JSON/ZIP interoperability and native range/clear/abort/quota safety, with targeted tests.
