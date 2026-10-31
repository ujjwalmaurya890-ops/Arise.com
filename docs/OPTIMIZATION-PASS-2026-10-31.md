# Arise optimization pass — 2026-10-31

Incremental changes on the existing architecture. This is **not** a rebuild. Prior engineering overhaul (2026-10-30) remains the security/performance baseline.

## Architecture (verified from source)

- Static shell: `index.html` + React `assets/app-bundle.js` + 111 widget scripts packed into 12 hashed chunks.
- Auth/sync: Firebase Auth via `src/cloud/auth-entry.js`, UID-prefixed `storage-bridge.js`, Netlify/local `server/*.cjs`.
- PWA: `service-worker.js` with content-derived cache revision.
- Publish `dist/` only (`npm run build`).

## Problems addressed in this pass

| ID | Problem | Why | Change | Verification |
|---|---|---|---|---|
| O1 | Cloud-gate logo had no width/height | Extra CLS risk on the first paint LCP candidate | `width="36" height="36" decoding="async" fetchpriority="high"` | `tests/test-optimization-pass.cjs` |
| O2 | Reduced-motion users still got full decorative load unless they set `arise-perf-mode` | WCAG 2.2 2.3.3 / 2.2.2 | Auto `perf-lite` + `reduce-motion` class unless `arise-perf-mode=full`; skip-link `:focus-visible` | Source assertions |
| O3 | Quota failures on the storage facade rethrew with no UI event | Users could lose a write silently except via console | `arise:storage-quota` CustomEvent; existing toast in `widget-shared-utils.js` listens | Source assertions; existing quota tests still pass |

## Not claimed

- No Lighthouse / PageSpeed run in this environment (no Chrome UX report). Do not invent scores.
- Widget idle staging (~8.5s stage-2 delay) is intentional INP protection and was not shortened.
- `animation-upgrade.css` remains render-blocking by existing UX tests (FOUC).
- Six moderate npm advisories remain; `npm audit fix` was not applied (lockfile stability).

## Tests

`npm test` was executed after the changes: widget-chunk rebuild, all `tests/test-*.js|cjs` including cloud suite. Exit code 0.

## Commands

```bash
npm install
npm test
npm run build
npm start   # or npm run dev
```

Deploy: publish `dist/` (Netlify `publish = "dist"`). Never publish the repository root.
