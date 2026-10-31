# ARISE visual system — audit, specification and verification

## 1. Discovery and original design audit

This was an incremental design-system pass against the existing static shell, React workspace, bundled utility styles, feature stylesheets, theme manager and lazy widget code. Existing application behavior was intentionally left in place.

### What was already strong

- The app already has a real theme manager with persisted theme/mode preferences, custom accent overrides, user-imported themes, scheduling and chart recoloring. The theme registry has 41 built-in themes.
- Inter and JetBrains Mono are already shipped as local variable-font files. Inter is preloaded; there was no reason to add a third family or an external font request.
- `styles/theme.css` already centralizes the foundational colors and has broad theme-aware treatments for cards, controls, navigation and charts.
- `styles/saas-upgrade.css` and `assets/responsive-patch.css` contain deliberate refinements for the shell, touch targets, safe areas and constrained layouts.
- The animation foundation already honors reduced motion, and the widgets retain their individual chart, editor, calendar and data-entry behaviors.

### Inconsistencies and risk areas found

| Finding | Source area | Design / maintenance impact |
|---|---|---|
| The theme and SaaS stylesheets were dense, mostly single-line files with overlapping revisions | `styles/theme.css`, `styles/saas-upgrade.css`, `styles/typography-upgrade.css` | Hard to reason about cascade and exceptions; avoid a second large rewrite and add a documented, semantic layer instead. |
| Surface treatment mixed tonal surfaces with gradient overlays, glass names, glow classes and hard-coded color-mixes | `styles/theme.css`, `styles/saas-upgrade.css`, app utility classes | Widgets could look like separate products; background decoration competed with content. |
| Palette values and aliases were not consistently described by semantic intent | `src/theme-system.js`, `styles/theme.css`, widget styles | Custom and named themes could inherit confusing meanings for supporting colors. |
| The primary contrast color was white in several bright-accent themes, below 4.5:1 on the filled primary control | `src/theme-system.js` | Eight built-in themes had a primary-button label contrast failure; the accent-color helper also used a brightness threshold rather than a contrast comparison. |
| Focus used a translucent color derived from the primary accent | `styles/theme.css`, `styles/typography-upgrade.css` | Some theme accents were too low-contrast against a surface to be a robust keyboard indicator. |
| Small type sizes were scattered across utility classes and typography overrides | `styles/typography-upgrade.css`, generated utility CSS, widgets | Created inconsistent metadata readability and a less explicit type scale. |
| CSS is distributed across the shell, a generated application bundle and dozens of feature/widget files | `index.html`, `assets/app-styles.css`, `styles/features/**`, `src/**` | A repo-wide replacement would be risky. Shared component chrome needed a common layer while preserving specialized editor/chart/calendar internals. |

### Decisions preserved

The 41 themes, their names and visual character; accent customization; local-storage keys; scheduling; chart update behavior; component markup and handlers; widget mounting/lazy-loading; and existing responsive rules remain. The primary identity remains the existing theme-provided indigo/brand color rather than adding another competing accent. Distinct theme palettes continue to provide their own chart series and semantic status hues.

## 2. Final visual specification

The new `styles/design-system.css` provides semantic aliases over existing active-theme variables. This is deliberate: built-in, imported and user-authored themes all receive the same complete contract, and changing theme or accent continues to update tokens without duplicating the theme registry in CSS.

### Core identity palettes

Hex values below describe the primary dark and clean light experiences. Other named themes retain their own theme-specific values.

| Semantic role | Cyber Midnight Pro (dark) | Clean White (light) | Purpose |
|---|---:|---:|---|
| Application background | `#090B10` | `#F8FAFC` | Main workspace canvas |
| Secondary background | `#07090D` | `#F1F5F9` | Secondary shell / tonal contrast |
| Card surface | `#11151E` | `#FFFFFF` | Primary widget and panel surface |
| Muted surface | `#0D1017` | `#F1F5F9` | Inputs, table heads, quiet sections |
| Hover surface | `#171D29` | `#F8FAFC` | Interactive hover state |
| Active surface | `#1E2636` | `#E2E8F0` | Pressed or selected control |
| Primary text | `#F1F5F9` | `#0F172A` | Headings and essential content |
| Secondary text | `#CBD5E1` | `#475569` | Body copy and supporting labels |
| Tertiary text | `#8E9CB2` | `#617087` | Metadata and low-priority supporting information |
| Primary brand | `#435EE0` | `#2563EB` | Primary actions and restrained emphasis |
| Primary hover | `#364FC7` | `#1D4ED8` | Hovered primary action |
| Text on primary | `#FFFFFF` | `#FFFFFF` | Filled primary controls (contrast-normalized at runtime) |
| Success | `#10B981` | `#11803A` | Positive state / trend |
| Warning | `#F59E0B` | `#A75C05` | Caution / pending |
| Danger | `#EF4444` | `#D82323` | Destructive / error |
| Information | `#38BDF8` | `#0275B0` | Informational state |
| Primary border | `#1E2634` | `#E2E8F0` | Card and control separation |
| Strong border | `#2B3648` | `#CBD5E1` | Selected / emphasized boundaries |

