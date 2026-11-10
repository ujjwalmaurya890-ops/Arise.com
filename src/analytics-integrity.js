/* ==========================================================================
   Analytics integrity (src/analytics-integrity.js)
   --------------------------------------------------------------------------
   The Analytics page, the Study-Hours widget, Session Analytics and the weekly
   report each compute their own numbers from focusSessionsV2. Two defects were
   provable in those calculations:

     1. day keys were derived with `date.toISOString().split("T")[0]`, which is
        the UTC date. For anyone east of Greenwich an 05:00 study session is
        filed under the previous day, and "today" resets at 05:30 in India.
        A session at 00:30 local time was counted in yesterday's total, and the
        14-day trend bars were shifted by one day.
     2. the weekly report compared "this week" against the previous seven days
        using those same UTC keys, so a Monday-morning report could report a
        negative change and a session logged late on Sunday disappeared.

   This module is the single authority for calendar-day keys. It exposes a
   local-time day key, week ranges, session de-duplication and an explained
   period summary, and it writes nothing but an optional diagnostics flag.

   Public API (window.AriseAnalytics)
   ----------------------------------
   dayKey(date)                    -> "YYYY-MM-DD" in LOCAL time
   addDays(key, delta)             -> "YYYY-MM-DD"
   rangeKeys(endKey, days)         -> oldest..newest keys
   fromKey(key)                    -> Date at local midnight
   sessions()                      -> normalised, de-duplicated sessions
   summarise({ days, now })        -> totals, per-day buckets, per-category, deltas
   weekOf(date)                    -> { start, end, keys }
   audit()                         -> { utcMismatches, duplicates, undated, future }
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseAnalytics) return;

  var FOCUS_KEY = "focusSessionsV2";
  var LEGACY_KEY = "studySessions";
  var MIGRATION_FLAG = "arise-analytics-integrity-v1";
  var MAX_FUTURE_DAYS = 1;

  function pad(value) {
    return (value < 10 ? "0" : "") + value;
  }

  // The whole point of this module: never use toISOString() for a day key.
  function dayKey(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function utcKey(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  function fromKey(key) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) return null;
    var d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(key, delta) {
    var d = fromKey(key);
    if (!d) return null;
    d.setDate(d.getDate() + Number(delta || 0));
    return dayKey(d);
  }

  function rangeKeys(endKey, days) {
    var out = [];
    var requested = days == null ? 14 : Number(days);
    if (!isFinite(requested)) requested = 14;
    var count = Math.max(1, Math.min(400, Math.round(requested)));
    var end = fromKey(endKey);
    if (!end) return out;
    for (var i = count - 1; i >= 0; i--) {
      var d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
      out.push(dayKey(d));
    }
    return out;
  }

  function weekOf(date) {
    var d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (isNaN(d.getTime())) return null;
    var offset = (d.getDay() + 6) % 7; // Monday first
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    var keys = [];
    for (var i = 0; i < 7; i++) {
      keys.push(dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }
    return { start: dayKey(start), end: dayKey(end), keys: keys };
  }

  function readArray(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null || raw === "") return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function minutesOf(session) {
    var minutes = Number(session && session.minutes);
    if (!isFinite(minutes) || minutes <= 0) {
      // Older records stored duration in seconds.
      var seconds = Number(session && (session.duration || session.seconds));
      if (isFinite(seconds) && seconds > 0) minutes = seconds / 60;
    }
    if (!isFinite(minutes) || minutes <= 0) return 0;
    return Math.round(minutes * 100) / 100;
  }

  function whenOf(session) {
    var stamp = session && (session.endedAt || session.startedAt || session.date);
    if (!stamp) return null;
    var d = new Date(stamp);
    if (!isNaN(d.getTime())) return d;
    // "YYYY-MM-DD" is already a calendar date: parse it as local midnight.
    var key = fromKey(stamp);
    return key;
  }

  function normalise(session, origin) {
    if (!session || typeof session !== "object") return null;
    var minutes = minutesOf(session);
    if (minutes <= 0) return null;
    var when = whenOf(session);
    if (!when) return null;
    var category = typeof session.category === "string" && session.category ? session.category : "Other";
    return {
      id: session.id != null ? String(session.id) : null,
      origin: origin,
      minutes: minutes,
      category: category,
      when: when,
      day: dayKey(when),
      // What the old UTC code would have produced, kept for audit() only.
      utcDay: utcKey(when),
      storedDate: typeof session.date === "string" ? session.date : null,
      rating: typeof session.rating === "number" && session.rating > 0 ? session.rating : null,
      distractions: isFinite(Number(session.distractions)) ? Number(session.distractions) : 0
    };
  }

  // The Focus Timer writes to focusSessionsV2; several older widgets also read
  // the legacy studySessions array. Both are read, and an entry that exists in
  // both places is counted once (same minutes + same minute of the day).
  function sessions() {
    var collected = [];
    readArray(FOCUS_KEY).forEach(function (session) {
      var entry = normalise(session, "focus");
      if (entry) collected.push(entry);
    });
    readArray(LEGACY_KEY).forEach(function (session) {
      var entry = normalise(session, "legacy");
      if (!entry) return;
      var duplicate = collected.some(function (known) {
        return known.minutes === entry.minutes &&
          known.category === entry.category &&
          Math.abs(known.when.getTime() - entry.when.getTime()) < 120000;
      });
      if (!duplicate) collected.push(entry);
    });
    collected.sort(function (a, b) { return a.when - b.when; });
    return collected;
  }

  function summarise(options) {
    var opts = options || {};
    var now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    var days = Math.max(1, Math.min(120, Number(opts.days) || 7));
    var endKey = dayKey(now);
    var keys = rangeKeys(endKey, days);
    var startKey = keys[0];
    var previousStart = addDays(startKey, -days);
    var previousEnd = addDays(startKey, -1);

    var list = sessions();
    var buckets = {};
    var categories = {};
    var byDayCategory = {};
    keys.forEach(function (key) { buckets[key] = 0; });

    var current = 0, previous = 0, counted = 0, avgRatingSum = 0, avgRatingCount = 0, distractions = 0;
    list.forEach(function (entry) {
      var key = entry.day;
      if (key > endKey) return; // a session dated in the future never counts
      if (key >= startKey && key <= endKey) {
        buckets[key] = Math.round((buckets[key] + entry.minutes) * 100) / 100;
        categories[entry.category] = Math.round(((categories[entry.category] || 0) + entry.minutes) * 100) / 100;
        byDayCategory[key] = byDayCategory[key] || {};
        byDayCategory[key][entry.category] = Math.round(((byDayCategory[key][entry.category] || 0) + entry.minutes) * 100) / 100;
        current += entry.minutes;
        counted += 1;
        distractions += entry.distractions;
        if (entry.rating) { avgRatingSum += entry.rating; avgRatingCount += 1; }
      } else if (previousStart && previousEnd && key >= previousStart && key <= previousEnd) {
        previous += entry.minutes;
      }
    });

    var activeDays = keys.filter(function (key) { return buckets[key] > 0; }).length;
    var delta = previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);

    return {
      range: { start: startKey, end: endKey, days: days, keys: keys },
      previous: { start: previousStart, end: previousEnd, minutes: Math.round(previous) },
      minutes: Math.round(current * 100) / 100,
      hours: Math.round((current / 60) * 10) / 10,
      avgPerDay: Math.round((current / days) * 10) / 10,
      avgPerActiveDay: activeDays ? Math.round((current / activeDays) * 10) / 10 : 0,
      activeDays: activeDays,
      sessions: counted,
      buckets: buckets,
      byCategory: categories,
      byDayCategory: byDayCategory,
      deltaPercent: Math.round(delta),
      avgRating: avgRatingCount ? Math.round((avgRatingSum / avgRatingCount) * 10) / 10 : null,
      distractions: distractions,
      // Explicit statement for the UI: no data is a real state, not zero-fill.
      hasData: counted > 0,
      source: "focusSessionsV2"
    };
  }

  // Reports what the previous UTC-based maths got wrong for this browser, so a
  // regression test and the diagnostics view can both point at real records.
  function audit(options) {
    var opts = options || {};
    var now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
    var today = dayKey(now);
    var list = sessions();
    var utcMismatches = [];
    var future = [];
    var duplicates = 0;
    var seen = {};
    list.forEach(function (entry) {
      if (entry.utcDay && entry.utcDay !== entry.day) {
        utcMismatches.push({
          id: entry.id,
          at: entry.when.toISOString(),
          localDay: entry.day,
          utcDay: entry.utcDay,
          category: entry.category,
          minutes: entry.minutes
        });
      }
      if (entry.day > addDays(today, MAX_FUTURE_DAYS)) future.push({ id: entry.id, day: entry.day });
      var stamp = entry.id || entry.day + "|" + entry.minutes + "|" + entry.category;
      if (seen[stamp]) duplicates += 1;
      seen[stamp] = true;
    });
    return {
      total: list.length,
      utcMismatches: utcMismatches,
      utcMismatchCount: utcMismatches.length,
      future: future,
      duplicateIds: duplicates,
      firstDay: list.length ? list[0].day : null,
      lastDay: list.length ? list[list.length - 1].day : null,
      timezoneOffsetMinutes: -now.getTimezoneOffset(),
      today: today,
      flagKey: MIGRATION_FLAG
    };
  }

  /* ------------------------------------------------------------------- UI -- */

  var RANGES = [7, 30, 90];
  var mountedCard = null;
  var range = 7;

  function readRange() {
    try {
      var raw = localStorage.getItem(MIGRATION_FLAG);
      var parsed = raw ? JSON.parse(raw) : null;
      var value = parsed && Number(parsed.range);
      if (RANGES.indexOf(value) !== -1) return value;
    } catch {}
    return 7;
  }

  function saveRange(next) {
    try { localStorage.setItem(MIGRATION_FLAG, JSON.stringify({ version: 1, range: next })); } catch {}
  }

  function routeIsAnalytics() {
    var main = document.getElementById("arise-main");
    var heading = main && main.querySelector("header h1");
    return !!heading && /analytics/i.test(heading.textContent || "");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmtMinutes(minutes) {
    var value = Number(minutes) || 0;
    if (!value) return "0m";
    if (value < 60) return Math.round(value) + "m";
    var hours = Math.floor(value / 60);
    var rest = Math.round(value - hours * 60);
    return rest ? hours + "h " + rest + "m" : hours + "h";
  }

  function cardHtml(summary, details) {
    var max = 0;
    summary.range.keys.forEach(function (key) { max = Math.max(max, summary.buckets[key] || 0); });
    var bars = summary.range.keys.map(function (key) {
      var value = summary.buckets[key] || 0;
      var height = max ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
      return '<span class="ani-bar" data-empty="' + (value ? "false" : "true") + '" style="--ani-h:' + height +
        '%" title="' + esc(key) + " · " + esc(fmtMinutes(value)) + '"></span>';
    }).join("");

    var categories = Object.keys(summary.byCategory).sort(function (a, b) { return summary.byCategory[b] - summary.byCategory[a]; });
    var categoryRows = categories.length ? categories.map(function (name) {
      var share = summary.minutes ? Math.round((summary.byCategory[name] / summary.minutes) * 100) : 0;
      return '<li class="ani-cat"><span class="ani-cat-name">' + esc(name) + '</span>' +
        '<span class="ani-cat-track"><span class="ani-cat-fill" style="--ani-w:' + share + '%"></span></span>' +
        '<span class="ani-cat-value">' + esc(fmtMinutes(summary.byCategory[name])) + "</span></li>";
    }).join("") : "";

    var deltaLabel = summary.previous.minutes === 0
      ? (summary.minutes ? "first activity in this range" : "no sessions in either range")
      : (summary.deltaPercent > 0 ? "+" : "") + summary.deltaPercent + "% vs previous " + summary.range.days + " days";

    var accuracy;
    if (!details.total) {
      accuracy = "No focus sessions recorded yet — this card stays empty instead of showing zeroed charts.";
    } else if (details.utcMismatchCount) {
      accuracy = details.utcMismatchCount + " of " + details.total + " saved sessions were being filed under the wrong calendar day (UTC vs local). They are counted on the day you actually studied here.";
    } else {
      accuracy = "All " + details.total + " saved sessions already match their local calendar day.";
    }

    return '<div class="ani-head"><div><h3 class="ani-title">Period accuracy</h3>' +
      '<p class="ani-sub">Any range, compared with the previous range of the same length, bucketed by your local calendar day.</p></div>' +
      '<div class="ani-ranges" role="group" aria-label="Range">' +
      RANGES.map(function (option) {
        return '<button type="button" class="ani-range" data-ani-range="' + option + '" aria-pressed="' + (option === range ? "true" : "false") + '">' + option + "d</button>";
      }).join("") + "</div></div>" +
      '<div class="ani-stats">' +
      '<div class="ani-stat"><strong>' + esc(fmtMinutes(summary.minutes)) + "</strong><span>studied</span></div>" +
      '<div class="ani-stat"><strong>' + esc(summary.activeDays + "/" + summary.range.days) + "</strong><span>active days</span></div>" +
      '<div class="ani-stat"><strong>' + esc(fmtMinutes(summary.avgPerActiveDay)) + "</strong><span>per active day</span></div>" +
      '<div class="ani-stat"><strong>' + esc(summary.avgRating == null ? "—" : summary.avgRating + "/5") + "</strong><span>avg focus rating</span></div>" +
      "</div>" +
      '<p class="ani-delta" data-ani-trend="' + (summary.deltaPercent > 0 ? "up" : summary.deltaPercent < 0 ? "down" : "flat") + '">' + esc(deltaLabel) + "</p>" +
      '<div class="ani-chart" role="img" aria-label="' + esc(summary.range.days + "-day study minutes from " + summary.range.start + " to " + summary.range.end) + '">' + bars + "</div>" +
      (categoryRows ? '<ul class="ani-cats">' + categoryRows + "</ul>" : "") +
      '<p class="ani-accuracy">' + esc(accuracy) + "</p>" +
      '<p class="ani-empty-note" data-ani-has-data="' + (summary.hasData ? "true" : "false") + '">' +
      (summary.hasData ? "" : "Log a focus session and this range fills in automatically.") + "</p>";
  }

  function renderCard() {
    if (!mountedCard) return;
    var body = mountedCard.querySelector(".ani-body");
    if (!body) return;
    body.innerHTML = cardHtml(summarise({ days: range }), audit());
  }

  // The route body is the direct child of the flex column; the .space-y-6 card
  // stack lives inside it. Appending straight into the flex column put the card
  // after the route (and outside the page widget bar's chip list).
  function home() {
    var main = document.getElementById("arise-main");
    if (!main) return null;
    var stack = main.querySelector(".space-y-6");
    if (stack) return stack;
    var flex = main.querySelector(":scope > div.flex-1");
    if (!flex) return null;
    // Early in a route change the stack does not exist yet: prefer the route
    // state wrapper's own container so the card never lands beside the route.
    var routeState = flex.querySelector(":scope > .arise-route-state");
    var inner = routeState ? routeState.firstElementChild : (flex.firstElementChild || flex);
    if (inner && inner.id === "upp-data-health-card") inner = inner.nextElementSibling || inner;
    return inner || flex;
  }

  function mount() {
    if (!routeIsAnalytics()) return false;
    var host = home();
    if (!host) return false;
    if (!mountedCard || !mountedCard.isConnected) {
      mountedCard = document.createElement("section");
      mountedCard.id = "ani-card";
      mountedCard.className = "glass-card rounded-2xl p-5 ani-card";
      mountedCard.setAttribute("aria-labelledby", "ani-title");
      mountedCard.innerHTML = '<div class="ani-body"></div>';
      mountedCard.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest("[data-ani-range]") : null;
        if (!btn) return;
        var next = Number(btn.getAttribute("data-ani-range"));
        if (RANGES.indexOf(next) === -1 || next === range) return;
        range = next;
        saveRange(range);
        renderCard();
        var active = mountedCard.querySelector('[data-ani-range="' + range + '"]');
        if (active && typeof active.focus === "function") active.focus();
      });
    }
    // Re-home the card when the route finished rendering after we mounted into
    // its placeholder, so it always sits inside the current card stack.
    if (mountedCard.parentElement !== host) host.appendChild(mountedCard);
    renderCard();
    // The heading lives inside the rendered body, so keep its id in sync with
    // the card's aria-labelledby on every render.
    var title = mountedCard.querySelector(".ani-title");
    if (title && !title.id) title.id = "ani-title";
    return true;
  }

  function unmount() {
    if (mountedCard && mountedCard.parentNode) mountedCard.parentNode.removeChild(mountedCard);
  }

  range = readRange();

  window.AriseAnalytics = {
    dayKey: dayKey,
    utcKey: utcKey,
    fromKey: fromKey,
    addDays: addDays,
    rangeKeys: rangeKeys,
    weekOf: weekOf,
    sessions: sessions,
    summarise: summarise,
    audit: audit,
    focusKey: FOCUS_KEY,
    legacyKey: LEGACY_KEY,
    mount: mount,
    unmount: unmount,
    refresh: renderCard,
    get range() { return range; },
    ranges: RANGES
  };

  /* --------------------------------------------------------------- boot -- */

    function tick() {
      try {
        if (routeIsAnalytics()) mount();
        else if (mountedCard && mountedCard.isConnected) unmount();
      } catch {}
    }
    function start() {
      tick();
      if (typeof MutationObserver === "function" && document.body) {
        var scheduled = null;
        var observer = new MutationObserver(function () {
          if (scheduled) return;
          scheduled = setTimeout(function () { scheduled = null; tick(); }, 220);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      window.addEventListener("storage", tick);
    }
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start);
})();
