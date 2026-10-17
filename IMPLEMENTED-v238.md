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
| widget JS executed before the fold | 12 chunks / 2.48 MB raw | 2 chunks / 368 KB raw |
| deferred | — | 10 chunks / 2.12 MB raw (~0.55 MB gz), low-priority pre-warm |

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
