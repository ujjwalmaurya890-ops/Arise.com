"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const root = path.resolve(__dirname, "..");
// public-config handler is pure (no Firebase services needed beyond env check)
const { adapt } = require(path.join(root, "api/_netlify-adapter.cjs"));
(async () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal(vercel.outputDirectory, "dist");
  for (const name of ["cloud", "ai-ask", "public-config", "sync", "leetcode", "codechef", "gfg"]) {
    assert.ok(fs.existsSync(path.join(root, "api", name + ".js")), "api/" + name + ".js exists");
  }
  // CSP in vercel.json must match the single source of truth.
  const { CONTENT_SECURITY_POLICY } = require(path.join(root, "server/http-policy.cjs"));
  const cspHeader = vercel.headers[0].headers.find(h => h.key === "Content-Security-Policy");
  assert.equal(cspHeader.value, CONTENT_SECURITY_POLICY);
  // Routing shape: API rewrite first, and the SPA fallback must never shadow
  // real assets (a 200 HTML response cached as JavaScript breaks the app).
  const rewrites = vercel.rewrites || [];
  const apiRoutes = rewrites.filter(rule => rule.source.startsWith("/api/"));
  assert.equal(apiRoutes.length, 7, "every API path is rewritten to its function");
  const fallback = rewrites[rewrites.length - 1];
  assert.equal(fallback.destination, "/index.html");
  for (const prefix of ["api", "assets", "src", "styles"]) {
    assert.ok(
      fallback.source.includes(prefix),
      "the SPA fallback excludes /" + prefix + " so missing files stay 404"
    );
  }
  assert.ok(
    !rewrites.some(rule => rule.destination === "/404.html"),
    "no rewrite returns 404.html with a 200 status"
  );
  // Adapter bridges (req,res) -> Netlify (event) correctly.
  const handler = adapt(async event => {
    assert.equal(event.httpMethod, "POST");
    assert.equal(event.path, "/api/cloud");
    assert.equal(event.queryStringParameters.x, "1");
    assert.equal(event.body, '{"a":1}');
    return { statusCode: 201, headers: { "X-Test": "yes" }, body: "ok" };
  });
  const req = Readable.from([Buffer.from('{"a":1}')]);
  req.method = "POST";
  req.url = "/api/cloud?x=1";
  req.headers = { "content-type": "application/json" };
  let status,
    headers = {},
    body = "";
  const res = {
    setHeader: (k, v) => {
      headers[k] = v;
    },
    end: b => {
      body = b;
    }
  };
  Object.defineProperty(res, "statusCode", {
    set: v => {
      status = v;
    },
    get: () => status
  });
  await handler(req, res);
  assert.equal(status, 201);
  assert.equal(headers["X-Test"], "yes");
  assert.equal(body, "ok");
  console.log(
    "Vercel adapter: vercel.json, api/* functions, CSP parity, asset-safe SPA fallback and req/res bridging passed."
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
