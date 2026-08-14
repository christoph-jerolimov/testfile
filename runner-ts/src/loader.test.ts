import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadTestfile, validateDoc, validateSemantics } from "./loader.js";
import type { TestfileDoc } from "./model.js";
import { Session } from "./session.js";

// dist/loader.test.js -> runner-ts -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaTests = join(repoRoot, "schema", "tests");

test("all valid schema examples load", () => {
  for (const file of readdirSync(join(schemaTests, "valid"))) {
    if (file === "include.yaml" || file === "foreach.yaml") {
      // their include/foreach targets exist only in real projects;
      // schema-validate these without expanding them
      const doc: unknown = parse(readFileSync(join(schemaTests, "valid", file), "utf8"));
      validateDoc(doc);
      continue;
    }
    const { doc } = loadTestfile(join(schemaTests, "valid", file));
    assert.equal(doc.version, 0, file);
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
  assert.throws(() => validateDoc({ version: 0, test: { command: "x", script: "y" } }), /\/test/);
});

function docWith(parallel: TestfileDoc["test"]["parallel"]): TestfileDoc {
  return { version: 0, test: { name: "all", parallel } };
}

test("validateSemantics accepts a valid needs DAG", () => {
  validateSemantics(
    docWith([
      { name: "build", command: "true" },
      { name: "unit", needs: ["build"], command: "true" },
      { name: "report", needs: ["build", "unit"], command: "true" },
    ]),
  );
});

test("validateSemantics rejects unknown, ambiguous, self and cyclic needs", () => {
  assert.throws(
    () => validateSemantics(docWith([{ name: "a", needs: ["nope"], command: "true" }])),
    /unknown sibling "nope"/,
  );
  assert.throws(
    () =>
      validateSemantics(
        docWith([
          { name: "dup", command: "true" },
          { name: "dup", command: "true" },
          { name: "b", needs: ["dup"], command: "true" },
        ]),
      ),
    /ambiguous sibling "dup"/,
  );
  assert.throws(
    () => validateSemantics(docWith([{ name: "a", needs: ["a"], command: "true" }])),
    /cannot need itself/,
  );
  assert.throws(
    () =>
      validateSemantics(
        docWith([
          { name: "a", needs: ["b"], command: "true" },
          { name: "b", needs: ["a"], command: "true" },
        ]),
      ),
    /cyclic needs/,
  );
  assert.throws(
    () =>
      validateSemantics({
        version: 0,
        test: { sequence: [{ name: "a", needs: ["b"], command: "true" }] },
      }),
    /only allowed on children of a parallel group/,
  );
});

function includeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-include-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "packages", "a"), { recursive: true });
  mkdirSync(join(dir, "packages", "b"), { recursive: true });
  writeFileSync(join(dir, "packages", "a", "marker-a"), "");
  writeFileSync(
    join(dir, "packages", "a", "Testfile"),
    [
      "version: 0",
      "name: pkg-a",
      "env:",
      "  PKG: a",
      "test:",
      "  name: a tests",
      // runs in packages/a thanks to the include workdir
      '  command: test -f marker-a && test "$PKG" = a',
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "packages", "b", "testfile.yaml"),
    ["version: 0", "name: pkg-b", "ports:", "  web: random", "test:", "  command: 'true'"].join(
      "\n",
    ),
  );
  writeFileSync(
    join(dir, "Testfile"),
    [
      "version: 0",
      "name: root",
      "test:",
      "  name: all",
      "  sequence:",
      "    - name: packages",
      "      include: packages/*",
      "    - name: single",
      "      include: ./packages/a",
    ].join("\n"),
  );
  return dir;
}

test("includes expand globs, merge env/ports and set the workdir", async () => {
  const dir = includeFixture();
  const { doc } = loadTestfile(dir);
  // glob include became a parallel group of both packages
  const packagesNode = doc.test.sequence![0];
  assert.equal(packagesNode.parallel!.length, 2);
  assert.equal(packagesNode.parallel![0].name, "pkg-a");
  assert.equal(packagesNode.parallel![1].name, "pkg-b");
  // included ports merged into the root document
  assert.equal(doc.ports?.web, "random");
  // single include keeps the included name and env
  const singleNode = doc.test.sequence![1];
  assert.equal(singleNode.env?.PKG, "a");
  assert.ok(singleNode.workdir?.endsWith(join("packages", "a")));
  // and the whole thing actually runs, in the included file's directory
  const session = new Session(doc, dir);
  assert.equal(await session.runAll(), "passed");
});

test("include cycles and missing targets are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-cycle-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "Testfile"),
    ["version: 0", "test:", "  include: ./other.yaml"].join("\n"),
  );
  writeFileSync(
    join(dir, "other.yaml"),
    ["version: 0", "test:", "  include: ./Testfile"].join("\n"),
  );
  assert.throws(() => loadTestfile(dir), /include cycle/);

  const dir2 = mkdtempSync(join(tmpdir(), "testfile-missing-"));
  process.on("exit", () => rmSync(dir2, { recursive: true, force: true }));
  writeFileSync(join(dir2, "Testfile"), ["version: 0", "test:", "  include: ./nope"].join("\n"));
  assert.throws(() => loadTestfile(dir2), /include "\.\/nope"/);
});

test("conflicting included ports are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-ports-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "child.yaml"),
    ["version: 0", "ports:", "  web: 8080", "test:", "  command: 'true'"].join("\n"),
  );
  writeFileSync(
    join(dir, "Testfile"),
    ["version: 0", "ports:", "  web: 9090", "test:", "  include: ./child.yaml"].join("\n"),
  );
  assert.throws(() => loadTestfile(dir), /port "web".*conflicts/);
});

test("loadTestfile applies TESTFILE_CONFIG_ overrides and revalidates the result", () => {
  const dir = mkdtempSync(join(tmpdir(), "testfile-config-env-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "Testfile"),
    ["version: 0", "ports:", "  db: random", "test:", "  command: npm test", ""].join("\n"),
  );

  process.env.TESTFILE_CONFIG_ports__db = "15432";
  process.env.TESTFILE_CONFIG_test__command = "npm run smoke";
  try {
    const { doc, overrides } = loadTestfile(dir);
    assert.deepEqual(overrides, [
      { path: "ports.db", from: "TESTFILE_CONFIG_ports__db", value: "15432" },
      { path: "test.command", from: "TESTFILE_CONFIG_test__command", value: "npm run smoke" },
    ]);
    assert.deepEqual(doc.ports, { db: 15432 });
    assert.equal(doc.test.command, "npm run smoke");
  } finally {
    delete process.env.TESTFILE_CONFIG_ports__db;
    delete process.env.TESTFILE_CONFIG_test__command;
  }

  // an override that breaks the document fails the load, it does not run
  process.env.TESTFILE_CONFIG_test__command = "[not, a, command]";
  try {
    assert.throws(() => loadTestfile(dir), /Testfile is not valid/);
  } finally {
    delete process.env.TESTFILE_CONFIG_test__command;
  }
});
