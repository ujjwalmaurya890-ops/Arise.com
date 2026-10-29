/* ==========================================================================
   Mount Safety & Error Boundary Wrapper (src/mount-safety.js)
   --------------------------------------------------------------------------
   Wraps every window.__mount* / window.__unmount* function so synchronous
   exceptions or rejected Promises in one widget never crash sibling widgets
   AND never leave a mount container blank or stuck aria-busy="true".
   Renders a themed, accessible .uxa-error-state with a Retry button on error.
   ========================================================================== */
(function () {
  "use strict";
  if (window.__ariseMountSafetyInstalled) return;
  window.__ariseMountSafetyInstalled = true;

  var mountErrors = (window.__ariseMountErrors = []);
  // A rejected old mount must not replace a newer render (or a detached view).
  var mountGenerations = new WeakMap();

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function recordMountError(name, err) {
    mountErrors.push({
      widget: name,
      message: (err && err.message) || String(err),
      stack: err && err.stack ? err.stack : null,
      time: new Date().toISOString()
    });
    if (mountErrors.length > 50) mountErrors.shift();
    console.error("[mount-safety] " + name + " threw:", err);
  }

  function renderWidgetError(el, name, retryFn) {
    if (!el || el.nodeType !== 1 || name.indexOf("__unmount") === 0) return;
    el.removeAttribute("aria-busy");
    var label = name.replace(/^__mount/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || "Widget";
    el.innerHTML =
      '<div class="uxa-error-state" data-uxa-mount-error="1" role="alert">' +
        '<div class="uxa-state-title">' + escapeHtml(label) + " encountered an error</div>" +
        '<div class="uxa-state-desc">This module could not finish rendering. Your saved progress is unaffected.</div>' +
        '<button type="button" class="uxa-retry-btn" data-uxa-mount-retry="1">Retry ' + escapeHtml(label) + "</button>" +
      "</div>";
    var btn = el.querySelector("[data-uxa-mount-retry]");
    if (btn && typeof retryFn === "function") {
      btn.addEventListener("click", function () {
        el.innerHTML = "";
        retryFn();
      });
    }
  }

  function wrap(name, fn) {
    if (typeof fn !== "function" || fn.__ariseWrapped) return fn;
    var safe = function () {
      var args = Array.prototype.slice.call(arguments);
      var targetEl = args[0] && args[0].nodeType === 1 ? args[0] : null;
      var generation = targetEl ? (mountGenerations.get(targetEl) || 0) + 1 : 0;
      if (targetEl) mountGenerations.set(targetEl, generation);
      var isCurrent = function () {
        return !targetEl || (targetEl.isConnected !== false && mountGenerations.get(targetEl) === generation);
      };
      var retry = function () {
        safe.apply(window, args);
      };
      function fail(err) {
        if (!isCurrent() || (err && err.name === "AbortError")) return;
        recordMountError(name, err);
        renderWidgetError(targetEl, name, retry);
      }
      try {
        var out = fn.apply(this, arguments);
        if (out && typeof out.then === "function") {
          return out.then(function (val) { return val; }, fail);
        }
        // The widget owns aria-busy: a synchronous mount can start an async
        // request and must remain busy until that request actually settles.
        return out;
      } catch (err) {
        fail(err);
      }
    };
    safe.__ariseWrapped = true;
    safe.__ariseOriginal = fn;
    return safe;
  }

  function scan() {
    var keys = Object.keys(window);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if ((k.indexOf("__mount") === 0 || k.indexOf("__unmount") === 0) && typeof window[k] === "function") {
        window[k] = wrap(k, window[k]);
      }
    }
  }

  scan();
  window.addEventListener("load", scan);
  setTimeout(scan, 1500);
})();
