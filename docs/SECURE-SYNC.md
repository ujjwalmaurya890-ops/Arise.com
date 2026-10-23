# Secure Google login & cloud progress — deployment / operations

## Status and required owner actions

**Implemented in the repository, not activated against a live Firebase project.** Unconfigured deployments deliberately remain locked. No production project, Google consent configuration, five real emails, or private credentials were supplied or created. Do not treat mocked login tests as a real Google-provider test.

Completed: audit, Google Auth integration, server authorization, private exactly-five policy, Firestore persistence, account isolation, automatic saving/retry, offline recovery, conflict handling, consented migration, lossless file backup, UI integration, tests and safe build. See [audit](SECURE-SYNC-AUDIT.md), [storage mapping](SYNC-STORAGE-MAP.md), [test results](SECURE-SYNC-TESTS.md) and [exact changed files](SECURE-SYNC-CHANGES.md).

Before production, the owner must configure Firebase/Google/Netlify, deploy rules, insert five real approved emails, execute the real emulator suite and complete the two-device/provider checklist below. Legacy remote sync copies also need owner review; they are **not** deleted automatically.

## 1. Architecture and trust boundaries

```text
Existing React dashboard + vanilla widgets
   ├─ Firebase modular browser SDK: Google popup + provider-managed session
   ├─ UID-scoped compatibility storage / IndexedDB attachments
   └─ /api/cloud with Firebase ID token (relative, same-origin URL)
          └─ Netlify Function / Firebase Admin
                ├─ verifyIdToken(token, checkRevoked=true)
                ├─ verified email + google.com provider required
                ├─ read PRIVATE _config/access on every request
                └─ Firestore transactions under users/{verified UID}/...
```

- Existing Netlify hosting/functions and frontend are retained. The old Blobs endpoint was a public code-based snapshot service, **not** a secure account backend. It now returns HTTP 410 for every method. No Supabase integration was found. Firestore replaces insecure progress storage rather than running a competing sync database.
- The browser imports Firebase Auth, **not** a privileged database client. `firestore.rules` denies **all** direct client reads/writes, including approved users. Only the Admin API can access data. Admin SDK bypasses rules, so the server's identity, allowlist and UID checks are essential, not optional.
- The API never accepts a target UID/path from a client. Reads, manifests, chunks, writes, activity and deletes derive ownership from the verified token. A sixth Google account may be created by Firebase Authentication but receives no application access and is signed out by the gate.
- The five-email configuration is not bundled, returned by the API, or writable by any application user. Missing, unavailable, disabled, malformed, duplicate, fewer-than-five or more-than-five entries deny access. Placeholder `.invalid` emails are deliberately rejected.
- Only `trim().toLowerCase()` is used for email normalization. No Gmail dot/plus alias rewriting. Email identifies permission; **immutable Firebase UID** owns data. Do not delete/recreate an Auth user expecting its old UID to return.
- Server secrets live in Netlify Functions environment variables. The build publishes **`dist/`**, never the repository root, `.env`, functions, tests, owner configuration or `node_modules`.

## 2. Create/configure Firebase and Google (owner)

