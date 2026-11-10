/**
 * tests/test-knowledge-assistant.cjs
 * ---------------------------------------------------------------------------
 * Contribution 05 — knowledge assistant (src/knowledge-assistant.js).
 *
 * Notes and Personal Wiki already own their stores, editors, exports and
 * [[wiki links]]. This pass must only LENS those stores:
 *   1. derive notes/pages from the existing keys, ignoring trashed notes;
 *   2. resolve [[links]] to existing pages and surface dangling ones;
 *   3. find backlinks/mentions and near-duplicate content, with reasons;
 *   4. report weak spots (entries nothing links to and that link nowhere);
 *   5. never write to the two source stores — only its own UI key;
 *   6. be a labelled, keyboard-safe dialog whose Open actions go through the
 *      real widget markup instead of a synthetic store write;
 *   7. tolerate corrupt/partial stores without throwing.
 *
 * Run: node tests/test-knowledge-assistant.cjs
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

const NOTES = {
  version: 2,
  folders: [{ id: "f1", name: "General" }, { id: "f2", name: "Ideas" }],
  notes: [
    { id: "n1", folderId: "f1", title: "Graphs Revision", content: "BFS and DFS traversal notes. Kahn's algorithm for topological sort.", tags: ["dsa"], pinned: true, updatedAt: "2026-11-09T10:00:00.000Z" },
    { id: "n2", folderId: "f2", title: "Graphs revision", content: "BFS and DFS traversal notes. Kahn's algorithm for topological sort.", tags: [], updatedAt: "2026-11-08T10:00:00.000Z" },
    { id: "n3", folderId: "f1", title: "Old scratchpad", content: "half an idea about a portfolio site and a terminal theme", tags: [], updatedAt: "2026-10-01T10:00:00.000Z" },
    { id: "n4", folderId: "f1", title: "Deleted draft", content: "gone", tags: [], deletedAt: "2026-11-01T10:00:00.000Z" }
  ]
};

const WIKI = {
  version: 1,
  categories: [{ id: "c1", name: "Home" }, { id: "c2", name: "Ideas" }],
  pages: [
    { id: "p1", categoryId: "c1", title: "Algorithms", content: "Start with [[Graphs Revision]] and then read [[Dynamic Programming]].", pinned: true, updatedAt: "2026-11-10T08:00:00.000Z" },
    { id: "p2", categoryId: "c1", title: "Study Plan", content: "Weekly plan. See [[Algorithms]] and [[Graphs Revision|graph notes]].", updatedAt: "2026-11-07T08:00:00.000Z" },
    { id: "p3", categoryId: "c2", title: "Lonely Page", content: "Nothing points here and this page links nowhere.", updatedAt: "2026-09-01T08:00:00.000Z" }
  ]
};

const WIDGET_MARKUP =
  '<div id="arise-main">' +
  '<div class="na-wrap"><ul class="na-note-list">' +
  '<li class="na-note-item" data-action="select-note" data-id="n1"><span class="na-note-item-title">Graphs Revision</span></li>' +
  '<li class="na-note-item" data-action="select-note" data-id="n3"><span class="na-note-item-title">Old scratchpad</span></li>' +
  "</ul></div>" +
  '<div class="pw-wrap"><ul class="pw-page-list">' +
  '<li class="pw-page-item" data-action="select-page" data-id="p1"><span class="pw-page-item-title">Algorithms</span></li>' +
  '<li class="pw-page-item" data-action="select-page" data-id="p2"><span class="pw-page-item-title">Study Plan</span></li>' +
  "</ul></div></div>";

function boot(storage) {
  const dom = new JSDOM('<!doctype html><html><body>' + WIDGET_MARKUP + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const store = storage || { "arise-notes-app-v1": NOTES, "arise-personal-wiki-v1": WIKI };
  for (const [key, value] of Object.entries(store)) {
    w.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  w.eval(read("src/knowledge-assistant.js"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const data = w.AriseKnowledge.scan();

  ok(data.notes.length === 3, "notes come from the existing store, minus trashed entries: " + data.notes.length);
  ok(!data.notes.some((note) => note.title === "Deleted draft"), "a note with deletedAt is never counted as knowledge");
  ok(data.wiki.length === 3, "wiki pages come from the existing store");
  // p1 has two links, p2 has two, n1..n3 have none.
  ok(data.health.notes === 3 && data.health.wikiPages === 3 && data.health.totalLinks === 4,
    "link total counts every [[link]] in the stored bodies: " + data.health.totalLinks);
  ok(data.health.taggedNotes === 1, "only tagged notes are counted as tagged");
  ok(data.recent[0].id === "p1", "recency is taken from the real updatedAt values: " + data.recent[0].id);
  ok(data.health.lastEdited && data.health.lastEdited.store === "wiki", "the most recent edit is reported with its store");

  const stored = JSON.parse(w.localStorage.getItem("arise-notes-app-v1"));
  ok(stored.notes.length === 4 && stored.version === 2, "scanning never rewrites the notes store");
  const wikiStored = JSON.parse(w.localStorage.getItem("arise-personal-wiki-v1"));
  ok(wikiStored.pages.length === 3, "scanning never rewrites the wiki store");
  ok(w.localStorage.getItem("arise-knowledge-ui-v1") === null, "a read-only scan does not create a UI key");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const data = w.AriseKnowledge.scan();
  const dangling = data.danglingLinks;

  ok(dangling.length === 1 && dangling[0].title === "Dynamic Programming",
    "a [[link]] without a page is reported as broken: " + dangling.map((l) => l.title).join(","));
  ok(dangling[0].fromId === "p1" && dangling[0].fromTitle === "Algorithms", "a broken link remembers where it came from");
  const graphLink = data.links.find((link) => link.label === "graph notes");
  ok(!!graphLink && graphLink.exists && graphLink.title === "Graphs Revision" && graphLink.targetId === "n1",
    "a labelled link resolves by its target title, not its label: " + JSON.stringify(graphLink));
  ok(data.links.filter((link) => link.exists).length === 3, "every link whose target exists is resolved: " + data.links.filter((link) => link.exists).length);

  // The page title matches a NOTE, not a wiki page: linking to notes is fine,
  // but the broken-link list must not claim it is missing.
  ok(!dangling.some((link) => link.title === "Graphs Revision"), "a link that resolves to a real entry is not reported broken");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const data = w.AriseKnowledge.scan();

  const fromP1 = w.AriseKnowledge.relatedTo({ store: "wiki", id: "p1" });
  ok(fromP1.some((item) => item.id === "p2" && item.reason === "links here"),
    "backlinks are discovered from other pages' [[links]]: " + fromP1.map((i) => i.id + ":" + i.reason).join(","));
  ok(fromP1.every((item) => item.reason !== "near-duplicate"), "backlinks do not mix in duplicate noise");
  ok(fromP1.length <= 5, "related results are capped");

  const fromN3 = w.AriseKnowledge.relatedTo({ store: "notes", id: "n3" });
  ok(fromN3.length === 0, "an entry with no references has no related entries");
  ok(w.AriseKnowledge.relatedTo({}) .length === 0, "an unknown/malformed query returns an empty list instead of throwing");
  ok(w.AriseKnowledge.relatedTo({ store: "notes", id: "nope" }).length === 0, "an unknown id returns an empty list");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot();
  const data = w.AriseKnowledge.scan();

  const dup = data.duplicates.find((pair) => pair.a.id === "n1" && pair.b.id === "n2");
  ok(!!dup && dup.sameTitle && dup.similarity >= 0.9, "copies are matched by title and wording: " + JSON.stringify(dup && dup.similarity));
  ok(!data.duplicates.some((pair) => pair.a.id === "n3" || pair.b.id === "n3"), "unrelated notes are not reported as duplicates");
  ok(dup.a.title !== dup.b.title || dup.sameTitle === true, "case-only title differences are still flagged as the same title");

  const orphanIds = data.orphans.map((entry) => entry.id).sort();
  ok(orphanIds.includes("n3"), "an unreferenced note is listed as a weak spot");
  ok(orphanIds.includes("p3"), "an unreferenced page is listed as a weak spot");
  ok(!orphanIds.includes("p1") && !orphanIds.includes("p2"), "linked pages are not weak spots");
  const n3 = data.orphans.find((entry) => entry.id === "n3");
  ok(n3.folder === "General", "weak spots show the folder/page category name, not an id");
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot({
    "arise-notes-app-v1": { version: 2, notes: [
      { id: "x1", title: "Env Setup", content: "Install Node, then run npm ci." },
      { id: "x2", title: "Meeting Notes", content: "Talked about the [[Env Setup]] guide and the [[Missing Page]]." }
    ] },
    "arise-personal-wiki-v1": "corrupt json here"
  });
  const data = w.AriseKnowledge.scan();
  ok(data.wiki.length === 0, "a corrupt wiki store degrades to zero pages");
  ok(data.danglingLinks.length === 1, "broken links are still found from the healthy store");
  ok(data.notes.length === 2, "the healthy notes store is still read");
  const related = w.AriseKnowledge.relatedTo({ store: "notes", id: "x1" });
  ok(related.length === 1 && related[0].reason === "links here", "a note can be linked from another note: " + JSON.stringify(related));

  const w2 = boot({});
  const empty = w2.AriseKnowledge.scan();
  ok(empty.notes.length === 0 && empty.duplicates.length === 0 && empty.orphans.length === 0,
    "an empty browser produces an empty report instead of errors");
  ok(empty.health.lastEdited === null, "an empty report has no last edit");
  w2.AriseKnowledge.open();
  ok(!!w2.document.querySelector(".ka-empty"), "the empty state explains where the data comes from");
  w2.close();
  w2.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot();
  const doc = w.document;
  const launcher = doc.getElementById("ka-launcher");
  ok(!!launcher, "a knowledge launcher exists in the app chrome");
  ok(launcher.getAttribute("aria-haspopup") === "dialog", "the launcher announces that it opens a dialog");
  const badge = launcher.querySelector(".ka-badge");
  ok(!!badge && badge.textContent === "2", "the launcher badge counts broken links + duplicates: " + (badge && badge.textContent));
  ok(!badge.hidden, "the badge is visible when there are issues");

  const clicked = [];
  doc.querySelectorAll(".pw-page-item, .na-note-item").forEach((item) => {
    item.addEventListener("click", () => clicked.push(item.getAttribute("data-id")));
  });

  w.AriseKnowledge.open();
  const panel = doc.getElementById("ka-panel");
  ok(panel.getAttribute("data-open") === "true", "open() shows the panel");
  ok(!!panel.querySelector('[role="dialog"][aria-modal="true"][aria-labelledby="ka-title"]'), "the panel is a labelled modal dialog");
  ok(doc.activeElement === panel.querySelector(".ka-close"), "focus moves into the dialog");
  ok(panel.querySelectorAll("[data-ka-tab]").length === 5, "every view has a tab");
  ok(panel.querySelector("[data-ka-tab='overview']").getAttribute("aria-selected") === "true", "the overview tab is selected first");

  // Broken links tab + create action
  panel.querySelector("[data-ka-tab='links']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(panel.querySelector("[data-ka-tab='links']").getAttribute("aria-selected") === "true", "tabs switch the rendered view");
  ok(/broken|duplicate|weak/.test(panel.querySelector(".ka-status").textContent), "the live status summarises the health numbers");
  const create = panel.querySelector("[data-ka-create]");
  ok(!!create && create.getAttribute("data-ka-create") === "Dynamic Programming", "a broken link offers to create the missing page");
  create.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(/Dynamic Programming/.test(panel.querySelector(".ka-status").textContent),
    "creating a page reports what to do when the wiki is not mounted: " + panel.querySelector(".ka-status").textContent);

  // Duplicates tab: Open A must drive the real widget markup
  panel.querySelector("[data-ka-tab='duplicates']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const openA = panel.querySelector("[data-ka-goto]");
  ok(!!openA, "duplicates offer a way to open each side");
  openA.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(clicked.length === 1, "Open clicks the widget's own item instead of writing a store: " + clicked.join(","));
  ok(!panel.getAttribute("data-open") || panel.getAttribute("data-open") === "false", "opening an entry closes the panel");

  // A stale entry must never open a different note for the user.
  w.AriseKnowledge.open();
  const missing = panel.querySelector("[data-ka-tab='duplicates']");
  missing.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const stale = panel.querySelector("[data-ka-goto]");
  stale.setAttribute("data-ka-goto", "does-not-exist");
  const beforeClicks = clicked.length;
  stale.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(clicked.length === beforeClicks, "a stale id never falls back to clicking an unrelated entry: " + clicked.join(","));
  ok(panel.getAttribute("data-open") === "true", "the panel stays open when the entry could not be opened");
  ok(/Open the (Notes|Wiki) tab/.test(panel.querySelector(".ka-status").textContent), "the panel explains how to reach an entry it cannot open yet");

  // Backlinks list one row per title even when a copy exists.
  panel.querySelector("[data-ka-tab='backlinks']").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const headings = [...panel.querySelectorAll(".ka-block .ka-h")].map((node) => node.textContent.replace(/\s+/g, " ").trim());
  ok(new Set(headings).size === headings.length, "duplicate titles do not double-list backlinks: " + headings.join(" | "));

  // Keyboard safety
  w.AriseKnowledge.open();
  const event = new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  doc.dispatchEvent(event);
  ok(panel.getAttribute("data-open") === "false", "Escape closes the panel");
  ok(panel.getAttribute("aria-hidden") === "true", "the closed panel is hidden from assistive technology");
  ok(doc.activeElement === launcher,
    "focus returns to the launcher instead of the hidden dialog: " + (doc.activeElement && doc.activeElement.id));

  // UI state is the only thing this module persists
  const saved = JSON.parse(w.localStorage.getItem("arise-knowledge-ui-v1"));
  ok(saved && saved.tab === "backlinks" && Object.keys(saved).length === 2, "only the last tab is persisted, nothing else: " + JSON.stringify(saved));
  ok(JSON.parse(w.localStorage.getItem("arise-notes-app-v1")).notes.length === 4, "using the panel never rewrites notes");
  w.close();
}

/* ------------------------------------------------------------------ suite 7 */
{
  const w = boot();
  const html = read("index.html");
  const css = read("styles/knowledge-assistant.css");
  const keys = read("src/storage-keys.js");
  const schema = read("src/cloud/storage-schema.js");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));

  ok(html.includes('href="./styles/knowledge-assistant.css"'), "the stylesheet is linked once from index.html");
  ok(html.includes("'./src/knowledge-assistant.js'"), "the module is registered in the ordered SCRIPTS list");
  ok(html.indexOf("./src/notification-center.js") < html.indexOf("./src/knowledge-assistant.js"), "the loader order stays after the modules it composes with");
  ok(keys.includes("arise-knowledge-ui-v1"), "the UI key is documented in the storage manifest");
  ok(schema.includes("arise-knowledge-ui-v1"), "the UI key is allow-listed for cloud sync");
  ok(sw.includes("./src/knowledge-assistant.js") && sw.includes("./styles/knowledge-assistant.css"), "both assets join the offline extended shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicate entries");
  ok(/prefers-reduced-motion/.test(css), "reduced-motion is respected");
  ok(/@media \(max-width: 680px\)/.test(css), "the panel goes full-screen on small viewports");
  ok(!/\.glass-card|#arise-main/.test(css), "the stylesheet is scoped to .ka-* and cannot restyle widgets");
  ok(typeof w.AriseKnowledge.storageKey === "string" && w.AriseKnowledge.storageKey === "arise-knowledge-ui-v1", "the public storageKey matches the documented key");
  w.close();
}

console.log("\nKnowledge assistant: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
