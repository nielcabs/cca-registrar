const express = require("express");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const {
  UPLOADS_DIR,
  ROOT_DIR,
  DEPARTMENTS,
  listRequests,
  getRequestById,
  insertRequest,
  updateRequest,
  countScheduleBookings,
  listClearancesForStudent,
  computeStudentClearanceSummary,
  getStudentClearanceUpload,
  updateStudentClearanceUpload,
  writeAudit,
  listNotificationsForUser,
  markNotificationRead,
  countUnreadNotifications,
  getUserById,
  updateStudentTuitionReceipt,
  getUserByStudentId
} = require("../db");
const { requireAuth, requireRole, requireVerifiedStudent } = require("../middleware");
const { computeStatusBadge, computeClearanceBadge, computeTuitionBadge, displayTuitionStatus, DOCUMENT_TYPES, buildSlotAvailability, SLOT_CAPACITY } = require("../helpers");
const { notifyUser } = require("../notify");
const { isClearanceComplete } = require("../terminology");
const { runClearanceOcrOnFile } = require("../ocr");
const { compareClearanceOcrToProfile } = require("../clearanceOcrHelpers");
const { createOcrUpload } = require("../upload");

const router = express.Router();

const upload = createOcrUpload();

router.use(requireAuth, requireRole("student"));

async function loadClearancePageData(studentId) {
  const clearances = await listClearancesForStudent(studentId);
  const summary = await computeStudentClearanceSummary(studentId);
  const clearanceUpload = await getStudentClearanceUpload(studentId);
  const student = await getUserByStudentId(studentId);
  const ocrCompare =
    clearanceUpload?.ocr?.state === "processed" && clearanceUpload.ocr.extracted
      ? compareClearanceOcrToProfile(student, clearanceUpload.ocr.extracted)
      : { nameMatch: null, idMatch: null, warnings: [] };
  return {
    clearances: clearances.map((c) => ({
      ...c,
      badge: computeClearanceBadge(c.status)
    })),
    summary,
    summaryBadge: computeClearanceBadge(summary),
    clearanceUpload,
    ocrCompare
  };
}

function trackSuccessMessage(query) {
  if (query.booked) return "Appointment booked successfully.";
  if (query.rescheduled) return "Appointment rescheduled successfully.";
  if (query.cancelled) return "Appointment cancelled. You can book a new slot when ready.";
  return null;
}

function canBookAppointment(user, request, liveClearance) {
  return (
    user.isVerified &&
    ["Submitted", "For Verification"].includes(request.status) &&
    isClearanceComplete(liveClearance) &&
    !["Released", "Rejected"].includes(request.status)
  );
}

function canManageScheduledAppointment(user, request) {
  return (
    user.isVerified &&
    request.status === "Scheduled" &&
    request.schedule &&
    !["Released", "Rejected"].includes(request.status)
  );
}

router.use(async (req, res, next) => {
  const fresh = await getUserById(req.session.user.id);
  if (fresh) {
    req.session.user = {
      ...req.session.user,
      displayName: fresh.displayName,
      isVerified: fresh.isVerified,
      course: fresh.course,
      section: fresh.section,
      phone: fresh.phone,
      hasScholarship: fresh.hasScholarship
    };
  }
  next();
});

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
  const mine = (await listRequests({ studentId: req.session.user.studentId })).map((item) => ({
    ...item,
    statusClass: computeStatusBadge(item.status),
    canBook:
      req.session.user.isVerified &&
      ["Submitted", "For Verification"].includes(item.status) &&
      !item.schedule &&
      isClearanceComplete(item.clearanceStatus)
  }));
  const clearanceSummary = await computeStudentClearanceSummary(req.session.user.studentId);

  res.render("student-dashboard", {
    user: req.session.user,
    requests: mine,
    clearanceSummary,
    clearanceBadge: computeClearanceBadge(clearanceSummary),
    pendingVerification: !req.session.user.isVerified
  });
});

router.get("/clearance", async (req, res) => {
  const data = await loadClearancePageData(req.session.user.studentId);
  res.render("student-clearance", {
    user: req.session.user,
    departments: DEPARTMENTS,
    ...data,
    error: null,
    success: null
  });
});

router.post(
  "/clearance/upload",
  requireVerifiedStudent,
  upload.single("clearancePhoto"),
  async (req, res) => {
    const studentId = req.session.user.studentId;

    if (!req.file) {
      const data = await loadClearancePageData(studentId);
      res.render("student-clearance", {
        user: req.session.user,
        departments: DEPARTMENTS,
        ...data,
        error: "Choose a JPG or PNG photo of your signed clearance form.",
        success: null
      });
      return;
    }

    const photoPath = `/uploads/${req.file.filename}`;
    const localFilePath = path.join(ROOT_DIR, photoPath.replace(/^\/+/, ""));
    let ocr = { state: "not_run", confidence: null, rawText: "", extracted: {} };

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
      photoPath,
      photoName: req.file.originalname,
      ocr
    });

    await writeAudit(req.session.user.email, "upload_clearance_form", `student=${studentId}`);

    const data = await loadClearancePageData(studentId);
    const ocrNote =
      ocr.state === "processed"
        ? " OCR completed — review the extracted details below."
        : ocr.state === "failed"
          ? " Photo saved, but OCR could not read the image. You may upload a clearer photo."
          : "";

    res.render("student-clearance", {
      user: req.session.user,
      departments: DEPARTMENTS,
      ...data,
      error: null,
      success: `Clearance form uploaded.${ocrNote}`
    });
  }
);

