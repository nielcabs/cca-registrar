# System Credentials — CCA Registrar Defense

**All passwords are the same: `cca123`**

---

## Administrator

| Email | Password | What They Can Do |
|---|---|---|
| `admin@cca.edu.ph` | `cca123` | Verify students, manage all users, view reports and audit log |

---

## Registrar Staff

| Email | Password | What They Can Do |
|---|---|---|
| `registrar@cca.edu.ph` | `cca123` | Process requests, run OCR, assign release slots, view clearances |

---

## Students

| Email | Password | Student ID | Status | Notes |
|---|---|---|---|---|
| `juan@cca.edu.ph` | `cca123` | `20230001` | Verified | Has existing request DEMO1001, partially cleared |
| `maria@cca.edu.ph` | `cca123` | `20230002` | Verified | Fully cleared, scheduled request DEMO1002 |
| `pedro@cca.edu.ph` | `cca123` | `20230003` | **Unverified** | Use to demo the verification gate |

---

## Department Officers (6 offices)

Each officer can only update their own department's clearance.

| Office | Email | Password |
|---|---|---|
| Library | `library@cca.edu.ph` | `cca123` |
| Budget and Finance Office | `finance@cca.edu.ph` | `cca123` |
| MISSO (Multimedia & Info Systems) | `misso@cca.edu.ph` | `cca123` |
| SASO (Student Affairs & Service) | `saso@cca.edu.ph` | `cca123` |
| Guidance Office | `guidance@cca.edu.ph` | `cca123` |
| Community Extension (NSTP) | `extension@cca.edu.ph` | `cca123` |

---

## Recommended Defense Demo Flow

### Story: "A student requests a Transcript of Records"

**1. Registration + Verification (Admin Module)**
- Log in as `pedro@cca.edu.ph` → dashboard shows "Account pending verification"
- Try to create a New Request → system blocks with 403
- Switch to `admin@cca.edu.ph` → **Verify Students** → click "Verify Now" for Pedro

**2. Document Request Submission (Student Module)**
- Log in as `juan@cca.edu.ph`
- Click **New Request**
- Document type: `Transcript of Records`
- Purpose: `Scholarship application`
- Upload: `assets/sample-receipt-ocr.png` (or any JPG/PNG receipt)
- Submit

**3. Clearance Verification (Department Officer Module)**
- Log in as `library@cca.edu.ph` → locate student `20230001` → mark **Cleared** → Save
- Log in as `finance@cca.edu.ph` → mark **Cleared** → Save
- (Repeat for MISSO, SASO, Guidance, Extension — or show that Juan is already partly cleared)

**4. OCR Innovation (Registrar Module)**
- Log in as `registrar@cca.edu.ph`
- Open Juan's latest request
- Click **Run OCR** → wait 3–5 seconds
- Point out: extracted Student Name, Student ID, OR Number, Amount, Date + confidence score
- Manually correct one field to show the "assistive, not replacement" principle

**5. Scheduling (Registrar Module)**
- Still on Juan's request page
- **Pick Release Slot** → choose any available date+time
- Set Status → `Scheduled` → Save Updates
- Point out: system enforces clearance rule + slot capacity

**6. Student Tracking (Student Module)**
- Log in as `juan@cca.edu.ph` → **Track** the request
- Show: status = Scheduled, release date/time visible

**7. Reports (Admin Module)**
- Log in as `admin@cca.edu.ph` → **Reports**
- Show: transaction stats, top document types, monthly volume, audit log

---

## If Something Goes Wrong Mid-Demo

| Problem | Solution |
|---|---|
| Can't log in | Check caps lock; password is exactly `cca123` (lowercase) |
| OCR hangs on free tier | Wait 20s, or switch to local deployment |
| Page very slow on first load | Free tier was asleep — takes 30s to wake up |
| Need to reset everything | Delete `data/app.db` and restart — all demo accounts re-seed |
| Deployed version is down | Fall back to `npm start` on local laptop |
