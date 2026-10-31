# Arise engineering overhaul — audit, implementation and verification

**Date:** 2026-10-30 · **Branch:** `arena/67009a3c-arise-com`

**Baseline:** `6501aee49a02ada0dc7c6eae6b7f26b794aa3e7a`

**Final public-build cache revision:** `56ebcba9eb9791b9`

This is an incremental upgrade of the **existing application**, not a replacement. Architecture discovery, baseline measurements, prioritization and an upgrade plan preceded implementation. The implementation preserves the existing navigation, themes, 111 ordered widget sources, 12 generated chunks, source fallback, account policy, storage formats, attachment stores and backup/recovery contracts.

**Outcome:** reproduced security/reliability defects were addressed and the scoped regressions pass. Redundant loading and mobile Analytics layout stability improved in the lab. **Performance results are mixed:** desktop LCP, long-task totals and sampled interaction medians did not improve. This is not a claim of complete security, WCAG compliance, uniformly faster rendering, or verified production deployment.

The [measurement record](ENGINEERING-OVERHAUL-MEASUREMENTS-2026-10-30.json) retains all six baseline runs, six intermediate after-runs and six final after-runs. Raw logs/screenshots remain in ignored `.test-artifacts/overhaul/`. No actual user accounts or production data were used.

## 1. Architecture discovered

- **Entrypoint:** `index.html` contains the sign-in gate, inert pre-rendered fallback, early error recorder, deferred mount contracts and ordered widget loader. `src/cloud/storage-schema.js` and `storage-bridge.js` load before application code.
- **Actual UI runtime:** checked-in `assets/app-bundle.js` contains React, UI state, navigation and motion code. `assets/app-analytics.js` is a separately injected chart module. Full original React source/build provenance is **NOT VERIFIED**. The inspected existing `scripts/tools/split-app-bundle.cjs` generates the Analytics shim; its template and checked-in shim now have a parity regression. `upgrade/focus-ring/*.jsx/js` is not the actual application entrypoint. No speculative React/framework upgrade was made.
- **Widgets:** 111 classic scripts in `index.html:SCRIPTS`, assembled in the same order into 12 content-named chunks by `scripts/tools/build-widget-chunks.cjs`. Some self-discover DOM; others implement `window.__mount*` / `__unmount*`. Shared mutation/storage buses, deferred mounts and source-file retry remain. `src/daily-learning-tasks-widget.js` is loaded separately by the shell. `__mountCSEPlacementCritical` and `__mountSemesterMastery` are already declared optional/unavailable; no implementations were invented.
- **Styles/themes:** compiled `assets/app-styles.css`, `styles/theme.css`, SaaS, typography, animation and responsive layers, feature styles and widget-owned style elements. Existing self-hosted Inter/JetBrains Mono, theme tokens, theme scheduling, custom palettes and preference keys remain.
- **Data:** 177 explicit schema keys, plus dynamic widget-navigation keys. Widget-specific JSON remains opaque to the cloud transport. The storage bridge maps keys to immutable-UID prefixes and isolates the two attachment databases. Change journals, recovery snapshots, ZIP backups and ownership checks remain. No storage migration or format replacement was introduced.
- **Auth/sync:** bundled `src/cloud/auth-entry.js` initializes Firebase Auth. `auth-controller.js` verifies access, restores cloud state and requests migration consent before resolving `AriseBoot.ready`; `protected-runtime.js` then runs application scripts. `server/access.cjs` verifies revocation, Google provider, verified email and an exactly-five-account allowlist. `server/cloud.cjs` uses UID-owned, versioned transactional records and attachment chunks. Direct Firestore client access is denied by the checked-in rules.
- **Integrations:** same-origin Netlify auth/cloud/AI and public coding-platform proxies; other widgets contact public platform APIs and opt-in weather services. Live credentials/provider operation are **NOT VERIFIED**. Browser/backend tests explicitly substitute the existing test transport, not a production authentication bypass.
- **PWA:** core/extended CacheStorage shells, extended-cache messages and periodic CP-sync messages. The worker never intentionally changes localStorage or IndexedDB. Protected API requests are not cached. Offline shell availability does not grant offline authorization to a fresh signed-out page.
- **Build/hosting:** Node 22.22+, esbuild auth bundling, static `dist/`, Netlify Functions, `netlify.toml` and `_redirects`. `scripts/serve.mjs` binds `0.0.0.0`, serves same-origin APIs, compressed static assets and byte ranges. **Publish `dist/`, never the repository root.**
- **Dependencies:** existing `fflate 0.8.3`, `firebase 12.19.0`, `firebase-admin 14.5.0`, esbuild, Acorn, jsdom, fake-indexeddb, Playwright and Sparticuz Chromium were reused. No dependency was added or upgraded; `package-lock.json` is unchanged.

Discovery included tracked-file inventory, build/config/dependency inspection, AST/syntax inventory of 214 non-chunk JS-family inputs, storage inventory, HTML/URL/dynamic-execution scans, targeted formatted inspection of compiled code, tests and browser reproduction. Acorn parsed 213/214 inputs; the unbuilt JSX example requires a JSX-aware parser. This is **not** a claim that every statement in every compiled file or every possible widget state was manually audited.

