# Arise — Motion & Interaction Audit (2026-11-04)

Scope: the checked-in project at commit `5338eca` (branch `arena/930a026f-arise-com`).
Method: static inspection of every stylesheet/script that can emit motion, a live
Playwright pass against `dist/` (Chromium, authenticated cloud fixture), a DOM/computed
style probe of the dashboard, and the existing test/verification suites.

Nothing in this document is a proposal — it records what exists *before* the upgrade so
the upgrade can be judged against a baseline.

## 1. Stack and delivery

| Layer | Reality |
| --- | --- |
| Shell | Static `index.html` (1,250 lines) + hashless ESM bundle `assets/app-bundle.js` (React 19 + framer-motion inlined) |
| Widgets | ~100 classic scripts in `src/`, grouped into 12 generated chunks (`assets/chunks/w01…w12`) by `scripts/tools/build-widget-chunks.cjs`; executed lazily by a loader at the end of `index.html` |
| Styles | `styles/theme.css` (41 themes, CSS variables), `assets/app-styles.css` (Tailwind build), `styles/saas-upgrade.css`, `styles/design-system.css`, `styles/animation-upgrade.css`, `styles/typography-upgrade.css`, per-feature CSS |
| Boot | `#cloud-gate` → `assets/cloud-auth.js` → `AriseBoot.ready` → protected scripts (incl. `src/animation-upgrade.js` and `assets/app-bundle.js`) → lazy chunk loader |
| Build | `npm run build` = widget chunk regeneration + a safe copy into `dist/`; `scripts/serve.mjs` serves `dist/` with PRPL-ish caching headers |
| Tests | 59 node test files (`scripts/_run-test.cjs --all`), cloud tests, plus three Playwright verifiers (`test:browser`, `test:browser:ux`, `test:browser:engineering`) and a lab measurement script (`test:performance`) |

## 2. Existing animation systems (all of them)

1. **`styles/animation-upgrade.css`** — the only centralised motion layer today.
   Tokens: `--motion-instant/fast/micro/normal/panel/section/spinner/skeleton`,
   `--ease-standard`, `--ease-out-quart`, `--ease-in-accelerate`, `--ease-spring-soft`,
   `--ease-linear`, skeleton radii, overlay scrim, `--motion-scale-press`,
   `--motion-scale-modal`. Sections: (1) `.uxa-reveal` viewport reveal + `.uxa-route-enter`,
   (2) tactile buttons/focus rings, (3) spinners, (4) determinate/indeterminate progress,
   (5) skeleton system, (6) loading/empty/error states, (7) modal & drawer transitions,
   (8) decorative-animation suppression for specific shell classes, (9) reduced motion.
2. **`src/animation-upgrade.js`** — runtime counterpart: `prefersReducedMotion`,
   `smoothScroll`, `setButtonBusy`, `fetchWithTimeout`, `renderSkeleton`,
   `renderErrorState`, `renderEmptyState`, `bindModalA11y`, and a card reveal scanner
   (`scanCards`) driven by one `IntersectionObserver` plus the shared
   `__ARISE_MUTATION_BUS__`.
3. **framer-motion (inlined in `app-bundle.js`)** — active motion for the React shell:
   stat cards (`initial={{opacity:0,y:14}}`, 400 ms, `cubic-bezier(.34,1.56,.64,1)`),
   section wrapper (`duration .12`), dashboard insight cards, project/streak/XP panels,
   mobile drawer variants (`x:-280`, spring `damping 25 / stiffness 300`).
4. **Tailwind utilities in `app-styles.css`** — `animate-float` (3.5 s loop),
   `animate-ring-glow*` (2.5 s loops), `animate-outer-glow` (9 s loop),
   `animate-gradient-shift`, `animate-breathe`, `slide-up-fade` tooltip,
   `.btn-premium` sheen (`transform` on hover), `.quick-action`/`.glass-card` hover lifts,
   `.progress-fill` width transition + 3× `shimmer`.
5. **Per-widget CSS + keyframes** — e.g. `dmh-cell-in`, `water-reminder-toast-in`,
   `uppOverlayFadeIn`/`uppDialogPopIn`, `et-rise`, `ariseSkelPulse`, `cloud-enter`.
   Several widgets re-declare `transition:` values inline in their injected stylesheets.
6. **HTML-level motion** — inline `<style>` blocks in `index.html` (sidebar/drawer rules,
   `perf-lite` overrides, focus-mode overrides) and the `reduce-motion` / `perf-lite`
   early-boot classes.

## 3. Findings (evidence)

### 3.1 Conflicting / duplicated motion definitions
* **Two motion token sets with the same names.** `styles/design-system.css` defines
  `--motion-fast: 140ms`, `--motion-standard`, `--motion-slow`; `styles/animation-upgrade.css`
  defines `--motion-fast: 120ms`, `--motion-micro`, `--motion-normal`, `--motion-panel`,
  `--motion-section`. Both load on every page → the later file wins and
  `--motion-standard`/`--motion-slow` are effectively dead ends for new work.
* **`--ease-standard` is declared twice** (`design-system.css` and `animation-upgrade.css`).
  Same curve, so today it is harmless — but it is a silent override waiting to diverge.
* **`.nav-active` is re-defined 4×** (`app-styles.css`, `styles/theme.css`,
  `styles/saas-upgrade.css` ×2). The live computed style
  (probe: `background-color color(srgb …)`, 1 px border, 8 px radius, `transition 0.14s`)
  comes from the `saas-upgrade.css` layer; the neon-gradient version in `app-styles.css`
  is dead weight.
