const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");

const {
  ensureStorageDirs,
  initializeDatabase,
  UPLOADS_DIR
} = require("./src/db");
const { seedAll } = require("./src/seed");

const authRoutes = require("./src/routes/auth");
const studentRoutes = require("./src/routes/student");
const adminRoutes = require("./src/routes/admin");
const departmentRoutes = require("./src/routes/department");
const { isRegistrarStaff } = require("./src/middleware");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("trust proxy", 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cca-registrar-demo-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get("/", (req, res) => {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  const role = req.session.user.role;
  if (role === "student") res.redirect("/student/dashboard");
  else if (isRegistrarStaff(role)) res.redirect("/admin/dashboard");
  else if (role === "department") res.redirect("/department/dashboard");
  else res.redirect("/login");
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/registrar")) {
    next();
    return;
  }
  let target = req.path.replace(/^\/registrar/, "/admin") || "/admin";
  if (target === "/admin" || target === "/admin/dashboard") {
    target = "/admin/requests";
  }
  const q = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, target + q);
});

app.use("/", authRoutes);
app.use("/student", studentRoutes);
app.use("/admin", adminRoutes);
app.use("/department", departmentRoutes);

app.use((error, _req, res, _next) => {
  if (
    error instanceof multer.MulterError ||
    error.message === "Only JPG and PNG files are supported for OCR demo."
  ) {
    res.status(400).send(`Upload error: ${error.message}`);
    return;
  }
  console.error(error);
  res.status(500).send("Unexpected server error.");
});

ensureStorageDirs()
  .then(initializeDatabase)
  .then(seedAll)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`CCA Registrar System running at http://localhost:${PORT}`);
      console.log("Seeded credentials (password for all = cca123):");
      console.log("  admin@cca.edu.ph (Registrar office — full access)");
      console.log("  juan@cca.edu.ph | maria@cca.edu.ph | pedro@cca.edu.ph (students)");
      console.log("  library@cca.edu.ph | finance@cca.edu.ph | misso@cca.edu.ph");
      console.log("  saso@cca.edu.ph | guidance@cca.edu.ph | extension@cca.edu.ph");
    });
  })
  .catch((error) => {
    console.error("Failed to initialize app:", error);
    process.exit(1);
  });