## 2. Existing problems and prioritized dispositions

The initial E01–E11 register and plan were written before implementation; E12 emerged during the broader navigation sweep. Each row identifies a location, mechanism, bounded solution and verification method.

| ID / priority | File / function or location | Reproduced problem / mechanism | Implemented solution | Verification |
|---|---|---|---|---|
| E01 / High | `index.html:__ariseExpedite`, `startLazyLoad`; `src/cloud/protected-runtime.js:startProtectedRuntime` | Tab on the locked gate started all 12 widget chunks before the boot promise. This was **not** a demonstrated server-auth bypass. | Guard all widget-start paths on approved boot readiness; only preload the protected runtime after restore/consent. | Red-to-green boot isolation regression; locked Chromium keyboard/pointer/direct-expedite checks; secure browser restore regression. |
| E02 / Medium | `index.html:loadScriptsInOrder/prewarm` | Speculative `fetch().arrayBuffer()` allocated unused copies and generated repeated responses when HTTP caching was disabled. | Native script preload hints matching execution mode; retain ordering, idle boot cap and expedite behavior. | All 12 chunk requests occur once in Chromium; existing chunk/source-fallback assertions pass; measured resource counts/bytes below. |
| E03 / High | `src/notes-app-widget.js:S` and linked-note toolbar; `src/personal-wiki-widget.js:k`; shared `safeURL` | Eight unsafe anchors in the reproduction: HTML escaping did not validate URL protocols. Nested inline-code placeholders also leaked after the first fix. | Allow safe HTTP(S)/relative URLs and mailto for links; reject control characters, credentials and executable protocols. Keep code/text/attribute token restoration separate. | Hostile-scheme and nested-code/quoted-alt tests; legitimate links, wiki titles and original stored text retained. |
| E04 / High | `src/local-files-widget.js:M/U/q`; certificate `xr/hr/vt` and HTML metadata rendering | HTML named `.pdf` executed a harmless parent-window sentinel in the original local-file preview. Unescaped imported IDs/extensions could add HTML attributes/elements. | Explicit safe PDF MIME, iframe sandbox without same-origin, inert text Open for executable documents, escaped metadata, preserved original downloads. Certificate preview gains dialog naming, Escape and focus restoration. | Before/after Chromium sentinel; original download bytes; inert HTML popup; PDF MIME/sandbox; PNG decoding; metadata DOM regressions. Native PDF visual fidelity remains **NOT TESTED**. |
| E05 / Medium | `service-worker.js:install/activate/networkFirst/fillExtendedCache`; build cache version | Partial installs were swallowed, unrelated caches could be deleted, fixed-name code/navigation could remain stale, standalone Analytics was skipped in extended fill. | Atomic core installation, Arise-only cleanup, content-derived build revision, bounded network-first mutable code/navigation, coalesced extended fill including Analytics. | Eight worker tests, deterministic build-version regression and real Chromium install/offline/cache-retention checks. |
| E06 / Medium | `scripts/serve.mjs` range/fallback/encoding blocks; HTTP policy and redirects | Invalid range returned malformed 206; missing `.js` returned 200 HTML. | Single/suffix/open-ended range validation and 416, If-Range handling, missing-static 404, encoding quality handling and 304 Vary; SPA routes retained. | Local HTTP integration and 17 policy assertions. Netlify deployment behavior **NOT VERIFIED**. |
| E07 / Medium | `src/career-intelligence-dashboard.js:validate/S/render/key/change` | Invalid stored shape crashed rendering; imports were not fully validated; tab rerender lost focus; settings lacked persistent labels. | Read-only recovery and original-data export; atomic validation before import; reject prototype-setting keys and >5 MiB input; quota feedback; visible labels and arrow/Home/End focus restoration. | Corruption/import/quota/focus regressions and real browser keyboard checks. No key/shape migration. |
| E08 / Medium | `assets/app-bundle.js:__loadAriseAnalytics`, boundary and `g9`; matching splitter template; widget discovery/CSS | A failed Analytics asset unmounted the entire React workspace. Delayed loading moved the companion panel and inserted/removed the toolbar. | 12-second loader deadline, real Error rejection, export validation, cleanup, local error boundary and fresh-lazy Retry; reserve route/toolbar geometry; discover charts through the wrapper. | Loader dedup/retry/deadline/export/parity tests; failed navigation and delayed successful Retry in Chromium; session-window CLS diagnostic. |
| E09 / Medium | SaaS/widget-nav/cloud-auth CSS; CGPA card layout | Mobile header buttons were 32 px and quick-jump chips ~26 px. Actual 1024px testing exposed Learning and CGPA overflow beside the desktop sidebar. | Scoped 44px touch controls, usable two-row narrow toolbar, focus outlines, min-width fix for task input, container-responsive CGPA rows and bounded recovery/account panels. | 160 route/viewport states, light/dark control geometry, keyboard tests and additional short/landscape viewport probes. |
| E10 / Medium | `netlify/functions/ai-ask.js` body/token/provider parsing | JSON null caused property access failure; negative/fractional budgets reached upstream; malformed provider content could throw or look successful. | Object/raw-size/nonblank-prompt checks, positive safe-integer capped token budgets, explicit malformed-provider 502. | 12 AI tests; authorization, no-store and server-only key path retained. Live AI **NOT TESTED**. |
| E11 / Low | `tests/test-backup-secrets.cjs`; `scripts/verify-secure-browser.cjs` offline fixture | Backup test guessed a 50ms completion time. An offline browser fixture could still fulfill cloud requests, and a concurrent run failed its offline assertion. | Await export completion with a 5-second failure bound; wait for browser online/offline state; abort offline fixture API requests and assert pending data was not acknowledged. | Full suite and standalone tests; isolated secure browser pass. Concurrent stress failures are disclosed below, not presented as solved application defects. |
| E12 / Medium | `src/premium-productivity-features.js:I/ae`; `src/saas-widget-enhancer.js:discoverWidgets` | Settings diagnostics remained before the React route after returning to Dashboard; first-child discovery selected that panel and removed the widget toolbar. | Remove stale diagnostics outside Settings; ignore that supplemental panel when discovering the route container. | Reproduced Settings → Dashboard failure; red-to-green toolbar lifecycle test; browser return-navigation assertion. |

