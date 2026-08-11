// One run, digested: what failed, why it might have failed, and whether it
// is worth chasing - small enough to hand to a person in a hurry or to a
// model with a context window.
//
// The pieces exist already (the record, the per-test logs, the diff against
// the run before, the flaky verdict); assembling them is the work, and
// doing it in one place means every consumer gets the same digest instead
// of inventing its own.
import { tailOf } from "./repro.js";
import {
  diffRuns,
  flakyWindows,
  verdictOf,
  type RunHistory,
  type RunRecord,
  type RunRecordTest,
  type Verdict,
} from "./runrecord.js";
import { stripAnsi } from "./util.js";

export interface ExplainFailure {
  path: string;
  status: string;
  durationMs?: number;
  reason?: string;
  // Which leg of a merged run this failure came from.
  variants?: Record<string, string>;
  // True for a test that failed because something under it failed.
  group?: boolean;
  // What the history says about this test: a flaky one is a different
  // problem from a broken one, and both are different from a fresh break.
  verdict: Verdict;
  recentFailures?: number;
  recentResults?: number;
  logTail?: string;
}

export interface Explain {
  run: {
    id: string;
    startedAt: string;
    status: string;
    durationMs: number;
    machine?: string;
    variants?: Record<string, string>;
    labels?: Record<string, string>;
  };
  counts: Record<string, number>;
  failures: ExplainFailure[];
  // Failures left out because of --max-failures.
  omittedFailures: number;
  // Against the run recorded before this one, when there is one.
  previous?: {
    id: string;
    newlyFailed: string[];
    fixed: string[];
    stillFailing: string[];
  };
}

export interface ExplainOptions {
  // Lines of log kept per failure.
  logLines?: number;
  // How many failures are detailed at all.
  maxFailures?: number;
}

const DEFAULT_LOG_LINES = 20;
const DEFAULT_MAX_FAILURES = 10;

function isBad(status: string): boolean {
  return status === "failed" || status === "aborted";
}

// A group fails because something under it failed, so the leaf is the
// interesting one: it carries the log and the reason. Groups still belong
// in the digest - they say how far the damage spread - but they come last
// and are the first to be dropped when the digest has to be shorter.
function groupPaths(run: RunRecord): Set<string> {
  const groups = new Set<string>();
  const walk = (node: NonNullable<RunRecord["suite"]>): void => {
    if ((node.children ?? []).length > 0) groups.add(node.path);
    for (const child of node.children ?? []) walk(child);
  };
  if (run.suite) {
    walk(run.suite);
    return groups;
  }
  // No recorded tree: a path that other paths hang off is a group.
  for (const test of run.tests) {
    if (run.tests.some((other) => other.path.startsWith(`${test.path}/`))) groups.add(test.path);
  }
  return groups;
}

export function explainOf(
  history: RunHistory,
  run: RunRecord,
  options: ExplainOptions = {},
): Explain {
  const logLines = options.logLines ?? DEFAULT_LOG_LINES;
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;

  const counts: Record<string, number> = {};
  for (const test of run.tests) counts[test.status] = (counts[test.status] ?? 0) + 1;

  // The verdict comes from the whole history, this run included - the same
  // rule the flaky report and the viewers use.
  const windows = flakyWindows(history.runs);

  const groups = groupPaths(run);
  const failed = run.tests
    .filter((test) => isBad(test.status))
    // leaves first, each group keeping its recorded position among its kind
    .sort((a, b) => Number(groups.has(a.path)) - Number(groups.has(b.path)));
  const failures = failed.slice(0, maxFailures).map((test: RunRecordTest): ExplainFailure => {
    const recent = windows.get(test.path) ?? [];
    return {
      path: test.path,
      status: test.status,
      ...(test.durationMs !== undefined ? { durationMs: test.durationMs } : {}),
      ...(test.reason ? { reason: test.reason } : {}),
      ...(test.variants ? { variants: test.variants } : {}),
      ...(groups.has(test.path) ? { group: true } : {}),
      verdict: verdictOf(recent),
      ...(recent.length > 0
        ? {
            recentResults: recent.length,
            recentFailures: recent.filter((status) => status === "failed").length,
          }
        : {}),
      // Colour a terminal would render is noise in a digest that will be
      // read as text - in a PR comment, a file, or a prompt.
      logTail: tailOf(stripAnsi(history.readLog(run, test) ?? ""), logLines),
    };
  });

  // The run recorded before this one, by time - "what changed" is the first
  // question after "what failed".
  const older = history.runs.find((other) => other.startedAt < run.startedAt);
  const diff = older ? diffRuns(older, run) : undefined;

  return {
    run: {
      id: run.id,
      startedAt: run.startedAt,
      status: run.status,
      durationMs: run.durationMs,
      ...(run.machine ? { machine: run.machine } : {}),
      ...(run.variants ? { variants: run.variants } : {}),
      ...(run.labels ? { labels: run.labels } : {}),
    },
    counts,
    failures,
    omittedFailures: Math.max(0, failed.length - failures.length),
    ...(older && diff
      ? {
          previous: {
            id: older.id,
            newlyFailed: diff.newlyFailed,
            fixed: diff.fixed,
            stillFailing: diff.stillFailing,
          },
        }
      : {}),
  };
}

