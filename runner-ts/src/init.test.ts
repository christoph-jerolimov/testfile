import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { generateTestfile, initTestfile } from "./init.js";
import { loadTestfile, validateDoc } from "./loader.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-init-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("init from package.json scripts builds a sequence with parallel checks", () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "my-app",
      scripts: {
        build: "tsc",
        lint: "eslint .",
        test: "vitest run",
        "test:e2e": "playwright test",
      },
    })
  );
  const { path, content } = initTestfile(dir);
  assert.ok(path.endsWith("Testfile"));
  assert.match(content, /name: my-app/);
  assert.match(content, /yaml-language-server/);
  const doc: unknown = parse(content);
  validateDoc(doc);
  assert.equal(doc.test.sequence![0].name, "build");
  const checks = doc.test.sequence![1];
  assert.equal(checks.name, "checks");
  assert.deepEqual(
    checks.parallel!.map((c) => c.name),
    ["lint", "test", "e2e"]
  );
  assert.deepEqual(checks.parallel![0].tags, ["fast"]);
  // and the generated file loads through the normal loader
  const loaded = loadTestfile(dir);
  assert.equal(loaded.doc.name, "my-app");
});

test("init without package.json writes a valid placeholder", () => {
  const dir = tempDir();
  const content = generateTestfile(dir);
  const doc: unknown = parse(content);
  validateDoc(doc);
  assert.match(content, /no tests configured yet/);
});

test("init with only a test script produces a single command", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
  const content = generateTestfile(dir);
  const doc: unknown = parse(content);
  validateDoc(doc);
  assert.equal(doc.test.command, "npm test");
  assert.equal(doc.test.sequence, undefined);
});

test("init refuses to overwrite an existing Testfile", () => {
  const dir = tempDir();
  writeFileSync(join(dir, "testfile.yaml"), "version: 0\ntest:\n  command: 'true'\n");
  assert.throws(() => initTestfile(dir), /already exists/);
});
