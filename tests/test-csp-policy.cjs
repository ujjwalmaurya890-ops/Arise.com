/**
 * tests/test-csp-policy.cjs
 * ---------------------------------------------------------------------------
 * netlify.toml shipped `Content-Security-Policy = "base-uri 'self'"` - a policy
 * with no fetch directives, which lets the page load and run script from any
 * origin. The CSP therefore did nothing against the attack it is there to
 * stop: any injected <script> (a dependency, an XSS in a widget's innerHTML
 * path, a compromised third-party asset) executes with full access to the
 * user's study data.
 *
 * This test does two things:
 *   1. asserts the shipped policy is actually restrictive, directive by
 *      directive;
 *   2. derives the required source list FROM the repository, so the policy
 *      cannot silently drift away from what the app really needs (a host the
 *      app starts calling must be added deliberately, not by loosening
 *      default-src to a wildcard).
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ✓ " + name);
  } catch (error) {
    failures.push({ name, error });
    console.error("  ✗ " + name + "\n      " + error.message);
  }
}

/** Pull the Content-Security-Policy value out of netlify.toml. */
function cspValue() {
  const match = toml.match(/Content-Security-Policy\s*=\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(match, "netlify.toml must define a Content-Security-Policy header");
  return match[1];
}

/** Parse "a b; c d" into { a: ['b'], c: ['d'] }. */
function directives(policy) {
  const result = {};
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    result[tokens[0]] = tokens.slice(1);
  }
  return result;
}

const policy = cspValue();
const d = directives(policy);

test("the policy is not a placeholder", () => {
  assert.ok(Object.keys(d).length >= 8, "expected a full policy, found: " + policy);
  assert.ok(d["default-src"], "default-src is the fallback for every unlisted fetch type");
});

test("default-src is 'self' and nothing broader", () => {
  assert.deepEqual(d["default-src"], ["'self'"]);
});

test("script-src blocks remote and evaluated script", () => {
  const script = d["script-src"] || [];
  assert.ok(script.length, "script-src must be explicit, not inherited from a lax default");
  assert.ok(script.includes("'self'"));
  // index.html still ships inline bootstrap blocks, so 'unsafe-inline' stays
  // for now (a nonce needs a per-response generator, which a static header
  // cannot provide). The high-value half of the directive is still enforced:
  assert.ok(!script.includes("'unsafe-eval'"), "the bundles do not use eval or new Function");
  assert.ok(!script.includes("*"), "no wildcard");
  assert.ok(!script.some((source) => source.startsWith("http") || source.startsWith("//")),
    "loading a script from another origin is the payload this policy exists to block: " + script.join(" "));
  assert.ok(!script.includes("data:") && !script.includes("blob:"), "no script may be built from an inline data/blob payload");
});

test("no page markup still relies on inline event-handler attributes", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // Inline on*="" attributes are ignored under a policy without script
  // 'unsafe-inline' - the deferred stylesheets used to depend on one, which
  // would have left the page unstyled. They now use a delegated listener.
  const offenders = [...html.matchAll(/<[a-zA-Z][^>]*?\son(?:load|error|click|change|submit)\s*=\s*["'][^"']*["'][^>]*>/g)]
    .map((match) => match[0].slice(0, 90));
  assert.deepEqual(offenders, [], "inline event handlers must be replaced by listeners: " + offenders.join(" | "));
  assert.match(html, /data-promote-on-load/, "the deferred stylesheets must still exist");
});

test("style-src allows the inline blocks the app really ships", () => {
  // index.html contains <style> blocks (theme bootstrap, perf-lite) and the
  // widgets set style attributes, so 'unsafe-inline' for styles is required
  // and is a far smaller privilege than it is for scripts.
  const style = d["style-src"] || [];
  assert.ok(style.includes("'self'"));
  assert.ok(style.includes("'unsafe-inline'"));
  assert.ok(!style.some((source) => source.startsWith("http")), "no remote stylesheets are referenced");
});

test("images allow the generated data URLs and blob previews the app uses", () => {
  const img = d["img-src"] || [];
  assert.ok(img.includes("'self'"));
  assert.ok(img.includes("data:"), "avatars/logos are inlined as data: URLs");
  assert.ok(img.includes("blob:"), "file previews are rendered from blob: URLs");
  assert.ok(!img.includes("*"));
});

test("connect-src is an explicit allow-list matching the sources in the repo", () => {
  const connect = d["connect-src"] || [];
  assert.ok(connect.includes("'self'"), "the app talks to its own /api/* proxies");
  assert.ok(
    connect.some((source) => source.includes("identitytoolkit.googleapis.com")),
    "Firebase Auth signs in against identitytoolkit"
  );
  assert.ok(
    connect.some((source) => source.includes("securetoken.googleapis.com")),
    "Firebase Auth refreshes tokens against securetoken"
  );
  assert.ok(
    connect.some((source) => source.includes("open-meteo.com")),
    "src/water-reminder-widget.js fetches api.open-meteo.com"
  );
  assert.ok(!connect.includes("*"), "connect-src must not be a wildcard");
  assert.ok(!connect.includes("https:"), "connect-src must not be 'https:'");
});

test("connect-src does not over-grant: every host is referenced in the repo", () => {
  const sources = fs.readdirSync(path.join(root, "src"));
  const corpus = [
    fs.readFileSync(path.join(root, "index.html"), "utf8"),
    ...sources.filter((name) => name.endsWith(".js")).map((name) => fs.readFileSync(path.join(root, "src", name), "utf8")),
    fs.existsSync(path.join(root, "dist/assets/cloud-auth.js"))
      ? fs.readFileSync(path.join(root, "dist/assets/cloud-auth.js"), "utf8")
      : ""
  ].join("\n");
  const ignored = new Set(["'self'", "'none'"]);
  for (const source of (d["connect-src"] || []).filter((value) => !ignored.has(value))) {
    const host = source.replace(/^https:\/\//, "").replace(/\/$/, "");
    assert.ok(
      corpus.includes(host) || corpus.includes(host.split(".").slice(0, 2).join(".")),
      "connect-src grants " + host + " but nothing in the app calls it - remove it rather than widen the policy"
    );
  }
});

test("the page cannot be framed, base-tag hijacked, or plugin-embedded", () => {
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.deepEqual(d["frame-ancestors"], ["'none'"], "a signed-in study dashboard must not be frameable");
  assert.ok(d["object-src"], "object-src must be set to 'none'");
  assert.deepEqual(d["object-src"], ["'none'"]);
});

test("form-action and worker/manifest sources are constrained", () => {
  assert.deepEqual(d["form-action"], ["'self'"], "nothing in the app posts a form off-site");
  const worker = d["worker-src"] || [];
  assert.ok(worker.includes("'self'"));
  assert.ok(worker.includes("blob:"), "widgets create workers from blob: URLs");
});

test("upgrade-insecure-requests is not sneaking in a plaintext origin", () => {
  // Netlify terminates TLS; adding this would rewrite local dev URLs.
  const sources = (d["default-src"] || []).concat(d["connect-src"] || []);
  assert.ok(!sources.some((source) => source.startsWith("http://")), "no http:// source is allowed");
});

test("the security headers that go with a CSP are present", () => {
  for (const header of ["X-Content-Type-Options", "Referrer-Policy"]) {
    assert.match(toml, new RegExp(header + "\\s*="), header + " must be sent");
  }
});

if (failures.length) {
  console.error("\n" + failures.length + " failing, " + passed + " passing");
  process.exit(1);
}
console.log("\nAll " + passed + " CSP assertions passed.");
