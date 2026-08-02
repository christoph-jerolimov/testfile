import assert from "node:assert/strict";
import { test } from "node:test";
import { detectFlaky, diffRuns, type RunRecord } from "./runrecord.js";
import type { RunRecordTest } from "./runrecord.js";

function record(id: string, tests: RunRecordTest[]): RunRecord {
  return {
    id,
    startedAt: "2026-08-01T00:00:00.000Z",
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
  assert.deepEqual(
    diff.durations.map((d) => d.path).sort(),
    ["root/faster", "root/slower"]
  );
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
  const reports = detectFlaky(runs);
  assert.deepEqual(
    reports.map((r) => r.path),
    ["a/flaky", "a/once-fixed"],
    "stable, always-broken and skip-only tests are not flaky"
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
  assert.equal(detectFlaky(runs).length, 1, "flaky across all runs");
  assert.equal(detectFlaky(runs, 2).length, 0, "stable within the recent window");
});