No Critical server authorization bypass was demonstrated. Findings are prioritized by the observed mechanism, not by invented scanner scores.

## 3. Performance review and implementation

### Changes actually made

- **Avoid unnecessary work while locked:** protected script fetching/execution waits for approved boot readiness. A locked Tab interaction now requests **0 rather than 12 widget chunks**.
- **Remove redundant prewarm work:** native preload replaces manual response-buffer downloads. Actual ordered script execution and source fallback remain unchanged. The browser test sees each of the 12 chunks exactly once.
- **Fetch authorized shell assets in parallel, execute in order:** `startProtectedRuntime` preloads its existing placeholders, then retains the original eight-script execution order and failure handling.
- **Stabilize lazy-route geometry:** route-state minimum height, non-shrinking header/toolbar and pending-toolbar footprint prevent the diagnosed late insertion/removal shifts. This is not a blanket overflow-hiding workaround.
- **Cache correctness rather than speculative bundle surgery:** content-versioned offline shells, network-first mutable JS/CSS/JSON/manifest, immutable hashed chunks, explicit missing-static 404 and browser encoding preferences.

### Deliberate non-changes and unfavorable results

- Existing font preloads, optional font display, self-hosted font files, logos, themes and image assets were preserved; their pre-existing optimizations are **not claimed as new work**.
- A minification feasibility check saved only about 2% raw / 1.5% gzip for the existing chunks. Wholesale re-minification was rejected as unnecessary churn.
- Chunk source total changed from **2,776,497 to 2,786,612 raw bytes**, and **737,463 to 740,274 gzip bytes** using Node gzip defaults. This is a small increase for validation/recovery code, not a bundle-size reduction. The measured response-byte reduction comes from avoiding repeated requests.
- The idle staged-loader contract still takes approximately **9.4 seconds** to mark every widget script ready; no large improvement to that milestone is claimed.
- Final desktop LCP median was **740ms versus 380ms**, with one **3,936ms** outlier. Long-task totals and sampled interaction medians also increased. See section 11; these are remaining performance issues.
- A separate attribution diagnostic observed different LCP candidates across runs: the existing pre-rendered landing headline, sidebar text, account UI and later dashboard quote text. This helps explain measurement instability but does **not** prove the regressions harmless or establish their sole cause. The boot handoff and main-thread work need further profiling.

## 4. Security review and safeguards

### Verified improvements

- Notes/Wiki link sinks now validate schemes rather than relying only on HTML escaping. Unsafe content is shown as readable text; stored Markdown is not erased. Controls/credentials and executable protocols are rejected. Inline code in labels and quoted image-alt text cannot be restored as markup inside attributes.
- The original HTML-as-PDF local preview executed a harmless parent sentinel. The upgraded preview did not execute it and did not create an HTML iframe. The certificate equivalent is rejected in the browser regression as well.
- PDF preview blobs have an explicit PDF MIME and `sandbox="allow-scripts"` **without** `allow-same-origin`, plus `referrerpolicy="no-referrer"`. The browser test verifies MIME, isolation attributes and original-byte download; it does not assert the native PDF viewer's visual fidelity.
- Opening an HTML local attachment creates an inert `text/plain` document with no opener. Download continues to return the original stored bytes.
- Imported file/certificate IDs and displayed filename extensions are escaped at HTML sinks. Storage identity is unchanged; the regression verifies the rendered data attribute still addresses the original ID.
- Career imports validate before mutation, reject dangerous object keys and oversized JSON, and report persistence failures. Corrupt stored state remains byte-for-byte available for recovery export instead of being overwritten by defaults.
- AI proxy input/provider validation is bounded. Existing authorization, model allowlist, token cap, 20-second deadline, private response headers and server-only Anthropic key remain.
- Worker requests carrying Authorization, API paths, non-GET methods, ranges and cross-origin requests are bypassed; no protected API response appeared in the real cache test.

### Preserved controls / scope

Exactly-five-account access, Google/verified-email/revocation checks, immutable UID ownership, journals, restore/consent ordering, deny-all direct Firestore rules and backup ownership were not relaxed. No production key, fake signed-in user or fabricated live analytics was added. Test identities/transports live only in tests and verification scripts and are not imported by the production build.

