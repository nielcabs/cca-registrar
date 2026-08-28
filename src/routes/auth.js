const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const {
  getUserByEmail,
  getUserById,
  getUserByStudentId,
  insertUser,
  updateUserPassword,
  updateUserNotificationPrefs,
  listNotificationDeliveries,
  ensureClearanceRows,
  writeAudit,
  STUDENT_CATEGORIES
} = require("../db");
const { requireAuth, isRegistrarStaff, isViewOnlyStaff } = require("../middleware");
const { getDeliveryModes, normalizePhone, notifyUser, formatSampleAlertMessage } = require("../notify");

const router = express.Router();

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
  res.render("login", {
    error: null,
    success: req.query.registered ? "Account created. Sign in with your email and password to submit document requests." : null
  });
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

  if (user.role === "student") res.redirect("/student/dashboard");
  else if (isRegistrarStaff(user.role)) res.redirect("/admin/dashboard");
  else if (isViewOnlyStaff(user.role)) res.redirect("/admin/dashboard");
  else if (user.role === "department") res.redirect("/department/dashboard");
  else res.redirect("/");
});

router.get("/register", (_req, res) => {
  res.render("register", { error: null, form: {}, categories: STUDENT_CATEGORIES });
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
    hasScholarship,
    phone
  } = req.body;
  const form = {
    email,
    displayName,
    studentId,
    studentCategory,
    course,
    section,
    hasScholarship: hasScholarship === "1",
    phone: phone || ""
  };

  if (!email || !password || !confirmPassword || !displayName || !studentId || !studentCategory) {
    res.render("register", { error: "All required fields must be filled in.", form, categories: STUDENT_CATEGORIES });
    return;
  }
  if (!STUDENT_CATEGORIES.some((c) => c.value === studentCategory)) {
    res.render("register", { error: "Select a valid student category.", form, categories: STUDENT_CATEGORIES });
    return;
  }
  if (password.length < 6) {
    res.render("register", { error: "Password must be at least 6 characters.", form, categories: STUDENT_CATEGORIES });
    return;
  }
  if (password !== confirmPassword) {
    res.render("register", { error: "Passwords do not match.", form, categories: STUDENT_CATEGORIES });
    return;
  }

  const existingEmail = await getUserByEmail(email);
  if (existingEmail) {
    res.render("register", { error: "An account with this email already exists.", form, categories: STUDENT_CATEGORIES });
    return;
  }
  const existingSid = await getUserByStudentId(studentId);
  if (existingSid) {
    res.render("register", {
      error: "A student account with this Student ID already exists.",
      form,
      categories: STUDENT_CATEGORIES
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email: email.trim().toLowerCase(),
    passwordHash,
    role: "student",
    displayName: displayName.trim(),
    studentId: studentId.trim(),
    studentCategory,
    course: (course || "").trim(),
    section: (section || "").trim(),
    hasScholarship: hasScholarship === "1",
    phone: normalizePhone(phone || ""),
    notifyEmail: true,
    notifySms: false,
    isVerified: true,
    createdAt: new Date().toISOString()
  };

  await insertUser(newUser);
  await ensureClearanceRows(newUser.studentId, studentCategory);
  await writeAudit(newUser.email, "register", `studentId=${newUser.studentId}`);

  res.redirect("/login?registered=1");
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
