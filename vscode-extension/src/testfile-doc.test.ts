import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listRuns, listTests, testAtLine } from "./testfile-doc.js";

const doc = `version: 0
name: demo
test:
  name: all
  sequence:
    - name: lint
      command: npm run lint
    - name: checks
      parallel:
        - command: npm run test:unit
        - name: e2e
          command: npm run test:e2e
`;

test("listTests walks the suite with paths, lines and default names", () => {
  const tests = listTests(doc);
  assert.deepEqual(
    tests.map((t) => `${t.line}:${t.path}${t.isGroup ? "/*" : ""}`),
    [
      "3:all/*",
      "5:all/lint",
      "7:all/checks/*",
      "9:all/checks/npm run test:unit",
      "10:all/checks/e2e",
    ]
  );
});

test("listTests tolerates invalid or non-Testfile YAML", () => {
  assert.deepEqual(listTests("just: a map"), []);
  assert.deepEqual(listTests(":::"), []);
});

test("testAtLine picks the test starting closest above the cursor", () => {
  const tests = listTests(doc);
  assert.equal(testAtLine(tests, 6)?.path, "all/lint");
  assert.equal(testAtLine(tests, 10)?.path, "all/checks/e2e");
  assert.equal(testAtLine(tests, 0), undefined, "above the first test");
});

test("listRuns reads run.yaml folders, newest first", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-vscode-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const write = (id: string, startedAt: string): void => {
    mkdirSync(join(dir, ".testfile", "runs", id), { recursive: true });
    writeFileSync(
      join(dir, ".testfile", "runs", id, "run.yaml"),
      `id: ${id}\nstartedAt: ${startedAt}\nstatus: passed\ndurationMs: 3\ntests:\n  - path: all\n    status: passed\n`
    );
  };
  write("20260101-000000-aaaa", "2026-01-01T00:00:00.000Z");
  write("20260102-000000-bbbb", "2026-01-02T00:00:00.000Z");
  mkdirSync(join(dir, ".testfile", "runs", "not-a-run"), { recursive: true });

  const runs = listRuns(dir);
  assert.deepEqual(
    runs.map((run) => run.id),
    ["20260102-000000-bbbb", "20260101-000000-aaaa"]
  );
  assert.equal(runs[0].tests[0].path, "all");
  assert.deepEqual(listRuns(mkdtempSync(join(tmpdir(), "testfile-vscode-empty-"))), []);
});
