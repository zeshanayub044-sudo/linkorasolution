// Interaction layer; the small HTML bootstrap applies the saved theme before styles.
(function () {
  "use strict";
  var root = document.documentElement,
    key = "linkora-theme";
  function apply(value) {
    var light = value === "light";
    root.dataset.theme = light ? "light" : "dark";
    root.style.colorScheme = light ? "light" : "dark";
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = light ? "#f4f7fb" : "#0a0e14";
    var button = document.querySelector("[data-theme-toggle]");
    if (button) {
      button.setAttribute("aria-pressed", String(light));
      button.setAttribute(
        "aria-label",
        light ? "Switch to dark mode" : "Switch to light mode",
      );
      button.title = light ? "Switch to dark mode" : "Switch to light mode";
    }
  }
  var preference;
  try {
    preference = localStorage.getItem(key);
  } catch (_) {
    /* Storage is optional. */
  }
  apply(preference);
  addEventListener("storage", function (event) {
    if (event.key === key || event.key === null)
      apply(event.key === key ? event.newValue : "dark");
  });
  document.addEventListener("DOMContentLoaded", function () {
    var header = document.querySelector(".site-header .nav");
    if (!header || header.querySelector("[data-theme-toggle]")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.dataset.themeToggle = "";
    button.innerHTML =
      '<svg class="theme-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg class="theme-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.3A8.5 8.5 0 0 1 8.7 4 8.5 8.5 0 1 0 20 15.3Z"/></svg>';
    var actions = header.querySelector(".header-actions");
    if (actions) actions.appendChild(button);
    else header.insertBefore(button, header.querySelector(".nav-toggle"));
    button.addEventListener("click", function () {
      var value = root.dataset.theme === "light" ? "dark" : "light";
      apply(value);
      try {
        localStorage.setItem(key, value);
      } catch (_) {
        /* In-memory switching still works. */
      }
    });
    apply(root.dataset.theme);
  });
})();
