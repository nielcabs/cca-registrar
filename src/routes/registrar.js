const express = require("express");
const path = require("path");
const dayjs = require("dayjs");

const {
  ROOT_DIR,
  listRequests,
  getRequestById,
  updateRequest,
  countScheduleBookings,
  listClearancesForStudent,
  computeStudentClearanceSummary,
  writeAudit
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { runOcr, parseOcrFields } = require("../ocr");
const {
  computeStatusBadge,
  computeClearanceBadge,
  generateUpcomingSlots,
  SLOT_CAPACITY
} = require("../helpers");

const router = express.Router();

router.use(requireAuth, requireRole("registrar"));

router.get("/dashboard", async (req, res) => {
  const sorted = (await listRequests()).map((item) => ({
    ...item,
    statusClass: computeStatusBadge(item.status)
  }));

  res.render("registrar-dashboard", {
    user: req.session.user,
    requests: sorted
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

  res.render("registrar-request", {
    user: req.session.user,
    request: found,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    clearanceSummary: summary,
    clearanceSummaryBadge: computeClearanceBadge(summary),
    slots,
    message: null,
    error: null,
    dayjs
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

    res.render("registrar-request", {
      user: req.session.user,
      request: current,
      clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
      clearanceSummary: summary,
      clearanceSummaryBadge: computeClearanceBadge(summary),
      slots,
      message: "OCR completed. Review extracted values before saving.",
      error: null,
      dayjs
    });
  } catch (error) {
    current.ocr = { ...current.ocr, state: "failed" };
    current.updatedAt = new Date().toISOString();
    await updateRequest(current);

    const clearances = await listClearancesForStudent(current.studentId);
    const summary = await computeStudentClearanceSummary(current.studentId);
    const slots = await buildSlotAvailability();

    res.render("registrar-request", {
      user: req.session.user,
      request: current,
      clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
      clearanceSummary: summary,
      clearanceSummaryBadge: computeClearanceBadge(summary),
      slots,
      message: null,
      error: `OCR failed: ${error.message}`,
      dayjs
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

  res.render("registrar-request", {
    user: req.session.user,
    request: current,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    clearanceSummary: summary,
    clearanceSummaryBadge: computeClearanceBadge(summary),
    slots,
    message: error ? null : "Request updated successfully.",
    error,
    dayjs
  });
});

router.get("/clearance/:studentId", async (req, res) => {
  const clearances = await listClearancesForStudent(req.params.studentId);
  const summary = await computeStudentClearanceSummary(req.params.studentId);
  res.render("registrar-clearance", {
    user: req.session.user,
    studentId: req.params.studentId,
    clearances: clearances.map((c) => ({ ...c, badge: computeClearanceBadge(c.status) })),
    summary,
    summaryBadge: computeClearanceBadge(summary)
  });
});

module.exports = router;
