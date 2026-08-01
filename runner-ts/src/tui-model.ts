import type { RunHistory, RunRecord } from "./history.js";
import type { OutputLine } from "./output.js";
import { walk, type RunNode } from "./runtree.js";
import { formatMs } from "./util.js";

// The nodes shown in the TUI tree, honoring collapsed groups and the search
// query. A non-empty query overrides collapsing: it shows every node whose
// path contains the query (case-insensitive) plus its ancestors for context.
export function visibleNodes(tree: RunNode, collapsed: Set<number>, query: string): RunNode[] {
  if (query !== "") {
    const q = query.toLowerCase();
    const keep = new Set<number>();
    walk(tree, (node) => {
      if (node.path.toLowerCase().includes(q)) {
        keep.add(node.id);
        for (let parent = node.parent; parent; parent = parent.parent) keep.add(parent.id);
      }
    });
    const out: RunNode[] = [];
    walk(tree, (node) => {
      if (keep.has(node.id)) out.push(node);
    });
    return out;
  }
  const out: RunNode[] = [];
  const visit = (node: RunNode): void => {
    out.push(node);
    if (!collapsed.has(node.id)) node.children.forEach(visit);
  };
  visit(tree);
  return out;
}

// Leaves to select for "re-run failed": failures of the current session, or -
// when nothing ran yet - failures of the most recent recorded run.
export function failedLeafIds(tree: RunNode, history: RunHistory): number[] {
  const failed: number[] = [];
  walk(tree, (node) => {
    if (node.children.length === 0 && (node.status === "failed" || node.status === "aborted")) {
      failed.push(node.id);
    }
  });
  if (failed.length > 0) return failed;
  walk(tree, (node) => {
    if (node.children.length !== 0) return;
    const latest = history.latestFor(node.path);
    if (latest && (latest.test.status === "failed" || latest.test.status === "aborted")) {
      failed.push(node.id);
    }
  });
  return failed;
}

// The test the cursor should follow while a run is in progress: the first
// running leaf, or - between leaves - the deepest running node.
export function runningFocus(tree: RunNode): RunNode | undefined {
  let leaf: RunNode | undefined;
  let deepest: RunNode | undefined;
  walk(tree, (node) => {
    if (node.status !== "running") return;
    if (node.children.length === 0 && !leaf) leaf = node;
    if (!deepest || node.depth > deepest.depth) deepest = node;
  });
  return leaf ?? deepest;
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
    lines.push({
      text: `${test.status.padEnd(8)} ${test.path}${duration}${artifacts}`,
      stream: test.status === "failed" || test.status === "aborted" ? "stderr" : "stdout",
    });
  }
  return lines;
}

// One row of the history list.
export function runListLabel(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  const summary = [...counts.entries()].map(([status, n]) => `${n} ${status}`).join(", ");
  return `${run.startedAt.replace("T", " ").slice(0, 19)}  ${run.status}  ${summary}`;
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
export function logWindow<T>(lines: T[], height: number, scroll: number): { window: T[]; above: number } {
  const maxScroll = Math.max(0, lines.length - height);
  const clamped = Math.min(scroll, maxScroll);
  const end = lines.length - clamped;
  const start = Math.max(0, end - height);
  return { window: lines.slice(start, end), above: start };
}
