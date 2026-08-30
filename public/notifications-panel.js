(function () {
  const wrap = document.querySelector(".notif-wrap");
  if (!wrap) return;

  const bell = wrap.querySelector(".notif-bell");
  const panel = wrap.querySelector(".notif-panel");
  const badge = wrap.querySelector(".notif-badge");
  const items = wrap.querySelectorAll(".notif-item");
  const mobileMq = window.matchMedia("(max-width: 880px)");

  function isMobilePanel() {
    return mobileMq.matches;
  }

  function ensureBackdrop() {
    let backdrop = document.querySelector(".notif-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("button");
      backdrop.type = "button";
      backdrop.className = "notif-backdrop";
      backdrop.hidden = true;
      backdrop.setAttribute("aria-label", "Close notifications");
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", function () {
        setOpen(false);
      });
    }
    return backdrop;
  }

  function mountPanel() {
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
  }

  function restorePanel() {
    if (panel.parentElement !== wrap) {
      wrap.appendChild(panel);
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", open ? "true" : "false");

    if (isMobilePanel()) {
      const backdrop = ensureBackdrop();
      backdrop.hidden = !open;
      document.body.classList.toggle("notif-panel-open", open);
      if (open) mountPanel();
      else restorePanel();
      return;
    }

    const backdrop = document.querySelector(".notif-backdrop");
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("notif-panel-open");
    restorePanel();
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
      const res = await fetch("/api/notifications/" + id + "/read", { method: "POST" });
      if (!res.ok) return;
      item.classList.remove("is-unread");
      updateBadge();
    } catch (_e) {
      /* ignore */
    }
  }

  bell.addEventListener("click", function (e) {
    e.stopPropagation();
    setOpen(panel.hidden);
  });

  document.addEventListener("click", function (e) {
    if (isMobilePanel()) return;
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setOpen(false);
  });

  mobileMq.addEventListener("change", function () {
    setOpen(false);
  });

  items.forEach(function (item) {
    const activate = async function () {
      const id = item.dataset.id;
      const wasExpanded = item.classList.contains("is-expanded");

      items.forEach(function (el) {
        el.classList.remove("is-expanded");
      });
      if (!wasExpanded) item.classList.add("is-expanded");

      await markRead(id, item);
    };

    item.addEventListener("click", activate);
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });

  updateBadge();
})();
