const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const {
  getUserByEmail,
  getUserById,
  getUserByStudentId,
  insertUser,
  updateUserPassword,
  updateUserProfile,
  updateUserNotificationPrefs,
  listNotificationDeliveries,
  ensureClearanceRows,
  writeAudit,
  createPasswordResetToken,
  getValidPasswordResetToken,
  markPasswordResetTokenUsed,
  STUDENT_CATEGORIES,
  CCA_COURSE_GROUPS,
  YEAR_LEVELS,
  SEMESTERS,
  isValidCcaCourse,
  normalizeCcaCourse,
  listSectionSuggestions,
  getRosterByStudentId
} = require("../db");
const { requireAuth, isRegistrarStaff, isViewOnlyStaff, isSystemAdmin } = require("../middleware");
const { evaluateRosterMatch } = require("../roster");
const {
  getDeliveryModes,
  normalizePhone,
  notifyUser,
  notifyAllUsers,
  formatSampleAlertMessage,
  sendEmail
} = require("../notify");

const router = express.Router();
const SCHOOL_EMAIL_DOMAIN = (process.env.SCHOOL_EMAIL_DOMAIN || "cca.edu.ph").toLowerCase();

function isSchoolEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  return normalized.endsWith(`@${SCHOOL_EMAIL_DOMAIN}`);
}

function refreshSessionUser(req, user) {
  req.session.user = buildSessionUser(user);
}

function buildSessionUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    studentId: user.studentId,
    departmentCode: user.departmentCode,
    isVerified: user.isVerified,
    studentCategory: user.studentCategory,
    course: user.course,
    section: user.section,
    hasScholarship: user.hasScholarship,
    phone: user.phone || "",
    notifyEmail: user.notifyEmail !== false,
    notifySms: Boolean(user.notifySms)
  };
}

router.get("/login", (req, res) => {
  let success = null;
  if (req.query.registered) {
    success = req.query.pending
      ? "Account created. Sign in with your school email. Your enrollment must be verified by the registrar before you can submit document requests."
      : "Account created. Sign in with your email and password to submit document requests.";
  }
  res.render("login", { error: null, success });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.render("login", { error: "Email and password are required.", success: null });
    return;
  }

  const user = await getUserByEmail(email);
  if (!user) {
    res.render("login", { error: "Invalid email or password.", success: null });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.render("login", { error: "Invalid email or password.", success: null });
    return;
  }

  req.session.user = buildSessionUser(user);
  await writeAudit(user.email, "login", `role=${user.role}`);

  if (user.role === "student" && !user.isVerified) {
    res.redirect("/student/dashboard");
    return;
  }

  if (user.role === "student") res.redirect("/student/dashboard");
  else if (isSystemAdmin(user.role)) res.redirect("/admin/users");
  else if (isRegistrarStaff(user.role)) res.redirect("/admin/dashboard");
  else if (isViewOnlyStaff(user.role)) res.redirect("/admin/dashboard");
  else if (user.role === "department") res.redirect("/department/dashboard");
  else res.redirect("/");
});

router.get("/register", async (_req, res) => {
  res.render("register", {
    error: null,
    form: {},
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS,
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions()
  });
});

