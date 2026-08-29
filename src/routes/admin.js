const express = require("express");
const path = require("path");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcryptjs");
const dayjs = require("dayjs");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const {
  DEPARTMENTS,
  STUDENT_CATEGORIES,
  YEAR_LEVELS,
  SEMESTERS,
  CCA_COURSE_GROUPS,
  isValidCcaCourse,
  normalizeCcaCourse,
  listCourseFilterOptions,
  listSectionSuggestions,
  ROOT_DIR,
  listUsers,
  getUserById,
  getUserByEmail,
  getUserByStudentId,
  insertUser,
  syncTuitionScholarshipStatus,
  deleteUser,
  setUserVerified,
  updateUserAdmin,
  countUnverifiedStudents,
  listUnverifiedStudents,
  listRequests,
  getRequestById,
  updateRequest,
  countScheduleBookings,
  listClearancesForStudent,
  computeStudentClearanceSummary,
  listAudit,
  getDashboardStats,
  ensureClearanceRows,
  writeAudit,
  listStudentsClearanceOverview,
  countReleasedRequestsForStudent,
  listAnnouncements,
  createAnnouncement,
  listNotificationsForUser,
  markNotificationRead,
  countUnreadNotifications,
  getStudentClearanceUpload,
  updateStudentClearanceUpload,
  updateClearance,
  applyDetectedClearanceOffices,
  listDistinctSections,
  archiveRequest,
  unarchiveRequest,
  archiveOldRequests,
  upsertRosterRows,
  listRoster,
  countRoster,
  getRosterByStudentId
} = require("../db");
const {
  requireAuth,
  requireRole,
  requireWriteAccess,
  requireSystemAdmin,
  requireRegistrarOperations,
  isViewOnlyStaff,
  isSystemAdmin
} = require("../middleware");
const { runOcrOnFile, runClearanceOcrOnFile, parseOcrFields, parseClearanceOcrFields } = require("../ocr");
const { compareClearanceOcrToProfile } = require("../clearanceOcrHelpers");
const { parseRosterCsv, evaluateRosterMatch, rosterStatusLabel, rosterStatusBadge } = require("../roster");
const {
  computeStatusBadge,
  computeClearanceBadge,
  generateUpcomingSlots,
  SLOT_CAPACITY,
  formatDate,
  buildSlotAvailability,
  categoryLabel
} = require("../helpers");
const { notifyAllUsers, notifyStudentByStudentId, notifyUser } = require("../notify");
const { clearanceRowStatuses } = require("../terminology");
const { isClearanceComplete } = require("../terminology");

const router = express.Router();

const rosterCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv");
    cb(ok ? null : new Error("Upload a .csv roster file."), ok);
  }
});

async function usersWithRosterStatus(users) {
  return Promise.all(
    users.map(async (u) => {
      if (u.role !== "student" || u.isVerified) {
        return { ...u, rosterStatus: null, rosterWarnings: [] };
      }
      const rosterRow = await getRosterByStudentId(u.studentId);
      const check = evaluateRosterMatch(u, rosterRow);
      return {
        ...u,
        rosterStatus: check.status,
        rosterWarnings: check.warnings,
        rosterStatusLabel: rosterStatusLabel(check.status),
        rosterStatusBadge: rosterStatusBadge(check.status)
      };
    })
  );
}

function requireRegistrarOnly(req, res, next) {
  if (isViewOnlyStaff(req.session.user?.role)) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "View only",
      message: "VPAA accounts cannot access user or announcement management."
    });
    return;
  }
  next();
}

function queueFilters(req) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statusGroup =
    req.query.view === "completed"
      ? "completed"
      : req.query.view === "archived"
        ? "archived"
        : req.query.view === "all"
          ? "all"
          : "active";
  const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
  const section = typeof req.query.section === "string" ? req.query.section.trim() : "";
  return { q, statusGroup, course, section };
}

function usersPageSearch(req) {
  if (req.method === "POST" && Object.prototype.hasOwnProperty.call(req.body || {}, "redirectSearch")) {
    return String(req.body.redirectSearch || "").trim();
  }
  if (typeof req.query.q === "string") return req.query.q.trim();
  return "";
}

router.use(requireAuth, requireRole("registrar", "vpaa", "sysadmin"));

router.get("/notifications", async (req, res) => {
  const notifications = await listNotificationsForUser(req.session.user.id, 40);
  const unreadNotificationsCount = await countUnreadNotifications(req.session.user.id);
  res.render("notifications", {
    user: req.session.user,
    notifications,
    basePath: "/admin",
    unreadNotificationsCount,
    message: null
  });
});

