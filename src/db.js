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
  { code: "finance", name: "Budget and Finance Office" },
  { code: "misso", name: "Multimedia and Information Systems and Service Office (MISSO)" },
  { code: "saso", name: "Student Affairs and Service Office (SASO)" },
  { code: "guidance", name: "Guidance Office" },
  { code: "extension", name: "Community Extension Office (NSTP)" }
];

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
  `);

  // Registrar and admin are equivalent; canonical role in DB is `registrar`.
  await db.run("UPDATE users SET role = 'registrar' WHERE role = 'admin'");
  await db.run("UPDATE users SET is_verified = 1 WHERE role = 'student'");
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    schedule:
      row.schedule_date && row.schedule_time
        ? { date: row.schedule_date, time: row.schedule_time }
        : null,
    registrarRemarks: row.registrar_remarks || "",
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
    createdAt: row.created_at
  };
}

async function listRequests(filter = {}) {
  if (filter.studentId) {
    const rows = await db.all(
      "SELECT * FROM requests WHERE student_id = ? ORDER BY created_at DESC",
      filter.studentId
    );
    return rows.map(mapRequestRow);
  }
  const search = typeof filter.search === "string" ? filter.search.trim() : "";
  if (search) {
    const s = `%${search.replace(/%/g, "%%")}%`;
    const rows = await db.all(
      `SELECT * FROM requests WHERE
        student_name LIKE ? OR student_id LIKE ? OR document_type LIKE ? OR purpose LIKE ? OR id LIKE ?
        ORDER BY created_at DESC`,
      s,
      s,
      s,
      s,
      s
    );
    return rows.map(mapRequestRow);
  }
  const rows = await db.all("SELECT * FROM requests ORDER BY created_at DESC");
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
      uploaded_file_path, uploaded_file_name, created_at, updated_at,
      schedule_date, schedule_time, registrar_remarks,
      ocr_state, ocr_confidence, ocr_raw_text,
      ocr_extracted_student_name, ocr_extracted_student_id, ocr_extracted_or_number,
      ocr_extracted_amount, ocr_extracted_payment_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    request.id,
    request.studentName,
    request.studentId,
    request.documentType,
    request.purpose,
    request.status,
    request.clearanceStatus,
    request.uploadedFilePath,
    request.uploadedFileName,
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
     AND status IN ('Scheduled', 'Released')`,
    date,
    time
  );
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
  const conditions = [];
  const params = [];
  if (role) {
    conditions.push("role = ?");
    params.push(role);
  }
  if (search) {
    const like = `%${search}%`;
    conditions.push(
      "(LOWER(email) LIKE ? OR LOWER(display_name) LIKE ? OR LOWER(IFNULL(student_id,'')) LIKE ? OR LOWER(IFNULL(department_code,'')) LIKE ? OR LOWER(role) LIKE ?)"
    );
    params.push(like, like, like, like, like);
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
    `INSERT INTO users (id, email, password_hash, role, display_name, student_id, department_code, is_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    user.id,
    user.email.toLowerCase(),
    user.passwordHash,
    user.role,
    user.displayName,
    user.studentId || null,
    user.departmentCode || null,
    user.isVerified ? 1 : 0,
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

async function updateUserPassword(id, passwordHash) {
  await db.run("UPDATE users SET password_hash = ? WHERE id = ?", passwordHash, id);
}

async function deleteUser(id) {
  await db.run("DELETE FROM users WHERE id = ?", id);
}

async function ensureClearanceRows(studentId) {
  const nowIso = new Date().toISOString();
  for (const dept of DEPARTMENTS) {
    await db.run(
      `INSERT OR IGNORE INTO clearances (student_id, department_code, status, remarks, updated_at)
       VALUES (?, ?, 'Pending', '', ?)`,
      studentId,
      dept.code,
      nowIso
    );
  }
}

async function listClearancesForStudent(studentId) {
  await ensureClearanceRows(studentId);
  const rows = await db.all(
    "SELECT * FROM clearances WHERE student_id = ?",
    studentId
  );
  return DEPARTMENTS.map((dept) => {
    const row = rows.find((r) => r.department_code === dept.code);
    return {
      departmentCode: dept.code,
      departmentName: dept.name,
      status: row?.status || "Pending",
      remarks: row?.remarks || "",
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

async function computeStudentClearanceSummary(studentId) {
  const list = await listClearancesForStudent(studentId);
  const total = list.length;
  const cleared = list.filter((c) => c.status === "Cleared").length;
  const denied = list.filter((c) => c.status === "Not Cleared").length;

  if (denied > 0) return "Not Cleared";
  if (cleared === total) return "Cleared";
  if (cleared > 0) return "Partially Cleared";
  return "Pending";
}

async function listStudentsClearanceOverview(search = "") {
  const n = search.trim();
  let sql = `
    SELECT u.student_id AS student_id, u.display_name AS display_name, u.email AS email,
      SUM(CASE WHEN COALESCE(c.status, '') = 'Cleared' THEN 1 ELSE 0 END) AS n_cleared,
      SUM(CASE WHEN c.status = 'Not Cleared' THEN 1 ELSE 0 END) AS n_denied,
      COUNT(c.department_code) AS n_tracked
    FROM users u
    LEFT JOIN clearances c ON c.student_id = u.student_id
    WHERE u.role = 'student'
  `;
  const params = [];
  if (n) {
    const like = `%${n.replace(/%/g, "%%")}%`;
    sql += " AND (u.display_name LIKE ? OR u.student_id LIKE ? OR u.email LIKE ?)";
    params.push(like, like, like);
  }
  sql += " GROUP BY u.student_id, u.display_name, u.email ORDER BY u.display_name";
  const rows = await db.all(sql, ...params);
  const totalDepts = DEPARTMENTS.length;
  return rows.map((r) => {
    let clearanceSummary;
    if (Number(r.n_denied) > 0) clearanceSummary = "Not Cleared";
    else if (Number(r.n_cleared) === totalDepts && Number(r.n_tracked) >= totalDepts) {
      clearanceSummary = "Cleared";
    } else if (Number(r.n_cleared) > 0) clearanceSummary = "Partially Cleared";
    else clearanceSummary = "Pending";
    return {
      studentId: r.student_id,
      displayName: r.display_name,
      email: r.email,
      clearanceSummary,
      nCleared: Number(r.n_cleared),
      nTracked: Number(r.n_tracked)
    };
  });
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
  ROOT_DIR,
  DATA_DIR,
  DB_FILE,
  UPLOADS_DIR,
  ensureStorageDirs,
  initializeDatabase,
  listRequests,
  listStudentsClearanceOverview,
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
  updateUserPassword,
  deleteUser,
  ensureClearanceRows,
  listClearancesForStudent,
  listClearancesForDepartment,
  updateClearance,
  computeStudentClearanceSummary,
  writeAudit,
  listAudit,
  getDashboardStats,
  getDb
};
