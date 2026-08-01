import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findMatchingNodes, matchesMatrixFilters, parseMatrixFilters } from "./filter.js";
import type { TestfileDoc } from "./model.js";
import { buildRunTree, walk, type RunNode } from "./runtree.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const doc: TestfileDoc = {
  version: 1,
  test: {
    name: "all",
    sequence: [
      { name: "lint", command: "echo lint" },
      {
        name: "checks",
        parallel: [
          { name: "unit tests", command: "echo unit" },
          { name: "e2e", command: "echo e2e" },
        ],
      },
      {
        name: "integration",
        matrix: { db: ["postgres", "mysql"], node: ["20", "22"] },
        command: "echo ${{ matrix.db }}-${{ matrix.node }}",
      },
    ],
  },
};

test("findMatchingNodes matches by name and by path substring, case-insensitively", () => {
  const tree = buildRunTree(doc);
  assert.deepEqual(
    findMatchingNodes(tree, ["e2e"]).map((n) => n.path),
    ["all/checks/e2e"]
  );
  assert.deepEqual(
    findMatchingNodes(tree, ["UNIT"]).map((n) => n.path),
    ["all/checks/unit tests"]
  );
  // path substring matches the group and everything below it
  const checks = findMatchingNodes(tree, ["all/checks"]).map((n) => n.path);
  assert.deepEqual(checks, ["all/checks", "all/checks/unit tests", "all/checks/e2e"]);
  assert.deepEqual(findMatchingNodes(tree, ["nope"]), []);
});

test("parseMatrixFilters groups values per key and rejects bad specs", () => {
  const filters = parseMatrixFilters(["db:postgres", "db:mysql", "node:22"]);
  assert.deepEqual([...filters.get("db")!], ["postgres", "mysql"]);
  assert.deepEqual([...filters.get("node")!], ["22"]);
  assert.throws(() => parseMatrixFilters(["nodb"]), /expected key:value/);
  assert.throws(() => parseMatrixFilters([":x"]), /expected key:value/);
  assert.throws(() => parseMatrixFilters(["x:"]), /expected key:value/);
});

test("matchesMatrixFilters constrains only nodes that carry the key", () => {
  const tree = buildRunTree(doc);
  const filters = parseMatrixFilters(["db:postgres"]);
  const kept: string[] = [];
  walk(tree, (node) => {
    if (node.children.length === 0 && matchesMatrixFilters(node, filters)) kept.push(node.name);
  });
  // lint/unit/e2e have no db key and stay; only postgres instances remain
  assert.deepEqual(kept, [
    "lint",
    "unit tests",
    "e2e",
    "integration (db=postgres, node=20)",
    "integration (db=postgres, node=22)",
  ]);
});

test("a filtered run only executes the matching subtree", async () => {
  const session = new Session(doc, tempDir());
  const selection = findMatchingNodes(session.tree, ["e2e"]).map((n) => n.id);
  const status = await session.runSelected(selection);
  assert.equal(status, "passed");
  const byName = new Map<string, RunNode>();
  walk(session.tree, (node) => byName.set(node.name, node));
  assert.equal(byName.get("e2e")!.status, "passed");
  assert.equal(byName.get("unit tests")!.status, "pending");
  assert.equal(byName.get("lint")!.status, "pending");
});

test("a matrix-filtered run skips excluded instances", async () => {
  const session = new Session(doc, tempDir());
  const filters = parseMatrixFilters(["db:postgres", "node:22"]);
  const selection = findMatchingNodes(session.tree, ["integration"]).map((n) => n.id);
  const status = await session.runSelected(selection, {
    exclude: (node) => !matchesMatrixFilters(node, filters),
  });
  assert.equal(status, "passed");
  const instances = new Map<string, RunNode>();
  walk(session.tree, (node) => {
    if (node.name.startsWith("integration (")) instances.set(node.name, node);
  });
  assert.equal(instances.get("integration (db=postgres, node=22)")!.status, "passed");
  assert.equal(instances.get("integration (db=postgres, node=20)")!.status, "pending");
  assert.equal(instances.get("integration (db=mysql, node=22)")!.status, "pending");
  assert.match(
    instances.get("integration (db=postgres, node=22)")!.output.text(),
    /postgres-22/
  );
});
