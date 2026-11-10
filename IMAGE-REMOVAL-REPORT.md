# Image removal — implementation report

Status: **Complete.** One dedicated commit (`Image removal: text-only UI, retained PWA identity assets`), tested on its own before any of the 16 contribution commits.

## Goal

Remove every image the application *displays*, while:

1. keeping the PWA identity assets that make the app installable and give the
   browser tab / home-screen icon a real image;
2. never touching attachment **bytes** or **metadata** — uploads stay stored,
   list, rename, download and export exactly as before;
3. leaving no stale tests, scripts or docs that assert a rendered image.

## What "displayed image" means here

An element that causes the browser to paint a picture from a raster/vector
resource: `<img>`, `<picture>`, SVG `<image>`, CSS `background-image: url(...)`
of a non-data image, or a JS-created `Image`/`<img>` node.

Not removed: inline SVG **icons that are not images** (none remained after the
Google mark was replaced by a letter), emoji/text glyphs, CSS gradients,
`skeleton` and spinner CSS, and the manifest/favicon files themselves (the
browser chrome is not the app UI).

## Removed render paths

| # | Surface | Was | Now |
|---|---|---|---|
| 1 | Cloud auth gate brand (`index.html`) | `<img src="./assets/arise-logo.svg" fetchpriority="high">` | `.arise-brand-mark` text tile + wordmark |
| 2 | Cloud gate Google button | inline 4-path Google **SVG** | `G` letter mark (`.cloud-google-mark`) |
| 3 | Cloud account summary | `<img id="cloud-avatar">` from `profile.photoURL`, falling back to the logo | initials tile from name/e-mail; `avatarUrl` in the auth snapshot is now `null` |
| 4 | Landing nav brand | logo `<img class="arise-header-logo">` | text mark |
| 5 | SSR dashboard placeholder header | logo `<img class="arise-header-logo">` | text mark |
| 6 | React shell — boot/loading screen | logo `<img class="arise-loading-logo">` | text mark (`--loading` size) |
| 7 | React shell — landing | logo `<img class="arise-header-logo">` | text mark |
| 8 | React shell — sidebar brand | logo `<img class="arise-brand-logo">` | text mark |
| 9 | React shell — top header | logo `<img class="arise-header-logo">` | text mark |
| 10 | React shell — StreakOS brand | logo `<img class="arise-widget-logo">` | text mark (`--widget` size) |
| 11 | React shell — account chip | remote `photoURL` `<img>` | initials `<div>` (already present as the fallback branch) |
| 12 | Full-page loader (`src/loading-system.js`) | logo `<img>` | text mark |
| 13 | Loading system image enhancer | lazy `<img>` placeholder/observer/`enhanceImages` API and `ars-img-*` CSS | removed entirely; `minImagePx` config and `animation-upgrade.css` broken-image fallback also removed |
| 14 | Attendance Gamification card | logo `<img class="att-gami-logo">` | `A` tile |
| 15 | Attendance system notification | `icon: "./assets/arise-logo-32.png"` | icon option omitted |
| 16 | Hackathon deadline notification | `icon: "./assets/arise-logo-32.png"` | icon option omitted |
| 17 | Syllabus+ exam notification | `icon: "/assets/arise-logo-192.png"` | icon option omitted |
| 18 | Competitive Programming GitHub profile | `<img>` from the GitHub API `avatar_url` | initials `.cp-gh-avatar-fallback` circle |
| 19 | Competitive Programming custom platform | remote favicon `<img>` | `🌐` glyph |
| 20 | Social media custom platform | remote favicon `<img class="smw-favicon">` (Google favicon service) | `🔗` glyph; favicon helper + CSS deleted |
| 21 | Placement tracker company identity | `<img>` from the stored `logoUrl` | initials avatar for **every** company; stored `logoUrl` preserved |
| 22 | CSE master syllabus header | illustrative screenshot `<figure>/<img class="csu-header-img">` + full-size link + caption + CSS | removed; readiness panel is the header |
| 23 | Notes Markdown | `![alt](url)` → `<img class="na-md-img">` | `Image: <alt>` text note (`.na-md-image-alt`) |
| 24 | Local files preview | `URL.createObjectURL(blob)` → `<img>` for image types | "stored locally, not displayed" notice; PDF `<iframe>` and generic fallback unchanged |
| 25 | Certificate preview | `URL.createObjectURL(blob)` → `<img>` for `image/*` | "stored with original metadata, not displayed" notice; PDF `<iframe>` unchanged |

Deleted files: `assets/cse-syllabus-mastery-reference.png` (1720×772, ~1.02 MB) and
`assets/cse-syllabus-mastery-banner.png` (~1.00 MB, unreferenced). Roughly 2 MB
of assets left the repository and the deploy bundle.

## What was deliberately kept

| Asset | Why |
|---|---|
| `assets/arise-logo.svg` | `<link rel="icon" type="image/svg+xml">` |
| `assets/arise-logo-32.png` | `<link rel="icon" sizes="32x32">` |
| `assets/arise-logo-192.png` | `apple-touch-icon` + manifest `any`/`maskable` 192 |
| `assets/arise-logo-512.png` | manifest 512 (`any` + `maskable`) |
| `assets/arise-logo-192.webp`, `assets/arise-logo-512.webp` | manifest `type: image/webp` entries |
| `docs/screenshots/loading/*.png` | documentation, never loaded by the app |

