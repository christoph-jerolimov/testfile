// Mirrors the result format specified in spec/RESULTS.md (run.yaml).

export interface RunTest {
  path: string;
  status: string;
  durationMs?: number;
  log?: string;
  artifacts?: string[];
  cached?: boolean;
}

export interface RunService {
  name: string;
  status?: string;
  log?: string;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
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
