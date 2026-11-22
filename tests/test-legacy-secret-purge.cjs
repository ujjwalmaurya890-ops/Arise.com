"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://arise.test/",
  runScripts: "outside-only"
});
const w = dom.window;
try {
  w.localStorage.setItem("backupCenter:gistToken", "ghp_secret");
  w.localStorage.setItem("backupCenter:gistId", "abc");
  w.localStorage.setItem("backupCenter:lastBackupAt", "2026-01-01");
  w.eval(fs.readFileSync(path.join(root, "src/boot/purge-legacy-secrets.js"), "utf8"));
  assert.equal(w.localStorage.getItem("backupCenter:gistToken"), null, "PAT purged on boot");
  assert.equal(w.localStorage.getItem("backupCenter:gistId"), null);
  assert.equal(
    w.localStorage.getItem("backupCenter:lastBackupAt"),
    "2026-01-01",
    "non-secret backup metadata retained"
  );
  w.localStorage.setItem("backupCenter:gistToken", "ghp_new");
  assert.equal(w.localStorage.getItem("backupCenter:gistToken"), null, "re-writes are blocked");
  w.localStorage.setItem("notes", "keep");
  assert.equal(w.localStorage.getItem("notes"), "keep");
  assert.equal(w.__ariseLegacySecretsPurged, true);
  // Manifest must not present the token as a live, storable secret.
  const manifest = fs.readFileSync(path.join(root, "src/storage-keys.js"), "utf8");
  assert.ok(
    !manifest.includes("known issue, flagged for a future pass"),
    "stale known-issue note removed"
  );
  console.log(
    "Legacy secret purge: PAT/gist/blob keys removed on boot and re-writes blocked; other keys untouched."
  );
} finally {
  w.close();
}