1. Open the Firebase Console, create a dedicated project, record its exact project ID. Enable required Google Cloud APIs if prompted. Choose an appropriate billing plan and set budget alerts; usage is not guaranteed free.
2. Project settings → General → Your apps → Web app → register Arise. Hosting is still Netlify; enabling Firebase Hosting is unnecessary. Copy `apiKey`, `authDomain`, `projectId`, `appId` from this web app's Firebase configuration. These identifiers are public, not service credentials.
3. Authentication → Sign-in method → enable **Google**. Set project public name/support email. Leave unused providers (anonymous, password, etc.) disabled.
4. In the linked Google Cloud project, open Google Auth Platform / OAuth consent configuration (menu names can vary). Configure branding, support/developer email and audience. For an external application in Testing, add the actual five accounts as OAuth test users; publish/verify the consent application if Google requires it for your intended use. Workspace-only Internal audience must include all five accounts. The app requests only Google's normal sign-in email/profile scopes, no Contacts or Drive permissions.
5. Firestore Database → Create database → **Native mode, Production mode**. Pick a region close to your Netlify function region; this choice is effectively permanent. Deploy this repository's deny-all rules before loading real data. Do not use test-mode/public rules.
6. Create a dedicated service account in Google Cloud IAM. Grant the least roles needed for this design: Firestore data read/write (`roles/datastore.user`) and Auth user read access for revocation/disabled checks (`roles/firebaseauth.viewer`). Do not grant project Owner/Editor just to make setup work. Use a separate administrative credential for other privileged owner work if appropriate.
7. Create/download a JSON key for that dedicated account **on your trusted machine only**. Store it in a password/secret manager. Never put it in `assets`, `src`, Git, backups or chat. This design uses a server key because Netlify is outside Google Cloud; use workload identity instead if you have independently configured supported federation.
8. Configure authorized domains/redirects as below. Set the server environment and five-account document. Deploy rules and site. Verify live provider login, revocation and cross-device behavior before announcing the rollout.

### Exact domains and callbacks

Firebase Authentication → Settings → Authorized domains: add the hostnames actually serving this app (no scheme, path or port):

| Hostname | When to add |
|---|---|
| `arisexcse.netlify.app` | Existing deployment named in this repository's README; confirm your Netlify site's actual domain |
| `arise.com` | Only after you own it and connect it to this Netlify site |
| `www.arise.com` | Only if this host also serves/redirects to the same owned application |
| `localhost` | Local development; new Firebase projects may not include this by default |
| `YOUR_PROJECT_ID.firebaseapp.com` | Default Firebase auth helper domain (normally already present) |

In the Google OAuth **Web** client used by the Firebase Google provider (Google Cloud → APIs & Services / Credentials), keep/add:

- Authorized redirect URI: **`https://YOUR_PROJECT_ID.firebaseapp.com/__/auth/handler`** (substitute your actual Firebase `authDomain` if you deliberately configure a different supported auth domain).
- Authorized JavaScript origins for each actual frontend origin: `https://arisexcse.netlify.app`, `https://arise.com`, `https://www.arise.com`, and development `http://localhost:8123` as applicable. Include `https://YOUR_PROJECT_ID.firebaseapp.com` for the auth helper. Do not enter wildcards, paths or unowned origins.
- This app uses `signInWithPopup`; there is **no `/auth/callback` or Netlify OAuth callback route**. Firebase's helper handles the provider callback. No Google client secret goes in the browser.
- For an Arena preview, authorize its **exact displayed hostname/origin** only if testing against your provider project. The live hostname is `https://8123-<sandbox-id>.e2b.app`; copy the real value from your preview, do not literally enter a placeholder or `*.e2b.app`. Google may block sign-in in an embedded/third-party context: open a full browser tab and allow pop-ups. Prefer a separate development Firebase project rather than broadly permitting production previews.
- Keep the default `YOUR_PROJECT_ID.firebaseapp.com` authDomain on Netlify. Simply setting authDomain to a custom Netlify host without implementing Firebase's auth-helper hosting/proxy requirements will break login.

## 3. Environment variables

Copy [`.env.example`](../.env.example) to `.env` locally. All examples contain placeholders only. Never commit `.env` or the downloaded service-account file.

