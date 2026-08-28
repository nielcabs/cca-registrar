# System Needs — CCA Integrated Requisition and Scheduling System

This document lists **stakeholder-identified needs** for the registrar system, how each maps to current implementation, and what must change to fully satisfy them.

**Legend:** ✅ Implemented · 🟡 Partial · ❌ Not yet implemented

---

## Summary

| # | Need | Status |
|---|------|--------|
| 1 | Student category (Graduate / Graduating / Undergrad) with different clearances | ✅ |
| 2 | Separate completed transactions on the document request list | ✅ |
| 3 | Alumni Office account | ✅ |
| 4 | VPAA account (view-only) | ✅ |
| 5 | Filter by course and section | ✅ |
| 6 | Request multiple documents at once (checkboxes) | ✅ |
| 7 | Receipt upload for non-scholarship students | ✅ |

---

## 1. Student category with category-specific clearances

**Need:** Each student must identify as **Graduate**, **Graduating**, or **Undergraduate**. Each category follows a **different clearance checklist** (which offices must sign off before release).

**Current system:**
- Registration captures name, student ID, email, and password only (`views/register.ejs`).
- Every student receives the **same six** department clearance rows: Library, Budget and Finance, MISSO, SASO, Guidance, Community Extension (`src/db.js` → `DEPARTMENTS`, `ensureClearanceRows`).

**Gap:** No student category field; no per-category clearance templates.

**Proposed changes:**
- Add `student_category` on `users` (values: `graduate`, `graduating`, `undergraduate`).
- Define clearance templates per category (e.g. undergrad → all 6 offices; graduate → may exclude SASO; graduating → subset per handbook).
- Prompt category at registration or registrar verification; regenerate or filter clearance rows when category is set.
- Show category on registrar queue, clearance overview, and student dashboard.

---

## 2. Separation of completed transactions on the document request list

**Need:** The registrar **document request list** should separate **active / in-progress** requests from **completed** transactions (e.g. status `Released`) so staff can focus on pending work without scrolling through finished records.

**Current system:**
- `/admin/requests` shows **one combined table** for all statuses (`views/admin-queue.ejs`).
- Search by name, ID, document type, or request ID only; released count is a stat, not a separate view.

**Gap:** No tab, filter, or dedicated page for completed vs active requests.

**Proposed changes:**
- Add queue filter: **Active** (Submitted, For Verification, Scheduled) vs **Completed** (Released), or separate tabs/sections.
- Default registrar view to active requests; link or tab for completed history.
- Optional: archive completed rows after N days (out of scope unless requested).

---

## 3. Alumni Office account

**Need:** A dedicated **Alumni Office** user role that can manage or view alumni-related clearance or requests (per CCA registrar workflow).

**Current system:**
- Roles: `student`, `registrar`/`admin`, `department` (`README.md`, `src/middleware.js`).
- Six seeded department officers only; no alumni office.

**Gap:** No alumni role, routes, or sidebar.

**Proposed changes:**
- Add role `alumni` (or `department` with `department_code: alumni` if treated as a clearance office).
- Seed demo account (e.g. `alumni@cca.edu.ph`).
- Routes and UI aligned with office duties (clearance updates and/or alumni request queue — confirm with registrar SOP).
- Include Alumni Office in category-specific clearance templates (Need #1) where applicable.

---

## 4. VPAA account (viewing only)

**Need:** **Vice President for Academic Affairs (VPAA)** can **log in and view** registrar data (requests, clearances, reports) **without** creating users, changing status, running OCR, or editing clearances.

**Current system:**
- Only registrar staff have broad read/write access under `/admin/*`.
- No read-only role.

**Gap:** No VPAA role or view-only middleware.

**Proposed changes:**
- Add role `vpaa` with read-only access to dashboard, request queue, clearance overview, and reports (no POST/PUT on process, users, or clearance update routes).
- Middleware: `requireRole` + `requireWriteAccess` or separate `requireRole("registrar", "vpaa")` with write guards on mutating routes.
- Seed demo account (e.g. `vpaa@cca.edu.ph`); hide action buttons in EJS when `user.role === 'vpaa'`.

---

## 5. Filtering by course and section

**Need:** Registrar (and optionally department officers) can **filter** students and document requests by **course** (program) and **section**.

**Current system:**
- No `course` or `section` columns on `users` or `requests`.
- Admin search matches student name, ID, document type, request ID only.

**Gap:** No data fields or filter controls for course/section.

**Proposed changes:**
- Add `course` and `section` to student profile (registration and/or admin user edit).
- Extend `/admin/requests` and `/admin/clearances` GET filters: dropdowns or text fields for course and section.
- Show course/section in queue table and clearance overview.
- Optional: import from enrollment records later (integration out of scope unless specified).

---

## 6. Request multiple documents at once (checkboxes)

**Need:** Students select **several document types in one submission** (checkboxes) instead of filing one request per document.

**Current system:**
- `/student/new-request` uses a **single** `<select name="documentType">` (`views/new-request.ejs`).
- Each POST creates one row in `requests` with one `document_type`.

**Gap:** No multi-select or batch submission.

**Proposed changes:**
- Replace single select with checkbox list of document types.
- On submit: create **one request row per selected document** (shared receipt upload and purpose), or one parent “batch” record with child line items — prefer one row per document for compatibility with existing queue/OCR/scheduling.
- Single payment proof can apply to the whole batch; show linked/batch ID on registrar UI if needed.
- Validate at least one document selected.

---

## 7. Receipt upload for students without scholarship

**Need:** **Non-scholarship** students must upload a **payment receipt**; **scholarship** students may be exempt from receipt upload (or follow a different rule per registrar policy).

**Current system:**
- **Every** student must upload JPG/PNG proof; field is `required` on form and enforced in `src/routes/student.js` (`!req.file` → error).
- No scholarship flag on user profile.

**Gap:** Receipt is mandatory for all; no scholarship distinction.

**Proposed changes:**
- Add `has_scholarship` (boolean) on `users`, set at registration or by registrar on user edit.
- On new request: if `has_scholarship`, make file upload **optional** and allow empty `uploaded_file_path` with status note; if not, keep upload **required**.
- Registrar queue: badge or column indicating “Scholarship — no receipt” vs “Receipt attached”.
- OCR step skipped or hidden when no file uploaded.

---

## Recommended implementation order

For capstone delivery and minimal rework:

1. **Need #7** — Scholarship flag + conditional receipt (small schema + form change).
2. **Need #2** — Active vs completed queue tabs (UI + query filter only).
3. **Need #5** — Course/section fields + filters (schema + admin UI).
4. **Need #6** — Multi-document checkboxes (student UI + batch insert).
5. **Need #1** — Student category + clearance templates (schema + business rules).
6. **Need #3 & #4** — Alumni and VPAA roles (auth, routes, seed accounts).

---

## Related documentation

- Module mapping (what exists today): [`README.md`](../README.md)
- Context and use case diagrams: [`Context_and_Use_Case.md`](Context_and_Use_Case.md)
- DFD Level 1 and ERD: [`SYSTEM_DIAGRAMS.md`](SYSTEM_DIAGRAMS.md)

When needs #1, #3, and #4 are implemented, update the **use case** and **context** diagrams to add actors: **Alumni Office**, **VPAA (view-only)**, and use cases for category selection, batch request, and queue filtering.
