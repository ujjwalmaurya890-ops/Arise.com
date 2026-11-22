# upgrade/ — unbuilt proposals (not shipped)

`focus-ring/` contains JSX hooks (`FocusRing.jsx`, `useCountdownTimer.js`, …)
that were proposed as a replacement for the vanilla timer overlays in
`src/timer-visual-upgrade-widget.js` / `src/focus-timer-upgrade-widget.js`.
They are **not** imported by `index.html`, not in the widget manifest, not
in the service worker, and not built by `scripts/build.mjs`. They are kept
as a design reference only. Do not deploy from this directory; port the
ideas into `src/` (and add them to the manifest + tests) if adopting them.
