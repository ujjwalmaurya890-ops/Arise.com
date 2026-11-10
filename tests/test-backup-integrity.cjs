/**
 * tests/test-backup-integrity.cjs
 * ---------------------------------------------------------------------------
 * Contribution 14 — backup integrity (src/backup-integrity.js).
 *
 * Restore used to ask one question: "does this backup belong to you?" Nothing
 * inspected the file, so a truncated export and a hand-edited one looked exactly
 * like a good backup until the restore had already replaced the user's stores.
 *
 * The report must:
 *   1. block on files that cannot be restored (no stores, declared counts that
 *      do not match, oversized files, broken ownership metadata is a warning);
 *   2. warn about empty stores, malformed attachment entries and unknown stores
 *      without blocking a legitimate restore;
 *   3. never write: no localStorage, no confirm(), no navigation;
 *   4. render inside the existing backup card, above the controls.
 *
 * Run: node tests/test-backup-integrity.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed += 1;
  else { failures.push(label); console.error("  FAIL  " + label); }
}

const SCHEMA_KEYS = ["achievements", "arise-cgpa", "dsaQuestions", "notes", "projects", "focusSessionsV2", "streak"];

function boot(body) {
  const dom = new JSDOM("<!doctype html><html><body>" + (body || '<section class="cloud-card"><div class="bkc-wrap"><h2>Backup &amp; secure cloud sync</h2></div></section>') + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.AriseSyncSchema = { keys: SCHEMA_KEYS };
  w.eval(read("src/backup-integrity.js"));
  return w;
}

const good = (extra) => Object.assign({
  meta: { version: "2", exportedAt: "2026-11-10T09:00:00.000Z", ownerUid: "uid-1", counts: { localStorage: 3 } },
  localStorage: { achievements: [{ id: "a" }], dsaQuestions: [{ id: "q1" }, { id: "q2" }], notes: [{ id: "n" }] },
  indexedDB: []
}, extra || {});

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const A = w.AriseBackupIntegrity;
  const report = A.inspect(good());
  ok(report.ok === true && report.severity === "ok", "a complete backup passes: " + report.severity);
  ok(report.blocking.length === 0, "a complete backup has nothing blocking");
  ok(report.stats.stores === 3, "the store count is real: " + report.stats.stores);
  ok(report.stats.records === 4, "records are counted: " + report.stats.records);
  ok(report.stats.knownStores === 3, "known stores are separated from unknown ones");
  ok(report.stats.owner === "uid-1" && report.stats.exportedAt === "2026-11-10T09:00:00.000Z",
    "ownership and export time are reported");
  ok(report.stats.missingStores.length === SCHEMA_KEYS.length - 3, "stores absent from the file are listed");
  ok(report.warnings.length === 0, "a clean file has no warnings: " + JSON.stringify(report.warnings));
  const lines = A.summarise(report);
  ok(lines[0].includes("3 of " + SCHEMA_KEYS.length), "the summary states coverage: " + lines[0]);
  ok(lines.some((line) => /Exported 2026-11-10/.test(line)), "the summary states the export time");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const A = w.AriseBackupIntegrity;

  const truncated = A.inspect(good({ meta: { version: "2", ownerUid: "uid-1", counts: { localStorage: 9 } } }));
  ok(truncated.ok === false && /only 3 are present/.test(truncated.blocking[0]),
    "a truncated file is blocked by its own header: " + truncated.blocking[0]);
  ok(/export it again/i.test(truncated.blocking[0]), "the message says what to do instead");

  ok(A.inspect(null).ok === false, "a non-object file is blocked");
  ok(/not a readable Arise backup/.test(A.inspect("nope").blocking[0]), "a string is not a backup");
  ok(A.inspect({ meta: {} }).blocking.some((line) => /no store data/.test(line)), "a file without stores is blocked");
  ok(A.inspect({ localStorage: {} }).blocking.some((line) => /contains no stores/.test(line)), "an empty store map is blocked");

  const legacy = A.inspect({ localStorage: { notes: [{ id: "n" }] }, indexedDB: [] });
  ok(legacy.ok === true, "a legacy export without metadata is restorable");
  ok(legacy.notes.some((line) => /no metadata header/i.test(line)), "legacy exports are called out");
  ok(legacy.notes.some((line) => /confirm ownership/i.test(line)), "ownership still has to be confirmed for legacy files: " + JSON.stringify(legacy.notes));
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const A = w.AriseBackupIntegrity;

  // honest header: the counts describe the stores the file actually carries
  const risky = A.inspect({ meta: { version: "2", ownerUid: "uid-1", counts: { localStorage: 1 } },
    localStorage: { achievements: [], dsaQuestions: [], notes: [], "made-up-key": { a: 1 } }, indexedDB: [] });
  ok(risky.ok === true && risky.severity === "warning", "an empty but readable backup is a warning, not a block: " + risky.severity);
  ok(risky.warnings.some((line) => /3 stores are empty/.test(line)), "empty stores are counted: " + risky.warnings[0]);
  ok(risky.warnings.some((line) => /replace what you have with nothing/.test(line)), "the consequence is stated plainly");
  ok(risky.notes.some((line) => /not part of this build/.test(line)), "unknown stores are noted and ignored");
  ok(risky.stats.unknownStores[0] === "made-up-key", "the unknown store is named");

  const attachments = A.inspect(good({ indexedDB: [
    { name: "arise-files", stores: { files: { records: [
      { value: { id: "f1", blob: { $ariseBlob: 1, data: "AAAA" } } },
      { value: { id: "f2" } }
    ] } } },
    "not-an-object"
  ] }));
  ok(attachments.stats.attachments === 2, "attachment records are counted: " + attachments.stats.attachments);
  ok(attachments.warnings.some((line) => /no file bytes and cannot be restored/.test(line)), "a missing file body is a warning: " + JSON.stringify(attachments.warnings));
  ok(attachments.warnings.some((line) => /malformed and will be skipped/.test(line)), "a malformed database entry is a warning, not a crash: " + JSON.stringify(attachments.warnings));
  ok(attachments.stats.malformedDatabases === 1, "malformed database entries are counted");
  ok(attachments.stats.attachmentBytes > 0, "attachment bytes are estimated: " + attachments.stats.attachmentBytes);

  const noDbList = A.inspect(good({ indexedDB: undefined }));
  ok(noDbList.warnings.some((line) => /does not list attachment databases/.test(line)),
    "an absent attachment section is reported");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot();
  const A = w.AriseBackupIntegrity;
  const current = { achievements: [{ id: "x" }], notes: [{ id: "n" }], streak: 5 };
  const diff = A.compare(current, { localStorage: { achievements: [{ id: "y" }], notes: [], dsaQuestions: [] } });
  ok(diff.replaced.includes("achievements") && diff.replaced.includes("notes"), "replaced stores are listed");
  ok(diff.added.includes("dsaQuestions"), "stores the file adds are listed");
  ok(diff.emptied.includes("notes"), "a store that would be emptied is called out: " + diff.emptied);
  ok(!diff.emptied.includes("achievements"), "a store with content is not reported as emptied");
  ok(A.compare({}, { localStorage: {} }).replaced.length === 0, "comparing with nothing is safe");

  // Read-only: inspecting must not touch storage, confirm or navigate.
  const source = read("src/backup-integrity.js");
  ok(!/localStorage\.setItem|localStorage\.removeItem|\.clear\(\)/.test(source), "the inspector never writes to storage");
  ok(!/window\.confirm\s*\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")), "the inspector never opens a dialog");
  ok(!/location\.reload|location\.assign/.test(source), "the inspector never navigates");
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const A = w.AriseBackupIntegrity;
  const report = A.inspect({ meta: { version: "2", ownerUid: "uid-1", counts: { localStorage: 1 } },
    localStorage: { achievements: [], notes: [{ id: "n" }], dsaQuestions: [] }, indexedDB: [] });
  ok(A.show(report, "arise-backup-2026-11-10.json") === true, "the report renders inside the backup card");

  const doc = w.document;
  const card = doc.querySelector(".bkc-wrap");
  const node = doc.getElementById("bki-report");
  ok(!!node && node.parentElement === card, "it mounts in the existing backup card");
  const heading = card.querySelector("h1, h2");
  ok(heading && heading.nextSibling === node, "it is placed directly below the card heading, above the controls");
  ok(node.getAttribute("role") === "status" && node.getAttribute("aria-live") === "polite", "it is announced politely");
  ok(node.getAttribute("data-severity") === "warning", "the severity is exposed for styling");
  ok(/Backup check — arise-backup-2026-11-10.json/.test(node.textContent), "the file name is part of the report");
  ok(node.querySelectorAll(".bki-stat").length === 4, "the stat chips render");
  ok(/2 stores are empty/.test(node.textContent), "the warning text is in the DOM");
  ok(/Nothing has been restored/.test(node.textContent), "the report states that nothing changed yet");

  A.show(A.inspect(good()), "second.json");
  ok(doc.querySelectorAll("#bki-report").length === 1, "re-showing replaces the report instead of stacking it");
  ok(doc.getElementById("bki-report").getAttribute("data-severity") === "ok", "the replacement updates the severity");
  ok(A.clear() === true && !doc.getElementById("bki-report"), "clear() removes the report");
  ok(A.last() === null, "clear() forgets the last report");

  const empty = boot("<div id='arise-main'></div>");
  ok(empty.AriseBackupIntegrity.show(empty.AriseBackupIntegrity.inspect(good())) === false,
    "with no backup card the report is skipped instead of appended anywhere");
  empty.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const html = read("index.html");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));
  const css = read("styles/backup-integrity.css");
  const widget = read("src/backup-center-widget.js");
  const controller = read("src/cloud/auth-controller.js");

  ok(html.includes("'./src/backup-integrity.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(html.includes('href="./styles/backup-integrity.css"'), "the stylesheet is linked");
  ok(sw.includes("./src/backup-integrity.js") && sw.includes("./styles/backup-integrity.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");
  ok(/AriseBackupIntegrity\.inspect\(raw\)/.test(widget), "the restore flow inspects the parsed file");
  ok(widget.indexOf("AriseBackupIntegrity.inspect") < widget.indexOf("auth().importBackup(raw)"),
    "the inspection happens before anything is restored");
  ok(/report\.blocking\.length/.test(widget), "a blocking report stops the restore");
  ok(/I confirm that this backup belongs to/.test(controller), "the existing ownership confirmation is untouched");
  ok(/archiveRecovery/.test(controller), "the before-restore copy is still created");
  ok(/@media \(max-width: 680px\)/.test(css), "small screens are handled");
  ok(!/\.cloud-card\s*\{/.test(css), "the stylesheet cannot restyle the backup card itself");
}

console.log("\nBackup integrity: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
