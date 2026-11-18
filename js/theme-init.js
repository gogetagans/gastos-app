(function () {
  try {
    var saved = localStorage.getItem("gastos.theme");
    var mode = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = mode === "system" ? (dark ? "dark" : "light") : mode;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-theme-mode", mode);
  } catch (error) {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("data-theme-mode", "system");
  }
})();
