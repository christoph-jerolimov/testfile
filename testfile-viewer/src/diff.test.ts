import assert from "node:assert/strict";
import { test } from "node:test";
import { diffRuns, diffTotal, previousRun } from "./diff.js";
import type { RunRecord, RunTest } from "./types.js";

const run = (id: string, startedAt: string, tests: RunTest[]): RunRecord => ({
  id,
  startedAt,
  durationMs: 100,
  status: tests.some((t) => t.status === "failed") ? "failed" : "passed",
  exitCode: 0,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests,
});

test("a diff sorts each test into what changed about it", () => {
  const base = run("a", "2026-02-01T10:00:00.000Z", [
    { path: "ci/broke", status: "passed" },
    { path: "ci/fixed", status: "failed" },
    { path: "ci/stuck", status: "aborted" },
    { path: "ci/gone", status: "passed" },
    { path: "ci/same", status: "passed" },
  ]);
  const compare = run("b", "2026-02-01T11:00:00.000Z", [
    { path: "ci/broke", status: "failed" },
    { path: "ci/fixed", status: "passed" },
    { path: "ci/stuck", status: "failed" },
    { path: "ci/new", status: "passed" },
    { path: "ci/same", status: "passed" },
  ]);
  const diff = diffRuns(base, compare);
  assert.deepEqual(diff.newlyFailed, ["ci/broke"]);
  assert.deepEqual(diff.fixed, ["ci/fixed"]);
  assert.deepEqual(diff.stillFailing, ["ci/stuck"]);
  assert.deepEqual(diff.added, ["ci/new"]);
  assert.deepEqual(diff.removed, ["ci/gone"]);
  assert.equal(diffTotal(diff), 5);
});

test("a duration counts as changed only when it moves by 100ms and a fifth", () => {
  const base = run("a", "2026-02-01T10:00:00.000Z", [
    { path: "ci/slower", status: "passed", durationMs: 1000 },
    { path: "ci/faster", status: "passed", durationMs: 1000 },
    { path: "ci/tiny", status: "passed", durationMs: 50 },
    { path: "ci/small", status: "passed", durationMs: 10_000 },
  ]);
  const compare = run("b", "2026-02-01T11:00:00.000Z", [
    { path: "ci/slower", status: "passed", durationMs: 2000 },
    { path: "ci/faster", status: "passed", durationMs: 400 },
    // doubled, but only by 60ms
    { path: "ci/tiny", status: "passed", durationMs: 110 },
    // 500ms, but only 5%
    { path: "ci/small", status: "passed", durationMs: 10_500 },
  ]);
  assert.deepEqual(diffRuns(base, compare).durations, [
    { path: "ci/slower", fromMs: 1000, toMs: 2000 },
    { path: "ci/faster", fromMs: 1000, toMs: 400 },
  ]);
});

test("a failing test's duration is not reported as a change", () => {
  const base = run("a", "2026-02-01T10:00:00.000Z", [
    { path: "ci/one", status: "passed", durationMs: 1000 },
  ]);
  const compare = run("b", "2026-02-01T11:00:00.000Z", [
    { path: "ci/one", status: "failed", durationMs: 9000 },
  ]);
  const diff = diffRuns(base, compare);
  assert.deepEqual(diff.durations, []);
  assert.deepEqual(diff.newlyFailed, ["ci/one"]);
});

test("in a merged run the worst leg of a path decides", () => {
  const base = run("a", "2026-02-01T10:00:00.000Z", [
    { path: "ci/one", status: "passed", variants: { platform: "linux" } },
    { path: "ci/one", status: "passed", variants: { platform: "windows" } },
  ]);
  const compare = run("b", "2026-02-01T11:00:00.000Z", [
    { path: "ci/one", status: "passed", variants: { platform: "linux" } },
    { path: "ci/one", status: "failed", variants: { platform: "windows" } },
  ]);
  assert.deepEqual(diffRuns(base, compare).newlyFailed, ["ci/one"]);
});

test("two identical runs differ in nothing", () => {
  const tests: RunTest[] = [{ path: "ci/one", status: "passed", durationMs: 1000 }];
  const diff = diffRuns(
    run("a", "2026-02-01T10:00:00.000Z", tests),
    run("b", "2026-02-01T11:00:00.000Z", tests),
  );
  assert.equal(diffTotal(diff), 0);
});

test("the previous run is the one recorded before this one", () => {
  const runs = [
    run("c", "2026-02-01T12:00:00.000Z", []),
    run("b", "2026-02-01T11:00:00.000Z", []),
    run("a", "2026-02-01T10:00:00.000Z", []),
  ];
  assert.equal(previousRun(runs, runs[0])?.id, "b");
  assert.equal(previousRun(runs, runs[1])?.id, "a");
  // the oldest run has nothing before it
  assert.equal(previousRun(runs, runs[2]), undefined);
  assert.equal(previousRun(runs, run("x", "2026-02-01T13:00:00.000Z", [])), undefined);
});
