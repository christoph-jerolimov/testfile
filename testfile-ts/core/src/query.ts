// What can be computed from recorded runs: the queries every viewer asks
// of a history - the timeline of one run, the tests across all runs, the
// suite tree of a run, the executions of one test, the services a test
// relates to.
//
// Rendering lives with each viewer; this is the data behind it, which is
// why it is here and not in the TUI it was first written for.
import {
  flakyWindows,
  verdictOf,
  type RunHistory,
  type RunRecord,
  type Status,
  type Verdict,
} from "./runrecord.js";
import { formatMs } from "./util.js";

export interface TimelineRow {
  path: string;
  // A fixed-width bar: where in the run this test ran.
  bar: string;
  label: string;
}

// The run laid out on one axis, from its start to the end of whatever
// finished last. Fixed width, so it reads the same in any terminal.
// Tests whose record has no start (older runners, tests that never ran)
// are left out - a bar at zero would be a lie.
export function timelineRows(run: RunRecord, cells = 24): TimelineRow[] {
  const timed = run.tests.filter((test) => test.startedAfterMs !== undefined);
  if (timed.length === 0) return [];
  const end = (test: (typeof timed)[number]): number =>
    (test.startedAfterMs ?? 0) + (test.durationMs ?? 0);
  const span = Math.max(1, ...timed.map(end));
  return timed.map((test) => {
    const from = Math.min(cells - 1, Math.floor(((test.startedAfterMs ?? 0) / span) * cells));
    const to = Math.min(cells, Math.max(from + 1, Math.ceil((end(test) / span) * cells)));
    return {
      path: test.path,
      bar: " ".repeat(from) + "█".repeat(to - from) + " ".repeat(cells - to),
      label: `${formatMs(test.startedAfterMs ?? 0)}+${formatMs(test.durationMs ?? 0)}`,
    };
  });
}

// The tests recorded across all runs, aggregated per test path.
export interface RecordedTest {
  path: string;
  occurrences: number;
  passes: number;
  fails: number;
  lastStatus: Status;
  // Judged on the sampled results only - see flakyWindows in runrecord.ts.
  verdict: Verdict;
}

export function recordedTests(history: RunHistory): RecordedTest[] {
  const windows = flakyWindows(history.runs);
  const byPath = new Map<string, RecordedTest>();
  for (const run of history.runs) {
    for (const test of run.tests) {
      let entry = byPath.get(test.path);
      if (!entry) {
        // runs are newest first, so the first occurrence is the latest one
        byPath.set(
          test.path,
          (entry = {
            path: test.path,
            occurrences: 0,
            passes: 0,
            fails: 0,
            lastStatus: test.status,
            verdict: verdictOf(windows.get(test.path) ?? []),
          }),
        );
      }
      entry.occurrences++;
      if (test.status === "passed") entry.passes++;
      if (test.status === "failed" || test.status === "aborted") entry.fails++;
    }
  }
  return [...byPath.values()];
}

// One row of the suite tree table on the run page: the recorded tree when
// the run has one, else a tree derived from the test paths.
export interface SuiteRow {
  path: string;
  name: string;
  depth: number;
  status?: Status;
  durationMs?: number;
  startedAfterMs?: number;
  cached?: boolean;
  artifacts?: number;
}

export function suiteRows(run: RunRecord): SuiteRow[] {
  const byPath = new Map(run.tests.map((test) => [test.path, test]));
  const rows: SuiteRow[] = [];
  const add = (path: string, name: string, depth: number): void => {
    const test = byPath.get(path);
    rows.push({
      path,
      name,
      depth,
      status: test?.status,
      durationMs: test?.durationMs,
      startedAfterMs: test?.startedAfterMs,
      cached: test?.cached,
      artifacts: test?.artifacts?.length,
    });
  };
  const suite = run.suite;
  if (suite) {
    const walk = (node: NonNullable<RunRecord["suite"]>, depth: number): void => {
      add(node.path, node.name, depth);
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(suite, 0);
    return rows;
  }
  // No recorded tree (older runs): derive one from the slash-paths.
  const seen = new Set<string>();
  for (const test of run.tests) {
    const parts = test.path.split("/");
    for (let depth = 0; depth < parts.length; depth++) {
      const path = parts.slice(0, depth + 1).join("/");
      if (seen.has(path)) continue;
      seen.add(path);
      add(path, parts[depth]!, depth);
    }
  }
  return rows;
}

// One row of the per-test executions table (the right panel of the Tests
// tab, and the whole content of its narrow-mode page).
export interface TestRunRow {
  runId: string;
  startedAt: string;
  path: string;
  status: Status;
  durationMs?: number;
  cached?: boolean;
  artifacts?: number;
  hasLog: boolean;
}

// All executions of one test path across the history - or of every test
// when `path` is undefined ("All tests").
export function testRunsFor(history: RunHistory, path?: string): TestRunRow[] {
  const rows: TestRunRow[] = [];
  for (const run of history.runs) {
    for (const test of run.tests) {
      if (path !== undefined && test.path !== path) continue;
      rows.push({
        runId: run.id,
        startedAt: run.startedAt,
        path: test.path,
        status: test.status,
        durationMs: test.durationMs,
        cached: test.cached,
        artifacts: test.artifacts?.length,
        hasLog: test.log !== undefined,
      });
    }
  }
  return rows;
}

// The services whose logs belong on a test's detail page: the ones declared
// on the test's suite node or any ancestor. Runs without a recorded tree
// relate every service - too many tabs beats missing ones.
export function relatedServices(
  run: RunRecord,
  path: string | undefined,
): NonNullable<RunRecord["services"]> {
  const services = run.services ?? [];
  if (services.length === 0) return [];
  if (path === undefined || !run.suite) return services;
  const declared = new Set<string>();
  const walk = (node: NonNullable<RunRecord["suite"]>, prefixMatches: boolean): boolean => {
    const onPath = prefixMatches && (path === node.path || path.startsWith(`${node.path}/`));
    if (onPath) for (const name of node.services ?? []) declared.add(name);
    let found = path === node.path;
    for (const child of node.children ?? []) found = walk(child, onPath) || found;
    return found;
  };
  const found = walk(run.suite, true);
  if (!found || declared.size === 0) return services;
  return services.filter((service) => declared.has(service.name));
}
