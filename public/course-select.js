(function () {
  function initCoursePicker(root) {
    const dataEl = root.querySelector(".course-picker-data");
    const instituteSelect = root.querySelector(".course-picker-institute");
    const programSelect = root.querySelector(".course-picker-program");
    if (!dataEl || !instituteSelect || !programSelect) return;

    let groups = [];
    try {
      groups = JSON.parse(dataEl.textContent || "[]");
    } catch {
      groups = [];
    }

    const selected = (root.getAttribute("data-selected") || "").trim();
    const isRequired = root.getAttribute("data-required") === "1";

    function findGroupIndex(courseName) {
      if (!courseName) return -1;
      return groups.findIndex((group) =>
        (group.courses || []).some((course) => course === courseName)
      );
    }

    function fillPrograms(groupIndex, keepSelection) {
      const current = keepSelection ? programSelect.value : "";
      programSelect.innerHTML = '<option value="">Select program</option>';

      if (groupIndex === "" || groupIndex === null || groupIndex === undefined) {
        programSelect.disabled = true;
        programSelect.removeAttribute("required");
        return;
      }

      const group = groups[Number(groupIndex)];
      if (!group) {
        programSelect.disabled = true;
        return;
      }

      (group.courses || []).forEach((course) => {
        const option = document.createElement("option");
        option.value = course;
        option.textContent = course;
        if (current && current === course) option.selected = true;
        programSelect.appendChild(option);
      });

      programSelect.disabled = false;
      if (isRequired) programSelect.setAttribute("required", "required");
    }

    instituteSelect.addEventListener("change", function () {
      fillPrograms(instituteSelect.value, false);
    });

    const legacyIndex = findGroupIndex(selected);
    if (legacyIndex >= 0) {
      instituteSelect.value = String(legacyIndex);
      fillPrograms(legacyIndex, false);
      programSelect.value = selected;
    } else if (selected) {
      instituteSelect.value = "";
      programSelect.disabled = false;
      const legacyOption = document.createElement("option");
      legacyOption.value = selected;
      legacyOption.textContent = `${selected} (legacy)`;
      legacyOption.selected = true;
      programSelect.appendChild(legacyOption);
      if (isRequired) programSelect.setAttribute("required", "required");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".course-picker").forEach(initCoursePicker);
  });
})();