The final npm advisory scan reported **0 vulnerabilities**, and the public build's credential-boundary checks passed. Neither result is a penetration test or security certification. The existing CSP is still limited; comprehensive stored-data validation, rate limiting and live provider authorization remain open work.

## 5. UI/UX improvements

- Analytics failure now presents a localized explanation and **Retry Analytics**, rather than a blank application. Other navigation and a stored-data sentinel remain intact. Retry creates a fresh lazy component so React's rejected-promise cache does not trap the user.
- Pending routes reserve visible layout space; quick-jump/filter controls do not disappear during delayed Analytics loading.
- Career data corruption has a visible recovery explanation and original-data download instead of a crash or silent reset. Invalid imports, file read errors, size limits and quota failures are explicit.
- Career forms have persistent visible labels. Tab focus survives rerender; ArrowLeft/ArrowRight/Home/End work in both jsdom and Chromium.
- Narrow-screen search/filter and Compact controls remain usable; shared quick-jump controls receive explicit focus outlines.
- The certificate preview is named as a dialog, has a labelled close control, supports Escape and restores focus. This is not a full modal/screen-reader compliance claim.
- Settings diagnostics no longer stay at the top of unrelated routes and interfere with their toolbar discovery.
- `noindex, nofollow` metadata is appropriate to this private workspace. No irrelevant public SEO copy or invented search-ranking benefit was added.
- Existing brand, navigation hierarchy, palette/theme system and feature content remain. No decorative animation, new gradient scheme or replacement dashboard template was introduced.

## 6. Responsiveness improvements and actual verification

**Actual Chromium route sweep:** all 20 sidebar routes at widths **320, 360, 390, 430, 768, 1024, 1440 and 1920**, each at 900px height: **160 states**, no document/main-pane horizontal overflow and no uncaught page errors. Recorded headings match the requested routes. The existing UX suite additionally exercised 768×1024 and 390×844. This is route/layout coverage, not a claim that every form/action in every route was exercised.

- Mobile header controls: measured **32×32 → at least 44×44px**. Quick-jump chips: approximately **25.91px → 44px high**. Filter: **44px high** at the tested narrow widths.
- At ≤600px the toolbar uses a horizontal quick-jump row and a full-width filter/Compact row. Tabs retain their own intentional horizontal scrolling rather than forcing the page wider.
- At ≤480px the redundant read-only header level/streak badges and small header logo are omitted to keep menu/title/search/theme controls readable. The same metrics remain in Dashboard cards and Arise branding remains in navigation. No action or stored metric was removed.
- **Learning at 1024px:** reproduced main scroll width 788px in a 774px pane. Letting the flex input shrink and reserving the Add-task button fixed the tested overflow.
- **CGPA at 1024px:** reproduced main scroll width 1029px in a 774px pane. Container queries adapt the subject editor to its actual card width beside the sidebar, instead of relying solely on viewport width. Inputs, values and calculations were not changed.
- Short/landscape account-panel probes at **568×320, 844×390 and 320×568** stayed inside the viewport, with internal scrolling where necessary. The last account action remained reachable. Conflict-card geometry was tested by revealing its existing markup in an isolated test context; this was **layout-only**, not a live conflict-resolution test.
- Light/dark shared-control geometry was checked at 320, 768 and 1440px. Reduced-motion and existing modal/focus tests passed. Full theme/contrast/screen-reader and multi-engine audits are **NOT TESTED**.

## 7. Modified files

The following existing files have deliberate modifications. No dependency version or lockfile was changed.

| File | Change |
|---|---|
| `README.md` | Links to this report, retained measurements and verification commands. |
| `index.html` | Approved-boot guard, native preload, private noindex metadata, regenerated chunk references. |
| `assets/app-bundle.js` | Surgical Analytics loader/boundary/retry and route-skeleton markers. |
| `scripts/tools/split-app-bundle.cjs` | Matching maintained Analytics shim template. |
| `src/cloud/protected-runtime.js` | Authorized parallel preloads with original execution order. |
| `src/widget-shared-utils.js` | Shared safe URL validation. |
| `src/notes-app-widget.js` | Safe stored URLs and tokenized Markdown rendering. |
| `src/personal-wiki-widget.js` | Safe Markdown/wiki labels and URL sinks. |
| `src/local-files-widget.js` | Isolated PDF preview, inert Open MIME, escaped ID/extension output. |
| `src/features/certificates/certificates-widget.js` | Isolated previews, escaped IDs, safe ID lookup, dialog close/focus behavior. |
| `src/career-intelligence-dashboard.js` | Validation, recovery, atomic import, quota messages, labels and keyboard focus. |
| `src/premium-productivity-features.js` | Remove stale Settings health panel on route exit. |
| `src/saas-widget-enhancer.js` | Pending-toolbar retention and correct route/card discovery. |
| `styles/saas-upgrade.css` | Route geometry, scoped touch controls, task/CGPA/Career responsive constraints. |
| `styles/widget-nav.css` | Touch-size widget tabs and scroll/focus padding. |
| `styles/cloud-auth.css` | Viewport-bounded, scrollable account/recovery panels. |
| `netlify/functions/ai-ask.js` | Bounded request and provider-response validation. |
| `service-worker.js` | Atomic/scoped/fresh cache lifecycle and generated chunk inventory. |
| `scripts/build.mjs` | Public 404 asset and deterministic content revision. |
| `scripts/serve.mjs` | Static 404, range validation, If-Range, encoding quality and 304 Vary. |
| `server/http-policy.cjs` | Manifest revalidation, JSON cache policy and 404 no-store. |
| `netlify.toml` | Matching static 404/cache configuration. |
| `_redirects` | Non-forced static-missing 404 rules before SPA fallback. |
| `package.json` | Engineering-browser and measurement commands only. |
| `scripts/verify-secure-browser.cjs` | Offline fixture no longer falsely acknowledges requests; network-state/queue assertions. |
| `tests/test-backup-secrets.cjs` | Completion-based export waits instead of guessed sleeps. |
| `tests/test-serve-errors.cjs` | Static/range/HEAD/encoding regression coverage. |
| `tests/test-server-http-policy.cjs` | Extended HTTP policy assertions. |
| `tests/cloud/ai-ask.test.cjs` | Malformed body, budget and provider tests. |
| `tests/cloud/service-worker.test.cjs` | Updated worker lifecycle mock/expectations. |