None of these is referenced by dashboard markup; they are browser-chrome /
install artifacts. `tests/test-server-http-policy.cjs` still asserts the
long-lived cache header for `/assets/arise-logo.svg`, and
`tests/test-app-icons.cjs` still validates the generated icon SVG helper.

## Data preservation

- **Local files** (`arise-local-files-db-v1`): rows keep `id`, `ownerType`,
  `ownerId`, `name`, `size`, `type`, `blob`, `uploadedAt`. Preview is the only
  thing that changed.
- **Certificates**: `attachFile` still stores the original blob and
  `fileType`/`fileName` metadata; only the preview branch stopped creating an
  `<img>`. The browser test now downloads the stored PNG and asserts the
  `89504e47…` PNG signature survives.
- **Placement tracker**: `logoUrl` remains in storage and in exports; only the
  renderer ignores it.
- **Notes/Wiki**: Markdown source is stored verbatim. Image Markdown is *rendered*
  as a text note, not stripped from the document.
- **Profile**: Firebase `photoURL` is still available to the sync layer; the UI
  snapshot reports `avatarUrl: null` so no consumer re-introduces the image.

## Security posture changes

`netlify.toml` CSP went from `img-src 'self' data: blob:` to `img-src 'self'`.
That closes the two escape hatches the removed previews relied on. Remote
avatar/logo URLs are no longer fetchable from the page at all, so a malicious
`logoUrl` or `favicon` in imported data cannot beacon the user's IP or leak a
referrer. `tests/test-csp-policy.cjs` now asserts the exact one-token directive
instead of accepting `data:`/`blob:`.

`loading-system.js` no longer installs a document-wide `load`/`error` capture
listener or a `MutationObserver` that re-scans every inserted node for images —
that observer existed only for image placeholders.

## Tests updated

| File | Change |
|---|---|
| `tests/test-optimization-pass.cjs` | asserts the text brand mark and that `index.html` contains no `<img>` |
| `tests/test-csp-policy.cjs` | `img-src` must be exactly `'self'` |
| `tests/test-loading-system-v2.cjs` | image-enhancer assertions removed; announcements/offline kept (377 assertions) |
| `tests/test-safe-markdown.cjs` | image Markdown becomes a labelled text note; asserts zero `<img>` in both renderers |
| `tests/placement-tracker/test-dom-smoke.js` | stored `logoUrl` never renders; initials always; metadata retained |
| `scripts/verify-loading-browser-e2e.cjs` | "image-free chrome" probe (`#arise-main/#cloud-gate/#root` have 0 `<img>`, `AriseLoading.enhanceImages` is `undefined`) + button-guard probe |
| `scripts/verify-engineering-browser.cjs` | certificate image certificate: no `<img>`, notice text, then download and assert PNG magic bytes |
| `scripts/verify-cse-image.cjs` → `scripts/verify-cse-layout.cjs` | asserts **zero** images per theme/viewport, header still lays out, scores and progress unchanged |
| `docs/cse-mastery-image-verification.md` | rewritten as the removal record |
| `docs/QA-AUDIT-2026-10-28.md` | script renamed in the two historical tables |
| `README.md` | "Images and PWA identity assets" section + layout line |

## Verification

| Command | Result |
|---|---|
| `npm run build` | PASS — 113 scripts → 12 chunks, 131 SW entries, new chunk hashes, revision `ff381c13620c6768` |
| `npm test` | PASS — all feature suites + 70/70 cloud tests |
| `npm run test:browser:engineering` | PASS — locked gate, 12 chunks, 20 routes × 8 viewports, themes/keyboard, attachments (HTML masquerade blocked, PDF sandbox, PNG bytes retained), Analytics retry, PWA/offline |
| `npm run test:browser:ux` | PASS — 8/8 stages incl. the new image-free chrome probe |
| `node scripts/verify-cse-layout.cjs` | PASS — 41 themes × 3 viewports, zero images, single mount, no overflow, scores/progress invariant |
| `npm audit --audit-level=high` | PASS at the `high` threshold (6 moderate transitive advisories remain) |
| `npm run test:rules` | SKIPPED — no Firestore emulator available; **not** an authorization pass |

## Known limitations

- Native OS/browser notification surfaces no longer show an app icon. That is a
  deliberate consequence: the `icon` option was the only remaining use of the
  PNG outside manifest/favicon chrome.
- The text brand mark is an `A` in a themed tile, not a redrawn logo. A real
  vector logotype would re-introduce a non-image asset; the wordmark "Arise"
  next to the tile carries the brand.
- The Wiki renderer (`src/personal-wiki-widget.js`) never supported image
  Markdown; it still escapes it as text. Only the Notes renderer had to change.
- Reduced-motion and forced-colors behaviour of the new marks is inherited from
  existing tokens; only light/dark theme switching is browser-tested.
