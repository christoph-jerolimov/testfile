import assert from "node:assert/strict";
import { test } from "node:test";
import { timelineOf } from "./timeline.js";
import type { RunRecord, RunTest } from "./types.js";

const run = (tests: RunTest[], over: Partial<RunRecord> = {}): RunRecord => ({
  id: "r",
  startedAt: "2026-02-01T10:00:00.000Z",
  durationMs: 1000,
  status: "passed",
  exitCode: 0,
  cancelled: false,
  env: {},
  ports: {},
  selected: [],
  tests,
  ...over,
});

test("a sequence reads as a staircase across the axis", () => {
  const timeline = timelineOf(
    run([
      { path: "ci", status: "passed", startedAfterMs: 0, durationMs: 1000 },
      { path: "ci/build", status: "passed", startedAfterMs: 0, durationMs: 250 },
      { path: "ci/unit", status: "failed", startedAfterMs: 250, durationMs: 750 },
    ]),
  );
  assert.equal(timeline?.spanMs, 1000);
  assert.deepEqual(
    timeline?.bars.map((bar) => [bar.left, bar.width]),
    [
      [0, 100],
      [0, 25],
      [25, 75],
    ],
  );
});

test("the axis covers the whole run, even past the last test", () => {
  // teardown after the last test: the run outlasts what it recorded
  const timeline = timelineOf(
    run([{ path: "ci", status: "passed", startedAfterMs: 0, durationMs: 500 }], {
      durationMs: 1000,
    }),
  );
  assert.equal(timeline?.spanMs, 1000);
  assert.deepEqual(timeline?.bars[0].width, 50);
});

test("a merged run's summed duration does not stretch the axis", () => {
  // durationMs is the sum of the legs, not a span - the tests decide
  const timeline = timelineOf(
    run(
      [
        { path: "ci", status: "passed", startedAfterMs: 0, durationMs: 400 },
        { path: "ci", status: "passed", startedAfterMs: 100, durationMs: 400 },
      ],
      { durationMs: 9000, merged: { runs: [] } },
    ),
  );
  assert.equal(timeline?.spanMs, 500);
});

test("a test too short to see still gets a visible bar", () => {
  const timeline = timelineOf(
    run([
      { path: "long", status: "passed", startedAfterMs: 0, durationMs: 100_000 },
      { path: "blink", status: "passed", startedAfterMs: 99_999, durationMs: 1 },
    ]),
  );
  const blink = timeline?.bars[1];
  assert.ok(blink && blink.width >= 0.6, "wide enough to be a bar rather than a hairline");
  assert.ok(blink && blink.left + blink.width <= 100, "and it stays on the axis");
});

test("ticks divide the axis evenly", () => {
  const timeline = timelineOf(
    run([{ path: "ci", status: "passed", startedAfterMs: 0, durationMs: 800 }]),
    4,
  );
  assert.deepEqual(
    timeline?.ticks.map((tick) => [tick.atMs, tick.left]),
    [
      [0, 0],
      [250, 25],
      [500, 50],
      [750, 75],
      [1000, 100],
    ],
  );
});

test("a record without recorded start times has no timeline", () => {
  assert.equal(timelineOf(run([{ path: "ci", status: "passed", durationMs: 10 }])), undefined);
  assert.equal(timelineOf(run([])), undefined);
});
