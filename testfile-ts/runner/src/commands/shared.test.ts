import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Session, type TestfileDoc } from "../index.js";
import { suiteJson, wantsJson, writeJson } from "./shared.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const doc: TestfileDoc = {
  version: 0,
  services: { db: { command: "postgres" } },
  test: {
    name: "ci",
    sequence: [
      { name: "lint", command: "oxlint", tags: ["fast"] },
      {
        name: "unit",
        command: "npm test",
        tags: ["slow"],
        services: { redis: { command: "redis-server" } },
        matrix: { node: ["20", "22"] },
      },
    ],
  },
};

test("wantsJson tells a given flag from an absent one", () => {
  assert.equal(wantsJson(undefined), false);
  assert.equal(wantsJson(false), false);
  // `--json` on its own is `true`, `--json out.json` is the file name - and
  // an empty string would be a file name too, not an absent flag.
  assert.equal(wantsJson(true), true);
  assert.equal(wantsJson("out.json"), true);
  assert.equal(wantsJson(""), true);
});

test("writeJson writes a named file, and pretty-prints with a trailing newline", () => {
  const file = join(tempDir(), "out.json");
  writeJson({ a: 1, b: ["x"] }, file, "result");
  const text = readFileSync(file, "utf8");
  assert.ok(text.endsWith("\n"));
  assert.deepEqual(JSON.parse(text), { a: 1, b: ["x"] });
  assert.match(text, /\n  "a": 1/);
});

test("suiteJson lists the selected tests in execution order, flattened by path", () => {
  const session = new Session(doc, tempDir());
  const active = session.activeSetFor([session.suite.id]);
  const entries = suiteJson(session, active);

  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["ci", "ci/lint", "ci/unit", "ci/unit/unit (node=20)", "ci/unit/unit (node=22)"],
  );
  assert.deepEqual(entries[0], { path: "ci", name: "ci", kind: "sequence" });
  assert.deepEqual(entries[1], { path: "ci/lint", name: "lint", kind: "command", tags: ["fast"] });

  // The instances share the wrapper's definition, so its tags are listed once
  // on the wrapper - but the services are started per instance, and listed
  // there. Both follow what the plain-text listing prints.
  assert.deepEqual(entries[2], { path: "ci/unit", name: "unit", kind: "matrix", tags: ["slow"] });
  assert.deepEqual(entries[3], {
    path: "ci/unit/unit (node=20)",
    name: "unit (node=20)",
    kind: "command",
    matrix: { node: "20" },
    services: ["redis"],
  });
});

test("suiteJson only reports what the filters left active", () => {
  const session = new Session(doc, tempDir());
  const lint = [...session.byId.values()].find((t) => t.path === "ci/lint")!;
  const entries = suiteJson(session, session.activeSetFor([lint.id]));
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["ci", "ci/lint"],
  );
});
