// Netlify Function: server-side LeetCode proxy.
//
// WHY THIS EXISTS
// The dashboard used to call a free community-hosted mirror
// (alfa-leetcode-api.onrender.com) directly from the browser. Render's free
// tier spins the service down when idle, so the first request after any
// quiet period would hang for 20-50s and often time out or 502 — with
// nothing absorbing that on the way to the user.
//
// This function fixes that by:
//   1. Querying LeetCode's own public GraphQL API directly from the server
//      first (no third-party host to sleep/cold-start).
//   2. Caching successful responses in memory for a few minutes so bursts
//      of tab-switches/refreshes don't trigger new upstream calls.
//   3. Retrying transient failures with exponential backoff *before* the
//      client ever sees an error.
//   4. Falling back to the community mirror only if LeetCode's own API is
//      unreachable (e.g. blocked from this network) — so the feature keeps
//      working either way, it just tries the reliable path first now.
//
// ROUTES (matches the paths the widget already calls, just same-origin now):
//   GET /api/leetcode/userProfile/:username
//   GET /api/leetcode/:username/contest
//   GET /api/leetcode/:username/calendar
//
// Response shapes are kept identical to what the widget already parses, so
// no other client-side changes are needed beyond pointing at this path.

const LEETCODE_GRAPHQL = "https://leetcode.com/graphql";
const MIRROR_BASE = "https://alfa-leetcode-api.onrender.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min server-side cache
const FETCH_TIMEOUT_MS = 8000;

// Module-scope cache: persists across warm invocations of the same lambda
// instance. Not shared across instances/regions, but that's fine — it just
// needs to absorb bursts, not be a global source of truth.
const cache = new Map(); // key -> { data, expiresAt }

exports.handler = async function (event) {
  const cors = corsHeaders();
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return respond(405, { error: "Method not allowed." }, cors);
  }

  const route = parseRoute(event.path);
  if (!route) {
    return respond(404, { error: "Unknown LeetCode proxy route." }, cors);
  }

  const { kind, username } = route;
  if (!username || !/^[A-Za-z0-9_-]{1,50}$/.test(username)) {
    return respond(400, { error: "Missing or invalid username." }, cors);
  }

  const cacheKey = kind + ":" + username.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return respond(200, cached.data, Object.assign({ "x-lc-cache": "hit" }, cors));
  }

  try {
    const data = await retry(function () {
      return kind === "profile"
        ? fetchProfileViaGraphQL(username)
        : kind === "contest"
        ? fetchContestViaGraphQL(username)
        : fetchCalendarViaGraphQL(username);
    }, 2, 500);

    cache.set(cacheKey, { data: data, expiresAt: Date.now() + CACHE_TTL_MS });
    return respond(200, data, Object.assign({ "x-lc-source": "graphql" }, cors));
  } catch (graphqlErr) {
    // Official API unreachable/blocked — fall back to the community mirror
    // so the feature still works, just without the cold-start protection.
    try {
      const data = await retry(function () {
        return fetchViaMirror(kind, username);
      }, 1, 500);
      cache.set(cacheKey, { data: data, expiresAt: Date.now() + CACHE_TTL_MS });
      return respond(200, data, Object.assign({ "x-lc-source": "mirror-fallback" }, cors));
    } catch (mirrorErr) {
      const status = mirrorErr.status || graphqlErr.status || 502;
      const message =
        status === 404
          ? "LeetCode user not found."
          : status === 429
          ? "LeetCode is rate-limiting requests right now — please try again shortly."
          : "Couldn't reach LeetCode right now (tried the official API and the backup mirror). Please try again shortly.";
      return respond(status === 404 ? 404 : 502, { error: message }, cors);
    }
  }
};

function parseRoute(path) {
  // path looks like /.netlify/functions/leetcode/userProfile/tourist
  // or /api/leetcode/tourist/contest depending on how Netlify hands it in.
  const parts = path.split("/").filter(Boolean);
  const i = parts.indexOf("leetcode");
  const rest = i >= 0 ? parts.slice(i + 1) : [];

  if (rest.length === 2 && rest[0] === "userProfile") {
    return { kind: "profile", username: decodeURIComponent(rest[1]) };
  }
  if (rest.length === 2 && rest[1] === "contest") {
    return { kind: "contest", username: decodeURIComponent(rest[0]) };
  }
  if (rest.length === 2 && rest[1] === "calendar") {
    return { kind: "calendar", username: decodeURIComponent(rest[0]) };
  }
  return null;
}

// ---- Official GraphQL path -------------------------------------------------

async function graphqlRequest(query, variables) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(LEETCODE_GRAPHQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // LeetCode's public GraphQL endpoint expects a browser-like
        // Referer/Origin for unauthenticated profile queries.
        Referer: "https://leetcode.com",
        Origin: "https://leetcode.com",
        "User-Agent": "Mozilla/5.0 (compatible; dashboard-leetcode-proxy/1.0)"
      },
      body: JSON.stringify({ query: query, variables: variables }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const err = new Error("LeetCode GraphQL error (" + res.status + ").");
    err.status = res.status >= 500 || res.status === 429 ? res.status : 502;
    throw err;
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    const err = new Error(json.errors.map(function (e) { return e.message; }).join("; "));
    err.status = 502;
    throw err;
  }
  return json.data;
}

