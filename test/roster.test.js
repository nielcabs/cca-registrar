const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseRosterCsv, evaluateRosterMatch, rosterStatusLabel, rosterStatusBadge } = require("../src/roster");

describe("parseRosterCsv", () => {
  it("parses header and rows", () => {
    const csv = `student_id,display_name,email
20230001,Juan Dela Cruz,juan@cca.edu.ph`;
    const rows = parseRosterCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].studentId, "20230001");
    assert.equal(rows[0].displayName, "Juan Dela Cruz");
  });
});

describe("evaluateRosterMatch", () => {
  it("auto-verifies on full roster match", () => {
    const result = evaluateRosterMatch(
      { displayName: "Juan Dela Cruz", studentId: "20230001", email: "juan@cca.edu.ph" },
      {
        studentId: "20230001",
        displayName: "Juan Dela Cruz",
        email: "juan@cca.edu.ph"
      }
    );
    assert.equal(result.status, "full");
    assert.equal(result.autoVerify, true);
  });

  it("requires manual review when ID is missing from roster", () => {
    const result = evaluateRosterMatch(
      { displayName: "New Student", studentId: "99999999", email: "new@cca.edu.ph" },
      null
    );
    assert.equal(result.status, "not_found");
    assert.equal(result.autoVerify, false);
  });
});

describe("roster status labels", () => {
  it("maps roster status to UI labels", () => {
    assert.equal(rosterStatusLabel("full"), "Roster match");
    assert.equal(rosterStatusBadge("not_found"), "badge-rejected");
  });
});
