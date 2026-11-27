"use strict";
// Vercel adapter: Vercel Node functions use (req, res), Netlify functions
// use (event) => { statusCode, headers, body }. This bridges the two so the
// same handlers in netlify/functions/ run on Vercel without duplication.
// Body is collected as a string with a hard byte cap; query params are parsed
// from the URL.
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MiB ceiling above server/http.cjs 5 MiB JSON cap

function adapt(handler, options = {}) {
  const maxBytes =
    Number.isInteger(options.maxBodyBytes) && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_BODY_BYTES;

  return async function (req, res) {
    const chunks = [];
    let totalBytes = 0;
    try {
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > maxBytes) {
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store, private");
          res.end(JSON.stringify({ error: "request-too-large" }));
          return;
        }
        chunks.push(buf);
      }
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, private");
      res.end(JSON.stringify({ error: "invalid-request" }));
      return;
    }

    const url = new URL(req.url || "/", "http://vercel.local");
    const event = {
      httpMethod: req.method || "GET",
      headers: req.headers || {},
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: Buffer.concat(chunks).toString("utf8"),
      isBase64Encoded: false
    };

    let result;
    try {
      result = await handler(event);
    } catch (err) {
      console.error("[vercel-adapter] unhandled handler error:", err && err.message);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, private");
      res.end(JSON.stringify({ error: "service-unavailable" }));
      return;
    }

    res.statusCode = (result && result.statusCode) || 200;
    for (const [name, value] of Object.entries((result && result.headers) || {})) {
      if (value !== undefined && value !== null) res.setHeader(name, value);
    }
    res.end((result && result.body) || "");
  };
}
module.exports = { adapt, MAX_BODY_BYTES };
