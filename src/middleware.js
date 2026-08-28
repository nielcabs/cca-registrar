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

function isViewOnlyStaff(role) {
  return role === "vpaa";
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    const wantsStaff = roles.some((r) => r === "admin" || r === "registrar");
    const allowed =
      roles.includes(role) || (wantsStaff && isRegistrarStaff(role));
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

module.exports = {
  requireAuth,
  requireRole,
  requireWriteAccess,
  isRegistrarStaff,
  isViewOnlyStaff
};
