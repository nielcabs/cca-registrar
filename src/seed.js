const path = require("path");
const fs = require("fs/promises");
const bcrypt = require("bcryptjs");
const dayjs = require("dayjs");
const { v4: uuidv4 } = require("uuid");

const {
  DEPARTMENTS,
  ROOT_DIR,
  UPLOADS_DIR,
  getDb,
  getUserByEmail,
  insertUser,
  ensureClearanceRows,
  updateClearance
} = require("./db");

async function ensureSampleProofImage() {
  const copiedName = "sample-proof.jfif";
  const copiedPath = path.join(UPLOADS_DIR, copiedName);

  try {
    await fs.access(copiedPath);
    return `/uploads/${copiedName}`;
  } catch (_error) {
    // continue
  }

  const sourceFile = path.join(ROOT_DIR, "340f0359-1aca-4425-8b64-7065edc931ec.jfif");
  try {
    await fs.copyFile(sourceFile, copiedPath);
    return `/uploads/${copiedName}`;
  } catch (_error) {
    // fall back
  }

  const pngName = "sample-proof.png";
  const pngPath = path.join(UPLOADS_DIR, pngName);
  const onePixelPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBgIhX4t8AAAAASUVORK5CYII=";
  await fs.writeFile(pngPath, Buffer.from(onePixelPng, "base64"));
  return `/uploads/${pngName}`;
}

async function seedUsers() {
  const password = await bcrypt.hash("cca123", 10);
  const nowIso = new Date().toISOString();

  const accounts = [
    {
      id: "admin-001",
      email: "admin@cca.edu.ph",
      passwordHash: password,
      role: "registrar",
      displayName: "CCA Registrar",
      isVerified: true,
      createdAt: nowIso
    },
    {
      id: "vpaa-001",
      email: "vpaa@cca.edu.ph",
      passwordHash: password,
      role: "vpaa",
      displayName: "VPAA Office",
      isVerified: true,
      createdAt: nowIso
    },
    {
      id: "student-001",
      email: "juan@cca.edu.ph",
      passwordHash: password,
      role: "student",
      displayName: "Juan Dela Cruz",
      studentId: "20230001",
      studentCategory: "undergraduate",
      course: "BS Information Technology",
      section: "A",
      hasScholarship: false,
      isVerified: true,
      createdAt: nowIso
    },
    {
      id: "student-002",
      email: "maria@cca.edu.ph",
      passwordHash: password,
      role: "student",
      displayName: "Maria Santos",
      studentId: "20230002",
      studentCategory: "graduating",
      course: "BS Computer Science",
      section: "B",
      hasScholarship: true,
      isVerified: true,
      createdAt: nowIso
    },
    {
      id: "student-003",
      email: "pedro@cca.edu.ph",
      passwordHash: password,
      role: "student",
      displayName: "Pedro Reyes",
      studentId: "20230003",
      studentCategory: "graduate",
      course: "BS Business Administration",
      section: "C",
      hasScholarship: false,
      isVerified: true,
      createdAt: nowIso
    }
  ];

  for (const dept of DEPARTMENTS) {
    accounts.push({
      id: `dept-${dept.code}`,
      email: `${dept.code}@cca.edu.ph`,
      passwordHash: password,
      role: "department",
      displayName: `${dept.name} Officer`,
      departmentCode: dept.code,
      isVerified: true,
      createdAt: nowIso
    });
  }

  for (const account of accounts) {
    const existing = await getUserByEmail(account.email);
    if (!existing) {
      await insertUser(account);
    }
  }
}

