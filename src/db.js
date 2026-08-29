const path = require("path");
const fs = require("fs/promises");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const UPLOADS_DIR = path.join(ROOT_DIR, "uploads");

const DEPARTMENTS = [
  { code: "library", name: "Library" },
  { code: "misso", name: "MISSO Office" },
  { code: "extension", name: "Community Extension Office (NSTP)" },
  { code: "guidance", name: "Guidance and Admission Office" },
  { code: "saso", name: "Office of Student Affairs" },
  { code: "finance", name: "Finance Office" },
  { code: "registrar", name: "Office of the Registrar" },
  { code: "alumni", name: "Alumni Office" }
];

const STUDENT_CATEGORIES = [
  { value: "undergraduate", label: "Undergraduate" },
  { value: "graduating", label: "Graduating" },
  { value: "graduate", label: "Graduate (Alumni)" }
];

const YEAR_LEVELS = ["1st", "2nd", "3rd", "4th", "5th"];
const SEMESTERS = ["1st", "2nd", "Summer"];
const COMMON_SECTIONS = ["A", "B", "C", "D", "1703", "1704", "1705"];

/** Official CCA institute programs (City College of Angeles). */
const CCA_COURSE_GROUPS = [
  {
    institute: "Institute of Business and Management (IBM)",
    courses: [
      "Bachelor of Science in Accountancy",
      "Bachelor of Science in Accounting Information Systems (BS AIS)",
      "Bachelor of Science in Entrepreneurship",
      "Bachelor of Science in Tourism Management"
    ]
  },
  {
    institute: "Institute of Computing Studies and Library Information Science (ICSLIS)",
    courses: [
      "Bachelor of Science in Computer Science",
      "Bachelor of Science in Information Systems",
      "Bachelor of Library and Information Science (BLIS)",
      "Associate in Computer Technology (ACT)"
    ]
  },
  {
    institute: "Institute of Education, Arts, and Sciences (IEAS)",
    courses: [
      "Bachelor of Arts in English Language Studies (BAELS)",
      "Bachelor of Science in Mathematics",
      "Bachelor of Physical Education (BPEd)",
      "Bachelor of Science in Psychology",
      "Bachelor of Special Needs Education (BSNEd)",
      "Bachelor of Technical-Vocational Teacher Education (BTVTEd), Major in Food and Service Management",
      "Bachelor of Performing Arts"
    ]
  }
];

function getAllCcaCourses() {
  return CCA_COURSE_GROUPS.flatMap((group) => group.courses);
}

function isValidCcaCourse(course) {
  const normalized = String(course || "").trim();
  if (!normalized) return false;
  return getAllCcaCourses().some((c) => c.toLowerCase() === normalized.toLowerCase());
}

function normalizeCcaCourse(course) {
  const normalized = String(course || "").trim();
  if (!normalized) return "";
  const match = getAllCcaCourses().find((c) => c.toLowerCase() === normalized.toLowerCase());
  return match || normalized;
}

async function listCourseFilterOptions() {
  const fromDb = await listDistinctCourses();
  const canonical = getAllCcaCourses();
  return [...new Set([...canonical, ...fromDb])].sort((a, b) => a.localeCompare(b));
}

