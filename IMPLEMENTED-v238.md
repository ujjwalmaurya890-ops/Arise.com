# v238 — Tier 1 performance changes (implemented)

Scope agreed: **zero behavior change** to any widget, storage key, mount contract or
feature. Files touched: `netlify.toml`, `_headers` (new), `service-worker.js`,
`index.html`, `tools/build-widget-chunks.cjs`, `test-widget-chunks.cjs`,
`test-chunk-priority-loader.js` (new).

---

## 1. Cache headers for subdirectory assets — `netlify.toml` + `_headers`

`/*.js` and `/*.css` never reached `assets/` or `features/` (Netlify's header globs
have **no `**` notation** and `*` does not cross `/`), so ~150 files — including
`assets/app-bundle.js` (1,047 KB raw / ~295 KB gz) and all 12 widget chunks — were
served with Netlify's default `max-age=0, must-revalidate`.

| path | before | after |
|---|---|---|
| `/assets/chunks/*` | default, revalidate | `max-age=31536000, immutable` (filenames already carry a sha1) |
| `/assets/*.js`, `/assets/*.css` | default, revalidate | `max-age=60, must-revalidate` |
| `/assets/*.png`, `/assets/*.svg` | default, revalidate | `max-age=604800, must-revalidate` |
| `/features/*/*.{js,css,json}` | default, revalidate | `max-age=60, must-revalidate` |
| `/*.json` | default, revalidate | `max-age=60, must-revalidate` |

Everything un-hashed keeps the same short revalidating policy already used at the root,
so a new deploy is still picked up on the next navigation. Mirrored into `_headers`
because the two are read independently and `_headers` survives some base-dir setups.

## 2. Service-worker cache fill — `service-worker.js`

`fillExtendedCache()` was 153 **sequential** fetches with a hardcoded `setTimeout(400)`
sleep between each → ~61 s of background work after every deploy (and after every visit
that found a hole).

Now: **4 in flight** with a 100 ms gap between waves, same entries, same
`fetch(cache:"no-cache")` → `cache.put()` semantics, same "bail after 5 consecutive
failures" guard, plus a `saveData` short-circuit and a `self.__ariseCacheFill`
progress counter for measurement.

Verified in a `vm` sandbox with the real SW source: `done 124/124, failed 0`;
`saveData: true` → `fetches 0, skipped 124`.

**Deliberately *not* changed:** the 99 source files that duplicate chunk contents
(2.46 MB). `tools/build-widget-chunks.cjs` builds that list from
`tools/sw-extended-base.json` on purpose — the comment calls it "the offline fallback"
— so it stays. Only the *scheduling* was pathological.

## 3. `app-bundle.js` priority hint — `index.html`

```html
<link rel="modulepreload" crossorigin href="./assets/app-bundle.js" />
```
No preload existed for the single largest critical file, and as a `type="module"`
script placed after three render-blocking stylesheets it could not start downloading
early. `crossorigin` matches the `<script>` attribute so the preload is consumed, not
duplicated. `modulepreload` is ignored by browsers that don't support it.

## 4. Two-phase chunk loading — `index.html` loader

