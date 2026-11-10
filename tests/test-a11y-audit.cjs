/**
 * tests/test-a11y-audit.cjs
 * ---------------------------------------------------------------------------
 * Contribution 11 — accessibility audit (src/a11y-audit.js).
 *
 * The shell shipped a visible "Skip to main content" link whose target was not
 * focusable, and route changes were silent. Both are fixed here, and the audit
 * must stay honest about what it measures.
 *
 * Run: node tests/test-a11y-audit.cjs
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

const PAGE = '<a href="#arise-main" class="arise-skip-link">Skip to main content</a>' +
  '<nav aria-label="Primary"><button>Dashboard</button><button><svg><title>x</title></svg></button></nav>' +
  '<main id="arise-main"><header><h1>Dashboard</h1></header>' +
  '<div class="space-y-6">' +
  '<label>Subject <input id="named-input" type="text"></label>' +
  '<label for="other-input">Credits</label><input id="other-input" type="number">' +
  '<input id="bare-input" type="text">' +
  '<button id="good-btn" aria-label="Refresh data"></button>' +
  '<button id="bare-btn"><svg></svg></button>' +
  '<div role="button" id="role-btn">Open</div>' +
  '<a href="/somewhere" id="bare-link"><svg></svg></a>' +
  '</div></main>';

function boot(html) {
  const dom = new JSDOM("<!doctype html><html><body>" + (html || PAGE) + "</body></html>",
    { url: "https://arise.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // jsdom has no layout: give the live region a deterministic box.
  w.Element.prototype.getBoundingClientRect = function () { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.eval(read("src/a11y-audit.js"));
  // jsdom leaves readyState at "loading" for outside-only scripts, so the real
  // boot path is driven explicitly instead of relying on a load event.
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}

/* ------------------------------------------------------------------ suite 1 */
{
  const w = boot();
  const doc = w.document;
  const main = doc.getElementById("arise-main");

  ok(main.getAttribute("role") === "main", "the route host becomes a main landmark: " + main.getAttribute("role"));
  ok(main.getAttribute("tabindex") === "-1" && main.tabIndex === -1, "the skip target is programmatically focusable");
  ok(main.getAttribute("aria-label") === "Main content", "the landmark is labelled");

  // The skip link must actually move focus, not just the scroll position.
  const link = doc.querySelector("a.arise-skip-link");
  let scrolled = false;
  main.scrollIntoView = function () { scrolled = true; };
  link.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  ok(doc.activeElement === main, "activating the skip link focuses the landmark: " + (doc.activeElement && doc.activeElement.id));
  ok(scrolled, "the landmark is scrolled into view");
  ok(w.location.hash === "#arise-main", "the hash is updated for shareability: " + w.location.hash);
  ok(link.getAttribute("aria-label") === "Skip to main content", "the skip link is labelled for screen readers");
  w.close();
}

/* ------------------------------------------------------------------ suite 2 */
{
  const w = boot();
  const doc = w.document;
  const live = doc.getElementById("arise-a11y-route-live");

  ok(!!live, "a route live region is created");
  ok(live.getAttribute("role") === "status" && live.getAttribute("aria-live") === "polite",
    "the live region is a polite status: " + live.getAttribute("role") + "/" + live.getAttribute("aria-live"));
  ok(live.getAttribute("aria-atomic") === "true", "the live region announces whole messages");
  ok(live.style.position === "absolute" && /(^|;)\s*width:\s*1px/.test(live.style.cssText),
    "it is visually hidden, not display:none (which would silence it): " + live.style.cssText.slice(0, 80));
  ok(!/display/.test(live.style.cssText), "the live region is never given display:none");
  ok(live.textContent === "", "nothing is announced on first paint");

  // A route change speaks once.
  doc.querySelector("#arise-main header h1").textContent = "Analytics";
  ok(w.AriseA11y.audit().route.heading === "Analytics", "the audit reads the current route heading");
  w.AriseA11y.announce("Analytics page");
  ok(live.textContent === "Analytics page", "announce() writes the message");

  // Re-announcing the same text is cleared first so it is spoken again.
  w.AriseA11y.announce("Analytics page");
  ok(live.textContent === "", "a repeat announcement is cleared before being re-said");
  w.close();
}

