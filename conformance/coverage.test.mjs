import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCoverage, headings, NOT_EXECUTABLE, readCases } from "./coverage.mjs";

const SPEC = `# Testfile format

Intro text.

## Services

\`\`\`yaml
## not a heading, this is inside a fence
\`\`\`

### Readiness (\`ready\`)

## Exit code
`;

test("headings are the spec's sections, without backticks or fenced lines", () => {
  assert.deepEqual(headings(SPEC), ["Services", "Readiness (ready)", "Exit code"]);
});

test("a section nobody covers is a problem", () => {
  const { problems, coverage } = checkCoverage(
    [{ id: "01-x", sections: ["Services"] }],
    headings(SPEC),
    [],
  );
  assert.deepEqual(coverage.get("Services"), ["01-x"]);
  assert.deepEqual(
    problems.filter((problem) => problem.startsWith("no case covers")),
    [
      'no case covers "Readiness (ready)" - add one, or list the section in NOT_EXECUTABLE with a reason',
      'no case covers "Exit code" - add one, or list the section in NOT_EXECUTABLE with a reason',
    ],
  );
});

test("a renamed section is caught on both sides", () => {
  const { problems } = checkCoverage(
    [
      { id: "01-x", sections: ["Servcies"] },
      { id: "02-y", sections: ["RESULTS.md#Merged runs"] },
      { id: "03-z", sections: ["RESULTS.md#Gone"] },
      { id: "04-none", sections: [] },
    ],
    ["Services"],
    ["Merged runs"],
  );
  assert.ok(problems.includes('01-x: spec/TESTFILE.md has no "Servcies" section'));
  assert.ok(problems.includes('03-z: spec/RESULTS.md has no "Gone" section'));
  assert.ok(problems.includes('04-none: expected.yaml declares no "spec:" section'));
  assert.ok(
    !problems.some((problem) => problem.startsWith("02-y")),
    "a valid result-format reference is accepted",
  );
});

test("an exemption for a section that no longer exists is reported", () => {
  const { problems } = checkCoverage([{ id: "01-x", sections: ["Services"] }], ["Services"], []);
  for (const section of Object.keys(NOT_EXECUTABLE)) {
    assert.ok(
      problems.includes(`NOT_EXECUTABLE names "${section}", which is no longer a spec section`),
    );
  }
});

test("every case in this repository declares its sections", () => {
  const cases = readCases();
  assert.ok(cases.length >= 26, `expected the full suite, got ${cases.length} cases`);
  for (const { id, sections } of cases) {
    assert.ok(sections.length > 0, `${id} declares no spec section`);
  }
});