router.post("/register", async (req, res) => {
  const {
    email,
    password,
    confirmPassword,
    displayName,
    studentId,
    studentCategory,
    course,
    section,
    yearLevel,
    semester,
    phone
  } = req.body;
  const form = {
    email,
    displayName,
    studentId,
    studentCategory,
    course,
    section,
    yearLevel: yearLevel || "",
    semester: semester || "",
    phone: phone || ""
  };

  const registerLocals = async () => ({
    form,
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS,
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions()
  });

  if (!email || !password || !confirmPassword || !displayName || !studentId || !studentCategory || !course) {
    res.render("register", { error: "All required fields must be filled in.", ...(await registerLocals()) });
    return;
  }
  if (!isSchoolEmail(email)) {
    res.render("register", {
      error: `Registration requires a valid @${SCHOOL_EMAIL_DOMAIN} school email address.`,
      ...(await registerLocals())
    });
    return;
  }
  if (!STUDENT_CATEGORIES.some((c) => c.value === studentCategory)) {
    res.render("register", {
      error: "Select a valid student category.",
      ...(await registerLocals())
    });
    return;
  }
  if (!isValidCcaCourse(course)) {
    res.render("register", {
      error: "Select a valid institute / program from the list.",
      ...(await registerLocals())
    });
    return;
  }
  const normalizedYearLevel = String(yearLevel || "").trim();
  const normalizedSemester = String(semester || "").trim();
  if (normalizedYearLevel && !YEAR_LEVELS.includes(normalizedYearLevel)) {
    res.render("register", {
      error: "Select a valid year level.",
      ...(await registerLocals())
    });
    return;
  }
  if (normalizedSemester && !SEMESTERS.includes(normalizedSemester)) {
    res.render("register", {
      error: "Select a valid semester.",
      ...(await registerLocals())
    });
    return;
  }
  if (password.length < 6) {
    res.render("register", { error: "Password must be at least 6 characters.", ...(await registerLocals()) });
    return;
  }
  if (password !== confirmPassword) {
    res.render("register", { error: "Passwords do not match.", ...(await registerLocals()) });
    return;
  }

  const existingEmail = await getUserByEmail(email);
  if (existingEmail) {
    res.render("register", { error: "An account with this email already exists.", ...(await registerLocals()) });
    return;
  }
  const existingSid = await getUserByStudentId(studentId);
  if (existingSid) {
    res.render("register", {
      error: "A student account with this Student ID already exists.",
      ...(await registerLocals())
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const rosterRow = await getRosterByStudentId(studentId.trim());
  const rosterCheck = evaluateRosterMatch(
    { displayName: displayName.trim(), studentId: studentId.trim(), email: email.trim().toLowerCase() },
    rosterRow
  );

  const newUser = {
    id: uuidv4(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role: "student",
    displayName: displayName.trim(),
    studentId: studentId.trim(),
    studentCategory,
    course: normalizeCcaCourse(course),
    section: (section || "").trim(),
    yearLevel: normalizedYearLevel,
    semester: normalizedSemester,
    hasScholarship: false,
    phone: normalizePhone(phone || ""),
    notifyEmail: true,
    notifySms: false,
    isVerified: rosterCheck.autoVerify,
    createdAt: new Date().toISOString()
  };

  await insertUser(newUser);
  await ensureClearanceRows(newUser.studentId, studentCategory);
  await writeAudit(
    newUser.email,
    rosterCheck.autoVerify ? "register_auto_verified" : "register",
    `studentId=${newUser.studentId} roster=${rosterCheck.status} pending_verification=${rosterCheck.autoVerify ? 0 : 1}`
  );

  if (!rosterCheck.autoVerify && rosterCheck.warnings.length) {
    await writeAudit(
      newUser.email,
      "register_roster_warning",
      rosterCheck.warnings.join(" | ")
    );
  }

  await notifyAllUsers({
    title: rosterCheck.autoVerify ? "Student auto-verified from roster" : "New student registration",
    message: rosterCheck.autoVerify
      ? `${newUser.displayName} (${newUser.studentId}) registered and matched the enrollment roster.`
      : `${newUser.displayName} (${newUser.studentId}) registered and is awaiting enrollment verification.`,
    link: "/admin/users?filter=pending",
    excludeUserId: null
  });

  res.redirect(
    rosterCheck.autoVerify ? "/login?registered=1" : "/login?registered=1&pending=1"
  );
});

router.post("/logout", (req, res) => {
  const email = req.session.user?.email;
  req.session.destroy(async () => {
    if (email) await writeAudit(email, "logout", "");
    res.redirect("/login");
  });
});

router.get("/change-password", requireAuth, (req, res) => {
  res.render("change-password", { user: req.session.user, error: null, success: null });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }

  const ok = await bcrypt.compare(currentPassword || "", fresh.passwordHash);
  if (!ok) {
    res.render("change-password", {
      user: req.session.user,
      error: "Current password is incorrect.",
      success: null
    });
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    res.render("change-password", {
      user: req.session.user,
      error: "New password must be at least 6 characters.",
      success: null
    });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.render("change-password", {
      user: req.session.user,
      error: "New passwords do not match.",
      success: null
    });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await updateUserPassword(fresh.id, hash);
  await writeAudit(fresh.email, "change_password", "");

  res.render("change-password", {
    user: req.session.user,
    error: null,
    success: "Password updated successfully."
  });
});

router.get("/notification-settings", requireAuth, async (req, res) => {
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }
  const deliveries = await listNotificationDeliveries(fresh.id, 12);
  res.render("notification-settings", {
    user: { ...req.session.user, ...fresh },
    error: null,
    success: null,
    deliveries,
    deliveryModes: getDeliveryModes()
  });
});

router.post("/notification-settings", requireAuth, async (req, res) => {
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }

  const phone = normalizePhone(req.body.phone || "");
  const notifyEmail = req.body.notifyEmail === "1";
  const notifySms = req.body.notifySms === "1";

  if (notifySms && !phone) {
    const deliveries = await listNotificationDeliveries(fresh.id, 12);
    res.render("notification-settings", {
      user: fresh,
      error: "Add a mobile number to enable SMS alerts.",
      success: null,
      deliveries,
      deliveryModes: getDeliveryModes()
    });
    return;
  }

  await updateUserNotificationPrefs(fresh.id, { phone, notifyEmail, notifySms });
  req.session.user = buildSessionUser({ ...fresh, phone, notifyEmail, notifySms });
  await writeAudit(fresh.email, "update_notification_prefs", `email=${notifyEmail} sms=${notifySms}`);

  const deliveries = await listNotificationDeliveries(fresh.id, 12);
  res.render("notification-settings", {
    user: req.session.user,
    error: null,
    success: "Email and SMS alert preferences saved.",
    deliveries,
    deliveryModes: getDeliveryModes()
  });
});

router.get("/forgot-password", (_req, res) => {
  res.render("forgot-password", { error: null, success: null });
});

router.post("/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!email) {
    res.render("forgot-password", { error: "Enter your school email address.", success: null });
    return;
  }

  const user = await getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await createPasswordResetToken(user.id, token, expiresAt);
    const resetUrl = `${process.env.APP_URL || "http://localhost:3000"}/reset-password/${token}`;
    await sendEmail(
      user,
      "Password reset request",
      `Use this link to reset your password (valid for 1 hour): ${resetUrl}`,
      `/reset-password/${token}`
    );
    await writeAudit(user.email, "password_reset_requested", "");
  }

  res.render("forgot-password", {
    error: null,
    success:
      "If an account exists for that email, a reset link has been sent. Check your inbox or ask the registrar if you do not receive it."
  });
});

