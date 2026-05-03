function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const role = req.session.user?.role;
    const allowed = roles.includes(role) || (roles.includes("admin") && role === "registrar");
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

module.exports = { requireAuth, requireRole };
