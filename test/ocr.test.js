const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseOcrFields, parseClearanceOcrFields } = require("../src/ocr");
const { compareClearanceOcrToProfile } = require("../src/clearanceOcrHelpers");

describe("parseOcrFields", () => {
  it("extracts payment receipt fields from labeled text", () => {
    const text = `
      Student Name: Juan Dela Cruz
      Student ID: 20230001
      OR: OR-12345
      Amount: PHP 1500.00
      Payment Date: Jan 15, 2026
    `;
    const fields = parseOcrFields(text);
    assert.equal(fields.studentName, "Juan Dela Cruz");
    assert.equal(fields.studentId, "20230001");
    assert.equal(fields.orNumber, "OR-12345");
    assert.match(fields.amount, /1500/);
    assert.match(fields.paymentDate, /2026/);
  });
});

describe("parseClearanceOcrFields", () => {
  it("detects CCA clearance offices in order", () => {
    const text = `
      Name: Casuga, Joshua Louise
      Student No: 23-0343
      Library MISSO Community Extension Guidance Student Affairs Finance Registrar
    `;
    const fields = parseClearanceOcrFields(text);
    assert.equal(fields.studentId, "23-0343");
    assert.ok(fields.detectedOffices.includes("library"));
    assert.ok(fields.detectedOffices.includes("registrar"));
  });
});

describe("compareClearanceOcrToProfile", () => {
  it("flags mismatched student IDs", () => {
    const result = compareClearanceOcrToProfile(
      { displayName: "Juan Dela Cruz", studentId: "20230001" },
      { studentName: "Juan Dela Cruz", studentId: "99999999" }
    );
    assert.equal(result.idMatch, false);
    assert.ok(result.warnings.length > 0);
  });
});
