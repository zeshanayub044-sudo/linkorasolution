document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.querySelector(".nav-toggle"),
    links = document.querySelector("nav.links");
  if (!toggle || !links) return;
  var mobile = matchMedia("(max-width:1120px)");
  function update(open) {
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    links.inert = mobile.matches && !open;
  }
  toggle.addEventListener("click", function () {
    update(!links.classList.contains("open"));
  });
  links.addEventListener("click", function (e) {
    if (e.target.closest("a")) update(false);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && links.classList.contains("open")) {
      update(false);
      toggle.focus();
    }
  });
  mobile.addEventListener("change", function () {
    update(false);
  });
  update(false);
});
