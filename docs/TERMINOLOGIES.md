# Terminologies — CCA Registrar Office (CASUGANATICS)

Standard terms used across the application UI, reports, and documentation.

## Roles

| Term | Meaning |
| --- | --- |
| **Student** | Enrolled or alumni user who submits document requisitions and tracks clearance |
| **Registrar office staff** | Admin/registrar role — manages queue, users, scheduling, and reports |
| **Department officer** | Staff for one clearance office (Library, Finance, MISSO, etc.) |
| **VPAA** | View-only registrar access (no user or announcement edits) |

## Student profile

| Term | Field | Notes |
| --- | --- | --- |
| **Institute** | `course` column in database | Program or college (e.g. BS Information Technology). Shown as **Institute** in the UI |
| **Section** | `section` | Class section (e.g. A, B) |
| **Student category** | `student_category` | Undergraduate, Graduating, or Graduate (Alumni) — determines required clearance offices |
| **Scholarship flag** | `has_scholarship` | Set by **registrar/admin only** (not during student self-registration) |
| **Tuition payment** | `tuition_payment_status` | Unpaid → For Verification (after receipt upload) → Paid / Partial; Scholarship when registrar assigns grant |
| **Tuition receipt** | `tuition_receipt_path` | Uploaded by student at **Tuition payment** (`/student/tuition`) |

## Tuition payment (Finance office)

Students upload their tuition OR at **Student portal → Tuition payment** (unless marked as scholar by the registrar).

Finance officers see a **Tuition** column and **Receipt** link on their dashboard with status per student:

| Status | Meaning |
| --- | --- |
| **Unpaid** | No tuition receipt uploaded yet |
| **For Verification** | Student uploaded OR — Finance should review |
| **Paid** | Full tuition payment confirmed |
| **Partial** | Installment / partial payment |
| **Scholarship** | Registrar assigned scholarship — no receipt required |

Finance can update tuition status (except Scholarship — that comes from registrar). Scholarship is toggled on **Admin → User accounts → Edit user**.

## Document requisition

| Term | Meaning |
| --- | --- |
| **Document requisition** | Student request for official documents (TOR, COE, etc.) |
| **Payment proof / OR receipt** | Optional JPG/PNG upload attached to a requisition batch |
| **Batch ID** | Shared identifier when multiple documents are submitted in one transaction |
| **Release appointment** | Scheduled date/time slot for document pickup |

### Request status values

- **Submitted** — just received
- **For Verification** — payment/OCR under review
- **Scheduled** — release slot assigned
- **Released** — document handed over
- **Rejected** — request denied

## Clearance

Department officers record whether a student has a **signed clearance slip** for their office.

### Per-office status (clearance row)

| Status | Meaning |
| --- | --- |
| **Pending** | Not yet reviewed |
| **Signed** | Requirements satisfied; signed slip on file |
| **Not Signed** | Student must return or requirements incomplete |

> Legacy data may still show *Cleared* / *Not Cleared* — the system migrates these to **Signed** / **Not Signed** on startup.

### Overall clearance summary (student)

| Summary | Meaning |
| --- | --- |
| **Pending** | No office signed yet |
| **Partially Signed** | Some required offices signed |
| **Signed** | All required offices signed |
| **Not Signed** | At least one office marked Not Signed |

A document requisition may only move to **Scheduled** or **Released** when overall clearance is **Signed**.

## Filtering (registrar)

| Filter | Applies to |
| --- | --- |
| **Institute** | Document queue, clearance overview, user accounts |
| **Section** | Document queue, clearance overview, user accounts |

## Brand colors (UI)

Based on the CCA logo:

- **Primary green** — `#4a6340` (shield background)
- **Light green** — `#6b8f5e`, `#e8efe4` (accents, soft backgrounds)
- **Bronze / gold** — `#a67c3d`, `#8b6914` (accent, clearance highlights)
- **White** — `#ffffff` (cards, text on dark banners)
