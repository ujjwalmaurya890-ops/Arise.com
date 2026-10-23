# Exact change manifest — 2026-10-23

Compared with the original checkout (`635e13187b152d0b4bf5051d318089aeb7491623`), on branch `arena/1f1ca51a-arise-com`. This is the implementation's actual file-change inventory, not a proposed plan. Committing, pushing or opening a pull request does not activate the integration: provider provisioning and production deployment have not been performed.

## What changed / why

- **Security and backend:** Firebase Google identity, server-only Admin SDK, private exactly-five-email policy and UID-derived access. All direct Firestore clients are denied. Replaces the existing unauthenticated Blobs sync endpoint (410); does not run a competing legacy sync service. Existing public coding-platform-stat proxies remain public; protected user progress and AI requests require approval.
- **Existing frontend integration:** original React/dashboard/widgets/themes preserved behind a new responsive gate. Name/photo/verified-email account menu, safe logout, save/offline/failure/conflict states and protected AI/Backup Center actions. Targeted changes to the existing prebuilt React bundle are necessary because its original React source project is absent.
- **Persistence and migration:** exact legacy strings for 173 keys, dynamic navigation and the two actual attachment databases; UID-scoped caches, synchronous journals, acknowledged saves, persisted retries, transaction CAS, immutable history, explicit same-store conflict choices. Ownership consent, deterministic migration, lossless JSON/ZIP, verified counts/digests and content-addressed recovery copies preserve originals instead of clearing them. Native IndexedDB abort/range/clear/quota behavior and overlapping internal/user writes are covered.
- **Build/deployment:** non-destructive `dist/` build prevents publishing privileged repository files. Same-origin local API, Netlify function packaging, API no-store, security-script network-first cache handling and a one-time reload from pre-security service-worker caches. A relocated-font URL and mobile account/notification overlap found by actual Chromium QA are corrected without redesigning unrelated features.
- **Dependencies:** official compatible Firebase/Auth/Admin SDKs, `fflate` for real lossless ZIP compatibility; esbuild, jsdom, fake-indexeddb, Acorn, Chromium/Playwright and rules test tooling. Versions are locked; Node 22.22+ is documented. No secrets/real approved emails are included.
- **Verification/docs:** original 44 regression files plus 41 new auth/security/sync test cases, actual desktop/mobile Chromium, optional real rules/Admin transaction suite and Java-enabled CI. Live Google/provider, production deployment and emulator execution remain owner verification, not claimed successes.

## Exact paths

### Created (39)

- `.env.example`
- `.github/workflows/secure-sync.yml`
- `assets/chunks/w02.7e5c6b2b.js`
- `assets/chunks/w08.095915ac.js`
- `assets/chunks/w09.6a439667.js`
- `config/approved-users.example.json`
- `docs/SECURE-SYNC-AUDIT.md`
- `docs/SECURE-SYNC-CHANGES.md`
- `docs/SECURE-SYNC-TESTS.md`
- `docs/SECURE-SYNC.md`
- `docs/SYNC-STORAGE-MAP.md`
- `firebase.json`
- `firestore.indexes.json`
- `firestore.rules`
- `netlify/functions/cloud.js`
- `netlify/functions/public-config.js`
- `scripts/configure-access.cjs`
- `scripts/tools/audit-storage.cjs`
- `scripts/verify-secure-browser.cjs`
- `server/access.cjs`
- `server/cloud.cjs`
- `server/firebase.cjs`
- `server/http.cjs`
- `src/cloud/auth-controller.js`
- `src/cloud/auth-entry.js`
- `src/cloud/backup-codec.js`
- `src/cloud/protected-runtime.js`
- `src/cloud/storage-bridge.js`
- `src/cloud/storage-schema.js`
- `src/cloud/sync-engine.js`
- `styles/cloud-auth.css`
- `tests/cloud/browser.test.cjs`
- `tests/cloud/helpers.cjs`
- `tests/cloud/idb-bridge.test.cjs`
- `tests/cloud/security.test.cjs`
- `tests/cloud/service-worker.test.cjs`
- `tests/cloud/storage-inventory.test.cjs`
- `tests/cloud/sync.test.cjs`
- `tests/emulator/firestore-rules.test.cjs`

### Modified (19)

- `.gitignore`
- `README.md`
- `_redirects`
- `assets/app-bundle.js`
- `index.html`
- `netlify.toml`
- `netlify/functions/ai-ask.js`
- `netlify/functions/package.json`
- `netlify/functions/sync.js`
- `package-lock.json`
- `package.json`
- `scripts/build.mjs`
- `scripts/serve.mjs`
- `service-worker.js`
- `src/ai-connect-shared.js`
- `src/backup-center-widget.js`
- `styles/typography-upgrade.css`
- `tests/test-backup-secrets.cjs`
- `tests/test-certificates-ai-routing.cjs`

### Retired generated chunks (3)

- `assets/chunks/w02.274af4fc.js`
- `assets/chunks/w08.6b7a2777.js`
- `assets/chunks/w09.36aeb6ce.js`

The three retired files above are **obsolete generated hash outputs**, each replaced by its new hash in `assets/chunks/`; no widget source or user dataset was deleted. Their references are updated together in `index.html` and `service-worker.js` by the existing chunk generator.

`dist/`, `node_modules/`, temporary browser libraries, `.test-artifacts/` screenshots and `*.log` evidence are generated/ignored, not Git deliverables. Private `.env`, actual five-email config and service-account files are excluded; examples contain invalid placeholders only.

See [deployment, exact commands, migration, rollback and manual acceptance](SECURE-SYNC.md), [audited store-by-store mapping](SYNC-STORAGE-MAP.md), [pre-implementation audit](SECURE-SYNC-AUDIT.md) and [executed versus unexecuted tests](SECURE-SYNC-TESTS.md).