/* ------------------------------------------------------------------ suite 3 */
{
  const w = boot();
  const report = w.AriseA11y.audit();

  ok(report.main.present && report.main.role === "main" && report.main.focusable, "the landmark is reported as focusable");
  ok(report.skipLink.present && report.skipLink.href === "#arise-main", "the skip link is reported with its target");
  ok(report.live.present && report.live.polite && report.live.atomic && report.live.visuallyHidden,
    "the live region is reported as hidden and polite");

  // Wrapper/for labels count as naming; genuinely bare controls do not.
  ok(report.controls.unnamed === 3, "only genuinely unlabelled controls are flagged: " + report.controls.unnamed);
  ok(report.controls.labelledByWrapper === 2, "wrapper and label[for] associations are counted: " + report.controls.labelledByWrapper);
  ok(report.controls.named === report.controls.total - 3, "named + unnamed equals the total");
  ok(report.controls.positiveTabindex === 0, "no positive tabindex hijacks the tab order");

  const w2 = boot('<main id="arise-main"><header><h1>Settings</h1></header><button tabindex="3">late</button><button tabindex="0">ok</button></main>');
  ok(w2.AriseA11y.audit().controls.positiveTabindex === 1, "a positive tabindex is reported so it can be fixed");
  w2.close();
  w.close();
}

/* ------------------------------------------------------------------ suite 4 */
{
  // No landmark at all: the module must degrade instead of throwing.
  const w = boot('<div id="nothing"><header><h1>Offline</h1></header></div>');
  const report = w.AriseA11y.audit();
  ok(report.main.present === false, "a missing main landmark is reported, not assumed");
  ok(report.skipLink.present === false, "a missing skip link is reported");
  ok(report.live.present === true, "the live region is still available without a landmark");
  ok(w.AriseA11y.announce("still works") === true, "announcing works without a landmark");
  w.AriseA11y.ensureLandmarks();
  w.AriseA11y.ensureLandmarks();
  ok(w.document.querySelectorAll("#arise-a11y-route-live").length === 1, "ensureLandmarks() creates exactly one live region");
  w.close();
}

/* ------------------------------------------------------------------ suite 5 */
{
  const w = boot();
  const html = read("index.html");
  const css = read("styles/a11y-audit.css");
  const sw = JSON.parse(read("scripts/tools/sw-extended-base.json"));
  const source = read("src/a11y-audit.js");

  ok(html.includes('href="./styles/a11y-audit.css"'), "the stylesheet is linked");
  ok(html.includes("'./src/a11y-audit.js'"), "the module is in the ordered SCRIPTS list");
  ok(sw.includes("./src/a11y-audit.js") && sw.includes("./styles/a11y-audit.css"), "both assets join the offline shell");
  ok(new Set(sw).size === sw.length, "the extended shell has no duplicates");

  // The fix must not fight the theme's own focus styling.
  ok(/outline:\s*none/.test(css), "the landmark suppresses its own focus ring");
  ok(!/button\s*\{[^}]*outline:\s*none/.test(css), "the stylesheet never removes focus rings from controls");
  ok(!/display:\s*none/.test(css), "the live region is never display:none");
  ok(!/localStorage\.setItem/.test(source), "the audit writes nothing to storage");
  ok(typeof w.AriseA11y.audit === "function" && w.AriseA11y.liveId === "arise-a11y-route-live", "the public API is complete");
  w.close();
}

console.log("\nAccessibility audit: " + passed + " assertions passed, " + failures.length + " failed.");
if (failures.length) { failures.forEach((label) => console.error(" - " + label)); process.exit(1); }
