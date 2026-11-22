/* Extracted from index.html inline <script> (CSP: script-src 'self' only).
   Do not inline this again; edit here and keep index.html referencing this file. */
(function () {
  var darkThemes = [
    "cyberMidnightPro",
    "amoled",
    "dracula",
    "linearDark",
    "vercelMono",
    "supabaseDark"
  ];
  try {
    if (localStorage.getItem("showLanding") === "false") {
      document.documentElement.setAttribute("data-arise-auth", "1");
    }
    var mode = localStorage.getItem("arise-dashboard-theme-mode") || "dark";
    var prefersLight =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    var storedTheme =
      mode === "system"
        ? prefersLight
          ? "white"
          : "cyberMidnightPro"
        : localStorage.getItem("arise-dashboard-theme") || "cyberMidnightPro";
    document.documentElement.setAttribute("data-theme", storedTheme);
    document.documentElement.setAttribute(
      "data-theme-mode",
      darkThemes.indexOf(storedTheme) !== -1 ? "dark" : "light"
    );
    document.documentElement.classList.remove("dark");
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "cyberMidnightPro");
    document.documentElement.setAttribute("data-theme-mode", "dark");
    document.documentElement.classList.remove("dark");
  }
})();
