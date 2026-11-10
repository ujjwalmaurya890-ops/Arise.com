/* ==========================================================================
   Accessibility audit (src/a11y-audit.js)
   --------------------------------------------------------------------------
   The shell already ships a skip link, labelled nav/aside landmarks, aria-live
   regions, Escape handling in several dialogs, a reduced-motion stylesheet and
   theme focus rings. Auditing it again by hand is what produced the following
   gap: index.html puts a visible "Skip to main content" link in front of every
   route, but the skip target (#arise-main) is not focusable, and the route is
   never announced — so activating the link scrolls the page and leaves focus
   where it was, and a keyboard user has no idea the route changed.

   This module fixes those two things and makes them testable, without touching
   the React bundle:

   1. #arise-main becomes a labelled, programmatically focusable main landmark,
      so the skip link actually moves focus;
   2. each route change is announced through one polite live region (the shell
      already announces "Analytics page" in some routes — this one only speaks
      when the heading changed, so nothing is announced twice);
   3. the landmark, the skip link and the live region are exposed through
      audit(), so a regression test can assert them instead of trusting them.

   Public API (window.AriseA11y)
   -----------------------------
   ensureLandmarks()          -> { main, skipLink, live }
   announce(text)             -> speaks through the polite live region
   audit()                    -> { main{...}, skipLink{...}, live{...}, route{...} }
   ========================================================================== */
(function () {
  "use strict";
  if (window.AriseA11y) return;

  var LIVE_ID = "arise-a11y-route-live";
  var lastHeading = null;

  function main() { return document.getElementById("arise-main"); }

  function skipLink() {
    return document.querySelector('a.arise-skip-link[href="#arise-main"], a[href="#arise-main"].arise-sk');
  }

  function routeHeading() {
    var host = main();
    var heading = host && host.querySelector("header h1");
    return heading ? String(heading.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  // The skip link only works if its target can receive focus on demand.
  function ensureLandmarks() {
    var host = main();
    var link = skipLink();
    if (host) {
      if (!host.hasAttribute("role")) host.setAttribute("role", "main");
      if (!host.hasAttribute("tabindex")) host.setAttribute("tabindex", "-1");
      if (!host.hasAttribute("aria-label")) host.setAttribute("aria-label", "Main content");
    }
    if (link && !link.getAttribute("aria-label")) {
      link.setAttribute("aria-label", "Skip to main content");
    }
    var live = document.getElementById(LIVE_ID);
    if (!live && document.body) {
      live = document.createElement("div");
      live.id = LIVE_ID;
      live.className = "sr-only";
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      // Hidden visually but still announced: .sr-only must not use display:none.
      live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;";
      document.body.appendChild(live);
    }
    if (host && !host.__ariseA11ySkip) {
      var onSkip = function (event) {
        // Follow the link ourselves so focus lands on the landmark even when the
        // browser would only move the scroll position.
        event.preventDefault();
        host.focus({ preventScroll: true });
        if (typeof host.scrollIntoView === "function") host.scrollIntoView({ block: "start" });
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(null, "", "#arise-main");
        }
      };
      if (link) link.addEventListener("click", onSkip);
      host.__ariseA11ySkip = true;
    }
    return { main: host, skipLink: link, live: live || document.getElementById(LIVE_ID) };
  }

  function announce(text) {
    var live = document.getElementById(LIVE_ID);
    if (!live || !text) return false;
    // Re-writing the same string would not be re-announced, so clear first.
    if (live.textContent === text) {
      live.textContent = "";
      setTimeout(function () { live.textContent = text; }, 30);
    } else {
      live.textContent = text;
    }
    return true;
  }

  function routeTick() {
    ensureLandmarks();
    var heading = routeHeading();
    if (!heading || heading === lastHeading) return;
    var first = lastHeading == null;
    lastHeading = heading;
    // Only announce real route changes; the initial load is already covered by
    // the shell's own "Your saved progress is restored" status.
    if (!first) announce(heading + " page");
  }

  function audit() {
    ensureLandmarks();
    var host = main();
    var link = skipLink();
    var live = document.getElementById(LIVE_ID);
    var focusable = 0;
    var named = 0;
    var interactive = [];
    if (host) {
      // Inputs wrapped in a <label> (or referenced by label[for]) are already
      // named by that label, so counting them as unnamed would be a false alarm.
      interactive = Array.prototype.slice.call(host.querySelectorAll('button, [href], input, select, textarea, [role="button"]')).filter(function (el) {
        return !el.closest("label") && !(el.id && document.querySelector('label[for="' + el.id + '"]'));
      });
      focusable = interactive.filter(function (el) {
        return !el.disabled && el.getAttribute("tabindex") !== "-1";
      }).length;
      named = interactive.filter(function (el) {
        var label = (el.getAttribute("aria-label") || "").trim() ||
          (el.getAttribute("aria-labelledby") || "").trim() ||
          String(el.textContent || "").trim() ||
          (el.getAttribute("title") || "").trim() ||
          (el.getAttribute("alt") || "").trim();
        return !!label;
      }).length;
    }
    var positiveTabindex = host ? host.querySelectorAll('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').length : 0;
    return {
      main: {
        present: !!host,
        role: host && host.getAttribute("role"),
        tabindex: host && host.getAttribute("tabindex"),
        label: host && host.getAttribute("aria-label"),
        focusable: !!host && (host.tabIndex === 0 || host.getAttribute("tabindex") !== null)
      },
      skipLink: {
        present: !!link,
        href: link && link.getAttribute("href"),
        text: link ? String(link.textContent || "").trim() : "",
        label: link && link.getAttribute("aria-label")
      },
      live: {
        present: !!live,
        role: live && live.getAttribute("role"),
        polite: !!live && live.getAttribute("aria-live") === "polite",
        atomic: !!live && live.getAttribute("aria-atomic") === "true",
        visuallyHidden: !!live && live.getBoundingClientRect().width <= 1
      },
      route: { heading: routeHeading(), announced: lastHeading },
      controls: {
        total: interactive.length,
        focusable: focusable,
        named: named,
        labelledByWrapper: host ? host.querySelectorAll('label > input, label > select, label > textarea, label[for]').length : 0,
        unnamed: interactive.length - named,
        positiveTabindex: positiveTabindex
      }
    };
  }

  window.AriseA11y = {
    ensureLandmarks: ensureLandmarks,
    announce: announce,
    audit: audit,
    routeHeading: routeHeading,
    liveId: LIVE_ID
  };

  /* --------------------------------------------------------------- boot -- */

  var pending = null;
  function schedule() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; try { routeTick(); } catch {} }, 200);
  }

  function start() {
    ensureLandmarks();
    routeTick();
    // The React shell swaps route content, so watch rather than poll.
    if (typeof MutationObserver === "function" && document.body) {
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
