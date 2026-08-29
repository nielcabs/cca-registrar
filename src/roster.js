function normalizeStudentId(value) {
  return String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function namesRoughlyMatch(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function parseRosterCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  const studentIdCol = idx("student_id") >= 0 ? idx("student_id") : idx("student id");
  const nameCol = idx("display_name") >= 0 ? idx("display_name") : idx("name");
  if (studentIdCol < 0 || nameCol < 0) {
    throw new Error("CSV must include student_id and display_name columns.");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const studentId = cols[studentIdCol];
    const displayName = cols[nameCol];
    if (!studentId || !displayName) continue;

    rows.push({
      studentId,
      displayName,
      email: cols[idx("email")] || "",
      course: cols[idx("course")] || "",
      section: cols[idx("section")] || "",
      yearLevel: cols[idx("year_level")] >= 0 ? cols[idx("year_level")] : cols[idx("year level")] || "",
      semester: cols[idx("semester")] || "",
      studentCategory: cols[idx("student_category")] >= 0 ? cols[idx("student_category")] : cols[idx("category")] || "undergraduate",
      academicTerm: cols[idx("academic_term")] >= 0 ? cols[idx("academic_term")] : cols[idx("term")] || ""
    });
  }
  return rows;
}

function evaluateRosterMatch(student, rosterRow) {
  if (!rosterRow) {
    return { status: "not_found", autoVerify: false, warnings: ["Student ID not found on enrollment roster."] };
  }

  const idMatch =
    normalizeStudentId(student.studentId) === normalizeStudentId(rosterRow.studentId);
  if (!idMatch) {
    return { status: "mismatch", autoVerify: false, warnings: ["Student ID does not match roster row."] };
  }

  const warnings = [];
  if (!namesRoughlyMatch(student.displayName, rosterRow.displayName)) {
    warnings.push(
      `Registered name "${student.displayName}" differs from roster name "${rosterRow.displayName}".`
    );
  }
  if (student.email && rosterRow.email && student.email.toLowerCase() !== rosterRow.email.toLowerCase()) {
    warnings.push("Registered email differs from roster email.");
  }

  if (warnings.length) {
    return { status: "partial", autoVerify: false, warnings, rosterRow };
  }

  return { status: "full", autoVerify: true, warnings: [], rosterRow };
}

function rosterStatusLabel(status) {
  if (status === "full") return "Roster match";
  if (status === "partial") return "Partial roster match";
  if (status === "not_found") return "Not on roster";
  return "—";
}

function rosterStatusBadge(status) {
  if (status === "full") return "badge-released";
  if (status === "partial") return "badge-verify";
  if (status === "not_found") return "badge-rejected";
  return "badge-default";
}

module.exports = {
  normalizeStudentId,
  normalizeName,
  namesRoughlyMatch,
  parseRosterCsv,
  evaluateRosterMatch,
  rosterStatusLabel,
  rosterStatusBadge
};