`startLazyLoad` now loads `CHUNK_PRIORITY` (an **ordered prefix** — `w01`+`w02`, the
chunks holding the dashboard's own widgets) and defers the remaining 10 chunks until
either the priority phase finishes **and** an idle window arrives (`4 s` fallback
timer), or the user interacts.

| | before | after (dashboard-only visit) |
|---|---|---|
| widget JS before the fold | 12 chunks, 2,542 KB raw / 661 KB gz | 2 chunks, 368 KB raw / 102 KB gz |
| deferred | — | 10 chunks, 2,174 KB raw / **560 KB gz**, low-priority pre-warm |

A dashboard-only visitor therefore no longer pulls **85% of the widget JS transfer**
onto the early path; the bytes still arrive, just at idle or on first interaction.

**Behavior-preserving details** (each is asserted by
`test-chunk-priority-loader.js`):
- `finish()` is gated per phase, so `__ariseWidgetsReady`, the mount-stub replay,
  `arise:widgets-ready` and the SW fill request fire **only after the last phase**.
  Without this, a section opened during the 4 s window would have rendered as a
  permanent empty shell — this was caught by the new test and fixed.
- Execution order of the two phases concatenated is still exactly `CHUNKS`, so every
  `__mountX` and "redefine the same global" ordering contract holds.
- The chunk's own `prewarm()` was hoisted to IIFE scope so the phase-1 callback can
  reach it (it previously threw `ReferenceError` inside the `try/catch`, silently
  killing the deferred timer — also caught by the new test).
- Escape hatches: `?chunkPriority=0` or `localStorage['arise-chunk-priority']='off'`
  restore the single-phase load; `CHUNK_PRIORITY = []` disables the split; the
  un-chunked `?chunks=0` fallback path ignores the split entirely.

`tools/build-widget-chunks.cjs` now regenerates `CHUNK_PRIORITY` (first
`PRIORITY_CHUNK_COUNT = 2` chunks) inside the `/*CHUNKS:START…END*/` block.
Re-running the build is **idempotent**: regenerated chunks are byte-identical to the
shipped ones.

---

## Tests

- `test-widget-chunks.cjs` — 51 → **57 passed, 0 failed**
  (relaxed one regex to tolerate the new generated var; added prefix/coverage guards
  and a `modulepreload` assertion). It prints:
  `first phase 368 KB, deferred 2174 KB (86% of the widget payload moves behind the fold)`.
- `test-chunk-priority-loader.js` — new, **17 passed, 0 failed**. Runs the real loader
  source from `index.html` in a deterministic fake-clock sandbox.
- `test-cross-browser-compat.cjs` 11/11, `test-widget-nav-lazy-panels.js` 37/37,
  `test-backup-secrets.cjs` 11/11, `test-learning-page-tabs.js` 63/63,
  `test-placement-engine.js` 171/171 — all still green.
- Full suite compared against an untouched copy of `v237`: **identical output**,
  including the pre-existing `test-aptitude-practice.js` (32/1) failure and the
  non-reporting `test-storage-watch-bus.js` / `test-hackathon-*` suites. Nothing here
  introduced or fixed those.

## Still open
- **Not measurable in this sandbox:** no Chrome/Chromium and the font CDN is not
  reachable, so there is no traced FCP/LCP/INP delta — the numbers above are byte
  counts and simulated clock/driver results. Measure in a real browser before/after.
- Recharts is still inside the 1 MB `app-bundle.js` (`import()` count: 0) — the split
  there needs a rebuild of the React bundle, which is not in this tree.
- Tier 2 (observer scope, `storage-watch-bus` polling, event delegation, fragment
  batching) and the `dev-*`/`dsa-*` twin merge are untouched.
- `test-storage-watch-bus.js` reports nothing on either copy — worth a look on its own.

---

## Follow-ups added while testing this

- `serve.mjs` now derives `Cache-Control` from a `cacheControlFor()` mirror of the
  Netlify rules, so the policy is inspectable in devtools locally, and it listens on
  `0.0.0.0`. Verified against the running server:

  | path | served header |
  |---|---|
  | `/index.html`, `/service-worker.js` | `no-cache, no-store, must-revalidate` |
  | `/assets/chunks/w07.10bf55fc.js` | `public, max-age=31536000, immutable` |
  | `/assets/app-bundle.js` | `public, max-age=60, must-revalidate` |
  | `/features/exam-tracker/exam-tracker.css` | `public, max-age=60, must-revalidate` |
  | `/interview_sheets_data.json` | `public, max-age=60, must-revalidate` |

- New `test-cache-policy.cjs` (**34 passed, 0 failed**) walks the real deploy tree and
  asserts, for all 150 shipped `.js/.css/.json/.png/.svg` files, that (a) a rule exists
  in `netlify.toml`, (b) the same rule exists in `_headers`, (c) the two agree,
  (d) hashed chunks are immutable, (e) `index.html`/`service-worker.js` stay no-store,
  and (f) nothing un-hashed is pinned longer than a week. It caught three real gaps
  during this change: root `/*.mjs` was uncovered, `_headers` had no root `/*.js` rule
  (so `/service-worker.js` fell through to `/*.js` with no `no-store` override), and
  the initial `/*.css`/`/*.json` mirror was missing.
- `.gitignore` for `node_modules/` and the `_run-test.cjs` `.cjs.cjs` temp copies.

---

# v238b — Tier 2 (runtime cost)

Same rule: no widget, storage key or mount contract changes. Files touched:
`storage-watch-bus.js`, `animation-upgrade.js`, `index.html`, `service-worker.js`
(`CACHE_NAME` bump), regenerated `assets/chunks/*`, plus two new tests and
`perf-probe.js`.

## 5. `animation-upgrade.js` now respects `perf-lite`

`index.html` sets `.perf-lite` synchronously for Brave / ≤4-core / ≤4 GB / saveData
devices, and the inline `.perf-lite` CSS already kills `will-change`,
`backdrop-filter` and infinite loops — but it cannot stop this *script*, which kept
running a `documentElement` `MutationObserver`, two full-document
`[class*="-card"]`/`[class*="-row"]` `querySelectorAll` passes and a
`getBoundingClientRect()` per candidate, forever, on exactly the hardware that can
least afford it.

Gated: on `perf-lite` the reveal pipeline never starts (no observer, no scans, no IO
registrations). Only the entrance animation disappears — `.uxa-reveal{opacity:0}` is
never added, so nothing can end up invisible. The click ripple is deliberately **kept**
(it is bounded per user action, not per DOM mutation, and is touch feedback).
Escape hatch: `localStorage['arise-anim-reveal']='on'` restores it.

`test-animation-lite-mode.js` — **14 passed**: normal device gets 1 `observe()` + 6 IO
registrations + 6 revealed cards; `perf-lite` gets **0 `observe()` calls** and 0 reveal
classes; the escape hatch, the `prefers-reduced-motion` early return and "30 late-added
cards cost nothing" are all pinned. It also documents (as info, not a defect) that
above-viewport candidates are tagged and revealed on scroll-back — intentional upstream
behaviour that this change neither adds nor removes.

## 6. `storage-watch-bus.js` reads each key once per tick

25 `watch()` call sites cover **17 distinct keys** (`hackathonPipelineV1` ×3,
`focusSessionsV2` ×3, `cse-syllabus-progress-v1` ×2, `devTasks` ×2, `studySessions` ×2,
`hackathonTrackerV1` ×2 …), and every 1200 ms tick did one **synchronous**
`localStorage.getItem` per *subscriber* — 25 reads, forever, in every tab. Now keyed:
`key → {last, subs[]}`, one read per distinct key, same fan-out (every subscriber still
fires exactly once with the same raw value). A future duplicate watcher costs zero reads.

Also: the interval is cleared when the last watcher unsubscribes (an empty-but-running
timer could survive before), `stats()` is exposed for measurement, and 64+ watchers on
one key logs a warning — that shape means a render loop is calling `watch()` without
the returned `unwatch()`, which the existing call sites mostly don't use.

Preserved deliberately: no caching/parsing of values, raw-string callbacks, and the
"key removed updates `lastValue` but does not fire" quirk — that is what the 16
subscriber files and the existing `test-storage-watch-bus.js` are written against, and
it still passes **16/16** unmodified. New `test-storage-watch-bus-v238.js` — **18 passed**
— pins the dedupe ratio, the shared-timer identity, unwatch/re-watch correctness and
watcher isolation.

## 1–4 follow-up: cache-name bump

`CACHE_NAME` → `arise-developer-system-v238-perf-cache-policy`, per the UPGRADE-README
convention (bump it whenever the precache list or app version changes). Chunk `w01` was
regenerated (`w01.ff3cafab.js` → `w01.95a2c9f9.js`) because it embeds
`storage-watch-bus.js`; `tools/build-widget-chunks.cjs` is the only thing that should
ever edit those files.

## New: `perf-probe.js` — the measurement half of this audit

Opt-in field measurement, so "did it actually get faster" is answerable without
guesswork. It costs literally nothing when off: the bootstrap in `index.html` is ~12
lines and only *creates the `<script>`* when `?perf=1` or
`localStorage['arise-perf']='on'`, so the probe file is not even fetched otherwise.
`__arisePerf.report()` prints TTFB/FCP/LCP/CLS/INP, DCL/load, `__ariseWidgetsReadyAt`
vs load, long-task count/total/**blocking** ms, per-type transfer bytes, **how many
resources came from cache** (the `transferSize 0` signal — that is what item 1 shows up
in), the chunk-split state, the `perf-lite` decision, and the storage-bus
reads/tick vs the pre-dedupe projection. `?perf=1` also pins a 4-line HUD.
Deliberately **not** in the SW precache. `test-perf-probe.js` — **16 passed** — runs it
with no `PerformanceObserver` at all and asserts it degrades instead of throwing, plus
HUD-once and idempotent re-`eval`.

## Verified through the real deploy path

`node build.mjs && node tools/build-widget-chunks.cjs` on a copy: `storage-watch-bus.js`
4.5 → 1.4 KB, `animation-upgrade.js` 4.6 → 3.7 KB (so the readable sources I committed
cost ~1 KB gzipped only before minification), all 12 chunks regenerate, and
`test-widget-chunks` / `test-chunk-priority-loader` / `test-animation-lite-mode` /
`test-storage-watch-bus{,-v238}` / `test-cache-policy` all pass **against the minified
artifact**.

## Audit items I did NOT do, and why

- **Item 7 (event delegation / unmount teardown).** 727 `addEventListener('click')`
  sites across ~100 widget files. A correct fix means a `dispose()` contract per widget
  and rewriting each mount path — that is a refactor of widget logic, which is outside
  "zero behavior change". Best treated as a convention for *new* widgets plus a
  migration pass per file with its own tests.
- **Item 9 (`createDocumentFragment` batching).** Same shape: 24 `innerHTML=` and 27
  `appendChild` sites in `w07` alone, each inside widget-specific render code.
- **Item 8 (the `dev-*`/`dsa-*` twin merge). My audit was wrong.** I measured the pairs
  instead of assuming: only **1 of 11** (`mastery-trend`, 2.9 KB each) is a real
  parameterization after normalizing identifiers and literals. `revision-scheduler`
  (82.8% raw) drops to 16% and `topic-breakdown` (89.7% raw) to 61% — they share a
  naming scheme and DOM skeleton, not code. Total genuinely duplicated code is ~6 KB,
  not the ~85 KB I claimed. Merging them would change chunk boundaries for a rounding
  error, so the right move is *not* to merge.
- **Item 5's framing was also overstated:** of 10 document-wide `childList+subtree`
  observers, **9 already subscribe to the shared `mutation-bus`** and only fall back to
  their own observer. The genuinely unconditional ones are `mutation-bus.js` itself (it
  *is* the bus) and `animation-upgrade.js` (eager in `<head>`, so the bus does not exist
  yet when it runs) — hence the `perf-lite` gate is the real fix, and the coalescing
  already added in v221 is sound.
- **Item 6's "one `setInterval` per subscriber" was wrong too:** there is a single
  shared interval; the cost was the per-subscriber `getItem` inside it. Now deduped.
