# Changelog

All notable changes to Arise. Versions are the repository's own build stamps and
shell cache names; the entries below are grouped by the work that introduced
them.

## Unreleased

### Interface without images (2026-11-10)

- The dashboard renders no images: logos, avatars, company marks and attachment
  previews are drawn as text, initials or CSS. Attachment bytes and metadata are
  unchanged and still downloadable.
- Only the PWA identity set remains tracked (`arise-logo.svg`, the 32px favicon,
  the 192/512 PNG+WebP icons); CSP `img-src 'self'`.

### Command palette

- Recent commands are remembered and committed with Enter.
- Matches are highlighted and the result list is a real listbox with
  `aria-activedescendant`.
- One palette, not two: the existing `Ctrl/Cmd+K` overlay was extended.

### Global search

- The palette index now covers attendance, CGPA, placement, certificates,
  hackathons, skills, competitive programming, syllabus, exams, expenses and
  folders in addition to the existing modules, notes and DSA entries.

### Dashboard personalization

- Card order, visibility and pins are persisted per account, with a reset that
  restores the authored order.

### Notification center

- One inbox derived from real exam, hackathon, placement, task and revision
  records, with explicit read state. No push claims, no invented events.

### Notes and knowledge

- Backlinks, unresolved wiki links, duplicate notes and weak-topic detection
  across notes and the personal wiki, preserving the existing schema and export.

### Analytics

- Study sessions are bucketed by local calendar day, and periods are compared
  against an equally long previous window instead of a fixed-length one.

### Daily planner

- A Today card that composes the existing task, DSA and study records. It does
  not create a second task manager.

### Focus session audit

- The three study-time writers (`focusSessionsV2`, legacy `studySessions`, the
  stopwatch) are reconciled in one panel, which reports what each one dropped.
- Stopwatch runs can be imported once; the streak counter is checked against the
  session log.

### Study horizon

- A fourteen-day load plan built from exam dates (including the CSE syllabus
  override), open and weak topics, and the DSA backlog.
- Every planned minute is attributed to a driver, capacity is derived from the
  last week's real study days, and each day is classified
  free/light/full/overloaded.

### Progress overview

- One read-only row per area (study time, DSA, attendance, CGPA, skills,
  projects, certificates, competitive coding) computed from real stores only.
- Widget demo rows are deliberately excluded, and empty areas are excluded from
  the average instead of being scored zero.

### Accessibility

- The skip link now moves focus into `#arise-main`, which is a labelled main
  landmark.
- Route changes are announced through one polite live region.
- The audit surface reports landmark, skip link and control-naming state, and
  flags positive `tabindex`.

### Performance

- Measured idle cost on the built dashboard dropped from 3,985 `querySelectorAll`
  calls and 5 long tasks per 4 s to 1,187 and none.
- The mutation bus no longer notifies subscribers about records produced by the
  subscribers themselves.
- The dashboard layout only moves cards that are actually out of place.
- Animation frames inside a self-updating card are filtered out
  (`data-arise-bus-idle`), with counters in `window.ArisePerf`.

### PWA status

- A small notice reports the installed shell version, a newly installed version,
  a background update that needs a reload, and offline state with or without a
  populated cache.

### Backup integrity

- A restored file is inspected before the ownership confirmation: incomplete
  files are blocked, empty stores, missing attachment bytes and unknown stores
  are explained, and nothing is written by the inspection.

### Reliability

- A widget chunk that fails to load is retried up to three times with growing
  delays; deterministic failures are retried once and then reported as
  unfixable by reloading.
- Attempts are remembered in `arise-widget-retry-v1`, and cleared when the module
  loads.

### Developer experience

- Added `ARCHITECTURE.md`, `CONTRIBUTING.md`, `CHANGELOG.md` and
  `docs/CONTRIBUTION-REPORT.md`.
