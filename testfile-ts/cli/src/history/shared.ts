// Helpers shared by the viewer's commands: loading a history, resolving a
// run by id prefix, and status colors. The helpers every command line over
// the recorded runs needs - resolveHistoryBase, commandFailed, wantsJson,
// writeJson - live in @testfile.dev/core, next to the domain they read.
import {
  color,
  HISTORY_DIR,
  resolveHistoryBase,
  RunHistory,
  type RunRecord,
} from "@testfile.dev/core";

const STATUS_COLORS: Record<string, number> = {
  passed: 32,
  failed: 31,
  aborted: 35,
  skipped: 90,
};

export function colorStatus(status: string): string {
  return color(STATUS_COLORS[status] ?? 0, status);
}

// Repeatable options gather their values, like the runner's filters do.
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function summarizeTests(run: RunRecord): string {
  const counts = new Map<string, number>();
  for (const test of run.tests) counts.set(test.status, (counts.get(test.status) ?? 0) + 1);
  return (
    [...counts.entries()].map(([status, n]) => `${n} ${colorStatus(status)}`).join(", ") || "-"
  );
}

export function loadedHistory(path: string): RunHistory {
  const history = new RunHistory(resolveHistoryBase(path));
  if (history.runs.length === 0) throw new Error(`no recorded runs in ${HISTORY_DIR}/`);
  return history;
}

export function findRun(history: RunHistory, idOrPrefix: string): RunRecord {
  const run = history.find(idOrPrefix);
  if (!run) throw new Error(`no recorded run matches "${idOrPrefix}"`);
  return run;
}
