// Read-only access to recorded Testfile runs. The viewer NEVER writes into
// .testfile/ - runs are produced by a runner (any implementation following
// the result format in spec/) and only consumed here.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const HISTORY_DIR = ".testfile";

export type Status = "pending" | "running" | "passed" | "failed" | "skipped" | "aborted";

export interface RunRecordTest {
  path: string;
  status: Status;
  // When the test started: absolute, and relative to the start of the run,
  // so a run lays out on a timeline without parsing dates.
  startedAt?: string;
  startedAfterMs?: number;
  durationMs?: number;
  log?: string;
  artifacts?: string[];
  cached?: boolean;
  // Why a test with `inputs` ran or was reused (free-form runner text).
  reason?: string;
  // Merged runs only: the variants of the run this result came from, and
  // that run's id.
  variants?: Record<string, string>;
  origin?: string;
}

// The Testfile's tree as recorded with the run (absent in older records).
export interface RunRecordSuiteNode {
  name: string;
  path: string;
  kind: "command" | "script" | "sequence" | "parallel" | "matrix";
  tags?: string[];
  matrix?: Record<string, string>;
  services?: string[];
  children?: RunRecordSuiteNode[];
}

export interface RunRecordService {
  name: string;
  status?: string;
  log?: string;
  // Merged runs only, like the test fields above.
  variants?: Record<string, string>;
  origin?: string;
}

// What `testfile merge` combined into this run.
export interface RunRecordMerged {
  runs: {
    id: string;
    variants?: Record<string, string>;
    machine?: string;
    status: "passed" | "failed" | "aborted";
    startedAt: string;
    durationMs: number;
  }[];
  // Every variant value the merged runs used, per key.
  variants?: Record<string, string[]>;
}

export interface RunRecord {
  id: string;
  startedAt: string;
  durationMs: number;
  status: "passed" | "failed" | "aborted";
  exitCode: number;
  cancelled: boolean;
  // Who ran it (CI actor, gh login or hostname); absent in older records.
  machine?: string;
  // What distinguishes this run from a sibling run of the same suite.
  variants?: Record<string, string>;
  // What the run should be findable by, e.g. { branch: main, pr: "42" }.
  labels?: Record<string, string>;
  // Present when this run was produced by merging others.
  merged?: RunRecordMerged;
  env: Record<string, string>;
  ports: Record<string, number>;
  selected: string[];
  // The Testfile's test tree, including tests the run did not execute.
  suite?: RunRecordSuiteNode;
  tests: RunRecordTest[];
  services?: RunRecordService[];
  junit?: string;
  // Somebody's reading of why the run went the way it did, written after
  // the run. An annotation, never a result: it must not change a status,
  // a count or a verdict.
  analysis?: RunRecordAnalysis;
}

export interface RunRecordAnalysis {
  text: string;
  author?: string;
  at?: string;
}

// Reads runs/<id>/run.yaml folders (newest first). Runs recorded by very
// old runners as one runs.yaml index are read too - without modifying
// anything on disk.
export class RunHistory {
  readonly dir: string;
  private index: RunRecord[] = [];

  constructor(baseDir: string) {
    this.dir = join(baseDir, HISTORY_DIR);
    this.index = this.load();
  }

