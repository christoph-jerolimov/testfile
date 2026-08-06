// Laying a run out on one axis. The record carries `startedAfterMs` per
// test - how far into the run it began - so this is arithmetic rather than
// date parsing, and a merged run works the same way because `merge`
// recomputes those offsets against the merged start.
import type { RunRecord, RunTest } from "./types.js";

export interface TimelineBar {
  test: RunTest;
  fromMs: number;
  toMs: number;
  // Percentages of the axis, ready for CSS.
  left: number;
  width: number;
}

export interface Timeline {
  spanMs: number;
  bars: TimelineBar[];
  ticks: { atMs: number; left: number }[];
}

// A test that lasted a millisecond in an hour-long run still has to be
// visible; below this it would be a hairline.
const MIN_WIDTH = 0.6;

export function timelineOf(run: RunRecord, tickCount = 4): Timeline | undefined {
  const timed = run.tests.filter((test) => test.startedAfterMs !== undefined);
  if (timed.length === 0) return undefined;
  const endOf = (test: RunTest): number => (test.startedAfterMs ?? 0) + (test.durationMs ?? 0);
  // A merged run's durationMs is the sum of its legs, not a span, so only a
  // plain run's own duration can extend the axis past the last test.
  const span = Math.max(1, ...timed.map(endOf), run.merged ? 0 : (run.durationMs ?? 0));
  return {
    spanMs: span,
    bars: timed.map((test) => {
      const fromMs = test.startedAfterMs ?? 0;
      const toMs = endOf(test);
      const left = (fromMs / span) * 100;
      return {
        test,
        fromMs,
        toMs,
        left: Math.min(100 - MIN_WIDTH, left),
        width: Math.max(MIN_WIDTH, Math.min(100 - left, ((toMs - fromMs) / span) * 100)),
      };
    }),
    ticks: Array.from({ length: tickCount + 1 }, (_, index) => ({
      atMs: Math.round((span * index) / tickCount),
      left: (index / tickCount) * 100,
    })),
  };
}