router.post("/notifications/:id/read", async (req, res) => {
  await markNotificationRead(req.session.user.id, Number(req.params.id));
  res.redirect("/admin/notifications");
});

router.get("/announcements", requireRegistrarOnly, requireRegistrarOperations, async (req, res) => {
  const announcements = await listAnnouncements(50);
  const unreadNotificationsCount = await countUnreadNotifications(req.session.user.id);
  res.render("admin-announcements", {
    user: req.session.user,
    announcements,
    unreadNotificationsCount,
    error: null,
    success: null
  });
});

router.post("/announcements", requireRegistrarOnly, requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  const unreadNotificationsCount = await countUnreadNotifications(req.session.user.id);
  if (!title || !message) {
    const announcements = await listAnnouncements(50);
    res.render("admin-announcements", {
      user: req.session.user,
      announcements,
      unreadNotificationsCount,
      error: "Title and message are required.",
      success: null
    });
    return;
  }

  await createAnnouncement({ title, message, createdBy: req.session.user.email });
  await notifyAllUsers({
    title: `Announcement: ${title}`,
    message,
    link: null,
    excludeUserId: req.session.user.id
  });
  await writeAudit(req.session.user.email, "create_announcement", `title=${title}`);

  const announcements = await listAnnouncements(50);
  res.render("admin-announcements", {
    user: req.session.user,
    announcements,
    unreadNotificationsCount,
    error: null,
    success: "Announcement posted. In-app, email, and SMS alerts were sent based on each user’s preferences."
  });
});

router.get("/dashboard", async (req, res) => {
  if (isSystemAdmin(req.session.user.role)) {
    res.redirect("/admin/users");
    return;
  }
  const stats = await getDashboardStats();
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pool = await listRequests({ search: q });
  const recent = pool.slice(0, 20).map((r) => ({
    ...r,
    statusClass: computeStatusBadge(r.status)
  }));
  const ocrProcessedCount = pool.filter(
    (r) => r.ocr?.state === "processed" || r.ocr?.state === "corrected"
  ).length;

  res.render("admin-dashboard", {
    user: req.session.user,
    stats,
    recent,
    searchQuery: q,
    ocrProcessedCount,
    active: "dashboard"
  });
});

router.get("/requests", requireRegistrarOperations, async (req, res) => {
  const { q, statusGroup, course, section } = queueFilters(req);
  const sorted = (
    await listRequests({ search: q, statusGroup, course, section })
  ).map((item) => ({
    ...item,
    statusClass: computeStatusBadge(item.status)
  }));

  const courses = await listCourseFilterOptions();
  const sections = await listDistinctSections();

  res.render("admin-queue", {
    user: req.session.user,
    requests: sorted,
    searchQuery: q,
    statusGroup,
    courseFilter: course,
    sectionFilter: section,
    courses,
    sections,
    readOnly: isViewOnlyStaff(req.session.user.role),
    active: "requests"
  });
});

async function loadSlotAvailability() {
  return buildSlotAvailability(countScheduleBookings);
}

router.get("/request/:id", requireRegistrarOperations, async (req, res) => {
  const found = await getRequestById(req.params.id);
  if (!found) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const clearances = await listClearancesForStudent(found.studentId);
  const summary = await computeStudentClearanceSummary(found.studentId);
  const slots = await loadSlotAvailability();
  const releasedCount = await countReleasedRequestsForStudent(found.studentId);
  const returningNote =
    releasedCount > 0 && isClearanceComplete(summary)
      ? "This student has prior released documents and current department clearances are complete — eligible for scheduling."
      : releasedCount > 0
        ? `Prior completed releases: ${releasedCount}. Current clearance: ${summary}.`
        : null;

  res.render("admin-process-request", {
    user: req.session.user,
    request: found,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    clearanceSummary: summary,
    clearanceSummaryBadge: computeClearanceBadge(summary),
    slots,
    message: null,
    error: null,
    dayjs,
    returningNote,
    readOnly: isViewOnlyStaff(req.session.user.role)
  });
});

