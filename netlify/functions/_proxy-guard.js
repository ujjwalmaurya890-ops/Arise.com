'use strict';
/* ==========================================================================
   netlify/functions/_proxy-guard.js
   --------------------------------------------------------------------------
   Shared guard for the three community-mirror proxies (leetcode, codechef,
   gfg). They are unauthenticated GET endpoints that fan out to third-party
   services, so they were a free, anonymous scraping relay:

     - Access-Control-Allow-Origin: * on every response meant any page on the
       internet could call them from a visitor's browser and use ARISE's
       egress IP to harvest those sites.
     - The in-process result cache (a plain Map) had no size bound. Warm
       lambdas are reused, so a script supplying random usernames grew it for
       the life of the container; nothing ever evicted an entry.
     - Every call re-validated a username and then hit the mirror, with no
       per-client budget, so a loop could spend the deployment's quota.

   The public contract is unchanged: same paths, same JSON shape, same cache
   headers, still callable cross-origin by an approved ARISE origin. What is
   added is a bounded cache and a per-client request budget. If a deployment
   does not configure anything, the guard still applies the cache and rate
   limits and only restricts CORS when it can see a same-origin request.

   Configuration (all optional, all server-side env vars):
     ARISE_PROXY_ORIGINS        comma-separated extra allowed origins, e.g.
                                https://arise.example.com,https://beta--arise.netlify.app
     ARISE_PROXY_RATE_LIMIT     requests per window per client (default 60)
     ARISE_PROXY_RATE_WINDOW_MS window length in ms (default 60000)
   ========================================================================== */

const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
// Bounded per-process LRU. 500 entries x a few KB is well inside a lambda's
// memory budget and stops unbounded growth on warm containers.
const MAX_CACHE_ENTRIES = 500;
const MAX_CLIENT_KEYS = 5000;

function configuredOrigins() {
  return String(process.env.ARISE_PROXY_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Resolve the Access-Control-Allow-Origin value for one request.
 *
 * Same-origin requests need no CORS header at all, so they get none. A browser
 * request from an unknown origin gets none either - the browser then blocks the
 * response, which is the point. Only an explicitly configured origin (or the
 * deployment's own URL, which Netlify always sets) is granted.
 */
function allowedOrigin(event) {
  const headers = (event && event.headers) || {};
  const origin = headers.origin || headers.Origin;
  if (!origin) return null; // same-origin fetch or a server-side caller
  const allowed = new Set(configuredOrigins());
  for (const name of ['URL', 'DEPLOY_URL', 'DEPLOY_PRIME_URL']) {
    if (process.env[name]) allowed.add(process.env[name].replace(/\/$/, ''));
  }
  // The request's own Host is the most reliable same-origin signal: it is set
  // by the platform on every request, including local `netlify dev` runs where
  // none of the deployment env vars exist.
  const host = headers.host || headers.Host;
  if (host) {
    allowed.add('https://' + host);
    allowed.add('http://' + host);
  }
  return allowed.has(origin.replace(/\/$/, '')) ? origin : null;
}

function corsHeaders(event) {
  const origin = allowedOrigin(event);
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

/** True when the request came from an origin this deployment does not serve. */
function isForeignOrigin(event) {
  const headers = (event && event.headers) || {};
  return Boolean((headers.origin || headers.Origin) && !allowedOrigin(event));
}

function clientKey(event) {
  const headers = (event && event.headers) || {};
  const forwarded = String(headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  // Netlify always sets the connection IP; fall back to a non-identifying
  // bucket so a missing header degrades to a shared budget, never to "no limit".
  return forwarded || 'unknown-client';
}

const buckets = new Map(); // client -> { count, resetAt }

function rateLimit(event) {
  const limit = Number(process.env.ARISE_PROXY_RATE_LIMIT) > 0
    ? Number(process.env.ARISE_PROXY_RATE_LIMIT)
    : DEFAULT_RATE_LIMIT;
  const windowMs = Number(process.env.ARISE_PROXY_RATE_WINDOW_MS) > 0
    ? Number(process.env.ARISE_PROXY_RATE_WINDOW_MS)
    : DEFAULT_RATE_WINDOW_MS;
  const key = clientKey(event);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > MAX_CLIENT_KEYS) {
    for (const [name, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(name);
    }
    // Still oversized after expiry sweeps (a burst from many distinct IPs):
    // drop the oldest insertion so the map cannot grow without bound.
    while (buckets.size > MAX_CLIENT_KEYS) buckets.delete(buckets.keys().next().value);
  }
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

/** A Map that evicts the least-recently-used entry once it is full. */
class BoundedCache {
  constructor(max = MAX_CACHE_ENTRIES) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    const found = this.map.get(key);
    if (!found) return undefined;
    // Refresh recency by re-inserting.
    this.map.delete(key);
    this.map.set(key, found);
    return found;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return this;
  }
  get size() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
}

/**
 * Returns true when the request should be refused before doing any work.
 * Writes the response onto `send` so each proxy keeps its own response shape.
 */
function rejected(event, cors) {
  if (isForeignOrigin(event)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'This endpoint is only available to the ARISE app.' }) };
  }
  const limit = rateLimit(event);
  if (!limit.allowed) {
    return {
      statusCode: 429,
      headers: Object.assign({ 'content-type': 'application/json', 'Retry-After': String(limit.retryAfter) }, cors),
      body: JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' })
    };
  }
  return null;
}

module.exports = { allowedOrigin, corsHeaders, isForeignOrigin, rateLimit, BoundedCache, rejected, MAX_CACHE_ENTRIES };
