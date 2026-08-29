# Integrated Requisition and Scheduling System for CCA Registrar's Office

Web-based system that digitizes document requests, clearance verification, and release scheduling for the City College of Angeles Registrar's Office.

Standard UI terms (Institute, Signed clearance, etc.) are documented in [`docs/TERMINOLOGIES.md`](docs/TERMINOLOGIES.md).

## Paper-to-System Module Mapping

| Paper Module (Chapter 3: Design and Implementation) | Implemented Location |
|---|---|
| User Authentication Module | `/login` (email + hashed password) |
| Password Change Module | `/change-password` |
| Admin Module (unified with registrar operations) | `/admin/*` |
| - View / manage user accounts | `/admin/users` |
| - Document request queue + search | `/admin/requests` |
| - Process request, OCR, scheduling | `/admin/request/:id` |
| - Student clearance overview + search | `/admin/clearances`, `/admin/clearance/:studentId` |
| - Reports + **PDF export** | `/admin/reports`, `/admin/reports/export.pdf` |
| Student Module | `/student/*` |
| - Submit Document Requests | `/student/new-request` |
| - View Request Status | `/student/track/:id` |
| - Clearance Status | `/student/clearance` |
| - Appointment Schedule | shown on request detail |
| Department Officer Module (6 offices) | `/department/dashboard` |
| OCR Innovation Feature | Admin request detail — **Run OCR on this image** |

## Stack

- **Backend:** Node.js + Express 5
- **Templating:** EJS (with partials)
- **Database:** SQLite (`sqlite` + `sqlite3`)
- **Authentication:** `bcryptjs` password hashing + `express-session`
- **File Upload:** Multer (5 MB limit, JPG/PNG/PDF)
- **OCR Engine:** Tesseract.js with English traineddata
- **Date Utility:** Day.js
- **PDF reports:** `pdfkit` (download from Reports page)

## Diagrams (capstone / documentation)

- **System needs (stakeholder requirements + gap analysis):** [`docs/SYSTEM_NEEDS.md`](docs/SYSTEM_NEEDS.md)
- **Diagram images (PNG + SVG):** [`docs/diagrams/`](docs/diagrams/) — context Level 0, student use case, **multi-role** use case; run `npm run diagrams:png` to rebuild PNGs from SVG
- **Context + use case (Mermaid sources + links):** [`docs/Context_and_Use_Case.md`](docs/Context_and_Use_Case.md)
- **All diagrams (DFD Level 1, ERD, etc.):** [`docs/SYSTEM_DIAGRAMS.md`](docs/SYSTEM_DIAGRAMS.md)

## Roles

1. **Student** — submits requests (multi-document, conditional receipt), tracks status, views clearance, books/reschedules/cancels appointments
2. **Registrar** — document queue (active/completed/archived), OCR, scheduling, clearance monitoring, reports + PDF, announcements
3. **System administrator (`sysadmin`)** — user accounts, enrollment roster import, archive management, reports/audit
4. **Department Officer** — updates office clearance (optional sign-off photo) and Finance tuition records
5. **VPAA (view only)** — read-only access to dashboard, requests, clearances, and reports

Six core department officers plus **Alumni Office** are provisioned:
Library, Budget and Finance, MISSO, SASO, Guidance, Community Extension (NSTP), Alumni Office.

## Student categories & clearance

| Category | Required offices |
|----------|------------------|
| Undergraduate | Library, MISSO, Extension, Guidance, Student Affairs, Finance, **Registrar** |
| Graduating | Library, MISSO, Extension, Guidance, Student Affairs, Finance, **Registrar** |
| Graduate (Alumni) | Library, Finance, MISSO, Guidance, Alumni Office, **Registrar** |

## Seeded Demo Accounts (password for all = `cca123`)

