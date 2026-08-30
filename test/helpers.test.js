const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { isPaymentReceiptRequired, hasUploadedReceipt } = require("../src/helpers");

describe("isPaymentReceiptRequired", () => {
  it("requires a receipt for regular students", () => {
    assert.equal(isPaymentReceiptRequired({ hasScholarship: false }), true);
    assert.equal(isPaymentReceiptRequired({}), true);
  });

  it("allows scholarship students to skip a receipt", () => {
    assert.equal(isPaymentReceiptRequired({ hasScholarship: true }), false);
  });
});

describe("hasUploadedReceipt", () => {
  it("rejects missing or empty files", () => {
    assert.equal(hasUploadedReceipt(undefined), false);
    assert.equal(hasUploadedReceipt({ size: 0 }), false);
  });

  it("accepts a non-empty upload", () => {
    assert.equal(hasUploadedReceipt({ size: 1024 }), true);
  });
});
