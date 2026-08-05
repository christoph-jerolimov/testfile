import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunRecord } from "../runrecord.js";
import { describeRun, runsTable } from "./model.js";

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
