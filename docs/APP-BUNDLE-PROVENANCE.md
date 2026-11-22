# assets/app-bundle.js — provenance (read before editing)

`assets/app-bundle.js` (647 KB) and `assets/app-analytics.js` (414 KB) are
**vendored compiled bundles with no source in this repository**. They contain
the React shell (navigation, routes, core cards) and the Analytics route.
There is no JSX/TS source, no bundler config, and no way to rebuild them
from this repo alone. `scripts/tools/split-app-bundle.cjs` post-processes
the bundle (splits out Analytics) but does not compile it.

Consequences:
- Do not hand-edit these files. Changes to the React shell require the
  original shell source (held outside this repo) and a fresh compiled bundle.
- All other UI (124 files in `src/`, now Prettier-formatted and readable)
  is vanilla JS loaded via the widget manifest in `index.html` and chunked
  by `scripts/tools/build-widget-chunks.cjs` at build time.
- `assets/chunks/` is generated (git-ignored); `npm run build` regenerates it.

If the shell source is recovered, add it under `src/shell/` with a build
step in `scripts/build.mjs` and remove this document.