router.get("/reset-password/:token", async (req, res) => {
  const record = await getValidPasswordResetToken(req.params.token);
  if (!record) {
    res.render("reset-password", {
      token: null,
      error: "This reset link is invalid or has expired. Request a new one.",
      success: null
    });
    return;
  }
  res.render("reset-password", { token: req.params.token, error: null, success: null });
});

router.post("/reset-password/:token", async (req, res) => {
  const record = await getValidPasswordResetToken(req.params.token);
  if (!record) {
    res.render("reset-password", {
      token: null,
      error: "This reset link is invalid or has expired. Request a new one.",
      success: null
    });
    return;
  }

  const { newPassword, confirmPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.render("reset-password", {
      token: req.params.token,
      error: "Password must be at least 6 characters.",
      success: null
    });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.render("reset-password", {
      token: req.params.token,
      error: "Passwords do not match.",
      success: null
    });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await updateUserPassword(record.userId, hash);
  await markPasswordResetTokenUsed(req.params.token);
  await writeAudit(record.email, "password_reset_completed", "");

  res.render("reset-password", {
    token: null,
    error: null,
    success: "Password updated. You can sign in with your new password."
  });
});

router.get("/profile", requireAuth, async (req, res) => {
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }
  refreshSessionUser(req, fresh);
  res.render("profile", {
    user: req.session.user,
    profile: fresh,
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS,
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions(),
    error: null,
    success: null,
    readOnly: fresh.role !== "student"
  });
});

