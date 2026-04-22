function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
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

function requireVerifiedStudent(req, res, next) {
  if (req.session.user?.role === "student" && !req.session.user?.isVerified) {
    res.status(403).render("error", {
      user: req.session.user,
      title: "Account pending verification",
      message:
        "Your student account is still awaiting verification by the Registrar administrator. Please try again later."
    });
    return;
  }
  next();
}

module.exports = { requireAuth, requireRole, requireVerifiedStudent };