## 8. Created files

| File | Purpose |
|---|---|
| `404.html` | Self-contained unavailable-file page for static hosting. |
| `scripts/lib/public-cache-version.mjs` | Sorted, content-only public-tree digest; normalizes the worker's own revision. |
| `scripts/measure-dashboard.cjs` | Reproducible baseline/after lab protocol using test-only auth. |
| `scripts/verify-engineering-browser.cjs` | Real Chromium route/geometry/retry/attachment/PWA regressions. |
| `tests/browser/harness.cjs` | Reuses the real controller/runtime and existing cloud fixture in isolated contexts. |
| `tests/test-boot-isolation.cjs` | Locked-input/start-path regression. |
| `tests/test-safe-markdown.cjs` | URL, code/attribute-token and original-data preservation checks. |
| `tests/test-attachment-metadata.cjs` | Imported ID/extension HTML injection regression with stable stored IDs. |
| `tests/test-analytics-loader.cjs` | Deduplication, deadline, failure/retry, invalid export and generator parity. |
| `tests/test-widget-toolbar-lifecycle.cjs` | Supplemental panel, pending route and transparent-wrapper discovery regression. |
| `tests/test-career-dashboard-safety.cjs` | Corrupt state, imports, prototype keys, quota, labels and focus. |
| `tests/test-public-cache-version.cjs` | Deterministic/content-sensitive versioning independent of timestamps. |
| `tests/cloud/service-worker-lifecycle.test.cjs` | Seven additional worker lifecycle/freshness/isolation cases. |
| `docs/ENGINEERING-OVERHAUL-2026-10-30.md` | This 14-section report. |
| `docs/ENGINEERING-OVERHAUL-MEASUREMENTS-2026-10-30.json` | Compact raw-run summaries and browser verification evidence. |

**Regenerated content-hash files** (from the existing chunk builder, not hand-written replacement widgets):

- `assets/chunks/w01.d08e27d0.js`
- `assets/chunks/w02.debdf92b.js`
- `assets/chunks/w03.db11febd.js`
- `assets/chunks/w06.97c20d18.js`
- `assets/chunks/w07.dd6102b5.js`
- `assets/chunks/w08.6b20d92a.js`
- `assets/chunks/w09.841256dc.js`
- `assets/chunks/w10.cc83f0f2.js`
- `assets/chunks/w12.67d0d7ca.js`

The unchanged w04/w05/w11 files remain. The builder can repartition adjacent source groups when sizes change; all 111 sources remain present and ordered. `dist/`, `node_modules/` and `.test-artifacts/` follow existing ignore conventions. Diagnostic scripts, logs and screenshots are not production modules or committed bulk artifacts.

## 9. Deleted files and reasons

Only these obsolete generated chunks were removed by the **existing** content-hash rebuild:

| Old generated file | Replacement |
|---|---|
| `assets/chunks/w01.06846d10.js` | `w01.d08e27d0.js` |
| `assets/chunks/w02.7469255a.js` | `w02.debdf92b.js` |
| `assets/chunks/w03.d5ce07a6.js` | `w03.db11febd.js` |
| `assets/chunks/w06.065292b5.js` | `w06.97c20d18.js` |
| `assets/chunks/w07.c019168c.js` | `w07.dd6102b5.js` |
| `assets/chunks/w08.46e7825c.js` | `w08.6b20d92a.js` |
| `assets/chunks/w09.9d70b3c6.js` | `w09.841256dc.js` |
| `assets/chunks/w10.7d84e241.js` | `w10.cc83f0f2.js` |
| `assets/chunks/w12.1604ce85.js` | `w12.67d0d7ca.js` |

**No source feature, account record, user storage key, attachment or repository-root directory was deleted.** Obsolete chunk references are regenerated in the entrypoint and worker together. The normal build recreates ignored `dist/`; this is build output, not user data.

## 10. Actual tests and results

### Baseline executed before implementation

