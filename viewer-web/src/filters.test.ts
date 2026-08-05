import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterRuns,
  filterTests,
  isDefaultRunFilter,
  isDefaultTestFilter,
  runFilterDefaults,
  runVariantLabels,
  statusOptions,
  tagOptions,
  tagsByPath,
  testFilterDefaults,
  variantOptions,
} from "./filters.js";
import type { Aggregate, RunRecord } from "./types.js";

const NOW = Date.parse("2026-02-01T00:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

const run = (over: Partial<RunRecord> & { id: string }): RunRecord => ({
  startedAt: daysAgo(1),
  durationMs: 10,
  status: "passed",
  exitCode: 0,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests: [],
  ...over,
});

const runs: RunRecord[] = [
  run({
    id: "fresh-failed",
    startedAt: daysAgo(1),
    status: "failed",
    tests: [{ path: "ci/unit", status: "failed" }],
  }),
  run({ id: "fresh-linux", startedAt: daysAgo(3), variants: { platform: "linux" } }),
  run({
    id: "merged",
    startedAt: daysAgo(5),
    merged: {
      runs: [
        {
          id: "leg-linux",
          variants: { platform: "linux" },
          status: "passed",
          startedAt: daysAgo(5),
          durationMs: 5,
        },
        {
          id: "leg-windows",
          variants: { platform: "windows" },
          status: "failed",
          startedAt: daysAgo(5),
          durationMs: 5,
        },
      ],
      variants: { platform: ["linux", "windows"] },
    },
  }),
  run({ id: "ancient", startedAt: daysAgo(120), status: "aborted" }),
];

test("the default window is the last 30 days, 'all' is the whole history", () => {
  assert.ok(isDefaultRunFilter(runFilterDefaults));
  assert.deepEqual(
    filterRuns(runs, runFilterDefaults, NOW).map((r) => r.id),
    ["fresh-failed", "fresh-linux", "merged"],
    "the 120-day-old run is outside the default window",
  );
  assert.equal(filterRuns(runs, { ...runFilterDefaults, days: 0 }, NOW).length, 4);
  assert.deepEqual(
    filterRuns(runs, { ...runFilterDefaults, days: 4 }, NOW).map((r) => r.id),
    ["fresh-failed", "fresh-linux"],
  );
});

test("an empty multi-select means everything, not nothing", () => {
  assert.equal(filterRuns(runs, { ...runFilterDefaults, statuses: [] }, NOW).length, 3);
  assert.deepEqual(
    filterRuns(runs, { ...runFilterDefaults, statuses: ["failed"] }, NOW).map((r) => r.id),
    ["fresh-failed"],
  );
  // several selected values are an OR
  assert.equal(
    filterRuns(runs, { ...runFilterDefaults, days: 0, statuses: ["failed", "aborted"] }, NOW)
      .length,
    2,
  );
});

test("a variant filter also matches the legs of a merged run", () => {
  assert.deepEqual(runVariantLabels(runs[2]), ["platform=linux", "platform=windows"]);
  assert.deepEqual(variantOptions(runs), ["platform=linux", "platform=windows"]);
  assert.deepEqual(statusOptions(runs), ["aborted", "failed", "passed"]);
  assert.deepEqual(
    filterRuns(runs, { ...runFilterDefaults, variants: ["platform=windows"] }, NOW).map(
      (r) => r.id,
    ),
    ["merged"],
  );
  assert.deepEqual(
    filterRuns(runs, { ...runFilterDefaults, variants: ["platform=linux"] }, NOW).map((r) => r.id),
    ["fresh-linux", "merged"],
  );
});

test("the text filter looks at the id, the status, the variants and the test paths", () => {
  const text = (value: string): string[] =>
    filterRuns(runs, { ...runFilterDefaults, text: value }, NOW).map((r) => r.id);
  assert.deepEqual(text("MERGED"), ["merged"], "case-insensitive");
  assert.deepEqual(text("ci/unit"), ["fresh-failed"]);
  assert.deepEqual(text("platform=windows"), ["merged"]);
  assert.deepEqual(text(""), ["fresh-failed", "fresh-linux", "merged"]);
});

test("tags come from the recorded suite tree and are inherited by nested tests", () => {
  const withSuite = [
    run({
      id: "s",
      suite: {
        name: "ci",
        path: "ci",
        kind: "sequence",
        tags: ["ci"],
        children: [
          { name: "unit", path: "ci/unit", kind: "command", tags: ["fast"] },
          {
            name: "group",
            path: "ci/group",
            kind: "parallel",
            tags: ["slow"],
            children: [{ name: "e2e", path: "ci/group/e2e", kind: "command" }],
          },
        ],
      },
    }),
  ];
  const tags = tagsByPath(withSuite);
  assert.deepEqual(tags.get("ci"), ["ci"]);
  assert.deepEqual(tags.get("ci/unit"), ["ci", "fast"]);
  assert.deepEqual(tags.get("ci/group/e2e"), ["ci", "slow"], "inherited from both ancestors");
  assert.deepEqual(tagOptions(withSuite), ["ci", "fast", "slow"]);
  // a run without a suite contributes nothing rather than throwing
  assert.equal(tagsByPath([run({ id: "no-suite" })]).size, 0);
});

test("tests filter by last status, tag and text", () => {
  const tests: Aggregate[] = [
    {
      path: "ci/unit",
      occurrences: 4,
      passes: 2,
      fails: 2,
      lastStatus: "failed",
      history: ["failed", "passed", "failed", "passed"],
    },
    {
      path: "ci/build",
      occurrences: 4,
      passes: 4,
      fails: 0,
      lastStatus: "passed",
      history: ["passed", "passed", "passed", "passed"],
    },
  ];
  const tags = new Map([
    ["ci/unit", ["fast", "unit"]],
    ["ci/build", ["build"]],
  ]);
  assert.equal(filterTests(tests, testFilterDefaults, tags).length, 2);
  assert.deepEqual(
    filterTests(tests, { ...testFilterDefaults, statuses: ["failed"] }, tags).map((t) => t.path),
    ["ci/unit"],
  );
  assert.deepEqual(
    filterTests(tests, { ...testFilterDefaults, tags: ["build"] }, tags).map((t) => t.path),
    ["ci/build"],
  );
  assert.deepEqual(
    filterTests(tests, { ...testFilterDefaults, text: "unit" }, tags).map((t) => t.path),
    ["ci/unit"],
  );
  // without tags a tag filter matches nothing, the others still work
  assert.equal(filterTests(tests, { ...testFilterDefaults, tags: ["fast"] }).length, 0);

  assert.deepEqual(
    filterTests(tests, { ...testFilterDefaults, flakyOnly: true }, tags).map((t) => t.path),
    ["ci/unit"],
    "only the test that both passed and failed",
  );
  assert.equal(isDefaultTestFilter({ ...testFilterDefaults, flakyOnly: true }), false);
});