router.post("/request/:id/run-ocr", requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const current = await getRequestById(req.params.id);
  if (!current) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const localFilePath = path.join(ROOT_DIR, current.uploadedFilePath.replace(/^\/+/, ""));

  if (!current.uploadedFilePath) {
    const clearances = await listClearancesForStudent(current.studentId);
    const summary = await computeStudentClearanceSummary(current.studentId);
    const slots = await loadSlotAvailability();
    res.render("admin-process-request", {
      user: req.session.user,
      request: current,
      clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
      clearanceSummary: summary,
      clearanceSummaryBadge: computeClearanceBadge(summary),
      slots,
      message: null,
      error: "No payment receipt was uploaded for this request.",
      dayjs,
      returningNote: null,
      readOnly: isViewOnlyStaff(req.session.user.role)
    });
    return;
  }

  try {
    const { rawText, confidence } = await runOcrOnFile(localFilePath);
    const extracted = parseOcrFields(rawText);

    current.ocr = {
      state: "processed",
      confidence,
      rawText: rawText.slice(0, 4000),
      extracted
    };
    current.status = current.status === "Submitted" ? "For Verification" : current.status;
    current.updatedAt = new Date().toISOString();
    await updateRequest(current);
    await writeAudit(req.session.user.email, "run_ocr", `id=${current.id}`);

    const clearances = await listClearancesForStudent(current.studentId);
    const summary = await computeStudentClearanceSummary(current.studentId);
    const slots = await loadSlotAvailability();
    const releasedCount = await countReleasedRequestsForStudent(current.studentId);
    const returningNote =
      releasedCount > 0 && isClearanceComplete(summary)
        ? "This student has prior released documents and current department clearances are complete — eligible for scheduling."
        : releasedCount > 0
          ? `Prior completed releases: ${releasedCount}. Current clearance: ${summary}.`
          : null;

    res.render("admin-process-request", {
      user: req.session.user,
      request: current,
      clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
      clearanceSummary: summary,
      clearanceSummaryBadge: computeClearanceBadge(summary),
      slots,
      message: "OCR completed. Review extracted values before saving.",
      error: null,
      dayjs,
      returningNote,
      readOnly: isViewOnlyStaff(req.session.user.role)
    });
  } catch (error) {
    current.ocr = { ...current.ocr, state: "failed" };
    current.updatedAt = new Date().toISOString();
    await updateRequest(current);

    const clearances = await listClearancesForStudent(current.studentId);
    const summary = await computeStudentClearanceSummary(current.studentId);
    const slots = await loadSlotAvailability();
    const releasedCount = await countReleasedRequestsForStudent(current.studentId);
    const returningNote =
      releasedCount > 0
        ? `Prior completed releases: ${releasedCount}. Current clearance: ${summary}.`
        : null;

    res.render("admin-process-request", {
      user: req.session.user,
      request: current,
      clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
      clearanceSummary: summary,
      clearanceSummaryBadge: computeClearanceBadge(summary),
      slots,
      message: null,
      error: `OCR failed: ${error.message}`,
      dayjs,
      returningNote,
      readOnly: isViewOnlyStaff(req.session.user.role)
    });
  }
});

router.post("/request/:id/update", requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const current = await getRequestById(req.params.id);
  if (!current) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const {
    status,
    registrarRemarks,
    scheduleDate,
    scheduleTime,
    extractedStudentName,
    extractedStudentId,
    extractedOrNumber,
    extractedAmount,
    extractedPaymentDate
  } = req.body;

  let error = null;

  const liveClearance = await computeStudentClearanceSummary(current.studentId);

  if (status === "Scheduled" || status === "Released") {
    if (!isClearanceComplete(liveClearance)) {
      error = `Cannot mark request as ${status} because student clearance is "${liveClearance}".`;
    }
  }

  if (!error && scheduleDate && scheduleTime) {
    const isSameSlot =
      current.schedule?.date === scheduleDate && current.schedule?.time === scheduleTime;
    if (!isSameSlot) {
      const booked = await countScheduleBookings(scheduleDate, scheduleTime);
      if (booked >= SLOT_CAPACITY) {
        error = `Selected slot (${scheduleDate} ${scheduleTime}) is fully booked.`;
      }
    }
  }

  const prevStatus = current.status;
  const prevSchedule = current.schedule
    ? `${current.schedule.date} ${current.schedule.time}`
    : null;

  if (!error) {
    current.status = status || current.status;
    current.clearanceStatus = liveClearance;
    current.registrarRemarks = registrarRemarks || "";

    if (scheduleDate && scheduleTime) {
      current.schedule = { date: scheduleDate, time: scheduleTime };
    } else {
      current.schedule = null;
    }

    current.ocr = {
      ...(current.ocr || {}),
      state: current.ocr?.state === "not_run" ? "not_run" : "corrected",
      extracted: {
        studentName: extractedStudentName || "",
        studentId: extractedStudentId || "",
        orNumber: extractedOrNumber || "",
        amount: extractedAmount || "",
        paymentDate: extractedPaymentDate || ""
      }
    };

    current.updatedAt = new Date().toISOString();
    await updateRequest(current);
    await writeAudit(
      req.session.user.email,
      "update_request",
      `id=${current.id} status=${current.status}`
    );

    const statusChanged = current.status !== prevStatus;
    const scheduleChanged =
      (current.schedule ? `${current.schedule.date} ${current.schedule.time}` : null) !== prevSchedule;

    if (statusChanged || scheduleChanged) {
      let msg = `Your ${current.documentType} request (${current.id}) is now ${current.status}.`;
      if (current.schedule) {
        msg += ` Release appointment: ${current.schedule.date} at ${current.schedule.time}.`;
      }
      if (current.registrarRemarks) {
        msg += ` Remarks: ${current.registrarRemarks}`;
      }
      await notifyStudentByStudentId(current.studentId, {
        title: statusChanged ? `Request ${current.status}` : "Release schedule updated",
        message: msg,
        link: `/student/track/${current.id}`
      });
    }
  }

  const clearances = await listClearancesForStudent(current.studentId);
  const summary = await computeStudentClearanceSummary(current.studentId);
  const slots = await loadSlotAvailability();
  const releasedCount = await countReleasedRequestsForStudent(current.studentId);
  const returningNote =
    releasedCount > 0 && isClearanceComplete(summary)
      ? "This student has prior released documents and current department clearances are complete — eligible for scheduling."
      : releasedCount > 0
        ? `Prior completed releases: ${releasedCount}. Current clearance: ${summary}.`
        : null;

  res.render("admin-process-request", {
    user: req.session.user,
    request: current,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    clearanceSummary: summary,
    clearanceSummaryBadge: computeClearanceBadge(summary),
    slots,
    message: error ? null : "Request updated successfully.",
    error,
    dayjs,
    returningNote,
    readOnly: isViewOnlyStaff(req.session.user.role)
  });
});

