# Architecture

This document describes how Arise is put together today, so a change can be made
in the right place. It reflects the code in this repository, not an intended
design: every section names the files that actually own the behaviour.

## 1. Runtime shape

Arise is a static, local-first site. There is no bundler step at deploy time
beyond `npm run build` and no server-rendered pages.

```
index.html                 document entrypoint: security bootstrap, theme bootstrap,
                           the React shell placeholders, the ordered script loader
assets/app-bundle.js       the compiled React shell (navigation, routes, core cards)
assets/app-analytics.js    lazily loaded Analytics route
src/**                     ordered classic scripts: widgets, buses, features, patches
styles/**                  per-feature stylesheets, each scoped to its own class prefix
service-worker.js          offline shell; installs the core + extended cache
scripts/build.mjs          builds dist/: copies sources, generates hashed chunks, stamps
                           the service worker cache name
scripts/tools/build-widget-chunks.cjs
                           groups the ordered source list into 12 hashed chunks and
                           rewrites index.html + the service-worker extended list
```

### Boot order (the part that matters)

1. `index.html` runs two inline bootstraps: a security/theme bootstrap and the
   cloud gate. Nothing user-facing renders until the cloud gate resolves.
2. `src/cloud/storage-schema.js` and `src/cloud/storage-bridge.js` load first;
   `src/cloud/protected-runtime.js` starts the authenticated runtime and then
   registers the service worker.
3. The protected runtime loads the ordered source list from `index.html`
   (`SCRIPTS`) in batches, injected as `<script async=false>` so execution order
   is exactly list order. Chunks are tried first; a failed chunk falls back to
   its individual source files.
4. Once everything has run, `window.__ariseWidgetsReady` becomes `true`. Tests
   and the loading system key off that flag.

**Ordering is a contract.** Later scripts decorate or replace globals created by
earlier ones (for example `src/a11y-*-patch.js` after the widgets they patch).
When adding a module, place it in `SCRIPTS` where its dependencies already
exist, and never reorder unrelated entries.

## 2. State: where data lives

All user data is browser-local first and, for approved accounts, mirrored to
Firestore by UID.

| Concern | Owner |
| --- | --- |
| Audited key list | `src/cloud/storage-schema.js` (`keys[]`, `databases`) |
| Key metadata (owner file, description) | `src/storage-keys.js` |
| Cloud read/write queue, ownership | `src/cloud/sync-engine.js`, `src/cloud/storage-bridge.js` |
| Attachments (IndexedDB) | schema `databases`, handled by the storage bridge |
| Backup/restore | `src/cloud/backup-codec.js`, `src/cloud/auth-controller.js`, `src/backup-center-widget.js` |

Rules that keep this coherent:

- **One owner per key.** A new feature store gets one owning module, one entry in
  `storage-schema.js`, one entry in `storage-keys.js`, and a passing
  `npm run audit:storage`.
- **Read-only views never write.** Modules such as `src/progress-overview.js`,
  `src/study-horizon.js` and `src/analytics-integrity.js` read other widgets'
  stores and own no key (analytics-integrity documents its own).
- **Never invent user data.** Widgets that ship sample rows (attendance, CGPA)
  must be distinguishable from real data by readers; `progress-overview` ignores
  store-shaped demos for exactly this reason.

## 3. Reaction: how routes and widgets meet

The React shell owns routes and the card stack. Classic widgets mount into the
DOM through two contracts:

- `window.__mountX(host)` / `window.__unmountX()` — the shell calls these when a
  route renders. `src/mount-safety.js` wraps them so a throwing widget renders a
  contained error state instead of a blank route.
- Self-mounting modules — newer modules (notification center, day plan, focus
  audit, study horizon, progress overview, accessibility audit, PWA status)
  observe the DOM and mount a single card into the current route stack.

A host is looked up as the route's own stack (`.space-y-6` on Dashboard and
Achievements, `.space-y-5` on Exam Tracker). New modules should follow the
existing `host()` pattern — try the known stack classes, then fall back — rather
than assuming one class name.

## 4. Change propagation

- `src/mutation-bus.js` debounces DOM mutation records and notifies subscribers.
  It drops records produced *by* its own subscribers (otherwise a re-rendering
  widget feeds the bus its own output forever) and it can filter records inside
  a subtree that declared itself self-updating via
  `data-arise-bus-idle` (`src/perf-watch.js`).
- `src/storage-watch-bus.js` notifies subscribers when a watched key's value
  changes, using `AriseStorage.onChange` when available.
- `window.AriseStorage` (cloud bridge) is the only supported way to write
  synchronised state.

## 5. Loading, offline and failure surfaces

| Surface | Module |
| --- | --- |
| Skeletons, progress, async lifecycle | `src/loading-system.js` (`window.AriseLoading`) |
| Offline banner | `src/loading-system.js` |
| Widget/chunk failure line | `src/widget-failure-reporter.js` |
| Bounded retries for failed chunks | `src/reliability-watch.js` + `window.__ariseLoadModule` |
| Shell version, update and offline cache state | `src/pwa-status.js` |
| Route announcement, landmarks, skip link | `src/a11y-audit.js` |
| Backup inspection before restore | `src/backup-integrity.js` |

## 6. Styling

Themes are token-based (`styles/theme.css` defines `--surface`, `--text-primary`,
`--primary`, spacing and radii). Feature stylesheets are additive and scoped to
their own prefix (`.sh-`, `.po-`, `.pwa-status`, `.bki-`, ...). A shared override
of `.glass-card` or a raw colour is a defect: it breaks the other 40 themes.

## 7. Testing map

| Layer | Command | What it proves |
| --- | --- | --- |
| Feature regressions (jsdom) | `npm test` | every `tests/test-*.cjs` plus the cloud/auth/sync TAP suite |
| Cloud/auth/sync only | `npm run test:cloud` | schema, sync engine, backup codec, service worker lifecycle |
| Storage hygiene | `npm run audit:storage` | every constant key is known to the schema and manifest |
| Real browser UX | `npm run test:browser:ux` | loading, skeletons, announcements, mobile behaviour |
| Real browser engineering | `npm run test:browser:engineering` | 20 routes × 8 widths, modals, offline shell, attachment safety |
| Performance lab | `npm run test:performance` | dashboard load/idle measurements |

Tests build fixtures with `tests/browser/harness.cjs` (`launchBrowser`,
`authenticatedContext`, `openDashboard`, `navigate`), which stubs the cloud
provider and seeds Storage. They never touch a real Firebase project.

## 8. Build and deploy

`npm run build` copies sources into `dist/`, regenerates hashed chunks, stamps
the service-worker cache name with a content digest and writes the offline shell
list. **Netlify publishes `dist`, never the repository root.** The PWA identity
images in `assets/` are the only tracked bitmaps; they are referenced by the
manifest, the icon links and the service worker, and nothing in the UI displays
them.