| Variable | Visibility / purpose |
|---|---|
| `FIREBASE_WEB_API_KEY` | Public Firebase web API identifier; not an authorization secret |
| `FIREBASE_AUTH_DOMAIN` | Public, usually `YOUR_PROJECT_ID.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | Public project identifier; must match service-account `project_id` |
| `FIREBASE_WEB_APP_ID` | Public registered web app ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **Server-only secret**, the full JSON as a single environment value |
| `ANTHROPIC_API_KEY` | Existing optional AI integration, **server only**; AI calls now also require approval |
| `PORT` | Optional local server port (default 8123) |
| `AWS_LAMBDA_JS_RUNTIME` | Set `nodejs22.x` in Netlify if its function-runtime settings require an explicit Node 22 selection |

The service-account `private_key` must retain its JSON `\n` escapes. Use a proper JSON minifier/secret manager, not manual removal of escapes. In `.env`, use a single-quoted JSON value as shown. In the Netlify UI paste the JSON **without shell quote characters**. Give the four public settings and the service secret **Functions** scope; builds do not need credentials because the browser fetches only explicitly selected public identifiers from `/api/public-config` at runtime. Do not add a `PUBLIC_`/`VITE_` prefix to the server secret.

Do not set `FIREBASE_AUTH_EMULATOR_HOST` or `FIRESTORE_EMULATOR_HOST` in deployed functions. Production services explicitly refuse them. Emulator tests use a separate dependency-injected test handler, not an unsigned-token bypass in production.

## 4. Configure exactly five approved emails

### Preferred: owner script (no frontend rebuild/redeploy required)

1. Copy `config/approved-users.example.json` to **`config/approved-users.json`** (ignored by Git).
2. Replace all five `.invalid` placeholders with five **distinct actual verified Google emails**. Keep `enabled: true`. Entries are normalized on validation; use lowercase for readability.
3. In a trusted local shell, configure `.env` with the confirmed project's server credential, then run:

```sh
npm run configure:access -- config/approved-users.json --project YOUR_PROJECT_ID
# Dry-run validation only; prints no emails or secrets.
npm run configure:access -- config/approved-users.json --project YOUR_PROJECT_ID --apply
```

The script validates first, requires explicit project confirmation and writes the private document **`_config/access`** atomically with `enabled`, `approvedEmails`, `schemaVersion`, `updatedAt`. The example intentionally fails validation until all five entries are replaced. Do not publish the real JSON file.

### Console alternative / updates / emergency lock

As a project administrator, edit Firestore `_config/access` with fields:

- `enabled` boolean `true`
- `approvedEmails` array of **exactly five strings**
- Optional `schemaVersion` number `1`, `updatedAt` timestamp

Replace the whole five-element array in one saved edit. Do not create a client-writable `users/{uid}.approved` flag. Every API call rechecks the document; transaction commits recheck it inside the transaction as well. No cached custom claims or frontend rebuild are involved. To remove one person, replace their entry with the next explicitly approved Google email. Their old UID data remains retained but inaccessible to them; it does not transfer to the replacement person.

For an emergency lock set `enabled=false`. All protected requests then fail closed. To revoke a compromised session also disable the user or revoke refresh tokens through trusted Firebase administration. Other devices' local offline copies cannot be remotely erased; server access remains denied and the UI locks when it next checks online.

## 5. Installation, development, build and deployment

Use **Node 22.22+** (or supported Node 24), npm and Git. The exact baseline here is Node 22.22.3. All commands run from the repository root. Existing React source is prebuilt; `npm run build` builds the Auth integration and safely stages the existing app/widgets, not a nonexistent Vite project.

```sh
npm ci
# Linux/macOS:
cp .env.example .env
cp config/approved-users.example.json config/approved-users.json
# Windows PowerShell equivalents:
# Copy-Item .env.example .env
# Copy-Item config/approved-users.example.json config/approved-users.json
# Edit the copied files privately before attempting real login.

