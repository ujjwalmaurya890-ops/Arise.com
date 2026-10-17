# Performance audit — Arise `v237` (measured)

> **Status (v238):** Tier 1 items 1–4 are implemented and test-guarded — see
> [IMPLEMENTED-v238.md](./IMPLEMENTED-v238.md). Tier 2/3 are still open.

Numbers below are measured from `Arise_com_v237_final.zip` → `arise_final/`.
Everything already shipped (chunk pre-warm, batch yielding, `media=print` CSS after
the script tags, `perf-lite` detection, coalesced `mutation-bus`) is genuinely good —
these are the items **still on the table**, ranked by (impact ÷ effort).

---

## Tier 1 — one-file fixes, biggest wins

### 1. Cache headers don't cover any subdirectory asset — `netlify.toml`
Rules exist only for `/*.js` and `/*.css`. Netlify's `*` does not cross `/`, so every
file under `assets/`, `assets/chunks/`, `features/` is served with **no**
`Cache-Control`. That is 150+ files — including the 1 MB / 295 KB-gzipped
`assets/app-bundle.js` — revalidated on every navigation.

```toml
[[headers]]
  for = "/assets/**"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"   # hashed chunk names + prod bundle
[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
```
Add matching `for` blocks for `/features/**/*.css` and `/features/**/*.js`, and for
`/interview_sheets_data.json`.
**Wins ~60–100 conditional round-trips per repeat visit.** No behaviour change risk
once names are content-hashed (chunks already are — `build-widget-chunks.cjs`).

### 2. The service worker precaches ~2× what the page loads — `service-worker.js`
`EXTENDED_SHELL` (124 entries) contains **99 files that are already inside a chunk**:
`w03` is the minified copy of `attendance-tracker-widget.js`, yet both are cached.

| | raw |
|---|---|
| `CORE_SHELL` (29) | 1.43 MB |
| `EXTENDED_SHELL` (124) | 5.38 MB |
| **total cached per user** | **6.81 MB** |
| duplicate bytes | **2.46 MB** |
| serial fill cost | **~50–60 s** of background network |

`fillExtendedCache()` is one-at-a-time with a hard `setTimeout(400)` between entries.
Fix: filter `EXTENDED_SHELL` against `CHUNK_FILES` values, and replace the sleep with
`requestIdleCallback` + a 4-in-flight pool (or a single `cache.addAll` chunked 12 at a
time). Also gives up to 246 wasted `cache.put` calls per deploy.

### 3. `app-bundle.js` is one 1 MB monolith — split it and drop recharts
`import()` count in the bundle: **0**. There *are* 15 `lazy(` + 13 `Suspense` sites, but
they all resolve inside the same file, so every visitor pays for every view.
Charts: widgets hand-roll SVG (`<svg>`/`createElementNS` in 12 widget files) while the
full **recharts** library is inlined into the shell for ~5 chart call sites.

- `import()` the recharts-dependent views → out-of-band chunk.
- Or delete recharts and reuse the widgets' existing SVG renderers.
- Add `<link rel="modulepreload" href="./assets/app-bundle.js" crossorigin>` in `head`
  — there is **no** preload of the most important file on the page today.
- Emit a sourcemap (`sourcemap: true`) while keeping it out of the shipped deploy;
  a 1 MB single-file bundle is undebuggable otherwise.

### 4. Load the chunk the user is about to look at, not all 12
The lazy loader starts 50 ms after `load` and walks `CHUNKS` in order, shipping
2.48 MB raw / **0.65 MB gz** to every visitor regardless of which tab they open.
Make the chunk list view-keyed: load `w01` + the chunk owning the default view, then
fetch the rest on `pointerdown`/tab-change (`priority: 'low'`). The mount-stub queue
already tolerates late arrival, so this is a routing change, not a rewrite.

---

## Tier 2 — runtime cost on the dashboard

### 5. Three document-wide observers fighting each other
> **Corrected while implementing (v238b).** Of the 10 document-wide
> `childList+subtree` observers, 9 *already* subscribe to the shared `mutation-bus`
> and only fall back to their own. The unconditional ones are `mutation-bus.js` itself
> and `animation-upgrade.js` (eager in `<head>`, before the bus exists). Real fix
> shipped: gate `animation-upgrade.js` on `perf-lite`.
* `mutation-bus.js:54` → `observe(document.body, {childList,subtree})` + ~35 subscribers
* `animation-upgrade.js` → `observe(document.documentElement, …)`, then per batch:
  `querySelectorAll('[class*="-card"]…')` ×2 **and** `getBoundingClientRect()` per node
  (`v()`/`M()`) — synchronous layout on a React re-render = reflow storm
* `a11y-color-patch.js`, `theme-quick-toggle.js`, `cse-syllabus-*` (×3 files!) also observe the tree