async function seedSampleRequests() {
  const db = getDb();
  const sampleFilePath = await ensureSampleProofImage();
  const now = Date.now();

  const samples = [
    {
      id: "DEMO1001",
      student_name: "Juan Dela Cruz",
      student_id: "20230001",
      document_type: "Transcript of Records",
      purpose: "Employment requirement",
      status: "For Verification",
      clearance_status: "Partially Cleared",
      uploaded_file_path: sampleFilePath,
      uploaded_file_name: path.basename(sampleFilePath),
      batch_id: null,
      created_at: new Date(now - 1000 * 60 * 60 * 20).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 20).toISOString(),
      schedule_date: null,
      schedule_time: null,
      registrar_remarks: "Awaiting final finance clearance.",
      ocr_state: "processed",
      ocr_confidence: 84.2,
      ocr_raw_text:
        "STUDENT NAME: JUAN DELA CRUZ\nSTUDENT ID: 20230001\nOR NO: OR-778234\nAMOUNT: PHP 350.00\nDATE: 04/15/2026",
      ocr_extracted_student_name: "Juan Dela Cruz",
      ocr_extracted_student_id: "20230001",
      ocr_extracted_or_number: "OR-778234",
      ocr_extracted_amount: "350.00",
      ocr_extracted_payment_date: "04/15/2026"
    },
    {
      id: "DEMO1002",
      student_name: "Maria Santos",
      student_id: "20230002",
      document_type: "Certificate of Enrollment",
      purpose: "Internship requirement",
      status: "Scheduled",
      clearance_status: "Cleared",
      uploaded_file_path: "",
      uploaded_file_name: "",
      batch_id: "BATCH1002",
      created_at: new Date(now - 1000 * 60 * 60 * 40).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 30).toISOString(),
      schedule_date: dayjs().add(1, "day").format("YYYY-MM-DD"),
      schedule_time: "10:00",
      registrar_remarks: "Scholarship student — no receipt required.",
      ocr_state: "not_run",
      ocr_confidence: null,
      ocr_raw_text: "",
      ocr_extracted_student_name: "",
      ocr_extracted_student_id: "",
      ocr_extracted_or_number: "",
      ocr_extracted_amount: "",
      ocr_extracted_payment_date: ""
    },
    {
      id: "DEMO1003",
      student_name: "Pedro Reyes",
      student_id: "20230003",
      document_type: "Certificate of Graduation",
      purpose: "Board exam application",
      status: "Released",
      clearance_status: "Cleared",
      uploaded_file_path: sampleFilePath,
      uploaded_file_name: path.basename(sampleFilePath),
      batch_id: null,
      created_at: new Date(now - 1000 * 60 * 60 * 80).toISOString(),
      updated_at: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
      schedule_date: dayjs().subtract(2, "day").format("YYYY-MM-DD"),
      schedule_time: "09:00",
      registrar_remarks: "Completed transaction — document claimed.",
      ocr_state: "corrected",
      ocr_confidence: 91.0,
      ocr_raw_text: "PEDRO REYES 20230003 OR-55102",
      ocr_extracted_student_name: "Pedro Reyes",
      ocr_extracted_student_id: "20230003",
      ocr_extracted_or_number: "OR-55102",
      ocr_extracted_amount: "200.00",
      ocr_extracted_payment_date: "03/01/2026"
    }
  ];

  for (const sample of samples) {
    const exists = await db.get("SELECT id FROM requests WHERE id = ?", sample.id);
    if (!exists) {
      await db.run(
        `INSERT INTO requests (
          id, student_name, student_id, document_type, purpose, status, clearance_status,
          uploaded_file_path, uploaded_file_name, batch_id, created_at, updated_at,
          schedule_date, schedule_time, registrar_remarks,
          ocr_state, ocr_confidence, ocr_raw_text,
          ocr_extracted_student_name, ocr_extracted_student_id, ocr_extracted_or_number,
          ocr_extracted_amount, ocr_extracted_payment_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sample.id,
        sample.student_name,
        sample.student_id,
        sample.document_type,
        sample.purpose,
        sample.status,
        sample.clearance_status,
        sample.uploaded_file_path,
        sample.uploaded_file_name,
        sample.batch_id,
        sample.created_at,
        sample.updated_at,
        sample.schedule_date,
        sample.schedule_time,
        sample.registrar_remarks,
        sample.ocr_state,
        sample.ocr_confidence,
        sample.ocr_raw_text,
        sample.ocr_extracted_student_name,
        sample.ocr_extracted_student_id,
        sample.ocr_extracted_or_number,
        sample.ocr_extracted_amount,
        sample.ocr_extracted_payment_date
      );
    }
  }
}

async function seedSampleClearances() {
  await ensureClearanceRows("20230001", "undergraduate");
  const juanPlan = {
    library: "Cleared",
    finance: "Pending",
    misso: "Cleared",
    saso: "Cleared",
    guidance: "Cleared",
    extension: "Pending"
  };
  for (const [code, status] of Object.entries(juanPlan)) {
    await updateClearance({
      studentId: "20230001",
      departmentCode: code,
      status,
      remarks: "",
      updatedBy: `dept-${code}@cca.edu.ph`
    });
  }

  await ensureClearanceRows("20230002", "graduating");
  for (const dept of DEPARTMENTS.filter((d) =>
    ["library", "finance", "misso", "saso", "guidance", "extension"].includes(d.code)
  )) {
    await updateClearance({
      studentId: "20230002",
      departmentCode: dept.code,
      status: "Cleared",
      remarks: "All requirements met.",
      updatedBy: `dept-${dept.code}@cca.edu.ph`
    });
  }

  await ensureClearanceRows("20230003", "graduate");
  for (const code of ["library", "finance", "misso", "guidance", "alumni"]) {
    await updateClearance({
      studentId: "20230003",
      departmentCode: code,
      status: "Cleared",
      remarks: "Alumni clearance complete.",
      updatedBy: `dept-${code}@cca.edu.ph`
    });
  }
}

async function seedAll() {
  await seedUsers();
  await seedSampleRequests();
  await seedSampleClearances();
}

module.exports = { seedAll };