npm run dev          # builds dist, then static + Netlify-function-compatible server
# Open http://localhost:8123
npm run build        # reproducible dist/ build, no privileged files published
npm start            # serve an already-built dist/, with the same-origin local API
npm test             # all 44 existing suites + cloud/auth tests
npm run test:cloud   # focused mocked-identity / storage / concurrency tests
npm run audit:storage # native/wrapper key coverage; review documented dynamic keys
npm audit --audit-level=high
```

The local server binds `0.0.0.0` and accepts preview hosts; browser API calls are relative. It does not bypass production identity verification. Without real configuration it shows a setup-required gate, not a fake logged-in demo.

### Real Firestore Emulator rules tests (required before production)

Install Java 21+ and ensure `java -version` succeeds. No production credentials are needed:

```sh
npx --yes firebase-tools@15.1.0 emulators:exec --only firestore --project demo-arise-security "npm run test:rules"
```

The `demo-` project protects against accidentally targeting production. The suite tests actual deny-all rules for unauthenticated, approved and unapproved clients, direct/cross-user reads/writes/deletes, config tampering, plus real Admin transaction CAS behind mocked verified identities. `npm run test:rules` alone explicitly **skips** if no emulator is running; a skip is not a pass. This sandbox had no Java/emulator and restricted provider-download access, so this test has not been executed here. A GitHub Actions workflow is included to run it on a Java-enabled runner; that workflow has not been observed running in this session.

### Real Chromium smoke test

In terminal 1 run `npm run dev`; in terminal 2 run:

```sh
npm run test:browser
```

The driver uses Playwright network interception to inject mocked identities only in its own browser. There is no test-login switch in the production app. On Linux it uses the packaged Chromium binary and its bundled NSS libraries. For another OS supply an installed Chrome/Chromium via `CHROMIUM_PATH` (bash: `CHROMIUM_PATH=/path/to/chrome npm run test:browser`; PowerShell: `$env:CHROMIUM_PATH='C:\path\chrome.exe'; npm run test:browser`). The Linux packaged browser is not a Windows binary. Optionally set `ARISE_TEST_URL` to a running local test server. Screenshots are ignored artifacts in `.test-artifacts/`.

### Firebase rules / Netlify production deployment

```sh
npx --yes firebase-tools@15.1.0 login
npx --yes firebase-tools@15.1.0 deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID

