const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const {
  DEPARTMENTS,
  listUsers,
  getUserById,
  getUserByEmail,
  getUserByStudentId,
  insertUser,
  setUserVerified,
  deleteUser,
  listRequests,
  listAudit,
  getDashboardStats,
  ensureClearanceRows,
  writeAudit
} = require("../db");
const { requireAuth, requireRole } = require("../middleware");
const { computeStatusBadge, formatDate } = require("../helpers");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/dashboard", async (req, res) => {
  const stats = await getDashboardStats();
  const recent = (await listRequests()).slice(0, 8).map((r) => ({
    ...r,
    statusClass: computeStatusBadge(r.status)
  }));

  res.render("admin-dashboard", {
    user: req.session.user,
    stats,
    recent
  });
});

router.get("/users", async (req, res) => {
  const users = await listUsers();
  res.render("admin-users", {
    user: req.session.user,
    users,
    departments: DEPARTMENTS,
    error: null,
    success: null
  });
});

router.post("/users/create", async (req, res) => {
  const { email, password, role, displayName, studentId, departmentCode } = req.body;
  const users = await listUsers();

  if (!email || !password || !role || !displayName) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Email, password, role, and name are required.",
      success: null
    });
    return;
  }
  if (password.length < 6) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Password must be at least 6 characters.",
      success: null
    });
    return;
  }

  const dupEmail = await getUserByEmail(email);
  if (dupEmail) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Email already in use.",
      success: null
    });
    return;
  }

  if (role === "student") {
    if (!studentId) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        error: "Student ID is required for student accounts.",
        success: null
      });
      return;
    }
    const dupSid = await getUserByStudentId(studentId);
    if (dupSid) {
      res.render("admin-users", {
        user: req.session.user,
        users,
        departments: DEPARTMENTS,
        error: "Student ID already registered.",
        success: null
      });
      return;
    }
  }
  if (role === "department" && !departmentCode) {
    res.render("admin-users", {
      user: req.session.user,
      users,
      departments: DEPARTMENTS,
      error: "Department is required for department officers.",
      success: null
    });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    role,
    displayName: displayName.trim(),
    studentId: role === "student" ? studentId.trim() : null,
    departmentCode: role === "department" ? departmentCode : null,
    isVerified: role === "student" ? false : true,
    createdAt: new Date().toISOString()
  };
  await insertUser(newUser);
  if (role === "student") await ensureClearanceRows(newUser.studentId);
  await writeAudit(req.session.user.email, "create_user", `email=${newUser.email} role=${role}`);

  const freshUsers = await listUsers();
  res.render("admin-users", {
    user: req.session.user,
    users: freshUsers,
    departments: DEPARTMENTS,
    error: null,
    success: `Account created for ${newUser.email}.`
  });
});

router.post("/users/:id/verify", async (req, res) => {
  const target = await getUserById(req.params.id);
  if (target && target.role === "student") {
    await setUserVerified(target.id, true);
    await writeAudit(req.session.user.email, "verify_student", `email=${target.email}`);
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/unverify", async (req, res) => {
  const target = await getUserById(req.params.id);
  if (target && target.role === "student") {
    await setUserVerified(target.id, false);
    await writeAudit(req.session.user.email, "unverify_student", `email=${target.email}`);
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/delete", async (req, res) => {
  const target = await getUserById(req.params.id);
  if (target && target.email === req.session.user.email) {
    res.status(400).send("You cannot delete your own account while logged in.");
    return;
  }
  if (target) {
    await deleteUser(target.id);
    await writeAudit(req.session.user.email, "delete_user", `email=${target.email}`);
  }
  res.redirect("/admin/users");
});

router.get("/verify-students", async (req, res) => {
  const all = await listUsers({ role: "student" });
  res.render("admin-verify", {
    user: req.session.user,
    students: all
  });
});

router.get("/reports", async (req, res) => {
  const stats = await getDashboardStats();
  const audit = await listAudit(30);
  res.render("admin-reports", {
    user: req.session.user,
    stats,
    audit: audit.map((a) => ({ ...a, at_formatted: formatDate(a.at) }))
  });
});

module.exports = router;
