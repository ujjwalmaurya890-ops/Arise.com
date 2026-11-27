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

  // Helper to create mock req/res pairs for edge-case tests.
  function mockRes() {
    const out = { statusCode: 200, headers: {}, body: "" };
    return {
      out,
      res: {
        setHeader(k, v) {
          out.headers[k] = v;
        },
        end(b) {
          out.body = b;
        },
        set statusCode(v) {
          out.statusCode = v;
        },
        get statusCode() {
          return out.statusCode;
        }
      }
    };
  }

  // Oversized body is rejected with 413 before invoking the handler.
  {
    let called = false;
    const bounded = adapt(
      async () => {
        called = true;
        return { statusCode: 200, body: "should-not-run" };
      },
      { maxBodyBytes: 16 }
    );
    const bigReq = Readable.from([Buffer.alloc(32, "a")]);
    bigReq.method = "POST";
    bigReq.url = "/api/cloud";
    bigReq.headers = { "content-type": "application/json" };
    const { res: r, out } = mockRes();
    await bounded(bigReq, r);
    assert.equal(called, false, "handler must not run when body exceeds cap");
    assert.equal(out.statusCode, 413);
    assert.equal(out.headers["Cache-Control"], "no-store, private");
    assert.deepEqual(JSON.parse(out.body), { error: "request-too-large" });
  }

  // Unhandled handler exception returns a structured 500 JSON response.
  {
    const failing = adapt(async () => {
      throw new Error("boom");
    });
    const getReq = Readable.from([]);
    getReq.method = "GET";
    getReq.url = "/api/public-config";
    getReq.headers = {};
    const { res: r, out } = mockRes();
    await failing(getReq, r);
    assert.equal(out.statusCode, 500);
    assert.equal(out.headers["Cache-Control"], "no-store, private");
    assert.deepEqual(JSON.parse(out.body), { error: "service-unavailable" });
  }

  // Undefined/null header values are skipped safely and empty GET/OPTIONS work.
  {
    const optHandler = adapt(async event => {
      assert.equal(event.httpMethod, "OPTIONS");
      assert.equal(event.body, "");
      return {
        statusCode: 204,
        headers: { Vary: "Origin", "X-Skip": undefined, "X-Null": null },
        body: ""
      };
    });
    const optReq = Readable.from([]);
    optReq.method = "OPTIONS";
    optReq.url = "/api/leetcode/userProfile/alice";
    optReq.headers = {};
    const { res: r, out } = mockRes();
    await optHandler(optReq, r);
    assert.equal(out.statusCode, 204);
    assert.equal(out.headers["Vary"], "Origin");
    assert.equal("X-Skip" in out.headers, false);
    assert.equal("X-Null" in out.headers, false);
  }

  // Cache-Control parity between vercel.json and server/http-policy.cjs.
  const { cacheControlFor } = require(path.join(root, "server/http-policy.cjs"));
  const headerBySource = new Map(
    (vercel.headers || []).map(rule => [
      rule.source,
      (rule.headers || []).find(h => h.key === "Cache-Control")?.value
    ])
  );
  const expectedCacheRoutes = [
    ["/index.html", "/index.html"],
    ["/404.html", "/404.html"],
    ["/manifest.webmanifest", "/manifest.webmanifest"],
    ["/service-worker.js", "/service-worker.js"],
    ["/assets/cloud-auth.js", "/assets/cloud-auth.js"],
    ["/assets/chunks/:path*", "/assets/chunks/w01.abcd1234.js"],
    ["/assets/fonts/:path*", "/assets/fonts/inter.woff2"],
    ["/assets/sounds/:path*", "/assets/sounds/rain.mp3"],
    ["/src/:path*", "/src/app-icons.js"],
    ["/styles/:path*", "/styles/theme.css"]
  ];
  for (const [source, samplePath] of expectedCacheRoutes) {
    assert.equal(
      headerBySource.get(source),
      cacheControlFor(samplePath),
      "vercel.json Cache-Control for " + source + " must match server/http-policy.cjs"
    );
  }
  assert.equal(headerBySource.get("/api/:path*"), "no-store, private");

  console.log(
    "Vercel adapter: vercel.json, api/* functions, CSP/cache parity, asset-safe SPA fallback and req/res bridging passed."
  );
})().catch(e => {
  console.error(e);
  process.exit(1);
});
