// Comparing two recorded runs, with the same rules as `testfile-viewer diff`
// (viewer-ts/src/runrecord.ts): a test counts as bad when it failed or was
// aborted, and a duration only counts as changed when it moved by more than
// 100ms *and* by more than a fifth.
import type { RunRecord, RunTest } from "./types.js";

export interface RunDiff {
  newlyFailed: string[];
  fixed: string[];
  stillFailing: string[];
  added: string[];
  removed: string[];
  durations: { path: string; fromMs: number; toMs: number }[];
}

const bad = (status: string): boolean => status === "failed" || status === "aborted";

// A merged run records the same path once per leg; the worst result decides,
// which is what the run's own verdict does as well.
function worstByPath(tests: readonly RunTest[]): Map<string, RunTest> {
  const byPath = new Map<string, RunTest>();
  for (const test of tests) {
    const known = byPath.get(test.path);
    if (!known || (bad(test.status) && !bad(known.status))) byPath.set(test.path, test);
  }
  return byPath;
}

export function diffRuns(base: RunRecord, compare: RunRecord): RunDiff {
  const before = worstByPath(base.tests);
  const after = worstByPath(compare.tests);
  const diff: RunDiff = {
    newlyFailed: [],
    fixed: [],
    stillFailing: [],
    added: [],
    removed: [],
    durations: [],
  };

  for (const [path, test] of after) {
    const previous = before.get(path);
    if (!previous) {
      diff.added.push(path);
      continue;
    }
    if (bad(test.status) && bad(previous.status)) diff.stillFailing.push(path);
    else if (bad(test.status)) diff.newlyFailed.push(path);
    else if (bad(previous.status)) diff.fixed.push(path);

    if (
      test.status === "passed" &&
      previous.status === "passed" &&
      test.durationMs !== undefined &&
      previous.durationMs !== undefined
    ) {
      const delta = Math.abs(test.durationMs - previous.durationMs);
      if (delta > 100 && delta > previous.durationMs * 0.2) {
        diff.durations.push({ path, fromMs: previous.durationMs, toMs: test.durationMs });
      }
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) diff.removed.push(path);
  }
  return diff;
}

export function diffTotal(diff: RunDiff): number {
  return (
    diff.newlyFailed.length +
    diff.fixed.length +
    diff.stillFailing.length +
    diff.added.length +
    diff.removed.length +
    diff.durations.length
  );
}

// The run recorded right before this one - what "compare with previous"
// means when nothing else is picked.
export function previousRun(runs: readonly RunRecord[], run: RunRecord): RunRecord | undefined {
  const ordered = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const at = ordered.findIndex((candidate) => candidate.id === run.id);
  return at >= 0 ? ordered[at + 1] : undefined;
}