| Email | Role | Notes |
|---|---|---|
| `admin@cca.edu.ph` | Registrar | Document processing, OCR, clearances |
| `sysadmin@cca.edu.ph` | System admin | Users, roster, archive |
| `vpaa@cca.edu.ph` | VPAA | View-only — no edits or PDF export |
| `juan@cca.edu.ph` | Student (SID 20230001) | Undergraduate · BSIS Sec A · DEMO1001 |
| `maria@cca.edu.ph` | Student (SID 20230002) | Graduating · scholarship · DEMO1002 |
| `pedro@cca.edu.ph` | Student (SID 20230003) | Graduate · DEMO1003 (Released) |
| `library@cca.edu.ph` | Department Officer | Library clearance |
| `finance@cca.edu.ph` | Department Officer | Budget and Finance |
| `misso@cca.edu.ph` | Department Officer | MISSO |
| `saso@cca.edu.ph` | Department Officer | SASO |
| `guidance@cca.edu.ph` | Department Officer | Guidance Office |
| `extension@cca.edu.ph` | Department Officer | Community Extension / NSTP |
| `alumni@cca.edu.ph` | Department Officer | Alumni Office (graduate clearances) |

## Clearance & scheduling rules

- **Clearance:** A request can only move to `Scheduled` or `Released` when all offices required for the student's category show **Signed**.
- **Scheduling:** Weekdays 08:00–15:00 (hourly), 5 students per slot.

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Delete `data/app.db` and restart to reset demo data.

## Demo Script (for Defense / Pre-Oral)

1. Log in as `juan@cca.edu.ph` → **New document request** → upload payment proof → submit.
2. Log in as `library@cca.edu.ph` → use **search** if needed → mark Juan **Signed** (repeat for other offices as needed).
3. Log in as `admin@cca.edu.ph` → **Document requests** → open Juan’s row → **Run OCR** → correct fields if needed → pick **release slot** → set **Scheduled** → save.
4. Log in as `juan@cca.edu.ph` → **Track** → confirm schedule and office remarks.
5. Log in as `admin@cca.edu.ph` → **Student clearances** → search by name → open detail.
6. **Reports** → show on-screen stats → **Download PDF report**.

## Directory Layout

```
server.js                  # entry point, wires routes
src/
  db.js                    # SQLite schema + all DB operations
  seed.js                  # demo accounts, requests, clearances
  middleware.js            # auth + role guards
  helpers.js               # badges, slot generator
  ocr.js                   # Tesseract.js wrapper + field parser
  routes/
    auth.js                # login, register, change-password
    student.js             # student dashboard, request, clearance, track
    admin.js               # admin + registrar: queue, OCR, scheduling, clearances, reports+PDF, users
    department.js          # department officer dashboard + clearance update
views/                     # EJS templates
  partials/                # shared head, sidebar, topbar
public/styles.css          # single stylesheet
data/app.db                # SQLite database (auto-created)
uploads/                   # uploaded payment proofs
eng.traineddata            # Tesseract English model
```

## ISO 25010 Alignment (for evaluation)

- **Functional Suitability** — auth, request, clearance, scheduling, reports, OCR
- **Usability** — role-based sidebars, form validation, clear status badges
- **Reliability** — slot capacity checks, clearance gate prevents invalid state
- **Security** — bcrypt password hashing, role-based route guards, session auth, audit log
- **Maintainability** — modular split (routes, db, helpers, ocr)
- **Performance Efficiency** — lightweight Node + SQLite, suitable for on-campus deployment

## Email & SMS alerts

Users can enable external alerts at **`/notification-settings`** (sidebar: **Email & SMS alerts**).

| Channel | Local demo (default) | Production |
|---|---|---|
| **Email** | **Ethereal demo** — preview link after sample send | `NOTIFY_EMAIL_MODE=pingram` + `PINGRAM_API_KEY`, or SMTP (see `.env.example`) |
| **SMS** | **Demo only** — shown in delivery log | `NOTIFY_SMS_MODE=unisms` + `UNISMS_API_KEY` ([UniSMS](https://unismsapi.com)) for Philippine numbers |

Optional: `APP_NAME`, `APP_URL` (used in email links).

Alerts are sent (when enabled per user) for:

- Registrar **announcements**
- **Request status / schedule** changes (student)
- **Clearance updates** from department officers (student)
- **Request submission** confirmation (student)

In-app bell notifications are always created; email/SMS follow each user’s preferences.

## Notes

- OCR quality depends on image clarity. Final validation always requires registrar approval.
- Signature authenticity verification is out of scope (declared in paper's delimitations).
- To reset the system, delete `data/app.db` and restart the server; demo accounts will be re-seeded.