router.get("/clearance/:studentId", requireRegistrarOperations, async (req, res) => {
  const clearances = await listClearancesForStudent(req.params.studentId);
  const summary = await computeStudentClearanceSummary(req.params.studentId);
  const releasedCount = await countReleasedRequestsForStudent(req.params.studentId);
  const clearanceUpload = await getStudentClearanceUpload(req.params.studentId);
  const student = await getUserByStudentId(req.params.studentId);
  const ocrCompare =
    clearanceUpload?.ocr?.state === "processed" && clearanceUpload.ocr.extracted
      ? compareClearanceOcrToProfile(student, clearanceUpload.ocr.extracted)
      : { nameMatch: null, idMatch: null, warnings: [] };
  const detectedOffices = clearanceUpload?.ocr?.extracted?.detectedOffices || [];
  const queryError =
    req.query.error === "no_photo"
      ? "No clearance form uploaded to run OCR on."
      : req.query.error === "no_ocr_offices"
        ? "No offices were detected in the last OCR run."
        : null;
  res.render("admin-student-clearance", {
    user: req.session.user,
    studentId: req.params.studentId,
    student,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    summary,
    summaryBadge: computeClearanceBadge(summary),
    releasedCount,
    clearanceUpload,
    ocrCompare,
    detectedOffices,
    departments: DEPARTMENTS,
    message: req.query.ocr
      ? "Clearance OCR completed."
      : req.query.saved
        ? "Registrar clearance saved."
        : req.query.applied
          ? "Detected offices marked as Signed from OCR."
          : null,
    error: queryError,
    readOnly: isViewOnlyStaff(req.session.user.role)
  });
});

router.post("/clearance/:studentId/run-ocr", requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const studentId = req.params.studentId;
  const clearanceUpload = await getStudentClearanceUpload(studentId);

  if (!clearanceUpload?.photoPath) {
    res.redirect(`/admin/clearance/${studentId}?error=no_photo`);
    return;
  }

  const localFilePath = path.join(ROOT_DIR, clearanceUpload.photoPath.replace(/^\/+/, ""));
  let ocr = { state: "failed", confidence: null, rawText: "", extracted: {} };

  try {
    const { rawText, confidence, extracted } = await runClearanceOcrOnFile(localFilePath);
    ocr = {
      state: "processed",
      confidence,
      rawText: rawText.slice(0, 4000),
      extracted
    };
  } catch {
    ocr = { state: "failed", confidence: null, rawText: "", extracted: {} };
  }

  await updateStudentClearanceUpload(studentId, {
    photoPath: clearanceUpload.photoPath,
    photoName: clearanceUpload.photoName,
    ocr
  });
  await writeAudit(req.session.user.email, "run_clearance_ocr", `student=${studentId}`);

  res.redirect(`/admin/clearance/${studentId}?ocr=1`);
});

