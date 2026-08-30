/**
 * Quick local smoke test — run while server is up: node scripts/local-smoke-test.js
 */
const http = require("http");

function request(method, path, { cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : null;
    const req = http.request(
      {
        hostname: "localhost",
        port: 3000,
        path,
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(data)
              }
            : {}),
          ...headers
        }
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"] || [];
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            setCookie,
            body: chunks
          });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function mergeCookies(existing, setCookie) {
  const jar = {};
  (existing || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const i = pair.indexOf("=");
      if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1);
    });
  setCookie.forEach((line) => {
    const part = line.split(";")[0];
    const i = part.indexOf("=");
    if (i > 0) jar[part.slice(0, i)] = part.slice(i + 1);
  });
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function login(email, password) {
  let cookie = "";
  const page = await request("GET", "/login");
  cookie = mergeCookies(cookie, page.setCookie);
  const res = await request("POST", "/login", {
    cookie,
    body: { email, password }
  });
  cookie = mergeCookies(cookie, res.setCookie);
  return { cookie, status: res.status, location: res.location };
}

async function get(path, cookie) {
  return request("GET", path, { cookie });
}

function assert(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

(async () => {
  console.log("Local smoke test @ http://localhost:3000\n");

  const home = await request("GET", "/");
  assert("Server responds", home.status === 302 || home.status === 200, `status ${home.status}`);

  const juan = await login("juan@cca.edu.ph", "cca123");
  assert("Student login", juan.status === 302 && juan.location === "/student/dashboard", juan.location);

  const dash = await get("/student/dashboard", juan.cookie);
  assert("Student dashboard", dash.status === 200 && dash.body.includes("Juan Dela Cruz"));

  const newReq = await get("/student/new-request", juan.cookie);
  assert(
    "Multi-doc form",
    newReq.body.includes("documentTypes") && newReq.body.includes("Submit Requests")
  );
  assert(
    "Receipt required (non-scholarship)",
    newReq.body.includes("A payment receipt (OR) is required") &&
      /name="documentFile"[^>]*required/i.test(newReq.body)
  );

  const noReceipt = await request("POST", "/student/new-request", {
    cookie: juan.cookie,
    body: {
      documentTypes: "Transcript of Records",
      purpose: "Employment"
    }
  });
  assert(
    "Reject request without receipt (non-scholarship)",
    noReceipt.status === 200 &&
      noReceipt.body.includes("Payment receipt is required") &&
      !noReceipt.location
  );

  const maria = await login("maria@cca.edu.ph", "cca123");
  const mariaReq = await get("/student/new-request", maria.cookie);
  assert(
    "Receipt optional (scholarship)",
    mariaReq.body.includes("Scholarship students may submit without a payment receipt") &&
      !mariaReq.body.match(/name="documentFile"[^>]*required/i)
  );

  const admin = await login("admin@cca.edu.ph", "cca123");
  assert("Registrar login", admin.location === "/admin/dashboard");

  const active = await get("/admin/requests?view=active", admin.cookie);
  assert("Active queue tab", active.status === 200 && active.body.includes("Active requests"));

  const completed = await get("/admin/requests?view=completed", admin.cookie);
  assert(
    "Completed queue tab",
    completed.body.includes("Completed transactions") &&
      completed.body.includes("Released / Rejected") &&
      completed.body.includes("DEMO1003")
  );

  const filters = await get(
    "/admin/requests?view=active&course=Bachelor%20of%20Science%20in%20Information%20Systems&section=A",
    admin.cookie
  );
  assert("Course/section filter", filters.body.includes("20230001"));

  const clearances = await get("/admin/clearances", admin.cookie);
  assert("Clearance overview", clearances.body.includes("Undergraduate"));

  const sysadmin = await login("sysadmin@cca.edu.ph", "cca123");
  assert("Sysadmin login", sysadmin.location === "/admin/users");

  const roster = await get("/admin/roster", sysadmin.cookie);
  assert("Sysadmin roster page", roster.status === 200 && roster.body.includes("Enrollment roster"));

  const archive = await get("/admin/archive", sysadmin.cookie);
  assert("Sysadmin archive page", archive.status === 200 && archive.body.includes("Archived document requests"));

  const registrarUsers = await get("/admin/users", admin.cookie);
  assert("Registrar blocked from user management", registrarUsers.status === 403);

  const vpaa = await login("vpaa@cca.edu.ph", "cca123");
  assert("VPAA login", vpaa.location === "/admin/dashboard");

  const vpaaReq = await get("/admin/requests", vpaa.cookie);
  assert("VPAA can view queue", vpaaReq.status === 200);

  const vpaaWrite = await request("POST", "/admin/request/DEMO1001/update", {
    cookie: vpaa.cookie,
    body: { status: "Released" }
  });
  assert("VPAA blocked from edits", vpaaWrite.status === 403);

  const alumni = await login("alumni@cca.edu.ph", "cca123");
  const alumniDash = await get("/department/dashboard", alumni.cookie);
  assert("Alumni office login", alumniDash.status === 200 && alumniDash.body.includes("Alumni Office"));
  assert(
    "Alumni sees graduate students only",
    alumniDash.body.includes("20230003") && !alumniDash.body.includes("20230001")
  );

  console.log("\nDone. Open http://localhost:3000/login in your browser to explore manually.");
})().catch((err) => {
  console.error("Smoke test error:", err.message);
  console.error("Is the server running? Try: npm start");
  process.exit(1);
});
