const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const Tesseract = require("tesseract.js");

const LANG_PATH = path.join(__dirname, "..");

let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = null;
}

/** CCA clearance form order (Dean is on paper but excluded from the system). */
const CLEARANCE_OFFICE_ORDER = [
  "library",
  "misso",
  "extension",
  "guidance",
  "saso",
  "finance",
  "registrar"
];

const CLEARANCE_OFFICE_HINTS = [
  { code: "library", patterns: [/library/i, /\blibr/i] },
  {
    code: "misso",
    patterns: [/misso/i, /multimedia/i, /information\s*systems/i, /\bmis\s*office/i]
  },
  {
    code: "extension",
    patterns: [/community\s*extension/i, /\bnstp\b/i, /extension\s*office/i]
  },
  {
    code: "guidance",
    patterns: [/guidance/i, /admission\s*office/i, /counsel/i]
  },
  {
    code: "saso",
    patterns: [/\bsaso\b/i, /student\s*affairs/i, /affairs\s*and\s*service/i]
  },
  { code: "finance", patterns: [/finance/i, /budget/i] },
  { code: "registrar", patterns: [/registrar/i] },
  { code: "alumni", patterns: [/alumni/i] }
];

const DEAN_PATTERNS = [/office\s*of\s*the\s*dean/i, /\bdean\b/i];