async function listSectionSuggestions() {
  const fromDb = await listDistinctSections();
  return [...new Set([...COMMON_SECTIONS, ...fromDb])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
}

/** Department codes required per student category (CCA registrar policy). */
/** Matches CCA paper form order; Dean is on the paper but not tracked in the system. */
const CLEARANCE_BY_CATEGORY = {
  undergraduate: ["library", "misso", "extension", "guidance", "saso", "finance", "registrar"],
  graduating: ["library", "misso", "extension", "guidance", "saso", "finance", "registrar"],
  graduate: ["library", "finance", "misso", "guidance", "alumni", "registrar"]
};

const ACTIVE_REQUEST_STATUSES = ["Submitted", "For Verification", "Scheduled"];

function getClearanceDepartmentCodes(category) {
  return CLEARANCE_BY_CATEGORY[category] || CLEARANCE_BY_CATEGORY.undergraduate;
}

function getClearanceDepartmentsForCategory(category) {
  const codes = getClearanceDepartmentCodes(category);
  return DEPARTMENTS.filter((d) => codes.includes(d.code));
}

let db;

async function ensureStorageDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function initializeDatabase() {
  db = await open({ filename: DB_FILE, driver: sqlite3.Database });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL,
      student_id TEXT,
      department_code TEXT,
      is_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      student_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL,
      clearance_status TEXT NOT NULL,
      uploaded_file_path TEXT NOT NULL,
      uploaded_file_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      schedule_date TEXT,
      schedule_time TEXT,
      registrar_remarks TEXT DEFAULT '',
      ocr_state TEXT DEFAULT 'not_run',
      ocr_confidence REAL,
      ocr_raw_text TEXT DEFAULT '',
      ocr_extracted_student_name TEXT DEFAULT '',
      ocr_extracted_student_id TEXT DEFAULT '',
      ocr_extracted_or_number TEXT DEFAULT '',
      ocr_extracted_amount TEXT DEFAULT '',
      ocr_extracted_payment_date TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS clearances (
      student_id TEXT NOT NULL,
      department_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      remarks TEXT DEFAULT '',
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (student_id, department_code)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Registrar and admin are equivalent; canonical role in DB is `registrar`.
  await db.run("UPDATE users SET role = 'registrar' WHERE role = 'admin'");

  await migrateSchema();
}

async function migrateSchema() {
  const userCols = (await db.all("PRAGMA table_info(users)")).map((c) => c.name);
  if (!userCols.includes("student_category")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN student_category TEXT NOT NULL DEFAULT 'undergraduate'"
    );
  }
  if (!userCols.includes("course")) {
    await db.run("ALTER TABLE users ADD COLUMN course TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("section")) {
    await db.run("ALTER TABLE users ADD COLUMN section TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("has_scholarship")) {
    await db.run("ALTER TABLE users ADD COLUMN has_scholarship INTEGER NOT NULL DEFAULT 0");
  }
  if (!userCols.includes("phone")) {
    await db.run("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("notify_email")) {
    await db.run("ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1");
  }
  if (!userCols.includes("notify_sms")) {
    await db.run("ALTER TABLE users ADD COLUMN notify_sms INTEGER NOT NULL DEFAULT 0");
  }
  if (!userCols.includes("clearance_photo_path")) {
    await db.run("ALTER TABLE users ADD COLUMN clearance_photo_path TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("clearance_photo_name")) {
    await db.run("ALTER TABLE users ADD COLUMN clearance_photo_name TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("clearance_photo_updated_at")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_photo_updated_at TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("clearance_ocr_state")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_ocr_state TEXT NOT NULL DEFAULT 'not_run'"
    );
  }
  if (!userCols.includes("clearance_ocr_confidence")) {
    await db.run("ALTER TABLE users ADD COLUMN clearance_ocr_confidence REAL");
  }
  if (!userCols.includes("clearance_ocr_raw_text")) {
    await db.run("ALTER TABLE users ADD COLUMN clearance_ocr_raw_text TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("clearance_ocr_extracted_name")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_ocr_extracted_name TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("clearance_ocr_extracted_id")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_ocr_extracted_id TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("clearance_ocr_extracted_date")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_ocr_extracted_date TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("clearance_ocr_detected_offices")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN clearance_ocr_detected_offices TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("year_level")) {
    await db.run("ALTER TABLE users ADD COLUMN year_level TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("semester")) {
    await db.run("ALTER TABLE users ADD COLUMN semester TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("tuition_payment_status")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN tuition_payment_status TEXT NOT NULL DEFAULT 'Unpaid'"
    );
  }
  if (!userCols.includes("tuition_payment_remarks")) {
    await db.run("ALTER TABLE users ADD COLUMN tuition_payment_remarks TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("tuition_payment_updated_at")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN tuition_payment_updated_at TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("tuition_payment_updated_by")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN tuition_payment_updated_by TEXT NOT NULL DEFAULT ''"
    );
  }
  if (!userCols.includes("tuition_receipt_path")) {
    await db.run("ALTER TABLE users ADD COLUMN tuition_receipt_path TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("tuition_receipt_name")) {
    await db.run("ALTER TABLE users ADD COLUMN tuition_receipt_name TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes("tuition_receipt_updated_at")) {
    await db.run(
      "ALTER TABLE users ADD COLUMN tuition_receipt_updated_at TEXT NOT NULL DEFAULT ''"
    );
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  const reqCols = (await db.all("PRAGMA table_info(requests)")).map((c) => c.name);
  if (!reqCols.includes("batch_id")) {
    await db.run("ALTER TABLE requests ADD COLUMN batch_id TEXT");
  }

  const clearanceCols = (await db.all("PRAGMA table_info(clearances)")).map((c) => c.name);
  if (!clearanceCols.includes("photo_path")) {
    await db.run("ALTER TABLE clearances ADD COLUMN photo_path TEXT NOT NULL DEFAULT ''");
  }
  if (!clearanceCols.includes("photo_name")) {
    await db.run("ALTER TABLE clearances ADD COLUMN photo_name TEXT NOT NULL DEFAULT ''");
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS enrollment_roster (
      student_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      course TEXT NOT NULL DEFAULT '',
      section TEXT NOT NULL DEFAULT '',
      year_level TEXT NOT NULL DEFAULT '',
      semester TEXT NOT NULL DEFAULT '',
      student_category TEXT NOT NULL DEFAULT 'undergraduate',
      academic_term TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL
    );
  `);

  const requestCols = (await db.all("PRAGMA table_info(requests)")).map((c) => c.name);
  if (!requestCols.includes("archived_at")) {
    await db.run("ALTER TABLE requests ADD COLUMN archived_at TEXT");
  }

  await db.run("UPDATE clearances SET status = 'Signed' WHERE status = 'Cleared'");
  await db.run("UPDATE clearances SET status = 'Not Signed' WHERE status = 'Not Cleared'");
  await db.run("UPDATE requests SET clearance_status = 'Signed' WHERE clearance_status = 'Cleared'");
  await db.run(
    "UPDATE requests SET clearance_status = 'Partially Signed' WHERE clearance_status = 'Partially Cleared'"
  );
  await db.run(
    "UPDATE requests SET clearance_status = 'Not Signed' WHERE clearance_status = 'Not Cleared'"
  );

  const students = await db.all(
    "SELECT student_id, student_category FROM users WHERE role = 'student'"
  );
  for (const student of students) {
    await ensureClearanceRows(student.student_id, student.student_category);
  }
}

function mapRequestRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentName: row.student_name,
    studentId: row.student_id,
    documentType: row.document_type,
    purpose: row.purpose,
    status: row.status,
    clearanceStatus: row.clearance_status,
    uploadedFilePath: row.uploaded_file_path,
    uploadedFileName: row.uploaded_file_name,
    batchId: row.batch_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schedule:
      row.schedule_date && row.schedule_time
        ? { date: row.schedule_date, time: row.schedule_time }
        : null,
    registrarRemarks: row.registrar_remarks || "",
    archivedAt: row.archived_at || null,
    ocr: {
      state: row.ocr_state || "not_run",
      confidence:
        row.ocr_confidence === null || row.ocr_confidence === undefined
          ? null
          : Number(row.ocr_confidence),
      rawText: row.ocr_raw_text || "",
      extracted: {
        studentName: row.ocr_extracted_student_name || "",
        studentId: row.ocr_extracted_student_id || "",
        orNumber: row.ocr_extracted_or_number || "",
        amount: row.ocr_extracted_amount || "",
        paymentDate: row.ocr_extracted_payment_date || ""
      }
    }
  };
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    displayName: row.display_name,
    studentId: row.student_id,
    departmentCode: row.department_code,
    isVerified: Boolean(row.is_verified),
    studentCategory: row.student_category || "undergraduate",
    course: row.course || "",
    section: row.section || "",
    yearLevel: row.year_level || "",
    semester: row.semester || "",
    hasScholarship: Boolean(row.has_scholarship),
    phone: row.phone || "",
    notifyEmail: row.notify_email !== 0,
    notifySms: Boolean(row.notify_sms),
    tuitionPaymentStatus: row.tuition_payment_status || "Unpaid",
    tuitionPaymentRemarks: row.tuition_payment_remarks || "",
    tuitionPaymentUpdatedAt: row.tuition_payment_updated_at || "",
    tuitionPaymentUpdatedBy: row.tuition_payment_updated_by || "",
    tuitionReceiptPath: row.tuition_receipt_path || "",
    tuitionReceiptName: row.tuition_receipt_name || "",
    tuitionReceiptUpdatedAt: row.tuition_receipt_updated_at || "",
    createdAt: row.created_at
  };
}

async function listRequests(filter = {}) {
  const conditions = [];
  const params = [];

  if (filter.studentId) {
    conditions.push("r.student_id = ?");
    params.push(filter.studentId);
  }

  const search = typeof filter.search === "string" ? filter.search.trim() : "";
  if (search) {
    const s = `%${search.replace(/%/g, "%%")}%`;
    conditions.push(
      "(r.student_name LIKE ? OR r.student_id LIKE ? OR r.document_type LIKE ? OR r.purpose LIKE ? OR r.id LIKE ? OR IFNULL(r.batch_id,'') LIKE ?)"
    );
    params.push(s, s, s, s, s, s);
  }

  const statusGroup = filter.statusGroup || "all";
  if (statusGroup === "active") {
    conditions.push(`r.status IN (${ACTIVE_REQUEST_STATUSES.map(() => "?").join(", ")})`);
    params.push(...ACTIVE_REQUEST_STATUSES);
  } else if (statusGroup === "completed") {
    conditions.push("r.status IN ('Released', 'Rejected') AND (r.archived_at IS NULL OR r.archived_at = '')");
  } else if (statusGroup === "archived") {
    conditions.push("r.archived_at IS NOT NULL AND r.archived_at != ''");
  }

  const course =
    typeof filter.course === "string" && filter.course.trim() ? filter.course.trim() : "";
  if (course) {
    conditions.push("LOWER(IFNULL(u.course,'')) = LOWER(?)");
    params.push(course);
  }

  const section =
    typeof filter.section === "string" && filter.section.trim() ? filter.section.trim() : "";
  if (section) {
    conditions.push("LOWER(IFNULL(u.section,'')) = LOWER(?)");
    params.push(section);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT r.* FROM requests r
     LEFT JOIN users u ON u.student_id = r.student_id AND u.role = 'student'
     ${where}
     ORDER BY r.created_at DESC`,
    ...params
  );
  return rows.map(mapRequestRow);
}

async function getRequestById(id) {
  const row = await db.get("SELECT * FROM requests WHERE id = ?", id);
  return mapRequestRow(row);
}

async function insertRequest(request) {
  await db.run(
    `INSERT INTO requests (
      id, student_name, student_id, document_type, purpose, status, clearance_status,
      uploaded_file_path, uploaded_file_name, batch_id, created_at, updated_at,
      schedule_date, schedule_time, registrar_remarks,
      ocr_state, ocr_confidence, ocr_raw_text,
      ocr_extracted_student_name, ocr_extracted_student_id, ocr_extracted_or_number,
      ocr_extracted_amount, ocr_extracted_payment_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    request.id,
    request.studentName,
    request.studentId,
    request.documentType,
    request.purpose,
    request.status,
    request.clearanceStatus,
    request.uploadedFilePath || "",
    request.uploadedFileName || "",
    request.batchId || null,
    request.createdAt,
    request.updatedAt,
    request.schedule?.date ?? null,
    request.schedule?.time ?? null,
    request.registrarRemarks ?? "",
    request.ocr?.state ?? "not_run",
    request.ocr?.confidence ?? null,
    request.ocr?.rawText ?? "",
    request.ocr?.extracted?.studentName ?? "",
    request.ocr?.extracted?.studentId ?? "",
    request.ocr?.extracted?.orNumber ?? "",
    request.ocr?.extracted?.amount ?? "",
    request.ocr?.extracted?.paymentDate ?? ""
  );
}

async function updateRequest(request) {
  await db.run(
    `UPDATE requests
     SET status = ?, clearance_status = ?, updated_at = ?,
         schedule_date = ?, schedule_time = ?, registrar_remarks = ?,
         ocr_state = ?, ocr_confidence = ?, ocr_raw_text = ?,
         ocr_extracted_student_name = ?, ocr_extracted_student_id = ?,
         ocr_extracted_or_number = ?, ocr_extracted_amount = ?, ocr_extracted_payment_date = ?
     WHERE id = ?`,
    request.status,
    request.clearanceStatus,
    request.updatedAt,
    request.schedule?.date ?? null,
    request.schedule?.time ?? null,
    request.registrarRemarks ?? "",
    request.ocr?.state ?? "not_run",
    request.ocr?.confidence ?? null,
    request.ocr?.rawText ?? "",
    request.ocr?.extracted?.studentName ?? "",
    request.ocr?.extracted?.studentId ?? "",
    request.ocr?.extracted?.orNumber ?? "",
    request.ocr?.extracted?.amount ?? "",
    request.ocr?.extracted?.paymentDate ?? "",
    request.id
  );
}

async function countScheduleBookings(date, time) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM requests
     WHERE schedule_date = ? AND schedule_time = ?
     AND status IN ('Scheduled', 'Released')
     AND (archived_at IS NULL OR archived_at = '')`,
    date,
    time
  );
  return Number(row?.n || 0);
}

async function archiveRequest(id) {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE requests SET archived_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('Released', 'Rejected')`,
    now,
    now,
    id
  );
}

async function unarchiveRequest(id) {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE requests SET archived_at = NULL, updated_at = ? WHERE id = ?`,
    now,
    id
  );
}

async function archiveOldRequests(daysOld = 90) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const result = await db.run(
    `UPDATE requests SET archived_at = ?, updated_at = ?
     WHERE status IN ('Released', 'Rejected')
       AND (archived_at IS NULL OR archived_at = '')
       AND updated_at < ?`,
    now,
    now,
    cutoff
  );
  return Number(result.changes || 0);
}

async function upsertRosterRows(rows) {
  const now = new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    await db.run(
      `INSERT INTO enrollment_roster (
         student_id, display_name, email, course, section, year_level, semester,
         student_category, academic_term, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id) DO UPDATE SET
         display_name = excluded.display_name,
         email = excluded.email,
         course = excluded.course,
         section = excluded.section,
         year_level = excluded.year_level,
         semester = excluded.semester,
         student_category = excluded.student_category,
         academic_term = excluded.academic_term,
         imported_at = excluded.imported_at`,
      row.studentId,
      row.displayName,
      (row.email || "").toLowerCase(),
      row.course || "",
      row.section || "",
      row.yearLevel || "",
      row.semester || "",
      row.studentCategory || "undergraduate",
      row.academicTerm || "",
      now
    );
    count += 1;
  }
  return count;
}

async function getRosterByStudentId(studentId) {
  const row = await db.get("SELECT * FROM enrollment_roster WHERE student_id = ?", studentId);
  if (!row) return null;
  return {
    studentId: row.student_id,
    displayName: row.display_name,
    email: row.email,
    course: row.course,
    section: row.section,
    yearLevel: row.year_level,
    semester: row.semester,
    studentCategory: row.student_category,
    academicTerm: row.academic_term,
    importedAt: row.imported_at
  };
}

async function listRoster({ search = "", limit = 200 } = {}) {
  const params = [];
  let sql = "SELECT * FROM enrollment_roster";
  const q = search.trim();
  if (q) {
    const like = `%${q.replace(/%/g, "%%")}%`;
    sql += " WHERE student_id LIKE ? OR display_name LIKE ? OR email LIKE ?";
    params.push(like, like, like);
  }
  sql += " ORDER BY display_name LIMIT ?";
  params.push(limit);
  const rows = await db.all(sql, ...params);
  return rows.map((row) => ({
    studentId: row.student_id,
    displayName: row.display_name,
    email: row.email,
    course: row.course,
    section: row.section,
    yearLevel: row.year_level,
    semester: row.semester,
    studentCategory: row.student_category,
    academicTerm: row.academic_term,
    importedAt: row.imported_at
  }));
}

async function countRoster() {
  const row = await db.get("SELECT COUNT(*) AS n FROM enrollment_roster");
  return Number(row?.n || 0);
}

async function getUserByEmail(email) {
  const row = await db.get("SELECT * FROM users WHERE email = ?", email.toLowerCase());
  return mapUserRow(row);
}

async function getUserById(id) {
  const row = await db.get("SELECT * FROM users WHERE id = ?", id);
  return mapUserRow(row);
}

async function getUserByStudentId(studentId) {
  const row = await db.get(
    "SELECT * FROM users WHERE student_id = ? AND role = 'student'",
    studentId
  );
  return mapUserRow(row);
}

async function listUsers(filter = {}) {
  const role = filter.role || null;
  const search =
    typeof filter.search === "string" && filter.search.trim()
      ? filter.search.trim().toLowerCase()
      : "";
  const course =
    typeof filter.course === "string" && filter.course.trim() ? filter.course.trim() : "";
  const section =
    typeof filter.section === "string" && filter.section.trim() ? filter.section.trim() : "";
  const conditions = [];
  const params = [];
  if (role) {
    conditions.push("role = ?");
    params.push(role);
  }
  if (course) {
    conditions.push("LOWER(IFNULL(course,'')) = LOWER(?)");
    params.push(course);
  }
  if (section) {
    conditions.push("LOWER(IFNULL(section,'')) = LOWER(?)");
    params.push(section);
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      "(LOWER(email) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(IFNULL(student_id,'')) LIKE ? OR LOWER(IFNULL(department_code,'')) LIKE ? OR LOWER(role) LIKE ? OR LOWER(IFNULL(course,'')) LIKE ? OR LOWER(IFNULL(section,'')) LIKE ?)"
    );
    params.push(like, like, like, like, like, like, like);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT * FROM users ${where} ORDER BY created_at DESC`,
    ...params
  );
  return rows.map(mapUserRow);
}

async function insertUser(user) {
  await db.run(
    `INSERT INTO users (
      id, email, password_hash, role, display_name, student_id, department_code,
      is_verified, student_category, course, section, year_level, semester,
      has_scholarship, phone, notify_email, notify_sms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    user.email.toLowerCase(),
    user.passwordHash,
    user.role,
    user.displayName,
    user.studentId || null,
    user.departmentCode || null,
    user.isVerified ? 1 : 0,
    user.studentCategory || "undergraduate",
    user.course || "",
    user.section || "",
    user.yearLevel || "",
    user.semester || "",
    user.hasScholarship ? 1 : 0,
    user.phone || "",
    user.notifyEmail === false ? 0 : 1,
    user.notifySms ? 1 : 0,
    user.createdAt
  );
}

async function setUserVerified(id, isVerified) {
  await db.run(
    "UPDATE users SET is_verified = ? WHERE id = ?",
    isVerified ? 1 : 0,
    id
  );
}

async function updateUserProfile(id, { displayName, phone, course, section, yearLevel, semester }) {
  await db.run(
    `UPDATE users SET display_name = ?, phone = ?, course = ?, section = ?,
      year_level = ?, semester = ? WHERE id = ?`,
    displayName.trim(),
    phone || "",
    (course || "").trim(),
    (section || "").trim(),
    (yearLevel || "").trim(),
    (semester || "").trim(),
    id
  );
}

async function updateUserAdmin(id, fields) {
  await db.run(
    `UPDATE users SET
      display_name = ?, email = ?, student_category = ?, course = ?, section = ?,
      year_level = ?, semester = ?,
      has_scholarship = ?, is_verified = ?, phone = ?
     WHERE id = ?`,
    fields.displayName.trim(),
    fields.email.trim().toLowerCase(),
    fields.studentCategory || "undergraduate",
    (fields.course || "").trim(),
    (fields.section || "").trim(),
    (fields.yearLevel || "").trim(),
    (fields.semester || "").trim(),
    fields.hasScholarship ? 1 : 0,
    fields.isVerified ? 1 : 0,
    fields.phone || "",
    id
  );
}

async function listUnverifiedStudents() {
  const rows = await db.all(
    `SELECT * FROM users
     WHERE role = 'student' AND is_verified = 0
     ORDER BY created_at DESC`
  );
  return rows.map(mapUserRow);
}

async function countUnverifiedStudents() {
  const row = await db.get(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND is_verified = 0"
  );
  return Number(row?.n || 0);
}

async function createPasswordResetToken(userId, token, expiresAt) {
  const now = new Date().toISOString();
  await db.run("DELETE FROM password_reset_tokens WHERE user_id = ?", userId);
  await db.run(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
    userId,
    token,
    expiresAt,
    now
  );
}

async function getValidPasswordResetToken(token) {
  const row = await db.get(
    `SELECT t.*, u.email, u.display_name
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token = ? AND t.used_at IS NULL AND t.expires_at > ?`,
    token,
    new Date().toISOString()
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    token: row.token,
    email: row.email,
    displayName: row.display_name,
    expiresAt: row.expires_at
  };
}

async function markPasswordResetTokenUsed(token) {
  await db.run(
    "UPDATE password_reset_tokens SET used_at = ? WHERE token = ?",
    new Date().toISOString(),
    token
  );
}

async function updateClearancePhoto({ studentId, departmentCode, photoPath, photoName }) {
  await db.run(
    `UPDATE clearances SET photo_path = ?, photo_name = ?, updated_at = ?
     WHERE student_id = ? AND department_code = ?`,
    photoPath,
    photoName,
    new Date().toISOString(),
    studentId,
    departmentCode
  );
}

function mapClearanceUploadRow(row) {
  if (!row) return null;
  let detectedOffices = [];
  if (row.clearance_ocr_detected_offices) {
    try {
      detectedOffices = JSON.parse(row.clearance_ocr_detected_offices);
    } catch {
      detectedOffices = [];
    }
  }
  return {
    photoPath: row.clearance_photo_path || "",
    photoName: row.clearance_photo_name || "",
    photoUpdatedAt: row.clearance_photo_updated_at || "",
    ocr: {
      state: row.clearance_ocr_state || "not_run",
      confidence: row.clearance_ocr_confidence ?? null,
      rawText: row.clearance_ocr_raw_text || "",
      extracted: {
        studentName: row.clearance_ocr_extracted_name || "",
        studentId: row.clearance_ocr_extracted_id || "",
        clearanceDate: row.clearance_ocr_extracted_date || "",
        detectedOffices
      }
    }
  };
}

async function getStudentClearanceUpload(studentId) {
  const row = await db.get(
    `SELECT clearance_photo_path, clearance_photo_name, clearance_photo_updated_at,
            clearance_ocr_state, clearance_ocr_confidence, clearance_ocr_raw_text,
            clearance_ocr_extracted_name, clearance_ocr_extracted_id,
            clearance_ocr_extracted_date, clearance_ocr_detected_offices
     FROM users WHERE student_id = ? AND role = 'student'`,
    studentId
  );
  return mapClearanceUploadRow(row);
}

async function updateStudentClearanceUpload(studentId, { photoPath, photoName, ocr }) {
  const now = new Date().toISOString();
  const detectedJson = JSON.stringify(ocr?.extracted?.detectedOffices || []);
  await db.run(
    `UPDATE users SET
       clearance_photo_path = ?,
       clearance_photo_name = ?,
       clearance_photo_updated_at = ?,
       clearance_ocr_state = ?,
       clearance_ocr_confidence = ?,
       clearance_ocr_raw_text = ?,
       clearance_ocr_extracted_name = ?,
       clearance_ocr_extracted_id = ?,
       clearance_ocr_extracted_date = ?,
       clearance_ocr_detected_offices = ?
     WHERE student_id = ? AND role = 'student'`,
    photoPath,
    photoName,
    now,
    ocr?.state || "not_run",
    ocr?.confidence ?? null,
    (ocr?.rawText || "").slice(0, 4000),
    ocr?.extracted?.studentName || "",
    ocr?.extracted?.studentId || "",
    ocr?.extracted?.clearanceDate || "",
    detectedJson,
    studentId
  );
}

async function updateTuitionPayment({ studentId, status, remarks, updatedBy }) {
  const allowed = ["Unpaid", "For Verification", "Paid", "Partial", "Scholarship"];
  if (!allowed.includes(status)) {
    throw new Error("Invalid tuition payment status.");
  }
  await db.run(
    `UPDATE users SET
       tuition_payment_status = ?,
       tuition_payment_remarks = ?,
       tuition_payment_updated_at = ?,
       tuition_payment_updated_by = ?
     WHERE student_id = ? AND role = 'student'`,
    status,
    remarks || "",
    new Date().toISOString(),
    updatedBy || "",
    studentId
  );
}

async function updateStudentTuitionReceipt(studentId, { photoPath, photoName, updatedBy }) {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE users SET
       tuition_receipt_path = ?,
       tuition_receipt_name = ?,
       tuition_receipt_updated_at = ?,
       tuition_payment_status = 'For Verification',
       tuition_payment_updated_at = ?,
       tuition_payment_updated_by = ?
     WHERE student_id = ? AND role = 'student' AND has_scholarship = 0`,
    photoPath,
    photoName,
    now,
    now,
    updatedBy || "",
    studentId
  );
}

async function syncTuitionScholarshipStatus(studentId, hasScholarship, updatedBy) {
  if (hasScholarship) {
    await updateTuitionPayment({
      studentId,
      status: "Scholarship",
      remarks: "Scholarship assigned by registrar office",
      updatedBy
    });
  } else {
    const user = await getUserByStudentId(studentId);
    if (user && user.tuitionPaymentStatus === "Scholarship") {
      await updateTuitionPayment({
        studentId,
        status: user.tuitionReceiptPath ? "For Verification" : "Unpaid",
        remarks: "",
        updatedBy
      });
    }
  }
}

async function updateUserPassword(id, passwordHash) {
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, id);
}

async function updateUserNotificationPrefs(id, { phone, notifyEmail, notifySms }) {
  await db.run(
    "UPDATE users SET phone = ?, notify_email = ?, notify_sms = ? WHERE id = ?",
    phone || "",
    notifyEmail ? 1 : 0,
    notifySms ? 1 : 0,
    id
  );
}

async function deleteUser(id) {
  await db.run("DELETE FROM users WHERE id = ?", id);
}

async function getStudentCategory(studentId) {
  const row = await db.get(
    "SELECT student_category FROM users WHERE student_id = ? AND role = 'student'",
    studentId
  );
  return row?.student_category || "undergraduate";
}

async function ensureClearanceRows(studentId, category) {
  const cat = category || (await getStudentCategory(studentId));
  const nowIso = new Date().toISOString();
  for (const code of getClearanceDepartmentCodes(cat)) {
    await db.run(
      `INSERT OR IGNORE INTO clearances (student_id, department_code, status, remarks, updated_at)
       VALUES (?, ?, 'Pending', '', ?)`,
      studentId,
      code,
      nowIso
    );
  }
}

async function listClearancesForStudent(studentId) {
  const category = await getStudentCategory(studentId);
  await ensureClearanceRows(studentId, category);
  const rows = await db.all(
    "SELECT * FROM clearances WHERE student_id = ?",
    studentId
  );
  return getClearanceDepartmentsForCategory(category).map((dept) => {
    const row = rows.find((r) => r.department_code === dept.code);
    return {
      departmentCode: dept.code,
      departmentName: dept.name,
      status: row?.status || "Pending",
      remarks: row?.remarks || "",
      photoPath: row?.photo_path || "",
      photoName: row?.photo_name || "",
      updatedBy: row?.updated_by || null,
      updatedAt: row?.updated_at || null
    };
  });
}

async function listClearancesForDepartment(departmentCode) {
  const rows = await db.all(
    `SELECT c.*, u.display_name, u.email
     FROM clearances c
     LEFT JOIN users u ON u.student_id = c.student_id AND u.role = 'student'
     WHERE c.department_code = ?
     ORDER BY c.updated_at DESC`,
    departmentCode
  );
  return rows.map((row) => ({
    studentId: row.student_id,
    displayName: row.display_name || "(Unknown student)",
    email: row.email || "",
    status: row.status,
    remarks: row.remarks || "",
    photoPath: row.photo_path || "",
    photoName: row.photo_name || "",
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  }));
}

async function updateClearance({ studentId, departmentCode, status, remarks, updatedBy }) {
  const nowIso = new Date().toISOString();
  await db.run(
    `INSERT INTO clearances (student_id, department_code, status, remarks, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(student_id, department_code) DO UPDATE SET
       status = excluded.status,
       remarks = excluded.remarks,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
    studentId,
    departmentCode,
    status,
    remarks || "",
    updatedBy || null,
    nowIso
  );
}

async function applyDetectedClearanceOffices(studentId, officeCodes, updatedBy) {
  const category = await getStudentCategory(studentId);
  const validCodes = getClearanceDepartmentCodes(category);
  const unique = [...new Set(officeCodes || [])].filter((code) => validCodes.includes(code));
  for (const code of unique) {
    await updateClearance({
      studentId,
      departmentCode: code,
      status: "Signed",
      remarks: "Marked Signed from clearance form OCR (assistive — confirm with departments).",
      updatedBy
    });
  }
  return unique;
}

async function computeStudentClearanceSummary(studentId) {
  const list = await listClearancesForStudent(studentId);
  const total = list.length;
  const signed = list.filter((c) => c.status === "Signed" || c.status === "Cleared").length;
  const denied = list.filter((c) => c.status === "Not Signed" || c.status === "Not Cleared").length;

  if (denied > 0) return "Not Signed";
  if (signed === total) return "Signed";
  if (signed > 0) return "Partially Signed";
  return "Pending";
}

async function listStudentsClearanceOverview(filter = {}) {
  const search = typeof filter === "string" ? filter : filter.search || "";
  const course =
    typeof filter === "object" && typeof filter.course === "string" ? filter.course.trim() : "";
  const section =
    typeof filter === "object" && typeof filter.section === "string" ? filter.section.trim() : "";

  const n = search.trim();
  let sql = `
    SELECT u.student_id AS student_id, u.display_name AS display_name, u.email AS email,
      u.student_category AS student_category, u.course AS course, u.section AS section
    FROM users u
    WHERE u.role = 'student'
  `;
  const params = [];
  if (n) {
    const like = `%${n.replace(/%/g, "%%")}%`;
    sql += " AND (u.display_name LIKE ? OR u.student_id LIKE ? OR u.email LIKE ?)";
    params.push(like, like, like);
  }
  if (course) {
    sql += " AND LOWER(IFNULL(u.course,'')) = LOWER(?)";
    params.push(course);
  }
  if (section) {
    sql += " AND LOWER(IFNULL(u.section,'')) = LOWER(?)";
    params.push(section);
  }
  sql += " ORDER BY u.display_name";
  const rows = await db.all(sql, ...params);

  const results = [];
  for (const r of rows) {
    const category = r.student_category || "undergraduate";
    const requiredCodes = getClearanceDepartmentCodes(category);
    const clearanceRows = await db.all(
      "SELECT department_code, status FROM clearances WHERE student_id = ?",
      r.student_id
    );
    const applicable = clearanceRows.filter((c) => requiredCodes.includes(c.department_code));
    const nSigned = applicable.filter(
      (c) => c.status === "Signed" || c.status === "Cleared"
    ).length;
    const nDenied = applicable.filter(
      (c) => c.status === "Not Signed" || c.status === "Not Cleared"
    ).length;
    const nRequired = requiredCodes.length;

    let clearanceSummary;
    if (nDenied > 0) clearanceSummary = "Not Signed";
    else if (nSigned === nRequired && applicable.length >= nRequired) clearanceSummary = "Signed";
    else if (nSigned > 0) clearanceSummary = "Partially Signed";
    else clearanceSummary = "Pending";

    results.push({
      studentId: r.student_id,
      displayName: r.display_name,
      email: r.email,
      studentCategory: category,
      course: r.course || "",
      section: r.section || "",
      clearanceSummary,
      nSigned,
      nRequired,
      nTracked: applicable.length
    });
  }
  return results;
}

async function listDistinctCourses() {
  const rows = await db.all(
    "SELECT DISTINCT course FROM users WHERE role = 'student' AND TRIM(IFNULL(course,'')) != '' ORDER BY course"
  );
  return rows.map((r) => r.course);
}

async function listDistinctSections() {
  const rows = await db.all(
    "SELECT DISTINCT section FROM users WHERE role = 'student' AND TRIM(IFNULL(section,'')) != '' ORDER BY section"
  );
  return rows.map((r) => r.section);
}

async function countReleasedRequestsForStudent(studentId) {
  const row = await db.get(
    "SELECT COUNT(*) AS n FROM requests WHERE student_id = ? AND status = 'Released'",
    studentId
  );
  return Number(row?.n || 0);
}

async function writeAudit(actorEmail, action, details = "") {
  await db.run(
    "INSERT INTO audit_log (actor_email, action, details, at) VALUES (?, ?, ?, ?)",
    actorEmail,
    action,
    details,
    new Date().toISOString()
  );
}

async function listAudit(limit = 50) {
  const rows = await db.all(
    "SELECT * FROM audit_log ORDER BY at DESC LIMIT ?",
    limit
  );
  return rows;
}

async function createAnnouncement({ title, message, createdBy }) {
  const nowIso = new Date().toISOString();
  const result = await db.run(
    "INSERT INTO announcements (title, message, created_by, created_at) VALUES (?, ?, ?, ?)",
    title,
    message,
    createdBy,
    nowIso
  );
  return { id: Number(result.lastID), title, message, createdBy, createdAt: nowIso };
}

async function listAnnouncements(limit = 50) {
  const rows = await db.all(
    "SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?",
    limit
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    message: r.message,
    createdBy: r.created_by,
    createdAt: r.created_at
  }));
}

async function createNotification({ userId, title, message, link = null }) {
  const nowIso = new Date().toISOString();
  const result = await db.run(
    "INSERT INTO notifications (user_id, title, message, link, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    userId,
    title,
    message,
    link,
    nowIso
  );
  return { id: Number(result.lastID), userId, title, message, link, isRead: false, createdAt: nowIso };
}

async function createNotificationForAllUsers({ title, message, link = null, excludeUserId = null }) {
  const users = await listUsers();
  for (const u of users) {
    if (excludeUserId && u.id === excludeUserId) continue;
    await createNotification({ userId: u.id, title, message, link });
  }
}

async function listNotificationsForUser(userId, limit = 30) {
  const rows = await db.all(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    limit
  );
  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    title: r.title,
    message: r.message,
    link: r.link || null,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at
  }));
}

async function countUnreadNotifications(userId) {
  const row = await db.get(
    "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0",
    userId
  );
  return Number(row?.n || 0);
}

async function markNotificationRead(userId, notificationId) {
  await db.run(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    notificationId,
    userId
  );
}

async function logNotificationDelivery({ userId, channel, title, status, detail = "" }) {
  await db.run(
    `INSERT INTO notification_deliveries (user_id, channel, title, status, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    channel,
    title,
    status,
    detail,
    new Date().toISOString()
  );
}

async function listNotificationDeliveries(userId, limit = 12) {
  const rows = await db.all(
    "SELECT * FROM notification_deliveries WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    userId,
    limit
  );
  return rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    channel: r.channel,
    title: r.title,
    status: r.status,
    detail: r.detail || "",
    createdAt: r.created_at
  }));
}

async function getDashboardStats() {
  const total = (await db.get("SELECT COUNT(*) AS n FROM requests")).n;
  const released = (await db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'Released'")).n;
  const scheduled = (await db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'Scheduled'")).n;
  const forVerification = (await db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'For Verification'")).n;
  const submitted = (await db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'Submitted'")).n;
  const rejected = (await db.get("SELECT COUNT(*) AS n FROM requests WHERE status = 'Rejected'")).n;

  const byDocType = await db.all(
    "SELECT document_type, COUNT(*) AS n FROM requests GROUP BY document_type ORDER BY n DESC"
  );
  const byMonth = await db.all(
    `SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS n
     FROM requests GROUP BY month ORDER BY month DESC LIMIT 12`
  );

  const users = (await db.get("SELECT COUNT(*) AS n FROM users")).n;
  const students = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'student'")).n;
  const verified = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND is_verified = 1")).n;

  return {
    totalRequests: Number(total),
    released: Number(released),
    scheduled: Number(scheduled),
    forVerification: Number(forVerification),
    submitted: Number(submitted),
    rejected: Number(rejected),
    byDocType: byDocType.map((r) => ({ documentType: r.document_type, count: Number(r.n) })),
    byMonth: byMonth.map((r) => ({ month: r.month, count: Number(r.n) })).reverse(),
    totalUsers: Number(users),
    totalStudents: Number(students),
    verifiedStudents: Number(verified)
  };
}

function getDb() {
  return db;
}

module.exports = {
  DEPARTMENTS,
  STUDENT_CATEGORIES,
  YEAR_LEVELS,
  SEMESTERS,
  CCA_COURSE_GROUPS,
  getAllCcaCourses,
  isValidCcaCourse,
  normalizeCcaCourse,
  listCourseFilterOptions,
  listSectionSuggestions,
  CLEARANCE_BY_CATEGORY,
  ACTIVE_REQUEST_STATUSES,
  getClearanceDepartmentCodes,
  getClearanceDepartmentsForCategory,
  ROOT_DIR,
  DATA_DIR,
  DB_FILE,
  UPLOADS_DIR,
  ensureStorageDirs,
  initializeDatabase,
  listRequests,
  listStudentsClearanceOverview,
  listDistinctCourses,
  listDistinctSections,
  getStudentCategory,
  countReleasedRequestsForStudent,
  getRequestById,
  insertRequest,
  updateRequest,
  countScheduleBookings,
  getUserByEmail,
  getUserById,
  getUserByStudentId,
  listUsers,
  insertUser,
  setUserVerified,
  updateUserProfile,
  updateUserAdmin,
  listUnverifiedStudents,
  countUnverifiedStudents,
  createPasswordResetToken,
  getValidPasswordResetToken,
  markPasswordResetTokenUsed,
  updateClearancePhoto,
  getStudentClearanceUpload,
  updateStudentClearanceUpload,
  updateTuitionPayment,
  updateStudentTuitionReceipt,
  syncTuitionScholarshipStatus,
  updateUserPassword,
  updateUserNotificationPrefs,
  deleteUser,
  ensureClearanceRows,
  listClearancesForStudent,
  listClearancesForDepartment,
  updateClearance,
  applyDetectedClearanceOffices,
  archiveRequest,
  unarchiveRequest,
  archiveOldRequests,
  upsertRosterRows,
  getRosterByStudentId,
  listRoster,
  countRoster,
  computeStudentClearanceSummary,
  writeAudit,
  listAudit,
  getDashboardStats,
  createAnnouncement,
  listAnnouncements,
  createNotification,
  createNotificationForAllUsers,
  listNotificationsForUser,
  countUnreadNotifications,
  markNotificationRead,
  logNotificationDelivery,
  listNotificationDeliveries,
  getDb
};
