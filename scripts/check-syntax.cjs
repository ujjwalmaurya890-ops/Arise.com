#!/usr/bin/env node
"use strict";
// Syntax + formatting gate: every JS/CJS/MJS file must parse, and formatted
// files must match Prettier. Run via `npm run lint` (also in CI).
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dirs = ["src", "server", "netlify/functions", "scripts", "tests"];
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    // The test runner copies CJS tests to `*.runner.cjs` beside the source and
    // deletes them afterwards; a concurrent run must not fail the lint gate.
    else if (entry.name.endsWith(".runner.cjs")) continue;
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) files.push(full);
  }
}
for (const dir of dirs) walk(path.join(root, dir));
let failed = false;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed = true;
    console.error("SYNTAX FAIL:", path.relative(root, file));
    console.error(String(error.stderr || error.message).slice(0, 500));
  }
}
if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} files parse.`);
try {
  execFileSync(
    path.join(root, "node_modules/.bin/prettier"),
    [
      "--check",
      "src/**/*.js",
      "server/*.cjs",
      "netlify/functions/*.js",
      "scripts/**/*.cjs",
      "scripts/**/*.mjs",
      "tests/**/*.cjs",
      "tests/**/*.js"
    ],
    { cwd: root, stdio: "inherit" }
  );
} catch {
  console.error(
    'Formatting drift: run `npx prettier --write "src/**/*.js" "server/*.cjs" "netlify/functions/*.js" "scripts/**/*.cjs" "scripts/**/*.mjs" "tests/**/*.cjs" "tests/**/*.js"`'
  );
  process.exit(1);
}
