// Mirrors the result format specified in spec/RESULTS.md (run.yaml).

export interface RunTest {
  path: string;
  status: string;
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

export interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  // What distinguishes this run from a sibling run of the same suite.
  variants?: Record<string, string>;
  // Present when this run was produced by merging others.
  merged?: RunMerged;
  env: Record<string, string>;
  ports: Record<string, number>;
  selected: string[];
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
}
