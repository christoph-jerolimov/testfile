import assert from "node:assert/strict";
import { test } from "node:test";
import { groupPaths, relatedServices, suiteRowsOf, visibleRows } from "./suite.js";
import type { RunRecord } from "./types.js";

const base: RunRecord = {
  id: "r",
  startedAt: "2026-02-01T10:00:00.000Z",
  durationMs: 10,
  status: "failed",
  exitCode: 1,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests: [],
};

const withSuite: RunRecord = {
  ...base,
  suite: {
    name: "ci",
    path: "ci",
    kind: "sequence",
    tags: ["ci"],
    children: [
      { name: "unit", path: "ci/unit", kind: "command", tags: ["fast"] },
      {
        name: "checks",
        path: "ci/checks",
        kind: "parallel",
        children: [
          { name: "lint", path: "ci/checks/lint", kind: "command" },
          { name: "e2e", path: "ci/checks/e2e", kind: "command", services: ["db"], tags: ["slow"] },
        ],
      },
    ],
  },
  tests: [
    { path: "ci", status: "failed", durationMs: 90 },
    { path: "ci/unit", status: "failed", durationMs: 60, log: "tests/unit.log" },
    { path: "ci/checks", status: "passed", durationMs: 30 },
    { path: "ci/checks/lint", status: "passed", durationMs: 30 },
  ],
};

test("the tree is the recorded suite, with this run's results on it", () => {
  const rows = suiteRowsOf(withSuite);
  assert.deepEqual(
    rows.map((row) => `${"  ".repeat(row.depth)}${row.name}`),
    ["ci", "  unit", "  checks", "    lint", "    e2e"],
  );
  const [ci, unit, checks, , e2e] = rows;
  assert.equal(ci.kind, "sequence");
  assert.deepEqual(ci.tags, ["ci"]);
  assert.equal(ci.hasChildren, true);
  assert.equal(unit.results[0]?.status, "failed");
  assert.equal(checks.hasChildren, true);

  // the test that never ran keeps its place in the tree
  assert.equal(e2e.notRun, true);
  assert.deepEqual(e2e.results, []);
  assert.deepEqual(e2e.services, ["db"]);
  assert.deepEqual(e2e.tags, ["slow"]);
});

test("collapsing a group hides its whole subtree", () => {
  const rows = suiteRowsOf(withSuite);
  assert.deepEqual(groupPaths(rows), ["ci", "ci/checks"]);
  assert.deepEqual(
    visibleRows(rows, new Set(["ci/checks"])).map((row) => row.path),
    ["ci", "ci/unit", "ci/checks"],
  );
  assert.deepEqual(
    visibleRows(rows, new Set(["ci"])).map((row) => row.path),
    ["ci"],
  );
  assert.equal(visibleRows(rows, new Set()).length, rows.length);
});

test("a merged run keeps every leg's result on one node", () => {
  const merged: RunRecord = {
    ...withSuite,
    tests: [
      { path: "ci/unit", status: "passed", variants: { platform: "linux" }, origin: "a" },
      { path: "ci/unit", status: "failed", variants: { platform: "windows" }, origin: "b" },
    ],
  };
  const unit = suiteRowsOf(merged).find((row) => row.path === "ci/unit");
  assert.equal(unit?.results.length, 2);
  assert.deepEqual(
    unit?.results.map((result) => result.variants?.platform),
    ["linux", "windows"],
  );
});

test("a record without a suite falls back to the paths it recorded", () => {
  const flat: RunRecord = {
    ...base,
    tests: [
      { path: "all", status: "failed" },
      { path: "all/one", status: "failed" },
      { path: "all/two", status: "passed" },
    ],
  };
  const rows = suiteRowsOf(flat);
  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.name}`),
    ["0:all", "1:one", "1:two"],
  );
  assert.equal(rows[0].hasChildren, true);
  assert.equal(rows[1].hasChildren, false);
  assert.ok(rows.every((row) => !row.notRun));
});

test("paths outside the recorded suite are appended, not dropped", () => {
  const extra: RunRecord = {
    ...withSuite,
    tests: [...withSuite.tests, { path: "other/thing", status: "passed" }],
  };
  const rows = suiteRowsOf(extra);
  assert.equal(rows[rows.length - 1]?.path, "other/thing");
  assert.equal(rows.length, 6);
});

test("relatedServices follows the suite tree: node + ancestors, else all", () => {
  const record: RunRecord = {
    ...withSuite,
    services: [
      { name: "db", status: "stopped", log: "services/db.log" },
      { name: "mail", status: "stopped" },
    ],
  };
  assert.deepEqual(
    relatedServices(record, "ci/checks/e2e").map((s) => s.name),
    ["db"],
    "a test relates the services declared on its node and its ancestors",
  );
  assert.deepEqual(
    relatedServices(record, "ci/unit").map((s) => s.name),
    ["db", "mail"],
    "a node that declares nothing relates every service rather than none",
  );
  assert.equal(
    relatedServices({ ...record, suite: undefined }, "ci/unit").length,
    2,
    "without a recorded tree every service stays related",
  );
  assert.equal(relatedServices(withSuite, "ci/unit").length, 0, "no services, nothing related");
});
