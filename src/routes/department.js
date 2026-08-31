const express = require("express");

const {
  listClearancesForDepartment,
  listUsers,
  updateClearance,
  updateClearancePhoto,
  updateTuitionPayment,
  writeAudit,
  listNotificationsForUser,
  markNotificationRead,
  countUnreadNotifications,
  DEPARTMENTS,
  getClearanceDepartmentCodes
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { computeClearanceBadge, computeTuitionBadge, FINANCE_TUITION_STATUSES, displayTuitionStatus } = require("../helpers");
const { clearanceRowStatuses, normalizeClearanceStatus } = require("../terminology");
const { notifyStudentByStudentId } = require("../notify");
const { createOcrUpload } = require("../upload");

const router = express.Router();
const clearancePhotoUpload = createOcrUpload();

router.use(requireAuth, requireRole("department"));

function dashboardRedirect(returnQ, saved) {
  const params = new URLSearchParams();
  if (saved) params.set("saved", saved);
  if (returnQ) params.set("q", returnQ);
  const qs = params.toString();
  return `/department/dashboard${qs ? `?${qs}` : ""}`;
}

function savedMessage(saved) {
  if (saved === "tuition") return "Tuition payment record saved.";
  if (saved === "clearance") return "Clearance record saved.";
  return null;
}

router.get("/notifications", async (req, res) => {
  const notifications = await listNotificationsForUser(req.session.user.id, 40);
  const unreadNotificationsCount = await countUnreadNotifications(req.session.user.id);
  res.render("notifications", {
    user: req.session.user,
    notifications,
    basePath: "/department",
    unreadNotificationsCount,
    message: null
  });
});

router.post("/notifications/:id/read", async (req, res) => {
  await markNotificationRead(req.session.user.id, Number(req.params.id));
  res.redirect("/department/notifications");
});

router.get("/dashboard", async (req, res) => {
  const code = req.session.user.departmentCode;
  const dept = DEPARTMENTS.find((d) => d.code === code);
  const isFinance = code === "finance";
  const existing = await listClearancesForDepartment(code);
  let students = await listUsers({ role: "student" });

  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (q) {
    students = students.filter(
      (s) =>
        (s.displayName && s.displayName.toLowerCase().includes(q)) ||
        (s.studentId && s.studentId.toLowerCase().includes(q)) ||
        (s.email && s.email.toLowerCase().includes(q))
    );
  }

  const existingMap = new Map(existing.map((c) => [c.studentId, c]));
  const rows = students
    .filter((s) => getClearanceDepartmentCodes(s.studentCategory || "undergraduate").includes(code))
    .map((s) => {
    const c = existingMap.get(s.studentId);
    return {
      studentId: s.studentId,
      displayName: s.displayName,
      email: s.email,
      studentCategory: s.studentCategory || "undergraduate",
      course: s.course || "",
      section: s.section || "",
      status: normalizeClearanceStatus(c?.status || "Pending"),
      remarks: c?.remarks || "",
      badge: computeClearanceBadge(c?.status || "Pending"),
      updatedAt: c?.updatedAt || null,
      photoPath: c?.photoPath || "",
      photoName: c?.photoName || "",
      tuitionPaymentStatus: s.tuitionPaymentStatus || "Unpaid",
      tuitionPaymentRemarks: s.tuitionPaymentRemarks || "",
      tuitionDisplayStatus: displayTuitionStatus(s),
      tuitionPaymentBadge: computeTuitionBadge(displayTuitionStatus(s)),
      tuitionPaymentUpdatedAt: s.tuitionPaymentUpdatedAt || null,
      hasScholarship: Boolean(s.hasScholarship),
      tuitionReceiptPath: s.tuitionReceiptPath || "",
      tuitionReceiptName: s.tuitionReceiptName || ""
    };
  });

  res.render("department-dashboard", {
    user: req.session.user,
    department: dept,
    isFinance,
    tuitionStatuses: FINANCE_TUITION_STATUSES,
    students: rows,
    searchQuery: q,
    message: savedMessage(req.query.saved)
  });
});

router.post(
  "/clearance/:studentId",
  clearancePhotoUpload.single("clearancePhoto"),
  async (req, res) => {
  const { status, remarks, returnQ } = req.body;
  const code = req.session.user.departmentCode;

  if (!clearanceRowStatuses().includes(status)) {
    res.status(400).send("Invalid clearance status value.");
    return;
  }

  await updateClearance({
    studentId: req.params.studentId,
    departmentCode: code,
    status,
    remarks: remarks || "",
    updatedBy: req.session.user.email
  });

  if (req.file) {
    const photoPath = `/uploads/${req.file.filename}`;
    await updateClearancePhoto({
      studentId: req.params.studentId,
      departmentCode: code,
      photoPath,
      photoName: req.file.originalname
    });
  }

  await writeAudit(
    req.session.user.email,
    "update_clearance",
    `student=${req.params.studentId} dept=${code} status=${status}${req.file ? " photo=1" : ""}`
  );

  const dept = DEPARTMENTS.find((d) => d.code === code);
  await notifyStudentByStudentId(req.params.studentId, {
    title: `${dept?.name || "Department"} clearance updated`,
    message: `Your clearance at ${dept?.name || code} is now "${status}".${remarks ? ` ${remarks}` : ""}`,
    link: "/student/clearance"
  });

  res.redirect(dashboardRedirect(returnQ, "clearance"));
});

router.post("/tuition/:studentId", async (req, res) => {
  const code = req.session.user.departmentCode;
  if (code !== "finance") {
    res.status(403).send("Only the Finance office can update tuition records.");
    return;
  }

  const { tuitionPaymentStatus, tuitionPaymentRemarks, returnQ } = req.body;
  const studentRow = await listUsers({ role: "student" });
  const targetStudent = studentRow.find((s) => s.studentId === req.params.studentId);

  if (!targetStudent) {
    res.status(404).send("Student not found.");
    return;
  }
  if (targetStudent.hasScholarship) {
    res.status(400).send("Scholarship status is managed by the registrar.");
    return;
  }
  if (!FINANCE_TUITION_STATUSES.includes(tuitionPaymentStatus)) {
    res.status(400).send("Invalid tuition payment status.");
    return;
  }

  await updateTuitionPayment({
    studentId: req.params.studentId,
    status: tuitionPaymentStatus,
    remarks: tuitionPaymentRemarks || "",
    updatedBy: req.session.user.email
  });

  await writeAudit(
    req.session.user.email,
    "update_tuition",
    `student=${req.params.studentId} status=${tuitionPaymentStatus}`
  );

  await notifyStudentByStudentId(req.params.studentId, {
    title: "Tuition payment updated",
    message: `Finance office marked your tuition as "${tuitionPaymentStatus}".${tuitionPaymentRemarks ? ` ${tuitionPaymentRemarks}` : ""}`,
    link: "/student/tuition"
  });

  res.redirect(dashboardRedirect(returnQ, "tuition"));
});

/** @deprecated Use /clearance/:studentId or /tuition/:studentId */
router.post("/update/:studentId", async (req, res) => {
  const { status, remarks, tuitionPaymentStatus, tuitionPaymentRemarks, returnQ } = req.body;
  const code = req.session.user.departmentCode;
  const isFinance = code === "finance";

  if (!clearanceRowStatuses().includes(status)) {
    res.status(400).send("Invalid status value.");
    return;
  }

  await updateClearance({
    studentId: req.params.studentId,
    departmentCode: code,
    status,
    remarks: remarks || "",
    updatedBy: req.session.user.email
  });

  if (isFinance && tuitionPaymentStatus) {
    const studentRow = await listUsers({ role: "student" });
    const targetStudent = studentRow.find((s) => s.studentId === req.params.studentId);
    if (targetStudent && !targetStudent.hasScholarship) {
      if (!FINANCE_TUITION_STATUSES.includes(tuitionPaymentStatus)) {
        res.status(400).send("Invalid tuition payment status.");
        return;
      }
      await updateTuitionPayment({
        studentId: req.params.studentId,
        status: tuitionPaymentStatus,
        remarks: tuitionPaymentRemarks || "",
        updatedBy: req.session.user.email
      });
    }
  }

  res.redirect(dashboardRedirect(returnQ, "clearance"));
});

module.exports = router;
