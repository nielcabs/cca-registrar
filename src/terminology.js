/** CCA Registrar Office — standard terms used in the UI and documentation. */

const CLEARANCE_ROW_STATUS = {
  PENDING: "Pending",
  SIGNED: "Signed",
  NOT_SIGNED: "Not Signed"
};

const CLEARANCE_SUMMARY = {
  PENDING: "Pending",
  SIGNED: "Signed",
  PARTIALLY_SIGNED: "Partially Signed",
  NOT_SIGNED: "Not Signed"
};

const LABELS = {
  institute: "Institute",
  section: "Section",
  program: "Program",
  requisition: "Document requisition",
  releaseAppointment: "Release appointment",
  paymentProof: "Payment proof / OR receipt",
  clearanceSlip: "Signed clearance slip"
};

function normalizeClearanceStatus(status) {
  const s = String(status || "").trim();
  if (s === "Cleared") return CLEARANCE_ROW_STATUS.SIGNED;
  if (s === "Not Cleared") return CLEARANCE_ROW_STATUS.NOT_SIGNED;
  return s || CLEARANCE_ROW_STATUS.PENDING;
}

function normalizeClearanceSummary(summary) {
  const s = String(summary || "").trim();
  if (s === "Cleared") return CLEARANCE_SUMMARY.SIGNED;
  if (s === "Partially Cleared") return CLEARANCE_SUMMARY.PARTIALLY_SIGNED;
  if (s === "Not Cleared") return CLEARANCE_SUMMARY.NOT_SIGNED;
  return s || CLEARANCE_SUMMARY.PENDING;
}

function isClearanceComplete(summary) {
  return normalizeClearanceSummary(summary) === CLEARANCE_SUMMARY.SIGNED;
}

function clearanceRowStatuses() {
  return [
    CLEARANCE_ROW_STATUS.PENDING,
    CLEARANCE_ROW_STATUS.SIGNED,
    CLEARANCE_ROW_STATUS.NOT_SIGNED
  ];
}

module.exports = {
  CLEARANCE_ROW_STATUS,
  CLEARANCE_SUMMARY,
  LABELS,
  normalizeClearanceStatus,
  normalizeClearanceSummary,
  isClearanceComplete,
  clearanceRowStatuses
};
