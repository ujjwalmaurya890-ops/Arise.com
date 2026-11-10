/**
 * tests/test-command-palette-v2.cjs
 * ---------------------------------------------------------------------------
 * Contribution 01 — command palette upgrade (src/premium-productivity-features.js).
 *
 * The workspace already had ONE command palette (Ctrl/⌘K) with a shared search
 * index. This suite covers what it now adds, and — just as importantly — that it
 * still does not grow a second palette or a second shortcut system:
 *
 *   1. recently-used commands are remembered across sessions (localStorage) and
 *      shown first, without a query;
 *   2. the last five are kept, de-duplicated, and the "Clear Command History"
 *      action wipes both the list and its storage key;
 *   3. the query is highlighted in result titles/previews, and matching is
 *      still case-insensitive substring ranking;
 *   4. the list is a real listbox: options carry ids, the combobox points at the
 *      active option through aria-activedescendant, and Home/End/PageUp/
 *      PageDown/Alt+1-9 work from the search field;
 *   5. exactly one overlay/dialog and one shortcut handler exist (no duplicate
 *      palette), and the stored recents key is cloud-syncable.
 *
 * Run: node tests/test-command-palette-v2.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log("  ok  " + label);
  } else {
    failures.push(label);
    console.error("  FAIL  " + label);
  }
}

const SHELL = `<!doctype html><html><body>
  <div id="arise-main">
    <header><h1>Dashboard</h1><div class="header-actions"></div></header>
    <div class="max-w-7xl">
      <div class="glass-card"><div class="bkc-wrap"></div></div>
    </div>
  </div>
  <div id="arise-desktop-nav">
    <button class="nav-item">Dashboard</button>
    <button class="nav-item">Notes</button>
    <button class="nav-item">Settings</button>
  </div>
</body></html>`;

function boot(storage) {
  const dom = new JSDOM(SHELL, { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.AriseIcons = { svg: () => "" };
  w.scrollTo = () => {};
  for (const [key, value] of Object.entries(storage || {})) w.localStorage.setItem(key, value);
  w.eval(read("src/premium-productivity-features.js"));
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}

function openPalette(w) {
  const overlay = w.document.getElementById("upp-command-overlay");
  overlay.setAttribute("data-open", "true");
  overlay.setAttribute("aria-hidden", "false");
  return overlay;
}

function type(w, value) {
  const input = w.document.getElementById("upp-command-input");
  input.value = value;
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  return input;
}

const items = (w) => [...w.document.querySelectorAll("#upp-command-list [data-upp-palette-item]")];
const titleOf = (el) => el.querySelector(".upp-command-title").textContent;

/* ------------------------------------------------------------------ suites -- */

// 1. Recents are persisted and shown first without a query.
{
  const w = boot({ "arise-command-recents-v1": JSON.stringify(["section:notes & personal wiki"]) });
  openPalette(w);
  type(w, "");
  const sections = [...w.document.querySelectorAll(".upp-command-section-title")].map((el) => el.textContent);
  ok(sections[0] === "Recently used", "with no query the palette opens on a 'Recently used' group");
  ok(titleOf(items(w)[0]) === "Notes & Personal Wiki", "the remembered command is the first result");
  w.close();
}

// 2. Executing an entry moves it to the front, de-duplicated, capped at five.
{
  const seeded = ["section:notes & personal wiki", "section:learning", "section:dsa tracker", "section:projects", "section:expenses"];
  const w = boot({ "arise-command-recents-v1": JSON.stringify(seeded) });
  openPalette(w);
  type(w, "settings");
  const target = items(w).find((el) => titleOf(el).includes("Settings"));
  ok(!!target, "query finds a module result to execute");
  target.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const stored = JSON.parse(w.localStorage.getItem("arise-command-recents-v1"));
  ok(stored.length === 5, "history is capped at five entries");
  ok(stored[0] === "section:settings & backup", "executing an entry promotes it to the front: " + stored[0]);
  ok(new Set(stored).size === stored.length, "history never contains duplicates");
  ok(!stored.includes("section:expenses"), "the oldest entry falls out when the cap is reached");
  w.close();
}

