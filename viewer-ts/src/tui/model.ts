import { variantLabel } from "../merge.js";
import {
  flakyWindows,
  verdictOf,
  type RunHistory,
  type RunRecord,
  type Status,
  type Verdict,
} from "../runrecord.js";
import { formatMs } from "../util.js";

// A displayable log line; matches how the runner renders logs (# marks
// runner/system messages).
export interface OutputLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

// "platform=linux|macos" - the values a merged run combined, per key.
function mergedVariantLabel(variants: Record<string, string[]> | undefined): string {
  return Object.entries(variants ?? {})
    .map(([key, values]) => `${key}=${values.join("|")}`)
    .join(", ");
}

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

// A recorded run rendered as pane lines: metadata, then one line per test
// (failures on the stderr stream so they stand out).
export function describeRun(run: RunRecord): OutputLine[] {
  const lines: OutputLine[] = [
    { text: `run:       ${run.id}`, stream: "system" },
    { text: `started:   ${run.startedAt}`, stream: "system" },
    { text: `duration:  ${formatMs(run.durationMs)}`, stream: "system" },
    { text: `status:    ${run.status} (exit code ${run.exitCode})`, stream: "system" },
  ];
  if (run.cancelled) lines.push({ text: "cancelled: yes", stream: "system" });
  const variants = variantLabel(run.variants);
  if (variants) lines.push({ text: `variants:  ${variants}`, stream: "system" });
  const labels = variantLabel(run.labels);
  if (labels) lines.push({ text: `labels:    ${labels}`, stream: "system" });
  if (run.merged) {
    lines.push({
      text: `merged:    ${run.merged.runs.length} runs${
        run.merged.variants ? ` (${mergedVariantLabel(run.merged.variants)})` : ""
      }`,
      stream: "system",
    });
    for (const source of run.merged.runs) {
      const where = variantLabel(source.variants);
      lines.push({
        text: `  ${source.status.padEnd(8)} ${source.id}${where ? `  [${where}]` : ""}`,
        stream: source.status === "passed" ? "system" : "stderr",
      });
    }
  }
  if (run.selected.length > 0) {
    lines.push({ text: `selected:  ${run.selected.join(", ")}`, stream: "system" });
  }
  const env = Object.entries(run.env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (env) lines.push({ text: `env:       ${env}`, stream: "system" });
  const ports = Object.entries(run.ports)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  if (ports) lines.push({ text: `ports:     ${ports}`, stream: "system" });
  lines.push({ text: "", stream: "system" });
  for (const test of run.tests) {
    const started = test.startedAfterMs !== undefined ? ` +${formatMs(test.startedAfterMs)}` : "";
    const duration = test.durationMs !== undefined ? ` (${formatMs(test.durationMs)})` : "";
    const artifacts = test.artifacts?.length ? `  [${test.artifacts.length} artifacts]` : "";
    const where = variantLabel(test.variants);
    lines.push({
      text: `${test.status.padEnd(8)} ${test.path}${where ? `  [${where}]` : ""}${started}${duration}${artifacts}`,
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
  }
  const timeline = timelineRows(run);
  if (timeline.length > 0) {
    const width = Math.max(...timeline.map((row) => row.path.length));
    lines.push({ text: "", stream: "system" });
    lines.push({ text: "timeline:", stream: "system" });
    for (const row of timeline) {
      lines.push({
        text: `  ${pad(row.path, width)} |${row.bar}| ${row.label}`,
        stream: "system",
      });
    }
  }
  for (const service of run.services ?? []) {
    lines.push({
      text: `service  ${service.name}${service.status ? ` (${service.status})` : ""}${
        service.log ? "  [log]" : ""
      }`,
      stream: service.status === "failed" ? "stderr" : "system",
    });
  }
  return lines;
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

// Splits a stored log into displayable lines (# marks runner messages).
export function logToLines(text: string | undefined, fallback: string): OutputLine[] {
  return (text ?? fallback)
    .split("\n")
    .filter((line, i, arr) => i < arr.length - 1 || line !== "")
    .map((line) => ({
      text: line.startsWith("# ") ? line.slice(2) : line,
      stream:
        line.startsWith("===") || line.startsWith("# ") ? ("system" as const) : ("stdout" as const),
    }));
}

// Indices of log lines containing the query, case-insensitively.
export function findMatches(lines: readonly OutputLine[], query: string): number[] {
  if (query === "") return [];
  const q = query.toLowerCase();
  const out: number[] = [];
  lines.forEach((line, index) => {
    if (line.text.toLowerCase().includes(q)) out.push(index);
  });
  return out;
}

// --- v2 pages -------------------------------------------------------------

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

// The overview tab of a test in a run.
export function testOverview(run: RunRecord, path: string): OutputLine[] {
  const test = run.tests.find((t) => t.path === path);
  if (!test) {
    return [{ text: "not executed in this run", stream: "system" }];
  }
  const lines: OutputLine[] = [
    { text: `test:      ${test.path}`, stream: "system" },
    { text: `run:       ${run.id}`, stream: "system" },
    { text: `started:   ${run.startedAt}`, stream: "system" },
    {
      text: `status:    ${test.status}${test.cached ? " (cached)" : ""}`,
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "system",
    },
  ];
  if (test.startedAfterMs !== undefined) {
    lines.push({
      text: `offset:    +${formatMs(test.startedAfterMs)} into the run`,
      stream: "system",
    });
  }
  if (test.durationMs !== undefined) {
    lines.push({ text: `duration:  ${formatMs(test.durationMs)}`, stream: "system" });
  }
  if (test.reason) lines.push({ text: `reason:    ${test.reason}`, stream: "system" });
  const where = variantLabel(test.variants);
  if (where) lines.push({ text: `variants:  ${where}`, stream: "system" });
  if (test.artifacts?.length) {
    lines.push({ text: `artifacts:`, stream: "system" });
    for (const artifact of test.artifacts) lines.push({ text: `  ${artifact}`, stream: "stdout" });
  }
  const services = relatedServices(run, path);
  if (services.length > 0) {
    lines.push({ text: "", stream: "system" });
    lines.push({ text: "services:", stream: "system" });
    for (const service of services) {
      lines.push({
        text: `  ${service.name}${service.status ? ` (${service.status})` : ""}`,
        stream: service.status === "failed" ? "stderr" : "stdout",
      });
    }
  }
  return lines;
}