* **Modal entrance is implemented three ways**: `.uxa-modal-in` keyframe in
  `animation-upgrade.css`, `uppDialogPopIn` in `premium-productivity-features.css`, and
  per-widget `animation:` shorthands (`et-rise`, `cloud-enter`, `water-reminder-toast-in`).
* **`body::before`** is asserted to be disabled (`styles/saas-upgrade.css`:
  `body:before{display:none!important}`) — the grid/aurora atmosphere is therefore the
  static `.arise-saas-backdrop` element; nothing animates behind content today.

### 3.2 Motion that cannot run (or runs against the user)
* **`perf-lite` disables almost all animation by accident.** `index.html` ships
  `.perf-lite *…{animation-iteration-count:3!important}` and the boot script turns
  `perf-lite` on when *any* of: OS reduced motion, Brave, `hardwareConcurrency ≤ 4`,
  `deviceMemory ≤ 4`, `connection.saveData`. The headless test browser (and every
  4-core laptop) therefore renders the dashboard permanently static. Verified live:
  `document.getAnimations()` returns `[]` at idle, `.uxa-reveal` elements that are
  currently on screen: 7 of 14 — the other 7 stay at `opacity:0` because the scanner ran
  while the section was still hidden.
* **7 of 14 revealed cards can remain invisible.** `scanCards()` only reveals cards that
  are already in the viewport or that an `IntersectionObserver` has seen. Cards inside an
  inactive widget tab (`display:none`), a collapsed section, or a lazily-mounted chunk
  that appears later can be stamped `uxa-reveal` and never flipped to `uxa-in`. That is a
  content-visibility bug, not just a styling one.
* **`uxa-route-enter` is triggered from a header `MutationObserver`-free heuristic**
  (`syncRouteTransition` compares `header h1` text). It works, but it animates the whole
  `#arise-main` subtree (a 3,600-node surface on the dashboard) every navigation.
* **`.quick-action` and `glass-card` hover lifts** are defined twice with
  `!important` overrides in `saas-upgrade.css`; the practical result is
  `transform:translateY(-1px)` on 9 quick actions and none on `.glass-card`, i.e. the
  same visual affordance behaves differently on adjacent cards.
* **Progress fills** animate `width` (`0.6s cubic-bezier(.34,1.56,.64,1)`), an
  overshooting curve on a layout property — the only property that must never bounce.
  Rings transition `stroke-dashoffset` with a 1.4 s spring in the premium widgets.
* **`will-change`** appears on `.upp-command-dialog` permanently
  (`will-change:transform,opacity`) and `.arise-skel-bar:after`.
* **Focus vs. motion**: `outline:2px solid var(--primary)` is used for `:focus-visible`
  in three places with three offsets; the design system's `--focus-ring` token is not
  used by the widgets.

### 3.3 Accessibility gaps found
* Reduced motion is honoured globally (`animation-duration:.01ms`) — good — but the
  `html.reduce-motion` class rule in `index.html` and the `@media` rule in
  `styles/design-system.css` both force `animation-iteration-count:1`, which also kills
  *essential* spinners in newer widgets that do not include the `uxa-` exemptions.
* The `perf-lite` selector uses substring matching
  (`*:not([class*="spin"])…{animation-iteration-count:3!important}`), the exact
  fragile-selector pattern the brief forbids; a widget class such as `spinnerish` or
  `load-more` silently changes behaviour.
* Toasts: `.htw-toast`, `#cp-toast`, `.water-reminder-toast`, `#upp-toast`,
  `#arise-shared-toast` animate differently (4 entrance animations, 2 stacking models).
* No non-colour feedback on `[aria-pressed]` toggles (`.arise-pwb-density` relies on
  colour only).

### 3.4 Performance characteristics (measured, before)
`npm run test:performance` (cold contexts, no throttling, 3 runs/viewport):

| Viewport | FCP | LCP | CLI (max session) | worst event | DOM ready | requests |
| --- | --- | --- | --- | --- | --- | --- |
| 1440 | 92–160 ms | 160–1020 ms | 0.006–0.022 | 120–144 ms | ~9.4 s | 47 |
| 390 | 92–148 ms | 148–160 ms | 0.0115–0.102 | 104–128 ms | ~9.3 s | 47 |

Playwright UX suite baseline: boot CLS 0.0052, idle running animations 1, 12 routes with
zero blank screens. Notable costs found statically: 5 infinite Tailwind loops
(`animate-float/ring-glow/outer-glow/gradient-shift/breathe`), `backdrop-filter:blur(12px)`
on the sticky header, 2 `backdrop-filter` layers on the cloud gate, and a
`transform`-animated `.arise-saas-backdrop` would be a full-viewport composited layer if
it ever animated (it does not today).

## 4. What the upgrade must therefore do

1. Unify the tokens (one source of truth, backwards-compatible names).
2. Replace the substring-based `perf-lite` animation kill-switch with explicit,
   opt-in "decorative" markers, and let `perf-lite` mean *cheaper*, not *dead*.
3. Fix reveal so content can never stay at `opacity:0` (fail-open), and scope the reveal
   to compositor-only properties.
4. Give the dashboard a purposeful, short page-load reveal that works with the async
   widget mounts, without delaying first paint or interaction.
5. Replace width/`stroke-dashoffset`-spring chart animations with JS-driven,
   value-accurate, one-shot animations (WAAPI), reset only when the value changes.
6. Make navigation, drawers, modals, forms, toasts and tooltips share one motion
   vocabulary and theme-aware colours (`color-mix` off existing tokens only).
7. Keep `prefers-reduced-motion` and `perf-lite` first-class, and keep the tests green.