async function fetchProfileViaGraphQL(username) {
  const data = await graphqlRequest(
    "query getUserProfile($username: String!) {" +
      "  matchedUser(username: $username) {" +
      "    username" +
      "    profile { ranking reputation }" +
      "    contributions { points }" +
      "    submitStatsGlobal {" +
      "      acSubmissionNum { difficulty count }" +
      "      totalSubmissionNum { difficulty count submissions }" +
      "    }" +
      "  }" +
      "  allQuestionsCount { difficulty count }" +
      "}",
    { username: username }
  );

  const user = data && data.matchedUser;
  if (!user) {
    const err = new Error("LeetCode user not found.");
    err.status = 404;
    throw err;
  }

  const totalsByDifficulty = toDifficultyMap(data.allQuestionsCount, "count");
  const acByDifficulty = toDifficultyMap(user.submitStatsGlobal && user.submitStatsGlobal.acSubmissionNum, "count");
  const totalSubByDifficulty = toDifficultyMap(
    user.submitStatsGlobal && user.submitStatsGlobal.totalSubmissionNum,
    "submissions"
  );

  const acAll = acByDifficulty.All || 0;
  const totalSubAll = totalSubByDifficulty.All || 0;

  return {
    totalSolved: acAll,
    totalQuestions: totalsByDifficulty.All || 0,
    easySolved: acByDifficulty.Easy || 0,
    totalEasy: totalsByDifficulty.Easy || 0,
    mediumSolved: acByDifficulty.Medium || 0,
    totalMedium: totalsByDifficulty.Medium || 0,
    hardSolved: acByDifficulty.Hard || 0,
    totalHard: totalsByDifficulty.Hard || 0,
    acceptanceRate: totalSubAll > 0 ? Math.round((acAll / totalSubAll) * 1000) / 10 : null,
    ranking: user.profile && user.profile.ranking != null ? user.profile.ranking : null,
    reputation: user.profile && user.profile.reputation != null ? user.profile.reputation : null,
    contributionPoint: user.contributions && user.contributions.points != null ? user.contributions.points : null
  };
}

async function fetchContestViaGraphQL(username) {
  const data = await graphqlRequest(
    "query userContestRankingInfo($username: String!) {" +
      "  userContestRanking(username: $username) {" +
      "    attendedContestsCount" +
      "    rating" +
      "    globalRanking" +
      "    topPercentage" +
      "  }" +
      "  userContestRankingHistory(username: $username) {" +
      "    attended" +
      "    rating" +
      "    ranking" +
      "    contest { title startTime }" +
      "  }" +
      "}",
    { username: username }
  );

  const summary = data && data.userContestRanking;
  const history = (data && data.userContestRankingHistory) || [];

  return {
    contestRating: summary && summary.rating != null ? summary.rating : null,
    contestGlobalRanking: summary && summary.globalRanking != null ? summary.globalRanking : null,
    contestTopPercentage: summary && summary.topPercentage != null ? summary.topPercentage : null,
    contestAttend: summary && summary.attendedContestsCount != null ? summary.attendedContestsCount : null,
    contestParticipation: history
      .filter(function (h) { return h && h.attended; })
      .map(function (h) {
        return {
          contest: { title: (h.contest && h.contest.title) || "Contest", startTime: h.contest && h.contest.startTime },
          rating: h.rating,
          ranking: h.ranking
        };
      })
  };
}

async function fetchCalendarViaGraphQL(username) {
  const data = await graphqlRequest(
    "query userProfileCalendar($username: String!) {" +
      "  matchedUser(username: $username) {" +
      "    userCalendar { submissionCalendar }" +
      "  }" +
      "}",
    { username: username }
  );

  const user = data && data.matchedUser;
  if (!user) {
    const err = new Error("LeetCode user not found.");
    err.status = 404;
    throw err;
  }
  return {
    submissionCalendar: (user.userCalendar && user.userCalendar.submissionCalendar) || "{}"
  };
}

function toDifficultyMap(list, countField) {
  const map = {};
  (list || []).forEach(function (item) {
    if (item && item.difficulty) map[item.difficulty] = Number(item[countField]) || 0;
  });
  return map;
}

// ---- Community mirror fallback --------------------------------------------

async function fetchViaMirror(kind, username) {
  const path =
    kind === "profile"
      ? "/userProfile/" + encodeURIComponent(username)
      : kind === "contest"
      ? "/" + encodeURIComponent(username) + "/contest"
      : "/" + encodeURIComponent(username) + "/calendar";

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(MIRROR_BASE + path, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const err = new Error("Mirror error (" + res.status + ").");
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---- Shared helpers ---------------------------------------------------------

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
