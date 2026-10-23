#!/usr/bin/env node
// Production asset minifier for the Arise dashboard.
//
// This site is plain static hosting (Netlify, publish = "."), so there is no
// bundler step like a React/Vite project would have: the deploy IS the repo.
// The vanilla widget scripts and stylesheets therefore ship exactly as
// authored unless they are minified in place first — which is what this
// script does. File names are deliberately NOT changed (no .min.js copies):
// service-worker.js's precache list, the lazy widget loader in index.html,
// and the Netlify cache headers all reference the unhashed names.
//
// Usage:
//   node scripts/build.mjs
//
// esbuild resolution order:
//   1. $ESBUILD environment variable (path to the esbuild binary)
//   2. ./node_modules/.bin/esbuild        (npm i -D esbuild)
//   3. ../tools/package/esbuild.exe       (standalone binary layout)
//
// Safety rules:
//   - assets/app-bundle.js is skipped (already a minified production build).
//   - test-*.js files are skipped (developer-only, not referenced at runtime).
//   - netlify/functions are skipped (serverless; already small).
//   - a file is only overwritten when esbuild parses it successfully AND the
//     result is actually smaller; otherwise the original is left untouched.
//   - Always run from a version-controlled copy or a backup of the sources;
//     this rewrites files in place.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "netlify", "tools"]);
const SKIP_FILES = new Set(["app-bundle.js", "app-analytics.js", "widget-nav.css", "storage-watch-bus.js", "service-worker.js", "build.mjs", "serve.mjs"]);

function findEsbuild() {
  const candidates = [
    process.env.ESBUILD,
    path.join(root, "node_modules", ".bin", "esbuild" + (process.platform === "win32" ? ".cmd" : "")),
    "/tmp/perf-bench/node_modules/.bin/esbuild",
    path.join(root, "..", "tools", "package", "esbuild.exe")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  console.error("esbuild not found. Install it (`npm i -D esbuild`) or set $ESBUILD.");
  process.exit(1);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const esbuild = findEsbuild();
const files = walk(root, []);
let beforeTotal = 0;
let afterTotal = 0;
let changed = 0;
let skipped = 0;

for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const isJs = ext === ".js" || ext === ".mjs";
  const isCss = ext === ".css";
  if (!isJs && !isCss) continue;
  if (SKIP_FILES.has(path.basename(file))) continue;
  if (path.basename(file).startsWith("test-")) continue;

  const source = readFileSync(file);
  const result = spawnSync(esbuild, [file, "--minify", "--charset=utf8", "--legal-comments=none"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0 || !result.stdout || !result.stdout.length) {
    console.warn("SKIP (parse/transform failed):", path.relative(root, file));
    if (result.stderr && result.stderr.length) console.warn("   ", result.stderr.toString().split("\n")[0]);
    skipped++;
    continue;
  }
  const minified = result.stdout;
  if (minified.length < source.length) {
    writeFileSync(file, minified);
    beforeTotal += source.length;
    afterTotal += minified.length;
    changed++;
    console.log(
      "minified",
      path.relative(root, file).padEnd(60),
      (source.length / 1024).toFixed(1).padStart(8) + " KB ->",
      (minified.length / 1024).toFixed(1) + " KB"
    );
  } else {
    skipped++;
  }
}

console.log(
  `\nDone. ${changed} files minified, ${skipped} skipped. ` +
  `JS/CSS payload: ${(beforeTotal / 1024).toFixed(0)} KB -> ${(afterTotal / 1024).toFixed(0)} KB ` +
  `(${(100 - (afterTotal / Math.max(beforeTotal, 1)) * 100).toFixed(1)}% smaller).`
);