### Palette architecture

- **Dominant:** active theme background, secondary background and card surface.
- **Supporting:** muted/elevated surfaces, text hierarchy and quiet boundaries.
- **Brand:** `--primary`, with `--primary-hover` for hover. A theme's own `chart-2`/`chart-5` are secondary/tertiary accents, not alternate primary actions.
- **Semantic:** success, warning, danger and information each have foreground, low-emphasis background and border roles.
- **Neutral:** active theme's text, border and surface tokens.

Chart series 1–5 continue to follow the theme's palette. Additional series 6–8 are teal/amber/rose, adjusted for dark/light mode. Trend meaning also has semantic positive, negative and neutral aliases; legends, labels, line styles and values should continue to convey chart meaning rather than color alone. A chart library's direct SVG series colors remain a functional visualization exception.

### Typography

| Role | Token | Size / behavior | Weight and line-height |
|---|---|---|---|
| Display | `--fs-display` | `clamp(1.875rem, 1.35rem + 2vw, 2.625rem)`; smaller clamp on mobile | 700, 1.12 |
| H1 | `--fs-h1` | `clamp(1.375rem, 1.2rem + .45vw, 1.625rem)` | 700, 1.25 |
| H2 | `--fs-h2` | `clamp(1.125rem, 1.04rem + .35vw, 1.375rem)` | 600, 1.25 |
| H3 | `--fs-h3` | `clamp(1rem, .94rem + .2vw, 1.125rem)` | 600, 1.4 |
| H4 / H5 | `--fs-h4`, `--fs-h5` | `.9375rem` / `.875rem` | 600 |
| Body large / regular / small | `--fs-body-lg`, `--fs-body`, `--fs-body-sm` | `1.0625rem` / `.9375rem` / `.8125rem` | 400–500, 1.55 |
| Caption / overline / label | `--fs-caption`, `--fs-overline`, `--fs-label` | `.75rem` / `.6875rem` / `.8125rem` | 500–600; compact tracking only on metadata |
| Button | `--fs-button` | `.875rem` | 500 |
| Code | `--fs-code` | `.8125rem` | JetBrains Mono, 1.6 |

Font roles remain local Inter for interface, headings and prose; local JetBrains Mono for code, terminal output and numeric identifiers. The existing variable weights remain: 400 regular, 500 medium, 600 semibold and 700 bold. Ordinary paragraphs do not switch to monospace.

### Geometry and interaction

- Spacing: 4px foundation, `--space-1` through `--space-16` (4, 8, 12, 16, 20, 24, 32, 40, 48 and 64px).
- Controls: small/medium/large minimum heights 32/40/44px; existing touch-screen rules continue to provide 44px targets.
- Radius: 8px control, 12px card, 16px panel/modal, pill only for badges/chips.
- Elevation: 0 flat, 1 subtle card, 2 raised panel, 3 floating surface, 4 modal. Dark mode favors tonal borders; light mode uses restrained shadows.
- Motion: 140/180/240ms fast/standard/slow using a standard ease; reduced-motion users get near-instant transitions and no decorative motion.
- Primary navigation now uses a restrained tinted selection with a clear border and text/icon hierarchy, rather than a full saturated fill on every active section.

## 3. Tokens added / unified

`styles/design-system.css` establishes the following semantic contract, all following the active theme:

- Brand: `--brand-primary`, `--brand-primary-hover`, `--brand-on-primary`, `--brand-on-primary-hover`, `--brand-secondary`, `--brand-tertiary`, `--brand-accent`, `--brand-highlight`, `--brand-muted`.
- Surfaces: `--surface-app`, `--surface-app-secondary`, `--surface-sidebar`, `--surface-header`, `--surface-content`, `--surface-section`, `--surface-card`, `--surface-card-elevated`, `--surface-floating`, `--surface-modal`, `--surface-dropdown`, `--surface-input`, `--surface-interactive`, `--surface-selected`.
- Typography roles: `--text-heading`, `--text-body`, `--text-body-secondary`, `--text-body-tertiary`, `--text-muted`, `--text-disabled`, `--text-placeholder`, `--text-link`, `--text-link-hover`, `--text-inverted`, `--text-on-accent`.
- Borders/focus: `--border-primary`, `--border-secondary`, `--border-subtle`, existing `--border-strong`, `--border-card`, `--border-input`, `--border-divider`, `--border-focus`, `--border-selected`, `--focus-ring`.
- States: `--success-fg/bg/border`, `--warning-fg/bg/border`, `--danger-fg/bg/border`, `--info-fg/bg/border`, `--neutral-fg/bg/border`, `--pending-fg/bg/border`, `--disabled-fg/bg/border`.
- Visualization: `--chart-primary`, `--chart-secondary`, `--chart-tertiary`, `--chart-comparison`, `--chart-highlight`, `--chart-positive`, `--chart-negative`, `--chart-neutral`, `--chart-grid`, `--chart-axis`, `--chart-tooltip-bg/fg/border`, and series `--chart-6` through `--chart-8`.
- Layout/interaction: `--space-1` … `--space-16`, control heights, radius roles, elevation levels 0–4, motion durations and `--ease-standard`.
- Existing `--background`, `--surface`, `--primary`, `--text-primary`, `--border`, `--ring`, `--chart-1`…`--chart-5`, shadow, transition and type variables remain the compatibility layer.

