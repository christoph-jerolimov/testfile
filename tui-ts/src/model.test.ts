import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recordedTests,
  relatedServices,
  type RunRecord,
  suiteRows,
  testRunsFor,
  timelineRows,
} from "@testfile/core";
import { describeRun, testOverview } from "./model.js";

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

test("suiteRows walks the recorded tree in order, with depths", () => {
  const record = run({
    suite: {
      path: "ci",
      name: "ci",
      kind: "sequence",
      children: [
        { path: "ci/build", name: "build", kind: "command" },
        {
          path: "ci/test",
          name: "test",
          kind: "parallel",
          children: [{ path: "ci/test/unit", name: "unit", kind: "command" }],
        },
      ],
    },
    tests: [
      { path: "ci/build", status: "passed", durationMs: 100 },
      { path: "ci/test/unit", status: "failed", durationMs: 200 },
    ],
  });
  const rows = suiteRows(record);
  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.path}`),
    ["0:ci", "1:ci/build", "1:ci/test", "2:ci/test/unit"],
  );
  // recorded results attach to their tree nodes; pure groups stay blank
  assert.equal(rows[1].status, "passed");
  assert.equal(rows[2].status, undefined);
  assert.equal(rows[3].durationMs, 200);
});

test("suiteRows derives a tree from slash-paths when no tree was recorded", () => {
  const rows = suiteRows(
    run({
      tests: [
        { path: "ci/build", status: "passed" },
        { path: "ci/test/unit", status: "passed" },
      ],
    }),
  );
  assert.deepEqual(
    rows.map((row) => `${row.depth}:${row.path}`),
    ["0:ci", "1:ci/build", "1:ci/test", "2:ci/test/unit"],
  );
});

test("testRunsFor lists one path's executions, or every test's", () => {
  const history = {
    runs: [
      run({
        id: "r2",
        tests: [
          { path: "ci/unit", status: "failed", durationMs: 50, log: "logs/unit.log" },
          { path: "ci/lint", status: "passed" },
        ],
      }),
      run({ id: "r1", tests: [{ path: "ci/unit", status: "passed", cached: true }] }),
    ],
  } as unknown as Parameters<typeof testRunsFor>[0];

  const one = testRunsFor(history, "ci/unit");
  assert.deepEqual(
    one.map((row) => `${row.runId}:${row.status}`),
    ["r2:failed", "r1:passed"],
  );
  assert.equal(one[0].hasLog, true);
  assert.equal(one[1].cached, true);

  assert.equal(testRunsFor(history).length, 3, "no path means every recorded execution");
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

test("an analysis is shown with the run, marked as added afterwards", () => {
  const lines = describeRun(
    run({
      analysis: {
        text: "The port collision, not this change.\nSee ci/migrations.",
        author: "claude-code",
      },
    }),
  ).map((line) => line.text);

  assert.ok(lines.includes("analysis:  (added after the run by claude-code)"));
  assert.ok(lines.includes("  The port collision, not this change."));
  assert.ok(lines.includes("  See ci/migrations."), "every line of it, not only the first");
  // a run without one says nothing at all about analysis
  assert.ok(!describeRun(run()).some((line) => line.text.startsWith("analysis:")));
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

test("relatedServices follows the suite tree: node + ancestors, else all", () => {
  const record = run({
    suite: {
      path: "ci",
      name: "ci",
      kind: "sequence",
      services: ["db"],
      children: [
        { path: "ci/api", name: "api", kind: "command", services: ["redis"] },
        { path: "ci/lint", name: "lint", kind: "command" },
      ],
    },
    services: [{ name: "db" }, { name: "redis" }, { name: "mail" }],
  });

  assert.deepEqual(
    relatedServices(record, "ci/api").map((s) => s.name),
    ["db", "redis"],
    "a test relates the services declared on its node and its ancestors",
  );
  assert.deepEqual(
    relatedServices(record, "ci/lint").map((s) => s.name),
    ["db"],
    "a node without its own services still inherits the ancestors'",
  );
  assert.equal(
    relatedServices(record, undefined).length,
    3,
    "no path (the run itself) relates every service",
  );
  assert.equal(
    relatedServices(run({ services: [{ name: "db" }] }), "ci/unit").length,
    1,
    "without a recorded tree every service stays related",
  );
});

test("testOverview describes one execution, artifacts and services included", () => {
  const record = run({
    suite: {
      path: "ci",
      name: "ci",
      kind: "sequence",
      children: [{ path: "ci/unit", name: "unit", kind: "command", services: ["db"] }],
    },
    services: [{ name: "db", status: "stopped" }, { name: "mail" }],
    tests: [
      {
        path: "ci/unit",
        status: "failed",
        durationMs: 900,
        startedAfterMs: 100,
        artifacts: ["artifacts/ci-unit/report.html"],
      },
    ],
  });
  const lines = testOverview(record, "ci/unit").map((line) => line.text);
  assert.ok(lines.some((line) => line.startsWith("status:") && line.includes("failed")));
  assert.ok(lines.some((line) => line.includes("+100ms")));
  assert.ok(lines.some((line) => line.includes("artifacts/ci-unit/report.html")));
  assert.ok(lines.some((line) => line.trim().startsWith("db (stopped)")));
  assert.ok(!lines.some((line) => line.includes("mail")), "unrelated services stay off the page");

  assert.deepEqual(
    testOverview(record, "ci/nope").map((line) => line.text),
    ["not executed in this run"],
  );
});

test("the recorded-tests view carries each test's verdict", () => {
  // 12 results per test, newest first
  const runs = Array.from({ length: 12 }, (_, i) =>
    run({
      id: `r${i}`,
      tests: [
        { path: "ci/flaky", status: i % 2 === 0 ? "failed" : "passed" },
        { path: "ci/stable", status: "passed" },
        { path: "ci/broken", status: i === 0 ? "passed" : "failed" },
      ],
    }),
  );
  // ... plus a test that has only ever run twice
  runs[0].tests.push({ path: "ci/new", status: "failed" });
  runs[1].tests.push({ path: "ci/new", status: "failed" });

  const history = { runs } as unknown as Parameters<typeof recordedTests>[0];
  assert.deepEqual(
    recordedTests(history).map((t) => `${t.path}:${t.verdict}`),
    ["ci/flaky:flaky", "ci/stable:healthy", "ci/broken:broken", "ci/new:unknown"],
  );
});

test("the run overview names what the environment gave, masked and hid", () => {
  const lines = describeRun(
    run({
      fromEnvironment: {
        variables: ["BASE_URL"],
        secrets: ["API_TOKEN"],
        overrides: [{ path: "ports.db", from: "TESTFILE_CONFIG_ports__db", value: "15432" }],
      },
    }),
  );
  const text = lines.map((line) => line.text);
  assert.ok(text.some((line) => line.startsWith("given:     BASE_URL")));
  assert.ok(text.some((line) => line.startsWith("secrets:   API_TOKEN")));
  assert.ok(
    text.some((line) => line.includes("override:  ports.db = 15432  (TESTFILE_CONFIG_ports__db)")),
  );
});

test("a run the environment did not touch shows none of it", () => {
  const text = describeRun(run({})).map((line) => line.text);
  assert.ok(!text.some((line) => line.startsWith("given:")));
  assert.ok(!text.some((line) => line.startsWith("override:")));
});
