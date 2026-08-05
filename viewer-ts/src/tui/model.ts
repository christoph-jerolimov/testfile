import { variantLabel } from "../merge.js";
import type { RunHistory, RunRecord, Status } from "../runrecord.js";
import { formatMs } from "../util.js";

// A displayable log line; matches how the runner renders logs (# marks
// runner/system messages).
export interface OutputLine {
  text: string;
  stream: "stdout" | "stderr" | "system";
}

// What the right (detail) pane shows: a titled block of log-style lines.
export interface PaneContent {
  title: string;
  note?: string;
  lines: OutputLine[];
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

// A recorded run rendered as pane lines: metadata, then one line per test
// (failures on the stderr stream so they stand out).
export function describeRun(run: RunRecord): OutputLine[] {
  const lines: OutputLine[] = [
    { text: `started:   ${run.startedAt}`, stream: "system" },
    { text: `duration:  ${formatMs(run.durationMs)}`, stream: "system" },
    { text: `status:    ${run.status} (exit code ${run.exitCode})`, stream: "system" },
  ];
  if (run.cancelled) lines.push({ text: "cancelled: yes", stream: "system" });
  const variants = variantLabel(run.variants);
  if (variants) lines.push({ text: `variants:  ${variants}`, stream: "system" });
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
    const duration = test.durationMs !== undefined ? ` (${formatMs(test.durationMs)})` : "";
    const artifacts = test.artifacts?.length ? `  [${test.artifacts.length} artifacts]` : "";
    const where = variantLabel(test.variants);
    lines.push({
      text: `${test.status.padEnd(8)} ${test.path}${where ? `  [${where}]` : ""}${duration}${artifacts}`,
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
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

function testSummary(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
}

// The runs view as a table: a header line plus one aligned row per run.
export function runsTable(runs: readonly RunRecord[]): { header: string; rows: string[] } {
  // The variants column is only worth its width when some run has one.
  const label = (run: RunRecord): string =>
    run.merged
      ? mergedVariantLabel(run.merged.variants) || `merged (${run.merged.runs.length})`
      : variantLabel(run.variants);
  const width = Math.max(0, ...runs.map((run) => label(run).length));
  const column = width > 0 ? `${pad("VARIANTS", width)}  ` : "";
  const header = `${pad("STARTED", 19)}  ${pad("STATUS", 7)}  ${pad("DURATION", 8)}  ${column}TESTS`;
  const rows = runs.map(
    (run) =>
      `${pad(run.startedAt.replace("T", " ").slice(0, 19), 19)}  ${pad(run.status, 7)}  ${pad(
        formatMs(run.durationMs),
        8,
      )}  ${width > 0 ? `${pad(label(run), width)}  ` : ""}${testSummary(run)}`,
  );
  return { header, rows };
}

// The tests recorded across all runs, aggregated per test path.
export interface RecordedTest {
  path: string;
  occurrences: number;
  passes: number;
  fails: number;
  lastStatus: Status;
}

export function recordedTests(history: RunHistory): RecordedTest[] {
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

// The per-test history: one table row per recorded occurrence.
export function testHistoryLines(path: string, history: RunHistory): OutputLine[] {
  const rows: { run: RunRecord; test: RunRecord["tests"][number] }[] = [];
  for (const run of history.runs) {
    const test = run.tests.find((t) => t.path === path);
    if (test) rows.push({ run, test });
  }
  if (rows.length === 0) {
    return [{ text: "no recorded runs for this test", stream: "system" }];
  }
  const idWidth = Math.max(3, ...rows.map((r) => r.run.id.length));
  const lines: OutputLine[] = [
    {
      text: `${pad("RUN", idWidth)}  ${pad("STARTED", 19)}  ${pad("STATUS", 8)}  ${pad("DURATION", 8)}  NOTES`,
      stream: "system",
    },
  ];
  for (const { run, test } of rows) {
    const notes = [
      test.cached ? "[cached]" : "",
      test.artifacts?.length ? `[${test.artifacts.length} artifacts]` : "",
      test.log ? "[log]" : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push({
      text: `${pad(run.id, idWidth)}  ${pad(run.startedAt.replace("T", " ").slice(0, 19), 19)}  ${pad(
        test.status,
        8,
      )}  ${pad(test.durationMs !== undefined ? formatMs(test.durationMs) : "-", 8)}  ${notes}`.trimEnd(),
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
  }
  return lines;
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

// The scroll value that centers the given line in a window of `height`.
export function scrollToLine(totalLines: number, height: number, line: number): number {
  return Math.max(0, totalLines - line - Math.ceil(height / 2));
}

// Slices the tail of a log for display: scroll = 0 follows the end, larger
// values scroll back. Returns the window plus how many lines are above it.
export function logWindow<T>(
  lines: T[],
  height: number,
  scroll: number,
): { window: T[]; above: number } {
  const maxScroll = Math.max(0, lines.length - height);
  const clamped = Math.min(scroll, maxScroll);
  const end = lines.length - clamped;
  const start = Math.max(0, end - height);
  return { window: lines.slice(start, end), above: start };
}