- `npm ci --no-fund --ignore-scripts`: installed 272 packages; no lockfile/source edits. Transitive deprecation warnings were recorded.
- Build and storage audit: passed. Baseline build left Git clean.
- npm advisory scan: 0 reported vulnerabilities.
- `npm test`: **failed** in `test-backup-secrets.cjs`, which read the export before its async snapshot completed. All 50 feature files were attempted; the chained cloud command did not run in that invocation.
- Separate `npm run test:cloud`: **51 passed, 0 failed**.
- Existing loading/UX browser suite: passed its assertions on 12 routes; its large cumulative navigation CLS was diagnostic, not a controlled before/after comparison.
- Reproduction logs captured pre-auth widget loading, unsafe anchors, the file-preview sentinel, malformed ranges, missing-static 200, Career focus/state/import failures, Analytics root unmount and delayed shifts.

### Final executed verification

| Command / test | Actual result | Scope / evidence |
|---|---|---|
| `npm run build` | **PASS** | 111 sources → 12 chunks, 131 extended entries, ~164 KiB auth bundle; safe public output. Repeat build produced the same `56ebcba9eb9791b9` revision. |
| `npm test` | **PASS** | **57 feature runners** completed; **61 cloud tests passed**, 0 failed/skipped. `final-tests.log`. |
| AI validation subset | **12/12 PASS** | Malformed inputs/upstream shapes plus existing auth/key/timeout cases. |
| Certificate AI routing subset | **15 assertions PASS** | Same-origin helper, success/error/missing-helper handling; no live AI. |
| Worker tests | **8 PASS** | Seven new lifecycle tests plus existing security worker regression. |
| HTTP tests | **PASS** | Range/static/HEAD/encoding integration; 17 policy assertions. |
| `npm run audit:storage` | **PASS** | 176 constant keys across 143 script inputs; two dynamic expressions remain documented. No schema additions/migration. |
| `npm run test:browser` | **PASS in isolated final rerun** | Production gate lock, real controller with fixture transport, multi-device restore, native IDB journaling/abort/range-delete/clear, ZIP roundtrip, offline pending queue/reconnect, logout, no uncaught page errors. |
| `npm run test:browser:ux` | **PASS** | 12 routes, delayed/error/retry behavior, duplicate-click prevention, modal ARIA/Escape/focus, tablet/mobile and reduced-motion assertions. |
| `npm run test:browser:engineering` | **PASS on final build** | 160 route/viewport cases; 12 unique chunk requests; themes/keyboard; malicious preview and safe-open/download tests; certificate PDF/PNG/keyboard tests; Analytics failure/retry; real worker/cache/offline shell. |
| Short-viewport browser probe | **PASS** | 568×320, 844×390, 320×568 account/recovery bounds; conflict geometry only. `short-viewport.json`. |
| `npm run test:performance -- after-final` | **6 completed runs; 0 page errors** | Same protocol as baseline; results below, not a performance threshold pass. |
| `npm audit --json` | **0 reported vulnerabilities** | All reported severity counts zero; not a security certification. |
| `npm run test:rules` | **SKIPPED / NOT TESTED** | No Firestore emulator. Output: 0 pass, 1 skip. This is **not** a passed authorization test. |
| `git diff --check` / targeted syntax checks | **PASS** | Source/template and generated-output checks also exercised by the suite. |

### Failures and test limitations retained in the record

- Pre-PR staging exposed inherited trailing spaces inside an unchanged Projects Markdown template literal in a regenerated chunk. That semantic content was preserved and source parity verified. The staged whitespace check passes for all non-generated files; the full check still reports that generated literal.

- The first Analytics diagnostic Chromium launch crashed before any application result; an unchanged rerun succeeded. No browser repair or fabricated result was substituted.
- One concurrently run secure-browser test observed `saved` rather than `offline`. It passed unchanged when isolated. The fixture was then strengthened to stop fulfilling offline API calls and to assert the write remains pending/unacknowledged. This is a **test-boundary correction**, not proof that a production sync defect was fixed.
- Running the secure browser, UX browser and entire Node suite simultaneously produced a separate 30-second second-context restore timeout. The isolated secure suite subsequently passed. Heavy combined-run stability is **not established**; run these commands sequentially. Logs are retained as `secure-browser-concurrent-failure.log` and `secure-browser-under-full-suite-timeout.log`.
- Existing secure-browser wording claimed “110 widget scripts”; it now says “all configured widget scripts.” The actual builder inventory is 111; the old log text was not evidence of a missing module.
- Live Google/Firebase/Anthropic, deployed Netlify rules/headers, real Firestore rules, cross-engine behavior and native PDF visual fidelity are not covered by fixture success.

## 11. Before/after measurements

### Protocol

Chromium 153, local HTTP server, fresh contexts, **three sequential runs per viewport per batch**, 1440×900 and 390×844, no network/CPU throttling. Fixture authentication/cloud transport only; service workers blocked. Initial sample follows dashboard availability; boot sample follows all widget scripts plus one second. Interactions: Analytics → Notes → Dashboard. CLS is the **maximum session window**, not an unrestricted sum. Event Timing is the maximum observed sample per run, **not field INP**.

