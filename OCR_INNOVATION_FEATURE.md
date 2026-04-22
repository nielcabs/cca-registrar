# OCR Innovation Feature (Pre-Oral Scope)

## Purpose
Add OCR as an innovation feature to support faster verification and reduced manual encoding in the Integrated Requisition and Scheduling System.

This feature is **assistive**, not a replacement for registrar approval. OCR outputs can be edited by staff before final submission.

## Pre-Oral Goal
Deliver a demo-ready OCR module that can:

1. accept an uploaded image (jpg/jpeg/png) or scanned receipt/document;
2. extract text automatically;
3. map key fields into form inputs; and
4. allow manual correction before saving.

## Suggested OCR Use Cases (Choose at least one for demo)

### A) Payment Receipt OCR (Recommended)
- Extract:
  - payer/student name
  - OR/reference number
  - amount
  - payment date
- Auto-fill request verification form.

### B) Clearance Slip OCR
- Extract:
  - student name
  - student number
  - department names/status keywords
- Use for preliminary tagging only; registrar still validates final status.

## Why This Fits as Innovation
- Reduces manual retyping workload
- Speeds up request validation
- Improves consistency of encoded data
- Easy to demo in pre-oral with measurable benefit (time saved)

## Functional Scope (50% Main System + Innovation)

### Core Main Functions (MVP)
- Student document request
- Request tracking
- Appointment scheduling
- Registrar dashboard for status updates

### OCR Innovation Layer
- Upload file endpoint
- OCR processing
- Parsed field suggestions
- Confidence display
- Manual edit + save confirmation

## Non-Functional Requirements (OCR)
- Processing time: target <= 5 seconds per image (normal quality)
- Accuracy target: at least 75% character-level on clear scans
- File size limit: 5 MB
- Supported formats: JPG, JPEG, PNG, PDF (optional for post pre-oral)
- Privacy: store only required extracted fields and secure uploaded files

## Proposed Architecture

1. Frontend Upload UI
   - Upload image
   - Preview extracted text
   - Show suggested fields and confidence
2. OCR Service
   - Image pre-processing (grayscale, threshold, denoise)
   - OCR engine call
   - Regex/rule-based field extraction
3. Application Service
   - Validate extracted fields
   - Save edited final values
4. Database
   - Keep both raw OCR text and final corrected values (optional but useful for audit)

## Data Model Additions

Add a table for OCR processing logs:

- `ocr_logs`
  - `id`
  - `request_id` (FK to requisition record)
  - `original_file_path`
  - `raw_text`
  - `parsed_json`
  - `confidence_score`
  - `processed_by`
  - `processed_at`
  - `status` (`pending`, `processed`, `corrected`, `failed`)

## UI Additions

### Student Side
- Upload proof document while creating request (optional)

### Registrar Side
- "Run OCR" button
- Extracted text panel
- Suggested fields side panel
- Confidence indicator
- "Apply Suggested Values" + manual edit fields
- Save final verification result

## Demo Script for Pre-Oral

1. Student submits request and uploads payment receipt image.
2. Registrar opens the request and clicks "Run OCR."
3. System extracts OR number/date/amount and suggests values.
4. Registrar corrects one field manually (to show validation control).
5. Request status updated and scheduling continues.
6. Show before/after processing time comparison.

## Simple Success Metrics for Presentation
- Manual encoding time (before OCR) vs assisted encoding time (after OCR)
- OCR extraction success rate per sample set
- User satisfaction (registrar feedback via Likert scale)

## Limitations to Declare in Pre-Oral
- OCR accuracy depends on image quality and handwriting clarity.
- OCR does not guarantee authenticity of signatures.
- Final approval remains with registrar staff.
- Full PDF/multi-page OCR and advanced NLP are post pre-oral enhancements.

## Suggested Tech Options

### Option 1 (Fast and Free)
- Tesseract OCR + OpenCV preprocessing

### Option 2 (Higher accuracy, paid/cloud)
- Google Vision API / Azure OCR / AWS Textract

For pre-oral, Option 1 is enough for proof-of-concept.

## Risk Controls
- Always allow manual override
- Mark low-confidence extractions for review
- Keep OCR as "assistive" in all user messaging
- Restrict file upload types and size

## Final Positioning Statement (For Defense)
"The OCR module is introduced as an innovation feature to reduce repetitive manual encoding and accelerate verification. It enhances efficiency while retaining registrar authority through manual validation and approval."
