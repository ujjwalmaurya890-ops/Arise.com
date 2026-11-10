# CSE mastery header — image removal and verification report

Status: **Image removed; layout verified.**

> Superseded scope: this document used to verify an illustrative syllabus
> screenshot embedded in the unified CSE header. That screenshot was removed
> from the application as part of the repository-wide image removal. The file is
> kept (and renamed in spirit to a removal record) because other documents
> linked to it; the verification matrix below is the current one.

## What changed

- `src/features/semester-risk/cse-syllabus-unified-widget.js`: the framed
  `figure.csu-header-reference` — a full-size `<img class="csu-header-img">`
  wrapped in a link, with its caption — is gone, together with the CSS that
  sized it (`flex-basis`, `aspect-ratio: 1720 / 772`, mobile overrides).
  The readiness panel is now the only header block.
- `assets/cse-syllabus-mastery-reference.png` (1720×772, 1.02 MB): deleted. It
  was an illustrative screenshot, never user data.
- `assets/cse-syllabus-mastery-banner.png` (1.00 MB): deleted; it had no
  production reference at all.
- `scripts/verify-cse-image.cjs` → `scripts/verify-cse-layout.cjs`, so the
  filename no longer claims an image check that no longer exists.

Progress storage (`cse-syllabus-progress-v1`) and the readiness scoring API
(`weighted` / `credits` / `simple`) were not touched. No migration is needed:
the removed element rendered a picture and owned no persisted state.

## Current verification

`node scripts/verify-cse-layout.cjs` runs an isolated Chromium fixture against
the widget source. It never bypasses production authentication.

For every built-in theme × 1440 / 768 / 390 px it asserts:

- exactly one `#csu-unified-root` mount;
- zero `img`, `picture`, `svg image` or `background-image` elements inside the
  widget — the header is text and controls;
- the readiness title still has non-zero width (no collapsed header);
- no horizontal overflow of the widget;
- title color differs from the surface color (a smoke check, *not* a WCAG
  calculation);
- `weighted` / `credits` / `simple` scores are unchanged and
  `localStorage['cse-syllabus-progress-v1']` is byte-identical before and after
  every theme switch;
- no uncaught page errors.

Optional baseline: save the previous widget source to
`.test-artifacts/csu-baseline.js` before running to deep-compare scores.

## Limitations

- The color check is not a WCAG 2.2 AA audit; full card, badge, control,
  hover/focus/disabled/loading/error-state contrast remains unverified in every
  theme.
- Custom user palettes and accent overrides are arbitrary and not
  browser-tested. Forced colors, reduced motion, Safari and Firefox are
  unverified.
- Authenticated CSE-specific visual review is out of scope for this fixture.
- Real user data was never accessed; tests use seeded fixtures.

## Run

```sh
npm ci
npm run dev            # or: npm run build && npm start  (0.0.0.0:8123)
node scripts/verify-cse-layout.cjs
npm run test:browser
```

Requires Node `>=22.22 <25`. The production dashboard needs configured
Google/Firebase access and an approved account; the isolated widget fixture does
not. Screenshots/matrix JSON, when written, live in the git-ignored
`.test-artifacts/` directory and are not published assets.
