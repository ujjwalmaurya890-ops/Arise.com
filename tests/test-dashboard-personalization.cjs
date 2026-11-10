/**
 * tests/test-dashboard-personalization.cjs
 * ---------------------------------------------------------------------------
 * Contribution 03 — dashboard card personalization
 * (src/dashboard-personalization.js).
 *
 * The dashboard's card stack belongs to the compiled React shell, so nothing
 * here re-orders the loader or clones widgets. The pass re-orders and hides the
 * existing cards, remembers the choice, and can put the real default back.
 *
 * Covered:
 *   1. stable card identity (element id, else a label slug) — moving a card must
 *      not re-key the others;
 *   2. reorder (up/down/to top), pin (pinned sort first), hide (hidden + inert,
 *      never removed), and persistence across a reload;
 *   3. reset() restores the ORIGINAL author order and drops the stored key;
 *   4. unknown/corrupt stored preferences are ignored rather than applied;
 *   5. the panel is a labelled modal with a focus trap, Escape dismissal and a
 *      visible count, and every control has an accessible name;
 *   6. one shared announcement region, and the storage key is syncable.
 *
 * Run: node tests/test-dashboard-personalization.cjs
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

const SHELL = `<!doctype html><html><body>
  <div id="arise-main">
    <header><h1>Dashboard</h1></header>
    <div class="flex-1 p-5 max-w-7xl">
      <div class="space-y-6">
        <div class="relative overflow-hidden rounded-2xl"><h3>Greeting</h3></div>
        <div class="grid grid-cols-5"><div>Streak</div></div>
        <div class="glass-card rounded-2xl p-5"><h3>Developer Readiness</h3></div>
        <div id="arise-career-readiness-slot" class="arise-readiness-widget-reserve"></div>
        <div class="glass-card rounded-2xl p-5"><h3>Quick Actions</h3></div>
        <div class="glass-card rounded-2xl p-5"><h3>XP Progress</h3></div>
      </div>
    </div>
  </div>
  <button id="outside">Outside</button>
</body></html>`;

function boot(storage) {
  const dom = new JSDOM(SHELL, { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  for (const [key, value] of Object.entries(storage || {})) w.localStorage.setItem(key, value);
  w.eval(read("src/dashboard-personalization.js"));
  return w;
}

const stackOf = (w) => w.document.querySelector("#arise-main .space-y-6");
const keysOf = (w) => [...stackOf(w).children].map((el) => el.getAttribute("data-arise-card-key"));
const labelsOf = (w) => [...stackOf(w).children].map((el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 22));
const card = (w, matcher) => w.AriseDashboardLayout.cards().find((entry) => matcher.test(entry.label));

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const layout = w.AriseDashboardLayout;
  ok(layout.storageKey === "arise-dashboard-layout-v1", "storage key is documented and stable");
  ok(layout.cards().length === 6, "all six dashboard cards are discovered");
  const keys = layout.cards().map((entry) => entry.key);
  ok(new Set(keys).size === keys.length, "every discovered card has a unique key");
  ok(keys.includes("id:arise-career-readiness-slot"), "a card with an id keeps it as its identity");
  ok(keys.includes("label:quick-actions"), "a card without an id is keyed by its visible heading");

  // Identity must survive a move: the OTHER cards keep their keys.
  const before = keys.filter((key) => key !== "label:quick-actions");
  layout.move("label:quick-actions", 0);
  const after = layout.cards().map((entry) => entry.key).filter((key) => key !== "label:quick-actions");
  ok(JSON.stringify(before.sort()) === JSON.stringify(after.sort()), "moving one card does not re-key the others");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const layout = w.AriseDashboardLayout;

  layout.move("label:xp-progress", 0);
  ok(keysOf(w)[0] === "label:xp-progress", "move(key, 0) sends a card to the top");
  layout.move("label:xp-progress", 1);
  ok(keysOf(w)[1] === "label:xp-progress", "move(key, 1) moves a card down exactly one slot");
  layout.move("label:xp-progress", -1);
  ok(keysOf(w)[0] === "label:xp-progress", "move(key, -1) moves it back up");

  layout.pin("label:quick-actions");
  ok(keysOf(w)[0] === "label:quick-actions", "a pinned card sorts before unpinned cards");
  ok(w.document.querySelector('[data-arise-card-key="label:quick-actions"]').getAttribute("data-arise-card-pinned") === "true",
    "a pinned card is marked with data-arise-card-pinned");
  layout.pin("label:quick-actions");
  ok(w.document.querySelector('[data-arise-card-key="label:quick-actions"]').getAttribute("data-arise-card-pinned") === null,
    "unpinning removes the marker");

  layout.toggle("label:developer-readiness");
  const hiddenCard = w.document.querySelector('[data-arise-card-key="label:developer-readiness"]');
  ok(hiddenCard.hidden === true && hiddenCard.getAttribute("data-arise-card-hidden") === "true",
    "hiding a card flags it hidden instead of removing it");
  ok(hiddenCard.isConnected && stackOf(w).contains(hiddenCard), "a hidden card stays in the DOM so its widget keeps running");
  layout.toggle("label:developer-readiness");
  ok(hiddenCard.hidden === false && hiddenCard.getAttribute("data-arise-card-hidden") === null, "showing it again restores the card");

  const stored = JSON.parse(w.localStorage.getItem("arise-dashboard-layout-v1"));
  ok(stored.version === 1 && Array.isArray(stored.order) && Array.isArray(stored.hidden) && Array.isArray(stored.pinned),
    "the stored preference has an explicit version and three lists");

  const order = keysOf(w);
  w.close();

  const reloaded = boot({ "arise-dashboard-layout-v1": JSON.stringify({ version: 1, order, hidden: [], pinned: ["label:quick-actions"] }) });
  ok(keysOf(reloaded)[0] === "label:quick-actions", "the saved order and pins are re-applied on the next load");
  reloaded.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const layout = w.AriseDashboardLayout;
  const authorOrder = labelsOf(w);
  layout.move("label:xp-progress", 0);
  layout.toggle("label:streak");
  layout.pin("label:greeting");
  ok(JSON.stringify(labelsOf(w)) !== JSON.stringify(authorOrder), "the dashboard actually changed");
  layout.reset();
  ok(JSON.stringify(labelsOf(w)) === JSON.stringify(authorOrder), "reset restores the original author order");
  ok([...stackOf(w).children].every((el) => !el.hidden && !el.hasAttribute("data-arise-card-key") && !el.hasAttribute("data-arise-card-pinned")),
    "reset clears the hidden/pinned markers");
  ok(w.localStorage.getItem("arise-dashboard-layout-v1") === null, "reset removes the stored preference");
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  const w = boot({ "arise-dashboard-layout-v1": "{not valid json" });
  ok(w.AriseDashboardLayout.cards().every((entry) => !entry.hidden), "corrupt stored JSON is ignored, not applied");
  w.close();

  const w2 = boot({
    "arise-dashboard-layout-v1": JSON.stringify({ version: 1, order: ["label:no-such-card", "label:xp-progress"], hidden: ["label:ghost", 42, null], pinned: "nope" })
  });
  const cards = w2.AriseDashboardLayout.cards();
  ok(cards.every((entry) => !entry.hidden), "hidden keys that match no live card are dropped");
  ok(cards.every((entry) => !entry.pinned), "a non-array pinned value is ignored");
  ok(cards.every((entry) => entry.key !== "label:no-such-card"), "unknown order keys are never materialised as cards");
  ok(keysOf(w2)[0] === "label:xp-progress", "known keys from a partially stale order still apply");
  w2.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const layout = w.AriseDashboardLayout;
  layout.open();
  const panel = w.document.getElementById("adl-panel");
  ok(!!panel && panel.getAttribute("data-open") === "true", "open() shows the personalize panel");
  const dialog = panel.querySelector('[role="dialog"]');
  ok(dialog && dialog.getAttribute("aria-modal") === "true" && dialog.getAttribute("aria-labelledby") === "adl-title",
    "the panel is a labelled modal dialog");
  ok(panel.querySelectorAll(".adl-row").length === 6, "every card has a row");
  const buttons = [...panel.querySelectorAll("button")];
  ok(buttons.every((button) => (button.getAttribute("aria-label") || button.textContent || "").trim().length > 0),
    "every panel control has an accessible name");
  ok(/6 of 6 cards visible/.test(panel.querySelector(".adl-status").textContent), "the panel reports how many cards are visible");

  // Escape closes and focus returns to whatever opened it.
  const opener = w.document.getElementById("outside");
  opener.focus();
  panel.__previous = opener;
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(panel.getAttribute("data-open") === "false", "Escape closes the panel");
  ok(w.document.activeElement === opener, "focus returns to the element that opened the panel");

  layout.open();
  panel.querySelector('.adl-row[data-key="label:quick-actions"] [data-adl="toggle"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const row = panel.querySelector('.adl-row[data-key="label:quick-actions"]');
  ok(row && row.getAttribute("data-hidden") === "true", "the row reflects a hidden card");
  ok(/5 of 6 cards visible/.test(panel.querySelector(".adl-status").textContent), "the count updates after hiding");
  ok(!!panel.querySelector('[data-adl="reset"]'), "the panel offers a reset control");
  panel.querySelector('[data-adl="close"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  ok(panel.getAttribute("data-open") === "false", "the Done control closes the panel");

  ok(w.document.querySelectorAll('[data-ars-live="polite"], .adl-sr-only').length >= 1, "changes are announced in a live region");
  w.close();
}

/* ------------------------------------------------------------------ suite 6 */
{
  const w = boot();
  const layout = w.AriseDashboardLayout;
  layout.open();
  const panel = w.document.getElementById("adl-panel");
  const focusables = [...panel.querySelectorAll("button")];
  focusables.at(-1).focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  ok(w.document.activeElement === focusables[0], "Tab from the last control wraps to the first");
  focusables[0].focus();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  ok(w.document.activeElement === focusables.at(-1), "Shift+Tab from the first control wraps to the last");
  w.close();

  const html = read("index.html");
  ok(/dashboard-personalization\.css/.test(html) && /dashboard-personalization\.js/.test(html),
    "the module and its stylesheet are registered in index.html");
  ok(/"arise-dashboard-layout-v1"/.test(read("src/cloud/storage-schema.js")), "the layout key is syncable");
  ok(/dashboard-personalization/.test(read("src/storage-keys.js")), "the layout key is documented in the key manifest");
  ok(/Personalize Dashboard/.test(read("src/premium-productivity-features.js")),
    "the command palette can open the panel");
}

console.log("\nDashboard personalization: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) process.exit(1);
