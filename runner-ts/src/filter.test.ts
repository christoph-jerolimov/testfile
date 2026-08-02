import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  effectiveTags,
  filterByLastFailed,
  matchesMatrixFilters,
  parseMatrixFilters,
  parseTagFilters,
  selectTests,
  splitGenericFilters,
  type TestFilters,
} from "./filter.js";
import { RunHistory } from "./history.js";
import type { TestfileDoc } from "./model.js";
import { buildRunSuite, walk, type RunTest } from "./runsuite.js";
import { Session } from "./session.js";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "testfile-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function filters(partial: Partial<TestFilters>): TestFilters {
  return { any: [], names: [], tags: [], matrix: new Map(), ...partial };
}

const doc: TestfileDoc = {
  version: 0,
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

test("selectTests by name matches path substrings, case-insensitively", () => {
  const suite = buildRunSuite(doc);
  assert.deepEqual(
    selectTests(suite, filters({ names: ["e2e"] })).map((n) => n.path),
    ["all/checks/e2e"]
  );
  assert.deepEqual(
    selectTests(suite, filters({ names: ["UNIT"] })).map((n) => n.path),
    ["all/checks/unit tests"]
  );
  // a group name matches everything below it
  assert.deepEqual(
    selectTests(suite, filters({ names: ["all/checks"] })).map((n) => n.name),
    ["unit tests", "e2e"]
  );
  assert.deepEqual(selectTests(suite, filters({ names: ["nope"] })), []);
});

test("parseTagFilters splits on commas, trims and drops empties", () => {
  assert.deepEqual(parseTagFilters(["fast, slow", " nightly ", ""]), ["fast", "slow", "nightly"]);
  assert.deepEqual(parseTagFilters([]), []);
});

test("tags apply to all nested tests and match case-insensitively", () => {
  const suite = buildRunSuite(doc);
  // "fast" is on lint and on the checks group -> its children inherit it
  assert.deepEqual(
    selectTests(suite, filters({ tags: ["FAST"] })).map((n) => n.name),
    ["lint", "unit tests", "e2e"]
  );
  // several tags are ORed; matrix instances inherit the wrapper's tags
  const slow = selectTests(suite, filters({ tags: ["slow"] })).map((n) => n.name);
  assert.deepEqual(slow, [
    "e2e",
    "integration (db=postgres, node=20)",
    "integration (db=postgres, node=22)",
    "integration (db=mysql, node=20)",
    "integration (db=mysql, node=22)",
  ]);
  assert.deepEqual(selectTests(suite, filters({ tags: ["gcp"] })), []);
});

test("effectiveTags merges own and ancestor tags", () => {
  const suite = buildRunSuite(doc);
  let e2e: RunTest | undefined;
  walk(suite, (n) => {
    if (n.name === "e2e") e2e = n;
  });
  assert.deepEqual([...effectiveTags(e2e!)].sort(), ["ci", "fast", "slow"]);
});

test("name, tag and matrix filters are ANDed", () => {
  const suite = buildRunSuite(doc);
  const combined = selectTests(
    suite,
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

test("splitGenericFilters routes values with a colon to matrix specs", () => {
  const split = splitGenericFilters(["e2e", " fast ", "db:postgres", "", "node:22"]);
  assert.deepEqual(split.nameOrTag, ["e2e", "fast"]);
  assert.deepEqual(split.matrixSpecs, ["db:postgres", "node:22"]);
});

test("the generic filter matches names or tags", () => {
  const suite = buildRunSuite(doc);
  // "e2e" is a test name
  assert.deepEqual(
    selectTests(suite, filters({ any: ["e2e"] })).map((n) => n.name),
    ["e2e"]
  );
  // "fast" is a tag (on lint and the checks group)
  assert.deepEqual(
    selectTests(suite, filters({ any: ["fast"] })).map((n) => n.name),
    ["lint", "unit tests", "e2e"]
  );
  // several generic values are ORed: name match or tag match
  assert.deepEqual(
    selectTests(suite, filters({ any: ["nightly", "lint"] })).map((n) => n.name),
    [
      "lint",
      "integration (db=postgres, node=20)",
      "integration (db=postgres, node=22)",
      "integration (db=mysql, node=20)",
      "integration (db=mysql, node=22)",
    ]
  );
});

test("generic matrix values combine with the dedicated matrix filter", () => {
  const suite = buildRunSuite(doc);
  const generic = splitGenericFilters(["integration", "db:mysql"]);
  const combined = selectTests(
    suite,
    filters({
      any: generic.nameOrTag,
      matrix: parseMatrixFilters([...generic.matrixSpecs, "node:20"]),
    })
  );
  assert.deepEqual(
    combined.map((n) => n.name),
    ["integration (db=mysql, node=20)"]
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
  const suite = buildRunSuite(doc);
  const parsed = parseMatrixFilters(["db:postgres"]);
  const kept = selectTests(suite, filters({ matrix: parsed })).map((n) => n.name);
  assert.deepEqual(kept, [
    "lint",
    "unit tests",
    "e2e",
    "integration (db=postgres, node=20)",
    "integration (db=postgres, node=22)",
  ]);
});

test("filterByLastFailed selects only tests that failed in the recorded run", async () => {
  const dir = tempDir();
  const mixed: TestfileDoc = {
    version: 0,
    test: {
      name: "root",
      sequence: [
        { name: "good", command: "true" },
        { name: "bad", command: "false", continueOnError: true },
        { name: "also-good", command: "true" },
      ],
    },
  };
  const session = new Session(mixed, dir);
  assert.equal(await session.runAll(), "passed");

  const selected = selectTests(session.suite, filters({}));
  const lastRun = new RunHistory(dir).runs[0];
  const failedTests = filterByLastFailed(selected, lastRun);
  assert.deepEqual(
    failedTests.map((n) => n.path),
    ["root/bad"]
  );

  // re-running just the failed selection leaves the others untouched:
  // "good" keeps its result from the first run instead of being reset
  const goodBefore = new Map<string, RunTest>();
  walk(session.suite, (n) => goodBefore.set(n.name, n));
  const goodEndedAt = goodBefore.get("good")!.endedAt;
  await session.runSelected(failedTests.map((n) => n.id));
  const byName = new Map<string, RunTest>();
  walk(session.suite, (n) => byName.set(n.name, n));
  assert.equal(byName.get("bad")!.status, "failed");
  assert.equal(byName.get("good")!.status, "passed");
  assert.equal(byName.get("good")!.endedAt, goodEndedAt, "good must not have re-run");

  assert.throws(() => filterByLastFailed(selected, undefined), /no recorded runs/);
});

test("a tag-filtered run only executes matching tests", async () => {
  const session = new Session(doc, tempDir());
  const selected = selectTests(session.suite, filters({ tags: ["fast"] }));
  const status = await session.runSelected(selected.map((n) => n.id));
  assert.equal(status, "passed");
  const byName = new Map<string, RunTest>();
  walk(session.suite, (n) => byName.set(n.name, n));
  assert.equal(byName.get("lint")!.status, "passed");
  assert.equal(byName.get("unit tests")!.status, "passed");
  assert.equal(byName.get("e2e")!.status, "passed");
  assert.equal(byName.get("integration (db=postgres, node=20)")!.status, "pending");
});

test("a matrix-filtered selection skips excluded instances", async () => {
  const session = new Session(doc, tempDir());
  const selected = selectTests(
    session.suite,
    filters({ names: ["integration"], matrix: parseMatrixFilters(["db:postgres", "node:22"]) })
  );
  const status = await session.runSelected(selected.map((n) => n.id));
  assert.equal(status, "passed");
  const instances = new Map<string, RunTest>();
  walk(session.suite, (n) => {
    if (n.name.startsWith("integration (")) instances.set(n.name, n);
  });
  assert.equal(instances.get("integration (db=postgres, node=22)")!.status, "passed");
  assert.equal(instances.get("integration (db=postgres, node=20)")!.status, "pending");
  assert.equal(instances.get("integration (db=mysql, node=22)")!.status, "pending");
  assert.match(instances.get("integration (db=postgres, node=22)")!.output.text(), /postgres-22/);
});
