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
  writeAudit,
  listNotificationsForUser,
  markNotificationRead,
  countUnreadNotifications
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { computeStatusBadge, computeClearanceBadge, DOCUMENT_TYPES } = require("../helpers");
const { notifyUser } = require("../notify");

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

router.get("/notifications", async (req, res) => {
  const notifications = await listNotificationsForUser(req.session.user.id, 40);
  const unreadNotificationsCount = await countUnreadNotifications(req.session.user.id);
  res.render("notifications", {
    user: req.session.user,
    notifications,
    basePath: "/student",
    unreadNotificationsCount,
    message: null
  });
});

router.post("/notifications/:id/read", async (req, res) => {
  await markNotificationRead(req.session.user.id, Number(req.params.id));
  res.redirect("/student/notifications");
});

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

router.get("/new-request", (req, res) => {
  res.render("new-request", {
    user: req.session.user,
    error: null,
    documentTypes: DOCUMENT_TYPES
  });
});

router.post("/new-request", upload.single("documentFile"), async (req, res) => {
  const { purpose } = req.body;
  const documentTypes = []
    .concat(req.body.documentTypes || [])
    .filter(Boolean);

  const hasScholarship = Boolean(req.session.user.hasScholarship);
  const needsReceipt = !hasScholarship;

  if (!documentTypes.length || !purpose) {
    res.render("new-request", {
      user: req.session.user,
      error: "Select at least one document type and enter a purpose.",
      documentTypes: DOCUMENT_TYPES
    });
    return;
  }

  if (needsReceipt && !req.file) {
    res.render("new-request", {
      user: req.session.user,
      error: "Payment receipt is required for non-scholarship students.",
      documentTypes: DOCUMENT_TYPES
    });
    return;
  }

  const clearanceSummary = await computeStudentClearanceSummary(req.session.user.studentId);
  const batchId = documentTypes.length > 1 ? uuidv4().split("-")[0].toUpperCase() : null;
  const now = new Date().toISOString();
  const filePath = req.file ? `/uploads/${req.file.filename}` : "";
  const fileName = req.file ? req.file.originalname : "";

  for (const documentType of documentTypes) {
    const newRequest = {
      id: uuidv4().split("-")[0].toUpperCase(),
      studentName: req.session.user.displayName,
      studentId: req.session.user.studentId,
      documentType,
      purpose,
      status: "Submitted",
      clearanceStatus: clearanceSummary,
      uploadedFilePath: filePath,
      uploadedFileName: fileName,
      batchId,
      createdAt: now,
      updatedAt: now,
      schedule: null,
      registrarRemarks: hasScholarship && !req.file ? "Scholarship — no receipt uploaded." : "",
      ocr: {
        state: req.file ? "not_run" : "not_run",
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
      `id=${newRequest.id} doc=${newRequest.documentType}${batchId ? ` batch=${batchId}` : ""}`
    );
  }

  await notifyUser(req.session.user.id, {
    title: "Document request submitted",
    message: `Submitted ${documentTypes.length} document request(s)${batchId ? ` under batch ${batchId}` : ""}. The registrar office will review your payment proof and clearance.`,
    link: "/student/dashboard"
  });

  res.redirect("/student/dashboard");
});

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
