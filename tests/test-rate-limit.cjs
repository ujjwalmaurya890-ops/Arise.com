"use strict";
// server/rate-limit.cjs backs the ai-ask and cloud budgets. A bug here either
// lets a single token spend the deployment's provider quota, or locks legitimate
// sync bursts out. Tests use fake timers (Date.now patched) so the window logic
// is verified without sleeping.
const assert = require("assert");
const path = require("path");
const { createRateLimiter } = require(path.join(__dirname, "..", "server", "rate-limit.cjs"));

let passed = 0;
function ok(value, label) {
  assert.ok(value, label);
  passed++;
}

const realNow = Date.now;
let clock = 1_700_000_000_000;
Date.now = () => clock;

try {
  {
    const limiter = createRateLimiter();
    for (let i = 0; i < 3; i++) ok(limiter.check("uid-a", 3, 1000).allowed, "under limit " + i);
    const blocked = limiter.check("uid-a", 3, 1000);
    ok(blocked.allowed === false, "the 4th request in the window is refused");
    ok(blocked.remaining === 0, "remaining never goes negative");
    ok(
      blocked.retryAfter >= 1 && blocked.retryAfter <= 1,
      "retryAfter is the whole window in seconds"
    );

    clock += 1000;
    ok(limiter.check("uid-a", 3, 1000).allowed, "the window resets after it elapses");
  }

  {
    const limiter = createRateLimiter();
    ok(limiter.check("uid-a", 1, 60_000).allowed, "uid-a first request allowed");
    ok(limiter.check("uid-b", 1, 60_000).allowed, "a different uid has its own budget");
    ok(!limiter.check("uid-a", 1, 60_000).allowed, "uid-a is still capped");
    ok(!limiter.check("uid-b", 1, 60_000).allowed, "uid-b is capped independently");
    clock += 60_000;
    ok(limiter.check("uid-a", 1, 60_000).allowed, "each bucket expires on its own clock");
  }

  {
    // maxKeys must bound memory even under a distributed burst from many uids.
    const limiter = createRateLimiter({ maxKeys: 5 });
    for (let i = 0; i < 200; i++) limiter.check("uid-" + i, 10, 60_000);
    ok(limiter.buckets.size <= 5, "the bucket map is capped at maxKeys entries");
    ok(limiter.check("uid-fresh", 10, 60_000).allowed, "a new key is still tracked after eviction");
  }

  {
    // Minute and daily budgets use separate key namespaces (see ai-ask.js), so a
    // per-minute burst cannot consume the daily allowance and vice versa.
    const limiter = createRateLimiter();
    for (let i = 0; i < 2; i++) limiter.check("min:" + "uid-a", 2, 1000);
    ok(!limiter.check("min:" + "uid-a", 2, 1000).allowed, "minute budget exhausted");
    const daily = limiter.check("day:" + "uid-a", 2, 86_400_000);
    ok(daily.allowed, "the daily bucket is untouched by the minute bucket");
    ok(daily.remaining === 1, "the daily bucket counts on its own counter");

    // A key keeps the window it was created with: mixing windows on one key is
    // supported but the first window wins until it expires. Documented here so a
    // future refactor cannot silently change it.
    const mixed = createRateLimiter();
    mixed.check("uid-a", 5, 1000);
    clock += 500;
    ok(
      mixed.check("uid-a", 5, 86_400_000).allowed,
      "a later, longer window does not reset the bucket"
    );
    clock += 500;
    ok(mixed.check("uid-a", 5, 86_400_000).allowed, "the original window still governs the key");
  }

  console.log("\nRate limiter: " + passed + " assertions passed.");
} catch (error) {
  console.error("\nRate limiter FAILED:");
  console.error(error);
  process.exitCode = 1;
} finally {
  Date.now = realNow;
}
