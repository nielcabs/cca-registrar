const express = require("express");
const path = require("path");
const PDFDocument = require("pdfkit");
const bcrypt = require("bcryptjs");
const dayjs = require("dayjs");
const { v4: uuidv4 } = require("uuid");

const {
  DEPARTMENTS,
  ROOT_DIR,
  listUsers,
  getUserById,
  getUserByEmail,
  getUserByStudentId,
  insertUser,
  deleteUser,
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
  countReleasedRequestsForStudent
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { runOcr, parseOcrFields } = require("../ocr");
const {
  computeStatusBadge,
  computeClearanceBadge,
  generateUpcomingSlots,
  SLOT_CAPACITY,
  formatDate
} = require("../helpers");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/dashboard", async (req, res) => {
  const stats = await getDashboardStats();
  const recent = (await listRequests()).slice(0, 8).map((r) => ({
    ...r,
    statusClass: computeStatusBadge(r.status)
  }));

  res.render("admin-dashboard", {
    user: req.session.user,
    stats,
    recent
  });
});

router.get("/requests", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const sorted = (await listRequests({ search: q })).map((item) => ({
    ...item,
    statusClass: computeStatusBadge(item.status)
  }));

  res.render("admin-queue", {
    user: req.session.user,
    requests: sorted,
    searchQuery: q,
    active: "requests"
  });
});

async function buildSlotAvailability() {
  const slots = generateUpcomingSlots(14);
  const results = [];
  for (const slot of slots) {
    const booked = await countScheduleBookings(slot.date, slot.time);
    results.push({
      date: slot.date,
      time: slot.time,
      booked,
      capacity: SLOT_CAPACITY,
      available: booked < SLOT_CAPACITY
    });
  }
  return results;
}

router.get("/request/:id", async (req, res) => {
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
  const slots = await buildSlotAvailability();
  const releasedCount = await countReleasedRequestsForStudent(found.studentId);
  const returningNote =
    releasedCount > 0 && summary === "Cleared"
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
    returningNote
  });
});

router.post("/request/:id/run-ocr", async (req, res) => {
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

  try {
    const { rawText, confidence } = await runOcr(localFilePath);
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
    const slots = await buildSlotAvailability();
    const releasedCount = await countReleasedRequestsForStudent(current.studentId);
    const returningNote =
      releasedCount > 0 && summary === "Cleared"
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
      returningNote
    });
  } catch (error) {
    current.ocr = { ...current.ocr, state: "failed" };
    current.updatedAt = new Date().toISOString();
    await updateRequest(current);

    const clearances = await listClearancesForStudent(current.studentId);
    const summary = await computeStudentClearanceSummary(current.studentId);
    const slots = await buildSlotAvailability();
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
      returningNote
    });
  }
});

router.post("/request/:id/update", async (req, res) => {
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
    if (liveClearance !== "Cleared") {
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
  }

  const clearances = await listClearancesForStudent(current.studentId);
  const summary = await computeStudentClearanceSummary(current.studentId);
  const slots = await buildSlotAvailability();
  const releasedCount = await countReleasedRequestsForStudent(current.studentId);
  const returningNote =
    releasedCount > 0 && summary === "Cleared"
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
    returningNote
  });
});

router.get("/clearance/:studentId", async (req, res) => {
  const clearances = await listClearancesForStudent(req.params.studentId);
  const summary = await computeStudentClearanceSummary(req.params.studentId);
  const releasedCount = await countReleasedRequestsForStudent(req.params.studentId);
  res.render("admin-student-clearance", {
    user: req.session.user,
    studentId: req.params.studentId,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    summary,
    summaryBadge: computeClearanceBadge(summary),
    releasedCount
  });
});

router.get("/clearances", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = await listStudentsClearanceOverview(q);
  res.render("admin-clearances", {
    user: req.session.user,
    rows: rows.map((r) => ({
      ...r,
      summaryBadge: computeClearanceBadge(r.clearanceSummary)
    })),
    searchQuery: q,
    departments: DEPARTMENTS,
    active: "clearances"
  });
});

router.get("/users", async (req, res) => {
  const users = await listUsers();
  res.render("admin-users", {
    user: req.session.user,
    users,
    departments: DEPARTMENTS,
    error: null,
    success: null
  });
});

router.post("/users/create", async (req, res) => {
  const { email, password, role, displayName, studentId, departmentCode } = req.body;
  const users = await listUsers();

  if (!email || !password || !role || !displayName) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Email, password, role, and name are required.",
      success: null
    });
    return;
  }
  if (password.length < 6) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Password must be at least 6 characters.",
      success: null
    });
    return;
  }

  const dupEmail = await getUserByEmail(email);
  if (dupEmail) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Email already in use.",
      success: null
    });
    return;
  }

  if (role === "student") {
    if (!studentId) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        error: "Student ID is required for student accounts.",
        success: null
      });
      return;
    }
    const dupSid = await getUserByStudentId(studentId);
    if (dupSid) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        error: "Student ID already registered.",
        success: null
      });
      return;
    }
  }
  if (role === "department" && !departmentCode) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Department is required for department officers.",
      success: null
    });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    role,
    displayName: displayName.trim(),
    studentId: role === "student" ? studentId.trim() : null,
    departmentCode: role === "department" ? departmentCode : null,
    isVerified: true,
    createdAt: new Date().toISOString()
  };
  await insertUser(newUser);
  if (role === "student") await ensureClearanceRows(newUser.studentId);
  await writeAudit(req.session.user.email, "create_user", `email=${newUser.email} role=${role}`);

  const freshUsers = await listUsers();
  res.render("admin-users", {
    user: req.session.user,
    users: freshUsers,
    departments: DEPARTMENTS,
    error: null,
    success: `Account created for ${newUser.email}.`
  });
});

router.post("/users/:id/delete", async (req, res) => {
  const target = await getUserById(req.params.id);
  if (target && target.email === req.session.user.email) {
    res.status(400).send("You cannot delete your own account while logged in.");
    return;
  }
  if (target) {
    await deleteUser(target.id);
    await writeAudit(req.session.user.email, "delete_user", `email=${target.email}`);
  }
  res.redirect("/admin/users");
});

router.get("/reports", async (req, res) => {
  const stats = await getDashboardStats();
  const audit = await listAudit(30);
  res.render("admin-reports", {
    user: req.session.user,
    stats,
    audit: audit.map((a) => ({ ...a, at_formatted: formatDate(a.at) }))
  });
});

router.get("/reports/export.pdf", async (req, res) => {
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

module.exports = router;
