"use strict";
// Vercel adapter: Vercel Node functions use (req, res), Netlify functions
// use (event) => { statusCode, headers, body }. This bridges the two so the
// same handlers in netlify/functions/ run on Vercel without duplication.
// Body is collected as a string; query params are parsed from the URL.
function adapt(handler) {
  return async function (req, res) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url || "/", "http://vercel.local");
    const event = {
      httpMethod: req.method || "GET",
      headers: req.headers || {},
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: Buffer.concat(chunks).toString("utf8"),
      isBase64Encoded: false
    };
    const result = await handler(event);
    res.statusCode = result.statusCode || 200;
    for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
    res.end(result.body || "");
  };
}
module.exports = { adapt };
