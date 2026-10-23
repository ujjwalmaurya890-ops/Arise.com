// Netlify Function: server-side GeeksforGeeks proxy.
//
// Same rationale as codechef.js: geeks-for-geeks-api.vercel.app is a
// free-tier community mirror (GFG has no official public API at all), so
// it cold-starts and occasionally rate-limits. This proxy moves the call
// same-origin, adds a short server-side cache, retries a cold-start/5xx
// once or twice with backoff before the client sees anything, and times
// out fast instead of leaving the sync spinner hanging. There's no second
// independent source to fall back to if the mirror itself is actually down.
//
// ROUTE (matches what the widget already calls, just same-origin now):
//   GET /api/gfg/user?userName=:username

const MIRROR_BASE = "https://geeks-for-geeks-api.vercel.app";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const cache = new Map(); // username (lowercased) -> { data, expiresAt }

exports.handler = async function (event) {
  const cors = corsHeaders();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return respond(405, { error: "Method not allowed." }, cors);
  }

  const parts = event.path.split("/").filter(Boolean);
  const i = parts.indexOf("gfg");
  const rest = i >= 0 ? parts.slice(i + 1) : [];
  if (!(rest.length === 1 && rest[0] === "user")) {
    return respond(404, { error: "Unknown GFG proxy route." }, cors);
  }

  const username = ((event.queryStringParameters && event.queryStringParameters.userName) || "").trim();
  if (!username || !/^[A-Za-z0-9_.]{1,50}$/.test(username)) {
    return respond(400, { error: "Missing or invalid GFG username." }, cors);
  }

  const cacheKey = username.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return respond(200, cached.data, Object.assign({ "x-gfg-cache": "hit" }, cors));
  }

  try {
    const data = await retry(function () { return fetchFromMirror(username); }, 2, 500);
    cache.set(cacheKey, { data: data, expiresAt: Date.now() + CACHE_TTL_MS });
    return respond(200, data, cors);
  } catch (err) {
    const status = err.status || 502;
    const message =
      status === 404
        ? "GFG username not found."
        : status === 429
        ? "Rate limit reached — please try again shortly."
        : "Couldn't reach GFG's community API right now. Please try again shortly.";
    return respond(status === 404 ? 404 : 502, { error: message }, cors);
  }
};

async function fetchFromMirror(username) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(MIRROR_BASE + "/user?userName=" + encodeURIComponent(username), { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const err = new Error("GFG mirror error (" + res.status + ").");
    err.status = res.status === 404 ? 404 : res.status;
    throw err;
  }
  const json = await res.json();
  const info = json && (json.info || json);
  if (!info || (info.userName == null && info.username == null)) {
    const err = new Error("GFG username not found.");
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
