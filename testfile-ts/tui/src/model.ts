// How the TUI's panes read a run: the text of an overview, a log split
// into lines, a search over them. What is *asked* of a history - the
// timeline, the suite rows, the executions of a test - is the same
// question every viewer asks, so it lives in @testfile.dev/core.
import {
  formatMs,
  relatedServices,
  type RunRecord,
  timelineRows,
  variantLabel,
} from "@testfile.dev/core";

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
  // Somebody's reading of the run, labelled as one: it sits among facts
  // and is not one.
  if (run.analysis) {
    const who = run.analysis.author ? ` by ${run.analysis.author}` : "";
    lines.push({ text: `analysis:  (added after the run${who})`, stream: "system" });
    for (const line of run.analysis.text.trimEnd().split("\n")) {
      lines.push({ text: `  ${line}`, stream: "system" });
    }
  }
  // What the file alone would not explain: variables the environment handed
  // in, the secrets that were in play, and the values it rewrote.
  const from = run.fromEnvironment;
  if (from?.variables?.length) {
    lines.push({ text: `given:     ${from.variables.join(", ")}`, stream: "system" });
  }
  if (from?.secrets?.length) {
    lines.push({ text: `secrets:   ${from.secrets.join(", ")}`, stream: "system" });
  }
  for (const override of from?.overrides ?? []) {
    lines.push({
      text: `override:  ${override.path} = ${override.value}  (${override.from})`,
      stream: "system",
    });
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