## 4. Theme, widget and regression verification

### Themes

All 41 registry entries remain in `src/theme-system.js`: Cyber Midnight Pro, Clean White, AMOLED Black, Ocean Blue, Forest Focus, Dracula and the full existing branded set (including imported/user-defined theme support). No theme was deleted or renamed.

The source-level contrast check covers every theme's primary, secondary and tertiary text and link on both app background and card surface; success/warning/danger/info on card surface; primary action foreground after normalization; and primary-hover foreground. A runtime correction now chooses whichever of black/white has the stronger contrast when a theme or custom accent's configured primary label is below 4.5:1. The correct label color is computed independently for hover. The focus outline uses primary text color (a strong neutral) rather than assuming every theme's accent has sufficient contrast.

### Widgets inspected

The source audit covered the widget style architecture as a whole: DSA and developer mastery/statistics; learning and study planners; placement/interview/career; productivity, timers and habit tracking; attendance/CGPA/expenses; hackathon; notes/wiki/files/projects; plus exam, placement and certificate feature stylesheets. The shared layer unifies shell/card/input/navigation/table/floating-surface chrome while leaving chart series, code/editor content, calendar visualization and feature-specific interaction geometry intact. This was source inspection, not a claim that every widget received an individual browser visual review.

### Accessibility: actual contrast measurements

The automated test computed 656 text/status foreground-background pairs across the 41 built-in palettes using the WCAG 2.x relative-luminance formula, including each semantic status foreground on its 4% tinted state surface. The minimums observed were:

| Pair | Lowest observed | Theme | Requirement |
|---|---:|---|---:|
| Primary text / app background | 11.39:1 | Discord Dark | 4.5:1 |
| Primary text / card surface | 10.24:1 | Discord Dark | 4.5:1 |
| Secondary text / app background | 5.49:1 | Trello Blue | 4.5:1 |
| Secondary text / card surface | 5.62:1 | GitHub Dark | 4.5:1 |
| Tertiary text / app background | 4.81:1 | Clean White | 4.5:1 |
| Tertiary text / card surface | 4.89:1 | GitHub Dark | 4.5:1 |
| Link / app background | 4.94:1 | Trello Blue | 4.5:1 |
| Link / card surface | 4.93:1 | Webflow Blue | 4.5:1 |
| Semantic success / surface | 5.03:1 | Clean White | 4.5:1 |
| Semantic warning / surface | 5.02:1 | Apple Glass Light | 4.5:1 |
| Semantic danger / surface | 4.83:1 | Apple Glass Light | 4.5:1 |
| Semantic information / surface | 4.93:1 | Webflow Blue | 4.5:1 |
| Semantic foreground / 4% state tint | 4.54:1 | Apple Glass Light (danger) | 4.5:1 |
| Core dark primary button: white / `#435EE0` | 5.36:1 | Cyber Midnight Pro | 4.5:1 |
| Core light primary button: white / `#2563EB` | 5.17:1 | Clean White | 4.5:1 |
| Core dark focus outline: `#F1F5F9` / `#090B10` | 17.97:1 | Cyber Midnight Pro | 3:1 |
| Core light focus outline: `#0F172A` / `#F8FAFC` | 17.06:1 | Clean White | 3:1 |

The following eight original themes configured white text on a primary color below 4.5:1 and are now normalized on application: Notion Light, Raycast, Framer Dark, Postman Orange, Figma Light, Airbnb Light, Reddit Orange and Things 3. Their primary color identity remains unchanged; the text color on filled controls is corrected. A real-browser custom-accent check with `#FFDC00` returned 15.49:1 for primary foreground and 10.80:1 for hover foreground.

### Regression and limits

- Theme IDs, theme storage, accent storage, schedules, theme events, chart recoloring and component handlers are unchanged. The theme manager change only calculates on-primary/hover text contrast and exposes the hover foreground token.
- CSS is added as an ordinary shared stylesheet and included in the PWA shell cache; its service-worker cache revision is incremented.
- Automated checks in `tests/test-design-system.cjs` cover token presence, all 41 theme palettes, 656 text/status contrast pairs, primary/hover control contrast, source loading, PWA caching, mobile pass and reduced-motion support.
- Representative desktop and mobile screenshots were generated and reviewed in Chromium; the shared page layouts were exercised at eight viewport widths, and all 41 themes were runtime-switched. A screenshot-by-screenshot visual tour of every theme/widget and physical-device testing were not performed. No claim of full WCAG conformance or per-widget visual certification is made; contrast was verified for the listed combinations.
