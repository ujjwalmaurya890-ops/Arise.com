# Contributing

Thanks for taking the time to improve Arise. This guide is about how the code
expects to be changed. It complements the project goals and security rules in
[README.md](README.md).

## Before you start

- Node `>=22.22.0 <25`, then `npm ci`.
- `cp .env.example .env` only if you need cloud sync locally; an unconfigured
  checkout stays locked by design, and every test works without credentials.
- `npm run dev` builds `dist/` and serves it on <http://127.0.0.1:8123>.

## The change loop this repository expects

1. **Find the owner.** Every feature store has one owning module and one entry in
   `src/cloud/storage-schema.js` and `src/storage-keys.js`. Extend the existing
   widget that owns the data; do not create a parallel store, a second task
   manager or a second palette.
2. **Read the neighbouring contract.** Widgets mount through
   `window.__mountX(host)` (wrapped by `src/mount-safety.js`) or self-mount into
   the route stack. Look at how a neighbouring module finds its host, names its
   classes and cleans up before writing a new one.
3. **Keep it read-only unless it owns the key.** Analytics, the progress
   overview, the study horizon and the accessibility audit read other widgets'
   data and write nothing. Two writers for one number is how the study-time
   figures drifted apart in the first place.
4. **Write the regression first.** Every contribution in this repository ships
   with a `tests/test-*.cjs` file that fails before the change and passes after
   it. `npm test` runs all of them, including the cloud/auth/sync suite.
5. **Register new assets.** A new module goes into the ordered `SCRIPTS` list in
   `index.html` and into `scripts/tools/sw-extended-base.json` (the offline
   shell). A new stylesheet goes into the CSS list in `index.html` and the same
   offline list. `npm run build` regenerates the hashed chunks; never hand-edit
   `assets/chunks/*`.
6. **Check storage hygiene.** A new key means:
   `src/cloud/storage-schema.js` → `keys[]`, `src/storage-keys.js` (owner,
   description, sensitivity) and a clean `npm run audit:storage`.

## Definition of done

```bash
node tests/test-<your-feature>.cjs   # the new regression
npm test                             # all feature + cloud suites
npm run audit:storage                # storage hygiene
npm run build                        # production build, hashed chunks
npm run test:browser:ux              # loading and UX behaviour
npm run test:browser:engineering     # routes, modals, offline shell
```

If a browser or provider test cannot run in your environment, say so in the pull
request instead of leaving a failing check unmentioned.

## Style rules that are actually enforced by review

- **No images in the interface.** Draw logos, avatars and marks with text, CSS or
  inline SVG. The only tracked bitmaps are the PWA identity icons.
- **No raw colours or global component overrides.** Use the design tokens in
  `styles/theme.css`; scope new CSS to your own prefix so the other themes keep
  working.
- **Never swallow an exception silently.** Failure reporters, mount safety and the
  mutation bus all record what happened; a bare `catch {}` around a real failure
  is treated as a defect.
- **Do not block the page for a background failure.** One quiet, dismissible
  notice per incident — never a modal or a toast per failed chunk.
- **Respect the ordering contract.** Script order is behaviour, not an
  alphabetical list. Insert where dependencies already exist.
- **No new storage key without a reason.** Read-only views should have none.
- **Honest empty states.** Never invent sample data for a user who has not entered
  any; say "nothing logged yet" instead.

## Commit messages

`type(scope): imperative summary` — `feat(planner)`, `fix(analytics)`,
`perf(bus)`, `docs(readme)`. The body explains the measured problem, what
changed, and what was verified. Mention the test file and the command output.

## Reporting a bug

Include the shell version shown by the PWA status notice when relevant
(`arise-developer-system-v…`), the route, whether you were offline, and whether
`window.__ariseWidgetFailureReport.failures()` or
`window.AriseReliability.attempts()` listed anything.
