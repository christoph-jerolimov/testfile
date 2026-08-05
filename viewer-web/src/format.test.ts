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
import type { RunRecord } from "./types.js";

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

  const rows = aggregate([newest, oldest]);
  const unit = rows.find((row) => row.path === "ci/unit")!;
  assert.deepEqual(unit, {
    path: "ci/unit",
    occurrences: 2,
    passes: 1,
    fails: 1,
    lastStatus: "failed",
    history: ["failed", "passed"],
  });
  const build = rows.find((row) => row.path === "ci/build")!;
  assert.deepEqual(build, {
    path: "ci/build",
    occurrences: 2,
    passes: 2,
    fails: 0,
    lastStatus: "passed",
    history: ["passed", "passed"],
  });
  const old = rows.find((row) => row.path === "ci/old")!;
  assert.equal(old.fails, 1, "aborted counts as a failure");
  assert.equal(old.lastStatus, "aborted", "first occurrence wins as the latest status");
});

test("aggregate of no runs is empty", () => {
  assert.deepEqual(aggregate([]), []);
});

test("a test is flaky when it both passed and failed", () => {
  const rows = aggregate([
    run("r2", "2026-01-02T00:00:00.000Z", [
      { path: "ci/unit", status: "failed" },
      { path: "ci/build", status: "passed" },
      { path: "ci/broken", status: "failed" },
    ]),
    run("r1", "2026-01-01T00:00:00.000Z", [
      { path: "ci/unit", status: "passed" },
      { path: "ci/build", status: "passed" },
      { path: "ci/broken", status: "aborted" },
    ]),
  ]);
  const flaky = rows.filter(isFlaky).map((row) => row.path);
  assert.deepEqual(flaky, ["ci/unit"], "always green or always red is not flaky");
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
