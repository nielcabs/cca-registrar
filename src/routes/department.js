const express = require("express");

const {
  DEPARTMENTS,
  listClearancesForDepartment,
  listUsers,
  updateClearance,
  writeAudit
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { computeClearanceBadge } = require("../helpers");

const router = express.Router();

router.use(requireAuth, requireRole("department"));

router.get("/dashboard", async (req, res) => {
  const code = req.session.user.departmentCode;
  const dept = DEPARTMENTS.find((d) => d.code === code);
  const existing = await listClearancesForDepartment(code);
  const students = await listUsers({ role: "student" });

  const existingMap = new Map(existing.map((c) => [c.studentId, c]));
  const rows = students.map((s) => {
    const c = existingMap.get(s.studentId);
    return {
      studentId: s.studentId,
      displayName: s.displayName,
      email: s.email,
      isVerified: s.isVerified,
      status: c?.status || "Pending",
      remarks: c?.remarks || "",
      badge: computeClearanceBadge(c?.status || "Pending"),
      updatedAt: c?.updatedAt || null
    };
  });

  res.render("department-dashboard", {
    user: req.session.user,
    department: dept,
    students: rows,
    message: req.query.saved ? "Clearance updated." : null
  });
});

router.post("/update/:studentId", async (req, res) => {
  const { status, remarks } = req.body;
  const code = req.session.user.departmentCode;

  if (!["Cleared", "Pending", "Not Cleared"].includes(status)) {
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
  await writeAudit(
    req.session.user.email,
    "update_clearance",
    `student=${req.params.studentId} dept=${code} status=${status}`
  );

  res.redirect("/department/dashboard?saved=1");
});

module.exports = router;
