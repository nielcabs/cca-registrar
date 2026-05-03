# Integrated Requisition and Scheduling System for CCA Registrar's Office

Web-based system that digitizes document requests, clearance verification, and release scheduling for the City College of Angeles Registrar's Office.

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
- **File Upload:** Multer (5 MB limit, JPG/PNG)
- **OCR Engine:** Tesseract.js with English traineddata
- **Date Utility:** Day.js
- **PDF reports:** `pdfkit` (download from Reports page)

## Roles

1. **Student** — submits requests, tracks status, views clearance (no separate admin “verify” step)
2. **Administrator / Registrar (single role)** — document queue, OCR, scheduling, clearance monitoring, reports + PDF, user accounts
3. **Department Officer** — updates their office’s clearance per student (with search)

Six department officers are provisioned:
Library, Budget and Finance, MISSO, SASO, Guidance, Community Extension (NSTP).

## Clearance Rule

A request can only move to `Scheduled` or `Released` when all 6 department clearances are marked `Cleared`. The registrar cannot bypass this rule from the UI.

## Scheduling Rule

Release slots are limited to weekdays, 08:00–15:00 (hourly), capacity of 5 students per slot. Full slots are disabled in the picker.

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start server:

   ```bash
   npm start
   ```

3. Open:

   [http://localhost:3000](http://localhost:3000)

## Seeded Demo Accounts (password for all = `cca123`)

| Email | Role | Notes |
|---|---|---|
| `admin@cca.edu.ph` | Admin + Registrar | Full office functions; use for OCR & scheduling |
| `juan@cca.edu.ph` | Student (SID 20230001) | Seeded request DEMO1001 |
| `maria@cca.edu.ph` | Student (SID 20230002) | Fully cleared, scheduled DEMO1002 |
| `pedro@cca.edu.ph` | Student (SID 20230003) | Can submit like other students |
| `library@cca.edu.ph` | Department Officer | Library clearance |
| `finance@cca.edu.ph` | Department Officer | Budget and Finance |
| `misso@cca.edu.ph` | Department Officer | MISSO |
| `saso@cca.edu.ph` | Department Officer | SASO |
| `guidance@cca.edu.ph` | Department Officer | Guidance Office |
| `extension@cca.edu.ph` | Department Officer | Community Extension / NSTP |

## Demo Script (for Defense / Pre-Oral)

1. Log in as `juan@cca.edu.ph` → **New document request** → upload payment proof → submit.
2. Log in as `library@cca.edu.ph` → use **search** if needed → mark Juan **Cleared** (repeat for other offices as needed).
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

## Notes

- OCR quality depends on image clarity. Final validation always requires registrar approval.
- Signature authenticity verification is out of scope (declared in paper's delimitations).
- To reset the system, delete `data/app.db` and restart the server; demo accounts will be re-seeded.
