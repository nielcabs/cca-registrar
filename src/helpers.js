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
    Cleared: "badge-released",
    "Partially Cleared": "badge-scheduled",
    Pending: "badge-verify",
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

module.exports = {
  computeStatusBadge,
  computeClearanceBadge,
  generateUpcomingSlots,
  SLOT_CAPACITY,
  SLOT_TIMES,
  formatDate
};