function pairs(map?: Record<string, string>): string {
  return Object.entries(map ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

// What the verdict adds to a failure, in words - a sentence a reader can
// act on, not a label to look up.
function verdictNote(failure: ExplainFailure): string | undefined {
  if (failure.recentResults === undefined) return undefined;
  const sample = `${failure.recentFailures}/${failure.recentResults} of its recent results failed`;
  if (failure.verdict === "flaky") return `known flaky — ${sample}`;
  if (failure.verdict === "broken") return `known broken — ${sample}`;
  if (failure.verdict === "healthy") return `usually passes — ${sample}`;
  return `not enough history for a verdict — ${sample}`;
}

// Markdown, because that is what reads well in a terminal, in a PR comment
// and in a prompt alike.
export function formatExplain(explain: Explain): string {
  const out: string[] = [];
  const { run } = explain;
  out.push(`# run ${run.id}: ${run.status}`);
  out.push("");
  const facts = [
    `started ${run.startedAt}`,
    ...(run.machine ? [`on ${run.machine}`] : []),
    `took ${Math.round(run.durationMs / 100) / 10}s`,
  ];
  out.push(facts.join(", "));
  if (pairs(run.labels)) out.push(`labels: ${pairs(run.labels)}`);
  if (pairs(run.variants)) out.push(`variants: ${pairs(run.variants)}`);
  const counts = Object.entries(explain.counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(", ");
  out.push(`tests: ${counts || "none recorded"}`);

  if (explain.previous) {
    const { newlyFailed, fixed, stillFailing, id } = explain.previous;
    out.push("");
    out.push(`## against ${id}, the run before`);
    out.push("");
    if (newlyFailed.length === 0 && fixed.length === 0 && stillFailing.length === 0) {
      out.push("nothing changed: the same tests passed and failed.");
    } else {
      if (newlyFailed.length > 0) out.push(`- newly failing: ${newlyFailed.join(", ")}`);
      if (stillFailing.length > 0) out.push(`- still failing: ${stillFailing.join(", ")}`);
      if (fixed.length > 0) out.push(`- fixed: ${fixed.join(", ")}`);
    }
  }

  if (explain.failures.length === 0) {
    out.push("");
    out.push("## failures");
    out.push("");
    out.push("none — nothing in this run failed.");
    return `${out.join("\n")}\n`;
  }

  out.push("");
  out.push(`## failures (${explain.failures.length + explain.omittedFailures})`);
  for (const failure of explain.failures) {
    out.push("");
    const where = pairs(failure.variants);
    out.push(`### ${failure.path}${where ? ` (${where})` : ""}${failure.group ? " — group" : ""}`);
    out.push("");
    const note = verdictNote(failure);
    out.push(
      [
        failure.status,
        ...(failure.durationMs !== undefined ? [`after ${Math.round(failure.durationMs)}ms`] : []),
        ...(note ? [note] : []),
      ].join(", "),
    );
    if (failure.reason) out.push(`reason: ${failure.reason}`);
    if (failure.logTail) {
      out.push("");
      out.push("```");
      out.push(failure.logTail);
      out.push("```");
    } else {
      out.push("");
      out.push(
        failure.group ? "(a group: it failed because something under it did)" : "(no log recorded)",
      );
    }
  }
  if (explain.omittedFailures > 0) {
    out.push("");
    out.push(
      `... and ${explain.omittedFailures} more failing test${explain.omittedFailures === 1 ? "" : "s"}, not detailed here (--max-failures).`,
    );
  }
  return `${out.join("\n")}\n`;
}