router.post("/clearance/:studentId/apply-ocr", requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const studentId = req.params.studentId;
  const clearanceUpload = await getStudentClearanceUpload(studentId);
  const detected = clearanceUpload?.ocr?.extracted?.detectedOffices || [];

  if (!detected.length) {
    res.redirect(`/admin/clearance/${studentId}?error=no_ocr_offices`);
    return;
  }

  const applied = await applyDetectedClearanceOffices(
    studentId,
    detected,
    req.session.user.email
  );
  await writeAudit(
    req.session.user.email,
    "apply_clearance_ocr",
    `student=${studentId} offices=${applied.join(",")}`
  );

  const student = await getUserByStudentId(studentId);
  if (student) {
    await notifyUser(student.id, {
      title: "Clearance updated from form OCR",
      message: `Registrar applied OCR-detected offices to your clearance record (${applied.length} office(s)). Department officers may still confirm.`,
      link: "/student/clearance"
    });
  }

  res.redirect(`/admin/clearance/${studentId}?applied=1`);
});

router.post("/clearance/:studentId/registrar", requireRegistrarOperations, requireWriteAccess, async (req, res) => {
  const studentId = req.params.studentId;
  const { status, remarks } = req.body;

  if (!clearanceRowStatuses().includes(status)) {
    res.redirect(`/admin/clearance/${studentId}?error=invalid_status`);
    return;
  }

  await updateClearance({
    studentId,
    departmentCode: "registrar",
    status,
    remarks: remarks || "",
    updatedBy: req.session.user.email
  });

  await writeAudit(
    req.session.user.email,
    "update_registrar_clearance",
    `student=${studentId} status=${status}`
  );

  await notifyStudentByStudentId(studentId, {
    title: "Registrar clearance updated",
    message: `Office of the Registrar marked your clearance as "${status}".${remarks ? ` ${remarks}` : ""}`,
    link: "/student/clearance"
  });

  res.redirect(`/admin/clearance/${studentId}?saved=1`);
});

router.get("/clearances", requireRegistrarOperations, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
  const section = typeof req.query.section === "string" ? req.query.section.trim() : "";
  const rows = await listStudentsClearanceOverview({ search: q, course, section });
  const courses = await listCourseFilterOptions();
  const sections = await listDistinctSections();
  res.render("admin-clearances", {
    user: req.session.user,
    rows: rows.map((r) => ({
      ...r,
      summaryBadge: computeClearanceBadge(r.clearanceSummary),
      categoryLabel: categoryLabel(r.studentCategory)
    })),
    searchQuery: q,
    courseFilter: course,
    sectionFilter: section,
    courses,
    sections,
    departments: DEPARTMENTS,
    readOnly: isViewOnlyStaff(req.session.user.role),
    active: "clearances"
  });
});

router.get("/users", requireSystemAdmin, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const course = typeof req.query.course === "string" ? req.query.course.trim() : "";
  const section = typeof req.query.section === "string" ? req.query.section.trim() : "";
  const filter = req.query.filter === "pending" ? "pending" : "all";
  let users =
    filter === "pending"
      ? await listUnverifiedStudents()
      : await listUsers({ search: q, course, section });
  if (filter === "pending" && q) {
    const needle = q.toLowerCase();
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) ||
        u.displayName.toLowerCase().includes(needle) ||
        (u.studentId || "").toLowerCase().includes(needle)
    );
  }
  if (filter === "pending" && (course || section)) {
    users = users.filter((u) => {
      if (course && (u.course || "").toLowerCase() !== course.toLowerCase()) return false;
      if (section && (u.section || "").toLowerCase() !== section.toLowerCase()) return false;
      return true;
    });
  }
  const pendingCount = await countUnverifiedStudents();
  const courses = await listCourseFilterOptions();
  const sections = await listDistinctSections();
  const usersWithRoster = await usersWithRosterStatus(users);
  res.render("admin-users", {
    user: req.session.user,
    users: usersWithRoster,
    departments: DEPARTMENTS,
    searchQuery: q,
    courseFilter: course,
    sectionFilter: section,
    courses,
    sections,
    filter,
    pendingCount,
    error: null,
    success: req.query.verified ? "Student account verified successfully." : null,
    active: "users",
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
  });
});

router.get("/users/:id/edit", requireSystemAdmin, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "User not found."
    });
    return;
  }
  res.render("admin-edit-user", {
    user: req.session.user,
    target,
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS,
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions(),
    error: null,
    success: null,
    active: "users"
  });
});