Playwright routing disables HTTP cache reuse. Decoded response bytes include repeated responses; they are **not** gzip wire transfer, unique bundle size or measured production bandwidth. No Lighthouse or field score is claimed.

### Medians: original baseline vs final build

| Metric | Desktop before | Desktop final | Mobile before | Mobile final |
|---|---:|---:|---:|---:|
| FCP (ms) | 140 | 116 | 140 | 108 |
| LCP (ms) | 380 | **740** | 172 | 148 |
| Local TTFB (ms) | 3.9 | 4.5 | 4.0 | 3.6 |
| Load event end (ms) | 103.5 | 84.2 | 108.2 | 77.7 |
| All widget scripts ready (ms) | 9,456 | 9,388 | 9,399 | 9,385 |
| Boot session-window CLS | 0.00549 | **0.00932** | 0.01372 | 0.01091 |
| Session-window CLS through Analytics | 0.00549 | **0.00932** | 0.04719 | **0.01091** |
| Max observed interaction sample (ms) | 104 | **136** | 120 | **136** |
| Boot long-task count | 2 | **3** | 2 | **3** |
| Boot long-task total (ms) | 172 | **218** | 168 | **220** |
| Boot resource entries | 58 | **47** | 58 | **47** |
| Boot JS decoded response bytes | 6,169,677 | **3,649,236** | 6,169,677 | **3,649,236** |
| Boot CSS decoded response bytes | 276,470 | 280,107 | 276,470 | 280,107 |
| Page errors in the three runs | 0 | 0 | 0 | 0 |

**Interpretation:** 11 fewer resource entries (~19%), about **40.9% fewer decoded JS response bytes** in this harness, and ~**76.9% lower mobile session CLS through Analytics**. Widget-ready time is essentially unchanged. Desktop LCP, desktop boot CLS, long tasks and sampled interactions did not improve. The upgrade must not be advertised as uniformly faster.

### Variability and non-cherry-picked after batches

- Desktop baseline LCP samples: **900, 180, 380ms**; first after batch: **920, 776, 160ms**; final: **3,936, 740, 176ms**.
- Mobile baseline LCP: **172, 148, 184ms**; first after: **164, 156, 188ms**; final: **156, 140, 148ms**.
- First after-batch desktop medians: FCP 124ms, LCP 776ms, long-task total 214ms, sampled interaction 136ms. Mobile: FCP 104ms, LCP 164ms, long-task total 245ms, interaction 128ms. That batch is retained in the JSON, not discarded.
- Final measurements were rerun after an additional invalid-Analytics-export retry fix; the same viewport/load protocol was preserved. The final cache revision and complete per-run summaries are recorded.
- Separate delayed-Analytics regression: a failed asset originally removed `main`; it now leaves navigation intact and Retry succeeds with a deliberate 1.4-second delay. The final delayed-retry session CLS was approximately **0.00010**. This diagnostic is **not substituted** for the controlled table above.
- The existing UX suite's raw cumulative navigation CLS (baseline 0.7855; later run 0.1364) uses a different protocol and concurrent workload. It is not used to claim a percentage performance gain.

## 12. Limitations and explicitly unverified work

- No `.env`/live credentials were available. Real Google login, five configured production identities, revocation, Firebase persistence and Anthropic responses: **NOT TESTED**. The live preview intentionally stays locked without configuration.
- Production Netlify/CDN cache, redirect/range behavior, deployment rollout and real worker update across deployed versions: **NOT VERIFIED**. No deployment was made.
- Real browser PWA **installation, cache retention, extended Analytics caching and offline locked-shell behavior were tested**. In-place deployed-version update, browser eviction/quota and offline authenticated reload semantics across devices: **NOT TESTED**. Mocked update/failure cases are identified as such.
- Firestore emulator authorization/transaction suite: **NOT TESTED (skipped)**. Checked-in rules and stub-backed access tests are not equivalent to a running emulator or production verification.
- PDF sandbox/MIME, actual PDF bytes, download and PNG decoding were tested. Native PDF visual fidelity in Chromium, Safari and Firefox: **NOT TESTED**; the UI provides an explicit download fallback.
- Chromium-only browser execution. Safari/Firefox, physical touch hardware, full keyboard/action coverage, screen-reader behavior, full contrast/zoom/theme matrix: **NOT TESTED**. Existing static compatibility tests do not change that limitation.
- No Lighthouse package/browser pipeline or field RUM was present; no Lighthouse score or field INP result is fabricated. Local unthrottled three-run batches are not population statistics or mobile-network performance.
- Compiled React source provenance beyond the inspected splitter/shim remains **NOT VERIFIED**. Broad framework restructuring was deliberately not attempted.
- Whole-repository scans and selected hostile-input regressions are not exhaustive validation of every legacy widget's stored/imported data. The CSP remains partial and public proxy quota/rate limiting is not completed.
- Sandbox screenshots have some missing emoji glyphs. Physical-device font rendering is **NOT VERIFIED**; no decorative font dependency was added to mask this test-environment issue.

## 13. Remaining issues and important recommendations

