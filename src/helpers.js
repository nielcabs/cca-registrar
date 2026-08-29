const dayjs = require("dayjs");

function computeStatusBadge(status) {
  const lookup = {
    Submitted: "badge-submitted",
    "For Verification": "badge-verify",
    Scheduled: "badge-scheduled",
    Released: "badge-released",
    Rejected: "badge-rejected"
  };
  return lookup[status] || "badge-default";
}

function computeClearanceBadge(status) {
  const lookup = {
    Signed: "badge-released",
    Cleared: "badge-released",
    "Partially Signed": "badge-scheduled",
    "Partially Cleared": "badge-scheduled",
    Pending: "badge-verify",
    "Not Signed": "badge-rejected",
    "Not Cleared": "badge-rejected"
  };
  return lookup[status] || "badge-default";
}

// Generate available slots for the next N workdays.
// Working hours: 8:00 - 15:00 (hourly), capacity 5 per slot.
const SLOT_TIMES = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
const SLOT_CAPACITY = 5;

function generateUpcomingSlots(days = 14) {
  const out = [];
  let cursor = dayjs();
  let added = 0;
  while (added < days) {
    cursor = cursor.add(1, "day");
    const dow = cursor.day();
    if (dow === 0 || dow === 6) continue;
    for (const time of SLOT_TIMES) {
      out.push({ date: cursor.format("YYYY-MM-DD"), time });
    }
    added += 1;
  }
  return out;
}

function formatDate(value) {
  if (!value) return "";
  return dayjs(value).format("MMM D, YYYY h:mm A");
}

async function buildSlotAvailability(countScheduleBookings) {
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

const DOCUMENT_TYPES = [
  "Transcript of Records",
  "Certificate of Enrollment",
  "Certificate of Grades",
  "Diploma Copy",
  "Certificate of Good Moral",
  "Certificate of Graduation",
  "Honorable Dismissal"
];

function computeTuitionBadge(status) {
  const lookup = {
    Paid: "badge-released",
    Unpaid: "badge-rejected",
    Partial: "badge-scheduled",
    "For Verification": "badge-verify",
    Scholarship: "badge-verify"
  };
  return lookup[status] || "badge-default";
}

const TUITION_PAYMENT_STATUSES = ["Unpaid", "For Verification", "Paid", "Partial"];
const FINANCE_TUITION_STATUSES = ["Unpaid", "For Verification", "Paid", "Partial"];

function displayTuitionStatus(user) {
  if (user.hasScholarship) return "Scholarship";
  return user.tuitionPaymentStatus || "Unpaid";
}

function categoryLabel(value) {
  const labels = {
    undergraduate: "Undergraduate",
    graduating: "Graduating",
    graduate: "Graduate (Alumni)"
  };
  return labels[value] || value;
}

module.exports = {
  computeStatusBadge,
  computeClearanceBadge,
  computeTuitionBadge,
  TUITION_PAYMENT_STATUSES,
  FINANCE_TUITION_STATUSES,
  displayTuitionStatus,
  generateUpcomingSlots,
  SLOT_CAPACITY,
  SLOT_TIMES,
  formatDate,
  buildSlotAvailability,
  DOCUMENT_TYPES,
  categoryLabel
};
