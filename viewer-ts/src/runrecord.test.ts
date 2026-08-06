import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFlaky, diffRuns, flakyWindows, verdictOf, type RunRecord } from "./runrecord.js";
import type { RunRecordTest } from "./runrecord.js";

function record(
  id: string,
  tests: RunRecordTest[],
  startedAt = "2026-08-01T00:00:00.000Z",
): RunRecord {
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

test("diffRuns categorizes status transitions and membership changes", () => {
  const base = record("a", [
    { path: "root/stable", status: "passed", durationMs: 100 },
    { path: "root/breaks", status: "passed", durationMs: 100 },
    { path: "root/gets-fixed", status: "failed", durationMs: 100 },
    { path: "root/still-broken", status: "failed", durationMs: 100 },
    { path: "root/removed", status: "passed", durationMs: 100 },
  ]);
  const compare = record("b", [
    { path: "root/stable", status: "passed", durationMs: 110 },
    { path: "root/breaks", status: "failed", durationMs: 100 },
    { path: "root/gets-fixed", status: "passed", durationMs: 100 },
    { path: "root/still-broken", status: "aborted", durationMs: 100 },
    { path: "root/new", status: "passed", durationMs: 100 },
  ]);
  const diff = diffRuns(base, compare);
  assert.deepEqual(diff.newlyFailed, ["root/breaks"]);
  assert.deepEqual(diff.fixed, ["root/gets-fixed"]);
  assert.deepEqual(diff.stillFailing, ["root/still-broken"]);
  assert.deepEqual(diff.added, ["root/new"]);
  assert.deepEqual(diff.removed, ["root/removed"]);
  // +10ms on 100ms is neither >100ms nor >20%: not significant
  assert.deepEqual(diff.durations, []);
});

test("diffRuns reports significant duration changes of passing tests only", () => {
  const base = record("a", [
    { path: "root/slower", status: "passed", durationMs: 1000 },
    { path: "root/faster", status: "passed", durationMs: 5000 },
    { path: "root/small", status: "passed", durationMs: 50 },
    { path: "root/failing", status: "failed", durationMs: 100 },
  ]);
  const compare = record("b", [
    { path: "root/slower", status: "passed", durationMs: 2500 },
    { path: "root/faster", status: "passed", durationMs: 1000 },
    { path: "root/small", status: "passed", durationMs: 120 },
    { path: "root/failing", status: "failed", durationMs: 9000 },
  ]);
  const diff = diffRuns(base, compare);
  assert.deepEqual(diff.durations.map((d) => d.path).sort(), ["root/faster", "root/slower"]);
});

test("identical runs produce an empty diff", () => {
  const tests: RunRecordTest[] = [{ path: "root/a", status: "passed", durationMs: 10 }];
  const diff = diffRuns(record("a", tests), record("b", tests));
  assert.deepEqual(diff, {
    newlyFailed: [],
    fixed: [],
    stillFailing: [],
    added: [],
    removed: [],
    durations: [],
  });
});

// Newest first, like RunHistory.runs: `results` reads left to right as
// most-recent to oldest, one run per result.
function history(results: ("passed" | "failed" | "skipped")[], path = "t"): RunRecord[] {
  return results.map((status, index) => record(`r${index}`, [{ path, status }]));
}

test("detectFlaky finds tests that alternate and counts flips", () => {
  const runs: RunRecord[] = [];
  // 12 results each, newest first: one alternating, one always green, one
  // always red, and one that is only ever skipped
  const flaky: ("passed" | "failed")[] = Array.from({ length: 12 }, (_, i) =>
    i % 2 === 0 ? "failed" : "passed",
  );
  for (let i = 0; i < 12; i++) {
    runs.push(
      record(`r${i}`, [
        { path: "a/flaky", status: flaky[i] },
        { path: "a/stable", status: "passed" },
        { path: "a/always-broken", status: "failed" },
        { path: "a/skipped", status: "skipped" },
      ]),
    );
  }

  const reports = detectFlaky(runs);
  assert.deepEqual(
    reports.map((r) => `${r.path}:${r.verdict}`),
    ["a/flaky:flaky", "a/always-broken:broken"],
    "a stable test is fine, and a skip-only test has no evidence either way",
  );
  const report = reports[0];
  assert.equal(report.occurrences, 12);
  assert.equal(report.passes, 6);
  assert.equal(report.fails, 6);
  assert.equal(report.flips, 11, "it alternated on every run");
  assert.equal(report.lastStatus, "failed");
  assert.equal(reports[1].flips, 0, "a broken test never changes its mind");
});

test("detectFlaky honors the lastN window", () => {
  // newest 10 green, then 10 red behind them
  const runs = history([
    ...Array.from({ length: 10 }, () => "passed" as const),
    ...Array.from({ length: 10 }, () => "failed" as const),
  ]);
  assert.equal(detectFlaky(runs).length, 1, "10 of 20 failed");
  assert.deepEqual(detectFlaky(runs, 10), [], "all green within the recent window");
  // below the minimum there is no verdict either way
  assert.deepEqual(detectFlaky(runs, 9), []);
});

test("a verdict needs at least 10 results", () => {
  const allRed = (count: number): RunRecord[] =>
    history(Array.from({ length: count }, () => "failed" as const));
  assert.deepEqual(verdictOf([]), "unknown");
  assert.deepEqual(detectFlaky(allRed(9)), [], "9 failures still say nothing");
  assert.equal(detectFlaky(allRed(10))[0]?.verdict, "broken");
  assert.equal(flakyWindows(allRed(9)).get("t")?.length, 9, "the results are still collected");
});

test("only the 20 most recent results count", () => {
  // newest first: 20 green, then a long run of red behind them
  const runs = history([
    ...Array.from({ length: 20 }, () => "passed" as const),
    ...Array.from({ length: 10 }, () => "failed" as const),
  ]);
  assert.equal(flakyWindows(runs).get("t")?.length, 20);
  assert.deepEqual(detectFlaky(runs), [], "the older failures are out of sample");
  assert.equal(runs.length, 30, "but every run is still there");
});

test("the verdict is healthy below a quarter, flaky up to three quarters, broken above", () => {
  const sample = (fails: number, total: number): string[] =>
    Array.from({ length: total }, (_, i) => (i < fails ? "failed" : "passed"));

  // fewer than 10 results is never a verdict, however bad they look
  assert.equal(verdictOf(sample(9, 9)), "unknown");
  assert.equal(verdictOf(sample(0, 9)), "unknown");

  assert.equal(verdictOf(sample(0, 10)), "healthy");
  assert.equal(verdictOf(sample(2, 10)), "healthy", "20% is below the flaky band");
  // the band is inclusive at both ends
  assert.equal(verdictOf(sample(5, 20)), "flaky", "exactly 25%");
  assert.equal(verdictOf(sample(15, 20)), "flaky", "exactly 75%");
  assert.equal(verdictOf(sample(10, 20)), "flaky");
  assert.equal(verdictOf(sample(16, 20)), "broken", "80% is past the band");
  assert.equal(verdictOf(sample(20, 20)), "broken");
});
