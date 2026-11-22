/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
(function () {
  function promote(link) {
    if (link && link.tagName === "LINK") link.media = "all";
  }
  document.addEventListener(
    "load",
    function (ev) {
      promote(ev.target);
    },
    true
  );
  document.addEventListener("DOMContentLoaded", function () {
    var pending = document.querySelectorAll("link[data-promote-on-load]");
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].sheet) promote(pending[i]);
      else
        pending[i].addEventListener("load", function () {
          promote(this);
        });
    }
  });
})();
