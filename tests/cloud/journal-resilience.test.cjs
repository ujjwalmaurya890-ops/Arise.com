/**
 * tests/cloud/journal-resilience.test.cjs
 * ---------------------------------------------------------------------------
 * The journal in src/cloud/storage-bridge.js is the only local record of a
 * mutation that has not reached the server yet: a tab that dies mid-write can
 * leave a truncated (or older-format) value behind.
 *
 * Before this test, recover() called JSON.parse() on every journal value with
 * no guard, so ONE bad entry threw out of recoverJournal() -> initialize() and
 * the account never synced again. cleanJournal() had the same blind parse and
 * could throw out of the flush path every time it retried that marker.
 *
 * This test covers: unparsable values, non-object values, wrong-shaped
 * objects, invalid opIds/dates, file-journal requirements, valid entries still
 * being reported in order, quarantine bookkeeping, and cleanJournal not
 * throwing when the marker is corrupt.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "../..");
// Values come out of the jsdom realm, so compare them structurally.
const plain = (value) => JSON.parse(JSON.stringify(value));

function boot() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const w = dom.window;
  // Capture the raw store BEFORE the bridge installs its account-scoped
  // facade over window.localStorage; journal keys live in the raw store.
  const native = w.localStorage;
  Object.defineProperty(w, "crypto", { value: crypto });
  w.eval(fs.readFileSync(path.join(root, "src/cloud/storage-schema.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "src/cloud/storage-bridge.js"), "utf8"));
  const storage = w.AriseStorage;
  storage.activate("uid-1");
  return { w, storage, native };
}

const journalKey = (key, file) =>
  "arise:" + (file ? "file-journal:" : "journal:") + encodeURIComponent("uid-1") + ":" + encodeURIComponent(key);

const entry = (overrides) =>
  JSON.stringify(Object.assign({
    key: "notes",
    opId: "0123456789abcdef",
    baseVersion: 3,
    occurredAt: "2026-01-02T03:04:05.000Z",
    journalKind: "local"
  }, overrides || {}));

test("a truncated journal value no longer throws out of recoverJournal", () => {
  const b = boot();
  b.native.setItem(journalKey("notes"), '{"key":"notes","opId":"abc"');
  assert.doesNotThrow(() => b.storage.recoverJournal());
  assert.deepEqual(plain(b.storage.recoverJournal()), []);
  // Quarantine bookkeeping is cumulative: a corrupt marker is reported on
  // every scan so the UI can keep showing it until it is dealt with.
  assert.equal(b.storage.journalHealth().count, 2);
});

test("non-object, wrong-shaped and unidentifiable entries are dropped, not trusted", () => {
  const b = boot();
  const cases = {
    array: "[1,2,3]",
    nullish: "null",
    string: '"notes"',
    number: "42",
    noKey: JSON.stringify({ opId: "0123456789abcdef", occurredAt: "2026-01-02T03:04:05.000Z" }),
    badKey: entry({ key: "../../etc/passwd" }),
    badOpId: entry({ opId: "" }),
    badDate: entry({ occurredAt: "not-a-date" }),
    noDate: JSON.stringify({ key: "notes", opId: "0123456789abcdef" })
  };
  for (const [name, raw] of Object.entries(cases)) b.native.setItem(journalKey(name), raw);
  assert.deepEqual(plain(b.storage.recoverJournal()), []);
  assert.equal(b.storage.journalHealth().count, Object.keys(cases).length);
});

test("valid entries still round-trip, in occurrence order, and survive one bad neighbour", () => {
  const b = boot();
  // Write through the facade so the value lands under the account prefix.
  b.w.localStorage.setItem("notes", JSON.stringify(["kept"]));
  b.native.setItem(journalKey("notes"), entry({ occurredAt: "2026-01-02T03:04:05.000Z", opId: "bbbbbbbbbbbbbbbb" }));
  b.native.setItem(journalKey("expenses"), entry({ key: "tasks", occurredAt: "2026-01-01T00:00:00.000Z", opId: "aaaaaaaaaaaaaaaa" }));
  b.native.setItem(journalKey("tasks"), "{{{ broken");
  const recovered = b.storage.recoverJournal();
  assert.deepEqual(plain(recovered.map((item) => item.key)), ["tasks", "notes"]);
  assert.equal(recovered[1].value, JSON.stringify(["kept"]));
  assert.equal(b.storage.journalHealth().count, 1);
});

test("a file journal entry must carry database and id", () => {
  const b = boot();
  b.native.setItem(journalKey("idb:arise-local-files-db-v1:WyJzdHJpbmciLCJmMSJd", true), entry({ key: "idb:arise-local-files-db-v1:WyJzdHJpbmciLCJmMSJd", journalKind: "file" }));
  assert.deepEqual(plain(b.storage.recoverFileJournal()), []);
  b.native.setItem(journalKey("idb:arise-local-files-db-v1:WyJzdHJpbmciLCJmMSJd", true), entry({ key: "idb:arise-local-files-db-v1:WyJzdHJpbmciLCJmMSJd", database: "arise-local-files-db-v1", id: "f1", journalKind: "file" }));
  assert.equal(b.storage.recoverFileJournal().length, 1);
});

test("cleanJournal does not throw on a corrupt marker and does not remove it by accident", () => {
  const b = boot();
  b.native.setItem(journalKey("notes"), "not json at all");
  let removed;
  assert.doesNotThrow(() => { removed = b.storage.cleanJournal("notes", "0123456789abcdef", "local"); });
  assert.equal(removed, false);
  assert.ok(b.native.getItem(journalKey("notes")), "an unreadable marker must be left for the user, not silently deleted");
  assert.equal(b.storage.journalHealth().count, 1);
});

test("cleanJournal removes only the matching op", () => {
  const b = boot();
  b.native.setItem(journalKey("notes"), entry({ opId: "0123456789abcdef" }));
  assert.equal(b.storage.cleanJournal("notes", "ffffffffffffffff", "local"), false);
  assert.ok(b.native.getItem(journalKey("notes")));
  assert.equal(b.storage.cleanJournal("notes", "0123456789abcdef", "local"), true);
  assert.equal(b.native.getItem(journalKey("notes")), null);
});

test("a negative or non-numeric baseVersion is normalised instead of poisoning arithmetic", () => {
  const b = boot();
  b.native.setItem(journalKey("notes"), entry({ baseVersion: "banana" }));
  const [recovered] = b.storage.recoverJournal();
  assert.equal(recovered.baseVersion, 0);
  b.native.setItem(journalKey("tasks"), entry({ key: "tasks", baseVersion: -4 }));
  const byKey = Object.fromEntries(b.storage.recoverJournal().map((item) => [item.key, item]));
  assert.equal(byKey.tasks.baseVersion, 0);
  assert.equal(byKey.notes.baseVersion, 0);
});

test("sync-engine initialize survives a corrupt journal and still queues valid work", async () => {
  const { CloudSync } = await import("file://" + path.join(root, "src/cloud/sync-engine.js"));
  const b = boot();
  b.native.setItem(journalKey("notes"), "{ broken");
  b.native.setItem(journalKey("tasks"), entry({ key: "tasks", opId: "cccccccccccccccc" }));
  b.native.setItem("arise:account:" + encodeURIComponent("uid-1") + ":" + encodeURIComponent("tasks"), JSON.stringify([{ id: 1 }]));
  const saved = [];
  const schema = b.w.AriseSyncSchema;
  const engine = new CloudSync({
    schema,
    storage: Object.assign({}, b.storage, {
      uid: "uid-1",
      load: async () => [],
      save: async (key, value) => { saved.push([key, value]); },
      snapshot: async () => ({ localStorage: {} }),
      localSnapshot: () => ({}),
      apply: () => {},
      files: async () => []
    }),
    request: async () => ({ profile: {}, sequence: 0, records: [] }),
    reload: () => {}
  });
  await assert.doesNotReject(() => engine.initialize());
  // The engine only queues journals for the account it is actually bound to.
  assert.equal(engine.uid, "uid-1");
  // initialize() flushes the queue at the end, so the evidence is what it
  // persisted on the way there: the valid journal entry must have been in it.
  const queuedKeys = saved
    .filter(([key]) => key === "queue:uid-1")
    .flatMap(([, snapshot]) => plain(snapshot).map((op) => op.key));
  assert.ok(queuedKeys.includes("tasks"), "the valid journal entry must still be queued");
});
