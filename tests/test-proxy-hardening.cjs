/**
 * tests/test-proxy-hardening.cjs
 * ---------------------------------------------------------------------------
 * The LeetCode / CodeChef / GeeksforGeeks Netlify functions are public GET
 * endpoints that fan out to third-party services. They used to:
 *
 *   - answer every request with `Access-Control-Allow-Origin: *`, so any page
 *     on the internet could call them from a visitor's browser and use the
 *     deployment's egress IP as a free scraping relay for those sites;
 *   - cache results in a plain unbounded Map that lived for the whole warm
 *     lambda, so random usernames grew it until the container was recycled;
 *   - have no per-client budget at all, so a simple loop could exhaust the
 *     upstream quota.
 *
 * These tests exercise the real handlers (no network: fetch is stubbed) and
 * the shared guard, so the fixes are verified rather than asserted in a
 * comment.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const guard = require(path.join(root, "netlify/functions/_proxy-guard.js"));

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

/* ------------------------------------------------------------------ guard */

test("only a configured origin is granted CORS", () => {
  delete process.env.ARISE_PROXY_ORIGINS;
  delete process.env.URL;
  delete process.env.DEPLOY_PRIME_URL;
  const evil = guard.corsHeaders({ headers: { origin: "https://evil.test" } });
  assert.equal(evil["Access-Control-Allow-Origin"], undefined, "must not grant an unknown origin");
  assert.equal(evil.Vary, "Origin", "responses must vary by origin for caches");
  assert.equal(guard.isForeignOrigin({ headers: { origin: "https://evil.test" } }), true);
});

test("the deployment's own origin is allowed", () => {
  process.env.ARISE_PROXY_ORIGINS = "https://arise.example.com";
  const allowed = guard.corsHeaders({ headers: { origin: "https://arise.example.com" } });
  assert.equal(allowed["Access-Control-Allow-Origin"], "https://arise.example.com");
  assert.equal(guard.isForeignOrigin({ headers: { origin: "https://arise.example.com" } }), false);
  delete process.env.ARISE_PROXY_ORIGINS;
});

test("a request whose Origin matches its own Host is treated as same-origin", () => {
  delete process.env.ARISE_PROXY_ORIGINS;
  delete process.env.URL;
  const event = { headers: { origin: "https://arise-branch--site.netlify.app", host: "arise-branch--site.netlify.app" } };
  assert.equal(guard.isForeignOrigin(event), false, "same-origin must never be refused just because URL is unset");
  assert.equal(guard.corsHeaders(event)["Access-Control-Allow-Origin"], "https://arise-branch--site.netlify.app");
});

test("same-origin requests need no CORS header and are not refused", () => {
  const headers = guard.corsHeaders({ headers: {} });
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(guard.isForeignOrigin({ headers: {} }), false);
});

test("the result cache is bounded and evicts least-recently-used entries", () => {
  const cache = new guard.BoundedCache(3);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), 1); // make "a" most recent
  cache.set("d", 4);               // evicts "b"
  assert.equal(cache.size, 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
});

test("flooding distinct usernames cannot grow the cache without bound", () => {
  const cache = new guard.BoundedCache(50);
  for (let i = 0; i < 5000; i++) cache.set("user-" + i, { data: i });
  assert.equal(cache.size, 50);
});

test("the per-client budget is enforced and reported honestly", () => {
  process.env.ARISE_PROXY_RATE_LIMIT = "3";
  process.env.ARISE_PROXY_RATE_WINDOW_MS = "60000";
  const event = { headers: { "x-nf-client-connection-ip": "203.0.113.9" } };
  assert.equal(guard.rateLimit(event).allowed, true);
  assert.equal(guard.rateLimit(event).allowed, true);
  assert.equal(guard.rateLimit(event).allowed, true);
  const fourth = guard.rateLimit(event);
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfter >= 1);
  // A different client is unaffected.
  assert.equal(guard.rateLimit({ headers: { "x-nf-client-connection-ip": "198.51.100.2" } }).allowed, true);
  delete process.env.ARISE_PROXY_RATE_LIMIT;
  delete process.env.ARISE_PROXY_RATE_WINDOW_MS;
});

