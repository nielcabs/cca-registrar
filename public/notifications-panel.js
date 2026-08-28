(function () {
  const wrap = document.querySelector(".notif-wrap");
  if (!wrap) return;

  const bell = wrap.querySelector(".notif-bell");
  const panel = wrap.querySelector(".notif-panel");
  const badge = wrap.querySelector(".notif-badge");
  const items = wrap.querySelectorAll(".notif-item");

  function setOpen(open) {
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function updateBadge() {
    if (!badge) return;
    const unread = wrap.querySelectorAll(".notif-item.is-unread").length;
    if (unread <= 0) {
      badge.hidden = true;
      badge.textContent = "0";
      return;
    }
    badge.hidden = false;
    badge.textContent = unread > 99 ? "99+" : String(unread);
  }

  async function markRead(id, item) {
    if (!item.classList.contains("is-unread")) return;
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) return;
      item.classList.remove("is-unread");
      updateBadge();
    } catch (_e) {
      /* ignore */
    }
  }

  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  items.forEach((item) => {
    const activate = async () => {
      const id = item.dataset.id;
      const wasExpanded = item.classList.contains("is-expanded");

      items.forEach((el) => el.classList.remove("is-expanded"));
      if (!wasExpanded) item.classList.add("is-expanded");

      await markRead(id, item);
    };

    item.addEventListener("click", activate);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  updateBadge();
})();
