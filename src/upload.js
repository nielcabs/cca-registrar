const multer = require("multer");
const path = require("path");
const { UPLOADS_DIR } = require("./db");

const OCR_UPLOAD_MIMES = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf"
];

const OCR_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";

function createOcrUpload() {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".bin";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (OCR_UPLOAD_MIMES.includes(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error("Only JPG, PNG, and PDF files are supported."));
    }
  });
}

module.exports = {
  createOcrUpload,
  OCR_UPLOAD_MIMES,
  OCR_UPLOAD_ACCEPT
};
