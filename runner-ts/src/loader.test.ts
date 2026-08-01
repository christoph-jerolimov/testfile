import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTestfile, validateDoc, validateSemantics } from "./loader.js";
import type { TestfileDoc } from "./model.js";

// dist/loader.test.js -> runner-ts -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaTests = join(repoRoot, "schema", "tests");

test("all valid schema examples load", () => {
  for (const file of readdirSync(join(schemaTests, "valid"))) {
    const { doc } = loadTestfile(join(schemaTests, "valid", file));
    assert.equal(doc.version, 1, file);
  }
});

test("invalid schema examples are rejected", () => {
  for (const file of readdirSync(join(schemaTests, "invalid"))) {
    assert.throws(() => loadTestfile(join(schemaTests, "invalid", file)), /not valid/, file);
  }
});

test("finds the repository Testfile by directory", () => {
  const { path, doc } = loadTestfile(repoRoot);
  assert.ok(path.endsWith("Testfile"));
  assert.equal(doc.name, "testfile-monorepo");
});

test("validateDoc reports the offending path", () => {
  assert.throws(() => validateDoc({ version: 1, test: { command: "x", script: "y" } }), /\/test/);
});

function docWith(parallel: TestfileDoc["test"]["parallel"]): TestfileDoc {
  return { version: 1, test: { name: "all", parallel } };
}

test("validateSemantics accepts a valid needs DAG", () => {
  validateSemantics(
    docWith([
      { name: "build", command: "true" },
      { name: "unit", needs: ["build"], command: "true" },
      { name: "report", needs: ["build", "unit"], command: "true" },
    ])
  );
});

test("validateSemantics rejects unknown, ambiguous, self and cyclic needs", () => {
  assert.throws(
    () => validateSemantics(docWith([{ name: "a", needs: ["nope"], command: "true" }])),
    /unknown sibling "nope"/
  );
  assert.throws(
    () =>
      validateSemantics(
        docWith([
          { name: "dup", command: "true" },
          { name: "dup", command: "true" },
          { name: "b", needs: ["dup"], command: "true" },
        ])
      ),
    /ambiguous sibling "dup"/
  );
  assert.throws(
    () => validateSemantics(docWith([{ name: "a", needs: ["a"], command: "true" }])),
    /cannot need itself/
  );
  assert.throws(
    () =>
      validateSemantics(
        docWith([
          { name: "a", needs: ["b"], command: "true" },
          { name: "b", needs: ["a"], command: "true" },
        ])
      ),
    /cyclic needs/
  );
  assert.throws(
    () =>
      validateSemantics({
        version: 1,
        test: { sequence: [{ name: "a", needs: ["b"], command: "true" }] },
      }),
    /only allowed on children of a parallel group/
  );
});
