function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeStudentId(value) {
  return String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
}

function compareClearanceOcrToProfile(student, extracted) {
  const warnings = [];
  const ocrName = extracted?.studentName || "";
  const ocrId = extracted?.studentId || "";
  const profileName = student?.displayName || "";
  const profileId = student?.studentId || "";

  let nameMatch = null;
  if (ocrName && profileName) {
    const a = normalizeName(ocrName);
    const b = normalizeName(profileName);
    nameMatch = a === b || a.includes(b) || b.includes(a);
    if (!nameMatch) {
      warnings.push(`OCR name "${ocrName}" does not match profile name "${profileName}".`);
    }
  } else if (ocrName && !profileName) {
    warnings.push("Profile has no display name to compare with OCR.");
  }

  let idMatch = null;
  if (ocrId && profileId) {
    idMatch = normalizeStudentId(ocrId) === normalizeStudentId(profileId);
    if (!idMatch) {
      warnings.push(`OCR student ID "${ocrId}" does not match profile ID "${profileId}".`);
    }
  } else if (ocrId && !profileId) {
    warnings.push("Profile has no student ID to compare with OCR.");
  }

  return { nameMatch, idMatch, warnings };
}

module.exports = {
  compareClearanceOcrToProfile
};