// 3. "Clear Command History" is a real, discoverable action.
{
  const w = boot({ "arise-command-recents-v1": JSON.stringify(["section:notes & personal wiki"]) });
  openPalette(w);
  type(w, "command history");
  const clear = items(w).find((el) => titleOf(el) === "Clear Command History");
  ok(!!clear, "the palette exposes a 'Clear Command History' action");
  clear.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(w.localStorage.getItem("arise-command-recents-v1") === null, "clearing removes the stored history key");
  type(w, "");
  ok(![...w.document.querySelectorAll(".upp-command-section-title")].some((el) => el.textContent === "Recently used"),
    "an empty history no longer shows a 'Recently used' group");
  w.close();
}

// 4. Query highlighting escapes markup and marks every hit.
{
  const w = boot();
  openPalette(w);
  type(w, "note");
  const marks = [...w.document.querySelectorAll("mark.upp-command-hit")];
  ok(marks.length >= 2, "the query is highlighted in several results");
  ok(marks.every((el) => el.textContent.toLowerCase() === "note"), "only the matched text is wrapped");
  type(w, "<img src=x onerror=alert(1)>");
  ok(w.document.querySelectorAll("#upp-command-list img").length === 0, "a hostile query cannot inject markup");
  ok(/No matches/.test(w.document.getElementById("upp-command-list").textContent), "an unmatched query explains itself");
  w.close();
}

// 5. Listbox semantics + active-option tracking.
{
  const w = boot();
  openPalette(w);
  const input = type(w, "");
  const list = w.document.getElementById("upp-command-list");
  ok(list.getAttribute("role") === "listbox", "the result list is a listbox");
  ok(input.getAttribute("role") === "combobox" && input.getAttribute("aria-expanded") === "true",
    "the search field is an expanded combobox");
  ok(input.getAttribute("aria-controls") === "upp-command-list", "the combobox is bound to the listbox");
  const first = input.getAttribute("aria-activedescendant");
  ok(!!first && !!w.document.getElementById(first), "the combobox points at a real active option");
  ok(w.document.getElementById(first).getAttribute("aria-selected") === "true", "the active option is aria-selected");

  const press = (key, init) => input.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key, bubbles: true, cancelable: true }, init)));
  press("ArrowDown");
  const second = input.getAttribute("aria-activedescendant");
  ok(second !== first, "ArrowDown moves the active option");
  press("End");
  const lastId = input.getAttribute("aria-activedescendant");
  ok(lastId === items(w).at(-1).id, "End jumps to the last result");
  press("Home");
  ok(input.getAttribute("aria-activedescendant") === items(w)[0].id, "Home returns to the first result");
  press("PageDown");
  ok(items(w).findIndex((el) => el.id === input.getAttribute("aria-activedescendant")) >= 5,
    "PageDown advances by a page of results");
  press("PageUp");
  ok(items(w).findIndex((el) => el.id === input.getAttribute("aria-activedescendant")) <= 1,
    "PageUp returns towards the top");
  w.close();
}

// 6. Alt+1..9 runs the matching result directly.
{
  const w = boot();
  openPalette(w);
  const input = type(w, "theme");
  const labels = items(w).map(titleOf);
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "2", altKey: true, bubbles: true, cancelable: true }));
  const stored = JSON.parse(w.localStorage.getItem("arise-command-recents-v1") || "[]");
  ok(stored.length === 1, "Alt+2 executes the second result and records it");
  ok(stored[0].endsWith(labels[1].toLowerCase().slice(0, 80)), "the recorded command is the second result: " + stored[0]);
  w.close();
}

// 7. One palette, one shortcut system, one documented shortcut footer.
{
  const w = boot();
  openPalette(w);
  type(w, "");
  ok(w.document.querySelectorAll("#upp-command-overlay").length === 1, "exactly one command overlay exists");
  ok(w.document.querySelectorAll(".upp-command-input").length === 1, "exactly one palette search field exists");
  const footer = w.document.querySelector(".upp-command-foot");
  ok(!!footer && /Alt/.test(footer.textContent) && /Esc/.test(footer.textContent),
    "the dialog documents its own keyboard contract");
  ok(items(w).filter((el) => el.querySelector(".upp-command-key")).length >= 3, "the first nine rows show their Alt shortcut");
  w.close();
}

// 8. The recents key is part of the sync/backup allow-list and the key manifest.
{
  const schema = read("src/cloud/storage-schema.js");
  const keys = read("src/storage-keys.js");
  ok(schema.includes('"arise-command-recents-v1"'), "storage-schema allows the recents key to sync");
  ok(keys.includes("arise-command-recents-v1"), "the key manifest documents the recents key");
}

/* ------------------------------------------------------------------ report -- */
console.log("\nCommand palette v2: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) process.exit(1);
