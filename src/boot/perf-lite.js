/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
// v221 perf-lite: Brave (and low-end / data-saver devices) often run without GPU
// compositing, where decorative always-on effects are expensive. Detected
// synchronously; users can force it either way with localStorage arise-perf-mode = "lite" | "full".
(function () {
  try {
    var pref = localStorage.getItem("arise-perf-mode");
    var nav = navigator,
      c = nav.connection || {};
    var reduceMotion = false;
    try {
      reduceMotion = !!(
        window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    } catch (rm) {}
    var lite =
      pref === "full"
        ? false
        : pref === "lite" ||
          reduceMotion ||
          !!nav.brave ||
          (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) ||
          (nav.deviceMemory && nav.deviceMemory <= 4) ||
          c.saveData === true;
    if (lite) document.documentElement.classList.add("perf-lite");
    if (reduceMotion) document.documentElement.classList.add("reduce-motion");
  } catch (e) {}
})();
