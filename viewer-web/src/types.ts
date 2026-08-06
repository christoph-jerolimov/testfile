// Mirrors the result format specified in spec/RESULTS.md (run.yaml).

export interface RunTest {
  path: string;
  status: string;
  // When the test started: absolute, and how far into the run it began.
  startedAt?: string;
  startedAfterMs?: number;
  durationMs?: number;
  log?: string;
  artifacts?: string[];
  cached?: boolean;
  // Why a test with `inputs` ran or was reused (free-form runner text).
  reason?: string;
  // Merged runs only: which leg this result came from.
  variants?: Record<string, string>;
  origin?: string;
}

export interface RunService {
  name: string;
  status?: string;
  log?: string;
  variants?: Record<string, string>;
  origin?: string;
}

// What `testfile-viewer merge` combined into a run.
export interface RunMerged {
  runs: {
    id: string;
    variants?: Record<string, string>;
    machine?: string;
    status: string;
    startedAt: string;
    durationMs: number;
  }[];
  variants?: Record<string, string[]>;
}

// The shape of the Testfile the run came from: the whole tree, including
// tests a filter excluded from the run (spec/RESULTS.md).
export interface SuiteNode {
  name: string;
  path: string;
  kind: string;
  tags?: string[];
  matrix?: Record<string, string>;
  services?: string[];
  children?: SuiteNode[];
}

export interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  // What distinguishes this run from a sibling run of the same suite.
  variants?: Record<string, string>;
  // Free-form strings attached to the run so it can be found again.
  labels?: string[];
  // Present when this run was produced by merging others.
  merged?: RunMerged;
  env: Record<string, string>;
  ports: Record<string, number>;
  selected: string[];
  suite?: SuiteNode;
  tests: RunTest[];
  services?: RunService[];
  junit?: string;
}

export interface Summary {
  name?: string;
  baseDir: string;
  runs: number;
}

// Per-test aggregation across all runs (the results view).
export interface Aggregate {
  path: string;
  occurrences: number;
  passes: number;
  fails: number;
  lastStatus: string;
  // Every recorded status, newest first - what the sparkline draws.
  history: string[];
  // The subset a flaky verdict is based on: passed/failed results from the
  // last FLAKY_DAYS days, newest first, at most FLAKY_SAMPLE of them.
  recent: string[];
}
