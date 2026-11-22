/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
// Stability patch: with 50+ independently-authored widget scripts,
// an uncaught exception or rejected promise in any one of them used
// to fail completely silently in production - no console trace a
// user would ever see, no record anywhere that it happened. This is
// installed first, before any other script, so it catches errors
// from the whole page lifecycle (deferred scripts, the app-bundle
// module, and the lazily-injected widgets alike). Purely additive:
// it only observes and records, it never suppresses an error or
// changes how anything runs.
(function () {
  var MAX_ENTRIES = 50;
  var errors = [];
  window.__ariseRuntimeErrors = errors;

  function record(entry) {
    entry.time = new Date().toISOString();
    errors.push(entry);
    if (errors.length > MAX_ENTRIES) errors.shift();
    console.error("[runtime-error]", entry);
    if (typeof window.__ariseReportRuntimeError === "function") {
      try {
        window.__ariseReportRuntimeError(entry);
      } catch (e) {}
    }
  }

  window.addEventListener("error", function (event) {
    // Ignore resource load errors here (img/script/link 404s) -
    // the widget loader already tracks script failures separately;
    // this is for actual JS runtime exceptions.
    if (event.error === undefined && event.message === undefined) return;
    record({
      type: "error",
      message: event.message || (event.error && event.error.message) || "Unknown error",
      source: event.filename || null,
      line: event.lineno || null,
      column: event.colno || null,
      stack: event.error && event.error.stack ? event.error.stack : null
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    record({
      type: "unhandledrejection",
      message: (reason && (reason.message || String(reason))) || "Unknown rejection",
      stack: reason && reason.stack ? reason.stack : null
    });
  });
})();