Fixes: scope `observe()` to the container each subscriber cares about; in
`animation-upgrade.js` drop the per-node `getBoundingClientRect` (an `IntersectionObserver`
with a negative `rootMargin` already gives "in view, near bottom") and replace the
attribute-substring selectors with one `MutationObserver` on
`attributes: ['class']` filtered by a Set.

### 6. `storage-watch-bus.js` polls localStorage with a timer per subscriber
> **Corrected while implementing (v238b).** There is a *single* shared interval, not one
> per subscriber. The cost was 25 synchronous `getItem` calls per tick for 17 distinct
> keys. Fixed by keying the map: 17 reads/tick.
`r()` starts **one `setInterval(f, 1200)`**, and `f()` does a synchronous
`localStorage.getItem` per watched key every tick — forever, for every tab, including
keys nothing writes. Cache a single tick, de-dupe the key set, read each key **once**
per tick and fan out; drop the interval entirely when `n.length === 0`.
`expenses.js` alone has 52 `getItem`/`setItem` sites and 44 `JSON.parse`/`stringify`.

### 7. No event delegation, no unmount teardown
727 `addEventListener('click')` across the widget set; ~100 widgets × N buttons each,
re-bound on every re-render. One delegated `click` listener per widget root (plus the
existing capture-phase ripple listener) removes the bulk of that, and gives each widget
a `dispose()` contract so listeners and `setInterval`s die with the panel instead of
leaking on tab switches.

### 8. 11 `dev-*` / `dsa-*` twin widgets are near-duplicates
> **Withdrawn.** Measured after normalizing identifiers/literals: only `mastery-trend`
> is a true duplicate (2.9 KB). `revision-scheduler` 82.8% raw → 16% normalized,
> `topic-breakdown` 89.7% → 61%. They share a naming scheme, not code. Real duplicated
> bytes ~6 KB, not ~85 KB — do **not** merge.
`difficulty-radar, mastery-premium, mastery-trend, milestone-badges, pace-projection,
placement-engine, revision-scheduler, solve-speed, streak, topic-breakdown,
weekly-sparkline` — ~85 KB of copied code. One parameterised factory (`kind`, storage
prefix, data getter) → 2 files instead of 22, and it collapses 4 chunks' worth of parse
work. `w07` alone packs 24 near-identical widgets.

### 9. Batch DOM writes
`createDocumentFragment` count: **0**, while `innerHTML =` is assigned 24× in `w07` and
`appendChild` is called 27× there. `innerHTML` + fragment batching turns N layout passes
per panel into one.

---

## Tier 3 — housekeeping that still shows up in numbers
* `build.mjs` skips `test-*.js` for minification but they **remain in the deploy** (~500 KB).
* 115 source widget files (2.70 MB) sit next to the chunks that replace them — fine as a
  404 fallback, but they must not be in the SW precache (see #2).
* Orphans never referenced at runtime: `daily-learning-tasks-widget.js` (51 KB),
  `upgrade/focus-ring/*.js`.
* Render-blocking CSS is 122.9 KB raw / 21.1 KB gz across **3 sequential** head links;
  inlining the first-paint subset and keeping ~12 KB of Tailwind dead utilities
  (120 of 664 are unreferenced) is worth a pass.
* `theme.css` + `app-styles.css` overlap on theme custom properties — merge into one file
  to cut a blocking round-trip.
* **Repo hygiene:** the branch contains only `Arise_com_v237_final.zip`. None of this is
  reviewable or diffable until the `arise_final/` tree is committed.

---

## Correction to item 2 (found while implementing)

`tools/build-widget-chunks.cjs` builds `EXTENDED_SHELL` from
`tools/sw-extended-base.json` **on purpose** — its comment calls the per-file entries
"the offline fallback" for the `?chunks=0` path, and `test-widget-chunks.cjs` guards
that the chunks are in the list. So the 2.46 MB of duplicated bytes is intentional
offline coverage, not an oversight; the actual defect was only the serial
153-request/400 ms-sleep scheduling, which is what v238 fixed. Everything else in this
file stands as measured.

## What to measure, so this stays honest
Add a tiny reporter (guarded by `perf-lite`/dev flag) that logs to
`window.__arisePerf`:

```js
new PerformanceObserver(l => {
  for (const e of l.getEntries())
    (window.__arisePerf ??= []).push({ t: Math.round(e.startTime), dur: Math.round(e.duration), name: e.name });
}).observe({ type: 'event', durationThreshold: 50 });            // INP candidates
new PerformanceObserver(l => window.__arisePerfLong = l.getEntries()).observe({ type: 'longtask', buffered: true });
performance.getEntriesByType('paint');                            // FCP
performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd;
// + LCP (largest-contentful-paint) and per-chunk loadScriptsInOrder timings
```

Baseline targets: FCP < 1.2 s, LCP < 2.0 s, no `longtask` > 100 ms during widget mount,
repeat-visit network ≈ 0 KB (all 304 / immutable), SW precache ≤ 4 MB.
