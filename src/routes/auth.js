const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const {
  getUserByEmail,
  getUserById,
  getUserByStudentId,
  insertUser,
  updateUserPassword,
  ensureClearanceRows,
  writeAudit
} = require("../db");
const { requireAuth, isRegistrarStaff } = require("../middleware");

const router = express.Router();

function buildSessionUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    studentId: user.studentId,
    departmentCode: user.departmentCode,
    isVerified: user.isVerified
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
  else if (user.role === "department") res.redirect("/department/dashboard");
  else res.redirect("/");
});

router.get("/register", (_req, res) => {
  res.render("register", { error: null, form: {} });
});

router.post("/register", async (req, res) => {
  const { email, password, confirmPassword, displayName, studentId } = req.body;
  const form = { email, displayName, studentId };

  if (!email || !password || !confirmPassword || !displayName || !studentId) {
    res.render("register", { error: "All fields are required.", form });
    return;
  }
  if (password.length < 6) {
    res.render("register", { error: "Password must be at least 6 characters.", form });
    return;
  }
  if (password !== confirmPassword) {
    res.render("register", { error: "Passwords do not match.", form });
    return;
  }

  const existingEmail = await getUserByEmail(email);
  if (existingEmail) {
    res.render("register", { error: "An account with this email already exists.", form });
    return;
  }
  const existingSid = await getUserByStudentId(studentId);
  if (existingSid) {
    res.render("register", { error: "A student account with this Student ID already exists.", form });
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
    isVerified: true,
    createdAt: new Date().toISOString()
  };

  await insertUser(newUser);
  await ensureClearanceRows(newUser.studentId);
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

module.exports = router;