function parseOcrFields(rawText) {
  const text = rawText.replace(/\r/g, "");
  const fields = {
    studentName: "",
    studentId: "",
    orNumber: "",
    amount: "",
    paymentDate: ""
  };

  const nameMatch = text.match(
    /(?:Student\s*Name|Name)\s*[:\-]?\s*([A-Za-z ,.'-]{5,})/i
  );
  const studentIdMatch = text.match(
    /(?:Student\s*(?:No|ID|Number)?|ID)\s*[:\-]?\s*([0-9]{4,})/i
  );
  const orMatch = text.match(
    /(?:OR|O\.R\.|Reference|Ref(?:erence)?\s*No\.?)\s*[:#\-]?\s*([A-Z0-9-]{4,})/i
  );
  const amountMatch = text.match(
    /(?:Amount|Total|Paid)\s*[:\-]?\s*(?:PHP|P|Php)?\s*([0-9]+(?:[.,][0-9]{2})?)/i
  );
  const dateMatch = text.match(
    /(?:Date|Payment\s*Date|Paid\s*On)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i
  );

  if (nameMatch) fields.studentName = nameMatch[1].trim();
  if (studentIdMatch) fields.studentId = studentIdMatch[1].trim();
  if (orMatch) fields.orNumber = orMatch[1].trim();
  if (amountMatch) fields.amount = amountMatch[1].trim();
  if (dateMatch) fields.paymentDate = dateMatch[1].trim();

  return fields;
}

function normalizeOcrText(rawText) {
  return rawText
    .replace(/\r/g, "")
    .replace(/[|]/g, "I")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStudentId(text) {
  const labeled =
    text.match(
      /Student\s*(?:No\.?|Number|ID)\s*[:\-]?\s*(\d{2}\s*[-–]?\s*\d{3,4})/i
    ) ||
    text.match(/Student\s*(?:No\.?|Number|ID)\s*[:\-]?\s*([A-Z0-9-]{4,})/i);
  if (labeled) {
    return labeled[1].replace(/\s+/g, "").replace(/[–]/g, "-");
  }
  const loose = text.match(/\b(\d{2}-\d{3,4})\b/);
  return loose ? loose[1] : "";
}

function titleCaseNamePart(part) {
  return part.trim().replace(/\s+/g, " ");
}

function formatLastFirstName(raw) {
  const lastFirst = raw.match(/^([A-Za-z][A-Za-z'-]+),\s*(.+)$/);
  if (lastFirst) {
    return `${titleCaseNamePart(lastFirst[2])} ${titleCaseNamePart(lastFirst[1])}`;
  }
  return titleCaseNamePart(raw);
}

function isPlausibleStudentName(name) {
  if (!name || name.length < 5) return false;
  if (/\b(png|jpg|jpeg|upload|ocr|clearance form|image|max|choose file|department)\b/i.test(name)) {
    return false;
  }
  return /[A-Za-z]{2,}/.test(name);
}

function extractStudentName(text) {
  const labeled = text.match(
    /(?:^|\n|\s)Name\s*[:\-]?\s*([A-Za-z][^\n]+?)(?=\s+Student\s*(?:No|Number|ID)\b|\s+Course\b|\s+Year\b|\s+Section\b|\n|$)/i
  );
  if (labeled) {
    return formatLastFirstName(labeled[1]);
  }

  const lastFirst = text.match(/\b([A-Za-z][A-Za-z'-]+),\s*([A-Za-z][A-Za-z\s.'-]{2,40})/);
  if (lastFirst) {
    return `${titleCaseNamePart(lastFirst[2])} ${titleCaseNamePart(lastFirst[1])}`;
  }

  return "";
}

function extractClearanceDate(text) {
  const academicYear = text.match(
    /Academic\s*Year\s*[:\-]?\s*(\d{4}\s*[-–]\s*\d{4})/i
  );
  if (academicYear) return academicYear[1].replace(/\s+/g, " ");

  const signedDate = text.match(
    /(?:Date|Date\s*Signed|Clearance\s*Date)\s*[:\-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4})/i
  );
  if (signedDate) return signedDate[1];

  const dates = text.match(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g);
  if (dates && dates.length) return dates[dates.length - 1];

  return "";
}

function detectClearanceOffices(text) {
  const found = new Set();
  const lower = text.toLowerCase();

  for (const hint of CLEARANCE_OFFICE_HINTS) {
    if (hint.code === "registrar" && DEAN_PATTERNS.some((re) => re.test(text))) {
      // Registrar pattern can false-match inside "Dean" on noisy OCR — require registrar keyword.
      if (!/registrar/i.test(text)) continue;
    }
    if (hint.patterns.some((re) => re.test(lower) || re.test(text))) {
      if (hint.code !== "alumni" || /alumni/i.test(text)) {
        found.add(hint.code);
      }
    }
  }

  // Never treat Dean as a clearance office in this system.
  found.delete("dean");

  return CLEARANCE_OFFICE_ORDER.filter((code) => found.has(code));
}

function parseClearanceOcrFields(rawText) {
  const text = normalizeOcrText(rawText);
  let studentName = extractStudentName(text);
  if (!isPlausibleStudentName(studentName)) {
    studentName = "";
  }
  const fields = {
    studentName,
    studentId: extractStudentId(text),
    clearanceDate: extractClearanceDate(text),
    detectedOffices: detectClearanceOffices(text)
  };

  return fields;
}

function scoreClearanceParse(fields) {
  let score = 0;
  if (fields.studentName) score += 3;
  if (fields.studentId) score += 3;
  if (fields.clearanceDate) score += 1;
  score += fields.detectedOffices.length;
  return score;
}

async function runOcr(imagePath) {
  const result = await Tesseract.recognize(imagePath, "eng", {
    langPath: LANG_PATH,
    cachePath: LANG_PATH
  });
  return {
    rawText: result.data.text,
    confidence: Number(result.data.confidence.toFixed(2))
  };
}

async function buildPreprocessedVariants(imagePath) {
  const variants = [{ label: "original", path: imagePath }];

  if (!sharp) return variants;

  const tmpDir = path.join(os.tmpdir(), "cca-clearance-ocr");
  await fs.mkdir(tmpDir, { recursive: true });
  const base = path.basename(imagePath, path.extname(imagePath));

  const pipelines = [
    {
      label: "enhanced",
      fn: (img) =>
        img.rotate().resize({ width: 2200, withoutEnlargement: false }).grayscale().normalize().sharpen()
    },
    {
      label: "contrast",
      fn: (img) =>
        img
          .rotate()
          .resize({ width: 2200, withoutEnlargement: false })
          .grayscale()
          .linear(1.35, -40)
          .sharpen()
    }
  ];

  for (const pipe of pipelines) {
    const outPath = path.join(tmpDir, `${base}-${pipe.label}.png`);
    try {
      await pipe.fn(sharp(imagePath)).png().toFile(outPath);
      variants.push({ label: pipe.label, path: outPath });
    } catch {
      // skip failed variant
    }
  }

  return variants;
}

function isPdfFile(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

async function extractPdfText(filePath) {
  const pdfParse = require("pdf-parse");
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text || "";
}

async function pdfFirstPageToImagePath(filePath) {
  const { pdf } = require("pdf-to-img");
  const tmpDir = path.join(os.tmpdir(), "cca-pdf-ocr");
  await fs.mkdir(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `${path.basename(filePath, ".pdf")}-${Date.now()}.png`);
  let wrote = false;
  for await (const page of pdf(filePath, { scale: 2 })) {
    await fs.writeFile(outPath, page);
    wrote = true;
    break;
  }
  if (!wrote) {
    throw new Error("PDF has no pages to OCR.");
  }
  return outPath;
}

async function runOcrOnFile(filePath) {
  if (isPdfFile(filePath)) {
    const rawText = (await extractPdfText(filePath)).trim();
    if (rawText.length >= 40) {
      return {
        rawText,
        confidence: 85,
        source: "pdf"
      };
    }

    const pngPath = await pdfFirstPageToImagePath(filePath);
    try {
      const result = await runOcr(pngPath);
      return { ...result, source: "pdf-scan" };
    } finally {
      await fs.unlink(pngPath).catch(() => {});
    }
  }

  const result = await runOcr(filePath);
  return { ...result, source: "image" };
}

/**
 * Run OCR tuned for CCA clearance forms: tries preprocessed variants and keeps the best parse.
 */
async function runClearanceOcr(imagePath) {
  const variants = await buildPreprocessedVariants(imagePath);
  let best = { rawText: "", confidence: 0, extracted: parseClearanceOcrFields(""), score: 0 };

  for (const variant of variants) {
    try {
      const { rawText, confidence } = await runOcr(variant.path);
      const extracted = parseClearanceOcrFields(rawText);
      const score = scoreClearanceParse(extracted) + confidence / 100;
      if (score > best.score) {
        best = { rawText, confidence, extracted, score };
      }
    } catch {
      // try next variant
    }
  }

  if (!best.rawText) {
    throw new Error("OCR could not read the clearance image.");
  }

  return {
    rawText: best.rawText,
    confidence: best.confidence,
    extracted: best.extracted
  };
}

async function runClearanceOcrOnFile(filePath) {
  if (isPdfFile(filePath)) {
    const rawText = (await extractPdfText(filePath)).trim();
    if (rawText.length >= 40) {
      const extracted = parseClearanceOcrFields(rawText);
      return { rawText, confidence: 85, extracted };
    }

    const pngPath = await pdfFirstPageToImagePath(filePath);
    try {
      return await runClearanceOcr(pngPath);
    } finally {
      await fs.unlink(pngPath).catch(() => {});
    }
  }
  return runClearanceOcr(filePath);
}

module.exports = {
  runOcr,
  runOcrOnFile,
  runClearanceOcr,
  runClearanceOcrOnFile,
  parseOcrFields,
  parseClearanceOcrFields,
  CLEARANCE_OFFICE_ORDER,
  isPdfFile
};
