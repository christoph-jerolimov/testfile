import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  effectiveTags,
  matchesMatrixFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectLeaves,
  type TestFilters,
} from "./filter.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function filters(partial: Partial<TestFilters>): TestFilters {
  return { names: [], tags: [], matrix: new Map(), ...partial };
}

const doc: TestfileDoc = {
  version: 1,
  test: {
    name: "all",
    sequence: [
      { name: "lint", tags: ["fast"], command: "echo lint" },
      {
        name: "checks",
        tags: ["fast", "ci"],
        parallel: [
          { name: "unit tests", command: "echo unit" },
          { name: "e2e", tags: ["slow"], command: "echo e2e" },
        ],
      },
      {
        name: "integration",
        tags: ["slow", "nightly"],
        matrix: { db: ["postgres", "mysql"], node: ["20", "22"] },
        command: "echo ${{ matrix.db }}-${{ matrix.node }}",
      },
    ],
  },
};

test("selectLeaves by name matches path substrings, case-insensitively", () => {
  const tree = buildRunTree(doc);
  assert.deepEqual(
    selectLeaves(tree, filters({ names: ["e2e"] })).map((n) => n.path),
    ["all/checks/e2e"]
  );
  assert.deepEqual(
    selectLeaves(tree, filters({ names: ["UNIT"] })).map((n) => n.path),
    ["all/checks/unit tests"]
  );
  // a group name matches everything below it
  assert.deepEqual(
    selectLeaves(tree, filters({ names: ["all/checks"] })).map((n) => n.name),
    ["unit tests", "e2e"]
  );
  assert.deepEqual(selectLeaves(tree, filters({ names: ["nope"] })), []);
});

test("parseTagFilters splits on commas, trims and drops empties", () => {
  assert.deepEqual(parseTagFilters(["fast, slow", " nightly ", ""]), ["fast", "slow", "nightly"]);
  assert.deepEqual(parseTagFilters([]), []);
});

test("tags apply to the whole subtree and match case-insensitively", () => {
  const tree = buildRunTree(doc);
  // "fast" is on lint and on the checks group -> its children inherit it
  assert.deepEqual(
    selectLeaves(tree, filters({ tags: ["FAST"] })).map((n) => n.name),
    ["lint", "unit tests", "e2e"]
  );
  // several tags are ORed; matrix instances inherit the wrapper's tags
  const slow = selectLeaves(tree, filters({ tags: ["slow"] })).map((n) => n.name);
  assert.deepEqual(slow, [
    "e2e",
    "integration (db=postgres, node=20)",
    "integration (db=postgres, node=22)",
    "integration (db=mysql, node=20)",
    "integration (db=mysql, node=22)",
  ]);
  assert.deepEqual(selectLeaves(tree, filters({ tags: ["gcp"] })), []);
});

test("effectiveTags merges own and ancestor tags", () => {
  const tree = buildRunTree(doc);
  let e2e: RunNode | undefined;
  walk(tree, (n) => {
    if (n.name === "e2e") e2e = n;
  });
  assert.deepEqual([...effectiveTags(e2e!)].sort(), ["ci", "fast", "slow"]);
});

test("name, tag and matrix filters are ANDed", () => {
  const tree = buildRunTree(doc);
  const combined = selectLeaves(
    tree,
    filters({
      tags: ["slow"],
      names: ["integration"],
      matrix: parseMatrixFilters(["db:postgres", "node:22"]),
    })
  );
  assert.deepEqual(
    combined.map((n) => n.name),
    ["integration (db=postgres, node=22)"]
  );
});

test("parseMatrixFilters groups values per key and rejects bad specs", () => {
  const parsed = parseMatrixFilters(["db:postgres", "db:mysql", "node:22"]);
  assert.deepEqual([...parsed.get("db")!], ["postgres", "mysql"]);
  assert.deepEqual([...parsed.get("node")!], ["22"]);
  assert.throws(() => parseMatrixFilters(["nodb"]), /expected key:value/);
  assert.throws(() => parseMatrixFilters([":x"]), /expected key:value/);
  assert.throws(() => parseMatrixFilters(["x:"]), /expected key:value/);
});

test("matchesMatrixFilters constrains only nodes that carry the key", () => {
  const tree = buildRunTree(doc);
  const parsed = parseMatrixFilters(["db:postgres"]);
  const kept = selectLeaves(tree, filters({ matrix: parsed })).map((n) => n.name);
  assert.deepEqual(kept, [
    "lint",
    "unit tests",
    "e2e",
    "integration (db=postgres, node=20)",
    "integration (db=postgres, node=22)",
  ]);
});

test("a tag-filtered run only executes matching leaves", async () => {
  const session = new Session(doc, tempDir());
  const leaves = selectLeaves(session.tree, filters({ tags: ["fast"] }));
  const status = await session.runSelected(leaves.map((n) => n.id));
  assert.equal(status, "passed");
  const byName = new Map<string, RunNode>();
  walk(session.tree, (node) => byName.set(node.name, node));
  assert.equal(byName.get("lint")!.status, "passed");
  assert.equal(byName.get("unit tests")!.status, "passed");
  assert.equal(byName.get("e2e")!.status, "passed");
  assert.equal(byName.get("integration (db=postgres, node=20)")!.status, "pending");
});

test("a matrix-filtered selection skips excluded instances", async () => {
  const session = new Session(doc, tempDir());
  const leaves = selectLeaves(
    session.tree,
    filters({ names: ["integration"], matrix: parseMatrixFilters(["db:postgres", "node:22"]) })
  );
  const status = await session.runSelected(leaves.map((n) => n.id));
  assert.equal(status, "passed");
  const instances = new Map<string, RunNode>();
  walk(session.tree, (node) => {
    if (node.name.startsWith("integration (")) instances.set(node.name, node);
  });
  assert.equal(instances.get("integration (db=postgres, node=22)")!.status, "passed");
  assert.equal(instances.get("integration (db=postgres, node=20)")!.status, "pending");
  assert.equal(instances.get("integration (db=mysql, node=22)")!.status, "pending");
  assert.match(instances.get("integration (db=postgres, node=22)")!.output.text(), /postgres-22/);
});