| Priority | File / location | Remaining problem / technical explanation | Recommended bounded next step | Required verification |
|---|---|---|---|---|
| High | `src/cloud/auth-controller.js` ready-gate handoff; `src/cloud/protected-runtime.js`; `assets/app-bundle.js` shell/hero rendering | Desktop LCP regressed and long tasks increased. Attribution includes pre-rendered landing and changing quote text, so nominal LCP can describe different content across runs. | Profile the actual authorized-shell handoff and long-task attribution; define a stable workspace-ready milestone; reduce measured main-thread work without weakening the gate or removing features. | Repeat controlled A/B on fixed content, CPU/network throttling and field measurements; preserve existing timing samples. |
| High | `server/http-policy.cjs:DEPLOYMENT_SECURITY_HEADERS`; `netlify.toml`; legacy HTML sinks | CSP only constrains base URI; scoped XSS fixes do not cover every widget/import surface. | Inventory inline/script/style/connect sources; introduce a staged report-only CSP and sink-by-sink validation, then enforce only after compatibility testing. | Real authenticated routes/themes/backups/AI, hostile import corpus, report-only violations and multi-engine browser tests. |
| High before production claims | `server/access.cjs`, `server/cloud.cjs`, `firestore.rules`, emulator suite | Mocked identity/Firestore transport cannot prove deployed rules, revocation or cross-device production behavior. | Run local emulator tests and a credentialed staging acceptance test using approved test accounts. | Explicit unauthorized/sixth-account/revoked/UID-isolation cases, real transactions and recovery. |
| Medium | `netlify/functions/ai-ask.js`, `leetcode.js`, `codechef.js`, `gfg.js` | Input validation is not a rate-limit or upstream quota strategy. | Specify per-user/IP/provider budgets and shared deployment-aware limiting; preserve current authenticated AI policy. | Burst/concurrency tests, upstream 429/backoff behavior and platform telemetry. |
| Medium | `server/http-policy.cjs:cacheControlFor`; fixed-name fonts/sounds/images and deployment config | Some unchanged fixed-name non-code assets still have long cache lifetimes. Worker content versions do not prove every first-load/CDN cache scenario. | Adopt content-hashed media names or revalidation when those assets next change, with compatible reference updates. | Deployed repeat-visit/update tests with and without a controlling worker; audio range playback and image/font decoding. |
| Medium | `styles/*`, widget-owned forms/modals, compiled shell | Shared control fixes and 160 geometries are not a full accessibility or interaction audit. | Cover remaining small controls, modal focus trapping, meaningful empty states, theme contrast, zoom and physical/mobile engines. | Keyboard/screen-reader/contrast checks and Safari/Firefox/real-device action matrix. |
| Medium | `scripts/verify-secure-browser.cjs`; test runner scheduling | Isolated success does not establish stability under simultaneous full-suite/browser load. | Keep CI stages sequential initially, retain failed-run diagnostics, then investigate/resource-budget parallel execution explicitly. | Repeated serialized runs and controlled stress runs with request/navigation/status tracing. |
| Low | `assets/app-bundle.js`, `scripts/tools/split-app-bundle.cjs` | Broader original source/build provenance remains uncertain. | Recover/document the actual React source and generation process before framework-wide changes; retain shim parity tests now. | Reproducible source-to-output build and full feature parity suite. |

These are explicit follow-ups, not implemented capabilities or silently waived acceptance criteria. No approval-dependent architectural replacement was performed.

## 14. Run and verification instructions

### Build and start

```bash
# Node >=22.22.0 and <25; run from the repository root
npm ci --no-fund --ignore-scripts
npm run build
npm start
```

The server binds `0.0.0.0:8123` and supports the Arena preview host. Browser-facing APIs use same-origin URLs. `npm run dev` is the existing build-and-serve shortcut.

Without configuration the public entry is **intentionally locked**, not a fabricated demo. For real access, follow [SECURE-SYNC.md](SECURE-SYNC.md) and `.env.example`, configure the intended server-side five-account policy and provider settings securely, and do not paste private keys into chat or publish `.env`. No credentials are included in this patch.

### Regression commands

Run heavy stages **sequentially**. Keep `npm start` running for browser/lab commands.

```bash
npm test
npm run audit:storage
npm audit
npm run test:browser
npm run test:browser:ux
npm run test:browser:engineering
npm run test:performance -- measurement
npm run test:rules
```

- The measurement label becomes `.test-artifacts/overhaul/measurement-metrics.json` and screenshot names. Use a new label to retain previous runs. Allow roughly 2–3 minutes for the six-run lab series; timings depend on the machine.
- Browser scripts use the existing test-only backend/auth fixture; they do not unlock or alter the production preview. `ARISE_TEST_URL` can point them at a compatible local test server. `CHROMIUM_PATH` is supported by the browser harness/secure script; the measurement driver uses the installed Sparticuz binary.
- `test:rules` requires an already-running **local** Firestore emulator and `FIRESTORE_EMULATOR_HOST`. Without it, a skip is expected and must not be reported as a passed rules test.
- Public build output is only `dist/`; tests, server credentials, private code and this evidence directory are not runtime entrypoints. Rebuild after modifying widget sources; do not hand-edit generated chunks.
- This report records verification completed before the follow-up commit/push/pull-request publication. Work remains on the assigned branch; production deployment is **NOT VERIFIED**. No user-data migration or reset is required by these changes.
