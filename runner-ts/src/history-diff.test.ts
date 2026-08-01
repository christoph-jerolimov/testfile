import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRuns, type RunRecord } from "./history.js";
import type { RunRecordTest } from "./history.js";

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
