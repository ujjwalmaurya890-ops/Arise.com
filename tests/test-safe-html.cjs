"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const dom = new JSDOM('<!doctype html><div id="host"></div>', {
  url: "https://arise.test/",
  runScripts: "outside-only"
});
const w = dom.window;
try {
  w.eval(fs.readFileSync(path.join(root, "src/widget-shared-utils.js"), "utf8"));
  const { sanitizeHTML, setSafeHTML, escapeText } = w.__ariseShared;
  assert.equal(typeof sanitizeHTML, "function");
  // Executable elements and handlers are stripped, benign markup survives.
  const dirty =
    '<p onclick="alert(1)">hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a><a href="https://example.com">ok</a><img src="x" onerror="alert(4)"><iframe src="https://evil.test"></iframe>';
  const clean = sanitizeHTML(dirty);
  assert.ok(!/<script|iframe|onclick|onerror|javascript:/i.test(clean), clean);
  assert.ok(clean.includes("https://example.com"), clean);
  assert.ok(clean.includes("hi") && clean.includes("ok"), clean);
  // setSafeHTML is the only sanctioned innerHTML path for untrusted markup.
  const host = w.document.getElementById("host");
  setSafeHTML(host, "<b>safe</b><script>bad()</script>");
  assert.equal(host.querySelectorAll("script").length, 0);
  assert.equal(host.querySelector("b").textContent, "safe");
  // escapeText remains the default for plain user text.
  assert.equal(escapeText(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  // setHTMLIfChanged sanitizes (shared choke point).
  const el = w.document.createElement("div");
  w.__ariseShared.setHTMLIfChanged(el, "sig1", '<span onclick="x()">y</span>');
  assert.ok(!el.innerHTML.includes("onclick"), el.innerHTML);
  console.log(
    "Safe HTML: sanitizeHTML strips scripts/handlers/unsafe URLs, keeps benign markup, setHTMLIfChanged sanitizes."
  );
} finally {
  w.close();
}