router.get("/tuition", async (req, res) => {
  const fresh = await getUserByStudentId(req.session.user.studentId);
  const tuitionStatus = displayTuitionStatus(fresh || req.session.user);
  res.render("student-tuition", {
    user: req.session.user,
    profile: fresh || req.session.user,
    tuitionStatus,
    tuitionBadge: computeTuitionBadge(tuitionStatus),
    error: null,
    success: null
  });
});

router.post(
  "/tuition/upload",
  requireVerifiedStudent,
  upload.single("tuitionReceipt"),
  async (req, res) => {
    const fresh = await getUserByStudentId(req.session.user.studentId);
    const tuitionStatus = displayTuitionStatus(fresh || req.session.user);

    if (fresh?.hasScholarship) {
      res.render("student-tuition", {
        user: req.session.user,
        profile: fresh,
        tuitionStatus,
        tuitionBadge: computeTuitionBadge(tuitionStatus),
        error: "Scholarship students do not need to upload a tuition receipt. Scholarship is assigned by the registrar.",
        success: null
      });
      return;
    }

    if (!req.file) {
      res.render("student-tuition", {
        user: req.session.user,
        profile: fresh,
        tuitionStatus,
        tuitionBadge: computeTuitionBadge(tuitionStatus),
        error: "Choose a JPG or PNG photo of your tuition payment receipt (OR).",
        success: null
      });
      return;
    }

    await updateStudentTuitionReceipt(req.session.user.studentId, {
      photoPath: `/uploads/${req.file.filename}`,
      photoName: req.file.originalname,
      updatedBy: req.session.user.email
    });

    await writeAudit(
      req.session.user.email,
      "upload_tuition_receipt",
      `student=${req.session.user.studentId}`
    );

    const updated = await getUserByStudentId(req.session.user.studentId);
    const newStatus = displayTuitionStatus(updated);
    res.render("student-tuition", {
      user: req.session.user,
      profile: updated,
      tuitionStatus: newStatus,
      tuitionBadge: computeTuitionBadge(newStatus),
      error: null,
      success: "Tuition receipt uploaded. Finance will verify your payment."
    });
  }
);

router.get("/new-request", requireVerifiedStudent, (req, res) => {
  res.render("new-request", {
    user: req.session.user,
    error: null,
    documentTypes: DOCUMENT_TYPES
  });
});

