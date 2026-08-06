import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFlaky, diffRuns, flakyWindows, isFlaky, type RunRecord } from "./runrecord.js";
import type { RunRecordTest } from "./runrecord.js";

// The flaky window is measured against "now", so the tests fix both ends.
const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

function record(id: string, tests: RunRecordTest[], startedAt = daysAgo(0)): RunRecord {
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

test("detectFlaky finds tests that alternate and counts flips", () => {
  // records are newest first, like RunHistory.runs
  const runs = [
    record("r5", [
      { path: "a/flaky", status: "failed" },
      { path: "a/stable", status: "passed" },
      { path: "a/always-broken", status: "failed" },
    ]),
    record("r4", [
      { path: "a/flaky", status: "passed" },
      { path: "a/stable", status: "passed" },
      { path: "a/always-broken", status: "failed" },
    ]),
    record("r3", [
      { path: "a/flaky", status: "failed" },
      { path: "a/stable", status: "passed" },
      { path: "a/always-broken", status: "failed" },
      { path: "a/skipped-once", status: "skipped" },
    ]),
    record("r2", [
      { path: "a/flaky", status: "passed" },
      { path: "a/once-fixed", status: "passed" },
    ]),
    record("r1", [{ path: "a/once-fixed", status: "failed" }]),
  ];
  const reports = detectFlaky(runs, undefined, NOW);
  assert.deepEqual(
    reports.map((r) => r.path),
    ["a/flaky", "a/once-fixed", "a/always-broken"],
    "a stable test is not flaky, and a skip-only test has no evidence either way",
  );
  const flaky = reports[0];
  assert.equal(flaky.occurrences, 4);
  assert.equal(flaky.passes, 2);
  assert.equal(flaky.fails, 2);
  assert.equal(flaky.flips, 3, "passed->failed->passed->failed chronologically");
  assert.equal(flaky.lastStatus, "failed");
  assert.equal(reports[1].flips, 1);
});

test("detectFlaky honors the lastN window", () => {
  const runs = [
    record("new", [{ path: "t", status: "passed" }]),
    record("mid", [{ path: "t", status: "passed" }]),
    record("old", [{ path: "t", status: "failed" }]),
  ];
  assert.equal(detectFlaky(runs, undefined, NOW).length, 1, "1 of 3 failed");
  assert.equal(detectFlaky(runs, 2, NOW).length, 0, "stable within the recent window");
});

test("only results from the last 14 days count", () => {
  const runs = [
    record("recent", [{ path: "t", status: "passed" }], daysAgo(1)),
    record("edge", [{ path: "t", status: "failed" }], daysAgo(13.9)),
    // three failures, but too old to say anything about the test today
    record("old", [{ path: "t", status: "failed" }], daysAgo(14.1)),
    record("older", [{ path: "t", status: "failed" }], daysAgo(30)),
    record("ancient", [{ path: "t", status: "failed" }], daysAgo(90)),
  ];
  assert.deepEqual(flakyWindows(runs, NOW).get("t"), ["passed", "failed"]);
  const [report] = detectFlaky(runs, undefined, NOW);
  assert.equal(report.occurrences, 2, "the window, not the whole history");
  assert.equal(report.fails, 1);

  // the same test, with the recent failure dropped, is not flaky at all
  assert.deepEqual(detectFlaky(runs.slice(0, 1).concat(runs.slice(2)), undefined, NOW), []);
});

test("only the 20 most recent results count", () => {
  const fail = (id: number): RunRecord =>
    record(`f${id}`, [{ path: "t", status: "failed" }], daysAgo(1));
  const pass = (id: number): RunRecord =>
    record(`p${id}`, [{ path: "t", status: "passed" }], daysAgo(2));
  // newest first: 20 green runs, then a long run of red behind them
  const runs = [
    ...Array.from({ length: 20 }, (_, i) => pass(i)),
    ...Array.from({ length: 10 }, (_, i) => fail(i)),
  ];
  assert.equal(flakyWindows(runs, NOW).get("t")?.length, 20);
  assert.deepEqual(detectFlaky(runs, undefined, NOW), [], "the old failures are out of sample");

  // one recent failure inside the sample is still not enough on its own
  assert.deepEqual(detectFlaky([fail(99), ...runs.slice(0, 19)], undefined, NOW), []);
});

test("flaky means more than a quarter of the sample failed", () => {
  const sample = (fails: number, total: number): string[] =>
    Array.from({ length: total }, (_, i) => (i < fails ? "failed" : "passed"));
  assert.equal(isFlaky(sample(5, 20)), false, "exactly 25% is not more than 25%");
  assert.equal(isFlaky(sample(6, 20)), true);
  assert.equal(isFlaky(sample(1, 4)), false);
  assert.equal(isFlaky(sample(1, 3)), true);
  // a single failed result is the whole sample, so it counts
  assert.equal(isFlaky(["failed"]), true);
  assert.equal(isFlaky(["passed"]), false);
  assert.equal(isFlaky([]), false, "no evidence is not flakiness");
});