router.post("/users/:id/edit", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "User not found."
    });
    return;
  }

  const displayName = String(req.body.displayName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const course = String(req.body.course || "").trim();
  const section = String(req.body.section || "").trim();
  const yearLevel = String(req.body.yearLevel || "").trim();
  const semester = String(req.body.semester || "").trim();
  const phone = String(req.body.phone || "").trim();
  const studentCategory = req.body.studentCategory || target.studentCategory;
  const hasScholarship = req.body.hasScholarship === "1";
  const isVerified = req.body.isVerified === "1";
  const studentForm = {
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions()
  };

  if (!displayName || !email) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Name and email are required.",
      success: null,
      active: "users"
    });
    return;
  }

  if (target.role === "student" && !isSchoolEmail(email)) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Student accounts must use a @cca.edu.ph email address.",
      success: null,
      active: "users"
    });
    return;
  }

  const dup = await getUserByEmail(email);
  if (dup && dup.id !== target.id) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Another account already uses this email.",
      success: null,
      active: "users"
    });
    return;
  }

  if (target.role === "student" && course && !isValidCcaCourse(course)) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Select a valid institute / program from the list.",
      success: null,
      active: "users"
    });
    return;
  }

  if (target.role === "student" && yearLevel && !YEAR_LEVELS.includes(yearLevel)) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Select a valid year level.",
      success: null,
      active: "users"
    });
    return;
  }

  if (target.role === "student" && semester && !SEMESTERS.includes(semester)) {
    res.render("admin-edit-user", {
      user: req.session.user,
      target,
      categories: STUDENT_CATEGORIES,
      courseGroups: CCA_COURSE_GROUPS,
      ...studentForm,
      error: "Select a valid semester.",
      success: null,
      active: "users"
    });
    return;
  }

  const wasVerified = target.isVerified;
  await updateUserAdmin(target.id, {
    displayName,
    email,
    studentCategory,
    course: target.role === "student" ? normalizeCcaCourse(course) : course,
    section,
    yearLevel,
    semester,
    hasScholarship,
    isVerified,
    phone
  });

  if (target.role === "student" && !wasVerified && isVerified) {
    await notifyUser(target.id, {
      title: "Enrollment verified",
      message:
        "The registrar has verified your enrollment. You can now submit document requests and book release appointments.",
      link: "/student/dashboard"
    });
  }

  if (target.role === "student" && hasScholarship !== target.hasScholarship) {
    await syncTuitionScholarshipStatus(
      target.studentId,
      hasScholarship,
      req.session.user.email
    );
  }

  await writeAudit(req.session.user.email, "edit_user", `id=${target.id} verified=${isVerified ? 1 : 0}`);
  res.redirect("/admin/users?verified=1");
});

router.post("/users/:id/verify", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  const target = await getUserById(req.params.id);
  const listQ = usersPageSearch(req);
  if (!target || target.role !== "student") {
    res.redirect("/admin/users" + (listQ ? `?q=${encodeURIComponent(listQ)}` : ""));
    return;
  }
  await setUserVerified(target.id, true);
  await notifyUser(target.id, {
    title: "Enrollment verified",
    message:
      "The registrar has verified your enrollment. You can now submit document requests and book release appointments.",
    link: "/student/dashboard"
  });
  await writeAudit(req.session.user.email, "verify_student", `email=${target.email}`);
  res.redirect("/admin/users?verified=1" + (listQ ? `&q=${encodeURIComponent(listQ)}` : ""));
});

router.post("/users/:id/unverify", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  const target = await getUserById(req.params.id);
  const listQ = usersPageSearch(req);
  if (!target || target.role !== "student") {
    res.redirect("/admin/users" + (listQ ? `?q=${encodeURIComponent(listQ)}` : ""));
    return;
  }
  await setUserVerified(target.id, false);
  await writeAudit(req.session.user.email, "unverify_student", `email=${target.email}`);
  res.redirect("/admin/users" + (listQ ? `?q=${encodeURIComponent(listQ)}` : ""));
});

function isSchoolEmail(email) {
  const domain = (process.env.SCHOOL_EMAIL_DOMAIN || "cca.edu.ph").toLowerCase();
  return String(email || "")
    .trim()
    .toLowerCase()
    .endsWith(`@${domain}`);
}

