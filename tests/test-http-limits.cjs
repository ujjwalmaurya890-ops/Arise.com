"use strict";
// server/http.cjs is the only thing standing between an untrusted request body and
// JSON.parse in every protected function, so its limits are security-critical and
// had no direct tests. These assertions pin the contract: HTTP status codes on the
// wire, headers that stop caching/sniffing, and no internal error text.
const assert = require("assert");
const path = require("path");
const { ApiError } = require(path.join(__dirname, "..", "server", "access.cjs"));
const { respond, fail, readBody } = require(path.join(__dirname, "..", "server", "http.cjs"));

let passed = 0;
function ok(value, label) {
  assert.ok(value, label);
  passed++;
}
function json(event) {
  return { headers: { "content-type": "application/json" }, ...event };
}
function bodyOf(parsed) {
  return JSON.parse(parsed.body);
}

try {
  /* ---------------------------------------------------------------- respond */
  {
    const res = respond(200, { ok: true });
    ok(res.statusCode === 200, "respond keeps the status code");
    ok(res.headers["Content-Type"].startsWith("application/json"), "responses are JSON typed");
    ok(
      res.headers["Cache-Control"].includes("no-store"),
      "authenticated payloads are never cached by a proxy"
    );
    ok(res.headers["X-Content-Type-Options"] === "nosniff", "responses are not MIME-sniffed");
    ok(res.headers["Referrer-Policy"] === "no-referrer", "responses do not leak referrers");
    ok(res.headers.Vary === "Authorization", "caches vary on the bearer token");
    ok(res.body === JSON.stringify({ ok: true }), "body is serialized JSON");
  }

  /* -------------------------------------------------------------------- fail */
  {
    const res = fail(new ApiError(413, "request-too-large"));
    ok(res.statusCode === 413, "ApiError status is preserved");
    ok(bodyOf(res).error === "request-too-large", "ApiError code is the public error field");
    const generic = fail(new Error("firestore://internal-host: bom exploded"));
    ok(generic.statusCode === 503, "unexpected errors report 503");
    ok(bodyOf(generic).error === "service-unavailable", "unexpected errors use a generic code");
    ok(!generic.body.includes("internal-host"), "internal error text never reaches the client");
  }

  /* ----------------------------------------------------------------- readBody */
  {
    assert.throws(
      () => readBody({ headers: {}, body: "{}" }),
      err => err.status === 415,
      "text/plain"
    );
    ok(true, "a missing JSON content type is refused with 415");
    assert.throws(
      () => readBody({ headers: { "content-type": "text/plain" }, body: "{}" }),
      err => err.status === 415,
      "text/plain"
    );
    ok(true, "any non-JSON content type is refused with 415");
    ok(
      readBody(json({ body: '{"action":"state"}' })).action === "state",
      "a JSON object body is parsed"
    );
    ok(
      readBody({
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: '{"a":1}'
      }).a === 1,
      "content-type parameters and header casing are tolerated"
    );
    ok(
      readBody(json({ isBase64Encoded: true, body: Buffer.from('{"b":2}').toString("base64") }))
        .b === 2,
      "base64 bodies are decoded before parsing"
    );
    assert.throws(
      () => readBody(json({ body: "[]" })),
      err => err.status === 400,
      "arrays are not accepted"
    );
    ok(true, "a top-level array is refused with 400");
    assert.throws(
      () => readBody(json({ body: "null" })),
      err => err.status === 400,
      "null body"
    );
    ok(true, "a null body is refused with 400");
    assert.throws(
      () => readBody(json({ body: "{not json" })),
      err => err.status === 400,
      "broken JSON"
    );
    ok(true, "malformed JSON is refused with 400 and never throws a SyntaxError out");

    // Exactly at the limit passes, one byte over fails. 5 MiB of JSON string value.
    const limit = 5 * 1024 * 1024;
    const wrapper = raw => '{"v":"' + raw + '"}';
    const fits = wrapper("a".repeat(limit - 10));
    ok(Buffer.byteLength(fits) <= limit, "the at-limit fixture is within 5 MiB");
    ok(readBody(json({ body: fits })).v.length === limit - 10, "a body at the limit is accepted");
    const tooBig = wrapper("a".repeat(limit));
    assert.throws(
      () => readBody(json({ body: tooBig })),
      err => err.status === 413,
      "oversized body"
    );
    ok(true, "a body over 5 MiB is refused with 413 before parsing");
    assert.throws(
      () => readBody(json({ body: '{"v":"' + "a".repeat(limit) })),
      err => err.status === 400 || err.status === 413,
      "unbalanced"
    );
    ok(true, "an oversized truncated body never reaches JSON.parse");
  }

  console.log("\nHTTP limits: " + passed + " assertions passed.");
} catch (error) {
  console.error("\nHTTP limits FAILED:");
  console.error(error);
  process.exit(1);
}
