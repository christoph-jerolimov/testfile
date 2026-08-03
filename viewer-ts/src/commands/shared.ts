// Helpers shared by the viewer's commands: locating a history, resolving a
// run by id prefix, status colors and JSON output.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HISTORY_DIR, RunHistory, type RunRecord } from "../runrecord.js";
import { color } from "../util.js";

const STATUS_COLORS: Record<string, number> = {
  passed: 32,
  failed: 31,
  aborted: 35,
  skipped: 90,
};

export function colorStatus(status: string): string {
  return color(STATUS_COLORS[status] ?? 0, status);
}

// Everything works directly on the .testfile folder; a path may point at a
// Testfile, its directory, or any directory containing .testfile/.
export function resolveHistoryBase(path: string): string {
  const p = resolve(path);
  return existsSync(p) && statSync(p).isFile() ? dirname(p) : p;
}

export function commandFailed(err: unknown): void {
  console.error(`${color(31, "\u2718")} ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
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

// The run to operate on: an id prefix when given, the latest run otherwise.
export function pickRun(base: string, idOrPrefix: string | undefined): RunRecord {
  const history = new RunHistory(base);
  if (idOrPrefix !== undefined) {
    const run = history.find(idOrPrefix);
    if (!run) throw new Error(`no recorded run matches "${idOrPrefix}"`);
    return run;
  }
  const run = history.runs[0];
  if (!run) throw new Error(`no recorded runs in ${HISTORY_DIR}/`);
  return run;
}

export function reportImport(result: { imported: string[]; skipped: string[] }): void {
  for (const id of result.imported) console.log(`${color(32, "\u2714")} imported run ${id}`);
  for (const id of result.skipped) {
    console.log(color(90, `- run ${id} already exists locally, skipped`));
  }
}

export function writeJson(data: unknown, target: string | true): void {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (typeof target === "string") {
    writeFileSync(target, json);
    console.log(color(90, `written to ${target}`));
  } else {
    process.stdout.write(json);
  }
}