  private load(): RunRecord[] {
    const runs: RunRecord[] = [];
    const seen = new Set<string>();
    try {
      for (const entry of readdirSync(join(this.dir, "runs"), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const record = parse(
            readFileSync(join(this.dir, "runs", entry.name, "run.yaml"), "utf8"),
          ) as RunRecord | null;
          if (record && typeof record === "object" && Array.isArray(record.tests)) {
            const id = record.id ?? entry.name;
            runs.push({ ...record, id });
            seen.add(id);
          }
        } catch {
          // a run folder without a (readable) run.yaml is not a run
        }
      }
    } catch {
      // no runs folder (yet)
    }
    try {
      const legacy = parse(readFileSync(join(this.dir, "runs.yaml"), "utf8")) as {
        runs?: RunRecord[];
      } | null;
      for (const record of legacy?.runs ?? []) {
        if (record?.id && !seen.has(record.id)) runs.push(record);
      }
    } catch {
      // no legacy index
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
  }

  // Newest first.
  get runs(): readonly RunRecord[] {
    return this.index;
  }

  // Re-reads the run folders, picking up runs recorded by other processes.
  reload(): void {
    this.index = this.load();
  }

  // Looks a run up by its id; a unique prefix is sufficient.
  find(idOrPrefix: string): RunRecord | undefined {
    const exact = this.index.find((run) => run.id === idOrPrefix);
    if (exact) return exact;
    const matches = this.index.filter((run) => run.id.startsWith(idOrPrefix));
    return matches.length === 1 ? matches[0] : undefined;
  }

  latestFor(path: string): { run: RunRecord; test: RunRecordTest } | undefined {
    for (const run of this.index) {
      const test = run.tests.find((t) => t.path === path);
      if (test) return { run, test };
    }
    return undefined;
  }

  // The folder a run was recorded in - everything it kept (logs, artifacts,
  // junit.xml, the run.yaml itself) lives under it.
  runDir(run: RunRecord): string {
    return join(this.dir, "runs", run.id);
  }

  readLog(run: RunRecord, test: RunRecordTest): string | undefined {
    if (!test.log) return undefined;
    try {
      return readFileSync(join(this.dir, "runs", run.id, test.log), "utf8");
    } catch {
      return undefined;
    }
  }

  readServiceLog(run: RunRecord, service: RunRecordService): string | undefined {
    if (!service.log) return undefined;
    try {
      return readFileSync(join(this.dir, "runs", run.id, service.log), "utf8");
    } catch {
      return undefined;
    }
  }

  // The merged stdout+stderr of the whole run, assembled on demand from the
  // per-test and service logs. (Very old runs recorded a pre-merged
  // output.log; when one exists it is served as-is.)
  readRunLog(run: RunRecord): string | undefined {
    try {
      return readFileSync(join(this.dir, "runs", run.id, "output.log"), "utf8");
    } catch {
      // no legacy file: assemble below
    }
    const parts: string[] = [];
    for (const test of run.tests) {
      const duration = test.durationMs !== undefined ? `, ${test.durationMs}ms` : "";
      parts.push(`=== ${test.path} (${test.status}${duration}) ===`);
      const log = this.readLog(run, test);
      if (log !== undefined && log !== "") parts.push(log.trimEnd());
    }
    for (const service of run.services ?? []) {
      parts.push(`=== service ${service.name}${service.status ? ` (${service.status})` : ""} ===`);
      const log = this.readServiceLog(run, service);
      if (log !== undefined && log !== "") parts.push(log.trimEnd());
    }
    return parts.length === 0 ? undefined : `${parts.join("\n")}\n`;
  }
}

export interface RunDiff {
  newlyFailed: string[];
  fixed: string[];
  stillFailing: string[];
  added: string[];
  removed: string[];
  // Significant duration changes of tests passing in both runs.
  durations: { path: string; fromMs: number; toMs: number }[];
}

// Compares two recorded runs, `base` being the older one.
export function diffRuns(base: RunRecord, compare: RunRecord): RunDiff {
  const bad = (status: Status): boolean => status === "failed" || status === "aborted";
  const baseTests = new Map(base.tests.map((t) => [t.path, t]));
  const compareTests = new Map(compare.tests.map((t) => [t.path, t]));

  const diff: RunDiff = {
    newlyFailed: [],
    fixed: [],
    stillFailing: [],
    added: [],
    removed: [],
    durations: [],
  };

  for (const [path, test] of compareTests) {
    const before = baseTests.get(path);
    if (!before) {
      diff.added.push(path);
      continue;
    }
    if (bad(test.status) && bad(before.status)) diff.stillFailing.push(path);
    else if (bad(test.status)) diff.newlyFailed.push(path);
    else if (bad(before.status)) diff.fixed.push(path);

    if (
      test.status === "passed" &&
      before.status === "passed" &&
      test.durationMs !== undefined &&
      before.durationMs !== undefined
    ) {
      const delta = Math.abs(test.durationMs - before.durationMs);
      if (delta > 100 && delta > before.durationMs * 0.2) {
        diff.durations.push({ path, fromMs: before.durationMs, toMs: test.durationMs });
      }
    }
  }
  for (const path of baseTests.keys()) {
    if (!compareTests.has(path)) diff.removed.push(path);
  }
  return diff;
}

// How a test's reliability is judged, everywhere it is shown. Only the
// FLAKY_SAMPLE most recent results count - what a test did fifty runs ago
// says nothing about it now - and below FLAKY_MIN_RESULTS there is not
// enough evidence to say anything at all.
export const FLAKY_SAMPLE = 20;
export const FLAKY_MIN_RESULTS = 10;
export const FLAKY_MIN_RATE = 0.25;
export const BROKEN_MIN_RATE = 0.75;

// What the sample says about a test:
// - `unknown`: fewer than FLAKY_MIN_RESULTS results, so no verdict
// - `healthy`: it fails less than a quarter of the time
// - `flaky`:   it fails between a quarter and three quarters of the time
// - `broken`:  it fails more than three quarters of the time
export type Verdict = "unknown" | "healthy" | "flaky" | "broken";

// The results a verdict is based on, per test path: the passed and failed
// outcomes, newest first, at most FLAKY_SAMPLE of them.
//
// `skipped` and `aborted` are not evidence: a skip says the test never ran,
// and one Ctrl+C aborts everything in flight, which would otherwise make a
// whole suite look flaky at once.
export function flakyWindows(runs: readonly RunRecord[]): Map<string, ("passed" | "failed")[]> {
  const byPath = new Map<string, ("passed" | "failed")[]>();
  // runs are newest first, so the first results seen are the recent ones
  for (const run of runs) {
    for (const test of run.tests) {
      if (test.status !== "passed" && test.status !== "failed") continue;
      let statuses = byPath.get(test.path);
      if (!statuses) byPath.set(test.path, (statuses = []));
      if (statuses.length < FLAKY_SAMPLE) statuses.push(test.status);
    }
  }
  return byPath;
}

export function verdictOf(statuses: readonly string[]): Verdict {
  if (statuses.length < FLAKY_MIN_RESULTS) return "unknown";
  const rate = statuses.filter((status) => status === "failed").length / statuses.length;
  if (rate > BROKEN_MIN_RATE) return "broken";
  return rate >= FLAKY_MIN_RATE ? "flaky" : "healthy";
}

export interface FlakyReport {
  path: string;
  verdict: "flaky" | "broken";
  occurrences: number;
  passes: number;
  fails: number;
  // status changes between consecutive occurrences - the flakiness signal
  flips: number;
  lastStatus: "passed" | "failed";
}

// Scans recorded runs (newest first) for tests that fail too often to trust,
// flaky and broken alike. Every count reported is over the sample, not the
// whole history.
export function detectFlaky(runs: readonly RunRecord[], lastN?: number): FlakyReport[] {
  const considered = lastN !== undefined ? runs.slice(0, lastN) : runs;
  const reports: FlakyReport[] = [];
  for (const [path, recent] of flakyWindows(considered)) {
    const verdict = verdictOf(recent);
    if (verdict !== "flaky" && verdict !== "broken") continue;
    // oldest first, so flips read in the order the results happened
    const statuses = [...recent].reverse();
    const passes = statuses.filter((status) => status === "passed").length;
    let flips = 0;
    for (let i = 1; i < statuses.length; i++) {
      if (statuses[i] !== statuses[i - 1]) flips++;
    }
    reports.push({
      path,
      verdict,
      occurrences: statuses.length,
      passes,
      fails: statuses.length - passes,
      flips,
      lastStatus: recent[0],
    });
  }
  return reports.sort(
    (a, b) => b.flips - a.flips || b.fails - a.fails || a.path.localeCompare(b.path),
  );
}