router.post(
  "/new-request",
  requireVerifiedStudent,
  upload.single("documentFile"),
  async (req, res) => {
    const { purpose } = req.body;
    const documentTypes = []
      .concat(req.body.documentTypes || [])
      .filter(Boolean);

    const hasScholarship = Boolean(req.session.user.hasScholarship);

    if (!documentTypes.length || !purpose) {
      res.render("new-request", {
        user: req.session.user,
        error: "Select at least one document type and enter a purpose.",
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
        registrarRemarks:
          !req.file
            ? hasScholarship
              ? "Scholarship — no receipt uploaded."
              : "No payment receipt uploaded — registrar may verify payment separately."
            : "",
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

  const liveClearance = await computeStudentClearanceSummary(req.session.user.studentId);
  const canBook = canBookAppointment(req.session.user, found, liveClearance);
  const canReschedule = canManageScheduledAppointment(req.session.user, found);
  const canCancel = canReschedule;
  const slots =
    canBook || canReschedule ? await buildSlotAvailability(countScheduleBookings) : [];

  res.render("request-track", {
    user: req.session.user,
    request: { ...found, clearanceStatus: liveClearance },
    slots,
    canBook,
    canReschedule,
    canCancel,
    error: null,
    success: trackSuccessMessage(req.query)
  });
});

router.post("/track/:id/book", requireVerifiedStudent, async (req, res) => {
  const found = await getRequestById(req.params.id);
  if (!found || found.studentId !== req.session.user.studentId) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const liveClearance = await computeStudentClearanceSummary(req.session.user.studentId);
  const { scheduleDate, scheduleTime } = req.body;
  let error = null;

  if (!canBookAppointment(req.session.user, found, liveClearance)) {
    error = !isClearanceComplete(liveClearance)
      ? "Complete all department clearances before booking an appointment."
      : "This request can no longer be scheduled.";
  } else if (!scheduleDate || !scheduleTime) {
    error = "Select an available appointment slot.";
  } else {
    const booked = await countScheduleBookings(scheduleDate, scheduleTime);
    const isSameSlot =
      found.schedule?.date === scheduleDate && found.schedule?.time === scheduleTime;
    if (!isSameSlot && booked >= SLOT_CAPACITY) {
      error = "That slot is fully booked. Choose another time.";
    }
  }

  if (!error) {
    found.status = "Scheduled";
    found.clearanceStatus = liveClearance;
    found.schedule = { date: scheduleDate, time: scheduleTime };
    found.updatedAt = new Date().toISOString();
    await updateRequest(found);
    await writeAudit(
      req.session.user.email,
      "book_appointment",
      `id=${found.id} ${scheduleDate} ${scheduleTime}`
    );
    await notifyUser(req.session.user.id, {
      title: "Release appointment booked",
      message: `Your ${found.documentType} release is scheduled on ${scheduleDate} at ${scheduleTime}.`,
      link: `/student/track/${found.id}`
    });
    res.redirect(`/student/track/${found.id}?booked=1`);
    return;
  }

  const slots = await buildSlotAvailability(countScheduleBookings);
  res.render("request-track", {
    user: req.session.user,
    request: { ...found, clearanceStatus: liveClearance },
    slots,
    canBook: true,
    canReschedule: false,
    canCancel: false,
    error,
    success: null
  });
});

router.post("/track/:id/reschedule", requireVerifiedStudent, async (req, res) => {
  const found = await getRequestById(req.params.id);
  if (!found || found.studentId !== req.session.user.studentId) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const liveClearance = await computeStudentClearanceSummary(req.session.user.studentId);
  const { scheduleDate, scheduleTime } = req.body;
  let error = null;

  if (!canManageScheduledAppointment(req.session.user, found)) {
    error = "Only scheduled appointments can be rescheduled.";
  } else if (!scheduleDate || !scheduleTime) {
    error = "Select an available appointment slot.";
  } else {
    const booked = await countScheduleBookings(scheduleDate, scheduleTime);
    const isSameSlot =
      found.schedule?.date === scheduleDate && found.schedule?.time === scheduleTime;
    if (!isSameSlot && booked >= SLOT_CAPACITY) {
      error = "That slot is fully booked. Choose another time.";
    }
  }

  if (!error) {
    const previous = found.schedule;
    found.schedule = { date: scheduleDate, time: scheduleTime };
    found.clearanceStatus = liveClearance;
    found.updatedAt = new Date().toISOString();
    await updateRequest(found);
    await writeAudit(
      req.session.user.email,
      "reschedule_appointment",
      `id=${found.id} ${previous?.date} ${previous?.time} -> ${scheduleDate} ${scheduleTime}`
    );
    await notifyUser(req.session.user.id, {
      title: "Release appointment rescheduled",
      message: `Your ${found.documentType} release is now scheduled on ${scheduleDate} at ${scheduleTime}.`,
      link: `/student/track/${found.id}`
    });
    res.redirect(`/student/track/${found.id}?rescheduled=1`);
    return;
  }

  const slots = await buildSlotAvailability(countScheduleBookings);
  res.render("request-track", {
    user: req.session.user,
    request: { ...found, clearanceStatus: liveClearance },
    slots,
    canBook: false,
    canReschedule: true,
    canCancel: true,
    error,
    success: null
  });
});

router.post("/track/:id/cancel-appointment", requireVerifiedStudent, async (req, res) => {
  const found = await getRequestById(req.params.id);
  if (!found || found.studentId !== req.session.user.studentId) {
    res.status(404).render("error", {
      user: req.session.user,
      title: "Not found",
      message: "Request not found."
    });
    return;
  }

  const liveClearance = await computeStudentClearanceSummary(req.session.user.studentId);
  let error = null;

  if (!canManageScheduledAppointment(req.session.user, found)) {
    error = "Only scheduled appointments can be cancelled.";
  }

  if (!error) {
    const previous = found.schedule;
    found.status = "For Verification";
    found.schedule = null;
    found.clearanceStatus = liveClearance;
    found.updatedAt = new Date().toISOString();
    await updateRequest(found);
    await writeAudit(
      req.session.user.email,
      "cancel_appointment",
      `id=${found.id} was ${previous?.date} ${previous?.time}`
    );
    await notifyUser(req.session.user.id, {
      title: "Release appointment cancelled",
      message: `Your ${found.documentType} release appointment was cancelled. Book a new slot from the request tracker when ready.`,
      link: `/student/track/${found.id}`
    });
    res.redirect(`/student/track/${found.id}?cancelled=1`);
    return;
  }

  const slots = await buildSlotAvailability(countScheduleBookings);
  res.render("request-track", {
    user: req.session.user,
    request: { ...found, clearanceStatus: liveClearance },
    slots,
    canBook: false,
    canReschedule: true,
    canCancel: true,
    error,
    success: null
  });
});

module.exports = router;
