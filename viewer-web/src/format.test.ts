import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregate,
  countSummary,
  formatMs,
  isFlaky,
  mergedVariantLabel,
  startedLabel,
  variantLabel,
} from "./format.js";
import type { Aggregate, RunRecord } from "./types.js";

// The flaky window is measured against "now", so the tests fix both ends.
const NOW = Date.parse("2026-01-03T00:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

function run(id: string, startedAt: string, tests: RunRecord["tests"]): RunRecord {
  return {
    id,
    startedAt,
    durationMs: 1000,
    status: "passed",
    exitCode: 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: [],
    tests,
  };
}

test("formatMs renders ms, seconds and minutes", () => {
  assert.equal(formatMs(undefined), "-");
  assert.equal(formatMs(0), "0ms");
  assert.equal(formatMs(999), "999ms");
  assert.equal(formatMs(1000), "1.0s");
  assert.equal(formatMs(1500), "1.5s");
  assert.equal(formatMs(59_949), "59.9s");
  assert.equal(formatMs(60_000), "1m0s");
  assert.equal(formatMs(65_400), "1m5s");
  assert.equal(formatMs(130_000), "2m10s");
});

test("startedLabel trims an ISO timestamp to date + time", () => {
  assert.equal(startedLabel("2026-01-02T09:00:00.000Z"), "2026-01-02 09:00:00");
  assert.equal(startedLabel("2026-01-02T09:00:00Z"), "2026-01-02 09:00:00");
});

test("countSummary counts statuses in first-seen order", () => {
  const record = run("r1", "2026-01-01T00:00:00.000Z", [
    { path: "a", status: "passed" },
    { path: "b", status: "failed" },
    { path: "c", status: "passed" },
    { path: "d", status: "skipped" },
  ]);
  assert.equal(countSummary(record), "2 passed, 1 failed, 1 skipped");
});

test("aggregate folds runs per test path, newest run first", () => {
  const newest = run("r2", "2026-01-02T00:00:00.000Z", [
    { path: "ci/unit", status: "failed" },
    { path: "ci/build", status: "passed" },
  ]);
  const oldest = run("r1", "2026-01-01T00:00:00.000Z", [
    { path: "ci/unit", status: "passed" },
    { path: "ci/build", status: "passed" },
    { path: "ci/old", status: "aborted" },
  ]);

  const rows = aggregate([newest, oldest], NOW);
  const unit = rows.find((row) => row.path === "ci/unit")!;
  assert.deepEqual(unit, {
    path: "ci/unit",
    occurrences: 2,
    passes: 1,
    fails: 1,
    lastStatus: "failed",
    history: ["failed", "passed"],
    recent: ["failed", "passed"],
  });
  const build = rows.find((row) => row.path === "ci/build")!;
  assert.deepEqual(build, {
    path: "ci/build",
    occurrences: 2,
    passes: 2,
    fails: 0,
    lastStatus: "passed",
    history: ["passed", "passed"],
    recent: ["passed", "passed"],
  });
  const old = rows.find((row) => row.path === "ci/old")!;
  assert.equal(old.fails, 1, "aborted counts as a failure");
  assert.equal(old.lastStatus, "aborted", "first occurrence wins as the latest status");
  assert.deepEqual(old.recent, [], "but it is not evidence of flakiness");
});

test("aggregate of no runs is empty", () => {
  assert.deepEqual(aggregate([]), []);
});

test("a test is flaky when more than a quarter of its recent results failed", () => {
  const rows = aggregate(
    [
      run("r2", daysAgo(1), [
        { path: "ci/unit", status: "failed" },
        { path: "ci/build", status: "passed" },
        { path: "ci/skipped", status: "skipped" },
      ]),
      run("r1", daysAgo(2), [
        { path: "ci/unit", status: "passed" },
        { path: "ci/build", status: "passed" },
        { path: "ci/skipped", status: "skipped" },
      ]),
    ],
    NOW,
  );
  const flaky = rows.filter(isFlaky).map((row) => row.path);
  assert.deepEqual(flaky, ["ci/unit"], "a test that never failed is not flaky");
  // a skipped-only test has no evidence either way
  assert.deepEqual(rows.find((row) => row.path === "ci/skipped")?.recent, []);
});

test("results older than 14 days do not decide flakiness", () => {
  const rows = aggregate(
    [
      run("recent", daysAgo(1), [{ path: "ci/unit", status: "passed" }]),
      run("edge", daysAgo(13.9), [{ path: "ci/unit", status: "failed" }]),
      run("old", daysAgo(14.1), [{ path: "ci/unit", status: "failed" }]),
      run("older", daysAgo(60), [{ path: "ci/unit", status: "failed" }]),
    ],
    NOW,
  );
  const unit = rows[0];
  assert.equal(unit.occurrences, 4, "every run still counts towards the totals");
  assert.deepEqual(unit.recent, ["passed", "failed"], "only the last 14 days decide");
  assert.equal(isFlaky(unit), true, "1 of 2 failed");

  // without the failure inside the window, the old ones say nothing
  const stable = aggregate(
    [
      run("recent", daysAgo(1), [{ path: "ci/unit", status: "passed" }]),
      run("old", daysAgo(20), [{ path: "ci/unit", status: "failed" }]),
      run("older", daysAgo(60), [{ path: "ci/unit", status: "failed" }]),
    ],
    NOW,
  );
  assert.equal(isFlaky(stable[0]), false);
});

test("only the 20 most recent results decide flakiness", () => {
  const runs = [
    ...Array.from({ length: 20 }, (_, i) =>
      run(`p${i}`, daysAgo(1), [{ path: "ci/unit", status: "passed" }]),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      run(`f${i}`, daysAgo(2), [{ path: "ci/unit", status: "failed" }]),
    ),
  ];
  const [unit] = aggregate(runs, NOW);
  assert.equal(unit.occurrences, 30);
  assert.equal(unit.recent.length, 20);
  assert.equal(isFlaky(unit), false, "the older failures are out of sample");
});

test("the flaky threshold is more than a quarter, not a quarter", () => {
  const sample = (fails: number, total: number): Aggregate => ({
    path: "t",
    occurrences: total,
    passes: total - fails,
    fails,
    lastStatus: "passed",
    history: [],
    recent: Array.from({ length: total }, (_, i) => (i < fails ? "failed" : "passed")),
  });
  assert.equal(isFlaky(sample(5, 20)), false, "exactly 25% is not more than 25%");
  assert.equal(isFlaky(sample(6, 20)), true);
  assert.equal(isFlaky(sample(1, 4)), false);
  assert.equal(isFlaky(sample(1, 3)), true);
  assert.equal(isFlaky(sample(0, 0)), false, "no evidence is not flakiness");
});

test("variantLabel is sorted by key and empty without variants", () => {
  assert.equal(variantLabel({ platform: "linux", node: "22" }), "node=22, platform=linux");
  assert.equal(variantLabel({}), "");
  assert.equal(variantLabel(undefined), "");
});

test("mergedVariantLabel lists every value a merged run combined", () => {
  assert.equal(
    mergedVariantLabel({ platform: ["linux", "macos", "windows"], node: ["22"] }),
    "node=22, platform=linux|macos|windows",
  );
  assert.equal(mergedVariantLabel(undefined), "");
});
