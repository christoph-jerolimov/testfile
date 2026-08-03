import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEach, expandForeach, matchPaths } from "./foreach.js";
import { loadTestfile } from "./loader.js";
import type { TestDef } from "./model.js";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-foreach-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  for (const pkg of ["api", "ui", "legacy"]) {
    mkdirSync(join(dir, "packages", pkg), { recursive: true });
    writeFileSync(join(dir, "packages", pkg, "package.json"), "{}");
  }
  writeFileSync(join(dir, "packages", "notes.md"), "hi");
  return dir;
}

test("matchPaths returns folders by default, alphabetically", () => {
  const dir = fixture();
  assert.deepEqual(
    matchPaths("packages/*", dir).map((match) => match.path),
    ["packages/api", "packages/legacy", "packages/ui"]
  );
});

test("file and folder toggles select what is matched", () => {
  const dir = fixture();
  assert.deepEqual(
    matchPaths({ glob: "packages/*", folder: false, file: true }, dir).map((m) => m.path),
    ["packages/notes.md"]
  );
  assert.deepEqual(
    matchPaths({ glob: "packages/*", file: true }, dir).map((m) => m.path),
    ["packages/api", "packages/legacy", "packages/notes.md", "packages/ui"],
    "both toggles on matches everything"
  );
  assert.throws(
    () => matchPaths({ glob: "packages/*", folder: false }, dir),
    /nothing can match/
  );
});

test("ignore drops matches", () => {
  const dir = fixture();
  assert.deepEqual(
    matchPaths({ glob: "packages/*", ignore: ["packages/legacy"] }, dir).map((m) => m.path),
    ["packages/api", "packages/ui"]
  );
  assert.deepEqual(
    matchPaths({ glob: "packages/*", ignore: ["**/l*"] }, dir).map((m) => m.path),
    ["packages/api", "packages/ui"],
    "ignore patterns are globs"
  );
});

test("each values describe the match", () => {
  const dir = fixture();
  const [api] = matchPaths({ glob: "packages/api" }, dir);
  assert.equal(api.path, "packages/api");
  assert.equal(api.name, "api");
  assert.equal(api.dir, "packages");
  assert.equal(api.absolute, join(dir, "packages", "api"));
});

test("applyEach substitutes into every string of the template", () => {
  const template: TestDef = {
    name: "${{ each.name }}",
    workdir: "${{ each.path }}",
    env: { PKG: "${{ each.name }}", ROOT: "${{ each.dir }}" },
    sequence: [{ name: "build", command: "npm run build --workspace ${{ each.name }}" }],
  };
  const applied = applyEach(template, {
    path: "packages/api",
    name: "api",
    dir: "packages",
    absolute: "/abs/packages/api",
  });
  assert.equal(applied.name, "api");
  assert.equal(applied.workdir, "packages/api");
  assert.deepEqual(applied.env, { PKG: "api", ROOT: "packages" });
  assert.equal(applied.sequence![0].command, "npm run build --workspace api");
  // the original is untouched
  assert.equal(template.name, "${{ each.name }}");
  assert.throws(
    () => applyEach({ name: "${{ each.nope }}" } as TestDef, { path: "p", name: "n", dir: ".", absolute: "/p" }),
    /unknown reference "each.nope"/
  );
});

test("expandForeach turns a test into a parallel group and rejects misuse", () => {
  const dir = fixture();
  const def: TestDef = {
    name: "packages",
    foreach: { glob: "packages/*", ignore: ["packages/legacy"] },
    template: { workdir: "${{ each.path }}", command: "npm test" },
  };
  expandForeach(def, dir);
  assert.equal(def.foreach, undefined, "the marker is consumed");
  assert.deepEqual(
    def.parallel!.map((child) => `${child.name}:${child.workdir}`),
    ["api:packages/api", "ui:packages/ui"],
    "a template without a name is named after the match"
  );

  assert.throws(
    () => expandForeach({ foreach: "packages/*" } as TestDef, dir),
    /needs a "template"/
  );
  assert.throws(
    () => expandForeach({ foreach: "nope/*", template: { command: "true" } } as TestDef, dir),
    /matched nothing/
  );
  assert.throws(
    () =>
      expandForeach(
        { foreach: "packages/*", template: { command: "true" }, command: "true" } as TestDef,
        dir
      ),
    /cannot be combined with command\/script/
  );
});

test("a Testfile with foreach loads into the expanded suite", () => {
  const dir = fixture();
  writeFileSync(
    join(dir, "Testfile"),
    [
      "version: 0",
      "test:",
      "  name: all",
      "  foreach:",
      "    glob: packages/*",
      "    ignore: [packages/legacy]",
      "  template:",
      "    name: ${{ each.name }} tests",
      "    workdir: ${{ each.path }}",
      "    command: test -f package.json",
    ].join("\n")
  );
  const { doc } = loadTestfile(dir);
  assert.deepEqual(
    doc.test.parallel!.map((child) => child.name),
    ["api tests", "ui tests"]
  );
  assert.equal(doc.test.foreach, undefined);
});