test("a missing client IP degrades to a shared budget, never to no budget", () => {
  process.env.ARISE_PROXY_RATE_LIMIT = "1";
  const anonymous = { headers: {} };
  guard.rateLimit(anonymous);
  assert.equal(guard.rateLimit(anonymous).allowed, false);
  delete process.env.ARISE_PROXY_RATE_LIMIT;
});

/* ----------------------------------------------------------- real handlers */

function stubFetch(t, payload) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };
  t.after(() => { delete global.fetch; });
  return calls;
}

const nodeTest = require("node:test");

nodeTest("proxies refuse a foreign browser origin before calling upstream", async (t) => {
  process.env.ARISE_PROXY_ORIGINS = "https://arise.example.com";
  const calls = stubFetch(t, { ok: true });
  for (const name of ["leetcode", "codechef", "gfg"]) {
    const { handler } = require(path.join(root, "netlify/functions/" + name + ".js"));
    const event = {
      httpMethod: "GET",
      path: "/.netlify/functions/" + name + "/userProfile/tourist",
      headers: { origin: "https://evil.test", "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { userName: "tourist" }
    };
    const response = await handler(event);
    assert.equal(response.statusCode, 403, name + " must refuse a foreign origin");
    assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
    assert.ok(!calls.length, name + " must not reach the upstream mirror");
  }
  delete process.env.ARISE_PROXY_ORIGINS;
});

nodeTest("an approved origin still receives a usable response", async (t) => {
  process.env.ARISE_PROXY_ORIGINS = "https://arise.example.com";
  stubFetch(t, { totalSolved: 10, easySolved: 4, mediumSolved: 4, hardSolved: 2, submissionCalendar: {} });
  const { handler } = require(path.join(root, "netlify/functions/leetcode.js"));
  const response = await handler({
    httpMethod: "GET",
    path: "/.netlify/functions/leetcode/userProfile/tourist",
    headers: { origin: "https://arise.example.com", "x-nf-client-connection-ip": "10.0.0.7" },
    queryStringParameters: {}
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://arise.example.com");
  assert.ok(JSON.parse(response.body));
  delete process.env.ARISE_PROXY_ORIGINS;
});

nodeTest("OPTIONS is answered without an upstream call and without a wildcard", async (t) => {
  const calls = stubFetch(t, {});
  const { handler } = require(path.join(root, "netlify/functions/codechef.js"));
  const response = await handler({ httpMethod: "OPTIONS", path: "/.netlify/functions/codechef/x", headers: {} });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(calls.length, 0);
});

nodeTest("the 429 path is well formed and says when to retry", async (t) => {
  process.env.ARISE_PROXY_RATE_LIMIT = "1";
  stubFetch(t, {});
  const { handler } = require(path.join(root, "netlify/functions/gfg.js"));
  const event = {
    httpMethod: "GET",
    path: "/.netlify/functions/gfg/user",
    headers: { "x-nf-client-connection-ip": "198.51.100.77" },
    queryStringParameters: { userName: "someone" }
  };
  await handler(event);
  const limited = await handler(event);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.headers["Retry-After"], /^\d+$/);
  assert.match(JSON.parse(limited.body).error, /wait/i);
  delete process.env.ARISE_PROXY_RATE_LIMIT;
});

/* --------------------------------------------------------- source guards */

test("no proxy still sends a wildcard Access-Control-Allow-Origin", () => {
  for (const name of ["leetcode.js", "codechef.js", "gfg.js"]) {
    const source = fs.readFileSync(path.join(root, "netlify/functions/" + name), "utf8");
    assert.doesNotMatch(source, /Access-Control-Allow-Origin"?\s*:\s*"\*"/, name + " must not hard-code a wildcard origin");
    assert.match(source, /guard\.rejected\(event, cors\)/, name + " must call the shared guard");
  }
});

test("the cache each proxy uses is the bounded one", () => {
  for (const name of ["leetcode.js", "codechef.js", "gfg.js"]) {
    const source = fs.readFileSync(path.join(root, "netlify/functions/" + name), "utf8");
    assert.doesNotMatch(source, /const cache = new Map\(\)/, name + " must not use an unbounded Map");
    assert.match(source, /new guard\.BoundedCache\(\)/, name + " must use the bounded cache");
  }
});

if (failures.length) {
  console.error("\n" + failures.length + " failing, " + passed + " passing");
  process.exit(1);
}
console.log("\nAll " + passed + " proxy-hardening assertions passed.");
