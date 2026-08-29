function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

/** Registrar office staff: `admin` and `registrar` are the same access level. */
function isRegistrarStaff(role) {
  return role === "admin" || role === "registrar";
}

function isSystemAdmin(role) {
  return role === "sysadmin";
}

function isViewOnlyStaff(role) {
  return role === "vpaa";
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    const wantsStaff = roles.some((r) => r === "admin" || r === "registrar");
    const allowed =
      roles.includes(role) ||
      (wantsStaff && isRegistrarStaff(role)) ||
      (roles.includes("sysadmin") && isSystemAdmin(role));
    if (!req.session.user || !allowed) {
      res.status(403).render("error", {
        user: req.session.user || null,
        title: "Forbidden",
        message: "You do not have permission to access this page."
      });
      return;
    }
    next();
  };
}

function requireSystemAdmin(req, res, next) {
  if (!isSystemAdmin(req.session.user?.role)) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "Forbidden",
      message: "Only system administrators can access this page."
    });
    return;
  }
  next();
}

function requireRegistrarOperations(req, res, next) {
  const role = req.session.user?.role;
  if (isSystemAdmin(role)) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "Registrar operations only",
      message:
        "System administrator accounts manage users and roster. Use a registrar account for document processing."
    });
    return;
  }
  next();
}

function requireWriteAccess(req, res, next) {
  if (isViewOnlyStaff(req.session.user?.role)) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "View only",
      message: "Your VPAA account can view records but cannot change data."
    });
    return;
  }
  next();
}

function requireVerifiedStudent(req, res, next) {
  const user = req.session.user;
  if (user?.role === "student" && !user.isVerified) {
    res.status(403).render("error", {
      user,
      title: "Account pending verification",
      message:
        "Your enrollment is still pending registrar approval. You can view your dashboard and update your profile, but document requests and appointment booking are disabled until an administrator verifies your account."
    });
    return;
  }
  next();
}

module.exports = {
  requireAuth,
  requireRole,
  requireSystemAdmin,
  requireRegistrarOperations,
  requireWriteAccess,
  requireVerifiedStudent,
  isRegistrarStaff,
  isSystemAdmin,
  isViewOnlyStaff
};
