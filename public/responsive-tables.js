(function () {
  function applyResponsiveTables() {
    const isMobile = window.matchMedia("(max-width: 880px)").matches;

    document.querySelectorAll(".table-wrap .data-table").forEach(function (table) {
      const headers = Array.from(table.querySelectorAll("thead th")).map(function (th) {
        return th.textContent.trim();
      });

      table.querySelectorAll("tbody tr").forEach(function (row) {
        row.querySelectorAll("td").forEach(function (cell, index) {
          if (cell.hasAttribute("colspan")) {
            cell.removeAttribute("data-label");
            return;
          }
          if (headers[index]) cell.setAttribute("data-label", headers[index]);
        });
      });

      table.classList.toggle("responsive-stack", isMobile);
    });
  }

  document.addEventListener("DOMContentLoaded", applyResponsiveTables);
  window.addEventListener("resize", applyResponsiveTables);
})();
