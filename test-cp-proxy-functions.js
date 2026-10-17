"use strict";
var assertions = 0, failures = [];
function assert(cond, msg) {
  assertions++;
  if (!cond) failures.push(msg);
}

function freshRequire(modPath) {
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function run() {
  var chain = Promise.resolve();

  // ---- CodeChef proxy: happy path ----
  chain = chain.then(function () {
    global.fetch = function (url) {
      assert(/codechef-api\.vercel\.app\/handle\/tourist$/.test(url), "codechef proxy should call the mirror's /handle/:handle route");
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({ success: true, currentRating: 3500, highestRating: 3800, stars: "7", ratingData: [] });
      } });
    };
    var fn = freshRequire("./netlify/functions/codechef.js");
    return fn.handler({ httpMethod: "GET", path: "/.netlify/functions/codechef/handle/tourist" }).then(function (res) {
      assert(res.statusCode === 200, "codechef happy path should return 200, got " + res.statusCode);
      var body = JSON.parse(res.body);
      assert(body.currentRating === 3500, "codechef proxy should pass through the mirror's JSON body unchanged");
    });
  });

  // ---- CodeChef proxy: handle not found ----
  chain = chain.then(function () {
    global.fetch = function () {
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({ success: false, message: "unknown handle" });
      } });
    };
    var fn = freshRequire("./netlify/functions/codechef.js");
    return fn.handler({ httpMethod: "GET", path: "/api/codechef/handle/nobody12345" }).then(function (res) {
      assert(res.statusCode === 404, "codechef unknown handle should map to 404, got " + res.statusCode);
    });
  });

  // ---- CodeChef proxy: retries a 500 before giving up ----
  chain = chain.then(function () {
    var attempts = 0;
    global.fetch = function () {
      attempts++;
      if (attempts < 2) return Promise.resolve({ ok: false, status: 502 });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ success: true, currentRating: 1200 }); } });
    };
    var fn = freshRequire("./netlify/functions/codechef.js");
    return fn.handler({ httpMethod: "GET", path: "/api/codechef/handle/retryme" }).then(function (res) {
      assert(attempts === 2, "codechef proxy should retry a transient 5xx before succeeding, saw " + attempts + " attempt(s)");
      assert(res.statusCode === 200, "codechef proxy should eventually succeed after a retry");
    });
  });

  // ---- CodeChef proxy: rejects invalid handle without ever calling fetch ----
  chain = chain.then(function () {
    var called = false;
    global.fetch = function () { called = true; return Promise.reject(new Error("should not be called")); };
    var fn = freshRequire("./netlify/functions/codechef.js");
    return fn.handler({ httpMethod: "GET", path: "/api/codechef/handle/../../etc" }).then(function (res) {
      assert(res.statusCode === 400, "codechef proxy should 400 on an invalid handle, got " + res.statusCode);
      assert(!called, "codechef proxy must not hit the network for an invalid handle");
    });
  });

  // ---- GFG proxy: happy path ----
  chain = chain.then(function () {
    global.fetch = function (url) {
      assert(/geeks-for-geeks-api\.vercel\.app\/user\?userName=someuser$/.test(url), "gfg proxy should call the mirror's /user route with userName");
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({ info: { userName: "someuser", codingScore: 450, totalProblemsSolved: 120 } });
      } });
    };
    var fn = freshRequire("./netlify/functions/gfg.js");
    return fn.handler({ httpMethod: "GET", path: "/api/gfg/user", queryStringParameters: { userName: "someuser" } }).then(function (res) {
      assert(res.statusCode === 200, "gfg happy path should return 200, got " + res.statusCode);
      var body = JSON.parse(res.body);
      assert(body.info.totalProblemsSolved === 120, "gfg proxy should pass through the mirror's JSON body unchanged");
    });
  });

  // ---- GFG proxy: username not found ----
  chain = chain.then(function () {
    global.fetch = function () {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ info: {} }); } });
    };
    var fn = freshRequire("./netlify/functions/gfg.js");
    return fn.handler({ httpMethod: "GET", path: "/api/gfg/user", queryStringParameters: { userName: "ghost" } }).then(function (res) {
      assert(res.statusCode === 404, "gfg unknown username should map to 404, got " + res.statusCode);
    });
  });

  // ---- GFG proxy: server-side cache serves a second request without refetching ----
  chain = chain.then(function () {
    var fetchCount = 0;
    global.fetch = function () {
      fetchCount++;
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ info: { userName: "cached", codingScore: 10 } }); } });
    };
    var fn = freshRequire("./netlify/functions/gfg.js");
    var event = { httpMethod: "GET", path: "/api/gfg/user", queryStringParameters: { userName: "cached" } };
    return fn.handler(event)
      .then(function () { return fn.handler(event); })
      .then(function (res2) {
        assert(fetchCount === 1, "second request within the cache TTL should be served from cache, not refetched (fetched " + fetchCount + " times)");
        assert(res2.headers["x-gfg-cache"] === "hit", "cached response should be marked with x-gfg-cache: hit");
      });
  });

  return chain;
}

run().then(function () {
  console.log(assertions + " assertions, " + failures.length + " failures");
  failures.forEach(function (f) { console.log("FAIL: " + f); });
  process.exit(failures.length ? 1 : 0);
}).catch(function (err) {
  console.error("Test run threw:", err);
  process.exit(1);
});
