import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregate,
  formatMs,
  isBroken,
  isFlaky,
  mergedVariantLabel,
  startedLabel,
  variantLabel,
  verdictOf,
} from "./format.js";
import type { RunRecord } from "./types.js";

// Runs need distinct, ordered timestamps; nothing here depends on the clock.
const EPOCH = Date.parse("2026-01-03T00:00:00.000Z");
const daysAgo = (days: number): string => new Date(EPOCH - days * 86_400_000).toISOString();

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

// Newest first, one run per result, so a list reads most-recent to oldest.
const history = (results: string[], path = "ci/unit"): RunRecord[] =>
  results.map((status, index) =>
    run(`r${index}`, daysAgo(index), [{ path, status: status as RunRecord["tests"][0]["status"] }]),
  );

test("a verdict needs at least 10 results", () => {
  const [nine] = aggregate(history(Array.from({ length: 9 }, () => "failed")));
  assert.equal(nine.recent.length, 9);
  assert.equal(verdictOf(nine), "unknown", "9 failures still say nothing");
  assert.equal(isFlaky(nine), false);
  assert.equal(isBroken(nine), false);

  const [ten] = aggregate(history(Array.from({ length: 10 }, () => "failed")));
  assert.equal(verdictOf(ten), "broken");
});

test("healthy below a quarter, flaky up to three quarters, broken above", () => {
  const verdict = (fails: number, total: number): string =>
    verdictOf(
      aggregate(
        history(Array.from({ length: total }, (_, i) => (i < fails ? "failed" : "passed"))),
      )[0],
    );
  assert.equal(verdict(0, 10), "healthy");
  assert.equal(verdict(2, 10), "healthy", "20% is below the flaky band");
  // the band is inclusive at both ends
  assert.equal(verdict(5, 20), "flaky", "exactly 25%");
  assert.equal(verdict(15, 20), "flaky", "exactly 75%");
  assert.equal(verdict(16, 20), "broken", "80% is past the band");
  assert.equal(verdict(20, 20), "broken");
});

test("skipped and aborted results are not evidence either way", () => {
  const rows = aggregate([
    ...history(
      Array.from({ length: 12 }, () => "skipped"),
      "ci/skipped",
    ),
    ...history(
      Array.from({ length: 12 }, () => "aborted"),
      "ci/aborted",
    ),
  ]);
  for (const row of rows) {
    assert.deepEqual(row.recent, [], row.path);
    assert.equal(verdictOf(row), "unknown", row.path);
  }
  assert.equal(
    rows.find((r) => r.path === "ci/aborted")?.fails,
    12,
    "but they still count as fails",
  );
});

test("only the 20 most recent results decide the verdict", () => {
  // newest first: 20 green, then a long run of red behind them
  const [unit] = aggregate(
    history([
      ...Array.from({ length: 20 }, () => "passed"),
      ...Array.from({ length: 10 }, () => "failed"),
    ]),
  );
  assert.equal(unit.occurrences, 30, "every run still counts towards the totals");
  assert.equal(unit.recent.length, 20);
  assert.equal(verdictOf(unit), "healthy", "the older failures are out of sample");

  // however old the history is, age alone never excludes a result
  const [old] = aggregate(
    history(Array.from({ length: 12 }, () => "failed")).map((r, i) => ({
      ...r,
      startedAt: daysAgo(400 + i),
    })),
  );
  assert.equal(verdictOf(old), "broken");
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
