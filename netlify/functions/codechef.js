// Netlify Function: server-side CodeChef proxy.
//
// WHY THIS EXISTS
// The dashboard called the community-hosted codechef-api.vercel.app mirror
// directly from the browser. Like the old LeetCode mirror, it's a free-tier
// Vercel deployment that spins down when idle — the first request after a
// quiet spell can hang for 20-50s or time out, and that latency used to be
// fully exposed to the user with nothing absorbing it.
//
// UNLIKE LeetCode, CodeChef has no official public API to fall back to (or
// call first) — this community mirror is the only source in use. So this
// proxy can't offer an "official API first" path the way leetcode.js does.
// What it DOES give you:
//   1. A same-origin call (no CORS preflight round trip).
//   2. Server-side caching so repeated syncs (background sync, tab
//      switches, the 15-min auto-refresh) within a few minutes don't all
//      re-hit the mirror.
//   3. Retrying a cold-start/5xx failure with backoff *before* the client
//      ever sees an error, instead of the client's own retry needing a
//      fresh cold start each time.
//   4. A timeout, so a hung mirror fails fast instead of leaving the
//      widget's sync spinner stuck for a minute.
//
// If the mirror itself is down (not just cold), this proxy will surface
// that clearly rather than pretending otherwise — there's no second source
// to quietly fall back to.
//
// ROUTE (matches what the widget already calls, just same-origin now):
//   GET /api/codechef/handle/:handle

const MIRROR_BASE = "https://codechef-api.vercel.app";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const cache = new Map(); // handle (lowercased) -> { data, expiresAt }

exports.handler = async function (event) {
  const cors = corsHeaders();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return respond(405, { error: "Method not allowed." }, cors);
  }

  const handle = parseHandle(event.path);
  if (!handle || !/^[A-Za-z0-9_]{1,50}$/.test(handle)) {
    return respond(400, { error: "Missing or invalid CodeChef handle." }, cors);
  }

  const cacheKey = handle.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return respond(200, cached.data, Object.assign({ "x-cc-cache": "hit" }, cors));
  }

  try {
    const data = await retry(function () { return fetchFromMirror(handle); }, 2, 500);
    cache.set(cacheKey, { data: data, expiresAt: Date.now() + CACHE_TTL_MS });
    return respond(200, data, cors);
  } catch (err) {
    const status = err.status || 502;
    const message =
      status === 404
        ? "CodeChef handle not found."
        : status === 429
        ? "Rate limit reached — please try again shortly."
        : "Couldn't reach CodeChef's community API right now. Please try again shortly.";
    return respond(status === 404 ? 404 : 502, { error: message, success: false, message: message }, cors);
  }
};

function parseHandle(path) {
  // /.netlify/functions/codechef/handle/tourist  (or /api/codechef/handle/tourist)
  const parts = path.split("/").filter(Boolean);
  const i = parts.indexOf("codechef");
  const rest = i >= 0 ? parts.slice(i + 1) : [];
  if (rest.length === 2 && rest[0] === "handle") {
    return decodeURIComponent(rest[1]);
  }
  return null;
}

async function fetchFromMirror(handle) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(MIRROR_BASE + "/handle/" + encodeURIComponent(handle), { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const err = new Error("CodeChef mirror error (" + res.status + ").");
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  if (json && json.success === false) {
    const err = new Error(json.message || "CodeChef handle not found.");
    err.status = 404;
    throw err;
  }
  return json;
}

function retry(fn, retriesLeft, delayMs) {
  return fn().catch(function (err) {
    const retryable = !err.status || err.status === 429 || err.status >= 500;
    if (retriesLeft > 0 && retryable) {
      return new Promise(function (resolve) { setTimeout(resolve, delayMs); }).then(function () {
        return retry(fn, retriesLeft - 1, delayMs * 2);
      });
    }
    throw err;
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function respond(statusCode, bodyObj, extraHeaders) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ "content-type": "application/json" }, extraHeaders || {}),
    body: JSON.stringify(bodyObj)
  };
}