router.post("/profile", requireAuth, async (req, res) => {
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }

  const profileLocals = async (overrides = {}) => ({
    user: req.session.user,
    profile: overrides.profile || fresh,
    categories: STUDENT_CATEGORIES,
    courseGroups: CCA_COURSE_GROUPS,
    yearLevels: YEAR_LEVELS,
    semesters: SEMESTERS,
    sectionSuggestions: await listSectionSuggestions(),
    readOnly: false,
    success: null,
    error: null,
    ...overrides
  });

  if (fresh.role !== "student") {
    res.render("profile", {
      ...(await profileLocals({
        readOnly: true,
        error: "Only student accounts can edit profile details here. Contact the registrar for other roles."
      }))
    });
    return;
  }

  const displayName = String(req.body.displayName || "").trim();
  const course = String(req.body.course || "").trim();
  const section = String(req.body.section || "").trim();
  const yearLevel = String(req.body.yearLevel || "").trim();
  const semester = String(req.body.semester || "").trim();
  const phone = normalizePhone(req.body.phone || "");

  if (!displayName) {
    res.render("profile", await profileLocals({ error: "Display name is required." }));
    return;
  }

  if (!isValidCcaCourse(course)) {
    res.render("profile", await profileLocals({ error: "Select a valid institute / program from the list." }));
    return;
  }

  if (yearLevel && !YEAR_LEVELS.includes(yearLevel)) {
    res.render("profile", await profileLocals({ error: "Select a valid year level." }));
    return;
  }

  if (semester && !SEMESTERS.includes(semester)) {
    res.render("profile", await profileLocals({ error: "Select a valid semester." }));
    return;
  }

  await updateUserProfile(fresh.id, {
    displayName,
    phone,
    course: normalizeCcaCourse(course),
    section,
    yearLevel,
    semester
  });
  const updated = await getUserById(fresh.id);
  refreshSessionUser(req, updated);
  await writeAudit(
    fresh.email,
    "update_profile",
    `course=${course} section=${section} year=${yearLevel} semester=${semester}`
  );

  res.render("profile", {
    ...(await profileLocals({
      profile: updated,
      success: "Profile updated successfully."
    }))
  });
});

router.post("/notification-settings/sample", requireAuth, async (req, res) => {
  const fresh = await getUserById(req.session.user.id);
  if (!fresh) {
    res.redirect("/login");
    return;
  }

  const channels = [];
  if (fresh.notifyEmail) channels.push("email");
  if (fresh.notifySms && fresh.phone) channels.push("SMS");
  if (fresh.notifySms && !fresh.phone) {
    const deliveries = await listNotificationDeliveries(fresh.id, 12);
    res.render("notification-settings", {
      user: fresh,
      error: "Add a mobile number or disable SMS before sending a sample SMS alert.",
      success: null,
      deliveries,
      deliveryModes: getDeliveryModes()
    });
    return;
  }
  if (!channels.length) {
    const deliveries = await listNotificationDeliveries(fresh.id, 12);
    res.render("notification-settings", {
      user: fresh,
      error: "Enable email or SMS alerts above before sending a sample.",
      success: null,
      deliveries,
      deliveryModes: getDeliveryModes()
    });
    return;
  }

  const results = await notifyUser(fresh.id, {
    title: "CCA Registrar",
    message: "You will receive request and clearance updates on this number.",
    link: "/notification-settings"
  });
  await writeAudit(fresh.email, "send_sample_alert", `channels=${channels.join(",")}`);

  const deliveries = await listNotificationDeliveries(fresh.id, 12);
  res.render("notification-settings", {
    user: fresh,
    error: null,
    success: formatSampleAlertMessage(results),
    emailPreviewUrl: results.email?.previewUrl || null,
    deliveries,
    deliveryModes: getDeliveryModes()
  });
});

module.exports = router;
