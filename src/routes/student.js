const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const {
  UPLOADS_DIR,
  listRequests,
  getRequestById,
  insertRequest,
  listClearancesForStudent,
  computeStudentClearanceSummary,
  writeAudit
} = require("../db");
const { requireAuth, requireRole, requireVerifiedStudent } = require("../middleware");
const { computeStatusBadge, computeClearanceBadge } = require("../helpers");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPG and PNG files are supported for OCR demo."));
  }
});

router.use(requireAuth, requireRole("student"));

router.get("/dashboard", async (req, res) => {
  const mine = (await listRequests({ studentId: req.session.user.studentId })).map(
    (item) => ({
      ...item,
      statusClass: computeStatusBadge(item.status)
    })
  );
  const clearanceSummary = await computeStudentClearanceSummary(req.session.user.studentId);

  res.render("student-dashboard", {
    user: req.session.user,
    requests: mine,
    clearanceSummary,
    clearanceBadge: computeClearanceBadge(clearanceSummary)
  });
});

router.get("/clearance", async (req, res) => {
  const clearances = await listClearancesForStudent(req.session.user.studentId);
  const summary = await computeStudentClearanceSummary(req.session.user.studentId);
  res.render("student-clearance", {
    user: req.session.user,
    clearances: clearances.map((c) => ({
      ...c,
      badge: computeClearanceBadge(c.status)
    })),
    summary,
    summaryBadge: computeClearanceBadge(summary)
  });
});

router.get("/new-request", requireVerifiedStudent, (req, res) => {
  res.render("new-request", { user: req.session.user, error: null });
});

router.post(
  "/new-request",
  requireVerifiedStudent,
  upload.single("documentFile"),
  async (req, res) => {
    const { documentType, purpose } = req.body;

    if (!documentType || !purpose || !req.file) {
      res.render("new-request", {
        user: req.session.user,
        error: "Document type, purpose, and proof image are required."
      });
      return;
    }

    const clearanceSummary = await computeStudentClearanceSummary(req.session.user.studentId);

    const newRequest = {
      id: uuidv4().split("-")[0].toUpperCase(),
      studentName: req.session.user.displayName,
      studentId: req.session.user.studentId,
      documentType,
      purpose,
      status: "Submitted",
      clearanceStatus: clearanceSummary,
      uploadedFilePath: `/uploads/${req.file.filename}`,
      uploadedFileName: req.file.originalname,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schedule: null,
      registrarRemarks: "",
      ocr: {
        state: "not_run",
        confidence: null,
        rawText: "",
        extracted: {
          studentName: "",
          studentId: "",
          orNumber: "",
          amount: "",
          paymentDate: ""
        }
      }
    };

    await insertRequest(newRequest);
    await writeAudit(
      req.session.user.email,
      "submit_request",
      `id=${newRequest.id} doc=${newRequest.documentType}`
    );
    res.redirect("/student/dashboard");
  }
);

router.get("/track/:id", async (req, res) => {
  const found = await getRequestById(req.params.id);
  if (!found) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }
  if (found.studentId !== req.session.user.studentId) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "Forbidden",
      message: "You do not have permission to view this request."
    });
    return;
  }
  res.render("request-track", { user: req.session.user, request: found });
});

module.exports = router;