router.post("/users/create", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  let {
    email,
    password,
    role,
    displayName,
    studentId,
    departmentCode,
    studentCategory,
    course,
    section,
    hasScholarship
  } = req.body;
  if (role === "admin" || role === "registrar") role = "registrar";
  const listQ = usersPageSearch(req);
  const users = await listUsers({ search: listQ });

  if (!email || !password || !role || !displayName) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Email, password, role, and name are required.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }
  if (password.length < 6) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Password must be at least 6 characters.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }

  const allowedRoles = ["student", "department", "registrar", "vpaa", "sysadmin"];
  if (!allowedRoles.includes(role)) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Invalid account role.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }

  if (role === "student" && !isSchoolEmail(email)) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Student accounts must use a @cca.edu.ph email address.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }

  const dupEmail = await getUserByEmail(email);
  if (dupEmail) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Email already in use.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }

  if (role === "student") {
    if (!studentId) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        searchQuery: listQ,
        error: "Student ID is required for student accounts.",
        success: null,
        active: "users",
        categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
      });
      return;
    }
    if (!studentCategory || !STUDENT_CATEGORIES.some((c) => c.value === studentCategory)) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        searchQuery: listQ,
        error: "Student category is required.",
        success: null,
        active: "users",
        categories: STUDENT_CATEGORIES,
        courseGroups: CCA_COURSE_GROUPS
      });
      return;
    }
    if (!isValidCcaCourse(course)) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        searchQuery: listQ,
        error: "Select a valid institute / program from the list.",
        success: null,
        active: "users",
        categories: STUDENT_CATEGORIES,
        courseGroups: CCA_COURSE_GROUPS
      });
      return;
    }
    const dupSid = await getUserByStudentId(studentId);
    if (dupSid) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        searchQuery: listQ,
        error: "Student ID already registered.",
        success: null,
        active: "users"
      });
      return;
    }
  }
  if (role === "department" && !departmentCode) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      searchQuery: listQ,
      error: "Department is required for department officers.",
      success: null,
      active: "users",
      categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
    });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  let isVerified = role !== "student";
  if (role === "student") {
    const rosterRow = await getRosterByStudentId(studentId.trim());
    const rosterCheck = evaluateRosterMatch(
      {
        displayName: displayName.trim(),
        studentId: studentId.trim(),
        email: email.trim().toLowerCase()
      },
      rosterRow
    );
    isVerified = rosterCheck.autoVerify;
  }

  const newUser = {
    id: uuidv4(),
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    role,
    displayName: displayName.trim(),
    studentId: role === "student" ? studentId.trim() : null,
    departmentCode: role === "department" ? departmentCode : null,
    studentCategory: role === "student" ? studentCategory : "undergraduate",
    course: role === "student" ? normalizeCcaCourse(course) : "",
    section: role === "student" ? (section || "").trim() : "",
    hasScholarship: role === "student" && hasScholarship === "1",
    isVerified,
    createdAt: new Date().toISOString()
  };
  await insertUser(newUser);
  if (role === "student") {
    await ensureClearanceRows(newUser.studentId, studentCategory);
    if (newUser.hasScholarship) {
      await syncTuitionScholarshipStatus(
        newUser.studentId,
        true,
        req.session.user.email
      );
    }
    if (isVerified) {
      await writeAudit(
        req.session.user.email,
        "create_user_auto_verified",
        `studentId=${newUser.studentId} roster=full`
      );
    }
  }
  await writeAudit(req.session.user.email, "create_user", `email=${newUser.email} role=${role}`);

  const freshUsers = await listUsers({ search: listQ });
  res.render("admin-users", {
    user: req.session.user,
    users: freshUsers,
    departments: DEPARTMENTS,
    searchQuery: listQ,
    error: null,
    success: `Account created for ${newUser.email}.`,
    active: "users",
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS
  });
});

router.post("/users/:id/delete", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  const listQ = usersPageSearch(req);
  const target = await getUserById(req.params.id);
  if (target && target.email === req.session.user.email) {
    res.status(400).send("You cannot delete your own account while logged in.");
    return;
  }
  if (target) {
    await deleteUser(target.id);
    await writeAudit(req.session.user.email, "delete_user", `email=${target.email}`);
  }
  res.redirect("/admin/users" + (listQ ? `?q=${encodeURIComponent(listQ)}` : ""));
});

router.get("/reports", async (req, res) => {
  const stats = await getDashboardStats();
  const audit = await listAudit(30);
  res.render("admin-reports", {
    user: req.session.user,
    stats,
    readOnly: isViewOnlyStaff(req.session.user.role),
    audit: audit.map((a) => ({ ...a, at_formatted: formatDate(a.at) }))
  });
});

