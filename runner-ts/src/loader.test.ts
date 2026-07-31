import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTestfile, validateDoc } from "./loader.js";

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
