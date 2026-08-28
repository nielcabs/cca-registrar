async function main() {
  const db = require("../src/db");
  await db.ensureStorageDirs();
  await db.initializeDatabase();

  const users = await db.listUsers();
  const admin = users.find((u) => u.role === "registrar");
  const student = users.find((u) => u.role === "student");
  const dept = users.find((u) => u.role === "department");

  if (!admin || !student || !dept) {
    throw new Error("Missing seeded users (admin/student/department).");
  }

  const beforeS = await db.countUnreadNotifications(student.id);
  const beforeD = await db.countUnreadNotifications(dept.id);

  const a = await db.createAnnouncement({
    title: "Test announcement",
    message: "This should appear in Notifications inbox.",
    createdBy: admin.email
  });

  await db.createNotificationForAllUsers({
    title: `Announcement: ${a.title}`,
    message: a.message,
    link: null,
    excludeUserId: admin.id
  });

  const afterS = await db.countUnreadNotifications(student.id);
  const afterD = await db.countUnreadNotifications(dept.id);

  console.log(
    JSON.stringify(
      {
        student: { email: student.email, before: beforeS, after: afterS },
        department: { email: dept.email, before: beforeD, after: afterD }
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

