const path = require("path");
const Tesseract = require("tesseract.js");

const LANG_PATH = path.join(__dirname, "..");

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

module.exports = { runOcr, parseOcrFields };
