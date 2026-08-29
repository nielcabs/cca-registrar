const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isRegistrarStaff,
  isSystemAdmin,
  isViewOnlyStaff
} = require("../src/middleware");

describe("role helpers", () => {
  it("treats admin and registrar as registrar staff", () => {
    assert.equal(isRegistrarStaff("registrar"), true);
    assert.equal(isRegistrarStaff("admin"), true);
    assert.equal(isRegistrarStaff("sysadmin"), false);
  });

  it("identifies system administrator role", () => {
    assert.equal(isSystemAdmin("sysadmin"), true);
    assert.equal(isSystemAdmin("registrar"), false);
  });

  it("identifies VPAA view-only role", () => {
    assert.equal(isViewOnlyStaff("vpaa"), true);
    assert.equal(isViewOnlyStaff("registrar"), false);
  });
});
