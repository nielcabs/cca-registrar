const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { isPaymentReceiptRequired, hasUploadedReceipt } = require("../src/helpers");

describe("isPaymentReceiptRequired", () => {
  it("never requires a receipt on document requests", () => {
    assert.equal(isPaymentReceiptRequired({ hasScholarship: false }), false);
    assert.equal(isPaymentReceiptRequired({ hasScholarship: true }), false);
    assert.equal(isPaymentReceiptRequired({}), false);
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
