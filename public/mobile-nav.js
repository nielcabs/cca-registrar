(function () {
  const toggle = document.querySelector(".mobile-nav-toggle");
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.querySelector(".sidebar-backdrop");
  if (!toggle || !sidebar) return;

  const mq = window.matchMedia("(max-width: 880px)");

  function setOpen(open) {
    if (!mq.matches) {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute("aria-hidden", "true");
      }
      document.body.style.overflow = "";
      return;
    }

    document.body.classList.toggle("nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }
    document.body.style.overflow = open ? "hidden" : "";
  }

  toggle.addEventListener("click", function () {
    setOpen(!document.body.classList.contains("nav-open"));
  });

  if (backdrop) {
    backdrop.addEventListener("click", function () {
      setOpen(false);
    });
  }

  sidebar.querySelectorAll(".menu a").forEach(function (link) {
    link.addEventListener("click", function () {
      setOpen(false);
    });
  });

  mq.addEventListener("change", function () {
    setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setOpen(false);
  });
})();