router.get("/reports/export.pdf", requireWriteAccess, async (req, res) => {
  const stats = await getDashboardStats();
  const audit = await listAudit(40);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="CCA-Registrar-Report-${dayjs().format("YYYY-MM-DD")}.pdf"`
  );

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(18).fillColor("#166534").text("City College of Angeles", { align: "center" });
  doc.fontSize(14).fillColor("#14532d").text("Registrar Office — Transaction Report", { align: "center" });
  doc.moveDown();
  doc.fontSize(10).fillColor("#000000").text(`Generated: ${dayjs().format("MMMM D, YYYY h:mm A")}`, { align: "center" });
  doc.moveDown(2);

  doc.fontSize(12).text("Summary counts", { underline: true });
  doc.fontSize(10);
  doc.text(`Total document requests: ${stats.totalRequests}`);
  doc.text(`Released: ${stats.released}  |  Scheduled: ${stats.scheduled}  |  For verification: ${stats.forVerification}`);
  doc.text(`Submitted: ${stats.submitted}  |  Rejected: ${stats.rejected}`);
  doc.text(`Registered students: ${stats.totalStudents}`);
  doc.moveDown();

  doc.fontSize(12).text("Requests by document type", { underline: true });
  doc.fontSize(10);
  if (!stats.byDocType.length) doc.text("(No data)");
  else stats.byDocType.forEach((d) => doc.text(`  • ${d.documentType}: ${d.count}`));
  doc.moveDown();

  doc.fontSize(12).text("Recent audit log (latest 40)", { underline: true });
  doc.fontSize(8);
  audit.forEach((a) => {
    doc.text(`${formatDate(a.at)}  |  ${a.actor_email}  |  ${a.action}  ${a.details ? `— ${a.details}` : ""}`, {
      width: 500
    });
  });

  doc.end();
  await writeAudit(req.session.user.email, "export_pdf", "reports");
});

router.get("/roster", requireSystemAdmin, async (req, res) => {
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const roster = await listRoster({ search });
  res.render("admin-roster", {
    user: req.session.user,
    roster,
    rosterCount: await countRoster(),
    searchQuery: search,
    error: req.query.error ? decodeURIComponent(String(req.query.error)) : null,
    success: req.query.imported ? `Imported ${req.query.imported} roster row(s).` : null,
    active: "roster"
  });
});

router.post("/roster/import", requireSystemAdmin, requireWriteAccess, rosterCsvUpload.single("csvFile"), async (req, res) => {
  const csvText = req.file
    ? req.file.buffer.toString("utf8").trim()
    : String(req.body.csvText || "").trim();
  if (!csvText) {
    res.redirect("/admin/roster?error=missing_csv");
    return;
  }
  try {
    const rows = parseRosterCsv(csvText);
    if (!rows.length) {
      res.redirect("/admin/roster?error=empty_csv");
      return;
    }
    const count = await upsertRosterRows(rows);
    await writeAudit(req.session.user.email, "import_roster", `rows=${count}`);
    res.redirect(`/admin/roster?imported=${count}`);
  } catch (e) {
    res.redirect(`/admin/roster?error=${encodeURIComponent(e.message)}`);
  }
});

router.get("/archive", requireSystemAdmin, async (req, res) => {
  const archived = (
    await listRequests({ statusGroup: "archived" })
  ).map((item) => ({ ...item, statusClass: computeStatusBadge(item.status) }));
  res.render("admin-archive", {
    user: req.session.user,
    requests: archived,
    success: req.query.archived ? `${req.query.archived} request(s) archived.` : null,
    error: null,
    active: "archive"
  });
});

router.post("/archive/run", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  const days = Math.max(30, Number(req.body.days) || 90);
  const count = await archiveOldRequests(days);
  await writeAudit(req.session.user.email, "archive_old_requests", `days=${days} count=${count}`);
  res.redirect(`/admin/archive?archived=${count}`);
});

router.post("/request/:id/archive", requireWriteAccess, async (req, res) => {
  const current = await getRequestById(req.params.id);
  if (!current || !["Released", "Rejected"].includes(current.status)) {
    res.redirect("/admin/requests?view=completed");
    return;
  }
  await archiveRequest(current.id);
  await writeAudit(req.session.user.email, "archive_request", `id=${current.id}`);
  const back = req.body.redirectView === "archived" ? "archived" : "completed";
  res.redirect(`/admin/requests?view=${back}`);
});

router.post("/request/:id/unarchive", requireSystemAdmin, requireWriteAccess, async (req, res) => {
  await unarchiveRequest(req.params.id);
  await writeAudit(req.session.user.email, "unarchive_request", `id=${req.params.id}`);
  res.redirect("/admin/archive");
});

module.exports = router;
