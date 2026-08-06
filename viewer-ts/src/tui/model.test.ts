import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "../runrecord.js";
import { describeRun, recordedTests, runsTable, timelineRows } from "./model.js";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "20260101-100000-aa01",
    startedAt: "2026-01-01T10:00:00.000Z",
    durationMs: 1200,
    status: "passed",
    exitCode: 0,
    cancelled: false,
    env: {},
    ports: {},
    selected: [],
    tests: [{ path: "ci/unit", status: "passed", durationMs: 900 }],
    ...overrides,
  };
}

test("the runs table only shows a variants column when there is one", () => {
  const plain = runsTable([run()]);
  assert.ok(!plain.header.includes("VARIANTS"));

  const withVariants = runsTable([
    run({ variants: { platform: "linux" } }),
    run({
      id: "20260101-100100-bb02",
      merged: {
        runs: [
          { id: "a", status: "passed", startedAt: "2026-01-01T10:00:00.000Z", durationMs: 5 },
          { id: "b", status: "passed", startedAt: "2026-01-01T10:00:01.000Z", durationMs: 5 },
        ],
        variants: { platform: ["linux", "windows"] },
      },
    }),
  ]);
  assert.ok(withVariants.header.includes("VARIANTS"));
  assert.match(withVariants.rows[0], /platform=linux/);
  assert.match(
    withVariants.rows[1],
    /platform=linux\|windows/,
    "a merged run lists what it combined",
  );
});

test("a merged run describes its legs and tags every test", () => {
  const lines = describeRun(
    run({
      merged: {
        runs: [
          {
            id: "20260101-095000-lnx1",
            variants: { platform: "linux" },
            status: "passed",
            startedAt: "2026-01-01T09:50:00.000Z",
            durationMs: 600,
          },
          {
            id: "20260101-095500-win2",
            variants: { platform: "windows" },
            status: "failed",
            startedAt: "2026-01-01T09:55:00.000Z",
            durationMs: 600,
          },
        ],
        variants: { platform: ["linux", "windows"] },
      },
      tests: [
        { path: "ci/unit", status: "passed", variants: { platform: "linux" } },
        { path: "ci/unit", status: "failed", variants: { platform: "windows" } },
      ],
    }),
  ).map((line) => line.text);

  assert.ok(lines.some((line) => line.includes("merged:    2 runs (platform=linux|windows)")));
  assert.ok(lines.some((line) => line.includes("20260101-095500-win2") && line.includes("failed")));
  assert.ok(lines.some((line) => line.startsWith("passed") && line.includes("[platform=linux]")));
  assert.ok(lines.some((line) => line.startsWith("failed") && line.includes("[platform=windows]")));
});

test("a run with recorded start times lays out on a timeline", () => {
  const record = run({
    durationMs: 1000,
    tests: [
      { path: "ci", status: "passed", startedAfterMs: 0, durationMs: 1000 },
      { path: "ci/build", status: "passed", startedAfterMs: 0, durationMs: 250 },
      { path: "ci/unit", status: "passed", startedAfterMs: 500, durationMs: 500 },
    ],
  });
  const rows = timelineRows(record, 8);
  assert.deepEqual(
    rows.map((row) => `${row.path}|${row.bar}|`),
    ["ci|████████|", "ci/build|██      |", "ci/unit|    ████|"],
  );
  assert.equal(rows[2].label, "500ms+500ms");

  // the pane shows the bars, and every test says when it started
  const lines = describeRun(record).map((line) => line.text);
  assert.ok(lines.includes("timeline:"));
  assert.ok(lines.some((line) => line.includes("ci/unit ") && line.includes("+500ms")));
});

test("a test with no recorded start gets no bar rather than one at zero", () => {
  assert.deepEqual(timelineRows(run({ tests: [{ path: "ci", status: "passed" }] })), []);
  // and a record without any of them prints no timeline block
  assert.ok(!describeRun(run()).some((line) => line.text === "timeline:"));
});

test("a test shorter than one cell still gets a visible bar", () => {
  const rows = timelineRows(
    run({
      tests: [
        { path: "long", status: "passed", startedAfterMs: 0, durationMs: 10_000 },
        { path: "blink", status: "passed", startedAfterMs: 9_990, durationMs: 1 },
      ],
    }),
    10,
  );
  assert.equal(rows[1].bar, "         █");
});

test("the recorded-tests view marks the flaky ones, on the recent window", () => {
  const now = Date.parse("2026-08-01T12:00:00.000Z");
  const at = (days: number): string => new Date(now - days * 86_400_000).toISOString();
  const history = {
    runs: [
      run({
        id: "new",
        startedAt: at(1),
        tests: [
          { path: "ci/flaky", status: "failed" },
          { path: "ci/stable", status: "passed" },
          { path: "ci/was-bad", status: "passed" },
        ],
      }),
      run({
        id: "mid",
        startedAt: at(2),
        tests: [
          { path: "ci/flaky", status: "passed" },
          { path: "ci/stable", status: "passed" },
          { path: "ci/was-bad", status: "passed" },
        ],
      }),
      // an old bad patch: it still counts towards the totals, never the verdict
      run({
        id: "old",
        startedAt: at(40),
        tests: [{ path: "ci/was-bad", status: "failed" }],
      }),
    ],
  } as unknown as Parameters<typeof recordedTests>[0];

  const tests = recordedTests(history, now);
  assert.deepEqual(
    tests.map((t) => `${t.path}:${t.flaky}`),
    ["ci/flaky:true", "ci/stable:false", "ci/was-bad:false"],
  );
  assert.equal(tests[2].fails, 1, "the old failure is still counted");
  assert.equal(tests[2].occurrences, 3);
});
