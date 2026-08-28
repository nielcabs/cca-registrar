(function () {
  const modal = document.getElementById("notif-modal");
  const dataEl = document.getElementById("notifications-data");
  if (!modal || !dataEl) return;

  let notifications = [];
  try {
    notifications = JSON.parse(dataEl.textContent || "[]");
  } catch (_e) {
    return;
  }

  const byId = new Map(notifications.map((n) => [String(n.id), n]));
  const titleEl = document.getElementById("notif-modal-title");
  const timeEl = document.getElementById("notif-modal-time");
  const bodyEl = document.getElementById("notif-modal-body");
  const statusEl = document.getElementById("notif-modal-status");
  const linkEl = document.getElementById("notif-modal-link");

  function updateUnreadCounts() {
    const unread = document.querySelectorAll(".notif-page-item.is-unread").length;

    document.querySelectorAll(".sidebar .pill").forEach((pill) => {
      if (unread <= 0) pill.remove();
      else pill.textContent = String(unread);
    });

    const bellBadge = document.querySelector(".notif-badge");
    if (bellBadge) {
      if (unread <= 0) {
        bellBadge.hidden = true;
        bellBadge.textContent = "0";
      } else {
        bellBadge.hidden = false;
        bellBadge.textContent = unread > 99 ? "99+" : String(unread);
      }
    }
  }

  async function markRead(id) {
    const row = document.querySelector(`.notif-page-item[data-id="${id}"]`);
    if (!row || !row.classList.contains("is-unread")) return;

    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) return;

      row.classList.remove("is-unread");
      row.classList.add("is-read");

      const badge = row.querySelector(".badge");
      if (badge) {
        badge.className = "badge badge-default";
        badge.textContent = "Read";
      }

      const item = byId.get(String(id));
      if (item) item.isRead = true;

      updateUnreadCounts();
    } catch (_e) {
      /* ignore */
    }
  }

  function openModal(id) {
    const item = byId.get(String(id));
    if (!item) return;

    titleEl.textContent = item.title || "Notification";
    timeEl.textContent = item.createdAt
      ? new Date(item.createdAt).toLocaleString()
      : "";
    bodyEl.textContent = item.message || "";

    if (item.isRead) {
      statusEl.className = "badge badge-default";
      statusEl.textContent = "Read";
    } else {
      statusEl.className = "badge badge-verify";
      statusEl.textContent = "New";
    }

    if (item.link) {
      linkEl.href = item.link;
      linkEl.hidden = false;
    } else {
      linkEl.hidden = true;
      linkEl.removeAttribute("href");
    }

    modal.hidden = false;
    document.body.classList.add("notif-modal-open");
    markRead(id);

    const closeBtn = modal.querySelector(".notif-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("notif-modal-open");
  }

  document.querySelectorAll(".notif-page-open").forEach((btn) => {
    btn.addEventListener("click", () => openModal(btn.dataset.id));
  });

  modal.querySelectorAll("[data-notif-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });
})();
