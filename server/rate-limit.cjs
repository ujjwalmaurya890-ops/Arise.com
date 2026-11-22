"use strict";
// Per-instance (per-lambda) rate limiter. This bounds abuse from a single
// compromised/stolen token or a runaway client loop; it is NOT a distributed
// quota (Netlify may run many instances). For strict billing quotas, pair
// this with a Firestore-backed counter (see docs/SECURE-SYNC.md).
// Limits are generous by design so legitimate sync bursts never trip them.

function createRateLimiter(options = {}) {
  const buckets = new Map(); // key -> { count, resetAt }
  const maxKeys = options.maxKeys || 5000;
  function check(key, limit, windowMs) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (buckets.size > maxKeys) {
      for (const [name, value] of buckets) if (value.resetAt <= now) buckets.delete(name);
      while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
    }
    const allowed = bucket.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - bucket.count),
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }
  return { check, buckets };
}

module.exports = { createRateLimiter };