npx --yes netlify-cli@27.14.2 login
npx --yes netlify-cli@27.14.2 link   # choose the existing Arise site, not a second unrelated site
npm run build
npx --yes netlify-cli@27.14.2 deploy --dir=dist --functions=netlify/functions
# Validate the draft/provider-authorized hostname, then:
npx --yes netlify-cli@27.14.2 deploy --dir=dist --functions=netlify/functions --prod
```

Before deploying, set Netlify environment values in Site configuration → Environment variables (Functions scope), confirm Node 22 function runtime and publish `dist`, deploy the deny-all Firestore rules and create `_config/access`. Git-connected Netlify builds use `netlify.toml`: build `npm run build`, publish `dist`, functions `netlify/functions`. A production environment-value change may require a new Netlify deployment; **email-policy updates in Firestore do not**. Use the established Git/PR deployment policy for the site; this implementation does not push or publish automatically.

Confirm `/api/public-config` returns only public identifiers, `/api/cloud` without authorization fails, `/api/sync?code=anything` returns 410, and server/private source URLs never return source content. Do not configure Netlify to publish `.` again.

## 6. Actual Firestore schema

No invented feature-specific collections. The compatibility schema covers **173 audited local keys**, dynamic `arise-widget-nav-*` keys and the two real attachment databases. Each logical legacy store stays in its existing string/JSON format, including nested record IDs, arrays, dates, settings and histories. See the complete key-by-key [mapping](SYNC-STORAGE-MAP.md).

| Document path | Fields / purpose |
|---|---|
| `_config/access` | Private five-account permission policy; no application client access |
| `users/{uid}` | `uid`, verified profile `{uid,email,name,photoURL,emailVerified}`, `schemaVersion`, monotonic `sequence`, server `createdAt/updatedAt` |
| `users/{uid}/records/{sha256(logicalKey)}` | Stable wrapper ID/key, schema version, optimistic `version`, global user `sequence`, server creation/update/import time, original event time (or null), digest, deleted flag, immutable payload pointer, optional attachment manifest |
| `users/{uid}/payloads/{operationId}` | Immutable historical version manifest, digest, part count or file manifest, deletion state, server creation time |
| `.../payloads/{operationId}/parts/{index}` | Ordered UTF-8-safe pieces of the **unaltered legacy string** (index explicitly stored) |
| `users/{uid}/operations/{operationId}` | Immutable idempotency receipt, request digest, accepted version/sequence/server time |
| `users/{uid}/activity/{operationId}` | Append-only change/migration/restore/delete event, stable ID, key, version, sequence, payload pointer, server capture time, original event time, migration fingerprint |
| `users/{uid}/uploads/{operationId}/chunks/{index}` | Immutable file chunks, index, base64 data, digest/byte count, staged time; published only by an integrity-verified versioned file manifest |

Profile preferences are the existing `appSettings` store; display/themes/personalization use their actual audited keys. Tasks/completions, study goals/sessions/streaks, DSA/dev/CP/aptitude/placement, academics/exams/revision, expenses/history, projects/hackathons, notes/wiki/skills/certificates/social/water, achievements and analytics retain their existing formats, not parallel replacement models. No Google password, Google access token or unnecessary OAuth token is stored in application records. Firebase's own provider-managed session store is excluded from every backup/migration.

Attachment logical keys use an unambiguous base64url encoding of the typed original ID. Stored file metadata/IDs/upload dates are preserved. Binary bodies use 192 KiB chunks, full-file integrity validation and per-chunk validation on restore. The existing 250 MiB local attachment ceiling is retained (large uploads can be slow/costly). Old versions/orphaned staging chunks are retained, not silently purged.

## 7. Ordering, synchronization and conflict policy

- Every stored wrapper has a stable ID, version, server `createdAt/updatedAt` and monotonic per-user sequence. Existing nested `id`, `createdAt`, `updatedAt`, `completedAt`, `date`, etc. are preserved exactly. New core task/DSA/dev completion actions add actual UTC update/completion times.
- Array positions are the explicit authoritative legacy ordering; no database enumeration order is used to reorder them. Map keys are not treated as recovered chronological history. State/activity queries order by stored sequence; ties sort by stable ID. File chunks/parts order by numeric index.
- Original missing historical timestamps remain missing/null. Migration/import time is separate (`importedAt`, `type=migration`, `originalEventAt=null`). A migration's upload sequence is **not** claimed to be the original historical sequence. Anonymous legacy items without IDs are preserved within their atomic store/array, not assigned fabricated historical identities.
- Each meaningful storage mutation is queued with a unique operation ID and captured event time. A short 400 ms debounce starts background saving but does not combine distinct queued actions into one. Same-value writes are ignored. The server appends one event per accepted operation; retried/lost responses reuse the same receipt and create no duplicates.
- A transaction accepts a write only if its base version equals the current version. Two devices changing **different stores** do not conflict. Two devices changing the **same legacy store** require an explicit choice; there is no unsafe last-writer-wins or guessed merge of arrays/counters.
- Conflict UI allows downloading a backup, using cloud or explicitly keeping this device's version. A local conflict copy and previous immutable cloud payloads are retained. Keeping local rebases on the latest version with fresh operation IDs; another concurrent write can conflict again. Choosing cloud drops only the reviewed pending store operations, not unrelated pending work.
- Deletions are versioned tombstones, not physical history deletion. Edits/repeated actions append versions. Existing feature histories may have local caps; the cloud operation history preserves each acknowledged stored version, not unsaved clicks that never reached browser persistence.
- The UI says **Saved only after database acknowledgment**, never after dispatch alone. Transient failures retry at 1, 2, 4, 8 seconds (five attempts total); pending writes remain after the bound. Retry/reconnection can resume. 401/403 or unavailable access policy stops sync and locks the gate.
- Foreground devices poll every 20 seconds, and revalidate on focus/connectivity events. Cloud changes trigger a refresh when not editing; otherwise the status requests a safe refresh. A stale in-memory UI never gets an updated base version with permission to overwrite new data silently.
- Writes are queued in UID-scoped IndexedDB immediately. A small **synchronous write-ahead journal** also protects the latest localStorage mutation if a tab closes before the async queue transaction finishes. File writes/deletes, range deletes and clear have recovery markers; aborted or synchronously rejected native operations do not become replay writes. If a required marker cannot be stored, the IndexedDB operation aborts instead of committing an untracked deletion. Replays retain original IDs and versions; stale journals produce conflicts, not overwrite permission.
- Visibility/pagehide trigger best-effort flush; small hidden-page writes use fetch keepalive when supported. Ordinary debounced saving and durable recovery—not beforeunload—provide reliability. A tab cannot guarantee a network save while being killed; pending status is honest about that.

## 8. Offline and account isolation

Offline editing is supported **after an approved session has been restored online**. Pending writes are tied to the UID and survive refresh/sign-out on that browser. Cold-start login/restore while offline stays locked (no cached allowlist authorization). A different account never replays the previous account's queue. Sign-out locks the UI immediately; if writes remain, the user explicitly chooses whether to stay or retain pending work locally. Another device cannot restore unacknowledged offline changes.

One writable tab per UID/origin uses the browser Web Locks API. Close the other tab and retry if it already owns the lock. A current HTTPS browser with IndexedDB, Web Crypto and Web Locks is required. Distinct devices/accounts remain independent. Private browsing/storage quotas/browser eviction are not cloud guarantees; avoid clearing site data with a pending queue.

UID-scoped localStorage names are `arise:account:{encodedUID}:{encodedLegacyKey}`; known attachment databases are `arise-account-{encodedUID}--{legacyDBName}`. The recovery vault is `arise-secure-sync-v1`. Original unscoped storage is not presented as another account's data. Local caches are **not encrypted at rest**: someone controlling the same OS/browser profile or running same-origin malicious JavaScript can inspect local bytes. This is not a substitute for separate OS/browser profiles on a shared machine. Backend isolation remains enforced regardless of any frontend flag or manipulated cache.

## 9. Migration, backup and recovery

1. On the original browser, do not clear storage. The signed-in identity must be approved **before** the app reads/imports legacy progress through the UI.
2. Only audited local keys and the two known app databases are eligible for import. Unknown noncredential stores are retained as local-only backup data, not silently uploaded. Provider/session databases, Gist tokens, pairing codes, arbitrary credentials and browser-only performance probes are excluded.
3. Before any import, the browser stores a lossless original snapshot in the recovery vault; source localStorage/IndexedDB remains intact. Download a recovery file as an additional independent backup.
4. The user confirms that the existing data belongs to the displayed verified account. “Not mine / keep separate” restores only their cloud data, keeps the backup and does not upload legacy records. A browser's claimed migration is tied to that UID; another account cannot inherit it.
5. If cloud progress exists, explicitly choose missing stores only (default safe choice) or replacement of matching stores with another confirmation. This is **store-level**, not a speculative union that could duplicate records. Skipped/conflicting/unsupported stores remain in the recovery copy and are reported.
6. Deterministic migration operation IDs/fingerprint, persisted pending writes and immutable receipts make interruption/retry idempotent. Every expected imported string is verified by cloud digest; file bodies and metadata are verified; store/attachment counts and skipped keys are recorded in a migration report. No source clearing occurs after success either.
7. A paused import resumes on the **same account/browser** after reconnection. Do not change accounts to “fix” it, clear the queue or delete the recovery vault. Resolve reviewed same-store conflicts, then retry/refresh. Download both current and original recovery files from the account menu/Backup Center.
8. Manual Backup Center restore checks `meta.ownerUid`, asks ownership confirmation, keeps a before-restore/source backup and routes all writes through the same versioned engine. Exported v2 JSON preserves Blob bodies using tagged base64; ZIP export/import wraps the same JSON using the small bundled `fflate` codec, without an external global/CDN library. Archive import reads only `backup.json`, never filesystem paths. JSON/ZIP imports and the uncompressed ZIP JSON are capped at 512 MiB. Another user's tagged backup is rejected, not merged.

Recovery snapshots are content-addressed in `arise-secure-sync-v1` under `recovery:{uid}:{fingerprint}` and indexed by `recovery-index:{uid}`; identical content is not copied repeatedly. Distinct earlier startup/manual-restore copies are retained, not overwritten by the next refresh. In Backup Center, select a date/store count and **Download previous device snapshot**. The archive is scoped to the active UID; filenames/capture dates are not original event timestamps. Legacy source and conflict copies are also retained. No automatic deletion/garbage collection is performed. Large histories/files or many distinct recovery copies can fill IndexedDB; export them and ask the owner for an explicit verified retention plan rather than silently purging browser data.

**Old backup limitation:** the old generic exporter serialized Blob values as `{}`. Missing bytes cannot be reconstructed from that JSON. Such attachment imports are rejected with a recovery instruction; use the original browser's new export. Do not invent bytes or historical timestamps. Unsupported legacy databases remain outside automatic import; preserve the original browser/file.

**Quota / size recovery:** legacy localStorage plus the new account cache can exceed browser quota, especially when years of records already nearly fill it. Migration pauses rather than deleting originals. Download the original v2 backup, retain the original browser unchanged, and use a fresh browser profile with the same approved Google account to restore it after verifying ownership. The current API limits one serialized localStorage store to **4 MiB UTF-8**, a JSON request to **5 MiB** (before the platform's own limit), and files to 250 MiB. Oversized stores/pending writes remain local with a failure state; split/reduce a backed-up store with owner/developer assistance rather than clearing it. This is a documented remaining capacity limit, not an unlimited-data claim.

### Rollback

- Emergency: set `_config/access.enabled=false`; do not loosen rules or revive `/api/sync`.
- Export Firestore using trusted Google Cloud backup/export tools and download user recovery files before a schema change. Exports can contain private data; store them outside Git.
- Prefer a fix-forward deployment or roll back only to another **secure** deployment using this schema. Never roll back to the unauthenticated shared-code function or root-directory publishing.
- Per-store edits/deletes retain previous payloads and activity references. An administrator can inspect those private versions or restore a verified user backup through the account UI; clients cannot mutate historical events. There is no automatic whole-account time-travel UI/hard-delete tool in this change.
- Original local data is retained. If a rollout fails, keep its browser and recovery vault intact; do not click “clear all site data”. For stale assets, unregister the service worker / clear **Cache Storage only**, then reload. Do not delete localStorage or IndexedDB to repair an asset cache.

## 10. Production security checklist

- [ ] Correct project, Google provider/consent audience, owned origins and Firebase helper callback.
- [ ] Exact five real verified accounts, no `.invalid` placeholder; missing/invalid/disabled policy tested.
- [ ] Deny-all Firestore rules deployed **before** real data; actual emulator suite passed on a Java-enabled machine.
- [ ] Admin credential server-only, least privilege, Functions-scoped; key rotation plan and secret scan completed.
- [ ] Node 22 runtime; locked dependencies installed with `npm ci`; audit reviewed. Compatibility overrides pin supported Firebase app/compat versions for Node 22 and patched gRPC 1.14.6, not an obsolete Firebase downgrade.
- [ ] Publish `dist` only. `/api/cloud` and AI require identity. No wildcard CORS; API responses are no-store. Service worker bypasses APIs/functions and refreshes security scripts network-first. Activating over a pre-security app cache reloads controlled pages into the new gate, without touching localStorage/IndexedDB.
- [ ] Sixth account, unverified/non-Google identity, revoked token and cross-user direct/API attempts denied in the live environment.
- [ ] Legacy Netlify Blobs archived/restricted by the owner. Review/delete old immutable Netlify deploys that could still serve the **old** public sync function; retiring the new endpoint alone cannot rewrite historic deploy URLs. Removing cloud copies is an owner-approved destructive operation, not performed here.
- [ ] Previously browser-stored Gist PATs revoked/rotated through their provider. Original tokens are not exported or used by the new app, but retaining an old browser does not revoke a leaked token. Archive/remove legacy Gist snapshots and browser credential keys only after owner backup/approval.
- [ ] Firestore/Netlify quotas, large-file costs, staging/history retention and budget alerts set. Old versions/staged files intentionally have no automatic destructive cleanup.
- [ ] Existing app HTML/note rendering and the broader third-party dependency surface receive the normal application XSS/security review. This change is not a claim to eliminate every pre-existing frontend vulnerability or encrypt all local caches.
- [ ] Backup ownership, quota recovery, sign-out with pending work and rollback rehearsed. No “saved” indicator while offline/pending/failed.

## 11. Manual provider / two-device acceptance checklist

Use separate real browsers/devices, not two tabs competing for the same local Web Lock.

1. Sign in with each of the five approved Google accounts. Confirm name/photo/verified email. Cancel the popup and retry; try a popup-blocked/unauthorized development domain and verify a helpful error.
2. Use a sixth Google account. It must see access denied and cannot retrieve `/api/cloud`, file chunks, activity, direct Firestore records or config—even if Firebase sign-in succeeds.
3. Disable/remove the policy in a controlled maintenance window, then restore all five entries. Verify fail-closed behavior and immediate server rejection of a removed user's existing token. Disable/revoke a test Auth user and confirm session lock.
4. On Device A, create/update records in tasks/daily goals, study sessions/streaks, DSA/dev progress, CP/aptitude/placement, academics/attendance/CGPA, exams/revision/syllabus, expenses/history, notes/wiki, achievements/projects/hackathons/certificates/social/water and preferences. Attach a real file to each supported file database. Wait for **Saved**.
5. Close/refresh A: session restores appropriately; logout locks the app. Sign into the same Google account on B: IDs, counts, completion states, amounts, file bytes, timestamps, theme and original list order match. No fresh empty profile replaces old cloud data.
6. Sign in as a different approved person on the same browser and on B. No previous person's notes, files, cached UI or pending writes may appear as theirs. Try importing their tagged backup: it must be rejected.
7. Edit two different stores simultaneously on A/B; both save. Edit the same store; review the explicit conflict, download the backup, test both cloud/local choices and verify old versions remain recoverable. Repeat with a lost network response/retry.
8. Disconnect A after online restore. Change progress and a file; status is Offline, not Saved. Reconnect and wait for confirmation, then check B. Cold start while offline stays locked. Signing out with pending work must disclose that B cannot see it yet.
9. On an old browser with known records, confirm ownership, interrupt/reconnect migration and repeat. Verify no duplicate IDs/events, exact old dates/order where present, null/missing event times remain honest, store counts/digests pass and original data/backups still exist. Test refusal/ambiguous ownership and existing-cloud conflict choices.
10. Run mobile/keyboard/light/dark/custom-theme checks, Backup Center JSON/ZIP restore, older recovery-copy export, abort/range/clear file operations and missing-configuration errors. Check browser console and provider logs without logging credentials.

## 12. Known limits / nonclaims

- Live Google login, real project IAM/deployment and production data migration cannot be verified without the owner's configuration; they have **not** been claimed complete.
- Real Firestore emulator rules/transaction tests are provided and CI is configured, but this sandbox run skipped them. Finish that verification before production.
- Conflicts are per legacy store, not automatic per-note/per-task merging. UI refresh is used for remote changes because many existing widgets cache their state internally.
- Storage size/quota limits, browser eviction and long large-file uploads apply. Persisted offline writes are not cloud writes until acknowledged. Local device compromise/offline revocation cannot be solved by a server allowlist.
- Original histories with no timestamps/IDs or already-pruned old events cannot be recovered. The new append-only log records observed persisted changes, not a fabricated past clickstream.
- No generic browser-database upload, hard-delete/account-transfer tool, scheduled history/staging cleanup, or unbounded high-scale attachment service was added. Cloud history is retained for safe recovery; set an explicit owner retention policy before any future purge.

### Official references

- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/auth/web/auth-state-persistence
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/auth/admin/manage-sessions
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/security/test-rules-emulator
- https://firebase.google.com/docs/admin/setup
- https://github.com/firebase/quickstart-js/blob/master/auth/google-popup.ts
- https://github.com/firebase/firebase-admin-node
- https://docs.netlify.com/build/functions/overview/

SDK interfaces were checked against current official Firebase SDK repositories and installed compatible versions; the Node-24-only Firebase 13 line was not used in this Node 22 project.
