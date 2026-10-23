# Verification report — 2026-10-23

This report distinguishes executed tests from provider setup and tests that did not execute. No live Google accounts, production Firebase credentials, Netlify deployment or production data were used.

## Actual results

| Check | Actual result |
|---|---|
| Pre-change `npm ci` / `npm test` | **PASS**, all 44 original test files, exit 0 |
| Post-change complete `npm test` | **PASS**, 44 original test files and 41 new cloud/auth test cases; exit 0, 136 seconds |
| `npm run build` | **PASS**, 108 widget scripts / 12 hashed chunks; safe `dist/`; browser Auth bundle about 162 KiB |
| `npm run test:cloud` | **PASS**, 41 Node test cases including mocked provider sessions, storage inventory, migration, isolation and concurrency |
| `npm run audit:storage` | **PASS**, 172 distinct constant keys resolved across 140 script inputs; all nonlocal keys covered; 173 explicit legacy-compatible keys plus audited dynamic families in the schema |
| `npm run test:browser` | **PASS**, real Linux Chromium 153 through Playwright; production runtime with test-only network-intercepted identities |
| `npm audit --audit-level=high` | **PASS**, zero vulnerabilities in the final installed dependency tree |
| `npm run test:rules` without a running emulator | **NOT EXECUTED: 1 skipped, 0 passed**, explicitly reported by the suite |
| Actual Firebase/Google provider sign-in / production deploy | **NOT RUN**, requires owner project, domains/consent, credentials and five real emails |
| GitHub Actions workflow | Written, **not observed running** in this session; it includes a Java-enabled real emulator run |

The final integrated run is recorded locally in ignored `final-tests.log`; focused output in `cloud-tests.log` and actual Chromium output in `chromium-tests.log`. These are generated evidence, not production assets.

The initial integration run exposed two regression assumptions: old backup tests expected insecure code-pairing behavior, and a cache-version test expected the existing `v2xx` naming convention. The backup test now checks the secure adapter/credential-exclusion contract, and the service-worker version is bumped compatibly. An initial headless test exposed a missing storage probe exclusion/migration marker; these are now audited explicitly. A deeper AST inventory added missing display/legacy keys. These are fixed results, not silently suppressed test failures.

## Coverage of the requested cases

1. **Five approved logins:** server and DOM controller tests loop over all five mocked verified Google identities. No production token bypass exists.
2. **Sixth rejection:** API denies reads/writes; deletion is unsupported/denied; DOM gate never unlocks and signs out the denied identity.
3. **Missing/invalid policy:** missing, disabled, 4/6 entries, duplicates, malformed/placeholder values and unavailable database all fail closed.
4. **Refresh restoration:** provider-session adapter plus cloud-first initialization restores previous UID data before runtime starts.
5. **Logout/protected routes/actions:** controller/Chromium tests hide/inert the protected root, clear active ownership and enforce sign-in.
6. **Isolation:** two UID namespaces, queues and file manifests; attempted UID/path targeting, cross-user reads/deletes/config changes rejected.
7. **Autosave:** all 173 audited local key strings round-trip unchanged; realistic representative datasets cover tasks, study, DSA/dev, CP, aptitude, placement, attendance/CGPA, exams/syllabus/revision, expenses/history, notes/wiki, achievements/streaks, projects/hackathons/certificates/social/water and preferences.
8. **Second device:** separate engine, DOM and independent Chromium/mobile browser contexts restore the same UID, records, completion state, history, files and theme.
9. **Ordering/history:** original IDs/null/missing dates/array positions preserved; UTC wrapper timestamps/version/sequence; deterministic tie sorting; tombstones/immutable historical versions.
10. **Migration/retry deduplication:** deterministic imports, interrupted/restarted queues, lost responses, ownership refusal, foreign tagged backups and SHA/count verification.
11. **Concurrent edits:** serializable mocked Firestore transactions admit one same-version writer; explicit cloud/local conflict choices retain copies; separate keys merge. The actual emulator transaction variant is written but not run here.
12. **Network/offline:** bounded 1/2/4/8-second retry schedule, five-attempt ceiling, retained queues, reconnect, and native synchronous write-ahead journal recovery when the asynchronous queue is not yet written.
13. **Direct database access:** production rules deny all clients; executable emulator tests cover direct read/write/delete/query/config-tampering for unauthed, approved and sixth accounts. **Real rule execution is still required.** Server API unauthorized attacks are actually tested and pass with mocked verified identities.
14. **Regression:** all 44 original feature suites; actual Chromium loads existing React and all 108 scripts, visits Learning/Expenses/Notes, and detects no uncaught runtime errors. Existing theme and storage tests remain intact.
15. **Configuration/credentials/errors:** no/invalid configuration locks access; revoked/invalid/unverified/non-Google identities fail; deployed emulator variables rejected; no raw private diagnostics; actual missing-config production entry tested in Chromium.

Additional targeted tests cover JSON/ZIP compatibility and real browser ZIP workers, stale ownership consent after an account change, retained/deduplicated recovery copies, native IDB overlapping abort/range/clear, concurrent internal/user transactions and quota rollback, service-worker API bypass/network-first/security upgrade reload, surrogate-safe large Unicode payload sharding, locale-independent fallback ordering/fingerprints, typed attachment-ID collision prevention, both binary attachment databases, integrity rejection, file deletion, receipt immutability and a lost-response-plus-newer-remote-edit edge case that previously could have left stale local UI.

## Chromium checks actually completed

- Unconfigured production entry remains locked; dashboard scripts do not execute.
- Authenticated production dashboard and all 108 widgets load with mocked approved identity.
- Writes are confirmed by the backend fixture, not just optimistically displayed.
- Native IndexedDB put → mutation marker → automatic upload → acknowledged manifest.
- Independent mobile context restores task IDs/completion, original notes history, exact file bytes and white theme; no horizontal overflow at 390×844, and the account control is not covered by the existing notification button.
- Native overlapping aborts leave no stale journal; range/clear upload tombstones; an independent browser restores the deleted-file state.
- Large JSON ZIP creation/extraction runs in actual Chromium workers and round-trips unchanged.
- Offline change is labelled offline, then acknowledged on reconnection without duplicate events.
- Logout locks protected pages.
- No uncaught Chromium page errors. Screenshots are ignored `.test-artifacts/` outputs, not production assets.

## Reproduce / remaining verification

Run the exact commands in [SECURE-SYNC.md](SECURE-SYNC.md). The test suite does not require production credentials. A real provider test does.

A Java 21+ machine with Firebase emulator download access must run:

```sh
npx --yes firebase-tools@15.1.0 emulators:exec --only firestore --project demo-arise-security "npm run test:rules"
```

This workspace has no Java/emulator and restricted outbound provider downloads. A skip above is deliberately not called a successful database-rule test. Resolve emulator and live-provider checks before production acceptance. Do not weaken production authorization to make them pass.
